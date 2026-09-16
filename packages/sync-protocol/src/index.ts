/**
 * @ccarmy/sync-protocol — 节点注册 + 文件总线消息 + incognito 约定
 * 不变量 10/11：远程 AI 无痕；值班权仅本机
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface NodeInfo {
  nodeId: string;
  name: string;
  isLocal: boolean;
  pairedAt: number;
  revoked?: boolean;
}

export interface SyncEnvelope {
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

export interface InviteToken {
  token: string;
  expiresAt: number;
  used: boolean;
  groupId?: string;
}

export class NodeRegistry {
  private nodes = new Map<string, NodeInfo>();

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

  registerLocal(name: string): NodeInfo {
    const id = 'node-' + crypto.randomBytes(4).toString('hex');
    const info: NodeInfo = { nodeId: id, name, isLocal: true, pairedAt: Date.now() };
    this.nodes.set(id, info);
    this.save();
    return info;
  }

  pairRemote(nodeId: string, name: string): NodeInfo {
    const info: NodeInfo = { nodeId, name, isLocal: false, pairedAt: Date.now() };
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

  list(): NodeInfo[] {
    return [...this.nodes.values()].filter((n) => !n.revoked);
  }

  isLocal(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.isLocal === true;
  }
}

export class SyncBus {
  private seq = 0;

  constructor(private busDir: string) {
    fs.mkdirSync(busDir, { recursive: true });
  }

  private get file() {
    return path.join(this.busDir, 'messages.jsonl');
  }

  publish(env: Omit<SyncEnvelope, 'id' | 'ts'>): SyncEnvelope {
    const full: SyncEnvelope = {
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

  pull(nodeId: string): SyncEnvelope[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SyncEnvelope)
      .filter((m) => m.toNode === nodeId || m.toNode === '*');
  }
}

export function createInvite(ttlMs = 15 * 60_000, groupId?: string): InviteToken {
  return {
    token: crypto.randomBytes(16).toString('hex'),
    expiresAt: Date.now() + ttlMs,
    used: false,
    groupId,
  };
}

export function consumeInvite(tok: InviteToken): boolean {
  if (tok.used || Date.now() > tok.expiresAt) return false;
  tok.used = true;
  return true;
}

export * from './lan.js';
export * from './mesh.js';

/** 远程 AI 执行约定：本地零痕迹目录（临时，用完即删） */
export function incognitoWorkDir(): string {
  return path.join(os.tmpdir(), `ccarmy-incog-${crypto.randomBytes(6).toString('hex')}`);
}
