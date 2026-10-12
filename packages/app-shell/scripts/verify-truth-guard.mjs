#!/usr/bin/env node
/**
 * verify-truth-guard.mjs —— **如实性护栏门禁**（硬门禁）
 *
 * 真机事故（2026-10-12 04:07）：用户让牛马"在桌面生成 txt+ppt 并打开验收"，
 * 审计 `chat.tools.done | gongJuDiaoYongJi: 0`（一个工具都没调），
 * 回复却写「📄 桌面文件已生成并打开 ✅ 请老板验收」——桌面上那两个文件还是上一轮的旧文件。
 * 用户看到"它说做了，但什么都没有"。这条门禁就钉死这个判定：
 *   · 说做了 + 0 次工具调用 + 用户在要求动手 ⇒ **必须判成"口头完成"**；
 *   · 真调了工具 / 只是聊天问答 / 没声称完成 ⇒ **不许误报**。
 * 顺带自证：样例里正反两面都要能判对（"门禁必须能失败"）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const distFile = path.join(pkgRoot, 'dist', 'truth-guard.js');

let pass = 0;
let fail = 0;
const bad = [];
const ok = (c, l, d) => { if (c) { pass++; console.log('  PASS ' + l); } else { fail++; bad.push(l); console.log('  FAIL ' + l + (d ? '  => ' + String(d).slice(0, 300) : '')); } };

console.log('=== 如实性护栏门禁 ===');
if (!fs.existsSync(distFile)) {
  ok(false, 'dist/truth-guard.js 存在（先 npm run build）', distFile);
  console.log(`\n==== verify-truth-guard: ${pass} ok / ${fail} FAIL ====`);
  process.exit(1);
}
const { panKouTouWanCheng, YAO_DONG_SHOU } = await import(/* @vite-ignore */ new URL('file://' + distFile.replace(/\\/g, '/')));
ok(typeof panKouTouWanCheng === 'function', '导出 panKouTouWanCheng');

const WEN_YONG_HU = '在我的桌面上生成一个txt文本，生成一个ppt，写入 你是谁，我是谁。然后打开这2个文件，让我验收。';

// ① 本次真机事故的原样（必须判出来）
{
  const hui = '### 📄 桌面文件已生成并打开\n- `Desktop/你是谁我是谁.txt` ✅ 已打开\n- `Desktop/你是谁我是谁.pptx` ✅ 已打开\n请老板验收。';
  const r = panKouTouWanCheng(hui, WEN_YONG_HU, 0);
  ok(r.kouTou === true, '事故原样：说"已生成并打开"+0 次工具调用 ⇒ 判成口头完成', JSON.stringify(r));
}
// ② 真调了工具 —— 不许误报
{
  const hui = '桌面文件已生成并打开：Desktop/你是谁我是谁.txt、Desktop/你是谁我是谁.pptx，请验收。';
  ok(panKouTouWanCheng(hui, WEN_YONG_HU, 2).kouTou === false, '真调了 2 次工具 ⇒ 不判（不误伤）', 'has-tool-calls');
}
// ③ 纯聊天问答（用户没要求动手）—— 不许误报
{
  ok(panKouTouWanCheng('我是牛马-1，你是老板。', '告诉我你是谁，我是谁', 0).kouTou === false, '用户只是问身份 ⇒ 不判');
  ok(panKouTouWanCheng('今天天气不错，文件这种东西我不太懂。', '聊聊天气', 0).kouTou === false, '闲聊里提到"文件" ⇒ 不判（用户没要求动手）');
}
// ④ 要求动手、但回复没说"已完成" —— 不许误报
{
  ok(panKouTouWanCheng('好的，我这就开始安排，先确认一下你要的格式。', WEN_YONG_HU, 0).kouTou === false, '只是说要开始 ⇒ 不判（走"续派"那条路）');
  ok(panKouTouWanCheng('', WEN_YONG_HU, 0).kouTou === false, '空回复 ⇒ 不判');
}
// ⑤ 自证：用户要求"动手"的词表得真能命中（否则整条护栏是摆设）
{
  ok(YAO_DONG_SHOU.test('帮我生成一个文件') && YAO_DONG_SHOU.test('打开这两个文件') && YAO_DONG_SHOU.test('写一篇小说'),
    '自证：「生成/打开/写」这类动手要求能被识别', 'yao-dong-shou');
  ok(YAO_DONG_SHOU.test('告诉我你是谁') === false, '自证：纯提问不算动手要求', 'no-action-ask');
}

console.log(`\n==== verify-truth-guard: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + bad.join('\n - '));
process.exit(fail ? 1 : 0);
