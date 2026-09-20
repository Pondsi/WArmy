/**
 * 身份层（ADR 003 附五 / 附五.1 / 附六）—— 纯逻辑 + 密码学，不碰磁盘、不依赖 Electron
 *
 * 落地的是设计冻结后的三条：
 *   1) **身份 = Ed25519 身份密钥对 → 公钥指纹**（base32 + 校验位），不是那个 9 位 deviceId。
 *      ADR 003 §2.2 的理由：9 位 ID 是 HMAC 自签的**格式校验**，只能证明"没被手改"，
 *      不能证明"这就是那台设备"，且 10^9 空间按生日悖论 4 万台设备就撞；
 *      所以 deviceId 降级为**人读别名**（alias，保留兼容），身份一律用指纹。
 *   2) **单调代次 generation**：每次换证 +1；接收方只接受**更高代次**的声明。
 *   3) **换证声明里不得出现任何联系方式**（需求更正后）：旧联系方式只能来自
 *      **接收方本机已存的那一份**（对方当初加入时交换并留在本机的名片），不从声明里读。
 *      理由：声明是**可能被攻击者控制的数据**（密钥被偷后由攻击者生成），
 *      若从声明读"旧联系方式"，攻击者可以伪造；本机历史留存则是攻击者改不了的信息。
 *   4) **换证后的联系信息冻结期（7 天）**：任何一方换证后 7 天内不得新增/修改联系方式；
 *      接收方 7 天内不得把该账号的名片更新为新的（继续用本机历史留存值）。
 *      7 天**从接收方本机收到通知的时刻起算**（绝不用声明里的时间戳 —— 那可以伪造），
 *      且冻结状态由**每个接收方本地各自判定**，不依赖任何人广播的"冻结中"标志。
 *      首次加入（从未见过换证）不受限，否则新人根本填不了联系方式。
 *
 * ⚠️ 能力边界（必须随结果一起回给调用方，不许夸大 —— 见附五.1）：
 *     单调代次只防**回滚**（拒绝相等 / 更低的代次声明），**不防抢占**。
 *     持有旧私钥的攻击者若**抢先**发出更高代次的声明，接收方只能接受
 *     （签名正确 + 代次更高 = 合法），失窃者随后发出的声明代次更低，会被规则拒绝 ——
 *     结果是**代次机制把抢占结果锁死**。无服务器体系里没有比私钥更高的权威，
 *     也没有客服可以介入，所以这件事在密码学上**不可解**。
 *     产品侧只能：口令加密私钥（最有效的预防）+ 换证横幅可见（把静默变响）
 *               + 不同用途分密钥 + 群内由创建者重签（星型拓扑才是兜底手段）。
 *     见常量 GENERATION_RULE_NOTE —— 它必须出现在验签结果里。
 */
import crypto from 'node:crypto';
import type { KeyObject } from 'node:crypto';

// ── 常量 ──

/** 身份算法：长期**签名**密钥用 Ed25519（ADR §2.3 第 4 条：签名密钥与协商密钥分开，X25519 属于握手层） */
export const IDENTITY_ALGO = 'Ed25519' as const;
export const IDENTITY_SCHEMA = 'warmy.identity.v1' as const;
export const IDENTITY_CARD_SCHEMA = 'warmy.identity-card.v1' as const;
export const ROTATION_SCHEMA = 'warmy.identity.rotation.v1' as const;
export const REVOCATION_SCHEMA = 'warmy.identity.revocation.v1' as const;
export const SIGNED_PAYLOAD_SCHEMA = 'warmy.identity.signed.v1' as const;

/** 签名的域分隔前缀：不同用途的签名不互串（防跨协议签名重放） */
export const DOMAIN_STATEMENT = 'warmy.identity.statement.v1';
export const DOMAIN_CARD = 'warmy.identity.card.v1';

/**
 * 代次规则的**诚实说明**。任何一次换证验签都必须把它原样带给调用方（UI 文案必须照此写），
 * 免得产品被宣传成"能防身份劫持"。
 */
export const GENERATION_RULE_NOTE =
  '单调代次只防回滚（拒绝相等或更低的代次声明），不防抢先：持有旧私钥的人若抢先发出更高代次的声明，接收方只能接受，原主随后发出的声明会因代次更低被拒 —— 代次机制反而把抢占结果锁死。无服务器体系里没有比私钥更高的权威，这件事密码学上不可解；只能靠「私钥口令加密 + 换证横幅可见 + 不同用途分密钥 + 群内由创建者重签」缓解。';

/** 默认时间戳容差（分钟级）：只用于拒绝"未来时间"的声明，不用它做过期判定 */
export const DEFAULT_CLOCK_SKEW_MS = 5 * 60_000;

// ── 指纹：base32(sha256(SPKI)) 前 19 位 + 1 位校验 ──

/**
 * Crockford base32 字母表：去掉了 I / L / O / U。
 * 目的不是"更难猜"（指纹本来就是公开的），而是**手抄核对时不易看错**。
 */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FPR_DATA_CHARS = 19;
const FPR_TOTAL_CHARS = FPR_DATA_CHARS + 1; // 末位是校验位
const FPR_GROUP = 5; // 展示时每 5 位一组
const FPR_CHECK_DOMAIN = 'warmy.fpr.check.v1';

/** base32（无填充，MSB first） */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]!;
  return out;
}

/** 校验位：数据位的确定性函数（只防手抄/手输错，**不是**安全特性） */
function checkCharFor(data: string): string {
  const h = crypto.createHash('sha256').update(`${FPR_CHECK_DOMAIN}|${data}`).digest();
  return B32[h[0]! & 31]!;
}

/** 20 位规范形 → 5 位一组的大写展示形（如 `W6RQE-2HFK9-B4SCR-8TZ0M`） */
export function formatFingerprint(canonical: string): string {
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += FPR_GROUP) groups.push(canonical.slice(i, i + FPR_GROUP));
  return groups.join('-');
}

/** 归一化：大写、去分隔符、Crockford 容错映射（I/L→1，O→0） */
export function normalizeFingerprint(fp: string): string {
  return String(fp || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/** 形态 + 校验位校验；`normalizeFingerprint` 之后是 20 位且校验位对得上才算合法 */
export function isValidFingerprint(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const n = normalizeFingerprint(v);
  if (n.length !== FPR_TOTAL_CHARS) return false;
  for (const ch of n) if (!B32.includes(ch)) return false;
  const data = n.slice(0, FPR_DATA_CHARS);
  return n.slice(FPR_DATA_CHARS) === checkCharFor(data);
}

/** 两个指纹是否指同一身份（忽略大小写 / 分组 / 常见形近字） */
export function fingerprintMatches(a: string, b: string): boolean {
  const na = normalizeFingerprint(a);
  const nb = normalizeFingerprint(b);
  return na.length > 0 && na === nb;
}

/**
 * 公钥 → 指纹。公钥用 **SPKI DER 的 base64** 作为唯一线上表示
 * （选它是因为 SPKI 是 x509 标准形、自描述长度、跨语言可解析 —— **不是**因为拿不到 raw：
 * Node 24 的 KeyObject 实际能导出 raw，见 ADR 003 附八.11-2）。
 */
export function fingerprintFromPublicKey(publicKeyB64: string): string {
  const der = Buffer.from(String(publicKeyB64 || ''), 'base64');
  const digest = crypto.createHash('sha256').update(der).digest();
  const data = base32Encode(digest).slice(0, FPR_DATA_CHARS);
  return formatFingerprint(data + checkCharFor(data));
}

// ── 名片（附六：身份 = 凭证 + 名片） ──

/**
 * 联系资料。**字段全部可选**，但展示时必须给占位（附六第 2 条：
 * "不可隐藏但可以不写" —— 不能让人以为"他隐藏了联系方式"，否则这条防线就没意义）。
 */
export interface LianXiKa {
  email?: string;
  phone?: string;
  /** 可选其它联系方式（例如备用邮箱 / 即时通讯），名字由用户自己起 */
  extra?: Array<{ label: string; value: string }>;
  /** 本地最后修改时间（不参与签名语义之外的计算，仅用于展示与审计） */
  updatedAt?: number;
}

/** 渲染层必须传 t（否则会显示 i18n key 原文）；主进程侧只给结构化数据，不拼中文 */
export type Translate = (key: string, fallback?: string) => string;

/** 名片相关 i18n key（**UI 那条线负责落盘**，这里只声明"需要哪些"） */
export const CONTACT_CARD_I18N = {
  title: 'identity.contact.title',
  email: 'identity.contact.email',
  phone: 'identity.contact.phone',
  extra: 'identity.contact.extra',
  /** 「未填写」占位 —— 必须出现在空字段位置 */
  unfilled: 'identity.contact.unfilled',
  /** 「加入时对方一定看得到联系方式（但可以不写）」的说明文案 */
  alwaysVisible: 'identity.contact.alwaysVisible',
} as const;

export interface ContactFieldView {
  key: string;
  labelKey: string;
  label: string;
  value: string;
  filled: boolean;
  /** true 表示这是"未填写"占位（刻意区别于"他隐藏了"） */
  placeholder: boolean;
}

export interface ContactCardView {
  fields: ContactFieldView[];
  anyFilled: boolean;
  unfilledCount: number;
  /** 恒为 true：产品规则是"加入即交换名片，联系方式不可隐藏" */
  alwaysVisible: true;
  alwaysVisibleNote: string;
}

export function cloneContactCard(card: LianXiKa | undefined): LianXiKa {
  const out: LianXiKa = {};
  if (!card) return out;
  if (typeof card.email === 'string') out.email = card.email;
  if (typeof card.phone === 'string') out.phone = card.phone;
  if (Array.isArray(card.extra)) {
    out.extra = card.extra
      .filter((e) => e && (typeof e.label === 'string' || typeof e.value === 'string'))
      .map((e) => ({ label: String(e.label ?? ''), value: String(e.value ?? '') }));
  }
  if (typeof card.updatedAt === 'number') out.updatedAt = card.updatedAt;
  return out;
}

/** 是否一个字段都没有填（不用于展示，只用于内部判断） */
export function isContactCardEmpty(card: LianXiKa | undefined): boolean {
  const c = cloneContactCard(card);
  const hasEmail = typeof c.email === 'string' && c.email.trim().length > 0;
  const hasPhone = typeof c.phone === 'string' && c.phone.trim().length > 0;
  const hasExtra = (c.extra || []).some((e) => e.label.trim() || e.value.trim());
  return !hasEmail && !hasPhone && !hasExtra;
}

// ── 换证后的「联系信息冻结期」（需求更正新增，7 天） ──

/** 冻结时长：7 天 */
export const CONTACT_FREEZE_MS = 7 * 24 * 3600_000;
export const CONTACT_FREEZE_DAYS = 7;

/**
 * 冻结期说明（必须如实告诉用户，别把它说成安全机制）：
 * 它只是"给熟人留出的核实窗口"，用来**减小抢占带来的损害**，不能阻止抢占本身。
 */
export const CONTACT_FREEZE_NOTE =
  '换证后的 7 天内不得新增或修改联系方式：换证通知的接收方在这 7 天里也继续使用本机历史留存的名片（不采用新名片）。冻结期从**接收方本机收到通知的时刻**起算，由每个接收方本地各自判定 —— 不使用声明里的时间戳，也不依赖对方广播的"冻结中"标志（两者都可以伪造）。冻结期结束后**也不会自动采用新值**，要由接收方手动确认（避免"等够 7 天就悄悄换掉"）。首次加入（从未见过换证）不受限。这是给熟人留出的核实窗口，不能阻止抢占，只能减小损害。';

export interface ContactFreezeState {
  frozen: boolean;
  /** 冻结截止时刻；0 = 从未/不处于冻结 */
  contactFreezeUntil: number;
  remainingMs: number;
  /** 本机记录的起算时刻（= contactFreezeUntil - 7 天） */
  since: number;
  /** 到期的本地时间点（ISO，便于展示与审计） */
  untilIso: string;
  note: string;
}

/** 冻结状态判定（纯计算：只依赖本机时钟与本机记录） */
export function contactFreezeState(contactFreezeUntil: number | undefined, now: number = Date.now()): ContactFreezeState {
  const until = Number(contactFreezeUntil || 0);
  const frozen = until > now;
  return {
    frozen,
    contactFreezeUntil: until,
    remainingMs: frozen ? until - now : 0,
    since: until ? until - CONTACT_FREEZE_MS : 0,
    untilIso: until ? new Date(until).toISOString() : '',
    note: CONTACT_FREEZE_NOTE,
  };
}

/** 本机留存的名片版本（append-only）：换证横幅要展示的"旧联系方式"就来自这里 */
export interface ContactCardVersion {
  card: LianXiKa;
  at: number;
  note: 'created' | 'updated' | 'rotation' | 'imported';
}

/** 本机身份的名片历史（**永远本地留存**，不进任何对外声明） */
export function contactCardHistory(identity: IdentityRecord): ContactCardVersion[] {
  const h = Array.isArray(identity.cardHistory) ? identity.cardHistory : [];
  return h.map((v) => ({ card: cloneContactCard(v.card), at: v.at, note: v.note }));
}

/** 最近一次改名片之前的留存值（UI 要"旧/新并列展示"时取旧的） */
export function previousLocalContactCard(identity: IdentityRecord): LianXiKa | null {
  const h = contactCardHistory(identity);
  // 末尾一条是当前值，倒数第二条才是"旧的"；若只有创建这一条则没有旧的
  if (h.length < 2) return null;
  return h[h.length - 2]!.card;
}

// ── 接收方侧：对某个对端身份的联系资料状态（本机各自判定） ──

/**
 * 对端联系资料状态。**全部由本机自己积累**：
 *  - storedCard  —— 对方当初加入群/项目、加联系人时交换并存在**本机**的名片（攻击者改不了）；
 *  - pendingCard —— 换证后收到的新名片，冻结期内**只留不用**；
 *  - receivedAt  —— 本机收到换证通知的时刻（作废/换证 7 天冻结的起算点）。
 * 这三个字段都不来自任何可伪造的广播，所以本地判定是可信的。
 */
export interface PeerContactState {
  fingerprint: string;
  storedCard: LianXiKa;
  storedAt: number;
  pendingCard: LianXiKa | null;
  pendingAt: number;
  receivedAt: number;
  contactFreezeUntil: number;
  /** 冻结期已过、但新名片**仍未被采用**（等接收方手动确认） */
  awaitingConfirmation: boolean;
  /** 已知最高代次（代次规则用） */
  generation: number;
}

export interface DuiDuanLianXiShiTu {
  fingerprint: string;
  /** UI 要**并列展示**的两个字段之一：本机历史留存的名片（旧） */
  previousCard: LianXiKa;
  /** 与（若已收到）对方新提交的名片；冻结期内不被采用；没有则为 null */
  pendingCard: LianXiKa | null;
  /** 当前应展示/使用的名片：冻结期内恒等于 previousCard */
  effectiveCard: LianXiKa;
  contactFreezeUntil: number;
  frozen: boolean;
  remainingMs: number;
  receivedAt: number;
  generation: number;
  /** 当前生效值是不是**本机历史留存值**（冻结期内恒为 true；UI 文案必须写清来源） */
  usingStoredHistory: boolean;
  /** 是否"已收到但因冻结期未采用"的新名片 */
  pendingIsHeldBack: boolean;
  /** 冻结期已过但尚未手动确认（UI 要提示"需要你手动确认"） */
  awaitingConfirmation: boolean;
  note: string;
}

/** 首次加入：**不受冻结限制**（否则新人根本填不了联系方式） */
export function createPeerContact(fingerprint: string, card: LianXiKa | undefined, now: number = Date.now()): PeerContactState {
  return {
    fingerprint,
    storedCard: cloneContactCard(card),
    storedAt: now,
    pendingCard: null,
    pendingAt: 0,
    receivedAt: 0,
    contactFreezeUntil: 0,
    awaitingConfirmation: false,
    generation: 0,
  };
}

/** 收到对方换证通知：**从本机此刻**起算 7 天冻结（不用声明里的时间戳） */
export function peerContactOnRotation(
  state: PeerContactState,
  now: number = Date.now(),
  generation?: number,
): PeerContactState {
  return {
    ...state,
    receivedAt: now,
    contactFreezeUntil: now + CONTACT_FREEZE_MS,
    generation: typeof generation === 'number' && generation > state.generation ? generation : state.generation,
  };
}

/**
 * 收到名片（加入时交换 / 换证后补发）：
 *  - 不在冻结期 → 直接采用（首次加入走这条）；
 *  - 在冻结期 → 只记为 pendingCard，冻结期满前 effectiveCard 仍是本机留存值。
 */
export function peerContactOnCard(state: PeerContactState, card: LianXiKa | undefined, now: number = Date.now()): PeerContactState {
  const next = cloneContactCard(card);
  if (state.contactFreezeUntil > now) {
    return { ...state, pendingCard: next, pendingAt: now };
  }
  return { ...state, storedCard: next, storedAt: now, pendingCard: null, pendingAt: 0, contactFreezeUntil: 0 };
}

/**
 * 冻结到期处理。
 * 默认**不自动采用**新值（只清掉冻结标记并置 `awaitingConfirmation`）——
 * 与 UI 文案一致：「冻结期已结束，但不会自动采用新值——需要你手动确认」。
 * `autoPromote: true` 才直接提升，供确实想静默生效的调用方显式选择。
 */
export function peerContactSettle(
  state: PeerContactState,
  now: number = Date.now(),
  opts: { autoPromote?: boolean } = {},
): PeerContactState {
  if (!state.contactFreezeUntil || state.contactFreezeUntil > now) return state;
  if (!state.pendingCard) return { ...state, contactFreezeUntil: 0, awaitingConfirmation: false };
  if (!opts.autoPromote) return { ...state, contactFreezeUntil: 0, awaitingConfirmation: true };
  return {
    ...state,
    storedCard: cloneContactCard(state.pendingCard),
    storedAt: state.pendingAt || now,
    pendingCard: null,
    pendingAt: 0,
    contactFreezeUntil: 0,
    awaitingConfirmation: false,
  };
}

/**
 * 接收方**手动确认**采用新名片（冻结期结束后才允许；冻结期内调用不生效）。
 */
export function peerContactConfirm(state: PeerContactState, now: number = Date.now()): PeerContactState {
  if (state.contactFreezeUntil > now) return state;
  if (!state.pendingCard) return { ...state, contactFreezeUntil: 0, awaitingConfirmation: false };
  return {
    ...state,
    storedCard: cloneContactCard(state.pendingCard),
    storedAt: now,
    pendingCard: null,
    pendingAt: 0,
    contactFreezeUntil: 0,
    awaitingConfirmation: false,
  };
}

/** 对端名片视图：两个字段（旧/新）并列，外加冻结状态 */
export function peerContactView(state: PeerContactState, now: number = Date.now()): DuiDuanLianXiShiTu {
  const wasFrozen = state.contactFreezeUntil > now;
  const settled = peerContactSettle(state, now);
  const freeze = contactFreezeState(settled.contactFreezeUntil, now);
  return {
    fingerprint: settled.fingerprint,
    previousCard: cloneContactCard(settled.storedCard),
    pendingCard: settled.pendingCard ? cloneContactCard(settled.pendingCard) : null,
    effectiveCard: cloneContactCard(settled.storedCard),
    contactFreezeUntil: settled.contactFreezeUntil,
    frozen: freeze.frozen,
    remainingMs: freeze.remainingMs,
    receivedAt: settled.receivedAt,
    generation: settled.generation,
    usingStoredHistory: wasFrozen || freeze.frozen || settled.awaitingConfirmation,
    pendingIsHeldBack: freeze.frozen && !!settled.pendingCard,
    awaitingConfirmation: settled.awaitingConfirmation,
    note: CONTACT_FREEZE_NOTE,
  };
}

/**
 * 名片视图：**空字段渲染成占位**，而不是删掉这一行。
 * 这是附六第 2 条的落地：字段可空，但界面必须展示占位。
 */
export function contactCardView(card: LianXiKa | undefined, t: Translate = (k) => k): ContactCardView {
  const c = cloneContactCard(card);
  const unfilled = t(CONTACT_CARD_I18N.unfilled);
  const fields: ContactFieldView[] = [];
  const push = (key: string, labelKey: string, raw: string | undefined): void => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const filled = value.length > 0;
    fields.push({
      key,
      labelKey,
      label: t(labelKey),
      value: filled ? value : unfilled,
      filled,
      placeholder: !filled,
    });
  };
  push('email', CONTACT_CARD_I18N.email, c.email);
  push('phone', CONTACT_CARD_I18N.phone, c.phone);
  for (const [i, e] of (c.extra || []).entries()) {
    push(`extra:${i}:${e.label}`, e.label || CONTACT_CARD_I18N.extra, e.value);
  }
  const unfilledCount = fields.filter((f) => !f.filled).length;
  return {
    fields,
    anyFilled: unfilledCount < fields.length,
    unfilledCount,
    alwaysVisible: true,
    alwaysVisibleNote: t(CONTACT_CARD_I18N.alwaysVisible),
  };
}

// ── 身份记录 ──

/** 退役密钥：**保公钥、丢私钥**（附三.3）—— 换证后历史签名仍可验证 */
export interface RetiredKey {
  fingerprint: string;
  /** SPKI DER base64 */
  publicKey: string;
  /** 该密钥**最后使用**的代次 */
  generation: number;
  retiredAt: number;
}

/**
 * 身份（可公开传播的部分）。
 * **不含私钥**：私钥只在 identity-store 里以加密形式落盘，且只在主进程内存里解密。
 */
export interface IdentityRecord {
  schema: typeof IDENTITY_SCHEMA;
  algo: typeof IDENTITY_ALGO;
  /** 人读别名：旧的 9 位 deviceId（保留兼容，**不是**身份） */
  alias: string;
  /** 身份主键：公钥指纹 */
  fingerprint: string;
  /** 单调代次：创建 = 1，每次换证 +1 */
  generation: number;
  createdAt: number;
  updatedAt: number;
  /** 本机当前名片（对外展示、加入时交换；换证声明里**不含**它） */
  contactCard: LianXiKa;
  /**
   * 本机的名片历史（append-only）。**换证横幅要展示的"旧联系方式"取自这里**，
   * 不取自任何（可被攻击者生成的）换证声明 —— 见文件头第 3 条。
   */
  cardHistory: ContactCardVersion[];
  /**
   * 联系信息冻结期截止时刻（0 = 未冻结）。
   * 换证后 7 天内不得新增/修改联系方式（接收方同样 7 天内不采用新名片）。
   */
  contactFreezeUntil: number;
  /** 当前身份公钥（SPKI DER base64） */
  publicKey: string;
  retiredKeys: RetiredKey[];
  /** 历史声明（换证 + 作废），供联系人/群同步；只追加 */
  declarations: IdentityDeclaration[];
}

/** 密钥环条目：当前公钥 + 全部退役公钥（验签用） */
export interface YaoShiHuanTiaoMu {
  fingerprint: string;
  publicKey: string;
  generation: number;
  current: boolean;
}

export function keyRing(identity: IdentityRecord): YaoShiHuanTiaoMu[] {
  return [
    { fingerprint: identity.fingerprint, publicKey: identity.publicKey, generation: identity.generation, current: true },
    ...identity.retiredKeys.map((r) => ({
      fingerprint: r.fingerprint,
      publicKey: r.publicKey,
      generation: r.generation,
      current: false,
    })),
  ];
}

export function currentContactCard(identity: IdentityRecord): LianXiKa {
  return cloneContactCard(identity.contactCard);
}

// ── 密钥对 ──

export interface GeneratedKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  /** SPKI DER base64 */
  publicKeyB64: string;
  /** PKCS8 DER：只在内存/加密载荷里出现，绝不落盘明文 */
  privateKeyDer: Buffer;
}

/**
 * 生成 Ed25519 身份密钥对。用 Node 内置 crypto，**不引新依赖**（ADR 000 不变量 #4：零原生模块）。
 */
export function generateIdentityKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey,
    privateKey,
    publicKeyB64: publicKeyToB64(publicKey),
    privateKeyDer: privateKeyToDer(privateKey),
  };
}

export function publicKeyToB64(publicKey: KeyObject): string {
  return (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
}

export function privateKeyToDer(privateKey: KeyObject): Buffer {
  return privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
}

export function keyObjectFromPrivateDer(der: Buffer): KeyObject {
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * 由私钥推出公钥（用于"私钥与指纹是否匹配"的自检）。
 * 注意 @types/node 各版本对 `createPublicKey` 的重载不一致（20.x 含 KeyObject、26.x 不含），
 * 这里显式走 `PublicKeyInput` 这一支，两个版本都能编过。
 */
export function publicKeyOfPrivate(privateKey: KeyObject): KeyObject {
  return crypto.createPublicKey(privateKey as unknown as crypto.PublicKeyInput) as KeyObject;
}

/** 从 SPKI base64 还原公钥；非法输入返回 null（调用方据此判定"验不了"，而不是当成验签失败） */
export function keyObjectFromPublicB64(b64: string): KeyObject | null {
  try {
    return crypto.createPublicKey({ key: Buffer.from(String(b64 || ''), 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

// ── 创建身份 ──

export interface CreateIdentityOptions {
  /** 人读别名（旧的 9 位 deviceId 或自定义短码） */
  alias: string;
  contactCard?: LianXiKa;
  /** 允许导入既有密钥（备份恢复 / 迁移） */
  keyPair?: GeneratedKeyPair;
  generation?: number;
  now?: number;
}

export interface CreateIdentityResult {
  identity: IdentityRecord;
  keyPair: GeneratedKeyPair;
}

/** 造一个新身份（代次默认 1）。**不落盘** —— 落盘在 identity-store。 */
export function createIdentity(opts: CreateIdentityOptions): CreateIdentityResult {
  const keyPair = opts.keyPair || generateIdentityKeyPair();
  const now = opts.now ?? Date.now();
  const generation = opts.generation && opts.generation > 0 ? opts.generation : 1;
  const initialCard: LianXiKa = { ...cloneContactCard(opts.contactCard), updatedAt: now };
  const identity: IdentityRecord = {
    schema: IDENTITY_SCHEMA,
    algo: IDENTITY_ALGO,
    alias: String(opts.alias || ''),
    fingerprint: fingerprintFromPublicKey(keyPair.publicKeyB64),
    generation,
    createdAt: now,
    updatedAt: now,
    contactCard: initialCard,
    /** 首次加入不受冻结限制（尚无换证） */
    cardHistory: [{ card: cloneContactCard(initialCard), at: now, note: 'created' }],
    contactFreezeUntil: 0,
    publicKey: keyPair.publicKeyB64,
    retiredKeys: [],
    declarations: [],
  };
  return { identity, keyPair };
}

// ── 签名 / 验签 ──

/** 确定性序列化：键排序 + 丢 undefined —— 签名覆盖的字节必须两端一致 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  if (t === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`;
  }
  return 'null';
}

/** 域分隔 + 规范化载荷（同域同载荷 → 同字节；不同用途不互串） */
export function signingBytes(domain: string, payload: unknown): Buffer {
  return Buffer.from(`${domain}\n${typeof payload === 'string' ? payload : canonicalize(payload)}`, 'utf8');
}

export interface SignedPayload {
  schema: typeof SIGNED_PAYLOAD_SCHEMA;
  kind: 'warmy.identity.signed';
  version: 1;
  domain: string;
  payload: string;
  /** 签名者指纹（用哪个密钥签的） */
  fingerprint: string;
  generation: number;
  algo: typeof IDENTITY_ALGO;
  signedAt: number;
  signature: string;
}

/**
 * 用身份私钥签一段内容。返回**自描述信封**（带指纹与代次），
 * 这样接收方拿到消息就能知道"该用谁的哪一代公钥验"。
 */
export function signWithIdentity(
  privateKey: KeyObject,
  identity: IdentityRecord | undefined,
  payload: string,
  opts: { domain?: string; now?: number } = {},
): SignedPayload {
  const domain = opts.domain || DOMAIN_STATEMENT;
  const fingerprint = identity?.fingerprint || '';
  const signature = crypto.sign(null, signingBytes(domain, payload), privateKey).toString('base64');
  return {
    schema: SIGNED_PAYLOAD_SCHEMA,
    kind: 'warmy.identity.signed',
    version: 1,
    domain,
    payload,
    fingerprint,
    generation: identity?.generation ?? 1,
    algo: IDENTITY_ALGO,
    signedAt: opts.now ?? Date.now(),
    signature,
  };
}

export type VerifyReason =
  | 'ok'
  | 'malformed'
  | 'bad-signature'
  | 'unknown-fingerprint'
  | 'fingerprint-mismatch'
  | 'payload-mismatch';

export interface yanzhengJieguo {
  ok: boolean;
  reason: VerifyReason;
  fingerprint: string;
  generation?: number;
  /** 命中哪把钥匙 */
  matched?: 'current' | 'retired';
  detail?: string;
}

/**
 * 按指纹验签：在密钥环里找到该指纹对应的公钥（当前或退役）后验签。
 *
 * 注意"验签成功"的含义**仅限**：这段内容确实由该身份的对应代次私钥签出。
 * 它不证明"对方现在还是那个人"（换证/被偷都可能），后者靠代次规则 + 人工核实。
 */
export function verifyByFingerprint(
  fingerprint: string,
  payload: string,
  signatureB64: string,
  keys: YaoShiHuanTiaoMu[],
  opts: { domain?: string } = {},
): yanzhengJieguo {
  const domain = opts.domain || DOMAIN_STATEMENT;
  if (!isValidFingerprint(fingerprint)) {
    return { ok: false, reason: 'malformed', fingerprint: String(fingerprint || ''), detail: 'fingerprint 形态/校验位不合法' };
  }
  const entry = keys.find((k) => fingerprintMatches(k.fingerprint, fingerprint));
  if (!entry) {
    return { ok: false, reason: 'unknown-fingerprint', fingerprint, detail: '密钥环里没有这个指纹（当前或退役）' };
  }
  return verifyWithEntry(entry, payload, signatureB64, domain);
}

function verifyWithEntry(entry: YaoShiHuanTiaoMu, payload: string, signatureB64: string, domain: string): yanzhengJieguo {
  const pub = keyObjectFromPublicB64(entry.publicKey);
  const base: yanzhengJieguo = {
    ok: false,
    reason: 'bad-signature',
    fingerprint: entry.fingerprint,
    generation: entry.generation,
    matched: entry.current ? 'current' : 'retired',
  };
  if (!pub) return { ...base, reason: 'malformed', detail: '公钥无法解析' };
  let sig: Buffer;
  try {
    sig = Buffer.from(String(signatureB64 || ''), 'base64');
  } catch {
    return { ...base, detail: '签名不是合法 base64' };
  }
  if (sig.length !== 64) return { ...base, detail: `Ed25519 签名应为 64 字节，实际 ${sig.length}` };
  try {
    const ok = crypto.verify(null, signingBytes(domain, payload), pub, sig);
    return ok ? { ...base, ok: true, reason: 'ok' } : base;
  } catch (e) {
    return { ...base, detail: e instanceof Error ? e.message : 'verify threw' };
  }
}

/** 验自描述信封：先按信封里声明的指纹找钥匙，再验签名与载荷一致性 */
export function verifySignedPayload(env: SignedPayload, keys: YaoShiHuanTiaoMu[]): yanzhengJieguo {
  if (!env || typeof env !== 'object' || env.schema !== SIGNED_PAYLOAD_SCHEMA || typeof env.signature !== 'string') {
    return { ok: false, reason: 'malformed', fingerprint: String(env?.fingerprint || ''), detail: '信封结构不合法' };
  }
  return verifyByFingerprint(env.fingerprint, env.payload, env.signature, keys, { domain: env.domain || DOMAIN_STATEMENT });
}

// ── 换证（主动轮换）：迁移声明 + 作废声明 ──

/**
 * 迁移声明：旧公钥 → 新公钥 + 代次 + 时间戳 + 签名。
 *
 * ⚠️ **声明里不得出现任何联系方式**（需求更正后的硬规则）：
 * 声明是**可能被攻击者控制的数据**（密钥被偷后由攻击者生成），
 * 若让"旧联系方式"随声明走，攻击者就能伪造旧名片来冒充熟人流程；
 * 所以旧联系方式一律由**接收方本机已存的那一份**提供（见 PeerContactState / contactCardHistory）。
 * `verifyRotationDeclaration` 会显式拒绝携带联系方式的声明（reason: 'contact-not-allowed'）。
 */
export interface LunHuanShengMing {
  schema: typeof ROTATION_SCHEMA;
  kind: 'warmy.identity.rotation';
  version: 1;
  algo: typeof IDENTITY_ALGO;
  /** 旧指纹（签名者） */
  oldFingerprint: string;
  oldPublicKey: string;
  /** 旧密钥的代次 */
  previousGeneration: number;
  /** 新指纹 */
  newFingerprint: string;
  newPublicKey: string;
  /** 新密钥的代次（= previousGeneration + 1） */
  generation: number;
  issuedAt: number;
  reason?: string;
  signerFingerprint: string;
  signature: string;
}

/**
 * 作废声明：用**旧私钥**签"这把旧密钥作废"。
 * 只对**仍持有旧私钥**的人可用 —— 私钥已丢/已泄漏时，这份声明恰恰是攻击者也能伪造的东西。
 */
export interface RevocationDeclaration {
  schema: typeof REVOCATION_SCHEMA;
  kind: 'warmy.identity.revocation';
  version: 1;
  algo: typeof IDENTITY_ALGO;
  /** 被作废的指纹（= 签名者） */
  fingerprint: string;
  publicKey: string;
  /** 该密钥最后使用的代次 */
  generation: number;
  /** 接替它的新指纹（若已换证） */
  supersededBy?: string;
  issuedAt: number;
  reason?: string;
  signerFingerprint: string;
  signature: string;
}

export type IdentityDeclaration = LunHuanShengMing | RevocationDeclaration;

/** 迁移声明的签名载荷（去掉 signature 字段后规范化） */
export function rotationSigningPayload(decl: LunHuanShengMing): Record<string, unknown> {
  const { signature: _sig, ...rest } = decl;
  return rest as unknown as Record<string, unknown>;
}

export function revocationSigningPayload(decl: RevocationDeclaration): Record<string, unknown> {
  const { signature: _sig, ...rest } = decl;
  return rest as unknown as Record<string, unknown>;
}

export interface RotateArgs {
  identity: IdentityRecord;
  /** 旧私钥（换证必须由它签名） */
  privateKey: KeyObject;
  reason?: string;
  now?: number;
}

export interface RotateOutput {
  /** 新的身份记录（代次 +1，旧公钥进 retiredKeys，联系资料冻结 7 天） */
  identity: IdentityRecord;
  keyPair: GeneratedKeyPair;
  declaration: LunHuanShengMing;
  revocation: RevocationDeclaration;
  /** 换证前的名片（**取自本机留存历史**，不是声明）—— 供横幅展示"旧联系方式" */
  previousCard: LianXiKa;
  contactFreezeUntil: number;
}

/**
 * 主动轮换：新密钥对 + 代次 +1 + 迁移声明（**不含任何联系方式**）+ 作废声明，两条都用**旧私钥**签。
 * 换证同时开启**联系信息冻结期 7 天**：期间本机不得新增/修改联系方式
 * （否则被偷钥匙的人可以"换证 + 改成自己的联系方式"一步到位，熟人容易被骗）。
 * **不落盘** —— 落盘在 identity-store（并同时把新私钥重新加密）。
 */
export function rotateIdentity(args: RotateArgs): RotateOutput {
  const { identity, privateKey } = args;
  const now = args.now ?? Date.now();
  const keyPair = generateIdentityKeyPair();
  const previousFingerprint = identity.fingerprint;
  const previousGeneration = identity.generation;
  const generation = previousGeneration + 1;
  /** 旧名片：从**本机留存历史**取（不进声明） */
  const previousCard = cloneContactCard(identity.contactCard);
  const contactFreezeUntil = now + CONTACT_FREEZE_MS;

  const declarationDraft: Omit<LunHuanShengMing, 'signature'> = {
    schema: ROTATION_SCHEMA,
    kind: 'warmy.identity.rotation',
    version: 1,
    algo: IDENTITY_ALGO,
    oldFingerprint: previousFingerprint,
    oldPublicKey: identity.publicKey,
    previousGeneration,
    newFingerprint: fingerprintFromPublicKey(keyPair.publicKeyB64),
    newPublicKey: keyPair.publicKeyB64,
    generation,
    issuedAt: now,
    ...(args.reason ? { reason: args.reason } : {}),
    signerFingerprint: previousFingerprint,
  };
  const declaration: LunHuanShengMing = {
    ...declarationDraft,
    signature: crypto
      .sign(null, signingBytes(ROTATION_SCHEMA, declarationDraft as unknown as Record<string, unknown>), privateKey)
      .toString('base64'),
  };

  const revocationDraft: Omit<RevocationDeclaration, 'signature'> = {
    schema: REVOCATION_SCHEMA,
    kind: 'warmy.identity.revocation',
    version: 1,
    algo: IDENTITY_ALGO,
    fingerprint: previousFingerprint,
    publicKey: identity.publicKey,
    generation: previousGeneration,
    supersededBy: declaration.newFingerprint,
    issuedAt: now,
    ...(args.reason ? { reason: args.reason } : {}),
    signerFingerprint: previousFingerprint,
  };
  const revocation: RevocationDeclaration = {
    ...revocationDraft,
    signature: crypto
      .sign(null, signingBytes(REVOCATION_SCHEMA, revocationDraft as unknown as Record<string, unknown>), privateKey)
      .toString('base64'),
  };

  const next: IdentityRecord = {
    ...identity,
    fingerprint: declaration.newFingerprint,
    publicKey: keyPair.publicKeyB64,
    generation,
    updatedAt: now,
    /** 换证**不改**联系资料（改了也要被冻结期挡住），名片历史只追加"换证"这一条时间点 */
    contactCard: cloneContactCard(identity.contactCard),
    contactFreezeUntil,
    cardHistory: [...(identity.cardHistory || []), { card: cloneContactCard(identity.contactCard), at: now, note: 'rotation' as const }],
    // 保公钥、丢私钥
    retiredKeys: [
      ...identity.retiredKeys,
      {
        fingerprint: previousFingerprint,
        publicKey: identity.publicKey,
        generation: previousGeneration,
        retiredAt: now,
      },
    ],
    declarations: [...identity.declarations, declaration as IdentityDeclaration, revocation as IdentityDeclaration],
  };

  return { identity: next, keyPair, declaration, revocation, previousCard, contactFreezeUntil };
}

// ── 换证声明的验签 + 代次规则 ──

export type RotationRejectReason =
  | 'ok'
  | 'malformed'
  | 'bad-signature'
  | 'fingerprint-mismatch'
  | 'generation-not-increasing'
  | 'stale-generation'
  | 'timestamp-in-future'
  /** 声明里带了联系方式：一律拒绝（需求更正后的硬规则；旧名片只能取自本机留存） */
  | 'contact-not-allowed';

export interface RotationVerifyOptions {
  /** 已知的旧密钥（该联系人的密钥环）；用于确认"这确实是他用过的密钥" */
  knownKeys?: YaoShiHuanTiaoMu[];
  /** 已知该身份的最高代次（联系人本地记录） */
  currentGeneration?: number;
  now?: number;
  clockSkewMs?: number;
}

export interface LunHuanYanZhengJieGuo {
  accepted: boolean;
  reason: RotationRejectReason;
  oldFingerprint: string;
  newFingerprint: string;
  generation: number;
  previousGeneration: number;
  warnings: string[];
  /** ⚠️ 必须原样带给 UI：本节规则只防回滚、不防抢占 */
  honestNote: string;
  detail?: string;
}

/**
 * 验一条迁移声明，并应用**单调代次规则**：
 *   接受条件 = 签名由旧公钥验过 + 新公钥指纹自洽 + `generation > previousGeneration`
 *            + `generation > 已知代次`（currentGeneration / 已知密钥的代次）
 *            + 时间戳不在未来（容差 clockSkewMs）
 *
 * 拒绝旧代次时 reason = 'stale-generation'。**这不是"防抢占"** ——
 * 攻击者持有旧私钥时，他也能签出"合法且代次更高"的声明，规则会照样接受（见 GENERATION_RULE_NOTE）。
 */
export function verifyRotationDeclaration(
  decl: LunHuanShengMing,
  opts: RotationVerifyOptions = {},
): LunHuanYanZhengJieGuo {
  const now = opts.now ?? Date.now();
  const skew = opts.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const base: LunHuanYanZhengJieGuo = {
    accepted: false,
    reason: 'malformed',
    oldFingerprint: String(decl?.oldFingerprint || ''),
    newFingerprint: String(decl?.newFingerprint || ''),
    generation: Number(decl?.generation || 0),
    previousGeneration: Number(decl?.previousGeneration || 0),
    warnings: [],
    honestNote: GENERATION_RULE_NOTE,
  };
  if (!decl || typeof decl !== 'object' || decl.schema !== ROTATION_SCHEMA || typeof decl.signature !== 'string') {
    return { ...base, detail: '结构不合法' };
  }
  // 0) 声明里不得出现任何联系方式（攻击者可控制声明 → 不能拿它当"旧名片"的来源）
  const CONTACT_KEYS = ['contactCard', 'previousContactCard', 'contact', 'card', 'email', 'phone', 'contactCardSnapshot'];
  const injected = Object.keys(decl as unknown as Record<string, unknown>).filter((k) => CONTACT_KEYS.includes(k));
  if (injected.length) {
    return { ...base, reason: 'contact-not-allowed', detail: `声明不得携带联系方式（发现字段 ${injected.join(',')}）；旧名片只能取自接收方本机留存` };
  }
  if (decl.algo !== IDENTITY_ALGO) return { ...base, detail: `算法不支持: ${String(decl.algo)}` };
  if (!isValidFingerprint(decl.oldFingerprint) || !isValidFingerprint(decl.newFingerprint)) {
    return { ...base, reason: 'malformed', detail: '指纹形态/校验位不合法' };
  }
  if (!fingerprintMatches(fingerprintFromPublicKey(decl.oldPublicKey), decl.oldFingerprint)) {
    return { ...base, reason: 'fingerprint-mismatch', detail: '旧公钥与其指纹不一致' };
  }
  if (!fingerprintMatches(fingerprintFromPublicKey(decl.newPublicKey), decl.newFingerprint)) {
    return { ...base, reason: 'fingerprint-mismatch', detail: '新公钥与其指纹不一致' };
  }
  if (!fingerprintMatches(decl.signerFingerprint || decl.oldFingerprint, decl.oldFingerprint)) {
    return { ...base, reason: 'fingerprint-mismatch', detail: 'signerFingerprint 与旧指纹不一致（声明只能由旧密钥自签）' };
  }
  // ① 签名必须由**旧公钥**验过
  const oldEntry: YaoShiHuanTiaoMu = {
    fingerprint: decl.oldFingerprint,
    publicKey: decl.oldPublicKey,
    generation: decl.previousGeneration,
    current: false,
  };
  const sigRes = verifyWithEntry(
    oldEntry,
    canonicalize(rotationSigningPayload(decl)),
    decl.signature,
    ROTATION_SCHEMA,
  );
  if (!sigRes.ok) return { ...base, reason: 'bad-signature', detail: sigRes.detail || '旧私钥签名不通过' };

  // ② 时间戳不得在未来（只防荒谬的未来时间；本层不做过期判定）
  if (typeof decl.issuedAt !== 'number' || !Number.isFinite(decl.issuedAt)) {
    return { ...base, reason: 'malformed', detail: 'issuedAt 非法' };
  }
  if (decl.issuedAt > now + skew) {
    return { ...base, reason: 'timestamp-in-future', detail: `issuedAt 比本地时间超前 ${Math.round((decl.issuedAt - now) / 1000)}s` };
  }

  // ③ 代次必须严格递增（自洽）
  if (!(decl.generation > decl.previousGeneration)) {
    return { ...base, reason: 'generation-not-increasing', detail: `${decl.generation} 未大于 ${decl.previousGeneration}` };
  }

  // ④ 代次必须高于"已经知道的一切"（这才是防回滚）
  const knownGenerations = (opts.knownKeys || [])
    .filter((k) => fingerprintMatches(k.fingerprint, decl.oldFingerprint) || fingerprintMatches(k.fingerprint, decl.newFingerprint))
    .map((k) => k.generation);
  const knownMax = Math.max(opts.currentGeneration ?? 0, ...(knownGenerations.length ? knownGenerations : [0]));
  if (decl.generation <= knownMax) {
    return {
      ...base,
      reason: 'stale-generation',
      detail: `声明代次 ${decl.generation} 未高于已知代次 ${knownMax}（旧代次声明一律拒绝）`,
    };
  }

  const warnings: string[] = [];
  const oldKnown = (opts.knownKeys || []).some((k) => fingerprintMatches(k.fingerprint, decl.oldFingerprint));
  if (opts.knownKeys && !oldKnown) {
    warnings.push('旧公钥不在本地密钥环里（首次见到该身份）：这是 TOFU，无法确认新旧密钥的连续性');
  }
  if (decl.generation > decl.previousGeneration + 1) {
    warnings.push(`代次跳跃：${decl.previousGeneration} → ${decl.generation}（可能中间还有一次未收到的换证）`);
  }
  if (decl.issuedAt < now - 365 * 24 * 3600_000) {
    warnings.push('声明已签发超过一年（本层不做时效判定，仅提示）');
  }
  return {
    accepted: true,
    reason: 'ok',
    oldFingerprint: decl.oldFingerprint,
    newFingerprint: decl.newFingerprint,
    generation: decl.generation,
    previousGeneration: decl.previousGeneration,
    warnings,
    honestNote: GENERATION_RULE_NOTE,
  };
}

export interface RevocationVerifyResult {
  accepted: boolean;
  reason: 'ok' | 'malformed' | 'bad-signature' | 'fingerprint-mismatch';
  fingerprint: string;
  generation: number;
  warnings: string[];
  honestNote: string;
  detail?: string;
}

/** 验"旧的作废"声明：必须由被作废的那把密钥自签 */
export function verifyRevocationDeclaration(decl: RevocationDeclaration): RevocationVerifyResult {
  const base: RevocationVerifyResult = {
    accepted: false,
    reason: 'malformed',
    fingerprint: String(decl?.fingerprint || ''),
    generation: Number(decl?.generation || 0),
    warnings: [],
    honestNote:
      '作废声明只能由旧私钥自签 —— 私钥已泄漏时，攻击者同样能签。它能让熟人知道"这把钥匙下线了"，但**不能**阻止持有旧私钥的人继续冒充（更拦不住他抢先换证）。',
  };
  if (!decl || typeof decl !== 'object' || decl.schema !== REVOCATION_SCHEMA || typeof decl.signature !== 'string') {
    return { ...base, detail: '结构不合法' };
  }
  if (decl.algo !== IDENTITY_ALGO) return { ...base, detail: `算法不支持: ${String(decl.algo)}` };
  if (!isValidFingerprint(decl.fingerprint)) return { ...base, detail: '指纹形态/校验位不合法' };
  if (!fingerprintMatches(fingerprintFromPublicKey(decl.publicKey), decl.fingerprint)) {
    return { ...base, reason: 'fingerprint-mismatch', detail: '公钥与指纹不一致' };
  }
  const entry: YaoShiHuanTiaoMu = {
    fingerprint: decl.fingerprint,
    publicKey: decl.publicKey,
    generation: decl.generation,
    current: false,
  };
  const res = verifyWithEntry(entry, canonicalize(revocationSigningPayload(decl)), decl.signature, REVOCATION_SCHEMA);
  if (!res.ok) return { ...base, reason: 'bad-signature', detail: res.detail || '签名不通过' };
  const warnings: string[] = [];
  if (!decl.supersededBy) warnings.push('未声明接替者（supersededBy 缺失）：联系人应人工核对新指纹');
  return { accepted: true, reason: 'ok', fingerprint: decl.fingerprint, generation: decl.generation, warnings, honestNote: base.honestNote };
}

// ── 身份名片（附六第 1 条：加入动作即交换名片） ──

export interface ShenFenKa {
  schema: typeof IDENTITY_CARD_SCHEMA;
  kind: 'warmy.identity-card';
  version: 1;
  fingerprint: string;
  alias: string;
  generation: number;
  publicKey: string;
  contactCard: LianXiKa;
  issuedAt: number;
  signature: string;
}

export function exportIdentityCard(identity: IdentityRecord, privateKey: KeyObject, now = Date.now()): ShenFenKa {
  const draft = {
    schema: IDENTITY_CARD_SCHEMA,
    kind: 'warmy.identity-card' as const,
    version: 1 as const,
    fingerprint: identity.fingerprint,
    alias: identity.alias,
    generation: identity.generation,
    publicKey: identity.publicKey,
    contactCard: cloneContactCard(identity.contactCard),
    issuedAt: now,
  };
  return {
    ...draft,
    signature: crypto.sign(null, signingBytes(DOMAIN_CARD, draft as unknown as Record<string, unknown>), privateKey).toString('base64'),
  };
}

/** 验名片：自签 + 指纹自洽（确认"这张名片确实是该指纹的持有者发出的"） */
export function verifyIdentityCard(card: ShenFenKa): yanzhengJieguo {
  if (!card || typeof card !== 'object' || card.schema !== IDENTITY_CARD_SCHEMA || typeof card.signature !== 'string') {
    return { ok: false, reason: 'malformed', fingerprint: String(card?.fingerprint || ''), detail: '名片结构不合法' };
  }
  if (!isValidFingerprint(card.fingerprint)) {
    return { ok: false, reason: 'malformed', fingerprint: card.fingerprint, detail: '指纹形态/校验位不合法' };
  }
  if (!fingerprintMatches(fingerprintFromPublicKey(card.publicKey), card.fingerprint)) {
    return { ok: false, reason: 'fingerprint-mismatch', fingerprint: card.fingerprint, detail: '公钥与指纹不一致' };
  }
  const entry: YaoShiHuanTiaoMu = { fingerprint: card.fingerprint, publicKey: card.publicKey, generation: card.generation, current: true };
  const { signature: _s, ...draft } = card;
  return verifyWithEntry(entry, canonicalize(draft), card.signature, DOMAIN_CARD);
}
