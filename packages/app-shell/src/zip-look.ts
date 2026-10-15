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
import zlib from 'node:zlib';

export interface YaSuoBaoTiaoMu {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  isDirectory: boolean;
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
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    out.push({
      name,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      method,
      isDirectory: name.endsWith('/'),
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
