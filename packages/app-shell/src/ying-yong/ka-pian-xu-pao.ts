import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type ZiDuan =
  | { type: 'string'; title: string; maxLength: number; minLength?: number; enum?: string[]; multiline?: boolean }
  | { type: 'integer'; title: string; minimum: number; maximum: number }
  | { type: 'boolean'; title: string }
  | { type: 'array'; title: string; items: { type: 'string'; maxLength: number }; minItems: number; maxItems: number };
export type ShuJu = Record<string, string | number | boolean | string[]>;
export type Lei = 'plan' | 'write_file' | 'clarify' | 'undo' | 'duty-threshold' | 'action';
export interface HuiFuGuiGe { type: 'object'; additionalProperties: false; required: string[]; properties: Record<string, ZiDuan> }
export const HUI_FU_GUI_GE_VERSION = 1;
export const HUI_FU_GUI_GE: Readonly<Record<Lei, HuiFuGuiGe>> = {
  plan: { type: 'object', additionalProperties: false, required: ['goal', 'steps', 'acceptance'], properties: {
    goal: { type: 'string', title: '目标', minLength: 1, maxLength: 1024 }, steps: { type: 'array', title: '步骤（每行一项）', items: { type: 'string', maxLength: 500 }, minItems: 2, maxItems: 10 }, acceptance: { type: 'string', title: '验收条件', minLength: 1, maxLength: 1500, multiline: true },
  } },
  write_file: { type: 'object', additionalProperties: false, required: ['content', 'mode'], properties: {
    content: { type: 'string', title: '正文', maxLength: 32768, multiline: true }, mode: { type: 'string', title: '写入方式', maxLength: 8, enum: ['append', 'replace'] },
  } },
  clarify: { type: 'object', additionalProperties: false, required: ['detail'], properties: { detail: { type: 'string', title: '明确你的选择或填写其他要求', minLength: 1, maxLength: 1200 } } },
  undo: { type: 'object', additionalProperties: false, required: [], properties: {} },
  'duty-threshold': { type: 'object', additionalProperties: false, required: [], properties: {} },
  action: { type: 'object', additionalProperties: false, required: [], properties: {} },
};
export function yanHuiFu(lei: Lei, v: unknown): ShuJu {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid-response-object');
  const s = HUI_FU_GUI_GE[lei], p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => !Object.hasOwn(s.properties, k)) || s.required.some((k) => !Object.hasOwn(p, k))) throw new Error('invalid-response-fields');
  const out: ShuJu = {};
  for (const [k, x] of Object.entries(p)) {
    const f = s.properties[k]!;
    if (f.type === 'string' && typeof x === 'string' && x.length <= f.maxLength && x.trim().length >= (f.minLength || 0) && (!f.enum || f.enum.includes(x))) out[k] = x;
    else if (f.type === 'boolean' && typeof x === 'boolean') out[k] = x;
    else if (f.type === 'integer' && typeof x === 'number' && Number.isSafeInteger(x) && x >= f.minimum && x <= f.maximum) out[k] = x;
    else if (f.type === 'array' && Array.isArray(x) && x.length >= f.minItems && x.length <= f.maxItems && x.every((y) => typeof y === 'string' && y.trim() && y.length <= f.items.maxLength)) out[k] = [...x] as string[];
    else throw new Error('invalid-response-value:' + k);
  }
  return out;
}
export interface XuPaoDian {
  id: string; nonce: string; revision: number; schemaVersion: number; sid: string; owner: string; task: string; kind: Lei;
  title: string; detail: string; initial: ShuJu; ref: Record<string, string>; at: number;
  status: 'pending' | 'approved' | 'applying' | 'done' | 'cancelled' | 'uncertain';
  response?: ShuJu; receipt?: string;
}
export type XinXuPaoDian = Omit<XuPaoDian, 'id' | 'nonce' | 'revision' | 'schemaVersion' | 'status' | 'at' | 'response' | 'receipt'>;
const ZHUANG_TAI_QIAN_YI: Record<XuPaoDian['status'], readonly XuPaoDian['status'][]> = {
  pending: ['approved', 'cancelled', 'applying'], approved: ['applying', 'cancelled', 'done'],
  applying: ['done', 'cancelled', 'uncertain', 'pending'], done: [], cancelled: [], uncertain: [],
};
export interface XuPaoRenWu {
  id: string; owner: string; sid: string; at: number; inputHash: string; messageSeq: number; deadlineAt?: number; stopped: boolean;
}
export function chuangJianXuPao(file: string, fsX = fs, now = Date.now) {
  function duRenWu(): XuPaoRenWu[] {
    try {
      const j = JSON.parse(fsX.readFileSync(file, 'utf8'));
      if (j.version !== 1 || !Array.isArray(j.records) || (j.tasks != null && !Array.isArray(j.tasks))) throw new Error('checkpoint-invalid');
      const tasks: XuPaoRenWu[] = j.tasks || [];
      if (tasks.some((t) => !t || !t.id || !t.owner || !t.sid || typeof t.stopped !== 'boolean' || !Number.isFinite(t.at) || typeof t.inputHash !== 'string' || !Number.isSafeInteger(t.messageSeq))) throw new Error('checkpoint-task-invalid');
      return tasks;
    } catch (e) { if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw e; }
  }
  function du(): XuPaoDian[] {
    try {
      const j = JSON.parse(fsX.readFileSync(file, 'utf8'));
      if (j.version !== 1 || !Array.isArray(j.records) || j.records.length > 2000) throw new Error('checkpoint-invalid');
      return j.records.map((row: XuPaoDian) => {
        if (!row || !Object.hasOwn(HUI_FU_GUI_GE, row.kind) || !Object.hasOwn(ZHUANG_TAI_QIAN_YI, row.status) || !row.id || !row.nonce || !row.owner || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isFinite(row.at)) throw new Error('checkpoint-invalid');
        return { ...row, schemaVersion: row.schemaVersion ?? HUI_FU_GUI_GE_VERSION };
      });
    } catch (e) { if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return []; throw e; }
  }
  function shuiWei(): number {
    try {
      const j = JSON.parse(fsX.readFileSync(file, 'utf8'));
      const n = j.eventSeq ?? 0;
      if (j.version !== 1 || !Number.isSafeInteger(n) || n < 0) throw new Error('checkpoint-event-sequence-invalid');
      return n;
    } catch (e) { if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return 0; throw e; }
  }
  function cun(rows: XuPaoDian[], tasks = duRenWu()): void {
    const eventSeq = shuiWei() + 1;
    fsX.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fsX.writeFileSync(tmp, JSON.stringify({ version: 1, records: rows, tasks, eventSeq }), { encoding: 'utf8', mode: 0o600, flush: true });
    fsX.renameSync(tmp, file);
  }
  function renWu(owner: string, sid: string): XuPaoRenWu | undefined { return duRenWu().find((t) => t.owner === owner && t.sid === sid); }
  function kaiRenWu(owner: string, sid: string, inputHash: string, messageSeq: number, deadlineAt?: number): XuPaoRenWu {
    if (!owner || !sid || !inputHash || !Number.isSafeInteger(messageSeq)) throw new Error('checkpoint-task-invalid');
    const tasks = duRenWu(), rows = du();
    const next: XuPaoRenWu = { id: crypto.randomUUID(), owner, sid, inputHash, messageSeq, deadlineAt, at: now(), stopped: false };
    for (const q of rows) if (q.owner === owner && q.sid === sid && ['pending', 'approved'].includes(q.status) && ['plan', 'write_file', 'clarify'].includes(q.kind)) { q.status = 'cancelled'; q.revision++; }
    const keep = tasks.filter((t) => t.owner !== owner || t.sid !== sid);
    if (keep.length >= 2000) throw new Error('checkpoint-task-limit');
    cun(rows, [...keep, next]); return next;
  }
  function tingRenWu(owner: string, sid: string): void {
    const tasks = duRenWu(), rows = du();
    const t = tasks.find((r) => r.owner === owner && r.sid === sid);
    if (t) t.stopped = true;
    for (const q of rows) if (q.owner === owner && q.sid === sid && ['pending', 'approved'].includes(q.status) && ['plan', 'write_file', 'clarify'].includes(q.kind)) { q.status = 'cancelled'; q.revision++; }
    cun(rows, tasks);
  }
  function xin(x: XinXuPaoDian): XuPaoDian {
    const rows = du();
    if (!x.owner || !x.sid || !x.task) throw new Error('checkpoint-owner-required');
    const old = rows.find((r) => r.sid === x.sid && r.owner === x.owner && r.task === x.task && r.kind === x.kind && r.status === 'pending');
    if (old && JSON.stringify([old.initial, old.ref, old.detail]) === JSON.stringify([x.initial, x.ref, x.detail])) return old;
    if (old) { old.status = 'cancelled'; old.revision++; }
    const active = rows.filter((r) => !['done', 'cancelled'].includes(r.status));
    if (active.length >= 80) throw new Error('checkpoint-limit');
    const r: XuPaoDian = { ...x, initial: yanHuiFu(x.kind, x.initial), id: 'resume-' + crypto.randomUUID(), nonce: crypto.randomUUID(), revision: 1, schemaVersion: HUI_FU_GUI_GE_VERSION, at: now(), status: 'pending' };
    const generations = new Set(duRenWu().map((t) => t.id));
    const completed = rows.filter((p) => p.status === 'done' || p.status === 'cancelled');
    const retained = new Map([...completed.slice(-120), ...completed.filter((p) => generations.has(p.ref.generation || '') && ['action', 'write_file', 'plan', 'clarify', 'undo'].includes(p.kind))].map((p) => [p.id, p]));
    if (retained.size + active.length >= 2000) throw new Error('checkpoint-limit');
    cun([...retained.values(), ...active, r]);
    return r;
  }
  function bian(id: string, owner: string, from: XuPaoDian['status'], to: XuPaoDian['status'], patch: Partial<Pick<XuPaoDian, 'response' | 'receipt' | 'ref'>> = {}): XuPaoDian {
    const rows = du(), r = rows.find((p) => p.id === id);
    if (!r || !owner || r.owner !== owner || r.status !== from || !ZHUANG_TAI_QIAN_YI[from].includes(to)) throw new Error('checkpoint-stale');
    Object.assign(r, patch, { status: to, revision: r.revision + 1 }); cun(rows); return r;
  }
  function da(owner: string, p: { id: string; nonce: string; revision: number; schemaVersion: number; accept: boolean; response?: unknown }): XuPaoDian {
    const r = du().find((q) => q.id === p.id && q.owner === owner);
    if (!r || r.revision !== p.revision || r.nonce !== p.nonce || r.status !== 'pending') throw new Error('checkpoint-stale');
    if (r.schemaVersion !== HUI_FU_GUI_GE_VERSION || p.schemaVersion !== r.schemaVersion || typeof p.accept !== 'boolean') throw new Error('checkpoint-invalid-schema-version');
    return bian(r.id, owner, 'pending', p.accept ? 'approved' : 'cancelled', p.accept ? { response: yanHuiFu(r.kind, p.response) } : { receipt: r.kind === 'undo' ? 'kept' : 'rejected' });
  }
  function huiFu(): void {
    const rows = du(); let changed = false;
    for (const r of rows) if (r.status === 'applying') { r.status = 'uncertain'; r.revision++; changed = true; }
    if (changed) cun(rows);
  }
  function quXiaoDian(owner: string, id: string): void {
    const r = du().find((p) => p.id === id && p.owner === owner);
    if (r && (r.status === 'pending' || r.status === 'approved')) bian(id, owner, r.status, 'cancelled');
  }
  function quXiaoHuiHua(owner: string, sid: string): void {
    const rows = du(); let changed = false;
    for (const r of rows) if (r.owner === owner && r.sid === sid && ['pending', 'approved'].includes(r.status) && ['plan', 'write_file', 'clarify'].includes(r.kind)) {
      r.status = 'cancelled'; ++r.revision; changed = true;
    }
    if (changed) cun(rows);
  }
  return { du, xin, da, bian, huiFu, quXiaoHuiHua, quXiaoDian, renWu, kaiRenWu, tingRenWu, shuiWei };
}
