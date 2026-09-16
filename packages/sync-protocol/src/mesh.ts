/**
 * 多节点组网（无中心服务器）
 *
 * 内网：UDP 广播发现 + TCP mesh（JSONL）
 * 外网：用户手动添加 peer://host:port（或已在公网可达的节点）
 * 纯 P2P 打洞（STUN/ICE）不在无服务器前提下保证成功；本实现提供：
 *   - 局域网自动发现
 *   - 多 peer 注册与 mesh 转发
 *   - 外网节点手动加入（对方需可达端口或已有公网映射）
 */
import dgram from 'node:dgram';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PeerInfo {
  nodeId: string;
  name: string;
  /** IPv4 / 主机名 */
  host: string;
  /** TCP 服务端口 */
  port: number;
  /** lan | wan */
  kind: 'lan' | 'wan';
  lastSeen: number;
  revoked?: boolean;
}

export interface MeshMessage {
  id: string;
  from: string;
  to: string | '*';
  channel: 'group' | 'control' | 'invite' | 'gossip';
  groupId?: string;
  payload: unknown;
  ts: number;
  incognito?: boolean;
  /** 已经过的节点，防环 */
  hops?: string[];
}

const DISCOVER_PORT = 7799;
const HELLO = 'CCARMY-HELLO/1';

export class PeerRegistry {
  private peers = new Map<string, PeerInfo>();

  constructor(private file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const p of j.peers || []) this.peers.set(p.nodeId, p);
    } catch {
      /* fresh */
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ peers: [...this.peers.values()] }, null, 2));
  }

  upsert(p: PeerInfo): PeerInfo {
    const prev = this.peers.get(p.nodeId);
    const full = { ...prev, ...p, lastSeen: Date.now() };
    this.peers.set(full.nodeId, full);
    this.save();
    return full;
  }

  addManual(nodeId: string, name: string, host: string, port: number, kind: 'lan' | 'wan' = 'wan'): PeerInfo {
    return this.upsert({ nodeId, name, host, port, kind, lastSeen: Date.now() });
  }

  revoke(nodeId: string) {
    const p = this.peers.get(nodeId);
    if (p) {
      p.revoked = true;
      this.save();
    }
  }

  list(includeRevoked = false): PeerInfo[] {
    return [...this.peers.values()].filter((p) => includeRevoked || !p.revoked);
  }

  markSeen(nodeId: string) {
    const p = this.peers.get(nodeId);
    if (p) {
      p.lastSeen = Date.now();
      this.save();
    }
  }
}

/** UDP 局域网发现 */
export class LanDiscovery {
  private sock: dgram.Socket | null = null;

  constructor(
    private nodeId: string,
    private name: string,
    private tcpPort: number,
    private onPeer: (p: { nodeId: string; name: string; host: string; port: number }) => void
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock.on('error', reject);
      this.sock.on('message', (msg, rinfo) => {
        const s = msg.toString('utf8');
        if (!s.startsWith(HELLO)) return;
        try {
          const j = JSON.parse(s.slice(HELLO.length + 1));
          if (j.nodeId === this.nodeId) return;
          this.onPeer({
            nodeId: j.nodeId,
            name: j.name || j.nodeId,
            host: rinfo.address,
            port: j.port,
          });
        } catch {
          /* skip */
        }
      });
      this.sock.bind(DISCOVER_PORT, () => {
        try {
          this.sock!.setBroadcast(true);
        } catch {
          /* ignore */
        }
        resolve();
      });
    });
  }

  broadcast(): void {
    if (!this.sock) return;
    const payload = Buffer.from(
      `${HELLO} ${JSON.stringify({ nodeId: this.nodeId, name: this.name, port: this.tcpPort })}`,
      'utf8'
    );
    try {
      this.sock.send(payload, DISCOVER_PORT, '255.255.255.255');
      // 常见本地广播
      this.sock.send(payload, DISCOVER_PORT, '192.168.1.255');
    } catch {
      /* ignore */
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sock) return resolve();
      this.sock.close(() => resolve());
      this.sock = null;
    });
  }
}

/** TCP mesh 服务：收消息 + 可向任意 peer 直发 */
export class MeshNode {
  private server: net.Server | null = null;
  private inbox: MeshMessage[] = [];

  constructor(
    public nodeId: string,
    public tcpPort: number,
    private peers: PeerRegistry,
    private logFile?: string
  ) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => {
        let buf = '';
        sock.on('data', (d) => {
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line) as MeshMessage;
              this.receive(msg);
              sock.write(JSON.stringify({ ack: true, id: msg.id }) + '\n');
            } catch {
              /* skip */
            }
          }
        });
        sock.on('error', () => {});
      });
      this.server.once('error', reject);
      this.server.listen(this.tcpPort, '0.0.0.0', () => resolve(this.tcpPort));
    });
  }

  private receive(msg: MeshMessage) {
    if (msg.incognito) return;
    this.inbox.push(msg);
    if (this.logFile) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, JSON.stringify(msg) + '\n');
    }
    // gossip：广播给未访问过的 peer（简单洪泛）
    if (msg.channel === 'gossip') {
      const hops = new Set([...(msg.hops || []), this.nodeId, msg.from]);
      for (const p of this.peers.list()) {
        if (hops.has(p.nodeId)) continue;
        void this.sendToPeer(p, { ...msg, hops: [...hops] });
      }
    }
  }

  private sendToPeer(p: PeerInfo, msg: MeshMessage): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.connect({ host: p.host, port: p.port }, () => {
        sock.write(JSON.stringify(msg) + '\n');
        sock.end();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(4000, () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  async sendToAll(msg: Omit<MeshMessage, 'id' | 'ts' | 'from' | 'hops'>): Promise<{ sent: number; failed: number }> {
    const full: MeshMessage = {
      ...msg,
      from: this.nodeId,
      id: `m-${crypto.randomBytes(6).toString('hex')}`,
      ts: Date.now(),
      hops: [this.nodeId],
    };
    let sent = 0;
    let failed = 0;
    for (const p of this.peers.list()) {
      const ok = await this.sendToPeer(p, full);
      if (ok) sent++;
      else failed++;
    }
    if (!msg.incognito) this.receive(full);
    return { sent, failed };
  }

  async sendTo(nodeId: string, msg: Omit<MeshMessage, 'id' | 'ts' | 'from' | 'hops'>): Promise<boolean> {
    const p = this.peers.list().find((x) => x.nodeId === nodeId);
    if (!p) return false;
    const full: MeshMessage = {
      ...msg,
      from: this.nodeId,
      id: `m-${crypto.randomBytes(6).toString('hex')}`,
      ts: Date.now(),
      hops: [this.nodeId],
    };
    return this.sendToPeer(p, full);
  }

  inboxOf(): MeshMessage[] {
    return [...this.inbox];
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

/** 无服务器说明（UI 展示用） */
export const P2P_NOTES = {
  lan: '同一局域网：UDP 广播自动发现 + TCP 互通。',
  wanManual: '跨公网无服务器：请在双方「添加节点」填 对方公网IP:端口；双方路由器需做端口映射或主机在公网可达。',
  wanHard: '对称 NAT 双方均不可达时，无中心服务器无法保证直连；需要任一节点有公网映射，或后续接可选中继。',
};
