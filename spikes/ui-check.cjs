const fs = require('node:fs');
const j = fs.readFileSync('C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js', 'utf8');
const h = fs.readFileSync('C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/index.html', 'utf8');
const css = fs.readFileSync('C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.css', 'utf8');
const checks = [
  ['countdown modal', j.includes('uiConfirmCountdown')],
  ['urgency-bar bind', j.includes("'urgency-bar'")],
  ['vertical resizer', j.includes('bindVerticalResizer')],
  ['about-update removed', !j.includes('anNiuAboutGengXin')],
  ['kongZhiTaiDingTiaoZhengTiao bind', j.includes("'kongZhiTaiDingTiaoZhengTiao'")],
  ['shuRuDingTiaoZhengTiao bind', j.includes("'shuRuDingTiaoZhengTiao'")],
  ['html urgency urgentLabel', h.includes('urgency.urgentLabel')],
  ['html no chat.p1 biaoQian', !h.includes('data-i18n="chat.p1"')],
  ['ceLan icon size var', css.includes('--rail-icon')],
];
let fail = 0;
for (const [n, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', n); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
