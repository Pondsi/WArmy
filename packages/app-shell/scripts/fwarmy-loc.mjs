/**
 * FWArmy 是独立项目，不在 WArmy 仓库内。
 * 默认同级目录 ../FWArmy；可用环境变量 FWARMY_DIR 指向别处。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const FWARMY_ROOT = process.env.FWARMY_DIR
  ? path.resolve(process.env.FWARMY_DIR)
  : path.resolve(ROOT, '..', 'FWArmy');

export const fwPath = (...p) => path.join(FWARMY_ROOT, ...p);
export const fwRead = (...p) => fs.readFileSync(fwPath(...p), 'utf8');
export const fwExists = (...p) => fs.existsSync(fwPath(...p));
