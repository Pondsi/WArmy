import fs from 'node:fs';
const p = 'spikes/round18-patch5.mjs';
let s = fs.readFileSync(p, 'utf8');
const marker = "art-reveal-menu";
const i = s.indexOf(marker);
if (i < 0) { console.log('no marker'); process.exit(1); }
const start = s.lastIndexOf('  [', i);
const end = s.indexOf("    'art-reveal-menu',", i);
const end2 = s.indexOf('  ],', end);
const nb = `  [
    \`  document.addEventListener('contextmenu', (e) => {
    const ka = e.target && e.target.closest && e.target.closest('[data-art-reveal]');
    if (!ka) return;
    e.preventDefault();
    e.stopPropagation();
    const p = ka.getAttribute('data-art-reveal') || '';
    if (p) void window.warmy.xianShiWenJianJia?.({ path: p });
  });\`,
    \`  document.addEventListener('contextmenu', (e) => {
    const ka = e.target && e.target.closest && e.target.closest('[data-art-reveal]');
    if (!ka) return;
    e.preventDefault();
    e.stopPropagation();
    const p = ka.getAttribute('data-art-reveal') || '';
    if (p) shouWenJianYouJianCaiDan(p, e.clientX, e.clientY);
  });\`,
    'art-reveal-menu',
  ],`;
s = s.slice(0, start) + nb + s.slice(end2 + 5);
fs.writeFileSync(p, s, 'utf8');
console.log('replaced art-reveal pair');
