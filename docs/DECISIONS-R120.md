# 第 120 轮：未完成项收口记录（2026-10-30）

本轮按 R118 审计的 W 包顺序，继续做**不依赖真实账号/第二设备/签名密钥**的部分。原则不变：
行为门禁优先、失败路径必须可复现、没有证据的能力不写成已完成。

## 1. W08-1：技能/插件加密边界选 C（已实施）

- **代码明文**：`userData/scan-dirs/{skills,plugins}` 与旧 `userData/skills` 下的可重新下载代码/文档
  （`.mjs/.js/.cjs/.py/.sh/.ps1/...`、`SKILL.md`、`README*`、`LICENSE*`、`package.json`、`plugin.json` 等）
  不再加密；外部 Node/Python 解释器可以直接执行。
- **配置仍加密**：同一目录里的 `mcp-servers.json`、`settings.json`、`config.yaml`、`.env` 等仍走 `WARMYEF2` 密文，
  `fs.readFileSync` 在应用内可正常解密。
- **旧密文迁移**：登录拿到 DEK 后 `migrateCodeToPlain` 把旧版本误加密的代码逐文件解密为明文；
  单文件失败保留原密文并记日志，重复迁移幂等。配置不会被误解密。
- **权限收紧**：明文代码 0600、代码目录 0700（Windows 上按平台能力尽力而为）。
- **复制边界**：`copyFileSync` 目标是代码目录时，源若还是旧密文先解密再落盘，不把密文当“明文代码”复制。
- **执行副本**：当前内置 `mcp-bridge` 由外部 Node 直接读明文代码，不需要改写副本；需要隔离/改写执行时再生成最小临时副本（本轮不造无调用方的空壳）。
- 门禁：`verify-r120-plugin-code-plain` **30/30**；`verify-r116-enc-stream` 更新为“SKILL.md 明文、data.bin 密文” **34/34**。

## 2. W04：P6–P9 性能剩余项（已实施）

- **P6 召回**：查询先用已建索引；缺失向量补算改为 **single-flight**（并发召回共用一轮，同一记录只嵌入一次），
  并把 800ms 截止时间传到记忆服务，到期停止补算，不再“调用方放弃了后台还继续烧 CPU”。
  假嵌入器门禁 `verify-r120-recall-cancel` **11/11**。
- **P7 .nm**：预览与导入共用**一次**解包；令牌绑定包 sha256、数据状态版本和选择范围；
  包被替换 → `package-changed`，状态已变 → `state-changed`，范围不一致 → `selection-changed`，
  令牌重放/过期/暂存丢失均拒绝。`verify-r120-nm-stage` **27/27**。
- **P8 异步边界**：`fs.promises.readFile/writeFile/appendFile` 改为真异步 I/O（不再 async 名字套同步实现）；
  加密 JSONL 异步追加只增长一条记录的物理大小；外部编辑哈希/复制改分块流式，并在原文件被第三方修改时
  拒绝覆盖、保留副本。`verify-r120-async-boundary` **15/15**。
- **P9 发光**：播放中的气泡发光改为**静态阴影层 `::after` + 只动 opacity**，不再每帧重绘 box-shadow；
  减少动态效果时静态微光。`verify-round20-play` 真 Chromium 计算样式 10/10。

## 3. W06：`.nm` 清单元数据（已实施一半）

- 头部新增 `schemaVersion`、`owner`（Kroot 指纹或 `local`）、`dependencies`、`integrity`；
  明文导出也会写所有者指纹（跨账号导入前可提示）。
- 依赖目前按类别声明（如 `chat → knowledge`、`contacts → settings`），未选类别不会被自动塞进包。
- 预览令牌绑定包哈希/状态版本/选择范围已落地（见 P7）。
- **未做**：逐会话/逐知识对象的 UI 选择器与按对象合并；当前仍是类别级选择。

## 4. W10：可用性、无障碍、下载与动效（大部分实施）

- 操作行（朗读/引用/复制）在键盘 `focus-within` 时可见，按钮有 `focus-visible` 轮廓与 aria-label。
- 全局 `prefers-reduced-motion` 压掉动画/过渡；首启场景窗口不可见不画、减少动态时只画静态首帧且不自动轮播。
- **nm 下载管理最小闭环**：网页模式工具栏新增下载按钮与面板；`will-download` 落到系统下载目录，
  同名自动加 `(1)(2)`，文件名清洗防目录逃逸，显示进度/状态，可打开/定位/清空已结束；审计 `nm.download`。
- 门禁：`verify-r120-ui-a11y` **26/26**（含真实文件名清洗/唯一路径调用与接线检查）。
- **未做**：真实网页点击下载的 Electron E2E（需要本地 HTTP 服务与真实 WebContentsView 下载，本轮只做了接线与纯函数证据）。
- **第 121 轮更新**：按用户决定 B，下载不再一律落系统下载目录——首次询问位置并记住，默认 `<会话工作区>/downloads`；nm 窗口绑定打开它的会话。见 [`DECISIONS-R121.md`](./DECISIONS-R121.md) §5。

## 5. W12：发布一致性 + 恢复备份（部分实施）

- `checksums.txt` 与 `feed/latest.json` 已对齐现有 `WArmy-Setup-0.2.29.exe`：
  - Setup sha256 `ad038341…a594d2`，size `156978662`
  - Portable sha256 `81e7a50d…dca3a`，size `130518832`
- **恢复备份工具** `packages/app-shell/scripts/backup-profile.mjs`：
  - 只读备份 profile，排除缓存/日志/更新包；
  - `memory.db` 用 SQLite 在线备份 API 做一致性快照（失败才退回文件复制并如实标注）；
  - 逐文件大小 + sha256 清单；`--verify` 复核，篡改必须失败；
  - 发现 `lockfile`/`SingletonLock` 默认拒绝，显式 `--allow-running` 才继续。
  - 门禁 `verify-r120-backup` **12/12**。
- **未做**：用最终代码重建安装包并重新生成 feed/checksums；真实安装/升级/用户数据保留测试。
  R118 的 W12 要求“十轮之后不换未验证代码重新打包”，当前十轮未完成，因此**没有**替换发布包。

## 6. 仍未完成（需要后续轮次或外部条件）

1. **W05 单一加密存储核心 A 的全量迁移**：目前只完成记忆库 SQLCipher + 逐文件 AEAD 过渡层；
   聊天事实/投影/KB/settings 等尚未迁入同一事务存储，主进程仍直接读写多个 store。
2. **W07 网络投递闭环**：还没有持久化 per-recipient outbox、业务 ACK（对端持久化后才确认）、
   角色矩阵/外部群 @ 的逐入口覆盖、DHT 最小收敛。现有 `ChuanShuDuiLie` 能去重/并发/超时/只读，
   但“发送成功”仍只代表传输层成功，不等于对端已持久化。
3. **W08 连接器接收协议**：企微/钉钉仍只有发送与凭据验证，接收需要回调 URL/Stream SDK；
   没有真实账号与公网回调环境，未实现、也不伪造。
4. **W09 签名 manifest**：更新跳转逐跳校验已做；离线签名的密钥保管与发布未获授权，未做。
5. **W11 完整十轮真实验收**：本轮只跑了 fast 三连与新增门禁；没有用 MiMo/Ollama 跑完整十轮，
   也没有 10 轮全功能矩阵的真实桌面证据。
6. **W12 最终发布**：未重建安装包、未做安装/升级/数据保留实测；需要先完成 W11。

## 7. 需要用户协助的事项

- 第二台真实设备（跨设备恢复/网络投递）、真实 IM 测试账号或 bot（企微/钉钉/微信）、
  真实 TTS/画图/视频额度。
- 4K 物理屏与多显示器目检。
- 代码签名/公证的密钥与发布授权（不在本轮自主范围）。
- W05/W07 的存储与网络协议改造需要一次明确的排期；它们不是“补一个 UI”能收口的改动。

## 8. 本轮验证记录

- `verify-r120-plugin-code-plain` 30/30
- `verify-r120-nm-stage` 27/27
- `verify-r120-async-boundary` 15/15
- `verify-r120-recall-cancel` 11/11
- `verify-r120-ui-a11y` 26/26
- `verify-r120-backup` 12/12
- 回归：`verify-r116-enc-stream` 34/34、`verify-r81-nm` 63/63、`verify-round20-play` 10/10、
  `verify-r44-yuSuan` 176/0、`verify-r104-vault` 51/51、`verify-r111-data` 36/36、
  `verify-r113-export-retention` 7/7、`verify-gate-manifest` 23/23、`pnpm -r typecheck` 11/11。
- fast：**3 遍 · 423 项次 0 红 · 完整全验通过**（严格判分；每遍 141 项，含新增 r120 门禁）。
- 文档/清单复跑：`verify-docs` 95/0、`verify-gate-manifest` 23/23、`verify-no-empty-catch` 全过、`verify-renderer-scope` 9/0、`verify-renderer-template-balance` 全过、`verify-css-consistency` 8/0。
