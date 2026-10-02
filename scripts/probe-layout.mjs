/** 只读诊断：第二列偏移 —— 列几何 + 设置页 + 模型两列选择器 + 截图 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../packages/app-shell/scripts/cdp-lib.mjs';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(selfDir, '..', 'reports-layout.txt');
fs.writeFileSync(out, 'layout probe ' + new Date().toISOString() + '\n');
const c = await attach(9944, { biaoQian: 'layout', callTimeout: 20000 });
await c.send('Runtime.enable');
const dump = async (title, expr) => {
  let v;
  try { v = await c.evaluate(expr); } catch (e) { v = 'ERR ' + e.message.slice(0, 160); }
  const line = `\n===== ${title} =====\n` + (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  console.log(line.slice(0, 3000));
  fs.appendFileSync(out, line + '\n');
};

await dump('主布局四列几何', `(function(){
  const g = (id) => { const e = document.getElementById(id); if (!e) return 'no '+id; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { id, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, gridCols: cs.gridTemplateColumns, overflow: cs.overflow }; };
  const appTi = document.getElementById('appTi');
  return {
    cols: [g('ceLan'), g('lieBiaoLan'), g('zhuLan'), g('mianBanLan')],
    appTi: appTi ? { cols: getComputedStyle(appTi).gridTemplateColumns, cls: appTi.className } : 'no appTi',
    listW: getComputedStyle(document.documentElement).getPropertyValue('--list-w'),
    panelW: getComputedStyle(document.documentElement).getPropertyValue('--panel-w'),
    items: [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].slice(0,3).map((e)=>{const r=e.getBoundingClientRect();return {t:(e.textContent||'').trim().slice(0,16),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vis:getComputedStyle(e).display};}),
  };
})()`);

await c.snap(path.join(selfDir, '..', 'reports-layout-main.png'));

// 设置页
await c.evaluate(`(function(){ document.querySelector('[data-nav="settings"]').click(); return 1; })()`);
await sleep(1200);
await dump('设置页几何', `(function(){
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return 'no '+sel; const r = e.getBoundingClientRect();
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  return { nav: g('#peiZhiDaoHang'), content: g('#peiZhiNeiRong'), buju: g('.peiZhiBuJu'),
    navBtns: [...document.querySelectorAll('#peiZhiDaoHang button')].map((b)=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim().slice(0,6),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}) };
})()`);
await c.snap(path.join(selfDir, '..', 'reports-layout-settings.png'));

// 模型两列选择器（进牛马管理局）
await c.evaluate(`(function(){ document.querySelector('[data-nav="singleAi"]').click(); return 1; })()`);
await sleep(800);
await c.evaluate(`(function(){ const i=document.querySelector('#lieBiaoHeadDongZuoJi .lieBiaoHqTuBiao'); if(i) i.click(); return !!i; })()`);
await sleep(900);
await dump('管理局列表', `(function(){
  return [...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')].map((e)=>{const r=e.getBoundingClientRect();return {t:(e.textContent||'').trim().slice(0,18),x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height)};});
})()`);
await c.evaluate(`(function(){ const it=[...document.querySelectorAll('#lieBiaoTi .lieBiaoTiaoMu')][0]; if(it) it.click(); return !!it; })()`);
await sleep(1200);
await dump('管理模型两列选择器', `(function(){
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return 'no '+sel; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, options: e.tagName==='SELECT' ? e.options.length : undefined }; };
  const box = document.getElementById('iModelcfg');
  return {
    cfg: box ? (()=>{const r=box.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})() : 'no cfg',
    twoCol: g('.modelLiangLie'),
    prov: g('#iProvXuanZe'), model: g('#iMoXingXuanZe'),
    manual: g('#iManual'), allChk: (()=>{const e=document.getElementById('iAllMoXingJi');return e?{checked:e.checked}:null;})(),
    heads: [...document.querySelectorAll('#iModelcfg h4')].map((h)=>h.textContent.trim()),
  };
})()`);
await c.snap(path.join(selfDir, '..', 'reports-layout-model.png'));

// 取消「全部可用」看两列
await c.evaluate(`(function(){
  const ck = document.getElementById('iAllMoXingJi');
  if (ck && ck.checked) { ck.checked = false; ck.dispatchEvent(new Event('change', { bubbles: true })); }
  return 1;
})()`);
await sleep(800);
await dump('取消全部可用后的两列', `(function(){
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return 'no '+sel; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, vis: cs.visibility, options: e.tagName==='SELECT' ? [...e.options].slice(0,4).map((o)=>o.value) : undefined }; };
  return { manual: g('#iManual'), prov: g('#iProvXuanZe'), model: g('#iMoXingXuanZe'), lianglie: g('.modelLiangLie') };
})()`);
await c.snap(path.join(selfDir, '..', 'reports-layout-model2.png'));

c.close();
console.log('\nwritten:', out);
process.exit(0);
