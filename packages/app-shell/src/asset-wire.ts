/**
 * P7 资产治理：严格模式不注入持久资产；负反馈降权；生命周期扫描
 */
import { AssetGovernor, type Asset } from '@ccarmy/asset-governance';

let gov: AssetGovernor | null = null;

export function initAssetGovernor(persistPath?: string): AssetGovernor {
  gov = new AssetGovernor(persistPath);
  return gov;
}

export function getAssetGovernor(): AssetGovernor {
  if (!gov) gov = new AssetGovernor();
  return gov;
}

/**
 * 检索前先过权限过滤（不变量 9）
 * strict：返回空，不注入任何持久资产
 */
export function retrieveAssetsForChat(opts: {
  scope?: 'session' | 'project' | 'user' | 'global';
  category?: Asset['category'];
  strict?: boolean;
}): Asset[] {
  return getAssetGovernor().retrieve({
    scope: opts.scope,
    category: opts.category,
    strict: opts.strict,
  });
}

export function recordAssetUsage(id: string, good: boolean): void {
  if (good) return;
  getAssetGovernor().negativeFeedback(id, 1);
}

export function sweepAssets(): number {
  return getAssetGovernor().lifecycleSweep();
}

/** 从对话/文件自动登记资产 */
export function registerChatAsset(opts: {
  id: string;
  title: string;
  body: string;
  scope?: Asset['scope'];
}): Asset {
  return getAssetGovernor().register({
    id: opts.id,
    category: 'memory',
    scope: opts.scope || 'session',
    strength: 'weak',
    title: opts.title,
    body: opts.body,
  });
}
