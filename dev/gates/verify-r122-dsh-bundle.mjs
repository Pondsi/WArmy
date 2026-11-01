/**
 * R122-15 门禁：dsh 运行时随项目/安装包携带，且检测路径包含打包目录
 * 静态断言 + （若存在）对打包产物的真实存在性检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) { ok += 1; console.log('  ok ', name); }
  else { fails.push(name); console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); }
}

const yml = fs.readFileSync(path.join(ROOT, 'packages/app-shell/electron-builder.yml'), 'utf8');
jian('打包配置携带 dsh 依赖树', /warmy-dsh\/node_modules/.test(yml) && /spikes\/spike-05-plugins\/node_modules/.test(yml));

const main = fs.readFileSync(path.join(ROOT, 'packages/app-shell/src/electron-main.ts'), 'utf8');
jian('检测路径包含 resources/warmy-dsh', /process\.resourcesPath,\s*'warmy-dsh'/.test(main));
jian('检测路径包含项目 spikes 目录', /spike-05-plugins/.test(main));

const devDsh = path.join(ROOT, 'spikes/spike-05-plugins/node_modules/@deepseek-ai/dsh/package.json');
jian('开发态项目内存在 dsh 包', fs.existsSync(devDsh), devDsh);
if (fs.existsSync(devDsh)) {
  const v = JSON.parse(fs.readFileSync(devDsh, 'utf8')).version;
  jian('dsh 版本可读', typeof v === 'string' && v.length > 0, v);
}

const packaged = path.join(ROOT, 'release-r122/win-unpacked/resources/warmy-dsh/node_modules/@deepseek-ai/dsh/package.json');
if (fs.existsSync(packaged)) {
  const v = JSON.parse(fs.readFileSync(packaged, 'utf8')).version;
  jian('打包产物内 dsh 包存在且版本可读', typeof v === 'string' && v.length > 0, v);
} else {
  console.log('  note 打包产物未保留（release-r122 不存在）：只做静态断言');
}

console.log(`\n==== verify-r122-dsh-bundle: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
