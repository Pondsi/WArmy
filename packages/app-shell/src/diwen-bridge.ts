/**
 * diwen-bridge —— 迪文（Diwen）融合桥（R192；R257 改 npm 包 + 子进程 RPC）。
 *
 * 统一三态门控（所有迪文化落点共用）：
 *  · 确定（结构化且校验通过）→ structured（迪文机器层 + GCF，给机器看）；
 *  · 不确定（仅原文 / 结构损坏）→ fallback-text（回退原文，自然语）；
 *  · 没有 → reject（不编造）；
 *  · 迪文不可用/未启用 → unavailable（回退原文，绝不阻断业务）。
 *
 * 红线：迪文只给机器看；**用户可见内容（知识库卡片搜索等）一律回退原文**；S8 非安全/加密层。
 * R257：集成 npm `diwen`（非插件）。npm 版可选增强 @node-rs/jieba 为 .node ——
 * 零原生约定下主/渲染进程不加载，仿 memory-os 先例整体放入独立 Node 子进程（diwen-worker.mjs），
 * 本桥经 JSON-line RPC 调用；私有迪文（用户自完善 + 总结自动完善）落 userData/diwen-private.json。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let qiYong = false; // 主进程按 settings.diwenEnabled 注入；首启落定前默认关
let siYouPath = '';
let siYouBaoDir = ''; // R263：私有包目录（~/.diwen/private 同口径，DIWEN_PRIVATE_DIR 注入）
let updateDir = ''; // R262：迪文安装更新后的目录（worker 优先加载）
let worker: ChildProcessWithoutNullStreams | null = null;
let workerFailed = false;
let daiId = 1;
const pending = new Map<number, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();

/** 启用开关（settings.diwenEnabled；首启简/繁中文默认开，换语言不变，手动可改）。 */
export function sheZhiDiwenQiYong(v: boolean): void { qiYong = !!v; if (v) workerFailed = false; }
export function diwenQiYong(): boolean { return qiYong; }
/** R262：迪文更新目录注入＋重启 worker（安装更新后生效）。 */
export function sheZhiDiwenUpdateDir(d: string): void { updateDir = String(d || ''); }
export function chongQiDiwenWorker(): void {
  if (worker) { try { worker.kill(); } catch { /* noop */ } worker = null; }
  workerFailed = false;
}
/** 私有迪文文件初始化（userData 目录）；不存在则建空数组。 */
export function chuShiHuaDiwenSiYou(dir: string): void {
  siYouPath = path.join(String(dir || ''), 'diwen-private.json');
  siYouBaoDir = path.join(String(dir || ''), 'diwen-private');
  try { if (!fs.existsSync(siYouPath)) fs.writeFileSync(siYouPath, '[]', 'utf8'); } catch { /* 落盘失败不阻断 */ }
  try { fs.mkdirSync(siYouBaoDir, { recursive: true }); } catch { /* noop */ }
}

function nodeLuJing(): string {
  const houXuan = [
    String(process.env.WARMY_NODE_PATH || ''),
    path.join(__dirname, '../../resources/node/win-x64/node.exe'), // 开发态：仓库根 resources/
    path.join(__dirname, '../../node/win-x64/node.exe'),          // 打包态：resources/app/dist → resources/node/
  ];
  for (const c of houXuan) { if (c && fs.existsSync(c)) return c; }
  return process.execPath;
}

function qiWorker(): Promise<ChildProcessWithoutNullStreams | null> {
  if (worker && !worker.killed && worker.exitCode == null) return Promise.resolve(worker);
  if (workerFailed) return Promise.resolve(null);
  try {
    const execPath = nodeLuJing();
    const useElectronAsNode = /electron(\.exe)?$/i.test(execPath);
    const w = spawn(execPath, [path.join(__dirname, 'diwen-worker.mjs')], {
      env: {
        ...process.env,
        DIWEN_PRIVATE_LEXICON: siYouPath,
        DIWEN_PRIVATE_DIR: siYouBaoDir,
        ...(updateDir ? { WARMY_DIWEN_DIR: updateDir } : {}),
        ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    worker = w;
    /** 子进程输出必须有人读（pipe 写满会卡死子进程）——stderr 进有界缓冲 */
    let errBuf = '';
    w.stderr.on('data', (d) => { errBuf = (errBuf + String(d)).slice(-4000); });
    const rl = readline.createInterface({ input: w.stdout });
    rl.on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (!m || typeof m.id !== 'number' || m.id === 0) return; // id 0 = ready 握手
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(m);
      } catch { /* 坏行忽略 */ }
    });
    w.on('exit', () => {
      worker = null;
      workerFailed = true;
      for (const [, p] of pending) { clearTimeout(p.timer); p.resolve(null); }
      pending.clear();
      if (errBuf) { try { console.error('[diwen-worker]', errBuf.slice(-800)); } catch { /* noop */ } }
    });
    w.on('error', () => { worker = null; workerFailed = true; });
    return Promise.resolve(w);
  } catch { workerFailed = true; return Promise.resolve(null); }
}

/** RPC 原始包（{ok,result,error}）；未启用且非 force → null；失败 → null（回退原文不阻断）。 */
async function dwCall(fn: string, args: any, force = false): Promise<any> {
  if (!qiYong && !force) return null;
  const w = await qiWorker();
  if (!w) return null;
  return new Promise((resolve) => {
    const id = daiId++;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, 20000);
    pending.set(id, { resolve, timer });
    try { w.stdin.write(JSON.stringify({ id, fn, args }) + '\n'); } catch { clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}

/** 懒加载探活（子进程 ready）；不可用/未启用回 null（调用方回退原文）。force 供设置页状态/试探。 */
export async function jiaZaiDiwen(force = false): Promise<any> {
  const r = await dwCall('ping', {}, force);
  return r && r.ok && r.result && r.result.ok ? { __rpc: true, version: r.result.version } : null;
}

export type DiwenMode = 'structured' | 'fallback-text' | 'reject' | 'unavailable';
export interface DiwenHuaJieGuo { mode: DiwenMode; text: string; diwen?: any; gcf?: string; }

/** 统一迪文化入口（三态门控）。 */
export async function diwenHua(input: { text?: string; doc?: any }): Promise<DiwenHuaJieGuo> {
  const text = String(input?.text ?? '');
  const dw = await jiaZaiDiwen();
  if (!dw) return { mode: 'unavailable', text };
  if (input?.doc) {
    const v = await dwCall('call', { fn: 'validateDocument', args: [input.doc] });
    if (v && v.ok && v.result && v.result.valid) {
      const g = await dwCall('call', { fn: 'encode', args: [input.doc] });
      const gcf = g && g.ok && g.result ? String(g.result.text || '') : '';
      return { mode: 'structured', text: text || String(input.doc.reasoning || ''), diwen: input.doc, ...(gcf ? { gcf } : {}) };
    }
    return { mode: 'fallback-text', text };
  }
  if (text) {
    const m = await dwCall('call', { fn: 'mapText', args: [text] });
    if (m && m.ok && m.result && m.result.status === 'STRUCTURED' && Array.isArray(m.result.words) && m.result.words.length) {
      const doc = { reasoning: text, words: m.result.words };
      const v = await dwCall('call', { fn: 'validateDocument', args: [doc] });
      if (v && v.ok && v.result && v.result.valid) {
        const g = await dwCall('call', { fn: 'encode', args: [doc] });
        const gcf = g && g.ok && g.result ? String(g.result.text || '') : '';
        return { mode: 'structured', text, diwen: doc, ...(gcf ? { gcf } : {}) };
      }
    }
    return { mode: 'fallback-text', text };
  }
  return { mode: 'reject', text: '' };
}

/** 用户可见搜索：**永远只回原文**（迪文只给机器）。 */
export async function diwenYongHuSouSuo(input: { text?: string; doc?: any }): Promise<string> {
  const r = await diwenHua(input);
  return r.text;
}

/** 结构校验。不可用回 {valid:false, unavailable:true}。 */
export async function diwenValidate(doc: any): Promise<{ valid: boolean; errors?: any[]; unavailable?: boolean }> {
  const r = await dwCall('call', { fn: 'validateDocument', args: [doc] });
  if (!r) return { valid: false, unavailable: true };
  if (!r.ok) return { valid: false, errors: [String(r.error || '')] };
  return { valid: !!r.result?.valid, errors: r.result?.errors || [] };
}

/** GCF 编码。不可用回 null。 */
export async function gcfBianMa(doc: any): Promise<string | null> {
  const r = await dwCall('call', { fn: 'encode', args: [doc] });
  return r && r.ok && r.result ? String(r.result.text || '') || null : null;
}

/** 三态知识库句柄（KB 活在子进程；query 走 RPC，worker 内用迪文校验）。不可用回 null。 */
export async function diwenZhiShiKu(entries: any[]): Promise<{ query: (q: string) => Promise<{ state: string } | null> } | null> {
  const dw = await jiaZaiDiwen();
  if (!dw) return null;
  return { query: async (q: string) => { const r = await dwCall('kbQuery', { entries, query: q }); return r && r.ok ? r.result : null; } };
}

/** 智能体互通迪文化。 */
export async function zhiNengTiJiaoHuan(facts: { text?: string; doc?: any }): Promise<{ payload: DiwenHuaJieGuo; yuanWen: string }> {
  const payload = await diwenHua(facts);
  return { payload, yuanWen: payload.text };
}

/** NL→迪文基线映射（mapText 三态）。 */
export async function diwenYingShe(text: string): Promise<{ status: string; words: any[]; coverage: number; unavailable?: boolean }> {
  const r = await dwCall('call', { fn: 'mapText', args: [String(text || '')] });
  if (!r) return { status: 'REJECT', words: [], coverage: 0, unavailable: true };
  if (!r.ok || !r.result) return { status: 'REJECT', words: [], coverage: 0 };
  return { status: r.result.status, words: r.result.words || [], coverage: r.result.coverage || 0 };
}

/** 规范化 + 内容哈希。 */
export async function diwenGuiFanHua(doc: any): Promise<{ canonical?: string; hash?: string; unavailable?: boolean }> {
  const a = await dwCall('call', { fn: 'canonicalJson', args: [doc] });
  const b = await dwCall('call', { fn: 'contentHash', args: [doc] });
  if (!a && !b) return { unavailable: true };
  return { ...(a && a.ok ? { canonical: a.result } : {}), ...(b && b.ok ? { hash: String(b.result) } : {}) };
}

/** DRS 三值判定。 */
export async function diwenPanDing(drs: any, opts?: any): Promise<{ decision: string; unavailable?: boolean }> {
  const r = await dwCall('call', { fn: 'decideDrs', args: [drs, opts] });
  if (!r) return { decision: 'unknown', unavailable: true };
  return { decision: String(r.result?.decision ?? r.result ?? 'unknown') };
}

/** 文档等价判定。 */
export async function diwenXiangDeng(a: any, b: any): Promise<boolean> {
  const r = await dwCall('call', { fn: 'equivalentDocs', args: [a, b] });
  return !!(r && r.ok && r.result);
}

// ── R257：启用状态 / 私有迪文 / 总结完善 ──
/** 设置页状态（force：未启用也能看版本/词根数）。 */
export async function diwenZhuangTai(): Promise<{ ok: boolean; available: boolean; enabled: boolean; version?: string; size?: number; privateCount?: number; jieba?: boolean }> {
  const r = await dwCall('status', {}, true);
  if (!r || !r.ok || !r.result) return { ok: true, available: false, enabled: qiYong };
  return { ok: true, available: true, enabled: qiYong, version: r.result.version, size: r.result.size, privateCount: r.result.privateCount, jieba: !!r.result.jieba };
}
/** 私有词根变更后刷新子进程词典缓存。 */
export async function shuaXinDiwenCiDian(): Promise<boolean> {
  const r = await dwCall('refresh', {}, true);
  return !!(r && r.ok);
}
/** 读私有迪文列表（原始数组，含 source/definitionZh）。 */
export async function duSiYouDiwen(): Promise<any[]> {
  const r = await dwCall('privateList', {}, true);
  return r && r.ok && Array.isArray(r.result) ? r.result : [];
}
function xieSiYou(all: any[]): boolean {
  if (!siYouPath) return false;
  try { fs.writeFileSync(siYouPath, JSON.stringify(all, null, 2), 'utf8'); return true; } catch { return false; }
}
/** 添加私有概念（worker 校验 id/坐标/原型污染/上限；主进程落盘+刷新）。 */
export async function tianJiaSiYouDiwen(p: { word?: string; meaning?: string; bfoType?: string }): Promise<{ ok: boolean; root?: any; count?: number; errors?: string[] }> {
  const r = await dwCall('privateAdd', { word: p?.word, meaning: p?.meaning, bfoType: p?.bfoType, source: 'user' }, true);
  if (!r || !r.ok || !r.result || !r.result.ok) return { ok: false, errors: (r && r.result && r.result.errors) || [String(r?.error || '迪文不可用')] };
  if (!xieSiYou(r.result.all)) return { ok: false, errors: ['私有迪文落盘失败'] };
  await shuaXinDiwenCiDian();
  return { ok: true, root: r.result.root, count: r.result.all.length };
}
/** 删除私有概念。 */
export async function shanChuSiYouDiwen(id: number): Promise<{ ok: boolean; count?: number; errors?: string[] }> {
  const r = await dwCall('privateRemove', { id }, true);
  if (!r || !r.ok || !r.result || !r.result.ok) return { ok: false, errors: (r && r.result && r.result.errors) || [String(r?.error || '迪文不可用')] };
  if (!xieSiYou(r.result.all)) return { ok: false, errors: ['私有迪文落盘失败'] };
  await shuaXinDiwenCiDian();
  return { ok: true, count: r.result.all.length };
}
/** 设置页试探映射（force：未启用也可预览；返回覆盖/未覆盖片段）。 */
export async function diwenShiTan(text: string): Promise<{ status: string; coverage: number; words: any[]; uncovered: string[]; unavailable?: boolean }> {
  const r = await dwCall('call', { fn: 'mapText', args: [String(text || '')] }, true);
  if (!r || !r.ok || !r.result) return { status: 'REJECT', coverage: 0, words: [], uncovered: [], unavailable: true };
  return {
    status: r.result.status, coverage: r.result.coverage || 0, words: r.result.words || [],
    uncovered: (r.result.uncovered || []).slice(0, 12).map((s: any) => String(s.surface || '')),
  };
}
/** 总结时完善迪文本身：挖高频未覆盖概念→私有词根（每轮≤3，硬门禁校验/上限）。未启用跳过。 */
export async function zongJieGaiJinDiwen(text: string): Promise<{ ok: boolean; added?: number; skipped?: string; errors?: string[] }> {
  if (!qiYong) return { ok: false, skipped: 'disabled' };
  const r = await dwCall('improve', { text: String(text || '') });
  if (!r || !r.ok || !r.result || !r.result.ok) return { ok: false, errors: (r && r.result && r.result.errors) || [String(r?.error || '迪文不可用')] };
  const added = Array.isArray(r.result.added) ? r.result.added.length : 0;
  if (added > 0) {
    if (!xieSiYou(r.result.all)) return { ok: false, errors: ['私有迪文落盘失败'] };
    await shuaXinDiwenCiDian();
  }
  return { ok: true, added };
}

// ── R263：私有包（导入/导出/冲突裁决/卸载，diwen@6.10.1 规范） ──
/** 列出已装私有包（含本机单文件伪包 __legacy__）。 */
export async function diwenSiYouBaoLieBiao(): Promise<any[]> {
  const r = await dwCall('pkgList', {}, true);
  return r && r.ok && Array.isArray(r.result) ? r.result : [];
}
/** 导入私有包（撞基础整包拒；私有间冲突自动裁决）。 */
export async function diwenSiYouBaoDaoRu(p: string): Promise<{ ok: boolean; errors?: string[]; conflicts?: any; added?: number; remapped?: number }> {
  const r = await dwCall('pkgImport', { path: String(p || '') }, true);
  if (!r || !r.ok || !r.result) return { ok: false, errors: [String(r?.error || '迪文不可用')] };
  return r.result;
}
/** 导出当前私有概念为规范包（manifest/concepts/candidates/enhance）。 */
export async function diwenSiYouBaoDaoChu(p: string, ns?: string, name?: string): Promise<{ ok: boolean; concepts?: number; warnings?: string[]; errors?: string[] }> {
  const r = await dwCall('pkgExport', { path: String(p || ''), namespace: ns, name }, true);
  if (!r || !r.ok || !r.result) return { ok: false, errors: [String(r?.error || '迪文不可用')] };
  return r.result;
}
/** 卸载私有包（完美卸载：基础零丢失，冲突自动重裁决）；__legacy__＝清空本机单文件。 */
export async function diwenSiYouBaoShanChu(ns: string): Promise<{ ok: boolean; errors?: string[]; all?: any[]; legacyCleared?: boolean }> {
  const r = await dwCall('pkgUninstall', { namespace: String(ns || '') }, true);
  if (!r || !r.ok || !r.result) return { ok: false, errors: [String(r?.error || '迪文不可用')] };
  if (r.result.legacyCleared && Array.isArray(r.result.all)) {
    if (!xieSiYou(r.result.all)) return { ok: false, errors: ['私有迪文落盘失败'] };
  }
  await shuaXinDiwenCiDian();
  return r.result;
}