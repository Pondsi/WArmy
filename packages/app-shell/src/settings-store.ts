/**
 * 本地账号（登录未开放时的本地会话）与设置持久化
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { DEFAULT_CONTEXT_BUDGET_CHARS } from './context-renderer.js';

export interface LocalProfile {
  username: string;
  avatarDataUrl: string;
  email: string;
  passwordHash?: string;
  /** 本机唯一 ID：9 位数字，首次生成后写入配置文件 */
  deviceId?: string;
  /** deviceId 的 HMAC 签名，用于检测配置文件被手改 */
  deviceIdSig?: string;
}

/**
 * 采集本机熵源（网络 / 硬件 / IP / 13 位时间戳），
 * 哈希后折算成 9 位十进制数字（100000000–999999999），几乎不会重复。
 */
function collectEntropy(): string {
  const parts: string[] = [];
  parts.push(String(Date.now()));                 // 13 位毫秒时间戳
  parts.push(`${process.platform}-${process.arch}`);
  try { parts.push(os.hostname()); } catch { /* 忽略 */ }
  try { parts.push(os.userInfo().username); } catch { /* 忽略 */ }
  try {
    const cpus = os.cpus();
    const first = cpus[0];
    if (first) parts.push(`${first.model}#${cpus.length}`);
  } catch { /* 忽略 */ }
  try { parts.push(String(os.totalmem())); } catch { /* 忽略 */ }
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets).sort()) {
      for (const a of nets[name] || []) {
        if (a.internal) continue;
        parts.push(`${name}/${a.family}/${a.mac}/${a.address}`);  // MAC + 局域网 IP
      }
    }
  } catch { /* 忽略 */ }
  return parts.join('|');
}

export function generateDeviceId(): string {
  const digest = crypto.createHash('sha256').update(collectEntropy()).digest('hex');
  const n = BigInt('0x' + digest.slice(0, 16)) % 900000000n;
  return String(n + 100000000n);   // 恒为 9 位
}

/** 仅接受「9 位且首位非 0」的形态 */
export function isValidDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[1-9][0-9]{8}$/.test(v);
}

/** 设备 ID 的 HMAC 签名：ID 被手改一位，签名就对不上 */
function signDeviceId(id: string): string {
  return crypto.createHmac('sha256', 'warmy.device-id.v1').update(id).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SmtpAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** 授权码；本地保存，界面可用密文展示 */
  pass: string;
  /** 验证结果缓存 */
  verified?: boolean;
  lastVerifyAt?: number;
}

/**
 * 生产环境默认 TCP 端口（产品负责人**最终**决定：59599）。
 *
 * 这只是**默认值**，不是限制：界面上这个端口随时可以改成 1–65535 的任意值，
 * 用户在任何环境用任何端口都允许（本文件不做任何「角色端口」校验，也不禁止
 * 开发/测试机器使用生产端口或反之）。LAN 发现用的 UDP 7799 与此无关，仍在别处维护。
 */
export const WARMY_DEFAULT_NET_PORT = 59599;

/** 开发/调试**约定**端口。只是约定：UI 把它当提示显示，**不**限制用户填写。 */
export const WARMY_DEV_NET_PORT = 58588;

/** 测试**约定**端口。只是约定：UI 把它当提示显示，**不**限制用户填写。 */
export const WARMY_TEST_NET_PORT = 62666;

/**
 * **建议**候选端口（顺序 = 推荐顺序；首项就是生产默认端口 59599）。
 *
 * 用途**只有一个**：绑定失败时给用户看的**建议**。它既不是"兜底链"，也不是白名单：
 *   · 绑不上就**失败并告知**（带端口号与底层错误码），**绝不自动改端口**；
 *   · 用户点一下建议，只是把该端口**填进端口输入框**，仍然可以改成任意端口；
 *   · 没有任何代码会因为"端口不在这个列表里"而拒绝用户（1–65535 全部自由可填）。
 *
 * **为什么不能自动改端口**（这是刻意的产品决定）：
 * 静默换端口会让用户以为仍在用自己配的端口，实际却监听在另一个端口，于是
 * 防火墙放行规则、路由器端口映射、对端填的地址**全部对不上**，而且用户**无从发现**
 * —— 界面上一切正常、组网显示"已打开"，只有连接莫名其妙不通。这类故障极难自证，
 * 代价远大于"启动失败并说清原因"。所以：宁可**失败并告知**，也不替用户做主。
 *
 * **为什么这些端口合适**：49152–65535 是操作系统的动态/临时端口范围
 * （Windows 默认恰好是 49152–65535）。固定监听落在这段里，可能与**本机某个主动外连**
 * 的 socket 撞上操作系统临时分配的同一端口而绑不上；列表里的端口分散选取并避开常见
 * 服务端口，因此在"默认端口偶然被占"时是更可能成功的候选。
 *
 * **已剔除 63888**：Windows 上 Hyper-V / WSL 会整段保留端口（本机实测保留段
 * 63840–63939 正好覆盖 63888，见 `netsh int ipv4 show excludedportrange protocol=tcp`），
 * 落在保留段里的端口**永远绑不上**（EACCES），留在建议表里只会让用户点一下、再失败一次。
 * 扩展搜索阶段同样会跳过系统保留段 —— 见 net-wiring.ts 的 `getOsReservedTcpRanges`。
 */
export const WARMY_SUGGESTED_NET_PORTS: readonly number[] = [
  59599, 57757, 52555, 55151, 55335, 55521, 55593, 56662, 57575, 58785,
  59993, 61888, 62026, 62526, 62826, 63236, 63636,
];

/** Maximum number of skill auto-discovery directories the user may configure. */
export const SKILL_SCAN_DIRS_MAX = 10;

/** Supported UI locale pack ids (mirrors src/i18n/locales.ts; kept here so settings stay aligned). */
export const SETTINGS_SUPPORTED_LOCALES = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja',
  'ko',
  'ru',
  'es',
  'fr',
  'pt',
  'eo',
] as const;

export interface AppSettings {
  /** One of SETTINGS_SUPPORTED_LOCALES. Stored as free string for backward compat; resolveLocale maps unknown tags. */
  locale: string;
  themeMode: 'light' | 'dark' | 'system';
  accent: string;
  sound: { complete: boolean; request: boolean; error: boolean };
  soundFiles: { complete: string; request: string; error: string };
  emailOnRequest: boolean;
  listWidth: number;
  panelWidth: number;
  globalSecurity: 'full' | 'normal' | 'strict';
  /** 最多 10 个 SMTP 账号 */
  smtpAccounts: SmtpAccount[];
  /**
   * Skill auto-discovery directories (absolute paths). Persisted through the
   * existing settings channel — no separate storage file.
   * Skills under these directories are scanned with source = 'discovered'.
   * Max SKILL_SCAN_DIRS_MAX (10).
   */
  skillScanDirs: string[];
  /**
   * Per-skill runtime enable flag. Key = skill id (from skills-list).
   * Missing key = enabled (default on). Persisted so pause survives restart.
   */
  skillEnabled?: Record<string, boolean>;
  /**
   * First-run onboarding: language picker shown until true.
   * Installer/first launch must surface language selection immediately.
   */
  setupDone?: boolean;
  /** 更新源（GitHub Releases API / feed JSON）。空串 = 未配置 */
  updateFeedUrl?: string;
  updateChannel?: string;
  /**
   * Networking config persisted from the 组网设置 card.
   * `publicAddresses` is a mixed list of IPs and domain names.
   * Legacy `ip` / `domains` are kept as mirrors for older readers.
   */
  net?: {
    ip?: string;
    port?: number;
    domains?: string[];
    publicAddresses?: string[];
  };
  /** 嵌入是否使用 GPU（WebGPU）；false=WASM/CPU */
  embedUseGpu: boolean;
  /** 邮件通知：完成/请求/错误 */
  emailNotify: { complete: boolean; request: boolean; error: boolean };
  /**
   * 上下文有界渲染器的视图预算（字符）—— ADR 002 / 不变量 #2。
   * 注入给模型的上下文恒 ≤ 该值，与日志总长解耦（默认见 DEFAULT_CONTEXT_BUDGET_CHARS）。
   * 下限 200：更小的预算连可执行指针都放不下（渲染器仍不抛错，只是退化为截断指针）。
   */
  contextBudgetChars: number;
  /**
   * 工具调用循环的最大轮数 —— ADR 002 §9.4 待办 2。
   * 模型要工具 → 宿主执行 recall/retrieve → 结果回给模型 → 再问，最多这么多轮。
   * **0 = 不暴露工具**（退回普通单轮对话，即"现状"）。
   */
  contextToolMaxRounds: number;
  /** 单条工具结果上限（字符，默认 4000） */
  contextToolResultChars: number;
  /** 一轮对话内工具结果的**总**预算（字符，默认 12000） */
  contextToolTotalChars: number;
  /**
   * ADR 004 §2.1：**运行/测试环境**（run）选择 —— ⚠️ **已作废（产品主第七批最终确认）**。
   * 容器的职责是**开发**，测试与运行不在容器职责内，所以这个选项及其存储被**整块删除**。
   * 这里保留一个只读的兼容注释：老设置文件里可能还留着 `containerRun` 字段，
   * 主进程读设置时**不再使用**它（`SettingsStore.load()` 是浅合并，多余字段自然被忽略）。
   * 不要把它加回来 —— 要加回来必须先推翻"容器 = 开发环境"这条定位。
   */
  containerRun?: never;
  /**
   * ADR 004：**开发环境**（dev）—— 创建项目时**必选**
   * （`host` = 本机 / `container` = 容器中），按 groupId 存。
   * 只读旧配置里没有这一项的项目**一律按 `host` 处理**（不猜、不回溯改用户的选择）。
   */
  containerDev?: Record<string, 'host' | 'container'>;
  /**
   * ADR 004：**『停用项目』**（右键菜单里的启用/停用）—— 按 groupId 记停用时间戳；缺项 = 启用中。
   *
   * 语义（产品主第七批最终确认）：
   *   · **与是否选了容器开发无关**，任何项目都能停用；
   *   · 停用后：项目**置灰、不可聊天、其中功能不可用，只能翻看之前的记录（历史仍可读）**；
   *   · 对成员的可见效果**与「创建者下线」一致**（复用 ADR 003 §2.4 / R6 既有语义）。
   * 而"容器没启动 ⇒ 容器开发项目不可用"是**另一条独立事实**（每次现场探测），
   * 两条任一成立 ⇒ 项目就是不可用（见 container-probe 的 deriveProjectState）。
   */
  projectDisabled?: Record<string, number>;
  /**
   * ADR 004：**容器开发项目选定的运行时**（右键菜单「切换容器…」设置），按 groupId 存。
   * 缺项 = 还没选 ⇒ 项目也算不可用（没地方开发），由 UI 提示"先选一个容器"。
   */
  containerProjectRuntime?: Record<string, string>;
  /**
   * ADR 004 §7.8（第九批）：**每个项目的容器与环境状态** —— 与"记住每个项目用哪个容器"配套。
   * 这里存的是**真发生过的事**（容器引用 / 上次固化时间 / 固化产物列表），
   * 没真固化过就**不写**（不许编一个"已固化"）。
   */
  projectEnv?: Record<string, {
    runtimeId: string;
    /** 容器名/ID（拿不到就留空，不编） */
    containerRef?: string;
    /** 最近一次成功固化的镜像引用与时间（没有就不写） */
    lastImageRef?: string;
    lastSolidifiedAt?: number;
    /** 固化历史（只留最近 N 个，见 solidifyRetention） */
    solidifyHistory?: Array<{ imageRef: string; at: number }>;
  }>;
  /**
   * ADR 004 §7.6（第八批）：**回退点的环境指纹** —— 每个回退点顺便记录当时的镜像 digest / 环境修订。
   * 这样环境变了可以提前告知（"回退了代码但环境变了，仍然可能跑不起来"）。
   * 宿主开发的项目记 `host`（没有环境维度），不写空对象。
   */
  checkpointEnv?: Record<string, {
    active: boolean;
    runtimeId: string;
    revision: string;
    at: number;
    imageDigests?: Record<string, string>;
  }>;
  /**
   * ADR 004（第十六批）：**宿主侧目录加锁**（把"宿主不许编辑"从应用内拒绝推进到文件系统）。
   *
   * ⚠️ 这一项**故意留在本机设置里**，与"项目属性"分开：
   *   · 项目属性（开发环境/运行时/停用/目录/文件台账）是**项目的事实**，随项目同步给成员；
   *   · 目录 ACL 是**这台机器的文件系统状态**（别的机器上根本没有这条 ACL），
   *     同步出去没有意义，也不能由对端代表本机执行。
   * 只有用户显式按键才会写入；记录形态见 container-probe 的 HostDirGuardRecord。
   */
  fsGuard?: Record<string, {
    dir: string;
    sid: string;
    appliedAt: number;
    liftedAt?: number;
  }>;
}

function hash(pw: string) {
  return crypto.createHash('sha256').update(pw + 'warmy').digest('hex');
}

export class LocalAccountStore {
  constructor(private file: string) {}

  loadProfile(): LocalProfile {
    let p: LocalProfile;
    try {
      p = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      p = { username: '主人', avatarDataUrl: '', email: '' };
    }
    // 首次访问即生成 9 位 ID 并落盘；若 ID 或签名被改动/缺失，则重新生成
    if (!this.verifyIdFields(p)) {
      p.deviceId = generateDeviceId();
      p.deviceIdSig = signDeviceId(p.deviceId);
      try { this.saveProfile(p); } catch { /* 只读目录时忽略 */ }
    }
    return p;
  }

  /** 校验 ID 形态与 HMAC 签名；不触碰文件、不重新生成 */
  verifyIdFields(p: Partial<LocalProfile>): boolean {
    if (!isValidDeviceId(p.deviceId)) return false;
    if (typeof p.deviceIdSig !== 'string' || !p.deviceIdSig) return false;
    return safeEqual(signDeviceId(p.deviceId), p.deviceIdSig);
  }

  /** 供界面展示：当前 ID 与校验状态（只读，不修复） */
  idStatus(): { id: string; valid: boolean } {
    let raw: Partial<LocalProfile>;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { id: '', valid: false };
    }
    return { id: raw.deviceId || '', valid: this.verifyIdFields(raw) };
  }

  saveProfile(p: LocalProfile): LocalProfile {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { passwordHash: _drop, ...rest } = p;
    fs.writeFileSync(this.file, JSON.stringify(rest, null, 2));
    return rest as LocalProfile;
  }

  /** 登录功能占位：本地密码校验 */
  setPassword(pw: string): void {
    const p = this.loadProfile();
    p.passwordHash = hash(pw);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(p, null, 2));
  }

  verifyPassword(pw: string): boolean {
    const p = this.loadProfile();
    if (!p.passwordHash) return false;
    return p.passwordHash === hash(pw);
  }

  loginLocal(pw: string): { ok: boolean; profile?: LocalProfile } {
    if (!this.verifyPassword(pw)) return { ok: false };
    const p = this.loadProfile();
    return { ok: true, profile: { username: p.username, avatarDataUrl: p.avatarDataUrl, email: p.email } };
  }
}

export class SettingsStore {
  constructor(private file: string) {}

  load(): AppSettings {
    try {
      return { ...defaults(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return defaults();
    }
  }

  save(s: Partial<AppSettings>): AppSettings {
    const next = { ...this.load(), ...s };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}

function defaults(): AppSettings {
  return {
    locale: 'zh-CN',
    themeMode: 'system',
    accent: '#07c160',
    sound: { complete: true, request: true, error: true },
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    listWidth: 280,
    panelWidth: 300,
    globalSecurity: 'normal',
    smtpAccounts: [],
    skillScanDirs: [],
    skillEnabled: {},
    setupDone: false,
    /** 产品默认更新源：GitHub Releases API */
    updateFeedUrl: 'https://api.github.com/repos/Pondsi/WArmy/releases/latest',
    embedUseGpu: true,
    emailNotify: { complete: true, request: true, error: true },
    /**
     * 默认 4000 字符（= context-renderer 的 DEFAULT_CONTEXT_BUDGET_CHARS，单一来源）。
     * 理由（ADR §8 已声明"预算用字符近似 token，后续按模型 tokenizer 校正"）：
     *  1) 与写入侧 CCR 的单条预算同量级（ccr-compressor DEFAULT_BUDGET = 4000），
     *     两侧串联后不放大：单条先被压到 4000，整段视图再被限在 4000；
     *  2) 4000 字符按常见 BPE 经验值折算约 1.5k~2.7k token（中文约 1.5 字符/token、
     *     ASCII 约 4 字符/token），而 chat-send 的 maxTokens = 1024：
     *     合计留在常见 8k 窗口内，并给输出留 1k token 余量；
     *  3) 明显大于 keepHead(1) + keepTail(8) 的近期原文（约 9 条），
     *     保证"指针 + 要点"与近期原文能同时放进同一个视图（否则视图会退化到只剩头尾）。
     * 本机未提供 tokenizer 词表，故此处是折算估计而非实测 token 数；换算口径可按模型替换。
     */
    contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
    /**
     * 工具调用上限（ADR 002 §9.4 待办 2）。
     * 3 轮足够"recall → retrieve → 终答"的典型链路，又是硬上限：
     * 最坏 4 次模型请求（3 轮工具 + 1 次强制收敛），每次注入都 ≤ contextBudgetChars，
     * 工具结果另有 12000 字符总预算与 4000 字符单条上限 —— 三层都在"有界"这一侧。
     */
    contextToolMaxRounds: 3,
    contextToolResultChars: 4000,
    contextToolTotalChars: 12000,
    /** ADR 004：默认都不在容器里（本机）—— 与"按需安装容器"一致 */
    containerDev: {},
    /** ADR 004：默认没有项目被停用（缺项 = 启用中） */
    projectDisabled: {},
    /** ADR 004：默认没有容器开发项目选定运行时 */
    containerProjectRuntime: {},
    /** ADR 004：默认没有项目的容器/环境记录（没真发生过就不写） */
    projectEnv: {},
    /** ADR 004：默认没有回退点的环境指纹 */
    checkpointEnv: {},
    /** ADR 004：默认没有任何目录被加锁（**绝不自动加锁**） */
    fsGuard: {},
  };
}

export const SMTP_MAX_ACCOUNTS = 10;
