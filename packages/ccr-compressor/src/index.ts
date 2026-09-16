/**
 * @ccarmy/ccr-compressor — 写入侧 CCR 压缩网关（零 LLM）
 * 不变量：压缩在内容进入日志之前发生，日志本身是压缩态
 */

export interface CompressInput {
  kind: 'tool_result' | 'message' | 'system';
  content: string;
  /** 工具名，便于按工具裁剪 */
  toolName?: string;
}

export interface CompressOutput {
  content: string;
  /** 原始字节数 */
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  /** 是否被截断/折叠 */
  truncated: boolean;
  /** 折叠掉的锚点提示，供 recall */
  pointers: Array<{ label: string; bytes: number }>;
}

const DEFAULT_BUDGET = 4000;

/** 重复空行/长空白折叠 */
function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 工具输出常见噪音剥离 */
function stripNoise(s: string, toolName?: string): string {
  let out = s;
  if (toolName === 'bash' || toolName === 'pwsh') {
    out = out.replace(/^\+ /gm, '');
  }
  // base64 长块
  out = out.replace(/(?:[A-Za-z0-9+/]{80,}={0,2})/g, '[base64-omitted]');
  // 重复进度条
  out = out.replace(/(\r?\n|^)([#=\-\.>]{10,}[^\n]{0,40}\n){3,}/g, '$1[progress-omitted]\n');
  return out;
}

/**
 * 头尾保留 + 中部指针（ADR：工具输出先过 CCR 再进历史）
 */
export function compress(input: CompressInput, budget = DEFAULT_BUDGET): CompressOutput {
  const raw = collapseWhitespace(stripNoise(input.content, input.toolName));
  const originalBytes = Buffer.byteLength(input.content, 'utf8');
  const buf = Buffer.byteLength(raw, 'utf8');
  if (buf <= budget) {
    return {
      content: raw,
      originalBytes,
      compressedBytes: buf,
      ratio: originalBytes ? buf / originalBytes : 1,
      truncated: false,
      pointers: [],
    };
  }

  const half = Math.floor(budget * 0.4);
  const head = raw.slice(0, half);
  const tail = raw.slice(-Math.floor(budget * 0.35));
  const midBytes = buf - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
  const content = `${head}\n\n… [CCR 省略 ${midBytes} 字节 / 可用 recall 取回] …\n\n${tail}`;
  const compressedBytes = Buffer.byteLength(content, 'utf8');
  return {
    content,
    originalBytes,
    compressedBytes,
    ratio: originalBytes ? compressedBytes / originalBytes : 1,
    truncated: true,
    pointers: [{ label: `${input.kind}:${input.toolName || 'body'}`, bytes: midBytes }],
  };
}

/** 批量网关：进入日志前统一压缩 */
export class CcrGateway {
  constructor(private budget = DEFAULT_BUDGET) {}

  beforeLog(input: CompressInput): CompressOutput {
    // 消息类少压缩，工具结果优先压缩（ADR：工具输出↓70% 目标）
    const budget = input.kind === 'tool_result' ? this.budget : this.budget * 4;
    return compress(input, budget);
  }
}
