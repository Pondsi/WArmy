# 可选服务器（中继/撮合）接口与威胁模型

> 用户口径：可以用内网/公网组网，也允许**加一个可选服务器**；服务器只帮双方建立联系与转发，**不存消息**（未送达的消息留在本机），
> 服务器**看不到消息内容**；即使服务器不按协议运行，也不能突破加密。服务器程序 **FWArmy** 是独立项目，位于 WArmy 仓库外的 `../FWArmy/`（入口 `server.mjs`）
> （第 64 轮由 `relay-server/` 改名；单文件 `FWArmy.exe` 由 `../FWArmy/build-sea.mjs` 构建），
> 客户端/加密在 `packages/app-shell/src/zhong-ji-ke-hu.ts`，门禁 `verify-r58-zhongji`（35 条，真起服务器跑）、`verify-r64-fwarmy`。

## 1. 协议（HTTP + JSON，零依赖；可换语言/托管）
| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/register` | `{did, boxPub, ts, sig}`：did=Ed25519 公钥(raw b64)，boxPub=X25519 公钥(raw b64)，sig 覆盖 `register|did|boxPub|ts`；服务器验签后记内存 |
| GET | `/api/lookup?did=` | `{online, boxPub, lastSeen}`：查对方是否在线、拿对方的加密公钥 |
| POST | `/api/relay` | `{from, to, envelope}`：**envelope 是不透明密文**；收件人不在线 ⇒ `{ok:false, offline:true}` |
| GET | `/api/poll?did=&ts=&sig=` | 取走内存队列里的信封（取走即删，TTL 30s）；sig 覆盖 `poll|did|ts`，证明你是这个 did 的私钥持有者 |
| POST | `/api/bye` | `{did, ts, sig}` 下线；sig 覆盖 `bye|did|ts` |
| POST | `/api/heartbeat` | `{did, ts, sig}` 心跳；sig 覆盖 `heartbeat|did|ts`，防止替别人上线 |
| POST | `/api/presence/batch` | `{dids:[...]}` 批量查在线（最多 500） |

**硬边界（代码里写死）**：不落盘（没有 fs 写）；不解析 envelope；每 did 队列 ≤50 条、单条 ≤64KB；TTL 30 秒。
离线消息**永远留在发送方本机**，等对方上线再由发送方重发（与用户口径一致）。

## 2. 加密与身份（客户端做，服务器只是搬运工）
```
信封 = { v:1, from, epk, iv, ct, sig }
  共享密钥 = HKDF-SHA256( X25519(临时私钥, 收件人 boxPub), salt="warmy-relay-v1", info="aes-256-gcm" )
  ct       = AES-256-GCM( 共享密钥, 明文, AAD=发件人 did )
  sig      = Ed25519( 发件人身份私钥, "v1|from|epk|iv|ct" )
```
- 收件人用 `boxPriv` 解出共享密钥；**服务器没有 boxPriv**。
- 改一个字节 ⇒ GCM 校验失败；伪造发件人 ⇒ 签名失败（门禁里两条都测了）。
- 身份公钥由用户凭证确定性派生（见 P0-5），服务器只存**公开**部分。

## 3. "服务器不按协议运行，能不能突破加密？"
**不能读到明文，也不能伪造任意发件人**——前提是客户端自己验签、自己解密。但必须如实列出它能做的：
| 恶意行为 | 能不能 | 防线 |
|---|---|---|
| 读消息内容 | **不能**（没有密钥；AES-GCM 128-bit 认证强度） | 端到端加密；服务器不接触明文 |
| 伪造发件人 | **不能**（要 Ed25519 私钥） | 客户端强制验签；未签名/错签名直接丢 |
| 篡改/重放 | 篡改**不能**（GCM+签名）；重放**能**（原样重发旧信封） | 信封带 `msgId+ts`，收件人按 msgId 去重、按 ts 拒过期；后续加单调序号 |
| 给你一个**假公钥**（中间人） | **能**（它替换 lookup 返回的 boxPub） | **带外核对身份指纹**（安全码/二维码）或信任首次使用（TOFU）+ 指纹变更告警；不依赖服务器 |
| 拒服务 / 丢包 / 延迟 | 能 | 多路径（DHT/局域网/另一个服务器）+ 重试 + 如实显示"未送达"；**不假装成功** |
| 看元数据（谁在何时找谁） | 能 | 消息填充到固定大小、批量拉取、可选的匿名 topic；**无法彻底消除**，如实告知 |
| 冒充服务器（DNS/中间人） | 能 | TLS + 证书校验；可选固定服务器公钥（pinning） |

**结论**：只要私钥不出本机、客户端强制验签、公钥经带外核对，**服务器即使完全恶意也拿不到明文**；
它能做的是"可用性攻击 + 元数据 + 替换公钥"，前两个靠多路径/如实提示，后一个靠**指纹核对**（这是不依赖服务器的最后一环）。
**前向保密**：v1 用长期 box 密钥，服务器若长期保存信封、日后拿到 boxPriv 就能解历史；要防这一点要上 Double Ratchet（后续）。

## 4. 组网策略（内网 / 公网 / 可选服务器）
1. **同一局域网**：mDNS 发现 + 直连（无需服务器）。
2. **公网可直连**：STUN + 打洞（项目已有 NAT-PMP/STUN 代码）。
3. **对称 NAT / 打洞失败**：可选服务器**只做撮合与转发**（本样机）；或走双方已有的异步通道（邮件/微信/文件）。
4. **服务器永远不是必须的**：它只是"更容易连上"的加速器；不配服务器时退回 1/2/4。
5. **服务器可自建**：用户可以把样机跑在自己的内网/云主机上；协议是公开的 HTTP，不绑定我们的任何服务。

## 5. 若要上线，还缺什么（如实）
- 客户端接入 UI（添加服务器地址/二维码、在线状态、失败重试）——尚未接；
- 消息去重/过期（msgId+ts）与序号——协议已留字段，客户端未实现；
- 前向保密（Double Ratchet）与群密钥分发——未做；
- 消息的持久化与多实例（服务器刻意不落盘消息；凭据/配置/统计会落盘，见 §8）。

## 6. FWArmy（第 64 轮改名）：管理面、凭据、限流、统计、一键启停

- **程序名/目录**：产品 **FWArmy**（用户也写 FWAmry / fwamry），独立目录 `../FWArmy/`（不在 WArmy 仓库内；可用 `FWARMY_DIR` 覆盖）；第 63 轮以前叫 `relay-server/`。它与 WArmy 主应用分开安装、分开运行。
- **管理页**：`http://127.0.0.1:8787/`（**只允许本机回环直连**，即使业务面绑 0.0.0.0 也不对公网开放管理面）——**在服务器那台机器上打开即已连接，不再有管理密钥/登录步骤**（第 63 轮用户口径）；可生成/停用/删除**有名称**的凭据（明文只显示一次）、逐凭据改速度与日/月/年配额、看总数与逐凭据统计、探测公网 IP、开/关接客、关闭服务器。
- **本机管理边界（无密钥 ≠ 无边界）**：回环直连 + Host 必须是回环名（挡 DNS rebinding）+ 同源/无 Origin + POST 必须是 JSON（挡浏览器跨站请求）。最坏情况：同机其它本地进程/用户可直接调用管理接口 ⇒ 不要把服务器放在多人共用机器上，也不要把管理端口映射到公网。
- **凭据**：`POST /api/admin/credentials {name, limits?}` 返回 token（只此一次）；服务器只存 **sha256 哈希** + 名称 + 限额 + 状态。每个凭据可有名称、`ratePerMin`（请求/分，**不可不限**）、`bytesPerMin`（流量速度）、`dailyRequests/dailyBytes/monthlyRequests/monthlyBytes/totalRequests/totalBytes/yearlyBytes`（日/月/总次数与流量、年流量）、`disabled`；留空继承全局，0 = 不限（分钟两项必须 >0）。删除必须带 `confirmName`（管理页要求再输入一次名称）。
- **首次启动**：**不自动生成凭据**（第 65 轮用户口径）；在管理页点「生成凭据」手动创建，可创建多个。明文只在生成时显示一次；服务器只存 sha256。旧版本遗留的 `data/first-credential.txt` 仍可在管理页确认后删除。日志不写凭据明文。
- **业务面**：`register/lookup/relay/poll/bye/heartbeat` 都必须 `Authorization: Bearer <凭据>`，否则 401；心跳/取信/下线还必须有 did 私钥签名。
- **流量控制**：每凭据每分钟请求数（令牌桶，允许一分钟突发）、每分钟字节数、日/月/总次数与字节、年字节配额；全局默认 + 单凭据覆盖；单信封 ≤64KB、每收件人队列 ≤50；`/api/admin/config` 可调。旧凭据里的 `ratePerMin/dailyBytes` 会迁移成该凭据覆盖值，不再丢弃。
- **统计**：`data/stats.json`（原子写；损坏改名为 `stats.corrupt-<时间戳>` 并按空表启动）。按服务器本机时区的日/月/年累计每凭据与总数的请求、上行/下行字节、转发/投递/拒绝/离线；峰值请求/分钟；最近 60 秒速度是内存窗口。重启不丢；删除凭据后历史仍计入总数。
- **一键启停**：`FWArmy.exe start|stop|status|table|console|cred-new|cred-list|cred-update|cred-disable|cred-enable|cred-delete|cred-default|stats|ip|switch`（源码模式把 `FWArmy.exe` 换成 `node ../FWArmy/ctl.mjs`）；
  start 以分离进程运行、PID 写 `data/server.pid`；stop 先确认健康检查返回 `fwarmy-relay` 再杀（PID 被复用时拒绝误杀，挂死时用 `--force`）。
- **单文件与无界面**：Windows `dist/FWArmy.exe`（Node SEA，构建于目标平台）；`fwarmy-headless.bat` 隐藏窗口、不开浏览器、写 `data/server.log`；`fwarmy-console.bat` 用对齐表格看状态/凭据/日/月/年统计。macOS/Linux 用 `build-sea.sh` 在目标系统构建（未做公证/安装包）。
- **仍只存凭据/配置/统计，不存消息**：队列在内存、TTL 30 秒；日志只记方法/路径/状态/耗时/凭据哈希前缀，不记 query、正文、消息明文或凭据明文。

## 7. 客户端网络配置（第 59 轮口径，已落逻辑层）
- 设置里可配 **公网 IP / 自己的网关**，并可添加**多个服务器**（地址 + 凭据，名称防混淆）。
- **每个会话（联系人/群聊/项目）单独选择用哪些网络**，可多选；第四列会有「网络设置」卡（UI 待接）。
- 发送时把消息发给该会话配置的**所有**网络；**任一送达即送达**，其它失败逐台记录、重试（`touDiDaoSuoYou`，门禁 20/0）。
- 规则：**局域网或有公网 IP ⇒ 可不配服务器；两者都没有 ⇒ 必须至少一个服务器**（`wangLuoGouYong` 明确拒绝并说明原因）。
- 持久化：`userData/net.json`（服务器列表/公网 IP/网关）+ `userData/net-bindings.json`（会话→服务器 id 列表），tmp+rename。

## 8. 统计口径与数据目录（FWArmy）

- 字节口径 = **信封字符串长度**（上行入队 + 下行取走），不含 HTTP 头/TLS/连接开销；请求数 = HTTP 业务请求（`lookup/register/relay/poll/bye/heartbeat/presence`），心跳也算。
- 日/月/年按**服务器本机时区**切分；最近 60 秒速度是内存窗口（重启归零），峰值/分钟落盘保留。
- `data/credentials.json`：凭据 sha256 + 名称 + `limits`（`ratePerMin/bytesPerMin/dailyRequests/dailyBytes/monthlyRequests/monthlyBytes/totalRequests/totalBytes/yearlyBytes`，`null`=继承，`0`=不限，分钟两项不可为 0）+ `disabled` + 创建/最近使用时间；**不存明文 token**（旧版首次引导文件除外）。
- `data/config.json`：全局默认（旧字段兼容）；`data/stats.json`：分桶统计；`data/server.log`：运行日志（5 MB 轮转）；`data/instance.json`/`server.pid`：单实例与 stop 识别；`data/.initialized`：防止删光凭据后重启又自动生成。
- 默认目录：单文件在 exe 旁 `data/`，源码在 `../FWArmy/data/`；`--data=` 或 `FWARMY_DATA` 覆盖，旧 `WARMY_RELAY_DATA` 兼容。
- 管理 JSON：`GET /api/admin/stats` 返回 `totals`（累计 + today/month/year + speed + peak）与 `perCredential[]`（`limits` 原始继承值、`effective` 生效值、`total/today/month/year`、`speed`、`peakPerMin`、`lastUsed`）。
