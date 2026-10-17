/**
 * Round 30 static checks. ASCII-only assertions.
 */
import fs from 'node:fs';
import path from 'node:path';

const fail = [];
const ok = [];
const chk = (n, c) => { if (c) ok.push(n); else fail.push(n); };

const app = fs.readFileSync('packages/app-shell/src/renderer/app.js', 'utf8');
const em = fs.readFileSync('packages/app-shell/src/electron-main.ts', 'utf8');
const css = fs.readFileSync('packages/app-shell/src/renderer/app.css', 'utf8');
const zh = fs.readFileSync('packages/app-shell/src/i18n/zh-CN.json', 'utf8');

// 1. Universal card collapse
chk('card-collapse-fn', app.includes('ensurePanCardCollapse'));
chk('card-collapse-hook', app.includes('ensurePanCardCollapse()'));
chk('pfHead-collapse', app.includes("pfHead[data-pf]"));

// 2. Auth card toggle + grant-once record
chk('auth-toggle', app.includes('bindShouQuanToggle') || app.includes('shouQuanKaiGuan'));
chk('grant-once-record', em.includes('once-') && em.includes('shouQuanCun'));

// 3. Plan clean select always present
chk('plan-select-early', app.includes('jiHuaQingLiWrap') && app.includes('planCleanDays'));
chk('plan-click-guard', app.includes("closest('select, button, input, a, .jiHuaQingLiWrap')"));

// 4. File row styles: no AI label, op at end, no size, hover details
chk('no-ai-label', !/shuOf\(chan\.slice\(0, 40\), \(f\) => \(f\.source \? sourceLabel/.test(app));
chk('pfCaoZuo', app.includes('pfCaoZuo'));
chk('hover-who-op', app.includes("tOr('panel.auth.who'") && app.includes("tOr('panel.auth.op'"));

// 5. otherTitle renamed
chk('other-title-renamed', /projectFiles\.otherTitle/.test(zh) && !/����Ŀ��/.test(zh));
chk('no-other-empty-explain', !/data-empty="other">.*empty\.other/.test(app) || !app.includes("t('projectFiles.empty.other')"));

// 6. Screenshot recorded
chk('shot-record', em.includes("by: 'screenshot'") && em.includes('wenJianChanSheng'));

// 7. Attachment recorded as read
chk('attach-read-record', em.includes("by: 'chat-attachment'") && em.includes("op: 'read'"));

// 8. Empty reply artifact paths
chk('empty-reply-paths', em.includes('chat.artifactPaths') && em.includes('benLunChanPin'));

// 9. i18n all locales have otherTitle
const i18nDir = 'packages/app-shell/src/i18n';
let allOther = true;
for (const f of fs.readdirSync(i18nDir)) {
  if (!f.endsWith('.json')) continue;
  const t = fs.readFileSync(path.join(i18nDir, f), 'utf8');
  if (!/"projectFiles\.otherTitle"\s*:\s*"[^"]+"/.test(t)) { allOther = false; break; }
}
chk('i18n-otherTitle-all', allOther);

// 10. CSS truncation
chk('css-pfMing-truncate', css.includes('.pfMing') && css.includes('text-overflow: ellipsis'));

console.log('=== verify-round30-changes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
