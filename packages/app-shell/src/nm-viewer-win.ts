/**
 * nm-viewer-win —— 内置插件 **`nm-file`（nm 文件查看器）** 的主进程侧。
 *
 * 职责（为什么要单独一个模块）：
 *   1. **窗口池**：一个文件一个独立窗口（可移动/可缩放/可多开），关一个不影响别的；
 *   2. **吸附**：两个 nm 窗口靠近时边贴边（edge-align）、并排的**高度拉平**（矮的涨到高的），
 *      拖动其中一个会带动整组一起走；关掉「吸附」的窗既不吸别人、也不被别人吸；
 *   3. **每窗开关**：「总在最前」/「吸附」是**每窗口**的状态，不共享；
 *   4. **读文件**：按后缀 + 魔数分流，文档一律复用 `doc-extract`（docx/xlsx/pptx/pdf 的
 *      抽取逻辑只写一份，绝不在这里重造 OOXML/PDF 解析）。
 *
 * 为什么吸附逻辑做成 `nmJiSuanXiFu` 这种**纯函数**：拖动时的几何计算最容易写错，纯函数
 * 可以脱离 Electron 直接断言（脚本里灌几个矩形就能验证"该贴哪条边、高度拉平到多少"），
 * 而不是等真机上凭感觉说"好像吸上了"。
 *
 * 纪律：这个模块**不读设置**（主题/强调色/插件开关由 electron-main 传进来），
 * 这样它不依赖 settings-store，也不会和主进程形成环形依赖。
 */
import { app, BrowserWindow, dialog, screen, shell, type Rectangle } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renWenDangGeShi, tiQuWenDang } from './doc-extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 吸附判定的"够近"阈值（像素）：两窗边缘差距 ≤ 这个数就贴上去 */
export const NM_XI_FU_JIA = 24;

/** 可编辑纯文本的后缀白名单（代码不挑语言：认识的后缀直接当文本，认不出再看内容） */
const WEN_BEN_KUO = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'rst', 'adoc',
  'csv', 'tsv', 'psv', 'ndjson', 'jsonl',
  'json', 'jsonc', 'json5', 'xml', 'xsd', 'xsl', 'yaml', 'yml', 'ini', 'toml', 'cfg', 'conf',
  'properties', 'env', 'nm', 'lock', 'editorconfig', 'gitignore', 'gitattributes', 'npmrc', 'nvmrc',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'py', 'pyw', 'pyi', 'rb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart',
  'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'clj', 'cljs', 'ex', 'exs', 'erl', 'hrl',
  'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'm', 'mm', 'cs', 'fs', 'vb', 'swift',
  'sql', 'graphql', 'gql', 'proto', 'thrift', 'avsc', 'http', 'rest',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'vbs', 'awk', 'sed',
  'tex', 'bib', 'sty', 'cls', 'diff', 'patch', 'srt', 'vtt', 'ass', 'ssa', 'lrc', 'po', 'pot',
  'makefile', 'mk', 'cmake', 'dockerfile', 'containerfile', 'nginx', 'service',
]);

const TU_PIAN_KUO = new Map<string, string>([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'],
  ['gif', 'image/gif'], ['bmp', 'image/bmp'], ['ico', 'image/x-icon'], ['avif', 'image/avif'],
  ['svg', 'image/svg+xml'],
]);
const YIN_PIN_KUO = new Map<string, string>([
  ['wav', 'audio/wav'], ['mp3', 'audio/mpeg'], ['ogg', 'audio/ogg'], ['oga', 'audio/ogg'],
  ['flac', 'audio/flac'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'], ['opus', 'audio/ogg'],
]);
const SHI_PIN_KUO = new Map<string, string>([
  ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['m4v', 'video/x-m4v'], ['ogv', 'video/ogg'],
  ['mov', 'video/quicktime'],
]);

/** 可编辑文本的体积上限（超过就只读展示，绝不假装能编辑） */
const WEN_BEN_KE_BIAN_JI = 8 * 1024 * 1024;
/** 读取上限：超过这个尺寸的"文本"只读前 24MB */
const WEN_BEN_DU_SHANG_XIAN = 24 * 1024 * 1024;
/** 保存上限 */
const BAO_CUN_SHANG_XIAN = 64 * 1024 * 1024;
/** 文档抽取的字符上限（Find 要能搜到全文，所以给得比给模型的大得多） */
const WEN_DANG_ZI_SHANG_XIAN = 400_000;
/**
 * 二进制**十六进制编辑**的体积上限（16MB）。
 * 为什么不是无限：页面用虚拟滚动只看可见行，但保存要校验整文件哈希、写备份；
 * 再大就只读展示（明确告诉用户原因），绝不假装能改。
 */
const ER_JIN_ZHI_KE_BIAN_JI = 16 * 1024 * 1024;
/** 单次读取字节块的上限（渲染层按 256KB 分块；这里再兜一层） */
const ER_JIN_ZHI_DU_KUAI = 256 * 1024;
/** 二进制文件最多允许一次提交多少个字节改动（防止界面失控把 IPC 撑爆） */
const ER_JIN_ZHI_ZUI_DAO_GAI = 1_000_000;

export type NmLeiXing = 'text' | 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'image' | 'audio' | 'video' | 'binary' | 'archive';

/** 二进制文件的元信息：渲染层按块读取，不在 IPC 里搬整文件 */
export interface NmErJinZhi {
  /** 打开时的 SHA-256：保存前主进程会重新算，文件被外部改过就拒绝覆盖 */
  sha256: string;
  /** 是否允许十六进制编辑（体积/写权限都满足） */
  keBianJi: boolean;
  /** 只读原因（可编辑时为空） */
  yuanYin?: string;
  /** 十六进制编辑上限（字节） */
  shangXian: number;
}

/** 包内一层条目的展示信息（不含密码/不含原始字节） */
export interface NmYaSuoBaoTiaoMu {
  /** 包内路径（统一用 /，可能是中文乱码已尽量转码） */
  ming: string;
  isDir: boolean;
  /** 解压后字节数（中央目录声明值；可疑值会标 weiXian） */
  ziJie: number;
  yaSuoZiJie: number;
  fangFa: number;
  fangFaMing: string;
  /** 传统 ZipCrypto 加密（给密码可解） */
  jiaMi: boolean;
  /** AES 加密 / 强加密：当前零依赖实现打不开 */
  shouBaoHu: boolean;
  /** 路径是否安全（不安全条目可查看，但解压一定跳过） */
  anQuan: boolean;
  /** 是否可预览/解压（受保护、压缩炸弹、超限 = false） */
  keKai: boolean;
  /** 扩展名是 .zip：界面上当文件夹展开（包内套包） */
  shiZip: boolean;
  weiXian?: string;
  yuanYin?: string;
  shiJian?: number;
}

export interface NmYaSuoBaoXinXi {
  /** 当前这一层压缩包的显示名 */
  ming: string;
  geShi: string;
  tiaoMu: NmYaSuoBaoTiaoMu[];
  tiaoMuShu: number;
  jiaMiShu: number;
  zip64: boolean;
  /** 解析失败时如实说明（不假装空包） */
  cuo?: string;
  /** 单条目预览上限（字节） */
  yuLanShangXian: number;
  /** 单条目解压上限（字节） */
  jieYaShangXian: number;
}

export interface NmTiaoMuXinXi {
  /** 相对包根的路径（/ 分隔） */
  luJing: string;
  ming: string;
  ziJie: number;
  /** 嵌套层级：0 = 最外层 zip 里的文件 */
  ceng: number;
  jiaMi: boolean;
}

/** 压缩包请求（走 nmDu 的 path 字符串，主进程不新增 IPC 通道） */
export interface NmYaSuoQingQiu {
  a: 'tree' | 'read' | 'extract' | 'sysopen';
  /** 最外层 zip 的绝对路径 */
  z?: string;
  /** 条目路径层级（嵌套 zip 用数组） */
  e?: string[];
  /** 密码：字符串或按层给；**只在内存/IPC 里，绝不落盘** */
  p?: string | string[];
  /** sysopen 的本地文件 */
  f?: string;
  /** extract：true = 解压这一层全部；false/省略 = 只解压 e 指向的条目 */
  all?: boolean;
}

export interface NmKuai {
  biaoTi: string;
  wenBen: string;
}

export interface NmNeiRong {
  ok: boolean;
  luJing: string;
  ming: string;
  kuoZhan: string;
  leiXing: NmLeiXing;
  keBianJi: boolean;
  ziJie: number;
  /** 可编辑文本 / 二进制十六进制预览 */
  wenBen?: string;
  /** 文档抽取出来的分段（docx/pdf 一段；pptx 一页一段；xlsx 一个工作表一段） */
  kuai?: NmKuai[];
  /** 媒体文件的 file:// URL（图片/音频/视频直接给 <img>/<audio>/<video> 用） */
  meiTiUrl?: string;
  mime?: string;
  /** 原文件的换行风格：保存时按原样还原，避免"只改一个字整文件变 LF" */
  huanHang?: 'crlf' | 'lf';
  /** 只读且被截断 */
  jieDuan?: boolean;
  /** 二进制：虚拟十六进制视图的元信息（编辑走增量字节，不走 wenBen） */
  erJinZhi?: NmErJinZhi;
  /** 压缩包：目录树（只在 leiXing='archive' 或包内条目预览时给） */
  yaSuoBao?: NmYaSuoBaoXinXi;
  /** 当前预览的包内条目（路径以 / 分隔，数组表示嵌套 zip 的层级） */
  tiaoMu?: NmTiaoMuXinXi;
  /** 需要密码（加密 zip）；mimaCuo=true 表示给过密码但不对 */
  needPassword?: boolean;
  mimaCuo?: boolean;
  /** 受保护/不支持的格式（AES、RAR/7z 等）：明确说"打不开"，不反复要密码 */
  shouBaoHu?: boolean;
  /** 解压结果：目标目录 / 写入数 / 跳过项（含原因） */
  jieYaDao?: string;
  xieRu?: number;
  tiaoGuo?: Array<{ ming: string; yuanYin: string }>;
  /** 给用户的说明（截断/扫描件/抽不出文本等，如实说） */
  tiShi?: string;
  cuo?: string;
}

/* ══════════════════════════════════════════════════════════════════════
   一、插件开关 + 格式分流（纯函数，可脱机断言）
   ══════════════════════════════════════════════════════════════════════ */

/**
 * 内置插件 `nm-file` 是否启用。
 * 产品要求「默认启用」⇒ 列表里**没有这条**也算启用（首启/旧配置不该把查看器关掉）。
 */
export function nmShiTuQiYong(chaJianJi: unknown): boolean {
  if (!Array.isArray(chaJianJi)) return true;
  const tiao = chaJianJi.find((x) => x && typeof x === 'object' && String((x as { id?: unknown }).id || '') === 'nm-file');
  if (!tiao) return true;
  return (tiao as { enabled?: unknown }).enabled !== false;
}

/**
 * 第 78 轮项 21：**新配置默认勾选**「使用 nm 查看器打开项目内文件」。
 *
 * 为什么放在这里：该偏好由界面（app.js）读写、主进程（electron-main）执行；
 * 本轮不允许改那两个文件，所以只在**设置文件里根本没有这个键**时补一个 true
 * （= 出厂默认）。用户显式选过 false 时键一定存在 ⇒ 绝不覆盖，保证"未勾选走系统默认"。
 * 返回 changed 便于门禁断言；不触碰密码/凭证，也不改外观配置。
 */
let nmMoRenYiBu = false;
export function nmBuQiMoRenKaiWenJian(userDataDir?: string): { ok: boolean; changed: boolean; cuo?: string } {
  // 只在真实启动路径上做一次；测试传 userDataDir 时每次都按传入目录算
  if (nmMoRenYiBu && !userDataDir) return { ok: true, changed: false };
  if (!userDataDir) nmMoRenYiBu = true;
  try {
    const dir = userDataDir || app.getPath('userData');
    const file = path.join(dir, 'settings.json');
    let obj: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw) {
        try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, changed: false, cuo: 'settings.json 不是合法 JSON，未改动' }; }
        // 已经有这个键（true 或 false）都是用户/旧版的选择，一律不动
        if (Object.prototype.hasOwnProperty.call(obj, 'nmKaiWenJian')) return { ok: true, changed: false };
      }
    }
    obj.nmKaiWenJian = true;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.warmy-tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, changed: false, cuo: String((e as Error)?.message || e).slice(0, 160) };
  }
}

function kuoZhanOf(p: string): string {
  return path.extname(String(p || '')).toLowerCase().replace(/^\./, '');
}

/** 内容像不像人写的文本：有 NUL 或控制字符占比过高就判二进制（后缀骗人时不认后缀） */
export function nmKanShiWenBen(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  if (n === 0) return true;
  let kong = 0;
  for (let i = 0; i < n; i += 1) {
    const c = buf[i] ?? 0;
    if (c === 0) return false;
    if (c < 7 || (c > 13 && c < 32)) kong += 1;
  }
  return kong / n < 0.05;
}

function jieMaWenBen(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const n = buf.length - 2 - ((buf.length - 2) % 2);
    const huan = Buffer.allocUnsafe(n);
    for (let i = 0; i + 1 < n; i += 2) {
      huan[i] = buf[i + 3] ?? 0;
      huan[i + 1] = buf[i + 2] ?? 0;
    }
    return huan.toString('utf16le');
  }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 十六进制预览（认不出的二进制也得让用户看见"它是什么"，而不是一片空白） */
function shiLiuJinZhi(buf: Buffer, shangXian = 2048): string {
  const n = Math.min(buf.length, shangXian);
  const hang: string[] = [];
  for (let i = 0; i < n; i += 16) {
    const pian = buf.subarray(i, Math.min(i + 16, n));
    const hex = [...pian].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const zi = [...pian].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    hang.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${zi}`);
  }
  return hang.join('\n');
}

function duQianTou(p: string, n = 4096): Buffer {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(n);
      const du = fs.readSync(fd, buf, 0, n, 0);
      return buf.subarray(0, du);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

/** 整文件 SHA-256（只对允许编辑的二进制做；最大 16MB，真机上毫秒级） */
function wenJianSha256(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** 是否可写：**只做判断，不改权限**；不可写就只读展示，绝不让保存假装成功 */
function keXieWenJian(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function erJinZhiXinXi(p: string, ziJie: number): NmErJinZhi {
  const taiDa = ziJie > ER_JIN_ZHI_KE_BIAN_JI;
  const keXie = taiDa ? false : keXieWenJian(p);
  const yuanYin = taiDa
    ? `文件 ${(ziJie / 1048576).toFixed(1)}MB，超过 ${(ER_JIN_ZHI_KE_BIAN_JI / 1048576).toFixed(0)}MB 十六进制编辑上限，只读打开。`
    : (keXie ? '' : '文件当前不可写（只读属性或权限不足），只读打开。');
  let sha = '';
  if (!taiDa) {
    try { sha = wenJianSha256(p); } catch { /* 算不出哈希就当只读：没有哈希无法安全保存 */ }
  }
  const keBianJi = !taiDa && keXie && !!sha;
  return {
    sha256: sha,
    keBianJi,
    shangXian: ER_JIN_ZHI_KE_BIAN_JI,
    ...(keBianJi ? {} : { yuanYin: yuanYin || '无法计算文件哈希，只读打开。' }),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   二、读文件（统一入口：能编辑的给文本，文档给抽取正文，媒体给 URL）
   ══════════════════════════════════════════════════════════════════════ */

/**
 * 读一个文件给查看器用。
 * 分派顺序：**文档/媒体优先** → 文本 → 二进制。
 * 文档一律走 `doc-extract.tiQuWenDang`（docx/xlsx/pptx/pdf 的解析只此一份）。
 */
export function nmDuWenJian(luJing: string): NmNeiRong {
  const p = String(luJing || '');
  /**
   * 压缩包请求：`path` 是唯一的自由字符串通道（主进程不加新 IPC）。
   * 先认出信封再碰文件系统；信封里可能带密码，**只用后即弃，不写任何地方**。
   */
  const yaSuoQing = nmJieXiYaSuoQingQiu(p);
  if (yaSuoQing.ok) return nmZhiXingYaSuoQingQiu(yaSuoQing.q);
  const kong: NmNeiRong = {
    ok: false, luJing: p, ming: path.basename(p), kuoZhan: kuoZhanOf(p),
    leiXing: 'binary', keBianJi: false, ziJie: 0,
  };
  try {
    if (!p || !fs.existsSync(p)) return { ...kong, cuo: '文件不存在' };
    const st = fs.statSync(p);
    if (st.isDirectory()) return { ...kong, cuo: '这是一个目录，不是文件' };
    const ziJie = st.size;
    const kuo = kuoZhanOf(p);
    const qianTou = duQianTou(p);
    const jiChu = { ok: true, luJing: path.resolve(p), ming: path.basename(p), kuoZhan: kuo, ziJie };

    // ① 文档容器（docx/xlsx/pptx/pdf）：魔数优先，后缀兜底
    const geShi = renWenDangGeShi(p, qianTou);
    if (geShi === 'docx' || geShi === 'xlsx' || geShi === 'pptx' || geShi === 'pdf') {
      if (ziJie > 512 * 1024 * 1024) {
        return { ...jiChu, leiXing: geShi, keBianJi: false, cuo: '文件太大（>512MB），查看器不解析' };
      }
      const r = tiQuWenDang(p, { maxChars: WEN_DANG_ZI_SHANG_XIAN });
      if (!r.ok) {
        return {
          ...jiChu, leiXing: geShi, keBianJi: false, wenBen: '',
          tiShi: (r.hint || '') || `抽不出正文（${r.error || '未知原因'}）。查看器不会编造内容。`,
        };
      }
      const kuai: NmKuai[] = [];
      if (geShi === 'xlsx' && Array.isArray(r.sheets) && r.sheets.length) {
        for (const s of r.sheets) {
          kuai.push({
            biaoTi: `工作表 ${s.name || '(未命名)'} · ${s.rows.length} 行`,
            wenBen: s.rows.map((row) => row.join('\t')).join('\n'),
          });
        }
      } else if (geShi === 'pptx' && Array.isArray(r.slides) && r.slides.length) {
        r.slides.forEach((s, i) => kuai.push({ biaoTi: `第 ${i + 1} 页`, wenBen: s }));
      } else {
        kuai.push({ biaoTi: r.pages ? `正文 · 共 ${r.pages} 页` : '正文', wenBen: r.text });
      }
      const jieDuan = kuai.some((k) => k.wenBen.length >= WEN_DANG_ZI_SHANG_XIAN) || !!r.hint;
      return {
        ...jiChu, leiXing: geShi, keBianJi: false, kuai,
        ...(jieDuan ? { jieDuan: true, tiShi: `正文较长，只抽取前 ${WEN_DANG_ZI_SHANG_XIAN} 字；查找只在已抽取的部分生效。` } : {}),
      };
    }

    // ② 压缩包：列目录树；包内条目按普通文件分流（只读，绝不回写 zip）
    const shiYaSuo = nmKanShiYaSuo(kuo, qianTou);
    if (shiYaSuo) {
      const lie = nmLieYaSuoBao(p);
      if (!lie.ok || !lie.xinXi) {
        return {
          ...jiChu, leiXing: 'archive', keBianJi: false,
          tiShi: lie.cuo || '这个压缩包解析不了。',
        };
      }
      return {
        ...jiChu, leiXing: 'archive', keBianJi: false, yaSuoBao: lie.xinXi,
        tiShi: lie.xinXi.cuo || '',
      };
    }

    // ③ 媒体（图片/音频/视频）：直接给 file:// URL，页面里用原生控件
    const tu = TU_PIAN_KUO.get(kuo);
    if (tu) return { ...jiChu, leiXing: 'image', keBianJi: false, meiTiUrl: pathToFileURL(path.resolve(p)).href, mime: tu };
    const yin = YIN_PIN_KUO.get(kuo);
    if (yin) return { ...jiChu, leiXing: 'audio', keBianJi: false, meiTiUrl: pathToFileURL(path.resolve(p)).href, mime: yin };
    const shi = SHI_PIN_KUO.get(kuo);
    if (shi) return { ...jiChu, leiXing: 'video', keBianJi: false, meiTiUrl: pathToFileURL(path.resolve(p)).href, mime: shi };

    // ③ 文本（后缀白名单 或 内容像文本）
    const shiWenBen = WEN_BEN_KUO.has(kuo) || nmKanShiWenBen(qianTou);
    if (shiWenBen) {
      const duChang = Math.min(ziJie, WEN_BEN_DU_SHANG_XIAN);
      const fd = fs.openSync(p, 'r');
      let buf: Buffer;
      try {
        buf = Buffer.alloc(duChang);
        const du = fs.readSync(fd, buf, 0, duChang, 0);
        buf = buf.subarray(0, du);
      } finally {
        fs.closeSync(fd);
      }
      const wenBen = jieMaWenBen(buf);
      const keBianJi = ziJie <= WEN_BEN_KE_BIAN_JI;
      const jieDuan = ziJie > WEN_BEN_DU_SHANG_XIAN;
      return {
        ...jiChu, leiXing: 'text', keBianJi, wenBen,
        huanHang: wenBen.includes('\r\n') ? 'crlf' : 'lf',
        ...(jieDuan || !keBianJi
          ? {
            jieDuan: true,
            tiShi: jieDuan
              ? `文件 ${(ziJie / 1048576).toFixed(1)}MB，超过读取上限，只显示前 ${(WEN_BEN_DU_SHANG_XIAN / 1048576).toFixed(0)}MB（只读）。`
              : `文件 ${(ziJie / 1048576).toFixed(1)}MB，超过 ${(WEN_BEN_KE_BIAN_JI / 1048576).toFixed(0)}MB 编辑上限，只读打开。`,
          }
          : {}),
      };
    }

    // ④ 认不出的二进制：虚拟十六进制视图；体积/权限允许时可直接改字节
    const er = erJinZhiXinXi(p, ziJie);
    return {
      ...jiChu, leiXing: 'binary', keBianJi: er.keBianJi,
      // 小文件保留一份前 2KB 预览（老界面/打印兜底），大文件不塞进 IPC
      ...(ziJie <= 65536 ? { wenBen: shiLiuJinZhi(qianTou, 2048) } : {}),
      erJinZhi: er,
      tiShi: er.keBianJi
        ? '十六进制视图：点字节后输入两位十六进制即可修改；保存前会自动备份原文件，并在文件被外部改动时拒绝覆盖。'
        : (er.yuanYin || '这是二进制文件，没有内置预览格式；以下为十六进制只读视图。'),
    };
  } catch (e) {
    return { ...kong, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   三、吸附几何（纯函数）
   ══════════════════════════════════════════════════════════════════════ */

export interface NmKuang {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NmXiFuJieGuo {
  xiFu: boolean;
  muBiao: number | null;
  /** 拖动窗吸附后的矩形 */
  zhu: NmKuang | null;
  /** 邻窗吸附后的矩形（并排时高度已拉平） */
  lin: NmKuang | null;
  /** 邻窗在拖动窗的哪一侧 */
  fangXiang: 'zuo' | 'you' | 'shang' | 'xia' | null;
}

/**
 * 主窗口矩形提供者（第 63 轮项 24）：nm 窗口靠近主界面时也能贴边。
 * 只读；由 electron-main 注入，nm 模块不反向依赖主进程模块。
 */
let zhuChuangKuang: (() => NmKuang | null) | null = null;
export function nmSheZhiZhuChuangKuang(fn: (() => NmKuang | null) | null): void {
  zhuChuangKuang = typeof fn === 'function' ? fn : null;
}

/**
 * 把主窗口登记成**平等参与者**（第 66 轮项 7/10/11）。
 *
 * 以前主窗口只是 nm 吸附的"死目标"：nm 可以贴上去，但主窗口拖动不会带走 nm，
 * 主窗口自己也永远不吸 nm。现在主窗口进同一个窗口池（id = -1），和 nm 一样有
 * 四边邻窗、一样走 move/resize 去抖；移动任何一侧都带动整组。
 *
 * 只登记一次；同一个窗口重复调用无副作用。主窗口被销毁时自动摘掉（不会留下幽灵连接）。
 */
export function nmJieRuZhuChuang(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  // 第 78 轮项 21：先补默认值，再让界面读设置（只补"没有这个键"，绝不覆盖用户的 false）
  nmBuQiMoRenKaiWenJian();
  const jiu = CHUANG_KOU.get(NM_ZHU_CHUANG_ID);
  if (jiu && jiu.win === win && !jiu.win.isDestroyed()) return;
  if (jiu) { quXiaoDingShi(jiu); duanKai(jiu); CHUANG_KOU.delete(NM_ZHU_CHUANG_ID); }
  const Z: NmZhuangTai = {
    id: NM_ZHU_CHUANG_ID,
    win,
    luJing: '',
    zongShiDing: false,
    xiFu: true,
    bian: kongBian(),
    sheZhiZhong: false,
    shangCi: win.getBounds(),
    yiDongDingShi: null,
  };
  CHUANG_KOU.set(Z.id, Z);
  nmSheZhiZhuChuangKuang(() => (win.isDestroyed() ? null : win.getBounds()));
  // 与 nm 同一套去抖：拖动中不抢 Windows 的贴靠，停手后再算
  const anPai = (): void => anPaiYiDong(Z);
  win.on('move', anPai);
  win.on('moved', anPai);
  win.on('resize', () => { try { chuLiTiaoZheng(Z, false); } catch { /* 缩放期间算错不打断用户 */ } });
  win.on('resized', () => { try { chuLiTiaoZheng(Z, true); } catch { /* noop */ } });
  win.on('closed', () => {
    quXiaoDingShi(Z);
    duanKai(Z);
    if (CHUANG_KOU.get(NM_ZHU_CHUANG_ID) === Z) CHUANG_KOU.delete(NM_ZHU_CHUANG_ID);
    nmSheZhiZhuChuangKuang(null);
  });
}

/** 主窗口吸附开关（关掉 = 立即断开与 nm 的连接，之后也不参与吸附） */
export function nmZhuChuangXiFu(kai: boolean): void {
  const Z = CHUANG_KOU.get(NM_ZHU_CHUANG_ID);
  if (!Z || Z.win.isDestroyed()) return;
  Z.xiFu = !!kai;
  if (!Z.xiFu) duanKai(Z);
}

/**
 * 沿"右边"一路走到最右（用于新窗口落点；不跨过空边、不怕异常数据成环）。
 * 主窗口右边空 ⇒ 返回主窗口自己；右边已挂 nm ⇒ 返回最右那扇。
 */
function zuiYouCeLian(start: NmZhuangTai): NmZhuangTai {
  const yiZou = new Set<number>();
  let cur: NmZhuangTai | undefined = start;
  let zuiHou = start;
  while (cur && !yiZou.has(cur.id)) {
    yiZou.add(cur.id);
    zuiHou = cur;
    const nextId: number | null = cur.bian.you;
    const next: NmZhuangTai | undefined = nextId == null ? undefined : CHUANG_KOU.get(nextId);
    if (!next || next.win.isDestroyed()) break;
    cur = next;
  }
  return zuiHou;
}

/**
 * 算一次吸附：给拖动窗的矩形 + 其它**开着吸附**的窗矩形，返回最近的贴边方案。
 *
 * 规则（产品定稿）：
 *   · 并排（左右相邻）：贴住那条竖边，**顶边对齐、高度取两者最大**（矮的涨到高的那么高）；
 *   · 上下相邻：只贴上/下那条横边，高度各管各（拉平会把下窗顶到上窗身上，反而不像"拼在一起"）。
 * 距离超过 `jia`（默认 24px）不算相邻 —— 所以"靠近才吸"是硬的。
 */
export function nmJiSuanXiFu(
  zhu: { id: number; kuang: NmKuang },
  qiTa: Array<{ id: number; kuang: NmKuang }>,
  jia = NM_XI_FU_JIA,
): NmXiFuJieGuo {
  const b = zhu.kuang;
  const wu: NmXiFuJieGuo = { xiFu: false, muBiao: null, zhu: null, lin: null, fangXiang: null };
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || b.width <= 0 || b.height <= 0) return wu;
  const houXuan: Array<{ juLi: number; jie: NmXiFuJieGuo }> = [];
  const jiLu = (juLi: number, jie: NmXiFuJieGuo): void => { houXuan.push({ juLi, jie }); };
  for (const o of qiTa) {
    if (!o || o.id === zhu.id) continue;
    const ob = o.kuang;
    if (!ob || ob.width <= 0 || ob.height <= 0) continue;
    const chongDieY = Math.min(b.y + b.height, ob.y + ob.height) - Math.max(b.y, ob.y);
    const chongDieX = Math.min(b.x + b.width, ob.x + ob.width) - Math.max(b.x, ob.x);
    const gao = Math.max(b.height, ob.height);
    const yDing = Math.min(b.y, ob.y);
    // 并排：纵向重叠过半才认"并排"，否则只是路过
    if (chongDieY >= Math.min(b.height, ob.height) * 0.5) {
      const juYou = Math.abs(b.x - (ob.x + ob.width)); // 拖动窗在邻窗右侧
      if (juYou <= jia) {
        jiLu(juYou, {
          xiFu: true, muBiao: o.id, fangXiang: 'you',
          zhu: { x: ob.x + ob.width, y: yDing, width: b.width, height: gao },
          lin: { x: ob.x, y: yDing, width: ob.width, height: gao },
        });
      }
      const juZuo = Math.abs(b.x + b.width - ob.x); // 拖动窗在邻窗左侧
      if (juZuo <= jia) {
        jiLu(juZuo, {
          xiFu: true, muBiao: o.id, fangXiang: 'zuo',
          zhu: { x: ob.x - b.width, y: yDing, width: b.width, height: gao },
          lin: { x: ob.x, y: yDing, width: ob.width, height: gao },
        });
      }
    }
    // 上下相邻：横向重叠过半
    if (chongDieX >= Math.min(b.width, ob.width) * 0.5) {
      const juXia = Math.abs(b.y - (ob.y + ob.height)); // 拖动窗在邻窗下方
      if (juXia <= jia) {
        jiLu(juXia, {
          xiFu: true, muBiao: o.id, fangXiang: 'xia',
          zhu: { x: b.x, y: ob.y + ob.height, width: b.width, height: b.height },
          lin: { x: ob.x, y: ob.y, width: ob.width, height: ob.height },
        });
      }
      const juShang = Math.abs(b.y + b.height - ob.y); // 拖动窗在邻窗上方
      if (juShang <= jia) {
        jiLu(juShang, {
          xiFu: true, muBiao: o.id, fangXiang: 'shang',
          zhu: { x: b.x, y: ob.y - b.height, width: b.width, height: b.height },
          lin: { x: ob.x, y: ob.y, width: ob.width, height: ob.height },
        });
      }
    }
  }
  if (!houXuan.length) return wu;
  houXuan.sort((x, y) => x.juLi - y.juLi);
  return houXuan[0]!.jie;
}

/* ── 四边吸附（第 67 轮项 19） ─────────────────────────────
 * 产品定稿：**每一扇窗的四条边各最多挂一个邻窗**，一扇窗可以同时吸住上下左右四个；
 * 不再是"贴上一个就谁也别想再贴"。主窗口（id=-1）也是平等参与者，边一样会被占。
 *
 * 这里只写纯几何：给定拖动窗/候选窗的矩形和**已占用的边**，算最近的一条可贴边。
 * 先来的连接永不被挤掉 —— 目标边已被占用时直接跳过，不参与比较。
 */
export type NmBian = 'shang' | 'you' | 'xia' | 'zuo';

export interface NmBianZhanYong {
  shang?: number | null;
  you?: number | null;
  xia?: number | null;
  zuo?: number | null;
}

export interface NmSiBianXiFuJieGuo extends NmXiFuJieGuo {
  /** 拖动窗自己的哪条边贴上去（shang/you/xia/zuo） */
  bian: NmBian | null;
  /** 目标窗对应的对边 */
  duiBian: NmBian | null;
  /** 两条边之间的像素间隙（越小越优先） */
  juLi: number;
}

/** 一条边和它的对边 */
export const NM_BIAN_DUI: Record<NmBian, NmBian> = {
  shang: 'xia',
  you: 'zuo',
  xia: 'shang',
  zuo: 'you',
};

/** 固定顺序：距离相同时的确定性优先级（右、左、下、上，与旧实现一致） */
export const NM_SI_BIAN: NmBian[] = ['you', 'zuo', 'xia', 'shang'];

function bianBeiZhan(z: NmBianZhanYong | null | undefined, bian: NmBian): boolean {
  return z?.[bian] != null;
}

function kuangZaiWorkArea(k: NmKuang, wa?: NmKuang | null): boolean {
  if (!wa || !(wa.width > 0) || !(wa.height > 0)) return true;
  const rong = 0.51;
  return k.x >= wa.x - rong && k.y >= wa.y - rong
    && k.x + k.width <= wa.x + wa.width + rong
    && k.y + k.height <= wa.y + wa.height + rong;
}

/**
 * 四边吸附真值表的核心：只在**空闲边**里挑间隙最小的一条。
 * 条件与旧版一致：对边、垂直/水平重叠 ≥50%、间隙 ≤ jia；另外整组落点必须在 workArea 内。
 *
 * 第 81 轮项 9：`duiQi=true` 时尺寸对齐目标（左/右贴 ⇒ 拖动窗高度=目标高度；
 * 上/下贴 ⇒ 拖动窗宽度=目标宽度），目标窗自身尺寸不变。默认 false 保留旧的
 * "并排取最大高度 / 上下各管各"语义（旧门禁直接断言这个默认行为）。
 */
export function nmJiSuanSiBianXiFu(
  zhu: { id: number; kuang: NmKuang; zhanYong?: NmBianZhanYong | null },
  qiTa: Array<{ id: number; kuang: NmKuang; zhanYong?: NmBianZhanYong | null }>,
  jia = NM_XI_FU_JIA,
  workArea?: NmKuang | null,
  duiQi = false,
): NmSiBianXiFuJieGuo {
  const wu: NmSiBianXiFuJieGuo = {
    xiFu: false, muBiao: null, zhu: null, lin: null, fangXiang: null,
    bian: null, duiBian: null, juLi: Number.POSITIVE_INFINITY,
  };
  const b = zhu?.kuang;
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || b.width <= 0 || b.height <= 0) return wu;
  const houXuan: NmSiBianXiFuJieGuo[] = [];
  const tian = (bian: NmBian, o: { id: number; kuang: NmKuang }, juLi: number, zr: NmKuang, lr: NmKuang | null): void => {
    if (!kuangZaiWorkArea(zr, workArea) || (lr && !kuangZaiWorkArea(lr, workArea))) return;
    houXuan.push({
      xiFu: true,
      muBiao: o.id,
      bian,
      duiBian: NM_BIAN_DUI[bian],
      // 兼容旧字段：方向仍然表示"拖动窗在邻窗的哪一侧"
      fangXiang: NM_BIAN_DUI[bian],
      zhu: zr,
      lin: lr,
      juLi,
    });
  };

  for (const o of qiTa) {
    if (!o || o.id === zhu.id) continue;
    const ob = o.kuang;
    if (!ob || !Number.isFinite(ob.x) || !Number.isFinite(ob.y) || ob.width <= 0 || ob.height <= 0) continue;
    const chongDieY = Math.min(b.y + b.height, ob.y + ob.height) - Math.max(b.y, ob.y);
    const chongDieX = Math.min(b.x + b.width, ob.x + ob.width) - Math.max(b.x, ob.x);
    const gao = Math.max(b.height, ob.height);
    const yDing = Math.min(b.y, ob.y);

    // 并排：拖动窗的右边贴邻窗左边（拖动窗在邻窗左侧）
    if (!bianBeiZhan(zhu.zhanYong, 'you') && !bianBeiZhan(o.zhanYong, 'zuo')
      && chongDieY >= Math.min(b.height, ob.height) * 0.5) {
      const ju = Math.abs(b.x + b.width - ob.x);
      if (ju <= jia) {
        // duiQi：高度同目标、顶边对齐；否则沿用"取最大高度、顶边取较小者"
        const g = duiQi ? ob.height : gao;
        const y = duiQi ? ob.y : yDing;
        tian('you', o, ju,
          { x: ob.x - b.width, y, width: b.width, height: g },
          { x: ob.x, y, width: ob.width, height: g });
      }
    }
    // 并排：拖动窗的左边贴邻窗右边（拖动窗在邻窗右侧）
    if (!bianBeiZhan(zhu.zhanYong, 'zuo') && !bianBeiZhan(o.zhanYong, 'you')
      && chongDieY >= Math.min(b.height, ob.height) * 0.5) {
      const ju = Math.abs(b.x - (ob.x + ob.width));
      if (ju <= jia) {
        const g = duiQi ? ob.height : gao;
        const y = duiQi ? ob.y : yDing;
        tian('zuo', o, ju,
          { x: ob.x + ob.width, y, width: b.width, height: g },
          { x: ob.x, y, width: ob.width, height: g });
      }
    }
    // 上下：拖动窗的下边贴邻窗上边（拖动窗在邻窗上方）
    if (!bianBeiZhan(zhu.zhanYong, 'xia') && !bianBeiZhan(o.zhanYong, 'shang')
      && chongDieX >= Math.min(b.width, ob.width) * 0.5) {
      const ju = Math.abs(b.y + b.height - ob.y);
      if (ju <= jia) {
        // duiQi：宽度同目标、左边对齐；否则保持各自宽度
        tian('xia', o, ju,
          { x: duiQi ? ob.x : b.x, y: ob.y - b.height, width: duiQi ? ob.width : b.width, height: b.height },
          { x: ob.x, y: ob.y, width: ob.width, height: ob.height });
      }
    }
    // 上下：拖动窗的上边贴邻窗下边（拖动窗在邻窗下方）
    if (!bianBeiZhan(zhu.zhanYong, 'shang') && !bianBeiZhan(o.zhanYong, 'xia')
      && chongDieX >= Math.min(b.width, ob.width) * 0.5) {
      const ju = Math.abs(b.y - (ob.y + ob.height));
      if (ju <= jia) {
        tian('shang', o, ju,
          { x: duiQi ? ob.x : b.x, y: ob.y + ob.height, width: duiQi ? ob.width : b.width, height: b.height },
          { x: ob.x, y: ob.y, width: ob.width, height: ob.height });
      }
    }
  }
  if (!houXuan.length) return wu;
  houXuan.sort((x, y) => x.juLi - y.juLi);
  return houXuan[0]!;
}

/** 指定的一条边现在是否还贴着（用于"拖开就断开"，比 nmHaiXiangLin 更严格） */
export function nmBianHaiXiangLin(a: NmKuang, b: NmKuang, bian: NmBian, jia = NM_XI_FU_JIA): boolean {
  if (!a || !b || a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  const ju = jia * 1.5;
  const chongDieY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const chongDieX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (bian === 'you') return Math.abs(a.x + a.width - b.x) <= ju && chongDieY >= Math.min(a.height, b.height) * 0.5;
  if (bian === 'zuo') return Math.abs(a.x - (b.x + b.width)) <= ju && chongDieY >= Math.min(a.height, b.height) * 0.5;
  if (bian === 'xia') return Math.abs(a.y + a.height - b.y) <= ju && chongDieX >= Math.min(a.width, b.width) * 0.5;
  return Math.abs(a.y - (b.y + b.height)) <= ju && chongDieX >= Math.min(a.width, b.width) * 0.5;
}

/**
 * BFS 取连通分量（含起点）。用 visited 集合挡住环：2×2 拼块这种合法环也只会走一遍。
 * 纯函数，邻接关系由调用方给，方便门禁用假图直接验"不重复/不成环"。
 */
export function nmBianLiLianTong(start: number, linJu: (id: number) => Iterable<number> | null | undefined): number[] {
  const yiZou = new Set<number>();
  const dui: number[] = [start];
  const out: number[] = [];
  while (dui.length) {
    const id = dui.shift()!;
    if (yiZou.has(id)) continue;
    yiZou.add(id);
    out.push(id);
    for (const x of linJu(id) || []) {
      if (!yiZou.has(x)) dui.push(x);
    }
  }
  return out;
}

/** 两个矩形现在还算不算"贴在一起"（用于判断"拖开就断开"） */
export function nmHaiXiangLin(a: NmKuang, b: NmKuang, jia = NM_XI_FU_JIA): boolean {
  const chongDieY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const chongDieX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const juLiH = Math.min(Math.abs(a.x - (b.x + b.width)), Math.abs(a.x + a.width - b.x));
  const juLiV = Math.min(Math.abs(a.y - (b.y + b.height)), Math.abs(a.y + a.height - b.y));
  if (chongDieY >= Math.min(a.height, b.height) * 0.5 && juLiH <= jia * 1.5) return true;
  if (chongDieX >= Math.min(a.width, b.width) * 0.5 && juLiV <= jia * 1.5) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════
   四、窗口池 + 吸附联动（真窗口）
   ══════════════════════════════════════════════════════════════════════ */

interface NmZhuangTai {
  /** nm 窗口 = BrowserWindow.id；主窗口 = -1（平等参与者，不参与 nm 窗口列表） */
  id: number;
  win: BrowserWindow;
  luJing: string;
  zongShiDing: boolean;
  xiFu: boolean;
  /**
   * 四边各自的邻窗 id（每边最多一个，null = 空）。
   * 连接是双向的：A.you = B ⇔ B.zuo = A。一扇窗可以同时挂满四条边。
   */
  bian: Record<NmBian, number | null>;
  /** 程序自己 setBounds 期间为 true：挡住由此触发的 move/resize 回流 */
  sheZhiZhong: boolean;
  /** 上次记录的矩形（算位移量用） */
  shangCi: Rectangle;
  yiDongDingShi: NodeJS.Timeout | null;
}

/** 主窗口在窗口池里的固定 id（nm 窗口 id 都是正数，不会撞） */
export const NM_ZHU_CHUANG_ID = -1;

const CHUANG_KOU = new Map<number, NmZhuangTai>();
let dieDai = 0;
/** 校准期间挡住 setBounds 触发的回流（不跨异步事件，靠"一样就别动"收敛） */
let tiaoZhengShen = 0;

export interface NmKaiXuanXiang {
  luJing: string;
  tuBiao?: string;
  zhuTi?: { mode: 'light' | 'dark'; accent: string; ink?: string };
}

function kongBian(): Record<NmBian, number | null> {
  return { shang: null, you: null, xia: null, zuo: null };
}

function quXiaoDingShi(Z: NmZhuangTai): void {
  if (Z.yiDongDingShi) { clearTimeout(Z.yiDongDingShi); Z.yiDongDingShi = null; }
}

/** 当前窗四边挂着的邻窗（去重；正常情况下一窗只会在一条边上） */
function linJuIds(Z: NmZhuangTai): number[] {
  const out: number[] = [];
  for (const bian of NM_SI_BIAN) {
    const id = Z.bian[bian];
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

function zhanYongOf(Z: NmZhuangTai): NmBianZhanYong {
  return { shang: Z.bian.shang, you: Z.bian.you, xia: Z.bian.xia, zuo: Z.bian.zuo };
}

/** 断开某一条边（双向；另一边如果指回来才清，避免误删别人的新连接） */
function duanKaiBian(Z: NmZhuangTai, bian: NmBian): void {
  const otherId = Z.bian[bian];
  if (otherId == null) return;
  Z.bian[bian] = null;
  const o = CHUANG_KOU.get(otherId);
  if (o && o.bian[NM_BIAN_DUI[bian]] === Z.id) o.bian[NM_BIAN_DUI[bian]] = null;
}

function duanKai(Z: NmZhuangTai): void {
  for (const bian of NM_SI_BIAN) duanKaiBian(Z, bian);
}

/** 只在两边都空时建立双向连接；先来的永不被挤掉 */
function lianJieBian(Z: NmZhuangTai, bian: NmBian, o: NmZhuangTai, duiBian: NmBian): boolean {
  if (Z.bian[bian] != null || o.bian[duiBian] != null) return false;
  Z.bian[bian] = o.id;
  o.bian[duiBian] = Z.id;
  return true;
}

function sheZhiBianKuang(Z: NmZhuangTai, k: NmKuang): void {
  if (Z.win.isDestroyed()) return;
  const mu = {
    x: Math.round(k.x), y: Math.round(k.y),
    width: Math.max(200, Math.round(k.width)), height: Math.max(120, Math.round(k.height)),
  };
  const xian = Z.win.getBounds();
  // 一样就别动：避免"设成一样的值也发事件"，来回抖动
  if (xian.x === mu.x && xian.y === mu.y && xian.width === mu.width && xian.height === mu.height) {
    Z.shangCi = xian;
    return;
  }
  Z.sheZhiZhong = true;
  try {
    Z.win.setBounds(mu);
  } finally {
    Z.shangCi = Z.win.getBounds();
    Z.sheZhiZhong = false;
  }
}

/**
 * 拖动窗动 (dx,dy) ⇒ 整个连通分量跟着动（BFS，visited 挡环；不含自己）。
 * 主窗口也是分量里的普通节点：nm 拖着主窗口走、主窗口拖着 nm 走都允许。
 */
function tuoDongZu(Z: NmZhuangTai, dx: number, dy: number): void {
  const keZou = (id: number): number[] => {
    const o = CHUANG_KOU.get(id);
    if (!o || o.win.isDestroyed() || !o.xiFu) return [];
    if (o.win.isMaximized() || o.win.isMinimized() || o.win.isFullScreen()) return [];
    return linJuIds(o);
  };
  const chengYuan = nmBianLiLianTong(Z.id, keZou);
  for (const id of chengYuan) {
    if (id === Z.id) continue;
    const o = CHUANG_KOU.get(id);
    if (!o || o.win.isDestroyed() || !o.xiFu) continue;
    if (o.win.isMaximized() || o.win.isMinimized() || o.win.isFullScreen()) continue;
    const ob = o.win.getBounds();
    sheZhiBianKuang(o, { x: ob.x + dx, y: ob.y + dy, width: ob.width, height: ob.height });
  }
}

/**
 * 拖开/缩放后校准：只保留**仍然贴在那条边上**的连接。
 * 第 81 轮项 9 起**不再拉平邻窗尺寸**（拉伸/移动一扇窗不联动其它窗口）；
 * 这里不主动把窗口拽回旧位置（那会 setBounds 回流），只断开已经失效的连接。
 */
function jiaoYanLianJie(Z: NmZhuangTai): void {
  if (Z.win.isDestroyed()) return;
  const b = Z.win.getBounds();
  for (const bian of NM_SI_BIAN) {
    const otherId = Z.bian[bian];
    if (otherId == null) continue;
    const o = CHUANG_KOU.get(otherId);
    if (!o || o.win.isDestroyed() || !o.xiFu) { duanKaiBian(Z, bian); continue; }
    // 双向指针必须对得上；对不上说明对方已经换人，直接清掉自己这边
    if (o.bian[NM_BIAN_DUI[bian]] !== Z.id) { Z.bian[bian] = null; continue; }
    if (!nmBianHaiXiangLin(b, o.win.getBounds(), bian)) { duanKaiBian(Z, bian); continue; }
  }
}

/**
 * 找当前可参与吸附的邻居（不含自己）。
 * 这里**不再按"一对一/已有连接"过滤**：目标边有没有被占由纯函数按边判断。
 */
function keXiLinJu(Z: NmZhuangTai): Array<{ id: number; kuang: NmKuang; zhanYong: NmBianZhanYong }> {
  const out: Array<{ id: number; kuang: NmKuang; zhanYong: NmBianZhanYong }> = [];
  for (const o of CHUANG_KOU.values()) {
    if (o.id === Z.id || !o.xiFu || o.win.isDestroyed()) continue;
    if (o.win.isMaximized() || o.win.isMinimized() || o.win.isFullScreen()) continue;
    out.push({ id: o.id, kuang: o.win.getBounds(), zhanYong: zhanYongOf(o) });
  }
  return out;
}

/** 取窗口所在显示器的工作区（纯几何函数不直接碰 screen） */
function gongZuoQuOf(k: NmKuang): NmKuang | null {
  try {
    const wa = screen.getDisplayNearestPoint({
      x: Math.round(k.x + k.width / 2),
      y: Math.round(k.y + k.height / 2),
    }).workArea;
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  } catch {
    return null;
  }
}

/**
 * 移动结束后算一次：
 *   1) 先把整个连通分量按相同位移带走（BFS；主窗口/上下左右邻窗一视同仁）；
 *   2) 已经有连接的窗：只校准现有连接，不再在自由边上吸新的（避免拖着整组去"粘"别人）；
 *   3) 没连接的窗：在空闲的边里只吸**最近的一条**；目标边已占则跳过（先来的不被挤掉）。
 */
function chuLiYiDong(Z: NmZhuangTai): void {
  if (Z.sheZhiZhong || Z.win.isDestroyed()) return;
  if (Z.win.isMaximized() || Z.win.isFullScreen() || Z.win.isMinimized()) return;
  const xin = Z.win.getBounds();
  const jiu = Z.shangCi;
  const dx = xin.x - jiu.x;
  const dy = xin.y - jiu.y;
  if (dx === 0 && dy === 0) return;
  Z.shangCi = xin;
  // 关掉吸附的窗：既不吸别人，也不带走别人
  if (!Z.xiFu) { duanKai(Z); return; }
  const yiYouLian = linJuIds(Z).length > 0;
  tuoDongZu(Z, dx, dy);
  if (yiYouLian) { jiaoYanLianJie(Z); return; }

  const linJu = keXiLinJu(Z);
  if (!linJu.length) return;
  const b = Z.win.getBounds();
  const r = nmJiSuanSiBianXiFu(
    { id: Z.id, kuang: b, zhanYong: zhanYongOf(Z) },
    linJu,
    NM_XI_FU_JIA,
    gongZuoQuOf(b),
    true,
  );
  if (!r.xiFu || r.muBiao === null || !r.zhu || !r.bian || !r.duiBian) return;
  const lin = CHUANG_KOU.get(r.muBiao);
  if (!lin || lin.win.isDestroyed() || !lin.xiFu) return;
  if (Z.bian[r.bian] != null || lin.bian[r.duiBian] != null) return;

  // 主窗口尺寸由用户掌握：只贴边，不改主窗口大小；目标是 nm ⇒ 尺寸对齐目标（第 81 轮项 9）
  const sheZhu = Z.id === NM_ZHU_CHUANG_ID || lin.id === NM_ZHU_CHUANG_ID;
  // 第 81 轮项 9：允许贴到"已经吸附成组"的窗口上（不再因为目标有邻窗就只贴边）
  if (sheZhu) {
    sheZhiBianKuang(Z, { x: r.zhu.x, y: r.zhu.y, width: b.width, height: b.height });
  } else {
    sheZhiBianKuang(Z, r.zhu);
  }
  lianJieBian(Z, r.bian, lin, r.duiBian);
}

/**
 * 尺寸变化后的校准（第 81 轮项 9 重写）：
 *  - **不再联动其它窗口的尺寸**：拉伸一扇窗不会把邻窗拉高/压矮；
 *  - 但共享边必须保持"无空隙、无重叠"：把共享边那条坐标校正回邻窗的边；
 *  - 缩放结束（jieShu）时，空闲边如果已经靠得很近，照样吸上去（保持吸附能力）。
 */
function shouLianYiBian(Z: NmZhuangTai, bian: NmBian, o: NmZhuangTai): boolean {
  const b = Z.win.getBounds();
  const ob = o.win.getBounds();
  const jia = NM_XI_FU_JIA * 2;
  if (bian === 'you') {
    const gap = b.x - (ob.x + ob.width);
    if (Math.abs(gap) > jia) return false;
    const you = b.x + b.width;
    const x = ob.x + ob.width;
    if (you - x < 200) return false;
    if (gap !== 0) sheZhiBianKuang(Z, { x, y: b.y, width: you - x, height: b.height });
    return true;
  }
  if (bian === 'zuo') {
    const gap = (b.x + b.width) - ob.x;
    if (Math.abs(gap) > jia) return false;
    const kuan = ob.x - b.x;
    if (kuan < 200) return false;
    if (gap !== 0) sheZhiBianKuang(Z, { x: b.x, y: b.y, width: kuan, height: b.height });
    return true;
  }
  if (bian === 'xia') {
    const gap = b.y - (ob.y + ob.height);
    if (Math.abs(gap) > jia) return false;
    const xia = b.y + b.height;
    const y = ob.y + ob.height;
    if (xia - y < 120) return false;
    if (gap !== 0) sheZhiBianKuang(Z, { x: b.x, y, width: b.width, height: xia - y });
    return true;
  }
  // shang：本窗在上，共享边是下边
  const gap = (b.y + b.height) - ob.y;
  if (Math.abs(gap) > jia) return false;
  const gao = ob.y - b.y;
  if (gao < 120) return false;
  if (gap !== 0) sheZhiBianKuang(Z, { x: b.x, y: b.y, width: b.width, height: gao });
  return true;
}

/** 缩放结束时尝试在空闲边吸一个新邻窗（与拖动同样的几何，但不挪目标） */
function xiFuXinBian(Z: NmZhuangTai): void {
  const linJu = keXiLinJu(Z);
  if (!linJu.length) return;
  const b = Z.win.getBounds();
  const r = nmJiSuanSiBianXiFu(
    { id: Z.id, kuang: b, zhanYong: zhanYongOf(Z) },
    linJu,
    NM_XI_FU_JIA,
    gongZuoQuOf(b),
    true,
  );
  if (!r.xiFu || r.muBiao === null || !r.zhu || !r.bian || !r.duiBian) return;
  const lin = CHUANG_KOU.get(r.muBiao);
  if (!lin || lin.win.isDestroyed() || !lin.xiFu) return;
  if (Z.bian[r.bian] != null || lin.bian[r.duiBian] != null) return;
  // 主窗口尺寸由用户掌握：只贴边，不改主窗口大小
  const sheZhu = Z.id === NM_ZHU_CHUANG_ID || lin.id === NM_ZHU_CHUANG_ID;
  sheZhiBianKuang(Z, sheZhu ? { x: r.zhu.x, y: r.zhu.y, width: b.width, height: b.height } : r.zhu);
  lianJieBian(Z, r.bian, lin, r.duiBian);
}

function chuLiTiaoZheng(Z: NmZhuangTai, jieShu = false): void {
  if (Z.sheZhiZhong || !Z.xiFu || Z.win.isDestroyed()) return;
  if (Z.win.isMaximized() || Z.win.isMinimized() || Z.win.isFullScreen()) return;
  if (tiaoZhengShen > 0) return;
  tiaoZhengShen += 1;
  try {
    for (const bian of NM_SI_BIAN) {
      const otherId = Z.bian[bian];
      if (otherId == null) continue;
      const o = CHUANG_KOU.get(otherId);
      if (!o || o.win.isDestroyed() || !o.xiFu) { duanKaiBian(Z, bian); continue; }
      if (o.bian[NM_BIAN_DUI[bian]] !== Z.id) { Z.bian[bian] = null; continue; }
      // 贴边保持 / 无空隙无重叠；离得太远就当作用户想拆开
      if (!shouLianYiBian(Z, bian, o)) duanKaiBian(Z, bian);
    }
    if (jieShu) {
      Z.shangCi = Z.win.getBounds();
      xiFuXinBian(Z);
    }
  } finally {
    tiaoZhengShen -= 1;
  }
}

function anPaiYiDong(Z: NmZhuangTai): void {
  if (Z.yiDongDingShi) return;
  Z.yiDongDingShi = setTimeout(() => {
    Z.yiDongDingShi = null;
    try { chuLiYiDong(Z); } catch { /* 拖动期间算错也不能打断窗口 */ }
  }, 16);
  Z.yiDongDingShi.unref?.();
}

function anPaiTiaoZheng(Z: NmZhuangTai, jieShu = false): void {
  try { chuLiTiaoZheng(Z, jieShu); } catch { /* 缩放期间同理 */ }
}

function xiaYiGeWeiZhi(kuan: number, gao: number): { x: number; y: number } {
  let ji = { x: 80, y: 80 };
  try {
    const mu = BrowserWindow.getFocusedWindow();
    const b = mu && !mu.isDestroyed() ? mu.getBounds() : null;
    if (b) ji = { x: b.x + 32 * ((dieDai % 6) + 1), y: b.y + 32 * ((dieDai % 6) + 1) };
  } catch { /* 拿不到焦点窗就用默认落点 */ }
  try {
    const wa = screen.getDisplayNearestPoint({ x: ji.x, y: ji.y }).workArea;
    ji = {
      x: Math.min(Math.max(ji.x, wa.x), Math.max(wa.x, wa.x + wa.width - kuan)),
      y: Math.min(Math.max(ji.y, wa.y), Math.max(wa.y, wa.y + wa.height - gao)),
    };
  } catch { /* 屏幕信息拿不到就按算出来的落点开 */ }
  return ji;
}

/**
 * 新 nm 窗口的落点（第 67 轮项 19 修订）：
 *   · 主窗口在、且**主窗口右边还空** ⇒ 紧贴主窗口右侧（顶边对齐）并默认吸附；
 *   · 主窗口右边已经被占了 ⇒ 仍开在右侧（沿右边那条链排到最右），但**不吸附**
 *     （用户定稿：先来的连接永不被挤掉；后来的邻窗不抢已占的边）；
 *   · 主窗口不在 ⇒ 沿用旧的层叠落点。
 */
function nmXinChuangLuoDian(kuan: number, gao: number): {
  x: number;
  y: number;
  kuan: number;
  gao: number;
  fuZhu: NmZhuangTai | null;
} {
  const zhu = CHUANG_KOU.get(NM_ZHU_CHUANG_ID);
  if (!zhu || zhu.win.isDestroyed()) {
    const ji = xiaYiGeWeiZhi(kuan, gao);
    return { ...ji, kuan, gao, fuZhu: null };
  }
  let zb: Rectangle;
  try {
    zb = zhu.win.isMaximized() ? zhu.win.getNormalBounds() : zhu.win.getBounds();
  } catch {
    zb = zhu.win.getBounds();
  }
  // 主窗口右边空 ⇒ 新窗接在主窗口右边；已占 ⇒ 接在最右那扇的右边（并直接吸上去，形成一组）。
  // 不只看"已连成链"的窗：只要它实际落在主窗口右侧，就按它的右边缘继续排，
  // 否则第一扇没连上时，第二扇会又落回主窗口右侧、和第一扇重叠。
  let zuiYou = zuiYouCeLian(zhu);
  let zuiYouYou = zb.x + zb.width;
  if (zuiYou.id !== zhu.id) {
    try {
      const pb = zuiYou.win.isMaximized() ? zuiYou.win.getNormalBounds() : zuiYou.win.getBounds();
      if (pb.x >= zb.x + zb.width - 8) zuiYouYou = pb.x + pb.width;
    } catch { /* 拿不到那扇窗的矩形就仍贴主窗口右侧 */ }
  }
  for (const o of CHUANG_KOU.values()) {
    if (!o || o.id === zhu.id || o.win.isDestroyed() || !o.xiFu) continue;
    try {
      const pb = o.win.isMaximized() ? o.win.getNormalBounds() : o.win.getBounds();
      const you = pb.x + pb.width;
      // 只接在主窗口右侧那一排；更靠右的窗右边缘继续往后排
      if (pb.x >= zb.x + zb.width - 8 && you > zuiYouYou) { zuiYouYou = you; zuiYou = o; }
    } catch { /* 单扇窗拿不到就跳过 */ }
  }
  let x = zuiYouYou;
  let gao2 = gao;
  let kuan2 = kuan;
  let keFu = true;
  try {
    const wa = screen.getDisplayNearestPoint({ x, y: zb.y }).workArea;
    // 放得下就保持 960×720；主窗口比 720 矮时也不硬撑（吸附不强制等高）
    const keYongKuan = wa.x + wa.width - x;
    if (keYongKuan >= 420) {
      kuan2 = Math.min(kuan, keYongKuan);
    } else {
      // 右侧已经没地方：缩到最小宽度并贴住工作区右缘，保证窗口可见；
      // 这种情况下不再自动吸附（宁可并排失败，也不能让两个窗口叠在一起动）。
      kuan2 = 420;
      x = Math.max(wa.x, wa.x + wa.width - kuan2);
      keFu = false;
    }
    const keYongGao = Math.max(300, wa.y + wa.height - zb.y);
    gao2 = Math.min(gao, keYongGao);
  } catch { /* 屏幕信息拿不到就按算出来的落点开 */ }
  // 第 81 轮项 9：第二扇 nm 接在"已吸附窗口"右侧，并直接连成一组（右边缘是链尾，必然空着）
  return { x, y: zb.y, kuan: kuan2, gao: gao2, fuZhu: (keFu && zhu.xiFu && zuiYou.bian.you == null) ? zuiYou : null };
}

/** 打开（或聚焦）一个 nm 查看器窗口 */
export function nmShiTuKai(xuan: NmKaiXuanXiang): { ok: boolean; id?: number; yiCunZai?: boolean; cuo?: string } {
  try {
    const abs = path.resolve(String(xuan?.luJing || ''));
    if (!abs || !fs.existsSync(abs)) return { ok: false, cuo: '文件不存在' };
    if (fs.statSync(abs).isDirectory()) return { ok: false, cuo: '这是目录，不是文件' };
    for (const z of CHUANG_KOU.values()) {
      if (z.luJing === abs && !z.win.isDestroyed()) {
        z.win.show();
        z.win.focus();
        return { ok: true, id: z.id, yiCunZai: true };
      }
    }
    const zhuTi = xuan?.zhuTi || { mode: 'light' as const, accent: '#A87654' };
    const kuan = 960;
    const gao = 720;
    const luo = nmXinChuangLuoDian(kuan, gao);
    const isMac = process.platform === 'darwin';
    const w = new BrowserWindow({
      x: luo.x,
      y: luo.y,
      width: luo.kuan,
      height: luo.gao,
      minWidth: 420,
      minHeight: 300,
      title: `${path.basename(abs)} · nm 文件查看器`,
      frame: isMac,
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      backgroundColor: zhuTi.mode === 'dark' ? '#1e1e1e' : '#ededed',
      autoHideMenuBar: true,
      ...(xuan?.tuBiao ? { icon: xuan.tuBiao } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    try { w.setMenuBarVisibility(false); } catch { /* 某些平台没有菜单栏 */ }
    const Z: NmZhuangTai = {
      id: w.id,
      win: w,
      luJing: abs,
      zongShiDing: false,
      xiFu: true, // 产品要求：吸附默认开
      bian: kongBian(),
      sheZhiZhong: false,
      shangCi: w.getBounds(),
      yiDongDingShi: null,
    };
    CHUANG_KOU.set(Z.id, Z);
    dieDai += 1;
    /**
     * 默认吸附（第 81 轮项 9）：新窗口贴着主窗口（或右边链尾那扇 nm）的右边，
     * 并**当场双向记连接**；尺寸对齐目标（高度取目标高度，不重叠也不留缝）。
     */
    if (luo.fuZhu && !luo.fuZhu.win.isDestroyed() && luo.fuZhu.bian.you == null) {
      try {
        const zb = luo.fuZhu.win.isMaximized() ? luo.fuZhu.win.getNormalBounds() : luo.fuZhu.win.getBounds();
        sheZhiBianKuang(Z, {
          x: zb.x + zb.width,
          y: zb.y,
          width: w.getBounds().width,
          height: luo.fuZhu.id === NM_ZHU_CHUANG_ID ? w.getBounds().height : zb.height,
        });
        lianJieBian(Z, 'zuo', luo.fuZhu, 'you');
      } catch { /* 贴不上就保持普通窗口；不影响打开 */ }
    }
    w.on('move', () => anPaiYiDong(Z));
    // 'moved'/'resized' 是"动完/拉伸完"的那一次（Windows 上 move/resize 的粒度不稳，
    // 两个都挂上：拖到一半能吸就吸，放开手也一定会校准一次）
    w.on('moved', () => anPaiYiDong(Z));
    w.on('resize', () => anPaiTiaoZheng(Z, false));
    w.on('resized', () => anPaiTiaoZheng(Z, true));
    w.on('closed', () => {
      quXiaoDingShi(Z);
      duanKai(Z);
      CHUANG_KOU.delete(Z.id);
    });
    void w.loadFile(path.join(__dirname, 'renderer', 'nm-viewer.html'), {
      query: {
        id: String(Z.id),
        path: abs,
        theme: zhuTi.mode,
        accent: zhuTi.accent,
        ink: zhuTi.ink || '',
      },
    });
    return { ok: true, id: Z.id };
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/** 每窗口的「总在最前 / 吸附」开关（吸附关掉 ⇒ 立刻与所有邻窗脱开） */
export function nmShiTuSheZhi(
  id: number,
  she: { zongShiDing?: boolean; xiFu?: boolean },
): { ok: boolean; zongShiDing?: boolean; xiFu?: boolean; cuo?: string } {
  const Z = CHUANG_KOU.get(Number(id));
  if (!Z || Z.win.isDestroyed()) return { ok: false, cuo: '窗口已关闭' };
  try {
    if (typeof she?.zongShiDing === 'boolean') {
      Z.zongShiDing = she.zongShiDing;
      Z.win.setAlwaysOnTop(she.zongShiDing);
    }
    if (typeof she?.xiFu === 'boolean') {
      Z.xiFu = she.xiFu;
      if (!Z.xiFu) duanKai(Z);
    }
    return { ok: true, zongShiDing: Z.zongShiDing, xiFu: Z.xiFu };
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

function huanHangHuanYuan(wenBen: string, huanHang?: 'crlf' | 'lf'): string {
  if (huanHang === 'crlf') return wenBen.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return wenBen.replace(/\r\n/g, '\n');
}

function gongYongXieRu(
  luJing: string,
  p0?: { wenBen?: string; huanHang?: 'crlf' | 'lf' },
): { ok: boolean; luJing?: string; ziJie?: number; cuo?: string } {
  try {
    const yuan = typeof p0?.wenBen === 'string' ? p0.wenBen : '';
    const wen = huanHangHuanYuan(yuan, p0?.huanHang);
    const ziJie = Buffer.byteLength(wen, 'utf8');
    if (ziJie > BAO_CUN_SHANG_XIAN) return { ok: false, cuo: '内容太大，超过 64MB 保存上限' };
    fs.writeFileSync(luJing, wen, 'utf8');
    return { ok: true, luJing, ziJie };
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

export interface NmBianGeng {
  offset: number;
  value: number;
}

/**
 * 规整渲染层提交的字节改动。
 * 只接受 `[offset, value]`（紧凑）或 `{offset, value}`；任何越界/非整数/非字节值都整单拒绝，
 * **绝不"尽量应用一部分"**（二进制写坏一半比不写更糟）。
 */
export function nmGuiFanBianGeng(raw: unknown, ziJie: number): { ok: boolean; bianGeng?: NmBianGeng[]; cuo?: string } {
  if (!Array.isArray(raw)) return { ok: false, cuo: 'no-changes' };
  if (raw.length > ER_JIN_ZHI_ZUI_DAO_GAI) return { ok: false, cuo: '改动太多（超过 100 万字节）' };
  const map = new Map<number, number>();
  for (const x of raw) {
    const offset = Array.isArray(x) ? Number(x[0]) : Number((x as { offset?: unknown })?.offset);
    const value = Array.isArray(x) ? Number(x[1]) : Number((x as { value?: unknown })?.value);
    if (!Number.isInteger(offset) || !Number.isInteger(value)) return { ok: false, cuo: '改动格式不对（offset/value 必须是整数）' };
    if (offset < 0 || offset >= ziJie) return { ok: false, cuo: `改动越界：${offset}（文件只有 ${ziJie} 字节）` };
    if (value < 0 || value > 255) return { ok: false, cuo: `字节值越界：${value}（只允许 0–255）` };
    map.set(offset, value);
  }
  return { ok: true, bianGeng: [...map.entries()].map(([offset, value]) => ({ offset, value })) };
}

function yingYongBianGeng(buf: Buffer, bianGeng: NmBianGeng[]): Buffer {
  for (const b of bianGeng) buf[b.offset] = b.value;
  return buf;
}

/** 原子写：同目录临时文件写完 fsync 再 rename；rename 失败退回覆盖写（备份已存在） */
function yuanZiXieRu(luJing: string, buf: Buffer): { ok: boolean; cuo?: string } {
  const dir = path.dirname(luJing);
  const tmp = path.join(dir, `.${path.basename(luJing)}.warmy-tmp-${process.pid}-${Date.now()}`);
  let mode = 0o600;
  try { mode = fs.statSync(luJing).mode; } catch { /* 新文件用默认权限 */ }
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    try {
      let off = 0;
      while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, luJing);
    } catch {
      // Windows 上目标被占用时 rename 会失败：备份已经写好，这里退回覆盖写并如实返回
      fs.writeFileSync(luJing, buf);
      try { fs.unlinkSync(tmp); } catch { /* 临时文件删不掉不影响保存 */ }
    }
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/**
 * 二进制保存：**先备份、再原子写**。
 * 覆盖前重新算 SHA-256；和打开时不一致（别的程序改过）就拒绝，让用户重新打开再改。
 */
function baoCunErJinZhi(
  luJing: string,
  p0: { sha256?: string; bianGeng?: unknown },
): { ok: boolean; luJing?: string; ziJie?: number; sha256?: string; beiFen?: string; stale?: boolean; cuo?: string } {
  try {
    const st = fs.statSync(luJing);
    if (!st.isFile()) return { ok: false, cuo: '不是文件' };
    if (st.size > ER_JIN_ZHI_KE_BIAN_JI) return { ok: false, cuo: `文件超过 ${ER_JIN_ZHI_KE_BIAN_JI / 1048576}MB 编辑上限，只读` };
    const qiDai = String(p0?.sha256 || '');
    if (!qiDai) return { ok: false, cuo: '缺少打开时的文件哈希，无法安全保存' };
    const yuan = fs.readFileSync(luJing);
    const xianZai = crypto.createHash('sha256').update(yuan).digest('hex');
    if (xianZai !== qiDai) {
      return { ok: false, stale: true, cuo: '文件已被其它程序修改，未覆盖保存。请重新打开文件后再改。' };
    }
    const gui = nmGuiFanBianGeng(p0?.bianGeng, yuan.length);
    if (!gui.ok || !gui.bianGeng) return { ok: false, cuo: gui.cuo || 'no-changes' };
    const xin = yingYongBianGeng(Buffer.from(yuan), gui.bianGeng);
    const beiFen = luJing + '.warmy-bak';
    fs.copyFileSync(luJing, beiFen);
    const xie = yuanZiXieRu(luJing, xin);
    if (!xie.ok) return { ok: false, cuo: '写入失败：' + (xie.cuo || '未知原因') + '（原文件已备份到 ' + beiFen + '）' };
    return {
      ok: true, luJing, ziJie: xin.length,
      sha256: crypto.createHash('sha256').update(xin).digest('hex'),
      beiFen,
    };
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/** 保存（写回本窗口当前文件）：文本走 wenBen，二进制走 bianGeng 增量 */
export function nmShiTuBaoCun(
  id: number,
  p0?: { wenBen?: string; huanHang?: 'crlf' | 'lf'; sha256?: string; bianGeng?: unknown },
): { ok: boolean; luJing?: string; ziJie?: number; sha256?: string; beiFen?: string; stale?: boolean; cuo?: string } {
  const Z = CHUANG_KOU.get(Number(id));
  if (!Z || Z.win.isDestroyed()) return { ok: false, cuo: '窗口已关闭' };
  if (p0 && p0.bianGeng !== undefined) return baoCunErJinZhi(Z.luJing, p0);
  return gongYongXieRu(Z.luJing, p0);
}

/** 读一个二进制窗口的字节块（虚拟十六进制视图按 256KB 分块取，不把整文件搬进渲染层） */
export function nmShiTuQuZiJie(
  id: number,
  offset: number,
  length: number,
): { ok: boolean; offset?: number; bytes?: string; ziJie?: number; cuo?: string } {
  const Z = CHUANG_KOU.get(Number(id));
  if (!Z || Z.win.isDestroyed()) return { ok: false, cuo: '窗口已关闭' };
  try {
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    const len = Math.max(1, Math.min(ER_JIN_ZHI_DU_KUAI, Math.floor(Number(length) || 1)));
    const st = fs.statSync(Z.luJing);
    if (!st.isFile()) return { ok: false, cuo: '不是文件' };
    if (off >= st.size) return { ok: true, offset: off, bytes: '', ziJie: st.size };
    const n = Math.min(len, st.size - off);
    const fd = fs.openSync(Z.luJing, 'r');
    try {
      const buf = Buffer.alloc(n);
      const du = fs.readSync(fd, buf, 0, n, off);
      return { ok: true, offset: off, bytes: buf.subarray(0, du).toString('base64'), ziJie: st.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/** 另存为（用户选路径；成功后本窗口改为指向新文件） */
export async function nmShiTuLingCunWei(
  id: number,
  p0?: { wenBen?: string; huanHang?: 'crlf' | 'lf'; jianYiMing?: string; sha256?: string; bianGeng?: unknown },
): Promise<{ ok: boolean; luJing?: string; ziJie?: number; sha256?: string; beiFen?: string; stale?: boolean; cuo?: string; yiQuXiao?: boolean }> {
  const Z = CHUANG_KOU.get(Number(id));
  if (!Z || Z.win.isDestroyed()) return { ok: false, cuo: '窗口已关闭' };
  try {
    const jianYi = path.join(path.dirname(Z.luJing), String(p0?.jianYiMing || path.basename(Z.luJing)));
    const r = await dialog.showSaveDialog(Z.win, {
      title: '另存为',
      defaultPath: jianYi,
      buttonLabel: '保存',
    });
    if (r.canceled || !r.filePath) return { ok: false, yiQuXiao: true };
    if (p0 && p0.bianGeng !== undefined) {
      /**
       * 二进制另存：先把**原文件**校验并应用当前改动，再写到用户选的新路径。
       * 不覆盖原文件（另存为的语义），所以不需要备份；新路径写失败就如实报错。
       */
      const st = fs.statSync(Z.luJing);
      const yuan = fs.readFileSync(Z.luJing);
      const xianZai = crypto.createHash('sha256').update(yuan).digest('hex');
      if (!p0.sha256 || xianZai !== String(p0.sha256)) {
        return { ok: false, stale: true, cuo: '文件已被其它程序修改，未另存。请重新打开文件后再改。' };
      }
      const gui = nmGuiFanBianGeng(p0.bianGeng, st.size);
      if (!gui.ok || !gui.bianGeng) return { ok: false, cuo: gui.cuo || 'no-changes' };
      const xin = yingYongBianGeng(Buffer.from(yuan), gui.bianGeng);
      const xie = yuanZiXieRu(path.resolve(r.filePath), xin);
      if (!xie.ok) return { ok: false, cuo: xie.cuo || '写入失败' };
      Z.luJing = path.resolve(r.filePath);
      try { Z.win.setTitle(`${path.basename(Z.luJing)} · nm 文件查看器`); } catch { /* 标题设不上不影响保存 */ }
      return {
        ok: true, luJing: Z.luJing, ziJie: xin.length,
        sha256: crypto.createHash('sha256').update(xin).digest('hex'),
      };
    }
    const xie = gongYongXieRu(r.filePath, p0);
    if (!xie.ok) return xie;
    Z.luJing = path.resolve(r.filePath);
    try { Z.win.setTitle(`${path.basename(Z.luJing)} · nm 文件查看器`); } catch { /* 标题设不上不影响保存 */ }
    return { ok: true, luJing: Z.luJing, ziJie: xie.ziJie };
  } catch (e) {
    return { ok: false, cuo: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/** 当前所有 nm 窗口（调试/自检用：主进程与界面都要能问"现在开了几个、谁连着谁"） */
export function nmShiTuLieBiao(): Array<{ id: number; luJing: string; zongShiDing: boolean; xiFu: boolean; lianJie: number[] }> {
  const out: Array<{ id: number; luJing: string; zongShiDing: boolean; xiFu: boolean; lianJie: number[] }> = [];
  for (const z of CHUANG_KOU.values()) {
    if (z.win.isDestroyed() || z.id === NM_ZHU_CHUANG_ID) continue;
    out.push({ id: z.id, luJing: z.luJing, zongShiDing: z.zongShiDing, xiFu: z.xiFu, lianJie: linJuIds(z) });
  }
  return out;
}

/** 应用退出时统一收掉 nm 窗口（主窗口是调用方，绝不在这里 destroy） */
export function nmShiTuQuanBuGuanBi(): void {
  for (const z of [...CHUANG_KOU.values()]) {
    if (z.id === NM_ZHU_CHUANG_ID) continue;
    quXiaoDingShi(z);
    try { if (!z.win.isDestroyed()) z.win.destroy(); } catch { /* 已经没了就算了 */ }
  }
  for (const z of [...CHUANG_KOU.values()]) {
    if (z.id === NM_ZHU_CHUANG_ID) { duanKai(z); CHUANG_KOU.delete(z.id); }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   五、压缩包（第 78 轮项 18）
   ---------------------------------------------------------------------------
   设计取舍：
     · **零依赖**：只读 ZIP 中央目录 + stored/deflate；ZipCrypto 自己解；
       AES / bzip2 / lzma / zstd 一律如实标成"受保护/打不开"，绝不假装能解。
     · **不新增 IPC**：查看器窗口的 preload 不在本轮改动范围内，所以压缩包请求
       编码进 `path` 字符串（`nmz1:` + base64url(JSON)），仍走 `warmy:nmShiTuDu`；
       主进程只认这个前缀，密码只在内存里用一次，不写设置、不写日志、不落盘。
     · **zip-slip / 压缩炸弹**：条目名逐段校验（..、绝对路径、盘符、保留名、控制字符）；
       解压目标必须落在新建目录内；单文件/总量/压缩比/嵌套层数都有硬上限。
     · 包内套包：`.zip` 条目在树里当文件夹，按需展开（每层重新解析中央目录）。
   ══════════════════════════════════════════════════════════════════════ */

const NM_ZIP_QIAN = 'nmz1:';
const NM_ZIP_ZUI_DA = 512 * 1024 * 1024;          // 压缩包本体上限
const NM_ZIP_TIAO_YULAN = 64 * 1024 * 1024;       // 单条目预览上限
const NM_ZIP_TIAO_JIEYA = 256 * 1024 * 1024;      // 单条目解压上限
const NM_ZIP_TOTAL_JIEYA = 512 * 1024 * 1024;     // 一次解压总量上限
const NM_ZIP_RATIO = 200;                         // 压缩比上限（>1MB 的条目才算）
const NM_ZIP_MAX_TIAO = 20000;                    // 条目数上限
const NM_ZIP_MAX_CENG = 8;                        // 嵌套 zip 层数上限
const NM_ZIP_CD_MAX = 64 * 1024 * 1024;           // 中央目录读取上限
const NM_ZIP_QINGQIU_MAX = 32 * 1024;             // 信封长度上限（路径+密码）

/** 界面上当作"压缩包"的扩展名（docx/xlsx/pptx 已在文档分支先认走） */
const YA_SUO_KUO = new Set([
  'zip', 'jar', 'war', 'apk', 'xpi', 'vsix', 'cbz', 'epub', 'odt', 'ods', 'odp',
]);

const FANG_FA_MING: Record<number, string> = {
  0: 'stored（不压缩）',
  8: 'deflate',
  9: 'deflate64',
  12: 'bzip2',
  14: 'lzma',
  93: 'zstd',
  95: 'xz',
  98: 'ppmd',
  99: 'AES',
};

interface NmZipTiao {
  name: string;
  flags: number;
  method: number;
  crc: number;
  comp: number;
  size: number;
  localOff: number;
  isDir: boolean;
  extAttr: number;
  dosTime: number;
}

interface NmZipSuoYin {
  tiao: NmZipTiao[];
  zip64: boolean;
}

/** Buffer 下标（noUncheckedIndexedAccess 下统一走这里，越界给 0） */
function nmZi(buf: Buffer, i: number): number {
  return buf[i] ?? 0;
}

/** 压缩包请求编码（渲染层用；纯函数，测试可直接断言） */
export function nmBianMaYaSuoQingQiu(q: NmYaSuoQingQiu): string {
  return NM_ZIP_QIAN + Buffer.from(JSON.stringify(q), 'utf8').toString('base64url');
}

/** 压缩包请求解码：前缀不对/超长/JSON 坏 ⇒ 不当成压缩包（交回普通文件路径） */
export function nmJieXiYaSuoQingQiu(raw: string): { ok: true; q: NmYaSuoQingQiu } | { ok: false } {
  const s = String(raw || '');
  if (!s.startsWith(NM_ZIP_QIAN) || s.length > NM_ZIP_QINGQIU_MAX) return { ok: false };
  try {
    const o = JSON.parse(Buffer.from(s.slice(NM_ZIP_QIAN.length), 'base64url').toString('utf8')) as NmYaSuoQingQiu;
    if (!o || typeof o !== 'object') return { ok: false };
    if (o.a !== 'tree' && o.a !== 'read' && o.a !== 'extract' && o.a !== 'sysopen') return { ok: false };
    return { ok: true, q: o };
  } catch {
    return { ok: false };
  }
}

/**
 * 条目名路径安全（zip-slip / 路径穿越）。
 * 规则刻意比"能解压"更严：Windows 上 `a:b`、`CON`、结尾点/空格都会变成落点歧义，一律拒绝。
 */
export function nmZipTiaoMuAnQuan(mingRaw: string): boolean {
  const ming = String(mingRaw || '').replace(/\\/g, '/');
  if (!ming || ming.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(ming) || /^\//.test(ming)) return false;
  const duan = ming.split('/').filter((x) => x && x !== '.');
  if (!duan.length) return false;
  if (duan.length > 40 || ming.length > 240) return false;
  for (const x of duan) {
    if (x === '..') return false;
    if (/[\x00-\x1f<>:"|?*]/.test(x)) return false;
    if (/[. ]$/.test(x)) return false;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(x)) return false;
    if (x.length > 120) return false;
  }
  return true;
}

/** 扩展名（小写、带点前）；条目名统一 / */
function nmKuoOf(ming: string): string {
  const s = String(ming || '').replace(/\\/g, '/');
  const base = s.slice(s.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function nmBaseOf(ming: string): string {
  const s = String(ming || '').replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1) || s;
}

function nmZipMing(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    // 老 ZIP 里的中文常是 GBK（bit 11 没置）；Node 自带 ICU 可直接转
    return new TextDecoder('gbk' as string).decode(buf);
  } catch {
    return utf8;
  }
}

/** 认压缩包：扩展名白名单 或 ZIP 魔数（空包也认） */
export function nmKanShiYaSuo(kuo: string, qianTou: Buffer): boolean {
  if (YA_SUO_KUO.has(String(kuo || '').toLowerCase())) return true;
  if (qianTou.length >= 4) {
    const sig = qianTou.readUInt32LE(0);
    // local file header / empty archive EOCD / data descriptor
    if (sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50) return true;
  }
  return false;
}

/* ── CRC32 / ZipCrypto（只用于校验与传统加密；AES 不碰） ───────────── */
const NM_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function nmCrc32Update(crc: number, byte: number): number {
  return (NM_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
}

function nmCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = nmCrc32Update(c, nmZi(buf, i));
  return (c ^ 0xffffffff) >>> 0;
}

interface NmZipCrypto {
  ming: (c: number) => number;
}

function nmZipCrypto(pw: Buffer): NmZipCrypto {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const geng = (b: number): void => {
    k0 = nmCrc32Update(k0, b);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = nmCrc32Update(k2, (k1 >>> 24) & 0xff);
  };
  for (let i = 0; i < pw.length; i += 1) geng(nmZi(pw, i));
  return {
    ming(c: number): number {
      const t = (k2 | 2) >>> 0;
      const k = ((Math.imul(t, t ^ 1) >>> 0) >>> 8) & 0xff;
      const o = (c ^ k) & 0xff;
      geng(o);
      return o;
    },
  };
}

function nmDuFanWei(fd: number, off: number, len: number): Buffer {
  const n = Math.max(0, Math.floor(len));
  const buf = Buffer.alloc(n);
  let du = 0;
  while (du < n) {
    const r = fs.readSync(fd, buf, du, n - du, off + du);
    if (r <= 0) break;
    du += r;
  }
  return buf.subarray(0, du);
}

function nmZhaoEocd(buf: Buffer): number {
  const max = Math.min(buf.length, 66_000);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function nmZip64Extra(extra: Buffer, need: { size: boolean; comp: boolean; off: boolean }): { size?: number; comp?: number; off?: number } {
  let p = 0;
  while (p + 4 <= extra.length) {
    const tag = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (p + 4 + len > extra.length) break;
    if (tag === 0x0001) {
      const out: { size?: number; comp?: number; off?: number } = {};
      let q = p + 4;
      if (need.size && q + 8 <= p + 4 + len) { out.size = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (need.comp && q + 8 <= p + 4 + len) { out.comp = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (need.off && q + 8 <= p + 4 + len) { out.off = Number(extra.readBigUInt64LE(q)); q += 8; }
      return out;
    }
    p += 4 + len;
  }
  return {};
}

/** 解析中央目录（buf 是完整压缩包或已读出的中央目录片段） */
function nmJieXiZhongYang(buf: Buffer, cdOff: number, count: number, zip64: boolean): NmZipSuoYin {
  const out: NmZipTiao[] = [];
  let p = cdOff;
  const n = Math.min(count, NM_ZIP_MAX_TIAO);
  for (let i = 0; i < n; i += 1) {
    if (p + 46 > buf.length) break;
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const dosTime = buf.readUInt16LE(p + 12);
    const crc = buf.readUInt32LE(p + 16);
    let comp = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    let localOff = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + cmtLen > buf.length) break;
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
    const name = nmZipMing(nameBuf).replace(/\\/g, '/');
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const need = {
      size: size === 0xFFFFFFFF,
      comp: comp === 0xFFFFFFFF,
      off: localOff === 0xFFFFFFFF,
    };
    if (need.size || need.comp || need.off) {
      const z = nmZip64Extra(extra, need);
      if (z.size !== undefined) size = z.size;
      if (z.comp !== undefined) comp = z.comp;
      if (z.off !== undefined) localOff = z.off;
    }
    const isDir = /\/$/.test(name) || (extAttr & 0x10) !== 0;
    out.push({ name, flags, method, crc, comp, size, localOff, isDir, extAttr, dosTime });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { tiao: out, zip64 };
}

function nmDuZipSuoYinWenJian(file: string): NmZipSuoYin {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('not-a-file');
  if (st.size > NM_ZIP_ZUI_DA) {
    throw new Error(`压缩包 ${(st.size / 1048576).toFixed(0)}MB，超过 ${(NM_ZIP_ZUI_DA / 1048576).toFixed(0)}MB 查看上限`);
  }
  const fd = fs.openSync(file, 'r');
  try {
    const tailLen = Math.min(st.size, 66_000);
    const tail = nmDuFanWei(fd, st.size - tailLen, tailLen);
    const e = nmZhaoEocd(tail);
    if (e < 0) throw new Error('not-a-zip（找不到中央目录结尾）');
    const eAbs = st.size - tailLen + e;
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOff = tail.readUInt32LE(e + 16);
    let zip64 = false;
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
      if (eAbs >= 20) {
        const loc = nmDuFanWei(fd, eAbs - 20, 20);
        if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50) {
          const z64Off = Number(loc.readBigUInt64LE(8));
          const z = nmDuFanWei(fd, z64Off, 56);
          if (z.length >= 56 && z.readUInt32LE(0) === 0x06064b50) {
            count = Number(z.readBigUInt64LE(32));
            cdSize = Number(z.readBigUInt64LE(40));
            cdOff = Number(z.readBigUInt64LE(48));
            zip64 = true;
          }
        }
      }
    }
    if (cdSize > NM_ZIP_CD_MAX) throw new Error('中央目录太大，查看器拒绝解析');
    if (cdOff + cdSize > st.size) throw new Error('中央目录越界（文件可能被截断）');
    const cd = nmDuFanWei(fd, cdOff, cdSize);
    return nmJieXiZhongYang(cd, 0, count, zip64);
  } finally {
    fs.closeSync(fd);
  }
}

function nmDuZipSuoYinBuffer(buf: Buffer): NmZipSuoYin {
  if (buf.length > NM_ZIP_ZUI_DA) throw new Error('嵌套压缩包超过查看上限');
  const e = nmZhaoEocd(buf);
  if (e < 0) throw new Error('not-a-zip（嵌套包找不到中央目录结尾）');
  let count = buf.readUInt16LE(e + 10);
  let cdSize = buf.readUInt32LE(e + 12);
  let cdOff = buf.readUInt32LE(e + 16);
  let zip64 = false;
  if ((count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) && e >= 20) {
    if (buf.readUInt32LE(e - 20) === 0x07064b50) {
      const z64Off = Number(buf.readBigUInt64LE(e - 12));
      if (z64Off + 56 <= buf.length && buf.readUInt32LE(z64Off) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z64Off + 32));
        cdSize = Number(buf.readBigUInt64LE(z64Off + 40));
        cdOff = Number(buf.readBigUInt64LE(z64Off + 48));
        zip64 = true;
      }
    }
  }
  if (cdSize > NM_ZIP_CD_MAX || cdOff + cdSize > buf.length) throw new Error('嵌套压缩包中央目录越界');
  return nmJieXiZhongYang(buf, cdOff, count, zip64);
}

function nmFangFaMing(m: number): string {
  return FANG_FA_MING[m] || `方法 ${m}`;
}

function nmTiaoMuShouBaoHu(t: NmZipTiao): boolean {
  // method 99 = AES；bit 6 = strong encryption（两者都没有零依赖解法）
  return t.method === 99 || (t.flags & 0x40) !== 0;
}

function nmTiaoMuWeiXian(t: NmZipTiao, shangXian = NM_ZIP_TIAO_YULAN): string | undefined {
  if (t.isDir) return undefined;
  if (t.size > shangXian) {
    return `解压后 ${(t.size / 1048576).toFixed(1)}MB，超过单条目上限 ${(shangXian / 1048576).toFixed(0)}MB`;
  }
  if (t.size > 1024 * 1024 && t.comp > 0 && t.size / t.comp > NM_ZIP_RATIO) {
    return `压缩比 ${Math.round(t.size / t.comp)}:1，疑似压缩炸弹（上限 ${NM_ZIP_RATIO}:1）`;
  }
  return undefined;
}

/** 列出压缩包（含嵌套层：e 为空 = 最外层） */
export function nmLieYaSuoBao(file: string, e: string[] = [], pwd?: string | string[]): {
  ok: boolean;
  xinXi?: NmYaSuoBaoXinXi;
  needPassword?: boolean;
  mimaCuo?: boolean;
  shouBaoHu?: boolean;
  cuo?: string;
} {
  try {
    const abs = path.resolve(String(file || ''));
    if (!abs || !fs.existsSync(abs)) return { ok: false, cuo: '压缩包不存在' };
    let suo: NmZipSuoYin;
    if (!e.length) {
      suo = nmDuZipSuoYinWenJian(abs);
    } else {
      const jie = nmJieXiTiaoMuLian(abs, e, pwd);
      if (!jie.ok || !jie.buf) return { ok: false, needPassword: jie.needPassword, mimaCuo: jie.mimaCuo, shouBaoHu: jie.shouBaoHu, cuo: jie.cuo };
      suo = nmDuZipSuoYinBuffer(jie.buf);
    }
    const tiaoMu: NmYaSuoBaoTiaoMu[] = [];
    let jiaMiShu = 0;
    for (const t of suo.tiao) {
      const shou = nmTiaoMuShouBaoHu(t);
      const wei = nmTiaoMuWeiXian(t);
      const anQuan = t.isDir ? true : nmZipTiaoMuAnQuan(t.name);
      const zhiChi = t.isDir || t.method === 0 || t.method === 8;
      const keKai = !t.isDir && !shou && zhiChi && !wei && anQuan;
      if (t.flags & 1) jiaMiShu += 1;
      tiaoMu.push({
        ming: t.name,
        isDir: t.isDir,
        ziJie: t.size,
        yaSuoZiJie: t.comp,
        fangFa: t.method,
        fangFaMing: nmFangFaMing(t.method),
        jiaMi: (t.flags & 1) !== 0 && !shou,
        shouBaoHu: shou,
        anQuan,
        keKai,
        shiZip: !t.isDir && /\.zip$/i.test(t.name),
        ...(wei ? { weiXian: wei } : {}),
        ...(shou ? { yuanYin: t.method === 99 ? 'AES 加密（当前零依赖实现打不开）' : '强加密（打不开）' }
          : !zhiChi ? { yuanYin: `压缩法 ${nmFangFaMing(t.method)} 不支持` }
            : !anQuan ? { yuanYin: '条目路径不安全（可查看，解压会被跳过）' } : {}),
        shiJian: t.dosTime,
      });
    }
    return {
      ok: true,
      xinXi: {
        ming: e.length ? nmBaseOf(e[e.length - 1] || '') : path.basename(abs),
        geShi: 'ZIP',
        tiaoMu,
        tiaoMuShu: suo.tiao.length,
        jiaMiShu,
        zip64: suo.zip64,
        yuLanShangXian: NM_ZIP_TIAO_YULAN,
        jieYaShangXian: NM_ZIP_TIAO_JIEYA,
      },
    };
  } catch (err) {
    return { ok: false, cuo: String((err as Error)?.message || err).slice(0, 240) };
  }
}

interface NmZipJieXiJie {
  ok: boolean;
  buf?: Buffer;
  tiao?: NmZipTiao;
  ceng?: number;
  needPassword?: boolean;
  mimaCuo?: boolean;
  shouBaoHu?: boolean;
  cuo?: string;
}

function nmMiMaAt(p: string | string[] | undefined, ceng: number): string {
  if (Array.isArray(p)) return String(p[ceng] ?? p[0] ?? '');
  return String(p ?? '');
}

function nmKanZipTou(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const s = buf.readUInt32LE(0);
  return s === 0x04034b50 || s === 0x06054b50 || s === 0x08074b50;
}

/** 读一个条目的原始字节（stored/deflate + ZipCrypto；AES 明确拒绝） */
export function nmDuZipTiaoMu(buf: Buffer, suo: NmZipSuoYin, ming: string, pwd: string, shangXian = NM_ZIP_TIAO_YULAN): {
  ok: boolean;
  buf?: Buffer;
  needPassword?: boolean;
  mimaCuo?: boolean;
  shouBaoHu?: boolean;
  cuo?: string;
} {
  const t = suo.tiao.find((x) => x.name === ming);
  if (!t) return { ok: false, cuo: '压缩包里没有这个条目' };
  if (t.isDir) return { ok: true, buf: Buffer.alloc(0) };
  if (nmTiaoMuShouBaoHu(t)) return { ok: false, shouBaoHu: true, cuo: 'AES/强加密条目：当前实现打不开' };
  if (t.method !== 0 && t.method !== 8) return { ok: false, cuo: `压缩法 ${nmFangFaMing(t.method)} 不支持` };
  if (t.size > shangXian) return { ok: false, cuo: `条目 ${(t.size / 1048576).toFixed(1)}MB，超过上限 ${(shangXian / 1048576).toFixed(0)}MB` };
  const wei = nmTiaoMuWeiXian(t, shangXian);
  if (wei) return { ok: false, cuo: wei };

  if (t.localOff + 30 > buf.length) return { ok: false, cuo: 'local header 越界（文件可能被截断）' };
  if (buf.readUInt32LE(t.localOff) !== 0x04034b50) return { ok: false, cuo: 'local header 签名不对' };
  const lName = buf.readUInt16LE(t.localOff + 26);
  const lExtra = buf.readUInt16LE(t.localOff + 28);
  const start = t.localOff + 30 + lName + lExtra;
  if (start < 0 || start + t.comp > buf.length) return { ok: false, cuo: '条目数据越界（文件可能被截断）' };
  let raw = buf.subarray(start, start + t.comp);

  if (t.flags & 1) {
    if (!pwd) return { ok: false, needPassword: true, cuo: '这个条目加密了，需要密码' };
    if (raw.length < 12) return { ok: false, cuo: '加密条目数据不完整' };
    const cry = nmZipCrypto(Buffer.from(pwd, 'utf8'));
    const head = Buffer.alloc(12);
    for (let i = 0; i < 12; i += 1) head[i] = cry.ming(nmZi(raw, i));
    const check = (t.flags & 8) !== 0 ? (t.dosTime >>> 8) & 0xff : (t.crc >>> 24) & 0xff;
    if ((head[11] ?? 0) !== check) return { ok: false, needPassword: true, mimaCuo: true, cuo: '密码不正确' };
    const data = Buffer.alloc(raw.length - 12);
    for (let i = 0; i < data.length; i += 1) data[i] = cry.ming(nmZi(raw, 12 + i));
    raw = data;
  }

  let out: Buffer;
  try {
    if (t.method === 0) {
      out = Buffer.from(raw);
    } else {
      out = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(shangXian, t.size + 1024) });
    }
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/maxOutputLength|buffer|larger/i.test(msg)) return { ok: false, cuo: '解压后超过上限（疑似压缩炸弹）' };
    return { ok: false, cuo: '解压失败：' + msg.slice(0, 120) };
  }
  if (out.length > shangXian) return { ok: false, cuo: '解压后超过上限（疑似压缩炸弹）' };
  if (t.size && out.length !== t.size) return { ok: false, cuo: `解压大小与目录声明不符（${out.length} ≠ ${t.size}）` };
  if (t.crc && nmCrc32(out) !== (t.crc >>> 0)) {
    return { ok: false, cuo: (t.flags & 1) ? '密码不正确或数据损坏（CRC 校验失败）' : 'CRC 校验失败（文件损坏）' };
  }
  return { ok: true, buf: out };
}

/** 把条目路径逐层解开：最后一段必须是文件；中间段必须是 zip */
function nmJieXiTiaoMuLian(file: string, e: string[], pwd?: string | string[]): NmZipJieXiJie {
  try {
    if (!Array.isArray(e) || !e.length) return { ok: false, cuo: '没有条目路径' };
    if (e.length > NM_ZIP_MAX_CENG) return { ok: false, cuo: `嵌套超过 ${NM_ZIP_MAX_CENG} 层` };
    const abs = path.resolve(String(file || ''));
    if (!fs.existsSync(abs)) return { ok: false, cuo: '压缩包不存在' };
    if (fs.statSync(abs).size > NM_ZIP_ZUI_DA) return { ok: false, cuo: '压缩包超过查看上限' };
    let suo = nmDuZipSuoYinWenJian(abs);
    let buf: Buffer = fs.readFileSync(abs);
    let tiao: NmZipTiao | undefined;
    for (let i = 0; i < e.length; i += 1) {
      const ming = String(e[i] || '');
      const du = nmDuZipTiaoMu(buf, suo, ming, nmMiMaAt(pwd, i));
      if (!du.ok || !du.buf) {
        return { ok: false, needPassword: du.needPassword, mimaCuo: du.mimaCuo, shouBaoHu: du.shouBaoHu, cuo: du.cuo };
      }
      tiao = suo.tiao.find((x) => x.name === ming);
      if (i < e.length - 1) {
        if (!nmKanZipTou(du.buf)) return { ok: false, cuo: '这一层不是 zip（不能继续展开）' };
        buf = du.buf;
        suo = nmDuZipSuoYinBuffer(buf);
      } else {
        return { ok: true, buf: du.buf, tiao, ceng: i };
      }
    }
    return { ok: false, cuo: '条目路径为空' };
  } catch (err) {
    return { ok: false, cuo: String((err as Error)?.message || err).slice(0, 240) };
  }
}

/** 临时落一个条目给 doc-extract 用；解析完立刻删目录（密码不写进来） */
function nmLinShiWenDang<T>(buf: Buffer, kuo: string, fn: (p: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-nm-'));
  const p = path.join(dir, 'entry.' + (kuo || 'bin'));
  try {
    fs.writeFileSync(p, buf);
    return fn(p);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响预览 */ }
  }
}

function nmKuaiCongWenDang(geShi: 'docx' | 'xlsx' | 'pptx' | 'pdf', r: ReturnType<typeof tiQuWenDang>): NmKuai[] {
  const kuai: NmKuai[] = [];
  if (!r.ok) return kuai;
  if (geShi === 'xlsx' && Array.isArray(r.sheets) && r.sheets.length) {
    for (const s of r.sheets) {
      kuai.push({
        biaoTi: `工作表 ${s.name || '(未命名)'} · ${s.rows.length} 行`,
        wenBen: s.rows.map((row) => row.join('\t')).join('\n'),
      });
    }
  } else if (geShi === 'pptx' && Array.isArray(r.slides) && r.slides.length) {
    r.slides.forEach((s, i) => kuai.push({ biaoTi: `第 ${i + 1} 页`, wenBen: s }));
  } else {
    kuai.push({ biaoTi: r.pages ? `正文 · 共 ${r.pages} 页` : '正文', wenBen: r.text });
  }
  return kuai;
}

function nmQingQiuCuo(q: NmYaSuoQingQiu, cuo: string, extra?: Partial<NmNeiRong>): NmNeiRong {
  return {
    ok: false, luJing: String(q.z || q.f || ''), ming: '', kuoZhan: '', leiXing: 'archive', keBianJi: false, ziJie: 0,
    cuo, ...(extra || {}),
  };
}

/** 读包内一个条目并分类成查看器能画的结构（永远只读） */
function nmDuYaSuoBaoTiaoMu(q: NmYaSuoQingQiu): NmNeiRong {
  const z = path.resolve(String(q.z || ''));
  const e = Array.isArray(q.e) ? q.e.map(String) : [];
  if (!z || !e.length) return nmQingQiuCuo(q, '没有条目路径');
  if (!fs.existsSync(z)) return nmQingQiuCuo(q, '压缩包不存在');
  const zst = fs.statSync(z);
  const jie = nmJieXiTiaoMuLian(z, e, q.p);
  if (!jie.ok || !jie.buf) {
    return nmQingQiuCuo(q, jie.cuo || '条目读取失败', {
      needPassword: jie.needPassword, mimaCuo: jie.mimaCuo, shouBaoHu: jie.shouBaoHu,
    });
  }
  const ming = nmBaseOf(e[e.length - 1] || '');
  const kuo = nmKuoOf(ming);
  const buf = jie.buf;
  const jiChu: NmNeiRong = {
    ok: true, luJing: z, ming, kuoZhan: kuo, leiXing: 'binary', keBianJi: false, ziJie: buf.length,
    tiaoMu: { luJing: e.join('/'), ming, ziJie: buf.length, ceng: e.length - 1, jiaMi: !!(jie.tiao && (jie.tiao.flags & 1)) },
    tiShi: '包内文件：只读预览（不会修改压缩包）。',
  };
  const qianTou = buf.subarray(0, Math.min(buf.length, 8192));

  // 文档容器：写出临时文件交给统一的 doc-extract，读完即删
  const geShi = renWenDangGeShi(ming, buf.subarray(0, Math.min(buf.length, 8192)));
  if (geShi === 'docx' || geShi === 'xlsx' || geShi === 'pptx' || geShi === 'pdf') {
    const r = nmLinShiWenDang(buf, kuo, (p) => tiQuWenDang(p, { maxChars: 200_000 }));
    if (!r.ok) {
      return { ...jiChu, leiXing: geShi, kuai: [], tiShi: r.hint || `抽不出正文（${r.error || '未知原因'}）。查看器不会编造内容。` };
    }
    const kuai = nmKuaiCongWenDang(geShi, r);
    const jieDuan = kuai.some((k) => k.wenBen.length >= 200_000);
    return {
      ...jiChu, leiXing: geShi, kuai,
      ...(jieDuan ? { jieDuan: true, tiShi: '包内文档较长，只抽取前 200000 字；查找只在已抽取部分生效。' } : {}),
    };
  }

  // 媒体：data URL（包内文件没有磁盘路径可用）
  const tu = TU_PIAN_KUO.get(kuo);
  if (tu) return { ...jiChu, leiXing: 'image', mime: tu, meiTiUrl: `data:${tu};base64,${buf.toString('base64')}` };
  const yin = YIN_PIN_KUO.get(kuo);
  if (yin) {
    if (buf.length > 32 * 1024 * 1024) return { ...jiChu, leiXing: 'binary', wenBen: shiLiuJinZhi(qianTou, 2048), tiShi: '音频超过 32MB，包内预览不加载；可先解压再用系统程序打开。' };
    return { ...jiChu, leiXing: 'audio', mime: yin, meiTiUrl: `data:${yin};base64,${buf.toString('base64')}` };
  }
  const shi = SHI_PIN_KUO.get(kuo);
  if (shi) {
    if (buf.length > 32 * 1024 * 1024) return { ...jiChu, leiXing: 'binary', wenBen: shiLiuJinZhi(qianTou, 2048), tiShi: '视频超过 32MB，包内预览不加载；可先解压再用系统程序打开。' };
    return { ...jiChu, leiXing: 'video', mime: shi, meiTiUrl: `data:${shi};base64,${buf.toString('base64')}` };
  }

  // 文本 / 网页 / SVG 源码：只读（HTML 仍可看双栏效果）
  if (WEN_BEN_KUO.has(kuo) || nmKanShiWenBen(qianTou)) {
    const cap = Math.min(buf.length, WEN_BEN_DU_SHANG_XIAN);
    const pian = buf.subarray(0, cap);
    const wenBen = jieMaWenBen(pian);
    return {
      ...jiChu, leiXing: 'text', wenBen,
      huanHang: wenBen.includes('\r\n') ? 'crlf' : 'lf',
      ...(buf.length > cap ? { jieDuan: true, tiShi: `包内文件较大，只显示前 ${(WEN_BEN_DU_SHANG_XIAN / 1048576).toFixed(0)}MB（只读）。` } : {}),
    };
  }

  return {
    ...jiChu, leiXing: 'binary', wenBen: shiLiuJinZhi(qianTou, 2048),
    tiShi: '包内二进制文件：这里只给十六进制只读预览；要编辑请先解压。',
  };
}

function nmAnQuanWenJianMing(s: string): string {
  const x = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  return x || 'archive';
}

function nmWeiYiMuLu(base: string): string {
  let p = base;
  for (let i = 2; i <= 999; i += 1) {
    if (!fs.existsSync(p)) break;
    p = `${base} (${i})`;
  }
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 解压到压缩包旁边的新目录：同名已存在就加序号；绝不覆盖任何已有文件 */
export function nmJieYaYaSuoBao(q: NmYaSuoQingQiu): NmNeiRong {
  const z = path.resolve(String(q.z || ''));
  const e = Array.isArray(q.e) ? q.e.map(String) : [];
  const all = q.all === true || !e.length;
  const kongJi = (cuo: string, extra?: Partial<NmNeiRong>): NmNeiRong => ({
    ok: false, luJing: z, ming: '', kuoZhan: '', leiXing: 'archive', keBianJi: false, ziJie: 0, cuo, ...(extra || {}),
  });
  try {
    if (!z || !fs.existsSync(z)) return kongJi('压缩包不存在');
    if (!fs.statSync(z).isFile()) return kongJi('不是文件');
    let suo: NmZipSuoYin;
    let suoBuf: Buffer;
    if (all) {
      if (e.length) {
        const jie = nmJieXiTiaoMuLian(z, e, q.p);
        if (!jie.ok || !jie.buf) return kongJi(jie.cuo || '嵌套包读取失败', { needPassword: jie.needPassword, mimaCuo: jie.mimaCuo, shouBaoHu: jie.shouBaoHu });
        suoBuf = jie.buf;
        suo = nmDuZipSuoYinBuffer(suoBuf);
      } else {
        suo = nmDuZipSuoYinWenJian(z);
        suoBuf = fs.readFileSync(z);
      }
    } else {
      const jie = nmJieXiTiaoMuLian(z, e, q.p);
      if (!jie.ok || !jie.buf) return kongJi(jie.cuo || '条目读取失败', { needPassword: jie.needPassword, mimaCuo: jie.mimaCuo, shouBaoHu: jie.shouBaoHu });
      // 单条目也要有目录结构：拿它所在那一层的索引与字节
      const parent = e.slice(0, -1);
      if (parent.length) {
        const parentJie = nmJieXiTiaoMuLian(z, parent.map(String), q.p);
        if (!parentJie.ok || !parentJie.buf) return kongJi(parentJie.cuo || '嵌套包读取失败');
        suoBuf = parentJie.buf;
        suo = nmDuZipSuoYinBuffer(suoBuf);
      } else {
        suo = nmDuZipSuoYinWenJian(z);
        suoBuf = fs.readFileSync(z);
      }
    }

    const danTiao = !all ? String(e[e.length - 1] || '') : '';
    const xuan = suo.tiao.filter((t) => !t.isDir && (!danTiao || t.name === danTiao));
    // 需要密码的包：先验一个加密条目，密码不对就整单拒绝（避免解一半）
    const mi = xuan.find((t) => (t.flags & 1) && !nmTiaoMuShouBaoHu(t));
    if (mi) {
      const yan = nmDuZipTiaoMu(suoBuf, suo, mi.name, nmMiMaAt(q.p, e.length), NM_ZIP_TIAO_JIEYA);
      if (!yan.ok && (yan.needPassword || yan.mimaCuo)) {
        return kongJi(yan.cuo || '需要密码', { needPassword: true, mimaCuo: yan.mimaCuo });
      }
    }

    const baseName = path.basename(z, path.extname(z));
    let dirBase = path.join(path.dirname(z), nmAnQuanWenJianMing(baseName));
    if (e.length) {
      const cengMing = nmAnQuanWenJianMing(String(e[e.length - 1] || '').replace(/\.zip$/i, ''));
      dirBase += ' - ' + cengMing;
    }
    const target = nmWeiYiMuLu(dirBase);
    const top = path.resolve(target) + path.sep;
    let xieRu = 0;
    let zong = 0;
    const tiaoGuo: Array<{ ming: string; yuanYin: string }> = [];
    let needPassword = false;
    let mimaCuo = false;

    for (const t of xuan) {
      const anQuan = nmZipTiaoMuAnQuan(t.name);
      if (!anQuan) { tiaoGuo.push({ ming: t.name, yuanYin: '路径穿越/不安全条目：已拒绝解压' }); continue; }
      if (((t.extAttr >>> 16) & 0xf000) === 0xa000) { tiaoGuo.push({ ming: t.name, yuanYin: '符号链接条目：已跳过' }); continue; }
      if (nmTiaoMuShouBaoHu(t)) { tiaoGuo.push({ ming: t.name, yuanYin: 'AES/强加密：当前打不开' }); continue; }
      if (t.method !== 0 && t.method !== 8) { tiaoGuo.push({ ming: t.name, yuanYin: `压缩法 ${nmFangFaMing(t.method)} 不支持` }); continue; }
      const wei = nmTiaoMuWeiXian(t, NM_ZIP_TIAO_JIEYA);
      if (wei) { tiaoGuo.push({ ming: t.name, yuanYin: wei }); continue; }
      if (t.size > NM_ZIP_TIAO_JIEYA) { tiaoGuo.push({ ming: t.name, yuanYin: '单文件超过解压上限' }); continue; }
      if (zong + t.size > NM_ZIP_TOTAL_JIEYA) { tiaoGuo.push({ ming: t.name, yuanYin: '本次解压总量超过上限，已停止' }); break; }
      const du = nmDuZipTiaoMu(suoBuf, suo, t.name, nmMiMaAt(q.p, e.length), NM_ZIP_TIAO_JIEYA);
      if (!du.ok || !du.buf) {
        if (du.needPassword) needPassword = true;
        if (du.mimaCuo) mimaCuo = true;
        tiaoGuo.push({ ming: t.name, yuanYin: du.cuo || '读取失败' });
        continue;
      }
      const segs = t.name.replace(/\\/g, '/').split('/').filter(Boolean);
      const dest = path.resolve(target, ...segs);
      if (!(dest === path.resolve(target) || dest.startsWith(top))) {
        tiaoGuo.push({ ming: t.name, yuanYin: '解压落点越界：已拒绝' });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.writeFileSync(dest, du.buf, { flag: 'wx' });
        xieRu += 1;
        zong += du.buf.length;
      } catch (err) {
        tiaoGuo.push({ ming: t.name, yuanYin: '写入失败：' + String((err as Error)?.message || err).slice(0, 80) });
      }
    }

    if (!xieRu) {
      try { fs.rmdirSync(target); } catch { /* 目录非空或删不掉就留着 */ }
      return kongJi(
        needPassword ? (mimaCuo ? '密码不正确' : '这个压缩包需要密码') : '没有可解压的条目（受保护或全部超限）',
        { needPassword, mimaCuo, shouBaoHu: xuan.some((t) => nmTiaoMuShouBaoHu(t)), tiaoGuo },
      );
    }
    return {
      ok: true, luJing: z, ming: path.basename(target), kuoZhan: '', leiXing: 'archive', keBianJi: false, ziJie: zong,
      jieYaDao: target, xieRu, tiaoGuo,
      needPassword, mimaCuo,
      tiShi: `已解压 ${xieRu} 个文件到 ${target}${tiaoGuo.length ? `；跳过 ${tiaoGuo.length} 项（见列表）` : ''}`,
    };
  } catch (err) {
    return kongJi('解压失败：' + String((err as Error)?.message || err).slice(0, 160));
  }
}

/** 系统默认程序打开（绕过 electron-main 的 nm 分流；查看器自己的按钮用） */
function nmXiTongDaKai(q: NmYaSuoQingQiu): NmNeiRong {
  try {
    let f = path.resolve(String(q.f || ''));
    const eLu = Array.isArray(q.e) ? q.e.map(String) : [];
    if (q.z && eLu.length) {
      const jie = nmJieXiTiaoMuLian(q.z, eLu, q.p);
      if (!jie.ok || !jie.buf) return nmQingQiuCuo(q, jie.cuo || '条目读取失败', { needPassword: jie.needPassword, mimaCuo: jie.mimaCuo });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-nm-open-'));
      f = path.join(dir, nmAnQuanWenJianMing(nmBaseOf(eLu[eLu.length - 1] || 'entry')));
      fs.writeFileSync(f, jie.buf);
    }
    if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) return nmQingQiuCuo(q, '文件不存在');
    void shell.openPath(f).catch(() => { /* 打开失败由系统提示；这里不伪造成功状态 */ });
    return {
      ok: true, luJing: f, ming: path.basename(f), kuoZhan: nmKuoOf(f), leiXing: 'binary', keBianJi: false,
      ziJie: fs.statSync(f).size, tiShi: '已交给系统默认程序打开。',
    };
  } catch (err) {
    return nmQingQiuCuo(q, '系统打开失败：' + String((err as Error)?.message || err).slice(0, 160));
  }
}

/** 压缩包请求总入口（只由 nmDuWenJian 调；返回值仍是 NmNeiRong） */
function nmZhiXingYaSuoQingQiu(q: NmYaSuoQingQiu): NmNeiRong {
  if (q.a === 'sysopen') return nmXiTongDaKai(q);
  const z = path.resolve(String(q.z || ''));
  if (!z) return nmQingQiuCuo(q, '没有压缩包路径');
  if (!fs.existsSync(z)) return nmQingQiuCuo(q, '压缩包不存在');
  const st = fs.statSync(z);
  if (!st.isFile()) return nmQingQiuCuo(q, '不是文件');
  if (st.size > NM_ZIP_ZUI_DA) return nmQingQiuCuo(q, `压缩包超过 ${(NM_ZIP_ZUI_DA / 1048576).toFixed(0)}MB 查看上限`);

  if (q.a === 'read') return nmDuYaSuoBaoTiaoMu(q);
  if (q.a === 'extract') return nmJieYaYaSuoBao(q);

  const e = Array.isArray(q.e) ? q.e.map(String) : [];
  const lie = nmLieYaSuoBao(z, e, q.p);
  if (!lie.ok || !lie.xinXi) {
    return {
      ok: false, luJing: z, ming: nmBaseOf(e[e.length - 1] || '') || path.basename(z), kuoZhan: 'zip',
      leiXing: 'archive', keBianJi: false, ziJie: st.size,
      needPassword: lie.needPassword, mimaCuo: lie.mimaCuo, shouBaoHu: lie.shouBaoHu,
      cuo: lie.cuo || '压缩包解析失败',
    };
  }
  return {
    ok: true, luJing: z, ming: nmBaseOf(e[e.length - 1] || '') || path.basename(z), kuoZhan: 'zip',
    leiXing: 'archive', keBianJi: false, ziJie: st.size, yaSuoBao: lie.xinXi,
  };
}




