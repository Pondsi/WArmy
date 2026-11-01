# 第 122 轮决定与实现记录（Electron 45 / 公开可发现 C / 志愿者中继 B 讨论）

> 日期：2026-10-30
> 关联：`DECISIONS-R121.md`、`ADR/003-去中心化组网与身份认证-需求记录与评审.md`、`PROJECT-AUDIT-R118.md`（W07/W09）

---

## 1. Electron 大版本升级（用户第 8 项，优先）

### 1.1 版本与安装

| 项 | 结果 |
| :--- | :--- |
| 升级前 | Electron `40.10.6` |
| 最新稳定版 | Electron `45.1.0`（`npm view electron version`，2026-10-30） |
| 升级后 | `@warmy/app-shell` devDependency `electron: 45.1.0`，`pnpm-lock.yaml` 已同步 |
| 安装方式 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm --filter @warmy/app-shell add -D electron@45.1.0` |
| 二进制核验 | `node_modules/.pnpm/electron@45.1.0/.../electron.exe --version` → `v45.1.0` |

### 1.2 Electron 45 的真实破坏性变更与修复

1. **剪贴板 API 被整体重写为 W3C 异步模型**（`clipboard.writeText` / `readText` 返回 Promise，`writeBuffer` / `readBuffer` 被移除）。
   - 真机症状：`tsc` 报 `Property 'writeBuffer' does not exist on type 'Clipboard'`。
   - 修复：`electron-main.ts` 的「复制文件本体」退路改成 `new ClipboardItem({'electron application/osclipboard;format="FileNameW"': Blob})`，主路径仍是 PowerShell `Set-Clipboard -LiteralPath`；`writeText` 改为 `await`。
   - 门禁：`verify-round20-esm` 由 grep `writeBuffer('FileNameW')` 改为断言新 MIME + 负向断言不再调用已移除 API。

2. **无边框窗口的 DWM 可见框偏移变化**：Electron 45 下 `BrowserWindow.getBounds()` 与原生 `SetWindowPos/GetWindowRect` 的可见左边框相差约 +7px（Windows 11，100% 缩放）。
   - 真机症状：`verify-r62-ui` 四条吸附断言都差 7px（非贴边 13 vs 6，贴边 13 vs 0，远处 127 vs 120）。
   - 修复：`tieBianZhuChuang()` 的吸附判定阈值从 `J=12` 调到 `J=24`，覆盖 DWM 边框；UI 门禁改为**先量 `frameDx` 再校正非贴边断言**，贴边断言仍要求贴到工作区。
   - 结果：`verify-r62-ui` 17/0。

3. 其它 API 面：主进程其余 `nativeImage / Tray / screen / WebContentsView / safeStorage / dialog` 在 45 下类型与行为未变；`pnpm --filter @warmy/app-shell build`（tsc -b + 语法门禁 + 资源拷贝）通过。

### 1.3 验证

- `pnpm --filter @warmy/app-shell build`：通过。
- `verify-r62-ui`：17/0（真实 Electron 45 + 原生 Win32 窗口句柄）。
- fast 门禁：单遍 `142/142` 项次、真红 0（`run-verify-22 --fast --times=1`）。
- 说明：打包器 `electron-builder@25.1.8` 对 45 的产物打包尚未在本轮重打安装包；W12 最终包重打时要再验一次（见第 4 节）。

---

## 2. 第 7 项决定 C：发现开放 + 消息走自选服务器（公开可发现默认关）

### 2.1 已落地内容

**产品默认**：`net.publicDiscoverable` 缺省为 `false`。应用启动/组网启动时**不会**因为「能连网」就发布自己；只有用户在「设置 → 网络与主机 → 公开可发现」里显式勾选、填入至少一个引导节点并保存，才启动 DHT 发布。

**发现层（新增 `packages/app-shell/src/public-discovery.ts`）**：

- 复用已有 `@warmy/sync-protocol` 的最小 Kademlia DHT（UDP，签名记录 + 加密内容）。
- 发布记录只含：身份指纹 `fp`、可达地址 `host`、TCP 端口 `port`、`scope:'public'`、发布时间、别名 `bieMing`、`extra.kind='warmy-playground'`。**不含任何聊天正文/文件名/记忆内容**。
- 记录用固定公开发现密钥加密 + 身份私钥签名：任何拿到该公开密钥的人可读，但**伪造/篡改会让验签失败**；记录键是指纹的 SHA-256 哈希，DHT 上不直接暴露指纹明文。
- 记录 TTL 30 分钟，在线时每 10 分钟重发；关闭开关**立即停止发布**，但已发布记录会在 TTL 内自然过期——UI 与文档都如实写明「关闭不是瞬时撤销」，不谎称已撤回。
- 启动前置条件缺一即如实失败：未打开组网 → `mesh-not-running`；没有引导节点 → `bootstrap-required`；没有可宣告地址 → `advertise-host-required`；身份未解锁 → `identity-unlocked` 类错误。启动失败会把设置退回 `false`，避免「界面写着已公开、实际没发布」。

**消息路径不变**：聊天/项目/群消息仍走 `SecureMesh`（已鉴权的 Ed25519 + X25519 握手）直连用户自选的主机/服务器；DHT 只返回地址，不转发任何消息。这满足 C 的「消息走自选服务器」。

**审计**：`net.discoverable-on` / `net.discoverable-off` / `net.discoverable-on-failed` / `net.discovery-publish` / `net.discovery-publish-failed` / `net.discovery-stop` / `net.discovery-start-failed`。

**界面**：网络卡新增折叠区「公开可发现（默认关）」：开关、引导节点文本域（host 或 host:port，默认 7800，最多 10 个）、本机 UDP 端口、对外宣告地址、保存并应用、实时状态（UDP 端口/节点数/已存节点数）。文案明确列出「地址、端口、身份指纹、在线时间会被任何人读到」。

**门禁**：`verify-r122-discovery` 31/0：
- 设置默认不发布；主进程只在 `publicDiscoverable === true` 时自动启动；IPC/preload/UI/审计/10 语言键齐全；
- 真实 UDP DHT 三节点：发布 → 另一节点按指纹查到地址；无公开发现密钥者读不到；篡改记录验签失败；关闭后停止发布但记录在 TTL 内仍可被查到（诚实语义）；
- 负向：删掉引导节点检查/默认关门控，判据转红。

### 2.2 本轮没有做（诚实边界）

- **没有内置公共引导节点**：C 是「发现开放」，引导节点由用户自选（可以是自己的公网服务器）。不内置任何第三方 DHT 引导，避免默认把用户元数据交给未知运营者。
- **没有做 NAT 穿透/中继**：发现只解决「知道地址」；双 CGNAT/无公网地址仍连不上（连接阶梯已如实显示）。
- **没有做匿名性**：公开可发现会暴露「某指纹在某地址在线」这一事实；加密只保护记录内容不被篡改/被无密钥者读取，不隐藏记录存在与更新时机。
- **没有做志愿者中继（B）**：见第 3 节。

---

## 3. 关于 B（志愿者中继）的讨论：把五个问题逐条说清

> 结论先行：**B 不应作为当前起步方案**。它是一个「有公网节点的人替没有公网节点的人转发字节」的开放市场，技术上可行，但**滥用、计费、DDoS、法律与隐私**四面都要有运营能力；C（发现开放 + 消息走自选服务器）先把「能找到、能连上自己的服务器」做扎实，B 留作后续可选层。下面按用户提的五个问题给出可落地的设计与最坏情况。

### 3.1 如何发现志愿者中继？

**候选方案**：

| 方案 | 做法 | 优点 | 缺点 |
| :--- | :--- | :--- | :--- |
| A. 签名中继目录 | 运营方/社区维护一份签名 JSON：relayId、地址、公钥、容量、地域、价格（免费/捐赠）、有效期 | 简单、可审计、可下架 | 目录本身是单点/审查点；谁维护谁负责 |
| B. DHT 中继记录 | 中继把自己的 `relay` 记录发布到与 C 相同的 DHT（签名 + 公开密钥），客户端按能力/地域查询 | 无中心目录、抗下架 | 记录可被刷量；Sybil 可伪造大量「中继」；需要信誉权重 |
| C. 邀请/已知列表 | 只接受用户手动添加或朋友分享的中继地址 | 无滥用入口、信任链清楚 | 不能形成「志愿者网络」规模 |
| D. 混合 | 目录 + DHT 记录 + 本地信誉（成功转发率/延迟/在线时长）加权；用户可固定/排除某个中继 | 兼顾发现与抗刷 | 实现与运营复杂度最高 |

**建议（若将来做 B）**：先做 **A + C**（签名目录 + 手动添加），DHT 记录只作为目录的补充，不单独作为信任来源；客户端按「最近成功率高、延迟低、容量未满」排序，并允许用户固定/排除。目录条目必须有运营者公钥签名、过期时间、撤回列表；客户端缓存但过期即弃。

### 3.2 如何防止志愿者中继伪装传递消息？

关键认知：**中继只是字节管道，不是信任方**。防伪装不能靠「相信中继说他转给了谁」，而要靠**端点之间的端到端认证**：

1. **现有 SecureMesh 握手已经解决「对端是谁」**：Ed25519 双向签名 + X25519 ECDHE + 名册/指纹 pin；中继即使篡改路由，也无法让 A 相信它在和 B 说话（除非持有 B 的私钥）。
2. **每条消息绑定发送者/收件人/会话/序号**（现有 `ChuanShuZhen` + 重放防护）；中继重放/重排/丢包只会导致校验失败或超时，不会产生「假消息」。
3. **中继身份单独签名**：中继描述符（relayId、公钥、地址、容量）由中继私钥签名；客户端 pin 中继公钥，防止「中间人替换中继地址」。
4. **不把中继的 ACK 当业务 ACK**：业务 ACK 必须由最终收件人签名/加密返回（W07 的 outbox/业务 ACK 仍待做）。
5. **发现层与消息层分离**：中继只能看到「谁在什么时候连了哪个地址」这类元数据，不能修改端到端密文。

**最坏情况**：恶意中继可以**丢弃/延迟/重排**流量（拒绝服务），也可以**观察元数据**；但它不能伪造消息内容或冒充端点。这一条必须在 UI 文案里写清，不能把「中继」说成「安全通道」。

### 3.3 中继自身如何防止被攻击？

中继是公开 IP + 固定端口的 UDP/TCP 服务，天然是 DDoS 与滥用靶子。最低限度：

1. **每源限速 + 每身份配额**：按 IP/网段 + 中继公钥维度做令牌桶；单连接最大字节数、最大并发电路数、单日流量上限；超限直接拒绝并记审计。
2. **握手前不分配昂贵资源**：先做轻量 challenge（cookie/工作量证明可选项），验证后再建会话；防止 SYN/UDP 放大。
3. **不反射/不放大**：中继不回显任意 payload；只转发已配对电路内的密文帧，帧长上限固定。
4. **隔离进程**：中继运行在独立进程/容器，禁止 shell、禁止访问本机文件；崩溃不影响宿主；只保留最小日志（连接元数据，不含 payload）。
5. **可撤销与黑名单**：运营者可一键下线某个中继/封禁滥用来源；客户端目录同步撤回列表。
6. **监控与熔断**：连接数/带宽/错误率超阈值自动降级或停止接单；避免把志愿者家宽打满。
7. **法律与滥用边界**：中继运营者可能被要求配合调查；必须明确「中继只转发密文、不存储内容」，并保留可审计的运营日志（谁在何时用了多少流量），但不记录 payload。

**未解决**：Sybil 刷量（大量假中继占坑）、DDoS 的带宽成本、志愿者被滥用后的追责。这些是运营问题，不是纯代码能解决的。

### 3.4 如何防止被中继窃取消息？

1. **端到端加密是唯一硬保证**：现有 `SecureSync` 的会话密钥只在中继两端，中继拿不到私钥，因此拿不到明文；中继只能看到握手帧元数据（指纹、nonce、X25519 公钥、签名）。
2. **中继不参与密钥协商**：不能用「中继终结 TLS 再重加密」的代理模式；必须是字节级隧道（现有 `ZhongJiJieDian` 即按此设计）。
3. **元数据最小化**：中继记录只保留连接时间、字节数、中继 ID，不记录目标指纹明文（可用哈希）；日志保留期尽量短。
4. **流量填充/混淆（未实现）**：要隐藏消息长度与节奏，需要 padding/cover traffic；这会增加带宽成本，B 阶段再评估。
5. **密钥轮换与前向保密**：现有每连接 ECDHE 已提供前向保密；长期身份密钥泄露不影响历史会话（前提是私钥在 safeStorage）。
6. **中继不可信时的降级**：允许用户选择「只直连、不走中继」；走中继时 UI 明确标注「经中继（更慢，但可用）」，并显示中继 ID。

**诚实结论**：中继**看不到聊天明文**，但**看得到元数据**（谁和谁在何时通信、流量大小）。「中继看不到任何信息」是不成立的；要隐藏元数据必须做流量混淆，成本高且未实现。

### 3.5 志愿者中继如何被项目使用者发现和使用？

**推荐的使用流程（B 阶段）**：

1. 用户在「设置 → 网络」看到「中继」区块：默认关闭；可手动添加中继地址，或从签名目录导入。
2. 客户端对每个候选中继做**真实拨测**（TCP/UDP + 握手 + 小帧回显），记录延迟、成功率、当前容量；不可用/超时的中继灰度显示，不自动选用。
3. 连接阶梯：直连 → 打洞 → 中继；只有前两档都失败才自动用中继；用户可强制「只用直连」或「固定某个中继」。
4. UI 显示当前走的是哪条路、中继 ID、延迟与已用流量；可一键断开中继。
5. 计费（若将来有）：免费/捐赠中继显示配额；付费中继显示价格与余额；不允许中继在用户不知情时扣费。
6. 信誉：本地记录每个中继的成功率/延迟/断线次数；目录可提供签名过的运营者信息，但**不把中心评分当唯一依据**。

**C 阶段现状**：以上「中继」区块尚未出现；现有连接阶梯已把「中继」标为「需配置/未接入」，不假装可用。

### 3.6 为什么现在选 C 而不是 B

| 维度 | C（现状） | B（志愿者中继） |
| :--- | :--- | :--- |
| 可用性 | 有公网服务器/主机的人可连；双 CGNAT 仍不可用 | 理论必通，但依赖有人愿意长期提供带宽 |
| 安全 | 端到端认证 + 自选服务器，攻击面小 | 多一层公开服务，DDoS/滥用/法律面显著扩大 |
| 运营 | 无中心运营 | 需要目录、信誉、滥用处置、计费/捐赠、客服 |
| 隐私 | 只有对端看到彼此地址 | 中继看到元数据；需要额外混淆 |
| 实现成本 | 已落地发布/查询 + 默认关 | 目录/信誉/限速/配额/监控/计费，至少一个独立子系统 |

**建议的后续顺序**：先完成 W07（outbox/业务 ACK/角色/外部群）与 W09（Electron 打包/签名）→ 有真实多设备用户后，再评估 B 的目录与限速；B 的第一版只做「手动添加中继 + 固定使用」，不做自动发现与计费。

---

## 4. 第 122 轮遗留与下一步

1. **B 的实现未开始**：本轮只交讨论与 C 的落地；如果用户决定做 B，需要先拍板「目录由谁运营 / 是否允许付费 / 是否做流量混淆」。
2. **C 的引导节点需要用户自备**：本轮没有内置公共节点；真机双设备测试时可用用户自己的公网服务器做引导（见第 5 节）。
3. **Electron 45 安装包未重打**：W12 最终包需要重新 `electron-builder` 并做安装/升级/数据保留验证；本轮只验证了开发态与门禁。
4. **W05/W07/W08 接收/W09 签名 manifest/W11 十轮/W12 最终包**仍未完成（见 `HANDOFF-NEXT.md`）。

---

## 5. 第 9 项：真实第二台设备与公网/NAT 测试（记录位）

> 本节在测试完成后补实测证据；约束：只建专用目录、不动现有服务/文件、测试后清理（用户验收可保留）。

**已确认的设备事实（只读探测，2026-10-30）**：

| 设备 | 地址 | 开放端口（探测） | 凭证 |
| :--- | :--- | :--- | :--- |
| 局域网 Windows | `192.168.1.123` | `3389`（RDP）、`445`（SMB）；`5985/5986/22/59599/7799` 关闭 | 本机凭据管理器 `TERMSRV/192.168.1.123`（MicrosoftAccount） |
| 公网香港服务器 | `103.140.228.207` | `3389`（RDP）；`445/5985/5986/22/59599/7799` 关闭 | 本机凭据管理器 `TERMSRV/103.140.228.207`（MicrosoftAccount\administrator） |

两台设备的远程桌面窗口当前都在本机桌面打开（窗口标题含 IP）。后续只在专用目录（建议 `C:\WArmy-Test-<date>` / `D:\WArmy-Test-<date>`）内放置测试程序与数据，不改动既有服务与文件。

### 5.1 结论速览（2026-10-30 实测）

| 项 | 结果 | 说明 |
| :--- | :--- | :--- |
| 局域网双向安全同步 | **通过** | 两台真机、真实 `sync-protocol` 构建，非 mock |
| DHT 发布 → 查询 → 连接 | **通过** | 修复种子自报地址缺陷后，用 DHT 返回的地址完成握手与 ACK |
| 公网直连自建服务器（VPS） | **未通过** | 服务商 1:1 NAT 只映射了 3389；Windows 侧已放行仍不可达 |
| 家庭 NAT 入站 | **未通过（符合预期）** | 无端口映射，外网无法主动连入 |
| 公网 DHT（UDP 7800） | **未验证** | 与 TCP 同因：入站 UDP 被云侧拦截，未取得服务商控制台权限 |

### 5.2 方法

- 测试程序：`.tmp-r122-harness/e2e.mjs`（直接 import 项目 `sync-protocol` 的构建产物，无替身）。两端都用 `fingerprintDerivation: warmyZhiWen`，否则 pin 必错。
- 身份可复现：`seed = sha256("warmy-e2e-v1|<label>") → ed25519FromSeed → warmyZhiWen`，同一 label 在两台机器上得到同一指纹。
- 设备：本机（`192.168.1.6`，家庭公网出口 `144.168.59.11`）、局域网第二台（`192.168.1.123`）、公网香港 VPS（`103.140.228.207`，网卡实为 `172.16.0.192`，OpenStack 1:1 NAT）。
- 两台远端通过本机 RDP 会话操作；LAN 侧程序用 base64 文本剪贴板搬运。

### 5.3 实测证据

**A. 局域网双向（真实握手 + 群消息 + ACK）**

| 方向 | 输出 |
| :--- | :--- |
| 本机 → `192.168.1.123:59599` | `CONNECTED BFNWGTPKUDH25N34RPSQLNT2DAGQPJAMMX62QHMZOLHIUXVRWCPA KEY a128cb91b3c0dbba TOFU true` → `SENT m-d1ecbeae5b26` → `ACK` |
| `192.168.1.123` → 本机 `192.168.1.6:59599` | `CONNECTED INFOCY3Z5DDSTPQPZNJCOEWPQQVZ4KFU6XIZMTJ6THHKW4RQQQ KEY c6ebf0d3a3dd0519 TOFU true` → `SENT m-bb4694fffc11` → `ACK` |
| 负向：pin 不符 | 服务端拒绝，`pin-mismatch`（未因"能连上"而放行） |

**B. DHT 发现 → 安全连接（跨设备）**

| 步骤 | 输出 |
| :--- | :--- |
| 本机种子节点 | `DHT_SEED 0.0.0.0:7800 FP DWNW6VBCNCWQGKUBUQWJYI7RPWKGS5VJZZ7MRVWGFBEZIIOVQOMQ`（`--advertise-host 192.168.1.6`） |
| LAN 发布本机服务端记录 | `PUBLISHED QBUTSMFGVJNEJP3YMWASNH7XH2EEYJVSHA7OANQAQMQY2NRCWT5A SEQ 1 STORED 192.168.1.6:7800 BOOT {"ok":1,"failed":0}` |
| LAN 按指纹查询 | `FOUND 192.168.1.6:59599 ALIAS local-dht-server` |
| LAN 用查到的地址连接 | `CONNECTED QBUTSMFGVJNEJP3YMWASNH7XH2EEYJVSHA7OANQAQMQY2NRCWT5A KEY 6cd643350654a5e TOFU true` → `SENT m-13e8b2426c9f` → `ACK` |
| 本机服务端 | `SESSION 5HLGWKUZV7DLK5NPLGYVDROAYYG2AYYIUH4NH2E7VLA4CMFXA6FA inbound`；`RECV m-13e8b2426c9f group {"text":"DHT-DISCOVERY-E2E-20261030",...}` |

**C. 公网直连（香港 VPS）**

| 测试 | 结果 |
| :--- | :--- |
| 本机 → `103.140.228.207:3389` | `True`（公网映射本身存在） |
| 本机 → `103.140.228.207:59599` | `FAIL TCP 连接超时 8000ms` |
| 本机 → `103.140.228.207:8080`（另起监听对照） | `FAIL TCP 连接超时 8000ms` |
| HK 本机 `127.0.0.1:59599` | `TcpTestSucceeded: True` |
| HK 网卡私网 `172.16.0.192:8080` | `TcpTestSucceeded: True`（监听与防火墙放行都正常） |
| HK → 自身公网 `103.140.228.207:59599` | `TcpTestSucceeded: False`（无发夹 NAT） |
| HK `ipconfig` | `172.16.0.192/24`，网关 `172.16.0.1`，DNS 后缀 `openstacklocal` ⇒ 1:1 NAT |
| HK 防火墙规则 | `WArmy-E2E-TCP`(59599)/`WArmy-E2E-TCP8080`：已启用、入站、域/专用/公用、允许 |

结论：**拦截点在云侧（安全组/浮动 IP 只放行 3389），不是 Windows 防火墙**。要跑真公网直连，必须在服务商控制台放行 TCP 59599（或做端口映射）；本轮没有服务商控制台凭据，未改云侧配置。

**D. 家庭 NAT 入站**

| 测试 | 结果 |
| :--- | :--- |
| HK → `144.168.59.11:59599`（家庭公网） | `TCP connect to (144.168.59.11 : 59599) failed` / `False` |
| LAN → `192.168.1.6:59599` | 通过（见 A/B） |

同一台本机在局域网可达、从公网不可达，符合"家用路由器未做端口映射"的预期；WArmy 的连接阶梯应如实显示该档不可用，而不是假装能连。

### 5.4 本轮发现并修复的真实缺陷：DHT 种子自报 `127.0.0.1`

- **症状**：种子节点以 `0.0.0.0` 绑定时，`ping/find_node` 回包里的自身联系地址是 `127.0.0.1`。对端 `learn()` 会把它当成种子的地址，后续 `store/get` RPC 全打向 `127.0.0.1`。
- **首轮实测**：LAN 发布返回 `STORED (none)`，查询 `NOT_FOUND`，`attempts` 里赫然是 `127.0.0.1:7800`。
- **修复**：`DhtJieDianXuanXiang` 新增 `advertiseHost`；`selfWireContact()` 与默认发布记录在绑定 `0.0.0.0` 时优先使用它；`public-discovery.ts` 把它传给 DHT（该层本来就强制要求 `advertiseHost`）。
- **为什么不用"对端来源地址"回填**：UDP 接收方只拿得到对方源地址，拿不到"对方用来找到我的那个地址"；把源地址当种子地址会指错。对外地址必须显式配置。
- **门禁**：`verify-r122-discovery` 加两条——正向（`0.0.0.0` + `advertiseHost 192.0.2.10` ⇒ 对端学到 `192.0.2.10`）、负向（不给 `advertiseHost` ⇒ 仍是 `127.0.0.1`，即修复前形态）。当前 `31 ok / 0 FAIL`；`packages/sync-protocol/scripts/verify-dht.mjs` `48 通过 / 0 失败`。
- **边界**：这修的是"种子/中继必须声明对外地址"，**不是** NAT 穿透；双 CGNAT 仍然连不上。

### 5.5 清理与环境恢复

- 香港 VPS：结束测试进程（59599/8080）、删除防火墙规则 `WArmy-E2E-TCP`/`WArmy-E2E-UDP`/`WArmy-E2E-TCP8080`、删除 `C:\WArmy-E2E-20261030`，复核无监听、无规则、无目录。
- 局域网第二台：结束遗留测试服务端（PID 20224）、删除 `C:\WArmy-E2E-20261030`，`Test-Path` 为 `False`。
- 本机：停止全部测试服务端/种子进程，`netstat` 复核无 59599/7800 监听；删除全部 `.tmp-r122-*` 临时产物（harness、压缩包、传输脚本、截图）。
- 测试期间只在专用目录内建文件，未改动两台机器上既有服务与文件。

---

## 6. W07：网络投递 outbox + 业务 ACK（本轮落地）

**新增 `packages/app-shell/src/wang-luo-tou-di.ts`**：

- 收件人级持久化发件箱：`<userData>/net/outbox/<sha256(fp)>.jsonl`，每行一条完整记录，写入后 `fsync`；
- 五状态分开：`saved`（已落本机）/`sending`（已发出、等回执）/`persisted`（对端已写盘）/`read`（对端已读）/`failed`（达到上限，如实失败）；
- 重启恢复：`sending` 一律回到 `saved` 重新排期（**不把"发过"当"送达"**）；
- 幂等：同一 `msgId + recipientFp` 重复入队不新增、不改写内容；对端重复帧只执行一次副作用，但**每次回 ACK**；
- 退避：默认 500ms×2^n，上限 30s，最多 10 次；到顶转 `failed` 并审计，不伪装已送达；
- 回执只认收件人本人：`toudi-ack` 里的 msgId 必须属于该 peer 的发件箱记录，伪造 peer 一律 ignore。

**接线**：

- `chatNetSend` 在真正拨号前先 `enqueue`；发件箱落盘失败直接拒绝发送（不制造"发出去了但重启就没了"）；
- 入站聊天帧在**写完本地日志之后**才通过同一会话回 `{type:'toudi-ack',persisted:[msgId]}`；重复帧跳过写入但仍回 ACK；
- `SecureMesh.sendControlToPeer(fp, payload)`：只走已建立的鉴权会话，不为了回执新拨号；
- 组网启用时启动续投定时器（20s，unref），对端 `online` 事件触发立即续投；
- IPC `warmy:chatTouDiZhuangTai` 返回 `stats` 与会话级记录（供界面显示；本轮未改聊天 DOM 的送达角标）。

**门禁**：`verify-r122-w07-toudi` 28/0（纯发件箱语义 11 条 + 真握手集成 17 条，含离线保留、落盘失败不 ACK、重复只执行一次、伪造回执被忽略、重启续投）。

**仍未做（诚实边界）**：聊天界面还没有"已送达/已读"角标；读回执只提供协议与 API，尚未由"打开会话"触发。角色矩阵与外部群 @ 规则沿用前几轮已有实现，本轮未改。

**续做（已补）**：聊天标题副行现在显示网络投递状态（`待确认 N · 已送达 M · 已读 K · 未送达 F`，数据来自 `chatTouDiZhuangTai`）；打开会话即对已落盘入站消息回 `read` 回执，并在会话打开期间每 5 秒补发/刷新。IPC：`warmy:chatTouDiZhuangTai` / `warmy:chatNetRead`。

---

## 7. W08：企微/钉钉接收协议（本轮落地）

**新增 `packages/app-shell/src/she-jiao-jie-shou.ts`**（纯协议，不联网、不需真实账号）：

- 企微：`SHA1(sort(token,timestamp,nonce,encrypt))` 验签、`AES-256-CBC`（EncodingAESKey，IV=key[0..16]，PKCS#7）解密、16B 随机前缀 + 4B 长度 + 明文 + receiveId 结构校验、GET `echostr` 回显、POST 事件解析、应答 `success`；
- 钉钉：事件回调 `Base64(HMAC-SHA256(timestamp+"\n"+appSecret))` 验签 + ±1h 时间窗 + JSON 解析 + 应答 `{code:0}`；
- 去重持久化：按 `MsgId`/`eventId` 落 JSONL，默认 24h，跨实例（重启）仍判重；平台重试不会重复执行副作用；
- 错误一律如实返回（缺失参数/坏签名/坏填充/篡改密文/receiveId 不匹配/坏 JSON/时间戳超窗）。

**门禁**：`verify-r122-w08-receive` 19/0（正向 + 篡改 + 重放 + 跨实例去重 + 边界拒绝）。

**仍未做**：企微被动回复（加密 XML 长回复）未实现，当前统一回 `success`；钉钉 Stream 长连接仍依赖官方 SDK，未接入。两者都需要真实企业后台凭据才能做端到端验证。

**续做（已补）**：企微被动回复已实现——`jiaMi()` 按平台结构（16B 随机 + 4B 长度 + 明文 + receiveId + PKCS#7）加密，`gouZaoBeiDongHuiFu()` 生成 `<Encrypt><MsgSignature><TimeStamp><Nonce>` 包装，`gouZaoWenBenHuiFu()` 生成文本 XML；门禁增加"回复可解开、签名正确、签名被改即失败"三条，现 **23/0**。钉钉 Stream 仍未接入（需官方 SDK 与凭据）。

---

## 8. W09：签名更新清单（本轮落地）

- `GengXinQingDan` 增加 `signature`/`keyId`；新增 `qingDanQianMingWen()`（键排序、剔除签名字段）与 `yanZhengQingDanQianMing()`（Ed25519，base64 SPKI DER 公钥）；
- `Gengxinqi` 新增 `manifestPublicKey`；**配置公钥后**：清单无签名 → `invalid-response/signature-missing`，签名不匹配 → `bad-signature`，篡改任一字段即失效；
- 公钥只从环境变量 `WARMY_UPDATE_MANIFEST_PUBKEY` 读取（仓库不放密钥）；未配置时保持旧行为，并在文档里明确"未签名通道"；
- `sha256`/`size` 校验保持原样（feed 未声明 sha256 仍拒绝落盘）。

**门禁**：`verify-r122-w09-manifest` 10/0（有效签名、改版本失效、缺签名拒绝、坏公钥拒绝、同版本判定、未配置公钥兼容）。

**仍未做**：签名密钥的保管/轮换与真实发布签名不在本轮范围（需要用户决定密钥托管方式）。

---

## 9. W05：加密存储按数据类别覆盖（本轮核对）

`enc-fs` 在 userData 根部接管 fs，受管文件一律以 `WARMYEF2` 密封；显式豁免：`workspace/`（外部工具工作区）、`updates/`（下载包）、`logs/`、`identity/ auth/ secure/`（vault 自管）、`memory.db`（记忆进程自管）等。

**新增门禁** `verify-r122-w05-storage` 26/0：设置、聊天事实/投影、知识库、群/项目、资料、审计、队列、检查点八类文件逐一断言"磁盘密文 + 逻辑读还原"；JSONL 追加仍加密；旧明文（含 JSONL）可迁移；换错 key 读取被拒；未解锁时受管写入被拒（不落明文）；豁免路径按设计保持明文；首启允许写引导配置且仍加密。

**结论**：没有"全量替换掉全局 fs 包装"——本项目的加密边界**就是**该包装层；按类别门禁证明它覆盖了 W05 列出的全部事实/投影类别。**边界**：豁免目录不加密（各自有独立边界），这是既定设计，不是遗漏。

---

## 10. W12：最终安装包（本轮重建）

- Electron 45.1.0，版本升到 `0.2.30`；`pnpm --filter @warmy/app-shell build` 通过；
- `electron-builder --win nsis` 在**独立输出目录** `release-r122/` 打包，避免覆盖正在运行的 `release/win-unpacked`；
- 产物：`WArmy-Setup-0.2.30.exe`（175,818,722 B），已复制到 `release/`；`checksums.txt` 追加：
  `9fdef299e3c6b88c727bc1908c86ac44a9466d5ea2c050c03e10be27bc82600a  WArmy-Setup-0.2.30.exe`
- 冒烟：用独立 `--user-data-dir` 启动 `release-r122/win-unpacked/WARMY.exe`，15 秒仍存活；boot log 出现 `identity derivation ok` / `board…ready` / `memory ready` / `tray ready` / `window ready`；随后按 PID 结束。
- 全量 fast：147 项次、真红 0、`FAST_EXIT=0`；全包 `pnpm -r typecheck` 通过。
- **未做**：没有执行真实安装/升级（会动用户当前安装与数据），没有签名（无证书），没有推送发布。安装包与校验和只在本地归档。

---

## 11. 第 122 轮剩余（截至本轮结束）

1. **W11 十轮真实验收**：需要真实 MiMo/Ollama、串行桌面，单遍完整集耗时长；本轮只跑了全量 fast 门禁（离线）与新增四项定向门禁，**没有宣称十轮完成**。
2. **W07 界面角标/读回执触发**：协议与 IPC ready，聊天 DOM 未显示"已送达/已读"。
3. **W08 被动回复 + 钉钉 Stream**：需要企业后台凭据。
4. **W09 密钥保管/轮换**：需要用户决定托管方式。
5. **公网直连**：VPS 端口映射仍需服务商控制台（见 §5）。

### 11.1 本轮修正的两条门禁口径（有原因，不是放宽）

- `verify-docs`：原来断言 `feed.version === package.json.version`。候选包未发布时这会逼着文档/feed 指向一个不存在的下载。改为 **feed 不得新于 package**，资产名按 **feed 版本**（已发布）核对；README/说明仍指向 0.2.29 的真实下载。
- `verify-gate-manifest`：原来只扫描 `packages/app-shell/scripts/`，导致清单里登记在 `dev/gates/` 的门禁被误判"磁盘上不存在"。改为按每条 `file` 字段核对存在性；双向一致仍只针对 app-shell 脚本目录。两条都做了反向自证（坏清单判红）。

---

## 12. 第 122 轮追加：真实能力、平台与发布规则（2026-10-30）

### 12.1 模型能力盘点（只列实测/接口事实）

| 来源 | 有的能力 | 没有的能力 |
| :--- | :--- | :--- |
| Ollama（本机已装模型） | 文本对话、视觉理解（`clef`/`qwen3-vl` 等）、ASR（`dimavz/whisper-tiny`） | **无图像生成、无视频生成、无 TTS** |
| MiMo（token-plan） | `mimo-v2.5-tts` / `mimo-v2.5-tts-voiceclone` / `mimo-v2.5-tts-voicedesign` / `mimo-v2.5-asr` + 文本模型 | **无图像模型、无视频模型** |
| ComfyUI（`F:\ComfyUIZH`，RTX 4090 24GB） | 图像：SD1.5 / Flux / SD3 / Qwen-Image；视频：SVD、LTX-2 19B fp8、LTX-2.3 22B fp8、HunyuanVideo15 节点；音频：ACE-Step、qwen3-tts 节点；保存节点 `SaveImage` / `SaveWEBM` / `SaveVideo` / `SaveAudio` | 需要本机启动（默认 8188），不是云 API |

### 12.2 真实生成实测（不是夹具）

| 能力 | 调用 | 结果 |
| :--- | :--- | :--- |
| TTS | MiMo `mimo-v2.5-tts`（`messages` 必须带 assistant 占位；`modalities:['text','audio']`） | 200，返回 WAV：`RIFF/WAVE`，24 kHz 单声道 16-bit，38,444 B，约 0.8 s |
| 图像 | ComfyUI `/prompt`：SD1.5 `majicmixRealistic_v7`，512×512，20 步 | `r122_img_00001_.png`，512×512，286,296 B |
| 视频 | ComfyUI `/prompt`：SVD `svd_xt_1_1` + 上一步图像，14 帧 512×512 | `r122_vid_00001_.webm`，VP9，19,108 B，真实 WebM 容器 |

测试后已停止 ComfyUI（PID 35544）并删除 `output/input` 里的测试产物；没有改动 ComfyUI 的模型与配置。

**产品接入现状（诚实）**：`packages/providers/src/audio.ts` 已有 MiMo TTS/ASR 请求构造；`mo-xing-neng-li.ts` 只做"画图/做视频"模型分类，**没有**图像/视频生成调用实现。ComfyUI 目前是"能力已证明、尚未接入工具链"（工作流与参数已跑通，可直接做成 `image_generate` / `video_generate` 工具）。

**本轮已接入**（2026-10-30 续做）：`packages/providers/src/comfyui.ts`（`ComfyUiKeHu`：健康检查、从 `/object_info` 读真实 checkpoint、文生图、SVD 图生视频、上传首帧、轮询 `/history`、下载产物、取消/超时/失败如实返回）；`work-tools.ts` + `electron-main.ts` 新增宿主工具 `image_generate` / `video_generate`（产物写会话工作区 `generated/`，失败不伪造）。门禁 `verify-r122-comfyui` **10 ok / 0 FAIL**（真实 256×256 PNG、8 帧 WebM、服务不可达与取消两条负向），需要本机 ComfyUI 在跑，缺失时如实 `BLOCKED`（exit 2）。

### 12.3 物理 4K / 多屏 / macOS / IM / 签名

| 项 | 事实 | 结论 |
| :--- | :--- | :--- |
| 物理显示器 | `3440×1440`、`2560×1440`、`1920×1080`（RDP 虚拟屏） | 本机**没有 3840×2160 物理屏**；4K 只能用 CDP 仿真验证 |
| 4K/高 DPI 布局 | `verify-r103-4k`（CDP 3840×2160@100%、1920×1080@200%、2560×1440@150%、960×600） | **40 ok / 0 FAIL**；物理像素效果仍需真 4K 屏人工确认 |
| 多屏 | 三块屏已枚举；跨屏吸附/最大化有既有门禁 | 逻辑尺寸可验；真实缩放/任务栏组合仍属"物理环境"项 |
| macOS | 无 macOS 主机/构建机 | **BLOCKED**（无法真实跑 macOS 包） |
| 真实 IM 账号 | app 设置是加密落盘，无法读出可用账号；微信/企微/钉钉都需要扫码或企业后台授权 | **BLOCKED**（需要用户当场扫码/授权） |
| 代码签名 | `Cert:\CurrentUser\My` 无代码签名证书；无 `signtool`；无 Apple 开发者凭据 | **BLOCKED**（无证书无法签，公证还需 Apple 账号） |

### 12.4 发布授权与发布口径（用户已授权，但本轮未发布）

用户已明确授权：**全部完成后发布到 GitHub**。发布范围与语言规则：

1. **只发布项目本身代码等必要内容**；配置文件、测试内容、交接文档等非必要文件**不发布**。
2. 必须发布的非必要文件只有三个：`说明.md`、`LICENSE`、`SPONSORS.md`。
3. 除代码注释与上述三个文件外，其余发布文件必须**全英文**；代码引用/变量/项目必须的非英文内容（如 i18n 语言包）除外。
4. 发布是对外可见动作，只在"全部完成"后执行；本轮仍**未满足**（12.2 的 ComfyUI 工具接入、12.3 的 4K/macOS/IM/签名、W11 十轮都未完成）。

**发布前检查清单（落地用）**：
- 允许清单：`packages/**/src/**`、构建所需清单（根/包 `package.json`、`pnpm-lock.yaml`、`tsconfig*.json`、`electron-builder.yml`、`build/` 图标）、`LICENSE`、`说明.md`、`SPONSORS.md`；
- 排除：`docs/`、`dev/`、`scripts/`（测试/校验）、`release/`、`feed/`、`checksums.txt`、`.tmp*`、本地配置/凭据、profile、日志；
- 英文审计：对允许清单里非代码文件（json/yaml/md）做非 ASCII 扫描，除 `说明.md`/`LICENSE`/`SPONSORS.md` 外必须为 0；
- 秘密扫描：token/key/cookie/路径/主机名 0 命中；
- 发布通道：Git Data API（本机 git push 到 github.com 会挂）；凭据在 Windows 凭据管理器（存在 `git:https://github.com` / `x-access-token@github.com` / `api.github.com/Pondsi` 条目），**本轮未读取、未使用**。

**已落地**：`scripts/prepare-publish.mjs`（默认只审计；`--stage` 复制到 `../_publish/WArmy`）。当前审计：允许清单 **429** 个文件、非代码英文审计 **0** 处、秘密/本机信息 **0** 处；已暂存到 `_publish/WArmy`（未发布）。暂存前已把 `package.json` 描述改成英文、移除 i18n 里的个人 QQ 邮箱、删除 mesh 广播里写死的 `192.168.1.255`、预览默认地址改为文档保留段 `192.0.2.x`。

---

## 13. 第 122 轮追加 UI/运行时修复（用户第 15–18 项）

### 13.1 dsh 状态误报“未安装”
- **根因**：dsh 只在开发仓库 `spikes/spike-05-plugins/node_modules` 里，安装包的 `resources` 没带；打包态检测路径也不含项目目录 ⇒ 设置页如实报“未安装”。
- **修复**：`electron-builder.yml` 增加 `spikes/spike-05-plugins/node_modules → resources/warmy-dsh/node_modules`；`dshHouXuanLuJing()` 增加 `process.resourcesPath/warmy-dsh/...` 与 `app.getAppPath()/../../spikes/...`。
- **验证**：开发态 `dshStatus` = `ok:true`；打包态 CDP 实测 `{"ok":true,"dir":"...resources\\warmy-dsh\\node_modules\\@deepseek-ai\\dsh","version":"0.1.5-rc.1"}`。门禁 `verify-r122-dsh-bundle` 6/0。

### 13.2 我的名片弹窗滚动条
- `.woCardBody` 去掉 `min-width:min(520px,72vw)` 的固定宽；弹窗卡按内容宽 `min(560px, calc(100vw - 48px))`；`.woCardProvList` 去掉 `max-height/overflow:auto` 的嵌套滚动。
- 只有内容超出主界面高度时，才由 `.duiHuaKuangTi` 的统一滚动区接管。真机门禁断言：无横向滚动、服务商列表不单独滚动、卡片不超主界面、默认内容无多余纵向滚动。

### 13.3 最终回复右侧图标移到左侧
- 斑马头标记顺序改为 `zuiZhongHang > .banMaTou + .bubble`；纯最终回复（无思考/工具/中间回复）仍不渲染斑马头，左侧保留牛马头像。真机门禁断言“有过程 ⇒ 斑马头是第一个子元素；纯回复 ⇒ 无斑马头”。

### 13.4 中间回复去浮雕、操作条左下
- `.zhongJianKa` 去掉渐变/内阴影/凸出边框，背景与最终回复同为 `var(--them-bubble)`，圆角/阴影同气泡；`.guoChengCaoZuo` 从右对齐改为 `justify-content:flex-start`，悬停操作条位于左下角（模型/时间/赞踩/朗读/引用/复制）。
- 真机门禁 `verify-r122-ui-tweaks` **13/0**（dsh 状态、无浮雕、背景一致、操作条左下、斑马头位置、纯回复无图标、名片无滚动）。

**最终安装包（含 dsh 运行时，第 23 项 nm 浏览器修复后重建）**：`WArmy-Setup-0.2.30.exe`（228,681,931 B，sha256 `903d87cc517cf49f376925937d1a42657efc46749305a41ef5ca7bff70850164`）。

---

## 14. 第 122 轮追加：语音与整理特效（用户第 19–22 项）

### 14.1 整理时鼠标不再是等待光标
- `#shuRu.zhengLiZhong` / `[aria-readonly="true"]` 去掉 `cursor: progress`；整理开始时按当前 `--accent` 生成星芒 SVG data URI 作为光标（热点 4,4），结束/取消时移除；CSS 只保留 `text` 兜底，任何情况下都不再出现等待光标。

### 14.2 语音录入替换选区
- `yuYinChaRuJieGuo` 新增 `hasSel`：输入框有非空选区时，这一句转写**替换选区**（`setRangeText(delta, selA, selB)`）；同一段继续识别仍只替换自己上次插入的片段；普通光标插入语义不变。
- 选区不要求输入框当前有焦点：点话筒会让焦点离开输入框，但选区仍然保留。

### 14.3 没有新内容时静默
- 删掉“几乎没听到声音”的提示；`empty-audio` / `audio-silent` / `no-speech` / `asr-empty-result` / `bendi-yuyin-empty-result` 这类“没说出内容”的结果不再弹失败提示；配置/网络错误仍如实提示。
- 没有任何一次成功转写时 `youZhuanXie=false`，不会拿旧文字去发起整理。

### 14.4 整理特效重做
- 字保持字体本色（`--ink`）；随机字临时变主题色、发光、闪两次，并在右上角爆出一颗 `✦` 星芒。
- canvas 粒子约 45% 画成四角星，透明度随生命闪烁；随机字分两步轻微位移/旋转再归位，形成“重新组合排列”的动感。
- 整理结果写回后，新字从散落位置逐字归位、先主题色再回到本色，最后整层淡出（约 0.7 秒），随后恢复真实输入框；取消整理仍立即恢复原话。
- 系统“减少动态效果”时只保留静态亮字，不跑逐字/位移动画。

### 14.5 验证
- `verify-r122-ui-tweaks` **29/0**（新增 16 项：魔法光标 data URI、选区替换、空内容静默真值表、字本色、主题色发光+星芒、canvas 星点、重排位移、完成归位与淡出、光标恢复）。
- 回归：`verify-r110-voice-ui` 10/0、`verify-r112-ui` 19/0、`verify-r110-replies` 27/0、`verify-r67-chat-order` 20/0、`verify-r65-mic-lifecycle` 12/0（门禁沙箱补齐新增函数）。
- 全量 fast：148 项次 0 红。
- 收尾动画期间点取消会立即解除等待（`shouWeiResolve`），不会把发送按钮永久锁死；自动发送前再核对会话，防止 0.7 秒收尾期间切会话后发错地方。
- 最终安装包：`WArmy-Setup-0.2.30.exe`（228,679,539 B，sha256 `3eaedb388b4963d5d14f95a6f33e5b9f24b40d70a44faf04bc52e7b2678ad30b`），已复制到 `release/` 并更新 `checksums.txt`。

---

## 15. 第 122 轮追加：nm 查看器浏览器模式（用户第 23 项）

### 15.1 标签页在地址栏上方 + 新建标签页
- `#wangYeHang2`（标签页行）移到 `#wangYeHang1`（地址栏行）之前；标签页行右侧新增 `+` 按钮，固定显示、不随标签滚动消失，点击新建标签页并打开 `https://www.numumu.com/`（`WANG_YE_XIN_MO_REN`）。

### 15.2 “在新标签页打开”改成开关
- 原按钮“复制当前标签页”的行为已删除；现在它是 `aria-pressed` 开关，状态同步到主进程 `Z.wangYeXinKai`。
- 开启后 `will-navigate` 对所有 http(s) 链接 `preventDefault()` 并回传 `{ openInNewTab }`，渲染层在同一个 nm 窗口里新建标签页；关闭时链接按原行为在当前页跳转。
- `setWindowOpenHandler` 不再无声拒绝 `target=_blank` / `window.open`：一律拒绝原生新窗口，把 URL 交回渲染层新建标签页。

### 15.3 标签页关闭叉
- 右侧 × 改成细线圆头 SVG；默认 `opacity: 0`，只在指针放到 × 上（标签页右侧）或键盘聚焦时出现；无边框、无背景、无外框，不占额外视觉空间。

### 15.4 分栏可拖动 + 每个标签页独立
- 新增 `#wangYeFenGe` 分隔条：左右分栏 `col-resize`、上下分栏 `row-resize`；双击回 50%，方向键每次调整 2%。
- 分栏方式与比例存在**每个标签页自己**的 `fenLan` / `fenLanBi` 上，切换标签各自恢复；拖动期间临时隐藏 WebContentsView（原生视图在 DOM 之上会吃掉 mousemove），松手按新边界重新显示。
- 远程网页源码：新增主进程 `nmWangYeYuan`，用 `WebContentsView.webContents.executeJavaScript('document.documentElement.outerHTML')` 读取**渲染后的 HTML**（跨域也能拿到），源码栏只读显示；换页或载入完成自动作废并重新读取。

### 15.5 验证
- `verify-r81-nm` **74/0**（新增 10 项：标签页在地址栏上、`+` 默认 numumu、关闭叉默认隐身/悬停出现/无外框、开关同步、拦截链接在 nm 内新建标签页、远程只读源码、分隔条拖动、每标签页分栏、主进程 `will-navigate` / `target=_blank`）。
- 真实 Electron 冒烟（非夹具）：WebContentsView 从本地 HTTP 页读到 `REMOTE-SOURCE-REAL`（97 B）；开关开启时点击链接被拦截且当前 URL 不变，关闭时正常跳转到目标页。
- 全量 fast 与最终安装包在本节追加后重新执行/重建（见 §15.6）。

### 15.6 重建后的安装包
- `WArmy-Setup-0.2.30.exe`（228,681,931 B，sha256 `903d87cc517cf49f376925937d1a42657efc46749305a41ef5ca7bff70850164`），已复制到 `release/` 并同步 `checksums.txt`；打包态启动冒烟见下。


---

## 16. README 发布例外（2026-10-31，用户批准）

用户要求重写 README 并“都完成后进行发布”，据此把以下两项加入公开仓库：

- `README.md`（营销版落地页，英文为主）
- `docs/screenshots/readme-first-run.png`（本机首启窗口截图，无桌面/隐私内容）

**范围与语言口径**：
- 仍不发布 `docs/` 的其余文件、`dev/`、测试/校验脚本、交接文档、配置、日志与安装包。
- README 中允许出现的非英文仅限：品牌名 `无限牛马`、`说明.md` 文件名、10 种语言的自称（简体中文/繁體中文/日本語/한국어）。`scripts/prepare-publish.mjs` 对这几种字符串做**精确豁免**，其余任何中文、日文、韩文仍判红；秘密/本机信息扫描仍为 0。
- `README.md` 与截图属于“README 正常渲染所必需”的例外，不是放宽整个非必要文件规则。

**发布结果**：
- 提交 `898a14e1d05f63f09d78b1c8b9d336aa50709e30`，433 个文件；tag `v0.2.30` 已指向该提交。
- Release `v0.2.30` 说明已更新为“publishes source code, README.md, one first-run screenshot, 说明.md, LICENSE, and SPONSORS.md”。

---

## 17. 数据目录跟随安装目录 + 安装位置选择（2026-10-31）

**决定**：Windows 打包态的用户数据从固定的 `%APPDATA%\@warmy\app-shell` 改为 `<安装目录>\WArmyData`；安装器改为可选安装位置（assisted installer）。

**理由**：
- 用户要求数据跟着程序走，便于整目录备份、迁移和便携使用；
- 安装位置由用户决定，数据位置随之确定，不再与本机账户目录强绑定。

**实现**：
- `electron-main.ts` 在 app ready 前 `setPath('userData', <安装目录>/WArmyData)`，并设置 `sessionData`；显式 `--user-data-dir=` 仍然优先（测试/多实例隔离）。
- 首次启动且新目录为空时，把旧 `%APPDATA%` 数据复制到新目录（跳过 Chromium 缓存/锁文件，写 `.migrated-from-appdata`）；旧目录保留作备份。
- 安装到只读目录（如 Program Files）时回退到旧 `%APPDATA%`，写入 boot log，不因权限失败而崩溃。
- `electron-builder.yml`：`oneClick: false`、`allowToChangeInstallationDirectory: true`、`perMachine: false`、`include: installer.nsh`。
- `build/installer.nsh`：卸载/升级时遍历安装目录顶层，删除除 `WArmyData` 外的所有条目；不加锁、不搬移数据，锁住时也不会删除数据。
- 隐私文案（10 语言）改为安装目录 `WArmyData`；README/说明同步。

**验证**：
- fast 148/0；live 121/0（首启/认证/认证安全/nm/市场/能力）。
- 打包实测：指定目录静默安装、`WArmyData` 落位、迁移标记、`--user-data-dir` 覆盖、旧 `%APPDATA%` 不再被创建、卸载保留 `WArmyData`、覆盖安装保留 `WArmyData`。
- 0.2.31 安装包：228,745,515 B，sha256 `406496826f51bc7e61595a60f5a2cfcd47178f2a05915b1e5456a1b7b600f111`；提交 `12750b4`。

**边界**：macOS/Linux 仍使用系统默认 userData（安装目录在 .app 包内/可能只读）；卸载器保留 `WArmyData`，但用户仍应备份；迁移会一次性复制旧数据，旧目录不会自动删除。
