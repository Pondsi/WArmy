/**
 * 容器**实例**（= 容器产品里一个个具体的容器/发行版）的枚举与启停。
 *
 * 为什么单独一个模块：`container-probe` 只回答「这台机器有没有可用的引擎」，
 * 而「这台机器上有哪些实例、哪一个活着」必须**按各引擎自己的 CLI 现问现答**。
 * 所以这里：
 *  1. 只对**有稳定实例列表命令**的引擎提供（docker / podman / nerdctl / wsl）；
 *  2. 其余引擎如实返回 `supported:false` + 原因 —— 不猜、不编一个空列表糊过去；
 *  3. 每条命令都有超时与输出上限，**任何失败都把原始输出首行带回去**当证据。
 *
 * 产品语义（ADG 004 第十七批）：
 *  · 「环境类型」不再是一个抽象选项，**具体实例就是环境**：用户在创建项目时选的
 *    就是这里列出来的某个实例；
 *  · 引擎没启动时实例列表**不可展开、不可点**（灰）；启动了才允许查看与启动实例；
 *  · 创建实例不替用户在引擎里造（各引擎造法不同、还要拉镜像），而是**打开该容器产品
 *    自己的界面/控制台**让用户自己建 —— 我们只做跳转与说明。
 */
import { execFile } from 'node:child_process';

export interface ContainerInstance {
  name: string;
  image?: string;
  state: 'running' | 'stopped' | 'unknown';
  /** 原始状态文本（不翻译，便于核对） */
  rawStatus?: string;
  /** 是否本软件自己创建的项目容器（warmy-*） */
  ours?: boolean;
}

export interface ContainerInstanceList {
  ok: boolean;
  id: string;
  /** 该引擎是否支持实例列表 */
  supported: boolean;
  /** 该引擎的实例能否由我们**单独**启动/停止（wsl 发行版由系统按需启动，为 false） */
  controllable: boolean;
  instances: ContainerInstance[];
  /** 不支持 / 失败原因码 */
  reason?: string;
  /** 原始输出首行（证据，不翻译） */
  evidence?: string;
}

interface ExecResult { ok: boolean; stdout: string; stderr: string; code: number | null; error?: string }

const TIMEOUT_MS = 12000;
const MAX_OUTPUT = 200_000;

/** Windows 上 wsl.exe 输出是 UTF-16LE：拿 NUL 字节判一下就转码，否则按 UTF-8 */
function decodeMaybeUtf16(buf: Buffer): string {
  if (buf.length > 2 && buf[1] === 0 && buf[3] === 0) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function run(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true },
      (err, stdout, stderr) => {
        const out = decodeMaybeUtf16(Buffer.from(String(stdout || ''), 'binary'));
        const errOut = decodeMaybeUtf16(Buffer.from(String(stderr || ''), 'binary'));
        if (err) {
          const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null;
          resolve({ ok: false, stdout: out, stderr: errOut, code, error: String((err as Error).message || err) });
          return;
        }
        resolve({ ok: true, stdout: out, stderr: errOut, code: 0 });
      }
    );
  });
}

/** 各引擎的实例列表命令（**固定参数**，没有任何用户输入进命令行） */
const LIST_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  docker: { cmd: 'docker', args: ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}'] },
  podman: { cmd: 'podman', args: ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}'] },
  nerdctl: { cmd: 'nerdctl', args: ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}'] },
  wsl: { cmd: 'wsl', args: ['-l', '-v'] },
};

/** 哪些引擎**能**由我们启动/停止单个实例；wsl 的发行版由系统按需启动，我们不代开终端 */
const INSTANCE_CONTROL: Record<string, boolean> = {
  docker: true,
  podman: true,
  nerdctl: true,
  wsl: false,
};

export function instanceControlSupported(id: string): boolean {
  return !!INSTANCE_CONTROL[id];
}

/** 实例名只允许引擎自己的合法字符；任何可疑字符一律拒绝（不做转义尝试，直接不执行） */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function splitRows(stdout: string): string[][] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^CONTAINER ID|^NAME\s+STATE/i.test(l))
    .map((l) => l.split('\t').map((x) => x.trim()));
}

function dockerLike(stdout: string): ContainerInstance[] {
  return splitRows(stdout).map((cols) => {
    const [name = '', image = '', state = '', status = ''] = cols;
    const running = /^running$/i.test(state);
    return {
      name,
      ...(image ? { image } : {}),
      state: running ? 'running' : 'stopped',
      rawStatus: status || state,
      ours: /^warmy-/.test(name),
    } satisfies ContainerInstance;
  }).filter((x) => !!x.name);
}

function wslList(stdout: string): ContainerInstance[] {
  return splitRows(stdout).map((cols) => {
    const [name = '', state = '', version = ''] = cols;
    const running = /running/i.test(state);
    return {
      name: name.replace(/^\*/, '').trim(),
      state: running ? 'running' : 'stopped',
      rawStatus: [state, version ? `v${version}` : ''].filter(Boolean).join(' '),
    } satisfies ContainerInstance;
  }).filter((x) => !!x.name);
}

/** 列出某个运行时的实例；不支持时 `supported:false` + 原因，绝不编造空列表当成功 */
export async function listRuntimeInstances(id: string): Promise<ContainerInstanceList> {
  const controllable = instanceControlSupported(id);
  const spec = LIST_COMMANDS[id];
  if (!spec) {
    return { ok: false, id, supported: false, controllable: false, instances: [], reason: 'no-instance-cli' };
  }
  const r = await run(spec.cmd, spec.args);
  const firstLine = (r.stderr || r.stdout || r.error || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (!r.ok) {
    return {
      ok: false, id, supported: true, controllable, instances: [],
      reason: r.code === null ? 'spawn-failed' : 'command-failed',
      evidence: firstLine.slice(0, 240),
    };
  }
  const instances = id === 'wsl' ? wslList(r.stdout) : dockerLike(r.stdout);
  return { ok: true, id, supported: true, controllable, instances, ...(firstLine ? { evidence: firstLine.slice(0, 240) } : {}) };
}

export interface InstanceActionResult {
  ok: boolean;
  id: string;
  action: 'start' | 'stop';
  instance: string;
  error?: string;
  evidence?: string;
}

/**
 * 启动/停止**单个实例**。命令参数固定为 `start|stop <name>`，
 * 名字先过白名单正则（不合规直接拒绝执行，不做任何转义尝试）。
 */
export async function runInstanceAction(id: string, action: 'start' | 'stop', name: string): Promise<InstanceActionResult> {
  const base: InstanceActionResult = { ok: false, id, action, instance: name };
  if (!LIST_COMMANDS[id]) return { ...base, error: 'no-instance-cli' };
  if (!INSTANCE_CONTROL[id]) return { ...base, error: 'instance-control-unsupported' };
  if (!SAFE_NAME.test(String(name || ''))) return { ...base, error: 'bad-instance-name' };
  const r = await run(id, [action, name]);
  const firstLine = (r.stderr || r.stdout || r.error || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (!r.ok) {
    return { ...base, error: r.code === null ? 'spawn-failed' : 'command-failed', evidence: firstLine.slice(0, 240) };
  }
  return { ok: true, id, action, instance: name, ...(firstLine ? { evidence: firstLine.slice(0, 240) } : {}) };
}

/**
 * 打开容器产品**自己的界面 / 控制台**（用户在那里自行创建实例）。
 *
 * 只对**已知的图形界面产品**给出可执行入口；不确定的一律返回 `opened:false` +
 * `reason:'no-known-gui'`，由界面改成给官方链接 —— 不猜路径、不乱启动进程。
 */
const GUI_LAUNCHERS: Record<string, { cmd: string; args: string[] }> = {
  docker: { cmd: 'docker', args: ['desktop'] },
  podman: { cmd: 'podman-desktop', args: [] },
  'rancher-desktop': { cmd: 'Rancher Desktop', args: [] },
};

export interface OpenAppResult {
  ok: boolean;
  id: string;
  opened: boolean;
  reason?: string;
  evidence?: string;
}

export async function openRuntimeApp(id: string): Promise<OpenAppResult> {
  const spec = GUI_LAUNCHERS[id];
  if (!spec) return { ok: false, id, opened: false, reason: 'no-known-gui' };
  const r = await run(spec.cmd, spec.args);
  const firstLine = (r.stderr || r.error || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (!r.ok) return { ok: false, id, opened: false, reason: 'spawn-failed', evidence: firstLine.slice(0, 240) };
  return { ok: true, id, opened: true };
}
