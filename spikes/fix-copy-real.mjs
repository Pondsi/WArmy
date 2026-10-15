import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = `chuliIpc('warmy:copyFileToClipboard', async (_e, p0?: { path?: string }) => {
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

const newS = `chuliIpc('warmy:copyFileToClipboard', async (_e, p0?: { path?: string }) => {
  try {
    const p = String(p0?.path || '');
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    const abs = path.resolve(p);
    /**
     * **复制文件本体**（产品要求：与「复制路径」区分）。
     * Windows：用 PowerShell Set-Clipboard -Path（Explorer 可粘贴出文件）；
     * 其它平台 / 失败：退回 FileNameW 缓冲，再不行才复制路径文本。
     */
    if (process.platform === 'win32') {
      try {
        const { execFile } = require('node:child_process') as typeof import('node:child_process');
        const ps = \`\${process.env.windir || 'C:\\\\Windows'}\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\`;
        await new Promise<void>((res, rej) => {
          execFile(ps, ['-NoProfile', '-Command', \`Set-Clipboard -LiteralPath '\${abs.replace(/'/g, "''")}'\`],
            { windowsHide: true, timeout: 8000 }, (err) => (err ? rej(err) : res()));
        });
        return { ok: true, mode: 'file' };
      } catch { /* 继续兜底 */ }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clipboard } = require('electron') as typeof import('electron');
        clipboard.writeBuffer('FileNameW', Buffer.from(abs + '\\0', 'ucs2'));
        return { ok: true, mode: 'file' };
      } catch { /* */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clipboard } = require('electron') as typeof import('electron');
    clipboard.writeText(abs);
    return { ok: true, mode: 'text' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n === 1) {
  s = s.replace(oldS, newS);
  fs.writeFileSync(p, s, 'utf8');
  console.log('copy file via powershell');
}
