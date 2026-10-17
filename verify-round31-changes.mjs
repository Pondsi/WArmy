/**
 * Round 31 static checks. ASCII-only assertions.
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
const adapter = fs.existsSync('packages/app-shell/src/she-jiao-adapter.ts')
  ? fs.readFileSync('packages/app-shell/src/she-jiao-adapter.ts', 'utf8') : '';

// 1. Speech sections merged
chk('old-asr-section-removed', !app.includes("settings.asrLocalTitle"));
chk('new-speech-title', zh.includes('本地语音与文字互转'));
chk('new-speech-hint', /"localSpeech\.hint"\s*:\s*"[^"]*本地[^"]*"/.test(zh));

// 2. otherTitle not garbled
chk('otherTitle-clean', /"projectFiles\.otherTitle"\s*:\s*"\u5176\u4ed6\u6587\u4ef6"/.test(zh) || /"projectFiles\.otherTitle"\s*:\s*"[^"]{2,4}"/.test(zh) && !/projectFiles\.otherTitle\\":/.test(zh));
const m = zh.match(/"projectFiles\.otherTitle"\s*:\s*"([^"]*)"/);
chk('otherTitle-value-ok', m && m[1].length >= 2 && m[1].length <= 8);

// 3. Auth toggle initial collapsed
chk('auth-toggle-collapsed', app.includes("ul.classList.add('yinCang')") && app.includes('bindShouQuanToggle'));

// 4. Op right-aligned
chk('op-right-align', css.includes('pfCaoZuo') && css.includes('margin-left: auto'));

// 5. whoMing helper
chk('who-ming', app.includes('function whoMing') && app.includes('whoMing()'));

// 6. IM adapters
chk('im-adapter-file', adapter.includes('SheJiaoAdapter') && adapter.includes('TelegramAdapter'));
chk('im-adapter-wecom', adapter.includes('WeiXinAdapter'));
chk('im-adapter-ilink', adapter.includes('ILinkAdapter'));
chk('im-adapter-feishu', adapter.includes('FeiShuAdapter'));
chk('im-ipc', em.includes('warmy:sheJiaoLianJie') && em.includes('warmy:sheJiaoFaSong'));

// 7. Retry button after interrupt
chk('retry-re-render', app.includes('renderChat()') && app.includes('planInterrupted'));

// 8. Plan select not duplicated
const planSelectCount = (app.match(/selOld\.remove\(\)/g) || []).length;
chk('plan-select-no-dup-remove', planSelectCount === 0);

// 9. Attachment recorded
chk('attach-record', em.includes("by: 'chat-attachment'"));

// 10. Screenshot recorded
chk('shot-record', em.includes("by: 'screenshot'"));

console.log('=== verify-round31-changes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
