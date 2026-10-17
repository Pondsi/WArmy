# 社交接入 / requires 门控 / skills_search / agent 自写技能 —— 技术调研（第 29 轮）

> 来源：子代理联网调研，2026-10-16。实现决策以本文为参考，不必照搬。

## 一、主流 IM 接入面

| 平台 | 接入方式 | SDK | 鉴权 | 优先级 |
|---|---|---|---|---|
| 飞书 | 开放平台应用机器人；事件订阅 Webhook 或 **长连接(WS)** | lark-oapi / @larksuiteoapi/node-sdk | app_id+secret→tenant_access_token | **P0** |
| Telegram | Bot API；getUpdates 轮询或 setWebhook | telegraf/grammY (Node) | BotFather bot token | **P0** |
| 企业微信 | 自建应用回调；群机器人 Webhook **仅单向** | 自封装 HTTP | corpid+secret；回调 AES | **P0** |
| 钉钉 | 企业内部应用；**Stream 长连接** 或 Webhook | dingtalk-stream-sdk | appKey/Secret | P1 |
| Slack | Bolt **Socket Mode(WS)** | bolt-js | xoxb- / xapp- | P1 |
| Discord | Bot + Gateway WebSocket | discord.js | Bot Token | P1 |
| Matrix | Client-Server API / AppService | matrix-js-sdk | access_token | P2 |

**结论**：
- P0：飞书长连接 + Telegram + 企微自建应用。
- 个人微信个人号/协议破解（wechaty pad 等）**封号与法律风险极高，排除**。
- 统一抽象 `IMAdapter { connect, onMessage, send }`。
- 桌面端优先长连接/Stream/Socket Mode，免公网回调。

## 二、requires 门控 + skills_search

- SKILL.md frontmatter 扩展 `requires: {mcp, bin, env, skills}`：缺失则进 latent（不暴露），UI 提示「缺 X，去配置」。
- 检索两段式：BM25(name+description) → Top-K embedding RRF；激活后 progressive disclosure 才读正文。
- 工具面：`skills_search(query)` 返回候选元数据；`skill_load(name)` 注入正文。
- 参考：Claude Code skills（description 常驻 ~100tok）、agentskills.io、HA manifest requirements。

## 三、Agent 自写技能安全

1. 落盘隔离 + 保留名保护；禁止路径穿越。
2. 默认 `disable-model-invocation`，需用户确认后才进 available。
3. `allowed-tools` 白名单；禁任意 shell 注入。
4. 审计来源（user/agent/marketplace）与调用。
5. 正文 <500 行；frontmatter schema 校验。

## 四、落地顺序建议

1. requires 门控（缺依赖不暴露）
2. skills_search（BM25 元数据检索）
3. agent 自写技能（默认不自动激活 + 审计）
4. IM：飞书长连接最小闭环 → Telegram → 企微
