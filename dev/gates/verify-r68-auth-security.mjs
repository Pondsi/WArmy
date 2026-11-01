/**
 * verify-r68-auth-security —— 第 68 轮：本机凭证失效的行为门禁
 *
 * 用户口径：用助记词登录后，如果本机生成了新的手动 PIN 或新的自动登录凭证，
 * 原来的 PIN 与原来的自动登录都必须失效。
 *
 * 用编译后的 AuthService + 临时 vault + 假 OS 保护器跑，不碰真实 profile，
 * 不读取真实密钥；每条用例都在独立临时目录里建账号、切换凭证、再登录验证。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../../packages/app-shell/dist/auth-service.js';
import { DataVault } from '../../packages/app-shell/dist/data-vault.js';

let ok = 0;
const hong = [];
const jian = (name, fn) => {
  try {
    fn();
    ok += 1;
    console.log('  ok   ' + name);
  } catch (e) {
    hong.push(name);
    console.log('  FAIL ' + name + ' ← ' + String((e && (e.stack || e.message)) || e).slice(0, 500));
  }
};

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r68-sec-'));
  const protector = {
    availableFlag: true,
    available: () => protector.availableFlag,
    protect: (v) => 'fake-os:' + Buffer.from(String(v), 'utf8').toString('base64'),
    unprotect: (v) => Buffer.from(String(v).slice('fake-os:'.length), 'base64').toString('utf8'),
  };
  let profile = { username: '测试账号' };
  const identity = {
    info: () => null,
    exists: () => false,
    ensureIdentity: () => ({ ok: true }),
    restoreFromCredential: () => ({ ok: true }),
    setPassphrase: () => ({ ok: true }),
    unlock: () => ({ ok: true }),
    lock: () => {},
  };
  const svc = new AuthService({
    vaultFile: path.join(dir, 'auth', 'vault.json'),
    identity,
    profile: {
      loadProfile: () => ({ ...profile }),
      saveProfile: (p) => { profile = { ...p }; },
    },
    protector,
    now: () => Date.now(),
  });
  return {
    dir,
    svc,
    protector,
    vault: () => JSON.parse(fs.readFileSync(path.join(dir, 'auth', 'vault.json'), 'utf8')),
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } },
  };
}

function createPin(h, pin, confirmed = true) {
  const reg = h.svc.registerBegin();
  assert.equal(reg.ok, true, 'registerBegin: ' + JSON.stringify(reg));
  assert.equal(String(reg.mnemonic || '').split(' ').length, 24, 'mnemonic word count');
  const c = h.svc.registerCommit({ mnemonicConfirmed: confirmed, pin, confirmPin: pin });
  assert.equal(c.ok, true, 'registerCommit: ' + JSON.stringify(c));
  return reg.mnemonic;
}

jian('A 助记词登录后设置新手动 PIN：旧 PIN 失效，新 PIN 可用，自动登录不残留', () => {
  const h = mk();
  try {
    const mnemonic = createPin(h, 'Old1234');
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').ok, true);
    h.svc.logout();
    assert.equal(h.svc.recoverBegin(mnemonic).ok, true);
    assert.equal(h.svc.recoverCommit({ pin: 'New1234', confirmPin: 'New1234' }).ok, true);
    h.svc.logout();
    const oldPin = h.svc.loginPin('Old1234');
    assert.equal(oldPin.ok, false);
    assert.equal(oldPin.error, 'bad-pin');
    assert.equal(h.svc.loginPin('New1234').ok, true);
    const st = h.svc.state();
    assert.equal(st.pinConfigured, true);
    assert.equal(st.autoLogin, false);
    assert.equal(h.vault().autoLogin, null);
  } finally { h.cleanup(); }
});

jian('B 助记词登录后生成新自动登录：旧 PIN 失效，旧自动登录记录被替换', () => {
  const h = mk();
  try {
    const mnemonic = createPin(h, 'Old1234');
    assert.equal(h.svc.setAutoLogin(true).ok, true);
    const before = h.vault();
    assert.equal(before.pin, null, 'setAutoLogin(true) 必须清掉旧 PIN');
    const oldMachine = before.autoLogin && before.autoLogin.binding.machineId;
    assert.match(String(oldMachine), /^[0-9a-f]{32}$/);
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').error, 'pin-not-configured');
    assert.equal(h.svc.loginAuto().ok, true);
    h.svc.logout();
    assert.equal(h.svc.recoverBegin(mnemonic).ok, true);
    assert.equal(h.svc.recoverCommit({ autoLogin: true }).ok, true);
    const after = h.vault();
    assert.equal(after.pin, null);
    assert.ok(after.autoLogin, '新自动登录记录必须存在');
    assert.notEqual(after.autoLogin.binding.machineId, oldMachine, '旧自动登录绑定必须被替换');
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').error, 'pin-not-configured');
    assert.equal(h.svc.loginAuto().ok, true);
    assert.equal(h.svc.state().autoLogin, true);
  } finally { h.cleanup(); }
});

jian('C 助记词登录后只生成自动登录：旧 PIN 不再可用', () => {
  const h = mk();
  try {
    const mnemonic = createPin(h, 'Old1234');
    h.svc.logout();
    assert.equal(h.svc.recoverBegin(mnemonic).ok, true);
    assert.equal(h.svc.recoverCommit({ autoLogin: true }).ok, true);
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').error, 'pin-not-configured');
    assert.equal(h.svc.loginAuto().ok, true);
    const st = h.svc.state();
    assert.equal(st.pinConfigured, false);
    assert.equal(st.autoLogin, true);
  } finally { h.cleanup(); }
});

jian('D 旧自动登录账号经助记词登录后设置新 PIN：旧自动登录消失，旧 PIN 不复活', () => {
  const h = mk();
  try {
    const mnemonic = createPin(h, 'Old1234');
    assert.equal(h.svc.setAutoLogin(true).ok, true);
    h.svc.logout();
    assert.equal(h.svc.loginAuto().ok, true);
    h.svc.logout();
    assert.equal(h.svc.recoverBegin(mnemonic).ok, true);
    assert.equal(h.svc.recoverCommit({ pin: 'New1234', confirmPin: 'New1234' }).ok, true);
    h.svc.logout();
    assert.equal(h.svc.loginAuto().error, 'auto-login-not-enabled');
    assert.equal(h.svc.loginPin('Old1234').error, 'bad-pin');
    assert.equal(h.svc.loginPin('New1234').ok, true);
    const st = h.svc.state();
    assert.equal(st.autoLogin, false);
    assert.equal(st.pinConfigured, true);
    assert.equal(h.vault().autoLogin, null);
  } finally { h.cleanup(); }
});

jian('E 我的页开启自动登录：旧 PIN 立即失效；关闭后可设置新 PIN', () => {
  const h = mk();
  try {
    createPin(h, 'Old1234');
    assert.equal(h.svc.setAutoLogin(true).ok, true);
    assert.equal(h.svc.state().pinConfigured, false);
    assert.equal(h.svc.loginPin('Old1234').error, 'pin-not-configured');
    assert.equal(h.svc.changePin({ pin: 'New1234', confirmPin: 'New1234' }).error, 'auto-login-enabled');
    assert.equal(h.svc.setAutoLogin(false).ok, true);
    assert.equal(h.svc.state().autoLogin, false);
    assert.equal(h.svc.changePin({ pin: 'New1234', confirmPin: 'New1234' }).ok, true);
    const st = h.svc.state();
    assert.equal(st.pinConfigured, true);
    assert.equal(st.unlocked, false, '改 PIN 后会话应锁定');
    assert.equal(h.svc.loginPin('Old1234').error, 'bad-pin');
    assert.equal(h.svc.loginPin('New1234').ok, true);
  } finally { h.cleanup(); }
});

jian('F 负向保护：未确认助记词或系统保护不可用时，不许开自动登录、旧 PIN 不被清掉', () => {
  const h1 = mk();
  try {
    createPin(h1, 'Old1234', false);
    assert.equal(h1.svc.setAutoLogin(true).error, 'auto-login-requires-confirmed-mnemonic');
    assert.equal(h1.svc.state().pinConfigured, true);
    h1.svc.logout();
    assert.equal(h1.svc.loginPin('Old1234').ok, true);
  } finally { h1.cleanup(); }
  const h2 = mk();
  try {
    createPin(h2, 'Old1234');
    h2.protector.availableFlag = false;
    assert.equal(h2.svc.setAutoLogin(true).error, 'os-protection-unavailable');
    assert.equal(h2.svc.state().pinConfigured, true);
    h2.svc.logout();
    assert.equal(h2.svc.loginPin('Old1234').ok, true);
  } finally { h2.cleanup(); }
});

jian('G 重新注册并设置新 PIN：旧 PIN 失效，新账号的自动登录为空', () => {
  const h = mk();
  try {
    createPin(h, 'Old1234');
    const reg = h.svc.registerBegin(true);
    assert.equal(reg.ok, true);
    assert.equal(h.svc.registerCommit({ mnemonicConfirmed: true, pin: 'New1234', confirmPin: 'New1234' }).ok, true);
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').error, 'bad-pin');
    assert.equal(h.svc.loginPin('New1234').ok, true);
    assert.equal(h.vault().autoLogin, null);
  } finally { h.cleanup(); }
});

for (const autoLogin of [false, true]) {
  const name = `H 助记词恢复到${autoLogin ? '自动登录' : '新PIN'}后旧加密仓仍可读`;
  const h = mk();
  const vault = new DataVault({ userData: h.dir, protector: h.protector });
  let beforeKey, afterKey;
  try {
    const mnemonic = createPin(h, 'Old1234');
    const kdf = h.vault().kdf;
    beforeKey = h.svc.sessionMasterKeyCopy();
    vault.setMasterKey(beforeKey);
    assert.equal(vault.markFreshUnsealed().ok, true);
    const marker = path.join(h.dir, 'recovery-test.txt');
    fs.writeFileSync(marker, 'recovery-private-sentinel');
    assert.equal((await vault.seal()).ok, true);
    assert.equal(fs.existsSync(marker), false);
    vault.lock();
    h.svc.logout();
    assert.equal(h.svc.recoverBegin(mnemonic).ok, true);
    assert.equal(h.svc.recoverCommit(autoLogin ? { autoLogin: true } : { pin: 'New1234', confirmPin: 'New1234' }).ok, true);
    afterKey = h.svc.sessionMasterKeyCopy();
    vault.setMasterKey(afterKey);
    const restored = await vault.unseal();
    assert.equal(restored.ok, true, '旧数据仓必须用恢复后的密钥解开');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'recovery-private-sentinel');
    assert.ok(beforeKey.equals(afterKey), '恢复只能重包登录凭据，不能悄悄更换数据密钥');
    assert.deepEqual(h.vault().kdf, kdf);
    assert.equal((await vault.seal()).ok, true);
    vault.setMasterKey(Buffer.alloc(32, 7));
    assert.equal((await vault.unseal()).ok, false, '错误数据密钥不能解开仓库');
    assert.equal(fs.existsSync(marker), false, '错误密钥不能产生明文');
    vault.lock();
    h.svc.logout();
    assert.equal(h.svc.loginPin('Old1234').ok, false);
    assert.equal((autoLogin ? h.svc.loginAuto() : h.svc.loginPin('New1234')).ok, true);
    afterKey.fill(0);
    afterKey = h.svc.sessionMasterKeyCopy();
    vault.setMasterKey(afterKey);
    assert.equal((await vault.unseal()).ok, true, '再次登录后仍可解仓');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'recovery-private-sentinel');
    ok++;
    console.log('  ok   ' + name);
  } catch (e) {
    hong.push(name);
    console.log('  FAIL ' + name + ' ← ' + e.message);
  } finally {
    beforeKey?.fill(0);
    afterKey?.fill(0);
    vault.lock();
    h.svc.logout();
    h.cleanup();
  }
}

console.log(`\n==== verify-r68-auth-security：${ok} ok / ${hong.length} FAIL ====`);
process.exit(hong.length ? 1 : 0);
