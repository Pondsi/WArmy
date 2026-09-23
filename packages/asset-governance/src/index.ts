/**
 * @warmy/asset-governance — 六分类 × 四层作用域 × 强/弱/背景 × 生命周期
 */
import fs from 'node:fs';
import path from 'node:path';

export type ZichanLeibie = 'skill' | 'rule' | 'memory' | 'prompt' | 'tool' | 'file';
export type ZichanZuoyongyu = 'session' | 'project' | 'user' | 'global';
export type ZichanQiangdu = 'strong' | 'weak' | 'background';
export type ZichanZhuangtai = 'jiHuo' | 'deprecated' | 'archived' | 'revoked';

export interface ZiChan {
  id: string;
  category: ZichanLeibie;
  scope: ZichanZuoyongyu;
  strength: ZichanQiangdu;
  status: ZichanZhuangtai;
  biaoTi: string;
  ti: string;
  negativeScore: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export class ZichanGuanliqi {
  private assets = new Map<string, ZiChan>();

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

  register(a: Omit<ZiChan, 'createdAt' | 'updatedAt' | 'negativeScore' | 'status'> & Partial<ZiChan>): ZiChan {
    const Quan: ZiChan = {
      status: 'jiHuo',
      negativeScore: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...a,
    } as ZiChan;
    this.assets.set(Quan.id, Quan);
    this.save();
    return Quan;
  }

  /** 权限过滤先于相关性检索：严格模式不注入持久资产 */
  retrieve(opts: { category?: ZichanLeibie; scope?: ZichanZuoyongyu; strict?: boolean }): ZiChan[] {
    if (opts.strict) return [];
    return [...this.assets.values()].filter(
      (a) =>
        a.status === 'jiHuo' &&
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
      if (a.status === 'jiHuo' && a.lastUsedAt && now - a.lastUsedAt > maxIdleMs) {
        a.status = 'archived';
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  LieBiao(): ZiChan[] {
    return [...this.assets.values()];
  }
}
