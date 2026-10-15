import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const i = s.indexOf("chuliIpc('warmy:copyFileToClipboard'");
console.log('idx', i);
const j = s.indexOf('});', i);
console.log('end', j);
console.log(JSON.stringify(s.slice(i, j + 3)));
const neu = `chuliIpc('warmy:copyFileToClipboard', async (_e, p0?: { path?: string }) => {
  try {
    const p = String(p0?.path || '');
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    const abs = path.resolve(p);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clipboard } = require('electron') as typeof import('electron');
    try {
      if (process.platform === 'win32') {
        clipboard.writeBuffer('FileNameW', Buffer.from(abs + '\\0', 'ucs2'));
        return { ok: true, mode: 'file' };
      }
    } catch { /* 部分环境不支持文件剪贴板 */ }
    clipboard.writeText(abs);
    return { ok: true, mode: 'text' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});`;
s = s.slice(0, i) + neu + s.slice(j + 3);
fs.writeFileSync(p, s, 'utf8');
console.log('clipboard handler rewritten');
