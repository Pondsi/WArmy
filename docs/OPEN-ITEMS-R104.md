# 第 104 轮未完成 / 需要协助事项

> 详细交接见 [`HANDOFF-R104.md`](./HANDOFF-R104.md)。上一轮遗留见 [`OPEN-ITEMS-R103.md`](./OPEN-ITEMS-R103.md)。

## A. 全量加密 vault（项 10）

**已完成**：登录后解包、退出/注销/改 PIN 封存、`.wvault` 加密导出/整包导入、干净/崩溃两种启动路径；临时 profile 真机链路通过；`verify-r104-vault` 36/0。

**仍缺 / 风险**：
1. **崩溃明文窗口**：运行期间是明文工作副本；异常退出（断电/强杀）可能留下明文，直到下次登录被识别/清理。没有做“每次写盘都加密”的逐文件层（要改 memory-os SQLite/JSONL 与所有仓，工作量大）。
2. **外部项目目录**：用户自己选的、在 `userData` 之外的项目目录不会被封存/导出。
3. **机器绑定密钥**：`secure/keys.enc.json` 与 settings 里的 `enc:v1:`（safeStorage）在换机后不可解密；导出包包含它们但需要重新输入密钥。`auth/identity` 可随包恢复，但需要助记词。
4. **强制重新注册**：已有旧 vault 时强制注册新账号，旧数据无法用新主密钥解开；目前会失败而不是静默覆盖。需要产品拍板“先删除旧数据/先登录旧账号再重注册”。
5. **导出包体积**：当前整包一次性构建；workspace/products 很大时退出封存/导出会慢（真实 profile 目前约 8MB，未触发）。

**需要你做什么**：如果希望“运行期间也不留明文”，需要再拍板是否接受改造 memory-os/SQLite 与所有文件仓（更大改动）；否则按当前“加密卷挂载”模型使用。

## B. 供应商 cancel/stop（项 11）

**已完成**：provider `cancel` 钩子、OpenAI Responses cancel、客户端 abort、审计 `llm.cancel`、执行者 AbortSignal。

**事实**：Chat Completions / MiMo / DeepSeek / Anthropic Messages / Ollama / Gemini 兼容端点**没有公开的服务端 cancel 接口**；这些路径停止后只能断开客户端连接，不能保证供应商不计已生成 token。OpenRouter 只在响应头给 generation id，未发现公开 cancel 端点。若你希望接某家**内部/企业网关**的 cancel，请给接口文档。

## C. nm WebContentsView（项 12）

**已完成**：远程页面顶层 WebContentsView、本地 iframe、边界同步、导航/标题/加载事件、权限/新窗/协议限制、打印、视图销毁；临时 Electron smoke 通过。

**仍缺 / 风险**：
1. **键盘焦点**：焦点进入远程页后，nm 自有快捷键（Ctrl+F/P 等）不冒泡；目前打印/地址栏可用鼠标，Ctrl+F 应在后续用 `before-input-event` 转发或接 `findInPage` UI。
2. **远程页查找 UI**：主查找框仍主要服务本地源码；`findInPage` IPC 已有，但没有把匹配数接到工具栏。
3. **标签页历史**：渲染层仍维护自己的 URL 历史；远程页内部跳转（如登录重定向）由主进程负责，前进/后退按钮与 WebContents 历史可能不完全同步。
4. **多看一屏/任务栏**：BrowserWindow 方案保留，理论上任务栏与吸附不变；本轮只在临时 profile 做了 API 级 smoke，未做多显示器/任务栏实机目检（仍需你协助）。
5. **视频/下载/弹窗**：远程页下载按 Chromium 默认（未接下载管理器）；`window.open` 被拒绝。

## D. 验收仪器残留

- `verify-tool-calls` 在一次 fast 单遍里因 memory 子进程启动 `ERR_IPC_CHANNEL_CLOSED` 偶发红；单跑复现 0 红，随后 fast 三连 360 项次全绿。属于记忆子进程启动竞态，未在商品逻辑里定位到确定根因，继续观察。
- 真实应用本轮没有执行退出，所以真实 profile 仍是明文工作副本；用户正常退出/注销后会生成 `vault.bin` 并删除明文。

## E. 上一轮遗留（提醒）

- **第 4 项**：多显示器、任务栏实际显示、IM 真实账号、第二台设备/组网——需要你提供屏幕/账号/设备信息。
- **4K 物理屏目检**：有 4K 屏时切 100%/150%/200% 看标题栏、四列、输入区、任务栏。
- **签名路线**：Windows SignPath Foundation（$0）/ macOS Developer ID+公证（$99/年）或 ad-hoc，需要拍板。
- **启动日志**：`paiShengShiLi ... instance exists` **已修**（第 105 轮：启动时若实例已存在则返回 `alreadyRunning`，不再重复注册/报错；真实应用重启日志已无该错误）。如仍在其他启动路径看到，请发日志。
