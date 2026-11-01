#!/usr/bin/env node
/**
 * verify-r120-plugin-code-plain.mjs —— 第 119 轮决定 1/C：技能/插件加密边界拆分。
 *
 * 验的是**行为**，不是源码字符串：
 *   A. 代码/文档（.mjs/.py/SKILL.md/package.json）落盘是明文，外部解释器能直接执行；
 *   B. 配置/凭据（mcp-servers.json、settings.json、config.yaml、.env）仍是密文，本层读取可解密；
 *   C. 旧版本误加密的代码可迁移为明文；迁移失败不删原文件；重复迁移幂等；
 *   D. 普通受管文件仍由 migrateTree 加密，代码不会被 migrateTree 误加密；
 *   E. 目录复制/复制文件边界：密文代码复制到代码目录必须解密，不能把密文当明文代码。
 *
 * 只用临时目录、随机密钥、合成内容；不读真实 profile；结束删除临时目录。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const encfs = require('../src/enc-fs.cjs');

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-code-plain-'));
const key = crypto.randomBytes(32);
encfs.install({ root });
encfs.setKey(key);

const skillDir = path.join(root, 'scan-dirs', 'skills', 'demo');
const pluginDir = path.join(root, 'scan-dirs', 'plugins', 'demo');
const legacyDir = path.join(root, 'skills', 'legacy');
fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(pluginDir, { recursive: true });
fs.mkdirSync(legacyDir, { recursive: true });

const script = 'const x = 6 * 7; console.log(JSON.stringify({ answer: x }));\n';
const py = 'print("hello")\n';
const skillMd = '---\nname: demo\ndescription: 临时测试技能\n---\n\n# Demo\n';
const pkgJson = '{"name":"demo-skill","version":"1.0.0","type":"module"}\n';
const pluginJson = '{"id":"demo","entry":"bridge.mjs"}\n';
const configJson = JSON.stringify({ token: 'secret-token-不应泄露', servers: [{ cmd: 'node' }] });
const settingsJson = JSON.stringify({ theme: 'dark', secret: 'abc' });
const yaml = 'db:\n  password: hunter2\n';
const envFile = 'API_KEY=sk-test-1234567890\n';

fs.writeFileSync(path.join(skillDir, 'script.mjs'), script);
fs.writeFileSync(path.join(skillDir, 'tool.py'), py);
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);
fs.writeFileSync(path.join(skillDir, 'README.md'), '# demo\n');
fs.writeFileSync(path.join(pluginDir, 'bridge.mjs'), script);
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), pluginJson);
fs.writeFileSync(path.join(pluginDir, 'mcp-servers.json'), configJson);
fs.writeFileSync(path.join(pluginDir, 'settings.json'), settingsJson);
fs.writeFileSync(path.join(pluginDir, 'config.yaml'), yaml);
fs.writeFileSync(path.join(pluginDir, '.env'), envFile);
fs.writeFileSync(path.join(legacyDir, 'SKILL.md'), skillMd);

/** 绕过加密层读磁盘原始字节（fs.readSync 未被包装） */
const raw = (p) => {
  const fd = fs.openSync(p, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const n = fs.readSync(fd, buf, off, size - off, off);
      if (!n) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
};
/** 绕过加密层写磁盘原始字节 */
const writeDisk = (p, buf) => {
  const fd = fs.openSync(p, 'w');
  try { fs.writeSync(fd, buf, 0, buf.length); } finally { try { fs.closeSync(fd); } catch { /* noop */ } }
};
const isCipher = (p) => raw(p).subarray(0, 8).toString('binary') === 'WARMYEF2';

ok('脚本 .mjs 落盘是明文', raw(path.join(skillDir, 'script.mjs')).toString('utf8') === script);
ok('Python 脚本落盘是明文', raw(path.join(skillDir, 'tool.py')).toString('utf8') === py);
ok('SKILL.md 落盘是明文', raw(path.join(skillDir, 'SKILL.md')).toString('utf8') === skillMd);
ok('README.md 落盘是明文', raw(path.join(skillDir, 'README.md')).toString('utf8') === '# demo\n');
ok('旧 skills 目录的 SKILL.md 也是明文', raw(path.join(legacyDir, 'SKILL.md')).toString('utf8') === skillMd);
ok('plugin.json 落盘是明文', raw(path.join(pluginDir, 'plugin.json')).toString('utf8') === pluginJson);
ok('bridge.mjs 落盘是明文', raw(path.join(pluginDir, 'bridge.mjs')).toString('utf8') === script);

ok('mcp-servers.json 落盘是密文', isCipher(path.join(pluginDir, 'mcp-servers.json')) === true);
ok('settings.json 落盘是密文', isCipher(path.join(pluginDir, 'settings.json')) === true);
ok('config.yaml 落盘是密文', isCipher(path.join(pluginDir, 'config.yaml')) === true);
ok('.env 落盘是密文', isCipher(path.join(pluginDir, '.env')) === true);
ok('密文配置仍可通过受管 fs 读出原文',
  fs.readFileSync(path.join(pluginDir, 'mcp-servers.json'), 'utf8') === configJson);
ok('密文 .env 仍可通过受管 fs 读出原文',
  fs.readFileSync(path.join(pluginDir, '.env'), 'utf8') === envFile);

const exec = spawnSync(process.execPath, [path.join(skillDir, 'script.mjs')], { encoding: 'utf8' });
ok('外部 Node 解释器可直接执行明文脚本', exec.status === 0 && JSON.parse(String(exec.stdout)) .answer === 42,
  { status: exec.status, stderr: String(exec.stderr).slice(0, 200) });

ok('isPlainCodeFile 对配置返回 false',
  encfs.isPlainCodeFile(path.join(pluginDir, 'mcp-servers.json')) === false);
ok('isCodePath 对代码目录返回 true', encfs.isCodePath(skillDir) === true);
ok('isCodePath 对普通数据目录返回 false', encfs.isCodePath(path.join(root, 'memory')) === false);

const st = encfs.statusInfo(root);
ok('状态统计把代码计为明文代码', st.codePlain >= 7, st);
ok('状态统计仍统计到密文配置', st.encrypted >= 4, st);

// 旧版本误加密的代码：直接写密文，模拟升级前状态
const legacyEnc = path.join(skillDir, 'legacy-tool.mjs');
writeDisk(legacyEnc, encfs.sealFileBuffer(Buffer.from('console.log("legacy")\n')));
ok('迁移前该代码文件确实是密文', isCipher(legacyEnc) === true);
ok('迁移前受管 fs 仍能读出代码原文',
  fs.readFileSync(legacyEnc, 'utf8') === 'console.log("legacy")\n');
const n1 = encfs.migrateCodeToPlain(root, () => {});
ok('旧密文代码被迁移为明文', n1 >= 1 && raw(legacyEnc).toString('utf8') === 'console.log("legacy")\n', { n1 });
const n2 = encfs.migrateCodeToPlain(root, () => {});
ok('重复迁移幂等（第二次为 0）', n2 === 0, { n2 });
ok('配置在迁移后仍是密文', isCipher(path.join(pluginDir, 'settings.json')) === true);

// 迁移失败不删原文件：用一个无法解密（错误头）的代码文件
const bad = path.join(skillDir, 'bad.mjs');
const badBuf = Buffer.concat([Buffer.from('WARMYEF2', 'binary'), Buffer.alloc(40, 7)]);
writeDisk(bad, badBuf);
const logs = [];
const n3 = encfs.migrateCodeToPlain(root, (s) => logs.push(s));
ok('损坏的密文代码迁移失败但原文件保留',
  n3 === 0 && fs.existsSync(bad) && raw(bad).equals(badBuf), { n3, logs: logs.slice(0, 2) });
fs.rmSync(bad, { force: true });

// migrateTree 不把代码误加密
const n4 = encfs.migrateTree(root, () => {});
ok('migrateTree 不会把明文代码重新加密',
  n4 >= 0 && raw(path.join(skillDir, 'script.mjs')).toString('utf8') === script);
ok('migrateTree 后配置仍是密文', isCipher(path.join(pluginDir, 'settings.json')) === true);

// 密文代码复制到代码目录：解密而不是复制密文
const encryptedSrc = path.join(root, 'old-bridge.enc');
writeDisk(encryptedSrc, encfs.sealFileBuffer(Buffer.from('console.log("copied")\n')));
const copyDst = path.join(pluginDir, 'copied.mjs');
fs.copyFileSync(encryptedSrc, copyDst);
ok('密文代码复制到代码目录会被解密', raw(copyDst).toString('utf8') === 'console.log("copied")\n');
ok('复制后的代码文件不是密文', isCipher(copyDst) === false);

if (process.platform !== 'win32') {
  ok('明文代码文件权限为 0600（POSIX）',
    (fs.statSync(path.join(skillDir, 'script.mjs')).mode & 0o777) === 0o600,
    (fs.statSync(path.join(skillDir, 'script.mjs')).mode & 0o777).toString(8));
  ok('代码目录权限为 0700（POSIX）',
    (fs.statSync(skillDir).mode & 0o777) === 0o700,
    (fs.statSync(skillDir).mode & 0o777).toString(8));
} else {
  ok('Windows 下明文代码可读且 ACL 收紧调用不抛错', raw(path.join(skillDir, 'script.mjs')).length === script.length);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass}/${pass} passed`);
