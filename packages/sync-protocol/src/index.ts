/**
 * @warmy/sync-protocol — 节点注册 + 文件总线消息 + incognito 约定
 * 不变量 10/11：远程 AI 无痕；值班权仅本机
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface JieDianXinXi {
  nodeId: string;
  name: string;
  isLocal: boolean;
  pairedAt: number;
  revoked?: boolean;
}

export interface TongbuFeng {
  id: string;
  fromNode: string;
  toNode: string | '*';
  channel: 'group' | 'control' | 'invite';
  groupId?: string;
  payload: unknown;
  ts: number;
  /** 远程 AI 执行任务时不得落盘 */
  incognito?: boolean;
}

export interface YaoQingLingPai {
  token: string;
  expiresAt: number;
  used: boolean;
  groupId?: string;
}

export class JieDianMingCe {
  private nodes = new Map<string, JieDianXinXi>();

  constructor(private file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const n of j.nodes || []) this.nodes.set(n.nodeId, n);
    } catch {
      /* fresh */
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ nodes: [...this.nodes.values()] }, null, 2));
  }

  registerLocal(name: string): JieDianXinXi {
    const id = 'node-' + crypto.randomBytes(4).toString('hex');
    const info: JieDianXinXi = { nodeId: id, name, isLocal: true, pairedAt: Date.now() };
    this.nodes.set(id, info);
    this.save();
    return info;
  }

  pairRemote(nodeId: string, name: string): JieDianXinXi {
    const info: JieDianXinXi = { nodeId, name, isLocal: false, pairedAt: Date.now() };
    this.nodes.set(nodeId, info);
    this.save();
    return info;
  }

  revoke(nodeId: string): void {
    const n = this.nodes.get(nodeId);
    if (n) {
      n.revoked = true;
      this.save();
    }
  }

  list(): JieDianXinXi[] {
    return [...this.nodes.values()].filter((n) => !n.revoked);
  }

  isLocal(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.isLocal === true;
  }
}

export class TongbuZongxian {
  private seq = 0;

  constructor(private busDir: string) {
    fs.mkdirSync(busDir, { recursive: true });
  }

  private get file() {
    return path.join(this.busDir, 'messages.jsonl');
  }

  publish(env: Omit<TongbuFeng, 'id' | 'ts'>): TongbuFeng {
    const full: TongbuFeng = {
      ...env,
      id: `m-${++this.seq}-${Date.now().toString(36)}`,
      ts: Date.now(),
    };
    // incognito：不写入 bus 文件（无痕）
    if (full.incognito) {
      return full;
    }
    fs.appendFileSync(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  pull(nodeId: string): TongbuFeng[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TongbuFeng)
      .filter((m) => m.toNode === nodeId || m.toNode === '*');
  }
}

export function chuangjianYaoQing(ttlMs = 15 * 60_000, groupId?: string): YaoQingLingPai {
  return {
    token: crypto.randomBytes(16).toString('hex'),
    expiresAt: Date.now() + ttlMs,
    used: false,
    groupId,
  };
}

export function shiYongYaoQing(tok: YaoQingLingPai): boolean {
  if (tok.used || Date.now() > tok.expiresAt) return false;
  tok.used = true;
  return true;
}

export * from './lan.js';
export * from './mesh.js';
export * from './codec.js';
export * from './identity.js';
export * from './handshake.js';
export * from './secure-channel.js';
export * from './secure-session.js';
export * from './dht.js';
export * from './ladder.js';
export * from './dialability.js';
export * from './relay.js';
export * from './announce.js';
export * from './liveness.js';
export * from './membership.js';

/** 远程 AI 执行约定：本地零痕迹目录（临时，用完即删） */
export function niMingGongZuoMuLu(): string {
  return path.join(os.tmpdir(), `warmy-incog-${crypto.randomBytes(6).toString('hex')}`);
}
