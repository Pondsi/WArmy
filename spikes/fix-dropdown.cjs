const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'app.js', 'utf8');
let c = fs.readFileSync(base + 'app.css', 'utf8');

// ── CSS：下拉菜单改为 fixed 定位，脱离 overflow 容器 ──
c = c.replace(
  `.urg-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;`,
  `.urg-menu {
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
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');`,
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) positionMenuFixed(trigger, menu);
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-s]');`
);

// 紧急度下拉：打开时定位
j = j.replace(
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');`,
  `    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (!menu.classList.contains('hidden')) positionMenuFixed(trigger, menu);
    });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-u]');`
);

// 更多菜单：打开时定位
j = j.replace(
  `  $('more-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('more-menu')?.classList.toggle('hidden');
  });`,
  `  $('more-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('more-menu');
    menu?.classList.toggle('hidden');
    if (menu && !menu.classList.contains('hidden')) positionMenuFixed($('more-trigger'), menu);
  });`
);

fs.writeFileSync(base + 'app.js', j);
fs.writeFileSync(base + 'app.css', c);
console.log('done');
console.log('  positionMenuFixed:', j.includes('positionMenuFixed'));
console.log('  urg-menu fixed:', c.includes('position: fixed'));
