/**
 * nm 网页下载的文件名/落盘路径（第 120 轮 W10）。
 * 抽成纯函数（只依赖 path/fs）是为了能脱机断言：
 *   · 远端文件名不能带路径逃出下载目录；
 *   · Windows 非法字符/控制字符要替换；
 *   · 同名文件不能覆盖，自动加 (1)(2)…
 */
import fs from 'node:fs';
import path from 'node:path';

export function nmAnQuanXiaZaiMing(ming: string): string {
  const base = path.basename(String(ming || 'download'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (base || 'download').slice(0, 180);
}

export function nmWeiYiLuJing(dir: string, ming: string): string {
  const ext = path.extname(ming);
  const stem = ming.slice(0, ming.length - ext.length);
  let p = path.join(dir, ming);
  for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}
