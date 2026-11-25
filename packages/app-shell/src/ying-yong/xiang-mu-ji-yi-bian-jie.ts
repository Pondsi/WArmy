/**
 * R301：项目记忆唯一授权边界。
 * 范围由宿主从真实会话/成员/角色/项目确定；模型传入的 projectId/URI/bank 名称不得改变权限。
 * 稳定 projectId 为主，目录/仓库地址仅作绑定信息；类型未知或解析失败时收窄，不全局回退。
 */
import type { QunCang } from '../group-store.js';

export interface ShouQuanFanWei {
  projectId: string;
  sessionId: string;
  /** 允许读取的逻辑层令牌（session:<id> / project:<id> / global）。 */
  du: Set<string>;
  /** 允许写入的逻辑层令牌。 */
  xie: Set<string>;
  /** 旧数据无法确定来源时为 true：保持原有明确共享声明/legacy 标记，不猜归属。 */
  legacy: boolean;
}

export const CENG_SESSION = (id: string) => 'session:' + id;
export const CENG_PROJECT = (id: string) => 'project:' + id;
export const CENG_GLOBAL = 'global';

/** 宿主确定范围。settings 仅沿用既有 kbDuiWaiKaiFang/kbPerms 等规定，不新增用户选择。 */
export function zhuJiShouQuanFanWei(o: {
  groupStore: QunCang | null;
  sessionId: string;
  instanceId?: string;
  settings?: { kbDuiWaiKaiFang?: boolean } | null;
}): ShouQuanFanWei {
  const sid = String(o.sessionId || '');
  const gs = o.groupStore;
  const g = gs?.getGroup?.(sid);
  const projectId = gs?.projectIdOf?.(sid) || sid;
  const du = new Set<string>([CENG_SESSION(sid)]);
  const xie = new Set<string>([CENG_SESSION(sid)]);
  let legacy = false;
  if (g && g.type === 'internal') {
    du.add(CENG_PROJECT(projectId));
    /* 角色范围：创建者/管理员可写项目层；普通成员只读项目层（沿用宿主角色事实）。 */
    const members = (gs as unknown as { snapshot?: () => { members?: Record<string, Array<{ instanceId?: string; role?: string }>> } })?.snapshot?.()?.members?.[sid] || [];
    const me = members.find((m) => String(m.instanceId || '') === String(o.instanceId || ''));
    const role = String(me?.role || '');
    if (!o.instanceId || role === 'owner' || role === 'admin' || role === 'creator') xie.add(CENG_PROJECT(projectId));
  } else if (!g) {
    legacy = true;
  }
  if (o.settings?.kbDuiWaiKaiFang === true) du.add(CENG_GLOBAL);
  return { projectId, sessionId: sid, du, xie, legacy };
}

/** 模型侧参数不得指定范围：剥掉 projectId/uri/bank/scope 等控制键，只留业务查询字段。 */
export function qingChuModelFanWei<T extends Record<string, unknown>>(args: T): Omit<T, 'projectId' | 'uri' | 'bank' | 'bankId' | 'scope' | 'vikingUri'> {
  const out = { ...args } as Record<string, unknown>;
  for (const k of ['projectId', 'uri', 'bank', 'bankId', 'scope', 'vikingUri']) delete out[k];
  return out as Omit<T, 'projectId' | 'uri' | 'bank' | 'bankId' | 'scope' | 'vikingUri'>;
}

export function yunXuDu(fw: ShouQuanFanWei, ceng: string): boolean {
  return fw.du.has(ceng);
}
export function yunXuXie(fw: ShouQuanFanWei, ceng: string): boolean {
  return fw.xie.has(ceng);
}

/** 召回/知识结果按宿主范围过滤；未知层一律收窄丢弃。 */
export function guoLuJieGuo<T>(items: readonly T[], fw: ShouQuanFanWei, cengOf: (item: T) => string): T[] {
  return items.filter((x) => fw.du.has(cengOf(x)));
}