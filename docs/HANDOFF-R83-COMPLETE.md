# 第 83 轮交接：未完成项逐条落地（0.2.25）

> 日期：2026-10-25 · 版本：0.2.25
> 目标：把第 82 轮报告里“未完成/外部依赖”的条目，能落代码的全部落地，并用门禁证明。
> 结果：见文末“10 轮验收”。

## 1. F11 真全屏 + 4K 字号

- **主进程**：主窗口 `before-input-event` 处理 F11 / Esc；`warmy:winQuanPing`、`warmy:winZhuangTai` 暴露真实 `isFullScreen` 状态。
- **渲染层兜底**：全局 keydown 处理 F11 / Esc（CDP、远程桌面、无焦点场景也能用）。
- **4K/超宽**：≥3200 CSS px 时字号基准 `13/14/16/20 → 14/15/18/22`，阅读列 `1280 → 1320`；仍乘用户自己的字号比例，不覆盖设置。窗口 resize 时重新计算。
- **验证**：`verify-r83-quanping` 6/0（F11 进入真全屏、Esc 退出、3440 字号 15、1440 仍 14、无横向溢出）。
- **边界**：F11 只作用于主窗口；独立会话窗仍是普通窗口（避免用户找不到退出方式）。

## 2. #108 签名邀请绑定身份私钥

- **身份层**：`ShenfenQianmingzhe` 新增 `signSync()`；私钥只在本次调用内解密、签名、清零，不导出、不缓存（`identity-provider.ts`）。
- **邀请模块**：`shengChengYaoQing` 新增外部 `sign` 入口；提供 `gongYao` 且自校验签名，签名与公钥不匹配直接拒绝产出 token（`yao-qing-anchor.ts`）。
- **主进程 IPC**：`warmy:yaoQingQianMing`（签发）、`warmy:yaoQingYanZheng`（验签）、`warmy:huoDongDuiDuan`（在线联系人）。
- **指纹桥接**：身份层指纹与邀请模块指纹编码不同；一律由**公钥现推**邀请指纹，绝不拿两套指纹硬比。
- **UI**：群/项目查看弹窗新增“签名邀请（绑定到人）”：选在线联系人 → 取对方公钥 → 主进程签名 → 生成带 `pk` 的 `warmy://join?...` 链接/二维码；加入方先 `inviteVerify`，失败不发送申请。
- **验证**：`verify-r83-invite-sign` 9/0（错签、篡改、换人、过期、重放、越权、缺公钥）；`verify-r83-join-signed` 真机 IPC 11/0。
- **边界**：签名只证明“创建者授权了这个公钥”；联系人的公钥仍需通过名片/握手获得（没有公钥就拒绝签发，不猜）。

## 3. #112 加入申请落盘 + 审批回执

- **持久化**：`join-requests.json`（pending/approved/rejected/blocked，30 天过期，最多 500 条）；`join-blocklist.json` 独立落盘。
- **网络**：加入申请走 SecureMesh `join` 通道；有目标 node 就定向发送，否则广播；没有 mesh/peer 时如实 `sent:0`，不假装送达。
- **创建者侧**：只接受“本机是创建者”的群；用创建者公钥验签 + 申请人公钥重新推导绑定指纹；握手指纹与申请身份必须一致。通过的申请落 pending，**批准仍需用户在界面点一次**。
- **批准**：写成员表（带身份层指纹）→ 生成**绑定申请人的签名批准 token** → 回传/广播；申请人验签后落本地群与创建者成员，并广播 `warmy:joinApproved` 给界面。
- **验证**：`verify-r83-join-signed` 11/0（签发→验签→篡改失败→申请 pending→批准→成员表→两个 JSON 落盘）。
- **边界**：没有中心服务器，创建者离线时申请只能等对端上线；申请有效期 30 天，过期清理。

## 4. #106 外部联系人/多会话也走加密发件箱

- 渲染层 `deliver()`：`chatNetSend` 从“仅内部群”移到所有发送路径之前；单 AI / 外部联系人 / 群聊都先尝试发到地址簿对端。
- 无 peer → 主进程返回 `no-peers`；有 peer 但全失败 → `ok:false` + 只读广播，界面提示“本条未送达”，不显示假成功。
- 传输层沿用 `hui-hua-chuan-shu.ts`：AES-256-GCM 帧、msgId 去重、5 并发、8s 超时、失败两次剔除、最近成功优先、全失败只读。
- **验证**：`verify-r82-chuan-shu` 16/0 保持全绿；fast 套件覆盖发送路径。
- **边界**：双机跨公网 E2E 仍需第二台真实设备/中继；本机没有 peer 时只能证明“如实 no-peers”。

## 5. #113/#115 IM 真实消息协议

| 平台 | 发送 | 接收 | 说明 |
|---|---|---|---|
| 飞书 / Lark | `tenant_access_token` → `POST /open-apis/im/v1/messages` | 轮询 `GET /open-apis/im/v1/messages?container_id_type=chat` | 需 `chat_id` 与 `im:message:readonly`；baseURL 可指 Lark |
| 企业微信 | `gettoken` → `POST /cgi-bin/message/send` | **需回调 URL + AES 验签** | 适配器如实返回 `receiveMode:"webhook-required"` |
| 钉钉 | `oauth2/accessToken` → `POST /v1.0/robot/oToMessages/batchSend` | **需 Stream SDK/回调** | 如实返回 `receiveMode:"sdk-required"` |
| Telegram | `sendMessage` | `getUpdates` 长轮询 | 支持自建 Bot API/baseURL |
| Matrix（既有） | `PUT /send/m.room.message` | `/sync` 长轮询 | 既有能力保持 |

- UI 增加目标字段：飞书 `chatId`、企微 `agentId/toUser`、钉钉 `robotCode/userIds`。
- 诊断兼容旧字段名（`botId/appSecret` = `corpId/corpSecret`）。
- **验证**：`verify-r83-im` 16/0（回环 mock 校验真实请求路径、鉴权头、请求体、接收解析、失败不假装成功）。
- **边界**：企微/钉钉的**接收**没有官方简单轮询；要么配置公网回调，要么装官方 SDK。没有这两种条件时不显示“能收”。

## 6. A9 受控拟态观察（保守版）

- **默认关闭**；设置 → 拟态新增“允许桌宠在你点击「看一眼」时截取本应用窗口（不截桌面、不自动截）”。
- 点“看一眼”才调 `warmy:mimicKanYiYan`：主进程 `capturePage()` 截**应用自身窗口**，缩到 ≤1280 宽，返回 data URL；**不落盘**。
- 预览后点“把这张图发给当前牛马”才走 `chatSend` 附件；没有打开会话时明确提示。
- **验证**：`verify-r83-mimic-look` 5/0（默认拒绝、同意后可截、PNG 头/尺寸、关掉后再次拒绝、UI 存在）。
- **边界**：没有实现任意桌面截屏/鼠标键盘动作（那需要更完整的隐私与误操作设计）；现有桌宠动作仍走原有动作库。

## 7. 门禁与构建

- fast 套件从 25 扩到 **30 门禁**：新增 `verify-r83-quanping`（6）、`verify-r83-invite-sign`（9）、`verify-r83-join-signed`（11）、`verify-r83-im`（16）、`verify-r83-mimic-look`（5）。
- 单轮 fast 判据：原 628 + 47 = **675 项**。
- 版本升 **0.2.25**；安装包 `release/WArmy-Setup-0.2.25.exe`，**146,652,698 B**，sha256 `b410020df46b5f55e4a0b1825460b9079d5aa73c5664b59af6f651ef5852c294`；`checksums.txt` / `feed/latest.json` 已更新。
- 发布：源码 + 文档经 GitHub Git Data API 提交 `f7310c5`；Release https://github.com/Pondsi/WArmy/releases/tag/v0.2.25 （资产 `WArmy-Setup-0.2.25.exe`）。
- 交付：真实 profile 已删除，0.2.25 `release/win-unpacked/WARMY.exe` 重启到首启语言页（1280×800，随机单幕背景，10 语言）。

## 8. 10 轮验收（0.2.25 最终代码）

规则同第 82 轮：5 种内容 × 各连续 2 轮；每轮 30 门禁 fast 套件 + 内容专项；失败即停、修复后从第 1 轮重跑。

- 结果：**10/10 PASSED**（2026-10-25 13:23:35 → 13:49:59，约 26 分 24 秒）。
- 单轮 fast 675 项 × 10 = 6,750 项；内容专项 432 项；**全部 0 FAIL**。
- 记录：[VERIFY-R83-10X.md](VERIFY-R83-10X.md) · [VERIFY-R83-10X.log](VERIFY-R83-10X.log)。
- 内容：① r103 接线；② 真 MiMo 长会话 + ASR；③ 微信凭据/协议；④ FWArmy 扩网；⑤ 预算/额度 + 独立会话窗。
- 边界：企微/钉钉接收仍需公网回调或官方 SDK；四平台真实凭据需用户提供；双机公网 E2E 需第二台设备。

## 9. 0.2.26 补丁：成员角色矩阵

- 第四列成员面板：创建者可为非 creator 成员「设为管理员 / 取消管理员」；非创建者不显示管理按钮。
- 主进程二次校验：`warmy:qunSheZhiGuanLiYuan` 与 `warmy:qunTi` 都要求调用者是本群创建者（`not-creator`），不再只信界面。
- 签名邀请可选「成员 / 管理员」；邀请 token 的角色在批准时写进成员表（admin 保留，其它回落 member）。
- 复测：`verify-r83-join-signed` **12/0**；fast 30 门禁全绿。

### 0.2.26 最终 10 轮

- **10/10 PASSED**（2026-10-25 14:01:54 → 14:28:19，约 26 分 25 秒）。
- 单轮 fast **676 项** × 10 = 6,760 项；专项 432 项；全部 0 FAIL。
- 记录：[VERIFY-R84-10X.md](VERIFY-R84-10X.md) · [VERIFY-R84-10X.log](VERIFY-R84-10X.log)。
- 安装包：`release/WArmy-Setup-0.2.26.exe`，146,653,068 B，sha256 `d08b78cc0052ff871d4eea3899d84c075bafb0be6c0ed7ffeb2a5a5562806dfd`。
- 发布：Release v0.2.26；真实 profile 已删除，首启语言页已打开。
