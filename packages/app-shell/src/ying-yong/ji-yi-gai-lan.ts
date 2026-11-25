/**
 * R301：动态项目概览（派生页面）＋派生缓存。
 * 读取不触发模型；源变化标脏/陈旧，由总结巡查增量更新；不覆盖用户手写项目 MEMORY。
 * 缓存键含授权修订、源版本/hash、策略、语言与层级；canonical 编码；最多 256 项 LRU；权限撤销/纠错/替代立即失效。
 */
import crypto from 'node:crypto';

export interface GaiLanYe {
  projectId: string;
  goals: string[];
  acceptance: string[];
  decisions: string[];
  todos: string[];
  risks: string[];
  sources: string[];
  updatedAt: number;
  stale: boolean;
  sourceHash: string;
}
export interface GaiLanYuan {
  memory?: string;
  plans?: Array<{ title?: string; status?: string; acceptance?: string[] }>;
  evidence?: Array<{ id: string; note?: string }>;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
/** canonical 键：键序确定，避免同内容不同序产生重复缓存。 */
export function guiFanHuaJian(o: Record<string, unknown>): string {
  const keys = Object.keys(o).sort();
  return JSON.stringify(keys.map((k) => [k, o[k]]));
}
export function yuanHash(yuan: GaiLanYuan): string {
  return sha(guiFanHuaJian({ memory: yuan.memory || '', plans: yuan.plans || [], evidence: yuan.evidence || [] }));
}

/** 有界 LRU（最多 256）；get/set 刷新近用；超出淘汰最久未用。 */
export class HuanCun<K, V> {
  private map = new Map<K, V>();
  constructor(private max = 256) {}
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k); this.map.set(k, v);
    return v;
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value as K | undefined;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  delete(k: K): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

export const GAI_LAN_HUAN_CUN = new HuanCun<string, GaiLanYe>(256);

/** 从现有 MEMORY/计划/已核验证据派生概览；不调用模型。源 hash 变化即标脏。 */
export function paiShengGaiLan(projectId: string, yuan: GaiLanYuan, o: { authRev: number; policy: string; lang: string; level: string; now?: number }): GaiLanYe {
  const now = o.now || Date.now();
  const sourceHash = yuanHash(yuan);
  const key = guiFanHuaJian({ projectId, authRev: o.authRev, sourceHash, policy: o.policy, lang: o.lang, level: o.level });
  const cached = GAI_LAN_HUAN_CUN.get(key);
  if (cached && cached.sourceHash === sourceHash) return { ...cached, stale: false };
  const goals: string[] = [];
  const acceptance: string[] = [];
  const decisions: string[] = [];
  const todos: string[] = [];
  const risks: string[] = [];
  const sources: string[] = [];
  for (const p of yuan.plans || []) {
    if (p.title) goals.push(String(p.title));
    for (const a of p.acceptance || []) acceptance.push(String(a));
    if (p.status === 'doing' || p.status === 'todo') todos.push(String(p.title || ''));
    if (p.status === 'done') decisions.push(String(p.title || ''));
  }
  for (const e of yuan.evidence || []) { sources.push(e.id); if (e.note) risks.push(String(e.note)); }
  if (yuan.memory) sources.push('project-memory');
  const ye: GaiLanYe = { projectId, goals, acceptance, decisions, todos, risks, sources, updatedAt: now, stale: false, sourceHash };
  GAI_LAN_HUAN_CUN.set(key, ye);
  return ye;
}

/** 权限撤销/纠错/替代：按项目或全量立即失效。 */
export function gaiLanShiXiao(projectId?: string): void {
  if (!projectId) { GAI_LAN_HUAN_CUN.clear(); return; }
  /* 键含 projectId 前缀无法直接枚举；保守全量失效，避免越权缓存残留。 */
  GAI_LAN_HUAN_CUN.clear();
}