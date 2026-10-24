/**
 * 错误分类（契约 v1.1「错误分类表」`CuowuLeibie / GuileiCuowu` 的唯一实现）——纯函数，门禁直接跑真值表。
 *
 * 为什么要有它：以前全仓报错都是一串字符串（`xiJingCuoWu() → string`），每个需要"判断错误种类"的地方
 * 各写一条正则 —— 上下文超限一条、风控一条、越权一条……同一句报错在不同地方可能被认成不同的东西，
 * 而且"该不该重试"没有任何地方统一回答。这里把判据收成一张表，带上 `recoverable`：
 *   · 可恢复（换模型/收缩/稍后重试有意义）：超时、服务不可用、上下文超限、风控偶发、IPC 断开；
 *   · 不可恢复（重试一万次也一样）：钥匙/鉴权错、越界访问。
 *
 * 判据顺序有讲究（先命中先返回）：
 *  1. 鉴权、风控、越界 —— 这几类的报错文本里常常**顺带**出现 "token"（"invalid token"）这种词，
 *     必须排在"上下文超限"之前，否则会被当成超限去收缩重试，白烧几轮；
 *  2. IPC 断开（记忆子进程挂了）—— 必须排在通用"超时"之前（"memory ipc timeout"）；
 *  3. 上下文超限 —— 与旧的 `isContextLengthError` 是**同一条正则**（收缩重试依赖它，不许改宽改窄），
 *     只是先把报错里的 URL 去掉：MiMo 的端点域名带 `token-plan`，网络失败的报错里会出现这个域名，
 *     旧判据因此把"连不上"当成"上下文太长"去收缩重试；
 *  4. 超时 / 服务不可用 / 未知。
 */
import type { CuowuLeibie, GuileiCuowu } from '@warmy/contracts';

interface GuiZe {
  lei: CuowuLeibie;
  re: RegExp;
  keHuiFu: boolean;
  code: string;
}

/** 与旧 `isContextLengthError` 完全同一条（收缩重试阶梯的触发条件，改它就是改产品行为） */
export const SHANG_XIA_WEN_CHAO_XIAN = /context|token|too long|maximum length|context_length|maximum context/i;

/**
 * 状态码只在"像状态码的位置"才算（`HTTP 401` / `status: 401` / `"code":"401"` / 行首 `401 `）：
 * 裸写 `\b401\b` 会把"seq 401 没找到"这类与 HTTP 无关的数字误判成鉴权失败。
 */
const ZHUANG_TAI = (ma: string): string => `(?:\\bHTTP\\s*(?:${ma})\\b|\\bstatus(?:\\s*code)?\\s*[:=]?\\s*(?:${ma})\\b|"code"\\s*:\\s*"?(?:${ma})\\b|^\\s*(?:${ma})\\b)`;

const GUI_ZE: GuiZe[] = [
  /**
   * 鉴权：钥匙错、令牌无效/过期。"invalid token" 必须在这里认走 —— 它带 token 一词，
   * 落到下面的超限正则就会被当成"上下文太长"去收缩重试（白烧几轮还是鉴权失败）。
   * `token` 后面跟 count/id/length 的是分词器报错，不是鉴权。
   */
  { lei: 'PERMISSION_DENIED', re: new RegExp(`${ZHUANG_TAI('401|403')}|unauthori[sz]ed|forbidden|invalid[_ ]?(?:api[_ ]?)?key|incorrect api key|\\binvalid[_ ]?(?:access[_ ]?|auth[_ ]?|api[_ ]?|bearer[_ ]?)?token\\b(?![_ ]?(?:count|id|length))|\\btoken (?:has )?expired\\b|\\bexpired[_ ]token\\b|authentication (?:failed|error)|鉴权失败|未授权|permission denied`, 'i'), keHuiFu: false, code: 'auth' },
  { lei: 'MODERATION_BLOCKED', re: /considered high risk|content[_ ]policy|content[_ ]filter|moderation|风控|内容安全/i, keHuiFu: true, code: 'moderation' },
  { lei: 'BOUNDARY_VIOLATION', re: /workspace-escape|absolute-path-not-allowed|outside (the )?workspace|越权/i, keHuiFu: false, code: 'boundary' },
  { lei: 'IPC_DEAD', re: /ERR_IPC_CHANNEL_CLOSED|channel closed|memory service not started|memory ipc timeout|memory child exit/i, keHuiFu: true, code: 'ipc' },
  { lei: 'CONTEXT_OVERFLOW', re: SHANG_XIA_WEN_CHAO_XIAN, keHuiFu: true, code: 'context' },
  { lei: 'PROTO_TIMEOUT', re: /ETIMEDOUT|timed? ?out|timeout|AbortError|aborted|超时/i, keHuiFu: true, code: 'timeout' },
  { lei: 'MODEL_UNAVAILABLE', re: new RegExp(`ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed|socket hang up|${ZHUANG_TAI('429|500|502|503|504')}|rate.?limit|overloaded|\\bmodel\\b[^\\n]{0,40}\\bnot found\\b|no such model|service unavailable|模型不可用`, 'i'), keHuiFu: true, code: 'unavailable' },
];

function wenBenOf(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown }).message;
  if (typeof m === 'string' && m) return m;
  try { return String(e); } catch { return ''; }
}

/**
 * 把任意报错归成契约 `GuileiCuowu`。
 * `tiShi` 是调用方已经确定的类别（例如执行者整段崩了 ⇒ WORKER_CRASH），给了就以它为准，不再猜。
 */
export function fenLeiCuoWu(e: unknown, tiShi?: { category?: CuowuLeibie; code?: string }): GuileiCuowu {
  const yuan = wenBenOf(e);
  const message = yuan.slice(0, 600);
  if (tiShi?.category) {
    const gz = GUI_ZE.find((g) => g.lei === tiShi.category);
    return { category: tiShi.category, code: tiShi.code || gz?.code || tiShi.category.toLowerCase(), message, recoverable: gz ? gz.keHuiFu : tiShi.category !== 'BOUNDARY_VIOLATION', cause: e };
  }
  /** 去掉 URL 再判：端点域名里的词（token-plan）不是错误描述 */
  const wen = yuan.replace(/https?:\/\/\S+/gi, ' ');
  for (const g of GUI_ZE) {
    if (g.re.test(wen)) return { category: g.lei, code: g.code, message, recoverable: g.keHuiFu, cause: e };
  }
  return { category: 'UNKNOWN', code: 'unknown', message, recoverable: true, cause: e };
}

/** 收缩重试阶梯只认这一类（宿主 `isContextLengthError` 委托到这里，判据只有一份） */
export function shiShangXiaWenChaoXian(e: unknown): boolean {
  return fenLeiCuoWu(e).category === 'CONTEXT_OVERFLOW';
}

/** 给用户看的类别名（异常卡片、审计都用它；i18n 键 `err.category.*`，缺键时用这里的中文兜底） */
export const LEI_BIE_MING: Record<CuowuLeibie, string> = {
  PERMISSION_DENIED: '鉴权失败（钥匙或站点不对）',
  BOUNDARY_VIOLATION: '越界访问被拦下',
  PROTO_FRAME: '协议帧错误',
  PROTO_TIMEOUT: '超时',
  IPC_DEAD: '内部服务断开',
  WORKER_CRASH: '执行者崩溃',
  MEMORY_CORRUPT: '记忆库损坏',
  SESSION_MIGRATE: '会话迁移失败',
  MODEL_UNAVAILABLE: '模型服务不可用',
  CONTEXT_OVERFLOW: '上下文超出模型窗口',
  MODERATION_BLOCKED: '被供应商风控拦截',
  UNKNOWN: '未分类错误',
};
