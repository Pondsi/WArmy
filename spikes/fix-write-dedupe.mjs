import fs from 'node:fs';
const p = 'packages/app-shell/src/work-tools.ts';
let s = fs.readFileSync(p, 'utf8');

// 改进：新建文件时若 raw 以「会话目录/」开头，优先写到去掉前缀的位置，避免 inst-x/inst-x/
const oldS = `function huiLuoHuiHuaGen(baseDir: string, raw: string, file: string): string {
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
}`;

const newS = `function huiLuoHuiHuaGen(baseDir: string, raw: string, file: string): string {
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
      /**
       * **新建文件**时也要防「会话 id 叠两遍」：raw 形如 inst-x/hello.txt，
       * baseDir 已是 …/workspace/inst-x ⇒ 再拼会变成 inst-x/inst-x/hello.txt。
       * 若前缀正好是本会话目录名，就写到去前缀的位置。
       */
      const gen = path.basename(path.resolve(baseDir));
      const qian = String(r).split(/[\\\\/]/)[0] || '';
      if (qian && qian === gen) return qu;
    }
    return file;
  } catch { return file; }
}`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) {
  const i = s.indexOf('function huiLuoHuiHuaGen');
  console.log(JSON.stringify(s.slice(i, i + 700)));
  process.exit(1);
}
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('write path dedupe improved');
