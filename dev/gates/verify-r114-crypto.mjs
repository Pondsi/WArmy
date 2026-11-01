/**
 * verify-r114-crypto.mjs —— 第 114 轮：
 *   · 运行期静态加密（JSON / JSONL、错误 key、明文迁移、workspace 边界）
 *   · 外部编辑显式会话（不再 2 秒猜测改完；确认后开放，结束才回写）
 *   · 我的页三个数据入口；没有“定时导入”；旧群明确不迁移旧消息
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = path.join(root, 'packages/app-shell');
const require = createRequire(import.meta.url);
const encFs = require(path.join(pkg, 'dist/enc-fs.cjs'));
const {WaiBuBianJiGuanLiQi} = await import(pathToFileURL(path.join(pkg, 'dist/external-edit.js')).href);

let pass = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  pass += 1;
  console.log('PASS ' + name);
};
const rawRead = (p) => { const fd = fs.openSync(p, 'r'); try { const st = fs.fstatSync(fd); const b = Buffer.alloc(st.size); fs.readSync(fd, b, 0, b.length, 0); return b; } finally { try { fs.closeSync(fd); } catch { /* noop */ } } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r114-crypto-'));
try {
  encFs.install({root: dir});
  const key = Buffer.alloc(32, 0x5a);
  encFs.setKey(key);

  const settings = path.join(dir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({yuYan: 'zh-CN', secret: 'R114_PLAIN_SETTINGS'}));
  ok('JSON 写入磁盘后是密文（无明文哨兵）', rawRead(settings).subarray(0, 8).toString() === 'WARMYEF2' && !rawRead(settings).includes(Buffer.from('R114_PLAIN_SETTINGS')));
  ok('JSON 读取按 key 解密', JSON.parse(fs.readFileSync(settings, 'utf8')).secret === 'R114_PLAIN_SETTINGS');

  const jsonl = path.join(dir, 'memory', 'fast-memory.jsonl');
  fs.mkdirSync(path.dirname(jsonl), {recursive: true});
  fs.writeFileSync(jsonl, 'line1\n');
  fs.appendFileSync(jsonl, 'R114_JSONL_SENTINEL\n');
  const rawJsonl = rawRead(jsonl);
  ok('JSONL 逐记录加密追加（磁盘无明文）', rawJsonl.subarray(0, 8).toString() === 'WARMYEF2' && !rawJsonl.includes(Buffer.from('R114_JSONL_SENTINEL')));
  ok('JSONL 逻辑读取完整（line1 + 追加行）', fs.readFileSync(jsonl, 'utf8') === 'line1\nR114_JSONL_SENTINEL\n');
  ok('JSONL 逻辑大小按明文计算', fs.statSync(jsonl).size === Buffer.byteLength('line1\nR114_JSONL_SENTINEL\n'));

  const plain = path.join(dir, 'knowledge', 'knowledge-session.json');
  fs.mkdirSync(path.dirname(plain), {recursive: true});
  fs.writeFileSync(plain, '{"x":1}');
  // 上面 writeFileSync 已被包过；用原生写一份旧的明文再迁移
  const fd0 = fs.openSync(plain, 'w'); fs.writeSync(fd0, '{"legacy":true}'); fs.closeSync(fd0);
  ok('旧明文文件可被识别并迁移', encFs.migrateTree(dir) >= 1 && rawRead(plain).subarray(0, 8).toString() === 'WARMYEF2');

  const workspace = path.join(dir, 'workspace', 's1', 'a.txt');
  fs.mkdirSync(path.dirname(workspace), {recursive: true});
  fs.writeFileSync(workspace, '外部工具工作区');
  ok('workspace 保持明文（显式边界）', rawRead(workspace).toString('utf8') === '外部工具工作区');

  const encKey = Buffer.alloc(32, 0x11);
  encFs.setKey(encKey);
  let rejected = false;
  try { fs.readFileSync(settings, 'utf8'); } catch { rejected = true; }
  ok('换错 key 读取被拒绝（不是静默垃圾）', rejected);
  encFs.setKey(key);

  const lockedFile = path.join(dir, 'locked-settings.json');
  encFs.setKey(null);
  encFs.setWriteGuard(() => true);
  fs.writeFileSync(lockedFile, '{"should":"not-write"}');
  ok('已有仓库但未登录：受管文件写入被拒绝（不留明文）', !fs.existsSync(lockedFile));
  encFs.setWriteGuard(null);
  fs.writeFileSync(lockedFile, '{"first":"run"}');
  ok('首启无仓库：允许写引导配置', fs.existsSync(lockedFile));
  encFs.setKey(key);

  // ── 外部编辑：显式会话，不按文件稳定时间猜测 ──
  const wsRoot = path.join(dir, 'workspace');
  const manDir = path.join(dir, 'external-manifests');
  const editFile = path.join(wsRoot, 's1', 'doc.txt');
  fs.writeFileSync(editFile, '原始内容');
  const mgr = new WaiBuBianJiGuanLiQi({
    workspaceRoot: wsRoot, manifestDir: manDir,
    audit: () => {}, log: () => {},
  });
  const st = mgr.start(editFile);
  ok('外部编辑开始：生成明文副本', st.ok && !!st.temp && fs.existsSync(st.temp));
  fs.writeFileSync(st.temp, '外部改过的内容');
  await new Promise((r) => setTimeout(r, 2600));
  ok('等待 2.6 秒不会自动回写（删除启发式）', fs.readFileSync(editFile, 'utf8') === '原始内容' && mgr.list().some((x) => x.id === st.id && x.state === 'open'));
  const fin = mgr.finish(st.id);
  ok('显式结束后才回写并清理副本', fin.ok && fs.readFileSync(editFile, 'utf8') === '外部改过的内容' && !fs.existsSync(st.temp));
  const st2 = mgr.start(editFile);
  fs.writeFileSync(st2.temp, '不要这份');
  const dis = mgr.finish(st2.id, true);
  ok('放弃更改：原文件不动', dis.ok && fs.readFileSync(editFile, 'utf8') === '外部改过的内容');

  // ── 静态：入口/口径 ──
  const appJs = fs.readFileSync(path.join(pkg, 'src/renderer/app.js'), 'utf8');
  ok('我的页用户名下有导入/导出/定时导出三个入口',
    /id="anNiuDaoRuWo"/.test(appJs) && /id="anNiuDaoChuWo"/.test(appJs) && /id="anNiuDingShiDaoChuWo"/.test(appJs)
    && /woDataHang/.test(appJs));
  ok('设置→关于不再放这三个入口', !/id="anNiuDaoChuSheZhi"/.test(appJs) && !/id="anNiuDaoRuSheZhi"/.test(appJs) && !/id="anNiuDingShiDaoChu"/.test(appJs));
  ok('没有“定时导入”功能/文案', !/定时导入/.test(appJs) && !/dingShiDaoRu/.test(appJs) && !fs.readFileSync(path.join(pkg, 'src/electron-main.ts'), 'utf8').includes('dingShiDaoRu'));
  ok('旧群重建明确“旧消息不会迁入新群”', fs.readFileSync(path.join(pkg, 'src/i18n/zh-CN.json'), 'utf8').includes('旧消息不会迁入新群'));
  ok('外部编辑不再有 2 秒稳定定时器', !/stable\s*>=\s*2/.test(fs.readFileSync(path.join(pkg, 'src/external-edit.ts'), 'utf8')));

  console.log(`\nverify-r114-crypto: ${pass} PASS / 0 FAIL`);
} finally {
  try { fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 150}); } catch { /* noop */ }
}
