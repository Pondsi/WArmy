/** 只读：查 #pageBuJu 的父级链与包含块（第二列偏移诊断） */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, sleep } from '../packages/app-shell/scripts/cdp-lib.mjs';
const selfDir = path.dirname(fileURLToPath(import.meta.url));
const c = await attach(9944, { biaoQian: 'dom', callTimeout: 20000 });
await c.send('Runtime.enable');
const r = await c.evaluate(`(function(){
  const el = document.getElementById('pageBuJu');
  const chain = [];
  let n = el;
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    chain.push({
      tag: n.tagName.toLowerCase() + (n.id ? '#'+n.id : '') + (n.className && typeof n.className === 'string' ? '.'+n.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
      pos: cs.position, display: cs.display, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
    });
    n = n.parentElement;
  }
  const appTi = document.getElementById('appTi');
  return {
    chain,
    appTiPos: appTi ? getComputedStyle(appTi).position : null,
    appTiChildren: appTi ? [...appTi.children].map((e) => e.tagName.toLowerCase() + (e.id ? '#'+e.id : '')) : null,
    zhuLanChildren: [...(document.getElementById('zhuLan')?.children || [])].map((e) => e.tagName.toLowerCase() + (e.id ? '#'+e.id : '')).slice(0, 12),
  };
})()`);
console.log(JSON.stringify(r, null, 1));
c.close();
process.exit(0);
