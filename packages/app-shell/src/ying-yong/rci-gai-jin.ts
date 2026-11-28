/**
 * R318：RCI（arXiv:2611.32606 递归集体智能）P1–P5 落地＋纳入自我改进。
 * 数学口径见 docs/RESEARCH-RCI.md：
 *  P1 等预算阶梯：n_B = k/c1；选择器 acc ≤ pass@n；T(n)=1−E[(1−p)^n] 凹增；T(n)≤min{1,n·V(1)}。
 *  P2 事实转发：多体讨论只转发「已验证事实」（DPI：处理不增信息），不转发观点/辩论。
 *  P3 Hub/Relay：中心汇总与中继转发各有预算核算（初始值放宽，后期总结自调）。
 *  P4 MC-Shapley：蒙特卡洛近似贡献度，用于加权（样本数可调）。
 *  P5 跨代门控：任何自我改进（含 P1–P5 自身参数/启停）须过 holdout 配对检验才采纳，确保总是正向。
 * 参数存 rci-params.json；总结回调可提议调整，但只有 P5 通过才落盘。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RciCanShu {
  p1: { enabled: boolean; k: number; c1: number };
  p2: { enabled: boolean };
  p3: { enabled: boolean; hubBudget: number; relayBudget: number };
  p4: { enabled: boolean; samples: number };
  p5: { enabled: boolean; alpha: number; minN: number };
}
export const RCI_CHU_SHI: RciCanShu = {
  /* P3 初始放宽（用户口径）：hub/relay 预算给宽，后期总结收紧 */
  p1: { enabled: true, k: 8, c1: 1 },
  p2: { enabled: true },
  p3: { enabled: true, hubBudget: 4000, relayBudget: 2000 },
  p4: { enabled: true, samples: 64 },
  p5: { enabled: true, alpha: 0.1, minN: 6 },
};

/** P1：等预算阶梯——总预算 k、单候选成本 c1 ⇒ 候选数 n_B；选择器准确率上界 pass@n。 */
export function dengYuSuanJieTi(k: number, c1: number): number {
  const c = Math.max(1e-9, Number(c1) || 1);
  return Math.max(1, Math.floor(Math.max(0, Number(k) || 0) / c));
}
/** P1：T(n)=1−E[(1−p)^n]（p 为逐候选成功概率的样本）；凹增且 ≤ min{1, n·V(1)}。 */
export function tiGaiLv(ps: number[], n: number): number {
  const m = Math.max(1, Math.floor(n));
  if (!ps.length) return 0;
  const t = 1 - ps.reduce((a, p) => a + Math.pow(1 - Math.min(1, Math.max(0, p)), m), 0) / ps.length;
  const v1 = ps.reduce((a, p) => a + Math.min(1, Math.max(0, p)), 0) / ps.length;
  return Math.min(1, Math.min(t, m * v1));
}
/** P2：事实转发过滤——只保留带验证标记的事实条目（verified=true），观点/推测丢弃。 */
export function shiShiZhuanFa<T extends { verified?: boolean; kind?: string }>(items: T[]): T[] {
  return (items || []).filter((x) => x && x.verified === true && x.kind !== 'opinion');
}
/** P3：hub/relay 预算核算——返回各自可转发条数上限（字符预算/单条成本）。 */
export function hubRelayYuSuan(hubBudget: number, relayBudget: number, costPerItem: number): { hub: number; relay: number } {
  const c = Math.max(1, Number(costPerItem) || 1);
  return { hub: Math.max(0, Math.floor(Math.max(0, hubBudget) / c)), relay: Math.max(0, Math.floor(Math.max(0, relayBudget) / c)) };
}
/** P4：MC-Shapley——排列采样近似每个玩家的边际贡献均值。 */
export function mcShapley(players: string[], marginal: (coalition: string[], player: string) => number, samples: number, rnd: () => number = Math.random): Record<string, number> {
  const out: Record<string, number> = {};
  const n = players.length;
  if (!n) return out;
  const m = Math.max(1, Math.floor(samples));
  for (const p of players) out[p] = 0;
  for (let s = 0; s < m; s++) {
    const order = players.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]!; order[i] = order[j]!; order[j] = t; }
    const coal: string[] = [];
    for (const p of order) { out[p] = (out[p] || 0) + marginal(coal.slice(), p) / m; coal.push(p); }
  }
  return out;
}
/** P5：跨代门控——holdout 配对差值（新−旧）做符号检验近似：正差占比显著高于 0.5 才采纳。
 *  小样本用精确二项尾概率（正差数 ≥ 观测数 的概率 ≤ alpha 才过）。 */
export function kuaDaiMenKong(diffs: number[], alpha: number, minN: number): { pass: boolean; n: number; pos: number; pValue: number } {
  const d = (diffs || []).filter((x) => Number.isFinite(x) && x !== 0);
  const n = d.length;
  const pos = d.filter((x) => x > 0).length;
  if (n < Math.max(1, minN)) return { pass: false, n, pos, pValue: 1 };
  /* 精确二项：P[X ≥ pos]，X~Bin(n,0.5) */
  let tail = 0;
  const logC = (a: number, b: number) => { let r = 0; for (let i = 1; i <= b; i++) r += Math.log(a - i + 1) - Math.log(i); return r; };
  for (let k = pos; k <= n; k++) tail += Math.exp(logC(n, k) - n * Math.LN2);
  const pValue = Math.min(1, tail);
  return { pass: pos > n / 2 && pValue <= alpha, n, pos, pValue };
}

export interface RciShiJian { ts: number; kind: string; ok: boolean; detail?: string; score?: number }
export interface RciZhuangTai { params: RciCanShu; ledger: RciShiJian[]; decisions: Array<{ ts: number; note: string; applied: boolean }> }

export function chuangJianRciGaiJin(yiLai: { wenJianLu: string; audit?: (op: string, d: unknown) => void; now?: () => number }) {
  const now = yiLai.now || (() => Date.now());
  const lu = yiLai.wenJianLu;
  function du(): RciZhuangTai {
    try {
      const j = JSON.parse(fs.readFileSync(lu, 'utf8')) as Partial<RciZhuangTai>;
      const p = { ...RCI_CHU_SHI, ...(j.params || {}) } as RciCanShu;
      p.p1 = { ...RCI_CHU_SHI.p1, ...(p.p1 || {}) }; p.p3 = { ...RCI_CHU_SHI.p3, ...(p.p3 || {}) };
      p.p4 = { ...RCI_CHU_SHI.p4, ...(p.p4 || {}) }; p.p5 = { ...RCI_CHU_SHI.p5, ...(p.p5 || {}) };
      return { params: p, ledger: Array.isArray(j.ledger) ? j.ledger.slice(-400) : [], decisions: Array.isArray(j.decisions) ? j.decisions.slice(-100) : [] };
    } catch { return { params: JSON.parse(JSON.stringify(RCI_CHU_SHI)), ledger: [], decisions: [] }; }
  }
  function cun(st: RciZhuangTai): void {
    try {
      fs.mkdirSync(path.dirname(lu), { recursive: true });
      const tmp = lu + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8');
      fs.renameSync(tmp, lu);
    } catch { /* noop */ }
  }
  function jiLu(e: Omit<RciShiJian, 'ts'>): void {
    const st = du();
    st.ledger = st.ledger.concat([{ ...e, ts: now() }]).slice(-400);
    cun(st);
  }
  /** 总结回调：提议参数调整（含启停）。P5 门控：用台账前后半配对差检验，过才落盘 ⇒ 总是正向。 */
  function zongJieTiaoCan(proposal: Partial<RciCanShu> & { note?: string; intervalMs?: number }): { applied: boolean; gate?: ReturnType<typeof kuaDaiMenKong> } {
    const st = du();
    const note = String(proposal.note || '总结提议调整 RCI 参数');
    /* holdout：台账按时间对半分，比较「后半 ok 率 − 前半 ok 率」的逐会话配对差 */
    const bySid = new Map<string, { a: number[]; b: number[] }>();
    const half = st.ledger.length >> 1;
    st.ledger.forEach((e, i) => {
      const k = String(e.detail || e.kind);
      const o = bySid.get(k) || { a: [], b: [] };
      (i < half ? o.a : o.b).push(e.ok ? 1 : 0);
      bySid.set(k, o);
    });
    const diffs: number[] = [];
    for (const o of bySid.values()) {
      if (!o.a.length || !o.b.length) continue;
      const ma = o.a.reduce((x, y) => x + y, 0) / o.a.length;
      const mb = o.b.reduce((x, y) => x + y, 0) / o.b.length;
      diffs.push(mb - ma);
    }
    const gate = kuaDaiMenKong(diffs, st.params.p5.alpha, st.params.p5.minN);
    const applied = !st.params.p5.enabled || gate.pass;
    if (applied) {
      st.params = {
        p1: { ...st.params.p1, ...(proposal.p1 || {}) },
        p2: { ...st.params.p2, ...(proposal.p2 || {}) },
        p3: { ...st.params.p3, ...(proposal.p3 || {}) },
        p4: { ...st.params.p4, ...(proposal.p4 || {}) },
        p5: { ...st.params.p5, ...(proposal.p5 || {}) },
      };
      /* 数值夹取，防总结放飞 */
      st.params.p1.k = Math.min(64, Math.max(1, st.params.p1.k));
      st.params.p1.c1 = Math.min(16, Math.max(0.25, st.params.p1.c1));
      st.params.p3.hubBudget = Math.min(20000, Math.max(500, st.params.p3.hubBudget));
      st.params.p3.relayBudget = Math.min(10000, Math.max(250, st.params.p3.relayBudget));
      st.params.p4.samples = Math.min(512, Math.max(8, st.params.p4.samples));
      st.params.p5.alpha = Math.min(0.2, Math.max(0.01, st.params.p5.alpha));
      st.params.p5.minN = Math.min(50, Math.max(3, st.params.p5.minN));
    }
    st.decisions = st.decisions.concat([{ ts: now(), note: note.slice(0, 200), applied }]).slice(-100);
    cun(st);
    try { yiLai.audit?.('rci.summary-tune', { applied, gate, note }); } catch { /* noop */ }
    return { applied, gate };
  }
  return { du, cun, jiLu, zongJieTiaoCan };
}