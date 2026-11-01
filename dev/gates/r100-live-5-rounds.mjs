/**
 * r100-live-5-rounds.mjs —— 第 100 轮真实模型连续 5 轮验收（只允许 Ollama / MiMo，不使用 DeepSeek key）。
 *
 * 每轮内容不同，覆盖：纯问答 / 工具写读 / 停止（含“停了不再动”与“停止后能继续”）/
 * 多步计划 + 等待 + 重启后现场仍在 / 设置插件与独立会话窗 + 短问答。
 *
 * 用法（应用已用 --remote-debugging-port=9888 启动）：
 *   node dev/gates/r100-live-5-rounds.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { attach, sleep } from '../../packages/app-shell/scripts/cdp-lib.mjs';

const PORT = 9888;
const APPDATA = process.env.APPDATA || '';
const fails = [];
let pass = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fails.push(name + (detail ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
};

let c = await attach(PORT, { matchUrlIncludes: 'index.html' });
const ev = (x, o) => c.evaluate(x, o);
const sleepTo = async (fn, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('等待超时：' + label);
    await sleep(600);
  }
};

async function ensureChat() {
  await ev(`document.querySelector('[data-nav="singleAi"]')?.click()`);
  await sleep(400);
  await ev(`(function(){const it=document.querySelector('#lieBiaoTi .lieBiaoTiaoMu'); if(it && !document.getElementById('xiaoXiJi')?.querySelector('.xiaoXi')) it.click(); return true;})()`);
  await sleep(600);
  return await ev(`Object.keys(window.__msgs||{})[0] || ''`);
}
const sid = await ensureChat();
ok('第 0 步：已选中一个真实会话', !!sid, sid);

const countOf = () => ev(`(window.__msgs[${JSON.stringify(sid)}]||[]).length`);
const lastOf = () => ev(`JSON.stringify((window.__msgs[${JSON.stringify(sid)}]||[]).slice(-1)[0]||null)`);
const busy = () => ev(`!document.getElementById('yunXingZhuangTai')?.classList.contains('yinCang')`);
const actionsOf = () => ev(`JSON.stringify((window.__xingDongQu?window.__xingDongQu(${JSON.stringify(sid)}):[]).map(x=>({hao:x.hao,op:x.op,status:x.status,stopped:!!x.stopped,ts:x.ts})))`);

async function send(prompt, { timeout = 200000, wantStopped = false } = {}) {
  const n0 = await countOf();
  await ev(`(function(){const t=document.getElementById('shuRu'); t.value=${JSON.stringify(prompt)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`);
  const t0 = Date.now();
  for (;;) {
    const n = await countOf();
    const b = await busy();
    if (n > n0) {
      const m = JSON.parse(await lastOf());
      if (m && m.role === 'them' && (m.stopped === true || wantStopped === false) && !b) return m;
      if (m && m.role === 'them' && m.stopped === true && !wantStopped) return m;
    }
    if (!b && n > n0 && Date.now() - t0 > 2000) {
      const m = JSON.parse(await lastOf());
      if (m && m.role === 'them') return m;
    }
    if (Date.now() - t0 > timeout) throw new Error('模型回复超时 ' + Math.round(timeout / 1000) + 's');
    await sleep(800);
  }
}

/* ═══ 第 1 轮：纯问答（不调工具） ═════════════════════════════════════════ */
console.log('\n===== 第 1/5 轮：纯问答 + 模型身份 =====');
try {
  const m = await send('请只回答一个数字，不要解释：17 × 23 等于多少？');
  ok('1.1 拿到非空最终回复', !!m && String(m.text || '').trim().length > 0, String(m && m.text).slice(0, 40));
  ok('1.2 算术结果正确（391）', /391/.test(String(m && m.text || '')));
  ok('1.3 这一轮没有被误标为“已停止”', m && m.stopped !== true);
} catch (e) { fails.push('第1轮：' + e.message); console.log('FAIL 第1轮：' + e.message); }

/* ═══ 第 2 轮：写文件 + 读回（真实工具 + 操作台账） ═════════════════════════ */
console.log('\n===== 第 2/5 轮：写文件 / 读回 / 操作台账 =====');
const file2 = path.join(APPDATA, '@warmy', 'app-shell', 'workspace', sid, 'r100-round2.txt');
try {
  const a0 = JSON.parse(await actionsOf()).length;
  const m = await send('请必须调用工具：先用 write_file 在当前工作区创建 r100-round2.txt，内容只写 WArmy-R100-OK；再用 read_file 读回它；最后在回复里说出文件内容。不要只说话。');
  const acts = JSON.parse(await actionsOf()).slice(a0);
  const names = acts.map((x) => x.op);
  ok('2.1 调用了 write_file', names.some((n) => /write_file|写入/.test(n)), names.join(','));
  ok('2.2 调用了 read_file', names.some((n) => /read_file|读取/.test(n)), names.join(','));
  let txt = '';
  try { txt = fs.readFileSync(file2, 'utf8'); } catch { /* 没有 */ }
  ok('2.3 文件真的落盘且内容正确', txt.trim() === 'WArmy-R100-OK', txt.slice(0, 40));
  ok('2.4 最终回复提到文件内容', /WArmy-R100-OK/i.test(String(m && m.text || '')), String(m && m.text).slice(0, 60));
} catch (e) { fails.push('第2轮：' + e.message); console.log('FAIL 第2轮：' + e.message); }

/* ═══ 第 3 轮：停止（马上停 / 不再动 / 现场保留 / 还能继续） ═══════════════ */
console.log('\n===== 第 3/5 轮：停止 =====');
try {
  const n0 = await countOf();
  const a0 = JSON.parse(await actionsOf()).length;
  await ev(`(function(){const t=document.getElementById('shuRu'); t.value='请立即调用 wait_seconds 等待 30 秒，不要解释，不要先说话。必须调用工具。'; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`);
  await sleepTo(async () => JSON.parse(await actionsOf()).length > a0, 40000, '等待 wait_seconds 开始');
  const tStop = Date.now();
  await ev(`document.getElementById('anNiuTingZhiAll').click()`);
  await sleepTo(async () => !(await busy()), 15000, '停止后忙状态消失');
  const m = JSON.parse(await lastOf());
  ok('3.1 停止后立即出现“已停止”现场', m && m.stopped === true && String(m.text || '').includes('已停止'), String(m && m.text).slice(0, 40));
  const sums = await ev(`(function(){const ms=[...document.querySelectorAll('#xiaoXiJi .xiaoXi.them')]; const last=ms[ms.length-1]; return JSON.stringify({summary:last&&last.querySelector('.tingZhiZhaiYao')&&last.querySelector('.tingZhiZhaiYao').textContent,acts:[...last.querySelectorAll('.xingDongHang')].map(x=>x.textContent)});})()`);
  const sj = JSON.parse(sums);
  ok('3.2 停止摘要可见且至少有 1 个操作', /已执行 [1-9]/.test(String(sj.summary || '')), String(sj.summary || '').slice(0, 80));
  ok('3.3 进行中的操作显示“已停止”（不是“完成”）', (sj.acts || []).some((x) => String(x).includes('已停止')), (sj.acts || []).join(' | ').slice(0, 100));
  const nAfter = await countOf();
  await sleep(8000);
  ok('3.4 停止 8 秒后没有继续冒出新回复', (await countOf()) === nAfter, 'n=' + nAfter);
  ok('3.5 停止后发送按钮已恢复', (await ev(`!document.getElementById('anNiuFaSong').disabled`)) === true);
  const m2 = await send('请只回答：1 + 1 等于几？只回答数字。');
  ok('3.6 停止后用户再说话可以正常继续（不被停止标志卡死）', /2/.test(String(m2 && m2.text || '')), String(m2 && m2.text || '').slice(0, 30));
} catch (e) { fails.push('第3轮：' + e.message); console.log('FAIL 第3轮：' + e.message); }

/* ═══ 第 4 轮：多步计划 + 等待 + 重启后现场仍在 ═══════════════════════════ */
console.log('\n===== 第 4/5 轮：多步计划 / 等待 / 重启持久化 =====');
const file4 = path.join(APPDATA, '@warmy', 'app-shell', 'workspace', sid, 'r100-round4.txt');
try {
  const a0 = JSON.parse(await actionsOf()).length;
  const m = await send('请一步一步做：先调用 plan_update 建立 3 步计划；第 1 步用 write_file 在当前工作区创建 r100-round4.txt，写入三句中文；第 2 步调用 wait_seconds 等待 2 秒；第 3 步用 read_file 读回并在最终回复里总结。必须真的调用这些工具。');
  const acts = JSON.parse(await actionsOf()).slice(a0);
  const names = acts.map((x) => x.op);
  ok('4.1 有 plan_update', names.some((n) => /plan_update|更新计划/.test(n)), names.join(','));
  ok('4.2 有 write_file', names.some((n) => /write_file|写入/.test(n)), names.join(','));
  ok('4.3 有 wait_seconds', names.some((n) => /wait_seconds/.test(n)), names.join(','));
  ok('4.4 有 read_file', names.some((n) => /read_file|读取/.test(n)), names.join(','));
  let txt = '';
  try { txt = fs.readFileSync(file4, 'utf8'); } catch { /* 没有 */ }
  ok('4.5 文件真的写出来了', txt.trim().length > 0, txt.slice(0, 40));
  ok('4.6 最终回复非空', String(m && m.text || '').trim().length > 0);
  const persisted = await ev(`window.warmy.chatMessages({sessionId:${JSON.stringify(sid)},limit:8}).then(r=>JSON.stringify((r.xiaoXiJi||[]).slice(-1)[0]||null))`);
  const p = JSON.parse(persisted);
  ok('4.7 落盘的最终回复带思考分段', Array.isArray(p.reasoningDuan) && p.reasoningDuan.length > 0, 'rd=' + ((p.reasoningDuan || []).length));
  ok('4.8 落盘的操作记录非空', Array.isArray(p.xingDong) && p.xingDong.length > 0, 'xd=' + ((p.xingDong || []).length));
} catch (e) { fails.push('第4轮：' + e.message); console.log('FAIL 第4轮：' + e.message); }

/* ═══ 第 5 轮：设置/插件/独立窗 + 短问答 ═══════════════════════════════════ */
console.log('\n===== 第 5/5 轮：设置插件 / 独立会话窗 / 短问答 =====');
try {
  await ev(`document.querySelector('[data-nav="settings"]')?.click()`); await sleep(700);
  await ev(`document.querySelector('[data-sec="plugin"]')?.click()`); await sleep(400);
  const plug = await ev(`JSON.stringify([...document.querySelectorAll('.ctgHang')].map(x=>x.innerText.slice(0,12)))`);
  ok('5.1 插件页能看到 nm 文件查看器（内置插件不再被挤掉）', String(plug).includes('nm文件'), String(plug).slice(0, 80));
  await ev(`document.querySelector('[data-sec="func"]')?.click()`); await sleep(300);
  const nmBtn = await ev(`(document.getElementById('anNiuNmChaJianAnZhuang')||{}).textContent||''`);
  ok('5.2 功能页有安装/重装按钮', /安装|重装/.test(nmBtn), nmBtn);
  await ev(`document.querySelector('[data-nav="singleAi"]')?.click()`); await sleep(500);

  // 独立会话窗：任务栏/标题用会话名；关闭不需要二次确认
  await ev(`window.warmy.openChatWindow({id:${JSON.stringify(sid)}, biaoTi:'牛马-1', title:'牛马-1', kind:'single', mode:'fu'})`);
  await sleep(1500);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const fu = list.find((x) => x.type === 'page' && x.url.includes('mode=fu'));
  ok('5.3 能打开独立会话窗', !!fu);
  if (fu) {
    const c2 = await attach(PORT, { matchUrlIncludes: 'mode=fu' });
    const title = await c2.evaluate('document.title');
    ok('5.4 独立窗标题使用会话名称', String(title).includes('牛马-1'), title);
    await c2.evaluate(`document.getElementById('anNiuwinGuanBi').click()`).catch(() => null);
    await sleep(1200);
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    ok('5.5 独立窗关闭无需二次确认（窗口已消失）', !list.some((x) => x.type === 'page' && x.url.includes('mode=fu')));
    try { c2.close(); } catch { /* noop */ }
  }
  const m = await send('请用一句中文回答：今天适合做什么？');
  ok('5.6 短问答正常完成', String(m && m.text || '').trim().length >= 4, String(m && m.text || '').slice(0, 50));
} catch (e) { fails.push('第5轮：' + e.message); console.log('FAIL 第5轮：' + e.message); }

/* 清理本轮测试产物（只删我们自己创建的两个文件） */
for (const f of [file2, file4]) {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* noop */ }
}

console.log(`\n==== r100-live-5-rounds：${pass} PASS / ${fails.length} FAIL ====`);
for (const f of fails) console.log('  FAIL ' + f);
c.close();
process.exit(fails.length ? 1 : 0);
