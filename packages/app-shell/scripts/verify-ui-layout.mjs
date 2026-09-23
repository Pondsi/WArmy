/**
 * 真实 UI 核验：启动 Electron（带 CDP）→ 断言 ceLan/list 列可见、诊断在右栏、菜单项存在。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attach, sleep} from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const PORT = Number(process.env.WARMY_UI_CDP_PORT || 9888);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');

let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  const child = spawn(electron, [
    `--remote-debugging-port=${PORT}`,
    '--disable-features=CalculateNativeWinOcclusion',
    `--user-data-dir=${path.join(os.tmpdir(), 'warmy-ui-check-profile')}`,
    mainJs,
  ], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  if (!(await waitCdp())) {
    console.error('CDP not up');
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    process.exit(2);
  }
  await sleep(3500);
  const c = await attach(PORT, { biaoQian: 'ui-check', callTimeout: 15000 });
  await c.send('Runtime.enable');
  await sleep(1500);

  const dom = await c.evaluate(`(function(){
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { exists:false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { exists:true, display:cs.display, visibility:cs.visibility, w:Math.round(r.width), h:Math.round(r.height) };
    };
    return {
      appBodyHideList: !!document.getElementById('yingYongTi')?.classList.contains('yinCangLieBiao'),
      ceLan: vis('#ceLan'),
      listCol: vis('#lieBiaoLan'),
      mainCol: vis('#zhuLan'),
      panelCol: vis('#mianBanLan'),
      tree: vis('#lieBiaoLan .lieBiaoTi'),
      watermark: vis('#lieBiaoWatermark'),
      diagBtn: vis('#anNiuKongZhiTai'),
      consolePaneInPanel: !!document.querySelector('#mianBanLan #kongZhiTaiMianBan'),
      scrollBtn: vis('#scrollDiAnNiu'),
      bubble: vis('#newXiaoXiBubble'),
      menuAuto: !!document.getElementById('caiDanTuBiaoAutoscroll'),
      menuDirected: !!document.getElementById('caiDanTuBiaoDingXiang'),
      inputMax: (document.getElementById('shuRu')||{}).getAttribute ? document.getElementById('shuRu').getAttribute('maxlength') : null,
      watermarkAfter: (function(){
        try {
          const lc = document.getElementById('lieBiaoLan');
          if (!lc) return 'no-el';
          const cs = getComputedStyle(lc, '::after');
          return { bg: cs.backgroundImage, opacity: cs.opacity, h: cs.height };
        } catch (e) { return 'err:' + e.message; }
      })(),
      ctxBtn: !!document.getElementById('anNiuShangXiaWen'),
      summaryBtn: !!document.getElementById('anNiuGenZhaiYao'),
      autoSummary: !!document.getElementById('ziDongZhaiYaoKaiGuan'),
      ctxSlider: !!document.getElementById('shangXiaWenSlider'),
      menuStopGone: !document.getElementById('caiDanTuBiaoTingZhi'),
      menuMarks: document.querySelectorAll('#gengDuoCaiDan .mark').length,
    };
  })()`);
  console.log(JSON.stringify(dom, null, 2));

  check('ceLan 可见（宽>0）', dom.ceLan.exists && dom.ceLan.display !== 'none' && dom.ceLan.w > 0, dom.ceLan);
  check('lieBiaoLan 可见（宽>0）', dom.listCol.exists && dom.listCol.display !== 'none' && dom.listCol.w > 100, dom.listCol);
  check('zhuLan 存在', dom.mainCol.exists, dom.mainCol);
  check('诊断事件流在右栏 (#mianBanLan #kongZhiTaiMianBan)', dom.consolePaneInPanel === true);
  check('下箭头按钮存在', dom.scrollBtn.exists === true, dom.scrollBtn);
  check('新消息气泡存在', dom.bubble.exists === true, dom.bubble);
  check('菜单含自动滚动项', dom.menuAuto === true);
  check('菜单含仅@ai才发言项', dom.menuDirected === true);
  check('输入 maxlength=8000', dom.inputMax === '8000', dom.inputMax);
  check('第二列水印为 logo-color.svg', !!(dom.watermarkAfter && typeof dom.watermarkAfter === 'object' && String(dom.watermarkAfter.bg || '').includes('logo-color')), dom.watermarkAfter);
  check('上下文预算按钮存在', dom.ctxBtn === true);
  check('上下文滑块存在', dom.ctxSlider === true);
  check('摘要按钮存在', dom.summaryBtn === true);
  check('自动摘要开关存在', dom.autoSummary === true);
  check('菜单“停止”已移除', dom.menuStopGone === true);
  check('菜单勾选位数量≥4（文字对齐）', dom.menuMarks >= 4, dom.menuMarks);

  try { c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  console.log(`\n==== verify-ui-layout: ${pass} ok / ${fail} FAIL ====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
