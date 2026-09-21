/**
 * 本地账号（登录未开放时的本地会话）与设置持久化
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_CONTEXT_BUDGET_CHARS } from './context-renderer.js';
import { shengchengPingzheng, isValidCredential, pingzhengLeixing } from './credential.js';

export interface BenjiZiliao {
  username: string;
  avatarDataUrl: string;
  email: string;
  passwordHash?: string;
  /**
   * 本机唯一 ID = **身份凭证**（51 位大写，见 credential.ts）。
   * 历史形态（9/17 位数字、UUID）在读取时会被**升级**成凭证，
   * 升级前的值留在 `deviceIdUpgradedFrom` 里备查。
   */
  deviceId?: string;
  /** deviceId 的 HMAC 签名，用于检测配置文件被手改 */
  deviceIdSig?: string;
  /** 若本机 ID 是从历史形态升级来的，这里留下升级前的值（只作备查，不参与任何判定） */
  deviceIdUpgradedFrom?: string;
}

/**
 * 生成新凭证当本机 ID（**不再**采集硬件熵拼数字：凭证本身就是 256 bit 随机，
 * 见 credential.ts —— ID 即私钥，公钥指纹才是给别人的东西）。
 */
export function shengChengPingzheng(): string {
  return shengchengPingzheng();
}

/** 凭证（现行 51 位大写 / 兼容上一版 45 位）——除此之外一律不算有效 ID */
export function shiFouHeFaPingzheng(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  return isValidCredential(v);
}



/** 设备 ID 的 HMAC 签名：ID 被手改一位，签名就对不上 */
function qianMingPingzheng(id: string): string {
  return crypto.createHmac('sha256', 'warmy.device-id.v1').update(id).digest('hex');
}

function anQuanXiangDeng(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let chaYi = 0;
  for (let i = 0; i < a.length; i++) chaYi |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return chaYi === 0;
}

export interface SmtpZhanghao {
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
 * 模型供应商（设置 → 模型）。
 *
 * ⚠️ **这里不存 API Key**：密钥一律走 SecureKeyStore（safeStorage 加密落盘，
 * 见 secure-keys.ts）。本记录只保存**可公开的元数据**，`hasKey` 只说明"有一把密钥"，
 * 读回界面时密钥用密文占位，绝不回明文。
 */
export interface gongyingshangJilu {
  id: string;
  label: string;
  protocol: 'openai-compatible' | 'anthropic' | 'ollama';
  baseURL: string;
  defaultModel?: string;
  /** 已拉取到的模型列表 */
  models: string[];
  /**
   * **需要重新拉取的模型**（改过名称/接口/密钥之后）：true = 可能无法正常使用。
   * 重新拉取到同一模型后清掉；没拉到、又没人在用的模型直接删除，
   * 没拉到但**正在被使用**的模型保留并继续标红（悬停显示占用位置）。
   */
  staleModels?: Record<string, boolean>;
  /** 是否已存有密钥（密钥本体在 SecureKeyStore） */
  hasKey?: boolean;
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

export interface YingYongPeizhi {
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
  smtpAccounts: SmtpZhanghao[];
  /**
   * Skill auto-discovery directories (absolute paths). Persisted through the
   * existing settings channel — no separate storage file.
   * Skills under these directories are scanned with source = 'discovered'.
   * Max SKILL_SCAN_DIRS_MAX (10).
   */
  skillScanDirs: string[];
  /**
   * Plugin auto-discovery directories (absolute paths). Max SKILL_SCAN_DIRS_MAX (10).
   * "检查插件" scans these dirs and installs discovered plugins into the list.
   */
  pluginScanDirs?: string[];
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
  /** 全局横幅关闭记录（跨窗口/跨启动保持关闭） */
  netBannerDismissed?: string[];
  /**
   * Privacy policy consent. Default false — first launch must show policy after language pick.
   * Revoke in About closes the app; next launch requires agree again.
   */
  privacyConsent?: boolean;
  /** 聊天自动滚动到最新（默认关） */
  autoScrollChat?: boolean;
  /**
   * 会话上下文注入总预算（百分比，相对所选模型的上下文窗口）。
   * 10..90，默认 60（留余地）。群聊不暴露该设置，由后台自动收敛。
   */
  contextBudgetPercent?: number;
  /** 空闲自动摘要（默认开） */
  autoSummary?: boolean;
  /** 预估用的模型上下文窗口（token）；拿不到就按默认 32768 */
  modelContextTokens?: number;
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
  /**
   * 模型供应商列表（设置 → 模型）。空数组 = 还没落盘过：
   * 界面首次打开时会用内置预设（DeepSeek / Ollama 本地）初始化一次并保存。
   */
  providers?: gongyingshangJilu[];
  /**
   * **当前生效的供应商**（真正用于聊天的那一个）。密钥不在里面，按 id 从 SecureKeyStore 取。
   * 以前它只活在主进程内存里 ⇒ 重启后"配好的供应商"就没了，这里落盘修掉。
   */
  activeProvider?: {
    presetId: string;
    baseURL?: string;
    model?: string;
    protocol: 'openai-compatible' | 'anthropic' | 'ollama';
  };
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

export class BenDiZhangHuCang {
  constructor(private file: string) {}

  loadProfile(): BenjiZiliao {
    let p: BenjiZiliao;
    try {
      p = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      p = { username: '主人', avatarDataUrl: '', email: '' };
    }
    /**
     * ID = 凭证（51 位大写，见 credential.ts）。
     *
     * 两种必须落盘修正的情况：
     *  1) 缺失/被手改（HMAC 对不上）⇒ 重新生成；
     *  2) **是历史形态**（9 位/17 位数字、UUID）⇒ 升级成凭证 ——
     *     老形态**不是密钥种子**，"ID 即私钥"这条产品承诺在它们身上不成立。
     *     这里只负责**换掉 ID 并落盘**；"由此派生的身份"由主进程在启动时按
     *     `identityCredentialMigrated` 标记重建（旧身份文件先备份），见 electron-main。
     */
    const before = String(p.deviceId || '');
    const signedOk = this.verifyIdFields(p);
    /**
     * 两种必须落盘修正的情况，语义不同：
     *  · **形态不认识**（9/17 位数字、UUID、空）⇒ 一律**升级**成凭证（老形态不是密钥种子）；
     *  · 形态是现役凭证但**签名对不上**（被手改）⇒ 只能重新生成一把（旧的那把已经不可信）。
     * 签名判定只对现役凭证有意义：老形态本来就不该通过校验，那是"该升级"而不是"被篡改"。
     */
    const weizhiXingzhuang = pingzhengLeixing(before) === null;
    const beigaIPingzheng = !weizhiXingzhuang && !signedOk;
    if (weizhiXingzhuang || beigaIPingzheng) {
      p.deviceId = shengChengPingzheng();
      p.deviceIdSig = qianMingPingzheng(p.deviceId);
      if (weizhiXingzhuang && before) p.deviceIdUpgradedFrom = before;
      if (beigaIPingzheng) p.deviceIdUpgradedFrom = `tampered:${before.slice(0, 6)}…`;
      try { this.saveProfile(p); } catch { /* 只读目录时忽略 */ }
    }
    return p;
  }

  /** 校验 ID 形态与 HMAC 签名；不触碰文件、不重新生成 */
  verifyIdFields(p: Partial<BenjiZiliao>): boolean {
    if (!shiFouHeFaPingzheng(p.deviceId)) return false;
    if (typeof p.deviceIdSig !== 'string' || !p.deviceIdSig) return false;
    return anQuanXiangDeng(qianMingPingzheng(p.deviceId), p.deviceIdSig);
  }

  /** 供界面展示：当前 ID 与校验状态（只读，不修复） */
  idStatus(): { id: string; valid: boolean } {
    let raw: Partial<BenjiZiliao>;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { id: '', valid: false };
    }
    return { id: raw.deviceId || '', valid: this.verifyIdFields(raw) };
  }

  saveProfile(p: BenjiZiliao): BenjiZiliao {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { passwordHash: _drop, ...rest } = p;
    fs.writeFileSync(this.file, JSON.stringify(rest, null, 2));
    return rest as BenjiZiliao;
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

  loginLocal(pw: string): { ok: boolean; profile?: BenjiZiliao } {
    if (!this.verifyPassword(pw)) return { ok: false };
    const p = this.loadProfile();
    return { ok: true, profile: { username: p.username, avatarDataUrl: p.avatarDataUrl, email: p.email } };
  }
}

export class PeizhiCang {
  constructor(private file: string) {}

  load(): YingYongPeizhi {
    try {
      return { ...defaults(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return defaults();
    }
  }

  save(s: Partial<YingYongPeizhi>): YingYongPeizhi {
    const next = { ...this.load(), ...s };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}

function defaults(): YingYongPeizhi {
  return {
    locale: 'zh-CN',
    themeMode: 'system',
    accent: '#07c160',
    sound: { complete: true, request: true, error: true },
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    /** 第二列默认取最小可读宽度；用户拖动后 persistKey=listWidth 记住 */
    listWidth: 160,
    panelWidth: 300,
    globalSecurity: 'normal',
    smtpAccounts: [],
    skillScanDirs: [],
    pluginScanDirs: [],
    skillEnabled: {},
    setupDone: false,
    netBannerDismissed: [],
    privacyConsent: false,
    autoScrollChat: false,
    contextBudgetPercent: 60,
    autoSummary: true,
    modelContextTokens: 32768,
    /** 产品默认更新源：GitHub Releases API */
    updateFeedUrl: 'https://api.github.com/repos/Pondsi/WArmy/releases/latest',
    embedUseGpu: true,
    /** 还没落盘过供应商列表：界面首帧用内置预设初始化（并立刻保存一次） */
    providers: [],
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
