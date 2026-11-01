/**
 * verify-r117-directed.mjs —— 群聊「仅 @ai 才发言」真的接线。
 *
 * 之前：设置/持久化/路由判定都有，但发送时没把被 @ 的成员 id 传下去，
 * 开启定向模式后任何消息都被判定为 `directed-no-mention` 静默。
 *
 * 本门禁做两件事：
 *  1) 路由行为：无 @ 静默、@ 到成员只派该成员、@ 到不存在成员静默；
 *  2) 接线：渲染层 payload 与主进程 handler 都把 mentionIds 传到 orchestrator。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

const router = new GroupChatRouter({ queueWhenFixedBusy: false });
router.createGroup({
  groupId: 'g-directed',
  ming: '定向测试群',
  type: 'internal',
  members: [],
  permissions: DEFAULT_PERMISSIONS,
  checkpointLimit: 50,
  directedMode: true,
});
router.join('g-directed', { id: 'a', ming: '阿甲', local: true, dutyEligible: true, status: 'idle' });
router.join('g-directed', { id: 'b', ming: '阿乙', local: true, dutyEligible: true, status: 'idle' });

const req = (mentionIds, content = '请处理这个') => ({
  groupId: 'g-directed', userId: 'u1', content, urgency: 'P2', mentionIds, timestamp: Date.now(),
});

const noMention = router.route(req([]));
ok('定向模式：没有 @ 时静默', noMention.action === 'silent' && noMention.reason === 'directed-no-mention', noMention);

const one = router.route(req(['a'], '@阿甲 请处理'));
ok('定向模式：@ 到阿甲只派阿甲', one.action === 'dispatch' && JSON.stringify(one.decision?.executorIds) === JSON.stringify(['a']), one.decision);
ok('定向模式：派发理由标明用户 @ 点名', one.decision?.assignments?.[0]?.why === '用户定向 @ 点名', one.decision?.assignments);

const ghost = router.route(req(['ghost'], '@不存在 请处理'));
ok('定向模式：@ 到不存在的成员静默（不误派）', ghost.action === 'silent' && ghost.reason === 'mentions-not-found', ghost);

const two = router.route(req(['a', 'b'], '@阿甲 @阿乙 一起看'));
ok('定向模式：@ 多个成员派多个', two.action === 'dispatch' && JSON.stringify(two.decision?.executorIds) === JSON.stringify(['a', 'b']), two.decision);

const appSrc = fs.readFileSync(path.join(root, 'packages/app-shell/src/renderer/app.js'), 'utf8');
ok('渲染层：groupOrchestrate 请求真的带上 mentionIds', /groupOrchestrate\(\{[^}]*mentionIds/s.test(appSrc));
ok('渲染层：从 groupMembers 解析被 @ 的成员 id', /groupMembers\?\.\(chatId\)[\s\S]{0,1500}mentionIds/.test(appSrc));

const mainSrc = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
ok('主进程：qunXieTiao 接收 mentionIds', /qunXieTiao[^\n]*mentionIds/.test(mainSrc));
ok('主进程：编排请求把 mentionIds 传下去', /groupId: xiaoXi\.groupId,[\s\S]{0,300}mentionIds/.test(mainSrc));

console.log(`\nverify-r117-directed: ${pass} PASS / 0 FAIL`);
