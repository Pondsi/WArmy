import { AnthropicGongYing } from './anthropic.js';
import { OllamaGongYing } from './ollama.js';
import { JianrongOpenAIGongYing } from './openai.js';
import { GONGYING_YUSHE } from './types.js';
import type { MoxingGongYing, GongYingRenZheng, GongYingXieYi } from './types.js';

export * from './types.js';
export * from './base.js';
export * from './tools.js';
export * from './xian-liu.js';
export * from './util.js';
export * from './mo-xing-neng-li.js';
export * from './audio.js';
export * from './media-format.js';
export { JianrongOpenAIGongYing, chuangjianDeepSeek } from './openai.js';
export { AnthropicGongYing } from './anthropic.js';
export { OllamaGongYing } from './ollama.js';

const MOREN_DIZHI: Record<GongYingXieYi, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434',
};

const YUSHE_BIAO = Object.fromEntries(GONGYING_YUSHE.map((p) => [p.id, p]));
/** 旧 id 别名：落盘里可能还是拆分前的 `mimo`（token-plan），映射到新 id，避免找不到预设 */
const YUSHE_BIE_MING: Record<string, string> = {
  mimo: 'mimo-token-plan',
  'mimo-tokenplan': 'mimo-token-plan',
  'mimo-cn': 'mimo-token-plan',
};

/**
 * **provider 创建之后的挂钩**（第 39 轮：装 rpm/tpm 限流用）。
 *
 * 为什么用挂钩而不是在每个调用点包一层：全仓有十几处 `congYuSheChuangJian(...)`
 * （主对话、降级链、看图转交、压缩、分身、群编排、定时任务…），漏一处就等于那条路不限流。
 * 宿主在启动时注册一次 ⇒ 所有创建点自动生效；不注册就**完全保持原行为**。
 */
let chuangJianHouGou: ((p: MoxingGongYing) => MoxingGongYing) | null = null;
export function sheProviderJiXieGou(h: ((p: MoxingGongYing) => MoxingGongYing) | null): void {
  chuangJianHouGou = h;
}

function zaoGongYingBen(
  protocol: GongYingXieYi,
  auth: GongYingRenZheng = {},
  id?: string
): MoxingGongYing {
  switch (protocol) {
    case 'openai-compatible':
      return new JianrongOpenAIGongYing(auth, {
        id,
        defaultBase: auth.baseURL || MOREN_DIZHI['openai-compatible'],
      });
    case 'anthropic':
      return new AnthropicGongYing(auth, { id, defaultBase: auth.baseURL });
    case 'ollama':
      return new OllamaGongYing(auth, { id, defaultBase: auth.baseURL });
    default: {
      const never: never = protocol;
      throw new Error(`unknown protocol ${String(never)}`);
    }
  }
}

export function chuangjianGongYing(
  protocol: GongYingXieYi,
  auth: GongYingRenZheng = {},
  id?: string
): MoxingGongYing {
  const p = zaoGongYingBen(protocol, auth, id);
  return chuangJianHouGou ? chuangJianHouGou(p) : p;
}

/** 按预设 id + 用户覆盖项创建 Provider */
export function congYuSheChuangJian(
  presetId: string,
  auth: GongYingRenZheng = {},
  overrideProtocol?: GongYingXieYi
): MoxingGongYing {
  const zhenId = YUSHE_BIE_MING[presetId] || presetId;
  const p = YUSHE_BIAO[zhenId];
  /**
   * 自定义供应商 id（如 `ollama-1791…`）不在预设表里 —— 此时**必须**由调用方
   * 带上 protocol，否则会退化成 openai-compatible，去打 `/chat/completions`
   * （Ollama 真事故：404 page not found）。
   * auth 上带了协议时优先用它，其次 overrideProtocol，最后才默认 openai-compatible。
   */
  const authXieYi = (auth as { protocol?: GongYingXieYi }).protocol;
  const xieYi = overrideProtocol || authXieYi || (!p ? 'openai-compatible' : p.protocol);
  if (!p) {
    return chuangjianGongYing(xieYi, auth, presetId);
  }
  return chuangjianGongYing(
    xieYi,
    { ...auth, baseURL: auth.baseURL || p.baseURL },
    presetId
  );
}

/**
 * 取预设。**必须与 `chuangjianGongYing` 用同一套旧 id 别名**：
 * 落盘数据/界面里可能还是拆分前的 `mimo`，只在一处做别名 ⇒ 这里返回 undefined，
 * 界面上 MiMo 的默认模型与 baseURL 就会**静默变空**（看起来像"预设丢了"）。
 */
export function quGongYingYuShe(presetId: string) {
  const zhenId = YUSHE_BIE_MING[presetId] || presetId;
  return YUSHE_BIAO[zhenId] || YUSHE_BIAO[presetId];
}
