/**
 * Spike 1（本机部分）: 系统 Node 24 能否加载 @deepseek-ai/dsh 与 node-pty prebuild
 * 完整 5 平台 bundled Node 验证需后续 CI / extraResources
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

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

try {
  const help = execFileSync('node', ['-e', "console.log(require.resolve('@deepseek-ai/dsh/package.json'))"], {
    encoding: 'utf8',
    cwd: process.cwd(),
  }).trim();
  report.dshPath = help;
} catch (e) {
  report.dshPath = String(e.message);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.dsh && !report.dsh.error ? 0 : 1);
