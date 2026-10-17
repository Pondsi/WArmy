# 微信/企微/公众号/小程序 AI 接入调研（2026-10）

## 结论
- **个人微信已有腾讯官方 iLink Bot API（2026-03）**，不再是纯逆向。但限一对一、先发后回、静默风控。
- **企微智能机器人长连接**是微信生态内唯一「出站长连接 + 双向」的合规通道。
- 公众号 48h/5 条客服额度撑不起 AI 对话；小程序适合扫码看板不适合主聊天。
- 协议逆向（WeChatFerry/itchat）继续不做。

## 对比
| 路线 | 原理 | 风险 | 桌面端 |
|---|---|---|---|
| iLink ClawBot | 官方 API，长轮询 35s | 中（静默限流） | ★★★ |
| 企微智能机器人 | 长连接 wss | 低 | ★★★ |
| 公众号服务号 | webhook+48h/5条 | 中 | ★（需服务器） |
| 小程序 | 订阅消息/客服 | 中 | ★★（扫码绑定） |
| 协议逆向 | hook/协议号 | 高（封号） | ? |

## iLink 关键约束
- 一微信号 1 Bot，与创建者 1:1
- 回信必须带 context_token，不能主动推送
- 判据：sendmessage 回包带 message_id 才算送达

## 企微智能机器人限制
- 单机器人 1 条长连接
- 会话回复窗 24h；30 条/分、1000 条/小时
- 不能触达真·微信用户（需微信客服 webhook）

## WArmy 推荐
1. P0：企微智能机器人 + Telegram/飞书（零服务器）
2. P1：iLink ClawBot 作「手机遥控本机」实验通道
3. P2：服务号通知入口 / 小程序看板
4. 不做：协议逆向

## 成本
- 零服务器方案：企微/TG/飞书 ≈ 0
- 服务号认证 300/年 + 服务器 50-200/月
- iLink 免费但有静默风控

## 来源
- https://developer.work.weixin.qq.com/document/path/101463
- https://github.com/Tencent/openclaw-weixin
- https://github.com/nightsailer/wechat-clawbot
- https://github.com/langbot-app/LangBot
