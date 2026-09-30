#!/usr/bin/env node
/**
 * 全功能连续 3 轮验证跑批器。
 * 用法：node scripts/full-verify-rounds.mjs [rounds=3]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(selfDir, '..');
const node = process.execPath;
const need = Number(process.argv[2] || 3);

const gates = [
  'packages/app-shell/scripts/check-syntax.mjs',
  'packages/app-shell/scripts/verify-security.mjs',
  'packages/app-shell/scripts/verify-template-integrity.mjs',
  'packages/app-shell/scripts/verify-naming.mjs',
  'packages/app-shell/scripts/verify-container-probe.mjs',
  'packages/app-shell/scripts/verify-container-exec.mjs',
  'packages/app-shell/scripts/verify-credential.mjs',
  'packages/app-shell/scripts/verify-identity.mjs',
  'packages/app-shell/scripts/verify-i18n-locales.mjs',
  'packages/app-shell/scripts/verify-wiring.mjs',
  'packages/app-shell/scripts/verify-docs.mjs',
  'packages/app-shell/scripts/verify-group-store.mjs',
  'packages/app-shell/scripts/verify-history-persist.mjs',
  'packages/app-shell/scripts/verify-memory.mjs',
  'packages/app-shell/scripts/verify-router-queue.mjs',
  'packages/app-shell/scripts/verify-repo-guard.mjs',
  'packages/app-shell/scripts/verify-updater.mjs',
  'packages/app-shell/scripts/verify-no-wsl-start.mjs',
];

function runGate(g) {
  const p = path.join(root, g);
  if (!fs.existsSync(p)) return { ok: false, out: `missing script ${g}` };
  try {
    const out = execFileSync(node, [p], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 180000 });
    return { ok: true, out: String(out).slice(-400) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || e.stderr || e).slice(-1200) };
  }
}

function unitChecks() {
  const fails = [];
  const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const distJs = fs.readFileSync(path.join(root, 'packages/app-shell/dist/renderer/app.js'), 'utf8');
  const probe = fs.readFileSync(path.join(root, 'packages/app-shell/dist/container-probe.js'), 'utf8');
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'packages/app-shell/dist/i18n/zh-CN.json'), 'utf8'));

  if (!appJs.includes('CRED_MASK_GROUPS = 9')) fails.push('mask: CRED_MASK_GROUPS!=9');
  if (!appJs.includes('raw.slice(-6)')) fails.push('mask: last 6 chars missing');
  if (!appJs.includes("Array.from({ length: CRED_MASK_GROUPS }, () => '牛马')")) fails.push('mask: not fake 9 niuma');
  if (!appJs.includes('const tOr =')) fails.push('tOr missing');
  if (!probe.includes("id: 'microsandbox'")) fails.push('probe: microsandbox missing');
  if (!probe.includes('microsandboxExecPlan')) fails.push('probe: msb exec plan missing');
  if (!probe.includes('tanCeMicrosandbox')) fails.push('probe: tanCeMicrosandbox missing');
  if (!zh['container.rt.microsandbox.name']) fails.push('i18n: microsandbox missing');
  if (!String(zh['dsh.biaoTi']||'').includes('DeepSeek Shell')) fails.push('i18n: dsh full name');
  if (!appJs.includes('MIN_MS = 1300')) fails.push('dsh: min not 1300');
  if (!appJs.includes("theme: '#A78567'")) fails.push('theme: default not #A78567');
  if (!appJs.includes('bindHotkeySection()')) fails.push('hotkey: bindHotkeySection not called');
  if (appJs.includes("ming: 'demo.agent'")) fails.push('demo.agent still present');
  if (!appJs.includes('showOnboardingGuide')) fails.push('guide: onboarding missing');
  if (!appJs.includes('dengTiaoJian')) fails.push('guide: no wait-for-done');
  if (appJs.includes("btn.textContent = t('list.addInstance')")) fails.push('create btn not plus');
  if (appJs.includes("id=\"iQiDong\"") || appJs.includes("id=\"iTingZhi\"")) fails.push('start/stop not merged');
  if (!appJs.includes('iQiDongTingZhi')) fails.push('toggle button missing');
  if (!appJs.includes("'#A78567'")) fails.push('theme #A78567 missing');
  if (appJs.includes('2ea56a') || fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8').includes('#2ea56a')) fails.push('theme: green #2ea56a still present');
  if (!appJs.includes('yinDaoTiao')) fails.push('guide: in-page bar missing');
  if (!appJs.includes('yinDaoGaoLiang')) fails.push('guide: highlight missing');
  if (appJs.includes('youGongYingShang = () => {') && appJs.includes('p.baseURL)')) fails.push('guide: baseURL counts as configured');
  if (!appJs.includes('iQiDongTingZhi')) fails.push('toggle: button missing');
  if (!appJs.includes('toggleBtn.disabled = true')) fails.push('toggle: no busy guard');
  const pd = appJs.split('const PROVIDER_DEFAULTS')[1] || '';
  if (pd && /id: 'ollama'/.test(pd.split('];')[0] || '')) fails.push('providers: ollama still in PROVIDER_DEFAULTS');
  if (!appJs.includes('renderThemeSwatches()')) fails.push('theme: swatches not called');
  if (!appJs.includes('zhuTiSeKuai')) fails.push('theme: custom block missing');
  if (!appJs.includes('ensurePanCardCloseButtons')) fails.push('card: close missing');
  if (!appJs.includes('mianBanHuiTuiDianKuai') || !appJs.includes('mianBanZhiBiaoKuai')) fails.push('card: dropdown');
  if (!appJs.includes('__quanPingQuSe')) fails.push('eyedropper missing');
  if (appJs.includes('your-ollama-host')) fails.push('ollama: placeholder in default');
  for (const s of ['CRED_MASK_GROUPS = 9', 'MIN_MS = 1300', 'zhuTiSeKuai']) {
    if (!distJs.includes(s)) fails.push(`dist missing: ${s}`);
  }
  return fails;
}

let streak = 0;
for (let rnd = 1; rnd <= Math.max(need * 3, 9); rnd++) {
  console.log(`\n${'#'.repeat(60)}\n# FULL VERIFY ROUND ${rnd} (streak ${streak}/${need})\n${'#'.repeat(60)}`);
  let clean = true;
  const unit = unitChecks();
  if (unit.length) {
    clean = false;
    console.log('UNIT FAIL:\n  ' + unit.join('\n  '));
  } else {
    console.log('UNIT OK');
  }
  for (const g of gates) {
    const r = runGate(g);
    if (r.ok) console.log(`OK  ${g}`);
    else { clean = false; console.log(`FAIL ${g}\n${r.out}`); }
  }
  if (clean) {
    streak += 1;
    console.log(`\n>>> ROUND ${rnd} CLEAN streak=${streak}/${need}`);
    if (streak >= need) {
      console.log('FULL_VERIFY_3X_PASSED');
      process.exit(0);
    }
  } else {
    streak = 0;
    console.log(`\n>>> ROUND ${rnd} FAILED`);
  }
}
console.log('FULL_VERIFY_FAILED');
process.exit(1);
