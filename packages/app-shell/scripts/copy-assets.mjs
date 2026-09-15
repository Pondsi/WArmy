import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'src');
const dist = path.join(root, '..', 'dist');

mkdirSync(path.join(dist, 'renderer'), { recursive: true });
mkdirSync(path.join(dist, 'i18n'), { recursive: true });

copyFileSync(path.join(src, 'preload.cjs'), path.join(dist, 'preload.cjs'));
for (const f of readdirSync(path.join(src, 'renderer'))) {
  copyFileSync(path.join(src, 'renderer', f), path.join(dist, 'renderer', f));
}
for (const f of readdirSync(path.join(src, 'i18n'))) {
  copyFileSync(path.join(src, 'i18n', f), path.join(dist, 'i18n', f));
}
console.log('app-shell assets copied (renderer + i18n)');
