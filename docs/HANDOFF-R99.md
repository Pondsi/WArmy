# 第 99 轮交接（2026-10-27）

> 本轮按你的 17 项要求完成。重点：**难易/杂简/急缓三轴各五档**、**模型实际思考档位百分比映射**、
> **聊天滚动彻底换方案**、**语音输入增强**、**nm 查看器/文本编辑器/独立窗标题**、**三档授权语义**。
>
> 未完成/需要你协助的见 [`OPEN-ITEMS-R99.md`](./OPEN-ITEMS-R99.md)。
> 首启已按你的要求备份并删除真实配置，应用现在停在**语言选择页**等你验收。

---

## 一、三轴五档：难易 / 杂简 / 急缓

### 1.1 口径

| 轴 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 难易 | 极易 | 较易 | 难易适中 | 较难 | 很难 |
| 杂简 | 极简 | 较简 | 杂简适中 | 较杂 | 很杂 |
| 急缓 | 极缓 | 较缓 | 急缓适中 | 较急 | 很急 |

- **难易**：单步计算/推理本身有多难 ⇒ 决定模型强弱。
- **杂简**：步骤多、要拆分、子任务互相关联深 ⇒ 决定思考级别。
- **急缓**：只决定投递/插队/插话/速度偏好；不再混进难易或杂简。

### 1.2 五档如何落到实际选择

- **模型（智能模式）**：`nan` 1..5 作为需求强度；链内按“模型强弱估计”打分，低于需求的模型重罚；
  难任务优先云端强模型，易任务优先本地/免费；**非智能模式仍然严格按链顺序**，难/急都不跳位。
- **思考（牛马=自然/自动）**：`za` 1..5 先定基础档（5→l6/参悟，4→l5/穷理，3→l4/明辨，2→l2/慎思，1→off/灵机）；
  `nan` 给下限（5→l4，4→l3，3→l2，2→l1）；重要/高风险再抬下限；
  顶模型仍可能失手（nan≥5、低置信、高风险）⇒ 即使任务“简”也抬到 l6。
- **急**：在难/杂允许的范围内可压一档思考（不得低于下限）；很急时模型偏好云端/flash/速度快的模型。
- **牛马自己选了具体思考档**：值班者/分类器**不覆盖**，计划写 `auto`，执行者按自己的档位。
- **单聊**：只让难易/杂简影响模型与思考；**急缓不影响模型/思考，也不影响插话**（插话由用户手动）。
- **项目**：急缓只在执行者正在忙、需要插话时决定插话方式；无论是否插话，急缓都会影响执行者的模型/思考
  （前提：该牛马勾了智能模式 / 思考=自动，哪项选了哪项受影响）。

### 1.3 插话五档

| 急缓 | 目标空闲 | 目标忙碌 |
|---|---|---|
| 很急 P0 + 用户明确“停止” | none | **stop**（真的中止在途任务） |
| 很急 P0（没有停止要求） | none | urgent |
| 较急 P1 | none | urgent |
| 急缓适中 P2 | none | insert（默认） |
| 较缓 P3 | none | queue |
| 极缓 P4 | none | queue（排最后） |

> P0 的“硬停”需要**用户明确要求停止**或再次催促；普通很急不会无脑杀任务。

### 1.4 值班者不能抢活

- 先派执行者；只有三种情况值班者自己答：
  1. 用户明确要求值班者自己做；
  2. 没有执行者可用；
  3. 全部执行者报错，且“执行者无法完成置信度 >65% 且值班者 <45%”。
- 当前置信度是**宿主可解释估计**（执行者全失败=0.7；值班者按任务难度给 0.4/0.55），
  不是模型自报；审计 `group.duty-self` 可查。

### 1.5 代码位置

- `packages/app-shell/src/nan-yi-du.ts`：五档标签、`panDuanNanZa`、`guSuanZhongYaoFuZa`、`jiCongWenBen`。
- `packages/app-shell/src/mo-xing-qiang-du.ts`：按型号名估计强弱/快慢（1..5）。
- `packages/app-shell/src/model-pick.ts`：智能模式打分（难易优先、急缓偏好速度/云端）。
- `packages/app-shell/src/zhi-ban-pai-fa.ts`：选人、思考、插话、值班者自执行门槛。
- `packages/app-shell/src/orchestrator.ts`：派发计划、P0 停止、P3/P4 排队、执行者失败后值班者兜底。
- `packages/app-shell/src/electron-main.ts`：分类器 prompt、`executorConfig` 用自己的智能模式、`executorThink`。

### 1.6 验证

- `verify-r99-five-axis` **51/0**（五档真值表、难/杂独立、急缓不越界、模型打分、自执行门槛、授权、UI 接缝）。
- `verify-zhi-ban-pai-fa` **39/0**；`verify-r48-heiban` **67/0**。

---

## 二、思考档位：拉取模型时获取，按百分比映射

- **不再有“模型不支持所选档位 → 自动降级为自然”**：
  - 拉取模型时从端点/能力表拿实际档位（`/models` 的 `reasoning_efforts`/`supported_efforts`/`efforts`；
    Ollama 用 `/api/show` 的思考能力，给低/中/高三档；已知型号表兜底）。
  - 我们的 7 个非自动档（灵机 0% → 微觉 16.7% → 慎思 33.3% → 明辨 50% → 沉吟 66.7% → 穷理 83.3% → 参悟 100%）
    按百分比映射到模型实际档位：`源档位 j = round(i*(N-1)/6)`。
  - 6 档示例：灵机/微觉/慎思/明辨/明辨/穷理/参悟（两个内部档落在同一实际档，是比例映射的正常结果）。
  - 3 档示例：低/低/中/中/中/高/高；10 档时 7 个内部档都有实际档位。
- 请求参数：`reasoning_effort` 发标准 `low/medium/high`（兼容只认四词的端点），
  `thinking_level` 发模型实际档位；`off` 发 `enable_thinking:false`；`auto` 不发参数。
- UI 说明已改为“拉取时读取实际档位并按比例映射”，不再承诺“自动降级”。
- 代码：`packages/providers/src/mo-xing-neng-li.ts` 的 `gouJianDangWeiAnShe`、
  `packages/app-shell/src/electron-main.ts` 的 `siKaoCanShu`。

---

## 三、聊天滚动：换掉旧锚点方案（最高优先项）

### 3.1 根因

旧实现有三层状态互相打架：
- `topAlignSuppress`（用户接管）+ `anchorTurn/anchorEl`（把“本轮新内容首行”钉到视口顶部）+ `followBottomTurn/forceBottom`；
- `pointerdown`（只是点一下）也被当成“用户接管”；
- `endOfRound`/状态重画/`innerHTML=''` 会再次套用 `anchorTurn === turnKey` 分支，把视口拉回“最后一条回复的顶部”；
- 用户已经滚到底后，某些重画又把 `anchorTop` 套回去，于是表现为“过一会儿又回到新回复置顶”。

### 3.2 新方案

**只保留一个事实：这个会话是否跟随底部。**

- 用户滚到底（距底 ≤32px）⇒ `following=true`；
- 用户滚离底部 ⇒ `following=false`；
- 发消息、流式刷新、状态行重画、切界面、删除牛马……**都不改这个事实**；
- 下箭头 = `following=true` 并滚到底；自动滚动勾选 = 永远跟随；
- 不跟随时，整块重画/流式更新只还原**原 scrollTop**；不再把最后一条回复钉到顶部，也不跳回顶部；
- 不再监听 `pointerdown/mousedown/touchstart` 来判断“接管”；只认 scroll 事件本身；
- 程序滚动记录目标位置，scrollTop 对不上才判用户；`innerHTML=''` 期间挂 `chatRebuilding` 防止误判。

代码：`packages/app-shell/src/renderer/app.js` 的 `chatGenDi/sheZhiGenDi/chatZhuiDi`、
`renderChat` 的最终滚动决策、`xuanRanLiuShiKuai`。

### 3.3 验证

- `verify-r97-live` **24/0**：用户上滚后新回复/流式追加/拖滚动条都不改变 scrollTop；
  已在底部时新内容继续贴底（不再钉顶）；下箭头真的到底；窗口缩放不回顶。
- `verify-r94-ui` **27/0**：源码接缝与旧 anchor 逻辑已移除。
- 另在运行中的测试界面复现过“回到置顶”的场景；新逻辑下只剩“跟随/不跟随”一个状态，没有定时器或重画能改它。

> 联网参考：Stack Overflow「Keep overflow div scrolled to bottom unless user scrolls up」、
> 「Automatic scrolling, only if a user already scrolled the bottom」、Cursor 论坛“top-anchored reading”
> 讨论的共同结论都是：**用 following 标志 + 用户滚动才改**，不要在每次重画里重新锚定。

---

## 四、语音输入（第 6–8 项）

- **点话筒 ⇒ 发送立即置灰**，直到：话筒再次点击结束 + 所有最终转写落到输入框 +（可选）重组完成。
- 话筒右侧新增下拉按钮，两个勾选项：
  - **重组语言**（默认勾选）：最终转写完成后，把输入框整段交给**设置 → 模型 → 整理模型**的调用链，
    重写为更清晰、简明、通顺、有逻辑的文本；不改语义、不加内容；替换完成后才恢复发送。
  - **自动发送**（默认不勾）：发送恢复可用后自动发送。
- 没有可用整理模型 ⇒ “重组语言”灰色不可勾，菜单里显示怎么配置。
- 设置持久化：`yuYinChongZu`（默认 true）、`yuYinZiDongFaSong`（默认 false）。
- 语音预览/最终转写仍沿用原有的“整段替换”逻辑，不会重复追加。
- 代码：`app.js` 的 `yuYinJinZhi/yuYinShouWei/yuYinShuaXinChongZuKeYong`、`electron-main.ts` 的
  `warmy:zhengLiKeYong` / `warmy:zhengLiWenBen`、`preload.cjs`。

---

## 五、快捷键（第 10 项）

- 新增 `sendMessage`：默认 `Ctrl/Cmd+Enter`，备用 `Alt+Enter`；挂在发送按钮上。
- 话筒沿用 `voiceInput`：默认 `F6`，备用 `Ctrl/Cmd+Space`。
- 两者都进入设置 → 快捷键列表，可改；悬停按钮显示键位气泡。
- 发送框里 `Enter` 仍然直接发送（保留旧习惯）。

---

## 六、引导卡（第 2 项）

- 引导卡 `z-index` 从 900 提到 **1100**（高于普通弹窗 1000），创建牛马输入弹窗不再挡住它。
- 卡片可**按住标题栏拖动**；靠近任意屏幕边 ≤40px 自动贴边；位置存 `settings.startGuidePos`；
  窗口缩放时自动夹回可见区域。
- 卡片内容/自动刷新不变；拖动只改位置，不影响“不自动折叠”。

---

## 七、nm 查看器 / 文本编辑器 / 独立窗标题（第 4、11、12 项）

### 7.1 主窗口最大化时的 nm 宽度

- 主窗口最大化 ⇒ nm 查看器不再按 `normalBounds` 右侧打开（那会跑到屏幕外），
  而是用**第四列宽度**（`settings.panelWidth` 或按窗口宽度算的默认值）贴主窗口右缘，
  高度与主窗口一致，正好填补右侧空位。
- 非最大化仍按原逻辑贴在主窗口右侧。
- 代码：`nm-viewer-win.ts` 的 `nmXinChuangLuoDian` + `nmSheZhiMianBanKuan` 注入。

### 7.2 文本编辑器按钮（重做）

- 旧行为（复用主界面开一个新窗口）已删除。
- 新行为：点击后在**主界面第三列正上方**打开一个 nm 查看器（无边框，覆盖第三列），
  内容 = 当前聊天输入框文字；在 nm 里编辑会**实时同步回聊天框**；
  不落盘、不保存、不需要“保存”按钮；关闭不提醒未保存。
- nm-file 插件未启用时按钮置灰，悬停提示“设置 → 插件 → 启用 nm 文件”。
- 代码：`electron-main.ts` 的 `chatEditorWins/chatEditorDocs/dakaiLiaoTianBianJiQi`、
  `nm-viewer.js` 的 `chatEditor` 模式、`nm-viewer-win.ts` 的虚拟文件提供者。

### 7.3 独立会话窗任务栏名称

- 独立窗（`mode=fu`）的 `document.title` 改为**会话名称**；i18n 重绘不再把它改回产品名。
- 主窗口仍用产品名。

---

## 八、授权（第 13 项）

### 8.1 删除的选项

- 授权卡里的「允许本会话在工作区内执行命令」勾选项、`workspaceCmdSessions` 设置字段、
  `authWorkspaceCmd` IPC 全部删除；10 语言对应文案也删除。

### 8.2 三档语义

| 档位 | 命令 | 文件 |
|---|---|---|
| 常规 | 工作区内 + 白名单 + 静态低风险 ⇒ 直接执行；其它/工作区外 ⇒ 按「允许提权」询问或拒绝 | 工作区内创建/修改/删除自由；工作区外询问 |
| 严格 | 任何命令都逐次询问 | 任何创建/修改/删除/移动都逐次询问（含工作区内） |
| 完全 | 任意命令直接执行；涉及项目程序目录/其他会话 ⇒ 单独申请授权 | 任意位置文件可改；涉及项目程序目录/其他会话（含自己的会话目录）⇒ 单独申请；本会话工作区自由 |

- 代码：`agent-tools.ts` 的 `panDuanMingLingShouQuan`（白名单新增 tar/powershell/zip/unzip/7z）、
  `electron-main.ts` 的 `strictWrite` 询问、完全授权下受保护命令从“硬拒”改为“可申请一次放行”。

---

## 九、门禁与验证（本轮新增/修改）

- 新增 `verify-r99-five-axis` **51/0**：三轴五档、模型档位映射、智能/严格链、值班者自执行门槛、
  三档授权、滚动/语音/编辑器/nm/标题/引导/授权卡 UI 接缝。
- 更新并复跑：
  - `verify-model-pick` **43/0**
  - `verify-zhi-ban-pai-fa` **39/0**
  - `verify-r48-heiban` **67/0**
  - `verify-r97-live` **24/0**
  - `verify-r94-ui` **27/0**
  - `verify-r97-shell-auth` **19/0**
  - `verify-r65-mic-lifecycle` **12/0**
  - `verify-round36-changes` **38/0**
  - `verify-r55-shouquan-kb` **25/0**
  - `verify-r52-jujue` **43/0**
  - `verify-r44-yuSuan` **176/0**
  - `verify-renderer-scope` **9/0**
  - `verify-i18n-locales` **163/0**
  - `verify-gate-manifest` **23/23**
  - `run-verify-22 --tier=fast` **115 项次 0 红**
- 未重跑：10×10 连续真实模型验收（用户已暂停）；本轮没有真实模型调用（遵守“不使用你另提供的 DeepSeek key”）。

---

## 十、首启交付

- 真实 profile 已备份到：
  `%TEMP%\warmy-profile-before-r99-20261027-192107.zip`（451,284 字节，含 `settings.json`）。
- `%APPDATA%\@warmy\app-shell` 已删除。
- 应用已用新构建启动，CDP 探针确认：
  - 标题 `无限牛马`；
  - 语言页十种语言 + 「开始」；
  - `window.__warmyAuthGate` 存在；
  - 旧引导不存在；
  - 渲染层无脚本错误。
- 现在停在语言选择页，等你验收。
