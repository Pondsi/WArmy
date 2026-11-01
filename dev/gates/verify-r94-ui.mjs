/**
 * verify-r94-ui —— 第 94 轮静态门禁（与 verify-r94-ui-live 配套）。
 *
 *  1. 首启语言页不再显示已选语言；
 *  2. 右上角关闭热区放大；
 *  3. 关闭确认的牛马动画：腿/尾/头分包、步频跟速度、随机路径与生成、可停止；
 *  4. 助记词确认弹窗的取消按钮 = 返回；
 *  5. 未勾选自动滚动时，用户手动滚动后程序不得改写滚动位置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'packages/app-shell/src');
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const auth = rd(path.join(SRC, 'renderer/auth-gate.js'));
const css = rd(path.join(SRC, 'renderer/auth-gate.css'));
const app = rd(path.join(SRC, 'renderer/app.js'));

let okN = 0, failN = 0;
const jian = (m, cond, d) => {
  if (cond) { okN++; console.log('  ok   ' + m); }
  else { failN++; console.log('  FAIL ' + m + (d === undefined ? '' : ' ← ' + String(d).slice(0, 300))); }
};
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? s.slice(i) : s.slice(i, j);
};
const fn = (s, name) => {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') { d++; started = true; }
    else if (s[k] === '}' && started && --d === 0) return s.slice(i, k + 1);
  }
  return '';
};

// ── 1. 语言页 ────────────────────────────────────────────────────────────
{
  const rl = fn(auth, 'renderLanguage');
  const foot = between(rl, '<div class="warmyAuthLangFoot">', '</div>');
  jian('语言页 DOM 不再有“当前选择的语言”文本', !!rl && !/warmyAuthLangPick/.test(rl), rl.slice(0, 200));
  jian('语言页底部只剩开始按钮（选择结果仍由方块选中态表达）',
    !!rl && /warmyAuthLangFoot/.test(rl) && (foot.match(/<button/g) || []).length === 1
    && !/warmyAuthLangPick/.test(foot), foot);
  jian('CSS 清掉 .warmyAuthLangPick 且底部按钮居中',
    !/\.warmyAuthLangPick\s*\{/.test(css) && /\.warmyAuthLangFoot\s*\{[^}]*justify-content:\s*center/.test(css));
}

// ── 2. 关闭热区 ──────────────────────────────────────────────────────────
{
  const hot = between(css, '.warmyAuthCloseHot {', '}');
  const x = between(css, '.warmyAuthCloseX {', '}');
  const hw = Number((hot.match(/width:\s*(\d+)px/) || [])[1] || 0);
  const hh = Number((hot.match(/height:\s*(\d+)px/) || [])[1] || 0);
  const xw = Number((x.match(/width:\s*(\d+)px/) || [])[1] || 0);
  jian('右上角关闭热区 ≥120×120', hw >= 120 && hh >= 120, JSON.stringify({ hw, hh }));
  jian('叉本身是 ≥42px 的点击目标', xw >= 42, xw);
  jian('热区内任意位置悬停都显示叉（不是只悬停叉本身）',
    /\.warmyAuthCloseHot:hover \.warmyAuthCloseX/.test(css));
}

// ── 3. 牛马跑动 ──────────────────────────────────────────────────────────
{
  const spawn = fn(auth, 'spawnQuitHorse');
  const start = fn(auth, 'startQuitHorses');
  const stop = fn(auth, 'stopQuitHorses');
  jian('关闭确认的静态图片串已删除（不再是一排 <img class=warmyAuthQuitHorse>）',
    !/warmyAuthQuitHorse\b/.test(auth) && !/warmyAuthQuitHorse\b/.test(css));
  jian('关闭确认改成一个动画轨道', /id="warmyAuthQuitTrack"/.test(auth) && /\.warmyAuthQuitHorses\s*\{[^}]*overflow:\s*hidden/.test(css));
  jian('每只牛马是内联 SVG，4 条腿 / 尾 / 头分别成组',
    (auth.match(/class="qLeg qLeg/g) || []).length === 4
    && /class="qTail"/.test(auth) && /class="qHead"/.test(auth));
  jian('腿/尾/头都有独立动画，步频来自 --step',
    /\.qLeg[\s\S]{0,220}animation:\s*warmyAuthQuitLeg var\(--step/.test(css)
    && /\.qTail[\s\S]{0,220}animation:\s*warmyAuthQuitTail calc\(var\(--step/.test(css)
    && /\.qHead[\s\S]{0,220}animation:\s*warmyAuthQuitHead var\(--headDur/.test(css)
    && /@keyframes warmyAuthQuitLeg/.test(css)
    && /@keyframes warmyAuthQuitTail/.test(css)
    && /@keyframes warmyAuthQuitHead/.test(css));
  jian('步频由行进时长推导（跑/走两档，不是固定动画）',
    !!spawn && /const pao = Math\.random\(\) < 0\.4/.test(spawn)
    && /const kuai = pao \?/.test(spawn) && /const bu = Math\.round\(kuai \*/.test(spawn));
  jian('路径随机分三种：直线 / 斜线 / 曲线',
    !!spawn && /zhong < 0\.28/.test(spawn) && /zhong < 0\.68/.test(spawn)
    && /const fang = Math\.random\(\) < 0\.5/.test(spawn) && /\* cy \+ t \* t \* y1/.test(spawn));
  jian('头部的微动时长与相位都是随机数',
    !!spawn && /--headDur/.test(spawn) && /--headDelay/.test(spawn) && /Math\.random\(\) \* 2600/.test(spawn));
  jian('生成间隔随机、持续补新、最多 6 只',
    !!start && /360 \+ Math\.random\(\) \* 820/.test(start) && /spawnQuitHorse\(track, gen, 0\)/.test(start)
    && /QUIT_HORSE_MAX = 6/.test(auth) && /length >= QUIT_HORSE_MAX/.test(spawn));
  jian('关闭/返回时真的停（清 timer + 取消动画 + 移除节点）',
    !!stop && /quitHorseGen\+\+/.test(stop) && /clearTimeout\(quitHorseTimer\)/.test(stop)
    && /getAnimations\(\)\.forEach\(\(a\) => a\.cancel\(\)\)/.test(stop)
    && /stopQuitHorses\(quitTrack\)/.test(auth) && /stopQuitHorses\(root\.querySelector\('#warmyAuthQuitTrack'\)\)/.test(auth));
  jian('减少动态偏好下不跑（静态展示，避免眩晕）',
    /prefers-reduced-motion: reduce[\s\S]{0,260}warmyAuthQuitRunner[\s\S]{0,120}animation:\s*none/.test(css)
    && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(start));
}

// ── 4. 助记词确认弹窗 ────────────────────────────────────────────────────
{
  const ask = fn(auth, 'askConfirm');
  jian('askConfirm 支持自定义取消文案（默认仍是“取消”）',
    !!ask && /function askConfirm\([^)]*cancelText\)/.test(ask) && /cancelText \|\| t\('cancel'\)/.test(ask));
  jian('助记词“已抄写两份”确认弹窗传的是 t(\'back\')',
    /askConfirm\('', t\('confirmBody'\), t\('confirmOk'\), true, t\('back'\)\)/.test(auth));
  const backs = auth.match(/\n\s*back:\s*'[^']*'/g) || [];
  jian('10 个语言包都有 back 文案（不是只改中文）', backs.length >= 10, backs.length);
}

// ── 5. 聊天滚动 ──────────────────────────────────────────────────────────
{
  const rc = fn(app, 'renderChat');
  jian('程序滚动有目标位置，scroll 事件位置对不上即判用户（第 99 轮：只按位置判，不靠时间窗）',
    /let chatZiGunTop = null/.test(app)
    && /const programmatic = muBiao != null && Math\.abs\(topNow - muBiao\) <= 2/.test(app)
    && /if \(!programmatic\)[\s\S]{0,240}sheZhiGenDi/.test(app)
    && /if \(chatRebuilding\) return/.test(app));
  jian('点击不再被当成“接管滚动”（旧 pointerdown/mousedown 监听已删除）',
    !/for \(const ev of \['wheel', 'touchstart', 'pointerdown'\]\)/.test(app)
    && !/for \(const ev of \['mousedown', 'touchmove'\]\)/.test(app));
  jian('重画前记下原滚动位置（innerHTML 清空不会把位置丢掉）',
    !!rc && /const prevScrollTop = sameChatDom \? heZi\.scrollTop : null/.test(rc)
    && /const domSid = String\(heZi\.dataset\.chatSid \|\| ''\)/.test(rc));
  jian('用户不在底部时重画只按原 scrollTop 还原（不顶部对齐/不追底）',
    /else if \(prevScrollTop != null\) sheZhiChatGunDong\(heZi, Math\.min\(prevScrollTop, maxScrollNow\(\)\), false\)/.test(rc)
    && !/st\.anchorTurn = turnKey/.test(rc));
  jian('keepScroll 重画也保留位置（否则加载历史/夹具重画会跳顶）',
    /if \(o\.keepScroll\) \{[\s\S]{0,260}sheZhiChatGunDong\(heZi, Math\.min\(prevScrollTop, maxScrollNow\(\)\), false\)/.test(rc));
  jian('不再把最后一条回复钉到顶部（旧 anchorTurn/anchorEl 逻辑不在重画路径里）',
    !/st\.anchorTurn = turnKey/.test(rc) && !/st\.anchorEl = anchorNode/.test(rc));
  jian('流式追加：跟随时贴底；不跟随时原样保留 scrollTop',
    /const genDiLiu = chatZhuiDi\(sidLiu\)/.test(app)
    && /const baoHuTop = genDiLiu \? null : heZi\.scrollTop/.test(app)
    && /else if \(baoHuTop != null\)[\s\S]{0,120}sheZhiChatGunDong\(heZi, baoHuTop, false\)/.test(app));
  jian('门禁夹具入口保留：keepScroll 与非 keepScroll 两种重画都能触发',
    /chongHua: \(\) => \{ try \{ renderChat\(\{ keepScroll: true \}\);/.test(app)
    && /chongHuaQuan: \(\) => \{ try \{ renderChat\(\);/.test(app));
}

console.log(`\nverify-r94-ui: ${okN} ok / ${failN} FAIL`);
process.exitCode = failN ? 1 : 0;
