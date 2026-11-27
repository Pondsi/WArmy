/** R310②：全窗口背景图。内置 5 张＋本地最近 5 张（复制到背景文件夹，LRU 淘汰最早）。
 *  主进程统一把背景层 insertCSS 到**每一个** BrowserWindow（主界面/聊天新窗/nm 查看器/其它独立窗），
 *  设置变更即时全窗生效；渲染层只负责设置页 UI 与 IPC。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dialog, nativeImage, type BrowserWindow } from 'electron';

export type BeiJingTuMoShi = 'cover' | 'tile' | 'stretch' | 'contain';
export interface BeiJingTuPeiZhi { src: string; opacity: number; mode: BeiJingTuMoShi; tileSize: number }
export interface BeiJingTuJiLu { name: string; ming: string; ts: number }

export const BJT_MO_REN: BeiJingTuPeiZhi = { src: '', opacity: 100, mode: 'cover', tileSize: 160 };
const MO_SHI: BeiJingTuMoShi[] = ['cover', 'tile', 'stretch', 'contain'];
const ZUI_DA_BEN_DI = 5;
const ZUI_DA_ZI_JIE = 12 * 1024 * 1024;

export interface BeiJingTuYiLai {
  userData: string;
  /** 内置图目录（dist/renderer/assets/bg） */
  neiZhiMuLu: string;
  duSheZhi: () => Record<string, unknown>;
  xieSheZhi: (p: Record<string, unknown>) => void;
  suoYouChuangKou: () => BrowserWindow[];
  guangBo: (channel: string, data: unknown) => void;
}

export function chuangJianBeiJingTu(yiLai: BeiJingTuYiLai) {
  const muLu = path.join(yiLai.userData, 'backgrounds');

  const clampN = (v: number, a: number, b: number, mo: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(a, Math.min(b, Math.round(n))) : mo;
  };
  function peiOf(): BeiJingTuPeiZhi {
    const s = yiLai.duSheZhi() as { beiJingTu?: Partial<BeiJingTuPeiZhi> };
    const p = s?.beiJingTu || {};
    return {
      src: String(p.src || ''),
      opacity: clampN(p.opacity ?? 100, 0, 100, 100),
      mode: MO_SHI.includes(p.mode as BeiJingTuMoShi) ? (p.mode as BeiJingTuMoShi) : 'cover',
      tileSize: clampN(p.tileSize ?? 160, 40, 480, 160),
    };
  }
  function jiLuOf(): BeiJingTuJiLu[] {
    const s = yiLai.duSheZhi() as { beiJingTuRecents?: BeiJingTuJiLu[] };
    return Array.isArray(s?.beiJingTuRecents) ? s.beiJingTuRecents.filter((x) => x && /^[A-Za-z0-9._-]+$/.test(String(x.name || ''))) : [];
  }
  function wenJianLu(src: string): string {
    if (/^builtin:[1-5]$/.test(src)) return path.join(yiLai.neiZhiMuLu, 'bg-' + src.slice(8) + '.png');
    if (src.startsWith('local:')) {
      const name = src.slice(6);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return '';
      return path.join(muLu, name);
    }
    return '';
  }
  /** 读图→限宽→JPEG dataUrl（缩略图/背景层共用；SVG 不支持故内置图为 PNG）。 */
  function tuPian(src: string, kuan: number): string {
    const lu = wenJianLu(src);
    if (!lu || !fs.existsSync(lu)) return '';
    try {
      let img = nativeImage.createFromPath(lu);
      if (img.isEmpty()) return '';
      if (img.getSize().width > kuan) img = img.resize({ width: kuan });
      return 'data:image/jpeg;base64,' + img.toJPEG(kuan > 400 ? 82 : 70).toString('base64');
    } catch { return ''; }
  }

  function cssFor(url: string, cfg: BeiJingTuPeiZhi, kind: 'main' | 'nm' | 'other'): string {
    const size = cfg.mode === 'cover' ? 'background-size:cover;background-repeat:no-repeat;'
      : cfg.mode === 'contain' ? 'background-size:contain;background-repeat:no-repeat;'
      : cfg.mode === 'stretch' ? 'background-size:100% 100%;background-repeat:no-repeat;'
      : `background-size:${cfg.tileSize}px auto;background-repeat:repeat;`;
    let css = `body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:url("${url}");background-position:center center;opacity:${(cfg.opacity / 100).toFixed(2)};${size}}`;
    if (kind === 'main') {
      /* 三栏半透明让背景透出来；卡片/气泡保持原底色保证可读性 */
      css += '#ceLan{background:color-mix(in srgb,var(--rail-bg) 88%,transparent)!important}'
        + '#lieBiaoLan{background:color-mix(in srgb,var(--list-bg) 88%,transparent)!important}'
        + '#liaoTianLan{background:color-mix(in srgb,var(--bg) 84%,transparent)!important}'
        + '#biaoTiLan{background:color-mix(in srgb,var(--bg) 90%,transparent)!important}'
        + '#pageBuJu{background:transparent!important}';
    } else if (kind === 'nm') {
      css += 'body{background:transparent!important}#biaoTiLan{background:color-mix(in srgb,var(--bg) 90%,transparent)!important}';
    } else {
      css += 'body{background:transparent!important}';
    }
    return css;
  }

  const chaCao = new Map<BrowserWindow, string>();
  function yingYong(win: BrowserWindow): void {
    try {
      if (!win || win.isDestroyed()) return;
      const cfg = peiOf();
      const url = cfg.src ? tuPian(cfg.src, 1920) : '';
      const old = chaCao.get(win);
      if (old) { chaCao.delete(win); try { void win.webContents.removeInsertedCSS(old).catch(() => {}); } catch { /* noop */ } }
      if (!url) return;
      const u = win.webContents.getURL();
      const kind = /nm-viewer\.html/.test(u) ? 'nm' : /index\.html/.test(u) ? 'main' : 'other';
      void win.webContents.insertCSS(cssFor(url, cfg, kind)).then((k) => { if (!win.isDestroyed()) chaCao.set(win, k); }).catch(() => {});
    } catch { /* 背景失败不影响窗口 */ }
  }
  function yingYongQuanBu(): void { for (const w of yiLai.suoYouChuangKou()) yingYong(w); }
  /** 任何新建窗口（含 nm/独立会话/其它）每次加载完都挂背景层。
   *  注意：browser-window-created 时窗口可能尚未开始加载（isLoading=false 且 URL 空），
   *  立即 insertCSS 会打在将被替换的初始帧上 → 必须等 did-finish-load。 */
  function guaChuangKou(win: BrowserWindow): void {
    try {
      const f = () => yingYong(win);
      win.webContents.on('did-finish-load', f);
      if (!win.webContents.isLoading() && win.webContents.getURL()) f();
      win.on('closed', () => { chaCao.delete(win); });
    } catch { /* noop */ }
  }

  function suoLue() {
    return {
      ok: true as const,
      cfg: peiOf(),
      builtins: [1, 2, 3, 4, 5].map((i) => ({ id: 'builtin:' + i, thumb: tuPian('builtin:' + i, 240) })),
      recents: jiLuOf().map((r) => ({ id: 'local:' + r.name, ming: r.ming, thumb: tuPian('local:' + r.name, 240) })),
    };
  }
  function cun(cfg: BeiJingTuPeiZhi, recents?: BeiJingTuJiLu[]): void {
    yiLai.xieSheZhi(recents ? { beiJingTu: cfg, beiJingTuRecents: recents } : { beiJingTu: cfg });
    yingYongQuanBu();
    try { yiLai.guangBo('warmy:beiJingTuBian', { cfg }); } catch { /* noop */ }
  }
  function she(p: Partial<BeiJingTuPeiZhi>): { ok: boolean; cfg?: BeiJingTuPeiZhi; error?: string } {
    const cur = peiOf();
    /* 只覆盖真正传了的字段（显式 undefined 不算传，避免抹掉现有 src） */
    if (p.mode !== undefined && !MO_SHI.includes(p.mode)) return { ok: false, error: 'bad-mode' };
    const next: BeiJingTuPeiZhi = {
      src: p.src !== undefined ? String(p.src || '') : cur.src,
      opacity: clampN(p.opacity ?? cur.opacity, 0, 100, cur.opacity),
      mode: p.mode !== undefined ? p.mode : cur.mode,
      tileSize: clampN(p.tileSize ?? cur.tileSize, 40, 480, cur.tileSize),
    };
    if (next.src && !wenJianLu(next.src)) return { ok: false, error: 'bad-src' };
    if (next.src.startsWith('local:') && !jiLuOf().some((r) => 'local:' + r.name === next.src)) return { ok: false, error: 'not-in-recents' };
    if (next.src && !fs.existsSync(wenJianLu(next.src))) return { ok: false, error: 'missing-file' };
    cun(next);
    return { ok: true, cfg: next };
  }
  /** 选本地图：复制到 backgrounds/（内容哈希命名去重），LRU 保留最近 5 张，第 6 张淘汰最早文件。 */
  async function xuanBenDi(): Promise<{ ok: boolean; cancelled?: boolean; error?: string; cfg?: BeiJingTuPeiZhi }> {
    try {
      const r = await dialog.showOpenDialog({
        title: '选择背景图片',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, cancelled: true };
      return jiaBenDi(r.filePaths[0]!);
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }
  /** 复制＋LRU 的核心逻辑（选择弹窗与测试通道共用）。 */
  function jiaBenDi(lu: string): { ok: boolean; error?: string; cfg?: BeiJingTuPeiZhi } {
    try {
      const buf = fs.readFileSync(lu);
      if (!buf.length || buf.length > ZUI_DA_ZI_JIE) return { ok: false, error: 'file-too-large' };
      const ext = (path.extname(lu).toLowerCase() || '.png').replace(/[^.a-z0-9]/g, '') || '.png';
      const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
      fs.mkdirSync(muLu, { recursive: true });
      const muBiao = path.join(muLu, name);
      if (!fs.existsSync(muBiao)) fs.writeFileSync(muBiao, buf);
      let recents = jiLuOf().filter((x) => x.name !== name);
      recents.unshift({ name, ming: path.basename(lu), ts: Date.now() });
      while (recents.length > ZUI_DA_BEN_DI) {
        const tao = recents.pop()!;
        try { fs.rmSync(path.join(muLu, tao.name), { force: true }); } catch { /* 删不掉也不挡 */ }
      }
      const cfg = { ...peiOf(), src: 'local:' + name };
      cun(cfg, recents);
      return { ok: true, cfg };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  return { du: suoLue, she, xuanBenDi, jiaBenDi, guaChuangKou, yingYongQuanBu };
}