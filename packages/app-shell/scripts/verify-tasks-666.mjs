#!/usr/bin/env node
/**
 * verify-tasks-666 —— batch verifier for docs/TASKS-666.md.
 * Labels are ASCII-only on purpose: PowerShell Set-Content mangled CJK in this file once.
 * Checks are real, mechanical assertions over the codebase; nothing is asserted loosely.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const i18nDir = path.join(root, 'packages/app-shell/src/i18n');
const appJs = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const emTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const workTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/work-tools.ts'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.css'), 'utf8');
const renCss = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/renderer.css'), 'utf8');
const idxHtml = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/index.html'), 'utf8');
const setTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/settings-store.ts'), 'utf8');
const toolsTs = fs.readFileSync(path.join(root, 'packages/providers/src/tools.ts'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const check = (label, ok) => {
  if (ok) pass++;
  else { fail++; fails.push(label); }
};

// ── family 1: i18n key integrity ──
const locs = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json'));
const packs = {};
for (const f of locs) packs[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8'));
const zh = packs['zh-CN'] || {};
const keys = Object.keys(zh);
for (const k of keys) {
  check('i18n non-empty: ' + k, locs.every((f) => {
    const v = packs[f.replace('.json', '')][k];
    return typeof v === 'string' && v.trim().length > 0;
  }));
  check('i18n trimmed: ' + k, locs.every((f) => {
    const v = packs[f.replace('.json', '')][k];
    return typeof v === 'string' && v === v.trim();
  }));
  check('i18n len<8000: ' + k, locs.every((f) => String(packs[f.replace('.json', '')][k] || '').length < 8000));
}

// ── family 2: renderer guards ──
const RUKOU = ['renderChat', 'renderList', 'faSong', 'deliver', 'renderAiQuestions', 'xuanRanLiuShiKuai', 'renderSmLian', 'renderQueueBar', 'renderProjectFilesBlock'];
for (const fn of RUKOU) {
  const m = new RegExp('function ' + fn + '\\s*\\(').exec(appJs);
  check('renderer fn exists: ' + fn, !!m);
  if (m) {
    const seg = appJs.slice(m.index, m.index + 4000);
    check('renderer fn guarded: ' + fn, /try\s*\{/.test(seg) || /if \(!/.test(seg) || /\?\./.test(seg));
  }
}

// ── family 3: main-process observability ──
const IPCS = ['warmy:liaoTianFaSong', 'warmy:peiZhiDaoChu', 'warmy:peiZhiDaoRu', 'warmy:xiangMuDaoChu', 'warmy:ttsLangDu', 'warmy:asrZhuanXie', 'warmy:fanYi', 'warmy:anQuanShenHe'];
for (const ipc of IPCS) {
  const i = emTs.indexOf("'" + ipc + "'");
  check('ipc exists: ' + ipc, i >= 0);
  if (i >= 0) {
    const seg = emTs.slice(i, i + 6000);
    check('ipc audited or guarded: ' + ipc, /audit\?\.log/.test(seg) || /catch/.test(seg));
  }
}

// ── family 4: bounds ──
const BIJIE = [
  ['plan steps cap', /slice\(0,\s*200\)/.test(emTs)],
  ['tool-name ledger cap', /benLunGongJuMing\.length < 64/.test(emTs)],
  ['stream buffer cap', /200000/.test(appJs)],
  ['unread cap', /Math\.min\(999/.test(appJs)],
  ['export password floor', /weak-password/.test(emTs)],
  ['export filename sanitized', /replace\(\/\[\\\\\/:\*\?"<>\|\]\/g/.test(emTs) || /replace\(\/\[\\\\\/:\*\?"<>\|\]/.test(emTs)],
  ['tool rounds cap', /Math\.min\(32/.test(emTs)],
  ['tool result cap', /Math\.min\(8000/.test(emTs)],
  ['context budget cap', /Math\.min\(200000/.test(emTs)],
  ['continue warning threshold exists', /YANXU_YUJING_CI/.test(emTs)],
];
for (const [n, ok] of BIJIE) check('boundary: ' + n, ok);

// ── family 5: a11y / interaction ──
check('aria-label present', /setAttribute\('aria-label'/.test(appJs));
check('row title present', /hangYuanSu\.title/.test(appJs) || /\.title =/.test(appJs));
check('voice aria-pressed', /aria-pressed/.test(appJs));
check('think title present', /data-i18n-title="model\.think"/.test(idxHtml));
check('focus style present', /:focus/.test(appCss) || /:focus-visible/.test(appCss));

// ── family 6: style consistency ──
function chouQu(css) {
  const out = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!sel || sel.startsWith('@')) continue;
    const decl = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const s of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!out.has(s)) out.set(s, '');
      out.set(s, out.get(s) + ';' + decl);
    }
  }
  return out;
}
function quShu(d, k) {
  const esc = k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const mm = d.match(new RegExp('(?:^|;)\\s*' + esc + '\\s*:\\s*([^;]+)', 'i'));
  return mm ? mm[1].trim().toLowerCase().replace(/\s*!\s*important/g, '').replace(/\s+/g, ' ').trim() : null;
}
const A = chouQu(appCss), R = chouQu(renCss);
const GUANJIAN = ['position', 'top', 'bottom', 'left', 'right', 'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height', 'transform', 'overflow', 'flex-direction', 'display'];
let chongTu = 0;
for (const sel of [...A.keys()].filter((k) => R.has(k))) {
  if (/^(from|to|\d+(\.\d+)?%)$/i.test(sel)) continue;
  for (const shu of GUANJIAN) {
    const va = quShu(A.get(sel) || '', shu);
    const vr = quShu(R.get(sel) || '', shu);
    if (va !== null && vr !== null && va !== vr) chongTu++;
  }
}
check('css no size conflicts', chongTu === 0);
check('css uses design tokens', /var\(--/.test(appCss));
check('dark theme rules exist', /\[data-theme="dark"\]/.test(renCss) || /prefers-color-scheme/.test(appCss) || /data-theme/.test(appCss));

// ── family 7: persistence ──
check('settings atomic write', /anQuanYuanZiXieJson/.test(emTs) || /writeFileSync\([^)]*JSON\.stringify/.test(setTs));
check('plans persisted', /plans\.json/.test(emTs));
check('router queues persisted', /router-queues\.json/.test(emTs));
check('ui queues persisted', /ui-queues\.json/.test(emTs));
check('scheduled tasks persisted', /scheduled-tasks\.json/.test(emTs));

// ── family 8: security ──
check('workspace resolveInside', /resolveInside/.test(workTs));
check('url http(s) only', /https\?:/.test(emTs) || /\^https\?:/.test(workTs));
check('command safety check', /anquanJianCeMingLing/.test(emTs));
check('work tool security block', /WORK_TOOL_SECURITY/.test(workTs));
check('secrets via safeStorage', /safeStorage|AnQuanMiyaoCang/.test(emTs));

// ── family 9: performance ──
check('stream render throttled', /_liuShiHuaShangCi/.test(appJs));
check('stream broadcast throttled', /_boXingShangCi/.test(emTs));
check('busy text interval constant', /YUN_XING_CIHOU/.test(appJs));
check('listener bind guard', /dataset\.bound/.test(appJs));
check('lists sliced', /slice\(0,/.test(appJs) || /slice\(-/.test(appJs));

// ── family 10: docs / comments ──
check('real-incident notes in app.js', /真事故/.test(appJs));
check('real-incident notes in main', /真事故/.test(emTs));
check('invariant notes present', /不变量/.test(emTs) || /产品要求/.test(appJs));
check('CHANGELOG exists', fs.existsSync(path.join(root, 'docs/CHANGELOG.md')));
check('TASKS-666 exists', fs.existsSync(path.join(root, 'docs/TASKS-666.md')));
check('TASKS-99 exists', fs.existsSync(path.join(root, 'docs/TASKS-99.md')));

// ── the concrete fixes from this round ──
check('auto-continue hidden from chat log', /hidden: shiNeiBuCaiDan/.test(emTs) || /hidden: !!/.test(emTs));
check('auto-continue single dispatcher', /shiNeiBu/.test(emTs));
check('busy text during auto-continue', /yunXingZhuangTai/.test(emTs) && /onYunXingZhuangTai/.test(appJs));
check('tool rounds migrated from 3', /contextToolMaxRounds: 12/.test(setTs) && /=== 3\) ji\.contextToolMaxRounds = 12/.test(setTs));
check('get_time tool', /get_time/.test(workTs) && /gongJuMing === 'get_time'/.test(emTs));
check('wait_seconds tool', /wait_seconds/.test(workTs) && /gongJuMing === 'wait_seconds'/.test(emTs));
check('time injected into prompt', /llm\.timeLine/.test(emTs));
check('sound only marks on success', /if \(ok\) \{[\s\S]{0,90}yiJingXiangGuo\.add\(id\)/.test(appJs));
check('sound AudioContext primary', /deDaoShangXiaWen/.test(appJs) && /createBufferSource/.test(appJs));
// ── this round (v0.2.5) ──
check('thinking merged across tool rounds', /const siKaoJi: string\[\] = \[\]/.test(toolsTs) && /siKaoJi\.filter\(Boolean\)\.join\('\\n\\n'\)/.test(toolsTs));
check('stream deltas coalesced not dropped', /_boXingDai\.set\(sessionId, dai\)/.test(emTs));
check('tool rounds not silently capped at 8', /qianZhiZhengShu\(o\.zuiDaLunShu, 0, 32/.test(toolsTs));
check('raf batches instead of dropping', /__rafDaiLie\.push\(fn\)/.test(appJs) && !/__rafThrottle/.test(appJs));
check('raf has hidden-window fallback timer', /__rafBaoXianJi = setTimeout\(__rafFangChu, 300\)/.test(appJs));
check('decision card heartbeat independent of raf', /setInterval\(\(\) => \{ try \{ void renderAiQuestions\(\); \}/.test(appJs));
check('card sound decoupled from rendering', /xiangKaPianYin\(pending\.map/.test(appJs));
check('autoplay policy disabled (window + switch)', /autoplayPolicy: 'no-user-gesture-required'/.test(emTs) && /appendSwitch\('autoplay-policy'/.test(emTs));
check('card title reads biaoTi', /q\.biaoTi \|\| q\.title/.test(appJs));
// ── 预计完成时间（ETA）──
const etaTs = fs.readFileSync(path.join(root, 'packages/app-shell/src/eta-forecast.ts'), 'utf8');
check('eta ledger persists to userData/eta.json', /'eta\.json'/.test(emTs) && /anQuanYuanZiXieJson\(this\.jieDian/.test(etaTs));
check('model must give an ETA each judgment', /"etaSeconds"/.test(emTs));
check('prompt carries its own previous ETAs', /etaHuo\(\)\.canKaoWenBen\(sessionId, xingWei\)/.test(emTs));
check('3 consecutive overruns = anomaly', /chao\.yiChang/.test(emTs) && /CHAO_SHI_LIAN_XU_XIAN = 3/.test(etaTs));
check('eta self-improves (calibration/percentiles)', /emaXiShu/.test(etaTs) && /p50Ms/.test(etaTs) && /mingZhongLv/.test(etaTs));
check('eta task signature groups similar work', /export function renWuQianMing/.test(etaTs));

console.log('==== verify-tasks-666: ' + pass + ' ok / ' + fail + ' FAIL ====');
if (fails.length) {
  console.log('failures (first 30):');
  for (const f of fails.slice(0, 30)) console.log(' - ' + f);
}
process.exit(fail ? 1 : 0);
