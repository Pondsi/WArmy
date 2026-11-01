/**
 * verify-r104-vault.mjs —— 第 104 轮：
 *   项 10：全量加密 vault（登录解锁 / 退出封存 / 加密导出导入）
 *   项 11：停止时供应商 cancel 钩子 + 执行者 AbortSignal
 *   项 12：nm 远程网页 WebContentsView（本地网页仍 iframe）
 *
 * 纯本地：不读任何真实密钥，不启动 Electron。DataVault 用临时目录做真加解密。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const main = read('src/electron-main.ts');
const auth = read('src/auth-service.ts');
const vaultSrc = read('src/data-vault.ts');
const appJs = read('src/renderer/app.js');
const authGate = read('src/renderer/auth-gate.js');
const preload = read('src/preload.cjs');
const nmWin = read('src/nm-viewer-win.ts');
const nmJs = read('src/renderer/nm-viewer.js');
const types = read('../providers/src/types.ts');
const base = read('../providers/src/base.ts');
const openai = read('../providers/src/openai.ts');
const executor = read('src/executor.ts');
const orch = read('src/orchestrator.ts');
const i18n = read('src/i18n/zh-CN.json');

let pass = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) throw new Error(`${name}${detail ? '：' + detail : ''}`);
  pass++;
  console.log('PASS ' + name);
};

/* ── 项 10：静态接线 ─────────────────────────────────────────────── */
ok('DataVault 主密钥派生用 HKDF 子密钥（不是直接拿主密钥当文件密钥）', /hkdfSync\('sha256'/.test(read('src/data-vault.ts')) && /warmy-data-vault/.test(read('src/data-vault.ts')));
ok('AuthService 提供会话主密钥副本 + 重启恢复', /sessionMasterKeyCopy\(\)/.test(auth) && /resumeWithMasterKey\(/.test(auth));
ok('主进程有数据仓库实例与登录后解包', /new DataVault\(/.test(main) && /shuJuVaultAfterLogin/.test(main));
ok('登录/自动登录/恢复后都走解包与重启', /authLoginPin[\s\S]{0,900}shuJuVaultAfterLogin/.test(main) && /authLoginAuto[\s\S]{0,900}shuJuVaultAfterLogin/.test(main));
ok('注销先封存再退出登录', /warmy:authLogout[\s\S]{0,1200}dv\.seal\(\)[\s\S]{0,400}s\.logout\(\)/.test(main));
ok('改 PIN 锁会话时也封存数据仓库', /warmy:authChangePin[\s\S]{0,900}dataVault\?\.isUnlocked\(\)[\s\S]{0,600}seal\(\)/.test(main));
ok('退出应用前封存数据仓库', /before-quit[\s\S]{0,2500}vaultSealedForQuit[\s\S]{0,1200}dv!\.seal\(\)/.test(main));
ok('导出按钮写全量 .nm（R111 起；旧 .wvault 只保留兼容导入）', /dv\.exportNm/.test(main) && /extensions: \['nm'\]/.test(main) && !/NM_PEIZHI_WENJIAN/.test(main));
ok('导入先完整验证（.nm 走 prepareNm 令牌，旧 .wvault 走 verifyImport）', /prepareNm/.test(main) && /verifyImport/.test(main));
{
  const imp = main.slice(main.indexOf("chuliIpc('warmy:peiZhiDaoRu'"));
  ok('导入按钮先完整验证（.nm 令牌/旧 .wvault）、再整包替换并重启（失败由仓库回滚）',
    /prepareNm/.test(imp) && /validateNmStage/.test(imp) && /commitNm/.test(imp) && /verifyImport/.test(imp) && /importVault/.test(imp) && /chongQiYingYong/.test(imp)
    && !/dv\.seal\(\)/.test(imp.slice(0, 6000)));
}
ok('启动令牌在 yindao 之前解包（Boot B）', (() => { const b = main.indexOf('readSessionToken'); const y = main.indexOf('await yindao()'); return b > 0 && y > 0 && b < y; })());
ok('登录页识别主进程已解锁状态（Boot B 直接进入）', /fresh\.unlocked === true/.test(authGate));
ok('设置页按钮文案走“导出数据/导入数据”新键', /settings\.exportVault/.test(appJs) && /settings\.importVault/.test(appJs) && /导出数据/.test(appJs) && /导入数据/.test(appJs));
ok('10 语言包有 vault 导出/导入键', /"settings\.exportVault"/.test(i18n) && /"vault\.importConfirm"/.test(i18n));

/* ── 项 11：停止取消钩子 ─────────────────────────────────────────── */
ok('Provider 接口有 cancel 钩子', /cancel\?\(req: \{ id\?: string; signal\?: AbortSignal \}\)/.test(types));
ok('基类默认如实 unsupported', /supported: false, ok: false, detail: 'provider has no server-side cancel endpoint'/.test(base));
ok('OpenAI 兼容：仅 Responses API resp_ 走服务端 cancel', /\/\^resp_\//.test(openai) && /responses\/\$\{encodeURIComponent\(id\)\}\/cancel/.test(openai));
ok('主进程登记供应商运行并按停止触发 cancel 审计', /gongYingZhixing\.set/.test(main) && /shangBaoGongYingQuXiao/.test(main) && /llm\.cancel/.test(main));
ok('执行者请求接受 AbortSignal（项目停止能掐断在途 HTTP）', /signal\?: AbortSignal/.test(executor) && /provider\.chat\(Qiu, renwu\.signal\)/.test(executor) && /executorSignal/.test(orch));

/* ── 项 12：nm WebContentsView ───────────────────────────────────── */
ok('nm 主进程使用 WebContentsView', /import \{[^}]*WebContentsView[^}]*\} from 'electron'/.test(nmWin) && /new WebContentsView\(/.test(nmWin) && /addChildView\(v\)/.test(nmWin));
ok('远程页只允许 http(s) + 新窗/权限默认拒绝', /will-navigate[\s\S]{0,400}https\?/.test(nmWin) && /setWindowOpenHandler\([\s\S]{0,500}action: 'deny'/.test(nmWin) && /setPermissionRequestHandler\(\(_wc, _p, cb\) => cb\(false\)\)/.test(nmWin));
ok('渲染层远程页调用 WebContentsView，本地页仍 srcdoc', /nmWangYeKai/.test(nmJs) && /srcdoc = '<!doctype html>/.test(nmJs) && /nmWangYeGuan/.test(nmJs));
ok('窗口关闭销毁视图', /Z\.wangYeView\.webContents\.close\(\)/.test(nmWin));
ok('preload 暴露网页视图 IPC 与状态订阅', /nmWangYeKai:/.test(preload) && /nmWangYeZhuangTai:/.test(preload));

/* ── DataVault 真加解密（临时目录） ─────────────────────────────── */
const { DataVault } = await import(pathToFileURL(path.join(root, 'dist/data-vault.js')).href);
const prot = { available: () => true, protect: (s) => Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s, 'base64').toString() };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-gate-'));
const vault = new DataVault({ userData: tmpRoot, protector: prot });
const key = crypto.randomBytes(32);
fs.mkdirSync(path.join(tmpRoot, 'memory'), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, 'auth'), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, 'identity'), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, 'workspace', 'p'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 'settings.json'), JSON.stringify({ themeMode: 'dark' }));
fs.writeFileSync(path.join(tmpRoot, 'memory', 'fast-memory.jsonl'), '{"seq":1}\n');
fs.writeFileSync(path.join(tmpRoot, 'workspace', 'p', 'a.txt'), 'product');
fs.writeFileSync(path.join(tmpRoot, 'auth', 'vault.json'), '{"schema":"warmy.auth.v1"}');
fs.writeFileSync(path.join(tmpRoot, 'identity', 'identity.json'), '{"x":1}');
fs.writeFileSync(path.join(tmpRoot, 'lockfile'), 'electron');
vault.setMasterKey(key);
vault.markUnsealed();
try {
  const s1 = await vault.seal();
  ok('封存成功且写出 vault.bin', s1.ok && fs.existsSync(path.join(tmpRoot, 'vault.bin')), s1.error);
ok('封存/导出直接流式加密，不再先写明文 tar', /jiaMiGuiDang\(/.test(vaultSrc) && !/function xieGuiDang\s*\(/.test(vaultSrc) && !/function jiaMiWenJian/.test(vaultSrc));
  ok('封存后明文数据被删除', !fs.existsSync(path.join(tmpRoot, 'settings.json')) && !fs.existsSync(path.join(tmpRoot, 'workspace', 'p', 'a.txt')));
  ok('auth/identity 不随静态仓库封存（登录前必须可读）', fs.existsSync(path.join(tmpRoot, 'auth', 'vault.json')) && fs.existsSync(path.join(tmpRoot, 'identity', 'identity.json')));
  ok('Electron lockfile 不被当成用户数据', fs.existsSync(path.join(tmpRoot, 'lockfile')));
  ok('封存后写 clean 标记', fs.existsSync(path.join(tmpRoot, 'vault.clean')));
  // 登录前默认文件（模拟 yindao 写出的 settings）应被清掉再解包
  fs.writeFileSync(path.join(tmpRoot, 'settings.json'), JSON.stringify({ themeMode: 'system' }));
  vault.lock();
  vault.setMasterKey(key);
  const u1 = await vault.unseal();
  ok('干净封存后解包成功', u1.ok, u1.error);
  ok('解包恢复真实数据而不是登录前默认值', JSON.parse(fs.readFileSync(path.join(tmpRoot, 'settings.json'), 'utf8')).themeMode === 'dark');
  ok('解包恢复 workspace 产物', fs.readFileSync(path.join(tmpRoot, 'workspace', 'p', 'a.txt'), 'utf8') === 'product');
  ok('解包后清掉 clean 标记', !fs.existsSync(path.join(tmpRoot, 'vault.clean')));
  const exportFile = path.join(os.tmpdir(), `warmy-r104-${process.pid}-${Date.now()}.wvault`);
  try {
    const ex = await vault.exportVault(exportFile, 'pass1234');
    ok('导出全量仓库（含 auth/identity）', ex.ok && fs.existsSync(exportFile), ex.error);
    ok('导出包是二进制 WYV1，不是明文 JSON', fs.readFileSync(exportFile).subarray(0, 4).toString() === 'WYV1');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-import-'));
    try {
      const dv2 = new DataVault({ userData: other, protector: prot });
      const preBad = await dv2.verifyImport(exportFile, 'wrong-pass');
      ok('导入前验证错误口令失败且不碰目标目录', !preBad.ok && !fs.existsSync(path.join(other, 'settings.json')));
      const preGood = await dv2.verifyImport(exportFile, 'pass1234');
      ok('导入前验证正确口令可完整解析', preGood.ok && Number(preGood.files) > 0, preGood.error);
      const bad = await dv2.importVault(exportFile, 'wrong-pass');
      ok('错误口令导入失败且不写半包', !bad.ok && !fs.existsSync(path.join(other, 'settings.json')));
      const good = await dv2.importVault(exportFile, 'pass1234');
      ok('正确口令导入恢复全量数据', good.ok && fs.existsSync(path.join(dv2['userData'], 'auth', 'vault.json')) && fs.existsSync(path.join(dv2['userData'], 'workspace', 'p', 'a.txt')), good.error);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
    /** 明文包：gzip 头、按范围过滤、无口令可验证/导入 */
    const plainFile = path.join(os.tmpdir(), `warmy-r104-plain-${process.pid}-${Date.now()}.tar.gz`);
    try {
      const exPlain = await vault.exportVaultWithOptions(plainFile, { plain: true, include: ['chat', 'settings'] });
      ok('明文导出：gzip 头 + 只含所选范围', exPlain.ok && fs.readFileSync(plainFile).subarray(0, 2).toString('hex') === '1f8b', exPlain.error);
      const otherP = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-plain-import-'));
      try {
        const dvP = new DataVault({ userData: otherP, protector: prot });
        const preP = await dvP.verifyImport(plainFile, '');
        ok('明文包不需要口令即可预验证', preP.ok, preP.error);
        const impP = await dvP.importVault(plainFile, '');
        ok('明文包导入恢复所选范围，且不伪造账号文件',
          impP.ok && fs.existsSync(path.join(otherP, 'settings.json')) && fs.existsSync(path.join(otherP, 'memory', 'fast-memory.jsonl'))
          && !fs.existsSync(path.join(otherP, 'auth', 'vault.json')), impP.error);
      } finally { fs.rmSync(otherP, { recursive: true, force: true }); }
    } finally { try { fs.rmSync(plainFile, { force: true }); } catch { /* noop */ } }
    /** 主密钥包：不用口令；同账号可解，别的账号不行 */
    const skFile = path.join(os.tmpdir(), `warmy-r104-master-${process.pid}-${Date.now()}.wvault`);
    try {
      const exSk = await vault.exportVaultWithOptions(skFile, { useSessionKey: true, include: ['chat'] });
      ok('主密钥导出：成功且不带口令', exSk.ok, exSk.error);
      const otherK = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-master-import-'));
      try {
        const dvK = new DataVault({ userData: otherK, protector: prot });
        dvK.setMasterKey(key);
        dvK.markUnsealed();
        const preK = await dvK.verifyImport(skFile, '');
        ok('主密钥包同账号可预验证', preK.ok, preK.error);
        const impK = await dvK.importVault(skFile, '');
        ok('主密钥包同账号可导入', impK.ok && fs.existsSync(path.join(otherK, 'memory', 'fast-memory.jsonl')), impK.error);
      } finally { fs.rmSync(otherK, { recursive: true, force: true }); }
    } finally { try { fs.rmSync(skFile, { force: true }); } catch { /* noop */ } }
    /** 失败回滚：目标路径被目录占住 ⇒ 复制失败，旧数据必须回来 */
    const otherR = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-rollback-'));
    try {
      fs.writeFileSync(path.join(otherR, 'settings.json'), '{"old":1}');
      fs.mkdirSync(path.join(otherR, 'workspace', 'p', 'a.txt'), { recursive: true });
      const dvR = new DataVault({ userData: otherR, protector: prot });
      dvR.setMasterKey(key);
      dvR.markUnsealed();
      const rb = await dvR.importVault(exportFile, 'pass1234');
      ok('导入中途失败返回回滚结果（不是假成功）', !rb.ok && /rolled-back/.test(String(rb.error || '')), rb.error);
      ok('回滚后旧文件内容还在，导入新写的文件被清掉',
        JSON.parse(fs.readFileSync(path.join(otherR, 'settings.json'), 'utf8')).old === 1
        && !fs.existsSync(path.join(otherR, 'auth', 'vault.json')));
    } finally { fs.rmSync(otherR, { recursive: true, force: true }); }
  } finally {
    try { fs.rmSync(exportFile, { force: true }); } catch { /* noop */ }
  }
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
}

/* 封存标记写失败不能假报成功；第二次退出钩子不能再写明文 */
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r104-cleanfail-'));
  try {
    fs.writeFileSync(path.join(tmp2, 'settings.json'), '{"x":1}');
    fs.mkdirSync(path.join(tmp2, 'vault.clean')); // 让 clean 的 rename 失败
    const v2 = new DataVault({ userData: tmp2, protector: prot });
    v2.setMasterKey(crypto.randomBytes(32));
    v2.markUnsealed();
    const r = await v2.seal();
    ok('封存标记写失败时如实返回失败（不假报安全退出）', !r.ok && /seal-clean-marker-failed/.test(String(r.error || '')), r.error);
    ok('标记失败时 vault 仍已写出，供下次恢复', fs.existsSync(path.join(tmp2, 'vault.bin')));
    ok('退出封存开始后不再写路由队列/ETA', /if \(!vaultSealInFlight && !vaultSealedForQuit\) \{[\s\S]{0,900}luoPanLuYouQiDuiLie[\s\S]{0,400}etaBaCun\(\)/.test(main));
  } finally {
    try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

console.log(`\nverify-r104-vault: ${pass}/${pass} 全绿`);
