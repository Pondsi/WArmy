// verify-mobile-ui.mjs — 真手机视口 + 真触摸 的移动端 UI 验收（A1–A14）
// 覆盖：i18n / 面板三级页 / 设置与语言切换 / 实例按钮 / 页面不透底 / 状态圆点 /
//       看板加任务 / 知识库详情 / 控制台无异常。
// 判定一律基于真实 DOM 度量与触摸命中结果，不用 typeof x==='function' 占位。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, sleep, PORTS } from './cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const PERF = process.env.CARMY_PERF || 'C:\\Users\\p\\AppData\\Local\\Temp\\perf';
const SHOTS = path.join(PERF, 'uiqa-mobile', 'fix-shots');
const PORT = Number(process.env.MOBILE_CDP_PORT || PORTS.mobile || 9333);
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (c, l, extra) => {
  results.push(!!c);
  console.log((c ? '  PASS ' : '  FAIL ') + l + (extra !== undefined ? ' -> ' + String(extra).slice(0, 220) : ''));
  return !!c;
};

const ALLOW_CJK_IN_EN = ['app.zhName', 'settings.localeZh', 'about.copyrightBody', 'llm.toolRecallDesc'];
const LATIN_WORD = /[A-Za-z]{3,}/;
const CJK = /[\u4e00-\u9fff]/;

async function main() {
  console.log('=== verify-mobile-ui @ CDP ' + PORT + ' ===');
  const c = await attach(PORT, { label: 'mobile-ui', callTimeout: 12000 });
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.waitFor('typeof window.__MOBILE__ === "object" && typeof window.__MOBILE_I18N_AUDIT__ === "function"', { timeout: 12000, label: '移动端脚本启动' });

  const ev = (expr) => c.evaluate(expr);

  /** 真触摸：取中心点 → touchStart/touchEnd → 返回命中描述 */
  async function touch(sel) {
    const box = await ev(`(function(){
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { found:false, reason:'absent' };
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return { found:false, reason:'zero-box', w:r.width, h:r.height };
      return { found:true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), w: Math.round(r.width), h: Math.round(r.height), text:(el.textContent||'').trim().slice(0,60) };
    })()`);
    if (!box || !box.found) return { ok:false, box };
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, radiusX: 1, radiusY: 1, force: 1 }] });
    await sleep(30);
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(280);
    return { ok:true, box };
  }

  async function snap(name) {
    const r = await c.snap(path.join(SHOTS, name + '.png'), { timeout: 6000 });
    return r && r.ok;
  }

  // ── 0. 启动 / 审计探针 ──
  const auditZh = await ev(`(function(){ return window.__MOBILE_I18N_AUDIT__(); })()`);
  ok(auditZh && auditZh.keyAligned, 'A1 探针：zh/en 键集合对齐', auditZh && auditZh.zhCount + '/' + auditZh.enCount);
  ok(auditZh && auditZh.zhCount >= 890, 'A1 探针：语言包键数完整', auditZh && auditZh.zhCount);
  ok(auditZh && Array.isArray(auditZh.missingInPack) && auditZh.missingInPack.length === 0, 'A1 探针：可见用键无缺失', JSON.stringify((auditZh && auditZh.missingInPack) || []).slice(0, 80));

  // 静态 index.html 不得含可导航静态视图
  const htmlSrc = fs.readFileSync(path.join(pkg, 'mobile', 'index.html'), 'utf8');
  ok(!/Group members|Knowledgebase|System diagnostics|Message queue/.test(htmlSrc), 'A1 index.html 无静态英文视图');

  // ── 1. 中文界面不见英文（允许产品名/模型名等）──
  async function visibleLatinHits(localeLabel) {
    return ev(`(function(){
      const phone = document.querySelector('#phone');
      if (!phone) return ['no-phone'];
      const text = phone.innerText || '';
      const lines = text.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
      const allowExact = ['demo.agent','DeepSeek','Ollama','Electron','Chromium','Node.js','Markdown','MIT','WArmy','ID','cache','ccr','avg','deepseek-chat','deepseek-reasoner','mimo-v2.5-pro','v0.1.0','SMTP','Base','URL','884024787','0.029','2400ms','32%','90%','65%','30%','40%','12:04','465','7788','10','0'];
      const bad = [];
      lines.forEach(function(line){
        if (!/[A-Za-z]{4,}/.test(line)) return;
        if (allowExact.some(function(a){ return line.indexOf(a) !== -1; })) return;
        // 纯技术 token
        if (/^[A-Za-z0-9.\\-_/:%+\\s]+$/.test(line) && !/Group|Message|Knowledge|System|Members|Queue|Diagnostics|Settings|Board|Session|Cattle/i.test(line)) return;
        if (/Group members|Message queue|Knowledgebase|System diagnostics|Checkpoints|Console|Fallback chain|Auto pick|Urgent|Priority/i.test(line)) { bad.push(line); return; }
        // 中文界面下出现成段英文句子
        if (${localeLabel === 'zh' ? 'true' : 'false'} && /[A-Za-z]{4,}/.test(line) && !CJK.test(line) && line.length > 8 && !allowExact.some(function(a){return line.indexOf(a)!==-1;})) {
          // 宽松：跳过纯模型/路径
          if (!/deepseek|mimo|ollama|preset|svg/i.test(line)) bad.push(line);
        }
      });
      return bad.slice(0, 12);
    })()`);
  }
  // reload zh
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(1800);
  await c.waitFor('typeof window.__MOBILE__ === "object"', { timeout: 8000 });
  const zhBad = await visibleLatinHits('zh');
  ok(zhBad.length === 0, 'A1 中文界面无成段英文', JSON.stringify(zhBad));
  await snap('zh-home');

  // ── 2. Tab 切换 + 真触摸 ──
  for (const tab of ['cattle', 'board', 'me', 'sessions']) {
    const r = await touch(`#tabs button[data-tab="${tab}"]`);
    const on = await ev(`(function(){ const b=document.querySelector('#tabs button[data-tab="${tab}"]'); return !!(b && b.classList.contains('on')); })()`);
    ok(r.ok && on, `Tab 真触摸切换: ${tab}`, JSON.stringify({ hit: r.box && r.box.text, on }));
  }

  // ── 3. 会话 → 聊天 → 底部面板 → 6 个三级页 ──
  await touch('#tabs button[data-tab="sessions"]');
  await sleep(150);
  const chatTouch = await touch('#tabs-host .row[data-open="demo-1"]');
  const pageN = await ev(`document.querySelectorAll('#page-host .page').length`);
  ok(chatTouch.ok && pageN >= 1, 'A2 会话行触摸打开聊天', JSON.stringify({ pageN, box: chatTouch.box }));

  const moreTouch = await touch('.page.on .iconbtn[data-act="more"], .page .iconbtn[data-act="more"]');
  await sleep(200);
  const sheetOn = await ev(`!!(document.querySelector('#sheet') && document.querySelector('#sheet').classList.contains('on'))`);
  ok(moreTouch.ok && sheetOn, 'A2 聊天「…」打开底部面板', sheetOn);
  await snap('sheet');

  const panels = [
    ['p-members', 'members'],
    ['p-model', 'model'],
    ['p-kb', 'kb'],
    ['p-cp', 'cp'],
    ['p-metrics', 'metrics'],
    ['p-export', 'export'],
  ];
  for (const [act, kind] of panels) {
    // re-open sheet each time
    const pagesBefore = await ev(`document.querySelectorAll('#page-host .page').length`);
    await touch('#tabs button[data-tab="sessions"]');
    await sleep(120);
    await touch('#tabs-host .row[data-open="demo-1"]');
    await sleep(200);
    await touch('.page .iconbtn[data-act="more"]');
    await sleep(220);
    const tr = await touch(`#sheet button[data-sheet="${act}"]`);
    await sleep(320);
    const info = await ev(`(function(){
      const pages = Array.from(document.querySelectorAll('#page-host .page'));
      const top = pages[pages.length-1];
      if (!top) return { open:false };
      const back = !!top.querySelector('[data-act="back"]');
      const body = top.querySelector('[data-panel]') || top.querySelector('.body');
      return { open:true, panel: body && body.getAttribute('data-panel'), back, text:(top.innerText||'').slice(0,80), opaque: (function(){
        let el=top; while(el){ const bg=getComputedStyle(el).backgroundColor; if(bg && bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent') return bg; el=el.parentElement;} return null;
      })() };
    })()`);
    ok(tr.ok && info.open && info.back && info.panel === kind, `A2 面板 ${act} 滑入三级页且有返回`, JSON.stringify({ hit: tr.box, info }));
    // back
    await touch('#page-host .page.on [data-act="back"], #page-host .page:last-child [data-act="back"]');
    await sleep(280);
  }
  await snap('panel-after');

  // ── 4. 页面不透明（亮/暗）──
  async function assertPageOpaque(theme) {
    await touch('#tabs button[data-tab="me"]');
    await sleep(120);
    await touch('.tab-page .cell[data-act="set-appearance"]');
    await sleep(280);
    if (theme === 'dark') {
      await touch('.page .cell[data-act="theme-dark"]');
      await sleep(280);
      await touch('.tab-page .cell[data-act="set-appearance"], #tabs-host .cell[data-act="set-appearance"]');
      await sleep(250);
    } else if (theme === 'light') {
      await touch('.page .cell[data-act="theme-light"]');
      await sleep(220);
    }
    // open provider page
    await touch('#tabs button[data-tab="me"]');
    await sleep(120);
    await touch('.tab-page .cell[data-act="set-provider"]');
    await sleep(300);
    const alphaInfo = await ev(`(function(){
      const pages = document.querySelectorAll('#page-host .page');
      const top = pages[pages.length-1];
      if (!top) return { found:false };
      let el = top;
      let bg = null;
      while (el) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && c !== 'transparent') { bg = c; break; }
        el = el.parentElement;
      }
      function alphaOf(c){
        if (!c) return 0;
        if (c.indexOf('rgba') === 0) {
          const m = c.match(/rgba\\(([^)]+)\\)/);
          if (!m) return 0;
          const parts = m[1].split(',').map(function(x){return parseFloat(x);});
          return parts.length >= 4 ? parts[3] : 1;
        }
        return 1; // rgb() opaque
      }
      return { found:true, bg, alpha: alphaOf(bg), theme: document.documentElement.getAttribute('data-theme'), text:(top.innerText||'').slice(0,60) };
    })()`);
    ok(alphaInfo.found && alphaInfo.alpha >= 1, `A3 二级页底色不透明 @${theme}`, JSON.stringify(alphaInfo));
  }
  await assertPageOpaque('light');
  await snap('page-provider-light');
  await assertPageOpaque('dark');
  await snap('page-provider-dark');
  // restore light
  await touch('#tabs button[data-tab="me"]');
  await sleep(100);
  await touch('.tab-page .cell[data-act="set-appearance"]');
  await sleep(220);
  await touch('.page .cell[data-act="theme-light"]');
  await sleep(200);

  // ── 5. 设置每项可进 + 语言切换生效 ──
  // 先清页面栈：前面 A2/A3/A4 可能留下二级页盖住 Tab，导致 touch 打不进设置项
  await ev(`(function(){ if (window.__MOBILE__ && window.__MOBILE__.popAll) window.__MOBILE__.popAll(); if (window.__MOBILE__ && window.__MOBILE__.closeSheet) window.__MOBILE__.closeSheet(); return true;})()`);
  await sleep(250);
  for (const group of ['appearance', 'provider', 'smtp', 'mesh', 'about']) {
    await ev(`(function(){ if (window.__MOBILE__ && window.__MOBILE__.popAll) window.__MOBILE__.popAll(); return true;})()`);
    await touch('#tabs button[data-tab="me"]');
    await sleep(120);
    const tr = await touch(`.tab-page .cell[data-act="set-${group}"]`);
    await sleep(280);
    const info = await ev(`(function(){
      const pages=document.querySelectorAll('#page-host .page'); const top=pages[pages.length-1];
      return top? { title:(top.querySelector('.bar .title')||{}).textContent, back:!!top.querySelector('[data-act="back"]') } : {title:null};
    })()`);
    ok(tr.ok && info.back && info.title, `A5 设置项可进: ${group}`, JSON.stringify(info));
    await touch('#page-host .page:last-child [data-act="back"], #page-host .page.on [data-act="back"]');
    await sleep(200);
  }

  // language switch
  await touch('#tabs button[data-tab="me"]');
  await sleep(100);
  await touch('.tab-page .cell[data-act="set-appearance"]');
  await sleep(280);
  const langTr = await touch('.page .cell[data-act="lang-en"]');
  await sleep(400);
  const afterEn = await ev(`(function(){
    const a = window.__MOBILE_I18N_AUDIT__();
    const phone = document.querySelector('#phone');
    return { locale:a.locale, docLang:a.localeDoc, aligned:a.keyAligned, sample:(phone&&phone.innerText||'').slice(0,160), title:document.title };
  })()`);
  ok(langTr.ok && afterEn.locale === 'en-US' && afterEn.docLang === 'en-US', 'A5 语言切换到 en-US 生效', JSON.stringify(afterEn));
  ok(afterEn.aligned, 'A5 切换后探针仍显示键集合一致', afterEn.aligned);

  const enBad = await ev(`(function(){
    const phone=document.querySelector('#phone'); const text=(phone&&phone.innerText)||'';
    const lines=text.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
    const bad=[];
    lines.forEach(function(line){
      if (!CJS.test(line) && false) return;
      if (!/[\u4e00-\u9fff]/.test(line)) return;
      // allow product exceptions via keys rendered as Chinese in en? should be none except brand
      if (/无限牛马/.test(line) && /WArmy/.test(line)) return;
      if (/中文/.test(line)) return; // locale option
      bad.push(line);
    });
    return bad.slice(0,10);
  })()`.replace('CJS.test', 'false'));
  // re-eval properly
  const enCjk = await ev(`(function(){
    const phone=document.querySelector('#phone'); const text=(phone&&phone.innerText)||'';
    const lines=text.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
    const bad=[];
    lines.forEach(function(line){
      if (!/[\u4e00-\u9fff]/.test(line)) return;
      if (line.indexOf('中文') !== -1) return; // language option
      if (line.indexOf('无限牛马') !== -1 && line.indexOf('WArmy') !== -1) return;
      bad.push(line);
    });
    return bad.slice(0,12);
  })()`);
  ok(enCjk.length === 0, 'A1 英文界面无中文残留（除语言选项）', JSON.stringify(enCjk));
  await snap('en-appearance');

  // switch back to zh
  await touch('.page .cell[data-act="lang-zh"]');
  await sleep(350);

  // ── 6. 我的页行为项 → 桌面端说明（不静默）──
  // ⚠️ act-diag 不在这里：卡顿自检是产品负责人退休掉的功能（桌面端入口整块移除），
  //    移动端那条「诊断」行是**悬空入口**，已删除；它由下面那条反向断言守着（必须不存在）。
  for (const act of ['act-models', 'act-skills', 'act-cleanup', 'act-updates']) {
    await touch('#tabs button[data-tab="me"]');
    await sleep(100);
    const tr = await touch(`.tab-page .cell[data-act="${act}"]`);
    await sleep(280);
    const info = await ev(`(function(){
      const pages=document.querySelectorAll('#page-host .page'); const top=pages[pages.length-1];
      if (!top) return {open:false};
      return { open:true, back:!!top.querySelector('[data-act="back"]'), text:(top.innerText||'').slice(0,120), hasDesktopOnly: (top.innerText||'').indexOf('桌面')!==-1 || (top.innerText||'').toLowerCase().indexOf('desktop')!==-1 };
    })()`);
    ok(tr.ok && info.open && info.back && info.hasDesktopOnly, `A6 ${act} 明确提示桌面端`, JSON.stringify(info));
    await touch('#page-host .page:last-child [data-act="back"]');
    await sleep(180);
  }

  // 退休功能「卡顿自检（诊断）」的悬空入口必须真的没了：
  // 结构上（没有 data-act="act-diag" 的单元、行为项只剩 4 条）+ 文案上（该文案不再出现在「我」页）。
  // 与上面那 4 条行为项检查一对一：少一条行为项，就补一条「已移除」的反向检查。
  await touch('#tabs button[data-tab="me"]');
  await sleep(150);
  const dangling = await ev(`(function(){
    const acts = Array.from(document.querySelectorAll('.tab-page .cell[data-act]'))
      .map(function(c){ return c.getAttribute('data-act'); })
      .filter(function(a){ return a.indexOf('act-') === 0; });
    const cell = document.querySelector('.tab-page .cell[data-act="act-diag"]');
    const zhPack = (window.__I18N_ALL__ && window.__I18N_ALL__['zh-CN']) || {};
    const label = zhPack['me.diagnostics'];
    const txt = (document.querySelector('#tabs-host')||{}).innerText || '';
    return JSON.stringify({ hasCell: !!cell, acts: acts, labelRendered: !!label && txt.indexOf(label) !== -1 });
  })()`);
  const danglingObj = JSON.parse(dangling);
  ok(danglingObj.hasCell === false && danglingObj.acts.length === 4 && danglingObj.acts.indexOf('act-diag') === -1 && danglingObj.labelRendered === false,
    'A6 退休功能「诊断（卡顿自检）」在移动端没有悬空入口（无 act-diag 行、行为项只剩 4 条、文案也不再渲染）', dangling);

  // ── 7. 实例按钮状态真变 + 无裸字母 a ──
  await touch('#tabs button[data-tab="cattle"]');
  await sleep(150);
  const instTr = await touch('#tabs-host .row[data-inst="demo-2"]');
  await sleep(280);
  const beforeStatus = await ev(`(function(){ const el=document.querySelector('#page-host .page:last-child [data-inst-status]'); return el? el.innerText.trim(): null; })()`);
  const startTr = await touch('.page .inst-actions [data-act="inst-start"]');
  await sleep(300);
  const afterStatus = await ev(`(function(){ const el=document.querySelector('#page-host .page:last-child [data-inst-status]'); return el? {text: el.innerText.trim(), html: el.innerHTML.slice(0,80)}: null; })()`);
  const toastText = await ev(`(function(){ const t=document.querySelector('#toast'); return t? {text:t.textContent, on:t.classList.contains('on')}:null; })()`);
  ok(instTr.ok && startTr.ok && afterStatus && afterStatus.text && afterStatus.text !== beforeStatus, 'A4 实例启动按钮后状态文字变化', JSON.stringify({ beforeStatus, afterStatus, toastText }));

  const bareLetter = await ev(`(function(){
    const pages=document.querySelectorAll('#page-host .page');
    const top=pages[pages.length-1] || document;
    const nodes=top.querySelectorAll('.av, .status-dot, .av-dot');
    const bad=[];
    nodes.forEach(function(n){
      const txt=(n.textContent||'').trim();
      if (txt === 'a' || txt === 'A') bad.push({cls:n.className, txt:txt});
    });
    return bad;
  })()`);
  ok(bareLetter.length === 0, 'A11 状态/头像无裸字母 a', JSON.stringify(bareLetter));
  await snap('instance-actions');
  await touch('#page-host .page:last-child [data-act="back"]');
  await sleep(200);

  // ── 8. 看板手动加任务 + AI 生成反馈 ──
  await touch('#tabs button[data-tab="board"]');
  await sleep(200);
  const setVal = await ev(`(function(){
    const inp=document.querySelector('#board-task-input');
    if(!inp) return false;
    inp.value='UIQA-TASK-001';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const addTr = await touch('.tab-page [data-act="board-add"]');
  await sleep(280);
  const boardAfter = await ev(`(function(){
    const list=document.querySelector('#board-task-list');
    const text=(list&&list.innerText)||'';
    const toast=document.querySelector('#toast');
    return { hasTask: text.indexOf('UIQA-TASK-001')!==-1, text:text.slice(0,120), toast: toast? toast.textContent: '', count: window.__MOBILE__.state.boardTasks.length };
  })()`);
  ok(setVal && addTr.ok && boardAfter.hasTask, 'A7 看板手动添加任务出现在列表', JSON.stringify(boardAfter));
  const aiTr = await touch('.tab-page [data-act="board-ai"]');
  await sleep(220);
  const aiToast = await ev(`(function(){ const t=document.querySelector('#toast'); return t? t.textContent: ''; })()`);
  ok(aiTr.ok && aiToast && aiToast.length > 4, 'A7「让 AI 生成」有明确 i18n 反馈', aiToast);
  await snap('board-add');

  // ── 9. 知识库条目进详情 ──
  await touch('#tabs button[data-tab="sessions"]');
  await sleep(120);
  await touch('#tabs-host .row[data-open="demo-1"]');
  await sleep(220);
  await touch('.page .iconbtn[data-act="more"]');
  await sleep(220);
  await touch('#sheet button[data-sheet="p-kb"]');
  await sleep(320);
  const kbCell = await touch('.page:last-child .cell[data-act="kb-open"], .page.on .cell[data-kb]');
  await sleep(320);
  const kbInfo = await ev(`(function(){
    const pages=document.querySelectorAll('#page-host .page'); const top=pages[pages.length-1];
    return top? { text:(top.innerText||'').slice(0,100), back:!!top.querySelector('[data-act="back"]'), depth:pages.length } : null;
  })()`);
  ok(kbCell.ok && kbInfo && kbInfo.back && kbInfo.depth >= 2, 'A8 知识库条目滑入详情且可返回', JSON.stringify({ kbCell: kbCell.box, kbInfo }));
  await snap('kb-detail');
  await touch('#page-host .page:last-child [data-act="back"]');
  await sleep(200);
  await touch('#page-host .page:last-child [data-act="back"]');
  await sleep(200);

  // ── 10. 聊天图标 tooltip + 未读角标可点 ──
  const tips = await ev(`(function(){
    const btns=Array.from(document.querySelectorAll('.bar .iconbtn, .tabs button'));
    return btns.map(function(b){ return { title:b.getAttribute('title')||'', aria:b.getAttribute('aria-label')||'', act:b.getAttribute('data-act')||b.getAttribute('data-tab')||'' }; });
  })()`);
  const moreTip = tips.find((x) => x.act === 'more' || x.title || x.aria);
  ok(tips.length > 0 && tips.every((x) => x.title || x.aria), 'A9 图标均有 tooltip/aria-label（i18n）', JSON.stringify(tips.slice(0, 6)));

  await touch('#tabs button[data-tab="sessions"]');
  await sleep(150);
  const badgeTouch = await touch('#tabs-host .row[data-open="demo-1"] .badge');
  await sleep(280);
  const badgeOpen = await ev(`document.querySelectorAll('#page-host .page').length >= 1`);
  ok((badgeTouch.ok && badgeOpen) || badgeTouch.box === null, 'A9 未读角标可点进会话（整行热区）', JSON.stringify({ badgeTouch, badgeOpen }));

  // ── 11. 面板条目视觉反馈高度稳定（sheet button min-height）──
  const sheetGeo = await ev(`(function(){
    // open sheet
    return null;
  })()`);
  await touch('#tabs button[data-tab="sessions"]');
  await sleep(100);
  await touch('#tabs-host .row[data-open="demo-1"]');
  await sleep(220);
  await touch('.page .iconbtn[data-act="more"]');
  await sleep(220);
  const heights = await ev(`(function(){
    return Array.from(document.querySelectorAll('#sheet button[data-sheet]')).map(function(b){
      const r=b.getBoundingClientRect(); return Math.round(r.height);
    });
  })()`);
  const minH = heights.length ? Math.min.apply(null, heights) : 0;
  const maxH = heights.length ? Math.max.apply(null, heights) : 0;
  ok(minH >= 48 && maxH - minH <= 8, 'A10 面板条目高度稳定且 ≥48', JSON.stringify(heights));
  await touch('#sheet button[data-sheet="__cancel"]');
  await sleep(200);

  // ── 12. 列表行间距紧凑 ──
  await touch('#tabs button[data-tab="sessions"]');
  await sleep(150);
  const rowPad = await ev(`(function(){
    const rows=Array.from(document.querySelectorAll('#tabs-host .row'));
    return rows.map(function(r){ const cs=getComputedStyle(r); return {pt:cs.paddingTop, pb:cs.paddingBottom, h:Math.round(r.getBoundingClientRect().height)}; });
  })()`);
  const padOk = rowPad.every((r) => parseFloat(r.pt) <= 14 && parseFloat(r.pb) <= 14 && r.h >= 48 && r.h <= 72);
  ok(padOk, 'A14 列表行间距紧凑（padding≤14, h 48–72）', JSON.stringify(rowPad.slice(0, 3)));

  // ── 13. 控制台无异常 ──
  const errs = c.errors().filter((e) => !/Electron Security Warning/i.test(e));
  ok(errs.length === 0, '控制台无异常/错误', JSON.stringify(errs.slice(0, 5)));

  // ── 14. 空状态不是「未绑定/未设置」──
  const meText = await ev(`(function(){
    document.querySelector('#tabs button[data-tab="me"]').click();
    return (document.querySelector('#tabs-host')||{}).innerText || '';
  })()`);
  ok(!/未绑定|未设置/.test(meText), 'A13「我的」页无「未绑定/未设置」误导文案', meText.slice(0, 80));
  ok(/桌面/.test(meText) || /desktop/i.test(meText), 'A13 行为项显示可行动提示', meText.slice(0, 120));

  /* ══════════════════════════════════════════════════════════════════════════
     14. T195：移动端不许再出现「多节点组网」与旧的 7788 端口
     （桌面端契约：新概念是「组网」，默认端口 59599；旧的 LAN-sync/多节点块已退休）
     这一节只**追加**断言，不动上面任何一条。
     ══════════════════════════════════════════════════════════════════════════ */
  await ev(`(function(){ if (window.__MOBILE__ && window.__MOBILE__.popAll) window.__MOBILE__.popAll(); return true; })()`);
  await sleep(250);

  const meshState = await ev(`(function(){
    var st = (window.__MOBILE__ && window.__MOBILE__.state) || {};
    return JSON.stringify({ port: st.mesh && st.mesh.port, running: !!(st.mesh && st.mesh.running) });
  })()`);
  const meshObj = JSON.parse(meshState);
  ok(meshObj.port === 59599, 'T195-1 移动端组网端口默认 = 59599（与桌面端 WARMY_DEFAULT_NET_PORT 一致，不是旧的 7788）', meshState);

  await touch('#tabs button[data-tab="me"]');
  await sleep(200);
  const meRowsText = await ev(`(function(){ return (document.querySelector('#tabs-host')||{}).innerText || ''; })()`);
  ok(meRowsText.indexOf('59599') !== -1, 'T195-2 「我」页的组网行显示真实端口 59599', String(meRowsText).replace(/\s+/g, ' ').slice(0, 90));

  await touch('.tab-page .cell[data-act="set-mesh"]');
  await sleep(300);
  const meshPage = await ev(`(function(){
    var pages = document.querySelectorAll('#page-host .page');
    var top = pages[pages.length - 1];
    return JSON.stringify({ title: top ? (top.querySelector('.bar .title')||{}).textContent : null, text: top ? (top.innerText||'') : '' });
  })()`);
  const meshPageObj = JSON.parse(meshPage);
  ok(meshPageObj.title && meshPageObj.title.indexOf('多节点') === -1 && /组网/.test(meshPageObj.title),
    'T195-3 组网页标题是新概念「组网」，不含退休的「多节点」', JSON.stringify({ title: meshPageObj.title }));
  ok(String(meshPageObj.text).indexOf('7788') === -1, 'T195-3 组网页里没有旧端口 7788', String(meshPageObj.text).replace(/\s+/g, ' ').slice(0, 90));
  ok(/组网开关/.test(String(meshPageObj.text)), 'T195-3 状态行用桌面端同款措辞「组网开关」', String(meshPageObj.text).replace(/\s+/g, ' ').slice(0, 60));

  // 打开组网开关 → 文案用桌面同一套键（net.switchOn 的「组网已开启（端口 …）」）
  await touch('.page .cell[data-act="toggle-mesh"], .page button[data-act="toggle-mesh"]');
  await sleep(320);
  const meshOn = await ev(`(function(){
    var pages = document.querySelectorAll('#page-host .page');
    var top = pages[pages.length - 1];
    return top ? (top.innerText||'') : '';
  })()`);
  ok(/组网已开启/.test(String(meshOn)) && !/多节点/.test(String(meshOn)),
    'T195-4 打开后如实说「组网已开启（端口 59599）」（与桌面端同一套 i18n）', String(meshOn).replace(/\s+/g, ' ').slice(0, 90));
  ok(/关闭组网/.test(String(meshOn)), 'T195-4 按钮文案是「关闭组网」（不是旧的「停止组网」）', String(meshOn).replace(/\s+/g, ' ').slice(0, 90));
  await touch('.page button[data-act="toggle-mesh"], .page .cell[data-act="toggle-mesh"]');
  await sleep(320);

  // 英文界面下也不许出现旧的 "Multi-node mesh"
  // 注意：setLocale() 内部会 openSetting('appearance')（重新本地化当前页），所以切完语言要再 popAll 一次
  await ev(`(function(){ window.__MOBILE__.setLocale('en-US'); return true; })()`);
  await sleep(400);
  await ev(`(function(){ window.__MOBILE__.popAll(); return true; })()`);
  await sleep(250);
  await touch('#tabs button[data-tab="me"]');
  await sleep(200);
  await touch('.tab-page .cell[data-act="set-mesh"]');
  await sleep(300);
  const meshEn = await ev(`(function(){
    var pages = document.querySelectorAll('#page-host .page');
    var top = pages[pages.length - 1];
    return top ? (top.innerText||'') : '';
  })()`);
  ok(String(meshEn).indexOf('Multi-node') === -1 && /Mesh/.test(String(meshEn)),
    'T195-5 英文界面用新的「Mesh networking」措辞，不含退休的 "Multi-node"', String(meshEn).replace(/\s+/g, ' ').slice(0, 90));
  ok(String(meshEn).indexOf('59599') !== -1, 'T195-5 英文界面同样显示真实端口 59599', String(meshEn).replace(/\s+/g, ' ').slice(0, 90));
  await ev(`(function(){ window.__MOBILE__.setLocale('zh-CN'); return true; })()`);
  await sleep(400);
  await ev(`(function(){ window.__MOBILE__.popAll(); return true; })()`);
  await sleep(250);

  // 全站扫描：任何页面都不该再出现 7788 / 多节点组网
  await touch('#tabs button[data-tab="me"]');
  await sleep(200);
  const legacy = await ev(`(function(){
    var txt = (document.querySelector('#phone')||{}).innerText || '';
    return JSON.stringify({ hasOldPort: txt.indexOf('7788') !== -1, hasMultiNode: txt.indexOf('多节点') !== -1 });
  })()`);
  ok(JSON.parse(legacy).hasOldPort === false && JSON.parse(legacy).hasMultiNode === false,
    'T195-6 移动端界面里彻底没有 7788 / 「多节点」残留（全站可见文本扫描）', legacy);

  const legacyErrs = c.errors().filter((e) => !/Electron Security Warning/i.test(e));
  ok(legacyErrs.length === 0, 'T195 这一节全程无控制台异常', JSON.stringify(legacyErrs.slice(0, 3)).slice(0, 200));

  const pass = results.filter(Boolean).length;
  console.log('\nverify-mobile-ui: ' + pass + '/' + results.length + ' 通过');
  c.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('verify-mobile-ui crashed:', e && e.stack || e);
  process.exit(2);
});
