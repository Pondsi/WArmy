/**
 * W05 门禁：加密存储按**数据类别**覆盖（不只看一个 settings.json）
 *
 * 口径：enc-fs 在 userData 根部接管 fs，除显式豁免目录/扩展名外，
 * 所有事实与投影都以密文落盘；旧明文可迁移；未解锁时受管文件写入被拒绝。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const encFs = require(path.join(GEN, 'packages/app-shell/dist/enc-fs.cjs'));

let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) { ok += 1; console.log('  ok ', name); }
  else { fails.push(name); console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}
const rawRead = (p) => {
  const fd = fs.openSync(p, 'r');
  try {
    const st = fs.fstatSync(fd);
    const b = Buffer.alloc(st.size);
    fs.readSync(fd, b, 0, b.length, 0);
    return b;
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
};
const isSealed = (p) => rawRead(p).subarray(0, 8).toString() === 'WARMYEF2';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-w05-'));
try {
  encFs.install({ root });
  const key = Buffer.alloc(32, 0x3c);
  encFs.setKey(key);

  const categories = [
    ['设置', 'settings.json', '{"secret":"W05_SETTINGS"}'],
    ['聊天事实/投影', 'chat/sessions/s-1.jsonl', '{"text":"W05_CHAT"}\n'],
    ['知识库', 'knowledge/kb-main.json', '{"secret":"W05_KB"}'],
    ['群/项目', 'groups/g-1.json', '{"secret":"W05_GROUP"}'],
    ['资料/名片', 'profile/me.json', '{"secret":"W05_PROFILE"}'],
    ['审计', 'audit/audit-2026-10.jsonl', '{"what":"W05_AUDIT"}\n'],
    ['队列', 'queues/router.json', '{"secret":"W05_QUEUE"}'],
    ['检查点', 'checkpoints/chat-s1.json', '{"secret":"W05_CHECKPOINT"}'],
  ];
  for (const [label, rel, plain] of categories) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, plain);
    const raw = rawRead(p);
    jian(`${label}：磁盘是密文且无明文哨兵`, isSealed(p) && !raw.includes(Buffer.from(plain.trim())), { rel, head: raw.subarray(0, 8).toString() });
    jian(`${label}：逻辑读取还原原文`, fs.readFileSync(p, 'utf8') === plain, rel);
  }

  // 追加写（JSONL）逐记录加密
  const ap = path.join(root, 'chat/sessions/s-1.jsonl');
  fs.appendFileSync(ap, '{"text":"W05_APPEND"}\n');
  jian('JSONL 追加仍是密文且逻辑完整', isSealed(ap) && fs.readFileSync(ap, 'utf8').endsWith('W05_APPEND"}\n') && !rawRead(ap).includes(Buffer.from('W05_APPEND')));

  // 旧明文迁移：绕过封装写原生明文，再按类目迁移
  const legacy = path.join(root, 'checkpoints', 'legacy.jsonl');
  const fd = fs.openSync(legacy, 'w');
  fs.writeSync(fd, '{"old":true}\n');
  fs.closeSync(fd);
  const migrated = encFs.migrateTree(root);
  jian('旧明文（含 JSONL）可被迁移为密文', migrated >= 1 && isSealed(legacy) && fs.readFileSync(legacy, 'utf8') === '{"old":true}\n', { migrated });

  // 显式豁免目录：外部工作区 / 更新包 / 日志保持明文（各自有独立边界）
  for (const [label, rel] of [['外部工作区', 'workspace/s1/a.txt'], ['更新下载', 'updates/WArmy-0.3.0.exe'], ['日志', 'logs/app.log']]) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'PLAIN-BOUNDARY');
    jian(`${label}：按设计保持明文（显式边界）`, rawRead(p).toString('utf8') === 'PLAIN-BOUNDARY', rel);
  }
  // identity/auth 有自己的 vault，不走文件层
  const idp = path.join(root, 'identity', 'identity.json');
  fs.mkdirSync(path.dirname(idp), { recursive: true });
  fs.writeFileSync(idp, 'VAULT-OWNED');
  jian('identity 目录由 vault 自己管理（文件层豁免）', rawRead(idp).toString('utf8') === 'VAULT-OWNED');

  // 换错 key：拒绝而不是返回垃圾
  encFs.setKey(Buffer.alloc(32, 0x99));
  let rejected = false;
  try { fs.readFileSync(path.join(root, 'settings.json'), 'utf8'); } catch { rejected = true; }
  jian('换错 key 读取被拒绝（不静默返回垃圾）', rejected);

  // 未解锁 + 写守卫：受管文件不得落明文
  encFs.setKey(null);
  encFs.setWriteGuard(() => true);
  const locked = path.join(root, 'settings.locked.json');
  fs.writeFileSync(locked, '{"plaintext":"must-not-exist"}');
  jian('未解锁时受管写入被拒绝（不落明文）', !fs.existsSync(locked));
  const exemptDir = path.join(root, 'logs', 'still.log');
  fs.writeFileSync(exemptDir, 'ok');
  jian('未解锁不影响显式豁免路径', fs.existsSync(exemptDir));
  encFs.setWriteGuard(null);
  encFs.setKey(key);

  // 首个受管写入（首启）：没有仓库时允许写，但仍加密
  const first = path.join(root, 'profile', 'first.json');
  fs.writeFileSync(first, '{"first":true}');
  jian('首启允许写引导配置且仍加密', isSealed(first) && fs.readFileSync(first, 'utf8') === '{"first":true}');
} finally {
  try { encFs.setKey(null); } catch { /* noop */ }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n==== verify-r122-w05-storage: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
