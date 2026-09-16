import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'src');
const dist = path.join(root, '..', 'dist');

/** 递归复制目录（支持任意层级子目录，如 renderer/icons/avatars） */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

mkdirSync(path.join(dist, 'renderer'), { recursive: true });
mkdirSync(path.join(dist, 'i18n'), { recursive: true });

copyFileSync(path.join(src, 'preload.cjs'), path.join(dist, 'preload.cjs'));
copyDir(path.join(src, 'renderer'), path.join(dist, 'renderer'));
copyDir(path.join(src, 'i18n'), path.join(dist, 'i18n'));

console.log('app-shell assets copied (renderer + i18n, recursive)');
