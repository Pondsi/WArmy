/**
 * R318：模型能力定期自动核验（用户口径）——
 *  · 定期查看所有已添加模型的：能力标签 / 上下文长度 / 输出长度 / 每分钟请求数 / 每分钟 token /
 *    输入类型 / 输出类型 / 接口实际传递的参数（缓存命中、余额、语言类型、标签等）；
 *  · 有变化且**实际验证通过**才更新进程序；无变化维持不变；
 *  · 更新经系统消息告知（非重要），带反馈输入框；用户反馈写入备忘录，下次核验先读备忘录
 *    （如「改错了，该模型没有听写能力，官方文档是错误的」⇒ 删除该标签并以后不再加）；
 *  · 频率初次每周 1 次，之后由模型在总结中自调，夹在 [1天, 1月]。
 * 构造无副作用；读取/注册由组合根显式调用。
 */
import fs from 'node:fs';
import path from 'node:path';

export const SHEN_JI_ZUI_XIAO_MS = 24 * 3600000;        // 1 天
export const SHEN_JI_ZUI_DA_MS = 30 * 24 * 3600000;     // 1 月
export const SHEN_JI_CHU_SHI_MS = 7 * 24 * 3600000;     // 初次每周 1 次

export interface MoXingNengLiTiaoMu {
  tags?: string[];
  contextLen?: number;
  outputLen?: number;
  rpm?: number;
  tpm?: number;
  inputTypes?: string[];
  outputTypes?: string[];
  /** 接口实际传递/回报的参数（实测验证后才置 true） */
  params?: { cacheHit?: boolean; balance?: boolean; language?: boolean; tags?: boolean };
  balanceEndpoint?: string;
  updatedAt?: number;
  source?: string;
}
export interface MoXingNengLiShenJiZhuangTai {
  intervalMs: number;
  lastCheckAt: number;
  nextCheckAt: number;
  memo: Array<{ ts: number; text: string }>;
  models: Record<string, MoXingNengLiTiaoMu>;
}
export interface MoXingNengLiTanCeJieGuo {
  cacheHit?: boolean;
  balance?: boolean;
  balanceEndpoint?: string;
  language?: boolean;
  tags?: string[];
  contextLen?: number;
  outputLen?: number;
  rpm?: number;
  tpm?: number;
  inputTypes?: string[];
  outputTypes?: string[];
}
export interface MoXingNengLiShenJiYiLai {
  wenJianLu: string;
  /** 已配置供应商及其模型元数据（程序里「添加的模型」） */
  peiZhi: () => Array<{ id: string; models?: Array<Record<string, unknown>> }>;
  /** 实测：小请求看 usage/响应字段；余额端点真探；返回只含验证过的字段 */
  tanCe: (providerId: string, model: string) => Promise<MoXingNengLiTanCeJieGuo>;
  jiXiTong: (title: string, body: string) => void;
  audit?: (op: string, d: unknown) => void;
  now?: () => number;
}

/** 备忘录禁止规则：用户说「不要加 X / 没有 X / X 是错误的」⇒ 该模型（或全部）以后不加 X。 */
export function jieXiBeiWangJinZhi(memo: Array<{ ts: number; text: string }>, modelKey: string, modelMing: string): { jinZhi: string[]; huaiYiGuanFang: boolean } {
  const jinZhi: string[] = [];
  let huaiYiGuanFang = false;
  const xiangGuan = (t: string) => t.includes(modelKey) || (modelMing && t.includes(modelMing)) || /全部|所有|以后都/.test(t);
  for (const m of memo || []) {
    const t = String(m.text || '');
    if (!xiangGuan(t)) continue;
    if (/官方文档.*错|文档.*错误|官网.*错/.test(t)) huaiYiGuanFang = true;
    const re = /(?:不要|别|不再|禁止|没有)(?:加|添加|标|打|带)?([^，。；,;\n]{1,12})/g;
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(t))) {
      const w = String(hit[1] || '').trim();
      if (w && !/^(任何|这个|那个)$/.test(w)) jinZhi.push(w);
    }
  }
  return { jinZhi, huaiYiGuanFang };
}

export function chuangJianMoXingNengLiShenJi(yiLai: MoXingNengLiShenJiYiLai) {
  const now = yiLai.now || (() => Date.now());
  const lu = yiLai.wenJianLu;
  function du(): MoXingNengLiShenJiZhuangTai {
    try {
      const j = JSON.parse(fs.readFileSync(lu, 'utf8')) as Partial<MoXingNengLiShenJiZhuangTai>;
      const ben = Number(j.intervalMs);
      return {
        intervalMs: Number.isFinite(ben) && ben > 0 ? Math.min(SHEN_JI_ZUI_DA_MS, Math.max(SHEN_JI_ZUI_XIAO_MS, ben)) : SHEN_JI_CHU_SHI_MS,
        lastCheckAt: Number(j.lastCheckAt) || 0,
        nextCheckAt: Number(j.nextCheckAt) || 0,
        memo: Array.isArray(j.memo) ? j.memo.slice(-100) : [],
        models: (j.models && typeof j.models === 'object') ? j.models : {},
      };
    } catch {
      return { intervalMs: SHEN_JI_CHU_SHI_MS, lastCheckAt: 0, nextCheckAt: 0, memo: [], models: {} };
    }
  }
  function cun(st: MoXingNengLiShenJiZhuangTai): void {
    try {
      fs.mkdirSync(path.dirname(lu), { recursive: true });
      const tmp = lu + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8');
      fs.renameSync(tmp, lu);
    } catch { /* 写盘失败保留内存态 */ }
  }
  function tiaoZhengJianGe(ms: number): { ok: boolean; intervalMs: number } {
    const st = du();
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, intervalMs: st.intervalMs };
    st.intervalMs = Math.min(SHEN_JI_ZUI_DA_MS, Math.max(SHEN_JI_ZUI_XIAO_MS, n));
    st.nextCheckAt = Math.min(st.nextCheckAt || now(), now() + st.intervalMs);
    cun(st);
    return { ok: true, intervalMs: st.intervalMs };
  }
  /** 用户反馈⇒备忘录；并按禁止规则立即撤销已加标签（「改错了…删除听写标签」）。 */
  function fanKui(text: string): { ok: boolean; removed: string[] } {
    const t = String(text || '').trim();
    if (!t) return { ok: false, removed: [] };
    const st = du();
    st.memo = (st.memo || []).concat([{ ts: now(), text: t.slice(0, 400) }]).slice(-100);
    const removed: string[] = [];
    for (const [key, entry] of Object.entries(st.models)) {
      const { jinZhi } = jieXiBeiWangJinZhi(st.memo, key, key.split('|').pop() || '');
      if (!jinZhi.length || !Array.isArray(entry.tags)) continue;
      const qian = entry.tags.length;
      entry.tags = entry.tags.filter((tag) => !jinZhi.some((j) => tag.includes(j) || j.includes(tag)));
      if (entry.tags.length !== qian) removed.push(key);
    }
    cun(st);
    try { yiLai.audit?.('capability.memo-feedback', { removed }); } catch { /* noop */ }
    return { ok: true, removed };
  }
  /** 到点才跑；返回本次是否执行与变更摘要。 */
  async function maybePao(force = false): Promise<{ ran: boolean; changes: string[] }> {
    const st = du();
    const n = now();
    if (!force && st.nextCheckAt && n < st.nextCheckAt) return { ran: false, changes: [] };
    const changes: string[] = [];
    for (const prov of yiLai.peiZhi() || []) {
      for (const mo of prov.models || []) {
        const model = String(mo.id || mo.name || '');
        if (!model) continue;
        const key = prov.id + '|' + model;
        const old = st.models[key] || {};
        let tan: MoXingNengLiTanCeJieGuo = {};
        try { tan = (await yiLai.tanCe(prov.id, model)) || {}; } catch { tan = {}; }
        const { jinZhi, huaiYiGuanFang } = jieXiBeiWangJinZhi(st.memo, key, model);
        const xin: MoXingNengLiTiaoMu = { ...old };
        /* 元数据（标签/上下文/输出/限速/输入输出类型）：程序配置为准；有变化才更新 */
        const yuanShu = (k: keyof MoXingNengLiTiaoMu, v: unknown) => {
          if (v === undefined || v === null) return;
          if (JSON.stringify(old[k]) !== JSON.stringify(v)) { (xin as Record<string, unknown>)[k] = v; changes.push(key + ' ' + String(k) + '→' + JSON.stringify(v).slice(0, 80)); }
        };
        if (!huaiYiGuanFang) {
          let tags = Array.isArray(mo.tags) ? (mo.tags as string[]) : (Array.isArray(tan.tags) ? tan.tags : undefined);
          if (tags) tags = tags.filter((tag) => !jinZhi.some((j) => tag.includes(j) || j.includes(tag)));
          yuanShu('tags', tags);
        }
        yuanShu('contextLen', mo.contextLen ?? tan.contextLen);
        yuanShu('outputLen', mo.outputLen ?? tan.outputLen);
        yuanShu('rpm', mo.rpm ?? tan.rpm);
        yuanShu('tpm', mo.tpm ?? tan.tpm);
        yuanShu('inputTypes', mo.inputTypes ?? tan.inputTypes);
        yuanShu('outputTypes', mo.outputTypes ?? tan.outputTypes);
        /* 接口参数：只认实测 */
        const params = { ...(old.params || {}) };
        const shiCe = (k: 'cacheHit' | 'balance' | 'language', v: boolean | undefined, lu0?: string) => {
          if (v === undefined) return;
          if (params[k] !== v) { params[k] = v; changes.push(key + ' 接口' + k + '→' + (v ? '有' : '无')); }
          if (lu0) xin.balanceEndpoint = lu0;
        };
        shiCe('cacheHit', tan.cacheHit);
        shiCe('balance', tan.balance, tan.balanceEndpoint);
        shiCe('language', tan.language);
        if (Array.isArray(xin.tags) && xin.tags.length) params.tags = true;
        xin.params = params;
        if (changes.length || !st.models[key]) { xin.updatedAt = n; xin.source = 'live-probe'; st.models[key] = xin; }
      }
    }
    st.lastCheckAt = n;
    st.nextCheckAt = n + st.intervalMs;
    cun(st);
    if (changes.length) {
      try {
        yiLai.jiXiTong('模型能力核验更新', '实测发现变化：\n' + changes.slice(0, 12).join('\n') + '\n（无变化项维持不变。如有改错，请在下方输入反馈，将写入备忘录并立即纠正。）');
      } catch { /* noop */ }
      try { yiLai.audit?.('capability.audit-changed', { changes: changes.slice(0, 20) }); } catch { /* noop */ }
    }
    return { ran: true, changes };
  }
  return { du, cun, tiaoZhengJianGe, fanKui, maybePao };
}