/**
 * 验证 group-store 真实持久化：写 → 新进程读 → 值还在
 *
 *   node scripts/verify-group-store.mjs
 *
 * 三个阶段：
 *   [1] 当前进程写（建群 / 邀请 / 实例入群 / 设管理员 / 定向模式 / 旧状态回填）
 *   [2] 子进程（全新 node 进程）重新读同一个文件，断言值还在
 *   [3] 子进程里再改一次（踢人），父进程重新读，断言改动也落盘
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GroupStore, GROUP_MEMBER_LIMIT } from '../dist/group-store.js';

const self = fileURLToPath(import.meta.url);
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
};

let failures = 0;
function check(label, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ── 阶段 2/3：全新进程读取（本脚本被自己 spawn） ──
if (process.argv.includes('--read')) {
  const file = argOf('--file');
  const store = new GroupStore(file);
  const snap = store.snapshot();
  console.log(`\n[2] 新进程读取 ${file}`);
  console.log(`    原始快照: ${JSON.stringify(snap)}`);
  check('群数量 = 2', snap.groups.length === 2, snap.groups.length);
  const g1 = store.getGroup('g-1001');
  check('群 g-1001 还在', !!g1, g1 && `${g1.name}/${g1.type}/directed=${g1.directedMode}`);
  check('g-1001 directedMode 已持久化', g1?.directedMode === true, g1?.directedMode);
  const members = store.listMembers('g-1001');
  check('g-1001 成员数 = 5', members.length === 5, members.map((m) => `${m.name}:${m.role}:${m.source}`));
  const admin = members.find((m) => m.name === '牛马一号');
  check('牛马一号 角色 = admin 且在盘上', admin?.role === 'admin', admin);
  const creator = members.find((m) => m.role === 'creator');
  check('创建者 群主 仍是 creator', creator?.name === '群主', creator?.name);
  const inst = members.find((m) => m.source === 'instance');
  check('实例成员已持久化（source=instance）', !!inst && !!inst.instanceId, inst);
  const kickCreator = store.removeMember('g-1001', creator?.id || '');
  check('创建者不可被移除（权限不变量）', kickCreator.ok === false, kickCreator.error);
  const migrated = store.getGroup('g-2002');
  check('回填的旧群 g-2002 已落盘', !!migrated && migrated.origin === 'migrated', migrated && migrated.origin);

  // [3] 在新进程里踢一个成员，验证改动同样落盘
  const target = members.find((m) => m.name === '临时工');
  const kicked = store.removeMember('g-1001', target?.id || '');
  check(`踢掉 ${target?.name}（${target?.id}）成功`, kicked.ok === true, kicked.members.map((m) => m.name));
  console.log(`[3] 新进程写入后成员: ${JSON.stringify(store.listMembers('g-1001').map((m) => m.name))}`);
  if (failures) {
    console.log(`\n阶段 2/3 失败 ${failures} 项`);
    process.exit(1);
  }
  console.log('阶段 2/3 全部通过');
  process.exit(0);
}

// ── 阶段 1：父进程写入 ──
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-group-store-'));
const file = path.join(tmpRoot, 'groups.json');
console.log(`[1] 写盘目标: ${file}`);
const store = new GroupStore(file);

const c1 = store.upsertGroup({ groupId: 'g-1001', name: '无限牛马作战群', type: 'internal' });
check('建群 g-1001', c1.ok && c1.group?.name === '无限牛马作战群', c1.group);
const c1b = store.upsertGroup({ groupId: 'g-1001', name: '无限牛马作战群', type: 'internal', directedMode: true });
check('建群幂等（不重复）', store.listGroups().length === 1, store.listGroups().length);
check('定向模式写入', c1b.ok && c1b.group?.directedMode === true, c1b.group?.directedMode);

const invite1 = store.addMember('g-1001', { name: '群主', role: 'creator', source: 'invite' });
const invite2 = store.addMember('g-1001', { name: '牛马一号', role: 'member', source: 'invite' });
const invite1b = store.addMember('g-1001', { name: '牛马二号', role: 'member', source: 'invite' });
const invite3 = store.addMember('g-1001', { name: '临时工', role: 'member', source: 'invite' });
check('邀请 4 人', invite1.ok && invite1b.ok && invite3.ok && invite3.members.length === 4, invite3.members.map((m) => m.name));
const dup = store.addMember('g-1001', { name: '牛马一号', role: 'member', source: 'invite' });
check('同名重复邀请被忽略（幂等）', dup.ok && dup.members.length === 4, dup.members.length);
const inst = store.addMember('g-1001', { name: '本机实例-1', role: 'member', source: 'instance', instanceId: 'inst-1' });
check('实例入群写入（id=inst:inst-1）', inst.ok && inst.members.some((m) => m.id === 'inst:inst-1'), inst.members.map((m) => m.id));
const instDup = store.addMember('g-1001', { name: '本机实例-1 改名', role: 'member', source: 'instance', instanceId: 'inst-1' });
check('同实例重复入群幂等', instDup.ok && instDup.members.length === 5, instDup.members.length);

const creatorRow = store.listMembers('g-1001').find((m) => m.role === 'creator');
const adminOnCreator = store.setAdmin('g-1001', creatorRow?.id || '', true);
check('创建者角色固定（不可提权/降级）', adminOnCreator.ok === false, adminOnCreator.error);
const m1 = store.listMembers('g-1001').find((m) => m.name === '牛马一号');
const setAdmin = store.setAdmin('g-1001', m1?.id || '', true);
check('设置管理员', setAdmin.ok && setAdmin.members.find((m) => m.name === '牛马一号')?.role === 'admin', setAdmin.members.map((m) => `${m.name}:${m.role}`));
const kickMissing = store.removeMember('g-1001', 'not-exist');
check('踢不存在的成员返回错误', kickMissing.ok === false, kickMissing.error);

// 上限 50（与旧实现一致）
const capFile = path.join(tmpRoot, 'cap.json');
const capStore = new GroupStore(capFile);
capStore.upsertGroup({ groupId: 'g-cap', name: 'cap', type: 'internal' });
for (let i = 0; i < GROUP_MEMBER_LIMIT; i++) capStore.addMember('g-cap', { name: `m${i}`, source: 'invite' });
const over = capStore.addMember('g-cap', { name: 'overflow', source: 'invite' });
check(`成员上限 ${GROUP_MEMBER_LIMIT} 生效`, over.ok === false && over.error === `max ${GROUP_MEMBER_LIMIT}`, over.error);

// 旧版会话状态回填
const migrated = store.migrateFrom([
  { id: 'g-2002', name: '老群', type: 'external' },
  { id: 'g-1001', name: '重复 id 不应再插一遍', type: 'internal' },
]);
check('回填迁移只加新群', migrated === 1 && store.listGroups().length === 2, { migrated, total: store.listGroups().length });
const migratedAgain = store.migrateFrom([{ id: 'g-3003', name: '第二次回填', type: 'internal' }]);
check('回填只做一次（不会把已解散的群再加回来）', migratedAgain === 0 && !store.getGroup('g-3003'), { migratedAgain, groups: store.listGroups().map((g) => g.groupId) });

// 原子写不留 .tmp
const leftovers = fs.readdirSync(tmpRoot).filter((f) => f.endsWith('.tmp'));
check('原子写无 .tmp 残留', leftovers.length === 0, leftovers);

// 损坏文件隔离
const corruptFile = path.join(tmpRoot, 'corrupt.json');
fs.writeFileSync(corruptFile, '{ this is not json', 'utf8');
const corruptStore = new GroupStore(corruptFile);
const empty = corruptStore.snapshot();
const quarantined = fs.readdirSync(tmpRoot).filter((f) => f.startsWith('corrupt.json.corrupt-'));
check('损坏文件返回兜底结构且被隔离', empty.groups.length === 0 && quarantined.length === 1, quarantined);

console.log(`\n[2] 起新 node 进程读同一个文件: ${file}`);
const out = execFileSync(process.execPath, [self, '--read', '--file', file], { encoding: 'utf8' });
console.log(out.trimEnd());

// ── 阶段 4：父进程重新读，确认子进程的改动也在盘上 ──
console.log('\n[4] 父进程重新读盘，确认子进程的踢人操作已持久化');
const reread = new GroupStore(file).listMembers('g-1001').map((m) => m.name);
check('临时工 已被移除且已落盘', !reread.includes('临时工'), reread);
check('其余成员仍在', reread.includes('牛马一号') && reread.includes('本机实例-1'), reread);

console.log(`\n结论: ${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
console.log(`临时目录: ${tmpRoot}`);
process.exit(failures === 0 ? 0 : 1);
