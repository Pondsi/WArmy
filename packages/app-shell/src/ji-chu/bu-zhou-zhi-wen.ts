/**
 * R287 P5-1：计划步骤指纹纯函数唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · buZhouZhaiYao：内容 sha1 指纹（前 16 位）——判"这一步写过的内容是否相同"；
 *  · buZhouJian：路径键（Windows 不分大小写）——步骤文件键同口径；
 *  · buZhouNeiRongZhaiYao：生成器"内容"指纹（去掉路径字段，只看要写进去的东西）。
 * 零依赖纯函数（crypto＋平台），门禁可直接 import 跑断言（同 asr-jing-yin 范式）。
 */
import crypto from 'node:crypto';

export function buZhouZhaiYao(s: string): string {
  return crypto.createHash('sha1').update(String(s || ''), 'utf8').digest('hex').slice(0, 16);
}

/** 步骤文件键：Windows 不分大小写 */
export function buZhouJian(abs: string): string {
  const a = String(abs || '');
  return process.platform === 'win32' ? a.toLowerCase() : a;
}

/** 生成器的"内容"指纹：去掉路径字段，只看要写进去的东西 */
export function buZhouNeiRongZhaiYao(a: Record<string, unknown>): string {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(a || {}).sort()) {
    if (['path', 'file', 'filePath', 'filepath', 'filename', 'fileName', 'name', 'target', 'open', 'overwrite'].includes(k)) continue;
    o[k] = a[k];
  }
  let s = '';
  try { s = JSON.stringify(o); } catch { s = String(Object.keys(o)); }
  return buZhouZhaiYao(s);
}