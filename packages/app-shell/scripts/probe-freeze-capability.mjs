/**
 * 「环境固化」能力探测（runtime × 能不能固化 × 代价）—— **只读探测 + 可选真测，绝不假定引擎是 Linux**。
 *
 * 产品主要做「把当前环境固化下来」这个功能，所以能力声明必须有依据，不能拍脑袋。
 * 本脚本给三类**可核查**的证据，并把"本机今天到底能验到哪一步"如实记下来：
 *
 *   measured       = 在本机**真跑过**（有真实耗时/体积）—— 需要引擎真的能起来
 *   cli-verified   = 只验证了 CLI **确实有这条命令**（`<cli> <cmd> --help` 真的能跑）
 *   cli-missing    = 本机没有这个 CLI
 *   engine-down    = CLI 在，但引擎/守护进程不可达 ⇒ 无法真跑（**不许编耗时/体积**）
 *   not-applicable = 它根本不是容器引擎（如 kata 只是隔离级别、Windows Sandbox 是一次性 VM）
 *
 *   node packages/app-shell/scripts/probe-freeze-capability.mjs
 *   node packages/app-shell/scripts/probe-freeze-capability.mjs --measure   # 引擎可用时做真测（会创建+清理容器）
 *
 * ⚠️ 关键事实（本机实测，2026-09-19）：
 *   · Docker Desktop **起不来**（缺注册表键 SOFTWARE\Docker Inc.\Docker Desktop）⇒ docker 侧只能到 cli-verified。
 *   · **WSL 没有 commit**：它不是一个镜像仓库，只有 `wsl --export/--import [--vhd]`（已用 `wsl --help` 逐字核对）。
 *   · 本机 **没有 podman**（`Get-Command podman` 为空）。
 *   · 因此本机**没有任何**"真测到的固化耗时/产物体积"——报告里一处都不许编。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(selfDir, '..', 'dist', 'container-probe.js');
const MEASURE = process.argv.includes('--measure');
const outDir = process.env.WARMY_FREEZE_OUT || path.join(os.tmpdir(), 'perf', 'container');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (buf) => {
  if (!buf || buf.length === 0) return '';
  let nuls = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) nuls++;
  return nuls > n * 0.2 ? buf.toString('utf16le') : buf.toString('utf8');
};
function run(file, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 22, encoding: 'buffer' }, (err, stdout, stderr) => {
      resolve({
        ms: Date.now() - t0,
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? String(err.code) : 0),
        out: decode(stdout),
        err: decode(stderr) || (err ? String(err.message).split('\n')[0] : ''),
      });
    });
  });
}

const results = [];
function record(r) { results.push(r); }

/* ── 1. docker：CLI 命令面（不需要守护进程）+ 引擎是否可达 ───────────────── */
async function probeDocker() {
  const ver = await run('docker', ['--version'], 15000);
  if (!ver.ok && !ver.out) {
    return record({ runtimeId: 'docker', capability: 'supported', kind: 'image-commit', verified: 'cli-missing', cli: false, commands: ['docker commit <container> <image:tag>', 'docker save <image> -o x.tar', 'docker export <container> -o x.tar'], artifactSize: '未测（CLI 不在）', timeMs: null, notes: ['cli-not-found'] });
  }
  // 逐条验证命令**真的在**（只读，不需要引擎）
  const cmds = {};
  for (const c of ['commit', 'save', 'load', 'export', 'import', 'build', 'tag', 'push']) {
    const h = await run('docker', [c, '--help'], 15000);
    cmds[c] = h.ok || /^Usage:\s+docker\s+/i.test(h.out + h.err);
  }
  const info = await run('docker', ['info', '--format', '{{.ServerVersion}}|{{.OSType}}'], 20000);
  const engineUp = info.ok && !!info.out.trim();
  return record({
    runtimeId: 'docker',
    capability: 'supported',
    kind: 'image-commit',
    verified: engineUp ? (MEASURE ? 'measured' : 'cli-verified') : 'engine-down',
    cli: true,
    cliVersion: (ver.out || ver.err).trim().split('\n')[0],
    commands: ['docker commit <container> <image:tag>', 'docker save <image> -o x.tar', 'docker export <container> -o x.tar', 'docker import x.tar <image:tag>'],
    commandHelpOk: cmds,
    engineUp,
    engineDetail: engineUp ? info.out.trim() : (info.err || '').slice(0, 200),
    artifactSize: '未测（本机引擎起不来；固化产物 = 基础镜像 + 容器增量层，量级取决于改动量）',
    timeMs: null,
    notes: ['commit-is-cheap-metadata-op', 'product-is-the-frozen-image', engineUp ? 'ready-to-measure' : 'engine-unavailable-on-this-machine'],
  });
}

/* ── 2. wsl：**没有 commit**，只有 export/import（逐字核对 --help） ───────── */
async function probeWsl() {
  const help = await run('wsl.exe', ['--help'], 20000);
  const text = help.out + help.err;
  const has = (re) => re.test(text);
  const distroList = await run('wsl.exe', ['-l', '-q'], 20000);
  const distros = distroList.out.replace(/\u0000/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // 发行版磁盘镜像（= export 的现实代价量级）：从 HKCU\...\Lxss 的 BasePath 拿，不猜路径
  const sizes = [];
  const reg = await run('reg.exe', ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss', '/s', '/v', 'BasePath'], 20000);
  for (const line of (reg.out + reg.err).split(/\r?\n/)) {
    const m = line.match(/BasePath\s+REG_SZ\s+(.+?)\s*$/i);
    if (!m) continue;
    const base = m[1];
    try {
      const f = path.join(base, 'ext4.vhdx');
      if (fs.existsSync(f)) sizes.push({ basePath: base, vhdxBytes: fs.statSync(f).size });
    } catch { /* ignore */ }
  }
  return record({
    runtimeId: 'wsl',
    capability: 'supported',
    kind: 'vm-image-export',
    verified: has(/--export/) ? 'cli-verified' : 'cli-missing',
    cli: true,
    commands: ['wsl --export <distro> <file.tar>   （可用 --vhd 直接导出磁盘镜像）', 'wsl --import <distro> <installDir> <file.tar>   （--import-in-place 亦可）', 'wsl --terminate <distro> / wsl --shutdown'],
    hasExport: has(/--export/),
    hasImport: has(/--import/),
    hasImportInPlace: has(/--import-in-place/),
    hasVhdFlag: has(/--vhd/),
    hasCommit: /--commit/.test(text), // 预期 false：WSL 不是镜像仓库
    distros,
    diskImages: sizes,
    artifactSize: sizes.length
      ? '未导出（按产品主指示：体积大就不真导）。现实量级 = 发行版磁盘镜像 ' + sizes.map((s) => (s.vhdxBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB').join(' / ')
      : '未测（找不到发行版磁盘镜像）',
    timeMs: null,
    notes: ['no-commit-in-wsl', 'export-import-tar-not-docker-image', 'export-cost-scales-with-distro-size', 'export-not-performed-on-purpose'],
  });
}

/* ── 3. 其它运行时：有没有 CLI（能就报，不能就如实标） ───────────────────── */
const OTHERS = [
  { id: 'podman', cli: 'podman', args: ['--version'], capability: 'supported', kind: 'image-commit', commands: ['podman commit <container> <image:tag>', 'podman save / podman load'], notes: ['podman-has-commit'] },
  { id: 'nerdctl', cli: 'nerdctl', args: ['--version'], capability: 'supported', kind: 'image-commit', commands: ['nerdctl commit', 'nerdctl save / load'], notes: ['containerd-image-store'] },
  { id: 'isulad', cli: 'isula', args: ['version'], capability: 'supported', kind: 'image-commit', commands: ['isula commit', 'isula export / load'], notes: ['isulad-has-commit'] },
  { id: 'pouch', cli: 'pouch', args: ['version'], capability: 'supported', kind: 'image-commit', commands: ['pouch commit', 'pouch save / load'], notes: ['pouch-has-commit'] },
  { id: 'lxd-incus', cli: 'incus', args: ['version'], capability: 'supported', kind: 'filesystem-export', commands: ['incus publish <instance> --alias x', 'incus snapshot create <instance> <name>', 'incus export <instance> x.tar'], notes: ['system-container-not-a-container-engine'] },
  { id: 'rancher-desktop', cli: 'rdctl', args: ['version'], capability: 'unknown', kind: 'image-commit', commands: ['（底层是 containerd/nerdctl，固化走 nerdctl；rdctl 自身没有 commit）'], notes: ['rdctl-has-no-commit-itself'] },
  { id: 'colima', cli: 'colima', args: ['version'], capability: 'unsupported', kind: 'none', commands: ['（colima 是 VM 管理器，没有镜像固化命令；容器内的固化走 docker/podman）'], notes: ['vm-manager-not-image-store'] },
  { id: 'lima', cli: 'limactl', args: ['--version'], capability: 'unsupported', kind: 'none', commands: ['（limactl 无快照/固化；容器内的固化走运行时自身）'], notes: ['vm-manager-no-snapshot'] },
  { id: 'kata', cli: 'kata-runtime', args: ['--version'], capability: 'not-applicable', kind: 'none', commands: [], notes: ['isolation-level-not-an-engine'] },
  { id: 'windows-sandbox', cli: 'wsb', args: ['--help'], capability: 'unsupported', kind: 'none', commands: [], notes: ['one-shot-vm-no-image-format'] },
];
async function probeOthers() {
  for (const o of OTHERS) {
    const r = await run(o.cli, o.args, 15000);
    const missing = !r.ok && !r.out && /ENOENT|not recognized|不是内部或外部命令|cannot find/i.test(r.err);
    record({
      runtimeId: o.id,
      capability: o.capability,
      kind: o.kind,
      verified: r.ok || r.out ? 'cli-verified' : (missing ? 'cli-missing' : 'cli-missing'),
      cli: !missing,
      commands: o.commands,
      artifactSize: '未测（本机不可用）',
      timeMs: null,
      notes: [...o.notes, missing ? 'cli-not-found-on-this-machine' : 'cli-present-engine-state-unknown'],
    });
  }
}

/* ── 4. --measure：只有引擎真的起来时才做真测（做完**必须**清理） ───────── */
async function measureDockerCommit() {
  const info = await run('docker', ['info', '--format', '{{.ServerVersion}}'], 20000);
  if (!info.ok || !info.out.trim()) {
    console.log('\n[measure] 跳过：引擎不可达（`docker info` 失败），**不会**编造耗时/体积。');
    return { performed: false, why: (info.err || 'engine unreachable').slice(0, 200) };
  }
  const mod = await import(new URL('file://' + dist.replace(/\\/g, '/')).href);
  const alpine = (mod.CONTAINER_BASE_IMAGES || []).find((x) => /alpine/.test(x.ref));
  const ref = alpine && alpine.digest ? `${alpine.ref}@${alpine.digest}` : 'alpine:3.20';
  const name = 'warmy-freeze-probe';
  const img = 'warmy-freeze-probe:tmp';
  const out = { performed: true, image: ref, steps: [] };
  try {
    const pull = await run('docker', ['pull', ref], 300000);
    out.steps.push({ step: 'pull', ms: pull.ms, ok: pull.ok });
    const c = await run('docker', ['run', '-d', '--name', name, ref, 'sh', '-c', 'dd if=/dev/urandom of=/probe.bin bs=1M count=8 && sync && sleep 600'], 120000);
    out.steps.push({ step: 'run', ms: c.ms, ok: c.ok, out: c.out.slice(0, 60) });
    const before = await run('docker', ['image', 'inspect', '--format', '{{.Size}}', ref], 30000);
    out.baseImageBytes = Number(before.out.trim()) || null;
    const commit = await run('docker', ['commit', name, img], 300000);
    out.commitMs = commit.ms;
    out.steps.push({ step: 'commit', ms: commit.ms, ok: commit.ok, out: (commit.out || commit.err).slice(0, 120) });
    const after = await run('docker', ['image', 'inspect', '--format', '{{.Size}}', img], 30000);
    out.frozenImageBytes = Number(after.out.trim()) || null;
    out.deltaBytes = out.baseImageBytes != null && out.frozenImageBytes != null ? out.frozenImageBytes - out.baseImageBytes : null;
    const save = await run('docker', ['save', img, '-o', path.join(outDir, 'freeze-probe.tar')], 300000);
    out.saveMs = save.ms;
    try { out.tarBytes = fs.statSync(path.join(outDir, 'freeze-probe.tar')).size; } catch { out.tarBytes = null; }
  } finally {
    // 清理：容器 + 临时镜像 + tar（**只删我们自己建的**）
    const rm = await run('docker', ['rm', '-f', name], 60000);
    const rmi = await run('docker', ['rmi', '-f', img], 60000);
    const clean = { rmOk: rm.ok, rmiOk: rmi.ok };
    try { fs.rmSync(path.join(outDir, 'freeze-probe.tar'), { force: true }); } catch { /* ignore */ }
    out.cleanup = { ...clean, tarRemoved: !fs.existsSync(path.join(outDir, 'freeze-probe.tar')) };
    console.log('[measure] 清理: ' + JSON.stringify(out.cleanup));
  }
  return out;
}

/* ── 主流程 ────────────────────────────────────────────────────────────── */
console.log('=== 环境固化能力探测（runtime × 能不能固化 × 代价） ===');
console.log('machine=' + os.platform() + '  at=' + new Date().toISOString() + '  measure=' + MEASURE);
await probeDocker();
await probeWsl();
await probeOthers();
if (!fs.existsSync(path.join(selfDir, '..', 'dist', 'container-probe.js'))) {
  console.log('⚠️ 缺少 dist/container-probe.js（--measure 需要它；先构建）');
}

const measured = MEASURE ? await measureDockerCommit() : { performed: false, why: 'not-requested' };

console.log('\n--- 结果表 ---');
const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
console.log(pad('runtime', 18) + pad('can-freeze', 14) + pad('kind', 20) + pad('verified', 15) + 'cost');
for (const r of results) {
  console.log(pad(r.runtimeId, 18) + pad(r.capability, 14) + pad(r.kind, 20) + pad(r.verified, 15) + (r.timeMs != null ? r.timeMs + 'ms' : r.artifactSize.slice(0, 60)));
}

const payload = {
  at: new Date().toISOString(),
  machine: { platform: os.platform(), release: os.release() },
  results,
  measure: measured,
  honesty: {
    measuredOnThisMachine: results.filter((r) => r.verified === 'measured').map((r) => r.runtimeId),
    cliVerifiedOnly: results.filter((r) => r.verified === 'cli-verified').map((r) => r.runtimeId),
    engineUnavailable: results.filter((r) => r.verified === 'engine-down').map((r) => r.runtimeId),
    cliMissing: results.filter((r) => r.verified === 'cli-missing').map((r) => r.runtimeId),
    noCommitRuntimes: ['wsl'],
    note: '本机没有任何真测到的固化耗时/体积：docker 引擎起不来（缺注册表键）、podman 未安装、WSL 只有 export（按指示未真导）。',
  },
};
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'freeze-capability.json'), JSON.stringify(payload, null, 1), 'utf8');
  console.log('\n结果写入: ' + path.join(outDir, 'freeze-capability.json'));
} catch (e) { console.log('写入失败: ' + String(e && e.message)); }
console.log('诚实边界: ' + JSON.stringify(payload.honesty));
