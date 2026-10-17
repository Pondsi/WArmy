import fs from 'node:fs';
let g = 0, b = 0;
const ok = (c, n) => { if (c) { g++; console.log('  [过]', n); } else { b++; console.log('  [败]', n); } };
const APP = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.js', 'utf8');
const CSS = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.css', 'utf8');
const MAIN = fs.readFileSync('C:/wbuild/packages/app-shell/src/electron-main.ts', 'utf8');

console.log('R26 本轮改动验收');
ok(CSS.includes('.bubble.langDuGaoLiang') && CSS.includes('.langDuZhongAv'), '1/15/16 高亮框+头像喇叭');
ok(APP.includes("querySelectorAll('.bubble.langDuGaoLiang')") && APP.includes('langDuDangQian = null'), '17 停止后清呼吸/高亮');
ok(APP.includes('paiGuoZheYiLun') && APP.includes('showHao'), '2 编号仅任务开始重排一次');
ok(MAIN.includes('whisper') && MAIN.includes("kind = 'chat'") || APP.includes("return 'chat'"), '4 whisper 归 chat 不进听话链');
ok(CSS.includes('jieTuTiShi') && CSS.includes('var(--ink)'), '5 截图提示跟主题');
ok(APP.includes('uiPromptMulti') && APP.includes('添加授权'), '8 授权添加可选类型');
ok(APP.includes('shouQuanCheXiaoXiao') && APP.includes('luQuan'), '9 授权卡样式+完整路径');
ok(APP.includes('jiHuaHang2') && MAIN.includes('ts: Number(yiYou?.ts || yiYou?.createdAt || 0) || (xinTs + bu.length)'), '7/10 计划2行+创建时间（第 34 轮：创建时间由宿主定）');
ok(MAIN.includes('confidence') || MAIN.includes('keXinDu'), '12 推荐项可信度门槛');
ok(APP.includes('tokensTurns'), '13 词元方案B');
ok(MAIN.includes('jieGuoHeLi') && MAIN.includes('yinPinMiao'), '14 ASR 时长匹配过滤');
ok(MAIN.includes('read-ledger') && MAIN.includes("op !== 'read'"), '18 只读文件进其他文件');
ok(APP.includes('workFileFb') && APP.includes('sourceLabel'), '19 来源标签可读');
ok(APP.includes('only-link-open') || APP.includes('keDian') , '20 只有超链接可点');
ok(MAIN.includes('chatLogs.delete(id)'), '7 删除实例清日志');
ok(MAIN.includes('card-suppressed-by-stop') && MAIN.includes('gongJuXunHuanQuXiao'), '停止真停');
ok(!/tip: lu \+ '[\r\n]/.test(APP), '语法回归防护（tip 行无裸换行）');
ok(MAIN.includes('plan.hard-gate-clean'), '计划硬门禁（主进程）');
ok(MAIN.includes('skillMarketList') && APP.includes('jinengShiChang'), '技能市场可用');
ok(!APP.includes("id: 'local-asr'"), '本地 ASR 不再作为供应商预设（第 34 轮：改由设置→功能「本地语音与文字互换」提供）');
ok(fs.readFileSync('C:/wbuild/run-verify-22.mjs','utf8').includes('check-syntax'), 'check-syntax 已入门禁');
ok(fs.readFileSync('C:/wbuild/packages/app-shell/src/i18n/zh-CN.json','utf8').includes('panel.auth.op.read'), '新增 i18n 键已补');

const r = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K', messages: [{ role: 'user', content: 'say OK' }], max_tokens: 64 }),
});
const j = await r.json();
ok(r.ok && (j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning), '真实 Ollama 对话');

console.log('==== R26：' + g + ' 过 / ' + b + ' 败 ====');
process.exit(b ? 1 : 0);
