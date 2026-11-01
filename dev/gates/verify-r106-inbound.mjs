/**
 * verify-r106-inbound —— 群聊入站消息归属校验真值表 + 主进程接线。
 * 纯本地；不启动 Electron、不联网、不读写真实 profile。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { qunRuXiangJianYan } = await import(pathToFileURL(path.join(root, 'packages/app-shell/dist/hui-hua-chuan-shu.js')).href);
const main = fs.readFileSync(path.join(root, 'packages/app-shell/src/electron-main.ts'), 'utf8');
let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const base = { groupId: 'g1', sessionId: 'g1', peerFingerprint: 'peer-a', memberFingerprints: ['peer-a', 'peer-b'], creatorFingerprint: 'creator' };
ok('成员指纹命中才允许', qunRuXiangJianYan(base).ok === true);
ok('创建者可投递', qunRuXiangJianYan({ ...base, peerFingerprint: 'creator' }).ok === true);
ok('非成员被拒', qunRuXiangJianYan({ ...base, peerFingerprint: 'stranger' }).ok === false);
ok('sessionId 必须等于 groupId', qunRuXiangJianYan({ ...base, sessionId: 'other-session' }).ok === false);
ok('payload 内外层 groupId 必须一致', qunRuXiangJianYan({ ...base, payloadGroupId: 'g2' }).ok === false);
ok('缺 groupId 被拒', qunRuXiangJianYan({ ...base, groupId: '' }).ok === false);
ok('缺对端指纹被拒', qunRuXiangJianYan({ ...base, peerFingerprint: '' }).ok === false);
ok('新版本不再兼容无指纹旧群：没有任何指纹时拒绝（不是放行）', (() => {
  const r = qunRuXiangJianYan({ ...base, memberFingerprints: [], creatorFingerprint: '' });
  return r.ok === false && r.reason === 'no-member-fingerprint';
})());
ok('只有创建者、没有成员列表时，非创建者仍被拒', qunRuXiangJianYan({ ...base, memberFingerprints: [], peerFingerprint: 'stranger' }).ok === false);
ok('有成员指纹但空对端指纹仍拒绝', qunRuXiangJianYan({ ...base, peerFingerprint: '  ' }).ok === false);
ok('主进程在去重/落盘前做归属校验并留审计', /const jian = qunRuXiangJianYan\(/.test(main)
  && /chat\.net-inbound-rejected/.test(main)
  && /chat\.group-no-fingerprint-blocked/.test(main)
  && /if \(!jian\.ok\)/.test(main));
ok('出站同样拒绝无指纹群（不会“只拦收、不拦发”）', /group-identity-unverified/.test(main)
  && /direction: 'outbound'/.test(main));
console.log(`\nverify-r106-inbound: ${pass} PASS / 0 FAIL`);
