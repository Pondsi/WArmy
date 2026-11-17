/**
 * R232 本地生成后端按需安装器（(i) 路线）。
 * 不随安装包携带；用户点下载按钮才下载/安装；安装前必须校验固定版本+sha256+许可。
 * 没有已验证来源时如实返回 source-unverified，不伪造下载/安装成功。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface BenDiShengChengQingDan {
  id: string;
  version: string;
  url: string;
  sha256: string;
  license: string;
  verified: boolean;
}
/** 已验证来源清单（人工核验后登记）。
 * TripoSR：HF API（镜像同源对象库）核验 model.ckpt LFS sha256 与固定 revision；许可 MIT（image-to-3D）。
 * 下载约1.6GB，仅用户点按钮才下载；安装前再算 sha256 防 TOCTOU。 */
export const YI_YAN_ZHENG_QING_DAN: BenDiShengChengQingDan[] = [
  {
    id: 'triposr',
    version: '5b521936b01fbe1890f6f9baed0254ab6351c04a',
    url: 'https://hf-mirror.com/stabilityai/TripoSR/resolve/5b521936b01fbe1890f6f9baed0254ab6351c04a/model.ckpt',
    sha256: '429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee',
    license: 'MIT',
    verified: true,
  },
];

export function chaXunBenDiShengCheng(root: string): { installed: boolean; version?: string; verified: boolean; reason?: string } {
  const dir = path.join(root, 'local-gen');
  const meta = path.join(dir, 'manifest.json');
  try {
    const j = JSON.parse(fs.readFileSync(meta, 'utf8')) as { version?: string; sha256?: string };
    const hit = YI_YAN_ZHENG_QING_DAN.find((x) => x.version === j.version && x.sha256 === j.sha256);
    if (!hit) return { installed: false, verified: false, reason: 'manifest-unverified' };
    return { installed: true, version: hit.version, verified: true };
  } catch {
    return { installed: false, verified: YI_YAN_ZHENG_QING_DAN.length > 0, reason: YI_YAN_ZHENG_QING_DAN.length ? 'not-installed' : 'source-unverified' };
  }
}

export async function anZhuangBenDiShengCheng(root: string, onProgress?: (p: number) => void): Promise<{ ok: boolean; error?: string; version?: string }> {
  const item = YI_YAN_ZHENG_QING_DAN[0];
  if (!item || !item.verified) return { ok: false, error: 'source-unverified' };
  const dir = path.join(root, 'local-gen');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'download.tmp');
  const res = await fetch(item.url);
  if (!res.ok || !res.body) return { ok: false, error: 'download-failed' };
  const hash = crypto.createHash('sha256');
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value); chunks.push(b); total += b.length; hash.update(b);
    onProgress?.(Math.min(99, Math.round(total / 1e6)));
  }
  if (hash.digest('hex') !== item.sha256) { try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ } return { ok: false, error: 'sha256-mismatch' }; }
  fs.writeFileSync(tmp, Buffer.concat(chunks));
  fs.renameSync(tmp, path.join(dir, 'model.bin'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: item.version, sha256: item.sha256, license: item.license }, null, 2));
  return { ok: true, version: item.version };
}
