/**
 * Spike 1（本机部分）: 系统 Node 24 能否加载 @deepseek-ai/dsh 与 node-pty prebuild
 * 完整 5 平台 bundled Node 验证需后续 CI / extraResources
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const report = { node: process.version, arch: process.arch, platform: process.platform };

try {
  const dshPkg = require('@deepseek-ai/dsh/package.json');
  report.dsh = { name: dshPkg.name, version: dshPkg.version, main: dshPkg.main || dshPkg.bin };
} catch (e) {
  report.dsh = { error: String(e.message) };
}

try {
  require('node-pty');
  report.nodePty = { load: true };
} catch (e) {
  report.nodePty = { load: false, error: String(e.message) };
}

// ADR 该条还要求 koffi prebuild 可得（dsh 的 Windows 原生能力依赖）
try {
  const koffi = require('koffi');
  report.koffi = { load: true, version: koffi.version ?? null };
} catch (e) {
  report.koffi = { load: false, error: String(e.message) };
}

try {
  const addon = require('node-addon-require-builtin');
  report.nodeAddonRequireBuiltin = { load: true, version: addon.version ?? null };
} catch (e) {
  report.nodeAddonRequireBuiltin = { load: false, error: String(e.message) };
}

try {
  const help = execFileSync('node', ['-e', "console.log(require.resolve('@deepseek-ai/dsh/package.json'))"], {
    encoding: 'utf8',
    cwd: import.meta.dirname,
  }).trim();
  report.dshPath = help;
} catch (e) {
  report.dshPath = String(e.message);
}

console.log(JSON.stringify(report, null, 2));

// ── 落盘原始证据（P0 复核：判定必须有原始输出支撑）──
const evidence = {
  spike: 'spike-01-bundled-node',
  title: 'bundled Node 拉起 dsh（本机部分）',
  dod: '5 平台 bundled Node 分别拉起 dsh 0.1.5-rc.1；node-pty / koffi prebuild 可得',
  ranAt: new Date().toISOString(),
  command: 'node spikes/spike-01-bundled-node/run.mjs',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  note: '本机只验证了「系统 Node 24 可加载 @deepseek-ai/dsh 与 node-pty prebuild」；5 平台 bundled Node 未验证',
  report,
  exitCode: report.dsh && !report.dsh.error ? 0 : 1,
};
fs.writeFileSync(path.join(import.meta.dirname, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(`原始结果已写入 ${path.join(import.meta.dirname, 'result.json')}`);

process.exit(report.dsh && !report.dsh.error ? 0 : 1);
