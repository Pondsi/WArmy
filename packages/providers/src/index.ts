import { AnthropicGongYing } from './anthropic.js';
import { OllamaGongYing } from './ollama.js';
import { JianrongOpenAIGongYing } from './openai.js';
import { GONGYING_YUSHE } from './types.js';
import type { MoxingGongYing, GongYingRenZheng, GongYingXieYi } from './types.js';

export * from './types.js';
export * from './base.js';
export * from './tools.js';
export * from './util.js';
export { JianrongOpenAIGongYing, chuangjianDeepSeek } from './openai.js';
export { AnthropicGongYing } from './anthropic.js';
export { OllamaGongYing } from './ollama.js';

const MOREN_DIZHI: Record<GongYingXieYi, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434',
};

const YUSHE_BIAO = Object.fromEntries(GONGYING_YUSHE.map((p) => [p.id, p]));

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
  const p = YUSHE_BIAO[presetId];
  if (!p) {
    return chuangjianGongYing(overrideProtocol || 'openai-compatible', auth, presetId);
  }
  return chuangjianGongYing(
    overrideProtocol || p.protocol,
    { ...auth, baseURL: auth.baseURL || p.baseURL },
    presetId
  );
}

export function quGongYingYuShe(presetId: string) {
  return YUSHE_BIAO[presetId];
}
