import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'src');
const dist = path.join(root, '..', 'dist');

mkdirSync(path.join(dist, 'renderer'), { recursive: true });
copyFileSync(path.join(src, 'preload.cjs'), path.join(dist, 'preload.cjs'));
copyFileSync(path.join(src, 'renderer', 'index.html'), path.join(dist, 'renderer', 'index.html'));
console.log('app-shell assets copied');
