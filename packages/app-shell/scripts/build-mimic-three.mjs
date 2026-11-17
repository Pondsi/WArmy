// R232：复现 three + VRM 浏览器包，并随包保留依赖许可。仅构建时运行，无 CDN。
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const req = createRequire(import.meta.url);
const out = path.join(pkg, 'src/renderer/vendor/three.bundle.min.js');
await build({ entryPoints: [path.join(here, 'mimic-three-entry.mjs')], outfile: out,
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'chrome120', legalComments: 'inline' });
const licenses = [];
for (const name of ['three', '@pixiv/three-vrm']) {
  const root = path.dirname(path.dirname(req.resolve(name)));
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  licenses.push(`${name} ${meta.version}\n${license}`);
}
fs.writeFileSync(path.join(pkg, 'src/renderer/vendor/three-vrm-LICENSE.txt'), licenses.join('\n\n'));
console.log('MIMIC_THREE_VRM_BUNDLE_OK bytes=' + fs.statSync(out).size);
