/**
 * 渲染层语法门禁：app.js 是手改的单文件大 JS，改坏了会让整个界面白屏。
 * 构建前跑一遍 `node --check`，坏了就立刻失败。
 *
 *   node scripts/check-syntax.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appjs = path.join(here, '..', 'src', 'renderer', 'app.js');

if (!existsSync(appjs)) {
  console.error('[check-syntax] app.js 不存在:', appjs);
  process.exit(1);
}

try {
  execFileSync(process.execPath, ['--check', appjs], { stdio: 'inherit' });
  console.log('[check-syntax] app.js 语法 OK');
} catch (e) {
  console.error('[check-syntax] app.js 语法错误，构建中止');
  process.exit(1);
}
