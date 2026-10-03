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
import { shengChengDocx, shengChengPptx, keYongPptx } from './office-tools.js';

/** 工具名（与 function calling 暴露给模型的 name 一致） */
export const WORK_TOOL_NAMES = ['list_dir', 'read_file', 'write_file', 'make_dir', 'make_docx', 'make_pptx'] as const;
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
 * 把一个"用户/模型给的相对路径"解析成 base 内的绝对路径。
 * 任何越界、绝对路径、非法字符都抛 `workspace-escape`（调用方转成文本回给模型）。
 */
export function resolveInside(baseDir: string, rel: unknown, kuaiQuan = false): string {
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
      throw new Error('absolute-path-not-allowed: ' + raw + ' 映射到系统目录 ' + zhen + '（在工作区外，需要授权）');
    }
  }
  /**
   * **完全授权**（用户显式选的）：允许绝对路径、允许工作区外 —— 此时 AI 可以直接操作本机。
   * 但仍然不许 NUL、不许空路径；且"做什么"始终受最高信念/戒律约束（策略层，不在这里）。
   */
  if (kuaiQuan) return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(path.resolve(baseDir), raw);
  // Windows 盘符 / UNC / POSIX 绝对路径：一律拒绝（工作区内只能用相对路径）
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
    throw new Error('absolute-path-not-allowed');
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(base, raw);
  if (target !== base && !target.startsWith(base + path.sep)) {
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
    const dir = resolveInside(baseDir, args && args.path ? args.path : '.', kuaiQuan);
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

/** 读文件 */
export function workReadFile(baseDir: string, args: { path?: string; maxChars?: number }, kuaiQuan = false): WorkToolResult {
  const tool = 'read_file';
  try {
    const file = resolveInside(baseDir, args && args.path, kuaiQuan);
    if (!fs.existsSync(file)) return fail(tool, new Error('not-found'), relOf(baseDir, file));
    if (fs.statSync(file).isDirectory()) return fail(tool, new Error('is-a-directory'), relOf(baseDir, file));
    const cap = Math.max(1, Math.min(Number(args?.maxChars) || WORK_TOOL_LIMITS.maxReadChars, WORK_TOOL_LIMITS.maxReadChars));
    const buf = fs.readFileSync(file);
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

/** 写文件（必要时建父目录）；超上限**拒绝**，不截断 */
export function workWriteFile(baseDir: string, args: { path?: string; content?: string }, kuaiQuan = false): WorkToolResult {
  const tool = 'write_file';
  try {
    /**
     * Office 二进制格式**不能**用纯文本 write_file 造：写出来的 `xx.pptx` 只是改后缀的文本，
     * PowerPoint 打不开（真事故：用户说"生成 ppt/word"，结果文件是假的）。
     * 如实拒绝并指向真正的生成器。
     */
    const rawP = String((args && args.path) || '');
    if (/\.(docx|pptx|xlsx)$/i.test(rawP)) {
      return fail(tool, new Error('office-binary-need-generator：' + rawP + ' 是 Office 二进制格式，write_file 只写纯文本（写出来的文件 Word/PowerPoint 打不开）。请改用 make_docx（生成 .docx）或 make_pptx（生成 .pptx）。'), rawP);
    }
    if (/\.(doc|ppt|xls)$/i.test(rawP)) {
      return fail(tool, new Error('legacy-office-unsupported：不支持老格式 ' + rawP + '，请用 make_docx / make_pptx 生成 .docx / .pptx。'), rawP);
    }
    const file = resolveInside(baseDir, args && args.path, kuaiQuan);
    const content = String((args && args.content) ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > WORK_TOOL_LIMITS.maxWriteBytes) {
      return fail(tool, new Error(`content-too-large (${bytes} > ${WORK_TOOL_LIMITS.maxWriteBytes} bytes)`), relOf(baseDir, file));
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return {
      ok: true,
      // **报绝对路径**：否则模型看到「已写入 Desktop/…」会误以为写进了系统桌面
      content: `已写入 ${file}（${bytes} 字节）`,
      meta: { tool, ok: true, bytes, path: relOf(baseDir, file), abs: file },
    };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 建目录 */
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

/** 统一入口：按 tool 名分发（未知工具 → 结构化失败，不抛错） */
export function runWorkTool(baseDir: string, call: { function?: { name?: string; arguments?: unknown } }, kuaiQuan = false, gaoJiMuLu = ''): WorkToolResult {
  const name = String((call && call.function && call.function.name) || '');
  const rawArgs = call && call.function ? call.function.arguments : undefined;
  let args: Record<string, unknown> = {};
  try {
    args = typeof rawArgs === 'string' ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : ((rawArgs as Record<string, unknown>) || {});
  } catch {
    return fail(name || 'work', new Error('bad-json-arguments'));
  }
  switch (name) {
    case 'list_dir': return workListDir(baseDir, args as { path?: string }, kuaiQuan);
    case 'read_file': return workReadFile(baseDir, args as { path?: string; maxChars?: number }, kuaiQuan);
    case 'write_file': return workWriteFile(baseDir, args as { path?: string; content?: string }, kuaiQuan);
    case 'make_dir': return workMakeDir(baseDir, args as { path?: string }, kuaiQuan);
    case 'make_docx': return workMakeDocx(baseDir, args as { path?: string; paragraphs?: string[]; content?: string }, kuaiQuan);
    case 'make_pptx': return workMakePptx(baseDir, args as { path?: string; slides?: Array<{ title?: string; body?: string[] }> }, kuaiQuan, gaoJiMuLu);
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
        description: '写入/覆盖一个文本文件（会自动建父目录）。默认写在**工作区**内（相对路径）。可直接写系统「桌面/文档/下载」：用 Desktop/xxx.txt、Documents/xxx.txt、~/Desktop/xxx.txt 这类路径（会映射到真实系统目录，需要用户授权；返回里会给绝对路径）。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '工作区相对路径（如 notes/todo.txt）；或 Desktop/xx.txt、~/Desktop/xx.txt 等系统目录路径' }, content: { type: 'string', description: '文件内容' } },
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
        description: '生成**真正的 PowerPoint**（.pptx，可用 PowerPoint 打开）。要生成 ppt/幻灯片**必须用本工具**，不要用 write_file 写 .pptx（那样得到的是假文件）。每张幻灯片有标题和要点。路径同 write_file（可写 Desktop/xx.pptx 等系统目录，需授权）。',
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
export const HOST_TOOL_NAMES = ['open_path', 'open_file', 'open_url', 'schedule_task', 'ask_user', 'plan_update', 'plan_verify'] as const;
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
  ];
}
