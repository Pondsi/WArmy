/** 文件内容变更轮次台账：稳定 turn ID + 每路径最后成功变更，供产物卡标记“最近一次改动”。 */
export interface WenJianBianGeng {
  path: string;
  turnId: string;
  op: 'create' | 'edit' | 'delete' | 'move';
  ts: number;
  exists: boolean;
  generation: number;
  /** 同一对话轮内的真实操作顺序；用户示例 C 创建后修改 A 时展示 C/A。 */
  order: number;
}
export interface WenJianBianGengZhangBen {
  latestTurnId: string;
  turns: string[];
  files: Record<string, WenJianBianGeng>;
}
export type WenJianBianGengZhang = Record<string, WenJianBianGengZhangBen>;
export const BIAN_GENG_ZHANG_SHANG = 4000;
export function kongWenJianBianGengZhangBen(): WenJianBianGengZhangBen {
  return { latestTurnId: '', turns: [], files: {} };
}
export function guiFanWenJianBianGengZhang(raw: unknown): WenJianBianGengZhang {
  if (!raw || typeof raw !== 'object') return {};
  const out: WenJianBianGengZhang = {};
  for (const [sid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<WenJianBianGengZhangBen>;
    const files: Record<string, WenJianBianGeng> = {};
    for (const [p, f] of Object.entries(v.files || {})) {
      if (!f || typeof f !== 'object' || !f.turnId || !Number.isFinite(Number(f.ts))) continue;
      files[p] = { path: p, turnId: String(f.turnId), op: ['create', 'edit', 'delete', 'move'].includes(String(f.op)) ? f.op as WenJianBianGeng['op'] : 'edit', ts: Number(f.ts), exists: f.exists !== false, generation: Math.max(1, Number(f.generation) || 1), order: Math.max(0, Number(f.order) || 0) };
    }
    out[sid] = { latestTurnId: String(v.latestTurnId || ''), turns: Array.isArray(v.turns) ? v.turns.map(String).filter(Boolean).slice(-100) : [], files };
  }
  return out;
}
export function kaiXinBianGengLun(zhang: WenJianBianGengZhang, sid: string, turnId: string): WenJianBianGengZhang {
  const cur = zhang[sid] || kongWenJianBianGengZhangBen();
  return { ...zhang, [sid]: { ...cur, latestTurnId: turnId, turns: [...cur.turns.filter((x) => x !== turnId), turnId].slice(-100) } };
}
export function jiLuWenJianBianGeng(zhang: WenJianBianGengZhang, sid: string, turnId: string, path: string, op: WenJianBianGeng['op'], ts: number, exists: boolean): WenJianBianGengZhang {
  if (!sid || !turnId || !path) return zhang;
  const cur = zhang[sid] || kongWenJianBianGengZhangBen();
  const old = cur.files[path];
  const order = Math.max(0, ...Object.values(cur.files).filter((f) => f.turnId === turnId).map((f) => f.order)) + 1;
  const files = { ...cur.files, [path]: { path, turnId, op, ts, exists, generation: (old?.generation || 0) + 1, order } };
  const keys = Object.keys(files);
  if (keys.length > BIAN_GENG_ZHANG_SHANG) for (const p of keys.sort((a, b) => files[a]!.ts - files[b]!.ts).slice(0, keys.length - BIAN_GENG_ZHANG_SHANG)) delete files[p];
  return { ...zhang, [sid]: { ...cur, latestTurnId: turnId, turns: [...cur.turns.filter((x) => x !== turnId), turnId].slice(-100), files } };
}
export function zuiJinBianGengLun(zhang: WenJianBianGengZhang, sid: string): { turnId: string; paths: string[] } {
  const cur = zhang[sid];
  if (!cur) return { turnId: '', paths: [] };
  const turnId = [...cur.turns].reverse().find((id) => Object.values(cur.files).some((f) => f.turnId === id)) || '';
  return { turnId, paths: turnId ? Object.values(cur.files).filter((f) => f.turnId === turnId).sort((a, b) => a.order - b.order || a.ts - b.ts).map((f) => f.path) : [] };
}
