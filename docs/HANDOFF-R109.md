# 第 109 轮交接：执行时序 / 定时导出细化 / 模型链 / 重组语言 / 导入导出

日期：2026-10-28。所有改动只在 `packages/app-shell`、`packages/memory-os`、`dev/gates` 与文档；没有上传任何真实 profile 或凭据。

## 0. 本轮解决的问题（按用户原话）

### 0. 定时导出：次数/间隔由用户输入

- 循环次数改成 `<input type="number" min="0" step="1">`，默认 **0 = 无限次**；悬停说明“0 = 无限循环；只能输入大于等于 0 的整数”。输入时即时收敛为 ≥0 的整数，右侧提示同步变成“0 = 无限次”。
- 间隔改成秒输入 `<input type="number" min="1" step="1">`；右侧实时显示“多少天/小时/分/秒”（例如 86400 → `1天`）。保存时至少 1 秒，最大 365 天。
- 去掉“需要单独凭证（不使用登录主密钥）”。加密包固定使用当前登录主密钥；仓库未解锁时如实跳过并在 10 分钟后重试，不假装成功。
- 导出位置增加 `用户名` + `密码`。密码只写入系统安全存储（`secure/keys.enc.json`，键为 `__export_loc__:<路径>`），`settings.json` 只留 `username` 与 `credentialSet`。
- 网络位置（Windows UNC，`\\server\share[/subdir]`）：导出前用 PowerShell 从 **stdin** 读凭据建立临时 SMB 映射（密码不出现在命令行/进程列表），导出结束撤销本次创建的映射；共享根才用于 `New-SmbMapping`。
- 导出内容增加“更细致的选择”：
  - 具体对话（默认全选；可只选若干；也可一个都不选）；
  - 知识库层（会话 / 内部 / 私密；可一个都不选）；
  - 时间范围（留空 = 不限；只影响聊天记录、知识事件、归档索引）。
- 范围生效时不再整库复制 `memory/` 与 `knowledge/`：
  - 聊天消息通过记忆服务 `export_records` 按会话/时间导出为 `__logical__/chat-messages.jsonl`；
  - 聊天元数据按会话/时间过滤为 `__logical__/chat-meta.json`；
  - 知识库按层/时间过滤为 `__logical__/knowledge-<层>.json`；
  - 归档索引按会话/时间过滤为 `__logical__/archives.jsonl`；
  - 工作区按会话筛选，未选会话的文件不进包。
- 逻辑文件的“mtime”用内容哈希，`skip-unchanged` 对选择性导出也真正有效（不会因为临时文件时间变化而每次重导）。
- 审计：`export.schedule.saved` 带 `scoped`；`export.schedule.run` 带状态/文件数/位置数/错误。

### 1. 引导卡默认位置

保持当前口径：**右下角、稍微上移，引导卡底边对齐聊天输入区中线**，右边距 18px。R106 门禁已经量过 `bottom ≈ 输入区中线`、`右间距 18px`，本轮继续通过。

### 2. 整理模型：先关思考，再去掉，再换链，成功即默认

`wenTeShuMoXing` 统一改成：

1. 对链上每个模型先请求“关闭思考”：
   - Ollama：`think:false`；
   - OpenAI 兼容：`enable_thinking:false` + `reasoning_effort:'none'`（按模型档位表）。
2. 空正文/报错 ⇒ 去掉关闭思考参数再试一次（有些网关不认这些字段）。
3. 仍失败 ⇒ 换链上下一个模型，仍从“关闭思考”开始。
4. 哪个模型成功，调用 `jiangTeShuMoXingTiDaoLianShou` 把它提到该链第一位（同时从 disabled 移除）。审计 `special-model.promoted`。
5. **思考吃光预算的补救腿**：本地 Qwen3-VL 真机实测即使 `think:false` 仍会先吐 3000+ 字 thinking，2048 token 全被吃掉 ⇒ 正文为空。现在 organizer 的前两腿都空但出现过 reasoning 时，用 8192～16384 token 再试同一模型；成功仍按“谁成功谁当默认”。整理入口的基础预算也从 2048 提到 4096。
6. 设置里除对话模型外的链（`fenLei`/`safety`/`translate`/`organizer`/`imageUnd`/`asr`）都走同一套“成功提权”；TTS/画图/视频生成等独立端点仍是单模型，未伪造成功。

### 3. 执行过程：严格按时间混排（本轮最高优先）

**根因（两条真缺陷）**：

1. 流式气泡里 `guoChengLieHtml` 返回的是**带 `.guoChengLie` 外壳的整块 HTML**，却被塞进另一个 `.guoChengLie` 的 `innerHTML` ⇒ 出现嵌套。`guiNaXingDong` 用 `:scope > .zhongJianKa` 找中间回复时只能看到外层，一个都找不到 ⇒ 所有工具都塞进第 0 段、排在整段思考之后。这正是“执行中工具又跑到思考下面”。
2. 旧分配逻辑 `guiShu` 按“较近的上一段回复”分配操作，导致晚发生的工具挂到已经说完话的上一段，视觉上全部堆在思考末尾。

**现在的口径（硬规则）**：

- `guoChengLieHtml` 把 **思考段 / 工具行 / 中间回复** 合成一个事件数组，统一按真实 `ts` 排序（同毫秒：思考 → 中间回复 → 工具），再生成 DOM；不再“先画思考、再往段尾塞工具”。
- 中间回复用 `<details class="zhongJianKa" open><summary>中间回复</summary>…`：单独一个框、默认展开、用户可手动折叠；它把执行过程切成多段。
- 同一用户轮的所有操作归该轮**最后一条回复**（流式时归流式气泡）；不再挂到上一段。
- 用户手动展开/折叠的状态按 `data-key` 记住（`guoChengKai`/`guoChengBi` + `yingYongGuoChengZhuangTai`）：
  - 运行中执行段默认展开；
  - 最终回复出现后自动折叠；
  - 用户手动展开的段在重绘后仍展开；
  - 中间回复始终展开，除非用户自己折叠。
- 流式气泡改为直接替换外层 `.guoChengLie`，不再嵌套；`guiNaXingDong` 每次也重建同一个容器，避免“二次插入”改变时序。
- 操作行点击改为事件委托，时间线用 HTML 重建后仍能点开明细。

### 4. 重组语言

- **默认勾选**：`yuYinChongZu` 默认 true，设置默认也写 true；模型暂时不可用只禁用勾选框、**不再把用户偏好改成 false**。
- **未勾选绝不整理**：`yuYinShouWei` 在真正整理前读**此刻输入框里的勾选值** + 模型可用，两者都满足才调用整理。
- **整段输入框一起整理**：传入 `ru.value`（不是只传最近一句），并附带最近 12 条会话上下文（只用于判断指代/同音字，不整理上下文）。
- **提示词改成最小必要修改**：不删信息、不缩写、不改主题、保留原语气；原文已通顺的句子原样保留；避免“为了书面化改写”。
- **质量硬闸**：整理结果去空白后不足原文 60% ⇒ 拒绝并保留原话（审计 `voice.reorg.rejected`），不让“整理”把内容吃掉。
- **归因（真机实验）**：本地 Qwen3-VL（`huihui_ai/qwen3-vl-abliterated:4b`，Ollama 0.40.5）即使请求 `think:false`，仍分别产生 1128 / 2004 / 3261 字 thinking；2048 token 时正文为空。给同一句口述、同一提示词、8192 token 后得到正常整理结果（2004 字 thinking + 正文），说明**不是提示词/管线把文字丢了，而是我们的预算小于模型实际思考量**。现在是“4096 基础 + 8192/16384 补救腿 + 整链回退”。模型本身不遵守 `think:false` 是厂商侧行为，宿主无法强制；只能靠预算与换链兜底。

### 5. 导入也按类别

- 导入 `.wvault` / `.tar.gz` 前新增“导入哪些数据”弹窗：同一套六类，默认全选，可取消；至少选一类。
- `importVault` 支持 `include`：`huiFuMuLu` 按类别白名单复制；`heBingLuoJi` 只合并所选类别的聊天元数据/知识/归档/消息队列。
- 选择性导出包里的 `__logical__/chat-messages.jsonl` 会落到 `logical-import/`，**重启后记忆服务就绪时逐条 append，保留原 ts**；不会把历史时间改成导入时间。
- 完整包仍按用户勾选的类别覆盖；未勾选类别保持当前数据。
- 导入仍然二次确认，失败回滚逻辑不变（R104/R107 门禁 50/50 仍过）。

### 6. 旧群没有成员指纹

按用户口径，**新版本不再兼容旧版本/旧群**：

- `qunRuXiangJianYan`：成员列表与创建者指纹都为空 ⇒ 返回 `ok:false, reason:'no-member-fingerprint'`，不再 `unverified-legacy` 放行。
- 入站：拒绝并审计 `chat.net-inbound-rejected` + `chat.group-no-fingerprint-blocked`。
- 出站 `warmy:chatNetSend`：群记录既无创建者指纹又无成员指纹 ⇒ 直接返回 `group-identity-unverified`，不发到任何 peer，审计 `direction:'outbound'`。
- 新版本建群会写创建者指纹；邀请/加入写成员证书指纹；所以新版本不受影响。

## 7. 门禁结果

| 门禁 | 结果 |
| --- | --- |
| `verify-r101-changes` | 92/92 |
| `verify-r106-interim-ui` | 23/23 |
| `verify-r106-inbound` | 12/12 |
| `verify-r107-export-schedule` | 27/27 |
| `verify-r104-vault` | 50/50 |
| `verify-r100-stop` | 51/51 |
| `verify-round28-changes` | 45/0 |
| `verify-round35-changes` | 79/0 |
| `verify-round36-changes` | 38/0 |
| `verify-round38-changes` | 57/0 |
| fast 全量 | **122 项次 0 红**（最终构建，`run-verify-22 --tier=fast`） |

## 8. 仍未完成 / 需要外部条件

1. **A 单一加密存储核心（SQLCipher 兼容驱动 + storage-core + 全量迁移）**：尚未开始。需要引入 `better-sqlite3-multiple-ciphers`，把 DB/JSONL/知识库/设置/群/身份/审计/附件/检查点迁到一个加密存储核心；分阶段迁移，不能用半成品冒充完成。
2. **稳定 Kroot / 新设备恢复**：尚未实现。当前仍依赖助记词+账号 salt 派生主密钥；换设备恢复私密库仍受限。
3. **`.nm` v2 全部逻辑适配器**：本轮完成了“选择性导出/导入”的聊天消息/知识/元数据核心，但 `.nm` 的项目文件/检查点/附件适配器与冲突合并 UI 还未全量接入；导入端的“具体时间范围”只对已经按范围导出的选择性包生效，完整包仍会导入全部聊天记录（因为消息在单一 DB 里，导入时逐条按时间过滤需要与 A 同一套逻辑适配器）。
4. **IPC / nm 最小权限、命令沙箱**：未做。需要逐通道审计、把 nm 的能力收窄到“只读渲染 + 显式授权动作”，并给外部命令独立沙箱。
5. **更新包签名**：需要证书（SignPath Foundation / Certum OSS / Azure Artifact Signing）或自建信任链；无证书只能做哈希校验，不能防篡改安装器。
6. **身份轮换 / API key 迁移**：未做。涉及旧凭证失效、群成员证书重签、供应商密钥迁移的原子性。
7. **真实 4K / 多显示器 / 真实 IM 账号 / 第二台设备**：需要用户提供设备或账号才能验收。
8. **TTS / 画图 / 视频生成链的整链回退**：这些是独立端点；本轮给 TTS 成功加了“提为默认”，但失败时仍不会自动换链上下一个；文本类/ASR/看图链已做完整回退+提权。

## 9. 首启

按用户要求删除配置并交付首启。真实 profile 先做可恢复备份，再启动到语言选择页：

- 备份：`<用户目录>\AppData\Roaming\@warmy\app-shell.backup-20261028-213624-r109`（只在本机保留，不上传）
- 首启截图：`<临时目录>\warmy-r109-firstrun.png`
- 当前应用已重启为**无调试端口**的普通实例，停在首启语言选择页，等待用户验收。
