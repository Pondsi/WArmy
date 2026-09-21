/**
 * SMTP 连通性验证（不写死账号；由用户在设置中填写）
 * 支持隐式 TLS (465) 与 STARTTLS (587)
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

export interface SmtpVerifyResult {
  ok: boolean;
  step: string;
  message: string;
  code?: number;
}

function readReply(socket: net.Socket, timeoutMs = 8000): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('smtp timeout'));
    }, timeoutMs);
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      // 完整回复行：`250 ` 或 `250-`
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        clearTimeout(timer);
        socket.off('data', onData);
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf });
      }
    };
    socket.on('data', onData);
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function write(socket: net.Socket, line: string) {
  socket.write(line + '\r\n');
}

/** AUTH LOGIN 流程 */
export async function yanZhengSmtp(cfg: SmtpPeizhi): Promise<SmtpVerifyResult> {
  return new Promise((resolve) => {
    let step = 'connect';
    const wanCheng = (r: SmtpVerifyResult) => {
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(r);
    };

    const socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: false })
      : net.connect({ host: cfg.host, port: cfg.port });

    socket.setTimeout(12000, () => wanCheng({ ok: false, step, message: 'timeout' }));

    socket.once('error', (e) => wanCheng({ ok: false, step, message: String(e.message || e) }));

    const onConnect = async () => {
      try {
        step = 'banner';
        const banner = await readReply(socket);
        if (banner.code !== 220) {
          return wanCheng({ ok: false, step, message: banner.text.slice(0, 200), code: banner.code });
        }
        step = 'ehlo';
        write(socket, 'EHLO warmy');
        const ehlo = await readReply(socket);
        if (ehlo.code !== 250) {
          return wanCheng({ ok: false, step, message: ehlo.text.slice(0, 200), code: ehlo.code });
        }

        if (!cfg.secure) {
          // STARTTLS
          if (/STARTTLS/i.test(ehlo.text)) {
            step = 'starttls';
            write(socket, 'STARTTLS');
            const st = await readReply(socket);
            if (st.code !== 220) {
              return wanCheng({ ok: false, step, message: st.text.slice(0, 200), code: st.code });
            }
            return wanCheng({
              ok: false,
              step: 'starttls-handshake',
              message: 'plain socket upgrade not implemented in this verify path; use secure port 465',
            });
          }
        }

        step = 'auth';
        write(socket, 'AUTH LOGIN');
        const a1 = await readReply(socket);
        if (a1.code !== 334) {
          return wanCheng({ ok: false, step, message: a1.text.slice(0, 200), code: a1.code });
        }
        write(socket, Buffer.from(cfg.user, 'utf8').toString('base64'));
        const a2 = await readReply(socket);
        if (a2.code !== 334) {
          return wanCheng({ ok: false, step: 'auth-user', message: a2.text.slice(0, 200), code: a2.code });
        }
        write(socket, Buffer.from(cfg.pass, 'utf8').toString('base64'));
        const a3 = await readReply(socket);
        if (a3.code !== 235) {
          return wanCheng({ ok: false, step: 'auth-pass', message: a3.text.slice(0, 200), code: a3.code });
        }

        step = 'quit';
        write(socket, 'QUIT');
        wanCheng({ ok: true, step: 'auth-pass', message: 'SMTP auth OK' });
      } catch (e) {
        wanCheng({ ok: false, step, message: String((e as Error).message || e) });
      }
    };

    if (cfg.secure) {
      socket.once('secureConnect', onConnect);
    } else {
      socket.once('connect', onConnect);
    }
  });
}
