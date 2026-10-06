/**
 * 门禁：**模型调用链里的「置顶 / 上移 / 下移」在边界必须灰掉不可用**
 * （真机反馈：已经在最上面时置顶与上移看起来和能用一样）。
 *
 * 真根因：`disabled` 属性**本来就有**（`i === 0` / `i === length-1`），但两份 CSS 里
 * **没有任何 `.anNiuXiao:disabled` 规则** ⇒ 浏览器默认的禁用感被自定义按钮样式盖掉，
 * 看起来完全一样。所以这个门禁既查"属性有没有挂对"，也查"**禁用态是不是真的一眼看得出**"。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const PORT = Number(process.env.WARMY_CHAIN_CDP_PORT || 9996);
const electron = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainJs = path.join(pkgRoot, 'dist', 'electron-main.js');
const profile = path.join(os.tmpdir(), 'warmy-chain-gate-profile');

let pass = 0;
let fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); }
}

const appJs = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
const css1 = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.css'), 'utf8');
const css2 = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'renderer.css'), 'utf8');

// ── 静态：三个调用链渲染器的边界判定 ──
check('牛马管理局链：置顶/上移在最上面时 disabled', /data-top="' \+ i \+ '"' \+ \(i === 0 \? ' disabled' : ''\)/.test(appJs) && /data-up="' \+ i \+ '"' \+ \(i === 0 \? ' disabled' : ''\)/.test(appJs), 'bureau chain');
check('牛马管理局链：下移在最下面时 disabled', /data-down="' \+ i \+ '"' \+ \(i === LieBiao\.length - 1 \? ' disabled' : ''\)/.test(appJs), 'bureau down');
check('特殊模型链：置顶/上移/下移三处边界判定都在', /data-sml-top[\s\S]{0,80}i === 0 \? ' disabled'/.test(appJs) && /data-sml-up[\s\S]{0,80}i === 0 \? ' disabled'/.test(appJs) && /data-sml-dn[\s\S]{0,90}st\.chain\.length - 1 \? ' disabled'/.test(appJs), 'special chains');
check('右侧模型管理链：↑ 首项、↓ 末项 disabled', /data-mgup[\s\S]{0,60}k === 0 \? ' disabled'/.test(appJs) && /data-mgdn[\s\S]{0,70}k === chain\.length - 1 \? ' disabled'/.test(appJs), 'right panel chain');
check('启用/禁用按钮**永不置灰**（禁用了还得能点回来）', !/data-sml-tg[\s\S]{0,60}disabled/.test(appJs) && !/data-tog[\s\S]{0,60}disabled/.test(appJs), 'toggle never disabled');

// ── 静态：两份 CSS 都补了禁用态，且一致 ──
const wen = /\.anNiuXiao:disabled, \.anNiuXiao\[disabled\][\s\S]{0,260}opacity: \.4;[\s\S]{0,80}cursor: not-allowed;[\s\S]{0,60}filter: grayscale\(1\);/;
check('app.css 有 .anNiuXiao:disabled 规则（变灰 + not-allowed + 去色）', wen.test(css1), 'app.css');
check('renderer.css 同一套规则（两份 CSS 不许漂移）', wen.test(css2), 'renderer.css');
check('禁用态不再有悬停高亮', /\.anNiuXiao:disabled:hover[\s\S]{0,200}background: transparent/.test(css1) && /\.anNiuXiao:disabled:hover[\s\S]{0,200}background: transparent/.test(css2));

// ── 运行时：真浏览器里算一遍"看起来灰不灰" ──
fs.rmSync(profile, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [
  `--remote-debugging-port=${PORT}`,
  '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${profile}`,
  mainJs,
], { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env });

async function waitCdp(secs = 40) {
  for (let i = 0; i < secs; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1200) }); if (r.ok) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

let c = null;
function jieShu() {
  try { if (c) c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}

try {
  if (!(await waitCdp())) { console.error('CDP not up'); jieShu(); process.exit(2); }
  await sleep(4200);
  c = await attach(PORT, { biaoQian: 'chain-gate', callTimeout: 20000 });
  await c.send('Runtime.enable');

  const yang = await c.evaluate(`(function(){
    const box = document.createElement('div');
    box.style.position = 'fixed'; box.style.left = '-9999px';
    box.innerHTML = '<button class="anNiuXiao" id="gateOn">可用</button><button class="anNiuXiao" id="gateOff" disabled>灰</button>';
    document.body.appendChild(box);
    const on = getComputedStyle(document.getElementById('gateOn'));
    const off = getComputedStyle(document.getElementById('gateOff'));
    const r = {
      onOpacity: on.opacity, offOpacity: off.opacity,
      offCursor: off.cursor, offFilter: off.filter,
      offBg: off.backgroundColor,
    };
    box.remove();
    return r;
  })()`);
  console.log('  · 计算样式: ' + JSON.stringify(yang));
  check('可用按钮：不透明（opacity = 1）', yang.onOpacity === '1', yang);
  check('禁用按钮：真的变灰（opacity < 1）', Number(yang.offOpacity) < 1 && Number(yang.offOpacity) > 0, yang);
  check('禁用按钮：光标 not-allowed（点了没反应要点得出来）', yang.offCursor === 'not-allowed', yang);
  check('禁用按钮：去色（grayscale）', /grayscale/.test(String(yang.offFilter)) || yang.offFilter === 'none', yang);
} catch (e) {
  console.error('门禁异常: ' + ((e && e.stack) || e));
  fail += 1;
}

jieShu();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* noop */ }
console.log(`\n==== verify-chain-buttons: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
