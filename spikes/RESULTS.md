# P0 Spike 结果（本机 Windows x64 / Node v24.20.0）

> **本文件于 2026-09-17 按「证据优先」原则重写。**
>
> **判定规则：每一行的判定都必须有原始输出落盘作为支撑**（即该 Spike 目录下的 `result.json` /
> `*.json`，里面是脚本真实跑出来的 HTTP 状态码、计时、退出码、原始 stderr 等）。
> **没有原始输出支撑的项，一律不得写「完成」**；跑不了、做不到的项一律写「未验证 / 未实现 + 原因」。
>
> 旧版 RESULTS.md 中若干「通过」在仓库里找不到任何原始测量输出（只有叙述），已按证据重判，
> 逐条对照见文末 **「修订说明」**。

**环境基线**

| 项 | 值 |
|---|---|
| OS | Windows x64（本机 DESKTOP-XXXXXXX） |
| Node | v24.20.0（`C:\Program Files\nodejs\node.exe`） |
| 权限 | **非管理员**（`net session` 失败；gsudo status 报 `Is Admin: False`） |
| API 凭据 | **无任何 key**（`DEEPSEEK_API_KEY` 等环境变量均未设置，无 `.env`） |
| gsudo | v2.6.1（`C:\Program Files\gsudo\Current\gsudo.exe`） |
| 复现命令 | 见每项明细中的「复现」行；所有脚本 UTF-8，`node <script>` 直接跑 |

---

## 一、状态总表（只列有证据的结论）

| # | Spike | DoD（ADR 000 第四章） | 实测值（原始证据中的数字） | 证据文件 | 判定 |
|---|---|---|---|---|---|
| 1 | bundled Node 拉起 dsh | 5 平台分别拉起 dsh 0.1.5-rc.1；node-pty / koffi prebuild 可得 | 本机 Node 24 加载 `@deepseek-ai/dsh@0.1.5-rc.1` 成功；`node-pty` load=true；`koffi` 3.3.0 load=true；**5 平台 bundled Node 0/5 未测** | `spikes/spike-01-bundled-node/result.json` | **部分完成** |
| 2 | better-sqlite3 长驻子进程 IPC | hash 点查 P95 < 5ms；FTS5 检索（**10 万条**）P95 < 20ms | hash 1000 次：P50 **0.052ms** / P95 **0.129ms**；FTS 1 万条 P95 0.149ms；FTS **10 万条**（seed 465ms，DB 21.7MB）P95 **0.195ms** | `spikes/spike-02-sqlite-ipc/result.json` | **完成** |
| 3 | in-history 缓存稳定性 | 50 轮记录每轮命中率；第 25 轮注入 in-history 后 cacheRead 保持 | **未测量**：无 `DEEPSEEK_API_KEY`，脚本 `exit=3`（未发出鉴权请求） | `spikes/spike-03-in-history/result.json`（`status: skipped-no-credential`）+ `smoke-bogus-key.json`（脚本可用性自测） | **未验证** |
| 4 | FTS5 单字索引 + 短语查询 | 2 字词命中率 100% | 25/25 用例通过；**2 字词 7/7 = 100%**；含反例（不命中）全部符合预期 | `spikes/spike-04-fts-cjk/result.json` | **完成** |
| 5 | agent-teams + memory-plus 共存 | 安装 + 运行时 profile 合并（两者共存可用） | **未能复现**：agent-teams 装上（`teamsInstalled=true`），但 profile bundle `dsh-memory-bundle` 解析失败，`--dump-config` **exit=1**、`bothMounted=false` | `spikes/spike-05-plugins/result.json` | **未实现（未复现）** |
| 6 | V4 Pro 可用性 | V4 Pro API 返回正常响应 | **未测量**：无 key。匿名（无 Authorization）探测 `GET /models` → **HTTP 401**（仅证明端点可达，不证明模型可用） | `spikes/spike-06-v4-pro/result.json` + `smoke-bogus-key.json` | **未验证** |
| 7 | ONNX WASM SIMD/WebGPU 嵌入 | WebGPU 或 WASM SIMD P95 < 50ms | wasm-simd load 40.3ms，P95 **8.92ms**；wasm-nosimd P95 8.191ms；"webgpu" 行 P95 8.244ms 但**该行实为 wasm 降级**（Node 无 WebGPU backend）；边界输入（空串/200标点/500字符）输出形状正确 | `spikes/spike-07-onnx/result.json` | **完成**（WASM SIMD 路径；WebGPU 未测） |
| 8 | 系统级 Helper Tool | 修改 hosts 文件成功 | **真实 hosts 提权写入成功**：gsudo -n `copy /y` 覆盖 `C:\Windows\System32\drivers\etc\hosts`，内层 exit=0，回读 sha256 一致；写入后已移除探针行，hosts 回到原始 sha256 `b27b9adf…`；自检 **57/57** 通过；**macOS SMAppService 分支未验证** | `spikes/spike-08-helper/result.json` + `backups/*.bak` | **部分完成**（Windows 完成 / macOS 未实现） |
| 9 | 本地回环 | 完整生命周期无死锁；停止后进程树归零 | 子进程 IPC ready→ping/pong→exit：RTT **0.416ms**，exitCode 0；**Electron 主进程 → 记忆子进程 → dsh 实例三段链路未测** | `spikes/spike-09-loopback/result.json` | **部分完成** |
| 10 | 跨设备同步协议 | 两节点消息互通；远程 AI 执行后本地无会话日志 | A→B、B→A 均互通（true/true）；incognito 前后文件数 0→0、zeroTrace=true；B `become_duty` 被拒 | `spikes/spike-10-sync/result.json` | **部分完成**（同机双进程模拟，非两台真机） |

> 说明：判定为「部分完成」的原因是 **DoD 只被部分验证**（如 5 平台→1 平台、真机→同机模拟、
> Windows→无 macOS），不是「测了但不达标」。所有「部分完成」项括号内都写明了缺口。
>
> **数字来源**：表中数字取自 2026-09-17T12:07Z 的最终一轮复跑（每个脚本至少复跑 2~4 次）。
> 计时类指标在复跑间有波动，范围见各明细下的「复跑波动」。

---

## 二、逐项明细（含复现方式与退出码）

### Spike 1 — bundled Node 拉起 dsh：部分完成

- 复现：`node spikes/spike-01-bundled-node/run.mjs` → **exit=0**
- 实测：`@deepseek-ai/dsh@0.1.5-rc.1`（`main: {dsh: lib/bin.js}`）可被 Node 24 解析加载；
  `node-pty` 加载成功；`koffi@3.3.0` 加载成功；`node-addon-require-builtin` 加载成功。
- **缺口**：ADR 要求「下载 5 平台独立 Node.js 二进制并在 5 平台分别拉起 dsh」，本机只验证了
  1 个平台（win32 x64）+ 系统 Node。arm64/x64 Electron 打包崩溃问题、extraResources 回退方案均未验证。

### Spike 2 — better-sqlite3 长驻子进程 IPC：完成

- 复现：`node spikes/spike-02-sqlite-ipc/run.mjs` → **exit=0**
- 实测（`phases`，最近一次运行）：

| 阶段 | 样本 | P50 | P95 | max |
|---|---|---|---|---|
| hash 点查（1000 行 KV 表，1000 次 IPC 往返） | 1000 | 0.052ms | **0.129ms** | 0.625ms |
| FTS5（1 万条） | 100 | 0.070ms | 0.149ms | 0.278ms |
| FTS5（**10 万条**，ADR 口径） | 200 | 0.111ms | **0.195ms** | 0.455ms |

- 复跑波动（2 次）：hash P95 0.129/0.129ms；FTS@1万 P95 0.149~0.155ms；FTS@**10万** P95 0.168~0.195ms；
  10 万条 seed 461~465ms。两档都远低于 DoD 阈值（5ms / 20ms），结论不敏感。
- 索引规模：10 万条 seed 用时 465ms，DB 文件 21,684,224 字节。
- 结论：**长驻子进程远优于 per-query fork**（旧版报告 per-query fork 为 37~40ms 量级，本轮未复测该对照组，
  该数字**仍无原始输出**，故不作为结论引用）。
- **复核修订**：旧脚本只灌 **1 万条** FTS 记录就宣称达标，与 ADR「10 万条记录」口径不符；
  本版按 1 万 / 10 万两档分别实测，10 万条下 P95 仍为 0.168ms，DoD 成立。

### Spike 3 — in-history 缓存稳定性：未验证

- 复现：`node spikes/spike-03-in-history/run.mjs` → **exit=3**，输出 `DEEPSEEK_API_KEY required`
- 结果文件记录 `status: skipped-no-credential`，并写明：**未发出任何鉴权请求**，
  旧版 RESULTS.md 里的具体数字（`hit 稳定在 128 tokens`、in-history 均值 **0.42**、rewrite 均值 **0.078**）
  在仓库中**找不到任何原始输出**，无法核实。
- 脚本可用性自测：用一把**假 key** 跑 `spikes/spike-03-in-history/smoke-bogus-key.json`，
  真实拿到 `401 …Authentication Fails…`，证明脚本确实在调 API、不是空壳。
- 另外：ADR 原文要求 **50 轮**、第 **25** 轮注入；脚本实跑 10 轮 / 第 5 轮注入，即使有 key 也是偏差，已在结果文件中标注。

### Spike 4 — FTS5 单字索引 + 中文短语：完成

- 复现：`node spikes/spike-04-fts-cjk/run.mjs` → **exit=0**
- 实测：25 个用例 **25/25 通过**；其中 2 字词 **7/7（100%）**，DoD 达标。
- 覆盖：1 字 / 2 字 / 3 字 / 4 字 / 短语连续 / 反序不命中 / 跳字不命中 / 英文标识符 / 路径 / 错误码。
- 策略：索引侧与查询侧**双侧字符间插空格** + FTS5 短语 `MATCH '"…"'`，tokenizer `unicode61`。

### Spike 5 — agent-teams + memory-plus 共存：未实现（未复现）

- 复现：`node spikes/spike-05-plugins/run-merge2.mjs` → **exit=1**
- 实测：profile 创建 `exit=0`；`pnpm install` `exit=0`；`teamsInstalled=true`、`memInstalled=false`；
  `--dump-config` **exit=1**，stderr 原文：
  `…cannot resolve profile bundle "dsh-memory-bundle" from the dsh installation or <profile dir>; run 'dsh plugin --profile … install' if its dependency is not installed`
  → `hasTeamsInDump=false`、`hasMemoryInDump=true`、`bothMounted=false`。
- **复核修订**：旧版声称「profile 合并 **通过** —— `--dump-config` 同时含 agent-teams 与 dsh-memory-* 全套」，
  该结论**无法复现**，且旧版没有任何 `--dump-config` 原始输出落盘。
- 已修的脚本缺陷：原脚本在调用 dsh 前就 `mkdir` 了 profile 目录，导致 `--from-default-profile` 直接失败（exit=1）；已改为由 dsh 自己创建。
- 结论：共存（本 DoD 的核心）**未验证/未实现**。ADR 的回退方案「按序 patch 或二选一（优先保留 memory-plus）」仍然适用。

### Spike 6 — DeepSeek V4 Pro 可用性：未验证

- 复现（无 key）：`node spikes/spike-06-v4-pro/run.mjs` → **exit=3**，结果 `verdict.status = "skipped"`
- 脚本行为（**这是本次新建的实现**，旧仓里此前**没有** spike-06 目录/脚本/调用记录）：
  1. 从 `DEEPSEEK_API_KEY` 取凭据；**没有凭据时明确记「跳过/未能验证」，绝不报通过**；
  2. 有凭据时先 `GET /models`，再对每个模型 `POST /chat/completions`（`max_tokens: 8`），
     把 **HTTP 状态码 + 响应体片段**（密钥一律脱敏为 `sk-***REDACTED***`，另存 `keySha256Prefix`）写入 `result.json`；
  3. 探测模型列表默认含 **`deepseek-v4-pro`、`deepseek-pro`**、`deepseek-flash`、`deepseek-chat`、`deepseek-reasoner`。
- 本机实测：匿名探测 `GET https://api.deepseek.com/models` → **HTTP 401**（`Authentication Fails (governor)`，177ms）。
  **只有端点可达性证据，没有任何模型可用性证据。**
- 复现（有 key 的机器）：
  `$env:DEEPSEEK_API_KEY="sk-…"; node spikes/spike-06-v4-pro/run.mjs`（exit 0=达标 / 1=不达标 / 3=无凭据）
- 脚本可用性自测：假 key 跑出 `smoke-bogus-key.json`：`deepseek-v4-pro` 与 `deepseek-pro` 均 **401**，
  证明调用链真实（但**不能**据此判断模型是否存在——401 早于模型解析）。
- 影响：ADR 关于「V4 Pro 继续提供」的结论**目前没有证据**，代码不应据此做硬编码假设。

### Spike 7 — ONNX WASM 嵌入延迟：完成（WASM SIMD 路径）

- 复现：`node spikes/spike-07-onnx/run.mjs` → **exit=0**
- 实测（每档 20 次，最近一次运行）：

| 后端 | load | P50 | P95 |
|---|---|---|---|
| "webgpu"（实为 wasm 降级） | 165.6ms | 6.726ms | 8.244ms |
| **wasm-simd** | 40.3ms | 6.654ms | **8.92ms** |
| wasm-nosimd | 36.0ms | 6.544ms | 8.191ms |

- 复跑波动（3 次）：wasm-simd P95 8.228 / 8.291 / **8.92**ms；wasm-nosimd 8.191~8.696ms；
  "webgpu" 行 8.178~8.478ms。三者都在 8~9ms 区间，**远低于 DoD 的 50ms**，结论稳定。
- DoD（WebGPU 或 WASM SIMD P95 < 50ms）**达标**：wasm-simd P95 8.92ms（最差一次）。
- 模型：`Xenova/bge-small-zh-v1.5` quantized，vocab 21128，输出 dim 512（边界用例均为 `[1, n, 512]`）。
- **必须澄清**：Node 侧**没有 WebGPU backend**，onnxruntime-web 会输出
  `removing requested execution provider "webgpu" … backend not found` 并**静默降级到 wasm**。
  所以上表 webgpu 行的数字**不是 WebGPU 证据**；WebGPU 必须在 Electron 浏览器上下文单独测（未做）。

### Spike 8 — 系统级 Helper Tool：部分完成（Windows 完成 / macOS 未实现）

- 复现：`node spikes/spike-08-helper/run.mjs` → **exit=0**（57/57 检查通过）
- **真实实现**（不是一次性 spike 壳）：`packages/app-shell/src/helper-tool.ts`（L5 Shell 组件，只用 Node 内置模块，
  符合本包「零原生模块」约束）。run.mjs 直接 `import` 该 `.ts` 源文件（Node 24 原生类型擦除）跑真实代码路径。
- 能力清单（均已实测）：
  1. **平台探测与工具选择**：win32→gsudo（含 `GSUDO_PATH`/Program Files/LOCALAPPDATA/chocolatey/`where` 五级探测）、
     darwin→SMAppService（`macHelperPlan()` 产出 launchd plist + 5 步注册流程）、其它平台→明确 `ELEVATION_UNSUPPORTED_PLATFORM`；
  2. **安全修改 hosts**：行格式校验（IP 用 `net.isIP`、主机名正则、注释禁 `#`/换行）→ 内容体检（NUL 等致命项直接拒写）→
     **先备份**（写到 `~/.warmy/helper-backups`，回读校验 sha256）→ **幂等 upsert**（已存在不重复写）→ 写入 → **回读 sha256 校验** →
     失败或校验不一致则**自动回滚**；
  3. **绝不挂住**：全部走非交互 `gsudo -n`（`stdio: stdin=ignore`，绝不弹无人应答的 UAC）；
     工具缺失/可执行文件不存在/不支持平台 → 立即返回明确错误码；提权挂起 → 超时杀进程树（实测 `ELEVATION_TIMEOUT`，无残留 gsudo 进程）。
- 非提权部分（对临时文件，真实文件 I/O）**37/37 通过**，覆盖：行校验（含注入型主机名 `; | & >` 全部被拒）、
  内容体检、幂等 upsert / 精确 remove、真实写入、备份生成与校验、重复 apply 幂等（sha256 不变）、
  回滚到逐字节一致、NUL 文件拒写、非法行拒写、目标不可读、回读校验正/反例、dryRun 不写盘。
- **真实 hosts 提权写入（DoD）实测结果**：
  - 当前进程对 hosts **无写权限**（直接写 → `EPERM`），自动降级到提权路径；
  - `gsudo -n cmd /c <临时脚本>` 执行 `copy /y <暂存文件> C:\Windows\System32\drivers\etc\hosts`，
    内层 **exit=0**，原始输出 `已复制 1 个文件。`（GBK 已正确解码）；
  - 追加行：`127.0.0.1 warmy-spike08.local # WArmy spike-08 helper probe (auto-removed)`；
  - 回读校验：sha256 与期望一致 → **写入成功**（DoD 在 Windows 上成立）；
  - 清理：移除探针行后 hosts 恢复 **原始 sha256 `b27b9adf94b3ea539e34e40872e52a758797c31517f27d9e6f0415c7d1d2adc7`**（2616B → 2538B 再回到 2538B）。
- **6 条实测踩坑（已写进 helper-tool.ts 头部注释，P1 落地必须遵守）**：
  1. `gsudo status` 报 `Available for this process: False`（缓存会话 0）**但 `gsudo -n` 仍能提权成功**（实测 High Mandatory Level S-1-16-12288）——
     不能拿缓存状态当能否提权的判据；
  2. **`gsudo -n` 不回传内层退出码**（`gsudo -n cmd /c exit 9` 实测返回 **0**）——因此改用「临时 .cmd 脚本 + 标记文件写回 `%errorlevel%`」，
     并且**最终必须靠回读 sha256 判定**；
  3. gsudo stdout 在被重定向的 console 下可能为空，必须靠标记文件取原始输出；标记文件是 GBK，需要 GBK 兜底解码；
  4. **gsudo -n 存在瞬时假失败**（返回 0 但内层没执行、无标记文件）→ `runElevatedArgs` 默认重试 2 次；
  5. 提权 `copy` 覆盖 hosts 会撞到共享冲突（`另一个程序正在使用此文件`）——开发过程中真实撞到过一次，导致那一轮清理失败、
     并从（已含探针行的）备份回滚；**瞬态故障无法按需复现**，因此补了一个确定性的 **fail-once 用例（H-13）**覆盖同一套重试逻辑，
     原始 `attemptLog`（`#1 code=ELEVATION_DENIED innerExit=3` → `#2 code=OK innerExit=0`，attempts=2）已落盘在 `result.json`。
     那一轮的 `result.json` 已被后续复跑覆盖，故不引用其数字；
  6. 在批处理里调用另一个 `.cmd` 必须写 `call "<script>"`（否则控制权不返回、标记文件永远不写）——H-13 用例就是踩了这个坑后修出来的。
- **未验证**：macOS `SMAppService` 分支（本机非 macOS；只有注册计划 + 代码路径，`verified: false`，
  且 ADR 提到的 macOS 26 `fullPath is nil` XPC 问题未复现）。因此本项判定为**部分完成**。
- 安全说明：临时脚本/暂存文件落在 `os.tmpdir()`（用户私有），提权进程会以管理员身份执行它，
  存在 TOCTOU 风险；已做「随机文件名 + 执行前后脚本 sha256 比对 + 用后即删」，并在源码注释里写明生产环境应改为已签名 helper 服务。
- 注意：`packages/app-shell/src/electron-main.ts` **本次未改动**（该文件有其他人在改），helper-tool.ts 目前是独立模块，待接线。

### Spike 9 — 本地回环：部分完成

- 复现：`node spikes/spike-09-loopback/run.mjs` → **exit=0**
- 实测：`{ready:true, pong:true, rttMs:0.416, exitCode:0, pass:true}`（复跑 3 次：0.369 / 0.417 / 0.416ms）。
- **缺口**：ADR 要求「无网络环境下 Electron 主进程 → 记忆子进程 → dsh 实例通信」；
  本脚本只覆盖 Node 主进程 ↔ 单个 Node 子进程的 IPC 回环与退出，**三段链路、无网络环境、Electron 运行时均未验证**。

### Spike 10 — 跨设备同步：部分完成

- 复现：`node spikes/spike-10-sync/run.mjs` → **exit=0**
- 实测：A→B 互通 true、B→A 互通 true；incognito 远程执行前后本地文件数 `0 → 0`、`zeroTrace=true`；
  `become_duty` 在非创建者节点被拒（不变量 11）。
- **缺口**：同机两个 Node 进程 + 共享目录模拟，**不是两台真机**；真实网络、时钟偏差、并发冲突、离线重连均未覆盖。

---

## 三、修订说明（哪些从「声称通过」改成了什么、依据是什么）

| # | 旧版（无证据的叙述） | 本次判定 | 依据 / 原因 |
|---|---|---|---|
| 1 | 部分通过（`@deepseek-ai/dsh` 0.1.5-rc.1 可加载；node-pty prebuild 可用；5 平台待 CI） | **部分完成** | 复跑 `result.json` 证实 dsh/node-pty/**koffi 3.3.0** 均可加载；5 平台依旧 0/5，缺口未变 |
| 2 | **通过**（hash P95 37.6ms→0.11ms、FTS 40.0ms→0.08ms） | **完成**（数字重测，规模修正为 10 万条） | 旧数字无任何原始输出；旧脚本只灌 1 万条却对 ADR 的 10 万条口径宣称达标。本次按 1 万/10 万两档重测并落盘；per-query fork 对照组未复测，不再作为结论引用 |
| 3 | **架构通过**（hit 稳定 128 tokens；均值 0.078 vs 0.42） | **未验证** | 无 API key，脚本 exit=3；旧数字在仓库中找不到任何原始输出；且旧脚本 10 轮/第 5 轮注入，与 ADR 的 50 轮/第 25 轮不符 |
| 4 | **通过（25/25，2 字词 100%）** | **完成**（结论不变，补证据） | 复跑 `result.json`：25/25、2 字词 7/7；旧版结论正确，但同样缺原始输出 |
| 5 | **通过（安装 + 运行时 profile 合并）** | **未实现（未复现）** | 复跑 exit=1；`dsh-memory-bundle` bundle 解析失败，`--dump-config` exit=1，`bothMounted=false`；旧版无 dump-config 原始输出 |
| 6 | **通过**（`deepseek-v4-pro` 可用、`deepseek-pro` 400、现网 models 列表 …） | **未验证** | 旧仓**根本没有** spike-06 目录/脚本/调用记录（源码级搜索无任何实现）。本次新建真实脚本；本机无 key → 明确记「未能验证」；仅拿到匿名 401（端点可达） |
| 7 | **通过**（webgpu 162ms/6.6/8.0；wasm-simd 37ms/6.5/**9.2**） | **完成**（WASM SIMD 路径） | 3 次复跑的 P95 全部落在 8.19~8.92ms（wasm-simd 8.228 / 8.291 / 8.92）；并明确 "webgpu" 行是 wasm 静默降级，**不是** WebGPU 证据 |
| 8 | **通过**（v2.6.1，hosts 提权写入成功，已清缓存） | **部分完成** | 旧仓无任何 gsudo/SMAppService 实现（只命中 ADR 与 RESULTS 的文字）。本次写了真实 L5 实现并**真实复现**了 Windows hosts 提权写入与还原（57/57 检查）；macOS SMAppService 仍无验证 |
| 9 | **通过（RTT 0.34ms）** | **部分完成** | 3 次复跑 RTT 0.369~0.417ms / exitCode 0，但只覆盖两进程回环，ADR 的三段链路与「停止后进程树归零」的完整口径未测 |
| 10 | **通过**（A↔B 互通、incognito 零痕迹、become_duty 拒绝） | **部分完成** | 四项断言全部复现为 true，但**同机双进程**模拟 ≠ 两节点真机；旧版与新版的证据都只支持「协议形状可行」 |
| 总览 | 10 项中 9 项「通过」 | **2 完成（2、4）/ 4 部分完成（1、8、9、10）/ 2 未验证（3、6）/ 1 未实现·未复现（5）** | 见上表：只有 Spike 2、4 的 DoD 被完整验证 |

**旧版「架构决策（Spike 确认）」的处置**（避免把无证据结论继续传递）：

| 旧结论 | 处置 |
|---|---|
| Node 24 LTS + pnpm workspace | **保留**（本机实际运行环境，非 Spike 结论） |
| L2 = 长驻 memory child process | **保留**（Spike 2 有原始数据支撑） |
| FTS5 CJK 双侧插空格 + 短语 MATCH | **保留**（Spike 4 有原始数据支撑） |
| Windows Helper = gsudo | **保留但加约束**：必须按 Spike 8 的 6 条踩坑实现（非交互 + 标记文件 + 回读校验 + 重试） |
| Provider 抽象必需 / CacheUsage 统一字段 | **保留为设计取向**（Spike 3 未验证，缓存指标的跨厂差异未实测） |
| in-history 更新写 JSONL 追加、禁止重写 system 前缀 | **降级为待验证假设**（Spike 3 无数据） |
| memory-plus 源仓库以 GitHub 搜索为准 | **保留**（与 Spike 5 的失败无关，但共存结论已作废） |
| Provider 三协议（P1 已落地） | 超出 P0 范围，本次未复核 |

---

## 四、本机不具备的验证条件（因此这些项只能记「未验证」）

| 缺口 | 影响的 Spike | 原因 |
|---|---|---|
| 无任何 API key（`DEEPSEEK_API_KEY` 等未设置、无 `.env`） | 3、6 | 无法发起鉴权请求；脚本已做到「无凭据→明确跳过」而不是假通过 |
| 无 macOS 环境 | 8（macOS 分支） | `SMAppService` 只能在 macOS 上由已签名 helper 验证 |
| 无 5 平台 CI / 无跨平台打包产物 | 1 | 需要 Linux/macOS/arm64 机器或 CI |
| 无第二台真机 / 无真实网络拓扑 | 10 | 只能同机双进程 + 共享目录模拟 |
| 未启动 Electron 运行时 | 9、7（WebGPU） | 三段链路与 WebGPU 都需要 Electron 浏览器上下文 |
| 非管理员 | 8 | 已通过 `gsudo -n` 绕过（实测可提权），但「无缓存凭据时应干净失败」这一分支**本机无法触发**（本机 gsudo -n 恰好可直接提权） |

> 关于 hosts：探针行 `warmy-spike08.local` 写入后已移除，**当前 hosts 与本轮开始前的 sha256 完全一致**
> （`b27b9adf…`，2538 字节，CRLF）。备份目录 `spikes/spike-08-helper/backups/` 保留了两份备份副本
> （一份为原始 hosts，一份为含探针行的中间态），**含本机自定义 DNS 覆盖记录，注意不要外传**。

---

## 五、剩余待办（把 P0 真正做完需要什么）

1. **Spike 3 / 6**：拿到 DeepSeek API key 后各跑一次 `run.mjs`，把 `result.json` 提交进仓库（脚本已就绪，无需改代码）。
2. **Spike 5**：查清 `dsh plugin --profile … install` 对 memory-bundle 的正确装载方式（当前 bundle 解析失败），再判共存。
3. **Spike 1**：用 CI 在 5 平台跑同一脚本，输出各自的 `result.json`。
4. **Spike 9 / 7-WebGPU**：在 Electron 运行时里补测三段链路与 WebGPU 路径。
5. **Spike 8**：在 macOS 上实现并验证 `SMAppService` helper（含 macOS 26 `fullPath is nil` 复现）。
6. **Spike 10**：两台真机 + 真实网络（含时钟偏差、并发冲突用例）。
