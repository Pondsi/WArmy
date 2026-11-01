# 门禁审计（第 5 轮）

> 机器可读清单：`docs/GATE-MANIFEST.json`（由 `packages/app-shell/scripts/gen-gate-manifest.mjs` 生成）
> 一致性由**硬门禁** `verify-gate-manifest.mjs` 双向校验（清单多一条/少一条/写错类别、主进程
> `MEN_JIN_YING` 与清单不一致、界面列表与清单不一致、探针没声明"不进 CI"、**已知红门禁没写证据或没在本文登记**
> —— 任何一条都判红）。
> 本轮统计：**121 支**（通用 30 / 项目专项 86 / 探针 5）；其中**已知红 7 支**（`verify-history-persist` 已于 2026-10-29 复跑转绿；`verify-context-renderer` 已修绿，见下表）。

## 〇、当前状态：哪些门禁**事实上是红的**（附证据）

> 一份清单如果不写清"当下哪些是红的"，"清单全绿"就是自欺。以下本轮实测确认红着的都登记在此，
> **并已逐条给出判断依据**（历史上有过用"换回 HEAD 再跑"做对照的证明）。

| 门禁 | 类别 | 为什么红 / 证据 |
|---|---|---|
| `verify-context-renderer` | project | **已修绿（第 22 轮）**。两支历史红项都不是产品缺陷：① `budgetChars=200 指针完整可执行` —— 渲染器在"绝不给空视图"那一步把最后一条真实消息塞在最前，把**已完整的指针**挤到预算外截断（`seq 1..30` 这种解不了引用的半根指针）；现在先**预留极简指针的字数**再给真实消息分配，指针三线索齐全、`pointers` 也如实计数。② `verify-all 跑完且零失败` —— `spikes/verify-all/run-full.mjs` 把 `memory-os/node_modules`（pnpm 下常是空壳）junction 进临时目录，`Cannot find module 'better-sqlite3'` **未捕获**直接把整个套件炸掉；现在按本平台 `prebuilds/*.node` 找真可用的包，并把该节包在 try 内（缺依赖只红那一条，不许拖垮全 suite） |
| `verify-history-persist` | project | **已修绿（2026-10-19，2026-10-29 再跑 ALL PASS）并进 live 档**：`failures=0`（[0] 静态契约 / [1] 落盘 / [2] 真重启重建 / [3] 记忆坏掉降级 全过）。旧红因是"临时 userData 里记忆服务起不来"，早已不成立；真正挡着它的是第 [1] 段两条——超长助手回复那一轮被 `chat.budget.stop-send` 拦下（模型窗口未知 ⇒ 兜底窗口偏小 ⇒ 道（不可压缩）+ 工具顶满，缺 3356 token），缺口其实全在**我们自己留的垫子**里（输出留位 12288 + 2% 安全垫 + 5% 执行余量）⇒ 新增阶梯第④·六级「让出余量」（`rangChuYuLiang`，输出留位地板 `max(2048, 窗口×4%)`、执行余量退到 2%），排在停止发送之前。审计实证：`chat.budget.give-back-reserve rangChu=10895 yuZhan 12288→2048 chuangKouYou=30720 rengQue=false` + `chat.budget.output-cap-lowered you=12288 xian=2048`（发送侧输出上限跟着降，两边同一个数） |
| `verify-tool-calls` | universal | **已修绿（第 6 轮）**：ALL PASS。旧语义断言按现实现重写（工具面 2→35、`supportsTools`/`tool_choice` 收敛、`maxResultChars`→`zuiDaJieGuoZiShu`、字段名 `qingQiuJi`/`tingZhiYuanYin`）；真 node 启动记忆服务；mock 支持 SSE；顺带修产品两处真 bug（视图硬界在「绝不给空视图」后越界、记忆服务挂了仍暴露干活工具） |
| `verify-tool-call-e2e` | universal | **33/34（第 6 轮，原 19/34）**：旧断言已改（报文 `messages`、紧急度 DOM `#jinJiTrigger` aria-label、工具面全套、metrics 字段 `gongJuDiaoYongJi`）；mock 支持 SSE。**余 1 红：4-10**——P1 加急路径经 `fenLei` 分类模型（桩环境缺该能力位，审计有 `err.capability-missing cap=fenLei`）后再收束，终答气泡计数对不上「桩模型终答」；消息本身已进会话且模型被调用（turns 2→4） |
| `verify-e2e` | project | 需要**没有别的实例在跑**（单实例锁）；桌面应用开着时必然 `no devtools port` |
| `verify-net-ui` | project | UI 联调 harness `fetch failed`（依赖端口/预览服务） |
| `verify-qr-scan` | project | 21/22：一条 UI 等待超时（弹窗 12s 内没出现），flaky |
| `verify-warmy-ipc-probe` | project | harness 里 `ipcRenderer` 未定义（探针壳问题），不是产品链路问题 |
| `verify-live-ui` | project | 真机 UI 断言（悬停提示 / 凭证截断显示 / 头像尺寸）与当前渲染实现有出入，需逐条核对重写 |
| `verify-mobile-ui` | project | 需要移动端 CDP 端口（`fetch failed`） |

**这一节由硬门禁看住**：`verify-gate-manifest.mjs` 会检查"清单里 status=known-red 的每一条都写了证据、
且都在本文出现过"—— 想悄悄把一支红门禁标成绿、或者把红的藏起来，都会当场判红。

## 一、结论先说：哪些"不是通用门禁"

仓库里 71 支脚本都叫 `verify-*` / `probe-*`，但**它们的定位完全不同**。审计出三类：

| 类别 | 数量 | 定位 | 该不该算"内置门禁" |
|---|---|---|---|
| `universal` 通用 | 26 | 编码的是**通用工程规则**，换任何项目都成立 | ✅ 是（本轮的"内置门禁"就是这一档） |
| `project` 项目专项 | 42 | 编码的是**本产品的具体功能与约定** | ❌ 随产品发、能跑，但**不能当成"标准"宣传** |
| `probe` 探针 | 3 | 会改本机状态 / 依赖外部服务 / 只做对照实验 | ❌ 刻意**不进**默认门禁 |

### 1.1 被误当成"硬门禁"的项目专项（本轮已从硬门禁档里移出）

| 门禁 | 为什么**不是**通用 |
|---|---|
| `verify-tasks-666` | 全是**本产品**任务台账的断言（18890 项里绝大多数是具体功能点），换项目一行都不适用 |
| `verify-firstrun-ui` | 认的是**本产品**的首启引导条与分区渲染 |
| `verify-dao-compliance` | 认的是**本仓**的 `docs/dao.md` 结构（宗旨/底线/硬约束），是项目自己的"道" |
| `verify-office-ooxml` | 认的是本产品 make_docx/make_pptx 的产物形状（通用部分已并入新的 `verify-office-doc-suite`） |

> 它们**没有删**：仍随产品发布、仍能在设置→门禁里逐支跑，只是不再挂"硬门禁（不可改）"的牌子。
> 理由：把项目专项挂在"硬门禁"里，会让用户误以为"这就是全部标准"，也把真正通用的那些淹没。

### 1.2 探针（**不是门禁**，别拿去当质量结论）

| 探针 | 为什么不进门禁 |
|---|---|
| `verify-container-real` | 真启 Docker、拉镜像、会改本机状态、需要网络；**文件头自己就写着"不要把它挂进 CI/门禁"** |
| `probe-freeze-capability` | 结论随这台机器变（有没有某能力），不是"代码对不对" |
| `probe-sound-gate-discriminates` | 门禁"能失败"的对照实验：把 dist 还原成老行为再跑，用来证明**门禁不是摆设** |

> `verify-container-real` 的名字里带 `verify-` 是历史遗留，**名字像门禁**。
> 本轮没有改名（有 6 处引用 + 一条 `verify-tasks-6666` 断言钉着它），
> 而是让 `verify-gate-manifest.mjs` 强制它**在文件头声明"刻意不进 CI/门禁"**，防止被误跑。

### 1.3 需要"修或删"的（本轮已处理 / 仍待处理）

| 项 | 结论 |
|---|---|
| `verify-container-real` 不在 `full-verify-rounds.mjs` 的清单里，且 `runContainerAction` 导出已失效 | 已按"探针"归档并强制声明；**不删**（它是真机取数工具）。若哪天要它当门禁，得先修导出 |
| 三支"假红"门禁（`verify-eta-forecast` 阈值常量不同步、`verify-features-99` 滚动语义变了、`verify-usage-table` 点了早已废弃的 `data-cost-sort`） | 第 4 轮已修（改成读常量/读真实选择器） |
| `verify-history-persist` 裸跑主进程文件、无具名导出 ⇒ 会"跳过"而不是失败 | 保留现状（不算红），但**不能把它当"历史持久化已验"的证据** |

## 二、内置门禁应该是哪些（本轮定稿的 26 支）

判据三条：① 换项目仍然成立；② 能在**无头环境**跑（不依赖 GUI/网络/外部服务）；③ 结论是"对/错"而不是"看情况"。

**安全与仓库（4）**：`verify-security`（路径越权/命令注入/凭据泄漏）、`verify-repo-guard`（坏路径/重复树/敏感文件）、`verify-docs`（文档不许含真实用户路径与密钥）、`verify-nm-format`（加解密包格式，解不开如实报错）

**如实性与契约（3）**：`verify-truth-guard`（**声称完成但本轮零工具调用**必须判出来）、`verify-tool-calls`（工具参数是截断/手写 JSON 时不许把解析器报错当回复）、`verify-tool-call-e2e`（工具调用真跑到结果）

**渲染层陷阱（4）**：`verify-renderer-scope`（`window.__x` 有读无写 / 跨作用域调用 / 顶层重复声明）、`verify-renderer-template-balance`（模板字面量与括号配平）、`verify-template-integrity`（模板里的 `${}` 不许丢）、`verify-raf-batching`（同帧排队的回调**必须全跑**）

**接线与一致性（5）**：`verify-import-integrity`（导入的符号必须真的存在）、`verify-wiring`（界面用到的 API 必须真的挂在桥上）、`verify-ipc-probe`（IPC 白名单一致）、`verify-electron-app-binding`（Electron 绑定完整）、`verify-css-consistency`（CSS 变量必须真实存在）

**多语言与文案（2）**：`verify-i18n-locales`（键集合相等/占位符一致/拉丁语系无 CJK）、`verify-strict-language`（文案语言一致）

**沙箱与凭据（3）**：`verify-work-tools`（越权路径/超限写入**一律拒绝**）、`verify-credential`（凭据派生与格式）、`verify-identity`（身份/私钥派生确定性）

**发布与运行期（3）**：`verify-updater`、`verify-updater-github`、`verify-runtime-errors`

**本轮新增（2）**：`verify-office-doc-suite`（Office 生成→读回、文档抽取统一入口、SKILL.md 规范、凭据保管、门禁留档，85 项断言）、`verify-gate-manifest`（这份审计本身不许腐烂，20 项断言）

## 三、还应该内置哪些（本轮新增 + 建议）

**本轮已加（2 支）**
1. `verify-gate-manifest.mjs` —— 门禁清单与磁盘、主进程清单、界面清单三者一致；探针必须自证"不进 CI"。**没有它，上面这份审计一周就会腐烂。**
2. `verify-office-doc-suite.mjs` —— 补上"产物必须能**读回来**"这一类：docx/xlsx/pptx/pdf 生成 → 抽取 → 逐字比对；PDF 中文必须能复制（不是图）；扫描件抽不到必须**如实说**。

**建议下一轮加（还没做，理由写清）**
| 建议 | 抓的是什么坑 | 为什么现在没做 |
|---|---|---|
| `verify-persist-roundtrip` | "保存成功"其实没落盘 / 落盘读不回（写-读回一致性） | 需要先把各模块的持久化入口收敛成统一接口，否则门禁得逐个 mock |
| `verify-timeout-budget` | 门禁自己挂死（本轮就踩过：全量跑批 >40 分钟无输出） | 需要给每支门禁声明自己的超时预算，属"元数据"改动 |
| `verify-no-empty-catch` | `catch {}` 静默吞异常（凭据保管那条历史缺陷就是被 `catch` 吞掉的） | 部分已被 `verify-dao-compliance` 覆盖；做成通用版要先定"哪些 catch 允许空" |
| `verify-secret-at-rest` | 用户数据里的密码/令牌在磁盘上必须是密文（本轮凭据保管那条的通用版） | 需要一份"哪些字段算敏感"的通用声明，先在本项目把声明跑通 |

## 四、怎么用

```bash
# 逐支跑（单支 420s 超时，避免被挂死的那支拖住整体）
node dev/gates/run-gates.mjs verify-security verify-gate-manifest verify-office-doc-suite

# 只看清单与统计
node packages/app-shell/scripts/gen-gate-manifest.mjs      # 刷新清单
node packages/app-shell/scripts/verify-gate-manifest.mjs   # 校验一致性（硬门禁）

# 界面上：设置 → 门禁 —— 硬门禁（26 支通用，不可改）+ 项目专项（可跑）+
#          最近运行记录（时间/结果/耗时；「刚由绿转红」排最前，留档在 userData/gates-history.jsonl）
```

---

## 五、第 7 轮：主流智能体门禁对照与取舍（2026-10-12）

> 依据：Tavily 检索（SWE-bench / AgentBench / Terminal-Bench / Cline Bench / smoke-test CI / AI 代码安全扫描）+ 本仓 75 支清单。

### 5.1 哪些不是通用门禁、建议降级或合并

| 门禁 | 判断 | 建议 |
|---|---|---|
| verify-tasks-666 / 6666 / 4563 | 本产品任务台账断言，体量巨大 | 保留为项目专项，不要当通用门禁 |
| verify-firstrun-ui / live-ui / ui-layout / mobile-ui | 绑死本产品 DOM/真机 | 项目专项 + 探针 |
| verify-dao-compliance | 本仓 dao.md 纪律 | 项目专项 |
| verify-office-ooxml | 已被 verify-office-doc-suite 覆盖大半 | 建议合并 |
| verify-qr-scan | flaky（弹窗超时） | 调超时，不当发布硬门禁 |
| verify-net-ui / mobile-ui / e2e | 依赖预览服务/空闲实例/移动 CDP | 标明环境前置，默认不进 CI |

结论：约 42 支项目专项随包发、可手动跑；硬门禁仍应只含通用 28 支口径。

### 5.2 主流有、我们没有的（按价值排序）

| 门禁 | 对应业界 | 为什么值得加 | 状态 |
|---|---|---|---|
| verify-secret-at-rest | secret scanning | 用户数据/审计/导出口令必须密文 | 建议下轮 |
| verify-no-empty-catch | 静默失败 | catch{} 吞错是历史事故源 | 建议下轮 |
| verify-persist-roundtrip | 持久化一致性 | 保存成功必须能读回 | 建议下轮 |
| verify-smoke-critical-path | CI smoke 5–10 条 | 发布前只跑关键路径 | 建议 run-gates --smoke |
| verify-prompt-injection-hygiene | 不可信输入 | 注释/附件名/工具回显不得直进系统提示 | 缺口 |
| verify-dep-advisory | 依赖漏洞 | pnpm audit 或离线 advisory | 建议加 |
| round3-verify ×3 | pass^k 可靠性 | 已有雏形，文档化即可 | 已有 |

### 5.3 整体判断

- 合理性：通用/项目专项/探针三档正确；verify-gate-manifest 防清单腐烂是关键资产。
- 问题：①75 支不适合当 CI 硬闸；②环境耦合红灯多；③缺发布 smoke 与密钥落盘/静默 catch。
- 建议：CI 只跑 smoke 包（安全+清单一致+工具链路+持久化+build）；全量夜间/发版前；下轮补 secret-at-rest、no-empty-catch、smoke-critical-path。

## 六、第 48 轮门禁变化（2026-10-20，逐条原因见 `docs/HANDOFF-R44.md` §17.4）

| 门禁 | 变化 | 定性 |
|---|---|---|
| `dev/gates/verify-r48-heiban.mjs` | **新增**（fast 档，60 项）：任务黑板 + 结构化蒸馏 + 队列冲刷同协议 + 三层缓存顺序；假 OpenAI 兼容端点驱动编排器整条链 + 真记忆服务 | 行为判据；变异测试 10 体全抓（1 个等价变异体已说明） |
| `dev/gates/verify-r48-qiyue.mjs` | **新增**（fast 档，25 项）：契约每个类型有着落、包外无同名定义、本包无值、运行时返回值 ⊇ 契约必填字段、错误分类真值表 | 每类判据配伪造夹具负向 |
| `verify-r44-yuSuan` ⑨ | 多执行者汇总：字面锚 → 行为（新口径 5 人全在且每节 ≤ 配额；旧口径同数据只保住 3/5 人） | 旧锚指向的代码被公平配额取代 |
| `verify-context-renderer` [5] | 视图 = 冻结系统提示与状态卡片之间；新增"卡片在最后""系统提示跨轮逐字相同" | 产品改了三层顺序 |
| `verify-round20-team` | "记忆不可用只砍记忆工具"字面锚陈旧（第 44 轮收成 `zuJingGongJuGuiGe` 后一直红）→ 结构判据 + 负向样本；接真记忆服务验黑板/蒸馏；LIVE 加一遍 MiMo | **仪器陈旧**，不是产品回归 |
| `verify-round18c` | "计划卡有步骤" → "门禁收下了计划 ⇒ 卡上有这些步骤；2 步任务不建也合规" | 第 24 轮起计划由模型按门禁规则建，旧判据是宿主按句拆计划时代的口径 |
| `verify-round16` ③ | 桌面取系统已知文件夹（与产品 `app.getPath('desktop')` 同源），验完删自己写的文件 | 桌面重定向到别的盘时旧判据误判"未找到" |
| `dev/gates/verify-memory-stress.mjs` | 超限判据改为 import 主进程同一个 `shiShangXiaWenChaoXian` | 消除"两条腿各说各话" |
| `dev/gates/verify-r44-token-live.mjs` ④ | 用"人为写入比值 0.6 后按公式变化"证明预算读了校准表；真实校准值只判方向 | 真实比值碰巧贴着先验（0.89 vs 0.9）时旧判据必红，**仪器假设错误** |
| `dev/gates/verify-round34-live.mjs`（MiMo 腿） | 看图路由按主模型能力判（官方规格表能看 ⇒ 不转交） | 第 45 轮能力判定改口径后旧判据陈旧 |
| `verify-r44-yuSuan` 工具截尾两条 | 字面锚 → 对 `gong-ju-fen-dang.ts` 的行为判据 + 第 48 轮 live 事故复现（用户点名的 list_archive 被裁） | 截尾逻辑收进纯模块 |
| `verify-work-tools` [2] | 新增 3 条：工作区内的绝对路径照常读写、大小写不同也认、前缀相同的隔壁目录照旧拒绝 | 第 48 轮 live 真缺陷 #13（工作区内绝对路径被当越权、弹卡一直等） |
| `verify-r44-yuSuan` | 新增"完成核对轮整篇重写已交付文件被宿主拦下"接线判据 | 第 48 轮 live 真缺陷 #14；行为由 `verify-round34-live` 的"同一个文件没有被整篇重写"兜底 |
| `verify-round12` ④ | 模型把测试文件写到工作区外时，认完就删（只删门禁专用的唯一文件名） | 门禁不许污染真实桌面（第 48 轮 live 第 1 遍在真实桌面留下过 `r12-check-1.txt`） |
| `dev/gates/verify-r48-nengli-tongbu.mjs` | **新增**（live 档，17 项）：设置 API 写能力 ⇒ 不重启预算窗口当场跟上；真界面「手动添加模型」→ 真 Ollama 验证 → 能力与模型列表落盘；同 profile 重启一条不丢 | 第 48 轮真缺陷 #15/#16（`verify-round34-live` 本地腿 7 红的根因）；负向：去掉同步与落盘的主进程副本 7 项翻红 |
| `verify-r44-yuSuan` 点名工具 | 新增"产物类型 / 等待也算点名"（make_pptx、wait_seconds 在截尾时保留；无关句子不点名） | 第 48 轮真缺陷 #18 |
| `verify-r44-yuSuan` 工具指纹 | 新增全文指纹真值表 + 旧算法（前 400 字）同组输入必撞的负向对照 | 第 48 轮真缺陷 #19 |
| `verify-tool-calls` [3b] / `verify-history-persist` | 中间回复：循环层带回、落盘层写入 + 重启补回（假模型改成 SSE 才走得到主路径的工具调用） | 第 48 轮真缺陷 #20 |
| `dev/gates/verify-r48-zhongjian-ui.mjs` | **新增**（live 档，9 项）：中间回复画进「执行过程」、顺序、观感、不并进最终气泡、重启仍在；写完的一轮重启后不出现中断块与「继续/重试」 | 第 48 轮真缺陷 #20/#21；#21 那条在旧构建上截图实锤为红 |
| `verify-round34-live` 内容类判据 | **仪器变更**：读"最终回复 + 中间回复"；svg 判据的"没收到其他附件"不再算没看到图 | 中间回复落盘后它就是写给用户的话；旧正则把如实话判红 |

## 七、第 49 轮门禁变化（2026-10-20，逐条原因见 `docs/HANDOFF-R44.md` §18.4）

| 门禁 / 工具 | 变化 | 为什么 |
|---|---|---|
| `verify-click-lag` | 由"覆盖子进程 `APPDATA`"改为显式 `--user-data-dir=<临时目录>`，跑完删 | **真机取证**：真实配置里的 `DevToolsActivePort` 正是这支的端口 9461 ⇒ 覆盖 APPDATA 在 Windows 上不生效，它一直在拿用户实时配置当试验场（它还会真的往供应商列表加一行）。复核后：验收清单上会起 Electron 的 66 支门禁**全部显式隔离** |
| `verify-round27-live` | 点开技能市场弹窗后**轮询到有结果为止**（最多 26 秒，读数带 `dengMs`/`rengZaiJiaZai`）；上游真不可达时把"筛选生效"两条换成一条真不变量（不造假控件、不把加载说成完成），不静默跳过 | 同构建复跑打出 3 条红而主遍绿：产品侧 `duShiChangMuLu` 自己有 `AbortSignal.timeout(15000)`，门禁却**固定睡 6 秒**就取证 ⇒ 上游慢时抓在"正在读取上游目录…"那一秒，判成"不实话"。修法：过完产品自己的上限还在转圈才是真红。复跑过 14 · 败 0 |
| 串跑驱动器（一次性工具，跑完删） | 教训补一条：**自持驱动器的子进程 stdio 必须接进日志**，否则只留下 exit code 与耗时、条数全丢；且**"主遍 exit=0"不等于"这一档没有红"** —— `verify-round27-live` 就是靠同构建复跑才暴露的 | 第 40 轮记过一次同样教训，本轮又踩；写进 §18.4 供下次直接照做 |
