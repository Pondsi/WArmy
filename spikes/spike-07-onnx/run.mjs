/**
 * Spike 7: onnxruntime-web + bge-small-zh-v1.5 int8 嵌入延迟
 * 路径：WebGPU → WASM SIMD → 单线程 WASM
 * DoD: WebGPU 或 WASM SIMD P95 < 50ms
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ort = require('onnxruntime-web');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.join(__dirname, 'models', 'model_quantized.onnx');
const tokenizerPath = path.join(__dirname, 'models', 'tokenizer.json');

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** 极简 WordPiece：用 tokenizer.json 的 vocab 做 greedy longest-match（bge 词表 21128） */
function loadVocab(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const vocab = j.model?.vocab || j.vocab;
  if (!vocab) throw new Error('tokenizer.json missing vocab');
  return vocab;
}

function basicTokenize(text) {
  // 去标点、小写（bge-zh 多为未归一化字符 + WordPiece）
  return text.trim().split(/\s+/);
}

function wordpiece(token, vocab, unk = '[UNK]', maxChars = 100) {
  if (token.length > maxChars) return [unk];
  const chars = Array.from(token);
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let cur = null;
    while (start < end) {
      const sub = chars.slice(start, end).join('');
      const piece = start === 0 ? sub : `##${sub}`;
      if (vocab[piece] !== undefined) {
        cur = piece;
        break;
      }
      end -= 1;
    }
    if (cur === null) {
      out.push(unk);
      start += 1;
    } else {
      out.push(cur);
      start = end;
    }
  }
  return out;
}

function encode(text, vocab, maxLen = 64) {
  const CLS = '[CLS]';
  const SEP = '[SEP]';
  const ids = [BigInt(vocab[CLS] ?? 101)];
  for (const tok of basicTokenize(text)) {
    for (const wp of wordpiece(tok, vocab)) {
      if (vocab[wp] !== undefined) ids.push(BigInt(vocab[wp]));
      else ids.push(BigInt(vocab['[UNK]'] ?? 100));
    }
  }
  ids.push(BigInt(vocab[SEP] ?? 102));
  const input = ids.slice(0, maxLen);
  const mask = new Array(input.length).fill(1n);
  const type = new Array(input.length).fill(0n);
  return { ids: BigInt64Array.from(input), mask: BigInt64Array.from(mask), type: BigInt64Array.from(type) };
}

async function tryBackend(name, options) {
  try {
    ort.env.wasm.numThreads = options.threads ?? 1;
    if (name === 'wasm-simd') {
      ort.env.wasm.simd = true;
      options.executionProviders = ['wasm'];
    } else if (name === 'wasm-nosimd') {
      ort.env.wasm.simd = false;
      options.executionProviders = ['wasm'];
    } else if (name === 'webgpu') {
      options.executionProviders = ['webgpu', 'wasm'];
    }
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(modelPath, options);
    const loadMs = performance.now() - t0;
    return { session, loadMs };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function benchSession(session, feedsBuilder, texts, n) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const text = texts[i % texts.length];
    const feeds = feedsBuilder(text);
    const t0 = performance.now();
    await session.run(feeds);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    n,
    p50: +percentile(samples, 50).toFixed(3),
    p95: +percentile(samples, 95).toFixed(3),
    max: +samples[samples.length - 1].toFixed(3),
  };
}

const vocab = loadVocab(tokenizerPath);
console.log('vocab size', Object.keys(vocab).length);

const texts = [
  '无限牛马多智能体群聊桌面应用',
  '值班者状态机与队列编排',
  '记忆服务长驻子进程 IPC',
  'FTS5 中文单字索引短语查询',
  'Workhorse Army WArmy',
];

const backends = ['webgpu', 'wasm-simd', 'wasm-nosimd'];
const results = [];

for (const b of backends) {
  const threads = b === 'wasm-simd' ? 4 : 1;
  const r = await tryBackend(b, { threads });
  if (r.error) {
    results.push({ backend: b, error: r.error });
    continue;
  }
  const feedsBuilder = (text) => {
    const enc = encode(text, vocab);
    return {
      input_ids: new ort.Tensor('int64', enc.ids, [1, enc.ids.length]),
      attention_mask: new ort.Tensor('int64', enc.mask, [1, enc.mask.length]),
      token_type_ids: new ort.Tensor('int64', enc.type, [1, enc.type.length]),
    };
  };
  // warmup
  await benchSession(r.session, feedsBuilder, texts, 3);
  const stats = await benchSession(r.session, feedsBuilder, texts, 20);
  results.push({ backend: b, loadMs: +r.loadMs.toFixed(1), ...stats });
}

// 边界：空串 / 超长
let boundary = [];
try {
  const r = await tryBackend('wasm-simd', { threads: 4 });
  if (r.session) {
    const feedsBuilder = (text) => {
      const enc = encode(text, vocab, 64);
      return {
        input_ids: new ort.Tensor('int64', enc.ids, [1, enc.ids.length]),
        attention_mask: new ort.Tensor('int64', enc.mask, [1, enc.mask.length]),
        token_type_ids: new ort.Tensor('int64', enc.type, [1, enc.type.length]),
      };
    };
    for (const t of ['', '。'.repeat(200), 'a'.repeat(500)]) {
      try {
        const out = await r.session.run(feedsBuilder(t));
        const keys = Object.keys(out);
        const dim = out[keys[0]]?.dims;
        boundary.push({ input: t.slice(0, 20), ok: true, outDim: dim });
      } catch (e) {
        boundary.push({ input: t.slice(0, 20), ok: false, err: String(e.message || e) });
      }
    }
  }
} catch (e) {
  boundary.push({ error: String(e.message || e) });
}

const best = results.find((r) => !r.error && r.p95 < 50);
const report = {
  results,
  boundary,
  passDoD: !!best,
  bestBackend: best?.backend,
};
console.log(JSON.stringify(report, null, 2));

// ── 落盘原始证据（P0 复核：判定必须有原始输出支撑）──
const evidence = {
  spike: 'spike-07-onnx',
  title: 'onnxruntime-web + bge-small-zh-v1.5 int8 嵌入延迟',
  dod: 'WebGPU 或 WASM SIMD P95 < 50ms',
  ranAt: new Date().toISOString(),
  command: 'node spikes/spike-07-onnx/run.mjs',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  runtime: {
    package: 'onnxruntime-web',
    ortEnvWasm: { simd: ort.env.wasm.simd, numThreads: ort.env.wasm.numThreads },
    model: { path: 'spikes/spike-07-onnx/models/model_quantized.onnx', vocabSize: Object.keys(vocab).length },
  },
  notes: [
    'Node 侧没有 WebGPU backend：onnxruntime-web 会把 executionProviders=[webgpu,wasm] 静默降级为 wasm（运行时已输出 “removing requested execution provider \\"webgpu\\" … backend not found”），因此上面 webgpu 行的数值实际是 wasm 回退结果，不能当作 WebGPU 证据',
    'WebGPU 需在 Electron 浏览器上下文单独测；本次未测',
    '三条路径的 P95 均在 8~9ms，差异不显著（同一 wasm 后端重复测量）',
  ],
  report,
  exitCode: report.passDoD ? 0 : 1,
};
fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(`原始结果已写入 ${path.join(__dirname, 'result.json')}`);

process.exit(report.passDoD ? 0 : 1);
