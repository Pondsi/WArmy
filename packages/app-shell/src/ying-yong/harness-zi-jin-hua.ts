/**
 * R294-3/4/5 Harness 自我改进（防复读控制器 EDG/GDR/CCS 的本项目适配）。
 *
 * 概念映射：
 *  · EDG（可执行决策图）＝守卫注册表：{触发工具/扩展名 → 确定性宿主动作}；
 *  · GDR（受保护决策复用）＝守卫命中即在宿主内完成确定动作，**不再发一轮模型请求**去问「要不要检查」；
 *  · CCS（经认证的回调替换）＝工具回执被守卫产物（语法检查结果等）认证增广，模型同一轮内自修。
 *
 * 自我改进（用户口径）：守卫执行留标记进台账；**总结时**模型裁决 keep/disable/enable/replace/disable-all
 * （disable-all＝完全关闭选项）；净收益核算（省下的请求词元 − 失败成本），持续为负自动停用并系统消息告知。
 * 治理：动作限于安全白名单（只读/建议性）⇒ 模型裁决直接生效；越出白名单（可能突破安全防护）⇒
 * 不生效，发系统消息说明好处/风险/可能后果，求用户授权（同类合并为一条）。无开关——改进全靠裁决。
 * 构造无副作用；持久化/系统消息/审计窄注入。
 */

export type ShouWeiDongZuo = 'syntax-check' | 'fullwidth-scan' | 'read-back' | 'concise-view';
/** 安全白名单：只读/建议性/视图变换动作，不触碰授权/审批/写盘边界 */
export const AN_QUAN_BAI: ShouWeiDongZuo[] = ['syntax-check', 'fullwidth-scan', 'read-back', 'concise-view'];

export interface ShouWei {
  id: string;
  ming: string;
  family: 'aci' | 'guard' | 'poka' | 'handoff' | 'smoke';
  trigger: { tool: string; ext?: string };
  action: ShouWeiDongZuo;
  enabled: boolean;
  source: 'builtin' | 'model';
  stats: { fires: number; saves: number; fails: number };
  netTokens: number;
}
export interface HarnessShiJian { ts: number; sessionId: string; guardId: string; kind: 'fire' | 'save' | 'fail'; detail?: string; tokens?: number }
export interface CaiJue { guardId: string; verdict: 'keep' | 'disable' | 'enable' | 'replace' | 'disable-all'; reason?: string; replacement?: { action?: string; ext?: string } }

export interface HarnessZiJinHuaYiLai {
  du: () => { guards?: ShouWei[]; ledger?: HarnessShiJian[] } | undefined;
  cun: (j: { guards: ShouWei[]; ledger: HarnessShiJian[] }) => void;
  jiXiTongXiaoXi: (kind: 'system', title: string, body: string) => void;
  auditLog: (op: string, detail: unknown) => void;
  shiZhong?: () => number;
  /** 一次被省下的模型请求估算词元（保守默认 1200；可由总结裁决调整） */
  shengCiJunZhi?: number;
}

const MO_REN_SHOU_WEI: ShouWei[] = [
  { id: 'aci-syntax', ming: '写/改后语法检查', family: 'aci', trigger: { tool: 'write_file|edit_file', ext: '.js/.ts/.json/.mjs/.cjs' }, action: 'syntax-check', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'aci-fullwidth', ming: '代码区全角标点提示', family: 'aci', trigger: { tool: 'write_file|edit_file', ext: '.js/.ts/.json/.mjs/.cjs' }, action: 'fullwidth-scan', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'guard-readback', ming: '写后存在/字节回读', family: 'guard', trigger: { tool: 'write_file' }, action: 'read-back', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'concise-view', ming: '长回复简洁视图（原文可展开）', family: 'aci', trigger: { tool: 'reply' }, action: 'concise-view', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
];
const LEDGER_SHANG = 500;
const FU_ZI_DONG_TING = -6000;

export function chuangJianHarnessZiJinHua(yiLai: HarnessZiJinHuaYiLai) {
  const shiZhong = yiLai.shiZhong || (() => Date.now());
  const shengCi = yiLai.shengCiJunZhi ?? 1200;
  let guards: ShouWei[] = MO_REN_SHOU_WEI.map((g) => ({ ...g, stats: { ...g.stats } }));
  let ledger: HarnessShiJian[] = [];
  let yiDu = false;
  function duHui(): void {
    if (yiDu) return;
    yiDu = true;
    try {
      const j = yiLai.du();
      if (j && Array.isArray(j.guards) && j.guards.length) {
        /* 内建守卫兜底：持久化里缺的内建项补回（版本升级新增守卫不丢） */
        const you = new Map(j.guards.map((g) => [g.id, g]));
        for (const mo of MO_REN_SHOU_WEI) if (!you.has(mo.id)) you.set(mo.id, { ...mo, stats: { ...mo.stats } });
        guards = [...you.values()];
      }
      if (j && Array.isArray(j.ledger)) ledger = j.ledger.slice(-LEDGER_SHANG);
    } catch { /* 读不回按内建默认 */ }
  }
  function luoPan(): void {
    try { yiLai.cun({ guards, ledger: ledger.slice(-LEDGER_SHANG) }); } catch { /* 落盘失败不影响本次 */ }
  }
  function zhao(id: string): ShouWei | undefined { duHui(); return guards.find((g) => g.id === id); }

  /** 守卫执行留标记（总结自我改进的素材） */
  function jiLu(e: Omit<HarnessShiJian, 'ts'>): void {
    duHui();
    const shiJian: HarnessShiJian = { ...e, ts: shiZhong() };
    ledger.push(shiJian);
    if (ledger.length > LEDGER_SHANG) ledger = ledger.slice(-LEDGER_SHANG);
    const g = zhao(e.guardId);
    if (g) {
      if (e.kind === 'fire') g.stats.fires += 1;
      if (e.kind === 'save') { g.stats.saves += 1; g.netTokens += Math.max(0, Number(e.tokens) || shengCi); }
      if (e.kind === 'fail') { g.stats.fails += 1; g.netTokens -= 2000; }
      /* 净收益持续为负 ⇒ 自动停用（完全关闭的自动形态），系统消息告知，总结可恢复 */
      if (g.enabled && g.netTokens < FU_ZI_DONG_TING && g.stats.fires >= 5) {
        g.enabled = false;
        try {
          yiLai.jiXiTongXiaoXi('system', 'Harness 守卫自动停用',
            `守卫「${g.ming}」(${g.id}) 净收益持续为负（${g.netTokens} 词元，失败 ${g.stats.fails} 次），已自动停用。总结时可裁决恢复或更换；这是自我改进的一部分，无需手动开关。`);
        } catch { /* noop */ }
        try { yiLai.auditLog('harness.guard-auto-disabled', { id: g.id, netTokens: g.netTokens }); } catch { /* noop */ }
      }
    }
    luoPan();
  }

  /** 总结提示词段：守卫表＋近期台账＋裁决格式（模型判断是否正确/允许/更换/不用守卫更好） */
  function zongJieDuan(): string {
    duHui();
    const biao = guards.map((g) => `- ${g.id}｜${g.ming}｜${g.enabled ? '启用' : '停用'}｜触发 ${g.stats.fires} 省 ${g.stats.saves} 败 ${g.stats.fails}｜净 ${g.netTokens}`).join('\n');
    const shi = ledger.slice(-20).map((e) => `- ${new Date(e.ts).toISOString().slice(0, 16)} ${e.guardId} ${e.kind}${e.detail ? ' ' + e.detail.slice(0, 60) : ''}`).join('\n');
    return '\n【Harness 守卫台账（自我改进素材）】\n' + biao + '\n近期执行：\n' + (shi || '（无）')
      + '\n请裁决这些守卫：是否正确、是否允许、是否更换、是否此处不用守卫更好（目标：不增加性能负担的前提下提高效率，净收益为正并持续扩大）。'
      + '在整理结果**末尾**单独一行输出：【Harness裁决】{"judgments":[{"guardId":"…","verdict":"keep|disable|enable|replace|disable-all","reason":"…","replacement":{"action":"syntax-check|fullwidth-scan|read-back","ext":"…"}}]}'
      + '（disable-all＝完全关闭全部守卫；动作只许安全白名单内，越界会被宿主拦下并转用户授权。没有可改的就输出空 judgments。）\n';
  }

  /** 从总结回复里解析裁决块（确定性解析，不靠猜） */
  function jieXiCaiJue(txt: string): CaiJue[] {
    const m = /【Harness裁决】\s*(\{[\s\S]*?\})\s*(?:\n|$)/.exec(String(txt || ''));
    if (!m || !m[1]) return [];
    try {
      const j = JSON.parse(m[1]) as { judgments?: unknown };
      if (!Array.isArray(j.judgments)) return [];
      const out: CaiJue[] = [];
      for (const it of j.judgments) {
        const o = it as Partial<CaiJue>;
        if (!o || typeof o.guardId !== 'string') continue;
        if (!['keep', 'disable', 'enable', 'replace', 'disable-all'].includes(String(o.verdict))) continue;
        out.push({ guardId: o.guardId, verdict: o.verdict as CaiJue['verdict'], reason: String(o.reason || '').slice(0, 200), replacement: o.replacement });
      }
      return out;
    } catch { return []; }
  }

  /** 应用裁决：白名单内直接生效；越界⇒不生效＋系统消息求授权（同类合并一条） */
  function yingYongCaiJue(pan: CaiJue[]): { applied: number; needsAuth: string[] } {
    duHui();
    let applied = 0;
    const yueJie: string[] = [];
    for (const c of pan) {
      if (c.verdict === 'disable-all') {
        for (const g of guards) g.enabled = false;
        applied += 1;
        try { yiLai.auditLog('harness.disable-all', { reason: c.reason }); } catch { /* noop */ }
        continue;
      }
      const g = zhao(c.guardId);
      if (!g) continue;
      if (c.verdict === 'keep') continue;
      if (c.verdict === 'disable') { g.enabled = false; applied += 1; continue; }
      if (c.verdict === 'enable') { g.enabled = true; g.netTokens = Math.max(g.netTokens, 0); applied += 1; continue; }
      if (c.verdict === 'replace') {
        const dong = String(c.replacement?.action || '') as ShouWeiDongZuo;
        if (!AN_QUAN_BAI.includes(dong)) { yueJie.push(`${g.id}→${dong || '(空)'}`); continue; }
        g.action = dong;
        if (c.replacement?.ext) g.trigger.ext = String(c.replacement.ext).slice(0, 120);
        g.source = 'model';
        applied += 1;
      }
    }
    if (applied) luoPan();
    if (yueJie.length) {
      /* 同类合并为一条系统消息：好处/可能突破的防护/可能后果，求授权 */
      try {
        yiLai.jiXiTongXiaoXi('system', 'Harness 改进需授权',
          `总结自我改进提议了超出安全白名单的守卫动作：${yueJie.join('；')}。\n好处：可能进一步减少模型往返、提高效率。\n可能突破的防护：这些动作不在只读/建议性白名单内，可能触及写盘/执行/授权边界。\n可能后果：错误自动执行、越权操作、不可逆副作用。\n宿主已拦下未生效。如允许，请在会话里明确回复授权（或拒绝）；同类提议已合并为本条。`);
      } catch { /* noop */ }
      try { yiLai.auditLog('harness.needs-auth', { items: yueJie }); } catch { /* noop */ }
    }
    return { applied, needsAuth: yueJie };
  }

  /** 总结回复里剥掉裁决块（不让它进知识条目） */
  function boLiCaiJueKuai(txt: string): string {
    return String(txt || '').replace(/\n?【Harness裁决】\s*\{[\s\S]*?\}\s*(?:\n|$)/, '').trim();
  }

  return { jiLu, zongJieDuan, jieXiCaiJue, yingYongCaiJue, boLiCaiJueKuai, get guards() { duHui(); return guards; }, get ledger() { duHui(); return ledger; } };
}
