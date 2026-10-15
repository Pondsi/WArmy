/**
 * R23 真机联调：Ollama + MiMo 真实对话 / 工具落盘 / 词元 / 文件台账
 * 用法: node verify-round23-live.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/wbuild';
let guo = 0, bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log('  [过] ' + ming); }
  else { bai++; console.log('  [败] ' + ming + (xiang ? ' :: ' + xiang : '')); }
};

const KEY = String(process.env.MIMO_KEY || (process.env.MIMO_KEY_FILE ? fs.readFileSync(process.env.MIMO_KEY_FILE, 'utf8').split(/\r?\n/)[0].trim() : '')).trim();
shuo(/^tp-/.test(KEY) || KEY.length > 20, 'MiMo key 可读', 'len=' + KEY.length);

// 选一个较小的 Ollama 模型（优先 9b / vision）
const ollamaList = await new Promise((resolve) => {
  const p = spawn('ollama', ['list'], { encoding: 'utf8' });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', () => resolve(out));
});
const lines = ollamaList.split(/\r?\n/).filter((l) => l.trim() && !/^NAME/.test(l));
const names = lines.map((l) => l.split(/\s+/)[0]).filter(Boolean);
const chatMo = names.find((n) => /9b|8b|7b|4b/i.test(n) && !/vision|whisper|bge/i.test(n)) || names[0];
const visionMo = names.find((n) => /vision|vl/i.test(n)) || '';
shuo(!!chatMo, 'Ollama 对话模型', chatMo || '(none)');
shuo(!!visionMo, 'Ollama 看图模型', visionMo || '(none, 将跳过看图)');

// 直接调 Ollama /v1 做一次真实对话（含工具）
async function ollamaChat(body) {
  const r = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

console.log('\n真实 Ollama 对话');
{
  const r = await ollamaChat({
    model: chatMo,
    messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
    max_tokens: 80,
  });
  const txt = r?.choices?.[0]?.message?.content || '';
  shuo(txt.length > 5, 'Ollama 有真实回复', txt.slice(0, 60).replace(/\n/g, ' '));
  const u = r?.usage || {};
  shuo(Number(u.prompt_tokens || u.promptTokens || 0) > 0, 'Ollama 返回 usage 词元',
    'prompt=' + (u.prompt_tokens || u.promptTokens) + ' completion=' + (u.completion_tokens || u.completionTokens));
}

console.log('\n真实工具调用（write_file 落盘）');
{
  const workTools = await import(pathToFileURL(path.join(ROOT, 'packages/app-shell/dist/work-tools.js')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-wt-'));
  const r = workTools.runWorkTool(tmp, { function: { name: 'write_file', arguments: JSON.stringify({ path: 'hello-r23.txt', content: 'R23 live test\n第二行中文\n' }) } }, true);
  const abs = path.join(tmp, 'hello-r23.txt');
  shuo(r.ok === true, 'write_file 返回 ok', r.content && String(r.content).slice(0, 80));
  shuo(fs.existsSync(abs), '文件真实落盘', abs);
  shuo(fs.readFileSync(abs, 'utf8').includes('R23 live'), '内容正确');
  const mv = workTools.runWorkTool(tmp, { function: { name: 'move_file', arguments: JSON.stringify({ path: 'hello-r23.txt', destination: 'moved-r23.txt' }) } }, true);
  shuo(mv.ok === true && fs.existsSync(path.join(tmp, 'moved-r23.txt')), 'move_file 可用');
  // 台账 op 类型含 move
  const gs = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/group-store.ts'), 'utf8');
  shuo(gs.includes("'move'"), 'group-store 含 move 操作类型');
}

console.log('\nMiMo API 真实调用');
{
  try {
    const r = await fetch('https://token-plan-cn.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: 'mimo-v2.5',
        messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
        max_tokens: 200,
      }),
    });
    const j = await r.json();
    const msg = j?.choices?.[0]?.message || {};
    const txt = String(msg.content || '') + String(msg.reasoning_content || '').slice(0, 40) + (msg.tool_calls ? '[tool_calls]' : '');
    shuo(r.ok && txt.length > 3, 'MiMo API 真实回复', 'http=' + r.status + ' ' + txt.slice(0, 50).replace(/\n/g, ' '));
    const u = j?.usage || {};
    shuo(Number(u.prompt_tokens || 0) > 0, 'MiMo 返回 usage', JSON.stringify(u).slice(0, 80));
  } catch (e) {
    shuo(false, 'MiMo API 调用', String(e && e.message || e));
  }
}

console.log('\n源码断言（本轮改动）');
{
  const app = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/renderer/app.css'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
  shuo(app.includes('tiaoZhengInkDuiBi'), 'applyInk 派生 muted/ink-dim');
  shuo(app.includes('--me-bubble-ink') && app.includes('tiaoZhengInkDuiBi(ink, me)'), '对话气泡按主题色调 ink');
  shuo(app.includes('pfShiJian'), '文件行时间在名称前');
  shuo(app.includes('xiaoXiCiYuan') && app.includes('chat.tokensFmt'), '词元信息在时间右侧');
  shuo(app.includes('__langDuZhongKey'), '喇叭播放态可跨重绘恢复');
  shuo(css.includes('langDuHuXi') && css.includes('55%'), '呼吸效果加强');
  shuo(app.includes('settings.skillsTitle'), '技能页去掉本地 SKILL 标题');
  shuo(app.includes('gongJu.enabled') && app.includes('data-skill-toggle'), '技能勾选框在右侧带「启用」');
  shuo(main.includes("op: op2") && main.includes('recordFileAccess'), 'work-tool 写入项目文件台账');
  shuo(main.includes('promptTokens: xiangYing.usage'), 'usage 随日志落盘');
}

console.log('\n==== R23 live: ' + guo + ' 过 / ' + bai + ' 败 ====');
process.exit(bai ? 1 : 0);
