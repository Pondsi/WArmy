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
 * 治理：动作限于安全白名单（只读/建议性/视图变换）⇒ 模型裁决直接生效；越出白名单（可能突破安全防护）⇒
 * 不生效，发系统消息说明好处/风险/可能后果，求用户授权（同类合并为一条）。
 *
 * R295 扩展：
 *  · 防复读/ACI/软门禁(poka)/接班(handoff)/冒烟(smoke) **每个**守卫都进总结裁决（注册表全覆盖）；
 *  · 简洁输出：① 抽取式默认（零模型成本、原文不动）＋② 结构化简洁（支持结构化模型可选，concise-structured 守卫）；
 *    中文分句器参数（maxJu/短文阈值/话语标记/lead-bias/内容词密度权/长度惩罚）纳入自我改进，模型裁决可调；
 *  · 自动停用后重新启用：总结 enable 裁决 ⇒ enabled=true 且净收益重置≥0（清 autoDisabled 标记，避免历史负值立即再停）。
 * 构造无副作用；持久化/系统消息/审计窄注入。
 */

export type ShouWeiDongZuo = 'syntax-check' | 'fullwidth-scan' | 'read-back' | 'concise-view' | 'concise-structured' | 'soft-gate' | 'handoff-read' | 'smoke-gate';
/** 安全白名单：只读/建议性/视图变换动作，不触碰授权/审批/写盘边界。
 *  soft-gate/handoff-read/smoke-gate 属安全门禁类，replace 到它们＝越界（须用户授权）。 */
export const AN_QUAN_BAI: ShouWeiDongZuo[] = ['syntax-check', 'fullwidth-scan', 'read-back', 'concise-view', 'concise-structured'];

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
  /** 净收益持续为负被自动停用的标记（enable 裁决清除；供总结区分「人为停用」与「自动停用」） */
  autoDisabled?: boolean;
}
export interface HarnessShiJian { ts: number; sessionId: string; guardId: string; kind: 'fire' | 'save' | 'fail'; detail?: string; tokens?: number }
export interface CaiJue { guardId: string; verdict: 'keep' | 'disable' | 'enable' | 'replace' | 'disable-all'; reason?: string; replacement?: { action?: string; ext?: string } }

/** 中文分句器/抽取式压缩参数（自我改进可调；渲染层 jian-jie-ya-suo.js 消费） */
export interface FenJuQiPeiZhi {
  /** 最多保留句数 */
  maxJu: number;
  /** 短文阈值（≤此字数原样返回） */
  duanWen: number;
  /** 句首话语标记（剥离后再打分） */
  huaYuBiaoJi: string[];
  /** lead-bias：前几句的加权（索引 0/1/2…） */
  leadBias: number[];
  /** 内容词密度权重 */
  miDuQuan: number;
  /** 超长句惩罚分母 */
  changFa: number;
}

export interface HarnessZiJinHuaYiLai {
  du: () => { guards?: ShouWei[]; ledger?: HarnessShiJian[]; fenJuQi?: FenJuQiPeiZhi; lastCaiJueTs?: number } | undefined;
  cun: (j: { guards: ShouWei[]; ledger: HarnessShiJian[]; fenJuQi: FenJuQiPeiZhi; lastCaiJueTs: number }) => void;
  jiXiTongXiaoXi: (kind: 'system', title: string, body: string) => void;
  auditLog: (op: string, detail: unknown) => void;
  onFeedback?: () => void;
  /** R298：守卫名称的迪文确定渲染（sidecar 命中且 hash 配⇒预算渲染；否则原文）。禁用/不可用恒原文。 */
  moXingWenBen?: (id: string, text: string) => string;
  shiZhong?: () => number;
  /** 一次被省下的模型请求估算词元（保守默认 1200；可由总结裁决调整） */
  shengCiJunZhi?: number;
}

const MO_REN_SHOU_WEI: ShouWei[] = [
  { id: 'aci-syntax', ming: '写/改后语法检查', family: 'aci', trigger: { tool: 'write_file|edit_file', ext: '.js/.ts/.json/.mjs/.cjs' }, action: 'syntax-check', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'aci-fullwidth', ming: '代码区全角标点提示', family: 'aci', trigger: { tool: 'write_file|edit_file', ext: '.js/.ts/.json/.mjs/.cjs' }, action: 'fullwidth-scan', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'guard-readback', ming: '写后存在/字节回读', family: 'guard', trigger: { tool: 'write_file' }, action: 'read-back', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'concise-view', ming: '长回复简洁视图（抽取式默认，原文可展开）', family: 'aci', trigger: { tool: 'reply' }, action: 'concise-view', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  /* R295 ②：结构化简洁——支持结构化的模型可选；默认停用 ⇒ ① 抽取式零成本默认。自我改进可启用。 */
  { id: 'concise-structured', ming: '结构化简洁（支持结构化模型可选）', family: 'aci', trigger: { tool: 'reply' }, action: 'concise-structured', enabled: false, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  /* R295：中文分句器参数自改进守卫（台账素材；参数本体在 fenJuQi） */
  { id: 'concise-splitter', ming: '中文分句器参数自改进', family: 'aci', trigger: { tool: 'reply' }, action: 'concise-view', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  /* R295：软门禁/接班/冒烟每个都进总结自我改进 */
  { id: 'poka-escape', ming: '软门禁越狱审批（相对路径＋理由）', family: 'poka', trigger: { tool: 'write_file|edit_file' }, action: 'soft-gate', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'handoff-read', ming: '接班先读交接/日志', family: 'handoff', trigger: { tool: 'rebirth' }, action: 'handoff-read', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
  { id: 'smoke-gate', ming: 'verified 须新鲜冒烟证据', family: 'smoke', trigger: { tool: 'plan_verify' }, action: 'smoke-gate', enabled: true, source: 'builtin', stats: { fires: 0, saves: 0, fails: 0 }, netTokens: 0 },
];
const MO_REN_FEN_JU_QI: FenJuQiPeiZhi = {
  maxJu: 3, duanWen: 120,
  huaYuBiaoJi: ['首先', '其次', '再次', '最后', '总而言之', '综上所述', '总的来说', '总体来看', '不得不说', '值得一提的是', '可以说', '某种程度上', '众所周知', '简单来说', '换句话说', '也就是说', '需要注意的是', '需要指出的是', '不可否认'],
  leadBias: [2, 1, 0], miDuQuan: 2, changFa: 200,
};
const LEDGER_SHANG = 500;
const FU_ZI_DONG_TING = -6000;

/** 分句器参数边界校验（模型裁决可能给越界值，宿主收窄到安全范围；视图变换属白名单内） */
function guiFanFenJuQi(p: Partial<FenJuQiPeiZhi> | null | undefined, jiu: FenJuQiPeiZhi): FenJuQiPeiZhi {
  if (!p || typeof p !== 'object') return { ...jiu, huaYuBiaoJi: [...jiu.huaYuBiaoJi], leadBias: [...jiu.leadBias] };
  const clamp = (v: unknown, lo: number, hi: number, mo: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : mo; };
  const maxJu = Math.round(clamp(p.maxJu, 1, 6, jiu.maxJu));
  const duanWen = Math.round(clamp(p.duanWen, 40, 400, jiu.duanWen));
  const miDuQuan = clamp(p.miDuQuan, 0, 5, jiu.miDuQuan);
  const changFa = Math.round(clamp(p.changFa, 50, 500, jiu.changFa));
  let huaYuBiaoJi = jiu.huaYuBiaoJi;
  if (Array.isArray(p.huaYuBiaoJi)) {
    huaYuBiaoJi = p.huaYuBiaoJi.map((x) => String(x || '').trim()).filter((x) => x && x.length <= 20).slice(0, 40);
  }
  let leadBias = jiu.leadBias;
  if (Array.isArray(p.leadBias)) {
    leadBias = p.leadBias.slice(0, 4).map((x) => clamp(x, 0, 5, 0));
    if (!leadBias.length) leadBias = [...jiu.leadBias];
  }
  return { maxJu, duanWen, huaYuBiaoJi, leadBias, miDuQuan, changFa };
}

export function chuangJianHarnessZiJinHua(yiLai: HarnessZiJinHuaYiLai) {
  const shiZhong = yiLai.shiZhong || (() => Date.now());
  const shengCi = yiLai.shengCiJunZhi ?? 1200;
  let guards: ShouWei[] = MO_REN_SHOU_WEI.map((g) => ({ ...g, stats: { ...g.stats } }));
  let ledger: HarnessShiJian[] = [];
  let fenJuQi: FenJuQiPeiZhi = { ...MO_REN_FEN_JU_QI, huaYuBiaoJi: [...MO_REN_FEN_JU_QI.huaYuBiaoJi], leadBias: [...MO_REN_FEN_JU_QI.leadBias] };
  /* R296 增量自我改进：上次裁决时间戳——总结只展示此后的新台账事件，防反复查看/改进同一历史 */
  let lastCaiJueTs = 0;
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
      if (j && j.fenJuQi) fenJuQi = guiFanFenJuQi(j.fenJuQi, MO_REN_FEN_JU_QI);
      if (j && typeof j.lastCaiJueTs === 'number') lastCaiJueTs = j.lastCaiJueTs;
    } catch { /* 读不回按内建默认 */ }
  }
  function luoPan(): void {
    try { yiLai.cun({ guards, ledger: ledger.slice(-LEDGER_SHANG), fenJuQi, lastCaiJueTs }); } catch { /* 落盘失败不影响本次 */ }
  }
  function zhao(id: string): ShouWei | undefined { duHui(); return guards.find((g) => g.id === id); }

  /** 守卫执行留标记（总结自我改进的素材） */
  function jiLu(e: Omit<HarnessShiJian, 'ts'>): void {
    duHui();
    const shiJian: HarnessShiJian = { ...e, ts: shiZhong() };
    ledger.push(shiJian);
    yiLai.onFeedback?.();
    if (ledger.length > LEDGER_SHANG) ledger = ledger.slice(-LEDGER_SHANG);
    const g = zhao(e.guardId);
    if (g) {
      if (e.kind === 'fire') g.stats.fires += 1;
      if (e.kind === 'save') { g.stats.saves += 1; g.netTokens += Math.max(0, Number(e.tokens) || shengCi); }
      if (e.kind === 'fail') { g.stats.fails += 1; g.netTokens -= 2000; }
      /* 净收益持续为负 ⇒ 自动停用（完全关闭的自动形态），系统消息告知，总结可 enable 恢复 */
      if (g.enabled && g.netTokens < FU_ZI_DONG_TING && g.stats.fires >= 5) {
        g.enabled = false;
        g.autoDisabled = true;
        try {
          yiLai.jiXiTongXiaoXi('system', 'Harness 守卫自动停用',
            `守卫「${g.ming}」(${g.id}) 净收益持续为负（${g.netTokens} 词元，失败 ${g.stats.fails} 次），已自动停用。总结时可裁决 enable 恢复（净收益会重置≥0）或 replace 更换；这是自我改进的一部分，无需手动开关。`);
        } catch { /* noop */ }
        try { yiLai.auditLog('harness.guard-auto-disabled', { id: g.id, netTokens: g.netTokens }); } catch { /* noop */ }
      }
    }
    luoPan();
  }

  /** 总结提示词段：守卫表＋近期台账＋分句器参数＋裁决格式（模型判断是否正确/允许/更换/不用守卫更好/改进分句器） */
  function zongJieDuan(): string {
    duHui();
    const biao = guards.map((g) => `- ${g.id}｜${yiLai.moXingWenBen ? yiLai.moXingWenBen(g.id, g.ming) : g.ming}｜${g.enabled ? '启用' : (g.autoDisabled ? '自动停用' : '停用')}｜触发 ${g.stats.fires} 省 ${g.stats.saves} 败 ${g.stats.fails}｜净 ${g.netTokens}`).join('\n');
    const shi = ledger.filter((e) => e.ts > lastCaiJueTs).slice(-20).map((e) => `- ${new Date(e.ts).toISOString().slice(0, 16)} ${e.guardId} ${e.kind}${e.detail ? ' ' + e.detail.slice(0, 60) : ''}`).join('\n');
    const ziTing = guards.filter((g) => g.autoDisabled && !g.enabled).map((g) => g.id);
    const fen = `maxJu=${fenJuQi.maxJu} 短文阈值=${fenJuQi.duanWen} 话语标记=[${fenJuQi.huaYuBiaoJi.join('/')}] leadBias=[${fenJuQi.leadBias.join(',')}] 密度权=${fenJuQi.miDuQuan} 长度惩罚分母=${fenJuQi.changFa}`;
    return '\n【Harness 守卫台账（自我改进素材）】\n' + biao + '\n近期新增执行（上次裁决后）：\n' + (shi || '（无新增）')
      + (ziTing.length ? '\n以下守卫因净收益持续为负被自动停用，若你判断失败原因已消除/收益转好，可裁决 enable 重新启用（宿主会把净收益重置≥0）：' + ziTing.join('、') : '')
      + '\n【中文分句器当前参数】' + fen
      + '\n请裁决这些守卫：是否正确、是否允许、是否更换、是否此处不用守卫更好（目标：不增加性能负担的前提下提高效率，净收益为正并持续扩大）；'
      + '并可改进中文分句器参数（让简洁视图更准：句数/短文阈值/话语标记/lead-bias/内容词密度权/长度惩罚）。'
      + '在整理结果**末尾**单独一行输出：【Harness裁决】{"judgments":[{"guardId":"…","verdict":"keep|disable|enable|replace|disable-all","reason":"…","replacement":{"action":"syntax-check|fullwidth-scan|read-back|concise-view|concise-structured","ext":"…"}}],"splitter":{"maxJu":3,"duanWen":120,"huaYuBiaoJi":["首先"],"leadBias":[2,1,0],"miDuQuan":2,"changFa":200}}'
      + '（disable-all＝完全关闭全部守卫；动作只许安全白名单内，越界会被宿主拦下并转用户授权；splitter 可只给要改的字段，宿主收窄到安全范围。没有可改的就输出空 judgments、省略 splitter。）\n';
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

  /** 从裁决块解析分句器参数改进（顶层 splitter 字段；缺省/null ⇒ 不改） */
  function jieXiFenJuQi(txt: string): Partial<FenJuQiPeiZhi> | null {
    const m = /【Harness裁决】\s*(\{[\s\S]*?\})\s*(?:\n|$)/.exec(String(txt || ''));
    if (!m || !m[1]) return null;
    try {
      const j = JSON.parse(m[1]) as { splitter?: unknown };
      if (!j.splitter || typeof j.splitter !== 'object') return null;
      return j.splitter as Partial<FenJuQiPeiZhi>;
    } catch { return null; }
  }

  /** 应用分句器参数改进（白名单内视图变换 ⇒ 直接生效；宿主收窄越界值） */
  function yingYongFenJuQi(p: Partial<FenJuQiPeiZhi> | null): boolean {
    duHui();
    if (!p) return false;
    const xin = guiFanFenJuQi(p, fenJuQi);
    if (JSON.stringify(xin) === JSON.stringify(fenJuQi)) return false;
    fenJuQi = xin;
    const g = zhao('concise-splitter');
    if (g) { g.stats.saves += 1; g.netTokens += Math.max(0, shengCi); }
    try { yiLai.auditLog('harness.splitter-tuned', { fenJuQi }); } catch { /* noop */ }
    luoPan();
    return true;
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
      if (c.verdict === 'disable') { g.enabled = false; g.autoDisabled = false; applied += 1; continue; }
      if (c.verdict === 'enable') {
        /* 重新启用（含自动停用后恢复）：净收益重置≥0，清自动停用标记，避免历史负值立即再停 */
        const zengAuto = !!g.autoDisabled;
        g.enabled = true; g.autoDisabled = false; g.netTokens = Math.max(g.netTokens, 0);
        applied += 1;
        try { yiLai.auditLog(zengAuto ? 'harness.guard-re-enabled' : 'harness.guard-enabled', { id: g.id, reason: c.reason }); } catch { /* noop */ }
        continue;
      }
      if (c.verdict === 'replace') {
        const dong = String(c.replacement?.action || '') as ShouWeiDongZuo;
        if (!AN_QUAN_BAI.includes(dong)) { yueJie.push(`${g.id}→${dong || '(空)'}`); continue; }
        g.action = dong;
        if (c.replacement?.ext) g.trigger.ext = String(c.replacement.ext).slice(0, 120);
        g.source = 'model';
        applied += 1;
      }
    }
    if (applied) { lastCaiJueTs = shiZhong(); luoPan(); }
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

  return {
    jiLu, zongJieDuan, jieXiCaiJue, yingYongCaiJue, jieXiFenJuQi, yingYongFenJuQi, boLiCaiJueKuai,
    get guards() { duHui(); return guards; },
    get ledger() { duHui(); return ledger; },
    get fenJuQi() { duHui(); return fenJuQi; },
  };
}