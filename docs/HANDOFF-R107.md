# R107：定时导出、引导入口、导入管线与签名/外部密文/旧群策略

> 本文件记录第 107 轮用户提出的 6 项。**已完成**与**未完成**严格分开；未完成项不写成“已交付”。

## 1. 已完成并验证

### 1.1 定时导出（导出位置旁的「定时导出…」）

- 入口：设置 → 关于 → 导出全部数据旁新增「定时导出…」。
- 弹窗字段：
  - 下次导出时间（`datetime-local`）；
  - 循环次数（1/3/5/10/30/不限）；
  - 间隔（1h/6h/12h/3d/7d，最小 5 分钟）；
  - 数据无变化时跳过（按文件相对路径 + 大小 + mtime 的 SHA-256 指纹）；
  - 是否加密（关闭时写 `.tar.gz` 明文包，界面明确警告）；
  - 是否需要单独凭证（需要时用 safeStorage 保存导出口令；不需要时用当前登录主密钥，锁屏则等待/重试）；
  - 导出范围六类：聊天与产物 / 知识库 / 联系人项目群聊 / 设置与提示词 / 账号与凭据 / 审计日志；
  - 导出位置最多 10 个，每行有启用勾选；**每个启用位置各导出一份**，可添加/选择/移除。
- 后台：主进程每 30 秒检查 `nextAt`，启动后 20 秒补跑一次；执行完更新 `runsDone/nextAt/lastStatus/lastPaths`，循环次数用完自动 `enabled=false`。
- 失败语义：没有启用位置 → `no-location`；凭证缺失 → `credential-missing` 并 10 分钟后重试；锁屏且无单独凭证 → `vault-locked` 并重试；某个位置失败 → `partial`，成功位置照常保留；不假装全部成功。
- 关键文件：`packages/app-shell/src/export-schedule.ts`、`electron-main.ts` 的 `warmy:dingShiDaoChu*`、`renderer/app.js` 的 `showDingShiDaoChuDialog()`。
- 门禁：`dev/gates/verify-r107-export-schedule.mjs` **19/19**；真实 Electron 弹窗字段检查在 `verify-r106-interim-ui` 中 **20/20**。

### 1.2 引导卡位置与创建牛马入口

- 默认位置：右下角，**引导卡底边对齐聊天输入区中线**；窗口缩放时重算；用户拖动/吸附后仍按保存位置。
- 「创建牛马」步骤不再自动打开创建弹窗：切到「我的牛马」后，高亮并聚焦第二列右上角的牛头按钮，提示“请自己点这个按钮”；只有用户自己点才打开创建框。
- 10 个语言包的 `startGuide.step.niuma.desc/action` 已更新，并新增 `startGuide.step.niuma.click/missing`。
- 门禁：`verify-r106-interim-ui` 新增引导位置/指路检查。

### 1.3 解封/导入：不再落明文临时归档 + 回滚

- `DataVault.unseal()`、`verifyImport()`、`importVault()` 改为**流式解密 + 归档解析直写临时目录**，不再生成 `%TEMP%*.tar` 明文归档。
- 导入支持三种包：
  - 口令包（`WYV1` + scrypt）；
  - 主密钥包（同账号，免口令）；
  - 明文 gzip 包（`.tar.gz`，导入前二次确认）。
- 导入前先完整解包验证；覆盖前用当前主密钥（无主密钥时用临时随机密钥）做一份**加密快照**；复制中途失败自动回滚，并清掉导入新写、原不存在的文件；回滚失败时保留快照路径写进错误，不删除证据。
- `peiZhiDaoRu` 不再“先封存再导入”（那会把当前明文清掉，失败时备份为空）；现在由 `importVault` 负责快照/回滚。
- 门禁：`verify-r104-vault` **50/50**，新增明文包、主密钥包、范围过滤、失败回滚、无明文 tar 检查。

## 2. 尚未完成（不冒充已交付）

### 2.1 A 全量运行期密文（单一加密存储核心）

仍未开始迁移。当前只有 `vault.bin` 封存 + 导出/导入是密文；运行期聊天、知识库、设置、分组、附件等仍按原模块写明文。**不能把本轮 1.3 的导入管线修复说成 A 已完成。**

建议顺序（与 `HANDOFF-R106.md` §0.1/§6 一致）：

1. `better-sqlite3-multiple-ciphers@13.0.3` + `storage-core`（DB 页/WAL/索引/临时表）；
2. 逐类迁移聊天/知识库/设置/分组/身份/审计/附件；
3. 稳定 `Kroot` + `keyEnvelope`（随机数据 DEK 由旧 master 与 Kroot 双包裹）；
4. 全量迁移与原子代次切换；
5. 外部工具边界明确为导出边界（见 §4）。

最坏情况：迁移中断留下混合代次、旧数据打不开。必须保留旧认证元数据与备份，验证成功后才切换；不能用“一个开关”直接改。

### 2.2 `.nm` 选择性导入导出

现有 `.nm` 只是“项目/聊天”的明文 JSON 包，无逐项勾选、无默认凭证加密、无冲突覆盖/回滚。尚未实现：

- 选择树（我的牛马/项目/联系人/群聊/每个会话/三层知识库/提示词/日志/全部应用数据）；
- 逻辑适配器逐记录查询（推荐），不复制整文件；
- 默认用当前凭证（Kroot）加密，可选明文；
- 导入双重确认、冲突覆盖不可恢复提示、原子提交；
- 同助记词新设备可导入，不同凭证要求输入源设备助记词。

最坏情况：导入覆盖后无法恢复；必须先预检、再加密暂存、单指针提交，并保留旧代次备份。

### 2.3 稳定凭证 / 跨设备恢复

本轮只保证“旧 vault 恢复不因换 salt 失钥”；`Kroot`/`keyEnvelope` 未实现，所以“同助记词新设备导入同助记词导出的数据”尚未闭环。无 vault 的新设备仍可能 `no-account`。这是 2.1/2.2 的前置项。

### 2.4 其余安全项

| 项 | 现状 | 建议/最坏情况 |
|---|---|---|
| IPC/nm 最小权限 | 仍是共享 preload + 来源检查，未按窗口类别/登录态细分 | 精确 URL + 主框架 + 已登记 webContents + 窗口类别；nm 独立最小 preload。最坏是 nm 被攻陷后可调主业务。 |
| 命令隔离 | `run_shell` 仍是白名单+普通 shell，不是沙箱 | 单一执行入口、argv 参数化、容器/OS 沙箱；宿主不能隔离时不得声称保护其它会话。 |
| 更新签名 | 哈希与包来自同一清单 | 独立信任根签名清单、校验版本/大小/hash/有效期；最坏是清单被替换即可替换包。 |
| 身份轮换/API key 迁移 | 身份重建先删后建；safeStorage 密文换机不可解 | 先验证轮换链、保留旧代次；API key 导出时内存重包、导入按目标设备再包。 |
| 测试清理 | `run-verify-22` 会按调试端口杀 Electron | 只管理本次 spawn 的 PID 树；最坏是误杀别人的测试会话。 |

## 3. 签名/公证：免费但成功率更高的方案

**Windows（推荐顺序）**

1. **SignPath Foundation**：面向 OSI 开源项目的免费 OV 级代码签名；证书签发给项目/SignPath Foundation，需要公开仓库、从源码构建、CI 集成与申请审核。好处是免费、被 Windows 信任链接受；SmartScreen 仍需要下载量/时间积累声誉，不是 EV 的“立刻全绿”。适合 WArmy 这种公开仓库。
2. **Certum Open Source Code Signing**：面向开源开发者的免费/低价 OV 证书，需要身份验证、硬件/云签名和申请；比 SignPath 多一层证书主体归你，但流程更长。
3. **Azure Artifact Signing（原 Trusted Signing）**：不是免费，Basic $9.99/月含 5000 次签名；流程比传统 CA 简单、短期证书，适合作为付费保底。
4. **自签名**：免费但不被 Windows 信任，SmartScreen 仍警告；只适合内部分发，不能解决用户安装拦截。

**macOS**

- **没有免费且能消除 Gatekeeper 警告的公证方案**。Developer ID 签名 + Apple 公证需要 Apple Developer Program（$99/年）；ad-hoc 签名免费，但下载后仍会被 Gatekeeper 拦截，用户要右键打开或 `xattr` 去隔离，不能作为正式分发。
- 如果只做 Windows 首发：SignPath Foundation 是“更简单、成功率更高、免费”的首选；macOS 要么付费，要么明确标注“未公证、需手动放行”。

**结论**：免费方案里 SignPath Foundation 最值得先申请；它不保证 SmartScreen 立即无警告，但比自签名/无签名可靠。若申请不通过，再考虑 Certum OSS 或 Azure 付费。

参考：
- [SignPath Foundation](https://signpath.org/)
- [SignPath OSS 条件](https://signpath.org/terms.html)
- [Microsoft：Windows 代码签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Azure Artifact Signing 定价](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Certum Open Source Code Signing](https://certum.store/open-source-code-signing-code.html)
- [Apple notarization / Gatekeeper 说明](https://sushi.dev/en/blog/notarization-of-mac-apps)

## 4. 严格外部工作区密文：简单方案与“不管外部工具”的后果

**简单方案（建议）**：只保证**应用管理的数据**（`userData` 内由 WArmy 创建/管理的数据库、知识库、设置、分组、附件、日志）在运行期与退出后都是密文；外部项目目录按“显式导出边界”处理，不假装由 WArmy 加密。若用户要求外部目录也密文，简单做法是让该目录位于 OS 加密卷（Windows BitLocker / macOS FileVault / Linux LUKS）或容器卷，而不是在应用内逐文件加密。

**不管外部工具时的缺点（真实会发生）**：

- 用户在 VS Code/Word/记事本打开项目文件，编辑器会写自动保存、撤销历史、最近文件、workspaceStorage、临时文件；这些副本不受 WArmy 控制。
- OneDrive/Dropbox/Google Drive 会同步明文；即使 WArmy 删了本地文件，云端已有副本。
- Windows Search/杀毒/索引器/备份软件会复制明文；删除后还可能从卷影/回收站/备份恢复。
- 同机其他用户/进程、恶意插件、屏幕录制、剪贴板历史都能读到。
- 例子：项目里有一份 `config.json` 含 API key；用户在 VS Code 打开一次，VS Code 把内容写进 workspaceStorage/备份，OneDrive 同步到云端；WArmy 退出时把自己的库加密了，但 key 已经在云端和历史副本里。另一个例子：用户用 Python 脚本处理项目文件，脚本在 `%TEMP%` 写中间文件；WArmy 无法阻止。
- 因此“应用管理数据全程密文”能保护 WArmy 自己的库，但**不能承诺外部工具写出的副本也密文**。要覆盖这一层，必须用 OS 加密卷/容器或限制外部工具，成本和兼容性都更高。

## 5. 旧群没有成员指纹：场景与策略

**什么情况下会没有指纹**

- 群是在指纹功能上线前创建的；`groups.json` 里只有成员名/id，`creatorFingerprint` 为空。
- 成员通过旧邀请/旧同步迁移进来（`source='migrated'`），身份名片没有带指纹；代码明确“拿不到就留空，不猜”。
- 成员是本机牛马实例（`source='instance'`），它本来就不是远端身份，代码故意不写指纹。
- 对端握手没有 `peerFingerprint`（旧协议/身份层不可用），当前会直接以 `missing-peer` 拒绝。
- 创建者身份卡还没拿到：群已存在，但本地还不知道创建者指纹；入站成员列表和 creator 都为空。

**现有行为**：`qunRuXiangJianYan` 在“成员指纹全空且 creator 空”时返回 `unverified-legacy` **放行并审计**；有指纹但 peer 不在成员/创建者中则拒绝 `not-a-member`。这是兼容优先，不是安全优先。

**三种策略**

| 策略 | 优点 | 缺点/最坏情况 |
|---|---|---|
| 直接拒绝 | 最简单、最安全；旧群立刻只读 | 旧群全部不能收发；用户必须重建群/重新邀请，兼容性最差 |
| 继续接收（现状） | 旧群可用 | 知道 groupId 的对端可冒充成员注入消息；敏感群不可接受 |
| 验证提示 + 双方确认（推荐） | 兼顾兼容与安全；确认前不投递、不发送 | 需要协议支持挑战/响应；旧客户端不支持时群会卡住，必须提供“明确信任一次”的降级按钮并审计 |

**推荐落地（C）**：

1. 收到无指纹群消息 → 不写入聊天、不显示“已收到”，进入隔离队列；群显示“待验证”。
2. 双方弹出验证卡：显示对端指纹/名称/群名；用户确认后发送签名挑战，对端确认后回签名响应。
3. 双方都把“群 + 成员指纹”写入本地信任账本，之后正常收发；未确认前**发送也禁用**。
4. 老客户端不支持挑战 → 提供“我确认这是可信旧群，仅本次放行”按钮，写审计并保留待补指纹状态；不静默放行。
5. 任何指纹变化/换证 → 重新验证，不沿用旧信任。

最坏情况：旧客户端无法完成挑战，群暂时不可用；这是安全的失败方式，必须有明确提示和重建群/重新邀请路径。

## 6. 本轮验证

- `verify-r104-vault`：**50/50**（含流式解封、明文/主密钥包、导入回滚）
- `verify-r107-export-schedule`：**19/19**
- `verify-r106-interim-ui`：**20/20**（含引导位置/指路、定时导出弹窗字段、决策卡/执行过程）
- `run-verify-22 --tier=fast --times=1`：**122 项次 0 红**（本轮最后一次运行）
- `verify-r101-changes`：87/87；`verify-round22-decision`：全绿；`verify-work-tools`：63/63；`verify-r106-inbound`：10/10

## 7. 需要你拍板/协助

1. **旧群策略**：确认采用 C（验证提示 + 双方确认，未确认前拒绝收发），还是 A（直接拒绝，旧群只读）。我建议 C；A 最简单但会打断旧群。
2. **签名**：是否同意先申请 SignPath Foundation（需要公开仓库/OSGi 许可证/CI 构建证明）；若不同意公开构建，Windows 只能走付费 Azure 或继续无签名。
3. **外部工作区**：是否接受“应用管理数据密文、外部目录明文 + 显式导出边界”；若要外部目录也密文，需要 OS 加密卷/容器，需确认可接受部署成本。
4. **A/.nm/Kroot**：这是跨多轮的存储核心迁移，不能在本轮安全完成；需要你确认下一轮优先级（建议 A 的 storage-core 先做，再 .nm）。
5. 多显示器/4K/第二设备/真实 IM 账号仍需要你的设备/账号；这些不在本轮代码范围。
