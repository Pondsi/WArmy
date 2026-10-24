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
  /** 第 66 轮：助记词账号接管后，旧明文凭证已销毁（界面不得再展示/复制） */
  authManaged?: boolean;
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
  biaoQian: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** 授权码；本地保存，界面可用密文展示 */
  pass: string;
  /** 验证结果缓存 */
  yiYanZheng?: boolean;
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
  biaoQian: string;
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

/** Supported UI yuYan pack ids (mirrors src/i18n/locales.ts; kept here so settings stay aligned). */
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
  yuYan: string;
  /** 用户称呼（默认值随界面语言；第 54 轮项 1） */
  username?: string;
  themeMode: 'light' | 'dark' | 'system';
  accent: string;
  /**
   * **字体颜色**（产品要求：主题色下面再给一个字体颜色，第一格自定义 + 后面预设色圈）。
   * 默认就是现在的正文黑 `#191919`；空串/缺省 = 跟随主题（不改 `--ink`）。
   */
  ink?: string;
  sound: { complete: boolean; request: boolean; error: boolean };
  soundFiles: { complete: string; request: string; error: string };
  emailOnRequest: boolean;
  listWidth: number;
  panelWidth: number;
  globalSecurity: 'full' | 'normal' | 'strict';
  /** 超出权限是否询问（默认询问）：勾选则越权操作弹请求卡等用户同意/拒绝；不勾选直接拒绝 */
  askOnExceed?: boolean;
  /** 最多 10 个 SMTP 账号 */
  smtpAccounts: SmtpZhanghao[];
  /**
   * **语音识别（ASR）开关**（产品要求：在"允许接收系统/应用的声音"后面加一项）。
   * 关掉 = 不再调用任何 ASR 模型（如实告诉用户"语音识别已关闭"，而不是假装转不出字）。
   */
  asrEnabled?: boolean;
  /**
   * 心跳离线保底「到点由系统唤醒程序」（第 40 轮）—— **默认关**。
   * 用户定稿口径：定时任务本身不能脱离程序，**程序关闭后就不再运行心跳或定时任务**，
   * 而且程序必须能被主动完全关闭 ⇒ **不许自己把自己叫醒**。
   * 只有显式设成 `true`，才允许在 Windows 上给"下一个到点"挂一条系统计划任务，
   * 到点用 `--warmy-xin-tiao-wake=<id>` 把程序唤回来（关掉开关就不再往系统里留任何东西）。
   */
  xinTiaoWake?: boolean;
  /**
   * **识别语言**（ISO-639-1）。默认 `'auto'` = **不传语言参数**，由模型自行判断；
   * 其它值（`zh`/`en`/`yue`…，见渲染层的 ASR_YU_YAN 全表）= 把语言参数显式带给模型。
   */
  asrLang?: string;
  /** Deepgram/AssemblyAI 外部 ASR（密钥存 SecureKeyStore，这里只存选择与端点） */
  asrCloudProvider?: 'none' | 'deepgram' | 'assemblyai';
  asrCloudModel?: string;
  /**
   * 受信任文件夹：只对**读取**放行；写入与执行仍按全局安全档位审批。
   * 父目录信任自动覆盖子目录（与 VS Code Workspace Trust 同一口径）。
   */
  trustedFolders?: string[];
  /**
   * Skill auto-discovery directories (absolute paths). Persisted through the
   * existing settings channel — no separate storage file.
   * Skills under these directories are scanned with source = 'discovered'.
   * Max SKILL_SCAN_DIRS_MAX (10).
   */
  skillScanDirs: string[];
  /**
   * Plugin auto-discovery directories (absolute paths). Max SKILL_SCAN_DIRS_MAX (10).
   * "检查插件" scans these dirs and installs discovered chaJianJi into the list.
   */
  pluginScanDirs?: string[];
  /**
   * Per-skill runtime enable flag. Key = skill id (from skills-list).
   * Missing key = enabled (default qiYong). Persisted so pause survives restart.
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
   * Revoke in About closes the yingYong; next launch requires agree again.
   */
  privacyConsent?: boolean;
  /** 聊天自动滚动到最新（默认关） */
  autoScrollChat?: boolean;
  /** 主窗口吸附开关：默认开；用户改过就落盘，下次启动保持 */
  zhuXiFuKai?: boolean;
  /** 项目内文件左键是否用 nm 查看器打开（默认关；右键「打开」走另一条路） */
  nmKaiWenJian?: boolean;
  /**
   * **回复内容加强**（默认关）：允许牛马按内容性质自选表达方式 ——
   * 纯文字 / SVG 示意图 / 图表 / 可交互页面 / 语音讲解。
   * 开启后更慢、更费 token，所以必须由用户显式勾选。
   */
  enhanceReply?: boolean;
  /**
   * 会话上下文注入总预算（百分比，相对所选模型的上下文窗口）。
   * 10..90，默认 60（留余地）。群聊不暴露该设置，由后台自动收敛。
   */
  contextBudgetPercent?: number;
  /**
   * ── 下面这些字段**一直在被持久化**（`settingsStore.save({...} as never)`），但第 44 轮自查发现
   * 接口里一个都没声明：`as never` 把类型检查整个绕过，于是"设置里到底存了什么"只能靠全文搜索，
   * 改字段名时编译器一句话都不会说。声明出来（形状按各模块自己的类型写，注释点名归属），
   * 这样新增/改名至少有一处可对账。**都是可选字段**：老设置文件里没有它们也照样能读。
   */
  /** 容器运行实例（`container-instances.ts` 写；每条自带 `sheJiaoJieRu` 等按牛马的配置） */
  instances?: Array<Record<string, unknown>>;
  /** 授权台账（越权请求卡批准过什么；`electron-main.ts` 授权卡那一段写） */
  authGrants?: Record<string, unknown>;
  /** 社交接入配置（微信 iLink / 飞书…；凭据本身在 cred-vault，这里只放非密配置） */
  sheJiao?: Array<Record<string, unknown>>;
  /** 拉取模型时问到的能力（`contextLen`/`kind`/`tools`/`vision`；Ollama 读的是 `num_ctx`） */
  modelCaps?: Record<string, { contextLen?: number; kind?: string; tools?: boolean | 'unknown'; vision?: boolean | 'unknown'; buKeYong?: string }>;
  /** `modelCaps` 的口径版本：不匹配就整份作废重拉（不许拿旧口径的能力位当事实） */
  modelCapsVersion?: number;
  /** 特殊用途模型指派（整理/摘要/分类/翻译… 各走哪只模型） */
  specialModels?: Record<string, unknown>;
  /** 用户自定义工具（`ZiDingGongJu`，形状见 electron-main 里的同名接口） */
  customTools?: Array<Record<string, unknown>>;
  /** 工具开关：工具名 → 是否启用 */
  toolEnabled?: Record<string, boolean>;
  /** 工具扫描目录（第 44 轮改成只有一个默认目录 + 用户追加） */
  toolScanDirs?: string[];
  /** 插件扫描目录 / 插件登记（`enabled:false` 表示"看得到但默认不启动"；目录本身见上面的 `pluginScanDirs`） */
  chaJianJi?: Record<string, unknown>;
  /** 自动归档游标：sessionId → 上次归档到的最后一条 seq（增量归档靠它，不许每次全量重做） */
  archiveCursors?: Record<string, number>;
  /** 计划任务上次清理时间（幂等：同一天不重复清） */
  planLastCleanAt?: number;
  /** WebGPU 开关（关掉走 CPU 推理；重启后生效） */
  webgpuEnabled?: boolean;
  /** 首启引导是否走完（首启动交付要看它） */
  guideDone?: boolean;
  /** 导入过的供应商（避免重复导入同一份配置） */
  importedProviders?: Array<Record<string, unknown>>;
  /** 空闲自动摘要（默认开） */
  autoSummary?: boolean;
  /** 预估用的模型上下文窗口（token）；拿不到就按默认 128K（第 51 轮口径） */
  modelContextTokens?: number;
  /** 更新源（GitHub Releases API / feed JSON）。空串 = 未配置 */
  updateFeedUrl?: string;
  updateChannel?: string;
  /**
   * Networking config persisted from the 组网设置 ka.
   * `publicAddresses` is a mixed list of IPs and domain names.
   * Legacy `ip` / `domains` are kept as mirrors for older readers.
   */
  net?: {
    ip?: string;
    port?: number;
    domains?: string[];
    publicAddresses?: string[];
    /**
     * 主机模式（R63）：true = 用户希望在「别人连你」时使用下面的 host 地址。
     * ⚠️ 目前只持久化意图，**协议层尚未接通**；不要把它当成“已经在监听/可被连入”。
     * 兼容旧值：读回时同时接受 boolean 与 `{ enabled: boolean }`。
     */
    hostMode?: boolean | { enabled?: boolean };
    /** 主机地址（`host:port`，IPv6 写成 `[::1]:59599`；缺省端口 59599，最多 10 条） */
    hosts?: string[];
    /**
     * 主机服务商（最多 1000 条）。`hasCredential` 只表示 SecureKeyStore 里“有一条”，
     * 明文凭证**绝不**写进 settings；`credentialState:'pending'` 表示安全存储写入失败/入口缺失。
     */
    providers?: Array<{
      id: string;
      name: string;
      address: string;
      hasCredential?: boolean;
      credentialState?: 'stored' | 'pending' | 'none';
    }>;
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
   * **工具调用次数预算**（每一条用户消息允许的工具调用**次数**上限，默认 40）。
   *
   * 与 `contextToolMaxRounds` 的区别：轮数管的是"模型往回几次"，
   * 一次往返里模型可以一口气要十几个工具调用 —— 真事故：`run_shell` 被拒后
   * 145 秒里换了十几次命令。超预算**不是拒绝**，而是如实告诉模型"预算用完、停下来汇报"。
   */
  toolCallBudget?: number;
  /**
   * **每个模型的额度与能力**（设置 → 模型 → 右键某个拉取到的模型）。第 39 轮加。
   *
   * 键 = 模型 id（与 `providers[].models[]` 同一套命名）。每项都是**可选**：
   * 没写的项一律回落到"拉取模型时问到的信息"（`modelCaps`）/ **官方规格表**（`mo-xing-gui-ge.ts`）/ 内置默认。
   *
   * ⚠️ **「恢复默认」= 按上面那条链重算一遍并存下来**（第 39 轮定的口径，注释以前写的是"整项删掉"，与实现不符）：
   *   拉到的用拉的、拉不到才推，推不出来的项**留空**，不许拿猜测值填。
   * ⚠️ 这里存的**既是数量也是精确值**：`ctxNum/ctxUnit` 是给界面读的（k=1000、m=1,000,000），
   *   `ctxTokens/outTokens` 是事实本身（第 44 轮加，预算/窗口闸/限流都读它）。
   * ⚠️ 与 `modelCaps` 的分工：`modelCaps` 是**机器问出来的事实**（只读、拉取时刷新），
   *   `modelQuota` 是**额度**；其中 `ziDong:true` 的那份是「拉取/恢复默认」自动拍的 ⇒ 可以被下一次拉取覆盖，
   *   只有用户点过「确定」的（`ziDong:false`）才是"认定"，永不自动改。
   */
  modelQuota?: Record<string, {
    /** 上下文窗口：数字 + 单位（k=×1000、m=×1000000）——**这是"界面怎么读"** */
    ctxNum?: number; ctxUnit?: 'k' | 'm';
    /** 单次输出上限：数字 + 单位 */
    outNum?: number; outUnit?: 'k' | 'm';
    /**
     * 第 44 轮新增：**精确 token 数**（`zhanShiDanWei` 一并回传的那一份）。
     * 预算、窗口闸、限流都读这一份；`ctxNum/ctxUnit` 只是读法（1,048,576 读成 1m）。
     * 老记录可能没有这两个字段 ⇒ 读取方按 `num × 单位` 还原，两者都没有才当没设过。
     */
    ctxTokens?: number; outTokens?: number;
    /**
     * **这条记录是谁写的**（第 44 轮）：`true` = 「拉取模型 / 恢复默认」自动拍的快照 ⇒ 下次拉取会重算覆盖；
     * 缺省或 `false` = 用户点过「确定」亲手认定过 ⇒ 永不自动覆盖。
     * 上一版没有这一位，把自动快照当用户输入 ⇒ 探测失败时存下的错窗口（如 Ollama 的 128K）永远刷不掉。
     */
    ziDong?: boolean;
    /**
     * **每分钟请求数：纯数字，单位就是"次"**（没有 k/m 选项 —— 产品定稿）。
     * 存的是**快照**：改窗口不会带动它，改它也不会带动别的项；
     * 只有「拉取模型」与「恢复默认」会重新计算没拉到的那些。
     */
    rpm?: number;
    /** **每分钟 token 数：纯数字，单位就是 token**（同上，快照不联动） */
    tpm?: number;
    /** 输入/输出模态（决定能力标签：输入图像=看图，输出图像=画图，两侧不许混） */
    inTypes?: string[];
    outTypes?: string[];
  }>;
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
    jiHuo: boolean;
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
      // 默认称呼「老板」（产品要求；以前写死「主人」，改 i18n 是改不动的）
      p = { username: '老板', avatarDataUrl: '', email: '' };
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
    const { passwordHash: _drop, ...qiYu } = p;
    fs.writeFileSync(this.file, JSON.stringify(qiYu, null, 2));
    return qiYu as BenjiZiliao;
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

/**
 * 画面/外观类设置 —— **单独一个配置文件** `appearance.json`
 * （产品要求：界面上的设置功能与可改的画面外观各自落到独立配置文件）。
 * 其余功能设置仍写 `settings.json`。老配置里的这些键会在第一次保存时迁过来。
 */
export const APPEARANCE_KEYS = [
  'themeMode', 'accent', 'ink', 'wenZi', 'listWidth', 'panelWidth', 'autoScrollChat',
] as const;

export class PeizhiCang {
  constructor(private file: string) {}

  /** 外观配置文件：与功能设置同目录、不同文件 */
  private get waiGuanFile(): string {
    return path.join(path.dirname(this.file), 'appearance.json');
  }

  private duJson(p: string): Record<string, unknown> {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return {}; }
  }

  load(): YingYongPeizhi {
    const ji = { ...defaults(), ...this.duJson(this.file) } as unknown as Record<string, unknown>;
    const wai = this.duJson(this.waiGuanFile);
    for (const k of APPEARANCE_KEYS) {
      if (wai[k] !== undefined) ji[k] = wai[k];
    }
    /**
     * **一次性迁移**：`contextToolMaxRounds` 的旧默认是 3 —— 那是我们自己的默认值，
     * 不是用户的选择，而且它会让多任务跑到一半就 `max-rounds` 停下（真事故）。
     * 看到 3 就当成"旧默认"，升到新的默认 12。用户显式设的其它值一律不动。
     */
    if (Number(ji.contextToolMaxRounds) === 3) ji.contextToolMaxRounds = 12;
    return ji as unknown as YingYongPeizhi;
  }

  save(s: Partial<YingYongPeizhi>): YingYongPeizhi {
    const next = { ...this.load(), ...s };
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    // 按「功能 / 画面」拆成两个文件写；外观键只出现在 appearance.json（settings.json 里不再留副本）
    const wai: Record<string, unknown> = {};
    const gong: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
      if ((APPEARANCE_KEYS as readonly string[]).includes(k)) wai[k] = v;
      else gong[k] = v;
    }
    fs.writeFileSync(this.file, JSON.stringify(gong, null, 2));
    fs.writeFileSync(this.waiGuanFile, JSON.stringify(wai, null, 2));
    return next;
  }

  /** 恢复出厂默认：两个配置文件都只写回默认值（密钥在 safeStorage，不动） */
  reset(): YingYongPeizhi {
    const next = defaults() as unknown as Record<string, unknown>;
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const wai: Record<string, unknown> = {};
    const gong: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      if ((APPEARANCE_KEYS as readonly string[]).includes(k)) wai[k] = v;
      else gong[k] = v;
    }
    fs.writeFileSync(this.file, JSON.stringify(gong, null, 2));
    fs.writeFileSync(this.waiGuanFile, JSON.stringify(wai, null, 2));
    return next as unknown as YingYongPeizhi;
  }
}

function defaults(): YingYongPeizhi {
  return {
    yuYan: 'zh-CN',
    themeMode: 'system',
    accent: '#A87654',
    /** 字体颜色默认 = 现在的正文黑（浅色主题下的 `--ink`），用户可改 */
    ink: '#191919',
    sound: { complete: true, request: true, error: true },
    soundFiles: { complete: '', request: '', error: '' },
    emailOnRequest: false,
    /** 第二列默认取最小可读宽度；用户拖动后 persistKey=listWidth 记住 */
    listWidth: 200,
    panelWidth: 300,
    globalSecurity: 'normal',
    askOnExceed: true,
    /** 语音识别默认开；语言默认「自动」（不传语言参数，让模型判断） */
    asrEnabled: true,
    asrLang: 'auto',
    asrCloudProvider: 'none',
    asrCloudModel: '',
    trustedFolders: [],
    smtpAccounts: [],
    skillScanDirs: [],
    pluginScanDirs: [],
    skillEnabled: {},
    setupDone: false,
    netBannerDismissed: [],
    privacyConsent: false,
    autoScrollChat: false,
    zhuXiFuKai: true,
    nmKaiWenJian: true,
    contextBudgetPercent: 60,
    autoSummary: true,
    modelContextTokens: 128000,
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
     * **默认 12**（真事故：默认 3 时多任务跑到一半就 `tingZhiYuanYin: 'max-rounds'`，
     * 用户那条「生成 txt + 生成 ppt + 打开 + 等 30 秒 + 写小说」根本跑不完）。
     * 三层仍在"有界"这一侧：每轮注入 ≤ contextBudgetChars，工具结果另有
     * 12000 字符总预算与 4000 字符单条上限。
     */
    contextToolMaxRounds: 12,
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
