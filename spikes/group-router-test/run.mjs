/**
 * group-router 集成测试
 */
import {GroupChatRouter, DEFAULT_PERMISSIONS} from '@warmy/group-router';

const fails = [];
const check = (n, c, d) => {
  if (!c) fails.push({ n, d });
  console.log(`${c ? 'OK' : 'FAIL'} ${n}`, d ?? '');
};

const r = new GroupChatRouter({ queueWhenFixedBusy: true });

r.createGroup({
  groupId: 'g1',
  ming: '内部群',
  type: 'internal',
  dutyInstanceId: null,
  directedMode: false,
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});

// 本机两个实例 + 远程一个
r.join('g1', { id: 'a', ming: 'A', local: true, dutyEligible: true, status: 'idle' });
r.join('g1', { id: 'b', ming: 'B', local: true, dutyEligible: true, status: 'idle' });
r.join('g1', { id: 'remote', ming: 'R', local: false, dutyEligible: true, status: 'idle' });

const members = r.listMembers('g1');
check('order 1,2,3', members[0].order === 1 && members[2].order === 3, members.map((m) => m.id + ':' + m.order));
check('remote not duty eligible', members.find((m) => m.id === 'remote')?.dutyEligible === false);

// 序号最小空闲值班
r.setStatus('g1', 'a', 'busy');
let duty = r.selectDuty('g1');
check('duty skip busy A → B', duty?.id === 'b', duty?.id);

r.setStatus('g1', 'b', 'busy');
duty = r.selectDuty('g1');
check('all busy → null', duty === null, duty);

r.setStatus('g1', 'a', 'idle');
r.setFixedDuty('g1', 'a');
r.setStatus('g1', 'a', 'busy');
duty = r.selectDuty('g1');
check('fixed busy + queue → null', duty === null, duty);

// 固定忙顺延
const r2 = new GroupChatRouter({ queueWhenFixedBusy: false });
r2.createGroup({
  groupId: 'g2',
  ming: 'e',
  type: 'internal',
  dutyInstanceId: null,
  directedMode: false,
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});
r2.join('g2', { id: 'a', ming: 'A', local: true, dutyEligible: true, status: 'busy' });
r2.join('g2', { id: 'b', ming: 'B', local: true, dutyEligible: true, status: 'idle' });
r2.setFixedDuty('g2', 'a');
check('fixed busy + handoff → B', r2.selectDuty('g2')?.id === 'b', r2.selectDuty('g2')?.id);

// 外部群静默
r.createGroup({
  groupId: 'ext',
  ming: '外部',
  type: 'external',
  dutyInstanceId: null,
  directedMode: false,
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});
r.join('ext', { id: 'a', ming: 'A', local: true, dutyEligible: true, status: 'idle' });
const silent = r.route({
  groupId: 'ext',
  userId: 'u',
  content: 'hello',
  urgency: 'P2',
  mentionIds: [],
  timestamp: Date.now(),
});
check('external no @ silent', silent.action === 'silent', silent);

const mentioned = r.route({
  groupId: 'ext',
  userId: 'u',
  content: '@A hi',
  urgency: 'P2',
  mentionIds: ['a'],
  timestamp: Date.now(),
});
check('external @ dispatch', mentioned.action === 'dispatch', mentioned.action);

// 非定向无值班 → queue
r.setStatus('g1', 'a', 'busy');
r.setStatus('g1', 'b', 'busy');
r.setFixedDuty('g1', null);
const qres = r.route({
  groupId: 'g1',
  userId: 'u',
  content: 'task',
  urgency: 'P2',
  mentionIds: [],
  timestamp: Date.now(),
});
check('no duty → queue', qres.action === 'queue', qres);
check('queue len>=1', r.listQueue('g1').filter((x) => x.status === 'queued').length >= 1);

// P0 插队
r.insertUrgent({
  groupId: 'g1',
  userId: 'u',
  content: 'urgent',
  urgency: 'P0',
  mentionIds: [],
  timestamp: Date.now(),
});
const q0 = r.listQueue('g1')[0];
check('P0 front', q0.urgency === 'P0', q0.urgency);

// 定向模式
r.createGroup({
  groupId: 'dir',
  ming: 'd',
  type: 'internal',
  dutyInstanceId: null,
  directedMode: true,
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});
r.join('dir', { id: 'a', ming: 'A', local: true, dutyEligible: true, status: 'idle' });
const dirSilent = r.route({
  groupId: 'dir',
  userId: 'u',
  content: 'x',
  urgency: 'P2',
  mentionIds: [],
  timestamp: Date.now(),
});
check('directed no @ silent', dirSilent.action === 'silent', dirSilent);

// 权限矩阵
check('creator dissolve', DEFAULT_PERMISSIONS.creator.dissolve_group === true);
check('member no dissolve', DEFAULT_PERMISSIONS.member.dissolve_group === false);
check('external board readonly', DEFAULT_PERMISSIONS.external_member.view_board === 'readonly');

if (fails.length) {
  console.log('FAILURES', fails);
  process.exit(1);
}
console.log('GROUP-ROUTER PASS');
process.exit(0);
