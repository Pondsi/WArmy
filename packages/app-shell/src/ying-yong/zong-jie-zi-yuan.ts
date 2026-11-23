/** 后台总结资源准入。遥测失败封闭、租约唯一、真AbortSignal传递；不卸载他人模型。 */
import os from 'node:os';
import { execFile } from 'node:child_process';
export interface ZongJieHouDuan { key: string; local: boolean; baseURL: string; model: string; context: number; unknownLocation?: boolean }
export interface ZongJieZiYuan { cpu: number; ramFree: number; ramTotal: number; gpus: Array<{ total: number; free: number; utilization: number }> }
/** context：后端本次实际采用的上下文；loaded：模型已在运行（请求须沿用它的上下文，否则后端会卸载重载）。 */
export interface ZongJieXuQiu { ram: number; vram: number; cpuOnly: boolean; cloud?: boolean; context?: number; loaded?: boolean }
export interface ZongJieZiYuanYiLai {
  tanCe: () => Promise<ZongJieZiYuan>;
  xuQiu: (backend: ZongJieHouDuan, signal: AbortSignal) => Promise<ZongJieXuQiu | null>;
  audit?: (reason: string) => void;
}
export function ziYuanKeZongJie(r: ZongJieZiYuan, n: ZongJieXuQiu | null): string | null {
  const GiB = 1073741824;
  if (!n || !Number.isFinite(n.ram) || !Number.isFinite(n.vram) || n.ram < 0 || n.vram < 0) return 'unknown-model-memory';
  if (!Number.isFinite(r.cpu) || r.cpu > 70 || r.cpu < 0) return 'cpu-busy';
  if (!Number.isFinite(r.ramFree) || !Number.isFinite(r.ramTotal) || r.ramTotal <= 0 || r.ramFree < 0 || r.ramFree > r.ramTotal) return 'unknown-ram';
  if (r.ramFree - n.ram < Math.max(r.ramTotal * 0.15, 2 * GiB)) return 'ram-low';
  if (n.cpuOnly) return null;
  // 未知设备分配或多GPU不能将空闲显存相加冒充单设备容量。
  if (r.gpus.length !== 1) return 'unknown-gpu-affinity';
  const g = r.gpus[0]!;
  if (![g.total, g.free, g.utilization].every(Number.isFinite) || g.total <= 0 || g.free < 0 || g.free > g.total || g.utilization < 0) return 'unknown-gpu';
  if (g.utilization > 60) return 'gpu-busy';
  if (g.free - n.vram < Math.max(g.total * 0.2, GiB / 2)) return 'vram-low';
  return null;
}
export function chuangJianZongJieZiYuan(yiLai: ZongJieZiYuanYiLai) {
  const active = new Map<string, { controller: AbortController; local: boolean }>();
  const foreground = new Map<string, { count: number; local: boolean }>();
  let cache: { ts: number; value: ZongJieZiYuan } | undefined;
  let probe: Promise<ZongJieZiYuan> | undefined;
  const conflict = (b: ZongJieHouDuan) => [...foreground].some(([key, f]) => key === b.key || (f.local && b.local));
  function qianTai(b: ZongJieHouDuan): () => void {
    const f = foreground.get(b.key) || { count: 0, local: b.local }; f.count++; foreground.set(b.key, f);
    for (const [key, a] of active) if (key === b.key || (a.local && b.local)) a.controller.abort(new Error('foreground-preempted'));
    let released = false;
    return () => { if (released) return; released = true; if (--f.count <= 0) foreground.delete(b.key); };
  }
  async function pao<T>(b: ZongJieHouDuan, run: (signal: AbortSignal, need?: ZongJieXuQiu) => Promise<T>, parent: AbortSignal): Promise<T> {
    parent.throwIfAborted();
    if (b.unknownLocation) throw new Error('summary-resource-unknown-inference-location');
    if (conflict(b) || active.has(b.key) || (b.local && [...active.values()].some((a) => a.local))) throw new Error('summary-resource-busy');
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal, AbortSignal.timeout(60000)]);
    active.set(b.key, { controller, local: b.local });
    let need: ZongJieXuQiu | null | undefined;
    try {
      if (b.local) {
        need = await yiLai.xuQiu(b, signal);
        signal.throwIfAborted();
        // Ollama也能代理云端；只有元数据明确cloud才跳过本机探测。
        if (!need?.cloud) {
          if (!need) throw new Error('summary-resource-unknown-model-memory');
          if (!cache || Date.now() - cache.ts > 5000) {
            probe ||= yiLai.tanCe();
            try { cache = { ts: Date.now(), value: await probe }; } finally { probe = undefined; }
          }
          const why = ziYuanKeZongJie(cache.value, need);
          if (why) { yiLai.audit?.(why); throw new Error('summary-resource-' + why); }
        }
      }
      if (conflict(b)) throw new Error('summary-resource-busy');
      signal.throwIfAborted();
      const result = await run(signal, need || undefined); signal.throwIfAborted(); return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('summary-preempted');
      throw error;
    } finally { active.delete(b.key); }
  }
  function guanBi(): void { for (const a of active.values()) a.controller.abort(); }
  return { pao, qianTai, guanBi };
}
const cpuNow = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((s, n) => s + n, 0) }), { idle: 0, total: 0 });
export async function tanCeZongJieZiYuan(): Promise<ZongJieZiYuan> {
  const before = cpuNow();
  const gpu = new Promise<string>((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=memory.total,memory.free,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2000, maxBuffer: 16384 }, (error, stdout) => resolve(error ? '' : stdout));
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = cpuNow(); const dt = after.total - before.total;
  const raw = await gpu;
  return { cpu: dt > 0 ? 100 * (1 - (after.idle - before.idle) / dt) : NaN, ramFree: os.freemem(), ramTotal: os.totalmem(),
    gpus: raw.trim().split('\n').filter(Boolean).map((l) => l.split(',').map(Number)).filter((x) => x.length === 3 && x.every(Number.isFinite)).map((x) => ({ total: x[0]! * 1048576, free: x[1]! * 1048576, utilization: x[2]! })) };
}
/**
 * Ollama现有已配置端点的只读探测；不联网下载、不自动加载。
 * 上下文与运行中的模型保持一致：请求的 num_ctx 与运行实例不同（包括不传而默认值不同）时，后端会卸载重载整个模型，
 * 打断正在用它的前台（实测 Ollama 0.40 日志可见 starting llama-server）。未加载时只认 Modelfile 的 num_ctx（不超架构上限），
 * 都拿不到 ⇒ 未知，跳过该候选。
 */
export async function ollamaZongJieXuQiu(b: ZongJieHouDuan, signal: AbortSignal): Promise<ZongJieXuQiu | null> {
  const read = async (endpoint: string, body?: unknown) => {
    const r = await fetch(b.baseURL.replace(/\/+$/, '') + '/api/' + endpoint, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
    if (!r.ok) throw new Error('summary-metadata-unavailable'); return await r.json() as Record<string, any>;
  };
  try {
    const meta = await read('show', { model: b.model });
    if (typeof meta.remote_host === 'string' && /^https:\/\//.test(meta.remote_host) && typeof meta.remote_model === 'string' && meta.remote_model) return { ram: 0, vram: 0, cpuOnly: true, cloud: true };
    const ps = await read('ps');
    const loaded = (Array.isArray(ps.models) ? ps.models : []).find((m: any) => m.name === b.model || m.model === b.model);
    const info = meta.model_info || {}; const arch = info['general.architecture'];
    const layers = Number(info[arch + '.block_count']), heads = Number(info[arch + '.attention.head_count']), kvHeads = Number(info[arch + '.attention.head_count_kv']);
    const embed = Number(info[arch + '.embedding_length']), archContext = Number(info[arch + '.context_length']);
    const declared = Number(/^\s*num_ctx\s+(\d+)\s*$/im.exec(String(meta.parameters || ''))?.[1]);
    const context = loaded ? Number(loaded.context_length)
      : Number.isInteger(declared) && declared >= 1024 ? (Number.isFinite(archContext) && archContext > 0 ? Math.min(declared, archContext) : declared) : NaN;
    if (!Number.isInteger(context) || context < 1024 || context > 1048576) return null;
    // 已加载：KV 已按运行中上下文分配，同上下文请求不新增大块显存，只留工作余量。
    if (loaded && Number.isFinite(loaded.size_vram)) return { ram: 256 * 1048576, vram: loaded.size_vram > 0 ? 256 * 1048576 : 0, cpuOnly: loaded.size_vram === 0, context, loaded: true };
    if (![layers, heads, kvHeads, embed].every((x) => Number.isFinite(x) && x > 0)) return null;
    const kv = 2 * layers * kvHeads * (embed / heads) * context * 4 + 256 * 1048576;
    const tags = await read('tags');
    const model = (tags.models || []).find((m: any) => m.name === b.model || m.model === b.model);
    if (!(Number(model?.size) > 0)) return null;
    return { ram: Number(model.size) * 1.25 + kv, vram: Number(model.size) * 1.25 + kv, cpuOnly: false, context };
  } catch { return null; }
}
/** 保守 token 估算：CJK 每字 1、其余约 3 字符 1、每条消息另加 16；只用于防止本地后端静默截断。 */
export function zongJieTokenGuSuan(xiaoXiJi: ReadonlyArray<{ content?: unknown }>): number {
  let n = 0;
  for (const m of xiaoXiJi || []) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    n += 16;
    for (const ch of text) n += /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1 : 0.34;
  }
  return Math.ceil(n);
}
