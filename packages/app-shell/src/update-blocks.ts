/**
 * 增量更新（delta）的分块账与装配 —— R162 / D3-C。
 *
 * ── 为什么是「内容定义分块」而不是固定分块（本轮实测教训，别再改回去）──
 * 第一版用固定 64 KiB 分块，合成数据上门禁全绿，但拿**真实产物** 0.4.8 → 0.4.9 一测：
 *   可复用块 0 / 3582，需下载 100%。
 * 真因：NSIS 安装包是「头部 + 顺序档案」。安装器脚本/版本号一变，头部长度就变，
 * 后面**所有**文件数据整体位移几十个字节 ⇒ 固定块边界全部错位 ⇒ 一块都对不上。
 * 内容定义分块（CDC，gear-hash 滚动）的边界由**内容**决定，位移只影响插入点附近
 * 的一两块，其余照样命中。electron-builder 自带的 `.blockmap` 用的也是 CDC
 * （实测块长 225 B ~ 32 KiB 不等），正是这个原因。
 *
 * ── 为什么不直接用 electron-builder 的 .blockmap ──
 * 那份账由 app-builder 二进制生成，参数与 gear 表不在本仓，本机无法用同一算法
 * 重算「旧安装包」的账。这里自带一份**两侧共用同一实现**的 CDC，旧账在本机算，
 * 不需要额外下载旧账。
 *
 * ── 安全口径（与 updater.ts 一致，绝不放宽）──
 *   · 装配产物必须通过**整文件 sha256 + size** 校验，任何不符一律丢弃半成品；
 *   · 增量只是「少下载一些字节」，不是「少校验一次」；
 *   · 块哈希命中只决定「从哪儿搬」，搬错了整文件哈希会立刻抓住；
 *   · 服务端不支持 Range（回 200 而不是 206）⇒ 立刻判失败，由调用方退回整包下载。
 *
 * 本模块不依赖 electron，可直接用 node 跑门禁。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

/** 账本格式版本：换了算法/参数必须换版本号，否则新旧账会被误比对 */
export const KUAI_ZHANG_BAN_BEN = 'warmy-2';
/** CDC 参数：最小 2 KiB、平均 16 KiB（掩码 14 位）、最大 64 KiB */
export const CDC_MIN = 2048;
export const CDC_MASK = 0x3fff;
export const CDC_MAX = 65536;
/** 兼容旧调用方的名字（第一版的固定块大小常量；现在等于 CDC 上限） */
export const KUAI_DA_XIAO = CDC_MAX;
/** 账本解压后的体积上限（防被超大响应拖死） */
const ZHANG_MAX_BYTES = 32 * 1024 * 1024;
/** 流式读窗大小 */
const CHUANG = 4 * 1024 * 1024;

/**
 * gear 表：固定种子的确定性 PRNG 生成，**两侧必须逐字节一致**。
 * 不用 Math.random（不可复现），也不读外部文件（产物里没有）。
 */
const GEAR = (() => {
  let s = 0x9e3779b9 >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0);
  };
  const biao = new Uint32Array(256);
  for (let i = 0; i < 256; i++) biao[i] = next();
  return biao;
})();

export interface Kuai {
  /** 在文件里的起始偏移 */
  offset: number;
  /** 块长 */
  len: number;
  /** 块内容 sha256（hex 小写） */
  hash: string;
}

export interface KuaiZhao {
  version: string;
  /** CDC 参数（两侧必须一致，否则不许比对） */
  cdc: { min: number; mask: number; max: number };
  /** 整文件字节数 */
  size: number;
  /** 整文件 sha256（hex，小写） */
  sha256: string;
  /** 按偏移升序的块表 */
  kuai: Kuai[];
}

export interface ZengLiangJiHua {
  blocksTotal: number;
  blocksReused: number;
  bytesTotal: number;
  bytesReused: number;
  bytesDownload: number;
  /** 需要向服务端要的字节区间（闭区间，已合并相邻块） */
  ranges: Array<{ start: number; end: number }>;
  /** 可以从旧包搬的段：from 是旧包偏移，to 是新包偏移（CDC 下二者通常不同） */
  copies: Array<{ from: number; to: number; len: number }>;
}

/**
 * 内容定义分块（对一整块内存）：gear-hash 滚动，
 * `(hash & MASK) === 0` 且已达最小长度就切；到最大长度强制切。
 * 门禁与「从 Buffer 算账」用它；流式文件版见 suanKuaiZhao。
 */
export function qieKuai(buf: Buffer, min: number = CDC_MIN, mask: number = CDC_MASK, max: number = CDC_MAX): Array<{ offset: number; len: number }> {
  const out: Array<{ offset: number; len: number }> = [];
  const n = buf.length;
  let qi = 0;
  let hash = 0;
  for (let i = 0; i < n; i++) {
    hash = ((hash << 1) + (GEAR[buf[i] as number] as number)) >>> 0;
    const chang = i - qi + 1;
    if ((chang >= min && (hash & mask) === 0) || chang >= max) {
      out.push({ offset: qi, len: chang });
      qi = i + 1;
      hash = 0;
    }
  }
  if (qi < n) out.push({ offset: qi, len: n - qi });
  return out;
}

/** 从内存 Buffer 算账（门禁用；与流式版同一算法） */
export function suanKuaiZhaoBuffer(buf: Buffer): KuaiZhao {
  const zheng = crypto.createHash('sha256');
  zheng.update(buf);
  const kuai: Kuai[] = qieKuai(buf).map((k) => ({
    offset: k.offset,
    len: k.len,
    hash: crypto.createHash('sha256').update(buf.subarray(k.offset, k.offset + k.len)).digest('hex'),
  }));
  return {
    version: KUAI_ZHANG_BAN_BEN,
    cdc: { min: CDC_MIN, mask: CDC_MASK, max: CDC_MAX },
    size: buf.length,
    sha256: zheng.digest('hex'),
    kuai,
  };
}

/**
 * 流式算整文件 + 每块的 sha256（单遍状态机，内存只占一个读窗 + 一个跨窗块）。
 *
 * 块可能跨读窗，所以维护：
 *   · `hash`/`kuaiChang`：滚动状态，跨窗不清零；
 *   · `qianZhui`：上一窗留下的、属于当前未结算块的字节（≤ CDC_MAX）；
 *   · 切块时才把「前缀 + 本窗片段」拼起来算哈希（拼接总量 = 文件大小，无额外放大）。
 */
export function suanKuaiZhao(file: string): KuaiZhao {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('not a file');
  const fd = fs.openSync(file, 'r');
  const zheng = crypto.createHash('sha256');
  const kuai: Kuai[] = [];
  const chuang = Buffer.alloc(CHUANG);
  let qianZhui: Buffer = Buffer.alloc(0);
  let hash = 0;
  let kuaiChang = 0;
  let wenJianWei = 0;
  /** 结算一个块：qianZhui + chuang[segQi..segMo)；absEnd 是该块末尾的**文件绝对偏移** */
  const jieSuan = (segQi: number, segMo: number, absEnd: number) => {
    const pian = qianZhui.length
      ? Buffer.concat([qianZhui, chuang.subarray(segQi, segMo)])
      : chuang.subarray(segQi, segMo);
    if (pian.length !== kuaiChang) throw new Error(`chunk length mismatch: ${pian.length} != ${kuaiChang}`);
    kuai.push({ offset: absEnd - kuaiChang, len: kuaiChang, hash: crypto.createHash('sha256').update(pian).digest('hex') });
    qianZhui = Buffer.alloc(0);
    hash = 0;
    kuaiChang = 0;
  };
  try {
    for (;;) {
      const du = fs.readSync(fd, chuang, 0, CHUANG, null);
      if (du <= 0) break;
      zheng.update(chuang.subarray(0, du));
      let segQi = 0;
      for (let i = 0; i < du; i++) {
        hash = ((hash << 1) + (GEAR[chuang[i] as number] as number)) >>> 0;
        kuaiChang++;
        if ((kuaiChang >= CDC_MIN && (hash & CDC_MASK) === 0) || kuaiChang >= CDC_MAX) {
          jieSuan(segQi, i + 1, wenJianWei + i + 1);
          segQi = i + 1;
        }
      }
      wenJianWei += du;
      // 未结算的尾巴留到下一窗（块可能跨界）；必须**接在**旧前缀后面，不能覆盖
      if (segQi < du) qianZhui = Buffer.concat([qianZhui, chuang.subarray(segQi, du)]);
      if (wenJianWei >= stat.size) break;
    }
    if (kuaiChang > 0) {
      // 文件末尾的残块：qianZhui 就是它的全部字节
      kuai.push({ offset: wenJianWei - kuaiChang, len: kuaiChang, hash: crypto.createHash('sha256').update(qianZhui).digest('hex') });
    }
  } finally {
    fs.closeSync(fd);
  }
  const zongChang = kuai.reduce((a, k) => a + k.len, 0);
  if (zongChang !== stat.size) throw new Error(`chunking did not cover the file: ${zongChang} != ${stat.size}`);
  for (let i = 1; i < kuai.length; i++) {
    const a = kuai[i]!; const b = kuai[i - 1]!;
    if (a.offset !== b.offset + b.len) throw new Error('chunk offsets are not contiguous');
  }
  return {
    version: KUAI_ZHANG_BAN_BEN,
    cdc: { min: CDC_MIN, mask: CDC_MASK, max: CDC_MAX },
    size: stat.size,
    sha256: zheng.digest('hex'),
    kuai,
  };
}

/** 账本落盘形态：gzip(JSON) */
export function bianMaKuaiZhao(zhao: KuaiZhao): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(zhao), 'utf8'), { level: 9 });
}

/** 解账本：gzip 或裸 JSON 都认；任何字段不合法都给出机器可读原因，不抛。 */
export function jieMaKuaiZhao(raw: Buffer): { ok: true; zhao: KuaiZhao } | { ok: false; reason: string } {
  if (!Buffer.isBuffer(raw) || raw.length === 0) return { ok: false, reason: 'empty' };
  let txt: string;
  try {
    txt = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b
      ? zlib.gunzipSync(raw).toString('utf8')
      : raw.toString('utf8');
  } catch {
    return { ok: false, reason: 'bad-gzip' };
  }
  if (txt.length > ZHANG_MAX_BYTES) return { ok: false, reason: 'too-large' };
  let j: unknown;
  try { j = JSON.parse(txt); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, reason: 'not-an-object' };
  const o = j as Record<string, unknown>;
  if (o['version'] !== KUAI_ZHANG_BAN_BEN) return { ok: false, reason: 'bad-version' };
  const cdc = o['cdc'] as Record<string, unknown> | undefined;
  if (!cdc || typeof cdc !== 'object') return { ok: false, reason: 'bad-cdc' };
  for (const k of ['min', 'mask', 'max']) {
    if (typeof cdc[k] !== 'number' || !Number.isInteger(cdc[k]) || (cdc[k] as number) < 0) return { ok: false, reason: 'bad-cdc' };
  }
  const size = o['size'];
  const sha = o['sha256'];
  const ks = o['kuai'];
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return { ok: false, reason: 'bad-size' };
  if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) return { ok: false, reason: 'bad-checksum' };
  if (!Array.isArray(ks) || ks.length === 0) return { ok: false, reason: 'bad-blocks' };
  let fuGai = 0;
  const kuai: Kuai[] = [];
  for (const it of ks) {
    if (!it || typeof it !== 'object') return { ok: false, reason: 'bad-block' };
    const b = it as Record<string, unknown>;
    const off = b['offset']; const len = b['len']; const h = b['hash'];
    if (typeof off !== 'number' || !Number.isInteger(off) || off < 0) return { ok: false, reason: 'bad-block-offset' };
    if (typeof len !== 'number' || !Number.isInteger(len) || len <= 0) return { ok: false, reason: 'bad-block-len' };
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return { ok: false, reason: 'bad-block-checksum' };
    if (off !== fuGai) return { ok: false, reason: 'block-gap' };
    fuGai += len;
    kuai.push({ offset: off, len, hash: h });
  }
  if (fuGai !== size) return { ok: false, reason: 'block-count-mismatch' };
  return {
    ok: true,
    zhao: {
      version: KUAI_ZHANG_BAN_BEN,
      cdc: { min: cdc['min'] as number, mask: cdc['mask'] as number, max: cdc['max'] as number },
      size,
      sha256: sha,
      kuai,
    },
  };
}

/**
 * 规划增量：按**块哈希在旧包里找**（不是按索引比），所以整体位移/重排都能命中。
 * 两侧 CDC 参数或格式版本不一致 ⇒ 返回 null，调用方退回整包下载。
 */
export function guiHuaZengLiang(jiu: KuaiZhao, xin: KuaiZhao): ZengLiangJiHua | null {
  if (!jiu || !xin) return null;
  if (jiu.version !== xin.version) return null;
  if (!jiu.cdc || !xin.cdc) return null;
  if (jiu.cdc.min !== xin.cdc.min || jiu.cdc.mask !== xin.cdc.mask || jiu.cdc.max !== xin.cdc.max) return null;
  if (!Array.isArray(jiu.kuai) || !Array.isArray(xin.kuai) || xin.kuai.length === 0) return null;
  /** 旧包：哈希 → 偏移（同哈希多块时取第一个；整文件校验兜底） */
  const suoYin = new Map<string, number>();
  for (const k of jiu.kuai) if (!suoYin.has(k.hash)) suoYin.set(k.hash, k.offset);
  const ranges: Array<{ start: number; end: number }> = [];
  const copies: Array<{ from: number; to: number; len: number }> = [];
  let blocksReused = 0;
  let bytesReused = 0;
  let i = 0;
  const n = xin.kuai.length;
  while (i < n) {
    const k = xin.kuai[i];
    if (!k) break;
    const jiuWei = suoYin.get(k.hash);
    if (jiuWei !== undefined && jiuWei + k.len <= jiu.size) {
      // 尽量把「新包连续 + 旧包也连续」的块合并成一次搬运
      let j = i;
      let cong = jiuWei;
      let chang = 0;
      while (j < n) {
        const k2 = xin.kuai[j];
        if (!k2) break;
        const w = suoYin.get(k2.hash);
        if (w === undefined || w !== cong || w + k2.len > jiu.size) break;
        chang += k2.len;
        cong += k2.len;
        j++;
      }
      copies.push({ from: jiuWei, to: k.offset, len: chang });
      blocksReused += j - i;
      bytesReused += chang;
      i = j;
    } else {
      let j = i;
      let xia = 0;
      while (j < n) {
        const k2 = xin.kuai[j];
        if (!k2) break;
        const w = suoYin.get(k2.hash);
        if (w !== undefined && w + k2.len <= jiu.size) break;
        xia += k2.len;
        j++;
      }
      ranges.push({ start: k.offset, end: k.offset + xia - 1 });
      i = j;
    }
  }
  return {
    blocksTotal: n,
    blocksReused,
    bytesTotal: xin.size,
    bytesReused,
    bytesDownload: xin.size - bytesReused,
    ranges,
    copies,
  };
}

/** 把计划摊成按**目标偏移**升序的操作序列（装配时顺序写，顺便顺序算整文件哈希） */
export function tanPingJiHua(ji: ZengLiangJiHua): Array<{ kind: 'copy' | 'download'; start: number; len: number; from?: number }> {
  const ops: Array<{ kind: 'copy' | 'download'; start: number; len: number; from?: number }> = [];
  for (const c of ji.copies) ops.push({ kind: 'copy', start: c.to, len: c.len, from: c.from });
  for (const r of ji.ranges) ops.push({ kind: 'download', start: r.start, len: r.end - r.start + 1 });
  ops.sort((a, b) => a.start - b.start);
  return ops;
}

export interface ZhuangPeiXuanxiang {
  /** 旧安装包（本机基准） */
  jiuWenJian: string;
  /** 输出路径（调用方给 .part，校验通过后自己 rename） */
  shuChu: string;
  xin: KuaiZhao;
  ji: ZengLiangJiHua;
  /** 取一段字节（闭区间）。实现方必须校验服务端真的回了 206 且长度正确。 */
  quQuJian: (start: number, end: number) => Promise<Buffer>;
  onProgress?: (yiXie: number, zong: number) => void;
}

/**
 * 装配增量包：顺序写 + 顺序算 sha256，最后与账本里的整文件哈希/大小比对。
 * 任何一步失败都删掉半成品并如实返回原因（绝不返回「看起来成功」）。
 */
export async function zhuangPeiZengLiang(
  x: ZhuangPeiXuanxiang
): Promise<{ ok: true; bytes: number; sha256: string } | { ok: false; reason: string; message: string }> {
  const ops = tanPingJiHua(x.ji);
  let jiuFd = -1;
  let chuFd = -1;
  const zheng = crypto.createHash('sha256');
  let yiXie = 0;
  const shan = () => { try { fs.rmSync(x.shuChu, { force: true }); } catch { /* noop */ } };
  try {
    jiuFd = fs.openSync(x.jiuWenJian, 'r');
    chuFd = fs.openSync(x.shuChu, 'w');
    const buf = Buffer.alloc(CDC_MAX);
    for (const op of ops) {
      if (op.start !== yiXie) {
        shan();
        return { ok: false, reason: 'plan-gap', message: `plan does not cover the file contiguously at ${op.start} (wrote ${yiXie})` };
      }
      if (op.kind === 'copy') {
        let sheng = op.len;
        let duWei = op.from ?? op.start;
        while (sheng > 0) {
          const yao = Math.min(sheng, buf.length);
          const du = fs.readSync(jiuFd, buf, 0, yao, duWei);
          if (du !== yao) {
            shan();
            return { ok: false, reason: 'old-file-short', message: `base installer read ${du} of ${yao} bytes at ${duWei}` };
          }
          const pian = buf.subarray(0, du);
          fs.writeSync(chuFd, pian, 0, du, yiXie);
          zheng.update(pian);
          yiXie += du;
          duWei += du;
          sheng -= du;
        }
      } else {
        const duan = await x.quQuJian(op.start, op.start + op.len - 1);
        if (!Buffer.isBuffer(duan) || duan.length !== op.len) {
          shan();
          return { ok: false, reason: 'range-length-mismatch', message: `range ${op.start}..${op.start + op.len - 1} returned ${Buffer.isBuffer(duan) ? duan.length : 'non-buffer'} bytes` };
        }
        fs.writeSync(chuFd, duan, 0, duan.length, yiXie);
        zheng.update(duan);
        yiXie += duan.length;
      }
      if (x.onProgress) { try { x.onProgress(yiXie, x.xin.size); } catch { /* noop */ } }
    }
    fs.fsyncSync(chuFd);
    fs.closeSync(chuFd);
    chuFd = -1;
    fs.closeSync(jiuFd);
    jiuFd = -1;
    const sha = zheng.digest('hex');
    if (yiXie !== x.xin.size) {
      shan();
      return { ok: false, reason: 'size-mismatch', message: `assembled ${yiXie} bytes, expected ${x.xin.size}` };
    }
    if (sha !== x.xin.sha256) {
      shan();
      return { ok: false, reason: 'checksum-mismatch', message: 'assembled artifact failed SHA-256 verification; file discarded' };
    }
    return { ok: true, bytes: yiXie, sha256: sha };
  } catch (e) {
    shan();
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    // Range 不被支持 / 长度不对是**可识别的协议原因**，单独报，便于调用方决定退回整包
    const reason = msg.startsWith('range-not-supported') ? 'range-not-supported'
      : msg.startsWith('range-length-mismatch') ? 'range-length-mismatch'
      : 'io-error';
    return { ok: false, reason, message: msg };
  } finally {
    if (chuFd >= 0) { try { fs.closeSync(chuFd); } catch { /* noop */ } }
    if (jiuFd >= 0) { try { fs.closeSync(jiuFd); } catch { /* noop */ } }
  }
}