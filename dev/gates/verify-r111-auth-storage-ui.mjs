/**
 * verify-r111-auth-storage-ui.mjs —— 真 Electron（临时 profile，真实注册流程）：
 * 注册后 keyEnvelope 建立、memory.db 从明文迁到 SQLCipher 密文，JSONL 仍是事实源。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const port = Number(process.env.R111_AUTH_PORT || 10313);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r111-auth-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [], instances: [],
}));
const env = { ...process.env };
delete env.WARMY_AUTH_BYPASS;
delete env.ELECTRON_RUN_AS_NODE;
const packagedExe = String(process.env.R111_EXE || '').trim();
const child = spawn(packagedExe || path.join(pkg, 'node_modules/electron/dist/electron.exe'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  ...(packagedExe ? [] : [path.join(pkg, 'dist/electron-main.js')]),
], { cwd: packagedExe ? path.dirname(packagedExe) : pkg, env, stdio: 'ignore' });
let c;
let passed = 0;
const check = (name, condition, detail) => {
  assert.ok(condition, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  passed += 1;
  console.log('PASS ' + name);
};
const evalOk = async (expr) => {
  const r = await c.evaluate(expr);
  assert.ok(!r?.__exc, 'Renderer evaluation failed: ' + r?.__exc);
  return r;
};
try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) {
    try { c = await attach(port, { matchUrlIncludes: 'index.html', callTimeout: 15000 }); }
    catch { await sleep(150); }
  }
  assert.ok(c, 'Electron dev app did not start');
  await c.send('Runtime.enable');
  await c.waitFor('!!window.warmy?.authRegisterBegin', { timeout: 30000 });
  const begin = await evalOk(`window.warmy.authRegisterBegin()`);
  check('真实注册开始（拿到 24 词助记词）', begin?.ok && String(begin.mnemonic || '').split(/\s+/).length === 24, begin?.error);
  const commit = await evalOk(`window.warmy.authRegisterCommit({ mnemonicConfirmed: true, pin: '12345678', confirmPin: '12345678' })`);
  check('真实注册提交成功', commit?.ok, commit);
  await sleep(4500);
  const state = await evalOk(`window.warmy.authState()`);
  check('注册后账号已解锁', state?.ok && state.hasAccount === true && state.unlocked === true, state);
  const ap = await evalOk(`window.warmy.memoryAppend('R111_JSONL_SENTINEL')`);
  check('加密记忆服务可写入（子进程拿到库密钥）', ap?.ok === true, ap);
  await sleep(400);
  const envFile = path.join(profile, 'auth', 'key-envelope.json');
  const db = path.join(profile, 'memory', 'memory.db');
  const jsonl = path.join(profile, 'memory', 'fast-memory.jsonl');
  const envObj = fs.existsSync(envFile) ? JSON.parse(fs.readFileSync(envFile, 'utf8')) : null;
  check('keyEnvelope 已建立（Kroot + legacy 双包裹）', !!envObj && envObj.v === 1 && !!envObj.krootFp && !!envObj.kroot && !!envObj.legacy, envObj);
  check('memory.db 已迁到密文（不再是明文 SQLite 头）', fs.existsSync(db) && !fs.readFileSync(db).subarray(0, 16).toString('utf8').startsWith('SQLite format 3'));
  const rawJsonl = fs.existsSync(jsonl) ? fs.readFileSync(jsonl) : Buffer.alloc(0);
  check('JSONL 已静态加密（磁盘无明文哨兵）', rawJsonl.subarray(0, 8).toString() === 'WARMYEF2' && !rawJsonl.includes(Buffer.from('R111_JSONL_SENTINEL')));
  const plainBak = fs.readdirSync(path.join(profile, 'memory')).filter((f) => /^memory\.db\.plain-.*\.bak$/.test(f));
  check('明文旧库改名留档（可回滚）', plainBak.length >= 1, plainBak);
  console.log(`\nverify-r111-auth-storage-ui: ${passed} PASS / 0 FAIL`);
} finally {
  try { child.kill(); } catch { /* noop */ }
  await sleep(700);
  if (process.env.R111_KEEP === '1') console.log('FIXTURE ' + profile);
  else fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
