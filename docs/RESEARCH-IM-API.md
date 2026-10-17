# IM 接入可落地 API 细节（第 31 轮调研）

## 企微智能机器人
- 依赖：@wecom/aibot-node-sdk（WSClient）
- 凭据：botId + secret
- 收：ws.on('message.text', frame)
- 发：replyStream(frame, streamId, content, finish) / sendMessage(chatid, body)
- 限速：30条/分；流式≤20480字节；欢迎语5s内

## Telegram
- 依赖：node-telegram-bot-api v2
- 凭据：BOT_TOKEN（@BotFather）
- 收：getUpdates 长轮询（offset 自管）
- 发：sendMessage({chat_id, text})
- 限速：~30/s 全局，1/s/群

## 飞书
- 依赖：@larksuiteoapi/node-sdk ≥1.24（WSClient）
- 凭据：appId (cli_) + appSecret
- 收：EventDispatcher im.message.receive_v1
- 发：client.im.message.create
- 坑：3s 处理超时；单客户端投递

## iLink ClawBot（个人微信）
- 入口：https://ilinkai.weixin.qq.com
- 扫码：GET /ilink/bot/get_bot_qrcode
- 收：POST /ilink/bot/getupdates（~35s 长轮询）
- 发：POST /ilink/bot/sendmessage（必须带 context_token）
- 凭据：bot_token, ilink_bot_id, get_updates_buf 游标
- 坑：errcode=-14 停 1h；无主动推送；协议可变

## WArmy 适配器
- she-jiao-adapter.ts：LunXunAdapter / WeiXinAdapter / TelegramAdapter / FeiShuAdapter / ILinkAdapter
- IPC：warmy:sheJiaoPingTai / sheJiaoPeiZhiQu / sheJiaoBaoCunPeiZhi / sheJiaoLianJie / sheJiaoDuanKai / sheJiaoFaSend
