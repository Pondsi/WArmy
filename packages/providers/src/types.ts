/**
 * @ccarmy/providers — 多协议模型 Provider 抽象
 *
 * 协议覆盖：
 * 1. OpenAI 兼容 /v1/chat/completions
 *    — DeepSeek / SiliconFlow / Moonshot / GLM / Groq / Together / OpenAI …
 * 2. Anthropic Messages /v1/messages
 * 3. Ollama 本地 /api/chat
 *
 * 产品不绑死任何一家；DeepSeek 仅是 OpenAI 兼容预设之一。
 */

// ─────────────────────────────────────────────
// 通用消息与用量
// ─────────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** tool_calls 时由 assistant 侧携带 */
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** 统一缓存/用量指标（各厂字段不同，Provider 层归一） */
export interface CacheUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 前缀缓存命中 token；无该能力的厂商填 0 */
  cacheHitTokens: number;
  /** 未命中 token */
  cacheMissTokens: number;
  /** 指标来源：provider 原生字段 / 估算 / 无 */
  source: 'native' | 'estimated' | 'none';
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** 透传给具体协议的扩展字段 */
  extra?: Record<string, unknown>;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string | null;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage: CacheUsage;
  /** 原始协议响应体，便于调试，不入业务逻辑 */
  raw?: unknown;
}

export interface ChatChunkDelta {
  content?: string;
  toolCalls?: ToolCall[];
  role?: ChatRole;
}

export interface ChatChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: ChatChunkDelta;
    finishReason: string | null;
  }>;
}

// ─────────────────────────────────────────────
// Provider 接口
// ─────────────────────────────────────────────

export type ProviderProtocol = 'openai-compatible' | 'anthropic' | 'ollama';

export interface ProviderAuth {
  /** API Key；Ollama 可为空 */
  apiKey?: string;
  /** 覆盖 baseURL（用户自定义中转） */
  baseURL?: string;
  /** 额外 HTTP 头 */
  headers?: Record<string, string>;
  /** 请求超时 ms，默认 120_000 */
  timeoutMs?: number;
}

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /** 默认 baseURL */
  baseURL: string;
  /** 建议默认模型 */
  defaultModel: string;
  /** 是否需要 API Key */
  requiresApiKey: boolean;
  docs?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  readonly baseURL: string;
  /**
   * 是否支持 function calling（ADR 002 §9.4 待办 2）。
   * 缺省时按协议表判定（见 tools.ts 的 PROTOCOL_TOOL_SUPPORT）：
   * 不支持 → 工具调用循环**优雅降级**为普通单轮对话。
   */
  readonly supportsTools?: boolean;

  /** 同步对话 */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;

  /** 流式对话 */
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;

  /** 列模型（协议支持时） */
  listModels(signal?: AbortSignal): Promise<string[]>;

  /** 连通性探测 */
  ping(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
}

// ─────────────────────────────────────────────
// 内置预设（用户可改 baseURL / key / 模型）
// ─────────────────────────────────────────────

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    protocol: 'openai-compatible',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    requiresApiKey: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    protocol: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    requiresApiKey: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    requiresApiKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    protocol: 'ollama',
    baseURL: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:7b',
    requiresApiKey: false,
  },
];
