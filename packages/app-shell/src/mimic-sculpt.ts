/** R232：提示词绘制的可编辑 SVG 场景。模型只返回数据，不运行模型生成的 JavaScript/SVG 脚本。 */
import { createHash } from 'node:crypto';
import { yanGeJsonParse } from './harness-experiment.js';
export interface WarpDian { x: number; y: number; dx: number; dy: number; radius: number }
export interface HuiTuBuWei {
  id: string; name: string; points: [number, number][]; fill: string;
  stroke?: string; strokeWidth?: number; opacity?: number; warp?: WarpDian[];
}
export interface HuiTuChangJing { version: 1; parts: HuiTuBuWei[] }
function duiXiang(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function shu(x: unknown, min: number, max: number): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max; }
const se = (x: unknown) => typeof x === 'string' && /^(#[a-f\d]{6}|none)$/i.test(x);
function jian(x: Record<string, unknown>, keys: string[]): boolean { return Object.keys(x).every((k) => keys.includes(k)); }
export function jiaoYanHuiTu(raw: unknown): HuiTuChangJing {
  if (!duiXiang(raw) || !jian(raw, ['version', 'parts']) || raw.version !== 1 || !Array.isArray(raw.parts) || raw.parts.length > 96) throw new Error('scene-schema');
  const ids = new Set<string>();
  for (const p of raw.parts) {
    if (!duiXiang(p) || !jian(p, ['id', 'name', 'points', 'fill', 'stroke', 'strokeWidth', 'opacity', 'warp'])
      || typeof p.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(p.id) || ids.has(p.id)
      || typeof p.name !== 'string' || p.name.length > 80 || !se(p.fill)
      || !Array.isArray(p.points) || p.points.length < 3 || p.points.length > 128
      || !p.points.every((v: unknown) => Array.isArray(v) && v.length === 2 && shu(v[0], -440, 660) && shu(v[1], -440, 660))
      || (p.stroke !== undefined && !se(p.stroke)) || (p.strokeWidth !== undefined && !shu(p.strokeWidth, 0, 12))
      || (p.opacity !== undefined && !shu(p.opacity, 0, 1))) throw new Error('part-schema');
    if (p.warp !== undefined && (!Array.isArray(p.warp) || p.warp.length > 8 || !p.warp.every((w: unknown) => duiXiang(w)
      && jian(w, ['x', 'y', 'dx', 'dy', 'radius']) && shu(w.x, -440, 660) && shu(w.y, -440, 660)
      && shu(w.dx, -220, 220) && shu(w.dy, -220, 220) && shu(w.radius, 1, 440)))) throw new Error('warp-schema');
    ids.add(p.id);
  }
  return JSON.parse(JSON.stringify(raw)) as HuiTuChangJing;
}
export function huiTuHash(scene: HuiTuChangJing): string { return createHash('sha256').update(JSON.stringify(jiaoYanHuiTu(scene))).digest('hex'); }
export function jieXiHuiTu(text: string): HuiTuChangJing {
  if (text.length > 180000) throw new Error('scene-too-large');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return jiaoYanHuiTu(yanGeJsonParse(clean));
}
export function juBuHeBing(base: HuiTuChangJing, next: HuiTuChangJing, selection: string[]): HuiTuChangJing {
  const a = jiaoYanHuiTu(base), b = jiaoYanHuiTu(next);
  if (!selection.length) return b;
  const selected = new Set(selection);
  if ([...selected].some((id) => !a.parts.some((p) => p.id === id))) throw new Error('selection-missing');
  if (b.parts.some((p) => !selected.has(p.id))) throw new Error('selection-outside');
  // 只替换选中部位；未返回的选中部位删除，其它部位、层级与字节内容不变。
  const parts = a.parts.flatMap((p) => selected.has(p.id) ? b.parts.filter((n) => n.id === p.id) : [p]);
  return jiaoYanHuiTu({ version: 1, parts });
}
export function huiTuSvg(scene: HuiTuChangJing): string {
  const s = jiaoYanHuiTu(scene);
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || ''));
  const body = s.parts.map((p) => {
    const points = p.points.map(([x, y]) => {
      let dx = 0, dy = 0;
      for (const w of p.warp || []) {
        const weight = Math.exp(-((x - w.x) ** 2 + (y - w.y) ** 2) / (2 * w.radius ** 2));
        dx += w.dx * weight; dy += w.dy * weight;
      }
      return `${(x + dx).toFixed(3)},${(y + dy).toFixed(3)}`;
    }).join(' ');
    return `<g data-part="${p.id}"><title>${esc(p.name)}</title><polygon points="${points}" fill="${p.fill}" stroke="${p.stroke || 'none'}" stroke-width="${p.strokeWidth || 0}" opacity="${p.opacity ?? 1}" stroke-linejoin="round"/></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">${body}</svg>`;
}
export const HUI_TU_TI_SHI = `你是程序内二维角色设计器。根据用户描述新建或修改完整角色，不是从固定部件库挑选。
仅返回JSON对象 {"version":1,"parts":[...]}，禁止JavaScript、原始SVG、网址和文件路径。
每个部位为 {"id":"stable_id","name":"部位名","points":[[x,y],...],"fill":"#RRGGBB"}。
画布220x220，图形靠点列表闭合构成；用多层多边形表达曲线与细节。每部位3至128点，最多96部位。
可选 stroke（#RRGGBB 或 none）、strokeWidth（0至12）、opacity（0至1）。
局部形变可选 warp:[{"x":中心x,"y":中心y,"dx":横向位移,"dy":纵向位移,"radius":半径}]，至多8个控制点。
保持部位id稳定。用户有选区时，只返回那些选中id的部位；未返回的选中部位删除；不得动其它部位。
无选区则返回修改后的完整场景。不要包含Markdown解释或其它字段。`;
