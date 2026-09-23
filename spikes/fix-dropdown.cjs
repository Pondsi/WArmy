const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// ── CSS：下拉菜单改为 fixed 定位，脱离 overflow 容器 ──
c = c.replace(
  `.jinJiCaiDan {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;`,
  `.jinJiCaiDan {
  position: fixed;
  z-index: 500;`
);

// ── JS：打开菜单时用 fixed 定位 + 计算坐标 ──
if (!j.includes('positionMenuFixed')) {
  j = j.replace(
    '  const t = (k) => state.t[k] || k;',
    `  const t = (k) => state.t[k] || k;
  /** 把下拉菜单 fixed 定位到触发按钮下方，避免被 overflow 裁切 */
  function positionMenuFixed(trigger, menu) {
    if (!trigger || !menu) return;
    const r = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = Math.min(r.left, window.innerWidth - 180) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.zIndex = '500';
  }`
  );
  console.log('positionMenuFixed added');
}

// 安全模式下拉：打开时定位
j = j.replace(
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');`,
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
      if (!menu.classList.contains('yinCang')) positionMenuFixed(trigger, menu);
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');`
);

// 紧急度下拉：打开时定位
j = j.replace(
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');`,
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('yinCang');
      if (!menu.classList.contains('yinCang')) positionMenuFixed(trigger, menu);
    });
    document.addEventListener('click', () => menu.classList.add('yinCang'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');`
);

// 更多菜单：打开时定位
j = j.replace(
  `  $('gengDuoTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('gengDuoCaiDan')?.classList.toggle('yinCang');
  });`,
  `  $('gengDuoTrigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('gengDuoCaiDan');
    menu?.classList.toggle('yinCang');
    if (menu && !menu.classList.contains('yinCang')) positionMenuFixed($('gengDuoTrigger'), menu);
  });`
);

fs.writeFileSync(base + 'yingYong.js', j);
fs.writeFileSync(base + 'yingYong.css', c);
console.log('done');
console.log('  positionMenuFixed:', j.includes('positionMenuFixed'));
console.log('  jinJiCaiDan fixed:', c.includes('position: fixed'));
