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
  buZhou: string;
  message: string;
  code?: number;
}

function readReply(socket: net.Socket, timeoutMs = 8000): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const jiShiQi = setTimeout(() => {
      socket.destroy();
      reject(new Error('smtp timeout'));
    }, timeoutMs);
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      // 完整回复行：`250 ` 或 `250-`
      const HangJi = buf.split(/\r?\n/).filter(Boolean);
      const last = HangJi[HangJi.length - 1];
      if (last && /^\d{3} /.test(last)) {
        clearTimeout(jiShiQi);
        socket.off('data', onData);
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf });
      }
    };
    socket.on('data', onData);
    socket.on('error', (e) => {
      clearTimeout(jiShiQi);
      reject(e);
    });
  });
}

function write(socket: net.Socket, Hang: string) {
  socket.write(Hang + '\r\n');
}

/** AUTH LOGIN 流程 */
export async function yanZhengSmtp(cfg: SmtpPeizhi): Promise<SmtpVerifyResult> {
  return new Promise((resolve) => {
    let buZhou = 'connect';
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

    socket.setTimeout(12000, () => wanCheng({ ok: false, buZhou, message: 'timeout' }));

    socket.once('error', (e) => wanCheng({ ok: false, buZhou, message: String(e.message || e) }));

    const onConnect = async () => {
      try {
        buZhou = 'banner';
        const hengfu = await readReply(socket);
        if (hengfu.code !== 220) {
          return wanCheng({ ok: false, buZhou, message: hengfu.text.slice(0, 200), code: hengfu.code });
        }
        buZhou = 'ehlo';
        write(socket, 'EHLO warmy');
        const ehlo = await readReply(socket);
        if (ehlo.code !== 250) {
          return wanCheng({ ok: false, buZhou, message: ehlo.text.slice(0, 200), code: ehlo.code });
        }

        if (!cfg.secure) {
          // STARTTLS
          if (/STARTTLS/i.test(ehlo.text)) {
            buZhou = 'starttls';
            write(socket, 'STARTTLS');
            const st = await readReply(socket);
            if (st.code !== 220) {
              return wanCheng({ ok: false, buZhou, message: st.text.slice(0, 200), code: st.code });
            }
            return wanCheng({
              ok: false,
              buZhou: 'starttls-handshake',
              message: 'plain socket upgrade not implemented in this verify path; use secure port 465',
            });
          }
        }

        buZhou = 'auth';
        write(socket, 'AUTH LOGIN');
        const a1 = await readReply(socket);
        if (a1.code !== 334) {
          return wanCheng({ ok: false, buZhou, message: a1.text.slice(0, 200), code: a1.code });
        }
        write(socket, Buffer.from(cfg.user, 'utf8').toString('base64'));
        const a2 = await readReply(socket);
        if (a2.code !== 334) {
          return wanCheng({ ok: false, buZhou: 'auth-user', message: a2.text.slice(0, 200), code: a2.code });
        }
        write(socket, Buffer.from(cfg.pass, 'utf8').toString('base64'));
        const a3 = await readReply(socket);
        if (a3.code !== 235) {
          return wanCheng({ ok: false, buZhou: 'auth-pass', message: a3.text.slice(0, 200), code: a3.code });
        }

        buZhou = 'quit';
        write(socket, 'QUIT');
        wanCheng({ ok: true, buZhou: 'auth-pass', message: 'SMTP auth OK' });
      } catch (e) {
        wanCheng({ ok: false, buZhou, message: String((e as Error).message || e) });
      }
    };

    if (cfg.secure) {
      socket.once('secureConnect', onConnect);
    } else {
      socket.once('connect', onConnect);
    }
  });
}
