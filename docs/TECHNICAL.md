# WArmy（无限牛马）技术文档

> 面向：继续开发本项目的工程师 / 协作 AI / 代码评审。  
> 目标：读完后能**看懂每个关键模块在做什么、变量为何这样命名、改哪里会破坏什么、如何用门禁证明没改坏**。  
> 产品需求与理念见 [`docs/REQUIREMENTS.md`](./REQUIREMENTS.md)。历史论证见 `docs/ADR/*`。

---

## 0. 如何接手这个仓库（10 分钟路径）

```text
1. 读 docs/REQUIREMENTS.md（目标/理念/禁止事项）
2. 读本文 §1 架构总览 + §2 目录地图
3. 读 docs/API-OPERATIONS.md（对外 IPC）
4. 打开 packages/app-shell/src/electron-main.ts（主进程总装）
5. 打开 packages/app-shell/src/renderer/app.js + index.html（UI）
6. 跑门禁：见 §9
7. 改任何品牌/端口/环境变量前先读 §3 命名规范
```

**运行 UI（物理机）**

```powershell
# 推荐：分离启动（勿在非交互 shell 里 wscript 长驻）
$env:MIMO_PYTHON  # 或系统 python
python scripts 风格：
  electron.exe packages/app-shell/dist/electron-main.js
# 环境变量建议：
#   WARMY_UPDATE_FEED_URL=https://api.github.com/repos/Pondsi/WArmy/releases/latest
# 必须 unset ELECTRON_RUN_AS_NODE
```

仓库根：`C:\Users\p\.openclaw\workspace\大龙虾互动区\WARMY`（本地目录历史名可为 CCArmy，remote 为 WArmy）。

---

## 1. 架构总览（六层，与 ADR 000 对齐）

```text
L6 发布     electron-builder / feed/latest.json / GitHub Releases / checksums
L5 Shell    packages/app-shell  — Electron 主进程 + 渲染层 + preload + 设置 + 安全
L4 实例     InstanceManager / runtime.ts — child_process.spawn(捆绑 Node) × N
L3 编排     GroupChatRouter / orchestrator.ts — 值班状态机、队列、门禁注入
L2 记忆     packages/memory-os — JSONL 唯一事实 + SQLite FTS 投影 + recall/retrieve
L1 模型/容器 providers / container-probe / dsh 进程
```

**包地图（pnpm workspace）**

| 包 | 职责 |
|----|------|
| `packages/app-shell` | 桌面壳：IPC、UI、设置、组、身份、容器探测、更新 |
| `packages/board` | 看板事件与任务树（parentId + 进度聚合） |
| `packages/memory-os` | 记忆服务与 IPC 子进程入口 |
| `packages/sync-protocol` | 组网握手/DHT/宣告/存活（线协议常量勿改名） |
| `packages/group-router` | 群路由/队列语义 |
| `packages/knowledge-base` | 实体/事件知识库 |
| `packages/contracts` 等 | 契约与其它共享模块 |

---

## 2. 关键代码路径（每个文件在做什么）

### 2.1 主进程 `packages/app-shell/src/electron-main.ts`

**含义**：Electron 主进程总装文件。几乎所有 `warmy:*` IPC 都在这里 `handleIpc` 注册。

| 符号 | 含义 |
|------|------|
| `win` | 主窗口；窗口几何读写 `userData/window-state.json` |
| `chatLogs` | `Map<sessionId, LogEntry[]>` 内存中的会话日志镜像（seq 单调） |
| `groupStore` | 项目/群持久化 `groups.json`（含 `project.memory`、`gateVerify`） |
| `router` | `GroupChatRouter`：值班编排与队列；`persistRouterQueues` 落盘 |
| `aiQuestions` | `AiQuestionHub` 决策卡 |
| `memory` | `MemoryClient` → 记忆子进程 |
| `archiver` / `cleanup` | 归档与清理 |
| `gateVerifyForProjectType()` | 按项目类型选默认验收脚本 |
| `runProjectGateOnce()` | 门禁执行（3s 节流，仅 complete/验收触发） |
| `WARMY_*` 常量引用 | 端口、节点路径等，来自 settings-store |

**创建群时必做**：`setProjectAttrsOf` 写入 `devEnv?`、`directory?`、**`gateVerify`（始终）**。

**会话摘要 IPC** `warmy:session-summary`：

1. 取 `chatLogs` 最近 30 条 → 文本  
2. `extractStructuredSummary` → decisions/todos/risks/bullets  
3. 组装 Markdown 摘要  
4. `archiver.archive` 带 **`structured` + anchors（最近日志 seq）**  
5. `extractKnowledgeFromArchive` → 知识库实体/事件 + 用户偏好  

### 2.2 归档提炼 `archive-cleanup.ts`

| 导出 | 含义 |
|------|------|
| `KnowledgeArchiver` | 追加写 `userData/archive/archives.jsonl`；条目可含 `structured` |
| `CleanupManager` | 检查点/审计/语音清理（有界） |
| `extractStructuredSummary` | 规则匹配：决定/待办/风险/要点；**不调用 LLM、不编造** |
| `extractKnowledgeFromArchive` | 摘要 → 实体/事件（含结构化事件）+ 偏好正则 |
| `mergeUserPreferences` | 写 `userData/user-preferences.json`（按 key 覆盖，最多约 200 条） |
| `ArchiveEntry.structured?` | `{bullets,decisions,todos,risks}` |

### 2.3 设置 `settings-store.ts`

| 导出常量 | 值 | 含义 |
|----------|----|------|
| `WARMY_DEFAULT_NET_PORT` | 59599 | 生产默认组网 TCP 口 |
| `WARMY_DEV_NET_PORT` | 58588 | 开发**约定**（不限制用户） |
| `WARMY_TEST_NET_PORT` | 62666 | 测试约定 |
| `WARMY_SUGGESTED_NET_PORTS` | 见源码 | 绑定失败时的**建议池**，非自动回退链 |
| `SKILL_SCAN_DIRS_MAX` | 10 | 技能扫描目录上限 |

**产品铁律**：绑定失败 → 报错告知端口与底层错误；**绝不**自动改端口。

### 2.4 上下文渲染 `context-renderer.ts` / `orchestrator.ts`

- `renderBoundedView(log, opts)`：产出注入模型的消息数组；**断言**视图不超过预算。  
- 中间省略 → 指针文案，可用 memory `retrieve` 取回。  
- `orchestrator`：注入 `projectMemory`（≤1200 字）、`decisionContext`、工具结果、门禁原因；`runWithContextRetry` 按 100/60/35/20% 重试。

### 2.5 记忆 `memory-client.ts` + `packages/memory-os`

- 真相：`fast-memory.jsonl` 只追加。  
- 投影：SQLite FTS（uni + tri）可重建。  
- 环境目录：`WARMY_MEMORY_DIR`。  
- 双刀：`recall` 发现 → `retrieve` 取回。

### 2.6 渲染层

| 文件 | 含义 |
|------|------|
| `renderer/index.html` | DOM 骨架；**必须** `link app.css` 且 `link renderer.css` |
| `renderer/app.css` | 基础组件样式（先加载） |
| `renderer/renderer.css` | 产品覆盖层（后加载，**会覆盖 app.css**） |
| `renderer/app.js` | UI 逻辑：导航、聊天懒加载、右栏分区、摘要、技能、模型… |
| `renderer/preload.cjs` | `window.warmy.*` 白名单桥 |

**右栏分区 `applyPanelPartition(kind)`**：

- `work` = single/internal → 项目状态、文件、进度、模型、目录  
- `chat` = external* → 知识库、摘要  
- **internal 项目也显示** 知识库 + 摘要（`kind === 'internal' || chat`）  
- 成员栏：internal / external* 仅此  

**摘要面板 `renderPanelSummary`**：

- `archiveList(gid)` → 最新条目 `structured` 优先分区展示  
- 行按钮 `data-jump-st` / `data-jump-archive`：searchMessages → 打开会话；无命中也打开当前会话  

**输入区 composer（产品已定稿）**：

- 整块 `.composer-main` 外框；`#input` **无内边框**（焦点与否都无「输入框与按钮之间的线」）  
- `#input` `min-height: 96px`（更大）  
- `.composer-bar` `margin-top: 0`、无 border（按钮贴近输入区）  
- `renderer.css` 必须与 `app.css` 一致，否则后加载覆盖回旧样式  

### 2.7 组网 `net-wiring.ts` / `packages/sync-protocol`

- 默认口 59599；建议池来自 `WARMY_SUGGESTED_NET_PORTS`。  
- 线协议：`CCARMY-HELLO/1`、`CCARMY-HS1/HS2`、`CCARMY-LAN/1`、`CCARMY-RELAY-*-MARKER` — **禁止改名**（破坏兼容）。  
- 身份：Ed25519；成员证书；换证横幅需旧快照。

### 2.8 容器 `container-probe.ts`

- 12 候选运行时；平台不适用要说明而不是报未安装。  
- Docker CLI 在、引擎未跑 ⇒ `installed-not-running` + 真实 pipe 错误作 evidence。  
- 启停失败原因码：`install-incomplete` / `engine-start-failed` / `engine-stop-failed` / `no-exit-code`…  
- 控制台白名单字段：`runtimeId, action, sessionId, data`。

---

## 3. 命名规范（必须遵守；门禁 `verify-naming.mjs`）

### 3.1 为什么有两套名字

| 层 | 名字 | 原因 |
|----|------|------|
| 用户可见品牌 | **WArmy** / 无限牛马… | 产品对外身份 |
| 代码与环境变量 | **WARMY_*** | 与品牌区分，稳定、可 grep、无空格 |
| 线协议 | **CCARMY-*** 保持 | 已部署兼容性；改名 = 破坏性协议变更 |

### 3.2 环境变量一览（代码里出现的权威名）

| 变量 | 含义 | 备注 |
|------|------|------|
| `WARMY_MEMORY_DIR` | 记忆数据目录 | 优先 |
| `CCA_ARMY_MEMORY_DIR` | 旧记忆目录 | **仅 legacy 读取** |
| `WARMY_NODE` | 捆绑/覆盖 Node 路径 | 优先 |
| `CCARM_NODE` | 旧 Node 环境变量 | **仅 legacy 读取** |
| `WARMY_UPDATE_FEED_URL` | 更新源覆盖 | 与 settings.updateFeedUrl 合并 |
| `WARMY_INSTANCE_ID` / `WARMY_WORKSPACE` | 实例注入 env | runtime.ts |
| `WARMY_ALLOW_PLAINTEXT_KEYS=1` | 开发允许明文密钥 | 生产禁用 |
| `WARMY_PUSHER_ROLE` / `WARMY_PUSHER_ID` | git pre-receive 角色 | repo-guard |
| `WARMY_GUARD_ASSUME_FF` | 守卫放宽快进 | 默认不设 = fail-closed |
| `WARMY_UI_CDP_PORT` 等 | 测试/截图脚本端口 | 仅脚本 |

### 3.3 代码标识符约定

| 类别 | 约定 | 示例 |
|------|------|------|
| 导出常量（模块级） | `WARMY_` + SCREAMING_SNAKE | `WARMY_DEFAULT_NET_PORT` |
| TypeScript 局部/函数 | camelCase | `gateVerifyForProjectType` |
| 类型/接口 | PascalCase | `ArchiveEntry` |
| 源文件名 | kebab-case | `archive-cleanup.ts`、`memory-client.ts` |
| IPC 通道 | `warmy:` + kebab-case | `warmy:session-summary` |
| preload API | `warmy.<camelCase>` | `warmy.sessionSummary`（以 preload 实际为准） |
| i18n 键 | `namespace.camelCase` | `panel.summary.decisions` |
| CSS 类 | kebab-case | `composer-bar`、`panel-summary-box` |
| DOM id | kebab-case | `#btn-send`、`#panel-col` |
| 测试/门禁脚本 | `verify-*.mjs` | `verify-naming.mjs` |

### 3.4 禁止与例外

**禁止在业务代码中**：

- 新增 `CCArmy` / `Corporate Cattle` 产品称呼  
- 新增 `CCAARMY_*` 端口/环境变量  
- 把 IPC 写成非 `warmy:` 前缀  
- 引入 `WARMY_PORT_FALLBACK` 一类「静默回退」语义常量  

**允许例外**：

1. 线协议字符串 `CCARMY-*`（sync-protocol）  
2. legacy env **读取回退**：`CCARM_NODE`、`CCA_ARMY_MEMORY_DIR`  
3. 门禁脚本里**断言不存在**的正则（verify-docs / ui-inspect / verify-naming）

### 3.5 代码内注释应说明什么（交接标准）

新代码注释只写 **WHY**（约束、不变量、踩坑），不写复述代码的 WHAT。  
对外文档（本文/REQUIREMENTS）解释模块职责与数据流。

---

## 4. 数据落盘一览（知道每个文件的意思）

| 路径（相对 `userData`） | 写入者 | 含义 |
|-------------------------|--------|------|
| `groups.json` | group-store | 群/项目；`project.memory`、`gateVerify`、成员 |
| `settings.json` | settings-store | 语言、主题、端口偏好、updateFeedUrl、列宽… |
| `window-state.json` | electron-main | 窗口位置尺寸 |
| `router-queues.json` | router 回调 | 值班队列持久化（进程退出不丢） |
| `ui-queues.json` | IPC | 渲染层待执行队列 |
| `memory/fast-memory.jsonl` 等 | memory-os | 记忆真相 |
| `knowledge/knowledge.json` | knowledge | 实体/事件 |
| `archive/archives.jsonl` | archiver | 摘要+锚点+structured |
| `user-preferences.json` | mergeUserPreferences | 使用者行为偏好 |
| `audit/audit.jsonl` | audit | 审计，**不上传** |
| `permissions/allowlist.json` | SecurityManager | 持久允许库 |
| `checkpoints/` | checkpoint | 回退点 |
| `secure-keys`（SafeStorage） | secure-keys | API Key |

---

## 5. IPC 面（开发时怎么接）

- 注册：`handleIpc('warmy:xxx', handler)` 于 `electron-main.ts`。  
- 渲染：`preload.cjs` 暴露 `window.warmy.xxx`。  
- 形参与实测：`docs/API-OPERATIONS.md` + `docs/API-OPERATIONS-RESULTS.json`。  
- 写操作：优先 `withReadBack`；**confident=false 不得提示已保存**。

常用通道（节选）：

| 通道 | 作用 |
|------|------|
| `warmy:chat-send` | 发消息 |
| `warmy:group-create/list` | 项目/群 |
| `warmy:project-memory-get/set` | 项目记忆 |
| `warmy:session-summary` | 结构化摘要 |
| `warmy:archive-external/list` | 归档 |
| `warmy:ai-question-*` | 决策卡 |
| `warmy:memory-*` | 记忆状态/检索/重建 |
| `warmy:lan-start` / `warmy:mesh-start` | 组网（默认口 59599） |
| `warmy:settings-get/save` | 设置 |

---

## 6. 关键算法与产品语义（代码背后的意思）

### 6.1 有界上下文

```text
JSONL 全量（UI 可见）
    ↓ renderBoundedView(budget)
[头若干条] + system 指针(已省略 seq a..b) + [尾若干条]
    ↓ + projectMemory(≤1200) + 工具/决策上下文
模型
失败重试 budget: 100% → 60% → 35% → 20% → 诚实失败
```

### 6.2 gateVerify

```text
消息/看板 complete 或含 验收|门禁|verify|gate
    → 同项目距上次 < 3s？ 跳过
    → gateVerify[] 为空？ 跳过
    → 顺序执行脚本，结果写 gateLast
```

### 6.3 结构化摘要（非 LLM）

```text
逐行匹配前缀/关键词：
  决定|定稿|结论|decision|decided → decisions
  待办|todo|next|下一步 → todos
  风险|注意|警告|risk|warning → risks
  其它 → bullets（最多约 8 条）
窗口：最近约 80 行；单条截断 160–200 字
```

### 6.4 容器项目状态对成员的语义

```text
devEnv=host     → developmentAllowed=true（与容器无关）
devEnv=container
  engine ready  → 可开发
  not ready/stopped → code 对外=创建者下线语义；historyReadable=true
禁止新造第三种对外状态
```

---

## 7. 安全相关实现要点

- 主/渲染零 `.node`；密码学与重型 IO 在子进程/捆绑 Node。  
- 容器 exec / 控制台：白名单 id+action；无任意 shell 字符串参数。  
- 远程 AI：incognito；工具回创建者设备；本地不留会话痕迹。  
- 密钥：SafeStorage；审计可清；凭据不进 git。  
- 仓库守卫：成员 ref 命名空间；fail-closed。

---

## 8. UI/样式约定

1. **双 CSS 加载**：`index.html` 必须 `app.css` 然后 `renderer.css`。改覆盖层时两处语义要一致。  
2. **输入区**：无「输入框–按钮」分隔线；输入区更高；bar 更贴。  
3. **列表列水印**：`logo-color.svg` + 品牌；logo 本身背景透明。  
4. **诊断流**：右栏 `#console-pane`；容器终端用控制台按钮。  
5. **列宽**：list 默认 **160**（最小可读）、panel 300，`bindResizer persistKey` 持久化。  
6. **焦点**：composer 聚焦不改变边框颜色（产品要求）。  
7. **独立会话窗**（`warmy:open-chat-window`）：  
   - 查询参数强制 `mode=sub` + `chatId`  
   - 渲染层 `body.chat-window`：隐藏 rail/list/空状态，**只保留聊天列 + 右栏**  
   - **不隐藏** `#titlebar`（无边框窗口靠它 `-webkit-app-region: drag` 拖动与窗控）  
   - 主进程 `warmyWindowIcon()` + `BrowserWindow.icon`/`setIcon` + `app.setAppUserModelId('com.pondsi.warmy')`  
   - 门禁：`verify-chat-window.mjs`

---

## 9. 门禁体系（如何证明「没改坏」）

### 9.1 快速命令

```powershell
Set-Location C:\Users\p\.openclaw\workspace\大龙虾互动区\WARMY
$node = "C:\Program Files\nodejs\node.exe"

& $node packages/app-shell/scripts/verify-i18n-locales.mjs
& $node packages/app-shell/scripts/verify-docs.mjs
& $node packages/app-shell/scripts/verify-naming.mjs
& $node packages/app-shell/scripts/verify-summary-quality.mjs
& $node packages/app-shell/scripts/verify-planB.mjs
& $node packages/app-shell/scripts/verify-planD.mjs
& $node packages/app-shell/scripts/verify-warmy-features.mjs
& $node packages/app-shell/scripts/verify-memory.mjs
& $node packages/app-shell/scripts/verify-router-queue.mjs
& $node packages/app-shell/scripts/verify-wiring.mjs
& $node packages/app-shell/scripts/verify-e2e.mjs
& $node packages/app-shell/scripts/verify-container-probe.mjs
& $node packages/app-shell/scripts/verify-updater-github.mjs
& $node packages/sync-protocol/scripts/verify-all.mjs
# 连续 3 轮（需 CDP/真 UI 的项要已启动应用）：
& $env:MIMO_PYTHON "$env:TEMP\warmy-verify-rounds.py" 3
```

### 9.2 门禁与需求映射

| 门禁 | 守护的需求/技术点 |
|------|-------------------|
| verify-i18n-locales | 10 语键集、品牌、脚本字符集 |
| verify-docs | 发布规范、签名、必备文档、无 CCArmy |
| verify-naming | §3 命名规范、composer 无分隔线、双 CSS |
| verify-summary-quality | 结构化摘要、归档 structured、跳转、项目侧面板 |
| verify-planD/B | 记忆注入、gateVerify、决策卡、看板树 |
| verify-memory | WARMY_MEMORY_DIR、recall/retrieve 接线 |
| verify-router-queue | 队列不丢、可持久化 |
| verify-container-probe | 容器三态/诚实/固化/控制台白名单/17-4 noClaim |
| verify-wiring | 仓库守卫、角色、ref 命名空间 |
| verify-e2e | 主进程 boot、更新器、群恢复 |
| sync-protocol verify-all | 握手/DHT/宣告/存活 |

### 9.3 构建

```powershell
Set-Location packages\app-shell
& "C:\Program Files\nodejs\node.exe" "..\..\node_modules\typescript\bin\tsc" -b
& "C:\Program Files\nodejs\node.exe" scripts/check-syntax.mjs
& "C:\Program Files\nodejs\node.exe" scripts/copy-assets.mjs
```

`tsc` 不在 PATH 时必须走 `node_modules/typescript/bin/tsc`。

---

## 10. 已修复的关键缺陷（勿回归）

| 缺陷 | 现象 | 修复 |
|------|------|------|
| 只加载 app.css | renderer.css 全部失效 | index.html 双 link |
| 多余 `</div>` | 第一/第二列消失 | 删除多余闭合 |
| `CCAARMY_*` 端口名 | 与品牌/规范不符 | 改为 `WARMY_*` |
| i18n 脚本乱插 | JSON 损坏 | 行级插入 + json 校验 |
| e2e 期望 not-configured | 更新源默认已改 GitHub | 更新断言 |
| composer renderer.css 边框 | 输入框与按钮间有线 | border none + 贴近 + 更高输入区 |
| 摘要 structured 不落盘 | 右栏读不到 | ArchiveEntry.structured + IPC 写入 |
| gateVerify 仅 devEnv 分支才写 | 项目可能无门禁 | 创建时始终写入 |
| EN noClaim 缺 `will **not**` | probe 17-4 FAIL | 补齐 markdown 强调 |

---

## 11. 运行时环境与工具链

| 项 | 值 |
|----|-----|
| Node | `C:\Program Files\nodejs\node.exe` |
| Python | `$env:MIMO_PYTHON`（勿用 `python -c` 传中文复杂引号，写 .py 文件） |
| Electron | `packages/app-shell/node_modules/electron/dist/electron.exe` |
| 主入口 | `packages/app-shell/dist/electron-main.js` |
| GitHub 令牌 | 本地 `github的令牌.txt` 中 `ghp_` 段；**永不打印/入库** |
| 记忆全局 | `C:\Users\p\.local\share\mimocode\memory\global\MEMORY.md` |

**PowerShell 教训**：含中文/`${}`/嵌套引号的 `node -e`/`python -c` 极易失败 → 写脚本文件再执行。

**Electron 启动教训**：非交互 shell 下 `Start-Process`/`wscript` 可能挂起 → Python `Popen(DETACHED_PROCESS)` + `pop ELECTRON_RUN_AS_NODE`。

---

## 12. 继续开发规范（Checklist）

改功能前：

- [ ] 相关 REQUIREMENTS 条款是否覆盖？要不要先改文档？  
- [ ] 是否触碰命名（品牌/WARMY_/IPC/线协议）？  
- [ ] 是否破坏「不静默换端口 / 不双写 MEMORY / 容器诚实」等铁律？  

改代码时：

- [ ] 文件 kebab-case；常量规范；IPC `warmy:`  
- [ ] UI：双 CSS；真机可见  
- [ ] i18n：键同步 10 包；placeholder 一致  
- [ ] 写路径 read-back；错误不吞  

改完后：

- [ ] 相关 verify 全绿  
- [ ] 全量 3 轮（宣称完成时）  
- [ ] 更新 TECHNICAL/REQUIREMENTS/API-OPERATIONS  
- [ ] 签名提交并推送 GitHub  
- [ ] **打开物理机 UI**  
- [ ] 中文汇报：结果+证据+待协助+提醒+下一步  

---

## 13. 模块级「这段代码什么意思」速查

| 你想改… | 先看 | 注意 |
|---------|------|------|
| 聊天输入体验 | `renderer.css` composer、`app.css` composer、`index.html` footer | 两 CSS 一致 |
| 摘要内容质量 | `archive-cleanup.ts` extract* | 保持非 LLM、不编造 |
| 摘要 UI | `app.js` renderPanelSummary | structured + jump 回退 |
| 门禁默认 | `electron-main.ts` gateVerifyForProjectType | 创建时始终写入 |
| 组网端口 | `settings-store.ts` WARMY_* | 禁止 fallback |
| 更新源 | `updater.ts`、settings.updateFeedUrl、feed/latest.json | GitHub API + raw |
| 容器文案 | i18n `container.*` | 17-4/17-1 探针断言 |
| 多语言品牌 | i18n packs + verify-i18n EXPECTED_BRAND | 见 i18n-naming.md |
| 记忆检索 | memory-os + memory-client | JSONL 为真相 |
| 权限/审计 | secure-keys、audit、allowlist | 不上传 |
| 协议 | sync-protocol | **勿改 CCARMY-*** |

---

## 14. 与 ADR 的关系

| ADR | 内容 | 与本文关系 |
|-----|------|------------|
| 000 | 产品定稿、十一不变量、六层架构 | 总纲；实现以本文落地口径为准 |
| 001 | 手机端真实客户端 | 预览 `index.html`；桌面仍是主端 |
| 002 | 上下文有界渲染器 | §6.1；硬指标 view ≤ budget |
| 003 | 组网/身份/仓库协作 | §2.7；协议常量勿改名 |
| 004 | 容器运行环境 | §2.8 / 需求 §3.10；§七定稿优先 |

冲突时：**REQUIREMENTS 产品铁律 + TECHNICAL 落地口径 > ADR 过程描述**。

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
