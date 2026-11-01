# 第 97 轮交接（2026-10-26）

> 本轮处理 11 项：助记拼音去重、聊天滚动/下箭头/新内容规则、工具记录时序、二进制编辑提示、
> nm 菜单/分栏、窗口吸附与新窗口落点、模型路由、默认工作区、未完成清单。
> 未完成/待拍板见 [`OPEN-ITEMS-R97.md`](./OPEN-ITEMS-R97.md)。

---

## 一、逐项结果

### 1. 助记拼音：只保留拼音本体

**原状**：勾选「助记拼音」时每个格子同时渲染英文 BIP-39 词（主题色）+ 中文 + 拼音，
用户看到的确实是「两遍助记词」。

**改法**（`auth-gate.js` `mnemonicMarkup` + `auth-gate.css`）：
- 勾选拼音时**不再渲染英文行**；拼音是唯一助记词本体，使用 `var(--accent)` 主题色、加粗、第二行；
- 中文码字上移，与序号并排（第一行）；序号/中文仍是低调灰；
- 未勾选时仍显示英文 BIP-39 词（主题色），行为不变；
- 主题色取当前主题（实测首启为 `#A87654` → `rgb(168,118,84)`，不再写死旧的 `#a4552f`）。

**门禁**：`verify-r67-firstrun` 80/0；`verify-r96-ui` 35/0；`verify-r97-live` A 段；
`verify-r96-live` 17/0（颜色断言改为"与中文灰不同色"，不再写死 RGB）。

### 2. 下箭头到不了最底部

**根因**：点击处理器先 `markUserScrolled()`（把当前会话置为"用户接管"）再 `scrollToBottom(true)`。
下一帧任何重画都按"用户接管"恢复旧 `scrollTop`，所以永远差一截；平滑滚动还可能被 DOM 变化打断。

**改法**：
- 下箭头/新内容气泡只调用 `scrollToBottom(false)`：**先解除接管**，设 `forceBottom=true`，立即滚到 `scrollHeight`；
- 渲染、流式、`guiNaXingDong` 之后都重新应用最终滚动状态；
- 到最底后清 `forceBottom`（下箭头只负责这一次到底），后续新内容仍按"未勾选首行置顶"处理；
- `#scrollDiAnNiu` 在距底 ≤32px 时隐藏，不再出现"看起来到底了但箭头还在/点了没用"。

**实测**：`verify-r97-live` 点击后 `gap=0`、箭头隐藏。

### 3 / 11. 未勾选自动滚动时，新回复仍然抢滚动

**三个真根因**：
1. `renderChat` 开头只要 `chatScrollPos` 里有本会话旧位置，就**无条件**把本次重画改成
   `keepScroll:true` —— 同会话的每次新内容重画都被"保留旧位置"覆盖，锚点/追底永远不执行。
2. `tuisongXiaoxi` 在 `role='wo'` 时清掉 `topAlignSuppress` —— 用户上翻旧记录后发一句话，
   新回复就被顶部对齐拽走。
3. 旧实现用 **180ms 时间窗**区分程序/用户滚动；连续流式刷新每 <180ms 续一次保护期，
   用户拖动滚动条产生的 scroll 事件永远落在"保护期"内，被当程序滚动；之后重画就抢位置。

**改法**：
- `chatScrollPos` 只在**切换会话**（DOM 的 `data-chat-sid` 与新会话不同）时恢复；同会话重画以当前 DOM 位置为准；
- 用户接管状态只有两种解除方式：**用户自己滚回底部**（距底 ≤32px）或**点下箭头**；发新消息不再解除；
- scroll 事件改为**目标值比对**：程序滚动记 `chatZiGunTop`，位置对不上 >2px 且不在底部即判用户接管
  （覆盖拖滚动条、连续流式刷新续保护期）；整块重建期间用 `chatRebuilding` 忽略 `innerHTML=''` 的副作用；
- 新增会话级状态 `chatGun[sid]`：`anchorTurn/anchorTop/anchorEl`（未勾选首行锚点）、
  `followBottomTurn`（用户中途自己回到底部）、`forceBottom`（下箭头）；
- 未勾选 + 没接管：本轮新内容第一次出现时，把**新内容第一行**钉在视口顶部；之后内容向下长，不再挪动；
- 勾选自动滚动：始终到底；
- 用户中途自己滚回底部：本轮余下内容跟随到底；下一轮重新按"未勾选首行置顶"；
- 锚点存**元素**（`anchorEl`），每次重新量；`guiNaXingDong` 增删操作行后、字体/长文最终布局后
  （rAF + 140ms）再应用一次，避免差 210px 这类"锚点偏移"；
- 用户上滚后：整块重画、流式追加、局部操作行重排都恢复原 `scrollTop`（一个像素不动）。

**门禁**：`verify-r97-live` B 段 21/0（含滚轮上滚、**直接改 scrollTop 模拟拖滚动条**、
首行置顶 ±8px、勾选自动滚动到底）；`verify-r94-ui-live` 28/0；`verify-r96-live` 17/0；
`verify-r78-scroll` 6/0；`verify-r94-ui` 27/0。

### 4. 工具记录仍在底部 / 不与思考穿插

**根因**（真实测试会话取证：两段回复、43 条操作）：
- 每条内部续派轮（`kai:true`）都调用 `yunXingZhuangTaiKai`，其中 `shouHuiHuaLiu` + `siKaoQing`
  把本轮的 `streamInterim` 和思考分段**整轮清空**；最终回复只剩最后一段甚至 0 段；
- `guiNaXingDong` 把**整个会话**的操作台账全部塞给"最后一条回复"；一段里没有分段时，
  所有操作自然排在单块思考之后（看起来就是全在底部）；
- 最终消息 `reasoningDuan=[]` 时，没有可穿插的段落。

**改法**：
- 内部续派只重置"这一发请求"的流式缓冲；思考分段/中间回复保留到本轮真正结束；
- `role='them'` 的系统消息不再清空思考分段；
- **主进程也攒一份**思考分段（`ZHU_SI_KAO_DUAN`）：收到 reasoning 增量追加、工具开始即封段，
  最终 assistant 日志和 `chatSend` 返回值都带 `reasoningDuan`；页面刷新/重启/渲染层丢内存也能恢复；
- `guiNaXingDong` **按时间把每条操作归到它当时所属的那条回复**（早于某条回复结束时间 ⇒ 归那条；
  晚于所有正式回复 ⇒ 归正在流式的那条），不再全部塞最后一条；
- 旧数据只有一块 `data-ts=0` 思考时，新增 `chaiDanSiKao`：按本轮用户消息→最终回复的时间比例，
  在最近换行处切段（不改原文，只影响显示），操作就能插进思考之间；
- 所有插入完成后再应用一次滚动状态，避免操作行改变高度把锚点/底部顶开。

**真实会话复核**（原测试 profile 副本，牛马-2）：
- 第一条回复：32 条操作、23 个思考段，DOM 顺序为「执行过程 → 思考 → 工具 → 思考 → …」；
- 第二条回复（原 `reasoningDuan=[]` 的 20k 思考）：11 条操作、11 个 `siKaoGuSuan` 段，
  工具分别插在思考之间，不再堆在最底部。

**门禁**：`verify-r97-live` C 段（合成两轮回复 + 旧数据单块思考）全绿；
`verify-r67-chat-order` 20/0；`verify-r97-static` 断言主进程攒段/内部续派不清空/按回复归属。

### 5. 二进制编辑框空框提示

**改法**（`nm-viewer.js` `kaiShiLiuShuRu`）：输入框保持空值，但 `placeholder` 显示当前字节的两位十六进制
（如 `AB`），`title` 写「原内容：AB」；不再给用户"这个字节被清空了"的错觉。

**门禁**：`verify-r97-nm-live`（`.bin` 首字节 `AB`，点开后 `hidden=false/value=''/placeholder='AB'`）。

### 6. nm 展开菜单点外部/同按钮收起

**根因**：document 捕获阶段的 mousedown 把整个 `#gongJuLan` 排除了，
所以点工具栏空白/其他按钮不收起；同按钮的 click 又无条件重新展开。

**改法**：
- `kaiCaiDan` 检测"同一个 anchor + 同一个菜单类型"再次调用 ⇒ `guanCaiDan()`；
- document mousedown 只放行"当前展开按钮"（交给 click 做切换）和菜单内部；其余任意位置都收起；
- 其他工具栏按钮先收起旧菜单，再打开自己的菜单。

**门禁**：`verify-r97-nm-live`（同按钮 m1=true→m2=false；点外部 m3=true→m4=false）。

### 7. 窗口吸附与新窗口落点

**改法**（`nm-viewer-win.ts`）：
- 新 nm **永远**贴主窗口右侧：`x=主窗右边缘`、`y=主窗顶边`、`height=主窗高度`；
  不再沿右侧链继续往右排；
- 只有「主窗开着吸附 + 主窗右边那条边还空」才默认吸附；
  右边已被先来的 nm 占用 ⇒ 新窗仍开在同一位置、**叠在**已有窗口上，但不吸附、不挤掉先来的连接；
- 拖动分组时**主窗是锚点**：拖主窗带走整组；拖 nm 不反向拖主窗（连通分量循环里也排除主窗 id=-1）；
- 拖 nm 离开 > 吸附阈值时只断开那条连接，不会把主界面一起拽走。

**门禁**：`verify-r97-nm-live` 17/0（Windows `SetWindowPos` 真实移动：
主窗右移 60px → nm 跟着 +60；拖 nm +10px → 主窗坐标不变；两扇 nm 同 x/y/h 重叠；
第一扇 `lianJie=[-1]`，第二扇 `lianJie=[]`）；`verify-r81-nm` 52/0；`verify-r67-nm-edges` 35/0。

### 8. 牛马-2 调用链默认 Ollama，却用了 MiMo

**根因**：`model-pick` 旧语义：
- P2（默认）→ 调用链第 **2** 个；
- P3（省着用）→ 调用链**最后** 1 个。
用户链是「21 个 Ollama → MiMo flash → MiMo pro」；简单任务被分诊为 P3，
于是直接选链尾 `mimo-v2.6-pro`。这不是"省"，而是链尾恰好最贵。

**改法**：
- **P2 = 链头**（用户配置的优先级第一，默认 Ollama）；
- **P3 = 链里第一个本地/免费模型**（Ollama），没有本地才回链头；**绝不选链尾付费模型当"省"**；
- **P0/P1 = 链里第一个云端/付费模型**（复杂/重要任务），没有云端才回链头；
- `electron-main` 新增 `lieBenDiMoXing()`，把 Ollama 模型清单传给决策器；
- 牛马设置里的「默认模型」下拉选具体模型时**同时退出智能模式**（旧实现只改 `defaultModel`，
  `smartMode` 仍为 true ⇒ 选型器继续自动挑）。

**真实证据**（用原测试 profile 发一句 `1+1`，审计 `chat.model-picked`）：
```
model: orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K
why: chain-p2    chainIndex: 0
provider: ollama-...   protocol: ollama
```
对比修复前同会话：`mimo-v2.6-pro / chain-p3 / chainIndex:22`。

**门禁**：`verify-model-pick` 34/0；`verify-r97-static` 的 P1/P2/P3 真值表；`verify-model-route` 13/0。

### 9. 默认落点：工作区，不是桌面

**根因**：系统提示把真实桌面/文档/下载路径直接告诉模型，且工具说明反复出现
`Desktop/xx.txt` 示例；模型会为了"方便用户找"自行放桌面。

**改法**：
- 系统提示：工作区标为**默认落点**；明确「用户没有明确说桌面/文档/下载时，新建文件一律用工作区相对路径，
  不要为了"方便用户找"自行放到桌面」；真实目录仍保留，但只在用户点名时用；
- `write_file` 工具说明：默认且优先工作区；用户未明确要求时**禁止**使用 `Desktop/…`；
  路径参数示例改为 `identity.txt`，只有用户明确要桌面才用 `Desktop/identity.txt`；
- 宿主兜底（`chat.default-workspace-fixed`）：写/建/生成类工具如果落到系统桌面/文档/下载，
  而本轮用户原话**没有**点名这些目录、也没有给绝对路径、且不是本任务已落在那里的同一交付物，
  就改写为工作区文件名，并在工具结果里告诉模型；
- 用户明确说桌面/文档/下载、或明确给绝对路径、或更新本任务已交付的同一文件 ⇒ 不改道。

**门禁**：`verify-r97-static`（提示词 + 工具说明 + 宿主兜底三层）。

### 10. nm Markdown 分栏与切换按钮

**根因**：
- 拖动分隔条到右侧时，鼠标进入预览的 `iframe`，`mousemove` 被 iframe 吃掉 ⇒ 拖动中断；
- 点「收起预览」后，`#juanCuo` 仍保留 62% 的 flex，右侧 38% 成为空白 —— 用户看到"文档不见了"。

**改法**：
- `body.tuoFenGe #yuLanLie, body.tuoFenGe #yuLanLie * { pointer-events:none !important }`，
  拖动期间预览不接收指针事件，document 持续收到移动；
- `sheFenLanShou`：只收起一侧时，留下的一侧 `flex:1 1 0` 铺满；两侧都展开时恢复 `fenLanBi` 百分比；
- 分隔条双击仍恢复 50%。

**门禁**：`verify-r97-nm-live`（向右拖 140px 后源码宽度 480→628；双击回 50%；
收起预览后源码 945/960 铺满；再点恢复 50%）。

---

## 二、继续完成（第二轮补充）

### R97-4. context-renderer 的 Electron 预算口径（已修）

- 原门禁写死 `contextBudgetChars=4000`；产品已按「百分比 × 模型真实窗口」算预算（实测 2666 字符）。
- 现在测试显式注入 `modelContextTokens=32768 × 10%`，用 `metrics.viewBudgetChars` 作为**实际预算**；
  主对话 prompt 与分类/短汇报 prompt 分开统计（后者无历史，不受视图预算影响）；
  预算可配置改为切到 `32K × 20%` 验证指标变化。
- 同时修 `ELECTRON_RUN_AS_NODE=1` 环境导致 Electron 被当 Node 启动、`BrowserWindow` 不存在的假红。
- 结果：`verify-context-renderer`（含完整回归套件）**ALL PASS**。

### R97-5. 滚动组合压力（已补）

`verify-r97-live` 新增：
- 连续 5 次流式追加 + 中途直接改 `scrollTop`（模拟拖滚动条）：位置 1748 纹丝不动；
- `Emulation.setDeviceMetricsOverride` 缩小/恢复视口：位置仍 1748，不回顶；
- 下箭头仍能到 `gap=0`，自动滚动仍到底。

### R97-6. 吸附跨屏 / 高 DPI 真值表（已补）

新增 `verify-r97-snap-geometry` **18/0**：
- 同一工作区：贴边、10/30px 阈值、纵向重叠 50%、旧语义最大高度、workArea 越界拒绝；
- 右副屏 + 顶部任务栏、左侧负坐标副屏；
- 跨主/副屏边界的窗**不吸**（当前语义是一扇窗只在一个 workArea 内拼）；
- 200% 缩放用 1280×720 DIP，11 DIP 吸附 / 26 DIP 不吸，阈值不随缩放放大；
- 已占边不抢、多候选最近、workArea 未知不误拒。

### R96-1（按澄清重做）. KB 内容 ≤3/5，其余来自本会话聊天记录

- **澄清后口径**：3/5 限制的是**从知识库抽取**的内容（任何层，不只共享 session 层）；
  其余必须来自**当前会话的聊天记录**；两边重叠的聊天内容排除。
- **实现**：
  - 新增 `duanJiYiHuiHuaSuCai()`：从当前会话 `chatLogs` 取用户明确规则/偏好（“以后/每次/不要/记住…”）
    优先，再取最近几条用户发言；与“要点/决策/待办/风险”和 KB 文本重叠的候选排除。
  - 归档时先补聊天候选，再按 **KB ≤ 聊天×3/2**（即总占比 ≤3/5）补 KB；没有聊天内容时最多 3 条 KB 起步。
  - 压缩阶段同样按“KB 事件 vs 无 KB 事件的聊天行”分侧，KB 超限先丢最低分 KB。
  - 老短记忆里不在 KB 的行**不再补写知识库**，保留为聊天内容（删除短记忆不回写知识库）。
- **实测**（`verify-r96-memory` 16/0）：夹具写出 7 条：4 条会话聊天 + 3 条 KB（42.9%）；
  只有聊天记录的外部群写出“群里约定：以后先说结论”+1 条 KB（50%），不再为空。
- 最坏：聊天记录本身没有可提炼内容时，聊天侧为空，短记忆只剩最多 3 条 KB 起步；
  或 KB 候选被聊天内容挤到 3/5 以下——这符合本轮口径，知识仍可从 KB 检索。

### R96-3（选 B）. 本会话允许工作区内命令（默认关）

- 授权卡新增开关「允许本会话在工作区内执行命令」，默认关、可随时撤销；
- 只放宽：常规授权 + 命令在工作区内 + 风险非高 + 非明显破坏性；
- **严格授权、工作区外（`..`/绝对路径）、`rm -rf`/`rm -fr`/`del /f`/`Remove-Item -Recurse`/`format`/`shutdown`/`reg delete`/`diskpart` 等仍逐次询问**；
- 完全授权不受影响；旧调用不传开关，行为与以前完全一致；
- 10 个语言包都有开关/说明/失败提示；
- 门禁：`verify-r97-shell-auth` **20/0**；`verify-r97-live` 已实测授权卡勾选/取消落盘并撤销。

---

## 三、验证汇总

| 门禁 | 结果 |
|---|---|
| `verify-r97-static` | 29 / 0 |
| `verify-r97-live`（首启助记拼音 + 滚动 + 时序 + 授权开关 + 压力） | 25 / 0 |
| `verify-r97-nm-live`（二进制/菜单/分栏/吸附） | 17 / 0 |
| `verify-r97-snap-geometry`（跨屏/高 DPI 真值表） | 18 / 0 |
| `verify-r97-shell-auth`（工作区命令授权真值表） | 20 / 0 |
| `verify-r96-memory`（含群聊共享起步） | 15 / 0 |
| `verify-r96-live` | 17 / 0 |
| `verify-r96-ui` | 35 / 0 |
| `verify-r94-ui-live` | 28 / 0 |
| `verify-r94-ui` | 27 / 0 |
| `verify-r68-auth-ui` | 47 / 0 |
| `verify-r92-live` | 20 / 0 |
| `verify-r93-memory-security` | 39 / 0 |
| `verify-r67-firstrun` | 80 / 0 |
| `verify-r67-chat-order` | 20 / 0 |
| `verify-r78-scroll` | 6 / 0 |
| `verify-r81-nm` | 52 / 0 |
| `verify-r67-nm-edges` | 35 / 0 |
| `verify-model-pick` | 34 / 0 |
| `verify-model-route` | 13 / 0 |
| `verify-tool-calls` | 全部 PASS |
| `verify-context-renderer`（含完整回归套件） | 全部 PASS |
| `verify-i18n-locales` | 162 / 0 |

**构建**：`tsc -b` 无错；`check-syntax` app.js 语法/顶层 TDZ 通过；`copy-assets` 完成。

---

## 三、真机复核记录

- 原测试 profile 已备份到 `%TEMP%\warmy-profile-before-r97.zip`
  （备份前已停止程序，压缩包含真实测试会话；交付前已删除原 profile）。
- 用副本复核牛马-2 的两段历史回复：32 条操作/23 段思考 + 11 条操作/11 段思考，均按时间穿插；
  第一扇 nm 与主窗的连接/第二扇不抢边、真实移动行为均已用 Windows `SetWindowPos` 验过。
- 模型路由真实审计：修复后 `1+1` 选中 `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K`
  （Ollama，chainIndex 0）；修复前同会话为 MiMo pro（chainIndex 22，链尾）。

---

## 五、改动文件

- `packages/app-shell/src/renderer/app.js`
- `packages/app-shell/src/renderer/auth-gate.js`
- `packages/app-shell/src/renderer/auth-gate.css`
- `packages/app-shell/src/renderer/nm-viewer.js`
- `packages/app-shell/src/renderer/nm-viewer.css`
- `packages/app-shell/src/electron-main.ts`
- `packages/app-shell/src/model-pick.ts`
- `packages/app-shell/src/nm-viewer-win.ts`
- `packages/app-shell/src/work-tools.ts`
- `packages/app-shell/src/agent-tools.ts`（工作区命令授权开关）
- `packages/app-shell/src/settings-store.ts`（`workspaceCmdSessions`）
- `packages/app-shell/src/preload.cjs`（`authWorkspaceCmd`）
- `packages/app-shell/src/i18n/*.json`（10 语言的授权开关/说明/失败提示）
- `packages/app-shell/scripts/verify-model-pick.mjs`
- `packages/app-shell/scripts/verify-context-renderer.mjs`（动态预算 + `ELECTRON_RUN_AS_NODE` 清理）
- `dev/gates/verify-r67-firstrun.mjs`、`verify-r67-chat-order.mjs`、`verify-r81-nm.mjs`、
  `verify-r94-ui.mjs`、`verify-r96-ui.mjs`、`verify-r96-live.mjs`、`verify-r96-memory.mjs`
- 新增 `dev/gates/verify-r97-static.mjs`、`verify-r97-live.mjs`、`verify-r97-nm-live.mjs`、
  `verify-r97-snap-geometry.mjs`、`verify-r97-shell-auth.mjs`

---

## 六、交付状态

- 真实 profile 已删除；当前程序以**首启**状态启动，等待验收。
- 未提交 git（按用户习惯，验收后再决定是否提交/发布）。
- 未完成/待拍板见 [`OPEN-ITEMS-R97.md`](./OPEN-ITEMS-R97.md)。
