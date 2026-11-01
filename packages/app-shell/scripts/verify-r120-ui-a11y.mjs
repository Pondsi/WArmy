#!/usr/bin/env node
/**
 * verify-r120-ui-a11y.mjs —— W10：键盘可达、减少动态效果、P9 静态阴影层、nm 下载闭环。
 *
 * 纯 Node：文件名/落盘路径是真实调用；其余是**可失败的静态判据**（源码里没有就红）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(pkg, rel), 'utf8');
const { nmAnQuanXiaZaiMing, nmWeiYiLuJing } = await import(pathToFileURL(path.join(pkg, 'dist', 'nm-download-names.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};

/* ── 下载文件名/路径（真实行为） ── */
ok('远端文件名不能逃出下载目录（../）', nmAnQuanXiaZaiMing('../../evil.exe') === 'evil.exe', nmAnQuanXiaZaiMing('../../evil.exe'));
ok('绝对路径只取文件名', nmAnQuanXiaZaiMing('C:\\Windows\\System32\\evil.exe') === 'evil.exe', nmAnQuanXiaZaiMing('C:\\Windows\\System32\\evil.exe'));
ok('Windows 非法字符被替换', !/[<>:"/\\|?*\u0000-\u001f]/.test(nmAnQuanXiaZaiMing('a<b>c:d"e|f?g*h.txt')), nmAnQuanXiaZaiMing('a<b>c:d"e|f?g*h.txt'));
ok('结尾点/空格被去掉', nmAnQuanXiaZaiMing('报告. . .') === '报告', nmAnQuanXiaZaiMing('报告. . .'));
ok('空文件名回退为 download', nmAnQuanXiaZaiMing('') === 'download');
ok('超长文件名截到 180 字符', nmAnQuanXiaZaiMing('x'.repeat(500) + '.txt').length <= 180);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r120-dl-'));
try {
  const p1 = nmWeiYiLuJing(dir, '报告.pdf');
  ok('首次落盘保持原名', path.basename(p1) === '报告.pdf');
  fs.writeFileSync(p1, 'a');
  const p2 = nmWeiYiLuJing(dir, '报告.pdf');
  ok('同名文件自动加 (1)', path.basename(p2) === '报告 (1).pdf', path.basename(p2));
  fs.writeFileSync(p2, 'b');
  ok('再次同名加 (2)', path.basename(nmWeiYiLuJing(dir, '报告.pdf')) === '报告 (2).pdf');
  const escape = nmWeiYiLuJing(dir, nmAnQuanXiaZaiMing('../../x.sh'));
  ok('清洗后的落盘路径仍在下载目录内', path.dirname(escape) === dir && path.basename(escape) === 'x.sh', escape);
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

/* ── CSS：键盘可达 + P9 静态阴影层 + 减少动态效果 ── */
const css = read('src/renderer/app.css');
ok('操作行在键盘焦点进入时可见（focus-within）', /\.xiaoXi:focus-within \.xiaoXiJiao/.test(css));
ok('操作按钮有 focus-visible 轮廓', /\.xiaoXiJiao[^{]*button:focus-visible/.test(css) && /outline:\s*2px solid var\(--accent\)/.test(css));
ok('播放发光改成静态阴影层 + opacity', /\.bubble::after/.test(css) && /langDuHuXi[\s\S]{0,200}opacity/.test(css));
const glowKey = /@keyframes langDuHuXi \{([\s\S]*?)\n\}/.exec(css);
ok('发光关键帧不再改 box-shadow（只动 opacity）', !!glowKey && !/box-shadow/.test(glowKey[1]), glowKey && glowKey[1].slice(0, 120));
ok('系统减少动态效果时全局压掉动画/过渡', /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}animation-duration:\s*\.01ms/.test(css));
ok('操作行按钮有可读 aria-label', /aria-label="' \+ escapeHtml\(tOr\('chat\.copy'/.test(read('src/renderer/app.js')) || /aria-label="' \+ escapeHtml\(tOr\('chat\.read'/.test(read('src/renderer/app.js')));

/* ── 首启：不可见不画 + 减少动态只画静态帧 ── */
const engine = read('src/renderer/firstrun-scenes/engine.js');
ok('首启动画在窗口不可见时停止绘制', /document\.hidden/.test(engine));
ok('首启在减少动态效果下关闭自动轮播', /jianDong[\s\S]{0,200}auto = false/.test(engine));
ok('首启减少动态时只画当前场景首帧', /lastDrawnToken !== token/.test(engine));

/* ── nm 下载闭环接线 ── */
const html = read('src/renderer/nm-viewer.html');
const nmjs = read('src/renderer/nm-viewer.js');
const nmwin = read('src/nm-viewer-win.ts');
const preload = read('src/preload.cjs');
const main = read('src/electron-main.ts');
ok('nm 网页工具栏有下载按钮', /id="anNiuWangYeXiaZai"/.test(html));
ok('nm 有下载面板与清空/关闭按钮', /id="xiaZaiMianBan"/.test(html) && /anNiuXiaZaiQingKong/.test(html) && /anNiuXiaZaiGuan/.test(html));
ok('nm 渲染层订阅进度并渲染状态', /nmXiaZaiGengXin/.test(nmjs) && /下载中/.test(nmjs) && /已完成/.test(nmjs));
ok('preload 暴露下载列表/清空/打开/定位/进度', ['nmXiaZaiLieBiao', 'nmXiaZaiQingKong', 'nmXiaZaiDaKai', 'nmXiaZaiXianShi', 'nmXiaZaiGengXin'].every((k) => new RegExp(k).test(preload)));
ok('主进程注册下载 IPC', ['warmy:nmXiaZaiLieBiao', 'warmy:nmXiaZaiQingKong', 'warmy:nmXiaZaiDaKai', 'warmy:nmXiaZaiXianShi'].every((k) => main.includes(k)));
ok('nm 挂 will-download 并落到系统下载目录', /will-download/.test(nmwin) && /getPath\('downloads'\)/.test(nmwin) && /setSavePath/.test(nmwin));
ok('下载完成/失败写审计', /nm\.download/.test(nmwin) && /nmSheZhiXiaZaiShenJi/.test(nmwin) && /nmSheZhiXiaZaiShenJi/.test(main));

console.log(`\nverify-r120-ui-a11y: ${pass} PASS / 0 FAIL`);
