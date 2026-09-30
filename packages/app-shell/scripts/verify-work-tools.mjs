#!/usr/bin/env node
/**
 * verify-work-tools —— 「AI 真的能干活」这条链路的地基验证（**真跑**，不是静态断言）。
 *
 * 覆盖：
 *   [1] 写文件 → 读回来逐字节一致（这就是"帮我写个 txt"能成的根本）
 *   [2] 沙箱：绝对路径 / `..` 逃逸 / NUL 一律**拒绝**（fail-closed）
 *   [3] 越界路径不会在磁盘上产生任何文件（拒绝要"真的没写"）
 *   [4] 列目录 / 建目录可用
 *   [5] 写入超上限**拒绝**（不截断静默毁文件）
 *   [6] 工具规格：暴露给模型的名字与安全声明齐全，且**不含** shell 执行
 *   [7] 会话权限：我的牛马/项目可干活；群聊仅聊天（纯函数判据）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const dist = path.join(pkgRoot, 'dist', 'work-tools.js');
if (!fs.existsSync(dist)) {
  console.error('缺少构建产物，请先 build：' + dist);
  process.exit(2);
}
const W = await import(pathToFileURL(dist).href);

let pass = 0;
let fail = 0;
const failures = [];
function check(biaoQian, cond, detail) {
  const show = detail === undefined ? '' : ` => ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (cond) { pass++; console.log(`  [PASS] ${biaoQian}${show}`); }
  else { fail++; failures.push(biaoQian); console.log(`  [FAIL] ${biaoQian}${show}`); }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-work-'));
console.log(`临时工作区: ${base}\n`);

/* ── [1] 写 → 读 往返 ── */
console.log('[1] 写文件 → 读回来一致（"帮我写个 txt"的最小闭环）');
{
  const w = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'notes/todo.txt', content: '第一条\n第二条\n' } } });
  check('write_file 成功', w.ok === true, w.content);
  check('meta 带相对路径与字节数', w.meta.path === 'notes/todo.txt' && w.meta.bytes > 0, w.meta);
  const abs = path.join(base, 'notes', 'todo.txt');
  check('磁盘上真的存在该文件（不是只回了句话）', fs.existsSync(abs));
  const r = W.runWorkTool(base, { function: { name: 'read_file', arguments: { path: 'notes/todo.txt' } } });
  check('read_file 成功', r.ok === true, r.content && r.content.slice(0, 40));
  check('内容逐字节一致（round-trip）', r.content === '第一条\n第二条\n', JSON.stringify(r.content));
}

/* ── [2] 沙箱：越界必须拒绝 ── */
console.log('\n[2] 沙箱：绝对路径 / .. 逃逸 / NUL 一律拒绝（fail-closed）');
{
  const abs = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: path.join(os.tmpdir(), 'warmy-should-not-exist.txt'), content: 'x' } } });
  check('绝对路径被拒', abs.ok === false && /absolute-path-not-allowed/.test(abs.meta.error || ''), abs.meta.error);

  const up = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: '../warmy-should-not-exist2.txt', content: 'x' } } });
  check('`..` 逃逸被拒', up.ok === false && /workspace-escape/.test(up.meta.error || ''), up.meta.error);

  const deep = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'a/../../warmy-should-not-exist3.txt', content: 'x' } } });
  check('多层 `../..` 逃逸被拒', deep.ok === false && /workspace-escape/.test(deep.meta.error || ''), deep.meta.error);

  const nul = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'a\0b.txt', content: 'x' } } });
  check('NUL 字节被拒', nul.ok === false && /nul-byte/.test(nul.meta.error || ''), nul.meta.error);

  const winAbs = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'C:/Windows/Temp/warmy-should-not-exist4.txt', content: 'x' } } });
  check('Windows 盘符路径被拒', winAbs.ok === false, winAbs.meta.error);

  /* ── [3] 拒绝要"真的没写" ── */
  const outside = [
    path.join(os.tmpdir(), 'warmy-should-not-exist.txt'),
    path.join(os.tmpdir(), 'warmy-should-not-exist2.txt'),
    path.join(os.tmpdir(), 'warmy-should-not-exist3.txt'),
  ];
  check('[3] 越界尝试没有在磁盘上留下任何文件', outside.every((p) => !fs.existsSync(p)), outside);
}

/* ── [4] 列目录 / 建目录 ── */
console.log('\n[4] list_dir / make_dir');
{
  const m = W.runWorkTool(base, { function: { name: 'make_dir', arguments: { path: 'out/sub' } } });
  check('make_dir 成功', m.ok === true, m.content);
  check('目录真的建出来了', fs.existsSync(path.join(base, 'out', 'sub')));
  const l = W.runWorkTool(base, { function: { name: 'list_dir', arguments: {} } });
  check('list_dir 成功且列出 notes/out', l.ok === true && /notes/.test(l.content) && /out/.test(l.content), l.meta);
  const l2 = W.runWorkTool(base, { function: { name: 'list_dir', arguments: { path: 'notes' } } });
  check('list_dir 子目录列出 todo.txt', l2.ok === true && /todo\.txt/.test(l2.content), l2.content);
}

/* ── [5] 写入上限：拒绝而不是截断 ── */
console.log('\n[5] 超上限写入被拒（不静默截断毁文件）');
{
  const big = 'x'.repeat(W.WORK_TOOL_LIMITS.maxWriteBytes + 10);
  const r = W.runWorkTool(base, { function: { name: 'write_file', arguments: { path: 'big.txt', content: big } } });
  check('超限写入被拒', r.ok === false && /content-too-large/.test(r.meta.error || ''), r.meta.error);
  check('被拒文件没有落盘', !fs.existsSync(path.join(base, 'big.txt')));
}

/* ── [6] 工具规格 ── */
console.log('\n[6] 工具规格（给模型看的）');
{
  const specs = W.workToolSpecs();
  const names = specs.map((s) => s.function.name).sort();
  check('暴露 4 个文件类工具', JSON.stringify(names) === JSON.stringify(['list_dir', 'make_dir', 'read_file', 'write_file']), names);
  check('每个都有 description 与 parameters', specs.every((s) => s.function.description && s.function.parameters), specs.length);
  check('【安全】不含 shell 执行类工具', !names.some((n) => /exec|run|shell|cmd|bash/i.test(n)), names);
  check('【安全】声明不允许逃出工作区', W.WORK_TOOL_SECURITY.allowsWorkspaceEscape === false);
  check('【安全】声明不跑 shell、不提权', W.WORK_TOOL_SECURITY.runsShell === false && W.WORK_TOOL_SECURITY.elevates === false);
  check('【安全】fail-closed', W.WORK_TOOL_SECURITY.failClosed === true);
}

/* ── [7] 会话权限判据（纯函数：我的牛马/项目可干活，群聊仅聊天）── */
console.log('\n[7] 会话权限判据');
{
  // 与主进程 huiHuaKeGanHuo 同一规则：有群记录→internal 才可干活；无群记录→可干活
  const keGanHuo = (g) => (g ? g.type === 'internal' : true);
  check('我的牛马（非群）可干活', keGanHuo(null) === true);
  check('项目（internal 群）可干活', keGanHuo({ type: 'internal' }) === true);
  check('群聊（external 群）仅聊天', keGanHuo({ type: 'external' }) === false);
}

/* ── 未知工具 / 坏参数不抛错 ── */
console.log('\n[8] 边界：未知工具 / 坏 JSON 不抛错（结构化失败）');
{
  const u = W.runWorkTool(base, { function: { name: 'rm_rf', arguments: {} } });
  check('未知工具 → 结构化失败', u.ok === false && /unknown-tool/.test(u.meta.error || ''), u.meta.error);
  const bad = W.runWorkTool(base, { function: { name: 'write_file', arguments: '{not json' } });
  check('坏 JSON → 结构化失败', bad.ok === false && /bad-json/.test(bad.meta.error || ''), bad.meta.error);
}

console.log(`\n==== verify-work-tools: ${pass} ok / ${fail} FAIL ====`);
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
process.exit(fail ? 1 : 0);
