import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = `    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: String(path.basename(abs) || luJing) };
    if (benLunChanPin.length >= 30) {
      const du = benLunChanPin.findIndex((x) => !x.chars || x.chars <= 0);
      if (youXian && du >= 0) benLunChanPin.splice(du, 1);
      else if (!youXian) return;
      else {
        // 全是写入：丢最早的
        benLunChanPin.shift();
      }
    }
    const ming0 = String(path.basename(abs) || luJing);
    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: ming0 };
    benLunChanPin.push(tiao);
    try {
      if (jiLuHuiHuaSid) {
        let arr = huiHuaChanPinTai.get(jiLuHuiHuaSid);
        if (!arr) { arr = []; huiHuaChanPinTai.set(jiLuHuiHuaSid, arr); }
        if (!arr.some((x) => x.abs === abs) && arr.length < 60) arr.push({ ...tiao, ts: Date.now() });
      }
    } catch { /* noop */ }`;

const newS = `    if (benLunChanPin.length >= 30) {
      const du = benLunChanPin.findIndex((x) => !x.chars || x.chars <= 0);
      if (youXian && du >= 0) benLunChanPin.splice(du, 1);
      else if (!youXian) return;
      else benLunChanPin.shift();
    }
    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: String(path.basename(abs) || luJing) };
    benLunChanPin.push(tiao);
    try {
      if (jiLuHuiHuaSid) {
        let arr = huiHuaChanPinTai.get(jiLuHuiHuaSid);
        if (!arr) { arr = []; huiHuaChanPinTai.set(jiLuHuiHuaSid, arr); }
        const jiu = arr.find((x) => x.abs === abs);
        if (jiu) {
          if (bytes > (jiu.bytes || 0)) jiu.bytes = bytes;
          if (Number(chars || 0) > Number(jiu.chars || 0)) jiu.chars = Number(chars || 0);
          jiu.ts = Date.now();
        } else if (arr.length < 60) {
          arr.push({ ...tiao, ts: Date.now() });
        }
      }
    } catch { /* noop */ }`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) process.exit(1);
s = s.replace(oldS, newS);
// write_file call site: pass youXian=true
s = s.replace(
  'jiLuBenLunWenJian(luJing, zhenAbs, Number(wr.meta.bytes) || 0, Number(wr.meta.chars) || 0);',
  'jiLuBenLunWenJian(luJing, zhenAbs, Number(wr.meta.bytes) || 0, Number(wr.meta.chars) || 0, true);'
);
fs.writeFileSync(p, s, 'utf8');
console.log('ledger fixed + write priority');
