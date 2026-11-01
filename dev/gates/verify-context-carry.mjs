/**
 * verify-context-carry —— 第 51 轮：跨轮黑板摘要 + 中间回复进记忆
 * 口径（§18.6 #5/#7 按推荐）：
 *  · 同一会话、最近 6 小时、**最近一个任务号**的黑板条目 ⇒ 给新一轮带 ≤2400 字摘要 + 指针；
 *  · 续派轮（internal）不带；跨任务不带；
 *  · 中间回复不进"每条都存"，而是合成**一条** `kind:'zhongjian'` 摘要，可 recall；
 *  · 条数不变量：zhongjian 是额外类型，不计入"日志条数 = 消息记忆条数"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.join(ROOT, 'packages/app-shell/src/electron-main.ts');
const mod = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/ban-ji-dai-hui.js')).href).catch(() => null);

let okN = 0, failN = 0;
const ok = (m) => { okN++; console.log('  ok  ' + m); };
const bad = (m) => { failN++; console.log('  FAIL ' + m); };
const need = (c, m) => (c ? ok(m) : bad(m));

const em = fs.readFileSync(MAIN, 'utf8');

// 1. 纯函数行为
if (mod && typeof mod.daiHuiZhaiYao === 'function') {
  const now = Date.now();
  let ku = mod.kongKu();
  ku = mod.shouTiao(ku, { sessionId: 's1', renWuId: 'rw-1', lei: 'fact', wen: '甲事实', ts: now - 1000 });
  ku = mod.shouTiao(ku, { sessionId: 's1', renWuId: 'rw-1', lei: 'decision', wen: '选方案 B', ts: now });
  ku = mod.shouTiao(ku, { sessionId: 's2', renWuId: 'rw-2', lei: 'fact', wen: '别的会话', ts: now });
  const z1 = mod.daiHuiZhaiYao(ku, 's1', now);
  need(!!z1 && z1.renWuId === 'rw-1' && /甲事实/.test(z1.wen), '同会话带回最近任务的事实与决定');
  need(!/别的会话/.test(z1?.wen || ''), '不把别的会话的黑板带进来');
  const z2 = mod.daiHuiZhaiYao(ku, 's1', now + 7 * 3600 * 1000);
  need(z2 === null, '超过 6 小时窗口 ⇒ 不带');
  const z3 = mod.daiHuiZhaiYao(ku, 's3', now);
  need(z3 === null, '没有记录 ⇒ 不带');
  // 有新任务时只带最新任务
  ku = mod.shouTiao(ku, { sessionId: 's1', renWuId: 'rw-9', lei: 'fact', wen: '新任务事实', ts: now + 1 });
  const z4 = mod.daiHuiZhaiYao(ku, 's1', now + 2);
  need(!!z4 && z4.renWuId === 'rw-9' && !/甲事实/.test(z4.wen), '只带最近一个任务号（跨任务不带旧事）');
  // 有界
  let ku2 = mod.kongKu();
  for (let i = 0; i < 60; i++) ku2 = mod.shouTiao(ku2, { sessionId: 's9', renWuId: 'rw-x', lei: 'fact', wen: '第' + i + '条', ts: now + i });
  need(ku2.tiao.length <= 40, `摘要库有条数上限（实际 ${ku2.tiao.length}）`);
  const z5 = mod.daiHuiZhaiYao(ku2, 's9', now + 59);
  need(!!z5 && z5.wen.length <= 2400 + 300, `摘要正文有界（实际 ${z5?.wen.length}）`);
} else {
  bad('取不到 ban-ji-dai-hui 编译产物');
}

// 2. 主进程接线
need(/heiBanCun: \(\(\) => \{/.test(em) && /banShouTiao\(banDaiHuiKu/.test(em), '黑板写成功后记摘要行');
need(/cunBanDaiHui\(\);/.test(em), '摘要库落盘');
need(/duBanDaiHui\(\);/.test(em), '启动时读回摘要库');
need(/chat\.board-carry/.test(em), '带回动作进审计');
need(/if \(!\(xiaoXi as \{ internal\?: boolean \}\)\.internal\) \{[\s\S]{0,200}daiHuiZhaiYao/.test(em), '只有真实用户轮才带（续派轮不带）');

// 3. 中间回复进记忆
need(/kind: 'zhongjian'/.test(em), '中间回复写成 kind:zhongjian 记忆');
need(/chat\.interim-summary-memory/.test(em), '中间摘要写入进审计');
need(/正式结论见最终回复/.test(em), '摘要里声明"以最终回复为准"');

console.log(`\n==== verify-context-carry: ${okN} ok / ${failN} FAIL ====`);
process.exit(failN ? 1 : 0);
