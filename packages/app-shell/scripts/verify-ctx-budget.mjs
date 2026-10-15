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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');

let n = 0;
const ok = (t, fn) => { fn(); n++; console.log('ok  ', t); };
const has = (src, re) => re.test(src);

ok('主进程已知表：mimo-v2.5 = 1M（不是 32K/131072）', () => {
  const m = /'mimo-v2\.5'\s*:\s*(\d+)/.exec(MAIN);
  if (!m) throw new Error('主进程 MODEL_CTX_MAP 里找不到 mimo-v2.5');
  if (Number(m[1]) !== 1048576) throw new Error('mimo-v2.5 窗口应为 1048576，实为 ' + m[1]);
});

ok('渲染层已知表：mimo-v2.5 = 1M', () => {
  const m = /'mimo-v2\.5'\s*:\s*(\d+)/.exec(APP);
  if (!m) throw new Error('渲染层 MODEL_CTX_MAP 里找不到 mimo-v2.5');
  if (Number(m[1]) !== 1048576) throw new Error('mimo-v2.5 窗口应为 1048576，实为 ' + m[1]);
});

ok('预算不许被落盘的绝对字符数覆盖（老值会锁死 32K）', () => {
  // contextBudgetChars 里不应再出现「先读 settings.contextBudgetChars」这种写法
  const fn = /function contextBudgetChars\([\s\S]{0,900}?\n}/.exec(MAIN);
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
