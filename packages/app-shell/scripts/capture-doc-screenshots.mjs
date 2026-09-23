#!/usr/bin/env node
/**
 * Capture CDP screenshots for README docs/screenshots/
 * Uses Electron preview host (self-contained, same as ui-inspect).
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {attach, sleep, BOOT_DONE} from './cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const OUT = process.env.WARMY_SHOT_OUT || path.join(os.tmpdir(), 'warmy-shots');
const PORT = Number(process.env.WARMY_SHOT_PORT || 9777);
const DEST = path.join(repoRoot, 'docs', 'screenshots');
const electronPath = path.join(pkgRoot, 'node_modules', 'electron', 'dist', 'electron.exe');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });

const HOST = path.join(OUT, 'shot-host.cjs');
fs.writeFileSync(HOST, `const { yingYong, BrowserWindow } = require('electron');
const target = process.env.PREVIEW_HTML;
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1280, height: 860, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false } });
  w.loadFile(target);
});
app.on('window-all-closed', () => app.quit());
`, 'utf8');

function runBuild() {
  return new Promise((resolve, reject) => {
    const r = spawn(process.execPath, [path.join(selfDir, 'build-preview.mjs'), '--out', OUT], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
    });
    r.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('build rc=' + c))));
  });
}

async function waitCdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(400);
  }
  return false;
}

async function shot(c, ming) {
  try {
    const r = await c.send('Page.captureScreenshot', { format: 'png' }, { timeout: 10000 });
    const p = path.join(DEST, ming);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('saved', p, fs.statSync(p).size);
  } catch (e) {
    console.warn('shot fail', ming, e.message.slice(0, 80));
  }
}

async function main() {
  console.log('build preview →', OUT);
  await runBuild();
  const html = path.join(OUT, 'index.html');
  const child = spawn(electronPath, [
    `--remote-debugging-port=${PORT}`,
    '--disable-features=CalculateNativeWinOcclusion',
    `--user-data-dir=${path.join(OUT, 'profile')}`,
    HOST,
  ], { env: { ...process.env, PREVIEW_HTML: html }, cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  if (!(await waitCdp())) {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    throw new Error('CDP not up');
  }
  await sleep(2500);
  const c = await attach(PORT, { biaoQian: 'shots', callTimeout: 15000 });
  await c.send('Runtime.enable');
  try { await c.waitFor(BOOT_DONE, { timeout: 15000 }); } catch { /* warn */ }
  // README screenshots must be **English** yuYan
  await c.evaluate(`(async function(){
    try {
      localStorage.setItem('warmyPreviewSettings', JSON.stringify({ yuYan: 'en-US' }));
    } catch (e) {}
  })()`);
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  try { await c.waitFor(BOOT_DONE, { timeout: 12000 }); } catch { /* noop */ }
  // force load en-US pack
  await c.evaluate(`(async function(){
    try {
      if (window.__warmyLoadI18n) await window.__warmyLoadI18n('en-US');
      if (window.warmy?.settingsSave) await window.warmy.settingsSave({ yuYan: 'en-US' });
    } catch (e) {}
  })()`);
  await sleep(600);
  await shot(c, 'ui-home.png');
  // daKai settings → functions (skills always visible)
  await c.evaluate(`(async()=>{
    const btns=[...document.querySelectorAll('button,[role=button]')];
    const hit=btns.find(b=>/Settings|设置/.test((b.textContent||'').trim())||b.dataset?.nav==='settings');
    if(hit) hit.click();
    await new Promise(r=>setTimeout(r,400));
    const func=[...document.querySelectorAll('button')].find(b=>b.dataset?.sec==='func'||/Functions|功能/.test(b.textContent||''));
    if(func) func.click();
    await new Promise(r=>setTimeout(r,400));
  })()`);
  await shot(c, 'ui-settings.png');
  // skills ka
  await c.evaluate(`(async()=>{
    const ka=document.getElementById('jinengJiKa');
    if(ka && ka.scrollIntoView) ka.scrollIntoView({block:'center'});
    await new Promise(r=>setTimeout(r,300));
  })()`);
  await shot(c, 'ui-skills.png');
  // about
  await c.evaluate(`(async()=>{
    const b=[...document.querySelectorAll('button')].find(x=>x.dataset?.sec==='about'||/About|关于/.test(x.textContent||''));
    if(b) b.click();
    await new Promise(r=>setTimeout(r,300));
  })()`);
  await shot(c, 'ui-about.png');
  // yuYan ja proof (not used in README)
  await c.evaluate(`(async()=>{
    const sel=document.getElementById('xuanZeYuYan');
    if(sel){ sel.value='ja'; sel.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,600)); }
  })()`);
  await shot(c, 'ui-locale-ja.png');
  // restore en for home if we re-shot home first — already English above
  try { c.close(); } catch { /* noop */ }
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  const files = fs.readdirSync(DEST);
  console.log('screenshots dir', DEST, files);
  if (!files.includes('ui-home.png')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
