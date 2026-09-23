/**
 * 内网 TCP 同步：节点间消息总线（真双机）
 * 协议：JSON lines over TCP，默认端口 7788
 */
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface NeiWangXiaoXi {
  id: string;
  from: string;
  to: string | '*';
  channel: 'group' | 'control' | 'invite';
  groupId?: string;
  payload: unknown;
  ts: number;
  incognito?: boolean;
}

export class NeiWangTongBuFuWu {
  private server: net.Server | null = null;
  private clients = new Set<net.Socket>();
  private inbox: NeiWangXiaoXi[] = [];

  constructor(
    private nodeId: string,
    private port: number,
    private logFile?: string
  ) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => {
        this.clients.add(sock);
        let buf = '';
        sock.on('data', (d) => {
          buf += d.toString('utf8');
          let suoYin;
          while ((suoYin = buf.indexOf('\n')) >= 0) {
            const Hang = buf.slice(0, suoYin).trim();
            buf = buf.slice(suoYin + 1);
            if (!Hang) continue;
            try {
              const xiaoXi = JSON.parse(Hang) as NeiWangXiaoXi;
              if (!xiaoXi.incognito) {
                this.inbox.push(xiaoXi);
                if (this.logFile) {
                  fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
                  fs.appendFileSync(this.logFile, Hang + '\n');
                }
              }
              // ACK
              sock.write(JSON.stringify({ ack: true, id: xiaoXi.id }) + '\n');
            } catch {
              /* skip */
            }
          }
        });
        sock.on('error', () => this.clients.delete(sock));
        sock.on('close', () => this.clients.delete(sock));
      });
      this.server.once('error', reject);
      this.server.listen(this.port, '0.0.0.0', () => {
        resolve(this.port);
      });
    });
  }

  inboxOf(nodeId?: string): NeiWangXiaoXi[] {
    return this.inbox.filter((m) => !nodeId || m.to === nodeId || m.to === '*');
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const c of this.clients) c.destroy();
      this.clients.clear();
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  get listening(): boolean {
    return !!this.server?.listening;
  }
}

export class NeiWangTongBuKeHu {
  constructor(private nodeId: string) {}

  faSong(host: string, port: number, xiaoXi: Omit<NeiWangXiaoXi, 'id' | 'ts' | 'from'>): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const sock = net.connect({ host, port }, () => {
        const Quan: NeiWangXiaoXi = {
          ...xiaoXi,
          from: this.nodeId,
          id: `m-${crypto.randomBytes(6).toString('hex')}`,
          ts: Date.now(),
        };
        sock.write(JSON.stringify(Quan) + '\n');
        sock.end();
        resolve({ ok: true });
      });
      sock.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
      sock.setTimeout(5000, () => {
        sock.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
    });
  }
}

/** 双机联测：本机起 server，向 peer 发消息 */
export async function shuangJiMaoYan(opts: {
  localId: string;
  localPort: number;
  peerHost?: string;
  peerPort?: number;
}): Promise<{
  serverPort: number;
  loopbackOk: boolean;
  peerHost?: string;
  peerOk: boolean;
  peerError?: string;
}> {
  const srv = new NeiWangTongBuFuWu(opts.localId, opts.localPort);
  const serverPort = await srv.start();
  const client = new NeiWangTongBuKeHu(opts.localId + '-client');

  const loop = await client.faSong('127.0.0.1', serverPort, {
    to: '*',
    channel: 'group',
    payload: { text: 'loopback-hello' },
  });
  // 等待落盘
  await new Promise((r) => setTimeout(r, 100));
  const loopbackOk = loop.ok && srv.inboxOf().some((m) => (m.payload as { text?: string })?.text === 'loopback-hello');

  let peerOk = false;
  let peerError: string | undefined;
  let peerHost = opts.peerHost;
  if (opts.peerHost && opts.peerPort) {
    const pr = await client.faSong(opts.peerHost, opts.peerPort, {
      to: '*',
      channel: 'group',
      payload: { text: 'peer-hello-from-' + opts.localId },
    });
    peerOk = pr.ok;
    peerError = pr.error;
  }

  await srv.stop();
  return { serverPort, loopbackOk, peerHost, peerOk, peerError };
}
