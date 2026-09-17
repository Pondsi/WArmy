import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai.js';
import { PROVIDER_PRESETS } from './types.js';
import type { ModelProvider, ProviderAuth, ProviderProtocol } from './types.js';

export * from './types.js';
export * from './base.js';
export * from './tools.js';
export * from './util.js';
export { OpenAICompatibleProvider, createDeepSeekProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider } from './ollama.js';

const DEFAULT_BASE: Record<ProviderProtocol, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434',
};

const PRESET_MAP = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]));

export function createProvider(
  protocol: ProviderProtocol,
  auth: ProviderAuth = {},
  id?: string
): ModelProvider {
  switch (protocol) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(auth, {
        id,
        defaultBase: auth.baseURL || DEFAULT_BASE['openai-compatible'],
      });
    case 'anthropic':
      return new AnthropicProvider(auth, { id, defaultBase: auth.baseURL });
    case 'ollama':
      return new OllamaProvider(auth, { id, defaultBase: auth.baseURL });
    default: {
      const never: never = protocol;
      throw new Error(`unknown protocol ${String(never)}`);
    }
  }
}

/** 按预设 id + 用户覆盖项创建 Provider */
export function createProviderFromPreset(
  presetId: string,
  auth: ProviderAuth = {},
  overrideProtocol?: ProviderProtocol
): ModelProvider {
  const p = PRESET_MAP[presetId];
  if (!p) {
    return createProvider(overrideProtocol || 'openai-compatible', auth, presetId);
  }
  return createProvider(
    overrideProtocol || p.protocol,
    { ...auth, baseURL: auth.baseURL || p.baseURL },
    presetId
  );
}

export function getProviderPreset(presetId: string) {
  return PRESET_MAP[presetId];
}
