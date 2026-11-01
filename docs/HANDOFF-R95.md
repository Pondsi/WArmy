# 第 95 轮交接：凭证系统审计 · 新设备恢复 · 未完成项

日期：2026-10-26
本轮性质：**审计 + 文档 + 首启交付**；没有修改认证/网络代码。
完整问答：[`CREDENTIALS-R95.md`](./CREDENTIALS-R95.md)
未完成项与方案：[`OPEN-ITEMS-R95.md`](./OPEN-ITEMS-R95.md)

## 1. 这轮回答了什么

1. 凭证系统如何工作：助记词 → 种子 → 51 位凭证 → Ed25519 私钥/指纹；vault 的随机 salt/PIN/自动登录。
2. 新设备能否只输助记词恢复：**当前不能**。`recoverBegin()` 无 vault 直接 `no-account`（已实测）。
3. 输入助记词后如何确定是同一人：同一助记词派生出同一私钥/指纹；对端/中继用签名验证，不靠服务器账号。
4. 对接供应商如何识别：大模型只认 API Key；IM 只认平台账号；FWArmy 中继认 `did` 签名。
5. 新设备为什么没有联系人、如何确保收到消息：联系人群聊是本机数据，不随助记词走；无服务器消息存储/离线队列；
   未知指纹在名册层被拒。
6. 其他人能否假冒：没有私钥不能伪造签名；但同名同头像、TOFU、通用邀请链接、助记词泄露、旧设备都会造成冒充；
   另发现“已授权联系人可跨会话注入”的入站校验缺口（G6）。
7. 旧设备怎么办：当前仍然完全有效；没有设备列表/远程下线；换证协议存在但 UI/传播不完整，且与助记词登录互相覆盖（G5）。

## 2. 关键实测证据

用编译后的 `AuthService` + 临时 vault（不碰真实 profile）：

- 新设备 `recoverBegin(24词)` ⇒ `{"ok":false,"error":"no-account"}`
- 带旧 `auth/vault.json` ⇒ `ok:true`
- 错误助记词 + 旧 vault ⇒ `bad-mnemonic`
- 换证后 `loginPin`：

```
register fp0=XN5TE-... gen=1
rotate   fp1=JK61K-... gen=2
login    fpNow=XN5TE-... gen=1
rotation was undone: true
```

结论：**“助记词唯一恢复”目前只完成了密钥数学，没有完成产品闭环。**

## 3. 本轮新增的缺口编号

G1 新设备只输助记词不能恢复（P0）
G2 联系人/群/聊天/知识库不随身份恢复（P0）
G3 离线消息不排队/不自动重发（P1）
G4 旧设备不能注销（P1）
G5 换证/身份导入与助记词 vault 不同步（P1，已实测）
G6 入站消息不校验 session/from（P1 安全）
G7 “按名字添加联系人”没有指纹（P2）
G8 模型 API Key 不随账号迁移（P2）
G9 中继客户端完整接入未完成（P2）

每项的方案 A/B/C、优缺点、例子、最坏情况见 `OPEN-ITEMS-R95.md`。

## 4. 既有未完成项

U1–U9 / M1–M5 / F1–F4 状态未变，原文见 `OPEN-ITEMS-R92.md`；
本轮在 `OPEN-ITEMS-R95.md` 第二节按编号保留摘要。

已知历史红门禁（非本轮引入）：
`verify-security` 27/28、`verify-docs` 93/95、`verify-renderer-template-balance`、
`verify-css-consistency`、`verify-r44-ui` 53/14、`verify-r69-join-create` 15/3。

## 5. 建议修复顺序

1. G1 + G5（新设备恢复 + 换证/vault 原子同步，或先禁用换证入口）
2. G6（入站消息绑定，安全且改动小）
3. G2 + G3（可选加密便携备份 + 持久化 outbox/回执）
4. G4（设备列表/换证/吊销）
5. U4 Device Guard、U1/U2、U3、U7、U6、M1–M3、FWArmy F1

## 6. 首启交付

- 真实 profile：`%APPDATA%\@warmy\app-shell`（删除前已备份到系统临时目录）。
- 交付状态：`setupDone=false`、`privacyConsent=false`、`providers=0`、`instances=0`。
- 源码 Electron 启动，停留在首启语言页；未签名打包 exe 仍被本机 Device Guard 拦截（U4）。
