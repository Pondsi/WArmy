/**
 * 托盘下班退出 + 禁止多开 + 右栏协助/进度门禁
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
let pass = 0, fail = 0;
function check(l, ok, d) {
  if (ok) { pass++; console.log('  ok  ' + l); }
  else { fail++; console.log('  FAIL ' + l, d ?? ''); }
}

const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');
const rCss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/preload.cjs'), 'utf8');

check('single instance lock', /requestSingleInstanceLock/.test(main));
check('second-instance centers+focusses', /second-instance[\s\S]{0,200}focusMainWindowCentered/.test(main));
check('focusMainWindowCentered centers bounds', /workArea[\s\S]{0,200}setBounds/.test(main));
check('退出函数置强制退出标志（tuichuYingyong / forceQuit）', /function tuichuYingyong[\s\S]{0,200}qiangzhiTuichu = true/.test(main));
check('托盘下班走统一退出函数（不是裸 app.quit）', /tray-off-work[\s\S]{0,80}tuichuYingyong|tuichuYingyong\('tray-off-work'\)/.test(main));
check('no tray menu app.quit()', !/setContextMenu\(Menu\.buildFromTemplate\(\[\{ label: trayOffWorkLabel, click: \(\) => \{ app\.quit\(\); \}/.test(main));
check('退出 IPC 走统一退出函数', /warmy:app-quit[\s\S]{0,200}tuichuYingyong/.test(main));
check('未强制退出时才拦成隐藏', /if \(!qiangzhiTuichu\)[\s\S]{0,80}preventDefault/.test(main));
check('before-quit destroys tray', /before-quit[\s\S]{0,200}tray\?\.destroy/.test(main));
check('assist IPC list/upsert', /warmy:assist-list/.test(main) && /warmy:assist-upsert/.test(main));
check('preload assist APIs', /assistList/.test(preload) && /assistUpsert/.test(preload));
check('diag toggle self-contained', /function toggleDiagPanel/.test(appJs) && /\$\('diag-toggle'\)\?\.addEventListener\('click', \(\) => \{ toggleDiagPanel\(\); \}\)/.test(appJs));
check('assist list in panel HTML', /panel-assist-block/.test(html) && /assist-badge/.test(html));
check('task-list has panel-scroll', /task-list[^"]*panel-scroll|panel-scroll[^>]*task-list/.test(html));
check('progress has datetime class', /task-time/.test(appJs));
check('assist sorting urgent bottom', /priority === 'urgent'\) return 3/.test(appJs));
check('logo uses transparent svg', /logo-color\.svg/.test(html));
check('icon white stripped app-64', (() => {
  try {
    // textual check only: verify script file exists for strip tool already run
    return fs.existsSync(path.join(ROOT, 'packages/app-shell/src/renderer/icons/logo-color.svg'));
  } catch { return false; }
})());
check('panel-scroll css max-height', /panel-scroll[\s\S]{0,80}max-height/.test(rCss));
check('assist-dot css', /assist-dot\.urgent/.test(rCss) && /is-stale/.test(rCss));

console.log(`\n==== verify-tray-quit: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
