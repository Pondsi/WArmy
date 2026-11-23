/**
 * R298：定时任务受限 schema / 时间语义 / 谓词 / 旧任务迁移 —— 唯一规范 owner。
 *
 * 口径（计划《总结巡查预测发布闭环》§定时任务/§时间等待触发）：
 *  · 触发类型固定枚举：绝对一次、相对延时、固定间隔、5字段cron/每日日历、时刻列表、
 *    随机窗口（一次性/每日）、随机间隔、条件/事件/计划依赖。不执行 eval/模型生成规则/任意正则。
 *  · UTC epoch 执行时刻 + IANA 时区；创建时固定时区。日期歧义由上层询问用户，本层只认显式 kind。
 *  · 固定间隔按原定锚点推进，不因执行耗时漂移；一次任务完成不再触发；时刻列表去重但保留来源。
 *  · 随机均匀抽样，每次抽样仅一次（抽样函数纯函数、注入 rng；先落盘再副作用由账本层负责）。
 *  · DST：不存在的日历时刻不自动顺延（返回 gap 交调度器记错过）；重复本地时刻只取较早偏移一次。
 *  · 条件为受限 JSON 谓词（深度≤4、节点≤32、分支≤8）；依赖环拒绝保存。
 *  · mixed 每执行段最多 64 个串行步骤；更大任务由调度器分段，不在 schema 里判非法。
 *  · repeat = 计划触发次数；触发/尝试/成功/错过分列（计数在账本层）。旧计数只作历史统计。
 *
 * 纯函数、无 IO、无 Electron —— 门禁直接 import 编译产物断言。
 */
import { jieXiCron, xiaCiCron, qiangShangShiJian } from '../cron-lite.js';

/** 硬上限（机械边界，开发模式/总结自改进都不得越过） */
export const DING_SHI_XIAN_ZHI = {
  /** mixed 单执行段串行步骤上限 */
  stepsMax: 64,
  /** 谓词最大深度/节点数/单分支子项 */
  weiCiShenDu: 4, weiCiJieDian: 32, weiCiFenZhi: 8,
  /** 字段长度 */
  nameMax: 60, promptMax: 2000, descMax: 200, pathMax: 400, idMax: 120,
  /** 时刻列表最多 366 项（一年每天一个也够） */
  timesMax: 366,
  /** 间隔下限 1s（保护事件循环）；上限 366 天 */
  jianGeMinMs: 1000, jianGeMaxMs: 366 * 86400_000,
  /** 脚本超时沿用受控子进程接口 1–600s */
  scriptTimeoutMinMs: 1000, scriptTimeoutMaxMs: 600_000,
  /** 条件轮询默认 5s 低占空比；下限 1s */
  pollMoRenMs: 5000, pollMinMs: 1000,
  /** 在线正常调度抖动容差 60s（不是离线补跑窗口） */
  zaiXianRongChaMs: 60_000,
} as const;

/* ── 触发 ── */
export type DingShiChuFa =
  | { kind: 'once'; at: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'interval'; everyMs: number; anchorAt: number }
  | { kind: 'cron'; expr: string; tz: string }
  | { kind: 'daily'; hhmm: string; tz: string }
  | { kind: 'times'; list: number[]; sources?: string[] }
  | { kind: 'randomOnce'; from: number; to: number }
  | { kind: 'randomDaily'; fromMin: number; toMin: number; tz: string }
  | { kind: 'randomInterval'; minMs: number; maxMs: number }
  | { kind: 'condition'; predicate: DingShiWeiCi; pollMs?: number; eventId?: string };

/* ── 受限谓词：只允许这些 op，字段白名单，无正则/eval ── */
export type DingShiWeiCi =
  | { op: 'timeAfter'; at: number }
  | { op: 'timeBefore'; at: number }
  | { op: 'fileExists'; path: string }
  | { op: 'fileChanged'; path: string; since: number }
  | { op: 'taskStatus'; taskId: string; status: 'success' | 'failed' | 'stopped' }
  | { op: 'planStep'; planId: string; stepId: string; status: 'done' | 'failed' | 'running' | 'waiting' }
  | { op: 'event'; eventId: string }
  | { op: 'toolResult'; ref: string; cmp: 'eq' | 'ne' | 'gt' | 'lt'; value: number | string | boolean }
  | { op: 'and'; parts: DingShiWeiCi[] }
  | { op: 'or'; parts: DingShiWeiCi[] }
  | { op: 'not'; part: DingShiWeiCi };

/* ── 动作（schema 在此，适配器在 ying-yong/ding-shi-dong-zuo）── */
export type DingShiDongZuo =
  | { kind: 'model'; prompt: string; model?: string }
  | { kind: 'script'; command: string; args: string[]; cwd: string; timeoutMs: number; hash: string; outputs?: string[] }
  | { kind: 'planStep'; planId: string; stepId: string }
  | { kind: 'wake'; sessionId: string; prompt?: string }
  | { kind: 'mail'; accountId: string; to: string[]; subject: string; bodySource: 'fixed' | 'model'; body: string; attachments?: string[] }
  | { kind: 'ring'; sound?: string; times?: number }
  | { kind: 'tool'; tool: string; params: Record<string, unknown> }
  | { kind: 'mixed'; steps: DingShiDongZuo[] };

/** 任务固定范围授权快照（创建时确认；范围改变必须重新确认，不得变成全局 shell 权限） */
export interface DingShiShouQuan {
  version: number;
  grantedAt: number;
  /** 人话范围摘要（卡片显示） */
  scope: string[];
  script?: { hash: string; args: string[]; cwd: string; fanWei: string[] };
  mail?: { accountId: string; to: string[]; subjectMoBan: string; attachmentsFanWei: string[] };
}

/** 定时任务 V2（账本持久形态；执行状态/抽样/水位在账本 state，不在定义里） */
export interface DingShiRenWuV2 {
  id: string;
  revision: number;
  sessionId: string;
  name: string;
  desc: string;
  tz: string;
  trigger: DingShiChuFa;
  action: DingShiDongZuo;
  /** 计划触发次数；0=无限。补执行不消耗它 */
  repeat: number;
  enabled: boolean;
  status: 'active' | 'stopped';
  stoppedReason?: string;
  stoppedAt?: number;
  replacedBy?: string;
  createdAt: number;
  updatedAt: number;
  shouQuan: DingShiShouQuan;
  /** 与普通计划卡的关联（可重复显示；执行 owner 只有调度器一个） */
  planRef?: { planId: string; stepId: string };
  /** 迁移来的旧执行计数：只作历史统计，不宣称已经成功 */
  liShiCiShu?: number;
}

export type YanZhengJieGuo<T> = { ok: true; value: T } | { ok: false; error: string };
const shi = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ziFu = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;

/** IANA 时区必须能被 Intl 认出；空串=本机（创建时固定下来） */
export function yanZhengShiQu(tz: unknown): YanZhengJieGuo<string> {
  const s = String(tz || '').trim();
  if (!s) return { ok: true, value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  if (s.length > 64) return { ok: false, error: 'bad-timezone' };
  try { new Intl.DateTimeFormat('en-CA', { timeZone: s }); return { ok: true, value: s }; } catch { return { ok: false, error: 'bad-timezone' }; }
}

/* ── 谓词校验 ── */
const WEI_CI_OPS = new Set(['timeAfter', 'timeBefore', 'fileExists', 'fileChanged', 'taskStatus', 'planStep', 'event', 'toolResult', 'and', 'or', 'not']);
function weiCiJieDianShu(p: DingShiWeiCi): number {
  if (p.op === 'and' || p.op === 'or') return 1 + p.parts.reduce((a, x) => a + weiCiJieDianShu(x), 0);
  if (p.op === 'not') return 1 + weiCiJieDianShu(p.part);
  return 1;
}
export function yanZhengWeiCi(raw: unknown, shenDu = 0): YanZhengJieGuo<DingShiWeiCi> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad-predicate' };
  if (shenDu > DING_SHI_XIAN_ZHI.weiCiShenDu) return { ok: false, error: 'predicate-too-deep' };
  const o = raw as Record<string, unknown>;
  const op = String(o['op'] || '');
  if (!WEI_CI_OPS.has(op)) return { ok: false, error: 'predicate-op-not-allowed' };
  const X = DING_SHI_XIAN_ZHI;
  switch (op) {
    case 'timeAfter': case 'timeBefore':
      if (!shi(o['at']) || (o['at'] as number) <= 0) return { ok: false, error: 'predicate-bad-time' };
      return { ok: true, value: { op, at: o['at'] } as DingShiWeiCi };
    case 'fileExists':
      if (!ziFu(o['path'], X.pathMax)) return { ok: false, error: 'predicate-bad-path' };
      return { ok: true, value: { op, path: o['path'] } as DingShiWeiCi };
    case 'fileChanged':
      if (!ziFu(o['path'], X.pathMax) || !shi(o['since'])) return { ok: false, error: 'predicate-bad-file-version' };
      return { ok: true, value: { op, path: o['path'], since: o['since'] } as DingShiWeiCi };
    case 'taskStatus':
      if (!ziFu(o['taskId'], X.idMax) || !['success', 'failed', 'stopped'].includes(String(o['status']))) return { ok: false, error: 'predicate-bad-task-status' };
      return { ok: true, value: { op, taskId: o['taskId'], status: o['status'] } as DingShiWeiCi };
    case 'planStep':
      if (!ziFu(o['planId'], X.idMax) || !ziFu(o['stepId'], X.idMax) || !['done', 'failed', 'running', 'waiting'].includes(String(o['status']))) return { ok: false, error: 'predicate-bad-plan-step' };
      return { ok: true, value: { op, planId: o['planId'], stepId: o['stepId'], status: o['status'] } as DingShiWeiCi };
    case 'event':
      if (!ziFu(o['eventId'], X.idMax)) return { ok: false, error: 'predicate-bad-event' };
      return { ok: true, value: { op, eventId: o['eventId'] } as DingShiWeiCi };
    case 'toolResult': {
      const v = o['value'];
      if (!ziFu(o['ref'], X.idMax) || !['eq', 'ne', 'gt', 'lt'].includes(String(o['cmp'])) || !(typeof v === 'number' || typeof v === 'boolean' || ziFu(v, 200))) return { ok: false, error: 'predicate-bad-tool-result' };
      if ((o['cmp'] === 'gt' || o['cmp'] === 'lt') && typeof v !== 'number') return { ok: false, error: 'predicate-cmp-needs-number' };
      return { ok: true, value: { op, ref: o['ref'], cmp: o['cmp'], value: v } as DingShiWeiCi };
    }
    case 'and': case 'or': {
      if (!Array.isArray(o['parts']) || o['parts'].length < 1 || o['parts'].length > X.weiCiFenZhi) return { ok: false, error: 'predicate-bad-parts' };
      const parts: DingShiWeiCi[] = [];
      for (const p of o['parts']) { const r = yanZhengWeiCi(p, shenDu + 1); if (!r.ok) return r; parts.push(r.value); }
      return { ok: true, value: { op, parts } as DingShiWeiCi };
    }
    case 'not': {
      const r = yanZhengWeiCi(o['part'], shenDu + 1);
      if (!r.ok) return r;
      return { ok: true, value: { op, part: r.value } as DingShiWeiCi };
    }
    default: return { ok: false, error: 'predicate-op-not-allowed' };
  }
}
/** 整体校验（含节点总量）；调用方保存前必须过这一关 */
export function yanZhengWeiCiZong(raw: unknown): YanZhengJieGuo<DingShiWeiCi> {
  const r = yanZhengWeiCi(raw);
  if (!r.ok) return r;
  if (weiCiJieDianShu(r.value) > DING_SHI_XIAN_ZHI.weiCiJieDian) return { ok: false, error: 'predicate-too-many-nodes' };
  return r;
}

/** 从谓词提取任务依赖边（taskStatus/planStep→planId 所属任务由调用方映射） */
export function weiCiYiLai(p: DingShiWeiCi): { tasks: string[]; plans: string[] } {
  const tasks = new Set<string>(); const plans = new Set<string>();
  const zou = (x: DingShiWeiCi): void => {
    if (x.op === 'taskStatus') tasks.add(x.taskId);
    else if (x.op === 'planStep') plans.add(x.planId);
    else if (x.op === 'and' || x.op === 'or') x.parts.forEach(zou);
    else if (x.op === 'not') zou(x.part);
  };
  zou(p);
  return { tasks: [...tasks], plans: [...plans] };
}

/**
 * 依赖环检测：edges = taskId → 依赖的 taskId 列表（planStep 依赖由调用方折算成计划 owner 任务）。
 * 有环返回环路径（拒绝保存），无环返回 null。迭代 DFS，深度有界（任务数上限由账本层管）。
 */
export function jianChaYiLaiHuan(edges: Map<string, string[]>): string[] | null {
  const yanSe = new Map<string, 0 | 1 | 2>(); // 0=白 1=灰 2=黑
  const luJing: string[] = [];
  let huan: string[] | null = null;
  const fang = (id: string): void => {
    if (huan) return;
    const c = yanSe.get(id) || 0;
    if (c === 1) { const i = luJing.indexOf(id); huan = [...luJing.slice(i >= 0 ? i : 0), id]; return; }
    if (c === 2) return;
    yanSe.set(id, 1); luJing.push(id);
    for (const d of edges.get(id) || []) fang(d);
    luJing.pop(); yanSe.set(id, 2);
  };
  for (const id of edges.keys()) { fang(id); if (huan) break; }
  return huan;
}

/* ── 触发校验与归一 ── */
export function yanZhengChuFa(raw: unknown, now: number): YanZhengJieGuo<DingShiChuFa> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad-trigger' };
  const o = raw as Record<string, unknown>;
  const kind = String(o['kind'] || '');
  const X = DING_SHI_XIAN_ZHI;
  switch (kind) {
    case 'once':
      if (!shi(o['at']) || (o['at'] as number) <= 0) return { ok: false, error: 'trigger-bad-at' };
      return { ok: true, value: { kind: 'once', at: Math.floor(o['at'] as number) } };
    case 'delay':
      if (!shi(o['ms']) || (o['ms'] as number) < 0 || (o['ms'] as number) > X.jianGeMaxMs) return { ok: false, error: 'trigger-bad-delay' };
      /** 相对延时在创建时归一为绝对一次（重启不重算） */
      return { ok: true, value: { kind: 'once', at: now + Math.floor(o['ms'] as number) } };
    case 'interval': {
      if (!shi(o['everyMs']) || (o['everyMs'] as number) < X.jianGeMinMs || (o['everyMs'] as number) > X.jianGeMaxMs) return { ok: false, error: 'trigger-bad-interval' };
      const anchor = shi(o['anchorAt']) && (o['anchorAt'] as number) > 0 ? Math.floor(o['anchorAt'] as number) : now;
      return { ok: true, value: { kind: 'interval', everyMs: Math.floor(o['everyMs'] as number), anchorAt: anchor } };
    }
    case 'cron': {
      const expr = String(o['expr'] || '').trim();
      if (!jieXiCron(expr)) return { ok: false, error: 'bad-cron（只支持 5 字段：分 时 日 月 周）' };
      const tz = yanZhengShiQu(o['tz']);
      if (!tz.ok) return tz;
      return { ok: true, value: { kind: 'cron', expr, tz: tz.value } };
    }
    case 'daily': {
      const hhmm = String(o['hhmm'] || '').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: 'trigger-bad-daily（要 HH:MM）' };
      const tz = yanZhengShiQu(o['tz']);
      if (!tz.ok) return tz;
      return { ok: true, value: { kind: 'daily', hhmm: `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`, tz: tz.value } };
    }
    case 'times': {
      if (!Array.isArray(o['list']) || o['list'].length < 1 || o['list'].length > X.timesMax) return { ok: false, error: 'trigger-bad-times' };
      const sources = Array.isArray(o['sources']) ? o['sources'].map((s) => String(s || '').slice(0, 120)) : [];
      const jian = new Map<number, string>();
      for (let i = 0; i < o['list'].length; i += 1) {
        const v = o['list'][i];
        if (!shi(v) || (v as number) <= 0) return { ok: false, error: 'trigger-bad-times-item' };
        const at = Math.floor(v as number);
        if (!jian.has(at)) jian.set(at, sources[i] || '');
      }
      const list = [...jian.keys()].sort((a, b) => a - b);
      return { ok: true, value: { kind: 'times', list, sources: list.map((at) => jian.get(at) || '') } };
    }
    case 'randomOnce':
      if (!shi(o['from']) || !shi(o['to']) || (o['from'] as number) <= 0 || (o['to'] as number) <= (o['from'] as number)) return { ok: false, error: 'trigger-bad-random-window' };
      /** 窗口已整体过期：拒绝创建（不编造过去抽样；一次性过期任务请用 once 走错过决定） */
      if ((o['to'] as number) <= now) return { ok: false, error: 'trigger-random-window-expired' };
      return { ok: true, value: { kind: 'randomOnce', from: Math.floor(o['from'] as number), to: Math.floor(o['to'] as number) } };
    case 'randomDaily': {
      if (!shi(o['fromMin']) || !shi(o['toMin']) || (o['fromMin'] as number) < 0 || (o['toMin'] as number) > 1439 || (o['toMin'] as number) < (o['fromMin'] as number)) return { ok: false, error: 'trigger-bad-random-daily（分钟 0–1439，from≤to，不支持跨午夜）' };
      const tz = yanZhengShiQu(o['tz']);
      if (!tz.ok) return tz;
      return { ok: true, value: { kind: 'randomDaily', fromMin: Math.floor(o['fromMin'] as number), toMin: Math.floor(o['toMin'] as number), tz: tz.value } };
    }
    case 'randomInterval':
      if (!shi(o['minMs']) || !shi(o['maxMs']) || (o['minMs'] as number) < X.jianGeMinMs || (o['maxMs'] as number) > X.jianGeMaxMs || (o['maxMs'] as number) < (o['minMs'] as number)) return { ok: false, error: 'trigger-bad-random-interval' };
      return { ok: true, value: { kind: 'randomInterval', minMs: Math.floor(o['minMs'] as number), maxMs: Math.floor(o['maxMs'] as number) } };
    case 'condition': {
      const w = yanZhengWeiCiZong(o['predicate']);
      if (!w.ok) return w;
      const pollMs = shi(o['pollMs']) ? Math.max(X.pollMinMs, Math.floor(o['pollMs'] as number)) : X.pollMoRenMs;
      const eventId = ziFu(o['eventId'], X.idMax) ? String(o['eventId']) : undefined;
      return { ok: true, value: { kind: 'condition', predicate: w.value, pollMs, ...(eventId ? { eventId } : {}) } };
    }
    default: return { ok: false, error: 'trigger-kind-not-allowed' };
  }
}

/* ── 动作校验 ── */
const DONG_ZUO_KINDS = new Set(['model', 'script', 'planStep', 'wake', 'mail', 'ring', 'tool', 'mixed']);
export function yanZhengDongZuo(raw: unknown, shenDu = 0): YanZhengJieGuo<DingShiDongZuo> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad-action' };
  const o = raw as Record<string, unknown>;
  const kind = String(o['kind'] || '');
  if (!DONG_ZUO_KINDS.has(kind)) return { ok: false, error: 'action-kind-not-allowed' };
  const X = DING_SHI_XIAN_ZHI;
  switch (kind) {
    case 'model': {
      const prompt = String(o['prompt'] || '');
      if (!prompt.trim() || prompt.length > X.promptMax) return { ok: false, error: 'action-bad-prompt' };
      const model = ziFu(o['model'], X.idMax) ? String(o['model']) : undefined;
      return { ok: true, value: { kind: 'model', prompt, ...(model ? { model } : {}) } };
    }
    case 'script': {
      if (!ziFu(o['command'], X.pathMax)) return { ok: false, error: 'action-bad-command' };
      if (!Array.isArray(o['args']) || o['args'].length > 64 || o['args'].some((a) => typeof a !== 'string' || a.length > 2000)) return { ok: false, error: 'action-bad-args（必须参数数组，不过 shell）' };
      if (!ziFu(o['cwd'], X.pathMax)) return { ok: false, error: 'action-bad-cwd' };
      if (!ziFu(o['hash'], 128)) return { ok: false, error: 'action-bad-hash（创建时必须确认内容 hash）' };
      const t = shi(o['timeoutMs']) ? Math.floor(o['timeoutMs'] as number) : 60_000;
      if (t < X.scriptTimeoutMinMs || t > X.scriptTimeoutMaxMs) return { ok: false, error: 'action-bad-timeout（1–600s）' };
      const outputs = Array.isArray(o['outputs']) ? o['outputs'].filter((x) => ziFu(x, X.pathMax)).map(String).slice(0, 32) : undefined;
      return { ok: true, value: { kind: 'script', command: String(o['command']), args: o['args'].map(String), cwd: String(o['cwd']), timeoutMs: t, hash: String(o['hash']), ...(outputs && outputs.length ? { outputs } : {}) } };
    }
    case 'planStep':
      if (!ziFu(o['planId'], X.idMax) || !ziFu(o['stepId'], X.idMax)) return { ok: false, error: 'action-bad-plan-step' };
      return { ok: true, value: { kind: 'planStep', planId: String(o['planId']), stepId: String(o['stepId']) } };
    case 'wake': {
      if (!ziFu(o['sessionId'], X.idMax)) return { ok: false, error: 'action-bad-session' };
      const prompt = ziFu(o['prompt'], X.promptMax) ? String(o['prompt']) : undefined;
      return { ok: true, value: { kind: 'wake', sessionId: String(o['sessionId']), ...(prompt ? { prompt } : {}) } };
    }
    case 'mail': {
      if (!ziFu(o['accountId'], X.idMax)) return { ok: false, error: 'action-bad-mail-account' };
      if (!Array.isArray(o['to']) || o['to'].length < 1 || o['to'].length > 32 || o['to'].some((x) => !ziFu(x, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x)))) return { ok: false, error: 'action-bad-mail-to' };
      if (!ziFu(o['subject'], 200)) return { ok: false, error: 'action-bad-mail-subject' };
      const bodySource = o['bodySource'] === 'model' ? 'model' : 'fixed';
      const body = String(o['body'] || '');
      if (body.length > 8000) return { ok: false, error: 'action-bad-mail-body' };
      if (bodySource === 'fixed' && !body.trim()) return { ok: false, error: 'action-mail-body-empty' };
      const attachments = Array.isArray(o['attachments']) ? o['attachments'].filter((x) => ziFu(x, X.pathMax)).map(String).slice(0, 16) : undefined;
      return { ok: true, value: { kind: 'mail', accountId: String(o['accountId']), to: o['to'].map(String), subject: String(o['subject']), bodySource, body, ...(attachments && attachments.length ? { attachments } : {}) } };
    }
    case 'ring': {
      const times = shi(o['times']) ? Math.max(1, Math.min(10, Math.floor(o['times'] as number))) : 1;
      const sound = ziFu(o['sound'], 120) ? String(o['sound']) : undefined;
      return { ok: true, value: { kind: 'ring', times, ...(sound ? { sound } : {}) } };
    }
    case 'tool': {
      if (!ziFu(o['tool'], X.idMax)) return { ok: false, error: 'action-bad-tool' };
      const params = (o['params'] && typeof o['params'] === 'object' && !Array.isArray(o['params'])) ? o['params'] as Record<string, unknown> : {};
      if (JSON.stringify(params).length > 8000) return { ok: false, error: 'action-tool-params-too-big' };
      return { ok: true, value: { kind: 'tool', tool: String(o['tool']), params } };
    }
    case 'mixed': {
      if (shenDu > 0) return { ok: false, error: 'action-mixed-nested（mixed 不可嵌套，分段由调度器负责）' };
      if (!Array.isArray(o['steps']) || o['steps'].length < 1 || o['steps'].length > X.stepsMax) return { ok: false, error: `action-bad-steps（1–${X.stepsMax} 串行步骤；更大任务分段继续）` };
      const steps: DingShiDongZuo[] = [];
      for (const s of o['steps']) { const r = yanZhengDongZuo(s, shenDu + 1); if (!r.ok) return r; steps.push(r.value); }
      return { ok: true, value: { kind: 'mixed', steps } };
    }
    default: return { ok: false, error: 'action-kind-not-allowed' };
  }
}

/* ── 时间语义 ── */

/** 墙上分钟空间毫秒（把 IANA 墙上时间当 UTC 解释，只做日历运算） */
function qiangToMs(q: { y: number; m: number; d: number; hh: number; mm: number }): number {
  return Date.UTC(q.y, q.m - 1, q.d, q.hh, q.mm, 0, 0);
}
function msToQiang(ms: number) {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: t.getUTCDay() };
}
/** 某真实时刻在 tz 的偏移（墙上-真实，分钟粒度） */
function pianYiAt(ts: number, tz: string): number {
  return qiangToMs(qiangShangShiJian(ts, tz)) - Math.floor(ts / 60000) * 60000;
}

/** DST 缺口墙上时刻 → 名义真实时刻（仅供错过记录显示；该时刻实际不存在） */
export function gapMingYiShiKe(gapWall: number, tz: string, now: number): number {
  try { return gapWall - pianYiAt(now, tz); } catch { return gapWall; }
}

/**
 * DST 解析一个墙上目标时刻：
 *  · 不存在（春拨缺口）→ { gap: true }，不自动顺延，交调度器记错过；
 *  · 重复（秋拨回拨）→ 取较早偏移的那个真实时刻，只执行一次；
 *  · 正常 → 唯一真实时刻。
 * 探测偏移集合有界（当前±1h 与候选自身），不逐分钟扫描整年。
 */
export function dstJieXi(wallMs: number, tz: string, now: number): { at: number } | { gap: true } {
  const o0 = pianYiAt(now, tz);
  const cand0 = wallMs - o0;
  const offs = new Set<number>([o0, pianYiAt(cand0, tz), pianYiAt(cand0 - 3600_000, tz), pianYiAt(cand0 + 3600_000, tz)]);
  const youXiao: number[] = [];
  for (const o of offs) {
    const cand = wallMs - o;
    try {
      const q = qiangShangShiJian(cand, tz);
      if (qiangToMs(q) === wallMs) youXiao.push(cand);
    } catch { /* 时区解析失败按无效候选 */ }
  }
  if (!youXiao.length) return { gap: true };
  return { at: Math.min(...youXiao) };
}

/** daily/cron 的日历下一次：返回真实 epoch；DST 缺口记 gapWall（墙上空间）并继续找下一个匹配 */
export function xiaCiRiLi(expr: string, tz: string, now: number): { at: number; gapWall: number } {
  const c = jieXiCron(expr);
  if (!c) return { at: 0, gapWall: 0 };
  const zone = tz || 'UTC';
  let qiang: ReturnType<typeof qiangShangShiJian>;
  try { qiang = qiangShangShiJian(now, zone); } catch { return { at: 0, gapWall: 0 }; }
  let wall = qiangToMs(qiang) + 60000;
  let gapWall = 0;
  for (let i = 0; i < 366 * 1440; i += 1) {
    const q = msToQiang(wall);
    if (c.fen.has(q.mm) && c.shi.has(q.hh) && c.yue.has(q.m) && c.ri.has(q.d) && c.zhou.has(q.dow)) {
      const r = dstJieXi(wall, zone, now);
      if ('gap' in r) { if (!gapWall) gapWall = wall; wall += 60000; continue; }
      if (r.at > now) return { at: r.at, gapWall };
    }
    wall += 60000;
  }
  return { at: 0, gapWall };
}

/** 每日 HH:MM → cron 表达式（日历语义共用同一条 DST 路径） */
export function dailyToCron(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  return `${Number(m[2])} ${Number(m[1])} * * *`;
}

/** 固定间隔：严格按锚点推进（anchor + k*every），不因执行耗时漂移 */
export function xiaCiJianGe(anchorAt: number, everyMs: number, now: number): number {
  if (everyMs <= 0) return 0;
  if (anchorAt > now) return anchorAt;
  const k = Math.floor((now - anchorAt) / everyMs) + 1;
  return anchorAt + k * everyMs;
}

/** 均匀抽样（注入 rng；账本层负责先落盘再副作用，重启不重抽） */
export function chouYangJunYun(from: number, to: number, rng: () => number): number {
  const r = Math.max(0, Math.min(1, rng()));
  return Math.floor(from + r * (to - from));
}

/** 执行状态（账本持有；随机抽样/条件边沿/水位都在这里，不在任务定义里） */
export interface DingShiZhuangTai {
  taskId: string;
  revision: number;
  /** 下一次原定触发（epoch ms；0=无） */
  nextAt: number;
  /** 触发序号（occurrence 身份的一部分） */
  seq: number;
  /** 已持久化的抽样：randomOnce 一次；randomDaily 每天一次；randomInterval 每周期一次 */
  yangBen?: { key: string; at: number; ms?: number };
  /** 条件上一次判定（假→真边沿） */
  conditionLast?: boolean;
  /** DST 缺口待记录的名义时刻（跨过它时记错过，不提前预警） */
  gapDaiJiLu?: number | null;
  /** 已消费的唯一事件 ID（有界，账本层裁剪） */
  seenEvents?: string[];
  /** 上次真实触发时刻 */
  lastFireAt?: number;
}

/**
 * 下一次触发（纯函数）。条件类返回 0（由调度器按边沿/轮询驱动）。
 * 随机类只读已持久化抽样；没有抽样时返回 0 并提示需要先抽样落盘（buNengQueDing）。
 */
export function xiaCiChuFa(trigger: DingShiChuFa, now: number, st?: DingShiZhuangTai): { at: number; gapWall?: number; chouYangXuQiu?: string } {
  switch (trigger.kind) {
    case 'once': return { at: trigger.at > now ? trigger.at : 0 };
    case 'delay': return { at: 0 }; // 归一后不应出现
    case 'interval': return { at: xiaCiJianGe(trigger.anchorAt, trigger.everyMs, now) };
    case 'cron': { const r = xiaCiRiLi(trigger.expr, trigger.tz, now); return { at: r.at, ...(r.gapWall ? { gapWall: r.gapWall } : {}) }; }
    case 'daily': { const r = xiaCiRiLi(dailyToCron(trigger.hhmm), trigger.tz, now); return { at: r.at, ...(r.gapWall ? { gapWall: r.gapWall } : {}) }; }
    case 'times': { const at = trigger.list.find((x) => x > now) || 0; return { at }; }
    case 'randomOnce': {
      const key = `once:${trigger.from}:${trigger.to}`;
      if (st?.yangBen && st.yangBen.key === key) return { at: st.yangBen.at > now ? st.yangBen.at : 0 };
      return { at: 0, chouYangXuQiu: key };
    }
    case 'randomDaily': {
      const prefix = `daily:${trigger.fromMin}:${trigger.toMin}:`;
      const yb = st?.yangBen;
      /** 已落盘的未来抽样直接复用（含“今天窗口已过预抽明天”的情形，重启不重抽） */
      if (yb && yb.key.startsWith(prefix) && yb.at > now) return { at: yb.at };
      const q = qiangShangShiJian(now, trigger.tz);
      const pad = (x: number) => String(x).padStart(2, '0');
      return { at: 0, chouYangXuQiu: `${prefix}${q.y}-${pad(q.m)}-${pad(q.d)}` };
    }
    case 'randomInterval': {
      const base = st?.lastFireAt || now;
      const key = `interval:${trigger.minMs}:${trigger.maxMs}:${base}`;
      if (st?.yangBen && st.yangBen.key === key && st.yangBen.ms) return { at: base + st.yangBen.ms };
      return { at: 0, chouYangXuQiu: key };
    }
    case 'condition': return { at: 0 };
    default: return { at: 0 };
  }
}

/** 为随机触发产生一次抽样（纯函数；调用方必须先落盘 yangBen 再排副作用） */
export function chouYangChuFa(trigger: DingShiChuFa, now: number, rng: () => number, st?: DingShiZhuangTai): { key: string; at: number; ms?: number } | null {
  switch (trigger.kind) {
    case 'randomOnce': {
      const key = `once:${trigger.from}:${trigger.to}`;
      const yb = st?.yangBen;
      if (yb && yb.key === key) return yb;
      const at = chouYangJunYun(Math.max(trigger.from, now), trigger.to, rng);
      return { key, at };
    }
    case 'randomDaily': {
      const pad = (x: number) => String(x).padStart(2, '0');
      const dayStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
      const nextDay = (y: number, m: number, d: number) => msToQiang(Date.UTC(y, m - 1, d) + 86400_000);
      const q = qiangShangShiJian(now, trigger.tz);
      const today = dayStr(q.y, q.m, q.d);
      const prefix = `daily:${trigger.fromMin}:${trigger.toMin}:`;
      const yb = st?.yangBen;
      /** 已落盘的未来抽样（今天或预抽的明天）直接复用：重启/重入不重抽 */
      if (yb && yb.key.startsWith(prefix) && yb.at > now) return yb;
      /** 今天窗口后沿的真实时刻（DST 缺口则今天窗口不可用） */
      const jinTianMoWall = Date.UTC(q.y, q.m - 1, q.d, Math.floor(trigger.toMin / 60), trigger.toMin % 60, 0, 0);
      const moR = dstJieXi(jinTianMoWall, trigger.tz, now);
      const jinTianWeiGuo = !('gap' in moR) && now < moR.at;
      let muBiao: { y: number; m: number; d: number };
      if (yb && yb.key.startsWith(prefix)) {
        const ybDay = yb.key.slice(prefix.length);
        if (ybDay >= today) {
          /** 已消费且日期≥今天（含时钟回拨）⇒ 其次日，绝不同日重抽 */
          muBiao = nextDay(Number(ybDay.slice(0, 4)), Number(ybDay.slice(5, 7)), Number(ybDay.slice(8, 10)));
        } else {
          muBiao = jinTianWeiGuo ? { y: q.y, m: q.m, d: q.d } : nextDay(q.y, q.m, q.d);
        }
      } else {
        muBiao = jinTianWeiGuo ? { y: q.y, m: q.m, d: q.d } : nextDay(q.y, q.m, q.d);
      }
      const cong = chouYangJunYun(trigger.fromMin, trigger.toMin + 1, rng);
      const wall = Date.UTC(muBiao.y, muBiao.m - 1, muBiao.d, Math.floor(cong / 60), cong % 60, 0, 0);
      let r = dstJieXi(wall, trigger.tz, now);
      /** 抽到 DST 缺口：改窗口后沿再解析；仍缺口则如实 null（记错过，不悄悄换时间） */
      if ('gap' in r) {
        const wall2 = Date.UTC(muBiao.y, muBiao.m - 1, muBiao.d, Math.floor(trigger.toMin / 60), trigger.toMin % 60, 0, 0);
        r = dstJieXi(wall2, trigger.tz, now);
        if ('gap' in r) return null;
      }
      /** 目标日抽到的时刻已过（今天窗口内抽到过去点）⇒ 明天重抽，不补发过去 */
      if (r.at <= now) {
        const q2 = nextDay(muBiao.y, muBiao.m, muBiao.d);
        const cong2 = chouYangJunYun(trigger.fromMin, trigger.toMin + 1, rng);
        const wall2 = Date.UTC(q2.y, q2.m - 1, q2.d, Math.floor(cong2 / 60), cong2 % 60, 0, 0);
        const r2 = dstJieXi(wall2, trigger.tz, now);
        if ('gap' in r2) return null;
        return { key: prefix + dayStr(q2.y, q2.m, q2.d), at: r2.at };
      }
      return { key: prefix + dayStr(muBiao.y, muBiao.m, muBiao.d), at: r.at };
    }
    case 'randomInterval': {
      const base = st?.lastFireAt || now;
      const key = `interval:${trigger.minMs}:${trigger.maxMs}:${base}`;
      const yb = st?.yangBen;
      if (yb && yb.key === key && yb.ms) return yb;
      const ms = chouYangJunYun(trigger.minMs, trigger.maxMs + 1, rng);
      return { key, at: base + ms, ms };
    }
    default: return null;
  }
}

/** occurrence 身份：task + revision + 触发序号 + 原定时间（幂等键，重启/跨窗一致） */
export function occurrenceId(taskId: string, revision: number, seq: number, scheduledAt: number): string {
  return `occ:${String(taskId).slice(0, DING_SHI_XIAN_ZHI.idMax)}:r${Math.max(1, Math.floor(revision))}:${Math.max(0, Math.floor(seq))}:${Math.floor(scheduledAt)}`;
}

/** 创建时预览未来触发（随机类只显示窗口，不产生真实抽样——预览不落盘） */
export function yuLanChuFa(trigger: DingShiChuFa, now: number, n = 5): Array<{ at: number; shuoMing: string }> {
  const out: Array<{ at: number; shuoMing: string }> = [];
  const X = Math.max(1, Math.min(20, n));
  if (trigger.kind === 'randomOnce') return [{ at: trigger.from, shuoMing: `随机窗口 ${new Date(trigger.from).toISOString()} ～ ${new Date(trigger.to).toISOString()}（执行前抽样一次并落盘）` }];
  if (trigger.kind === 'randomDaily') return [{ at: now, shuoMing: `每天 ${trigger.fromMin}–${trigger.toMin} 分钟（${trigger.tz}）内随机一刻，抽样先落盘` }];
  if (trigger.kind === 'randomInterval') return [{ at: now + trigger.minMs, shuoMing: `每 ${trigger.minMs}–${trigger.maxMs}ms 随机间隔` }];
  if (trigger.kind === 'condition') return [{ at: 0, shuoMing: '条件满足时触发（假→真边沿或唯一事件；默认 5s 低占空比核对）' }];
  let t = now;
  for (let i = 0; i < X; i += 1) {
    const r = xiaCiChuFa(trigger, t);
    if (!r.at) break;
    out.push({ at: r.at, shuoMing: new Date(r.at).toISOString() });
    t = r.at;
    if (trigger.kind === 'once') break;
  }
  return out;
}

/**
 * 错过枚举（分片）：列出 (from, to] 内所有原定触发，最多 cap 条；
 * 返回 nextFrom 供下一片继续（长期离线不截断遗漏）。条件/每日随机由调度器按状态另行记录。
 */
export function meiGuoQuJian(trigger: DingShiChuFa, from: number, to: number, cap: number): { items: number[]; nextFrom: number; wan: boolean } {
  const items: number[] = [];
  const X = Math.max(1, Math.min(1000, cap));
  const push = (at: number): boolean => { if (at > from && at <= to) { items.push(at); } return items.length >= X; };
  switch (trigger.kind) {
    case 'once':
      push(trigger.at);
      return { items, nextFrom: to, wan: true };
    case 'interval': {
      let at = xiaCiJianGe(trigger.anchorAt, trigger.everyMs, from);
      while (at <= to && items.length < X) { items.push(at); at += trigger.everyMs; }
      return { items, nextFrom: at > to ? to : at - 1, wan: at > to };
    }
    case 'cron': case 'daily': {
      const expr = trigger.kind === 'cron' ? trigger.expr : dailyToCron(trigger.hhmm);
      const tz = trigger.tz;
      let t = from;
      while (items.length < X) {
        const r = xiaCiRiLi(expr, tz, t);
        if (!r.at || r.at > to) break;
        items.push(r.at);
        t = r.at;
      }
      return { items, nextFrom: t, wan: t >= to || items.length < X };
    }
    case 'times': {
      for (const at of trigger.list) { if (push(at)) break; }
      return { items, nextFrom: to, wan: true };
    }
    case 'randomOnce': {
      /** 未抽样就离线错过：按窗口起点记一条名义错过（真实抽样不存在，不编造） */
      push(trigger.from);
      return { items, nextFrom: to, wan: true };
    }
    case 'randomInterval': {
      /** 离线期间没有已落盘抽样 ⇒ 无法重建确切时刻；按最小间隔名义枚举，调度器以账本抽样为准 */
      let at = from + trigger.minMs;
      while (at <= to && items.length < X) { items.push(at); at += trigger.minMs; }
      return { items, nextFrom: at > to ? to : at - 1, wan: at > to };
    }
    default:
      return { items, nextFrom: to, wan: true };
  }
}

/* ── 旧任务迁移 ── */
export interface JiuDingShiRenWu {
  id: string; sessionId: string; name: string; prompt: string;
  everyMinutes: number; dailyAt: string; desc: string;
  cron?: string; tz?: string;
  nextAt: number; lastAt: number; enabled: boolean;
  status?: 'active' | 'stopped'; stoppedReason?: string; stoppedAt?: number; replacedBy?: string;
  createdAt: number; repeat: number; zhiXingGuo: number; zuiHouChuFaAt: number;
}

/**
 * 旧任务 → V2 model 动作：保留原 ID/prompt/周期/次数及历史；
 * 旧 zhiXingGuo 只作 liShiCiShu 历史统计（不宣称已经成功），新计数从 0 分列。
 * 旧 nextAt 在未来则沿用，否则按锚点重算；幂等键 zuiHouChuFaAt 由账本迁移为已触发水位。
 */
export function qianYiJiuDingShi(jiu: JiuDingShiRenWu, now: number): YanZhengJieGuo<DingShiRenWuV2> {
  const tzR = yanZhengShiQu(jiu.tz);
  const tz = tzR.ok ? tzR.value : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  let trigger: DingShiChuFa;
  if (jiu.cron && jieXiCron(jiu.cron)) trigger = { kind: 'cron', expr: jiu.cron.trim(), tz };
  else if (jiu.everyMinutes > 0) {
    const everyMs = Math.max(DING_SHI_XIAN_ZHI.jianGeMinMs, jiu.everyMinutes * 60000);
    /** 锚点取旧账本可考的最早原定时刻：lastAt 有则用 lastAt（旧实现按 now 漂移，迁移后不再漂） */
    const anchor = jiu.zuiHouChuFaAt > 0 ? jiu.zuiHouChuFaAt : (jiu.createdAt > 0 ? jiu.createdAt : now);
    trigger = { kind: 'interval', everyMs, anchorAt: anchor };
  } else if (/^(\d{1,2}):(\d{2})$/.test(String(jiu.dailyAt || ''))) trigger = { kind: 'daily', hhmm: jiu.dailyAt, tz };
  else return { ok: false, error: 'migrate-no-valid-trigger' };
  const act = yanZhengDongZuo({ kind: 'model', prompt: String(jiu.prompt || '').slice(0, DING_SHI_XIAN_ZHI.promptMax) || '（旧任务无 prompt）' });
  if (!act.ok) return act;
  const v2: DingShiRenWuV2 = {
    id: String(jiu.id), revision: 1, sessionId: String(jiu.sessionId || ''),
    name: String(jiu.name || '定时任务').slice(0, DING_SHI_XIAN_ZHI.nameMax),
    desc: String(jiu.desc || '').slice(0, DING_SHI_XIAN_ZHI.descMax),
    tz, trigger, action: act.value,
    repeat: Math.max(0, Math.floor(Number(jiu.repeat) || 0)),
    enabled: !!jiu.enabled && (jiu.status ?? 'active') === 'active',
    status: (jiu.status ?? 'active') === 'active' ? 'active' : 'stopped',
    ...(jiu.stoppedReason ? { stoppedReason: String(jiu.stoppedReason).slice(0, 120) } : {}),
    ...(jiu.stoppedAt ? { stoppedAt: Number(jiu.stoppedAt) } : {}),
    ...(jiu.replacedBy ? { replacedBy: String(jiu.replacedBy).slice(0, DING_SHI_XIAN_ZHI.idMax) } : {}),
    createdAt: Number(jiu.createdAt) || now, updatedAt: now,
    shouQuan: { version: 1, grantedAt: Number(jiu.createdAt) || now, scope: ['旧任务迁移：沿用原会话模型执行原 prompt（历史授权）'] },
    ...(Number(jiu.zhiXingGuo) > 0 ? { liShiCiShu: Math.floor(Number(jiu.zhiXingGuo)) } : {}),
  };
  return { ok: true, value: v2 };
}

/** 人话描述（卡片显示触发方式） */
export function miaoShuChuFa(t: DingShiChuFa): string {
  switch (t.kind) {
    case 'once': return `一次性 ${new Date(t.at).toISOString()}`;
    case 'delay': return `延时 ${t.ms}ms`;
    case 'interval': return `每 ${Math.round(t.everyMs / 1000)}s（锚点固定）`;
    case 'cron': return `Cron ${t.expr}（${t.tz}）`;
    case 'daily': return `每天 ${t.hhmm}（${t.tz}）`;
    case 'times': return `指定时刻 ${t.list.length} 个`;
    case 'randomOnce': return `随机窗口 ${new Date(t.from).toISOString()}～${new Date(t.to).toISOString()}`;
    case 'randomDaily': return `每天随机 ${t.fromMin}–${t.toMin} 分（${t.tz}）`;
    case 'randomInterval': return `随机间隔 ${Math.round(t.minMs / 1000)}–${Math.round(t.maxMs / 1000)}s`;
    case 'condition': return t.eventId ? `事件 ${t.eventId}` : '条件满足时';
    default: return '未知触发';
  }
}