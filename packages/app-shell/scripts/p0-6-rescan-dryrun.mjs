/**
 * P0-6 历史会话库重扫 —— **dry-run（只读报告，不改任何数据）**
 *
 * 用法：
 *   node packages/app-shell/scripts/p0-6-rescan-dryrun.mjs [--data <userData 目录>] [--json]
 *   node packages/app-shell/scripts/p0-6-rescan-dryrun.mjs --self-test
 *
 * 默认扫描 `%APPDATA%\@warmy\app-shell\knowledge\knowledge-session.json`。
 * 只检查「派生概要」（laiYuan === 'derived:redaction'）以及长得像固定句式的未标记条目；
 * 原始聊天/工具事件不在此脚本的处理范围内（它们不是对外概要，不能被当成泄露证据删掉）。
 * 输出每个不合格条目的 id / 标题 / 检查器原因，供人看过之后再决定是否执行替换。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FM = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/zhi-shi-fen-ceng.js')).href);
const argv = process.argv.slice(2);
const ziJian = argv.includes('--self-test');
const shuChuJson = argv.includes('--json');
const dataArg = (() => {
  const i = argv.indexOf('--data');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
})();
const userData = dataArg || path.join(process.env.APPDATA || os.homedir(), '@warmy', 'app-shell');
const summaryRe = /^我们可以做这些类型的事：.*。（这是能力类别清单，不含具体项目、时间、对象与做法。）$/;

function scanDir(dir) {
  const file = path.join(dir, 'knowledge', 'knowledge-session.json');
  let store = null;
  try { store = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no file */ }
  const events = Array.isArray(store && store.events) ? store.events : [];
  const derived = [];
  const untagged = [];
  const raw = [];
  for (const e of events) {
    const result = String((e && e.result) || '').trim();
    const isDerived = e && e.laiYuan === 'derived:redaction';
    const looksSummary = summaryRe.test(result);
    if (isDerived) {
      const chk = FM.jianChaGaiLao(result, result);
      derived.push({ id: String(e.id || ''), title: String(e.biaoTi || ''), ok: !!chk.ok, why: chk.why || [] });
    } else if (looksSummary) {
      const chk = FM.jianChaGaiLao(result, result);
      untagged.push({ id: String(e.id || ''), title: String(e.biaoTi || ''), ok: !!chk.ok, why: chk.why || [] });
    } else {
      raw.push(String(e && e.id || ''));
    }
  }
  return { file, exists: !!store, total: events.length, derived, untagged, raw };
}

function report(r) {
  const badDerived = r.derived.filter((x) => !x.ok);
  const badUntagged = r.untagged.filter((x) => !x.ok);
  const out = {
    file: r.file,
    exists: r.exists,
    total: r.total,
    derived: r.derived.length,
    derivedOk: r.derived.length - badDerived.length,
    derivedBad: badDerived.length,
    untaggedSummaries: r.untagged.length,
    untaggedBad: badUntagged.length,
    rawEventsUntouched: r.raw.length,
    failures: [...badDerived, ...badUntagged].slice(0, 20).map((x) => ({ id: x.id, title: x.title, why: x.why })),
  };
  if (shuChuJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('P0-6 历史会话库重扫 · dry-run（只读）');
    console.log('  文件：' + r.file + (r.exists ? '' : '（不存在，按 0 条处理）'));
    console.log('  事件总数：' + r.total + '；派生概要 ' + r.derived.length + '（合格 ' + out.derivedOk + ' / 不合格 ' + out.derivedBad + '）');
    console.log('  未标记但长得像固定概要：' + r.untagged.length + '（不合格 ' + out.untaggedBad + '）');
    console.log('  原始事件（本脚本不处理）：' + r.raw.length);
    if (out.failures.length) {
      console.log('  不合格样例（前 ' + out.failures.length + ' 条）：');
      for (const f of out.failures) console.log('   · ' + f.id + ' 「' + f.title + '」 ← ' + f.why.join('；'));
    }
    console.log('  说明：dry-run 不修改任何数据；确认报告后才执行替换。');
  }
  return out;
}

if (ziJian) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-p06-rescan-'));
  const hua = FM.NENG_LI_BIAO[0].hua;
  const good = '我们可以做这些类型的事：' + hua + '。（这是能力类别清单，不含具体项目、时间、对象与做法。）';
  const bad = '我们可以做这些类型的事：' + hua + '。（这是能力类别清单，报价 3 万元，不含具体项目与做法。）';
  fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'knowledge', 'knowledge-session.json'), JSON.stringify({
    entities: [],
    events: [
      { id: 'd1', biaoTi: 'a', result: good, laiYuan: 'derived:redaction' },
      { id: 'd2', biaoTi: 'b', result: bad, laiYuan: 'derived:redaction' },
      { id: 'u1', biaoTi: 'c', result: good },
      { id: 'r1', biaoTi: 'd', result: '普通聊天记录 123' },
    ],
  }), 'utf8');
  const r = report(scanDir(dir));
  const ok = r.exists && r.total === 4 && r.derived === 2 && r.derivedOk === 1 && r.derivedBad === 1
    && r.untaggedSummaries === 1 && r.untaggedBad === 0 && r.rawEventsUntouched === 1;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  console.log(ok ? 'SELF-TEST PASS' : 'SELF-TEST FAIL');
  process.exit(ok ? 0 : 1);
}

if (!fs.existsSync(userData)) {
  console.error('数据目录不存在：' + userData);
  process.exit(2);
}
report(scanDir(userData));
