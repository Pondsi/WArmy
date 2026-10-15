/**
 * work-tools —— 让「我的牛马」「项目」里的 AI **真的能干活**（写文件、读文件、列目录）。
 *
 * 为什么必须有这个模块
 * ---------------------------------------------------------------------------
 * 实测缺陷：聊天路径只暴露了记忆工具（`memoryToolSpecs` = recall/retrieve），
 * 没有任何文件类工具 ⇒ 模型被要求「帮我写个 txt」时只能回答「我做不到」。
 * 产品定稿：**我的牛马 / 项目**里的 AI 必须能干活；**群聊**里的牛马只聊天。
 *
 * 安全边界（硬约束，不靠调用方自觉）
 * ---------------------------------------------------------------------------
 *  1. **工作区沙箱**：所有路径先 `path.resolve` 再校验必须落在 base 目录内；
 *     绝对路径、`..` 逃逸、NUL 字节一律拒绝（fail-closed，不做"尽力而为"）。
 *  2. **有界**：读单次上限、写单次上限；超限拒写而不是截断（截断会静默毁文件）。
 *  3. **可审计**：每次调用返回结构化 meta（tool/ok/bytes/path），由调用方写审计。
 *  4. **不做提权、不跑 shell**：本模块只碰文件；执行命令属于另一层权限模型，故意不在这里。
 *
 * 本模块是**纯 node**（不依赖 electron），因此可以被验证脚本在无头环境直接断言。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shengChengDocx, shengChengPptx, keYongPptx, shengChengXlsx } from './office-tools.js';
import { shengChengPdf } from './pdf-tools.js';
import { lieYaSuoBaoTiaoMu, duYaSuoBaoTiaoMu, tiaoMuMingAnQuan } from './zip-look.js';

/** 工具名（与 function calling 暴露给模型的 name 一致） */
export const WORK_TOOL_NAMES = [
  'list_dir', 'find_files', 'search_files', 'read_file', 'write_file', 'edit_file',
  'copy_file', 'move_file', 'make_dir', 'make_docx', 'make_pptx', 'make_xlsx', 'make_pdf',
  'list_archive', 'read_archive_entry',
] as const;
export type WorkToolName = (typeof WORK_TOOL_NAMES)[number];

export function isWorkTool(name: unknown): name is WorkToolName {
  return typeof name === 'string' && (WORK_TOOL_NAMES as readonly string[]).includes(name);
}

/** 结构性上限（与上下文预算同量级，避免一次读回把视图撑破） */
export const WORK_TOOL_LIMITS = {
  /** 单次读取返回的字符上限 */
  maxReadChars: 20000,
  /** 单次写入的内容字节上限（超限**拒绝**，不截断） */
  maxWriteBytes: 2 * 1024 * 1024,
  /** 列目录最多返回多少条 */
  maxListEntries: 500,
} as const;

export const WORK_TOOL_SECURITY = {
  /** 唯一入口是 (baseDir, tool 枚举, 结构化参数) —— 没有"命令行字符串"这个参数 */
  argvFromUntrustedSource: false,
  /** 是否允许逃出工作区 */
  allowsWorkspaceEscape: false,
  /** 是否执行 shell 命令 */
  runsShell: false,
  /** 是否提权 */
  elevates: false,
  /** 越界时是拒绝还是"尽力而为" */
  failClosed: true,
} as const;

export interface WorkToolEntry {
  /** 相对 base 的路径（展示用） */
  rel: string;
  /** 'file' | 'dir' */
  kind: 'file' | 'dir';
  bytes: number;
}

export interface WorkToolResult {
  ok: boolean;
  /** 回给模型的文本（永远不抛错） */
  content: string;
  meta: {
    tool: string;
    ok: boolean;
    bytes: number;
    /** 命中的相对路径（失败时为尝试的路径） */
    path?: string;
    /** 真实绝对路径（写文件时给，避免"Desktop/…"被误认成系统桌面） */
    abs?: string;
    error?: string;
    truncated?: boolean;
    entries?: number;
    /** write_file：写了多少**字符**（用户问"是不是真的写了 N 字"要看它） */
    chars?: number;
    /** write_file：写完自检，文件真的在不在 */
    exists?: boolean;
    /** read_archive_entry：读的是压缩包里的哪一条 */
    entry?: string;
    /** make_pdf：内嵌用的字体路径 */
    font?: string;
    /** make_pdf：字体里缺字形、渲染为空白的字符（如实上报） */
    missing?: string[];
  };
}

/**
 * 「用户文件夹」别名 → **系统真实路径**。
 *
 * 真事故：模型听到「在桌面生成一个 txt」，就写 `Desktop/xxx.txt`；
 * 这是**相对路径**，被静默解析成 `<userData>/workspace/<会话>/Desktop/xxx.txt` ——
 * 根本不是系统桌面，模型却以为成功了（返回文案还写「已写入 Desktop/…」）。
 *
 * 现在：`Desktop/桌面/Documents/文档/Downloads/下载/~/…` 一律映射到真实用户目录，
 * 于是它变成绝对路径 → 走既有越权流程（普通授权下弹卡让用户批准；完全授权直接放行）。
 * 想写工作区里的同名子目录，请显式用 `./Desktop/…`。
 */
export function yingSheYongHuWenJianJia(raw: string): { abs: string; rest: string } | null {
  const s0 = String(raw || '').trim().replace(/\\/g, '/');
  if (!s0 || s0.includes('\0')) return null;
  const home = os.homedir();
  const tiao = (zhong: string): string => {
    const cun = path.join(home, zhong);
    return fs.existsSync(cun) ? cun : '';
  };
  // 中文 Windows 的桌面/文档/下载可能是中文名；哪个存在用哪个（都不存在就用英文惯例名）
  const zhuoMian = tiao('Desktop') || tiao('桌面') || path.join(home, 'Desktop');
  const wenDang = tiao('Documents') || tiao('文档') || path.join(home, 'Documents');
  const xiaZai = tiao('Downloads') || tiao('下载') || path.join(home, 'Downloads');
  const biao: Array<[RegExp, string]> = [
    [/^(?:~\/)?(?:Desktop|桌面)\/?(.*)$/i, zhuoMian],
    [/^(?:~\/)?(?:Documents|文档)\/?(.*)$/i, wenDang],
    [/^(?:~\/)?(?:Downloads|下载)\/?(.*)$/i, xiaZai],
    [/^(?:~|%USERPROFILE%)\/?$/i, home],
    [/^(?:~|%USERPROFILE%)\/(.*)$/i, home],
  ];
  for (const [re, dir] of biao) {
    const m = re.exec(s0);
    if (m) return { abs: dir, rest: m[1] || '' };
  }
  return null;
}

/**
 * **一次性只读授权**（产品要求）：用户在聊天里添加的文件 = 允许 AI **本次**读取的路径，
 * 不含「允许编辑」。授权只覆盖**读取类**工具，并在本轮结束后立刻清空。
 *
 * 为什么需要：附件常常在工作区外（桌面/下载/其它目录），没有这条白名单，
 * 模型一 read_file 就被 `workspace-escape` 挡住 —— 用户明明把文件递过来了。
 */
let yiCiZhiDuGen: string[] = [];
export function sheZhiYiCiZhiDuGen(paths: Array<string | undefined | null>): void {
  yiCiZhiDuGen = (paths || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map((p) => { try { return path.resolve(p); } catch { return ''; } })
    .filter(Boolean);
}
export function qingKongYiCiZhiDuGen(): void { yiCiZhiDuGen = []; }
export function yiCiZhiDuGenLieBiao(): string[] { return yiCiZhiDuGen.slice(); }
/** 这个绝对路径是否落在一次性只读授权里（它就是被授权的文件，或在其被授权的目录下） */
function zaiYiCiZhiDuNei(abs: string): boolean {
  const a = path.resolve(abs);
  for (const gen of yiCiZhiDuGen) {
    if (a === gen) return true;
    if (a.startsWith(gen + path.sep)) return true;
  }
  return false;
}

/**
 * 把一个"用户/模型给的相对路径"解析成 base 内的绝对路径。
 * 任何越界、绝对路径、非法字符都抛 `workspace-escape`（调用方转成文本回给模型）。
 *
 * @param zuoYong 'read' = 读取类工具，可命中一次性只读授权；'write'（默认）不行。
 */
export function resolveInside(baseDir: string, rel: unknown, kuaiQuan = false, zuoYong: 'read' | 'write' = 'write'): string {
  const raw = String(rel ?? '').trim();
  if (!raw) throw new Error('empty-path');
  if (raw.includes('\0')) throw new Error('nul-byte');
  /**
   * 系统用户文件夹别名（Desktop/桌面/…）⇒ 真实路径（绝对）。
   * 走下面同一套越权判定：普通授权下它在工作区外 ⇒ 如实拒绝/问用户。
   * 显式 `./Desktop/…` 才表示工作区里的同名子目录。
   */
  if (!raw.startsWith('./') && !raw.startsWith('.\\')) {
    const jt = yingSheYongHuWenJianJia(raw);
    if (jt) {
      const zhen = jt.rest ? path.resolve(jt.abs, jt.rest) : path.resolve(jt.abs);
      if (kuaiQuan) return zhen;
      if (zuoYong === 'read' && zaiYiCiZhiDuNei(zhen)) return zhen;
      throw new Error('absolute-path-not-allowed: ' + raw + ' 映射到系统目录 ' + zhen + '（在工作区外，需要授权）');
    }
  }
  /**
   * **完全授权**（用户显式选的）：允许绝对路径、允许工作区外 —— 此时 AI 可以直接操作本机。
   * 但仍然不许 NUL、不许空路径；且"做什么"始终受最高信念/戒律约束（策略层，不在这里）。
   */
  if (kuaiQuan) return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(path.resolve(baseDir), raw);
  // Windows 盘符 / UNC / POSIX 绝对路径：默认拒绝 —— 但命中「一次性只读授权」且是读取操作时放行
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
    const absJue = path.resolve(raw);
    if (zuoYong === 'read' && zaiYiCiZhiDuNei(absJue)) return absJue;
    throw new Error('absolute-path-not-allowed');
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(base, raw);
  if (target !== base && !target.startsWith(base + path.sep)) {
    if (zuoYong === 'read' && zaiYiCiZhiDuNei(target)) return target;
    throw new Error('workspace-escape');
  }
  return target;
}

/** 展示用：把绝对路径折回 base 相对路径（失败则原样返回） */
export function relOf(baseDir: string, abs: string): string {
  try {
    const r = path.relative(path.resolve(baseDir), abs);
    return r && !r.startsWith('..') ? r.split(path.sep).join('/') : abs;
  } catch {
    return abs;
  }
}

function fail(tool: string, err: unknown, p?: string): WorkToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, content: `[${tool}] 失败：${msg}`, meta: { tool, ok: false, bytes: 0, ...(p ? { path: p } : {}), error: msg } };
}

/** 列目录 */
export function workListDir(baseDir: string, args: { path?: string }, kuaiQuan = false): WorkToolResult {
  const tool = 'list_dir';
  try {
    const dir = resolveInside(baseDir, args && args.path ? args.path : '.', kuaiQuan, 'read');
    if (!fs.existsSync(dir)) return fail(tool, new Error('not-found'), relOf(baseDir, dir));
    if (!fs.statSync(dir).isDirectory()) return fail(tool, new Error('not-a-directory'), relOf(baseDir, dir));
    const names = fs.readdirSync(dir).slice(0, WORK_TOOL_LIMITS.maxListEntries);
    const entries: WorkToolEntry[] = names.map((n) => {
      const p = path.join(dir, n);
      let kind: 'file' | 'dir' = 'file';
      let bytes = 0;
      try {
        const st = fs.statSync(p);
        kind = st.isDirectory() ? 'dir' : 'file';
        bytes = st.isDirectory() ? 0 : st.size;
      } catch {
        /* 断链/权限：按文件如实记 0 字节 */
      }
      return { rel: relOf(baseDir, p), kind, bytes };
    });
    const lines = entries.map((e) => `${e.kind === 'dir' ? '[dir] ' : '      '}${e.rel}${e.kind === 'file' ? `  (${e.bytes} B)` : ''}`);
    return {
      ok: true,
      content: lines.length ? lines.join('\n') : '(空目录)',
      meta: { tool, ok: true, bytes: lines.join('\n').length, path: relOf(baseDir, dir), entries: entries.length },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 把简单 glob（`*` / `?` / `**`）变成正则；只匹配规范化后的 `/` 路径。 */
function globZhengZe(pattern: string): RegExp {
  const p = String(pattern || '**/*').replace(/\\/g, '/');
  let out = '^';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c && /[\\^$.*+?()[\]{}|]/.test(c) ? '\\' + c : c;
  }
  return new RegExp(out + '$', 'i');
}

/** 递归找文件（不跟随符号链接，防止逃出工作区）。 */
export function workFindFiles(baseDir: string, args: { path?: string; pattern?: string; maxResults?: number }, kuaiQuan = false): WorkToolResult {
  const tool = 'find_files';
  try {
    const root = resolveInside(baseDir, args.path || '.', kuaiQuan, 'read');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return fail(tool, new Error('not-a-directory'), relOf(baseDir, root));
    const re = globZhengZe(args.pattern || '**/*');
    const cap = Math.max(1, Math.min(Number(args.maxResults) || 200, 1000));
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= cap) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= cap) break;
        const abs = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) {
          const rel = relOf(root, abs).replace(/\\/g, '/');
          if (re.test(rel)) out.push(relOf(baseDir, abs));
        }
      }
    };
    walk(root);
    return { ok: true, content: out.length ? out.join('\n') : '(没有匹配文件)', meta: { tool, ok: true, bytes: out.join('\n').length, path: relOf(baseDir, root), entries: out.length, truncated: out.length >= cap } };
  } catch (e) { return fail(tool, e); }
}

/** 跨文件内容搜索；默认按字面量，regex=true 时使用 ECMAScript 正则。 */
export function workSearchFiles(baseDir: string, args: { path?: string; query?: string; pattern?: string; regex?: boolean; maxResults?: number }, kuaiQuan = false): WorkToolResult {
  const tool = 'search_files';
  try {
    const query = String(args.query || '');
    if (!query) return fail(tool, new Error('query-required'));
    const root = resolveInside(baseDir, args.path || '.', kuaiQuan, 'read');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return fail(tool, new Error('not-a-directory'), relOf(baseDir, root));
    const fileRe = globZhengZe(args.pattern || '**/*');
    const hitRe = args.regex ? new RegExp(query, 'i') : null;
    const cap = Math.max(1, Math.min(Number(args.maxResults) || 100, 500));
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= cap) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= cap) break;
        const abs = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) { walk(abs); continue; }
        if (!ent.isFile() || !fileRe.test(relOf(root, abs).replace(/\\/g, '/'))) continue;
        const st = fs.statSync(abs);
        if (st.size > 2 * 1024 * 1024) continue;
        let text = '';
        try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
        if (text.includes('\0')) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < cap; i++) {
          const line = lines[i] || '';
          if (hitRe ? (hitRe.lastIndex = 0, hitRe.test(line)) : line.toLowerCase().includes(query.toLowerCase())) {
            out.push(`${relOf(baseDir, abs)}:${i + 1}: ${line.slice(0, 300)}`);
          }
        }
      }
    };
    walk(root);
    return { ok: true, content: out.length ? out.join('\n') : '(没有匹配内容)', meta: { tool, ok: true, bytes: out.join('\n').length, path: relOf(baseDir, root), entries: out.length, truncated: out.length >= cap } };
  } catch (e) { return fail(tool, e); }
}

/** 精确局部编辑：默认要求 oldText 只出现一次；replaceAll=true 才替换全部。 */
export function workEditFile(baseDir: string, args: { path?: string; oldText?: string; newText?: string; replaceAll?: boolean }, kuaiQuan = false): WorkToolResult {
  const tool = 'edit_file';
  try {
    const file = resolveInside(baseDir, args.path, kuaiQuan, 'write');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(tool, new Error('not-a-file'), relOf(baseDir, file));
    const oldText = String(args.oldText ?? '');
    const newText = String(args.newText ?? '');
    if (!oldText) return fail(tool, new Error('oldText-required'), relOf(baseDir, file));
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(oldText).length - 1;
    if (!count) return fail(tool, new Error('oldText-not-found'), relOf(baseDir, file));
    if (!args.replaceAll && count !== 1) return fail(tool, new Error(`oldText-not-unique (${count} matches); provide more context or set replaceAll=true`), relOf(baseDir, file));
    const next = args.replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText);
    fs.writeFileSync(file, next, 'utf8');
    return { ok: true, content: `[edit_file] 已修改 ${relOf(baseDir, file)}（替换 ${args.replaceAll ? count : 1} 处）`, meta: { tool, ok: true, bytes: Buffer.byteLength(next), chars: [...next].length, path: relOf(baseDir, file), abs: file, exists: true } };
  } catch (e) { return fail(tool, e); }
}

/** 复制文件（仅文件；默认不覆盖）。 */
export function workCopyFile(baseDir: string, args: { path?: string; destination?: string; overwrite?: boolean }, kuaiQuan = false): WorkToolResult {
  const tool = 'copy_file';
  try {
    const src = resolveInside(baseDir, args.path, kuaiQuan, 'read');
    const dst = resolveInside(baseDir, args.destination, kuaiQuan, 'write');
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return fail(tool, new Error('source-not-a-file'), relOf(baseDir, src));
    if (fs.existsSync(dst) && !args.overwrite) return fail(tool, new Error('destination-exists'), relOf(baseDir, dst));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return { ok: true, content: `[copy_file] 已复制到 ${dst}`, meta: { tool, ok: true, bytes: fs.statSync(dst).size, path: relOf(baseDir, dst), abs: dst, exists: true } };
  } catch (e) { return fail(tool, e); }
}

/** 移动/重命名文件（仅工作区内，默认不覆盖）。 */
export function workMoveFile(baseDir: string, args: { path?: string; destination?: string; overwrite?: boolean }, kuaiQuan = false): WorkToolResult {
  const tool = 'move_file';
  try {
    const src = resolveInside(baseDir, args.path, kuaiQuan, 'write');
    const dst = resolveInside(baseDir, args.destination, kuaiQuan, 'write');
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return fail(tool, new Error('source-not-a-file'), relOf(baseDir, src));
    if (fs.existsSync(dst)) {
      if (!args.overwrite) return fail(tool, new Error('destination-exists'), relOf(baseDir, dst));
      fs.unlinkSync(dst);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true, content: `[move_file] 已移动到 ${dst}`, meta: { tool, ok: true, bytes: fs.statSync(dst).size, path: relOf(baseDir, dst), abs: dst, exists: true } };
  } catch (e) { return fail(tool, e); }
}

/** 读文件 */
export function workReadFile(baseDir: string, args: { path?: string; maxChars?: number }, kuaiQuan = false): WorkToolResult {
  const tool = 'read_file';
  try {
    let file = resolveInside(baseDir, args && args.path, kuaiQuan, 'read');
    /**
     * **回落解析**（真机事故：模型 `read_file` 读截图报 not-found）。
     *
     * 附件清单里给的是「工作区根」相对路径（`inst-xxx/shot-1.png`），而 `baseDir`
     * 已经是**会话工作区**（`…/workspace/inst-xxx`）⇒ 拼成了
     * `…/workspace/inst-xxx/inst-xxx/shot-1.png`（会话 id 叠了两遍）⇒ 必然找不到。
     * 修法：原路径不存在时，再试「相对工作区根」一次（仍限制在工作区根内）。
     */
    if (!fs.existsSync(file)) {
      const raw = String((args && args.path) || '').trim();
      if (raw && !path.isAbsolute(raw)) {
        const root = path.resolve(baseDir, '..');
        const shang = path.resolve(root, raw);
        if (shang !== root && shang.startsWith(root + path.sep) && fs.existsSync(shang)) {
          file = shang;
        }
      }
    }
    if (!fs.existsSync(file)) return fail(tool, new Error('not-found'), relOf(baseDir, file));
    if (fs.statSync(file).isDirectory()) return fail(tool, new Error('is-a-directory'), relOf(baseDir, file));
    const cap = Math.max(1, Math.min(Number(args?.maxChars) || WORK_TOOL_LIMITS.maxReadChars, WORK_TOOL_LIMITS.maxReadChars));
    const buf = fs.readFileSync(file);
    /**
     * **`.nm` 包内置查看**（产品要求：AI 要能直接读 .nm 了解内容）。
     * 明文包（项目/聊天导出）直接解开给结构化内容；加密包如实说「要口令」，
     * 不假装读到了。
     */
    if (/\.nm$/i.test(file)) {
      const raw = buf.toString('utf8');
      let zhaiYao = '';
      try {
        const xin = JSON.parse(raw) as { kind?: string; createdAt?: number; meta?: Record<string, unknown>; data?: string };
        const shiMingWen = String(xin.data || '').startsWith('plain.');
        zhaiYao += `[.nm 包] 类型=${xin.kind || '?'} 导出于=${xin.createdAt ? new Date(xin.createdAt).toLocaleString() : '?'}\n`;
        if (xin.meta && typeof xin.meta === 'object') zhaiYao += `元信息：${JSON.stringify(xin.meta)}\n`;
        if (!shiMingWen) {
          zhaiYao += '这是**加密包**，需要口令才能解开内容（可以让用户在界面上导入，或让用户告知口令后用 nmYueDu 通道读）。\n';
          return { ok: true, content: zhaiYao, meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), truncated: false } };
        }
        const payload = JSON.parse(Buffer.from(String(xin.data).slice(6), 'base64').toString('utf8')) as Record<string, unknown>;
        zhaiYao += `内容键：${Object.keys(payload).join('、')}\n`;
        if (Array.isArray(payload.chat)) zhaiYao += `聊天记录：${(payload.chat as unknown[]).length} 条\n`;
        if (Array.isArray(payload.files)) zhaiYao += `工作区文件：${(payload.files as unknown[]).length} 个\n`;
        if (Array.isArray(payload.plans)) zhaiYao += `计划步骤：${(payload.plans as unknown[]).length} 步\n`;
        if (typeof payload.memory === 'string' && payload.memory) zhaiYao += `\n【项目 MEMORY】\n${String(payload.memory).slice(0, 2000)}\n`;
        if (Array.isArray(payload.chat)) {
          zhaiYao += '\n【聊天记录】\n';
          for (const c of (payload.chat as Array<{ role?: string; content?: string }>)) {
            zhaiYao += `(${c.role || '?'}) ${String(c.content || '').slice(0, 300)}\n`;
          }
        }
        if (Array.isArray(payload.files)) {
          zhaiYao += '\n【工作区文件】\n';
          for (const f of (payload.files as Array<{ path?: string; bytes?: number; inline?: string }>)) {
            zhaiYao += `- ${f.path || '?'} (${f.bytes || 0}B)` + (f.inline ? `\n  内容：${String(f.inline).slice(0, 500)}` : '') + '\n';
          }
        }
      } catch (e) {
        zhaiYao = '[.nm 包] 解析失败：' + String((e as Error)?.message || e);
      }
      const text2 = zhaiYao.length > cap ? zhaiYao.slice(0, cap) + `\n…（已截断，原文 ${zhaiYao.length} 字符）` : zhaiYao;
      return { ok: true, content: text2, meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), truncated: zhaiYao.length > cap } };
    }
    /**
     * **图片不要用 read_file 读**（真机事故：模型把 53KB 截图当文本读回来，白白烧一轮）。
     * 图片已经作为多模态内容块直接可见（见 `llm.imagesVisible`）；真要看"这是什么文件"，
     * 这里如实给一句元信息就够了，不要倒二进制。
     */
    if (/\.(png|jpe?g|gif|webp|bmp|ico|tiff?)$/i.test(file)) {
      const zhi = fs.statSync(file);
      const shuoMing = `[read_file] 这是**图片文件**（${path.basename(file)}，${zhi.size} 字节，修改于 ${zhi.mtime.toISOString()}）。`
        + '图片内容已经**直接可见**（多模态输入），不需要再 read_file 读它；要判断图里是什么，直接看图回答即可。';
      return { ok: true, content: shuoMing, meta: { tool, ok: true, bytes: zhi.size, path: relOf(baseDir, file), truncated: false } };
    }
    // 其它二进制（字体/压缩包/可执行…）同样不倒字节：如实说类型与大小
    if (/\.(ttf|otf|ttc|woff2?|zip|7z|rar|exe|dll|so|node|pdf|mp3|wav|mp4|mov|webm|avi|mkv)$/i.test(file)) {
      const zhi = fs.statSync(file);
      return {
        ok: true,
        content: `[read_file] 这是**二进制文件**（${path.basename(file)}，${zhi.size} 字节），read_file 只读文本，不倒二进制内容。`
          + (/\.pdf$/i.test(file) ? '要读 PDF 正文请用 read_docx 同类的文档工具，或让用户导出为文本。' : '要处理它请用对应能力（看图/听音/看视频/文档工具）。'),
        meta: { tool, ok: true, bytes: zhi.size, path: relOf(baseDir, file), truncated: false },
      };
    }
    const text = buf.toString('utf8');
    const truncated = text.length > cap;
    return {
      ok: true,
      content: truncated ? text.slice(0, cap) + `\n…（已截断，原文 ${text.length} 字符）` : text,
      meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), truncated },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 写文件（必要时建父目录）；超上限**拒绝**，不截断。`append:true` = 追加到已有文件末尾（长文分段写） */
/** 会话 id 叠两遍时的回落解析（workspace/inst-x/inst-x/f → workspace/inst-x/f） */
function huiLuoHuiHuaGen(baseDir: string, raw: string, file: string): string {
  try {
    if (fs.existsSync(file)) return file;
    const r = String(raw || '').trim();
    if (!r || path.isAbsolute(r)) return file;
    const root = path.resolve(baseDir, '..');
    const shang = path.resolve(root, r);
    if (shang !== root && shang.startsWith(root + path.sep) && fs.existsSync(shang)) return shang;
    const pei = r.match(/^[^/\\]+[\\/](.+)$/);
    if (pei && pei[1]) {
      const qu = path.resolve(baseDir, pei[1]);
      if (fs.existsSync(qu)) return qu;
      /**
       * **新建文件**时也要防「会话 id 叠两遍」：raw 形如 inst-x/hello.txt，
       * baseDir 已是 …/workspace/inst-x ⇒ 再拼会变成 inst-x/inst-x/hello.txt。
       * 若前缀正好是本会话目录名，就写到去前缀的位置。
       */
      const gen = path.basename(path.resolve(baseDir));
      const qian = String(r).split(/[\\/]/)[0] || '';
      if (qian && qian === gen) return qu;
    }
    return file;
  } catch { return file; }
}

export function workWriteFile(baseDir: string, args: { path?: string; content?: string; append?: boolean }, kuaiQuan = false): WorkToolResult {
  const tool = 'write_file';
  try {
    /**
     * Office 二进制格式**不能**用纯文本 write_file 造：写出来的 `xx.pptx` 只是改后缀的文本，
     * PowerPoint 打不开（真事故：用户说"生成 ppt/word"，结果文件是假的）。
     * 如实拒绝并指向真正的生成器。
     */
    const rawP = String((args && args.path) || '');
    /**
     * **硬门禁文件不许被改**（产品定稿：硬门禁＝随产品发的验证脚本，模型不得修改/删除）。
     * 只按"仓库内 scripts/ 下的门禁脚本"这个形状拦（工作区里的同名文件不受影响）。
     */
    if (/(^|[\\/])packages[\\/]app-shell[\\/]scripts[\\/](?:verify-[\w.-]+|full-verify-rounds)\.mjs$/i.test(rawP)) {
      return fail(tool, new Error('hard-gate-immutable：' + rawP + ' 是**硬门禁**脚本（随产品一起发的验证标准），不允许被写入/覆盖。要加自己的检查请新建一个**软门禁**（设置→门禁→新增软门禁），把它放在别处。'), rawP);
    }
    if (/\.(docx|pptx|xlsx|pdf)$/i.test(rawP)) {
      return fail(tool, new Error('office-binary-need-generator：' + rawP + ' 是二进制文档格式，write_file 只写纯文本（写出来的文件 Word/PowerPoint/阅读器打不开）。请改用 make_docx（.docx）/ make_pptx（.pptx）/ make_xlsx（.xlsx）/ make_pdf（.pdf）。'), rawP);
    }
    if (/\.(doc|ppt|xls)$/i.test(rawP)) {
      return fail(tool, new Error('legacy-office-unsupported：不支持老格式 ' + rawP + '，请用 make_docx / make_pptx / make_xlsx 生成新格式。'), rawP);
    }
    let file = resolveInside(baseDir, args && args.path, kuaiQuan);
    /**
     * **会话 id 叠两遍回落**（真机：workspace/inst-x/inst-x/hello.txt 找不到时
     * Windows 会弹「找不到文件」模态框）。append 时优先复用已存在的那份。
     */
    file = huiLuoHuiHuaGen(baseDir, String((args && args.path) || ''), file);
    const content = String((args && args.content) ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > WORK_TOOL_LIMITS.maxWriteBytes) {
      return fail(tool, new Error(`content-too-large (${bytes} > ${WORK_TOOL_LIMITS.maxWriteBytes} bytes)`), relOf(baseDir, file));
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    /**
     * **长文分段追加**（产品要求：一次写 5000+ 字要能真写完）。
     * 一次 `write_file` 塞整篇长文时，小模型往往写到一半就截断（真机事故：
     * 4B 模型一次写 5000 字 → 空回复 / 只落一个开头）。正确做法是业界通行的
     * "分段写 + 追加"：第一段用 `append:false` 建文件，后续每次带 `append:true` 续写，
     * 每次只写一段（几百到一千字），写完一段再写下一段。
     */
    const zhuiJia = (args as { append?: unknown }).append === true && fs.existsSync(file);
    if (zhuiJia) fs.appendFileSync(file, content, 'utf8');
    else fs.writeFileSync(file, content, 'utf8');
    /**
     * **写完自检**（真机事故：牛马说"写好了 6000 字小说《无声的齿轮》"，用户却找不到文件）。
     * 成功响应必须：① 真的存在（`existsSync`）② 字节数与字符数都报 ③ **绝对路径**写清楚，
     * 并明确要求模型把这条路径**原样告诉用户**（否则用户只能在工作区里翻）。
     */
    const cun = fs.existsSync(file);
    let zongBytes = bytes;
    let zongZi = [...content].length;
    try {
      const zhen = fs.readFileSync(file, 'utf8');
      zongBytes = Buffer.byteLength(zhen, 'utf8');
      zongZi = [...zhen].length;
    } catch { /* 读不回来就只报本次的 */ }
    return {
      ok: cun,
      content: `${zhuiJia ? '已追加写入' : '已写入'} ${file}（本次 ${bytes} 字节 / ${[...content].length} 字符；文件当前共 ${zongBytes} 字节 / ${zongZi} 字符）${cun ? '，文件已自检存在' : '，⚠️ 自检未找到文件（异常）'}\n`
        + `【请在给用户的最终回复里**原样引用这个绝对路径**】${file}`,
      meta: { tool, ok: cun, bytes: zongBytes, chars: zongZi, path: relOf(baseDir, file), abs: file, exists: cun },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 建目录 */
/**
 * **看压缩包内部**（产品要求：内置一个可以查看压缩包内部文件的工具）。
 *
 * 只做两件事：列条目、读单个条目 —— **不落地解压**（避免 zip slip）。
 * 条目名里的 `..`/绝对路径一律拒（见 zip-look.ts 的 `tiaoMuMingAnQuan`）。
 */
/**
 * **按文件名在工作区里找**（真机：模型要 `list_archive D006.zip`，但那个 zip 不在工作区根，
 * 于是 `not-found`、整步失败）。找不到就如实说找不到；找得到就用**真实位置**继续。
 */
function zhaoWenJianMing(baseDir: string, ming: string, ceng = 2): string | null {
  const muBiao = String(ming || '').toLowerCase();
  if (!muBiao) return null;
  let souGuo = 0;
  const sou = (dir: string, d: number): string | null => {
    let tiao: fs.Dirent[] = [];
    try { tiao = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of tiao) {
      if (++souGuo > 400) return null;   // **上限**：工作区大时别把工具卡住（真机：一次调用耗了 10 分钟）
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === muBiao) return p;
    }
    if (d <= 0) return null;
    for (const e of tiao) {
      if (!e.isDirectory()) continue;
      const hit = sou(path.join(dir, e.name), d - 1);
      if (hit) return hit;
    }
    return null;
  };
  return sou(baseDir, ceng);
}

export function workListArchive(baseDir: string, args: { path?: string }, kuaiQuan = false): WorkToolResult {
  const tool = 'list_archive';
  try {
    let p = resolveInside(baseDir, args.path, kuaiQuan, 'read');
    if (!fs.existsSync(p)) {
      /** 找不到就按**文件名**在工作区里搜一层（模型常记错路径） */
      const hit = zhaoWenJianMing(baseDir, path.basename(String(args.path || '')));
      if (hit) p = hit;
    }
    if (!fs.existsSync(p)) return fail(tool, new Error(`not-found（工作区里没有「${String(args.path || '')}」；请先用 list_dir 看看工作区里有什么，或用正确路径）`), relOf(baseDir, p));
    const zhi = fs.statSync(p);
    if (!zhi.isFile()) return fail(tool, new Error('not-a-file'), relOf(baseDir, p));
    const buf = fs.readFileSync(p);
    const tiao = lieYaSuoBaoTiaoMu(buf);
    const lu = relOf(baseDir, p);
    if (!tiao.length) {
      return { ok: true, content: '[list_archive] 压缩包里是空的。', meta: { tool, ok: true, bytes: buf.length, path: lu, entries: 0 } };
    }
    const hang = tiao.slice(0, 300).map((t) => {
      const biao = t.isDirectory ? '（目录）' : `（${t.uncompressedSize} 字节）`;
      return `· ${t.name}${biao}`;
    }).join('\n');
    const duo = tiao.length > 300 ? `\n…（共 ${tiao.length} 条，只列前 300）` : '';
    return {
      ok: true,
      content: `[list_archive] ${path.basename(p)} 里共 ${tiao.length} 条：\n${hang}${duo}`,
      meta: { tool, ok: true, bytes: buf.length, path: lu, entries: tiao.length },
    };
  } catch (e) { return fail(tool, e, String(args.path || '')); }
}

/** **读压缩包里的单个文件**（文本返回内容；二进制如实说明，不倒字节） */
export function workReadArchiveEntry(baseDir: string, args: { path?: string; entry?: string; maxChars?: number }, kuaiQuan = false): WorkToolResult {
  const tool = 'read_archive_entry';
  try {
    let p = resolveInside(baseDir, args.path, kuaiQuan, 'read');
    if (!fs.existsSync(p)) {
      const hit = zhaoWenJianMing(baseDir, path.basename(String(args.path || '')));
      if (hit) p = hit;
    }
    const lu = relOf(baseDir, p);
    const ming = String(args.entry || '').trim();
    if (!ming) return fail(tool, new Error('need-entry（要给 entry：压缩包内的文件名，用 list_archive 查）'), lu);
    if (!tiaoMuMingAnQuan(ming)) return fail(tool, new Error(`zip-slip（条目名不安全：${ming.slice(0, 80)}）`), lu);
    if (!fs.existsSync(p)) return fail(tool, new Error('not-found'), lu);
    const buf = duYaSuoBaoTiaoMu(fs.readFileSync(p), ming);
    const shang = Math.max(200, Math.min(Number(args.maxChars) || 8000, 20000));
    // 二进制判定：有 NUL 就当二进制，不倒内容
    if (buf.includes(0)) {
      return { ok: true, content: `[read_archive_entry] ${ming} 是二进制文件（${buf.length} 字节），只读文本，不倒二进制内容。`, meta: { tool, ok: true, bytes: buf.length, path: lu, entry: ming } };
    }
    const wen = buf.toString('utf8');
    const jie = wen.length > shang ? wen.slice(0, shang) + `\n…（截断，全文 ${wen.length} 字符）` : wen;
    return { ok: true, content: `[read_archive_entry] ${ming}（${buf.length} 字节）：\n${jie}`, meta: { tool, ok: true, bytes: buf.length, path: lu, entry: ming, truncated: wen.length > shang } };
  } catch (e) { return fail(tool, e, String(args.path || '')); }
}

export function workMakeDir(baseDir: string, args: { path?: string }, kuaiQuan = false): WorkToolResult {
  const tool = 'make_dir';
  try {
    const dir = resolveInside(baseDir, args && args.path, kuaiQuan);
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, content: `已创建目录 ${dir}`, meta: { tool, ok: true, bytes: 0, path: relOf(baseDir, dir), abs: dir } };
  } catch (e) {
    return fail(tool, e);
  }
}

/** pptx 模板路径：随包 assets/tpl.pptx（由 python-pptx 预生成，保证 PowerPoint 能打开） */
export function pptxMuBanLu(gaoJiMuLu: string): string {
  // 开发态在 <app>/assets；打包后 copy-assets 也放了一份在 <app>/dist/assets —— 两处都找
  const houXuan = [
    path.join(gaoJiMuLu, 'assets', 'tpl.pptx'),
    path.join(gaoJiMuLu, 'dist', 'assets', 'tpl.pptx'),
  ];
  for (const p of houXuan) { if (fs.existsSync(p)) return p; }
  return houXuan[0]!;
}

/** 生成真 .docx */
export function workMakeDocx(baseDir: string, args: { path?: string; paragraphs?: string[]; content?: string }, kuaiQuan = false): WorkToolResult {
  const tool = 'make_docx';
  try {
    const rawP = String((args && args.path) || '').trim();
    if (!/\.docx$/i.test(rawP)) return fail(tool, new Error('need-docx-extension：path 必须以 .docx 结尾'), rawP);
    const file = resolveInside(baseDir, rawP, kuaiQuan);
    const duanRaw = args && args.paragraphs;
    const duan = Array.isArray(duanRaw) && duanRaw.length
      ? (duanRaw as unknown[]).map((s) => String(s))
      : String((args && args.content) ?? '').split(/\r?\n/);
    const buf = shengChengDocx(duan);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return {
      ok: true,
      content: `已生成 Word 文档 ${file}（${buf.length} 字节，${duan.length} 段；可直接用 Word 打开）`,
      meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), abs: file },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 生成真 .pptx（模板填字；多页自动克隆） */
export function workMakePptx(baseDir: string, args: { path?: string; slides?: Array<{ title?: string; body?: string[] }> }, kuaiQuan = false, muBanKaiGuanMuLu = ''): WorkToolResult {
  const tool = 'make_pptx';
  try {
    const rawP = String((args && args.path) || '').trim();
    if (!/\.pptx$/i.test(rawP)) return fail(tool, new Error('need-pptx-extension：path 必须以 .pptx 结尾'), rawP);
    const muBan = pptxMuBanLu(muBanKaiGuanMuLu);
    if (!keYongPptx(muBan)) {
      return fail(tool, new Error('pptx-template-missing：随包模板不可用（' + muBan + '）。如实告知用户当前无法生成 .pptx，不要假装成功。'), rawP);
    }
    const pianRaw = args && args.slides;
    const pian = Array.isArray(pianRaw) && pianRaw.length
      ? (pianRaw as Array<{ title?: string; body?: string[] }>).map((s) => ({
          title: String((s && s.title) ?? ''),
          body: Array.isArray(s && s.body) ? (s.body as unknown[]).map((x) => String(x)) : String((s && (s as { body?: string }).body) ?? '').split(/\r?\n/),
        }))
      : [{ title: '', body: [''] }];
    const buf = shengChengPptx(muBan, pian);
    const file = resolveInside(baseDir, rawP, kuaiQuan);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return {
      ok: true,
      content: `已生成 PowerPoint ${file}（${buf.length} 字节，${pian.length} 张幻灯片；可直接用 PowerPoint 打开）`,
      meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), abs: file },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 生成真 .xlsx（Excel / WPS / LibreOffice 可打开） */
export function workMakeXlsx(baseDir: string, args: { path?: string; sheets?: Array<{ name?: string; rows?: Array<Array<string | number>> }>; rows?: Array<Array<string | number>> }, kuaiQuan = false): WorkToolResult {
  const tool = 'make_xlsx';
  try {
    const rawP = String((args && args.path) || '').trim();
    if (!/\.xlsx$/i.test(rawP)) return fail(tool, new Error('need-xlsx-extension：path 必须以 .xlsx 结尾'), rawP);
    const shuRaw = args && args.sheets;
    const shu = Array.isArray(shuRaw) && shuRaw.length
      ? shuRaw.map((s, i) => ({
          name: String((s && s.name) || `工作表${i + 1}`),
          rows: Array.isArray(s && s.rows) ? (s.rows as Array<Array<string | number>>) : [],
        }))
      : [{ name: '工作表1', rows: Array.isArray(args && args.rows) ? (args.rows as Array<Array<string | number>>) : [['']] }];
    const buf = shengChengXlsx(shu);
    const file = resolveInside(baseDir, rawP, kuaiQuan);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    const hangShu = shu.reduce((s, x) => s + x.rows.length, 0);
    return {
      ok: true,
      content: `已生成 Excel 表格 ${file}（${buf.length} 字节，${shu.length} 个工作表、共 ${hangShu} 行；可直接用 Excel/WPS 打开）`,
      meta: { tool, ok: true, bytes: buf.length, path: relOf(baseDir, file), abs: file },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 生成真 .pdf（内嵌子集中文字体，中文可复制/可检索） */
export function workMakePdf(baseDir: string, args: { path?: string; paragraphs?: string[]; content?: string; title?: string; pageSize?: 'A4' | 'Letter' }, kuaiQuan = false): WorkToolResult {
  const tool = 'make_pdf';
  try {
    const rawP = String((args && args.path) || '').trim();
    if (!/\.pdf$/i.test(rawP)) return fail(tool, new Error('need-pdf-extension：path 必须以 .pdf 结尾'), rawP);
    const duanRaw = args && args.paragraphs;
    const duan = Array.isArray(duanRaw) && duanRaw.length
      ? (duanRaw as unknown[]).map((s) => String(s))
      : String((args && args.content) ?? '').split(/\r?\n/);
    const r = shengChengPdf(duan.map((text) => ({ text })), {
      title: String((args && args.title) || ''),
      pageSize: args && args.pageSize === 'Letter' ? 'Letter' : 'A4',
    });
    if (!r.ok || !r.buffer) {
      // **如实失败**：系统里没有可内嵌的 CJK 字体时不能装作生成了（否则打开是空白/乱码）
      return fail(tool, new Error('pdf-font-unavailable：' + (r.error || 'unknown') + '。请如实告诉用户当前无法生成 PDF（可安装 simhei.ttf 或设 WARMY_PDF_FONT 指向 .ttf 字体）。'), rawP);
    }
    const file = resolveInside(baseDir, rawP, kuaiQuan);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.buffer);
    const que = (r.queShi || []).slice(0, 20);
    return {
      ok: true,
      content: `已生成 PDF ${file}（${r.buffer.length} 字节，${duan.length} 段；内嵌中文字体子集，中文可复制可检索）`
        + (que.length ? `\n注意：字体里缺这些字形，渲染为空白：${que.join(' ')}` : ''),
      meta: { tool, ok: true, bytes: r.buffer.length, path: relOf(baseDir, file), abs: file, font: r.fontPath, missing: que },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 统一入口：按 tool 名分发（未知工具 → 结构化失败，不抛错） */
/**
 * 工具调用参数的**容错解析**。
 *
 * 真事故：模型吐出的 tool arguments 是**截断/手写**的 JSON，严格 JSON.parse 抛
 * `can't find closing '}' symbol` 之类的语法错，直接当回复回给用户 —— 用户只看到
 * 一句天书，工具压根没跑。
 *
 * 策略：能严格解析就用；否则按顺序做常见修复（尾逗号 / 未闭合括号 / 单引号 / 未加引号的键），
 * 修不出来就返回 `{}` 并让调用方如实回「参数不是合法 JSON」——**绝不把裸解析器报错当回复**。
 */
/**
 * 路径字段兼容：不同模型会写 path / file / filePath / filename / name。
 * 真机事故：MiMo 把 write_file 的 path 发成空 ⇒ empty-path，连试 7 次全挂。
 */
export function quLuJingCanShu(args: Record<string, unknown>): string {
  const a = args || {};
  for (const k of ['path', 'file', 'filePath', 'filepath', 'filename', 'fileName', 'name', 'target']) {
    const v = a[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** make_* 生成器：缺扩展名时自动补上（真机：make_pptx 只给了 identity，一直报 need-pptx-extension） */
export function buKuoZhanMing(p: string, ext: string): string {
  const s = String(p || '').trim();
  if (!s) return s;
  const e = ext.startsWith('.') ? ext : '.' + ext;
  return new RegExp(e.replace('.', '\\.') + '$', 'i').test(s) ? s : s + e;
}

export function jieXiGongJuCanShu(raw: unknown): { ok: boolean; args: Record<string, unknown>; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, args: {} };
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, args: raw as Record<string, unknown> };
  const s0 = String(raw).trim();
  if (!s0) return { ok: true, args: {} };
  // 1) 严格解析
  try { return { ok: true, args: JSON.parse(s0) as Record<string, unknown> }; } catch { /* 往下修 */ }
  let s = s0;
  try {
    // 2) 去掉尾逗号  { "a":1, } → { "a":1 }
    s = s.replace(/,\s*([}\]])/g, '$1');
    // 3) 未加引号的键  { a: 1 } → { "a": 1 }
    s = s.replace(/([{,]\s*)([A-Za-z_][\w$-]*)\s*:/g, '$1"$2":');
    // 4) 单引号字符串 → 双引号（简单情形）
    s = s.replace(/'/g, '"');
    try { return { ok: true, args: JSON.parse(s) as Record<string, unknown> }; } catch { /* 再试闭合 */ }
    // 5) 未闭合：按栈补齐 } ]（截断的 JSON 最常见）
    const zhan: string[] = [];
    let yinHao: string | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (yinHao) { if (c === '\\') { i++; continue; } if (c === yinHao) yinHao = null; continue; }
      if (c === '"' || c === "'") { yinHao = c; continue; }
      if (c === '{') zhan.push('}');
      else if (c === '[') zhan.push(']');
      else if (c === '}' || c === ']') zhan.pop();
    }
    if (yinHao) s += '"';
    s = s.replace(/,\s*$/, '');
    s += zhan.reverse().join('');
    return { ok: true, args: JSON.parse(s) as Record<string, unknown> };
  } catch {
    // **不把解析器原始报错**（Unexpected token / can't find closing …）带回给用户 ——
    // 那是天书，不是答案；只如实说"参数不是合法 JSON"
    return { ok: false, args: {}, error: '参数不是合法 JSON（已尝试常见修复仍失败）' };
  }
}

export function runWorkTool(baseDir: string, call: { function?: { name?: string; arguments?: unknown } }, kuaiQuan = false, gaoJiMuLu = ''): WorkToolResult {
  const name0 = String((call && call.function && call.function.name) || '');
  /**
   * **空参数工具调用**（真机：MiMo 偶发吐 name 但 arguments 为空 ⇒ write_file 落成 0 字节）。
   * 如实报错并给出可执行示例，让模型下一轮带齐参数 —— 不要静默造空文件。
   */
  {
    const raw0 = call && call.function ? call.function.arguments : undefined;
    const parsed0 = jieXiGongJuCanShu(raw0);
    const kong = !parsed0.args || Object.keys(parsed0.args).length === 0;
    if (kong && !['get_time', 'list_dir', 'list_archive', 'list_subagents'].includes(String(parsed0.args && name0 || name0))) {
      if (name0 === 'write_file') {
        return fail('write_file', new Error('empty-args（工具参数为空：请重新调用并带上 path 与 content，例如 {\"path\":\"note.txt\",\"content\":\"正文\"}）'), '');
      }
    }
  }
  /**
   * **工具名别名**（真机事故：模型调 `read_archive` 报 `unknown-tool`，于是"查看压缩包"这步
   * 直接失败、任务完不成）。模型给工具起名常有偏差，这里做**宽容映射**，别让它因为一个
   * 名字没对上就整步失败。映射不到才如实报 unknown-tool。
   */
  const BIE_MING: Record<string, string> = {
    read_archive: 'read_archive_entry', read_zip: 'read_archive_entry', unzip_read: 'read_archive_entry',
    extract_file: 'read_archive_entry', read_zip_entry: 'read_archive_entry', archive_read: 'read_archive_entry',
    list_zip: 'list_archive', view_archive: 'list_archive', unzip_list: 'list_archive',
    show_archive: 'list_archive', archive_list: 'list_archive', zip_list: 'list_archive',
    create_file: 'write_file', save_file: 'write_file', write_text: 'write_file',
    open_folder: 'open_path', reveal: 'open_path', show_in_folder: 'open_path',
    list_files: 'list_dir', ls: 'list_dir', read_text: 'read_file',
    find: 'find_files', glob: 'find_files', grep: 'search_files', search: 'search_files',
    patch_file: 'edit_file', replace_in_file: 'edit_file',
    cp: 'copy_file', copy: 'copy_file', mv: 'move_file', rename_file: 'move_file',
    make_slides: 'make_pptx', make_doc: 'make_docx', make_sheet: 'make_xlsx',
  };
  const name = BIE_MING[name0] || name0;
  const rawArgs = call && call.function ? call.function.arguments : undefined;
  const jie = jieXiGongJuCanShu(rawArgs);
  if (!jie.ok) return fail(name || 'work', new Error(jie.error || 'bad-json-arguments'));
  /** 路径字段归一 + 生成器缺扩展名自动补 */
  const args = { ...jie.args };
  const p0 = quLuJingCanShu(args);
  if (p0) args.path = p0;
  if (name === 'write_file' && !args.path) {
    args.path = 'output-' + Date.now() + '.txt';
  }
  /**
   * **空内容要拦**（真机事故：牛马生成了 txt/ppt，打开是**空文件**）。
   * 审计里就是 `write_file … bytes:0` —— 模型只给了路径（或连路径都没给），
   * 内容字段丢了/空了，于是落了一个 0 字节文件，用户看到"生成了但什么都没有"。
   * 现在：内容为空**如实拒绝**，让模型补上内容再来（除非显式要建空文件）。
   */
  if (name === 'write_file') {
    const nei = String((args as { content?: unknown }).content ?? '');
    const yaoKong = (args as { allowEmpty?: unknown }).allowEmpty === true;
    if (!nei.trim() && !yaoKong) {
      return fail('write_file', new Error('empty-content（内容为空：真实产物不许是 0 字节空文件。请把正文放进 content 字段再调用；确实要建空文件请显式传 allowEmpty:true）'), String(args.path || ''));
    }
  }
  if (name === 'make_dir' && !args.path) args.path = 'new-folder';
  if (name === 'make_docx') args.path = buKuoZhanMing(String(args.path || 'document'), '.docx');
  if (name === 'make_pptx') args.path = buKuoZhanMing(String(args.path || 'slides'), '.pptx');
  if (name === 'make_xlsx') args.path = buKuoZhanMing(String(args.path || 'sheet'), '.xlsx');
  if (name === 'make_pdf') args.path = buKuoZhanMing(String(args.path || 'document'), '.pdf');
  switch (name) {
    case 'list_dir': return workListDir(baseDir, args as { path?: string }, kuaiQuan);
    case 'find_files': return workFindFiles(baseDir, args as { pattern?: string; path?: string; maxResults?: number }, kuaiQuan);
    case 'search_files': return workSearchFiles(baseDir, args as { query?: string; path?: string; pattern?: string; maxResults?: number; caseSensitive?: boolean }, kuaiQuan);
    case 'read_file': return workReadFile(baseDir, args as { path?: string; maxChars?: number }, kuaiQuan);
    case 'write_file': return workWriteFile(baseDir, args as { path?: string; content?: string; append?: boolean }, kuaiQuan);
    case 'edit_file': return workEditFile(baseDir, args as { path?: string; oldText?: string; newText?: string; replaceAll?: boolean }, kuaiQuan);
    case 'copy_file': return workCopyFile(baseDir, { path: String(args.path || args.source || ''), destination: String(args.destination || ''), overwrite: !!args.overwrite }, kuaiQuan);
    case 'move_file': return workMoveFile(baseDir, { path: String(args.path || args.source || ''), destination: String(args.destination || ''), overwrite: !!args.overwrite }, kuaiQuan);
    case 'make_dir': return workMakeDir(baseDir, args as { path?: string }, kuaiQuan);
    case 'make_docx': return workMakeDocx(baseDir, args as { path?: string; paragraphs?: string[]; content?: string }, kuaiQuan);
    case 'make_pptx': return workMakePptx(baseDir, args as { path?: string; slides?: Array<{ title?: string; body?: string[] }> }, kuaiQuan, gaoJiMuLu);
    case 'make_xlsx': return workMakeXlsx(baseDir, args as { path?: string; sheets?: Array<{ name?: string; rows?: Array<Array<string | number>> }>; rows?: Array<Array<string | number>> }, kuaiQuan);
    case 'make_pdf': return workMakePdf(baseDir, args as { path?: string; paragraphs?: string[]; content?: string; title?: string; pageSize?: 'A4' | 'Letter' }, kuaiQuan);
    case 'list_archive': return workListArchive(baseDir, args as { path?: string }, kuaiQuan);
    case 'read_archive_entry': return workReadArchiveEntry(baseDir, args as { path?: string; entry?: string; maxChars?: number }, kuaiQuan);
    default: return fail(name || 'work', new Error('unknown-tool'));
  }
}

/**
 * 暴露给模型的工具规格（OpenAI function calling 形态）。
 * 描述里写清"落在工作区"与相对路径要求，减少模型乱给绝对路径。
 */
export function workToolSpecs(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return [
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入/追加一个文本文件（会自动建父目录）。默认写在**工作区**内（相对路径）。可直接写系统「桌面/文档/下载」：用 Desktop/xxx.txt、Documents/xxx.txt、~/Desktop/xxx.txt 这类路径（会映射到真实系统目录，需要用户授权；返回里会给绝对路径）。**产出物必须在最终回复里原样给出返回的绝对路径**，否则用户找不到文件。'
          + '**长文必须分段写**：要写超过 1500 字的长文时，不要在一次调用里塞整篇（会被截断、写不完）。正确做法：第 1 次 write_file 只写第 1 段（不带 append），之后每次调用都带 append:true 续写下一段，一段一段写到完结；每次返回里会告诉你文件当前总字数，可据此判断还需不需要再写。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '【必填】文件路径字符串，例如 identity.txt 或 Desktop/identity.txt。不要省略本字段。' },
            content: { type: 'string', description: '本次要写入的内容（分段写时就是这一段）' },
            append: { type: 'boolean', description: 'true = 追加到该文件已有内容的末尾（长文分段续写用）；false/省略 = 覆盖整文件' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取工作区里的一个文本文件（超长会截断）。路径必须是工作区内的相对路径。',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: '列出工作区某个目录下的文件与子目录（默认根目录）。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，默认 .' } }, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_files',
        description: '按 glob 模式递归查找工作区文件。默认跳过 node_modules 和 .git；结果有数量上限。',
        parameters: { type: 'object', properties: { pattern: { type: 'string', description: '如 **/*.ts、docs/*.md' }, path: { type: 'string', description: '搜索根目录，默认 .' }, maxResults: { type: 'number' } }, required: ['pattern'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: '在工作区文件内容中做正则搜索，返回 文件:行号:内容。跳过 node_modules/.git 和超过 2MB 的文件。',
        parameters: { type: 'object', properties: { query: { type: 'string', description: '正则表达式' }, path: { type: 'string', description: '根目录，默认 .' }, pattern: { type: 'string', description: '文件 glob，默认 **/*' }, maxResults: { type: 'number' }, caseSensitive: { type: 'boolean' } }, required: ['query'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: '精确局部修改文本文件：把 oldText 替换为 newText。默认要求 oldText 唯一，避免误改；多处替换需显式 replaceAll:true。',
        parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['path', 'oldText', 'newText'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'copy_file',
        description: '在工作区内复制单个文件；目标已存在时拒绝覆盖。',
        parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source', 'destination'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'move_file',
        description: '在工作区内移动或重命名单个文件；不允许逃出工作区。',
        parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source', 'destination'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_archive',
        description: '**查看压缩包内部**（.zip）：列出里面有哪些文件/目录、各多大。要弄清一个压缩包里有什么，用这个，不要试图用 read_file 读 .zip 本身。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '压缩包路径（工作区相对路径，如 data.zip）' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_archive_entry',
        description: '读**压缩包里的单个文件**（先用 list_archive 查到条目名，再读）。只读文本；二进制会如实说明。不会解压到磁盘。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '压缩包路径' },
            entry: { type: 'string', description: '压缩包内的条目名（与 list_archive 输出一致）' },
            maxChars: { type: 'number', description: '最多返回多少字符（默认 8000）' },
          },
          required: ['path', 'entry'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'make_dir',
        description: '在工作区里创建目录（含多级）。',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'make_docx',
        description: '生成**真正的 Word 文档**（.docx，可用 Word 打开）。要生成 word 文档**必须用本工具**，不要用 write_file 写 .docx（那样得到的是假文件）。路径同 write_file（可写 Desktop/xx.docx 等系统目录，需授权）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '以 .docx 结尾的路径，如 Desktop/报告.docx' },
            paragraphs: { type: 'array', items: { type: 'string' }, description: '正文段落（每项一段）' },
            content: { type: 'string', description: '正文（按换行分段；与 paragraphs 二选一）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'make_pptx',
        description: '生成**真正的 PowerPoint**（.pptx，可用 PowerPoint 打开）。要生成 ppt/幻灯片**必须用本工具**。path 参数必填，建议写成 xx.pptx（缺后缀会自动补）。不要用 write_file 写 .pptx。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '以 .pptx 结尾的路径，如 Desktop/汇报.pptx' },
            slides: {
              type: 'array',
              description: '幻灯片列表（顺序即播放顺序）',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '这一页的标题' },
                  body: { type: 'array', items: { type: 'string' }, description: '这一页的要点（每项一行）' },
                },
                required: ['title'],
              },
            },
          },
          required: ['path', 'slides'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'make_xlsx',
        description: '生成**真正的 Excel 表格**（.xlsx，可用 Excel / WPS / LibreOffice 打开）。要出表格**必须用本工具**，不要用 write_file 写 .xlsx（那是改后缀的文本，打不开）。路径同 write_file（可写 Desktop/xx.xlsx 等系统目录，需授权）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '以 .xlsx 结尾的路径，如 Desktop/清单.xlsx' },
            sheets: {
              type: 'array',
              description: '工作表列表（顺序即标签顺序）',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '工作表名（≤31 字）' },
                  rows: {
                    type: 'array',
                    description: '行列表；每行是单元格数组（数字按数字写，其它按文本）',
                    items: { type: 'array', items: { type: ['string', 'number'] } },
                  },
                },
                required: ['rows'],
              },
            },
            rows: { type: 'array', description: '只建一个工作表时的简写：行列表', items: { type: 'array', items: { type: ['string', 'number'] } } },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'make_pdf',
        description: '生成**真正的 PDF**（.pdf）。中文会被内嵌为字体子集，所以**可以复制、可以检索**（不是图片）。要出 PDF **必须用本工具**，不要用 write_file 写 .pdf。系统里没有可用 CJK 字体时会**如实报错**，不会装作成功。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '以 .pdf 结尾的路径，如 Desktop/报告.pdf' },
            paragraphs: { type: 'array', items: { type: 'string' }, description: '正文段落（每项一段，自动折行分页）' },
            content: { type: 'string', description: '正文（按换行分段；与 paragraphs 二选一）' },
            title: { type: 'string', description: '文档标题（写入 PDF 元信息，可选）' },
            pageSize: { type: 'string', description: 'A4（默认）或 Letter' },
          },
          required: ['path'],
        },
      },
    },
  ];
}

/** 工作区根目录：`<userData>/workspace/<sessionId 净化>` */
export function workspaceDirOf(userDataDir: string, sessionId: string): string {
  const safe = String(sessionId || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'default';
  return path.join(userDataDir, 'workspace', safe);
}

/**
 * 宿主工具：需要 **Electron 主进程** 才能做（work-tools 本身保持纯 Node、零依赖）。
 *  · open_path：用系统默认程序打开文件/目录（.txt 等）
 *  · open_url ：用系统默认浏览器打开网页
 *  · schedule_task：登记一条定时任务（到点由宿主替用户发一轮）
 * 权限：普通/严格授权下**只允许工作区内**的路径与 http(s) 网址；
 *      完全授权才允许任意本机路径（由调用方按 globalSecurity 判定，这里不判）。
 */
export const HOST_TOOL_NAMES = [
  'open_path', 'open_file', 'open_url', 'schedule_task', 'monitor_process', 'lsp_diagnostics', 'ask_user', 'plan_update', 'plan_verify',
  'run_shell', 'find_skill', 'read_skill', 'install_skill', 'check_safety', 'read_document', 'read_docx', 'read_pptx', 'read_xlsx', 'read_pdf', 'fetch_url', 'web_search', 'web_extract', 'download_file',
  'get_time', 'wait_seconds', 'read_profile',
] as const;
export function isHostTool(name: unknown): boolean {
  return typeof name === 'string' && (HOST_TOOL_NAMES as readonly string[]).includes(name);
}
export function hostToolSpecs(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return [
    {
      type: 'function',
      function: {
        name: 'open_path',
        description: '用系统默认程序**打开**一个文件或目录（例如打开 .txt 让用户看内容）。**别名：open_file**。路径可用工作区相对路径，也可用 Desktop/xxx.txt、~/Desktop/xxx.txt 等系统目录路径（映射到真实目录，需要授权）。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区相对路径；或 Desktop/xx.txt、~/Desktop/xx.txt 等系统目录路径；完全授权时可用任意绝对路径' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_file',
        description: 'open_path 的别名：用系统默认程序打开一个文件/目录（参数与 open_path 完全相同）。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '同 open_path' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_url',
        description: '用系统默认浏览器打开一个网页（只接受 http/https）。',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_profile',
        description: '按需读取本牛马的**社交档案**（邮箱/网站账号/手机号/昵称/钱包地址等）。'
          + '档案不会自动注入上下文；用户问到联系方式、账号、名片，或你需要给外部服务填资料时再调用。'
          + '**密码/口令不会返回**（安全保管）；没有该项就如实说没有。',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: '可选：只要某一项，如 email / website / phone / nick / wallet / all（默认 all）',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_time',
        description: '**感知时间**：返回本机当前时间（含时区）与联网时间（NTP/HTTP）。'
          + '凡是需要"等一会儿/过 30 秒/到几点"这类时间判断时，**必须先调用它**拿真实时刻，不要凭感觉估。'
          + '返回里 `local` 是本机时间、`network` 是联网时间、`driftMs` 是两者之差（毫秒）。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wait_seconds',
        description: '**真正等待 N 秒**（跨平台可靠；别用 run_shell 的 sleep，Windows 上没有）。'
          + '参数 `seconds`（0.5–600）。返回实际等待的毫秒数，可用来确认真的等满了。',
        parameters: {
          type: 'object',
          properties: { seconds: { type: 'number', description: '要等待的秒数（0.5–600）' } },
          required: ['seconds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '当你有不确定的选择/决定时，列出候选项让用户在界面上点选（永远含「其他」自定义输入），用户选完你会拿到结果并继续。**不要自己猜、也不要因此停下。**',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '要问用户的问题（一句话）' },
            hint: { type: 'string', description: '补充说明（可选）' },
            options: { type: 'array', items: { type: 'string' }, description: '候选选项（2-8 个，纯文案）' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'plan_update',
        description: '计划模式：长任务先把计划列出来（任务树，T1/T1.1 形态），再逐个完成、逐个验证。每次用**全量**提交当前步骤表（id/title/status/note）。status: pending|doing|done|verified|blocked。计划卡会出现在界面右侧第四列。',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: '全量步骤表（顺序即执行顺序）',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '如 T1 / T1.1' },
                  title: { type: 'string' },
                  status: { type: 'string', description: 'pending|doing|done|verified|blocked' },
                  note: { type: 'string', description: '进展/证据（可选）' },
                },
                required: ['id', 'title', 'status'],
              },
            },
          },
          required: ['steps'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'plan_verify',
        description: '计划模式：逐个验证 —— 把某个步骤标为 verified（必须真的验过），并在 note 写证据。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '步骤 id，如 T1.2' },
            note: { type: 'string', description: '验证证据（做了什么、看到什么）' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_task',
        description: '登记一条定时任务：每隔 N 分钟（或每天 HH:mm）由系统自动替用户发一轮「prompt」。返回任务 id，可在界面「定时任务」卡片里看到。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名' },
            prompt: { type: 'string', description: '到点要发给牛马的内容' },
            everyMinutes: { type: 'number', description: '每隔多少分钟（与 dailyAt 二选一）' },
            dailyAt: { type: 'string', description: '每天 HH:mm（24 小时制，与 everyMinutes 二选一）' },
          },
          required: ['name', 'prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'monitor_process',
        description: '查看本机进程是否仍在运行以及 CPU/内存占用。只读，不结束进程。可按 pid 或名称筛选；适合长程任务做存活检查。',
        parameters: { type: 'object', properties: { pid: { type: 'number' }, name: { type: 'string' } }, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'lsp_diagnostics',
        description: '获取项目代码诊断。优先调用项目配置的 LSP/类型检查器；找不到语言服务器时回退到 TypeScript tsc --noEmit 或常见编译检查。只读源码。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '项目目录或文件路径，默认工作区' }, language: { type: 'string', description: 'typescript/javascript/python/rust/go（可选）' }, timeoutMs: { type: 'number' } }, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_shell',
        description: '执行一条命令行（shell/终端）。权限由用户的授权档位决定：完全授权=无限制；严格授权=逐条询问；常规授权=只放行白名单命令（ls/cat/git/node/npm/python 等），其它要用户批准。命令会先做危险模式检测（rm -rf、curl|sh、sudo 等会标为高风险）。返回 stdout/stderr/退出码。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令，如 git status 或 python -c "print(1)"' },
            cwd: { type: 'string', description: '工作目录（可选；默认本会话工作区）' },
            timeoutMs: { type: 'number', description: '超时毫秒（默认 60000，上限 10 分钟）' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_skill',
        description: '查找可用的技能包（skill）：列出已安装的技能，或按关键词在技能目录里搜索。技能是一个含 SKILL.md 的文件夹，装上后你能获得新能力。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '关键词（可选；不给则列出全部）' },
            path: { type: 'string', description: '要检查的技能目录（可选）' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'install_skill',
        description: '安装一个技能包（含 SKILL.md 的文件夹）。安装前会做安全检测（扫描 rm -rf / curl|sh / sudo / 密钥外发 等危险模式）。完全授权：检测通过即可装；严格授权：每次询问；常规授权：低风险自动装，否则询问。不要自己写脚本装。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '技能包目录路径（本地）' },
            name: { type: 'string', description: '安装后的技能名（可选，默认取目录名）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_skill',
        description: '读一个技能的**全文**（SKILL.md 正文 + 按需读取的资源清单）。find_skill 只给名称与用途（第 1 层）；确定要做这件事之前，用本工具把步骤读全再动手。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '技能目录（find_skill 会给出准确路径）' },
            name: { type: 'string', description: '技能名（与 path 二选一；按 name/dirName 匹配）' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_safety',
        description: '对一条命令或一个技能包做安全检测，返回风险等级（low/medium/high）与命中原因。做危险动作之前先用它自查。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要检测的命令（与 path 二选一）' },
            path: { type: 'string', description: '要检测的技能包目录（与 command 二选一）' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_document',
        description: '**读文档的统一入口**：docx / xlsx / pptx / pdf / txt / md / csv 都用它。要读用户给的文档优先用这个，别用 read_file 读二进制（那是乱码）。会按文件头认格式（后缀骗人也认得出）；PDF 抽不到文本层（扫描件）会**如实说**并提示需要 OCR，不会编造正文。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文档路径（docx/xlsx/pptx/pdf/txt/md/csv）' },
            maxChars: { type: 'number', description: '正文返回上限（默认 20000）' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_docx',
        description: '读取 Word 文档（.docx）的正文文字（read_document 的别名，保留兼容）。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '.docx 路径' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_pptx',
        description: '读取 PowerPoint（.pptx）每页的标题与文字（read_document 的别名，保留兼容）。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '.pptx 路径' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_xlsx',
        description: '读取 Excel 表格（.xlsx）每个工作表的单元格（read_document 的别名，保留兼容）。要读表格优先用 read_document。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '.xlsx 路径' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_pdf',
        description: '读取 PDF（.pdf）的文本层（read_document 的别名，保留兼容）。扫描件抽不到文本会如实说，别编造。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '.pdf 路径' } }, required: ['path'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '**联网搜索**：返回排名 + 标题 + 摘要 + **URL**（先看再决定打开哪几条）。要查"现在的事实/新闻/文档"用它，**不要凭记忆编造**。没配搜索密钥时会如实失败并告诉你去哪配。写结论时必须带上出处 URL。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '查询词（用能力/事实描述，别只给产品名）' },
            count: { type: 'number', description: '返回条数（默认 8，最多 20）' },
            topic: { type: 'string', description: 'general（默认）或 news' },
            days: { type: 'number', description: '只要最近几天内的（配合 topic=news）' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_extract',
        description: '**抓正文**：把网页抽成干净文本，并按查询词**摘录**命中段落（每条都带 URL）。搜索结果里挑 1~5 条用它看细节；比 fetch_url 更适合"有据可查"的调研。',
        parameters: {
          type: 'object',
          properties: {
            urls: { type: 'array', items: { type: 'string' }, description: '要抓的 http/https 网址（最多 5 条）' },
            query: { type: 'string', description: '想在这几页里找什么（用于摘录）' },
          },
          required: ['urls'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: '抓取一个网页/接口（http/https）的文本内容。用于查资料、读 API 返回。只读，不带鉴权头。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'http/https 网址' },
            maxBytes: { type: 'number', description: '最多返回多少字节（默认 200000）' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'download_file',
        description: '下载一个文件（http/https）保存到指定路径（可写 Desktop/xx 等系统目录，需授权）。返回保存后的绝对路径。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'http/https 网址' },
            path: { type: 'string', description: '保存路径，如 Desktop/资料.pdf 或 out/a.bin' },
          },
          required: ['url', 'path'],
        },
      },
    },
  ];
}
