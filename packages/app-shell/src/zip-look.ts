/**
 * zip-look —— **看压缩包内部**（纯 JS，读 Central Directory，零依赖）。
 *
 * 为什么自己写而不是装库：产品要求「内置一个可以查看压缩包内部文件的工具」，
 * 而 yauzl/adm-zip 都是第三方依赖（要进供应链、要审）；读 zip 的**中央目录**本身
 * 就几十行字节解析，且我们只需要「列条目 / 读单个条目」，不需要解压到磁盘。
 *
 * 安全（zip slip / zip bomb，见 yauzl 的 validateFileName 思路）：
 *   · 条目名里出现 `..`、绝对路径、盘符 ⇒ **拒绝**（绝不把条目名当路径用）；
 *   · 单条目解压尺寸设上限（默认 32MB），超了如实报错，不 OOM。
 *
 * 只支持 **stored(0) / deflate(8)** —— zip 里 99% 都是这两种；其它压缩法如实说不支持。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface YaSuoBaoTiaoMu {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  isDirectory: boolean;
  /** 中央目录 flags：bit0 = 加密（传统 ZipCrypto / WinZip AES 都置位） */
  flags: number;
  /** 外部属性高 16 位（0xa000 = 符号链接） */
  mode: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** 找到 End of Central Directory（从尾部往前扫，最多 64KB + 注释） */
function zhaoEocd(buf: Buffer): number {
  const max = Math.min(buf.length, 66_000);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** 条目名安全检查（zip slip）：不允许 `..`、绝对路径、盘符 */
export function tiaoMuMingAnQuan(ming: string): boolean {
  const s = String(ming || '');
  if (!s) return false;
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(s)) return false;      // 盘符 / 绝对路径
  const bu = s.split(/[\\/]+/).filter(Boolean);
  return !bu.includes('..');
}

/** 列出压缩包内的条目 */
export function lieYaSuoBaoTiaoMu(buf: Buffer): YaSuoBaoTiaoMu[] {
  const e = zhaoEocd(buf);
  if (e < 0) throw new Error('not-a-zip（找不到 zip 的中央目录结尾）');
  const shu = buf.readUInt16LE(e + 10);          // total entries
  let p = buf.readUInt32LE(e + 16);              // central dir offset
  const out: YaSuoBaoTiaoMu[] = [];
  for (let i = 0; i < shu && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const flags = buf.readUInt16LE(p + 8);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    out.push({
      name,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      method,
      isDirectory: name.endsWith('/'),
      flags,
      mode: (extAttr >>> 16) & 0xffff,
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** 读单个条目的**原始字节**（已解压） */
export function duYaSuoBaoTiaoMu(buf: Buffer, ming: string, shangXian = 32 * 1024 * 1024): Buffer {
  if (!tiaoMuMingAnQuan(ming)) throw new Error(`zip-slip（条目名不安全：${String(ming).slice(0, 80)}）`);
  const e = zhaoEocd(buf);
  if (e < 0) throw new Error('not-a-zip');
  const shu = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < shu && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOf = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === ming) {
      const flags = buf.readUInt16LE(p + 8);
      if (flags & 1) throw new Error(`zip-encrypted（条目「${String(ming).slice(0, 60)}」是加密的：当前工具面不支持密码，无法读取/解压）`);
      if (uncompSize > shangXian) throw new Error(`zip-too-big（${uncompSize} 字节 > 上限 ${shangXian}）`);
      // Local File Header：30 字节固定 + 文件名 + 额外字段
      const lNameLen = buf.readUInt16LE(localOf + 26);
      const lExtraLen = buf.readUInt16LE(localOf + 28);
      const dataStart = localOf + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: shangXian });
      throw new Error(`zip-method-unsupported（压缩法 ${method}，只支持 stored(0)/deflate(8)）`);
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error(`not-found（压缩包里没有「${String(ming).slice(0, 80)}」）`);
}

/* ───────────── 整包解压到磁盘（零依赖，供工具面/验证脚本直接调用） ───────────── */

/** 单条目解压上限 / 一次解压总量上限（与 nm 查看器同一档，防止压缩炸弹） */
export const ZIP_JIEYA_TIAO_SHANGXIAN = 256 * 1024 * 1024;
export const ZIP_JIEYA_ZONG_SHANGXIAN = 512 * 1024 * 1024;

export interface JieYaTiaoGuo {
  ming: string;
  yuanYin: string;
}

/**
 * 整包解压到 `targetDir`。**绝不覆盖已有文件**（写入用 'wx'，撞名就跳过），
 * 加密 / 符号链接 / 超限 / 不支持压缩法的条目逐条跳过并列出原因；
 * 条目名先过 `tiaoMuMingAnQuan`，落点再在 targetDir 内二次校验（zip slip 双防线）。
 */
export function jieYaYaSuoBaoDao(
  buf: Buffer,
  targetDir: string
): { ok: boolean; xieRu: number; zong: number; tiaoGuo: JieYaTiaoGuo[]; error?: string } {
  try {
    const tiao = lieYaSuoBaoTiaoMu(buf);
    const gen = path.resolve(targetDir);
    const top = gen + path.sep;
    let xieRu = 0;
    let zong = 0;
    const tiaoGuo: JieYaTiaoGuo[] = [];
    for (const t of tiao) {
      if (t.isDirectory) continue;
      if (!tiaoMuMingAnQuan(t.name)) { tiaoGuo.push({ ming: t.name, yuanYin: '条目路径不安全（zip slip）：已拒绝' }); continue; }
      if ((t.mode & 0xf000) === 0xa000) { tiaoGuo.push({ ming: t.name, yuanYin: '符号链接条目：已跳过' }); continue; }
      if (t.flags & 1) { tiaoGuo.push({ ming: t.name, yuanYin: '加密条目（需要密码，当前工具面不支持）：已跳过' }); continue; }
      if (t.method !== 0 && t.method !== 8) { tiaoGuo.push({ ming: t.name, yuanYin: `压缩法 ${t.method} 不支持（只支持 stored/deflate）` }); continue; }
      if (t.uncompressedSize > ZIP_JIEYA_TIAO_SHANGXIAN) { tiaoGuo.push({ ming: t.name, yuanYin: '单文件超过解压上限（256MB）' }); continue; }
      if (zong + t.uncompressedSize > ZIP_JIEYA_ZONG_SHANGXIAN) { tiaoGuo.push({ ming: t.name, yuanYin: '本次解压总量超过上限（512MB）：已停止' }); break; }
      let shu: Buffer;
      try {
        shu = duYaSuoBaoTiaoMu(buf, t.name, ZIP_JIEYA_TIAO_SHANGXIAN);
      } catch (e) {
        tiaoGuo.push({ ming: t.name, yuanYin: String((e as Error)?.message || e).slice(0, 80) });
        continue;
      }
      const segs = t.name.replace(/\\/g, '/').split('/').filter(Boolean);
      const dest = path.resolve(gen, ...segs);
      if (!(dest === gen || dest.startsWith(top))) { tiaoGuo.push({ ming: t.name, yuanYin: '解压落点越界：已拒绝' }); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.writeFileSync(dest, shu, { flag: 'wx' });
        xieRu += 1;
        zong += shu.length;
      } catch (e2) {
        tiaoGuo.push({ ming: t.name, yuanYin: '写入失败（目标已存在或不可写）：' + String((e2 as Error)?.message || e2).slice(0, 60) });
      }
    }
    return { ok: true, xieRu, zong, tiaoGuo };
  } catch (e) {
    return { ok: false, xieRu: 0, zong: 0, tiaoGuo: [], error: String((e as Error)?.message || e).slice(0, 160) };
  }
}
