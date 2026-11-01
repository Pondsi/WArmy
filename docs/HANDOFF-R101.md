# 第 101 轮交接（2026-10-27）  
## 话筒菜单 / 操作浮雕 / 登录窗位置 / 引导去聊天 / 嵌套滚动 / 授权无超时 / nm 编辑器历史 / 过程引用 / nm 打开矩阵 / 项目停止 / 旧台账

> 本文只写**本轮真实改了什么、为什么、怎么验证、还剩什么**。  
> 需要用户拍板或需要屏幕确认的事项在 [`OPEN-ITEMS-R101.md`](./OPEN-ITEMS-R101.md)；本轮没有把“没做”写成“已完成”。

---

## 0. 一句话结论

本轮 20 项中，1–9、11–14 已落地并有门禁/真机证据；第 10 项（浏览器内核）按调研结论**不建议换火狐内核**，原因与替代方案见 §3；第 15/16 项是**必须由用户屏幕确认或需要产品拍板**的事项，详见 `OPEN-ITEMS-R101.md`；第 17 项的真实 5 轮验收、第 18/19 项文档、第 20 项删配置首启在交付时完成。

---

## 1. 验证矩阵（可复跑）

| 项目 | 结果 | 证据 |
|---|---|---|
| 新门禁 `verify-r101-changes` | **54/54 全绿** | 含 11 条负向变异；覆盖话筒/浮雕/窗口位置/引导/滚动/超时/nm 编辑器/过程引用/打开矩阵/项目停止/旧停止/旧 xd1 |
| fast 全量（静态+渲染层） | **3 遍 351 项次 0 红** | `node dev/gates/run-verify-22.mjs --times=3 --tier=fast`；第 101 轮门禁已进 FAST 清单 |
| 真实模型连续 5 轮 | **27/0 首轮通过** | `dev/gates/r101-live-5-rounds.mjs`；MiMo + 本地 Ollama，未使用 DeepSeek key |
| 真实项目中途停止 | **通过** | 项目 `g-r101m-*`：2 个操作后停止；`chatSend` 立即返回 `{stopped:true, tools.tingZhiYuanYin:'user-stop'}`；停止后 20 秒**新增操作 0**；`chatMessages` 里同一条 stopped 消息带 3 段 `reasoningDuan` 与 2 条 `xingDong` |
| nm 打开矩阵（已安装/插件启用） | **通过** | 左键：启用=nm / 未启用=系统；右键相反；未启用右键菜单可正常弹出 |
| nm 卸载后的矩阵 | **通过** | 卸载后 `nmFileRemoved=true`、插件不在清单、启用勾选 disabled、按钮显示「安装nm查看器」；左键/右键都打开记事本、nm 窗口 0；点安装后插件恢复、勾选可用、按钮变「重装nm查看器」 |
| 引导第 3 步「去聊天」 | **通过（第 102 轮已改口径）** | 第 101 轮当时要求收起引导卡；第 102 轮用户改为“引导卡永不自动最小化”，实现与验收见 `HANDOFF-R102.md` |
| 首启（删配置后） | **通过，等待用户验收** | 备份 929,157 字节 / 175 条目 / 含 `settings.json`+`auth/vault.json`；删除后首启 `setupDone=false`、0 会话、语言页 10 种语言+开始、无旧引导 |
| 登录后窗口位置 | **通过** | 首启适配把窗口居中到 `(1080,296)`；把窗口移到 `(600,420)` 后完成登录，仍停在 `(600,420)`，尺寸恢复 1280×800 |
| 话筒下拉 | **通过** | 话筒右缘 = 箭头左缘（gap 0）；菜单完整高度 88px、顶部 656 > 输入区顶 650，不再被裁切；两个问号各 18×18 |
| nm 聊天编辑器撤销/前进 | **通过** | 打开后正文自动聚焦；输入后「后退」由灰变可点；后退恢复原文、前进恢复修改文 |
| 嵌套滚动链接 | **通过** | 合成 DOM：内层到底后滚轮让外层 `scrollTop` +60；内层未到边界时外层不动 |
| 操作记录浮雕 | **通过** | 展开后外层 `.xingDongZu` 有 `box-shadow`/边框，标题行 `box-shadow:none`，明细有顶部分隔线 |

> 注：fast 三遍与真实 5 轮的最终数字以交付时日志为准；本文不提前写“预计”。

---

## 2. 逐项改动

### 2.1 项 1：话筒下拉箭头 / 弹层被挡 / 勾选项说明

**现象**：话筒和下拉箭头之间有缝；点箭头后菜单只露出下半截；两个勾选项下面各铺一行说明，占版面。

**根因**：
- `.shuRuQuZhu` 是输入框外框，CSS 写了 `overflow: hidden`；语音菜单挂在工具条上、用 `bottom: calc(100% + 8px)` 向上展开，顶部被输入框裁掉。
- 工具条 `.shuRuQuFaSongHang` 有 4px `gap`，话筒与箭头因此分开。
- 说明文字是独立 `div`，不是问号悬停。

**改法**：
- `app.css` / `renderer.css` 的 `.shuRuQuZhu` 改为 `overflow: visible`（textarea 背景透明，不影响圆角）。
- `.yuYinDd { margin-left: -4px }`，抵消话筒与箭头之间的 gap；发送按钮前仍保留间距。
- `index.html`：两个勾选项改为 `.yuYinHang` 行（左 label、右 `?`），说明放进 `.ddDesc`；保留“无整理模型”的警告行（它不是选项说明）。
- 问号沿用项目已有的 `.ddWen` / `.ddDesc`（悬停/聚焦/点击展开），不再新造一套。

**位置**：`packages/app-shell/src/renderer/index.html`（`#yuYinCaiDan`）、`app.css`、`renderer.css`。

### 2.2 项 2：操作记录展开后的明细要包在浮雕里

**现象**：折叠时操作行有凸出浮雕，展开后明细掉在浮雕外面，看起来像两块。

**根因**：浮雕写在 `.xingDongHang`（标题行）上，展开的 `.xingDongXiang` 是它的兄弟节点；`renderer.css` 还把 `.xingDongZu` 重置成无边框/无阴影。

**改法**：用 `:has()` 在**明细展开时**把整条 `.xingDongZu` 变成浮雕卡；标题行让位（`box-shadow:none`/无边框），明细与标题同一张卡、有分隔线；折叠时仍由标题行自带浮雕。悬停抬起也改到整条卡上。

**位置**：`renderer.css`（`.xingDongZu:has(> .xingDongXiang:not(.yinCang))` 一组规则）。

**验证**：合成 DOM 量到外层 `box-shadow` 含 inset、标题行 `none`、明细 `border-top` 1px；门禁负向删掉选择器会变红。

### 2.3 项 3：首启登录完成后窗口不再跳回中间

**现象**：注册/登录页把窗口拖到某处，完成登录后窗口跳回屏幕中间（或缩窗前的旧坐标）。

**根因**：首启适配 `warmy:shouQiChuangKouShiPei` 会保存 `shouQiYuanKuang = win.getBounds()` 并把窗口居中；登录完成 `warmy:shouQiChuangKouWanCheng` 旧代码把 `shouQiYuanKuang` **整块**（含 x/y）还原，用户在登录页挪的窗口全部白费。

**改法**：完成时只还原**尺寸**与可缩放/可最大化能力；x/y 取 `win.getBounds()` 的当前值，并按当前显示器工作区夹紧。旧整块还原路径已删除。

**位置**：`packages/app-shell/src/electron-main.ts`（`warmy:shouQiChuangKouWanCheng`）。

**验证**：真机移动窗口 → 适配 → 再移动 → 完成登录，坐标保持 `(600,420)`（见 §1）。

### 2.4 项 4：引导第 3 步「去聊天」关闭弹窗

**改法（第 101 轮当时）**：`sgGoChat()` 打开会话后调用 `sgMinimize()`，引导卡收起（未完成时仍保留右下角「继续设置」胶囊，便于回来）。焦点仍落到输入框。

> **第 102 轮用户改口径**：引导卡永远不自动最小化；点「去聊天」只关掉挡住聊天的设置页/创建牛马弹窗/牛马设置弹窗，引导卡保持展开。`sgGoChat` 已删除 `sgMinimize()`，详见 [`HANDOFF-R102.md`](./HANDOFF-R102.md)。

**位置**：`app.js`（`function sgGoChat`）。

### 2.5 项 5：嵌套滚动条触顶/触底向外交接

**根因有两层**：
1. 多处以 `overscroll-behavior: contain` 主动切断了链式滚动（第四列授权/计划卡、聊天排队列表、认证条款/助记词框、nm 代码/正文区）。
2. Chromium 对滚轮做 **scroll latching**：一次手势锁定一个容器，内层到底后同一手势不会自动换目标——即使 CSS 是 `auto`，也要松手再滚才可能带动外层。

**改法**：
- 四处 CSS 的 `contain` 全部改 `auto`（或移除），不再主动掐断。
- `app.js` 新增 `bindScrollChain`：捕获阶段监听 `wheel`；找到离目标最近的**确实可滚动**容器；只有它已在顶/底且方向继续向外时，才把**剩余 delta**交给最近的可滚动祖先；祖先也动不了就不拦截（不吞事件、不重放整段 delta）。支持 `deltaMode`（行/页→像素）。
- 没有使用 `preventDefault` 抢占正常滚动；只处理边界。

**位置**：`app.css` / `renderer.css` / `auth-gate.css` / `nm-viewer.css`；`app.js`（`bindScrollChain`）。

**验证**：合成嵌套 DOM 真机测到外层 +60 / 未到边界 0；门禁断言四份 CSS 无 `contain` + wheel 兜底存在。

### 2.6 项 6：授权卡/选项卡永不超时替用户选择

**发现的两处真实超时**：
- `qingQiuKaPian` 默认 `24 小时` 超时，超时返回 `''`；
- 两处权限审批 `dengdaiPizhun` 在 `30 秒` 后自动 `{allowed:false, scope:'deny'}`；
- 渲染层第二列问号角标还有“超过 24 小时不再显示问号”的过滤。

**改法**：
- `qingQiuKaPian` 默认 `timeoutMs = 0`（不超时），`dengDaiKaPian` 只在 `>0` 时检查时间。
- 删除两处 30 秒自动拒绝。
- 等待函数新增两种**非用户选择**的结束：会话被用户明确停止 → `__stopped__`；卡片被宿主取消 → `__cancelled__`。调用方把它们映射成“拒绝（用户已停止本轮）/（卡片已取消）”，**不冒充用户点过选项**。
- 停止时把本会话所有 pending 卡 `aiQuestions.cancel`（UI 收起，不写同意/拒绝）。
- 渲染层问号角标只看 `status==='pending'`，不再按 24 小时隐藏。

**位置**：`electron-main.ts`（`qingQiuKaPian` / `dengDaiKaPian` / `warmy:qingQiuPiZhun` / `onApprove` / `warmy:tingZhiDuiHua`）；`app.js`（第二列角标）。

**研究依据**：OAuth 过期的是授权码而不是人的思考时间；GitHub 部署保护可等 30 天且超时默认“未获批”；WCAG 2.2.1 要求时限可关闭/可延长；GDPR 要求明确的肯定动作。见 §9。

### 2.7 项 7：聊天编辑器里撤销 / 后退 / 前进可用

**现象**：点聊天框下方“文本编辑器”后，nm 查看器里的撤销/后退/前进是灰的。

**根因**：`nm-viewer.js` 的 `yiXiuGai()` 在 `chatEditor` 分支里只同步内容、**直接 return**，从不压历史；进入时只有一条初始快照，所以两个按钮全灰。另外恢复历史时直接改 `textarea.value`，不会触发 `input`，聊天框收不到同步。

**改法**：
- chatEditor 分支也按 600ms 防抖 `tuiRuLiShi(zt.luJing, value)`（仍不写文件、不设脏标记）。
- `huiFu()` 在 chatEditor 恢复内容后补发 `input` 事件，聊天框实时跟随。
- 打开编辑器后 `#wenBen` 自动聚焦，Ctrl+Z 立刻作用于正文。
- 保留工具栏「撤销 / 后退（Alt+←）」的语义：编辑即入历史。

**位置**：`packages/app-shell/src/renderer/nm-viewer.js`。

**验证**：真机输入 → 后退按钮可点 → 后退恢复原文 → 前进恢复修改文；见 §1。

### 2.8 项 8（优先）：最终回复引用中间回复

**问题重述**：牛马把小说、截图内容、lnk 文件解释写在**中间回复**里，最终回复只写“做完了/已答”，用户展开“执行过程”才看得到。

**方案评估（联网调研后）**：
- 让模型在终稿里自己输出 `[[ref:3]]` 这类标记：claim 级精度高，但小模型（尤其 Ollama 7B–8B）容易漏标/乱标/编造 ID；覆盖率不稳定，不能作为唯一保障。
- 纯宿主事后生成：模型无关、确定性强，但只能做到步骤级/段落级归因，且不能替模型写正文。
- 业界成熟产品也不是让终稿复述过程：Claude Code/Devin/Cursor 把过程放在可展开时间线/Replay，终稿只留短引用；Anthropic Citations/OpenAI citation format 都是“模型给来源 ID + 定位符，宿主映射并渲染”。

**本轮落地（采纳用户建议 + 加一层兜底）**：
- 新增 **宿主生成的“过程引用”浮雕卡**，挂在牛马正式回复下方；只有当这一轮真的有 `zhongJian`（中间回复）或 `artifacts`（附件）时出现，流式进行中不画。
- 卡头写明“过程引用 · N 条中间说明 · M 个文件”；展开后按时间列出中间回复原话（最多 8 条，每条带时间/序号，内容 `mdHtml` 原样渲染），底部列本轮文件（可点，走 nm/系统矩阵）。
- **不改模型正文、不改日志、不回注上下文**：展开只是视图层读同一份台账，不会让下一轮重复注入这些原文。
- 这样即使模型完全不会写引用标记，小说/截图/lnk 的解释也一定能在最终回复下方一键展开；后续可再加“模型标记 + 宿主校验”的 inline chip（见 OPEN-ITEMS）。

**位置**：`app.js`（`guoChengYinYongHtml` + 调用点）、`app.css`（`.guoChengYinYong`）、10 个 i18n 语言包的 `chat.processRefs*`。

> **第 105 轮已废弃**：用户指出“过程引用”做法不对，已删除该卡/样式/文案，改为用中间回复把执行过程切成多段（每段默认折叠，中间回复本身默认展开的浮雕卡）。见 `HANDOFF-R105.md`。

**验证**：用用户上一轮真实会话（7 条 `zhongJian`）在真机渲染出 1 张卡；展开后 7 条原话逐条可见；门禁断言函数/调用/样式/10 语言文案。

### 2.9 项 9（反复修）：nm 打开矩阵

**真正的根因**：主进程 `warmy:daKaiLuJing`（界面“系统默认打开”）在 `nm-file` 插件启用时**无条件改投 nm**。于是：
- 左键不管设置都开 nm；
- 右键“打开”（本应系统）也被改投 nm；
- 第四列项目文件直接调 `daKaiLuJing`，同样永远是 nm。

**改法**（把“策略”收敛到一处，主进程只执行“系统默认”）：
- `warmy:daKaiLuJing` 删除 nm 改投，永远 `shell.openPath`（目录/文件都走系统）。
- 渲染层新增 `daKaiWenJianAsync(p)`：
  - 插件可用（未卸载且插件启用）**且** `state.nmKaiWenJian === true` → nm；
  - 其它 → 系统默认；nm 打开失败回落系统。
- 左键：`daKaiWenJian` / 第四列 `daKaiHuoDingWei` 都走这个决策；目录仍走系统（查看器不显示目录树）。
- 右键：`shouWenJianYouJianCaiDan` 用 `nmChaJianKai() && state.nmKaiWenJian !== true`，与左键一正一反。
- 未安装/已卸载（`nmFileRemoved`）→ 插件不可用、启用勾选禁用、左右键都系统默认。
- 第四列目录行加 `data-dir="1"`，避免对目录尝试 nm。

**位置**：`electron-main.ts`（`warmy:daKaiLuJing`）、`app.js`（`daKaiWenJianAsync`/`daKaiHuoDingWei`/右键菜单）。

**真机矩阵（已安装且插件启用）**：

| 启用勾选 | 左键 | 右键 → 打开 |
|---|---|---|
| 未勾选 | 系统默认（记事本） | nm |
| 勾选 | nm | 系统默认（记事本） |

**真机矩阵（已卸载）**：插件页删除 `nm-file` → `nmFileRemoved=true`；功能页启用勾选 `disabled`、按钮变「安装nm查看器」；左键与右键**都**打开系统默认（记事本），nm 窗口 0；点「安装nm查看器」后插件恢复、`nmFileRemoved=false`、勾选可点、按钮变「重装nm查看器」。

### 2.10 项 11/12：项目（群聊）停止真实 E2E + 晚到结果只收不执行

**已有基础（第 100 轮）**：`stoppedSessions`、停止世代、`isStopped`、`qunZhiXingZhe`、执行者 `onExecutorStart/End`。

**本轮真机验证**（不是 mock）：
- 建项目 → `groupJoinInstance` 加入本机牛马 → `chatSend` 长任务（要求 6 步工具）；
- 在出现 2 个操作（`plan_update`、`write_file`）后调用停止；
- 结果：
  - `chatSend` 1 秒内返回 `{ok:true, reply:'', stopped:true, tools:{tingZhiYuanYin:'user-stop'}}`；
  - 项目聊天日志只有 1 条 stopped 牛马消息，带 3 段 `reasoningDuan`、2 条 `xingDong`；
  - **停止后 20 秒新增操作 0**；
  - 没有新的 assistant 消息、没有自动续派。
- 晚到的供应商文字：本轮模型在中止后没有继续吐字；代码层由停止世代 + `benLunBeiTing` 守卫拦在写日志/续派/新工具之前；如果供应商仍返回文字，只会进入已折叠现场，不会触发新操作（这也是 R100 的 `chat.stop-guard-*` 与工具入口守卫）。
- 供应商端是否继续计费：本地能做的就是立即 abort/丢弃；没有统一的供应商 cancel API（见 OPEN-ITEMS）。

### 2.11 项 13（R100-4）：旧停止消息标记

**问题**：R100 之前没有 `stopped` 字段，旧停止消息重启后会被当正常回复；旧代码只认句首 `（已停止`。

**改法**：
- 主进程 `shiTingZhiZhanWei()`：只认**句首**的“已停止 / (Stopped”或**句尾**的“（已停止…）”，避免正常正文里提到“已停止”被误标。
- `chatMessages` 返回给界面前：`e.stopped === true || shiTingZhiZhanWei(e.content)`。
- `yingYongMeta` 回填：meta 里没有 stopped、但正文是旧停止占位 → 补 `stopped:true`。
- 渲染层 `shiTingZhiZhanWeiWen()` 对从主进程回来的消息再兜底一次。
- 旧占位文案仍然保留可见；不会用猜的替用户补正文。

**局限**：如果旧消息既没有 stopped 字段、正文也没有任何停止标记（例如部分正文被旧代码整段覆盖），无法事后区分“正常短回复”和“停止”，不会硬猜。

### 2.12 项 14（R100-5）：旧 xd1 台账

**问题**：R100 之前行动 id 每轮从 `xd1` 重新计数，跨轮/跨重启重号；台账 `xingDongJi` 按 `hao` upsert，于是后一轮的 `xd1` 会覆盖前一轮的同号条目，执行过程少几条、状态还是上一轮的。

**本轮改法**：
- 从主进程回读历史操作时，旧格式 `^xd\d+$` 一律拼上消息时间戳作为**展示用唯一键**（`xd1@<ts>`），新格式 `xd-<时间>-<序号>` 原样保留。
- 台账 upsert 对旧格式只合并“仍处于 running 的同号行”（start→finish）；上一轮已结束的同号条目不再被并进去。
- 新行动 id 从 R100 起已唯一，不再产生新碰撞。

**不可恢复的部分**：如果旧 `chat-meta.json` 里两条不同轮次的操作已经被旧代码合并成一条，合并时丢失的字段/操作无法凭现有文件还原；本轮只保证**以后不再丢**，旧数据能显示多少显示多少。

### 2.13 项 10：nm 查看器内核 / 网页内容

结论见 §3；代码未换内核，也未关闭任何安全策略。

---

## 3. 第 10 项调研：nm 是什么内核？为什么网页看不了？要不要换火狐？

### 3.1 事实

- nm 查看器是 **Electron 窗口**，运行时是 **Chromium/Blink + Node.js**；当前仓库 Electron `40.10.6`，对应 Chromium 144 分支、V8 14.4、Node 24.11.1（Electron 40 发布说明）。
- nm 的“网页”模式现在用 `<iframe sandbox="allow-scripts allow-forms allow-popups allow-downloads">` 加载 http/https。很多站点空白不是内核不对，而是目标站用 **X-Frame-Options** 或 CSP **frame-ancestors** 禁止被 iframe 内嵌；Gecko/WebKit 也会执行同样的 HTTP 策略，**换内核不能绕过**。
- 跨站 iframe 还是第三方上下文，`SameSite=Lax/Strict` 的 Cookie 不会发送；未开 `allow-same-origin` 时页面是 opaque origin，登录态/存储也会受限。所以“白屏”和“登录不上”是两件事。
- Chromium/Blink、WebKit、Gecko 是主流内核；桌面可嵌入方式：
  - Chromium：CEF、WebView2（仅 Windows）、Electron；
  - WebKit：WKWebView（macOS/iOS）、WebKitGTK（Linux）；
  - Gecko：**没有官方支持的桌面嵌入 API**；GeckoView 只面向 Android；XULRunner 2015 年停止支持；GeckoFX 停在旧版。
- Firefox/Gecko 主体是 **MPL 2.0**，允许商用、可闭源附加代码；修改过的 MPL 文件要公开；Firefox 名称/图标受商标政策限制。**开源免费商用 ≠ 有可嵌入桌面的稳定 SDK**。
- Tauri 在 Windows 用 WebView2、macOS/iOS 用 WKWebView、Linux 用 WebKitGTK，**没有 Gecko 后端**；“改用 Tauri”也换不到火狐内核。
- Electron 官方明确 `<webview>` 稳定性受影响、目前不建议使用；`BrowserView` 已废弃，官方现代 API 是 `WebContentsView`。

### 3.2 为什么 nm 不能直接换火狐内核

- Electron 没有可插拔内核；换 Gecko 等于换应用壳 + 自建 Gecko 嵌入层（host、焦点、输入法、GPU、sandbox、codecs、DRM、a11y、更新），不是“改一个配置”。
- 桌面 Gecko 没有 Mozilla 支持的嵌入 API；GeckoView 只在 Android。
- 现实可行的“火狐”只有：系统/打包 Firefox **外部打开**（不再是内置查看器），或自建 Gecko 嵌入层（多人年投入，仍可能追不上安全更新）。最坏情况是锁在旧 Gecko、失去安全更新，或者内置查看器名存实亡。

### 3.3 建议

1. **不换内核**；白屏问题用“换上下文”解决，而不是换引擎。
2. 远程网页从 iframe 提升为**顶层 WebContents**：优先 `WebContentsView`（Electron 40 可用），或独立 BrowserWindow；`<webview>` 只作为过渡（官方不推荐）。
3. 远程 WebContents 必须：`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、不给 preload、限制导航/新窗口、默认拒绝权限；不要关 `webSecurity`。
4. 本地 HTML 预览继续用 iframe/srcdoc（允许内嵌、需要同源排版）。
5. Electron 40 已出支持窗口（2026-10 最新 45.x，Chromium 156），安全债应排期升级；这与 iframe 白屏无关。

> 结论：用户希望“用火狐内核”的诉求，技术上没有可交付的桌面嵌入路径；本轮没有假装换内核。若必须“看起来像 Firefox”，只能外开 Firefox，代价是失去内嵌体验。详见 `OPEN-ITEMS-R101.md` §M 的方案对照。

---

## 4. 旧数据与兼容

- 旧停止消息：见 §2.11；无法区分的旧数据不硬猜。
- 旧 xd1 台账：见 §2.12；已被旧代码合并丢失的字段无法还原。
- 旧 `nmKaiWenJian` 设置：保持原值；插件安装/卸载标记 `nmFileRemoved` 继续生效。
- 旧 `chat-meta` 的 `stopped` 认领仍按 ±5 秒时间相邻，正常回复不会被误标。

---

## 5. 删除配置 / 首启 / 恢复

- 删除前备份真实 profile：`%TEMP%\warmy-profile-before-r101-20261027-231434.zip`（929,157 字节 / 175 条目；含 `settings.json`、`auth/vault.json`、会话、工作区、身份与授权）。
- 删除目录：`%APPDATA%\@warmy\app-shell`。
- 启动后已确认停在**语言选择页**（简体/繁體/English/日本語/한국어/Русский/Español/Français/Português/Esperanto + 「开始」），`setupDone=false`、`hasAccount=false`、0 会话、无旧引导层。
- 恢复：退出应用 → 解压备份 → 覆盖 `%APPDATA%\@warmy\app-shell` → 重启。
- 备份里含**真实凭据/身份材料**，不要上传、不要提交仓库。

---

## 6. 复跑命令

```bash
# 构建
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/copy-assets.mjs
node scripts/check-syntax.mjs

# 本轮门禁（54/54）
node scripts/verify-r101-changes.mjs

# fast 全量 3 遍
cd ../..
node dev/gates/run-verify-22.mjs --times=3 --tier=fast

# 真机停止（应用需以 --remote-debugging-port=9888 启动；脚本在 dev/gates）
node dev/gates/r100-live-5-rounds.mjs
```

> 真实模型只用 MiMo（`mimo-v2.6-flash` / `mimo-v2.6-pro`）与本地 Ollama；**没有使用用户另外提供的 DeepSeek key**。

---

## 7. 未完成 / 需要协助

见 [`OPEN-ITEMS-R101.md`](./OPEN-ITEMS-R101.md)。里面按“需要用户屏幕确认 / 需要产品拍板 / 需要真实账号或第二台设备 / 需要预算或证书”分类，每项都有：干什么、有什么用、现状、可选方案、例子、优缺点、最坏情况、需要用户做什么。

---

## 8. Sources（第 10 项与设计依据）

- Electron 40 发布说明：https://www.electronjs.org/blog/electron-40-0
- Electron 支持策略：https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- Electron webview tag（官方不推荐）：https://www.electronjs.org/docs/latest/api/webview-tag
- Electron WebContentsView：https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron Security：https://www.electronjs.org/docs/latest/tutorial/security
- MDN X-Frame-Options：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
- MDN CSP frame-ancestors：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
- GeckoView（仅 Android）：https://mozilla.github.io/geckoview/
- Mozilla qbrt issue #182（Gecko 无桌面嵌入 API）：https://github.com/mozilla/qbrt/issues/182
- MPL 2.0 FAQ：https://www.mozilla.org/MPL/2.0/FAQ/
- Mozilla 商标政策：https://www.mozilla.org/en-US/foundation/trademarks/policy/
- Tauri Webview Versions：https://v2.tauri.app/reference/webview-versions/
- MDN overscroll-behavior：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior
- Chrome scroll latching：https://chromestatus.com/feature/5728708706959360
- WCAG 2.2.1：https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- OWASP Transaction Authorization：https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
- Anthropic Citations：https://platform.claude.com/docs/en/build-with-claude/citations
- OpenAI Citation Formatting：https://developers.openai.com/api/docs/guides/citation-formatting
- Claude Code Desktop：https://code.claude.com/docs/en/desktop
- Devin Session Tools：https://docs.devin.ai/work-with-devin/devin-session-tools
