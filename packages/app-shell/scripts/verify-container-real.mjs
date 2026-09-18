/**
 * ADR 004 第三批 A：**真机真容器**验收（会改变本机状态，**刻意不放进默认门禁**）。
 *
 * 产品主明确授权（他本人不在使用 Docker）：
 *   · 真的启动 Docker Desktop 并等守护进程就绪 → 记录**实际耗时**（UI"大概时间"的真实依据）；
 *   · 真的跑最小容器（用**镜像表里钉死的 digest**）验证链路；
 *   · 真的证明"**容器里必须有 Linux 版 Node**"（主机捆绑的 win-x64 node.exe 在 Linux 容器里跑不了）；
 *   · 验证「启动 → 就绪 → 停止」的真实行为与耗时；
 *   · 做完**尽量恢复原状**（用完把引擎停回去，并如实报告启了什么、停干净了没有）。
 *
 *   node packages/app-shell/scripts/verify-container-real.mjs [--keep-running]
 *
 * 环境变量：
 *   WARMY_START_TIMEOUT_MS  启动/停止的观察上限（默认 420000 = 7 分钟；真机首次启动会很久）
 *   WARMY_TEST_IMAGE        冒烟镜像（默认取镜像表里 alpine 那一项的**钉死引用**）
 *   WARMY_IMAGE_DIGESTS     机器可读的 digest 台账（scripts/pin-image-digests.mjs 产物），用于交叉核对
 *   WARMY_CONTAINER_OUT     结果输出目录（默认 %TEMP%/perf/container）
 *
 * ⚠️ 不要把它挂进 CI/门禁：它依赖本机装好的 Docker、需要网络、并且会真起容器。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(selfDir, '..', '..', '..');
const dist = path.join(selfDir, '..', 'dist', 'container-probe.js');
if (!fs.existsSync(dist)) {
  console.error('缺少 dist/container-probe.js，请先构建');
  process.exit(3);
}
const mod = await import(new URL('file://' + dist.replace(/\\/g, '/')).href);
const { probeContainerRuntimes, runContainerAction, recordContainerTiming, containerTimings, CONTAINER_BASE_IMAGES } = mod;

const KEEP = process.argv.includes('--keep-running');
const START_TIMEOUT_MS = Number(process.env.WARMY_START_TIMEOUT_MS || 420000);
const DESKTOP_CLI = process.env.WARMY_DESKTOP_CLI
  || 'C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-desktop.exe';
/**
 * 本机实测（2026-09-19）：`docker desktop start` 会**失败**，原始输出是
 *   ✗ Failed to start Docker Desktop
 *   starting Docker Desktop: getting launcher path: cannot find registry key
 *   "SOFTWARE\\Docker Inc.\\Docker Desktop": The system cannot find the file specified.
 * 即：CLI 插件在（v0.4.3），但它冷启动要靠那个注册表键来定位启动器，而本机**没有这个键**
 * （HKLM / HKCU / WOW6432Node 三处都查过，全部不存在）。所以"命令存在 ≠ 可用"再一次成立。
 * WARMY_START_VIA_APP=1 ⇒ 走**用户真会做的那一步**：直接拉起 Docker Desktop 本体。
 * 两种方式都会测，CLI 的原始失败输出照样记下来（产品要据此决定要不要做回退）。
 */
const START_VIA_APP = process.env.WARMY_START_VIA_APP === '1';
const APP_EXE = process.env.WARMY_APP_EXE || 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
const NODE_IMAGE = CONTAINER_BASE_IMAGES.find((x) => x.id === 'node-24-slim');
const ALPINE_IMAGE = CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20');
const IMAGE = process.env.WARMY_TEST_IMAGE
  || (ALPINE_IMAGE && ALPINE_IMAGE.digest ? `${ALPINE_IMAGE.ref}@${ALPINE_IMAGE.digest}` : 'alpine:3.20');
const NODE_REF = NODE_IMAGE && NODE_IMAGE.digest ? `${NODE_IMAGE.ref}@${NODE_IMAGE.digest}` : 'node:24-slim';
const HOST_NODE_EXE = path.join(repoRoot, 'resources', 'node', 'win-x64', 'node.exe');

const { execFile, spawn } = await import('node:child_process');
const results = [];
let failures = 0;
function ok(cond, label, detail) {
  const pass = !!cond;
  if (!pass) failures++;
  results.push({ pass, label, detail: detail === undefined ? null : String(detail) });
  console.log((pass ? '  PASS ' : '  FAIL ') + label + (detail === undefined ? '' : '  [' + String(detail).slice(0, 400) + ']'));
  return pass;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 22, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({
        ms: Date.now() - t0,
        code: err && typeof err.code === 'number' ? err.code : (err ? String(err.code) : 0),
        out: String(stdout || '').trim(),
        err: String(stderr || '').trim(),
        message: err ? String(err.message).split('\n')[0] : '',
      });
    });
  });
}
const dockerReady = async () => {
  const r = await run('docker', ['info', '--format', '{{.ServerVersion}}|{{.OSType}}'], 15000);
  return { ready: r.code === 0 && !!r.out, r };
};
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** 去 registry 复核一条 digest 是不是**内容寻址**（sha256(manifest 字节) === digest） */
async function registryVerifyDigest(ref, digest) {
  // ⚠️ 必须**去掉 tag**：`alpine:3.20` 的仓库名是 `library/alpine`，
  // 把 `alpine:3.20` 当仓库名拼进 URL 会得到 404（本脚本自己踩过这个坑，写死在这里）。
  const base = String(ref).split(':')[0];
  const repo = base.includes('/') ? base : 'library/' + base;
  // ⚠️ 必须**带上 Bearer token**：不带 = 未认证 = 401（本脚本自己踩过这个坑）。
  const call = (url, accept, token) => fetch(url, {
    headers: { ...(accept ? { Accept: accept } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'follow',
  });
  const tk = await call(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`);
  if (tk.status !== 200) return { ok: false, why: `token HTTP ${tk.status}` };
  const tok = (await tk.json()).token;
  const ACC = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
  const r = await call(`https://registry-1.docker.io/v2/${repo}/manifests/${digest}`, ACC, tok);
  if (r.status !== 200) return { ok: false, why: `manifest HTTP ${r.status}` };
  const body = Buffer.from(await r.arrayBuffer());
  const actual = 'sha256:' + sha256Hex(body);
  const header = r.headers.get('docker-content-digest');
  return { ok: actual === digest, actual, header, bytes: body.length, mediaType: (JSON.parse(body.toString('utf8')).mediaType) || r.headers.get('content-type') };
}

console.log('=== 0. 起始状态（真探测） ===');
const before = await probeContainerRuntimes({ cacheMs: 0 });
const dockerBefore = before.runtimes.find((x) => x.id === 'docker');
const wslBefore = before.runtimes.find((x) => x.id === 'wsl');
console.log(JSON.stringify({ docker: { status: dockerBefore.status, run: dockerBefore.run, version: dockerBefore.version, detail: dockerBefore.detail, evidence: dockerBefore.evidence }, wsl: { status: wslBefore.status, detail: wslBefore.detail } }));
ok(dockerBefore.status === 'installed-not-running' || dockerBefore.status === 'ready',
  '0-1 起点是"已安装未运行"或"已运行"', dockerBefore.status);
if (dockerBefore.status === 'not-installed') {
  console.log('docker CLI 不在，后面的真容器验证无法进行');
  process.exit(0);
}
// 如实记录 WSL 侧（Docker Desktop 的 Linux 引擎依赖它）
const wslList = await run('wsl.exe', ['-l', '-q'], 30000);
const distros = String(wslList.out || '').replace(/\u0000/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
console.log('     WSL 发行版: ' + JSON.stringify(distros) + '  (wsl 运行时状态=' + wslBefore.status + ')');
const wasRunning = dockerBefore.status === 'ready';

console.log('\n=== 1. 真的启动引擎（记录实际耗时） ===');
let startMs = 0;
let engineStartOk = wasRunning;
let cliStartOutput = '';
let startVia = wasRunning ? 'already-running' : '';
if (wasRunning) {
  console.log('引擎本来就在运行，跳过启动（不打乱用户环境）');
} else {
  if (START_VIA_APP) {
    // 先照产品当前走的路试一次（CLI 插件），把它的**原始失败输出**记下来当证据
    const cliTry = await runContainerAction({ id: 'docker', action: 'start' });
    console.log('     [诊断] 产品当前路径 runContainerAction({id:"docker",action:"start"}) = ' + JSON.stringify(cliTry));
    for (let i = 0; i < 25; i++) {
      const rep = await probeContainerRuntimes({ cacheMs: 0 });
      const d = rep.runtimes.find((x) => x.id === 'docker');
      if (d && d.action && d.action.result) { cliStartOutput = String(d.action.result.output || ''); break; }
      await sleep(1000);
    }
    console.log('     [诊断] `docker desktop start` 原始输出 = ' + JSON.stringify(cliStartOutput.slice(0, 500)));
  }
  const t0 = Date.now();
  if (START_VIA_APP) {
    const child = spawn(APP_EXE, [], { detached: true, stdio: 'ignore' });
    child.unref();
    startVia = 'app-exe:' + APP_EXE;
    console.log('     启动方式 = **直接拉起 Docker Desktop 本体**（用户点图标等价那一步）：' + APP_EXE);
  } else {
    const startCall = await runContainerAction({ id: 'docker', action: 'start' });
    startVia = 'cli-plugin:docker desktop start';
    ok(startCall.ok === true && startCall.accepted === true, '1-1 启动动作被接受（参数只有 id + action）', JSON.stringify(startCall));
  }
  let ready = false;
  let last = '';
  let polls = 0;
  let noProcStreak = 0;
  while (Date.now() - t0 < START_TIMEOUT_MS) {
    const st = await dockerReady();
    polls++;
    last = JSON.stringify(st.r.out || st.r.err).slice(0, 160);
    if (st.ready) { ready = true; break; }
    if (polls <= 4) {
      const procs = await run('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -like '*docker*' } | Measure-Object).Count"]);
      if (!String(procs.out || '').trim() || String(procs.out).trim() === '0') noProcStreak++;
    }
    await sleep(3000);
  }
  startMs = Date.now() - t0;
  recordContainerTiming('start', startMs, 'Docker Desktop（' + startVia + '）');
  engineStartOk = ready;
  ok(ready, '1-2 守护进程**真的**就绪了（轮询 docker info，不是"点了就完事"）', last);
  console.log('     实测启动耗时 = ' + (startMs / 1000).toFixed(1) + ' 秒（' + polls + ' 次轮询；方式=' + startVia + '）');
  if (ready) {
    const ds = await run(DESKTOP_CLI, ['desktop', 'status'], 60000);
    console.log('     docker desktop status -> ' + JSON.stringify((ds.out || ds.err).replace(/\s+/g, ' ').slice(0, 400)));
  }
  if (!ready) {
    /* 未就绪时**如实诊断**（不许含糊）：desktop status + 进程数 + WSL 发行版 + 引擎日志尾巴 */
    const st = await run(DESKTOP_CLI, ['desktop', 'status'], 60000);
    const procs = await run('powershell', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.ProcessName -like '*docker*' } | Select-Object -ExpandProperty ProcessName"]);
    const wslQ = await run('wsl.exe', ['-l', '-v'], 30000);
    const logs = await run(DESKTOP_CLI, ['desktop', 'logs'], 60000);
    console.log('     诊断：前几轮里"没有任何 docker* 进程"的次数 = ' + noProcStreak);
    console.log('     诊断：desktop status -> ' + JSON.stringify((st.err || st.out).slice(0, 300)));
    console.log('     诊断：docker 相关进程 = ' + JSON.stringify(String(procs.out || '').slice(0, 200)));
    console.log('     诊断：wsl 发行版列表 = ' + JSON.stringify((wslQ.out || wslQ.err || '').replace(/\u0000/g, '').slice(0, 400)));
    console.log('     诊断：desktop logs 尾巴 = ' + JSON.stringify((logs.out || logs.err || '').slice(-800)));
    console.log('引擎在 ' + (START_TIMEOUT_MS / 1000) + ' 秒内没有就绪，后续用例跳过');
  }
}

const afterStart = await probeContainerRuntimes({ cacheMs: 0 });
const dockerAfter = afterStart.runtimes.find((x) => x.id === 'docker');
console.log('     探测转换: ' + dockerBefore.status + ' -> ' + dockerAfter.status + '  detail=' + dockerAfter.detail);
ok(dockerAfter.status === 'ready' && dockerAfter.run === 'running',
  '1-3 【核心】探测状态真的从 installed-not-running 变成 ready（不是缓存/快照）',
  JSON.stringify({ status: dockerAfter.status, run: dockerAfter.run, detail: dockerAfter.detail, cap: dockerAfter.capability }));
const osMode = String(dockerAfter.detail || '').split(':')[1] || '';
ok(['linux', 'windows'].includes(osMode), '1-4 取到了引擎当前的 **OS 模式**（环境类型维度的事实来源）', osMode || '(未取到)');

console.log('\n=== 2. 真的在容器里跑命令（用镜像表里钉死的 digest） ===');
console.log('     冒烟引用 = ' + IMAGE);
console.log('     Node 引用 = ' + NODE_REF);
let runOk = false;
let nodeOk = false;
const measured = {};
if (dockerAfter.status === 'ready') {
  // 2-1 用 **digest 引用**跑（证明表里的 digest 真的能拉、能跑；浮动 tag 不算数）
  const pull0 = await run('docker', ['pull', IMAGE], 300000);
  measured.pullAlpineMs = pull0.ms;
  console.log('     docker pull ' + IMAGE + ' rc=' + pull0.code + ' 实测 ' + pull0.ms + 'ms  ' + JSON.stringify(pull0.out.split(/\r?\n/).slice(-1)[0] || pull0.err.slice(0, 120)));
  const gv = await run('docker', ['run', '--rm', IMAGE, 'echo', 'ok'], 240000);
  recordContainerTiming('run', gv.ms, 'docker run --rm ' + IMAGE + ' echo ok');
  measured.runAlpineMs = gv.ms;
  console.log('     docker run --rm ' + IMAGE + ' echo ok  rc=' + gv.code + ' 实测 ' + gv.ms + 'ms');
  console.log('     stdout=' + JSON.stringify(gv.out.slice(0, 120)) + ' stderr=' + JSON.stringify(gv.err.slice(0, 200)));
  runOk = gv.code === 0 && /ok/.test(gv.out);
  ok(runOk, '2-1 【核心】真的跑起了一个容器并拿到输出（容器内执行路径可用）',
    runOk ? gv.out.slice(0, 40) : ('rc=' + gv.code + ' ' + (gv.err || gv.message).slice(0, 200)));

  // 2-2 真 shell 路径的最小证明：能执行 shell，且**不继承**密钥类环境变量
  if (runOk) {
    const sh = await run('docker', ['run', '--rm', '--env', 'WARMY_PROBE=1', IMAGE, 'sh', '-c', 'echo shell-ok; echo ENV=${WARMY_PROBE:-none}; echo SECRET=${OPENAI_API_KEY:-none}'], 120000);
    ok(sh.code === 0 && /shell-ok/.test(sh.out),
      '2-2 容器内能执行 shell 命令（给控制台打底的路径成立）', sh.out.replace(/\s+/g, ' ').slice(0, 120));
    ok(sh.out.indexOf('SECRET=none') >= 0,
      '2-3 【安全】容器的 shell **没有**继承本机的密钥类环境变量（不把 API Key 带进容器）', sh.out.replace(/\s+/g, ' ').slice(0, 140));
  }

  // 2-4 【核心】容器里真的有 **Linux 版 Node**（这就是"镜像必须自带 Node"的理由）
  const npull = await run('docker', ['pull', NODE_REF], 600000);
  measured.pullNodeMs = npull.ms;
  console.log('     docker pull ' + NODE_REF + ' rc=' + npull.code + ' 实测 ' + npull.ms + 'ms');
  const nv = await run('docker', ['run', '--rm', NODE_REF, 'node', '-e', 'console.log(process.version)'], 240000);
  measured.runNodeMs = nv.ms;
  recordContainerTiming('run', nv.ms, 'docker run --rm node -e console.log(process.version)');
  nodeOk = nv.code === 0 && /^v\d+\./.test(nv.out.trim());
  console.log('     docker run --rm ' + NODE_REF + ' node -e "console.log(process.version)"  rc=' + nv.code + ' 实测 ' + nv.ms + 'ms  stdout=' + JSON.stringify(nv.out.trim()) + ' stderr=' + JSON.stringify(nv.err.slice(0, 200)));
  ok(nodeOk, '2-4 【核心】容器内的 **Linux 版 Node** 真的能跑（容器自带 Node，未依赖主机）', nv.out.trim() || nv.err.slice(0, 200));

  if (nodeOk) {
    const plat = await run('docker', ['run', '--rm', NODE_REF, 'node', '-p', 'process.platform + "|" + process.arch + "|" + process.execPath'], 120000);
    ok(plat.code === 0 && /^linux\|/.test(plat.out.trim()),
      '2-5 容器内 Node 是 **linux/x64**（主机上跑的是 Windows node.exe，两者不是同一个东西）', plat.out.trim());
  }

  // 2-6 【核心·反向证明】主机捆绑的 **Windows node.exe 在 Linux 容器里跑不了**
  if (fs.existsSync(HOST_NODE_EXE)) {
    const probeDir = path.dirname(HOST_NODE_EXE);
    const pe = await run('docker', ['run', '--rm', '-v', probeDir + ':/probe:ro', IMAGE, '/probe/node.exe', '-v'], 180000);
    const peText = `${pe.out} ${pe.err} ${pe.message}`.toLowerCase();
    const cannotRun = pe.code !== 0 && /exec format error|cannot execute|not found|permission denied|no such file/.test(peText);
    ok(cannotRun, '2-6 【核心·反向证明】主机捆绑的 Windows node.exe 在 Linux 容器里**跑不起来**（所以镜像必须自带 Linux Node）',
      'rc=' + pe.code + ' ' + peText.replace(/\s+/g, ' ').slice(0, 200));
  } else {
    console.log('     （本机没有 resources/node/win-x64/node.exe，跳过 2-6 反向证明）');
  }

  // 2-7 真实体积：引擎落盘的大小（与 registry 的压缩层大小对照）
  for (const ref of [IMAGE, NODE_REF]) {
    const ins = await run('docker', ['image', 'inspect', '--format', '{{.Size}}|{{.Id}}', ref], 60000);
    console.log('     docker image inspect ' + ref + ' -> ' + (ins.out || ins.err).slice(0, 140));
    if (ref === IMAGE) measured.onDiskAlpineBytes = Number(ins.out.split('|')[0]) || null;
    if (ref === NODE_REF) measured.onDiskNodeBytes = Number(ins.out.split('|')[0]) || null;
  }
}

console.log('\n=== 3. 镜像 digest 已钉死 + registry 复核（内容寻址） ===');
console.log('     基础镜像表: ' + JSON.stringify(CONTAINER_BASE_IMAGES.map((x) => [x.ref, x.digest])));
const sha256Re = /^sha256:[0-9a-f]{64}$/;
const allPinned = CONTAINER_BASE_IMAGES.every((x) => typeof x.digest === 'string' && sha256Re.test(x.digest));
ok(CONTAINER_BASE_IMAGES.length >= 2, '3-0 镜像表非空（node 承载镜像 + 一个极小冒烟镜像）', 'count=' + CONTAINER_BASE_IMAGES.length);
ok(allPinned, '3-1 每个镜像的 digest 都是**形态正确的 sha256**（不再是 null / 不是编的）',
  JSON.stringify(CONTAINER_BASE_IMAGES.filter((x) => !x.digest).map((x) => x.ref)) || '(全部已钉死)');
ok(CONTAINER_BASE_IMAGES.some((x) => /node/.test(x.ref)), '3-2 至少有一个**自带 Linux Node** 的镜像（容器里跑 Node 程序的前提）',
  JSON.stringify(CONTAINER_BASE_IMAGES.filter((x) => /node/.test(x.ref)).map((x) => x.ref)));

// 3-3 交叉核对：pin 脚本留下的机器可读台账（若有）必须与本表一致
const ledgerPath = process.env.WARMY_IMAGE_DIGESTS || path.join(os.tmpdir(), 'perf', 'container', 'image-digests.json');
try {
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const mismatches = [];
  for (const img of CONTAINER_BASE_IMAGES) {
    const row = (ledger.results || []).find((r) => r.ref === img.ref);
    if (!row || !row.indexDigest) { mismatches.push(img.ref + ':台账缺失'); continue; }
    if (row.indexDigest !== img.digest) mismatches.push(img.ref + ':台账=' + row.indexDigest + ' 表=' + img.digest);
    const amd = row.platforms && row.platforms['linux/amd64'];
    const pinnedAmd = img.platformDigests && img.platformDigests['linux/amd64'];
    if (amd && pinnedAmd && amd.digest !== pinnedAmd) mismatches.push(img.ref + '(amd64):台账=' + amd.digest + ' 表=' + pinnedAmd);
  }
  ok(mismatches.length === 0, '3-3 表里的 digest 与 pin 脚本台账逐字一致（可复算，不是手抄的）',
    mismatches.length ? mismatches.join(' ; ') : 'ledger=' + ledgerPath);
} catch (e) {
  console.log('  SKIP 3-3 没有 pin 台账（' + ledgerPath + '）：' + String(e && e.message));
}

/* 3-4 **只需要网络，不需要容器引擎** —— 所以刻意放在"引擎就绪"的判断之外：
   这样即使本机引擎起不来（例如 Docker Desktop 装坏了），digest 的真实性照样能被独立验证。 */
const digestChecks = [];
for (const img of CONTAINER_BASE_IMAGES) {
  try {
    const v = await registryVerifyDigest(img.ref, img.digest);
    digestChecks.push({ ref: img.ref, ...v });
    console.log('     registry 复核 ' + img.ref + ' digest=' + String(img.digest).slice(0, 23) + '… '
      + (v.ok ? 'OK' : 'FAIL(' + v.why + ')') + '  mediaType=' + (v.mediaType || '?') + ' manifestBytes=' + (v.bytes || '?'));
  } catch (e) {
    digestChecks.push({ ref: img.ref, ok: false, why: String(e && e.message) });
    console.log('     registry 复核 ' + img.ref + ' 出错：' + String(e && e.message));
  }
  await sleep(300);
}
const allDigestOk = digestChecks.length > 0 && digestChecks.every((c) => c.ok);
ok(allDigestOk, '3-4 【核心】去 registry 按 digest 取回 manifest，sha256(字节) === 表里的 digest（内容寻址成立）',
  JSON.stringify(digestChecks.map((c) => [c.ref, c.ok ? 'ok' : c.why])));
measured.registryDigestChecks = digestChecks;

console.log('\n=== 4. 停止引擎 + 恢复机器原状（记录实际耗时） ===');
let stopMs = 0;
let downOk = false;
if (!wasRunning && (dockerAfter.status === 'ready' || engineStartOk)) {
  const t0 = Date.now();
  const stopCall = await runContainerAction({ id: 'docker', action: 'stop' });
  ok(stopCall.ok === true, '4-1 停止动作被接受', JSON.stringify(stopCall));
  let down = false;
  let polls = 0;
  while (Date.now() - t0 < START_TIMEOUT_MS) {
    const st = await dockerReady();
    polls++;
    if (!st.ready) { down = true; break; }
    await sleep(3000);
  }
  stopMs = Date.now() - t0;
  downOk = down;
  recordContainerTiming('stop', stopMs, 'Docker Desktop');
  console.log('     实测停止耗时 = ' + (stopMs / 1000).toFixed(1) + ' 秒（' + polls + ' 次轮询）');
  ok(down, '4-2 【核心】引擎真的停下去了（不是只发了命令）', (stopMs / 1000).toFixed(1) + 's');
  const afterStop = await probeContainerRuntimes({ cacheMs: 0 });
  const d2 = afterStop.runtimes.find((x) => x.id === 'docker');
  ok(d2.status === 'installed-not-running' && d2.run === 'not-running',
    '4-3 探测又如实回到"已安装未运行"（状态与事实一致，两个方向都验过）', JSON.stringify({ status: d2.status, run: d2.run }));
  // 4-4 恢复原状的证据：没有残留的 docker 进程
  const left = await run('powershell', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.ProcessName -like '*docker*' } | Select-Object -ExpandProperty ProcessName"]);
  ok(!String(left.out || '').trim(), '4-4 机器恢复原状：没有残留的 docker* 进程（这是我们自己起的，用完停掉）',
    'left=' + JSON.stringify(String(left.out || '').trim().slice(0, 200)));
} else if (KEEP || wasRunning) {
  console.log('跳过停止（--keep-running 或本来就运行）——**本机状态保持你原来的样子**');
}

console.log('\n=== 5. 实测耗时台账（UI 文案的真实依据） ===');
const tm = containerTimings();
console.log(JSON.stringify(tm, null, 1));
console.log('     其它实测: ' + JSON.stringify(measured, null, 1));
ok(typeof tm.engineStartMs === 'number' || wasRunning, '5-1 记录了实测启动耗时（毫秒）', JSON.stringify(tm));

const failed = results.filter((r) => !r.pass);
console.log('\n=== 结果 ===');
console.log(JSON.stringify({
  pass: failed.length === 0, failures: failed.length, total: results.length,
  timings: tm, measured, runOk, nodeOk, image: IMAGE, nodeImage: NODE_REF,
  startMs, stopMs, downOk, wasRunning, distros, startVia, cliStartOutput,
}, null, 1));
const outDir = process.env.WARMY_CONTAINER_OUT || path.join(os.tmpdir(), 'perf', 'container');
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'container-real-result.json'), JSON.stringify({
    at: new Date().toISOString(), results, timings: tm, measured, runOk, nodeOk,
    before: dockerBefore, afterStart: dockerAfter, startMs, stopMs, downOk, wasRunning, distros,
    image: IMAGE, nodeImage: NODE_REF, startVia, cliStartOutput,
  }, null, 1), 'utf8');
  console.log('结果写入: ' + path.join(outDir, 'container-real-result.json'));
} catch { /* ignore */ }
process.exit(failed.length === 0 ? 0 : 2);
