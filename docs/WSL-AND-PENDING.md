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
- 会话摘要跳转原文（按 recordId/seq）
- 真实 UI 断言脚本 `verify-ui-layout.mjs`
- 文档 `docs/API-OPERATIONS.md`、`docs/CONTEXT-KNOWLEDGE-GATE.md`

---
Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
