# 第 82 轮 10 轮全功能验收交接（TEST10）

> 日期：2026-10-25 · 版本：0.2.24 · 结论：**连续 10 轮全部 PASSED**
> 原始记录：[VERIFY-R82-10X.md](VERIFY-R82-10X.md)（逐轮表） · [VERIFY-R82-10X.log](VERIFY-R82-10X.log)（实时日志）
> 验收时长：12:29:07 → 12:52:42（约 23 分 35 秒）

## 1. 规则

按用户口径执行：

- **5 种不同内容，每种连续 2 轮，共 10 轮**。
- 每轮先跑 **25 门禁 fast 套件**（覆盖全部已门禁功能），再跑该内容的专项实测。
- 任一轮失败：立即停止，不进入下一轮；定位/修复后**从第 1 轮重跑**。
- 只有连续 10 轮通过才算完成。

## 2. 五种内容与覆盖

| 内容 | 轮次 | 每轮固定 | 专项实测 |
|---|---|---|---|
| 1 | 1–2 | 25 门禁 | `verify-r82-r103` 18/0（知识库权限、提示词备份/回滚、邀请审批、社交诊断接线） |
| 2 | 3–4 | 25 门禁 | `verify-round39-longchat` 15/0（真 MiMo 长会话记忆）+ `verify-round38-asr` 12/0（ASR 路由） |
| 3 | 5–6 | 25 门禁 | `verify-r44-shejiao` 27/0（微信凭据/队列）+ `verify-r65-shejiao` 15/0（微信协议） |
| 4 | 7–8 | 25 门禁 | FWArmy `verify-expand` 41/0（扩网/安全） |
| 5 | 9–10 | 25 门禁 | `verify-round39-budget` 76/0（预算/额度）+ `verify-r82-chatwin` 12/0（独立会话窗） |

25 门禁（fast 套件）与判据数：

| # | 门禁 | 覆盖 | 判据数 |
|---|---|---|---|
| 1 | `verify-r44-shejiao` | 微信凭据/发送队列 | 27 |
| 2 | `verify-r65-shejiao` | 微信协议/回灌 | 15 |
| 3 | `verify-asr-routing` | 语音识别路由/附件语言 | 35 |
| 4 | `verify-r65-mic-lifecycle` | 话筒生命周期 | 12 |
| 5 | `verify-r78-scroll` | 聊天滚动/顶部对齐 | 6 |
| 6 | `verify-r78-prompt-limits` | 10 语言提示词限长 | 29 |
| 7 | `verify-r67-chat-order` | 思考/工具/回复时序 | 20 |
| 8 | `verify-r78-auth-tour` | 首启登录/引导 7 步 | 47 |
| 9 | `verify-r67-firstrun` | 首启静态 | 80 |
| 10 | `verify-r68-firstrun-ui` | 首启界面/窗口策略 | 24 |
| 11 | `verify-r68-auth-ui` | 我的页/认证/助记词 | 47 |
| 12 | `verify-r63-nm` | nm 查看器 41 项（文本/图片/音视频/SVG/DOCX/XLSX/PPTX/查找/缩放） | 41 |
| 13 | `verify-zip-look` | nm 压缩包 | 8 |
| 14 | `verify-r78-nm-plugin` | nm 默认启用 | 7 |
| 15 | `verify-r79-regressions` | 显示名/默认值等回归 | 7 |
| 16 | `verify-r81-ui` | R81 界面/数据/首启尺寸 | 20 |
| 17 | `verify-r81-nm` | R81 nm 工具栏/吸附 | 51 |
| 18 | `verify-r82-kuanping` | 宽屏/带鱼屏/全屏（960→3840） | 22 |
| 19 | `verify-r82-chatwin` | 独立会话窗只显示第三/四列 | 12 |
| 20 | `verify-r82-aiedit-badge` | 模型改写提示词的牛头图标/悬停 | 14 |
| 21 | `verify-r82-hu-chi` | 知识库/提示词互斥放置 | 34 |
| 22 | `verify-r82-chuan-shu` | 会话传输 AES-GCM/发件箱/去重 | 16 |
| 23 | `verify-r82-invite` | Ed25519 邀请/角色/重放 | 20 |
| 24 | `verify-r82-shejiao-tong` | 四平台连通性诊断 | 16 |
| 25 | `verify-r82-r103` | #103/#109/#112/#113 接线 | 18 |

单轮 fast 判据合计 **628 项**，10 轮 **6,280 项**；专项另有 **432 项**。全部 0 FAIL。

## 3. 本轮前三次失败与修复（如实记录）

这是"失败→修复→从第 1 轮重跑"的实际过程，不是产品功能回归：

1. **第 1 次（环境）**：第 3 轮 `round39-longchat` 报"缺真模型密钥"，因为启动命令没带 `MIMO_KEY_FILE`。补环境变量后从第 1 轮重跑。
2. **第 2 次（仪器）**：fast 套件无声挂死 >9 分钟。根因是门禁遗留 Electron 子进程占住 `spawnSync` 的管道 EOF，门禁本身已退出。修复：
   - `scripts/verify-r78-3x.mjs` 改为异步 `spawn`，以 `exit` 判完成，不再等管道 EOF；
   - 每道门禁 **240s 硬超时**；
   - 每道门禁后清理 `%TEMP%\warmy-*` 测试 profile 的 Electron 残留；
   - `verify-r82-aiedit-badge` 收尾显式关闭 CDP socket；
   - `verify-r82-10x.mjs` 启动前清残留；修掉结果表占位行重复与"开始时间"每轮刷新的记账 bug。
3. **第 3 次（仪器）**：第 8 轮 `verify-r63-nm` 的 XLSX 查找偶发 `0/0`。根因是门禁固定 `sleep(120)` 等渲染层 debounce，在高负载 7 轮后不够。修复：DOCX/PPTX/XLSX 三处改为**轮询直到 `count=1/1`**（最多 3s）。单跑 nm 41/0 ×2 后从第 1 轮重跑。
4. **第 4 次（最终）**：10/10 全过。

## 4. 覆盖边界（没有假装测到）

- **微信**：只到凭据/配置/协议状态机与本地 loopback 服务，没有登录真实个人微信账号收发。
- **飞书/钉钉/企业微信/Telegram**：只测连通性诊断（配置→DNS→HTTP、401/403 分类），**没有真实消息协议**（需要企业应用凭据与服务端联调）。
- **SecureMesh 双机/公网 E2E**：传输层单机/协议级门禁通过，没有两台真机跨公网收发验收。
- **签名邀请绑定身份私钥**：Ed25519 模块与审批闭环通过，UI 邀请仍用既有 token，身份层私钥未导出。
- **带鱼屏/4K**：用真实 Chromium 视口 960/1280/1920/2560/3440/3840 验证盒模型，不是物理带鱼屏/4K 显示器。
- **首启验收**：程序已删真实 profile 并停在语言页，需用户人工走一遍（自动门禁只能测结构与跳转）。

## 5. 跑法

```bash
# 完整 10 轮（建议带真模型密钥文件路径；不要打印密钥内容）
MIMO_KEY_FILE="<密钥文件绝对路径>" node scripts/verify-r82-10x.mjs

# 只想跑一遍 25 门禁
VERIFY_ROUNDS=1 node scripts/verify-r78-3x.mjs
```

## 6. 交付状态

- 版本 0.2.24，安装包与 GitHub Release 已在位（见 HANDOFF-R82-WIDE.md §9）。
- 本轮测试只改了**门禁/验收脚本**，未改产品源码；0.2.24 安装包仍是最终产品构建。
- 真实 profile（`%APPDATA%\@warmy`）已删除，`release/win-unpacked/WARMY.exe` 已重新启动到首启语言页，等待验收。
- **启动坑（已写入交接）**：某些自动化 shell 会带 `ELECTRON_RUN_AS_NODE=1`。此时双击/启动 `WARMY.exe` 会被 Electron 当成 Node 运行，进程秒退（`--version` 打印 Node 版本）。从脚本启动前必须 `unset ELECTRON_RUN_AS_NODE`；普通双击不受影响。
- 首启实测：窗口 1280×800 居中，语言页（简体已选 + 繁體/English/日本語/한국어/Русский/Español/Français/Português/Esperanto + 开始），随机单幕背景铺满，牛马可见；`settings.json` 为默认值（`privacyConsent=false`、providers/models 0）。
