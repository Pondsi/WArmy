/**
 * verify-r112-ui.mjs —— 真 Electron（临时 profile）：
 * R112 UI：卡片不再有拖拽手柄、授权“添加”靠左、话筒箭头贴合、中间回复折叠为一行、
 * 语音按光标插入（同锚点替换/换锚点只插增量）、整理特效的亮字会不断切换。
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
const port = Number(process.env.R112_PORT || 10314);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r112-ui-'));
const sid = 'r112-ui';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [{ id: sid, ming: 'R112 验收', name: 'R112 验收', status: 'running', chain: [], chainDisabled: [] }],
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

try {
  const deadline = Date.now() + 30000;
  while (!c && Date.now() < deadline) {
    try { c = await attach(port, { matchUrlIncludes: 'index.html', callTimeout: 15000 }); }
    catch { await sleep(150); }
  }
  assert.ok(c, 'Electron dev app did not start');
  await c.send('Runtime.enable');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`window.warmy.chatLogAppend({sessionId:${JSON.stringify(sid)},role:'user',content:'R112 验收'})`);
  await c.send('Page.reload');
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await evalOk(`document.querySelector('[data-nav="singleAi"]').click()`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')`);
  await evalOk(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu').click()`);
  await c.waitFor(`window.__r35?.huiHua() === ${JSON.stringify(sid)}`);
  await c.waitFor(`!!document.querySelector('#shuRu')`);

  /* 1. 第四列卡片：不再有右上角三点拖拽手柄；标题栏仍可用于拖动 */
  const handles = await evalOk(`({
    n: document.querySelectorAll('.mianBanKuai > .kaTuoBa').length,
    title: !!document.querySelector('#shouQuanKaiGuan'),
    cursor: getComputedStyle(document.querySelector('#shouQuanKaiGuan')).cursor,
  })`);
  check('第四列卡片不再生成三点拖拽手柄', handles.n === 0, handles);
  check('卡片标题栏仍是拖拽面', handles.title && handles.cursor === 'grab', handles);

  /* 2. 授权卡“添加”在“授权”右边、箭头左边（不是贴右侧） */
  const auth = await evalOk(`(() => {
    const title = document.querySelector('#shouQuanKaiGuan > span');
    const add = document.querySelector('#anNiuShouQuanTianJia');
    const arrow = document.querySelector('#shouQuanKaiGuan > .jianTou');
    const r = (x) => x ? x.getBoundingClientRect() : null;
    const t = r(title), a = r(add), w = r(arrow);
    return t && a && w ? { titleRight: Math.round(t.right), addLeft: Math.round(a.left), addRight: Math.round(a.right), arrowLeft: Math.round(w.left) } : null;
  })()`);
  check('授权“添加”靠左，与“授权”留出间距', !!auth && auth.addLeft - auth.titleRight >= 4 && auth.addLeft - auth.titleRight <= 24, auth);
  check('授权“添加”不再贴右侧（箭头仍在最右）', !!auth && auth.addRight < auth.arrowLeft, auth);

  /* 3. 话筒与下拉箭头的图标间距（视觉上贴合） */
  const micGap = await evalOk(`(() => {
    const a = document.querySelector('#anNiuYuYin svg')?.getBoundingClientRect();
    const b = document.querySelector('#anNiuYuYinXiaLa svg')?.getBoundingClientRect();
    return a && b ? { gap: Math.round(b.left - a.right), mic: Math.round(a.width), arrow: Math.round(b.width) } : null;
  })()`);
  check('话筒与箭头贴合（图标间距 ≤2px）', !!micGap && micGap.gap >= -2 && micGap.gap <= 2, micGap);

  /* 4. 中间回复：没有“中间回复”标签；折叠一行截断，展开完整正文 */
  const t = Date.now() + 1000;
  const longText = '**进度一**：' + '这是一段很长的过程说明内容，用来验证折叠时只显示一行并且末尾出现省略号。'.repeat(8) + ' 结尾。';
  await evalOk(`(() => {
    window.__r35.tian({ role: 'wo', text: 'R112 中间回复', ts: ${t} });
    window.__r35.tian({ role: 'them', text: '最终回复。', ts: ${t + 1000}, zhongJian: [{ ts: ${t + 200}, text: ${JSON.stringify(longText)} }] });
    window.__r35.guiNa();
    return true;
  })()`);
  await sleep(300);
  const mid = await evalOk(`(() => {
    const ka = document.querySelector('.xiaoXi.them .zhongJianKa');
    if (!ka) return null;
    const sum = ka.querySelector('summary');
    const body = ka.querySelector('.zhongJianHuiFu');
    const s = sum?.querySelector('.zhongJianZhaiYao');
    return {
      open: ka.open,
      summaryText: String(sum?.textContent || ''),
      bodyText: String(body?.textContent || ''),
      bodyVisible: !!body && getComputedStyle(body).display !== 'none',
    };
  })()`);
  check('中间回复不再显示“中间回复”四个字', !!mid && mid.summaryText.trim() !== '中间回复', mid);
  await evalOk(`document.querySelector('.xiaoXi.them .zhongJianKa > summary').click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them .zhongJianKa').open === false`, { timeout: 3000 });
  const midClosed = await evalOk(`(() => {
    const ka = document.querySelector('.xiaoXi.them .zhongJianKa');
    const body = ka.querySelector('.zhongJianHuiFu');
    const s = ka.querySelector('summary .zhongJianZhaiYao');
    const vis = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : el.getBoundingClientRect().height > 0);
    const cs = s ? getComputedStyle(s) : null;
    return {
      open: ka.open,
      bodyVisible: vis(body),
      oneLine: !!s && s.getBoundingClientRect().height > 0
        && cs.whiteSpace === 'nowrap' && cs.overflow === 'hidden'
        && cs.textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth,
      metrics: s ? { h: Math.round(s.getBoundingClientRect().height), sw: s.scrollWidth, cw: s.clientWidth, ws: cs.whiteSpace, ov: cs.overflow, to: cs.textOverflow } : null,
    };
  })()`);
  check('中间回复折叠态是一行省略号摘要', midClosed.oneLine, midClosed);
  check('折叠后只留一行摘要、正文收起', midClosed.open === false && midClosed.bodyVisible === false, midClosed);
  await evalOk(`document.querySelector('.xiaoXi.them .zhongJianKa > summary').click()`);
  await c.waitFor(`document.querySelector('.xiaoXi.them .zhongJianKa').open === true`, { timeout: 3000 });
  const midOpen = await evalOk(`(() => {
    const ka = document.querySelector('.xiaoXi.them .zhongJianKa');
    const body = ka.querySelector('.zhongJianHuiFu');
    return { open: ka.open, body: String(body?.textContent || ''), bodyVisible: !!body && getComputedStyle(body).display !== 'none', labelHidden: !ka.querySelector('summary .zhongJianZhaiYao') || getComputedStyle(ka.querySelector('summary .zhongJianZhaiYao')).display === 'none' };
  })()`);
  check('展开后直接显示完整正文，摘要行隐藏', midOpen.open && midOpen.bodyVisible && midOpen.body.includes('这是一段很长的过程说明内容') && midOpen.labelHidden, midOpen);

  /* 5. 语音按光标插入：同锚点替换，换锚点只插增量，用户已有文字不丢 */
  const insert = await evalOk(`(() => {
    const ru = document.querySelector('#shuRu');
    ru.value = '甲乙丙丁';
    ru.focus();
    ru.setSelectionRange(2, 2);
    const zt = { chaRuStart: 2, chaRuEnd: 2, yiChaRu: '', yiDing: '', lastAsr: '' };
    /** 提前亮起的整理特效会把输入框设为 readOnly；程序化插入仍必须成功。 */
    ru.readOnly = true;
    const r1 = window.__yuYinChaRuJieGuo(ru, zt, '语音');
    ru.readOnly = false;
    const v1 = ru.value;
    const a1 = { start: zt.chaRuStart, end: zt.chaRuEnd, text: zt.yiChaRu };
    const r2 = window.__yuYinChaRuJieGuo(ru, zt, '语音识别');
    const v2 = ru.value;
    ru.focus();
    ru.setSelectionRange(0, 0);
    const r3 = window.__yuYinChaRuJieGuo(ru, zt, '语音识别新');
    const v3 = ru.value;
    ru.focus();
    ru.setSelectionRange(ru.value.length, ru.value.length);
    const r4 = window.__yuYinChaRuJieGuo(ru, zt, '语音识别新增');
    const v4 = ru.value;
    return { v1, v2, v3, v4, a1, r1, r2, r3, r4 };
  })()`);
  check('语音从点话筒时的光标处插入（不是总在末尾）', insert.v1 === '甲乙语音丙丁', insert);
  check('同一锚点更新只替换自己插入的片段', insert.v2 === '甲乙语音识别丙丁', insert);
  check('点击到前面插入时，原有语音片段和用户文字都保留', insert.v3 === '新甲乙语音识别丙丁', insert);
  check('点击到末尾插入时，只追加新增后缀', insert.v4 === '新甲乙语音识别丙丁增', insert);

  /* 6. 整理特效：亮字会不断切换（新亮起 + 旧恢复），且至少有一部分亮字 */
  const dyn = await evalOk(`(() => {
    const ru = document.querySelector('#shuRu');
    ru.value = '整理特效随机亮字切换验收，文字要不断有新亮起也不断恢复。';
    ru.dispatchEvent(new Event('input'));
    window.__zhengLiTeXiao.kai(ru.value);
    const lit = () => [...document.querySelectorAll('.zhengLiZi')].map((x, i) => x.classList.contains('isLiang') ? i : -1).filter((i) => i >= 0);
    return { first: lit(), count: document.querySelectorAll('.zhengLiZi').length };
  })()`);
  await sleep(900);
  const dyn2 = await evalOk(`(() => {
    const lit = () => [...document.querySelectorAll('.zhengLiZi')].map((x, i) => x.classList.contains('isLiang') ? i : -1).filter((i) => i >= 0);
    const z = document.querySelector('.zhengLiZi.isLiang');
    return { now: lit(), shadow: z ? getComputedStyle(z).textShadow : '' };
  })()`);
  const first = new Set(dyn.first);
  const now = new Set(dyn2.now);
  const fresh = [...now].some((i) => !first.has(i));
  const faded = [...first].some((i) => !now.has(i));
  check('整理中同时存在亮字', dyn.count > 10 && dyn.first.length > 0 && dyn2.now.length > 0, { count: dyn.count, first: dyn.first, now: dyn2.now });
  check('亮字会不断切换（有新亮起、也有恢复）', fresh && faded, { first: dyn.first, now: dyn2.now });
  check('亮字有可见发光', /rgb|color/.test(String(dyn2.shadow)) && dyn2.shadow !== 'none', dyn2.shadow);
  await evalOk('window.__zhengLiTeXiao.quXiao()');

  /* 7. 点话筒结束即提前亮特效的接线（静态，避免真麦克风依赖） */
  const src = fs.readFileSync(path.join(pkg, 'src/renderer/app.js'), 'utf8');
  check('点话筒结束会先启动整理特效（再等最终转写）', /function yuYinJieShu[\s\S]*?yuYinZhengLiTiQianKai\(zt\)/.test(src));
  check('提前特效只在勾选重组 + 整理模型可用时启动', /function yuYinZhengLiTiQianKai[\s\S]*?yuYinYaoChongZu\(\)/.test(src));

  check('渲染进程无未处理异常', c.errors().length === 0, c.errors());
  console.log(`verify-r112-ui: ${passed} PASS / 0 FAIL`);
} catch (error) {
  console.error('FAIL ' + error.message);
  if (c) await c.snap(path.join(os.tmpdir(), 'warmy-r112-ui-failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  if (c) await c.evaluate(`window.warmy.appQuit('r112-ui-test')`).catch(() => {});
  await sleep(300);
  try { child.kill(); } catch { /* noop */ }
}
