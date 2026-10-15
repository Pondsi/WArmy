import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');

// 授权键：再加一层「同操作 + 同目录」宽匹配
const oldS = `  if (juJue && tongYi) {
    const key = shouQuanJian(biaoTi, ti);
    if (key && shouQuanQu(sessionId).some((x) => x.text === key)) {`;

const newS = `  if (juJue && tongYi) {
    const key = shouQuanJian(biaoTi, ti);
    /**
     * **宽匹配**（本轮修「不断请求授权」）：完全相同键之外，
     * 「同一操作 + 同一目录」也算命中 —— 用户同意过 Desktop 写文件，
     * 再写 Desktop 下别的文件不必再弹卡（可在「授权」卡里撤销）。
     */
    const caoZuo = String(biaoTi || '').replace(/\\s+/g, ' ').trim();
    const muLuOf = (t: string) => {
      const m = String(t || '').match(/(?:路径|path)[:：]\\s*([^\\s（(]+)/i);
      const p0 = m ? m[1] : '';
      const parts = p0.split(/[\\\\/]/).filter(Boolean);
      return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || '');
    };
    const muLu = muLuOf(ti);
    const kuan = key && shouQuanQu(sessionId).some((x) => {
      if (x.text === key) return true;
      if (!muLu) return false;
      const t2 = String(x.text || '');
      if (!t2.includes(caoZuo) && !(caoZuo.includes('write_file') && t2.includes('write_file'))) {
        // 操作要同类：write_file/make_* 归「写」，open_* 归「开」
        const lei = (z: string) => /make_|write_/.test(z) ? 'xie' : /open_/.test(z) ? 'kai' : 'qita';
        if (lei(caoZuo) !== lei(t2)) return false;
      }
      return muLuOf(t2) === muLu;
    });
    if (kuan) {`;

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) { console.log('fail'); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('auth wide-match added');
