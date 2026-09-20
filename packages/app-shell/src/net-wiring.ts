/**
 * net-wiring —— 组网接线层：把 ②（握手/发现/保活）真接到 app-shell 上
 *
 * 为什么单独一个文件：
 *   · `electron-main.ts` 已经 3300+ 行；这里放**真实现的部分**，主进程只留「门控 + 通道名 + 返回形状」；
 *   · 这一层能直接被验证脚本 import（`packages/app-shell/scripts/verify-wiring.mjs`），
 *     所以「本机地址枚举 / 出站探测 / DNS / 端口可达 / 鉴权握手 / 重放防护」都跑得起来断言。
 *
 * 真实现 / 降级 / 未实现（**不许假装成功**）：
 *   · 真实现：TCP 连通性探测（含时延）、DNS 解析、网卡地址枚举、出站连通性（TCP + HTTP 到公网端点）、
 *     公网地址发现（HTTP 回显服务，尽力而为，失败如实报 `publicIpError`）、
 *     本机监听端口是否真的在听（真的 TCP 连一次 127.0.0.1:port）、
 *     鉴权握手（Ed25519 双向认证 + X25519 ECDHE + AES-256-GCM）、名册校验、重放防护（**计数持久化**）。
 *   · 降级：**入站可达性**（"别人能不能拨到我"）需要一台真的在公网的第三方对端来拨回；
 *     本机自测只能证明「同机/同网可达」→ 结论里显式带 `inboundVerified: false`，
 *     绝不因为"地址字面看起来是公网"就宣称公网可达。
 *   · 未实现：UPnP / NAT-PMP 端口映射、打洞（真实 STUN + 同时打洞）。
 *     中继**只实现了判定与候选探测**（`decideRelay`：真拨一次候选地址）——
 *     转发隧道在协议层（`relay.ts` 的 RelayTunnel*），接线层**尚未启用**，
 *     所以 `canDial`/可达性只报结论，不假装隧道已在跑。
 *
 * 旧实现（`lan.ts` / `mesh.ts`）保留文件但**不再被主进程使用**：它们是明文 JSONL、无握手、无身份。
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  LianJieHuoXing,
  LanProbe,
  ReplayGuard,
  SecureSyncClient,
  SecureSyncServer,
  SecureSession,
  guiLeiDiZhi,
  guiLeiIpv6ZuoYongYu,
  jueDingZhongJi,
  inspectLocalIpv6,
  isPublicDialCandidate,
  DIALABILITY_I18N,
  LADDER_RUNG_I18N,
  RELAY_STATUS_I18N,
  normalizeHostLiteral,
  resolveCanDial,
  type CanDialResolution,
  type CanDialSignals,
  type KeBoRuZhongLei,
  type HandshakeFailureRecord,
  type Ipv6Report,
  type LadderRung,
  type ChengYuanHuoXing,
  type ZhongJiHouXuanYinYong,
  type ZhongJiJueDing,
  type SyncMessage,
} from '@warmy/sync-protocol';
import {
  createIdentityProvider,
  createRosterChecker,
  fingerprintDerivationForAppShell,
  requireSignableIdentity,
  type SignerUnlockState,
} from './identity-provider.js';
import type { IdentityStore } from './identity-store.js';
import { WARMY_SUGGESTED_NET_PORTS } from './settings-store.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * R13：候选端口的**实测**（只推荐"本机真的能绑上"的端口）
 *
 * 静态候选表（WARMY_SUGGESTED_NET_PORTS）只是**优先池**，**不能直接推给用户**：
 * 它"干净"不代表本机现在绑得上（可能已被别的进程占用，也可能落在 OS 保留段里 EACCES）。
 * 所以推荐前逐个**真 bind 一次**（与组网监听同一个 host/协议），绑上立刻关闭、不泄漏句柄，
 * 三元结果如实回出（ok / occupied / no-permission）。
 *
 * 优先池全不可用时**继续找**（同号段相邻值 → 整个动态区间 49152–65535 随机样本），
 * 直到凑够目标数量 —— "不能让用户无路可走"。
 *
 * 扩展搜索时会**先读本机 OS 保留段**（Windows 的 `netsh … excludedportrange`），落在保留段里的
 * 端口**根本不进探测队列**：它们连 bind 都不允许（EACCES），探了也只是浪费一次往返、
 * 结论永远一样。被跳过的端口**如实记在 `skipped` 里**（不静默丢弃），读了什么也一并回报（`osReserved`）。
 *
 * 不做模块级缓存：端口占用状况随时在变，陈旧结论比没有结论更糟。
 *（例外：OS 保留段是**系统级稳定事实**，按进程缓存一次；见 `getOsReservedTcpRanges`。）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 实测结论：ok=本机可用 / occupied=被占用(EADDRINUSE) / no-permission=权限等其它原因 */
export type PortProbeStatus = 'ok' | 'occupied' | 'no-permission';

export interface PortProbeEntry {
  port: number;
  status: PortProbeStatus;
  /** 非 ok 时的底层 errno（EADDRINUSE / EACCES …）——原样带出，不吞 */
  errorCode?: string;
  latencyMs: number;
}

export interface PortCandidateReport {
  /** 用户当前配置的端口（原样回报；它**永远不会**出现在 recommended 里） */
  requestedPort: number;
  /** **只含实测 ok** 的端口（按优先顺序） */
  recommended: PortProbeEntry[];
  /** 本次实测到的全部结果（含不可用的；UI 据此解释"为什么少了某个号"） */
  probed: PortProbeEntry[];
  /**
   * 扩展搜索时因落在本机 OS 保留段里而**没有被探测**的端口。
   * 刻意与 `probed` 分开：`probed` 的语义是"真 bind 过一次"，把这些端口塞进去
   * 会让"共实测 N 个"变成假话（而且它们本来就不是候选）。
   */
  skipped: PortCandidateSkip[];
  /** 本次读到的 OS 保留段（含 supported / source / error）——"为什么跳过"对界面是可见的，不是黑箱 */
  osReserved: OsReservedRanges;
  /** pool = 优先池里就凑够了；extended = 优先池不够，已扩展到整个动态区间 */
  coverage: 'pool' | 'extended';
  /** 是否因总超时提前结束（提前结束时会少于目标数量，如实告知而不是假装找过） */
  timedOut: boolean;
  elapsedMs: number;
  probedAt: number;
  /** 实测用的主机地址（与组网监听保持一致，默认 0.0.0.0） */
  host: string;
}

/** 动态/临时端口区间（Windows 默认也是这一段）——"优先池不够时"的扩展搜索范围 */
export const EPHEMERAL_PORT_RANGE: readonly [number, number] = [49152, 65535];

/** 推荐数量目标：至少 3 个、最多 5 个（产品要求"不能让用户无路可走"） */
export const PORT_CANDIDATE_MIN = 3;
export const PORT_CANDIDATE_WANT = 4;
export const PORT_CANDIDATE_MAX = 5;

/* ────────────────────────── OS 保留段（Windows 排除端口段） ────────────────────────── */

/**
 * 本机 OS **保留（排除）**的 TCP 端口段。
 *
 * 为什么需要它：Windows 上 Hyper-V / WSL / 已注册的服务会把整段端口从动态区间里挖走
 * （`netsh int ipv4 show excludedportrange protocol=tcp`，本机实测有 7 段，其中 63840–63939
 * 正好覆盖原来的建议端口 63888）。这些端口**连 bind 都不允许**（EACCES），探测它们
 * 只是白跑一趟，结论永远是"不可用"。
 *
 * 为什么**只读 TCP 表**：这里的候选池是**组网 TCP 监听端口**（`SecureMesh.enable` →
 * `net.Server.listen`）。UDP 只在固定端口 7799（`LanDiscovery` 内网广播）与系统临时端口
 * （DHT / 阶梯探测的 `bind({ port: 0 })`）上绑定，**没有任何一处**从本池子里挑 UDP 端口 ——
 * 拿 UDP 排除段来筛 TCP 候选只会**误杀**本来绑得上的端口。所以只看 tcp 表，不看 udp 表。
 *
 * 读不到**不算错**，但不许假装"本机没有保留段"：`source` / `error` 如实带出，
 * `ranges` 为空就是"不跳过任何端口"。
 */
export interface OsReservedRanges {
  /** 本平台是否**支持**读取（只有 Windows 有 netsh 排除段；非 Windows 恒 false） */
  supported: boolean;
  /** 数据来源，原样带出便于自证：命令原文 / unsupported-platform / command-failed / disabled / injected / not-read */
  source: string;
  /** 保留段 [start, end]（含两端）；空数组 = 不跳过任何端口 */
  ranges: Array<readonly [number, number]>;
  /** 读取失败的原因（有它就说明 ranges 空是"读不到"，不是"本机没有保留段"） */
  error?: string;
}

/** 被跳过的候选端口（不是"探测失败"，而是**没有探测**） */
export interface PortCandidateSkip {
  port: number;
  /** 唯一原因：端口落在本机 OS 保留段里 */
  reason: 'os-reserved-range';
  /** 命中的保留段（含两端，原样来自系统） */
  range: readonly [number, number];
}

const NETS_EXCLUDED_RANGE_CMD = 'netsh int ipv4 show excludedportrange protocol=tcp';

/**
 * 解析 netsh 排除端口表格。只认"一行两个数字"（可选尾随 `*`），表头 / 分隔线 /
 * `* - Administered port exclusions.` 之类的说明行天然不匹配 —— 所以中文 Windows 的
 * 本地化表头（GBK 下解码成乱码也一样）不影响解析，数字是 ASCII 的。
 */
export function parseExcludedPortRanges(text: string): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(\d{1,5})\s+(\d{1,5})\s*\*?\s*$/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 1 || end > 65535 || start > end) continue; // 端口范围以外的行不是排除段
    out.push([start, end]);
  }
  return out;
}

/** 进程内缓存：排除段是系统级稳定事实（不像端口占用那样随时在变），读一次就够 */
let osReservedRangesCache: Promise<OsReservedRanges> | null = null;

async function readOsReservedTcpRanges(): Promise<OsReservedRanges> {
  return new Promise<OsReservedRanges>((resolve) => {
    if (process.platform !== 'win32') {
      // 非 Windows 没有"排除段"这回事：如实回报不支持（空列表 = 不跳过任何端口）
      resolve({ supported: false, source: 'unsupported-platform', ranges: [] });
      return;
    }
    let settled = false;
    const done = (r: OsReservedRanges): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      execFile(
        'netsh',
        ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'],
        { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err) {
            // 读不到就**不跳过**（空列表），但把原因原样带出 —— 绝不假装"本机没有保留段"
            done({
              supported: true,
              source: 'command-failed',
              ranges: [],
              error: (err as NodeJS.ErrnoException).code ?? err.message,
            });
            return;
          }
          done({ supported: true, source: NETS_EXCLUDED_RANGE_CMD, ranges: parseExcludedPortRanges(String(stdout)) });
        },
      );
    } catch (e) {
      done({ supported: true, source: 'command-failed', ranges: [], error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** 读本机 OS 保留的 TCP 段（按进程缓存一次；失败也如实回报，绝不抛错打断候选生成） */
export function getOsReservedTcpRanges(): Promise<OsReservedRanges> {
  if (!osReservedRangesCache) osReservedRangesCache = readOsReservedTcpRanges();
  return osReservedRangesCache;
}

/** 仅供验证/诊断：清掉进程内缓存，强制下次重新读系统事实 */
export function resetOsReservedRangesCache(): void {
  osReservedRangesCache = null;
}

/** 测试注入的保留段：给数组 = "读到的保留段"；给完整对象可连 source/error 一起注入 */
function normalizeInjectedReservedRanges(
  v: readonly (readonly [number, number])[] | OsReservedRanges | undefined,
): OsReservedRanges | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    const list = v as readonly (readonly [number, number])[];
    return { supported: true, source: 'injected', ranges: list.map((r) => [r[0], r[1]] as const) };
  }
  return v as OsReservedRanges;
}

/** errno → 三元结论（非 EADDRINUSE 一律记 no-permission，但 errno 仍原样带在 errorCode 里） */
function classifyBindProbe(code: string | undefined): PortProbeStatus {
  return code === 'EADDRINUSE' ? 'occupied' : 'no-permission';
}

/**
 * 真的 bind 一次看能不能绑上；**绑上立刻关闭**（绝不泄漏监听句柄）。
 * 与组网监听用同一个 host（默认 0.0.0.0），否则结论不可信（0.0.0.0 与 127.0.0.1 的占用面不同）。
 */
export function probePortAvailability(port: number, host = '0.0.0.0', timeoutMs = 400): Promise<PortProbeEntry> {
  return new Promise<PortProbeEntry>((resolve) => {
    const started = Date.now();
    let settled = false;
    const s = net.createServer();
    const done = (status: PortProbeStatus, errorCode?: string): void => {
      if (settled) return;
      settled = true;
      if (status !== 'ok') {
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }
      resolve({ port, status, ...(errorCode ? { errorCode } : {}), latencyMs: Date.now() - started });
    };
    s.once('error', (e: NodeJS.ErrnoException) => done(classifyBindProbe(e.code), e.code ?? 'probe-error'));
    s.once('listening', () => {
      // 等 close 回调再回结论：这样"探测完不留句柄"是可以被验证的
      s.close(() => done('ok'));
    });
    const guard = setTimeout(() => {
      try {
        s.close();
      } catch {
        /* ignore */
      }
      done('no-permission', 'probe-timeout');
    }, Math.max(80, timeoutMs));
    if (typeof guard.unref === 'function') guard.unref();
    try {
      s.listen(port, host);
    } catch (e) {
      clearTimeout(guard);
      done(classifyBindProbe((e as NodeJS.ErrnoException).code), (e as NodeJS.ErrnoException).code ?? 'probe-throw');
      return;
    }
  });
}

export interface PickPortCandidatesOptions {
  /** 用户当前配置的端口（不会出现在推荐里） */
  requestedPort?: number;
  /** 想要几个（clamp 到 PORT_CANDIDATE_MIN..MAX） */
  want?: number;
  host?: string;
  /** 并发上限（默认 8）——探测本身不能把端口占满，也不能无限并发 */
  concurrency?: number;
  /** 总超时（默认 4000ms）——到点就停，绝不卡界面 */
  totalTimeoutMs?: number;
  /** 优先池（默认 WARMY_SUGGESTED_NET_PORTS；测试可注入） */
  pool?: readonly number[];
  /** 是否允许扩展到整个动态区间（默认 true） */
  allowExtended?: boolean;
  /** 扩展搜索时是否跳过本机 OS 保留段（默认 true；false 只用于对照实验） */
  skipReservedRanges?: boolean;
  /** OS 保留段（测试可注入，避免结论依赖机器环境） */
  reservedRanges?: readonly (readonly [number, number])[] | OsReservedRanges;
  /** 随机源（测试可注入，便于复现） */
  random?: () => number;
  /** 探测函数（测试可注入，用于把"优先池全被占"这种局面压出来） */
  probe?: (port: number, host: string, timeoutMs: number) => Promise<PortProbeEntry>;
}

/**
 * 实测并挑选候选端口。**每次调用都真探测**（无模块级缓存；OS 保留段除外，那是系统稳定事实）。
 * 顺序：优先池 → （不够时）同号段相邻值 → （还不够时）动态区间随机样本 → 到点即停。
 * 扩展搜索时**先剔除**本机 OS 保留段里的端口（跳过而不是探测），被跳过的端口记在 `skipped` 里。
 */
export async function pickPortCandidates(opts: PickPortCandidatesOptions = {}): Promise<PortCandidateReport> {
  const host = opts.host ?? '0.0.0.0';
  const requestedPort = Number.isInteger(opts.requestedPort) ? Number(opts.requestedPort) : 0;
  const want = Math.min(PORT_CANDIDATE_MAX, Math.max(PORT_CANDIDATE_MIN, Number(opts.want) || PORT_CANDIDATE_WANT));
  const concurrency = Math.min(16, Math.max(1, Number(opts.concurrency) || 8));
  const totalTimeoutMs = Math.max(200, Number(opts.totalTimeoutMs) || 4000);
  const pool = (opts.pool ?? WARMY_SUGGESTED_NET_PORTS).slice();
  const allowExtended = opts.allowExtended !== false;
  const skipReserved = opts.skipReservedRanges !== false;
  const random = opts.random ?? Math.random;
  const probeFn = opts.probe ?? probePortAvailability;
  const [lo, hi] = EPHEMERAL_PORT_RANGE;

  const started = Date.now();
  const probed = new Map<number, PortProbeEntry>();
  const seen = new Set<number>();
  const recommended: PortProbeEntry[] = [];
  const skipped: PortCandidateSkip[] = [];
  // 只有真的走进扩展搜索才会去读系统保留段：优先池够用时读它纯属多余，
  // source='not-read' 就是"这次没读"（如实，不是"本机没有保留段"）。
  let osReserved: OsReservedRanges = { supported: false, source: 'not-read', ranges: [] };
  let timedOut = false;
  let coverage: 'pool' | 'extended' = 'pool';
  // 探测总次数上界：优先池全被占时也要有界，不能变成端口扫描器
  const PROBE_BUDGET = 240;
  let probeCount = 0;

  const leftMs = (): number => totalTimeoutMs - (Date.now() - started);
  const outOfTime = (): boolean => leftMs() <= 0;
  const enough = (): boolean => recommended.length >= want;

  async function runBatch(ports: number[]): Promise<void> {
    for (let i = 0; i < ports.length; i += concurrency) {
      if (enough() || outOfTime() || probeCount >= PROBE_BUDGET) {
        if (outOfTime()) timedOut = true;
        return;
      }
      const slice = ports.slice(i, i + concurrency).filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);
      probeCount += slice.length;
      const perTimeout = Math.min(400, Math.max(120, leftMs()));
      const results = await Promise.all(slice.map((p) => probeFn(p, host, perTimeout)));
      for (const r of results) {
        probed.set(r.port, r);
        if (r.status === 'ok' && r.port !== requestedPort && !recommended.some((x) => x.port === r.port)) recommended.push(r);
      }
    }
  }

  // 阶段 1：优先池（用户当前那个端口不做候选 —— 它就是绑不上的那个）
  await runBatch(pool.filter((p) => p !== requestedPort && !seen.has(p)));
  for (const p of pool) seen.add(p);

  // 阶段 2：优先池不够 → 先探同号段相邻值，再在整个动态区间随机取样
  if (!enough() && allowExtended) {
    coverage = 'extended';
    /*
     * **在生成新候选之前**读本机 OS 保留段（只在这一段读）：
     *   · 优先池是产品给定的固定短表，逐个探测既然很快、结论对用户也有信息量，就照旧探；
     *   · 扩展到整个动态区间时，如果拿保留段里的号当样本，那 100% 是白跑：
     *     这些端口连 bind 都不允许（EACCES），既浪费时间又可能把探测预算耗在"永远不可用"的号上。
     * 读不到（非 Windows / netsh 跑失败）→ ranges 为空 → 不跳过任何端口，并如实回报 source/error。
     */
    const injected = normalizeInjectedReservedRanges(opts.reservedRanges);
    osReserved =
      injected ??
      (skipReserved
        ? await getOsReservedTcpRanges()
        : { supported: process.platform === 'win32', source: 'disabled', ranges: [] });
    const inReservedRange = (p: number): readonly [number, number] | undefined =>
      osReserved.ranges.find(([start, end]) => p >= start && p <= end);
    /** 保留段里的端口**不进探测队列**，但必须如实记账（skipped）——不许静默丢弃 */
    const skipIfReserved = (p: number): boolean => {
      const range = inReservedRange(p);
      if (!range) return false;
      skipped.push({ port: p, reason: 'os-reserved-range', range });
      return true;
    };
    const neighbours: number[] = [];
    for (const base of pool) {
      for (let k = 1; k <= 6 && neighbours.length < pool.length * 3; k += 1) {
        for (const cand of [base + k, base - k]) {
          if (cand >= lo && cand <= hi && !seen.has(cand) && cand !== requestedPort) {
            seen.add(cand);
            if (skipIfReserved(cand)) continue;
            neighbours.push(cand);
          }
        }
      }
    }
    await runBatch(neighbours);

    if (!enough() && !outOfTime()) {
      const samples: number[] = [];
      for (let i = 0; i < PROBE_BUDGET && samples.length < PROBE_BUDGET - probeCount; i += 1) {
        const cand = lo + Math.floor(random() * (hi - lo + 1));
        if (!seen.has(cand) && cand !== requestedPort) {
          seen.add(cand);
          if (skipIfReserved(cand)) continue;
          samples.push(cand);
        }
      }
      await runBatch(samples);
    }
  }

  return {
    requestedPort,
    recommended,
    probed: [...probed.values()],
    skipped,
    osReserved,
    coverage,
    timedOut: timedOut || (outOfTime() && !enough()),
    elapsedMs: Date.now() - started,
    probedAt: Date.now(),
    host,
  };
}

/** 无服务器拓扑说明。**只给 i18n key**，主进程不拼句子（渲染层负责翻译） */
export const NET_NOTES = {
  lan: 'net.note.lan',
  wanManual: 'net.note.wanManual',
  wanHard: 'net.note.wanHard',
} as const;

/* ────────────────────────────── 基础探测（真实现） ────────────────────────────── */

export interface TcpProbeResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  /** 真的连上了才有的本地端口（可用来证明"这条连接是我们的"） */
  localPort?: number;
}

/** 真实 TCP 连接探测（不读不写，连上即断） */
export function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const sock = net.connect({ host, port });
    const done = (r: TcpProbeResult): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    sock.once('connect', () => done({ ok: true, latencyMs: Date.now() - started, localPort: sock.localPort ?? undefined }));
    // 用 on（不是 once）：settle 之后对端再抛 ECONNRESET 之类也必须被吞掉，
    // 否则一个未处理的 'error' 事件能直接把 Electron 主进程带崩
    sock.on('error', (e: Error & { code?: string }) => done({ ok: false, error: e.code ?? e.message }));
    sock.setTimeout(timeoutMs, () => done({ ok: false, error: 'timeout' }));
  });
}

export interface LocalAddressInfo {
  ok: boolean;
  /** 最可能被局域网对端使用的本机地址（私网优先） */
  localIp: string;
  /** 全部非回环 IPv4（诊断用） */
  interfaces: string[];
  /** 本机是否有公网地址（网卡直接持有） */
  hasPublicInterface: boolean;
  /** 全部网卡地址都是私网/回环 → 一定在 NAT 之后（有证据的判定） */
  behindNat: boolean;
  /** 公网地址（HTTP 回显服务，尽力而为；失败则没有这个字段） */
  publicIp?: string;
  publicIpSource?: string;
  publicIpError?: string;
  /** 公网地址 ≠ 本机任一网卡地址 → NAT 后才有了公网地址（证据更强） */
  behindNatConfirmed?: boolean;
  tcp?: TcpProbeResult;
  /** 本机 IPv6 事实（附八.9：有全局单播 = 天然可拨入候选，无需打洞） */
  ipv6?: { hasGlobalUnicast: boolean; publicCandidate: string | null; ula: string[]; linkLocal: string[]; reason: string };
}

function isIpv4(v: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  return m.slice(1).every((x) => Number(x) >= 0 && Number(x) <= 255);
}

/** 枚举非回环 IPv4（真实现：os.networkInterfaces） */
export function listLocalAddresses(): { all: string[]; publicOnes: string[] } {
  const all: string[] = [];
  const publicOnes: string[] = [];
  try {
    const nics = os.networkInterfaces();
    for (const addrs of Object.values(nics)) {
      for (const a of addrs ?? []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        if (!isIpv4(a.address)) continue;
        if (!all.includes(a.address)) all.push(a.address);
        if (guiLeiDiZhi(a.address) === 'public') publicOnes.push(a.address);
      }
    }
  } catch {
    /* ignore：拿不到网卡就当空 */
  }
  return { all, publicOnes };
}

/** 私网优先的"本机地址"（局域网对端最可能需要这个） */
export function pickLocalAddress(all: string[]): string {
  // 多网卡机器上（Hyper-V/WSL 的 172.16-31 虚拟网卡、Docker 网桥…）排序很关键：
  // 家用/办公局域网一般是 192.168.*，其次是 10.*，172.16-31 往往是虚拟网卡 → 排最后。
  const rank = (a: string): number => {
    if (/^192\.168\./.test(a)) return 0;
    if (/^10\./.test(a)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 2;
    if (guiLeiDiZhi(a) === 'private') return 3;
    if (guiLeiDiZhi(a) === 'public') return 4;
    return 5;
  };
  const sorted = [...all].sort((a, b) => rank(a) - rank(b));
  if (sorted.length > 0) return sorted[0] as string;
  return '127.0.0.1';
}

/* ────────────────────────── IPv6 / 可达性接线（ADR 附八.9 / 附八.3） ────────────────────────── */

/**
 * 本机 IPv6 事实（真实现：`os.networkInterfaces`，两种 `family` 写法都认）。
 * 附八.9：**有全局单播 IPv6 = 天然可拨入候选**（IPv6 无 NAT）⇒ 阶梯第一档就是 IPv6 直连，
 * 有 IPv6 的用户不该被误判成"非公网、不可组网"而白走打洞/中继。
 */
export function listLocalIpv6(): Ipv6Report {
  return inspectLocalIpv6();
}

/** 本机 IPv6 是否构成"天然可拨入候选"（不含"已验证公网可达"的意思） */
export function hasNaturalIpv6Reachability(): boolean {
  return inspectLocalIpv6().hasGlobalUnicast;
}

/**
 * 可拨入性的**结构化类型**（与协议层 `dialability.ts` 的优先级一致）：
 *  已验证可拨入（对端真的拨回来过）> 地址事实（全局 IPv6 无 NAT）> 判定不可拨入 > 无法判定。
 *
 * 单独一个函数的理由：UI 与日志都要能区分"验证过"和"只是地址事实"，
 * 所以这里只产出**类型**，不产出布尔（附八.9）。
 */
export function dialableKindOf(selfDialable: boolean | undefined, hasGlobalIpv6: boolean): KeBoRuZhongLei {
  if (selfDialable === true) return 'peer-verified';
  if (hasGlobalIpv6) return 'ipv6-global-natural';
  return selfDialable === false ? 'undialable' : 'undetermined';
}

/**
 * 可达性提示（**结构化**：只给结论码与 i18n key，绝不拼句子）。
 * 附八.9 的"IPv6 单列一档"与附八.3 的"中继兜底 + 明确告知"都在这里落地给 UI 用。
 */
export interface ReachabilityHint {
  /** 本机 IPv6 事实 */
  ipv6: { hasGlobalUnicast: boolean; publicCandidate: string | null; ula: string[]; linkLocal: string[]; reason: string };
  /** 本机是否可拨入（undefined = 未测） */
  selfDialable?: boolean;
  /** 建议的阶梯首档 */
  suggestedRung: LadderRung;
  /**
   * 附八.9：本机是否有"地址事实推出"的天然可拨入候选（有全局单播 IPv6 ⇒ IPv6 无 NAT）。
   * **与 `selfDialable` 是两件事**：前者是地址事实（未验证），后者是对端拨回来的结论（已验证）。
   * 两者都不给布尔合并，UI 才能说清"是验证过还是只是地址事实"。
   */
  naturalDialable?: boolean;
  /** 可拨入性的**结构化类型**（协议层 DialableKind；UI 按它选 i18n key，不解析句子） */
  dialableKind?: KeBoRuZhongLei;
  /** 与 `dialableKind` 对应的 i18n key（`net.dialability.*`） */
  dialableI18n?: string;
  /** 中继判定（附八.3；结构化，含"需要一台有公网地址的机器做中继"这个状态） */
  relay?: ZhongJiJueDing;
  /** 需要 UI 明确告知"两端都无法直连，需要中继" */
  needsPublicRelayNotice: boolean;
  /** i18n key（net.rung.* / net.relay.*） */
  i18n: { rung: string; relay?: string };
}

/** 公网地址回显服务（多个，取第一个成功且格式合法的）。这是**尽力而为**的真实探测。 */
const PUBLIC_IP_SERVICES: { url: string; source: string }[] = [
  { url: 'https://ipinfo.io/ip', source: 'ipinfo.io' },
  { url: 'https://checkip.amazonaws.com', source: 'checkip.amazonaws.com' },
  { url: 'https://api.ipify.org', source: 'api.ipify.org' },
];

export interface PublicIpResult {
  ok: boolean;
  ip?: string;
  source?: string;
  error?: string;
  latencyMs?: number;
}

export async function discoverPublicIp(timeoutMs = 4000): Promise<PublicIpResult> {
  const started = Date.now();
  const errors: string[] = [];
  for (const svc of PUBLIC_IP_SERVICES) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(svc.url, { signal: ctl.signal, redirect: 'follow' });
      const text = (await res.text()).trim().slice(0, 64);
      const looksLikeIp = isIpv4(text) || (/^[0-9a-f:]+$/i.test(text) && text.includes(':'));
      if (res.ok && looksLikeIp) return { ok: true, ip: text, source: svc.source, latencyMs: Date.now() - started };
      errors.push(`${svc.source}:bad-body`);
    } catch (e) {
      errors.push(`${svc.source}:${(e as Error).name === 'AbortError' ? 'timeout' : 'unreachable'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: errors.join(','), latencyMs: Date.now() - started };
}

/** 出站连通性：真的 TCP 连一次公网端点（默认挑几个稳定可用的） */
const OUTBOUND_TARGETS: { host: string; port: number; label: string }[] = [
  { host: 'registry.npmjs.org', port: 443, label: 'npm-registry' },
  { host: '1.1.1.1', port: 443, label: 'cloudflare-dns' },
  { host: '8.8.8.8', port: 53, label: 'google-dns' },
];

export interface OutboundResult {
  ok: boolean;
  method?: string;
  latencyMs?: number;
  error?: string;
  attempts: { label: string; ok: boolean; error?: string; latencyMs?: number }[];
}

export async function checkOutbound(timeoutMs = 2500, targets = OUTBOUND_TARGETS): Promise<OutboundResult> {
  const attempts: OutboundResult['attempts'] = [];
  for (const t of targets) {
    const r = await tcpProbe(t.host, t.port, timeoutMs);
    attempts.push({
      label: t.label,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
      ...(r.latencyMs ? { latencyMs: r.latencyMs } : {}),
    });
    if (r.ok) return { ok: true, method: `tcp:${t.label}`, latencyMs: r.latencyMs, attempts };
  }
  return { ok: false, error: attempts.map((a) => `${a.label}:${a.error ?? 'fail'}`).join(','), attempts };
}

/** 本机地址信息（不联网也有结果；公网地址尽力而为） */
export async function localAddressInfo(opts: { port?: number; timeoutMs?: number } = {}): Promise<LocalAddressInfo> {
  const { all, publicOnes } = listLocalAddresses();
  const localIp = pickLocalAddress(all);
  const base: LocalAddressInfo = {
    ok: true,
    localIp,
    interfaces: all,
    hasPublicInterface: publicOnes.length > 0,
    behindNat: publicOnes.length === 0,
  };
  // 附八.9：IPv6 单独判一档（否则有 IPv6 的用户会被误判成"非公网、不可组网"）
  {
    const v6 = inspectLocalIpv6();
    base.ipv6 = {
      hasGlobalUnicast: v6.hasGlobalUnicast,
      publicCandidate: v6.publicCandidate,
      ula: v6.ula,
      linkLocal: v6.linkLocal,
      reason: v6.reason,
    };
  }
  if (opts.port) base.tcp = await tcpProbe('127.0.0.1', opts.port, 1200);
  const pub = await discoverPublicIp(opts.timeoutMs ?? 4000);
  if (pub.ok && pub.ip) {
    base.publicIp = pub.ip;
    base.publicIpSource = pub.source;
    const onNic = all.includes(pub.ip) || publicOnes.includes(pub.ip);
    base.behindNatConfirmed = !onNic;
    if (!onNic) base.behindNat = true;
  } else {
    base.publicIpError = pub.error ?? 'unavailable';
  }
  return base;
}

/* ────────────────────────────── netProbe ────────────────────────────── */

export interface ProbeNetInput {
  ip: string;
  port: number;
  domains?: string[];
}

export interface ProbeNetResult {
  ok: boolean;
  isPublic: boolean;
  outboundOk: boolean;
  lanOnly?: boolean;
  method?: string;
  behindNat?: boolean;
  observedIp?: string;
  errorCode?: string;
  /** 入站可达性在本机**无法验证**（缺公网第三方对端）；恒 false，别当"已验证"用 */
  inboundVerified: false;
  /** 本机有全局单播 IPv6 → 天然可拨入候选（附八.9；与 inboundVerified 是两件事） */
  naturallyDialable?: boolean;
  /** 被探测地址若是 IPv6，给出其作用域（global/ula/link-local/loopback/…） */
  targetIpv6Scope?: string;
  /** 结构化证据（UI/日志可用；不含任何文案） */
  details?: {
    scope: string;
    localInterfaces: string[];
    onLocalNic: boolean;
    resolvedIpv4: string[];
    dnsErrors: string[];
    outbound?: OutboundResult;
    publicIp?: string;
    publicIpSource?: string;
    publicIpError?: string;
    portCheck?: TcpProbeResult;
    portCheckTarget?: string;
    /** 本机 IPv6 事实（附八.9） */
    localIpv6?: { hasGlobalUnicast: boolean; publicCandidate: string | null; ula: string[]; linkLocal: string[]; reason: string };
    /** 目标地址是不是"可拨号的 IPv6 候选"（全局单播且非文档段） */
    targetIsDialableIpv6?: boolean;
  };
}

function isValidHost(v: string): boolean {
  if (isIpv4(v)) return true;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(':')) return true; // IPv6
  // 域名或单标签主机名（localhost / 内网 NetBIOS 名都合法）
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(v);
}

/**
 * 公网地址检测（真实现 + 明确降级）。
 *
 * 判定规则（每条都有证据）：
 *  · 字面 IP 属于私网/回环/链路本地/CGNAT → `isPublic=false`、`lanOnly=true`；
 *  · 字面是公网 IP **且** 就是本机某张网卡的地址 → `isPublic=true`（"网卡直接持有公网地址"，证据充分）；
 *  · 字面是公网 IP 但**不是**本机网卡地址 → `isPublic=true`（这是用户填的对外地址；是否真的映射到本机
 *    属于入站可达性，本机无法验证 → `inboundVerified:false` 如实标注）；
 *  · 域名 → 真的 DNS 解析；解析结果里有公网地址才算 `isPublic`，全是私网则 `lanOnly`；
 *  · 端口可达性：只对本机地址/回环做**真实 TCP 连接**；对非本机地址不做任何"假装可达"的结论。
 */
export async function probeNet(input: ProbeNetInput, timeoutMs = 3000): Promise<ProbeNetResult> {
  const ip = String(input?.ip ?? '').trim();
  const port = Number(input?.port);
  if (!ip || !isValidHost(ip)) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: 'invalid-ip', inboundVerified: false };
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: 'invalid-port', inboundVerified: false };
  }

  const { all, publicOnes } = listLocalAddresses();
  const scope = guiLeiDiZhi(ip);
  const ipv6 = inspectLocalIpv6();
  const targetHost = normalizeHostLiteral(ip);
  const isIPv6Target = targetHost.includes(':') && ipv6ScopeOrNull(targetHost) !== null;
  const resolvedIpv4: string[] = [];
  const dnsErrors: string[] = [];
  const hosts = [ip, ...(Array.isArray(input.domains) ? input.domains : []).map((d) => String(d ?? '').trim()).filter(Boolean)];

  for (const h of hosts) {
    if (isIpv4(h)) {
      if (!resolvedIpv4.includes(h)) resolvedIpv4.push(h);
      continue;
    }
    try {
      const rs = await dns.promises.lookup(h, { all: true });
      for (const r of rs) if (r.family === 4 && !resolvedIpv4.includes(r.address)) resolvedIpv4.push(r.address);
    } catch (e) {
      dnsErrors.push(`${h}:${(e as NodeJS.ErrnoException).code ?? 'dns-failed'}`);
    }
  }

  const onLocalNic = all.includes(ip) || publicOnes.includes(ip);
  const scopes = [scope, ...resolvedIpv4.map((a) => guiLeiDiZhi(a))];
  const anyPublic = scopes.includes('public');
  const allPrivateLike = scopes.every((s) => s === 'private' || s === 'loopback' || s === 'link-local');
  // isPublic **只由地址事实推出**（私网/回环/链路本地/CGNAT 一律 false），绝不硬编码；
  // "是否真的能被别人拨进来"属于入站可达性 → inboundVerified 恒 false（本机无法验证）。
  const isPublic = anyPublic;
  const lanOnly = allPrivateLike || (onLocalNic && guiLeiDiZhi(ip) !== 'public');

  const outbound = await checkOutbound(timeoutMs);

  // 公网地址 + NAT 判定：真的问一次回显服务（失败就如实缺字段）
  const pub = await discoverPublicIp(Math.min(timeoutMs, 3000));
  const behindNat = publicOnes.length === 0 && (!pub.ok || !all.includes(pub.ip as string));

  // 端口：只对本机地址/回环做真实连接
  let portCheck: TcpProbeResult | undefined;
  let portCheckTarget: string | undefined;
  if (onLocalNic || scope === 'loopback') {
    portCheckTarget = scope === 'loopback' ? ip : '127.0.0.1';
    portCheck = await tcpProbe(portCheckTarget, port, 1200);
  } else if (resolvedIpv4.length > 0 && all.includes(resolvedIpv4[0] as string)) {
    portCheckTarget = '127.0.0.1';
    portCheck = await tcpProbe(portCheckTarget, port, 1200);
  }

  const methodBits: string[] = [];
  methodBits.push(onLocalNic ? 'local-interface' : scope === 'hostname' ? 'dns-resolve' : `${scope}-address`);
  methodBits.push(outbound.ok ? `outbound-${outbound.method ?? 'ok'}` : 'outbound-failed');
  if (pub.ok) methodBits.push(`public-ip-${pub.source ?? 'echo'}`);
  if (portCheck) methodBits.push(`local-port-${portCheck.ok ? 'open' : 'closed'}`);

  const details: ProbeNetResult['details'] = {
    scope,
    localInterfaces: all,
    onLocalNic,
    resolvedIpv4,
    dnsErrors,
    outbound,
    ...(pub.ok && pub.ip ? { publicIp: pub.ip, publicIpSource: pub.source as string } : { publicIpError: pub.error ?? 'unavailable' }),
    ...(portCheck ? { portCheck } : {}),
    ...(portCheckTarget ? { portCheckTarget } : {}),
    // 附八.9：把本机 IPv6 事实与"目标是不是可拨号的 IPv6 候选"一起回出来（UI 据此提示"可用 IPv6 直连"）
    localIpv6: {
      hasGlobalUnicast: ipv6.hasGlobalUnicast,
      publicCandidate: ipv6.publicCandidate,
      ula: ipv6.ula,
      linkLocal: ipv6.linkLocal,
      reason: ipv6.reason,
    },
    targetIsDialableIpv6: isIPv6Target ? isPublicDialCandidate(ip) : false,
  };

  let errorCode: string | undefined;
  if (!outbound.ok) errorCode = 'no-outbound';
  else if (!isPublic && !lanOnly) errorCode = 'not-public';
  else if (portCheck && !portCheck.ok) errorCode = 'port-not-listening';

  return {
    ok: true,
    isPublic,
    outboundOk: outbound.ok,
    lanOnly,
    method: methodBits.join('+'),
    behindNat,
    ...(pub.ok && pub.ip ? { observedIp: pub.ip } : {}),
    ...(errorCode ? { errorCode } : {}),
    inboundVerified: false,
    naturallyDialable: ipv6.hasGlobalUnicast,
    ...(isIPv6Target ? { targetIpv6Scope: guiLeiIpv6ZuoYongYu(targetHost) } : {}),
    details,
  };
}

/** 只是语法糖：把"是不是 IPv6 字面量"的判断收敛到一处（非法返回 null → 不算 IPv6） */
function ipv6ScopeOrNull(host: string): string | null {
  const s = guiLeiIpv6ZuoYongYu(host);
  return s === 'invalid' ? null : s;
}

/* ────────────────────────────── 鉴权组网服务 ────────────────────────────── */

export interface MeshPeerRef {
  nodeId: string;
  name?: string;
  host: string;
  port: number;
  kind?: 'lan' | 'wan';
  lastSeen?: number;
}

export interface SecureInboundMessage {
  id: string;
  from: string;
  to: string | '*';
  channel: SyncMessage['channel'];
  groupId?: string;
  payload: unknown;
  ts: number;
  incognito?: boolean;
  /** 鉴权后的对端指纹（**来自握手**，不是消息自称） */
  peerFingerprint: string;
  remoteAddress?: string;
}

/**
 * 端口绑定事实。**请求的端口与实际绑上的端口必须分开报**。
 *
 * 实现**绝不改端口**（绑不上就是失败，不换一个接着试，也不改内存/设置里的值），
 * 所以绑成功时两者恒等；绑失败时 `boundPort = 0`、`errorCode` 是底层 errno。
 * 分开报是为了让 UI 能说清"**你填的哪个端口**绑不上、为什么"。
 */
export interface MeshBindInfo {
  /** 调用方要求的端口（原样回报，实现绝不改写） */
  requestedPort: number;
  /** 真正 bind 成功的端口；0 = 没绑上（组网没起来） */
  boundPort: number;
  /** 绑定失败的底层错误码（EADDRINUSE / EACCES …）；绑上了就没有这个字段 */
  errorCode?: string;
}

export interface MeshEnableResult {
  ok: boolean;
  /** **实际**绑定的端口（= 请求的那个；实现不会换成别的） */
  port?: number;
  nodeId?: string;
  /**
   * 失败时如实回错误码：
   * · `port-bind-failed` —— 端口无法绑定（`error` 里是底层 errno，如 EADDRINUSE）
   * · `identity-locked` / `identity-missing` —— 身份门控没过
   */
  errorCode?: string;
  unlock?: SignerUnlockState | null;
  error?: string;
  notes?: typeof NET_NOTES;
  /** 便捷字段：= bind.requestedPort */
  requestedPort?: number;
  /** 端口绑定事实（请求的端口 / 实际绑上的端口 / 底层错误码） */
  bind?: MeshBindInfo;
}

export interface MeshStatusResult {
  ok: boolean;
  /** 组网是否开着（= 本机鉴权监听在跑） */
  meshEnabled: boolean;
  link: {
    reachable: boolean;
    latencyMs?: number;
    lastError?: string;
    peers?: { nodeId: string; host: string; port: number; reachable: boolean; latencyMs?: number; lastError?: string; session?: boolean }[];
  };
  local?: { ip: string; port: number };
  /**
   * 端口绑定事实：请求的端口 vs **实际**绑上的端口。
   * 组网因端口绑不上而没起来时，这里给出"是哪个端口、什么底层错误"（UI 据此明确告知用户）。
   */
  bind?: MeshBindInfo;
  publicIp?: string;
  behindNat?: boolean;
  nodeId?: string;
  sessions?: number;
  handshakeRejections?: Record<string, number>;
  unlock?: SignerUnlockState | null;
  /** 附八.9：本机 IPv6 事实（有全局单播 = 天然可拨入候选，阶梯第一档就是 IPv6 直连） */
  ipv6?: { hasGlobalUnicast: boolean; publicCandidate: string | null; ula: string[]; linkLocal: string[]; reason: string };
  /** 附八.9/附八.3：可达性提示（结构化，含"需中继"状态与 i18n key） */
  reachability?: ReachabilityHint;
}

export interface SecureMeshOptions {
  userDataDir: string;
  nodeId: string;
  /** 取本机身份（延迟取：启动早期可能还没有） */
  store: () => IdentityStore | null;
  /** 已知对端（peerReg：手工添加 / 发现到的） */
  peers: () => MeshPeerRef[];
  /** 收到对端消息（IPC 层转渲染进程） */
  onInbound?: (msg: SecureInboundMessage) => void;
  onEvent?: (e: { type: string; detail?: string; peer?: string; ts: number }) => void;
  /**
   * 本机是否可拨入（来自 DialabilityProbe / autonat 结论；`undefined` = 还没测过）。
   * **不要猜**：拿不到就留 undefined，`reachabilityFor()` 会如实标"未知"。
   */
  selfDialable?: () => boolean | undefined;
  /** 中继候选（有公网地址、能转发的节点）——附八.3 双 CGNAT 的唯一出路 */
  relays?: () => ZhongJiHouXuanYinYong[];
  now?: () => number;
}

/**
 * 鉴权组网服务：一台 `SecureSyncServer` + 若干出站 `SecureSyncClient`。
 * 名册来自本机已知联系人（`peer-contacts.json`，由 identity-provider 读出），
 * 重放防护**持久化**到 `userData/net/replay-guard.json`（不持久化 = 进程重启后可重放）。
 */
export class SecureMesh {
  private server: SecureSyncServer | null = null;
  private port = 0;
  /** 调用方**要求**的端口（与 this.port = 实际绑上的端口分开记；实现绝不改写它） */
  private requestedPort = 0;
  /** 最近一次绑定失败的底层错误码（成功就清掉）——UI 据此说清"为什么绑不上" */
  private bindError: string | null = null;
  private readonly clients = new Map<string, SecureSyncClient>();
  private readonly inbox: SecureInboundMessage[] = [];
  private readonly liveness: LianJieHuoXing;
  private probe: LanProbe | null = null;
  private readonly guard: ReplayGuard;
  private lastStatusAt = 0;
  private lastStatusValue: MeshStatusResult | null = null;
  private lastPeerProbes: { at: number; peers: NonNullable<MeshStatusResult['link']['peers']> } | null = null;
  private unlockSnapshot: SignerUnlockState | null = null;
  readonly handshakeFailures: HandshakeFailureRecord[] = [];
  private announceCount = 0;

  constructor(private readonly opts: SecureMeshOptions) {
    // 重放防护：**必须持久化**，否则进程重启后同一 nonce/seq 仍会被接受（= 重启即可重放）
    this.guard = new ReplayGuard({ persistFile: path.join(opts.userDataDir, 'net', 'replay-guard.json') });
    // 在线判据：事件驱动（连接建立/关闭），不轮询名册。
    // offlineFailures=1 / offlineAfterMs=0：连接断了就判离线（这里的迟滞会变成"谎报在线"）
    this.liveness = new LianJieHuoXing({
      offlineFailures: 1,
      offlineAfterMs: 0,
      onOnline: (fp) => this.opts.onEvent?.({ type: 'online', peer: fp, ts: this.now() }),
      onOffline: (fp, info) => this.opts.onEvent?.({ type: 'offline', peer: fp, detail: info.reason, ts: this.now() }),
    });
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get enabled(): boolean {
    return !!this.server?.listening;
  }

  get boundPort(): number {
    return this.server?.boundPort ?? this.port;
  }

  /** 调用方要求的端口（= 用户在界面上填的那个；实现从不改写它） */
  get requestedNetPort(): number {
    return this.requestedPort;
  }

  /** 端口绑定事实（请求的端口 / 实际绑上的端口 / 底层错误码） */
  bindInfo(): MeshBindInfo {
    return {
      requestedPort: this.requestedPort,
      boundPort: this.enabled ? this.boundPort : 0,
      ...(this.bindError ? { errorCode: this.bindError } : {}),
    };
  }

  get sessionCount(): number {
    return this.server?.sessionList.length ?? 0;
  }

  get announceCallCount(): number {
    return this.announceCount;
  }

  /**
   * 宣告 / 存活判定的「能不能主动拨出」输入（附八.9）。
   *
   * **两个信号刻意不合并**：
   *   · `dialable`        —— 对端真的拨回来了（`selfDialable` 的已验证结论）；
   *   · `naturalDialable` —— 地址事实：本机有全局单播 IPv6 ⇒ IPv6 无 NAT ⇒ 天然可拨入候选。
   *
   * 只认 `dialable === true` 会让有全局 IPv6 的机器被误判成"不可拨入"，
   * 从而只被动等对端拨 —— 正是附八.9 点名的"有 IPv6 的用户白白走上打洞/中继"。
   */
  canDialSignals(): CanDialSignals {
    const dialable = this.opts.selfDialable?.();
    return {
      ...(dialable === undefined ? {} : { dialable }),
      naturalDialable: hasNaturalIpv6Reachability(),
    };
  }

  /** 合并后的判据（回答"要不要主动拨"）；来历仍由 `canDialSignals()` 保留 */
  canDialResolution(): CanDialResolution {
    return resolveCanDial(this.canDialSignals());
  }

  canDial(): boolean {
    return this.canDialResolution().canDial;
  }

  /** 供 `AnnounceService` / 其它接线方直接用的回调（把两个信号原样带过去） */
  canDialProvider(): () => CanDialSignals {
    return () => this.canDialSignals();
  }

  /**
   * 把"可拨出"结论同步给存活判定（`ConnectionLiveness`）。
   * 不同步的后果是实测过的：`dialableFlag` 默认 false 且没人置真 ⇒ `sweep()` 永远短路成
   * "本机不可拨入" ⇒ 待探测成员**一次都不会被拨**（纯被动等）。
   */
  private syncLivenessDialable(): CanDialResolution {
    const res = this.canDialResolution();
    this.liveness.setDialable({
      ...(res.dialable === undefined ? {} : { dialable: res.dialable }),
      naturalDialable: res.naturalDialable === true,
    });
    return res;
  }

  /** 名册（= 本机已知联系人 + 显式 pin 过的指纹） */
  private rosterFor(extra: string[] = []): (fp: string) => boolean {
    return createRosterChecker(this.opts.store(), extra);
  }

  /**
   * 启动组网。**先门控**：身份拿不到签名能力（口令未解锁 / 无身份）→ 直接失败，
   * 不监听、不宣告（`identity-locked`）。这是刻意的：宁愿用户在 UI 上看到"身份未解锁"，
   * 也不要起一个"看起来在跑、实际所有握手都会失败"的监听。
   */
  async enable(port: number, opts: { discovery?: boolean; announce?: boolean } = {}): Promise<MeshEnableResult> {
    const store = this.opts.store();
    const gate = requireSignableIdentity(store);
    this.unlockSnapshot = gate.unlock ?? null;
    if (!gate.ok || !store) {
      return {
        ok: false,
        errorCode: gate.errorCode ?? 'identity-missing',
        unlock: gate.unlock ?? null,
        error: gate.reason ?? 'identity-unavailable',
      };
    }
    const identity = createIdentityProvider(store);
    // 指纹推导**必须**是身份层那一套：默认 base32(sha256(raw)) 与身份层指纹不同，
    // 不注入的话握手层会把每一条合法连接都判成 fingerprint-mismatch。
    const derivation = fingerprintDerivationForAppShell();

    if (this.server?.listening && this.requestedPort === port) {
      if (opts.discovery) await this.startDiscovery();
      if (opts.announce) await this.announce('manual');
      return {
        ok: true,
        port: this.boundPort,
        requestedPort: this.requestedPort,
        nodeId: this.opts.nodeId,
        notes: NET_NOTES,
        bind: this.bindInfo(),
      };
    }

    await this.disable();
    // ⚠️ **只试用户要的那一个端口**。绑不上就**失败**：不换端口、不改内存里的值、
    //    不写回设置、不"兜底顺延"。理由见 settings-store 的 WARMY_SUGGESTED_NET_PORTS
    //    注释：静默换端口会让防火墙/端口映射/对端配置全部对不上，而且用户无从发现。
    //    用户下一步由界面引导（明确告知 + 可点选的建议端口）。
    const server = new SecureSyncServer({
      identity,
      nodeId: this.opts.nodeId,
      port,
      groupId: null,
      fingerprintDerivation: derivation,
      roster: this.rosterFor(),
      replayGuard: this.guard,
      heartbeatMs: 20_000,
      logFile: path.join(this.opts.userDataDir, 'bus', 'secure-mesh.jsonl'),
      onSession: (s) => this.trackSession(s),
      onMessage: (m, s) => this.onMessage(m, s),
      onClose: (s) => {
        this.untrackSession(s);
      },
      onHandshakeEvent: (e) => {
        if (e.type === 'established') this.opts.onEvent?.({ type: 'handshake-ok', peer: e.peer, ts: e.ts });
      },
    });
    try {
      await server.start();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const errno = err.code ?? 'listen-failed';
      // 如实记下"是哪个端口、什么底层错误"：requestedPort 保持用户填的值不变
      this.requestedPort = port;
      this.bindError = errno;
      return {
        ok: false,
        errorCode: 'port-bind-failed',
        error: errno,
        requestedPort: port,
        bind: { requestedPort: port, boundPort: 0, errorCode: errno },
      };
    }
    this.server = server;
    this.port = server.boundPort;
    this.requestedPort = port;
    this.bindError = null;
    // 附八.9：上线即同步"可拨出"判据（否则存活判定的 sweep 会一直当成不可拨入而短路）
    this.syncLivenessDialable();
    if (opts.discovery) await this.startDiscovery();
    if (opts.announce) await this.announce('startup');
    return {
      ok: true,
      port: this.port,
      requestedPort: port,
      nodeId: this.opts.nodeId,
      notes: NET_NOTES,
      bind: this.bindInfo(),
    };
  }

  async disable(): Promise<{ ok: boolean }> {
    await this.stopDiscovery();
    for (const c of this.clients.values()) c.close('mesh-disable');
    this.clients.clear();
    for (const s of this.server?.sessionList ?? []) this.untrackSession(s);
    await this.server?.stop();
    this.server = null;
    this.port = 0;
    // requestedPort / bindError **刻意保留**：那是"上一次尝试的事实"，
    // 关掉组网不等于"用户填的端口变了"或"上次为什么失败"没发生过。
    this.lastPeerProbes = null;
    this.lastStatusValue = null;
    return { ok: true };
  }

  private async startDiscovery(): Promise<void> {
    const info = this.opts.store()?.info();
    if (!info) return;
    await this.stopDiscovery();
    const probe = new LanProbe({
      nodeId: this.opts.nodeId,
      fingerprint: info.fingerprint,
      tcpPort: this.port,
      onPeer: (p) => {
        // 只记地址；所有数据仍走鉴权 TCP。名册外的人拨不进来（roster 拒）。
        this.opts.onEvent?.({ type: 'discovered', peer: p.fingerprint, detail: `${p.host}:${p.port}`, ts: this.now() });
      },
    });
    try {
      await probe.start();
    } catch {
      // 发现失败不影响鉴权组网本身（端口占用/权限）→ 如实继续，不假装发现成功
      this.probe = null;
      return;
    }
    this.probe = probe;
  }

  private async stopDiscovery(): Promise<void> {
    await this.probe?.stop();
    this.probe = null;
  }

  private trackSession(session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.registerConnection(
      fp,
      {
        id: session.info.sessionId,
        kind: session.info.direction === 'inbound' ? 'member-initiated' : 'creator-probe',
        close: () => session.close('liveness-close'),
      },
      this.now()
    );
    this.opts.onEvent?.({ type: 'session', peer: fp, detail: session.info.direction, ts: this.now() });
  }

  private untrackSession(session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.closeConnection(fp, session.info.sessionId, this.now());
    this.liveness.markMiss(fp, this.now());
    // 断开后才轮到"要不要主动拨回"：这里必须用**最新的**可拨出判据（地址可能刚变，例如刚拿到 IPv6）
    this.syncLivenessDialable();
    void this.liveness.sweep(this.now());
  }

  private onMessage(msg: SyncMessage, session: SecureSession): void {
    const fp = session.info.peerFingerprint;
    this.liveness.heartbeat(fp, this.now());
    if (msg.incognito) return; // 无痕：不留在 inbox（与旧实现一致）
    const entry: SecureInboundMessage = {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      channel: msg.channel,
      ...(msg.groupId ? { groupId: msg.groupId } : {}),
      payload: msg.payload,
      ts: msg.ts,
      peerFingerprint: fp,
      ...(session.info.remoteAddress ? { remoteAddress: session.info.remoteAddress } : {}),
    };
    this.inbox.push(entry);
    if (this.inbox.length > 500) this.inbox.splice(0, this.inbox.length - 500);
    this.opts.onInbound?.(entry);
  }

  inboxOf(): SecureInboundMessage[] {
    return [...this.inbox];
  }

  /** 成员在线状态（真判据：**已建立的鉴权连接** + 心跳；没有连接就是不在线） */
  presence(): ChengYuanHuoXing[] {
    return this.liveness.list();
  }

  presenceOf(fingerprint: string): ChengYuanHuoXing {
    return this.liveness.status(fingerprint);
  }

  /** 出站：连一个地址发一条消息（一次拨号一次握手；失败即返回，不重试） */
  async sendToHost(
    host: string,
    port: number,
    msg: Omit<SyncMessage, 'id' | 'ts' | 'from'>,
    opts: { pin?: string; timeoutMs?: number; keepOpen?: boolean } = {}
  ): Promise<{ ok: boolean; error?: string; peerFingerprint?: string; latencyMs?: number }> {
    const store = this.opts.store();
    const gate = requireSignableIdentity(store);
    if (!gate.ok || !store) return { ok: false, error: gate.errorCode ?? 'identity-missing' };
    const key = `${host}:${port}`;
    const existing = this.clients.get(key);
    if (existing?.session?.alive) {
      try {
        existing.session.send(msg);
        return { ok: true, peerFingerprint: existing.session.info.peerFingerprint };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    const started = this.now();
    const client = new SecureSyncClient({
      identity: createIdentityProvider(store),
      nodeId: this.opts.nodeId,
      host,
      port,
      groupId: null,
      fingerprintDerivation: fingerprintDerivationForAppShell(),
      peerFingerprint: opts.pin ?? null,
      roster: this.rosterFor(opts.pin ? [opts.pin] : []),
      replayGuard: this.guard,
      heartbeatMs: 20_000,
      onMessage: (m, s) => this.onMessage(m, s),
      onClose: (s) => {
        this.untrackSession(s);
        if (this.clients.get(key) === client) this.clients.delete(key);
      },
    });
    const r = await client.connect(opts.timeoutMs ?? 6000);
    if (!r.ok || !r.session) {
      if (r.handshakeFailure) this.handshakeFailures.push(r.handshakeFailure);
      return { ok: false, error: r.reason ?? 'connect-failed' };
    }
    this.trackSession(r.session);
    if (opts.keepOpen) this.clients.set(key, client);
    const peerFingerprint = r.session.info.peerFingerprint;
    const latencyMs = this.now() - started;
    try {
      r.session.send(msg);
    } catch (e) {
      return { ok: false, error: (e as Error).message, peerFingerprint, latencyMs };
    }
    if (!opts.keepOpen) client.close('one-shot-done');
    return { ok: true, peerFingerprint, latencyMs };
  }

  /** 向所有已知对端广播（逐个真拨；返回成功/失败计数） */
  async broadcast(msg: Omit<SyncMessage, 'id' | 'ts' | 'from'>): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const p of this.opts.peers()) {
      const r = await this.sendToHost(p.host, p.port, { ...msg, to: msg.to ?? '*' });
      if (r.ok) sent++;
      else {
        failed++;
        errors.push(`${p.nodeId}@${p.host}:${p.port}:${r.error ?? 'fail'}`);
      }
    }
    return { sent, failed, errors };
  }

  /**
   * 宣告"我在线 + 我的地址"：走过**已鉴权**的会话发给每个已知对端。
   * 不是 DHT 宣告（DHT 未接线），也没有重试 —— 失败即放弃，如实记进 errors。
   */
  async announce(reason: 'startup' | 'address-changed' | 'manual' = 'startup'): Promise<{
    ok: boolean;
    reason: string;
    addr: { host: string; port: number };
    attempted: number;
    delivered: number;
    errors: string[];
    errorCode?: string;
  }> {
    const gate = requireSignableIdentity(this.opts.store());
    this.unlockSnapshot = gate.unlock ?? this.unlockSnapshot;
    if (!gate.ok) {
      return {
        ok: false,
        reason,
        addr: { host: '', port: this.port },
        attempted: 0,
        delivered: 0,
        errors: [],
        errorCode: gate.errorCode ?? 'identity-locked',
      };
    }
    const info = this.opts.store()?.info();
    const { all } = listLocalAddresses();
    const host = pickLocalAddress(all);
    const payload = {
      type: 'announce',
      reason,
      fingerprint: info?.fingerprint ?? '',
      nodeId: this.opts.nodeId,
      host,
      port: this.port,
      generation: info?.generation ?? 0,
      at: this.now(),
    };
    this.announceCount += 1;
    const r = await this.broadcast({ to: '*', channel: 'announce', payload });
    return {
      ok: r.failed === 0,
      reason,
      addr: { host, port: this.port },
      attempted: r.sent + r.failed,
      delivered: r.sent,
      errors: r.errors,
    };
  }

  /** UI 心跳读的那一份状态（真实现：本机监听自测 + 逐对端 TCP 探测 + 会话表） */
  async status(ttlMs = 1200): Promise<MeshStatusResult> {
    const now = this.now();
    if (this.lastStatusValue && now - this.lastStatusAt < ttlMs) return this.lastStatusValue;
    const store = this.opts.store();
    const unlock = store ? requireSignableIdentity(store).unlock ?? this.unlockSnapshot : null;
    if (!this.enabled) {
      // B5：组网关闭时仍返回**本机事实**（IPv6 / 可拨入性提示），这两项与开关无关。
      // 同步 buildReachabilityHint：不发 socket，只报地址事实。
      const ipv6 = inspectLocalIpv6();
      const value: MeshStatusResult = {
        ok: true,
        meshEnabled: false,
        link: { reachable: false, lastError: 'mesh-disabled', peers: [] },
        nodeId: this.opts.nodeId,
        sessions: 0,
        unlock,
        ipv6: {
          hasGlobalUnicast: ipv6.hasGlobalUnicast,
          publicCandidate: ipv6.publicCandidate,
          ula: ipv6.ula,
          linkLocal: ipv6.linkLocal,
          reason: ipv6.reason,
        },
        reachability: this.buildReachabilityHint(),
        // 组网没起来但"上次绑定失败"是有价值的现场（哪个端口、什么错误）——如实带出去，
        // 让 UI 能在设置里说清原因，而不是只说一句"组网没开"。
        ...(this.bindError ? { bind: this.bindInfo() } : {}),
      };
      this.lastStatusAt = now;
      this.lastStatusValue = value;
      return value;
    }

    // 本机监听自测：真的连一次 127.0.0.1:port（不是"我以为在听"）
    const self = await tcpProbe('127.0.0.1', this.port, 1200);

    // 逐对端探测（缓存 5s：UI 每秒轮询，不能每秒都去拨所有人）
    let peerProbes = this.lastPeerProbes?.peers ?? [];
    if (!this.lastPeerProbes || now - this.lastPeerProbes.at > 5000) {
      const out: NonNullable<MeshStatusResult['link']['peers']> = [];
      for (const p of this.opts.peers().slice(0, 8)) {
        const hasSession = (this.server?.sessionList ?? []).some((s) => s.alive && s.info.remoteAddress === p.host);
        if (hasSession) {
          out.push({ nodeId: p.nodeId, host: p.host, port: p.port, reachable: true, session: true });
          continue;
        }
        const r = await tcpProbe(p.host, p.port, 1500);
        out.push({
          nodeId: p.nodeId,
          host: p.host,
          port: p.port,
          reachable: r.ok,
          ...(r.latencyMs ? { latencyMs: r.latencyMs } : {}),
          ...(r.ok ? {} : { lastError: r.error ?? 'unreachable' }),
        });
      }
      peerProbes = out;
      this.lastPeerProbes = { at: now, peers: out };
    }

    const { all, publicOnes } = listLocalAddresses();
    const localIp = pickLocalAddress(all);
    const ipv6 = inspectLocalIpv6();
    const sessions = this.sessionCount;
    const reachable = self.ok && (peerProbes.length === 0 || sessions > 0 || peerProbes.some((p) => p.reachable));
    const firstFail = peerProbes.find((p) => !p.reachable);

    const value: MeshStatusResult = {
      ok: true,
      meshEnabled: true,
      link: {
        reachable,
        ...(self.latencyMs ? { latencyMs: self.latencyMs } : {}),
        ...(reachable
          ? {}
          : { lastError: self.ok ? (firstFail?.lastError ?? 'peers-unreachable') : (self.error ?? 'not-listening') }),
        peers: peerProbes,
      },
      local: { ip: localIp, port: this.port },
      // 实际绑上的端口在这里（this.port = server.boundPort）；实现不会换成别的端口
      bind: this.bindInfo(),
      // behindNat 用证据判定：网卡里有公网地址 → false（本机可直接被拨入）
      behindNat: publicOnes.length === 0,
      ...(publicOnes.length > 0 && publicOnes[0] ? { publicIp: publicOnes[0] } : {}),
      nodeId: this.opts.nodeId,
      sessions,
      handshakeRejections: { ...(this.server?.rejectionCounts ?? {}) },
      unlock,
      // 附八.9：IPv6 单独一档（IPv6 无 NAT）——注意 behindNat 是 IPv4 视角，两者不能互相替代
      ipv6: {
        hasGlobalUnicast: ipv6.hasGlobalUnicast,
        publicCandidate: ipv6.publicCandidate,
        ula: ipv6.ula,
        linkLocal: ipv6.linkLocal,
        reason: ipv6.reason,
      },
      reachability: this.buildReachabilityHint(),
    };

    this.lastStatusAt = now;
    this.lastStatusValue = value;
    return value;
  }

  /** 让主进程能拿到"上次宣告失败原因"之类的诊断 */
  diagnostics(): { handshakeFailures: HandshakeFailureRecord[]; announceCalls: number; sessions: number; inbox: number } {
    return {
      handshakeFailures: this.handshakeFailures.slice(-20),
      announceCalls: this.announceCount,
      sessions: this.sessionCount,
      inbox: this.inbox.length,
    };
  }

  /**
   * 可达性提示（附八.9 IPv6 单列一档 + 附八.3 中继兜底与"明确告知"）。
   *
   * **同步部分只报"地址事实"**（IPv6 是否可用 / 本机可拨入性），因为中继是否可用
   * 必须**真的拨一次**才算数 —— 那属于 `reachabilityFor()`（异步、真 TCP 探测）。
   * 在同步路径上不编中继结论。
   */
  private buildReachabilityHint(): ReachabilityHint {
    const v6 = inspectLocalIpv6();
    const selfDialable = this.opts.selfDialable?.();
    const rung: LadderRung = v6.hasGlobalUnicast ? 'ipv6-direct' : 'public-direct';
    const dial = resolveCanDial({
      ...(selfDialable === undefined ? {} : { dialable: selfDialable }),
      naturalDialable: v6.hasGlobalUnicast,
    });
    return {
      ipv6: {
        hasGlobalUnicast: v6.hasGlobalUnicast,
        publicCandidate: v6.publicCandidate,
        ula: v6.ula,
        linkLocal: v6.linkLocal,
        reason: v6.reason,
      },
      ...(selfDialable === undefined ? {} : { selfDialable }),
      // 附八.9：地址事实（有全局 IPv6 ⇒ 无 NAT ⇒ 天然可拨入候选）与"已验证可拨入"分开给
      naturalDialable: v6.hasGlobalUnicast,
      dialableKind: dialableKindOf(selfDialable, v6.hasGlobalUnicast),
      dialableI18n: DIALABILITY_I18N[dialableKindOf(selfDialable, v6.hasGlobalUnicast)],
      suggestedRung: rung,
      needsPublicRelayNotice: false,
      i18n: { rung: LADDER_RUNG_I18N[rung] },
    };
  }

  /**
   * 异步可达性（**会真的拨一次中继候选**）：给 UI/IPC 用。
   * 结论码与 i18n key 都是结构化的，UI 不需要解析句子。
   */
  async reachabilityFor(peerFingerprint: string, peerDialable?: boolean): Promise<ReachabilityHint> {
    const v6 = inspectLocalIpv6();
    const selfDialable = this.opts.selfDialable?.();
    const relays = this.opts.relays?.() ?? [];
    const selfFp = this.opts.store()?.info()?.fingerprint;
    // 注意：传给 decideRelay 的 selfDialable **仍然只用已验证的那个信号**。
    // 刻意不把 naturalDialable 塞进去：本地有全局 IPv6 只说明"我这条路可能通"，
    // 对端未必有 IPv6（IPv4-only 对端照样拨不进来），据此宣布"不需要中继"会漏掉应有的兜底。
    const decision = await jueDingZhongJi(
      { fingerprint: peerFingerprint },
      {
        selfDialable,
        peerDialable,
        ...(selfFp ? { selfFingerprint: selfFp } : {}),
        candidates: relays,
        timeoutMs: 1500,
      }
    );
    const rung: LadderRung = decision.selected ? 'relay' : v6.hasGlobalUnicast ? 'ipv6-direct' : 'public-direct';
    const kind = dialableKindOf(selfDialable, v6.hasGlobalUnicast);
    return {
      ipv6: {
        hasGlobalUnicast: v6.hasGlobalUnicast,
        publicCandidate: v6.publicCandidate,
        ula: v6.ula,
        linkLocal: v6.linkLocal,
        reason: v6.reason,
      },
      ...(selfDialable === undefined ? {} : { selfDialable }),
      naturalDialable: v6.hasGlobalUnicast,
      dialableKind: kind,
      dialableI18n: DIALABILITY_I18N[kind],
      suggestedRung: rung,
      relay: decision,
      needsPublicRelayNotice: decision.needsPublicRelayNotice,
      i18n: { rung: LADDER_RUNG_I18N[rung], relay: RELAY_STATUS_I18N[decision.code] },
    };
  }
}

/* ────────────────────────────── 回环冒烟（真握手） ────────────────────────────── */

/**
 * 双机联测的**本机冒烟**：起一个真服务器，用**另一把**临时身份连上去跑完 HS1–HS4。
 *
 * 为什么用临时身份：握手层明确拒绝"对端指纹 == 本机指纹"（自反射攻击）。
 * 旧实现（明文 JSONL、无身份）可以拿同一个 nodeId 自己连自己，鉴权实现不行 ——
 * 这不是退步，而是"自反射"本来就应该被拒绝。
 * 因此这里生成两把**一次性** Ed25519 身份，只在本函数内存里存活，用完即弃；
 * 结论只能说明"鉴权握手 + 加密记录在回环上能跑通"，**不代表**跨机可达（如实写进返回值）。
 *
 * 注意：临时身份用的是 sync-protocol 默认指纹（base32(sha256(raw))），
 * 所以这里**不注入**身份层的 derivation（注入反而会把两边指纹都对不上）。
 */
export async function secureLoopbackSmoke(opts: {
  nodeId: string;
  localPort: number;
  peerHost?: string;
  peerPort?: number;
  timeoutMs?: number;
}): Promise<{
  serverPort: number;
  loopbackOk: boolean;
  peerHost?: string;
  peerOk: boolean;
  peerError?: string;
  secure: {
    handshakeOk: boolean;
    /** 一次性身份（不是本机身份）：仅为跑通握手 */
    ephemeral: true;
    peerFingerprint: string;
    keyFingerprint?: string;
    recordRoundTrip?: boolean;
    failure?: string;
  };
}> {
  const { chuangjianLinShiShenFen } = await import('@warmy/sync-protocol');
  const serverId = chuangjianLinShiShenFen('smoke-server');
  const clientId = chuangjianLinShiShenFen('smoke-client');

  let received: SyncMessage | null = null;
  const server = new SecureSyncServer({
    identity: serverId.provider,
    nodeId: opts.nodeId,
    port: opts.localPort > 0 ? opts.localPort : 0,
    groupId: null,
    // 冒烟：名册只放行这一把一次性身份
    roster: (fp) => fp === clientId.fingerprint,
    peerFingerprint: clientId.fingerprint,
    handshakeTimeoutMs: opts.timeoutMs ?? 8000,
    onMessage: (m) => {
      received = m;
    },
  });
  const serverPort = await server.start();

  let handshakeOk = false;
  let keyFingerprint: string | undefined;
  let failure: string | undefined;
  const client = new SecureSyncClient({
    identity: clientId.provider,
    nodeId: `${opts.nodeId}-smoke-client`,
    host: '127.0.0.1',
    port: serverPort,
    groupId: null,
    peerFingerprint: serverId.fingerprint,
    roster: (fp) => fp === serverId.fingerprint,
    handshakeTimeoutMs: opts.timeoutMs ?? 8000,
  });
  const r = await client.connect(opts.timeoutMs ?? 8000);
  if (r.ok && r.session) {
    handshakeOk = true;
    keyFingerprint = r.session.info.keyFingerprint;
    try {
      r.session.send({ to: '*', channel: 'group', payload: { text: 'loopback-hello', secure: true } });
    } catch (e) {
      failure = (e as Error).message;
    }
  } else {
    failure = r.reason ?? 'connect-failed';
  }
  // 等加密记录真的被对端解出来
  const deadline = Date.now() + 2000;
  while (!received && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
  const arrived = received as SyncMessage | null;
  const recordRoundTrip =
    arrived !== null && ((arrived.payload as { text?: string } | null)?.text ?? '') === 'loopback-hello';

  client.close('smoke-done');
  await server.stop();

  let peerOk = false;
  let peerError: string | undefined;
  if (opts.peerHost && opts.peerPort) {
    // 对端是"另一台机器"：本机没有它的身份/名册 → 只能如实报告失败原因
    const ext = new SecureSyncClient({
      identity: clientId.provider,
      nodeId: `${opts.nodeId}-smoke-peer`,
      host: opts.peerHost,
      port: opts.peerPort,
      groupId: null,
      peerFingerprint: null,
      handshakeTimeoutMs: opts.timeoutMs ?? 8000,
    });
    const er = await ext.connect(opts.timeoutMs ?? 8000);
    peerOk = er.ok;
    peerError = er.ok ? undefined : er.reason;
    ext.close('smoke-peer-done');
  }

  return {
    serverPort,
    loopbackOk: handshakeOk && recordRoundTrip,
    ...(opts.peerHost ? { peerHost: opts.peerHost } : {}),
    peerOk,
    ...(peerError ? { peerError } : {}),
    secure: {
      handshakeOk,
      ephemeral: true,
      peerFingerprint: clientId.fingerprint,
      ...(keyFingerprint ? { keyFingerprint } : {}),
      recordRoundTrip,
      ...(failure ? { failure } : {}),
    },
  };
}

/** 便于断言：把一次探测结果压成一行（不含文案） */
export function summarizeProbe(r: ProbeNetResult): string {
  return `${r.ok ? 'ok' : 'fail'} public=${r.isPublic} outbound=${r.outboundOk} lanOnly=${r.lanOnly === true} inboundVerified=${r.inboundVerified}${r.errorCode ? ` code=${r.errorCode}` : ''}`;
}

/** 便于断言：稳定的短 id（不泄露身份信息） */
export function shortNodeId(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8);
}

/** 供 electron-main 判断"组网数据目录是否可写"（写不进去就别假装有落盘） */
export function ensureNetDir(userDataDir: string): { ok: boolean; dir: string; error?: string } {
  const dir = path.join(userDataDir, 'net');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, dir, error: (e as NodeJS.ErrnoException).code ?? 'mkdir-failed' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ADR 004（本轮定稿）：**项目级属性的跨机同步**
   ---------------------------------------------------------------------------
   产品主的原话（这条决定了整个做法）：**「记录文件的改动应该是无限牛马的功能，
   不是本机的功能」**。

   所以"这是一个容器开发项目 / 创建的容器是哪个 / 创建者停用了它 / 项目目录在哪 /
   工具改过哪些文件"这些**全都是项目属性**，必须**随项目同步给成员**；
   而"创建者那台机器上的容器现在到底起没起"是**现场事实**，只能作为**信号**跟着走。

   因此这一层给两个东西：
     ① `projectAttrsMessage()` / `parseProjectAttrsMessage()` —— 一条**有界、可校验**的
        项目属性 + 可用性信号（不塞文件内容，只塞路径台账的**尾部**）；
     ② `projectInboundGate()` —— 成员侧拿到信号后**怎么处理入站流量**：
        项目不可用时**拒绝并挂到"创建者离线"那一档**（复用 ADR 003 §2.4 / R6 的既有语义，
        **不新造第三种状态**）。

   ⚠️ 纪律：
    · 这里**只做形状与判定**，不 import 容器判定（`container-probe.deriveProjectState`
      才是唯一一份判定）；调用方把 `projectAttrsToStateInput()` 的结果喂给它即可。
    · 解析不认识的东西 ⇒ **如实报错**，不"尽力猜"（半懂不懂地接受一条对端消息比拒绝更危险）。
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 项目属性同步走的**线上频道**。
 * ⚠️ 不是新造一个 channel：协议层的 channel 集合是固定的
 * （`'group' | 'control' | 'invite' | 'gossip' | 'announce'`，见 sync-protocol 的 SyncMessage），
 * 而我们**不改 sync-protocol**。所以搭在既有的 `'control'` 频道上（它本来就是
 * "控制面小消息"的通道，握手层自己的 ping/pong 也走它），用下面的 `kind` 自报身份：
 * 不认识的 kind 一律**拒绝**，不会被误当成 ping 或别的东西。
 */
export const PROJECT_ATTRS_CHANNEL = 'control' as const;
/** 消息内的 type 常量（防止别的负载被误认成项目属性） */
export const PROJECT_ATTRS_KIND = 'warmy.project.attrs';
/** 信号里最多带多少条台账（有界：频道消息不能被台账撑爆） */
export const PROJECT_ATTRS_LEDGER_TAIL = 30;

export type ProjectAvailabilitySignalValue = 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen' | 'unknown';

export interface ProjectAvailabilitySignal {
  /** 创建者节点**当时算出来的**可用性（现场事实，随时间变） */
  availability: ProjectAvailabilitySignalValue;
  /** 机器可读的原因码（与 container-probe 的状态码同族：ok / disabled-by-owner / …） */
  code: string;
  at: number;
}

export interface ProjectAttrsPayload {
  kind: typeof PROJECT_ATTRS_KIND;
  groupId: string;
  /** 群名/类型跟着走，成员第一次收到时才有东西可建 */
  name?: string;
  type?: 'internal' | 'external';
  /** 项目属性（**项目级事实**，不是"本机设置"） */
  project: {
    devEnv: 'host' | 'container';
    runtimeId: string;
    disabledAt: number;
    directory?: string;
    directorySource?: 'creator-picked' | 'checkpoint-workspace';
    env?: { containerRef?: string; imageRef?: string; solidifiedAt?: number };
  };
  availability: ProjectAvailabilitySignal;
  /** 创建者身份指纹：成员侧认"谁是项目主"用它（拿不到就不带） */
  creatorFingerprint?: string;
  /** 工具文件访问台账的**尾部**（项目级、成员可见：只带路径/操作/时间，绝无内容） */
  ledgerTail?: Array<{ op: string; path: string; ts: number; ok: boolean; by: string; bytes?: number }>;
  updatedAt: number;
}

/**
 * 造一条同步消息（**只带白名单字段**；多余字段不会被带出去）。
 * 台账尾部截断到 `PROJECT_ATTRS_LEDGER_TAIL` 条（按时间倒序取最新）。
 */
export function projectAttrsMessage(input: {
  groupId: string;
  name?: string;
  type?: 'internal' | 'external';
  project: ProjectAttrsPayload['project'];
  availability: ProjectAvailabilitySignal;
  creatorFingerprint?: string;
  ledger?: Array<{ op: string; path: string; ts: number; ok: boolean; by: string; bytes?: number }>;
  updatedAt?: number;
}): ProjectAttrsPayload {
  const msg: ProjectAttrsPayload = {
    kind: PROJECT_ATTRS_KIND,
    groupId: String(input.groupId || ''),
    project: {
      devEnv: input.project.devEnv === 'container' ? 'container' : 'host',
      runtimeId: String(input.project.runtimeId || ''),
      disabledAt: Math.max(0, Number(input.project.disabledAt) || 0),
    },
    availability: {
      availability: input.availability.availability,
      code: String(input.availability.code || ''),
      at: Number(input.availability.at) || Date.now(),
    },
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
  if (input.name) msg.name = String(input.name);
  if (input.type) msg.type = input.type === 'external' ? 'external' : 'internal';
  if (input.project.directory) {
    msg.project.directory = String(input.project.directory);
    msg.project.directorySource = input.project.directorySource === 'checkpoint-workspace' ? 'checkpoint-workspace' : 'creator-picked';
  }
  if (input.project.env && (input.project.env.containerRef || input.project.env.imageRef || input.project.env.solidifiedAt)) {
    const env: NonNullable<ProjectAttrsPayload['project']['env']> = {};
    if (input.project.env.containerRef) env.containerRef = String(input.project.env.containerRef);
    if (input.project.env.imageRef) env.imageRef = String(input.project.env.imageRef);
    if (input.project.env.solidifiedAt) env.solidifiedAt = Number(input.project.env.solidifiedAt);
    msg.project.env = env;
  }
  if (input.creatorFingerprint) msg.creatorFingerprint = String(input.creatorFingerprint);
  if (Array.isArray(input.ledger) && input.ledger.length) {
    msg.ledgerTail = input.ledger
      .slice()
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, PROJECT_ATTRS_LEDGER_TAIL)
      .map((e) => ({
        op: String(e.op || ''),
        path: String(e.path || ''),
        ts: Number(e.ts) || 0,
        ok: e.ok !== false,
        by: String(e.by || 'unknown'),
        ...(Number(e.bytes) > 0 ? { bytes: Number(e.bytes) } : {}),
      }));
  }
  return msg;
}

const AVAILABILITY_VALUES: readonly ProjectAvailabilitySignalValue[] = ['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen', 'unknown'];

/** 校验对端发来的项目属性消息：**不认识就拒绝**（不做"尽力而为"的宽容解析） */
export function parseProjectAttrsMessage(raw: unknown): { ok: true; value: ProjectAttrsPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not-an-object' };
  const m = raw as Partial<ProjectAttrsPayload>;
  if (m.kind !== PROJECT_ATTRS_KIND) return { ok: false, error: 'not-project-attrs' };
  const groupId = String(m.groupId || '');
  if (!groupId) return { ok: false, error: 'missing-group-id' };
  const p = m.project;
  if (!p || typeof p !== 'object') return { ok: false, error: 'missing-project' };
  if (p.devEnv !== 'host' && p.devEnv !== 'container') return { ok: false, error: 'bad-dev-env' };
  if (typeof p.runtimeId !== 'string') return { ok: false, error: 'bad-runtime-id' };
  const dis = Number(p.disabledAt);
  if (p.disabledAt !== undefined && p.disabledAt !== null && !Number.isFinite(dis)) return { ok: false, error: 'bad-disabled-at' };
  const a = m.availability;
  if (!a || typeof a !== 'object') return { ok: false, error: 'missing-availability' };
  if (!AVAILABILITY_VALUES.includes(a.availability as ProjectAvailabilitySignalValue)) return { ok: false, error: 'bad-availability' };
  const value: ProjectAttrsPayload = projectAttrsMessage({
    groupId,
    ...(m.name ? { name: String(m.name) } : {}),
    ...(m.type ? { type: m.type === 'external' ? 'external' : 'internal' } : {}),
    project: {
      devEnv: p.devEnv,
      runtimeId: String(p.runtimeId),
      disabledAt: Number.isFinite(dis) ? Math.max(0, dis) : 0,
      ...(p.directory ? { directory: String(p.directory) } : {}),
      ...(p.directorySource ? { directorySource: p.directorySource } : {}),
      ...(p.env && typeof p.env === 'object' ? { env: p.env } : {}),
    },
    availability: {
      availability: a.availability as ProjectAvailabilitySignalValue,
      code: String(a.code || ''),
      at: Number(a.at) || 0,
    },
    ...(m.creatorFingerprint ? { creatorFingerprint: String(m.creatorFingerprint) } : {}),
    ...(Array.isArray(m.ledgerTail) ? { ledger: m.ledgerTail.map((e) => ({ op: String(e.op || ''), path: String(e.path || ''), ts: Number(e.ts) || 0, ok: e.ok !== false, by: String(e.by || 'unknown'), ...(Number(e.bytes) > 0 ? { bytes: Number(e.bytes) } : {}) })) } : {}),
    updatedAt: Number(m.updatedAt) || 0,
  });
  return { ok: true, value };
}

/**
 * 信号 → `container-probe.deriveProjectState` 的输入事实（**唯一的判定仍然在那份纯函数里**）。
 * 映射规则（拿不准一律当"没就绪" —— 与 ADR 004 §7.1「拿不准当停止」一致）：
 *   · `available` ⇒ runtimeStatus='ready'
 *   · `not-ready` / `stopped` ⇒ 'installed-not-running'（⇒ 项目不可用）
 *   · `not-installed` ⇒ 'not-installed'
 *   · `not-chosen` ⇒ runtimeId 清空（⇒ container-not-chosen）
 *   · `unknown` / 其它 ⇒ runtimeStatus=null（⇒ 按未就绪处理，不乐观放开）
 */
export function projectAttrsToStateInput(signal: {
  project: ProjectAttrsPayload['project'];
  availability: ProjectAvailabilitySignal;
}): { devEnv: 'host' | 'container'; runtimeId: string; runtimeStatus: string | null; disabledByOwner: boolean; source: 'creator-signal' } {
  const availability = signal.availability.availability;
  let runtimeId = String(signal.project.runtimeId || '');
  let runtimeStatus: string | null = null;
  if (signal.project.devEnv === 'container') {
    if (availability === 'available') runtimeStatus = 'ready';
    else if (availability === 'not-installed') runtimeStatus = 'not-installed';
    else if (availability === 'not-ready' || availability === 'stopped') runtimeStatus = 'installed-not-running';
    else runtimeStatus = null;
    if (availability === 'not-chosen') runtimeId = '';
  } else {
    runtimeStatus = null;
  }
  return {
    devEnv: signal.project.devEnv === 'container' ? 'container' : 'host',
    runtimeId,
    runtimeStatus,
    disabledByOwner: Number(signal.project.disabledAt) > 0,
    source: 'creator-signal',
  };
}

/** 成员侧的入站门控结论 */
export interface ProjectInboundGate {
  /** 放行 = 这个项目的入站流量照常处理 */
  allow: boolean;
  /** 不放行时**挂到哪一档**（复用既有语义，不新造状态） */
  queue: 'creator-offline' | null;
  /** 与"创建者下线"同一句文案键（渲染层直接用，**不要**另写一句） */
  memberFaceKey: string | null;
  /** 机器可读原因（项目状态码；文案仍走既有 container.project.reason.<suffix>） */
  projectCode: string;
  /** 放行时也需要知道"这条项目现在可用" */
  projectRunning: boolean;
}

/**
 * 成员侧入站门控：项目不可用（容器没就绪 / 被创建者停用 / 还没选容器）⇒
 * **拒绝并排队为"创建者离线"**，而不是"接受之后再失败"。
 *
 * ⚠️ 这里**不重复**原因码→文案的映射：`projectCode` 原样带回，渲染层用**既有**的
 * `container.project.reason.<suffix>`（与"创建者下线"那一档共用 `group.memberOffline`）。
 */
export function projectInboundGate(state: { running: boolean; code: string; devEnv?: string }): ProjectInboundGate {
  const running = state?.running === true;
  if (running) {
    return { allow: true, queue: null, memberFaceKey: null, projectCode: String(state?.code || 'ok'), projectRunning: true };
  }
  return {
    allow: false,
    queue: 'creator-offline',
    memberFaceKey: 'group.memberOffline',
    projectCode: String(state?.code || 'container-not-ready'),
    projectRunning: false,
  };
}

