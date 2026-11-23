/**
 * R298：SMTP 发件 —— 在受控会话（smtp-hui-hua）上完成 MAIL/RCPT/DATA。
 *
 * 口径（计划《总结巡查预测发布闭环》§定时授权与邮件配置）：
 *  · 认证通过后才 MAIL/RCPT/DATA；任一 RCPT 被拒 ⇒ 不发 DATA。
 *  · 头部注入拦截：from/to/subject 含 CR/LF 一律拒绝；主题 RFC2047 编码。
 *  · 回执只表示服务器接受（250），不保证最终送达；DATA 提交后断线/超时/回执未知 ⇒ unknown，不盲目补发。
 *  · 稳定 Message-ID 由调用方持久化（不当作对方去重保证）；附件有界（单 5MiB/总 10MiB），缺失如实失败。
 *  · 凭据只经内存（调用方从安全仓解析）；本模块不落盘、不记日志正文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { daKaiSmtpHuiHua, type SmtpPeizhi } from './smtp-hui-hua.js';

export interface SmtpFaSongQingQiu {
  cfg: SmtpPeizhi;
  from: string;
  to: string[];
  subject: string;
  body: string;
  attachments?: Array<{ path: string; filename?: string }>;
  signal?: AbortSignal;
  /** 调用方持久化的稳定 Message-ID（重试同一意图时复用；不保证对方去重） */
  messageId?: string;
}
export interface SmtpFaSongJieGuo {
  status: 'accepted' | 'unknown' | 'failed';
  receipt: string;
  messageId: string;
}

const DIAN_ZI_YOU_JIAN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FU_JIAN_MAX = 5 * 1024 * 1024;
const FU_JIAN_ZONG_MAX = 10 * 1024 * 1024;
const shou = (s: unknown, n = 500): string => String(s ?? '').slice(0, n);

/** 点填充（DATA 正文里以 . 开头的行要 doubled，防止提前结束） */
function dianTianChong(wen: string): string {
  return wen.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}
function rfc2047(subject: string): string {
  return '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
}

export async function faSongSmtpYouJian(qing: SmtpFaSongQingQiu): Promise<SmtpFaSongJieGuo> {
  const messageId = String(qing.messageId || `<warmy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${qing.cfg.host || 'local'}>`);
  const shiBai = (receipt: string): SmtpFaSongJieGuo => ({ status: 'failed', receipt: shou(receipt), messageId });
  /** 头部注入拦截 */
  const tou = [qing.from, ...qing.to, qing.subject];
  if (tou.some((x) => /[\r\n]/.test(String(x || '')))) return shiBai('header-injection-rejected（头部含换行，拒绝）');
  if (!DIAN_ZI_YOU_JIAN.test(qing.from)) return shiBai('bad-from');
  if (!Array.isArray(qing.to) || !qing.to.length || qing.to.some((x) => !DIAN_ZI_YOU_JIAN.test(String(x || '')))) return shiBai('bad-to');
  if (!String(qing.subject || '').trim()) return shiBai('bad-subject');
  /** 附件有界读取：缺失/超限如实失败，不静默跳过 */
  const fuJian: Array<{ filename: string; base64: string }> = [];
  let zong = 0;
  for (const a of qing.attachments || []) {
    try {
      const st = fs.statSync(a.path);
      if (!st.isFile() || st.size > FU_JIAN_MAX) return shiBai(`attachment-too-large-or-not-file: ${a.path}`);
      zong += st.size;
      if (zong > FU_JIAN_ZONG_MAX) return shiBai('attachments-total-too-large');
      fuJian.push({ filename: String(a.filename || path.basename(a.path)).replace(/[\r\n"]/g, ''), base64: fs.readFileSync(a.path).toString('base64') });
    } catch { return shiBai(`attachment-unreadable: ${a.path}`); }
  }

  const kai = await daKaiSmtpHuiHua(qing.cfg, { ...(qing.signal ? { signal: qing.signal } : {}) });
  if (!kai.ok) return shiBai(`会话失败@${kai.buZhou}: ${kai.message}`);
  const hui = kai.hui;
  let dataYiTiJiao = false;
  const guan = () => { try { hui.guanBi(); } catch { /* noop */ } };
  const onAbort = () => { try { hui.socket.destroy(); } catch { /* noop */ } };
  qing.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    hui.xie(`MAIL FROM:<${qing.from}>`);
    const mail = await hui.duHuiFu();
    if (mail.code !== 250) { guan(); return shiBai(`MAIL 被拒 ${mail.code}: ${mail.text}`); }
    for (const to of qing.to) {
      hui.xie(`RCPT TO:<${to}>`);
      const rcpt = await hui.duHuiFu();
      if (rcpt.code !== 250 && rcpt.code !== 251) { guan(); return shiBai(`RCPT 被拒 ${rcpt.code}（${to}）: ${rcpt.text}（未发 DATA）`); }
    }
    hui.xie('DATA');
    const data = await hui.duHuiFu();
    if (data.code !== 354) { guan(); return shiBai(`DATA 被拒 ${data.code}: ${data.text}`); }
    /** 组装报文（头部 + 正文/附件） */
    const riQi = new Date().toUTCString();
    const changJie = 'warmy-boundary-' + Date.now().toString(36);
    const touBu = [
      `From: ${qing.from}`,
      `To: ${qing.to.join(', ')}`,
      `Subject: ${rfc2047(qing.subject)}`,
      `Date: ${riQi}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
    ];
    let zhengWen: string;
    if (fuJian.length) {
      touBu.push(`Content-Type: multipart/mixed; boundary="${changJie}"`);
      const duan = [
        `--${changJie}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dianTianChong(qing.body),
      ];
      for (const f of fuJian) {
        duan.push(`--${changJie}`, `Content-Type: application/octet-stream; name="${f.filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${f.filename}"`, '', f.base64.replace(/(.{76})/g, '$1\r\n'));
      }
      duan.push(`--${changJie}--`, '');
      zhengWen = duan.join('\r\n');
    } else {
      touBu.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit');
      zhengWen = dianTianChong(qing.body);
    }
    const baoWen = touBu.join('\r\n') + '\r\n\r\n' + zhengWen + '\r\n.\r\n';
    hui.socket.write(baoWen);
    dataYiTiJiao = true;
    /** DATA 已提交：此后任何断线/超时/未知 ⇒ unknown（不盲目补发） */
    let jie: { code: number; text: string };
    try {
      jie = await hui.duHuiFu(15000);
    } catch (e) {
      guan();
      return { status: 'unknown', receipt: shou(`DATA 后回执未知（不补发）: ${(e as Error)?.message || e}`), messageId };
    }
    guan();
    if (jie.code === 250) return { status: 'accepted', receipt: shou(`服务器接受 ${jie.code}: ${jie.text}`), messageId };
    return shiBai(`DATA 后被拒 ${jie.code}: ${jie.text}`);
  } catch (e) {
    guan();
    if (dataYiTiJiao) return { status: 'unknown', receipt: shou(`DATA 后异常（不补发）: ${(e as Error)?.message || e}`), messageId };
    return shiBai(qing.signal?.aborted ? 'cancelled' : String((e as Error)?.message || e));
  } finally {
    qing.signal?.removeEventListener('abort', onAbort);
  }
}