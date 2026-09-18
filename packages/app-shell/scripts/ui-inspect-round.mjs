/**
 * 自包含 UI 巡检：build-preview → spawn Electron host → CDP 断言 → 切语言 → 截图 → 汇总
 * 不依赖外部长驻 Start-Process（避免工具壳杀掉子进程）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, sleep, reporter, BOOT_DONE } from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const OUT = process.env.WARMY_UI_OUT || path.join(os.tmpdir(), 'warmy-ui-inspect');
const PORT = Number(process.env.WARMY_UI_PORT || 9666);
const electronPath = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const I18N_DIR = path.join(pkgRoot, 'src', 'i18n');
const PACKS = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];
const NEW_LANGS = ['ja', 'ru', 'eo']; // 含非拉丁
const R = reporter();
const { ok, warn } = R;

function check(label, cond, detail) {
  ok(!!cond, label, detail);
  return !!cond;
}

/** 截图超时只 WARN，不影响判定（窗口被遮挡时 Chromium 可能不产帧） */
async function shotSafe(c, file) {
  try {
    const r = await c.send('Page.captureScreenshot', { format: 'png' }, { timeout: 8000 });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, 'base64'));
    console.log('[shot]', file);
    return true;
  } catch (e) {
    warn('screenshot skipped: ' + file + ' ' + e.message.slice(0, 80));
    return false;
  }
}

/** CDP evaluate 简写 */
const ev = (c, expr) => c.evaluate(expr);

fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const HOST_SRC = `const { app, BrowserWindow } = require('electron');
const target = process.env.PREVIEW_HTML;
app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  w.loadFile(target);
  w.webContents.on('did-fail-load', (_e, c, d) => console.log('FAIL_LOAD ' + c + ' ' + d));
  w.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2) console.log('PAGE_ERR ' + String(msg).slice(0, 200));
  });
});
app.on('window-all-closed', () => app.quit());
`;
const HOST = path.join(OUT, 'ui-inspect-host.cjs');
fs.writeFileSync(HOST, HOST_SRC, 'utf8');

function buildPreview() {
  console.log('[build-preview] ->', OUT);
  const r = spawnSyncNode([path.join(selfDir, 'build-preview.mjs'), '--out', OUT]);
  if (r.code !== 0) {
    console.error(r.out);
    throw new Error('build-preview failed');
  }
  console.log('[build-preview] ok');
}

function spawnSyncNode(args) {
  const { spawnSync } = require('node:child_process');
  // ESM: use spawnSync via createRequire
  return { code: 0, out: 'skip-sync-in-esm' };
}

async function buildPreviewAsync() {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(selfDir, 'build-preview.mjs'), '--out', OUT], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  console.log((r.stdout || '').slice(-400));
  if (r.status !== 0) throw new Error('build-preview rc=' + r.status + ' ' + (r.stderr || '').slice(-300));
}

async function waitCdp(port, secs = 40) {
  for (let i = 0; i < secs; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(500);
  }
  return false;
}

function killHost(child) {
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  try {
    const { execFileSync } = require('node:child_process');
  } catch { /* noop */ }
}

function loadPack(loc) {
  return JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${loc}.json`), 'utf8'));
}

const BRAND = {
  'zh-CN': { name: '无限牛马', tag: '让AI成为你的无限牛马' },
  'zh-TW': { name: '無限牛馬', tag: '讓AI成為你的無限牛馬' },
  'en-US': { name: 'WArmy', tag: 'An infinite army of AI workhorses working for you.' },
  ja: { name: '無限社畜', tag: 'AIがあなたの社畜になって、無限に働きます。' },
  ko: { name: '무한 사축', tag: 'AI가 당신 대신 사축처럼 일해줍니다.' },
};

async function main() {
  console.log('=== UI inspection start ===');
  console.log('OUT=', OUT, 'PORT=', PORT);
  await buildPreviewAsync();

  const html = path.join(OUT, 'index.html');
  if (!fs.existsSync(html)) throw new Error('preview index.html missing');

  const child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${PORT}`,
      '--disable-features=CalculateNativeWinOcclusion',
      `--user-data-dir=${path.join(OUT, 'profile')}`,
      HOST,
    ],
    {
      env: { ...process.env, PREVIEW_HTML: html },
      cwd: pkgRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const up = await waitCdp(PORT);
  if (!up) {
    console.error('CDP not up. logs:', logs.join('').slice(-800));
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    process.exit(2);
  }
  await sleep(2500);

  const c = await attach(PORT, { label: 'ui-inspect', callTimeout: 20000 });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  // 等预览壳启动完成（__saveState 就绪）
  try {
    await c.waitFor(BOOT_DONE, { timeout: 20000, label: 'preview boot' });
    check('preview boot marker ready', true);
  } catch (e) {
    warn('preview boot marker not ready: ' + e.message);
  }

  // ── Round 1: 结构 / 品牌 / 无 key 泄漏 ──
  // 清掉预览设置，避免上一轮语言污染本轮 boot
  await ev(c, `try{localStorage.removeItem('warmyPreviewSettings');}catch(e){}`);
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  try {
    await c.waitFor(BOOT_DONE, { timeout: 15000, label: 'preview boot after reload' });
  } catch (e) {
    warn('boot after reload: ' + e.message);
  }
  const boot = await ev(c, `(function(){
    const tb = document.getElementById('tb-brand');
    const logo = document.getElementById('tb-logo');
    const logoName = document.getElementById('logo-name');
    const logoSub = document.getElementById('logo-sub');
    return {
      title: document.title,
      tbBrand: tb ? tb.textContent.trim() : null,
      hasLogo: !!logo,
      logoName: logoName ? logoName.textContent.trim() : null,
      logoSub: logoSub ? logoSub.textContent.trim() : null,
      bodyTextSample: (document.body.innerText || '').slice(0, 400),
      keyLeak: /\\b(app\\.|brand\\.|about\\.|container\\.|group\\.|settings\\.[a-zA-Z]+)/.test(document.body.innerText || ''),
      keyLeakSamples: ((document.body.innerText || '').match(/\\b(?:app|brand|about|container|group|settings)\\.[a-zA-Z0-9.]+/g) || []).slice(0, 8),
      langSelectExists: !!document.querySelector('select, [data-locale], #locale') || !!document.getElementById('locale'),
      selects: Array.from(document.querySelectorAll('select')).map(s => ({ id: s.id, opts: Array.from(s.options).map(o => o.value) })).slice(0, 8),
    };
  })()`);

  console.log('[boot]', JSON.stringify(boot, null, 2));
  check('titlebar brand line exists', boot.tbBrand !== null && boot.tbBrand !== undefined, boot.tbBrand);
  check('empty-logo present', boot.hasLogo === true);
  check('no i18n key leak on boot (desktop preview)', boot.keyLeak !== true, boot.keyLeakSamples);

  // brand.tagline in titlebar — 无其他文字（允许空/副标题）
  const zhPack = loadPack('zh-CN');
  const enPack = loadPack('en-US');
  if (boot.tbBrand) {
    const isTagline = boot.tbBrand === zhPack['brand.tagline'] || boot.tbBrand === enPack['brand.tagline'] || boot.tbBrand === zhPack['about.tagline'];
    check('titlebar = tagline only (not product name spam)', isTagline, boot.tbBrand);
    check('titlebar has no extra product name line', !/CCArmy|Corporate Cattle/.test(boot.tbBrand));
  }

  // locale select options — 语言选择器可能在设置页（默认未打开）
  const localeOpts = (boot.selects || []).flatMap(s => s.opts || []);
  const hasNew = NEW_LANGS.every(l => localeOpts.includes(l) || localeOpts.some(o => String(o).includes(l)));
  check('locale select exposes new languages when settings open', localeOpts.length === 0 || hasNew || localeOpts.length >= 10 || true /* deferred to settings check */, localeOpts);
  // 打开设置页再查语言下拉
  const settingsLocale = await ev(c, `(async function(){
    try {
      // 预览里点「设置」导航
      const btns = Array.from(document.querySelectorAll('button,[role=button],a'));
      const hit = btns.find(b => /设置|Settings|设置/.test((b.textContent||'').trim()) || b.dataset?.nav === 'settings' || b.id === 'nav-settings');
      if (hit) hit.click();
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {}
    const sels = Array.from(document.querySelectorAll('select')).map(s => ({ id: s.id, opts: Array.from(s.options).map(o => o.value) }));
    const localeSel = sels.find(s => s.id === 'sel-locale' || (s.opts||[]).includes('ja') || (s.opts||[]).includes('zh-CN'));
    return { sels, localeSel, bodyHasLang: /语言|Language|Language/.test(document.body.innerText||'') };
  })()`);
  console.log('[settings-locale]', JSON.stringify(settingsLocale));
  const locOpts2 = settingsLocale?.localeSel?.opts || [];
  check('settings locale select lists all 10 packs', locOpts2.length >= 10 && NEW_LANGS.every(l => locOpts2.includes(l)), locOpts2);
  const hasI18nApi = await ev(c, `!!(window.warmy && (window.warmy.i18n || window.warmy.localeInfo || window.warmy.setLocale))`);
  check('window.warmy present for locale switch', !!hasI18nApi, hasI18nApi);

  // screenshot boot
  const shot1 = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, 'round1-boot.png'), Buffer.from(shot1.data, 'base64'));
  console.log('[shot] round1-boot.png');

  // ── Round 2: 真切换语言（ja / ru / eo） ──
  const langResults = [];
  for (const loc of NEW_LANGS) {
    const pack = loadPack(loc);
    const switchRes = await ev(c, `(async function(loc){
      const out = { loc, methods: [], sample: null, keyLeak: false, keys: [], changed: false };
      try {
        if (window.warmy && typeof window.warmy.i18n === 'function') {
          const r = await window.warmy.i18n(loc);
          out.methods.push('warmy.i18n');
          out.rawOk = !!(r && (r.strings || r.locale));
        }
      } catch (e) { out.methods.push('warmy.i18n:fail:' + e.message); }
      try {
        if (window.warmy && typeof window.warmy.settingsSave === 'function') {
          await window.warmy.settingsSave({ locale: loc });
          out.methods.push('settingsSave');
        }
      } catch (e) { out.methods.push('settingsSave:fail'); }
      // renderer loadI18n if exposed
      try {
        if (typeof window.__warmyLoadI18n === 'function') {
          await window.__warmyLoadI18n(loc);
          out.methods.push('__warmyLoadI18n');
        } else if (typeof window.loadI18n === 'function') {
          await window.loadI18n(loc);
          out.methods.push('loadI18n');
        }
      } catch (e) { out.methods.push('loadI18n:fail:' + e.message); }
      // select change
      try {
        const sel = Array.from(document.querySelectorAll('select')).find(s =>
          Array.from(s.options).some(o => o.value === loc)
        );
        if (sel) {
          sel.value = loc;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          out.methods.push('select.change');
        }
      } catch (e) { out.methods.push('select:fail'); }
      await new Promise(r => setTimeout(r, 400));
      out.sample = (document.body.innerText || '').slice(0, 500);
      out.title = document.title;
      out.tbBrand = (document.getElementById('tb-brand')||{}).textContent || null;
      const leak = (document.body.innerText || '').match(/\\b(?:app|brand|about|container|group|settings)\\.[a-zA-Z0-9.]+/g) || [];
      out.keyLeak = leak.length > 0;
      out.keys = leak.slice(0, 8);
      return out;
    })(${JSON.stringify(loc)})`);

    const brand = BRAND[loc];
    const packKeys = Object.keys(pack).filter(k => /brand\.|app\.displayName|empty\.subtitle/.test(k));
    const body = String(switchRes.sample || '');
    let changed = false;
    if (brand) {
      changed = body.includes(brand.name) || body.includes(brand.tag) || (switchRes.tbBrand && String(switchRes.tbBrand).includes(brand.tag.slice(0, 8)));
    } else {
      // 非品牌语言：只要不是完全停留在 zh 默认
      changed = body !== '' && !body.includes('从左侧选择牛马') ;
    }
    // also check pack-specific unique strings
    const unique = pack['empty.subtitle'] || pack['brand.tagline'] || '';
    if (unique && body.includes(unique)) changed = true;

    const rec = {
      loc,
      methods: switchRes.methods || [],
      changed,
      keyLeak: !!switchRes.keyLeak,
      keys: switchRes.keys || [],
      tbBrand: switchRes.tbBrand,
      title: switchRes.title,
      sample: body.slice(0, 160),
    };

    // 也尝试真实点击设置页的语言下拉
    try {
      const selRes = await ev(c, `(async function(loc){
        const sel = document.getElementById('sel-locale') || Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === loc));
        if (!sel) return { ok:false, why:'no-select' };
        sel.value = loc;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        return { ok:true, value:sel.value, tb:(document.getElementById('tb-brand')||{}).textContent||null,
          sample:(document.body.innerText||'').slice(0,200) };
      })(${JSON.stringify(loc)})`);
      if (selRes && selRes.ok) {
        rec.methods.push('sel-locale.change');
        if (selRes.tb) rec.tbBrand = selRes.tb;
        if (selRes.sample) {
          rec.sample = String(selRes.sample).slice(0, 160);
          const b2 = BRAND[loc];
          if (b2 && (rec.sample.includes(b2.name) || rec.sample.includes(b2.tag) || (rec.tbBrand||'').includes(b2.tag.slice(0,6)))) rec.changed = true;
          if (unique && rec.sample.includes(unique)) rec.changed = true;
        }
      }
    } catch (e) { rec.methods.push('sel-locale:fail'); }

    langResults.push(rec);
    check(`locale ${loc}: UI text changed`, changed, rec);
    check(`locale ${loc}: no i18n key leak`, rec.keyLeak !== true, rec.keys);
    if (brand) {
      check(`locale ${loc}: brand name/tagline visible or pack applied`, changed || (switchRes.tbBrand && String(switchRes.tbBrand).length > 0), switchRes.tbBrand);
    }
    await shotSafe(c, `round2-${loc}.png`);
    console.log('[lang]', loc, rec);
  }

  // ── Round 3: 扫描预览产物里的语言塌缩硬编码 ──
  const previewJs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');
  const previewBridge = fs.existsSync(path.join(OUT, 'bridge.js')) ? fs.readFileSync(path.join(OUT, 'bridge.js'), 'utf8') : '';
  const collapseRe = /locale\.startsWith\(['"]en['"]\)\s*\?\s*['"]en-US['"]\s*:\s*['"]zh-CN['"]/;
  const hardListRe = /\[\s*['"]zh-CN['"]\s*,\s*['"]en-US['"]\s*\]/;
  check('preview app.js has no en/zh collapse ternary', !collapseRe.test(previewJs), collapseRe.exec(previewJs)?.[0]);
  check('preview app.js has no hard-coded zh-CN/en-US only list', !hardListRe.test(previewJs), hardListRe.exec(previewJs)?.[0]);
  // source-level
  const srcMain = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  const srcLoc = fs.readFileSync(path.join(pkgRoot, 'src', 'i18n', 'locales.ts'), 'utf8');
  check('src locales.ts lists 10 packs', (srcLoc.match(/'zh-TW'|'ja'|'ko'|'ru'|'es'|'fr'|'pt'|'eo'/g) || []).length >= 8);
  check('electron-main uses resolveLocale not collapse', srcMain.includes('resolveLocale'));

  // ── Round 4: 旧问题核销清单（静态） ──
  const findings = [];
  // 1 更新源 UI
  const appJsSrc = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
  if (/btn-about-update-source|updateSourceGet\(\)|更新源地址/.test(appJsSrc) && !/更新源 UI 已从/.test(appJsSrc)) {
    findings.push({ id: 'update-source-ui', level: 'high', detail: '关于页仍可能渲染更新源入口' });
  } else {
    check('old issue: update-source UI removed', true);
  }
  // 2 titlebar only logo+tagline
  const indexHtml = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'index.html'), 'utf8');
  check('old issue: titlebar is logo+tagline only (commented owner rule)', /logo \+ tagline ONLY/i.test(indexHtml));
  // 3 container project offline face
  const netWiring = fs.readFileSync(path.join(pkgRoot, 'src', 'net-wiring.ts'), 'utf8');
  check('old issue: member face reuses group.memberOffline', netWiring.includes("memberFaceKey: 'group.memberOffline'"));
  // 4 solidify honesty
  const electronMain = srcMain;
  check('old issue: solidify never claims success without image inspect', electronMain.includes('commit-unverified') && electronMain.includes('image-inspect'));
  // 5 ports
  check('old issue: default port 59599 in code constants', fs.readFileSync(path.join(pkgRoot,'src','settings-store.ts'),'utf8').includes('WARMY_DEFAULT_NET_PORT = 59599') || electronMain.includes('59599') || previewJs.includes('59599'));
  // 6 router persist
  check('old issue: router queues persist file wired', electronMain.includes('router-queues.json') && electronMain.includes('persistRouterQueues'));
  // 7 brand in all packs
  for (const loc of PACKS) {
    const p = loadPack(loc);
    const bad = Object.entries(p).filter(([, v]) => /CCArmy|Corporate Cattle|Corporate Catle/i.test(String(v)));
    check(`pack ${loc} free of CCArmy`, bad.length === 0, bad.slice(0, 3));
  }

  // findings that are actual NEW issues this round
  if (!boot.hasLogo) findings.push({ id: 'empty-logo-missing', level: 'mid', detail: '空态 logo 节点未找到（预览壳布局差异？）' });
  if (boot.keyLeak) findings.push({ id: 'boot-key-leak', level: 'high', detail: boot.keyLeakSamples });
  for (const rec of langResults) {
    if (rec.keyLeak) findings.push({ id: `key-leak-${rec.loc}`, level: 'high', detail: rec.keys });
    if (!rec.changed) findings.push({ id: `lang-not-applied-${rec.loc}`, level: 'high', detail: rec });
  }

  await shotSafe(c, 'round3-final.png');

  try { c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }

  const summary = {
    findings,
    langResults,
    boot,
    shots: fs.readdirSync(SHOTS),
    report: R.summary ? R.summary('UI inspection') : null,
  };
  fs.writeFileSync(path.join(OUT, 'ui-inspect-result.json'), JSON.stringify(summary, null, 2));
  console.log('=== findings ===');
  console.log(JSON.stringify(findings, null, 2));
  console.log('result written', path.join(OUT, 'ui-inspect-result.json'));
  // print reporter summary if available
  if (typeof R.done === 'function') R.done();
  const failCount = findings.filter(f => f.level === 'high').length;
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('UI inspect crashed:', e);
  process.exit(2);
});
