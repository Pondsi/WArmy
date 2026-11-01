# 第 98 轮交接（2026-10-27）

> 本轮两项：**短记忆 3/5 口径按你的澄清重做**；**旧漫游式引导整体删除，重建为四步「开始使用」清单**。
> 未完成/待拍板见 [`OPEN-ITEMS-R98.md`](./OPEN-ITEMS-R98.md)。

---

## 一、短记忆：KB 最多 3/5，其余来自本会话聊天

### 1. 你澄清后的口径

- 群聊 / 联系人 / 项目 / 牛马**不是只能读对应知识库**，也能读**本会话自己的聊天记录**；
- 从知识库抽取的内容**最多占 3/5**；
- 剩余条目来自**当前会话的聊天内容**；
- 聊天内容与已抽取的知识库内容**重叠的必须排除**；
- 没有聊天内容可抽时，才允许最多 3 条知识库条目起步，避免第一条共享内容就卡死 3/5。

### 2. 实现

`packages/app-shell/src/electron-main.ts`：

- 新增 `duanJiYiHuiHuaSuCai(sessionId, yaoDian, kbNorm)`：
  - 只读本会话 `chatLogs` 的最近 300 条，跳过 system/hidden；
  - 先收**用户明确规则句**（`记住|以后|每次|不要|必须|喜欢|偏好|习惯|统一|默认|约定|规则|禁止|别再|别用|总是`），权重 2.5；
  - 再收最近 8 条用户消息，权重 1；
  - 排除与本会话最新归档「要点」重复的条目，以及归一化后与知识库内容互相包含的重叠条目。
- `guiNaDuanJiYi`：
  - 先放聊天候选（最多 10 条），再补知识库候选；
  - `kbCap = chatCount === 0 ? 3 : floor(chatCount * 3 / 2)`；
  - 老短记忆里不在知识库的行**不再补写进知识库**，只按“聊天内容”参与保留/压缩；
  - 审计改为 `kb: { entries, total }` + `chat: chatCount`。
- `yaSuoDuanJiYi`：
  - KB 计数改为**任意知识层**（session/internal/private）都算 KB 内容；
  - 超过 `kbCap` 时只丢最低分的 KB 条目，不丢聊天内容。

### 3. 验证

`dev/gates/verify-r96-memory.mjs` **16/0**：

- 本会话 7 条短记忆 = 4 条聊天内容 + 3 条知识库内容；共享 session 层 1/7（≤3/5）；
- 与要点重复的条目被清掉，且没有写进短记忆；
- 群聊从本会话聊天补足 2 条 = 1 条聊天 + 1 条知识库，不再为空；
- 压缩不再往知识库写 `prompt:overflow`；
- “记住”按私密/内部/公开分层；被守卫拦下的失败当场记踩坑。

---

## 二、旧引导：整体删除（不是修补）

删除清单：

| 位置 | 删除内容 |
|---|---|
| `packages/app-shell/src/renderer/auth-gate.js` | 整个 R78 spotlight 漫游层：`tour/tourEnsure/tourStart/tourTeardown/tourSync/tourLayout`、220ms 巡检、Escape 拦截、`window.__warmyTour` |
| `packages/app-shell/src/renderer/app.js` | 旧 `yinDao*` 步骤条：步骤数组、高亮、拖动吸附、巡检、`__showOnboardingGuide`、`__yinDaoChongHua`、`__yinDaoTargetRefresh`、旧“重看”代理 |
| `app.css` / `renderer.css` | 两份 `.yinDao*` 规则（含历史重复定义） |
| `auth-gate.css` | `body.warmyTourOn`、`.warmyTour*` 全部规则 |
| 10 个 i18n 包 | 所有旧 `guide.*` 键（含 `guide.step1/2/3`、`guide.r81.*`、`guide.section*`） |
| 门禁 | `verify-r78-auth-tour` 的 ⑧/⑧b 段；`verify-r67-firstrun`、`verify-r81-ui`、i18n / CSS / 6666 台账里的旧引导断言改为新清单判据 |

> **删除时踩到的真事故**：旧 spotlight 代码块里顺手包着 `window.__warmyAuthGate` 和
> `window.addEventListener('resize', fitPinInline)`。第一次整段删除把这两个也带走了：
> 认证门禁停在转圈、登录页内嵌按钮不再随语言重排。`verify-r78-auth-tour` 与
> `verify-r78-auth-tour` 的 PIN 最宽语言断言当场抓到；已恢复并复跑 **35/0**。
> 这说明“删旧功能”必须同时跑与它共享闭包的认证门禁，不能只看新功能。

---

## 三、新「开始使用」清单

### 1. 选型

没有再使用“聚光灯/漫游”。对照成熟 onboarding 的常见做法（setup checklist、渐进展开、
行为触发完成、可跳过可继续）后，落地为**右上角非阻塞四步清单**：

- **一个任务一张卡**：供应商 → 模型 → 牛马 → 第一句；
- **只展开当前一步**，完成项收成勾选，进度 `n/4` + 细进度条；
- **状态真的达成才打勾**，不要求用户点“下一步”来证明；
- **单步可跳过**；整卡可「稍后设置」；
- **可回来**：未完成时左下角保留「继续设置 n/4」胶囊；设置 → 关于、F1 也能重开；
- **不遮罩、不抢焦点、不强迫点击**；**不自动折叠、不自动消失**，只能由用户关闭；
- 卡片固定在**右上角**（`right:18px; top:64px; bottom:auto`），与输入框/发送按钮留有距离，
  不压聊天区；内容过高时卡内滚动（`max-height: calc(100vh - 80px)`）。

### 2. 四步与判定

| 步骤 | 判定 | 去操作 |
|---|---|---|
| 添加模型供应商 | 有 baseURL 且（有 Key / 已拉到模型 / 协议是 Ollama） | 设置 → 模型，滚动到供应商入口并脉冲 |
| 添加模型 | 任一供应商 `models.length > 0` | 定位该供应商的「自动添加模型」并脉冲 |
| 创建牛马 | `state.instances.length > 0` | 点引导按钮直接创建（弹名称输入）；也可点第二列顶部马头图标；创建后自动打开设置弹窗 |
| 发出第一句 | `guideChatDone` 或本会话已有 user 消息 | 打开第一只牛马，聚焦输入框 |

- 第 2 步在没有可用供应商时，会把按钮改成「先添加供应商」，不会把用户带到一个空页面；
- 第 4 步在没有牛马时改成「去创建牛马」；
- 第一句**只有真正收到回复（`r.ok`）才完成**；`needsKey` / 失败不算，清单会留在第 4 步；
- 完成/稍后设置写 `guideDone`；第一句写 `guideChatDone`（主进程 `setupState` 同时会扫
  `chatLogs` 里的 user 消息，老用户没有标记也能判定）；
- 首次自动出现前等供应商/牛马读回（最多 5 秒），不会先闪 `0/4` 再跳 `3/4`；
- **不再自动收起**：无论四步是否完成、用户是否点了“去操作”，卡片都保持展开/胶囊状态，
  直到用户自己关闭；关闭后未完成时左下角仍有「继续设置 n/4」胶囊。

### 3. 文案

10 个语言包全部新增 30 条 `startGuide.*`，并新增 `panel.workfiles.refresh/refreshed`。
新增门禁 `verify-r98-onboarding` 覆盖：

- 旧 `yinDao/warmyTour/__showOnboardingGuide` 在渲染层源码中为 0；
- 10 包 30 条文案齐全、旧 `guide.*` 为 0；
- 新用户 0/4、第 1 步展开、非阻塞、**点“去操作”后仍不折叠/不消失**；
- 卡片在右上角，不遮挡输入框/发送按钮；
- 稍后设置落盘 + 胶囊继续 + 重开 + 单步跳过；
- 已配好三步 3/4、去聊天、**真主进程 + 真渲染层 + 确定性假模型**发出第一句并收到回复，
  `guideChatDone/guideDone` 落盘、界面四步全勾；
- 供应商只有 Key 没模型时 1/4、去拉取定位并脉冲；补模型后自动 2/4；
- **第 3 步直接弹出创建牛马输入框；填写后真实创建并打开设置弹窗**（弹窗含 `iMing/iSmartMoXing/iThinkLevel`）；
- **右键“我的牛马”第二列会话图标 → 设置**，打开同一设置弹窗；
- 重启：稍后设置只留胶囊；全部配好静默完成，不再打扰；
- 切换日语后清单文案跟着变。

---

## 四、门禁结果

| 门禁 | 结果 |
|---|---|
| `verify-r98-onboarding`（新） | **43/0** |
| `verify-model-pick`（智能/严格双路径） | **43/0** |
| `verify-r97-static`（P0–P3 与链位解耦） | **33/0** |
| `verify-r78-auth-tour`（删漫游段 + PIN 缩放测量修正） | **35/0** |
| `verify-firstrun-ui`（新清单段） | **19/19** |
| `verify-r67-firstrun` | **80/0** |
| `verify-r81-ui` | **20/0** |
| `verify-r96-memory` | **16/0** |
| `verify-r94-ui` / `verify-r94-ui-live` | **27/0** / **28/0** |
| `verify-r97-static` / `live` / `nm-live` / `snap-geometry` / `shell-auth` | **33/0** / **25/0** / **17/0** / **18/0** / **20/0** |
| `verify-context-renderer`（含回归套件） | **ALL PASS** |
| `verify-css-consistency` | **8/0** |
| `verify-i18n-locales` | **163/0** |
| `verify-tasks-6666` | **6668/0** |
| `verify-features-99` | **83/0** |
| `verify-r78-scroll` | **6/0** |
| `verify-busy-toggle`（补认证旁路后） | **21/0** |
| `run-verify-22 --tier=fast`（全量，含派发计划门禁） | **114 项次 · 0 红** |

> 全量 fast 里另有 19 项历史门禁因产品口径升级而断言过期（滚动/ASR/压缩层/窗口落点/
> nm 默认值/硬门禁 A–E 等）。本轮逐支按**当前产品口径**更新了仪器，并顺手修了两处真问题：
> 受保护目录/硬门禁 E 的拒绝没有进统一拒绝台账（现补审计）；提示词备份列表 IPC 缺 `ceng`
> 字段时渲染层会抛 `map` 异常（现按空列表处理）。

---

## 五、变更文件

- `packages/app-shell/src/electron-main.ts`：`guideChatDone` 读写；短记忆聊天素材/3-5 压缩。
- `packages/app-shell/src/settings-store.ts`：`guideChatDone?: boolean`。
- `packages/app-shell/src/renderer/app.js`：删旧引导；新 `startGuide*` 清单；第一句完成钩子；
  `__warmyBootDataReady`；`window.__langDuWenBen`。
- `packages/app-shell/src/renderer/auth-gate.js`：删漫游层；恢复 `__warmyAuthGate` 与 PIN resize；
  `window.__startGuide*` 不在此文件。
- `packages/app-shell/src/renderer/app.css` / `renderer.css` / `auth-gate.css`：删旧引导样式；
  新 `.startGuide*`；`.yinYongTiao` 两处宽度口径对齐。
- `packages/app-shell/src/i18n/*.json`（10 包）：删旧 `guide.*`；新增 `startGuide.*` 与 workfiles 文案。
- `dev/gates/verify-r98-onboarding.mjs`（新）；`verify-r78-auth-tour.mjs`、`verify-r67-firstrun.mjs`、
  `verify-r81-ui.mjs`、`verify-firstrun-ui.mjs`、`verify-css-consistency.mjs`、
  `verify-features-99.mjs`、`verify-i18n-locales.mjs`、`verify-tasks-6666.mjs`、
  `verify-busy-toggle.mjs` 同步更新。
- 文档：本文件、`OPEN-ITEMS-R98.md`、`HANDOFF-NEXT.md`、`CHANGELOG.md`。

---

## 六、交付状态

- 最终构建：`npm run build`（tsc + 语法 + 资产复制）通过。
- **最终首启交付（2026-10-27）**：
  - 真实 profile（本轮你配置的 3 个供应商、1 只牛马）已备份到
    `%TEMP%\warmy-profile-before-r98-nanza-20261027-131428.zip`（**115,291 字节**，含 `settings.json`）；
  - 原 `%APPDATA%\@warmy\app-shell` 已删除；
  - 程序已以首启状态启动在**语言页**：10 种语言可见、`window.__warmyAuthGate` 存在、
    无旧漫游引导、渲染层无异常；等待你从语言页验收。
- 需要恢复旧配置时，把上述 zip 解压回 `%APPDATA%\@warmy\app-shell` 即可。
- 当前构建版本：0.2.28（`package.json`；README/说明里的安装包名同步为 `WArmy-Setup-0.2.28.exe`）。

---

## 七、边界（不是 bug）

- “稍后设置”后胶囊会一直保留，直到四步全部完成或用户不再需要；这是“稍后再设置”的入口，
  不是重复打扰；
- 第一句只认成功回复；没有 Key、被风控、网络失败时不算完成，清单如实停在第 4 步；
- 老用户如果没有 `guideChatDone` 标记且主进程日志也没恢复出 user 消息，可能看到第 4 步未完成；
  此时发一句即可完成，不影响任何功能。

---

## 八、追加：10 牛马 × 5 项目 × 10 轮项目验收（单遍已绿，连续 10 遍按用户指示暂停）

详细记录见 [`HANDOFF-R98-ACCEPTANCE.md`](./HANDOFF-R98-ACCEPTANCE.md)。摘要：

- 新增 `dev/gates/verify-r98-ten-by-ten.mjs`：真实 Electron + 真实 IPC + 真实项目工作区；
  10 只牛马（10 个不同默认模型）、5 个项目（各 5 只不同牛马、随机值班）、每项目 10 轮；
  每轮核对委派、执行者产物、共享黑板、值班者汇报、项目知识库验收码、
  上下文压缩、提示词压缩、对话历史与重启恢复；单遍 **1817 条断言**。
- **单遍全绿**：`ALL 1 RUNS PASS，1817 条断言，767.3s`。
- 连续 10 遍：尝试 1 `RUN 1/10 PASS（565.7s）`；尝试 2 `RUN 1/10 PASS（1029.3s）`，
  第二遍 R02 按用户指示主动停下。**“连续 10 遍全部通过”未完成（用户暂停）**，
  脚本和产物都在，随时可续跑。
- 这轮为验收修掉 11 个真问题：执行者按模型路由供应商、Gemini `thought_signature` 丢失、
  执行者调用无超时、429/5xx 不重试、`jiao_fu` 漏填产物导致误判、未核实产物冒充真产物、
  实例上限 8 导致 10 只牛马起不来、提示词压缩跑在审计/知识库初始化之前、
  执行者上下文无尺寸留痕、创建文件任务绕圈、执行者模型错误归因。
- 本轮回归：`verify-r98-onboarding` 41/0（当时口径；四项界面改动后为 43/0）、`verify-r96-memory 16/0`、
  `verify-r78-auth-tour 35/0`、`verify-context-renderer ALL PASS`、
  `verify-security 28/28`、`run-verify-22 --tier=fast **113 项次 · 0 红**`。
- 虚拟机兜底：本机 WSL（Ubuntu，停止）和 Docker Desktop（已安装未启动）存在，
  但没有准备/验证项目级容器运行时；5 个项目全部按 `devEnv:'host'` 跑，
  这是用户允许的兜底，详见验收文档“遗留边界”。

---

## 九、追加：模型路由定稿（智能模式 / 严格链 + P0–P3 语义）

详见 [`MODEL-ROUTING-R98.md`](./MODEL-ROUTING-R98.md)。摘要：

- **P0–P3 是消息插入/排队紧急度**：P0 停止、P1 加急、P2 插入、P3 排队；
  **不是重要程度**，不影响选模型或思考强度。
- **勾选「智能模式」**：分类器按任务重要×复杂给出 `modelTier`：
  `high` 选链上第一个非本地（云端强模型）、`mid` 选链头、`low` 选第一个本地/免费；
  同时 `thinkLevel` 只在牛马思考级别=自然（自动）时生效。
- **未勾选「智能模式」**：默认模型优先，失败后**严格按调用链顺序逐个试**；
  跳过禁用/不存在/本轮已失败；再退固定角色表 → 兜底。
- **综合而非无脑高配**：`jiaGuNanYiDang` 对“又短又简单”的任务压高级模型和高思考；
  用户显式选了思考档则严格用该档（模型仍按对应路径）。
- **省调用**：非智能 + 用户已选具体思考档 ⇒ 不调用分类器。
- 群执行者按默认→链顺序换模型，审计记 `attempts`；执行者**自己勾了智能模式**时，
  按派发计划的难易度在它自己的链上选第一个——值班者只给难易度，不能指定模型。
- 验证：`verify-model-pick 43/0`、`verify-r97-static 33/0`、单聊/群真机探针、
  `run-verify-22 --tier=fast 114/0`。

---

## 十、追加：第 98 轮最后四项界面改动（2026-10-27）

### 1. 引导卡片不自动折叠

- 删除两处自动关闭：点「去操作」后 450ms 关闭、四步全完成 4200ms 关闭。
- 卡片固定在右上角；`max-height: calc(100vh - 80px)`，内容多时卡内滚动。
- 门禁量了卡片与输入框/发送按钮的矩形，确认不重叠；点“去操作”后仍可见。
- 用户关闭后，未完成时左下角保留「继续设置 n/4」胶囊，可随时回来。

### 2. 牛马管理局页面删除

- 导航里不再有 `instances` 页；历史状态 `instances` 自动归一化到 `singleAi`，不会白屏。
- 原页面内容（名称、模型、调用链/智能模式、思考级别、社交、删除等）全部搬到
  **设置弹窗**：`openNiuMaSettings(inst)` 复用 `renderInstanceDetail`，弹窗宽度 `min(960px,94vw)`、
  高度最多 88vh、内容区可滚动。
- 入口：**「我的牛马」第二列会话图标右键 → 设置**。
- 创建牛马后也会直接打开这个设置弹窗，不再跳旧页面。
- 删除牛马后弹窗自动关闭，回到列表。

### 3. 第二列顶部图标改为创建牛马

- 顶部马头图标 `lieBiaoHqTuBiao` 的点击从“进入牛马管理局”改为 `addInstanceFlow()`。
- tooltip / aria 文案改为「创建牛马」（10 语言）。
- 空状态里的按钮同样改为创建牛马。

### 4. 引导第 3 步重写

- 旧文案“去牛马管理局点 +”已失效；新文案引导：
  **点清单里的按钮直接创建**（或点第二列顶部马头图标）。
- 点按钮后直接弹名称输入；填写并确认 ⇒ 真实创建 ⇒ 打开设置弹窗。
- 创建状态由 `state.instances.length > 0` 判定，创建后清单自动打勾。
- 10 个语言包的 `startGuide.step.niuma.desc` 同步更新；旧 `guide.*` 键保持为 0。

### 5. 回归

- `verify-r98-onboarding`：**43/0**（含上述四条的行为断言）。
- `verify-model-pick`：**43/0**；`verify-r97-static`：**33/0**；
  `verify-css-consistency`：**8/0**；`run-verify-22 --tier=fast`：**114 项次 · 0 红**。
- 真机复核：右键会话图标弹设置、顶部图标创建牛马、引导第 3 步创建后打开设置、
  引导不自动折叠、右上角不压输入/发送。

---

## 十一、追加：紧急度 / 难易度分离 + 值班者派发计划（2026-10-27）

详见 [`DISPATCH-PLAN-R98.md`](./DISPATCH-PLAN-R98.md)。

### 1. 口径

- **紧急度 P0–P3**：只影响投递/插队/排队/插话方式（停止/加急/插入/排队），
  **不影响挑谁、不影响思考级别、不影响模型**。
- **难易度（重要 × 复杂）**：影响挑执行者、思考级别建议，以及执行者自己勾了智能模式时的 `modelTier`。
- **模型**：由每只牛马自己的设置决定；值班者不能指定，计划里没有 `model` 字段。

### 2. 值班者派发计划

- 候选池：除值班者外、本机、非纯调度、未离线成员（空闲优先，忙碌也进池）。
- 挑人：人设/擅长标签匹配 + 关键词重合 + 空闲/忙碌惩罚 + 序号兜底；默认 2 人，P0 最多 3 人。
- 思考级别：牛马自己选了具体档位 ⇒ 计划写 `auto`（不覆盖）；`auto` ⇒ 按难易度给
  `off/low/medium/high`。
- 插话方式：
  - P0 + 忙碌 ⇒ `stop`：宿主真的 abort 目标在途对话/续派（不停用实例）；
  - P1 ⇒ `urgent`：立即派发；
  - P2 ⇒ `insert`：立即派发；
  - P3 ⇒ `queue`：等目标当前任务结束（最多 30 秒），等不到也派但审计如实记。
- 有排队任务 ⇒ 本轮改接力：stop/urgent 先、insert 次、queue 最后。
- 执行者模型：`executorConfig` 只按该牛马自己的设置解析；它自己勾了智能模式时，
  用**它自己的**链和本地清单按任务 `modelTier` 选第一个，值班者只提供难易度。

### 3. 验证

- 新增 `verify-zhi-ban-pai-fa`：**36/0**。
- `verify-r48-heiban`：**67/0**
  - 派发计划 2 人、`modelLocked`、无 `model`；
  - 高难任务计划 `thinkLevel=high`，执行者请求真的带 `thinking_level=high`；
  - P0 + 忙碌目标，宿主 `stopInstanceTask` 真的被调用。
- `verify-router-queue` 19/0、`verify-r48-qiyue` 29/0、`run-verify-22 --tier=fast`
  **114 项次 · 0 红**。

### 4. 边界

- 值班者**自答已改用它自己的模型设置**（没有配置时回落群/全局）；执行者各自按自己的设置。
  审计 `group.duty-config` 记 `fromInstance`。
- 挑人是宿主规则（可预测/可测试），不是让值班者 LLM 自由输出 JSON 计划。
- 执行者数量固定 2（P0 最多 3），不按任务规模动态变化。
- 忙碌判定只认主进程在途对话/续派；后台子进程/外部系统任务不算。
- 计划暂未在聊天界面单独展示；可通过返回值和审计查看。
- 难/杂阈值：nan≥4 记“难”、za≥4 记“杂”；3 归入“易/简”（3 分仍有 mid/medium 成本）。

---

## 十二、追加：难易 / 杂简 双维分诊（2026-10-27）

详见 [`DIFFICULTY-NANZA-R98.md`](./DIFFICULTY-NANZA-R98.md)。摘要：

- **难/易**：单步计算/推理本身难度。难（nan≥4）→ 高模型；中（3）→ mid；易（≤2）→ low。
- **杂/简**：步骤多、要拆分、子任务关联复杂。杂（za≥4）→ 高思考；3→medium；2→low；1→off。
- **急/缓**：P0/P1=急、P2/P3=缓；只影响投递/插话，**不改模型/思考**。
- **八组合**都实现并断言：难杂急、难杂缓、难简急、难简缓、易杂急、易杂缓、易简急、易简缓。
- **顶模型仍可能失手**：nan≥5 / 低置信（<0.6）/ 高重要（≥4）时，即使任务“简”也把思考抬到 high；
  难任务思考至少 medium。
- 模型分诊输出 `nan/za/importance/confidence/reason`；单聊 `chatSend` 带 urgency；
  本地启发式分别估 nan 与 za，不把步数当难度、不把难度当步数。
- 门禁：`verify-zhi-ban-pai-fa` **36/0**（八组合 + 急缓不影响模型/思考 + 顶模型低置信提思考）；
  `verify-r48-heiban` **67/0**；`run-verify-22 --tier=fast` **114 项次 · 0 红**。

### 其他已完成的欠账

- **值班者自答模型**：已改为用它自己的模型设置（无配置回落群/全局）；审计 `group.duty-config`。
- **实例上限**：最低抬到 10（逻辑核数夹 10..16），8 核机器也能建 10 只牛马。
- **群执行者智能模式**：执行者自己勾了智能模式时，按任务 `modelTier` 在它自己的链上选模型；
  值班者只提供难度，不能指定模型。
