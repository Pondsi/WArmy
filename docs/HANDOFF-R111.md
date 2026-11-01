# 第 111 轮交接：语音整理只读、.nm v2、SQLCipher 记忆库、Kroot、外部编辑边界、IPC 最小权限

日期：2026-10-28
版本：0.2.29

## 1. 用户可见改动

### 1.1 整理中聊天框

- 整理期间输入框**真只读**：不是“看起来能点、能选、能打字但输入无效”。`readOnly=true` + `aria-readonly` + 光标 `progress`，右下角显示很淡的“整理中…”。
- 这期间用户无法更改内容；整理结果**始终覆盖**这一轮原文（不再因为 value 变化而跳过）。
- 再点话筒立即取消：恢复文字、恢复可编辑、清掉特效；晚到结果按世代丢弃。
- 下一次语音仍会重新整理**整个聊天框**。
- 特效仍是主题色逐字随机亮/暗 + 极淡粒子汇聚；话筒只保留静态提示，不叠第二层动效。

### 1.2 导出 / 导入

- 设置页按钮改为 **「导出数据」「导入数据」**。
- 手动导出弹窗：
  - 一棵细化数据树（聊天与产物 / 知识库 / 联系人项目群聊 / 设置提示词 / 账号与凭据 / 审计日志），子分类默认折叠；
  - 可勾选“加密导出（使用当前账号凭证）”，默认开；关闭时显示红色警告；
  - 导出格式统一 `.nm` v2。
- 导入：
  - 明文 `.nm` 直接导入；
  - 加密 `.nm` 先比较包头里的 Kroot 指纹：与当前账号一致 → 直接用当前凭证解开；不一致 → 弹出输入源账号助记词（“提示词”）的界面，验证指纹后再解开；
  - 旧 `.wvault` 仍可导入（兼容），新导出不再写 `.wvault`。
- `.nm` v2 包：二进制头 + gzip 归档；Kroot 包裹随机 DEK（AES-256-GCM），包头 AAD 绑定；错误助记词/损坏包绝不半解、绝不覆盖当前数据。
- 定时导出同步改用 `.nm`；同一秒多次导出加毫秒后缀，不再互相覆盖。

### 1.3 定时导出界面

- 弹窗卡片 `max-height: calc(100vh - 48px)`，内容区 `overflow:auto`；不再超出主界面。
- 删掉“更细致的选择”这层，数据选择本身就是六类细化树（子分类默认折叠）。
- 循环次数与间隔在同一行；窄窗口才换行。
- 至少勾一类数据才能保存。

### 1.4 单一加密存储核心（第一阶段）

- 记忆服务 `memory.db` 改用 `better-sqlite3-multiple-ciphers`（SQLCipher 兼容）：
  - 登录后从随机 DEK 派生 32 字节库密钥（HKDF `warmy-storage-v1/memory`）；
  - 库文件、WAL、回滚日志一起加密；错误 key 被拒；
  - 旧明文 `memory.db` 改名 `memory.db.plain-*.bak` 留档，SQLite 投影从 JSONL 重建；
  - 迁移失败就不启动加密模式，绝不在明文库上套错误 key。
- 库密钥只从子进程环境读一次，读完删除；不写命令行、不落盘。
- **如实说明边界**：本阶段只完成 `memory.db`。`fast-memory.jsonl`、`settings.json`、`groups.json`、`knowledge-*.json`、附件/审计等仍由 DataVault 在退出/注销时整体封存；运行期它们仍是明文工作副本。全量迁移是后续阶段，不能把这一阶段说成“所有数据全程密文”。

### 1.5 稳定 Kroot / 新设备恢复

- `auth-core.mjs` 新增：
  - `deriveKroot(mnemonic) = HKDF-SHA256(助记词熵, salt="warmy-root-v2", info="recovery")`；
  - `krootFingerprint(kroot)` 公开短指纹。
- 新增 `key-envelope.json`：随机数据 DEK 同时被“旧主密钥”和“Kroot”包裹；登录后用 Kroot 解，启动时只有一次性令牌里的旧主密钥也能解；旧包裹自动补 Kroot 包裹。
- `DataVault` 优先用 DEK 派生密钥；旧 `vault.bin` 仍可由 legacyKey 解开，下次封存自动换成 DEK。
- `.nm` 加密包用 Kroot 包裹 DEK；同一句助记词换设备可以解开。
- **未做**：真实第二设备端到端验收；旧 `.nm v1` 迁移仍按“不支持就如实拒绝”处理。

### 1.6 外部工作区边界

- 应用工作区文件右键新增 **「外部编辑（解密副本）」**：
  - 先弹警告（外部程序能看到明文副本；不承诺沙箱）；
  - 复制到临时目录并用系统默认程序打开；
  - 记审计 `workspace.external-edit-start`；
  - 检测副本内容稳定后自动回写原文件、删除副本，记 `workspace.external-edit-resealed`；
  - 应用重启时扫描清单，恢复未回写的副本。
- 只允许 `userData/workspace` 内的普通文件，越界拒绝。
- **边界**：项目目录（用户自己选的外部路径）本来就是外部明文目录，本轮没有把它变成密文；强制禁止 Office/IDE 打开不可接受，因此采用“显式边界 + 警告 + 审计 + 自动回写”，而不是承诺外部工具被沙箱。

### 1.7 IPC 最小权限 / 脱敏 / 进程隔离结论

- IPC sender 从“任意 `file:`”收窄为**只接受本应用 `dist/renderer` 下的页面**；DevTools 默认拒，只有显式环境开关才放行。
- 新增 `IPC_SCHEMAS`：对导出/导入、供应商密钥、整理、定时导出、nm 读取、打开路径/外链、聊天发送、进度保存、日志追加等敏感通道校验参数形状/长度/枚举。
- 新增 `IPC_LOGIN_REQUIRED`：导出/导入、密钥读写、定时导出、查看助记词、改 PIN 在“已有账号且未解锁”时拒绝。
- 新增工具输出脱敏器 `TuoMinQi`：
  - SecureKeyStore 里的已知密钥值 → `[已脱敏:secret-xxxxxxxx]`；
  - `sk-…`、`AIza…`、`xox…`、`Bearer …`、`api_key=…`、PEM 私钥等常见格式 → 引用占位；
  - 普通文字不误伤。
- **回答“有脱敏是否就不需要进程隔离”**：
  - 已有的是**落盘加密 + 界面不回明文 + 工具输出脱敏**，不是“模型永远看不到任何密钥”；
  - 如果用户把密钥写进项目文件，模型通过 read_file 仍可能读到——脱敏器只能替换已知值/常见格式；
  - 进程隔离仍然有价值：它限制的是“被攻陷的渲染层/插件能调哪些主进程能力”，和脱敏不是同一层防线；
  - 本轮先做了 IPC 白名单/schema/sender/登录门禁（成本低、收益直接），**独立命令沙箱/子进程隔离未做**，留作后续。

### 1.8 身份轮换 / API key 迁移

- 身份换证（`warmy:shenFenLunHuan`）和凭证轮换（`warmy:pingZhengLunHuan`）原有能力保留。
- 新增 `AnQuanMiyaoCang.migrate()`：把历史明文/base64 的 API Key 条目重新加密到当前 OS 保护；启动、换证、凭证轮换后都会尝试迁移并记审计。
- API Key 本身不随身份删除；迁移只改保护格式，不改 key 值。

### 1.9 TTS / 画图 / 视频生成链整链回退

- TTS 从“只取调用链第一个未禁用模型”改为**整条链逐腿尝试**：
  - 每个模型先试 `/audio/speech`；端点不支持再换 chat 式；
  - 全部失败返回 `tts-chain-failed`，并列出每一腿的原因/可用音色；
  - 成功模型提到链首（沿用原有 `jiangTeShuMoXingTiDaoLianShou`）。
- 看图/看视频/画图/做视频继续走 `anLianXuChangShi` 的整链回退（本轮加了门禁断言）。

### 1.10 旧群按重建 / 重新邀请

- 群列表对“无建群者指纹且未重建”的旧群加 **“旧群”** 标记。
- 右键新增 **「重建并重新邀请（旧群无指纹）」**：
  - 新群使用本机当前身份指纹，成员为空；
  - 旧群保留为只读历史，记 `rebuiltTo`，不会反复提示；
  - 不伪造旧群指纹，不假装兼容。
- 新版本不再尝试接受无指纹旧群的成员证书；成员需要重新邀请。

## 2. 验证

| 门禁 | 结果 | 覆盖 |
|---|---|---|
| `dev/gates/verify-r111-data.mjs` | **35/35** | Kroot 稳定、keyEnvelope 双包裹、.nm 明文/Kroot、错误 key/助记词、选择性类别、旧 .wvault、外部编辑自动回写、脱敏、旧群重建、IPC/TTS/导入静态 |
| `dev/gates/verify-r111-storage.mjs` | **11/11** | memory.db 密文/错误 key 被拒/正确 key 可读、JSONL 仍在、主进程 DEK 派生与延迟启动 |
| `dev/gates/verify-r111-data-ui.mjs` | **9/9** | 真 Electron：定时导出弹窗不超高/可滚动/无“更细致”/六类折叠树/循环与间隔同一行/大类联动；手动导出加密勾选 |
| `dev/gates/verify-r111-auth-storage-ui.mjs` | **8/8** | 真 Electron 真实注册：keyEnvelope、memory.db 迁密文、加密记忆可写、JSONL 事实源、明文库备份 |
| `verify-r110-voice-ui`（更新） | **10/10** | 真 Electron：整理特效、只读、真实输入无效、取消恢复、完成音一次 |
| `verify-r104-vault` | **51/51** | 旧 vault 仍可导出/导入/回滚；新导出断言改为 .nm |
| `verify-r107-export-schedule` | **29/29** | 定时导出 .nm 明文/Kroot、多位置、跳过、循环、partial、选择性 |
| `verify-security` | **28/28** | 票据/隐私/IPC sender 收窄/schema |
| fast 档 | **3 遍 × 125 项次，0 红** | 全量静态 + 真机 Electron 快档 |
| R111 真机四门禁 | **3 遍全绿（9+8+10+6）** | data-ui / auth-storage-ui / voice-ui / replies-ui 连续三轮 |
| 源码发布提交 | `b0aa098` | GitHub `main`（含 IPC 登录门禁修复） |

打包验收：`release/win-unpacked/WARMY.exe` 用临时 profile 真实注册，8/8 通过（打包态也能链接并加载 SQLCipher 驱动）；`release/WArmy-Setup-0.2.29.exe` 构建成功并作为 Release 资产。

## 3. 明确未完成 / 不说成完成

1. **单一加密存储核心只完成第一阶段**：`memory.db` 已 SQLCipher；JSONL、settings/groups/knowledge/attachments/audit 仍是运行期明文，退出/注销由 DataVault 封存。全量对象迁移、按类别显示“尚未全程密文”仍在后续。
2. **真实第二设备恢复**未做（需要第二台机器 + 同助记词 + .nm 包）。Kroot/envelope 的单机/模拟跨账号测试已过。
3. **外部项目目录**（用户自己选的路径）没有加密；只有应用工作区有显式外部编辑流程。
4. **进程隔离/命令沙箱**未做；本轮做的是 IPC 白名单/schema/sender/登录门禁 + 工具输出脱敏。脱敏不能替代进程隔离，也不能保证“模型绝对看不到用户主动写进文件的密钥”。
5. **TTS/画图/视频真实供应商**未在本轮用真实 key 跑整链（没有可用 key 的门禁只验证了接线/回退逻辑）；需要用户在真实模型上验收。
6. **旧群数据迁移**：只保留旧群只读历史，成员需重新邀请；没有“无指纹成员自动变成可信成员”的路径（产品口径：不兼容）。
7. **4K/多显示器/任务栏**等历史项不在本轮范围；已有门禁仍绿。

## 4. 改动文件

- `packages/app-shell/src/auth-core.mjs` / `.d.mts`：`deriveKroot` / `krootFingerprint`
- `packages/app-shell/src/auth-service.ts`：`sessionKrootCopy()`
- `packages/app-shell/src/key-envelope.ts`（新）：DEK 双包裹
- `packages/app-shell/src/data-vault.ts`：`.nm` v2、DEK/legacy 双密钥、`exportNm/verifyNm/importNm/inspectNm`
- `packages/app-shell/src/export-schedule.ts`：定时导出 .nm + Kroot + 毫秒后缀
- `packages/app-shell/src/memory-client.ts` / `packages/memory-os/src/{index,ipc}.ts`：SQLCipher 密钥注入
- `packages/app-shell/src/electron-main.ts`：kroot/envelope、memory 密钥、IPC schema/登录门禁/sender 收窄、脱敏、外部编辑、旧群重建、TTS 整链
- `packages/app-shell/src/redactor.ts`（新）
- `packages/app-shell/src/external-edit.ts`（新）
- `packages/app-shell/src/group-store.ts`：`rebuiltTo` + `rebuildLegacy`
- `packages/app-shell/src/secure-keys.ts`：`ids()` + `migrate()`
- `packages/app-shell/src/preload.cjs`：`qunChongJian` / `waiBuBianJi` / `waiBuBianJiLieBiao`
- `packages/app-shell/src/renderer/app.js` / `app.css`：整理只读、导出/导入弹窗、细化树、旧群标记/重建、外部编辑、特效提示
- `packages/app-shell/src/i18n/*.json`（10 包）：新文案
- `packages/app-shell/electron-builder.yml`：打包 `better-sqlite3-multiple-ciphers`
- 门禁：`dev/gates/verify-r111-*.mjs`、`run-verify-22.mjs`、`verify-r104-vault.mjs`、`verify-r107-export-schedule.mjs`、`verify-security.mjs`、`verify-r110-voice-ui.mjs`

## 5. 首启

真实 profile 已备份并删除，`release/win-unpacked/WARMY.exe` 正常启动并停在首启语言选择页（1280×800）。

- 配置备份：`%APPDATA%\@warmy\app-shell.backup-20261029-011318-r111`
- 首启截图：`<临时目录>/warmy-r111-firstrun.png`
- 发布：<https://github.com/Pondsi/WArmy/releases/tag/v0.2.29>（`WArmy-Setup-0.2.29.exe` + `checksums.txt`，英文说明）
- 源码：GitHub `main` @ `b0aa098`

用户验收后再继续注册/配置。
