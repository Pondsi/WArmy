/** R78 #17: top alignment only for a new message, never after user scrolls or for streamed updates. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
const fn = src.match(/function yingDingBuDuiQi\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
if (!fn) { console.log('FAIL function not found'); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(fn[0], ctx);
const f = ctx.yingDingBuDuiQi;
const cases = [
  [false, 'm1', undefined, false, true, 'new message at non-bottom aligns'],
  [true, 'm1', undefined, false, false, 'manual scroll suppresses'],
  [false, 'm1', 'm1', false, false, 'streamed same key does not realign'],
  [false, 'm2', 'm1', false, true, 'next message realigns'],
  [false, 'm1', undefined, true, false, 'already at bottom does not yank'],
];
let ok = 0, fail = 0;
for (const [sup, key, last, bottom, want, label] of cases) {
  const got = f(sup, key, last, bottom);
  if (got === want) { ok++; console.log('ok   ' + label); } else { fail++; console.log('FAIL ' + label + ' got ' + got); }
}
const wired = /for \(const ev of \['wheel', 'touchstart', 'pointerdown'\]\)/.test(src)
  && /heZi\.addEventListener\(ev, markUserScrolled/.test(src)
  && /scrollDiAnNiu'\)\?\.addEventListener\('click', \(\) => \{ scrollToBottom\(false\); \}\)/.test(src)
  && /topAlignSuppress\.delete\(String\(id\)\)/.test(src)
  /** 抑制只能由"用户发下一条消息"清；不能在每次渲染/切会话时按 topAlignSid 清掉。 */
  && !/topAlignSid/.test(src);
if (wired) { ok++; console.log('ok   wheel/pointer/arrow/send wiring present'); } else { fail++; console.log('FAIL wiring missing'); }
console.log(`verify-r78-scroll: ${ok} ok / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
