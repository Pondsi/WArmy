/**
 * R232/R294 本地生成后端按需安装器（(i) 路线）。
 * 不随安装包携带；用户点下载按钮才下载/安装；安装前必须校验固定版本+sha256+许可。
 * 没有已验证来源时如实返回 source-unverified，不伪造下载/安装成功。
 *
 * R294 修复（3D 创建无法使用的三个真因）：
 *  ① 清单补 config.yaml —— TSR.from_pretrained 必需，旧版只下权重 ⇒ 推理必失败；
 *  ② local-gen 划出加密层（enc-fs EXEMPT_DIRS）—— Python 子进程读不了 WARMYEF2 密文；
 *     旧版已落盘的密文权重/manifest 在首次查询时一次性迁移成明文（openBuffer 解密后原子重写）；
 *  ③ 断点续传 —— 已存在且 sha256 吻合的文件跳过下载（不再为补 config 重下 1.6GB）。
 * 下载流式落 tmp＋逐块哈希，校验通过才 rename（TOCTOU 防护不变，内存不再囤 1.6GB）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const encFs = requireCjs('./enc-fs.cjs') as { openBuffer: (b: Buffer) => Buffer; MAGIC: Buffer };

export interface BenDiShengChengQingDan {
  id: string;
  /** 落盘文件名（Python 子进程按此读） */
  file: string;
  version: string;
  url: string;
  sha256: string;
  license: string;
  verified: boolean;
}
/** 已验证来源清单（人工核验后登记）。
 * TripoSR：HF API（镜像同源对象库）核验固定 revision 的 LFS sha256；许可 MIT（image-to-3D）。
 * 权重约1.6GB＋config.yaml（987B）；仅用户点按钮才下载；安装前再算 sha256 防 TOCTOU。 */
export const YI_YAN_ZHENG_QING_DAN: BenDiShengChengQingDan[] = [
  {
    id: 'triposr',
    file: 'model.bin',
    version: '5b521936b01fbe1890f6f9baed0254ab6351c04a',
    url: 'https://hf-mirror.com/stabilityai/TripoSR/resolve/5b521936b01fbe1890f6f9baed0254ab6351c04a/model.ckpt',
    sha256: '429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee',
    license: 'MIT',
    verified: true,
  },
  {
    id: 'triposr-config',
    file: 'config.yaml',
    version: '5b521936b01fbe1890f6f9baed0254ab6351c04a',
    url: 'https://hf-mirror.com/stabilityai/TripoSR/resolve/5b521936b01fbe1890f6f9baed0254ab6351c04a/config.yaml',
    sha256: '74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62',
    license: 'MIT',
    verified: true,
  },
];

/** 一次性迁移：旧版加密层把权重/manifest 落成了密文，Python 读不了 ⇒ 解密回明文。
 *  密钥未就绪（未登录）时跳过——环境复检会如实报不可用，登录后再查询即迁移。 */
function qianYiMingWen(dir: string): void {
  for (const name of ['model.bin', 'manifest.json', 'config.yaml']) {
    const p = path.join(dir, name);
    try {
      if (!fs.existsSync(p)) continue;
      const fd = fs.openSync(p, 'r');
      const head = Buffer.alloc(8);
      const n = fs.readSync(fd, head, 0, 8, 0);
      fs.closeSync(fd);
      if (n < 8 || !head.equals(encFs.MAGIC)) continue;
      /* local-gen 已豁免 ⇒ readFileSync 拿到的是原始密文；openBuffer 按头解密 */
      const ming = encFs.openBuffer(fs.readFileSync(p));
      const tmp = p + '.plain';
      fs.writeFileSync(tmp, ming);
      fs.renameSync(tmp, p);
    } catch { /* 迁移失败保持原样，不伪造已安装 */ }
  }
}

export function chaXunBenDiShengCheng(root: string): { installed: boolean; version?: string; verified: boolean; reason?: string } {
  const dir = path.join(root, 'local-gen');
  try { qianYiMingWen(dir); } catch { /* noop */ }
  const meta = path.join(dir, 'manifest.json');
  try {
    const j = JSON.parse(fs.readFileSync(meta, 'utf8')) as { version?: string; sha256?: string };
    const hit = YI_YAN_ZHENG_QING_DAN.find((x) => x.id === 'triposr' && x.version === j.version && x.sha256 === j.sha256);
    if (!hit) return { installed: false, verified: false, reason: 'manifest-unverified' };
    /* R294：config.yaml 缺失＝装得不完整（旧版只下了权重）⇒ 报未安装，让下载按钮补齐 */
    if (!fs.existsSync(path.join(dir, 'config.yaml'))) return { installed: false, verified: true, reason: 'config-missing' };
    if (!fs.existsSync(path.join(dir, 'TripoSR', 'tsr', 'system.py'))) return { installed: false, verified: true, reason: 'src-missing' };
    return { installed: true, version: hit.version, verified: true };
  } catch {
    return { installed: false, verified: YI_YAN_ZHENG_QING_DAN.length > 0, reason: YI_YAN_ZHENG_QING_DAN.length ? 'not-installed' : 'source-unverified' };
  }
}

export async function anZhuangBenDiShengCheng(root: string, onProgress?: (p: number) => void): Promise<{ ok: boolean; error?: string; version?: string }> {
  const items = YI_YAN_ZHENG_QING_DAN.filter((x) => x.verified);
  const zhu = items.find((x) => x.id === 'triposr');
  if (!zhu || !items.length) return { ok: false, error: 'source-unverified' };
  const dir = path.join(root, 'local-gen');
  fs.mkdirSync(dir, { recursive: true });
  try { qianYiMingWen(dir); } catch { /* noop */ }
  let yiXia = 0;
  for (const item of items) {
    const target = path.join(dir, item.file);
    /* 断点续传：已有且 sha256 吻合 ⇒ 跳过（补 config 不必重下 1.6GB） */
    if (fs.existsSync(target)) {
      try {
        if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === item.sha256) continue;
      } catch { /* 读不了就重下 */ }
    }
    const r = await xiaZaiWenJian(item, target, onProgress, yiXia);
    if (!r.ok) return { ok: false, error: r.error };
    try { yiXia += fs.statSync(target).size; } catch { /* noop */ }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: zhu.version, sha256: zhu.sha256, license: zhu.license }, null, 2));
  return { ok: true, version: zhu.version };
}

/** R294：大文件下载——HTTP Range 断点续传＋自动重试（1.6GB 权重在抖动网络下必须能续）。
 *  流式落 tmp（不囤内存）；中断保留 tmp 下次续；完成后整文件 sha256 校验，过了才 rename（TOCTOU 防护）。 */
async function xiaZaiWenJian(item: BenDiShengChengQingDan, target: string, onProgress: ((p: number) => void) | undefined, yiXia: number): Promise<{ ok: boolean; error?: string }> {
  const tmp = target + '.tmp';
  for (let changShi = 0; changShi < 60; changShi++) {
    let pianYi = 0;
    try { pianYi = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0; } catch { pianYi = 0; }
    try {
      const headers: Record<string, string> = {};
      if (pianYi > 0) headers['Range'] = 'bytes=' + pianYi + '-';
      const res = await fetch(item.url, { headers });
      if (res.status === 200 && pianYi > 0) { pianYi = 0; try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ } }
      if (!res.ok && res.status !== 206) return { ok: false, error: 'download-failed: HTTP ' + res.status };
      if (!res.body) return { ok: false, error: 'download-failed: no-body' };
      const out = fs.createWriteStream(tmp, { flags: pianYi > 0 ? 'a' : 'w' });
      let n = pianYi;
      let zhongDuan = false;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const b = Buffer.from(value);
          n += b.length;
          if (!out.write(b)) await new Promise<void>((r) => out.once('drain', () => r()));
          onProgress?.(Math.min(99, Math.round(((yiXia + n) / 1.7e9) * 100)));
        }
        await new Promise<void>((r, j) => { out.end(() => r()); out.on('error', j); });
      } catch {
        zhongDuan = true;
        try { out.destroy(); } catch { /* noop */ }
      }
      if (zhongDuan) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      /* 下载完整 ⇒ 整文件哈希（流式读，不囤 1.6GB） */
      const hash = crypto.createHash('sha256');
      const fd = fs.openSync(tmp, 'r');
      const buf = Buffer.alloc(1 << 20);
      try {
        for (;;) {
          const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
          if (!bytesRead) break;
          hash.update(buf.subarray(0, bytesRead));
        }
      } finally { fs.closeSync(fd); }
      if (hash.digest('hex') !== item.sha256) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
        return { ok: false, error: 'sha256-mismatch' };
      }
      fs.renameSync(tmp, target);
      return { ok: true };
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
  }
  return { ok: false, error: 'download-failed: retries-exhausted' };
}

/**
 * R294：TripoSR 源码抓取（tsr 是研究仓库源码包，非 pip 包；按路径导入）。
 * 网络现状：api.github.com/codeload 被 404，raw.githubusercontent.com 可用 ⇒ 逐文件抓取，
 * 从 system.py/utils.py＋config.yaml 的类路径出发递归解析 tsr.* 导入；__init__.py 缺则补空。
 * 许可 MIT（随仓库 LICENSE）；失败如实返回，不伪造已安装。
 */
export async function anZhuangTripoSYuanMa(dir: string): Promise<{ ok: boolean; error?: string; files?: number }> {
  const RAW = 'https://raw.githubusercontent.com/VAST-AI-Research/TripoSR/main/';
  const tsrDir = path.join(dir, 'TripoSR');
  if (fs.existsSync(path.join(tsrDir, 'tsr', 'system.py'))) return { ok: true, files: 0 };
  const yiZhua = new Set<string>();
  const duiLie = ['tsr/system.py', 'tsr/utils.py'];
  /* config.yaml 里的动态类路径（omegaconf instantiate 不走 import，必须显式补） */
  try {
    const cfg = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    for (const m of cfg.matchAll(/tsr\.[\w.]+/g)) {
      duiLie.push('tsr/' + m[0].slice(4).replace(/\./g, '/') + '.py');
    }
  } catch { /* config 还没下就不补 */ }
  let n = 0;
  while (duiLie.length) {
    const rel = duiLie.shift()!;
    if (yiZhua.has(rel)) continue;
    yiZhua.add(rel);
    let wen: string | null = null;
    try { const r = await fetch(RAW + rel); wen = r.ok ? await r.text() : null; } catch { wen = null; }
    const mu = path.join(tsrDir, rel);
    fs.mkdirSync(path.dirname(mu), { recursive: true });
    if (wen === null) {
      if (rel.endsWith('__init__.py')) { fs.writeFileSync(mu, ''); continue; }
      return { ok: false, error: 'src-miss: ' + rel };
    }
    fs.writeFileSync(mu, wen);
    n += 1;
    for (const m of wen.matchAll(/(?:from|import)\s+tsr\.([\w.]+)/g)) {
      duiLie.push('tsr/' + m[1]!.replace(/\./g, '/') + '.py');
      duiLie.push('tsr/' + m[1]!.replace(/\./g, '/') + '/__init__.py');
    }
    const muLu = rel.split('/').slice(0, -1).join('/');
    for (const m of wen.matchAll(/from\s+(\.+)([\w.]*)\s+import/g)) {
      const shang = m[1]!.length - 1;
      const parts = muLu.split('/');
      const ji = parts.slice(0, Math.max(0, parts.length - shang)).join('/');
      const xia = m[2] ? m[2].replace(/\./g, '/') : '';
      const he = xia ? (ji ? ji + '/' + xia : xia) : ji;
      if (he) { duiLie.push(he + '.py'); duiLie.push(he + '/__init__.py'); }
    }
  }
  for (const init of ['tsr/__init__.py', 'tsr/models/__init__.py', 'tsr/models/tokenizers/__init__.py', 'tsr/models/transformer/__init__.py']) {
    const mu = path.join(tsrDir, init);
    if (!fs.existsSync(mu)) { fs.mkdirSync(path.dirname(mu), { recursive: true }); fs.writeFileSync(mu, ''); }
  }
  /* R294：X.py 与 X/__init__.py 并存时目录包会遮蔽模块 ⇒ 删只含空 __init__ 的遮蔽目录 */
  const qingLi = (dir: string): void => {
    let lie: fs.Dirent[];
    try { lie = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of lie) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      qingLi(p);
      const py = p + '.py';
      const init = path.join(p, '__init__.py');
      try {
        if (fs.existsSync(py) && fs.existsSync(init) && !fs.readFileSync(init, 'utf8').trim() && fs.readdirSync(p).length === 1) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch { /* noop */ }
    }
  };
  qingLi(tsrDir);
  /* R294：torchmcubes 需 C++ 编译，Windows 常装不上 ⇒ 随源码发 PyMCubes 兼容 shim（纯 Python，同接口） */
  const shim = path.join(tsrDir, 'torchmcubes.py');
  if (!fs.existsSync(shim)) {
    fs.writeFileSync(shim, [
      '# R294: torchmcubes compatibility shim via PyMCubes (pure Python, no C++ build).',
      'import numpy as np',
      'import torch',
      'from mcubes import marching_cubes as _mc_numpy',
      '',
      '',
      'def marching_cubes(level, threshold=0.0):',
      '    vol = level.detach().cpu().numpy() if isinstance(level, torch.Tensor) else np.asarray(level)',
      '    verts, faces = _mc_numpy(vol, threshold)',
      '    v = torch.from_numpy(np.ascontiguousarray(verts)).float()',
      '    f = torch.from_numpy(np.ascontiguousarray(faces)).long()',
      '    return v, f',
      '',
    ].join('\n'));
  }
  /* LICENSE 随源码保留（MIT 要求） */
  try { const r = await fetch(RAW + 'LICENSE'); if (r.ok) fs.writeFileSync(path.join(tsrDir, 'LICENSE'), await r.text()); } catch { /* 不挡安装 */ }
  if (!fs.existsSync(path.join(tsrDir, 'tsr', 'system.py'))) return { ok: false, error: 'src-incomplete' };
  return { ok: true, files: n };
}
