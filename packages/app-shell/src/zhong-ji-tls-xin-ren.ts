/**
 * zhong-ji-tls-xin-ren —— 中继站 TLS 信任建立（R185，对应 FWArmy RELAY-TLS-TRUST-TO-WARMY §2 五项）。
 *
 * 两种模式（与 FWArmy 服务端一致）：
 *  · pin（默认，FWArmy 开箱自签）：TLS 握手后取证书 DER 的 sha256（hex 64）；
 *    首次见 → 交用户人工核对后固定；已固定 → 自动校验；不匹配 → 拒绝连接。
 *  · verify（FWArmy 配用户证书后）：按系统 CA + 域名校验（rejectUnauthorized:true + servername），
 *    零人工核对；若同时给了固定指纹，再做叠加校验。
 *
 * 硬纪律（安全边界，门禁直接断言）：
 *  1. **信任判定前绝不发送任何应用数据**（凭据/消息）——first-see / mismatch / ca-fail 一律销毁连接；
 *     调用方只有在 ok:true 之后才允许往 socket 写数据。
 *  2. 指纹只认 sha256(DER) hex 64；归一化容忍大小写/冒号/空格/连字符，非法一律 null（不猜）。
 *  3. 固定指纹按中继站条目持久化（重启保留，一条一个指纹），原子写盘。
 *  4. 纯 node 内建（crypto/tls/fs/path），不依赖 electron；门禁直接 import 编译产物跑真 TLS。
 */
import { createHash } from 'node:crypto';
import { connect, type TLSSocket } from 'node:tls';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

export type ZhongJiTlsMoShi = 'pin' | 'verify';

/** 指纹归一化：去空白/冒号/连字符、转小写；必须是 64 位 hex，否则 null。 */
export function guiYiZhiWen(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s:-]/g, '');
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/** 证书 DER → sha256 hex 64（与 FWArmy 管理页「TLS / 证书」面板同口径）。 */
export function zhiWenCongDer(der: Buffer | Uint8Array): string {
  return createHash('sha256').update(der).digest('hex');
}

/** 展示分段：每 4 位一组、空格分隔（16 组），便于人工逐位比对；非法返回空串。 */
export function fenDuanZhiWen(fp: string): string {
  const g = guiYiZhiWen(fp);
  if (!g) return '';
  const zu: string[] = [];
  for (let i = 0; i < g.length; i += 4) zu.push(g.slice(i, i + 4));
  return zu.join(' ');
}

export type XinRenPanDing = 'first-see' | 'match' | 'mismatch';

/** 纯判定：无固定指纹=首次见；一致=match；不一致/拿不到合法指纹=mismatch（宁拒不放）。 */
export function panDingXinRen(stored: string | null | undefined, actual: string): XinRenPanDing {
  const a = guiYiZhiWen(actual);
  if (!a) return 'mismatch';
  const s = guiYiZhiWen(stored ?? '');
  if (!s) return 'first-see';
  return s === a ? 'match' : 'mismatch';
}

// ── 固定指纹持久化（一条中继站一个指纹；原子写；重启保留）──

export interface ZhongJiTlsPin {
  fingerprint: string;
  trustedAt: number;
  host?: string;
  port?: number;
}

const PIN_MAX = 1000;

export class ZhongJiTlsPinCang {
  private file: string;
  private ji = new Map<string, ZhongJiTlsPin>();

  constructor(file: string) {
    this.file = file;
    try {
      if (existsSync(file)) {
        const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(j || {})) {
          const p = v as Partial<ZhongJiTlsPin>;
          const fp = guiYiZhiWen(p?.fingerprint);
          if (!k || !fp) continue;
          this.ji.set(k, {
            fingerprint: fp,
            trustedAt: Number.isFinite(Number(p?.trustedAt)) ? Number(p?.trustedAt) : 0,
            ...(p?.host ? { host: String(p.host) } : {}),
            ...(Number.isFinite(Number(p?.port)) ? { port: Number(p.port) } : {}),
          });
          if (this.ji.size >= PIN_MAX) break;
        }
      }
    } catch { /* 读坏了按空仓处理，不挡启动；下次信任会重建 */ }
  }

  du(relayId: string): ZhongJiTlsPin | null {
    return this.ji.get(String(relayId || '')) ?? null;
  }

  /** 固定/更新指纹（非法指纹拒绝写入）；原子写盘。 */
  xie(relayId: string, pin: ZhongJiTlsPin): boolean {
    const id = String(relayId || '');
    const fp = guiYiZhiWen(pin?.fingerprint);
    if (!id || !fp) return false;
    this.ji.set(id, {
      fingerprint: fp,
      trustedAt: Number.isFinite(Number(pin?.trustedAt)) ? Number(pin.trustedAt) : Date.now(),
      ...(pin?.host ? { host: String(pin.host) } : {}),
      ...(Number.isFinite(Number(pin?.port)) ? { port: Number(pin.port) } : {}),
    });
    this.luoPan();
    return true;
  }

  /** 清除固定（「重新核对/更新指纹」入口）；返回是否真删了。 */
  shan(relayId: string): boolean {
    const ok = this.ji.delete(String(relayId || ''));
    if (ok) this.luoPan();
    return ok;
  }

  lieBiao(): Array<{ relayId: string } & ZhongJiTlsPin> {
    return [...this.ji.entries()].map(([relayId, p]) => ({ relayId, ...p }));
  }

  private luoPan(): void {
    try {
      const dir = path.dirname(this.file);
      mkdirSync(dir, { recursive: true });
      const obj: Record<string, ZhongJiTlsPin> = {};
      for (const [k, v] of this.ji) obj[k] = v;
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch { /* 写盘失败不抛（调用方按未持久化如实处理）；内存态仍在 */ }
  }
}

// ── TLS 连接器（所有中继站连接的必经 choke point）──

export interface ZhongJiTlsXuanXiang {
  host: string;
  port: number;
  /** 缺省 pin（自签指纹固定）；verify = 系统 CA + 域名校验。 */
  mode?: ZhongJiTlsMoShi;
  /** 已固定的指纹（来自 PinCang）；pin 模式必给口径由调用方负责，verify 模式可选叠加。 */
  pinnedFingerprint?: string | null;
  timeoutMs?: number;
}

export type ZhongJiTlsJieGuo =
  | { ok: true; socket: TLSSocket; fingerprint: string; zhuangTai: 'match' | 'ca-ok' }
  | {
      ok: false;
      zhuangTai: 'first-see' | 'mismatch' | 'ca-fail' | 'net-error' | 'timeout' | 'bad-input';
      fingerprint?: string;
      expected?: string;
      error?: string;
    };

const MO_REN_CHAO_SHI = 10_000;

/**
 * 建立 TLS 连接并完成信任判定。**判定通过前不写任何数据**；
 * ok:true 时把 socket 交给调用方（此时才允许发凭据/消息）；其余一律已销毁。
 */
export function zhongJiTlsLianJie(xuan: ZhongJiTlsXuanXiang): Promise<ZhongJiTlsJieGuo> {
  const host = String(xuan?.host || '').trim();
  const port = Number(xuan?.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.resolve({ ok: false, zhuangTai: 'bad-input', error: 'bad-host-or-port' });
  }
  const mode: ZhongJiTlsMoShi = xuan?.mode === 'verify' ? 'verify' : 'pin';
  const pinned = guiYiZhiWen(xuan?.pinnedFingerprint ?? '');
  const chaoShi = Number.isFinite(Number(xuan?.timeoutMs)) && Number(xuan.timeoutMs) > 0
    ? Number(xuan.timeoutMs) : MO_REN_CHAO_SHI;

  return new Promise<ZhongJiTlsJieGuo>((resolve) => {
    let yiJie = false;
    let socket: TLSSocket | null = null;
    const wan = (r: ZhongJiTlsJieGuo): void => {
      if (yiJie) return;
      yiJie = true;
      clearTimeout(timer);
      if (!r.ok && socket) { try { socket.destroy(); } catch { /* noop */ } }
      resolve(r);
    };
    const timer = setTimeout(() => wan({ ok: false, zhuangTai: 'timeout', error: 'connect-timeout' }), chaoShi);

    const quZhiWen = (s: TLSSocket): string => {
      try {
        const cert = s.getPeerCertificate();
        if (cert && cert.raw && cert.raw.length) return zhiWenCongDer(cert.raw);
      } catch { /* noop */ }
      return '';
    };

    try {
      socket = connect({
        host,
        port,
        ...(/^[0-9.]+$/.test(host) || host.includes(':') ? {} : { servername: host }),
        // pin 模式关 CA 校验（自签证书），改由指纹固定把关；verify 模式开系统 CA + 域名校验。
        rejectUnauthorized: mode === 'verify',
      });
    } catch (e) {
      wan({ ok: false, zhuangTai: 'net-error', error: String((e as Error)?.message || e) });
      return;
    }

    socket.once('secureConnect', () => {
      const s = socket!;
      const fp = quZhiWen(s);
      if (mode === 'verify') {
        // CA + 域名已由 rejectUnauthorized:true 校验通过；可选叠加指纹校验。
        if (pinned) {
          const pd = panDingXinRen(pinned, fp);
          if (pd !== 'match') {
            wan({ ok: false, zhuangTai: 'mismatch', fingerprint: fp || undefined, expected: pinned });
            return;
          }
        }
        wan({ ok: true, socket: s, fingerprint: fp, zhuangTai: 'ca-ok' });
        return;
      }
      // pin 模式：指纹是唯一信任依据。
      const pd = panDingXinRen(pinned, fp);
      if (pd === 'first-see') {
        wan({ ok: false, zhuangTai: 'first-see', fingerprint: fp || undefined });
        return;
      }
      if (pd === 'mismatch') {
        wan({ ok: false, zhuangTai: 'mismatch', fingerprint: fp || undefined, expected: pinned ?? undefined });
        return;
      }
      wan({ ok: true, socket: s, fingerprint: fp, zhuangTai: 'match' });
    });

    socket.once('error', (e: NodeJS.ErrnoException) => {
      const code = String(e?.code || '');
      if (mode === 'verify') {
        // 自签/链不完整/域名不符等 → CA 校验失败，拒绝连接（不发送任何数据）。
        wan({ ok: false, zhuangTai: 'ca-fail', error: code || String(e?.message || e) });
        return;
      }
      wan({ ok: false, zhuangTai: 'net-error', error: code || String(e?.message || e) });
    });
  });
}

/** 探针：只取指纹/判定，**总是关闭连接**（不发送任何数据）；供首次核对 UI 与信任前复核用。 */
export async function zhongJiTlsTanZhen(
  xuan: ZhongJiTlsXuanXiang,
): Promise<{ ok: boolean; zhuangTai: string; fingerprint?: string; expected?: string; error?: string }> {
  const r = await zhongJiTlsLianJie(xuan);
  if (r.ok) {
    try { r.socket.destroy(); } catch { /* noop */ }
    return { ok: true, zhuangTai: r.zhuangTai, fingerprint: r.fingerprint };
  }
  return { ok: false, zhuangTai: r.zhuangTai, ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}), ...(r.expected ? { expected: r.expected } : {}), ...(r.error ? { error: r.error } : {}) };
}
