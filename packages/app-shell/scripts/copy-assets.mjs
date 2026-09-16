import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..', 'src');
const dist = path.join(root, '..', 'dist');

mkdirSync(path.join(dist, 'renderer'), { recursive: true });
mkdirSync(path.join(dist, 'i18n'), { recursive: true });

copyFileSync(path.join(src, 'preload.cjs'), path.join(dist, 'preload.cjs'));

// 拷贝 renderer 下的文件（不含子目录）
for (const f of readdirSync(path.join(src, 'renderer'), { withFileTypes: true })) {
  if (f.isFile()) {
    copyFileSync(path.join(src, 'renderer', f.name), path.join(dist, 'renderer', f.name));
  } else if (f.isDirectory()) {
    // 拷贝子目录（如 icons）
    const srcDir = path.join(src, 'renderer', f.name);
    const destDir = path.join(dist, 'renderer', f.name);
    mkdirSync(destDir, { recursive: true });
    for (const sub of readdirSync(srcDir)) {
      copyFileSync(path.join(srcDir, sub), path.join(destDir, sub));
    }
  }
}

for (const f of readdirSync(path.join(src, 'i18n'))) {
  copyFileSync(path.join(src, 'i18n', f), path.join(dist, 'i18n', f));
}
console.log('app-shell assets copied (renderer + i18n)');
