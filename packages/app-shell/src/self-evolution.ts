/**
 * R232 自进化（运行期 A/B）纯逻辑层。
 * 判定科学：按「验收规则=任务」做配对比较，只比同一规则下两臂的客观结果；
 * 绝不使用支线执行次数/用户关注度作为证据（用户明确禁止）。
 * 证据不足⇒保持分栏；证据充足且无冲突⇒机械择优自动合并；主观无规则⇒人工选。
 */
import { createHash } from 'node:crypto';
import { yanGeJsonParse } from './harness-experiment.js';

export type ZhiXian = 'A' | 'B';
export interface YanShouGuiZe {
  id: string;
  kind: 'file-includes' | 'file-json-keys' | 'json-sum';
  path: string;
  includes?: string[];
  keys?: string[];
  rows?: Array<{ id: string; amount: string }>;
  expect?: { rowCount: number; totalCents: number };
  primary?: boolean;
}
export interface ChaYiJian { checkId: string; arm: ZhiXian; outcome: 'pass' | 'fail' | 'unknown'; ts: number }
export interface ZhiXianZhuangTai { turns: number; files: string[]; reply: string; overlay?: string; history?: Array<{ role: 'user' | 'them'; content: string }> }
export interface ZiJinHuaShiYan {
  id: string; sessionId: string; projectId?: string; createdAt: number; forkSeq: number;
  status: 'running' | 'split' | 'staged' | 'merged' | 'cancelled';
  mode: 'objective' | 'subjective';
  rules: YanShouGuiZe[];
  arms: Record<ZhiXian, ZhiXianZhuangTai>;
  checks: ChaYiJian[];
  winner?: ZhiXian; auto?: boolean; reason?: string;
  stagedAt?: number; stagedBy?: string; mergedAt?: number; snapshotId?: string;
  conflicts?: string[];
}

/** 从消息里解析结构化验收块：`【验收】{"rules":[...]}`（逐行，确定性，不靠模型猜）。 */
export function jieXiYanShou(messages: string[]): YanShouGuiZe[] {
  const out: YanShouGuiZe[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    for (const line of String(msg || '').split(/\r?\n/)) {
      const m = /^\s*【验收】\s*(\{.*\})\s*$/.exec(line);
      if (!m?.[1]) continue;
      let raw: unknown;
      try { raw = yanGeJsonParse(m[1]); } catch { continue; }
      const rules = (raw as { rules?: unknown })?.rules;
      if (!Array.isArray(rules)) continue;
      for (const r of rules) {
        const g = r as Partial<YanShouGuiZe>;
        if (!g || typeof g.path !== 'string' || !g.path || g.path.includes('..')) continue;
        const kind = g.kind === 'file-json-keys' || g.kind === 'json-sum' ? g.kind : 'file-includes';
        const id = createHash('sha256').update(JSON.stringify([kind, g.path, g.includes, g.keys, g.expect])).digest('hex').slice(0, 12);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id, kind, path: g.path,
          includes: Array.isArray(g.includes) ? g.includes.map(String).slice(0, 20) : undefined,
          keys: Array.isArray(g.keys) ? g.keys.map(String).slice(0, 20) : undefined,
          rows: Array.isArray(g.rows) ? (g.rows as Array<{ id: string; amount: string }>).slice(0, 200) : undefined,
          expect: g.expect && typeof g.expect.rowCount === 'number' && typeof g.expect.totalCents === 'number' ? g.expect : undefined,
          primary: g.primary !== false,
        });
      }
    }
  }
  return out.slice(0, 24);
}

/** 对单个臂跑一条规则，返回客观结果；读不到/解析不了=unknown（不伪造）。 */
export function paoGuiZe(rule: YanShouGuiZe, duWenJian: (p: string) => string | null): 'pass' | 'fail' | 'unknown' {
  const text = duWenJian(rule.path);
  if (text === null) return 'unknown';
  try {
    if (rule.kind === 'file-includes') {
      const need = rule.includes || [];
      if (!need.length) return 'unknown';
      return need.every((s) => text.includes(s)) ? 'pass' : 'fail';
    }
    const obj = yanGeJsonParse(text) as Record<string, unknown>;
    if (rule.kind === 'file-json-keys') {
      const need = rule.keys || [];
      if (!need.length) return 'unknown';
      return need.every((k) => k in obj) ? 'pass' : 'fail';
    }
    // json-sum：与合成账目 oracle 同口径（BigInt 定点）
    const rows = Array.isArray((obj as { rows?: unknown }).rows) ? (obj as { rows: Array<{ id: string; amount: string }> }).rows : rule.rows;
    if (!rows || !rule.expect) return 'unknown';
    let fen = 0n;
    for (const r of rows) {
      const fu = String(r.amount).startsWith('-');
      const [z, x] = String(r.amount).replace(/^[+-]/, '').split('.');
      fen += (fu ? -1n : 1n) * (BigInt(z || '0') * 100n + BigInt((x || '0').padEnd(2, '0').slice(0, 2)));
    }
    return rows.length === rule.expect.rowCount && Number(fen) === rule.expect.totalCents ? 'pass' : 'fail';
  } catch { return 'unknown'; }
}

/** 配对判定：同一规则两臂都已知才计入；冲突/未知/全平⇒证据不足。次数不参与。 */
export function panDingZhiXian(rules: YanShouGuiZe[], checks: ChaYiJian[]): { winner?: ZhiXian; sufficient: boolean; reason: string } {
  if (!rules.length) return { sufficient: false, reason: 'no-rules' };
  const zuiXin = new Map<string, ChaYiJian>();
  for (const c of checks) {
    const k = c.checkId + '|' + c.arm;
    const jiu = zuiXin.get(k);
    if (!jiu || c.ts >= jiu.ts) zuiXin.set(k, c);
  }
  let winA = 0, winB = 0, unknownPrimary = 0, decided = 0;
  for (const r of rules) {
    const a = zuiXin.get(r.id + '|A')?.outcome;
    const b = zuiXin.get(r.id + '|B')?.outcome;
    if (!a || !b || a === 'unknown' || b === 'unknown') { if (r.primary !== false) unknownPrimary++; continue; }
    decided++;
    if (a === 'pass' && b === 'fail') winA++;
    else if (b === 'pass' && a === 'fail') winB++;
  }
  if (unknownPrimary > 0) return { sufficient: false, reason: 'primary-unknown' };
  if (decided === 0) return { sufficient: false, reason: 'no-decided' };
  if (winA > 0 && winB > 0) return { sufficient: false, reason: 'conflict' };
  if (winA === 0 && winB === 0) return { sufficient: false, reason: 'tie' };
  return { winner: winB > 0 ? 'B' : 'A', sufficient: true, reason: winB > 0 ? 'b-wins' : 'a-wins' };
}

/**  learned overlay 库：客观胜出的 B 臂 overlay 才沉淀（validated），供下一轮 B 臂使用。 */
export interface XueXiOverlay { family: string; text: string; basis: 'objective-win'; expId: string; ts: number }
export function xuanOverlay(biao: XueXiOverlay[], family: string): string | undefined {
  const hit = biao.filter((x) => x.family === family).sort((a, b) => b.ts - a.ts)[0];
  return hit?.text;
}
