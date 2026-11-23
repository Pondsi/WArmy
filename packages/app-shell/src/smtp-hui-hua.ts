/**
 * R298：受控 SMTP 会话唯一 owner —— 验证与发件共用同一条会话路径。
 *
 * 口径（计划《总结巡查预测发布闭环》§定时授权与邮件配置）：
 *  · 465 隐式 TLS；587 STARTTLS 真升级（升级后重新 EHLO）；证书验证 rejectUnauthorized:true。
 *  · fail-closed：587 不支持 STARTTLS ⇒ 拒绝（绝不在明文通道发凭据）；TLS 不可用 ⇒ 拒绝认证。
 *  · 认证通过后才允许 MAIL/RCPT/DATA（由发件层在本会话上继续）。
 *  · 有界响应（单回复 64KiB/8s，会话 30s）；真 AbortSignal 取消；凭据只经内存，不落盘不进日志。
 */
import net from 'node:net';
import tls from 'node:tls';

export interface SmtpPeizhi {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from?: string;
}

export interface SmtpHuiHua {
  socket: tls.TLSSocket;
  duHuiFu(timeoutMs?: number): Promise<{ code: number; text: string }>;
  xie(hang: string): void;
  guanBi(): void;
}
export type DaKaiJieGuo =
  | { ok: true; hui: SmtpHuiHua }
  | { ok: false; buZhou: string; message: string; code?: number };

const HUI_FU_MAX = 65536;
const HUI_FU_MS = 8000;
const HUI_HUA_MS = 30000;

/** 有界回复读取：完整末行 `NNN ` 才算一条；超限/超时如实失败 */
function duHuiFu(socket: net.Socket, timeoutMs = HUI_FU_MS): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const jiShiQi = setTimeout(() => { cleanup(); reject(new Error('smtp timeout')); }, timeoutMs);
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      if (buf.length > HUI_FU_MAX) { cleanup(); reject(new Error('smtp reply too large')); return; }
      const hangJi = buf.split(/\r?\n/).filter(Boolean);
      const last = hangJi[hangJi.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf.slice(0, 2000) });
      }
    };
    const onErr = (e: Error) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error('smtp connection closed')); };
    function cleanup() {
      clearTimeout(jiShiQi);
      socket.off('data', onData);
      socket.off('error', onErr);
      socket.off('close', onClose);
    }
    socket.on('data', onData);
    socket.once('error', onErr);
    socket.once('close', onClose);
  });
}

/**
 * 打开并认证一条 SMTP 会话。成功返回可继续 MAIL/RCPT/DATA 的会话；
 * 任何一步失败都销毁连接并如实返回步骤（调用方不得在失败后发 DATA）。
 */
export async function daKaiSmtpHuiHua(cfg: SmtpPeizhi, opts: { signal?: AbortSignal; onBuZhou?: (b: string) => void } = {}): Promise<DaKaiJieGuo> {
  let buZhou = 'connect';
  const bu = (b: string) => { buZhou = b; try { opts.onBuZhou?.(b); } catch { /* noop */ } };
  let socket: net.Socket | null = null;
  let hui: SmtpHuiHua | null = null;
  const shiBai = (message: string, code?: number): DaKaiJieGuo => {
    try { socket?.destroy(); } catch { /* noop */ }
    return { ok: false, buZhou, message: String(message).slice(0, 300), ...(code !== undefined ? { code } : {}) };
  };
  if (opts.signal?.aborted) return shiBai('cancelled');
  const onAbort = () => { try { socket?.destroy(); } catch { /* noop */ } };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const zongShi = setTimeout(() => { try { socket?.destroy(); } catch { /* noop */ } }, HUI_HUA_MS);
  try {
    if (!cfg.host || !Number.isFinite(cfg.port) || cfg.port <= 0) return shiBai('bad-config');
    /** SNI 只接受主机名（RFC 6066）；IP 直连时证书按 SAN iPAddress 校验 */
    const sni = net.isIP(cfg.host) ? {} : { servername: cfg.host };
    if (cfg.secure) {
      bu('connect-tls');
      socket = tls.connect({ host: cfg.host, port: cfg.port, ...sni, rejectUnauthorized: true });
      await new Promise<void>((res, rej) => { socket!.once('secureConnect', res); socket!.once('error', rej); });
    } else {
      bu('connect');
      socket = net.connect({ host: cfg.host, port: cfg.port });
      await new Promise<void>((res, rej) => { socket!.once('connect', res); socket!.once('error', rej); });
    }
    if (opts.signal?.aborted) return shiBai('cancelled');
    bu('banner');
    const hengFu = await duHuiFu(socket);
    if (hengFu.code !== 220) return shiBai(hengFu.text, hengFu.code);
    bu('ehlo');
    socket.write('EHLO warmy\r\n');
    const ehlo = await duHuiFu(socket);
    if (ehlo.code !== 250) return shiBai(ehlo.text, ehlo.code);

    if (!cfg.secure) {
      /** 587：必须 STARTTLS 真升级；不支持 ⇒ fail-closed，绝不明文认证 */
      if (!/STARTTLS/i.test(ehlo.text)) return shiBai('starttls-required（服务器不支持 STARTTLS，拒绝明文认证）');
      bu('starttls');
      socket.write('STARTTLS\r\n');
      const st = await duHuiFu(socket);
      if (st.code !== 220) return shiBai(st.text, st.code);
      bu('starttls-handshake');
      const plain = socket;
      const sheng = tls.connect({ socket: plain, ...sni, rejectUnauthorized: true });
      await new Promise<void>((res, rej) => { sheng.once('secureConnect', res); sheng.once('error', rej); });
      socket = sheng;
      if (opts.signal?.aborted) return shiBai('cancelled');
      /** 升级后重新 EHLO（旧明文能力表作废） */
      bu('ehlo-tls');
      socket.write('EHLO warmy\r\n');
      const ehlo2 = await duHuiFu(socket);
      if (ehlo2.code !== 250) return shiBai(ehlo2.text, ehlo2.code);
    }

    bu('auth');
    socket.write('AUTH LOGIN\r\n');
    const a1 = await duHuiFu(socket);
    if (a1.code !== 334) return shiBai(a1.text, a1.code);
    socket.write(Buffer.from(cfg.user, 'utf8').toString('base64') + '\r\n');
    const a2 = await duHuiFu(socket);
    if (a2.code !== 334) return shiBai(a2.text, a2.code);
    bu('auth-pass');
    socket.write(Buffer.from(cfg.pass, 'utf8').toString('base64') + '\r\n');
    const a3 = await duHuiFu(socket);
    if (a3.code !== 235) return shiBai(a3.text, a3.code);

    const zuiZhong = socket as tls.TLSSocket;
    hui = {
      socket: zuiZhong,
      duHuiFu: (ms) => duHuiFu(zuiZhong, ms),
      xie: (hang) => { zuiZhong.write(hang + '\r\n'); },
      guanBi: () => { try { zuiZhong.write('QUIT\r\n'); } catch { /* noop */ } try { zuiZhong.destroy(); } catch { /* noop */ } },
    };
    clearTimeout(zongShi);
    opts.signal?.removeEventListener('abort', onAbort);
    return { ok: true, hui };
  } catch (e) {
    return shiBai(opts.signal?.aborted ? 'cancelled' : String((e as Error)?.message || e));
  } finally {
    clearTimeout(zongShi);
    opts.signal?.removeEventListener('abort', onAbort);
    if (!hui) { try { socket?.destroy(); } catch { /* noop */ } }
  }
}