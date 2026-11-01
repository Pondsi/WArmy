import fs from 'node:fs';
const f = 'C:/wbuild/.memory-stress-r50-run1/run1/fast-memory.jsonl';
const st = fs.statSync(f);
const CH = 8 * 1024 * 1024;
const buf = Buffer.allocUnsafe(CH);
const fd = fs.openSync(f, 'r');
let pos = 0, lines = 0;
let carry = Buffer.alloc(0);
let carryStart = 0;
const entries = [];
const tui = (lineBuf, absStart, absEnd) => {
  const Hang = lineBuf.toString('utf8').trim();
  if (!Hang) return;
  let parsed = null;
  try { parsed = JSON.parse(Hang); } catch { return; }
  const ti = String(parsed.ti ?? parsed.content ?? parsed.text ?? Hang).slice(0, 500);
  entries.push({ start: absStart, end: absEnd, seq: Number(parsed.seq ?? entries.length + 1), id: String(parsed.id ?? ''), ti });
};
for (;;) {
  const n = fs.readSync(fd, buf, 0, CH, pos);
  if (n <= 0) break;
  const kuai = buf.subarray(0, n);
  const data = carry.length ? Buffer.concat([carry, kuai]) : kuai;
  let dataStart = carryStart;
  let from = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0x0a) continue;
    tui(data.subarray(from, i), dataStart + from, dataStart + i);
    from = i + 1;
  }
  carry = Buffer.from(data.subarray(from));
  carryStart = dataStart + from;
  pos += n;
  if (entries.length % 300 < 3) console.log('lines', entries.length, 'rssMB', Math.round(process.memoryUsage().rss/1048576));
}
if (carry.length) tui(carry, carryStart, carryStart + carry.length);
console.log('done', entries.length, 'rssMB', Math.round(process.memoryUsage().rss/1048576));
