# 社交软件接入方案（第 27 轮 项 1）

> 目的：让牛马（WArmy agent）能在微信 / 飞书 / 钉钉 / Slack 等**外部聊天工具**里收发消息，
> 而不是只在桌面应用里说话。本文给结论、给顺序、给**我们需要你准备什么**，不含猜测。
> 调研时间 2026-10-15；引用见文末来源。

## 0. 一句话结论

**先做「出站长连接」类平台（飞书、钉钉、Slack、Telegram、Discord、QQ 官方机器人、企业微信智能机器人），
把「需要公网回调」的（微信公众号/小程序、企业微信自建应用收消息、微信客服）放到后面。**

原因只有一条：出站长连接**只要这台机器能上网**就能收到消息，不需要公网 IP、域名、备案、内网穿透；
而回调模式必须先有一台 `https://你的域名/回调` 可达的服务，桌面应用（跑在用户笔记本上）天然不满足。

## 1. 两种接入模式（决定工作量的分水岭）

| | A. 出站长连接（推荐先做） | B. 入站 HTTP 回调 |
|---|---|---|
| 平台给的通道 | 应用主动连平台的 WebSocket，事件从这条连接推下来 | 平台 POST 到你的公网 URL |
| 需要的东西 | 只需 App ID + App Secret（或 Bot Token） | 公网 HTTPS 域名 + 证书 + 备案（境内）+ URL 校验 + 加解密 |
| 桌面应用可行性 | ✅ 直接在牛马进程里跑 | ❌ 需要额外一台服务器/中转 |
| 断线处理 | 自己重连 + 事件补拉 | 平台会重试，但有超时窗 |
| 代表平台 | 飞书、钉钉、Slack、Discord、Telegram、QQ 机器人、**企业微信智能机器人** | 微信公众号/小程序、企业微信自建应用、微信客服 |

## 2. 各平台明细

### 2.1 飞书 Feishu / Lark —— **最省事，建议第一个做**
- 模式：A（官方 SDK 提供 WebSocket 长连接接收事件，官方文档明确「无需提供公网 IP 或域名、无需内网穿透」）。
- 前置：在飞书开放平台建**企业自建应用** → 打开机器人能力 → 事件订阅选「使用长连接接收事件」→ 订阅 `im.message.receive_v1`。
- 凭据：`App ID`、`App Secret`；权限至少 `im:message`（读/发）、`im:chat`（读群信息）。
- 发消息：`POST /open-apis/im/v1/messages?receive_id_type=open_id|chat_id`。
- 能力：单聊/群聊、富文本、图片文件、卡片消息、已读回执、@提醒。
- 坑：长连接同一应用**只允许有限条数**；`tenant_access_token` 2 小时有效需刷新；消息内容默认加密（`encrypted` 字段需自行解密，密钥来自事件订阅配置）。

### 2.2 企业微信 WeCom（微信生态里唯一值得先做的）
- 模式：**智能机器人支持长连接**（官方文档「智能机器人长连接」，连接建立后要发 `aibot_subscribe` 做身份校验，且明确有频率保护 ⇒ 订阅成功后不要反复请求）。
- 前置：企业管理员在管理后台创建智能机器人 → 拿到机器人的 `bot_id` / `secret`。
- 限制：机器人只能出现在**被添加的群/会话**里；企业外部联系人（真·微信用户）场景要走「微信客服」，那是模式 B。
- 坑：`aibot_subscribe` 重复请求会触发限流；页面是前端渲染，接口细节要按登录后实际控制台为准。

### 2.3 微信 WeChat（个人号 / 公众号）
- **个人微信没有官方 API**。任何"个人号机器人"都是逆向或 hook（itchat/协议号/Hook 客户端），违反《微信软件许可及服务协议》，**封号风险由用户承担** —— 我们不做，也不建议在牛马里做。
- 合规路径只有三条：
  1. **公众号**（服务号/订阅号）：模式 B，需公网回调 + Token 校验 + AES 加解密；48 小时客服消息窗口限制主动推送。
  2. **微信客服**（企业微信下的客服能力）：模式 B，需公网回调；适合对外客服不适合个人助理。
  3. **小程序**：与本项目场景关系不大。
- 结论：**"在微信里跟牛马说话"只能靠企业微信智能机器人（模式 A）或公众号（模式 B）**；要真·微信个人号，得先接受封号风险，我们不接受。

### 2.4 钉钉 DingTalk
- 模式：A（Stream 模式：`dingtalk-stream` SDK，注册回调 topic 后由平台推事件，无需公网）。
- 前置：钉钉开放平台建企业内部应用 → 机器人能力 → 消息接收选 Stream。
- 凭据：`AppKey(clientId)`、`AppSecret(clientSecret)`，先换 `access_token`。
- 能力：单聊/群聊、Markdown、卡片、@人；支持主动发消息（`/v1.0/robot/oToMessages/batchSend` 等）。

### 2.5 Slack
- 模式：A（Socket Mode，`apps.connections.open` 拿 WSS URL，再走 WebSocket）。
- 前置：Slack App + Bot Token Scopes（`chat:write`、`channels:history`、`groups:history`、`im:history`、`commands`）+ 安装到工作区。
- 凭据：`xoxb-` Bot Token、`xapp-` App-Level Token。
- 加分：无需公网、事件类型清晰、有官方 JS SDK；**海外团队首选**。

### 2.6 Telegram
- 模式：A（`getUpdates` 长轮询，或 webhook；BotFather 建 bot 即可）。
- 凭据：`BOT_TOKEN`；**无需任何服务器**（长轮询即可）。
- 限制：默认只有 @提及/回复能触发（要关掉隐私模式才能看到群里全部消息）；`getUpdates` 与 webhook 二选一。
- 加分：**接入成本最低**，适合我们做「一个牛马在外面值班」的最小可用版本。

### 2.7 Discord
- 模式：A（Gateway WebSocket，官方 bot 协议）。
- 凭据：Bot Token + Application ID；需要 `Message Content` 特权意图（在开发者后台勾选，且机器人在验证前有限制）。
- 限制：意图（Privileged Intents）审批；消息需分片处理（>2000 字符）。

### 2.8 QQ（官方开放平台）
- 模式：A（官方机器人 **WebSocket 长连接** Gateway + 主动消息接口）。
- 前置：QQ 开放平台注册机器人、过审、拿到 `app-id` / `client-secret`；沙箱频道先测。
- 限制：**内容审核与过审门槛高**，个人开发者拿到的能力有限（群消息/富文本受限）。

## 3. 牛马侧的落地设计（等平台定了再写代码，这里先定形状）

1. **一个 adapter 接口，多平台实现**（`packages/app-shell/src/she-jiao-adapter.ts`）：
   `connect() / onEvent(cb) / send(target, text|file) / dispose()`；平台差异只留在实现里。
2. **入站 → 会话**：外部消息映射成牛马会话的一条 user 消息（带 `source: {platform, chatId, senderId}`），
   复用现有会话/上下文渲染，不另造一套对话状态；群聊按 `chatId` 分会话，@我才响应（可配置）。
3. **出站 → 平台**：牛马回复走 `send()`；长文本按平台上限分片，图片/文件走平台上传接口。
4. **首次绑定要过授权门**（沿用现有授权卡机制）：明确显示"外部平台 X 的消息会进入本机会话 Y、回复会以 Z 身份发出"，用户点确认才接通；随时可一键断开。
5. **审计与安全**：所有收发写 `audit`（谁发的、进了哪个会话、发了什么，不落密钥）；
   平台凭据进现有 `cred-vault`（加密存储），不出现在 settings.json 明文里。
6. **降级**：长连接断了要自动重连（指数退避），断连期间外部消息**不承诺不丢**（要如实告诉用户）。

## 4. 需要你决定 / 提供的东西

| # | 决策 | 说明 |
|---|---|---|
| 1 | 第一批做哪个平台 | 建议：**飞书**（有企业/团队且功能全）或 **Telegram**（最快能跑通） |
| 2 | 平台凭据 | 建应用后给我 `App ID/Secret`（飞书）、或 `clientId/Secret`（钉钉）、或 `BOT_TOKEN`（TG）。凭据走 `cred-vault`，不要贴在聊天里 |
| 3 | 身份与可见范围 | 用**企业自建应用**还是个人；允许哪些群/人跟牛马说话 |
| 4 | 群聊触发规则 | 只有 @ 我响应，还是全部消息都进上下文 |
| 5 | 是否需要出站主动推送 | 例如定时任务/决策卡提醒推到外面（需要平台侧额外权限） |
| 6 | 微信需求怎么处理 | 接受"只能企业微信智能机器人"，还是愿意为公众号配一台公网服务器（那就必须给出域名与备案主体） |

> 我这边可以立刻开工的最小闭环：**飞书长连接或 Telegram 长轮询 → 进现有会话 → 回复发回原平台**，
> 全程无需公网、无需内网穿透。等你给凭据和上面 6 项的选择。

## 5. 来源

- 飞书「使用长连接接收事件」（官方：无需公网 IP/域名/内网穿透）：https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case
- 飞书「使用长连接接收回调」：https://open.feishu.cn/document/event-subscription-guide/callback-subscription/step-1-choose-a-subscription-mode/configure-callback-request-address
- 企业微信「智能机器人长连接」（`aibot_subscribe`、频率保护）：https://developer.work.weixin.qq.com/document/path/101463
- 飞书 SDK 事件处理（WebSocket 全双工，需能访问公网）：https://open.feishu.cn/document/server-side-sdk/python--sdk/handle-events
