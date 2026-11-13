/**
 * conversation-runner —— 对话进程级隔离的**子进程入口**（R190 项5 P0）。
 *
 * 口径（对话进程级隔离强制规范）：
 *  · 每个对话的编排/执行跑在**独立 PID** 的子进程；主进程只做网关收口授权。
 *  · 子进程 env 由宿主白名单注入，**密钥明文不进子进程**（模型调用/敏感工具回宿主裁决）。
 *  · 子进程定期上报 RSS/heap，宿主据此做**内存回收**（防溢出）；空闲超时由宿主回收。
 *  · 三条退出通道（shutdown 消息 / disconnect / SIGTERM·SIGINT），不留孤儿进程。
 *
 * 本文件是 P0 运行时骨架：真实隔离执行 harness + 任务注册表 + 心跳上报。
 * P1 把主对话编排循环（yunXingLiaoTianXunHuan 等）迁入 registerTask('chat-turn', …)。
 * 工具调用一律经 tool-request 回宿主授权执行（choke point 不下放）。
 */

import { liaoTianDaiGongJu } from '@warmy/providers';
import * as readline from 'node:readline';

type Handler = (payload: any, ctx: RunnerCtx) => any | Promise<any>;
interface RunnerCtx { sessionId: string; workspace: string; requestTool: (tool: string, args: any, timeoutMs?: number) => Promise<any>; log: (msg: string) => void; }
interface PendingTool { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }

/** R209 z1：VM-backed IPC 走 stdio JSON-line（guest 内 Node 无 process.send）。 */
const BIAO_ZHUN = process.env.WARMY_VM_STDIO === '1';
function send(m: any): void {
  try {
    if (BIAO_ZHUN) process.stdout.write(JSON.stringify(m) + '\n');
    else process.send?.(m);
  } catch { /* 管道断不影响退出 */ }
}

/** 任务注册表：kind → handler。P1 在此注册真实对话回合。 */
const tasks = new Map<string, Handler>();
function registerTask(kind: string, handler: Handler): void { tasks.set(kind, handler); }

/** 向宿主请求执行一个需授权的工具（宿主裁决后回 tool-result）。 */
const pendingTools = new Map<string, PendingTool>();
let toolSeq = 0;
function requestTool(tool: string, args: any, timeoutMs = 60000): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = 't' + (++toolSeq);
    const timer = setTimeout(() => { pendingTools.delete(id); reject(new Error('tool-timeout')); }, timeoutMs);
    timer.unref?.();
    pendingTools.set(id, { resolve, reject, timer });
    send({ type: 'tool-request', id, tool, args });
  });
}

const ctx: RunnerCtx = {
  sessionId: '',
  workspace: process.env.WARMY_WORKSPACE || process.cwd(),
  requestTool,
  log: (msg) => send({ type: 'log', msg: String(msg) }),
};

/** 当前在途回合的取消器（宿主 abort 消息 ⇒ 掐断引擎/在途模型请求）。 */
let dangQianKongZhi: AbortController | null = null;

/* ── P0 内置任务（真实可跑，供门禁与自检；P1 增 chat-turn） ── */
registerTask('selftest', () => ({
  pid: process.pid,
  ppid: process.ppid,
  sessionId: ctx.sessionId,
  // 证明密钥不在子进程 env：只回布尔，绝不回显任何值
  envHasSecret: Object.keys(process.env).some((k) => /SECRET|TOKEN|PASSWORD|API[_-]?KEY/i.test(k)),
  envKeys: Object.keys(process.env).filter((k) => /^(WARMY_|ELECTRON_|PATH$|TEMP$|TMP$|SystemRoot$)/i.test(k)),
  rss: process.memoryUsage().rss,
}));
registerTask('echo', (p) => ({ echo: p && p.text != null ? String(p.text) : '' }));
registerTask('compute', (p) => {
  // 纯 CPU 任务：证明重计算在子进程、不卡宿主事件循环
  const n = Math.max(1, Math.min(20000000, Number(p && p.n) || 1000000));
  let s = 0; for (let i = 0; i < n; i++) s += Math.sqrt(i);
  return { n, sum: s, pid: process.pid };
});
registerTask('alloc', (p) => {
  // 门禁专用：故意抬高 RSS 以验证宿主内存回收（生产不调用）
  const mb = Math.max(1, Math.min(512, Number(p && p.mb) || 64));
  (globalThis as any).__allocHold = Buffer.alloc(mb * 1024 * 1024, 7); // 持有不释放，让 RSS 真实上升
  return { mb, rss: process.memoryUsage().rss, pid: process.pid };
});
registerTask('tool-echo', async (p, c) => {
  // 证明工具调用经宿主授权网关（choke point 不下放）
  const v = await c.requestTool('demo-tool', { text: p && p.text });
  return { viaGateway: true, result: v, pid: process.pid };
});
registerTask('crash', () => { process.exit(1); }); // 门禁专用：验证崩溃隔离

/**
 * P1：对话回合在隔离子进程编排。LLM 调用与工具一律回宿主授权执行（密钥不下放）。
 * 宿主 onTool 处理 'llm-call'（握密钥做真实模型调用）与其它工具（授权裁决）。
 * 子进程只负责编排循环，不碰密钥/不直接执行敏感工具。
 */
registerTask('chat-turn', async (p, c) => {
  const messages = Array.isArray(p?.messages) ? [...p.messages] : [];
  const model = String(p?.model || '');
  const maxRounds = Math.max(1, Math.min(12, Number(p?.maxRounds) || 6));
  const toolCalls: Array<{ tool: string; ok: boolean }> = [];
  let reply = '';
  for (let round = 0; round < maxRounds; round++) {
    const llm = await c.requestTool('llm-call', { messages, model, round });
    if (llm && Array.isArray(llm.toolCalls) && llm.toolCalls.length) {
      for (const tc of llm.toolCalls) {
        const r = await c.requestTool(String(tc.tool), tc.args);
        toolCalls.push({ tool: String(tc.tool), ok: !!(r && r.ok !== false) });
        messages.push({ role: 'tool', tool: String(tc.tool), content: JSON.stringify(r ?? null) });
      }
      continue;
    }
    reply = String(llm?.content ?? llm?.reply ?? '');
    break;
  }
  return { reply, toolCalls, pid: process.pid, isolated: true };
});

/**
 * P1 x2：主对话编排引擎（liaoTianDaiGongJu）**默认在隔离子进程跑**。
 * provider / execute / opts 回调一律经 requestTool 回宿主网关裁决（密钥不下放）。
 * 宿主握密钥做真实模型调用并把流式增量直接广播给界面；子进程只拿最终结果做编排。
 */
registerTask('chat-engine', async (p, c) => {
  const ctrl = new AbortController();
  dangQianKongZhi = ctrl;
  const meta = (p?.providerMeta || {}) as { protocol?: string; baseURL?: string; supportsTools?: boolean };
  const llm = (method: string, qiu: unknown) => c.requestTool('llm-call', { method, qiu }, 600000);
  const provider = {
    protocol: meta.protocol || 'openai-compatible',
    baseURL: meta.baseURL || '',
    supportsTools: meta.supportsTools,
    chat: (q: unknown) => llm('chat', q),
    chatStream: (q: unknown) => llm('chatStream', q),
    listModels: () => llm('listModels', null),
    ping: () => llm('ping', null),
  };
  const execute = (call: unknown, ctx2: unknown) => c.requestTool('tool-exec', { call, ctx: ctx2 }, 600000) as Promise<string>;
  const o = (p?.opts || {}) as Record<string, unknown>;
  const opts = {
    ...o,
    signal: ctrl.signal,
    xuYuSuanLai: (k: unknown) => c.requestTool('opt', { name: 'xuYuSuanLai', k }, 30000),
    onEvent: (e: unknown) => { void c.requestTool('opt', { name: 'onEvent', e }, 30000).catch(() => { /* 观测钩子失败不影响编排 */ }); },
    yaSuoLai: (x: unknown, j: unknown) => c.requestTool('opt', { name: 'yaSuoLai', xiaoXiJi: x, jiYa: j }, 30000),
  };
  try {
    return await liaoTianDaiGongJu(provider as never, p?.qiu as never, execute as never, opts as never);
  } finally { dangQianKongZhi = null; }
});

/**
 * R208 y1：续派外壳（auto-continue）的**递归 sequencing 在子进程循环**。
 * 每一步（决策卡/ETA/插话/审计/派一轮）回宿主网关 xu-step 裁决；子进程只决定“要不要再派一步”。
 */
registerTask('chat-continue', async (p, c) => {
  let args: Record<string, unknown> = { xiaoXi: p?.xiaoXi, shangLun: p?.shangLun, yuPan: p?.yuPan };
  let turns = 0;
  for (let i = 0; i < 64; i++) {
    const r = await c.requestTool('xu-step', args, 1800000);
    turns += 1;
    if (!r || r.jiXu !== true) break;
    args = { ...args, shangLun: (r.next as { shangLun?: unknown } | undefined)?.shangLun, yuPan: undefined };
  }
  return { turns, pid: process.pid, isolated: true };
});

/* ── 消息处理 ── */
async function chuLiXiaoXi(m: any): Promise<void> {
  if (!m || typeof m !== 'object') return;
  if (m === 'ping' || m.type === 'ping') { send({ type: 'pong', pid: process.pid }); return; }
  if (m === 'shutdown' || m.type === 'shutdown') { zouBa(0); return; }
  if (m.type === 'abort') { try { dangQianKongZhi?.abort(); } catch { /* noop */ } return; }
  if (m.type === 'init') { ctx.sessionId = String(m.sessionId || ''); if (m.workspace) ctx.workspace = String(m.workspace); send({ type: 'ready', pid: process.pid, sessionId: ctx.sessionId }); return; }
  if (m.type === 'tool-result') {
    const w = pendingTools.get(String(m.id));
    if (w) { pendingTools.delete(String(m.id)); clearTimeout(w.timer); if (m.ok) w.resolve(m.value); else w.reject(new Error(String(m.error || 'tool-failed'))); }
    return;
  }
  if (m.type === 'run') {
    const taskId = String(m.taskId || '');
    const handler = tasks.get(String(m.kind || ''));
    if (!handler) { send({ type: 'result', taskId, ok: false, error: 'unknown-task:' + String(m.kind) }); return; }
    try {
      const value = await handler(m.payload, ctx);
      send({ type: 'result', taskId, ok: true, value });
    } catch (e) {
      send({ type: 'result', taskId, ok: false, error: String((e as Error)?.message || e) });
    }
    // 任务后立即上报 RSS，供宿主及时内存回收（不必等 5s 心跳）
    { const mu = process.memoryUsage(); send({ type: 'heartbeat', pid: process.pid, rss: mu.rss, heapUsed: mu.heapUsed, uptime: process.uptime() }); }
    return;
  }
}
process.on('message', (m: any) => { void chuLiXiaoXi(m); });
/** R209 z1：stdio 传输模式（VM 隧道）：stdin JSON-line 进，stdout JSON-line 出。 */
if (BIAO_ZHUN) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => { try { void chuLiXiaoXi(JSON.parse(line)); } catch { /* 坏行忽略 */ } });
  rl.on('close', () => zouBa(0));
}

/* ── 心跳：定期上报 RSS/heap，供宿主内存回收 ── */
const heartbeat = setInterval(() => {
  const mu = process.memoryUsage();
  send({ type: 'heartbeat', pid: process.pid, rss: mu.rss, heapUsed: mu.heapUsed, uptime: process.uptime() });
}, 5000);
heartbeat.unref?.();

/* ── 三条退出通道，缺一不可（不留孤儿） ── */
function zouBa(code = 0): void {
  clearInterval(heartbeat);
  for (const w of pendingTools.values()) clearTimeout(w.timer);
  pendingTools.clear();
  try { process.exit(code); } catch { /* noop */ }
}
process.on('disconnect', () => zouBa(0));
process.on('SIGTERM', () => zouBa(0));
process.on('SIGINT', () => zouBa(0));

send({ type: 'ready', pid: process.pid, sessionId: ctx.sessionId });