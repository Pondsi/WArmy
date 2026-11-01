# 第 98 轮项目验收交接（10 牛马 × 5 项目 × 10 轮 × 连续 10 遍）

> 本文件只记录**这一项验收**：目标、环境、模型名单、项目编组、每轮断言、已修问题、
> 当前结果和重跑方法。产品功能交付见 [`HANDOFF-R98.md`](./HANDOFF-R98.md)。
> 更新规则：每完成一遍/每修一个问题就更新本文件，不攒到最后。

---

## 一、验收目标（用户原话拆解）

1. 把本机可用的供应商模型都加进应用。
2. 创建 10 只牛马，每只的默认模型**互不相同**。
3. 创建 5 个项目：原本要求 2 本机 + 3 虚拟机；没有可用虚拟机就按用户允许的兜底改为本机。
4. 每个项目加 5 只**不同**的牛马，并随机指定一只为值班者。
5. 在每个项目里模拟用户发 10 轮对话，逐轮核对：
   - 值班者能不能把任务交给其他牛马；
   - 其他牛马能不能真的完成（工具调用 + 产物落盘）；
   - 完成后值班者能不能得知情况（共享黑板/结论）；
   - 值班者能不能把其他牛马的结果汇报给用户；
   - 是否使用正确的项目知识库；
   - 上下文能不能正确压缩；
   - 提示词能不能正确压缩；
   - 对话内容是否记得、历史记录是否不丢。
6. 一旦异常就停下修复，修好后**从第 1 遍重新开始**，直到连续 10 遍 × 每遍 10 轮全部通过。

---

## 二、验收环境与数据

- 仓库：`<工作区>/WArmy`；Electron + TypeScript + 原生 JS 渲染层。
- 验收脚本：`dev/gates/verify-r98-ten-by-ten.mjs`。
- 每遍使用一个全新的临时 profile（`%TEMP%\warmy-r98-10x10-*`），
  通过 CDP 启动真实主进程 + 真实渲染层；`WARMY_AUTH_BYPASS=1` 跳过登录页。
- 密钥只从本地 key 文件读入，经 `providerKeySet` 写入 SecureKeyStore；
  **日志、交接文档、断言详情都不打印密钥**。
- 虚拟机兜底：本机装有 WSL（Ubuntu，已停止）和 Docker Desktop（已安装但未启动），
  但没有为项目准备/验证过可用的项目级容器运行时；按用户“无法使用就改本机”的兜底，
  本轮 5 个项目全部用 `devEnv:'host'`（本机）。这一点在“遗留边界”里如实列出。

### 2.1 供应商可用性盘点（2026-10-27）

| 供应商 | 结果 | 说明 |
|---|---|---|
| DeepSeek | **可用** | `/models` 返回 2 个：`deepseek-flash`、`deepseek-v4-pro`；工具循环稳定 |
| MiMo（token-plan） | **可用** | 2 个聊天模型：`mimo-v2.6-flash`、`mimo-v2.6-pro`；高并发偶发 500，已加重试 |
| NVIDIA | **部分可用** | 85 个模型列出；实测 `nemotron-3.5-lightning-30b-a3b`、`nemotron-3.5-bolt-e4b` 可用；`super-vl-120b` 单跑可用但在并发下会超时；`minimax-m3.1-flash` 会 429；大量模型对该账号返回 404/503 |
| Google（Gemini） | **额度用尽** | 35 个 generateContent 模型列出；实际调用返回 429「project has exceeded its monthly spending cap」；本轮不作为执行者 |
| OpenRouter | **仅免费模型可用** | 466 个模型列出；付费模型被 $0 月度额度挡住；17 个 `:free` 模型列出；实测 `recursive/flint-v1.0:free`、`dots-studio/dots-3-note-preview:free`、`nvidia/nemotron-3.5-lightning:free` 可跑工具循环 |
| Ollama（本机） | **可用** | 23 个聊天模型；3 个 27B q3 模型实测工具循环可跑，但并发加载会严重拖慢；9B 快但结论里会多报不存在的产物 |
| SambaNova | 不可用 | `/models` 可列，但聊天 401「Incorrect API key」 |
| SiliconFlow | 不可用 | 401 |
| Mistral | 不可用 | 网络请求失败 / key 不可用 |

> 结论：真正**稳定执行**的云模型是 DeepSeek 2 个 + MiMo 2 个 + NVIDIA 2 个；
> OpenRouter 免费模型和本机 27B 作为“有默认模型但设为纯调度”的成员，
> 避免免费额度/显存把 10 遍长跑拖垮。

### 2.2 10 只牛马与默认模型（互不相同）

| 牛马 | 默认模型 | 供应商 | 本轮角色 |
|---|---|---|---|
| 验收牛马-01 | `deepseek-flash` | DeepSeek | 执行者 |
| 验收牛马-02 | `deepseek-v4-pro` | DeepSeek | 执行者 |
| 验收牛马-03 | `mimo-v2.6-flash` | MiMo | 执行者 |
| 验收牛马-04 | `mimo-v2.6-pro` | MiMo | 执行者 |
| 验收牛马-05 | `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA | 执行者 |
| 验收牛马-06 | `nvidia/nemotron-3.5-bolt-e4b` | NVIDIA | 执行者 |
| 验收牛马-07 | `recursive/flint-v1.0:free` | OpenRouter | 纯调度（不实际调用，避免免费额度） |
| 验收牛马-08 | `qwen3.8-27b:iq3-128K` | Ollama | 纯调度（避免 27B 并发换入换出） |
| 验收牛马-09 | `Qwen3.8-27B-Uncensored:iq3_m-128K` | Ollama | 纯调度 |
| 验收牛马-10 | `batiai/qwen3.8-27b:iq3` | Ollama | 纯调度 |

> “纯调度”是产品已有的 `pureDispatcher` 能力：可以当值班者，但不被选为执行者。
> 这样 5 个项目仍然各有 5 只不同牛马、都能随机值班，同时每个项目稳定有 2 个执行者。

### 2.3 5 个项目的编组（每项目 5 只不同牛马）

| 项目 | 成员 | 纯调度 | 可执行成员 |
|---|---|---|---|
| 验收项目一（A） | n01 n02 n08 n03 n07 | n08 n07 | n01 n02 n03 |
| 验收项目二（B） | n02 n04 n05 n09 n01 | n09 n02 | n04 n05 n01 |
| 验收项目三（C） | n03 n05 n06 n10 n02 | n10 n02 | n03 n05 n06 |
| 验收项目四（D） | n04 n06 n07 n01 n03 | n04 n07 | n06 n01 n03 |
| 验收项目五（E） | n05 n07 n08 n01 n04 | n07 n08 | n05 n01 n04 |

值日规则：每轮在所有 5 只成员里轮换值班者；如果值班者本身是纯调度，
临时再指定 1 名可执行成员为纯调度，保证**每轮恰好 2 名执行者**（不是 1 个，也不是 3 个）。

---

## 三、每轮任务与断言（1817 条/遍）

### 3.1 每轮任务

- 第 1–10 轮：每只执行者各自创建一个文本文件，文件名由「项目ID、轮次、你的牛马名」三段组成；
  正文第一行写**项目记忆里的验收码**（用户消息故意不写它），第二行写本轮唯一标记，
  第三行写牛马名；完成后调用 `jiao_fu` 提交产物绝对路径。
- 第 4 轮额外在指令后拼 20,000+ 字“无关背景”，用于验证：
  - 原始输入 `yuanWenChars >= 20000`；
  - 任务 brief 被压到 ≤2000 字；
  - 进入执行者的提示 `promptChars <= 16000`；
  - 不是靠“整段塞给执行者”过关。
- 第 10 轮同样是正常任务；历史是否记住由“10 用户 + 10 回复落日志 + 重启后仍在”验证，
  不要求模型在文件里复述前 9 轮（那是工作区读写能力，不是对话记忆口径）。

### 3.2 每项目每轮的硬断言

- `ok:true`、`action:'dispatch'`、`dutyId` 与设定一致；
- `executorIds.length === 2` 且不包含值班者；
- 每个执行者都有蒸馏结果，且**全部无 error**（瞬时 429/5xx/fetch failed 允许原样重派，最多 3 次；
  重派次数会打印并计入汇总）；
- 每个执行者都有产物，产物文件真实存在；
- 至少一个产物含**项目验收码**（只存在于项目记忆，用户消息没有）；
- 至少一个产物含**本轮唯一标记**；
- 未核实产物（模型多报的路径）不得在回复里冒充真产物；
- 回复逐个包含执行者名字，并包含每个执行者的产物文件名；
- 任务黑板条数 ≥ 完成执行者数，已落盘条数 > 0；
- 每个执行者都有 `group.executor-context` 留痕，`promptChars <= 16000`；
- 每个执行者都有 `group.executor-done` 留痕，最后一次尝试无 error；
- 真的调用了 `write_file`/`edit_file`；
- 轮末值班态回到 `idle`；
- 用户消息与值班者回复都经 `chatLogAppend` 落主进程日志（与界面 `tuisongXiaoxi` 同一条路径）。

### 3.3 每遍结束的断言

- 5 个项目各 10 条用户消息 + 10 条回复，10 个轮次标记全部在历史里；
- 每项目工作区至少 10 个 txt，且 10 个轮次标记都还能找到；
- 提示词压缩：启动自检把超限的 `术`（8166→4104 ≤4200）和 `印象`（3362→2587 ≤2600）
  压回上限，`MUST-KEEP-*` 要点标记仍在，且没有 `prompt.still-over-cap`；
- 重启同一 profile：10 只牛马仍在、5 个项目成员仍在、每项目 10 问 10 答仍在，
  `chat.history.restore` 有记录（≥20 条）。

---

## 四、本轮为验收修掉的产品问题（都是真代码，不是门禁放水）

1. **执行者只换模型、不换供应商**（`orchestrator.ts` / `electron-main.ts`）
   - 以前 `executorConfig` 只返回 `model`，执行者沿用全局 provider 的 baseURL/key；
     跨供应商默认模型会把请求发到错误的服务商（400/401）。
   - 现在按模型反查所属供应商，连 `presetId/baseURL/apiKey/protocol` 一起交给执行者。
2. **Gemini 3 工具调用丢 thought_signature**（`providers/types.ts`、`base.ts`）
   - OpenAI 兼容响应里的 `extra_content.google.thought_signature` 被丢掉，
     第二轮工具调用必 400「Function call is missing a thought_signature」。
   - 现在 `GongJuDiaoYong.extra_content` 原样保存并回传。
3. **执行者调用没有上限，供应商卡住会无限占项目**（`executor.ts` / `orchestrator.ts`）
   - 增加 `timeoutMs`：云端 120s、本机 180s；单次调用失败按错误分类返回，不再挂死。
4. **429/5xx 一次就判执行者崩溃**（`providers/base.ts`）
   - `qingQiuJson` 对 429/5xx/网络错误做最多 6 次退避重试（尊重 `Retry-After`），
     401/400 这类配置错误仍然一次就报，不拿重试掩盖。
5. **模型写成功但 jiao_fu 漏填 chanWu 时被判“没产物”**（`executor.ts`）
   - 执行者记录真实 `write_file`/`edit_file` 且宿主核实存在的路径；
     交付里没写 chanWu 时用这些已核实路径兜底。
6. **模型多报的不存在产物会出现在值班者汇报里**（`executor.ts`）
   - `unverifiedArtifacts` 里的路径从面向用户结论中替换为「（未核实）」；
     裸文件名按独立词替换，避免把真产物 `…-01.txt` 里的 `01.txt` 一起改坏。
7. **10 只牛马起不来：实例上限按 CPU/2 夹到 8**（`runtime.ts`）
   - 16 核机器上限只有 8，第 9/10 只直接 `max instances reached`。
   - 改为按逻辑核数、夹在 1..16；实例只是轻量 Node stub，真正吃资源的是模型调用。
8. **启动提示词压缩跑在审计/知识库初始化之前**（`electron-main.ts`）
   - 压缩本身没有审计（验收看不见），溢出条目因 `!knowledge` 被直接丢掉（与文档承诺相反）。
   - 现在移到 `await yindao()` 之后；`prompt.compressed` 可查，溢出条目能进知识库。
9. **执行者上下文没有尺寸留痕**（`executor.ts` / `orchestrator.ts`）
   - 新增 `group.executor-context`：毯子字符数、裁剪/丢弃条数、brief 字数、
     **用户原话压缩前字数**、最终提示字数；验收据此判断上下文压缩是否真发生。
10. **执行者提示没有“别绕圈”的纪律**（`executor.ts`）
    - 明确：如果只是创建文件，直接 `write_file`，不要先 list_dir/read_file 绕圈；写完立刻交付。
11. **值班者汇报里的模型产物核实**（沿用 R48 黑板/蒸馏管线）
    - 保留 `unverifiedArtifacts` 审计；只是不再把假路径当交付物给用户看。

---

## 五、门禁与当前结果

```bash
# 单遍（先验证脚本）
WARMY_ACCEPT_RUNS=1 node dev/gates/verify-r98-ten-by-ten.mjs

# 连续 10 遍（失败即停；修好后从第 1 遍重跑）
WARMY_ACCEPT_RUNS=10 node dev/gates/verify-r98-ten-by-ten.mjs
```

- 单遍全绿（2026-10-27）：`ALL 1 RUNS PASS，共 1817 条断言，用时 767.3s`
  （轮时 85.2/53.3/81.0/81.5/101.9/63.4/92.7/41.7/61.7/97.7s，含每轮真实重派与重启验证）。
- 连续 10 遍尝试 1：`RUN 1/10 PASS（565.7s）`；
  第二遍 R4 命中 NVIDIA `fetch failed`，原样重派后结果已成功，但旧断言把第一次失败留痕也算红。
  已修正为**只核对最后一次尝试**（`p.finalTs`）。
- 连续 10 遍尝试 2：`RUN 1/10 PASS（1029.3s）`；第二遍进行到 R02 时按用户指示**主动停下**，
  不是产品失败，也不是验收失败。
- **当前状态（2026-10-27）**：用户要求先停下连续 10 遍，完成其余收尾；
  因此“连续 10 遍全部通过”这一项标记为**未完成（按用户指示暂停）**。
  单遍全绿已经拿到；脚本、修复和重跑命令都在，后续可随时续跑。

### 5.1 本次收尾回归（与验收并行完成）

| 门禁 | 结果 |
|---|---|
| `npm run build` | 通过（tsc + 语法 + 资产复制） |
| `verify-r98-onboarding` | **41/0**（连续 3 次；首次跑曾有 1 次启动时序抖动，随后 3 连绿） |
| `verify-r96-memory` | **16/0** |
| `verify-r78-auth-tour` | **35/0** |
| `verify-context-renderer` | **ALL PASS** |
| `verify-security` | **28/28**（修掉验收脚本里的本机 key 文件名/用户路径字面量） |
| `run-verify-22 --tier=fast` | **113 项次 · 0 红** |

### 5.1 已知外部波动（不是产品 bug，已用重试兜住）

- MiMo 在高并发下偶发 HTTP 500/503；
- NVIDIA 偶发 `fetch failed`/429/503；
- OpenRouter 免费模型偶发 429/502；
- 这些都被 `qingQiuJson` 退避重试 + 验收“原样重派最多 3 次”覆盖；
  每次重派都会打印 `供应商瞬时故障，重派 n/3`，不会被静默吞掉。

---

## 六、遗留边界（需要你知道）

1. **5 个项目全部是本机 project**：WSL Ubuntu 和 Docker Desktop 都在本机存在但处于停止状态，
   也没有为项目准备/验证过项目级容器运行时；按用户兜底用了 `devEnv:'host'`。
   如果要求“3 个项目必须跑在虚拟机/容器里”，需要另做一轮容器项目验收（启动 WSL/Docker、
   设置项目容器、确认工作区映射后再跑），不影响本轮已通过的本机编排/知识库/压缩/历史口径。
2. **本轮实际执行者是 6 个云模型**（DeepSeek 2、MiMo 2、NVIDIA 2）；
   另外 4 只牛马（OpenRouter 免费 1、本机 27B 3）有独立默认模型，但设为纯调度，
   不参与执行。原因：免费额度/27B 并发显存会把 10 遍长跑拖垮；
   它们各自的工具循环已单独实测可用（见 2.1）。
3. **Google 额度用尽**：35 个模型已写进供应商清单，但月度额度为 0，实际调用 429；
   本轮不作为执行者，避免把“额度不足”误判成编排失败。
4. **未核实产物**：模型偶尔会多报一个不存在的路径；产品现在把它从用户可见结论里
   替换成「（未核实）」，并在审计里保留 `unverifiedArtifacts`，不静默丢弃。

---

## 七、变更文件清单（本项验收相关）

- `packages/app-shell/src/runtime.ts`：实例上限 1..16（按逻辑核数）。
- `packages/app-shell/src/executor.ts`：执行者超时、真实产物兜底、未核实产物脱敏、
  上下文尺寸审计、创建文件纪律。
- `packages/app-shell/src/orchestrator.ts`：执行者按模型路由供应商、超时与上下文审计透传、
  用户原话压缩前字数。
- `packages/app-shell/src/electron-main.ts`：`executorConfig` 反查供应商、提示词压缩移到
  `yindao()` 之后。
- `packages/providers/src/types.ts`：`GongJuDiaoYong.extra_content`。
- `packages/providers/src/base.ts`：保留/回传 `extra_content`；429/5xx 退避重试。
- `packages/providers/src/openai.ts`：流式工具调用保留 `extra_content`（与非流式同源）。
- `dev/gates/verify-r98-ten-by-ten.mjs`：本验收脚本。
- 本文件。

---

## 八、下一步（按顺序）

1. **连续 10 遍**：已按用户指示暂停；恢复时直接跑
   `WARMY_ACCEPT_RUNS=10 node dev/gates/verify-r98-ten-by-ten.mjs`。
   失败会停并保留 profile/dump；修好后从第 1 遍重跑。
2. 全部通过后：再跑一次 fast 全量（本轮已 green 113/0）。
3. 备份并删除真实 profile（`%APPDATA%\@warmy\app-shell` → `%TEMP%\warmy-profile-before-r98-final.zip`）。
4. 以首启状态重新启动应用，交给用户从语言页验收。
5. 清理验收临时 profile（`%TEMP%\warmy-r98-10x10-*`、失败 dump、临时 probe 脚本），
   不碰用户已有文件。

> 2026-10-27 收尾时：第 3–5 步已按用户“删除配置、首启验收”的要求执行：
> 真实 profile 备份到 `%TEMP%\warmy-profile-before-r98-final.zip`（107,998 字节）后删除；
> 首启已复核（语言页、10 种语言、旧引导 0、无渲染层异常）。第 1 步保持暂停状态。
> 具体见 [`HANDOFF-R98.md`](./HANDOFF-R98.md) 的交付状态。
