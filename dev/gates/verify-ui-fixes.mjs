/**
 * UI regression checks after the rename storm: guide nav, color swatches, settings render.
 * ASCII-only assertions.
 */
import fs from 'node:fs';
import path from 'node:path';

const fail = [];
const ok = [];
const chk = (n, c) => { if (c) ok.push(n); else fail.push(n); };

const app = fs.readFileSync('packages/app-shell/src/renderer/app.js', 'utf8');
const css = fs.readFileSync('packages/app-shell/src/renderer/app.css', 'utf8');
const html = fs.readFileSync('packages/app-shell/src/renderer/index.html', 'utf8');

// 1. No out-of-scope tianAudio in bindGateList
chk('no-tianAudio-in-gates', !/if \(tianAudio\)/.test(app));
chk('tianJiaBtn-used', /if \(tianJiaBtn\)/.test(app));

// 2. Model chain assign uses tianFenPei (not dangling tian()
chk('fenPei-renamed', app.includes('tianFenPei') && !/for \(const l of muBiao\) if \(tian\(/.test(app));

// 3. Color swatches
chk('zhuTiSwatches-container', app.includes('id="zhuTiSwatches"'));
chk('renderThemeSwatches-called', app.includes('renderThemeSwatches()'));
chk('accentPalette-exists', app.includes('function accentPalette'));
chk('hslToHex-exists', app.includes('function hslToHex'));
chk('swatches-css', css.includes('zhuTiSwatches'));

// 4. Guide step1 goes to settings+model
chk('guide-setNav-settings', /setNav\('settings'\)/.test(app));
chk('guide-settingsSection-model', /settingsSection = 'model'/.test(app));
chk('guide-showSec-model-btn', html.includes('data-sec="model"') || app.includes('data-sec="model"'));

// 5. showSec structure: skill branch clean, model fold outside
chk('showSec-skill-clean', !/if \(key === 'skill'\) \{\s*try \{\s*const zhe = \$\('moXingGuanLiZheDie'\)/.test(app));
chk('moXing-fold-bound', app.includes("moXingGuanLiZheDie"));

// 6. renderPage modelUsageCache declared early
const emIdx = app.indexOf('let modelUsageCache = new Map()');
const rpIdx = app.indexOf('function renderPage()');
chk('modelUsageCache-in-renderPage', emIdx > rpIdx && emIdx > 0);

// 7. paintPicker / paintWeb distinct
chk('paintPicker-distinct', app.includes('const paintPicker = ') && app.includes('const paintWeb = async'));
chk('no-paintCfg-left', !app.includes('paintCfg'));

// 8. huaGates in bindGateList
chk('huaGates-scoped', app.includes('const huaGates = ') && app.includes('window.__renderGates = huaGates'));

// 9. CSS theme vars for screenshot
const snip = fs.readFileSync('packages/app-shell/src/renderer/snip.html', 'utf8');
chk('snip-accent', snip.includes('--accent') && !snip.includes('#ffd28a'));

// 10. No duplicate const paintCfg
chk('no-dup-paint-def', (app.match(/const paintCfg = /g) || []).length === 0);

console.log('=== verify-ui-fixes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
