/**
 * verify-r113-export-retention.mjs —— 定时导出任务编号 + 副本保留：
 * .nm 明文头可读 scheduleId；同任务旧包在成功导出后清理；copies 默认 1、0=不清理；
 * 不误删其它任务/没有编号的 .nm。
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
const { guiYiDingShiDaoChu, zhiXingDingShiDaoChu } = await import(pathToFileURL(path.join(pkg, 'dist/export-schedule.js')).href);

let pass = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, `${name}${detail ? '：' + detail : ''}`); pass++; console.log('PASS ' + name); };
const temp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const clean = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

/* 配置收敛 */
ok('副本数默认 1，0 保留，负数收敛到 0，小数向下取整',
  guiYiDingShiDaoChu({}).copies === 1 && guiYiDingShiDaoChu({ copies: 0 }).copies === 0
  && guiYiDingShiDaoChu({ copies: -3 }).copies === 0 && guiYiDingShiDaoChu({ copies: 2.9 }).copies === 2);
ok('任务编号原样保留并限长', guiYiDingShiDaoChu({ scheduleId: 'task-A' }).scheduleId === 'task-A'
  && guiYiDingShiDaoChu({ scheduleId: 'x'.repeat(120) }).scheduleId.length === 80);

const userData = temp('warmy-r113-user-');
const out = temp('warmy-r113-out-');
try {
  fs.mkdirSync(path.join(userData, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), '{"themeMode":"dark"}');
  const vault = new DataVault({
    userData,
    protector: { available: () => true, protect: (s) => Buffer.from(s).toString('base64'), unprotect: (s) => Buffer.from(s, 'base64').toString() },
  });
  vault.setMasterKey(crypto.randomBytes(32));
  vault.markUnsealed();

  /* 明文包的 scheduleId 不解密可读 */
  const one = path.join(out, 'manual-task-a.nm');
  const er = await vault.exportNm(one, { plain: true, include: ['settings'], scheduleId: 'task-A' });
  const ins = inspectNmPackage(one);
  ok('明文 .nm 头携带可读 scheduleId', er.ok && ins.ok && ins.scheduleId === 'task-A', JSON.stringify(ins));

  /* 其它任务 / 无编号文件不能被误删 */
  const other = path.join(out, 'manual-task-b.nm');
  const anon = path.join(out, 'manual-anon.nm');
  await vault.exportNm(other, { plain: true, include: ['settings'], scheduleId: 'task-B' });
  await vault.exportNm(anon, { plain: true, include: ['settings'] });

  let cfg = guiYiDingShiDaoChu({
    scheduleId: 'task-A', copies: 2, enabled: true, nextAt: Date.now() - 1, cycles: 0,
    intervalMs: 60 * 60 * 1000, skipUnchanged: false, encrypt: false,
    locations: [{ path: out, enabled: true }], include: ['settings'],
  });
  let tick = Date.now();
  const deps = {
    vault,
    load: () => cfg,
    save: (next) => { cfg = next; },
    audit: () => {},
    broadcast: () => {},
    now: () => (tick += 20),
    getKroot: () => Buffer.alloc(32, 0x11),
  };
  const listA = () => fs.readdirSync(out).filter((f) => f.endsWith('.nm')).map((f) => path.join(out, f))
    .filter((f) => { const r = inspectNmPackage(f); return r.ok && r.scheduleId === 'task-A'; });

  for (let i = 0; i < 3; i++) await zhiXingDingShiDaoChu(deps, { force: true });
  const aAfter = listA();
  ok('copies=2：目录下所有 .nm 保留最新 2 份（包含刚导出的）', aAfter.length === 2, JSON.stringify(aAfter));
  ok('copies=2 按目录下所有 .nm 保留（其它任务/无编号旧包也参与排序）', fs.readdirSync(out).filter((f) => f.endsWith('.nm')).length === 2 && !fs.existsSync(other) && !fs.existsSync(anon));

  cfg = { ...cfg, copies: 1 };
  for (let i = 0; i < 2; i++) await zhiXingDingShiDaoChu(deps, { force: true });
  ok('copies=1：目录下所有 .nm 只留最新 1 份', fs.readdirSync(out).filter((f) => f.endsWith('.nm')).length === 1, JSON.stringify(listA()));

  cfg = { ...cfg, copies: 0 };
  const beforeZero = listA().length;
  for (let i = 0; i < 2; i++) await zhiXingDingShiDaoChu(deps, { force: true });
  ok('copies=0：不检查、不清旧包（每次新增）', fs.readdirSync(out).filter((f) => f.endsWith('.nm')).length === beforeZero + 2, JSON.stringify(listA()));
} finally {
  clean(userData); clean(out);
}
console.log(`==== verify-r113-export-retention: ${pass} PASS / 0 FAIL ====`);
