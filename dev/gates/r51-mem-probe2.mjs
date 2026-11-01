import fs from 'node:fs';
const f = 'C:/wbuild/.memory-stress-r50-run1/run1/fast-memory.jsonl';
const st = fs.statSync(f);
const CH = 8 * 1024 * 1024;
const buf = Buffer.allocUnsafe(CH);
const fd = fs.openSync(f, 'r');
let pos = 0, lines = 0, maxLine = 0, carryLen = 0;
let carry = Buffer.alloc(0);
let i2 = 0;
for (;;) {
  const n = fs.readSync(fd, buf, 0, CH, pos);
  if (n <= 0) break;
  const kuai = buf.subarray(0, n);
  const data = carryLen ? Buffer.concat([carry, kuai]) : kuai;
  let from = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0x0a) continue;
    const len = i - from;
    if (len > maxLine) maxLine = len;
    lines++;
    from = i + 1;
  }
  carry = Buffer.from(data.subarray(from));
  carryLen = carry.length;
  pos += n;
  i2++;
  if (i2 % 100 === 0) console.log('chunk', i2, 'rssMB', Math.round(process.memoryUsage().rss/1048576), 'lines', lines, 'maxLine', maxLine);
}
console.log('done lines', lines, 'maxLine', maxLine, 'rssMB', Math.round(process.memoryUsage().rss/1048576));
