/**
 * ADR 004 第三批 A 补：**从真实 registry 钉死基础镜像 digest**（只读，不改本机任何状态）。
 *
 * 为什么要有这个脚本：镜像表里的 `digest` 必须是**真实内容寻址摘要**，
 * 假 digest 一定会拉错东西。上一轮本机连不上镜像仓库 ⇒ 表里只能留 null。
 * 这一轮网络通了，用**标准 Docker Registry v2 token 流**把真 digest 取回来，
 * 并把「怎么取的」记录成 API 调用清单，任何人可复算。
 *
 *   node packages/app-shell/scripts/pin-image-digests.mjs
 *   node packages/app-shell/scripts/pin-image-digests.mjs node:24-slim alpine:3.20
 *
 * 取数规则（诚实优先）：
 *   · 顶层 tag 返回 manifest **list/index** 时，索引自己的 digest 也记下来（多平台一致的那份），
 *     同时把 linux/amd64 与 linux/arm64 的平台 manifest digest 分别记下来（单平台钉死用）。
 *   · 压缩后大小 = 该平台 manifest 里所有 layer 的 size 之和（这正是拉取要下载的字节数）。
 *   · 解压后大小 = 平台 manifest 指向的 config blob（`.size`）—— 这是容器实例化的那个 blob。
 *   · license 优先取 config 里的 `org.opencontainers.image.licenses` 标签；
 *     取不到就**如实写 unknown**，不猜。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY = 'https://registry-1.docker.io';
const AUTH = 'https://auth.docker.io/token';

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (targets.length === 0) targets.push('node:24-slim', 'debian:bookworm-slim', 'alpine:3.20');

const calls = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带重试的 GET；TLS/EOF/5xx 都算可重试（本机实测会出现 TLS EOF）。 */
async function get(url, { accept, token, tries = 4 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    const headers = {};
    if (accept) headers['Accept'] = accept;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const started = Date.now();
    try {
      const res = await fetch(url, { headers, redirect: 'follow' });
      const buf = Buffer.from(await res.arrayBuffer());
      const rec = {
        method: 'GET',
        url: url.length > 160 ? url.slice(0, 157) + '...' : url,
        accept: accept || null,
        status: res.status,
        ms: Date.now() - started,
        bytes: buf.length,
        digestHeader: res.headers.get('docker-content-digest') || null,
        attempt: i,
      };
      calls.push(rec);
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(700 * i);
        continue;
      }
      return { status: res.status, buf, headers: res.headers, rec };
    } catch (e) {
      calls.push({ method: 'GET', url: url.slice(0, 160), status: null, error: String(e?.message || e), attempt: i, ms: Date.now() - started });
      lastErr = e;
      await sleep(700 * i);
    }
  }
  throw lastErr || new Error('get failed');
}

async function tokenFor(repo) {
  const url = `${AUTH}?service=registry.docker.io&scope=repository:${repo}:pull`;
  const r = await get(url);
  if (r.status !== 200) throw new Error(`token HTTP ${r.status}`);
  const json = JSON.parse(r.buf.toString('utf8'));
  return { token: json.token || json.access_token, url };
}

const sha256 = (buf) => 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');

function splitRef(ref) {
  const i = ref.lastIndexOf(':');
  const repo = i < 0 ? ref : ref.slice(0, i);
  const tag = i < 0 ? 'latest' : ref.slice(i + 1);
  return { repo: repo.includes('/') ? repo : `library/${repo}`, tag, display: repo };
}

const results = [];

for (const ref of targets) {
  const { repo, tag, display } = splitRef(ref);
  const entry = { ref, repository: repo, tag, ok: false, error: null, api: [] };
  try {
    const tk = await tokenFor(repo);
    entry.api.push(`① GET ${tk.url} -> token`);
    const idx = await get(`${REGISTRY}/v2/${repo}/manifests/${tag}`, { accept: MANIFEST_ACCEPT, token: tk.token });
    if (idx.status !== 200) throw new Error(`manifest HTTP ${idx.status}`);
    const indexDigest = idx.rec.digestHeader || sha256(idx.buf);
    const ti = JSON.parse(idx.buf.toString('utf8'));
    entry.api.push(`② GET ${REGISTRY}/v2/${repo}/manifests/${tag}  Accept: ${MANIFEST_ACCEPT}  -> ${idx.status}`);
    entry.indexDigest = indexDigest;
    entry.mediaType = ti.mediaType || idx.headers.get('content-type');
    entry.manifestList = Array.isArray(ti.manifests);

    const platforms = {};
    if (Array.isArray(ti.manifests)) {
      for (const m of ti.manifests) {
        if (m.platform?.os !== 'linux') continue;
        // 归一化：官方镜像里 arm64 带 variant=v8、arm 带 v6/v7 —— 归到 `linux/arm64` / `linux/arm`
        const os = m.platform.os;
        const arch = m.platform.architecture;
        const key = arch === 'arm64' ? `${os}/arm64` : arch === 'arm' ? `${os}/arm` : `${os}/${arch}`;
        if (platforms[key]) continue; // 同一架构只保留第一条（attestation 的 os/arch 是 unknown，已被上面过滤）
        platforms[key] = { digest: m.digest, raw: `${os}/${arch}${m.platform.variant ? '/' + m.platform.variant : ''}` };
      }
    }

    entry.platforms = {};
    for (const want of ['linux/amd64', 'linux/arm64']) {
      const p = platforms[want];
      if (!p) { entry.platforms[want] = { resolved: false }; continue; }
      const pm = await get(`${REGISTRY}/v2/${repo}/manifests/${p.digest}`, { accept: MANIFEST_ACCEPT, token: tk.token });
      if (pm.status !== 200) { entry.platforms[want] = { resolved: false, digest: p.digest, error: `HTTP ${pm.status}` }; continue; }
      const pmBody = JSON.parse(pm.buf.toString('utf8'));
      entry.api.push(`③ GET ${REGISTRY}/v2/${repo}/manifests/${p.digest}  -> ${pm.status}（平台清单）`);
      const layers = Array.isArray(pmBody.layers) ? pmBody.layers : [];
      const compressed = layers.reduce((s, l) => s + (Number(l.size) || 0), 0);
      let config = null;
      if (pmBody.config?.digest) {
        const cb = await get(`${REGISTRY}/v2/${repo}/blobs/${pmBody.config.digest}`, { token: tk.token });
        entry.api.push(`④ GET ${REGISTRY}/v2/${repo}/blobs/${pmBody.config.digest}  -> ${cb.status}（config blob）`);
        if (cb.status === 200) config = JSON.parse(cb.buf.toString('utf8'));
      }
      entry.platforms[want] = {
        resolved: true,
        digest: pm.rec.digestHeader || sha256(pm.buf),
        configDigest: pmBody.config?.digest || null,
        layerCount: layers.length,
        compressedBytes: compressed,
        configBytes: Number(pmBody.config?.size) || (config ? JSON.stringify(config).length : null),
        licenses: config?.config?.Labels?.['org.opencontainers.image.licenses'] || null,
        labels: config?.config?.Labels || null,
        version: config?.config?.Labels?.['org.opencontainers.image.version'] || null,
        created: config?.created || null,
        env: config?.config?.Env || null,
        osInfo: config?.os && config?.architecture ? `${config.os}/${config.architecture}` : null,
        annotations: pmBody.annotations || null,
      };
    }
    entry.ok = true;
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  results.push(entry);
  console.log(JSON.stringify(entry, null, 1));
}

const outDir = process.env.WARMY_PIN_OUT || path.join(os.tmpdir(), 'perf', 'container');
const ledgerPath = path.join(outDir, 'image-digests.json');
try {
  fs.mkdirSync(outDir, { recursive: true });
  /* ⚠️ **合并**而不是覆盖：一次只传一个镜像时若直接覆盖台账，
     其余镜像的取数记录就丢了（下游 `verify-container-real.mjs` 的 3-3 逐字核对会因此报"台账缺失"）。
     本脚本自己踩过这个坑。 */
  let prev = { results: [], runs: [] };
  try {
    const old = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (old && Array.isArray(old.results)) prev = old;
  } catch { /* 没有旧台账 = 第一次跑 */ }
  const merged = new Map();
  for (const r of prev.results) if (r && r.ref) merged.set(r.ref, r);
  for (const r of results) if (r && r.ref) merged.set(r.ref, r); // 本次的结果覆盖同 ref 的旧记录
  const out = {
    at: new Date().toISOString(),
    registry: REGISTRY,
    results: [...merged.values()],
    lastRun: { at: new Date().toISOString(), refs: results.map((r) => r.ref), calls },
    runs: [...(Array.isArray(prev.runs) ? prev.runs : []), { at: new Date().toISOString(), refs: results.map((r) => r.ref) }].slice(-20),
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(out, null, 1), 'utf8');
  console.log('\n结果写入: ' + ledgerPath + '（台账里的镜像数 = ' + out.results.length + '）');
} catch (e) {
  console.log('写入失败: ' + String(e?.message || e));
}

console.log('\n=== API 调用清单（全部） ===');
for (const c of calls) {
  console.log(`${c.attempt > 1 ? '[retry ' + c.attempt + '] ' : ''}${c.method} ${c.url} Accept=${c.accept || '-'} -> ${c.status ?? 'ERR(' + c.error + ')'}  ${c.bytes || 0}B  ${c.ms}ms  digest=${c.digestHeader || '-'}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 2);
