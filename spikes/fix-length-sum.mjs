import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = `      let xie = benLunChanPin.reduce((zui, x) => Math.max(zui, Number(x.chars) || 0), 0);
      try {
        const tai = huiHuaChanPinTai.get(sessionId) || [];
        for (const x of tai) xie = Math.max(xie, Number(x.chars) || 0);
        // 实读：路径还在磁盘上的最大字符数
        for (const x of [...benLunChanPin, ...tai]) {
          try {
            const abs = String(x.abs || '');
            if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              const txt = fs.readFileSync(abs, 'utf8');
              xie = Math.max(xie, [...txt].length);
            }
          } catch { /* 读不了就用记录值 */ }
        }
      } catch { /* */ }`;

const newS = `      /**
       * **按去重文件求和**（真机：模型拆成 part2/output-x 多个文件，
       * 取 max 会永远差一截 ⇒ 无限续派）。同一路径只计一次，多文件字数相加。
       */
      let xie = 0;
      try {
        const seen = new Map();
        for (const x of [...benLunChanPin, ...(huiHuaChanPinTai.get(sessionId) || [])]) {
          const abs = String(x.abs || x.path || '');
          if (!abs) continue;
          let zi = Number(x.chars) || 0;
          try {
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              zi = Math.max(zi, [...fs.readFileSync(abs, 'utf8')].length);
            }
          } catch { /* */ }
          seen.set(abs, Math.max(seen.get(abs) || 0, zi));
        }
        for (const zi of seen.values()) xie += zi;
      } catch { /* */ }`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) process.exit(1);
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('length = sum unique files');
