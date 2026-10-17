/**
 * Round 32 static checks. ASCII-only assertions.
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
const adapter = fs.readFileSync('packages/app-shell/src/she-jiao-adapter.ts', 'utf8');
const kb = fs.readFileSync('packages/knowledge-base/src/index.ts', 'utf8');

// T11 (item 11): root cause fix + retry button + badge
chk('kb-save-selfheal', kb.includes('mkdirSync(this.CangLu') && kb.includes('catch'));
chk('kb-ctor-guarded', /try \{ fs\.mkdirSync\(CangLu/.test(kb));
chk('kb-call-guarded', /try \{\s*knowledge\.upsertEntity\(\{[\s\S]{0,200}session-/.test(em));
chk('retry-on-incomplete', app.includes('planInterrupted.add(String(cur.id') && app.includes('renderChat()'));
chk('abnormal-badge', app.includes('state.abnormalStop.add(String(cur.id'));

// T11 (items 1,2,6): plan dropdown pos, auth card, h3 size
chk('plan-dropdown-css', css.includes('jiHuaQingLiWrap') && css.includes('margin-right: 62px'));
chk('plan-dropdown-no-inline', !app.includes("margin-left:8px'") || !app.includes('jiHuaQingLiWrap'));
chk('auth-restore-called', em.includes('shouQuanHuiFu();'));
chk('auth-card-always', app.includes('!items.length && !kuai.dataset.force) kuai.classList.remove'));
chk('settings-h3-size', css.includes('.sheZhiKa h3') && css.includes('font-size: var(--fs-base)'));
chk('speech-hint-new', zh.includes('语音服务（语音转文字和文字转语音）将在本地完成'));

// T12 (items 3,4,5): dsh dropdown, ASR, speech card position + buttons
chk('dsh-select', app.includes('dshMkFenLeiXuan') && !app.includes('function dshMkPill'));
chk('dsh-select-css', css.includes('dshMkLeiXuan'));
chk('asr-no-first-chunk', app.includes('yuYinZhuangTai.n >= 2 && yuYinZhuangTai.n % 2 === 0'));
chk('asr-replace-not-append', app.includes('zt.yiChaRu') && app.includes('indexOf(zt.yiChaRu)'));
chk('asr-skip-undecodable', app.includes('if (!wavUrl && yuLan) return;'));
chk('speech-after-audio', (() => {
  const ai = app.indexOf('id="yinPinSheBeiKa"');
  const bi = app.indexOf('id="benDiYuYinKa"');
  return ai > 0 && bi > ai;
})());
chk('speech-check-update-btn', app.includes("localSpeech.checkUpdate"));
chk('speech-delete-btn', app.includes('anNiuBenDiYuYinShanChu'));
chk('speech-btn-help', zh.includes('自检 = 本机合成一句中文再识别回来'));

// T13 (items 7,8,9,10): IM UI + adapter + attachment ledger
chk('social-card-ui', app.includes('id="sheJiaoKa"') && app.includes('renderSheJiao'));
chk('social-render-wired', app.includes("if (key === 'func')") && app.includes('void renderSheJiao();'));
chk('social-css', css.includes('sheJiaoHang'));
chk('adapter-platforms', ['WeiXinAdapter', 'TelegramAdapter', 'FeiShuAdapter', 'ILinkAdapter', 'SlackAdapter', 'DiscordAdapter', 'DingTalkAdapter', 'MatrixAdapter'].every((x) => adapter.includes(x)));
chk('adapter-factory', adapter.includes("case 'matrix': return new MatrixAdapter"));
chk('social-bridge', em.includes('zhenZhengFaSong(null') && em.includes("shejiao.replied"));
chk('session-read-ledger', em.includes('huiHuaDuTai') && em.includes('session-read-ledger'));
chk('attach-records-session', em.includes('jiLuHuiHuaDu(String(sessionId'));

// i18n
const i18nDir = 'packages/app-shell/src/i18n';
let allOk = true;
for (const f of fs.readdirSync(i18nDir)) {
  if (!f.endsWith('.json')) continue;
  const t = fs.readFileSync(path.join(i18nDir, f), 'utf8');
  try { JSON.parse(t); } catch { allOk = false; console.log('BAD JSON', f); }
}
chk('i18n-all-valid', allOk);

console.log('=== verify-round32-changes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
