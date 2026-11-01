# R81 法务文案落地交接（隐私政策 / 使用条款）

> **状态**：`docs/PRIVACY.md` 已重写为 2.0，新增 `docs/TERMS.md` 2.0；**本轮没有改任何代码、没有 commit、没有打印密钥**。
>
> **接手前必读（并发变更）**：本轮只写了 `docs/` 下三个文件，**没有改代码**。但写作期间（约 18:51）`packages/app-shell/src/i18n/*.json` 被**另一个进程/会话**改过：
> - `zh-CN` 的 `privacy.body` / `privacy.ti` 变成了另一版 13 节、约 2292 字的摘要（以 `【隐私与使用条款 · 2026-10-24 版】` 开头）；
> - 其余 9 种语言的 `privacy.body` / `privacy.ti` 被填成了英文（以 `IN ONE LINE. WArmy is local-first...` 开头），**日/韩/法/西/葡/俄/世界语/繁中都没有翻译**；
> - `about.contactBody` 的重复邮箱已去掉，但 `zh-TW` 仍是 `倉庫：`、`en-US`/`eo` 仍是 `Repo:`，只有 `zh-CN` 是 `仓库与问题反馈：`。
>
> 这些**不是本轮改的**。请先用 `git diff` 与 `git log -S "232307860@qq.com"` 确认来源，再决定保留哪一版。**不要混用两版正文**：要么保留那版 13 节中文并补翻译，要么按本文 §3.2/§3.3 统一覆盖。本文的验收清单对两版都适用（除"旧版首句"检查外）。
>
> 本文给出：新文档位置、旧版问题、代码中正文的精确位置、可直接粘贴的替换文案、验收命令、以及"不要在代码/界面里声称的事"。

---

## 0. 三分钟结论

1. **正文位置**：首启条款页读 i18n 的 `privacy.body`，关于页/隐私弹窗读 `privacy.ti`；两者必须一致。初次审计时是旧版 1.0 摘要（约 1417 字），写作期间已被并发改成两套不同的内容（见顶部"并发变更"）。
2. **目标只有一版**：建议以本文 §3.2（中文）/§3.3（英文母本）为准，10 种语言统一覆盖；如果保留并发写入的 13 节中文版，必须补上它缺的"三平台删除路径、儿童/跨境、崩溃日志、当前不自动安装"等段落，并修正它"按第九节删除数据"的错引（删除是第八节）。
3. **10 种语言都要有译文**：不能让日/韩/法/西/葡/俄/世界语/繁中界面显示英文正文（并发变更目前就是 9 种语言英文），否则同一版本内条款语言不一致。
4. **联系方式必须去重**：`Public@numumu.com` 只能出现 1 次，且包含 `232307860@qq.com`；`zh-CN` 的 `about.contactBody` 现在是 `仓库与问题反馈：`，`zh-TW` 仍是 `倉庫：`、英文仍是 `Repo:`，要统一成"仓库与问题反馈/issues"的本地化标签。

---

## 1. 新文档与旧版的关键差异

| 项目 | 旧版 | 新版 |
|------|------|------|
| 文件 | `docs/PRIVACY.md`（1.0，2026-10-18）；无独立条款 | `docs/PRIVACY.md`（2.0）+ `docs/TERMS.md`（2.0） |
| 账号表述 | "不运营账号系统" | 明确"**没有服务器端账号系统**；本机账号只是加密配置文件，维护者没有账号/密码/助记词" |
| 加密表述 | 容易让人以为本机数据都已加密 | 明确"**会话/记忆/知识库/项目/审计默认明文**，只有身份私钥、助记词、API Key、社交密码优先用系统安全存储（不可用时明确标记）" |
| 联网 | 4 类，偏简略 | 11 类逐项列明：云端模型、本机 Ollama、特殊模型、更新检查、技能市场、语音模型下载、组网/STUN、FWArmy、微信 iLink/企微/TG/飞书、外链、GitHub/邮件 |
| 模型 | 一句"你自己填写的服务商" | 单列 BYO：Key 只发给该服务商、费用/日志/训练由服务商决定、删本机 Key 不等于吊销 |
| 中继 | "作者不参与、无中继服务器" | 单列 FWArmy：可自建、只转发密文、队列内存 30 秒、**能看到元数据**、可 DoS/替换公钥、管理面边界、运营者合规责任 |
| IM | 未展开 | 单列微信 iLink：扫码授权、token 优先加密（不可用标记明文）、消息经腾讯、限流/风控、解绑方式 |
| 日志/审计/记忆/知识库 | 表格列出 | 说明各自内容、是否会被模型读取、审计绝不上传但可能含路径/错误片段、最近删除 48 小时 |
| 崩溃/更新 | 未单列 | 无自动崩溃上报 SDK；本机 `warmy-boot.log`；打开关于页会自动查 GitHub/npm；SHA-256 校验；当前不自动安装 |
| 儿童/跨境 | 一句 | 单列：不面向儿童、不做年龄验证；维护者不实施跨境，用户选境外服务时自行合规（PIPL/GDPR） |
| 删除 | "删除用户数据目录" | 给出 Windows/macOS/Linux 精确路径、卸载不删数据、云端/IM/中继/GitHub/导出备份各自的删除方式 |
| 权利 | 简述 | GDPR/CCPA/PIPL 权利清单 + 无服务器架构下如何行使（本机导出/删除；邮件/Issue 只能处理我们持有的内容） |
| 法律基础 | 无 | GDPR Art.6 对照表、CCPA 不出售/不共享、PIPL 跨境提示 |
| 条款 | 合并在隐私里 | 独立：LICENSE 关系、自管凭证不可恢复、AI/工具/高风险、第三方/中继、免责、责任限制（免费软件上限 0 元）、赔偿、终止、法律与争议、语言 |
| 联系方式 | `Public@numumu.com` 重复两次 | `Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy`（只出现一次 `Public@`） |

---

## 2. 代码中正文的精确位置（当前工作树）

> 先澄清命名：仓库里**没有** `termsBody` / `privacyBody` 这两个变量，也**没有**旧的 `docs/TERMS.md`。首启条款正文来自 i18n 的 `privacy.body`；关于页/隐私弹窗来自 `privacy.ti`；旧版使用条款是合并在隐私正文里的，没有独立文件。

| 文件 | 键 / 位置 | 当前行（参考） | 被谁使用 |
|------|-----------|----------------|----------|
| `packages/app-shell/src/i18n/zh-CN.json` | `privacy.body` | 2356 | 首启条款页（`auth-gate.js` 的 `renderTerms`） |
| 同上 | `privacy.ti` | 2361 | 关于页正文、隐私弹窗（`app.js`；应用内是摘要，不是完整文档） |
| 同上 | `about.contactBody` | 7 | 关于页联系方式 |
| `packages/app-shell/src/i18n/en-US.json` | `privacy.body` / `privacy.ti` / `about.contactBody` | 1718 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/zh-TW.json` | 同上 | 1719 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/ja.json` | 同上 | 1719 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/ko.json` | 同上 | 1719 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/fr.json` | 同上 | 1718 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/es.json` | 同上 | 1718 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/pt.json` | 同上 | 1718 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/ru.json` | 同上 | 1718 / 1985 / 51 | 同上 |
| `packages/app-shell/src/i18n/eo.json` | 同上 | 1718 / 1985 / 51 | 同上 |

渲染侧锚点（不要改逻辑，只确认取的是哪个键）：

- `packages/app-shell/src/renderer/auth-gate.js:1577`：
  `const full = state.pack && typeof state.pack === 'object' ? state.pack['privacy.body'] : '';`
- `packages/app-shell/src/renderer/app.js:13001`：`privacyHtml(t('privacy.ti'))`（关于页正文）
- `packages/app-shell/src/renderer/app.js:27328`：`privacyHtml(t('privacy.ti'))`（隐私弹窗）
- `packages/app-shell/src/renderer/app.js:13157`：`escapeHtml(t('about.contactBody'))`（关于页联系方式）
- `packages/app-shell/src/renderer/app.js:13003` / `13802`：撤销同意按钮与确认

**构建产物不要手改**（改了也会被下次构建覆盖）：

- `packages/app-shell/dist/i18n/*.json`
- `release/win-unpacked/resources/app/dist/i18n/*.json`
- `packages/app-shell/dist/renderer/auth-gate.js`

请改 `src/i18n`，然后重新构建/打包，再核对 dist 与 release 里的副本。

---

## 3. 必须替换的精确文案

### 3.1 联系方式（所有 10 个语言包 + 隐私正文尾部）

**中文界面（zh-CN / zh-TW）逐字使用：**

```text
Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy
```

**其他语言允许本地化"仓库与问题反馈"这个标签，但必须满足：**

- `Public@numumu.com` 只出现 1 次；
- 必须包含 `232307860@qq.com`；
- 顺序固定为：`Public@numumu.com · 232307860@qq.com · <本地化标签>：https://github.com/Pondsi/WArmy`；
- 不得再出现两个 `Public@numumu.com` 紧挨着（中间只有 `·`）的写法。

**旧值锚点**（10 个语言包都是这个模式，可用全局搜索定位）：

```text
Public@numumu\.com · Public@numumu\.com · <本地化标签>：https://github.com/Pondsi/WArmy
```

（上面是正则写法；用来全局搜索旧值。实际旧文件里是真实邮箱，不是反斜杠。）

当前工作树里 `about.contactBody` 的状态（**来源待确认，不是本轮改的**）：

| 语言 | 当前值 | 要改的点 |
|------|--------|----------|
| zh-CN | `Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy` | 已符合；无需再改 |
| zh-TW | `... · 倉庫：https://github.com/Pondsi/WArmy` | 改成 `倉庫與問題回饋：`（或直接使用上面的中文固定串） |
| en-US / eo | `... · Repo: https://github.com/Pondsi/WArmy` | 改成 `Repo and issues:` |
| ja | `... · リポジトリ: https://github.com/Pondsi/WArmy` | 改成 `リポジトリと Issues:` |
| ko | `... · 저장소: https://github.com/Pondsi/WArmy` | 改成 `저장소와 이슈:` |
| fr | `... · Dépôt : https://github.com/Pondsi/WArmy` | 改成 `Dépôt et issues :` |
| es | `... · Repo: https://github.com/Pondsi/WArmy` | 改成 `Repositorio e incidencias:` |
| pt | `... · Repo: https://github.com/Pondsi/WArmy` | 改成 `Repositório e issues:` |
| ru | `... · Репозиторий: https://github.com/Pondsi/WArmy` | 改成 `Репозиторий и issues:` |

可直接粘贴的 `about.contactBody` 目标值：

```text
zh-CN：Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy
zh-TW：Public@numumu.com · 232307860@qq.com · 倉庫與問題回饋：https://github.com/Pondsi/WArmy
en-US：Public@numumu.com · 232307860@qq.com · Repo and issues: https://github.com/Pondsi/WArmy
eo：Public@numumu.com · 232307860@qq.com · Repo and issues: https://github.com/Pondsi/WArmy
ja：Public@numumu.com · 232307860@qq.com · リポジトリと Issues: https://github.com/Pondsi/WArmy
ko：Public@numumu.com · 232307860@qq.com · 저장소와 이슈: https://github.com/Pondsi/WArmy
fr：Public@numumu.com · 232307860@qq.com · Dépôt et issues : https://github.com/Pondsi/WArmy
es：Public@numumu.com · 232307860@qq.com · Repositorio e incidencias: https://github.com/Pondsi/WArmy
pt：Public@numumu.com · 232307860@qq.com · Repositório e issues: https://github.com/Pondsi/WArmy
ru：Public@numumu.com · 232307860@qq.com · Репозиторий и issues: https://github.com/Pondsi/WArmy
```

> 旧版正文的尾部锚点：中文是 `【联系方式】`，英文/法/西/葡/世界语是 `Contact.`，日文 `連絡先。`，韩文 `연락처.`，俄文 `Контакты.`。新版正文会整体替换，不再需要保留这些旧标签。

### 3.2 `privacy.body` / `privacy.ti` 的简体中文新全文（逐字替换整个值）

> 两个键必须**完全一致**。不要保留旧值的任何一段；不要加首尾空格；段间用两个换行（JSON 里是 `\n\n`）。
> 正文故意使用纯文本（无 Markdown 星号/反引号），因为 `auth-gate.js` 会 `escapeHtml` 后只把 `\n` 换成 `<br/>`。
>
> **初次审计时的旧值锚点**：起点 `【一句话】本软件没有中心服务器`，终点 `（完整版见仓库 docs/PRIVACY.md）`。如果当前值已经不是这个开头（例如以 `【隐私与使用条款 · 2026-10-24 版】` 开头），说明已被并发替换；此时要么整体改用本节文本，要么保留新版但按 §0 第 2 条补齐缺口，不要两版混拼。

```text
【一句话】WArmy 是本地优先的桌面软件：没有服务器端账号系统，也没有能接收你数据的自有后端。除你主动发到 GitHub 或邮箱的内容外，维护者不持有你的个人数据。

【数据在哪】会话与消息（本机 JSONL，唯一事实来源）、项目/群/看板、记忆索引（SQLite/向量，可由日志重建）、知识库与归档、审计日志、设置与网络配置，默认都在本机用户数据目录，不会自动上传。注意：这些文件默认没有加密，依赖你的系统账户与磁盘加密；只有身份私钥、助记词、模型 API Key、社交密码使用系统安全存储（Windows DPAPI / macOS 钥匙串）加密。

【何时联网】只在你主动操作或配置时：① 云端模型（你填的服务商，内容由你选择）；② 本机 Ollama（默认 127.0.0.1，不出本机）；③ 检查更新（打开「关于」会自动查，向 GitHub API 与 npm registry 询问版本，不带设备 ID 或会话内容）；④ 技能/插件市场与本地语音模型下载（GitHub / Hugging Face）；⑤ 局域网/公网组网（局域网 UDP 发现、直连、你指定的 STUN/端口映射）；⑥ 可选 FWArmy 中继；⑦ 你连接的微信 iLink、企微、Telegram、飞书等 IM；⑧ 你点击的外部链接。我们不使用统计、广告或自动崩溃上报 SDK。

【模型与密钥】模型服务与 API Key 由你自备（BYO）。Key 加密保存在本机，只作为请求鉴权信息发给你填写的服务商，不发给维护者；费用、额度、日志与训练政策由该服务商决定。发送给模型的内容可能包括对话、附件、工具输出、知识库或记忆摘录，请不要放入你不愿交给该服务商的信息。

【中继】FWArmy 是可选、独立、可自建的中继程序，维护者不运营它。它只转发端到端加密的信封，队列在内存、30 秒 TTL，不落盘消息；但它能看到元数据（DID、IP、时间、大小、凭据用量），也能拒绝服务或替换公钥。请带外核对身份指纹；公网使用请自行配置 TLS。

【第三方 IM】连接微信 iLink 等平台后，消息会经过对应平台服务器，适用其隐私政策；平台可能限流、静默风控或变更接口。机器人 token 优先加密保存在本机（系统保护不可用时会标记为明文），可在应用内断开并在平台侧解除授权。

【日志/审计/记忆/知识库】审计日志只在本机、绝不上传，可清空；它可能含时间、会话 ID、模型 ID、错误与文件路径。记忆是只追加日志，知识库是你存入或从归档提取的内容；二者都可能被检索并作为上下文发给模型，归档摘要也可能由你配置的归档模型生成。删除的会话进入「最近删除」，48 小时后自动永久清理，也可立即清空。

【崩溃与更新】未集成自动上传的崩溃上报；崩溃原因写在本机 warmy-boot.log，系统也可能保留本机崩溃转储，我们不上传、不读取。若你主动把日志发给我们，请先删除用户名、路径、密钥等敏感信息。更新包按发布源提供的 SHA-256 校验；当前版本不自动安装。

【你的权利】你可导出对话、身份备份、成本 CSV，可修改或删除本机数据，可在「设置 → 关于」撤销同意（应用退出，下次启动须重新同意）。删除本机数据：退出应用后删除用户数据目录（Windows 为 %APPDATA%\@warmy\app-shell；macOS 为 ~/Library/Application Support/@warmy/app-shell；Linux 为 ~/.config/@warmy/app-shell，或 $XDG_CONFIG_HOME 下的同名目录）。卸载程序不一定会删除该目录。云端模型侧的数据请到服务商处删除；GitHub 内容可自行编辑或删除。

【不能承诺】没有服务器端账号，也没有"账号找回"；24 词助记词是本机生成的唯一恢复凭证，丢失后任何人都无法替你恢复，包括维护者。设备被入侵、同账户恶意程序、第三方插件或脚本、模型服务商、IM 平台、你自建中继的合规与安全，均不在我们控制范围内。

【儿童/跨境/变更】本软件不面向儿童；未成年人须在监护人同意下使用。维护者不实施跨境传输；你选择境外模型、IM 或中继时，是你自行向其提供数据，请自行确认当地法律要求（如中国 PIPL 的跨境规则、欧盟 GDPR）。政策有版本号与生效日期；重大变更会在仓库发布说明中写明，涉及新增对外传输时会在启用前再次征求同意。

【使用条款】使用条款还包含：AI 输出可能错误、需人工复核；软件按"现状"提供，不承诺可用性；在法律允许范围内维护者不承担间接损失。继续使用即表示你接受这些条款。

【联系方式】Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy
完整版：仓库 docs/PRIVACY.md 与 docs/TERMS.md。
```

> **JSON 转义警告**：上面路径里的反斜杠在 JSON 字符串中必须转义。不要手工把 `\@warmy` 原样粘进 JSON；请用 §4 的 `JSON.stringify` 脚本（会自动写成 `\\@warmy` 与 `\n\n`），或手工写成 `%APPDATA%\\@warmy\\app-shell`。改完必须 `JSON.parse` 能读。

### 3.3 `privacy.body` / `privacy.ti` 的英文新全文（逐字替换整个值）

> 英文版是其余 8 种语言的翻译母本。两个键必须完全一致；不要保留旧值。
>
> **初次审计时的旧值锚点**：起点 `In one line. This app has NO central server`，终点 `(full text: docs/PRIVACY.md)`。如果当前值已经是 `IN ONE LINE. WArmy is local-first...`，说明并发进程已把本节英文写进多个语言包，但**没有翻译**；仍需按语言替换，不能直接发版。

```text
IN ONE LINE. WArmy is local-first desktop software: there is no server-side account system and no backend of ours that receives your data. Apart from what you voluntarily post to GitHub or send by email, the maintainer holds no personal data about you.

WHERE DATA LIVES. Chats and messages (local JSONL, the source of truth), projects/groups/board, memory indexes (SQLite/vector, rebuildable from the log), knowledge base and archives, audit log, settings and network config live in your local user-data directory by default and are not uploaded automatically. Note: most of these files are NOT encrypted at rest; they rely on your OS account and disk encryption. Only the identity private key, mnemonic, model API keys and social passwords use OS secure storage (Windows DPAPI / macOS Keychain).

WHEN IT GOES ONLINE. Only when you act or configure it: (1) cloud models you configure; (2) local Ollama (default 127.0.0.1, stays on device); (3) update checks (opening About checks automatically; GitHub API and npm registry receive a version query, with no device ID or chat content); (4) skill/plugin market and local speech-model downloads (GitHub / Hugging Face); (5) LAN/public networking (LAN UDP discovery, direct connections, STUN/port mapping you specify); (6) optional FWArmy relay; (7) WeChat iLink, WeCom, Telegram, Feishu and other IMs you connect; (8) external links you click. We use no analytics, advertising or automatic crash-reporting SDK.

MODELS AND KEYS. You bring your own provider and API key. The key is encrypted locally and sent only as request authentication (usually an Authorization header) to the endpoint you entered, never to the maintainer. Costs, quotas, logging and training are governed by that provider. Content sent to a model may include chats, attachments, tool output and excerpts from memory or knowledge; do not include anything you would not give that provider.

RELAY. FWArmy is an optional, independent, self-hostable relay; the maintainer does not operate it. It forwards end-to-end encrypted envelopes only; queues are in memory with a 30-second TTL and messages are not written to disk. It can still see metadata (DID, IP, time, size, credential usage) and can deny service or substitute public keys. Verify identity fingerprints out of band; use TLS if you expose it publicly.

THIRD-PARTY IM. When you connect WeChat iLink or similar platforms, messages pass through that platform's servers under its privacy policy; the platform may throttle, silently restrict, or change its API. The bot token is encrypted locally when OS protection is available (otherwise it is explicitly marked as plain); you can disconnect in the app and revoke access on the platform.

LOGS, AUDIT, MEMORY, KNOWLEDGE. The audit log stays local and is never uploaded; you can clear it. It may contain timestamps, session IDs, model IDs, errors and file paths. Memory is an append-only log; the knowledge base contains what you save or extract from archives. Both may be retrieved and sent to a model as context, and archive summaries may be produced by an archive model you configure. Deleted chats go to "Recently deleted" and are permanently purged after 48 hours, or you can clear them immediately.

CRASHES AND UPDATES. There is no automatic crash-upload SDK; crash reasons are written to the local warmy-boot.log, and the OS may keep local crash dumps, which we neither upload nor read. If you send us logs, remove usernames, paths and secrets first. Update packages are verified against the SHA-256 from the release feed; this version does not auto-install.

YOUR RIGHTS. You can export chats, an identity backup and a cost CSV; edit or delete local data; and revoke consent in Settings → About (the app quits and asks again next launch). To erase local data, quit the app and delete the user-data directory (Windows: %APPDATA%\@warmy\app-shell; macOS: ~/Library/Application Support/@warmy\app-shell; Linux: ~/.config/@warmy/app-shell or the same name under $XDG_CONFIG_HOME). Uninstalling may not remove it. Delete cloud-model data at the provider; edit or delete GitHub content yourself.

WHAT WE CANNOT DO. There is no server-side account and no "account recovery". The 24-word mnemonic is generated locally and is the only recovery credential; if it is lost, nobody, including the maintainer, can restore it. Compromised devices, malware running as you, third-party plugins or scripts, model providers, IM platforms, and relays you run are outside our control.

CHILDREN / CROSS-BORDER / CHANGES. The software is not directed to children; minors need guardian consent. The maintainer does not transfer data across borders; when you choose a foreign model, IM or relay, you are providing data to it yourself, and you must check local law (e.g. China PIPL cross-border rules, EU GDPR). This policy has a version and effective date; material changes are noted in release notes, and any new off-device transfer will require fresh consent before it is enabled.

TERMS. The Terms of Use also state that AI output may be wrong and needs human review, that the software is provided "as is" without availability guarantees, and that, to the extent permitted by law, the maintainer is not liable for indirect loss. Continued use means you accept them.

CONTACT. Public@numumu.com · 232307860@qq.com · Repository and issues: https://github.com/Pondsi/WArmy
Full text: docs/PRIVACY.md and docs/TERMS.md in the repository.
```

### 3.4 其余 8 种语言（zh-TW / ja / ko / fr / es / pt / ru / eo）

必须把 §3.3 的英文母本翻译后写入对应语言的 `privacy.body` 与 `privacy.ti`，要求：

- 两个键**逐字一致**；
- 保留全部 13 个段落与小标题（可本地化标题，但不得删段）；
- 保留所有数字与事实：24 词、48 小时、30 秒、127.0.0.1、SHA-256、`%APPDATA%\@warmy\app-shell` 等；
- 不得把"没有服务器端账号/无法恢复助记词"翻成相反意思；
- 联系方式按 §3.1 本地化，但邮箱与 URL 不变；
- 不要保留旧版首句（例如英文旧版 `In one line. This app has NO central server...`，日文 `一言で言うと。このアプリには中央サーバーがありません...`）。发布前用 §5 的检查脚本确认。

如果短期无法完成 8 种翻译，**不要发版**；或者临时把这 8 个语言的 `privacy.body`/`privacy.ti` 回退为英文新版（至少法律表述一致），并在发布说明中注明"该语言条款暂以英文提供"。**不要**让旧版继续留在界面上。

### 3.5 标题类键（建议同批改）

正文已经包含使用条款，标题继续叫"隐私政策"会误导。建议：

| 键 | zh-CN / zh-TW | en-US | 说明 |
|----|---------------|-------|------|
| `privacy.title` | 隐私与使用条款 | Privacy & Terms | 关于页标题 |
| `privacy.biaoTi` | 隐私与使用条款 | Privacy & Terms | 隐私弹窗标题 |
| `privacy.viewTitle` | 隐私与使用条款（摘要） | Privacy & Terms (summary) | 关于页正文标题；不要写"全文"，应用内是摘要，完整版在仓库 |
| `termsTitle`（`auth-gate.js` 内） | 已是"隐私与使用条款" | 已是 "Privacy & terms" | 首启标题，通常不用改 |

其他 8 种语言按同义翻译；`termsTitle` 在 `auth-gate.js` 的各语言对象里已存在，检查是否也表达"隐私与条款"，不要只写"隐私"。

---

## 4. 可直接使用的替换脚本（仅示意，本轮未执行）

> 目的：只改指定键的值，保留文件其余格式与键顺序，避免 `JSON.stringify` 全量重排造成巨大 diff。
> 先把 §3.2 / §3.3 的正文分别保存为 `new-zh.txt` / `new-en.txt`（UTF-8，无 BOM），再运行。

```js
// node scripts/apply-r81-legal.cjs  （示例；本轮未创建、未执行）
const fs = require('fs');
const path = require('path');

const I18N = 'packages/app-shell/src/i18n';
const bodies = {
  'zh-CN': fs.readFileSync('new-zh.txt', 'utf8'),
  'en-US': fs.readFileSync('new-en.txt', 'utf8'),
};
const contact = {
  'zh-CN': 'Public@numumu.com · 232307860@qq.com · 仓库与问题反馈：https://github.com/Pondsi/WArmy',
  'zh-TW': 'Public@numumu.com · 232307860@qq.com · 倉庫與問題回饋：https://github.com/Pondsi/WArmy',
  'en-US': 'Public@numumu.com · 232307860@qq.com · Repo and issues: https://github.com/Pondsi/WArmy',
  'eo':    'Public@numumu.com · 232307860@qq.com · Repo and issues: https://github.com/Pondsi/WArmy',
  'ja':    'Public@numumu.com · 232307860@qq.com · リポジトリと Issues: https://github.com/Pondsi/WArmy',
  'ko':    'Public@numumu.com · 232307860@qq.com · 저장소와 이슈: https://github.com/Pondsi/WArmy',
  'fr':    'Public@numumu.com · 232307860@qq.com · Dépôt et issues : https://github.com/Pondsi/WArmy',
  'es':    'Public@numumu.com · 232307860@qq.com · Repositorio e incidencias: https://github.com/Pondsi/WArmy',
  'pt':    'Public@numumu.com · 232307860@qq.com · Repositório e issues: https://github.com/Pondsi/WArmy',
  'ru':    'Public@numumu.com · 232307860@qq.com · Репозиторий и issues: https://github.com/Pondsi/WArmy',
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [loc, file] of Object.entries(contact)) {
  const p = path.join(I18N, loc + '.json');
  let raw = fs.readFileSync(p, 'utf8');

  // 1) 联系方式：整值替换
  const cre = new RegExp('("about\\.contactBody"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")');
  if (!cre.test(raw)) throw new Error('missing about.contactBody: ' + loc);
  raw = raw.replace(cre, (_m, p1) => p1 + JSON.stringify(file));

  // 2) 正文：只对已有译文的语言整值替换；其余语言先别动，等翻译
  const body = bodies[loc];
  if (body) {
    for (const key of ['privacy.body', 'privacy.ti']) {
      const re = new RegExp('("' + escapeRe(key) + '"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")');
      if (!re.test(raw)) throw new Error('missing ' + key + ': ' + loc);
      raw = raw.replace(re, (_m, p1) => p1 + JSON.stringify(body));
    }
  }

  fs.writeFileSync(p, raw);
  console.log('patched', p);
}
```

注意事项：

- `privacy.body` 与 `privacy.ti` 必须用**同一段文本**；不要一个换一个不换。
- 如果 `JSON.stringify` 产生 `\/` 之类的差异，先 `git diff` 看是否只变了目标行；若格式被大面积重排，改用"整行替换"或手工替换。
- 不要用 `sed` 直接改 JSON 里的转义换行；用脚本的 `JSON.stringify` 最稳。
- 改完**不要**提交 `dist/` 与 `release/`；重新构建。

---

## 5. 验收清单（建议直接做成门禁）

### 5.1 静态检查（10 个语言包）

```bash
node - <<'NODE'
const fs = require('fs');
const LOCALES = ['zh-CN','zh-TW','en-US','ja','ko','fr','es','pt','ru','eo'];
let bad = 0;
for (const loc of LOCALES) {
  const p = `packages/app-shell/src/i18n/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const b = String(j['privacy.body'] || '');
  const t = String(j['privacy.ti'] || '');
  const problems = [];
  if (b !== t) problems.push('privacy.body !== privacy.ti');
  if (b.length < 1500) problems.push('body too short: ' + b.length);
  if ((b.match(/Public@numumu\.com/g) || []).length !== 1) problems.push('Public@numumu.com count != 1');
  if (!b.includes('232307860@qq.com')) problems.push('missing QQ email');
  if (!b.includes('https://github.com/Pondsi/WArmy')) problems.push('missing repo URL');
  if (/In one line\. This app has NO central server|【一句话】本软件没有中心服务器/.test(b)) problems.push('old body still present');
  if (loc !== 'en-US' && /^IN ONE LINE\. WArmy is local-first/.test(b)) problems.push('untranslated English body');
  if (!String(j['about.contactBody'] || '').includes('232307860@qq.com')) problems.push('about.contactBody missing QQ');
  if ((String(j['about.contactBody'] || '').match(/Public@numumu\.com/g) || []).length !== 1) problems.push('about.contactBody Public count != 1');
  if (problems.length) { bad++; console.log(loc, problems.join(' | ')); }
  else console.log(loc, 'OK', b.length);
}
process.exit(bad ? 1 : 0);
NODE
```

### 5.2 渲染检查（手动/自动）

- 首启：选语言 → 条款页 → 必须滚动到底 + 停留 3 秒，按钮才可用；点「不同意并退出」能退出。
- 首启：条款正文包含"没有服务器端账号""无法替你恢复助记词""232307860@qq.com"；不出现两个 `Public@`。
- 关于页：全文弹窗显示同一段正文；底部撤销同意仍可用，撤销后退出、下次启动重新同意。
- 10 种语言逐一切换，确认没有旧版首句、没有英文串到日/韩/法界面（除非临时回退并在发布说明注明）。
- `privacy.body` 里的 `%APPDATA%\@warmy\app-shell` 在界面上显示为单反斜杠（JSON 解析后正确），不要出现 `\\` 双反斜杠。

### 5.3 建议新增门禁

在 `dev/gates/` 新增 `verify-r81-legal.mjs`（或并入 `verify-r67-firstrun.mjs`）断言：

1. 10 个语言包的 `privacy.body` / `privacy.ti` 均非空、相等、长度 ≥ 1500；
2. 均包含 `232307860@qq.com`，且 `Public@numumu.com` 恰好 1 次；
3. 不含旧版首句（中/英各一条）；除 `en-US` 外，不得以 `IN ONE LINE. WArmy is local-first` 开头（防"英文冒充译文"）；
4. `about.contactBody` 含 QQ，且 `Public@` 恰好 1 次；
5. `docs/PRIVACY.md`、`docs/TERMS.md`、`docs/HANDOFF-R81-LEGAL.md` 存在；
6. 禁止词：`找回助记词`、`恢复助记词`、`账号找回`、`云端备份`（除非明确否定）；
7. `privacy.body` 不含 Markdown `**` 或反引号（避免界面原样显示）。

---

## 6. 不要在代码/界面里声称的事

以下都是**当前没有实现**或**无法兑现**的，文案与 UI 都不要写：

1. **"服务器端账号""登录账号""云端账户"**：没有。只有本机 `auth/vault.json` 与 `identity/identity.json`。
2. **"帮你找回/重置助记词"**：没有。没有客服后门、没有安全问题找回、没有邮件重置。UI 不要放"忘记助记词？联系我们"这类入口。
3. **"云端备份/自动同步/换机自动恢复"**：没有。身份备份是用户手动导出、加密、自己保管。
4. **"一键自动安装更新"**：`updater.ts` 明确 `installImplemented: false`；当前只下载 + SHA-256 校验。不要写"更新已完成"。
5. **"默认开启中继/默认联网"**：没有。FWArmy 需要用户显式配置；组网/STUN/端口映射都需要显式触发。
6. **"消息一定送达/不丢"**：没有。离线消息留在发送方本机，中继队列 30 秒；UI 只能如实显示"未送达"。
7. **"端到端加密能隐藏一切"**：不能。中继能看到元数据（DID/IP/时间/大小）；公网还需自行配 TLS。
8. **"本机数据全部加密"**：不实。会话/记忆/知识库/审计默认明文；只有密钥类走系统安全存储。
9. **"已通过安全认证/渗透测试"**：没有。不要加认证徽章或"银行级安全"。
10. **"安装目录内有完整条款"**：当前打包是否复制 `docs/` 未确认；在确认打包脚本会带上 `docs/PRIVACY.md`、`docs/TERMS.md` 之前，正文只写"仓库 docs/…"，不要写"安装目录内"。
11. **"按版本重新同意"**：当前 `privacyConsent` 只是布尔值，没有版本比对。若要实现：在 `settings.json` 增加 `privacyVersion`，启动时与当前条款版本比较，不一致则重新进入条款页；在实现之前，不要宣传"每次条款更新都会重新征得同意"。新文档的写法是"涉及新增对外传输时会在启用前再次征求同意；若届时未实现该流程，不会启用该传输"，这是可兑现的承诺。

---

## 6.5 需要你确认的法律口径（文档里已按保守写法处理）

1. **适用法律与管辖**：`docs/TERMS.md` §15 默认写"中华人民共和国法律 + 维护者住所地法院"，并保留消费者强制权利优先。如果维护者常驻地不是中国大陆，或你希望改为其他辖区，请改这一段；不要留着与实际不符的管辖。
2. **责任上限 0 元**：这是免费开源软件的常见写法，但是否可执行取决于辖区；文档已保留"故意/重大过失、人身损害、欺诈、消费者强制权利"的例外。正式商用前建议让律师看一眼。
3. **答复时限**：隐私政策已改成"合理时间内答复；如法律有期限则遵守（GDPR 通常 30 天，CCPA 45 天）"，没有写死"必达"。
4. **FWArmy 公共中继**：文档明确"维护者不运营公共中继"。如果未来你运营公共中继，需要新增运营者信息、滥用处置流程、日志保留期限与合规声明，不能沿用本文。
5. **打包是否带 docs**：如果安装包会复制 `docs/PRIVACY.md` / `docs/TERMS.md`，可以在界面写"安装目录内也有全文"；当前未确认，所以正文只写"仓库 docs/…"。确认后再加。
6. **条款版本号**：当前没有 `privacyVersion` 字段；若要做"每次重大变更重新同意"，按 §6 第 11 条实现。实现前不要宣传。
7. **`about.contactBody` 的既有改动**：工作树里重复邮箱已被改成 QQ；`zh-CN` 现在是 `仓库与问题反馈：`，但 `zh-TW` 仍是 `倉庫：`、英文仍是 `Repo:`。请先 `git log -S "232307860@qq.com" -- packages/app-shell/src/i18n` 或问清来源，再决定是否保留；本轮没有改它。

## 7. 构建与发布

1. 只改 `packages/app-shell/src/i18n/*.json`（以及可选的标题键）。
2. 跑现有首启门禁：`node dev/gates/verify-r67-firstrun.mjs`（按仓库实际脚本入口为准）。
3. 重新构建 renderer / app-shell，确认：
   - `packages/app-shell/dist/i18n/*.json` 已更新；
   - `release/win-unpacked/resources/app/dist/i18n/*.json` 已更新；
   - `packages/app-shell/dist/renderer/auth-gate.js` 仍是读取 `privacy.body`（不要改逻辑）。
4. 真机首启验收（至少 zh-CN / en-US / ja / ar? 本项目无 ar，按 10 语言抽 3 种）。
5. 发布说明写：隐私政策 2.0 / 使用条款 2.0；联系方式变更；说明"本机数据默认未加密"的新披露。

---

## 8. 回滚

- 文档：`git checkout -- docs/PRIVACY.md` 可回到 1.0；`docs/TERMS.md` 与本文是新增文件，删除即可。
- 代码：只回滚 `src/i18n` 的目标键；不要 `git checkout -- .`（工作树有大量其他人的未提交改动）。
- 若只上了部分语言：把已换的语言与未换的语言列清楚，未换语言不要发版，避免同一版本内条款不一致。

---

## 9. 本轮证据（只读核对，未改代码）

- 首启读 `privacy.body`：`packages/app-shell/src/renderer/auth-gate.js:1577`。
- 关于页/弹窗读 `privacy.ti`：`packages/app-shell/src/renderer/app.js:13001`、`27328`。
- 关于页联系方式：`packages/app-shell/src/renderer/app.js:13157`。
- 撤销同意：`packages/app-shell/src/renderer/app.js:13003`、`13802`；主进程 `warmy:yinSiTongYiSheZhi` 在 `packages/app-shell/src/electron-main.ts:21170` 附近。
- 审计绝不上传：`packages/app-shell/src/audit.ts:2`。
- API Key 系统安全存储：`packages/app-shell/src/secure-keys.ts:1-20`。
- 社交密码加密/明文标记：`packages/app-shell/src/cred-vault.ts:1-30`。
- 身份私钥加密：`packages/app-shell/src/identity-store.ts:1-20`。
- 助记词 24 词 / PBKDF2：`packages/app-shell/src/auth-core.mjs:9-14`、`auth-service.ts:1-15`。
- 更新检查源：`packages/app-shell/src/settings-store.ts:679`、`updater.ts:1-25`；关于页自动检查：`renderer/app.js:13210`。
- 中继不落盘/TTL/元数据：`docs/SERVER-RELAY.md` §1、§3、§6、§8。
- 微信 iLink 端点/鉴权：`packages/app-shell/src/she-jiao-adapter.ts:200-260`。
- 本地语音模型来源：`packages/app-shell/src/bendi-yuyin.ts:13`、`85-106`。
- 用户数据目录：`packages/app-shell/src/electron-main.ts:301-310`。
- 许可证：`LICENSE`（MIT + 强制署名）。

---

## 6. 代码替换已完成（2026-10-24 本轮）

- `packages/app-shell/src/i18n/zh-CN.json`：`privacy.body` 与 `privacy.ti` 已替换为简体中文新全文（约 2.3k 字，含联系方式唯一一次 `Public@numumu.com` + `232307860@qq.com` + “仓库与问题反馈”）。
- `en-US.json`：`privacy.body` / `privacy.ti` 已替换为英文新全文（来自本文件 §3.3，约 5.3k 字符）。
- 其余 8 语言（zh-TW/ja/ko/fr/es/pt/ru/eo）暂以**英文新版**兜底，避免继续显示旧版不实承诺；待 #109 模型逐条校对时翻译。
- `about.contactBody`：zh-CN 已是“仓库与问题反馈：”；其余 9 种语言的本地化标签也统一为“仓库/仓库与问题回馈/Repository and issues/リポジトリと Issues/저장소와 이슈/Dépôt et issues/Repositorio e incidencias/Repositório e issues/Репозиторий и issues/Repo and issues”，不再只有“仓库：/Repo:”。
- 修正中文正文错引：“不同意请停止使用并按第九节删除数据” → “按第八节删除数据”（删除路径在第八节）。
- 验收：`verify-i18n-locales` 162/0；`verify-r81-ui` **9/0**（新增 10 语言联系方式去重、zh-CN 逐字联系方式、两份文档版本号）；`verify-r78-auth-tour` **45/0 ×3**（新增返回箭头断言）。
