/**
 * r101-live-5-rounds.mjs —— 第 101 轮真实模型连续 5 轮验收。
 * 只用 MiMo / 本地 Ollama，**不使用 DeepSeek key**。
 *
 * 每轮内容不同，覆盖：
 *  1) 现有会话的「过程引用」卡 + 纯问答
 *  2) 工具写文件/读回 + 操作记录浮雕
 *  3) 单聊中途停止（停止后不再执行、内容保留、可继续）
 *  4) 项目（群聊）中途停止（执行者不再起跑/晚到不收成新操作）
 *  5) 话筒菜单几何 + 嵌套滚动 + nm 聊天编辑器撤销/前进 + 短问答
 *
 * 用法：应用已用 --remote-debugging-port=9888 启动，且已登录：
 *   node dev/gates/r101-live-5-rounds.mjs
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
const actionsOf = (x) => ev(`JSON.stringify((window.__xingDongQu?window.__xingDongQu(${JSON.stringify(x)}) : []).map(a=>({hao:a.hao,op:a.op,status:a.status,stopped:!!a.stopped,ts:a.ts})))`);

async function send(prompt, { timeout = 240000 } = {}) {
  const n0 = await countOf();
  await ev(`(function(){const t=document.getElementById('shuRu'); t.value=${JSON.stringify(prompt)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`);
  const t0 = Date.now();
  for (;;) {
    await sleep(800);
    const n = await countOf();
    const b = await busy();
    if (!b && n > n0 && Date.now() - t0 > 1500) {
      const m = JSON.parse(await lastOf());
      if (m && m.role === 'them') return m;
    }
    if (Date.now() - t0 > timeout) throw new Error('模型回复超时 ' + Math.round(timeout / 1000) + 's');
  }
}

/* ═══ 第 1 轮：过程引用卡 + 纯问答 ═══════════════════════════════════════ */
console.log('\n===== 第 1/5 轮：过程引用卡 + 纯问答 =====');
try {
  const gcy = await sleepTo(async () => JSON.parse(await ev(`JSON.stringify({n:document.querySelectorAll('.guoChengYinYong').length,rows:[...document.querySelectorAll('.guoChengYinYong .gcyHang')].length,sum:[...document.querySelectorAll('.guoChengYinYong summary')].map(x=>x.innerText.slice(0,50))})`)), 8000, '过程引用卡');
  ok('1.1 旧过程引用卡已不存在', gcy.n === 0, JSON.stringify(gcy).slice(0, 160));
  const m = await send('请只回答一个数字，不要解释：6 × 7 等于多少？');
  ok('1.2 拿到非空最终回复', !!m && String(m.text || '').trim().length > 0, String(m && m.text).slice(0, 40));
  ok('1.3 算术结果正确（42）', /42/.test(String(m && m.text || '')));
  ok('1.4 这一轮没有被误标为已停止', m && m.stopped !== true);
} catch (e) { fails.push('第1轮：' + e.message); console.log('FAIL 第1轮：' + e.message); }

/* ═══ 第 2 轮：写文件 / 读回 / 操作浮雕 ═══════════════════════════════════ */
console.log('\n===== 第 2/5 轮：写文件 / 读回 / 操作浮雕 =====');
try {
  const biao = 'r101-live-' + Date.now().toString(36);
  const m = await send('请在项目工作区写一个文件 ' + biao + '.txt，内容写 R101-LIVE-OK；然后读回这个文件确认内容，再用一句话告诉我内容。必须先调用工具，不能只说话。');
  const acts = JSON.parse(await actionsOf(sid));
  const ren = acts.slice(-12).map((x) => x.op).join(',');
  ok('2.1 调用了写文件', /write_file|写入/.test(ren), ren);
  ok('2.2 调用了读文件', /read_file|读取/.test(ren), ren);
  const dir = path.join(APPDATA, '@warmy', 'app-shell', 'workspace', sid);
  const zhao = (d) => {
    const out = [];
    if (!fs.existsSync(d)) return out;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...zhao(p));
      else if (e.name === biao + '.txt') out.push(p);
    }
    return out;
  };
  const found = zhao(dir);
  const txt = found.length ? fs.readFileSync(found[0], 'utf8') : '';
  ok('2.3 文件真的落盘且内容正确', /R101-LIVE-OK/.test(txt), txt.slice(0, 40));
  ok('2.4 最终回复提到文件内容或文件名', new RegExp(biao + '|R101-LIVE-OK', 'i').test(String(m && m.text || '')), String(m && m.text).slice(0, 80));
  // 操作记录展开后，整条记录是浮雕卡
  const emb = await ev(`(function(){
    const ms=[...document.querySelectorAll('#xiaoXiJi .xiaoXi.them')]; const last=ms[ms.length-1];
    const hang=last&&last.querySelector('.siKaoKuai .xingDongHang'); if(!hang) return {ok:false,why:'no-action'};
    hang.click();
    const zu=hang.closest('.xingDongZu'); const det=zu&&zu.querySelector('.xingDongXiang');
    if(!zu||!det) return {ok:false,why:'no-detail'};
    const cz=getComputedStyle(zu), ch=getComputedStyle(hang);
    return {ok:true,open:!det.classList.contains('yinCang'),shadow:cz.boxShadow.slice(0,80),hangShadow:ch.boxShadow,hasDet:!!det};
  })()`);
  ok('2.5 操作记录展开后仍包在浮雕卡里', emb && emb.ok && emb.open && /inset/.test(String(emb.shadow)) && emb.hangShadow === 'none', JSON.stringify(emb).slice(0, 160));
} catch (e) { fails.push('第2轮：' + e.message); console.log('FAIL 第2轮：' + e.message); }

/* ═══ 第 3 轮：单聊中途停止 ═══════════════════════════════════════════════ */
console.log('\n===== 第 3/5 轮：单聊中途停止 =====');
try {
  const n0 = await countOf();
  const t0 = Date.now();
  await ev(`(function(){const t=document.getElementById('shuRu'); t.value='请完成一个 6 步任务，每一步都必须调用工具：1) 写 r101-stop-a.txt 第一段；2) 读回；3) 追加第二段；4) 再读回；5) 写 r101-stop-b.txt；6) 读回并总结。每完成一步先告诉我进度。'; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuFaSong').click(); return true;})()`);
  let before = [];
  const stopTs = await sleepTo(async () => {
    const acts = JSON.parse(await actionsOf(sid));
    before = acts.filter((x) => Number(x.ts) >= t0);
    if (before.length >= 2) { return Date.now(); }
    if (Date.now() - t0 > 30000) return Date.now();
    return 0;
  }, 35000, '停止前的操作');
  await ev(`document.getElementById('anNiuTingZhiAll')?.click()`);
  await sleep(1200);
  const m = JSON.parse(await lastOf());
  ok('3.1 停止后立即出现 stopped 气泡', m && m.stopped === true, String(m && m.text).slice(0, 40));
  ok('3.2 停止摘要/执行记录可见', await ev(`!!document.querySelector('#xiaoXiJi .xiaoXi.them:last-of-type .tingZhiZhaiYao, #xiaoXiJi .tingZhiZhaiYao')`) === true);
  const nAfter = await countOf();
  const actsAfter = JSON.parse(await actionsOf(sid)).filter((x) => Number(x.ts) > stopTs);
  await sleep(8000);
  const nLater = await countOf();
  const actsLater = JSON.parse(await actionsOf(sid)).filter((x) => Number(x.ts) > stopTs);
  ok('3.3 停止后不再冒出新回复', nLater === nAfter, 'n=' + nAfter + '->' + nLater);
  ok('3.4 停止后不再执行新操作', actsLater.length === 0, JSON.stringify(actsLater).slice(0, 120));
  const cm = await ev(`window.warmy.chatMessages({sessionId:${JSON.stringify(sid)},limit:10})`);
  const last = (cm && cm.xiaoXiJi || []).slice(-1)[0] || {};
  ok('3.5 停止现场落盘：stopped + 思考/操作至少一项', last.stopped === true && ((last.reasoningDuan || []).length > 0 || (last.xingDong || []).length > 0), JSON.stringify({rd: (last.reasoningDuan || []).length, xd: (last.xingDong || []).length, stopped: last.stopped}));
  const m2 = await send('请只回答数字 2，不要解释。');
  ok('3.6 停止后用户再说话仍可继续', /2/.test(String(m2 && m2.text || '')), String(m2 && m2.text).slice(0, 30));
} catch (e) { fails.push('第3轮：' + e.message); console.log('FAIL 第3轮：' + e.message); }

/* ═══ 第 4 轮：项目中途停止 ═══════════════════════════════════════════════ */
console.log('\n===== 第 4/5 轮：项目中途停止 =====');
try {
  const iid = sid;
  const gid = 'g-r101live-' + Date.now().toString(36);
  await ev(`window.warmy.groupCreate({ groupId: ${JSON.stringify(gid)}, ming: 'R101 live 项目', type: 'internal', directedMode: false, devEnv: 'host' })`);
  await ev(`window.warmy.groupJoinInstance(${JSON.stringify(gid)}, ${JSON.stringify(iid)})`);
  const startTs = Date.now();
  await ev(`(function(){window.__r101lg={done:false}; window.warmy.chatSend({sessionId:${JSON.stringify(gid)},content:'请完成一个必须调用工具的 6 步任务：1) 写 r101g-a.txt 第一段；2) 读回；3) 追加第二段；4) 再读回；5) 写 r101g-b.txt；6) 读回并总结。每完成一步先告诉我进度。',ming:'验收员',role:'user'}).then(r=>{window.__r101lg={done:true,r}}).catch(e=>{window.__r101lg={done:true,err:String(e&&e.message||e)}}); return true;})()`);
  const stopTs = await sleepTo(async () => {
    const acts = JSON.parse(await actionsOf(gid)).filter((x) => Number(x.ts) >= startTs);
    if (acts.length >= 2) return Date.now();
    if (Date.now() - startTs > 35000) return Date.now();
    return 0;
  }, 40000, '项目停止前的操作');
  const r = await ev(`window.warmy.stopChat(${JSON.stringify(gid)},{stopTs:${stopTs}})`);
  const done = await sleepTo(async () => {
    const x = JSON.parse(await ev(`JSON.stringify(window.__r101lg||{})`));
    return x.done ? x : null;
  }, 15000, '项目 chatSend 收尾');
  const actsAfter = JSON.parse(await actionsOf(gid)).filter((x) => Number(x.ts) > stopTs);
  await sleep(6000);
  const actsLater = JSON.parse(await actionsOf(gid)).filter((x) => Number(x.ts) > stopTs);
  const cm = await ev(`window.warmy.chatMessages({sessionId:${JSON.stringify(gid)},limit:20})`);
  const last = (cm && cm.xiaoXiJi || []).slice(-1)[0] || {};
  ok('4.1 项目停止立即返回', r && r.ok === true && r.stopped === true, JSON.stringify(r).slice(0, 80));
  ok('4.2 项目 chatSend 以 stopped 收尾', done && done.r && done.r.stopped === true, JSON.stringify(done).slice(0, 100));
  ok('4.3 停止后不再执行新操作', actsLater.length === 0, JSON.stringify(actsLater).slice(0, 120));
  ok('4.4 项目聊天有 stopped 消息', last.stopped === true, JSON.stringify({ stopped: last.stopped, text: String(last.text || '').slice(0, 30) }));
} catch (e) { fails.push('第4轮：' + e.message); console.log('FAIL 第4轮：' + e.message); }

/* ═══ 第 5 轮：UI 组合 + 短问答 ═══════════════════════════════════════════ */
console.log('\n===== 第 5/5 轮：话筒菜单 / 嵌套滚动 / nm 编辑器 / 短问答 =====');
try {
  const voice = JSON.parse(await ev(`(function(){
    const b=document.getElementById('anNiuYuYinXiaLa'), m=document.getElementById('yuYinCaiDan');
    if(!b||!m) return '{"ok":false}';
    b.click(); const rb=b.getBoundingClientRect(), rm=m.getBoundingClientRect();
    const mic=document.getElementById('anNiuYuYin').getBoundingClientRect();
    const zhu=m.closest('.shuRuQuZhu'); const zr=zhu?zhu.getBoundingClientRect():null;
    const rows=[...m.querySelectorAll('.yuYinHang')].length, dd=[...m.querySelectorAll('.ddWen')].length;
    return JSON.stringify({ok:true,gap:Math.round(rb.left-mic.right),mb:Math.round(zr?zr.bottom:0),mt:Math.round(rm.top),mh:Math.round(rm.height),rows,dd,clip:zhu?getComputedStyle(zhu).overflow:''});
  })()`));
  ok('5.1 话筒与箭头挨着', voice.ok && voice.gap === 0, JSON.stringify(voice).slice(0, 120));
  ok('5.2 语音菜单完整显示（顶部不低于输入区顶）', voice.ok && voice.mh >= 80 && voice.mt < voice.mb, JSON.stringify(voice).slice(0, 120));
  ok('5.3 两个勾选项 + 两个问号', voice.rows === 2 && voice.dd === 2, JSON.stringify(voice).slice(0, 120));
  const chain = JSON.parse(await ev(`(function(){
    const old=document.getElementById('r101chain'); if(old) old.remove();
    const box=document.createElement('div'); box.id='r101chain'; box.style.cssText='position:fixed;left:8px;top:8px;width:280px;height:240px;z-index:99999;background:#fff;overflow:hidden';
    box.innerHTML='<div id="r101o" style="height:160px;overflow:auto"><div style="height:70px">t</div><div id="r101i" style="height:70px;overflow:auto"><div style="height:200px">i</div></div><div style="height:160px">b</div></div>';
    document.body.appendChild(box);
    const o=document.getElementById('r101o'), i=document.getElementById('r101i');
    i.scrollTop=i.scrollHeight-i.clientHeight; o.scrollTop=0;
    i.dispatchEvent(new WheelEvent('wheel',{deltaY:50,bubbles:true,cancelable:true}));
    const moved=o.scrollTop; box.remove(); return JSON.stringify({moved});
  })()`));
  ok('5.4 内层触底后外层被带动', chain.moved > 0, JSON.stringify(chain));
  // nm 聊天编辑器撤销/前进
  await ev(`(function(){const t=document.getElementById('shuRu'); t.value='R101 编辑器初始'; t.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('anNiuBianJiQi').click(); return true;})()`);
  let target = null;
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    const r = await fetch('http://127.0.0.1:' + PORT + '/json');
    const list = await r.json();
    target = (list || []).find((x) => x.type === 'page' && String(x.url || '').includes('nm-viewer.html') && String(x.url || '').includes('chatEditor=1'));
    if (target) break;
  }
  if (target) {
    const ed = await attach(PORT, { matchUrlIncludes: 'chatEditor=1' });
    await ed.waitFor(`!!document.getElementById('wenBen')`, { timeout: 8000 });
    const e2 = (x) => ed.evaluate(x);
    await e2(`(function(){const t=document.getElementById('wenBen'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t,'R101 编辑器改过'); t.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
    await sleep(1200);
    const backOn = await e2(`document.getElementById('anNiuHouTui').disabled === false`);
    await e2(`document.getElementById('anNiuHouTui').click()`);
    await sleep(400);
    const v1 = await e2(`document.getElementById('wenBen').value`);
    await e2(`document.getElementById('anNiuQianJin').click()`);
    await sleep(400);
    const v2 = await e2(`document.getElementById('wenBen').value`);
    ok('5.5 聊天编辑器：编辑后后退可用且能还原', backOn && v1 === 'R101 编辑器初始', v1);
    ok('5.6 聊天编辑器：前进能恢复修改文', v2 === 'R101 编辑器改过', v2);
    await e2(`window.close()`).catch(() => {});
  } else {
    ok('5.5 聊天编辑器窗口能打开', false, 'no target');
    ok('5.6 聊天编辑器历史可用', false, 'no target');
  }
  const m = await send('请用一句中文短诗结尾，不要解释。');
  ok('5.7 第 5 轮短问答正常完成', String(m && m.text || '').trim().length >= 2, String(m && m.text).slice(0, 50));
} catch (e) { fails.push('第5轮：' + e.message); console.log('FAIL 第5轮：' + e.message); }

console.log('\n===== 结果 =====');
console.log('PASS ' + pass + ' / FAIL ' + fails.length);
for (const f of fails) console.log(' - ' + f);
process.exit(fails.length ? 1 : 0);
