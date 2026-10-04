/**
 * mo-xing-neng-li —— 模型能力（视觉 / 思考档位 / 工具）识别。
 *
 * 事实来源（按优先级）：
 *  1. **端点给的**：`/models` 里的 `architecture.input_modalities`（OpenRouter）、
 *     `capabilities`、`supported_parameters`（含 `image_url`/`vision`/`reasoning`）。
 *     这是唯一"问出来"的口径。
 *  2. **已知模型表**：官方端点（DeepSeek / MiMo 等）的 `/models` 只回 id，
 *     什么能力都不说 —— 那就按**已知型号**兑底（表里写明来源，不猜）。
 *  3. **未知** ⇒ 如实返回 `unknown`，不假装知道（UI 上不显示能力徽章）。
 *
 * 真事故：用户说「deepseek-flash 是支持视觉的」，但界面/链路里没有能力信息 ⇒
 * 要么把图硬喂给不看图的模型，要么把能看图的模型当不能看。
 */

export interface MoXingNengLi {
  /** 输入里能带图片（vision） */
  vision: boolean | 'unknown';
  /** 支持思考档位（reasoning） */
  thinking: boolean | 'unknown';
  /** 思考档位清单（**已按强度从弱到强排序**；空 = 端点没给、表里也没有） */
  thinkLevels: string[];
  /** 支持 function calling */
  tools: boolean | 'unknown';
  /**
   * 模型种类（决定它能干哪类活）：
   *  · chat       = 文本生成/对话（整理、陪聊、写文档）
   *  · embedding  = 向量嵌入（嵌入模型）
   *  · asr        = 语音转文字（语音识别）
   *  · tts        = **文字转语音**（语音模型：能"读"文字）
   *  · decision   = **决策/路由/分类**（"分类模型"就是这一类：router / classifier / judge）
   *  · unknown    = 认不出（界面上不放进任何调用链，免得用时出错）
   */
  kind: 'chat' | 'embedding' | 'asr' | 'tts' | 'decision' | 'unknown';
  /** 上下文长度（token）；0 = 端点没给、表里也没有 */
  contextLen: number;
  /** 能力来源：endpoint=端点给的 / table=已知型号表 / unknown */
  source: 'endpoint' | 'table' | 'unknown';
}

/** 我们的思考档位（与界面 THINK_STOPS 一致） */
export const WO_MEN_DANG_WEI = ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'auto'] as const;

/** 档位名 → 强度 0..1（用于排序与映射；识别不出的按 0.5 中位） */
export function dangWeiQiangDu(ming: string): number {
  const s = String(ming || '').toLowerCase();
  if (/^(none|off|disable|minimal|min|tiny|brief|short|fast|quick|light|low|shallow|0)$/.test(s)) return 0;
  if (/xhigh|ultra|max|highest|deepest|extensive|heavy|thorough|long|thinking-max/.test(s)) return 1;
  if (/high|deep|strong|hard|serious/.test(s)) return 0.85;
  if (/^(med|medium|mid|normal|standard|moderate|default)$/.test(s)) return 0.5;
  if (/low|light|short|quick|fast|brief/.test(s)) return 0.2;
  return 0.5;
}

/** 把端点给的档位清单**按强度从弱到强**排序（不排序就映射错位） */
export function paiXuDangWei(levels: string[]): string[] {
  return levels.map((m, i) => ({ m, i, q: dangWeiQiangDu(m) })).sort((a, b) => (a.q - b.q) || (a.i - b.i)).map((x) => x.m);
}

export interface DangWeiAnShe {
  /** 我们的档 → 该模型的档（null = 不发该参数，让服务端默认） */
  woDaoMo: Record<string, string | null>;
  /** 该模型的档 → 我们的档（界面显示用） */
  moDaoWo: Record<string, string>;
}

/**
 * **档位映射表**（拉取模型时构建，之后按它发请求）。
 * 档位数量不同也能正确对应：
 *  · 0 档 ⇒ 全部 null（不发思考参数）
 *  · 1 档 ⇒ 除 off/auto 外都指向它
 *  · n 档 ⇒ 按强度**比例**铺到 l1..l6（n=3 → l1/l3-l4/l6；n=4 → l1/l2-l3/l5/l6 …）
 *  · 'off' 指向模型里最弱那一档（通常叫 none/off/minimal）；'auto' 指向模型自己的 auto，没有则 null
 */
export function gouJianDangWeiAnShe(modelLevels: string[]): DangWeiAnShe {
  const pai = paiXuDangWei(modelLevels.filter(Boolean));
  const woDaoMo: Record<string, string | null> = {};
  const moDaoWo: Record<string, string> = {};
  for (const p of pai) moDaoWo[p] = 'l3';
  if (!pai.length) {
    for (const w of WO_MEN_DANG_WEI) woDaoMo[w] = null;
    return { woDaoMo, moDaoWo };
  }
  const guanBi = pai.find((p) => /^(none|off|disable|0|minimal)$/i.test(p)) ?? null;
  const ziDong = pai.find((p) => /^(auto|adaptive|default|normal)$/i.test(p)) ?? null;
  // 具体强度档（去掉 off/auto，避免占掉比例位）
  const juTi = pai.filter((p) => p !== guanBi && p !== ziDong);
  woDaoMo.off = guanBi ?? pai[0] ?? null;
  woDaoMo.auto = ziDong;
  if (juTi.length === 0) {
    for (const w of WO_MEN_DANG_WEI) if (woDaoMo[w] === undefined) woDaoMo[w] = pai[0] ?? null;
    for (const p of juTi) moDaoWo[p] = 'l3';
    return { woDaoMo, moDaoWo };
  }
  if (juTi.length === 1) {
    const t0 = juTi[0]!;
    for (const w of ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']) woDaoMo[w] = t0;
    moDaoWo[t0] = 'l3';
    return { woDaoMo, moDaoWo };
  }
  // n≥2：按比例铺到 l1..l6
  const liu = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
  juTi.forEach((p, i) => {
    const idx = Math.round((i * (liu.length - 1)) / (juTi.length - 1));
    const wo = liu[Math.max(0, Math.min(liu.length - 1, idx))]!;
    woDaoMo[wo] = p;
    moDaoWo[p] = wo;
  });
  // 空档位（n<6 时某些 l* 没被指到）⇒ 取最近的已映射档
  for (const w of liu) {
    if (woDaoMo[w] === undefined) {
      const yiYou = liu.filter((x) => woDaoMo[x] !== undefined && woDaoMo[x] !== null);
      const zuiHou = yiYou[yiYou.length - 1];
      woDaoMo[w] = (zuiHou !== undefined ? (woDaoMo[zuiHou] ?? null) : (juTi[0] ?? null));
    }
  }
  return { woDaoMo, moDaoWo };
}

/** 已知模型能力表（只写**确定**的；不确定的不写 ⇒ 如实 unknown） */
const YI_ZHI_NENG_LI: Array<{ shi: RegExp; neng: Partial<MoXingNengLi> }> = [
  // DeepSeek
  { shi: /^deepseek-chat$/i, neng: { vision: false, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  { shi: /^deepseek-reasoner$/i, neng: { vision: false, thinking: true, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  { shi: /^deepseek-flash$/i, neng: { vision: true, thinking: true, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  { shi: /^deepseek-coder/i, neng: { vision: false, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  // Qwen-VL / 多模态
  { shi: /qwen.*vl|qwen-vl|qwen2\.?5-vl|qwen3-vl/i, neng: { vision: true, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  { shi: /^qwen3/i, neng: { vision: false, thinking: true, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  // GPT
  { shi: /^gpt-4o|^gpt-4\.1|^gpt-5|gpt-4o-mini/i, neng: { vision: true, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  { shi: /^o[134](-|$)/i, neng: { vision: true, thinking: true, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  // Claude
  { shi: /^claude/i, neng: { vision: true, thinking: false, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  // Gemini
  { shi: /^gemini/i, neng: { vision: true, thinking: true, tools: true, thinkLevels: ['low', 'medium', 'high'], kind: 'chat' } },
  // GLM-4V 多模态
  { shi: /glm-4v|glm-4\.5v/i, neng: { vision: true, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  { shi: /^glm-4/i, neng: { vision: false, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
  // 嵌入模型
  { shi: /text-embedding|bge-|bge_|m3e|gte-|e5-|contriever|jina-embed|nomic-embed/i, neng: { vision: false, thinking: false, tools: false, thinkLevels: [], kind: 'embedding' } },
  // 语音识别
  { shi: /whisper|sense-?voice|paraformer|moonshine|speech-?to-?text|\bstt\b|asr-|vosk|sherpa/i, neng: { vision: false, thinking: false, tools: false, thinkLevels: [], kind: 'asr' } },
  /**
   * **语音模型（TTS，文字转语音）**：能把文字"读"出来的模型。
   * 代表：CosyVoice / MeloTTS / VITS / Bark / Kokoro / F5-TTS / XTTS / edge-tts / fish-speech。
   */
  { shi: /cosyvoice|melo-?tts|melo\b|vits|bark-|kokoro|f5-?tts|xtts|edge-?tts|fish-?speech|voice-?clone|text-?to-?speech|\btts\b|piper|speecht5|valle|seed-?tts/i, neng: { vision: false, thinking: false, tools: false, thinkLevels: [], kind: 'tts' } },
  /**
   * **决策/路由/分类模型**（"分类模型"就是这一类）：做意图识别、模型路由、裁判/评判的模型。
   * 代表：OpenRouter 的 auto-router / router-1、各种 classifier、judge / critic / arbiter。
   */
  { shi: /router|routing|route-|auto-?route|classifier|classification|decision|judge|critic|arbiter|gate-?keeper|selector|intent-/i, neng: { vision: false, thinking: false, tools: true, thinkLevels: [], kind: 'decision' } },
  // 纯文本开源（明确不看图）
  { shi: /llama|mistral|phi-|gemma|deepseek-v[23]/i, neng: { vision: false, thinking: false, tools: true, thinkLevels: [], kind: 'chat' } },
];

/** 从型号名猜种类（端点没给类别字段时用） */
export function caiZhongLei(ming: string): MoXingNengLi['kind'] {
  const s = String(ming || '').toLowerCase();
  if (/text-embedding|bge-|bge_|m3e|gte-|e5-|contriever|jina-embed|nomic-embed/.test(s)) return 'embedding';
  if (/cosyvoice|melo-?tts|melo\b|vits|bark-|kokoro|f5-?tts|xtts|edge-?tts|fish-?speech|voice-?clone|text-?to-?speech|\btts\b|piper|speecht5|valle|seed-?tts/.test(s)) return 'tts';
  if (/whisper|sense-?voice|paraformer|moonshine|speech-?to-?text|\bstt\b|asr-|vosk|sherpa/.test(s)) return 'asr';
  // 决策/路由/分类
  if (/router|routing|route-|auto-?route|classifier|classification|decision|judge|critic|arbiter|gate-?keeper|selector|intent-/.test(s)) return 'decision';
  return 'unknown';
}

/** 上下文长度的常见字段名（端点给了就用） */
export function chouShangXiaWenChangDu(m: Record<string, unknown>): number {
  const hou = ['context_length', 'context_length_tokens', 'context_window', 'context_window_tokens', 'max_context', 'max_context_length', 'max_input_tokens', 'contextSize', 'num_ctx'];
  for (const k of hou) {
    const v = (m as Record<string, unknown>)[k];
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const arch = m as { context_length?: unknown };
  const n2 = Number(arch.context_length);
  if (Number.isFinite(n2) && n2 > 0) return Math.floor(n2);
  return 0;
}

/** 从 `/models` 的单条记录里尽力抽出能力（端点给了就用端点的） */
export function chouNengLiCongDuanDian(m: Record<string, unknown>): Partial<MoXingNengLi> | null {
  const out: Partial<MoXingNengLi> = {};
  let you = false;
  // 1) architecture.input_modalities（OpenRouter / 部分网关）
  const arch = m.architecture as { input_modalities?: unknown } | undefined;
  const shuRuMoTai = Array.isArray(arch?.input_modalities) ? (arch!.input_modalities as unknown[]).map((x) => String(x)) : [];
  if (shuRuMoTai.length) {
    out.vision = shuRuMoTai.some((t) => /image|vision/i.test(t));
    you = true;
  }
  // 2) capabilities: { vision: true } / { input_modalities: [...] }
  const cap = m.capabilities as Record<string, unknown> | undefined;
  if (cap && typeof cap === 'object') {
    if (typeof cap.vision === 'boolean') { out.vision = cap.vision; you = true; }
    if (typeof cap.reasoning === 'boolean') { out.thinking = cap.reasoning; you = true; }
    if (typeof cap.function_calling === 'boolean' || typeof cap.tools === 'boolean') {
      out.tools = Boolean(cap.function_calling ?? cap.tools); you = true;
    }
  }
  // 3) supported_parameters（OpenRouter）
  const sp = Array.isArray(m.supported_parameters) ? (m.supported_parameters as unknown[]).map((x) => String(x)) : [];
  if (sp.length) {
    if (out.vision === undefined) {
      const v = sp.some((p) => /image|vision/i.test(p));
      out.vision = v; you = true;
    }
    const youReason = sp.some((p) => /reason/i.test(p));
    if (out.thinking === undefined) { out.thinking = youReason; you = true; }
    if (out.tools === undefined) { out.tools = sp.some((p) => /tool|function/i.test(p)); you = true; }
  }
  // 4) reasoning 档位
  const re = m.reasoning as { supported_efforts?: unknown; efforts?: unknown } | undefined;
  const cands = [
    Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : null,
    Array.isArray(re?.supported_efforts) ? re!.supported_efforts : null,
    Array.isArray(re?.efforts) ? re!.efforts : null,
  ].find(Boolean) as unknown;
  if (Array.isArray(cands)) {
    out.thinkLevels = cands.map((x) => String(x)).filter(Boolean);
    out.thinking = true; you = true;
  }
  // 5) 种类（embedding / tts / asr / decision）——端点给 category/kind 就用
  const cat = String((m as { category?: unknown; kind?: unknown; type?: unknown }).category
    || (m as { kind?: unknown }).kind || (m as { type?: unknown }).type || '').toLowerCase();
  if (cat) {
    const k = /embed/.test(cat) ? 'embedding' : /tts|speech-?synth|text-?to-?speech/.test(cat) ? 'tts'
      : /asr|stt|speech-?recog/.test(cat) ? 'asr' : /router|classif|decision|judge/.test(cat) ? 'decision'
      : /chat|text|completion/.test(cat) ? 'chat' : undefined;
    if (k) { (out as { kind?: MoXingNengLi['kind'] }).kind = k; you = true; }
  }
  // 6) 上下文长度
  const c = chouShangXiaWenChangDu(m);
  if (c > 0) { (out as { contextLen?: number }).contextLen = c; you = true; }
  return you ? out : null;
}

/** 已知型号表兜底 */
export function nengLiCongBiao(modelId: string): Partial<MoXingNengLi> | null {
  const s = String(modelId || '').trim();
  if (!s) return null;
  for (const e of YI_ZHI_NENG_LI) if (e.shi.test(s)) return e.neng;
  return null;
}

/** 合成一条完整能力记录（端点 > 已知表 > unknown） */
export function moXingNengLi(modelId: string, duanDian?: Partial<MoXingNengLi> | null): MoXingNengLi {
  const biao = nengLiCongBiao(modelId);
  const dd = duanDian || null;
  const src: MoXingNengLi['source'] = dd && (dd.vision !== undefined || dd.thinking !== undefined || (dd.thinkLevels && dd.thinkLevels.length))
    ? 'endpoint'
    : (biao ? 'table' : 'unknown');
  // 端点字段覆盖表；端点没给的用表补；都没有 ⇒ unknown
  const q = <T,>(a: T | undefined, b: T | undefined, ren: T): T => (a !== undefined ? a : (b !== undefined ? b : ren));
  // 种类：端点 > 已知表 > 按型号名猜
  const kindDd = (dd as { kind?: MoXingNengLi['kind'] } | null)?.kind;
  const kindBiao = (biao as { kind?: MoXingNengLi['kind'] } | null)?.kind;
  const kind = kindDd || kindBiao || (caiZhongLei(modelId) !== 'unknown' ? caiZhongLei(modelId) : 'unknown');
  // 上下文长度：端点 > 已知表（表里没写就 0）
  const ctx = Number((dd as { contextLen?: number } | null)?.contextLen || (biao as { contextLen?: number } | null)?.contextLen || 0);
  return {
    vision: q(dd?.vision, biao?.vision, 'unknown'),
    thinking: q(dd?.thinking, biao?.thinking, 'unknown'),
    thinkLevels: paiXuDangWei(dd?.thinkLevels && dd.thinkLevels.length ? dd.thinkLevels : (biao?.thinkLevels || [])),
    tools: q(dd?.tools, biao?.tools, 'unknown'),
    kind,
    contextLen: Number.isFinite(ctx) && ctx > 0 ? Math.floor(ctx) : 0,
    source: src,
  };
}

/** 能力 → 界面用的短标签（中文） */
export function nengLiBiaoQian(n: MoXingNengLi): string[] {
  const out: string[] = [];
  if (n.kind && n.kind !== 'unknown' && n.kind !== 'chat') out.push(kindZhongWen(n.kind));
  if (n.vision === true) out.push('视觉');
  if (n.thinking === true) out.push('思考');
  if (n.tools === true) out.push('工具');
  if (n.thinkLevels && n.thinkLevels.length) out.push('档位:' + n.thinkLevels.join('/'));
  return out;
}

/** 种类 → 中文（产品定稿叫法：听话=ASR、说话=TTS、对话=LLM） */
export function kindZhongWen(k: MoXingNengLi['kind']): string {
  return k === 'embedding' ? '嵌入模型' : k === 'asr' ? '听话模型' : k === 'tts' ? '说话模型'
    : k === 'decision' ? '决策模型' : k === 'chat' ? '对话模型' : '未知';
}

/** 上下文长度 → 界面短标签（如 128K / 32K / 8K） */
export function shangXiaWenBiaoQian(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}
