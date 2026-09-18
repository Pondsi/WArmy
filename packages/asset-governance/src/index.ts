/**
 * @warmy/asset-governance — 六分类 × 四层作用域 × 强/弱/背景 × 生命周期
 */
import fs from 'node:fs';
import path from 'node:path';

export type AssetCategory = 'skill' | 'rule' | 'memory' | 'prompt' | 'tool' | 'file';
export type AssetScope = 'session' | 'project' | 'user' | 'global';
export type AssetStrength = 'strong' | 'weak' | 'background';
export type AssetStatus = 'active' | 'deprecated' | 'archived' | 'revoked';

export interface Asset {
  id: string;
  category: AssetCategory;
  scope: AssetScope;
  strength: AssetStrength;
  status: AssetStatus;
  title: string;
  body: string;
  negativeScore: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export class AssetGovernor {
  private assets = new Map<string, Asset>();

  constructor(private persistPath?: string) {
    if (persistPath) {
      try {
        const j = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
        for (const a of j.assets || []) this.assets.set(a.id, a);
      } catch {
        /* fresh */
      }
    }
  }

  private save() {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify({ assets: [...this.assets.values()] }, null, 2));
  }

  register(a: Omit<Asset, 'createdAt' | 'updatedAt' | 'negativeScore' | 'status'> & Partial<Asset>): Asset {
    const full: Asset = {
      status: 'active',
      negativeScore: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...a,
    } as Asset;
    this.assets.set(full.id, full);
    this.save();
    return full;
  }

  /** 权限过滤先于相关性检索：严格模式不注入持久资产 */
  retrieve(opts: { category?: AssetCategory; scope?: AssetScope; strict?: boolean }): Asset[] {
    if (opts.strict) return [];
    return [...this.assets.values()].filter(
      (a) =>
        a.status === 'active' &&
        (!opts.category || a.category === opts.category) &&
        (!opts.scope || a.scope === opts.scope)
    );
  }

  /** 误召回降权 */
  negativeFeedback(id: string, delta = 1): void {
    const a = this.assets.get(id);
    if (!a) return;
    a.negativeScore += delta;
    a.updatedAt = Date.now();
    // 强资产负反馈过高 → 弱
    if (a.strength === 'strong' && a.negativeScore >= 5) a.strength = 'weak';
    if (a.negativeScore >= 15) a.status = 'deprecated';
    this.save();
  }

  lifecycleSweep(maxIdleMs = 30 * 24 * 3600_000): number {
    const now = Date.now();
    let n = 0;
    for (const a of this.assets.values()) {
      if (a.status === 'active' && a.lastUsedAt && now - a.lastUsedAt > maxIdleMs) {
        a.status = 'archived';
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  list(): Asset[] {
    return [...this.assets.values()];
  }
}
