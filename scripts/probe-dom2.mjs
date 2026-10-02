/** 只读：#pageBuJu 到底在哪个父级下（含重复 id 检查） */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach } from '../packages/app-shell/scripts/cdp-lib.mjs';
const selfDir = path.dirname(fileURLToPath(import.meta.url));
const c = await attach(9944, { biaoQian: 'dom2', callTimeout: 20000 });
await c.send('Runtime.enable');
const r = await c.evaluate(`(function(){
  const els = [...document.querySelectorAll('[id="pageBuJu"]')];
  const zhu = document.getElementById('zhuLan');
  return {
    count: els.length,
    parent: els.map((e) => (e.parentElement ? e.parentElement.tagName + '#' + (e.parentElement.id || '') : 'none')),
    zhuHasPage: zhu ? zhu.innerHTML.includes('pageBuJu') : null,
    zhuChildren: zhu ? [...zhu.children].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) : null,
    zhuPos: zhu ? getComputedStyle(zhu).position : null,
    zhuDisplay: zhu ? getComputedStyle(zhu).display : null,
    appChildren: [...document.getElementById('app').children].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')),
    appTiChildren: [...document.getElementById('appTi').children].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')),
  };
})()`);
console.log(JSON.stringify(r, null, 1));
c.close();
process.exit(0);
