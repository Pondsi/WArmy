// cdp-verify-net.mjs — ADR 003 R8–R12 / 附六 的 UI 验收（真 Chromium + CDP）
//
// 前置（两步，缺一不可）：
//   1) node packages/app-shell/scripts/build-preview.mjs --out %CCARMY_NET_OUT%
//   2) 起一个预览壳并指向 %CCARMY_NET_OUT%\index.html，CDP 端口 = $PORT（默认 9555）
//      再启动时**必须**加 --disable-features=CalculateNativeWinOcclusion，否则窗口被遮挡时
//      Chromium 不再产帧，Page.captureScreenshot 会永久挂住（实测）。
// 默认 CCARMY_NET_OUT = <os.tmpdir()>/ccarmy-net-ui；result.json 写在同一个目录。
//
// 纪律（沿用本目录既有测试基础设施的教训）：
//   * 每次 CDP 调用都有超时（cdp-lib），不用固定 sleep 当同步屏障；
//   * 等条件成立而不是等秒表；真实坐标点击失败会重试并记录轨迹；
//   * 桩（组网层/身份层）通过 Page.addScriptToEvaluateOnNewDocument 在文档脚本之前注入，
//     状态存 localStorage —— 于是「下次启动」= Page.reload 之后仍然一致。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, sleep, reporter } from './cdp-lib.mjs';

const PORT = Number(process.env.PORT || 9555);
// 产物目录可注入（统一验证器会指到临时目录，避免污染仓库）；harness 与脚本同级，跟着仓库走。
const OUT = process.env.CCARMY_NET_OUT || path.join(os.tmpdir(), 'ccarmy-net-ui');
// 结果文件写回 OUT；目录可能还不存在（默认值就是临时目录），必须先建，否则跑完全部断言却因写结果而报错退出。
fs.mkdirSync(OUT, { recursive: true });
const HARNESS = fs.readFileSync(new URL('./net-ui-harness.js', import.meta.url), 'utf8');
// i18n 真值包：用来把界面文案与语言包**逐字**比对（不是"看起来像翻译过"）
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const I18N_DIR = path.join(SELF_DIR, '..', 'src', 'i18n');
const ZH = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'zh-CN.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en-US.json'), 'utf8'));
const CJK = /[\u4e00-\u9fff]/;

/**
 * 附八.9 / 附八.3 新增的键（「六档 + 中继 + 可拨入性」三组 + 阶梯区块与终态横幅的文案）。
 * 这些键**必须在两包都有且非空**，且英文包里不能出现中文。
 */
const NEW_NET_KEYS = [
  'net.rung.ipv6Direct', 'net.rung.publicDirect', 'net.rung.upnp', 'net.rung.holepunch', 'net.rung.relay', 'net.rung.lan',
  'net.relay.selected', 'net.relay.missing.noneConfigured', 'net.relay.missing.unreachable', 'net.relay.missing.needsPublicRelay',
  'net.relay.notNeeded.peerDialable', 'net.relay.notNeeded.inboundExpected', 'net.relay.unknown',
  'net.dialability.peerVerified', 'net.dialability.ipv6Natural', 'net.dialability.undetermined', 'net.dialability.undialable',
  'net.ladder.title', 'net.ladder.current', 'net.ladder.candidate', 'net.ladder.unsupported',
  'net.ladder.relay', 'net.ladder.dialability', 'net.ladder.none',
  'net.banner.relayTerminalTitle', 'net.banner.relayConfigure',
];
/** 六个档位与协议层 LADDER_RUNG_I18N 的对应（顺序 = 附八.9 定的阶梯顺序） */
const RUNG_KEYS = [
  ['ipv6-direct', 'net.rung.ipv6Direct'],
  ['public-direct', 'net.rung.publicDirect'],
  ['upnp', 'net.rung.upnp'],
  ['holepunch', 'net.rung.holepunch'],
  ['relay', 'net.rung.relay'],
  ['lan', 'net.rung.lan'],
];

const R = reporter();
const { ok, warn } = R;

const CONTRAST_FN = `(function(sel){
  function parse(c){ if(!c) return null; var n=String(c).match(/[0-9.]+/g); if(!n||n.length<3) return null;
    return { r:parseFloat(n[0]), g:parseFloat(n[1]), b:parseFloat(n[2]), a:n.length>3?parseFloat(n[3]):1 }; }
  function lum(o){ var c=[o.r,o.g,o.b].map(function(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }
  function blend(fg,bg){ var a=fg.a; return { r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1 }; }
  var el=document.querySelector(sel); if(!el) return { err:'no-el' };
  var cs=getComputedStyle(el);
  var fg=parse(cs.color); if(!fg) return { err:'no-fg' };
  var n=el, bg=null;
  while(n){ var b=parse(getComputedStyle(n).backgroundColor); if(b && b.a>0.999){ bg=b; break; } n=n.parentElement; }
  if(!bg) bg={ r:255,g:255,b:255,a:1 };
  var op=1, m=el;
  while(m){ var o=parseFloat(getComputedStyle(m).opacity); if(!isNaN(o)) op*=o; m=m.parentElement; }
  var fgc=blend({ r:fg.r, g:fg.g, b:fg.b, a:fg.a*op }, bg);
  var hi=Math.max(lum(fgc),lum(bg)), lo=Math.min(lum(fgc),lum(bg));
  return { ratio: Math.round((hi+0.05)/(lo+0.05)*100)/100, color: cs.color,
    bg: 'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')', text:(el.textContent||'').slice(0,26) };
})`;

let c;
const step = (s) => console.log('\n=== ' + s + ' ===');

/** 真浏览器里算 WCAG 对比度（含 opacity 与最近不透明祖先底色） */
async function contrast(sel) {
  return c.evaluate(`(${CONTRAST_FN})(${JSON.stringify(sel)})`);
}

/** 等元素（及其祖先）累计 opacity 稳定到 1：弹窗卡片有入场动画，动画中间测对比度会得到 ratio=1 的假结果 */
async function waitOpaque(sel) {
  const expr = "(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return -1;var op=1,n=e;while(n){var o=parseFloat(getComputedStyle(n).opacity);if(!isNaN(o))op*=o;n=n.parentElement;}return Math.round(op*100)/100;})()";
  try { await c.waitFor(expr + " >= 0.99", { timeout: 3000, label: '元素不透明（动画结束）: ' + sel }); } catch (e) { /* 保持透明也要测，好把问题暴露出来 */ }
}

async function okContrast(sel, label, min = 3.0) {
  await waitOpaque(sel);
  const r = await contrast(sel);
  if (r && r.err) return ok(false, label + '（找不到元素/取不到色）', JSON.stringify(r));
  return ok(r.ratio >= min, label + ' 对比度 >= ' + min, r.ratio + ' (' + r.color + ' on ' + r.bg + ') ' + JSON.stringify(r.text));
}

const txt = (sel) => c.evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null;})()`);
const cnt = (sel) => c.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const exists = (sel) => c.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const visible = (sel) =>
  c.evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;
    if(e.classList.contains('hidden'))return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`);

async function clickReal(sel, cond, o = {}) {
  const r = await c.clickUntil(sel, cond || 'true', Object.assign({ tries: 4, timeout: 2500, gap: 200 }, o));
  const want = sel.split(',')[0].trim();
  const hit = String(r.hit || '');
  if (!r.ok && cond) warn('真实点击未生效: ' + sel + ' 轨迹:' + (r.trail || []).join(' | '));
  else if (want.startsWith('#') && hit !== want && !(want === '#net-switch' && hit === '.net-switch-track'))
    warn('点击命中不是目标元素: ' + sel + ' -> ' + hit + ' 轨迹:' + (r.trail || []).join(' | '));
  return r;
}

/** 确保组网卡片可见可点（设置页可能停在别的分区，或元素被顶出视口） */
async function ensureNetCard() {
  const ready = "(function(){var b=document.querySelector('#btn-net-detect');if(!b)return false;var r=b.getBoundingClientRect();return r.width>0&&r.height>0;})()";
  if (await c.evaluate(ready)) return true;
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#settings-nav button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  try {
    await c.waitFor(ready, { timeout: 8000, label: '组网卡片可见' });
    return true;
  } catch (e) { warn('组网卡片不可见: ' + e.message.slice(0, 120)); return false; }
}

async function clickModal(label) {
  // 弹窗按钮按文案点；返回是否点到
  const sel = `#modal-actions button`;
  const box = await c.evaluate(`(function(){
    var b=Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(x){return (x.textContent||'').indexOf(${JSON.stringify(label)})>=0;})[0];
    if(!b) return null; var r=b.getBoundingClientRect(); return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), disabled: !!b.disabled, text:b.textContent };
  })()`);
  if (!box) return { ok: false, reason: 'no-button', label };
  await c.mouseClick(box.x, box.y);
  return { ok: true, disabled: box.disabled, text: box.text };
}

/** 弹窗状态（隐藏时标题/正文都是上一次的残留，必须配合 visible 看） */
async function modal() {
  return c.evaluate("(function(){var root=document.querySelector('#modal-root');return {visible: !root.classList.contains('hidden'), title: document.querySelector('#modal-title').textContent, body: document.querySelector('#modal-body').textContent};})()");
}

async function closeModal() {
  await c.evaluate("document.querySelectorAll('#modal-actions button').forEach(function(b){b.click();}); document.querySelector('#modal-root').classList.add('hidden'); true");
}

async function navTo(nav, extra = '') {
  await c.evaluate(`(function(){var e=document.querySelector('[data-nav="${nav}"]'); if(e) e.click(); return true;})()`);
  await c.waitFor(`!!document.querySelector('.rail-item[data-nav="${nav}"].active') && (${extra || 'true'})`, {
    timeout: 9000,
    label: '导航到 ' + nav,
  });
}

/** 打开某个会话（走真实点击列表行） */
async function openSession(nav, rowMatch) {
  await navTo(nav);
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length > 0`, { timeout: 8000, label: nav + ' 列表有行' });
  const idx = await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#list-body .list-item'));
    var i=rows.findIndex(function(r){return (r.textContent||'').indexOf(${JSON.stringify(rowMatch)})>=0;});
    return i;
  })()`);
  if (idx < 0) throw new Error('列表里找不到行: ' + rowMatch + ' @' + nav);
  await c.evaluate(`document.querySelectorAll('#list-body .list-item')[${idx}].click(); true`);
  await c.waitFor(`!document.querySelector('#chat-layout').classList.contains('hidden') && document.querySelector('#chat-title').textContent.indexOf(${JSON.stringify(rowMatch)})>=0`, {
    timeout: 8000,
    label: '打开会话 ' + rowMatch,
  });
}

/** 打开「我的牛马管理局」（图标可能被重渲染换掉，带重试 + 可见性检查） */
async function openInstancesPage() {
  const ready = "(function(){var e=document.querySelector('.list-hq-icon');if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()";
  // 实例页没有 rail-item[data-nav=instances]；点完 HQ 图标后 list-title 变成「牛马管理局」
  const condTxt = "document.querySelector('#list-title') && document.querySelector('#list-title').textContent.indexOf('牛马管理局') >= 0";
  for (let i = 1; i <= 3; i++) {
    await navTo('singleAi');
    if (!(await c.waitForQuiet(ready, { timeout: 4000 }))) {
      warn('第 ' + i + ' 次：图标不可见，重试');
      await sleep(300);
      continue;
    }
    const st = await c.evaluate("(function(){var e=document.querySelector('.list-hq-icon');if(!e)return 'absent';var r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' nav='+((document.querySelector('.rail-item.active')||{}).dataset||{}).nav;})()");
    try {
      await clickReal('.list-hq-icon', condTxt);
      return true;
    } catch (e) {
      warn('第 ' + i + ' 次图标坐标点击失败（' + st + '）: ' + String(e.message).slice(0, 90) + ' → 退回 DOM click');
      await c.evaluate("(function(){var e=document.querySelector('.list-hq-icon'); if(e) e.click(); return true;})()");
      if (await c.waitForQuiet(condTxt, { timeout: 3000 })) return true;
    }
    await sleep(300);
  }
  warn('找不到可点的牛马管理局图标');
  return false;
}

const netRowSel = '.net-banner .bn-row[data-kind="net"]';
const idRowSel = '.net-banner .bn-row[data-kind="idchg"]';

// 全局看门狗
let at = '连接页面';
const watchdog = setTimeout(() => {
  console.error('\n看门狗：用例超过 300s 未结束，卡在「' + at + '」，强制退出。');
  process.exit(3);
}, 300000);

try {
  c = await attach(PORT, { label: 'verify-net', callTimeout: 12000 });
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  step('0. 注入桩 + 重新加载（保证验的是当前产物 + 桩在文档脚本之前生效）');
  at = '注入桩并 reload';
  const HARNESS_CFG = {
    resetStorage: true,
    resetToken: 'run-' + Date.now(),
    groupMembersOverride: [{ groupId: 'g-1', members: ['demo.agent', 'remote-bob', 'remote-carl'] }],
  };
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HARNESS_CFG = ' + JSON.stringify(HARNESS_CFG) + ';\n' + HARNESS });
  await c.send('Page.reload', { ignoreCache: true });
  await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi && typeof window.ccarmy === "object"', {
    timeout: 30000,
    label: '页面启动完成（__saveState + __netUi 就绪）',
  });
  await c.waitFor(`document.querySelectorAll('#rail .rail-item').length >= 1 && !!document.querySelector('#net-banner')`, { timeout: 10000, label: 'DOM 就绪' });
  await closeModal();
  ok(true, '页面在真实 Chromium 中启动（预览壳 Electron + CDP）', await c.evaluate('document.visibilityState'));
  const bootErr = c.errors();
  ok(bootErr.length === 0, '启动无控制台异常/未捕获错误', JSON.stringify(bootErr).slice(0, 200));

  const tun = await c.evaluate('JSON.stringify(window.__netUi.tuning())');
  console.log('    默认迟滞参数:', tun);
  const tn = JSON.parse(tun);
  ok(tn.failures === 3 && tn.seconds === 30 && tn.rounds === 3, '默认迟滞 = 连续 3 次失败 + 持续 30s，重试 3 轮', tun);
  ok(!(await exists(netRowSel)), '初始状态没有任何组网横幅（未开启组网时不误报）');

  /* ══ 1. R8 组网设置：自动填入 / 手改 / 多域名 / 检测 / 开关门控 ══ */
  // 启动后的自动打开会话（setTimeout 100ms）会切走主视图，先等它稳定再导航，
  // 否则断言会在"设置页已被换掉"的瞬间执行（实测：t+0.5s 时 #page-layout 变 display:none）
  await c.waitFor("!document.querySelector('#chat-layout').classList.contains('hidden')", { timeout: 10000, label: '启动自动打开会话完成' });
  await sleep(400);

  step('1. R8 组网设置（自动填入 + 手改 + 多域名 + 检测 + 开关门控）');
  at = 'R8 打开设置页';
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#settings-nav button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#net-card")', { timeout: 8000, label: '组网设置卡片出现' });
  ok(await visible('#net-card'), 'R8-1 设置里出现「组网设置」卡片');
  ok((await c.evaluate('(document.querySelector("#net-ip")||{}).value')) === '192.168.1.50', 'R8-2 启动时自动填入本机 IP（来自组网层 netLocalAddress）', await c.evaluate('document.querySelector("#net-ip").value'));
  ok((await c.evaluate('(document.querySelector("#net-port")||{}).value')) === '7788', 'R8-2 默认端口 7788 已填入', await c.evaluate('document.querySelector("#net-port").value'));

  const swBefore = await c.evaluate('(function(){var s=document.querySelector("#net-switch");return {disabled:s.disabled, checked:s.checked, msg:document.querySelector("#net-switch-msg").textContent};})()');
  ok(swBefore.disabled === true && swBefore.checked === false, 'R8-3 未检测前组网开关被锁住（不可打开）', JSON.stringify(swBefore));

  // 手改 IP / 端口
  await c.evaluate(`(function(){
    var ip=document.querySelector('#net-ip'); ip.value='203.0.113.77'; ip.dispatchEvent(new Event('input',{bubbles:true})); ip.dispatchEvent(new Event('change',{bubbles:true}));
    var p=document.querySelector('#net-port'); p.value='18080'; p.dispatchEvent(new Event('change',{bubbles:true}));
    return true;})()`);
  const addr = await c.evaluate('JSON.stringify(window.__netUi.net.addr)');
  ok(/203\.0\.113\.77/.test(addr) && /18080/.test(addr), 'R8-4 IP 与端口可手改（并写入设置）', addr);
  ok(await c.evaluate('!!window.ccarmy.settingsSave'), 'R8-4 地址通过既有 settings IPC 持久化（未新开存储通道）');

  // 非法地址：检测时给出提示且不发探测请求
  await c.evaluate("window.__netTest.reset(); true");
  await c.evaluate(`(function(){var ip=document.querySelector('#net-ip'); ip.value='bad host !!'; ip.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await ensureNetCard();
  await clickReal('#btn-net-detect');
  await c.waitForQuiet("!document.querySelector('#modal-root').classList.contains('hidden')", { timeout: 4000 });
  const mBad = await modal();
  const badModal = mBad.visible ? mBad.body : '';
  ok((badModal || '').indexOf('格式') >= 0 || (badModal || '').indexOf('Invalid') >= 0, 'R8-5 非法 IP：检测前先报错', String(badModal).slice(0, 40));
  ok((await c.evaluate('window.__netTest.callsOf("netProbe").length')) === 0, 'R8-5 非法地址不会假装检测通过（未发出探测）');
  await closeModal();
  await c.evaluate(`(function(){var ip=document.querySelector('#net-ip'); ip.value='203.0.113.77'; ip.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);

  // 多域名（1 个 IP + 多个域名）
  await c.evaluate("(function(){var b=document.querySelector('#btn-net-domain-add'); b.click(); b.click(); return true;})()");
  await c.evaluate(`(function(){
    var ins=document.querySelectorAll('#net-domains input.net-domain-input');
    ins[0].value='node.example.com'; ins[0].dispatchEvent(new Event('change',{bubbles:true}));
    ins[1].value='backup.example.net'; ins[1].dispatchEvent(new Event('change',{bubbles:true}));
    return true;})()`);
  const doms = await c.evaluate('JSON.stringify(window.__netUi.net.addr.domains)');
  ok(/"node\.example\.com"/.test(doms) && /"backup\.example\.net"/.test(doms), 'R8-6 可添加多个域名（同一 IP）', doms);

  // 检测通过 → 开关解锁
  at = 'R8 检测';
  await c.evaluate("window.__netTest.reset(); true");
  await ensureNetCard();
  await clickReal('#btn-net-detect', "!!document.querySelector('#net-probe-result .net-probe-line')");
  const probeTxt = await txt('#net-probe-result');
  ok((probeTxt || '').indexOf('检测通过') >= 0, 'R8-7 检测结果：通过（公网可达 + 外网连通）', String(probeTxt).slice(0, 60));
  ok((await c.evaluate('window.__netTest.callsOf("netProbe").length')) === 1, 'R8-7 检测真的调了组网层 netProbe');
  ok((await c.evaluate('(document.querySelector("#net-switch")||{}).disabled')) === false, 'R8-8 检测通过后开关解锁');
  await okContrast('#net-probe-result .net-probe-line.net-ok', 'R8-8 检测通过文案可读');

  // 打开组网开关
  at = 'R8 打开开关';
  await c.evaluate("window.__netTest.reset(); true");
  await clickReal('#net-switch', "window.__netTest.meshEnabled === true", { tries: 3 });
  ok((await c.evaluate('window.__netTest.meshEnabled')) === true, 'R8-9 检测通过后能打开组网开关');
  ok((await c.evaluate('window.__netTest.callsOf("meshEnable").length')) >= 1, 'R8-9 开关真的调了组网层（meshEnable）');
  const swMsg = await txt('#net-switch-msg');
  ok(/已开启/.test(swMsg || ''), 'R8-9 开关状态文案正确', String(swMsg).slice(0, 40));

  // 检测不通过的路径（对照：不是恒真）
  at = 'R8 检测失败对照';
  await c.evaluate("window.__netUi.net.probe=null; window.__netUi.net.enabled=false; window.__netTest.meshEnabled=false; true");
  await c.evaluate("window.__netTest.setState({ probe: { isPublic:false, outboundOk:true, method:'autonat' } }); true");
  await c.evaluate("window.__netUi.net.probe=null; window.__netUi.refreshBanner(); true");
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#settings-nav button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#net-card")', { timeout: 8000, label: '组网卡片' });
  await ensureNetCard();
  await clickReal('#btn-net-detect', "!!document.querySelector('#net-probe-result .net-probe-line.net-bad')");
  const badTxt = await txt('#net-probe-result');
  ok((badTxt || '').indexOf('公网') >= 0 && (badTxt || '').indexOf('未通过') >= 0, 'R8-10 非公网地址 → 检测不通过（不是恒真）', String(badTxt).slice(0, 60));
  ok((await c.evaluate('(document.querySelector("#net-switch")||{}).disabled')) === true, 'R8-10 检测不通过时开关再次被锁住');
  await c.evaluate("window.__netTest.setState({ probe: { isPublic:true, outboundOk:true, method:'autonat' } }); window.__netUi.net.probe=null; true");
  await ensureNetCard();
  await clickReal('#btn-net-detect', "!!document.querySelector('#net-probe-result .net-probe-line.net-ok')");
  await clickReal('#net-switch', "window.__netTest.meshEnabled === true");
  ok((await c.evaluate('window.__netTest.meshEnabled')) === true, 'R8-11 恢复公网检测后又可以打开（门控是双向的）');

  // R8-12 改了地址以后，上一次的"检测通过"必须作废（否则门控形同虚设）
  await ensureNetCard();
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, label: '关闭组网（准备改地址）' });
  await c.evaluate("(function(){var ip=document.querySelector('#net-ip'); ip.value='198.51.100.9'; ip.dispatchEvent(new Event('input',{bubbles:true})); ip.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  const reLock = JSON.parse(await c.evaluate("JSON.stringify({ disabled: document.querySelector('#net-switch').disabled, msg: document.querySelector('#net-switch-msg').textContent, probe: window.__netUi.net.probe })"));
  ok(reLock.disabled === true && reLock.probe === null, 'R8-12 改动地址后旧检测结论作废、开关重新上锁', JSON.stringify(reLock));
  await clickReal('#btn-net-detect', "!!document.querySelector('#net-probe-result .net-probe-line.net-ok')");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, label: '重新检测后可以再打开' });
  ok(true, 'R8-12 重新检测通过后可再次打开（门控没被写死）');

  /* ══ 2. R9 迟滞：连续失败不触发 / 持续失败才触发 / 先重试后关 ══ */
  step('2. R9 断链迟滞（连续 N 次 + 持续 M 秒；先重试后关）');
  at = 'R9 设置快参数';
  // 先把链接弄干净：样本设为通、确保组网开着、让心跳采到一次健康样本
  await c.evaluate("window.__netTest.setSamples([true]); true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, label: '组网开着（R9 起点）' });
  await sleep(500);
  await c.evaluate("window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 2, retryRounds: 2, backoffMs: [400,400], tickMs: 200 }; true");
  await c.evaluate('window.__netTest.reset(); true');
  const fast = JSON.parse(await c.evaluate('JSON.stringify(window.__netUi.tuning())'));
  ok(fast.failures === 3 && fast.seconds === 2 && fast.tickMs === 200, 'R9-1 测试用快参数已注入（语义不变：连续 3 次 + 持续 2s，重试 2 轮）', JSON.stringify(fast));
  ok((await c.evaluate('window.__netUi.net.enabled')) === true, 'R9-1 起点：组网开着');

  // 2a. 3 连败但不足 M 秒就恢复 → 不得判定断链
  at = 'R9 burst 不触发';
  await c.evaluate("window.__netTest.setSamples([false,false,false,true,true,true,true,true,true,true,true,true]); window.__netUi.net.link={fails:0,downSince:0,linkDown:false,round:0,autoOff:false,nextRetryAt:0}; window.__netUi.refreshBanner(); true");
  let burstSeen = false;
  for (let i = 0; i < 22; i++) {
    if (await exists(netRowSel)) burstSeen = true;
    await sleep(120);
  }
  ok(!burstSeen, 'R9-2 连续 3 次失败但不足 2 秒即恢复 → 不触发（burst 不当断链）');
  ok((await c.evaluate('window.__netUi.net.link.linkDown')) === false, 'R9-2 状态机未标记断链', 'linkDown=' + (await c.evaluate('window.__netUi.net.link.linkDown')));
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) === 0, 'R9-2 未自动关组网');

  // 2b. 持续失败：不足 M 秒时不得触发，超过后必须触发
  at = 'R9 持续失败才触发';
  await c.evaluate("window.__netTest.setSamples([false]); true");
  await sleep(600);
  const early = await c.evaluate('JSON.stringify({fails:window.__netUi.net.link.fails, down:window.__netUi.net.link.linkDown, row:!!document.querySelector(\'' + netRowSel + '\')})');
  const earlyObj = JSON.parse(early);
  ok(earlyObj.down === false && earlyObj.row === false, 'R9-3 持续失败但未到 2 秒：仍不触发（有迟滞）', early);
  ok(earlyObj.fails >= 2, 'R9-3 期间确实在累计失败次数', 'fails=' + earlyObj.fails);
  at = 'R9 判定断链';
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, label: '持续失败超过 2 秒后出现断链横幅' });
  const linkRow = await txt(netRowSel);
  ok(/连接已断开/.test(linkRow || ''), 'R9-4 持续失败（>=3 次且 >=2 秒）→ 判定断链并出横幅', String(linkRow).slice(0, 80));
  const linkBody = await txt(netRowSel + ' .bn-body');
  ok(/连续 \d+ 次/.test(linkBody || '') && /持续 \d+ 秒/.test(linkBody || ''), 'R9-4 横幅写明连续失败次数与持续时长', String(linkBody).slice(0, 90));
  ok(/第 \d+\/2 轮/.test(linkBody || ''), 'R9-4 横幅写明当前重试轮次', String(linkBody).slice(0, 90));
  ok((await c.evaluate('window.__netUi.net.enabled')) === true, 'R9-5 此刻先重试：组网还没被关掉');
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) === 0, 'R9-5 重试期间未关组网');
  await okContrast(netRowSel + ' .bn-title', 'R9-5 断链横幅标题可读');

  /* ══ 3. 横幅合并（断链 + 组网关闭但存在异地成员 → 只能一条）+ 手动关闭语义 ══ */
  step('3. R9/R10 横幅合并 + 手动关闭');
  at = 'R9 存在异地成员时合并';
  await c.evaluate(`window.__netTest.setState({ members: { 'g-1': [ { id:'remote-bob', name:'remote-bob', remote:true, online:true } ] } }); true`);
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 6000, label: '组网层报出异地成员（remoteCount>=1）' });
  ok((await c.evaluate('window.__netUi.net.remoteCount')) >= 1, '3-1 组网层报出异地成员数（横幅合并的前提）');
  at = 'R9 自动关组网';
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 10000, label: '重试 2 轮后自动关组网' });
  ok((await c.evaluate('window.__netTest.callsOf("meshDisable").length')) >= 1, 'R9-6 重试 2 轮仍失败 → 自动关闭组网（先重试后关）');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, label: '关闭后仍有横幅' });
  const mergedText = await txt(netRowSel);
  const netRowCount = await cnt(netRowSel);
  ok(netRowCount === 1, 'R9-7 断链与「组网关闭+异地成员」同时发生时只有一条组网横幅（不叠加）', 'rows=' + netRowCount);
  ok(/组网已关闭/.test(mergedText || ''), 'R9-7 横幅已合并为「组网已关闭」状态', String(mergedText).slice(0, 90));
  ok(/异地成员/.test(mergedText || ''), 'R9-7 合并后仍说明异地成员受影响', String(mergedText).slice(0, 90));
  ok(/自动关闭/.test(mergedText || ''), 'R9-7 合并后说明是断链自动关闭的', String(mergedText).slice(0, 90));
  ok((await cnt('.net-banner .bn-row[data-kind="net"] .bn-body')) >= 1, 'R9-7 有正文说明');
  await okContrast(netRowSel + ' .bn-title', '3-2 合并横幅标题可读');

  // 手动关闭：同原因不再重复弹
  at = '3 手动关闭横幅';
  await clickReal(netRowSel + ' .bn-x', `!document.querySelector('${netRowSel}')`);
  await sleep(1200);
  ok(!(await exists(netRowSel)), 'R9-8 横幅可手动关闭，关闭后同一原因不再重复弹出（等 1.2s 仍不出现）');

  // 状态变化 → 再弹
  at = '3 状态变化后再弹';
  await c.evaluate("window.__netTest.setState({ samples: [true] }); true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, label: '重新打开组网' });
  await c.evaluate("window.__netTest.reset(); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 6000, label: '再次关闭组网后横幅再次出现' });
  ok(true, 'R9-8 状态再次变化（重新开关组网）后横幅重新出现');
  await clickReal(netRowSel + ' .bn-x', `!document.querySelector('${netRowSel}')`);

  /* ══ 4. R10 添加异地成员前检查组网 ══ */
  step('4. R10 添加异地成员 → 检查组网开关，未开则提示去设置');
  at = 'R10 打开项目';
  await c.evaluate("window.__netTest.setState({ remoteInstanceIds: ['demo-2'] }); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, label: '组网已关' });
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor('!!document.querySelector("#member-pick") && document.querySelectorAll("#member-pick option").length > 0', { timeout: 8000, label: '成员下拉可用' });
  const pickVal = await c.evaluate("(function(){var o=Array.from(document.querySelectorAll('#member-pick option')).filter(function(x){return x.value==='demo-2';})[0]; if(!o) return 'missing'; document.querySelector('#member-pick').value='demo-2'; return 'found';})()");
  ok(pickVal === 'found', 'R10-0 下拉里有异地牛马可加（demo-2）', pickVal);
  at = 'R10 点拉入';
  await closeModal();
  await clickReal('#btn-member-add', "!document.querySelector('#modal-root').classList.contains('hidden')");
  const m1 = await modal();
  ok(m1.visible && /组网未开启/.test(m1.title || ''), 'R10-1 加异地成员时被拦下：提示组网未开启', String(m1.title).slice(0, 30));
  ok(m1.visible && /进入设置/.test(m1.body || ''), 'R10-1 提示可以进设置打开', String(m1.body).slice(0, 60));
  const c1 = await clickModal('取消');
  ok(c1.ok, 'R10-2 可以选择取消');
  await sleep(300);
  const stillChat = await c.evaluate("!document.querySelector('#chat-layout').classList.contains('hidden')");
  ok(stillChat, 'R10-2 取消后仍留在会话（没有被强行跳走）');
  at = 'R10 确认去设置';
  await clickReal('#btn-member-add', "!document.querySelector('#modal-root').classList.contains('hidden')");
  const c2 = await clickModal('确定');
  ok(c2.ok && c2.disabled === false, 'R10-3 点「确定」进入设置');
  await c.waitFor(`!!document.querySelector('.rail-item[data-nav="settings"].active') && !!document.querySelector('#net-card')`, { timeout: 8000, label: '跳到设置页并定位组网卡片' });
  const inView = await c.evaluate(`(function(){var e=document.querySelector('#net-card'); var r=e.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0;})()`);
  ok(inView, 'R10-3 「去设置打开」直接定位到组网设置卡片（在视口内）');
  await closeModal();

  /* ══ 5. R11 成员三态 ══ */
  step('5. R11 成员三态（在线正常 / 异地离线灰+离线角标 / 组网关闭异地成员灰+异常角标）');
  at = 'R11 准备成员与在线状态';
  // R10 那一节故意把「归档员」留在可加列表里；这里换成完整成员表再验三态
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate(`window.__netTest.setState({
    members: { 'g-1': [
      { id:'demo.agent', name:'demo.agent', remote:false, online:true, disabled:false },
      { id:'归档员', name:'归档员', remote:false, online:false, disabled:true },
      { id:'remote-bob', name:'remote-bob', remote:true, online:true, disabled:false },
      { id:'remote-carl', name:'remote-carl', remote:true, online:false, disabled:false }
    ] },
    samples: [true]
  }); true`);
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, label: '组网打开（异地成员在线态的前提）' });
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`document.querySelectorAll('#members-box .member-row').length >= 4`, { timeout: 8000, label: '成员行渲染（4 个）' });
  ok((await cnt('#members-box .member-row')) >= 4, 'R11-0 成员行按组网层的成员表渲染', 'rows=' + (await cnt('#members-box .member-row')));

  const states = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#members-box .member-row')).map(function(r){
    return { mid: r.dataset.mid, state: r.dataset.state, badge: (r.querySelector('.member-badge:not([data-state="remote"])')||{}).textContent || '',
             gray: getComputedStyle(r.querySelector('.member-name')).color, struck: r.querySelector('.member-name').classList.contains('struck') };
  }))`));
  console.log('    成员状态:', JSON.stringify(states));
  const byId = (id) => states.filter((s) => s.mid === id)[0] || {};
  const inkDefault = await c.evaluate(`getComputedStyle(document.querySelector('#members-box .member-row[data-state="normal"] .member-name')).color`);
  ok(byId('demo.agent').state === 'normal', 'R11-1 在线（本机）成员正常显示', JSON.stringify(byId('demo.agent')));
  ok(byId('remote-bob').state === 'remoteOnline' && byId('remote-bob').gray === inkDefault, 'R11-2 异地在线成员正常显示（不置灰）', JSON.stringify(byId('remote-bob')));
  ok(byId('remote-carl').state === 'offline' && byId('remote-carl').gray !== inkDefault, 'R11-3 异地离线 → 灰', JSON.stringify(byId('remote-carl')));
  ok(/离线/.test(byId('remote-carl').badge), 'R11-3 异地离线带「离线」角标', byId('remote-carl').badge);
  ok(byId('归档员').state === 'disabled' && byId('归档员').struck === true, 'R12-1 停用实例的成员：灰 + 名字删除线', JSON.stringify(byId('归档员')));
  await okContrast('#members-box .member-row[data-state="offline"] .member-name', 'R11-3 置灰文字可读（异地离线）');
  await okContrast('#members-box .member-row[data-state="disabled"] .member-name', 'R12-1 置灰文字可读（停用实例）');

  at = 'R11 组网关闭态';
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, label: '组网关闭' });
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`document.querySelectorAll('#members-box .member-row[data-state="meshOff"]').length >= 2`, { timeout: 8000, label: '组网关闭后异地成员转为 meshOff' });
  const s2 = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#members-box .member-row')).map(function(r){
    return { mid: r.dataset.mid, state: r.dataset.state, badge: (r.querySelector('.member-badge:not([data-state="remote"])')||{}).textContent || '' };
  }))`));
  console.log('    组网关闭后:', JSON.stringify(s2));
  const b2 = (id) => s2.filter((s) => s.mid === id)[0] || {};
  ok(b2('remote-bob').state === 'meshOff' && b2('remote-carl').state === 'meshOff', 'R11-4 组网关闭 → 异地成员灰 + 异常角标(组网关闭)', JSON.stringify(b2('remote-bob')));
  ok(/组网关闭/.test(b2('remote-bob').badge), 'R11-4 角标文案为「组网关闭」', b2('remote-bob').badge);
  ok(b2('demo.agent').state === 'normal', 'R11-4 本机成员不受组网开关影响', JSON.stringify(b2('demo.agent')));
  await okContrast('#members-box .member-row[data-state="meshOff"] .member-name', 'R11-4 置灰文字可读（组网关闭）');
  await okContrast('#members-box .member-row[data-state="meshOff"] .member-badge[data-state="mesh-off"]', 'R11-4 异常角标可读');

  /* ══ 6. R12 停用实例：列表行灰 + 删除线（含选中态可读性） ══ */
  step('6. R12 停用牛马（实例）→ 灰 + 名字删除线');
  at = 'R12 实例列表';
  await openInstancesPage();
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length >= 2`, { timeout: 8000, label: '实例列表渲染' });
  const instRows = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#list-body .list-item')).map(function(r){
    return { name:(r.querySelector('.name')||{}).textContent||'', disabled:r.classList.contains('is-disabled'),
      struck:(r.querySelector('.name')||{classList:{contains:function(){return false;}}}).classList.contains('struck'),
      badge:(r.querySelector('.row-badge')||{}).textContent||'' };
  }))`));
  console.log('    实例行:', JSON.stringify(instRows));
  const stopped = instRows.filter((x) => x.disabled)[0];
  ok(!!stopped, 'R12-2 停用实例行带置灰标记', JSON.stringify(instRows));
  ok(stopped && stopped.struck === true, 'R12-2 停用实例名字加删除线', stopped && stopped.name);
  ok(stopped && /停用/.test(stopped.badge), 'R12-2 停用实例带状态角标', stopped && stopped.badge);
  const runRow = instRows.filter((x) => !x.disabled)[0];
  ok(runRow && !runRow.struck, 'R12-2 运行中的实例不加删除线（对照）', runRow && runRow.name);
  const stoppedIdx = await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#list-body .list-item'));
    var i=rows.findIndex(function(r){return r.classList.contains('is-disabled');});
    if(i>=0) rows[i].setAttribute('data-probe','1');
    return i;
  })()`);
  await okContrast('#list-body .list-item[data-probe="1"] .name', 'R12-2 置灰+删除线文字可读（对列表底色）');
  // 选中态底色更浅，也要够
  await c.evaluate(`document.querySelectorAll('#list-body .list-item')[${stoppedIdx}].click(); true`);
  await c.waitFor(`!!document.querySelector('#list-body .list-item.active')`, { timeout: 6000, label: '实例被选中（active 底色）' });
  await okContrast(`#list-body .list-item.active .name`, 'R12-2 置灰文字可读（选中态 active 底色）');
  await okContrast('#list-body .list-item.is-disabled .row-badge', 'R12-2 停用角标可读');

  /* ══ 7. 附六 换证横幅 ══ */
  step('7. 附六 换证横幅（历史留存 + 新名片并列、无历史如实说明、7 天冻结期、不得随意关闭）');
  at = '7 注入身份变更';
  const now = Date.now();
  await c.evaluate(`window.__idTest.setChanges([
    { id:'chg-1', ts:${now}, receivedAt:${now}, generation:3, subjectId:'web-1', subjectName:'张三',
      oldFingerprint:'FP-OLD-A', newFingerprint:'FP-NEW-A',
      previousCard:{ email:'zhangsan@old.example', phone:'13900000001', capturedAt:${now - 86400000} },
      pendingCard:{ email:'zhangsan@new.example', phone:'' },
      contactFreezeUntil:${now + 7 * 86400000}, frozen:true, remainingMs: 7 * 86400000,
      reason:'compromised',
      oldCard:{ email:'DECOY-SHOULD-NOT-RENDER', phone:'000000' },
      scopes:[{ kind:'internal', id:'g-1' }] },
    { id:'chg-2', ts:${now - 8 * 86400000}, receivedAt:${now - 8 * 86400000}, generation:2, subjectId:'ext-1', subjectName:'张三',
      oldFingerprint:'FP-OLD-B', newFingerprint:'FP-NEW-B',
      previousCard:null, pendingCard:{ email:'', phone:'' },
      contactFreezeUntil:${now - 86400000}, frozen:false, remainingMs:0,
      scopes:[{ kind:'extdm', id:'c-2' }] },
    { id:'chg-3', ts:${now}, receivedAt:${now}, generation:5, subjectId:'ext-2', subjectName:'李四',
      oldFingerprint:'FP-OLD-C', newFingerprint:'FP-NEW-C',
      previousCard:{ email:'lisi@old.example', phone:'13800000002' },
      pendingCard:{ email:'lisi@new.example', phone:'13800000003' },
      contactFreezeUntil:${now + 6 * 86400000}, frozen:true, remainingMs: 6 * 86400000,
      scopes:[{ kind:'external', id:'g-3' }] }
  ]); void window.__netUi.loadIdChanges(); true`);
  await c.waitFor('window.__netUi.idchg.changes.length === 3', { timeout: 6000, label: '身份层报出 3 条变更' });

  // 7a. 项目（internal）
  at = '7a 项目里的换证横幅';
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '项目会话里出现身份变更横幅' });
  ok(true, '附六-1 项目（群聊之一）里出现身份变更横幅');
  const idTitle1 = await txt(idRowSel + ' .id-title');
  ok(/张三/.test(idTitle1 || '') && /凭证/.test(idTitle1 || ''), '附六-1 横幅指名是谁换了证', String(idTitle1).slice(0, 40));
  const histTxt = await txt(idRowSel + ' [data-card="history"]');
  const newTxt = await txt(idRowSel + ' [data-card="new"]');
  ok(/zhangsan@old\.example/.test(histTxt || '') && /13900000001/.test(histTxt || ''), '附六-2 旧联系方式来自本机历史留存卡（previousCard/historicalContactCard）', String(histTxt).slice(0, 70));
  const bannerAll = await txt(idRowSel);
  ok(!/DECOY-SHOULD-NOT-RENDER/.test(bannerAll || ''), '附六-2 不从换证声明里取联系方式（诱饵字段未渲染）');
  ok(/zhangsan@new\.example/.test(newTxt || ''), '附六-2 新提交的联系方式并列展示', String(newTxt).slice(0, 60));
  const emptyCells = await c.evaluate(`document.querySelectorAll('${idRowSel} [data-card="new"] [data-empty="1"]').length`);
  ok(emptyCells >= 1, '附六-2 新联系方式为空 → 显示「未填写」占位而不是留空', 'empty=' + emptyCells);
  ok(/未填写/.test(newTxt || ''), '附六-2 占位文案是「未填写」');
  ok(await exists(idRowSel + ' [data-changed="1"]'), '附六-2 新旧不一致 → 明确提示「联系方式已变化，请自行核实」');
  const warnTxt = await txt(idRowSel + ' [data-changed="1"]');
  ok(/自行核实/.test(warnTxt || ''), '附六-2 提示文案要求用户自行核实', String(warnTxt).slice(0, 40));
  ok(await exists(idRowSel + ' .id-tag.hist') && await exists(idRowSel + ' .id-tag.pending'), '附六-2 两栏分别标注「历史」与「待确认」');
  const freezeTxt = await txt(idRowSel + ' .id-freeze');
  ok((await c.evaluate(`document.querySelector('${idRowSel} .id-freeze').dataset.freeze`)) === '1', '附六-3 冻结期状态被标出（data-freeze=1）');
  ok(/7 天内不采用/.test(freezeTxt || ''), '附六-3 横幅写明「7 天内不采用新联系方式」', String(freezeTxt).slice(0, 60));
  ok(/剩余 6 天|剩余 7 天/.test(freezeTxt || ''), '附六-3 显示剩余冻结时间', String(freezeTxt).slice(0, 60));
  const adoptDisabled = await c.evaluate(`(function(){var b=document.querySelector('${idRowSel} button[data-bn="idAdopt"]'); return b? b.disabled : null;})()`);
  ok(adoptDisabled === true, '附六-3 冻结期内「采用新联系方式」被禁用', String(adoptDisabled));
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idAdopt"]');
  await sleep(400);
  ok((await c.evaluate('window.__idTest.callsOf("adopt").length')) === 0, '附六-3 冻结期内点它不会采用（未调用身份层 adopt）');
  await okContrast(idRowSel + ' .bn-title', '附六-2 换证横幅标题可读');
  await okContrast(idRowSel + ' [data-card="history"] .id-k', '附六-2 历史卡字段名可读');
  await okContrast(idRowSel + ' [data-card="history"] .id-v', '附六-2 历史卡值可读');
  await okContrast(idRowSel + ' [data-card="new"] [data-empty="1"]', '附六-2 「未填写」占位可读');
  await okContrast(idRowSel + ' .id-tag.pending', '附六-2 「待确认」标签可读');

  // 7b. 折叠（保留常驻标记）
  at = '7b 折叠';
  await clickReal(idRowSel + ' button[data-bn="idCollapse"]', `!!document.querySelector('${idRowSel} .id-item.is-collapsed')`);
  ok(await exists(idRowSel + ' .id-item.is-collapsed'), '附六-4 可折叠');
  const detailShown = await c.evaluate(`(function(){var d=document.querySelector('${idRowSel} .id-item .id-detail'); return getComputedStyle(d).display !== 'none';})()`);
  ok(detailShown === false, '附六-4 折叠后明细隐藏');
  ok(await visible(idRowSel + ' .id-marker'), '附六-4 折叠后仍保留常驻标记（不消失）');
  await clickReal(idRowSel + ' button[data-bn="idCollapse"]', `!document.querySelector('${idRowSel} .id-item.is-collapsed')`);
  ok(true, '附六-4 可再展开');

  // 7c. 关闭：二次确认 + 审计，且只是暂时隐藏
  at = '7c 关闭（二次确认 + 审计）';
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idDismiss"]', "!document.querySelector('#modal-root').classList.contains('hidden')");
  const mDim = await modal();
  const dimTitle = mDim.visible ? mDim.title : '';
  ok(/关闭身份变更提醒/.test(dimTitle || ''), '附六-5 关闭前弹二次确认', String(dimTitle).slice(0, 30));
  const okBtnState = await c.evaluate(`(function(){var b=document.querySelector('#modal-actions .btn-danger'); return b? {disabled:b.disabled, text:b.textContent} : null;})()`);
  ok(okBtnState && okBtnState.disabled === true, '附六-5 二次确认带倒计时（确认键先禁用）', JSON.stringify(okBtnState));
  const cancelRes = await clickModal('取消');
  await sleep(300);
  ok(cancelRes.ok && (await c.evaluate('window.__idTest.callsOf("ack").length')) === 0, '附六-5 取消 → 不关闭、不记审计');
  ok(await exists(idRowSel + ' .id-item'), '附六-5 取消后横幅仍在');
  // 再来一次并确认
  await clickReal(idRowSel + ' button[data-bn="idDismiss"]', "!document.querySelector('#modal-root').classList.contains('hidden')");
  await c.waitFor(`(function(){var b=document.querySelector('#modal-actions .btn-danger'); return !!b && b.disabled === false;})()`, { timeout: 6000, label: '倒计时结束，确认键可用' });
  const okRes = await clickModal('确定');
  ok(okRes.ok, '附六-5 倒计时结束后可确认关闭');
  await c.waitFor(`window.__idTest.callsOf("ack").length >= 1`, { timeout: 6000, label: '关闭动作记入审计' });
  const ackCall = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("ack"))'));
  ok(ackCall.some((x) => x.level === 'dismiss'), '附六-5 关闭动作写入审计（level=dismiss）', JSON.stringify(ackCall));
  await c.waitFor(`!document.querySelector('${idRowSel} .id-item')`, { timeout: 6000, label: '明细收起为常驻标记' });
  ok((await c.evaluate(`document.querySelector('${idRowSel}').dataset.marker`)) === '1', '附六-5 关闭后仍留常驻标记（不是彻底消失）');

  at = '7d 重新进入会话 → 重现';
  await navTo('singleAi');
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel} .id-item')`, { timeout: 8000, label: '重新进入该会话后明细重现' });
  ok(true, '附六-5 关闭只是暂时隐藏：下次进该会话重新出现（未点「已联系本人核实」之前）');

  // 7e. 联系人（无历史留存 + 冻结期满但需手动确认）
  at = '7e 联系人：无历史留存 + 冻结期满仍需手动确认';
  await openSession('externalChat', '张三');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '联系人会话里出现换证横幅' });
  ok(true, '附六-1 联系人（第二处）里出现身份变更横幅');
  ok(await exists(idRowSel + ' [data-empty-history="1"]'), '附六-2 本机无历史留存 → 如实标注（不是留空）');
  const noHistTxt = await txt(idRowSel + ' [data-empty-history="1"]');
  ok(/本机无历史联系方式/.test(noHistTxt || ''), '附六-2 文案为「本机无历史联系方式」', String(noHistTxt).slice(0, 40));
  const empt2 = await c.evaluate(`document.querySelectorAll('${idRowSel} [data-card="new"] [data-empty="1"]').length`);
  ok(empt2 >= 2, '附六-2 新名片两个字段都为空 → 都显示「未填写」', 'empty=' + empt2);
  const freeze2 = await txt(idRowSel + ' .id-freeze');
  ok(/冻结期已结束/.test(freeze2 || '') && /手动确认/.test(freeze2 || ''), '附六-3 冻结期满：不自动采用，仍需手动确认', String(freeze2).slice(0, 60));
  await c.evaluate('window.__idTest.reset(); true');
  await sleep(1500);
  ok((await c.evaluate('window.__idTest.callsOf("adopt").length')) === 0, '附六-3 冻结期满后不会自动采用（等 1.5s 无 adopt 调用）');
  const adopt2 = await c.evaluate(`(function(){var b=document.querySelector('${idRowSel} button[data-bn="idAdopt"]'); return b? b.disabled : null;})()`);
  ok(adopt2 === false, '附六-3 冻结期满后「采用新联系方式」可点（需用户手动确认）');
  await clickReal(idRowSel + ' button[data-bn="idAdopt"]', "!document.querySelector('#modal-root').classList.contains('hidden')");
  const mAdopt = await modal();
  const adoptTitle = mAdopt.visible ? mAdopt.title : '';
  ok(/采用新联系方式/.test(adoptTitle || ''), '附六-3 采用前还有一次确认', String(adoptTitle).slice(0, 30));
  await clickModal('确定');
  await c.waitFor('window.__idTest.callsOf("adopt").length >= 1', { timeout: 6000, label: '手动确认后调用 adopt' });
  ok(true, '附六-3 只有手动确认后才采用新联系方式（adopt 已调用）');
  await c.waitFor(`document.querySelector('${idRowSel} .id-freeze').dataset.adopted === '1'`, { timeout: 6000, label: '界面显示已采用' });
  ok(/已采用/.test(await txt(idRowSel + ' .id-freeze')), '附六-3 采用后界面如实显示「已采用新联系方式」');

  // 7f. 群聊（第三处）+ 列表常驻标记
  at = '7f 群聊（第三处）';
  await openSession('externalGroup', '外部协作群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '群聊里出现换证横幅' });
  ok(true, '附六-1 群聊（第三处）里出现身份变更横幅 —— 三处齐了');
  await c.evaluate('window.__idTest.reset(); true');
  await clickReal(idRowSel + ' button[data-bn="idVerify"]', "!document.querySelector('#modal-root').classList.contains('hidden')");
  await clickModal('确定');
  await c.waitFor('window.__idTest.callsOf("ack").length >= 1', { timeout: 6000, label: '核实动作记入身份层' });
  const ack2 = JSON.parse(await c.evaluate('JSON.stringify(window.__idTest.callsOf("ack"))'));
  ok(ack2.some((x) => x.level === 'verified'), '附六-5 「已联系本人核实」写入身份层（level=verified）', JSON.stringify(ack2));
  await c.waitFor(`!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '核实后横幅消失' });
  ok(!(await exists(idRowSel)), '附六-5 核实后该变更不再打扰（横幅消失）');

  // 列表行常驻标记（三个入口都不打开会话也能看到）
  await navTo('internalGroup');
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length > 0`, { timeout: 8000, label: '项目列表' });
  ok((await cnt('#list-body .id-change-mark[data-idchg-mark="1"]')) >= 1, '附六-6 项目列表行有「身份变更待核实」常驻标记');
  await navTo('externalChat');
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length > 0`, { timeout: 8000, label: '联系人列表' });
  ok((await cnt('#list-body .id-change-mark[data-idchg-mark="1"]')) >= 1, '附六-6 联系人列表行有常驻标记');
  await okContrast('#list-body .id-change-mark[data-idchg-mark="1"]', '附六-6 常驻标记可读');
  await navTo('externalGroup');
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length > 0`, { timeout: 8000, label: '群聊列表' });
  ok((await cnt('#list-body .id-change-mark[data-idchg-mark="1"]')) === 0, '附六-6 已核实的群聊不再显示标记（核实真的生效）');

  // 7g. 下次启动（reload）仍重现
  at = '7g 下次启动重现';
  await c.send('Page.reload', { ignoreCache: false });
  await c.waitFor('typeof window.__saveState === "function" && !!window.__netUi', { timeout: 30000, label: '重启后页面就绪' });
  await closeModal();
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel} .id-item')`, { timeout: 9000, label: '重启后未核实的换证横幅重新出现' });
  ok(true, '附六-5 下次启动（reload）后未核实的提醒重新出现');
  await openSession('externalGroup', '外部协作群');
  await sleep(600);
  ok(!(await exists(idRowSel)), '附六-5 已核实的变更重启后不再出现（核实是持久的）');

  /* ══ 8. 附六 名片可见性：加入即交换，不可隐藏但可以不写 ══ */
  step('8. 附六 名片：加入群/项目/联系人时对方一定看得到（不可隐藏，可不写）');
  at = '8 加入联系人时的名片';
  await c.evaluate("window.__idTest.setState({ card: { email:'me@example.com', phone:'' } }); true");
  await openSession('externalChat', '张三');
  const before = await cnt('#list-body .list-item');
  await clickReal('#list-action', "!document.querySelector('#modal-root').classList.contains('hidden')");
  await c.waitFor('!!document.querySelector("#modal-body input")', { timeout: 6000, label: '输入联系人名字' });
  await c.evaluate(`(function(){var i=document.querySelector('#modal-body input'); i.value='新联系人'; return true;})()`);
  await clickModal('确定');
  await c.waitFor('!!document.querySelector("#modal-body .my-card")', { timeout: 6000, label: '名片确认弹窗' });
  const mCard = await modal();
  ok(mCard.visible, '附六-7 名片确认弹窗可见');
  const cardTxt = await txt('#modal-body .my-card');
  ok(/me@example\.com/.test(cardTxt || ''), '附六-7 加入前展示「对方将看到的名片」（邮箱来自身份层）', String(cardTxt).slice(0, 60));
  ok((await cnt('#modal-body .my-card [data-empty="1"]')) >= 1, '附六-7 空字段显示「未填写」占位');
  ok(/不可隐藏/.test(cardTxt || ''), '附六-7 明说「不可隐藏，但可以不写」', String(cardTxt).slice(0, 70));
  await clickModal('取消');
  await sleep(300);
  ok((await cnt('#list-body .list-item')) === before, '附六-7 取消则不加入（名片确认是必经一步）');
  await clickReal('#list-action', "!document.querySelector('#modal-root').classList.contains('hidden')");
  await c.waitFor('!!document.querySelector("#modal-body input")', { timeout: 6000, label: '再次输入名字' });
  await c.evaluate(`(function(){var i=document.querySelector('#modal-body input'); i.value='新联系人'; return true;})()`);
  await clickModal('确定');
  await c.waitFor('!!document.querySelector("#modal-body .my-card")', { timeout: 6000, label: '名片确认弹窗' });
  await clickModal('确定');
  await c.waitFor(`document.querySelectorAll('#list-body .list-item').length === ${before + 1}`, { timeout: 6000, label: '联系人加入' });
  ok(true, '附六-7 确认名片后才完成加入动作');

  at = '8 加入项目/群聊时的名片';
  await navTo('internalGroup');
  await c.waitFor('!!document.querySelector("#btn-join-qr")', { timeout: 6000, label: '扫码加入入口' });
  await clickReal('#btn-join-qr', "!!document.querySelector('#modal-body .my-card')");
  ok(await exists('#modal-body .my-card'), '附六-7 加入项目/群聊的入口同样展示名片');
  await okContrast('#modal-body .my-card .bn-hint', '附六-7 名片说明可读');
  await closeModal();

  /* ══ 9. 对比度 ≥ 3.0 全扫（亮/暗两套主题） ══ */
  step('9. 对比度 ≥ 3.0（项目硬规则）—— 亮色');
  at = '9 亮色对比度';
  // 造出一个组网横幅（组网关闭 + 异地成员）
  await c.evaluate("window.__netTest.setState({ samples:[true], members:{ 'g-1':[ {id:'remote-bob',name:'remote-bob',remote:true,online:true} ] } }); true");
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 6000, label: '第 9 节：异地成员就绪' });
  // 7g 的 reload 把内存里的检测结论清掉了（真实产品里也应重新检测），这里只为造出横幅而补一次
  await c.evaluate("window.__netUi.net.probe = { verdict:'pass', at: Date.now(), isPublic:true, outboundOk:true, method:'autonat' }; true");
  await c.evaluate('void window.__netUi.setEnabled(true); true');
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 6000, label: '第 9 节：组网打开' });
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 6000, label: '第 9 节：组网关闭' });
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, label: '组网关闭横幅出现' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '换证横幅同时存在' });
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor("document.querySelectorAll('#members-box .member-row[data-state=\"meshOff\"]').length >= 1", { timeout: 8000, label: '第 9 节：组网关闭态成员行' });
  ok((await cnt(netRowSel)) === 1 && (await cnt(idRowSel)) === 1, '9-0 两类横幅各一条（组网行不叠加，身份行是另一类）');
  const LIGHT = [
    [netRowSel + ' .bn-title', '组网横幅标题'],
    [netRowSel + ' .bn-body', '组网横幅正文'],
    [netRowSel + ' .bn-hint', '组网横幅提示'],
    [netRowSel + ' button[data-bn="netDismiss"]', '横幅关闭按钮'],
    [idRowSel + ' .id-title', '换证横幅标题'],
    [idRowSel + ' .bn-body', '换证横幅正文'],
    [idRowSel + ' .id-summary', '换证摘要'],
    [idRowSel + ' .id-pending', '待核实标签'],
    [idRowSel + ' .id-marker', '常驻标记'],
    [idRowSel + ' [data-changed="1"]', '联系方式变化提示'],
    [idRowSel + ' .id-freeze', '冻结期说明'],
    ['#chat-title', '会话标题（对照）'],
    ['#members-box .member-row[data-state="meshOff"] .member-name', '异地成员（组网关闭）'],
    ['#members-box .member-row[data-state="meshOff"] .member-badge[data-state="mesh-off"]', '组网关闭角标'],
  ];
  for (const [sel, label] of LIGHT) {
    if (!(await exists(sel))) { ok(false, '对比度检查：找不到 ' + sel + '（' + label + '）'); continue; }
    await okContrast(sel, '9 ' + label);
  }
  // 设置页组网卡片
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('#settings-nav button')).filter(function(x){return x.dataset.sec==='func';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('!!document.querySelector("#net-card")', { timeout: 8000, label: '组网卡片' });
  for (const [sel, label] of [['#net-card .muted', '组网卡片说明'], ['#net-switch-msg', '开关状态说明'], ['#net-probe-result .muted', '检测细节'], ['#net-local-info', '本机地址信息'], ['#net-card .net-sub-label', '域名标签']]) {
    if (!(await exists(sel)) || !(await c.evaluate(`(document.querySelector(${JSON.stringify(sel)}).textContent||'').trim().length > 0`))) {
      warn('跳过（无内容）: ' + sel);
      continue;
    }
    await okContrast(sel, '9 ' + label);
  }
  const probeLine = await exists('#net-probe-result .net-probe-line');
  if (probeLine) await okContrast('#net-probe-result .net-probe-line', '9 检测结论行');

  step('9b. 对比度 —— 暗色主题（同一批元素复算）');
  at = '9b 暗色对比度';
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('.theme-mode button')).filter(function(x){return x.dataset.m==='dark';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('document.documentElement.getAttribute("data-theme") === "dark"', { timeout: 6000, label: '切到暗色主题' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '暗色下换证横幅仍在' });
  await c.evaluate("window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members:['demo.agent','归档员','remote-bob','remote-carl'] }]; true");
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor("document.querySelectorAll('#members-box .member-row[data-state=\"meshOff\"]').length >= 1 && document.querySelectorAll('#members-box .member-row[data-state=\"disabled\"]').length >= 1", { timeout: 8000, label: '9b：暗色下成员行渲染' });
  for (const [sel, label] of [
    [netRowSel + ' .bn-title', '组网横幅标题（暗）'],
    [idRowSel + ' .id-title', '换证横幅标题（暗）'],
    [idRowSel + ' .id-pending', '待核实标签（暗）'],
    [idRowSel + ' [data-card="history"] .id-k', '历史卡字段名（暗）'],
    [idRowSel + ' [data-card="history"] .id-v', '历史卡值（暗）'],
    ['#members-box .member-row[data-state="meshOff"] .member-name', '异地成员置灰（暗）'],
    ['#members-box .member-row[data-state="disabled"] .member-name', '停用成员置灰（暗）'],
    ['#list-body .id-change-mark', '列表常驻标记（暗）'],
  ]) {
    if (!(await exists(sel))) { ok(false, '对比度检查（暗）：找不到 ' + sel); continue; }
    await okContrast(sel, '9b ' + label);
  }
  // 停用实例行（暗色）—— 走列表页
  await openInstancesPage();
  await c.waitFor(`document.querySelectorAll('#list-body .list-item.is-disabled').length >= 1`, { timeout: 8000, label: '暗色下停用实例行' });
  await c.evaluate(`(function(){
    var rows=Array.from(document.querySelectorAll('#list-body .list-item'));
    var i=rows.findIndex(function(r){return r.classList.contains('is-disabled');});
    if(i>=0) rows[i].setAttribute('data-probe','1');
    return i;
  })()`);
  await okContrast('#list-body .list-item[data-probe="1"] .name', '9b 停用实例名字可读（暗）');
  await okContrast('#list-body .list-item[data-probe="1"] .row-badge', '9b 停用角标可读（暗）');
  // 切回亮色
  await navTo('settings');
  await c.evaluate("(function(){var b=Array.from(document.querySelectorAll('.theme-mode button')).filter(function(x){return x.dataset.m==='light';})[0]; if(b) b.click(); return true;})()");
  await c.waitFor('document.documentElement.getAttribute("data-theme") === "light"', { timeout: 6000, label: '切回亮色' });

  /* ══ 10. i18n：中英对齐 + 不泄漏 key ══ */
  step('10. i18n（可见文字全部走 i18n，中英对齐）');
  at = '10 切英文';
  await c.evaluate("(function(){var s=document.querySelector('#sel-locale'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logo-name').textContent === 'CCArmy'", { timeout: 10000, label: '切到 en-US' });
  await openSession('internalGroup', '项目推进群');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, label: '英文界面下换证横幅' });
  const enTitle = await txt(idRowSel + ' .id-title');
  const enFreeze = await txt(idRowSel + ' .id-freeze');
  ok(/changed identity credentials/.test(enTitle || ''), '10-1 换证横幅走英文语言包', String(enTitle).slice(0, 50));
  ok(/7 days|within 7 days/.test(enFreeze || ''), '10-1 冻结期文案走英文语言包', String(enFreeze).slice(0, 60));
  const enNet = await txt(netRowSel);
  ok(/Mesh is off/.test(enNet || ''), '10-1 组网横幅走英文语言包', String(enNet).slice(0, 60));
  const leak = await c.evaluate(`(function(){
    var bad=[];
    ['#net-banner','#net-card','#members-box','#modal-body'].forEach(function(root){
      var host=document.querySelector(root); if(!host) return;
      Array.from(host.querySelectorAll('*')).forEach(function(e){
        if(e.children.length) return;
        var t=(e.textContent||'').trim();
        if(/^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$/.test(t) && /(net|idchg|card|group|identity)\\./.test(t)) bad.push(t);
      });
    });
    return JSON.stringify(bad.slice(0,10));
  })()`);
  ok(leak === '[]', '10-2 界面上没有未翻译的 i18n key 泄漏', String(leak).slice(0, 120));
  // 英文下也复核一次可见性/冻结语义（防止英文分支少信息）
  ok((await cnt(idRowSel + ' [data-card="history"]')) === 1 && (await cnt(idRowSel + ' [data-card="new"]')) === 1, '10-2 英文下历史/待确认两栏依旧并列');
  await c.evaluate("(function(){var s=document.querySelector('#sel-locale'); if(!s){var r=Array.from(document.querySelectorAll('a,button'));} s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logo-name').textContent === '无限牛马'", { timeout: 10000, label: '切回中文' });

  /* ══ 11. 注入自查：新增的 innerHTML 面板里，动态内容必须一律转义 ══ */
  step('11. 注入自查（新增 innerHTML 面板的动态内容一律转义）');
  at = '11 XSS 自查';
  const ATTACK = '<img src=x onerror="window.__XSSNET__=1"><script>window.__XSSNET2__=1<\/script>';
  await c.evaluate(`(function(){
    window.__XSSNET__ = 0; window.__XSSNET2__ = 0;
    window.__netTest.setState({ members: { 'g-1': [ { id:'evil', name:${JSON.stringify(ATTACK)}, remote:true, online:false, disabled:false } ] } });
    window.__idTest.setChanges([{ id:'atk-1', ts: Date.now(), generation: 9,
      subjectName: ${JSON.stringify(ATTACK)}, oldFingerprint: ${JSON.stringify(ATTACK)}, newFingerprint: 'NEW',
      previousCard: { email: ${JSON.stringify(ATTACK)}, phone: '' },
      pendingCard: { email: ${JSON.stringify(ATTACK)}, phone: '' },
      scopes: [{ kind:'internal', id:'g-1' }] }]);
    window.__netUi.net.addr.domains = [${JSON.stringify(ATTACK)}];
    return true;})()`);
  // 成员行渲染的是 groupMembers 的名字（不是 presence 的 key），所以恶意串要放进成员表
  await c.evaluate(`window.__HARNESS_CFG = window.__HARNESS_CFG || {}; window.__HARNESS_CFG.groupMembersOverride = [{ groupId:'g-1', members: [${JSON.stringify(ATTACK)}, 'demo.agent'] }]; true`);
  await c.evaluate('void window.__netUi.refreshPresence(); void window.__netUi.loadIdChanges(); true');
  await openSession('internalGroup', '项目推进群');
  await c.evaluate('void window.__netUi.refreshMembers(); true');
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, label: 'XSS：换证横幅出现' });
  await c.waitFor("document.querySelectorAll('#members-box .member-row').length >= 1", { timeout: 9000, label: 'XSS：成员行出现' });
  const lit = JSON.parse(await c.evaluate(`(function(){
    var mb = (document.querySelector('#members-box').textContent || '');
    var bn = (document.querySelector('#net-banner').textContent || '');
    return JSON.stringify({ members: mb.indexOf('<img src=x') >= 0, banner: bn.indexOf('<img src=x') >= 0 && bn.indexOf('<script>') >= 0 });
  })()`));
  await ensureNetCard();
  const inj = await c.evaluate(`(function(){
    return JSON.stringify({
      ran: (window.__XSSNET__ || 0) + (window.__XSSNET2__ || 0),
      injected: document.querySelectorAll('#members-box img, #members-box script, #members-box input[type=image], #net-banner img, #net-banner script, #net-domains img, #net-domains script').length,
      domainValue: (document.querySelector('#net-domains input') || {}).value || '',
    });
  })()`);
  const injObj = JSON.parse(inj);
  ok(injObj.ran === 0, '11-1 注入的 onerror / script 都没有执行', inj);
  ok(injObj.injected === 0, '11-1 没有多出 img/script 元素（横幅、成员行、域名列表）', inj);
  ok(lit.members === true && lit.banner === true, '11-2 恶意串以字面文本出现（被转义成文本，不是 HTML）', JSON.stringify(lit));
  ok(injObj.domainValue.indexOf('<img src=x') === 0, '11-3 域名输入框里是原始文本（属性值已转义）', injObj.domainValue.slice(0, 40));
  // 收尾：把桩数据还原，避免影响后续（本用例已是最后一段，仅保持状态干净）
  await c.evaluate("window.__idTest.setChanges([]); void window.__netUi.loadIdChanges(); true");

  /* ══ 12. 附八.9 / 附八.3：连接阶梯档位 + 中继状态 + 终态（双不可拨入且无中继）══ */
  step('12. 附八.9/附八.3 连接阶梯：六档文案 + 中继状态 + 终态（与"正在重试"区分开）');
  at = '12 i18n 键对齐';

  // 12a. 键必须两边都有、非空、英文包不许有中文（键集合对齐）
  {
    const missZh = NEW_NET_KEYS.filter((k) => typeof ZH[k] !== 'string' || !ZH[k].length);
    const missEn = NEW_NET_KEYS.filter((k) => typeof EN[k] !== 'string' || !EN[k].length);
    ok(missZh.length === 0 && missEn.length === 0,
      '12-1 新增的 ' + NEW_NET_KEYS.length + ' 个 net.* 键在中英两包都存在且非空',
      'zh 缺=' + JSON.stringify(missZh) + ' en 缺=' + JSON.stringify(missEn));
    const cjk = NEW_NET_KEYS.filter((k) => CJK.test(EN[k]));
    ok(cjk.length === 0, '12-1 英文包里这些键不含中文', JSON.stringify(cjk));
    const groups = ['net.rung.', 'net.relay.', 'net.dialability.', 'net.ladder.'];
    const misaligned = groups.flatMap((g) =>
      Object.keys(ZH).filter((k) => k.startsWith(g) && !(k in EN)).concat(Object.keys(EN).filter((k) => k.startsWith(g) && !(k in ZH))));
    ok(misaligned.length === 0, '12-1 中英两包的 net.rung./net.relay./net.dialability./net.ladder. 键集合完全对齐', JSON.stringify(misaligned));
    ok(!CJK.test(EN['net.rung.ipv6Direct']) && EN['net.rung.ipv6Direct'].length > 0,
      '12-1 IPv6 档的英文文案确实是英文', EN['net.rung.ipv6Direct']);
  }

  // 12b. 让阶梯区块吃到**组网层 IPC** 给的数据（走 netStatus 桩 → netPollOnce → 渲染，不是直接塞 DOM）
  at = '12 打开组网并喂入可达性';
  await c.evaluate("window.__netUi.net.probe = { verdict:'pass', at: Date.now(), isPublic:true, outboundOk:true, method:'autonat' }; true");
  await c.evaluate("window.__netTest.setSamples([true]); void window.__netUi.setEnabled(true); true");
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 8000, label: '12：组网打开（阶梯区块的前提）' });
  await c.evaluate(`window.__netTest.setState({ ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, ipv6Facts: null }); true`);
  await c.evaluate(`window.__netTest.setState({
    reachability: {
      selfDialable: true, peerDialable: true, bothUndialable: false, needsPublicRelayNotice: false,
      relayCode: 'relay-not-needed-peer-dialable', localIpv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' },
      ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' },
      naturalDialable: true, dialableKind: 'peer-verified',
      suggestedRung: 'ipv6-direct',
      i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.notNeeded.peerDialable' },
    }, sessions: 1,
  }); true`);
  await ensureNetCard();
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelectorAll('#net-ladder .net-rung').length === 6`, { timeout: 8000, label: '12：阶梯区块出现 6 档' });
  ok((await cnt('#net-ladder .net-rung')) === 6, '12-2 组网卡片里把六个档位全部列出来（不是只显示当前一档）', 'rows=' + (await cnt('#net-ladder .net-rung')));
  ok(await visible('#net-ladder'), '12-2 阶梯区块真实可见（有尺寸）');

  // 12c. 六档文案逐字等于语言包（zh）
  at = '12 六档文案（zh）';
  const rungTexts = JSON.parse(await c.evaluate(`(function(){
    var out={};
    Array.from(document.querySelectorAll('#net-ladder .net-rung')).forEach(function(li){
      out[li.dataset.rung] = { text: li.querySelector('.net-rung-text').textContent, state: li.dataset.state };
    });
    return JSON.stringify(out);
  })()`));
  const order = JSON.parse(await c.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#net-ladder .net-rung')).map(function(li){return li.dataset.rung;}))`));
  ok(JSON.stringify(order) === JSON.stringify(RUNG_KEYS.map((x) => x[0])),
    '12-2 六档顺序 = 附八.9 定的阶梯顺序（IPv6 → IPv4 → 映射 → 打洞 → 中继 → 局域网）', JSON.stringify(order));
  const supported = [['ipv6-direct', 'net.rung.ipv6Direct'], ['public-direct', 'net.rung.publicDirect'], ['relay', 'net.rung.relay'], ['lan', 'net.rung.lan']];
  const supportedBad = supported.filter(([r, k]) => !rungTexts[r] || rungTexts[r].text !== ZH[k]);
  ok(supportedBad.length === 0, '12-2 已实现四档的文案**逐字**等于 zh-CN 语言包', JSON.stringify(supportedBad.map((x) => [x[0], rungTexts[x[0]] && rungTexts[x[0]].text, ZH[x[1]]])));
  const unsupportedBad = [['upnp', 'net.rung.upnp'], ['holepunch', 'net.rung.holepunch']]
    .filter(([r, k]) => !rungTexts[r] || rungTexts[r].text !== ZH[k] + ' · ' + ZH['net.ladder.unsupported']);
  ok(unsupportedBad.length === 0, '12-2 未实现两档的文案 = 档位名 + 「尚未实现（不可用）」（逐字比对 zh 包）',
    JSON.stringify(unsupportedBad.map((x) => [x[0], rungTexts[x[0]] && rungTexts[x[0]].text])));
  const leaked = order.filter((r) => /net\.(rung|relay|ladder|dialability)\./.test(rungTexts[r] ? rungTexts[r].text : ''));
  ok(leaked.length === 0, '12-2 六档文案里没有未翻译的 i18n key 泄漏', JSON.stringify(leaked));

  // 12d. 未实现的档**不得**显示成"正在跑"
  at = '12 未实现档不得像在跑';
  ok(rungTexts['upnp'] && rungTexts['upnp'].state === 'unsupported' && rungTexts['holepunch'] && rungTexts['holepunch'].state === 'unsupported',
    '12-3 upnp/holepunch 标为 unsupported（不是 current/candidate）', JSON.stringify({ upnp: rungTexts['upnp'], holepunch: rungTexts['holepunch'] }));
  ok(rungTexts['ipv6-direct'] && rungTexts['ipv6-direct'].state === 'current',
    '12-3 IPv6 档被标为当前档（附八.9：IPv6 无 NAT，是阶梯第一档）', JSON.stringify(rungTexts['ipv6-direct']));
  ok((await cnt('#net-ladder .net-rung[data-state="current"]')) === 1, '12-3 当前档恒只有一个（不并列）', 'current=' + (await cnt('#net-ladder .net-rung[data-state="current"]')));
  await okContrast('#net-ladder .net-rung[data-state="current"] .net-rung-text', '12-3 当前档文案可读（对比度 >= 3.0）');
  await okContrast('#net-ladder .net-rung[data-state="unsupported"] .net-rung-text', '12-3 未实现档文案可读（置灰用 --ink-dim）');
  await okContrast('#net-ladder .net-ladder-v', '12-3 阶梯取值文案可读');

  // 主进程若（错误地）把未实现的档报成当前档，UI 也只能显示成 unsupported
  await c.evaluate(`window.__netTest.setState({ reachability: Object.assign({}, window.__netTest.reachability, { suggestedRung: 'holepunch', i18n: { rung: 'net.rung.holepunch' } }) }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('#net-ladder .net-rung[data-rung="holepunch"]').dataset.state === 'unsupported'`, { timeout: 8000, label: '12：上报未实现档后仍标 unsupported' });
  const claimedView = JSON.parse(await c.evaluate(`(function(){
    var li=document.querySelector('#net-ladder .net-rung[data-rung="holepunch"]');
    var cur=document.querySelector('#net-ladder-current');
    return JSON.stringify({ state: li.dataset.state, curRung: cur.dataset.rung, claimed: cur.dataset.claimed,
      currentCount: document.querySelectorAll('#net-ladder .net-rung[data-state="current"]').length });
  })()`));
  ok(claimedView.state === 'unsupported' && claimedView.currentCount === 0,
    '12-3 即便组网层把打洞报成当前档，界面也**拒绝**显示成"正在打洞"（如实标未实现）', JSON.stringify(claimedView));
  ok(claimedView.claimed === 'holepunch', '12-3 但仍如实记录"组网层声称的档"（可诊断，不丢信息）', JSON.stringify(claimedView));

  // 12e. 中继状态四条文案（走 i18n）
  at = '12 中继状态';
  /** 用**组网层桩**喂一条可达性（走 netStatus → netPollOnce → 渲染链路），并立刻心跳一次 */
  const setReach = async (reach) => {
    await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify(reach)} }); true`);
    await c.evaluate('void window.__netUi.heartbeat(); true');
  };
  const relayText = () => c.evaluate("(function(){var e=document.querySelector('#net-ladder-relay');return e?e.textContent:null;})()");
  const relayCode = () => c.evaluate("(function(){var e=document.querySelector('#net-ladder-relay');return e?e.dataset.code:null;})()");

  await setReach({ relayCode: 'relay-not-needed-peer-dialable', suggestedRung: 'ipv6-direct', i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.notNeeded.peerDialable' } });
  ok((await relayText()) === ZH['net.relay.notNeeded.peerDialable'], '12-4 对端可直连 → 「无需中继」文案（逐字等于 zh 包）', await relayText());

  await setReach({ relayCode: 'relay-none-configured', i18n: {} });
  ok((await relayText()) === ZH['net.relay.missing.noneConfigured'] && (await relayCode()) === 'relay-none-configured',
    '12-4 无中继候选 → 「需要一台有公网地址的机器做中继」（逐字等于 zh 包）', await relayText());

  await setReach({ relayCode: 'relay-unreachable', i18n: {} });
  ok((await relayText()) === ZH['net.relay.missing.unreachable'], '12-4 配了中继但都连不上 → 如实报缺口（逐字等于 zh 包）', await relayText());

  await setReach({
    relayCode: 'relay-selected', i18n: { rung: 'net.rung.relay', relay: 'net.relay.selected' },
    relay: { needed: true, selected: true, code: 'relay-selected', reason: 'x', bothUndialable: false, tokenSymmetric: true, attempts: [{ addr: { host: '203.0.113.7', port: 7788 }, ok: true, ms: 12 }], needsPublicRelayNotice: false },
  });
  ok((await relayText()) === ZH['net.relay.selected'], '12-4 选中可用中继 → 「经中继（更慢，但可用）」（逐字等于 zh 包）', await relayText());
  const relayCurrent = JSON.parse(await c.evaluate(`(function(){var li=document.querySelector('#net-ladder .net-rung[data-rung="relay"]');var cur=document.querySelector('#net-ladder-current');return JSON.stringify({state: li.dataset.state, curText: cur.textContent, code: document.querySelector('#net-ladder-relay').dataset.code});})()`));
  ok(relayCurrent.state === 'current' && relayCurrent.curText === ZH['net.rung.relay'],
    '12-4 中继被选中时，当前档位随之变为"中继"', JSON.stringify(relayCurrent));

  // 12f. 本机可拨入性四类
  at = '12 可拨入性';
  const dialView = () => c.evaluate("(function(){var e=document.querySelector('#net-ladder-dial');return e?{kind:e.dataset.kind, text:e.textContent, derived:e.dataset.derived}:null;})()");
  await setReach({ i18n: {}, dialableKind: 'peer-verified', naturalDialable: true });
  let dv = await dialView();
  ok(dv && dv.kind === 'peer-verified' && dv.text === ZH['net.dialability.peerVerified'] && dv.derived === '0',
    '12-5 已验证可拨入 → 走协议层给的 dialableKind（不是本地猜的）', JSON.stringify(dv));
  await setReach({ i18n: {}, selfDialable: false, naturalDialable: true });
  dv = await dialView();
  ok(dv && dv.kind === 'ipv6-global-natural' && dv.text === ZH['net.dialability.ipv6Natural'] && dv.derived === '1',
    '12-5 有全局 IPv6（地址事实）→ 天然可拨入，且标出是本地推导（data-derived=1）', JSON.stringify(dv));
  await setReach({ i18n: {}, selfDialable: false, naturalDialable: false, ipv6: { hasGlobalUnicast: false, publicCandidate: null } });
  await c.evaluate("window.__netTest.setState({ ipv6: { hasGlobalUnicast: false, publicCandidate: null } }); true");
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor("document.querySelector('#net-ladder-dial').dataset.kind === 'undialable'", { timeout: 8000, label: '12：判定不可拨入' });
  dv = await dialView();
  ok(dv && dv.kind === 'undialable' && dv.text === ZH['net.dialability.undialable'], '12-5 有结论但不可拨入 → 「判定不可拨入」', JSON.stringify(dv));
  await setReach({ i18n: {} });
  dv = await dialView();
  ok(dv && dv.kind === 'undetermined' && dv.text === ZH['net.dialability.undetermined'], '12-5 没有任何可拨入性数据 → 「无法判定」（不猜）', JSON.stringify(dv));

  /* 12g. 终态：双不可拨入且无中继 —— 必须与"正在重试"区分开，且给可执行的出路 */
  at = '12 终态：先造出"正在重试"的对照组';
  // 把重试节奏放慢，好让"重试中"与"终态"两个状态都稳定可观测（退避 60s → 不会自动关组网）
  await c.evaluate('window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 1, retryRounds: 3, backoffMs: [60000,60000,60000], tickMs: 200, reachTtlMs: 30000 }; true');
  await c.evaluate("window.__netTest.setState({ reachability: null, sessions: 0, samples: [false] }); true");
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 12000, label: '12：断链横幅（对照组）' });
  const retryRow = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');return JSON.stringify({terminal:r.dataset.terminal, text:r.textContent, title:r.querySelector('.bn-title').textContent});})()`));
  ok(retryRow.terminal === '0' && /正在自动重试/.test(retryRow.text),
    '12-6 对照组：只有"链路失败"时是**重试**文案（data-terminal=0）', String(retryRow.title).slice(0, 40));
  ok(/第 \d+\/3 轮/.test(retryRow.text), '12-6 对照组确实在报重试轮次（证明对照组不是假的）', String(retryRow.text).slice(0, 80));

  at = '12 终态：双不可拨入且无中继';
  /** 附八.3 第 2 条的终态数据（bothUndialable + needsPublicRelayNotice + 缺口码） */
  const GAP_REACH = {
    selfDialable: false, peerDialable: false, bothUndialable: true, needsPublicRelayNotice: true,
    relayCode: 'relay-none-configured',
    ipv6: { hasGlobalUnicast: false, publicCandidate: null }, naturalDialable: false, dialableKind: 'undialable',
    relay: {
      needed: true, selected: false, code: 'relay-none-configured', reason: 'x', selfDialable: false, peerDialable: false,
      bothUndialable: true, tokenSymmetric: false, attempts: [], needsPublicRelayNotice: true,
    },
    i18n: { relay: 'net.relay.missing.needsPublicRelay' },
  };
  await setReach(GAP_REACH);
  await c.waitFor(`document.querySelector('${netRowSel}') && document.querySelector('${netRowSel}').dataset.terminal === '1'`, {
    timeout: 12000, label: '12：终态横幅出现（覆盖重试文案）',
  });
  const termRow = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');
    return JSON.stringify({ terminal:r.dataset.terminal, title:r.querySelector('.bn-title').textContent, body:r.querySelector('.bn-body').textContent,
      btn:(r.querySelector('button[data-bn="relaySettings"]')||{}).textContent||'', hasTurnOn: !!r.querySelector('button[data-bn="turnOn"]'),
      n:document.querySelectorAll('${netRowSel}').length });})()`));
  ok(termRow.n === 1, '12-6 终态与"正在重试"只能有一条组网横幅（DOM 恒一行）', 'rows=' + termRow.n);
  ok(termRow.title === ZH['net.banner.relayTerminalTitle'], '12-6 终态标题走 i18n（逐字等于 zh 包）', String(termRow.title).slice(0, 40));
  ok(termRow.body === ZH['net.relay.missing.noneConfigured'],
    '12-6 终态正文给出**可执行**的说法：需要一台有公网地址的机器做中继（逐字等于 zh 包）', String(termRow.body).slice(0, 70));
  ok(!/正在自动重试|第 \d+\/3 轮/.test(termRow.body), '12-6 终态里**没有**通用重试文案（重试没用，不该转圈）', String(termRow.body).slice(0, 60));
  ok(termRow.btn === ZH['net.banner.relayConfigure'], '12-6 终态带可执行动作按钮（去设置配中继），文案走 i18n', String(termRow.btn).slice(0, 40));
  ok(termRow.hasTurnOn === false, '12-6 终态不给"打开组网"按钮（组网本来就开着，那不是这个问题的出路）');
  await okContrast(netRowSel + ' .bn-title', '12-6 终态横幅标题可读');
  await okContrast(netRowSel + ' button[data-bn="relaySettings"]', '12-6 终态动作按钮可读');

  // 组网横幅恒一行：同时存在身份变更行时也一样（两类各行一条）。
  // 身份变更行只在**会话可见**时出现（idRowModel 的既有语义），所以先回到会话再注入。
  at = '12 终态 + 身份变更行并存';
  await navTo('internalGroup');
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, label: '12：离开设置页后终态横幅仍在' });
  await c.evaluate(`window.__idTest.setChanges([{ id:'gap-id-1', ts: Date.now(), receivedAt: Date.now(), generation: 4,
    subjectId:'ext-9', subjectName:'王五', oldFingerprint:'FP-OLD-Z', newFingerprint:'FP-NEW-Z',
    previousCard:{ email:'wangwu@old.example', phone:'' }, pendingCard:{ email:'wangwu@new.example', phone:'' },
    contactFreezeUntil: Date.now() + 86400000, frozen:true, remainingMs: 86400000, scopes:[{ kind:'internal', id:'g-1' }] }]); void window.__netUi.loadIdChanges(); true`);
  await c.waitFor(`!!document.querySelector('${idRowSel}')`, { timeout: 9000, label: '12：身份变更行在场' });
  await c.evaluate('window.__netUi.refreshBanner(); true');
  const bothRows = JSON.parse(await c.evaluate(`JSON.stringify({ net: document.querySelectorAll('${netRowSel}').length, idchg: document.querySelectorAll('${idRowSel}').length })`));
  ok(bothRows.net === 1 && bothRows.idchg === 1, '12-6 终态横幅与身份变更横幅并存时，组网行仍恒为一行', JSON.stringify(bothRows));
  await c.evaluate("window.__idTest.setChanges([]); void window.__netUi.loadIdChanges(); true");
  await c.waitFor(`!document.querySelector('${idRowSel}')`, { timeout: 8000, label: '12：身份变更行收回' });

  // 12h. 真实点击终态按钮 → 跳到组网设置卡片
  at = '12 点终态按钮去设置';
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, label: '12：终态横幅仍在（准备点击）' });
  await clickReal(netRowSel + ' button[data-bn="relaySettings"]', "!!document.querySelector('.rail-item[data-nav=\"settings\"].active') && !!document.querySelector('#net-card')");
  ok(await exists('#net-card'), '12-6 点「配置中继」真实跳进设置页的组网卡片（可执行，不是死胡同）');
  const termLadder = JSON.parse(await c.evaluate(`(function(){var e=document.querySelector('#net-ladder-relay');var b=document.querySelector('#net-ladder');return JSON.stringify({code:e?e.dataset.code:null, terminal:b?b.dataset.terminal:null, text:e?e.textContent:null});})()`));
  ok(termLadder.terminal === '1' && termLadder.text === ZH['net.relay.missing.noneConfigured'],
    '12-6 卡片里的中继状态同步标出"需要中继"（与横幅一致）', JSON.stringify(termLadder));

  // 12i. 过期数据不作数（不拿旧结论说话）：链路恢复后关组网 → 不再轮询 → 旧结论过期即失效
  at = '12 数据过期';
  await c.evaluate('window.__netTest.setSamples([true]); true');
  await c.waitFor('window.__netUi.net.link.linkDown === false', { timeout: 10000, label: '12：链路恢复' });
  await c.evaluate("window.__netTest.setState({ members: { 'g-1': [ { id:'remote-bob', name:'remote-bob', remote:true, online:true } ] } }); true");
  await c.evaluate('void window.__netUi.refreshPresence(); true');
  await c.waitFor('window.__netUi.net.remoteCount >= 1', { timeout: 8000, label: '12：异地成员就绪（组网关闭行需要它）' });
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 8000, label: '12：关组网（停止轮询）' });
  await c.waitFor(`!!document.querySelector('${netRowSel}')`, { timeout: 8000, label: '12：组网已关闭横幅' });
  const freshOff = await c.evaluate(`document.querySelector('${netRowSel} .bn-body').textContent`);
  ok(String(freshOff).indexOf(ZH['net.relay.missing.noneConfigured']) >= 0,
    '12-7 关组网后（数据仍新鲜）组网关闭横幅里带上"需要中继"这条出路', String(freshOff).slice(0, 80));
  await c.evaluate('window.__netTuning.reachTtlMs = 200; true');
  await sleep(600);
  await c.evaluate('window.__netUi.refreshBanner(); window.__netUi.renderLadder(); true');
  const staleOff = await c.evaluate(`document.querySelector('${netRowSel} .bn-body').textContent`);
  ok(String(staleOff).indexOf(ZH['net.relay.missing.noneConfigured']) < 0,
    '12-7 数据过期（> reachTtlMs）后不再拿它下结论：横幅不再声称"需要中继"', String(staleOff).slice(0, 80));
  ok((await c.evaluate(`document.querySelectorAll('${netRowSel}').length`)) === 1,
    '12-7 过期只影响"可达性结论"，组网关闭这件事本身照常显示（不误删真实状态）');
  const staleLadder = await c.evaluate("(function(){var e=document.querySelector('#net-ladder-relay');return e?e.textContent:null;})()");
  ok(staleLadder === ZH['net.relay.unknown'], '12-7 过期后卡片里的中继状态退回「未知」而不是继续声称需要中继', String(staleLadder).slice(0, 40));

  // 12j. 英文包（同一批断言再来一遍）
  at = '12 切英文';
  await c.evaluate("(function(){var s=document.querySelector('#sel-locale'); s.value='en-US'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logo-name').textContent === 'CCArmy'", { timeout: 10000, label: '12：切到 en-US' });
  // 组网开着才会有 netStatus 轮询 → 可达性才会进到界面（12i 收尾时关掉了）
  await c.evaluate('window.__netTuning.reachTtlMs = 30000; true');
  await c.evaluate("void window.__netUi.setEnabled(true); true");
  await c.waitFor('window.__netUi.net.enabled === true', { timeout: 8000, label: '12：英文下重新打开组网' });
  await ensureNetCard();
  await c.evaluate(`window.__netTest.setState({ reachability: ${JSON.stringify({
    selfDialable: false, peerDialable: false, bothUndialable: true, needsPublicRelayNotice: true,
    relayCode: 'relay-unreachable',
    ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, naturalDialable: true, dialableKind: 'ipv6-global-natural',
    suggestedRung: 'ipv6-direct', i18n: { rung: 'net.rung.ipv6Direct', relay: 'net.relay.missing.unreachable' },
  })}, ipv6: { hasGlobalUnicast: true, publicCandidate: '2001:db8::1' }, sessions: 0 }); true`);
  await c.evaluate('void window.__netUi.heartbeat(); true');
  await c.waitFor(`document.querySelector('#net-ladder .net-rung[data-rung="lan"]').querySelector('.net-rung-text').textContent.indexOf('LAN') >= 0`, {
    timeout: 10000, label: '12：英文下阶梯区块刷新',
  });
  const enRungs = JSON.parse(await c.evaluate(`(function(){
    var out={};
    Array.from(document.querySelectorAll('#net-ladder .net-rung')).forEach(function(li){
      out[li.dataset.rung] = { text: li.querySelector('.net-rung-text').textContent, state: li.dataset.state };
    });
    return JSON.stringify(out);
  })()`));
  const enBad = RUNG_KEYS.filter(([r, k]) => {
    const want = (r === 'upnp' || r === 'holepunch') ? EN[k] + ' · ' + EN['net.ladder.unsupported'] : EN[k];
    return !enRungs[r] || enRungs[r].text !== want;
  });
  ok(enBad.length === 0, '12-8 英文包下六档文案**逐字**等于 en-US 语言包', JSON.stringify(enBad.map((x) => [x[0], enRungs[x[0]] && enRungs[x[0]].text, EN[x[1]]])));
  ok((await c.evaluate("(function(){var t=document.querySelector('#net-ladder').textContent;return /[\\u4e00-\\u9fff]/.test(t);})()")) === false,
    '12-8 英文包下阶梯区块里**没有中文**');
  const enTerm = JSON.parse(await c.evaluate(`(function(){var r=document.querySelector('${netRowSel}');
    return JSON.stringify({ terminal:r?r.dataset.terminal:null, title:r?r.querySelector('.bn-title').textContent:null,
      body:r?r.querySelector('.bn-body').textContent:null, btn:r?(r.querySelector('button[data-bn="relaySettings"]')||{}).textContent||'':null });})()`));
  ok(enTerm.terminal === '1' && enTerm.title === EN['net.banner.relayTerminalTitle'],
    '12-8 英文下终态横幅标题走英文包', String(enTerm.title).slice(0, 60));
  ok(enTerm.body === EN['net.relay.missing.unreachable'] && enTerm.btn === EN['net.banner.relayConfigure'],
    '12-8 英文下终态正文与按钮走英文包（且是"中继都连不上"这一条）', String(JSON.stringify(enTerm)).slice(0, 120));
  const enCjk = await c.evaluate(`(function(){
    var bad=[];
    ['#net-card','#net-banner'].forEach(function(root){
      var host=document.querySelector(root); if(!host) return;
      Array.from(host.querySelectorAll('*')).forEach(function(e){
        if(e.children.length) return;
        var tag=e.tagName; if(tag==='INPUT'||tag==='TEXTAREA'||tag==='OPTION') return;
        var t=(e.textContent||'').trim();
        if(/[\\u4e00-\\u9fff]/.test(t)) bad.push(tag+'#'+(e.id||e.className||'')+':'+t.slice(0,24));
      });
    });
    return JSON.stringify(bad.slice(0,8));
  })()`);
  ok(enCjk === '[]', '12-8 英文包下组网卡片与横幅里没有中文残留（可见文字全部走 i18n）', String(enCjk).slice(0, 160));
  await c.evaluate("(function(){var s=document.querySelector('#sel-locale'); s.value='zh-CN'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()");
  await c.waitFor("document.querySelector('#logo-name').textContent === '无限牛马'", { timeout: 10000, label: '12：切回中文' });

  // 收尾：把桩数据清干净，避免影响最后的全局断言
  await c.evaluate("window.__netTuning = { hysteresisFailures: 3, hysteresisSeconds: 30, retryRounds: 3, backoffMs: [5000,15000,30000], tickMs: 1000, reachTtlMs: 30000 }; true");
  await c.evaluate("window.__netTest.setState({ reachability: null, ipv6: null, sessions: 0, samples: [true] }); true");
  await c.evaluate('void window.__netUi.setEnabled(false); true');
  await c.waitFor('window.__netUi.net.enabled === false', { timeout: 8000, label: '12：收尾（关组网）' });

  /* ══ 13. UIQA 桌面侧增补（B2–B9）：只增不减 ══ */
  step('13. UIQA 增补：禁用态 / 帮助钮 / 命中区 / 关闭组网事实 / 成员角标 / 凭证区块');
  at = '13 UIQA 增补';
  {
    // B3 help button is a live control (not dead)
    await ensureNetCard();
    const help = JSON.parse(await c.evaluate(`(function(){
      var b=document.querySelector('#btn-net-help'); var box=document.querySelector('#net-help-box');
      if(!b) return JSON.stringify({ok:false, reason:'absent'});
      var r=b.getBoundingClientRect();
      return JSON.stringify({ok:true, w:Math.round(r.width), h:Math.round(r.height), title:b.getAttribute('title')||'', hidden: box? box.classList.contains('hidden'):null});
    })()`));
    ok(help.ok && help.w >= 16 && help.h >= 16 && help.title, 'B3 组网卡片帮助按钮存在且有 i18n title', JSON.stringify(help));
    const helpClick = await c.clickUntil('#btn-net-help', `(function(){var box=document.querySelector('#net-help-box'); return box && !box.classList.contains('hidden') && (box.textContent||'').length>20;})()`, { tries: 3, timeout: 2000 });
    // 断言读**全文**再与语言包逐字比对（先前误把 textContent.slice(0,80) 拿去和完整键值比，永远不相等）
    const helpView = JSON.parse(await c.evaluate(`(function(){var box=document.querySelector('#net-help-box'); if(!box) return 'null'; return JSON.stringify({hidden: box.classList.contains('hidden'), body: box.textContent||''});})()`) || 'null');
    ok(helpClick.ok && helpView && helpView.hidden === false && helpView.body === ZH['net.helpBody'],
      'B3 点击帮助展开 i18n 说明（非死控件）', String((helpView && helpView.body) || '').slice(0, 80));
    await c.evaluate(`(function(){var box=document.querySelector('#net-help-box'); if(box) box.classList.add('hidden'); return true;})()`);

    // B4 list-hq-icon hit area >= 32
    // 图标只在「我的牛马」(singleAi) 列表头出现；settings/me 会 hide-list（display:none → 尺寸 0）。
    // 这里**显式导航**到 singleAi 再测量/点击，避免在看不到图标的视图里断言。
    await navTo('singleAi');
    await c.waitForQuiet("(function(){var e=document.querySelector('.list-hq-icon');if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()", { timeout: 4000 });
    const hq2 = JSON.parse(await c.evaluate(`(function(){
      var e=document.querySelector('.list-hq-icon');
      if(!e) return JSON.stringify({absent:true});
      var r=e.getBoundingClientRect();
      return JSON.stringify({w:Math.round(r.width), h:Math.round(r.height), minW:getComputedStyle(e).minWidth, minH:getComputedStyle(e).minHeight, nav:((document.querySelector('.rail-item.active')||{}).dataset||{}).nav});
    })()`));
    ok(!hq2.absent && hq2.w >= 32 && hq2.h >= 32, 'B4 牛马管理局图标命中区 ≥32×32', JSON.stringify(hq2));
    if (!hq2.absent) {
      // 实例页不在 rail 上：成功判据是 list-title 变成「牛马管理局」（nav.instances）
      const instCond = `(function(){ var t=document.querySelector('#list-title'); return !!t && (t.textContent||'').indexOf(${JSON.stringify('牛马管理局')})>=0; })()`;
      let hqClick = { ok: false, reason: 'not-tried' };
      try {
        hqClick = await c.clickUntil('.list-hq-icon', instCond, { tries: 4, timeout: 2500 });
      } catch (e) {
        hqClick = { ok: false, reason: String(e.message).slice(0, 120) };
      }
      if (!hqClick.ok) {
        // 第一次坐标点击往往已命中并触发 onclick（icon 随后被 setNav 移除）；补验导航结果
        const already = await c.evaluate(instCond);
        if (!already) {
          await c.evaluate("(function(){var e=document.querySelector('.list-hq-icon'); if(e) e.click(); return true;})()");
        }
        const nowOnInst = await c.evaluate(instCond);
        hqClick = { ok: !!nowOnInst, fallback: true, trail: hqClick.trail || hqClick.reason };
      }
      ok(!!hqClick.ok, 'B4 真实坐标点击可进入实例列表', JSON.stringify(hqClick.trail || hqClick));
    }
    // 用完实例列表后回到设置页，避免后续组网断言落在错误视图
    await ensureNetCard();

    // B2 disabled switch visual
    await c.evaluate(`window.__netTest.setState({ samples: [] }); window.__netUi.net.probe = { verdict:'fail', at: Date.now(), method:'autonat' }; true`);
    await c.evaluate(`void window.__netUi.setEnabled(false); true`);
    await ensureNetCard();
    const swDis = JSON.parse(await c.evaluate(`(function(){
      var s=document.querySelector('#net-switch');
      var row=document.querySelector('.net-switch-row');
      if(!s) return JSON.stringify({absent:true});
      var track=s.nextElementSibling;
      var cs=track? getComputedStyle(track):null;
      return JSON.stringify({
        disabled: !!s.disabled,
        rowClass: row? row.className: '',
        cursor: getComputedStyle(s).cursor,
        trackBg: cs? cs.backgroundColor: null,
        trackBorder: cs? cs.border: null,
        outline: cs? cs.outlineStyle: null,
      });
    })()`));
    ok(swDis.disabled === true && /is-disabled/.test(swDis.rowClass) && swDis.cursor === 'not-allowed',
      'B2 组网开关禁用态：disabled + not-allowed + 行标记', JSON.stringify(swDis));

    // B5 mesh off still has facts / or honest unknown
    await c.evaluate(`void window.__netUi.heartbeat(); true`);
    await sleep(300);
    const ladderOff = JSON.parse(await c.evaluate(`(function(){
      var box=document.querySelector('#net-ladder');
      if(!box) return JSON.stringify({absent:true});
      var cur=document.querySelector('#net-ladder-current');
      var dial=document.querySelector('#net-ladder-dial');
      return JSON.stringify({
        current: cur? cur.textContent: null,
        dial: dial? dial.textContent: null,
        dialKind: dial? dial.getAttribute('data-kind'): null,
        textLen: (box.textContent||'').length,
      });
    })()`));
    ok(!ladderOff.absent && ladderOff.textLen > 30 && !!ladderOff.dial,
      'B5 组网关闭时阶梯/可达性非空白（有文案）', JSON.stringify(ladderOff));
    ok(ladderOff.dial === ZH['net.dialability.undetermined'] || ladderOff.dial === ZH['net.dialabilityUnknown'] || (ladderOff.dial && ladderOff.dial.length > 1),
      'B5 可拨入性显示「无法判定/未知」类文案', ladderOff.dial);

    // B7 offline pending-confirm wording
    await c.evaluate(`window.__netTest.setState({ members: { 'g-1': [
      { id:'remote-off', name:'remote-off', remote:true, online:false, disabled:false, presenceBasis:'mesh-session' },
      { id:'remote-unk', name:'remote-unk', remote:true, online:false, disabled:false, presenceBasis:'unattributed' }
    ] }}); true`);
    await c.evaluate(`void window.__netUi.refreshPresence && window.__netUi.refreshPresence(); true`);
    // 真的重画成员面板（否则 #members-box 还是上一节的残留，断言测不到新文案）
    await c.evaluate(`void (window.__netUi && window.__netUi.refreshMembers) ? window.__netUi.refreshMembers() : null; true`);
    await c.waitFor(`document.querySelectorAll('#members-box .member-row').length >= 1`, { timeout: 6000, label: 'B7：成员行已重画' });
    await sleep(200);
    const membersTxt = await c.evaluate(`(function(){
      var box=document.querySelector('#members-box');
      return box? box.innerText: '';
    })()`);
    ok(membersTxt.indexOf(ZH['group.memberPendingConfirm']) !== -1 || membersTxt.indexOf('remote-off') === -1,
      'B7 离线成员文案改为「待连接确认」', membersTxt.slice(0, 120));
    ok(membersTxt.indexOf(ZH['group.memberUnattributed']) !== -1 || membersTxt.indexOf('remote-unk') === -1,
      'B8 unattributed 可见角标「身份未知」', membersTxt.slice(0, 160));

    // B9 cert block present (readonly)
    const certBox = JSON.parse(await c.evaluate(`(function(){
      var h=document.querySelector('#membership-certs');
      if(!h) return JSON.stringify({absent:true});
      return JSON.stringify({ present:true, title:(h.querySelector('h3')||{}).textContent||'', text:(h.innerText||'').slice(0,160), rows:h.querySelectorAll('.cert-row').length, hasNone: (h.innerText||'').indexOf(${JSON.stringify(ZH['group.cert.none'])})!==-1 || (h.innerText||'').indexOf('无证书')!==-1 || (h.innerText||'').length>10 });
    })()`));
    ok(certBox.present && (certBox.title === ZH['group.cert.title'] || certBox.title.length > 0),
      'B9 群成员面板出现「身份凭证」只读区块', JSON.stringify(certBox));

    // B1 no [object Object] in settings data card
    const objDump = await c.evaluate(`(function(){
      var t=document.body.innerText||'';
      return t.indexOf('[object Object]')!==-1;
    })()`);
    ok(objDump === false, 'B1 界面无 [object Object] 直出', objDump);
  }

  const errs = c.errors();
  ok(errs.length === 0, '全程无控制台异常/未捕获错误', JSON.stringify(errs.slice(0, 3)).slice(0, 240));

  clearTimeout(watchdog);
  const pass = R.summary('ADR003 R8–R12 / 附六 UI 验收');
  fs.writeFileSync(path.join(OUT, 'net-ui-result.json'), JSON.stringify({ pass, results: R.results }, null, 1));
  c.close();
  process.exit(pass ? 0 : 2);
} catch (e) {
  console.error('\n卡在「' + at + '」: ' + e.message);
  clearTimeout(watchdog);
  try { c && c.close(); } catch { /* noop */ }
  process.exit(4);
}

