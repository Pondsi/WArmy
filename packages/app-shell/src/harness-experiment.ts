/**
 * harness-experiment —— Harness² 借鉴方案的实验权威状态层（R231，方案 §5/§6/§7/§14/§18）。
 *
 * 职责：不可变身份/确定性 hash、append-only 事件流（单写锁+重放+投影）、
 * 真实请求预算预留守恒与逐维度结算幂等、证据 blob 封存与受权引用、
 * 严格 JSON oracle（重复键拒绝）、safe 工具策略、manifest 校验与状态机。
 *
 * 边界：不 import renderer、不自行调用模型；普通调用不带实验上下文时零影响。
 * 命名沿用拼音约定；类型来自 @warmy/contracts（R231 增量）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ShiYanManifest, ShiYanShenFen, YunXingZhuangTai, YunXingShouJu, ZiYuanZongLiang,
  ZhengJuYinYong, JieDuanXinXi,
} from '@warmy/contracts';
import { zhunRuChengXu } from '@warmy/knowledge-base';
/** R231：准入谓词唯一一份在 knowledge-base（所有模型可见出口共用）；这里 re-export 供宿主侧使用 */
export { zhunRuChengXu };

/* ── 确定性 hash 与身份（§5.2） ── */

/** 原始字节 SHA-256：不归一换行/不重编码（保留原始证据） */
export function sha256Bytes(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
/** 确定性 JSON：键排序、数组保序、拒绝 undefined/NaN/非有限数 */
export function queDingXingJson(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('schema_mismatch: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map((x) => queDingXingJson(x)).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + queDingXingJson(o[k])).join(',') + '}';
  }
  throw new Error('schema_mismatch: unsupported value ' + typeof v);
}
export function peiZhiHash(v: unknown): string { return sha256Bytes(Buffer.from(queDingXingJson(v), 'utf8')); }
export function xinId(qian: string): string { return qian + '-' + crypto.randomUUID(); }

/** executionKey：任务/输入/harness/验收/模型/环境/replicate/seed/协议版本（§5.2） */
export function executionKeyOf(m: ShiYanManifest, taskId: string, arm: string, replicate: number): string {
  return peiZhiHash({
    taskId, inputHash: m.datasetHash, harness: m.baselineHash, acceptance: m.acceptanceHash,
    model: m.model, env: m.environmentHash, arm, replicate, seed: m.randomizationSeed,
    protocol: m.protocolVersion, mode: m.mode,
    candidate: m.mode === 'candidate_evaluation' ? m.candidateHash : null,
  });
}

/* ── manifest 校验（§11.1 + E5 修正） ── */

export function jiaoYanManifest(m: ShiYanManifest): string[] {
  const cuo: string[] = [];
  if (m.schemaVersion !== 1) cuo.push('invalid_manifest: schemaVersion');
  if (!m.campaignId || !m.experimentId || !m.approvalEventId) cuo.push('invalid_manifest: ids/approval');
  if (!Array.isArray(m.taskIds) || m.taskIds.length === 0) cuo.push('invalid_manifest: taskIds');
  if (new Set(m.taskIds).size !== m.taskIds.length) cuo.push('invalid_manifest: duplicate taskIds');
  if (!Array.isArray(m.arms) || m.arms.length === 0) cuo.push('invalid_manifest: empty arms');
  if (new Set(m.arms).size !== m.arms.length) cuo.push('invalid_manifest: duplicate arms');
  if (m.mode === 'baseline_exploration') {
    if (m.arms.length !== 1 || m.arms[0] !== 'baseline') cuo.push('invalid_manifest: baseline_exploration arms');
  } else {
    if (!m.arms.includes('candidate')) cuo.push('invalid_manifest: candidate_evaluation must include candidate');
    if (!m.candidateHash) cuo.push('invalid_manifest: candidateHash required');
  }
  if (m.replicatesPerArm < 1) cuo.push('invalid_manifest: replicatesPerArm');
  const b = m.budget;
  if (b.maxModelAttempts < 1 || b.maxToolCalls < 0 || b.maxWallMs < 1 || b.maxEvidenceBytes < 1) cuo.push('invalid_manifest: budget');
  if (b.maxInputTokensPerAttempt < 1 || b.maxGenerationTokensPerAttempt < 1) cuo.push('invalid_manifest: token bounds');
  return cuo;
}

/* ── 状态机（§5.3）：终态不可回改；非法转移拒绝 ── */

const YUN_XU_ZHUAN_YI: Record<YunXingZhuangTai, YunXingZhuangTai[]> = {
  planned: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'in_doubt'],
  in_doubt: ['completed', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: [],
};
export function zhuanYiHeFa(jiu: YunXingZhuangTai, xin: YunXingZhuangTai): boolean {
  return (YUN_XU_ZHUAN_YI[jiu] || []).includes(xin);
}
/** 不可变字段：patch 试图改这些即拒绝（§5.3） */
const BU_KE_GAI = ['runId', 'experimentId', 'taskId', 'arm', 'replicate', 'harnessHash', 'inputHash', 'acceptanceHash', 'modelConfigHash', 'environmentHash'] as const;
export function shouJuPatchHeFa(jiu: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  for (const k of BU_KE_GAI) if (k in patch && patch[k] !== jiu[k]) return false;
  if ('state' in patch && !zhuanYiHeFa(jiu.state as YunXingZhuangTai, patch.state as YunXingZhuangTai)) return false;
  return true;
}

/* ── 事件流（§5.4）：单写锁 + append-only + 重放 + 投影 ── */

export interface ShiYanShiJian {
  schemaVersion: 1;
  eventId: string;
  seq: number;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}
export class ShiYanShiJianLiu {
  private root: string;
  private lockPath: string;
  private events: ShiYanShiJian[] = [];
  private seq = 0;
  private suo = false;
  constructor(root: string) {
    this.root = root;
    this.lockPath = path.join(root, 'events.lock');
  }
  /** exclusive-create 锁；残留锁先核查不强删（E3） */
  jiaSuo(): boolean {
    fs.mkdirSync(this.root, { recursive: true });
    try {
      fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
      this.suo = true;
      return true;
    } catch {
      return false; // 占用/残留：调用方核查，不得强删
    }
  }
  shiFangSuo(): void {
    if (this.suo) { try { fs.rmSync(this.lockPath, { force: true }); } catch { /* noop */ } this.suo = false; }
  }
  /** 重放：合法完整行重建；仅尾残片隔离；中段损坏报 corrupt（§5.4） */
  chongFang(): { ok: boolean; huaiHang?: number; weiCanPian?: boolean } {
    const f = path.join(this.root, 'events.jsonl');
    if (!fs.existsSync(f)) return { ok: true };
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let lastNonEmpty = -1;
    for (let k = lines.length - 1; k >= 0; k--) { if ((lines[k] ?? '') !== '') { lastNonEmpty = k; break; } }
    this.events = [];
    this.seq = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l === '') { if (i === lines.length - 1) continue; return { ok: false, huaiHang: i + 1 }; }
      let e: ShiYanShiJian;
      try { e = JSON.parse(l) as ShiYanShiJian; } catch {
        if (i === lastNonEmpty) return { ok: false, weiCanPian: true };
        return { ok: false, huaiHang: i + 1 };
      }
      if (e.schemaVersion !== 1 || typeof e.eventId !== 'string' || e.seq !== this.seq + 1) return { ok: false, huaiHang: i + 1 };
      const tong = this.events.find((x) => x.eventId === e.eventId);
      if (tong) {
        if (queDingXingJson(tong.payload) !== queDingXingJson(e.payload)) return { ok: false, huaiHang: i + 1 };
        continue; // 同 eventId 同内容幂等
      }
      this.events.push(e);
      this.seq = e.seq;
    }
    return { ok: true };
  }
  /** append：seq 单调；写失败拒绝（调用方不得 dispatch） */
  zhuiJia(type: string, payload: Record<string, unknown>): ShiYanShiJian {
    if (!this.suo) throw new Error('lock_unavailable');
    const e: ShiYanShiJian = { schemaVersion: 1, eventId: xinId('ev'), seq: this.seq + 1, ts: Date.now(), type, payload };
    const f = path.join(this.root, 'events.jsonl');
    fs.appendFileSync(f, JSON.stringify(e) + '\n', 'utf8');
    this.events.push(e);
    this.seq = e.seq;
    return e;
  }
  shiJian(): readonly ShiYanShiJian[] { return this.events; }
  /** state.json 仅是可重建投影：tmp+同目录 rename（§5.4） */
  xieTouYing(proj: unknown): void {
    const f = path.join(this.root, 'state.json');
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(proj, null, 2), 'utf8');
    fs.renameSync(tmp, f);
  }
}

/* ── 预算账本（§6.3）：free+reserved+settled=budget 逐维度守恒 ── */

export interface YuLiuJiLu {
  reservationId: string;
  requestId: string;
  dimension: string;
  reservedUpper: number;
  settledAmount: number | null;
  status: 'pending' | 'final' | 'in_doubt';
  reservationVersion: number;
  settlementVersion: number;
  receiptHash?: string;
}
export class YuSuanZhangBen {
  private budget: Record<string, number>;
  private free: Record<string, number>;
  private reserved: Record<string, number>;
  private settled: Record<string, number>;
  private jiLu = new Map<string, YuLiuJiLu>();
  private piao = 0;
  private piaoShangXian: number;
  constructor(budget: Record<string, number>, piaoShangXian: number) {
    this.budget = { ...budget };
    this.free = { ...budget };
    this.reserved = {};
    this.settled = {};
    this.piaoShangXian = piaoShangXian;
    for (const k of Object.keys(budget)) { this.reserved[k] = 0; this.settled[k] = 0; }
  }
  shouHeng(): boolean {
    return Object.keys(this.budget).every((k) => (this.free[k] ?? 0) + (this.reserved[k] ?? 0) + (this.settled[k] ?? 0) === this.budget[k]);
  }
  /** 请求票：dispatch_intent 持久化时保守消耗；不因 429 退款（§6.3） */
  haoPiao(): boolean {
    if (this.piao >= this.piaoShangXian) return false;
    this.piao += 1;
    return true;
  }
  piaoYiHao(): number { return this.piao; }
  /** 预留：free-=w, reserved+=w；额度不足拒绝 */
  yuLiu(requestId: string, dimension: string, w: number): YuLiuJiLu | null {
    if (w < 0 || (this.free[dimension] ?? 0) < w) return null;
    this.free[dimension] = (this.free[dimension] ?? 0) - w;
    this.reserved[dimension] = (this.reserved[dimension] ?? 0) + w;
    const r: YuLiuJiLu = { reservationId: xinId('res'), requestId, dimension, reservedUpper: w, settledAmount: null, status: 'pending', reservationVersion: 1, settlementVersion: 0 };
    this.jiLu.set(r.reservationId + '|' + dimension, r);
    return r;
  }
  /** 逐维度结算幂等：同 version+receiptHash no-op；同 version 不同值冲突阻断（§6.3） */
  jieSuan(reservationId: string, dimension: string, actual: number, receiptHash: string): 'ok' | 'noop' | 'conflict' | 'violation' | 'missing' {
    const r = this.jiLu.get(reservationId + '|' + dimension);
    if (!r) return 'missing';
    if (r.status === 'final') {
      if (r.receiptHash === receiptHash && r.settledAmount === actual) return 'noop';
      return 'conflict';
    }
    if (actual > r.reservedUpper) return 'violation'; // 不夹紧伪造守恒
    this.reserved[dimension] = (this.reserved[dimension] ?? 0) - r.reservedUpper;
    this.settled[dimension] = (this.settled[dimension] ?? 0) + actual;
    this.free[dimension] = (this.free[dimension] ?? 0) + r.reservedUpper - actual;
    r.settledAmount = actual;
    r.status = 'final';
    r.settlementVersion += 1;
    r.receiptHash = receiptHash;
    return 'ok';
  }
  /** 仅证实未发送才释放；否则 in_doubt 持有预留（§6.5） */
  shiFangWeiFaSong(reservationId: string, dimension: string): boolean {
    const r = this.jiLu.get(reservationId + '|' + dimension);
    if (!r || r.status !== 'pending') return false;
    this.reserved[dimension] = (this.reserved[dimension] ?? 0) - r.reservedUpper;
    this.free[dimension] = (this.free[dimension] ?? 0) + r.reservedUpper;
    this.jiLu.delete(reservationId + '|' + dimension);
    return true;
  }
  biaoJiInDoubt(reservationId: string, dimension: string): void {
    const r = this.jiLu.get(reservationId + '|' + dimension);
    if (r && r.status === 'pending') r.status = 'in_doubt';
  }
  zhangMian(): { free: Record<string, number>; reserved: Record<string, number>; settled: Record<string, number> } {
    return { free: { ...this.free }, reserved: { ...this.reserved }, settled: { ...this.settled } };
  }
}

/* ── 证据 blob 与受权引用（§7） ── */

export class ZhengJuKu {
  private root: string;
  private refs = new Map<string, ZhengJuYinYong>();
  private zongBytes = 0;
  private shangXian: number;
  constructor(root: string, shangXian: number) { this.root = root; this.shangXian = shangXian; }
  /** 封存：tmp 写+hash+同目录只创建封存；同 hash 验身份不覆盖（§7.4） */
  fengCun(bytes: Buffer): { hash: string; ok: boolean; reason?: string } {
    if (this.zongBytes + bytes.length > this.shangXian) return { hash: '', ok: false, reason: 'evidence_incomplete' };
    const hash = sha256Bytes(bytes);
    const dir = path.join(this.root, 'objects');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, hash);
    if (fs.existsSync(f)) {
      const jiu = fs.readFileSync(f);
      if (jiu.length !== bytes.length || sha256Bytes(jiu) !== hash) return { hash, ok: false, reason: 'evidence_ref_invalid' };
    } else {
      const tmp = f + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, f);
      this.zongBytes += bytes.length;
    }
    return { hash, ok: true };
  }
  zhuCeRef(ref: ZhengJuYinYong): boolean {
    const f = path.join(this.root, 'objects', ref.contentHash);
    if (!fs.existsSync(f)) return false; // 事件存在但 blob 缺失=完整性错误
    if (ref.byteRange) {
      const n = fs.statSync(f).size;
      if (ref.byteRange.start < 0 || ref.byteRange.endExclusive > n || ref.byteRange.start >= ref.byteRange.endExclusive) return false;
    }
    this.refs.set(ref.recordId, ref);
    return true;
  }
  /** 受权解引用：权限域+hash 一致+byteRange 合法；UTF-8 边界不切坏序列 */
  duQu(ref: ZhengJuYinYong, quanXianYu: string): { ok: boolean; text?: string; trunc?: JieDuanXinXi; reason?: string } {
    const zhu = this.refs.get(ref.recordId);
    if (!zhu || zhu.contentHash !== ref.contentHash || zhu.experimentId !== ref.experimentId) return { ok: false, reason: 'evidence_ref_invalid' };
    if (ref.view === 'raw_private' && quanXianYu !== 'host') return { ok: false, reason: 'permission_denied' };
    const buf = fs.readFileSync(path.join(this.root, 'objects', ref.contentHash));
    if (ref.byteRange) {
      if (ref.byteRange.start < 0 || ref.byteRange.endExclusive > buf.length || ref.byteRange.start >= ref.byteRange.endExclusive) return { ok: false, reason: 'evidence_ref_invalid' };
    }
    let slice = buf;
    let trunc: JieDuanXinXi | undefined;
    if (ref.byteRange) {
      slice = buf.subarray(ref.byteRange.start, ref.byteRange.endExclusive);
      trunc = { truncated: true, originalBytes: buf.length, shownBytes: slice.length, reason: 'view_budget', rawRef: ref };
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return { ok: true, text, trunc };
  }
}

/* ── 严格 JSON parser + 定点 oracle（§14.2，E4） ── */

/** 极小 grammar：拒绝重复键（含 Unicode 转义拼法等价）、尾逗号、非法字面量；返回解析值 */
export function yanGeJsonParse(text: string): unknown {
  let i = 0;
  const bai = () => { while (i < text.length && /\s/.test(text[i] as string)) i++; };
  const qi = (ch: string) => { bai(); if (text[i] !== ch) throw new Error('artifact_invalid: expect ' + ch); i++; };
  function jieXi(): unknown {
    bai();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      const jian = new Set<string>();
      bai();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        bai();
        const k = jieXi() as string;
        if (typeof k !== 'string') throw new Error('artifact_invalid: key not string');
        if (jian.has(k)) throw new Error('artifact_invalid: duplicate key');
        jian.add(k);
        qi(':');
        obj[k] = jieXi();
        bai();
        if (text[i] === '}') { i++; return obj; }
        qi(',');
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      bai();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(jieXi());
        bai();
        if (text[i] === ']') { i++; return arr; }
        qi(',');
      }
    }
    if (c === '"') {
      i++;
      let out = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          i++;
          const e = text[i];
          if (e === 'u') { out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)); i += 5; }
          else { out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[e as string] ?? (() => { throw new Error('artifact_invalid: bad escape'); })(); i++; }
        } else { out += text[i]; i++; }
      }
      qi('"');
      return out;
    }
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) throw new Error('artifact_invalid: bad literal');
    i += m[0].length;
    return Number(m[0]);
  }
  const v = jieXi();
  bai();
  if (i !== text.length) throw new Error('artifact_invalid: trailing content');
  return v;
}

/** 定点分求和（BigInt，不用浮点乘 100）；amount 语法 ^[+-]?\d{1,9}\.\d{2}$ */
export function qiuHeFen(rows: Array<{ id: string; amount: string }>): bigint {
  let zong = 0n;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) throw new Error('artifact_invalid: duplicate row id');
    seen.add(r.id);
    if (!/^[+-]?\d{1,9}\.\d{2}$/.test(r.amount)) throw new Error('artifact_invalid: amount syntax');
    const fu = r.amount.startsWith('-');
    const [zheng, xiao] = r.amount.replace(/^[+-]/, '').split('.');
    const fen = BigInt(zheng as string) * 100n + BigInt(xiao as string);
    zong += fu ? -fen : fen;
  }
  return zong;
}
/** 独立验收：exists/schema/numeric/completion 分开记录；等值数值接受（10300/10300.0/1.03e4） */
export function yanShouResult(wenBen: string, rows: Array<{ id: string; amount: string }>): { exists: boolean; schema: boolean; numeric: boolean; completion: boolean; reason?: string } {
  if (!wenBen.trim()) return { exists: false, schema: false, numeric: false, completion: false, reason: 'artifact_missing' };
  let v: unknown;
  try { v = yanGeJsonParse(wenBen); } catch (e) { return { exists: true, schema: false, numeric: false, completion: false, reason: String((e as Error).message) }; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { exists: true, schema: false, numeric: false, completion: false, reason: 'artifact_invalid: root not object' };
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== 'rowCount' || keys[1] !== 'totalCents') return { exists: true, schema: false, numeric: false, completion: false, reason: 'artifact_invalid: keys' };
  const rc = o.rowCount, tc = o.totalCents;
  if (typeof rc !== 'number' || typeof tc !== 'number' || !Number.isSafeInteger(rc) || !Number.isSafeInteger(tc)) return { exists: true, schema: true, numeric: false, completion: false, reason: 'artifact_invalid: not safe integer' };
  const qiWang = qiuHeFen(rows);
  const ok = rc === rows.length && BigInt(tc) === qiWang;
  return { exists: true, schema: true, numeric: ok, completion: ok, reason: ok ? undefined : 'artifact_invalid: value mismatch' };
}

/* ── safe 工具策略（§8.2）：四类接口，未知工具拒绝 ── */

export type ShiYanGongJu = 'task_source_read' | 'task_output_write' | 'task_output_read' | 'task_artifact_validate';
export interface ShiYanGongJuShangXiaWen {
  runId: string;
  /** 宿主拥有的 ID→源文件映射（相对 POSIX 键） */
  yuanWenJian: Record<string, string>;
  /** 本 run 唯一可写产物目录（绝对路径，宿主拥有） */
  outputDir: string;
  /** 本 run 允许产物目标（相对 POSIX 键） */
  yunXuMuBiao: string[];
}
export function shiYanGongJuCeLue(tool: string, args: Record<string, unknown>, ctx: ShiYanGongJuShangXiaWen): { ok: boolean; reason?: string; luJing?: string } {
  const SI_GE: ShiYanGongJu[] = ['task_source_read', 'task_output_write', 'task_output_read', 'task_artifact_validate'];
  if (!SI_GE.includes(tool as ShiYanGongJu)) return { ok: false, reason: 'permission_denied' };
  const key = String(args.key ?? args.target ?? '');
  if (!key || key.startsWith('/') || /^[A-Za-z]:/.test(key) || key.split('/').some((p) => p === '..' || p === '')) return { ok: false, reason: 'permission_denied' };
  if (tool === 'task_source_read') {
    const f = ctx.yuanWenJian[key];
    if (!f) return { ok: false, reason: 'permission_denied' };
    return { ok: true, luJing: f };
  }
  if (!ctx.yunXuMuBiao.includes(key)) return { ok: false, reason: 'permission_denied' };
  const luJing = path.join(ctx.outputDir, ...key.split('/'));
  // 真实路径检查：防符号链接/reparse 别名越界（词法检查不够）
  const shiJi = fs.existsSync(luJing) ? fs.realpathSync(luJing) : path.resolve(luJing);
  const muLuShiJi = fs.realpathSync(ctx.outputDir);
  if (shiJi !== muLuShiJi && !shiJi.startsWith(muLuShiJi + path.sep)) return { ok: false, reason: 'permission_denied' };
  return { ok: true, luJing };
}

/* ── 程序经验准入谓词唯一一份在 @warmy/knowledge-base（zhunRuChengXu，上方 re-export）── */