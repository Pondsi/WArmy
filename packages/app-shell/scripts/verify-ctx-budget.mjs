/**
 * 门禁：**上下文预算必须跟着真实模型走**（本轮修的就是它）。
 *
 * 真机反馈：用 mimo-v2.5（1M 上下文）时滑杆拉到 97% 也只有 31785 —— 那是 32K。
 * 根因有三个，这里把它们**固化成断言**，防止以后又被改回去：
 *   ① 已知表里 MiMo 系必须是 **1M**（不是 32K/131072）
 *   ② 预算**不许**再用落盘的绝对字符数覆盖（那是老值，会锁死）
 *   ③ 满值**不许**用 `ctxState.maxTokens` 兜底（上次残留 ⇒ 新模型被锁回 32K）
 *   ④ 满值要由**主进程权威计算**（`warmy:shangXiaWenYuSuan`），渲染层去拉
 *
 * 用法：<node> verify-ctx-budget.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');

let n = 0;
const ok = (t, fn) => { fn(); n++; console.log('ok  ', t); };
const has = (src, re) => re.test(src);

/**
 * 第 44 轮改过这里：以前这两条把 **1048576** 写死在正则判据里，还对渲染层那份表单独比对 ⇒
 * ① 官方口径是 1M = 1,000,000（十进制），我们把显示与存储都改对了，反倒是门禁红；
 * ② 更要命的是它**没禁止两份表各写一套数** —— 本轮自查就抓出渲染层还留着 1048576/65536。
 * 现在：唯一事实源是 `dist/mo-xing-gui-ge.js` 的 `MODEL_GUIGE`（官网核对过），
 * 门禁断言 ① 主进程用的就是这张表 ② **渲染层兜底表与它逐型号一致**（漂移当场红）。
 */
const GUIGE_MO_KUAI = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/mo-xing-gui-ge.js')).href);
const BIAO = GUIGE_MO_KUAI.MODEL_GUIGE;
ok('官方规格表：mimo-v2.5 = 1M（十进制，官网口径；不再是二进制的 1048576）', () => {
  if (!BIAO['mimo-v2.5']) throw new Error('规格里找不到 mimo-v2.5');
  if (Number(BIAO['mimo-v2.5'].chuangKou) !== 1000000) throw new Error('应为 1000000，实为 ' + BIAO['mimo-v2.5'].chuangKou);
  if (Number(BIAO['mimo-v2.5'].shuChu) !== 128000) throw new Error('输出上限应为 128000');
  if (Number(BIAO['mimo-v2.5'].rpm) !== 100 || Number(BIAO['mimo-v2.5'].tpm) !== 10000000) throw new Error('RPM/TPM 应按官网 100 / 10M');
});
ok('官方规格表：deepseek-chat/reasoner 已升到 1M（旧表 65536 会把 1M 模型按 64K 裁）', () => {
  for (const k of ['deepseek-chat', 'deepseek-reasoner']) {
    if (Number(BIAO[k]?.chuangKou) !== 1000000) throw new Error(k + ' 应为 1000000');
    if (!BIAO[k]?.heShiRi) throw new Error(k + ' 缺核对日期（不许把没核实的数装成核实过的）');
  }
});
ok('主进程用的就是这一张表（MODEL_CTX_MAP 由规格表派生，不留第二份数字）', () => {
  if (!/Object\.entries\(MODEL_GUIGE\)/.test(MAIN)) throw new Error('主进程没有从规格表派生窗口表，可能出现两份漂移的数');
  if (/'mimo-v2\.5'\s*:\s*1048576/.test(MAIN)) throw new Error('主进程里还留着二进制猜值 1048576');
});
ok('渲染层兜底表与官方规格表**逐型号一致**（防"两条腿各说各话"）', () => {
  const m = /const MODEL_CTX_MAP = \{([\s\S]*?)\n {2}\};/.exec(APP);
  if (!m) throw new Error('渲染层里找不到 MODEL_CTX_MAP');
  const tu = {};
  for (const x of m[1].matchAll(/'([^']+)'\s*:\s*(\d+)/g)) tu[x[1]] = Number(x[2]);
  const cuo = [];
  for (const k of Object.keys(BIAO)) if (tu[k] !== undefined && tu[k] !== Number(BIAO[k].chuangKou)) cuo.push(k + ' 渲染层=' + tu[k] + ' 官方=' + BIAO[k].chuangKou);
  /**
   * 反方向也要查（本轮补）：渲染层那份是**兜底表**（IPC 还没回来时用），不是第二事实源。
   * 以前只比"两边都有的型号"，于是渲染层可以悄悄多出一个官方表里没有的型号、或写一个凭空猜的窗口，
   * 门禁照样绿 —— 那正是"两份表各说各话"的另一种形态。
   */
  const piao = Object.keys(tu).filter((k) => BIAO[k] === undefined);
  if (piao.length) throw new Error('渲染层兜底表里有官方规格表没有的型号（不许凭空多写）：' + piao.join(', '));
  if (cuo.length) throw new Error('两份表漂移：' + cuo.join('；'));
  if (Object.keys(tu).length < 3) throw new Error('渲染层兜底表被掏空了（IPC 未回来时会退回默认窗口）：' + Object.keys(tu).length + ' 条');
});

ok('预算不许被落盘的绝对字符数覆盖（老值会锁死 32K）', () => {
  // contextBudgetChars 里不应再出现「先读 settings.contextBudgetChars」这种写法
  // 窗口要跟着函数长胖：第 45 轮这里加了"视图额度 = 整条预算 − 实测固定开销"，
  // 900 字符的旧窗口截不到函数尾 ⇒ 正则找不到就误报"找不到 contextBudgetChars"
  const fn = /function contextBudgetChars\([\s\S]{0,3000}?\n\}/.exec(MAIN);
  if (!fn) throw new Error('找不到 contextBudgetChars');
  if (/settingsStore\?\.load\(\)\?\.contextBudgetChars/.test(fn[0])) {
    throw new Error('contextBudgetChars 仍在读落盘绝对值 contextBudgetChars —— 会把新模型锁回老预算');
  }
  if (!/youPeizhiSuanShangXiaWenYuSuan/.test(fn[0])) {
    throw new Error('contextBudgetChars 应按 youPeizhiSuanShangXiaWenYuSuan 现算');
  }
});

ok('渲染层满值不许用 ctxState.maxTokens 兜底（残留值 ⇒ 锁回 32K）', () => {
  const fn = /function modelContextTokensFor\([\s\S]{0,4000}?\n  \}/.exec(APP);
  if (!fn) throw new Error('找不到 modelContextTokensFor');
  if (/return ctxState\.maxTokens/.test(fn[0])) {
    throw new Error('modelContextTokensFor 仍用 ctxState.maxTokens 兜底');
  }
});

ok('满值由主进程权威计算（warmy:shangXiaWenYuSuan）', () => {
  if (!has(MAIN, /chuliIpc\('warmy:shangXiaWenYuSuan'/)) throw new Error('主进程缺 warmy:shangXiaWenYuSuan');
  if (!has(APP, /shangXiaWenYuSuan/)) throw new Error('渲染层没有调用 shangXiaWenYuSuan');
});

ok('真实模型含降级后的模型（huiHuaMoXing 记录 chat.model-picked）', () => {
  if (!has(MAIN, /huiHuaMoXing\.set/)) throw new Error('主进程没记下会话的实际模型');
  if (!has(MAIN, /zhaoShiJiMoXing/)) throw new Error('主进程缺 zhaoShiJiMoXing');
});

ok('渲染层按「当前会话最近一条助手消息的模型」兜底解析', () => {
  if (!has(APP, /m\.moXing/)) throw new Error('渲染层没有从消息上取实际模型');
});

ok('预算随会话切换/新回复重算（renderChat 里防抖 ctxLoad）', () => {
  if (!has(APP, /__ctxLoadTimer/)) throw new Error('renderChat 里没有防抖调用 ctxLoad');
});

console.log(`==== verify-ctx-budget: ${n} 全部通过 ====`);
process.exit(0);
