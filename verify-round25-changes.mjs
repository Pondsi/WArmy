import fs from 'node:fs';
let g = 0, b = 0;
const ok = (c, n, x = '') => { if (c) { g++; console.log('  [过]', n); } else { b++; console.log('  [败]', n, x); } };
const APP = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.js', 'utf8');
const CSS = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.css', 'utf8');
const MAIN = fs.readFileSync('C:/wbuild/packages/app-shell/src/electron-main.ts', 'utf8');

console.log('R25 本轮改动');
ok(APP.includes('paiGuoZheYiLun') && APP.includes('showHao'), '编号仅任务开始重排一次（不改稳定id）');
ok(!APP.includes("tOr('panel.plan.stats'") && !APP.includes('统计X'), '计划统计文字已删');
ok(CSS.includes('.jiHuaHang2.yiWan'), '完成任务无强调色条');
ok(APP.includes('data-jhfull') && APP.includes('复制任务内容'), '复制格式与右键');
ok(MAIN.includes('heBingXin') && MAIN.includes('baoLiu'), 'plan_update 不丢步骤');
ok(MAIN.includes('plan_update 不许把任务标成 done'), 'done 只能 plan_verify');
ok(APP.includes('streaming') && APP.includes('yiTingZhi'), '停止保留思考/回复');
ok(APP.includes('faSongAnNiu.classList.remove') && APP.includes('stopAllAi'), '停止恢复发送钮');
ok(MAIN.includes('chat.card-suppressed-by-stop'), '停止后不弹卡');
ok(MAIN.includes('gongJuXunHuanQuXiao'), '停止掐断工具循环');
ok(MAIN.includes('pickFileOrDir'), 'pickFileOrDir IPC');
ok(MAIN.includes('chatLogs.delete(id)'), '删除实例清聊天日志');
ok(MAIN.includes('asr-user-first') || MAIN.includes('houXuan.unshift(shou)'), '听话模型强制链首');
ok(MAIN.includes('asr-garbage'), 'ASR 垃圾结果过滤');

const r = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K', messages: [{ role: 'user', content: 'say OK' }], max_tokens: 64 }),
});
const j = await r.json();
ok(r.ok && (j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning), 'Ollama 真实对话');

console.log('==== R25 改动验收：' + g + ' 过 / ' + b + ' 败 ====');
process.exit(b ? 1 : 0);
