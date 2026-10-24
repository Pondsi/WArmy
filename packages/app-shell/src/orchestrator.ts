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
import { ZHAN_BEN_DAN_TIAO_ZI_SHANG_XIAN } from './executor.js';
import { CcrGateway } from '@warmy/ccr-compressor';
import {
  xuanranYoujieShitu,
  DEFAULT_CONTEXT_BUDGET_CHARS,
  DEFAULT_KEEP_HEAD,
  DEFAULT_KEEP_TAIL,
  type LogEntry,
} from './context-renderer.js';
import { retrieveAssetsForChat, zhuCeLiaoTianZiChan } from './asset-wire.js';
import { liaoTianDaiGongJu, neiRongWenBen, type LiaoTianXiaoXi, type GongJuDiaoYong, type GongJuGuiGe } from '@warmy/providers';
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

/** 预算折算用的文字构成样本：头 12 条 + 尾 24 条，截 6 万字符（只取样，不全量遍历） */
function yangBenLiuShu(entries: LogEntry[]): string {
  const z = Array.isArray(entries) ? entries : [];
  const tou = z.slice(0, 12).map((e) => String(e?.content || ''));
  const wei = z.length > 12 ? z.slice(-24).map((e) => String(e?.content || '')) : [];
  return [...tou, ...wei].join('\n').slice(0, 60000);
}

export interface XietiaoqiYilai {
  router: GroupChatRouter;
  board: KanbanCang;
  ccr: CcrGateway;
  history: Map<string, LiaoTianXiaoXi[]>;
  /** 知识库写入（可选） */
  addEvent?: (title: string, ti: string, groupId: string) => void;
  /** 取本机实例 ID 列表 */
  listInstances: () => Array<{ id: string; ming: string; status: string; dutyEligible: boolean }>;
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
   * **执行者的干活工具**（write_file / open_path / run_shell / make_pptx …）。
   * 与 `toolSpecs`（值班者的记忆工具）分开：值班者负责编排，执行者负责真的动手。
   * 不给就退回"只说不做"的纯对话。
   */
  executorTools?: () => GongJuGuiGe[] | undefined;
  /** 某个执行者牛马自己的模型与人格（没配就跟值班者同一套） */
  executorConfig?: (instanceId: string) => { model?: string; persona?: string } | undefined;
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
}

export interface XietiaoJieguo {
  action: 'silent' | 'queue' | 'dispatch' | 'error';
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
  p: { groupId: string; brief: string; contextItems: string[]; zhiXingQiJi: string[] },
): Promise<{ huiFu: string; heiBan: RenWuHeiBan; jieGuo: Array<{ zxId: string; ming: string; jg: zhixingqiJieguo }> }> {
  const t = deps.t || ((_k: string, d: string) => d);
  const { zhiXingQiJi } = p;
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
   */
  const paiFa = xuYaoJieLi(p.brief);
  try { deps.audit?.('orchestrator.dispatch-plan', { groupId: p.groupId, fangShi: paiFa.fangShi, chongTu: paiFa.chongTu, n: zhiXingQiJi.length }); } catch { /* noop */ }
  /** 派给单个执行者（并行/接力共用同一段逻辑，避免两份漂移） */
  const paoYiGe = async (zxId: string, xu: number): Promise<{ zxId: string; ming: string; jg: zhixingqiJieguo }> => {
    const inst = chengYuan.find((x) => x.id === zxId);
    const ming = inst?.ming || zxId;
    const geRen = deps.executorConfig?.(zxId);
    const benCfg = { ...cfg, ...(geRen?.model ? { model: geRen.model } : {}) };
    /** 来源**宿主盖章**：这个处理器只为这一个执行者服务，参数里自报的身份一律不读 */
    const laiYuan: HeiBanLaiYuan = { id: zxId, ming, jueSe: 'executor' };
    const jg = await yunxingDuanCunhuoZhixingqi({
      taskId: `${renWuId}-${xu}`,
      brief: p.brief,
      contextItems: p.contextItems,
      shenFen: { id: zxId, ming, persona: geRen?.persona },
      tools: gongJuJi.length ? gongJuJi : undefined,
      runTool: deps.runTool,
      toolLimits: deps.toolLimits?.(zxId),
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
      cunQuanWen: deps.cunZhengLiuQuanWen
        ? (wen: string) => deps.cunZhengLiuQuanWen!({ groupId: p.groupId, renWuId, zxId, ming, wen })
        : undefined,
    }, benCfg);
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
function gouJianSanCeng(xiTong: string, shiTu: LiaoTianXiaoXi[], ka: string): ShangxiawenXuanranCeng {
  const liShiWen = shiTu.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  return {
    inHistorySystemPrompt: xiTong,
    appendedHistoryView: liShiWen,
    statusCard: ka,
    totalBudgetTokens: guJiToken(xiTong) + guJiToken(liShiWen) + guJiToken(ka),
  };
}

/**
 * 完整闭环：路由 → 卡片 → 执行者 → 看板/知识库 → 蒸馏回复
 */
export async function xietiaoQunXiaoxi(
  deps: XietiaoqiYilai,
  cfg: ZhibanGongyingshangPeizhi,
  xiaoXi: { groupId: string; userId?: string; content: string; urgency?: Jinji; mentionIds?: string[] }
): Promise<XietiaoJieguo> {
  const urgency = xiaoXi.urgency || 'P2';
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
  const zhiXingQiJi = (route.decision?.executorIds || []).filter((id) => id !== duty.id);
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
  const memSnip = deps.projectMemory ? deps.projectMemory(xiaoXi.groupId) : '';
  const decSnip = deps.decisionContext ? deps.decisionContext(xiaoXi.groupId) : '';
  /** 马尔可夫毯：主路径与队列冲刷共用同一个构造（gouJianZhanBianXiang），不再各写一份 */
  const contextItems = gouJianZhanBianXiang(deps, xiaoXi.groupId, xiaoXi.content, ka);

  if (cfg.apiKey || cfg.protocol === 'ollama' || cfg.presetId === 'ollama' || String(cfg.presetId || '').startsWith('ollama-')) {
    // 执行者（短命）
    if (zhiXingQiJi.length) {
      /**
       * **逐个派给真实的牛马**（第 20 轮修）+ **共享任务黑板 + 结构化蒸馏**（第 48 轮）：
       * 每个执行者带自己的身份（名字+人格）与模型、拿到和单聊一样的干活工具（外加记忆双刀），
       * 并行跑、共用同一块任务黑板，交回结构化结论；宿主补记黑板、查冲突、按公平配额汇总回群。
       */
      const lun = await paiFaZhiXingZheLun(deps, cfg, { groupId: xiaoXi.groupId, brief, contextItems, zhiXingQiJi });
      distilled = lun.huiFu;
      gaiKuang = gaiKuangOf(lun);
    } else {
      // 无空闲执行者 → 值班者自己（带卡片）
      const { congYuSheChuangJian } = await import('@warmy/providers');
      const provider = congYuSheChuangJian(cfg.presetId, {
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL || undefined,
        protocol: cfg.protocol,
      } as never, cfg.protocol as never);
      /**
       * 契约「缓存三层顺序」：系统提示只放**不随轮次变**的东西（身份 + 项目记忆 + 纪律），
       * 状态卡片与决策上下文每轮都变 ⇒ 放到历史视图之后（最后一条 system），系统提示前缀才能被缓存命中。
       */
      const dongJieXiTong =
        `你是 WArmy 项目「${xiaoXi.groupId}」的值班者。\n` +
        (memSnip ? memSnip + '\n' : '') +
        `请用简短中文回复。若需更新任务，使用指令：新建任务:/完成/进度 标题:百分比\n` +
        `任务树：新建任务 父任务 / 子任务；需要人类点选时可用工具 askUser（永远含「其他」自定义）。`;
      // 不变量 #2：值班者输入复用**同一个**有界渲染器（原来这里是 hist.slice(-12)，只按条数有界）。
      // 会话部分恒 ≤ 预算且与日志总长解耦。
      const entries: LogEntry[] = deps.logOf
        ? deps.logOf(xiaoXi.groupId)
        : liShi.map((m, i) => ({
            seq: i + 1,
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as LogEntry['role'],
            content: typeof m.content === 'string' ? m.content : '',
          }));
      const shitu = xuanranYoujieShitu(entries, {
        budgetChars: deps.contextBudgetChars ? deps.contextBudgetChars(cfg.model, yangBenLiuShu(entries)) : DEFAULT_CONTEXT_BUDGET_CHARS,
        keepHead: DEFAULT_KEEP_HEAD,
        keepTail: DEFAULT_KEEP_TAIL,
        recallHint: xiaoXi.content,
      });
      const ceng = gouJianSanCeng(dongJieXiTong, shitu.xiaoXiJi as LiaoTianXiaoXi[], decSnip ? `${ka}\n${decSnip}` : ka);
      // ADR 002 §9.4 待办 2：值班者路径同样可以用 recall/retrieve 解引用被省略的历史
      const limits = deps.toolLimits?.() ?? { zuiDaLunShu: 3, zuiDaJieGuoZiShu: 4000, totalChars: 12000 };
      const tools: GongJuGuiGe[] | undefined = deps.toolSpecs?.();
      const Qiu: Parameters<typeof liaoTianDaiGongJu>[1] = {
        model: cfg.model || 'deepseek-chat',
        xiaoXiJi: sanCengXiaoXi(ceng, shitu.xiaoXiJi as LiaoTianXiaoXi[]),
        maxTokens: 512,
        tools,
      };
      const loop = deps.runTool
        ? await liaoTianDaiGongJu(provider, Qiu, deps.runTool, {
            zuiDaLunShu: limits.zuiDaLunShu,
            zuiDaJieGuoZiShu: limits.zuiDaJieGuoZiShu,
            maxToolResultChars: limits.totalChars,
            // 提炼/摘要这类一次性调用：额度预警对它没意义（第 39 轮：预警只给主对话循环）
            wuYuSuanTiShi: true,
          })
        : null;
      const xiangYing = loop ? loop.xiangYingTi : await provider.chat(Qiu);
      distilled = neiRongWenBen(xiangYing.choices[0]?.message?.content);
      usage = {
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
        cacheHitTokens: xiangYing.usage.cacheHitTokens,
      };
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
  const zhiXingQiJi = (route.decision?.executorIds || []).filter((id) => id !== duty.id);
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
  if (cfg.apiKey || cfg.protocol === 'ollama' || cfg.presetId === 'ollama' || String(cfg.presetId || '').startsWith('ollama-')) {
    if (zhiXingQiJi.length) {
      /**
       * 队列冲刷与主路径**同一套执行者协议**（第 48 轮修的真缺陷）：这里以前只派**一个**执行者、
       * 用全局配置、不带身份与工具、用户原话整段进毯、结论不设闸 —— 主路径第 20 轮修掉的
       * "多牛马只是同一个模型多答一句"在这条路上一直还在。
       */
      const lun = await paiFaZhiXingZheLun(deps, cfg, {
        groupId: xiaoXi.groupId,
        brief,
        contextItems: gouJianZhanBianXiang(deps, xiaoXi.groupId, xiaoXi.content, ka),
        zhiXingQiJi,
      });
      distilled = lun.huiFu;
      gaiKuang = gaiKuangOf(lun);
    } else {
      const { congYuSheChuangJian } = await import('@warmy/providers');
      const provider = congYuSheChuangJian(cfg.presetId, { apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, protocol: cfg.protocol } as never, cfg.protocol as never);
      /** 契约「缓存三层顺序」：冻结系统提示（不含状态卡片）→ 有界视图 → 状态卡片 */
      const dongJieXiTong = `你是 WArmy 项目「${xiaoXi.groupId}」的值班者。\n请用简短中文回复。`;
      const entries: LogEntry[] = deps.logOf
        ? deps.logOf(xiaoXi.groupId)
        : (deps.history.get(xiaoXi.groupId) || []).map((m, i) => ({
            seq: i + 1,
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as LogEntry['role'],
            content: typeof m.content === 'string' ? m.content : '',
          }));
      const shitu = xuanranYoujieShitu(entries, {
        budgetChars: deps.contextBudgetChars ? deps.contextBudgetChars(cfg.model, yangBenLiuShu(entries)) : DEFAULT_CONTEXT_BUDGET_CHARS,
        keepHead: DEFAULT_KEEP_HEAD,
        keepTail: DEFAULT_KEEP_TAIL,
        recallHint: xiaoXi.content,
      });
      const limits = deps.toolLimits?.() ?? { zuiDaLunShu: 3, zuiDaJieGuoZiShu: 4000, totalChars: 12000 };
      const tools: GongJuGuiGe[] | undefined = deps.toolSpecs?.();
      const ceng = gouJianSanCeng(dongJieXiTong, shitu.xiaoXiJi as LiaoTianXiaoXi[], ka);
      const Qiu: Parameters<typeof liaoTianDaiGongJu>[1] = {
        model: cfg.model || 'deepseek-chat',
        xiaoXiJi: sanCengXiaoXi(ceng, shitu.xiaoXiJi as LiaoTianXiaoXi[]),
        maxTokens: 512,
        tools,
      };
      const loop = deps.runTool
        ? await liaoTianDaiGongJu(provider, Qiu, deps.runTool, {
            zuiDaLunShu: limits.zuiDaLunShu,
            zuiDaJieGuoZiShu: limits.zuiDaJieGuoZiShu,
            maxToolResultChars: limits.totalChars,
            // 提炼/摘要这类一次性调用：额度预警对它没意义（第 39 轮：预警只给主对话循环）
            wuYuSuanTiShi: true,
          })
        : null;
      const xiangYing = loop ? loop.xiangYingTi : await provider.chat(Qiu);
      distilled = neiRongWenBen(xiangYing.choices[0]?.message?.content);
      usage = {
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
        cacheHitTokens: xiangYing.usage.cacheHitTokens,
      };
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
    ...gaiKuang,
  };
}
