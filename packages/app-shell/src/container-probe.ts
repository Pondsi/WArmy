/**
 * 执行环境探测器（ADR 004 §3.1）—— **纯 node 内建模块**，不依赖 electron。
 *
 * 为什么单独成模块：探测要在真实机器上被真实断言（`scripts/verify-container-probe.mjs`
 * 直接 import 本文件编译产物），而 electron-main.ts 一旦被 import 就会 require('electron')。
 * 与 identity-store / repo-guard / lease 的做法一致：纯逻辑模块 + electron-main 调用。
 *
 * 三条硬纪律：
 *  1) **"命令存在" ≠ "可用"**。本机实测：docker CLI 在（29.7.2），守护进程没起
 *     （`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`）；
 *     wsl.exe 在，但**没有已安装发行版**。所以状态必须分
 *     `not-installed` / `installed-not-running` / `ready` 三态，另加两个**如实单列**的：
 *     `engine-error`（装了但引擎报错，不是"没运行"）与 `unsupported-platform`（本机不适用）。
 *  2) **能力声明必须诚实**：WSL / Lima / Colima 是 Linux VM（或 VM 管理），
 *     Windows Sandbox 是一次性 VM —— 它们**不是容器引擎**，UI 上必须说清，
 *     否则用户会以为拿到了容器级隔离。
 *  3) **探测必须便宜且不挂住 UI**：每个子探测都有短超时，并带**并发上限**；
 *     任何失败都只降级成状态 + 原始证据，绝不抛出、绝不重试风暴。
 *
 * 另：本模块**只探测与驱动**，不安装、不提权、不下载、不创建容器。
 *
 * 第十六批追加：**真实执行面**（`runContainerExec` / 容器内 shell 会话 / 固化 commit /
 * 回滚起容器 / 宿主目录加锁的 argv 计划）。仍然是"零原生模块"，只用 node 内置。
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';

/* ══════════════════════════════════════════════════════════════════════════
   类型（结构化，不拼句子）
   ══════════════════════════════════════════════════════════════════════════ */

/** 三态 + 两个如实单列的状态 */
export type ContainerProbeStatus =
  | 'not-installed'
  | 'installed-not-running'
  | 'ready'
  | 'engine-error'
  | 'unsupported-platform';

/** 列表里的运行态（两态为主，另外两个单列，不强归） */
export type ContainerRunState = 'running' | 'not-running' | 'error' | 'unsupported';

/**
 * 引擎类别。ADR 只列了 container / linux-vm / system-container 三种，
 * 这里加 `disposable-vm`：Windows Sandbox 是**一次性** VM，硬塞进前三种都会误导。
 */
export type ContainerEngineKind = 'container' | 'linux-vm' | 'system-container' | 'disposable-vm';

export interface ContainerCapability {
  runCommand: boolean;
  interactiveShell: boolean;
  mountHostDir: boolean;
}

/** 为什么不给启停按钮（用户可见文案走 i18n：container.reason.<code>） */
export type ContainerLifecycleReason =
  | 'ok'
  | 'one-shot-vm'
  | 'vm-not-engine'
  | 'vm-shutdown-affects-all'
  | 'not-standalone-engine'
  | 'system-service-needs-root'
  | 'no-podman-machine'
  | 'ambiguous-instances'
  | 'uncertain-programmatic-control'
  | 'not-installed'
  | 'unsupported-platform';

export interface ContainerLifecycle {
  /** 是否提供「一键启动」按钮 */
  startable: boolean;
  /** 是否提供「停止」按钮 */
  stoppable: boolean;
  /** 没有按钮时，如实说明原因（有按钮时为 'ok'） */
  reason: ContainerLifecycleReason;
  /** 过渡态最长观察窗口（毫秒）：超时如实报"未就绪/未停止" */
  waitMs: number;
  /** 启动/停止后是否需要等守护进程真的就绪（而不是"点了就完事"） */
  awaitReady: boolean;
}

export interface ContainerActionResult {
  kind: 'start' | 'stop';
  ok: boolean;
  code: number | null;
  /** 原始输出/错误行（不翻译，便于排查；已截断） */
  output: string;
  at: number;
  /**
   * **失败原因码**（机器可读；`ok=true` 时为 'ok'）。文案走 i18n：container.action.reason.<code>
   * 为什么必须有它：真机实测发现"启动容器"可能**进程派生了但引擎根本没起来**（CLI 立刻 rc=1），
   * 只看"进程成功派生"就把 accepted 当成功，会让用户以为启动了、其实永远未就绪。
   */
  reasonCode?: string;
}

/**
 * 把**原始输出**归类成原因码（`进程退了但我们得说清为什么`）。
 * 分类只做"能从原文里认出来的事"，认不出就 `engine-start-failed`（不编原因）。
 * 真机实测的两条样例：
 *   · `✗ Failed to start Docker Desktop`
 *   · `starting Docker Desktop: getting launcher path: cannot find registry key "SOFTWARE\Docker Inc.\Docker Desktop"`
 */
export function classifyActionResult(kind: 'start' | 'stop', ok: boolean, output: string, exitCode: number | null): string {
  if (ok) return 'ok';
  const text = String(output || '').toLowerCase();
  if (/cannot find registry key|getting launcher path|getting backend binary path|install incomplete|no such file or directory.*docker desktop/.test(text)) {
    return 'install-incomplete';
  }
  if (/failed to start/.test(text) && kind === 'start') return 'engine-start-failed';
  if (kind === 'stop' && /failed to stop|access is denied|permission/.test(text)) return 'engine-stop-failed';
  if (exitCode === null) return 'no-exit-code';
  return kind === 'start' ? 'engine-start-failed' : 'engine-stop-failed';
}

/** 原因码是否需要"安装不完整"那条更具体的文案（渲染层用它选更精确的提示） */
export function actionNeedsInstallHint(reasonCode: string): boolean {
  return String(reasonCode || '') === 'install-incomplete';
}

export interface ContainerActionState {
  kind: 'start' | 'stop';
  startedAt: number;
  /** 子进程还在跑 = 过渡态 */
  pending: boolean;
  result?: ContainerActionResult;
}

export interface ContainerRuntimeEntry {
  id: string;
  status: ContainerProbeStatus;
  run: ContainerRunState;
  version?: string;
  engine: { kind: ContainerEngineKind; api: string };
  capability: ContainerCapability;
  lifecycle: ContainerLifecycle;
  /** 机器可读的原因码（不是文案） */
  detail: string;
  /** 原始证据（错误输出首行；不翻译） */
  evidence?: string;
  probeMs: number;
  action?: ContainerActionState;
}

export interface ContainerProbeReport {
  ok: true;
  platform: string;
  probedAt: number;
  elapsedMs: number;
  cached: boolean;
  runtimes: ContainerRuntimeEntry[];
  /** 真的可用（ready 且能执行命令）的运行时 id —— 可供「项目 / 我的牛马」选择 */
  usableIds: string[];
  /** 其中**真正的容器引擎**（不含 Linux VM / 一次性沙箱） */
  containerEngineIds: string[];
  /** 装了但没运行 / 引擎报错的 id */
  attentionIds: string[];
  /** 未安装的候选数量（这些只进安装说明，不进列表） */
  notInstalledCount: number;
  /** 过渡态中的操作 */
  pendingActions: Array<{ id: string; kind: 'start' | 'stop'; startedAt: number }>;
  /** 环境类型（Linux / Windows / Android，含"是否真的是容器"与"本轮是否真的支持"） */
  envTypes: ContainerEnvTypeSpec[];
  /** 基础镜像表（公开免费开源；**已按 digest 钉死**，取数方式见 CONTAINER_BASE_IMAGES 注释） */
  images: ContainerBaseImage[];
  /** 实测耗时（启动/停止/容器内跑命令） */
  timings: ContainerTimings;
  /**
   * 「环境固化」能力的**证据与代价**（与 `envSolidifyCapability` 互补：
   * 那个说"能不能"，这个说"我们验到哪一步、代价多大"）。
   * UI 声明固化能力时必须连**证据等级**一起显示，不能只说"支持"。
   */
  freezeEvidence: ContainerFreezeEvidenceSpec[];
}

export interface ContainerProbeOptions {
  /** 覆盖平台（测试用；默认 process.platform） */
  platform?: string;
  /** 复用多久内的结果（毫秒，默认 8000；<=0 = 总是重探） */
  cacheMs?: number;
  /** 单个子探测超时（毫秒，默认 5000） */
  perProbeTimeoutMs?: number;
  /** 并发上限（默认 4） */
  concurrency?: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   环境类型（第三批新增维度）——**与"用哪个容器"是两个独立维度**
   ---------------------------------------------------------------------------
   产品主问："用户需要的真的是 Linux 环境吗？会不会需要安卓环境？Windows 环境？"
   如实回答（写进代码，也写进 UI）：

     Linux   ✅ 真容器。成熟：Windows 上 Docker Desktop / Podman 走 WSL2 / Hyper-V 的 VM 跑 Linux 容器。
     Windows ⚠️ 是真容器，但**受限**：只有 nanoserver / servercore；家庭版基本不可用（要专业版/企业版 +
                容器功能）；nanoserver 约 300MB **且没有 Node**，servercore 约 5GB；**Podman 不支持**；
                而且 **Docker Desktop 一次只能处在一种 OS 模式**（Linux 或 Windows），切换会重启引擎。
     Android ❌ **不是容器**：docker-android 之类本质是"在 Linux 容器里跑安卓模拟器"（要 KVM，
                在 WSL2 里还要嵌套虚拟化，很挑剔），或直接用模拟器（Android SDK AVD / Genymotion / Waydroid）。
                本产品**不自己实现安卓模拟器**，只做"受限说明 + 指引"。

   本轮只把 **Linux** 落地为"真的可用"；Windows / Android 在 UI 上如实标成"受限 / 非容器"，**不假装支持**。
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 「运行环境」= **实现方式**（容器 / 设备环境）+ **目标**。
 * 第四批产品主确认：容器只擅长"执行环境"，不擅长"设备环境"（跑某个平台上的 App）——
 * 所以这两类是**并列的实现方式**，不是同一层级的选项。
 */
export type ContainerEnvKind = 'container' | 'device';
export type ContainerEnvType = 'linux' | 'windows' | 'android' | 'ios' | 'windows-desktop';

export interface ContainerEnvTypeSpec {
  id: ContainerEnvType;
  /** 实现方式：容器 (=执行环境) / 设备环境 (=跑某平台上的 App) */
  kind: ContainerEnvKind;
  /** 是否真的是"容器"（Android / iOS / Windows 桌面 为 false） */
  realContainer: boolean;
  /** 本轮是否真的能跑（只有 Linux 为 true） */
  implemented: boolean;
  /** 机器可读的前置条件码（文案走 i18n：container.runEnv.opt.<id>.needs） */
  requirements: string;
  /** 该目标在哪些平台上**不可用**（机器可读码；iOS 在 Windows 上就是不可能的） */
  blockedOn: readonly string[];
  notes: readonly string[];
}

export const CONTAINER_ENV_TYPES: readonly ContainerEnvTypeSpec[] = [
  {
    id: 'linux',
    kind: 'container',
    realContainer: true,
    implemented: true,
    requirements: 'container-engine-plus-public-linux-base-image',
    blockedOn: [],
    notes: ['mature', 'headless', 'most-public-images'],
  },
  {
    id: 'windows',
    kind: 'container',
    realContainer: true,
    implemented: false,
    requirements: 'windows-pro-enterprise-plus-container-feature',
    blockedOn: ['windows-home', 'podman-engine'],
    notes: ['nanoserver-has-no-node', 'servercore-huge', 'podman-unsupported', 'docker-desktop-single-os-mode'],
  },
  {
    id: 'android',
    kind: 'device',
    realContainer: false,
    implemented: false,
    requirements: 'kvm-or-external-emulator-or-cloud-device',
    blockedOn: [],
    notes: ['not-a-container', 'nested-virtualization-finicky', 'no-built-in-emulator'],
  },
  {
    id: 'ios',
    kind: 'device',
    realContainer: false,
    implemented: false,
    requirements: 'macos-plus-xcode',
    // iOS 在 Windows 上**根本做不到**：必须 macOS + Xcode，没有合法替代 —— 现在就写清
    blockedOn: ['windows', 'linux'],
    notes: ['not-a-container', 'no-legal-alternative'],
  },
  {
    id: 'windows-desktop',
    kind: 'device',
    realContainer: false,
    implemented: false,
    requirements: 'full-vm-with-desktop',
    blockedOn: ['container-runtime-without-desktop'],
    notes: ['not-a-container', 'containers-have-no-desktop'],
  },
];

export function containerEnvTypeSpec(id: string): ContainerEnvTypeSpec | undefined {
  return CONTAINER_ENV_TYPES.find((x) => x.id === id);
}

export const CONTAINER_ENV_TYPE_IDS: readonly ContainerEnvType[] = CONTAINER_ENV_TYPES.map((x) => x.id);

/**
 * 基础镜像表：**只用公开、免费、开源**的镜像，并且**按 digest 钉死**。
 *
 * ✅ 已钉死（2026-09-19 04:19 (+08:00) 取自真实 registry，不是估的）：
 *    上一轮本机连不上镜像仓库（`registry-1.docker.io` manifest 请求超时）⇒ 表里只能留 null。
 *    这一轮网络通了（未认证请求 `GET /v2/` 返回 **401** = 仓库可达；token 接口返回 **200**），
 *    于是走**标准 Docker Registry v2 token 流**把真 digest 取了回来，取数过程全部记在
 *    `packages/app-shell/scripts/pin-image-digests.mjs`（可复算，脚本会把 API 调用清单一起打印）：
 *
 *      ① GET https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/<repo>:pull   -> 200
 *      ② GET https://registry-1.docker.io/v2/library/<repo>/manifests/<tag>  (Accept: OCI index / DL manifest list)  -> 200
 *      ③ GET https://registry-1.docker.io/v2/library/<repo>/manifests/<platform-digest>                      -> 200
 *      ④ GET https://registry-1.docker.io/v2/library/<repo>/blobs/<config-digest>                            -> 200
 *
 *    `digest` 存的是**多平台索引（manifest index）的 digest** —— `docker pull node:24-slim@sha256:<index>`
 *    由引擎按当前平台解析到对应平台 manifest；各平台 manifest digest 单独记在 `platformDigests`。
 *    `compressedBytesAmd64` 是该平台 manifest 里**所有 layer 的 size 之和**（= 真拉取要下载的字节数），
 *    与 `docker pull` / `docker image inspect` 的实测值对得上（见 `scripts/verify-container-real.mjs`）。
 *
 * ⚠️ 诚实边界：digest 绑的是**那一时刻**的 tag 内容。tag 会漂（例如 `alpine:3.20` 当时指向 3.20.10），
 *    所以：要么按 digest 引用（推荐，本表就是为此），要么到期重跑上面的脚本刷新。
 *    镜像自身**没有**声明 `org.opencontainers.image.licenses` 标签（已实测为 null）——
 *    `license` 一栏写的是**上游项目**的许可事实，并注明"镜像未声明"，不假装是镜像声明的。
 *
 * ⚠️ **更正（产品主第七批）：镜像不是"必须带 Node"，而是"按项目技术栈选"。**
 *    · **Node 只在两种情况需要**：① 项目本身就是 Node 技术栈（JS/TS/前端/Node 服务）；
 *      ② 把 AI 执行器也搬进容器。
 *    · **纯文本 / 文档 / 写作类项目**只需要**最小 Linux 镜像 + git/coreutils**。
 *    · 本产品的架构选择：**AI 执行器留在主机，只把"用户项目的命令/工具执行"送进容器**
 *      （容器内 shell = `exec` 进那个项目容器）。所以不因"我们的执行器是 Node 写的"而塞 Node：
 *      不可信的只是 AI 生成的内容与它要执行的命令，而**那些命令确实在容器里跑**；
 *      我们自己的执行器代码是可信的，留在主机不降低安全性。镜像因此更小、拉取更快。
 *    · Python / Go / Rust 等按项目需要再加，**列为后续**，本批不堆。
 *    · 可断言的事实写在 `CONTAINER_NODE_NEEDED_CASES` / `CONTAINER_EXECUTOR_LOCATION` 里。
 *
 * 为什么必须按 digest 钉死：浮动标签（`node:24-slim`）今天的内容与明天可能不同，
 * 会让"同一个项目在同一个环境里跑出不同结果"，也会让离线镜像与线上镜像对不上。
 */
export interface ContainerBaseImage {
  id: string;
  ref: string;
  /** 内容寻址的 digest（多平台索引 digest）；未获取时为 null（UI 必须如实显示"未钉死"） */
  digest: string | null;
  platform: string;
  license: string;
  approxSize: string;
  /**
   * **技术栈分类**（UI 按这个分档："最小（纯文本/文档/写作）" vs "带 Node（JS/前端）"）：
   *   minimal = 最小 Linux（够写作/文档/纯文本）；node = 自带 Linux 版 Node（JS/TS/前端）；
   *   system  = 需要 apt 装系统依赖的通用底。
   * ⚠️ **镜像按项目技术栈选，不是"必须带 Node"**（见文件头的更正说明）。
   */
  stack: 'minimal' | 'node' | 'system';
  /** **适合什么项目**（产品主要求：环境/镜像按项目技术栈选，每个选项要说清适合什么） */
  fits: string;
  /** 用途（为什么需要它） */
  purpose: string;
  /** 各平台 manifest digest（单平台钉死 / 排障用）；未获取时缺省 */
  platformDigests?: Record<string, string>;
  /** 实测：linux/amd64 压缩层字节之和（= 拉取要下载的字节数）；未测时缺省 */
  compressedBytesAmd64?: number;
  /** 上述 digest 的取回时间与方式（可复算；不写"大概"） */
  pinnedAt?: string;
  pinSource?: string;
}

export const CONTAINER_BASE_IMAGES: readonly ContainerBaseImage[] = [
  {
    id: 'node-24-slim',
    ref: 'node:24-slim',
    // 索引 digest（③/④ 见文件头：platform digest 与 config blob 都取到了）
    digest: 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553',
    platformDigests: {
      'linux/amd64': 'sha256:713cfbf4a0ac19f40e1bb9919893e126b74a5c8cf5d0623c9f89515c8f74c6fa',
      'linux/arm64': 'sha256:8d1405ad7696efa6941cb7745c2aa51d02549b900e4a40fdf212a1b5115dd1b9',
    },
    platform: 'linux/amd64, linux/arm64',
    // 镜像 config blob 里**没有** org.opencontainers.image.licenses 标签（实测 null）⇒ 这里写上游事实并注明
    license: 'MIT（Node.js，nodejs/node）＋ Debian 基础镜像各开源许可；镜像本身未声明 license 标签',
    // 实测：amd64 压缩层合计 80,809,937 B（5 层）；镜像内 NODE_VERSION=24.21.0
    approxSize: '约 77 MB（linux/amd64 压缩后实测 80,809,937 字节；含 Linux Node 24.21.0）',
    // ⚠️ 更正（产品主第七批）：**不是**"镜像必须带 Node"。
    // Node 只在两种情况需要：① 项目本身就是 Node 技术栈（JS/TS/前端/Node 服务）；
    // ② 把 AI 执行器也搬进容器。本产品**执行器留在主机**，只把"用户项目的命令/工具执行"
    // 送进容器（容器内 shell = exec 进那个项目容器），所以纯文本/写作类项目**不需要**这一项
    // —— 用 alpine 最小镜像即可（见 CONTAINER_NODE_NEEDED_CASES 与 ADR 004 §7.5）。
    stack: 'node',
    fits: 'JS / TS / 前端 / Node 服务类项目（**只在这类项目里需要 Node**）',
    purpose: 'Node 技术栈项目的运行镜像（自带 Linux 版 Node 24）',
    compressedBytesAmd64: 80809937,
    pinnedAt: '2026-09-19T04:19:45+08:00 (2026-09-18T20:19:45Z)',
    pinSource: 'registry-1.docker.io（token 流；scripts/pin-image-digests.mjs）',
  },
  {
    id: 'debian-bookworm-slim',
    ref: 'debian:bookworm-slim',
    digest: 'sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171',
    platformDigests: {
      'linux/amd64': 'sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867',
      'linux/arm64': 'sha256:6bd27d44e6c32a66bbd72d7cb2b76a8ae3497ec2e5274a81abd1b37f6013fa1f',
    },
    platform: 'linux/amd64, linux/arm64',
    license: '各开源许可（Debian 自由软件准则 DFSG；逐包各自许可）；镜像本身未声明 license 标签',
    approxSize: '约 27 MB（linux/amd64 压缩后实测 28,232,655 字节）',
    stack: 'system',
    fits: '需要 apt 装系统依赖的项目（glibc，兼容性比 alpine 的 musl 好）',
    purpose: '需要 apt 装系统依赖时的基础镜像',
    compressedBytesAmd64: 28232655,
    pinnedAt: '2026-09-19T04:19:45+08:00 (2026-09-18T20:19:45Z)',
    pinSource: 'registry-1.docker.io（token 流；scripts/pin-image-digests.mjs）',
  },
  {
    id: 'alpine-3.20',
    ref: 'alpine:3.20',
    digest: 'sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc',
    platformDigests: {
      'linux/amd64': 'sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e',
      'linux/arm64': 'sha256:45e09956dc667c5eff3583c9d94830261fb1ca0be10a0a7db36266edf5de9e1d',
    },
    platform: 'linux/amd64, linux/arm64',
    license: 'MIT / GPL-2.0 / BSD 等（Alpine Linux 及其组件的各自许可）；镜像本身未声明 license 标签',
    // 实测：amd64 压缩层合计 3,630,321 B；当时 tag 3.20 指向 Alpine 3.20.10（索引 annotation）
    approxSize: '约 3.5 MB（linux/amd64 压缩后实测 3,630,321 字节；tag 当时指向 3.20.10）',
    stack: 'minimal',
    fits: '**纯文本 / 文档 / 写作**类项目（只需要最小 Linux + git/coreutils，不装 Node）',
    purpose: '最小运行环境：写作/文档/纯文本项目的默认底，也是链路冒烟用镜像',
    compressedBytesAmd64: 3630321,
    pinnedAt: '2026-09-19T04:19:45+08:00 (2026-09-18T20:19:45Z)',
    pinSource: 'registry-1.docker.io（token 流；scripts/pin-image-digests.mjs）',
  },
];

/**
 * 「Node 只在什么情况下需要」——写成**可断言的事实**，免得后人再误解成"镜像必须带 Node"。
 * UI 必须按这个表达"环境/镜像按项目技术栈选"（两档：最小 / 带 Node）。
 */
export const CONTAINER_NODE_NEEDED_CASES: readonly string[] = [
  'project-is-node-stack',
  'executor-moved-into-container',
];
/** AI 执行器今天在**主机**上（只把用户项目的命令执行送进容器）—— 与 ADR 004 §7.5 一致 */
export const CONTAINER_EXECUTOR_LOCATION = 'host' as const;
export const CONTAINER_IMAGE_STACKS: readonly ('minimal' | 'node')[] = ['minimal', 'node'];

/* ══════════════════════════════════════════════════════════════════════════
   不要写死"Linux 容器"（产品主第九批纠正）
   ---------------------------------------------------------------------------
   一切 UI / 数据结构都必须**跟着用户真实选择与探测到的运行时**走：
     · 运行时 id（docker / podman / wsl / …）与**引擎的系统模式**（Docker 的 Linux 模式
       vs Windows 容器模式、WSL 的发行版）都要带上，**不把 "linux" 当常量**；
     · 文案不说"Linux 容器"，说"你选择的容器 / 运行环境"；
     · **能力按运行时区分**：环境固化（snapshot/commit）在 Docker/Podman 上是 `commit`；
       **WSL 没有 commit**，只能 `wsl --export/--import` 整盘导出（很大很慢）或根本固化不了
       —— 不能提供时**如实标注**，不给一个点了会失败的按钮。
   ══════════════════════════════════════════════════════════════════════════ */

/** 环境固化能力（"把当前容器环境固化成可复用的一层"）——按运行时如实区分 */
export type EnvSolidifyKind = 'commit' | 'export-import' | 'unsupported';

export interface EnvSolidifyCapability {
  kind: EnvSolidifyKind;
  /** 能不能由本产品**程序化**固化（WSL 的 export/import 我们不做：几百 MB~几十 GB、很慢） */
  programmatic: boolean;
  /** 如实说明为什么（机器可读码；文案走 i18n：container.env.solidify.why.<code>） */
  reason: string;
}

/**
 * 运行时 → 固化能力。**默认按运行时 id 判**，而不是按"是不是容器"一刀切。
 * 维护提醒：新增运行时必须在这里给出它的固化能力（没有就 unsupported + 原因）。
 */
export function envSolidifyCapability(runtimeId: string): EnvSolidifyCapability {
  const id = String(runtimeId || '');
  if (!id) return { kind: 'unsupported', programmatic: false, reason: 'no-runtime-chosen' };
  if (id === 'docker' || id === 'podman' || id === 'nerdctl' || id === 'rancher-desktop') {
    // 都是 OCI 引擎：commit/导出层可用（rancher/nerdctl 走同一个 containerd/OCI 面）
    return { kind: 'commit', programmatic: true, reason: 'oci-commit' };
  }
  if (id === 'wsl') {
    // ⚠️ WSL **没有 commit**：只能整盘 export/import（很大很慢），我们**不代跑**
    return { kind: 'export-import', programmatic: false, reason: 'wsl-no-commit' };
  }
  if (id === 'windows-sandbox') return { kind: 'unsupported', programmatic: false, reason: 'one-shot-vm' };
  if (id === 'lxd-incus') return { kind: 'commit', programmatic: false, reason: 'system-service-needs-root' };
  if (id === 'kata') return { kind: 'unsupported', programmatic: false, reason: 'isolation-level-only' };
  return { kind: 'unsupported', programmatic: false, reason: 'runtime-unknown' };
}

/**
 * **环境系统模式**（不要假定 Linux）：从真探测报告里读该运行时的真实模式。
 * Docker 的 `docker info --format {{.OSType}}` 会回 `linux` / `windows`；
 * 其它引擎按各自 detail 取值，取不到就如实回 `unknown`（**不猜**）。
 */
export function engineOsModeOf(report: ContainerProbeReport | null | undefined, runtimeId: string): string {
  if (!report || !runtimeId) return 'unknown';
  const row = (report.runtimes || []).find((x) => x.id === runtimeId);
  if (!row) return 'unknown';
  const detail = String(row.detail || '');
  if (detail.indexOf('daemon-reachable:') === 0) {
    const mode = detail.slice('daemon-reachable:'.length).trim();
    return mode || 'unknown';
  }
  if (detail.indexOf('distro=') === 0) return 'distro:' + detail.slice('distro='.length);
  return 'unknown';
}

/* ══════════════════════════════════════════════════════════════════════════
   环境固化（solidify）的策略 —— 产品主第九批要求
   ---------------------------------------------------------------------------
   需求：容器里装的软件/环境**会被一起删掉**；要能**固化**，让下次启动同一个容器
   回到之前的状态与环境；并且**记住每个项目用哪个容器**。

   推荐的实现（本模块给出可断言的规则，主进程按它执行）：
    ① **默认不删项目容器**（长期存在、不用 `--rm`）⇒ 停止/启动保留可写层，
       这一步就已经满足"下次启动回到之前状态"；
    ② **在明确的时间点固化**，而不是"任何文件变动就固化"：
       ⚠️ 陷阱：`docker diff` 只能看到可写层变了几文件，**分不清"用户装了个包"
       和"程序产生的缓存/日志/临时文件"**；"一动就 commit" 会把垃圾固化进去、堆出大量镜像。
       ⇒ **节流 + 时机驱动**（见 shouldSolidifyAt）；
    ③ **保留策略**：固化出来的镜像只留最近 N 个（默认 3），可手动清理；
    ④ **记住每个项目用哪个容器**：runtimeId + 容器名/ID + 上次固化的镜像引用 + 环境指纹；
    ⑤ **安全提醒**：commit 会把**当时的整个文件系统**一起固化（**包括可能的密钥/缓存/临时文件**），
       必须在固化入口旁说清（我们**不**自作主张删用户文件）。
   ══════════════════════════════════════════════════════════════════════════ */

/** 固化节流：默认 45 秒内只固化一次（30–60s 的中间值，可覆盖） */
export const SOLIDIFY_COALESCE_MS = 45000;
/** 固化产物保留数量（只留最近 N 个） */
export const SOLIDIFY_KEEP = 3;

export interface SolidifyDecisionInput {
  /** 最近一次固化的时间戳（0 = 从未固化过） */
  lastSolidifiedAt?: number;
  now?: number;
  /** 节流窗口（毫秒，默认 SOLIDIFY_COALESCE_MS） */
  coalesceMs?: number;
  /** 可写层是否有变化（由调用方给出；**注意 docker diff 分不清装包与缓存**） */
  dirty?: boolean;
  /** 是不是"可能销毁容器之前"（重建 / 换镜像 / 卸载）—— 这种时刻**无论如何**都固化一次 */
  beforeDestroy?: boolean;
  /** 用户显式点了「固化当前环境」 */
  explicit?: boolean;
  /** 该运行时能不能程序化固化（envSolidifyCapability(runtimeId).programmatic） */
  programmatic?: boolean;
}

export interface SolidifyDecision {
  /** 现在要不要真的固化 */
  solidify: boolean;
  /** 机器可读原因（文案走 i18n：container.env.solidify.decision.<code>） */
  code: string;
}

/**
 * **什么时候固化**（纯函数，可断言）：
 *   · 用户显式点 ⇒ 固化（但仍受"能不能程序化固化"约束）；
 *   · 可能销毁容器之前 ⇒ **一定**固化一次（这是最后机会）；
 *   · 其余情况 ⇒ 有变化且在节流窗口之外才固化（避免把缓存/日志也 commit 进去、避免镜像爆炸）。
 */
export function shouldSolidifyAt(input: SolidifyDecisionInput = {}): SolidifyDecision {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const last = Number(input.lastSolidifiedAt || 0);
  const coalesce = typeof input.coalesceMs === 'number' ? Math.max(0, input.coalesceMs) : SOLIDIFY_COALESCE_MS;
  if (input.programmatic === false) return { solidify: false, code: 'runtime-cannot-solidify' };
  if (input.beforeDestroy === true) return { solidify: true, code: 'before-destroy' };
  if (input.explicit === true) return { solidify: true, code: 'explicit' };
  if (input.dirty !== true) return { solidify: false, code: 'nothing-changed' };
  if (last > 0 && now - last < coalesce) return { solidify: false, code: 'coalesced' };
  if (last === 0) return { solidify: true, code: 'first-time' };
  return { solidify: true, code: 'throttled-due' };
}

/** 固化镜像的保留列表（只留最近 N 个；返回要**保留**的与要**清理**的） */
export function solidifyRetention(
  list: Array<{ imageRef: string; at: number }>,
  keep = SOLIDIFY_KEEP
): { keep: Array<{ imageRef: string; at: number }>; prune: Array<{ imageRef: string; at: number }> } {
  const sorted = [...(list || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const n = Math.max(1, Math.floor(keep));
  return { keep: sorted.slice(0, n), prune: sorted.slice(n) };
}


/* ══════════════════════════════════════════════════════════════════════════
   实测耗时台账（"大概需要的时间"要有真实依据，不能拍脑袋）
   ---------------------------------------------------------------------------
   ⚠️ 截至 2026-09-19，**这台机器上仍然没有任何一条有效的引擎启动/停止实测**，
      台账为空是**事实**，不是漏填。两次真实的测量尝试都被**机器原因**挡住（都不是代码问题）：

      · 第 1 次（2026-09-19 04:24，走产品自己的路径 `docker desktop start`）：
        动作"被接受"（spawn 成功），但**一个 docker 进程都没起来**；轮询 422 s 后仍未就绪。
        CLI 插件的原始输出（rc=1）：
          ✗ Failed to start Docker Desktop
          starting Docker Desktop: getting launcher path: cannot find registry key
          "SOFTWARE\Docker Inc.\Docker Desktop": The system cannot find the file specified.
      · 第 2 次（2026-09-19 04:37，改走"用户点图标等价的那一步"，直接拉起 Docker Desktop 本体）：
        本体进程**立刻退出**，日志 `%LOCALAPPDATA%\Docker\log\host\Docker Desktop.exe.log`：
          [E] getting backend binary path: cannot find registry key "SOFTWARE\Docker Inc.\Docker Desktop"
        ⇒ 该机上 Docker Desktop **只落了文件、没落注册表**（HKLM / HKCU / WOW6432Node 三处都查过，
          都没有 `Docker Inc.` 这个键，也没有卸载项），所以 CLI 与本体都定位不到 backend，
          Linux 引擎**根本无法启动**，与 WSL 无关（WSL 2.7.14.0 已装、Ubuntu 发行版在）。

   ⇒ 因此：`CONTAINER_RUNTIME_SPECS` 里 docker 的 `waitMs: 150000` 与动作超时 180000
     **是估计值，未经本机实测验证**（注释里不许写成"实测"）。谁要在 UI 上写"通常需要 N 秒"，
     必须先在一台 Docker Desktop 装好的机器上跑出真数字（`scripts/verify-container-real.mjs` 会记录），
     否则 UI 应当如实显示"暂无实测数据"。
   ══════════════════════════════════════════════════════════════════════════ */

export interface ContainerTimings {
  /** 启动引擎 → 守护进程真的就绪（毫秒） */
  engineStartMs?: number;
  /** 停止引擎 → 真的停下去（毫秒） */
  engineStopMs?: number;
  /** 在容器里跑一条命令（毫秒） */
  runMs?: number;
  /** 最近一次记录时间 */
  at?: number;
  note?: string;
}

let timings: ContainerTimings = {};

export function recordContainerTiming(kind: 'start' | 'stop' | 'run', ms: number, note?: string): ContainerTimings {
  const n = Math.max(0, Math.round(ms));
  if (kind === 'start') timings.engineStartMs = n;
  else if (kind === 'stop') timings.engineStopMs = n;
  else timings.runMs = n;
  timings.at = Date.now();
  if (note) timings.note = note;
  return { ...timings };
}

export function containerTimings(): ContainerTimings {
  return { ...timings };
}

/* ══════════════════════════════════════════════════════════════════════════
   静态目录（12 个候选）：id / 引擎类别 / 支持的平台 / 启停能力
   ══════════════════════════════════════════════════════════════════════════ */

const WIN = 'win32';
const MAC_LINUX = ['darwin', 'linux'];
const LINUX_ONLY = ['linux'];

export interface ContainerRuntimeSpec {
  id: string;
  engineKind: ContainerEngineKind;
  api: string;
  /** 该运行时的目标系统；不在其中 = unsupported-platform（探测直接跳过并说明） */
  platforms: string[];
  /** 静态启停能力；具体是否给按钮还要看探测结果（例如 podman 需要恰好一个 machine） */
  lifecycle: { startable: boolean; stoppable: boolean; reason: ContainerLifecycleReason; waitMs: number };
}

export const CONTAINER_RUNTIME_SPECS: readonly ContainerRuntimeSpec[] = [
  {
    id: 'docker',
    engineKind: 'container',
    api: 'docker',
    platforms: [WIN, 'darwin', 'linux'],
    // 启动 = 拉起 Docker Desktop 并**等守护进程真的就绪**（30s–2min 很常见）；
    // 停止 = 同样要等它真的下去。动态判断见 probeDocker（本机没有 Docker Desktop CLI 时不给按钮）。
    lifecycle: { startable: true, stoppable: true, reason: 'ok', waitMs: 150000 },
  },
  {
    id: 'podman',
    engineKind: 'container',
    api: 'podman',
    platforms: [WIN, 'darwin', 'linux'],
    // Windows 上是 `podman machine start|stop <name>`；Linux 上 podman 无守护进程（daemonless），
    // 没有"引擎启停"这回事 —— 动态判断见 probePodman。
    lifecycle: { startable: true, stoppable: true, reason: 'ok', waitMs: 120000 },
  },
  {
    id: 'wsl',
    engineKind: 'linux-vm',
    api: 'wsl',
    platforms: [WIN],
    // **不是一个能"启动/停止"的容器引擎**：只有发行版列表与 `wsl --shutdown`（会关掉用户**所有**发行版）。
    // 按产品要求：宁可没有按钮，也不给一个语义不对的。
    lifecycle: { startable: false, stoppable: false, reason: 'vm-shutdown-affects-all', waitMs: 0 },
  },
  {
    id: 'nerdctl',
    engineKind: 'container',
    api: 'nerdctl',
    platforms: [WIN, 'darwin', 'linux'],
    // containerd 是系统服务：启停要 root/systemd，本产品**不代跑提权命令**。
    lifecycle: { startable: false, stoppable: false, reason: 'system-service-needs-root', waitMs: 0 },
  },
  {
    id: 'rancher-desktop',
    engineKind: 'container',
    api: 'rdctl',
    platforms: [WIN, 'darwin', 'linux'],
    // rdctl 的 start/shutdown 在不同版本上参数要求不一致（mac 上 start 还要 application.path），
    // 不确定就不给按钮 —— 给错按钮比没有按钮更糟。
    lifecycle: { startable: false, stoppable: false, reason: 'uncertain-programmatic-control', waitMs: 0 },
  },
  {
    id: 'colima',
    engineKind: 'linux-vm',
    api: 'colima',
    platforms: MAC_LINUX,
    lifecycle: { startable: true, stoppable: true, reason: 'ok', waitMs: 120000 },
  },
  {
    id: 'lima',
    engineKind: 'linux-vm',
    api: 'limactl',
    platforms: MAC_LINUX,
    // 需要实例名：恰好一个实例才给按钮，多了不给（歧义），见 probeLima。
    lifecycle: { startable: true, stoppable: true, reason: 'ok', waitMs: 120000 },
  },
  {
    id: 'windows-sandbox',
    engineKind: 'disposable-vm',
    api: 'wsb',
    platforms: [WIN],
    // 一次性沙箱：没有"常驻运行状态"，既不 running 也不 stoppable。
    lifecycle: { startable: false, stoppable: false, reason: 'one-shot-vm', waitMs: 0 },
  },
  {
    id: 'lxd-incus',
    engineKind: 'system-container',
    api: 'incus',
    platforms: LINUX_ONLY,
    lifecycle: { startable: false, stoppable: false, reason: 'system-service-needs-root', waitMs: 0 },
  },
  {
    id: 'isulad',
    engineKind: 'container',
    api: 'isulad',
    platforms: LINUX_ONLY,
    lifecycle: { startable: false, stoppable: false, reason: 'system-service-needs-root', waitMs: 0 },
  },
  {
    id: 'pouch',
    engineKind: 'container',
    api: 'pouch',
    platforms: LINUX_ONLY,
    lifecycle: { startable: false, stoppable: false, reason: 'system-service-needs-root', waitMs: 0 },
  },
  {
    id: 'kata',
    engineKind: 'container',
    api: 'kata-runtime',
    platforms: LINUX_ONLY,
    // 它是**隔离级别**（配合 docker/containerd 用），不是独立引擎：单独一个 kata-runtime 跑不了容器。
    lifecycle: { startable: false, stoppable: false, reason: 'not-standalone-engine', waitMs: 0 },
  },
];

export function containerRuntimeSpec(id: string): ContainerRuntimeSpec | undefined {
  return CONTAINER_RUNTIME_SPECS.find((s) => s.id === id);
}

/* ══════════════════════════════════════════════════════════════════════════
   「环境固化」的**证据与代价**（与 `envSolidifyCapability` 互补，不重复它）
   ---------------------------------------------------------------------------
   分工说清，免得重复实现：
     · `envSolidifyCapability(runtimeId)` 回答「**能不能**固化、能不能程序化」；
     · 本表回答「我们**验到哪一步**、代价多大」—— 这是产品主要的能力声明所必需的第二半。
   ⚠️ 本表**不假定容器是 Linux**：`dependsOnEngineOsMode` 为 true 的运行时，UI 必须读
     `engineOsModeOf(report, runtimeId)`（引擎自报的 OS 模式）再声明能力，不许写死"Linux 容器"。

   证据等级（机器可读码；文案走 i18n：container.freeze.evidence.<code>）：
     measured           = 本机**真跑过**，有真实耗时/体积（今天**一个都没有**）
     cli-verified       = 只验证了 CLI **确实有这条命令**（本机 `--help` 真跑过）
     engine-unavailable = CLI 在，但引擎/守护进程不可达 ⇒ 不许编耗时/体积
     cli-missing        = 本机没有这个 CLI
     documented         = 只依据上游文档（本机装不了，无法核验）
     not-applicable     = 它根本不是容器引擎

   实测依据（2026-09-19，`scripts/probe-freeze-capability.mjs`，结果 JSON 在 %TEMP%/perf/container/）：
     · docker：`docker commit/save/load/export/import/build/tag/push --help` **全部真的能跑**（29.7.2），
       但 `docker info` 失败（Docker Desktop 缺注册表键）⇒ 只能到 engine-unavailable。
     · wsl：`wsl --help` 逐字确认有 `--export <Distro> <FileName> [--vhd]`、`--import <Distro> <Dir> <File> [--vhd]`、
       `--import-in-place <Distro> <FileName>`；**没有** `--commit`（WSL 不是镜像仓库）；
       发行版磁盘镜像实测 **1.39 GB**（`C:\Users\p\AppData\Local\wsl\{guid}\ext4.vhdx`）⇒ 导出就是"很大很慢"，
       按产品主指示**没有真导**（只给量级）。
     · podman / nerdctl / isulad / pouch / incus / rdctl / colima / limactl / kata-runtime / wsb：本机都没有 CLI。
   ══════════════════════════════════════════════════════════════════════════ */

export type ContainerFreezeEvidence =
  | 'measured'
  | 'cli-verified'
  | 'engine-unavailable'
  | 'cli-missing'
  | 'documented'
  | 'not-applicable';

export interface ContainerFreezeEvidenceSpec {
  runtimeId: string;
  /** 固化方式（与 EnvSolidifyKind 同义，便于 UI 直接拿） */
  kind: 'commit' | 'export-import' | 'unsupported';
  /** 本机验证到哪一步 */
  evidence: ContainerFreezeEvidence;
  /** 命令形态（固定参数；UI 展示 / 后续实现参考） */
  commands: readonly string[];
  /** 产物是什么（机器可读码） */
  artifact: 'image-in-local-store' | 'tar-archive' | 'distro-image' | 'none';
  /** 代价（机器可读码，不是文案） */
  cost: readonly string[];
  /** 是否必须读"引擎自报 OS 模式"才能声明（true ⇒ 不许写死 Linux 容器） */
  dependsOnEngineOsMode: boolean;
  /** 本机磁盘上发行版镜像的实测字节数（只有 wsl 有值） */
  artifactBytes?: number;
  /** 本机真测到的固化耗时（只有 measured 才有；今天全部没有） */
  measuredMs?: number;
  notes: readonly string[];
}

export const CONTAINER_FREEZE_EVIDENCE: readonly ContainerFreezeEvidenceSpec[] = [
  {
    runtimeId: 'docker',
    kind: 'commit',
    evidence: 'engine-unavailable',
    commands: ['docker commit <container> <image:tag>', 'docker save <image> -o x.tar', 'docker export <container> -o x.tar', 'docker import x.tar <image:tag>'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only', 'cheap-metadata-op-when-engine-up', 'requires-running-container'],
    // 同一台引擎可能是 linux 或 windows 容器模式（Docker Desktop 一次只能一种）
    dependsOnEngineOsMode: true,
    notes: ['cli-verified-on-this-machine', 'engine-down-here-so-no-time-no-size-measured', 'measure-with-probe-freeze-capability --measure'],
  },
  {
    runtimeId: 'podman',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['podman commit <container> <image:tag>', 'podman save / podman load'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only', 'cheap-metadata-op-when-engine-up'],
    dependsOnEngineOsMode: true,
    notes: ['podman-not-installed-on-this-machine'],
  },
  {
    runtimeId: 'nerdctl',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['nerdctl commit', 'nerdctl save / nerdctl load'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only'],
    dependsOnEngineOsMode: true,
    notes: ['cli-not-installed-on-this-machine', 'containerd-image-store'],
  },
  {
    runtimeId: 'isulad',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['isula commit', 'isula export / isula load'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only'],
    dependsOnEngineOsMode: false,
    notes: ['cli-not-installed-on-this-machine'],
  },
  {
    runtimeId: 'pouch',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['pouch commit', 'pouch save / pouch load'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only'],
    dependsOnEngineOsMode: false,
    notes: ['cli-not-installed-on-this-machine'],
  },
  {
    runtimeId: 'wsl',
    kind: 'export-import',
    // ⚠️ WSL **没有 commit**：它是发行版/VM，不是镜像仓库 ⇒ 只能整盘 export/import
    evidence: 'cli-verified',
    commands: ['wsl --export <distro> <file.tar>   （--vhd 可直接导出磁盘镜像）', 'wsl --import <distro> <installDir> <file.tar>   （--import-in-place 亦可）'],
    artifact: 'distro-image',
    cost: ['whole-distro-not-incremental', 'coarse-granularity', 'slow', 'hundreds-of-MB-to-GBs'],
    dependsOnEngineOsMode: false,
    // 实测：Ubuntu 的 ext4.vhdx = 1,488,977,920 字节（1.387 GiB；本机真值，不是估计）
    artifactBytes: 1488977920,
    notes: ['no-commit-in-wsl', 'export-not-performed-on-purpose-large', 'distro-image-1488977920-bytes-on-this-machine', 'not-programmatic-by-product-design'],
  },
  {
    runtimeId: 'lxd-incus',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['incus publish <instance> --alias x', 'incus snapshot create <instance> <name>', 'incus export <instance> x.tar'],
    artifact: 'tar-archive',
    cost: ['incremental-when-published', 'root-required-for-daemon'],
    dependsOnEngineOsMode: false,
    notes: ['cli-not-installed-on-this-machine', 'system-container'],
  },
  {
    runtimeId: 'rancher-desktop',
    kind: 'commit',
    evidence: 'cli-missing',
    commands: ['（底层是 containerd：固化走 nerdctl；rdctl 自身没有 commit）'],
    artifact: 'image-in-local-store',
    cost: ['incremental-layer-only'],
    dependsOnEngineOsMode: true,
    notes: ['cli-not-installed-on-this-machine', 'rdctl-has-no-commit-itself'],
  },
  {
    runtimeId: 'kata',
    kind: 'unsupported',
    evidence: 'not-applicable',
    commands: [],
    artifact: 'none',
    cost: ['not-an-engine'],
    dependsOnEngineOsMode: false,
    notes: ['isolation-level-only-freeze-via-host-engine'],
  },
  {
    runtimeId: 'colima',
    kind: 'unsupported',
    evidence: 'not-applicable',
    commands: [],
    artifact: 'none',
    cost: ['vm-manager-no-image-store'],
    dependsOnEngineOsMode: false,
    notes: ['cli-not-installed-on-this-machine', 'containers-inside-frozen-by-their-own-engine'],
  },
  {
    runtimeId: 'lima',
    kind: 'unsupported',
    evidence: 'not-applicable',
    commands: [],
    artifact: 'none',
    cost: ['vm-manager-no-snapshot'],
    dependsOnEngineOsMode: false,
    notes: ['cli-not-installed-on-this-machine'],
  },
  {
    runtimeId: 'windows-sandbox',
    kind: 'unsupported',
    evidence: 'not-applicable',
    commands: [],
    artifact: 'none',
    cost: ['one-shot-vm-no-image-format'],
    dependsOnEngineOsMode: true,
    notes: ['one-shot-vm'],
  },
];

export function containerFreezeEvidence(runtimeId: string): ContainerFreezeEvidenceSpec | undefined {
  return CONTAINER_FREEZE_EVIDENCE.find((x) => x.runtimeId === runtimeId);
}

/* ══════════════════════════════════════════════════════════════════════════
   子进程执行：短超时、不抛错、UTF-16 兜底、原始证据
   ══════════════════════════════════════════════════════════════════════════ */

interface ExecOutcome {
  ok: boolean;
  /** 子进程是否根本没找到（ENOENT）= 未安装 */
  missing: boolean;
  code: number | null;
  timedOut: boolean;
  out: string;
  err: string;
  ms: number;
}

/**
 * Windows 上 `wsl.exe` 的输出是 **UTF-16LE**（直接按 utf8 解会得到乱码，
 * 本机实测：`适用于 Linux 的 Windows 子系统没有已安装的分发。` 会变成一串问号）。
 * 判据：出现大量 NUL 字节（UTF-16 的 ASCII 高位）。
 */
function decodeBuffer(buf: Buffer): string {
  if (!buf || buf.length === 0) return '';
  let nuls = 0;
  const sample = Math.min(buf.length, 4096);
  for (let i = 0; i < sample; i++) if (buf[i] === 0) nuls++;
  if (nuls > sample * 0.2) {
    try {
      return buf.toString('utf16le').replace(/^\uFEFF/, '');
    } catch {
      /* 落到 utf8 */
    }
  }
  return buf.toString('utf8');
}

function compact(text: string, max = 300): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function execProbe(file: string, args: string[], timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const finish = (o: Partial<ExecOutcome>): void => {
      if (done) return;
      done = true;
      resolve({
        ok: false, missing: false, code: null, timedOut: false, out: '', err: '', ms: Date.now() - t0, ...o,
      });
    };
    let child: ChildProcess;
    try {
      child = execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20, encoding: 'buffer' },
        (error, stdout, stderr) => {
          const out = decodeBuffer(stdout as unknown as Buffer);
          const err = decodeBuffer(stderr as unknown as Buffer);
          if (!error) {
            finish({ ok: true, code: 0, out, err });
            return;
          }
          const anyErr = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
          const missing = anyErr.code === 'ENOENT';
          const timedOut = anyErr.killed === true || String(anyErr.code) === 'ETIMEDOUT';
          const numCode = typeof anyErr.code === 'number' ? anyErr.code : null;
          finish({
            ok: false,
            missing,
            code: numCode,
            timedOut,
            out,
            err: err || (missing ? '' : compact(String(anyErr.message || ''))),
          });
        }
      );
    } catch (e) {
      finish({ missing: true, err: compact(String((e as Error)?.message || e)) });
      return;
    }
    child.on('error', (e) => {
      const anyErr = e as NodeJS.ErrnoException;
      finish({ missing: anyErr.code === 'ENOENT', err: compact(String(e.message || e)) });
    });
  });
}

/** 有并发上限的 map（避免 12 个候选同时 spawn 把机器压住） */
async function mapBound<T, R>(items: readonly T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   分类：把"引擎起不来"与"守护进程没运行"分开（不许一律归到两态）
   ══════════════════════════════════════════════════════════════════════════ */

/** 这些片段的含义是"命令在、守护进程没起"，不是"坏了" */
const DAEMON_DOWN_PATTERNS = [
  'failed to connect to the docker api',
  'cannot find the file specified',
  'the system cannot find the file',
  'is the docker daemon running',
  'cannot connect to the docker daemon',
  'error during connect',
  'connection refused',
  'connect: connection refused',
  'no such file or directory',
  'cannot connect to the podman socket',
  'unable to connect to podman socket',
  'is podman running',
  'cannot connect to the podman service',
  'connection attempt failed',
  'the connection to the server localhost',
];

function classifyEngineFailure(evidence: string): 'installed-not-running' | 'engine-error' {
  const e = String(evidence || '').toLowerCase();
  for (const p of DAEMON_DOWN_PATTERNS) if (e.includes(p)) return 'installed-not-running';
  // 拿不到证据时保守地报"没运行"（比"坏了"更可能，且不会吓到用户）——evidence 仍原样展示
  return evidence ? 'engine-error' : 'installed-not-running';
}

const CAP_NONE: ContainerCapability = { runCommand: false, interactiveShell: false, mountHostDir: false };

/** 就绪时的能力（按引擎类别诚实区分） */
function capabilityFor(kind: ContainerEngineKind, id: string): ContainerCapability {
  if (kind === 'disposable-vm') {
    // 一次性 VM：我们**不驱动**它（要交互式启动，且用完即毁）
    return { ...CAP_NONE };
  }
  if (id === 'kata') {
    // 隔离级别，不是独立引擎：装了也不代表"能跑容器"
    return { ...CAP_NONE };
  }
  return { runCommand: true, interactiveShell: true, mountHostDir: true };
}

function runStateOf(status: ContainerProbeStatus): ContainerRunState {
  if (status === 'ready') return 'running';
  if (status === 'installed-not-running') return 'not-running';
  if (status === 'unsupported-platform') return 'unsupported';
  return 'error'; // not-installed 不会进列表；engine-error 单独标
}

/* ══════════════════════════════════════════════════════════════════════════
   单个运行时的探测
   ══════════════════════════════════════════════════════════════════════════ */

interface ProbeOutcome {
  status: ContainerProbeStatus;
  version?: string;
  detail: string;
  evidence?: string;
  /** 动态启停能力（覆盖静态 spec） */
  lifecycle?: Partial<ContainerLifecycle>;
}

function firstVersion(text: string, re: RegExp): string {
  const m = String(text || '').match(re);
  return m && m[1] ? String(m[1]).trim() : '';
}

const VER_DOCKER = /Docker version\s+([^,\s]+)/;
const VER_PODMAN = /podman version\s+([^\s]+)/i;
const VER_WSL = /WSL\s*(?:版本|version)\s*[:：]\s*([^\s]+)/i;
const VER_NERDCTL = /nerdctl\s+version\s+([^\s]+)/i;
const VER_RDCTL = /(?:rdctl\s+version\s*)?v?([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/i;
const VER_COLIMA = /colima\s+version\s+([^\s]+)/i;
const VER_LIMA = /limactl\s+version\s+([^\s]+)/i;
const VER_CLIENT = /Client version[:：]\s*([^\s]+)/i;
const VER_GENERIC = /(?:Version|version)[:：]?\s*([0-9]+\.[0-9]+[0-9.\-a-zA-Z]*)/;

/** docker：`docker --version` + `docker info`（后者失败 = 守护进程没起） */
async function probeDocker(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('docker', ['--version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  if (!cli.ok && !cli.out) {
    return { status: 'engine-error', detail: 'cli-exec-failed', evidence: compact(cli.err) };
  }
  const version = firstVersion(cli.out || cli.err, VER_DOCKER) || compact(cli.out || cli.err, 60);
  // ServerVersion|OSType：一次调用同时拿到版本与**当前 OS 模式**（linux / windows）
  const info = await execProbe('docker', ['info', '--format', '{{.ServerVersion}}|{{.OSType}}'], timeout);
  if (info.ok) {
    const lc = await dockerLifecycle();
    const osMode = (String(info.out).split('|')[1] || '').trim();
    return {
      status: 'ready',
      version: firstVersion(info.out, VER_GENERIC) || version,
      detail: osMode ? `daemon-reachable:${osMode}` : 'daemon-reachable',
      lifecycle: lc,
    };
  }
  const evidence = compact(`${info.err} ${info.out}`);
  if (info.timedOut) return { status: 'installed-not-running', version, detail: 'daemon-probe-timeout', evidence: evidence || 'probe timed out' };
  const st = classifyEngineFailure(evidence);
  // 守护进程没起时，"能不能拉起来"取决于有没有程序化启停通道；有就给按钮，没有就如实说
  const lc = await dockerLifecycle();
  return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence, lifecycle: lc };
}

/**
 * Docker 的启停通道探测（**只读**，不启动任何东西）。
 * Windows 上真正提供那个 VM 的是 Docker Desktop，它的 CLI 插件
 * （`resources/cli-plugins/docker-desktop.exe`）提供 start/stop/status。
 * 本机实测：`docker desktop version` 会 "unknown command"（插件没被 CLI 发现），
 * 但插件本体存在、`desktop --help` 里明确列出 start/stop/status —— 所以我们直接驱动插件本体。
 */
let dockerDesktopCliCache: { at: number; path: string } | null = null;
async function dockerDesktopCli(): Promise<string> {
  if (dockerDesktopCliCache && Date.now() - dockerDesktopCliCache.at < 120000) return dockerDesktopCliCache.path;
  let found = '';
  const found2 = await execProbe('docker', ['desktop', 'version'], 4000);
  if (found2.ok) found = 'docker';
  if (!found) {
    const candidates = process.platform === WIN
      ? [
          'C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-desktop.exe',
          'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker-desktop.exe',
        ]
      : ['/Applications/Docker.app/Contents/Resources/cli-plugins/docker-desktop', '/usr/local/lib/docker/cli-plugins/docker-desktop'];
    for (const p of candidates) {
      try {
        const fs = await import('node:fs');
        if (fs.existsSync(p)) { found = p; break; }
      } catch {
        /* ignore */
      }
    }
  }
  dockerDesktopCliCache = { at: Date.now(), path: found };
  return found;
}

async function dockerLifecycle(): Promise<Partial<ContainerLifecycle>> {
  const cli = await dockerDesktopCli();
  if (cli) return { startable: true, stoppable: true, reason: 'ok' };
  // 没有 Docker Desktop（例如 Linux 上只有引擎）：引擎是系统服务，启停要 root —— 不给按钮
  return { startable: false, stoppable: false, reason: 'system-service-needs-root' };
}

/** podman：`podman --version` + `podman info`；Windows 上靠 podman machine */
async function probePodman(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('podman', ['--version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out} ${cli.err}`, VER_PODMAN) || compact(cli.out, 40);
  const info = await execProbe('podman', ['info', '--format', '{{.Version.Version}}'], timeout);
  if (info.ok) {
    const lc = await podmanLifecycle();
    return { status: 'ready', version: firstVersion(info.out, VER_GENERIC) || version, detail: 'daemon-reachable', lifecycle: lc };
  }
  const evidence = compact(`${info.err} ${info.out}`);
  const lc = await podmanLifecycle();
  if (info.timedOut) return { status: 'installed-not-running', version, detail: 'daemon-probe-timeout', evidence, lifecycle: lc };
  const st = classifyEngineFailure(evidence);
  return {
    status: st,
    version,
    detail: st === 'installed-not-running' ? 'machine-not-running' : 'engine-error',
    evidence,
    lifecycle: lc,
  };
}

/**
 * podman 的启停通道：Windows 上是 `podman machine start|stop <name>`。
 * 恰好一个 machine 才给按钮（多个 = 歧义，宁可不给；零个 = 还没 init，属安装步骤）。
 * Linux 上 podman 是 daemonless，没有"引擎启停"这回事。
 */
async function podmanLifecycle(): Promise<Partial<ContainerLifecycle>> {
  if (process.platform !== WIN) {
    return { startable: false, stoppable: false, reason: 'vm-not-engine' };
  }
  const names = await podmanMachineNames();
  if (names.length === 1) return { startable: true, stoppable: true, reason: 'ok' };
  if (names.length === 0) return { startable: false, stoppable: false, reason: 'no-podman-machine' };
  return { startable: false, stoppable: false, reason: 'ambiguous-instances' };
}

async function podmanMachineNames(): Promise<string[]> {
  const r = await execProbe('podman', ['machine', 'list', '--format', 'json'], 6000);
  if (!r.ok && !r.out) return [];
  try {
    const arr = JSON.parse(r.out) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return [];
    return arr.map((m) => String(m['Name'] ?? m['name'] ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

/** WSL：`wsl.exe -l -v`（有无发行版）+ `wsl.exe --version`；输出是 UTF-16LE */
async function probeWsl(timeout: number): Promise<ProbeOutcome> {
  const ver = await execProbe('wsl.exe', ['--version'], timeout);
  if (ver.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${ver.out} ${ver.err}`, VER_WSL) || compact(ver.out, 30);
  // 无发行版时 -l -v 返回非 0 退出码 + 一段说明文字（本机实测就是这条）
  const list = await execProbe('wsl.exe', ['-l', '-v'], timeout);
  const text = `${list.out}\n${list.err}`;
  const noDistro = /没有已安装的分发|no installed distributions|WSL_E_DISTRO_NOT_FOUND/i.test(text);
  const distros = parseWslDistros(list.out);
  const lifecycle: Partial<ContainerLifecycle> = { startable: false, stoppable: false, reason: 'vm-shutdown-affects-all' };
  if (noDistro || distros.length === 0) {
    return {
      status: 'installed-not-running',
      version,
      detail: 'no-distro',
      evidence: compact(text),
      lifecycle,
    };
  }
  // 有发行版：真的进去跑一句 `true`（只读、不改任何东西）才算"可用"
  const probe = await execProbe('wsl.exe', ['-d', distros[0] as string, '--', 'true'], Math.max(timeout, 8000));
  if (probe.ok) {
    return { status: 'ready', version, detail: `distro=${distros[0]}`, lifecycle };
  }
  return {
    status: 'installed-not-running',
    version,
    detail: probe.timedOut ? 'distro-start-timeout' : 'distro-start-failed',
    evidence: compact(`${probe.err} ${probe.out}`) || 'wsl distro did not start',
    lifecycle,
  };
}

/** `wsl -l -v` 的表格：NAME STATE VERSION（第一列是名字，*, 前缀表示默认发行版） */
function parseWslDistros(out: string): string[] {
  const lines = String(out || '').split(/\r?\n/);
  const names: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\u0000/g, '').trim();
    if (!line) continue;
    if (/^NAME\s+STATE\s+VERSION/i.test(line)) continue;
    if (/没有已安装的分发|no installed distributions/i.test(line)) continue;
    const cols = line.split(/\s{2,}|\t/).map((s) => s.replace(/^\*\s*/, '').trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const nm = cols[0] as string;
    if (!nm || /^NAME$/i.test(nm)) continue;
    names.push(nm);
  }
  return names;
}

async function probeNerdctl(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('nerdctl', ['--version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out} ${cli.err}`, VER_NERDCTL) || compact(cli.out, 40);
  const info = await execProbe('nerdctl', ['info'], timeout);
  if (info.ok) return { status: 'ready', version, detail: 'daemon-reachable' };
  const evidence = compact(`${info.err} ${info.out}`);
  const st = info.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
  return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence };
}

async function probeRancherDesktop(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('rdctl', ['version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out}`, VER_RDCTL) || compact(cli.out, 40);
  const settings = await execProbe('rdctl', ['list-settings'], timeout);
  if (settings.ok) return { status: 'ready', version, detail: 'backend-reachable' };
  const evidence = compact(`${settings.err} ${settings.out}`);
  const st = settings.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
  return { status: st, version, detail: st === 'installed-not-running' ? 'backend-not-running' : 'engine-error', evidence };
}

async function probeColima(timeout: number): Promise<ProbeOutcome> {
  const st = await execProbe('colima', ['status'], Math.max(timeout, 8000));
  if (st.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const text = `${st.out} ${st.err}`;
  const version = await execProbe('colima', ['version'], timeout);
  const v = firstVersion(`${version.out}`, VER_COLIMA) || compact(version.out, 30);
  if (/is running/i.test(text) && st.ok) return { status: 'ready', version: v, detail: 'vm-running' };
  if (/not running|is not running|no instance/i.test(text) || !st.ok) {
    return {
      status: 'installed-not-running',
      version: v,
      detail: 'vm-not-running',
      evidence: compact(text),
      lifecycle: { startable: true, stoppable: true, reason: 'ok' },
    };
  }
  return { status: 'engine-error', version: v, detail: 'engine-error', evidence: compact(text) };
}

async function probeLima(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('limactl', ['--version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out} ${cli.err}`, VER_LIMA) || compact(cli.out, 30);
  const list = await execProbe('limactl', ['list', '--json'], Math.max(timeout, 8000));
  const names = parseLimaInstances(list.out);
  const lifecycle: Partial<ContainerLifecycle> =
    names.length === 1
      ? { startable: true, stoppable: true, reason: 'ok' }
      : { startable: false, stoppable: false, reason: names.length === 0 ? 'vm-not-engine' : 'ambiguous-instances' };
  if (!list.ok && !list.out) {
    return {
      status: 'installed-not-running', version, detail: 'no-instance',
      evidence: compact(`${list.err} ${list.out}`), lifecycle: { startable: false, stoppable: false, reason: 'ambiguous-instances' },
    };
  }
  if (names.length === 0) return { status: 'installed-not-running', version, detail: 'no-instance', lifecycle };
  const running = /"status"\s*:\s*"Running"/i.test(list.out);
  return {
    status: running ? 'ready' : 'installed-not-running',
    version,
    detail: running ? `instance=${names[0]}` : 'instance-stopped',
    lifecycle,
  };
}

function parseLimaInstances(out: string): string[] {
  const names: string[] = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const n = String(o['name'] ?? '');
      if (n) names.push(n);
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  return names;
}

/**
 * Windows Sandbox：**家庭版没有**（仅 Pro/Enterprise/Education）。
 * 检查方式刻意保持"便宜且不提权"：注册表 EditionID + System32 里
 * WindowsSandbox.exe 是否存在（启用该可选功能后才会出现）。
 * 需要提权的 `dism /online /get-featureinfo` **不跑**（本产品不代跑提权命令）。
 */
async function probeWindowsSandbox(timeout: number): Promise<ProbeOutcome> {
  const reg = await execProbe('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'EditionID'], timeout);
  const edition = firstVersion(reg.out, /EditionID\s+REG_SZ\s+(\S+)/) || '';
  if (/Home/i.test(edition)) {
    return { status: 'unsupported-platform', detail: 'windows-home-edition', evidence: `EditionID=${edition}` };
  }
  try {
    const fs = await import('node:fs');
    const exe = 'C:\\Windows\\System32\\WindowsSandbox.exe';
    if (fs.existsSync(exe)) {
      // 功能已启用：exe 在。但它是一次性 VM，没有常驻运行状态 —— 不 running、不可启停。
      return { status: 'installed-not-running', detail: 'system-feature-one-shot', evidence: 'WindowsSandbox.exe present' };
    }
  } catch {
    /* ignore */
  }
  return { status: 'not-installed', detail: 'feature-not-enabled', evidence: edition ? `EditionID=${edition}` : undefined };
}

async function probeLxdIncus(timeout: number): Promise<ProbeOutcome> {
  const incus = await execProbe('incus', ['version'], timeout);
  if (!incus.missing) {
    const version = firstVersion(incus.out, VER_CLIENT) || compact(incus.out, 30);
    const info = await execProbe('incus', ['info'], timeout);
    if (info.ok) return { status: 'ready', version, detail: 'daemon-reachable' };
    const evidence = compact(`${info.err} ${info.out}`);
    const st = info.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
    return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence };
  }
  const lxc = await execProbe('lxc', ['version'], timeout);
  if (lxc.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(lxc.out, VER_CLIENT) || compact(lxc.out, 30);
  const info = await execProbe('lxc', ['info'], timeout);
  if (info.ok) return { status: 'ready', version, detail: 'daemon-reachable' };
  const evidence = compact(`${info.err} ${info.out}`);
  const st = info.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
  return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence };
}

async function probeIsulad(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('isula', ['version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out}`, VER_GENERIC) || compact(cli.out, 30);
  const info = await execProbe('isula', ['info'], timeout);
  if (info.ok) return { status: 'ready', version, detail: 'daemon-reachable' };
  const evidence = compact(`${info.err} ${info.out}`);
  const st = info.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
  return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence };
}

async function probePouch(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('pouch', ['version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out}`, VER_GENERIC) || compact(cli.out, 30);
  const info = await execProbe('pouch', ['info'], timeout);
  if (info.ok) return { status: 'ready', version, detail: 'daemon-reachable' };
  const evidence = compact(`${info.err} ${info.out}`);
  const st = info.timedOut ? 'installed-not-running' : classifyEngineFailure(evidence);
  return { status: st, version, detail: st === 'installed-not-running' ? 'daemon-not-running' : 'engine-error', evidence };
}

async function probeKata(timeout: number): Promise<ProbeOutcome> {
  const cli = await execProbe('kata-runtime', ['--version'], timeout);
  if (cli.missing) return { status: 'not-installed', detail: 'cli-not-found' };
  const version = firstVersion(`${cli.out} ${cli.err}`, /version\s+([^\s]+)/i) || compact(cli.out, 30);
  // 命令能用 ≠ 能跑容器：kata 是隔离级别，必须挂在 docker/containerd 下面。
  return { status: 'ready', version, detail: 'isolation-level-only', evidence: '不是独立引擎：需配合 docker / containerd 使用' };
}

const PROBES: Record<string, (timeout: number) => Promise<ProbeOutcome>> = {
  docker: probeDocker,
  podman: probePodman,
  wsl: probeWsl,
  nerdctl: probeNerdctl,
  'rancher-desktop': probeRancherDesktop,
  colima: probeColima,
  lima: probeLima,
  'windows-sandbox': probeWindowsSandbox,
  'lxd-incus': probeLxdIncus,
  isulad: probeIsulad,
  pouch: probePouch,
  kata: probeKata,
};

/* ══════════════════════════════════════════════════════════════════════════
   探测报告
   ══════════════════════════════════════════════════════════════════════════ */

let cache: { at: number; report: ContainerProbeReport } | null = null;

export function invalidateContainerProbeCache(): void {
  cache = null;
}

export function lastContainerProbeReport(): ContainerProbeReport | null {
  return cache ? cache.report : null;
}

export async function probeContainerRuntimes(opts: ContainerProbeOptions = {}): Promise<ContainerProbeReport> {
  const platform = opts.platform || process.platform;
  const cacheMs = typeof opts.cacheMs === 'number' ? opts.cacheMs : 8000;
  if (cacheMs > 0 && cache && cache.report.platform === platform && Date.now() - cache.at < cacheMs) {
    return { ...cache.report, cached: true, pendingActions: pendingActionList() };
  }
  const timeout = Math.max(1000, Math.min(opts.perProbeTimeoutMs ?? 5000, 30000));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, CONTAINER_RUNTIME_SPECS.length));
  const t0 = Date.now();

  const entries = await mapBound(CONTAINER_RUNTIME_SPECS, concurrency, async (spec): Promise<ContainerRuntimeEntry> => {
    const started = Date.now();
    const base = {
      id: spec.id,
      engine: { kind: spec.engineKind, api: spec.api },
    };
    // 平台不适用：**直接跳过探测并说明**（不 spawn，省成本）
    if (!spec.platforms.includes(platform)) {
      return {
        ...base,
        status: 'unsupported-platform',
        run: 'unsupported',
        detail: `platform-not-supported:${platform}`,
        capability: { ...CAP_NONE },
        lifecycle: { startable: false, stoppable: false, reason: 'unsupported-platform', waitMs: 0, awaitReady: false },
        probeMs: Date.now() - started,
      };
    }
    const fn = PROBES[spec.id];
    let outcome: ProbeOutcome;
    try {
      outcome = fn ? await fn(timeout) : { status: 'not-installed', detail: 'no-probe' };
    } catch (e) {
      // 探测器自己出错也必须如实报（不能静默变成"未安装"）
      outcome = { status: 'engine-error', detail: 'probe-threw', evidence: compact(String((e as Error)?.message || e)) };
    }
    const lc: ContainerLifecycle = {
      startable: outcome.lifecycle?.startable ?? spec.lifecycle.startable,
      stoppable: outcome.lifecycle?.stoppable ?? spec.lifecycle.stoppable,
      reason: outcome.lifecycle?.reason ?? spec.lifecycle.reason,
      waitMs: outcome.lifecycle?.waitMs ?? spec.lifecycle.waitMs,
      awaitReady: outcome.lifecycle?.awaitReady ?? (outcome.status === 'ready' || outcome.status === 'installed-not-running'),
    };
    const notInstalled = outcome.status === 'not-installed';
    // 未安装 / 平台不适用：启停按钮一律不给，理由如实
    if (notInstalled) {
      lc.startable = false;
      lc.stoppable = false;
      lc.reason = 'not-installed';
    }
    const capability = outcome.status === 'ready' ? capabilityFor(spec.engineKind, spec.id) : { ...CAP_NONE };
    return {
      ...base,
      status: outcome.status,
      run: runStateOf(outcome.status),
      ...(outcome.version ? { version: outcome.version } : {}),
      capability,
      lifecycle: lc,
      detail: outcome.detail,
      ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
      probeMs: Date.now() - started,
      ...(actions.has(spec.id) ? { action: publicAction(actions.get(spec.id) as InternalAction) } : {}),
    };
  });

  const usableIds = entries.filter((e) => e.status === 'ready' && e.capability.runCommand).map((e) => e.id);
  const report: ContainerProbeReport = {
    ok: true,
    platform,
    probedAt: Date.now(),
    elapsedMs: Date.now() - t0,
    cached: false,
    runtimes: entries,
    usableIds,
    containerEngineIds: entries
      .filter((e) => e.status === 'ready' && e.capability.runCommand && e.engine.kind === 'container')
      .map((e) => e.id),
    attentionIds: entries.filter((e) => e.status === 'installed-not-running' || e.status === 'engine-error').map((e) => e.id),
    notInstalledCount: entries.filter((e) => e.status === 'not-installed').length,
    pendingActions: pendingActionList(),
    envTypes: CONTAINER_ENV_TYPES.map((x) => ({ ...x, notes: x.notes.slice() })),
    images: CONTAINER_BASE_IMAGES.map((x) => ({ ...x })),
    timings: containerTimings(),
    freezeEvidence: CONTAINER_FREEZE_EVIDENCE.map((x) => ({ ...x })),
  };
  cache = { at: Date.now(), report };
  return report;
}

/* ══════════════════════════════════════════════════════════════════════════
   启停动作（只接受预定义 id + 动作枚举；绝不接受任意命令字符串）
   ══════════════════════════════════════════════════════════════════════════ */

export type ContainerActionName = 'start' | 'stop';
export const CONTAINER_ACTION_NAMES: readonly ContainerActionName[] = ['start', 'stop'];

interface InternalAction extends ContainerActionState {
  child?: ChildProcess;
  output: string;
}

const actions = new Map<string, InternalAction>();

function publicAction(a: InternalAction): ContainerActionState {
  return {
    kind: a.kind,
    startedAt: a.startedAt,
    pending: a.pending,
    ...(a.result ? { result: a.result } : {}),
  };
}

function pendingActionList(): Array<{ id: string; kind: 'start' | 'stop'; startedAt: number }> {
  const out: Array<{ id: string; kind: 'start' | 'stop'; startedAt: number }> = [];
  for (const [id, a] of actions) if (a.pending) out.push({ id, kind: a.kind, startedAt: a.startedAt });
  return out;
}

export interface ContainerActionResponse {
  ok: boolean;
  /** 请求是否被接受（真正的结果在后续探测报告里） */
  accepted?: boolean;
  id?: string;
  action?: ContainerActionName;
  /** 拒绝原因（机器可读码） */
  code?: string;
  error?: string;
}

/** 每个运行时的启停命令：**固定参数表**，参数里不含任何来自渲染层的字符串 */
async function actionCommand(id: string, action: ContainerActionName): Promise<{ file: string; args: string[]; timeoutMs: number } | { code: string; error: string }> {
  if (id === 'docker') {
    const cli = await dockerDesktopCli();
    if (!cli) return { code: 'no-programmatic-cli', error: 'Docker Desktop CLI plugin not found' };
    return cli === 'docker'
      ? { file: 'docker', args: ['desktop', action], timeoutMs: 180000 }
      : { file: cli, args: ['desktop', action], timeoutMs: 180000 };
  }
  if (id === 'podman') {
    if (process.platform !== WIN) return { code: 'daemonless', error: 'podman on this platform has no engine daemon to start/stop' };
    const names = await podmanMachineNames();
    if (names.length !== 1) return { code: 'no-unique-machine', error: `podman machine count=${names.length}` };
    return { file: 'podman', args: ['machine', action, names[0] as string], timeoutMs: 180000 };
  }
  if (id === 'colima') {
    if (process.platform === WIN) return { code: 'unsupported-platform', error: 'colima is not applicable on this platform' };
    return { file: 'colima', args: [action], timeoutMs: 180000 };
  }
  if (id === 'lima') {
    if (process.platform === WIN) return { code: 'unsupported-platform', error: 'lima is not applicable on this platform' };
    const list = await execProbe('limactl', ['list', '--json'], 8000);
    const names = parseLimaInstances(list.out);
    if (names.length !== 1) return { code: 'no-unique-instance', error: `lima instance count=${names.length}` };
    return { file: 'limactl', args: [action, names[0] as string], timeoutMs: 180000 };
  }
  return { code: 'not-controllable', error: `runtime '${id}' has no programmatic start/stop` };
}

/**
 * 启动/停止。**只接受预定义运行时 id + 'start'|'stop'**（不接受任意命令）。
 * 立即返回"已接受"，真正的结果由后续 probe 报告如实反映（过渡态 + 成功/失败 + 原始输出）。
 */
export async function runContainerAction(input: { id?: unknown; action?: unknown }): Promise<ContainerActionResponse> {
  const id = String(input?.id ?? '');
  const action = String(input?.action ?? '') as ContainerActionName;
  const spec = containerRuntimeSpec(id);
  if (!spec) return { ok: false, code: 'unknown-runtime', error: `unknown runtime id: ${id}` };
  if (!CONTAINER_ACTION_NAMES.includes(action)) {
    return { ok: false, code: 'bad-action', error: `action must be one of ${CONTAINER_ACTION_NAMES.join('|')}` };
  }
  const current = actions.get(id);
  if (current?.pending) return { ok: false, code: 'already-pending', error: `${id} already has a pending ${current.kind}` };
  const cmd = await actionCommand(id, action);
  if ('code' in cmd) return { ok: false, code: cmd.code, error: cmd.error };

  const st: InternalAction = { kind: action, startedAt: Date.now(), pending: true, output: '' };
  actions.set(id, st);
  try {
    const child = spawn(cmd.file, cmd.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    st.child = child;
    const push = (buf: Buffer): void => {
      if (st.output.length < 4000) st.output += decodeBuffer(buf);
    };
    child.stdout?.on('data', (d: Buffer) => push(d));
    child.stderr?.on('data', (d: Buffer) => push(d));
    const settle = (code: number | null, errMsg?: string): void => {
      if (!st.pending) return;
      st.pending = false;
      const outText = compact(errMsg ? `${errMsg} ${st.output}` : st.output, 400) || `exit=${code}`;
      st.result = {
        kind: action,
        ok: code === 0,
        code,
        output: outText,
        at: Date.now(),
        /**
         * 【产品 bug 修复】**进程派生了 ≠ 成功**：这里把"为什么没起来"如实归类成原因码，
         * 由探测报告一路带到 UI（渲染层按 container.action.reason.<code> 出文案 + 原始输出行）。
         */
        reasonCode: classifyActionResult(action, code === 0, outText, code),
      };
      invalidateContainerProbeCache();
    };
    child.on('error', (e) => settle(null, String(e.message || e)));
    child.on('close', (code) => settle(typeof code === 'number' ? code : null));
    // 过渡态兜底：命令挂住也别永远显示"正在启动"
    setTimeout(() => settle(null, 'action-timeout'), Math.max(60000, cmd.timeoutMs)).unref?.();
  } catch (e) {
    st.pending = false;
    st.result = {
      kind: action,
      ok: false,
      code: null,
      output: compact(String((e as Error)?.message || e)),
      at: Date.now(),
      reasonCode: 'spawn-failed',
    };
    invalidateContainerProbeCache();
    return { ok: false, code: 'spawn-failed', error: compact(String((e as Error)?.message || e)) };
  }
  invalidateContainerProbeCache();
  return { ok: true, accepted: true, id, action };
}

/** 测试与排障用：清掉启停状态台账（不杀任何子进程） */
export function resetContainerActionState(): void {
  actions.clear();
  invalidateContainerProbeCache();
}

/* ══════════════════════════════════════════════════════════════════════════
   项目可用性（ADR 004 第七批最终定稿）
   ---------------------------------------------------------------------------
   定稿语义（**替换此前"容器 = 一个可选项"的弱表述**）：

    1) 创建项目时选了「开发环境 = 容器」⇒ **该项目的开发/编辑只允许发生在容器里**。
       项目目录在宿主上确实看得见（bind mount），但**让本应用在宿主侧编辑它就是
       把整个安全承诺作废** —— 所以本应用**不提供**宿主侧编辑这条路（不是"不推荐"）。
    2) **容器没启动 ⇒ 容器开发项目不可用**（不是"停止"，而是"不可用"）：
       置灰、不可聊天、其中功能不可用，**只能翻看之前的记录（历史仍可读）**。
       对成员的可见效果**与「创建者下线」完全一样** —— 直接复用 ADR 003 §2.4 / R6
       的既有语义（同一套表现 + 同一句文案），**不新造第三种状态**。
    3) **创建时没选容器、或这是「我的牛马」的聊天 ⇒ 无需容器也能正常聊天**
       （绝不许误伤这两种 —— 它们跟容器一点关系都没有）。
    4) **『停用项目』与容器无关**：任何项目都能被创建者停用；停用后同样"不可用、只能看历史"。
    5) **只测"测试/运行"可以留在宿主或其它设备上**（与 §6.2「容器 = 开发环境」一致）。
    6) **诚实的边界**：我们能拒绝写/改项目文件、把项目显示成不可用、禁用开发与功能入口；
       我们**做不到**的是阻止用户自己用外部编辑器打开那个目录。要不要上文件系统级措施
       **必须另行拍板**，本轮不实现。

   本函数是**纯函数**：输入事实（开发环境选择 / 所选运行时 / 运行时的真实状态 /
   创建者是否停用过项目），输出结构化状态。主进程与验收脚本共用同一份实现 ——
   不许在渲染层再猜一套（那迟早会与主进程的拒绝逻辑分叉）。
   ══════════════════════════════════════════════════════════════════════════ */

export type ContainerProjectDevEnv = 'host' | 'container';

/**
 * 项目状态码（机器可读，文案走 i18n）：
 *   host-dev               本机开发（不受容器影响）
 *   ok                     容器开发项目 + 容器真的就绪 ⇒ 可用（开发在容器里）
 *   disabled-by-owner      创建者在右键菜单里停用了这个项目
 *   container-not-ready    所选运行时现在不是 ready（守护进程没起/发行版没起…）
 *   container-not-installed 所选运行时在本机没装（或当前系统不适用）
 *   container-not-chosen   还没选具体用哪个容器（容器开发项目必须选一个）
 */
export type ContainerProjectCode =
  | 'host-dev'
  | 'ok'
  | 'disabled-by-owner'
  | 'container-not-ready'
  | 'container-not-installed'
  | 'container-not-chosen';

export interface ContainerProjectStateInput {
  /** 项目创建时选的开发环境；旧数据缺项一律按 host（不猜） */
  devEnv?: string | null;
  /** 容器开发项目记住的运行时 id（settings.containerProjectRuntime[groupId]） */
  runtimeId?: string | null;
  /**
   * 该运行时在**最近一次真探测**里的状态。
   * `null` / `undefined` = 还没探过 ⇒ **按未就绪处理**（宁可不给开发，也不乐观地放开）。
   */
  runtimeStatus?: ContainerProbeStatus | null;
  /** 创建者是否在右键菜单里**停用**了这个项目（settings.projectDisabled[groupId]） */
  disabledByOwner?: boolean;
}

export interface ContainerProjectState {
  devEnv: ContainerProjectDevEnv;
  /** 该项目是否**只能**在容器里开发（= devEnv==='container'） */
  containerOnly: boolean;
  /** 项目当前是否可用（可聊天、可用其中功能） */
  running: boolean;
  /** 是否处于"不可用"（容器没起 或 被创建者停用） */
  stopped: boolean;
  code: ContainerProjectCode;
  /** 我们是否**拒绝在宿主侧编辑**该项目（容器开发项目恒为 true —— 这正是第 1 条） */
  hostEditingRefused: boolean;
  /** 开发是否被允许；允许时在 `developmentWhere` 指定的地方 */
  developmentAllowed: boolean;
  developmentWhere: 'host' | 'container';
  /** 测试/运行：可以留在宿主或其它设备上（第 5 条），所以**恒为 true** */
  testingAllowed: true;
  testingWhere: 'host-or-other-device';
  /** **历史记录仍然可读**（不可用 ≠ 什么都看不了）—— 恒为 true */
  historyReadable: true;
  /**
   * 成员侧看到的形态。`'creator-offline'` = **复用 ADR 003 §2.4 / R6「创建者下线」**
   * 的那套既有表现（同一个文案键、同一个灰态），**不是**新造的第三种状态。
   */
  memberFace: 'creator-offline' | null;
  /** 相对"可用"少了什么（机器可读码）：history 永远不在其中 */
  restrictions: string[];
  /** 要恢复可用，创建者需要先做什么（机器可读码；'ok' = 不用做） */
  fix: 'ok' | 'start-container' | 'choose-container' | 'install-container' | 'enable-project';
}

/** 把状态码映射到用户可见原因（i18n 键名在渲染层拼：container.project.reason.<suffix>） */
export function projectReasonKey(code: ContainerProjectCode): string {
  if (code === 'disabled-by-owner') return 'disabledByOwner';
  if (code === 'container-not-installed') return 'notInstalled';
  if (code === 'container-not-chosen') return 'notChosen';
  if (code === 'ok') return 'ok';
  if (code === 'host-dev') return 'ok';
  return 'containerDown';
}

export function deriveProjectState(input: ContainerProjectStateInput = {}): ContainerProjectState {
  const devEnv: ContainerProjectDevEnv = input.devEnv === 'container' ? 'container' : 'host';
  const disabledByOwner = input.disabledByOwner === true;
  if (devEnv === 'host') {
    // 没选容器开发的项目（含旧项目）：**只**受"创建者停用"影响，与容器一点关系都没有
    if (!disabledByOwner) {
      return {
        devEnv: 'host',
        containerOnly: false,
        running: true,
        stopped: false,
        code: 'host-dev',
        hostEditingRefused: false,
        developmentAllowed: true,
        developmentWhere: 'host',
        testingAllowed: true,
        testingWhere: 'host-or-other-device',
        historyReadable: true,
        memberFace: null,
        restrictions: [],
        fix: 'ok',
      };
    }
    return {
      devEnv: 'host',
      containerOnly: false,
      running: false,
      stopped: true,
      code: 'disabled-by-owner',
      hostEditingRefused: false,
      developmentAllowed: false,
      developmentWhere: 'host',
      testingAllowed: true,
      testingWhere: 'host-or-other-device',
      historyReadable: true,
      memberFace: 'creator-offline',
      restrictions: ['development', 'collaboration', 'features'],
      fix: 'enable-project',
    };
  }

  const runtimeId = String(input.runtimeId || '');
  const status = input.runtimeStatus ?? null;
  const ready = status === 'ready';
  let code: ContainerProjectCode;
  let fix: ContainerProjectState['fix'];
  if (disabledByOwner) {
    // 停用优先：即使容器开着，项目也是被创建者停用的（可区分的原因码）
    code = 'disabled-by-owner';
    fix = 'enable-project';
  } else if (!runtimeId) {
    code = 'container-not-chosen';
    fix = 'choose-container';
  } else if (status === null) {
    code = 'container-not-ready';
    fix = 'start-container';
  } else if (status === 'not-installed' || status === 'unsupported-platform') {
    code = 'container-not-installed';
    fix = 'install-container';
  } else if (ready) {
    code = 'ok';
    fix = 'ok';
  } else {
    code = 'container-not-ready';
    fix = 'start-container';
  }
  const stopped = code !== 'ok';
  const restrictions = ['host-editing'];
  if (stopped) restrictions.push('development', 'collaboration', 'features');
  return {
    devEnv: 'container',
    containerOnly: true,
    running: !stopped,
    stopped,
    code,
    // 容器开发项目**恒**拒绝宿主侧编辑：容器就绪时编辑发生在容器里；容器没起时整个不可用。
    // 两种情况都不允许"退到宿主上做" —— 那正是这一条要防的事。
    hostEditingRefused: true,
    developmentAllowed: !stopped,
    developmentWhere: 'container',
    testingAllowed: true,
    testingWhere: 'host-or-other-device',
    historyReadable: true,
    // 不可用 = 等同创建者下线（复用既有语义，不新造）
    memberFace: stopped ? 'creator-offline' : null,
    restrictions,
    fix,
  };
}

/**
 * 主进程用的**拒绝**判定：这个项目现在能不能做"开发/聊天/用功能"这类事？
 * 返回 null = 放行；否则返回结构化拒绝（含 i18n 键与"等同创建者下线"这一事实）。
 * 任何"拿不准"（没探过 / 探测失败 / 没选运行时）都算拒绝 —— **绝不**乐观放开。
 */
export interface ContainerProjectRefusal {
  ok: false;
  code: 'project-unavailable';
  projectCode: ContainerProjectCode;
  /** 文案键（渲染层用）：container.project.reason.<suffix> */
  reasonKey: string;
  /** 成员侧形态：与创建者下线一致 */
  memberFace: 'creator-offline';
  /** 主机侧执行被拒绝（这是我们唯一的执行面；容器内执行尚未接入） */
  hostExecutionRefused: true;
  /** **历史仍然可读**（把这条一起回给渲染层，避免 UI 把整块都灰掉） */
  historyReadable: true;
  fix: ContainerProjectState['fix'];
}

export function projectUnavailableRefusal(state: ContainerProjectState): ContainerProjectRefusal | null {
  if (state.running) return null;
  return {
    ok: false,
    code: 'project-unavailable',
    projectCode: state.code,
    reasonKey: projectReasonKey(state.code),
    memberFace: 'creator-offline',
    hostExecutionRefused: true,
    historyReadable: true,
    fix: state.fix,
  };
}

/** 兼容旧名（上一轮的叫法）：projectDevelopmentRefusal 仍可用，但语义已扩到"项目不可用" */
export const projectDevelopmentRefusal = projectUnavailableRefusal;

/** 兼容旧名：上一轮叫 deriveContainerProjectState */
export const deriveContainerProjectState = deriveProjectState;
/** 兼容旧名：上一轮叫 containerProjectReasonKey */
export const containerProjectReasonKey = projectReasonKey;

/* ══════════════════════════════════════════════════════════════════════════
   容器内控制台（P4）—— **控制台就是容器里的控制台**
   ---------------------------------------------------------------------------
   产品主定稿：控制台的价值就是"给主机带来安全性防护" —— 所以它必须是**容器内的 shell**，
   而不是"应用内部事件日志"（那是做错了的一版，已撤销；事件日志已降级为独立的诊断视图）。

   安全契约（写进代码，也写进 UI；每一条都要能被断言）：
     · 只有**本机的人**手动敲入才会执行；远程对端 / 群成员 / 任何智能体 / 网络内容
       都没有注入路径（`remoteInjectPaths: 0`）；
     · **不自动执行**任何命令（`autoRun: false`）；
     · 本机的密钥类环境变量（API Key / SMTP 授权码 / 身份私钥）**不**带进容器
       （`forwardsSecretEnv: false`）；
     · 参数形状只有 `{ runtimeId, action }`（action 是**枚举**），
       **绝不接受命令字符串**；`data` 只作为"已经打开的那个本地 shell 的 stdin"，
       而且有长度上限、**绝不**被拼进任何命令行（`argvFromUntrustedSource: false`）；
     · 容器没就绪 ⇒ **一条命令都不执行**，如实拒绝并给引导（`hostFallback: false`
       —— 也绝不退化成"在主机上跑"或"回退成事件日志"）。
   ══════════════════════════════════════════════════════════════════════════ */

export type ContainerShellAction = 'open' | 'write' | 'close' | 'status';

/** 动作**枚举**：除此之外一律拒绝（渲染层不可能传"任意命令"进来） */
export const CONTAINER_SHELL_ACTIONS: readonly ContainerShellAction[] = ['open', 'write', 'close', 'status'];

/** 单次写入 stdin 的上限（字符）：防止拿它当大文件/数据通道 */
export const CONTAINER_SHELL_MAX_DATA = 4096;

export const CONTAINER_SHELL_SECURITY = {
  /** 只有本机的人手动输入才会执行 */
  typedBy: 'local-human-only',
  /** 远程可注入路径条数（恒 0，且这是**设计事实**，不是"暂时没有"） */
  remoteInjectPaths: 0,
  autoRun: false,
  forwardsSecretEnv: false,
  /** 参数里是否可能出现"来自不可信来源的命令行" */
  argvFromUntrustedSource: false,
  /** 容器没就绪时是否会退化成宿主执行（恒 false） */
  hostFallback: false,
} as const;

export interface ContainerShellRequest {
  runtimeId: string;
  action: ContainerShellAction;
  sessionId: string;
  /** 只作为已打开 shell 的 stdin；不当命令行用 */
  data: string;
}

export interface ContainerShellBadRequest {
  ok: false;
  code: string;
  error: string;
}

/**
 * 参数校验（**唯一入口**）。除了白名单里的四个字段，其余字段一律忽略，
 * 所以 `{ cmd: 'rm -rf /' }` 这类载荷**不可能**变成一条命令。
 */
export function normalizeContainerShellRequest(input: unknown): { ok: true; req: ContainerShellRequest } | ContainerShellBadRequest {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const action = String(raw['action'] ?? '');
  if (!CONTAINER_SHELL_ACTIONS.includes(action as ContainerShellAction)) {
    return { ok: false, code: 'bad-action', error: `action must be one of ${CONTAINER_SHELL_ACTIONS.join('|')}` };
  }
  const runtimeId = String(raw['runtimeId'] ?? '').trim();
  if (runtimeId && !containerRuntimeSpec(runtimeId)) {
    return { ok: false, code: 'unknown-runtime', error: `unknown runtime id: ${runtimeId}` };
  }
  const rawData = raw['data'];
  const data = rawData === undefined || rawData === null ? '' : String(rawData);
  if (data.length > CONTAINER_SHELL_MAX_DATA) {
    return { ok: false, code: 'data-too-long', error: `data exceeds ${CONTAINER_SHELL_MAX_DATA} chars` };
  }
  if (data.indexOf('\u0000') >= 0) return { ok: false, code: 'bad-data', error: 'data contains NUL' };
  if (action !== 'write' && data) {
    return { ok: false, code: 'unexpected-data', error: `action '${action}' does not take data` };
  }
  return { ok: true, req: { runtimeId, action: action as ContainerShellAction, sessionId: String(raw['sessionId'] ?? ''), data } };
}

export type ContainerShellGateCode =
  | 'ok'
  | 'not-in-chat'
  | 'not-enabled'
  | 'project-stopped'
  | 'container-not-ready'
  | 'no-image';

export interface ContainerShellGateInput {
  /** 只在「项目」与「我的牛马」的聊天里有控制台 */
  inProjectOrCattle?: boolean;
  /** 该会话是否开启了"运行/测试在容器中" */
  runInContainer?: boolean;
  /** 容器项目是否为停止态（见 deriveContainerProjectState） */
  projectStopped?: boolean;
  runtimeId?: string;
  /** 所选运行时的真实状态（null = 没探过 ⇒ 按未就绪） */
  runtimeStatus?: ContainerProbeStatus | null;
  /** 项目容器镜像是否已定（现在是 false —— 镜像来源待产品主决定） */
  imageReady?: boolean;
}

export interface ContainerShellGate {
  /** 能不能**真的跑命令**（只有引擎就绪 + 镜像就绪才 true） */
  available: boolean;
  /**
   * 面板能不能**打开**：引擎就绪时可以打开，用来如实显示"还差什么"（例如镜像未定 ⇒ 输入行禁用）。
   * 与 `available` 分开，是为了既不撒谎、又能给出可读的解释 —— 未就绪时连打开都不给。
   */
  openable: boolean;
  code: ContainerShellGateCode;
  /** 需要先装/启动容器（走 §3.3 引导流） */
  needsInstall: boolean;
  /** 为什么不可用 —— i18n 键：container.console.<reason> */
  reason: string;
}

/**
 * 控制台门禁。**顺序很重要**：先判"在不在这两处"，再判"开没开容器"，
 * 再判"项目是否停止"，最后才判"容器就绪 + 有没有镜像"。
 * 任何一条不满足都**不执行**任何命令（调用方据此如实拒绝）。
 */
export function containerShellGate(input: ContainerShellGateInput = {}): ContainerShellGate {
  if (input.inProjectOrCattle !== true) {
    return { available: false, openable: false, code: 'not-in-chat', needsInstall: false, reason: 'onlyInChat' };
  }
  if (input.runInContainer !== true) {
    return { available: false, openable: false, code: 'not-enabled', needsInstall: false, reason: 'notEnabled' };
  }
  if (input.projectStopped === true) {
    return { available: false, openable: false, code: 'project-stopped', needsInstall: false, reason: 'projectStopped' };
  }
  if (!input.runtimeId || input.runtimeStatus !== 'ready') {
    return { available: false, openable: false, code: 'container-not-ready', needsInstall: true, reason: 'notReady' };
  }
  if (input.imageReady !== true) {
    // 引擎就绪 ⇒ 面板可以打开，但**输入行必须禁用**（一条命令都不跑）
    return { available: false, openable: true, code: 'no-image', needsInstall: false, reason: 'needsImage' };
  }
  return { available: true, openable: true, code: 'ok', needsInstall: false, reason: 'ok' };
}

/* ══════════════════════════════════════════════════════════════════════════
   真实容器执行面（第十六批：产品主已修好 Docker 并授权**真的跑**）
   ---------------------------------------------------------------------------
   之前这一层只做"参数校验 + 门禁 + 如实拒绝"（一条命令都不执行）。现在接上真执行，
   但**纪律一条都不放宽**：

    1. **不接受任何来自渲染层 / 对端 / 模型 / 网络内容的命令字符串**。
       能跑的东西只有下面这张**固定命令表**（argv 由本模块拼），或 op 枚举本身。
       `data` 只作为"已经打开的交互 shell 的 stdin"。
    2. **绝不静默退回宿主执行**：引擎没就绪 / 镜像不合法 ⇒ 直接 `executed:false`，
       不 spawn、不换一种方式跑。
    3. **每条结论都带证据等级** —— 没真的 commit 成功就绝不写"已固化"。
    4. 子进程环境变量**先洗一遍**（密钥类一律不带），容器侧也不传任何 `-e` 密钥。
   ══════════════════════════════════════════════════════════════════════════ */

/** 项目目录在容器里的挂载点（与设置卡片里给用户的提示词一致） */
export const CONTAINER_PROJECT_MOUNT = '/workspace';
/** 项目容器名前缀（后面跟 12 位十六进制，来源 = groupId 的 sha256） */
export const CONTAINER_PROJECT_NAME_PREFIX = 'warmy-';
export const CONTAINER_PROJECT_NAME_RE = /^warmy-[0-9a-f]{12}$/;

/** 项目容器名：**由 groupId 决定**（可复算、可断言；不接受任何外部传入的名字） */
export function containerProjectName(groupId: string): string {
  const h = createHash('sha256').update(String(groupId || '')).digest('hex').slice(0, 12);
  return CONTAINER_PROJECT_NAME_PREFIX + h;
}

export function isValidContainerProjectName(v: unknown): boolean {
  return typeof v === 'string' && CONTAINER_PROJECT_NAME_RE.test(v);
}

/** 固化产物镜像引用（我们自己的命名空间；tag 用固化时刻的十进制时间戳） */
export function solidifiedImageRef(groupId: string, at: number): string {
  const h = createHash('sha256').update(String(groupId || '')).digest('hex').slice(0, 12);
  return `warmy-solid-${h}:${Math.max(0, Math.floor(at))}`;
}
export const SOLIDIFIED_IMAGE_RE = /^warmy-solid-[0-9a-f]{12}:\d{1,16}$/;

/** 镜像引用只允许两种来源：我们镜像表里**钉死 digest** 的那几个，或我们自己固化出来的 */
export function isAllowedImageRef(ref: unknown): boolean {
  const r = String(ref || '');
  if (!r) return false;
  if (SOLIDIFIED_IMAGE_RE.test(r)) return true;
  return CONTAINER_BASE_IMAGES.some((img) => !!img.digest && `${img.ref}@${img.digest}` === r);
}

/** 固定命令表：**argv 只能来自这里**（键是产品自己的枚举，值才是 argv） */
export const CONTAINER_FIXED_COMMANDS = {
  /** 链路冒烟（与 verify-container-real 用的那条同义） */
  'smoke-echo': ['echo', 'ok'],
  /** 容器里到底有没有 Linux 版 Node（镜像必须自带，不依赖主机） */
  'node-version': ['node', '-e', 'console.log(process.version)'],
  'node-platform': ['node', '-p', 'process.platform+"|"+process.arch'],
  /** 发行版事实（"先探测再动手"那条提示词要求的第一步） */
  'os-release': ['sh', '-c', 'cat /etc/os-release 2>/dev/null | head -n 3'],
  uname: ['uname', '-a'],
  pwd: ['pwd'],
  'which-runtimes': ['sh', '-c', 'for c in node npm python3 pip3 git java go; do printf "%s=" "$c"; command -v "$c" || echo "-"; done'],
  'ls-workspace': ['sh', '-c', 'ls -la | head -n 40'],
} as const;
export type ContainerFixedCommandId = keyof typeof CONTAINER_FIXED_COMMANDS;
export function isFixedCommandId(v: unknown): v is ContainerFixedCommandId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CONTAINER_FIXED_COMMANDS, v);
}
export const CONTAINER_FIXED_COMMAND_IDS: readonly ContainerFixedCommandId[] = [
  'smoke-echo', 'node-version', 'node-platform', 'os-release', 'uname', 'pwd', 'which-runtimes', 'ls-workspace',
];

/** 跑在容器里的操作（**枚举**；除此之外没有第二条路） */
export type ContainerExecOp =
  | 'ps'
  | 'run-rm'
  | 'run-detached'
  | 'exec-capture'
  | 'exec-shell'
  | 'stop'
  | 'rm'
  | 'commit'
  | 'image-inspect'
  | 'image-rm';
export const CONTAINER_EXEC_OPS: readonly ContainerExecOp[] = [
  'ps', 'run-rm', 'run-detached', 'exec-capture', 'exec-shell', 'stop', 'rm', 'commit', 'image-inspect', 'image-rm',
];

/** 引擎 CLI 白名单（**只认这几个二进制名**，不接受路径/参数注入） */
export const CONTAINER_EXEC_BINS: Record<string, string> = {
  docker: 'docker',
  podman: 'podman',
  nerdctl: 'nerdctl',
  'rancher-desktop': 'nerdctl',
};
export function containerExecBin(runtimeId: string): string | null {
  return CONTAINER_EXEC_BINS[String(runtimeId || '')] || null;
}

/** 洗过的子进程环境（密钥类变量**一律不带**：`docker` 客户端自己也不需要它们） */
export function scrubbedChildEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const denylist = /(key|token|secret|passwo?rd|credential|auth|cookie|session)/i;
  const allowlist = ['PATH', 'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL', 'DOCKER_HOST', 'DOCKER_CONFIG'];
  for (const k of allowlist) {
    const v = env[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    if (out[k]) continue;
    if (denylist.test(k)) continue;
    // 只带"看起来像系统/描述性"的变量，其它一律不传（宁可少传，也别把不该带的带出去）
    if (/^(WARMY_|XDG_|DOCKER_)/.test(k)) out[k] = v;
  }
  return out;
}

export interface ContainerExecParams {
  /** 已存在的项目容器名（必须形如 warmy-<12hex>） */
  name?: string;
  /** 一次性运行的镜像（必须是我们钉死的 digest 或我们自己固化出来的） */
  image?: string;
  /** 固定命令 id（argv 从 CONTAINER_FIXED_COMMANDS 取） */
  command?: string;
  /** run-detached 时要绑定进来的宿主目录（**项目目录**；只接受绝对路径） */
  hostDir?: string;
  /** 固化产物引用（commit 的目标镜像名） */
  imageRef?: string;
  /** 容器标签值（= groupId；只允许安全字符，避免任何拼接面） */
  projectLabel?: string;
  /** 是否用 --rm（一次性命令为 true；项目容器为 false ⇒ 保留可写层） */
  autoRemove?: boolean;
}

export const CONTAINER_EXEC_SECURITY = {
  /** 唯一入口是 (runtimeId, op 枚举, 上面那几个**结构化**字段) —— 没有"命令行字符串"这个参数 */
  argvFromUntrustedSource: false,
  /** 渲染层 / 对端 / 模型 / 网络内容都拿不到这条通道 */
  remoteInjectPaths: 0,
  /** 不继承宿主环境变量（密钥类一律不带） */
  inheritsSecretEnv: false,
  /** 引擎没就绪时是否改走宿主执行 */
  hostFallback: false,
  /** 固定命令表：能执行的 argv 只有这些 */
  fixedCommandsOnly: true,
} as const;

export interface ContainerExecPlan {
  file: string;
  args: string[];
  /** 建议超时 */
  timeoutMs: number;
}

export type ContainerExecPlanResult = { ok: true; plan: ContainerExecPlan } | { ok: false; code: string; error: string };

const SAFE_LABEL_RE = /^[A-Za-z0-9._:@/-]{1,120}$/;

/**
 * 把 (op, 结构化参数) 变成 argv。**这是唯一一处拼 argv 的地方**。
 * 任何不满足白名单的输入 ⇒ 返回错误（不"尽量满足"）。
 */
export function containerExecPlan(runtimeId: string, op: string, params: ContainerExecParams = {}): ContainerExecPlanResult {
  const id = String(runtimeId || '');
  const bin = containerExecBin(id);
  if (!bin) return { ok: false, code: 'runtime-not-executable', error: `runtime '${id}' has no executable CLI in our whitelist` };
  if (!CONTAINER_EXEC_OPS.includes(op as ContainerExecOp)) {
    return { ok: false, code: 'bad-op', error: `op must be one of ${CONTAINER_EXEC_OPS.join('|')}` };
  }
  const opName = op as ContainerExecOp;
  const name = String(params.name || '');
  const needName = opName !== 'run-rm' && opName !== 'image-inspect' && opName !== 'image-rm';
  if (needName && !isValidContainerProjectName(name)) {
    return { ok: false, code: 'bad-container-name', error: `container name must match ${CONTAINER_PROJECT_NAME_PREFIX}<12hex>` };
  }
  const fixed = (): string[] | null => {
    if (params.command === undefined || params.command === '') return ['echo', 'ok'];
    if (!isFixedCommandId(params.command)) return null;
    return [...CONTAINER_FIXED_COMMANDS[params.command]];
  };
  switch (opName) {
    case 'ps': {
      return { ok: true, plan: { file: bin, args: ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}'], timeoutMs: 30000 } };
    }
    case 'run-rm': {
      const image = String(params.image || '');
      if (!isAllowedImageRef(image)) return { ok: false, code: 'bad-image', error: 'image must be a pinned digest ref from our image table or our own solidified image' };
      const cmd = fixed();
      if (!cmd) return { ok: false, code: 'bad-command', error: `command must be one of ${CONTAINER_FIXED_COMMAND_IDS.join('|')}` };
      const args = ['run'];
      if (params.autoRemove !== false) args.push('--rm');
      // 只传一条**我们自己的**探针变量，用于证明"宿主密钥没被带进容器"（值是常量，不是宿主变量）
      args.push('--env', 'WARMY_PROBE=1', image, ...cmd);
      return { ok: true, plan: { file: bin, args, timeoutMs: 240000 } };
    }
    case 'run-detached': {
      const image = String(params.image || '');
      if (!isAllowedImageRef(image)) return { ok: false, code: 'bad-image', error: 'image must be a pinned digest ref from our image table or our own solidified image' };
      const args = ['run', '-d', '--name', name];
      const dir = String(params.hostDir || '');
      if (dir) {
        if (!path.isAbsolute(dir)) return { ok: false, code: 'bad-host-dir', error: 'hostDir must be absolute' };
        args.push('-v', `${dir}:${CONTAINER_PROJECT_MOUNT}`, '-w', CONTAINER_PROJECT_MOUNT);
      }
      const label = String(params.projectLabel || '');
      if (label) {
        if (!SAFE_LABEL_RE.test(label)) return { ok: false, code: 'bad-label', error: 'label contains unsupported characters' };
        args.push('--label', `warmy.project=${label}`);
      }
      // 常驻：**默认不删**（保留可写层 ⇒ 停止/启动回到之前的状态）
      args.push(image, 'sh', '-c', 'while true; do sleep 3600; done');
      return { ok: true, plan: { file: bin, args, timeoutMs: 180000 } };
    }
    case 'exec-capture': {
      const cmd = fixed();
      if (!cmd) return { ok: false, code: 'bad-command', error: `command must be one of ${CONTAINER_FIXED_COMMAND_IDS.join('|')}` };
      return { ok: true, plan: { file: bin, args: ['exec', name, ...cmd], timeoutMs: 120000 } };
    }
    case 'exec-shell':
      return { ok: true, plan: { file: bin, args: ['exec', '-i', name, 'sh'], timeoutMs: 0 } };
    case 'stop':
      return { ok: true, plan: { file: bin, args: ['stop', name], timeoutMs: 150000 } };
    case 'rm':
      return { ok: true, plan: { file: bin, args: ['rm', '-f', name], timeoutMs: 120000 } };
    case 'commit': {
      const ref = String(params.imageRef || '');
      if (!SOLIDIFIED_IMAGE_RE.test(ref)) return { ok: false, code: 'bad-image-ref', error: 'imageRef must match warmy-solid-<12hex>:<ts>' };
      return { ok: true, plan: { file: bin, args: ['commit', name, ref], timeoutMs: 600000 } };
    }
    case 'image-inspect': {
      const ref = String(params.image || params.imageRef || '');
      if (!isAllowedImageRef(ref)) return { ok: false, code: 'bad-image', error: 'image must be a pinned digest ref from our image table or our own solidified image' };
      return { ok: true, plan: { file: bin, args: ['image', 'inspect', '--format', '{{.Id}}|{{.Size}}|{{.Created}}', ref], timeoutMs: 60000 } };
    }
    case 'image-rm': {
      const ref = String(params.image || params.imageRef || '');
      if (!SOLIDIFIED_IMAGE_RE.test(ref)) return { ok: false, code: 'bad-image-ref', error: 'only our own solidified images can be removed' };
      return { ok: true, plan: { file: bin, args: ['image', 'rm', ref], timeoutMs: 120000 } };
    }
    default:
      return { ok: false, code: 'bad-op', error: 'unreachable' };
  }
}

export interface ContainerExecResult {
  ok: boolean;
  /** **真的执行了**（服务器/引擎侧受理并跑完）；未就绪或参数不合法时恒为 false */
  executed: boolean;
  op: string;
  file: string;
  /** argv 原样回传（便于核对"到底跑了什么"；其中不可能有渲染层传来的字符串） */
  argv: string[];
  code: number | null;
  out: string;
  err: string;
  ms: number;
  timedOut: boolean;
  codeReason: string | null;
}

/**
 * 真的执行一次（这一层是**唯一** spawn 引擎的地方）。
 * 注意：`op`/参数不合法 ⇒ `executed:false` 且**不 spawn**。
 */
export async function runContainerExec(
  runtimeId: string,
  op: string,
  params: ContainerExecParams = {},
  timeoutMsOverride?: number
): Promise<ContainerExecResult> {
  const planned = containerExecPlan(runtimeId, op, params);
  if (!planned.ok) {
    return {
      ok: false, executed: false, op: String(op || ''), file: '', argv: [], code: null,
      out: '', err: planned.error, ms: 0, timedOut: false, codeReason: planned.code,
    };
  }
  const { file, args } = planned.plan;
  const timeoutMs = typeof timeoutMsOverride === 'number' && timeoutMsOverride > 0 ? timeoutMsOverride : planned.plan.timeoutMs;
  const t0 = Date.now();
  const r = await new Promise<{ code: number | null; out: string; err: string; timedOut: boolean; spawnErr?: string }>((resolve) => {
    let done = false;
    const finish = (o: { code: number | null; out: string; err: string; timedOut: boolean; spawnErr?: string }): void => {
      if (done) return;
      done = true;
      resolve(o);
    };
    let child: ChildProcess;
    try {
      child = execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 22, encoding: 'buffer', env: scrubbedChildEnv() },
        (error, stdout, stderr) => {
          const out = decodeBuffer(stdout as unknown as Buffer).trim();
          const err = decodeBuffer(stderr as unknown as Buffer).trim();
          if (!error) return finish({ code: 0, out, err, timedOut: false });
          const anyErr = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
          const timedOut = anyErr.killed === true || String(anyErr.code) === 'ETIMEDOUT';
          finish({
            code: typeof anyErr.code === 'number' ? anyErr.code : null,
            out,
            err: err || compact(String(anyErr.message || '')),
            timedOut,
            ...(anyErr.code === 'ENOENT' ? { spawnErr: 'engine-cli-not-found' } : {}),
          });
        }
      );
    } catch (e) {
      finish({ code: null, out: '', err: compact(String((e as Error)?.message || e)), timedOut: false, spawnErr: 'spawn-failed' });
      return;
    }
    child.on('error', (e) => finish({ code: null, out: '', err: compact(String(e.message || e)), timedOut: false, spawnErr: 'spawn-failed' }));
  });
  const ms = Date.now() - t0;
  const ok = r.code === 0 && !r.spawnErr;
  return {
    ok,
    executed: true,
    op: String(op || ''),
    file,
    argv: args,
    code: r.code,
    out: r.out,
    err: r.spawnErr ? `${r.spawnErr}: ${r.err}` : r.err,
    ms,
    timedOut: r.timedOut,
    codeReason: ok ? null : (r.spawnErr || (r.timedOut ? 'timeout' : (r.code === null ? 'no-exit-code' : `exit-${r.code}`))),
  };
}

/* ── 交互 shell 会话（= 控制台本体）：一个常驻的 `docker exec -i <name> sh` ── */

interface ShellSession {
  id: string;
  groupId: string;
  runtimeId: string;
  name: string;
  child: ChildProcess;
  /** 还没被取走的输出（有界） */
  buffer: string;
  alive: boolean;
  openedAt: number;
  lastWriteAt: number;
  commandCount: number;
}

const shellSessions = new Map<string, ShellSession>();
export const CONTAINER_SHELL_BUFFER_MAX = 64 * 1024;

export interface ShellOpenResult {
  ok: boolean;
  executed: boolean;
  sessionId?: string;
  code?: string;
  error?: string;
  /** 真的是容器里的 shell（不是宿主 shell、不是事件日志） */
  insideContainer?: true;
  containerName?: string;
}

/** 打开一条**容器内的** shell（失败一律如实回错误码，不 fallback 到宿主） */
export function openContainerShellSession(input: { groupId: string; runtimeId: string; containerName: string }): ShellOpenResult {
  const { groupId, runtimeId } = input;
  const name = String(input.containerName || '');
  if (!isValidContainerProjectName(name)) return { ok: false, executed: false, code: 'bad-container-name', error: 'invalid container name' };
  const planned = containerExecPlan(runtimeId, 'exec-shell', { name });
  if (!planned.ok) return { ok: false, executed: false, code: planned.code, error: planned.error };
  // 同一个项目只留一条会话：重复打开 = 复用（避免用户点两次就多一条 shell）
  for (const s of shellSessions.values()) {
    if (s.groupId === groupId && s.alive) return { ok: true, executed: false, sessionId: s.id, insideContainer: true, containerName: s.name };
  }
  try {
    const child = spawn(planned.plan.file, planned.plan.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: scrubbedChildEnv(),
    });
    const id = `${groupId}:${Date.now().toString(36)}`;
    const s: ShellSession = {
      id, groupId, runtimeId, name, child, buffer: '', alive: true, openedAt: Date.now(), lastWriteAt: 0, commandCount: 0,
    };
    const push = (buf: Buffer): void => {
      if (!s.alive) return;
      s.buffer += decodeBuffer(buf);
      if (s.buffer.length > CONTAINER_SHELL_BUFFER_MAX) s.buffer = s.buffer.slice(-CONTAINER_SHELL_BUFFER_MAX);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', () => {
      s.alive = false;
    });
    child.on('close', () => {
      s.alive = false;
    });
    shellSessions.set(id, s);
    return { ok: true, executed: true, sessionId: id, insideContainer: true, containerName: name };
  } catch (e) {
    return { ok: false, executed: false, code: 'spawn-failed', error: compact(String((e as Error)?.message || e)) };
  }
}

/**
 * 找到一条会话：`key` 既可以是**shell 会话 id**，也可以是**项目/会话 id**。
 * 为什么要兼容后者：IPC 的参数白名单只有 `{ runtimeId, action, sessionId, data }`
 * （这条白名单本身是可断言的契约，**不为这个改动放宽**），而渲染层手里那个 sessionId
 * 就是项目 id —— 所以这里按"先精确、再按项目"解析，一个项目同时只留一条 shell。
 */
function findShellSession(key: string): ShellSession | undefined {
  const k = String(key || '');
  if (!k) return undefined;
  const byId = shellSessions.get(k);
  if (byId) return byId;
  for (const s of shellSessions.values()) if (s.groupId === k && s.alive) return s;
  return undefined;
}

export interface ShellWriteResult {
  ok: boolean;
  executed: boolean;
  code?: string;
  error?: string;
  /** 这一条命令跑完之后取到的输出（**来自容器**） */
  output?: string;
  sessionId?: string;
}

/** 把 `data` 写进已打开的容器 shell 的 stdin（**只当 stdin，绝不当命令行**） */
export async function writeContainerShellSession(
  sessionId: string,
  data: string,
  opts: { settleMs?: number; quietMs?: number } = {}
): Promise<ShellWriteResult> {
  const s = findShellSession(sessionId);
  if (!s) return { ok: false, executed: false, code: 'no-session', error: 'no such shell session (open it first)' };
  if (!s.alive) return { ok: false, executed: false, code: 'session-closed', error: 'container shell is closed' };
  const text = String(data ?? '');
  if (text.length > CONTAINER_SHELL_MAX_DATA) return { ok: false, executed: false, code: 'data-too-long', error: `data exceeds ${CONTAINER_SHELL_MAX_DATA} chars` };
  if (text.indexOf('\u0000') >= 0) return { ok: false, executed: false, code: 'bad-data', error: 'data contains NUL' };
  try {
    s.buffer = '';
    s.child.stdin?.write(text);
    s.lastWriteAt = Date.now();
    s.commandCount += 1;
  } catch (e) {
    return { ok: false, executed: false, code: 'write-failed', error: compact(String((e as Error)?.message || e)) };
  }
  // 收输出：静默 quietMs 之后就算这一轮结束（最多等 settleMs）
  const settleMs = Math.max(100, Math.min(opts.settleMs ?? 1200, 8000));
  const quietMs = Math.max(40, Math.min(opts.quietMs ?? 180, 1000));
  const t0 = Date.now();
  let lastLen = -1;
  let lastChange = Date.now();
  for (;;) {
    if (s.buffer.length !== lastLen) {
      lastLen = s.buffer.length;
      lastChange = Date.now();
    }
    if (s.buffer.length > 0 && Date.now() - lastChange >= quietMs) break;
    if (Date.now() - t0 >= settleMs) break;
    if (!s.alive) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const output = s.buffer;
  s.buffer = '';
  return { ok: true, executed: true, output, sessionId: s.id };
}

export function closeContainerShellSession(sessionId: string): { ok: boolean; closed: boolean; code?: string } {
  const s = findShellSession(sessionId);
  if (!s) return { ok: true, closed: false, code: 'no-session' };
  try {
    s.child.stdin?.end();
  } catch {
    /* noop */
  }
  // 给它 1.5s 自己退；不退就杀了它（只杀我们自己起的这个子进程）
  setTimeout(() => {
    try {
      if (s.alive) s.child.kill();
    } catch {
      /* noop */
    }
  }, 1500).unref?.();
  s.alive = false;
  shellSessions.delete(s.id);
  return { ok: true, closed: true };
}

export function containerShellSessions(): Array<{ id: string; groupId: string; runtimeId: string; containerName: string; alive: boolean; commands: number }> {
  return [...shellSessions.values()].map((s) => ({
    id: s.id, groupId: s.groupId, runtimeId: s.runtimeId, containerName: s.name, alive: s.alive, commands: s.commandCount,
  }));
}

/** 停掉某个项目的 shell 会话（项目停止 / 容器被删 / 退出时都要走一遍） */
export function closeContainerShellSessionsOf(groupId: string): number {
  let n = 0;
  for (const s of [...shellSessions.values()]) {
    if (s.groupId === String(groupId || '')) {
      closeContainerShellSession(s.id);
      n++;
    }
  }
  return n;
}

/* ── 环境固化 / 回滚到固化点：**证据等级**（没真成功就绝不写"已固化"） ── */

export type SolidifyEvidenceLevel =
  /** 真的 commit 成功（有镜像 id 为证） */
  | 'commit-succeeded'
  /** 如实拒绝（能力不支持 / 没选运行时 / 容器不存在 / 引擎没就绪） */
  | 'refused'
  /** 压根没试（例如节流窗口内） */
  | 'not-attempted';

export type RollbackEvidenceLevel =
  /** 真的从固化镜像起了一个容器（有容器 id 为证） */
  | 'container-started'
  | 'refused'
  | 'not-attempted';

/**
 * 固化 / 回滚的**安全提醒**（必须贴着按钮显示；写成可断言的事实）：
 * commit 会把当时的**整个文件系统**一起固化 —— 包括可能的密钥、token、缓存与临时文件。
 * 所以：入口旁必须写清；我们**不**自作主张删用户文件；用户自己按键才固化。
 */
export const ENV_SOLIDIFY_SECURITY = {
  /** 固化会把整个文件系统（含可能的密钥）一起冻结进镜像 */
  freezesWholeFilesystem: true,
  /** 是否会自动删用户的文件 */
  deletesUserFiles: false,
  /** 是否会把本机密钥类环境变量带进容器（恒 false） */
  forwardsSecretEnv: false,
  /** 固化产物保留个数 */
  keep: SOLIDIFY_KEEP,
  /** 节流窗口（毫秒） */
  coalesceMs: SOLIDIFY_COALESCE_MS,
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   宿主侧文件系统强制（P5：把"宿主侧不许编辑"从**应用内拒绝**推进到**文件系统**）
   ---------------------------------------------------------------------------
   背景（ADR 004 §7.1 的诚实边界）：我们能拒绝本应用在宿主侧编辑容器开发项目，
   但**拦不住用户自己用外部编辑器打开那个目录**。这一节把它补上。

   选型（**最小侵入且可撤销**，三条硬要求）：
     · 只在**用户显式按键**时才加锁（**绝不自动加**）—— 这是"最小侵入"的落点；
     · 用一条**继承式 deny ACE**（`(OI)(CI)(W)`）挂在项目目录**根**上，
       不动子项的 ACL ⇒ 撤销只需要**一条** `icacls /remove:d`；
     · 目录**属主**永远能改自己的 DACL ⇒ 用户哪怕在应用外也能自己解锁（不会被锁死）。
   做不到的（如实说）：这不是加密、也不是沙箱；同机的管理员/系统进程照样能写；
   它拦的是"以你本人身份运行的编辑器/脚本"这一类。

   ⚠️ Windows 特有：`icacls` 只存在于 Windows。POSIX 上要等价物得改 mode 位并记录原值，
   侵入性明显更大 ⇒ **如实拒绝**（给用户看原因），不做半套。
   ══════════════════════════════════════════════════════════════════════════ */

export type HostDirGuardAction = 'apply' | 'lift' | 'status';

export const HOST_DIR_GUARD_SECURITY = {
  /** 只有用户显式按键才会加锁 */
  userInitiatedOnly: true,
  /** 撤销是**一条命令**（根目录上一条继承式 ACE） */
  singleCommandRollback: true,
  /** 目录属主永远能改自己的 DACL ⇒ 不会把用户锁死 */
  ownerCanAlwaysUnlock: true,
  /** 是否加密或沙箱 */
  encrypts: false,
  /** 自动加锁 */
  autoApply: false,
} as const;

/** 用户 SID 形态（只接受 SID 文本，**不接受账号名**：账号名有本地化/歧义问题） */
export const USER_SID_RE = /^S-1-\d+(-\d+)+$/;
export function isUserSid(v: unknown): boolean {
  return typeof v === 'string' && USER_SID_RE.test(v.trim());
}

export interface HostDirGuardPlan {
  file: string;
  args: string[];
  action: HostDirGuardAction;
  /** 这一条 ACE 到底挡住了什么（如实告知，不夸大） */
  denies: string;
}

/**
 * 加锁用的**具体权限集**（不是笼统的 `W`）。
 *
 * ⚠️ 实测（本机 Windows 11）：用简单的 `(W)` 会把 FILE_GENERIC_WRITE 里的
 * SYNCHRONIZE / READ_CONTROL 一起拒掉 ⇒ **连读都打不开**（`fs.readFileSync` 直接 EPERM）。
 * 那比我们承诺的更侵入（用户连文件都看不了），与"最小侵入"不符。
 * 所以改成只拒**具体的修改类权限**：
 *   WD = 写数据 / AD = 追加（在目录上就是"新建子项"） / WEA / WA = 写扩展属性与属性
 *   DE = 删自己 / DC = 删子项
 * **不**拒 RD（读数据/列目录）、REA、RA、X（执行）、S（同步），
 * 更**不**拒 WRITE_DAC / WRITE_OWNER —— 那两条一拒，用户就连"自己解锁"都做不到了。
 */
export const HOST_DIR_GUARD_RIGHTS = 'WD,AD,WEA,WA,DE,DC';

/**
 * 生成 icacls 计划（**唯一的 argv 拼装点**）。
 * 加锁：`icacls <dir> /deny *<sid>:(OI)(CI)(WD,AD,WEA,WA,DE,DC)`
 *   —— 继承给子项，只堵"改/建/删"，读与执行照旧；
 * 解锁：`icacls <dir> /remove:d *<sid>`        —— 删掉那条 deny ACE
 * 查看：`icacls <dir>`                          —— 只读
 */
export function hostDirGuardPlan(opts: {
  action: HostDirGuardAction;
  dir: string;
  sid: string;
  platform?: string;
  /** 测试时可注入：非 win32 一律拒绝（不假装做到了） */
}): { ok: true; plan: HostDirGuardPlan } | { ok: false; code: string; error: string } {
  const platform = String(opts.platform || process.platform);
  if (platform !== 'win32') {
    return {
      ok: false,
      code: 'platform-not-supported',
      error: `host directory locking is only implemented for Windows (icacls); platform=${platform}`,
    };
  }
  const action = opts.action;
  if (!['apply', 'lift', 'status'].includes(action)) return { ok: false, code: 'bad-action', error: `action must be apply|lift|status` };
  const dir = String(opts.dir || '');
  if (!dir || !path.isAbsolute(dir)) return { ok: false, code: 'bad-dir', error: 'dir must be an absolute path' };
  if (action === 'status') {
    return { ok: true, plan: { file: 'icacls', args: [dir], action, denies: 'read-only query' } };
  }
  const sid = String(opts.sid || '').trim();
  if (!isUserSid(sid)) return { ok: false, code: 'bad-sid', error: 'sid must be a SID string like S-1-5-21-...' };
  if (action === 'apply') {
    return {
      ok: true,
      plan: {
        file: 'icacls',
        args: [dir, '/deny', `*${sid}:(OI)(CI)(${HOST_DIR_GUARD_RIGHTS})`],
        action,
        denies: 'write / create / delete for the owner (inherited to the contents); reading and executing still work; admin and SYSTEM are unaffected',
      },
    };
  }
  return { ok: true, plan: { file: 'icacls', args: [dir, '/remove:d', `*${sid}`], action, denies: 'removes the deny ACE (restore)' } };
}

/** 项目目录加锁的**可撤销记录**（存在本机设置里：ACL 本来就是本机事实，不是项目属性） */
export interface HostDirGuardRecord {
  dir: string;
  sid: string;
  appliedAt: number;
  /** 撤销过的历史（留证：录下来才知道"锁过又要还原"发生过） */
  liftedAt?: number;
}


