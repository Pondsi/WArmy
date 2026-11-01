/**
 * verify-r113-ui.mjs —— 真 Electron（临时 profile）：
 * 思考与执行标签/进行中、过程与中间回复悬停操作、斑马头、计划任务标题单行、副本输入。
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
const port = Number(process.env.R113_PORT || 10315);
const occupied = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
assert.equal(occupied, false, 'CDP port must be unused');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r113-ui-'));
const sid = 'r113-ui';
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true,
  guideChatDone: true, providersSeeded: true, providers: [],
  instances: [{ id: sid, ming: 'R113 验收', name: 'R113 验收', status: 'running', chain: [], chainDisabled: [] }],
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
const hover = async (sel) => {
  const box = await evalOk(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + Math.min(r.height / 2, 12)) }; })()`);
  if (!box) return null;
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(250);
  return evalOk(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).opacity : null; })()`);
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
  await evalOk(`document.querySelector('[data-nav="singleAi"]').click()`);
  await c.waitFor(`!!document.querySelector('#lieBiaoTi .lieBiaoTiaoMu')`);
  await evalOk(`document.querySelector('#lieBiaoTi .lieBiaoTiaoMu').click()`);
  await c.waitFor(`window.__r35?.huiHua() === ${JSON.stringify(sid)}`);
  await c.waitFor(`!!document.querySelector('#shuRu')`);
  const mainSrc = fs.readFileSync(path.join(pkg, 'src/electron-main.ts'), 'utf8');
  check('主进程给思考段/中间回复记录实际模型', mainSrc.includes('zhuSiKaoZhui(sessionId, String(p.reasoning), String(Qiu.model') && mainSrc.includes('zhuLiuShiGuiDang(sessionId, String(Qiu.model') && mainSrc.includes('moXing: modelId'));
  const zh = JSON.parse(fs.readFileSync(path.join(pkg, 'src/i18n/zh-CN.json'), 'utf8'));
  check('运行中标签是“进行中...”，完成后是“思考与执行”', zh['chat.actingNow'] === '进行中...' && zh['chat.actionLog'] === '思考与执行', { actingNow: zh['chat.actingNow'], actionLog: zh['chat.actionLog'] });

  const t = Date.now() + 1000;
  await evalOk(`(() => {
    window.__r35.tian({ role: 'wo', text: 'R113 思考与执行', ts: ${t} });
    window.__r35.tian({
      role: 'them', text: '最终回复（带思考和中间回复）。', ts: ${t + 1000}, moXing: 'TestModel-1',
      reasoningDuan: [{ ts: ${t + 100}, text: '这是思考内容。', moXing: 'ThinkModel-Seg' }],
      zhongJian: [{ ts: ${t + 200}, text: '这是中间回复内容。', moXing: 'MidModel-Seg' }],
    });
    window.__r35.tian({ role: 'them', text: '只有最终回复，没有思考与中间回复。', ts: ${t + 2000}, moXing: 'TestModel-2' });
    window.__r35.guiNa();
    return true;
  })()`);
  await sleep(400);

  const labels = await evalOk(`(() => {
    const rows = [...document.querySelectorAll('.xiaoXi.them')];
    const full = rows.find((n) => String(n.textContent || '').includes('最终回复（带思考和中间回复）'));
    const only = rows.find((n) => String(n.textContent || '').includes('只有最终回复'));
    const seg = full?.querySelector('.guoChengDuan');
    const mid = full?.querySelector('.zhongJianKa');
    return {
      segTitle: String(seg?.querySelector('summary')?.textContent || '').trim(),
      segAria: String(seg?.getAttribute('aria-label') || ''),
      midSummary: String(mid?.querySelector('summary')?.textContent || '').trim(),
      hasOld: /执行过程/.test(String(full?.textContent || '')),
      onlyIcon: !!only?.querySelector('.banMaTou'),
      fullIcon: !!full?.querySelector('.banMaTou'),
      fullWrap: !!full?.querySelector('.zuiZhongHang'),
    };
  })()`);
  check('思考与执行标题已改名（不再显示“执行过程”）', labels.segTitle.includes('思考与执行') && !labels.hasOld, labels);
  check('执行段无障碍名称也用“思考与执行”', labels.segAria.includes('思考与执行第'), labels.segAria);
  check('中间回复仍无“中间回复”标签', labels.midSummary !== '中间回复', labels);
  check('有思考/中间回复时显示斑马头；纯最终回复不显示', labels.fullIcon && labels.fullWrap && !labels.onlyIcon, labels);

  const icon = await evalOk(`(() => {
    const n = [...document.querySelectorAll('.xiaoXi.them')].find((x) => String(x.textContent || '').includes('最终回复（带思考和中间回复）'));
    const z = n?.querySelector('.banMaTou');
    if (!z) return null;
    const cs = getComputedStyle(z);
    return { w: Math.round(z.getBoundingClientRect().width), h: Math.round(z.getBoundingClientRect().height), transform: cs.transform, mask: cs.maskImage || cs.webkitMaskImage || '', outside: !z.closest('.bubble') };
  })()`);
  check('斑马头在白色气泡外、主题色、水平翻转', !!icon && icon.w === 18 && icon.transform.includes('-1') && /zebra-head\.svg/.test(icon.mask) && icon.outside, icon);

  const footers = await evalOk(`(() => {
    const n = [...document.querySelectorAll('.xiaoXi.them')].find((x) => String(x.textContent || '').includes('最终回复（带思考和中间回复）'));
    const seg = n?.querySelector('.guoChengDuan');
    const mid = n?.querySelector('.zhongJianKa');
    if (seg) seg.open = true;
    const info = (el) => {
      const f = el?.querySelector(':scope > .guoChengCaoZuo');
      if (!f) return null;
      return {
        text: String(f.textContent || ''),
        model: String(f.querySelector('.gcMoXing')?.textContent || ''),
        time: String(f.querySelector('.gcShiJian')?.textContent || ''),
        zan: f.querySelectorAll('[data-zan]').length, cai: f.querySelectorAll('[data-cai]').length,
        read: f.querySelectorAll('[data-read]').length, quote: f.querySelectorAll('[data-quote]').length, copy: f.querySelectorAll('[data-copy]').length,
        opacity: getComputedStyle(f).opacity,
      };
    };
    return { seg: info(seg), mid: info(mid) };
  })()`);
  const timeRe = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  for (const [name, f] of [['思考与执行', footers.seg], ['中间回复', footers.mid]]) {
    const wantModel = name === '思考与执行' ? 'ThinkModel-Seg' : 'MidModel-Seg';
    check(`${name}使用该段自己的模型 + 完整时间 + 赞踩/朗读/引用/复制`, !!f && f.model === wantModel && timeRe.test(f.time)
      && f.zan === 1 && f.cai === 1 && f.read === 1 && f.quote === 1 && f.copy === 1, { name, f });
    check(`${name}操作条默认隐藏`, !!f && Number(f.opacity) === 0, { name, f });
  }
  const segOpacity = await hover('.xiaoXi.them .guoChengDuan');
  const midOpacity = await hover('.xiaoXi.them .zhongJianKa');
  check('悬停思考与执行时操作条出现', Number(segOpacity) === 1, segOpacity);
  check('悬停中间回复时操作条出现', Number(midOpacity) === 1, midOpacity);

  const plan = await evalOk(`(() => {
    const card = document.querySelector('#mianBanJiHuaKuai');
    if (card) card.classList.remove('yinCang');
    const k = document.querySelector('#jiHuaKaiGuan');
    const s = k?.querySelector('span');
    if (!k || !s) return null;
    const r = s.getBoundingClientRect();
    return { text: String(s.textContent || '').trim(), lines: s.getClientRects().length, h: Math.round(r.height), ws: getComputedStyle(k).whiteSpace };
  })()`);
  check('计划任务标题在默认宽度下一行显示', !!plan && plan.text === '计划任务' && plan.lines === 1 && plan.ws === 'nowrap', plan);
  await c.snap(path.join(os.tmpdir(), 'warmy-r113-ui.png'));
  console.log('SNAPSHOT ' + path.join(os.tmpdir(), 'warmy-r113-ui.png'));

  await evalOk('window.__showDingShiDaoChuDialog()');
  await c.waitFor('!!document.querySelector("#dscCopies")', { timeout: 3000 });
  const copies = await evalOk(`(() => { const e = document.querySelector('#dscCopies'); return e ? { value: e.value, min: e.min, step: e.step, type: e.type } : null; })()`);
  check('定时导出有副本数输入（默认 1，最小 0，整数）', !!copies && copies.value === '1' && copies.min === '0' && copies.step === '1' && copies.type === 'number', copies);
  await evalOk(`(() => { const e = document.querySelector('#dscCopies'); e.value = '2'; e.dispatchEvent(new Event('input')); return true; })()`);
  await evalOk(`document.querySelector('#duiHuaKuangDongZuoJi button.anNiuZhuYao')?.click()`);
  await sleep(500);
  const savedCfg = await evalOk(`window.warmy.dingShiDaoChuGet()`);
  check('保存定时任务会落盘固定 scheduleId 和 copies', !!savedCfg && savedCfg.ok && /^sch-/.test(String(savedCfg.config?.scheduleId || '')) && savedCfg.config?.copies === 2, savedCfg?.config);

  check('渲染进程无未处理异常', c.errors().length === 0, c.errors());
  console.log(`verify-r113-ui: ${passed} PASS / 0 FAIL`);
} catch (error) {
  console.error('FAIL ' + error.message);
  if (c) await c.snap(path.join(os.tmpdir(), 'warmy-r113-ui-failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  if (c) await c.evaluate(`window.warmy.appQuit('r113-ui-test')`).catch(() => {});
  await sleep(300);
  try { child.kill(); } catch { /* noop */ }
}
