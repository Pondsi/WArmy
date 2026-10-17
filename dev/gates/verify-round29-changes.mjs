/**
 * Round 29 static checks (ASCII-only assertions to avoid console encoding issues).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('packages/app-shell');
const fail = [];
const ok = [];
const chk = (name, cond) => { if (cond) ok.push(name); else fail.push(name); };

const em = fs.readFileSync(path.join(ROOT, 'src/electron-main.ts'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/renderer/app.css'), 'utf8');
const snip = fs.readFileSync(path.join(ROOT, 'src/renderer/snip.html'), 'utf8');
const ctx = fs.readFileSync(path.join(ROOT, 'src/context-renderer.ts'), 'utf8');

// 1 auth hard gate
chk('auth-no-wide-match', !em.includes('muLuOf(t2) === muLu'));
chk('auth-exact-key', em.includes("mode: 'exact'") || em.includes('yiShouQuan'));
// 2 auth no recommend
chk('auth-no-recommend', em.includes('shiShouQuanKa ? false') || em.includes('tuiJian: shiShouQuanKa ? false'));
// 3 decision recommend fallback
chk('decision-recommend-fallback', em.includes('!guiYi.some((o) => o.tuiJian)') || em.includes('guiYi.some((o) => o.tuiJian)'));
// 4 diag card
chk('diag-not-default', !appjs.includes("single: ['diagMianBanKuai'"));
chk('diag-no-auto-add', appjs.includes("kaId === 'diagMianBanKuai'"));
// 5 card order
chk('model-under-auth', /mianBanShouQuanKuai[\s\S]{0,80}mianBanMoXingMgrKuai/.test(appjs));
chk('assist-under-plan', /mianBanJiHuaKuai[\s\S]{0,80}mianBanAssistKuai/.test(appjs));
// 6 plan card
chk('plan-copy-quotes', appjs.includes('yin') && appjs.includes('writeText(yin)'));
chk('plan-select-in-title', appjs.includes('jiHuaQingLiWrap'));
// 7 token merge
chk('token-turnCount', em.includes('turnCount') && ctx.includes('turnCount'));
// 8 path links
chk('reply-path-link', appjs.includes('luJingLian'));
chk('pfMing-clickable', appjs.includes("closest('.pfMing')"));
// 9 volume right-click
chk('volume-rightclick', appjs.includes('shouYinLiangHuaKuai'));
// 10 screenshot theme
chk('snip-uses-accent', snip.includes('--accent') && !snip.includes('#ffd28a'));
chk('snip-inject-accent', em.includes("setProperty('--accent'"));
// 11 action detail
chk('action-ledger', appjs.includes('xingDongTai') && appjs.includes('xingDongJi'));
chk('action-relief-css', css.includes('xingDongKuai') && css.includes('box-shadow'));
// 12 host-seed finish（第 34 轮起宿主不再预置步骤 ⇒ 没有需要收尾的种子行）
chk('hostseed-round-finished', !em.includes("'plan.host-seed'"));
// 13 skills
chk('skills-requires', em.includes('jieXiYiLai') || em.includes('chaYiLaiQueShao'));
chk('skills-search', em.includes('souSuoJiNeng') || em.includes('jiNengSuoYin'));
// 14 abs path prompt
chk('abs-path-prompt', em.includes('writeText') && em.includes('1500') ? em.includes('Markdown') : false);
// simpler: look for the new system push by unique ASCII
chk('abs-path-prompt2', em.includes('Desktop/xx.txt'));

console.log('=== verify-round29-changes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
