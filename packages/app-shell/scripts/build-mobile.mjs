/**
 * 生成移动端「单文件」页面：把 mobile/{index.html,app.css,app.js}
 * 与语言包、头像、logo 全部内联到一个 html，直接双击就能在手机/浏览器打开。
 *
 *   node scripts/build-mobile.mjs --out "<输出目录>" [--name mobile-preview.html]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const mobileDir = path.join(pkg, 'mobile');
const iconsDir = path.join(pkg, 'src', 'renderer', 'icons');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const outDir = arg('--out', path.join(pkg, 'mobile-dist'));
const outName = arg('--name', 'mobile-preview.html');
fs.mkdirSync(outDir, { recursive: true });

// ── 语言包 ──
const i18nDir = path.join(pkg, 'src', 'i18n');
const all = {};
for (const f of fs.readdirSync(i18nDir)) {
  if (!f.endsWith('.json')) continue; // skip locales.ts and any non-pack files
  all[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8'));
}
const defaultLocale = all['zh-CN'] ? 'zh-CN' : Object.keys(all)[0];

// ── 头像 / logo 内联为 data URI ──
const dataUri = (p) => {
  const svg = fs.readFileSync(p, 'utf8');
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
};
const avatars = {};
const avDir = path.join(iconsDir, 'avatars');
if (fs.existsSync(avDir)) {
  for (const f of fs.readdirSync(avDir)) {
    const m = f.match(/^preset-(\d+)\.svg$/);
    if (m) avatars['preset-' + m[1]] = dataUri(path.join(avDir, f));
    const p = f.match(/^person-(\d+)\.svg$/);
    if (p) avatars['person-' + p[1]] = dataUri(path.join(avDir, f));
  }
}
let logo = null;
const logoSvg = path.join(iconsDir, 'logo-color.svg');
if (fs.existsSync(logoSvg)) logo = dataUri(logoSvg);

// ── 内联 ──
let html = fs.readFileSync(path.join(mobileDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(mobileDir, 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(mobileDir, 'app.js'), 'utf8');

const globals = [
  'window.__I18N__ = ' + JSON.stringify({ locale: defaultLocale, strings: all[defaultLocale] }) + ';',
  'window.__I18N_ALL__ = ' + JSON.stringify(all) + ';',
  'window.__AVATARS__ = ' + JSON.stringify(avatars) + ';',
  'window.__LOGO__ = ' + JSON.stringify(logo) + ';',
].join('\n');

html = html.replace(/<link rel="stylesheet" href="\.\/app\.css"\s*\/?>/, () => '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="\.\/app\.js"><\/script>/, () => '<script>\n' + globals + '\n' + js + '\n</script>');

fs.writeFileSync(path.join(outDir, outName), html, 'utf8');
console.log('  ' + outName + '  (' + Math.round(html.length / 1024) + ' KB, 单文件自包含)');
console.log('  内联：语言包 ' + Object.keys(all).length + ' 个 / 头像 ' + Object.keys(avatars).length + ' 个 / logo ' + (logo ? '有' : '无'));
console.log('移动端单文件 -> ' + path.join(outDir, outName));
