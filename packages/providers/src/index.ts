import { AnthropicGongYing } from './anthropic.js';
import { OllamaGongYing } from './ollama.js';
import { JianrongOpenAIGongYing } from './openai.js';
import { GONGYING_YUSHE } from './types.js';
import type { MoxingGongYing, GongYingRenZheng, GongYingXieYi } from './types.js';

export * from './types.js';
export * from './base.js';
export * from './tools.js';
export * from './util.js';
export * from './mo-xing-neng-li.js';
export * from './audio.js';
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

export function chuangjianGongYing(
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

export function quGongYingYuShe(presetId: string) {
  return YUSHE_BIAO[presetId];
}
