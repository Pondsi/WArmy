/**
 * Spike 5：手动模拟 dsh plugin add（绕过 PATH 中无 pnpm）
 * 1) 写入 profile package.json 依赖
 * 2) 用绝对路径 pnpm install
 * 3) dump-config 检查两 bundle 是否共存
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dshHome = path.join(os.tmpdir(), `ccarmy-dsh-home2-${Date.now()}`);
const profileName = 'ccarmy-spike5';
const profileDir = path.join(dshHome, 'profiles', profileName);
const pnpm = 'C:\\Users\\p\\AppData\\Local\\pnpm\\pnpm.cmd';
const node = process.execPath;

const teamsPkg = path.join(__dirname, 'node_modules', '@nanmicoder', 'dsh-agent-teams');
const memBundle = path.join(__dirname, 'dsh-memory-plus', 'packages', 'dsh-memory-bundle');

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

fs.mkdirSync(profileDir, { recursive: true });

// 创建 profile
let r = await run(
  'npx',
  ['--yes', '@deepseek-ai/dsh@0.1.5-rc.1', '--profile', profileName, '--from-default-profile', 'web', '--dump-config'],
  __dirname
);
console.log('profile create', r.code);

// 读 package.json 并注入依赖 + bundles
const pkgPath = path.join(profileDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies = {
  ...(pkg.dependencies || {}),
  '@nanmicoder/dsh-agent-teams': `file:${teamsPkg.replace(/\\/g, '/')}`,
  'dsh-memory-bundle': `file:${memBundle.replace(/\\/g, '/')}`,
};
// memory-plus 可能不是 npm name dsh-memory-bundle —— 用目录名
// 核对
const memPkg = JSON.parse(fs.readFileSync(path.join(memBundle, 'package.json'), 'utf8'));
pkg.dependencies[memPkg.name] = `file:${memBundle.replace(/\\/g, '/')}`;
delete pkg.dependencies['dsh-memory-bundle'];

pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const bundles = new Set(pkg.dsh.profile.bundles || []);
// 期望合成后的 bundle 列表包含这两项（名称与 package.json name 一致）
bundles.add('@nanmicoder/dsh-agent-teams');
bundles.add(memPkg.name);
pkg.dsh.profile.bundles = [...bundles];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

// 同时把两份 cordis.patch.yml 追加到 profile 的 patch 层
const teamsPatch = fs.readFileSync(path.join(teamsPkg, 'cordis.patch.yml'), 'utf8');
const memPatchPath = path.join(memBundle, 'cordis.patch.yml');
const memPatch = fs.existsSync(memPatchPath) ? fs.readFileSync(memPatchPath, 'utf8') : '';
const profilePatch = path.join(profileDir, 'cordis.patch.yml');
const existing = fs.existsSync(profilePatch) ? fs.readFileSync(profilePatch, 'utf8') : '';
const merged =
  existing +
  `\n# --- spike5: agent-teams ---\n` +
  teamsPatch +
  `\n# --- spike5: memory-bundle ---\n` +
  memPatch +
  '\n';
fs.writeFileSync(profilePatch, merged);

// pnpm install（绝对路径）
const inst = await run(pnpm, ['install'], profileDir);
console.log('pnpm install', inst.code, (inst.err || inst.out).slice(-500));

// dump-config
const dump = await run(
  'npx',
  ['--yes', '@deepseek-ai/dsh@0.1.5-rc.1', '--profile', profileName, '--dump-config'],
  __dirname
);
const text = dump.out + dump.err;
const hasTeams = /agent-teams/i.test(text);
const hasMemory =
  /dsh-memory-bundle|dsh-memory-core|dsh-session-query-sqlite-cjk|dsh-tool-result-dedup/i.test(text);

// 检查 node_modules 是否装上
const teamsInstalled = fs.existsSync(path.join(profileDir, 'node_modules', '@nanmicoder', 'dsh-agent-teams'));
const memInstalled =
  fs.existsSync(path.join(profileDir, 'node_modules', memPkg.name)) ||
  fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-memory-bundle'));

const report = {
  dshHome,
  profileDir,
  memPackageName: memPkg.name,
  installCode: inst.code,
  installTail: (inst.err || inst.out).slice(-400),
  dumpCode: dump.code,
  teamsInstalled,
  memInstalled,
  hasTeamsInDump: hasTeams,
  hasMemoryInDump: hasMemory,
  bothMounted: hasTeams && hasMemory,
  bundleIds: pkg.dsh.profile.bundles,
  passDoD: teamsInstalled && memInstalled && hasTeams && hasMemory,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.passDoD ? 0 : 1);
