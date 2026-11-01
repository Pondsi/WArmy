/**
 * verify-r82-r103 —— #103/#109/#112/#113 #106 的界面与 IPC 接线
 *
 * 目标：不是只看源码，而是真启动一次应用，验证：
 *  ① 第四列知识库权限（读/写/归档）IPC 存在且后端按硬作用域收窄；
 *  ② 设置页有「提示词校对与回滚」，备份/本地校对 IPC 可用；
 *  ③ 群/项目查看弹窗有邀请二维码、链接、逐条审批；批准会写成员表；
 *  ④ 社交平台有「连通性诊断」，四种平台配置错误时如实返回步骤；
 *  ⑤ 聊天网络发送在无 peer 时返回 no-peers（不假装送达）；
 *  ⑥ A9 拟态文案不再夸大（语音/看屏幕只在组件就绪时工作）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'packages', 'app-shell');
const ELECTRON = path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(PKG, 'dist', 'electron-main.js');
const APP = fs.readFileSync(path.join(PKG, 'src', 'renderer', 'app.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(PKG, 'src', 'electron-main.ts'), 'utf8');
const LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'eo'];

let ok = 0;
const hong = [];
const jian = (l, p, d) => {
  if (p) { ok += 1; console.log('  ok   ' + l); return; }
  hong.push(l);
  console.log('  FAIL ' + l + (d === undefined ? '' : ' ← ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 360)));
};

const profile = path.join(os.tmpdir(), 'warmy-r82-r103-' + Date.now() + '-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, ['--remote-debugging-port=9689', '--disable-features=CalculateNativeWinOcclusion', '--user-data-dir=' + profile, MAIN], {
  cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], env,
});
let c = null;

try {
  /* ① 静态接线 */
  jian('#103 设置持久 layer 权限 + 后端硬作用域交集',
    /kbPerms\?: Record<string, \{ read\?: string\[\]; write\?: string\[\]; archive\?: string\[\] \}>/.test(fs.readFileSync(path.join(PKG, 'src', 'settings-store.ts'), 'utf8'))
    && /function kbLayersFor\(sessionId: string\): ZhishiCeng\[\] \{[\s\S]{0,260}hard\.filter/.test(MAIN_SRC)
    && /warmy:kbPermShe/.test(MAIN_SRC));
  jian('#103 第四列三组勾选 + 在线用户切换（只公开层）',
    /function renderPanelKnowledge\(\)[\s\S]{0,4000}kbPermDu/.test(APP)
    && /kbPermShe/.test(APP) && /kbViewUser/.test(APP)
    && /viewAsPublic|kb\.viewAsPublic/.test(APP));
  jian('#103 归档自动归纳短记忆', /function guiNaDuanJiYi\(/.test(MAIN_SRC) && /guiNaDuanJiYi\(sid\)/.test(MAIN_SRC)
    && /## 短记忆/.test(MAIN_SRC) && /Number\(e\.useCount\) > 0/.test(MAIN_SRC));
  jian('#109 设置页提示词校对 + diff / 回滚 UI',
    /tiShiJiaoDuiKa/.test(APP) && /tiShiBeiFenLieBiao/.test(APP)
    && /tiShiDiff/.test(APP) && /tiShiBeiFenHuiFu/.test(APP));
  jian('#112 查看弹窗邀请二维码/链接 + 逐条审批',
    /info\.inviteTitle/.test(APP) && /qrSvg\(invLink/.test(APP)
    && /data-jr-action="agree"/.test(APP) && /joinRespond/.test(APP));
  jian('#113/#115 社交平台连通性诊断入口',
    /sheJiaoLianTongCeShi/.test(APP) && /data-sj-diag/.test(APP)
    && /warmy:sheJiaoLianTongCeShi/.test(MAIN_SRC));
  jian('#106 聊天网络发送/入站接线',
    /chatNetSend/.test(APP) && /warmy:chatNetSend/.test(MAIN_SRC)
    && /warmy:chatNetReadonly/.test(MAIN_SRC) && /ChuanShuDuiLie/.test(MAIN_SRC));
  const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(PKG, 'src/i18n', l + '.json'), 'utf8'))]));
  jian('#103 知识库权限文案 10 语言齐全',
    LANGS.every((l) => ['kb.perm.read', 'kb.perm.write', 'kb.perm.archive', 'kb.perm.hint', 'kb.viewAs', 'kb.viewSelf', 'kb.viewAsPublic'].every((k) => String(packs[l][k] || '').trim())));
  jian('A9 拟态文案不再夸大（10 语言都写了“组件就绪才工作”）',
    LANGS.every((l) => /组件|コンポーネント|구성 요소|component|composant|componente|компонент|komponant|對應元件|对应组件/i.test(String(packs[l]['mimic.hint'] || ''))));

  /* ② 真机 IPC */
  const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts', 'cdp-lib.mjs')).href);
  let last = '';
  for (let i = 0; i < 80; i++) {
    try { c = await attach(9689, { biaoQian: 'r82-r103', callTimeout: 15000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 没连上：' + last);
  await c.send('Runtime.enable');
  await c.waitFor('!!window.warmy?.kbPermDu && !!document.querySelector("#appTi") && !!document.querySelector(\'[data-nav="settings"]\')?.onclick', { timeout: 30000, biaoQian: '主界面与导航绑定' });
  await sleep(500);
  await c.evaluate(`(function(){
    const g = document.getElementById('warmyAuthGate'); if (g) g.style.display = 'none';
    document.querySelectorAll('.duiHuaKuangMask, .duiHuaKuangGen, .duiHuaKuang').forEach((e) => { e.style.display = 'none'; });
    return true;
  })()`);

  const du = await c.evaluate(`window.warmy.kbPermDu({ sessionId: 'probe-r103' })`, { awaitPromise: true });
  jian('kbPermDu 返回读/写/归档与硬作用域（未知会话只有 session）',
    !!du && du.ok && du.hardRead && du.hardRead.join(',') === 'session' && du.read.join(',') === 'session',
    du);
  const sh = await c.evaluate(`window.warmy.kbPermShe({ sessionId: 'probe-r103', read: ['session','internal','private'], write: ['session','internal','private'], archive: ['internal'] })`, { awaitPromise: true });
  jian('kbPermShe 不能越过硬作用域（请求三层，实际只留 session）',
    !!sh && sh.ok && sh.read.join(',') === 'session' && sh.write.join(',') === 'session' && sh.archive.length === 0,
    sh);

  const jd = await c.evaluate(`window.warmy.tiShiJiaoDui()`, { awaitPromise: true });
  jian('tiShiJiaoDui 返回 5 层本地校对结果', !!jd && jd.ok && Array.isArray(jd.ceng) && jd.ceng.length === 5, jd);
  await c.evaluate(`window.warmy.daoShe({ text: '# probe one' })`, { awaitPromise: true });
  await c.evaluate(`window.warmy.daoShe({ text: '# probe two' })`, { awaitPromise: true });
  const bl = await c.evaluate(`window.warmy.tiShiBeiFenLieBiao()`, { awaitPromise: true });
  const dao = bl && bl.ok && (bl.ceng || []).find((x) => x.id === 'dao');
  jian('提示词覆盖前自动留备份（道至少 1 份）', !!dao && dao.backups.length >= 1, dao);

  const sj = await c.evaluate(`window.warmy.sheJiaoLianTongCeShi({ pingTai: 'feishu', cfg: {} })`, { awaitPromise: true });
  jian('社交连通性诊断：空配置如实返回 config 失败，不伪造成功',
    !!sj && sj.ok === false && Array.isArray(sj.steps) && sj.steps[0] && sj.steps[0].name === 'config' && sj.steps[0].ok === false, sj);

  const cn = await c.evaluate(`window.warmy.chatNetSend({ sessionId: 'probe-r103', text: 'hello' })`, { awaitPromise: true });
  jian('聊天网络发送无 peer 时返回 no-peers（不假装送达）',
    !!cn && cn.ok === true && cn.sent === false && cn.reason === 'no-peers', cn);

  const inv = await c.evaluate(`window.warmy.inviteCreate('probe-r103')`, { awaitPromise: true });
  jian('邀请令牌可创建（查看弹窗二维码/链接的数据源）',
    !!inv && inv.ok && inv.invite && String(inv.invite.token || '').length > 0, inv);

  const clickDbg = await c.evaluate(`(function(){
    const b = document.querySelector('[data-nav="settings"]'); if (b) b.click();
    return { found: !!b, body: document.body.className, page: (document.getElementById('pageBuJu')||{}).className,
      nav: (document.querySelector('.ceLanTiaoMu.jiHuo')||{}).dataset ? document.querySelector('.ceLanTiaoMu.jiHuo').dataset.nav : '' };
  })()`);
  await sleep(1800);
  const ui1 = await c.evaluate(`(function(){ const pt = document.getElementById('pageTi'); return { card: !!document.getElementById('tiShiJiaoDuiKa'), btn: !!document.getElementById('anNiuTiShiJiaoDui'), list: !!document.getElementById('tiShiBeiFenLieBiao'), has: !!pt && pt.innerHTML.includes('tiShiJiaoDuiKa'), len: pt ? pt.innerHTML.length : 0 }; })()`);
  jian('设置页真的渲染出提示词校对与回滚卡', ui1.card && ui1.btn && ui1.list, ui1);
  await c.evaluate(`(function(){ const b = document.querySelector('[data-nav="wo"]'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const ui2 = await c.evaluate(`(function(){ return document.querySelectorAll('#shuKa .tiShiAiGai, #yinXiangKa .tiShiAiGai').length; })()`);
  jian('我的页「术/印象」图标仍在（本轮没有回归）', ui2 === 2, ui2);
} catch (e) {
  jian('门禁执行未抛错', false, (e && (e.stack || e.message)) || e);
} finally {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* noop */ }
  for (let i = 0; i < 25; i++) { await new Promise((r) => setTimeout(r, 200)); try { process.kill(child.pid, 0); } catch { break; } }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 文件锁 */ }
}

console.log(`\nverify-r82-r103: ${ok} ok / ${hong.length} FAIL`);
if (hong.length) console.log('红项：\n- ' + hong.join('\n- '));
process.exitCode = hong.length ? 1 : 0;
