/**
 * 第 20 轮 · 任务8：回复内容加强
 *
 * 两部分：
 *   A. 勾选项存在、有气泡提示、能持久化、如实传给主进程并改变提示词；
 *   B. ```svg 真的渲染成图，且**模型产出的 SVG 经过消毒**（它是不可信输入）。
 *
 * B 必须在真实 Chromium 里跑：DOMParser / XMLSerializer 是浏览器 API，
 * 而且"有没有真的挡住 XSS"只有浏览器说了算。
 *
 * 跑法：& $env:MIMO_NODE verify-round20-enhance.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GEN = path.dirname(fileURLToPath(import.meta.url));
let guo = 0; let bai = 0;
const shuo = (ok, ming, xiang = '') => {
  if (ok) { guo++; console.log(`  [过] ${ming}`); }
  else { bai++; console.log(`  [败] ${ming}${xiang ? ' :: ' + xiang : ''}`); }
};

// ── A. 开关链路 ────────────────────────────────────────────
console.log('\nA. 「回复内容加强」开关链路');
{
  const html = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(GEN, 'packages/app-shell/src/renderer/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(GEN, 'packages/app-shell/dist/electron-main.js'), 'utf8');
  const zh = JSON.parse(fs.readFileSync(path.join(GEN, 'packages/app-shell/src/i18n/zh-CN.json'), 'utf8'));

  shuo(/id="caiDanTuBiaoJiaQiang"/.test(html), '三点菜单里有「回复内容加强」勾选项');
  shuo(/data-i18n="chat.enhanceReply"/.test(html), '菜单项文案走 i18n');
  shuo(/data-i18n-title="chat.enhanceReplyTip"/.test(html), '菜单项带悬停气泡提示');
  shuo(/role="menuitemcheckbox"/.test(html), '语义上是可勾选项（无障碍）');
  shuo(zh['chat.enhanceReply'] === '回复内容加强', `中文名正确（${zh['chat.enhanceReply']}）`);
  shuo(zh['chat.enhanceReplyTip'] === '你的牛马将使用动态的内容让你更容易理解，这将需要花费更长的时间以及更多的token',
    '气泡提示文案与产品原话完全一致', zh['chat.enhanceReplyTip']);

  shuo(/enhanceReply: false/.test(app), '初始状态默认关闭');
  shuo(/state\.enhanceReply = !state\.enhanceReply/.test(app), '点击可切换');
  shuo(/settingsSave\(\{ enhanceReply: state\.enhanceReply \}\)/.test(app), '切换后持久化');
  shuo(/state\.enhanceReply = s\.settings\.enhanceReply === true/.test(app), '重启后恢复（默认关）');
  shuo(/jiaQiangHuiFu: !!state\.enhanceReply/.test(app), '发送时如实带给主进程');

  shuo(/const jiaQiangHuiFu = xiaoXi\.jiaQiangHuiFu !== undefined/.test(main),
    '主进程读取本轮开关');
  shuo(/enhanceReply\s*===\s*true/.test(main), '内部续派轮回落到设置文件（不会悄悄退化）');
  shuo(/llm\.enhanceReply/.test(main), '开启后注入对应提示词');
  shuo(/不要用 mermaid/.test(main), '提示词不承诺界面没有的能力（mermaid 未渲染）');
  shuo(/```svg/.test(main), '提示词引导用 ```svg（界面真的会渲染）');
}

// ── B. SVG 渲染与消毒（真实 Chromium） ─────────────────────
console.log('\nB. ```svg 渲染与消毒（真实 Chromium）');
const electron = path.join(GEN, 'packages/app-shell/node_modules/electron/dist/electron.exe');
const R = path.join(GEN, 'packages/app-shell/src/renderer');
const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-svg-'));

/** 只抠 xiaoDuSvg + 它的两张白名单，避免把整个 app.js 拉进来 */
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const a = app.indexOf('const SVG_BIAOQIAN');
const b = app.indexOf('window.__xiaoDuSvg');
const duan = app.slice(a, b);

fs.writeFileSync(path.join(gen, 'page.html'),
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script>\n'
  + 'function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");}\n'
  + duan + '\nwindow.xiaoDuSvg = xiaoDuSvg;\n</script></body></html>', 'utf8');

fs.writeFileSync(path.join(gen, 'main.mjs'), [
  "import { app, BrowserWindow } from 'electron';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const here = path.dirname(fileURLToPath(import.meta.url));",
  "app.whenReady().then(async () => {",
  "  const w = new BrowserWindow({ show: false });",
  "  await w.loadFile(path.join(here, 'page.html'));",
  "  const r = await w.webContents.executeJavaScript(`(() => {",
  "    const e = (s) => escapeHtml(s);",
  "    const out = {};",
  "    out.zhengChang = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 100 50\\\\'><rect x=\\\\'1\\\\' y=\\\\'2\\\\' width=\\\\'30\\\\' height=\\\\'10\\\\' fill=\\\\'#f00\\\\'/><text x=\\\\'5\\\\' y=\\\\'20\\\\'>中文</text></svg>'));",
  "    out.jiaoBen = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\'><script>alert(1)</scr' + 'ipt><rect width=\\\\'5\\\\' height=\\\\'5\\\\'/></svg>'));",
  "    out.shiJian = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\'><rect width=\\\\'5\\\\' height=\\\\'5\\\\' onload=\\\\'alert(1)\\\\' onclick=\\\\'alert(2)\\\\'/></svg>'));",
  "    out.waiBu = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\'><image href=\\\\'http://x/a.png\\\\'/><rect width=\\\\'5\\\\' height=\\\\'5\\\\' fill=\\\\'url(http://x/y)\\\\'/></svg>'));",
  "    out.lianJie = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\'><a href=\\\\'javascript:alert(1)\\\\'><rect width=\\\\'5\\\\' height=\\\\'5\\\\'/></a></svg>'));",
  "    out.waiLai = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\'><foreignObject><div>x</div></foreignObject></svg>'));",
  "    out.chiCun = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 10 10\\\\' width=\\\\'99999\\\\' height=\\\\'99999\\\\'><rect width=\\\\'5\\\\' height=\\\\'5\\\\'/></svg>'));",
  "    out.feiSvg = xiaoDuSvg(e('console.log(1)'));",
  "    out.huaiDiao = xiaoDuSvg(e('<svg viewBox=\\\\'0 0 1 1\\\\'><rect'));",
  "    return out;",
  "  })()`);",
  "  process.stdout.write('JSON=' + JSON.stringify(r) + '\\n');",
  "  app.quit();",
  "});",
].join('\n'), 'utf8');
fs.writeFileSync(path.join(gen, 'package.json'), JSON.stringify({ name: 'svg-test', type: 'module', main: 'main.mjs' }), 'utf8');

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [gen], { encoding: 'utf8', timeout: 45000, windowsHide: true, env });
const m = String(r.stdout || '').match(/JSON=(.*)/);
if (!m) {
  console.log('  [败] 没拿到结果\n' + String(r.stdout || '') + '\n' + String(r.stderr || ''));
  process.exit(1);
}
const j = JSON.parse(m[1]);

shuo(/<rect/.test(j.zhengChang) && /中文/.test(j.zhengChang), '正常 SVG 渲染通过，中文保留');
shuo(/fill="#f00"/.test(j.zhengChang), '画图属性（fill）保留');
shuo(j.jiaoBen === '' || !/script/i.test(j.jiaoBen), '含 <script> 的被拦（整体退回源码或剔除）', j.jiaoBen);
shuo(!/onload|onclick/i.test(j.shiJian), '事件属性 on* 被剔除', j.shiJian);
shuo(!/image|url\s*\(|http:/i.test(j.waiBu), '外部引用（image / url()）被剔除', j.waiBu);
shuo(!/javascript:/i.test(j.lianJie) && !/<a[\s>]/i.test(j.lianJie), 'javascript: 链接与 <a> 被剔除', j.lianJie);
shuo(!/foreignObject/i.test(j.waiLai), 'foreignObject 被剔除', j.waiLai);
shuo(!/width="99999"/.test(j.chiCun), '超大尺寸被收口（交由 CSS 控制）', j.chiCun);
shuo(j.feiSvg === '', '不是 SVG 的内容不渲染（退回源码显示）');
shuo(j.huaiDiao === '', '坏掉的 SVG 不渲染（退回源码显示）');

// 渲染通路与样式
{
  const app2 = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(R, 'app.css'), 'utf8');
  shuo(/lang \|\| ''\)\.toLowerCase\(\) === 'svg'/.test(app2), 'mdHtml 认 ```svg 代码块');
  shuo(/class="mdSvg"/.test(app2), '渲染成 .mdSvg 容器');
  shuo(/\.mdSvgTu \{[^}]*max-width/.test(css), '有尺寸收口样式（不撑破气泡）');
}

try { fs.rmSync(gen, { recursive: true, force: true }); } catch { /* noop */ }
console.log(`\n${'─'.repeat(52)}\n过 ${guo} · 败 ${bai}\n`);
process.exit(bai ? 1 : 0);
