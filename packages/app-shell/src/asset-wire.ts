/**
 * P7 资产治理：严格模式不注入持久资产；负反馈降权；生命周期扫描
 */
import { ZichanGuanliqi, type ZiChan } from '@warmy/asset-governance';

let gov: ZichanGuanliqi | null = null;

export function chuShiZiChanGuanLi(persistPath?: string): ZichanGuanliqi {
  gov = new ZichanGuanliqi(persistPath);
  return gov;
}

export function quZiChanGuanLi(): ZichanGuanliqi {
  if (!gov) gov = new ZichanGuanliqi();
  return gov;
}

/**
 * 检索前先过权限过滤（不变量 9）
 * strict：返回空，不注入任何持久资产
 */
export function retrieveAssetsForChat(opts: {
  scope?: 'session' | 'project' | 'user' | 'global';
  category?: ZiChan['category'];
  strict?: boolean;
}): ZiChan[] {
  return quZiChanGuanLi().retrieve({
    scope: opts.scope,
    category: opts.category,
    strict: opts.strict,
  });
}

export function jiLuZiChanShiYong(id: string, good: boolean): void {
  if (good) return;
  quZiChanGuanLi().negativeFeedback(id, 1);
}

export function qingLiZiChan(): number {
  return quZiChanGuanLi().lifecycleSweep();
}

/** 从对话/文件自动登记资产 */
export function zhuCeLiaoTianZiChan(opts: {
  id: string;
  biaoTi: string;
  ti: string;
  scope?: ZiChan['scope'];
}): ZiChan {
  return quZiChanGuanLi().register({
    id: opts.id,
    category: 'memory',
    scope: opts.scope || 'session',
    strength: 'weak',
    biaoTi: opts.biaoTi,
    ti: opts.ti,
  });
}
