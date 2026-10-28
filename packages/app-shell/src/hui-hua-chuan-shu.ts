/**
 * hui-hua-chuan-shu —— 会话消息真实传输的底层（第 82 轮 / #106）
 *
 * 只做纯逻辑：消息帧加密、发件箱去重、接收去重、有限并发与超时、
 * 每会话的 transport 成败记忆、全失败后的只读判定。
 *
 * 不碰 UI、不连 Electron、不读文件、不发起任何真实网络请求：
 * 真正的发送动作由调用方以 `send(transport, zhen, signal)` 注入。
 *
 * 设计口径：
 *  · 发送侧同一 msgId 只发一次（含并发重复调用）；
 *  · 接收侧同一 msgId 只认一次；
 *  · 单个会话最多 5 个并发尝试，每次尝试 8 秒超时（可注入）；
 *  · 每个会话只记最近成功的 ≤5 个 transport，失败的第一次标记、第二次剔除；
 *  · 任一 transport 成功即整体成功；全部失败 → onAllFailed + 该会话只读，
 *    后续发送不再尝试、不伪装成已送达（广播由上层负责）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 传输帧：v 固定为 1，便于以后升级协议。 */
export type ChuanShuZhen = {
  v: 1;
  msgId: string;
  sessionId: string;
  from: string;
  ts: number;
  payload: unknown;
  seq?: number;
};

/** AES-256-GCM 密文块；字段均为 base64。 */
export type ChuanShuMiWen = { iv: string; tag: string; data: string };

/** 传输通道标识（由调用方约定含义，例如 "mesh:peer-fingerprint"）。 */
export type ChuanShuTongDao = string;

/** 调用方注入的真实发送函数；signal 在超时/其它通道已成功时被 abort。 */
export type ChuanShuSongFa = (
  transport: ChuanShuTongDao,
  zhen: ChuanShuZhen,
  signal: AbortSignal,
) => unknown | Promise<unknown>;

/** 可注入的定时器，便于门禁用假时钟或短超时。 */
export type ChuanShuZhong = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type ChuanShuXuanXiang = {
  send: ChuanShuSongFa;
  /** 全部 transport 都失败时回调一次（会话进入只读）。 */
  onAllFailed?: (sessionId: string) => void;
  /** 单次尝试超时，默认 8000ms。 */
  timeoutMs?: number;
  clock?: ChuanShuZhong;
};

export type ChuanShuJieGuo = {
  ok: boolean;
  deliveredBy?: ChuanShuTongDao;
  attempts: number;
  readonly: boolean;
  /** 同一 msgId 的重复调用（没有再次发送）。 */
  duplicate?: boolean;
  error?: string;
};

/** 只读快照，便于观测与门禁断言。 */
export type ChuanShuKuaiZhao = {
  recent: ChuanShuTongDao[];
  failed: ChuanShuTongDao[];
  removed: ChuanShuTongDao[];
  readonly: boolean;
};

export const CHUAN_SHU_AAD = 'chuan-shu:v1';

export interface QunRuXiangJianYanShuRu {
  groupId?: string;
  sessionId?: string;
  payloadGroupId?: string;
  peerFingerprint?: string;
  memberFingerprints?: string[];
  creatorFingerprint?: string;
}

/**
 * 群聊入站消息的会话归属校验（第 109 轮定稿：**新版本不再兼容无指纹旧群**）。
 *
 * 发布口径：所有用户都用新版本，旧版本不兼容、不维护、数据不互通。
 * 因此“群没有成员指纹”不再是可放行的历史状态，而是**无法证明成员身份**的群：
 * 发送和接收都拒绝，直到创建者/成员重新签发指纹。绝不静默接收。
 */
export function qunRuXiangJianYan(p0: QunRuXiangJianYanShuRu): { ok: boolean; reason?: string } {
  const gid = String(p0?.groupId || '').trim();
  const sid = String(p0?.sessionId || '').trim();
  if (!gid) return { ok: false, reason: 'missing-group' };
  if (!sid || sid !== gid) return { ok: false, reason: 'session-group-mismatch' };
  const payloadGid = String(p0?.payloadGroupId || '').trim();
  if (payloadGid && payloadGid !== gid) return { ok: false, reason: 'payload-group-mismatch' };
  const peer = String(p0?.peerFingerprint || '').trim();
  if (!peer) return { ok: false, reason: 'missing-peer' };
  const members = (Array.isArray(p0?.memberFingerprints) ? p0.memberFingerprints : [])
    .map((x) => String(x || '').trim()).filter(Boolean);
  const creator = String(p0?.creatorFingerprint || '').trim();
  if (members.length === 0 && !creator) return { ok: false, reason: 'no-member-fingerprint' };
  if (creator && creator === peer) return { ok: true };
  if (members.includes(peer)) return { ok: true };
  return { ok: false, reason: 'not-a-member' };
}

/**
 * 推荐的 AAD：包含 sessionId，防止密文被搬到别的会话里重放。
 * 加密与解密必须使用同一个 AAD。
 */
export function aadHuiHua(sessionId: string): string {
  return `${CHUAN_SHU_AAD}:${sessionId}`;
}

const ZUI_DA_BING_FA = 5;
const ZUI_DA_FA_SONG = 4_096;
const ZUI_DA_SHOU = 8_192;
const MO_REN_CHAO_SHI = 8_000;
const CHANG_DU_IV = 12;
const CHANG_DU_TAG = 16;

const MO_REN_ZHONG: ChuanShuZhong = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type HuiHuaZhuangTai = {
  /** 最近成功的 transport，新的在前，最多 5 个。 */
  recent: ChuanShuTongDao[];
  /** 失败过一次、尚未剔除的 transport。 */
  failed: Set<ChuanShuTongDao>;
  /** 失败过两次、已从该会话候选里剔除的 transport。 */
  removed: Set<ChuanShuTongDao>;
};

type ChangShiJieGuo = { ok: boolean; error?: string };

function shiZhen(x: unknown): x is ChuanShuZhen {
  if (!x || typeof x !== 'object') return false;
  const z = x as Partial<ChuanShuZhen>;
  return (
    z.v === 1 &&
    typeof z.msgId === 'string' && z.msgId.length > 0 &&
    typeof z.sessionId === 'string' && z.sessionId.length > 0 &&
    typeof z.from === 'string' &&
    typeof z.ts === 'number' && Number.isFinite(z.ts)
  );
}

function yaoShi(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error('chuan-shu:key-must-be-32-bytes');
  }
  return Buffer.from(key);
}

/** 把一帧 JSON 用 AES-256-GCM 加密；篡改 data/tag/aad 都会在解密时失败。 */
export function jiaMiZhen(
  zhen: ChuanShuZhen,
  key: Uint8Array,
  aad: string = CHUAN_SHU_AAD,
): ChuanShuMiWen {
  if (!shiZhen(zhen)) throw new TypeError('chuan-shu:bad-zhen');
  const k = yaoShi(key);
  const iv = randomBytes(CHANG_DU_IV);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(zhen), 'utf8')),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** 解密并校验帧结构；认证失败统一抛 chuan-shu:jie-mi-shi-bai。 */
export function jieMiZhen(
  miWen: ChuanShuMiWen,
  key: Uint8Array,
  aad: string = CHUAN_SHU_AAD,
): ChuanShuZhen {
  if (
    !miWen || typeof miWen !== 'object' ||
    typeof miWen.iv !== 'string' ||
    typeof miWen.tag !== 'string' ||
    typeof miWen.data !== 'string'
  ) {
    throw new TypeError('chuan-shu:bad-mi-wen');
  }
  const k = yaoShi(key);
  const iv = Buffer.from(miWen.iv, 'base64');
  const tag = Buffer.from(miWen.tag, 'base64');
  if (iv.length !== CHANG_DU_IV || tag.length !== CHANG_DU_TAG) {
    throw new Error('chuan-shu:bad-mi-wen');
  }
  let zhen: unknown;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(miWen.data, 'base64')),
      decipher.final(),
    ]);
    zhen = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error('chuan-shu:jie-mi-shi-bai');
  }
  if (!shiZhen(zhen)) throw new Error('chuan-shu:jie-mi-shi-bai');
  return zhen;
}

/** 约定：返回 false 或 { ok:false } 视为失败；其余（含 undefined）视为成功。 */
function shiChengGong(r: unknown): boolean {
  if (r === false) return false;
  if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) return false;
  return true;
}

/**
 * 会话级发件箱。
 *
 * 每个实例独立维护：发送去重表、接收去重表、每会话的 transport 记忆与只读标记。
 * 所有状态都有上限，长期运行不会无限增长。
 */
export class ChuanShuDuiLie {
  private send: ChuanShuSongFa;
  private onAllFailed?: (sessionId: string) => void;
  private timeoutMs: number;
  private clock: ChuanShuZhong;
  private huiHua = new Map<string, HuiHuaZhuangTai>();
  private yiFa = new Map<string, Promise<ChuanShuJieGuo>>();
  private yiShou = new Set<string>();
  private zhiDu = new Set<string>();

  constructor(xuanXiang: ChuanShuXuanXiang) {
    if (!xuanXiang || typeof xuanXiang.send !== 'function') {
      throw new TypeError('chuan-shu:send-required');
    }
    this.send = xuanXiang.send;
    this.onAllFailed = xuanXiang.onAllFailed;
    const chaoShi = Number(xuanXiang.timeoutMs);
    this.timeoutMs = Number.isFinite(chaoShi) && chaoShi > 0 ? chaoShi : MO_REN_CHAO_SHI;
    this.clock = xuanXiang.clock || MO_REN_ZHONG;
  }

  /**
   * 发送一帧。相同 msgId 只真正发送一次；重复调用返回首次结果并带 duplicate 标记。
   * 会话只读后直接返回 ok:false，不发起任何尝试、不声称送达。
   */
  async faSong(
    zhen: ChuanShuZhen,
    transports: readonly ChuanShuTongDao[] = [],
  ): Promise<ChuanShuJieGuo> {
    if (!shiZhen(zhen)) throw new TypeError('chuan-shu:bad-zhen');
    const msgId = zhen.msgId;

    const yiFa = this.yiFa.get(msgId);
    if (yiFa) {
      const r = await yiFa;
      return { ...r, attempts: 0, duplicate: true };
    }

    if (this.zhiDu.has(zhen.sessionId)) {
      const r: ChuanShuJieGuo = { ok: false, attempts: 0, readonly: true, error: 'readonly' };
      this.cunFaSong(msgId, Promise.resolve(r));
      return r;
    }

    const renWu = this.zhiXing(zhen, transports);
    this.cunFaSong(msgId, renWu);
    return await renWu;
  }

  /** 接收一帧；同一 msgId 第一次返回 true，重复或结构非法返回 false。 */
  shouDao(zhen: ChuanShuZhen): boolean {
    if (!shiZhen(zhen)) return false;
    if (this.yiShou.has(zhen.msgId)) return false;
    this.yiShou.add(zhen.msgId);
    while (this.yiShou.size > ZUI_DA_SHOU) {
      const first = this.yiShou.values().next();
      if (first.done) break;
      this.yiShou.delete(first.value);
    }
    return true;
  }

  /** 该会话是否已因“全部失败”进入只读。 */
  shiZhiDu(sessionId: string): boolean {
    return this.zhiDu.has(sessionId);
  }

  /** shiZhiDu 的别名，便于按英文习惯调用。 */
  shiReadonly(sessionId: string): boolean {
    return this.shiZhiDu(sessionId);
  }

  /** 解除只读；不传 sessionId 时清空所有会话的只读标记。 */
  chongZhiReadonly(sessionId?: string): void {
    if (typeof sessionId === 'string') {
      this.zhiDu.delete(sessionId);
      return;
    }
    this.zhiDu.clear();
  }

  /** 只读快照：最近成功、已失败、已剔除、是否只读。 */
  kuaiZhao(sessionId: string): ChuanShuKuaiZhao {
    const s = this.huiHua.get(sessionId);
    return {
      recent: s ? [...s.recent] : [],
      failed: s ? [...s.failed] : [],
      removed: s ? [...s.removed] : [],
      readonly: this.zhiDu.has(sessionId),
    };
  }

  private cunFaSong(msgId: string, p: Promise<ChuanShuJieGuo>): void {
    this.yiFa.set(msgId, p);
    while (this.yiFa.size > ZUI_DA_FA_SONG) {
      const first = this.yiFa.keys().next();
      if (first.done) break;
      this.yiFa.delete(first.value);
    }
  }

  private zhuangTai(sessionId: string): HuiHuaZhuangTai {
    let s = this.huiHua.get(sessionId);
    if (!s) {
      s = { recent: [], failed: new Set(), removed: new Set() };
      this.huiHua.set(sessionId, s);
    }
    return s;
  }

  private chengGong(sessionId: string, transport: ChuanShuTongDao): void {
    const s = this.zhuangTai(sessionId);
    s.failed.delete(transport);
    s.removed.delete(transport);
    s.recent = [transport, ...s.recent.filter((t) => t !== transport)].slice(0, ZUI_DA_BING_FA);
  }

  private shiBai(sessionId: string, transport: ChuanShuTongDao): void {
    const s = this.zhuangTai(sessionId);
    if (s.failed.has(transport)) {
      // 第二次失败：从该会话候选里剔除，不再尝试。
      s.failed.delete(transport);
      s.removed.add(transport);
      s.recent = s.recent.filter((t) => t !== transport);
      return;
    }
    s.failed.add(transport);
  }

  private quanBuShiBai(sessionId: string, attempts: number): ChuanShuJieGuo {
    const diYiCi = !this.zhiDu.has(sessionId);
    this.zhiDu.add(sessionId);
    if (diYiCi && this.onAllFailed) {
      try {
        this.onAllFailed(sessionId);
      } catch {
        // 上层回调异常不应影响发送结果。
      }
    }
    return { ok: false, attempts, readonly: true, error: 'all-failed' };
  }

  private zhiXing(
    zhen: ChuanShuZhen,
    transports: readonly ChuanShuTongDao[],
  ): Promise<ChuanShuJieGuo> {
    const sessionId = zhen.sessionId;
    if (this.zhiDu.has(sessionId)) {
      return Promise.resolve({ ok: false, attempts: 0, readonly: true, error: 'readonly' });
    }

    const zhuang = this.zhuangTai(sessionId);
    const mingDan: ChuanShuTongDao[] = [];
    const yiJian = new Set<ChuanShuTongDao>();
    for (const t of transports) {
      if (typeof t !== 'string' || t.length === 0) continue;
      if (yiJian.has(t) || zhuang.removed.has(t)) continue;
      yiJian.add(t);
      mingDan.push(t);
    }

    // 最近成功的通道优先，其余按调用方给的顺序补齐。
    const paiXu: ChuanShuTongDao[] = [
      ...zhuang.recent.filter((t) => yiJian.has(t)),
      ...mingDan.filter((t) => !zhuang.recent.includes(t)),
    ];

    if (paiXu.length === 0) {
      return Promise.resolve(this.quanBuShiBai(sessionId, 0));
    }

    const zong = paiXu.length;
    const controls = new Set<AbortController>();
    let xia = 0;
    let huoDong = 0;
    let changShi = 0;
    let jieShu = false;

    return new Promise<ChuanShuJieGuo>((resolve) => {
      const wan = (r: ChuanShuJieGuo): void => {
        if (jieShu) return;
        jieShu = true;
        resolve(r);
      };

      const qiDong = (): void => {
        if (jieShu) return;
        while (huoDong < ZUI_DA_BING_FA && xia < zong) {
          const transport = paiXu[xia]!;
          xia += 1;
          huoDong += 1;
          changShi += 1;
          void this.changShi(transport, zhen, controls).then((r) => {
            huoDong -= 1;
            if (jieShu) return;
            if (r.ok) {
              this.chengGong(sessionId, transport);
              wan({
                ok: true,
                deliveredBy: transport,
                attempts: changShi,
                readonly: this.zhiDu.has(sessionId),
              });
              // 其它通道已经不需要了，abort 掉以尽快释放。
              for (const c of controls) {
                try {
                  c.abort();
                } catch {
                  // ignore
                }
              }
              return;
            }
            this.shiBai(sessionId, transport);
            if (huoDong === 0 && xia >= zong) {
              wan(this.quanBuShiBai(sessionId, changShi));
            } else {
              qiDong();
            }
          });
        }
        if (huoDong === 0 && xia >= zong) {
          wan(this.quanBuShiBai(sessionId, changShi));
        }
      };

      qiDong();
    });
  }

  private async changShi(
    transport: ChuanShuTongDao,
    zhen: ChuanShuZhen,
    controls: Set<AbortController>,
  ): Promise<ChangShiJieGuo> {
    const control = new AbortController();
    controls.add(control);
    let timer: unknown;
    try {
      const chaoShi = new Promise<ChangShiJieGuo>((resolve) => {
        timer = this.clock.setTimeout(() => {
          resolve({ ok: false, error: 'timeout' });
          try {
            control.abort();
          } catch {
            // ignore
          }
        }, this.timeoutMs);
      });
      const beiZhongDuan = new Promise<ChangShiJieGuo>((resolve) => {
        if (control.signal.aborted) {
          resolve({ ok: false, error: 'aborted' });
          return;
        }
        control.signal.addEventListener('abort', () => resolve({ ok: false, error: 'aborted' }), {
          once: true,
        });
      });
      const yiFa = Promise.resolve()
        .then(() => this.send(transport, zhen, control.signal))
        .then(
          (r): ChangShiJieGuo => (shiChengGong(r) ? { ok: true } : { ok: false, error: 'rejected' }),
          (): ChangShiJieGuo => ({ ok: false, error: 'send-failed' }),
        );
      return await Promise.race([yiFa, chaoShi, beiZhongDuan]);
    } finally {
      controls.delete(control);
      if (timer !== undefined) this.clock.clearTimeout(timer);
    }
  }
}
