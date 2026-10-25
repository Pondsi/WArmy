/**
 * 邀请名片 / 加入流程 / 成员权限 / 会话锚点（#108）—— 纯逻辑 + 密码学。
 *
 * 产品口径（必须与实现一起读，别把能力说大）：
 *   1) **没有中心服务器**。身份 = Ed25519 密钥对；每会话以**创建者公钥指纹**为锚点
 *      （不是随机 ID，随机 ID 可被中继替换且无法验签）。
 *   2) 邀请 token = 创建者私钥签名的 payload：
 *      `{v:1, sessionId, role, issuerFp, subjectFp, issuedAt, expiresAt, nonce}`。
 *      `issuerFp` 是创建者/会话锚点指纹，`subjectFp` 是被邀请人公钥指纹 —— 邀请**绑定到人**，
 *      不是"谁先捡到链接谁进"。
 *   3) 二维码只给 URL 文本（`qrText`），本模块**不生成图片**；扫码端再把 URL 解回 token。
 *   4) nonce 一次性：验证成功后才写入调用方注入的存储；失败不消耗 nonce（可以重试）。
 *   5) 角色 owner/admin/member/viewer。授予规则见 `keShouYu()` 真值表；
 *      owner 唯一性由调用方提供**现有成员列表 / ownerFp**来判定（本模块不持有会话状态）。
 *
 * 边界（诚实说明）：
 *   - 本模块不落盘、不碰 Electron；私钥的加密保存/备份是调用方的事。
 *   - nonce 存储是注入的（Set / Map / 自定义）；默认不持久化，进程重启后防重放需由调用方持久化。
 *   - `yanZhengYaoQing` 的 `gongYao` 是**签发者（创建者）公钥**，用于验签 + 锚点核对；
 *     被邀请人公钥通过 `subjectGongYao` / `subjectFp` 传入。不传 subject 时无法完成"绑人"校验，
 *     返回值里 `subjectChecked:false` 如实标出（正式加入流程应始终传）。
 *   - 旧邀请吊销 / supersedes / 成员证书不在本文件范围内；这里只保证单张邀请可验证、可过期、防重放。
 *   - 角色表按最小权限：admin 只能发 member/viewer；member/viewer 不能发邀请。
 *     若产品以后允许 member 邀请 viewer，只改 `SHOU_YU_BIAO` 一格并补门禁。
 */
import crypto, { KeyObject } from 'node:crypto';

function xiJingCuoWuWen(e: unknown): string {
  try {
    const m = (e as { message?: unknown })?.message;
    return String(m || e || 'unknown').slice(0, 160);
  } catch {
    return 'unknown';
  }
}

// ── 常量 ──

export const YAO_QING_BAN_BEN = 1 as const;
export const YAO_QING_SUAN_FA = 'Ed25519' as const;
/** 签名域分隔：邀请签名不能挪去签别的协议（防跨协议重放） */
export const YAO_QING_YUMING = 'warmy.invite.v1' as const;
export const YAO_QING_URL_QIANZHUI = 'warmy://invite/' as const;
/** 默认邀请有效期：24 小时 */
export const MO_REN_YOU_XIAO_MS = 24 * 3600_000;
/** 指纹展示：SHA-256 十六进制取前 32 位（128 bit），每 4 位一组，固定 39 字符 */
export const ZHIWEN_HEX_CHANG = 32;
export const ZHIWEN_FENZU = 4;

const ED25519_SPKI_QIANZHUI = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_QIANZHUI = Buffer.from('302e020100300506032b657004220420', 'hex');

export const JUESE_LIST = ['owner', 'admin', 'member', 'viewer'] as const;
export type JueSe = (typeof JUESE_LIST)[number];

export function shiFouJueSe(v: unknown): v is JueSe {
  return typeof v === 'string' && (JUESE_LIST as readonly string[]).includes(v);
}

/**
 * 授予真值表（行 = 签发者角色，列 = 目标角色）。
 *
 * |          | owner | admin | member | viewer |
 * |----------|-------|-------|--------|--------|
 * | owner    |  ✓    |  ✓    |  ✓     |  ✓     |
 * | admin    |  ✗    |  ✗    |  ✓     |  ✓     |
 * | member   |  ✗    |  ✗    |  ✗     |  ✗     |
 * | viewer   |  ✗    |  ✗    |  ✗     |  ✗     |
 *
 * 说明：owner→owner 留给"所有权转移"场景；实际签发/验证时还会用现有成员列表做
 * owner 唯一性检查（已有 owner 时第二个 owner 邀请会被拒）。
 */
const SHOU_YU_BIAO: Record<JueSe, Record<JueSe, boolean>> = {
  owner: { owner: true, admin: true, member: true, viewer: true },
  admin: { owner: false, admin: false, member: true, viewer: true },
  member: { owner: false, admin: false, member: false, viewer: false },
  viewer: { owner: false, admin: false, member: false, viewer: false },
};

export function keShouYu(issuerRole: JueSe, targetRole: JueSe): boolean {
  if (!shiFouJueSe(issuerRole) || !shiFouJueSe(targetRole)) return false;
  return SHOU_YU_BIAO[issuerRole][targetRole];
}

// ── 稳定错误码 ──

export const YAO_QING_CUO_WU_MA = [
  'bad-token',
  'bad-signature',
  'expired',
  'wrong-session',
  'subject-mismatch',
  'replayed',
  'role-escalation',
  'bad-role',
  'wrong-anchor',
  'bad-key',
  'bad-subject',
  'pending-exists',
  'already-approved',
  'not-found',
] as const;
export type YaoQingCuoWuMa = (typeof YAO_QING_CUO_WU_MA)[number];

export class YaoQingCuoWu extends Error {
  code: YaoQingCuoWuMa;
  detail: string;

  constructor(code: YaoQingCuoWuMa, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'YaoQingCuoWu';
    this.code = code;
    this.detail = detail;
  }
}

// ── 公钥/私钥输入与指纹 ──

export type GongYaoShuRu = KeyObject | string | Buffer | Uint8Array;
export type SiYaoShuRu = KeyObject | string | Buffer | Uint8Array;

function shiKeyObject(v: unknown): v is KeyObject {
  return v instanceof KeyObject;
}

function jieBase64WenBen(s: string): Buffer {
  const t = s.trim();
  if (!t) return Buffer.alloc(0);
  // URL-safe 的字符集出现时按 base64url 解；否则标准 base64 也能解 URL-safe 的无特殊字符串
  if (t.includes('-') || t.includes('_')) return Buffer.from(t, 'base64url');
  return Buffer.from(t, 'base64');
}

/** 归一化指纹：去分隔符（- 与空白）、转大写、必须是固定长度十六进制。 */
export function guiYiZhiWen(wen: string): string {
  const s = String(wen ?? '')
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '');
  if (!new RegExp(`^[0-9A-F]{${ZHIWEN_HEX_CHANG}}$`).test(s)) {
    throw new YaoQingCuoWu('bad-token', 'fingerprint-shape');
  }
  return s;
}

/** 规范形（32 位十六进制）→ 分组展示形（`AB12-CD34-...`，固定 8 组）。 */
export function geshiZhiWen(hex: string): string {
  const s = guiYiZhiWen(hex);
  const zu: string[] = [];
  for (let i = 0; i < s.length; i += ZHIWEN_FENZU) zu.push(s.slice(i, i + ZHIWEN_FENZU));
  return zu.join('-');
}

export function shiFouHeFaZhiWen(v: unknown): v is string {
  try {
    guiYiZhiWen(String(v ?? ''));
    return true;
  } catch {
    return false;
  }
}

/** 两个指纹是否同一（忽略大小写与分组）。任一方形态非法 → false。 */
export function zhiWenDeng(a: string, b: string): boolean {
  try {
    return guiYiZhiWen(a) === guiYiZhiWen(b);
  } catch {
    return false;
  }
}

/**
 * 公钥 → KeyObject。接受：
 *   - KeyObject（必须是 Ed25519 公钥）
 *   - PEM（`-----BEGIN PUBLIC KEY-----`）
 *   - base64 的 SPKI DER（44 字节）或裸 32 字节 Ed25519 公钥
 *   - 上述二进制形态的 Buffer / Uint8Array
 */
export function gongYaoKeyObject(shuRu: GongYaoShuRu): KeyObject {
  let key: KeyObject;
  if (shiKeyObject(shuRu)) {
    key = shuRu;
  } else {
    const buf = typeof shuRu === 'string' ? null : Buffer.from(shuRu);
    const text = typeof shuRu === 'string' ? shuRu.trim() : buf!.toString('utf8');
    if (text.includes('BEGIN')) {
      key = crypto.createPublicKey({ key: text, format: 'pem' });
    } else {
      const der = typeof shuRu === 'string' ? jieBase64WenBen(shuRu) : buf!;
      if (der.length === 32) {
        key = crypto.createPublicKey({
          key: Buffer.concat([ED25519_SPKI_QIANZHUI, der]),
          format: 'der',
          type: 'spki',
        });
      } else {
        key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      }
    }
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new YaoQingCuoWu('bad-key', 'public-key-not-ed25519');
  }
  return key;
}

/** 公钥 → 裸 32 字节（指纹与跨语言核对都以这 32 字节为准）。 */
export function gongYaoYuanShiZiJie(shuRu: GongYaoShuRu): Buffer {
  const key = gongYaoKeyObject(shuRu);
  const jwk = key.export({ format: 'jwk' }) as unknown as { x?: unknown };
  if (jwk && typeof jwk.x === 'string') {
    const raw = Buffer.from(jwk.x, 'base64url');
    if (raw.length === 32) return Buffer.from(raw);
  }
  const der = key.export({ format: 'der', type: 'spki' }) as Buffer;
  const raw = der.subarray(der.length - 32);
  if (raw.length !== 32) throw new YaoQingCuoWu('bad-key', 'raw-public-key-length');
  return Buffer.from(raw);
}

/**
 * 公钥指纹 = `SHA-256(裸 32 字节公钥)` 的十六进制前 32 位，每 4 位一组，大写。
 * 固定长度（8 组），大小写/分隔符归一；**不是**随机 ID，换网络/换服务器不变。
 */
export function zhiWen(gongYao: GongYaoShuRu): string {
  const hex = crypto.createHash('sha256').update(gongYaoYuanShiZiJie(gongYao)).digest('hex');
  return geshiZhiWen(hex.slice(0, ZHIWEN_HEX_CHANG));
}

/** 私钥 → KeyObject。接受 PEM、base64/DER PKCS#8、裸 32 字节种子、KeyObject。 */
export function siYaoKeyObject(shuRu: SiYaoShuRu): KeyObject {
  let key: KeyObject;
  if (shiKeyObject(shuRu)) {
    key = shuRu;
  } else {
    const buf = typeof shuRu === 'string' ? null : Buffer.from(shuRu);
    const text = typeof shuRu === 'string' ? shuRu.trim() : buf!.toString('utf8');
    if (text.includes('BEGIN')) {
      key = crypto.createPrivateKey({ key: text, format: 'pem' });
    } else {
      const der = typeof shuRu === 'string' ? jieBase64WenBen(shuRu) : buf!;
      if (der.length === 32) {
        key = crypto.createPrivateKey({
          key: Buffer.concat([ED25519_PKCS8_QIANZHUI, der]),
          format: 'der',
          type: 'pkcs8',
        });
      } else {
        key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      }
    }
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new YaoQingCuoWu('bad-key', 'private-key-not-ed25519');
  }
  return key;
}

// ── 身份 ──

export interface ShenFenCaiLiao {
  suanFa: typeof YAO_QING_SUAN_FA;
  /** 私钥 PEM（PKCS#8）—— 调用方必须加密保存，绝不外发 */
  siYaoPem: string;
  /** 公钥 PEM */
  gongYaoPem: string;
  /** 公钥 SPKI DER 的 base64（标准线上表示之一） */
  gongYaoBase64: string;
  /** 裸 32 字节公钥的 base64（跨语言最省事） */
  gongYaoYuanShiBase64: string;
  /** 分组指纹（会话锚点 / 安全码） */
  zhiWen: string;
}

/** 生成 Ed25519 身份密钥对。只用 node:crypto，无第三方依赖。 */
export function shengChengShenFen(): ShenFenCaiLiao {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const siYaoPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const gongYaoPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return {
    suanFa: YAO_QING_SUAN_FA,
    siYaoPem,
    gongYaoPem,
    gongYaoBase64: spki.toString('base64'),
    gongYaoYuanShiBase64: gongYaoYuanShiZiJie(publicKey).toString('base64'),
    zhiWen: zhiWen(publicKey),
  };
}

// ── 签名 ──

/** Ed25519 签名，返回标准 base64（64 字节）。 */
export function qianMing(siYao: SiYaoShuRu, wen: string | Buffer): string {
  const data = Buffer.isBuffer(wen) ? wen : Buffer.from(String(wen ?? ''), 'utf8');
  return crypto.sign(null, data, siYaoKeyObject(siYao)).toString('base64');
}

/** 验签；任何异常都返回 false（不把底层错误当"通过"）。 */
export function yanQian(gongYao: GongYaoShuRu, wen: string | Buffer, qianMingWen: string): boolean {
  try {
    const sig = Buffer.from(String(qianMingWen ?? ''), 'base64');
    if (sig.length !== 64) return false;
    const data = Buffer.isBuffer(wen) ? wen : Buffer.from(String(wen ?? ''), 'utf8');
    return crypto.verify(null, data, gongYaoKeyObject(gongYao), sig);
  } catch {
    return false;
  }
}

// ── 规范化 JSON（签名覆盖的字节必须确定） ──

export function wenDingJSON(zhi: unknown): string {
  const bian = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return '[' + v.map((x) => bian(x)).join(',') + ']';
    const obj = v as Record<string, unknown>;
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + bian(obj[k]))
        .join(',') +
      '}'
    );
  };
  return bian(zhi);
}

// ── 邀请 payload / token ──

export interface YaoQingPayload {
  v: 1;
  sessionId: string;
  role: JueSe;
  issuerFp: string;
  subjectFp: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

/** 邀请签名覆盖的字节：域分隔 + 规范化 JSON。 */
export function yaoQingQianMingWen(payload: YaoQingPayload): string {
  return `${YAO_QING_YUMING}\n${wenDingJSON(payload)}`;
}

function bianToken(payload: YaoQingPayload, signature: string): string {
  return Buffer.from(JSON.stringify({ p: payload, s: signature }), 'utf8').toString('base64url');
}

export interface JieXiYaoQing {
  /** 解析后的 payload（尚未验签，调用方不得直接信任） */
  payload: unknown;
  qianMing: string;
  /** 归一化后的 token 字符串（URL 输入会被解回 token） */
  token: string;
}

/**
 * 解析 token（也接受 `warmy://invite/<base64url(token)>` 整条 URL）。
 * 只做结构解析，不验签；结构不对返回 null。
 */
export function jieYaoQingToken(token: string): JieXiYaoQing | null {
  let raw = String(token ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith(YAO_QING_URL_QIANZHUI)) {
    try {
      raw = Buffer.from(raw.slice(YAO_QING_URL_QIANZHUI.length), 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }
  let obj: unknown;
  try {
    obj = JSON.parse(jieBase64WenBen(raw).toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (!o.p || typeof o.p !== 'object' || Array.isArray(o.p) || typeof o.s !== 'string') return null;
  return { payload: o.p, qianMing: o.s, token: raw };
}

function shiHeFaPayload(v: unknown): v is YaoQingPayload {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.sessionId === 'string' &&
    o.sessionId.length > 0 &&
    typeof o.role === 'string' &&
    typeof o.issuerFp === 'string' &&
    typeof o.subjectFp === 'string' &&
    Number.isFinite(o.issuedAt) &&
    Number.isFinite(o.expiresAt) &&
    typeof o.nonce === 'string' &&
    o.nonce.length > 0 &&
    o.nonce.length <= 128 &&
    shiFouHeFaZhiWen(o.issuerFp) &&
    shiFouHeFaZhiWen(o.subjectFp)
  );
}

// ── 签发邀请 ──

export interface ChengYuan {
  fp: string;
  role: JueSe;
}

export interface YaoQingCanShu {
  /** 创建者（会话锚点持有者）私钥；与 `sign` 二选一 */
  siYao?: SiYaoShuRu;
  /**
   * 外部签名函数（已解锁的身份签名者）：输入签名覆盖的字节，返回 base64 的 64 字节 Ed25519 签名。
   * 用它可以做到**私钥不出安全存储**；提供时 `gongYao` 必填，用于推导锚点指纹与自校验。
   */
  sign?: (bytes: Buffer) => string;
  /** 创建者公钥；不传则从私钥推导（两者都给时会核对一致） */
  gongYao?: GongYaoShuRu;
  sessionId: string;
  role: JueSe | string;
  /** 被邀请人公钥；与 subjectFp 至少给一个 */
  subjectGongYao?: GongYaoShuRu;
  /** 被邀请人指纹（分组/小写皆可） */
  subjectFp?: string;
  /** 签发者角色，默认 owner（创建者就是 owner） */
  issuerRole?: JueSe;
  /** 现有成员（用于 owner 唯一性检查；不传则跳过） */
  members?: readonly ChengYuan[];
  /** 现有 owner 指纹（owner 唯一性检查的轻量写法；与 members 二选一或都给） */
  ownerFp?: string;
  now?: number;
  ttlMs?: number;
  /** 不传则随机生成（16 字节十六进制） */
  nonce?: string;
}

export interface YaoQingJieGuo {
  token: string;
  /** `warmy://invite/<base64url(token)>` */
  url: string;
  /** 二维码内容**只**是 URL 文本；本模块不生成图片 */
  qrText: string;
  expiresAt: number;
}

function youQiTaOwner(members: readonly ChengYuan[] | undefined, subjectFp: string): boolean {
  for (const m of members ?? []) {
    if (!m || m.role !== 'owner') continue;
    if (!zhiWenDeng(String(m.fp ?? ''), subjectFp)) return true;
  }
  return false;
}

/** `ownerFp` 轻量写法：给了 owner 指纹且不是被邀请人本人 → 视为第二个 owner。 */
function youQiTaOwnerFp(ownerFp: string | undefined, subjectFp: string): boolean {
  if (ownerFp === undefined) return false;
  return !zhiWenDeng(String(ownerFp), subjectFp);
}

/**
 * 用创建者私钥签发邀请。返回 token / url / qrText / expiresAt。
 * 角色越权、owner 冲突、subject 缺失等直接抛 `YaoQingCuoWu`（带稳定 code）。
 */
export function shengChengYaoQing(p: YaoQingCanShu): YaoQingJieGuo {
  const sessionId = String(p.sessionId ?? '').trim();
  if (!sessionId) throw new YaoQingCuoWu('bad-token', 'session-id-empty');

  const role = p.role;
  if (!shiFouJueSe(role)) throw new YaoQingCuoWu('bad-role', String(role));

  const issuerRole = p.issuerRole ?? 'owner';
  if (!shiFouJueSe(issuerRole)) throw new YaoQingCuoWu('bad-role', `issuer:${String(issuerRole)}`);
  if (!keShouYu(issuerRole, role)) {
    throw new YaoQingCuoWu('role-escalation', `${issuerRole}->${role}`);
  }

  let siKey: KeyObject | null = null;
  let derivedPub: KeyObject;
  let derivedFp: string;
  if (p.sign !== undefined) {
    if (p.gongYao === undefined) throw new YaoQingCuoWu('bad-key', 'public-key-required-with-sign');
    if (typeof p.sign !== 'function') throw new YaoQingCuoWu('bad-key', 'sign-not-function');
    derivedPub = gongYaoKeyObject(p.gongYao);
    derivedFp = guiYiZhiWen(zhiWen(derivedPub));
  } else {
    if (p.siYao === undefined) throw new YaoQingCuoWu('bad-key', 'private-key-required');
    siKey = siYaoKeyObject(p.siYao);
    // node:crypto 的 createPublicKey 运行期接受私钥 KeyObject，但类型声明只列了输入形状
    derivedPub = crypto.createPublicKey(siKey as unknown as Parameters<typeof crypto.createPublicKey>[0]);
    derivedFp = guiYiZhiWen(zhiWen(derivedPub));
    if (p.gongYao !== undefined) {
      const givenFp = guiYiZhiWen(zhiWen(p.gongYao));
      if (givenFp !== derivedFp) throw new YaoQingCuoWu('bad-key', 'public-private-mismatch');
    }
  }

  let subjectFp: string;
  try {
    if (p.subjectFp !== undefined) subjectFp = guiYiZhiWen(p.subjectFp);
    else if (p.subjectGongYao !== undefined) subjectFp = guiYiZhiWen(zhiWen(p.subjectGongYao));
    else throw new YaoQingCuoWu('bad-subject', 'missing-subject');
  } catch (e) {
    if (e instanceof YaoQingCuoWu && e.code === 'bad-subject') throw e;
    throw new YaoQingCuoWu('bad-subject', 'invalid-subject');
  }
  if (p.subjectFp !== undefined && p.subjectGongYao !== undefined) {
    let fromKey: string;
    try {
      fromKey = guiYiZhiWen(zhiWen(p.subjectGongYao));
    } catch {
      throw new YaoQingCuoWu('bad-subject', 'invalid-subject-key');
    }
    if (fromKey !== subjectFp) throw new YaoQingCuoWu('subject-mismatch', 'subject-option-conflict');
  }

  if (
    role === 'owner' &&
    (youQiTaOwner(p.members, subjectFp) || youQiTaOwnerFp(p.ownerFp, subjectFp))
  ) {
    throw new YaoQingCuoWu('role-escalation', 'owner-exists');
  }

  const now = Number.isFinite(p.now) ? Number(p.now) : Date.now();
  const ttlMs = Number.isFinite(p.ttlMs) ? Number(p.ttlMs) : MO_REN_YOU_XIAO_MS;
  if (!(ttlMs > 0) || !Number.isFinite(now)) throw new YaoQingCuoWu('bad-token', 'bad-time');

  const nonce = String(p.nonce ?? crypto.randomBytes(16).toString('hex')).trim();
  if (!nonce || nonce.length > 128) throw new YaoQingCuoWu('bad-token', 'bad-nonce');

  const payload: YaoQingPayload = Object.freeze({
    v: YAO_QING_BAN_BEN,
    sessionId,
    role,
    issuerFp: geshiZhiWen(derivedFp),
    subjectFp: geshiZhiWen(subjectFp),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce,
  }) as YaoQingPayload;

  const qianMingWen = yaoQingQianMingWen(payload);
  let signature: string;
  if (p.sign !== undefined) {
    try {
      signature = String(p.sign(Buffer.from(qianMingWen, 'utf8')) ?? '');
    } catch (e) {
      throw new YaoQingCuoWu('bad-signature', `sign-failed:${xiJingCuoWuWen(e)}`);
    }
    // 外部签名者也要自校验：签名和公钥不匹配就拒绝产出 token，不把坏邀请发出去。
    if (!yanQian(derivedPub, qianMingWen, signature)) {
      throw new YaoQingCuoWu('bad-signature', 'signer-mismatch');
    }
  } else {
    signature = qianMing(siKey as KeyObject, qianMingWen);
  }
  const token = bianToken(payload, signature);
  const url = `${YAO_QING_URL_QIANZHUI}${Buffer.from(token, 'utf8').toString('base64url')}`;
  return Object.freeze({ token, url, qrText: url, expiresAt: payload.expiresAt });
}

// ── 验证邀请 ──

export type NonceCunChu =
  | Set<string>
  | Map<string, unknown>
  | { has(nonce: string): boolean; add(nonce: string): unknown };

export interface YanZhengCanShu {
  /** 创建者/会话锚点公钥（验签 + 锚点核对） */
  gongYao: GongYaoShuRu;
  sessionId: string;
  now?: number;
  /** 一次性 nonce 存储；不传 = 不做防重放（调用方必须传） */
  usedNonces?: NonceCunChu;
  /** 预期被邀请人公钥（推荐）；与 subjectFp 至少给一个才算完成绑人校验 */
  subjectGongYao?: GongYaoShuRu;
  /** 预期被邀请人指纹（分组/小写皆可） */
  subjectFp?: string;
  /** 本地已知的签发者角色，默认 owner */
  issuerRole?: JueSe;
  /** 现有成员（owner 唯一性检查） */
  members?: readonly ChengYuan[];
  /** 现有 owner 指纹（owner 唯一性检查的轻量写法） */
  ownerFp?: string;
  /** 会话锚点指纹；不传则用 gongYao 的指纹 */
  anchorFp?: string;
  /** 默认 true；false 只验不消耗（如预览） */
  consumeNonce?: boolean;
}

export interface YanZhengChengGong {
  ok: true;
  payload: Readonly<YaoQingPayload>;
  token: string;
  /** 是否真的用 subject 公钥/指纹做了绑人校验 */
  subjectChecked: boolean;
}

export interface YanZhengShiBai {
  ok: false;
  code: YaoQingCuoWuMa;
  detail?: string;
}

export type YanZhengJieGuo = YanZhengChengGong | YanZhengShiBai;

function nonceYiYong(cun: NonceCunChu | undefined, nonce: string): boolean {
  if (!cun) return false;
  try {
    return Boolean(cun.has(nonce));
  } catch {
    return true; // 存储坏了按"已用过"处理，宁拒不放
  }
}

function nonceJiLu(cun: NonceCunChu | undefined, nonce: string): void {
  if (!cun) return;
  if (typeof (cun as Set<string>).add === 'function') {
    (cun as Set<string>).add(nonce);
    return;
  }
  if (cun instanceof Map) {
    cun.set(nonce, true);
    return;
  }
  throw new YaoQingCuoWu('bad-token', 'bad-nonce-store');
}

/**
 * 验证邀请。检查顺序：结构 → 验签 → 角色合法 → 会话 → 过期 → 绑人 → 锚点 → 重放 → 授予规则 → owner 唯一。
 * nonce 只在**全部通过后**写入；任何失败都不消耗，返回稳定错误码。
 */
export function yanZhengYaoQing(token: string, p: YanZhengCanShu): YanZhengJieGuo {
  const jie = jieYaoQingToken(token);
  if (!jie) return { ok: false, code: 'bad-token' };
  const payload = jie.payload;
  if (!shiHeFaPayload(payload)) return { ok: false, code: 'bad-token', detail: 'payload-shape' };

  // 1) 先验签：未验签的字段一律不可信
  if (!yanQian(p.gongYao, yaoQingQianMingWen(payload), jie.qianMing)) {
    return { ok: false, code: 'bad-signature' };
  }

  // 2) 角色合法性
  if (!shiFouJueSe(payload.role)) return { ok: false, code: 'bad-role', detail: String(payload.role) };

  // 3) 会话必须一致
  if (payload.sessionId !== String(p.sessionId ?? '')) {
    return { ok: false, code: 'wrong-session' };
  }

  // 4) 过期
  const now = Number.isFinite(p.now) ? Number(p.now) : Date.now();
  if (!(payload.expiresAt > payload.issuedAt)) {
    return { ok: false, code: 'bad-token', detail: 'bad-validity-window' };
  }
  if (now >= payload.expiresAt) return { ok: false, code: 'expired' };

  // 5) 绑人：subjectFp 必须与预期成员公钥/指纹一致
  let expectedSubject: string | null = null;
  if (p.subjectFp !== undefined) {
    if (!shiFouHeFaZhiWen(p.subjectFp)) return { ok: false, code: 'subject-mismatch', detail: 'bad-expected-fp' };
    expectedSubject = guiYiZhiWen(p.subjectFp);
  }
  if (p.subjectGongYao !== undefined) {
    let fromKey: string;
    try {
      fromKey = guiYiZhiWen(zhiWen(p.subjectGongYao));
    } catch {
      return { ok: false, code: 'subject-mismatch', detail: 'bad-subject-key' };
    }
    if (expectedSubject !== null && expectedSubject !== fromKey) {
      return { ok: false, code: 'subject-mismatch', detail: 'subject-option-conflict' };
    }
    expectedSubject = fromKey;
  }
  const subjectChecked = expectedSubject !== null;
  if (expectedSubject !== null && expectedSubject !== guiYiZhiWen(payload.subjectFp)) {
    return { ok: false, code: 'subject-mismatch' };
  }

  // 6) 锚点：issuerFp 必须等于 gongYao 指纹；显式 anchorFp 也必须是同一个
  let gongYaoFp: string;
  try {
    gongYaoFp = guiYiZhiWen(zhiWen(p.gongYao));
  } catch {
    return { ok: false, code: 'bad-key' };
  }
  let anchorFp: string;
  try {
    anchorFp = p.anchorFp !== undefined ? guiYiZhiWen(p.anchorFp) : gongYaoFp;
  } catch {
    return { ok: false, code: 'wrong-anchor', detail: 'bad-anchor-fp' };
  }
  if (guiYiZhiWen(payload.issuerFp) !== gongYaoFp || anchorFp !== gongYaoFp) {
    return { ok: false, code: 'wrong-anchor' };
  }

  // 7) 防重放：成功过的 nonce 不能再用
  if (nonceYiYong(p.usedNonces, payload.nonce)) return { ok: false, code: 'replayed' };

  // 8) 授予规则（viewer/member 不能发邀请；admin 不能发 admin/owner）
  const issuerRole = p.issuerRole ?? 'owner';
  if (!shiFouJueSe(issuerRole)) return { ok: false, code: 'bad-role', detail: 'issuer' };
  if (!keShouYu(issuerRole, payload.role)) {
    return { ok: false, code: 'role-escalation', detail: `${issuerRole}->${payload.role}` };
  }

  // 9) owner 唯一：列表里已有别的 owner → 拒绝（同一指纹重复邀请视为幂等）
  if (
    payload.role === 'owner' &&
    (youQiTaOwner(p.members, payload.subjectFp) || youQiTaOwnerFp(p.ownerFp, payload.subjectFp))
  ) {
    return { ok: false, code: 'role-escalation', detail: 'owner-exists' };
  }

  // 10) 全部通过后才消耗 nonce
  if (p.consumeNonce !== false) {
    try {
      nonceJiLu(p.usedNonces, payload.nonce);
    } catch {
      return { ok: false, code: 'bad-token', detail: 'nonce-store-failed' };
    }
  }

  return {
    ok: true,
    payload: Object.freeze({ ...payload }),
    token: jie.token,
    subjectChecked,
  };
}

// ── 加入申请状态机（纯函数，输入输出都不可变副本） ──

export type JiaRuZhuangTai = 'pending' | 'approved' | 'rejected';

export interface JiaRuQingQiu {
  id: string;
  sessionId: string;
  subjectFp: string;
  role: JueSe;
  token: string;
  zhuangTai: JiaRuZhuangTai;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  reason: string | null;
}

function fuZhiQingQiu(q: JiaRuQingQiu): JiaRuQingQiu {
  return Object.freeze({
    id: q.id,
    sessionId: q.sessionId,
    subjectFp: q.subjectFp,
    role: q.role,
    token: q.token,
    zhuangTai: q.zhuangTai,
    createdAt: q.createdAt,
    decidedAt: q.decidedAt,
    decidedBy: q.decidedBy,
    reason: q.reason,
  });
}

function fuZhiJiLu(jiLu: readonly JiaRuQingQiu[]): readonly JiaRuQingQiu[] {
  return Object.freeze(jiLu.map((q) => fuZhiQingQiu(q)));
}

export interface ShenQingCanShu {
  sessionId: string;
  subjectFp: string;
  role: JueSe | string;
  token: string;
  now?: number;
  id?: string;
}

export type ShenQingJieGuo =
  | { ok: true; jiLu: readonly JiaRuQingQiu[]; qingQiu: JiaRuQingQiu }
  | { ok: false; code: YaoQingCuoWuMa; detail?: string; jiLu: readonly JiaRuQingQiu[] };

/**
 * 新建加入申请：pending。同一会话+同一成员已有 pending（或已批准）时拒绝，
 * **已拒绝的可以再次申请**（拒绝不泄漏群内容，也不永久拉黑）。
 */
export function shenQingJiaRu(
  jiLu: readonly JiaRuQingQiu[],
  p: ShenQingCanShu,
): ShenQingJieGuo {
  const copied = fuZhiJiLu(jiLu);
  const sessionId = String(p.sessionId ?? '').trim();
  if (!sessionId) return { ok: false, code: 'bad-token', detail: 'session-id-empty', jiLu: copied };
  if (!shiFouJueSe(p.role)) return { ok: false, code: 'bad-role', detail: String(p.role), jiLu: copied };
  if (!shiFouHeFaZhiWen(p.subjectFp)) {
    return { ok: false, code: 'bad-subject', detail: 'subject-fp', jiLu: copied };
  }
  const token = String(p.token ?? '').trim();
  if (!token) return { ok: false, code: 'bad-token', detail: 'token-empty', jiLu: copied };

  const subjectFp = geshiZhiWen(p.subjectFp);
  for (const q of copied) {
    if (q.sessionId !== sessionId || guiYiZhiWen(q.subjectFp) !== guiYiZhiWen(subjectFp)) continue;
    if (q.zhuangTai === 'pending') {
      return { ok: false, code: 'pending-exists', detail: q.id, jiLu: copied };
    }
    if (q.zhuangTai === 'approved') {
      return { ok: false, code: 'already-approved', detail: q.id, jiLu: copied };
    }
  }

  const now = Number.isFinite(p.now) ? Number(p.now) : Date.now();
  const id =
    p.id && String(p.id).trim()
      ? String(p.id).trim()
      : 'q-' +
        crypto
          .createHash('sha256')
          .update(`${sessionId}|${subjectFp}|${p.role}|${token}|${now}|${copied.length}`)
          .digest('hex')
          .slice(0, 16);

  const qingQiu = fuZhiQingQiu({
    id,
    sessionId,
    subjectFp,
    role: p.role,
    token,
    zhuangTai: 'pending',
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
    reason: null,
  });
  return { ok: true, jiLu: Object.freeze([...copied, qingQiu]), qingQiu };
}

export interface PiZhunCanShu {
  id: string;
  approve: boolean;
  now?: number;
  decidedBy?: string;
  /** 审批者角色；默认 owner。admin 不能批准 admin/owner */
  decidedByRole?: JueSe;
  /** 现有成员（owner 唯一性）；已批准的同会话 owner 申请也会被计入 */
  members?: readonly ChengYuan[];
  /** 现有 owner 指纹（轻量写法） */
  ownerFp?: string;
  reason?: string;
}

export type PiZhunJieGuo =
  | { ok: true; jiLu: readonly JiaRuQingQiu[]; qingQiu: JiaRuQingQiu; changed: boolean }
  | { ok: false; code: YaoQingCuoWuMa; detail?: string; jiLu: readonly JiaRuQingQiu[] };

function youQiTaOwnerZaiShenQing(
  jiLu: readonly JiaRuQingQiu[],
  sessionId: string,
  subjectFp: string,
): boolean {
  for (const q of jiLu) {
    if (q.sessionId !== sessionId || q.role !== 'owner' || q.zhuangTai !== 'approved') continue;
    if (!zhiWenDeng(q.subjectFp, subjectFp)) return true;
  }
  return false;
}

/**
 * 审批：pending → approved / rejected。
 * 幂等：对已决策的申请再次审批，状态/decidedAt 不变，`changed:false`；
 * 拒绝后可以重新 `shenQingJiaRu`（新记录），旧记录保持 rejected。
 * 越权（审批者无权授予该角色 / 已有 owner）返回 `ok:false`，**状态不变**。
 */
export function piZhunJiaRu(
  jiLu: readonly JiaRuQingQiu[],
  p: PiZhunCanShu,
): PiZhunJieGuo {
  const copied = fuZhiJiLu(jiLu);
  const idx = copied.findIndex((q) => q.id === String(p.id ?? ''));
  if (idx < 0) return { ok: false, code: 'not-found', detail: String(p.id ?? ''), jiLu: copied };

  const old = copied[idx]!;
  if (old.zhuangTai !== 'pending') {
    return { ok: true, jiLu: copied, qingQiu: fuZhiQingQiu(old), changed: false };
  }

  const now = Number.isFinite(p.now) ? Number(p.now) : Date.now();
  const decidedBy = p.decidedBy ? String(p.decidedBy) : null;

  if (p.approve) {
    const approver = p.decidedByRole ?? 'owner';
    if (!shiFouJueSe(approver)) {
      return { ok: false, code: 'bad-role', detail: 'approver', jiLu: copied };
    }
    if (!keShouYu(approver, old.role)) {
      return { ok: false, code: 'role-escalation', detail: `${approver}->${old.role}`, jiLu: copied };
    }
    if (
      old.role === 'owner' &&
      (youQiTaOwner(p.members, old.subjectFp) ||
        youQiTaOwnerFp(p.ownerFp, old.subjectFp) ||
        youQiTaOwnerZaiShenQing(copied, old.sessionId, old.subjectFp))
    ) {
      return { ok: false, code: 'role-escalation', detail: 'owner-exists', jiLu: copied };
    }
  }

  const next = fuZhiQingQiu({
    ...old,
    zhuangTai: p.approve ? 'approved' : 'rejected',
    decidedAt: now,
    decidedBy,
    reason: p.reason ? String(p.reason) : null,
  });
  const out = copied.slice();
  out[idx] = next;
  return { ok: true, jiLu: Object.freeze(out), qingQiu: next, changed: true };
}
