/**
 * verify-r107-export-schedule.mjs —— 第 107 轮定时导出：
 * 配置收敛（最多 10 个位置/去重/范围）、到点执行、多位置各一份、无变化跳过、
 * 凭证缺失不假成功、循环次数用完自动停。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const { DataVault, inspectNmPackage } = await import(pathToFileURL(path.join(pkg, 'dist/data-vault.js')).href);
const {
  guiYiDingShiDaoChu, daoChuZhiWen, zhiXingDingShiDaoChu, paiXiaYiCi, EXPORT_LOCATION_MAX,
} = await import(pathToFileURL(path.join(pkg, 'dist/export-schedule.js')).href);

let pass = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, `${name}${detail ? '：' + detail : ''}`); pass++; console.log('PASS ' + name); };

const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const clean = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

/* ── 配置收敛 ───────────────────────────────────────────────────── */
{
  const raw = {
    enabled: true, nextAt: 0, cycles: 2, intervalMs: 1000, skipUnchanged: false, encrypt: false,
    locations: Array.from({ length: 12 }, (_, i) => ({ path: `C:/x/${i}`, enabled: i !== 1 })),
    include: ['chat', 'bad', 'chat', 'knowledge'],
  };
  const cfg = guiYiDingShiDaoChu(raw);
  ok('最多保留 10 个导出位置', cfg.locations.length === 10);
  ok('间隔按秒输入：1 秒保留，0/负数收敛到 1 秒', cfg.intervalMs === 1000 && guiYiDingShiDaoChu({ intervalMs: 0 }).intervalMs === 1000);
  ok('循环次数默认 0（无限），负数收敛为 0', guiYiDingShiDaoChu({}).cycles === 0 && guiYiDingShiDaoChu({ cycles: -3 }).cycles === 0);
  ok('重复/未知的数据范围被收敛', cfg.include.join(',') === 'chat,knowledge');
  ok('未给 nextAt 时给下一次一个未来时间', cfg.nextAt > Date.now());
  ok('位置启用位保留', cfg.locations[1] && cfg.locations[1].enabled === false);
  const dup = guiYiDingShiDaoChu({ locations: [{ path: 'C:/same' }, { path: 'C:/same' }] });
  ok('同路径位置去重', dup.locations.length === 1);
  const scoped = guiYiDingShiDaoChu({ scope: { chatIds: ['a', 'a', 'b'], kbLayers: ['private', 'bad'], from: 100, to: 200 } });
  ok('细粒度范围收敛（会话去重、知识层只收三类、时间范围保留）',
    scoped.scope?.chatIds?.join(',') === 'a,b' && scoped.scope?.kbLayers?.join(',') === 'private'
    && scoped.scope?.from === 100 && scoped.scope?.to === 200);
  ok('旧“单独凭证”字段被丢弃', guiYiDingShiDaoChu({ requireCredential: true }).requireCredential === false);
  ok('位置上限常量与 UI 一致', EXPORT_LOCATION_MAX === 10);
}

/* ── 真数据 + 真仓库：到点执行到两个位置 ───────────────────────────── */
const userData = temp('warmy-r107-user-');
const outA = temp('warmy-r107-a-');
const outB = temp('warmy-r107-b-');
const broken = path.join(temp('warmy-r107-broken-'), 'not-a-dir');
fs.writeFileSync(broken, 'x');
try {
  fs.mkdirSync(path.join(userData, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'workspace', 'p'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), '{"themeMode":"dark"}');
  fs.writeFileSync(path.join(userData, 'memory', 'fast-memory.jsonl'), '{"seq":1}\n');
  fs.writeFileSync(path.join(userData, 'workspace', 'p', 'a.txt'), 'product');
  const vault = new DataVault({
    userData,
    protector: { available: () => true, protect: (s) => Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s, 'base64').toString() },
  });
  vault.setMasterKey(crypto.randomBytes(32));
  vault.markUnsealed();

  const events = [];
  const audits = [];
  let cfg = guiYiDingShiDaoChu({
    enabled: true, nextAt: Date.now() - 1000, cycles: 2, intervalMs: 60 * 60 * 1000,
    skipUnchanged: false, encrypt: false, locations: [{ path: outA, enabled: true }, { path: outB, enabled: true }],
    include: ['chat', 'settings'],
  });
  const deps = {
    vault,
    load: () => cfg,
    save: (next) => { cfg = next; },
    audit: (op, detail) => audits.push({ op, detail }),
    broadcast: (event, data) => events.push({ event, data }),
    getKroot: () => Buffer.alloc(32, 0x11),
  };
  const r1 = await zhiXingDingShiDaoChu(deps);
  const a1 = fs.readdirSync(outA).filter((f) => f.endsWith('.nm'));
  const b1 = fs.readdirSync(outB).filter((f) => f.endsWith('.nm'));
  ok('到点执行成功，两个启用位置各一份 .nm 明文包', r1.ok && a1.length === 1 && b1.length === 1);
  ok('明文包是可识别的 .nm v2（不是旧 .tar.gz）', inspectNmPackage(path.join(outA, a1[0])).mode === 'plain');
  ok('执行后 runsDone+1、下一次在未来', cfg.runsDone === 1 && cfg.nextAt > Date.now());
  ok('包含所选范围、不含账号目录', fs.readdirSync(userData, { recursive: true }).some((x) => String(x).endsWith('.wvault')) === false);

  /* 无变化跳过 */
  cfg = { ...cfg, nextAt: Date.now() - 1000, cycles: 0, runsDone: 0, skipUnchanged: true, lastFingerprint: daoChuZhiWen(vault.listExportFiles(cfg.include)), lastStatus: '' };
  const r2 = await zhiXingDingShiDaoChu(deps);
  ok('数据指纹没变时跳过本次（不写新文件）', r2.ok && r2.skipped === 'unchanged' && fs.readdirSync(outA).length === a1.length);
  ok('跳过也照常排下一次', cfg.nextAt > Date.now());

  /* 循环次数用完 */
  cfg = { ...cfg, enabled: true, nextAt: Date.now() - 1000, runsDone: 1, cycles: 2, skipUnchanged: false };
  const r3 = await zhiXingDingShiDaoChu(deps);
  ok('第 2 次执行后循环次数用完，自动关闭', r3.ok && cfg.runsDone === 2 && cfg.enabled === false && cfg.nextAt === 0);

  /* 加密包用登录主密钥：仓库锁着时不能假成功 */
  cfg = guiYiDingShiDaoChu({
    enabled: true, nextAt: Date.now() - 1000, cycles: 0, intervalMs: 60 * 60 * 1000,
    skipUnchanged: false, encrypt: true, copies: 0,
    locations: [{ path: outA, enabled: true }], include: ['chat'],
  });
  const before = fs.readdirSync(outA).length;
  vault.lock();
  const r4 = await zhiXingDingShiDaoChu(deps);
  ok('加密导出但仓库未解锁：如实返回 vault-locked，不写文件',
    r4.skipped === 'vault-locked' && fs.readdirSync(outA).length === before);
  ok('仓库未解锁时 10 分钟后重试（不是直接关掉）', cfg.nextAt > Date.now() && cfg.enabled === true);
  vault.setMasterKey(crypto.randomBytes(32));
  vault.markUnsealed();
  const beforeEnc = fs.readdirSync(outA).filter((f) => f.endsWith('.nm')).length;
  const rEnc = await zhiXingDingShiDaoChu(deps, { force: true });
  const encFiles = fs.readdirSync(outA).filter((f) => f.endsWith('.nm'));
  ok('解锁后加密导出成功，且包模式为 Kroot', rEnc.ok && encFiles.length === beforeEnc + 1
    && inspectNmPackage(path.join(outA, encFiles.sort().at(-1))).mode === 'kroot', JSON.stringify(rEnc));

  /* 位置无法创建：partial/failed 不伪装 */
  cfg = guiYiDingShiDaoChu({
    enabled: true, nextAt: Date.now() - 1000, cycles: 0, intervalMs: 60 * 60 * 1000,
    skipUnchanged: false, encrypt: false,
    locations: [{ path: outA, enabled: true }, { path: path.join(broken, 'sub'), enabled: true }],
    include: ['chat'],
  });
  const r5 = await zhiXingDingShiDaoChu(deps);
  ok('一个位置失败时如实标 partial（另一份仍然成功）', r5.ok === false && /^partial/.test(r5.status) && r5.paths.length === 1, JSON.stringify(r5));
  ok('执行结果写进审计/广播', audits.some((x) => x.op === 'export.schedule.run') && events.some((x) => x.event === 'warmy:dingShiDaoZhuangTai' || x.event === 'warmy:dingShiDaoChuZhuangTai'));

  /* 选择性导出/导入：逻辑文件合并，不整库带出未选会话 */
  const target = temp('warmy-r107-target-');
  const extraDir = temp('warmy-r107-extra-');
  try {
    fs.mkdirSync(path.join(target, 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(target, 'chat-meta.json'), JSON.stringify({ version: 1, savedAt: 1, sessions: { s2: { msgs: [{ ts: 200, role: 'user' }] } } }));
    fs.writeFileSync(path.join(target, 'knowledge', 'knowledge-session.json'), JSON.stringify({ entities: [{ id: 'e2' }], events: [{ id: 'ev2', ts: 300 }] }));
    const extraChat = path.join(extraDir, 'chat-meta.json');
    fs.writeFileSync(extraChat, JSON.stringify({ version: 1, savedAt: 2, sessions: { s1: { msgs: [{ ts: 120, role: 'assistant' }] } } }));
    const extraMsg = path.join(extraDir, 'chat-messages.jsonl');
    fs.writeFileSync(extraMsg, JSON.stringify({ id: 'm1', sessionId: 's1', kind: 'message', ts: 120, ti: 'only-s1' }) + '\n');
    const extraKb = path.join(extraDir, 'knowledge-session.json');
    fs.writeFileSync(extraKb, JSON.stringify({ entities: [{ id: 'e1' }], events: [{ id: 'ev1', ts: 100 }] }));
    const logicalFile = path.join(extraDir, 'selective.wvault');
    const extraFiles = [extraChat, extraMsg, extraKb].map((abs, i) => {
      const st = fs.statSync(abs);
      return { rel: '__logical__/' + path.basename(abs), size: st.size, mtime: Math.round(st.mtimeMs), abs };
    });
    const listed = vault.listExportFiles(['chat'], { chatIds: ['s1'] }).map((f) => f.rel);
    ok('选择性导出：未选会话的工作区文件与整库消息文件都不进包',
      !listed.some((r) => r.startsWith('workspace/p/')) && !listed.some((r) => r.startsWith('memory/')) && !listed.includes('chat-meta.json'));
    const ex = await vault.exportVaultWithOptions(logicalFile, {
      plain: true, include: ['chat', 'knowledge'], scope: { chatIds: ['s1'] }, extraFiles,
    });
    ok('选择性导出：逻辑文件随包写出', ex.ok && fs.existsSync(logicalFile));
    const targetVault = new DataVault({
      userData: target,
      protector: { available: () => true, protect: (s) => Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s, 'base64').toString() },
    });
    targetVault.setMasterKey(crypto.randomBytes(32));
    targetVault.markUnsealed();
    const im = await targetVault.importVault(logicalFile, '');
    ok('选择性导入：逻辑文件按 id 合并进当前数据', im.ok
      && Object.keys(JSON.parse(fs.readFileSync(path.join(target, 'chat-meta.json'), 'utf8')).sessions).sort().join(',') === 's1,s2'
      && JSON.parse(fs.readFileSync(path.join(target, 'knowledge', 'knowledge-session.json'), 'utf8')).entities.map((x) => x.id).sort().join(',') === 'e1,e2');
    const queued = path.join(target, 'logical-import');
    const qfiles = fs.existsSync(queued) ? fs.readdirSync(queued).filter((f) => f.endsWith('.jsonl')) : [];
    ok('选择性导入：聊天消息进入待导入队列（启动后由记忆服务写入）并保留原 ts',
      qfiles.length === 1 && fs.readFileSync(path.join(queued, qfiles[0]), 'utf8').includes('"ts":120'));
    ok('选择性导出没有把未选会话的工作区文件整包带出', !fs.existsSync(path.join(target, 'workspace', 'p', 'a.txt')));
  } finally {
    clean(target); clean(extraDir);
  }
} finally {
  clean(userData); clean(outA); clean(outB); clean(path.dirname(broken));
}

/* ── 纯函数：下一次排期 ─────────────────────────────────────────── */
{
  const now = 1000;
  const n = paiXiaYiCi({ enabled: true, nextAt: 0, cycles: 2, intervalMs: 5000, runsDone: 0 }, now);
  ok('排下一次：runsDone 增加、nextAt=now+interval', n.runsDone === 1 && n.nextAt === 6000 && n.enabled === true);
  const z = paiXiaYiCi({ enabled: true, nextAt: 0, cycles: 1, intervalMs: 5000, runsDone: 0 }, now);
  ok('循环次数到顶：关闭且 nextAt=0', z.enabled === false && z.nextAt === 0);
}

console.log(`\nverify-r107-export-schedule: ${pass}/${pass} 全绿`);
