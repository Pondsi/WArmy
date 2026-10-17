import fs from 'node:fs';
let g = 0, b = 0;
const ok = (c, n, x = '') => { if (c) { g++; console.log('  [过]', n); } else { b++; console.log('  [败]', n, x); } };
const APP = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.js', 'utf8');
const CSS = fs.readFileSync('C:/wbuild/packages/app-shell/src/renderer/app.css', 'utf8');
const MAIN = fs.readFileSync('C:/wbuild/packages/app-shell/src/electron-main.ts', 'utf8');

console.log('R24 本轮改动');
ok(!/#A87654;\s*$/m.test(CSS.replace(/--accent:\s*#A87654;/g, '')) || CSS.includes('color-mix(in srgb, var(--accent)'), '主题色渐变跟随 accent');
ok(CSS.includes('.lieBiaoTiaoMu.jiHuo[data-tema'), '选中行文字可跟主题');
ok(APP.includes('daiJueCe') && APP.includes('24 * 3600 * 1000'), '问号带 24h 失效');
ok(APP.includes('renderList(); } catch { /* noop */ };\n          return;') || APP.includes('卡片消失 ⇒ 第二列问号'), '卡片消失清问号');
ok(!APP.includes("id=\"anNiuJinengDaoRu\""), '技能导入按钮已删');
ok(APP.includes('jiHuaHang2') && APP.includes('清理周期'), '计划任务 2 行 + 清理周期');
ok(APP.includes('__jiHuaMenJin'), '计划编号硬门禁');
ok(CSS.includes('langDuZhongAv'), '播放头像叠喇叭');
ok(CSS.includes('langDuGaoLiang'), '朗读高亮框');
ok(APP.includes('xiaoXiCiYuan') && APP.includes('tokensTurns'), '词元方案 B 合计+次数');
ok(MAIN.includes('auth.grant-once') && MAIN.includes('if (!abs) abs = path.resolve(p0)'), 'open_path 授权后补 abs');
ok(MAIN.includes('open_path.try'), 'open_path 结果审计');
ok(MAIN.includes('shiAsr') && MAIN.includes('houXuan.sort'), 'ASR 链过滤+重排');
ok(APP.includes('settings.asrLocalTitle') && !APP.includes('Deepgram</option>'), '云端 ASR UI 已删');
ok(APP.includes('shouQuanHang2') && APP.includes('anNiuShouQuanTianJia'), '授权卡 2 行 + 添加');
ok(CSS.includes('jiHuaQingLi') || APP.includes('jiHuaQingLiZhouQi'), '清理周期下拉');

// 真实 Ollama 一次
const r = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K', messages: [{ role: 'user', content: '说 OK' }], max_tokens: 64 }),
});
const j = await r.json();
ok(r.ok && (j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning || j.choices?.[0]?.message?.reasoning_content), 'Ollama 真实对话');

console.log('==== R24 改动验收：' + g + ' 过 / ' + b + ' 败 ====');
process.exit(b ? 1 : 0);
