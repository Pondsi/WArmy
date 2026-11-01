# 第 117 轮未完成 / 需要你协助的事项

> 历史清单，当前状态见 [`PROJECT-AUDIT-R118.md`](./PROJECT-AUDIT-R118.md)。R118 已确认仍有可自主修复的产品缺陷与工程欠账，不能继续把本表解释为“只剩用户配合”；B/C 中多项有自主实施方案。原轮次交接保留于 [`HANDOFF-R117.md`](./HANDOFF-R117.md)。

## A. 需要你环境/账号

1. 三屏实际摆放、任务栏缩略图/右键关闭、nm 拖到负坐标副屏。
2. 4K 物理屏与 Windows 缩放 100%/150%/200% 目检。
3. 真实 IM 账号（微信 iLink / 飞书 / Telegram 等）与真实第二台设备；公网中继/打洞需要双方网络。
4. Windows/macOS 代码签名与 macOS 公证。
5. 真实 TTS/画图/视频供应商 key、真实思考档位与额度、整理模型质量。

## B. 需要你拍板的产品取舍

1. **nm 远程页下载管理器**：当前走 Chromium 默认行为，无保存位置/进度/打开文件 UI。方案 A 默认目录自动保存；方案 B 每次弹保存框。
2. **技能/插件目录是否保持明文**：`userData/scan-dirs` 与 `skills` 中可能有需要外部 Node/Python 解释器直接执行的脚本（例如内置 mcp-bridge 的 `bridge.mjs`）。当前逐文件加密会让外部解释器读到密文；若要保持“外部可直接执行”，需要把这两个目录像 workspace/dsh-packages 一样列为明文边界，并迁移已有密文。这是加密边界变更，不擅自改。
3. **进程沙箱/命令执行隔离**：`run_shell` 目前是字符串扫描 + 授权卡，不是 OS 级沙箱；做 Job Object/容器最小版会改变“本机文件/命令”的现有使用方式。
4. **Electron 大版本升级**：40.10.6 已进入支持尾期，升级涉及 Chromium/Node 行为、原生模块与打包回归，属于有风险的升级任务，需要你确认时间窗。
5. **额度工程债**：token 维、会话级总额度、审批等待不烧额度等，需要明确产品口径。
6. **DHT 最小子集**：超时驱逐、FIND_VALUE 缓存、多跳节点 ID 校验；只在多设备组网启用时才需要。

## C. 门禁测试债（不是产品功能）

- 剩余 known-red 7 条：`verify-e2e`（单实例锁）、`verify-live-ui`（断言过期，且跳过被当通过）、`verify-mobile-ui`/`verify-net-ui`（需要移动端 CDP/预览壳）、`verify-qr-scan`（12s 等待 flaky）、`verify-tool-call-e2e`（桩环境缺 `fenLei` 能力位）、`verify-warmy-ipc-probe`（harness 的 `ipcRenderer` 用法错误）。
- `verify-history-persist` 已在第 117 轮真跑通过并转绿。
- `verify-tool-calls` 曾在 fast 单遍偶发一次 `ERR_IPC_CHANNEL_CLOSED`；单跑 0 红，属记忆子进程启动/退出竞态，继续观察。

## D. 已确认不需要再做

- R104 nm 键盘焦点/远程查找/导航历史：R116 已完成，`verify-r81-nm` 63/63。
- R115 copyFileSync 大文件流式：R116 已完成，`verify-r116-enc-stream` 34/34。
- R105 5 轮真实测试、分段与无障碍：已完成；>10 段仅建议用真实长任务观察观感。
- R111 全量加密第一阶段、Kroot、旧群重建、IPC 白名单、供应商 cancel：现状态见 R111/R114/R115 交接。
