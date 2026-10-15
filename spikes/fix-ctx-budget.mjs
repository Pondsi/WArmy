import fs from 'node:fs';
const p = 'packages/app-shell/src/renderer/app.js';
let s = fs.readFileSync(p, 'utf8');

// 包装 saveInst：存完刷新上下文预算
const oldS = `      function saveInst() {
        try { state.instances = state.instances.map((x) => (x.id === inst2.id ? inst2 : x)); window.__saveState?.(); } catch { /* noop */ }
      }`;
const newS = `      function saveInst() {
        try { state.instances = state.instances.map((x) => (x.id === inst2.id ? inst2 : x)); window.__saveState?.(); } catch { /* noop */ }
        /** **默认模型/降级变了 ⇒ 上下文预算跟着变**（产品要求） */
        try {
          if (window.__ctxLoadTimer) clearTimeout(window.__ctxLoadTimer);
          window.__ctxLoadTimer = setTimeout(() => { void ctxLoad(); }, 300);
        } catch { /* noop */ }
      }`;
const n = s.split(oldS).length - 1;
console.log('saveInst hits', n);
if (n === 1) s = s.replace(oldS, newS);

// 默认模型下拉 change 也刷新
s = s.replace(
  `        inst2.defaultModel = defSel.value;`,
  `        inst2.defaultModel = defSel.value;
        try { if (window.__ctxLoadTimer) clearTimeout(window.__ctxLoadTimer); window.__ctxLoadTimer = setTimeout(() => { void ctxLoad(); }, 300); } catch { /* noop */ }`
);
fs.writeFileSync(p, s, 'utf8');
console.log('ctx budget follows model');
