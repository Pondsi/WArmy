/**
 * Round 33 static checks. ASCII-only assertions.
 */
import fs from 'node:fs';
import path from 'node:path';

const fail = [];
const ok = [];
const chk = (n, c) => { if (c) ok.push(n); else fail.push(n); };

const app = fs.readFileSync('packages/app-shell/src/renderer/app.js', 'utf8');
const em = fs.readFileSync('packages/app-shell/src/electron-main.ts', 'utf8');
const css = fs.readFileSync('packages/app-shell/src/renderer/app.css', 'utf8');
const wt = fs.readFileSync('packages/app-shell/src/work-tools.ts', 'utf8');
const zh = fs.readFileSync('packages/app-shell/src/i18n/zh-CN.json', 'utf8');

// T15 (item 4): evidence-based auto verify + EBUSY guidance
chk('autoverify-fn', em.includes('function jiHuaAnZhengJuZiDongYanZheng'));
chk('autoverify-before-dispatch', em.indexOf('jiHuaAnZhengJuZiDongYanZheng(sessionId, String(reply') < em.indexOf('const xuPan = !shiNeiBu'));
// 第 34 轮起自动验证改为按步骤证据核对（buZhouZhengJuHeDui）：等待看 wait_seconds、写文件看本次产物
chk('autoverify-wait', em.includes("gongJu.has('wait_seconds')"));
chk('autoverify-file', em.includes("you.push('已生成 ' + hit.abs)"));
chk('autoverify-audit', em.includes('plan.evidence-autoverify'));
chk('ebusy-guidance', wt.includes('file-locked') && wt.includes('不要改成别的文件名重新生成一份'));

// T16 (item 1): auth list layout + count
chk('auth-count-badge', app.includes('shouQuanJiShu'));
chk('auth-row-class-fixed', app.includes('shouQuanLuJingHang') && !app.includes('<div class="shouQuanHang2"><span class="shouQuanLuJing"'));
chk('auth-css-column', css.includes('li.shouQuanHang2') && css.includes('flex-direction: column'));
chk('auth-list-scroll', css.includes('#shouQuanLieBiao') && css.includes('overflow: auto'));

// T17 (item 2): screenshot goes to changed, not other
chk('attach-workspace-skip', em.includes('zaiGongZuoQu') && em.includes('continue;'));
chk('other-skip-workspace', em.includes('在**本会话工作区**内的也算「最近改动」'));

// T18 (item 3): unified icons
chk('icon-map', app.includes('WEN_JIAN_TU_BIAO'));
chk('icon-classifier', app.includes('function wenJianIcoLei'));
chk('icon-11-classes', ['tuPian', 'yinPin', 'shiPin', 'wenBen', 'daiMa', 'yaSuo', 'zhiXing', 'pdf', 'kongBai'].every((k) => app.includes(k + ":")));
// 第 34 轮 项 5 起：PPT/表格并入同一文档外框家族（线条符号），不再单独走 24 视图分支
chk('icon-ppt-line', app.includes('WEN_JIAN_TU_BIAO.ppt = WEN_JIAN_TU_BIAO.kongBai') && app.includes('stroke="currentColor"'));
chk('icon-table-line', app.includes('WEN_JIAN_TU_BIAO.biaoGe = WEN_JIAN_TU_BIAO.kongBai'));
chk('icon-fill-monochrome', app.includes('pfIcoFill') && app.includes('fill="currentColor"'));
chk('icon-css', css.includes('.pfIcoFill'));
chk('icon-shared', app.includes('${lu ? wenJianIco(lu) : \'\'}'));

// i18n valid
let allOk = true;
for (const f of fs.readdirSync('packages/app-shell/src/i18n')) {
  if (!f.endsWith('.json')) continue;
  try { JSON.parse(fs.readFileSync(path.join('packages/app-shell/src/i18n', f), 'utf8')); } catch { allOk = false; }
}
chk('i18n-valid', allOk);

console.log('=== verify-round33-changes ===');
console.log('PASS ' + ok.length + ' / ' + (ok.length + fail.length));
for (const f of fail) console.log('FAIL ' + f);
if (fail.length) process.exit(1);
console.log('ALL PASS');
