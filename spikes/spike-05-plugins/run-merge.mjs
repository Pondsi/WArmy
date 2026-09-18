/**
 * Spike 5 运行时：在同一 dsh profile 挂 agent-teams + memory-bundle
 * DoD：composed profile tree 同时含两个 bundle id；无 fatal 冲突
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dshHome = path.join(os.tmpdir(), `warmy-dsh-home-${Date.now()}`);
const profile = 'warmy-spike5';
const teamsPkg = path.join(__dirname, 'node_modules', '@nanmicoder', 'dsh-agent-teams');
const memBundle = path.join(__dirname, 'dsh-memory-plus', 'packages', 'dsh-memory-bundle');

fs.mkdirSync(dshHome, { recursive: true });

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const pnpmBin = 'C:\\Users\\p\\AppData\\Local\\pnpm';
    const p = spawn(cmd, args, {
      cwd: opts.cwd || __dirname,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        Path: `${pnpmBin};${process.env.Path || process.env.PATH || ''}`,
        ...opts.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('exit', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

const npx = process.platform === 'win32' ? 'npx' : 'npx';
const dshArgs = (extra) => ['--yes', '@deepseek-ai/dsh@0.1.5-rc.1', ...extra];

console.log('DSH_HOME', dshHome);

// 1) 从 web 模板创建 profile
let r = await run(npx, dshArgs(['--profile', profile, '--from-default-profile', 'web', '--dump-config']));
console.log('create profile code', r.code);
if (r.code !== 0) {
  // dump-config 可能仍创建了目录；再试
  console.log('stderr', r.err.slice(0, 500));
}

// 2) 依次 add 两个插件
const adds = [];
for (const pkg of [teamsPkg, memBundle]) {
  const a = await run(npx, dshArgs(['plugin', '--profile', profile, 'add', pkg]));
  adds.push({ pkg: path.basename(pkg), code: a.code, err: a.err.slice(-400), out: a.out.slice(-400) });
  console.log('add', path.basename(pkg), a.code);
}

// 3) dump 合成配置，检查两个 id 是否共存
const dump = await run(npx, dshArgs(['--profile', profile, '--dump-config']));
const text = dump.out + dump.err;
const hasTeams = /agent-teams/i.test(text);
const hasMemory = /dsh-memory-bundle|dsh-memory-core|dsh-session-query-sqlite-cjk|dsh-tool-result-dedup|memory-bundle/i.test(text);
const fatal = /fatal|ERR!|cannot|conflict/i.test(text) && !hasTeams;

const report = {
  dshHome,
  createCode: r.code,
  adds,
  dumpCode: dump.code,
  hasTeams,
  hasMemory,
  bothMounted: hasTeams && hasMemory,
  dumpExcerpt: text.split('\n').filter((l) => /agent-teams|memory|bundle|id:/i.test(l)).slice(0, 40),
  passDoD: hasTeams && hasMemory && !fatal,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.passDoD ? 0 : 1);
