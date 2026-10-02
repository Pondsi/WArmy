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
import path from 'node:path';

/** 工具名（与 function calling 暴露给模型的 name 一致） */
export const WORK_TOOL_NAMES = ['list_dir', 'read_file', 'write_file', 'make_dir'] as const;
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
    error?: string;
    truncated?: boolean;
    entries?: number;
  };
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
      content: `已写入 ${relOf(baseDir, file)}（${bytes} 字节）`,
      meta: { tool, ok: true, bytes, path: relOf(baseDir, file) },
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
    return { ok: true, content: `已创建目录 ${relOf(baseDir, dir)}`, meta: { tool, ok: true, bytes: 0, path: relOf(baseDir, dir) } };
  } catch (e) {
    return fail(tool, e);
  }
}

/** 统一入口：按 tool 名分发（未知工具 → 结构化失败，不抛错） */
export function runWorkTool(baseDir: string, call: { function?: { name?: string; arguments?: unknown } }, kuaiQuan = false): WorkToolResult {
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
        description: '在工作区里写入/覆盖一个文本文件（会自动建父目录）。路径必须是工作区内的相对路径。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '相对路径，例如 notes/todo.txt' }, content: { type: 'string', description: '文件内容' } },
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
export const HOST_TOOL_NAMES = ['open_path', 'open_url', 'schedule_task', 'ask_user'] as const;
export function isHostTool(name: unknown): boolean {
  return typeof name === 'string' && (HOST_TOOL_NAMES as readonly string[]).includes(name);
}
export function hostToolSpecs(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return [
    {
      type: 'function',
      function: {
        name: 'open_path',
        description: '用系统默认程序打开一个文件或目录（例如打开 .txt）。默认只允许工作区内的相对路径；给出绝对路径需要用户处于「完全授权」。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区相对路径；完全授权时可用绝对路径' } }, required: ['path'] },
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
