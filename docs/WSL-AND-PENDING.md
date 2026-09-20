# WSL 使用纪律与待协助事项

## WSL

- **平时不启动 WSL**；只在容器/引擎真需要时启动。
- 用完必须关闭控制台窗口：`wsl --terminate docker-desktop` / `wsl --shutdown`。
- 不要把 WSL 控制台窗口留在桌面上。
- **"关窗口"不是"杀进程"**（产品主反复强调）：结束 `wsl.exe` / `bash` 进程并不会带走它的
  控制台窗口 —— 窗口属于 `conhost.exe`，会一直留在桌面上堆积。正确做法是**关掉窗口本身**
  （`CloseMainWindow()` / 用户手动关），或从一开始就**别让窗口出现**：任何派生子进程都必须
  带 `windowsHide: true`。

### 已修的根因（本轮）

桌面上堆积控制台窗口的真凶不是 WSL 本身，而是我们自己的三处子进程调用**没隐藏窗口**：

| 位置 | 症状 |
| --- | --- |
| `packages/app-shell/src/runtime.ts` 实例 spawn | 每个「牛马实例」多一个控制台窗口，实例被杀后窗口仍留着 |
| `runtime.ts` 两处 `taskkill` | 每停一次实例闪一个窗口 |
| `electron-main.ts` 仓库钩子脚本 spawn | 后台跑钩子脚本也弹窗口 |

现在三处都加了 `windowsHide: true`，并且加了**静态门禁**：`verify-naming.mjs` 会扫描
`packages/app-shell/src` 下所有 `spawn/execFile/spawnSync/execFileSync` 调用，
没带 `windowsHide` 就红（当前 39/0）。这样以后新写的子进程调用不会再把窗口漏到桌面上。

## 需要用户协助（待办）

1. **双机 mesh / NAT 验证** — 需要第二台设备或公网环境。
2. **安装包真机试装** — 需要干净 Windows 环境验收 `WArmy-Setup-0.1.0.exe`（当前 release 里的还是 Electron 33 的旧构建；Electron 40 的重打包需要带 VS/网络的 runner）。
3. **GitHub Discussions** — 需网页手动开启。
4. **完整 verify-net-ui 全量套件** — 需可交互终端起 CDP 宿主（工具非交互壳会杀子进程）。
5. **Docker 启停耗时复测** — 需你授权启动 Docker Desktop（当前按你之前指令保持停止）。
6. **供应商密钥的 OS 级保护验证** — 需要你在**真机**上输入一次 API Key：这台机器上 `safeStorage` 不可用时主进程会**拒绝写明文**并如实报错（这是设计如此，不是 bug）。要确认走的是加密路径，需要在你的 Windows 账户下点一次"接口密钥"。
7. **容器实例列表的真机确认** — 本机 Docker 引擎是停止状态，所以"实例"这一块目前只能验到"未启动 ⇒ 不可展开"这一半；启动 Docker Desktop 后才能验证"列出实例 / 启动实例 / 打开容器产品界面"。

## 未完成（如实记录）

- **全拼改名**：已完成 global 契约名两批（board/contracts/group-router/providers 的导出名 + sync-protocol 与 memory-os 的核心导出名，共 122 项映射）+ providers、memory-os 两包的包内局部名；`packages/app-shell` 的 12,430 处声明点尚未改（体量最大，需逐批走"映射 → 改 → 11 包 tsc → 16 门禁"）。工具已加固到能自己拦住坏档（括号/换行/长度/NUL 自检 + 保留字守卫 + 成员名守卫），后续每批可安全推进。
- **`container.envType.*` / `container.runEnv.*` 的 i18n 文案**：设置页已不再渲染"环境类型"（环境 = 具体实例），但探测报告仍在返回 `envTypes`、门禁仍在断言这批文案。要彻底清掉需要同时改 `container-probe.ts` 与 `verify-container-probe.mjs`，属于独立清理，未在本轮做（**用户可见界面已经不含环境类型**）。
- **`renderer.css` 与 `app.css` 两份样式文件**：两份内容高度重叠（后加载的 renderer.css 覆盖前者）。本轮新增样式**两份都加了**以免踩坑，但合并成一份是独立重构。

## 已由我完成

- 上下文预算滑块与模型窗口映射
- 群聊上下文自动收敛 + 超限重试（到最小值仍失败则如实告知）
- 会话摘要跳转原文（anchors 优先；无锚点回退结构化文本/标题搜索）
- 真实 UI 断言脚本 `verify-ui-layout.mjs`
- 文档 `docs/API-OPERATIONS.md`、`docs/CONTEXT-KNOWLEDGE-GATE.md`
- **完整需求文档** `docs/REQUIREMENTS.md`（目标/理念/功能/安全/验收/开发纪律）
- **完整技术文档** `docs/TECHNICAL.md`（架构/模块含义/**命名规范**/门禁/数据落盘/接手路径）
- **结构化会话摘要**：`extractStructuredSummary` + 归档条目落盘 `structured` + 知识库事件 + seq 锚点
- **gateVerify 按项目类型自动选择**：创建时始终写入（代码/文档/默认三档）
- **项目侧右栏**也展示知识库与聊天摘要
- **聊天输入区**：去掉输入框与按钮间分隔线；输入区更高；按钮更贴近
- **变量/环境变量命名规范**写入 TECHNICAL §3；`verify-naming.mjs` 全库检查 23/0
- 高可见 + 长文 i18n 批量翻译；zh-CN 缺失键已补齐
- wiring 238/0 · e2e 全过 · protocol verify-all 0 失败 · docs 84/0 · summary-quality 24/0
- **容器说明补"是否收费"**（12 个运行时全部给出 免费/收费 + 许可），去掉比较性措辞与厂商来源；10 语言包同步
- **设置页"点按钮被弹回首页"修复**：根因是分区被写死成 `ui`，整页重渲染后丢失 → 改为记住当前分区
- **供应商列表真正落盘**（`settings.providers`）：元数据进设置文件，**密钥只进 safeStorage**（无 OS 保护时拒绝写明文）
- **供应商标红语义**：改名称/接口/密钥 ⇒ 模型保留并标红（悬停说明需重新拉取 / 谁在占用）；重新拉取后才按"在用与否"取舍
- **供应商重名检查**：预设名重复自动加后缀；改名动态查重，重名时输入框与模型一起标红
- **设置分区重构**：技能、插件升为独立层级；黑名单从"模型"移到"功能"
- **容器实例**：列表只列可用/可启动的容器；引擎启动后可展开实例并单独启停；"创建实例"跳转容器产品自己的界面
- **容器实例门禁**：`verify-live-ui` 新增 8 条真实 DOM 断言（含"改接口 ⇒ 标红"端到端）；当场拓出一个真 bug（有模型时 `modelUsageCache` 的 TDZ 崩溃，已修）
- **改名工具加固**：正则字面量识别、模板插值里的正则/注释跳过、写前括号/换行/长度/NUL 自检、保留字与成员名守卫、`vendor/` 排除

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
