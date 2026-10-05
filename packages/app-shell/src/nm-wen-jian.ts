/**
 * nm-wen-jian —— WArmy 专有的 **`.nm` / `.NM` 打包格式**。
 *
 * 形态（产品定稿）：
 *   · 一个文件 = 一个 JSON 信封：`{ format:'wamy-nm', version, kind, createdAt, meta, data }`
 *   · **data 是密文**（AES-256-GCM）；密钥由用户设的口令派生（scrypt，每文件随机 salt/iv）
 *   · 整体再 base64，写成 `XXX.NM`（配置导出）/ `XXX.nm`（项目/聊天导出）
 *
 * 为什么不是直接放明文：产品要求「导出时设置密码、导入必须输密码」。
 * 为什么信封本身不加密：导入前要先告诉用户「这是个什么包、什么时候导的」，
 * 再要密码解密 —— 否则密码输错只能看到一团乱码。
 *
 * 解密失败一律**如实报错**（`bad-password` / `bad-format`），绝不猜、绝不半解。
 */
import crypto from 'node:crypto';

export type NmKind = 'config' | 'project' | 'chat';

export interface NmXinFeng {
  format: 'wamy-nm';
  version: 1;
  kind: NmKind;
  createdAt: number;
  meta: Record<string, unknown>;
  /** base64(salt) + '.' + base64(iv) + '.' + base64(ciphertext) */
  data: string;
}

export interface NmMingWen {
  kind: NmKind;
  createdAt: number;
  meta: Record<string, unknown>;
  payload: unknown;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

function paiShengMiYao(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(String(password || ''), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
}

/** 打包：明文 payload + 口令 → 可直接写盘的 `.nm` 文本。
 *  **口令为空 ⇒ 明文封包**（`data` 以 `plain.` 开头）—— 项目/聊天导出就走这条：
 *  AI 要能直接读 `.nm` 了解内容（产品要求），加密反而读不了。 */
export function daBaoNm(kind: NmKind, payload: unknown, password: string, meta: Record<string, unknown> = {}): string {
  const clear = Buffer.from(JSON.stringify(payload ?? null), 'utf8');
  let data: string;
  if (!password) {
    data = 'plain.' + clear.toString('base64');
  } else {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = paiShengMiYao(password, salt);
    const mi = crypto.createCipheriv('aes-256-gcm', key, iv);
    const jiaMi = Buffer.concat([mi.update(clear), mi.final()]);
    const tag = mi.getAuthTag();
    data = [salt.toString('base64'), iv.toString('base64'), Buffer.concat([jiaMi, tag]).toString('base64')].join('.');
  }
  const xin: NmXinFeng = {
    format: 'wamy-nm',
    version: 1,
    kind,
    createdAt: Date.now(),
    meta,
    data,
  };
  return JSON.stringify(xin, null, 2);
}

/** 读信封（不需密码）：导入前先给用户看「这是什么包」 */
export function duXinFeng(text: string): NmXinFeng | null {
  try {
    const j = JSON.parse(String(text || ''));
    if (!j || j.format !== 'wamy-nm' || j.version !== 1) return null;
    const s = String(j.data || '');
    const ok = s.startsWith('plain.') || s.split('.').length === 3;
    if (!ok) return null;
    return j as NmXinFeng;
  } catch { return null; }
}

/** 解包：口令错 / 包坏 ⇒ 如实抛错，绝不返回半截数据 */
export function chaiBaoNm(text: string, password: string): NmMingWen {
  const xin = duXinFeng(text);
  if (!xin) throw new Error('bad-format（不是 WArmy 的 .nm 文件，或文件已损坏）');
  let clear: Buffer;
  const s = String(xin.data || '');
  if (s.startsWith('plain.')) {
    // 明文封包（项目/聊天导出）：不需要口令
    clear = Buffer.from(s.slice('plain.'.length), 'base64');
  } else {
    const sanDuan = s.split('.');
    const salt = Buffer.from(sanDuan[0]!, 'base64');
    const iv = Buffer.from(sanDuan[1]!, 'base64');
    const miWen = Buffer.from(sanDuan[2]!, 'base64');
    if (miWen.length < 17) throw new Error('bad-format（密文太短，文件已损坏）');
    const tag = miWen.subarray(miWen.length - 16);
    const jiaMi = miWen.subarray(0, miWen.length - 16);
    const key = paiShengMiYao(password, salt);
    const mi = crypto.createDecipheriv('aes-256-gcm', key, iv);
    mi.setAuthTag(tag);
    try {
      clear = Buffer.concat([mi.update(jiaMi), mi.final()]);
    } catch {
      throw new Error('bad-password（口令不对，或文件已损坏）');
    }
  }
  let payload: unknown;
  try { payload = JSON.parse(clear.toString('utf8')); } catch { throw new Error('bad-format（解出来不是合法 JSON）'); }
  return {
    kind: (xin.kind as NmKind) || 'config',
    createdAt: Number(xin.createdAt) || 0,
    meta: (xin.meta as Record<string, unknown>) || {},
    payload,
  };
}
