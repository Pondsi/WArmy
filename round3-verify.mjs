/**
 * round3-verify.mjs —— 一轮验收：**基本功能 + 本轮改动**（真 Electron + 真本地 Ollama）
 * 跑法：node round3-verify.mjs 1|2|3
 *
 * 本轮改动点都要有断言：
 *   · 附件拖入 = 图标行（悬停全路径、data-art-open/reveal）
 *   · 发出的消息：正文**不再**出现 [附件路径] 文字，改图标行挂在气泡下
 *   · 回复：产出文件也挂图标行
 *   · 自动滚动策略：未勾选 = min(lastTop, maxScroll)（新内容开头对齐顶）
 *   · 文件产物卡片：title 含 大小 + 完整时间；两个图标是 SVG（不是 emoji）
 *   · 不该出现「继续/重试」
 *   · 真 AI 对话 + 真工具调用（get_time）
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attach, sleep } from 'file:///C:/wbuild/packages/app-shell/scripts/cdp-lib.mjs';

const PKG = 'C:\\wbuild\\packages\\app-shell';
const DATA = path.join(process.env.APPDATA, '@warmy', 'app-shell');
const PORT = 9460;
const LUN = Number(process.argv[2] || 1);
const OUT = path.join(os.tmpdir(), 'warmy-round3');
fs.mkdirSync(OUT, { recursive: true });
const DROPPED = path.join(OUT, 'round3-附件.txt');
fs.writeFileSync(DROPPED, 'round3 附件内容 ' + Date.now() + '\n你好，我是测试附件。', 'utf8');
const auditPath = path.join(DATA, 'audit', 'audit.jsonl');
const readFrom = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const okList = [];
const ok = (c, l, extra) => { okList.push(!!c); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (extra !== undefined ? '  => ' + String(extra).slice(0, 160) : '')); };

try { execFileSync('taskkill', ['/F', '/IM', 'electron.exe', '/T'], { stdio: 'ignore' }); } catch { /* noop */ }
await sleep(1500);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(PKG, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [`--user-data-dir=${DATA}`, `--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion', path.join(PKG, 'dist', 'electron-main.js')],
  { cwd: PKG, stdio: ['ignore', 'pipe', 'pipe'], env });
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));
console.log(`== 第 ${LUN} 轮 真机验收 pid=${child.pid}`);

let c = null;
const EV = (e) => c.evaluate(e, { timeout: 30000 });
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* 未起 */ } if (!up) await sleep(700); }
  if (!up) throw new Error('CDP 未起来');
  c = await attach(PORT, { biaoQian: 'r3-' + LUN, callTimeout: 30000 });
  await c.send('Runtime.enable');
  await c.waitFor('typeof window.__saveState === "function" && typeof window.warmy === "object"', { timeout: 60000, biaoQian: '渲染层就绪' });
  await sleep(3500);
  await EV(`(function(){var g=document.getElementById('duiHuaKuangGen');if(g&&!g.classList.contains('yinCang')){var b=document.querySelector('#duiHuaKuangDongZuoJi button');if(b)b.click();}return 1;})()`);
  await sleep(500);

  console.log('\n[1] 基本：启动态');
  const st = JSON.parse(await EV('JSON.stringify(window.__warmyDebugState())'));
  const li = JSON.parse(await EV('(async()=>JSON.stringify((await window.warmy.listInstances())||[]))()'));
  ok(li.length > 0, '重启后牛马仍在（实例定义持久化）', li.length);
  ok(st.selected !== null, '会话已选中', String(st.selected));
  const box = JSON.parse(await EV(`JSON.stringify((function(){var q=document.querySelector('.shuRuQu');var r=q.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})())`));
  ok(box.w > 0 && box.h > 0, '输入区可见', JSON.stringify(box));

  console.log('\n[2] 本轮改动：拖入附件 = 图标行');
  const drop0 = await EV(`document.querySelectorAll('#attachLieBiao .attachChip').length`);
  const v = JSON.parse(await EV(`JSON.stringify((function(){var q=document.querySelector('.shuRuQu');var r=q.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})())`));
  const data = { items: [], files: [DROPPED], dragOperationsMask: 1 };
  for (const t of ['dragEnter', 'dragOver', 'drop']) await c.send('Input.dispatchDragEvent', { type: t, x: v.x, y: v.y, data }, { timeout: 15000 });
  await sleep(1400);
  const chips = JSON.parse(await EV(`JSON.stringify(Array.from(document.querySelectorAll('#attachLieBiao .attachChip')).map(function(e){return {t:String(e.textContent||'').trim(), title:e.getAttribute('title')||'', open:e.getAttribute('data-art-open')||'', reveal:e.getAttribute('data-art-reveal')||'', ico:!!e.querySelector('svg')};}))`));
  console.log('  附件条目 =', JSON.stringify(chips));
  ok(chips.length > drop0, '拖入的真文件进入附件列表', chips.length);
  ok(chips.some((x) => String(x.open).includes('round3-附件.txt')), '图标行带 data-art-open（左键打开）', chips.map((x) => x.open).join('|'));
  ok(chips.some((x) => String(x.reveal).includes('round3-附件.txt')), '图标行带 data-art-reveal（右键定位）', chips.map((x) => x.reveal).join('|'));
  ok(chips.some((x) => x.ico), '附件条目带文件图标（SVG）', chips.map((x) => x.ico).join('|'));
  ok(chips.some((x) => String(x.title).includes('round3-附件.txt')), '悬停 title 是完整路径', chips[0] && chips[0].title);

  console.log('\n[3] 基本：真 AI 对话（本地 Ollama）+ 本轮改动（正文不带路径文字、气泡下挂图标行）');
  const wen = '只回一句话：请报出你的模型名。第 ' + Date.now() + ' 号。';
  const a0 = readFrom(auditPath).length;
  await EV(`(function(){var t=document.getElementById('shuRu');t.value=${JSON.stringify(wen)};t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await c.clickSelector('#anNiuFaSong');
  let tail = '', lunWan = false, qiPao = null;
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const s = JSON.parse(await EV(`JSON.stringify((function(){
      var ps=document.querySelectorAll('#xiaoXiJi .xiaoXi');
      var last=ps.length?ps[ps.length-1]:null;
      return { busy:!!document.getElementById('anNiuFaSong').classList.contains('faSongZhong'),
        n:ps.length, lastText:last?String(last.textContent||''):'',
        lastHtml:last?String(last.innerHTML||'').slice(0,400):'',
        userText: ps.length>=2?String(ps[0].textContent||''):'' };
    })())`));
    tail = s.lastText; qiPao = s;
    lunWan = /chat\.tools\.done/.test(readFrom(auditPath).slice(a0));
    console.log(`  +${(i + 1) * 4}s 忙=${s.busy} 气泡=${s.n} 本轮结束=${lunWan}`);
    if (lunWan && !s.busy) break;
  }
  {
    // 尾巴可能是「暂停自动继续」等系统条：取最后一条**牛马回复**（非 wo）判断模型名
    const themTxt = await EV(`(function(){var ps=document.querySelectorAll('#xiaoXiJi .xiaoXi');var t='';for(var i=ps.length-1;i>=0;i--){var c=ps[i].className||'';if(c.indexOf('wo')<0&&c.indexOf('liuShi')<0){t=ps[i].textContent||'';if(t.trim())break;}}return t;})()`);
    ok(/Qwen3\\.6-35B-A3B-IQ3_M|qwen/i.test(String(themTxt||tail)), '收到本地 Ollama 的真实回复', String(themTxt||tail).slice(-90).replace(/\s+/g, ' '));
  }
  // 本轮改动：**回复落地后不许残留流式/尾部碎片气泡**（真机：末尾多出一条「看过了。」）
  const liuShi = await EV(`document.querySelectorAll('#xiaoXiJi .liuShiKuai').length`);
  const zuiHou = JSON.parse(await EV(`JSON.stringify((function(){
    var ps=document.querySelectorAll('#xiaoXiJi .xiaoXi');
    var z=ps.length?ps[ps.length-1]:null;
    return { n:ps.length, cls:z?String(z.className):'', txt:z?String(z.textContent||'').trim().slice(0,40):'' };
  })())`));
  console.log('  尾部气泡 =', JSON.stringify(zuiHou));
  ok(Number(liuShi) === 0, '回复落地后没有残留的流式/尾部气泡', liuShi);
  ok(!/liuShiKuai/.test(String(zuiHou.cls)), '最后一条不是流式碎片气泡', zuiHou.cls);
  const userBubbles = JSON.parse(await EV(`JSON.stringify(Array.from(document.querySelectorAll('#xiaoXiJi .xiaoXi')).map(function(e){return String(e.textContent||'');}))`));
  const lastUser = (userBubbles[0] || '');
  ok(!/\[附件路径\]/.test(lastUser), '发出的消息正文**不再**含 [附件路径] 文字', lastUser.slice(-60).replace(/\s+/g, ' '));
  const hangShu = await EV(`document.querySelectorAll('#xiaoXiJi .huiFuFuJianHang').length`);
  ok(Number(hangShu) >= 1, '气泡下挂了附件图标行', hangShu);
  const hangOpen = await EV(`JSON.stringify(Array.from(document.querySelectorAll('#xiaoXiJi .huiFuFuJianHang .attachChip')).map(function(e){return {open:e.getAttribute('data-art-open')||'', ico:!!e.querySelector('svg')};}))`);
  ok(String(hangOpen).includes('round3-附件.txt'), '图标行含刚拖入的附件（可打开）', hangOpen);

  console.log('\n[4] 基本：真工具调用（get_time + write_file，产出文件走图标行）');
  const a1 = readFrom(auditPath).length;
  let toolOk = false, xieWenJian = false;
  for (let ci = 1; ci <= 2 && !(toolOk && xieWenJian); ci++) {
    const q = ci === 1
      ? '请调用 get_time 工具查出当前时间，然后必须调用 write_file 把时间写进 round3-时间.txt（写在工作区里），最后一句话告诉我现在几点。第 ' + Date.now() + ' 号。'
      : '你刚才没有调用 write_file。现在**只做一件事**：调用 write_file，把内容 "ok" 写进 round3-时间.txt（相对工作区）。第 ' + Date.now() + ' 号。';
    const aq = readFrom(auditPath).length;
    await EV(`(function(){var t=document.getElementById('shuRu');t.value=${JSON.stringify(q)};t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await c.clickSelector('#anNiuFaSong');
    for (let i = 0; i < 90; i++) {
      await sleep(4000);
      const sc = readFrom(auditPath).slice(aq);
      const t1 = /chat\.host-tool[^\n]*"tool":"get_time","ok":true/.test(sc);
      const t2 = /chat\.work-tool[^\n]*"tool":"write_file","ok":true/.test(sc);
      toolOk = toolOk || t1;
      xieWenJian = xieWenJian || t2;
      const busy = await EV(`!!document.getElementById('anNiuFaSong').classList.contains('faSongZhong')`);
      console.log(`  第${ci}次 +${(i + 1) * 4}s get_time=${t1} write_file=${t2} 忙=${busy}`);
      if (busy === false && i > 2) break;
      if (t1 && t2 && !busy) break;
    }
  }
  ok(toolOk, '真实工具调用 get_time 成功', toolOk);
  ok(xieWenJian, '真实工具调用 write_file 成功（产出文件）', xieWenJian);

  console.log('\n[5] 本轮改动：不许出现「继续/重试」（ETA 误判已修）');
  const huoFuBtn = await EV(`document.querySelectorAll('#xiaoXiJi .huiFuRenWuBtn').length`);
  const an = readFrom(auditPath).slice(a0);
  ok(Number(huoFuBtn) === 0, '界面上没有「继续/重试」按钮', huoFuBtn);
  ok(!/plan\.task-interrupted|plan\.eta-anomaly"/.test(an), '没有任务中断/异常误判', (an.match(/plan\.[a-z-]+/g) || []).join(','));

  console.log('\n[6] 本轮改动：自动滚动策略 = min(lastTop, maxScroll)');
  const gun = JSON.parse(await EV(`JSON.stringify((function(){
    var he=document.getElementById('xiaoXiJi'); if(!he) return {ok:false};
    var last=he.lastElementChild;
    var maxScroll=Math.max(0, he.scrollHeight-he.clientHeight);
    var mu=last?Math.min(last.offsetTop, maxScroll):null;
    return {ok:true, top:Math.round(he.scrollTop), muBiao:mu===null?null:Math.round(mu), max:Math.round(maxScroll), chai: last?Math.abs(he.scrollTop-Math.min(last.offsetTop,maxScroll)): -1};
  })())`));
  console.log('  滚动现场 =', JSON.stringify(gun));
  ok(gun.ok && gun.chai <= 2, '未勾选时停在「新内容开头对齐顶 / 顶到底为止」', JSON.stringify(gun));

  console.log('\n[7] 本轮改动：文件产物卡片 tooltip 含大小与完整时间、图标是 SVG');
  // ⚠️ 必须在**右栏可见**的时候量（我的页/设置页右栏是隐藏的，量出来全是 0 —— 第一版就踩了这个）
  await EV(`(function(){var e=document.querySelector('.ceLanTiaoMu[data-nav="singleAi"]');if(e)e.click();return 1;})()`);
  await sleep(1200);
  await EV(`(function(){var b=document.getElementById('anNiuShuaXinChanPin');if(b)b.click();return 1;})()`);
  await sleep(1200);
  const pf = JSON.parse(await EV(`JSON.stringify((function(){
    // 只认**产物行**（带 .pfIconBtn 的那种），别把"产品目录/其它文件"的行也拿来量
    var rows=[...document.querySelectorAll('.pfHang')].filter(function(r){return r.querySelector('button.pfIconBtn') && r.querySelector('.pfFuXinXi');});
    var r=rows[rows.length-1];
    if(!r) return {n:rows.length};
    var btns=[...r.querySelectorAll('button.pfIconBtn')];
    var svgs=btns.map(function(b){var s=b.querySelector('svg');if(!s)return {w:0,h:0};var q=s.getBoundingClientRect();var p=s.querySelector('path');var pb=p?p.getBoundingClientRect():null;return {w:Math.round(q.width),h:Math.round(q.height),pw:pb?Math.round(pb.width):0,ph:pb?Math.round(pb.height):0};});
    var fu=r.querySelector('.pfFuXinXi');
    return { n:rows.length, title:r.getAttribute('title')||'',
      hasSize:/大小|B|KB|MB/.test(r.getAttribute('title')||''),
      hasTime:/\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}/.test(r.getAttribute('title')||''),
      svgs:svgs, emoji:/📁|🗑/.test(r.innerHTML),
      fuWen: fu?String(fu.textContent||''):'', mingKuang: !!r.querySelector('.pfMing') };
  })())`));
  console.log('  产物行 =', JSON.stringify(pf));
  ok((pf.n || 0) > 0, '文件产物卡片有行', pf.n);
  ok(pf.hasSize, '悬停 title 含文件大小', pf.title);
  ok(pf.hasTime, '悬停 title 含完整年月日', pf.title);
  ok((pf.svgs || []).length === 2 && (pf.svgs || []).every((x) => x.pw > 0 && x.ph > 0), '两个图标按钮的 SVG **真的画出来了**（路径有尺寸，不是空框）', JSON.stringify(pf.svgs));
  ok(pf.emoji === false, '不再用 emoji（📁/🗑）', pf.emoji);
  // 列表里：大小不带「（N 字节）」；时间只到时分；文件名是截断而不是整块隐藏
  ok(!/字节/.test(String(pf.fuWen)), '大小不再显示括号里的字节', pf.fuWen);
  ok(!/\d{4}[-/]/.test(String(pf.fuWen)), '列表里的时间只到时分（不含年月日）', pf.fuWen);
  ok(/\d{1,2}:\d{2}/.test(String(pf.fuWen)), '列表里能看到「时:分」', pf.fuWen);
  ok(pf.mingKuang === true, '文件名在（窄卡片下是截断，不是整块不显示）', pf.mingKuang);

  const errs = c.errors();
  console.log('\n[渲染层异常] ' + (errs.length ? errs.slice(-8).join(' | ') : '（无）'));
  ok(errs.length === 0, '全程无渲染层异常', errs.slice(-2).join('|'));

  /* ============ 阶段 10：本轮修复 —— 「嘴上说做了、实际没调工具」必须被逮住 ============ */
  console.log('\n===== 阶段 10：如实性护栏（口头完成） =====');
  {
    await EV(`(function(){var e=document.querySelector('.ceLanTiaoMu[data-nav="singleAi"]');if(e)e.click();return 1;})()`);
    await sleep(900);
    await EV(`(function(){var it=document.querySelector('#lieBiaoTi .lieBiaoTiaoMu');if(it)it.click();return 1;})()`);
    await sleep(1200);
    const a9 = readFrom(auditPath).length;
    // 明确"不要调工具、只回一句已完成" ⇒ 稳定复现"口头完成"
    const q = '请不要调用任何工具，只回复这一句话，不要做别的事：桌面文件已生成并打开 ✅ 请老板验收。第 ' + Date.now() + ' 号。';
    await EV(`(function(){var t=document.getElementById('shuRu');t.value=${JSON.stringify(q)};t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await c.clickSelector('#anNiuFaSong');
    let jianCe = false;
    for (let i = 0; i < 40; i++) {
      await sleep(4000);
      const sc = readFrom(auditPath).slice(a9);
      jianCe = /chat\.false-claim/.test(sc);
      const busy = await EV(`!!document.getElementById('anNiuFaSong').classList.contains('faSongZhong')`);
      console.log(`  +${(i + 1) * 4}s 逮到口头完成=${jianCe} 忙=${busy}`);
      if (jianCe && !busy) break;
    }
    const sc = readFrom(auditPath).slice(a9);
    console.log('  相关审计 =', (sc.match(/chat\.false-claim[^\n]*/) || ['（无）'])[0].slice(0, 200));
    ok(jianCe, '「说做了但一次工具都没调」被逮住（审计 chat.false-claim）', jianCe);
    const replyYou = String(await EV(`String((document.getElementById('xiaoXiJi')||{}).textContent||'')`));
    ok(/没有实际调用任何工具/.test(replyYou), '回复里带了如实说明（不再让它"骗"用户）', replyYou.slice(-160).replace(/\s+/g, ' '));
  }

  /* ============ 阶段 8：本轮改动 —— 牛马社交信息（987 条上限 / 限高 10 行 / 滚动时出搜索框） ============ */
  console.log('\n===== 阶段 8：社交信息 =====');
  await EV(`(function(){var b=document.getElementById('duiHuaKuangGen');if(b&&!b.classList.contains('yinCang')){var x=document.querySelector('#duiHuaKuangDongZuoJi button');if(x)x.click();}return 1;})()`);
  await EV(`(function(){var e=document.querySelector('.ceLanTiaoMu[data-nav="singleAi"]');if(e)e.click();return 1;})()`);
  await sleep(800);
  await EV(`(function(){var h=document.querySelector('#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao');if(h)h.click();return 1;})()`);
  await sleep(1000);
  await EV(`(function(){var it=document.querySelector('#lieBiaoTi .lieBiaoTiaoMu');if(it)it.click();return 1;})()`);
  await sleep(1200);
  const sj0 = JSON.parse(await EV(`JSON.stringify((function(){
    var ka=document.getElementById('sheJiaoKa');
    return { you: !!ka, lie: ka?ka.querySelectorAll('.sjLie').length:0, sou: ka?ka.querySelectorAll('.sjSou').length:0,
      gun: ka?ka.querySelectorAll('[data-sj-gun]').length:0 };
  })())`));
  console.log('  社交信息块 =', JSON.stringify(sj0));
  ok(sj0.you && sj0.lie >= 5, '社交信息块存在（昵称头像 + 邮箱/网站账号/手机号/钱包）', JSON.stringify(sj0));
  // 先把邮箱列表清空（上一轮可能留了数据），再验证"未超 10 行不出搜索框"
  for (let i = 0; i < 40; i++) {
    const n = Number(await EV(`document.querySelectorAll('.sjLie[data-lie="youXiang"] .sjHang [data-sj-shan]').length`));
    if (!n) break;
    await EV(`(function(){var b=document.querySelector('.sjLie[data-lie="youXiang"] .sjHang [data-sj-shan]');if(b)b.click();return 1;})()`);
    await sleep(120);
  }
  await sleep(500);
  const sjQing = JSON.parse(await EV(`JSON.stringify((function(){
    var ka=document.getElementById('sheJiaoKa');
    return { n: ka?ka.querySelectorAll('.sjLie[data-lie="youXiang"] .sjHang').length:0, sou: ka?ka.querySelectorAll('.sjSou').length:0 };
  })())`));
  console.log('  清空后 =', JSON.stringify(sjQing));
  ok(sjQing.n === 0 && sjQing.sou === 0, '清空后：没有搜索框（未超 10 行）', JSON.stringify(sjQing));
  // 加 11 条邮箱：应出现滚动条 + 搜索框
  for (let i = 0; i < 11; i++) {
    await EV(`(function(){var b=document.querySelector('.sjLie[data-lie="youXiang"] [data-sj-tian]');if(b)b.click();return 1;})()`);
    await sleep(120);
  }
  await sleep(600);
  const sj1 = JSON.parse(await EV(`JSON.stringify((function(){
    var ka=document.getElementById('sheJiaoKa');
    var gun=ka?ka.querySelector('.sjLie[data-lie="youXiang"] .sjGun'):null;
    var hang=ka?ka.querySelectorAll('.sjLie[data-lie="youXiang"] .sjHang'):[];
    var qi=hang.length?hang[0].querySelector('[data-sj-qi]'):null;
    return { n:hang.length, sou: ka?ka.querySelectorAll('.sjSou').length:0,
      gunH: gun?Math.round(gun.getBoundingClientRect().height):0, scrollH: gun?gun.scrollHeight:0,
      qiYong: qi?!!qi.checked:null, maxH: gun?getComputedStyle(gun).maxHeight:'' };
  })())`));
  console.log('  加 11 条后 =', JSON.stringify(sj1));
  ok(sj1.n === 11, '能连续添加条目', sj1.n);
  ok(sj1.sou === 1, '超过 10 行 → 出现搜索框', sj1.sou);
  ok(sj1.scrollH > sj1.gunH, '超过 10 行 → 出现滚动条（内容高于限高）', sj1.scrollH + '>' + sj1.gunH);
  ok(sj1.qiYong === true, '「启用」默认勾选', sj1.qiYong);
  // 写入内容 + 搜索过滤
  await EV(`(function(){
    var hang=[...document.querySelectorAll('.sjLie[data-lie="youXiang"] .sjHang')];
    const set=(i,k,v)=>{var el=hang[i].querySelector('[data-sj-k="'+k+'"]');el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
    set(0,'dizhi','aaa@one.com'); set(0,'beiZhu','工作邮箱');
    set(3,'dizhi','zzz@two.com'); set(3,'beiZhu','私人邮箱');
    return 1;
  })()`);
  await sleep(400);
  await EV(`(function(){var s=document.querySelector('.sjLie[data-lie="youXiang"] .sjSou');s.value='zzz';s.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(500);
  const sj2 = JSON.parse(await EV(`JSON.stringify((function(){
    var hang=[...document.querySelectorAll('.sjLie[data-lie="youXiang"] .sjHang')];
    return { n:hang.length, wen:hang.map(function(h){var i=h.querySelector('[data-sj-k="dizhi"]');return i?i.value:'';}) };
  })())`));
  console.log('  搜索"zzz" 后 =', JSON.stringify(sj2));
  ok(sj2.n === 1 && String(sj2.wen[0]).includes('zzz'), '搜索框能按内容过滤', JSON.stringify(sj2));
  await EV(`(function(){var s=document.querySelector('.sjLie[data-lie="youXiang"] .sjSou');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(400);

  /* ============ 阶段 9：本轮改动 —— 我的页社交信息汇总表 ============ */
  console.log('\n===== 阶段 9：社交信息汇总表 =====');
  await EV(`(function(){var b=document.getElementById('duiHuaKuangGen');if(b&&!b.classList.contains('yinCang')){var x=document.querySelector('#duiHuaKuangDongZuoJi button');if(x)x.click();}return 1;})()`);
  await EV(`(function(){var e=document.querySelector('.ceLanTiaoMu[data-nav="wo"]');if(e)e.click();return 1;})()`);
  await sleep(2000);
  const hz = JSON.parse(await EV(`JSON.stringify((function(){
    var d=document.getElementById('dashSheJiao');
    if(!d) return {you:false};
    var kh=document.getElementById('sheJiaoHuiZongHost');
    var lie=kh?[...kh.querySelectorAll('thead th')].map(function(e){return String(e.textContent||'').trim();}):[];
    var hang=kh?kh.querySelectorAll('tbody tr').length:0;
    var kaiZhan=kh?kh.querySelectorAll('.sjZhanKai').length:0;
    return { you:true, kai:d.hasAttribute('open'), lie:lie.length, tou:lie, hang:hang, kaiZhan:kaiZhan };
  })())`));
  console.log('  汇总表 =', JSON.stringify(hz));
  ok(hz.you, '我的页出现「社交信息汇总」卡片', JSON.stringify(hz).slice(0, 120));
  ok(hz.kai === false, '默认折叠（details 不带 open）', hz.kai);
  await EV(`(function(){var d=document.getElementById('dashSheJiao');if(d)d.setAttribute('open','');return 1;})()`);
  await sleep(600);
  const hz2 = JSON.parse(await EV(`JSON.stringify((function(){
    var kh=document.getElementById('sheJiaoHuiZongHost');
    var th=[...kh.querySelectorAll('thead th')].map(function(e){return String(e.textContent||'').trim();});
    return { n:th.length, th:th, hang:kh.querySelectorAll('tbody tr').length };
  })())`));
  console.log('  展开后 =', JSON.stringify(hz2));
  ok(hz2.n === 7, '表头 7 列（牛马/邮箱/网站账号/手机号/社交头像/社交昵称/钱包）', JSON.stringify(hz2.th));
  ok(hz2.hang >= 1, '有牛马数据行', hz2.hang);
  // 点列头 = 排序 + 展开该列，其余折叠
  await EV(`(function(){var th=document.querySelector('#sheJiaoHuiZongHost thead th[data-sj-pai="youXiang"]');if(th)th.click();return 1;})()`);
  await sleep(600);
  const hz3 = JSON.parse(await EV(`JSON.stringify((function(){
    var th=document.querySelector('#sheJiaoHuiZongHost thead th[data-sj-pai="youXiang"]');
    var zhan=document.querySelectorAll('#sheJiaoHuiZongHost .sjZhanKai').length;
    return { jiHuo: !!(th&&th.classList.contains('jiHuo')), zhan: zhan, biao: th?String(th.textContent||'').trim():'' };
  })())`));
  console.log('  点「邮箱」列头 =', JSON.stringify(hz3));
  ok(hz3.jiHuo, '点列头后该列成为排序/展开列（高亮）', JSON.stringify(hz3));
  ok(hz3.zhan >= 1, '该列内容展开显示', hz3.zhan);
} catch (e) {
  console.log('!! 中断: ' + e.message);
  okList.push(false);
} finally {
  console.log('\n主进程日志尾部：' + logs.join('').slice(-400));
  console.log(`\n==== 第 ${LUN} 轮结果：${okList.filter(Boolean).length}/${okList.length} 通过 ====`);
  try { c?.close(); } catch { /* noop */ }
  try { execFileSync('taskkill', ['/F', '/IM', 'electron.exe', '/T'], { stdio: 'ignore' }); } catch { /* noop */ }
  process.exit(okList.every(Boolean) ? 0 : 1);
}
