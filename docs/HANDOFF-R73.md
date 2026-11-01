# 第 73 轮交接（2026-10-23）——P0-6 白名单可撤销 + 停止全量验收后的收尾

> 中途按用户指令**停止全量验收**，只验收最近改动的功能与界面；未 commit / 未 push。
> 首启已做完：应用已重开在语言选择页。

## 0. 本轮口径

用户原话：**"先停下全量验收，只验收最近做的功能和界面等就行。要写交接文档，有什么没有完成的，需要我协助的都要详细说明给我听。要首启让我验收。"**

因此：
- 已启动的 live 全量第 1 遍在跑完后**没有继续跑第 2/3 遍**；
- 下面只把"最近改动的功能/界面"重新验了一遍并给出读数；
- 全量档的 2 个红项如实保留在 §3，不冒充绿。

## 1. 本轮完成

### 1.1 P0-6 白名单 D：自动生效 + 审计可见 + 一键撤销

用户在第 64 轮选了 D（自动生效、可追溯、可撤销）。之前只落了代码锚点，没有界面。本轮补齐：

- 主进程新增两支 IPC：
  - `warmy:nengLiWaiLieBiao`：返回 `base`（固定类别数）+ `items`（自动加入的条目 id/hua/ci）；
  - `warmy:nengLiWaiCheXiao`：按 id 撤销自动条目，写 `nengli.json`，落审计 `kb.capability-removed`。
  - 固定类别 `NENG_LI_BIAO` **不会**出现在可撤销列表里；未知 id 返回 `not-found`，不会误删。
- 设置 → 功能新增「能力白名单（自动提案）」卡片：
  - 显示「固定类别 N · 自动加入 M」；
  - 每条显示能力短语与关键词，旁边一个「撤销」按钮；
  - 撤销前二次确认，文案说明“撤销后这个能力类别不再允许出现在对外概要里”；
  - 撤销后重新拉列表，成功/失败都有提示。
- 10 个语言包新增 9 个键（标题、说明、固定/自动计数、空态、撤销、确认、成功、失败）。
- 门禁：新增真机 `dev/gates/verify-r73-nengli.mjs`（临时 profile，预置两条 `nengli.json`）：
  预置可读 → 设置页能看到卡片与两条撤销按钮 → 二次确认 → 撤销后界面/磁盘都只剩 1 条 → 未知 id 不误删 → 审计有 `kb.capability-removed` → 无脚本错误。**7/0，连续 3 遍**。

涉及文件：
- `packages/app-shell/src/electron-main.ts`（IPC、审计、导入 `NENG_LI_BIAO`）
- `packages/app-shell/src/preload.cjs`
- `packages/app-shell/src/renderer/app.js`（卡片 + 绑定）
- `packages/app-shell/src/i18n/*.json`（10 包）
- `dev/gates/verify-r73-nengli.mjs`、`dev/gates/run-verify-22.mjs`（LIVE 清单）
- `packages/app-shell/scripts/verify-r53-tumin.mjs`（新增 5 条静态不变量，现 **50/0**）

### 1.2 P0-6 历史会话库重扫：dry-run 脚本（只读）

用户选的是 B（先 dry-run 报告，再决定替换）。本轮交付：

- `packages/app-shell/scripts/p0-6-rescan-dryrun.mjs`
  - 默认读 `%APPDATA%\@warmy\app-shell\knowledge\knowledge-session.json`；
  - 只检查派生概要（`laiYuan === 'derived:redaction'`）与“长得像固定句式”的未标记概要；
  - 原始聊天/工具事件**不在处理范围**（它们不是对外概要，不能被当泄露证据删掉）；
  - 输出：总数、派生合格/不合格、未标记概要、原始事件数、前 20 条不合格的 id/标题/原因；
  - **绝不写数据**；
  - `--self-test` 用临时夹具验证 1 合格 + 1 不合格 + 1 未标记 + 1 原始事件，**SELF-TEST PASS**。
- 在真实首启 profile 上跑了一次：`knowledge-session.json` 不存在 ⇒ 0 条。
- 真正执行替换（会改数据）**没有做**，等报告给你看过再决定。

### 1.3 俄语残留

`ru.json` 的 `llm.toolRecallDesc` 里还有一处中文示例 `«[已省略 N 条历史 ...]»`，已改为 `«[пропущено N записей истории ...]»`。其余 3 处 CJK 是专名（`WB`/`WArmy` 等），不是漏译。

### 1.4 最近界面回归（只验最近，不跑全量）

| 门禁 | 读数 | 覆盖 |
|---|---|---|
| `verify-r68-auth-ui` | **45/0** | 恢复页 24 格、注册页、真实词/成语、PIN 文案、我的页、真实恢复 |
| `verify-r68-charge-preview` | **41/0** | 十幕冲锋预览：标题/清晰度/慢动画/键盘 |
| `verify-r63-main-ui` | **17/0** | 主界面/设置页（含新增“功能”卡片） |
| `verify-r66-auth` | **17/0** | 认证核心（含友好码本、siren/私人 撞名） |
| `verify-r67-firstrun` | **75/0** | 首启/认证静态不变量 |

### 1.5 本轮新增/修改的门禁

- 新增 `verify-r73-nengli`（真机，LIVE 档，7/0 ×3）。
- `verify-r53-tumin` 增加白名单 D 的 5 条静态不变量（**50/0**）。
- `verify-r44-shejiao` 修正两条**过期契约**（见 §3.1），现 **11/0**。
- `r38-firstrun.mjs` 的搬走清单加入 `nengli.json`（否则首启会看到上一轮自动能力）。

## 2. 最近改动的连续 3 遍读数

同一构建、连续 3 遍：

| 门禁 | 第 1 遍 | 第 2 遍 | 第 3 遍 |
|---|---|---|---|
| `verify-r53-tumin` | 50/0 | 50/0 | 50/0 |
| `verify-r73-nengli` | 7/0 | 7/0 | 7/0 |
| `verify-i18n-locales` | 162/0 | 162/0 | 162/0 |
| `verify-renderer-template-balance` | PASS | PASS | PASS |
| `verify-security` | PASS 28 | PASS 28 | PASS 28 |
| `verify-docs` | 95/0 | 95/0 | 95/0 |

另外，在本轮口径改变前，fast 全量曾跑过 **3 遍 × 113 项次 = 339 项次，0 真红 / 0 已知红 / 0 缺文件**（这是本轮改动完成后的构建）。live 全量只完成第 1 遍，结果见 §3。

## 3. 全量 live 第 1 遍的两个红（如实保留）

### 3.1 `verify-r44-shejiao`：门禁过期，已修

- 现象：`faSong('unknown', ...)` 期望 false，实际 true。
- 定性：**不是产品回归**。第 65 轮项 12 的真机结论是“收到消息却回不出去”，产品已明确改成 **没有 `context_token` 也按收件人发送**；旧门禁仍要求 `send-no-context-token`。
- 修复：门禁改为“缺 token 按收件人发送；带外来 token 才拒绝；之后合法发送恢复状态”，并同步另一条同类断言。
- 复跑：**11/0**。

### 3.2 `verify-round34-live`：MiMo 腿写出第二份小说（**未修**）

读数（报告在 `%TEMP%\warmy-r34-live-report-*.json`）：

- 主文件 `末班渡口.txt` **13644 字**（要求 ≥5700，已达标）；
- 但桌面多出 `末班渡口2.txt`（6519 字）；
- 轨迹里还有 6 次 `chat.tool-repeat-stopped`、1 次 `chat.tool-repeat-3x`、7 张「覆盖前确认」卡；
- 模型自述反复犯“同时带 `append` 和 `overwrite`”的错，最后另起 `末班渡口2.txt`；
- 门禁三条断言因此红：收场不干净、桌面多出副本、长文不是只有一份。

**这是什么问题**：门禁本身有“同一交付物不许换名重做”的守卫（`same-family-second`），但它只在**内容重合 ≥50%** 时拦；第二份是不同草稿，重合不足 ⇒ 放行。宿主也有“写了一半的长文不许换名重来”的守卫，但第一份已经写满，不满足“没写完”条件 ⇒ 放行。模型的 `append+overwrite` 混用也没有被硬拒，只触发了覆盖卡。

**建议的修法（尚未做，等你点头或下轮做）**：

1. `write_file` 参数里 **同时带 `append:true` 与 `overwrite:true` 直接拒绝**（不弹卡），回一句“续写只带 append，整篇重写只带 overwrite”。这能打断本次的循环根因。
2. 在“同类交付物”守卫里增加**文件名变体**判据：`末班渡口2.txt`、`末班渡口(2).txt`、`末班渡口 副本.txt` 等，当原文件已达到用户要求字数的 95% 时，**拒绝另起新文件**，要求对原路径 `append`/`edit_file`/明确 `overwrite`。
3. 门禁侧：对“覆盖前确认”卡，测试文件（在门禁自己的输出目录）可以选择「覆盖」，让模型能收拾自己的脏版本；或者把“出现覆盖卡”从 MiMo 腿的硬红改为“允许一张、但最终必须只有一个文件且无 repeat 事件”。
4. 若你更希望不改产品，只把它记为“模型能力问题”，也可以：但当前门禁会一直红，且用户会在桌面看到两份稿子。

## 4. 还没完成 / 需要你拍板或协助（详细）

### 4.1 P0-5 自托管凭证（方案已定，代码未实现）

你在第 54 轮已定：丢了凭证永久取不回；伪 PIN 绑定设备+系统账号+随机硬件；每次打开要 PIN；锁屏即锁；60 天不登录过期；助记词唯一恢复；跨设备同凭证可解。
**但 `docs/P0-5-ZITUOGUAN.md` §7 还有 5 个开工前必须定的选择**：

1. 默认强度：只做 DPAPI/safeStorage 自动解锁，还是加 TPM 非导出密钥 + 可选 PIN？
2. “锁屏即锁”要不要？要的话解锁必须重新输入凭证/唤醒，与“永远零输入”冲突。
3. 恢复材料要不要导出：age 备份包 / 助记词式编码 / SLIP-39 分片 / 全不要（全不要=凭证丢即永久丢）？
4. 跨设备：同凭证直接解（简单，但秘密在多台机器可解），还是设备间再封装 + 设备清单（可撤销，复杂）？
5. 要不要“账号+服务器”那条线？要“忘了凭证也能自动解锁”就必须有服务端材料，会推翻“没有服务器”。

> 这 5 条不定，无法安全开工。文档：`docs/P0-5-ZITUOGUAN.md`。

### 4.2 知识库三层统一 + 第四列三个授权勾选 + 用户切换

现状：`kbLayersFor` 仍是旧矩阵（群聊=会话；项目=会话+内部；我的牛马三层仅 `privateKb` 时）；没有第四列三个授权勾选；没有知识库用户切换/HNS 标识/跨用户在线请求。
**需要你确认默认值**（第 64 轮 §4 原话）：
- 是否就按“群聊=会话；项目=会话+内部；联系人=会话；我的牛马=三层”？
- 用户切换是否只允许**在线用户**？
- 第四列三个勾选默认勾/不勾？

### 4.3 网络 B/A（会话路由 / 在线 / 安全流式 / 邀请 / 扩网）

已完成：`hui-hua-lu-you.ts` 纯逻辑（5 条缓存、竞速、失败剔除、只读）过 6/0；在线状态检测已有；Ed25519+X25519+AES-GCM 安全会话已有。
未完成：
- **路由没有接进主进程发送路径**（`zhenZhengFaSongBen` 仍走旧单服务商/直连）；
- 聊天流式没有走网络安全会话；
- A/B 双发没有 msgId 去重；
- relay 隧道未启用、DHT 未接、跨天自动重连未做、在线文件传输未做；
- 附加内容 24h 频控在渲染层有提示，网络层没有执行点。
**需要你/环境**：
- 网络默认值与“附加内容默认开/关”的决定；
- **第二台机器/第二个网络**才能验证多用户、跨天、A/B 去重、扩网跳数；单机无法伪造这条证据。
最坏情况：只接一半会出现“消息发到坏服务商、界面却显示已送达”。

### 4.4 稳定邀请名片 / 加入 / 成员权限 / 项目群设置 / 右键分类

现状：
- 名片有 provider 多选、二维码、链接，但链接只含 `node/tok/fp/prov`，**没有 did/boxPub 签名** ⇒ 换网后双方未必能再相遇；
- 第 69 轮已有“左加入/右创建”一体化窗口；
- 角色有 creator/admin/member，但踢人只保护 creator，**没有管理员/本人权限执法**；
- 项目/群设置弹窗（头像/名称仅管理员、邀请二维码、创建者选服务商、旧邀请失效）未做；
- 99 项右键分类（拖动/折叠）未做。
**需要你**：确认角色矩阵与“哪些操作仅创建者/管理员”，以及是否要单独一轮做设置弹窗与右键分类。最坏情况：普通成员能踢人/改项目名。

### 4.5 翻译 LQA

正文翻译 17,600 条已基本完成（ru 最后一处中文示例本轮已修）。但“每种语言 20 条 LQA”需要**人工/可用 API**；有道 GUI 不可脚本化，模型逐条校对 17,600 条质量与时间不可控。最坏情况：机器翻译有生硬处，但没有自动质量证据。

### 4.6 27B 慢任务真机验证

`verify-round16/17` 本轮用你授权的 `Qwen3.6-35B-A3B-IQ3_M:latest-128K` 跑绿（111s/150s）。**27B 慢模型长文**仍未单独复跑；需要你确认是否允许再花约 1 小时跑 27B。

### 4.7 真实微信扫码 / macOS / Linux

- 微信真实扫码 E2E 需要手机扫码，无法在本机替腾讯灰度作保证；
- macOS/Linux 需要对应平台构建与真机，只能给脚本。

### 4.8 端到端 canary / 覆盖卡真机测试

- canary 检查器在 fast 每遍都跑（`verify-r53-tumin`），但**真实归档链路的端到端 canary** 还没做成 live 档；需要一条“真模型归档 → 检查会话库/群可见层”的专用门禁。
- `write_file` 覆盖卡已有静态门禁，但“真机弹卡 + 推荐项”没有独立断言（本轮 round34 的 7 张覆盖卡反而暴露了模型循环问题，见 §3.2）。

## 5. 首启交付（已完成）

- 应用先关（本轮测试前已关闭）。
- `node dev/gates/r38-firstrun.mjs`：
  - 搬走 **18 项** → `%APPDATA%\@warmy\app-shell\__r40-firstrun-<时间戳>`（含 settings、memory、workspace、knowledge、audit、checkpoints、nengli.json、xin-tiao、scheduled-tasks、ben-di-yuyin 等）；
  - 保护区 `identity/`、`secure/`、`memory-runtime/`、`updates/`、`skills/`、`local-speech/`、既有 `__*` 备份**未动**；
  - 新 `settings.json`：`setupDone=false`、`instances=0`、`privacyConsent=false`；`instances/` 不存在；无 `auth/`、无 `nengli.json`；
  - 应用已重开（不带调试端口），窗口标题「无限牛马」，停在**语言选择页**。
- 回滚：把备份目录里的 18 项原样搬回 `%APPDATA%\@warmy\app-shell`（先关程序，别覆盖新生成的文件；同名的先让路）。

## 6. 文件清单（本轮）

- 产品：`packages/app-shell/src/electron-main.ts`、`preload.cjs`、`renderer/app.js`、`i18n/{zh-CN,zh-TW,en-US,ja,ko,fr,es,pt,ru,eo}.json`
- 脚本：`packages/app-shell/scripts/p0-6-rescan-dryrun.mjs`、修改 `verify-r53-tumin.mjs`、修改 `r38-firstrun.mjs`
- 门禁：新增 `dev/gates/verify-r73-nengli.mjs`、修改 `run-verify-22.mjs`、修改 `verify-r44-shejiao.mjs`
- 文档：本文件、`docs/CHANGELOG.md`

## 7. 决策文档位置（固定提醒）

- P0-6 脱敏体系（B+C，含 D/E/F 对照、最坏情况、优化项）：`docs/P0-6-TUMIN.md`
- P0-5 自托管凭证（5 个待拍板点）：`docs/P0-5-ZITUOGUAN.md`
- 第 63 轮待拍板（write_file 覆盖、白名单、重扫、canary、受众分档、TTL）：`docs/DECISIONS-R63.md`
- 网络默认无服务器/多服务器/凭据/在线心跳：`docs/HANDOFF-R49.md` 与 `docs/HANDOFF-R67.md` §5
- 提示词上限与 10 语言折算：`docs/HANDOFF-R53.md`
- 32K 窗口实测与建议：`docs/HANDOFF-R70.md`
- 助记词界面与真实词码本：`docs/HANDOFF-R71.md`
- 十幕冲锋预览：`docs/HANDOFF-R72.md`
