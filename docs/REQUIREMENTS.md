# WArmy（无限牛马）完整需求文档

> 本文是**产品需求的单一权威入口**，面向：新加入的开发者、协作 AI、评审者、发布验收者。  
> 读完本文应能回答：这个产品是什么、为谁做、必须做到什么、绝对不能做什么、如何验收。  
> 技术实现细节见 [`docs/TECHNICAL.md`](./TECHNICAL.md)；历史决策过程见 `docs/ADR/*`（冲突时以本文 + TECHNICAL 的「定稿口径」为准）。

---

## 0. 项目目标与理念

### 0.1 一句话目标

做一个 **本地优先（local-first）** 的多智能体群聊桌面应用：用户养一队 AI「牛马/社畜」，在群聊里用人机混合协作完成真实工作；跨设备可组网协作；**注入模型的上下文有固定上限，但不丢失任何历史细节**。

### 0.2 产品理念（必须贯穿所有功能）

| # | 理念 | 含义 | 反例（禁止） |
|---|------|------|--------------|
| 1 | **诚实** | 状态、错误、能力边界如实展示；不假装成功 | 容器未就绪却在主机上开发并显示「正常」 |
| 2 | **有界上下文，细节不丢** | 注入模型的是日志的**有界视图**；原文 JSONL 永在，可检索回原文 | 把超长历史原样塞进模型，或静默丢消息 |
| 3 | **本地优先** | 默认不依赖云；数据在本机 userData；审计绝不上传 | 把聊天/密钥上传到第三方 |
| 4 | **用户主权** | 模型、成本、端口、权限由用户决定；系统只给框架与建议 | 静默换端口、静默扣费、静默授权 |
| 5 | **单一事实来源** | JSONL 只追加是唯一事实；SQLite/投影可丢弃重建 | 直接改写历史日志中间内容 |
| 6 | **写入者唯一** | 每类数据只有一个合法写入者 | 多处同时写 board/memory 导致分叉 |
| 7 | **防过度执行** | 门禁/脚本/固件有触发条件与节流，不「每次对话都跑全家桶」 | 每条消息都跑全部 verify |
| 8 | **可交接** | 文档、门禁、命名、IPC 形参可被外人读懂并复现 | 只有作者本机能跑通 |

### 0.3 核心承诺（验收总纲）

1. **注入上下文有固定上限**（预算可配），裁掉的部分变成指针，模型可用 `recall`/`retrieve` 取回。  
2. **UI 聊天区永远显示完整真实记录**（懒加载只是渲染性能手段，不是删数据）。  
3. **端口绑定失败绝不静默换端口**；只展示建议候选，由用户点选。  
4. **容器项目未就绪 = 对成员等同「创建者下线」**，历史仍可读；不新造第三种状态。  
5. **远程 AI 无痕执行**（incognito）：工具路由回创建者设备，远程设备本地零痕迹。  
6. **值班权仅限本机实例**；远程 AI 永不作为值班者。

---

## 1. 产品定位与命名

### 1.1 定位

基于 Electron 的桌面应用（零原生模块进主/渲染进程）。用户可：

- 管理多个 AI 实例（「牛马」/ Workhorses / 社畜）
- 创建**项目（内部群）**、**外部群聊**、**单 AI 会话**、联系人
- 由**值班者（duty）**编排任务，执行者干活，看板记录进展
- 可选容器开发、可选去中心化组网协作

### 1.2 产品命名（锁定；`verify-i18n-locales.mjs` 强制）

| 场景 | 取值 |
|------|------|
| GitHub 仓库 | `Pondsi/WArmy` |
| 非中/日/韩 `brand.name` / `app.enName` | **WArmy** |
| `brand.sub`（全名） | Workhorse Army |
| 英文标语 | An infinite army of AI workhorses working for you. |
| zh-CN 产品名 / 标语 | 无限牛马 / 让AI成为你的无限牛马 |
| zh-TW | 無限牛馬 / 讓AI成為你的無限牛馬 |
| ja | 無限社畜 / AIがあなたの社畜になって、無限に働きます。 |
| ko | 무한 사축 / AI가 당신 대신 사축처럼 일해줍니다. |
| 导航「我的牛马」 | zh 我的牛马 · ja マイ社畜たち · ko 일꾼들 · en **My Workhorses** |
| 作者署名 | Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop |

**禁止**：CCArmy、Corporate Cattle、把品牌写成 por（应为 **pro**）。

### 1.3 代码/环境变量命名（与品牌名区分）

| 类别 | 规范 | 示例 |
|------|------|------|
| 环境变量 / 导出常量 | `WARMY_` + SCREAMING_SNAKE | `WARMY_DEFAULT_NET_PORT`、`WARMY_MEMORY_DIR` |
| IPC 通道 | `warmy:` + kebab-case | `warmy:chat-send`、`warmy:project-memory-set` |
| 线协议标识 | **保持** `CCARMY-*` 不改 | `CCARMY-HELLO/1`、`CCARMY-HS1`（改了两端不兼容） |
| 旧环境变量 | 仅允许 **legacy 回退读取** | `CCARM_NODE`、`CCA_ARMY_MEMORY_DIR` |
| 用户可见品牌文案 | 见 §1.2 | WArmy / 无限牛马 |

门禁：`packages/app-shell/scripts/verify-naming.mjs`。

---

## 2. 用户与场景

| 角色 | 典型场景 |
|------|----------|
| 个人效率用户 | 本机多个牛马并行：写文档、改代码、查资料；值班编排，看板跟进 |
| 小团队协作者 | 项目创建者邀请成员（人/AI）入内部群；容器或主机开发；gateVerify 验收 |
| 外部沟通用户 | 外部群仅聊天 + 看板总结；AI **仅 @ 才响应** |
| 其他 AI / 自动化 | 读 `docs/API-OPERATIONS.md`，用 `window.warmy.*` / IPC 操作本产品 |

---

## 3. 功能需求（可验收）

### 3.1 多实例管理（我的牛马）

- 创建 / 启动 / 停止 / 删除多个 dsh 智能体实例。
- 每实例：独立名称、工作区、插件、会话、人格文件、认知注入（.md）、默认模型、回退链。
- 启动时按本机硬件给出**建议最大实例数**（用户可自行突破或降低）。
- 状态持久化；重启后可恢复。

**验收**：`listInstances`/`spawnInstance`/`stopInstance` IPC；UI「我的牛马」页可增删改。

### 3.2 会话类型

| 类型 | 内部代号 | AI 行为 | 远程 AI | 右栏 |
|------|----------|---------|---------|------|
| 项目（内部群） | `internal` | 值班编排 + 执行者完整工具 | 可加入，权限≈创建者 AI，无痕 | 状态/文件/进度/模型/目录/成员/**知识库+摘要** |
| 外部群 | `external` / `externalGroup` | **仅 @ 响应**，否则静默；仅聊天+看板 | 仅聊天，禁工具/文件/记忆 | 知识库+摘要+成员+模型 |
| 单 AI | `single` | 直接对话，完整能力 | — | 项目状态类面板；成员栏不显示 |
| 联系人 | `externalChat` | 人与人/人与远程 | — | 知识库+摘要；无成员栏 |

### 3.3 群聊与值班编排

- 群创建后按进群顺序编号。
- **值班者只在本机实例中产生**；远程 AI 永不值班。
- 非定向：序号最小的空闲值班者听取并编排；忙则 +1 顺延；可指定固定值班（忙则排队）；可设纯调度值班。
- 定向模式：用户必须 @ 实例；无值班编排。
- 指令插入三级：默认外循环后（queue）；可手动停止；可内循环插入（UI 警告）。
- 紧急度：P0 停止 / P1 立即插入（手动）/ P2 排队（默认）/ P3 自动兜底。**紧急度归用户**。

**验收**：Router 队列不丢弃且可持久化（`router-queues.json`）；`verify-router-queue.mjs`。

### 3.4 看板

- 用户**不能直接改看板**；只能自然语言 → 值班解析 → `board.jsonl`。
- 仅 duty 可写看板。
- 任务树：`新建任务 父任务 / 子任务`；父进度 = 子平均。
- 外部聚合看板只读；会话内嵌看板与聚合共用数据。

### 3.5 项目记忆（project.memory）

| | 项目 MEMORY | memory-os 流水 |
|--|-------------|----------------|
| 角色 | **当前有效**规矩/目标（覆盖式） | 会话/工具历史（JSONL 唯一事实） |
| 落点 | `groups.json` → `project.memory` | `userData/memory/fast-memory.jsonl` |
| 注入 | 值班上下文 `[项目记忆]`，**≤1200 字** | 有界视图 + recall/retrieve |
| 双写 | **禁止** | — |

IPC：`warmy:project-memory-get/set`（set 必须 read-back）。

### 3.6 上下文预算与超限

- UI 聊天 = 完整真实历史（懒加载窗口，默认约 20–40 条/次，可上滑加载）。
- 模型注入 = `renderBoundedView`：冻结头 + 最近尾部 + 中间指针。
- 预算：`contextBudgetPercent`（默认 60%）× 模型窗口；字符预算可配。
- 超限重试：**100% → 60% → 35% → 20%**，最小约 2048 tokens；仍失败则**如实**提示 `chat.contextTooSmall`。
- 群聊：滑块隐藏，后端自动收敛；联系人场景不适用同一套项目预算语义。

**模型窗口参考（MODEL_CTX_MAP）**：deepseek-chat/reasoner 65536；mimo-v2.5/pro 131072；qwen3.7-max 131072；qwen3.8-27b 32768；gpt-4o 128000；claude-3-5-sonnet 200000。可用 `settings.modelContextTokens` 覆盖。

### 3.7 知识库 / 归档 / 摘要

| 通道 | 路径/模型 | 职责 |
|------|-----------|------|
| 知识库 | `userData/knowledge/knowledge.json`：实体+事件+证据锚点 | 可检索结构化事实 |
| 归档 | `userData/archive/archives.jsonl`：title/summary/anchors/**structured** | 会话压成摘要+锚点 |
| 记忆流水 | memory-os JSONL + FTS（+可选向量） | 原文事实与检索 |
| 项目 MEMORY | groups.project.memory | 当前规矩 |

**触发整理**：

- 值班解析看板/会话事件 → knowledge upsert/addEvent  
- **归档** `warmy:archive-external` → 提炼实体/事件 + 使用者偏好 `user-preferences.json`  
- **会话摘要** `warmy:session-summary` → `extractStructuredSummary`（决策/待办/风险/要点，**不编造**）→ 归档条目带 `structured` + anchors（尽量带 seq）  
- 项目 MEMORY 保存 **不**自动进知识库（防双写）

**右栏**：项目与聊天都展示「本机知识库 + 摘要」；结构化区块可点击跳原文；归档条目「跳到原文」用 anchors，无锚点时回退用结构化文本/标题搜索。

**门禁**：`verify-summary-quality.mjs`。

### 3.8 gateVerify（项目验收门禁）

- 项目属性 `gateVerify: string[]`（相对仓库根，最多 4 条）。
- **仅**在：看板「完成」指令，或消息含 验收/门禁/verify/gate 时触发。
- 同项目 **3 秒节流**；空列表完全不跑。
- **创建项目时始终写入**默认值（`gateVerifyForProjectType`）：

| 类型 | 判定线索 | 默认脚本 |
|------|----------|----------|
| 文档类 | 名称/路径明确 docs/说明/spec/adr 且非代码仓 | `verify-docs.mjs` |
| 代码类 | packages/src、package.json、backend/frontend 等 | docs + i18n + `verify-router-queue.mjs` + `verify-memory.mjs` |
| 其他 | — | docs + i18n |

### 3.9 AI 决策卡与权限卡

- 同一通知区 `#notify-zone`（消息列表下方）。
- 决策卡：AI 工作中要人点选；**永远**附带「其他（自行输入）」；同群同标题 pending 去重。
- 权限卡：工具写盘/命令的 Allow once / project / global。
- 回答注入下一轮：`[人类决策] 问题 → 选项`。

### 3.10 容器开发环境

- 创建项目时可选 **容器开发 / 本机开发**；选择写入**项目记录**（成员可见），不是仅本机 settings。
- 探测：12 个候选运行时；三态：`ready` / `installed-not-running` / 未安装或「当前系统不适用」。
- **禁止**：CLI 在却报「未安装」；静默换端口；容器未就绪却假装主机开发。
- 停止容器项目 ⇒ 对成员效果 **等同创建者下线**；**historyReadable 恒为 true**。
- 固化/回滚：Docker/Podman 可 commit；节流合并；销毁前必固化一次；能力不支持则不提供会失败的按钮。
- **分层事实**：文件回退靠检查点，**不依赖容器**；禁止宣称「有容器回退点就更简单」（`container.snapshot.noClaim` 英文须含 `will **not**`）。
- AI 执行器在**宿主**；仅用户项目命令进容器。
- 控制台：仅聊天内 + 项目启用容器时可用；参数白名单 `{runtimeId,action,sessionId,data}`；拒绝任意 cmd 字符串。

**门禁**：`verify-container-probe.mjs`（161 项）。

### 3.11 组网 / 身份 / 协作（ADR 003）

- 设备即身份：Ed25519 指纹；邀请一次性、有时效、可撤销。
- 握手 HS1–HS4 + AES-GCM；DHT/宣告/存活见 `packages/sync-protocol`。
- 成员证书 + 吊销列表；换证需旧名片快照供熟人核实。
- 仓库协作：创建者/管理员/成员权限；**记录文件改动是产品功能**（项目级+成员可见），不是仅本机日志。
- 线协议常量 **不改名**（见 §1.3）。

### 3.12 更新与发布

- 更新源默认：`https://api.github.com/repos/Pondsi/WArmy/releases/latest`  
- 原始清单：`https://raw.githubusercontent.com/Pondsi/WARMY/main/feed/latest.json`（以仓库实际名为准，当前 **WArmy**）  
- 可设置 `settings.updateFeedUrl` 或环境变量 `WARMY_UPDATE_FEED_URL`。  
- 下载后校验 SHA-256；失败不得报成功。  
- 安装包资产名：`WArmy-Setup-0.1.0.exe`。

### 3.13 国际化

- 10 语言包，键集**必须相等**（当前 1617 键）：zh-CN, zh-TW, en-US, ja, ko, ru, es, fr, pt, eo。
- 禁止 `locale.startsWith('en') ? 'en-US' : 'zh-CN'` 双向塌缩。
- 拉丁语包除白名单外不得含 CJK；ja/ko/zh 不得含西里尔。
- 品牌/导航见 §1.2。
- 首次语言选择：仅 `settings.setupDone !== true` 时弹一次。

### 3.14 设置与 UI 结构

- 四栏：rail / list-col（默认 200px）/ main-col / panel-col（默认 300px）；宽度与窗口几何持久化。
- 第二列水印：`logo-color.svg` 约 168px、opacity 0.26 + 品牌字。
- 诊断事件流在**右栏 panel-col**（不是聊天顶栏）；控制台按钮 = 容器 shell。
- `index.html` **必须同时**加载 `app.css` 与 `renderer.css`（历史致命 bug）。
- 菜单中的「停止」已去掉（与头部停止按钮重复）。
- 编辑供应商：关闭添加模型弹窗前需确认。

### 3.15 记忆系统对外能力

- 环境：`WARMY_MEMORY_DIR`（legacy：`CCA_ARMY_MEMORY_DIR`）。
- 工具：`recall`（发现索引卡）/ `retrieve`（取回原文，三级回退）。
- IPC：memory status / rebuild / retrieve；About 页展示状态。

### 3.16 API 给其他 AI

- 权威文档：`docs/API-OPERATIONS.md`（形参 + 返回 + 实测表）。
- UI **不提供**试运行按钮；设置→快捷键可**一键复制** AI 指引。
- 产品约束见该文档 §产品约束（端口、容器、看板、MEMORY 单落点、UI 全量历史、更新源）。

---

## 4. 角色权限（摘要）

| 权限项 | 创建者 | 管理员 | 成员 | 外部群成员 |
|--------|--------|--------|------|------------|
| 解散群组 | ✅ | ❌ | ❌ | ❌ |
| 修改群设置 | ✅ | ✅ | ❌ | ❌ |
| 任命管理员 | ✅ | ❌ | ❌ | ❌ |
| 邀请成员 | ✅ | ✅ | ❌ | ❌ |
| 审批入群/工具 | ✅ | ✅ | ❌ | ❌ |
| 查看知识库 | ✅ | ✅ | ✅ | ❌ |
| 与值班对话 | ✅ | ✅ | ✅ | ✅ |
| 看板 | ✅ | ✅ | ✅ | 只读 |

外部群 AI：**仅 @ 响应**。

---

## 5. 安全机制需求

### 5.1 三级安全模式

| 维度 | 完全授权 | 常规（默认） | 严格 |
|------|----------|--------------|------|
| 脚本/工具/Skill 调用 | 无需审核 | 首次四选一（全局持久/项目持久/一次/拒绝） | 每次仅「允许一次」 |
| 脚本/工具/Skill 安装 | 无需审核 | 同上 | 每次仅一次 |
| 工作区内文件读写 | 自由 | 自由 | 自由 |
| 工作区外读 | 自由 | 自由 | 每次授权 |
| 工作区外写 | 自由 | 一次/24h/项目区/全局区 | 每次一次 |

- 持久允许库：`userData/permissions/allowlist.json`（可查看/撤销/导出）。
- 审计：`userData/audit/audit.jsonl`，**绝不上传**，用户可清空。
- 权限过滤**先于**相关性检索。
- 密钥：优先 SafeStorage；`WARMY_ALLOW_PLAINTEXT_KEYS=1` 仅开发，且打 `plain` 标记。

### 5.2 仓库守卫

- pre-receive：`WARMY_PUSHER_ROLE` / `WARMY_PUSHER_ID`；成员只能写 `refs/heads/members/<id>/**`；非法角色按最严 member；默认 fail-closed。

---

## 6. 非功能与环境约束

| 项 | 要求 |
|----|------|
| 端口 | 生产默认 **59599**；dev 约定 58588；test 约定 62666；建议池 `WARMY_SUGGESTED_NET_PORTS`；**禁止静默换端口** |
| Docker/WSL | 平时**不启动**；用完关控制台；需要时才启动引擎 |
| 性能 | 容器探测整轮 < 25s（本机约 5s）；聊天懒加载；记忆检索可用 |
| 零原生模块 | Electron 主/渲染不加载 `.node`；dsh/记忆用捆绑 Node 子进程 |
| 本地目录名 | 历史路径可能仍叫 CCArmy；**不影响**产品名 WArmy |
| 凭据 | 永不进仓库/报告/日志；令牌只在本地文件、提交时使用且不回显 |

---

## 7. 开发与发布流程要求（给继续开发的人）

1. **先读**本文 + `docs/TECHNICAL.md` + `docs/API-OPERATIONS.md` + 对应 ADR。  
2. **改代码前**用门禁脚本定位约束；改完跑相关 verify。  
3. **全量基线**（连续 3 轮全绿才可宣称完成）：  
   i18n · docs · features · memory · router · planB · planD · summary-quality · naming · ui-layout · container-probe · updater-github · wiring · e2e · protocol  
4. **UI 改动**：确认 `index.html` 同时引用 `app.css` + `renderer.css`；在真机打开界面。  
5. **i18n**：键集对齐；placeholder 一致；品牌/导航按表；`verify-i18n-locales.mjs`。  
6. **提交签名**必须使用 §1.2 署名行；**禁止**写入令牌明文。  
7. **产品原则变更**（端口、MEMORY 双写、门禁策略、容器语义）必须先改本文/TECHNICAL，再改代码。  
8. **自主开发纪律**（用户授权）：不问阻塞性问题，按本文决策；无法独立完成的记入 `docs/WSL-AND-PENDING.md`；完成后中文汇报 + 打开物理机 UI。

---

## 8. 验收清单（发布前）

- [ ] `verify-i18n-locales` 145/0（或当前键数全绿）  
- [ ] `verify-docs` 全绿（含 README/说明/签名/无 CCArmy）  
- [ ] `verify-naming` 全绿  
- [ ] `verify-summary-quality` 全绿  
- [ ] `verify-planB/D`、`verify-memory`、`verify-router-queue`、`verify-warmy-features` 全绿  
- [ ] `verify-container-probe` 161/0  
- [ ] `verify-wiring` 238/0；e2e 全过；protocol verify-all 失败脚本 0  
- [ ] GitHub 更新源实测：up-to-date / update-available  
- [ ] 物理主机 UI 已打开且无第一/二列消失、无 composer 分隔线  
- [ ] `docs/WSL-AND-PENDING.md` 更新待协助项  

---

## 9. 需要人工协助的项（不阻塞开发）

1. 双机 mesh / NAT 真环境验证  
2. 干净 Windows 试装 `WArmy-Setup-0.1.0.exe`  
3. GitHub Discussions 网页开启  
4. 可交互终端下的完整 `verify-net-ui`  
5. 授权后 Docker 启停耗时复测  

---

## 10. 相关文档索引

| 文档 | 内容 |
|------|------|
| `docs/TECHNICAL.md` | 架构、代码含义、命名、IPC、门禁、关键路径 |
| `docs/API-OPERATIONS.md` | 其他 AI/自动化操作接口 |
| `docs/CONTEXT-KNOWLEDGE-GATE.md` | 上下文/知识/gateVerify |
| `docs/WARMY-MEMORY-TASK-GATE.md` | 记忆/任务树/决策卡/门禁/read-back |
| `docs/i18n-naming.md` | 多语言产品名 |
| `docs/UPDATE-FEED.md` | 更新源 |
| `docs/WSL-AND-PENDING.md` | WSL 纪律与待协助 |
| `docs/ADR/*` | 历史决策与需求原文 |
| `说明.md` | 中文用户手册 |
| `references/ARCHITECTURE.md` | 架构摘要 |

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop


## 永远性要求：启动 / 使用本应用**不启动 WSL**

> 产品主定稿（两次反馈后成为永久要求）："启动这个应用不会启动 wsl"。

**为什么**：`wsl.exe` 的 `--version` / `-l -v` 在 Windows 上会把 WSL 服务拉起来。以前
"打开会话/新窗口 → 查项目状态 → 全量探测运行时"这条例行路径会顺手 spawn `wsl.exe`，
用户看到的现象就是"打开应用/新窗口触发了打开 WSL"。

**规则**：
1. **例行路径一律静默**：项目状态查询等自动探测**不许** spawn `wsl.exe`（`probeWsl` 在非 deep 时
   一个 wsl.exe 都不启动，如实报 `not-probed`，并在界面说明"只有显式点探测才会查"）。
2. **只有用户显式动作才允许查询**：设置 → 功能 → 容器 的「查看本机已有容器」按钮（IPC 传 `deep: true`）。
3. **即便显式查询，也不代为启动发行版**：`wsl -l -v` 里的 Stopped 就报 Stopped，不跑 `wsl -d <发行版> -- true`。
4. **实例列表**：引擎未启动时实例区禁用、不可展开（既有的产品规则）。

**门禁（永久，不许回退）**：`packages/app-shell/scripts/verify-no-wsl-start.mjs`
- 动态：启动应用 → 走真实路径选中会话 → 打开新窗口，断言 `wsl.exe`/`wslhost.exe` 进程数不变、
  各发行版状态不变；本机没有 WSL 时如实跳过动态部分（不假通过）。
- 静态：`probeWsl` 默认静默、项目状态查询不传 deep、只有显式探测才 deep。
- 已加入门禁列表（17 项之外的第 18 项）。
