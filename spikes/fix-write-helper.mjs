import fs from 'node:fs';
const p = 'packages/app-shell/src/work-tools.ts';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'export function workWriteFile(baseDir: string, args: { path?: string; content?: string; append?: boolean }, kuaiQuan = false): WorkToolResult {';
const helper = `/** 会话 id 叠两遍时的回落解析（workspace/inst-x/inst-x/f → workspace/inst-x/f） */
function huiLuoHuiHuaGen(baseDir: string, raw: string, file: string): string {
  try {
    if (fs.existsSync(file)) return file;
    const r = String(raw || '').trim();
    if (!r || path.isAbsolute(r)) return file;
    const root = path.resolve(baseDir, '..');
    const shang = path.resolve(root, r);
    if (shang !== root && shang.startsWith(root + path.sep) && fs.existsSync(shang)) return shang;
    const pei = r.match(/^[^/\\\\]+[\\\\/](.+)$/);
    if (pei && pei[1]) {
      const qu = path.resolve(baseDir, pei[1]);
      if (fs.existsSync(qu)) return qu;
    }
    return file;
  } catch { return file; }
}

`;
const n = s.split(anchor).length - 1;
console.log('anchor hits', n);
if (n !== 1) { console.log('fail'); process.exit(1); }
if (s.includes('function huiLuoHuiHuaGen')) { console.log('already there'); process.exit(0); }
s = s.replace(anchor, helper + anchor);
fs.writeFileSync(p, s, 'utf8');
console.log('helper added');
