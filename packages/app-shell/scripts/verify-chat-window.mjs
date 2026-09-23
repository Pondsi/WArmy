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

check('open-chat-window forces mode=fu', /mode:\s*'fu'/.test(main) && /daKaiLiaoTianChuangKou|open-chat-window/.test(main));
check('open-chat-window sets window icon', /w\.setIcon|icon:\s*tuBiaoLuJing/.test(main));
check('warmyTaskbarIcon helper exists', /function warmyTaskbarIcon/.test(main));
// 主窗口图标 = **任务栏用的白底版**（产品主：任务栏/托盘要有白底）
check('main window uses 白底任务栏图标', /chuangjianChuangkou[\s\S]{0,400}warmyTaskbarIcon/.test(main));
check('AppUserModelId set qiYong win32', /setAppUserModelId\('com\.pondsi\.warmy'\)/.test(main));
check('liaoTianChuangKou CSS hides ceLan+list', /body\.liaoTianChuangKou #ceLan/.test(appCss) && /body\.liaoTianChuangKou #lieBiaoLan/.test(appCss));
check('liaoTianChuangKou CSS keeps chat+panel grid', /body\.liaoTianChuangKou \.liaoTianBuJu/.test(appCss) || /body\.liaoTianChuangKou \.liaoTianBuJu/.test(rCss) || /#liaoTianBuJu\.withKongZhiTai/.test(appCss) || /\.liaoTianBuJu\s*\{[^}]*grid-template-columns/.test(appCss));
check('liaoTianChuangKou does NOT hide biaoTiLan', !/biaoTiLan.*yinCang[\s\S]{0,40}liaoTianChuangKou|liaoTianChuangKou[\s\S]{0,80}biaoTiLan.*yinCang/.test(appJs));
check('boot adds body.liaoTianChuangKou for fu/chatId', /classList\.add\('liaoTianChuangKou'\)/.test(appJs));
check('btn-open-win passes mode fu', /btn-open-win[\s\S]{0,800}mode:\s*'fu'/.test(appJs) || /btn-open-win[\s\S]{0,800}mode:\s*'fu'/.test(appJs.replace(/\s+/g, ' ')));
check('biaoTiLan has drag region CSS', /-webkit-app-region:\s*drag/.test(appCss) || /-webkit-app-region:\s*drag/.test(rCss));
check('index loads both css', /app\.css/.test(html) && /renderer\.css/.test(html));

console.log(`\n==== verify-chat-window: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
