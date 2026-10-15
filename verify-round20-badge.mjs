/**
 * 第 20 轮 · 任务11：异常角标 = 感叹号，且查看后消失
 *
 * 用户现象：回复出现异常后，第二列图标是**问号**（应为感叹号）；且看过之后不消失。
 *
 * 根因：任务中断（`planInterrupted`）在 `attachChatMarks` 里单独画了一个字面 `?`
 * 的 `renWuZhongDuanMark`，append 在角标逻辑**之前** ⇒ 异常看起来就是问号，
 * 还和"有决策待回答"的 `?` 撞成一个样子；并且没有任何"看过即消失"的通路。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-badge.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

console.log('\n任务11 · 异常角标');

// 1. 再也没有"为中断单独画一个问号"的代码
{
  shuo(!/className = 'renWuZhongDuanMark'/.test(app),
    '不再为任务中断单独画字面 `?`（原事故根因）');
  const duan = app.slice(app.indexOf('function attachChatMarks'), app.indexOf('function applyInstanceRowState'));
  shuo(!/q\.textContent = '\?'/.test(duan), '中断不再产生 `?` 文本节点');
  shuo(/b\.textContent = '!'/.test(duan), '异常角标文本是 `!`');
  shuo(/b\.textContent = '\?'/.test(duan), '决策卡角标仍是 `?`（两者要能区分）');
}

// 2. 中断并入异常口径（都显示 !）
{
  const duan = app.slice(app.indexOf('const daiJueCe ='), app.indexOf('} catch { /* noop */ }', app.indexOf('const daiJueCe =')));
  shuo(/state\.planInterrupted/.test(duan) && /state\.chatErrors/.test(duan),
    '异常判据同时覆盖「回复异常」与「任务中断」');
  shuo(/if \(yiChang\) \{[\s\S]*?\} else if \(daiJueCe\)/.test(app),
    '异常优先于决策卡（出事了先报异常）');
}

// 3. 看过即消失，且不误伤「继续/重试」
{
  shuo(/yiChaKanYiChang/.test(app), '有"已查看异常"账本');
  const duan = app.slice(app.indexOf('(function bindUnreadAck()'), app.indexOf('(function bindUnreadAck()') + 2000);
  shuo(/state\.chatErrors[\s\S]{0,80}\.delete\(String\(sid\)\)/.test(duan),
    '查看会话时清掉 chatErrors');
  shuo(/yiChaKanYiChang[\s\S]{0,120}\.add\(String\(sid\)\)/.test(duan),
    '查看被中断的会话时记成"已查看"');
  shuo(!/state\.planInterrupted[\s\S]{0,60}\.delete\(String\(sid\)\)/.test(duan),
    '**不**清 planInterrupted（「继续/重试」按钮要留着）');
  shuo(/const kanGuo = state\.yiChaKanYiChang/.test(app), '渲染角标时尊重"已查看"');
}

// 4. 新异常要重新提醒
{
  shuo((app.match(/yiChaKanYiChang\?\.delete\(/g) || []).length >= 2,
    '新的回复异常 / 新的任务中断都会清掉"已查看"，重新提醒');
}

// 5. 初始状态里有这个账本（不是运行时才冒出来）
shuo(/yiChaKanYiChang: new Set\(\)/.test(app), '初始 state 里声明了该账本');

console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
