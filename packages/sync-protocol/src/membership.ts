/**
 * membership —— 成员证书 + 吊销列表（ADR 003 §2.3 第 6 条 / §附八.8 / §附五.1 第四层）
 *
 * 为什么这个模块必须存在（不是"数据结构摆着好看"）：
 *
 *  1. **没有证书格式，就没有「群内身份恢复」路径**（§附八.8）。成员的标识如果只有指纹，
 *     那么"换证"就等于"换人"：群主没有任何办法把一个**新指纹**认定成"原来那个人"。
 *     证书把"这个公钥"绑到"这个群成员身份"上，并由群主（创建者）签名背书 ——
 *     换证后用 `supersedes` 串成一条**变更链**，链上任意一环都能推出同一个成员身份。
 *  2. 成员被踢 / 换证 / 私钥泄漏，都需要**可验证的吊销**：光靠"本机记住不许连"没法在
 *     多台机器之间对齐结论。吊销列表由同一个群主签名，成员重连时同步。
 *
 * 安全要点（改动本文件前先读这几条）：
 *
 *  - **签名覆盖全部语义字段**。任何字段被改（哪怕只是 displayName / role）都必须验签失败。
 *    `memberCertSigningPayload()` 明确列出参与签名的字段，加字段时**必须同时加进去**。
 *  - **时间判定只用接收方本地时钟**，声明里的 `issuedAt` / `revokedAt` 只做"荒谬未来时间"的
 *    粗筛（容差 `clockSkewMs`）。绝不能因为"证书自称还没过期"就放行 ——
 *    证书是攻击者可控数据（§附七.2 同一个道理）。
 *  - **吊销只看"有没有这条记录"**，不看 `revokedAt`：条目存在即吊销，即便时间戳被改成未来。
 *    否则攻击者只要把 revokedAt 往后调就能"撤销对自己的吊销"。
 *  - **吊销列表必须单调递增**（`listVersion`），且**只增不减**：低版本（重放旧列表）与
 *    "条目变少"（用新版本偷偷解除吊销）都必须被拒。这是本模块里最容易写漏的两条。
 *  - **假名签名（§附八.4 / 八.5）与本模块无关**：那是 DHT 记录写入的授权模型（群派生假名），
 *    解决"高 seq 垃圾占位"。成员证书走的是**真实身份指纹**，因为它要表达"这个人是谁"。
 *
 * 本模块只用 `node:crypto` 与同包的 codec（零第三方依赖、零原生模块）。
 * 它**不碰磁盘、不碰 Electron**，因此可以被纯 Node 验证脚本直接驱动。
 */
import {
  type Zijie,
  b64u,
  base32,
  ed25519SpkiDerFromRaw,
  normalizeEd25519PublicKey,
  sha256,
  zhuanZiJieZu,
  verifyEd25519Local,
} from './codec.js';

/* ────────────────────────────── 常量 / 类型 ────────────────────────────── */

export const CHENGYUAN_ZHENGSHU_MOSHI = 'warmy.member-cert.v1' as const;
export const REVOCATION_LIST_SCHEMA = 'warmy.revocation-list.v1' as const;

/** 域分隔：证书与吊销列表的签名域不同，跨用途不互串 */
export const CHENGYUAN_ZHENGSHU_YUMING = 'warmy.member-cert.v1' as const;
export const REVOCATION_LIST_DOMAIN = 'warmy.revocation-list.v1' as const;

/**
 * 本地时间容差（与身份层 `DEFAULT_CLOCK_SKEW_MS` 同一个值）。
 * app-shell 侧会显式把身份层的 `DEFAULT_CLOCK_SKEW_MS` 传进来；这里给默认值是为了让
 * sync-protocol 单独可测，不依赖 app-shell。
 */
export const MEMBERSHIP_CLOCK_SKEW_MS = 5 * 60_000;

/** 成员证书有效期默认值（发布时可由调用方覆盖） */
export const DEFAULT_MEMBER_CERT_TTL_MS = 180 * 24 * 3600_000;

export type ChengYuanZhengShuJueSe = 'creator' | 'admin' | 'member';

export const MEMBER_CERT_ROLES: readonly ChengYuanZhengShuJueSe[] = ['creator', 'admin', 'member'];

export type CheXiaoYuanYin = 'rotation' | 'compromise' | 'departed' | 'admin';

export const REVOCATION_REASONS: readonly CheXiaoYuanYin[] = ['rotation', 'compromise', 'departed', 'admin'];

/**
 * 成员证书。
 *
 * 比 ADR 给的最小形态多了两个字段，都是**为了能离线自证**，方向是更严不是更松：
 *  · `issuerPublicKey` —— 没有它就无法在本机验证"这张证书确实由群主签的"（只能信自称的 issuerFingerprint）；
 *  · `memberId`（可选）—— 创建者给该成员分配的**稳定成员标识**（跨换证不变）。它让"群成员表的一行"
 *    与"证书链"能对上；缺失时以证书链根 `certId` 充当成员标识。
 */
export interface ChengYuanZhengShu {
  schema: typeof CHENGYUAN_ZHENGSHU_MOSHI;
  certId: string;
  groupId: string;
  memberFingerprint: string;
  /** SPKI DER base64（与身份层线上表示一致） */
  memberPublicKey: string;
  displayName?: string;
  role: ChengYuanZhengShuJueSe;
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
  issuerFingerprint: string;
  /** SPKI DER base64（群主 / 创建者公钥） */
  issuerPublicKey: string;
  /** 群主对规范化字节的签名（raw 64 字节 Ed25519，base64） */
  issuerSignature: string;
  /** 换证后重签时指向**旧证书** —— 这是"群内身份恢复"的关键字段 */
  supersedes?: string;
  /** 创建者分配的稳定成员标识（跨换证不变；可选） */
  memberId?: string;
}

export interface CheXiaoTiaoMu {
  certId: string;
  memberFingerprint: string;
  reason: CheXiaoYuanYin;
  revokedAt: number;
}

export interface CheXiaoBiao {
  schema: typeof REVOCATION_LIST_SCHEMA;
  groupId: string;
  /** **单调递增，必须**：否则被吊销者可以重放旧列表 */
  listVersion: number;
  entries: CheXiaoTiaoMu[];
  issuedAt: number;
  issuerFingerprint: string;
  issuerPublicKey: string;
  issuerSignature: string;
}

/** 指纹推导注入点（与 identity.ts 同款做法）：默认 base32(sha256(raw32)) */
export type quChengYuanZhiWen = (publicKeySpkiB64: string) => string;

export function moRenChengYuanZhiWen(publicKeySpkiB64: string): string {
  const der = Buffer.from(String(publicKeySpkiB64 || ''), 'base64');
  const raw = normalizeEd25519PublicKey(der);
  return base32(sha256(raw));
}

export interface ChengYuanYanZhengXuanXiang {
  /** 期望的签发者（群主）指纹。给了就必须相等 —— 这是"不是创建者签的就不认"的落点 */
  expectIssuerFingerprint?: string;
  /** 期望的群 id。给了就必须相等（防止把 A 群的证书塞进 B 群） */
  expectGroupId?: string;
  now?: number;
  clockSkewMs?: number;
  fingerprintOf?: quChengYuanZhiWen;
  /** 独立的验签实现（默认用本地 Ed25519 复核） */
  verifySignature?: (message: Buffer, signature: Buffer, publicKeySpkiB64: string) => boolean | null;
}

export type ChengYuanZhengShuMa =
  | 'ok'
  | 'malformed'
  | 'unknown-schema'
  | 'fingerprint-mismatch'
  | 'issuer-fingerprint-mismatch'
  | 'wrong-issuer'
  | 'wrong-group'
  | 'expired'
  | 'not-yet-valid'
  | 'bad-signature';

export interface ChengYuanZhengShuYanZhengGuo {
  ok: boolean;
  code: ChengYuanZhengShuMa;
  certId: string;
  groupId: string;
  memberFingerprint: string;
  issuerFingerprint: string;
  /** 本地时钟判定（不是声明里的时间） */
  now: number;
  expiresAt: number;
  detail?: string;
}

export type CheXiaoBiaoMa =
  | 'ok'
  | 'malformed'
  | 'unknown-schema'
  | 'issuer-fingerprint-mismatch'
  | 'wrong-issuer'
  | 'wrong-group'
  | 'not-yet-valid'
  | 'bad-signature'
  | 'rollback'
  | 'replay'
  | 'entries-dropped';

export interface CheXiaoYingYongJieGuo {
  ok: boolean;
  code: CheXiaoBiaoMa;
  changed: boolean;
  listVersion: number;
  previousVersion: number;
  entryCount: number;
  detail?: string;
}

/* ────────────────────────────── 规范化 / 签名载荷 ────────────────────────────── */

/** 确定性序列化：键排序 + 丢 undefined（两端必须算出同一串字节） */
export function guiFanChengYuanJson(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => guiFanChengYuanJson(v)).join(',')}]`;
  if (t === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${guiFanChengYuanJson(o[k])}`).join(',')}}`;
  }
  return 'null';
}

/** 域分隔 + 规范化载荷 */
export function chengYuanQianMingZiJie(domain: string, payload: unknown): Buffer {
  return Buffer.from(`${domain}\n${guiFanChengYuanJson(payload)}`, 'utf8');
}

/**
 * 证书**参与签名**的字段（加字段必须同时加到签名载荷里，否则等于没签）。
 * `issuerSignature` 本身当然不在其中。
 */
export function zhengShuQianMingZaiHe(cert: ChengYuanZhengShu): Record<string, unknown> {
  return {
    schema: cert.schema,
    certId: cert.certId,
    groupId: cert.groupId,
    memberFingerprint: cert.memberFingerprint,
    memberPublicKey: cert.memberPublicKey,
    displayName: cert.displayName ?? '',
    role: cert.role,
    permissions: cert.permissions ?? [],
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    issuerFingerprint: cert.issuerFingerprint,
    issuerPublicKey: cert.issuerPublicKey,
    supersedes: cert.supersedes ?? '',
    memberId: cert.memberId ?? '',
  };
}

export function zhengShuQianMingZiJie(cert: ChengYuanZhengShu): Buffer {
  return chengYuanQianMingZiJie(CHENGYUAN_ZHENGSHU_YUMING, zhengShuQianMingZaiHe(cert));
}

export function cheXiaoQianMingZaiHe(list: CheXiaoBiao): Record<string, unknown> {
  return {
    schema: list.schema,
    groupId: list.groupId,
    listVersion: list.listVersion,
    entries: (list.entries ?? []).map((e) => ({
      certId: e.certId,
      memberFingerprint: e.memberFingerprint,
      reason: e.reason,
      revokedAt: e.revokedAt,
    })),
    issuedAt: list.issuedAt,
    issuerFingerprint: list.issuerFingerprint,
    issuerPublicKey: list.issuerPublicKey,
  };
}

export function cheXiaoQianMingZiJie(list: CheXiaoBiao): Buffer {
  return chengYuanQianMingZiJie(REVOCATION_LIST_DOMAIN, cheXiaoQianMingZaiHe(list));
}

/* ────────────────────────────── 构造（不含签名 / 含签名） ────────────────────────────── */

export interface GouJianChengYuanZhengShuShuRu {
  certId: string;
  groupId: string;
  memberFingerprint: string;
  memberPublicKey: string;
  displayName?: string;
  role?: ChengYuanZhengShuJueSe;
  permissions?: string[];
  issuedAt?: number;
  expiresAt?: number;
  issuerFingerprint: string;
  issuerPublicKey: string;
  supersedes?: string;
  memberId?: string;
}

/** 由公钥 raw 32B 生成 SPKI DER base64（与身份层线上表示一致） */
export function spkiB64FromRaw(raw: Zijie): string {
  return ed25519SpkiDerFromRaw(raw).toString('base64');
}

/** 构造一张**未签名**的证书（字段归一化：权限去重排序、时间必须自洽） */
export function gouJianChengYuanZhengShu(
  input: GouJianChengYuanZhengShuShuRu,
  opts: { now?: number; ttlMs?: number } = {}
): ChengYuanZhengShu {
  const now = opts.now ?? Date.now();
  const issuedAt = typeof input.issuedAt === 'number' ? input.issuedAt : now;
  const expiresAt =
    typeof input.expiresAt === 'number'
      ? input.expiresAt
      : issuedAt + (typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_MEMBER_CERT_TTL_MS);
  if (!(expiresAt > issuedAt)) throw new Error('expiresAt 必须大于 issuedAt');
  const role: ChengYuanZhengShuJueSe = MEMBER_CERT_ROLES.includes(input.role as ChengYuanZhengShuJueSe)
    ? (input.role as ChengYuanZhengShuJueSe)
    : 'member';
  const permissions = [...new Set((input.permissions ?? []).map((p) => String(p)).filter((p) => p.length > 0))].sort();
  const cert: ChengYuanZhengShu = {
    schema: CHENGYUAN_ZHENGSHU_MOSHI,
    certId: String(input.certId),
    groupId: String(input.groupId),
    memberFingerprint: String(input.memberFingerprint),
    memberPublicKey: String(input.memberPublicKey),
    role,
    permissions,
    issuedAt,
    expiresAt,
    issuerFingerprint: String(input.issuerFingerprint),
    issuerPublicKey: String(input.issuerPublicKey),
    issuerSignature: '',
  };
  if (input.displayName) cert.displayName = String(input.displayName);
  if (input.supersedes) cert.supersedes = String(input.supersedes);
  if (input.memberId) cert.memberId = String(input.memberId);
  return cert;
}

/** 用签名器（`sign(bytes) → raw 64B`）把未签名证书变成已签名证书 */
export async function qianMingChengYuanZhengShu(
  cert: ChengYuanZhengShu,
  sign: (bytes: Buffer) => Promise<Zijie> | Zijie
): Promise<ChengYuanZhengShu> {
  const sig = zhuanZiJieZu(await sign(zhengShuQianMingZiJie(cert)));
  if (sig.length !== 64) throw new Error(`member cert 签名长度异常：${sig.length}（应为 64）`);
  return { ...cert, issuerSignature: sig.toString('base64') };
}

export interface GouJianCheXiaoBiaoShuRu {
  groupId: string;
  listVersion: number;
  entries: CheXiaoTiaoMu[];
  issuedAt?: number;
  issuerFingerprint: string;
  issuerPublicKey: string;
}

export function gouJianCheXiaoBiao(input: GouJianCheXiaoBiaoShuRu, opts: { now?: number } = {}): CheXiaoBiao {
  const now = opts.now ?? Date.now();
  const seen = new Set<string>();
  const entries: CheXiaoTiaoMu[] = [];
  for (const e of input.entries ?? []) {
    const certId = String(e?.certId || '');
    if (!certId || seen.has(certId)) continue; // 同一条只留一份（同一证书不能既 A 又 B）
    seen.add(certId);
    entries.push({
      certId,
      memberFingerprint: String(e?.memberFingerprint || ''),
      reason: REVOCATION_REASONS.includes(e?.reason as CheXiaoYuanYin) ? (e.reason as CheXiaoYuanYin) : 'admin',
      revokedAt: typeof e?.revokedAt === 'number' && Number.isFinite(e.revokedAt) ? e.revokedAt : now,
    });
  }
  return {
    schema: REVOCATION_LIST_SCHEMA,
    groupId: String(input.groupId),
    listVersion: Math.max(1, Math.floor(input.listVersion)),
    entries,
    issuedAt: typeof input.issuedAt === 'number' ? input.issuedAt : now,
    issuerFingerprint: String(input.issuerFingerprint),
    issuerPublicKey: String(input.issuerPublicKey),
    issuerSignature: '',
  };
}

export async function qianMingCheXiaoBiao(
  list: CheXiaoBiao,
  sign: (bytes: Buffer) => Promise<Zijie> | Zijie
): Promise<CheXiaoBiao> {
  const sig = zhuanZiJieZu(await sign(cheXiaoQianMingZiJie(list)));
  if (sig.length !== 64) throw new Error(`revocation list 签名长度异常：${sig.length}（应为 64）`);
  return { ...list, issuerSignature: sig.toString('base64') };
}

/* ────────────────────────────── 验签 ────────────────────────────── */

function yanZhengQianMing(
  message: Buffer,
  signatureB64: string,
  publicKeySpkiB64: string,
  opts: ChengYuanYanZhengXuanXiang
): boolean {
  if (typeof signatureB64 !== 'string' || signatureB64.length === 0) return false;
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64) return false;
  if (opts.verifySignature) {
    const r = opts.verifySignature(message, sig, publicKeySpkiB64);
    // null = "这次没验过" → 一律按**失败**处理（fail-closed）
    return r === true;
  }
  let raw: Buffer;
  try {
    raw = normalizeEd25519PublicKey(Buffer.from(publicKeySpkiB64, 'base64'));
  } catch {
    return false;
  }
  return verifyEd25519Local(message, sig, raw) === true;
}

function shiFouFeiKongZifuchuan(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function shiFouYouXianShuzi(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 验证成员证书。
 *
 * 检查顺序（每条失败都给出可枚举的 code，调用方按 code 决定怎么处理，不解析文案）：
 *  结构 → 公钥↔指纹自洽 → 签发者自洽 → expectIssuer/expectGroup → 本地时钟（过期/未来）
 *  → 签名 → supersedes 自洽。
 */
export function yanZhengChengYuanZhengShu(
  cert: ChengYuanZhengShu,
  opts: ChengYuanYanZhengXuanXiang = {}
): ChengYuanZhengShuYanZhengGuo {
  const now = opts.now ?? Date.now();
  const pianyi = typeof opts.clockSkewMs === 'number' ? opts.clockSkewMs : MEMBERSHIP_CLOCK_SKEW_MS;
  const fingerprintOf = opts.fingerprintOf ?? moRenChengYuanZhiWen;
  const base: ChengYuanZhengShuYanZhengGuo = {
    ok: false,
    code: 'malformed',
    certId: String(cert?.certId || ''),
    groupId: String(cert?.groupId || ''),
    memberFingerprint: String(cert?.memberFingerprint || ''),
    issuerFingerprint: String(cert?.issuerFingerprint || ''),
    now,
    expiresAt: shiFouYouXianShuzi(cert?.expiresAt) ? cert.expiresAt : 0,
  };
  if (!cert || typeof cert !== 'object') return { ...base, detail: '证书不是对象' };
  if (cert.schema !== CHENGYUAN_ZHENGSHU_MOSHI) {
    return { ...base, code: 'unknown-schema', detail: `schema=${String(cert.schema)}` };
  }
  if (!shiFouFeiKongZifuchuan(cert.certId) || !shiFouFeiKongZifuchuan(cert.groupId)) return { ...base, detail: 'certId/groupId 缺失' };
  if (!shiFouFeiKongZifuchuan(cert.memberFingerprint) || !shiFouFeiKongZifuchuan(cert.memberPublicKey)) {
    return { ...base, detail: 'memberFingerprint/memberPublicKey 缺失' };
  }
  if (!shiFouFeiKongZifuchuan(cert.issuerFingerprint) || !shiFouFeiKongZifuchuan(cert.issuerPublicKey)) {
    return { ...base, detail: 'issuerFingerprint/issuerPublicKey 缺失' };
  }
  if (!MEMBER_CERT_ROLES.includes(cert.role)) return { ...base, detail: `role 非法：${String(cert.role)}` };
  if (!Array.isArray(cert.permissions) || !cert.permissions.every((p) => shiFouFeiKongZifuchuan(p))) {
    return { ...base, detail: 'permissions 必须是字符串数组' };
  }
  if (cert.permissions.length > 32) return { ...base, detail: `permissions 过多：${cert.permissions.length}` };
  if (!shiFouYouXianShuzi(cert.issuedAt) || !shiFouYouXianShuzi(cert.expiresAt)) return { ...base, detail: 'issuedAt/expiresAt 非法' };
  if (cert.supersedes !== undefined && (!shiFouFeiKongZifuchuan(cert.supersedes) || cert.supersedes === cert.certId)) {
    return { ...base, detail: 'supersedes 非法（不能等于自身 certId）' };
  }
  // 公钥 ↔ 指纹必须自洽（"换了公钥但沿用旧指纹"必然失败）
  let derivedMember: string;
  let derivedIssuer: string;
  try {
    derivedMember = fingerprintOf(cert.memberPublicKey);
    derivedIssuer = fingerprintOf(cert.issuerPublicKey);
  } catch (e) {
    return { ...base, detail: `公钥无法解释：${(e as Error).message}` };
  }
  if (derivedMember !== cert.memberFingerprint) {
    return { ...base, code: 'fingerprint-mismatch', detail: `memberFingerprint 与公钥不符（推出 ${derivedMember}）` };
  }
  if (derivedIssuer !== cert.issuerFingerprint) {
    return { ...base, code: 'issuer-fingerprint-mismatch', detail: `issuerFingerprint 与公钥不符（推出 ${derivedIssuer}）` };
  }
  if (opts.expectIssuerFingerprint && opts.expectIssuerFingerprint !== cert.issuerFingerprint) {
    return {
      ...base,
      code: 'wrong-issuer',
      detail: `签发者不是本群创建者：期望 ${opts.expectIssuerFingerprint}，实际 ${cert.issuerFingerprint}`,
    };
  }
  if (opts.expectGroupId && opts.expectGroupId !== cert.groupId) {
    return { ...base, code: 'wrong-group', detail: `群不符：期望 ${opts.expectGroupId}，实际 ${cert.groupId}` };
  }
  // 时间：只用本地时钟。声明里的时间戳只用来挡"荒谬的未来时间"。
  if (cert.expiresAt <= now - pianyi) {
    return { ...base, code: 'expired', detail: `已过期（本地 now=${now} > expiresAt=${cert.expiresAt}）` };
  }
  if (cert.issuedAt > now + pianyi) {
    return { ...base, code: 'not-yet-valid', detail: `issuedAt 比本地时间超前 ${Math.round((cert.issuedAt - now) / 1000)}s` };
  }
  if (cert.expiresAt <= cert.issuedAt) return { ...base, detail: 'expiresAt <= issuedAt' };
  if (!yanZhengQianMing(zhengShuQianMingZiJie(cert), cert.issuerSignature, cert.issuerPublicKey, opts)) {
    return { ...base, code: 'bad-signature', detail: 'issuerSignature 不通过（字段被改过 / 不是该公钥签的）' };
  }
  return { ...base, ok: true, code: 'ok' };
}

/** 只问"在本地时钟下有效吗"（不含结构/签名以外的东西）—— 便捷封装 */
export function zhengShuZaiCiKeYouXiao(
  cert: ChengYuanZhengShu,
  opts: ChengYuanYanZhengXuanXiang = {}
): ChengYuanZhengShuYanZhengGuo {
  return yanZhengChengYuanZhengShu(cert, opts);
}

export function yanZhengCheXiaoBiao(
  list: CheXiaoBiao,
  opts: ChengYuanYanZhengXuanXiang = {}
): { ok: boolean; code: CheXiaoBiaoMa; listVersion: number; entryCount: number; now: number; detail?: string } {
  const now = opts.now ?? Date.now();
  const pianyi = typeof opts.clockSkewMs === 'number' ? opts.clockSkewMs : MEMBERSHIP_CLOCK_SKEW_MS;
  const fingerprintOf = opts.fingerprintOf ?? moRenChengYuanZhiWen;
  const base = {
    ok: false,
    code: 'malformed' as CheXiaoBiaoMa,
    listVersion: shiFouYouXianShuzi(list?.listVersion) ? Math.floor(list.listVersion) : 0,
    entryCount: Array.isArray(list?.entries) ? list.entries.length : 0,
    now,
  };
  if (!list || typeof list !== 'object') return { ...base, detail: '列表不是对象' };
  if (list.schema !== REVOCATION_LIST_SCHEMA) return { ...base, code: 'unknown-schema', detail: `schema=${String(list.schema)}` };
  if (!shiFouFeiKongZifuchuan(list.groupId)) return { ...base, detail: 'groupId 缺失' };
  if (!shiFouYouXianShuzi(list.listVersion) || !Number.isInteger(list.listVersion) || list.listVersion < 1) {
    return { ...base, detail: 'listVersion 必须是 ≥1 的整数' };
  }
  if (!shiFouYouXianShuzi(list.issuedAt)) return { ...base, detail: 'issuedAt 非法' };
  if (!shiFouFeiKongZifuchuan(list.issuerFingerprint) || !shiFouFeiKongZifuchuan(list.issuerPublicKey)) {
    return { ...base, detail: 'issuerFingerprint/issuerPublicKey 缺失' };
  }
  if (!Array.isArray(list.entries)) return { ...base, detail: 'entries 必须是数组' };
  const ids = new Set<string>();
  for (const e of list.entries) {
    if (!e || typeof e !== 'object') return { ...base, detail: 'entries 里有非对象' };
    if (!shiFouFeiKongZifuchuan(e.certId)) return { ...base, detail: 'entry.certId 缺失' };
    if (ids.has(e.certId)) return { ...base, detail: `entry.certId 重复：${e.certId}` };
    ids.add(e.certId);
    if (!shiFouFeiKongZifuchuan(e.memberFingerprint)) return { ...base, detail: 'entry.memberFingerprint 缺失' };
    if (!REVOCATION_REASONS.includes(e.reason)) return { ...base, detail: `entry.reason 非法：${String(e.reason)}` };
    if (!shiFouYouXianShuzi(e.revokedAt)) return { ...base, detail: 'entry.revokedAt 非法' };
  }
  let derivedIssuer: string;
  try {
    derivedIssuer = fingerprintOf(list.issuerPublicKey);
  } catch (e) {
    return { ...base, detail: `issuerPublicKey 无法解释：${(e as Error).message}` };
  }
  if (derivedIssuer !== list.issuerFingerprint) {
    return { ...base, code: 'issuer-fingerprint-mismatch', detail: `issuerFingerprint 与公钥不符（推出 ${derivedIssuer}）` };
  }
  if (opts.expectIssuerFingerprint && opts.expectIssuerFingerprint !== list.issuerFingerprint) {
    return { ...base, code: 'wrong-issuer', detail: `签发者不是本群创建者：期望 ${opts.expectIssuerFingerprint}` };
  }
  if (opts.expectGroupId && opts.expectGroupId !== list.groupId) {
    return { ...base, code: 'wrong-group', detail: `群不符：期望 ${opts.expectGroupId}，实际 ${list.groupId}` };
  }
  if (list.issuedAt > now + pianyi) {
    return { ...base, code: 'not-yet-valid', detail: `issuedAt 比本地时间超前 ${Math.round((list.issuedAt - now) / 1000)}s` };
  }
  if (!yanZhengQianMing(cheXiaoQianMingZiJie(list), list.issuerSignature, list.issuerPublicKey, opts)) {
    return { ...base, code: 'bad-signature', detail: 'issuerSignature 不通过（字段被改过 / 不是该公钥签的）' };
  }
  return { ...base, ok: true, code: 'ok' };
}

/* ────────────────────────────── 单调合并（拒绝回滚 / 拒绝偷偷解吊销） ────────────────────────────── */

function tiaomuQianming(list: CheXiaoBiao): string {
  return `${list.listVersion}|${list.entries.map((e) => e.certId).join(',')}|${list.issuedAt}|${list.issuerSignature}`;
}

/**
 * 把收到（且**已验签**）的吊销列表合并进本机当前列表。
 *
 * 三条硬规则（缺一条就能被绕过）：
 *  1. `listVersion` 必须**严格更大**才更新；更小 = **回滚**（重放旧列表），相等但内容不同 = **重放**，都拒；
 *  2. **条目只增不减**：新列表若少了本机记过的 certId，一律拒（否则"发一版新列表顺手解掉吊销"即可绕过）；
 *  3. 同一 certId 的 `reason` 可以变（rotation → compromise），但 certId 不能消失。
 *
 * `current = null`（本机还没同步过）时直接采纳 —— 前提是调用方已经验过签名
 * （用 `verifyAndApplyRevocationList` 就不会漏）。
 */
export function applyRevocationList(
  current: CheXiaoBiao | null,
  incoming: CheXiaoBiao
): CheXiaoYingYongJieGuo {
  const previousVersion = current ? current.listVersion : 0;
  if (!current) {
    return {
      ok: true,
      code: 'ok',
      changed: true,
      listVersion: incoming.listVersion,
      previousVersion,
      entryCount: incoming.entries.length,
      detail: '本机尚无吊销列表（首次同步）',
    };
  }
  if (incoming.listVersion < current.listVersion) {
    return {
      ok: false,
      code: 'rollback',
      changed: false,
      listVersion: incoming.listVersion,
      previousVersion,
      entryCount: incoming.entries.length,
      detail: `列表回滚：收到 v${incoming.listVersion} < 本机 v${current.listVersion}`,
    };
  }
  if (incoming.listVersion === current.listVersion) {
    if (tiaomuQianming(incoming) === tiaomuQianming(current)) {
      return {
        ok: true,
        code: 'ok',
        changed: false,
        listVersion: incoming.listVersion,
        previousVersion,
        entryCount: incoming.entries.length,
        detail: '同一版本、同一内容 → 幂等忽略',
      };
    }
    return {
      ok: false,
      code: 'replay',
      changed: false,
      listVersion: incoming.listVersion,
      previousVersion,
      entryCount: incoming.entries.length,
      detail: `同版本 v${incoming.listVersion} 但内容不同（疑似重放/伪造）`,
    };
  }
  const jinLaiIdJi = new Set(incoming.entries.map((e) => e.certId));
  const diushi = current.entries.filter((e) => !jinLaiIdJi.has(e.certId)).map((e) => e.certId);
  if (diushi.length) {
    return {
      ok: false,
      code: 'entries-dropped',
      changed: false,
      listVersion: incoming.listVersion,
      previousVersion,
      entryCount: incoming.entries.length,
      detail: `新列表少了已吊销项（${diushi.slice(0, 3).join(',')}…）：吊销只增不减`,
    };
  }
  return {
    ok: true,
    code: 'ok',
    changed: true,
    listVersion: incoming.listVersion,
    previousVersion,
    entryCount: incoming.entries.length,
    detail: `v${current.listVersion} → v${incoming.listVersion}`,
  };
}

/** 验签 + 单调合并（**调用方不要自己先 apply 再 verify**，顺序反了就等于没验） */
export function yanZhengBingYingYongCheXiaoBiao(
  current: CheXiaoBiao | null,
  incoming: CheXiaoBiao,
  opts: ChengYuanYanZhengXuanXiang = {}
): CheXiaoYingYongJieGuo {
  const v = yanZhengCheXiaoBiao(incoming, opts);
  if (!v.ok) {
    return {
      ok: false,
      code: v.code,
      changed: false,
      listVersion: v.listVersion,
      previousVersion: current ? current.listVersion : 0,
      entryCount: v.entryCount,
      detail: `验签/结构不通过：${v.detail ?? v.code}`,
    };
  }
  return applyRevocationList(current, incoming);
}

/* ────────────────────────────── 吊销查询 ────────────────────────────── */

export interface CheXiaoChaXun {
  certId?: string;
  memberFingerprint?: string;
}

/**
 * 是否被吊销。
 * ⚠️ **只看有没有这条记录，不看 `revokedAt`** —— 条目存在即吊销。
 * 理由：revokedAt 是可被签发者写成任意值（甚至未来）的字段；若用它做判定，
 * 攻击者只要把时间往后调就能"撤销对自己的吊销"。
 */
export function chaZhaoCheXiaoTiaoMu(list: CheXiaoBiao | null, q: CheXiaoChaXun): CheXiaoTiaoMu | null {
  if (!list || !Array.isArray(list.entries)) return null;
  for (const e of list.entries) {
    if (q.certId && e.certId === q.certId) return e;
    if (q.memberFingerprint && e.memberFingerprint === q.memberFingerprint) return e;
  }
  return null;
}

export function yiCheXiao(list: CheXiaoBiao | null, q: CheXiaoChaXun): boolean {
  return chaZhaoCheXiaoTiaoMu(list, q) !== null;
}

/* ────────────────────────────── 变更链（supersedes）＝ 群内身份恢复 ────────────────────────────── */

export interface ZhengShuLian {
  /** 链根证书 id（换证链上最早那一张）；成员身份就绑在它上面 */
  rootCertId: string;
  /** 从根到该证书的 certId 序列 */
  certIds: string[];
  /** 链上出现过的全部指纹（旧 → 新） */
  fingerprints: string[];
  /** 检测到 supersedes 环时为 true（链不可信） */
  cycle: boolean;
  /** supersedes 指向本地不存在的证书（链断了） */
  broken: boolean;
}

function suoyinYouId(certs: readonly ChengYuanZhengShu[]): Map<string, ChengYuanZhengShu> {
  const m = new Map<string, ChengYuanZhengShu>();
  for (const c of certs) if (c && shiFouFeiKongZifuchuan(c.certId)) m.set(c.certId, c);
  return m;
}

/** 沿 `supersedes` 往回走到根，得到完整的变更链 */
export function bianliZhengshuLian(certs: readonly ChengYuanZhengShu[], certId: string): ZhengShuLian {
  const byId = suoyinYouId(certs);
  const start = byId.get(certId);
  if (!start) {
    return { rootCertId: '', certIds: [], fingerprints: [], cycle: false, broken: true };
  }
  const seen = new Set<string>();
  const path: ChengYuanZhengShu[] = [];
  let cur: ChengYuanZhengShu | undefined = start;
  let broken = false;
  let cycle = false;
  while (cur) {
    if (seen.has(cur.certId)) {
      cycle = true;
      break;
    }
    seen.add(cur.certId);
    path.push(cur);
    const prevId: string | undefined = cur.supersedes;
    if (!prevId) break;
    const prev: ChengYuanZhengShu | undefined = byId.get(prevId);
    if (!prev) {
      // 链断了：本机没有旧证书（例如只收到最新那一张）。不因此否定本人，
      // 但要把"链不完整"如实标出来，好让调用方决定是否要求补齐。
      broken = true;
      break;
    }
    cur = prev;
  }
  path.reverse(); // 旧 → 新
  return {
    rootCertId: path[0]?.certId ?? '',
    certIds: path.map((c) => c.certId),
    fingerprints: path.map((c) => c.memberFingerprint),
    cycle,
    broken,
  };
}

/** supersedes 链的**根** certId（成员身份 id，跨换证不变） */
export function lianGenZhengShuId(certs: readonly ChengYuanZhengShu[], certId: string): string {
  return bianliZhengshuLian(certs, certId).rootCertId;
}

/**
 * 给定指纹，返回**同一条变更链**上的全部指纹（含自己）。
 * 本机不知道这个指纹（没有任何证书）时返回 `[fingerprint]` 本身 —— "只为查找用"，
 * **不代表认定它是成员**。是否成员由证书验签结论决定。
 */
export function lianShiZhiWen(certs: readonly ChengYuanZhengShu[], fingerprint: string): string[] {
  const own = certs.filter((c) => c.memberFingerprint === fingerprint);
  const out = new Set<string>([fingerprint]);
  for (const c of own) {
    const chain = bianliZhengshuLian(certs, c.certId);
    if (chain.cycle) continue; // 环 = 链不可信，不用它做归属
    for (const fp of chain.fingerprints) out.add(fp);
  }
  // 反向：别的证书 supersedes 到"我这一环"（例如本机只有旧证书）
  let zengzhang = true;
  while (zengzhang) {
    zengzhang = false;
    for (const c of certs) {
      if (!c.supersedes) continue;
      if (out.has(c.memberFingerprint)) continue;
      if (out.has(c.supersedes)) {
        out.add(c.memberFingerprint);
        zengzhang = true;
      }
    }
  }
  return [...out];
}

/**
 * 这两个指纹是不是**同一个群成员**（= 换证后重新进群的判据）。
 *
 * 判据：两边都能在同一个群内找到证书，且**链根 certId 相同**（或者 `memberId` 相同 ——
 * 创建者可显式重签并把 memberId 沿用）。否则一律 false：
 * **无关的新指纹不能因为"本机也认识"就被当成原成员**。
 */
export function isSameMember(
  certs: readonly ChengYuanZhengShu[],
  fingerprintA: string,
  fingerprintB: string
): { same: boolean; rootA: string; rootB: string; memberId: string; reason: string } {
  const empty = { same: false, rootA: '', rootB: '', memberId: '', reason: '' };
  if (!fingerprintA || !fingerprintB) return { ...empty, reason: '指纹为空' };
  const zhengShuJiA = certs.filter((c) => c.memberFingerprint === fingerprintA);
  const zhengShuJiB = certs.filter((c) => c.memberFingerprint === fingerprintB);
  if (!zhengShuJiA.length || !zhengShuJiB.length) {
    return { ...empty, reason: !zhengShuJiA.length ? 'A 没有成员证书' : 'B 没有成员证书' };
  }
  const genJiA = zhengShuJiA.map((c) => lianGenZhengShuId(certs, c.certId)).filter((r) => r.length > 0);
  const genJiB = zhengShuJiB.map((c) => lianGenZhengShuId(certs, c.certId)).filter((r) => r.length > 0);
  const rootA = genJiA[0] ?? '';
  const rootB = genJiB[0] ?? '';
  const shared = genJiA.some((r) => genJiB.includes(r));
  // memberId（创建者分配的稳定成员标识）也可以作为"同一人"的等价判据
  const idJiA = new Set(zhengShuJiA.map((c) => c.memberId).filter((v): v is string => typeof v === 'string' && v.length > 0));
  const idJiB = zhengShuJiB.map((c) => c.memberId).filter((v): v is string => typeof v === 'string' && v.length > 0);
  const gongYongId = idJiB.find((id) => idJiA.has(id)) ?? '';
  if (shared || gongYongId) {
    return {
      same: true,
      rootA,
      rootB,
      memberId: gongYongId,
      reason: shared ? `变更链根相同（${rootA}）` : `创建者沿用了 memberId（${gongYongId}）`,
    };
  }
  return { same: false, rootA, rootB, memberId: '', reason: `链根不同（${rootA || '无'} ≠ ${rootB || '无'}）` };
}

/* ────────────────────────────── 便于断言 / 展示 ────────────────────────────── */

/** 公开描述（不含任何私钥材料；证书本来就只有公钥） */
export function shuoMingChengYuanZhengShu(cert: ChengYuanZhengShu): {
  certId: string;
  groupId: string;
  memberFingerprint: string;
  memberPublicKeyRawB64u: string;
  role: ChengYuanZhengShuJueSe;
  permissions: string[];
  supersedes: string;
  memberId: string;
  issuedAt: number;
  expiresAt: number;
  issuerFingerprint: string;
} {
  let raw = '';
  try {
    raw = b64u(normalizeEd25519PublicKey(Buffer.from(cert.memberPublicKey, 'base64')));
  } catch {
    raw = '';
  }
  return {
    certId: cert.certId,
    groupId: cert.groupId,
    memberFingerprint: cert.memberFingerprint,
    memberPublicKeyRawB64u: raw,
    role: cert.role,
    permissions: [...(cert.permissions ?? [])],
    supersedes: cert.supersedes ?? '',
    memberId: cert.memberId ?? '',
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    issuerFingerprint: cert.issuerFingerprint,
  };
}

/** 群内成员身份 id：优先 `memberId`，否则用变更链根 certId */
export function quChengYuanShenFen(certs: readonly ChengYuanZhengShu[], cert: ChengYuanZhengShu): string {
  if (cert.memberId) return `member:${cert.memberId}`;
  const root = lianGenZhengShuId(certs, cert.certId);
  return root ? `chain:${root}` : '';
}
