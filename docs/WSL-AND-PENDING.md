# WSL 使用纪律与待协助事项

## WSL

- **平时不启动 WSL**；只在容器/引擎真需要时启动。
- 用完必须关闭控制台窗口：`wsl --terminate docker-desktop` / `wsl --shutdown`。
- 不要把 WSL 控制台窗口留在桌面上。

## 需要用户协助（待办）

1. **双机 mesh / NAT 验证** — 需要第二台设备或公网环境。
2. **安装包真机试装** — 需要干净 Windows 环境验收 `WArmy-Setup-0.1.0.exe`。
3. **GitHub Discussions** — 需网页手动开启。
4. **完整 verify-net-ui 全量套件** — 需可交互终端起 CDP 宿主（工具非交互壳会杀子进程）。
5. **Docker 启停耗时复测** — 需你授权启动 Docker Desktop（当前按你之前指令保持停止）。

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

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
