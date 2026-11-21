/** 渲染构建的唯一入口：保留旧脚本名、经典 IIFE、加载时机及显式 window 接口。
 * 只使用构建期 esbuild；不压缩、不摇树，不向 renderer 注入 Node 能力。
 * 所有产物先在内存中检查，再写入 dist；模块 import 本身没有构建副作用。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const baoGen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ruKou = ['app.js', 'nm-viewer.js'];

export async function gouJianXuanRan(gen = baoGen) {
  const shuChu = path.join(gen, 'dist', 'renderer');
  const jieGuo = await build({
    absWorkingDir: gen,
    entryPoints: ruKou.map((ming) => path.join('src', 'renderer', ming)),
    outdir: shuChu,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    charset: 'utf8',
    minify: false,
    treeShaking: false,
    keepNames: true,
    legalComments: 'inline',
    sourcemap: false,
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  if (jieGuo.errors.length || jieGuo.warnings.length) {
    throw new Error('renderer-build: ' + [...jieGuo.errors, ...jieGuo.warnings].map((x) => x.text).join('; '));
  }
  if (jieGuo.outputFiles.length !== ruKou.length) throw new Error('renderer-build: unexpected output count');
  for (const [ming, yuan] of Object.entries(jieGuo.metafile.outputs)) {
    if (yuan.imports.length) throw new Error('renderer-build: unresolved runtime import in ' + ming);
  }
  for (const wenJian of jieGuo.outputFiles) {
    if (!ruKou.some((ming) => path.resolve(wenJian.path) === path.join(shuChu, ming))) throw new Error('renderer-build: unexpected output path');
    new Script(wenJian.text, { filename: path.basename(wenJian.path) });
  }
  mkdirSync(shuChu, { recursive: true });
  for (const wenJian of jieGuo.outputFiles) writeFileSync(wenJian.path, wenJian.contents);
  return { ruKou: [...ruKou], shuRu: Object.keys(jieGuo.metafile.inputs), ziJie: jieGuo.outputFiles.map((x) => ({ ming: path.basename(x.path), bytes: x.contents.length })) };
}
