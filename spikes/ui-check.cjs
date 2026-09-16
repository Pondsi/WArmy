const fs = require('node:fs');
const j = fs.readFileSync('C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/app.js', 'utf8');
const h = fs.readFileSync('C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/index.html', 'utf8');
const css = fs.readFileSync('C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/app.css', 'utf8');
const checks = [
  ['countdown modal', j.includes('uiConfirmCountdown')],
  ['urgency-bar bind', j.includes("'urgency-bar'")],
  ['vertical resizer', j.includes('bindVerticalResizer')],
  ['about-update removed', !j.includes('btn-about-update')],
  ['console-top-resizer bind', j.includes("'console-top-resizer'")],
  ['input-top-resizer bind', j.includes("'input-top-resizer'")],
  ['html urgency urgentLabel', h.includes('urgency.urgentLabel')],
  ['html no chat.p1 label', !h.includes('data-i18n="chat.p1"')],
  ['rail icon size var', css.includes('--rail-icon')],
];
let fail = 0;
for (const [n, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
