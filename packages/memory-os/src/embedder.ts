/**
 * 被动水合嵌入器：bge-small-zh-v1.5 (ONNX int8, 512 维) —— 纯 WASM，零原生模块
 *
 * 不变量 #4：不加载任何 .node。onnxruntime-web 的 Node 入口就是 WASM 后端。
 * 不变量 #9 的前置条件：这里的 embed() 只负责把文本变成向量，
 * 作用域预过滤发生在 SQLite 查询侧（见 index.ts 的 scopeSeqFilter）。
 *
 * 运行时后端顺序：WASM SIMD → WASM(non-SIMD)，加载失败时不抛给调用方，
 * 而是把原因记进 status，向量通道自动降级为"不可用"（FTS 两路仍可用）。
 *
 * 依赖落地说明：onnxruntime-web（纯 WASM，无 .node）是向量通道的运行依赖。
 * 本次改动刻意没有写进 packages/memory-os/package.json —— 那会与冻结的 pnpm-lock.yaml
 * 不一致（CI 的 --frozen-lockfile 会失败），而 lock 文件不在本次改动范围内。
 * 因此这里用"逐级解析 + 显式搜索路径 + 优雅降级"：生产打包时把 onnxruntime-web 加进
 * memory-os 的 dependencies（并更新 lock），或把 CCA_ONNX_ORT_PATH 指到随包分发的目录即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { BertWordPieceFenCiQi, type FenciqiPeizhiHuixian } from './tokenizer.js';

const require = createRequire(import.meta.url);

/** wasm-feature-detect 的 SIMD 探测模块 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function tanCeWasmSimd(): boolean {
  try {
    // lib 里没有 DOM，WebAssembly 走 globalThis 取（运行时由 Node 提供）
    const WA = (globalThis as any).WebAssembly;
    if (!WA?.validate) return false;
    return WA.validate(SIMD_PROBE) === true;
  } catch {
    return false;
  }
}

export interface QianruqiXuanxiang {
  /** model_quantized.onnx 路径 */
  modelPath: string;
  /** tokenizer.json 路径；默认与 modelPath 同目录下的 tokenizer.json */
  tokenizerPath?: string;
  /** onnxruntime-web 的额外搜索目录（用于本仓库未安装依赖的场景） */
  ortSearchPaths?: string[];
  /** WASM 线程数，默认 1（Node 子进程内最稳） */
  threads?: number;
  /** 单条最大 token 数，默认 256 */
  maxLength?: number;
  /** 检索侧 query 前缀（bge v1.5 不需要，保留开关） */
  queryPrefix?: string;
}

export interface XiangliangZhuangtai {
  ready: boolean;
  reason: string;
  backend: 'wasm-simd' | 'wasm-basic' | 'none';
  dim: number;
  simdSupported: boolean;
  threads: number;
  modelPath: string | null;
  tokenizerPath: string | null;
  modelBytes: number;
  ortMain: string | null;
  ortTried: string[];
  loadMs: number;
  embeds: number;
  embedTotalMs: number;
  lastEmbedMs: number;
  maxLength: number;
  queryPrefix: string;
  tokenizer: FenciqiPeizhiHuixian | null;
}

export interface OrtChuli {
  ort: any;
  main: string;
  tried: string[];
}

/** 逐级解析 onnxruntime-web：先常规 require，再按显式搜索目录 require */
export function loadOnnxRuntime(searchPaths: string[] = []): OrtChuli {
  const tried: string[] = [];
  try {
    const main = require.resolve('onnxruntime-web');
    tried.push('require:onnxruntime-web');
    return { ort: require('onnxruntime-web'), main, tried };
  } catch (e: any) {
    tried.push(`require:onnxruntime-web -> ${e?.code || e?.message}`);
  }
  for (const p of searchPaths) {
    const target = path.join(p, 'onnxruntime-web');
    try {
      const main = require.resolve(target);
      tried.push(`require:${target}`);
      return { ort: require(target), main, tried };
    } catch (e: any) {
      tried.push(`require:${target} -> ${e?.code || e?.message}`);
    }
  }
  throw Object.assign(new Error(`onnxruntime-web 不可用（尝试：${tried.join(' | ')}）`), { code: 'ORT_MISSING' });
}

export class OnnxQianruqi {
  readonly status: XiangliangZhuangtai;
  private ort: any;
  private session: any;
  private tokenizer: BertWordPieceFenCiQi;
  private maxLength: number;
  private queryPrefix: string;

  private constructor(ort: any, session: any, tokenizer: BertWordPieceFenCiQi, status: XiangliangZhuangtai, opts: QianruqiXuanxiang) {
    this.ort = ort;
    this.session = session;
    this.tokenizer = tokenizer;
    this.status = status;
    this.maxLength = opts.maxLength ?? 256;
    this.queryPrefix = opts.queryPrefix ?? '';
  }

  static async create(opts: QianruqiXuanxiang): Promise<OnnxQianruqi> {
    const tokenizerPath = opts.tokenizerPath ?? path.join(path.dirname(opts.modelPath), 'tokenizer.json');
    const t0 = Date.now();
    const status: XiangliangZhuangtai = {
      ready: false,
      reason: '',
      backend: 'none',
      dim: 0,
      simdSupported: tanCeWasmSimd(),
      threads: opts.threads ?? 1,
      modelPath: opts.modelPath,
      tokenizerPath,
      modelBytes: 0,
      ortMain: null,
      ortTried: [],
      loadMs: 0,
      embeds: 0,
      embedTotalMs: 0,
      lastEmbedMs: 0,
      maxLength: opts.maxLength ?? 256,
      queryPrefix: opts.queryPrefix ?? '',
      tokenizer: null,
    };

    if (!fs.existsSync(opts.modelPath)) {
      status.reason = `ONNX_MODEL_MISSING: ${opts.modelPath}`;
      throw Object.assign(new Error(status.reason), { code: 'ONNX_MODEL_MISSING', status });
    }
    if (!fs.existsSync(tokenizerPath)) {
      status.reason = `TOKENIZER_MISSING: ${tokenizerPath}`;
      throw Object.assign(new Error(status.reason), { code: 'TOKENIZER_MISSING', status });
    }
    status.modelBytes = fs.statSync(opts.modelPath).size;

    const tokenizer = BertWordPieceFenCiQi.fromFile(tokenizerPath);
    status.tokenizer = tokenizer.config;

    let handle: OrtChuli;
    try {
      handle = loadOnnxRuntime(opts.ortSearchPaths ?? []);
    } catch (e: any) {
      status.reason = e?.message || String(e);
      status.ortTried = [];
      throw Object.assign(e, { status, code: 'ORT_MISSING' });
    }
    const ort = handle.ort;
    status.ortMain = handle.main;
    status.ortTried = handle.tried;

    // wasmPaths 必须是 file:// URL（onnxruntime-web 内部走 ESM 动态 import，
    // Windows 盘符路径会被 ESM loader 拒绝：ERR_UNSUPPORTED_ESM_URL_SCHEME）
    const wasmMulu = path.dirname(handle.main) + path.sep;
    const attempts: Array<{ name: 'wasm-simd' | 'wasm-basic'; simd: boolean; setPaths: boolean }> = [
      { name: 'wasm-simd', simd: true, setPaths: true },
      { name: 'wasm-simd', simd: true, setPaths: false },
      { name: 'wasm-basic', simd: false, setPaths: true },
      { name: 'wasm-basic', simd: false, setPaths: false },
    ];

    let lastErr: any = null;
    for (const at of attempts) {
      if (at.simd && !status.simdSupported) continue;
      try {
        if (at.setPaths) ort.env.wasm.wasmPaths = pathToFileURL(wasmMulu).href;
        else delete (ort.env.wasm as any).wasmPaths;
        ort.env.wasm.simd = at.simd;
        ort.env.wasm.numThreads = status.threads;
        if (ort.env.logLevel !== undefined) ort.env.logLevel = 'error';
        const session = await ort.InferenceSession.create(opts.modelPath, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        if (!session.inputNames.includes('input_ids')) {
          throw new Error(`unexpected model inputs: ${session.inputNames.join(',')}`);
        }
        status.backend = at.name;
        status.ready = true;
        status.reason = `ok(wasmPaths=${at.setPaths ? 'file-url' : 'default'})`;
        status.loadMs = Date.now() - t0;
        const outputs = session.outputNames;
        const emb = new OnnxQianruqi(ort, session, tokenizer, status, opts);
        const probe = await emb.embed('维度探测', { raw: true });
        status.dim = probe.length;
        status.embeds = 0;
        status.embedTotalMs = 0;
        status.lastEmbedMs = 0;
        (status as any).outputs = outputs;
        return emb;
      } catch (e: any) {
        lastErr = e;
        status.reason = `${at.name}${at.setPaths ? '+paths' : ''}: ${e?.message || e}`;
      }
    }
    status.loadMs = Date.now() - t0;
    if (!status.reason) status.reason = String(lastErr?.message || lastErr || 'unknown');
    throw Object.assign(new Error(`WASM 后端不可用：${status.reason}`), { code: 'ORT_BACKEND', status });
  }

  get dim(): number {
    return this.status.dim;
  }

  get tokenizerConfig(): FenciqiPeizhiHuixian {
    return this.tokenizer.config;
  }

  /** 文本 → L2 归一化 512 维向量（bge 用 CLS pooling） */
  async embed(text: string, o: { raw?: boolean } = {}): Promise<Float32Array> {
    const input = o.raw ? text : this.queryPrefix + text;
    const enc = this.tokenizer.encode(input, { maxLength: this.maxLength });
    const ids = BigInt64Array.from(enc.ids.map((v) => BigInt(v)));
    const mask = BigInt64Array.from(enc.attentionMask.map((v) => BigInt(v)));
    const leixing = BigInt64Array.from(enc.tokenTypeIds.map((v) => BigInt(v)));
    const n = enc.ids.length;
    const feeds: Record<string, any> = {
      input_ids: new this.ort.Tensor('int64', ids, [1, n]),
      attention_mask: new this.ort.Tensor('int64', mask, [1, n]),
      token_type_ids: new this.ort.Tensor('int64', leixing, [1, n]),
    };
    const t0 = Date.now();
    const out = await this.session.run(feeds);
    const key = this.session.outputNames.includes('last_hidden_state') ? 'last_hidden_state' : this.session.outputNames[0];
    const lhs = out[key];
    const dim = lhs.dims[2] as number;
    const data = lhs.data as Float32Array;
    const vec = new Float32Array(dim);
    let guiFanHua = 0;
    for (let i = 0; i < dim; i++) {
      const v = data[i] ?? 0; // CLS = 第 0 个 token
      vec[i] = v;
      guiFanHua += v * v;
    }
    guiFanHua = Math.sqrt(guiFanHua);
    if (guiFanHua > 0) {
      for (let i = 0; i < dim; i++) vec[i] = (vec[i] as number) / guiFanHua;
    }
    const dt = Date.now() - t0;
    this.status.embeds += 1;
    this.status.embedTotalMs += dt;
    this.status.lastEmbedMs = dt;
    return vec;
  }

  tokenize(text: string): string[] {
    return this.tokenizer.tokenize(text);
  }
}

/** 默认模型搜索路径：显式配置 → 环境变量 → 本仓库 spike 资产 → dataDir/models */
export function morenMoxingHouxuan(dataDir?: string, env = process.env): Array<{ modelPath: string; tokenizerPath: string; from: string }> {
  const out: Array<{ modelPath: string; tokenizerPath: string; from: string }> = [];
  if (env.CCA_ONNX_MODEL) {
    out.push({
      modelPath: env.CCA_ONNX_MODEL,
      tokenizerPath: env.CCA_ONNX_TOKENIZER || path.join(path.dirname(env.CCA_ONNX_MODEL), 'tokenizer.json'),
      from: 'env:CCA_ONNX_MODEL',
    });
  }
  if (dataDir) {
    out.push({
      modelPath: path.join(dataDir, 'models', 'model_quantized.onnx'),
      tokenizerPath: path.join(dataDir, 'models', 'tokenizer.json'),
      from: 'dataDir/models',
    });
  }
  // 仓库内开发资产（spike-07 实测资产，打包时由 electron-builder extraResources 提供）
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, 'spikes', 'spike-07-onnx', 'models', 'model_quantized.onnx');
    if (fs.existsSync(cand)) {
      out.push({
        modelPath: cand,
        tokenizerPath: path.join(path.dirname(cand), 'tokenizer.json'),
        from: `repo:${dir}`,
      });
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

export function ortSearchCandidates(env = process.env): string[] {
  const paths: string[] = [];
  if (env.CCA_ONNX_ORT_PATH) paths.push(env.CCA_ONNX_ORT_PATH);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    paths.push(path.join(dir, 'spikes', 'node_modules'));
    paths.push(path.join(dir, 'node_modules'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return paths;
}
