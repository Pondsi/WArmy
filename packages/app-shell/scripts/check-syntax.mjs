/**
 * 渲染层语法门禁：app.js 是手改的单文件大 JS，改坏了会让整个界面白屏。
 *
 * 检查两项：
 *   1) `node --check` —— 语法坏了立刻失败；
 *   2) 顶层 TDZ 探测 —— 在 `const t = ...` 定义**之前**调用 t(...)，语法是合法的，
 *      `node --check` 查不出来，但模块求值时会抛
 *      `ReferenceError: Cannot access 't' before initialization`，整个渲染进程起不来
 *      （rail 点击、设置面板全部失效，界面只剩一个空壳）。
 *
 *      这个坑真的踩过：把演示数据里的会话名换成 t('demo.xxx') 时，直接写在了
 *      模块顶层的对象字面量里，而 `const t` 在几十行之后才定义 —— 结果桌面端启动即崩。
 *      演示数据要存 i18n **键**，翻译放到渲染时做。
 *
 *   node scripts/check-syntax.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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

// ── 顶层 TDZ 探测 ──
const src = readFileSync(appjs, 'utf8');
const lines = src.split(/\r?\n/);
let tDefLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*const\s+t\s*=/.test(lines[i])) { tDefLine = i; break; }
}

if (tDefLine === -1) {
  console.error('[check-syntax] 找不到 `const t = ` 定义，无法做 TDZ 探测（渲染层结构可能被改动）');
  process.exit(1);
}

const CALL = /(?<![\w.$])t\(\s*['"`]/;
const offenders = [];
for (let i = 0; i < tDefLine; i++) {
  const raw = lines[i];
  const t = raw.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // 跳过注释
  if (CALL.test(raw)) offenders.push(i + 1);
}

if (offenders.length) {
  console.error('[check-syntax] 检测到在 `const t` 定义（第 ' + (tDefLine + 1) + ' 行）之前调用 t()，构建中止');
  console.error('               这些调用会在模块求值期抛 ReferenceError，导致整个界面起不来：');
  for (const n of offenders) console.error('               第 ' + n + ' 行: ' + lines[n - 1].trim().slice(0, 110));
  console.error('               演示数据请存 i18n 键字符串，翻译放到渲染时做。');
  process.exit(1);
}
console.log('[check-syntax] 顶层 TDZ 检查通过（t() 未在定义前调用）');
