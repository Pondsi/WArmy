/**
 * verify-r110-voice-ui.mjs —— 真 Electron（临时 profile，auth bypass）：
 * 验证整理中的输入框特效确实挂到真实 DOM、字号/位置与输入框重合、取消后完全恢复。
 * 只读/临时，不写真实 profile。
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
const port = Number(process.env.R110_PORT || 10310);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r110-voice-'));
const sid = 'r110-voice';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [{ id: sid, ming: '整理特效验收', name: '整理特效验收', status: 'running', chain: [], chainDisabled: [] }],
}));
const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(pkg, 'node_modules/electron/dist/electron.exe'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, path.join(pkg, 'dist/electron-main.js'),
], { cwd: pkg, env, stdio: 'ignore' });
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
const png = path.join(os.tmpdir(), 'warmy-r110-voice-effect.png');
try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) {
    try { c = await attach(port, { matchUrlIncludes: 'index.html', callTimeout: 15000 }); }
    catch { await sleep(150); }
  }
  assert.ok(c, 'Electron dev app did not start');
  await c.send('Runtime.enable');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`window.warmy.chatLogAppend({sessionId:${JSON.stringify(sid)},role:'user',content:'整理特效验收'})`);
  await c.send('Page.reload');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`document.querySelector('[data-nav="singleAi"]').click()`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')`);
  await evalOk(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu').click()`);
  await c.waitFor(`window.__r35?.huiHua() === ${JSON.stringify(sid)}`);
  await c.waitFor(`!!document.querySelector('#shuRu')`);

  const effect = await evalOk(`(() => {
    const ru = document.querySelector('#shuRu');
    ru.value = '这是一段正在整理的文字，魔法会非常缓慢地汇聚到每个字上。';
    ru.dispatchEvent(new Event('input'));
    window.__zhengLiTeXiao.zhuangTai(true);
    window.__zhengLiTeXiao.kai(ru.value);
    const layer = document.querySelector('.zhengLiTeXiao');
    const wen = layer?.querySelector('.zhengLiTeXiaoWen');
    const hua = layer?.querySelector('canvas');
    const rr = ru.getBoundingClientRect();
    const lr = layer?.getBoundingClientRect();
    return {
      layer: !!layer, spans: wen?.querySelectorAll('.zhengLiZi').length || 0,
      liang: wen?.querySelectorAll('.zhengLiZi.isLiang').length || 0,
      canvas: !!hua && hua.width > 0 && hua.height > 0,
      text: wen?.textContent || '',
      inputColor: getComputedStyle(ru).color,
      readOnly: ru.readOnly === true,
      hint: layer?.querySelector('.zhengLiTiShi')?.textContent || '',
      micClass: document.querySelector('#anNiuYuYin')?.classList.contains('zhengLiZhong') || false,
      ariaBusy: ru.closest('.shuRuQuZhu')?.getAttribute('aria-busy') || '',
      layerW: Math.round(lr?.width || 0), layerH: Math.round(lr?.height || 0),
      inputW: Math.round(rr.width || 0), inputH: Math.round(rr.height || 0),
      spans100: window.__zhengLiTeXiao.keYong(2, 2, false) && !window.__zhengLiTeXiao.keYong(2, 2, true) && !window.__zhengLiTeXiao.keYong(1, 2, false),
    };
  })()`);
  check('特效层、逐字节点、粒子 canvas 都真实挂上', effect.layer && effect.spans > 10 && effect.canvas, effect);
  check('随机亮字确实存在（初始点亮一批）', effect.liang >= 2, effect.liang);
  check('特效层尺寸与输入框重合（不是盖住整块工具条）', Math.abs(effect.layerW - effect.inputW) <= 2 && Math.abs(effect.layerH - effect.inputH) <= 2, effect);
  check('特效文字与输入框内容一致', effect.text === '这是一段正在整理的文字，魔法会非常缓慢地汇聚到每个字上。');
  check('输入框真实文字透明、话筒进入整理态、aria-busy 设置', /rgba\(0, 0, 0, 0\)|transparent/.test(effect.inputColor) && effect.micClass && effect.ariaBusy === 'true', effect);
  check('整理期间输入框真只读，并显示“整理中”提示', effect.readOnly === true && /整理中/.test(effect.hint), effect);
  check('结果世代真值表在真实渲染层成立', effect.spans100 === true);
  /** 真实敲字：聚焦后通过 CDP 输入，readOnly 必须让内容保持不变 */
  const beforeType = await evalOk(`document.querySelector('#shuRu').value`);
  await evalOk(`document.querySelector('#shuRu').focus(); true`);
  await c.send('Input.insertText', { text: '用户乱改' }).catch(() => {});
  const afterType = await evalOk(`document.querySelector('#shuRu').value`);
  check('整理期间真实输入不会改内容（用户更改无效）', afterType === beforeType, { beforeType, afterType });
  await sleep(700);
  await c.snap(png);
  console.log('SNAPSHOT ' + png);

  const after = await evalOk(`(() => {
    window.__zhengLiTeXiao.quXiao();
    const ru = document.querySelector('#shuRu');
    return {
      layer: !!document.querySelector('.zhengLiTeXiao'),
      color: getComputedStyle(ru).color,
      micClass: document.querySelector('#anNiuYuYin')?.classList.contains('zhengLiZhong') || false,
      ariaBusy: ru.closest('.shuRuQuZhu')?.getAttribute('aria-busy') || '',
      readOnly: ru.readOnly === true,
      value: ru.value,
    };
  })()`);
  check('取消/结束后特效层移除、文字颜色恢复、话筒状态复原、输入恢复可编辑', !after.layer && !after.micClass && !after.ariaBusy && after.color !== effect.inputColor && after.value.length > 0 && after.readOnly === false, after);

  /**
   * 完成提示音：走真实渲染层的 `yunXingZhuangTaiGuan`。
   * 把 `yinXiaoQu` 换成计数器（声音资源取不到也照样会走“播一次”的决策），
   * 验证：整轮结束响一次；同一 run 再收尾不会响第二次。
   */
  const sound = await evalOk(`(async () => {
    const before = (window.__yinXiaoZhenDuan || []).length;
    window.__r35.niuMaYuLan();
    await new Promise((r) => setTimeout(r, 80));
    window.__r35.niuMaGuan();
    await new Promise((r) => setTimeout(r, 500));
    const once = (window.__yinXiaoZhenDuan || []).slice(before);
    window.__r35.niuMaGuan();
    await new Promise((r) => setTimeout(r, 500));
    const twice = (window.__yinXiaoZhenDuan || []).slice(before);
    return { once, twice, runs: Object.keys(window.__state?.sessionRuns || {}) };
  })()`);
  const roundEnd = (arr) => arr.filter((x) => x && x.kind === 'complete' && x.laiYuan === 'round-end');
  check('整轮真正结束会请求完成提示音，且同一轮不会响第二次',
    roundEnd(sound.twice).length === 1, sound);
  console.log(`\nverify-r110-voice-ui: ${passed} PASS / 0 FAIL`);
} finally {
  try { child.kill(); } catch { /* noop */ }
  await sleep(500);
  if (process.env.R110_KEEP === '1') console.log('FIXTURE ' + profile);
  else fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
