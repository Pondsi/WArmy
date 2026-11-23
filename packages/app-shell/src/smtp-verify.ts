/**
 * SMTP 连通性验证（不写死账号；由用户在设置中填写）。
 * R298：验证与发件共用同一条受控会话（smtp-hui-hua）——465 隐式 TLS / 587 STARTTLS 真升级，
 * 证书验证、fail-closed、有界响应、真取消。本文件只保留兼容 API（yanZhengSmtp/类型）。
 */
import { daKaiSmtpHuiHua, type SmtpPeizhi } from './smtp-hui-hua.js';

export type { SmtpPeizhi };

export interface SmtpVerifyResult {
  ok: boolean;
  buZhou: string;
  message: string;
  code?: number;
}

/** AUTH 验证：成功即 QUIT 关闭（不发 MAIL/DATA） */
export async function yanZhengSmtp(cfg: SmtpPeizhi): Promise<SmtpVerifyResult> {
  const r = await daKaiSmtpHuiHua(cfg);
  if (!r.ok) return { ok: false, buZhou: r.buZhou, message: r.message, ...(r.code !== undefined ? { code: r.code } : {}) };
  try { r.hui.guanBi(); } catch { /* noop */ }
  return { ok: true, buZhou: 'auth-pass', message: 'SMTP auth OK' };
}