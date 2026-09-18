/**
 * Router 队列：不丢弃 + 可持久化 + 不双写
 *
 * 断言：
 *  1. route() 无值班时已入队，orchestrator 不得再次 enqueue（键集/长度）
 *  2. complete() 不再「标记 dispatched 却丢弃」；dequeueNext 真正弹出
 *  3. requeue 能把处理失败的项放回
 *  4. serializeState / restoreState 往返后队列项仍在
 *  5. onQueueMutated 在入队/弹出/删除时被调用（主进程据此落盘）
 */
import assert from 'node:assert/strict';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}`, detail ?? '');
  }
}

const mutations = [];
const router = new GroupChatRouter({
  queueWhenFixedBusy: false,
  onQueueMutated: (gid) => mutations.push(gid),
});

router.createGroup({
  groupId: 'g1',
  name: '测试群',
  type: 'internal',
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});

// 故意不 join 任何本机实例 ⇒ selectDuty 必为 null
const req = {
  groupId: 'g1',
  userId: 'u1',
  content: '请帮我整理一份周报',
  urgency: /** @type {const} */ ('P2'),
  mentionIds: [],
  timestamp: Date.now(),
};

const route1 = router.route(req);
check('route(action=queue)', route1.action === 'queue', route1);
check('route 已入队 queued=true', route1.queued === true, route1);
check('route 后队列长度=1（不得双写）', router.listQueue('g1').length === 1, router.listQueue('g1').length);

// 模拟 orchestrator 旧 bug：route 已入队后又 enqueue 一次 —— 现在调用方不应这么做
// 这里只验证：若误 enqueue，长度会变成 2（说明双写可检测）；正确路径不 enqueue
const afterRouteLen = router.listQueue('g1').length;
check('正确路径长度仍为 1', afterRouteLen === 1, afterRouteLen);

// complete 只置 idle，不弹出
const c = router.complete('g1');
check('complete 返回 null（不再假装弹出）', c === null, c);
check('complete 后队列仍在', router.listQueue('g1').length === 1, router.listQueue('g1').length);

// dequeueNext 真正弹出
const item = router.dequeueNext('g1');
check('dequeueNext 返回项', !!item && item.request?.content === req.content, item?.request?.content);
check('dequeue 后队列空', router.listQueue('g1').length === 0, router.listQueue('g1').length);
check('dequeue 项 status=dispatched', item?.status === 'dispatched', item?.status);

// requeue 放回
const back = router.requeue(item);
check('requeue 后 status=queued', back.status === 'queued', back.status);
check('requeue 后长度=1', router.listQueue('g1').length === 1, router.listQueue('g1').length);

// 持久化往返
const snap = router.serializeState();
check('serialize version=1', snap.version === 1, snap.version);
check('serialize 含 g1 队列', Array.isArray(snap.queues.g1) && snap.queues.g1.length === 1, snap.queues.g1);

const router2 = new GroupChatRouter({ queueWhenFixedBusy: false });
router2.createGroup({
  groupId: 'g1',
  name: '测试群',
  type: 'internal',
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
});
router2.restoreState(snap);
check('restore 后队列长度=1', router2.listQueue('g1').length === 1, router2.listQueue('g1').length);
check('restore 后内容一致', router2.listQueue('g1')[0]?.request?.content === req.content, router2.listQueue('g1')[0]?.request?.content);

// 多条 + 紧急度排序 + 删除
router.enqueue({ ...req, content: 'P3 排队项', urgency: 'P3' });
router.insertUrgent({ ...req, content: 'P0 加急项', urgency: 'P0' });
const q = router.listQueue('g1');
check('加急后 P0 在最前', q[0]?.urgency === 'P0', q.map((x) => x.urgency));
const delId = q.find((x) => x.urgency === 'P3')?.id;
check('删除 P3 成功', !!delId && router.removeQueueItem('g1', delId) === true, delId);
check('删除后长度=2', router.listQueue('g1').length === 2, router.listQueue('g1').length);

check('onQueueMutated 被调用过', mutations.length >= 5, mutations.length);

console.log(`\n==== verify-router-queue: ${pass} ok / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
