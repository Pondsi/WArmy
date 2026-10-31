/**
 * 值班者编排闭环（ADR P3/P4）
 * 用户消息 → 选值班 → 组装状态卡片 → 派发执行者 → 回写看板/知识库 → 返回聊天
 */
import fs from 'node:fs';
import path from 'node:path';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';
import { KanbanCang, JieLing } from '@warmy/board';
import { yunxingDuanCunhuoZhixingqi, type zhixingqiJieguo } from './executor.js';
import { xuYaoJieLi } from './pai-fa-pan-ding.js';
import { guSuanZhongYaoFuZa } from './nan-yi-du.js';
import { paiFaZhiXingZhe, paiFaXianHou, zhiBanKeZiXing, yongHuYaoQiuZhiBanZiZuo, yongHuJinZhiZhiBanZiZuo, type PaiFaJiHua, type ZhiXingFenPei } from './zhi-ban-pai-fa.js';
import { ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN } from './executor.js';
import { CcrGateway } from '@warmy/ccr-compressor';
import {
  type LogEntry,
} from './context-renderer.js';
import { retrieveAssetsForChat, zhuCeLiaoTianZiChan } from './asset-wire.js';
import { type LiaoTianXiaoXi, type GongJuDiaoYong, type GongJuGuiGe } from '@warmy/providers';
/** 契约 v1.1：编排 Schema（紧急度）/ 缓存三层顺序 / 任务黑板来源 —— 只 import，不另写 */
import type { Jinji, ShangxiawenXuanranCeng, HeiBanLaiYuan } from '@warmy/contracts';
import {
  RenWuHeiBan,
  heiBanGongJu,
  heiBanZhaiYao,
  heiBanDuChu,
  heiBanChongTu,
  chanWuChongDie,
  type HeiBanCunChu,
} from './hei-ban.js';
import { meiRenPeiE, zhengLiuXiaoJie, ZHENG_LIU_WEN_AN_MO_REN, type ZhengLiuWenAn } from './zheng-liu.js';
import { guJiToken } from './token-jiliang.js';

export interface ZhibanGongyingshangPeizhi {
  presetId: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  protocol?: string;
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
export function buildStatusCard(ka: StatusCard): string {
  const HangJi = [
    `[状态卡片] 群=${ka.groupId} 值班=${ka.dutyId} 队列=${ka.queueLength}`,
    `运行中: ${ka.runningTasks.slice(0, 5).join(' | ') || '无'}`,
    `最近: ${ka.recent.slice(0, 6).join(' / ')}`,
  ];
  const text = HangJi.join('\n');
  return text.length > 1800 ? text.slice(0, 1800) + '…' : text;
}

export interface XietiaoqiYilai {
  router: GroupChatRouter;
  board: KanbanCang;
  ccr: CcrGateway;
  history: Map<string, LiaoTianXiaoXi[]>;
  /** 知识库写入（可选） */
  addEvent?: (title: string, ti: string, groupId: string) => void;
  /** 取本机实例 ID 列表（含人设/思考级别/模型链/是否正在忙，供值班者按三轴派发） */
  listInstances: () => Array<{
    id: string; ming: string; status: string; dutyEligible: boolean;
    persona?: string; thinkLevel?: string; busy?: boolean; order?: number;
    /** 这只牛马自己的默认模型 + 调用链（只给值班者“挑谁”，值班者不能改它） */
    defaultModel?: string; chain?: string[]; chainDisabled?: string[]; smartMode?: boolean;
    /** 宿主按模型名估的强弱/快慢（1-5）与是否本地 */
    modelQiang?: number; modelKuai?: number; benDi?: boolean;
  }>;
  /**
   * 会话日志（只追加，ADR 002 / 不变量 #2）：由主进程提供同一份日志，值班者输入复用它渲染。
   * 缺省时退化为按 history 下标造 seq，仍然走同一个渲染器（不另写一份）。
   */
  logOf?: (key: string) => LogEntry[];
  /** 视图预算（字符）；缺省用 context-renderer 的默认预算 */
  /** 视图预算（字符）：模型 id 决定窗口，样本决定"这批文字折多少字符"（同一 token 预算下中文与代码的字符数必须不同） */
  contextBudgetChars?: (modelId?: string, yangBenWen?: string, instId?: string) => number;
  /**
   * 工具调用（ADR 002 §9.4 待办 2）：与 chat-send 共用同一套 recall/retrieve 工具与同一个循环。
   * 不给就等于"不暴露工具"（退回普通单轮对话）。
   */
  toolSpecs?: () => GongJuGuiGe[] | undefined;
  runTool?: (call: GongJuDiaoYong, ctx: { round: number; zuiDaJieGuoZiShu: number }) => Promise<string> | string;
  toolLimits?: (instId?: string) => { zuiDaLunShu: number; zuiDaJieGuoZiShu: number; totalChars: number };
  /** 审计出口（可选）：派发决策留痕 */
  audit?: (op: string, detail?: Record<string, unknown>) => void;
  /**
   * **用户已叫停这个项目**（第 100 轮）：停止按钮之后值班编排一步都不许再派；
   * 正在跑的执行者由主进程按 `onExecutorStart/End` 登记的 id 直接中止。
   */
  isStopped?: (groupId: string) => boolean;
  onExecutorStart?: (groupId: string, instanceId: string) => void;
  onExecutorEnd?: (groupId: string, instanceId: string) => void;
  /**
   * **执行者的干活工具**（write_file / open_path / run_shell / make_pptx …）。
   * 与 `toolSpecs`（值班者的记忆工具）分开：值班者负责编排，执行者负责真的动手。
   * 不给就退回"只说不做"的纯对话。
   */
  executorTools?: () => GongJuGuiGe[] | undefined;
  /** 某个执行者牛马自己的模型、人格与**模型归属的供应商**（没配就跟值班者同一套）；`nanYi` 只用于它自己的智能模式 */
  executorConfig?: (instanceId: string, nanYi?: { modelTier?: string; thinkLevel?: string; nan?: number; za?: number; ji?: number }) => Promise<{
    model?: string; persona?: string; presetId?: string; baseURL?: string; apiKey?: string; protocol?: string; timeoutMs?: number;
    /** 默认模型失败后按调用链顺序逐个尝试的候选（含各自的供应商） */
    candidates?: Array<{ model: string; presetId?: string; baseURL?: string; apiKey?: string; protocol?: string; timeoutMs?: number }>;
  } | undefined> | {
    model?: string; persona?: string; presetId?: string; baseURL?: string; apiKey?: string; protocol?: string; timeoutMs?: number;
    candidates?: Array<{ model: string; presetId?: string; baseURL?: string; apiKey?: string; protocol?: string; timeoutMs?: number }>;
  } | undefined;
  /**
   * 思考级别 → 该模型的请求附加参数（由主进程按模型能力映射）。
   * 值班者只能给「思考级别」，**不能给模型**；模型仍来自 executorConfig。
   */
  executorThink?: (instanceId: string, level: string, model: string) => Record<string, unknown> | undefined;
  /**
   * 值班者要求「停止」某只牛马正在跑的对话/任务时，宿主执行中断。
   * 返回是否真的停到了东西；没在跑就返回 false，不冒充执行过。
   */
  stopInstanceTask?: (instanceId: string) => boolean;
  /** 第 104 轮：把某只执行者当前的 AbortSignal 交出来（项目停止时真正掐断在途 HTTP）。 */
  executorSignal?: (instanceId: string) => AbortSignal | undefined;
  /**
   * 排队（P3）遇到目标正在忙时，等它当前对话/任务结束（最多 timeoutMs）。
   * 返回 true=已空闲；false=等超时（仍会派发，但审计如实记“没等到”）。
   */
  waitInstanceIdle?: (instanceId: string, timeoutMs: number) => Promise<boolean>;
  /** 项目 MEMORY（有界片段）；来自 group-store.project.memory，不来自 memory-os 流水 */
  projectMemory?: (groupId: string) => string;
  /** AI 求助选项卡的上下文片段 */
  decisionContext?: (groupId: string) => string;
  /** 门禁判停（仅 complete/验收指令时由主进程触发；此处可选回调） */
  runProjectGate?: (groupId: string, reason: string) => Promise<{ pass: boolean; summary: string } | null>;
  /**
   * 任务黑板的持久化（宿主：写记忆库 kind:'blackboard'，返回是否真的写进去了）。
   * 不给 = 只在本轮进程内存里（门禁 / 记忆服务不可用时），条目不带 retrieve 指针。
   */
  heiBanCun?: HeiBanCunChu;
  /** 宿主核实执行者声称的产物（在项目工作区里解析相对路径）；返回真实存在的绝对路径或空串 */
  heShiChanWu?: (groupId: string, lu: string) => string;
  /** 执行者结论超长时存完整原文（返回记忆库里的真 recordId；失败返回空串） */
  cunZhengLiuQuanWen?: (p: { groupId: string; renWuId: string; zxId: string; ming: string; wen: string }) => Promise<string>;
  /** 翻译（宿主传 tMain）：回复里用户可见的新文案走语言包；不给就用中文兜底 */
  t?: (key: string, fallback: string) => string;
  /** 第 121 轮：审批等待累计（毫秒）；执行者 duration 要扣掉它 */
  approvalWaitMs?: () => number;
}

export interface XietiaoJieguo {
  action: 'silent' | 'queue' | 'dispatch' | 'error' | 'stopped';
  reply: string;
  dutyId?: string;
  executorIds?: string[];
  boardEvent?: string;
  queueLength: number;
  usage?: { promptTokens: number; completionTokens: number; cacheHitTokens: number };
  /** 本轮任务黑板概况（门禁与界面用）：条目数、已落盘数、冲突数 */
  renWuHeiBan?: { renWuId: string; tiaoShu: number; yiLuoPan: number; chongTu: number };
  /** 每个执行者的蒸馏概况（结构化程度、核实过的产物、没找到的产物、是否截过、存档指针） */
  zhengLiu?: Array<{ ming: string; laiYuan?: string; artifacts: string[]; unverified: string[]; chaoChang: boolean; fullRecordId?: string; error?: string }>;
  /** 值班者派发计划（执行者/思考级别/插话方式；**不含模型**） */
  dispatchPlan?: PaiFaJiHua;
}

/* ───────────────────── 执行者派发（主路径与队列冲刷**共用这一份**） ───────────────────── */

/** 缺省的产物核实：只认存在的绝对路径（相对路径没有基准目录，宁可判"没找到"也不猜） */
function heShiJueDui(lu: string): string {
  try {
    const p = String(lu || '').trim();
    if (!p || !path.isAbsolute(p)) return '';
    return fs.existsSync(p) && fs.statSync(p).isFile() ? path.resolve(p) : '';
  } catch { return ''; }
}

/**
 * 执行者的马尔可夫毯（只放这个任务需要的）：状态卡片、项目记忆、决策上下文、用户原话（设闸）、3 条资产。
 * 主路径与队列冲刷共用 —— 以前队列冲刷那条路把用户原话整段塞进毯里，还不带身份与工具。
 */
function gouJianZhanBianXiang(deps: XietiaoqiYilai, groupId: string, content: string, ka: string): string[] {
  const memSnip = deps.projectMemory ? deps.projectMemory(groupId) : '';
  const decSnip = deps.decisionContext ? deps.decisionContext(groupId) : '';
  const yuan = String(content || '');
  /**
   * 原话的切口要给前缀与提示留位：切到"单条上限"整数位的话，加上「用户消息: 」与提示就超了单条闸，
   * 被毯的闸再截一刀 ⇒ 这句"去群日志取"的提示恰好被切掉（第 48 轮门禁抓到）。
   */
  const qieKou = ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN - 64;
  return [
    ka,
    ...(memSnip ? [memSnip] : []),
    ...(decSnip ? [decSnip] : []),
    /** 用户原话**不再整段进毯**（ADR000 P5 O(任务规模)；第 45 轮自查：10M 的原话以前照抄进执行者上下文） */
    `用户消息: ${yuan.slice(0, qieKou)}${yuan.length > qieKou ? '…（原话过长，未进毯的部分按序号回群日志取）' : ''}`,
    ...retrieveAssetsForChat({ scope: 'project', strict: false }).slice(0, 3).map((a) => a.ti.slice(0, 200)),
  ];
}

function jianZiOrch(s: string, n: number): string {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n) + '…' : x;
}

/** 用户这句话是不是在要求“停止/中断”某个执行者（P0 硬停的入口条件之一） */
function tingZhiYiTu(content: string): boolean {
  return /(停止|停下|停下来|中断|取消|别做|不要做|立刻停|马上停|stop|cancel|abort)/i.test(String(content || ''));
}

/**
 * 值班者派发计划：按**紧急度**（投递/插话）与**难易度**（挑人/思考级别）生成。
 * - 不用模型分类器，避免项目每句话多一次网络调用；用同一套可解释启发式（nan-yi-du）。
 * - 模型不在计划里出现；执行者模型由 executorConfig 按牛马自己的设置解析。
 */
function shengChengPaiFa(
  deps: XietiaoqiYilai,
  route: { decision?: { candidateIds?: string[]; executorIds?: string[]; assignments?: ZhiXingFenPei[] } },
  urgency: Jinji,
  content: string,
  opts?: { stopIntent?: boolean; urgeCount?: number },
): PaiFaJiHua {
  /** 定向 @：用户已点名，不替用户重选；思考跟随牛马设置，插话 none */
  if (route.decision?.assignments?.length) {
    const du = guSuanZhongYaoFuZa(content, urgency);
    return {
      urgency,
      difficulty: {
        nan: du.nan, za: du.za, ji: du.ji, importance: du.importance,
        modelTier: du.modelTier, thinkLevel: du.thinkLevel, combo: du.combo,
        nanBan: du.nanBan, zaBan: du.zaBan, jiBan: du.jiBan,
      },
      assignments: route.decision.assignments,
      modelLocked: true,
    };
  }
  const daQuan = deps.listInstances();
  /** 只从 router 给的**其他成员**候选池挑；值班者自己不在池里（没有候选时由值班者直接回答） */
  const ids = [...new Set(route.decision?.candidateIds || [])];
  const candidates = ids
    .map((id, i) => {
      const x = daQuan.find((v) => v.id === id);
      return {
        id,
        ming: x?.ming || id,
        status: x?.status || 'running',
        busy: !!x?.busy,
        persona: x?.persona,
        thinkLevel: x?.thinkLevel,
        order: typeof x?.order === 'number' ? x.order : i,
        models: [
          ...(x?.defaultModel ? [x.defaultModel] : []),
          ...(Array.isArray(x?.chain) ? x!.chain! : []),
        ],
        modelQiang: x?.modelQiang,
        modelKuai: x?.modelKuai,
        benDi: x?.benDi,
      };
    })
    .filter((x) => x.status !== 'dead' && x.status !== 'offline');
  const du = guSuanZhongYaoFuZa(content, urgency);
  /**
   * **值班者不能抢执行者的活**（第 99 轮硬口径）：
   * 用户明确要求值班者自己执行，才跳过派发；否则即使有候选也先派执行者。
   * 没有候选时 `assignments` 为空，调用方让值班者自己答（这是允许的第三种情况）。
   */
  const yaoQiuZiZuo = yongHuYaoQiuZhiBanZiZuo(content);
  if (yaoQiuZiZuo) {
    return {
      urgency,
      difficulty: {
        nan: du.nan, za: du.za, ji: du.ji, importance: du.importance,
        modelTier: du.modelTier, thinkLevel: du.thinkLevel, combo: du.combo,
        nanBan: du.nanBan, zaBan: du.zaBan, jiBan: du.jiBan,
      },
      assignments: [],
      modelLocked: true,
    };
  }
  return paiFaZhiXingZhe({
    urgency, content, difficulty: du, candidates,
    want: du.ji >= 5 ? 3 : 2,
    stopIntent: opts?.stopIntent,
    urgeCount: opts?.urgeCount,
  });
}

/** 执行插话纪律：停止是真的停；加急/插入立即派；排队等目标忙完再派（有上限，等不到也如实记） */
async function zhiXingChaHua(deps: XietiaoqiYilai, groupId: string, plan: PaiFaJiHua): Promise<void> {
  const daQuan = deps.listInstances();
  const yiTing = new Set<string>();
  for (const a of plan.assignments) {
    if (a.interrupt === 'none') continue;
    const inst = daQuan.find((x) => x.id === a.executorId);
    const busy = !!inst?.busy;
    let applied = false;
    let detail = '';
    let waitedMs = 0;
    if (a.interrupt === 'stop') {
      if (busy && !yiTing.has(a.executorId)) {
        yiTing.add(a.executorId);
        try { applied = deps.stopInstanceTask?.(a.executorId) === true; } catch { applied = false; }
        detail = applied ? '已停止它正在进行的对话/任务' : '没有在跑的任务可停（不冒充执行过）';
      } else if (!busy) {
        detail = '目标空闲，无需停止';
      }
    } else if (a.interrupt === 'urgent' || a.interrupt === 'insert') {
      applied = true;
      detail = busy ? '目标在忙，按值班者要求立即派发（不等待）' : '目标空闲，立即派发';
    } else if (a.interrupt === 'queue') {
      if (busy && deps.waitInstanceIdle) {
        const t0 = Date.now();
        try { applied = await deps.waitInstanceIdle(a.executorId, 30_000); } catch { applied = false; }
        waitedMs = Date.now() - t0;
        detail = applied ? `等目标当前任务结束（${waitedMs}ms）后派发` : `等待 ${waitedMs}ms 仍未空闲，按排队顺序派发`;
      } else {
        applied = true;
        detail = busy ? '目标在忙，排到本轮最后派发' : '目标空闲，按排队顺序派发';
      }
    }
    try { deps.audit?.('group.interrupt', { groupId, zxId: a.executorId, ming: a.ming, mode: a.interrupt, targetBusy: busy, applied, waitedMs, detail }); } catch { /* noop */ }
  }
}

/**
 * **派一轮执行者**：每个执行者带自己的身份/模型/工具，**共享同一块任务黑板**，交回**结构化蒸馏**；
 * 宿主把交付里的事实/决定/产物/问题补记上黑板（按执行者名义、去重），检测冲突，按公平配额拼回复。
 *
 * 取代的旧实现（第 45 轮以前）：结论 = 最后一段正文，多人拼起来从尾部一刀截到 3000 字，
 * 排后面的执行者结论整段消失，截断提示还写着"完整结论在各自的操作记录里"——而哪里都没存。
 */
async function paiFaZhiXingZheLun(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  p: { groupId: string; brief: string; contextItems: string[]; zhiXingQiJi?: string[]; fenPei?: ZhiXingFenPei[]; nanYi?: { modelTier?: string; thinkLevel?: string; nan?: number; za?: number; ji?: number }; yuanWenChars?: number },
): Promise<{ huiFu: string; heiBan: RenWuHeiBan; jieGuo: Array<{ zxId: string; ming: string; jg: zhixingqiJieguo }> }> {
  const t = deps.t || ((_k: string, d: string) => d);
  /** 派发计划：没有显式计划时按旧路径（执行者 / 自动思考 / 无插话）兜底 */
  const jiHuaFenPei: ZhiXingFenPei[] = (p.fenPei?.length
    ? p.fenPei
    : (p.zhiXingQiJi || []).map((id) => ({
        executorId: id,
        ming: deps.listInstances().find((x) => x.id === id)?.ming || id,
        thinkLevel: 'auto' as const,
        interrupt: 'none' as const,
        why: '未提供派发计划（兼容路径）',
      })))
    .slice()
    .sort((a, b) => paiFaXianHou(a) - paiFaXianHou(b));
  const zhiXingQiJi = [...new Set(jiHuaFenPei.map((a) => a.executorId))];
  const fenPeiOf = new Map(jiHuaFenPei.map((a) => [a.executorId, a]));
  const renWuId = 'rw-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const heiBan = new RenWuHeiBan(renWuId, p.groupId, deps.heiBanCun);
  const peiE = meiRenPeiE(zhiXingQiJi.length);
  const chengYuan = deps.listInstances();
  /** 干活工具 + 记忆双刀（recall/retrieve）：执行者也要能自己回忆历史，不只是值班者能 */
  const ganHuo = deps.executorTools?.() || [];
  const jiYi = (deps.toolSpecs?.() || []).filter((g) => !ganHuo.some((x) => x.function.name === g.function.name));
  const gongJuJi = [...ganHuo, ...jiYi];
  const heShi = (lu: string): string => (deps.heShiChanWu ? deps.heShiChanWu(p.groupId, lu) : heShiJueDui(lu));
  /**
   * **并行 / 接力（第 51 轮硬门禁）**：值班者派多个执行者前先判一次。
   * 写同一文件的 brief ⇒ 接力（按顺序 await）；纯分析 ⇒ 并行。
   * **有排队任务（P3）时也改接力**：加急/插入先干，排队的最后做，避免“说了排队却同时起跑”。
   */
  const paiFaBen = xuYaoJieLi(p.brief);
  const youPaiDui = jiHuaFenPei.some((a) => a.interrupt === 'queue');
  const paiFa = youPaiDui && jiHuaFenPei.length > 1
    ? { ...paiFaBen, fangShi: 'serial' as const, liYou: '有排队任务 ⇒ 加急/插入先干，排队的最后做' }
    : paiFaBen;
  try { deps.audit?.('orchestrator.dispatch-plan', { groupId: p.groupId, fangShi: paiFa.fangShi, chongTu: paiFa.chongTu, n: zhiXingQiJi.length, fenPei: jiHuaFenPei }); } catch { /* noop */ }
  /** 派给单个执行者（并行/接力共用同一段逻辑，避免两份漂移） */
  const paoYiGe = async (zxId: string, xu: number): Promise<{ zxId: string; ming: string; jg: zhixingqiJieguo }> => {
    const inst = chengYuan.find((x) => x.id === zxId);
    const ming = inst?.ming || zxId;
    /**
     * **用户已叫停这个项目 ⇒ 一个执行者都不许起跑**。
     * 返回一条明确的“已停止”结果，让上层照常收尾（不把停止伪装成执行失败）。
     */
    if (deps.isStopped?.(p.groupId)) {
      try { deps.audit?.('group.executor-stopped', { groupId: p.groupId, zxId }); } catch { /* noop */ }
      return {
        zxId, ming,
        jg: {
          taskId: '', distilled: '（已按用户要求停止，本执行者没有起跑）', artifacts: [],
          stats: { durationMs: 0, promptTokens: 0, completionTokens: 0 },
          error: { category: 'user-stop', message: 'stopped-by-user' } as never,
          chaoChang: false,
        },
      };
    }
    const fp = fenPeiOf.get(zxId) || { executorId: zxId, ming, thinkLevel: 'auto' as const, interrupt: 'none' as const, why: '' };
    const geRen = await deps.executorConfig?.(zxId, p.nanYi);
    /**
     * 每只牛马用自己的默认模型，**也用它模型归属的供应商**（baseURL / 密钥 / 协议）。
     * 以前只换 model、沿用全局供应商 ⇒ 跨供应商的默认模型会把请求发到错误的服务商（HTTP 400/401）。
     */
    const benCfg = {
      ...cfg,
      ...(geRen?.model ? { model: geRen.model } : {}),
      ...(geRen?.presetId ? { presetId: geRen.presetId } : {}),
      ...(geRen?.baseURL ? { baseURL: geRen.baseURL } : {}),
      ...(geRen?.apiKey ? { apiKey: geRen.apiKey } : {}),
      ...(geRen?.protocol ? { protocol: geRen.protocol } : {}),
      ...(geRen?.timeoutMs ? { timeoutMs: geRen.timeoutMs } : {}),
    };
    /** 来源**宿主盖章**：这个处理器只为这一个执行者服务，参数里自报的身份一律不读 */
    const laiYuan: HeiBanLaiYuan = { id: zxId, ming, jueSe: 'executor' };
    const qiShi = Date.now();
    const renwu = {
      taskId: `${renWuId}-${xu}`,
      brief: p.brief,
      contextItems: p.contextItems,
      yuanWenChars: p.yuanWenChars || 0,
      shenFen: { id: zxId, ming, persona: geRen?.persona },
      thinkLevel: fp.thinkLevel,
      tools: gongJuJi.length ? gongJuJi : undefined,
      runTool: deps.runTool,
      toolLimits: deps.toolLimits?.(zxId),
      approvalWaitMs: deps.approvalWaitMs,
      heiBan: {
        gongJu: heiBanGongJu(),
        zhaiYao: () => heiBanZhaiYao(heiBan.lie(), renWuId),
        zhiXing: async (call: GongJuDiaoYong) => {
          const gm = String(call?.function?.name || '');
          let can: Record<string, unknown> = {};
          try { can = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>; } catch { return `[${gm}] 参数不是合法的 JSON，没执行`; }
          if (gm === 'heiban_read') return heiBanDuChu(heiBan.lie(), can, renWuId);
          const r = await heiBan.xie(can, laiYuan);
          return r.ok
            ? `[heiban_write] 已写入 ${r.tiao.id}${r.tiao.yiLuoPan ? '（已存档，之后可 retrieve）' : '（本轮可见，但没能存档）'}`
            : `[heiban_write] 没写入：${r.cuo}`;
        },
      },
      heShiChanWu: heShi,
      onAudit: (op: string, detail?: Record<string, unknown>) => deps.audit?.(op, { ...(detail || {}), groupId: p.groupId }),
      cunQuanWen: deps.cunZhengLiuQuanWen
        ? (wen: string) => deps.cunZhengLiuQuanWen!({ groupId: p.groupId, renWuId, zxId, ming, wen })
        : undefined,
      signal: deps.executorSignal?.(zxId),
    };
    /**
     * 默认模型失败 ⇒ **严格按调用链顺序**逐个试（默认不在链里也先试默认）。
     * 每个候选带自己的供应商；只按模型去重，避免同一个模型换供应商重试两次。
     */
    const cands: Array<typeof benCfg> = [];
    const yiJian = new Set<string>();
    for (const c of [benCfg, ...(geRen?.candidates || []).map((x) => ({ ...benCfg, ...x }))]) {
      const k = String(c.model || '');
      if (!k || yiJian.has(k)) continue;
      yiJian.add(k);
      cands.push(c);
    }
    if (!cands.length) cands.push(benCfg);
    let usedCfg = cands[0]!;
    let attempts = 1;
    const thinkExtraOf = (c: typeof usedCfg): Record<string, unknown> | undefined => {
      if (fp.thinkLevel === 'auto') return undefined;
      try { return deps.executorThink?.(zxId, fp.thinkLevel, String(c.model || '')); } catch { return undefined; }
    };
    let jg: zhixingqiJieguo;
    deps.onExecutorStart?.(p.groupId, zxId);
    try {
      jg = await yunxingDuanCunhuoZhixingqi({ ...renwu, thinkExtra: thinkExtraOf(usedCfg) }, usedCfg);
      while (jg.error && attempts < cands.length) {
        /** 停止后不再换模型重试（与单聊同一条口径） */
        if (deps.isStopped?.(p.groupId)) break;
        usedCfg = cands[attempts]!;
        attempts += 1;
        jg = await yunxingDuanCunhuoZhixingqi({ ...renwu, thinkExtra: thinkExtraOf(usedCfg) }, usedCfg);
      }
    } finally {
      deps.onExecutorEnd?.(p.groupId, zxId);
    }
    try {
      deps.audit?.('group.executor-done', {
        groupId: p.groupId, zxId, ming, model: usedCfg.model || '', provider: usedCfg.presetId || '',
        attempts, thinkLevel: fp.thinkLevel, interrupt: fp.interrupt,
        ms: Date.now() - qiShi, error: jg.error ? `${jg.error.category}: ${jg.error.message}`.slice(0, 160) : '',
        artifacts: jg.artifacts.length, unverified: (jg.unverifiedArtifacts || []).length,
      });
    } catch { /* 留痕失败不影响结果 */ }
    return { zxId, ming, jg };
  };
  const jieGuo = paiFa.fangShi === 'serial'
    ? await (async () => {
        const out: Array<{ zxId: string; ming: string; jg: zhixingqiJieguo }> = [];
        for (let xu = 0; xu < zhiXingQiJi.length; xu++) out.push(await paoYiGe(zhiXingQiJi[xu]!, xu));
        return out;
      })()
    : await Promise.all(zhiXingQiJi.map((zxId, xu) => paoYiGe(zxId, xu)));

  /**
   * 宿主补记：交付里的事实/决定/产物/问题，执行者自己没往黑板写的，按它的名义补上（去重）。
   * 这样**黑板是这一轮的完整结论账**——回复里因配额舍掉的条目，在黑板（和记忆库）里仍然取得回。
   */
  for (const { zxId, ming, jg } of jieGuo) {
    const ly: HeiBanLaiYuan = { id: zxId, ming, jueSe: 'executor' };
    for (const s of jg.facts || []) await heiBan.buJi({ lei: 'fact', nei: s }, ly);
    for (const d of jg.decisions || []) await heiBan.buJi({ lei: 'decision', zhuTi: d.zhuTi, nei: d.nei }, ly);
    for (const lu of jg.artifacts) await heiBan.buJi({ lei: 'artifact', luJing: lu, nei: lu }, ly);
    for (const q of jg.questions || []) await heiBan.buJi({ lei: 'question', nei: q }, ly);
    for (const lu of jg.unverifiedArtifacts || []) {
      await heiBan.buJi({ lei: 'question', nei: `${ming} 说产出了 ${lu}，但宿主没找到这个文件` }, { id: 'host', ming: '宿主', jueSe: 'host' });
    }
  }
  const wenAn: ZhengLiuWenAn = {
    chanWu: t('group.worker.artifacts', ZHENG_LIU_WEN_AN_MO_REN.chanWu),
    weiZhaoDao: t('group.worker.unverified', ZHENG_LIU_WEN_AN_MO_REN.weiZhaoDao),
    daiJue: t('group.worker.questions', ZHENG_LIU_WEN_AN_MO_REN.daiJue),
    quanWenYiCun: t('group.worker.fullSaved', ZHENG_LIU_WEN_AN_MO_REN.quanWenYiCun),
    quanWenWeiCun: t('group.worker.fullNotSaved', ZHENG_LIU_WEN_AN_MO_REN.quanWenWeiCun),
  };
  /** 每个执行者一节，**公平配额**（N 人平分，每人不少于 400 字）—— 不再先到先得 */
  const youXiao = jieGuo.filter((x) => x.jg.distilled || x.jg.artifacts.length);
  let huiFu = youXiao.map((x) => zhengLiuXiaoJie(x.jg, x.ming, peiE, x.jg.chaoChang, wenAn)).join('\n\n');
  /** 全都失败也要如实说（带分类后的原因），不能静默返回空回复 */
  if (!youXiao.length) {
    const cuoJi = jieGuo.map((x) => `${x.ming}：${x.jg.error?.message || '无输出'}`).join('；');
    huiFu = t('group.worker.allFailed', '（派出的执行者都没有产出结果 —— {list}）').replace('{list}', () => cuoJi);
  }
  /** 冲突交值班者/用户裁决（同一主题、不同执行者、说法不同）：不替人选，只摆出来 */
  const ct = heiBanChongTu(heiBan.lie());
  if (ct.length) {
    huiFu += '\n\n' + t('group.board.conflictHead', '⚠ 执行者之间的决定有冲突（需要值班者或你裁决）：') + '\n'
      + ct.slice(0, 3).map((c) => `· 「${jianZiOrch(c.zhuTi, 30)}」` + c.ge.map((g) => `${g.ming}：${jianZiOrch(g.nei, 80)}`).join(' ／ ')).join('\n');
  }
  const cd = chanWuChongDie(heiBan.lie());
  if (cd.length) {
    huiFu += '\n' + cd.slice(0, 3).map((x) => t('group.board.overlap', '· {path} 被多位执行者写过：{list}（注意互相覆盖）')
      .replace('{path}', () => x.luJing).replace('{list}', () => x.ming.join('、'))).join('\n');
  }
  const tiao = heiBan.lie();
  if (tiao.length) {
    huiFu += '\n\n' + t('group.board.footer', '任务黑板 {id}：{n} 条（已存档 {m} 条，可用 recall / retrieve 取回）')
      .replace('{id}', () => renWuId).replace('{n}', () => String(tiao.length)).replace('{m}', () => String(tiao.filter((x) => x.yiLuoPan).length));
  }
  return { huiFu, heiBan, jieGuo };
}

/**
 * 第 121 轮：值班者的**唯一分身**。
 * 本体永远只做派发/汇总，绝不直接答活；需要它自己上时（无执行者、执行者全失败、用户点名），
 * 由这个子代理用值班者自己的模型/人格/工具在独立循环里执行。全局同一时间只允许一个。
 */
const DUTY_SUBAGENT_ID = '__duty_subagent__';
const dutyFenShenBusy = new Set<string>();

async function zhiXingDutyFenShen(
  deps: XietiaoqiYilai,
  args: {
    groupId: string;
    dutyId: string;
    dutyMing: string;
    dutyCfg: ZhibanGongyingshangPeizhi;
    dutyGeRen?: { persona?: string; model?: string; presetId?: string; baseURL?: string; apiKey?: string; protocol?: string; timeoutMs?: number };
    brief: string;
    contextItems: string[];
    nanYi?: { modelTier?: string; thinkLevel?: string; nan?: number; za?: number; ji?: number };
    yuanWenChars: number;
  },
): Promise<{ ok: true; lun: Awaited<ReturnType<typeof paiFaZhiXingZheLun>> } | { ok: false; busy?: boolean; error: string }> {
  const key = `${args.groupId}:${args.dutyId}`;
  if (dutyFenShenBusy.has(key)) return { ok: false, busy: true, error: 'duty-subagent-busy' };
  dutyFenShenBusy.add(key);
  const ming = `${args.dutyMing}·分身`;
  const subDeps: XietiaoqiYilai = {
    ...deps,
    listInstances: () => [
      ...deps.listInstances(),
      { id: DUTY_SUBAGENT_ID, ming, status: 'running', dutyEligible: false, persona: args.dutyGeRen?.persona, order: 9999 },
    ],
    executorConfig: (id, nan) => (id === DUTY_SUBAGENT_ID ? args.dutyGeRen : deps.executorConfig?.(id, nan)),
    executorThink: (id, level, model) => deps.executorThink?.(id === DUTY_SUBAGENT_ID ? args.dutyId : id, level, model),
    executorSignal: (id) => deps.executorSignal?.(id === DUTY_SUBAGENT_ID ? args.dutyId : id),
    onExecutorStart: (gid, id) => deps.onExecutorStart?.(gid, id === DUTY_SUBAGENT_ID ? args.dutyId : id),
    onExecutorEnd: (gid, id) => deps.onExecutorEnd?.(gid, id === DUTY_SUBAGENT_ID ? args.dutyId : id),
  };
  const qi = Date.now();
  try {
    const lun = await paiFaZhiXingZheLun(subDeps, args.dutyCfg, {
      groupId: args.groupId,
      brief: args.brief,
      contextItems: args.contextItems,
      zhiXingQiJi: [DUTY_SUBAGENT_ID],
      fenPei: [{ executorId: DUTY_SUBAGENT_ID, ming, thinkLevel: 'auto', interrupt: 'none', why: '值班者分身（本体不执行）' }],
      nanYi: args.nanYi,
      yuanWenChars: args.yuanWenChars,
    });
    try { deps.audit?.('group.duty-subagent-done', { groupId: args.groupId, dutyId: args.dutyId, ms: Date.now() - qi, ok: !lun.jieGuo.some((x) => !!x.jg.error) }); } catch { /* noop */ }
    return { ok: true, lun };
  } catch (e) {
    try { deps.audit?.('group.duty-subagent-failed', { groupId: args.groupId, dutyId: args.dutyId, error: String((e as Error)?.message || e).slice(0, 160) }); } catch { /* noop */ }
    return { ok: false, error: String((e as Error)?.message || e) };
  } finally {
    dutyFenShenBusy.delete(key);
  }
}

/** 回复里带出去的黑板/蒸馏概况（门禁与界面读它，不读正文措辞） */
function gaiKuangOf(r: { heiBan: RenWuHeiBan; jieGuo: Array<{ ming: string; jg: zhixingqiJieguo }> }): Pick<XietiaoJieguo, 'renWuHeiBan' | 'zhengLiu'> {
  const tiao = r.heiBan.lie();
  return {
    renWuHeiBan: { renWuId: r.heiBan.renWuId, tiaoShu: tiao.length, yiLuoPan: tiao.filter((x) => x.yiLuoPan).length, chongTu: heiBanChongTu(tiao).length },
    zhengLiu: r.jieGuo.map((x) => ({
      ming: x.ming,
      laiYuan: x.jg.laiYuan,
      artifacts: x.jg.artifacts,
      unverified: x.jg.unverifiedArtifacts || [],
      chaoChang: x.jg.chaoChang,
      ...(x.jg.fullRecordId ? { fullRecordId: x.jg.fullRecordId } : {}),
      ...(x.jg.error ? { error: `${x.jg.error.category}: ${x.jg.error.message}`.slice(0, 200) } : {}),
    })),
  };
}

/**
 * 契约「缓存三层顺序」：**冻结系统提示 → 有界历史视图 → 状态卡片（放最后）**。
 * 以前状态卡片拼在系统提示里，而它每轮都变（队列长度、最近几句）⇒ 系统提示每轮都不同，
 * 前缀缓存一次也命中不了。现在系统提示只放不随轮次变的东西，状态卡片作为最后一条 system 消息。
 */
export function sanCengXiaoXi(ceng: ShangxiawenXuanranCeng, shiTu: LiaoTianXiaoXi[]): LiaoTianXiaoXi[] {
  return [
    { role: 'system', content: ceng.inHistorySystemPrompt },
    ...shiTu,
    ...(ceng.statusCard ? [{ role: 'system', content: ceng.statusCard } as LiaoTianXiaoXi] : []),
  ];
}
/**
 * 完整闭环：路由 → 卡片 → 执行者 → 看板/知识库 → 蒸馏回复
 */
export async function xietiaoQunXiaoxi(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  xiaoXi: { groupId: string; userId?: string; content: string; urgency?: Jinji; mentionIds?: string[] }
): Promise<XietiaoJieguo> {
  const tr = deps.t || ((_k: string, d: string) => d);
  const urgency = xiaoXi.urgency || 'P2';
  /**
   * **叫停之后一步都不再派**（第 100 轮）：项目停止按钮同样要“马上停”，
   * 不能只是界面停止滚动、值班者继续挑人/派执行者。
   */
  if (deps.isStopped?.(xiaoXi.groupId)) {
    try { deps.audit?.('group.orchestrate-stopped', { groupId: xiaoXi.groupId }); } catch { /* noop */ }
    return { action: 'stopped', reply: '（已按你的要求停止。）', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
  }
  /**
   * **派活前先把成员状态同步成真实状态**（第 20 轮修）。
   *
   * 真机缺陷：`router.setStatus` 全仓**零调用** —— 成员 status 只在入群那一刻写死。
   * 后果有两个，都会让"多牛马协同"用不起来：
   *   ① 入群时还没 running 的牛马被钉成 `offline`，之后即使起来了也永远回不到 `idle`，
   *      `selectDuty` 永久排除它 ⇒ 最坏情况全群无人可值班，消息只排队不回复；
   *   ② 值班者干活时不转 busy、干完不转回 idle ⇒ "忙则顺延 +1" 永不生效。
   * 现在每次派活前按 `listInstances()` 的真实 status 刷新一遍：
   * running ⇒ idle（可被选中），其余 ⇒ offline。
   */
  try {
    for (const it of deps.listInstances()) {
      deps.router.setStatus(xiaoXi.groupId, it.id, it.status === 'running' ? 'idle' : 'offline');
    }
  } catch { /* 同步失败就按既有状态选，不拖垮本轮 */ }
  const route = deps.router.route({
    groupId: xiaoXi.groupId,
    userId: xiaoXi.userId || 'local-user',
    content: xiaoXi.content,
    urgency,
    mentionIds: xiaoXi.mentionIds || [],
    timestamp: Date.now(),
  });

  if (route.action === 'silent') {
    return { action: 'silent', reply: '', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
  }

  if (route.action === 'queue' || !route.duty) {
    /**
     * route() 在无空闲值班时**已经** enqueue 过（group-router.route 内部）。
     * 这里绝不能再次 enqueue —— 那会双写同一条消息。
     */
    const duilieChangdu = deps.router.listQueue(xiaoXi.groupId).length;
    return {
      action: 'queue',
      reply: `[排队] 队列长度 ${duilieChangdu}`,
      queueLength: duilieChangdu,
    };
  }

  const duty = route.duty;
  const paiFaJiHua = shengChengPaiFa(deps, route, urgency, xiaoXi.content, { stopIntent: tingZhiYiTu(xiaoXi.content) });
  /** 用户明确禁止值班者自己执行 ⇒ 即使执行者全失败也不兜底（第 102 轮） */
  const jinZhiZhiBanZiZuo = yongHuJinZhiZhiBanZiZuo(xiaoXi.content);
  let zhiXingQiJi = paiFaJiHua.assignments
    .map((a) => a.executorId)
    .filter((id) => id !== duty.id || !duty.pureDispatcher);
  await zhiXingChaHua(deps, xiaoXi.groupId, paiFaJiHua);
  /**
   * 值班者自答也用它**自己的**模型设置（没有配置时回落到群/全局 cfg）。
   * 执行者仍然各自解析自己的模型；这里只影响值班者自己开口的那条路径。
   */
  const dutyGeRen = await deps.executorConfig?.(duty.id, paiFaJiHua.difficulty);
  const dutyCfg = {
    ...cfg,
    ...(dutyGeRen?.model ? { model: dutyGeRen.model } : {}),
    ...(dutyGeRen?.presetId ? { presetId: dutyGeRen.presetId } : {}),
    ...(dutyGeRen?.baseURL ? { baseURL: dutyGeRen.baseURL } : {}),
    ...(dutyGeRen?.apiKey ? { apiKey: dutyGeRen.apiKey } : {}),
    ...(dutyGeRen?.protocol ? { protocol: dutyGeRen.protocol } : {}),
    ...(dutyGeRen?.timeoutMs ? { timeoutMs: dutyGeRen.timeoutMs } : {}),
  };
  try { deps.audit?.('group.duty-config', { groupId: xiaoXi.groupId, dutyId: duty.id, model: dutyCfg.model || '', provider: dutyCfg.presetId || '', fromInstance: !!dutyGeRen?.model }); } catch { /* noop */ }
  const queueLen = deps.router.listQueue(xiaoXi.groupId).length;
  /**
   * 值班者 + 执行者**干活期间标 busy**：下一条消息进来时 `selectDuty` 才会顺延到别的空闲牛马，
   * 而不是永远落在序号最小那只身上。结束时（含出错）在 `finally` 里统一放回 idle。
   */
  const mangLu = [duty.id, ...zhiXingQiJi];
  for (const id of mangLu) { try { deps.router.setStatus(xiaoXi.groupId, id, 'busy'); } catch { /* noop */ } }
  try {

  // 状态卡片：有日志时以日志为准（不变量 #5：日志是唯一事实来源），否则退回历史镜像
  const logEntries: LogEntry[] | null = deps.logOf ? deps.logOf(xiaoXi.groupId) : null;
  const ka = buildStatusCard({
    groupId: xiaoXi.groupId,
    dutyId: duty.id,
    queueLength: queueLen,
    runningTasks: zhiXingQiJi.map((id) => deps.listInstances().find((x) => x.id === id)?.ming || id),
    recent: (logEntries ?? (deps.history.get(xiaoXi.groupId) || []))
      .slice(-6)
      .map((m) => String(m.content ?? '').slice(0, 40)),
    tokenBudget: 2000,
  });

  // CCR 压缩用户输入
  const yiYaSuo = deps.ccr.beforeLog({ kind: 'message', content: xiaoXi.content });

  // 值班者历史：有 logOf 时**不写** history —— 那份日志由主进程 appendChatLog 统一维护，
  // 这里再 push 一份就是第二份真相（重启后与 JSONL 脱节）。
  const liShi = deps.history.get(xiaoXi.groupId) || [];
  if (!deps.logOf) {
    liShi.push({ role: 'user', content: yiYaSuo.content });
    deps.history.set(xiaoXi.groupId, liShi);
  }

  // 看板解析（仅 duty）
  let boardEvent: string | undefined;
  let gateReason: string | null = null;
  const parsed = JieLing(xiaoXi.content, xiaoXi.groupId);
  if (parsed) {
    try {
      const Shi = deps.board.append(parsed, 'duty');
      boardEvent = `${parsed.action}:${parsed.biaoTi}`;
      deps.addEvent?.(parsed.biaoTi, xiaoXi.content, xiaoXi.groupId);
      if (parsed.action === 'complete_task') gateReason = 'complete_task';
    } catch {
      /* ignore */
    }
  }
  if (/(?:验收|门禁|verify|gate|read-?back)/i.test(xiaoXi.content)) {
    gateReason = gateReason || 'user-verify';
  }

  // 派发执行者：优先用短命执行者，失败则值班者自己答
  let distilled = '';
  let usage: XietiaoJieguo['usage'];
  let gaiKuang: Pick<XietiaoJieguo, 'renWuHeiBan' | 'zhengLiu'> = {};
  const brief = route.decision?.taskBrief || xiaoXi.content;
  let fenShenReason: 'no-executor' | 'all-failed' = 'no-executor';
  const memSnip = deps.projectMemory ? deps.projectMemory(xiaoXi.groupId) : '';
  const decSnip = deps.decisionContext ? deps.decisionContext(xiaoXi.groupId) : '';
  /** 马尔可夫毯：主路径与队列冲刷共用同一个构造（gouJianZhanBianXiang），不再各写一份 */
  const contextItems = gouJianZhanBianXiang(deps, xiaoXi.groupId, xiaoXi.content, ka);

  if (dutyCfg.apiKey || dutyCfg.protocol === 'ollama' || dutyCfg.presetId === 'ollama' || String(dutyCfg.presetId || '').startsWith('ollama-')) {
    // 执行者（短命）
    if (zhiXingQiJi.length) {
      /**
       * **逐个派给真实的牛马**（第 20 轮修）+ **共享任务黑板 + 结构化蒸馏**（第 48 轮）：
       * 每个执行者带自己的身份（名字+人格）与模型、拿到和单聊一样的干活工具（外加记忆双刀），
       * 并行跑、共用同一块任务黑板，交回结构化结论；宿主补记黑板、查冲突、按公平配额汇总回群。
       */
      const lun = await paiFaZhiXingZheLun(deps, dutyCfg, {
        groupId: xiaoXi.groupId,
        brief,
        contextItems,
        zhiXingQiJi,
        fenPei: paiFaJiHua.assignments,
        nanYi: paiFaJiHua.difficulty,
        yuanWenChars: xiaoXi.content.length,
      });
      /** 跑完这一批才发现被叫停 ⇒ 不汇总、不继续派值班者兜底 */
      if (deps.isStopped?.(xiaoXi.groupId)) {
        try { deps.audit?.('group.stopped-after-executors', { groupId: xiaoXi.groupId }); } catch { /* noop */ }
        return { action: 'stopped', reply: '（已按你的要求停止。）', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
      }
      /**
       * **值班者不能抢活，但可以在执行者明确失败后兜底**（第 99 轮门槛 + 第 102 轮全失败兜底）：
       * 全部执行者都报错时，值班者不再看置信度，直接兜底；
       * 但用户明确禁止值班者自己执行时，仍然不兜底，保留全失败说明。
       */
      const quanBai = lun.jieGuo.length > 0 && lun.jieGuo.every((x) => !!x.jg.error);
      if (quanBai) {
        const dutyConf = paiFaJiHua.difficulty.nan >= 4 ? 0.55 : 0.4;
        const ziXing = zhiBanKeZiXing({
          hasExecutor: true, allExecutorsFailed: true, userForbidden: jinZhiZhiBanZiZuo,
          executorConfidence: 0.7, dutyConfidence: dutyConf,
        });
        try { deps.audit?.('group.duty-self', { groupId: xiaoXi.groupId, quanBai, dutyConf, userForbidden: jinZhiZhiBanZiZuo, ok: ziXing.ok, why: ziXing.why }); } catch { /* noop */ }
        if (ziXing.ok) { zhiXingQiJi = []; fenShenReason = 'all-failed'; }
      }
      if (zhiXingQiJi.length) {
        distilled = lun.huiFu;
        gaiKuang = gaiKuangOf(lun);
      }
    }
    if (!zhiXingQiJi.length) {
      /**
       * 第 121 轮硬口径：**值班者本体绝不直接答活**。
       * 无执行者 / 执行者全失败 / 用户点名值班者时，只能派出自己的**唯一分身**去干；
       * 分身用值班者的模型、人格和干活工具，在独立执行循环里跑，本体只汇总。
       * 用户明确禁止值班者执行时，连分身也不派，如实说明无人可执行。
       */
      if (jinZhiZhiBanZiZuo) {
        distilled = tr('group.duty.forbidden', '（没有可用的执行者；按你的要求，值班者本体和分身都不执行。）');
      } else {
        try { deps.audit?.('group.duty-subagent-start', { groupId: xiaoXi.groupId, dutyId: duty.id, reason: fenShenReason }); } catch { /* noop */ }
        const fsr = await zhiXingDutyFenShen(deps, {
          groupId: xiaoXi.groupId,
          dutyId: duty.id,
          dutyMing: duty.ming,
          dutyCfg,
          dutyGeRen,
          brief,
          contextItems,
          nanYi: paiFaJiHua.difficulty,
          yuanWenChars: xiaoXi.content.length,
        });
        if (!fsr.ok) {
          distilled = fsr.busy
            ? tr('group.duty.subagentBusy', '（值班者的分身正在执行上一条任务；同一时间只允许 1 个分身，本条未重复派出。）')
            : tr('group.duty.subagentFailed', '（值班者分身执行失败：{err}）').replace('{err}', () => String(fsr.error).slice(0, 200));
        } else {
          if (deps.isStopped?.(xiaoXi.groupId)) {
            return { action: 'stopped', reply: '（已按你的要求停止。）', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
          }
          distilled = fsr.lun.huiFu;
          gaiKuang = gaiKuangOf(fsr.lun);
          const u = fsr.lun.jieGuo.reduce((n, x) => {
            n.promptTokens += Number(x.jg.stats?.promptTokens) || 0;
            n.completionTokens += Number(x.jg.stats?.completionTokens) || 0;
            return n;
          }, { promptTokens: 0, completionTokens: 0 });
          if (u.promptTokens || u.completionTokens) usage = { ...u, cacheHitTokens: 0 };
        }
      }
    }
  } else {
    distilled = `[未配置 Key] 值班=${duty.ming} 执行者=${zhiXingQiJi.join(',') || '无'} 卡片已生成`;
  }

  if (!deps.logOf) {
    liShi.push({ role: 'assistant', content: distilled });
    deps.history.set(xiaoXi.groupId, liShi);
  }

  /**
   * 冲刷队列：complete 只把值班置 idle；**真正弹出**走 dequeueNext，
   * 且弹出后必须真的处理 —— 处理不了就 requeue，绝不静默丢弃（旧实现的 bug）。
   * 深度上限防止同一条故障消息无限循环。
   *
   * 冲刷之前**先把本轮成员放回 idle**（第 48 轮修的真缺陷）：冲刷在 finally 之前跑，
   * 以前这时值班者与执行者都还标着 busy ⇒ 冲刷里的 route() 选不出值班 ⇒ 排队项被重新入队、
   * 立刻 break —— 群成员 ≤ 4 时，排队的消息**永远轮不到处理**。
   */
  fangHuiKongXian(deps, xiaoXi.groupId, mangLu);
  deps.router.complete(xiaoXi.groupId);
  let paidiaoShendu = 0;
  const DRAIN_MAX = 5;
  let extraReplies: string[] = [];
  while (paidiaoShendu < DRAIN_MAX) {
    paidiaoShendu += 1;
    const next = deps.router.dequeueNext(xiaoXi.groupId);
    if (!next) break;
    try {
      const xiayiJieguo = await runOneDutyRound(deps, cfg, {
        groupId: next.request.groupId || xiaoXi.groupId,
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
      deps.router.complete(xiaoXi.groupId);
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
      const g = await deps.runProjectGate(xiaoXi.groupId, gateReason);
      if (g) menjinHang = g.pass ? `\n[门禁] 通过 · ${g.summary}` : `\n[门禁] 未通过 · ${g.summary}`;
    } catch (e) {
      menjinHang = `\n[门禁] 执行失败 · ${String((e as Error)?.message || e).slice(0, 120)}`;
    }
  }

  return {
    action: 'dispatch',
    reply: (extraReplies.length ? `${distilled}\n\n[队列冲刷]\n${extraReplies.join('\n---\n')}` : distilled) + menjinHang,
    dutyId: duty.id,
    executorIds: zhiXingQiJi,
    boardEvent,
    queueLength: deps.router.listQueue(xiaoXi.groupId).length,
    usage,
    dispatchPlan: paiFaJiHua,
    ...gaiKuang,
  };
  } finally {
    /**
     * **无论成功、排队还是抛错，都要把 busy 放回 idle**。
     * 漏放一次，这只牛马之后就再也不会被 `selectDuty` 选中（真机表现：项目忽然没人回话）。
     */
    fangHuiKongXian(deps, xiaoXi.groupId, mangLu);
  }
}

/** 把本轮标 busy 的成员放回 idle：只放回**当前仍在运行**的实例，已经停掉的交给下一轮的真实状态同步去判 */
function fangHuiKongXian(deps: XietiaoqiYilai, groupId: string, mangLu: readonly string[]): void {
  try {
    const huo = new Set(deps.listInstances().filter((x) => x.status === 'running').map((x) => x.id));
    for (const id of mangLu) {
      if (huo.has(id)) deps.router.setStatus(groupId, id, 'idle');
    }
  } catch { /* noop */ }
}

/** 队列冲刷用的一轮：与主路径同一套卡片/工具预算，但不再递归冲刷自己的队列 */
async function runOneDutyRound(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  xiaoXi: { groupId: string; userId: string; content: string; urgency: Jinji; mentionIds: string[] }
): Promise<XietiaoJieguo> {
  const tr = deps.t || ((_k: string, d: string) => d);
  const route = deps.router.route({
    groupId: xiaoXi.groupId,
    userId: xiaoXi.userId,
    content: xiaoXi.content,
    urgency: xiaoXi.urgency,
    mentionIds: xiaoXi.mentionIds,
    timestamp: Date.now(),
  });
  if (route.action === 'silent' || !route.duty) {
    // 冲刷时又没值班了：放回队列（由 requeue 的调用方处理 —— 这里返回空让上层 requeue）
    if (route.action === 'queue' || !route.duty) {
      // route 可能已再次入队；若没有 duty 则上层 catch/requeue
      if (!route.duty && route.action !== 'queue') {
        return { action: 'queue', reply: '', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
      }
    }
    return { action: 'silent', reply: '', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
  }
  const duty = route.duty;
  const paiFaJiHua = shengChengPaiFa(deps, route, xiaoXi.urgency, xiaoXi.content, { stopIntent: tingZhiYiTu(xiaoXi.content) });
  /** 用户明确禁止值班者自己执行 ⇒ 即使执行者全失败也不兜底（第 102 轮） */
  const jinZhiZhiBanZiZuo = yongHuJinZhiZhiBanZiZuo(xiaoXi.content);
  let zhiXingQiJi = paiFaJiHua.assignments
    .map((a) => a.executorId)
    .filter((id) => id !== duty.id || !duty.pureDispatcher);
  await zhiXingChaHua(deps, xiaoXi.groupId, paiFaJiHua);
  const dutyGeRen = await deps.executorConfig?.(duty.id, paiFaJiHua.difficulty);
  const dutyCfg = {
    ...cfg,
    ...(dutyGeRen?.model ? { model: dutyGeRen.model } : {}),
    ...(dutyGeRen?.presetId ? { presetId: dutyGeRen.presetId } : {}),
    ...(dutyGeRen?.baseURL ? { baseURL: dutyGeRen.baseURL } : {}),
    ...(dutyGeRen?.apiKey ? { apiKey: dutyGeRen.apiKey } : {}),
    ...(dutyGeRen?.protocol ? { protocol: dutyGeRen.protocol } : {}),
    ...(dutyGeRen?.timeoutMs ? { timeoutMs: dutyGeRen.timeoutMs } : {}),
  };
  try { deps.audit?.('group.duty-config', { groupId: xiaoXi.groupId, dutyId: duty.id, model: dutyCfg.model || '', provider: dutyCfg.presetId || '', fromInstance: !!dutyGeRen?.model }); } catch { /* noop */ }
  const logEntries: LogEntry[] | null = deps.logOf ? deps.logOf(xiaoXi.groupId) : null;
  const ka = buildStatusCard({
    groupId: xiaoXi.groupId,
    dutyId: duty.id,
    queueLength: deps.router.listQueue(xiaoXi.groupId).length,
    runningTasks: zhiXingQiJi.map((id) => deps.listInstances().find((x) => x.id === id)?.ming || id),
    recent: (logEntries ?? (deps.history.get(xiaoXi.groupId) || []))
      .slice(-6)
      .map((m) => String(m.content ?? '').slice(0, 40)),
    tokenBudget: 2000,
  });
  let distilled = '';
  let usage: XietiaoJieguo['usage'];
  let gaiKuang: Pick<XietiaoJieguo, 'renWuHeiBan' | 'zhengLiu'> = {};
  const brief = route.decision?.taskBrief || xiaoXi.content;
  let fenShenReason: 'no-executor' | 'all-failed' = 'no-executor';
  if (dutyCfg.apiKey || dutyCfg.protocol === 'ollama' || dutyCfg.presetId === 'ollama' || String(dutyCfg.presetId || '').startsWith('ollama-')) {
    if (zhiXingQiJi.length) {
      /**
       * 队列冲刷与主路径**同一套执行者协议**（第 48 轮修的真缺陷）：这里以前只派**一个**执行者、
       * 用全局配置、不带身份与工具、用户原话整段进毯、结论不设闸 —— 主路径第 20 轮修掉的
       * "多牛马只是同一个模型多答一句"在这条路上一直还在。
       */
      const lun = await paiFaZhiXingZheLun(deps, dutyCfg, {
        groupId: xiaoXi.groupId,
        brief,
        contextItems: gouJianZhanBianXiang(deps, xiaoXi.groupId, xiaoXi.content, ka),
        zhiXingQiJi,
        fenPei: paiFaJiHua.assignments,
        nanYi: paiFaJiHua.difficulty,
        yuanWenChars: xiaoXi.content.length,
      });
      /** 跑完这一批才发现被叫停 ⇒ 不汇总、不继续派值班者兜底 */
      if (deps.isStopped?.(xiaoXi.groupId)) {
        try { deps.audit?.('group.stopped-after-executors', { groupId: xiaoXi.groupId }); } catch { /* noop */ }
        return { action: 'stopped', reply: '（已按你的要求停止。）', queueLength: deps.router.listQueue(xiaoXi.groupId).length };
      }
      const quanBai = lun.jieGuo.length > 0 && lun.jieGuo.every((x) => !!x.jg.error);
      if (quanBai) {
        const dutyConf = paiFaJiHua.difficulty.nan >= 4 ? 0.55 : 0.4;
        const ziXing = zhiBanKeZiXing({
          hasExecutor: true, allExecutorsFailed: true, userForbidden: jinZhiZhiBanZiZuo,
          executorConfidence: 0.7, dutyConfidence: dutyConf,
        });
        try { deps.audit?.('group.duty-self', { groupId: xiaoXi.groupId, quanBai, dutyConf, userForbidden: jinZhiZhiBanZiZuo, ok: ziXing.ok, why: ziXing.why }); } catch { /* noop */ }
        if (ziXing.ok) { zhiXingQiJi = []; fenShenReason = 'all-failed'; }
      }
      if (zhiXingQiJi.length) {
        distilled = lun.huiFu;
        gaiKuang = gaiKuangOf(lun);
      }
    }
    if (!zhiXingQiJi.length) {
      /** 队列冲刷同样：本体不执行，只派唯一分身（与主路径同一口径） */
      if (jinZhiZhiBanZiZuo) {
        distilled = tr('group.duty.forbidden', '（没有可用的执行者；按你的要求，值班者本体和分身都不执行。）');
      } else {
        try { deps.audit?.('group.duty-subagent-start', { groupId: xiaoXi.groupId, dutyId: duty.id, reason: fenShenReason, via: 'queue-drain' }); } catch { /* noop */ }
        const fsr = await zhiXingDutyFenShen(deps, {
          groupId: xiaoXi.groupId,
          dutyId: duty.id,
          dutyMing: duty.ming,
          dutyCfg,
          dutyGeRen,
          brief,
          contextItems: gouJianZhanBianXiang(deps, xiaoXi.groupId, xiaoXi.content, ka),
          nanYi: paiFaJiHua.difficulty,
          yuanWenChars: xiaoXi.content.length,
        });
        if (!fsr.ok) {
          distilled = fsr.busy
            ? tr('group.duty.subagentBusy', '（值班者的分身正在执行上一条任务；同一时间只允许 1 个分身，本条未重复派出。）')
            : tr('group.duty.subagentFailed', '（值班者分身执行失败：{err}）').replace('{err}', () => String(fsr.error).slice(0, 200));
        } else {
          distilled = fsr.lun.huiFu;
          gaiKuang = gaiKuangOf(fsr.lun);
          const u = fsr.lun.jieGuo.reduce((n, x) => {
            n.promptTokens += Number(x.jg.stats?.promptTokens) || 0;
            n.completionTokens += Number(x.jg.stats?.completionTokens) || 0;
            return n;
          }, { promptTokens: 0, completionTokens: 0 });
          if (u.promptTokens || u.completionTokens) usage = { ...u, cacheHitTokens: 0 };
        }
      }
    }
  } else {
    distilled = `[未配置 Key] 队列项已处理 duty=${duty.ming}`;
  }
  return {
    action: 'dispatch',
    reply: distilled,
    dutyId: duty.id,
    executorIds: zhiXingQiJi,
    queueLength: deps.router.listQueue(xiaoXi.groupId).length,
    usage,
    dispatchPlan: paiFaJiHua,
    ...gaiKuang,
  };
}
