/** R232：菜单在真实显示器工作区内排布，优先不覆盖本体；与 Electron 解耦便于穷举边界。 */
export interface JuXing { x: number; y: number; width: number; height: number }
export function caiDanWeiZhi(ti: JuXing, qu: JuXing, kuan = 264, gao = 344): JuXing {
  if (![ti.x, ti.y, ti.width, ti.height, qu.x, qu.y, qu.width, qu.height, kuan, gao].every(Number.isFinite)
    || qu.width < 1 || qu.height < 1 || ti.width < 0 || ti.height < 0) throw new Error('invalid-menu-bounds');
  const width = Math.min(Math.max(1, Math.ceil(kuan)), qu.width);
  const height = Math.min(Math.max(1, Math.ceil(gao)), qu.height);
  const qian = (x: number, y: number): JuXing => ({
    x: Math.round(Math.max(qu.x, Math.min(x, qu.x + qu.width - width))),
    y: Math.round(Math.max(qu.y, Math.min(y, qu.y + qu.height - height))), width, height,
  });
  const houXuan = [qian(ti.x + ti.width + 12, ti.y), qian(ti.x - width - 12, ti.y),
    qian(ti.x, ti.y - height - 12), qian(ti.x, ti.y + ti.height + 12)];
  const zheDang = (r: JuXing) => Math.max(0, Math.min(r.x + width, ti.x + ti.width) - Math.max(r.x, ti.x))
    * Math.max(0, Math.min(r.y + height, ti.y + ti.height) - Math.max(r.y, ti.y));
  return houXuan.reduce((a, b) => zheDang(b) < zheDang(a) ? b : a);
}
