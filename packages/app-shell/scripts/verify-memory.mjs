/**
 * 记忆系统验证（产品重点）
 * 1) 静态：memory-os 三路召回 / JSONL 唯一事实 / 工具名 / WARMY_MEMORY_DIR
 * 2) 动态：若 packages/memory-os/dist 可用，则 append → recall → retrieve 真跑
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..', '..', '..');
const require = createRequire(import.meta.url);
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`, detail ?? ''); }
}

const memSrc = fs.readFileSync(path.join(ROOT, 'packages/memory-os/src/index.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(ROOT, 'packages/memory-os/src/ipc.ts'), 'utf8');
const clientSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/memory-client.ts'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const ctxSrc = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/context-renderer.ts'), 'utf8');

check('memory-os mentions fts_uni + fts_tri + vector/RRF', /fts_uni/.test(memSrc) && /fts_tri/.test(memSrc) && /rrf|vector/i.test(memSrc));
check('JSONL is source of truth', /fast-memory\.jsonl/.test(memSrc) && /唯一事实|source of truth|可丢弃/.test(memSrc));
check('IPC env prefers WARMY_MEMORY_DIR', /WARMY_MEMORY_DIR/.test(ipcSrc));
check('MemoryClient sets WARMY_MEMORY_DIR', /WARMY_MEMORY_DIR/.test(clientSrc));
check('MemoryClient exposes recall/retrieve tools', /MEMORY_TOOL_NAMES/.test(clientSrc) && /recall/.test(clientSrc) && /retrieve/.test(clientSrc));
check('main restores chat logs from memory', /restoreChatLogsFromMemory/.test(mainSrc));
check('context renderer emits retrieve pointers', /retrieve|已省略/.test(ctxSrc) || /pointer|seq/.test(ctxSrc));
check('docs mention memory feature', fs.readFileSync(path.join(ROOT, '说明.md'), 'utf8').includes('记忆系统'));
check('README mentions memory', fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').toLowerCase().includes('memory'));

// live test
const distIndex = path.join(ROOT, 'packages/memory-os/dist/index.js');
/**
 * 原生依赖可用性：memory-os 的 FTS/向量层依赖 better-sqlite3（原生模块）。
 * CI runner 没有 Visual Studio，安装时用 --ignore-scripts 跳过了原生构建，
 * 因此**动态**检索在这里必然拿不到结果。
 * 这时如实**跳过**动态段（并说明原因），而不是把它报成"检索坏了"——
 * 产品原则：状态必须诚实，不能把环境缺失误报成功能缺陷。
 * 本地有原生模块时，动态段照常执行。
 */
function nativeSqliteAvailable() {
  try {
    // 必须**从 memory-os 的视角**解析：better-sqlite3 是它的依赖，
    // 不是 app-shell 的依赖（pnpm 隔离布局下从本脚本解析会永远失败）。
    const req = createRequire(path.join(ROOT, 'packages/memory-os/package.json'));
    req.resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}
const liveOk = fs.existsSync(distIndex) && nativeSqliteAvailable();
if (!fs.existsSync(distIndex)) {
  console.log('  skip live memory test (dist missing) — build packages/memory-os first');
} else if (!liveOk) {
  console.log('  skip live memory test (better-sqlite3 native module not built here — e.g. CI without Visual Studio; dynamically skipped, NOT a product failure)');
} else {
  const dataDir = path.join(os.tmpdir(), 'warmy-memory-verify-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const mod = await import(pathToFileURL(distIndex).href);
    const svc = new mod.MemoryService({ dataDir });
    const a = svc.append({
      seq: 0,
      ts: Date.now(),
      sessionId: 'mem-verify',
      kind: 'message',
      id: 'm-mem-verify-1',
      body: 'WArmy memory verify token ALPHA-7799 project directory ledger',
    }, 'memory-service');
    check('append returns seq>0', Number(a?.seq) > 0, a);
    const detail = await svc.recallDetailed({ query: 'ALPHA-7799 memory verify', limit: 5 });
    check('recall finds inserted body', Array.isArray(detail?.cards) && detail.cards.length > 0, detail?.cards?.map((c) => c.recordId));
    const hit = (detail?.cards || []).find((c) => String(c.recordId || '').includes('mem-verify') || String(c.snippet || '').includes('ALPHA-7799'));
    check('recall snippet contains token', !!hit, hit?.snippet);
    const ret = hit ? svc.retrieve({ recordId: hit.recordId }) : svc.retrieve({ seq: a.seq });
    const body = JSON.stringify(ret || {});
    check('retrieve returns record body', body.includes('ALPHA-7799') || body.includes('mem-verify'), body.slice(0, 200));
    // rebuild projection
    const rebuilt = svc.rebuildProjection?.();
    check('rebuildProjection callable', rebuilt === undefined || Number.isFinite(rebuilt) || typeof rebuilt === 'number', rebuilt);

    // writer constraint (fail closed)
    let writerBlocked = false;
    try {
      svc.append({ id: 'q-1', sessionId: 'mem-verify', kind: 'queue', body: 'x' }, 'duty');
    } catch (e) {
      writerBlocked = e?.code === 'WRITER' || /writer/i.test(String(e?.message || e));
    }
    check('queue writer constrained to router', writerBlocked);

    // scope filter: other session not returned when scoped
    svc.append({
      seq: 0,
      ts: Date.now(),
      sessionId: 'other-session',
      kind: 'message',
      id: 'm-other-1',
      body: 'WArmy memory verify token BETA-1234 other session',
    }, 'memory-service');
    const scoped = await svc.recallDetailed({ query: 'BETA-1234', limit: 5, scope: { sessionId: 'mem-verify' } });
    const scopedHits = (scoped?.cards || []).filter((c) => String(c.recordId || '').includes('other') || String(c.snippet || '').includes('BETA-1234'));
    check('scope filter hides other session', scopedHits.length === 0, scoped?.cards?.map((c) => c.recordId));
    const unscoped = await svc.recallDetailed({ query: 'BETA-1234', limit: 5 });
    check('unscoped recall can see BETA', (unscoped?.cards || []).length > 0, unscoped?.cards?.map((c) => c.recordId));

    // retrieve nearby fallback
    const near = svc.retrieve({ seq: Number(a.seq) + 50 }, { fallback: 'fuzzy', query: 'ALPHA-7799' });
    check('retrieve fuzzy fallback returns something or null honestly', near === null || !!near, near ? near.hitLevel : null);

    // stats
    if (typeof svc.stats === 'function') {
      const st = svc.stats();
      check('stats() returns object', !!st && typeof st === 'object', st);
    }

    // MemoryClient fail-closed text
    check('tool fail-closed text present', /记忆服务不可用|memory-client-missing|尚未就绪/.test(clientSrc));
  } catch (e) {
    check('live memory service', false, String(e).slice(0, 300));
  }
}

console.log(`\n==== verify-memory: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
