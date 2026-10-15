import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

const oldA = `function jiLuBenLunWenJian(luJing: string, zhenAbs: string, bytes: number, chars?: number): void {
  try {
    const abs = String(zhenAbs || luJing || '');
    if (!abs || benLunChanPin.some((x) => x.abs === abs)) return;
    if (benLunChanPin.length >= 30) return;
    const ming0 = String(path.basename(abs) || luJing);
    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: ming0 };
    benLunChanPin.push(tiao);
    try {
      const sid = String(jiLuBenLunWenJian.sid || '');
      if (sid) {
        let arr = huiHuaChanPinTai.get(sid);
        if (!arr) { arr = []; huiHuaChanPinTai.set(sid, arr); }
        if (!arr.some((x) => x.abs === abs) && arr.length < 60) arr.push({ ...tiao, ts: Date.now() });
      }
    } catch { /* noop */ }
  } catch { /* 记不上不影响主流程 */ }
}
/** 当前正在跑的会话（jiLuBenLunWenJian 要知道记到哪个会话） */
(jiLuBenLunWenJian as unknown as { sid?: string }).sid = '';
function sheZhiJiLuHuiHua(sid: string): void {
  (jiLuBenLunWenJian as unknown as { sid?: string }).sid = String(sid || '');
}`;

const newA = `let jiLuHuiHuaSid = '';
function sheZhiJiLuHuiHua(sid: string): void { jiLuHuiHuaSid = String(sid || ''); }
function jiLuBenLunWenJian(luJing: string, zhenAbs: string, bytes: number, chars?: number): void {
  try {
    const abs = String(zhenAbs || luJing || '');
    if (!abs || benLunChanPin.some((x) => x.abs === abs)) return;
    if (benLunChanPin.length >= 30) return;
    const ming0 = String(path.basename(abs) || luJing);
    const tiao = { path: String(luJing || abs), abs, bytes: Number(bytes) || 0, ...(Number(chars) ? { chars: Number(chars) } : {}), name: ming0 };
    benLunChanPin.push(tiao);
    try {
      if (jiLuHuiHuaSid) {
        let arr = huiHuaChanPinTai.get(jiLuHuiHuaSid);
        if (!arr) { arr = []; huiHuaChanPinTai.set(jiLuHuiHuaSid, arr); }
        if (!arr.some((x) => x.abs === abs) && arr.length < 60) arr.push({ ...tiao, ts: Date.now() });
      }
    } catch { /* noop */ }
  } catch { /* 记不上不影响主流程 */ }
}`;

const n = s.split(oldA).length - 1;
console.log('hits', n);
if (n !== 1) {
  const i = s.indexOf('function jiLuBenLunWenJian');
  console.log(JSON.stringify(s.slice(i, i + 900)));
  process.exit(1);
}
s = s.replace(oldA, newA);
fs.writeFileSync(p, s, 'utf8');
console.log('jiLu fixed');
