/**
 * 值班者编排闭环（ADR P3/P4）
 * 用户消息 → 选值班 → 组装状态卡片 → 派发执行者 → 回写看板/知识库 → 返回聊天
 */
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';
import { KanbanCang, JieLing } from '@warmy/board';
import { yunxingDuanCunhuoZhixingqi } from './executor.js';
import { CcrGateway } from '@warmy/ccr-compressor';
import {
  xuanranYoujieShitu,
  DEFAULT_CONTEXT_BUDGET_CHARS,
  DEFAULT_KEEP_HEAD,
  DEFAULT_KEEP_TAIL,
  type LogEntry,
} from './context-renderer.js';
import { retrieveAssetsForChat, zhuCeLiaoTianZiChan } from './asset-wire.js';
import { liaoTianDaiGongJu, type LiaoTianXiaoXi, type GongJuDiaoYong, type GongJuGuiGe } from '@warmy/providers';

export interface ZhibanGongyingshangPeizhi {
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
    `[状态卡片] 群=card.groupId 值班=card.dutyId 队列=card.queueLength`,
    `运行中: card.runningTasks.slice(0, 5).join(' | ') || '无'`,
    `最近: card.recent.slice(0, 6).join(' / ')`,
  ];
  const text = lines.join('\n');
  return text.length > 1800 ? text.slice(0, 1800) + '…' : text;
}

export interface XietiaoqiYilai {
  router: GroupChatRouter;
  board: KanbanCang;
  ccr: CcrGateway;
  history: Map<string, LiaoTianXiaoXi[]>;
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
  /** 视图预算（字符）；可选带模型 id 以便按模型窗口估算 */
  contextBudgetChars?: (modelId?: string) => number;
  /**
   * 工具调用（ADR 002 §9.4 待办 2）：与 chat-send 共用同一套 recall/retrieve 工具与同一个循环。
   * 不给就等于"不暴露工具"（退回普通单轮对话）。
   */
  toolSpecs?: () => GongJuGuiGe[] | undefined;
  runTool?: (call: GongJuDiaoYong, ctx: { round: number; maxResultChars: number }) => Promise<string> | string;
  toolLimits?: () => { maxRounds: number; maxResultChars: number; totalChars: number };
  /** 项目 MEMORY（有界片段）；来自 group-store.project.memory，不来自 memory-os 流水 */
  projectMemory?: (groupId: string) => string;
  /** AI 求助选项卡的上下文片段 */
  decisionContext?: (groupId: string) => string;
  /** 门禁判停（仅 complete/验收指令时由主进程触发；此处可选回调） */
  runProjectGate?: (groupId: string, reason: string) => Promise<{ pass: boolean; summary: string } | null>;
}

export interface XietiaoJieguo {
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
export async function xietiaoQunXiaoxi(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  msg: { groupId: string; userId?: string; content: string; urgency?: 'P0'|'P1'|'P2'|'P3'; mentionIds?: string[] }
): Promise<XietiaoJieguo> {
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
    /**
     * route() 在无空闲值班时**已经** enqueue 过（group-router.route 内部）。
     * 这里绝不能再次 enqueue —— 那会双写同一条消息。
     */
    const duilieChangdu = deps.router.listQueue(msg.groupId).length;
    return {
      action: 'queue',
      reply: `[排队] 队列长度 qlen`,
      queueLength: duilieChangdu,
    };
  }

  const duty = route.duty;
  const zhiXingQiJi = (route.decision?.executorIds || []).filter((id) => id !== duty.id);
  const queueLen = deps.router.listQueue(msg.groupId).length;

  // 状态卡片：有日志时以日志为准（不变量 #5：日志是唯一事实来源），否则退回历史镜像
  const logEntries: LogEntry[] | null = deps.logOf ? deps.logOf(msg.groupId) : null;
  const card = buildStatusCard({
    groupId: msg.groupId,
    dutyId: duty.id,
    queueLength: queueLen,
    runningTasks: zhiXingQiJi.map((id) => deps.listInstances().find((x) => x.id === id)?.name || id),
    recent: (logEntries ?? (deps.history.get(msg.groupId) || []))
      .slice(-6)
      .map((m) => String(m.content ?? '').slice(0, 40)),
    tokenBudget: 2000,
  });

  // CCR 压缩用户输入
  const yiYaSuo = deps.ccr.beforeLog({ kind: 'message', content: msg.content });

  // 值班者历史：有 logOf 时**不写** history —— 那份日志由主进程 appendChatLog 统一维护，
  // 这里再 push 一份就是第二份真相（重启后与 JSONL 脱节）。
  const liShi = deps.history.get(msg.groupId) || [];
  if (!deps.logOf) {
    liShi.push({ role: 'user', content: yiYaSuo.content });
    deps.history.set(msg.groupId, liShi);
  }

  // 看板解析（仅 duty）
  let boardEvent: string | undefined;
  let gateReason: string | null = null;
  const parsed = JieLing(msg.content, msg.groupId);
  if (parsed) {
    try {
      const ev = deps.board.append(parsed, 'duty');
      boardEvent = `parsed.action:parsed.title`;
      deps.addEvent?.(parsed.title, msg.content, msg.groupId);
      if (parsed.action === 'complete_task') gateReason = 'complete_task';
    } catch {
      /* ignore */
    }
  }
  if (/(?:验收|门禁|verify|gate|read-?back)/i.test(msg.content)) {
    gateReason = gateReason || 'user-verify';
  }

  // 派发执行者：优先用短命执行者，失败则值班者自己答
  let distilled = '';
  let usage: XietiaoJieguo['usage'];
  const brief = route.decision?.taskBrief || msg.content;
  const memSnip = deps.projectMemory ? deps.projectMemory(msg.groupId) : '';
  const decSnip = deps.decisionContext ? deps.decisionContext(msg.groupId) : '';
  const contextItems = [
    card,
    ...(memSnip ? [memSnip] : []),
    ...(decSnip ? [decSnip] : []),
    `用户消息: msg.content`,
    ...retrieveAssetsForChat({ scope: 'project', strict: false }).slice(0, 3).map((a) => a.body.slice(0, 200)),
  ];

  if (cfg.apiKey || cfg.presetId === 'ollama') {
    // 执行者（短命）
    if (zhiXingQiJi.length) {
      const r = await yunxingDuanCunhuoZhixingqi(
        { taskId: 't-' + Date.now(), brief, contextItems },
        cfg
      );
      distilled = r.distilled;
    } else {
      // 无空闲执行者 → 值班者自己（带卡片）
      const { congYuSheChuangJian } = await import('@warmy/providers');
      const provider = congYuSheChuangJian(cfg.presetId, {
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL || undefined,
      });
      const sys: LiaoTianXiaoXi = {
        role: 'system',
        content:
          `你是 WArmy 项目「msg.groupId」的值班者。\ncard\n` +
          (memSnip ? memSnip + '\n' : '') +
          (decSnip ? decSnip + '\n' : '') +
          `请用简短中文回复。若需更新任务，使用指令：新建任务:/完成/进度 标题:百分比\n` +
          `任务树：新建任务 父任务 / 子任务；需要人类点选时可用工具 askUser（永远含「其他」自定义）。`,
      };
      // 不变量 #2：值班者输入复用**同一个**有界渲染器（原来这里是 hist.slice(-12)，只按条数有界）。
      // 值班系统提示里已含状态卡片，保持冻结头；会话部分恒 ≤ 预算且与日志总长解耦。
      const entries: LogEntry[] = deps.logOf
        ? deps.logOf(msg.groupId)
        : liShi.map((m, i) => ({
            seq: i + 1,
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as LogEntry['role'],
            content: typeof m.content === 'string' ? m.content : '',
          }));
      const shitu = xuanranYoujieShitu(entries, {
        budgetChars: deps.contextBudgetChars ? deps.contextBudgetChars(cfg.model) : DEFAULT_CONTEXT_BUDGET_CHARS,
        keepHead: DEFAULT_KEEP_HEAD,
        keepTail: DEFAULT_KEEP_TAIL,
        recallHint: msg.content,
      });
      // ADR 002 §9.4 待办 2：值班者路径同样可以用 recall/retrieve 解引用被省略的历史
      const limits = deps.toolLimits?.() ?? { maxRounds: 3, maxResultChars: 4000, totalChars: 12000 };
      const tools: GongJuGuiGe[] | undefined = deps.toolSpecs?.();
      const req: Parameters<typeof liaoTianDaiGongJu>[1] = {
        model: cfg.model || 'deepseek-chat',
        messages: [sys, ...(shitu.messages as LiaoTianXiaoXi[])],
        maxTokens: 512,
        tools,
      };
      const loop = deps.runTool
        ? await liaoTianDaiGongJu(provider, req, deps.runTool, {
            maxRounds: limits.maxRounds,
            maxResultChars: limits.maxResultChars,
            maxToolResultChars: limits.totalChars,
          })
        : null;
      const xiangYing = loop ? loop.response : await provider.chat(req);
      distilled = xiangYing.choices[0]?.message?.content || '';
      usage = {
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
        cacheHitTokens: xiangYing.usage.cacheHitTokens,
      };
    }
  } else {
    distilled = `[未配置 Key] 值班=duty.name 执行者=executors.join(',') || '无' 卡片已生成`;
  }

  if (!deps.logOf) {
    liShi.push({ role: 'assistant', content: distilled });
    deps.history.set(msg.groupId, liShi);
  }

  /**
   * 冲刷队列：complete 只把值班置 idle；**真正弹出**走 dequeueNext，
   * 且弹出后必须真的处理 —— 处理不了就 requeue，绝不静默丢弃（旧实现的 bug）。
   * 深度上限防止同一条故障消息无限循环。
   */
  deps.router.complete(msg.groupId);
  let paidiaoShendu = 0;
  const DRAIN_MAX = 5;
  let extraReplies: string[] = [];
  while (paidiaoShendu < DRAIN_MAX) {
    paidiaoShendu += 1;
    const next = deps.router.dequeueNext(msg.groupId);
    if (!next) break;
    try {
      const xiayiJieguo = await runOneDutyRound(deps, cfg, {
        groupId: next.request.groupId || msg.groupId,
        userId: next.request.userId || 'local-user',
        content: next.request.content,
        urgency: next.urgency || 'P2',
        mentionIds: next.request.mentionIds || [],
      });
      if (xiayiJieguo.action === 'queue') {
        // route() 在无值班时已重新入队 —— 不要再 requeue 一次
        break;
      }
      if (xiayiJieguo.action === 'silent') {
        // 静默规则挡下：放回队列，等条件满足；绝不丢
        try {
          deps.router.requeue(next);
        } catch { /* ignore */ }
        break;
      }
      if (xiayiJieguo.reply) extraReplies.push(xiayiJieguo.reply);
      deps.router.complete(msg.groupId);
    } catch {
      // 处理失败 ⇒ 放回队列，留给下一轮；**不丢**
      try {
        deps.router.requeue(next);
      } catch { /* ignore */ }
      break;
    }
  }

  // 门禁判停：仅 complete_task / 验收指令（防过度执行）
  let menjinHang = '';
  if (gateReason && deps.runProjectGate) {
    try {
      const g = await deps.runProjectGate(msg.groupId, gateReason);
      if (g) menjinHang = g.pass ? `\n[门禁] 通过 · g.summary` : `\n[门禁] 未通过 · g.summary`;
    } catch (e) {
      menjinHang = `\n[门禁] 执行失败 · String((e as Error)?.message || e).slice(0, 120)`;
    }
  }

  return {
    action: 'dispatch',
    reply: (extraReplies.length ? `distilled\n\n[队列冲刷]\nextraReplies.join('\n---\n')` : distilled) + menjinHang,
    dutyId: duty.id,
    executorIds: zhiXingQiJi,
    boardEvent,
    queueLength: deps.router.listQueue(msg.groupId).length,
    usage,
  };
}

/** 队列冲刷用的一轮：与主路径同一套卡片/工具预算，但不再递归冲刷自己的队列 */
async function runOneDutyRound(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  msg: { groupId: string; userId: string; content: string; urgency: 'P0'|'P1'|'P2'|'P3'; mentionIds: string[] }
): Promise<XietiaoJieguo> {
  const route = deps.router.route({
    groupId: msg.groupId,
    userId: msg.userId,
    content: msg.content,
    urgency: msg.urgency,
    mentionIds: msg.mentionIds,
    timestamp: Date.now(),
  });
  if (route.action === 'silent' || !route.duty) {
    // 冲刷时又没值班了：放回队列（由 requeue 的调用方处理 —— 这里返回空让上层 requeue）
    if (route.action === 'queue' || !route.duty) {
      // route 可能已再次入队；若没有 duty 则上层 catch/requeue
      if (!route.duty && route.action !== 'queue') {
        return { action: 'queue', reply: '', queueLength: deps.router.listQueue(msg.groupId).length };
      }
    }
    return { action: 'silent', reply: '', queueLength: deps.router.listQueue(msg.groupId).length };
  }
  const duty = route.duty;
  const zhiXingQiJi = (route.decision?.executorIds || []).filter((id) => id !== duty.id);
  const logEntries: LogEntry[] | null = deps.logOf ? deps.logOf(msg.groupId) : null;
  const card = buildStatusCard({
    groupId: msg.groupId,
    dutyId: duty.id,
    queueLength: deps.router.listQueue(msg.groupId).length,
    runningTasks: zhiXingQiJi.map((id) => deps.listInstances().find((x) => x.id === id)?.name || id),
    recent: (logEntries ?? (deps.history.get(msg.groupId) || []))
      .slice(-6)
      .map((m) => String(m.content ?? '').slice(0, 40)),
    tokenBudget: 2000,
  });
  let distilled = '';
  let usage: XietiaoJieguo['usage'];
  const brief = route.decision?.taskBrief || msg.content;
  if (cfg.apiKey || cfg.presetId === 'ollama') {
    if (zhiXingQiJi.length) {
      const r = await yunxingDuanCunhuoZhixingqi({ taskId: 't-' + Date.now(), brief, contextItems: [card, `用户消息: msg.content`] }, cfg);
      distilled = r.distilled;
    } else {
      const { congYuSheChuangJian } = await import('@warmy/providers');
      const provider = congYuSheChuangJian(cfg.presetId, { apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined });
      const sys: LiaoTianXiaoXi = {
        role: 'system',
        content: `你是 WArmy 项目「msg.groupId」的值班者。\ncard\n请用简短中文回复。`,
      };
      const entries: LogEntry[] = deps.logOf
        ? deps.logOf(msg.groupId)
        : (deps.history.get(msg.groupId) || []).map((m, i) => ({
            seq: i + 1,
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as LogEntry['role'],
            content: typeof m.content === 'string' ? m.content : '',
          }));
      const shitu = xuanranYoujieShitu(entries, {
        budgetChars: deps.contextBudgetChars ? deps.contextBudgetChars(cfg.model) : DEFAULT_CONTEXT_BUDGET_CHARS,
        keepHead: DEFAULT_KEEP_HEAD,
        keepTail: DEFAULT_KEEP_TAIL,
        recallHint: msg.content,
      });
      const limits = deps.toolLimits?.() ?? { maxRounds: 3, maxResultChars: 4000, totalChars: 12000 };
      const tools: GongJuGuiGe[] | undefined = deps.toolSpecs?.();
      const req: Parameters<typeof liaoTianDaiGongJu>[1] = {
        model: cfg.model || 'deepseek-chat',
        messages: [sys, ...(shitu.messages as LiaoTianXiaoXi[])],
        maxTokens: 512,
        tools,
      };
      const loop = deps.runTool
        ? await liaoTianDaiGongJu(provider, req, deps.runTool, {
            maxRounds: limits.maxRounds,
            maxResultChars: limits.maxResultChars,
            maxToolResultChars: limits.totalChars,
          })
        : null;
      const xiangYing = loop ? loop.response : await provider.chat(req);
      distilled = xiangYing.choices[0]?.message?.content || '';
      usage = {
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
        cacheHitTokens: xiangYing.usage.cacheHitTokens,
      };
    }
  } else {
    distilled = `[未配置 Key] 队列项已处理 duty=duty.name`;
  }
  return {
    action: 'dispatch',
    reply: distilled,
    dutyId: duty.id,
    executorIds: zhiXingQiJi,
    queueLength: deps.router.listQueue(msg.groupId).length,
    usage,
  };
}
