# Changelog

## 0.2.23 — 2026-10-18

本轮把 35–37 三轮的改动一起发布。要点：

### 产品门禁与内置技能
- 新增三段**产品门禁**（每轮随系统提示注入）：A 用户新增的可复用能力必须落成 skill / 门禁 / 插件并验证；
  B 所有任务先进计划任务（宿主在一轮第 3 次工具调用仍无计划时硬提醒）；C 后台任务制度（≥5 分钟无活可干要先说明再等，禁空转轮询）。
- 新增内置技能 `warmy-self-modify`（播到默认技能目录）：教牛马**改造本机这一份**（按形态判断、风险分层、自证、回滚），
  正文不含仓库地图 / 本机路径 / 密钥。

### 记忆
- 新增「印象」文件 `yonghushuju.md`：在「我的」页与「道」「规矩」并列、可编辑；归档时**确定性**归纳用户的
  喜好 / 习惯 / 长期要求（不调模型 ⇒ 不幻觉），行数与字符双上限防膨胀；带**软门禁**（提取纪律）与
  **硬门禁**（用户否认 ⇒ 归因到具体条目、标记作废、追加一条提取纪律）。

### 语音
- 修「识别出来的字明显是错的」：采集端直接要 **16k 单声道**（关掉降噪/回声消除）、优先 wav 容器、按真实 mime 建 Blob；
  **近静音拒发**并如实提示；新增「话筒自检」（显示采样率/时长/峰值/RMS/模型/文本）与审计 `asr.request/result`。
- 思考档位不再把内部名（`l3`）当 `reasoning_effort` 发给供应商（会导致 400 整轮失败）。

### 聊天与执行过程
- 「执行过程」并入「思考」块，工具操作**按时间**逐行插入（含流式期间），单行浮雕 + 木马图标取强调色；
  展开格式改为 `开始 ·时间` / `操作 ·完整路径` / `状态 ·时间 · 耗时`。
- 心内行：模型名全称（供应商 · 模型）、词元与轮次、悬停气泡合并成同一份内容、二行与首行左对齐。
- 路径超链接：允许内部空格、只对**真实存在**的路径给右键菜单，虚拟/占位路径退回纯文字；点开走「打开编辑」绝不执行。
- 修「查看文件被记成编辑」：`read_file` 说明不再限制工作区内路径，二进制/可执行也回"它是什么"的元信息；会改文件的标签改成「修改」。

### 权限
- 授权按**路径 + 读写类别**记忆（同一路径换工具不再重复询问）；写覆盖读、读不覆盖写。
- 用户拖进来的附件只授权**读取**；要改/写会另开一张「请求**修改**你给它的这个文件」。
- 系统提示里给出**本机真实目录**（工作区/桌面/文档/下载），并明令不许猜 `C:\Users\<名>\Desktop`。

### 社交接入
- 搬到「牛马管理局 → 单只牛马设置」（社交信息上方），配置按牛马存、连接按 `实例::平台` 分开、默认映射到这只牛马自己的会话；
  补齐了一直缺失的 preload 桥（此前那块的按钮点了什么都不会发生）。
- 凭据**落盘加密**（safeStorage，`enc:v1:`）。
- 新增**微信扫码连接**（官方 iLink/ClawBot：`get_bot_qrcode` → 轮询 `get_qrcode_status` → 拿 `bot_token`）。

### 模型能力分类
- `clef` 这类「有 vision、没有 completion」的模型不再被标成「画图」（归「决策」/「识图」）；落盘能力带版本号，
  规则一变旧记录自动失效；不认识的模型标「未知」而不是假装「对话」。

### 界面
- 11 张预设头像重做为抽象人；用户默认头像重做（左右对称、无角落装饰点）；可选列表第 9/10 张按用户指定调整。
- 动态小字：左侧始终预留蹦跶牛马的位置（22px），有后台任务时显形；授权卡「撤销」按钮对齐。
- 语音等图标动效、朗读声波与光环、执行过程不限高无滚动条。

### 工具与运维
- `--warmy-quit`：以参数二次启动即可让正在运行的实例**自己走退出流程**（不再需要 taskkill）。
- 门禁：新增 `verify-round35/36/37-changes`、`verify-round35-ui`、`verify-round35-live-func`；
  `verify-security` 的隐私规则改为**不写死真实路径**（运行期从仓库路径推导），并跳过构建产物目录。

### 验收
- 连续 5 次全绿（3 次本轮变更 + 2 次全项目）：round37 33/0、round36 38/0、round35 79/0、UI 37/0、
  真机功能 20/0、全项目 fast 68 项次无红；i18n 158/0、作用域 9/0、CSS 6/0、安全 28 PASS。

## 0.1.0 — 2026-09-19

### Acceptance / rename residual (2026-09-23)
- Restore platform keywords damaged by pinyin rename: CSS `body`/`input` type selectors, WebSocket `open`, `document.title`, `Event('input')`, `createElement('input')`, `$('shuRu')` element id, HTML `title` attribute.
- Fourth-column panel scrolls (`#mianBanLan overflow-y:auto`); whole page stays `overflow:hidden`.
- Sound checkboxes bind `sWanCheng/sQingQiu/sCuoWu` (not `#s-complete`).
- English copy: `already using the latest version` / `kept on disk` / `open it first`.
- 18 verify gates × 3 clean rounds; installer rebuilt `WArmy-Setup-0.1.0.exe`.
- Acceptance checklist: `docs/ACCEPTANCE-CHECKLIST.md` (five-axis + 18 gates + UAT + artifacts).
- Installed agent skills for acceptance: webapp-testing, browser-testing-with-devtools, code-review-and-quality, test-driven-development.
- dsh: PC 启动时若缺失则后台默认安装到 `userData/dsh-packages`（失败不挡启动，同日不重试）。

### i18n / product naming
- 「我的牛马」localized: ja `マイ社畜たち`, ko `일꾼들`, en/other `My Workhorses` (cattle.family)
- High-visibility nav/chat/me/panel/dashboard strings filled for ja/ko/ru/es/fr/pt/eo
- Default updateFeedUrl → GitHub Releases API

### Docs
- Document memory system as a product feature (JSONL + FTS + vector + recall/retrieve).
- README English primary; Chinese lives in 说明.md; single author signature line.
- README top links to 说明.md（简体中文完整说明请点这里）.
- Signature model corrected to `mimo-X-pro-Preview`.
- Add CONTRIBUTING, mesh dual-machine checklist, multi-language release notes, node-runtime fetch script.
- Add README screenshots under `docs/screenshots/`.
- Add `references/ARCHITECTURE.md` short architecture map.
- Add `packages/app-shell/scripts/verify-docs.mjs` docs compliance checker.
- Installer asset published as `WArmy-Setup-0.1.0.exe` on GitHub Releases; `checksums.txt` lists both local and release names.

### Memory system (product feature completed this line)
- Env rename: `WARMY_MEMORY_DIR` (legacy `CCA_ARMY_MEMORY_DIR` accepted).
- MemoryClient: `recallScoped` / `retrieve(opts)` / `rebuildProjection` / `vectorStatus` / `stats`.
- IPC: `warmy:memory-status` / `warmy:memory-rebuild` / `warmy:memory-retrieve`; scoped recall.
- Settings → About: memory status + rebuild button (10-locale i18n keys `memory.*`).
- Live verify: `verify-memory.mjs` **20/0** (append/recall/retrieve/scope/writer/rebuild/fail-closed).

### Added (product 0.1.0)
- Multi-agent group chat desktop shell (Electron, zero native modules in app logic)
- 10 UI languages: zh-CN, zh-TW, en-US, ja, ko, ru, es, fr, pt, eo
- Project groups with duty orchestration, board commands, tool-call loop
- Container development projects: probe 12 runtimes, start/stop, project state
  (stopped = creator-offline face; host editing refused; history readable)
- Container shell console (in-container only; security contract: local human typed only)
- Environment solidify / rollback with runtime capability table (WSL has no commit)
- Project file ledger + project directory record (project-level, member-visible)
- Windows host-directory ACL lock (optional, reversible)
- Group mesh / identity / membership (local-first protocol constants `WARMY-*`)
- Router queues: persisted, not dropped on pop; UI P2/P3 queue also persisted

### Ports
- Production default **59599**, dev **58588**, test **62666** (user-configurable; bind failure never silent)

### Security / privacy
- Default: no collection/upload of chats and files
- Secrets env vars are scrubbed before container commands
- Wire protocol constants use `WARMY-` prefix

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
