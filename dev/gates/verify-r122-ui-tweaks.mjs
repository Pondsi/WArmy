/**
 * R122 UI 门禁：dsh 检测 / 名片弹窗 / 最终回复斑马头位置 / 中间回复样式与操作条
 * 真 Electron + CDP（隔离 profile，不碰真实用户数据）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = path.join(ROOT, 'packages/app-shell');
const ELECTRON = path.join(PKG, 'node_modules/electron/dist/electron.exe');
const MAIN = path.join(PKG, 'dist/electron-main.js');
const { attach, sleep } = await import(pathToFileURL(path.join(PKG, 'scripts/cdp-lib.mjs')).href);

let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) { ok += 1; console.log('  ok ', name); }
  else { fails.push(name); console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)); }
}

let child = null;
let c = null;
let profile = '';

async function start(port) {
  const env = { ...process.env, WARMY_AUTH_BYPASS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(ELECTRON, ['--remote-debugging-port=' + port, '--user-data-dir=' + profile, MAIN], {
    cwd: PKG, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, env,
  });
  let last = '';
  for (let i = 0; i < 100; i += 1) {
    try { c = await attach(port, { biaoQian: 'r122-ui', callTimeout: 20000 }); break; } catch (e) { last = e.message; await sleep(300); }
  }
  if (!c) throw new Error('CDP 未连接：' + last);
  await c.send('Runtime.enable');
}
async function stop() {
  try { if (c) await c.send('Browser.close', {}, { timeout: 5000 }); } catch { /* noop */ }
  c = null;
  await sleep(700);
  try { if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
  child = null;
}
const js = (e) => c.evaluate('(async function(){ try { return await (' + e + '); } catch (err) { return { __err: String((err && (err.stack || err.message)) || err).slice(0, 500) }; } })()');

try {
  profile = path.join(os.tmpdir(), 'warmy-r122-ui-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    yuYan: 'zh-CN', setupDone: true, privacyConsent: true, guideDone: true, guideChatDone: true, providersSeeded: true,
    providers: [], instances: [{ id: 'inst-r122', ming: '验收牛马', name: '验收牛马', status: 'running', model: 'x', chain: ['x'], chainDisabled: [] }],
    authGrants: { 'inst-r122': [] }, panelCardCollapsed: {},
  }, null, 2), 'utf8');
  await start(Number(process.env.R122_UI_PORT || 12230));
  await c.waitFor('window.__warmyBootDataReady === true', { timeout: 30000 });
  await c.waitFor('!!document.querySelector("[data-nav=singleAi]")', { timeout: 30000 });
  await sleep(600);

  // dsh：开发态必须能从项目里检测到（打包态另由 packaged 目录断言）
  const dsh = await js('window.warmy.dshStatus()');
  jian('dsh 状态：项目自带运行时能被检测到', dsh && dsh.ok === true, dsh);

  // 打开一个会话，注入“有中间回复/思考”的最终回复 + “纯最终回复”
  await c.evaluate('document.querySelector(\'[data-nav="singleAi"]\')?.click()');
  await sleep(400);
  await c.evaluate('document.querySelector("#lieBiaoTi .lieBiaoTiaoMu")?.click()');
  await sleep(600);
  const seeded = await js(`(() => {
    const sid = window.__r35?.huiHua?.() || '';
    if (!sid) return false;
    const now = Date.now();
    window.__msgs = window.__msgs || {};
    window.__msgs[sid] = [
      { role: 'them', text: '最终回复 A', ts: now - 5000, moXing: '验收模型',
        reasoning: '先想一想', reasoningDuan: [{ ts: now - 6000, text: '先想一想', moXing: '验收模型' }],
        zhongJian: [{ ts: now - 5500, text: '中间回复内容', moXing: '验收模型' }] },
      { role: 'them', text: '纯最终回复 B', ts: now, moXing: '验收模型' },
    ];
    window.__r35.chongHuaQuan?.();
    return true;
  })()`);
  jian('注入两条回复成功', seeded === true, seeded);
  await sleep(800);

  const dom = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const all = (s) => [...document.querySelectorAll(s)];
    const card = q('.zhongJianKa');
    const bubble = q('.bubble');
    const ctl = q('.zhongJianKa .guoChengCaoZuo');
    const cr = card ? card.getBoundingClientRect() : null;
    const tr = ctl ? ctl.getBoundingClientRect() : null;
    const cs = card ? getComputedStyle(card) : null;
    const bs = bubble ? getComputedStyle(bubble) : null;
    const xs = all('#xiaoXiJi .xiaoXi');
    const pure = xs.find((x) => (x.textContent || '').includes('纯最终回复 B'));
    const rich = xs.find((x) => (x.textContent || '').includes('最终回复 A'));
    const richHead = rich ? rich.querySelector('.zuiZhongHang > .banMaTou') : null;
    const richFirst = rich ? rich.querySelector('.zuiZhongHang')?.firstElementChild : null;
    return {
      hasCard: !!card, hasCtl: !!ctl,
      img: cs && cs.backgroundImage, shadow: cs && cs.boxShadow,
      cardBg: cs && cs.backgroundColor, bubbleBg: bs && bs.backgroundColor,
      just: ctl ? getComputedStyle(ctl).justifyContent : '',
      ctlLeft: tr && cr ? Math.round(tr.left - cr.left) : null,
      richHas: !!richHead, richFirstClass: richFirst ? String(richFirst.className) : '',
      pureHasZebra: pure ? !!pure.querySelector('.banMaTou') : null,
    };
  })()`);
  jian('中间回复存在', dom.hasCard === true, dom);
  jian('中间回复没有浮雕/渐变（无 inset 阴影、无渐变背景）', !!(dom.img === 'none' && !/inset/.test(String(dom.shadow))), { img: dom.img, shadow: dom.shadow });
  jian('中间回复背景与最终回复一致', !!(dom.cardBg === dom.bubbleBg), { card: dom.cardBg, bubble: dom.bubbleBg });
  jian('悬停操作条在左下角（flex-start 且贴近左侧）', dom.hasCtl && dom.just === 'flex-start' && dom.ctlLeft != null && dom.ctlLeft >= 0 && dom.ctlLeft <= 20, { just: dom.just, left: dom.ctlLeft });
  jian('有过程的最终回复：斑马头在左侧第一个', dom.richHas === true && /banMaTou/.test(dom.richFirstClass), { has: dom.richHas, first: dom.richFirstClass });
  jian('纯最终回复：不显示斑马头（不挡牛马头像）', dom.pureHasZebra === false, { pureHasZebra: dom.pureHasZebra });

  /* ── 第 122 轮 19/20/21/22：整理光标、语音替换选区、空内容静默、整理特效 ── */
  const appSrc = fs.readFileSync(path.join(PKG, 'src/renderer/app.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(PKG, 'src/renderer/app.css'), 'utf8');
  const kongSrc = (appSrc.match(/function yuYinKongJieGuo[\s\S]*?\n  \}/) || [''])[0];

  jian('整理时不再出现等待光标（CSS 无 cursor: progress）', !/cursor:\s*progress/.test(cssSrc));
  jian('整理光标按主题色生成魔法星芒 data URI，结束后移除', /zhengLiMoFaGuangBiao/.test(appSrc)
    && /data:image\/svg\+xml/.test(appSrc) && /style\.removeProperty\('cursor'\)/.test(appSrc));
  jian('语音有选区时替换选区（不是插在选区前面）', /const hasSel = /.test(appSrc)
    && /hasSel\s*\?\s*selB/.test(appSrc) && /hasSel\s*\?\s*selA/.test(appSrc));
  jian('没有新内容不弹提示（删掉 quiet 提示 + 空结果静默）', !/tOr\('chat\.voiceTooQuiet'/.test(appSrc)
    && /yuYinKongJieGuo\(asrY\?\.error\)/.test(appSrc));
  jian('整理完成有逐字归位与整层淡出', /function zhengLiTeXiaoShouWei/.test(appSrc)
    && /zhengLiCongLai/.test(appSrc) && /zhengLiShou/.test(cssSrc));

  const kong = await js(`(() => {
    const src = ${JSON.stringify(kongSrc)};
    if (!src) return { missing: true };
    const fn = new Function(src + '; return yuYinKongJieGuo;')();
    return {
      silentAudio: fn('audio-silent（音频中没有有效声音）'),
      empty: fn('asr-empty-result'),
      noSpeech: fn('no-speech（端点报告无有效语音）'),
      http: fn('asr HTTP 500'),
      noKey: fn('no-key'),
    };
  })()`);
  jian('空内容/静音错误判定为静默，配置/网络错误仍提示', kong.silentAudio === true && kong.empty === true
    && kong.noSpeech === true && kong.http === false && kong.noKey === false, kong);

  const org = await js(`(() => {
    const ru = document.querySelector('#shuRu');
    if (!ru) return { missing: true };
    ru.value = '这是一段正在整理的文字，魔法会让字重新组合排列。';
    ru.dispatchEvent(new Event('input'));
    window.__zhengLiTeXiao.zhuangTai(true);
    window.__zhengLiTeXiao.kai(ru.value);
    const layer = document.querySelector('.zhengLiTeXiao');
    const zis = [...document.querySelectorAll('.zhengLiZi')];
    const plain = zis.find((x) => !x.classList.contains('isLiang'));
    const liang = zis.find((x) => x.classList.contains('isLiang'));
    const tmp = document.createElement('span');
    tmp.style.color = 'var(--ink)';
    document.body.appendChild(tmp);
    const ink = getComputedStyle(tmp).color;
    tmp.remove();
    const cvs = layer?.querySelector('canvas');
    let lit = -1;
    if (cvs) {
      const d = cvs.getContext('2d')?.getImageData(0, 0, cvs.width, cvs.height).data;
      if (d) { lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) lit += 1; }
    }
    return {
      layer: !!layer, count: zis.length,
      ink,
      baseColor: plain ? getComputedStyle(plain).color : '',
      liangShadow: liang ? getComputedStyle(liang).textShadow : '',
      liangStar: liang ? getComputedStyle(liang, '::after').content : '',
      cursor: getComputedStyle(ru).cursor,
      readOnly: ru.readOnly === true,
      canvasLit: lit,
    };
  })()`);
  jian('整理特效层与逐字节点真实挂上', !org.missing && org.layer === true && org.count > 10, org);
  jian('字保持字体本色（不是整体主题色）', !org.missing && org.baseColor === org.ink, { base: org.baseColor, ink: org.ink });
  jian('部分字变主题色并发光，且带星芒', !org.missing && !!org.liangShadow && org.liangShadow !== 'none'
    && /✦/.test(String(org.liangStar)), { shadow: org.liangShadow, star: org.liangStar });
  jian('整理光标是主题色魔法星芒（不是 progress）', !org.missing && /data:image\/svg\+xml/.test(String(org.cursor))
    && !/progress/.test(String(org.cursor)), org.cursor);
  jian('星星点点真实画在 canvas 上', !org.missing && org.canvasLit > 0, { px: org.canvasLit });

  await sleep(420);
  const pai = await js(`(() => {
    const p = document.querySelector('.zhengLiZi.isPaiLie');
    return { count: document.querySelectorAll('.zhengLiZi.isPaiLie').length, tf: p ? getComputedStyle(p).transform : '' };
  })()`);
  jian('字在重新组合排列（有字正在挪动/旋转）', pai.count > 0 && !!pai.tf && pai.tf !== 'none', pai);

  const shou = await js(`(async () => {
    const ru = document.querySelector('#shuRu');
    ru.value = '整理后的新文字';
    ru.dispatchEvent(new Event('input'));
    const p = window.__zhengLiTeXiao.shouWei();
    const cong = [...document.querySelectorAll('.zhengLiZi')].filter((x) => x.classList.contains('zhengLiCongLai')).length;
    const before = !!document.querySelector('.zhengLiTeXiao');
    await p;
    const out = {
      cong, before,
      after: !!document.querySelector('.zhengLiTeXiao'),
      readOnly: ru.readOnly === true,
      aria: ru.getAttribute('aria-readonly'),
      value: ru.value,
      cursor: getComputedStyle(ru).cursor,
    };
    window.__zhengLiTeXiao.zhuangTai(false);
    return out;
  })()`);
  jian('整理完成：新字逐字归位后特效层消失', shou.before === true && shou.cong === '整理后的新文字'.length
    && shou.after === false && shou.readOnly === false && shou.aria === null, shou);
  jian('整理完成后保留整理结果、光标恢复普通样式', shou.value === '整理后的新文字'
    && !/data:image/.test(String(shou.cursor)), shou);

  const shouCancel = await js(`(async () => {
    const ru = document.querySelector('#shuRu');
    ru.value = '归位取消测试';
    ru.dispatchEvent(new Event('input'));
    window.__zhengLiTeXiao.kai(ru.value);
    const p = window.__zhengLiTeXiao.shouWei();
    window.__zhengLiTeXiao.guan();
    const started = Date.now();
    await p;
    return { ms: Date.now() - started, layer: !!document.querySelector('.zhengLiTeXiao'), readOnly: ru.readOnly === true };
  })()`);
  jian('收尾动画中取消：等待立即解除，不把发送按钮永久锁死', shouCancel.ms < 1000
    && shouCancel.layer === false && shouCancel.readOnly === false, shouCancel);

  const sel = await js(`(() => {
    const ru = document.querySelector('#shuRu');
    ru.value = '甲乙丙丁';
    ru.focus();
    ru.setSelectionRange(1, 3);
    const zt = { chaRuStart: 1, chaRuEnd: 3, yiChaRu: '', yiDing: '', lastAsr: '' };
    window.__yuYinChaRuJieGuo(ru, zt, '语音');
    const v1 = ru.value;
    window.__yuYinChaRuJieGuo(ru, zt, '语音识别');
    return { v1, v2: ru.value };
  })()`);
  jian('框选文字后语音替换选区', sel.v1 === '甲语音丁', sel);
  jian('同一段继续识别仍只替换自己插入的片段', sel.v2 === '甲语音识别丁', sel);

  // 我的页名片弹窗：点真实入口，检查没有横向/嵌套滚动条，内容不被截断
  await c.evaluate('document.querySelector(\'[data-nav="wo"]\')?.click()');
  await sleep(700);
  const cardBtn = await js('!!document.querySelector("#pMingPianBtn")');
  jian('我的页名片入口存在', cardBtn === true);
  if (cardBtn) {
    await c.evaluate('document.querySelector("#pMingPianBtn").click()');
    await sleep(700);
    const cm = await js(`(() => {
      const ti = document.querySelector('#duiHuaKuangTi');
      const body = document.querySelector('.woCardBody');
      const prov = document.querySelector('.woCardProvList');
      const ka = document.querySelector('#duiHuaKuangGen .duiHuaKuangKa');
      if (!ti || !body) return { missing: true };
      return {
        tiScrollW: ti.scrollWidth, tiClientW: ti.clientWidth,
        tiScrollH: ti.scrollHeight, tiClientH: ti.clientHeight,
        provOverflowY: prov ? getComputedStyle(prov).overflowY : '',
        bodyMinW: getComputedStyle(body).minWidth,
        kaW: Math.round(ka.getBoundingClientRect().width),
        vw: window.innerWidth,
      };
    })()`);
    jian('名片弹窗无横向滚动条', !cm.missing && cm.tiScrollW <= cm.tiClientW + 1, cm);
    jian('名片服务商列表不再单独滚动', cm.provOverflowY !== 'auto' && cm.provOverflowY !== 'scroll', cm);
    jian('名片卡片宽度不超过主界面', !cm.missing && cm.kaW <= cm.vw - 20, cm);
    jian('名片内容在默认情况下完整显示（无多余纵向滚动）', !cm.missing && cm.tiScrollH <= cm.tiClientH + 1, cm);
  }
} finally {
  await stop();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n==== verify-r122-ui-tweaks: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
