const fs = require('node:fs');
const base = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/';
let j = fs.readFileSync(base + 'yingYong.js', 'utf8');
let c = fs.readFileSync(base + 'yingYong.css', 'utf8');

// ══════════════════════════════════════════
// 输入卡顿根因修复
// ══════════════════════════════════════════

// 根因1：document click 监听器无限累积（每次打开菜单都 add，从不 remove）
// 修复：改为全局单次注册 + { once: false } 但只注册一次
if (!j.includes('__docClickBound')) {
  j = j.replace(
    '  const t = (k) => state.t[k] || k;',
    `  const t = (k) => state.t[k] || k;
  // 全局只注册一次 document click（避免每次开菜单都叠加）
  let __docClickBound = false;
  const __docClickHandlers = new Set();
  function onDocClick(fn) {
    __docClickHandlers.add(fn);
    if (!__docClickBound) {
      __docClickBound = true;
      document.addEventListener('click', (e) => {
        for (const fn of __docClickHandlers) fn(e);
      });
    }
  }`
  );
  console.log('docClick singleton added');
}

// 替换所有 document.addEventListener('click', ...) 为 onDocClick
j = j.replace(
  /document\.addEventListener\('click', \(\) => menu\.classList\.add\('yinCang'\)\);/g,
  "onDocClick(() => menu?.classList.add('yinCang'));"
);
j = j.replace(
  /document\.addEventListener\('click', \(\) => \$\('gengDuoCaiDan'\)\?\.classList\.add\('yinCang'\)\);/g,
  "onDocClick(() => $('gengDuoCaiDan')?.classList.add('yinCang'));"
);
console.log('docClick leaks fixed');

// 根因2：window mousemove 监听器永久驻留（5个 resizer 各注册一次）
// 修复：只在 mousedown 时注册，mouseup 时移除
j = j.replace(
  /    window\.addEventListener\('mousemove', \(e\) => \{\n      if \(!dragging\) return;[\s\S]*?\n    \}\);\n    window\.addEventListener\('mouseup', \(\) => \{\n      if \(!dragging\) return;\n      dragging = false;\n      el\.classList\.remove\('dragging'\);\n    \}\);/g,
  `    const onMove = (e) => {
      if (!dragging) return;
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      el.classList.add('dragging');
      startX = e.clientX;
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 280;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });`
);
console.log('horizontal resizer leak fixed');

// 垂直 resizer 同样修复
j = j.replace(
  /    el\.addEventListener\('mousedown', \(e\) => \{\n      drag = true; y0 = e\.clientY; h0 = target\.getBoundingClientRect\(\)\.height; e\.preventDefault\(\);\n    \}\);\n    window\.addEventListener\('mousemove', \(e\) => \{\n      if \(!drag\) return;\n      const delta = dir === 'up' \? \(y0 - e\.clientY\) : \(e\.clientY - y0\);\n      const h = Math\.min\(400, Math\.max\(80, h0 \+ delta\)\);\n      target\.style\.height = h \+ 'px';\n      target\.style\.maxHeight = h \+ 'px';\n    \}\);\n    window\.addEventListener\('mouseup', \(\) => \{ drag = false; \}\);/g,
  `    const onMove = (e) => {
      if (!drag) return;
      const delta = dir === 'up' ? (y0 - e.clientY) : (e.clientY - y0);
      const h = Math.min(400, Math.max(80, h0 + delta));
      target.style.height = h + 'px';
      target.style.maxHeight = h + 'px';
    };
    const onUp = () => {
      if (!drag) return;
      drag = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = target.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });`
);
console.log('vertical resizer leak fixed');

// 根因3：控制台 resizer 同样
j = j.replace(
  /    el\.addEventListener\('mousedown', \(e\) => \{\n      drag = true; y0 = e\.clientY; h0 = pane\.getBoundingClientRect\(\)\.height; e\.preventDefault\(\);\n    \}\);\n    window\.addEventListener\('mousemove', \(e\) => \{\n      if \(!drag\) return;\n      const h = Math\.min\(360, Math\.max\(80, h0 \+ \(y0 - e\.clientY\)\)\);\n      pane\.style\.maxHeight = h \+ 'px';\n      pane\.style\.height = h \+ 'px';\n    \}\);\n    window\.addEventListener\('mouseup', \(\) => \{ drag = false; \}\);/g,
  `    const onMove = (e) => {
      if (!drag) return;
      const h = Math.min(360, Math.max(80, h0 + (y0 - e.clientY)));
      pane.style.maxHeight = h + 'px';
      pane.style.height = h + 'px';
    };
    const onUp = () => { drag = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    el.addEventListener('mousedown', (e) => {
      drag = true; y0 = e.clientY; h0 = pane.getBoundingClientRect().height;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });`
);
console.log('console resizer leak fixed');

// 根因4：ti transition 导致每次样式变化都触发重绘
c = c.replace(
  /ti \{\n  transition: background 0\.2s ease, color 0\.2s ease;/,
  'ti {\n  /* 不对 ti 加 transition，避免打字时重绘 */'
);
console.log('ti transition removed');

fs.writeFileSync(base + 'yingYong.js', j);
fs.writeFileSync(base + 'yingYong.css', c);
console.log('lag fixes done');
