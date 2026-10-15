import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = "        const rawArgsH = call && call.function ? (call.function as { arguments?: unknown }).arguments : undefined;";
const newS = `        const rawArgsH = call && call.function ? (call.function as { arguments?: unknown }).arguments : undefined;
        try {
          const ra = String(rawArgsH || '');
          if (ra.trim().length < 3) audit?.log('chat.tool-empty-args', { sessionId, tool: gongJuMing, rawLen: ra.length });
        } catch { /* noop */ }`;
const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('audit added');
}
