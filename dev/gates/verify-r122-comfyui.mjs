/**
 * R122-4 门禁：ComfyUI 真实图像/视频生成（需要本机 ComfyUI 在跑）
 *
 * 这是**能力门禁**，不是每次 fast 都跑：没有 ComfyUI 时如实 BLOCKED（exit 2），
 * 不伪造 PASS。运行前：
 *   cd F:\ComfyUIZH\ComfyUI && ..\python_embeded\python.exe main.py --listen 127.0.0.1 --port 8188
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ok = 0;
const fails = [];
function jian(name, cond, detail) {
  if (cond) { ok += 1; console.log('  ok ', name); }
  else { fails.push(name); console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); }
}

const { ComfyUiKeHu } = await import(pathToFileURL(path.join(GEN, 'packages/providers/dist/comfyui.js')).href);
const baseUrl = process.env.WARMY_COMFYUI_URL || 'http://127.0.0.1:8188';
const cli = new ComfyUiKeHu({ baseUrl, imageTimeoutMs: 180_000, videoTimeoutMs: 420_000, pollMs: 800 });

const zt = await cli.zhuangTai();
if (!zt.ok) {
  console.log(`BLOCKED: ComfyUI 不可达（${baseUrl}）：${zt.error}`);
  console.log('启动：cd F:\\ComfyUIZH\\ComfyUI && ..\\python_embeded\\python.exe main.py --listen 127.0.0.1 --port 8188');
  process.exit(2);
}
jian(`ComfyUI 可达（版本 ${zt.version || 'unknown'}）`, true);

const lie = await cli.lieCheckpoint();
jian('读到图像 checkpoint', lie.image.length > 0, lie.all.slice(0, 6));
jian('读到 SVD 视频 checkpoint', lie.svd.length > 0, lie.all.slice(0, 6));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-r122-comfy-'));
try {
  const tu = await cli.shengTu({ prompt: 'a red apple on a wooden table, soft daylight, photo', width: 256, height: 256, steps: 8, seed: 122, muBiaoMulu: dir });
  jian('真实文生图成功', tu.ok === true, tu);
  if (tu.ok && tu.filePath) {
    const b = fs.readFileSync(tu.filePath);
    jian('产物是 PNG 且尺寸符合', b.subarray(0, 4).toString('hex') === '89504e47' && tu.width === 256 && tu.height === 256, { w: tu.width, h: tu.height, bytes: b.length });
  }

  const shi = await cli.shengShiPin({ prompt: 'a red apple on a wooden table', width: 256, height: 256, frames: 8, fps: 6, muBiaoMulu: dir });
  jian('真实图生视频成功', shi.ok === true, shi);
  if (shi.ok && shi.filePath) {
    const b = fs.readFileSync(shi.filePath);
    jian('产物是 WebM 容器', b.subarray(0, 4).toString('hex') === '1a45dfa3', b.subarray(0, 4).toString('hex'));
    jian('视频字节数 > 5KB（不是空壳）', b.length > 5000, b.length);
  }

  // 负向：服务不可达时必须如实失败，不能假装成功
  const bad = new ComfyUiKeHu({ baseUrl: 'http://127.0.0.1:9', imageTimeoutMs: 3000 });
  const jia = await bad.shengTu({ prompt: 'x', muBiaoMulu: dir });
  jian('服务不可达 ⇒ 如实失败（不伪造产物）', jia.ok === false && !!jia.error, jia);

  // 负向：取消信号
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const qu = await cli.shengTu({ prompt: 'a cat', width: 512, height: 512, steps: 20, muBiaoMulu: dir, signal: ac.signal });
  jian('取消后返回 aborted（不挂死）', qu.ok === false && /aborted|timeout/.test(String(qu.error)), qu);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n==== verify-r122-comfyui: ${ok} ok / ${fails.length} FAIL ====`);
if (fails.length) process.exit(1);
