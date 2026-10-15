import fs from 'node:fs';
const p = 'packages/app-shell/src/electron-main.ts';
let s = fs.readFileSync(p, 'utf8');
const oldS = [
  'function yunXuDuiHua(mo: string): boolean {',
  '  const b = duiHuaBaiMingDan();',
  '  if (!b.youXiao) return true;',
  '  const s = String(mo || \'\').trim();',
  '  if (!s) return false;',
  '  if (b.jian.has(s)) return true;',
  '  // 兼容「供应商 · 模型」复合标签：按裸模型 id 再比一次',
  '  const bare = s.includes(\' · \') ? s.split(\' · \').slice(1).join(\' · \') : s;',
  '  return b.jian.has(bare);',
  '}',
].join('\n');

const newS = [
  'function yunXuDuiHua(mo: string): boolean {',
  '  const b = duiHuaBaiMingDan();',
  '  if (!b.youXiao) return true;',
  '  const s = String(mo || \'\').trim();',
  '  if (!s) return false;',
  '  if (b.jian.has(s)) return true;',
  '  /**',
  '   * **归一双向匹配**（真机 bug：白名单存「供应商 · 模型」而模型 id 是裸的，',
  '   * 于是全部 not-in-chat-whitelist ⇒ 牛马完全不能干活）。',
  '   * 两边都取「 · 」后的裸 id 再比；也兼容白名单本身就是裸 id。',
  '   */',
  '  const bareOf = (x: string) => {',
  '    const t = String(x || \'\').trim();',
  '    return t.includes(\' · \') ? t.split(\' · \').slice(1).join(\' · \').trim() : t;',
  '  };',
  '  const sBare = bareOf(s);',
  '  if (sBare && b.jian.has(sBare)) return true;',
  '  for (const item of b.jian) {',
  '    if (bareOf(item) === sBare || bareOf(item) === s || item === sBare) return true;',
  '  }',
  '  return false;',
  '}',
].join('\n');

const n = s.split(oldS).length - 1;
console.log('hits', n);
if (n !== 1) {
  const i = s.indexOf('function yunXuDuiHua');
  console.log(JSON.stringify(s.slice(i, i + 400)));
  process.exit(1);
}
s = s.replace(oldS, newS);
fs.writeFileSync(p, s, 'utf8');
console.log('yunXuDuiHua fixed');
