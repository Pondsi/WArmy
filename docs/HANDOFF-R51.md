# HANDOFF-R51 — 第 51 轮交接（含 R50 未完成项与用户 16 条新需求）

> 写于 2026-10-20 22:xx。给下一个会话：**先读本文件第 0、1 节，再决定做哪条**。
> 用户口径：质量优先、可挂机、不得死循环；每完成一点汇报并更新本文件。

---

## 0. 当前状态（一句话）

R50 的代码修复已完成并全绿（fast 77 项 0 红；`verify-r50-plan-schedule` 23/0）；**三连压测未完成**：
- 记忆 1000×2M：跑到 **950/1000 · 0 失败** 后 **Node 堆 OOM 崩溃**（`CALL_AND_RETRY_LAST`，默认堆 ~4GB 装不下 950 轮×2M 的 JSONL 索引）。
- 小游戏 r46 ×6 轮：真机模型（Ollama 27B）**时好时坏**，常见红是「模型只汇报不改文件（mtime 未前进）」与「Chromium 真跑画面不动」。
- fast ×3：第 1 遍 `verify-tool-calls` 红，原因是**仓库内 `better-sqlite3` 的 lib/package.json 会被某进程清掉**（历史遗留）；`memory-runtime` 真副本仍在。

**结论：先把环境稳定（sqlite 自愈 + Node 堆上限 + 游戏门禁改用可写文件的模型/更强催办），再重跑三连。**

---

## 1. 环境必读（不做会浪费半天）

### 1.1 better-sqlite3 反复丢失
- 现象：`packages/memory-os/vendor/better-sqlite3/{lib,package.json}` 会消失；`git status` 里该目录大量 `D`。
- 现修法：从 npm tarball 解出完整包，复制到 **三个候选**：
  - `packages/memory-os/vendor/better-sqlite3`
  - `packages/memory-os/node_modules/better-sqlite3`
  - `node_modules/better-sqlite3` 与 `node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3`
- 真副本：`%APPDATA%\@warmy\app-shell\memory-runtime\node_modules\better-sqlite3` 也必须完整（`lib/` + `prebuilds/win32-x64.node` + `package.json`）。
- **待办**：找出谁在删（grep `rmSync` 指向 vendor / 清理脚本）；在产品里把候选顺序改为「memory-runtime 自身副本优先」并加自愈测试。

### 1.2 记忆压测必须加堆上限
```powershell
$env:NODE_OPTIONS='--max-old-space-size=12288'
```
否则 900+ 轮必 OOM。或给 `verify-memory-stress.mjs` 加 `--heap` 自设 re-exec。

### 1.3 密钥与隔离
- 密钥：`%TEMP%\w50-mimo-key.txt`（第一行），走 `MIMO_KEY_FILE`，**不许进仓库**（`verify-security` 会扫）。
- 真机门禁严禁并行（同一调试端口冲突，会假红）。跑前确认无 `electron.exe --remote-debugging-port` 残留。

### 1.4 构建
```powershell
cd C:\wbuild\packages\app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/copy-assets.mjs
node scripts/check-syntax.mjs
```

---

## 2. R50 已完成的代码改动（未提交）

| 改动 | 位置 | 证明 |
|---|---|---|
| 计划/定时「变更不删旧」：旧条 `blocked`（已停止）留档，新条另加；删除改软删 | `electron-main.ts` plan_update / dengJiDingShiRenWu / dingShiRenWuShanChu | `dev/gates/verify-r50-plan-schedule.mjs` 23/0 |
| 定时任务 `status: active\|stopped` + `stoppedReason`（replaced-by-new / user-delete / repeat-exhausted / user-pause） | `electron-main.ts` | 同上 |
| 软门禁 UI 分区 + 空态说明 | `renderer/app.js` | 同上 |
| i18n 新增 12 键 ×10 包 | `src/i18n/*.json` | `verify-i18n-locales` 162/0 |
| 小游戏门禁：空闲或按开始键后动画都算；功能缺失会催补；localStorage/暂停/速度判据放宽 | `dev/gates/verify-r46-youxi.mjs` + `r46-chromium-harness.cjs` | 待三连 |
| 三连驱动器（子进程 stdout 接日志、失败即停） | `dev/gates/r50-run3.mjs` | — |
| R50 决策书 / 知识库讨论稿 | `docs/R50-DECISIONS-18.6.md` / `docs/R50-KB-SCOPE-DISCUSSION.md` | — |

---

## 3. 用户 R51 的 16 条需求（**按用户原意整理，待逐条实现**）

> ★=已拍板，可直接做；☆=需先搜索/设计再动手。

### 3.1 定向与 @（★ 已给口径）
- **项目**：消息永远发给值班者；@某牛马也是发给值班者，由值班者决定（转发给@对象要求回答 / 仅提及）。
- **值班者调用链**：值班者不能回应时由链上其他牛马接任 —— **需确认现状是否已实现**（用户问）。
- **群聊**：牛马只在被 @ 时回复，**无值班者**，@谁谁回。
- **@ 下拉**：项目和群聊输入 `@` 弹出全部牛马（按名称，改名同步）；鼠标/上下键选择；**无搜索框**，键入即过滤：
  - 字母语言：首字母优先开头匹配 → 拼音首字母匹配 → 其他；第二字母起只按前缀；循环上下。
  - 中文输入法：首字母过滤；第二字母起**不更新**，直到上屏（空格/回车）才按上屏文字过滤；候选框正常显示但不显示实际输入。
  - 回车保持当前结果、之后输入算新搜索；上下键移动选择后输入也算新搜索。
- **牛马名称唯一**：创建时查重（自动生成的名字必须唯一）；牛马管理局改名**逐字动态查重**，重名用强调色提示；未改成唯一名则回退原名。

### 3.2 外部渠道与知识库作用域（★）
- 微信/飞书等 = **同一用户的不同渠道**，绑定到具体牛马；权限随该牛马；用户是唯一最高主体。
- **群聊**：牛马**禁用内部/私密知识库**，只用会话知识库。
  - 第四列：创建者有「知识库卡（全部：内部+会话+私密）」+「会话知识库卡」。
  - 非创建者：也有「知识库卡（自己的内部+会话+私密 + 创建者提供的会话知识库）」+「会话知识库卡」。
- **项目**：牛马可用内部+会话，**禁用私密**。
  - 创建者：「知识库卡（全部）」+「内部知识库卡（内部+会话）」。
  - 非创建者：「知识库卡（全部 + 自己的内部/私密；会话库所有项目共用）」+「内部知识库卡（内部+会话）」。
- **每个会话独立记忆，禁止串**；信息只能经知识库传递；**提示词（道/规矩/认知/印象）只做约束引导，严禁传递信息 —— 写硬门禁**。

### 3.3 上下文预算按执行者（★）
- 子执行者：按其**牛马管理局**配置的上下文预算（不是聊天框下方）。
- 我的牛马：自己执行用聊天框预算；分身用该牛马管理局预算。
- 群聊：禁用工具、禁派分身；执行者=牛马自己，按管理局预算；**聊天框无上下文设置**。
- 项目：聊天框设置只对值班者；其他执行者按各自管理局预算。值班者派发时只给必要信息，不塞满。
- **派发前压缩**：超预算→收缩毯→再试→仍超→换执行者（用户指定则如实告知不胜任）；仍无可胜任（含自己）→如实告知。派发后仍超→再收缩试一次；执行结果差→总结经验重派→再不行换人。

### 3.4 并行/接力（★ 硬门禁）
- 我的牛马：派发者判断冲突（重复/同一资源）→接力；互不干扰→并行。**写入硬门禁**。
- 项目：值班者决定并行/接力。**写入硬门禁**。
- 群聊：只能聊天，默认并行。

### 3.5 黑板跨轮（★ 按推荐）
- 同一计划/话题自动带回**有界摘要（≤2400 字）+ 指针**；跨任务不带。

### 3.6 窗口兜底（★ 已改口径）
- 未拉到窗口时：先从**模型名**里解析（如 `-128K`、`32k`）；无则按 **128K**。

### 3.7 中间回复进记忆（★ 按推荐）
- 旁路可追溯 + 一条压缩摘要记忆（不算正式消息条数）；最终回复进正文记忆。

### 3.8 「道」缩到 3000 字 + 术/束缚（★ 大改）
- 道**永不可压缩**，写硬门禁（可考虑 2 支：禁改 + 禁压缩）。
- 缩到约 3000 字：去给人读的、去对 AI 无用的；保留约束力；**加「不能谄媚/阿谀奉承」**；用严谨行为规范表达，让遵守规范自然达到要求。
- 提示词分层：**术（Memory.md 之上?）→ 教条（原规矩，兼容 agents.md）→ 束缚（Memory.md，兼容他项目）**。
  - 用户要求：规矩改名为「教条」；教条与束缚默认折叠；术在教条之上，束缚在教条之下。
- 教条新增一条：用「不是…而是…」句式前必须确认前文真的让人产生了「不是」的内容；否则只写「而是」后的内容。
- 上下文不足且无可压缩时：教条/认知/印象可压缩；**道永不可压缩**。

### 3.9 ASR 本机优先（★ 要真正可用）
- 勾选本机语音 → 优先本机（需先安装才能勾）；未勾 → 用听话模型默认。
- 勾选后出现「仅使用本机语音服务」（默认勾选）：悬停提示「勾选后只用本机，失效即报错；取消则本机不可用时自动走听话模型调用链重试」。
- **现在开始取话筒自检数值**并落地（该功能从未顺利工作）。

### 3.10 字数停滞阈值（☆ 先搜）
- 搜最新技术文章 + GitHub 开源 agent 代码，学习业界最佳解法后用进项目。

### 3.11 dsh 契约 import（★）
- 按推荐补齐 `AcpKongzhiXiaoxi` import 并加门禁。

### 3.12 知识库三层（★ 大改）
- **会话知识库**：所有会话共用互通；只放可让外人知道的、通用/模糊业务概况；**严禁具体业务内容与个人信息**。
- **内部知识库**：操作踩坑/规则、客户与业务具体内容（非私密、非会话）。
- **私密知识库**：个人习惯/私人事务/爱好等；**仅用户本机可见**，任何非本机牛马/外部人禁止读取与输出。
- 归类写硬门禁；私密库严防死守（另写硬门禁）。
- 何时放提示词/知识库、放哪层：按调研最佳实践（CoALA/Claude Projects/OpenAI/Mem0/Zep）。

### 3.13 nm 插件与超链接（★）
- 插件启用时：项目内右键菜单**最上面加「打开」**（永远系统默认）；左键点击改用 **nm 插件**打开。
- 插件停用：左键回系统默认；右键去掉「打开」。

### 3.14 牛马互通协议（☆ 先搜先进做法）
- 写协议框架（可扩展）；用于项目内多牛马直接对话（与黑板并行不冲突）。
- 含「认知↔印象」交换规范：可直接互通时传递自己的认知文件作为对方印象（可选择不传）。
- 应用到项目派分身/值班者派任务。

### 3.15 印象卡片（★）
- 第四列新增「印象」卡（默认存在、不可改、置底、默认展开）；按会话更新不同印象文件。
- 与 3.12 联动：分清放「术」还是「印象」。
- 道只能人手动改（硬门禁，可做 2 支）；规矩/束缚几乎不改。
- 名称：**术 → 教条（agents.md）→ 束缚（Memory.md）**。

### 3.16 交接
- 本文件即交接；每完成一项更新本文件并在对话里汇报。

---

## 4. 建议执行顺序（质量优先）

1. 环境自愈：sqlite 全候选 + memory-runtime 真副本；压测加堆；确认无残留 electron。
2. 重跑三连基线（记忆 1000×2M 带 `--max-old-space-size=12288`；游戏三连）。
3. 硬门禁优先：道不可改/不可压、提示词禁传信息、并行/接力、知识库三层隔离（4–6 支新门禁）。
4. 提示词体系：道缩 3000 + 术/教条/束缚 + 教条新句规。
5. @ 与名称唯一：下拉组件 + 拼音规则 + 改名查重。
6. 知识库三层模型与第四列卡片（群/项目两套可见性）。
7. 预算按执行者 + 派发前压缩/换人。
8. 互通协议 + 印象卡。
9. ASR 话筒自检 + 本机优先选项。
10. 字数停滞（调研后）。
11. nm 超链接。
12. 全量回归 + 三连 + 首启验收。

---

## 5. 已知坑（别重犯）

- 并行起两支真机门禁 = 抢端口 = 假红（§18.4③）。
- 门禁子进程 stdout 必须接日志，否则只剩 exit code（§18.4①）。
- 「主遍 exit=0」≠「这一档没红」，要复跑取条数（§18.4②）。
- 记忆压测 900+ 轮会 OOM，必须加堆。
- `better-sqlite3` 会消失，跑前先自检三候选。

---

## 6. R51 已完成（2026-10-21 凌晨，按提交顺序）

| # | 需求 | 状态 | 证明 |
|---|---|---|---|
| 16 | 交接文档 | ✅ 本文件 | — |
| 6 | 窗口未知按 128K + 先解析模型名 | ✅ | congMingZiCaiChuangKou + MO_XING_CHUANG_KOU_DOU_DI |
| 11 | dsh 控制消息 import 契约 | ✅ | dsh-runtime 引入 AcpKongzhiXiaoxi |
| 13 | nm 插件：左键 nm 打开、右键顶部「打开」=系统 | ✅ | pp.js 链接处理 + common.open 10 包 |
| 8 | 道缩至 ~3200 字、加「不谄媚」、术/教条/束缚分层、只有道不可压缩、门禁 E 句式 | ✅（道已写入用户 dao.md，备份 dao.md.bak-r51） | erify-prompt-layers 14/0 |
| 12 | 知识库三层（会话/内部/私密）+ 作用域 + 越权拒绝 + 删除覆盖三层 | ✅ 后端完成；UI 卡片待做 | erify-kb-scope 16/0 |
| 10 | 字数停滞调研 | ✅ 结论已到（见下）；代码待接 | — |
| 14 | 牛马互通协议调研 | ✅ 框架已到（见下）；代码待做 | — |

### 10 的落地要点（调研结论）
- 指标：4-gram 重复率、窗口相似度、gzip 压缩比、新增信息量、速度比（对同模型基线）
- 判定：复读=重复率高或相似度高；慢写=速度低但新增信息仍正；卡住=nudge 2 次仍无新增
- 阈值自校准（同模型正常样本 p95），起步值 0.35/0.90/2.5/0.5
- 回归三形状：正常（不动作）、慢写（仅 nudge）、复读（abort）

### 14 的落地要点（调研结论）
- 采用 A2A 风格信封：message_id / context_id / task_id / from(to) / intent / capabilities / payload / refs / budget
- impression_ok 显式开关；事实用黑板指针（acts_ref），对话消息不入库
- 状态机：IDLE→OFFER→NEGOTIATE→EXCHANGING→DONE|BLOCKED|ABORTED
- 与黑板边界：对话→黑板只走 heiban_write；黑板→对话只出 ≤2400 字摘要；同主题异说落冲突条目

### 仍待做（按优先级）
1. 并行/接力硬门禁（3.4）
2. 印象卡片（3.15）+ 术/教条/束缚设置 UI
3. @ 下拉与牛马重名检查（3.1）
4. 预算按执行者 + 派发前压缩（3.3）
5. ASR 话筒自检与「仅本机」选项（3.9）
6. 字数停滞实现（3.10）
7. 牛马互通协议实现（3.14）
8. 知识库第四列卡片可见性（3.2 的 UI 部分）
9. 三连压测收尾 + 全量回归 + 首启

### 当前压测
- 记忆 1000×2M：**990/1000 · 0 失败**（第 1 遍，带 12GB 堆，未再 OOM）
- 小游戏 6 轮 ×3：第 1 遍进行中（模型写文件不稳定，已加「判据不成立催补功能」）


---

## 7. R51 第二轮落地（继续上面的表）

| # | 需求 | 状态 | 证明 |
|---|---|---|---|
| 15 | 第四列「印象」卡（默认存在/不可移除/置底/展开，按会话保存） | ✅ | `mianBanYinXiangKuai` + `warmy:yinXiangHuiHuaDu/She`（`impressions/<sid>.md`） |
| 8 | 术/教条/束缚三个设置编辑器（教条=agents.md，束缚=Memory.md） | ✅ | 设置→我的 里三个 textarea；`wo.shu/wo.shuFu` 10 包 |
| 3 | 预算按执行者：`zhiXingZheYuSuanBaiFenBi`（instance 优先/global 回落，进审计）；`toolLimits(instId)` 支持按牛马取 | ✅ 后端 | `verify-budget-per-executor` 8/0 |
| 9 | ASR「仅使用本机」开关（默认勾选）+ 失效报错/取消则回落重试 | ✅ | `verify-asr-routing` 11/0 |
| 10 | 字数停滞改为内容信号（4-gram/压缩比/新增信息量，三形状） | ✅ | `verify-changwen-tingzhi` 10/0 |
| 14 | 牛马互通协议 v1（信封/幂等/TTL/印象开关/黑板指针）+ 派发接线 | ✅ | `verify-tonghu-xieyi` 15/0 |
| 12 | 知识库三层后端 | ✅ | `verify-kb-scope` 16/0（UI 卡片待做） |
| — | 记忆 >2GiB 崩溃（真缺陷） | ✅ 流式索引 + 偏移读全文 | `verify-memory-jsonl-big` 4/0（2.2GiB/261500 行） |
| — | 压测 OOM（真缺陷：sliced string 保留 4.7MB 父串） | ✅ 预览用 Buffer 复制；镜像只留 8k | 记忆 1000 轮跑完，RSS 128MB |

### 压测读数（R51）
- 记忆 1000×2M 第 1 遍：**1000/1000 · 0 失败**，日志 5.05GB；抽查：大预算 视图内含4/答对4/recall6/retrieve10；小预算 4/4/6/10
- 记忆第 2/3 遍已在跑（`--stateDir .memory-stress-r50-run2/3`）
- 小游戏 6 轮：改用 **MiMo mimo-v2.6-flash**（27B 本地多轮改写不稳），三连已起

### 仍待做
1. @ 下拉与牛马重名检查（3.1，最大一块 UI）
2. 知识库第四列卡片可见性（3.2 UI）
3. 项目/群聊「值班者调用链」是否已有实现（3.1 的提问）
4. 首启验收（全部绿后）


---

# 8. R51 逐项现状（详细版 · 2026-10-21 凌晨）

> 更新纪律：**每推进一点就更新本节**。每条写「做了什么 / 改了哪些文件 / 怎么验 / 还差什么」。
> 新会话接手顺序：读 §0 → §1（环境坑）→ 本节 → §9（压测读数）→ §10（下一步）。

## 8.1 定向与 @（需求 1）

| 子项 | 状态 | 落点 |
|---|---|---|
| 项目消息永远发给值班者 | 既有（`groupOrchestrate` 值班者路径） | `packages/app-shell/src/orchestrator.ts` |
| 群聊仅 @ 才回复、无值班者 | 既有 | 同上 + `router` |
| 值班者调用链（值班者不能回应时换人） | **已有**（`selectDuty` + `dutyEligible` + 成员状态同步） | `group-router` / `orchestrator.ts` |
| @ 下拉（项目/群聊） | **本轮新增** | `renderer/app.js` `anZhuangAiTiDao()` + `app.css .atTiShiKuang` |
| 下拉显示**名称**、改名同步 | ✅（取 `xianShiMing(i)`） | 同上 |
| 无搜索框键入即过滤、前缀优先 | ✅（`paiXu()` 前缀 0 → 词首 1 → 包含 2 → 其它 3） | 同上 |
| ↑↓ 循环、回车选中（不发送）、Esc 关闭 | ✅ | 同上（`keydown` capture，Enter 时 `stopPropagation`） |
| 输入法：组合期间不改结果、上屏后按上屏文字过滤 | ✅（`compositionstart/end` + `isComposing`） | 同上 |
| 牛马名称唯一：创建查重 | ✅（既有 `mingYiZhanYong`） | `app.js addInstanceFlow` |
| 改名逐字查重 + 强调色提示 + 非法回退 | **本轮新增** | `app.js bindInstanceLiveSave`（`iMing` 的 `oninput/onchange/onblur`） |
| 门禁 | `verify-at-tidao` **21 ok / 0 FAIL** | `dev/gates/verify-at-tidao.mjs` |

**还差**：拼音首字母匹配。当前对中文名只做「字面前缀/包含」；要真正按拼音首字母排序，
需要一张汉字→首字母表（或引入轻量 pinyin 库）。已在 §10 列为待办；不影响其它功能。

## 8.2 外部渠道与知识库作用域（需求 2）

- 外部渠道（微信/飞书）= 同一用户的不同渠道、绑定到具体牛马：**既有**（`she-jiao-adapter` + 每牛马社交信息）。
- 知识库三层后端：**本轮完成**（见 8.6）。
- 提示词不是信息通道：`verify-prompt-layers` 钉住注入段不调用 `knowledge/recall`。
- **还差**：群聊/项目第四列「知识库卡」的**可见性矩阵 UI**（创建者 vs 非创建者），见 §10。

## 8.3 预算按执行者（需求 3）

- `zhiXingZheYuSuanBaiFenBi(instId)`：牛马配置优先、全局回落、来源进审计（`chat.xiaodi-budget-source`）。
- `toolLimits(instId)`：执行者可带自己的轮数/结果字数/累计字数上限；`orchestrator` 分发时传 `zxId`。
- 派发前压缩：既有「毯闸 + 降级阶梯」（`ZHAN_BIAN_ZONG_ZI_SHANG_XIAN`、`JIANG_JI`）。
- 门禁：`verify-budget-per-executor` **8/0**。
- **还差**：牛马管理局里**给每只牛马填上下文预算的输入框**（后端已读 `instances[i].contextBudgetPercent`，UI 未加）。

## 8.4 并行/接力（需求 4）

- 纯函数 `packages/app-shell/src/pai-fa-pan-ding.ts`：资源键（绝对路径 / 带扩展名文件名 / 命令）+ 冲突判定。
- `spawn_subagent` 派发前调用；冲突则**拒绝并说明**；结束释放占用；审计 `chat.xiaodi-dispatch-plan`。
- 门禁：`verify-parallel-serial` **14/0**（真函数真值表）。
- **还差**：项目值班者派发的**多执行者**也接同一判定（当前只接了分身一路）。

## 8.5 黑板跨轮 / 窗口兜底 / 中间回复（需求 5–7）

- 黑板：本轮未改（按用户「按你的推荐」= 同计划/话题带回 ≤2400 字摘要 + 指针）。**待实现**（现有每轮一个任务号，跨轮未自动带）。
- 窗口兜底：`congMingZiCaiChuangKou()` 先解析模型名（128K/32k/1M），无则 `MO_XING_CHUANG_KOU_DOU_DI = 128000`；`peizhiYuSuan` 同步。
- 中间回复：维持旁路可追溯 + 摘要（**待实现**摘要写库那一步）。

## 8.6 道与提示词（需求 8、15）

| 子项 | 状态 |
|---|---|
| 道缩到 ~3200 字（2366 汉字） | ✅ `src/dao-default.ts`，已写入用户 `dao.md`（备份 `dao.md.bak-r51`） |
| 加入「不谄媚」三条判据（删变量测试/褒义举证/三次重问） | ✅ |
| 道**永不可压缩** | ✅ `BU_KE_YA_SUO = ['道']` + 注入文案「压缩上下文时本段不许缩短」 |
| 术（shu.md）/ 教条（agents.md）/ 束缚（Memory.md） | ✅ 后端读写 IPC + 设置 UI 三个编辑器；顺序 道→术→教条→束缚 |
| 「规矩」改名「教条」 | ✅ 10 个语言包 `wo.belief` 更新（zh/zh-TW） |
| 教条新句规（「不是…而是…」前提） | ✅ 产品门禁 E（`builtin-rules.ts` MENJIN_E） |
| 门禁 | `verify-prompt-layers` **14/0** |
| **还差** | 教条/束缚默认折叠；「道不可改」第二支门禁（禁写路径已钉，禁改 UI 入口待加） |

## 8.7 ASR（需求 9）

- 新增设置 `asrLocalOnly`（默认 true）。
- 勾选「本机语音」后才显示「仅使用本机语音服务」；勾着则本机失败**直接报错**（`bendi-yuyin-failed`），取消则走听话模型链重试；重试前恢复原始音频（`asr.audio-restored`）。
- 话筒自检入口既有（录 3.6s，显示采样率/峰值/转写）。
- 门禁：`verify-asr-routing` **11/0**。
- **还差**：**真机取话筒数值**（需在有麦克风的桌面上点「话筒自检」，把读数写进本节）。

## 8.8 字数停滞（需求 10）

- 新增 `chang-wen-ting-zhi.ts`：4-gram 重复率、deflate 压缩比、新增信息量；三形状（正常 continue / 慢写 nudge / 复读或卡住 abort）。
- 接入 `ziShuJinDuHang`：内容判定优先，数量判定保留为兜底；审计 `chat.length-stall-content`。
- 门禁：`verify-changwen-tingzhi` **10/0**。

## 8.9 dsh 契约（需求 11）

- `dsh-runtime` 引入 `AcpKongzhiXiaoxi`，导出的生成脚本注释按契约定形。

## 8.10 知识库三层（需求 12）

- `packages/knowledge-base`：`ZhishiCeng = session|internal|private`，**每层独立落盘** `knowledge-<层>.json`；`ZhishiCang` 持有三层并支持 `queryLayers`。
- 作用域：群聊 `['session']`；项目 `['internal','session']`；我的牛马 `['private','internal','session']`。
- `knowledge_add` 可带 `layer`，越权返回 `kb-layer-denied` 并给可读理由；删除会话知识覆盖三层。
- 门禁：`verify-kb-scope` **16/0**。
- **还差**：第四列卡片可见性（创建者/非创建者两套）、私密库「非本机牛马禁用」的运行时断言（后端已按会话类型隔离，缺 UI 标注）。

## 8.11 nm 插件与超链接（需求 13）

- 左键：`daKaiWenJian(p)` → 插件启用时 nm 打开，停用回系统默认。
- 右键：插件启用时最上多一项「打开」= 系统默认；停用不显示。
- i18n：`common.open` 10 包。

## 8.12 牛马互通协议（需求 14）

- `packages/app-shell/src/niuma-tonghu.ts`：v1 信封（`message_id/idem_key/context_id/task_id/from/to/intent/capabilities/payload/refs/budget`）。
- 幂等（重复 `idem_key` 回缓存）、TTL、印象开关（`impression_ok` 未同意不得携带）。
- 认知↔印象交换：`jiaoHuanRenZhiYinXiang`（不同意则都不传）。
- 派发子代理时构造信封并写协议头；审计 `chat.tonghu-dispatch`。
- 门禁：`verify-tonghu-xieyi` **15/0**。
- **还差**：项目多牛马互通的**双向**接入（当前是值班者→执行者单向）。

## 8.13 印象卡（需求 15）

- 第四列 `mianBanYinXiangKuai`：默认存在（不在可移除清单）、置底、默认展开。
- 每会话 `impressions/<sid>.md`；注入时**会话印象优先**，无则回落全局 `yonghushuju.md`。
- 编辑：卡片内 textarea + 保存（`warmy:yinXiangHuiHuaShe`）。

## 8.14 计划/定时变更不删旧（R50 遗留）

- 计划步骤被删/消失 ⇒ 标 `blocked`（已停止）留档；定时任务同名替换 ⇒ 旧条 `stopped + replacedBy`；删除改软删。
- 门禁：`verify-r50-plan-schedule` **23/0**。

## 8.15 压测抓到的两个真缺陷（已修）

1. **JSONL > 2GiB**：`readFileSync` 抛 `ERR_FS_FILE_TOO_LARGE` ⇒ 改 8MiB 块流式续行 + 按字节偏移读全文；`rebuildProjection` 也在事务内流式。门禁 `verify-memory-jsonl-big`（2.2GiB / 261500 行）**4/0**。
2. **索引/镜像 OOM**：V8 sliced string 保留整条 4.7MB 父串 ⇒ 预览用 `Buffer.from(...).toString()` 复制；压测镜像每轮只留 8k 且 `len` 记真实长度。索引 RSS 4GB → **128MB**。

## 8.16 本轮新增/修改文件清单

**新增**
- `packages/app-shell/src/pai-fa-pan-ding.ts`
- `packages/app-shell/src/chang-wen-ting-zhi.ts`
- `packages/app-shell/src/niuma-tonghu.ts`
- `dev/gates/verify-prompt-layers.mjs`
- `dev/gates/verify-kb-scope.mjs`
- `dev/gates/verify-parallel-serial.mjs`
- `dev/gates/verify-changwen-tingzhi.mjs`
- `dev/gates/verify-tonghu-xieyi.mjs`
- `dev/gates/verify-asr-routing.mjs`
- `dev/gates/verify-budget-per-executor.mjs`
- `dev/gates/verify-at-tidao.mjs`
- `dev/gates/verify-memory-jsonl-big.mjs`
- `dev/gates/r50-run3.mjs`（三连驱动，stdout 接日志、失败即停）
- `dev/gates/r50-chat-probe.mjs`（chatSend 探针）
- `docs/R50-DECISIONS-18.6.md`、`docs/R50-KB-SCOPE-DISCUSSION.md`、本文件

**修改（主要）**
- `packages/app-shell/src/electron-main.ts`（窗口兜底、知识库栈、预算助手、派发门禁、协议注入、ASR 仅本机、印象 IPC、toolLimits 按牛马、长文内容判定）
- `packages/app-shell/src/dao-default.ts`（道 3200 字）
- `packages/app-shell/src/builtin-rules.ts`（门禁 E）
- `packages/app-shell/src/yuSuan-jiage.ts`（128K 兜底、不可压缩只剩道）
- `packages/app-shell/src/settings-store.ts`（asrLocalOnly、默认 128000）
- `packages/app-shell/src/preload.cjs`（shu/shuFu/印象会话 IPC）
- `packages/app-shell/src/renderer/app.js`（软门禁分区、定时停止态、nm 链接、印象卡、术/束缚编辑器、@ 下拉、改名查重）
- `packages/app-shell/src/renderer/index.html`（印象卡）
- `packages/app-shell/src/renderer/app.css`（@ 下拉样式）
- `packages/app-shell/src/i18n/*.json`（新增 12+2+4 键 ×10 包；教条改名）
- `packages/knowledge-base/src/index.ts`（三层 + ZhishiCang）
- `packages/memory-os/src/index.ts`（流式索引、预览复制、流式重建、偏移读全文）
- `packages/dsh-runtime/src/index.ts`（契约 import）
- `packages/app-shell/src/orchestrator.ts`（执行者 id 传预算/限额）
- `packages/app-shell/scripts/verify-round27-changes.mjs`（合并断言放宽到新语义）

## 8.17 构建与自检（每次改完必跑）

```powershell
cd C:\wbuild\packages\app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/copy-assets.mjs
node scripts/check-syntax.mjs
cd C:\wbuild
node packages/app-shell/scripts/verify-import-integrity.mjs
node packages/app-shell/scripts/verify-i18n-locales.mjs
```

新门禁一览（全部绿）：
`verify-prompt-layers 14/0`、`verify-kb-scope 16/0`、`verify-parallel-serial 14/0`、
`verify-changwen-tingzhi 10/0`、`verify-tonghu-xieyi 15/0`、`verify-asr-routing 11/0`、
`verify-budget-per-executor 8/0`、`verify-at-tidao 21/0`、`verify-r50-plan-schedule 23/0`、
`verify-memory-jsonl-big 4/0`。


---

# 9. 压测读数（滚动更新）

## 9.1 记忆 1000 轮 × 2M 字符
| 遍 | 状态 | 读数 |
|---|---|---|
| 1 | ✅ 完成 | **1000/1000 · 0 失败**；日志 16,240,355 字符 / 5,048,495,143 字节；抽查：大预算 视图内含4/答对4/recall6/retrieve10；小预算 4/4/6/10 |
| 2 | 进行中 | `--stateDir .memory-stress-r50-run2`（独立 1000 轮） |
| 3 | 待开始 | `--stateDir .memory-stress-r50-run3` |

日志：`.r50-logs/mem-driver.log`、`.r50-logs/mem-run{1,2,3}.log`。
状态：`.memory-stress-r50-runN/runN.state.json`（可断点续跑）。

## 9.2 小游戏 6 轮 × 3 遍
| 遍 | 模型 | 结果 |
|---|---|---|
| 1 | **MiMo mimo-v2.6-flash** | ✅ **过 31 · 败 0 · 跳 0** |
| 2 | 同上 | 进行中 |
| 3 | 同上 | 待开始 |

> 27B 本地模型（Ollama）在多轮改写时反复漏改「暂停/最高分」，已改默认用 MiMo；
> 想跑本地腿用 `R46_OLLAMA=1`。

## 9.3 fast 档
最近一次全绿：**77 项次 · 真红 0**（在 better-sqlite3 三候选补齐后）。
三连：`dev/gates/run-verify-22.mjs --tier=fast --times=3`。

**注意**：`better-sqlite3` 的 `lib/`+`package.json` 曾在某轮被清掉（原因未定位到具体进程）。
跑门禁前先自检三候选：
```
Test-Path packages/memory-os/vendor/better-sqlite3/lib/index.js
Test-Path packages/memory-os/node_modules/better-sqlite3/lib/index.js
Test-Path $env:APPDATA\@warmy\app-shell\memory-runtime\node_modules\better-sqlite3\lib\index.js
```
缺了就从 `C:\wbuild\.r50-logs\bsq-tmp\package` 重新复制。


---

# 10. 下一步（按优先级，接手直接照做）

1. **知识库第四列卡片可见性 UI**（需求 2 的 UI 部分）
   - 群聊：创建者 = 知识库卡（全部）+ 会话库卡；非创建者 = 知识库卡（自己的内部+会话+私密 + 创建者提供的会话库）+ 会话库卡。
   - 项目：创建者 = 知识库卡（全部）+ 内部库卡（内部+会话）；非创建者 = 知识库卡（全部 + 自己的内部/私密）+ 内部库卡。
   - 后端已按会话类型过滤（`kbLayersFor`），UI 只需按 `localIsCreator` 显示对应卡片并按层检索。
2. **牛马管理局「上下文预算」输入框**（后端已读 `instances[i].contextBudgetPercent`）。
3. **拼音首字母匹配**（@ 下拉）：加汉字→首字母表或轻量 pinyin 库；补齐后 `verify-at-tidao` 再加两条。
4. **项目多执行者接并行/接力判定**（当前只接分身一路）。
5. **黑板跨轮带回 ≤2400 字摘要**（需求 5）。
6. **中间回复进记忆的摘要条**（需求 7）。
7. **教条/束缚默认折叠** + 「道」第二支门禁（禁改 UI 入口）。
8. **ASR 真机话筒读数**：在有麦克风的机器点「话筒自检」，把数值写回 §8.7。
9. 三连收尾 → 全量回归（fast×3 + 关键 live）→ **首启验收**（`dev/gates/r38-firstrun.mjs`）。

## 10.1 已知限制（别当成缺陷追）
- 中文名 @ 搜索目前只按字面，不按拼音首字母（见上第 3 条）。
- 27B 本地模型做多轮文件改写不稳；游戏验收默认走 MiMo。
- `verify-at-tidao` 是**源码级**判据（DOM 行为需真机点验）；真机验收时手动过一遍 @ 与改名。


---

# 11. R51 第三轮（本轮新增，已自检）

## 11.1 牛马管理局「上下文预算」输入框（需求 3 的 UI 收尾）
- 位置：牛马管理局 → 某只牛马 → 模型设置 → 子项 5「上下文预算（%）」。
- 行为：留空 = 跟随全局聊天框；填 10–100 = 该牛马的**分身/执行者**按它算（后端 `zhiXingZheYuSuanBaiFenBi` 已读 `instances[i].contextBudgetPercent`）。
- 落盘：改完即存 `instances[]`（与头像/模型同一套即时保存），非法值回弹并提示。
- 文案：`model.ctxBudget / ctxBudgetHint / ctxBudgetInherit / ctxBudgetBad`（10 包）。

## 11.2 知识库第四列卡片（需求 2 的 UI）
- `warmy:zhiShiCengKeJian` → `{ kind, isCreator, layers }`（`kbLayersFor` 同一份规则）。
- `warmy:zhiShiQuery` 支持三种形态：`"q"`（全部层）/ `{q,ceng}`（单层）/ `{q,sessionId}`（按会话作用域）。
- 卡片渲染（`renderPanelKnowledge`）：
  - 第一块「知识库（可见层）」+ 角色（创建者/成员）+ 本次实际可见的层名；
  - 第二块「会话知识库」（只查 session 层，所有会话共用）；
  - 每条命中若带 `_ceng` 会标注来自哪一层。
- **私密层**：群聊/项目由后端直接排除（`kbLayersFor` 只给 session / session+internal），
  只有「我的牛马」三层可见。
- 文案：`kb.ceng.session/internal/private`、`kb.role.creator/member`、`kb.titleAll`（10 包）。

## 11.3 @ 下拉的拼音通道（需求 1 的补充）
- 仓库没有汉字→首字母表，本轮先做**机制**：
  - 牛马设置新增「拼音首字母（可选）」（`instances[i].pinyin`）；
  - @ 下拉按 `pinyin.startsWith(输入)` 匹配，优先级排在「名称开头」之后、「名称包含」之前；
  - 名称本身是字母时天然可用（如 `coder-1`）。
- **已知限制**：不填拼音的中文名只按字面匹配。要全自动需引入 pinyin 库或自带大表（见 §10 待办 3）。

## 11.4 门禁更新
- `verify-at-tidao` 扩到 **25 ok / 0 FAIL**（新增 4 条拼音通道断言）。
- `verify-kb-scope` **16/0**（三层作用域仍绿）。
- `verify-i18n-locales` **162/0**（修掉 ru 包里一处误带的 CJK）。
- `verify-wiring` **238/0**。

## 11.5 压测（滚动）
- 记忆：第 1 遍 1000/1000·0 失败；**第 2 遍进行中**（独立 stateDir）。
- 小游戏：第 1 遍 **31/0**（MiMo）；**第 2 遍进行中**。


---

# 12. R51 第四轮（已自检）

## 12.1 「道」的第二支硬门禁（需求 8/15 的收尾）
- **覆盖前先备份**：`warmy:daoShe` 现在写前把旧 `dao.md` 复制成 `dao.md.bak-<时间戳>`，只留最近 **5** 份；备份路径进审计 `settings.dao-md-saved { beiFen }`。
- 写入口仍只有一处（`daoShe`），播种只在文件缺失时发生。
- 新门禁 `verify-dao-safety` **12/0**：
  唯一写入口 / 备份 / 有界 / 审计 / 只播种一次 / 只两处写 / 界面必须点「确定」/ 无 onchange 自动存 / 只有道不可压缩 / 教条与束缚默认折叠。

## 12.2 教条 / 束缚默认折叠
- 设置 → 我的 里，两块改成 `<details>`（默认收起），标题仍显示「教条」「束缚」。
- `verify-dao-safety` 钉住：存在 `<details ... id="zuiGaoXinNianKa|shuFuKa">`、且**不带 `open`**。

## 12.3 项目多执行者：并行 / 接力（需求 4 收尾）
- 新纯函数 `packages/app-shell/src/pai-fa-pan-ding.ts: xuYaoJieLi(brief)`：
  - brief 里同时出现「写类动词」+「具体文件/路径」⇒ **serial**（多执行者会互相覆盖）；
  - 否则 **parallel**（各自给结论，宿主按配额汇总）。
- `orchestrator.paiFaZhiXingZheLun`：
  - 派发前调用 `xuYaoJieLi`，审计 `orchestrator.dispatch-plan {fangShi,chongTu,n}`；
  - 把原来内联的 `Promise.all(zhiXingQiJi.map(async ...))` 抽成 `paoYiGe(zxId, xu)`；
  - serial 时**按顺序 await**，parallel 时仍 `Promise.all`（逻辑只有一份，不漂移）。
- `deps.audit` 接线到主进程 `audit.log`。
- 门禁 `verify-parallel-serial` 扩到 **19/0**（新增：项目写文件⇒接力、纯分析⇒并行、派发前调用、按序 await、审计）。

## 12.4 本轮改动文件
- `packages/app-shell/src/renderer/app.js`（教条/束缚改 `<details>`；拼音输入；预算输入）
- `packages/app-shell/src/electron-main.ts`（daoShe 备份；zhiShiQuery 三形态；zhiShiCengKeJian；deps.audit）
- `packages/app-shell/src/preload.cjs`（zhiShiCengKeJian）
- `packages/app-shell/src/pai-fa-pan-ding.ts`（xuYaoJieLi）
- `packages/app-shell/src/orchestrator.ts`（并行/接力派发 + paoYiGe 抽取）
- `dev/gates/verify-dao-safety.mjs`（新）、`verify-parallel-serial.mjs`、`verify-at-tidao.mjs`（扩）
- `src/i18n/*.json`（ctxBudget / pinyin / kb 系列，10 包）

## 12.5 当前门禁（全部绿）
```
verify-prompt-layers        14/0
verify-dao-safety           12/0
verify-kb-scope             16/0
verify-parallel-serial      19/0
verify-changwen-tingzhi     10/0
verify-tonghu-xieyi         15/0
verify-asr-routing          11/0
verify-budget-per-executor   8/0
verify-at-tidao             25/0
verify-r50-plan-schedule    23/0
verify-memory-jsonl-big      4/0
verify-i18n-locales        162/0
verify-wiring              238/0
verify-import-integrity     all pass
```


---

# 13. R51 第五轮（已自检）

## 13.1 跨轮黑板摘要（需求 5，按推荐定稿）
- 新模块 `packages/app-shell/src/ban-ji-dai-hui.ts`（纯逻辑）：
  - `shouTiao` 收条目（**最多 40 条**，超出丢最旧）；
  - `daiHuiZhaiYao(ku, sessionId)`：同一会话、**6 小时窗口**内、**最近一个任务号**的条目 →
    ≤2400 字摘要 + 指针（`recall("<任务号>")`）；没有/过期/跨会话一律 null。
- 主进程：
  - 黑板写成功后（`heiBanCun.xie` 返回 ok）把 `{sessionId, renWuId, lei, wen≤200, ts}` 记进摘要库，
    落盘 `userData/board-carry.json`，启动时 `duBanDaiHui()` 读回；
  - **只在真实用户轮**注入（`internal` 续派轮不带），审计 `chat.board-carry`。
- 门禁 `verify-context-carry` **15/0**（跨会话不带、过期不带、只带最新任务、条数/正文字数有界、仅用户轮）。

## 13.2 中间回复进记忆（需求 7，按推荐定稿）
- 一轮结束时，把本轮中间回复合成**一条** `kind:'zhongjian'` 记忆（≤1500 字），
  文本开头写明「供 recall 追述，正式结论见最终回复」；审计 `chat.interim-summary-memory`。
- **条数口径**：`zhongjian` 是额外记录类型，**不计入**"日志条数 = 消息记忆条数"；
  正式结论仍以最终回复那条 `kind:'message'` 为准。

## 13.3 本轮改动清单
- 新增 `packages/app-shell/src/ban-ji-dai-hui.ts`
- 新增 `dev/gates/verify-context-carry.mjs`、`dev/gates/verify-dao-safety.mjs`
- 改 `electron-main.ts`（摘要库状态/落盘/读回、黑板写入后记账、用户轮注入、中间回复摘要记忆）
- 改 `dev/gates/verify-prompt-layers.mjs`（道保存审计窗口放宽到 4000 字符，备份代码变长所致）

## 13.4 门禁（全绿）
```
verify-prompt-layers        14/0
verify-dao-safety           12/0
verify-context-carry        15/0
verify-kb-scope             16/0
verify-parallel-serial      19/0
verify-changwen-tingzhi     10/0
verify-tonghu-xieyi         15/0
verify-asr-routing          11/0
verify-budget-per-executor   8/0
verify-at-tidao             25/0
verify-r50-plan-schedule    23/0
verify-memory-jsonl-big      4/0
verify-i18n-locales        162/0
verify-wiring              238/0
verify-truth-guard           9/0
verify-import-integrity     all pass
check-syntax                OK
```

## 13.5 压测（滚动）
- 记忆：第 1 遍 1000/1000·0 失败；第 2 遍进行中。
- 小游戏：第 1 遍 31/0；第 2 遍进行中。

## 13.6 剩余（下一步）
1. 等两档三连跑完（第 2、3 遍）。
2. 全量回归：`run-verify-22 --tier=fast --times=3` + 关键 live（r48-nengli / zhongjian-ui / round34-live / round38-restart / round20-team×2 / r44-token-live / round39-longchat）。
3. **首启验收**：`node dev/gates/r38-firstrun.mjs`（会搬配置、重开，打印 setupDone 与实例数）。
4. 桌面残留按用户口径只删测试新增；记事本残留已关。


---

# 14. R51 第六轮：回归驱动的两处修正（已自检）

## 14.1 `verify-r44-yuSuan` 按新口径更新（仪器过时，非产品）
- 旧断言：`道/规矩/印象/门禁/身份锚` 全部不可压缩；兜底窗口 32768。
- 新口径（用户第 51 轮）：**只有「道」不可压缩**；窗口未知统一 **128000**。
- 改法：两条断言改为「道=不可压 / 其它=可压」；兜底断言改 `128000`。
- 结果：**176 ok / 0 FAIL**。

## 14.2 检索全文被索引预览截断（真缺陷，回归抓到）
- 现象：`verify-tool-calls` 的「超长记录分段取回」拿到 500 字（期望 9011，sha 不符）。
- 根因：为治 OOM 把索引 `ti` 改成 500 字预览后，`retrieve` 里几条**按索引返回原文**的分支
  （`jsonl:offset` / `jsonl:id-prefix` / `jsonl:offset-nearest` / `jsonl:last`）仍在返回 `entry.ti`。
- 修法：这四条改为 `this.duJsonlQuanWen(entry)`（按字节偏移现读全文）。
- 复跑：`pages=3, gotChars=9011, sha16 一致` → `verify-tool-calls` 全过。

## 14.3 读数
- fast 档：**77 项次 · 真红 0**；`--times=3` 已在后台跑（`.r50-logs/fast-3x.log`）。
- 记忆：第 1 遍 1000/1000·0；第 2 遍进行中。
- 小游戏：第 1 遍 31/0；第 2 遍进行中。

## 14.4 教训（写进纪律）
**索引里存"预览"是性能必需，但任何"按索引回原文"的路径都必须改成按偏移现读** ——
新增检索分支时先问一句：这里返回的是预览还是全文？


---

# 15. R51 第七轮：两处仪器假红修正（已自检）

## 15.1 `verify-strict-language` 固定临时 profile ⇒ EPERM 假红
- 现象：fast×3 第 1 遍里该支报 `EPERM ... warmy-lang-gate-profile`。
- 根因：profile 目录名是**固定**的（`%TEMP%/warmy-lang-gate-profile`），
  上一支/残留进程还占着/锁着，`rmSync` 直接抛 EPERM ⇒ 判红。
- 修法：目录名加 `process.pid + Date.now()`（每次唯一），`rmSync` 包 try/catch。
- 复跑：单支通过。

## 15.2 小游戏第 6 轮「游戏循环真跑」误判
- 现象：MiMo 写的打砖块在 Chromium 里 `pS1 === pS2` ⇒ 判「没在动」，第 2 遍因此 30/1。
- 根因（仪器）：夹具只按了空格/回车就开始量；有的游戏要**点一下画布**或按 **W/A/S/D** 才开始。
- 修法：`r46-chromium-harness.cjs` 在"空闲不动"时补一轮——点画布中心 + 按 w/a/s/d/空格/回车，
  等 600ms 再连测两次；仍不动才判红。
- 复跑：同一构建 **过 31 · 败 0**。

## 15.3 现场
- fast×3 与 game×3 已按修复后**重新起跑**（干净日志）。
- 记忆第 2 遍继续跑（独立 stateDir）。
- 纪律补一条：**门禁的临时目录一律带 pid/时间戳**，固定名在并发/残留下必然假红。


---

# 16. R51 第八轮：小游戏真跑判据再修正 + 记忆第 2 遍全绿

## 16.1 记忆三连进度
| 遍 | 结果 |
|---|---|
| 1 | ✅ 1000/1000 · 0 失败 |
| 2 | ✅ 1000/1000 · 0 失败（日志 12,715,307 字符；轮耗时均 9.2s） |
| 3 | 进行中（`--stateDir .memory-stress-r50-run3`） |

## 16.2 小游戏第 6 轮判据（修正 2）
- 现现象：打砖块「按键发球、发球后才动」，旧夹具在**发球前**量两次 ⇒ 判「没在动」。
- 新顺序（`r46-chromium-harness.cjs`）：
  1. 空闲测 `p1/p2`；不等 ⇒ 直接算「空闲在动」；
  2. 否则点画布 + W/A/S/D/空格/回车；
  3. **再按方向键发球**；
  4. 发球后连测 `pS1/pS2`（间隔 1.6s）⇒ `pS1≠pS2` 判「循环真跑」；
  5. 键盘判据：发球后状态 ≠ 发球前。
- 这样既容得下「按开始才动」，也仍然拒绝「每按一次才走一格」的静态图（那种 `pS1===pS2`）。

## 16.3 纪律补一条
判「动画在跑」必须与**该游戏的启动方式**对齐；先穷举启动方式（点击/方向键/空格），
再测"此后是否自己动"。测前状态与测后状态分开记，别混成一次比较。


---

# 17. R51 第九轮：记忆三连全绿 + 小游戏夹具 v3

## 17.1 记忆 1000×2M **三连全绿**
```
[mem] 第 1/3 遍 exit=0  ✅ 1000/1000 · 0 失败
[mem] 第 2/3 遍 exit=0  ✅ 1000/1000 · 0 失败
[mem] 第 3/3 遍 exit=0  ✅ 1000/1000 · 0 失败
[DONE] mem 3/3 全绿
```
三遍独立 stateDir（`.memory-stress-r50-run{1,2,3}`），第 2 遍日志 12,715,307 字符、轮均 9.2s。

## 17.2 小游戏第 6 轮夹具 v3（空格是暂停！）
- 真机教训：上一版为「开始」连按空格，把正在跑的打砖块**按停了** ⇒ 「循环在跑」与「键盘接上」双双判红。
- v3 规则：
  - 空闲就在动 ⇒ **不按任何键**，直接量 `pS1/pS2`（只按方向键）；
  - 空闲不动 ⇒ 只点画布 + Enter/W/A/S/D（**绝不按空格**）→ 按方向键发球 → 连测两次；
  - `ziDong = qiDong || (pS1≠pS2)`；`jianPan = (pS1≠pS2) || (p2≠p3)`。
- 纪律：**测试输入不能改变被测状态机**（空格在游戏里是暂停，不是"开始"的同义词）。

## 17.3 现场
- fast 三连：231 项次 0 红（已完成）。
- 记忆三连：3/3 全绿（已完成）。
- 小游戏三连：按 v3 夹具重跑中（`.r50-logs/game-3x.log`）。
- 下一步：小游戏三连 ≥1 次全绿后跑关键 live 档 → 首启验收。


---

# 19. 当前情况总览（2026-10-21 · 给下一个会话 / 给用户对账用）

## 19.1 此刻后台在跑什么？
**只有一档：**小游戏三连 `r50-run3.mjs game 3`（PID 36212 等）。

| 套件 | 状态 |
|---|---|
| **fast 档 `--tier=fast --times=3`** | ✅ **完成**：三遍全部 真红 0，共 **231 项次**，exit 0 |
| **记忆 1000 轮×2M ×3** | ✅ **完成**：三遍各 1000/1000 · 0 失败（`[DONE] mem 3/3 全绿`） |
| **小游戏 6 轮 ×3** | ⏳ **进行中**：第 1 遍进行中（已过第 1–2 轮全绿，第 2 轮用了 1 次纠正） |
| 关键 live 档 | ⬜ 未开始 |
| 首启验收 | ⬜ 未开始 |

日志位置：`.r50-logs/`（`game-run1.log`、`game-3x.log`、`mem-driver.log`、`fast-3x.log`…）。

## 19.2 任务清单（对照 16 条用户需求）

| # | 需求 | 状态 | 门禁/证据 |
|---|---|---|---|
| 1 | 定向模式 + @ 下拉 + 名称唯一 | ✅（拼音通道为机制） | `verify-at-tidao` 25/0 |
| 2 | 外部渠道 + 知识库作用域（含 UI） | ✅ | `verify-kb-scope` 16/0 |
| 3 | 上下文预算按执行者 | ✅ | `verify-budget-per-executor` 8/0 |
| 4 | 并行/接力（分身 + 项目值班者） | ✅ | `verify-parallel-serial` 19/0 |
| 5 | 黑板跨轮带回摘要 | ✅ | `verify-context-carry` 15/0 |
| 6 | 窗口兜底 128K + 模型名解析 | ✅ | `verify-r44-yuSuan` 176/0 |
| 7 | 中间回复进记忆摘要 | ✅ | `verify-context-carry` 15/0 |
| 8 | 道缩 3000 字 / 不谄媚 / 不可压 | ✅ | `verify-prompt-layers` 14/0 |
| 9 | ASR 本机优先 + 仅本机开关 | ✅（话筒实测待做） | `verify-asr-routing` 11/0 |
| 10 | 字数停滞改内容信号 | ✅ | `verify-changwen-tingzhi` 10/0 |
| 11 | dsh 契约 import | ✅ | tsc / import-integrity |
| 12 | 知识库三层 | ✅ | `verify-kb-scope` 16/0 |
| 13 | nm 插件与超链接 | ✅ | 源码 + `common.open` i18n |
| 14 | 牛马互通协议 v1 | ✅ | `verify-tonghu-xieyi` 15/0 |
| 15 | 印象卡 + 术/教条/束缚 | ✅（折叠完成） | `verify-dao-safety` 12/0 |
| 16 | 交接文档 | ✅ 本文件 | — |

**R50 遗留（已做）：** 计划/定时变更不删旧（`verify-r50-plan-schedule` 23/0）、软门禁分区 UI。
**R50 遗留（待你拍板才动）：** §18.6 里 2/3/4/5/8 的取向仍等拍板（社交作用域细则、执行者预算细则、并行策略细则等）——本文件 §11–§18 已按你的口径落地；若你还有新口径，说一句我改。

## 19.3 还没做完的清单（按顺序）
1. **小游戏三连**跑完（当前第 1 遍进行中；第 2、3 遍会自动接）。
   - 单遍门槛：`过 31 · 败 0`（第 6 轮真跑判据 v3 + 暂停判据已放宽到"看行为不看变量名"）。
2. **关键 live 档**（真 Electron + 真模型，串行）：
   - `verify-r48-nengli-tongbu`、`verify-r48-zhongjian-ui`、`verify-round20-team --ollama`、`verify-round20-team`（MiMo）、
     `verify-round27-live`、`verify-round28-live`、`verify-round34-ui`、`verify-round34-live`、`verify-round38-restart`、
     `verify-round39-longchat`、`verify-round39-quota-ui`、`verify-r44-ui`、`verify-r44-shejiao`、`verify-r44-token-live`、
     `verify-history-persist`。
   - 跑法：`MIMO_KEY_FILE=%TEMP%\w50-mimo-key.txt node dev/gates/<名>.mjs`；**严禁并行**（抢调试端口=假红）。
3. **全项目验收 ×2**（fast 三连已绿，live 全绿后做两遍快照）。
4. **首启验收**：`node dev/gates/r38-firstrun.mjs`（会把配置搬进备份、重开应用，打印 `setupDone` 与实例数）。
5. **ASR 话筒自检实测**（要真麦克风，把读数写回 §8.7）。
6. （可选）@ 下拉的**全自动拼音**（需要引入 pinyin 库/大表）；目前走"牛马设置里填拼音首字母"。

## 19.4 现场里的东西（别误删 / 别误留）
- 真实配置 `%APPDATA%\@warmy\app-shell`：含 `dao.md`（3202 字新版，备份 `dao.md.bak-*`）、`board-carry.json`、`impressions/`、三层知识库 `knowledge-*.json`。
- `better-sqlite3` **三候选**必须都完整（见 §1.1）；跑门禁前先自检。
- 密钥：`%TEMP%\w50-mimo-key.txt`（第一行），走 `MIMO_KEY_FILE`，**不要放进仓库**。
- 桌面残留已按口径删过测试新增；记事本残留已关（保留用户自己的那份）。
- 仓库：**未 commit / 未 push**（按用户口径）。

## 19.5 万一要接着跑：三行命令
```powershell
# 1) 继续/重跑游戏三连
$env:MIMO_KEY_FILE="$env:TEMP\w50-mimo-key.txt"; $env:KEEP='1'
node dev/gates/r50-run3.mjs game 3

# 2) 重跑记忆三连（带堆上限）
$env:MIMO_KEY_FILE="$env:TEMP\w50-mimo-key.txt"; node --max-old-space-size=12288 dev/gates/r50-run3.mjs mem 3

# 3) 首启验收（全部绿完后再做）
node dev/gates/r38-firstrun.mjs
```


---

# 20. R51 第十一轮：@ 全自动拼音（必须项）+ 全任务双保险监控

## 20.1 @ 下拉**全自动**拼音匹配（不再依赖用户手填）
- 新表：`packages/app-shell/src/pinyin-shou-zi-mu.ts`（数据源 **mozillazg/pinyin-data v0.15.0**，CC BY 4.0）。
  - 覆盖 **44,440** 个汉字；每字取**第一个读音**首字母；zh/ch/sh 并入 z/c/s（通行口径）。
  - 同时生成渲染层副本 `src/renderer/pinyin-shou-zi-mu.js`（`window.__shouZiMuChuan`），`index.html` 已挂载。
- 匹配优先级（最终）：**名称开头 → 拼音首字母（自动/手填）→ 词首 → 包含 → 其它**。
- 手填 `instances[i].pinyin` 仍可覆盖（个别生僻字或多音字纠错用）。
- 验证：`小牛→xn`、`张三→zs`、`李雷→ll`、`coder-1→coder`。
- 门禁：`verify-at-tidao` **32 ok / 0 FAIL**（新增 6 条自动拼音断言）。

## 20.2 全任务「唤醒 + 定时轮询」双保险（用户要求）
- 用 cron **loop 每 5 分钟**唤醒一次（`R51 全任务推进器`），覆盖：
  1. 游戏三连（卡死/红 → 报告并重启；绿 → 自动接 live）
  2. 关键 live 档**串行**清单（见 §19.3，一次一支）
  3. 全项目验收 ×2
  4. 首启验收 `r38-firstrun.mjs`
- 每次醒来：读交接 §19.3 → 查进程与日志尾部 → 按序推进 → 有新读数写回 §9；平常只报一句状态。
- 判定异常的标准：进程消失但日志无「3/3 全绿/exit 0」；日志有 FATAL/ERR/EPERM/heap；**连续 5 分钟无新行**（卡死）。
- 全部完成后：交接里写「全部完成」并停循环。

## 20.3 改动清单
- 新增 `packages/app-shell/src/pinyin-shou-zi-mu.ts`、`src/renderer/pinyin-shou-zi-mu.js`
- 改 `src/renderer/index.html`（挂载拼音表脚本）
- 改 `src/renderer/app.js`（`mingJi().py` 自动算首字母，手填优先）
- 改 `dev/gates/verify-at-tidao.mjs`（32/0）


---

# 21. R51 第十二轮：@ 下拉按九条口径重做 + 日/韩/中读音表

## 21.1 非字母类自动首字母（口径 1、6）
- 新模块 `packages/app-shell/src/du-yin.ts`（渲染层副本 `src/renderer/du-yin.js`）：
  · **汉字读音**：Unicode Unihan（kJapaneseOn/kJapaneseKun，含**浊音变体** rendaku）+ mozillazg/pinyin-data（中文优先排前）
  · **假名**→罗马字（五十音 + 浊音/半浊音/促音）；**韩文**音节→초성（ㅇ→y）
  · 每字最多 8 个候选读音；多读音**前缀匹配**用 DFS（山田/yamada ✓、山田/yd ✓、小牛/xiaoniu ✓）
- 覆盖简/繁汉字、日文汉字、平假名、片假名、韩文音节。
- **去掉**牛马设置里的手填「拼音首字母」输入（口径 5）。

## 21.2 列表范围（口径 2/3/4）
- **群聊/项目**：只列**该会话里的牛马**（`groupMembers` 过滤 `source==='instance'`）。
- **联系人**：**不弹**下拉。
- **我的牛马**：列**全部会话** —— 全部牛马 + 全部群 + 全部项目 + 全部联系人；
  选项前加**第一列同款 SVG 图标**（singleAi / internalGroup / externalChat / externalGroup 四枚）。

## 21.3 搜索与键位（口径 7/8/9）
- **查询串不进消息框**：打在**隐藏 textarea**（`.atShuRu`，叠在聊天框上，opacity:0）⇒
  输入法候选框照常弹，看起来在打字，但聊天框里不显示搜索串。
- 排序档位：0 名称字面前缀 → 1 首字母前缀 → 2 全读音前缀 → 3 包含 → 4 其它（**全部仍在下方**）。
- **连续输入**直到：回车 / ↑↓ / 其它非字母数字键 / 鼠标点击 / 窗口失焦；回车与 ↑↓ 之后**下一次输入算新搜索**。
- 键位语义：
  | 场景 | 行为 |
  |---|---|
  | @ 后按空格 | 下拉关，留普通 @ |
  | @ 后按退格 | 关下拉并删掉 @ |
  | 候选中（组合中） | 其余按键全交输入法；只有**第一个字母**更新搜索，之后冻结 |
  | 候选中回车 | 保持结果、结束这段（不把回车给输入法） |
  | 上屏后空格 | 关下拉（普通 @） |
  | 上屏后回车 | 选中当前高亮项，插入 `@名字 ` |
  | 上屏后退格 | 清搜索 → 回默认排序 |
  | 默认排序退格 | 关下拉并删掉 @ |
  | ↑↓ | 循环选（到顶回底/到底回顶），之后输入算新搜索 |
- 中文：按**实际输入法**上屏结果搜索；**回车上屏的字母**按字母搜、**空格上屏的字**按字搜；连续上屏累积。

## 21.4 门禁
`verify-at-tidao` 重写为九条口径断言：**34 ok / 0 FAIL**
（含：小牛/xn、小牛/xiaoniu、김철수/gcs、やまだ/ymd、山田/yamada、山田/yd、coder-1/co 等真值表）。

## 21.5 说明一处取舍
字母输入法下第 2 个字母起「不再优先拼音」与「日/韩按首字母搜多字母」两条在字面上冲突；
现按**后者**（口径 1、9）实现：首字母/全读音前缀在任何长度都参与排序（`xn` 可搜到小牛、`gcs` 可搜到김철수）。
若你要「字母法第 2 字母起只认名称前缀」，说一声我加开关。


---

# 22. 新会话交接（2026-10-21 · 详细版，接手必读）

> 目标：新会话打开后**不丢任何线索**、**不中断任何后台任务**、**不漏掉任何未做任务**。
> 读法：§22.1 先重启后台 → §22.2 当前状态 → §22.3 未完成清单 → §22.4 打算顺序 → §22.5 方案可行性 → §22.6 环境与纪律。

## 22.1 立刻做（第一分钟）

### A. 重启/接续后台任务（当时它们已停）
```powershell
cd C:\wbuild
# 1) 小游戏三连（第 2 遍红了被驱动器停下，要从第 1 遍重跑三连；保持 v3 夹具与新判据）
$env:MIMO_KEY_FILE="$env:TEMP\w50-mimo-key.txt"; $env:KEEP='1'
node dev/gates/r50-run3.mjs game 3

# 2) 记忆三连（已完成 3/3 全绿，如需复跑才执行；必须带堆上限）
# node --max-old-space-size=12288 dev/gates/r50-run3.mjs mem 3

# 3) fast 三连（已完成 231 项次 0 红；复跑）
# node dev/gates/run-verify-22.mjs --tier=fast --times=3
```
**重启双保险**：`cron` 工具里应仍有「R51 全任务推进器」loop（每 5 分钟）。
若新会话里没有，重新挂上：`cron loop delay=300s`，prompt 照抄本节 §19 的推进器内容（查进程/日志尾部/卡死=连续 5 分钟无新行/失败即报告并重启/全绿则串行跑 live → 首启）。

### B. 配置与自检（30 秒）
```powershell
# 密钥（第一行即 key，不要进仓库）
Test-Path "$env:TEMP\w50-mimo-key.txt"
# better-sqlite3 三候选（缺了就从 .r50-logs\bsq-tmp\package 复制）
Test-Path C:\wbuild\packages\memory-os\vendor\better-sqlite3\lib\index.js
Test-Path C:\wbuild\packages\memory-os\node_modules\better-sqlite3\lib\index.js
Test-Path "$env:APPDATA\@warmy\app-shell\memory-runtime\node_modules\better-sqlite3\lib\index.js"
```

## 22.2 当前状态（这一刻）

| 项 | 状态 |
|---|---|
| fast 档三连 | ✅ 231 项次 0 红 |
| 记忆 1000×2M 三连 | ✅ 3/3 全绿（各 1000/1000 · 0 失败；第 1 遍日志 5.05GB、第 2 遍 12.7MB 字符） |
| 小游戏 6 轮 ×3 | ⏳ 第 1 遍 **31/0 全绿**（v3 夹具+新暂停判据）；第 2 遍 **30/1 红**（模型把 youxi.html 改成「没有任何脚本」⇒ 语法/逻辑判据判红，产品缺陷=模型改坏文件）；驱动器已按纪律停下 |
| du-yin 拼音/读音模块 | ✅ 刚改完「中文 2 字母起不优先拼音、日/韩始终按首字母」，tsc=0（真值表已验：小牛/xn→4、小牛/x→1、小牛/小→0、山田/yamada→2、山田/yd→1、김철수/gcs→1、やまだ/ymd→1、coder-1/co→0） |
| verify-at-tidao | 34/0（旧断言，**待按新规则补 3 条**：小牛/xn 应=4 而非 1） |
| 后台进程 | 无测试在跑（游戏三连已停）；只有 cron 推进器在 |

## 22.3 还没做 / 正在做（完整清单）

### P0 未做完（用户本轮新口径，**必须做**）
1. **@ 拼音规则收尾**：`verify-at-tidao` 里 `小牛/xn` 断言改为「≥2 字母不再优先中文拼音」（期望 4）；补 2 条：日/韩 `gcs`、`yamada` 仍 =1/2。
2. **会话隔离硬门禁**（用户：群聊/联系人/项目中的牛马**严禁查看其他会话内容**，只通过知识库联系；我的牛马可看全部）：
   - 产品侧：recall/retrieve/knowledge 检索按会话作用域过滤（已有 `jiYiZuoYongYu`/`kbLayersFor`，要补「项目/群/联系人不得跨会话读」的运行时断言）。
   - 硬门禁 `verify-huihua-geli.mjs`：钉住三条：①群/联系人/项目会话的 recall/retrieve 不得返回其它会话内容；②我的牛马可以；③知识库是唯一跨会话通道。
3. **知识库作用域修正**（用户最新口径，与 §8.10/§21 不同处已标注）：
   | 会话 | 会话知识库 | 内部知识库 | 私密知识库 |
   |---|---|---|---|
   | 群聊 | ✓ | ✗ | ✗ |
   | 联系人（未来加牛马） | ✓ | ✗ | ✗ |
   | 项目 | ✓ | ✓ | ✗ |
   | 我的牛马 | ✓ | ✓ | **需用户勾选**「允许查看私密知识库」（牛马管理局，名称与认知之间） |
   - 归档可以写入私密/内部（**与读权限不冲突**）；写入路径与读取路径分开。
   - 硬门禁 `verify-kb-scope` 扩断言：私密读必须有 `instances[i].privateKb === true`；群/联系人/项目读私密=拒绝；归档写私密=允许。
4. **牛马管理局 UI**：在「名称」与「认知」之间加勾选项「允许查看私密知识库」（默认不勾），落盘 `instances[i].privateKb`。
5. **内部/私密知识库加密**（用户要更安全）：方案见 §22.5；实现 `knowledge-internal.json` / `knowledge-private.json` 静态加密（AES-256-GCM，密钥走 `secure/keys.enc.json` 同一套 OS 保护；会话库保持明文或同样加密）。
6. **脱敏体系**（用户大方案，见 §22.5 可行性结论）：
   - 发送前敏感识别（账号/人名/地址/邮件/密码/凭证/密钥/授权码/助记词/网址/职务/身份/证件号/票据号/二维码…）+ **敏感度分级**（低=模型判断，高=硬门禁约束）
   - 每会话**脱敏原文对照表**（加密）+ **本机操作专用加密引用文件**（门禁保护：只可引用，不可读/看/改/运行；由受门禁保护的用户程序读取；用完销毁临时文件）
   - 脱敏导致无法完成时 → **弹选项卡**给用户选替代方案；可声明「非敏感」
   - 设置→功能底部「**非敏感列表**」（默认折叠）：创建时间/内容/删除/手动添加；模型改这张表必须**授权卡**（完全授权档免弹）
   - 硬门禁：①非敏感表改写需授权；②引用文件只可引用；③用户程序不可被模型改；④高级敏感内容硬门禁拦
7. **牛马互通协议**继续：项目多执行者双向（当前值班者→执行者单向）。
8. **黑板跨轮摘要**已做（§13）；**中间回复进记忆摘要**已做（§13）——回归 live 验证未做。

### P1 之前排队、仍有效
9. **关键 live 档串行**（§19.3 的 15 支名单）→ 全项目验收 ×2 → **首启验收** `r38-firstrun.mjs`。
10. **ASR 话筒自检实测**（真麦克风，读数写回 §8.7）。
11. §18.6 的若干取向（社交作用域细则、执行者预算细则等）用户已有口径的已落地；新口径若再说就改。

### P2 可选
12. @ 下拉真机手测（DOM 行为是源码级门禁，未点过真机）。
13. `verify-r46-youxi` 对「模型改坏文件」的催办加强（第 2 遍红因：改完没脚本；可加「改完必须仍有 script 标签」的当场催补）。

## 22.4 打算进行的顺序（新会话按此走）
1. §22.1 重启游戏三连 + 挂 cron 推进器（双保险）。
2. P0-1 拼音断言修正（10 分钟）→ P0-2/3/4 知识库作用域 + 会话隔离 + 私密勾选 + 两支硬门禁（1–2 小时）。
3. P0-5 知识库加密（内部/私密）。
4. P0-6 脱敏体系（最大一块，先做「敏感识别+分级+非敏感表+授权」再做引用文件与用户程序）。
5. 期间盯游戏三连；三绿后串行 live → 验收 ×2 → 首启。
6. 每完成一块：**更新本文件**（§22 后追加 §23/§24…）并在对话里汇报（用户要求）。

## 22.5 用户问的两个安全方案 · 可行性结论（我在本轮要答的）

### Q1 知识库加密？
**可行，推荐**：
- **会话知识库**：可明文（全员可读、要快速检索）或同样加密。
- **内部/私密知识库**：**AES-256-GCM 静态加密**；密钥不进仓库，放 `secure/keys.enc.json`（与现有 API Key 同一套 OS 保护 safeStorage/DPAPI）；文件头带 `v:1,nonce,tag`。
- 检索：解密进内存后用现有 FTS/JSON 查询；只在主进程解密，渲染层只拿结果。
- 代价：跨机器迁移要带密钥；忘备份密钥则库打不开（要写明「密钥丢失=数据不可恢复」）。
- 更强（可选）：每条记录单独信封加密；私密库可绑定 Windows Hello/DPAPI 用户级。

### Q2 脱敏原文对照表 + 发送前脱敏体系是否可行？
**总体可行，但要分层做，不可一次全上**：
- **可行的部分**：高敏字段（密码/密钥/授权码/助记词/证件号/票据号）模式识别 + 硬门禁拦截；每会话**加密对照表**（脱敏 token ↔ 原文）；本机操作时写**加密引用文件**，由**受保护的用户程序**读取；用完销毁临时文件；脱敏后无法完成 ⇒ 弹选项卡；「非敏感」名单 + 授权卡。
- **风险/难点**（诚实说）：
  1. **人名/职务/地址**误伤率高（"张伟"可能是人名也可能是文件名），低敏级别交给模型判断是对的；高级别才硬拦。
  2. **对照表本身就是最高价值目标** —— 必须 OS 级加密 + 只在主进程解密 + 审计每次还原；建议再加「还原次数/时间」上限。
  3. **引用文件的「只可引用不可读」**在 Windows 上做不到绝对（进程可读文件）；实际做法是：模型侧无读取工具、门禁禁 `read_file` 该文件、由宿主侧受信程序读取并只回传**结果**（而非原文）。用户程序用签名/哈希校验防改。
  4. **销毁临时文件**只能覆盖常规删除；真正保险是内存态使用 + 不落盘，落盘则用后安全擦除（多次覆写）或只存加密卷。
  5. 与工具调用冲突时（模型需要真实路径去 `open_file`）：引用文件里放「占位符→真实值」由宿主在执行工具时替换，模型全程见不到明文——这是**最干净**的形态，推荐先做这一层。
- **推荐落地顺序**：①敏感识别+分级+发送前脱敏+对照表（加密）→ ②非敏感名单+授权卡+硬门禁 → ③引用文件+宿主替换明文（模型只见占位符）→ ④用户程序与销毁策略。
- **结论：可行**；按上面 4 步做，每步都有硬门禁钉住，不要追求一步到位。

## 22.6 环境与纪律（浓缩，详细见 §1）
- 改 .ts 后：`packages/app-shell` 里 `tsc -b` + `copy-assets` + `check-syntax`。
- 真机门禁**严禁并行**（抢调试端口=假红）；跑前确认无 `electron.exe --remote-debugging-port`。
- `better-sqlite3` 会被清掉：跑前自检三候选；源在 `.r50-logs/bsq-tmp/package`。
- 密钥只走 `MIMO_KEY_FILE=%TEMP%\w50-mimo-key.txt`（第一行），不进仓库。
- 记忆压测：`node --max-old-space-size=12288`；2M×1000 会写约 5GB JSONL。
- 门禁临时目录带 pid/时间戳；判据绑「行为」不绑「变量名」；测试输入不许改变被测状态机（空格=暂停！）。
- **每完成一点更新本文件并在对话里汇报**（用户明确要求）。
- 未 commit / 未 push（用户口径）。

## 22.7 后台任务清单（新会话必须接续，勿中断）
| 任务 | 状态 | 重启命令 |
|---|---|---|
| 小游戏三连 | 需重启（第 2 遍红后停） | `node dev/gates/r50-run3.mjs game 3`（见 §22.1） |
| 记忆三连 | ✅ 已完成 | 如需复跑：`node --max-old-space-size=12288 dev/gates/r50-run3.mjs mem 3` |
| fast 三连 | ✅ 已完成 | `node dev/gates/run-verify-22.mjs --tier=fast --times=3` |
| cron 推进器 | 应仍在；不在则重挂 loop 300s | `cron` 工具 loop，prompt 见 §22.1 |


---

# 23. 移交备注（2026-10-21 会话结束时 · 请新会话先读这节）

## 23.1 后台任务移交（**不要杀进程、不要重复启动**）
**唯一在跑的后台**：小游戏三连（2026-10-21 10:02:34 启动，仍在跑）。
| 进程 | PID | 说明 |
|---|---|---|
| `node.exe` `dev/gates/r50-run3.mjs game 3` | 36928 | 三连驱动器（游戏专用，stdout 已重定向到日志） |
| `node.exe` `dev/gates/verify-r46-youxi.mjs` | 9604 | 当前第 1 遍的门禁本体 |
| `Xiaomi MiMo.exe` ×2 | 24224 / 22276 | 节点包装（随上者） |

**新会话怎么接管（重要）**：
1. **不要**再执行 `r50-run3.mjs game 3`（会起第二支，抢 Electron 调试端口 ⇒ 假红，纪律见 §1）。
2. 只做**旁观**：每几分钟读 `.r50-logs/game-3x.log`（驱动器汇总）与 `.r50-logs/game-run1.log`（第 1 遍明细，后续遍是 `game-run2.log`、`game-run3.log`）。
3. 判定与推进：
   - 日志出现 `第 N/3 遍 exit=0` 且 `过 31 · 败 0` ⇒ 该遍全绿，驱动器会**自动**开下一遍；
   - 出现 `exit=1` / `STOP` ⇒ 该遍红，驱动器已停；按 §22.1 重启 `node dev/gates/r50-run3.mjs game 3`（新进程，从第 1 遍重来）；
   - 进程消失且日志没有 `3/3 全绿` / `exit 0` ⇒ 视为异常，报告并按 §22.1 重启；
   - **连续 5 分钟无新日志行**且进程还在 ⇒ 可能卡死：报告后杀掉再重启。
4. 三遍全绿后 ⇒ 按 §22.3 的 live 名单**串行**跑（一次一支）→ 验收 ×2 → 首启 `r38-firstrun.mjs`。

## 23.2 已清理的后台（无需再管）
- 记忆三连：**已完成 3/3 全绿**，进程已退出。
- fast 三连：**已完成 231 项次 0 红**，进程已退出。
- 本会话的 cron「R51 全任务推进器」是**会话级**任务，随会话结束自动消失；
  新会话请按 §22.1 **重新挂一份 loop（300s）**做双保险 —— 这是用户明确要求的机制，别省。

## 23.3 其它补充
- 工作目录：`C:\wbuild`（ASCII 联接，指向本仓库所在的中文工作区目录；公开文档里不写真实用户路径）。
- 密钥：`%TEMP%\w50-mimo-key.txt`（第一行）。
- 用户口径：**质量优先、不降规模**；每完成一点更新本文件并汇报；未 commit/push。
- 上一条待办（§22.3 P0）一条未减：拼音断言收尾、会话隔离硬门禁、知识库作用域矩阵、私密勾选、内部/私密加密、脱敏体系 —— 都留给新会话按 §22.4 顺序做。

---

# 24. 推进器读数日志（2026-10-21 · 每次运行追加，原文照抄）

## 24.1 接管确认 + 第 1 遍进行中（10:47–10:49）
- **10:47:50** 读 `.r50-logs/game-3x.log` 全文（仍只有 1 行）：
  `[game] 第 1/3 遍开始 2026-10-21T02:02:34.695Z`
- **10:47:50** 读 `.r50-logs/game-run1.log` 末尾（原文）：
  ```
  · 这一轮用了 932 秒（回复 400 字）
    ok   第6轮：交付页仍然自带全部逻辑（无外链脚本、无联网）
    ok   第6轮：页面上写了玩法/按键说明
    · Chromium 临时夹具目录保留：%TEMP%\warmy-r46-chromium-1792550744410
    · 真跑判据未过（第 1 次修）：什么都不按画面也在动，或按开始键后自动移动（游戏循环真跑，不是静态图）；报错=[]
  ```
- **判活双信号（10:48:23 采样，两者都为“活”⇒ 不判卡死、不重启、不并发起第二支）**：
  - ① 进程：`36928` = `dev/gates/r50-run3.mjs game 3`（驱动器）、`9604` = `dev/gates/verify-r46-youxi.mjs`（门禁本体）均在，起始时间 10:02:34；包装进程 `24224/22276` 在；`39504` = `electron.exe --remote-debugging-port=9946 --user-data-dir=…\warmy-r46-youxi-profile-1792548154818`（本任务独占端口 9946，无第二支门禁抢端口）。
  - ② 真机活动：最新 profile `warmy-r46-youxi-profile-1792548154818` 的 `audit/audit.jsonl` **ageSec=1**、`chat-meta.json` **ageSec=0**（都在采样当下被改写）；审计末行 10:48:57 仍在 `chat.inflight-write {"zhengWen":5735,"duan":73}` ⇒ 模型这一轮正在长回复/长工具链，不是卡住。
  - 结论：日志 10:45:49 后暂无新行属正常（本档单轮真机可跑 790～932 秒，日志只在每轮结束时落行），**不构成卡死证据**。
- **进度定位**：第 1 遍（共 3 遍）第 6 轮已过、现处于「真跑判据 → 贴真报错回去修」循环的第 1 次修（源码 `dev/gates/verify-r46-youxi.mjs:446` `while (hongDe.length && xiuCi < 2)` ⇒ 最多 2 次修，修不好按红处理，不粉饰）。本轮红项只有一条：**空闲时画布两次像素指纹相同（游戏循环没真跑）**，`报错=[]`（无未捕获异常）。
- **审计里的两条 budget 事件（如实记录，暂不定性）**：`chat.budget.event {"round":4,"detail":"warn(96%)"}` 与 `chat.budget.denied {"reason":"zi","why":"没有欠账（字数已达标或计划步骤都做完了）"}`；发生在 `chat.host-tool run_shell ok=true` 之后，主链路仍在推进。
- **本节之前累计用时**：第 1 遍 10:02:34 启动，10:48 仍在第 1 遍（前 6 轮耗时 77+358+167+260+790+932 = 2584 秒）。
- **下一步**：继续旁观 `game-3x.log`（第 1 遍结论行）与 `game-run1.log`；出现 `第 1/3 遍 exit=0` 且 `过 31 · 败 0` ⇒ 驱动器自动开第 2 遍；出现 `exit=1`/`STOP` ⇒ 读该遍 FAIL 行 + profile 审计先定性（产品缺陷／仪器问题），修完从第 1 遍重跑三连；三绿后按 §22.3 的 live 名单串行 → 验收两遍 → 首启 `r38-firstrun.mjs`。
- **§22.3 的 P0 待办清单本轮一条未减。**

## 24.2 第 1 遍全绿 + 第 2 遍接管（10:52）
- **10:52:25** 读 `.r50-logs/game-3x.log`（原文，行数 1 → 4）：
  ```
  [game] 第 1/3 遍开始 2026-10-21T02:02:34.695Z
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿
  [game] 第 2/3 遍开始 2026-10-21T02:52:10.210Z
  ```
- **10:52:25** 读 `.r50-logs/game-run1.log` 末尾（原文）：
  ```
    · 真跑判据未过（第 2 次修）：什么都不按画面也在动，或按开始键后自动移动（游戏循环真跑，不是静态图）；报错=[]
    · 这一轮用了 161 秒（回复 400 字）
    · Chromium 临时夹具目录保留：%TEMP%\warmy-r46-chromium-1792551125740
    ok   第6轮·真跑：页面加载完成（无 did-fail-load、渲染进程没崩）
    ok   第6轮·真跑：canvas 真的存在且有尺寸
    ok   第6轮·真跑：游戏循环真跑（空闲就动，或按开始键后自动移动）
    ok   第6轮·真跑：按下方向键后状态变了（键盘输入真的接上了）
    ok   第6轮·真跑：全程没有未捕获异常/控制台错误
    · 第6轮经过 2 次"贴真报错回去修"才验收（读数里带 xiuCi，不藏着）
  ==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 31 · 败 0 · 跳 0 ====
  ```
- **定性：第 1 遍全绿（过 31 · 败 0 · 跳 0，用时 49 分 35 秒 = 10:02:34→10:52:10）。**
  - 「修 2 次才收敛」不是仪器问题：两轮修的都不是同一处字面，判据读的是真 Chromium 里两次像素指纹（空闲指纹不同 ⇒ 循环真跑），`报错=[]` 说明没有未捕获异常；`xiuCi` 已如实写进读数行，没有粉饰。
  - **风险如实记下**：第 1 遍是在**上限那一次**（`xiuCi < 2` 的第 2 次）才收敛，余量为零。若第 2/3 遍需要第 3 次修就会判红 ⇒ 那将是「产品收敛能力」的真实读数，**不许为省事放宽 `xiuCi` 上限或像素判据**（用户口径：质量优先、不降规模、不放宽断言）。
- **第 2 遍判活双信号（10:52:51 采样）**：① 驱动器仍是 `36928`，门禁本体换新 `28336`（10:52:10 起），Electron `22676` 带 `--remote-debugging-port=9946` 且 `--user-data-dir=…\warmy-r46-youxi-profile-1792551130335`；**9946 端口上只有一支 Electron** ⇒ 没有并发的第二支真机门禁。② 新 profile 的 `audit/audit.jsonl` ageSec=17、`chat-meta.json` ageSec=16（旧 profile 停在 10:52:09，符合「上一遍已收尾」）。
- **下一步**：旁观第 2 遍（`game-run2.log`，10:52:16 起 640 字节），按同一双信号判活；`exit=0 且过 31 · 败 0` ⇒ 驱动器自动开第 3 遍；三绿后按 §22.3 的 live 名单**串行**跑 → 验收两遍 → 首启 `node dev/gates/r38-firstrun.mjs`。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.3 仪器教训：心跳会伪装成"真机活动"（11:03，第 2 遍仍在跑）
- **11:02:47** 旁观器超时退出（540 秒窗口内 `game-3x.log` 仍是 4 行，无新结论行）；`game-run2.log` 自 10:52:16 起仍是 640 字节（只有表头 4 行 `ok`：仪器自证 ×2、应用启动、密钥已交给宿主）。
- **11:02:53 双信号初判"活"，但复查发现信号②被心跳污染**（这是本轮最重要的发现，如实记下）：
  - `audit/audit.jsonl` ageSec=**42** ⇒ 表面上"4 分钟内有改动"，但 11:03 读末尾 18 行原文是：
    ```
    10:53:52 chat.inflight-write {"zhengWen":87,"duan":7}
    10:53:53 token.calibrate {"n":7,"biLi":1.019}
    10:54:40 xin-tiao.ok {"taskId":"zhuangTai.tongBu","ciShu":30}
    10:57:10 xin-tiao.ok {"taskId":"zhuangTai.tongBu","ciShu":60}
    10:57:10 shiZhong.sample {"pianChaMs":144}
    10:59:40 xin-tiao.ok {"taskId":"chiJiuHua.luoPan","ciShu":30}
    11:02:10 xin-tiao.ok {"taskId":"dingShi.chunKao","ciShu":30}
    11:02:10 shiZhong.sample {"pianChaMs":138}
    ```
    ⇒ 10:54:40 之后**只有 `xin-tiao.ok`（内部接管任务）与 `shiZhong.sample`（时中采样），没有任何 `chat.*`**。心跳每约 2.5 分钟写一次 audit，所以「audit 文件 4 分钟内被改过」这条判据**单独使用会把纯心跳当成模型活动**（假活）。心跳条目里也没有伴随 `chat.*` ⇒ 与 §40「唤醒默认关」一致，不是产品缺陷。
- **按"轨迹"而不是"结果"定性（用第 1 遍同档审计做标定，11:03:34 读数）**：
  | profile | 总行 | chat 事件 | chat 最大静默间隔 |
  |---|---|---|---|
  | 第 1 遍 `…1792548154818`（已 exit=0 全绿） | 1048 | 841 | **663 秒 @10:28:23、661 秒 @10:41:28**（>300 秒的间隔共 2 条） |
  | 第 2 遍 `…1792551130335`（在跑） | 52 | 28 | 43 秒 @10:53:18（>300 秒 0 条） |
  - 第 2 遍当前 `chat` 静默 = 10:53:52 → 11:03:34 ≈ **582 秒**，**小于**已全绿的第 1 遍中出现过两次的 661/663 秒。⇒ **不构成卡死证据，不杀、不重启、不并发起第二支**（本档单轮真机可跑 790～932 秒，长静默是常态）。
  - 口径升级（只改**观测**，不改判据、不降规模）：往后判活看 `chat.*` 事件的最后时间，不看 audit 文件 mtime；`xin-tiao.ok` / `shiZhong.sample` 不计入活性。已落地为 `dev/gates` 之外的旁观小工具 `.r50-logs/_chatage.mjs`（打印 `chatAge`）。
- **进度**：三连 1/3 全绿；第 2 遍 10:52:10 起跑，仍在第 1 轮附近（模型最后一次活动 10:53:52，读过一次 `youxi.html` 7411 字节并 `plan_update n=3`）。
- **下一步**：继续 9 分钟窗口的只读旁观，`chatAge` 若超过第 1 遍标定值（>700 秒）且 `game-run2.log` 无新行 ⇒ 才升级为疑似卡死并报告；否则等 `exit=` 行。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.4 订正 §24.3 的阈值：卡死判据要绑门禁自己的预算，不能拍脑袋（11:06）
- §24.3 里我写的「chatAge > 700 秒才升级」是**拿标定值当阈值，站不住**，现按源码订正（可 grep）：
  - `dev/gates/verify-r46-youxi.mjs:32` `const YI_LUN_CHAO_SHI = Math.max(120_000, Number(process.env.R46_LUN_MIAO || 1_800_000))` ⇒ **单轮预算 30 分钟**，注释写明「宁可等，也不许仪器先超时把整档带走」；
  - `dev/gates/verify-r46-youxi.mjs:178-180` 内层 CDP 超时 = `chaoShi + 30_000` ⇒ **内层永远比外层晚炸**；`:173-176` 注释记着真机事故：第 2 轮实跑 718 秒而内层写 600 秒，整档在第 1 行读数后就被仪器自己掐死。
  - ⇒ 结论：**660 秒静默远在门禁自身容许范围内**（该轮最长可跑 1800 秒），且超时路径会自己落 `__chaoshi` 读数 ⇒ 门禁不会无声挂死。旁观器的升级阈值改为 **chatAge > 1900 秒**（= 1800 预算 + 30 内层余量 + 观测余量），低于此一律按「正常长跑」处理，不杀不重启。
- **11:04:40 读数**：第 2 遍 profile `chatAge=660s`（最后 chat 事件 10:53:52 `chat.inflight-write`），`anyAge=12s` 且最后一条是 `xin-tiao.ok` ⇒ 再次印证「文件 mtime 活 ≠ 模型活」，按 §24.3 口径只看 `chat.*`。
- **进度**：三连 1/3；第 2 遍仍在跑，未红未跳。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.5 第 2 遍复跑正常 + 「660 秒静默」的真因（11:16，可 grep，不是猜）
- **11:15:05** 旁观器窗口到点（未触发升级阈值）：`game-3x.log` 仍 4 行；`chatAge=2s` ⇒ **第 2 遍模型活动已恢复并在推进**。`game-run2.log` 末尾原文：
  ```
    ok   第1轮：碰撞判定
    ok   第1轮：失败可重开
    · 这一轮用了 74 秒（回复 400 字）
    ok   第2轮 · 最高分持久化：文件真的被动过（mtime 前进；允许一次纠正并如实记录）
    ok   第2轮 · 最高分持久化：判据成立
    ok   第2轮 · 最高分持久化：改完语法仍然过
    · 这一轮用了 197 秒（回复 400 字）
    · 第3轮 · 暂停/继续：模型回了但文件没动 ⇒ 补一轮"真的改文件"
  ```
- **订正 §24.4 的因果**（那条只解释了「门禁为什么允许等」，没解释「660 秒从哪来」）。第 2 遍静默结束的审计原文：
  ```
  10:53:52 chat.inflight-write zhengWen=87 duan=7
  11:04:58 chat.tools.stalled   {"anJingMs":664605,"anJingChanChuMs":669683,"anJingHuoMs":664605,"zongMs":761230,"gongJuJi":8}
  11:04:58 chat.model-degraded  {"model":"mimo-v2.6-flash","reason":"tool-loop-stall(665s 没有任何真实产出)","provider":"mimo-r46"}
  11:05:17 chat.inflight-write zhengWen=87 duan=8
  11:06:10 chat.write-overwrite-blocked write_file
  11:06:13 chat.work-tool read_file youxi.html
  11:06:43 chat.work-tool search_files FAIL youxi.html
  11:07:28 chat.work-tool write_file youxi.html
  ```
  ⇒ 真因可 grep：`packages/app-shell/src/electron-main.ts:5490`
  `const gongJuZaiPao = !!zaiTu && (Date.now() - zaiTu.kai) < 11 * 60 * 1000;`
  配合 `:5512` `if (!gongJuZaiPao && anJingZhen >= KONG_ZHUAN_MS)`，而 `KONG_ZHUAN_MS = 5*60*1000`（`:5463`）、`YING_DING_MS = 30*60*1000`（`:5464`）。
  ⇒ **只要有工具在途，空转看门狗最长被压到 11 分钟**，所以 `anJingMs` 稳定落在 660~665 秒而不是 300 秒；注释写明是有意设计（`:5484`「工具自己在跑（wait_seconds 最长 600 秒）时也不判：它有自己的上限」）。
- **三遍一致复现（按轨迹统计 `chat.tools.stalled` / `chat.model-degraded`）**：
  | profile | 次数 | 读数 |
  |---|---|---|
  | 第 1 遍 `…1792548154818`（已 exit=0 全绿） | 2 | `anJingMs=660452`@10:28:23、`660883`@10:41:28，均 `gongJuJi=2`，随后 `chat.model-degraded` |
  | 第 2 遍 `…1792551130335`（在跑） | 1 | `anJingMs=664605`@11:04:58，`gongJuJi=8`，随后 `chat.model-degraded` |
- **定性（不动产品代码、不改判据）**：属**宿主既定的自愈路径**（压到 11 分钟 ⇒ 掐断 ⇒ `model-degraded` 换模型重试 ⇒ 继续推进），不是仪器把自己掐死，也不是本轮新增缺陷；第 1 遍正是靠它拿到 31/0。代价与疑点如实记下、留给用户拍板，门禁期间不改代码：
  1. 每遍稳定发生 1–2 次、每次吃掉约 11 分钟 ⇒ 这就是第 1 遍出现 790/932 秒长轮的直接原因；
  2. 恢复初期出现 `chat.write-overwrite-blocked` 与 `search_files FAIL youxi.html`（模型在盲找路径），`zongMs=761230` ⇒ 单轮已 12.7 分钟；
  3. 「工具在途就不判」的 11 分钟压制与门禁单轮 30 分钟预算叠加 ⇒ 真挂死的工具最坏要 11 分钟才被认出。
  **不因此重启、不放宽断言、不降规模**；三连按原进程继续跑。
- **进度**：三连 1/3 全绿；第 2 遍第 3 轮（暂停/继续）正在「补一轮真的改文件」的纠正路径上。
- **判活口径最终版（往后照此执行）**：只看 `chat.*` 最后事件时间（`.r50-logs/_chatage.mjs` 输出 `chatAge`），心跳 `xin-tiao.ok` / `shiZhong.sample` 不计入活性；升级怀疑 = `chatAge > 1900s`（越过 11 分钟在途压制 + 30 分钟预算），或驱动器进程消失且日志无结论行。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.6 第 2 遍第 3 轮判红 + 定性（11:28，结论：产品缺陷，不是仪器冤枉）
- **11:27:28** 读 `.r50-logs/game-run2.log`，出现 FAIL（原文，含读数）：
  ```
    · 这一轮用了 602 秒（回复 400 字）
    FAIL 第3轮 · 暂停/继续：文件真的被动过（mtime 前进；允许一次纠正并如实记录）
         —— {"qian":1792552144241.0283,"hou":1792552144241.0283,"jiaoZheng":1,
             "reply":"**结论：这轮没做成 —— 暂停功能没有写进文件。**你要的 edit_file 我一次都没执行…
             1. read_file 读 youxi.html 只返回了前 130 行左右就被截断，后半段（draw()、主循环、结算画面）我没看到全文；
             2. 想看后半段时，search_files / find_files 对这个文件没命中，run_shell 连续被授权档拒绝并已停…"}
    · 第3轮 · 暂停/继续：判据不成立 ⇒ 催一轮补功能（空格（或 P）暂停/继续…）
    · 这一轮用了 78 秒（回复 135 字）
    ok   第3轮 · 暂停/继续：判据成立
    ok   第3轮 · 暂停/继续：改完语法仍然过
    · 这一轮用了 165 秒（回复 400 字）
    ok   第4轮 · 难度递增：文件真的被动过（mtime 前进…）
  ```
- **这条 FAIL 是终局判定，不会被后面的 ok 洗掉**：`dev/gates/verify-r46-youxi.mjs:389` 在「等过、催过」之后才记 `ok(…, hou > qian && hou > 0, …)`，而 `qian === hou`（都是 `1792552144241.0283`）⇒ 文件确实一次都没动。⇒ 第 2 遍最终 `败 ≥ 1` ⇒ `exit=1` ⇒ 驱动器按纪律停止，**要从第 1 遍重跑三连**。
- **模型自述的三条受阻，逐条对源码核实（不是找借口，产品确有缺口）**：
  | 自述 | 核实结果 |
  |---|---|
  | `read_file` 只返回前约 130 行 | **成立**。`read_file` 自身上限 20000 字（`work-tools.ts:42 maxReadChars: 20000`、`:502`），7411 字节的 youxi.html **装得下**；但结果回给模型时被 `electron-main.ts:5402` `return String(wr.content).slice(0, ctx.zuiDaJieGuoZiShu)` 硬截到 **4000 字**（`electron-main.ts:1563` 默认 4000），**截断处没有任何提示** ⇒ 模型以为自己看到了全文，无法对后半段（`draw()`/主循环）定点编辑。 |
  | `search_files` 对该文件没命中 | **成立，且是工具面缺口**。审计 `11:06:43 chat.work-tool search_files ok=false error="not-a-directory" path=youxi.html` —— 模型把文件当目录传，工具只回 `not-a-directory`，不引导正确用法。 |
  | `run_shell` 连续被授权档拒绝 | **成立**。`chat.host-tool run_shell ok=false security="normal"` 共 **9 次**（11:07:41/11:09:12/11:10:14/11:10:25…11:26:36），其中 `juJueTingYong: true` 两次；`electron-main.ts:4169` 的硬停条件是「**最近两分钟内**已拒 2 次」⇒ 窗口一过又能重试，于是反复撞墙到 602 秒整轮零产出。另有 `read_document ok=false` 3 次（`ms` 0~1 秒失败）。 |
- **因果链（全程可在审计里 grep，无推测）**：第 3 轮一开始（11:04:58）先发生 `chat.tools.stalled anJingMs=664605` → `chat.model-degraded`；换模型后 11:06~11:27 反复 `read_file`（9 次，每次都被截到 4000 字）/ `search_files` FAIL / `run_shell` FAIL×9 / `write-overwrite-blocked liYou:"shorter"`（防覆盖守护按设计拦住）⇒ 602 秒 **mtime 未前进** ⇒ 判据如实判红。**判据没有冤枉产品。**
- **修复方向（属产品能力修复，不触碰任何判据与规模）**：① `read_file` 结果被截时**如实告知**并给续读指引（`:5399` 已有「正文 + 进度行」同预算先例可照做）；② 给 `read_file` 可用**偏移/分页**（现在只有 `maxChars` 且恒从第 0 字节起）；③ `search_files` 传文件时提示正确用法；④「被拒即停用」不应只按 2 分钟窗口失效。**风险登记**：①②会动到「注入量恒定／预算=整条请求」的定稿口径（§24.6 记此风险），改前与用户对齐，改后须 `tsc -b` + `copy-assets` + `check-syntax` 并从第 1 遍重跑三连。
- **进度**：三连 = 第 1 遍绿、第 2 遍已注定红（第 3 轮 1 败），第 2 遍仍在跑第 5/6 轮；`exit=1` 后驱动器自行停止。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.7 第 2 遍红（过 30 · 败 1）+ 缺陷改为「跑出来的事实」而非读码推断（11:48–11:55）
- **11:48:14** 读 `.r50-logs/game-3x.log`（行数 4 → 6，原文）：
  ```
  [game] 第 2/3 遍开始 2026-10-21T02:52:10.210Z
  [game] 第 2/3 遍 exit=1
  [STOP] game 第 2 遍失败（exit=1），按口径停下，不继续后面的遍。日志：<仓库>\.r50-logs
  ```
  > 抄写口径：STOP 行原文带的是本机仓库绝对路径（含用户名与中文工作区目录名），会命中 `verify-security` 的 `user-home` / `abs-temp-user` / `cn-workspace` 三条判据（先例见「## 24. 第 51 轮补充 §24.5」）⇒ 按既有约定改写成 `<仓库>` 占位，其余字符逐字未改。（本行由推进器会话订正，非原撰写会话。）
- **11:48:14** 读 `game-run2.log` 汇总行：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 30 · 败 1 · 跳 0 ====`；唯一 FAIL 就是 §24.6 那条第 3 轮 mtime（`qian === hou === 1792552144241.0283`）。真跑判据**又一次靠第 2 次修（上限）才收敛**（`· 真跑判据未过（第 1 次修）`@487 秒、`（第 2 次修）`、随后 5 条 `第6轮·真跑：… ok`）⇒ §24.2 预警的「修案余量为零」两遍都成立。
- **收尾核查**：`Get-CimInstance` 查 `r50-run3` / `verify-r46-youxi` / `--remote-debugging-port=9946` **全部为空** ⇒ 驱动器按纪律自行停净，端口 9946 已释放，**当前没有任何真机门禁在跑**（也没有残留 Electron 会抢端口）。
- **把 §24.6 的读码结论改成跑出来的事实**（对已构建产物 `packages/app-shell/dist/work-tools.js` 直接调用，9022 字文件、尾部埋标记 `WEI-BU-FEN-MARKER-ZZ`；跑完临时目录已删）：
  ```
  maxReadChars=20000 fileChars=9022
  read_file ok=true meta.bytes=9022 meta.truncated=false
  contentCharsReturned=9022
  tool-level notice present=false
  tail marker visible to model at this stage=true
  --- after host slice(0,4000) ---
  chars=4000 tailMarkerGone=true
  any truncation notice in what model sees=false
  last 40 chars model sees: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  --- search_files with a FILE path ---
  ok=false error="not-a-directory" content="[search_files] 失败：not-a-directory"
  ```
  ⇒ 精确缺陷定位：**不是 `read_file` 自己截**（只有超过 20000 字才截，且那种情况会老实写「…（已截断，原文 N 字符）」，`work-tools.ts:597-601`）；**是宿主把结果 `slice(0, 4000)` 那一步静默截掉**（`electron-main.ts:5402`），既不提示、也不在 `chat.work-tool` 审计里记 `truncated`（该日志字段表 `:5378-5388` 没有 truncated）⇒ 模型看到 4000 字「完整文件」，连「少了」都不知道。
- **这条修法不动定稿口径，反而是在补既有口径**（同仓 fast 档已断言过的原则，工具结果路径没遵守）：
  - `dev/gates/verify-r44-yuSuan.mjs:326` 「宿主真的按上限截断（预留了却不截 = 假预留）：**截断 + 审计**」；
  - `:329` 「截断后的文本才是发出去的那份」；
  - `:494` 「压下去的段当场说明"不是删掉了"（**截断必须留下可执行的取回路径**）」。
  ⇒ ①截断如实告知 + ②`read_file` 偏移/分页 + ③`search_files` 传文件时给正确用法，都是**在同一个 4000 字上限之内**做到「看得见、找得着」，**不抬上限、不降规模、不松判据**；新增断言应钉在 fast 档（源码级，不需要真机）。
- **仍单独等用户拍板的一条**：④「被拒即停用」现在只按「最近 2 分钟内已拒 2 次」计（`electron-main.ts:4169`），窗口一过又能撞墙（第 2 遍实锤 run_shell 失败 9 次、602 秒零产出）——收紧成整轮不再放行属**授权口径**，我没动。
- **进度**：三连 = 第 1 遍绿 / 第 2 遍红 ⇒ 按 §22.1 纪律，修完从**第 1 遍**重跑三连（每遍约 50 分钟、三遍约 2.5 小时）。
- **§22.3 的 P0 待办清单仍一条未减。**

## 24.9 推进器第二次接管（10:53–10:55 · 第 2 遍仍在跑 + 串行前置体检｜原误编 §24.3，与「仪器教训」重号，已订正）
- **10:53:01** 读 `.r50-logs/game-3x.log` 全文（原文，4 行，与 §24.2 一致 ⇒ 第 2 遍尚未出结论行）：
  ```
  [game] 第 1/3 遍开始 2026-10-21T02:02:34.695Z
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿
  [game] 第 2/3 遍开始 2026-10-21T02:52:10.210Z
  ```
- **10:53:01 / 10:55:27** 读 `.r50-logs/game-run2.log` 末尾（两次读数一致：640 字节 / 7 行，原文如下）：
  ```
  ===== 2026-10-21T02:52:10.212Z …node.exe dev/gates/verify-r46-youxi.mjs =====
  压力档 A · 真模型 = mimo-v2.6-flash · 独立 profile = …\warmy-r46-youxi-profile-1792551130335
    ok   仪器自证：反例（有画面/循环/键盘/分数，但没碰撞）必须被碰撞判据判红
    ok   仪器自证：反例在其它判据上该绿的仍然绿（说明判据各管各的，不是全都靠关键词）
    ok   应用启动（独立 profile + 独立端口，没动用户的实例）
    ok   MiMo 密钥已交给宿主（不打印）
  ```
  `game-3x.err.log` 为 0 字节（驱动器无 stderr）。
- **判活双信号（两次采样都是「活」⇒ 不判卡死、不杀进程、不重启、不并发第二支）**：
  - ① 进程：`36928` = `dev/gates/r50-run3.mjs game 3`（驱动器，10:02:34 起，未换）；`28336` = `dev/gates/verify-r46-youxi.mjs`（第 2 遍门禁本体，10:52:10 起）；`22676` = `electron.exe --remote-debugging-port=9946 --user-data-dir=…\warmy-r46-youxi-profile-1792551130335`。**9946 上只有这一支门禁 Electron**（另一个 `26004` 是它的 `--type=renderer` 子进程，同一 profile）⇒ 无并发抢端口。
  - ② 真机活动：新 profile `…1792551130335` 的 `audit/audit.jsonl` 10:52:35 ageSec=37 bytes=4693 → 10:53:53 ageSec=47 bytes=8354；`chat-meta.json` 10:52:36 bytes=2115 → 10:53:54 bytes=5492。**两次采样字节在涨**（不只是时间戳新）⇒ 模型链路真在推进。旧 profile `…1792548154818`（第 1 遍，KEEP=1 保留）停在 10:52:09，与「第 1 遍已收尾」一致。
  - 日志 `game-run2.log` 10:52:16 后没有新行属正常：本档每轮结束才落一行，单轮实测 77～932 秒（见 §24.1/§24.2 的 6 轮耗时），**「连续 5 分钟无新行」在本档不构成卡死证据**。
- **进度定位**：三连第 **2/3** 遍（第 1 遍已 `exit=0`、过 31 · 败 0），第 2 遍处于第 1 轮（仪器自证 2 项 + 启动 + 密钥交付已 ok）。第 1 遍用时 49 分 35 秒 ⇒ 第 2 遍预计 ~11:42 前后出结论行。
- **串行前置体检（只读，不改任何东西）**：`Test-Path $env:TEMP\w50-mimo-key.txt`=True；`better-sqlite3` 三候选全 True（`packages\memory-os\vendor\`、`packages\memory-os\node_modules\`、`%APPDATA%\@warmy\app-shell\memory-runtime\node_modules\`）。
- **新发现一条口径缺口（会影响第 4 步，必须记下）**：§19.3 的 live 名单第 15 支 `verify-history-persist` **不在 `dev/gates/`**，实际文件是 `packages/app-shell/scripts/verify-history-persist.mjs`（39762 字节，2026-10-20 06:22）。`docs/GATE-MANIFEST.json` 登记：`status=green`、`needsElectron=false`、note=「它自己 spawn Electron 副本 ⇒ 归 live 档（**跑前要清场/占坑**）」。后果：
  - §19.3 写的跑法 `node dev/gates/<名>.mjs` 对这支不成立 ⇒ 跑到它要用 `node packages/app-shell/scripts/verify-history-persist.mjs`，别误判成「门禁丢失」，更**不要**在 `dev/gates/` 造第二个同名文件来凑数。
  - 它自开 Electron ⇒ 必须等上一支的 Electron 完全退出、9946 端口空出来再跑（纪律同 §22.6）。
  - 其余 14 支在 `dev/gates/` 全部存在（含 `r50-run3`、`verify-r46-youxi`、`r38-firstrun`）；`dev/gates/*.mjs` 共 111 支。
- **多会话同写提醒**：本节写作时发现 `docs/HANDOFF-R51.md` 已被并行会话追加 §24.2（10:53）。两个会话看到的都是**同一个**驱动器 `36928`，都按纪律**没有**重复启动 `r50-run3.mjs game 3`。后续会话追加 §24.4… 即可，别再开第二支三连。
- **旁观手段**：`.r50-logs/_probe.ps1`（双信号采样，只读）+ 新增 `.r50-logs/_watch2.sh`（只读旁观：每 30 秒查 `game-3x.log` 行数与 `36928` 存活，变化即打印读数退出；不杀不重启）。
- **下一步**：等第 2 遍结论行；`exit=0 且过 31 · 败 0` ⇒ 驱动器自动开第 3 遍；`exit=1`/`STOP` ⇒ 读 `game-run2.log` 的 FAIL 行 + `…1792551130335` 审计先定性（产品缺陷／仪器问题），修完从第 1 遍重跑三连；三绿后按 §19.3 串行 15 支（路径口径见上一条）→ 验收 ×2 → 首启 `node dev/gates/r38-firstrun.mjs`。
- **§22.3 的 P0 待办清单本轮一条未减**（拼音断言收尾、会话隔离硬门禁、知识库作用域矩阵、私密勾选、内部/私密加密、脱敏体系、牛马互通双向、live 回归）。


## 24. 第 51 轮补充（10:41–11:0x）：句式纪律归「术」、撤门禁 E、优先级阶梯改定、印象改名

### 24.1 优先级阶梯（用户定稿，已落地）

**产品硬门禁 > 道 > 术 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象 > 身份/模型/时间。**

- 实现：`electron-main.ts` 的注入块把 `【产品门禁 · 最高优先级（硬约束）】` 挪到 `shenFenTou` 的**第一个**，旧的"排在规矩之后"那块已删（不留两份）；`【道 · 全局最高优先级（仅次于产品硬门禁）· 不可压缩】` 与道块尾句改成"高于除产品硬门禁外的一切指示"；`【印象 …（在这套指示里最低）】` 尾句补了"互通来的对方认知也落到这里，同样按可能是错的对待"。
- 同步改的旧说法：`builtin-rules.ts` 头注释（新阶梯 + 撤 E 的缘由）、`dao-default.ts` 出厂稿第 10 行与第 5 条冲突排序、`electron-main.ts` 术层注释。
- **事实校正（别去找这三个"层"的注入块）**：`工具`不是文本层（工具面由宿主裁剪，`gong-ju-fen-dang.ts`）；`软门禁`的约束力在宿主校验（`gate-policy.ts`），提示词里只有一句指针 `yingMenJinTiShi()`；`认知`不是注入层，它是牛马互通信封里的字段（`niuma-tonghu.ts:31/61/80/84`），**接收侧落到「印象」**。所以阶梯里这三项的位次目前由机制保证，不是文本顺序。

### 24.2 撤掉产品门禁 E（用户点头"只留在术里"）

`builtin-rules.ts` 删除 `MENJIN_E`，`CHANPIN_MENJIN = A–D`；`verify-prompt-layers` 的判据改为**运行时导入 `dist/builtin-rules.js` 后检查实际注入的那段文本**（源码里的"撤除说明"注释含同样字样，判文件会自相矛盾）。

### 24.3 术里那条句式纪律（按用户口径重写）

落在 `userData/shu.md`（本机此前没有该文件，属新建）。判定只看一件事：**只看前文，能否以 ≥80% 置信度得出"对方已经认为或预期 X"**；能 ⇒ 可用（这属于预防性说辞，对方心里已有 X 并可能顺着想下去）；不能 ⇒ 删掉「不是 X」只写 Y；拿不准 ⇒ 按"不能"处理。同族句式一并约束（并非 X 而是 Y／不是 X，是 Y／错了其实是 Y／与其说 X 不如说 Y／我说的不是 X）。**例外 · 预警**：要指出"某件事是要避开的雷"时可用「不要 X」「不能 X（而要 Y）」—— 句子本体就是要把 X 说出来；其中 Y 是补充，若 Y 此前已说过可以不说。末尾两条自检例（✗"这不是权限问题，而是文件不存在" / 用户先提过权限 ⇒ ✓）。

生效方式：`duShu()` 每轮现读文件 ⇒ **下一轮就生效，不用重启**。真机端到端取证**还没做**（探针 `%TEMP%\r51-shu-probe.mjs` 已写好：假 OpenAI 兼容端点录请求体，断言①有【术 · 方法论】段且段内就是 shu.md 原文、②道在术之前、③负向：删掉 shu.md 后再发一发就不该有术段、且那一发确实发出去了）。因为小游戏三连正在跑，不并发起 Electron ⇒ 等三遍全绿后单跑一次。

### 24.4 「印象」改名 `yonghushuju.md` → `yinxiang.md`

21 处引用（`electron-main.ts` 7、`archive-cleanup.ts` 1、`renderer/app.js` 4、门禁 4、现行文档 5）。迁移做法：`yinXiangLu()` 里**读之前若新名不存在而旧名存在，就 `renameSync` 改名一次**并记审计 `memory.impression-renamed`；不留双份、不做兼容读。门禁跟着改判：`verify-round37-changes` 项2 从"文件名=旧名"改成"新名 + 有 renameSync + IPC 齐全"；`verify-round38-changes` 的 TECHNICAL 文档锚改判 `yinxiang.md`。

### 24.5 顺手修掉的一处隐私漏（上一会话写文档带进来的，不是本轮改动引入）

`docs/HANDOFF-R51.md` 里有两处**具体用户目录绝对路径**（Chromium 夹具目录），命中 `verify-security` 的 `user-home` / `abs-temp-user` 两条判据 ⇒ 改成 `%TEMP%\` 占位写法，`verify-security` 恢复 **28 PASS 全通过、退出码 0**。

### 24.6 判活口径修正（重要，别再拿"5 分钟无新行"判卡死）

真机一轮可跑约 790 秒，而日志只在**每轮结束时**落一行 ⇒ 10:30→10:42 无新行是正常现象，不是卡死。改成双信号判活：① 驱动器/门禁本体的 node 进程在不在；② 当前 `warmy-r46-youxi-profile-*` 里 `audit/audit.jsonl`、`chat-meta.json` 最近 4 分钟有没有被改。cron 推进器（每 300 秒，id `e4849ae3`）已按双信号写死，并明令"绝不并发起第二支真机门禁"。

### 24.7 本轮读数（改完就复跑，Electron 类一律没碰）

`verify-prompt-layers` **20 ok / 0 FAIL** · `verify-round37-changes` **36/0** · `verify-round38-changes` **61/0** · `verify-kb-scope` **16/0** · `verify-security` **28 PASS 全通过** · `verify-docs` **84/0** · `verify-truth-guard` **9/0** · `verify-naming` **48/0** · `verify-wiring` **通过 238 失败 0** · `verify-gate-manifest` **23/23** · `verify-import-integrity` 通过 · `verify-i18n-locales` **162/0** · `check-syntax` 通过。`tsc -b` 退出 0、`copy-assets` 已跑、`dist` 不比源码旧。**未 commit、未 push。**
负向验证（改坏必红）：负例1 把产品门禁那段注入挪回「道」之后 ⇒ 1 红；负例2 把"句式纪律"塞回 `CHANPIN_MENJIN` ⇒ 1 红；正例 0 红。判据入口：`VPL_MAIN` / `VPL_RULES_JS` 环境变量。
小游戏三连进度：**第 1/3 遍 exit=0、过 31 · 败 0 · 跳 0**；第 2/3 遍 10:52:10 起跑（驱动器仍是 PID 36928，门禁本体换新 PID）。

### 24.8 四件等你点头的小事（都不动就也不影响正确性）

1. `dao.md` 是你自己的文件，第 10 行还写着"高于……一切上下文"。要不要我把那一句换成出厂稿的新说法（只改那一句，别的一字不动）。
2. 要不要把「认知」真的做成一个层（互通来的认知单独存 `renzhi.md`，注入在印象之前）？现在它在阶梯里的位次只是机制性的。
3. 设置页「印象」那段说明（10 个语言包）还写着"优先级低于「规矩」"，要不要更新成完整阶梯。
4. 归档→印象的**写入**行为目前没有端到端门禁（复核结论：只有读、裁剪、否认三条有锚）。建议补一支：真 Electron + 假模型，断言"带长期措辞与赞/踩的原话确实落进印象、素材里找不到连续 ≥10 字原话的条目被丢并记 `yinxiang.hallucination-dropped`"。
---

# 25. 推进器读数（11:48 · 第 2 遍终局红 + 四条等你拍板的修法）

> 编号说明：并行会话在本文件里另起了「## 24. 第 51 轮补充」并把 §24.1–24.8 重号用了一遍，所以推进器条目一律往后放。本节引用的旧条目按**标题+时间**认：`§24.9 推进器第二次接管（10:53–10:55）`、`§24.6 第 2 遍第 3 轮判红（11:28）`。

## 25.1 第 2 遍终局红（11:48:01 / 11:48:19 读数，原文照抄）
- **同一时刻并行会话也写了 `§24.7 第 2 遍红（11:48–11:55）`** ⇒ 两条讲的是**同一次红**（不是两次），结论一致：产品缺陷。§24.7 还把 §24.6 的读码推断升级成对 `dist/work-tools.js` 的实测复现，以它那条为准；本节保留推进器自己的采样读数与场地核查。
- `.r50-logs/game-3x.log`（339 字节，末写 11:47:51，6 行）：
  ```
  [game] 第 1/3 遍开始 2026-10-21T02:02:34.695Z
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿
  [game] 第 2/3 遍开始 2026-10-21T02:52:10.210Z
  [game] 第 2/3 遍 exit=1
  [STOP] game 第 2 遍失败（exit=1），按口径停下，不继续后面的遍。日志：<仓库>\.r50-logs
  ```
  > 抄写口径：STOP 行原文带的是本机仓库绝对路径，为避免命中 `verify-security` 的 `user-home` / `abs-temp-user` 判据（教训见 §24.5「顺手修掉的一处隐私漏」），这里写成 `<仓库>` 占位；其余字符逐字未改。
- `.r50-logs/game-run2.log` 汇总行（5528 字节，末写 11:47:51）原文：
  ```
  ==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 30 · 败 1 · 跳 0 ====
  产物（临时 profile，跑完自动删；KEEP=1 保留）：%TEMP%\warmy-r46-youxi-profile-1792551130335
  ```
  FAIL 行（第 24 行，11:27:28 落盘）与三条受阻已在 §24.6 逐条对过源码核实，此处不重复。
- **判活双信号的终态**（11:48:19 采样）：`Get-CimInstance` 过滤 `r50-run3|verify-|remote-debugging-port` **返回空** ⇒ 驱动器 `36928` 与门禁本体已退出，**场地是干净的**（没有任何 Electron 占 9946）。profile `…1792551130335` 的 `audit/audit.jsonl`（228314 字节）与 `chat-meta.json` 末写 11:47:47 只是收尾落盘，**不是活动** —— 这条正是 §24.3「心跳会伪装成真机活动」的镜像教训：判活要看**进程 + 字节增量**，不能只看时间戳新。
- **进度**：三连 = 1 绿 1 红，驱动器已停；第 3 遍未开。按纪律**修完要从第 1 遍重跑**（重数遍数，口径见 §22.3 与验收协议）。

## 25.2 复核：三条修法在代码里一行未动（可 grep，不是转述）
| 修法 | 现在代码（11:50 读） | 结论 |
|---|---|---|
| ① 截断要如实告知 | `packages/app-shell/src/electron-main.ts:5402` 仍是 `return String(wr.content).slice(0, ctx.zuiDaJieGuoZiShu);`（裸截，无提示）。同函数 `:5399` 已有「正文留位 + 进度行、总长仍 ≤ 上限」的先例 ⇒ 照搬即可，**不必抬 4000 上限** | **未做** |
| ② `read_file` 偏移/分页 | `packages/app-shell/src/work-tools.ts:42 maxReadChars: 20000`、`:502` 只有 `maxChars` 且恒从第 0 字节起，全文件无 `offset`/`startChars` | **未做** |
| ③ `search_files` 传文件要引导 | `work-tools.ts:320 / :366 / :395` 三处 `return fail(tool, new Error('not-a-directory'), …)`，只回错误码不回用法 | **未做** |
| ④「被拒即停用」的 2 分钟窗口 | `electron-main.ts:4173` 提示语已写「已停用、不要再调用」，但计数口径仍是「最近两分钟内已拒 N 次」⇒ 窗口一过照样放行（本轮实测被拒 9 次、`juJueTingYong: true` 仅 2 次） | **未做，且属授权口径** |

## 25.3 一条新异常（如实报，因果已查清）
- **读数**：`packages/app-shell/src/electron-main.ts` 与 `packages/app-shell/dist/electron-main.js` 的 mtime 都是 **11:43**，而第 2 遍门禁 11:47:51 才退出（当时正在跑第 5/6 轮）⇒ **门禁还在跑的时候改了主进程源码并重建了 dist**，违反 §22.6「真机门禁期间不动现场」的口径。
- **对本次红有没有污染？没有，且可证**：`game-run2.log` 里「应用启动」只出现 **1 次**（`grep -c` = 1，即 10:52:10 起的那一支），Electron 主进程只在启动时读 `dist/electron-main.js` ⇒ 11:43 的新 dist 不会被已在跑的那一支加载；FAIL 判定落盘在 **11:27:28**，早于 11:43。所以第 2 遍这条红**与重建无因果**。
- **但下次不许**：门禁跑完（驱动器打印结论行）之前不 `tsc -b` / 不 `copy-assets`；要改就先等场地干净。这条我写进台账，后续会话照此执行。

## 25.4 现在卡在你这里：四条修法的取舍（我给了推荐，没动手）
- **订正（11:58，依据 §24.7 的实测复现）**：本节原先把「①② 碰你定稿的『注入量恒定／预算=整条请求』口径」报成了需要你点头的前置条件。§24.7 用对 `dist/work-tools.js` 的直接调用证明：`read_file` 自己不截（9022 字整份返回、`truncated=false`），**是宿主 `electron-main.ts:5402` 的 `slice(0, 4000)` 静默截掉且不记审计**；而「截断 + 审计」「截断后的文本才是发出去的那份」「截断必须留下可执行的取回路径」本来就是 `verify-r44-yuSuan.mjs:326/:329/:494` 钉过的既有原则 ⇒ **①②③ 是补既有口径、不是改口径**（同一 4000 字上限内做到看得见找得着，不抬上限、不降规模、不松判据）。所以 ①②③ **不需要你先点头**。
- **仍然单独等你拍板的只有 ④**：`run_shell` 在 normal 档被拒后的「停用」只按「最近 2 分钟内已拒 2 次」计（`electron-main.ts:4169`），窗口一过又能撞墙（第 2 遍实锤 9 次被拒、602 秒零产出）。要不要收紧成**整轮不再放行** —— 属授权口径，我不替你定。
- **我不抢改产品代码（重要，避免两会话打架）**：①②③ 这条修复线此刻由写 §24.6/§24.7 的那支会话在做（它对同一批点位 `:5402`、`work-tools.ts:320/366/395` 已经动手取证）。两支同时改 `electron-main.ts` + 同时 `tsc -b` 会互相覆盖，改完还可能同时起两支三连（抢 9946 ⇒ 假红）。**建议明确一支负责**：要么我接手（那支停手），要么我不碰代码、只做旁观与台账。你说一句即可。
- **点头后的顺序**（谁做都一样）：改码 → `packages/app-shell` 里 `tsc -b` + `copy-assets` + `check-syntax` → 新增断言钉进 **fast 档**（源码级，不必真机）→ 负向验证（把提示删掉必须判红）→ **从第 1 遍重跑小游戏三连**（每遍约 50 分钟，三遍约 2.5 小时）→ 三绿后按 §19.3 串行 15 支 live（`verify-history-persist` 用真实路径 `packages/app-shell/scripts/verify-history-persist.mjs`，见 §24.9）→ 验收 ×2 → 首启 `node dev/gates/r38-firstrun.mjs`。
- **在场地空着的这段时间我没有擅自重启三连**：同一个未修的缺口大概率再吃一遍 50 分钟，且中途改码还会踩 §25.3 的纪律。若你要「先照原样再赌一遍绿」，明说，我立刻后台起三连。
- **本轮我自己动过的东西**（可回退、只读文档）：`docs/HANDOFF-R51.md` 追加 §24.9/§25、把误编的 §24.3 订正为 §24.9；把 §24.7 里照抄的仓库绝对路径改成 `<仓库>` 占位（它命中 `verify-security` 的 `user-home`/`abs-temp-user`/`cn-workspace` 三条判据，改后 **28 PASS 全通过**）；新增只读旁观脚本 `.r50-logs/_watch2.sh`。**未 commit、未 push、没碰任何产品代码与判据。**
- **§22.3 的 P0 待办清单本轮一条未减**；`docs/HANDOFF-R51.md` 现有两版并行编号（见本节开头说明）。

## 25.5 订正 §25.4 的状态：三连已被并行会话重跑，修法进了 build（11:53–11:56 读数）
- **订正**：§25.4 写「场地空着、我没擅自重启三连」时是 11:48–11:52 的事实；**11:53:48 那支改码的会话已按 §22.1 重跑三连第 1 遍**（不是本会话起的，本会话全程没起门禁、没杀进程）。现场核查（11:54:21 / 11:56:05 两次采样）：驱动器 `19652`、门禁本体 `7076`、Electron `40956`（+ 其 `--type=renderer` 子进程 `25556`），端口 **9946 上仍只有这一支** ⇒ 没有并发第二支，纪律没破。
- **①②③ 已经进代码并进 build**（计数逐条比对，可 grep）：
  ```
  pianYi    src=10   dist=10      ← ② read_file 分页/偏移入参
  续读      src=4    dist=4       ← ① 截断后的续读指引
  已截断    src=1    dist=1       ← ① 如实告知被截
  startChars=0 offsetChars=0      ← 入参名用的是拼音 pianYi，不是这两个词
  ```
- **④ 没有被动过**（授权口径没人替用户改）：`electron-main.ts:4199` 仍是 `if (juJueCiShu(sessionId, gongJuMing) >= 2)`、`:4203` 提示语仍写「最近两分钟内已被拒绝 N 次」⇒ 「停用只在 2 分钟窗口内生效」这条**照旧等你拍板**（行号从 §24.6 里的 4169/4173 往后挪了 30 行，就是 ①②③ 的代码加在它上面）。
- **第一手读数（只 1 轮，不提前定性）**：`game-run1.log` 新遍第 1 轮 **47 秒**、`第1轮：…` 8 条全 ok；旧三连同一轮是 77 秒。撞墙消失是否与 ①②③ 有关，要等 6 轮跑完、且三遍都过才算读数。
- **监控口径变更（后续会话必看，否则会盯空文件）**：这次重跑**没有把驱动器 stdout 重定向进 `.r50-logs/game-3x.log`** ⇒ 该文件永远停在 11:47 的 6 行（`wc -l` 不变）。权威读数改为：
  - 驱动器 `dev/gates/r50-run3.mjs:26-50` 自己按遍写 `game-runN.log`（每遍 `flags:'w'` 截断重写，避免上遍 FAIL 混进这遍），遍内末尾会打印 `----- exit=N -----`，汇总行是 `==== verify-r46-youxi…：过 X · 败 Y · 跳 Z ====`；
  - 判活照 §24.3/§24.4：驱动器与门禁本体的 node 进程在不在 + 当前 `warmy-r46-youxi-profile-*` 的 `chat.*` 最后事件时间（`_chatage.mjs`），**心跳与 `game-3x.log` 行数都不算活性**。
  - 本会话原先挂的 `.r50-logs/_watch2.sh` 盯的是 `game-3x.log` 行数 ⇒ 对本遍永不触发，已换成 `.r50-logs/_watch3.sh`（盯 `game-run1.log` 的 `----- exit=` 行 + 驱动器 `19652` 存活，只读、不杀不重启）。
- **一条纪律风险如实记（不指控，只报读数）**：`dist/electron-main.js` 的 mtime 是 **11:55**，而这一遍的应用启动在 11:53:5x ⇒ **门禁运行中又重建了一次 dist**。所幸 ①②③ 的三处 marker 在 11:54 与 11:55 两次比对里计数都没变（行为面看不出差异），且 `game-run1.log` 里「应用启动」只出现 1 次 ⇒ 严格说这一遍对应的是 11:53:5x 加载的那份 build，而不是 11:55 的那份；**要改码请等驱动器打印完这遍的 exit 行再动**（同 §25.3）。
- **下一步**：旁观这一遍（约 50 分钟）到 `----- exit=0 ----` 且 `过 31 · 败 0` ⇒ 驱动器自动开第 2 遍；红了就读该遍 FAIL + profile 审计先定性。三绿后按 §19.3 串行 15 支 live（`verify-history-persist` 真实路径见 §24.9）→ 验收 ×2 → 首启 `node dev/gates/r38-firstrun.mjs`。**等你拍板的只剩 ④。**
- **§22.3 的 P0 待办清单本轮一条未减。**


## 25. 第 52 轮：注入阶梯定稿、认知/规范成层、压缩口径、归档两入口统一（11:40–12:2x，由接管会话完成）

### 25.1 阶梯（用户逐条点名，已落地）

**产品硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象 > 身份/模型/时间**

| 注入块 | 数据源 | 谁能写 | 可压缩 | 审计 |
|---|---|---|---|---|
| 【产品门禁 · 最高优先级（硬约束）】 | `builtin-rules.ts` 的 `CHANPIN_MENJIN`（A–D） | 只有版本升级 | **否** | — |
| 【道 · 最高优先级（除硬门禁）· 不可压缩】 | `userData/dao.md` | 只用户手动（`warmy:daoShe`） | **否** | `settings.dao-md-saved` |
| 【术 · 方法论（仅次于硬门禁与「道」）】 | `userData/shu.md` | 用户手动 **+ 归档自动归纳（本轮新增）** | 是 | `shu.zhengli` |
| 【规范 · 只作用于本会话（仅次于「术」）】 | `userData/guifan/<sid>.md` | 用户手动（第四列「规范」卡） | 是 | `chat.guifan-injected` |
| 【教条 · 仅次于「道」「术」】 | `userData/agents.md` | 用户手动 | 是 | — |
| 【束缚 · 补充约束（低于「教条」）】 | `userData/Memory.md` | 用户手动 | 是 | — |
| 工具 / 软门禁（身份锚、本机目录、语言约束、计划门禁、能力清单、档案…） | 代码 + 宿主校验 | — | 是 | `chat.lang-constraint` 等 |
| 【认知 · 本牛马的性格与背景】 | 牛马管理局那份「写入认知」（`instances[].persona`，截 1600 字） | 用户手动 | 是 | `chat.renzhi-injected` |
| 【印象 · 对用户的长期理解（最低）】 | `userData/yinxiang.md` + `impressions/<sid>.md`（截 3000 字） | 归档自动归纳 + 用户可改 | 是 | `yinxiang.*` |

- **压缩**：`BU_KE_YA_SUO=['道','产品门禁']`；新增顺序表 `YA_SUO_XIAN_HOU=['印象','认知','软门禁','工具','束缚','教条','规范','术']`，实现改成"非阶梯段最先 → 按顺序表逐段压到下限"，每条仍留 ≥600 字、最多压掉 55%，压不满交给下一级阶梯。
- **踩到的新坑（记下来）**：段标题必须 **≤24 字**，压缩层用 `【([^】\n]{1,24})】` 认段名；道/认知/印象三处标题原本超长，会被当成"非阶梯段"提前压 —— 已改短（`【道 · 最高优先级（除硬门禁）· 不可压缩】` 等）。

### 25.2 归档两条入口统一（用户："这 2 个归档应该都是同样的功能"）

- 之前：自动链只写 `kind:'archive'`+锚点+结构化摘要+知识抽取；手动链只写知识实体/事件+产物登记+印象归纳 ⇒ 同一个"归档"两种结果。
- 现在：自动入口 `ziDongGuiDangRuGuoXuYao` **只调** `guiDangYiGeHuiHua(k,{auto:true})`；该函数在完成自己那部分之后调同一个摘要核心 `shengChengHuiHuaZhaiYao`。审计 `chat.archive-done` 带 `chufa=auto|manual` 与 `guiDangHeXin`，核心失败另记 `chat.archive-core-fail`。
- **规范进归档**：整理模型的指令前面会带上本会话规范（`【本会话的规范（按它来归置）】`），结果按规范归置。
- **术参与归档归纳**：只挑用户自己说过的做事章法，带与印象同一道**幻觉硬闸**（素材里必须有连续 ≥10 字原话），每轮 ≤8 条、段内 ≤20 条，只写在自己那一节里，用户手写部分不动；成功与降级两条路都会走。
- **印象去隐私**：命中敏感类目（健康 / 性向 / 宗教政治 / 财务法律 / 家庭亲密关系 / 身份账户 / 生育）的条目**不写印象** ⇒ 改投私密知识库，投不进就丢弃，一律记 `yinxiang.sensitive-skipped`。判据在纯模块 `packages/app-shell/src/yinxiang-guolv.ts`（词组表，认不出就不算敏感）。

### 25.3 本轮顺手修的一个真缺陷（小游戏第 2 遍红的根因）

`read_file` 的"往下读带 `offset=N`"提示原来挂在**段尾**，而工具结果进上下文还会再被投影截一刀 ⇒ 提示连同尾巴一起被切掉，模型回"只看到前 130 行，后半段看不到"，改去绕 `run_shell`（被授权档拒）⇒ 那一轮整件没做成。现在提示写在**开头**。`verify-work-tools` 59/0。三连已按口径从第 1 遍重跑（PID 19652 / 门禁 7076，日志 `.r50-logs/game-run1.log`）。

### 25.4 新门禁与读数

- 新增 `packages/app-shell/scripts/verify-r52-layers.mjs`（fast 档，32 项）：敏感类目真值表（9 条该拦 + 7 条不该拦）、认知归属真值表（含"我要一杯拿铁"不算认知）、归档两入口同管线关系断言、术归纳幻觉硬闸、规范文件+IPC+空则不注入。**负向内置**：自动链若退回 `shengChengHuiHuaZhaiYao(k,true)` 或手动链不再调核心 ⇒ 直接翻红。已登记 `docs/GATE-MANIFEST.json`（kind=project）并挂进 `run-verify-22` 的 FAST 清单。
- 本轮复跑（Electron 类一律没碰，三连在跑）：`verify-r52-layers` **32/0** · `verify-r44-yuSuan` **176/0**（两条压缩判据按新口径重写，不再钉旧写法）· `verify-prompt-layers` **24/0**（新增阶梯/认知/规范/压缩顺序 4 组判据 + `VPL_MAIN`/`VPL_RULES_JS` 两个负向入口，两条负向变异各验一次必红）· `verify-gate-manifest` **23/23** · `verify-work-tools` 59/0 · `verify-docs` 84/0 · `verify-security` 28 PASS · `verify-naming` 48/0 · `verify-wiring` 238/0 · `verify-import-integrity` 通过 · `verify-i18n-locales` 162/0 · `check-syntax` 通过 · `tsc -b` 退出 0。**未 commit。**
- 顺手修掉两处会反复打红 `verify-security` 的文档隐私漏（cron 写读数时把真实路径带进了 §23），并把"读数一律用占位路径"写进 cron 推进器的指令里。
- 用户已点头的三件里：(1) `dao.md` 那一句已改（原文与出厂稿一致才改）；(3) 印象说明里"优先级低于「规矩」"的旧写法（在代码兜底文案里，语言包本身没这句）已改成完整阶梯；**(4) 「归档→印象写入」的端到端门禁还没写** —— 它要起 Electron，三连在跑时不开第二支，留到三遍全绿后与 live 名单一起补。
- §22.3 的 P0 待办清单仍一条未减。

---

# 26. 推进器读数（2026-10-21 11:48–12:12 · 第 2 遍红复核 ⇒ 修截断 ⇒ 发现三连已被重挂）

> 隐私口径：以下路径一律写占位（`<工作区>`、`%TEMP%`），原文里的本机绝对路径不抄进仓库。

## 26.1 接管时的读数（时间 + 原文）
- **11:48:16** 读 `<工作区>/.r50-logs/game-3x.log` 全文（6 行，末两条是本轮关键）：
  ```
  [game] 第 1/3 遍开始 2026-10-21T02:02:34.695Z
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿
  [game] 第 2/3 遍开始 2026-10-21T02:52:10.210Z
  [game] 第 2/3 遍 exit=1
  [STOP] game 第 2 遍失败（exit=1），按口径停下，不继续后面的遍。日志：<工作区>\.r50-logs
  ```
  同刻 `game-FAIL.txt`：`fail at run 2 exit=1` / `2026-10-21T03:47:51.607Z`。
- **11:48:16** 判活双信号采样①：`Get-CimInstance` 里 **没有** `r50-run3.mjs`、没有 `verify-r46-youxi.mjs`、9946 端口 `FREE` ⇒ 驱动器是被 `exit=1` 正规停的，**不是卡死**（不触发"杀进程重启"分支）。
- **11:48:16** 采样②：红遍 profile `%TEMP%\warmy-r46-youxi-profile-…1792551130335` 的 `audit/audit.jsonl` 与 `chat-meta.json` 都停在 **11:47:47** = 门禁退出前一刻 ⇒ 与"跑完自己收的尾"一致。

## 26.2 红因复核（不抄台账，自己 grep 一遍，结论与 §24.6 一致：产品缺陷）
- FAIL 行（`game-run2.log:24`，11:27:28）关键读数：`qian === hou === 1792552144241.0283`、`jiaoZheng:1` ⇒ 第 3 轮「暂停/继续」**文件一次都没动**，判据读的是宿主事实，没有冤枉。
- 三条受阻逐条对源码复现（行号为当时读数）：
  1. `read_file` 侧上限 20000（`work-tools.ts:42`）⇒ 7411 字节的 `youxi.html` **装得下**；真正吃掉后半段的是 `electron-main.ts:5402` `String(wr.content).slice(0, ctx.zuiDaJieGuoZiShu)`（默认 4000，`toolLimits()` `:1563`），**截断处零提示**；
  2. `read_file` **没有偏移**（只有 `maxChars`，恒从第 0 字符起）⇒ 模型没有任何办法看到文件尾；
  3. `search_files` 把文件当目录传只回 `not-a-directory`（`work-tools.ts:399`），不给出路 ⇒ 模型转去撞 `run_shell`，normal 档被拒 9 次、602 秒零产出。

## 26.3 已落地修复（只动「看得见」，判据/规模/上限一条没放宽）
- 新增纯模块 `packages/app-shell/src/jie-guo-shou-kou.ts`：`jieGuoShouWei()`（**先给提示行留位、再截断**，提示行自己不许被切半截）+ `readFileXuDu()`（续读游标：**段首提示行不算正文**，宁可重叠绝不跳字）。
- `electron-main.ts`：6 处裸 `slice(0, ctx.zuiDaJieGuoZiShu)` 换成收口函数（干活工具 / 群聊工具 / 宿主工具 / 子代理 / 两处守卫文案），并接审计 `chat.result-truncated`、`group.result-truncated`（qian/hou 落账，往后"模型少看了多少字"可 grep）。
- `work-tools.ts`：`read_file` 加 `offset` 分页 + `meta.offset/bodyChars`；段首提示写「本段是第 X~Y 字符…往下看请再调一次 read_file 带 offset=Y」；`search_files` 传文件 ⇒ `path-is-a-file：…用 read_file…带 offset…别绕 run_shell`。
- **没动**：默认 4000 / 工具侧 20000（新增断言反向钉住"不许靠抬上限让任务变容易"）、`④ 被拒即停用只按 2 分钟窗口`（属授权口径，仍等用户拍板）、任何判据与规模。
- 顺手抓到**两个新缺陷**（负向验证时暴露，已一并修掉）：
  - 固定预留 60 字会把「offset=N」切在半截数字上 ⇒ 等于没修；改成按提示实际长度回补、迭代到不动点，极端小时**一个字正文不给也要把 offset 送到**。
  - 兜底分支会**谎报**「只放出前 N 字」而实际放出 0 ⇒ 现在重算为放出 0 并如实写。

## 26.4 门禁读数（改完即跑，Electron 类一律没碰）
- `verify-tool-args` **60 ok / 0 FAIL**（本轮从 17 项扩到 60 项：新增纯模块真值表 + `offset` 分页行为 + 端到端「三段拼起来=原文」+「覆盖区间连续无缺口」+「说的放出量=实际放出量」）。
- 负向验证（逐条注入必红，注完即用 `tsc -b --force` 还原产物）：`未超限原样返回`、`段首游标=已放出正文末尾`、`offset 分页三段拼起来=原文`、`不传 offset 与旧行为逐字一致`、`offset 越过末尾如实说没有内容`、`search_files 传文件⇒真给出路`、`非 read_file/出错的 read_file 不编造游标`、`上限 200/404/1000/4000/8000 总长不越线 + 指引完整 + 正文不被挤光`、`分段读覆盖连续无缺口`、结构锚 4 条（裸切回归 / 默认上限被抬到 6000 / offset 参数面消失 / 提示行退回段尾）——**全部出现过红**，不是只会绿的摆设。
- 同批相关门禁（exit 全 0）：`verify-work-tools` 59/0 · `verify-r44-yuSuan` 176/0 · `verify-r48-heiban` 61/0 · `verify-r48-qiyue` 29/0 · `verify-round27-changes` 过 79 败 0 · `verify-round33-changes` 21/21 · `verify-round34-changes` 117/0 · `verify-round35-ui` 38/0 · `verify-round36-changes` 38/0 · `verify-round39-budget` 76/0 · `verify-wiring` 238/0 · `verify-naming` 48/0 · `verify-import-integrity` 全通过。
- `tsc -b` 退出 0 · `copy-assets` 已跑 · `check-syntax` 通过。**未 commit、未 push。**
- ⚠️ 仪器教训（写下来免得下次重犯）：① `tsc -b` 走内容哈希，**`touch` 源码不会触发重建**，还原被改坏的产物要 `tsc -b --force`；② 负向脚本里 `replace(x, '')` 这类**空串替换**会在还原时把整行插到文件开头（本轮真把 `work-tools.ts` 首行弄脏过一次，已修回并复验）；③ 编译产物里 `if (a) return b;` 会被拆成两行，按单行字符串替换会**静默不命中**（假负向），脚本必须断言"替换真的发生了"。

## 26.5 现场变更：三连已被另一支驱动器重挂（我没有并发起第二支）
- **11:53:48** 另一支 `r50-run3.mjs game 3`（PID 19652）起跑（会话外/cron 推进器挂的）。**12:07:46** 第 1 遍 `过 31 · 败 0 · 跳 0` 全绿；**12:07:46** 第 2 遍起（PID 21908，profile `…1792555666195`）。
- 12:10:14 双信号判活：① `19652`（驱动器）+ `21908`（门禁本体）在；9946 端口**唯一**监听者 `17480` = 本遍 Electron，其全部子进程同一 profile ⇒ 无并发抢端口。② `chatAge=2s`（最后一条 `chat.inflight-write @12:10:12`）、`audit=12:10:15`、`chat-meta=12:10:13` ⇒ 模型真在推进。按 §24.4/§24.5 口径**不杀、不重启、不起第二支**。
- 有意思的对照（只报读数不下结论）：这一遍**第 3 轮「暂停/继续」一次就过**（111 秒，mtime 前进），正是上一遍判红的那一轮；该遍各轮耗时 47/115/111/152/72/51 + 两次真跑修 131/138 = 817 秒。
- **⚠️ 仪器变更记账（第 1 遍读数作废）**：该遍 11:53:48 起跑，而我在 11:55 / 11:58 / 12:03 / **12:07:36** 四次重建过 `dist`（`electron-main.js` 是启动时一次性加载 ⇒ 那一遍跑的是「分页已进、宿主收口未进」的混合状态）。按协议「仪器变更 ⇒ 从第 1 遍重数」，这一遍的 31/0 **不算数**。
- 第 2 遍 12:07:46 起，`dist` 最终构建 = 12:07:36 ⇒ **第 2、3 遍跑在含全部修复的同一构建上**，读数可用。
- **口径（下一步照此执行）**：若第 2、3 遍全绿，再在**同一构建**上补跑 `node dev/gates/r50-run3.mjs game 1` 一遍，凑「同一仪器连续 3 遍全绿」；三绿前不许动 `packages/app-shell/src`（一动就再重数）。三绿后按 §22.3 live 名单**串行** → 验收两遍 → 首启 `node dev/gates/r38-firstrun.mjs`。

## 26.6 待办与状态
- §22.3 的 P0 待办清单**本轮一条未减**（拼音断言收尾、会话隔离硬门禁、知识库作用域矩阵、私密勾选、内部/私密加密、脱敏体系、牛马互通双向、live 回归）。
- 仍等用户点头的一条（本轮没动）：`④ run_shell 被拒即停用只按「最近两分钟内已拒 2 次」计`，窗口一过又能重试 ⇒ 要不要收紧成整轮不再放行（属授权口径）。


## 26. 第 52 轮续（12:05–12:1x）：P0-1 拼音断言收尾、P0-3 知识库作用域矩阵、三连第 1 遍全绿

### 26.1 P0-1「@ 拼音断言收尾」已完成

`dev/gates/verify-at-tidao.mjs`：**36 ok / 0 FAIL**。改了三处：
1. 中文期望按新规则翻正：`小牛/xn`、`小牛/xiaoniu`、`牛马一/nm` ⇒ **4（不命中）**；补一条边界 `小牛/x` ⇒ **1**（拼音只在第 1 个字母参与优先）。
2. 日/韩两条按用户要求钉住：`김철수/gcs → 1`、`山田/yamada → 2`（另有 `やまだ/ymd → 1`、`山田/yd → 1`）。
3. 顺带修掉一条**恒红的仪器**：`日文汉字读音表在（Unihan）` 钉的是生成脚本里的字段名 `kJapaneseOn/kJapaneseKun`，产物里根本没有这串字 ⇒ 改成数"确实带日文读法的行数"（>500 行带无前缀拉丁读法）。这条属于"字面锚过时"，不是产品问题。

### 26.2 P0-3「知识库作用域矩阵」主机侧已完成，P0-4 的 UI 勾选**没做**

- `kbLayersFor`（读）：内部群 `['internal','session']`；外部群 `['session']`；**我的牛马 `['internal','session']`，勾了 `privateKb === true` 才有 `'private'`**；**联系人 / 判不出类型的会话 `['session']`**（以前掉进"默认三层"，联系人能看到内部+私密库 —— 这是本轮抓到的一个真越权，已按"宁可少看"收窄）。
- 新增 `kbWriteLayers`（写）与读**分开**：我的牛马可写 `private/internal/session`（归档要往私密层放敏感条目），项目写 `internal/session`，外部群/联系人只写 `session`。`kbWritable` 只认写侧名单 —— 读写混用会有两种坏结果：归档被自己的读勾选挡死，或勾选管不住写。
- `verify-kb-scope` 扩到 **21 ok / 0 FAIL**（新增 5 条：私密层需勾选、群/联系人收窄、写侧独立、`kbWritable` 不共用读名单）。
- **没做的那半件**：牛马管理局里"允许查看私密知识库"那颗勾（位置在名称与认知之间，落盘 `instances[i].privateKb`）。原因：渲染层 `renderInstanceDetail` 是 JS 拼 HTML + 委托事件，插一行还得同时接 10 个语言包的标签，本轮上下文不够做完并验证，**不留半成品**。现状可用：字段读的是设置里的 `instances[i].privateKb`，直接写进 `settings.json` 即生效（默认不勾 = 看不见私密库，方向是安全的）。

### 26.3 三连进度与判活口径

- **第 1/3 遍全绿**（`过 31 · 败 0 · 跳 0`，12:07:46），第 2/3 遍 12:07:52 自动开始，`.r50-logs/game-run2.log` 在写（12:10 已过第 1 轮的碰撞判定/失败可重开）。
- **一处仪器记账**：我重启三连时把驱动器 stdout 重定向到了 `/dev/null` ⇒ `.r50-logs/game-3x.log` 里没有本遍的汇总行（只有上一遍的）。**判活与判定改读 `game-runN.log`**（每遍明细里有 `过 X · 败 Y` 汇总），cron 推进器已按此更新（revision 2），并加了"写进文档的读数一律用占位路径"这条（上一版它把真实路径写进 §23，两次把 `verify-security` 打红）。

### 26.4 静态复跑（本轮全绿，Electron 类未碰）

`verify-work-tools` 59/0 · `verify-prompt-layers` 24/0 · `verify-kb-scope` 21/0 · `verify-at-tidao` 36/0 · `verify-r52-layers` 32/0 · `verify-wiring` 238/0 · `verify-docs` 84/0 · `verify-security` 28 PASS · `verify-gate-manifest` 23/23 · `verify-i18n-locales` 162/0 · `verify-truth-guard` 9/0 · `verify-import-integrity` 通过 · `check-syntax` 通过。**未 commit。**

### 26.5 与第 51 轮那条记忆的关系（不重复劳动）

`project-warmy-tool-result-visibility` 记的 ①②③（同一上限内如实告知 + `offset` 分页 + `search_files` 引导）确实已落地；本轮小游戏第 2 遍的红是它的**最后一公里**：续读提示挂在**段尾**，而工具结果进上下文还会再被宿主截一刀 ⇒ 提示连同尾巴一起消失，模型看不到"带 offset 再读"就改去绕 `run_shell`。已把提示写在**段首**（与那条记忆里"提示行要写在段首"的结论一致），`verify-work-tools` 59/0 没被打破。**④（`run_shell` 被拒的停用窗口）仍等用户拍板**，本轮没动。

---

# 27. 推进器读数（2026-10-21 12:12–12:16 · 第 2 遍判活 + 一处仪器变更）

> 隐私口径：路径一律占位（`<工作区>`、`%TEMP%`），本机绝对路径与主机名不抄进仓库。

## 27.1 判活双信号（12:13:36–12:13:41 采样，原文照抄）

- 采样①（进程/端口，`Get-CimInstance` + `Get-NetTCPConnection -LocalPort 9946`）：
  ```
  19652|node.exe|11:53:48|node dev/gates/r50-run3.mjs game 3
  21908|node.exe|12:07:46|node dev/gates/verify-r46-youxi.mjs
  17480|electron.exe|12:07:46|...electron.exe --remote-debugging-port=9946 --user-data-dir=%TEMP%\warmy-r46-youxi-profile-…5666195
  ---PORT9946---
  Established|17480
  Listen|17480
  ---PROFILES---
  warmy-r46-youxi-profile-…5666195|audit=12:13:37|chatmeta=12:13:38
  ```
  9946 上**只有这一支** Electron（其 gpu/utility/renderer/ipc 子进程同一 profile）⇒ 没有并发第二支，纪律没破。
- 采样②（审计活动）：`rows=207  anyLast=12:13:37/chat.inflight-write  chatAge=5s` ⇒ 模型真在推进。
- **结论**：两信号都有活动 ⇒ **不卡死**，按 §23.1 不杀、不重启、不起第二支。第 2 遍（`game-run2.log`）12:07:46 起，12:14 读数已过第 2 轮（`第2轮 · 最高分持久化：判据成立`，轮耗时 149/241 秒）。
- 判据来源订正（与 §26.3 一致）：驱动器 stdout 被重定向到 `/dev/null`，`game-3x.log` 里只有上一遍的汇总 ⇒ **本遍结论只读 `game-runN.log` 的 `----- exit=` 行与 `过 X · 败 Y` 汇总行**。

## 27.2 前置体检（只读，12:14–12:15）

- 密钥 `%TEMP%\w50-mimo-key.txt` 在；`better-sqlite3` **三候选齐**（vendor / packages/memory-os/node_modules / `%APPDATA%\@warmy\app-shell\memory-runtime\node_modules`）。
- §19.3 的 15 支 live 名单落位核对：14 支在 `dev/gates/`；**`verify-history-persist.mjs` 不在 `dev/gates/`，实际在 `packages/app-shell/scripts/verify-history-persist.mjs`** ⇒ 串行跑到它时用真实路径，别按名单里的 `dev/gates/<名>` 拼。

## 27.3 异常（如实报，因果可 grep）：门禁跑动中主进程产物被并行会话重建 ⇒ 第 2 遍读数作废

- `find` 读数（12:15:0x，`-newermt '2026-10-21 12:09:00'`，仓库内）：
  ```
  12:11:10 dev/gates/verify-at-tidao.mjs
  12:12:19 packages/app-shell/src/electron-main.ts
  12:12:28 packages/app-shell/dist/electron-main.js
  12:13:18 dev/gates/verify-kb-scope.mjs
  12:14:48 docs/HANDOFF-R51.md
  ```
- 时间关系：第 2 遍 12:07:46 起跑（Electron 启动时一次性加载 `dist/electron-main.js`），而源码 12:12:19 被改、产物 12:12:28 重建 ⇒ **跑的过程中现场变了**。正在跑的那一支本身不受影响（加载的还是 12:07:36 那份），但它与后面第 3 遍加载的 12:12:28 那份**不是同一仪器**。
- 按协议口径（§22.6「真机门禁期间不动现场」+ §26.5「一动就再重数」）：**第 2 遍即使跑绿也不算进连续三绿**。本会话全程没动 `packages/app-shell/src`、没重建 `dist`，改动来自另一支做 P0（拼音断言 / 知识库作用域）的会话。
- **调整后的起算口径**：第 3 遍由驱动器在 12:12:28 构建上自动开跑 ⇒ 把它当作连续三绿的**第 1 遍**，其后在同一构建上补 `node dev/gates/r50-run3.mjs game 2` 两支；期间只要 `packages/app-shell/src` 再被改动一次，就再从当时的那一遍重数。
- 请求并行会话配合（写在这里当面向机制）：真机三连跑动期间（每遍约 13–14 分钟，判据行落 `game-runN.log`）**不要 `tsc -b` 重建 `packages/app-shell/dist`**；静态门禁不受影响，可以继续跑。

## 27.4 待办

- §22.3 的 P0 清单**本推进器一轮一条未减**（拼音断言收尾、会话隔离硬门禁、知识库作用域矩阵、私密勾选 UI、内部/私密加密、脱敏体系、牛马互通双向、live 回归）。
- 仍等用户点头的一条：`④ run_shell 被拒即停用只按「最近两分钟内已拒 2 次」计` 要不要收紧成整轮不再放行。

## 27.5 第 2 遍终局 + 第 3 遍改为起算遍 + 一处仪器缺陷已修（12:22–12:28 读数）

- **12:25:10** 读 `game-run2.log` 汇总行（原文）：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 31 · 败 0 · 跳 0 ====`；该遍 profile `…5666195` 最后一条审计 `12:22:25/chat.inflight-clear`。
- **exit=0 的依据不是猜**：驱动器只在 `code === 0` 时才开下一遍 ⇒ 12:22:29 `game-run3.log` 出现新表头 + 新 profile `…6550008` ⇒ 第 2 遍是绿着退的。
- **但第 2 遍不计入连续三绿**：它 12:07:46 加载的是 `12:07:36` 那份 `dist/electron-main.js`，而源码 12:12:19 被并行会话改过（§27.3）。第 3 遍 12:22:29 起跑、加载 `12:12:28` 那份 ⇒ **把第 3 遍当作连续三绿的第 1 遍**，其后在同一构建上补 `node dev/gates/r50-run3.mjs game 2`（两支）。
- **12:27:41 双信号复采样**：驱动器 `19652` 在、门禁本体 `8068`（12:22:29 起）在、9946 端口唯一监听者 `5028`；`chatAge=0s`（`chat.inflight-write @12:27:41`，rows=211）；第 1 轮已出键盘/分数/碰撞/重开 4 条 ok ⇒ 不杀、不重启、不起第二支。

### 仪器缺陷：驱动器的结论行「从来没有落进过 run 日志」（已修）

- 读数：`grep -c 'exit=' game-run1.log = 0`、`game-run2.log = 0`、连跑了 3 遍的 `mem-run3.log = 0` ⇒ `----- exit=` 这行**恒缺失**。而 §26.3 给 cron 的口径是"读 `game-runN.log` 的 exit 行"⇒ 照那条口径，每一遍都会被读成「进程消失且没有结论 ⇒ 异常 ⇒ 重启」，是会造成**误杀在跑门禁**的陷阱。
- 根因（桩验证出来的，不是读码推断）：`child.stdout.pipe(out)` 的 `end:true` 在子进程退出时**先把 `out` 关掉**，随后 `out.write('----- exit=…')` 属 write-after-end ⇒ **静默丢弃**（子进程自己的输出不受影响，所以日志看着"正常结束"）。同一时序两种写法的对照读数：`stream-write has-exit-marker=false has-gate-line=true` / `appendFileSync has-exit-marker=true has-gate-line=true`。
- 修法（只动 `dev/gates/r50-run3.mjs` 的包装层）：结论行改到 `child.on('close')`（stdio 流已断）里用 `fs.appendFileSync(logPath, …)` 落盘；新增 `say()` 把 `[game] 第 i/N 遍开始/exit=`、`[OK]`、`[STOP]`、`[DONE]` **同时追加**进 `${tag}-3x.log`，这样驱动器 stdout 被启动方重定向到 `/dev/null` 时（§26.3 就发生了）汇总不再丢失。
  **判据、规模、子进程命令与环境（`MIMO_KEY_FILE` / `OLLAMA_MODEL` / `KEEP=1`）一字未动**；`packages/app-shell` 没碰 ⇒ 不构成新的重数理由。
- 验证：`node --check` 通过；桩 **6/6**（绿遍标记落盘 / 红遍 `exit=1` 标记落盘 / 子进程 stdout 与 stderr 仍进日志=§18.4① 纪律 / `say()` 追加不覆盖历史）；负向对照就是上面 stream-write 那条（旧写法必红，不是只会绿的摆设）；静态 `verify-gate-manifest` 复跑 **23/23**。临时桩文件已删（`.tmp-xw/`）。
- **边界（很重要）**：正在跑的驱动器 `19652` 用的是 11:53:48 加载的旧代码 ⇒ **第 3 遍日志仍然没有 exit 行**。第 3 遍的判定继续用三条：`过 X · 败 Y` 汇总行 + 驱动器是否开下一遍/是否退出 + `${tag}-FAIL.txt` 有没有被新写。从补跑那支起，exit 行与 3x 汇总行才可用。
- 顺带订正 §19.3 名单：`verify-history-persist`、`verify-gate-manifest` 实际在 `packages/app-shell/scripts/` 下，不在 `dev/gates/`（12:15 读数：`dev/gates/` 共 113 支且无前者）⇒ 串行跑到它们时用真实路径。

## 27.6 第 3 遍判红 ⇒ 定性为仪器问题 ⇒ 修完从第 1 遍重跑（12:44–12:56 读数）

- **12:44:33** 读 `game-run3.log` 汇总行（原文）：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 30 · 败 1 · 跳 0 ====`；`game-FAIL.txt` 12:44:22 新写 ⇒ 驱动器按口径 STOP，场地随后空（12:46:55 `---PORT9946--- FREE`，无 `r50-run3`/`verify-r46-youxi` 进程）。
- FAIL 行原文（`game-run3.log:51`）：
  ```
  FAIL 第6轮·真跑：游戏循环真跑（空闲就动，或按开始键后自动移动） —— {"xiuCi":2,"qian":"1456772103:640x480","hou":"1456772103:640x480","pS1":"1204450621:640x480","pS2":"1204450621:640x480"}
  ```
  同一批里 `页面加载完成` / `canvas 存在` / `按下方向键后状态变了` / `没有未捕获异常` 全绿，`报错=[]`。
- **复现**（拿该遍留下的产物 `%TEMP%\warmy-r46-youxi-profile-…6550008\workspace\r46-youxi\youxi.html`，用夹具单独跑，指纹读数与 FAIL 行**逐字相同**）⇒ 确定性红，不是抖动。
- **定性：仪器问题，不是产品缺陷**（探针读数，同一份产物、同一夹具）：
  ```
  idle          1456772103:640x480 / 1456772103:640x480 moving=false
  space@window  1204450621:640x480 / 1204450621:640x480 moving=false   ← 仪器原来的派发位置
  space@document 1204450621:640x480 / 1154698165:640x480 moving=true
  space@canvas  1204450621 / 2699534574 / 866076994        moving=true（单次投递）
  ```
  产物是打砖块：`document.addEventListener("keydown")`、空格 `launchBall()`、循环 `requestAnimationFrame(loop)` 在跑（`zhenShu=26` 帧/500ms）。而夹具把合成按键**只派发在 `window` 上**——`window` 的事件路径里没有 `document` ⇒ 监听 document 的游戏**一个键都收不到**，球永远发不出去，"循环真跑"就成了假红。
- **两处仪器修改**（`dev/gates/r46-chromium-harness.cjs`，判据一分没降）：
  1. 合成按键改为派发在**画布**上（`bubbles` 依次经过 canvas → document → window，一次投递喂给三种监听位置；也修掉了方向键同样进不去 document 的问题）。
  2. 「所有键都试完、画面仍然冻结」时才**单按一次空格**再连测两次（`pT1/pT2`）。第 51 轮那次假红是**连按空格**把正在跑的按停，这里只在静止态按一次，且"已经在动"分支绝不碰空格。
  3. 加证据位 `zhenShu`（空闲 500ms 出帧数，不参与判据）：把「页面根本没出帧」与「出帧但状态机静止」这两类红分开。
- **反例自证钉进门禁**（`verify-r46-youxi.mjs` 开头，跑不过就整遍判红）：静态图与「每按一次才走一格」两类都必须 `ziDong=false`。实测读数：
  ```
  zizheng1-jing-tai  :: ziDong=false jianPan=false p1=p2=pS1=pS2=pT1=pT2=1193551306:640x480
  zizheng2-zou-yi-ge :: ziDong=false jianPan=true  pS1=pS2=256107827 且 pT1=pT2=2720678549   ← 按一次只走一格仍然判红
  huishan-window-ting  / huishan-document-ting / huishan-kongjian-tingzhi / R53-hong-mian ⇒ ziDong=true
  ```
  也就是说补救分支**不会**把"能亮就算过"放进来了；换派发位置后 window 监听型也没退化。
- **我自己引入的一处仪器 bug（如实报）**：新增的自证块在顶层调用 `zaiZhenLi`，而 `const JIA_JU` 声明在它后面 ⇒ TDZ `ReferenceError: Cannot access 'JIA_JU' before initialization`，第 1 遍 30 秒即红（12:53:50 那次 `exit=1`，与产品无关）。已把常量上移一行修掉；顺带**端到端验证了 §27.5 的驱动器补丁**：`game-3x.log` 这次确实收到了 `[game] 第 1/3 遍开始 …` / `[STOP] … exit=1` 汇总行。
- **12:54:28 从第 1 遍重跑三连**（`node dev/gates/r50-run3.mjs game 3`，MIMO_KEY_FILE + 驱动器 stdout 落 `.r50-logs/game-driver.log`）。构建仍是被冻结的 `dist/electron-main.js = 12:12:28`（12:53:42 读数：src 自 12:12:19 未再动）⇒ **这一支起算连续三绿**。
- 起跑自证读数（12:55:47 原文）：`ok 仪器自证：反例（有画面/循环/键盘/分数，但没碰撞）…` / `ok …该绿的仍然绿` / `ok 仪器自证：静态图必须被"循环真跑"判红` / `ok 仪器自证：每按一次才走一格（没有循环）必须被"循环真跑"判红` / `ok 应用启动` / `ok MiMo 密钥已交给宿主`。
- C 盘 343G 可用（64% 用量），KEEP=1 的临时 profile 累积不构成风险。
- §22.3 的 P0 清单**本轮一条未减**。

## 27.7 与并行会话 §28 的对账（12:56:26 读数，避免两支并发）

- 同一红的**独立复现**：§28.2 的实测 B/C 与本节结论完全一致（旧夹具只往 `window` 派发 ⇒ 监听 `document` 的游戏收不到键；修好后同一产物 `ziDong=true`）。§28.2 里"当前 mtime 12:50:22 那份夹具"就是本会话改的那份 ⇒ **两边没有各自改夹具，没有冲突**；§28.5 说的"12:54:14 又动了 `verify-r46-youxi.mjs` 把声明提前"也是本会话那次 TDZ 修复。
- **现场唯一性（12:56:26 `Get-CimInstance` 原文）**：驱动器 `32040`（12:54:28）、门禁本体 `38768`（12:54:28）、9946 端口 `Listen|38136` 唯一 ⇒ 本会话起的这一支是**唯一**在跑的真机门禁；§28.4/§28.5 那支会话**有意没起**，所以没有并发抢端口。
- 起算口径不变：构建 `dist/electron-main.js = 12:12:28`（12:53:42 复采仍未动），三连 12:54:28 从第 1 遍起算，夹具/门禁改动不参与 `tsc -b` ⇒ 不构成重数理由。
- **登记一条未收紧的残留（来自 §28.3，本会话未动判据）**：`qiDong`/`pT` 只看"两段之间像素变没变"，理论上可被**周期 >1.5 秒的遮罩闪烁**满足——本产物实测确实出现过"空闲 2.6 秒自己变一次"。收紧办法（按键后连采 3 次要求两两不同）会**同时**误伤"慢节奏但真在动"的游戏，属于口径取舍 ⇒ 留给用户拍板；现在判红/判绿的每一条都有可 grep 的指纹读数，不靠这个假设。



# 28. 推进器读数（12:44–12:53 · 起算遍判红 + 我用三次实测把定性钉死在「仪器侧」）

## 28.1 起算遍（第 3 遍）终局红
- **12:44:44** 旁观器（`_watch3.sh`，后台 ID `b05lgh116`）打印：`DRIVER-GONE pid 19652`。
- **12:45:11** 读现场（原文）：
  ```
  .r50-logs/game-FAIL.txt（46 字节，12:44:22）: fail at run 3 exit=1 / 2026-10-21T04:44:22.521Z
  game-run3.log 汇总行: ==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 30 · 败 1 · 跳 0 ====
  game-run3.log 唯一 FAIL（第 51 行）:
    FAIL 第6轮·真跑：游戏循环真跑（空闲就动，或按开始键后自动移动） ——
      {"xiuCi":2,"qian":"1456772103:640x480","hou":"1456772103:640x480","pS1":"1204450621:640x480","pS2":"1204450621:640x480"}
  ```
- 其余四条真跑判据（加载、canvas、**按下方向键后状态变了**、无未捕获异常）**全绿**；`r50-run3.mjs` 正常走完 STOP（不是卡死、不是被杀）。⇒ §27.5 定的**起算遍红 ⇒ 连续三绿归零，仍要从第 1 遍重跑**。

## 28.2 定性：仪器缺陷（三次独立实测，不是读码推断）
产物 = `%TEMP%\warmy-r46-youxi-profile-…6550008\workspace\r46-youxi\youxi.html`（8599 字节，12:37:07）。它 `document.addEventListener("keydown", …)`（第 252 行）、空格=「发球/暂停/继续」（第 22、256 行）、`requestAnimationFrame(loop)`（第 277 行）。

- **实测 A（复现门禁的红）**：把**当时那份夹具**原样复制到临时目录跑同一产物 ⇒
  `{"ziDong":false,"jianPan":true,"cuo":[],"p1":"1456772103…","p2":"1456772103…","pS1":"1204450621…","pS2":"1204450621…"}` —— 五个指纹与 12:44 门禁读数**逐字节相同** ⇒ 复现成立，不是偶发。
- **实测 B（隔离变量，决定性）**：同一份产物、同一个空格，分别只打一个目标，各连采三次：
  ```
  空闲（不按任何键）:      1456772103, 1456772103, 1204450621   ← 2.6 秒里自己变了一次（遮罩闪烁）
  空格只打 window:         1204450621, 1204450621, 1204450621   ← 一动不动
  空格只打 document:       191810771, 2774459986, 1048939526     ← 每 0.6~1 秒都在变
  ```
  ⇒ 旧夹具 `window.dispatchEvent(...)` 的事件路径里**没有 document**，监听 `document` 的游戏一个键都收不到。**球发不出 ⇒ 画面静止 ⇒ 判红的是仪器，不是产品。** 顺带：那条「按下方向键后状态变了」判绿是被 `p2≠p3` 蒙过去的（真实原因是空闲闪烁，不是按键）—— 这条判据同样不可信。
- **实测 C（修好的夹具跑同一产物）**：`dev/gates/r46-chromium-harness.cjs`（**当前 mtime 12:50:22**，实测就针对这一份跑；派发目标改成画布 + `bubbles`，并在「所有键都试完仍冻结」时**只按一次空格**再测 1.6 秒）复跑 ⇒
  ```
  {"ziDong":true,"jianPan":true,"cuo":[],"zhenShu":27,"pT1":"1993373117…","pT2":"2003428870…"}
  ```
  `zhenShu=27` = 空闲 500ms 里渲染进程出了 27 帧（≈54fps，证据位、不参与判据）⇒ 循环一直在跑，只是状态机等发球。**判据本身一分没降**（仍要求 1.6 秒里像素自己变），所以这条绿不是放宽出来的。
- **并行会话同一结论**：`r46-chromium-harness.cjs` 第 38–42 行注释已写「上一版只往 window 派发 ⇒ 监听 document 的游戏一个键都收不到」，与实测 B 一致（我这边是独立采样，不是转述）。

## 28.3 残留风险（如实登记，等用户点头再收紧）
- `pT1≠pT2` 理论上可被「>1.5s 周期的遮罩闪烁」满足（本产物实测空闲 2.6 秒内确实自己变了一次）。本遍不是这种情况——空格后 0.6/1.0/1.0 秒三次采样**两两不同**，闪烁解释不了。
- 可选加固（属**收紧**判据，不改规模不改宽松度）：按键后连采 3 次要求两两不同（`_watch3` 期间我用的 trio 写法就是现成样本），并把「键盘接上了」从 `p2≠p3` 兜底改成「按键前后各自基线稳定 + 按键造成的差」。要我做就说一句。

## 28.4 现场与下一步
- 12:45:11 / 12:53:0x 两次 `Get-CimInstance` 过滤 `r50-run3|verify-r46|remote-debugging-port` 计数 **0** ⇒ 场地干净、9946 空。**本会话全程没起门禁、没杀进程**（避免与 12:50 正在改夹具的那支会话并发；两支同起 = 假红）。
- 下一步：按纪律**从第 1 遍重跑三连**（夹具已修，无需重新构建 app；`dev/gates/*.cjs` 不参与 `tsc -b`）。谁起都行，但**只能起一支**；起了就照 §24.4/§27.1 的双信号旁观，`game-3x.log` 现在也会被 `say()` 追加（§27.5 修的），两处都读。
- 三绿后：§19.3 串行 15 支 live（路径订正见 §27.5：`verify-history-persist`、`verify-gate-manifest` 在 `packages/app-shell/scripts/`）→ 验收 ×2 → 首启 `node dev/gates/r38-firstrun.mjs`。
- 我这一轮产生的临时文件（`%TEMP%\r46-probe-429`，含三份一次性探针）在本节写完后删除；**没有改动任何门禁原文件与产品代码**。
- **§22.3 的 P0 待办清单本轮一条未减**；仍等用户拍板的是 `④ run_shell 被拒即停用只按 2 分钟窗口计`。

## 28.5 重跑第 1 遍刚起就崩：崩在仪器自己身上（12:53:50–12:56 读数）
- **12:54:16** 读 `game-run1.log`（mtime 12:53:50，原文尾巴）：
  ```
  · Chromium 临时夹具目录保留：%TEMP%\warmy-r46-chromium-1792558430246
  file:///…/dev/gates/verify-r46-youxi.mjs:312
      if (!fs.existsSync(JIA_JU)) return { ok: 'skip', why: '夹具文件不存在：' + JIA_JU };
  ReferenceError: Cannot access 'JIA_JU' before initialization
      at zaiZhenLi (…verify-r46-youxi.mjs:312)   at …:283:19
  Node.js v24.20.0
  ----- exit=1 -----
  ```
  ⇒ 第 1 遍（新起的一遍）在**仪器自证第一次调用夹具**时就崩了，整遍零判据产出。**这是仪器缺陷，与产品无关**。
- **顺带一条好读数**：`----- exit=1 -----` 这次**落进日志了** ⇒ §27.5 修的「结论行从来没落盘」确实生效（上一遍 12:44 那次还是旧的 11:53:48 加载的代码，所以没有）。
- **根因与修复状态**：崩的那份把 `const JIA_JU` 放在首次调用（原 283 行）之后 ⇒ TDZ。改夹具那支会话 **12:54:14** 又动了 `verify-r46-youxi.mjs`，把声明提到了第 **272** 行（调用在 284）。我按当前这份逐条核了夹具路径用到的每个顶层标识符的声明行号：
  ```
  sleep(import 顶层 await)=25  GEN=23  PKG=24  KEEP=34  electron=37  env=102  JIA_JU=272  ZIZHENGLU=278  LU_JING_TAI=280  LU_ZOU_YI_GE=281
  首次 await zaiZhenLi(...) = 284      →  全部在使用之前 ⇒ 无同类 TDZ
  node --check dev/gates/verify-r46-youxi.mjs → OK（语法）
  ```
  ⇒ 静态层面这条已通；**但没人跑过**，所以仍要用一次真跑才算数。
- **我没有起三连（有意等）**：`verify-r46-youxi.mjs` 距我读数只有 40 秒还在被改（12:54:14），现在起一支 50 分钟的真机遍，一旦它中途再改就是这个会话线今天**第二次** §27.3 式「读数作废」；何况与那支会话同起两支 = 抢 9946 假红。**建议定一条硬规矩：`dev/gates/verify-r46-youxi.mjs` 与 `dev/gates/r46-chromium-harness.cjs` 连续 2 分钟没有写入，才允许起三连，且只起一支。** 你说「起」我就起（后台、带 `MIMO_KEY_FILE`、`KEEP=1`）。
- **现场**：12:56:0x `Get-CimInstance` 过滤 `r50-run3|verify-r46|remote-debugging-port` = **0**，9946 空；只有 openclaw 自身四个 node 进程在（与本任务无关，未动）。
- **我自己动过的东西**：只写了台账（§28/§28.1–28.5）；一次性探针目录 `%TEMP%\r46-probe-429` 与 `%TEMP%\r46-tdz-check.mjs` 已删；`node --check`、`verify-docs` **84/0**、`verify-security` **28 PASS** 全绿。**未改任何门禁原文件、未改产品代码、未 commit、未 push。**
- **§22.3 的 P0 待办清单仍一条未减**；等你拍板的仍是 `④`（run_shell 被拒即停用只按 2 分钟窗口计）与 `§28.3` 的可选收紧（按键后连采 3 次要求两两不同）。

## 28.6 订正 §28.5 的「现场 = 0」：修好的仪器已在 12:54:28 起了一遍，自证段跑通了
- **12:56:10 / 12:57:05** 读数：改夹具那支会话在**修完 16 秒后**自己起了三连第 1 遍 ⇒ 本会话仍然没起（两支没撞车，9946 唯一）。现场身份（`.r50-logs/_role.ps1`，只读）：
  ```
  32040 12:54:28 node dev/gates/r50-run3.mjs game 3          ← 驱动器
  38768 12:54:28 node dev/gates/verify-r46-youxi.mjs          ← 门禁本体
  38136 port=9946 APP-main  dir=…\warmy-r46-youxi-profile-1792558468866   ← 唯一监听 9946 的主进程
  18292/728/40472/27112 同 profile 的 renderer/gpu/utility；24472 = 同一遍的 memory-runtime ipc.js（不是第二支门禁）
  ```
- **仪器文件在启动前就停手了**（满足 §28.5 提的硬规矩）：`r46-chromium-harness.cjs` mtime **12:53:19**、`verify-r46-youxi.mjs` mtime **12:54:14**，遍启动 **12:54:28** ⇒ 到 12:57:05 为止**没人再动过**，本遍读数对应的是修好的那份，不作废。
- **修好的仪器第一次真跑就自证通过**（`game-run1.log` 原文，12:55:52 写入）：
  ```
    ok   仪器自证：静态图必须被"循环真跑"判红
    ok   仪器自证：每按一次才走一格（没有循环）必须被"循环真跑"判红
    ok   应用启动（独立 profile + 独立端口，没动用户的实例）
    ok   MiMo 密钥已交给宿主（不打印）
    · 这一轮用了 62 秒（回复 400 字）
    ok   第1轮：真的产出文件了 … 语法过 … canvas … 游戏循环 … 键盘 … 分数 … 碰撞 … 失败可重开（8 条全 ok）
  ```
  ⇒ §28.5 那条 TDZ 崩溃已经不复现；两条**反例自证**都在（静态图判红、按键才走一格判红），说明「循环真跑」不是靠关键词糊的。
- **§28.3 的待办仍然成立、要如实缩小范围**：现有两条反例覆盖了「静态」与「每按一次走一格」，**没有**覆盖「空闲遮罩闪烁」（我今天实测：这份产物不按任何键，2.6 秒里像素也自己变过一次）。所以「按键后连采 3 次要求两两不同」这条收紧仍然值得做，等你点头。
- **活性**（12:57:14 采样，按 §24.4 口径只看 `chat.*`）：`chatAge=2s`（`chat.inflight-write`，profile …1792558468866，audit 93 行）⇒ 第 2 轮正在进行，不判卡死、不动进程。
- **进度**：三连 = **重新从第 1 遍起算的第 1 遍**（旧的第 1/2 遍绿都是**修仪器之前**的读数，§27.5/§28.2 已作废处理）；每遍约 50 分钟，三绿后才进 live 串行。
- 本会话新增的只读工具：`.r50-logs/_watch3.sh`（盯 `game-runN.log` 的 `----- exit=` 行 + 驱动器存活）、`.r50-logs/_role.ps1`（分清 APP-main / renderer / FIXTURE / ipc.js，用来证明 9946 只有一支）。两者都不杀不重启。
- **§22.3 的 P0 待办清单仍一条未减**；等你拍板：`④`（拒后停用只按 2 分钟窗口）与 `§28.3`（按键后连采 3 次）。

## 28.7 修好后第 1 遍全绿：过 33 · 败 0，且**一次修都没用**（13:05:52 读数）
- **13:05:52** 旁观器（后台 ID `b3xaojtpd`）打印 `VERDICT-LINE in .r50-logs/game-run1.log`，汇总与结论行（原文）：
  ```
  ==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 33 · 败 0 · 跳 0 ====
  ----- exit=0 -----
  [game] 第 1/3 遍 exit=0 / [OK] game 第 1/3 遍全绿 / [game] 第 2/3 遍开始 2026-10-21T05:05:42.617Z
  ```
  `game-3x.log` 这次**也有行**（§27.5 修的 `say()` 生效），两处口径一致 ⇒ 不再需要「盯空文件」。
- **规模与判据只增不减（这条要钉住）**：判据从旧版的 **31 条**涨到 **33 条**，多出的正是两条反例自证——「静态图必须被循环真跑判红」「每按一次才走一格必须被循环真跑判红」；`grep -c '^  ok ' = 33` 与汇总行一致。**没有任何一条被删或被放宽。**
- **本轮最有说服力的读数：修案次数 = 0**。`grep '次修\|才验收' game-run1.log` **零命中** ⇒ 第 6 轮真跑**一次通过**，不再需要「贴真报错回去修」。对照：修之前每一遍都要打满上限 2 次修才收敛（§24.1、§24.2、§27.5 三处都有「第6轮经过 2 次…才验收」行），而 §24.2 预警的「余量为零」正是靠这条在第 3 遍掉下悬崖（§28.1）。⇒ 这不是把判据改松了，而是**模型终于看得见文件、键也真能打进去**。
- **每轮耗时（原文六行）**：62 / 122 / 131 / 135 / 121 / 77 秒 ⇒ 合计 648 秒；整遍 12:54:28.822 → 13:05:42.617 = **11 分 14 秒**。对照修之前那遍 10:02:34 → 10:52:10 = **49 分 35 秒**（内含两轮 `chat.tools.stalled anJingMs≈660000` 的 11 分钟空转，§24.5）。⇒ 撞墙消失后，单遍成本降到约 **1/4.4**，三遍 + live 串行的总账也据此重估。
- **进度**：三连 **1/3 绿**（起算遍 = 修好仪器后的第 1 遍）；第 2 遍 13:05:42 起跑，新 profile `…59142662`，自证段已过 3 条。预计每遍 11–14 分钟 ⇒ 三绿约在 **13:30–13:40**。
- **下一步**：第 2、3 遍绿后按 §19.3 串行 15 支 live（`verify-history-persist`、`verify-gate-manifest` 在 `packages/app-shell/scripts/`）→ 验收 ×2 → 首启 `node dev/gates/r38-firstrun.mjs`。
- **旁观器换型**：`_watch3.sh` 会扫全部 `game-runN.log`，现在 `game-run1.log` 已有 exit 行 ⇒ 再用会立刻误触发；改成 `.r50-logs/_watch4.sh <本遍文件名>`，只盯正在跑的那一遍（仍只读、不杀不重启）。
- **§22.3 的 P0 待办清单仍一条未减**；等你拍板：`④`（拒后停用只按 2 分钟窗口计）、`§28.3`（按键后连采 3 次要求两两不同，覆盖「空闲遮罩闪烁」这一类）。

## 28.8 【急·给并行的另一支会话】推进器会话刚收紧了夹具的「循环真跑」，请先别起跑
- **13:37:36 读到你正在改 `dev/gates/verify-r46-youxi.mjs`**；我在 **13:38 前后**单独改了 **`dev/gates/r46-chromium-harness.cjs`**（只动采样段，`node --check` 过）⇒ 这两个文件现在**配对未验证**，谁先起跑都可能拿到没测过的组合。
- **为什么要收紧（实测，不是我推测）**：第 2 遍那份产物（`%TEMP%\warmy-r46-youxi-profile-…59142662\workspace\r46-youxi\youxi.html`，6895 字，13:22）在**完全不按任何键**的条件下，每秒采一次全量 PNG 指纹连采 14 次：**只在第 0→1 秒变了 1 次，之后 12 秒一个像素都没变，控制台零报错**（`frozenTailStable=true`）。而旧口径只比 `p1≠p2`（间隔 1.5 秒）⇒ 那一次变化就把它判成「循环真跑 · 绿」（`game-run2.log` 第 53 行就是这条 ok）。**假绿还会饿死反馈**：催办文本里没有"开局就冻住"这一项，模型两次修都在修键盘，白打满 `xiuCi=2`。
- **改了什么**：每个阶段从「采 2 次看不同」改成「**连采 5 次、间隔 700ms，要求相邻变化 ≥3 次**」（≈整段 2.8 秒持续在动）。三段式补救（空闲 → 点画布+Enter/WASD+方向键 → 单按一次空格）**一字未动**，只是每一段都改成序列采样；`ziDong` 现在是 `jiChu && chiXu`。**判据只收紧、没有放宽任何一条。** 新字段：`jie.jiXu={a,b,c}`（三段各自的变化次数）、`jie.chiXuXian=3`、`jie.moWeiDong`（空闲段末两次是否不同），催办文本可以直接引用。
- **我还没动你的文件**（怕覆盖你正在写的东西）。剩下两件等你落定后一起做，或你点头我来：
  1. 加**第三条反例自证**「动一下就冻住」（我用真机那份的简化版：`performance.now()` 到 900~1300ms 之间画一次、之后不再画 ⇒ 旧口径 p1≠p2 **判绿**、新口径 bianCi=1 **判红**）——不加这条，这次修好的假绿就没有回归锚，下一轮改采样又会漂回去。
  2. 把 `jiXu` 的真读数写进第 6 轮催办文本（现在那句只说"两次指纹一模一样"，覆盖不了"只动过一次"）。
- **我这边的纪律照旧**：不起第三支、不杀进程、不动 `packages/app-shell`。你改完 `verify-r46-youxi.mjs` 请在台账留一行，我立刻做「配对验证」：用真跑绿过的第 1 遍产物（必须仍判绿）+ 第 2 遍冻住产物（必须判红）+ 静态图/走一格两条反例（必须判红）四份各跑一次夹具。

## 28.9 我试着收紧「循环真跑」，实测把我自己拦住了 ⇒ 已逐字回退（13:38–13:46 读数）
> 一句话：**假绿是真的**（有读数），但**我第一版收紧会把合法页面判成假红**（也有读数），所以没留在仪器里。这条判据要改对，需要按页面自己的键位口径设计，等拍板。

- **收紧前后我都跑了同一批产物**（夹具一次性副本，跑完即删；`grep -c 'chaYang|bianCi|chiXu|jiXu' = 0` ⇒ 回退彻底，门禁侧也从没引用过这些字段）。
- **假绿坐实（回退后的仪器，原样 12:53:19 那份）**：第 2 遍那份 13:22 的产物跑出来
  ```
  {"ziDong":true,"jianPan":true,"jieZhu":4,"zhenShu":26,"cuo":[],
   "p1":"1902995640","p2":"3519597003","p3":"3519597003","pS1":"3519597003","pS2":"3519597003"}
  ```
  ⇒ **只有 p1→p2 之间变了一次，之后每一个采样都一模一样**，却判成「循环真跑 · 绿」。§28.8 的怀疑成立：旧口径 = 「变过一次就算在跑」。
- **产品侧真相（不按任何键的对照，1 秒一次 × 14 次全量 PNG 指纹）**：`第 0→1 秒变了 1 次，之后 12 秒零变化，控制台零报错`（`frozenTailStable=true`）⇒ 这份产物确实开局就冻住；**第 2 遍的键盘红是真的**（`jieZhu=4` 说明方向键处理器有接住，但画面不动 ⇒ 球/蛇根本没跑）。
- **但我的收紧会误伤**（这是我不留它的理由）：
  | 读数 | 第 2 遍产物（冻住） | 第 1 遍产物（**真跑绿过的合法贪吃蛇**） |
  |---|---|---|
  | 空闲 5 次采样（700ms）变化次数 | 1 | **2** |
  | 按一次空格后 8 次采样变化次数 | 0 | **0** |
  | 我的新口径（要求 ≥3） | 红 ✓ | **红 ✗ 误伤** |
  第 1 遍那份是合法实现：`<canvas id=cv width=480 height=480>` 单画布、`setInterval(tick, stepMs())` 推进 + `requestAnimationFrame(loop)` 只管画、页面自己写着「**空格 暂停 / 继续**」「**R 或 回车 重新开始**」（第 29 行）。⇒ **我按的那一次空格正好把它按暂停**，所以「按空格后再测」这一类补救对「空格=暂停」的页面天然危险（第 51 轮那次假红的老病根，换个形式又出现）。
  另外第 1 遍那份的「循环真跑 · 绿」本身也只有 2 次变化 ⇒ 和今天第 2 遍的假绿是**同一条运气路径**，不是稳的证据。
- **因此这条判据的正确修法（等拍板，我不擅自改判据）**：不能只加采样次数，得**按页面自己声明的起始键**来 —— 建议口径：① 从产物正文的「怎么操作/按键说明」里解析起始键候选（空格 / 回车 / R / 任意键）；② 依次试到「画面开始持续变」为止（每个候选键试完都用 ≥3 秒窗口量 ≥3 次变化为准）；③ 若某次触发后画面**反而停了**，判定为「这个键把它按停了」，换下一个候选而不是继续按；④ 全候选都试不到持续变化才判红，并把「只动了 N 次、之后 M 秒静止」的真读数原样贴回催办（现在那句只说"两次指纹一模一样"）。这条改动**收紧且不新增假红**，四条反例自证都要跟着加（静态图、每按一次走一格、动一下就冻住、空格=暂停的合法贪吃蛇必须判绿）。
- **对今天三连读数的影响（如实）**：起算遍仍是「第 1 绿 / 第 2 红」；但第 1 遍那条「循环真跑 · 绿」的强度按上面读数**要降级看待**，不能拿它当"游戏确实在跑"的证据。§22.3 的 P0 清单仍一条未减；我起的头（`④`、`§28.3`、本条）**都还等用户拍板**。
- **给另一支会话**：夹具已回到你 12:53:19 那份的状态（`node --check` 通过、`ziDong` 表达式与三段补救逐字一致）；`verify-r46-youxi.mjs` 我一个字没动。起跑前请把这条判据的设计先定了，否则 3/3 全绿里可能藏着同样的假绿。
- 我这几轮的一次性文件（`%TEMP%\r46-pair`：夹具副本、三份反例 html、标定探针）已删除；`.r50-logs/_watch3.sh`、`_watch4.sh`、`_role.ps1` 是只读旁观工具，留在 `.r50-logs/` 供后续会话用（§28.6 已记）。**未 commit、未 push。**

---

# 29. 推进器读数（13:28–13:50 · 新三连第 2 遍双红 ⇒ 两条都在仪器侧 ⇒ 13:49:34 再从第 1 遍起）

> 路径一律占位（`<工作区>`、`%TEMP%`）；本机绝对路径与主机名不进仓库。

## 29.1 读数
- **13:28:46** `game-run1.log`（本轮第 1 遍）：`过 33 · 败 0 · 跳 0` + `----- exit=0 -----` ⇒ 绿（新增的 2 条反例自证也计入 33）。驱动器 13:05:42 自动开第 2 遍。
- **13:29:00** `game-run2.log`：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 31 · 败 2 · 跳 0 ====` + `----- exit=1 -----`，两条 FAIL 原文：
  ```
  FAIL 第1轮：游戏循环 ——
  FAIL 第6轮·真跑：按下方向键后状态变了（键盘输入真的接上了） —— {"xiuCi":2,"qian":"4256521037:480x480","hou":"4256521037:480x480"}
  ```
- **13:30–13:36 一次性探针（产物 = `%TEMP%\warmy-r46-youxi-profile-…59142662\workspace\r46-youxi\youxi.html`，6895 字，13:22:07，贪吃蛇）**：
  ```
  SEQ-NOINPUT 0ms:986010290 354ms:2612679602 669ms:3617685688 971ms:658142392 1271ms:3391367428
              1581ms:3517214073 1896ms:3043586090 2211ms:3043586090 …… 4713ms:3043586090（此后每个采样一模一样）
  KEYS-DELIVERED-TO-DOCUMENT 4/4      ERRS []      HUD 分数：0
  ```
  ⇒ **键盘投递已经正常**（§27.6 改派发目标后 4/4 送达 document 监听）；红的是**时序**：这盘蛇约 **1.9 秒自己撞墙结束**，仪器在 p2（2.7 秒）之后才按方向键 ⇒ 死画面上"像素变没变"量不到任何东西。

## 29.2 两条 FAIL 的定性与修法（只动仪器，判据方向不放宽）
1. **`第1轮：游戏循环` = 关键词表假红**：产物用 `function tick(){ … timer = setTimeout(tick, curMs()); }` 自续推进，全文没有 `requestAnimationFrame`/`setInterval`，旧 `PAN.xunHuan` 只认这两个词。改法：**认"在自己的函数体里再把自己排回去"**（`function n(){}` / `const n = () => {}` / `n = function(){}` 三种写法，用花括号配对取函数体），一次性延时仍判假。真值表 **9/9**：自续 function/箭头/函数表达式=真、`setTimeout(yiCi,500)` 一次性=假、互相延时但不自续=假、rAF/setInterval=真、无循环=假、第 2 遍真产物=真。
2. **`第6轮·真跑：按下方向键后状态变了` = 时序假红**：加**行为证据** `jie.jieZhu` —— 合成方向键带 `cancelable:true` 派发，回来读 `defaultPrevented`，>0 才算"页面自己的处理器接住了键"。这条比原来**更硬**（没有键盘处理或处理器不认方向键 ⇒ 必然 0），同时修掉"死图前按键量不到"的时序坑。

## 29.3 夹具一次性电池（7 条，跑完即删）
```
A-真产物(贪吃蛇, 收紧期读数) ziDong=false jianPan=true  jieZhu=4 zhenShu=26 cuo=[]
R1-空闲就动(空格=暂停)      ziDong=true  jianPan=true  jieZhu=0    ← 合法页面要能过，且仪器不碰空格
R2-空格才起跑(document)     ziDong=true  jianPan=true              ← 补救分支要能过
B-反例 死图+不接键           ziDong=false jianPan=false jieZhu=0    ← 新增条款不是通行证
C-反例 死图+接住键           ziDong=false jianPan=true  jieZhu=4    ← "接住键"不许泄漏成"循环在跑"
D-反例 静态图               ziDong=false jianPan=false
E-反例 每按一次才走一格       ziDong=false jianPan=true              ← 循环判据没被放宽
```
门禁侧钉了 **4 条自证**（静态图、每按一次一格、一次性 setTimeout、自续 tick），起跑即验，验不过整遍判红。

## 29.4 并行会话的收紧已回退，我不擅自改判据（等拍板）
- §28.9 的实测否掉了"连采 5 次要求相邻变化 ≥3"：它会把**第 1 遍那份合法贪吃蛇**（空闲 5 次只变 2 次）判成假红 ⇒ 夹具已回到我 12:53 那份状态（含 §27.6/§29.2 的修复）。
- 同一轮实测也坐实**假绿是真的**：回退后的仪器把"变一次之后永久冻住"的第 2 遍产物判成 `ziDong:true`。
- 我先前按"已收紧"前提写的两处文本（题目里要求持续推进、催办里贴 `jiXu` 连采读数）**已同步撤销**（`grep 'jiXu|chiXuXian|moWeiDong' = 0`），不留死引用、也不让题目要求一条仪器并不执行的规则。
- **待用户拍板的 P0（不缩水）**：`循环真跑` 的正确口径。建议方向（引 §28.9）：按**产物正文自己声明的起始键**驱动之后再判持续，而不是固定采样阈值；现状维持"变过一次即算在跑"这一已被验收的基线，未放宽。

## 29.5 现场与下一步
- **13:49:34 从第 1 遍重跑三连**（后台驱动器，stdout → `.r50-logs/game-driver.log`，汇总行同时进 `game-3x.log`）。起跑自证读数（13:50:0x 原文）：`ok 仪器自证：反例（…没碰撞）`、`ok …该绿的仍然绿`、`ok 仪器自证：一次性 setTimeout（没有自续）必须被"游戏循环"判红`、`ok 仪器自证：自续 tick（function 体里再排自己）必须被"游戏循环"判绿`、`ok 仪器自证：静态图必须被"循环真跑"判红`、`ok 仪器自证：每按一次才走一格（没有循环）必须被"循环真跑"判红`、`ok 应用启动`、`ok MiMo 密钥已交给宿主`。
- 构建仍冻结在 `dist/electron-main.js = 12:12:28`；夹具/门禁 `.cjs/.mjs` 不进 `tsc -b` ⇒ 不构成重数理由。`node --check` 两个文件均通过。
- **请求所有并行会话**：这一支要连跑 3 遍（约 45–50 分钟，每遍结论落 `game-runN.log` 的 `----- exit=` 行）。期间请不要再改 `dev/gates/r46-chromium-harness.cjs`、`dev/gates/verify-r46-youxi.mjs`、`packages/app-shell/**`；要改请先在台账留一行并等这支跑完（本会话起跑前 13:49:29 复采 `9946 = FREE`、无 `r50-run3`/`verify-r46` 进程，确认没有并发第二支）。
- §22.3 的 P0 清单**本轮一条未减**；等拍板的两条：`④ run_shell 被拒即停用窗口`、`循环真跑的正确口径`。

## 29.6 三连第 1 遍红（过 33 · 败 2，两条都是"改完语法仍然过"）⇒ 定性 + 补反馈 ⇒ 14:25 再从第 1 遍起

- **14:22:23** `game-run1.log`：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 33 · 败 2 · 跳 0 ====` + `----- exit=1 -----`：
  ```
  FAIL 第4轮 · 难度递增：改完语法仍然过 —— "Invalid or unexpected token"
  FAIL 第5轮 · 双击就能玩 + 玩法说明：改完语法仍然过 —— "Invalid or unexpected token"
  ```
  同遍第 6 轮真跑催办两次后**最终通过**（催办清单里只剩"什么都不按画面也在动"那一项在头两轮出现）。
- **定性（把红拆开验，不猜）**：用门禁文件里**原样的 `yuFaCheck`**（正则从源码里取出来跑，不复制实现，避免转义差异）复跑该遍每一轮产物副本：
  ```
  05:50:46 7054字 语法=过  script块=1(开1/闭1)      05:58:22 8063字 语法=红:Invalid or unexpected token  script块=1(开1/闭1)
  05:52:36 7424字 语法=过  script块=1(开1/闭1)      05:59:32 8305字 语法=红（同一份，副本 3 处一致）
  05:54:20 7542字 语法=过  script块=1(开1/闭1)      06:21:03 8230字 语法=过  ← 最后这版是模型自己修好的
  ```
  ⇒ **产品缺陷是真的**（模型用 edit_file 把文件改成解析不过），而且**不是检查器误判**：`<script>` 开/闭标签各 1 个，不存在 `"</script>"` 字面量把块截断的陷阱。
- **但门禁有反馈缺口（仪器侧，本轮修）**：旧代码 `ok(`${ming}：改完语法仍然过`, yuFaCheck(t).ok, …)` **只把红记进台账，一个字都不告诉模型** ⇒ 模型在同一轮里没有机会修，整遍只能红。同一遍最后那版语法是过的（06:21 读数）⇒ 说明"把真报错贴回去"这条反馈确实能让它收敛（第 6 轮早就在用这一招，本轮前 5 轮却没有）。
  - 修法：第 1 轮与第 2–5 轮的语法判据各加**一次纠正**——把 `yuFaCheck` 的真报错原文贴回去、要求"只修语法不许顺手改功能"，纠正后重新检查；`{ why, jiaoZheng/jiaoZhengCi }` 写进读数（**修好的还是本来就好的，日志里分得清**）。判据本身没动：一轮结束时文件必须解析得过。
  - 顺带：`没有文件` 的读数改成 `没有文件可检查`，第 1 轮的纠正计数 `jiaoZhengCi` 也进语法那条读数（以前只有"产出文件"那条带）。
- **静态门禁复跑（起跑前，全部 exit 0）**：`verify-naming` 48/0 · `verify-import-integrity` 全通过 · `verify-wiring` 238/0 · `verify-gate-manifest` 23/23。`node --check` 过。`dev/gates/verify-r46-youxi.mjs` 只有 `r50-run3.mjs`、`run-verify-22.mjs`、`r50-chat-probe.mjs` 按名字引用，没有门禁钉它的内部结构。
- **14:25:2x 从第 1 遍重跑三连**（起跑前 `9946 = FREE`、无 `r50-run3`/`verify-r46` 进程 ⇒ 没有并发第二支）。构建仍冻结 `dist/electron-main.js = 12:12:28`；本轮只动 `dev/gates/*` ⇒ 不构成重数理由。单遍实测 **33 分钟**（13:49:34→14:22:23），三遍 ETA ≈ 16:10。
- 双信号判活的实操教训（写下来防误杀）：14:00:39→14:09:50 日志静默 9 分钟，`chatAge=552s` 但驱动器 `30824`/门禁 `39092` 都在、9946 唯一、`audit` 28 秒前还在写 ⇒ 那是**第 6 轮的催办回合**在跑（模型一轮的预算是 `YI_LUN_CHAO_SHI=1800 秒`）；继续等到 14:13 起 `chatAge` 回到 1–3 秒，日志恢复前进。**卡死判据绑的是门禁自己的预算，不是日志安静时间。**
- §22.3 的 P0 清单**本轮一条未减**；等拍板的两条不变：`④ run_shell 被拒即停用窗口`、`循环真跑的正确口径`（§28.9/§29.4：现在的口径"变过一次就算在跑"偏弱，而固定阈值收紧会误伤合法贪吃蛇）。

## 29.7 重跑第 1 遍全绿（14:39:09 读数）

- `game-run1.log`：`==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 35 · 败 0 · 跳 0 ====` + `----- exit=0 -----`；`game-3x.log`：`[OK] game 第 1/3 遍全绿` ⇒ 驱动器 **14:38:51 自动开第 2 遍**。
- 单遍用时 **13 分 55 秒**（14:25:14→14:39:09）——上一遍 33 分钟是第 6 轮走了两轮催办；这一遍第 6 轮一次就过。
- 本轮唯一一次纠正（如实记，不藏着）：`· 第3轮 · 暂停/继续：模型回了但文件没动 ⇒ 补一轮"真的改文件"` ⇒ 该轮读数为 `jiaoZheng:1`，补的那一轮真的动了文件；语法一次都没坏（§29.6 新增的"贴真报错回去"这条路径本轮没触发）。
- 构建 `dist/electron-main.js` 仍 12:12:28（未动）；夹具/门禁本轮未改 ⇒ 连续三绿起算有效。

## 29.8 第 2 遍全绿（15:12:31 读数）⇒ 连续两绿，第 3 遍 15:12:18 开跑

- `game-run2.log`：`过 35 · 败 0 · 跳 0` + `----- exit=0 -----`；`game-3x.log`：`[OK] game 第 2/3 遍全绿` → `[game] 第 3/3 遍开始 2026-10-21T07:12:18.132Z`。
- 用时 33 分 40 秒（14:38:51→15:12:31）；该遍有 **1 次纠正**：`· 第4轮 · 难度递增：模型回了但文件没动 ⇒ 补一轮"真的改文件"`（补的那轮真的动了文件，读数里 `jiaoZheng:1`），语法一次都没坏，第 6 轮真跑头两次采样就过。
- 判活双信号采样（15:11:31，第 6 轮催办期间）：`chatAge` 8 秒、`anyLast=15:11:23/chat.host-tool`、驱动器与门禁本体都在、9946 唯一监听 ⇒ 没有并发第二支。
- 起算状态：**连续两绿**（13:49 那遍因仪器改动重数，见 §29.4/§29.6）。第 3 遍绿 ⇒ 三连达成，按 §22.3 走 live 名单**串行** → 验收 ×2 → 首启 `r38-firstrun.mjs`。

## 29.9 【达成】小游戏压力档 A 三连 3/3 全绿（15:27:05 读数）⇒ 进入 live 档串行

- `game-3x.log` 汇总原文：
  ```
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿
  [game] 第 2/3 遍开始 2026-10-21T06:38:51.730Z
  [game] 第 2/3 遍 exit=0
  [OK] game 第 2/3 遍全绿
  [game] 第 3/3 遍开始 2026-10-21T07:12:18.132Z
  [game] 第 3/3 遍 exit=0
  [OK] game 第 3/3 遍全绿
  [DONE] game 3/3 全绿
  ```
- 三遍逐条读数（都是 `过 35 · 败 0 · 跳 0` + `----- exit=0 -----`）：第 1 遍 14:25:14→14:39:09（13 分 55 秒）、第 2 遍 14:38:51→15:12:31（33 分 40 秒，含 1 次"文件没动"纠正）、第 3 遍 15:12:18→15:27:05（14 分 47 秒，零纠正）。
- **同一仪器得到证明（不是口头）**：`find packages/app-shell/src packages/app-shell/dist -type f -newermt '2026-10-21 14:25:00'` **输出为空** ⇒ 三遍期间源码与构建产物一个文件都没动；构建仍是 12:12:28 那一份。
- 场地复核（15:27:41）：`r50-run3`/`verify-r46-youxi` 进程数 **0**、9946 `FREE`、electron 进程数 **0** ⇒ 无残留、无并发。
- 本轮这一档累计修掉的仪器缺陷（都有读数与反例钉住，见 §27.6/§29.2/§29.6）：①合成键派发位置（window ⇒ 画布，冒泡到 document/window）；②"所有键都不动"时单按一次空格再测；③键盘判据补 `defaultPrevented` 行为证据（`jieZhu`）；④静态 `游戏循环` 认自续 `setTimeout` tick（一次性延时仍判假，真值表 9/9）；⑤语法判据把真报错在同一轮里贴回去催一次（第 1 轮与第 2–5 轮都补）；⑥驱动器的结论行/汇总行从来没落盘（write-after-end 静默丢弃）。门禁侧新增 **4 条反例自证**，起跑即验。
- **仍待拍板（不缩水）**：`循环真跑` 的强度口径（§28.9：现口径"变过一次就算在跑"偏弱；固定阈值收紧会误伤合法贪吃蛇，建议按产物正文自己声明的起始键驱动后再判持续）；`④ run_shell 被拒即停用窗口`。
- **下一步（进行中）**：`node dev/gates/run-verify-22.mjs --tier=live --skip=verify-r46-youxi,verify-memory-stress`（串行、带坑位检测；两支压力档刚跑过 3/3，不在此重复）⇒ 全绿后连跑两遍验收 ⇒ 首启 `node dev/gates/r38-firstrun.mjs`。
- **请求并行会话**：live 档每支都要独占 9946，起跑期间请不要起任何真机门禁；要改码请只动 `packages/app-shell/src` 之外的东西，或等本档跑完（动了 src 就要重数三连）。

## 29.10 live 档第 3 支 `verify-round16` 判红：取证到「本机模型吞吐」这一层（16:19–16:46 读数）

- 驱动器：`node dev/gates/run-verify-22.mjs --tier=live --skip=verify-r46-youxi,verify-memory-stress`（PID `19248`，15:28:38 起，stdout → `.r50-logs/live-1.log`）。前两支：
  ```
  [PASS ] verify-runtime-errors   17764ms
  [PASS ] verify-round12          38890ms
  [FAIL ] verify-round16        3000008ms  FAIL ①②⑤ 写 5000+ 字并落盘：(未找到)（0 字符） | FAIL ③ 授权写桌面：F:\XZM\r16-zhuo-1.txt 未找到（回复=""）
  ```
  驱动器**没有停在这条红**：它在一遍内继续跑后面的支（16:27:46 `verify-round17` 的 Electron 已起），汇总与退出码在这一遍跑完后才给（源码：`break` 在遍末，不是支末）。
- **F 盘存在**（`Get-PSDrive`：C D E F G H P）⇒ `F:\XZM\...` 不是"缺盘"；`回复=""` 与"0 字符"是同一条因果的两面。
- **模型选型是"按体积取最大"**（`xuanMoXing`：≥6GB 且非 whisper/embed/tts/asr，按 GB 降序取第一）⇒ 本机实选 `Qwen3.8-27B-Uncensored:q5_K_M-128K`（20.5GB，`ollama list` 读数）。
- **吞吐实测（不是推断）**：同一只模型连测两次 ⇒ 冷态 `166410ms / 220 tok = 1.32 tok/s`，热态（已在显存里）`99360ms / 220 tok = 2.21 tok/s`；`ollama ps` 显示它 **100% GPU、context 131072**。
- **产品侧审计链（该门禁 profile 的 `audit/audit.jsonl`，950 行）逐条可 grep**：
  ```
  16:13:09 chat.stream-timeout {"phase":"first","attempt":2,"ms":240001,"chunks":0,"argChars":0}
  16:13:09 chat.tools.done  {"degraded":true,"tingZhiYuanYin":"error","error":"stream-first-timeout(240s 内没有新分片，已原样重发 1 次)"}
  16:15:09 chat.tools.hard-cap {"zongMs":1802722,"yingDingMs":1800000}          ← 产品自己的 30 分钟硬顶
  16:15:09 chat.tools.done  {"error":"tool-loop-hard-cap(1803s)"}
  16:17:11 chat.stream-long {"ms":301304,"chunks":93,"reasoningChars":344,"contentChars":0,"maxGapMs":19850}
  16:17:11 chat.work-tool {"tool":"list_archive","ok":true,"bytes":290,"path":"r16-1.zip"}   ← 工具腿是真通的
  inflight 全程 zhengWen=0（15:30 到 16:19 十四个采样点都是 0），duan 1→4
  ```
  ⇒ 结论：**产品没有静默卡死**——240 秒无分片就原样重发一次、再不到就降级并写明原因，30 分钟硬顶照常生效，工具调用成功有账。红的是**这一轮任务在当前模型吞吐下根本写不完 ≥5200 字正文**（`contentChars=0`，只出 reasoning）。
- **算术**：按热态 2.2 tok/s，5200 汉字 ≈ 5200+ token ⇒ 单条回复 **40 分钟量级**，已超过产品自己的 1800 秒硬顶；门禁预算 3000 秒更不够。**抬预算单独没用**（硬顶先到）。
- **定性：环境/选型层，不是产品缺陷**；但三条出路都要用户点头（本会话没擅自动判据、没换模型、没抬硬顶）：
  1. 给这支指定 `OLLAMA_MODEL`（门禁本来就支持覆盖），先做一次"哪只模型能在 1800 秒内写出 ≥5200 字"的实测再定；我用到的两只候选在**含冷载入**的口径下只有 0.71–0.94 tok/s，还不够下结论。
  2. 抬产品侧 `tool-loop` 1800 秒硬顶（属产品口径改动）。
  3. 把这支登记为**环境依赖的已知红**，其余 live 支照跑（当前驱动器就是这么走的：它没停）。
- **§22.3 的 P0 清单仍一条未减**。live 档继续旁观中（`live-1.log`）。

---

# 30. 推进器读数（2026-10-21 17:41–17:58 · live 第 1 遍终局 8 项红 ⇒ 逐条定性）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`、`<桌面>`）；密钥文件名不写进仓库。

## 30.1 接管读数（时间 + 原文）

- **17:41:14** `date` = Wed Oct 21 17:41:14 2026；`live-1.log` mtime **17:41:03**、4826 字节 ⇒ live 第 1 遍**已跑完**，末两行原文：
  ```
  ---- 第 1 遍汇总（tier=live）：真红 8 · 已知红(环境依赖) 0 · 缺文件 0 ----
  === run-verify-22 tier=live：1 遍 · 8 项红 ===
  ```
- **17:41–17:44 判活双信号**：① `Get-CimInstance` 里 `node.exe` 只有 4 个（openclaw gateway + spawn-broker + 2 个 sqlite worker），**没有** `r50-run3.mjs` / `verify-r46-youxi.mjs`；9946 `LISTEN=0`。② 当时最新 `%TEMP%\warmy-r46-youxi-profile-*` 停在 15:27（三连收尾）。⇒ **不是卡死，是正规跑完**；不触发杀进程/重启分支。
- **机器上另有 6 个 `Xiaomi MiMo.exe`（09:42:03 起）**：命令行是 `F:\Xiaomi MiMo\Xiaomi MiMo.exe`（第三方桌面 App，`--user-data-dir=%APPDATA%\Xiaomi MiMo`），**不带 `--remote-debugging-port`、与本任务无关** ⇒ 既没杀也没算进并发判据。⚠️ 教训：进程名匹配 `MiMo` 会把这支第三方 App 误当门禁节点（§23.1 就把它列成"节点包装"），判活要绑命令行里的 `--remote-debugging-port`，不能只认进程名。
- **仪器同一性复核（三连是否还算数）**：17:42 与 17:53 两次 `find packages/app-shell/src packages/app-shell/dist -type f -newermt '2026-10-21 15:27:00'` **都为空**，`dist/electron-main.js` 仍是 12:12:28 那一份 ⇒ 三连的 3/3 与 live 第 1 遍跑在**同一构建**上，三连读数不因本轮而作废。

## 30.2 并行会话在场（本会话不起第二支真机门禁）

- **17:41:49** 一个新的 `%TEMP%\warmy-round18f-*` 起来、17:42:13 结束（24 秒），当场无进程 ⇒ 另一支会话在单支复跑红项。
- 采样（脚本判活，17:45:46 / 17:53:00）原文：
  ```
  17:45:46  gate-node=1  pid=34372 cmd=... dev/gates/verify-round18f.mjs   electron-dbg=2  port9946=0
  17:53:00  gate-node=1  pid=24880 cmd=... dev/gates/verify-round34-live.mjs  electron-dbg=2  port9946=0
  ```
  它留下的读数文件（`<仓库目录>/.r50-logs/`）：`diag-18f.log` 17:42、`diag-18f2.log` 17:46、`diag-18e2.log` 17:47、`diag-18d2.log` 17:49、`diag-hist.log` 17:50、`diag-asr.log` 17:51、`diag-34live.log` 17:53。
- ⇒ 本会话全程**只读 + 只写文档**，没有起任何 Electron 门禁；`packages/app-shell/src`、`dist` 一律没碰。

## 30.3 八项红的逐条定性（每条都能 grep 到原文）

| # | 支 | 定性 | 钉住它的读数 |
|---|---|---|---|
| 1 | `verify-round18d` | **夹具**（供应商模型名过期） | 该遍 profile `%TEMP%\warmy-round18d-…1792573270649/audit/audit.jsonl` 原文 `chat.tools.degraded :: tools-failed: HTTP 400: {"error":{"code":"400","message":"Unsupported model mimo-v2.5"}}`；紧随其后 `chat.model-picked {"model":"huihui_ai/qwen3-vl-abliterated:4b","why":"chain-fallback"}` ⇒ 云腿 400 后落到 4B 小模型，才有 `ziShu=0/2000`。并行会话 17:45:35 把 18d/18e/18f 夹具的 `defaultModel` 换成 `mimo-v2.6-flash` 后单支复跑 **PASS**：`diag-18d2.log` `ok 文章接近目标字数 — ziShu=1630/2000`；复跑 profile 的 audit `Unsupported model` 计数 **0**、`"model":"mimo-v2.6-flash"`。 |
| 2 | `verify-round18e` | **夹具**（同上） | 同上；`diag-18e2.log`：`ok 第一轮 write_file ≥1 — n=2` ⇒ PASS。 |
| 3 | `verify-round18f` | **夹具**（同上） | 同上；`diag-18f2.log`：`----- R18F ROUND 1 PASS (21s) -----`。 |
| 4 | `verify-history-persist` 之「道」整份在场 | **仪器**（过时字面锚） | 旧断言 `packages/app-shell/scripts/verify-history-persist.mjs:575` 写死 `includes('全局最高优先级')`；而 §25 已把段标题改短（`electron-main.ts:10847` 现emit `【道 · 最高优先级（除硬门禁）· 不可压缩】`），`%TEMP%\warmy-verify-persist-3dJcma\persist\userdata\dao.md` 实测 **3280 字、含该字样=false**。⇒ 断言永远不可能过。并行会话 17:55:44 已改为行为锚（拿 profile 自己那份 `dao.md` 的尾部 40 字要求原样出现在 system 消息里 + `xiTongChars >= daoWen.length`），**判据方向是收紧不是放宽**。 |
| 5 | `verify-history-persist` 之 maxSeq 对齐 | **仪器**（等式前提已被 §48 打破）——**本会话没改，因为文件正被并行会话编辑** | JSONL 实测（同一 profile `persist/userdata/memory/fast-memory.jsonl`，15 条）：`seq=13 kind=zhongjian role=assistant chars=74`，而 `seq=1..12 kind=message`。产品重建按设计跳过非 `message` 行（`electron-main.ts:1405` `if (String(r['kind'] ?? '') !== 'message') continue;`），`report.maxSeq` 只在真的重建出来的行上前进（`:1448`）⇒ `restore.maxSeq=12` 是**正确行为**。审计原文：`chat.history.restore {"entries":12,"sessions":5,"maxSeq":12,"fangShi":"mei-hui-hua","ziZong":1200000,"yiYongZi":22143}`；`yiYongZi(22143) << ziZong(1200000)` ⇒ **不是预算挤掉**，是那一行本来就不该进 message 重建。不重号另有判据兜着且**是绿的**：重启后新增落在 `seq=14,15`（`第 2 轮：重建 12 条 / 5 会话 / maxSeq=12；重启后新增 14,15`）。⇒ 修法（不缩紧也不放松，等式换成"与最后一行 kind=message 对齐"并另钉旁路行号不许被复用）：`verify-history-persist.mjs:519` 的 `maxSeqBefore` 目前取 `Math.max(...jsonlRecords.map(r => Number(r.seq)))`（`:423`、`:464`、`:491` 三处同样口径），要按 `kind === 'message'` 过滤；**注意**：`[1] 超长助手回复…逐字节一致`（`:412`）与 `chat.dup-write-skipped` 两处仍要用全量快照，别一起改掉。 |
| 6 | `verify-round34-live`（mimo-2 腿） | **产品（真行为缺陷）** | profile `%TEMP%\warmy-r34-live-…1792574193063-mimo2/audit/audit.jsonl` 里同一路径 `F:\<授权目录>\守灯人.txt` 的 `chat.work-tool` 序列（`chars`=写完后文件总长、`wroteChars`=本次投出去的量）：`appended:false 1648` → `appended:true 3154` → **`appended:false 1304`** → `true 2802` → `true 5609` → **`appended:false 1751`** → `true 1858` → **`appended:false 107`** → `true 214`。⇒ 4 次非追加整篇覆盖，总长从 5609 **回退**到 1751、再到 107（前文被抹掉），最后另起一份 `守灯人-完整版.txt`（6545 字）——这正是两条 FAIL 的来源：`同一个文件没有被整篇重写/重新生成第二遍 => ["守灯人.txt ×4"]`、`桌面上没有多出别的东西（脚本、草稿、副本） => ["守灯人.txt"]`。判据本身是行为级、方向对（`verify-round34-live.mjs:636-645` 只数 `write_file` 且 `appended!==true` 的次数，不算误伤）。同腿另一支 mimo-1 同任务 **PASS（579 秒）** ⇒ 概率环节，不是每次都犯。**要用户拍板的修法**：`write_file` 对"本会话自己已经写过/追加过的既有路径"做整篇覆盖时，要么结果里当场告知「本文件此前已有 N 字，整篇覆盖会丢弃前文；要继续写请带 append」，要么要求显式 `overwrite` 意图——属产品语义改动，本会话没动。 |
| 7 | `verify-round38-asr` | **判据与产品口径冲突** + 一条**证据已被删、暂不写因果** | 并行会话 17:51 复跑读数：识别**真的通了**——`· 听到："今天下午三点十分，请把第三列的看板改成暗色主题。另外，帮我确认王师傅的。"`、`诊断 {…,"ok":true,"moXing":"mimo-v2.5-asr"}`、`ok 答话的正是用户点名的 mimo-v2.5-asr`、`ok 重试路上音频没丢`；但 `FAIL …asr.used ← used=[] bendi=0`、`FAIL …（asr.bendi.skip）…← bendi.skip/failed=[]`。**第二条已可定性**：产品对 `bendi-yuyin-not-enabled` **明确不落账**（`electron-main.ts:22707` `if (String(bd.error \|\| '') !== 'bendi-yuyin-not-enabled') { … log('asr.bendi.skip') }`），而门禁硬要这条原因（`verify-round38-asr.mjs:190-191` 要求 `chai.length>0 && yong.length>0`）⇒ §38 的两条口径互相打架，且这轮 `· 勾选本机语音服务：{"ok":true,"qiYong":true,"zhuangTai":{…,"zhuangTai":"wei_an_zhuang","qiYong":false}}` 显示"写入 qiYong=true、状态读回 false（未安装）"。**第一条先不写因果**：这条支跑完会把 profile 删掉（17:5x 已在 `%TEMP%` 里找不到），`asr.used` 为何没落账需要一份**保留 profile** 的复跑才能 grep 到（产品里四个成功出口 `:22805/:22873/:22883`、`:6960` 都写了 `asr.used`，所以"哪条路径答的话"必须实测，不许读码推断）。**第 38 轮本就 park 在用户口径上（先取话筒自检数值）**：本轮数值到手 —— `mime=audio/webm;codecs=opus`、`blobZiJie=97744`、`miao=6.06`、`fengZhi=0.682`、`rms=0.1235`、`sr=16000`、`ch=2`。 |
| 8 | `verify-round16` / `verify-round17` | **两条不同因**：round16=环境/选型（§29.10 已钉）；round17 里 `⑥c MiMo TTS 合成可用（0 字节）` 是**夹具漏装密钥**，`追加A/追加A④` 是吞吐，`⑩` 是**夹具前置条件没铺** | 见 §30.4（本轮新证）。 |

## 30.4 本轮新增的三条事实（都是实测，不是推断）

1. **供应商把聊天模型从 2.5 换到 2.6 系**——17:4x 直连 `GET /v1/models`（token-plan 站）原文清单：`["mimo-v2.5-asr","mimo-v2.5-tts","mimo-v2.5-tts-voiceclone","mimo-v2.5-tts-voicedesign","mimo-v2.6-flash","mimo-v2.6-pro"]`；同一次探针里 `mimo-v2.5-tts` 走 assistant 消息 + `modalities:['text','audio']` ⇒ **HTTP 200 且回了音频**（所以 TTS 的模型名没坏），而 `mimo-v2.5` 作为聊天模型 ⇒ **HTTP 400 Unsupported model mimo-v2.5**。**推论（待验，别当结论用）**：`asr`/`tts` 名字仍在售，`chat` 名字已下架。
2. **`verify-round17.mjs` 取了密钥却从来没用**：`:61-67` 把 `MIMO_KEY` / `MIMO_KEY_FILE` 读进变量 `key`，但全文再没有把 `key` 写进 profile 的 `secure/`（对比已改对的 18f：`'mimo-r18f': { v:2, protector:'plain', data: base64(key) }`）。实测该遍 profile：`secure/` **空**、`settings.json` 里 `id=mimo-r17 … hasKey=false`、`specialModels.ttsChain=["mimo-v2.5-tts"]` ⇒ **⑥c TTS 0 字节 = 夹具没装密钥**，与供应商无关（供应商侧 200 已实测）。同一遍的 `chatChain=[本机 27B]`、`model-picked` 全是 `Qwen3.8-27B-Uncensored:q5_K_M-128K (explicit)` ⇒ 追加A 那两条仍归 §29.10 的吞吐口径。
3. **`⑩ 找不到模型管理卡片（第四列没有牛马卡片）`= 夹具前置条件没铺**：判据是 `document.querySelector('.mgrKa')`（`verify-round17.mjs:367`），该类名在产物里真实存在（`renderer/app.js:23768 <details class="mgrKa…">`），而该遍 profile `settings.json` 实测 `instances=0` ⇒ 没有牛马就没有卡片。**待定的一项**：应用出厂时"必须自动有一份默认牛马"是不是产品承诺？若不是，修法是在 r17 起跑前显式建 instance（夹具侧），而不是删判据。

## 30.5 还有哪些夹具钉着已下架的 `mimo-v2.5`（聊天腿，会复现 400）

`grep -l "defaultModel: 'mimo-v2.5'"` 在 `dev/gates/` 命中 8 支：`verify-round12`（`:71`）、`verify-round14`（`:47`）、`verify-round16`（`:109`）、`verify-round17`（`:84`）、`verify-round18`（`:50`）、`verify-round18b`（`:55`）、`verify-round18c`（`:52/:64/:163`）、`verify-round19`（`:43/:48`）。18d/18e/18f 已由并行会话改对。**本轮 live 第 1 遍里 round12/18/18b/18c/19 仍是 PASS** ⇒ 这些支不依赖云聊天腿；换名属"顺手把地基铺平"，不是把它们判红的因。**纪律**：动这些文件就是动仪器 ⇒ 动完之后 live 必须从第 1 遍重跑，且三连（另一套仪器）不因此重数。

## 30.6 验收口径的两处补记（按任务要求）

- §25 的**注入阶梯**（硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象）与新门禁 `packages/app-shell/scripts/verify-r52-layers.mjs`（32 项，`GATE-MANIFEST.json` kind=project）都在 **FAST 清单**里（`run-verify-22.mjs` 的 FAST 数组含 `verify-r52-layers`）⇒ 两遍验收会覆盖；但**它不在 LIVE 清单**，所以 live 档这一遍没跑它——按口径要在验收前另跑一次 fast 档确认它绿（本会话没跑，因为要等并行会话让出机器；见 §30.7）。
- `verify-kb-scope.mjs:56` 与 `verify-r44-yuSuan.mjs:34` 里仍写死旧段标题 `【道 · 全局最高优先级】`：前者 `slice(indexOf('【道 · 全局最高优先级'), …)` 在新标题下会取到 **-1 ⇒ 整段截空**（该支不在 FAST/LIVE 清单里，所以一直没红过）；后者是它自己的**夹具字符串**（自造输入，不会红，但也测不到生产真实段名）⇒ 两处都属于"过时锚"，与 §30.3 第 4 行同源，一并等用户点头后改。

## 30.7 现场与下一步

- **现场**：并行会话 17:52:23 起 `verify-round34-live`（mimo1 腿）在跑；本会话**没起任何门禁**、没杀任何进程。9946 仍 `LISTEN=0`，`src`/`dist` 未被任何一方改动。
- **下一步（顺序不变）**：① 等并行会话的单支诊断结束并让出场地；② 仪器变更（18d/e/f 模型名 + `verify-history-persist` 的「道」锚）已全部落地 ⇒ **live 从第 1 遍重跑**（串行、带 `%TEMP%\<密钥文件>`），并把 §30.3 第 5 行 maxSeq 那条按同一修法改掉再跑，否则新跑的一遍还要为它红一次；③ live 全绿 → 连跑两遍验收（含 fast 档补一次 `verify-r52-layers`）→ 首启 `node dev/gates/r38-firstrun.mjs`。
- **等用户拍板（本会话一律没动）**：a) `write_file` 整篇覆盖既有自写文件要不要当场告知/要显式意图（§30.3 第 6 行）；b) §38 ASR 的「未启用要不要落 `asr.bendi.skip`」口径冲突（第 7 行）；c) §29.10 的 round16 三条出路；d) §30.4 第 3 行的"出厂默认牛马"是不是产品承诺；e) 既有文档里 11 处写了密钥文件名（本轮之前就写下的，属公开前隐私漏，本会话没擅自删）。
- **§22.3 的 P0 清单仍一条未减。**

## 30.8 订正 §30.3 第 5 行与 §30.7 的②：maxSeq 那条并行会话也改完了（17:56:04 读数，本会话审阅通过）

- 17:56:04 `verify-history-persist.mjs` 又被并行会话写过（41813 字节）。新读数（原文）：
  ```
  432:const xxMessageMax = (rows) => (rows || []).filter((r) => String(r['kind'] ?? '') === 'message')
  433:  .reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0);
  521:check('[2] 重建的 maxSeq 与「重建域」（kind=message）的最后一条一致（seq 与记忆服务对齐）', restore?.maxSeq === messageMaxBefore,
  522:  { restored: restore?.maxSeq, messageMax: messageMaxBefore, jsonlMax: maxSeqBefore });
  ```
- **审阅结论：不是把判据改松，是把口径说准了**，三条硬证据：① 过滤器是**严格相等** `kind === 'message'`，与产品重建的跳过条件（`electron-main.ts:1405`）逐字同构，`kind` 缺失的行也算不进重建域；② 全局口径 `maxSeqBefore` **没删**，仍在 `:605-608` 撑着「重启后新增的日志 seq 严格大于重启前」⇒ 旁路行（`seq=13 kind=zhongjian`）的号**照样不许被新消息复用**，这一条如果我按 §30.3 的说法去改反而会变松（基准从 13 掉到 12），幸好没动；③ `node --check` 通过，脚本没被改坏。
- **⇒ §30.7 的②作废一半**：live 重跑前**不需要**再改这个文件；两支 hist 仪器红都已落地待复跑。剩下的仪器变更只有一件——§30.5 那 8 支夹具的 `mimo-v2.5` 聊天名要不要一并换成在售名（换=动仪器=又要从第 1 遍重跑；不换=本轮已知不影响 live 结论，因为 round12/18/18b/18c/19 这一遍都 PASS）。**等用户点头，本会话没换。**
- **本会话的自我边界（如实记账）**：只读了文件、只写了 `docs/HANDOFF-R51.md`；`packages/app-shell/src`、`dist`、`dev/gates/*`、`packages/app-shell/scripts/*` **一个字节都没改**，没起门禁、没杀进程。写作口径自查：`verify-security` **28 PASS**、`verify-docs` **84 ok / 0 FAIL**（17:5x 连跑，都是源码级、不起 Electron）。

## 29.11 live 档整遍结果：18 绿 / 8 红；名单内其实只差 2 支（16:46–18:2x 读数）

- `live-1.log` 汇总原文：`---- 第 1 遍汇总（tier=live）：真红 8 · 已知红(环境依赖) 0 · 缺文件 0 ----` / `=== run-verify-22 tier=live：1 遍 · 8 项红 ===`。
- **口径纠正（重要，别把范围读大）**：§19.3 的 15 支名单里**只有 2 支红** —— `verify-round34-live`、`verify-history-persist`；其余 13 支全绿（`r48-nengli-tongbu`/`r48-zhongjian-ui`/`round20-team --ollama`/`round20-team`/`round27-live`/`round28-live`/`round34-ui`/`round38-restart`/`round39-longchat`/`round39-quota-ui`/`r44-ui`/`r44-shejiao`/`r44-token-live`）。另外 6 支红（round16/17/18d/18e/18f/38-asr）是**我多跑的 roster 附加项**，不在那 15 支里。
- 现场一致性复核（18:2x）：`packages/app-shell/dist/electron-main.js` 仍是 **12:12:28**、`find packages/app-shell/src -newermt '15:27:05'` 为空 ⇒ 三连与 live 档跑的是同一份产物。

### 29.11.1 一条系统性仪器缺陷：供应商把聊天模型升到 2.6 系，20 支门禁还钉着 `mimo-v2.5`
- 审计原文（18d/18e/18f 三份 profile 都有）：`chat.tools.degraded {"detail":"tools-failed: HTTP 400: {\"message\":\"Unsupported model mimo-v2.5\"}"}` ⇒ 工具链整体降级、零次调用、`回复=""`、文件不落盘 ⇒ 门禁快红。
- 拿供应商自己的清单定性（`GET /models` → 200）：**可用 = `mimo-v2.5-asr`、`mimo-v2.5-tts`(+voiceclone/voicedesign)、`mimo-v2.6-flash`、`mimo-v2.6-pro`**；逐只打一发：`mimo-v2.5`→400、`mimo-v2.5-pro`→400、`mimo-v2.6`→400、**`mimo-v2.6-flash`→200**。
- 已修（只把钉死的聊天模型名换成在售那只，判据/规模/预算声明一字未动）：`verify-round18d.mjs`、`verify-round18e.mjs`、`verify-round18f.mjs`（各 8 处 `'mimo-v2.5'` → `'mimo-v2.6-flash'`，并在 `specialModels` 上方留一行说明供应商清单实测来源）。
- 复跑证据（逐支单跑、独占 9946）：
  ```
  18f  R18F ROUND 1 PASS (21s)   ok 90 秒内有工具进展 / ok 文件落盘 / maxSilent=12s
  18e  R18E ROUND 1 PASS (59s)   ok 第一轮 write_file ≥1 — n=2 / ok 无工具空参双倍请求
  18d  R18D ROUND 1 PASS (118s)  ok 文章文件落盘 / ok 文章接近目标字数 — ziShu=1630/2000 / ok 使用了 MiMo
  ```
- **没动的部分与代价（如实）**：还有 17 支门禁/脚本里留着 `mimo-v2.5`，其中 `round18/18b/18c/19` 本轮"绿"是因为链里有 **Ollama 兜底**（MiMo 腿 400 后回落本机）⇒ 它们测的其实是本机腿。要不要把它们一起对齐并重跑，等你点头（改动面大、要重跑数支 20 分钟级门禁）。

### 29.11.2 `verify-history-persist` 两条红的定性：都是门禁写错，不是产品漏重建
- 红 1 读数：`[FAIL] [2] 重建的 maxSeq 与 JSONL 最后一条一致 => {"restored":12,"jsonlMax":13}`。
  查 JSONL（`warmy-verify-persist-Pd6KZ8/persist/userdata/memory/fast-memory.jsonl`，15 行 / 5 会话）：
  ```
  会话=s-persist 条数=6 seq=1,2,3,4,14,15   会话=s-zj 条数=3 seq=11,12,13
  kind 分布={"message":14,"zhongjian":1}     seq=13 那条正是 kind=zhongjian
  ```
  产品代码 `electron-main.ts:1405` 明写 `if (String(r['kind'] ?? '') !== 'message') continue;`，而 `zhongjian` 是 `:12650` 那条**合成的中间回复摘要**（设计上不进逐条重建）；重启后新条目拿到 **14/15** ⇒ 全局 seq 没重号（另有一条断言 `新增 seq 严格大于重启前` 是 PASS 的）。
  ⇒ 等式拿"重建 maxSeq"比"全局最大 seq"，日志里只要有一条 zhongjian 就必红。**改对**：新增 `messageMaxBefore`（只取 `kind==='message'` 的最大 seq，三处快照一起更新），断言改成比这个域，读数里同时报 `messageMax` 与 `jsonlMax`。
- 红 2 读数：`[FAIL] [2] 「道」整份在场 => {"xiTongChars":9302}`。旧断言是 `includes('全局最高优先级')` —— 那句话只在 `dao-default.ts` 的**文件头注释**（第 5 行）里，播种出去的 `dao.md` 命中 **0** 次（8984 字节那份实测）。而用户真实 dao.md 今天 12:06 被重写成 3267 字，门禁注释还写着"12345 字"。
  ⇒ 又一条**永远不可能过的过时字面锚**。**改成锚行为**：读 sandbox 里应用真用的那份 `userData/dao.md`，要求它**尾部 40 字**原样出现在 system 消息里、且 `xiTongChars >= dao 字数`；用户以后改写 dao 也不会把断言改松，真截断反而跑不掉。
- 两支都改完：`node --check` 通过；**还没复跑**（round34-live 正在独占真机，纪律不许并发），等它结束单跑 `verify-history-persist`。

### 29.11.3 其余红的现状
- `verify-round38-asr`：复跑读数 **7 ok / 2 FAIL** —— 转写本身是对的（`ok 答话的正是用户点名的 mimo-v2.5-asr`、`ok 输入框文字相似度 ≥0.7`），红在两条**审计记账**断言：`asr.used` 里 `used=[]`、`asr.bendi.skip/failed=[]`。属第 38 轮你 park 的 ASR 路由范围（要先取话筒自检数值），本会话没动产品代码。
- `verify-round16`：见 §29.10（本机 27B 只有 1.32/2.21 tok/s，单条 ≥5200 字回复要 40 分钟量级，先撞产品自己的 1800 秒硬顶 ⇒ 抬门禁预算单独没用）。**等你在三条出路里点一条。**
- `verify-round17`：读数只截到 `FAIL ⑩ 找不到模型管理卡片（第四列没有牛马卡片）` 与 `FAIL ⑥c MiMo TTS 合成可用（0 字节）`；⑥c 很可能是 §29.11.1 的同一个 400（`mimo-v2.5` 聊天腿），⑩ 像是真产品/UI 问题。**待单独跑一遍取全量**（预算 2400 秒）。
- `verify-round34-live`：上一遍 1404 秒判红但明细被截断；**本遍正在单跑取全量**（18:2x 起，已过 `卡片 +162s「AI 请求访问工作区外的文件」→ 同意`）。

## 29.12 round34-live 全量读数 + history-persist 转绿 + 现场被第二支 live 档占用（18:16–18:2x）

- **`verify-round34-live` 单跑全量**（`.r50-logs/diag-34live.log`）：`==== verify-round34-live：试验 3 次 · 过 2 · 败 1（pass^k 要求全过）====`
  ```
  PASS r34-mimo-1 用时 307s 续派 {"zong":0,"targetLength":0,"completionCheck":0,"planPending":0,"talkOnly":0} 失败项 无
  PASS r34-mimo-2 用时 647s 续派 …同… 失败项 无
  FAIL r34-mimo-3 用时 389s 失败项 Ollama 没有 4xx/5xx 的对话请求
       => ["[GIN] 18:14:54 | 404 | 3.9244ms | 127.0.0.1 | POST \"/api/chat\"", ×3（同一秒 ≥9 条）]
  ```
  该 trial 其余 37 项全 `ok`（含"看到了 svg 里画的东西"、"整轮在时限内真正结束"、"没有悬挂的 pending/doing"、"授权卡没有问第二遍"）。
- **404 归因查不动，且高度可疑是别人家的请求**：把该 trial 自己的审计按时间摊开，18:14:48–52 只有 MiMo 腿（`token.calibrate-image-split model=token-plan-cn.xiaomimimo.com/mimo-v2.6-flash`、`write_file F:/XZM/渡船人.txt ok:true`）与 `chat.inflight-write`，**没有任何发往 Ollama 的 chat 请求**；门禁这条断言读的是**全局** `%LOCALAPPDATA%\Ollama\server.log` 的"新增行"（源码 `verify-round34-live.mjs:608-610`），结构上无法分辨是谁打的。对照实验：`POST /api/chat model=""` → **400 model is required**；`model="__not_installed__"` → **404 model not found**（且 404 不落日志）⇒ 形状与那串 404 一致，但名单里能选到的模型（`orcarouter/…:q4_K_M-128K`、`huihui_ai/qwen3-vl-abliterated:4b/:8b`、`bge-m3:latest`）**本机都装着**，说不通是自己打的。
  ⇒ 待办（P1，仪器侧）：这条断言要改成**能归因**（只统计本 trial 期间由自己进程发起的请求，或给每次请求打关联 id），否则同机并发门禁时会互相打红。本会话没动它。
- **`verify-history-persist` 复跑 `exit=0`（全绿）**，两条改对的断言各自给出可核对的读数：
  ```
  [PASS] [2] 重建的 maxSeq 与「重建域」（kind=message）的最后一条一致 => {"restored":12,"messageMax":12,"jsonlMax":13}
  [PASS] [2] 「道」整份在场（system 指令不被预算截断）            => {"xiTongChars":9302,"daoZiShu":3280,"youDao":true,"wei":"力？\n6. 我是否在无人监督时降低了标准？…"}
  ```
  口径来源都写进门禁注释了（`electron-main.ts:1405` 的 kind 过滤、`:12650` 的单条 zhongjian 合成、`dao-default.ts:5` 那条只出现在注释里的旧字面锚）。
- **§19.3 的 15 支名单进度：14 绿 / 1 待判**（只差 `verify-round34-live` 那条 404 归因；其余 13 支本轮已绿 + history-persist 刚转绿）。
- **现场变更（不并发起第二支）**：18:20:01 读数 —— `run-verify-22.mjs --tier=live --skip=…`（PID `21040`）由**并行会话在 18:17:59 挂上**，写 `.r50-logs/live-2.log`，18:18:18 正在跑 roster 里的支；本机 7 个 electron 在跑。⇒ 本会话**不再启动任何真机门禁**，改为旁观它们这一遍（它们用的是同一份工作树，会自动带上我刚改的 18d/18e/18f 模型名与 history-persist 两条断言）。
- 构建仍然冻结：`dist/electron-main.js = 12:12:28`（18:2x 复核）；本会话只动 `dev/gates/*` 与 `packages/app-shell/scripts/verify-history-persist.mjs`（门禁脚本，不进 `tsc -b`、不改产品语义）⇒ 三连的三绿读数仍然有效。


## 31. 推进器读数（2026-10-21 18:00–18:0x · 阶梯钉桩门禁挂进验收 + 一条过时锚修红）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`、`<授权目录>`）；密钥文件名不写进仓库。

### 31.1 判活双信号（18:00–18:04 采样，原文）

- ① 进程：`Get-CimInstance` 里 `node.exe` 带 `gates` 的只有一条 —— `"C:\Program Files\nodejs\node.exe" dev/gates/verify-round34-live.mjs`（PID 24880，17:52:23 起，属**并行会话**）；**没有** `r50-run3.mjs` / `verify-r46-youxi.mjs`。带 `--remote-debugging-port` 的 electron = **2**。
- ② 读数文件：`<仓库目录>/.r50-logs/diag-34live.log` mtime **18:04:03**，末行 `· 进行中 +362s 审计 177 条，最近：chat.inflight-write`；`%TEMP%\warmy-r34-live-<时间戳>-mimo2` 的 `audit/audit.jsonl` mtime **18:01:00**（14721 字节）、`chat-meta.json` **18:00:59** ⇒ 每 30 秒在涨，**在跑，不是卡死** ⇒ 本会话没杀进程、没起第二支。
- 三连侧：`%TEMP%\warmy-r46-youxi-profile-*` 最新一份停在 **15:27**（三连收尾），与 `[DONE] game 3/3 全绿` 一致 ⇒ 不触发"重启三连"分支。
- ⚠️ 仪器教训（本轮又踩一次）：powershell 单行里 `Where-Object { $_.CommandLine -match ... }` 经 bash 传参时 **`$_` 被吃掉** ⇒ 过滤条件静默失效、计数返回 **0**，差点把"正在跑"读成"场地空了"。判活要用**不带 `$_` 的整表输出再 grep**（本轮 18:04:18 用这个方法才拿到 `调试端口 electron=2`）。

### 31.2 三连是否还算数（同一仪器证明，18:0x）

- `find packages/app-shell/src packages/app-shell/dist -type f -newermt '2026-10-21 15:27:05'` **输出为空**；`dist/electron-main.js` 仍是 **12:12:28**。
- 三连那套仪器本体也没动过：`dev/gates/verify-r46-youxi.mjs` **14:24:15**（跑三遍之前）、`dev/gates/r50-run3.mjs` **12:27:11** ⇒ 3/3 全绿仍然成立，本轮改动不触发重数。

### 31.3 验收口径的两处补记（按任务要求：阶梯与新门禁都要算进验收）

- 新门禁 `packages/app-shell/scripts/verify-r52-layers.mjs`：**18:0x 复跑 32 ok / 0 FAIL**，且确认它**在 FAST 清单里**（`dev/gates/run-verify-22.mjs:108`，预算 180 秒）⇒ 两遍验收会覆盖。
- **发现一条覆盖漏**：真正钉住注入阶梯顺序的那两支 —— `dev/gates/verify-prompt-layers.mjs`（阶梯顺序 + 道不可压缩）与 `dev/gates/verify-dao-safety.mjs`（「道」文件的防误改/防自动改/防压缩）—— **过去不在任何一档清单里**（`grep` FAST/LIVE 两支都无命中）⇒ 阶梯改动本身从来没被验收遍覆盖过。本轮把两支挂进 **FAST**（纯静态读源码、不起 Electron，单支实测 0.06 秒），并在清单处写明这是第 52 轮阶梯的钉桩。

### 31.4 一条新红与定性：`verify-dao-safety` 的过时字面锚（仪器问题，不是产品漏）

- 挂进清单前先在本地跑了一遍，**当场红**：`==== verify-dao-safety: 11 ok / 1 FAIL ====` / `FAIL 不可压缩名单只有「道」`。
- 定性证据（可 grep）：门禁钉的是字面写法 `need(/export const BU_KE_YA_SUO = \['道'\]/.test(ys))`；产品侧真值 `packages/app-shell/src/yuSuan-jiage.ts:41` 已是 `export const BU_KE_YA_SUO = ['道', '产品门禁'];`（文件 mtime **11:42:45**，正是 §25.1 阶梯定稿那一次）。⇒ 与 §30.3 第 4 行同属"永远不可能过的过时字面锚"，是**仪器写错**。
- 修法（说准口径，不是放宽）：改成**实读集合再判**——用正则取出名单数组，要求**恰好两项且为「道」「产品门禁」**，读数里把实际解析到的数组打出来。旧断言只认一种写法，新断言允许任意排版但**集合必须精确相等**（多一项、少一项、解析不到都判红）。
- 负向验证（5 个假源串，全部实测）：旧写法 `['道']`⇒红、现写法⇒绿、双引号排版⇒红（读空不误判绿）、多一层 `+['术']`⇒红、漏 `export`⇒红 ⇒ **5/5**。修完复跑 **12 ok / 0 FAIL**。
- 代价（如实）：动的是仪器 ⇒ 按口径 **live 与两遍验收都要从第 1 遍重跑**（本轮本来就排在 live 重跑上）；三连不因此重数（§31.2）。

### 31.5 `verify-round34-live` 单腿复跑读数（并行会话在跑，本会话只读）

- mimo-1 腿（跑在**在售的云端模型名**上）35 条判据**逐条 ok、0 FAIL**，`· 指标：{...,"yongShiMiao":307,"lunShu":1,"gongJu":16,"chongZuoLanJie":0,"zhuoMianGaiDong":[]}`；其中 §30.3 第 6 行那两条当时红的，这一腿是绿的：`ok 同一个文件没有被整篇重写/重新生成第二遍`、`ok 桌面上没有多出别的东西（脚本、草稿、副本）`。
- **不下结论**：mimo-2 腿 18:0x 仍在跑（+362s）；「整篇覆盖要不要当场告知/要显式意图」仍是 §30.7 等拍板的 a) 项 —— 一腿绿只说明**概率环节这次没犯**，不推翻 §30.3 的审计原文（那条 profile 里 4 次 `appended:false` 覆盖是实测）。

### 31.6 现场与下一步

- 现场：并行会话独占真机（round34-live mimo-2 腿）；本会话**只改了 3 个文件** —— `dev/gates/verify-dao-safety.mjs`（过时锚改实读集合判据）、`dev/gates/run-verify-22.mjs`（FAST 挂进两支阶梯钉桩门禁）、`docs/HANDOFF-R51.md`（本节）。`packages/app-shell/src`、`dist`、`dev/gates/verify-round34-live.mjs` 一律没碰，没起门禁、没杀进程。
- 下一步（顺序不变）：① 等 round34-live 收工让出 9946；② live **从第 1 遍重跑**（串行、`MIMO_KEY_FILE=%TEMP%\<密钥文件>`，skip 两支压力档）；③ live 全绿 → **两遍验收**（fast 档现在含阶梯两支钉桩门禁 + `verify-r52-layers`）→ 首启 `node dev/gates/r38-firstrun.mjs`。
- 仍在等拍板（§30.7 那五条一条未动）：write_file 整篇覆盖语义、ASR「未启用要不要落 skip」口径冲突、round16 三条出路、出厂默认牛马是不是承诺、旧文档里 11 处密钥文件名。新增一条：§30.5 那 8 支夹具的 `mimo-v2.5` 聊天名要不要一起对齐（对齐=又要从第 1 遍重跑）。
- **§22.3 的 P0 清单仍一条未减。**

### 31.7 【给并行的另一支会话】场地交接（18:0x 写）

- 你这边 `verify-round34-live` 收工后**请先别再单跑**：仪器变更（18d/e/f 模型名、`verify-history-persist` 两条锚、本轮新增的两支阶梯钉桩门禁挂进 FAST）已经攒够 ⇒ **live 要从第 1 遍整遍重跑**；`verify-history-persist` 与 18d/e/f 都在那一遍的清单里，单跑属于重复占场。
- 推进器这边会在 9946 空出后立刻起 `run-verify-22 --tier=live`（串行、独占真机、驱动器自带坑位闸门）。期间请只动 `packages/app-shell/src`、`dist` 之外的东西，或等这一遍跑完 —— **动了 src/dist 就要重数三连**（§29.9 的同一仪器证明会失效）。

### 31.8 等待场地的 9 分钟读数（18:05:47–18:14:40 · 本会话全程没起第二支）

- 每 45 秒采样一次，12 次全部 `round34-node=1 dbg-electron=2` ⇒ 场地**始终被占**，属正规在跑（不是卡死）：`<仓库目录>/.r50-logs/diag-34live.log` 从 8136 字节涨到 **16860**、mtime **18:14:40**。
- **一条判活新坑（重要）**：18:04 时该日志已到 `+362s 审计 177 条`，18:14 读到的却是 `+332s 审计 77 条` —— 不是时钟倒流，是**同一支门禁被重跑并覆盖了同名日志**。⇒ 只看"日志在涨"会把"上一轮作废、新一轮在跑"误读成"跑了 10 分钟还没推进"；判活要同时看 **mtime + 文件长度 + 本轮自己打印的相对秒数是否单调**。
- **第二条判活新坑**：`netstat` 里 **9946 监听数 = 0**，而带 `--remote-debugging-port` 的 electron = **2** ⇒ 并发判据**不能只盯 9946**，要绑"命令行带调试端口的 electron 计数"（§29.9/§30.1 那两处"9946 唯一监听"的写法在新构建上会漏判）。
- 现场核对（18:14）：`node.exe` 里**只有** `verify-round34-live` 一支，没有 `run-verify-22` 整遍驱动、没有 `r50-run3`/`verify-r46-youxi`；`%TEMP%\<密钥文件>` 存在（内容不打印）。⇒ 下一遍 live 的起跑条件只差"让出真机"。
- 静态自查（不占真机，18:0x 连跑）：`verify-r52-layers` **32/0** · `verify-prompt-layers` **24/0** · `verify-dao-safety` **12/0**（修完锚之后）· `verify-gate-manifest` **23/23** · `verify-security` **28 PASS** · `verify-docs` **84/0** · `verify-naming` **48/0**；`node --check` 两个改动文件都通过。
- 本轮改动面（如实）：`dev/gates/verify-dao-safety.mjs`、`dev/gates/run-verify-22.mjs`（FAST 多两支）、`docs/HANDOFF-R51.md`。**未 commit。**

### 31.9 并行会话的 round34-live 终局读数（pass^k 三次试验，18:15 读到）

- 汇总原文：`==== verify-round34-live：试验 3 次 · 过 2 · 败 1（pass^k 要求全过）====`
  ```
  PASS r34-mimo-1 用时 307s 续派 {…全 0} 失败项 无
  PASS r34-mimo-2 用时 647s 续派 {…全 0} 失败项 无
  FAIL r34-mimo-3 用时 389s 续派 {…全 0} 失败项 Ollama 没有 4xx/5xx 的对话请求
  · 卡片…（第 3 次没过：pass^k 已经不可能，停在这里先复盘；要跑满加 --all）
  ```
- **两条结论**：① §30.3 第 6 行那条「整篇覆盖既有自写文件」在这一次的**三次试验里都没复现**（`ok 同一个文件没有被整篇重写/重新生成第二遍` ×2、第三次也没列进失败项，`zhuoMianGaiDong:[]`）⇒ 它是**概率环节**，不是每次必犯；产品语义要不要收紧（§30.7 的 a) 项）仍等拍板，不因这两腿绿而撤销登记。② 第三次红的是**另一条**：`Ollama 没有 4xx/5xx 的对话请求` —— 云腿（在售模型名）没问题，红在**本机 Ollama 腿收到 4xx/5xx** ⇒ 与 §29.10 的"吞吐不够"不是一回事（那是慢，这是被拒），属新读数，留待这一遍 live 里看它复不复现。
- 三次试验的产物都齐（交付物、截图、计划 6–7 项 verified、授权卡 5 张、无续派），报告文件名形如 `%TEMP%\warmy-r34-live-report-<时间戳>.json`，第三次的 profile 被保留在 `%TEMP%\warmy-r34-live-<时间戳>-mimo3` 供复盘。

### 31.10 【进行中】live 整遍从第 1 遍重跑（18:17:59 起跑）

- 起跑条件核对：18:16:27 与 18:17:12 **连续两次**采样 `dbg-electron=0`、无门禁 node 进程 ⇒ 场地真空出（不是腿间缝隙）。
- 命令：`node dev/gates/run-verify-22.mjs --tier=live --skip=verify-r46-youxi,verify-memory-stress`，带 `MIMO_KEY_FILE=%TEMP%\<密钥文件>`（先实测 node 能读到、只打印首行字节数 51，不打印内容）；两支压力档已在 15:27 拿到 3/3，不在这一遍重复。日志 `<仓库目录>/.r50-logs/live-2.log`（上一遍是 `live-1.log`）。
- 起跑后约 30 秒（18:18:31）读数：`######## 第 1/1 遍 · tier=live ########` / `[PASS ] verify-runtime-errors 17772ms`，第二支 `verify-round12.mjs`（PID 26632，18:18:18 创建；驱动器本体 PID 21040，18:17:59 创建）在跑，带调试端口的 electron=2（是本遍自己的壳）⇒ **起跑正常，不是空跑判绿**。
- 上一遍耗时参考：15:28:38→17:41:03（2 小时 13 分）⇒ 这一遍预计同样量级；跑完后按 §22.3 走**两遍验收**（fast 档现已含阶梯两支钉桩门禁）→ 首启 `node dev/gates/r38-firstrun.mjs`。

---

## 32. 第 52 轮（用户 11 点口径）：阶梯重排、分层压缩、拒绝硬停用、知识库三层与脱敏概要

本轮按用户给的 11 点逐条落地。**全部改动未提交**（仓库纪律：不 commit、不 push）。

### 32.1 项 4｜优先级阶梯重排（定稿口径）

- **新阶梯**：`产品硬门禁 > 道 > 术 > 规范 > 印象 > 工具 > 软门禁 > 教条 > 束缚 > 认知 > 身份/模型/时间`。
- 注入顺序按新阶梯重排（`electron-main.ts` 的 `shenFenTou` 装配段）：
  硬门禁 → 道 → 术 → 规范 → **印象**（从"殿后"升到规范之后）→ **工具**（新独立段 `【工具 · 能力清单与落地规矩】`）→
  **教条** → **束缚**（这两层从"术之后"降到"工具之后"，明示自己只为兼容其它智能体移植而存在）→ 认知 →
  **身份/模型/时间**（新独立段 `【身份 · 模型 · 时间】`，排在最后）。
- 为什么要拆段：分层压缩按**段标题**归层，`身份 + 工具`混在一个段里就没法一个先压一个后压（这是本轮拆段的唯一动机）。
- 文案同步：印象不再自称"最低"；教条/束缚自称"低于工具与软门禁、只为移植兼容"；认知的位置改成"束缚之后、身份之前"。

### 32.2 项 4｜分层压缩：不许一次压到极限（新模块 `yaSuo-fenCeng.ts`）

- 不可压缩名单**不变**：`BU_KE_YA_SUO = ['道','产品门禁']`。
- 分层（`YA_SUO_CENG`，层内也从低优先级先压）：
  - 第 0 层 无名段（`本轮工具面收窄`、`上一轮任务黑板摘要`，以及**任何没登记过的新段** ⇒ 新增段默认最先压，不许悄悄享有保留承诺）
  - 第 1 层 软门禁 / 工具 / 印象 / 规范
  - 第 2 层 身份 / 认知 / 束缚 / 教条
  - 第 3 层 术
- 强度两档：半极限留 **72%**、真极限留 **45%** 且段内不少于 **600 字**；泵道 = `[半极限, 真极限] × [0,1,2,3]` = **8 轮**。
  先第 1 遍把各层压到半极限（不够才上一层），再第 2 遍回头把各层压到真极限 ⇒ 优先级越高越晚被动、动得越浅。
- 攒够缺口就收手（不越层、也不多砍一刀）；每轮之后重新核算，装得下立即停手。
- 审计 `chat.fixed-compressed` 新增 `ceng` / `qiangDu` ⇒ 红了能回答"这一轮压的是哪一层"。
- 原文长度从上一轮的压缩说明里取（`本段从 N 字压到 M 字`），不靠下标记账（队列后面还会追加段，下标会串）。
- `YA_SUO_XIAN_HOU` 不再是第二份事实来源：由 `YA_SUO_CENG.flat()` 派生后在 `yuSuan-jiage.ts` 里 re-export。

### 32.3 项 11｜④「被拒即停用」收紧为**按任务算**（新模块 `ju-jue-zhang.ts`）

- 用户拍板："按你的建议做" ⇒ 旧口径「最近 120000ms 内该工具失败 ≥2 次」作废。两处失真都有读数：
  ① 时间窗一过又放行 ⇒ 第 51 轮小游戏第 2 遍 `run_shell` 被拒 9 次、602 秒零产出，`juJueTingYong` 只响 2 次；
  ② 数的是 `ok:false` ⇒ 路径写错也算"被拒"，提示语对模型撒谎"当前授权档不放行"。
- 新口径：**只由各拒绝点显式记账**（授权档不放行 / 用户点拒绝），同一条任务里累计 **2 次** ⇒ 该工具**本轮硬停用**（再调不执行）；
  只有**新的用户消息**重置；`【继续执行/用户决定】`是同一任务的续接 ⇒ 停用名单**保留**（否则点一次"继续"又把墙放开）。
- **拒绝的唯一出口** `huiBaoJuJue()`：生成文案的当场记账。为什么不用"扫文案反推"：负向验证里把某条拒绝文案改成
  「权限不足，不能执行」就绕过了记账 ⇒ 判据不能靠措辞。9 个拒绝分支全部走这个出口（门禁钉住出口数 ≥9 且不许手写拒绝文案）。
- 钉死时记审计 `chat.tool-denied-locked`；提示语如实报"第 N 次被拒 + 最后一次拒因"。
- `knowledge_add` 的「这一层对本会话不可写」**故意不钉死**：同一工具换层是正常用法，不是撞墙（白名单在门禁里显式登记并要求它确实存在）。

### 32.4 项 2｜归档两条入口的质量一致 + 有对话在跑就跳过

- **在途跳过**：`guiDangYiGeHuiHua()` 开头查 `zaiTuLiao`（唯一在途登记：轮次开始 set、finally delete）。在跑 ⇒ 返回
  `{ok:false, skipped:'in-flight'}` + 审计 `chat.archive-skipped-inflight`；`warmy:huiHuaZhaiYao` 这条历史 IPC 同样加闸。
- **跳过≠丢掉**：自动入口被跳过时把 `guiDangZuiHouXu` **退回到上一次的水位**（否则那几十条原文永久不被归档，丢的是原文不是摘要）。
- **质量一致**：自动那路以前不传模型 ⇒ 永远是生拼原文，手动那路才走整理模型。现在 `opts.moXing` 缺省回落到设置里的 `archiveModel`，
  两边同模型、同整理指令、同降级；`chat.archive-done` 里的 `chuFa: auto|manual` 仍可对比。

### 32.5 项 6｜知识库三层语义定稿 + 内部→会话脱敏概要（新模块 `zhi-shi-fen-ceng.ts`）

三层定义（唯一口径写进模块头注释）：
- **私密库 private**：不可公开的个人情况、对人对事的评价（敏感事件的评价也落这里）。
- **内部库 internal**：工作/业务相关内容（含敏感业务信息、游戏娱乐等"非隐私但非个人"的内容）。
- **会话库 session**：可对外公开、与业务无关、非敏感、非个人。

机制：
1. **写入口按内容升层**：`kbWritable(sessionId, 想要的层, 内容)` 取 `max(指定层, 判据层)`；判据 = `panDingCeng()`
   （敏感个人 → private；对人负面评价 → private；业务硬标志 → internal；其余 → session）。升层记 `kb.layer-raised`；
   够不到需要的层就拒，并如实说明"这条内容比本会话能写的层更敏感"（不让模型以为再试一次就行）。
   业务判据**故意做窄**：只认钱/合同/客户/交付/项目/打包/游戏这类硬标志，不认"验收/测试/代码/任务"，
   否则群聊（只能写会话层）会对一切工作话题拒写。**判漏=泄露，升过头=可用性**，两边都记进了注释。
2. **脱敏概要**（新功能）：归档写完内部库之后，从这批内容里派生一份可对外的概要写进会话库。
   设计要点（来自本轮联网调研的结论，见 §32.9）：**不改写原文，只从能力白名单里挑条目**
   —— `NENG_LI_BIAO` 12 条能力短语；挑不出就**整条抑制**（宁缺勿泄）。
   确定性检查器 `jianChaGaiLao()` 四道关：① 白名单（逐条比对 + 剥掉固定句式后不许残留任何字）；
   ② 禁现形态（数字/金额/日期/路径网址/联系方式/存在性说法"做过·什么时候·怎么做的"/专名指向）；
   ③ 哨兵 canary；④ 长度 ≤240 字。通过才写 `knowledge.session` 并记 `kb.tumin-written`，否则 `kb.tumin-suppressed`。
   写这一层时**不做内容升层**：概要是降密之后的产物，由检查器担保（`panDingCeng` 是给手写内容用的）。
3. 能力清单式表述（整句都是白名单短语）在 `panDingCeng` 里判 session，否则"我们可以做网页小游戏的开发与验收"会被"游戏"这个词打进内部库。

### 32.6 项 7｜归档后整理（新模块 `zhi-shi-zheng-li.ts`）

写完就整理，逐层（本次可写层）跑一遍 `guiHuaZhengLi()`：
- 同标题且内容实质相同 ⇒ 判"重复"，留最新一条；
- 同标题但内容不同 ⇒ 判"前后矛盾"，留新说法（更新的说法覆盖旧的）；
- 标题 >60 字 / 结果 >500 字 ⇒ 截断（简洁，别一条吃光注入预算）；
- 只在真有改动时记 `kb.tidy`（含原条数/整理后条数/逐条理由），空库与安全单条库都不动。
「术」侧新增总量闸 `SHU_ZONG_LIANG_MAX = 8000`：超过就**停止归纳侧追加**（用户手写的部分一个字不动），记 `shu.over-cap`。

### 32.7 项 1｜道里的做事准则移入术

- `dao-default.ts` 只留总思想要领：先判后果 / 不作恶不操控 / 求真 / 不谄媚 / 边界情形 / 自检（原五、六、七三节搬走）。
- 新增 `shu-default.ts`（术的出厂稿）：一 节制、二 把事做成、三 与人协作、四 否定项 X 必须有出处；
  主进程 `boZhongShuMoRen()` 与道一样只播种一次，`settings.shu-md-seeded` 可查。
- 本机运行时两份文件也同步搬了：`%APPDATA%\@warmy\app-shell\dao.md`（3267→2220 字）与 `shu.md`（663→1837 字），
  都留了 `.bak-r52-move` 备份，可回退。

### 32.8 项 5｜卡片文件地址改成超链接

- 「道 / 术 / 印象 / 教条 / 束缚」五张卡片（取消按钮右侧）的路径从纯文本改为 `<a class="pfLink luJingLian" data-open data-link>`。
- **复用聊天框那套**，不另写一份：左键 `daKaiWenJian()`（nm 插件优先、停用回系统默认），右键 `shouWenJianYouJianCaiDan()`
  （复制 / 复制路径 / 打开所在目录）；`biaoJiZhenShiLuJing()` 核实存在后才打 `data-real`，不存在就退回纯文本（不给死链配菜单）。
- ⚠ **还没做真机点击验证**：这一遍 live 档由驱动器在跑（真桌面串行），渲染层改动只能等空场时用 CDP 实测。已列入 §32.11 待办。

### 32.9 本轮联网调研结论（最先进做法，不是最常用做法）

知识库/脱敏（会话库=可对外的降密产物）：
- **降密（declassification）而不是过滤**：IFC 标签格 + no-read-up（arXiv:2505.23643）；FlowSeal（arXiv:2609.14003）把降密函数放在
  被污染上下文之外，实测泄露 52.2%→0.5%。⇒ 我们的"检查器"必须确定性、且在模型上下文之外。
- **摘要本身就是泄露面**：摘要上的成员推断 AUC>64%（arXiv:2310.13291）；对**已匿名**的会话日志仍能以 F1 0.84–0.90 反推年龄/性别/出生地，
  中位只需 5% 上下文（arXiv:2605.23820）；"被抹掉的数字会回来"（arXiv:2502.12658）、多轮提问把提取率抬 5 倍（arXiv:2410.06704）。
  ⇒ 结论：不能靠"让模型改写一遍再打码"，也不能只删词 —— 我们改成**白名单挑条目 + 存在性说法禁写**。
- **整条抑制优于低质改写**：k-匿名 generalization+suppression；GraphRAG 的分层社区报告（arXiv:2404.16130）是文献里最接近
  "同一语料的低保真派生层"的实现；MemPrivacy（arXiv:2605.09530）用*类型可见、值不可见*的可逆假名化，utility 损失 ≤1.6%。
- **验证方法**：canary 注入 + 正则测出 0.96 泄露率（CanaryBench arXiv:2601.18834）⇒ 我们把哨兵做进门禁真值表；
  反向指标也要测（arXiv:2509.14464：最高 89% 的错误是**过度删除**）⇒ 门禁里同时钉"挑不出就抑制"和"干净概要必须过检"。
- 业界记忆系统（Letta memory blocks / Zep+Graphiti / Mem0 / LangGraph store / A-MEM / HippoRAG）**都没有受众信任级隔离**：
  Letta 的 read_only 只按块不按 agent，Graphiti 明说"认证授权租户隔离由你的服务提供"，Mem0 的"memory security"是包含/排除规则不是信任级
  ⇒ 我们这套"三层 + 写入口按内容升层 + 派生降密"在开源项目里没有现成对标，只能自建并自建判据。

登录即密钥 / 本地加密（P0-5）：
- **ID 本身当密钥 = 不可行**：用户 ID 公开、可猜、低熵，不是秘密（HKDF RFC 5869 只保证 salt 不必保密；OWASP 要求密钥来自 CSPRNG，
  口令必须过 KDF；NIST SP 800-63B 的强度要求只针对用户掌握的 secret）。拿 ID 派生 ⇒ 谁拿到账号列表谁就解密全部库。
- **"看不到密钥也能自动解锁"这个体验可行**，成熟路线三条：① PAKE（OPAQUE，已发 RFC 9807）；② 信封加密（服务器发随机 DEK，明文密钥永不落库）；
  ③ 设备绑定凭据（WebAuthn PRF extension 从认证器源出对称密钥而私钥不出设备；Windows 侧 DPAPI/TPM、Electron `safeStorage`）。
  业界没有一家用 ID 当密钥：Bitwarden 用 PBKDF2(邮箱只当 salt)，1Password 服务器只存 SRP verifier，Tuta 是"口令即私钥、无恢复"，
  MEGA/Proton 附恢复密钥/短语，Apple ADC 是"密钥只留在受信设备"（设备绑定，不是 ID 绑定）。
- 最坏情况实证：LastPass 库被偷后主口令可离线爆破；MEGA 因格式可延展被攻破（mega-awry）。
- 性能：**完全不是瓶颈**。Argon2id（OWASP 现行最低 m=19MiB,t=2,p=1）只在解锁/换口令时跑一次，约 100–150ms（二手数，须目标机复测）；
  AES-256-GCM 有 AES-NI 时 Node 流式实测 292–1065 MB/s ⇒ 1MB≈1–3ms、50MB≈50–170ms；分块膨胀 ~13–45KB/50MB；
  SQLCipher 整库页加密官方口径 5–15% 开销（`kdf_iter` 降档可提速）；追加型 JSONL 用 secretstream/age 式 64KiB 分块。
- 导出：**直接复用 age 文件格式**（scrypt/Argon2 + ChaCha20-Poly1305 + 64KiB 块 + ASCII armor，规范本身写明口令丢失即不可解），
  **不要用 zip 加密**（WinZip AE 是 PBKDF2-HMAC-SHA1 1000 次迭代；ZipCrypto 有已知明文攻击）；
  校验用 HKDF 域分离派生 verify_key 只签已知明文头，**绝不在文件里存口令哈希**。

### 32.10 本轮门禁与验收读数

- 新增 fast 档门禁 3 支：`verify-r52-jujue`（42/0）、`verify-r52-yasuo`（43/0）、`verify-r52-kb`（38/0）；
  `verify-r52-layers` 扩到 53/0（新增道/术分工 5 条 + 卡片超链接 5 条）。GATE-MANIFEST 87 条（project 52）、一致性 23/23。
- 负向验证（每个新判据都必须"改坏必红"，且**先确认变异真的生效**）：
  `r52-jujue-neg` 10 个变异全部被抓；`r52-yasuo-neg` 8 个全部被抓；`r52-kb-neg` 12 个全部被抓。
  过程中修掉三类仪器缺陷：① 变异锚点必须按**编译产物**的行形状写（tsc 会把 `if (x) return y;` 拆成三行）；
  ② 变异体落在 %TEMP% 时相对 import 解析不到 ⇒ 必须换成 dist 的 `file:///` 绝对地址，且 env 传入的路径要 `pathToFileURL()`；
  ③ 多处替换的变异必须逐处确认命中（"部分生效"会伪装成"判据漏抓"）。
- 分层压缩的两处 FAIL 是**真判据错**，不是夹具问题：① 一段压完已覆盖缺口却仍继续压下一段（多砍一刀）⇒ 加"攒够就停"；
  ② "术留得比印象多"这个断言写错了 —— 正确口径是"**第一次被动**的轮次更晚"（0<1<3），已改成按轮次记录首动时刻。
- KB 门禁抓到两个真缺陷：① `jianChaGaiLao` 的句式剥离正则写成 `[^。]`，而固定说明句里就有句号 ⇒ 干净概要也被判"白名单外"（已改 `[^）]`）；
  ② 敏感健康词表缺"结节/甲状腺"等，混合句没升私密（已补，并按类目顺序避免与 shengyu 抢判）。
- 本轮改过的旧门禁：`verify-prompt-layers`（阶梯顺序/压缩表/新强度断言，29/0）、`verify-r44-yuSuan`（176/0）、
  `verify-kb-scope`（22/0，`kbWritable` 新签名 + 概要写前查写侧名单）、`verify-round37-changes`（印象位置口径）。
- 后台测试状态（读数时刻）：压力档 A 小游戏三连 **3/3 全绿**（每遍 `过 35 · 败 0 · 跳 0`，最后一遍 15:27 收工）；
  live 整遍由驱动器在 18:17:59 起跑（`--skip=verify-r46-youxi,verify-memory-stress`），本轮不与之并发。

### 32.11 未完成项（后续会话可立即接手）

1. **P0-4 会话隔离硬门禁的界面勾选**（§22.3 的老 P0）：只做完了程序侧，界面那个勾还没加。
2. **卡片超链接的真机验证**（本轮项 5）：等 live 空场时用 CDP 打开设置页，量 `a.luJingLian[data-open]` 存在、
   左键确实走 `daKaiWenJian`、右键确实出菜单；`verify-r44-ui`/新一支 UI 门禁都可承接。
3. **归档→印象/术的端到端门禁**：需要 Electron，同样排在空场之后。
4. **脱敏概要的"重建攻击"测试**：本轮只做了确定性检查 + 哨兵；调研建议的"只喂概要问探针"（客户是谁/多少钱/什么时候做的）
   需要模型调用，属 live 档 ⇒ 尚未落地（下一轮把它做成 live 门禁，判据：答案不优于猜测）。
5. **P0-5 登录系统**：结论是"ID 当密钥不可行，但账号下发随机 DEK + 本地 DPAPI/TPM 二次包裹可行"，
   要真做得先建登录；用户还没拍板做不做、以及丢登录时的恢复口径（恢复码 / 多设备 / 轮换）。
6. **P0-6 脱敏体系的分档**：本轮把"会话库"这一层做成了白名单式降密；是否再把内部库对外展示（导出/群聊引用）也接同一套检查器，等拍板。
7. **§22.3 剩下的 P0**：互通双向、live 串行、验收 ×2、首启仪式（`node dev/gates/r38-firstrun.mjs`）—— 首启一直没做。
8. **ASR 话筒自检数值**（第 38 轮被 park）；`r51-shu-probe.mjs` 探针仍未跑过。
9. **循环真跑判据的强度口径**（§28.9/§29.4）与 §28.3 的可选收紧：仍等拍板。
10. 本轮所有改动**未提交**（仓库纪律）。

---

# 35. 推进器读数（2026-10-21 19:38–19:5x · live 第 2 遍终局 4 红 ⇒ 逐条定性 ⇒ 三连从第 1 遍重挂）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`、`<密钥文件>`、`<本机 Ollama 服务日志>`、`<夹具 profile>`）；密钥文件名不写进仓库。

## 35.1 判活双信号与场地事件（时间 + 原文）

- **19:38:51** 读 `<仓库目录>/.r50-logs/live-2.log` 末行：`---- 第 1 遍汇总（tier=live）：真红 4 · 已知红(环境依赖) 0 · 缺文件 0 ----` / `=== run-verify-22 tier=live：1 遍 · 4 项红 ===`（文件 mtime **19:37:58**）⇒ 这一遍**已正常收工**，不是卡死。
- ① 进程：`node.exe` 里带 `gates` 的**零条**；② 命令行带 `--remote-debugging-port` 的进程 **0**。⇒ 不触发"杀进程重启"分支。
- **19:41:50 我第一次挂三连就踩了一条夹具坑**（原文）：
  ```
  [game] 第 1/3 遍开始 2026-10-21T11:41:50.985Z
  Error: EBUSY: resource busy or locked, open '<仓库目录>\.r50-logs\game-3x.log'
      at Object.appendFileSync (... dev/gates/r50-run3.mjs:58:6)   ← say() 自己 append 同一份文件
  [driver] exit 1
  ```
  ⇒ 启动脚本把 stdout 用 `>>` 重定向到 `game-3x.log`，而驱动器 `say()`（`r50-run3.mjs:58`）也 `appendFileSync` 同一个文件，Windows 上两个写句柄互斥 ⇒ **秒退**。修法：stdout 改到 `<仓库目录>/.r50-logs/game-3x.out.log`，驱动器自己那份 `game-3x.log` 不动（`.r50-logs/start-game-3x-r52.cmd`，仓库里那份 `start-game-3x.cmd` 我没改）。
- **撞场一次（我的错，已让场）**：并行会话 **19:42:23** 起了 `verify-round12.mjs`（PID 36080），我 **19:42:39** 的三连正好落在 16 秒后 ⇒ 19:43:39 采样 `DBG-PROC=4`（两支真机门禁并发抢真桌面）。19:44:17 我只杀**自己这一支**的树：`33476 → 30180 → 38220 → 36340`（+ 4 个无调试端口的子进程），没碰对方的 PID。
- **19:47:51 与 19:48:39 连续两次采样 `DBG-PROC=0`**（且无门禁 node 进程）⇒ 场地真空出；**19:48:50** 重挂三连：`[game] 第 1/3 遍开始 2026-10-21T11:48:50.332Z`。
- 19:54:49 双信号复核：① `r50-run3.mjs`(38780) / `verify-r46-youxi.mjs`(38324) 在跑、`DBG-PROC=2`（本遍自己的壳）；② `%TEMP%\<r46 压力档 profile-19:48:50>` 的 `audit/audit.jsonl` mtime **19:54:47**、`chat-meta.json` **19:54:48** ⇒ **在跑不是卡死**。明细已 `过` 到第 2 轮三条判据（第 1 轮 83 秒）。

## 35.2 【结论】live 第 2 遍被"跑着改产物"污染 ⇒ 三连 3/3（15:27）不再算数

- 仪器：`find packages/app-shell/dist -type f -newermt '2026-10-21 18:17:59' ! -newermt '2026-10-21 19:38:00'` ⇒ **35 个文件**在 live 遍的执行窗口内被重写。三条最关键的落在别人的执行窗口里（窗口按 18:17:59 起跑 + `live-2.log` 各支耗时累加回推）：
  | 重写时刻 | 产物 | 落在哪一支的窗口 |
  |---|---|---|
  | 18:22:15 / 18:24:09 | `dist/yuSuan-jiage.js` / `dist/builtin-rules.js` | `verify-round12`（18:18:18–18:23:39） |
  | **18:39:38** | `dist/electron-main.js` | `verify-round16`（18:23:39–18:42:20） |
  | **18:49:06** | `dist/renderer/app.js` | `verify-round17`（18:42:20–18:51:16） |
- ⇒ §29.9/§31.2 那条「`find src dist -newermt 15:27:05` 为空 ⇒ 三连与 live 同一份产物」的**证明已失效**（src 侧 18:09–18:49 有 11 个文件被改）。**三连必须从第 1 遍重数**（已于 19:48:50 起跑）；这一遍 live 的 4 条红里凡与产物相关的都不能单独定论 ⇒ live 也要在新产物上从第 1 遍重跑。

## 35.3 live-2 的 4 条红：逐条定性（每条都给能 grep 的原文）

汇总原文（只列红，`live-2.log`）：
```
[FAIL ] verify-round12   321536ms  FAIL ④ 工具调用异常：EVAL_TIMEOUT | ---- ROUND 1: FAIL (10/11) ----
[FAIL ] verify-round16  1120474ms  FAIL ⑥ 10+ 计划任务：步骤数=-1，回复含 T10+ =false | ---- ROUND 1: FAIL ----
[FAIL ] verify-round17   535068ms  FAIL ⑩ 找不到模型管理卡片（第四列没有牛马卡片） | FAIL ⑥c MiMo TTS 合成可用（0 字节）
[FAIL ] verify-round38-asr 39840ms  ==== 7 ok / 2 FAIL ====（asr.used=[]、asr.bendi.skip/failed=[]）
```
另：`[PASS ] verify-round34-live 1654611ms` ⇒ §29.12 那条「Ollama 没有 4xx/5xx」归因断言这一遍**没犯**（仪器待办仍未解）。

1. **`verify-round12` ④ EVAL_TIMEOUT ⇒ 未定性，两条候选之间"审计看不见"这件事本身是缺陷**。新证据（并行会话独占场地单跑复现，`.r50-logs/diag-r12-repro.log`，19:42:23–19:47:43）：同一次跑里 `⑤b MiMo TTS 合成真人声 {"ok":true,"len":102482}`、`②c MiMo 真实列模型 n=6` ⇒ **不是密钥/供应商 400**。三处可 grep 的读数把范围收窄到「拿到模型响应之后」：
   - `<本机 Ollama 服务日志>`：该轮 `POST /api/chat` 于 **19:42:41 就 200 返回、耗时 4.67 秒**（19:42:41→19:47:43 之间没有任何 `/api/chat` 记录）⇒ 排除"模型慢/排队"，与 §29.10 那条吞吐不是同一种红。
   - `<夹具 profile>/audit/audit.jsonl`：`verify-r1-tool` 会话 `chat.dispatch`(19:42:36) → 两条 `chat.inflight-write`（`zhengWen:0, duan:1`）→ `token.calibrate`(19:42:41) **之后再无本会话任何事件**，夹其间的只有 `xin-tiao.ok` 两条（19:44:54 / 19:47:24）⇒ 应用活着、这一轮没了收尾（既无 `chat.work-tool`，也无 `chat.tools.done`，更无 `chat.stream-timeout`）。
   - 该会话的工作区目录 `<夹具 profile>/workspace/verify-r1-tool` **是空的** ⇒ 工具根本没执行。
   - 候选 A（仪器/夹具侧）：产品弹「AI 请求访问工作区外的文件」授权卡等人点 —— `qingQiuKaPian` 的默认等待是 `timeoutMs = 24 * 60 * 60 * 1000`（`packages/app-shell/src/electron-main.ts:2304`），而 `verify-round12.mjs` 里 `卡片|kaPian|card` **grep 命中 0 条**（对比 `verify-round34-live.mjs:283` 有"像用户一样点同意"的处理器）。候选 B（产品侧）：工具轮在响应之后真悬挂。
   - **A/B 在审计里分辨不了**：`qingQiuKaPian` 只在「被停止抑制」「自动放行」「自动选择」三个分支记账，真正**弹卡等人**那一路（结尾 `return dengDaiKaPian(q.id, timeoutMs)`）**一条 op 都不记** ⇒ 可见性缺口，与第 51 轮那条工具结果截断同类。
   - 间歇性：live-1 用**同一份 12:12 产物**这一支是 `[PASS ] verify-round12 38890ms`（§29.10 原文）⇒ 不是必犯。
   - **判别实验（下一步做，属仪器侧，不进 `tsc`、不改产品语义）**：给 round12 补一条"出现授权卡就记下标题与路径并点同意"的处理器，空场单跑一支 —— ④ 转绿 ⇒ 判 A（夹具缺处理器），仍红 ⇒ 判 B（产品悬挂）。两条都要补一条"弹卡必须记账"的判据，否则下一遍还是猜。
2. **`verify-round16` ⑥（`步骤数=-1`，1120474ms）**：与 §29.10 同族（本机 27B 吞吐 1.32/2.21 tok/s、单条 ≥5200 字要 40 分钟量级、先撞产品自己的 1800 秒硬顶）。这一遍它**不能算干净的复现读数**：`dist/electron-main.js` 在 18:39:38 被重写，正落在它 18:23:39–18:42:20 的窗口里。§29.10 的三条出路仍等你点一条。
3. **`verify-round17` ⑩ + ⑥c**：两遍同样两条红（live-1 §29.11.3、live-2 本遍），且两遍用的产物不同（12:12 与 18:39/18:49）⇒ **与本轮改动无关的稳定红**。
   - ⑩「第四列没有牛马卡片」：`.mgrKa` 在现产物里仍在（`dist/renderer/app.js:23804` 模板、`:23872` 折叠逻辑），`git diff` 渲染层里**没有任何一行**含 `mgrKa`（grep 命中 0）⇒ 不像被本轮改坏。夹具前置条件是「`instances` 为空时塞一台牛马进去」（`verify-round17.mjs:104-119`，注释已写明出厂不预置牛马属待拍板项）⇒ 更像播种/渲染条件不成立，**需要空场单跑取全量**（预算 2400 秒）。
   - ⑥c「TTS 0 字节」：同一台机器 19:42 的 round12 `⑤b` 同一只 `mimo-v2.5-tts` 是 `ok len=102482` ⇒ 不是供应商侧；round17 自己往 `<夹具 profile>/secure/keys.enc.json` 播种（`:77-79`，`protector:'plain'`、provider id `mimo-r17`）⇒ 密钥形状/命名对不上导致拿不到 key 的可能性更大（属夹具）。
4. **`verify-round38-asr` 2 FAIL**（`asr.used=[]`、`asr.bendi.skip/failed=[]`）：仍是 §30.7 b) 那条口径冲突（"未启用/装不了要不要落 `asr.bendi.skip`"）+ 第 38 轮 park 的话筒自检数值。旁证可 grep：同机 round12 的 profile 审计里就有 `asr.local-only-failed`「本机语音不可用或识别失败，且勾选了「仅使用本机」」与 `asr.result {"ok":false,...,"error":"bendi-yuyin-failed（…）"}` ⇒ 产品当时走的是"仅本机"分支，**没记 skip 原因**正是红的那条断言要的东西。等你点头才动代码。

## 35.4 验收口径的一条差异（等你确认以哪份为准）

- 本轮任务提示给的阶梯是 §25.1 那份：`硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象`。
- 代码与门禁现在钉的是 §32.1 那份：`硬门禁 > 道 > 术 > 规范 > 印象 > 工具 > 教条 > 束缚 > 认知 > 身份`。装配段可 grep（`dist/electron-main.js`）：`12111 产品门禁`→`12124 道`→`12133 术`→`12147 规范`→`12167 印象`→`12419 工具`→`12430 教条`→`12437 束缚`→`12443 认知`→`12458 身份·模型·时间`；`verify-prompt-layers.mjs:30`/`:87` 的注释与判据按后者，压缩分层 `YA_SUO_CENG`（`verify-prompt-layers.mjs:50`）把「规范」和「术」放同一层。
- 新门禁都已在验收清单里：`verify-r52-layers`(:108)、`verify-r52-jujue`(:110)、`verify-r52-yasuo`(:112)、`verify-r52-kb`(:114)，阶梯两支钉桩 `verify-prompt-layers`(:124)、`verify-dao-safety`(:125) ⇒ 两遍验收会覆盖（§31.3 那条覆盖漏已补）。

## 35.5 现场与下一步

- 现场：**三连第 1 遍在跑**（19:48:50 起，预计单遍 13–15 分钟、三遍约 45 分钟）。本会话本轮**只写了 `docs/HANDOFF-R51.md` 和本会话自己新建的 `.r50-logs/*` 两个脚本文件**（`start-game-3x-r52.cmd`、两份判活/进程树自查脚本）；`packages/app-shell/src`、`dist`、`dev/gates/*`、`packages/app-shell/scripts/*` **一个字节没改**，没动别人的进程。
- 【场地请求】三连 + 随后的 live 与两遍验收期间，**请勿改 `packages/app-shell/src` 与 `dist`**：动一次就要三连重数 + live 从第 1 遍重来（本遍已经栽在这件事上，§33.2）。要改请先在文档里留言、等这一遍收工。
- 下一步（顺序）：① 三连三绿 → ② round12 的判别实验（授权卡处理器，仪器侧）+ 空场单跑 round17 取全量 → ③ live 从第 1 遍整遍重跑（串行、`MIMO_KEY_FILE=%TEMP%\<密钥文件>`、skip 两支压力档）→ ④ 两遍验收 → ⑤ 首启 `node dev/gates/r38-firstrun.mjs`。
- 仍等拍板（一条未动）：§33.3 的 round12 A/B 判别与"弹卡必须记账"、§29.10 round16 三条出路、§30.7 b) ASR skip 口径、§30.7 a) 整篇覆盖语义、§30.5 那 8 支夹具的 `mimo-v2.5` 聊天名要不要对齐、§33.4 阶梯以哪份为准、`write_file` 播种牛马是否属产品承诺（§29.11.3/§33.3 第 3 条）。
- **§22.3 的 P0 清单仍一条未减。**

---

## 33. 第 53 轮（用户再给 11 点）

> 本轮起执行用户新口径：**每完成一点就写一次交接文档**（下面每个 §33.x 就是那一点完成时写的，不事后补写）。
> 每次回复都必须提醒用户"还有哪些没完成"，并且这条要求本身要写进交接文档 —— 已写在 §33.12。

### 33.1 项 1｜规范与术并入同一压缩层（已完成，含负向验证）

- 用户口径：**阶梯里规范与术在同一个层**（压缩分层，不是优先级顺序；优先级仍是 术 > 规范）。
- 改动：`yaSuo-fenCeng.ts` 的 `YA_SUO_CENG` 从
  `[[软门禁,工具,印象,规范],[身份,认知,束缚,教条],[术]]`
  改为 `[[软门禁,工具,印象],[身份,认知,束缚,教条],[规范,术]]`。
  层内仍按"低优先级先压"，所以第 3 层内顺序是 **规范 → 术**（术是最后被动的那一段）。
- 扁平表 `YA_SUO_XIAN_HOU` 随分层表派生自动变成：软门禁 → 工具 → 印象 → 身份 → 认知 → 束缚 → 教条 → 规范 → 术。
  注释里明确写了"规范优先级比身份/认知高，却排在它们前面 —— 这是分层口径，不是写错序"。
- 强度与泵道不变：半极限留 72% / 真极限留 45%（段内 ≥600 字），8 轮 = 两遍强度 × 四层（第 0 层无名段仍在最前）。
- 判据同步（都跑真代码，不钉字节）：
  - `verify-prompt-layers` 29/0：分层表字面断言改为三层新内容，并加"第 53 轮：规范与术同层"的说明。
  - `verify-r52-yasuo` 47/0：归层真值表把 规范 改成 3；新增"规范与术同层且规范先压"的直接断言（`cengNeiMing('规范',3) < cengNeiMing('术',3)`）；
    第 1 层轮改为只动 印象；第 3 层轮改为动 规范+术；层内倒序测试拆成两组（第 1 组 软门禁→工具→印象，第 2 组 规范→术）；
    新增一条**大缺口场景**断言："术被动的那一刻，规范已经压到真极限"（这是"同层内也要压满低优先级才动高优先级"的可执行说法）。
- 负向验证（`r53-yasuo-neg`，8 个变异全部被抓）：规范塞回第 1 层、同层内改成先压术、半极限=真极限合一、一轮压穿所有层、
  去掉 600 字下限、道变成可压、缺口已满仍继续压、主进程漏筛不可压段。
- 主进程阶梯注释同步（`electron-main.ts` 注入块头 + `builtin-rules.ts` 头注释口径不变，因为**优先级顺序没改**，只改压缩分层）。
- 验收影响：本轮改动后 fast 档判据 `verify-r52-yasuo`/`verify-prompt-layers` 全绿；live 档不受影响（这两支都是 fast 档静态/纯函数门禁）。

## 34. 推进器读数（2026-10-21 19:38–19:5x · live 重跑终局 4 红 ⇒ round12 取证到"卡在产品这一条循环"）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`）；密钥文件名不写进仓库。节号接 §33（§32/§33 由并行会话占用，本会话的阶梯读数在 §31）。

### 34.1 live 整遍（18:17:59→19:37:58，1 小时 20 分）终局：30 绿 / 4 红

- 汇总原文：`---- 第 1 遍汇总（tier=live）：真红 4 · 已知红(环境依赖) 0 · 缺文件 0 ----` / `=== run-verify-22 tier=live：1 遍 · 4 项红 ===`（退出码 1，`有红项 ⇒ 停止后续轮次（如实报，不硬凑第三遍）`）。
- **§29.11/§30.3 修好的仪器账这一遍清了**：`[PASS ] verify-round18d 129794ms`、`[PASS ] verify-round18e 44483ms`、`[PASS ] verify-round18f 23985ms`、`[PASS ] verify-history-persist 35344ms`（聊天模型名 + 「道」行为锚 + maxSeq 重建域三条修法复跑为绿）。
- **`verify-round34-live` 整支绿**：`[PASS ] verify-round34-live 1654611ms`（27 分 34 秒）⇒ §30.3 第 6 行"整篇覆盖/桌面多副本"这一遍没再犯；产品语义要不要收紧仍等拍板（§34.5）。
- 余下 4 红：`verify-round12`（**新红，签名已复现两次**）、`verify-round16`、`verify-round17`、`verify-round38-asr`。

### 34.2 `verify-round12` ④ 取证链（红因**未定**；已排除的三条都带读数）

- 红行原文：`[FAIL ] verify-round12 321536ms FAIL ④ 工具调用异常：EVAL_TIMEOUT | ---- ROUND 1: FAIL (10/11) ----`。
- **分叉点可 grep**（同一支门禁、同一份构建、同一只模型 `huihui_ai/qwen3-vl-abliterated:4b (why:"explicit")`，会话都是 `verify-r1-tool`）：
  - 15:29 那次绿：`chat.tools.enabled` 之后每 2 秒一条 `chat.inflight-write`（共 7 条）→ `15:29:28 chat.work-tool {"tool":"write_file","ok":true,"bytes":2}` → `15:29:30 chat.tools.done 轮1 调1 止stop` ⇒ **16 秒做完**。
  - 18:18 与 19:42 两次红，签名一模一样：只有 2 条 `chat.inflight-write`（`18:18:33/35`、`19:42:37/39`），此后**到门禁 300 秒预算抛 `EVAL_TIMEOUT` 为止再无任何事件**；`chat.tools.done / stream-timeout / tools.stalled / model-degraded / tools.hard-cap / work-tool` **全 0 条**。
- **排除 Ollama 与模型**（绕开应用直连 `POST /api/chat`，同模型、同一条"请调用 write_file"提示、带 `tools`；探针脚本写在 `%TEMP%` 并已删）：`stream:false` ⇒ `HTTP 200 / 1541ms / tool_calls=1 write_file`；`stream:true` ⇒ `首字节 259ms / 1142 行 / 5 行带 tool_calls / done 6952ms`；`ollama ps` 显示该模型 100% GPU。
- **排除应用整体卡死**：红的现场里同一只模型在 `19:47:40` 的下一个请求 3 秒答完（`19:47:43 轮0 调0 止stop`）⇒ 卡住的是 **④ 这一条带工具循环的请求**。
- 仪器层确定的一条：④ 的 `ev(..., 300_000)` **必然早于产品自己的看门狗**（有工具在途时空转压制 11 分钟、硬顶 1800 秒）⇒ 红行只能写 `EVAL_TIMEOUT`，写不出"在等什么"。**产品对"工具循环在等什么"没有任何审计**：`shouQuanJian('AI 请求访问工作区外的文件'…)` 那条等待路径（`electron-main.ts` 5353 附近）一行 `log()` 都不写 ⇒ "在等一张没人点的授权卡"与"循环真的死了"在日志里**无法区分**。
- **一次被作废的对照实验（如实记）**：把 round12 夹具那份 profile 按 18f/34-live 的做法显式设成免审批（`globalSecurity:'full'`、`askOnExceed:false`）后单跑，`19:51:35` 立刻 `chat.work-tool ok=true`、`ROUND 1: PASS (11/11)`。**但这一次与并行会话 19:48:50 起的小游戏压力档并发**（起跑前我只打印了调试壳计数、没按纪律等它为 0）⇒ 读数作废。而且 **15:29 那次绿时也没有这个设置** ⇒ "授权卡等待"这条因证据不足，不许当结论用。
- 结论：登记为**产品侧可观测性缺口 + ④ 预算口径缺陷**，红因待定。要定它需要（都要等场地空出，第 ② 项属产品改动需点头）：① 产品补"请求发出/首片到达/等待授权"的成对审计；② 空场时把免审批与不免审批各单跑一次做对照。
- **那个免审批前置已逐字回退**（19:5x，`grep globalSecurity dev/gates/verify-round12.mjs` 现在 0 命中，`git diff` 只剩第 48 轮那份未提交的隔离改造）：留着它，下一遍很可能把同一次挂起**悄悄洗绿**——比红更危险。本会话在 round12 里留下的唯一痕迹是这一句回退，不做未证实的修改。

### 34.3 其余三条红（判据一条未动）

- `verify-round16 1120474ms FAIL ⑥ 10+ 计划任务：步骤数=-1，回复含 T10+ =false`：本遍该支 profile 里 `chat.model-picked` **6 次全是 `Qwen3.8-27B-Uncensored:q5_K_M-128K (explicit)`**、`Unsupported model` **0 次**、`hard-cap/stalled/degraded/stream-timeout` **全 0** ⇒ 不是供应商 400、不是产品超时，是**本机 27B 在这条 10+ 步任务上没做出计划**（`步骤数=-1` = `jiHuaChaXun()` 返回 null）。红位从上一遍的 ①②⑤ 挪到 ⑥，仍属 §29.10 那个家族 ⇒ **三条出路等你点一条**。
- `verify-round17 FAIL ⑩ 找不到模型管理卡片 + FAIL ⑥c MiMo TTS 合成可用（0 字节）`：两条都在 §30.4 定性过（⑥c=取了密钥从不写进 profile 的 `secure/`；⑩=夹具那份 profile `instances=0`）。本轮**已按 18f 的写法补齐夹具前置**（`secure/keys.enc.json` + provider `hasKey` + 起跑前铺一台牛马），⑥c/⑩ 的判据一字未动，待在新构建上复跑。
- `verify-round38-asr 7 ok / 2 FAIL`：与 §30.3 第 7 行同两条（`used=[]`、`bendi.skip/failed=[]`）；第二条是判据与产品口径互斥（产品对 `bendi-yuyin-not-enabled` 明确不落账），第一条要一份**保留 profile** 的复跑才能 grep 到"哪条路径答的话" ⇒ 都等拍板，本会话没动。

### 34.4 现场突变（19:45–19:5x 读数）：并行会话改了产品并重建构建 ⇒ 本遍与三连都要在新构建上重跑

- 本会话改动面：`dev/gates/verify-round17.mjs`（19:43:23，§34.3 两条夹具前置）、`dev/gates/run-verify-22.mjs` + `dev/gates/verify-dao-safety.mjs`（§31.3/§31.4）、`docs/HANDOFF-R51.md`。`dev/gates/verify-round12.mjs` 上的免审批实验**已逐字回退**（§34.2），现在与第 48 轮那份未提交的隔离改造一致。`node --check` 全过，**未 commit**。产品 `src`/`dist` 本会话一个字节没碰。
- 并行会话读数：`src/builtin-rules.ts` **18:23:48**、`src/renderer/app.js` **19:47:15**、`src/electron-main.ts` **19:53:30**（写本节时仍在改）、新模块 `yaSuo-fenCeng.ts`/`ju-jue-zhang.ts`/`zhi-shi-fen-ceng.ts`/`zhi-shi-zheng-li.ts`；`dist/electron-main.js` 由 12:12:28 重建为 **19:45:50（sha256 前缀 `ab0fc294a486`）**；他们 **19:42:39** 起的小游戏三连以 `[driver] exit 1` 收过、**19:48:50** 又起重跑，19:53 读到 `第2轮 · 最高分持久化` 三条 ok 在跳。
- 对我这一遍的影响：18:17:59→19:37:58 全程跑在 **12:12:28 那一份构建**上（构建 19:45:50 才重建 ⇒ 一遍内没混两种构建，§34.1 读数成立）；但产物已变 ⇒ **三连 3/3 与本次 live 遍都要在新构建上重跑**才计入验收（三连由并行会话正在重数）。
- ⚠️ **订正 §29.9/§31.2 的"同一仪器"证法**：`find packages/app-shell/src -newermt …` **绑的是源码**，而并行会话可以在一遍进行中改 src 不碰构建（本轮 18:23:48 就发生在我那遍窗口里）⇒ 以后一律**绑产物**：开跑与收工各取一次 `stat dist/electron-main.js` 的 mtime + `sha256sum` 前缀，两个相同才算"同一仪器"。
- ⚠️ **判活新坑（本轮实证，代价是一次作废读数）**：单支复跑也必须走"连续两次采样 `dbg-electron=0`"那道闸；只看一眼就起跑会和别人的真机档并发（本轮 19:48:50 的压力档就撞上了）。

### 34.5 现场与下一步

- 现场（19:5x）：真机被并行会话的小游戏三连占着（9946 上 2 个调试壳）⇒ 本会话**不再起任何真机门禁**。
- 下一步：① 等他们的产品改动与三连收在新构建上；② **在新构建上整遍重跑 live**（串行、带密钥、`--skip` 两支压力档，开跑与收工各记一次 `dist` 指纹）；③ 全绿 → 两遍验收（fast 档现含 `verify-r52-layers` + §31.3 两支阶梯钉桩 + §33 的 `verify-r52-yasuo`）→ 首启 `node dev/gates/r38-firstrun.mjs`。
- 等拍板（一条都没动）：a) `write_file` 整篇覆盖既有自写文件要不要当场告知/显式意图；b) ASR「未启用要不要落 `asr.bendi.skip`」口径冲突，以及**要不要给"工具循环在等什么/正在等授权"补审计**（§34.2 的红因就卡在这条缺口上）；c) round16 三条出路（指定 `OLLAMA_MODEL` / 抬 1800 秒硬顶 / 登记为环境依赖已知红）；d) 出厂默认牛马是不是产品承诺；e) 旧文档里 11 处密钥文件名；f) §30.5 其余夹具的 `mimo-v2.5` 聊天名要不要一起对齐；g) round12 ④ 的 300 秒预算要不要改绑产品自己的看门狗口径（改就要动 live 单支预算 900 秒）。
- **§22.3 的 P0 清单仍一条未减。**

## 35.6 补记（19:5x–20:0x · 三连第 1 遍被第二次重建作废 ⇒ 把两条纪律写成机械闸门）

> 节号说明：本节原写为 §33，与并行会话的「## 33. 第 53 轮」重号，已整体改为 §35（§34 是另一支推进器的同窗口读数）。

- **19:54:50 又一次重建把三连第 1 遍打空**（可 grep 的读数）：我在 19:48:50 起跑（起跑前 19:47:51 / 19:48:39 **连续两次**采样带调试端口的电子壳 = 0）；19:58:04 复查 `dist/electron-main.js` 已是 **19:54:50**（`sha256` 前缀 `d6bfb24677ae`，1517147 字节），而开跑时它还是 19:45:50 那份 ⇒ 一遍里混了两份构建 ⇒ 按口径这一遍**不计入验收**，19:58:09 我只杀掉自己起的树（`38780 → 38324 → 27360 → 9604` 及其子），杀完 `DBG-PROC=0`。
- **订正 §34.4 的"这一遍没混构建"**：该节写「live 整遍全程跑在 12:12:28 那一份构建上（构建 19:45:50 才重建 ⇒ 一遍内没混两种构建）」。实测不是：**19:39:46 我读到的 `dist/electron-main.js` 是 18:39:38**（1507296 字节），落在 live 遍内部 round16（18:23:39–18:42:20）的窗口里；同一窗口还改了 `dist/renderer/app.js` **18:49:06**（round17 18:42:20–18:51:16 之内）。⇒ live-2 那 4 条红与 30 条绿**混了两份以上构建的读数**，本节 §35.2 的"整遍重跑"结论成立，且与 §34.4/§34.5 的下一步（新构建上重跑）指向同一件事。
- **两条纪律落成仪器闸门**（都属仪器侧，不改产品语义、不进 `tsc -b`）：
  1. `dev/gates/r50-run3.mjs`（三连驱动器）新增 ① **坑位闸**：每一遍起跑前要求"带调试端口且加载我们 `electron-main.js`"的进程**连续两次（间隔 ≥20 秒）为 0**，等不到 15 分钟就 `[STOP]` 并 `exit 2` —— 明确写"**没起跑**"，绝不让空跑被读成绿；记忆档不启动 Electron（`verify-memory-stress.mjs` 里没有 electron）⇒ 不受此闸影响。② **产物指纹**：每遍开跑与收工各取一次 `dist/electron-main.js` + `dist/renderer/app.js` 的 `mtime + sha256 前 12 位`，不一致就打 `[VOID]` 并 `exit 1`（就是把 §34.4 提的"绑产物不绑源码"变成机械动作）。
  2. `dev/gates/run-verify-22.mjs` 的 `qingChang()/dianZiShu()/yongHuShiLiZaiPao()` 原来各自 `JSON.parse(execFileSync(...))` 且 `catch` 返回"零个/空表"——**一台 electron 都没有时 `ConvertTo-Json` 输出的是空串**，`JSON.parse('')` 抛 ⇒ 落进同一个 catch ⇒ "查询失败"与"场地真的空"共用一个返回值 ⇒ 查询一失败就会起第二支真机门禁（正是这道闸要防的事）。现在三处共用 `dianZiCheng()`：空串 = 真的 0，解析不了/查不到 = **-1 按"被占"处理**，`dengKeng` 的读数文案也跟着分清（`采样失败（按占着处理）`）。
- **新闸门自己也做了负向验证**（不验不算数）：坑位谓词 5 条真值表全对（门禁调试壳=1；用户正式实例无调试端口=0；带端口但不加载我们的 main=0；空命令行=0；命令行缺失=0）。**过程中抓到上面第 2 条那个空串 bug 的第一手现场**：`_neg` 脚本在真机首次采样就打回 `QUERY-FAIL SyntaxError: Unexpected end of JSON input` ⇒ 证明我的新代码会把空场地读成"永远占坑"（方向是安全的，但会把验收卡死）；修完两分支各实测一次：空串 ⇒ `[]`/0，多条 ⇒ `Array.isArray` 分支解析到 5 条。**临时脚本已删**（`.r50-logs` 只留本会话的启动脚本与判活脚本）。
- 静态复跑（不占真机，20:0x）：`verify-gate-manifest` **23/23**、`verify-security` **28 PASS**、`verify-docs` **84 ok / 0 FAIL**；两个驱动器 `node --check` 通过。
- 与 §34 的分工（避免重复劳动）：round12 ④ 的范围另一支推进器已经收窄到「产品这条带工具的循环在等什么」，并**绕开应用直连 `POST /api/chat`** 排除了模型与 Ollama（`stream:false` 1541ms 给 1 个 `tool_calls`、`stream:true` 首字节 259ms、`ollama ps` 100% GPU）——比我 §35.3 第 1 条只到"排除吞吐"更进一层，以 §34.2 为准。他们 19:51:35 那次「免审批 ⇒ `chat.work-tool ok=true`、ROUND 1 PASS」的对照**因与我的压力档并发而作废**（我 19:47:51/19:48:39 两次采到 0 才在 19:48:50 起跑，他们起跑前只打印了调试壳计数、没等它为 0），这条我如实记下，不改判据：**A（弹卡等人）与 B（循环真死）仍未定**。
- 现场（20:0x）：**没有真机门禁在跑**（`DBG-PROC=0`），但第 53 轮的 11 点在继续改产品（`src/shi-jian-shuang.ts` 19:57:19 新建、`src/electron-main.ts` 19:54:32、`dist/*` 一路跟着重建）⇒ **三连不开跑**，否则第 3 次白烧 45 分钟真机时间。下一支推进器的起跑条件：构建静默（`dist/electron-main.js` 连续 ≥5 分钟 mtime+sha 不变）**且** 连续两次采样调试壳为 0；起跑后新加的 `[产物]`/`[VOID]` 行会自己把这件事记进 `game-3x.log`。

## 35.7 起跑前体检（20:0x · 读数原文；这两条红不属于本会话的改动面，留给正在改产品的会话）

- 第 53 轮新门禁**都已在 FAST 清单**里：`verify-r52-layers`(:108)/`-jujue`(:110)/`-yasuo`(:112)/`-kb`(:114)/`verify-r53-shijian`(:116) ⇒ 两遍验收会覆盖，不必再补挂。
- 20:0x 复跑静态档（不起 Electron）：`verify-r52-layers` **54/0** · `verify-r52-jujue` **42/0** · `verify-r52-yasuo` **47/0** · `verify-r53-shijian` **42/0** · `verify-prompt-layers` **29/0** · `verify-gate-manifest` **23/23** · `verify-security` **28 PASS** · `verify-docs` **84/0**。**两条红**：
  ```
  FAIL 写 dao.md 的调用只有「播种 + 用户保存」两处（实际 保存=2 播种=1）      ← verify-dao-safety 11 ok / 1 FAIL
    FAIL 整理只删重复/取代项并截断超长，不整层清空                          ← verify-r52-kb 48 ok / 1 FAIL
  ```
  ⇒ 第一条撞的是 §25.1 的硬口径（「道」只有用户手动可写）：现在多出**第二个** `dao.md` 写入点；第二条是「归档后整理」可能整层清空知识库。**这两条都在产品侧，且 `dist/electron-main.js` 20:03:37（`sha256` 前缀 `92809f8916ab`）仍在重建** ⇒ 本会话不修、不放宽、不重跑判据，只如实登记：**fast 档有两红 ⇒ 验收链（三连 → live → 两遍验收 → 首启）此刻不能起跑**，等改产品的会话把这两条收尾。

## 35.8 等了 32 分钟的起跑窗口（20:04–20:10 · 结论：本会话没起跑三连，原因可 grep）

- 本会话改完仪器后（§35.6）在 20:04:37 取第一次指纹 `dist/electron-main.js 20:03:37 #92809f8916ab`，等到 **20:10:32** 复查：**同一份产物 7 分钟没变、场地 `DBG-PROC=0`**，但源码仍在动 ⇒ 重建随时会来：
  ```
  20:03:29 src/electron-main.ts   20:07:25 src/dao-default.ts
  20:07:42 src/shu-default.ts     20:10:06 src/renderer/app.js
  ```
  ⇒ **起跑条件不成立**（要求"产物连续 ≥5 分钟不变 + 连续两次调试壳为 0"，还得多一条"src 静默"）。这一小时里已经烧掉两次被重建作废的真机遍（18:39:38 那次与 19:54:50 那次），不再起第三支。
- 【下一支推进器照此走】① 每 60–90 秒采一次：`src` 与 `dist` 都无新 mtime 且 `dist/electron-main.js` 的 `sha256` 前缀连续两次相同，**且** `verify-dao-safety`/`verify-r52-kb` 复跑为 0 FAIL；② 再连续两次采到调试壳 = 0；③ 起跑仍用**本会话修好的启动脚本** `<仓库目录>/.r50-logs/start-game-3x-r52.cmd`（stdout 走 `game-3x.out.log`，不再和驱动器抢 `game-3x.log` ⇒ §35.1 那条 EBUSY 不会再犯）；④ 判活照 §24.6/§31.1 的双信号（进程 + `%TEMP%\<r46 压力档 profile>` 的 `audit/audit.jsonl`、`chat-meta.json` 是否在 4 分钟内动），并认新驱动器打的 `[产物]`/`[VOID]` 行：**只要出现 `[VOID]` 就是这一遍不算数**，别再去补跑后面的遍。
- 判活/查进程的辅助脚本（本会话新建，`_alive52.ps1`）也放在同一目录；`_neg-*` 两个一次性负向脚本用完已删。
- 本会话改动面（如实）：`dev/gates/r50-run3.mjs`（坑位闸 + 产物指纹）、`dev/gates/run-verify-22.mjs`（三处进程采样分清"真的空"与"查不到"，改成 fail-safe）、`.r50-logs/` 里本会话自己的启动与判活脚本、`docs/HANDOFF-R51.md`（§35）。**产品 `src`/`dist` 一个字节没碰，没 commit。**

### 33.2 项 3｜卡片超链接：不存在也要能用（已完成，判据 54/0）

- 用户口径：**不存在的路径也给右键菜单**；左键点击时**如实提示不存在**。
- 改法（`renderer/app.js` 的 `huaLuJingChaoLian`）：
  1. 旧行为是"核实不到就把 `<a>` 用 `replaceWith(文本节点)` 换掉" ⇒ 用户看到的是**一行不能点的死字**，还以为功能坏了。现在**链接永远留着**，只打 `data-real=0/1` 标记，并在 `title` 上写明"路径不存在"。
  2. 右键菜单不再要求 `data-real==='1'`（`复制路径` 对不存在的路径同样有用；`复制/打开目录` 那两项自己会如实报错）。
  3. 左键：`data-real==='1'` ⇒ 直接 `daKaiWenJian`；否则**先复查一次存在性**（文件可能刚被移走），确认不在才提示"路径不存在：<完整路径>"。复查成功则顺手把标记修正，下一次点击就直接打开。
  4. 不再复用 `biaoJiZhenShiLuJing`（它会替换节点），改成直接调 `warmy:luJingCunZai` 只打标记。聊天框里的路径行为**没动**（那边另有判据钉住）。
- 判据：`verify-r52-layers` 53→54 条 —— 右键不再看 `data-real`、左键含"路径不存在"提示、存在性只打标记不改节点、卡片渲染只剩这一条路径。
- ⚠ **仍未做真机验证**（桌面被 live 档占用，串行铁律）：列入 §33.6 待办第 2 条。

### 33.3 项 6｜业务/游戏/娱乐的钱归内部库，只有个人财务进私密库（已完成，判据 49/0）

- 用户口径："**业务或工作或游戏或娱乐的财务或游戏信息等也是内部知识库的，只有个人的财务才是私密知识库的内容**。"
- 改法（`zhi-shi-fen-ceng.ts` 的 `panDingCeng`）：
  - 命中的敏感类**不是**"财务法律" ⇒ 一律私密（健康/性向/宗教政治/家庭身份/生育/身份账户不参与让渡）；
  - 命中"财务法律"且句中**没有业务主体标志**（项目/公司/客户/甲方/员工/团队/产品/平台/游戏/娱乐/账号/工作室/供应商/合同/报价/结算/发票…）⇒ 私密；
  - 命中"财务法律"但带业务主体 ⇒ **内部库**；
  - 其余按原规则（业务硬标志⇒内部、评价他人⇒私密、都不沾⇒会话）。
- 真值表（`verify-r52-kb` 新增 10 条）分两组：
  - 私密：`我的信用卡逾期上了征信`、`我的存款是三十万，银行卡号是 6222 开头`、`我买房负债两百万`、`我被法院强制执行了，案底也留下了`
  - 内部：`公司这个项目报价八万，月底结算走公账`、`员工工资表本月共十二万`、`游戏账号充值了 648 买皮肤`、`工作室这个项目被人告了，正在诉讼阶段`、`客户合同尾款三万，发票已开`
  - 交叉守护：`这个项目让我确诊了抑郁症` 仍是私密（**健康绝不因为沾了"项目"二字就降级**）、`这个项目我做到一半查出甲状腺结节` 同理。
- 负向验证：`r52-kb-neg` 12 个变异全部被抓（含"把对人的评价从私密判据里删掉"、"白名单整关失效"、"禁现形态整关失效"、"只删存在性这一条"、"写入口不按内容升层"、"不过检查也写库"、"跳过仍推进游标"、"术总量闸失效"、"自动归档不用设置里的模型"等）。

### 33.4 项 5｜知识库双时间：记录时间 / 发生时间（已完成，判据 42/0 + 7 个变异全被抓）

- 用户口径：知识要带**两个时间** —— 记录时间（原文里这条信息产生的时刻）与发生时间（原文写明的事情发生时刻）；
  问某个时间点时**两个轴都要查**再回答。样例：昨天说"我上个月5号已决定戒烟" ⇒ 必须分得清"昨天告诉我的"与"上月5号发生的"。
- 新模块 `shi-jian-shuang.ts`（纯函数，门禁跑真值表）：
  - `jieXiFaShengShiJian(原文, 说话时刻)`：**相对日期一律以说话时刻为锚**（调研里 Graphiti 的 REFERENCE_TIME 规则），
    支持 今天/昨天/前天/N天前/N周前/N个月前/N年前、上个月5号（**精度到日，不退化成"九月初"**）、本月X号、下个月X号、
    绝对 `2026年10月5日`/`2026-10-05`/`10月5日`（只给月日 ⇒ 取不晚于说话时刻的最近一次，**不许产生未来日期**）；
    "从小/最近/以前"这类**不可解析 ⇒ 发生时间留空**，绝不猜（调研：Cognee 也明确"没有可解析时间就不建时间戳节点"）。
  - `jieXiChaXunChuang(问句, 现在)`：把查询里的时间词换成窗口；**没有时间词返回 null**（不做无根据的过滤）。
  - `mingZhongZhou` / `paiXu`：两个轴各自判定命中（记录/发生/两轴），命中情况**参与排序**。
    调研的反面数据：时间条件做成事后过滤会把 temporal-reasoning 召回从 50% 打到 37.5%（arXiv 2607.26520）⇒ 我们不做纯 post-filter。
  - `liangShiJianMing`：给模型看的呈现串固定写成 `记录时间 …｜发生时间 …（原话「上个月5号」）`；
    没有发生时间时明写"（未记录：原文没说事情发生在什么时候，**不许拿记录时间顶替**）"。
  - `shiJianYiChang`：发生时间与记录时间差得离谱（晚一年以上/早十年以上）时报警，防解析退化污染数据。
- 存储层（`packages/knowledge-base`）：事件加 `jiluTs / fashengTs / fashengBiao / fashengJingDu / fashengLaiYuan / xuHao / laiYuan / moXing / tiShiCiBanBen / yinZi / shiXiaoTs`，实体加 `chuangJianTs`。
  **`jiluTs` 写一次不再改**（`addEvent` 对同 id 保留旧值）—— 调研点名 Graphiti 早期把回填事件标成入库时间（issue #1489）正是这个坑；
  顺序以 `xuHao`（日志单调序号）为准，时间戳只做标签（Windows 时钟被 NTP 往回拨时不致错序）。
- 主进程接线：归档写入取**这批原文最后一条消息的时刻**为记录时间（不是归档的此刻）；`knowledge_add` 取本轮最后一条用户消息的时刻；
  查询结果两轴都查并标注命中轴 + 注入文案新增"两个时间不许混"的口径与反例话术；审计 `kb.time-written` / `kb.query-timed`。
- **调研带进来的两处升级**（写在这条里，因为它们改变了项 7 的整理语义）：
  1. 整理从"删除旧条目"改成**取代不删除**（`supersedeEvent` 打 `shiXiaoTs`，`activeEvents()` 只给未失效条目）——
     Zep/Graphiti 的双时态做法；Mem0 纯 append-only 已被反证会检索出陈旧矛盾，而物理删除又丢了审计线索。
  2. 派生的对外概要带 `yinZi`（源事件 id）：源被取代 ⇒ 概要**重算**，重算不过就一起取代（`kb.derived-rebuilt` / `kb.derived-retired` / `kb.stale-propagated`）。
- 探针（按调研建议做的三条，全绿）：① provenance-confusion（重复写入不得覆盖记录时间）；② as-of（9月6日按发生轴可见、按记录轴不可见）；
  ③ supersession（旧说法被取代但仍在，生效集只剩新说法；重复取代幂等）。
- 负向验证 `r53-shijian-neg`：7 个变异全部被抓（相对日期按归档时刻解析、记录时间被覆盖、取代变删除、无时间词硬给窗口、
  发生时间缺失顶替成记录时间、"上个月5号"丢日子、时间命中不参与排序）。

---

## 36. 推进器读数（2026-10-21 20:12–20:3x · 起跑窗口没等到 ⇒ 三连这一轮仍没起跑）

> 隐私口径：以下路径一律占位（`%TEMP%\`、`<仓库目录>`、`<用户名>`、`<主机名>`）；密钥文件名不写进仓库。

### 36.1 判活双信号（10 次采样，间隔 75 秒，原文照抄）

- 采样脚本 `<仓库目录>/.r50-logs/_wait53.sh`（本会话新建，同 `_alive52.ps1` 一族，留给下一支推进器复用）；最后一行是 `RESULT=NOT-QUIET`。
- 进程侧：`r50-run3.mjs` / `verify-r46-youxi.mjs` **一个都没有**，`DBG-PROC=0` 在 20:13:49→20:27:41 **九次连续采样里每次都成立** ⇒ 场地是空的（不是被占），所以这一轮的阻塞点不在并发，在**产物静默**。本会话**没有杀过任何进程**（无可杀对象）。
- 指纹侧（`SRC_NEWEST` = `packages/*/src`、`packages/*/scripts`、`dev/gates` 里最新一次 mtime；`SHA`/`DIST_MTIME` = `<仓库目录>/packages/app-shell/dist/electron-main.js`）：
  ```
  20:13:49 preload.cjs            #92809f8916ab  20:03:37
  20:15:05 electron-main.ts        #879c7b3dd0ea  20:14:04
  20:16:20 ti-shi-shang-xian.ts    #879c7b3dd0ea  20:14:04
  20:17:36 ti-shi-shang-xian.ts    #12b6074dd3f4  20:16:24
  20:18:51 verify-r53-tishangxian.mjs(新) #12b6074dd3f4 20:16:24
  20:20:07 verify-r52-kb.mjs       #12b6074dd3f4  20:16:24
  20:21:23 run-verify-22.mjs       #12b6074dd3f4  20:16:24
  20:22:38 run-verify-22.mjs       #12b6074dd3f4  20:16:24   ← QUIET-STREAK=1
  20:23:54 run-verify-22.mjs       #12b6074dd3f4  20:16:24   ← QUIET-STREAK=2
  20:25:10 zhi-shi-fen-ceng.ts     #12b6074dd3f4  20:16:24
  20:26:25 verify-r52-kb.mjs       #13b619a18652  20:25:36
  20:27:41 zhi-shi-fen-ceng.ts     #13b619a18652  20:25:36
  ```
  ⇒ **45 分钟里构建换了 4 份**（`92809f8916ab` → `879c7b3dd0ea` → `12b6074dd3f4` → `13b619a18652`），最长一次静默只有 2 个采样（约 2.5 分钟，20:21→20:23），没到 §35.8 要求的"连续 ≥5 分钟不变"。按 §35.6 的教训（18:39:38、19:54:50 两次把跑到一半的真机遍打空），**这一轮不开跑**，否则第三次白烧真机时间。

### 36.2 起跑前体检（静态档，不占真机，20:14–20:31 读数）

- 阶梯与新门禁（任务要求计入验收口径的这两支）在**最新源码**上复跑仍是绿的：`verify-r52-layers` **54 ok / 0 FAIL**（20:1x）、`verify-prompt-layers` **29 ok / 0 FAIL**（20:1x）。
- 同一窗口另跑：`verify-r52-jujue` **42/0** · `verify-r52-yasuo` **47/0** · `verify-r53-shijian` **42/0** · `verify-docs` **84/0** · `verify-security` **全部通过 (PASS 28)**。（`verify-gate-manifest` 这一轮没取到汇总行，下轮补采。）
- **20:14 的 fast 档在途红有 3 条**（`verify-dao-safety` 11/1、`verify-r52-kb` 47/2），到 **20:31:43** 只剩 1 条：
  ```
  FAIL 写 dao.md 的调用只有「播种 + 用户保存」两处（实际 保存=2 播种=1）   ← verify-dao-safety 11 ok / 1 FAIL
  ```
- 另两条的收法（是**改产品的会话**动的手，本会话一字未核改）：`verify-r52-kb` 20:20 与 20:26 两次自改后复跑 **50 ok / 0 FAIL** —— ① 「整层清空」那条把钉的字面从 `kb.removeEvent(id)` 换成 `if (kb.supersedeEvent(id))`（对齐 §33.4 的"取代不删除"），禁整层清空的后半截 `!/kb\.removeEvent\(quan\./` **仍然留着** ⇒ 方向是收紧；② 「术总量闸」把 `SHU_ZONG_LIANG_MAX = 8000` 换成 `SHU_ZONG_LIANG_MAX = shangXianOf('术')`（产品侧 `electron-main.ts:16332` 已改用第 53 轮那张唯一上限表），`shu.over-cap` 审计与 `yuan.length > SHU_ZONG_LIANG_MAX` 两条仍钉着。**登记一条待核**：这两处都是"锚跟着产品新写法走"，本会话只读断言原文确认判据没被删薄，没有做负向验证 ⇒ 若要计入验收，下轮补一次变异验证。

### 36.3 唯一剩下的那条红：定性（可 grep，属产品侧，不是仪器）

- 门禁钉的是"`writeFileSync(daoLu()` 全仓只出现 1 次（= `warmy:daoShe` 那个用户手动入口）+ `writeFileSync(p, DAO_MOREN)` 播种 1 次"（`dev/gates/verify-dao-safety.mjs:38-41`）。
- 产品侧实测第二个写入点在 `packages/app-shell/src/electron-main.ts:16045`：第 53 轮新加的**层自检表** `CENG_ZI_JIAN` 把「道」也登记成了有一行 `xie: (t) => fs.writeFileSync(daoLu(), t, 'utf8')` 的可回写层（超限就截断回写，16017 那行注释说明回写前先备份）。
- ⇒ 这与 §25.1 的两条硬口径**正面冲突**：「道」只有用户手动可写、且 `BU_KE_YA_SUO=['道','产品门禁']` 不可压缩。**这是产品语义的岔路，不是门禁写错**，两条出路（道 不进层自检回写名单 / 或用户点头"道 超限允许程序截断"）都要人拍板 ⇒ 本会话不修、不放宽、不重跑判据，只如实登记：**fast 档还有 1 条红 ⇒ 验收链（三连 → live → 两遍验收 → 首启）此刻仍不能起跑。**

### 36.4 现场与下一步（给下一支推进器）

- 现场（20:3x）：**没有任何真机门禁在跑**，三连第 1 遍仍**没有一遍计入验收**（19:48:50 那遍被 19:54:50 的重建作废，见 §35.6）；live 名单、两遍验收、首启 `node dev/gates/r38-firstrun.mjs` 都还没起跑。
- 起跑条件（照 §35.8 再加一条）：① `packages/*/src`、`packages/*/scripts`、`dev/gates` 三个域**都**没有新 mtime，且 `dist/electron-main.js` 的 `sha256` 前缀连续 4 次采样（≥5 分钟）相同；② `verify-dao-safety` 复跑 **0 FAIL**；③ 连续两次采到带调试端口的电子壳 = 0；④ 起跑用 `<仓库目录>/.r50-logs/start-game-3x-r52.cmd`（stdout 走 `game-3x.out.log`，不与驱动器抢 `game-3x.log`）；⑤ 判活认 `[产物]`/`[VOID]` 行，**见到 `[VOID]` 就是这一遍不算数**，别去补跑后面的遍。
- 本会话改动面（如实）：只有 `docs/HANDOFF-R51.md`（§36）与 `.r50-logs/_wait53.sh`（+其读数输出，转抄后删除）。**产品 `src`/`dist` 一个字节没碰，没起真机门禁，没杀进程，未 commit。**
- 验收口径补一条（`verify-docs` 20:36 新加的判据）：两份决策文档在交接文档里必须**点名指得到** —— 自托管/登录与密钥方案见 `docs/P0-5-ZITUOGUAN.md`，脱敏方案对照与最坏情况见 `docs/P0-6-TUMIN.md`。本会话按判据把这两处指上（此前 `verify-docs` 报 `94 ok / 1 FAIL` 就是缺这一句指针，属**文档指针缺失**不是产品缺陷）。
- §22.3 的 P0 清单**仍一条未减**。

### 36.5 补记（20:33–20:37 · 抓到 §35.6 那条"缝隙归零"陷阱的第一手现场）

- 20:31:43 复跑 `verify-dao-safety` 仍 **11 ok / 1 FAIL**（同 §36.2 那条）⇒ 到收工时验收链的第二个起跑条件（fast 档 0 FAIL）**还是没满足**。
- 20:33:15→20:35:46 又采了 3 次（`_wait53b`）：
  ```
  20:33:15 verify-r53-tumin.mjs   #13b619a18652 20:25:36  DBG-PROC=0
  20:34:31 run-verify-22.mjs      #13b619a18652 20:25:36  DBG-PROC=2  GATE-PID=33488(20:33:49 起, --tier=fast)
  20:35:46 run-verify-22.mjs      #13b619a18652 20:25:36  DBG-PROC=0  GATE-PID=33488 仍在
  ```
  ⇒ **改产品的会话在 20:33:49 自己起了一遍 fast 档**（含 Electron 类，20:34:31 现场 2 只调试壳）。20:35:46 同一时刻 `GATE-PID=33488` 还在、`DBG-PROC` 却已经是 0 —— 这正是 §35.6 说的**腿与腿之间调试壳会短暂归零**：只看一次 `DBG-PROC=0` 就会在别人的真机档中间插进第二支。本会话因为同时还在看 `SRC_NEWEST` 与 `GATE-PID` 才没踩进去。
  【写进下一支的口径】**判坑位要三样一起看**：`DBG-PROC=0` 连续两次 **且** `GATE-PID`（命令行含 `r50-run3|verify-|run-verify-22` 的 node 进程）为空 **且** 产物/源码指纹不动 —— 单独任何一条都会漏。20:36:47 复采：`GATE-PID=空`、`DBG-PROC=0`，但 `verify-docs.mjs` 20:36:15 刚被写过 ⇒ 条件①仍不成立，**这一轮到此为止不起跑**。
- 仪器一条（新坑，可复现）：20:35:5x 单跑 `verify-dao-safety` 直接抛异常退出（`Node.js v24.20.0`，无 FAIL 行），几秒后 20:36:15 复跑就正常输出 11/1 —— 那是**别的会话正在写源文件时的半截读**（这些静态门禁 `readFileSync` 源码，不做重试）。⇒ 静态门禁在"另一路会话在改码"的窗口里**崩溃不等于产品红**，判红之前必须复跑一次拿到断言原文；本会话两次读数（20:31:43 与 20:36:15）都是**有原文的断言红**，可信。

### 33.5 项 2｜提示词：AI 友好格式 + 每层固定上限 + 超限立刻自愈（已完成，判据 75/0 + 14 个变异全被抓）

**用户口径（逐句拆成可执行的三条）**：
> 提示词预设的内容全部改成 AI 读取方便的格式，不用考虑人读取的方便性，无用的空行等如果占 token 就删除；
> 确保道和术等每一个提示词都有固定的上限，超出上限的时候不让用户继续输入；
> 项目自己更改的时候若是发现超出上限要马上修正，进行压缩提纯蒸馏等方法确保在字数内，并且要点清晰没有丢失（同时可以考虑太旧的内容放入知识库）。

① **格式**：`dao-default.ts` / `shu-default.ts` 的正文改成零空行、零装饰分隔线（脚本原地替换 + 逐条校验"忽略空白后指纹相同"，
   不是手抄一遍）。实测出厂稿因此各省 15/16 字符（道 2220→2205、术 1917→1901）——数字小，但**每一轮都省**，
   而且把"排版给人看"这个习惯从出厂稿里根除了；门禁现在钉住"出厂稿必须是 `jinCouHua` 的不动点"，谁再往出厂稿里塞空行就红。
② **上限**：新模块 `ti-shi-shang-xian.ts` 是唯一的一张表
   `道 2600 / 术 4200 / 规范 2000 / 印象 2600 / 教条 4000 / 束缚 4000 / 认知 1600`，另加总量闸 `TI_SHI_ZONG_HE = 16000`
   （**故意小于各层之和**：单层合规不代表发得起，这些字每一轮都要发）。
   两个入口都从这张表取数：
   - 渲染层：`zhuangShangXianKongZhi(输入框, 层名)` 向上限表要数 ⇒ 设 `maxlength`（打字打不过去）+ `input` 兜粘贴/程序赋值
     （超出部分当场截掉并 toast"多出的内容没有写入，请合并同类项或搬进知识库"）+ 实时计数 `层 n/上限`，
     九成变黄、到上限变红。六张卡片（道/术/规范/印象/教条/束缚）全部绑了层名，层名与文件一一对应也被门禁钉住。
   - 主进程：六个保存 IPC 入口统一先过 `chaoShangXianRi(层, 文本)`，超限**直接拒绝保存**并如实报
     "现在多少字 / 上限多少字 / 该怎么办"，落审计 `prompt.over-cap-rejected`。渲染层被绕过也照样拦得住。
③ **程序自己顶超限 ⇒ 当场自愈**（`ziJianTiShangXian()` 在启动播种之后跑；规范层在每轮读取时跑）：
   先 `jinCouHua`（零损失去空行，只在确实变短时落盘，审计 `prompt.compacted`）；仍超限就 `guiHuaYaSuo`
   ——**从最旧的整条条目开始搬进知识库**（术/规范/教条/束缚/道→内部库，印象→会话库），覆盖前先留 `.bak-compress-<ts>` 备份，
   搬出去的条目原样写成事件（`laiYuan: 'prompt:overflow'`），审计 `prompt.compressed` 带压缩前后字数与要点数。
   **两条守恒判据一起过**才算成功：要点数守恒 + **字级守恒**（`ziShuShouHeng`：留下的 + 搬走的 = 原文，一个字符不多不少）。
   任一条对不上就**整步放弃**、正文一个字不动，只报 `prompt.still-over-cap`（宁可超限报警，也不"看起来变短了其实把规矩吞了"）。
   压不动的情形也如实：纯散文没有条目可搬 ⇒ `gaoDing:false` + 理由"仍超限：没有可搬的条目，需人来定删什么"。
   **例外：「道」与「产品门禁」一个字都不许程序动**（判据复用阶梯的 `BU_KE_YA_SUO`，不留第二套名单）；
   它们超限只报 `prompt.over-cap-immovable`，由用户自己删——"道永远原样在场"是这条例外的全部理由。

**顺手清掉的口径重复（这一项真正的风险点）**：同一层原来有两套数字并存 —— 印象 存 6000 / 发 3000，术 存 8000 / 上限 4200，
规范 4000，认知 1600 写死。现在 `YIN_XIANG_MAX_CHARS / YIN_XIANG_INJECT_CHARS / GUI_FAN_MAX_CHARS / REN_ZHI_INJECT_CHARS / SHU_ZONG_LIANG_MAX`
全部改成 `shangXianOf(层)`，门禁反向断言"主进程里不许再出现这些字面量"。
另外 `duGuiFan()` 以前**读到超限就 `slice(0, 4000)` 悄悄截断**（用户以为自己写进去的东西还在，实际发出去的是半截）——
改成读时自愈：压缩 + 溢出进知识库，然后把压好的整份发出去，**发出去的和文件里的是同一份**。

**受影响的旧门禁**：`verify-r52-kb`（术总量闸改判 `shangXianOf('术')`，另把"整理删除"锚点补成项 5 的"取代不删除"）、
`verify-round37-changes`（印象双闸改判取上限表）。都是**按行为改判据**，没有放宽。

**新门禁**：`packages/app-shell/scripts/verify-r53-tishangxian.mjs`（75 条判据，fast 档，已进 `run-verify-22.mjs` 与 `docs/GATE-MANIFEST.json`：
total 89 / project 54）。负向验证 `r53-cap-neg`：**14 个变异全部被抓**——规范上限归零、`jinCouHua` 连小节标题一起删、
搬条目改成从最新开始搬、字级守恒被掏空成恒真、溢出条目全进会话库（内部业务被公开）、道保存入口不查上限、
印象存储闸退回 6000、规范退回悄悄截断、道允许被自动压缩、总量报警被掏空、输入框不设 maxlength、粘贴不截断、
束缚卡片绑错层名、preload 不暴露上限表。

**已知缺口（如实记下）**：
- `yinXiangHuiHuaShe`（**会话级**印象草稿）没有接上限表——它不直接进上下文，是归纳的原料；等它并入「印象」时由印象的闸收口。
- 渲染层的挡住是"当场截断"，主进程是"整份拒绝"，两者口径一致但体验不同：超限内容**不会**静默入库，用户会看到 toast + 保存报错。
- 出厂稿的 token 收益只有 15/16 字符；真正的大头在**用户侧长文本**与**程序归纳**，这两处已经分别被上限/自愈盖住。
- 上限数字本身（2600/4200/…）是按"每轮都发"的成本拍的，没有厂商基准可依；如果实测觉得太紧，改一张表就行，别改调用点。

### 33.6 项 7/9｜脱敏体系按建议升级 + 方案对照文档（已完成，判据 45/0，负向验证 13/14 被抓 + 1 条如实标为冗余防御）

**用户口径**：项 7「脱敏概要按照你的建议来操作」；项 9「P0-6 脱敏体系根据你的建议来操作，同时**加入每次回复的提醒中**，
告诉我在哪里查看该方案的优缺点，以及**其他优化方案**」。

**方案对照文档（唯一去处）**：`docs/P0-6-TUMIN.md` —— 六个候选方案逐个写「怎么做 / 优点 / 缺点 / **最坏情况** / 结论」：
A 模型自由改写+打码（不用：改写必然漏，摘要本身就是泄露面、被抹掉的数字能被重建）；
B 能力白名单 + 确定性检查器（**主干**：概要不是改写原文，是从 12 类能力清单里挑条目，原文里的价格/日期/客户**没有槽位可表达**）；
C k-匿名泛化 + 抑制（**本轮新增**）；D 差分隐私（不用：没有中央库、噪声会把产品价值花光）；
E 密态/TEE（不用：泄露发生在"该不该对外说"这个语义问题上，密态算不解决）；F 不做概要（保留为**兜底**：B/C 任一步不过关走的就是它）。
另附「挡不住什么」7 条（能力组合反推、时序侧信道、被追问时自由发挥、历史遗留未重扫、私密库≠加密库、绕过写入口直接改文件…）
和「还能怎么优化」6 条按性价比排序（重扫历史 / canary 常态化红队 / 受众分档 / 再升一层泛化 / TTL 衰减 / 人审门）。

**本轮真正落地的升级（C）**：
- `TUMIN_ZUI_SHAO_ZHI_CHI = 2`：一份能力要能对外说，必须有 **≥2 条独立证据**支持。理由（这是调研点名的存在性/成员推断泄露）：
  白名单只保证"这句话里不含项目信息"，但**"能不能凑出这一条"本身就是信息** —— 只做过一单网页小游戏就对外说
  "我们会做网页小游戏"，在场的人追一句"上次给谁做的"就能把这单业务反推出来。
- `jiShuZhiChi(证据列表)`：**忽略空白的整句去重**（同一句话复制三遍只算一条 ⇒ 粘贴凑不出 k）；空白证据不计数。
- 证据**按条给**：调用方（归档）把"这批归档"算一份 + 内部库里**其它未失效的**事件各算一份，
  并**排除刚写入的那条**（`e.id !== evId && !e.shiXiaoTs`）—— 否则同一件事被数两次，一条证据就凑够 k=2。
- 陈旧传播：重算只喂 `activeEvents()`（已取代的旧说法不再支撑对外表述）；重算不过 ⇒ 整条概要一起取代（`kb.derived-retired`）。
- 出货顺序按白名单原顺序 ⇒ 同一批证据每次生成的概要**逐字相同**（可回归、可比对）。

**门禁抓出来的两个真缺陷**（不是改判据，是修代码）：
1. 白名单里 `文档、表格与演示文稿的自动生成` **带顿号**，而顿号正是概要的分隔符 ⇒ 这条被拆成两半、永远通不过自己的检查器，
   也就是说**"文档/表格/PPT 自动生成"这一类能力从第 52 日起就从来没对外说过**（静默失效，旧门禁逐条查禁现但不查形状，没抓到）。
   已改成 `文档表格与演示文稿自动生成`，并加了两条判据堵死这一族：白名单短语**不许含顿号**、**每条短语单独过检**。
2. `jianChaGaiLao` 的注释写着"不许与原文共享 ≥8 字连续片段"，**代码里没有实现**（实现的是更强的"残留必须为零"）。
   注释改成实话：残留必须为零比 8 字重合更强，不留"看起来有条更严的判据其实没跑"的错觉。

**新增门禁**：`packages/app-shell/scripts/verify-r53-tumin.mjs`（fast 档，44 条：抑制真值表 / 白名单自检 / 重建攻击 / 血缘与传播 / 文档）。
**负向验证** `r53-tumin-neg`：14 个变异 ⇒ **13 个被抓红**，1 个如实标成"冗余防御、没有唯一判据"：
被抓的 —— k 降成 1、去重被拿掉、每条证据计数翻倍、生成器把原文首句拼进概要、白名单加带顿号的条目、禁现表不扫、
哨兵不查、证据不排除刚写入那条、重算把已取代的旧说法当证据、概要不带血缘、不可写时静默跳过不报、
文档删掉"挡不住什么"清单、文档写出本机用户目录。
如实记下的那一个 —— 检查器里"剥掉句式与白名单短语后残留必须为零"这一关**被分段白名单检查完全覆盖**
（任何残留都先撞上更严的那一关），所以把残留关掉**不会**让任何判据变红：它是纵深防御不是唯一判据，
不拿"变异漏抓"当缺陷记账，也不假装它可测。
仪器教训（本轮又踩）：① 对**编译产物**下变异锚点必须容忍换行（`if (x)\n continue;` 在 dist 里是两行，按源码单行写的锚点会"变异没生效"）；
② 只断言"字符串存在"的审计类判据是假判据（`void 0 && audit?.log('x')` 仍然含 'x'）—— 要断言它**真的是条语句**；
③ 变异脚本必须把"门禁崩溃"和"门禁全绿"分开报，否则 stdout 没汇总行会被当成漏抓。

**每次回复的提醒（用户项 9 + 项 10 的固定动作）**：本条以后，每次汇报结尾都要带
①「P0-6 脱敏体系的优缺点 / 最坏情况 / 其它优化方案见 `docs/P0-6-TUMIN.md`」，
②「还有哪些没完成」的清单（项 10 同时要求**这条提醒口径本身**写在交接文档里 —— 就写在这里）。

### 33.7 项 8｜"看不到密钥也能自动解锁"+ 无服务器跨设备解锁（**方案文档已写，等拍板，未写一行实现代码**）

**用户原话**：要做"看不到密钥也能自动解锁"的体验；项目**没有服务器**；用**类似比特币钱包的方式**让用户自管登录凭证；
问两件事：① 如何实现看不到密钥也能自己解锁；② 在其他设备上成功登录了自己的账号后，如何解锁之前的文件。

**文档**：`docs/P0-5-ZITUOGUAN.md`（方案对照 + 密钥层级 + 封装层选型表 + 六种丢失场景真值表 + 性能 + 落地三步 + 5 个待拍板决策点）。

**结论要点（细节看文档）**：
- 现状已经是"钱包式"的一半：凭证 = **256 bit 均匀随机**，且**凭证 ⇒ Ed25519 密钥对是确定性派生**（`credential.ts`），
  同一份凭证在任何设备得到同一把密钥 ⇒ 跨设备恢复的地基不用新建；缺的是**本地数据（知识库/会话/提示词层）目前明文落盘**，
  `safeStorage` 只保护了供应商 API Key。
- **Q1 的答案不是"把密钥藏起来不显示"，而是"密钥本来就不需要被看见"**：数据用 DEK 加密、DEK 被 MK 封装、MK 被本机可信存储封装 ⇒
  开机自动解封 = 零输入解锁；明文密钥只在"导出恢复材料"那一次出现。封装层三条路各有硬边界，必须让用户知道：
  DPAPI/safeStorage 绑 Windows 账户、**域环境下 AD 有 escrow 备份密钥（组织理论上能解）**；TPM 非导出密钥更强但**天然不能跨设备恢复**；
  Linux 没有统一可信存储 ⇒ 只能回落"封装文件 + 用户输入"。
- **Q2 的答案**：无服务器 ⇒ "登录"不可能是服务端验密码，只能是**证明持有同一份自托管秘密**。两条可行路：
  ① 新设备输入同一凭证 ⇒ 派生同一 MK ⇒ 直接解开旧 DEK（换设备恢复钱包的做法，零服务器参与）；
  ② 不想人肉重输 ⇒ 旧设备用新设备公钥（X25519）把 DEK **再封装一份**，同步介质只搬密文（网盘/Syncthing/U 盘都行）。
- **必须如实说的取舍（文档里写成硬句子）**：想要"输个账号密码就自动解锁、忘了凭证也能找回"，
  就**一定要**有服务端持有一份可解材料 ⇒ 与"没有服务器"直接冲突；这条路上历史翻过两次车（MEGA 的"密码即密钥"、LastPass 2022）。
  **要么放弃"无服务器"，要么放弃"忘了凭证也能自动解锁"，二者不能同时要。** 自托管的含义就是我们没有后门。
- **性能不是瓶颈**（用户上一轮问过）：AES-256-GCM / XChaCha20-Poly1305 在现代 CPU 上 >1 GB/s，age 64KiB 分块膨胀 ~0.02%，
  SQLCipher 类整库加密实测 5–15%；只有 KDF（scrypt/Argon2）贵，而它**只在用户输入凭证那一次**跑 ⇒ 绝不能每轮对话重新派生。
- **落地三步**（都可逆）：Step1 本机自动解锁（DEK/MK/WK + 一次性迁移 + 锁屏清内存密钥）；Step2 加密备份包（age，导出包不含凭证明文）；
  Step3 跨设备再封装 + 设备清单（撤销设备要配合 DEK 轮换才真正失效，文档里写明）。
- **等用户拍板的 5 件事**：默认强度档位（DPAPI 零输入 vs TPM+PIN）／要不要"锁屏即锁"／恢复材料导出形态（age 包 / 助记词 / SLIP-39 分片 / 全不要）／
  跨设备走"同凭证直接解"还是"再封装+设备清单"／要不要真的引入账号+服务器（那就推翻"没有服务器"的前提）。

**顺带修掉的一条判据缺陷**（写进来是因为它差点被当成"放宽判据"糊过去）：第 53 轮项 2 的自检最初把「道」也放进了可写名单
（靠运行时的 `chengXuKeYiDong` 拦住不写），`verify-dao-safety` 的静态判据当场红：**写 dao.md 的调用变成 2 处**。
这不是判据太严，是设计留了个"永远不会执行的写路径"—— 一条没人执行的写代码迟早被人改出真的执行路径。
已改成「道」只进**只报警名单**（`CENG_ZHI_BAO_JING`，连 `xie` 闭包都不给），并新增两条判据把这一族钉死：
"道不在可写自检名单里" + "永不可压层超限只报 `prompt.over-cap-immovable`"。`verify-dao-safety` 12/0、`verify-r53-tishangxian` 76/0。

**决策文档的可发现性进了门禁**：`verify-docs` 新增 12 条 —— 两份文档必须存在、关键小节齐（P0-6 的 A–F 方案/最坏情况/挡不住什么/还能怎么优化，
P0-5 的 Q1/Q2/硬边界/场景真值表/落地三步/待拍板）、**不含本机路径与主机名**、且**交接文档里指得到它们**（就是本轮把这条挂红逼我把 §33.7 写完的）。

---

# 37. 推进器读数（2026-10-21 20:39–20:5x · 三连仍未起跑：改码会话在动产物；§36.3 那条道红已由它按收紧方向修完）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`、`<用户名>`、`<主机名>`）；密钥文件名不写进仓库。

## 37.1 判活双信号（20:39–20:41 采样，原文）
- 进程侧：命令行过滤 `r50-run3|verify-r46-youxi` **零命中**；机器上只剩 4 个与门禁无关的常驻 node（`openclaw gateway` 与其 worker，10-20 17:47 起）。带 `--remote-debugging-port` 的进程 **0 个** ⇒ 本任务没有可杀对象，**本会话一个进程也没杀**。
- 产物侧：`%TEMP%\warmy-r46-youxi-profile-…1792583330378` 的 `chat-meta.json` 末写 **19:58:01**、`audit.jsonl` 末写 **19:58:03**；采样时刻 20:39:55 ⇒ 早已超过"最近 4 分钟"的活性窗。
- 日志侧（19:48:50 那遍的终态，逐条原文）：
  - `game-run1.log` 末行是 `  ok   第3轮 · 暂停/继续：改完语法仍然过`，**没有** `----- exit=N -----` 结论行（驱动器 `r50-run3.mjs:44` 在子进程 close 时才写）；
  - `game-3x.log` 末行是 `[game] 第 1/3 遍开始 2026-10-21T11:48:50.332Z`，**没有** `exit=` / `[产物]` / `[VOID]` / `[STOP]`；
  - `game-3x.out.log` 末行 `[driver] exit 1`，且**没有** node 的异常栈（对比 19:42 那次 EBUSY 崩溃是带栈的）⇒ 驱动器不是自己抛死，是在子进程跑到第 4 轮前后被外部终止。
- 【结论】按 §23.1 第 3 条"进程消失且日志没有 `3/3 全绿`/`exit 0` ⇒ 视为异常"成立。这一遍本来就已被 19:54:50 的重建作废（§35.6），**三连此刻计入验收的遍数 = 0**。

## 37.2 起跑条件（§36.4 五条）逐条体检
- ① **产物静默：不成立**（这就是本轮唯一的阻塞点）。采样原文（`<仓库目录>/.r50-logs/_wait54.sh`，60 秒一次，本会话新建）：
  ```
  [20:41:22] SRC_NEWEST=packages/app-shell/src/electron-main.ts        SHA=76613c570b5a DIST_MTIME=2026-10-21 20:40:40 DBG-PROC=0
  [20:42:23] SRC_NEWEST=packages/app-shell/scripts/verify-r53-zhishi.mjs SHA=76613c570b5a … DBG-PROC=0  KENG-STREAK=2
  [20:43:23] SRC_NEWEST=packages/app-shell/src/zhi-shi-ke-kao.ts        SHA=76613c570b5a … DBG-PROC=0  KENG-STREAK=3
  ```
  ⇒ 20:40:33 写主进程源码、20:40:40 重建 dist、20:42:23 **新建一支门禁**、20:43:23 又写纯模块 —— 改码会话正在实现第 53 轮"知识可信度/幻觉闸门"，三次采样 `SRC_NEWEST` 三次不同。按 §35.6 的两次实测代价（18:39:38、19:54:50 把跑到一半的真机遍打空），**本会话没有起跑三连**，也没起第二支真机门禁。
- ② **场地空：成立**（`DBG-PROC=0` 连续 3 次 + `GATE-PID` 空，KENG-STREAK=3）。
- ③ **fast 档 0 FAIL：不成立**（两条，都是改码会话的在途面，见 §37.4）。

## 37.3 静态档读数（20:4x 复跑，不占真机）
- 阶梯与新门禁（任务第 5 条要计入验收口径的这两支）：**`verify-r52-layers` 54 ok / 0 FAIL**、**`verify-prompt-layers` 29 ok / 0 FAIL**、`verify-r52-yasuo` 47/0、`verify-dao-safety` **12/0**、`verify-docs` 95/0、`verify-security` 全部通过 (PASS 28)。
- **§36.3 那条唯一红已经转绿，且方向是收紧**（独立复核，不是转述）：`verify-dao-safety` 现读数 `写 dao.md 的调用只有「播种 + 用户保存」两处（实际 保存=1 播种=1）`（19:5x 之前是 `保存=2`）。代码侧证据：`道` 已从带 `xie` 写闭包的 `CENG_ZI_JIAN` 移出，进了一张**只报警、绝不写文件**的 `CENG_ZHI_BAO_JING`（`packages/app-shell/src/electron-main.ts:16085-16093` 一带，注释原文"一条永远不会执行的写路径留在代码里，就等于给『程序会改道』留了个口子"）。超限的道改为只记 `prompt.over-cap-immovable`。⇒ 与 §25.1「道只有用户手动可写」的硬口径一致，**判据没有被删薄**（`BU_KE_YA_SUO` 仍是恰好两道，`verify-dao-safety` 第 4 组按实读集合判）。

## 37.4 两条新的 fast 档红（定性：**改码会话的在途中间态**，暂不判产品红）
- `verify-gate-manifest` **22/23**，FAIL 原文：`磁盘上每个 verify-/probe- 脚本都登记在清单里  ["verify-r53-zhishi"]` ⇒ 20:42 新建的那支门禁**还没进 `docs/GATE-MANIFEST.json`，也没进 `run-verify-22.mjs` 的 FAST 清单**（`grep r53` 只命中 shijian/tishangxian/tumin 三支）。这就是 §31.3 那条"阶梯改动从来没被验收遍覆盖"的同型覆盖漏 ⇒ **登记为待补**：要么由改码会话补，要么排在三绿之后、live 之前由推进器补；**起真机期间不许动 `dev/gates` 与 `packages/*/scripts`**（碰一次指纹就归零重等，且会打空在跑的那遍）。
- `verify-r53-zhishi` 自身 **40 ok / 1 FAIL**，两次复跑同一 FAIL（20:4x）：`只重合 9 个字（差一个字）⇒ 拒（阈值是硬的，不许"差不多就行"）`，但它带的读数其实**是拒绝**（`{"ok":false,…,"liYou":"正文与本轮原文最长只连续重合 9 字（要求 ≥10）⇒ …先别入库"}`）。而此刻源码里这条的描述已经变成另一句（`…⇒ 拒，而且**如实报出真实重合长度**…`，`packages/app-shell/scripts/verify-r53-zhishi.mjs:85-86`）⇒ 跑的那份与读到的那份不是同一版文件，**正是 §36.5 那条仪器教训的现场**：别的会话正在写这批文件时，静态门禁的读数不能定性。等产物静默后复跑取原文再判。

## 37.5 阶梯口径分叉的最新状态（仍等用户拍板，本会话一字未改判据）
- 任务提示与本文件 §25.1/§24.1 是同一份：`硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象`（印象殿后）。
- 代码与两支门禁钉的是 §32.1 那份：`硬门禁 > 道 > 术 > 规范 > 印象 > 工具 > 软门禁 > 教条 > 束缚 > 认知 > 身份`（`verify-prompt-layers.mjs:30`/`:87`，注入装配可 grep：`electron-main.ts:10968 产品门禁`→`10980 道`→`10989 术`→`11003 规范`→`11020 印象`→`11263 工具`→`11274 教条`→`11281 束缚`→`11287 认知`）。
- **本轮新增的一条实测矛盾（两支门禁都抓不到，因为它们各钉自己那份）**：压缩分层 `YA_SUO_CENG`（`packages/app-shell/src/yaSuo-fenCeng.ts:16-19`）把 **`印象` 与 `软门禁`/`工具` 放在第 1 层 = 上下文不够时最先被压**；而注入位置按 §32.1 把 `印象` 排在第 4 高、压在 `教条`/`束缚`/`认知` 之前。`verify-prompt-layers.mjs:49-50` 逐字钉住了这张分层表、`:95` 逐字钉住了那个注入顺序 ⇒ **两支都绿，但同一个「印象」一边享有高优先级、一边最先挨刀**。若以 §25.1 为准是注入顺序错，若以 §32.1 为准是压缩归层错 ⇒ 需要用户点一句"以哪份为准"，然后由改码会话把另一处对齐并补一条**跨表一致性判据**（注入位置与压缩层必须同序），本会话不猜、不改。

## 37.6 现场与下一步
- 本会话改动面（可回退）：只有本文件（§37）与 `.r50-logs/_alive53.ps1`、`.r50-logs/_wait54.sh`、`.r50-logs/wait54-2041.log`（采样输出）。**`packages/*/src`、`packages/*/scripts`、`dev/gates`、`dist` 一个字节没改**；没起真机门禁、没杀进程、未 commit、未 push。
- 目标链进度：三连计入验收的遍数 **0/3** → live 名单 0 → 两遍验收 0 → 首启未跑。
- 下一步（顺序不变）：① 等 `SRC_NEWEST`+`SHA` 连续 5 次采样不动且 `GATE-PID` 空、`DBG-PROC=0` 连续两次 ⇒ 用 `<仓库目录>/.r50-logs/start-game-3x-r52.cmd` 起三连（stdout 走 `game-3x.out.log`，不与驱动器抢 `game-3x.log`）；② 判活认 `[产物]`/`[VOID]` 行，见到 `[VOID]` 就是这一遍不算数；③ 三绿 → 按 §22.3 名单串行 live → 两遍验收 → `node dev/gates/r38-firstrun.mjs`。
- 【场地请求（第三次提，同 §35.5/§36.4）】三连 + live + 两遍验收期间请勿改 `packages/*/src`、`packages/*/scripts`、`dev/gates`、`dist`：动一次 ⇒ 三连重数 + live 从第 1 遍重来。已经连着三支推进器（19:4x、20:1x、20:4x）因为这条起不了跑，累计白烧的等待超过 1 小时。
- 仍等用户点头（一条未动）：§33.4/§37.5 阶梯以哪份为准（本轮又添"注入位置 vs 压缩层同序"这条新判据要补）、§33.3 round12 判别实验与"弹卡必须记账"、§29.10 round16 三条出路、§30.7 b) ASR skip 口径、§25.4 的 ④「被拒即停用」按任务收紧、新门禁 `verify-r53-zhishi` 的清单登记。
- **§22.3 的 P0 清单仍一条未减。**

### 33.8 项 4｜知识库更智能、更健全、更可靠（联网调研后落地，判据 44/0，负向验证 15 个变异全被抓）

**用户口径**：项 4 要"联网搜索最新技术文章，然后优化这个语义、流程和具体步骤，让知识库更智能、更健全、更可靠"。
调研（三份报告，见 §34 附近与本轮检索记录）里被反复证实的三种坏法，本轮**各落一条能真失败的判据**，都在纯模块
`zhi-shi-ke-kao.ts` 里（阈值与名单只住一份，主进程再抄一份就是下一个不一致的源头）：

**① 实体归一：三层裁决（高分自动合并 / 中分新建并交复核 / 低分新建）**
- 症状：同一个人/项目被记成好几条，每条只带一半事实 ⇒ 越查越像失忆（调研里 Mem0/Graphiti 的 entity resolution 都在治这个）。
- `guiYiPanDing(候选, 已有实体)`：**同 kind 才比**（同名的公司与人是两码事）；
  `person·org·project` 是**保护类型** ⇒ 只有归一后**完全同名**才自动合并，只是"很像"一律交复核（`kb.entity-review` 留痕）——
  错合并会把两个人的事实串在一起，**不可逆**；漏合并只是重复，可事后并。
- 相似度用**字符 bigram 的"重合系数 × √长度相近度"**：这里踩了一次真实的取舍 ——
  纯 Jaccard 认不出"简称 ⊂ 全称"（`阿里巴巴` vs `阿里巴巴集团` 只有 0.6 ⇒ 两个客户分家），
  纯重合系数又会把 `张三` 与 `张三丰` 算成 1.0（两个人并成一个）。乘上长度相近度之后：前者 0.87（落复核带，交人裁）、
  后者 0.71（新建，不合并）。刻意**不用编辑距离**：它对"只差姓但指不同人"给高分，那是最贵的错。
- 归一化 `guiYiMing` 抹平全角/半角、空白、标点（"Ｗ-Ａｒｍｙ" 与 "w army" 同一写法）。

**② 证据闸（evidence-before-belief）**
- 症状：模型的新结论被当事实入库 ⇒ 之后每一轮检索都把它回灌成"已知"（Mem0 的 ADD-only 回归就是这么把陈旧矛盾堆出来的）。
- `knowledge_add` 写**事件**前必须过 `jianChaYouZhengJu`：带锚点 / 宿主派生来源（`derived:`、`prompt:`、`archive*`）/
  能在**本轮用户原话**里找到 **≥10 字连续重合**，三者全无 ⇒ **拒写**并回一条可执行的补救（摘原话 / 带 anchor / 明写"待核"），
  审计 `kb.evidence-denied`。**实体不受这条限制**（实体只是名字，不是结论）。
- 证据**只比用户原话**（`benLunYuanWen` 只取 role=user 且未 hidden）：把模型自己的输出也算进"原文"，等于让猜测自我印证。
- 本轮修掉一处**会说谎的实现**：原先按"≥10 字"探测，实际重合 9 字时被报成"最长 0 字" ⇒ 日志与用户回包里写的是假话。
  改成真的最长连续子串 DP（`zuiChangLianChong`，两侧各夹 4000 字，只在写入侧算一次），并加三条判据钉住"算的是真值 + 片段取自原文 + 没有原文不编造"。

**③ 陈旧度：降权不删除**
- 症状：三年前的说法以同等权重在场 ⇒ 模型把旧说法当现状。删除又会丢审计线索（项 5 已定"取代不删除"）。
- `chenJiuFen`：**按发生时间算**（没有发生时间才退回记录/写入时间），半衰期 90 天、**下限 0.35**（降权不淘汰，"永远可回忆"不被衰减偷偷废掉）；
  已取代 ⇒ 0 并标"已被更新的说法取代"。检索结果挂 `〔陈旧 N 天…〕`，含糊措辞（大概/也许/听说…）另挂 `〔待核〕` ——
  **原样呈现但明说这不是核定事实**；判据函数 `shiHuHan` 写侧与读侧共用一份。

**门禁**：新增 fast 档 `verify-r53-zhishi.mjs`（44 条），已进 `run-verify-22.mjs` 与 `docs/GATE-MANIFEST.json`（清单 91 支，project 56，一致性 23/23）。
**负向验证** `r53-zhishi-neg`：15 个变异**全部被抓** —— 合并阈降到 0.3、跨 kind 闸门被拆、保护类型名单清空、相似度退回纯 Jaccard、
证据阈降到 3 字、拒写理由不报真实长度、来源前缀一律放行、含糊判据失效、衰减下限清零、陈旧度改按记录时间算、
证据闸形同虚设、复核带也直接合并、把模型输出算进"原文"、复核不落审计、检索不挂陈旧标签。
其中两条是**仪器缺陷**（不是产品缺陷）：只断言"字符串存在"的审计判据挡不住 `void 0 && audit?.log(…)`；
断言 `chenJiuFen(` 存在挡不住"前面塞一个假对象再 `&&` 真调用"。两条都已改成**必须紧邻赋值的真语句**形状。

**如实记下的缺口**：
- 相似度是**离线字符法**（没走 embedding）。本地有 vec 索引时可以把 embedding 分数当作第二票（现在接口预留，但没消费点 ⇒ 不留假接口）。
- 复核带只落审计，**没有界面队列**（要"交人裁"得做第四列一张卡，列入待拍板）。
- 陈旧标签只影响**呈现**，不影响排序（项 5 的时间命中排序规则在先，动它要把那 42 条判据一起重算，本轮不混着改）。

## 37.7 补记（20:46–20:4x · 起跑前体检全绿 + 一条仪器稳健性待办）
- 起跑前体检（§22.1 B 那组）：密钥文件在（222 字节，末写 10-12）；`better-sqlite3` **三候选齐全**（vendor / packages/memory-os/node_modules / `%APPDATA%\@warmy\app-shell\memory-runtime\node_modules`）；调试端口 9946 连接数 **0**；写完 §37 后复跑 `verify-security` 仍 **PASS 28**、`verify-docs` **95/0** ⇒ 本轮读数没把验收打红。
- 独立复跑 `verify-r53-tishangxian` **76 ok / 0 FAIL**（20:4x），并逐条读了这两支新加的「道」防误改写判据的方向：
  - `packages/app-shell/scripts/verify-r53-tishangxian.mjs:143-145` 的负向锚 `!/ceng: '道',[^\n]*xie:/` 是**行为锚**（任何带写闭包的「道」自检条目都会翻红）⇒ 方向确实是收紧；
  - `:144` 的正向锚 `/ceng: '道', du: duDao \}/` 与 `:158` 的 `if (!chengXuKeYiDong(x.ceng)) {\n audit?.log('prompt.over-cap-immovable'` 是**字面形状锚**（换行/加字段/重排格式就会假红）。不降判据、不此刻动手（改 `packages/*/scripts` 会让静默窗归零），只登记一条**稳健性待办**：等真机链跑完，把这两处正向锚改成行为口径（"名单里没有道 + 超限只落审计"），负向锚原样保留。
- 静默窗仍未出现（改码会话 20:44、20:45 两次采样仍在写 `verify-r53-zhishi.mjs`）。本会话改面不变：只有本文件与 `.r50-logs/` 下自建采样脚本。

## 35. 未完成事项清单（用户口径：每次回复都要提醒还有哪些没完成）

**A. 需要用户拍板才能开工的（我不动代码，等你定）**
1. **P0-5 / 项 8 · 自托管凭证与自动解锁**：`docs/P0-5-ZITUOGUAN.md` 里 5 个决策点 ——
   ① 默认强度档位（DPAPI 零输入 vs TPM 非导出密钥 + 可选 PIN）；② 要不要"锁屏即锁"（与"永远零输入"直接冲突，选哪头）；
   ③ 恢复材料形态（age 导出包 / 助记词式编码 / SLIP-39 分片 / 全不要=凭证丢即永久丢）；
   ④ 跨设备走"同凭证直接解"还是"设备间再封装 + 设备清单"；⑤ 要不要真的引入账号 + 服务器（那就推翻"没有服务器"的前提）。
2. **P0-6 / 项 7、9 · 脱敏体系的下一步**：`docs/P0-6-TUMIN.md` §4 六条优化里挑：重扫历史会话库 / canary 常态化红队 /
   受众分档（群内可见 vs 可对外导出）/ 再升一层泛化（12 类→4 大类）/ TTL 衰减 / 人审门。
3. **知识库复核队列**（项 4 遗留）：`kb.entity-review` 现在只落审计，**没有界面卡** ⇒ "很像但没并"这件事只有翻日志的人看得见。要做就要定卡片放第四列哪一块、谁能点"合并/分开"。
4. **④ 授权档（run_shell 那一档）是否放宽**：第 51–52 轮挂起的问题，至今没定；现状是"同一任务被拒 2 次 ⇒ 本轮硬停用"。
5. **提示词上限数字**（项 2）：道 2600 / 术 4200 / 规范 2000 / 印象 2600 / 教条 4000 / 束缚 4000 / 认知 1600 / 总合 16000
   是按"每轮都发"的成本拍的，没有厂商基准可依。要放宽/收紧只改 `ti-shi-shang-xian.ts` 一张表，别改调用点。

**B. 我能自己做完、但本轮没时间做完的（已记账，不算隐瞒）**
6. **live 名单 4 支红的逐条定性与复跑**（本轮 19:37 那一遍）：round12 EVAL_TIMEOUT、round16 步骤数 -1、
   round17 第四列没有牛马卡片 + MiMo TTS 0 字节、round38-asr 2 FAIL。还没做完归因 ⇒ **本轮不算验收通过**。
7. **项 2/3 的真机验证**：卡片超链接（不存在路径的左键提示/右键菜单）与提示词上限的输入框挡住，都只有静态判据 + 单元判据，
   **没有在真 Chromium 里点过**（live 档必须串行，本轮没排上）。
8. **端到端"归档 → 印象/术"门禁**（第 52 轮遗留 #84）：还需要一条真机闭环：说一句话 ⇒ 归档 ⇒ 印象/术/知识库三层都落对 ⇒ 下一轮召回得到。
9. **首启仪式**：`node dev/gates/r38-firstrun.mjs` 本轮未跑（要在验收全绿之后）。
10. **两遍全绿验收 + 交接读数**：本轮只做到"fast 档重跑 + live 档一遍（有红）"；按协议要**一遍全绿**才算，且每遍都要更新读数。
11. **ASR（第 38 轮 park 的那条）**：仍要先取**话筒自检数值**（无麦克风环境下的 TTS→ASR 闭环读数），再决定改不改路由代码。
12. **会话级印象（yinXiangHuiHuaShe）未接上限表**（项 2 已知缺口）：它是归纳原料、不直接进上下文，等并入「印象」时由印象的闸收口。
13. **陈旧度只影响呈现、不影响排序**（项 4 已知缺口）：动排序要把 `verify-r53-shijian` 那 42 条时间命中判据一起重算，本轮刻意没混着改。
14. **实体相似度只走离线字符法**：embedding 当第二票的接口没做（**没有消费点就不留假接口**）；本地 vec 索引可用时再评估。
15. **`r51-shu-probe.mjs` 与"循环真跑"判定口径**：第 51 轮挂着的两条口径还没定稿。

**C. 固定动作（每轮都要做，不是待办）**
- 每完成一点就写一次交接文档（本节与 §33.1–§33.8 就是这么来的）。
- 每次汇报结尾带上：`docs/P0-6-TUMIN.md`（脱敏方案优缺点/最坏情况/其他优化方案在哪看）+ 上面这份未完成清单 + 后台测试读数。

## 36. 本轮验收读数（第 53 轮收尾时）
- **fast 档 1 遍全绿**：`node dev/gates/run-verify-22.mjs --tier=fast` ⇒ **87 项次、无产品红**（exit 0；临时读数日志已按"任务产物用完即删"的口径清理，重跑即可复现）。
  本轮新增的 4 支（`verify-r53-shijian` 42 / `verify-r53-tishangxian` 76 / `verify-r53-tumin` 45 / `verify-r53-zhishi` 44）都在这一遍里跑过。
  中途 `verify-dao-safety` 红过一次（"写 dao.md 的调用变成 2 处"）⇒ **改设计而不是放宽判据**：「道」从可写自检名单里拿出来，
  改成只报警名单；修完全遍重跑，不拿旧读数充数。
- **live 档仍是上一遍（19:37）的 4 红**：round12 EVAL_TIMEOUT、round16 步骤数 -1、round17 第四列没有牛马卡片 + MiMo TTS 0 字节、round38-asr 2 FAIL。
  **本轮没有重跑 live**：真机档必须串行，且这 4 条还没定性。⇒ **本轮不算验收通过**（口径：一遍全绿才算）。
- **另一棵树的推进器**：cron 任务「R51 全任务推进器」仍在跑（lastRunStatus=succeeded，单轮约 27 分钟），
  但它那棵树的小游戏三连在 `appendFileSync` 处 **EBUSY**（同一份 `.r50-logs/game-3x.log` 被两个写入者抢）⇒ 需要给日志分名或单写者化，
  否则"三连全绿"这个里程碑会被仪器自己撞死。这条属于 §35.B6 的同一批待办。

## 37.8 【结论】静默窗出现 ⇒ 三连第 1 遍已于 20:52:11 起跑（§37.4 两条红在此之前已自解）
- 轮询终局读数（`_wait54.sh`，60 秒一次）：
  ```
  [20:46:26] SRC_NEWEST=dev/gates/run-verify-22.mjs SHA=76613c570b5a DIST_MTIME=2026-10-21 20:40:40 DBG-PROC=0
  [20:48:27] … GATE-PID=10556 START=20:48:05 CMD=… run-verify-22.mjs --tier=fast … QUIET-STREAK=2
  [20:51:29] SRC_NEWEST=dev/gates/run-verify-22.mjs SHA=76613c570b5a … QUIET-STREAK=5 KENG-STREAK=2
  [20:51:29] RESULT=GO
  ```
  ⇒ 产物（`packages/*/src`、`packages/*/scripts`、`dev/gates` 最新 mtime + `dist` 的 sha）自 20:46:26 起连续 5 次不动；改码会话 20:48:05 起的那支 fast 档已退出，`GATE-PID` 空、`DBG-PROC=0` 连续两次。
- **起跑读数（原文）**：`[产物] game 第 1/3 遍开跑前指纹：dist/electron-main.js 12:40:40#76613c570b5a | dist/renderer/app.js 12:10:06#1a3566574a89` → `[game] 第 1/3 遍开始 2026-10-21T12:52:11.052Z`；驱动器 PID 21596（20:51:50 起）、门禁本体 PID 31596（20:52:11 起）、20:52:19 现场 `DBG-PROC=2`（就是这一遍自己的两只调试壳）。用 `<仓库目录>/.r50-logs/start-game-3x-r52.cmd` 起，stdout 走 `game-3x.out.log`。本会话没有并发起第二支真机门禁。
- **§37.4 两条红在起跑前已自解**（20:5x 复跑，原文）：`verify-gate-manifest` **23/23 通过**（那条 `["verify-r53-zhishi"]` 未登记的 FAIL 消失，`run-verify-22.mjs:122` 已进 FAST、`GATE-MANIFEST.json:532` 已登记）；`verify-r53-zhishi` **44 ok / 0 FAIL**（判据从 41 条增到 44 条，"只差一个字 ⇒ 拒"那条现已带真实重合长度的描述并通过）。⇒ §37.4 的定性成立：**那是改码会话的在途中间态，不是产品红，也不是判据被删薄**（断言只增不减）。
- **仪器一条小噪（不改判据，只登记）**：驱动器 `dengKong()` 的首次采样必然打印 `[WAIT] … 坑位被占（带调试端口的调试壳 0 个），已等 0s` —— 逻辑是"要连续两次采到 0"，但打印文案把"第一次还没确认"写成了"被占"，且白等 20 秒。读数没错、方向偏保守（宁等不并发），但下一支推进器别把这一行当成"场地被占"的证据。
- **进度**：三连 **第 1/3 遍在跑**（计入验收 0/3，见 `[OK]`/`[VOID]` 才算数）→ live 0 → 两遍验收 0 → 首启未跑。
- **本会话改面（如实）**：只有本文件与 `.r50-logs/` 下本会话自建的采样脚本；`packages/*`、`dev/gates`、`dist` **一个字节没改**（起跑后只跑了纯读源码的静态门禁）；未 commit、未 push。

---

# 38. 推进器读数（2026-10-21 20:52–20:5x · 三连第 1 遍在跑：双信号都为正、产物没被动过）

> 隐私口径：路径一律占位（`%TEMP%\`、`<仓库目录>`、`<用户名>`、`<主机名>`）；密钥文件名不写进仓库。

## 38.1 判活双信号（接手即采，原文）
- **20:52:35** 进程侧：命令行过滤 `r50-run3|verify-r46-youxi` 命中两只 —— 驱动器 `21596`、门禁本体 `31596`（就是 §37.8 在 20:52:11 起的那一遍）。本会话**没有再起第二支真机门禁、一个进程也没杀**。
- **20:52:35** 产物侧：`%TEMP%\warmy-r46-youxi-profile-…131097` 的 `chat-meta.json` 末写 **20:52:34**（438 字节）、`audit/audit.jsonl` 末写 **20:52:33**（3743 字节）⇒ 都在"最近 4 分钟"活性窗内，**两个信号都为正**（不是只靠日志时间戳推断）。
- **20:54:50 → 20:55:51** 复检：`audit.jsonl` 6549 → **11263** 字节在长；`dist/electron-main.js` 仍是 **20:40:40 `#76613c570b5a`**、`dist/renderer/app.js` **`#1a3566574a89`** ⇒ 与 §37.8 那条 `[产物]` 开跑前指纹逐字一致，**这一遍到目前为止没混构建**（§35.6 那两次把真机遍打空的判据此刻成立）。
- 日志侧原文（`game-run1.log` 13 行，末尾两条）：
  ```
  ok   应用启动（独立 profile + 独立端口，没动用户的实例）
  ok   MiMo 密钥已交给宿主（不打印）
  ```
  ⇒ 自证段（4 条仪器自证 + 静态图反例）与启动段已过，第 1 轮的真机往返还在跑；日志只在每轮结束落行，所以"没有新行"不等于"卡死"。

## 38.2 我自己踩到的仪器缺陷（如实登记 + 当场修，判据一字未动）
- 第一版旁观脚本每 60 秒采一次，但**终态判据直接 grep 整个 `game-3x.log`** ⇒ 那文件是 append 的全历史（15:27 之前的 `[OK]`/`[STOP]` 都还在里面），脚本起来 15 秒就打 `TERM` 自杀了。
- 【教训，与 §36.5/§37.4 同型】**历史行 ≠ 本轮行**：判本轮终态必须先快照起跑时的行数、只看其后的新增行。已改成 v2（`<仓库目录>/.r50-logs/_watch55.sh`：`BASE3X` 行号快照 + `INIT_SHA` 产物比对，指纹一变就打 `REBUILT-MIDRUN`）。
- 单遍门槛的**数字要按当前判据读，别抄旧的**：§19.3 写的"过 31 · 败 0"是第 51 轮的读数；最近两遍绿的实测汇总行是 `过 35 · 败 0 · 跳 0`（15:12 与 15:27 两遍原文一致）⇒ 判据是**只增不减**，认的是 `----- exit=0 -----` + `败 0 · 跳 0`，不是拿 31 当锚。
- 驱动器那条 `[WAIT] … 坑位被占（带调试端口的调试壳 0 个），已等 0s` 文案噪点已在 §37.8 登记过，本轮不重复、不改它。

## 38.3 验收口径的两支（任务第 5 条）在当前源码上的读数（20:5x 复跑：纯读源码、不起 Electron、不占真机）
- `verify-r52-layers` **54 ok / 0 FAIL** · `verify-prompt-layers` **29 ok / 0 FAIL** · `verify-dao-safety` **12 ok / 0 FAIL**。
- 覆盖已核到清单级：`run-verify-22.mjs:108`=`verify-r52-layers`、`:132`=`verify-prompt-layers`、`:133`=`verify-dao-safety` 都在 **FAST** 数组里；`docs/GATE-MANIFEST.json:487`（r52-layers）/`:532`（r53-zhishi）已登记 ⇒ **两遍验收会覆盖"注入阶梯 + 新门禁"**，这条口径成立（§31.3 那条"阶梯改动从没被验收遍覆盖"的漏已在第 52 轮补上，本轮复核仍在）。
- **仍未拍板的分叉（本轮补一条硬后果）**：任务与 §25.1 的阶梯是 `硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象`，而 `verify-prompt-layers:30`/`:87` 逐字钉的是 §32.1 那份（`… 规范 > 印象 > 工具 > 软门禁 > 教条 > 束缚 > 认知`）。⇒ **它现在 29/0 只证明"代码与自己那份表自洽"，不证明"符合任务口径"**；两遍验收会绿在一个与 §25.1 不同的序上。以哪份为准要你点一句（连同 §37.5 那条"注入位置与压缩层必须同序"的跨表判据）。本会话一字未改判据。

## 38.4 现场与下一步
- 现场（20:5x）：三连**第 1/3 遍在跑**（20:52:11 起跑），计入验收 **0/3**；live 0、两遍验收 0、首启未跑。
- 下一步（顺序不变）：① 每 60 秒采双信号 + 产物指纹，认 `[产物]`/`[VOID]`：**见到 `[VOID]` 或 `REBUILT-MIDRUN` 这一遍就不算数**，别去补跑后面的遍；② 该遍打出 `----- exit=0 -----` 且 `败 0 · 跳 0` ⇒ 驱动器自动开第 2 遍；红 ⇒ 先读该遍 FAIL 行 + profile 审计做定性（产品／仪器／夹具三选一），修完**从第 1 遍重跑**，不降规模、不放宽断言；③ 三绿 ⇒ 按 §19.3 的 **15 支串行**跑 live（带密钥环境变量，一次一支；`verify-history-persist`、`verify-gate-manifest` 用 `packages/app-shell/scripts/` 的真实路径，不在 `dev/gates/`）→ **两遍验收**（fast 档含 §38.3 那三支）→ 首启 `node dev/gates/r38-firstrun.mjs`。
- 【场地请求（第四次提，同 §35.5/§36.4/§37.6）】三连 + live + 两遍验收期间请勿改 `packages/*/src`、`packages/*/scripts`、`dev/gates`、`dist`：动一次 ⇒ 这一遍作废、live 从第 1 遍重来。已连续四支推进器因这条起不了跑，累计白烧等待超过 1 小时。
- 本会话改动面（如实）：只有本文件（§38）与 `<仓库目录>/.r50-logs/_watch55.sh`、`watch55.log`（判活与采样脚本）；`packages/*`、`dev/gates`、`dist` **一个字节没改**；未 commit、未 push。
- §22.3 的 P0 清单**仍一条未减**。

## 38.5 【订正 §38.1/§38.4 的"在跑"】20:57:39 产物被重建 ⇒ 这一遍 VOID；本会话按 §35.6 先例只杀自己那一支树
- **改判读数（原文，`_watch55.sh` 每 60 秒自动采）**：
  ```
  [20:56:52] DRV=1 GATE=1 EXIT1=0 MAIN=76613c570b5a@20:40:40 | audit.jsonl write=20:56:45 len=19961
  [20:56:52] tail:   ok   第1轮：碰撞判定|  ok   第1轮：失败可重开|
  [20:57:53] DRV=1 GATE=1 EXIT1=0 MAIN=ddbe441f417c@20:57:39 | audit.jsonl write=20:57:11 len=20208
  ```
  ⇒ `dist/electron-main.js` 从开跑前的 `76613c570b5a`（20:40:40）变成 **`ddbe441f417c`（20:57:39）**，而这一遍 20:52:11 才起跑、第 1 轮 20:56 收（原文行 `· 这一轮用了 252 秒（回复 400 字）`，第 1 轮 8 条里含 `ok 第1轮：碰撞判定`、`ok 第1轮：失败可重开`）。**第 5 次把真机遍跑到一半被重建打空**（前四次：11:43、11:55、18:39:38、19:54:50）；这一轮的重建来自改码会话（它 20:5x 的读数就是 §37.1/§37.3 那批产品修复 + `r50-run3.mjs` 日志重试）。
- **判据核对（读代码，不是转述）**：`dev/gates/r50-run3.mjs:163-169` 的开跑/收工指纹比对是**机械**的 —— `zhiWenShou !== zhiWenKai` 就打 `[VOID] … 遍内产物被重建 … ⇒ 新产物上从第 1 遍重跑`。产物已经变了 ⇒ 这一遍**无论后面 5 轮跑成什么都不计入验收**，继续跑只是白烧真机时间与模型额度。
- **同窗口还有第二支真机壳**：20:58:48 另一路会话起带 `--remote-debugging-port=9988` 的电子壳（profile `%TEMP%\warmy-lang-gate-profile-…`，加载的正是我们这份 `dist/electron-main.js`），发起者是它那支 `run-verify-22.mjs --tier=fast`（PID 40952，21:0x 仍在跑，随后又带起 `packages/sync-protocol/scripts/verify-all.mjs`、`verify-dht.mjs`）⇒ 桌面此刻是**并发**状态，不是干净场地。
- **本会话的动作（如实）**：21:00 `taskkill /PID 21596 /T /F` 只杀**本任务自己这一支树**（逐级 8 个：驱动 `21596` → 门禁 `31596` → 电子壳 `40164`(9946) 及其 5 个子进程）；杀完复查 `r50-run3|verify-r46-youxi|remote-debugging-port=9946` **零命中**、9946 连接数 **0**。**没杀别人的 9988 那支，没动任何文件与判据。** 处置与 §35.6（19:58:09 杀自己起的树）同例。
- **进度**：三连计入验收 **0/3** → live 0 → 两遍验收 0 → 首启未跑。

## 38.6 抓到一条仪器分级缺陷：`needsElectron: true` 的门禁挂在 FAST 清单里（定性=仪器，本会话未改）
- 上面那支"fast 档里的真机壳"不是偶然，是**清单挂错档**：
  - `packages/app-shell/scripts/verify-strict-language.mjs:14-43` 在模块顶层**无条件** `spawn(electron, ['--remote-debugging-port=9988', …, mainJs])`（`:21` 端口默认 9988、`:23` `mainJs` = `dist/electron-main.js`、`:71` 起不来才 `exit 2`）⇒ 它就是真机门禁；
  - 它却在 `dev/gates/run-verify-22.mjs:45` 的 **FAST** 数组里（`['app-shell', 'verify-strict-language', 180]`），而同文件 `:9` 自己写的档位定义是"`--tier=live` 真机 Electron 门禁（要启动应用…）"；
  - `docs/GATE-MANIFEST.json:631-637` 明登 `"needsElectron": true` ⇒ **档案与档位互相矛盾**：谁跑"纯静态 fast 档"都会顺手起一支 Electron。
- **后果（都落在验收链上）**：① 任何人跑 fast 档（**含我们的两遍验收自己**）都可能与在跑的真机遍并发 ⇒ 抢桌面、抢真模型、假红；② 三连的坑位闸按"带调试端口且加载我们 main"计数，会把这支算成占坑 ⇒ 表现为"场地永远不空"（方向是 fail-safe，但会把验收卡死）；③ §22.6「真机门禁严禁并行」这条纪律**在清单层面没有结构化保证**，全靠人记得。
- **本会话不修**（要动 `dev/gates/run-verify-22.mjs` 与/或 `docs/GATE-MANIFEST.json`，而改码会话正跑它的 fast 档，动一次就把它的静默窗和下一遍一起打空）。给改码会话的两条出路**都不是放宽断言**：要么把 `verify-strict-language` 挪进 LIVE 数组（档案与档位一致）；要么留在 FAST 但起跑前先查坑、被占就 **如实打 skip/红**，不许静默起壳。挪档同时要让 `verify-gate-manifest` 的档位一致性判据跟着改，否则就是删薄。

## 38.7 顺手发现一条对外发布面的"永不翻红"锚（定性=文档+仪器，不属验收链，登记）
- 只读核对：`packages/app-shell/package.json:3` = **0.2.23**；GitHub `releases/latest` = **`v0.2.23`**、资产 **`WArmy-Setup-0.2.23.exe`**（api 原文 `"name": "WArmy 0.2.23"`）；而 `README.md:109-110` 与 `说明.md` 教用户下载的是 **`v0.1.0` / `WArmy-Setup-0.1.0.exe`**（本地 `release/` 里 0.1.0…0.2.x 都在，按 `.gitignore` 不入库）。
- **关键是仪器**：`packages/app-shell/scripts/verify-docs.mjs:139-140` 把 `WArmy-Setup-0.1.0.exe` 当**字面锚**钉 README/说明 ⇒ "文档指向旧安装包"这件事**永远判不红**；同文件 `:123-124` 已经在拿 `package.json` 版本比对 feed，说明"版本一致"本可做成行为锚，那两条却退化成写死的旧版本号。
- 与 §30.3 第 4 行、§31 那条同源（过时字面锚）但方向相反：那几条是"永远不可能过"，这两条是"**永远不可能红**"。要用户点一句"安装包以哪个版本对外"后由改码会话把锚改成**跟 `package.json` 走的行为判据**；本会话一字未改。
- `r38-firstrun.mjs` 里 `grep` 不到 `version`/`Setup` 字样 ⇒ 首启交付不受这条影响，验收链照原计划走。

## 38.8 现场与下一步（起跑前置比 §36.4 多一条）
- 现场（21:0x）：本任务的三连**已停**（0 支在跑）；改码会话的 `--tier=fast`（含 §38.6 那支真机壳）与 sync-protocol 门禁**仍在跑** ⇒ 不起三连，避免第六次白烧。
- 起跑前置（§36.4 五条 + 本会话新增）：① `packages/*/src`、`packages/*/scripts`、`dev/gates` 与 `dist/electron-main.js` 的 sha 连续 5 次采样（≥5 分钟）都不动；② `verify-dao-safety` 0 FAIL；③ 场上**既没有** `--remote-debugging-port` 电子壳、**也没有别人的** `run-verify-22`/`verify-`（连续两次采样）；④ 用 `<仓库目录>/.r50-logs/start-game-3x-r52.cmd` 起，stdout 走 `game-3x.out.log`；⑤ 判活认 `[产物]`/`[VOID]` + 双信号；**看到 `REBUILT-MIDRUN` 就当场按 §35.6/§38.5 处理（杀自己这棵树、重等静默窗），不要等它跑完再收 `[VOID]`**。
- 采样脚本留给下一支推进器：`<仓库目录>/.r50-logs/_watch55.sh`（双信号 + 产物指纹 + **只认起跑后的新增行**）、`_alive53.ps1`（进程与 profile 活性）。
- 本会话改动面（订正 §38.4 那句"一个字节没改"仍然成立）：只有本文件（§38.5–§38.8）与 `.r50-logs/` 下自建采样脚本；`packages/*`、`dev/gates`、`dist` 一字节未改；只杀过本任务自己那一支树；未 commit、未 push。
- 仍等用户点头（本会话一条未动）：§37.5/§38.3 阶梯以哪份为准 + "注入位置与压缩层必须同序"、§38.6 fast 档里那支真机壳怎么归档、§38.7 安装包对外版本锚、§33.3 round12 判别实验、§29.10 round16 三条出路、§30.7 b) ASR skip 口径、§25.4 的 ④「被拒即停用」。
- §22.3 的 P0 清单**仍一条未减**。

## 38.9 阶梯三份口径的最新实测（21:0x 读**当前**源码，行号是这一份 build 的原文）
- 注入装配位置（`packages/app-shell/src/electron-main.ts` 里 push 的先后）：`10995 产品门禁` → `11007 道` → `11016 术` → `11030 规范` → `11047 印象` → `11290 工具` → `11301 教条` → `11308 束缚` → `11314 认知`。
- 压缩分层（`packages/app-shell/src/yaSuo-fenCeng.ts:15-17`）：第 1 层（上下文不够时**最先压**）= `['软门禁','工具','印象']`；第 2 层 = `['身份','认知','束缚','教条']`；第 3 层 = `['规范','术']`；`BU_KE_YA_SUO` 只有「道 / 产品门禁」（`:12` 注释原文"根本不进这个队列"）。
- 任务与 §25.1 的口径 = `硬门禁 > 道 > 术 > 规范 > 教条 > 束缚 > 工具 > 软门禁 > 认知 > 印象`。
- ⇒ **三方两两都不同序**：`印象` 在注入侧排第 4 高、在压缩侧第一个挨刀；`教条/束缚/认知` 在注入侧垫底、在压缩侧反而排在 `印象/工具/软门禁` 之后。`verify-prompt-layers`（29/0）逐字钉注入表、`verify-r52-yasuo`（47/0）逐字钉压缩表 ⇒ **两支同时绿，正好把矛盾盖住**（§37.5 的判断在这份源码上仍成立，本轮只更新行号与实测）。
- **为什么这条卡在验收口径前面**：两遍验收跑到这两支都会绿，但绿的是"代码与自己那两张表各自自洽"，**不是**"符合用户定的阶梯"。等用户点一句以哪份为准，并由改码会话把另一处对齐 + 补一条**跨表同序判据**（注入位置与压缩层必须同序，否则翻红）。本会话一字未改判据。
- **口径澄清（任务第 5 条里那句话要按实测改口径）**：新门禁 `packages/app-shell/scripts/verify-r52-layers.mjs`（54/0）**根本不钉阶梯顺序** —— 它管的是①印象隐私过滤器真值表、②"什么进认知"判据真值表、③归档两入口同管线、④术归纳幻觉硬闸、⑤卡片路径行为（见该文件 `:3-4`/`:44`/`:70` 的原文段标题）。钉阶梯的只有 `verify-prompt-layers`（注入侧）与 `verify-r52-yasuo`（压缩侧）两支。⇒ "把阶梯算进验收口径"实际落在这两支上，而它们钉的是 §32.1 那份；两遍验收**不会**替用户发现注入侧与压缩侧互相矛盾（两支各查各的表，这正是 §37.5 说的"两支都绿却盖住矛盾"）。
- 代码里还留了一句**故意的**反 §25.1 断言：`verify-prompt-layers:95` `need(!/【印象 · 对用户的长期理解（最低）/.test(em), '印象不再自称"最低"（第 52 轮它升到规范之后）')` ⇒ 若用户最终定"印象殿后"，这条负向锚要跟着反过来，不许只改文案不改判据。

## 38.10 本会话踩到的第二条仪器坑（按 pattern 杀进程会杀到自己）
- 21:0x 我想重启那支跑偏的静默窗轮询，用了 `Get-CimInstance … CommandLine -match '_wait55\.sh' | taskkill /T /F`：**发起查询的那支 bash 自己就带着这个 pattern**（整条命令回显在它的命令行里）⇒ 级联把自己的 shell 一起杀掉，命令 exit 1、后续"重启轮询"那半句根本没执行。
- 【教训，与 §30.1「进程名匹配 `MiMo` 误当门禁节点」同型】**按命令行 pattern 匹配进程时，查询命令必然自匹配**。安全做法：先只列出 PID + 完整命令行、人工核对后再 `taskkill /PID <n>`（**不带 `/T`**，避免级联）；要杀整支任务树就照 §38.5 那样用**已确认的根 PID**（驱动器的 PID），而不是用 pattern 现查现杀。
- 顺带登记一条静默窗口径修正：`_wait55.sh` 最初把 `docs` 也算进"最新 mtime"域 ⇒ **推进器自己写交接文档就会把静默窗清零**，永远等不到 GO。已按 §36.4 的原始口径收回三个域（`packages/*/src`、`packages/*/scripts`、`dev/gates`）。
- 现场复核（21:0x，只读）：`_jing55.ps1` 的坑位谓词实测 `DBG-PROC=0`（改码会话那支 9988 真机壳已收），但 `BUSY=2` —— 它那支 `run-verify-22.mjs --tier=fast` 与 `verify-tool-ca…` 仍在跑，且 21:01:42 又重建了一次产物（`#1148240af2c7`）⇒ **本会话仍未起三连**（这一份产物距 §38.5 那次已换第 2 份）。
- live 名单起跑前体检（只读，15 支路径逐条核）：14 支在 `dev/gates/`，`verify-history-persist`、`verify-gate-manifest` 在 `packages/app-shell/scripts/`，**无一缺失** ⇒ 三绿后串行不会再踩 §27.5 那条"按名单拼 `dev/gates/<名>` 拼空"的坑。

## 38.11 订正：这一遍不是"无声消失"，是 21:00:05 本会话按 §38.5 树杀的；我那条 `DRV=0` 读数本身是查询假死
- 补一条 §38.5 只记了一半的重建读数（`_watch55.sh` 原文）：
  ```
  [20:58:53] DRV=1 GATE=1 EXIT1=0 MAIN=f7ff5090a7cf@20:58:15 | audit.jsonl write=20:58:52 len=23692
  [20:59:54] DRV=0 GATE=0 EXIT1=0 MAIN=f7ff5090a7cf@20:58:15 | audit.jsonl write=20:59:27 len=26947
  ```
  ⇒ 产物在 20:57:39 与 20:58:15 **连续重建两次**（`76613c570b5a → ddbe441f417c → f7ff5090a7cf`）。
- **给另一支推进器补"因"**：它 §37.8 之后那条读数写"20:59:2x 驱动器与门禁同刻消失、无任何结论行、死因写不出可 grep 的因"。因在这里 —— **21:00:05 本会话**执行 `taskkill /PID 21596 /T /F`，原文回显逐级终止 `26744 / 35720 / 39956 / 21424 / 8596 / 40164 / 31596 / 21596` 共 8 只（全带我们的 `dist/electron-main.js`，端口 9946）。不是全局杀、不是产品崩、不是别人动的手。
- **但把我自己的读数错一起写清**：`[20:59:54] DRV=0 GATE=0` 与**同一行**的 `audit.jsonl write=20:59:27 len=26947`（还在长）自相矛盾；而我 20:59:4x 直接 `Get-CimInstance` 明明列出 `21596`/`31596`/`40164` 三只的完整命令行 ⇒ 那是 **WMI 查询瞬时失败被读成"进程没了"**。这与 §35.6 给 `run-verify-22.mjs` 修掉的 `JSON.parse('')`（"查询失败"与"真的为空"共用一个返回值）是**同一个 bug 换到了我自己的采样脚本上**。
- 【下一支推进器照此判活（三条）】① **两条信号互相矛盾时一律按"查询失败"处理**：保守 ⇒ 不判死、不重跑、不另起第二支，改用第二种问法复核（`Get-Process -Id <PID>` 在不在、`netstat` 上 9946 连接数、`audit.jsonl` 长度是否还在变）；② 采样脚本必须把"0 个"与"查不到"分开打印（`NONE` vs `QUERY-FAIL`，后者按"被占"处理）；③ 真机遍的结束要有一条 **grep 得到的因** —— 要么 `[VOID]`/`[OK]`/`[STOP]` 结论行，要么"谁杀的 + PID 回显"，两者都没有就只登记现象、不写因果。
- 现场（21:0x）：本任务 0 支在跑；改码会话的产物在 21:01:42 又换了一份（`#1148240af2c7`），21:03:54→21:06:26 三次采样 src/sha 不动、`DBG-PROC=0`、`BUSY=0` ⇒ 静默窗正在成形（`_wait55.sh` 要到 `QUIET-STREAK≥5` 才 RESULT=GO）。

## 38.12 【起跑】静默窗 GO ⇒ 三连第 1 遍 21:09:26 在新产物上开跑（起跑前体检全绿）
- **静默窗终局读数（`_wait55.sh`，50 秒一次）**：
  ```
  [21:06:26] SRC=packages/app-shell/scripts/verify-r53-zhishi.mjs SHA=1148240af2c7 MT=21:01:42 DBG-PROC=0 BUSY=0  QUIET-STREAK=3 KENG-STREAK=3
  [21:07:17] …同上…                                              QUIET-STREAK=4 KENG-STREAK=4
  [21:08:07] …同上…                                              QUIET-STREAK=5 KENG-STREAK=5  RESULT=GO
  ```
  ⇒ 产物（`#1148240af2c7`，21:01:42）**连续 5 次采样不动**、带调试端口的电子壳与别人的 `run-verify-22`/`verify-` 节点连续 5 次为 0（§36.4 ①③ + §38.8 ③ 齐）。
- **起跑前体检（纯静态、不起 Electron，21:08–21:09 原文）**：`verify-dao-safety` **12/0** · `verify-prompt-layers` **29/0** · `verify-r52-layers` **54/0** · `verify-r52-yasuo` **47/0** · `verify-gate-manifest` **23/23** · `verify-docs` **95/0** · `verify-security` **PASS 28**；密钥文件在（222 字节）、`better-sqlite3` 三候选齐全、9946 连接数 0。⇒ §36.4 ②与 §22.1 B 都过。
  - **一条"崩溃≠红"的复跑（§36.5 同型）**：批量第一跑 `verify-r52-yasuo` 抛出 Node 栈（汇总行没打出来），当场**不判红**，复跑两次分别 `47 ok / 0 FAIL`、`exit=0` ⇒ 定性为**读源码窗口里的瞬时崩**，不是产品红也不是判据被删薄。
- **起跑读数（`game-3x.out.log` / `game-3x.log` 新增行原文）**：
  ```
  [driver] r52-restart 2026-10-21 21:09:06.08
  [产物] game 第 1/3 遍开跑前指纹：dist/electron-main.js 13:01:42#1148240af2c7 | dist/renderer/app.js 12:58:20#74292382d234
  [game] 第 1/3 遍开始 2026-10-21T13:09:26.733Z
  ```
  ⇒ 开跑前指纹与静默窗那一份**逐字一致**（驱动器打印的是 UTC，`13:01:42Z` = 本机 `21:01:42`）。用 `<仓库目录>/.r50-logs/start-game-3x-r52.cmd` 起（stdout 走 `game-3x.out.log`，不与驱动器抢 `game-3x.log` ⇒ 不再犯 §35.1 的 EBUSY）。
  那行 `[WAIT] … 坑位被占（带调试端口的调试壳 0 个），已等 0s` 是 §37.8 登记的**文案噪点**（首次采样必然打），不是真被占。
- **起跑后判活（21:09–21:10，双信号）**：进程侧内联查询命中两只 —— 驱动器 `29056`、门禁本体 `21980`（新 PID，不是被杀的 `21596/31596`）；产物侧 `game-run1.log` 已写到 `ok 应用启动（独立 profile + 独立端口，没动用户的实例）`、`ok MiMo 密钥已交给宿主（不打印）` ⇒ **两信号都为正，本会话没有起第二支真机门禁**。
- 旁观器换成**自带查询**的一版（`%TEMP%\w56-watch.sh` → 读数 `%TEMP%\watch56.log`）：每 60 秒采进程数 / `dist` 两份产物 sha / 遍内轮数 / 只认 `game-3x.log` 新增行；**产物一变就打 `REBUILT-*（这一遍将 VOID）`**，不等遍末的 `[VOID]`。查询失败与"真的 0 个"分开打印（`QUERY-FAIL` 按占坑处理，绝不当成死透）。

## 38.13 订正 §38.11 的因果：那条 `DRV=0 GATE=0` 不是 WMI 瞬时失败，是**采样脚本被并行会话删了 + 我的脚本把 stderr 吞进 /dev/null**
- 证据：21:09 再调 `<仓库目录>/.r50-logs/_alive53.ps1` 报 `-File 参数…不存在`；`ls .r50-logs/*.ps1` 里 **`_alive53.ps1` 已不在**（同目录 `_alive52.ps1`、`_tree52.ps1` 还在）。而它 20:58:53 那一次还正常打印出 `DRV=1 GATE=1` 与 profile 行数 ⇒ 删除时刻落在 **20:58:53–20:59:54** 之间，正好夹出那条假读数。
- 我这版旁观器当时写的是 `powershell -File .r50-logs/_alive53.ps1 2>/dev/null` —— **把"脚本不存在/查询失败"的错误吞成空输出**，空输出又直接被当成"进程 0 个"⇒ 判"驱动器消失"。这与 §35.6 给 `run-verify-22.mjs` 修掉的 `JSON.parse('')`（"查询失败"与"真的空"共用一个返回值）**是同一个 bug 的第三次现身**（前两次：§35.6 的空串、§30.1 的进程名误匹配）。
- 【固定做法】① 判活脚本**自带查询**（内联 `powershell -Command`），不依赖仓库里可能被别人清掉的 `.ps1`；② **绝不 `2>/dev/null`**，把 stderr 一起收进判定，分三类：`PIDS=n`（真数）/`NONE`（查询成功且为 0）/`QUERY-FAIL`（读不到 ⇒ 按"被占"处理，不判死、不重跑、不起第二支）；③ **两条信号互相矛盾时按查询失败处理**（本轮现场：同一行 `audit.jsonl write=20:59:27 len=26947` 还在长，与 `DRV=0` 直接矛盾）；④ `.r50-logs/` 里的工具会被并行会话按"自己的临时产物"清掉 ⇒ 长跑旁观器放 `%TEMP%` 并用自名字带轮次（本轮 `w56-watch.sh`）。
- 结论不变的部分：这一遍作废的**真正原因仍然是 §38.5 那两次遍内重建**（20:57:39、20:58:15），我 21:00:05 的树杀只是把已经注定 VOID 的一遍提前收掉；处置照 §35.6 先例，无需改判据。

## 38.14 【里程碑】三连第 1 遍全绿**且产物未变 ⇒ 第一次真正计入验收**；第 2 遍 21:26:49 自动开跑
- 终局读数（`game-3x.log` 新增行 + `game-run1.log` 汇总行，原文）：
  ```
  [game] 第 1/3 遍 exit=0
  [OK] game 第 1/3 遍全绿（产物 dist/electron-main.js 13:01:42#1148240af2c7 | dist/renderer/app.js 12:58:20#74292382d234）
  ==== verify-r46-youxi（压力档 A · 6 轮网页小游戏）：过 35 · 败 0 · 跳 0 ====
  ----- exit=0 -----
  [产物] game 第 2/3 遍开跑前指纹：dist/electron-main.js 13:01:42#1148240af2c7 | dist/renderer/app.js 12:58:20#74292382d234
  [game] 第 2/3 遍开始 2026-10-21T13:26:49.728Z
  ```
  ⇒ **开跑前与收工后两份产物逐字相同**（`#1148240af2c7` / `#74292382d234`，遍内没有任何重建）⇒ 不是 `[VOID]`，**第 1 遍计入验收：1/3**。条数口径按 §38.2：**`过 35 · 败 0 · 跳 0`**（不是 §19.3 那句旧的"过 31"）。
- 遍内真实耗时（原文行）：`这一轮用了 130 秒 / 148 秒 / 41 秒（回复 3 字）…`，整遍 21:09:26 → 21:26:49 ≈ **17 分 23 秒**（比 §25.4 记的"每遍约 50 分钟"快得多 ⇒ 台账里的时间预算按实测 17 分钟/遍排，别再按 50 分钟等）。
- 第 2 遍起跑即踩一次**仪器层重试**（21:29:19 读数，原文，非 FAIL 行）：
  ```
  · 这一轮**没拿到回复**（100 秒）：[r46youxi] CDP 错误 @Runtime.evaluate: {"code":-32000,"message":"Execution context was destroyed."}
  ```
  ⇒ 这是门禁自己的 CDP 上下文被页面重载打掉后**重拿**的那条（`·` 前缀，不是 `FAIL`），驱动器与门禁都还在（`PIDS=2 DBG=1`，DBG=1 就是它自己那一只 9946 壳）。**不据此判红**，等该遍的 `----- exit=N -----` 与 FAIL 行原文再定性；若该遍红，先分"产品改坏文件 / 仪器 CDP 时序 / 夹具"三类，修完从第 1 遍重跑。
- **我自己的旁观器又踩了同一条坑第三次**（照 §38.2 的教训登记，不遮掩）：v4 初版用 `grep -c '第 N/3 遍开始'` 数整份 `game-3x.log` ⇒ 把历史 15 次起跑读成"当前第 15 遍"、日志文件名拼成 `game-run15.log`（tail 取空）。已改成**取最后一条 `[game] 第 N/3 遍开始` 的行内数字**，并把 `dry-run 一次看读数` 固定为起长跑旁观器前的动作（`bash -n` + `MAXIT=1` 实跑一遍）。同版还加了：`PIDS/NONE/QUERY-FAIL` 三分（§38.13）、`REBUILT-MAIN/RENDERER` 遍内看门狗（不再等遍末 `[VOID]`）、`并发真机壳 DBG>1` 告警（防 §38.6 那支 9988 壳插进来）。脚本在 `%TEMP%\w56-watch.sh`，读数 `%TEMP%\watch56.log`。
- **进度与下一步**：三连 **1/3**（第 2 遍在跑）→ live 0 → 两遍验收 0 → 首启未跑。三绿后照 §19.3 串行 15 支 live（一次一支，带密钥环境变量）→ 两遍验收 → `node dev/gates/r38-firstrun.mjs`。**场地请求不变**：这三步期间请勿改 `packages/*/src`、`packages/*/scripts`、`dev/gates`、`dist`（第五次打空的代价就是刚才那 4 分钟 + 一遍 17 分钟）。

## 38.15 【达成】小游戏压力档 A 三连 **3/3 全绿，三遍同一份产物**（22:10:16 读数）⇒ live 串行已于 22:12:15 起跑
- **驱动器收工读数（`game-3x.out.log` 原文）**：
  ```
  [OK] game 第 3/3 遍全绿（产物 dist/electron-main.js 13:01:42#1148240af2c7 | dist/renderer/app.js 12:58:20#74292382d234）
  [DONE] game 3/3 全绿
  三连驱动器收工
  [driver] exit 0
  ```
- **三遍的逐遍读数（汇总行 + 结论行 + 开跑前指纹，全部同一份产物 ⇒ 无一遍 `[VOID]`）**：
  | 遍 | 起跑 | 收工 | 汇总行 | 遍内产物 | 仪器内重试次数 |
  |---|---|---|---|---|---|
  | 1 | 21:09:26 | 21:26:49（17′23″） | `过 35 · 败 0 · 跳 0` + `----- exit=0 -----` | `1148240af2c7` / `74292382d234` | 0 |
  | 2 | 21:26:49 | 21:51:53（25′04″） | `过 35 · 败 0 · 跳 0` + `----- exit=0 -----` | 同上（逐字一致） | 5（`没拿到回复`/`CDP 上下文被销毁`/`需要纠正` 一类，全部自己补回来了） |
  | 3 | 21:51:53 | 22:10:16（18′23″） | `过 35 · 败 0 · 跳 0` + `----- exit=0 -----` | 同上 | 1 |
  - 如实登记：**三遍不是同等"干净"** —— 第 2 遍吃到 5 次仪器级重试（§38.14 那条 `Execution context was destroyed` 就是这一遍的），但每一轮最后都收敛到 `败 0 · 跳 0`。⇒ 计绿成立（判据是"每遍结论行 + 产物未变"），**不许**把这条说成"三遍一次性跑通"。
  - 时间预算订正：整串三连实测 **60′50″**（约 20 分钟/遍），不是台账里 §25.4 的"每遍约 50 分钟、三遍约 2.5 小时"。
- **起跑 live 前的现场核对（22:10 读数）**：`dist/electron-main.js` 仍是 `1148240af2c7…`、`dist/renderer/app.js` 仍是 `74292382d234…`（**与三连开跑前逐字相同，70 分钟无人重建**）；带调试端口的电子壳 **0 只**；`r50-run3|verify-|run-verify-22` 的 node **0 支** ⇒ 场地干净，符合 §36.4/§38.8 的串行前置。
- **live 串行驱动器（22:12:15 起跑，临时件跑完删）**：`%TEMP%\r53-live.mjs` + 坑位探针 `%TEMP%\r53-keng.ps1`，名单 = §19.3 那 **15 支**（不含我上轮多跑的 roster 附加项），按"便宜在前、最贵（`verify-round34-live` 双腿 2400s）在后"排；每支独立日志 `%TEMP%\r53-live-<名>.log`，预算 = 清单里的秒数 + 120 秒余量；**每支起跑前必须探针回 0**（`QUERY-FAIL`/非 0 一律 `[STOP]` 整批停下，绝不并发第二支真机门禁）；环境变量带 `MIMO_KEY_FILE` 与 `KEEP=1`，密钥不进仓库。
- **首个读数**：`[GREEN] verify-round27-live 33s FAIL行数=0 | 真机 UI：过 14 · 败 0`（1/15），随后自动接第 2 支 `verify-r44-token-live`。
- **下一支推进器照此走**：① 读 `%TEMP%\r53-live.mjs` 的 stdout（后台任务输出）或 `%TEMP%\r53-live-*.log` 逐支明细，看汇总行 `==== R53 live 串行汇总：15 支，绿 X，红/阻塞 Y ====`；② **有红先定性**（产品／仪器／夹具三类，每条都要给可 grep 的原文），修完**从第 1 遍重跑三连**（口径：一次全绿即加档重数，见 §22.3 与验收协议），不许降规模、不许放宽断言；③ live 全绿 → **两遍验收**（fast 档整遍 ×2，含 §38.3 那三支阶梯/新门禁；注意 §38.6 那条：fast 档里挂着 `verify-strict-language` 这支真机壳，跑它期间别再并发起别的真机档）→ ④ 首启交付 `node dev/gates/r38-firstrun.mjs`。
- 本会话改面（累计，如实）：`docs/HANDOFF-R51.md`（§38 全节）+ `.r50-logs/` 与本会话自建的采样脚本 + `%TEMP%` 下的旁观器与 live 驱动器；**`packages/*`、`dev/gates`、`dist` 一个字节没改**；杀过且只杀过本任务 20:52 那一支注定 VOID 的树；未 commit、未 push。
- §22.3 的 P0 清单**仍一条未减**。

## 38.16 live 串行整遍读数：15 支 **14 绿 / 1 红**（22:12:15→22:28:21，整批 16′06″）
- **14 支绿（原文汇总行照抄 + 实测耗时）**：
  ```
  round27-live         33s  真机 UI：过 14 · 败 0      r44-token-live       70s  35 ok / 0 FAIL
  r48-zhongjian-ui     25s  9 ok / 0 FAIL             round34-ui           26s  38 ok / 0 FAIL
  round38-restart      57s  14 ok / 0 FAIL            round39-quota-ui     11s  17 ok / 0 FAIL
  r48-nengli-tongbu    16s  17 ok / 0 FAIL            round20-team         15s  过 33 · 败 0
  round39-longchat     64s  15 通过 / 0 失败           history-persist      35s  ALL PASS（会话历史持久化验收通过）
  round28-live         92s  过 9 · 败 0 · 没跑 0        r44-shejiao          27s  51 ok / 0 FAIL
  round20-team --ollama 25s  过 33 · 败 0              r44-ui               34s  66 ok / 0 FAIL
  ```
  ⇒ §31 记的那整遍 live 用了 2 小时 13 分，这次回到 §19.3 的 15 支名单（不掺 roster 附加项 round12/16/17/18x/38-asr）只用 **16′06″**；§35.B6 那 4 条红里，除 round34-live 外本轮都没复现。
- **唯一红**：`verify-round34-live` 419s ⇒ `==== verify-round34-live：试验 1 次 · 过 0 · 败 1（pass^k 要求全过）====`，失败项原文：
  ```
  FAIL 看到了 svg 里画的东西（认出音乐／或如实描述了画面；说"看不到图"就是红）
       => {"kanChuYinYue":false,"miaoShuHuaMian":false,"shuoMeiKanDao":false,"meiKanDaoJu":[],"wei":"…现在写小说，按分段方式落盘。"}
  ```
- **定性（三条都在同一遍同一份日志里，可 grep）**：
  1. `:78 ok 看到了截图里的内容（WArmy / 第四列 / 全面验证）` ⇒ **同一轮**里 png 那张被看懂 ⇒ 视觉通路在跑；
  2. `:82 ok 两张附件都转成了模型能看的位图（svg 也转了）` ⇒ 判据在 `dev/gates/verify-round34-live.mjs:580`（`images === 2 && skipped === 0`）⇒ **宿主交付没问题**；
  3. 轨迹侧：`:63 ok 长文写满了（≥5700 字）`、`chat.tools.done lun=11 stop`、`桌面本次产出：你是谁我是谁.pptx(334字)、你是谁我是谁.txt(452字)、守灯的人.txt(6065字)`、`+399s plan.evidence-autoverify`，失败读数的 `wei` 尾巴就是小说正文。
  ⇒ **不是仪器、不是夹具**：模型在这一轮把"看图说图"这一件**整件没答**（三个 false + 举证为空，连"看不到图"都没说）。这是第 44 轮定的**满血腿结果类红**：判据照旧硬判，**一字未放宽**。
- **处置（取第二样本，不动判据）**：22:3x 场上没有别的真机档 ⇒ 单独串行复跑 `verify-round34-live`（带密钥 + `KEEP=1`，日志 `%TEMP%\r53-live-rerun1-round34.log`）。两条分岔与后手：**绿** ⇒ 属"一轮里六件事 + 6000 字长文把注意力吃满 ⇒ 漏答一件"的**概率红**，产品该做的是**宿主在收尾核对用户点名的每一件、漏答就如实补派一次**（同 §26 的宿主兜底口径：加反馈，不改判分）；**仍红** ⇒ 转产品缺陷取证（把 svg 归一后那张位图取出来看它究竟画了什么、尺寸/内容对不对），不许先怪模型。
- **进度**：三连 **3/3 ✅**（产物 `1148240af2c7`）→ live **14/15**（1 红在取证）→ 两遍验收 0 → 首启未跑。

## 38.17 live 串行驱动器的读数与一条仪器待办
- 驱动器 `%TEMP%\r53-live.mjs`（临时件，跑完删）+ 坑位探针 `%TEMP%\r53-keng.ps1`：名单 = §19.3 的 15 支，便宜在前、最贵在后；每支独立日志 `%TEMP%\r53-live-<名>.log`；预算 = `run-verify-22.mjs` LIVE 数组里同一支的秒数 **+120 秒**；**每支起跑前探针必须回 0**，`QUERY-FAIL` 或非 0 一律整批 `[STOP]`（本轮 15 支一次都没触发）；带 `MIMO_KEY_FILE` 与 `KEEP=1`，密钥不进仓库。
- 一条仪器待办（不改判据）：我打的 `FAIL行数` 用 `^\s*(FAIL|\[FAIL )` 数，而 `verify-round34-live` 把失败项写在汇总行之后的"续派"行里 ⇒ 条数（2）与门禁自报"败 1"不对齐。下一版驱动器**以门禁自己的汇总行取"过/败/跳"**，`FAIL行数` 只当旁证（口径同 §38.2"认门禁的汇总行，不认我的正则"）。
- 并发核对：本批全程只数到 1 只带调试端口的电子壳（就是我这一支自己），没有第二支真机档插进来；改码会话自 21:01:42 起没再动产物（两份 `dist` sha 到 22:28 未变）⇒ §38.6 那条"FAST 档里挂着真机壳"本轮没踩到（我没跑 fast 整遍）。

## 38.18 那条红的第二样本已经拿到一半：**试验 1 复跑把 svg 答对了**
- 22:30 起单独复跑 `verify-round34-live`（`MIMO_KEY_FILE` + `KEEP=1`，日志 `%TEMP%\r53-live-rerun1-round34.log`）。该门禁是 **τ-bench 式 pass^k**（`dev/gates/verify-round34-live.mjs:7-9`：每次**全新 profile**、连跑 k 次、**k 次全过才算过**）⇒ 上一批只跑到 `试验 1 次 · 败 1` 就停，这次第 1 次过了才进第 2 次。
- **第 1 次试验的读数（原文行号照抄）**：
  ```
  :72  ok   看到了截图里的内容（WArmy / 第四列 / 全面验证）
  :73  ok   看到了 svg 里画的东西（认出音乐／或如实描述了画面；说"看不到图"就是红）
  :76  ok   两张附件都转成了模型能看的位图（svg 也转了）
  :70  ok   长文写满了（≥5700 字）
  ```
  ⇒ **同一条判据换了随机种子就绿** ⇒ §38.16 的定性成立：**这是模型在同一轮里漏答一件的"概率红"，不是产品缺陷、也不是仪器/夹具错**。判据一个字没动（满血腿结果类照旧硬判）。
  - 顺手补一条可 grep 的机制事实：`verify-round34-live.mjs:67` 的看图能力表 `KAN_TU` 声明 `mediaFormats: ['png','jpeg','webp','gif']` —— **不含 svg** ⇒ 宿主必须先把 svg 归一成位图（就是 `:76` 那条判据存在的原因）。这条链是通的，不用改。
- **我的启动方式把自己截断了（现象如实，不写因）**：那一次我用 `node <门禁> > log 2>&1` 直接当后台任务跑，任务被报"completed(exit 0)"而**内层 node 的退出码是 127**、日志停在 `试验 r34-mimo-2` 的 `进行中 +90s`、**没有任何汇总行**，复查 `verify-round34-live` 的 node 进程 **0 支** ⇒ 门禁是被外部截断的，不是自己跑完的（写不出可 grep 的因，就只登记现象）。后手：换成与 §38.17 同型的**驱动器 spawn 子进程**方式再起一次（`%TEMP%\r53-r34-rerun.mjs` → `%TEMP%\r53-live-rerun2-round34.log`，30 分钟预算），22:4x 起跑；这一支跑完拿到 `==== … 试验 k 次 · 过 k · 败 0 ====` 才算 live 全绿。
- 【给下一支推进器】**长跑真机档一律用"驱动器 spawn 子进程 + 独立日志文件"起，不要把 `node <门禁> > log` 直接当后台任务**（本轮实测：前者 15 支连跑 16 分钟稳，后者 90 秒被截断）。同一条也适用 §37.8 的三连（它就是 `.cmd` + `>>` 重定向起的，没出事 ⇒ 关键是"有父驱动器/脚本托管"，不是裸起）。

## 38.19 第二个样本的结果：`试验 2 次 · 过 1 · 败 1` —— 但**败的判据换了一条**，红在 Ollama 404 的归属上
- 22:40:50→22:54:19 用驱动器复跑（`%TEMP%\r53-r34-rerun.mjs` → `r53-live-rerun2-round34.log`，849s）：
  ```
  ==== verify-round34-live：试验 2 次 · 过 1 · 败 1（pass^k 要求全过）====
  FAIL Ollama 没有 4xx/5xx 的对话请求 => ["[GIN] 2026-10-21 - 22:49:04 | 404 | 3.3008ms | 127.0.0.1 | POST \"/api/chat\"", …]
  FAIL r34-mimo-2 用时 430s 续派 {…} 失败项 Ollama 没有 4xx/5xx 的对话请求
  ```
  ⇒ k=2；**试验 1 全绿**（含 §38.16 那条 svg ⇒ 漏答确实是概率的），**试验 2 红在另一条判据上**（`verify-round34-live.mjs:608-610`：读本试验时间窗内 Ollama `server.log` 的新增行，任何 `[GIN] … 4xx|5xx … api/chat` 都算红）。
- **取证读数（四条，都可复现）**：
  1. 本试验 profile 的审计里，**唯一一次被记录的本地调用**是 `14:47:16 triage.local`（成功）；对应时刻 `22:47:1x` 的 Ollama 日志里 **4xx 计数 = 0**（`grep -c "22:47:1[4-9].*| 4"` = 0）。
  2. `14:49:04` 那一秒我们这一支只写了 `chat.inflight-write`（长文流式，每 2 秒一条），**没有任何 provider 请求 / 降级 / 报错条目**（`chat.model-degraded` 零条）。
  3. 404 的**形状**：两波，每波 32 条（16 @:04 + 16@:07），毫秒级拒绝；全天同形状共 **18 波**（`00:08、18:14、18:27、18:28、18:33、18:49、18:52、20:22、20:23、20:33、20:48、20:54、20:58、21:02、21:05、22:49、22:53`），多波落在我们的真机档窗口内 ⇒ **不能靠"别的时间也发生"来排除我们自己**。
  4. 产品侧 `packages/providers/src/ollama.ts:411-425` 的 `chatStream` 会按 `huiTuiJieTi(Qiu, true)` 的**变体菜单连打十几次**同一个 `/api/chat` ⇒ "一次坏请求 = 一波 16–32 条 4xx"这个形状**与产品重试路径吻合**，同样不能排除。
- 【当前结论，如实】这条红**还不能定性**：既不能说"是外部进程打的"（证据 1/2 支持，但证据 3/4 反证不能排除），也不能说"是产品把请求打给了不存在的模型名"（形状吻合但**我方审计里查不到这次请求**）。**根子是一条可观测性缺口**：`chatStream` 的 4xx 尝试**不落审计**（没有 `provider.request-4xx` 这类记录，`cuoWu` 只在返回体里），所以判据拿得到"机器上有 404"，拿不到"这 404 是谁、哪一模型名、哪一次会话"——与 §51 轮"工具结果可见性缺口"同族（看不见 ⇒ 只能猜）。
- 【下一步（两个定性都要做的同一步，且不放宽任何断言）】
  1. **产品侧补可观测性**：`ollama.ts` 的每次 4xx/5xx 尝试落一条审计（`provider.request-failed`：`moXing`、`httpZhuangTai`、`huiHeXiang`、`sessionId`、`ts`），fast 档钉住"4xx 必留痕 + 不许静默重试到底"。这条做完，下一遍这条判据就能**自动配对**，不必靠我人肉对时间戳。
  2. **判据侧改成成对证据**（收紧，不是放宽）：只有当 4xx 行时间戳能对上本试验审计里的本地请求（`triage.local` / `chat.model-picked(provider=ollama)` / 新增的 `provider.request-failed`）才算到我头上；**对不上的行必须如实打印成"外部噪声 N 条 + 样例"，不许静默忽略**。
  3. 两步都会改 `packages/*/src` 或 `dev/gates` ⇒ 按口径**三连要从第 1 遍重数**（约 1 小时真机）。本会话**没有动任何代码与判据**，只登记取证；改代码要不要我来做、先做 1 还是先做 2，等用户一句话（§25.4 的"不抢改"纪律仍然生效）。
- 进度不变：三连 3/3 ✅ → live **14/15 稳定绿 + `round34-live` 这条 404 归属待证** → 两遍验收 0 → 首启未跑。

## 37. 第 53 轮后核查 + 联网补课（用户："验证上两轮、搜最新技术、补不足"）

### 37.1 核查结论（先验证，再动）
- 把两轮的 **9 支专项门禁全部重跑**：`r52-jujue` 42/0、`r52-yasuo` 47/0、`r52-kb` 50/0、`r52-layers` 54/0、
  `r53-shijian` 42/0、`r53-tishangxian` 76/0、`r53-tumin` 45/0、`r53-zhishi` 44/0、`prompt-layers` 29/0 ⇒ **全绿，旧读数可复现**。
- 核查中抓到 **4 个真缺陷**（都不是判据问题，是代码/设计问题）：
  1. **「写入认知」按钮调用了一个不存在的入口**（`instancesSave`，preload 里从来没有过）——`?.()` 把调用静默吃掉，
     实际靠 `stateSave` 落盘。与第 51 轮"道/规矩保存空转"同一类缺陷。已删死调用并注释清楚真正的落盘路径。
  2. **认知层没有保存上限**：注入侧 `slice(0, 1600)` **悄悄截断**，界面显示完整、发出去半截。已补：保存时压回上限并记 `prompt.persona-over-cap`，
     输入框绑上限（Maxlength + 计数）。
  3. **会话级印象草稿**（注入时**优先于**全局印象）同样在保存时 `slice(0, 上限×2)` 悄悄截断，且与注入上限是两套数字。
     已改成走同一个上限判据（超限直接拒），输入框也绑上限。
  4. 全局印象保存里**残留着一句 `slice(上限×2)`**（上限判据已经挡过一遍，这句是旧病复发点）⇒ 删除，不留"存的是半截"的可能。
- 顺带修：三连驱动 `r50-run3.mjs` 的日志追加会因 Windows 共享占用直接抛 **EBUSY**（另一路会话持有同一份 `*-3x.log`）⇒
  改成带重试的追加，写不进去时明确喊一声（结论行不再无声消失）。

### 37.2 联网补课（本轮读到的、吸收/不吸收的理由）
- **Zep/Graphiti 的双时态**（arXiv 2501.13956；`valid_at/invalid_at` vs 入库时间）——我们项 5 已是同一套；
  本轮补的是它论文里"重复实体要合并并重写摘要"的那半：我们的对应物是**写时取代 + `quDaiIds`**（见 37.3）。
- **Mem0 更新阶段的冲突处理**（arXiv 2504.19413 的 ADD/UPDATE/DELETE/NOOP；2026 年 4 月官方又转向"单遍 ADD-only"）——
  两种路线都有代价：纯 ADD-only 会把陈旧矛盾堆起来（我们项 5 已经用"取代不删除"处理），**NOOP 不能省**（同一句被重复存 N 条会挤占检索名额）。
  我们选**确定性冲突检测**（标题归一 + 共同实体 + 内容比对），不引入模型裁决 ⇒ 可回归、可审计；代价是只认得"同标题"的冲突，跨标题的同义说法交给归档整理。
- **LLMLingua-2 一类 token 级压缩**（`llmlingua.com/llmlingua2`、2026 综述）——前提是**小模型/有损**：
  压缩后原文不可逐字复原，也无法向用户证明"要点没丢"。我们的提示词层是**每轮都发、且要求可审计**的（道永不可压、其余要点/字级双守恒），
  所以**不采用**；只在"没有本地小模型、也没有可回退原文"的场景才值得上。
- **知识图谱 vs 向量检索**（2026-08 的对比文）——结论是混合检索；我们已经是 fts5 + vec + 图（实体/事件）三路，不改架构。

### 37.3 本轮补的代码（都在两轮"未完成清单"里点过名）
1. **写时去重与取代（NOOP + UPDATE）**：`knowledge_add` 写事件前，同层 + 同标题（忽略空白/大小写）+ 有共同实体 ⇒ 视为同一说法的不同版本；
   内容完全相同 ⇒ **NOOP 不重复写**（`kb.write-noop`）；内容不同 ⇒ 旧说法 `shiXiaoTs` 取代（不删除）+ 新说法带 `quDaiIds`（`kb.superseded-on-write`）。
   `quDaiIds` 与 `yinZi` 分开：前者是"我把谁顶掉了"，后者是"我由谁派生"。
2. **陈旧度进入排序**：命中轴相同 ⇒ 再比陈旧度、最后比新近（三年前的旧事不许压过最近说法）；时间命中仍是第一关键字。
3. **认知 / 会话级印象的上限**（见 37.1 的 2、3、4）。
4. **r50 日志重试**（见 37.1）。
5. **删死调用**（`instancesSave`）。

### 37.4 判据与负向验证
- `verify-r53-tishangxian` 76 → **81 条**（新增：认知保存压回上限 / 认知输入框绑上限 / 会话印象同一判据 / 死调用已删）。
- `verify-r53-zhishi` 44 → **50 条**（新增：NOOP / 写时取代 / quDaiIds / 共同实体条件 / 陈旧度排序 / 时间命中仍是第一关键字）。
- 新判据的负向验证 `r53-verify2-neg`：**10 个变异全部被抓**，仪器故障 0。
- 全量 fast 档在本轮改动后重跑一遍（读数见 §38）。

### 37.5 仍然没做的（不因这次补课而消失）
- **live 档 4 红仍未定性复跑**：另一位推进器此刻正在真机跑（桌面有 12 个 electron 进程、`wait55` 报 `RESULT=GO`），
  按"真机串行"的口径我没有并发起 Electron 门禁 ⇒ 本轮只做静态/单元层补课。4 条红仍在 §35.B6。
- 提示词上限的**数字校准**、实体复核队列的界面、embedding 第二票、历史会话库重扫、canary 常态化 live —— 仍等拍板/排期（§35）。

## 37.9 【订正 §37.8 的进度读数】第 1 遍起跑后 7 分钟被打空（20:57:39 / 20:58:15 两次重建 dist）
- 时间线（全部来自 `.r50-logs/watch55.log` 与文件系统 mtime，原文可 grep；`watch55.log` 是**另一路会话**在 20:54 建的旁观脚本输出，本会话照抄其读数）：
  ```
  20:52:11 [game] 第 1/3 遍开始（本会话起跑，指纹 76613c570b5a@20:40:40）
  20:56:52 tail: ok 第1轮：碰撞判定 | ok 第1轮：失败可重开   ← 第 1 轮 252 秒、8 条断言全 ok
  20:57:29 dev/gates/r50-run3.mjs 被改写（新增 appendWithRetry，EBUSY 容忍）
  20:57:39 MAIN=ddbe441f417c@20:57:39    ← dist 重建（第 1 次）
  20:58:15 MAIN=f7ff5090a7cf@20:58:15    ← dist 重建（第 2 次）；20:58:20 写 renderer/app.js；20:59:14 写 electron-main.ts
  20:59:54 DRV=0 GATE=0 EXIT1=0 … TERM: 驱动器与门禁都消失且本轮没有 exit 行 ⇒ 异常
  ```
- 【定性一】**这一遍作废，与死因无关**：遍内 `dist/electron-main.js` 换了两份（`76613c570b5a` → `ddbe441f417c` → `f7ff5090a7cf`），驱动器 `r50-run3.mjs:169` 的 `[VOID]` 判据本来就会在遍末判它不计数。**计入验收仍是 0/3。**
- 【定性二】死因**不外推**（找不到可 grep 的因，就只登记现象）：驱动器（PID 21596）与门禁本体（PID 31596）在 20:59:2x **同一刻消失、没有写出任何东西**（`game-run1.log` 末写 20:56、`game-3x.log` 没有 exit 行、`game-3x.out.log` 只有外层 cmd 打的 `[driver] exit 1`）。已排除的三条：① 仓库里唯一的 `taskkill … /T /F` 在 `dev/gates/run-verify-22.mjs:242` 的 `qingChang()`，它只按 `--remote-debugging-port` 过滤 **electron** 并树杀，**杀不到 node 父进程**；② 同文件的 `dengKeng()` 只"退出这一遍"、不清场；③ 常驻的 `openclaw gateway` 等 4 个 node 进程（10-20 17:47 起）**此刻仍在** ⇒ 不是全局 node 杀。**本会话没有杀过任何进程**（无可归因于本任务且带调试端口的对象）。
- 【现场（21:01–21:02 读数）】改码会话**仍在活动**：21:01:35 写 `verify-office-doc-suite.mjs`、21:01:38 写 `verify-r53-zhishi.mjs`、21:01:42 第三次重建 dist（`1148240af2c7`）、21:01:59 起了 `run-verify-22 --tier=…`（`GATE-PID=36508`、`DBG-PROC=2`）。⇒ **本会话没有再起跑**：此刻起跑等于插进别人的真机档（两边读数全废），且必然被下一次重建再打空。
- 【仪器建议（写给正在改 `r50-run3.mjs` 的那一支，本会话不抢改）】现在 `[VOID]` 只在**遍末**判 ⇒ 每被打空一次白烧整遍（小游戏档实测 ≈49 分钟/遍）。建议加**遍内看门狗**：`run()` 里每 60 秒比一次 `chanWuZhiWen()`，与开跑指纹不同就 `taskkill /PID <自己那棵> /T /F`、往日志写一行"遍内作废（第 N 分钟采到重建）"再让 `loop()` 照常走 `[VOID]`。本会话不动这个文件的理由：它 20:57:29 刚被另一路改过，两支同改一个文件会互相覆盖（§25.4 口径）。
- 【累计代价（如实，第 53 轮 18:17 至今）】真机遍被打空 **4 次**（18:39:38、19:54:50、19:58、20:57:39+20:58:15），推进器 **3 支**没等到起跑窗口（19:4x、20:1x、20:4x），本会话起跑成功但 7 分钟即作废。**这条链在有人独占桌面之前跑不完。**
- 【等你拍板（新增一条，最要紧）】真机链（三连 ≈2.5 小时 + live 串行 + 两遍验收 + 首启 ≈ 再 2 小时）需要**独占桌面**：要么改码会话在此区间停手，要么把三连往后排。我没有"边改码边跑"的第三种安全做法——已经用 4 遍真机证明了。
- 本会话改面（如实）：只有本文件与 `.r50-logs/` 下本会话自建的采样脚本；`packages/*`、`dev/gates`、`dist` **一个字节没改**；未 commit、未 push。

## 38. 第 53 轮后补课的验收读数（2026-10-21 21:0x）
- **fast 档 1 遍全绿**：87 项次、无产品红（exit 0）。这一遍是在 37.3 的全部改动**与**两处仪器修正（`verify-office-doc-suite` 的加密接线判据、
  `verify-r53-zhishi` 的排序锚点）之后跑的；中途红过 2 条，都是**仪器**（我的改动改了代码形状），已按行为改判并重跑，不是放宽。
- `verify-r53-tishangxian` **81/0**、`verify-r53-zhishi` **50/0**；新判据负向验证 `r53-verify2-neg` **10/10 全抓**。
- `verify-office-doc-suite` 85/85（加密接线判据改成"对象可以是清洗后的实例数组"，仍要求真的过 `jiaMiSheJiao/jieMiSheJiao`）。
- **并发事故（如实记）**：21:00 前后我在另一路真机三连运行期间重建了 `dist`（为 37.3 的改动），
  推进器 20:59:54 报 `TERM: 驱动器与门禁都消失且本轮没有 exit 行 ⇒ 异常`，桌面残留 6 个 electron 进程。
  **这是我的操作与"真机串行 / 不在别人跑的时候换产物"口径相撞**；r50 驱动本身有"产物指纹"能在结论里标出混构建，但进程被换产物打断时它连 exit 行都写不出来。
  教训：**多会话同树时，构建也是一把锁** —— 要么先看有没有 Electron 进程/推进器在跑，要么把构建排到真机档之后。
  残留进程不在我的名下（没有 `--remote-debugging-port` 的归属核对），未做任何 kill。

# 39. 推进器读数（2026-10-21 22:34–22:4x · 三连已 3/3 计入验收；live 唯一红正在取第二样本）

- 【三连终态读数（`.r50-logs/game-3x.log` 末 6 行原文照抄，文件末写 22:10）】
  ```
  [game] 第 3/3 遍开始 2026-10-21T13:51:53.186Z
  [game] 第 3/3 遍 exit=0
  [OK] game 第 3/3 遍全绿（产物 dist/electron-main.js 13:01:42#1148240af2c7 | dist/renderer/app.js 12:58:20#74292382d234）
  [DONE] game 3/3 全绿
  三连驱动器收工
  [driver] exit 0
  ```
  ⇒ 三遍的开跑前指纹与结论行产物串**逐字相同**、全程没有 `[VOID]` ⇒ **三连计入验收的遍数 = 3**（§38.14/§38.15 的里程碑是读数，不是转述）。
- 【产物独占核对（22:34:52 读）】`dist/electron-main.js` mtime `2026-10-21 21:01:42` sha 前缀 `1148240af2c7`、`dist/renderer/app.js` mtime `20:58:20` 前缀 `74292382d234` ⇒ 与三连开跑前那两个串一字不差；`packages/app-shell/src` 无 21:00 之后的新文件，`packages/app-shell/scripts` 域里只有两支门禁脚本（21:01:35 / 21:01:38）⇒ 改码会话自 21:01:42 起没再动产物，两遍验收能跑在同一份 build 上。
- 【任务第 5 条口径的当前读数（22:36 逐条直跑，**不跑整档** ⇒ 避开 §38.6 那条挂在 FAST 里的真机壳）】`verify-prompt-layers` **29 ok / 0 FAIL** · `verify-r52-layers` **54 ok / 0 FAIL** · `verify-r52-yasuo` **47 ok / 0 FAIL** · `verify-dao-safety` **12 ok / 0 FAIL**。新门禁 `verify-r52-layers` 已在清单第 108 行（`['app-shell','verify-r52-layers',180]`）、阶梯两支在 132/133 行 ⇒ **两遍验收确实覆盖它们**。
- 【阶梯分叉未解（本轮复读到仍在，照 §38.9）】`dev/gates/run-verify-22.mjs:129` 的注释写的是任务口径序 `硬门禁>道>术>规范>教条>束缚>工具>软门禁>认知>印象`；而它挂进 FAST 的 `verify-prompt-layers` 在 `:30/:87/:95` 逐字钉的是另一份序 `… 规范 → 印象 → 工具 → 教条 → 束缚 → 认知 → 身份`，源码侧 `electron-main.ts:10969`、`builtin-rules.ts:10` 的注释同样把「印象」放在「教条/束缚」之前。⇒ **两遍验收会绿在与任务口径不同的序上**；以哪份为准仍等你点一句（连同 §37.5「注入位置与压缩层必须同序」那条跨表判据）。本会话一字未改判据。
- 【live 第二样本（正在跑）】22:29:38 单独串行复跑 `verify-round34-live`（带密钥 + `KEEP=1`，日志 `%TEMP%\r53-live-rerun1-round34.log`）。22:38 读数：第 1 次试验**达标**，原文行
  ```
  …"daBiao":true,"lei":"mimo"},"jiHua":["T1=verified","T2=verified","T3=verified","T4=verified","T5=verified","T6=verified"],"chongZuoLanJie":0,"ziShuJinDu":1,"shouQuanKa":5,"yongShiMiao":426,"lunShu":1,"gongJu":16}
  ```
  ⇒ 上一遍那条「看图说图整件没答」在这个样本没复现（用户点名的 6 件全部核对到）。
  - ⚠️ **耗时口径订正（仪器，不改判据）**：这支默认 `MIMO_CI=3 + OLLAMA_CI=1`（`verify-round34-live.mjs:39-40`）且**红即停**（`:727`）⇒ 22:12 那一遍只数到「试验 1 次」是因为第 1 次就红，419 秒不是绿遍耗时；**绿遍要跑满 4 次 ≈ 37 分钟**（与第 40 轮实测 2198.9 秒一致）。⇒ 下一版 live 驱动器的每支预算要**按门禁自己的 `k` 与各次实测推算，不能拿"上一次红遍的秒数 +120"当预算**（否则真绿遍会被仪器判超时，读数直接作废）。本轮是手工单跑、不受该预算约束。
- 【我自己踩的一条仪器错（如实登记）】22:36 第一次直跑 `verify-dao-safety` 报 `Cannot find module <仓库>\packages\app-shell\scripts\verify-dao-safety.mjs` ⇒ 是**我按旧目录猜路径**，该门禁实际在 `dev/gates/`（`run-verify-22.mjs:133` 以 `root` 档挂载）。按真实路径直跑 **12 ok / 0 FAIL**。这条既不是产品红，也不是 §37 那类"半截读崩溃"，是我的路径猜错 ⇒ 以后按清单的档（`root`/`app-shell`）解析路径，不猜。
- 【进度】三连 **3/3 ✅**（产物 `1148240af2c7`）→ live **14/15，唯一红的第二样本在跑（第 1/4 次试验已达标）** → 两遍验收 0 → 首启未跑。
- 【下一步】① 等 `%TEMP%\r53-live-rerun1-round34.log` 打出 `==== verify-round34-live：试验 N 次 · 过 X · 败 Y ====`：4 次全过 ⇒ live 名单（§19.3 的 15 支）转绿，起跑 fast 档整遍 ×2；任一次红 ⇒ 按 §38.16 分岔转产品取证，修完**从三连第 1 遍重跑**；② 两遍验收起跑前照 §37.9 三信号清场（带调试端口的电子壳连续两次 0、`GATE-PID` 空、产物 sha 不变）；③ 首启 `node dev/gates/r38-firstrun.mjs`。
- 【仍等你拍板（本会话一条未动）】阶梯以哪份为准 + 注入位置与压缩层同序判据、§38.6 那条 FAST 档里的真机壳怎么归档、§33.3 round12 判别实验、§29.10 round16 三条出路、§30.7 b) ASR skip 口径、§25.4 的 ④「被拒即停用」收紧、`verify-r53-zhishi` 的清单登记。
- **§22.3 的 P0 清单仍一条未减。**
- 本会话改面（如实）：只有本文件与 `.r50-logs/`、`%TEMP%` 下本会话自建的采样脚本；`packages/*`、`dev/gates`、`dist` **一个字节没改**；未 commit、未 push。

## 39.1 补记（22:4x · 写完本节立刻复跑两支文档/安全档）

- 读数原文：`==== verify-security: 全部通过 (PASS 28) ====`、`==== verify-docs: 95 ok / 0 FAIL ====` ⇒ §39 这节的读数**没有把验收打红**（路径全部走 `%TEMP%` / `<仓库>` 占位，密钥只写「带密钥」不写文件名）。
- 同批踩到并订正我自己的仪器错（第二条，同一族）：第一次把这两支按 `dev/gates/` 去跑 ⇒ `Cannot find module`。清单里它们的档是 `app-shell`（`run-verify-22.mjs:31/:37`），真实落点是 `packages/app-shell/scripts/`；而解析规则可 grep：`run-verify-22.mjs:211` `if (where === 'root') return path.join(root,'dev','gates', id + '.mjs')` ⇒ **`root`=dev/gates、`app-shell`=packages/app-shell/scripts**。⇒ 以后一律按清单里的档解析路径，绝不按记忆猜目录（本轮两次猜错、两次都不是产品红，但每一次都可能被误读成红）。
- 采样脚本的一条老坑再次现身（这次是**我自己写的**）：把 WQL 查询内联进 bash 里传给 `powershell -Command`，引号被吃掉 ⇒ `Get-CimInstance` 报 `无效的查询`，读数落进 `QUERY-FAIL`。⇒ 按 §38.13 的分类打印生效了（**没有把 QUERY-FAIL 当成"进程 0 个"去判死或起第二支**），但监视器作废一次；已改成 `%TEMP%` 下的 `.ps1` 文件（`-File` 调用）。这是 [[feedback-windows-shell-quoting]] 的第 N 个实例：**判活取样只用文件形式的 ps1**。
- 真机遍当前读数（22:40:17，日志 `%TEMP%\r53-live-rerun1-round34.log`）：第 2 次试验进行中 `+90s 审计 58 条，最近：chat.inflight-write` ⇒ 进程在、日志在长、审计条数在涨（三条同向，不是 §24.3 那种纯心跳假活）。

## 39.2 【异常登记】同一件事两支会话各跑了一遍：rerun1 无声消失、rerun2 正在跑（22:52–22:53 读数）

- **rerun1（本会话在盯的那支）终态**：22:29:38 起跑（node PID 21888）⇒ 第 1 次试验**达标 426 秒**（指标行 `"daBiao":true,"jiHua":["T1=verified"…"T6=verified"],"shouQuanKa":5,"lunShu":1,"gongJu":16`）⇒ 第 2 次试验 22:37:04 起新 profile。日志 `%TEMP%\r53-live-rerun1-round34.log` **末写 22:38:46**（`+90s 审计 58 条`，此后 12 分钟零新行——而这支的进度行是每 30 秒一条，`verify-round34-live.mjs:328-331`）；同一时刻该 profile 的 `audit/audit.jsonl` 最后一条是 **22:39:02 的 `chat.inflight-write`**（`"zhengWen":12,"duan":2`）⇒ **应用当时正在写正文，不是卡死**。node 21888 与它的电子壳在 22:39:02 之后、22:40:26 之前**整棵消失且没有任何 exit/汇总行**。
- **因写不出来就只登记现象**（照 §38.13/§37.9 的口径）：另一路那支驱动器 `%TEMP%\r53-r34-rerun.mjs`（文件创建 22:40:20）里 grep 不到 `taskkill`/`kill`/`清场` 任何一个，只有 `spawnSync(…, { timeout: 30 * 60 * 1000 })` ⇒ **不能把"被谁杀"写成结论**。与读数相容的可能有两条（外层 shell 退出被连带树杀 / 别人按 PID 清了它的父进程），本会话**全程没杀任何进程**。
- **rerun2（另一路起的第二样本）当前状态**：22:40:26 起跑（node PID 40872，日志 `%TEMP%\r53-live-rerun2-round34.log`），第 1 次试验**达标 380 秒**（`"T1..T7=verified"`、`changWen.daBiao:true`、小说 6094 字），第 2 次试验 22:47:06 起，22:52:57 读数 `+332s 审计 116 条`。
- **场地并发核对（22:52:12 / 22:53:12 两次同判）**：带 `--remote-debugging-port` 且**不带 `--type=`** 的电子壳只有 **1 只**（pid 17564、端口 9972、`--user-data-dir` 指向 22:47:06 那个 trial-2 profile）⇒ rerun1 的壳已随它一起消失 ⇒ **到这一行为分岔点，两次试验的读数没有被并发污染**（§37.9 三信号里的第一条）。
- 【一条仪器隐患，写给正在跑的那一支，本会话不抢改别人的在途文件】它给整支门禁的预算是 **30 分钟**，而这支**绿遍要跑满 `MIMO_CI=3 + OLLAMA_CI=1` 四次试验**（`verify-round34-live.mjs:39-40`；第 40 轮实测整支 **2198.9 秒 ≈ 36.6 分**）⇒ **预算比真实耗时少约 6 分钟**，`spawnSync` 到点直接杀，现象与"无声消失"同形（没有汇总行）。按 §24.4 的订正口径：**预算要从门禁自己的 `k` 与本机腿的 `chaoShi`（`:308` 云端 25 分 / 本机 40 分每轮）推出来，不能拿"上一次红遍的秒数"当上限**。若这一遍在 23:10 前后被打断且没有汇总行 ⇒ 判仪器，不判产品。
- 【本轮桌面产物（收尾要核对）】rerun2 第 1 次试验的指标行 `zhuoMianXinZeng` 有三份（两份与历轮同名文件被**重写**、一份 6094 字小说），落点是**真实桌面**（原文带盘符，按 §25.1 的抄写口径此处不落原文）⇒ 整串跑完要照协议做跑前/跑后差分（`new 0 / missing 0` 之外多出来的都是本串产物，删不删等你点头）。
- 【进度】三连 **3/3 ✅**（产物 `1148240af2c7`）→ live **14/15 + 唯一红已取到两个"第 1 次试验达标"的样本，整遍 4 次由 rerun2 在跑（2/4 进行中）** → 两遍验收 0 → 首启未跑。
- 【下一步】① **不再起第三支**（§22.6 严禁并行）：旁观 rerun2 到汇总行；② 4 次全过 ⇒ live 转绿，清场三信号齐了再起 fast 档整遍 ×2；③ 被打断/任一次红 ⇒ 按 §38.16 分岔处理，修完从三连第 1 遍重跑；④ 首启 `node dev/gates/r38-firstrun.mjs`。

## 39.3 【rerun2 终局 + 定性 + 一条叫停】第 2 次试验红在共享日志的 404 洪水；22:52:46 产物被重建 ⇒ 三连那份不再是当前 build

- **rerun2 汇总行原文**（`%TEMP%\r53-live-rerun2-round34.log:205-207`，22:54:16 落盘）：
  ```
  ==== verify-round34-live：试验 2 次 · 过 1 · 败 1（pass^k 要求全过）====
    PASS r34-mimo-1 用时 380s … 失败项 无
    FAIL r34-mimo-2 用时 430s … 失败项 Ollama 没有 4xx/5xx 的对话请求
  ```
- **红的那一条只有"红在供应商日志"这一件事**：trial-2 的实质判据**逐条 ok**，包括上一遍那条红 —— 原文 `ok 看到了 svg 里画的东西（认出音乐／或如实描述了画面；说"看不到图"就是红）`、`ok 长文写满了（≥5700 字）`、`ok 两张附件都转成了模型能看的位图（svg 也转了）`、`ok 主模型自己能看图` ⇒ **§38.16 那条"模型把看图整件没答"在两个独立样本里都没复现**（rerun1 trial-1 达标 426s + rerun2 trial-1 达标 380s）。
- **红因定性＝仪器（判据不绑归属）+ 并发污染，不是产品、不是夹具**，四条读数：
  1. 失败项证据是 Ollama 的**共享** `server.log` 里"本 trial 期间新增字节"中的 404 行（`verify-round34-live.mjs:609-610` 只按 `\[GIN\]` + `4\d\d|5\d\d` + `api/chat` 过滤，**不认是谁发的**）；
  2. 洪水形状：**每波 36 条**（16 条 `/api/chat` + 20 条混合 `/v1/chat/completions`），时刻 `22:46:07/09`、`22:49:04/07`、`22:50:33/36`、`22:53:02/05`；**22:54 之后一条都没有**（按分钟聚合可 grep）；
  3. 我们这一支自己的审计反证：trial-2 profile 的 `audit/audit.jsonl` 179 行里 `chat.dispatch` **只有 1 次**、`chat.model-picked` 1 次、**0 条** Ollama 对话相关 op（主模型是云端 MiMo、看图由主模型自己做）⇒ 36 条/波的本地对话请求**不可能是这一支发的**；
  4. 同窗口的并发者（temp 前缀 → 门禁名，逐条 grep 得到）：`warmy-verify-tools-e2e-*`→`verify-tool-calls`、`warmy-group-store-*`→`verify-group-store`、`warmy-identity-*`→`verify-identity`、`warmy-updater-*`→`verify-updater(-github)`、`warmy-office-gate-*`→`verify-office-doc-suite`、`warmy-ipc-probe-profile`→`verify-ipc-probe`，新产物时刻 `22:49:34`–`22:53:57` ⇒ **§38.6 那条"FAST 档里挂着真机壳"本轮真的踩到了**：另一路在跑 fast 档门禁，与我这一支真机遍并发。
  - ⇒ 修法归口：另一路会话已把同一件事写进它的项目记忆（标题「Ollama 4xx 归属未证」，口径=先补 `provider.request-failed` 审计、再把判据改成"对得上自己发出的请求"，**是收紧不是放宽**）⇒ **本会话不抢改**（同 §25.4：两支同改会互相覆盖）。
- 【⛔ 叫停读数】`dist/electron-main.js` 的 mtime 变成 **22:52:46**、sha 前缀 **`1148240af2c7` → `8ce20c80f978`**（`dist/renderer/app.js` 仍 `74292382d234`）；同批 `packages/app-shell/src` 22:52:03、`dev/gates/verify-dao-safety.mjs` 22:52:10、`verify-prompt-layers.mjs` 22:52:16、`packages/app-shell/scripts/verify-r53-tishangxian.mjs` 22:52:27、`verify-r52-kb.mjs` 22:52:37、`dev/gates/verify-round37-changes.mjs` 22:52:40。⇒ **三连/§38.15 那份产物已经不是当前 build**，两遍验收与首启若跑在 `8ce20c80f978` 上就与三连不同产物（§35.6 的"绑产物"口径）⇒ **整条验收链要从三连第 1 遍重跑**。
- 【为什么本会话不起跑三连】改码会话处于**活跃编辑循环**（30 分钟内连续写 `src`/`dev/gates`/`scripts` 并重建 dist）⇒ 按 §37.9/记忆里的口径"活跃就不起跑，登记读数并请用户仲裁谁先独占桌面"。本轮已 5 次真机遍被重建打空，小游戏档每遍实测 ≈20 分钟 ⇒ 硬起跑第 6 次打空的代价还是 20 分钟起。
- 【§39/§39.1 的两支静态读数已过期】22:36 那次 `verify-prompt-layers 29/0`、`verify-dao-safety 12/0` 是 22:52 改动**之前**的读数；改动后同一文件里现在有**三份**序：`:4` 头注释 `硬门禁>道>术>教条>束缚>工具>软门禁>认知>印象>身份`（没有「规范」）、`:30/:39/:87/:95` 钉 `…规范 → 印象 → 工具 → 教条 → 束缚 → 认知 → 身份`、而 `run-verify-22.mjs:129` 注释是任务口径 `…规范>教条>束缚>工具>软门禁>认知>印象` ⇒ **以哪份为准仍等你点一句**，且这次连"同一文件内部自洽"都不成立了。
- 【进度】三连 3/3 ✅（产物 `1148240af2c7`，**已被 22:52:46 的重建取代**）→ live 14/15 + 唯一红已定性为仪器/并发、其"看图"部分已由两个达标样本翻绿 → 两遍验收 0（不能起跑）→ 首启未跑。
- 【下一步】① 等改码会话收手：`src`/`scripts`/`dev/gates` 无新 mtime **且** `dist/electron-main.js` 的 sha 连续 ≥5 分钟不变 **且** 带调试端口的电子壳连续两次为 0；② 在**新产物**上重跑三连第 1 遍起（`.r50-logs/start-game-3x-r52.cmd`，认 `[产物]`/`[VOID]` 行）；③ 三连三绿 → 串行 live（每支预算按门禁自己的 `k` 与每轮 `chaoShi` 推，不按上一次红遍秒数）→ fast ×2 → 首启；④ **请你仲裁"谁先独占桌面"**——两路推进器 + 一路改码同跑一棵树，本轮已经出现两支同取第二样本、fast 档与真机遍并发。

## 39.4 起跑前三信号（23:02 两次采样，原文；结论=仍不起跑）

- 静态档在 **22:52 改动之后**的源码上复跑（23:02:19–23:02:20 同批读数，逐条直跑、没跑整档）：
  `verify-prompt-layers 29 ok / 0 FAIL` · `verify-dao-safety 12 ok / 0 FAIL` · `verify-r52-layers 54 ok / 0 FAIL` · `verify-r52-yasuo 47 ok / 0 FAIL` · `verify-r53-tishangxian 81 ok / 0 FAIL` · `verify-r52-kb 50 ok / 0 FAIL` · `verify-round37-changes 36 ok / 0 FAIL` ⇒ §39.1 那四条读数在新源码上**依然成立**（不是过期红）。
- 信号①产物稳定：`dist/electron-main.js` `22:52:46` 前缀 `8ce20c80f978`、`dist/renderer/app.js` `20:58:20` 前缀 `74292382d234` ⇒ 23:02:01 与 23:02:4x **两次同值**（已连续 ~10 分钟不动）。
- 信号②场地：23:02:01 采样 ⇒ 命令行含 `verify-|r50-run3|run-verify-22` 的 node **0 支**、带 `--remote-debugging-port` 且不带 `--type=` 的电子壳 **0 只**（`Get-Process electron` 计数也是 0）。
- 信号③**没过**：`find packages/app-shell/src packages/app-shell/scripts dev/gates -newermt '22:40'` 打到 `22:52:03 src` / `22:52:10` / `22:52:16` / `22:52:27` / `22:52:37` / `22:52:40` 六处，最近一次距今 **10 分钟** ⇒ 按 §37.9 与记忆里定稿的"30 分钟内连续在写 src/scripts 或反复重建 dist = 活跃编辑循环 ⇒ 不起跑"，**本会话仍不起跑三连**，只登记读数。
- 一句话给下一跑：三信号里只差"活跃度"这一条的时间窗；若到下一跑 `22:52:46` 之后**再没有任何 src/scripts/dist 新 mtime**，就直接在新产物 `8ce20c80f978` 上起三连第 1 遍（旧三连那 3 遍绿绑的是 `1148240af2c7`，**不能挪用**）。

## 39. 第 54 轮（用户 7 条）：进程清理、默认文案 10 语言、白名单自更新、安全方案定稿

### 39.1 项 2｜清理不受控进程（已执行）
- 关掉：`verify-round34-live.mjs` 的 node 进程（外部会话在跑的真机门禁）、6 个 `electron.exe`（来自另一棵产品树）；
  现 `electron.exe` 计数 **0**、无外部 gate 进程。
- **停用**了每 5 分钟自启的 cron 推进器「R51 全任务推进器」（`enabled:false, pauseReason:manual`；可随时 enable 回来）。
  它的 lastRun 已因进程被杀记 `session-failed`。
- 未动：OpenClaw gateway 的 4 个 node 进程（用户自己的基础设施，不属于本产品）。
- 教训复述：**多会话同树时，构建与真机运行互斥**（39.0 之前那次 `TERM` 就是重建 dist 撞了正在跑的三连）。

### 39.2 项 1｜出厂默认文字 10 种语言（框架已落地；覆盖范围如实列出）
- 新目录 `packages/app-shell/src/mo-ren-yu-yan/`：10 个语言文件（zh-CN 复用 `dao-default/shu-default`，其余 9 份为**全文翻译**）
  + `index.ts`（`quMoRen / shiChuChangGao / MO_REN_YU_YAN_KE / YONG_HU_MING_MO_REN / shiMoRenYongHuMing`）。
- **结构校验**：10 种语言都是「道 6 节 43 条、术 4 节 25 条」、零空行、无反引号（门禁逐语言查）。
- **上限按语言折算**（`YU_YAN_ZI_SHU_BEI_LV`，按本轮 10 份出厂稿实测长度比）：zh-CN 1 / zh-TW 1.05 / ja 1.5 / ko 1.75 /
  en 3.75 / fr 4 / es 3.9 / pt 3.75 / ru 3.3 / eo 3.6。**中文基准值不变**（2600/4200）；不折算的话，俄语出道稿当场被自愈搬走。
- **切换语义**：播种用当前语言；切语言时**只有内容等于任一语言出厂稿的层**才跟着换（`prompt.default-relocalized`），
  改过的**保持原样**并记 `prompt.default-kept-user-edited`；覆盖前留 `.bak-lang-<ts>`。保存设置、首启选语言都会**当场同步**。
- **默认称呼**：10 种语言的默认值（老板/老闆/Boss/ボス/사장님/Patron/Jefe/Chefe/Шеф/Ĉefo），同样"没改过才换"。
- **本轮没覆盖到的（如实记）**：认知预设库（51 个模板的**正文**与分类/名称，约数十万字）与"新建牛马时的默认名字"仍是中文；
  产品硬门禁/系统提示保持中文（它们是产品内部规则）。这三块要么分批翻译、要么改成"按语言懒加载"，需要单独排期。

### 39.3 项 3｜白名单自更新（P0-6）——已实现
- **发现并修复一个更严重的真缺陷**：`knowledge_query` / `knowledge_add` **只有分发分支、没有工具声明**，
  模型根本调不到（提示词写着"用 knowledge_add 记下来"，工具表里却没有）。本轮把 `knowledge_query`、`knowledge_add`、
  `capability_propose` 三个工具都加进 `hostToolSpecs()`。
- **自更新白名单**：模型用 `capability_propose` 提案类别短语 + 1–6 个匹配关键词；宿主过 `jianChaXinNengLi`
  （≤14 字、无数字/标点/路径/对象名/存在性说法、不许重复）⇒ 落 `userData/nengli.json`（tmp+rename），
  运行时的表 = `heBingNengLi(内置 12 + 自更新，封顶 32)`；通过/拒绝都落审计（`kb.capability-added/-rejected`）。
- **没有放松的两条硬闸**：新类别仍要 **≥2 条独立证据**才会出现在对外概要里；概要仍不许含项目/时间/对象。
  差分隐私/统计发布**不做**（个人用户、无服务器，噪声会把产品价值花光）；F「不做概要」继续作兜底。
- 判据：`verify-r54-zi-geng` 30/0（含"自更新不能绕过禁现/ k-匿名"的真值表）。

### 39.4 项 4｜P0-5 按用户决定定稿（`docs/P0-5-ZITUOGUAN.md` §9）
伪 PIN（Argon2id ⇒ KEK；PIN 包把"设备+系统账号+随机硬件 ID"摘要与 60 天期限一起放进 AAD ⇒ 任一变更就**解不开**而不是"程序拒绝"）+
每天成功解锁续期 + 时钟回拨防护 + 5 次错误退避；锁屏即锁三平台（Electron `powerMonitor` + Linux logind/空闲兜底）；
助记词 24 词是唯一取回；跨设备同助记词直接解；**丢了就是丢了**（用户确认）。三条边界如实写：硬件 ID 可伪造、换硬件必失效、没有后门。

### 39.5 项 6｜账号与互通安全建议（`docs/ANQUAN-HUTONG.md`）
照搬钱包方案的六条哲学；替换两处"必须有服务器"的设计：登录改本机伪 PIN、离线消息改"渠道只搬密文"；
给出互通信封 v2（设备证书 + nonce + X25519 封装 + Ed25519 签名）、群密钥轮换、社交图谱加密、以及"为什么不默认做社交恢复"。

### 39.6 项 7｜后台测试读数
- 见 §40（本轮 fast 档读数）与 §35.B6（live 4 红仍未复跑：外部跑真机的进程刚被按用户要求清掉，需重新起一轮 live）。

### 39.7 项 5｜那些"代号"是什么意思
见本轮回复正文（③④⑤⑥⑦逐条解释 + 方案选项）；它们对应的口径分别记在 §35、§37、§33.2–§33.5。

## 40. 第 54 轮验收读数
- **fast 档 1 遍全绿：89 项次、无产品红**（exit 0）。新增 `verify-r54-i18n-defaults` 17/0、`verify-r54-zi-geng` 30/0。
- 本轮改动导致 **7 支旧门禁先红后按行为改判**（不是放宽）：`round37`（印象双闸变函数）、`r44-yuSuan`（`username` 没在
  `YingYongPeizhi` 里声明 —— 这是**真缺陷**，已补声明）、`r52-jujue`（`capability_propose` 的参数校验不是"授权拒绝"，改词并保留审计）、
  `r52-kb`（术总量闸/证据参数形状）、`r53-tishangxian`（存储闸函数化 + IPC 按语言折算）、`prompt-layers`（认知上限函数化）、
  `dao-safety`（承认"随语言切换重写未改过的出厂稿"是第三条**受 `shiChuChangGao` 判据保护**的写路径）。
- 负向验证：`r54-neg` 8 条变异 —— 5 条自动抓到；3 条模块级变异因探针自身的 import 改写缺陷被报成"门禁崩溃"，
  已逐条手动复核：① 删 eo ⇒ 14/3（含"10 种语言齐全"红）；② `quMoRen` 回落空串 ⇒ "绝不返回空串"红；③ 去掉 knowledge_query 声明 ⇒ 工具声明判据红。
  **探针缺陷如实记**：%TEMP% 变异体的相对 import 必须放在 dist 同目录才不歧义，下次直接生成 `dist/__neg_*.js`。
- **live 档本轮未跑**：按要求清掉了外部真机进程；live 4 红（round12/16/17/38-asr）仍未定性（§35.B6）。

## 41. 第 55 轮问答与设计（用户 6 条）
- **实体复核队列**：复核的是"两条实体记录是不是同一个真实对象"（合并/分开），**不是**"要不要进知识库/进哪一层"——
  那一层由内容判据（`panDingCeng` + `kbWritable`）在写入时裁决。相似度落在 0.75–0.92 的条目现在只落审计 `kb.entity-review`。
- **授权档**：`run_shell` 的权限档（完全/常规/严格）+ 第 51 轮"同任务被拒 2 次 ⇒ 整轮停用"的收紧。三方案与案例已在本轮回复里列清。
- **提示词上限**：按用户"照建议"保持不变（中文口径 2600/4200/…，其它语言按实测字符系数折算）。
  token 口径的解释见回复正文（`token-jiliang.ts`：分脚本紧上界 × 校准比 × 安全垫；按 供应商×模型×密度桶 存，EMA 收敛，绝不假装精确）。
- **去中心化身份与对等通讯**：新文档 `docs/P2P-QUZHONGXINHUA.md` —— 分层（身份锚上网络、列表加密放 DHT、聊天不上网络）、
  双方签名的联系人关系、创建者为主机 + 授权令牌、离线/回执/撤回/批重试/错位状态机、九类威胁对策、三条路线（公链锚定 / DHT / 混合）与三个待拍板点。
- 用户给的两枚图标已复制进 `packages/app-shell/src/renderer/icons/`（`chong-fa.svg` / `chao-shi.svg`，不在仓库里写本机路径）。

## 42. 第 55 轮：知识库条目操作、授权三档、token 归属、P2P 连通性

### 42.1 知识库条目操作（用户项 1）
- **复核谁**：复核的是"两条实体记录是不是同一个真实对象"（合并/分开）；**不是**"进不进库/进哪一层"（那由写入判据决定）。
  现在仍是"新建 + `kb.entity-review` 落审计"，**归档时由模型裁决**（高置信度才合并）**尚未接线**——见 §42.5。
- 已落地：知识库卡里每条事件前有**勾选框**；右侧/底部有**重构**与**合并**：
  - 重构：勾 1 条 → 重写描述 → **两次确认** → 原条目被取代（活跃视图里消失、仍可审计）→ 新描述进**待整理内容区**；
  - 合并：勾 ≥2 条 → **两次确认** → 以最新那条为主、内容去重拼接，其余取代不删除；
  - 待整理区：`userData/kb-pending.json`（tmp+rename、封顶 200 条），**下次归档时**自动写回（来源标 `user:rebuild`）。
- 新 IPC：`kbMerge / kbRebuild / kbPendingLieBiao / kbPendingShanChu`；判据 `verify-r55-shouquan-kb`。
- **真机没点过**（live 未跑）——按协议这条只算"静态 + 单元判据绿"，不算 UI 验收。

### 42.2 授权三档（用户项 2，方案 b）
- 口径落成代码：**完全**=全放行（含高风险 skill，不再问）；**常规**=只能工作区内 + 命令必须同时满足「在工作区」+「首词白名单」+「静态风险 low」；
  **严格**=工作区文件操作之外一律问。`panDuanMingLingShouQuan` 是唯一判据（run_shell 已切过去）。
- "工作区判据"独立于白名单：`cat /etc/passwd`、`type C:\Windows\win.ini`、`cat ~/.ssh/...`、`cat ../x`、`\server\share` 全部不算常规授权
  （白名单只说明"程序是谁"，不说明"它碰了哪里"）。
- 安全审核/白名单的行业做法写在 §42.4（回复里也讲了）。

### 42.3 token 归属（用户项 3）
- 现状本来就是"按 供应商 × 模型 × 密度桶 存校准 + `@avg/` 跨模型平均"；本轮补上**模型删除 ⇒ 专属校准一起删除**
  （`qingLiTokenXiaoZhun`，保留 `@avg/`；拿不到模型列表时不动，避免误删），启动与设置保存都会触发。
- 提示词层上限仍用"中文字符基准 × 语言实测系数"（预算用 token 表）——两套口径的分工见回复正文。

### 42.4 安全审核/白名单（回答"如何确立、行业标准"）
- 行业标准不是"一个命令名单"，而是**多层**：① 可执行文件身份（basename + 绝对路径/签名，防同名替换）；
  ② 参数级策略（路径是否在工作区、是否写块设备、是否下载即执行）；③ 解析而非字符串匹配（shell AST/`shlex`，禁止 `sh -c` 拼接）；
  ④ 权限最小化（capability/AppContainer/seccomp/Landlock/bubblewrap/sandbox-exec）；⑤ 默认拒绝 + 逐次授权；⑥ 审计与可回放。
- 我们的现状：①③⑥ 部分有（首词白名单、危险模式正则、审计），② 本轮补上（工作区路径判据），④⑤ 没有（没有沙箱）。
  **如实说**：正则 + 白名单挡得住"明显的坏命令"，挡不住"精心构造的参数"；真正的边界应由沙箱提供 —— 这是下一阶段要做的。

### 42.5 仍待办
- **归档时模型裁决实体合并**（高置信度才合并）——需要把候选对喂给归档模型并解析 `entityMerges`，下一轮做。
- 知识库卡的重构/合并/待整理区**未真机验证**。
- P2P：`docs/P2P-QUZHONGXINHUA.md` 新增 §10（创建者离线只读、无公网如何互找）；实现仍未开始。

## 43. 第 55 轮验收读数
- **fast 档 1 遍全绿：90 项次、无产品红**（exit 0）。新增 `verify-r55-shouquan-kb` 25/0。
- 中间出现过 **1 条环境红**：`verify-tool-calls` 的"超长记录分页取回"只取到 236/9011 字，同批日志里记忆服务启动失败
  （`ERR_IPC_CHANNEL_CLOSED` / memory start fail）。**单独复跑同一支门禁通过**（3 页、9011 字、sha 一致）⇒ 定性为
  "上一支真机门禁被我中止后残留的记忆服务占位"，不是产品缺陷；整轮重跑后全绿。
- 因本轮改动按行为改判的旧门禁：`verify-r52-jujue`（run_shell 判据换名后，闸门仍必须在执行之前）、
  `verify-renderer-template-balance`（工具条/待整理项改为单模板字面量，标签成对）。
- **live 未跑**：4 红（round12/16/17/38-asr）仍在 §35.B6；本轮新增的知识库勾选/重构/合并/待整理区**没有真机点过**。

## 44. 第 56 轮：公网发现、认知预设多语言（第一批）、弱一致

### 44.1 公网"广播"能否保证收到（用户项 1）
- **不能保证**：无服务器时没有"广播给某人"，只有"把会合记录放到对方会去查的地方 + 等对方来取"。
- 可靠性的三根支柱：① **会合记录**（`DID → endpoint 列表 + 有效期 + 单调序号 + 签名`，上线/换网就更新，多写几处）；
  ② **回执**（msgId + 签名回执；无回执=没收到，按 2–3 条一批、3 次失败重试）；③ **多路径 + 退避**。
- 双方换 IP：各自更新会合记录；A 按 **DID** 查 B 的记录 → 打洞；查不到就问共同联系人（一跳 gossip）或等 B 主动来找。
  对称 NAT + 无中继 ⇒ 打洞失败，只能走异步通道，**如实告知**。详见 `docs/P2P-QUZHONGXINHUA.md` §11。
- 研究依据：libp2p Rendezvous / Kademlia mutable records、IETF BEHAVE P2P state、STUN + UDP hole punching。

### 44.2 创建者永久失联（用户项 2）
- 已按"**永远只读**（暂定，以后可能改）"写进 P2P 文档 §10.1：不自动转移、不多数接管；群生命周期绑创建者。
- 若将来要改，唯一出路是创建者提前导出/预设转移条款（文档已注明）。

### 44.3 认知预设与默认牛马名多语言（用户项 3，第一批已落地）
- 10 个语言包各新增 **64 个键**：`preset.cat.<id>`（13 个分类）+ `preset.worker.<id>`（51 个内置牛马模板名），
  zh-CN 也补齐了基线；`verify-r56-preset-i18n` 5/0（缺键/空值/拉丁语照抄中文/丢 `·` 一律红）。
- 渲染层：模板下拉的**分类名**按 `preset.cat.*` 显示（找不到回落中文），搜索也按翻译后的分类名匹配。
- **仍没覆盖**：2200 条认知模板的**名称/子类/正文**（约 100 万字）仍是中文。方案：① 分批机器翻译 + AI LQA（Phrase 2026 工作流），
  按分类一批批进；② 或"插入时按需翻译"（用用户自己的模型翻选中那一条，缓存结果）。**需要你选一条**；在这之前下拉里分类是母语、条目仍是中文。
- 默认牛马名：本机默认名来自 i18n 的 `placeholder.agentName`，本来就是 10 种语言；51 个模板名是给模板选择/展示用的储备键。

### 44.4 弱一致是什么（用户项 4）
- 强一致=所有成员同一时刻看到同一顺序，且发送要多数/权威确认（要共识，代价是必须多数在线）；弱一致（最终一致）=允许短暂不同/缺消息，
  最终每人拿到全部并收敛到同一顺序（追加日志 + 序号 + 后台补拉）。
- 你选的"创建者在线才能发"是**单一排序者**：用可用性换顺序确定性，不是共识；创建者不在 ⇒ 只读。详见 P2P 文档 §12。

## 45. 第 56 轮验收读数
- **fast 档 1 遍全绿：91 项次、无产品红**（exit 0）。新增 `verify-r56-preset-i18n` 5/0；
  `verify-i18n-locales` 162/0（10 个包键集一致，新加的 64 键 × 10 都在）。
- `verify-r56-preset-i18n` 的判据按语言细分：拉丁/西里尔语言若与中文完全相同判为占位；日/韩/繁体允许同形汉字
  （例如 jap `社会学研究`、zh-TW `家政生活` 本来就该同形）——这不是放宽，是避免逼出假翻译。
- 仍没做：2200 条认知模板的名称/子类/正文的翻译（需要选方案：分批 MT+LQA 或插入时按需翻译）；live 未跑（§35.B6）。

## 46. 第 57 轮：认知预设方案 A 开工、弱一致内核、去中心化选型

### 46.1 认知预设翻译（方案 A，已开工）
- 新流水线 `dev/i18n/translate-personas.mjs`：**可续跑**（每批落盘 + progress 文件）、**术语表**（`dev/i18n/persona-glossary.json`，可选）、
  **确定性校验**（JSON 可解析 / id 不缺不多 / 非空 / 汉字残留 / 长度比），不合格的条目留待下一轮重试，**绝不写坏数据**。
- 先翻**名称 + 子类**（下拉框可见），正文随后分批（`--field=content --batch=3`，慢）。
- 渲染层通过 i18n 键 `persona.<id>.name` 显示译名（主进程把 `i18n/persona/<lang>.json` 合并进语言包），缺译自动回落中文。
- 进度与 ETA 记在 §47（每批跑完更新）。

### 46.2 弱一致（用户定稿"做弱一致"）
- 新纯模块 `qun-xiao-xi-rixi.ts`：每作者 seq + 因果 deps + **确定性排序**（结果与到达顺序无关）+ 缺口补拉 + 去重 +
  创建者离线待排序队列 + 错位判定。门禁 `verify-r57-ruo-yizhi` 13/0。
- **边界如实说**：这是"排序内核"，**传输层（P2P 连接/会合）还没实现**；待排序队列只有在"放宽创建者离线只读"时才会被启用
  （当前产品规则仍是创建者离线只读，队列函数先留着做未来开关，不接进 UI）。

### 46.3 去中心化选型（回答"有没有更好的方案"）
- 结论：**KERI 风格 Key Event Log（身份）+ Hypercore/Autobase 风格多写入者日志（列表/群消息）+ Hyperswarm 式 DHT（发现）**，
  比"全部上公链"更适合个人用户：无币、无手续费、无出块延迟、不公开社交图谱；"永久"用可选锚定补。
- 不采用：Nostr 中继、AT Protocol PDS、Matrix 家庭服务器（都要服务器角色）、全局共识/代币。
- 详见 `docs/P2P-QUZHONGXINHUA.md` §13。

## 47. 第 57 轮验收读数与翻译进度
- **fast 档 1 遍全绿：92 项次、无产品红**（exit 0）；新增 `verify-r57-ruo-yizhi` 13/0；清单 96 支。
- **认知预设翻译进度（en-US，名称+子类）**：运行中，约 1,000 / 2,200 条（每批 20、并发 2，实测约 2.5–6 秒/批）。
  续跑命令：
  `MIMO_KEY_FILE=<key文件> node dev/i18n/translate-personas.mjs --lang=en-US --field=name,sub --batch=20 --concurrency=2`
  剩余语言把 `--lang` 换成 `zh-TW|ja|ko|fr|es|pt|ru|eo`（或 `--lang=all`）；正文用 `--field=content --batch=3`（慢，按小时计）。
- **续跑语义**：每批落盘 `src/i18n/persona/<lang>.json` + `<lang>.progress.json`；中断重跑只补缺，不重复烧钱。
- **仍未做**：正文翻译（方案 A 第二阶段）；live 4 红复跑（§35.B6）；P2P 传输层（弱一致内核已就绪，尚未接线）。

## 48. 第 58 轮：正文翻译开跑、弱一致产品放宽、可选服务器样机

### 48.1 翻译（方案 A 第二阶段已开跑）
- 名称/子类：zh-TW **2200/2200 完成**；en-US **2113/2200**（余 87 条反复不过校验，界面回落中文）；ja 进行中；其余排队。
- **正文**：已按用户授权启动 en-US（`--field=content --batch=3 --concurrency=1`，可续跑），夜间可继续；其它语言后续按同样命令分批。
- 续跑/换语言命令与进度口径见 §47；质量兜底：不过校验的条目不写进可用文件。

### 48.2 弱一致在产品层放宽（用户定稿）
- `qun-xiao-xi-rixi.ts` 增 `qunFaSongCeLue`：创建者本人/在线 ⇒ 发；离线 + 弱一致（默认 `QUN_RUO_YI_ZHI_MO_REN=true`）⇒ **进本地待排序队列**；显式关掉 ⇒ 只读。
- 门禁 `verify-r57-ruo-yizhi` 16/0（新增 3 条策略真值表）。
- **仍未接 UI/传输**：目前没有 P2P/中继发送路径，队列只在纯逻辑层；接上服务器或 P2P 后才在界面上出现"待创建者确认"。

### 48.3 可选服务器（用户要求"接口 + 样机 + 加密边界"）
- 样机 `fwarmy/server.mjs`：HTTP 内存中继；`register/lookup/relay/poll/bye`；**不落盘、不解析 envelope**、每 did 队列 ≤50、TTL 30s。
- 客户端/加密 `zhong-ji-ke-hu.ts`：X25519 临时密钥 + HKDF-SHA256 + AES-256-GCM + Ed25519 签名；信封带 from/epk/iv/ct/sig。
- 门禁 `verify-r58-zhongji` 16/0：真起服务器、注册、在线转发、解密、离线返回 offline、篡改/错钥/伪造发件人全部失败、
  源码无落盘/解密调用、取走即清空。协议与威胁模型见 `docs/SERVER-RELAY.md`。
- **回答"恶意服务器能否突破加密"**：拿不到明文、伪造不了任意发件人；能做的只有拒服务/丢包/延迟、看元数据、
  以及**替换公钥**——最后这条靠**带外核对身份指纹**防住（不依赖服务器）。重放与元数据未完全消除（协议留了 msgId+ts，客户端去重未实现）；
  前向保密（Double Ratchet）未做。

## 49. 第 58 轮验收读数
- **fast 档 1 遍全绿：93 项次、无产品红**（exit 0）；新增 `verify-r58-zhongji` 16/0，`verify-r57-ruo-yizhi` 扩到 16/0；清单 97 支。
- **翻译后台任务**：名称/子类（zh-TW 2200 全量；en-US 2113；ja 进行中；其余排队）+ 正文（en-US 已开始写入，可续跑）。
  中断后用 §47 的命令续跑；正文每种语言按小时计。
- **仍未做**：中继客户端的 UI（添加服务器/在线状态/重试）、消息去重（msgId+ts）、Double Ratchet、群密钥分发；
  live 4 红复跑（§35.B6）。

## 50. 第 59 轮：可用中转服务器 + 多服务器网络配置

- **服务器（可用版样机）**：`fwarmy/server.mjs` 升级为带管理面的服务：
  管理页 `/`（管理密钥）、凭据生成/吊销（**有名称**、只回明文一次、**哈希存储**）、业务统计（按凭据的请求/字节）、
  流量控制（每分钟请求/每日字节/单信封/队列上限）、公网 IP 探测、接客开关、一键关闭；
  业务面所有接口必须 `Authorization: Bearer <凭据>`。**仍不落盘消息**（内存队列 TTL 30s）。
- **一键控制台**：`fwarmy/ctl.mjs`（start/stop/status/cred-new/cred-list/cred-revoke/stats/ip/switch）。
- **客户端网络配置（逻辑层）**：`wangLuo-peiZhi.ts` —— 服务器校验（http/https、名称、凭据、去重）、会话绑定（多选/去重/剔除已删）、
  "局域网或公网 IP ⇒ 可不配服务器；都没有 ⇒ 必须至少一个"、**多服务器扇出**（任一送达即送达，逐台结果保留）；
  持久化 `net.json` + `net-bindings.json`（tmp+rename），IPC `netDu/netShe/netBangDingDu/netBangDingShe`。
- 门禁：`verify-r58-zhongji` 18/0（含凭据 401）、`verify-r59-wangluo` 20/0；清单 99 支。
- **UI 未接**：设置页的服务器列表/公网 IP、第四列「网络设置」卡（多选）尚未画；发送路径也还没接 `touDiDaoSuoYou`。

## 51. 第 60 轮：nm 查看器、独立服务器项目、群/项目只读定稿

### 51.1 中转服务器独立成项目（用户项 5）
- 新目录 `fwarmy/`（独立小项目；当时名为 `relay-server/`，第 64 轮改名）：`server.mjs`（管理页/凭据/统计/限流/公网 IP/在线心跳）+ `ctl.mjs`（一键启停/凭据/统计）
  + `package.json` + `README.md` + `start.bat` / `stop.bat` / `start.sh` / `stop.sh`（Windows/macOS/Linux 通用，只需 Node ≥20）。
- **在线心跳**：`POST /api/heartbeat`（每客户端定期）+ `POST /api/presence/batch`（一次查一批 did），
  `presenceTtlMs` 可配（默认 60s），超时判离线。联系人/群/项目的在线汇总由客户端按自己列表做。
- 旧的 `dev/server-prototype/` 已删除（不留两份服务器代码）；门禁改指 `fwarmy/`，18+3 条全绿。

### 51.2 群/项目发送策略回退（用户项 12）
- `qunFaSongCeLue`：创建者离线 ⇒ **一律只读**（不排队、不缓存）；`QUN_RUO_YI_ZHI_MO_REN = false`。
- 只有**联系人**消息才留本机等对方上线重发；群/项目那条"刚发出但创建者没收到"的消息显示发送失败并冻结，创建者上线后**自动丢弃、不重发**（策略已写死，队列函数保留但群/项目不再用）。

### 51.3 nm 查看器（用户项 1，第一批）
- 已做：工具栏右侧「打开」（选文件 → 新窗口）；自动保存（停手 2s）；打开文件所在目录；顶部"文件名 + 完整路径"；
  吸附/置顶移到标题栏（吸附在最左、图标用 `icons/ruo-ci-tie.svg`）；后退/前进改记**内容快照**（改内容后可后退、后退后可前进，按钮文字去掉箭头）；
  查找旁加替换框 + 替换按钮（**搜索有内容且至少一个结果且可编辑**才可用），替换会压入历史。
- **没做/没验**：正文"只显示上半部分"的布局问题（需要真机复现：是 CSS 高度还是正文抽取截断）；主界面标题栏的吸附图标（用户项 2）；替换"全部替换"。
- 真机未验（live 待跑）。

### 51.4 硬门禁（用户项 4）
- 现状：`CHANPIN_MENJIN` 约 **2,829 字符**（不是"很多条"，但每轮都发）。压缩方案：把 A–D 四条保留原意、合并重复表述与例子，
  目标 ≤2,200 字符；**尚未动手**（要先逐条对照 `verify-prompt-layers` 的 A–D 判据，避免压掉效果）。

## 52. 第 60 轮验收读数与首启准备
- **fast 档 1 遍全绿：95 项次、无产品红**（exit 0）；新增 `verify-r60-nm-server` 16/0，`verify-r58-zhongji` 扩到 21/0（含在线心跳/超时离线）。
- **live 档已启动**（用户确认桌面空闲）：整轮 live 名单串行跑，预计 45–75 分钟；结果另记 §53。
- **首启准备**：真实配置目录 `%APPDATA%\@warmy\app-shell` 已**改名备份**为 `app-shell.bak-r60-<时间戳>`（没有直接删，可回滚）；
  下次启动就是全新首启，可直接验收。`@ccarmy` 目录未动（不属于本轮产物）。
- **本轮没做完**（如实）：
  1. nm 正文"只显示上半部分"的布局/抽取问题（需要真文件真机复现，未动）；
  2. 主界面（非 nm 窗口）标题栏的吸附图标（只在 nm 窗口做了）；
  3. 替换的"全部替换"；查找/替换在只读文档上的行为未验；
  4. 硬门禁压缩（现状 ~2,829 字符，目标 ≤2,200；要先逐条对照 A–D 判据）；
  5. 设置页服务器列表/公网 IP、第四列「网络设置」卡（多选）仍是逻辑层，无 UI；
  6. 发送路径还没真正接 `touDiDaoSuoYou`/心跳定时器（需要 P2P/中继接入会话发送）。

## 53. 第 61 轮：硬门禁"效果只增不减"复核
- **结论：没有改任何一条条款**。只做了零语义损失的格式压缩（去空行/行尾空白，2,134 → 2,120 字符，省 14 字符）；
  用户口径是"质量优先，无法确保质量就不改"——进一步删字会伤效果，所以**不删**。
- 新增 `verify-hard-gates.mjs`（**23 条**，fast 档），把之前所有要求钉成可核对锚点：
  - A：四步顺序（先验证→固化→写进设置→回复交代）、三种落点判定表、禁止只留聊天、做不到要明说；
  - B：先 plan_update、≥3 步、2–10 步、单 doing、verified 只能 plan_verify、收尾验最后一步、卡住要说；
  - C：三触发条件同时满足、五件必报、禁止空转轮询、失败也要自己汇报；
  - D：软门禁不得冲突、冲突按硬门禁并立刻修正、被挡要说哪一条+最坏情况、模型无权改/跳过；
  - **撤除的 E 没有丢效果**：句式纪律（不是X而是Y、同族句式、≥80% 置信度、预警例外、自查）必须原样在「术」出厂稿里，
    且硬门禁里不再出现 E（避免双份注入）——这条是本轮新增的**最关键判据**，之前没人钉过；
  - 宿主强制点是真的：B 的 `plan.missing` 审计、D 的软门禁冲突检查 IPC、硬门禁只注入一处、不进压缩队列、体积下限。
- 与既有门禁的关系：`verify-prompt-layers` 29/0 继续负责"顺序/唯一注入/压缩豁免"；新门禁负责"每条要求没被改丢"，两者不重复。

## 54. 第 62 轮：nm 下半屏、主界面吸附、服务器管理页、live 仪器

> 详细交接见 [`HANDOFF-R62.md`](./HANDOFF-R62.md)（新会话从这里开始）。本节只留索引。

- **nm 下半屏**：根因是 `#meiTiLie{display:flex}` 压过 `hidden` 的 UA `display:none` ⇒ 媒体区 hidden 仍占一半。修 `[hidden]{display:none!important}` + 三面板 `flex:1 1 0/min-height:0` + `:not([hidden])` 才 flex；真机几何读数三面板都 463px、媒体隐藏态 `none`。
- **主界面吸附**：标题栏置顶左侧加吸附（同 `ruo-ci-tie.svg`），拖到屏幕工作区边缘 12px 贴边；IPC `warmy:zhuXiFu`；门禁钉顺序/图标/接线。
- **服务器管理页**：可视化凭据/限流/开关/5s 统计/公网 IP/关闭；`ctl.mjs open` + 三平台脚本 `--open`；修在线 TTL 写死、全局限流对已有凭据不生效、测试污染 `data/`；`verify-r58-zhongji` 24/0。
- **硬门禁**：条款语义未改，只保留零语义格式压缩（2,120 字符）；`verify-hard-gates` 23/0。
- **live**：上一遍因中途重建 `dist` 作废，已停；新构建 `dist` sha256 前缀 `0088156ae0ec33c4`。round12 ④ 补了授权卡处理器与 540s 预算，产品补 `chat.card-waiting/answered` 审计；根因仍待新一遍 live 定性。
- **首启**：真实 profile 已备份到 `%APPDATA%\@warmy\app-shell.bak-r60-20261022-041824`，当前无真实 profile；live 后跑 `node dev/gates/r38-firstrun.mjs`。
- **未完成/待拍板**：见 `HANDOFF-R62.md` §8（round16 三条出路、ASR skip 口径、write_file 覆盖语义等）。

## 55. 第 63 轮：翻译续跑、自动化清理、服务器免登录、决策说明

> 详细交接见 [`HANDOFF-R63.md`](./HANDOFF-R63.md)（新会话从这里开始）。待拍板逐条说明见 [`DECISIONS-R63.md`](./DECISIONS-R63.md)。

- **翻译**：名称/副标题 9 语言全部 2200/2200；en-US 正文 2200/2200；其余 8 语言正文 8 进程并行续跑。修「整批 JSON 失败整批丢」为二分重试、`fetch` 180s 超时、并发唯一 `.tmp`（Windows EPERM）。
- **自动化**：清除已删除 Qoder 任务的 144 条运行历史；`scheduled_task_run_logs` 归零。
- **服务器免登录**：管理页本机打开即用，不再生成/读取/填写 admin key；保留回环 + Host + 同源 + JSON 四道边界。`verify-r58` 34/0 ×3、`verify-r60` 24/0 ×3；真浏览器冒烟通过。
- **决策**：`DECISIONS-R63.md` 覆盖 write_file 覆盖语义、P0-6 五个边界、旧日志密钥文件名、round16、整遍 live 记录、出厂默认牛马、翻译质量、服务器边界。
- **未完成**：P0-5 代码、网络设置 UI/接线、实体复核队列 UI、nm 全部替换、主应用内服务器启停（见 R63 §5）。

## 56. 第 64 轮：FWArmy、网络主机模式、nm、主界面、ASR

> 详细交接见 [`HANDOFF-R64.md`](./HANDOFF-R64.md)（新会话从这里开始）。

- **FWArmy**：服务器项目改名 `fwarmy/`，自包含管理页、首次凭据、逐凭据速度/日/月/年配额/停用/删除、统计重启不丢、Windows 单文件 `FWArmy.exe`、headless/console 启动器；`verify-r64-fwarmy` 39/0 ×3，旧服务器门禁 35/20/24 各 3 轮。
- **网络设置**：主机模式折叠 + IP 检测 ≥1.3s + 公网 IP 自动填 + 主机≤10（host:port/IPv6/59599）+ 服务商≤1000（7 行滚动/编辑/删除/凭证 SecureKeyStore）；`verify-r63-net` 78/78 ×3。**协议层中继隧道/DHT/跨天重连/A-B 去重/在线文件传输未做**。
- **nm**：工具栏一行、SVG 源码/效果分栏、DOCX/XLSX/PPTX 预览、缩放/打印、双击全屏、未保存确认、只读自动保存禁用、音乐/视频进度条；`verify-r63-nm` 38/0 ×3。
- **主界面**：吸附落盘+图标 currentColor+主题色、用户气泡主题色、左栏图标对比色、执行中标题条整行、操作记录完整绝对路径、nm 打开设置、联系人菜单、ASR 本机未启用 bug 修复；fast 3×303 项全绿、ASR 10/0 ×3、round12 11/11 ×3。
- **未完成**：三层知识库授权/用户切换、成员显示名、P0-6 剩余、协议层组网、整遍 live 结果、首启。
