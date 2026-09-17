/**
 * 值班者编排闭环（ADR P3/P4）
 * 用户消息 → 选值班 → 组装状态卡片 → 派发执行者 → 回写看板/知识库 → 返回聊天
 */
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@ccarmy/group-router';
import { BoardStore, parseBoardCommand } from '@ccarmy/board';
import { runShortLivedExecutor } from './executor.js';
import { CcrGateway } from '@ccarmy/ccr-compressor';
import {
  renderBoundedView,
  DEFAULT_CONTEXT_BUDGET_CHARS,
  DEFAULT_KEEP_HEAD,
  DEFAULT_KEEP_TAIL,
  type LogEntry,
} from './context-renderer.js';
import { retrieveAssetsForChat, registerChatAsset } from './asset-wire.js';
import type { ChatMessage } from '@ccarmy/providers';

export interface DutyProviderCfg {
  presetId: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface StatusCard {
  groupId: string;
  dutyId: string;
  queueLength: number;
  runningTasks: string[];
  recent: string[];
  tokenBudget: number;
}

/** 状态卡片：≤2000 token 的紧凑视图 */
export function buildStatusCard(card: StatusCard): string {
  const lines = [
    `[状态卡片] 群=${card.groupId} 值班=${card.dutyId} 队列=${card.queueLength}`,
    `运行中: ${card.runningTasks.slice(0, 5).join(' | ') || '无'}`,
    `最近: ${card.recent.slice(0, 6).join(' / ')}`,
  ];
  const text = lines.join('\n');
  return text.length > 1800 ? text.slice(0, 1800) + '…' : text;
}

export interface OrchestratorDeps {
  router: GroupChatRouter;
  board: BoardStore;
  ccr: CcrGateway;
  history: Map<string, ChatMessage[]>;
  /** 知识库写入（可选） */
  addEvent?: (title: string, body: string, groupId: string) => void;
  /** 取本机实例 ID 列表 */
  listInstances: () => Array<{ id: string; name: string; status: string; dutyEligible: boolean }>;
  /**
   * 会话日志（只追加，ADR 002 / 不变量 #2）：由主进程提供同一份日志，值班者输入复用它渲染。
   * 缺省时退化为按 history 下标造 seq，仍然走同一个渲染器（不另写一份）。
   */
  logOf?: (key: string) => LogEntry[];
  /** 视图预算（字符）；缺省用 context-renderer 的默认预算 */
  contextBudgetChars?: () => number;
}

export interface OrchestrateResult {
  action: 'silent' | 'queue' | 'dispatch' | 'error';
  reply: string;
  dutyId?: string;
  executorIds?: string[];
  boardEvent?: string;
  queueLength: number;
  usage?: { promptTokens: number; completionTokens: number; cacheHitTokens: number };
}

/**
 * 完整闭环：路由 → 卡片 → 执行者 → 看板/知识库 → 蒸馏回复
 */
export async function orchestrateGroupMessage(
  deps: OrchestratorDeps,
  cfg: DutyProviderCfg,
  msg: { groupId: string; userId?: string; content: string; urgency?: 'P0'|'P1'|'P2'|'P3'; mentionIds?: string[] }
): Promise<OrchestrateResult> {
  const urgency = msg.urgency || 'P2';
  const route = deps.router.route({
    groupId: msg.groupId,
    userId: msg.userId || 'local-user',
    content: msg.content,
    urgency,
    mentionIds: msg.mentionIds || [],
    timestamp: Date.now(),
  });

  if (route.action === 'silent') {
    return { action: 'silent', reply: '', queueLength: deps.router.listQueue(msg.groupId).length };
  }

  if (route.action === 'queue' || !route.duty) {
    deps.router.enqueue({
      groupId: msg.groupId,
      userId: msg.userId || 'local-user',
      content: msg.content,
      urgency,
      mentionIds: msg.mentionIds || [],
      timestamp: Date.now(),
    });
    return {
      action: 'queue',
      reply: `[排队] 队列长度 ${deps.router.listQueue(msg.groupId).length}`,
      queueLength: deps.router.listQueue(msg.groupId).length,
    };
  }

  const duty = route.duty;
  const executors = (route.decision?.executorIds || []).filter((id) => id !== duty.id);
  const queueLen = deps.router.listQueue(msg.groupId).length;

  // 状态卡片
  const card = buildStatusCard({
    groupId: msg.groupId,
    dutyId: duty.id,
    queueLength: queueLen,
    runningTasks: executors.map((id) => deps.listInstances().find((x) => x.id === id)?.name || id),
    recent: (deps.history.get(msg.groupId) || []).slice(-6).map((m) => m.content.slice(0, 40)),
    tokenBudget: 2000,
  });

  // CCR 压缩用户输入
  const compressed = deps.ccr.beforeLog({ kind: 'message', content: msg.content });

  // 值班者历史
  const hist = deps.history.get(msg.groupId) || [];
  hist.push({ role: 'user', content: compressed.content });
  deps.history.set(msg.groupId, hist);

  // 看板解析（仅 duty）
  let boardEvent: string | undefined;
  const parsed = parseBoardCommand(msg.content, msg.groupId);
  if (parsed) {
    try {
      const ev = deps.board.append(parsed, 'duty');
      boardEvent = `${parsed.action}:${parsed.title}`;
      deps.addEvent?.(parsed.title, msg.content, msg.groupId);
    } catch {
      /* ignore */
    }
  }

  // 派发执行者：优先用短命执行者，失败则值班者自己答
  let distilled = '';
  let usage: OrchestrateResult['usage'];
  const brief = route.decision?.taskBrief || msg.content;
  const contextItems = [
    card,
    `用户消息: ${msg.content}`,
    ...retrieveAssetsForChat({ scope: 'project', strict: false }).slice(0, 3).map((a) => a.body.slice(0, 200)),
  ];

  if (cfg.apiKey || cfg.presetId === 'ollama') {
    // 执行者（短命）
    if (executors.length) {
      const r = await runShortLivedExecutor(
        { taskId: 't-' + Date.now(), brief, contextItems },
        cfg
      );
      distilled = r.distilled;
    } else {
      // 无空闲执行者 → 值班者自己（带卡片）
      const { createProviderFromPreset } = await import('@ccarmy/providers');
      const provider = createProviderFromPreset(cfg.presetId, {
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL || undefined,
      });
      const sys: ChatMessage = {
        role: 'system',
        content: `你是 CCArmy 项目「${msg.groupId}」的值班者。\n${card}\n请用简短中文回复。若需更新任务，使用指令：新建任务:/完成/进度 标题:百分比`,
      };
      // 不变量 #2：值班者输入复用**同一个**有界渲染器（原来这里是 hist.slice(-12)，只按条数有界）。
      // 值班系统提示里已含状态卡片，保持冻结头；会话部分恒 ≤ 预算且与日志总长解耦。
      const entries: LogEntry[] = deps.logOf
        ? deps.logOf(msg.groupId)
        : hist.map((m, i) => ({
            seq: i + 1,
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as LogEntry['role'],
            content: typeof m.content === 'string' ? m.content : '',
          }));
      const view = renderBoundedView(entries, {
        budgetChars: deps.contextBudgetChars ? deps.contextBudgetChars() : DEFAULT_CONTEXT_BUDGET_CHARS,
        keepHead: DEFAULT_KEEP_HEAD,
        keepTail: DEFAULT_KEEP_TAIL,
        recallHint: msg.content,
      });
      const resp = await provider.chat({
        model: cfg.model || 'deepseek-chat',
        messages: [sys, ...(view.messages as ChatMessage[])],
        maxTokens: 512,
      });
      distilled = resp.choices[0]?.message?.content || '';
      usage = {
        promptTokens: resp.usage.promptTokens,
        completionTokens: resp.usage.completionTokens,
        cacheHitTokens: resp.usage.cacheHitTokens,
      };
    }
  } else {
    distilled = `[未配置 Key] 值班=${duty.name} 执行者=${executors.join(',') || '无'} 卡片已生成`;
  }

  hist.push({ role: 'assistant', content: distilled });
  deps.history.set(msg.groupId, hist);

  // 冲刷队列中 P2/P3
  const next = deps.router.complete(msg.groupId);
  if (next) {
    // 简化：直接标记 dispatched，不再递归（避免无限循环）
  }

  return {
    action: 'dispatch',
    reply: distilled,
    dutyId: duty.id,
    executorIds: executors,
    boardEvent,
    queueLength: deps.router.listQueue(msg.groupId).length,
    usage,
  };
}
