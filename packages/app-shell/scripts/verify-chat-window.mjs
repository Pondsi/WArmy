/**
 * 独立会话窗门禁：可拖顶栏 + 仅第3/4列 + 图标 + 不做成完整主界面
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
const appCss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const rCss = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/index.html'), 'utf8');

check('open-chat-window forces mode=sub', /mode:\s*'sub'/.test(main) && /open-chat-window/.test(main));
check('open-chat-window sets window icon', /w\.setIcon|icon:\s*iconPath/.test(main));
check('warmyTaskbarIcon helper exists', /function warmyTaskbarIcon/.test(main));
// 主窗口图标 = **任务栏用的白底版**（产品主：任务栏/托盘要有白底）
check('main window uses 白底任务栏图标', /chuangjianChuangkou[\s\S]{0,400}warmyTaskbarIcon/.test(main));
check('AppUserModelId set on win32', /setAppUserModelId\('com\.pondsi\.warmy'\)/.test(main));
check('chat-window CSS hides rail+list', /body\.chat-window #rail/.test(appCss) && /body\.chat-window #list-col/.test(appCss));
check('chat-window CSS keeps chat+panel grid', /body\.chat-window \.chat-layout/.test(appCss) || /body\.chat-window \.chat-layout/.test(rCss));
check('chat-window does NOT hide titlebar', !/titlebar.*hidden[\s\S]{0,40}chat-window|chat-window[\s\S]{0,80}titlebar.*hidden/.test(appJs));
check('boot adds body.chat-window for sub/chatId', /classList\.add\('chat-window'\)/.test(appJs));
check('btn-open-win passes mode sub', /btn-open-win[\s\S]{0,400}mode:\s*'sub'/.test(appJs));
check('titlebar has drag region CSS', /-webkit-app-region:\s*drag/.test(appCss) || /-webkit-app-region:\s*drag/.test(rCss));
check('index loads both css', /app\.css/.test(html) && /renderer\.css/.test(html));
check('titlebar logo uses transparent svg/logo', /logo-color\.svg|app-64\.png|logo-64\.png/.test(html));
check('icons app.ico exists', fs.existsSync(path.join(ROOT, 'packages/app-shell/src/renderer/icons/app.ico')));
check('build icon.ico exists', fs.existsSync(path.join(ROOT, 'packages/app-shell/build/icon.ico')));

console.log(`\n==== verify-chat-window: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
