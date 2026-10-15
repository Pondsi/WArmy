/**
 * 第 20 轮 · 任务8 真机：开启「回复内容加强」后，真实模型会不会**挑对**表达方式。
 *
 * 用主进程里**一字不差**的那段提示词（从 dist 抠出来），问两类问题：
 *   · 结构类（"TCP 三次握手的流程"）⇒ 应该给出 ```svg；
 *   · 一句话事实（"1 加 1 等于几"）⇒ 应该**只用文字**（不为了用而用）。
 * 产出的 SVG 再跑一遍我们的消毒器，确认它真的能被画出来。
 *
 * 跑法：$env:MIMO_KEY_FILE="<key文件>"; & $env:MIMO_NODE verify-round20-enhance-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0; const ti = [];
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

const key = (() => {
  const f = process.env.MIMO_KEY_FILE || '';
  if (!f || !fs.existsSync(f)) return '';
  return String(fs.readFileSync(f, 'utf8').split(/\r?\n/)[0] || '').trim();
})();
if (!key) { console.log('  [跳过] 没有 MiMo key'); process.exit(0); }

// 从编译产物里抠出真实提示词（与线上逐字一致）
const main = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
const m = main.match(/tMain\('llm\.enhanceReply',\s*'([\s\S]*?)'\)\);/);
if (!m) { console.log('  [败] 抠不到 llm.enhanceReply 提示词'); process.exit(1); }
// dist 里是多段 '…' + '…' 拼接，这里按 JS 字面量求值还原
const tiShi = Function('"use strict"; return (\'' + m[1] + '\');')();

const { JianrongOpenAIGongYing } = await import(
  pathToFileURL(path.join(GEN, 'packages/providers/dist/openai.js')).href
);
/** 画 SVG 是重活：provider 默认 120s 不够，给到 6 分钟 */
const gy = new JianrongOpenAIGongYing(
  { apiKey: key, timeoutMs: 360_000 },
  { id: 'mimo', defaultBase: 'https://token-plan-cn.xiaomimimo.com/v1' },
);

/**
 * 输出预算给足：画 SVG 本身就长，思考型模型还会先花一截在 reasoning 上。
 * 第一次试 3000 就被思考吃光、正文为空（finishReason=length）——
 * 这也正是任务8 提示里要如实告诉用户"更费 token"的原因。
 */
/** 走流式（与线上主路径一致，也不受单次请求超时限制），预算与主进程加强模式一致 */
async function wen(neiRong) {
  let zheng = ''; let si = ''; let fr = null;
  for await (const p of gy.chatStream({
    model: 'mimo-v2.6-flash',
    xiaoXiJi: [
      { role: 'system', content: '你是 WArmy 里的 AI 牛马。\n' + tiShi },
      { role: 'user', content: neiRong },
    ],
    maxTokens: 12288,
  })) {
    const d = p.choices?.[0]?.delta || {};
    if (d.content) zheng += d.content;
    if (d.reasoning) si += d.reasoning;
    if (p.choices?.[0]?.finishReason) fr = p.choices[0].finishReason;
  }
  console.log(`     (finishReason=${fr} 正文 ${zheng.length} 字 思考 ${si.length} 字)`);
  return zheng;
}

console.log('\n任务8 真机 · 回复内容加强（mimo-v2.6-flash）');
shuo(tiShi.includes('```svg') && tiShi.includes('不要用 mermaid'), '提示词取自真实编译产物');

// 1. 结构类问题 ⇒ 应给 SVG
const jieGou = await wen('用图帮我讲清楚 TCP 三次握手的流程。');
const svgKuai = (jieGou.match(/```svg\s*\n([\s\S]*?)```/) || [])[1] || '';
if (!svgKuai) {
  console.log('\n--- 模型原始回复（前 1200 字）---\n' + jieGou.slice(0, 1200) + '\n---\n');
}
shuo(!!svgKuai, '结构类问题 ⇒ 模型给出了 ```svg 代码块', jieGou.slice(0, 120));
shuo(!/```mermaid/.test(jieGou), '没有用界面不渲染的 mermaid');
shuo(jieGou.replace(/```[\s\S]*?```/g, '').trim().length > 20, '图之外仍有文字说明（结论没只画在图里）');
if (svgKuai) {
  shuo(/<svg[\s>]/.test(svgKuai), 'SVG 内容以 <svg 开头');
  shuo(!/<script/i.test(svgKuai), '模型产出不含 script（即使含，消毒器也会挡）');
  fs.writeFileSync(path.join(GEN, '.round20-live-svg.txt'), svgKuai, 'utf8');
  ti.push('已把模型产出的 SVG 存到 .round20-live-svg.txt，供下一步在真实 Chromium 里过消毒器');
}

// 2. 一句话事实 ⇒ 只用文字
const jianDan = await wen('1 加 1 等于几？');
shuo(!/```svg|<svg/i.test(jianDan), '一句话事实 ⇒ 不画图（没有为了用而用）', jianDan.slice(0, 80));
shuo(/2|二/.test(jianDan), '答案正确', jianDan.slice(0, 60));

console.log(`\n${'─'.repeat(52)}`);
for (const x of ti) console.log('  · ' + x);
console.log(`过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
