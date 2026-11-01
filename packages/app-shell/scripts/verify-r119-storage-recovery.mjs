#!/usr/bin/env node
/**
 * verify-r119-storage-recovery.mjs —— W02：封存可恢复 + JSONL 追加不覆盖。
 *
 * 用**临时目录、临时密钥、合成文件**运行当前源码（enc-fs + DataVault dist）：
 *  A. 封存前必须证明候选归档可解；封存→重启→解包后内容/大小一致；
 *  B. 读取期间源文件变化 ⇒ 封存失败、源文件保留、旧 vault 不被替换；
 *  C. 加密 JSONL 正常追加仍可读；对目录/不可读路径追加必须抛错，不静默覆盖。
 *
 * 不读真实 profile，不写真实数据；结束删除临时目录。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const encfs = require('../src/enc-fs.cjs');
const { DataVault } = await import(pathToFileURL(path.join(pkg, 'dist', 'data-vault.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r119-storage-'));
const key = crypto.randomBytes(32);
encfs.install({ root });
encfs.setKey(key);

const protector = { available: () => false, protect: (v) => v, unprotect: (v) => v };
const master = crypto.randomBytes(32);
const settingsRel = 'settings.json';
const jsonlRel = 'memory/fast-memory.jsonl';
const emptyRel = 'empty/空.txt';
const zhRel = '中文/设置 副本.json';
const settingsText = JSON.stringify({ theme: 'dark', 名称: '临时测试', n: 42 });
const jsonlLines = ['{"seq":1,"text":"第一行"}', '{"seq":2,"text":"第二行"}', '{"seq":3,"text":"第三行"}'];
const zhText = JSON.stringify({ 说明: '中文路径与内容', v: 1 });

fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
fs.mkdirSync(path.join(root, '中文'), { recursive: true });
fs.writeFileSync(path.join(root, settingsRel), settingsText, 'utf8');
fs.writeFileSync(path.join(root, zhRel), zhText, 'utf8');
fs.writeFileSync(path.join(root, emptyRel), '', 'utf8');
for (const line of jsonlLines) fs.appendFileSync(path.join(root, jsonlRel), line + '\n');

ok('合成文件在磁盘上是密文（不是明文）', encfs.isEncryptedPath(path.join(root, settingsRel)) === true);
ok('JSONL 在磁盘上是密文', encfs.isEncryptedPath(path.join(root, jsonlRel)) === true);
ok('逻辑大小（statSync）小于密文物理大小（lstatSync）',
  fs.statSync(path.join(root, settingsRel)).size < fs.lstatSync(path.join(root, settingsRel)).size,
  { logical: fs.statSync(path.join(root, settingsRel)).size, physical: fs.lstatSync(path.join(root, settingsRel)).size });

const v1 = new DataVault({ userData: root, protector });
v1.setMasterKey(master);
v1.markFreshUnsealed();
const sealed = await v1.seal();
ok('封存返回成功', sealed.ok === true, sealed);
ok('封存后源设置文件已删除（只在归档里）', fs.existsSync(path.join(root, settingsRel)) === false);
ok('vault.bin 已写出', fs.existsSync(path.join(root, 'vault.bin')) === true);
const vaultHash0 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'vault.bin'))).digest('hex');

// 重启后解包
const v2 = new DataVault({ userData: root, protector });
v2.setMasterKey(master);
const unsealed = await v2.unseal();
ok('重启后解包成功（不是 bad-archive）', unsealed.ok === true, unsealed);
ok('普通文件内容逐字恢复', fs.readFileSync(path.join(root, settingsRel), 'utf8') === settingsText);
ok('中文路径/内容逐字恢复', fs.readFileSync(path.join(root, zhRel), 'utf8') === zhText);
ok('空文件恢复为 0 字节', fs.readFileSync(path.join(root, emptyRel), 'utf8') === '');
ok('JSONL 三行逐行恢复', fs.readFileSync(path.join(root, jsonlRel), 'utf8') === jsonlLines.join('\n') + '\n');

// B. 源文件在封存读取期间变化 ⇒ 失败且不删除源
const changingRel = 'changing.json';
const changingPath = path.join(root, changingRel);
fs.writeFileSync(changingPath, 'original-content', 'utf8');
const realCreate = fs.createReadStream;
fs.createReadStream = function (p, o) {
  const s = realCreate.call(fs, p, o);
  if (String(p).replace(/\\/g, '/').endsWith(changingRel)) {
    const out = new PassThrough();
    s.on('data', (d) => out.write(d));
    s.on('end', () => { out.write(Buffer.from('-EXTRA')); out.end(); });
    s.on('error', (e) => out.destroy(e));
    return out;
  }
  return s;
};
let changeSeal;
try {
  changeSeal = await v2.seal();
} finally {
  fs.createReadStream = realCreate;
}
ok('读取期间源变化 ⇒ 封存失败（不假报成功）', changeSeal.ok === false, changeSeal);
ok('失败后源文件仍在且内容未变', fs.existsSync(changingPath) && fs.readFileSync(changingPath, 'utf8') === 'original-content');
ok('失败后旧 vault 未被替换', crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'vault.bin'))).digest('hex') === vaultHash0);

// C. JSONL 追加仍正常；对目录追加必须抛错
fs.appendFileSync(path.join(root, jsonlRel), '{"seq":4,"text":"追加"}\n');
ok('加密 JSONL 正常追加后可读回', fs.readFileSync(path.join(root, jsonlRel), 'utf8').endsWith('{"seq":4,"text":"追加"}\n'));
const dirAsFile = path.join(root, 'append-target-dir');
fs.mkdirSync(dirAsFile);
let threw = false;
try { fs.appendFileSync(dirAsFile, 'x'); } catch { threw = true; }
ok('对目录追加必须抛错（非 ENOENT 不被当成新文件）', threw === true);
ok('失败后目录仍存在（没有被覆盖成文件）', fs.statSync(dirAsFile).isDirectory() === true);

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\nverify-r119-storage-recovery: ${pass} PASS / 0 FAIL`);
