# 第 102 轮交接（2026-10-28）：未查看摘要 / 引导卡去聊天 / nm 与主窗口最大化

> 本轮只做用户点名的三项，但三项都做了真机验收；没有继续开新功能。
> 当前仍未完成/需要用户协助的事项见 [`OPEN-ITEMS-R102.md`](./OPEN-ITEMS-R102.md)。

---

## 0. 一句话结论

- **没有新回复时，上翻只显示下箭头**；只有“真正到来、且用户还没看过”的牛马回复才显示摘要气泡，滚到底/点下箭头后摘要消失。
- **引导卡永远不会自动最小化**；点「去聊天」只收起挡住聊天的设置页/创建牛马弹窗/牛马设置弹窗，引导卡留在屏幕上。
- **nm 自己点最大化 = 这个窗口铺满所在显示器工作区**；**主窗口最大化且吸附了 nm** = 主窗口占满工作区除预留条外的部分，nm 按吸附方向精确放进预留条（厚度 = 主界面第四列宽度），再点一次双方还原。

---

## 1. 项 1：下箭头与“未查看的新回复”摘要分离

### 1.1 真根因

旧实现把“最后一条消息”当成“新回复”：

- 聊天区 `scroll` 事件里，用户只要往上翻，就拿 `msgsOf(sid).slice(-1)[0]` 塞进 `pendingNewest`；
- `renderChat` 在不跟随时也会拿最后一条消息塞进去；
- 于是**没有任何新回复**，只要上翻就出现摘要气泡，和“直达底部箭头”混在一起。

### 1.2 改法

文件：`packages/app-shell/src/renderer/app.js`

- 新增按会话保存的 `chatUnreadNewest`（`sid -> { text, role, ts }`）。
- 只有真实的新回复路径才登记：
  - `tuisongXiaoxi(..., role === 'them', 非 system / 非 stopped / 非 self)`；
  - 流式回复（`xuanRanLiuShiKuai`）在用户不跟底时登记最新一段。
- 用户上翻、重画、发自己的消息**都不登记**。
- 以下动作视为“已查看”，清掉该会话摘要：
  - 用户/程序滚到底（距底 ≤ 32px）；
  - 点「直达底部」箭头；
  - 在底部收到新回复（当场看到）。
- `renderChat` 只用当前会话的 `chatUnreadNewest` 同步气泡，不再从历史最后一条猜。
- 摘要气泡和箭头仍可同时出现（有未查看新回复且不在底部时）；没有未查看新回复时就只有箭头。

### 1.3 真机验收（`dev/gates/verify-r102-live.mjs` B 段）

- 无新回复上翻：`arrow=true, bubble=false`；
- 未查看新回复到来：`arrow=true, bubble=true`，文本正确；
- 未查看期间继续上翻：摘要保留；
- 点下箭头：到达底部、`arrow=false, bubble=false`；
- 已查看后再上翻：仍然只有箭头；
- 在底部收到新回复：不显示摘要（当场已查看）。

---

## 2. 项 2：引导卡「去聊天」不自动收起，只关掉挡路窗口

### 2.1 用户口径

> 引导卡永远不要最小化，除非用户主动点击最小化。点「去聊天」要把当前其他挡住聊天的窗口关掉，例如设置牛马的窗口。

### 2.2 改法

文件：`packages/app-shell/src/renderer/app.js`

- 第 101 轮 `sgGoChat()` 里的 `sgMinimize()` 已删除。
- 新增 `sgQingDangLuChuangKou()`：
  - `closeNiuMaSettings()`：关掉右键「设置」打开的牛马设置弹窗；
  - 直接隐藏/清空 `#duiHuaKuangGen`：创建牛马输入弹窗、确认框等都在这一个宿主里；
  - 当前在设置页（`state.nav === 'settings'`）时切回 `singleAi`。
- 然后 `setNav('singleAi')` + `openChat('single', first.id)`，220ms 后聚焦 `#shuRu` 并脉冲输入区。
- 引导卡只保留两个用户主动收起入口：右上角「—」、键盘 Escape（仍是用户动作）；不完成/去聊天都不会自动收起。

### 2.3 真机验收（`verify-r102-live.mjs` A 段）

- 先打开创建牛马弹窗 → 点「去聊天」：
  - `#startGuide` 仍存在、`#startGuidePill` 不存在；
  - `#duiHuaKuangGen` 已隐藏；
  - 导航为 `singleAi`，聊天区存在，焦点在 `shuRu`。
- 先切到设置页 → 点「去聊天」：回到单聊、引导卡仍在。
- 用户主动点「—」：引导卡才收起并出现「继续设置」胶囊。
- R98 旧回归 `verify-r98-onboarding` **43/0**，其中“去聊天后清单保持展开/不压输入框”仍然全绿。

---

## 3. 项 3：nm 自己最大化 / 主窗口吸附预留第四列

### 3.1 定稿行为

- **nm 自己点最大化**：按系统语义最大化该 nm 窗口，铺满它所在显示器的工作区；
- **主窗口没有吸附 nm**：正常原生最大化；
- **主窗口吸附了 nm**：进入“预留式最大化”：
  - 按吸附方向（左/右/上/下）预留一条厚度 = 主界面第四列宽度的条；
  - 主窗口占满工作区其余部分；
  - 每个直接吸附的 nm 被重新调整成正好放进对应预留条；
  - 左右条占满工作区高度；上下条只跨主窗口宽度，避免四角互相压住；
  - 再点一次最大化：主窗口和所有被调整的 nm 回到最大化前的位置/尺寸，吸附关系保留；
  - **触发方式统一**：应用内按钮、双击标题栏、Windows 的 Win+Up / 贴靠布局 / 任务栏最大化，只要检测到主窗口吸附了 nm，都会转成同一套预留布局（`zhuanHuanXiTongZuiDaHua`）。
- 多显示器：只用 `screen.getDisplayMatching(...).workArea`，因此任务栏被排除、副屏负坐标也正确。
- 工作区太小（主窗口会被挤到 < 480×320）：不假装成功，退回原生最大化。

### 3.2 实现位置

- `packages/app-shell/src/nm-viewer-win.ts`
  - 纯几何 `nmJiSuanZhuZuiDaBuJu(wa, panelKuan, ce)`：左右上下/多边/负坐标/任务栏/夹取真值表可脱离 Electron 断言；
  - `nmZhuZuiDaHuaKai()`：保存双方原矩形与最小尺寸 → 临时放宽最小尺寸 → 主窗口与各 nm `setBounds`；
  - `nmZhuZuiDaHuaGuan()`：恢复双方最小尺寸与矩形；
  - 布局期间用 `zhuZuiDaBuJuZhi` 挡住 `move/resize` 回流，避免自己把刚贴好的边判成“拖开”；
  - **同时修了一个既有 bug**：`shouLianYiBian` 的左右两支方向写反。以前窗口最大化/还原触发 resize 校准时，会把仍然贴着的左右连接误删；本轮 nm 最大化再恢复就复现了它，现已按“`bian` 是本窗自己的边”修正。
- `packages/app-shell/src/electron-main.ts`
  - `warmy:winZuiDaHua`：主窗口分支按状态走“预留布局 / 还原 / 原生最大化”；nm 与独立会话窗仍按各自窗口原生最大化；
  - `zhuZuiDaMianBanKuan()`：第四列宽度与渲染层同一口径（用户拖过的 `panelWidth` 优先，否则 16% 自动、300–420 夹取），并迭代求出与主窗口宽度自洽的值；
  - `warmy:winZhuangTai` 增加 `customMaximized` / `reservedSides` / `bounds` / `workArea`；
  - `warmy:nmShiTuLieBiao` 增加 `kuang` / `max`，真机门禁不靠猜。

### 3.3 Windows 原生最大化的 8px 边框

`nm` 自己的最大化走 Windows 原生语义：`getBounds()` 会返回 `(workArea.x-8, workArea.y-8, workArea.w+16, workArea.h+16)`（不可见缩放边框/阴影），**客户区仍然正好铺满工作区，任务栏仍然可见**。这是系统行为，不是“多占任务栏”。真机门禁按这个事实判定，不会用 `setBounds` 硬抠 8px 把原生最大化变成普通窗口。

### 3.4 真机验收（`verify-r102-live.mjs` C 段，当前机器 3440×1392 工作区）

**默认自动第四列（420px）**：

- 初始：主窗口 1280×800、nm 吸附在右侧；
- 主窗口最大化（有吸附）：
  - `customMaximized=true`、`reservedSides=['you']`；
  - 第四列宽 `--panel-w=420`；
  - 主窗口 `{x:0,y:0,w:3020,h:1392}`，nm `{x:3020,y:0,w:420,h:1392}`；
  - 无缝隙、无重叠、吸附连接 `lianJie=[-1]` 仍在。
- 再点一次：主窗口与 nm 都回到 `{x:1080,y:296,w:1280,h:800}` / `{x:2360,y:296,w:960,h:800}`。
- **系统原生最大化**（Win32 `ShowWindow(SW_MAXIMIZE)` 模拟 Win+Up/贴靠布局）：自动转成 `customMaximized=true`，主窗口宽 3020、nm 420×1392；再点应用内最大化回到原位。
- nm 自己最大化：`max=true`，客户区铺满工作区，主窗口状态不变；再点一次回到原吸附位置，连接仍在。
- 没有吸附时：主窗口原生最大化（`maximized=true`、`customMaximized=false`），客户区铺满工作区。

**用户拖过第四列（`R102_PANEL=320`）**：

- 初始主窗口第四列 320；最大化后主窗口 `{x:0,y:0,w:3120,h:1392}`，nm `{x:3120,y:0,w:320,h:1392}`；
- 验证了 nm 窗口临时降到 320 宽仍能精确填条；系统最大化转换同样为 3120 + 320；
- 还原后双方回到 1280×800 / 960×800，吸附仍在。

纯几何真值表（`verify-r102-changes`）另测左右上下/四边同时/重复方向/副屏负坐标/任务栏/夹取/工作区太小。

---

## 4. 第 5/6 项拍板落地（用户补充）

### 4.1 第 5 项：完全授权边界 = A 保持现状

用户口径：完全授权 = 本会话之外的其他本机内容开放；**我们的程序本身、其他会话的数据（以及程序里不属于本会话的数据）不放开**。

本轮没有修改授权代码，只核对并加了门禁：

- `protected-paths.ts` 仍把**程序安装目录**、**其他会话工作区**、**会话历史/记忆/账号/设置文件**列为禁止区；
- 文件工具（读/写/打开/下载/LSP）先查禁止区，只有用户单独同意的一次性授权（`grantProtectedOnce` → `consumeProtectedOnce`）才放行；
- 完全授权下 `run_shell` 命令触及这些区域时也先弹卡，同意只放行这一次；
- 普通本机路径/命令仍按完全授权直接放行。

所以准确说法是：**完全授权本身不能碰程序和其他会话；只有你在单独的授权卡上明确同意一次，才会放行这一次**。这与“保持现状”一致。

### 4.2 第 6 项：值班者自执行 = 保留门槛 + 全失败无条件兜底

用户口径：保留 65%/45% 门槛；**其他执行者全部失败时，值班者不再看置信度，直接兜底**；除非用户明确说明不要值班者自己执行。

实现：

- `zhi-ban-pai-fa.ts` 的 `zhiBanKeZiXing` 判定顺序：
  0. 用户明确禁止（`userForbidden`）⇒ 不可以；
  1. 用户明确要求值班者自己执行 ⇒ 可以；
  2. 没有执行者可用 ⇒ 可以；
  3. **其他执行者全部失败**（`allExecutorsFailed`）⇒ 可以，不再看置信度；
  4. 原门槛：执行者无法完成置信度 >65% 且值班者 <45% ⇒ 可以；
  5. 其余 ⇒ 必须先派执行者。
- 新增 `yongHuJinZhiZhiBanZiZuo(content)`，识别“不要让值班者自己执行 / 值班者不要自己做 / 只调度，别让值班者兜底”等明确禁止；不会误判“值班者自己执行 / 让值班者自己执行”。
- `orchestrator.ts` 主路径与队列冲刷两处都传入 `allExecutorsFailed: true` 与 `userForbidden`；审计 `group.duty-self` 增加 `userForbidden` 字段。
- 用户禁止时，即使全失败也不自执行，保留“派出的执行者都没有产出结果”的说明；用户没禁止时，值班者收尾。

## 5. 本轮门禁与验收记录

| 门禁 | 结果 | 说明 |
|---|---|---|
| `verify-r102-changes` | **51/0** | 纯几何真值表 + 三项静态接线 + 完全授权边界 + 系统最大化转换 + 负向变异 + 左右吸附方向回归 |
| `verify-zhi-ban-pai-fa` | **53/0** | 原派发真值表 + 值班者全失败兜底 / 用户禁止 / 纯函数与编排接线 |
| `verify-r102-live` | **31/0 ×2** | 临时 profile 真机：引导/滚动/nm 最大化/还原/系统最大化转换/无吸附原生最大化；自动 420 与用户 320 两种第四列宽都跑 |
| `verify-r101-changes` | **56/56** | 按 R102 新口径更新“去聊天”断言 |
| `verify-r98-onboarding` | **43/0** | 引导清单旧回归 |
| `verify-r97-nm-live` | **17/0** | nm 打开位置/吸附/拖动旧回归 |
| `verify-r97-live` | **24/0** | 聊天滚动/自动滚动/位置不被抢旧回归 |
| `verify-r65-session-isolation` | **13 fixtures + 1 负向控制** | 新摘要 helper 已进入离线 harness |
| `run-verify-22 --tier=fast` | **3 遍 354 项次 0 红** | 含新增 `verify-r102-changes`；单遍 118 项次 |

### 复跑命令

```bash
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/check-syntax.mjs
node scripts/copy-assets.mjs

node scripts/verify-r102-changes.mjs
node scripts/verify-r101-changes.mjs
node scripts/verify-gate-manifest.mjs

cd ../..
node dev/gates/verify-r102-live.mjs
# 用户拖过第四列（panelWidth=320）的路径：nm 会临时降到 320 宽填条
R102_PANEL=320 node dev/gates/verify-r102-live.mjs
node dev/gates/verify-r98-onboarding.mjs
node dev/gates/verify-r97-nm-live.mjs
node dev/gates/verify-r97-live.mjs
node dev/gates/run-verify-22.mjs --times=3 --tier=fast
```

---

## 5. 调研来源（第 0 条）

本轮“最大化/工作区”没有凭经验硬写，先核对了 Electron 当前文档与已知问题：

- Electron `BrowserWindow`（`maximize` / `unmaximize` / `setBounds` / `getNormalBounds` / `isMaximized`）：
  <https://electronjs.org/docs/latest/api/browser-window>
- Electron `screen`（`getDisplayMatching` / `workArea`，多显示器与任务栏口径）：
  <https://electronjs.org/docs/latest/api/screen>
- Electron issue：`currentWindow.maximize() doesn't truly maximize the window`（原生最大化的边界语义）：
  <https://github.com/electron/electron/issues/19934>
- Stack Overflow：最大化窗口与 Windows 任务栏的关系：
  <https://stackoverflow.com/questions/46795199/electron-maximized-browserwindow-overlaps-window-taskbar>
- Electron issue：多显示器下最大化/位置恢复问题：
  <https://github.com/electron/electron/issues/17933>

结论：
- 用 `workArea` 而不是 `bounds` 做布局，任务栏/副屏才正确；
- 主窗口要留出侧边条，不能依赖原生最大化（原生最大化不可 `setBounds` 缩窄），必须走“保存原矩形 + 自定义 setBounds + 可还原”的路径；
- nm 自己最大化继续用原生最大化，不自己造全屏窗口。

---

## 6. 配置与首启状态

- 本轮验收全部使用临时 profile，未使用用户的 DeepSeek key；没有上传/提交任何凭据。
- 真实 profile **未删除**：当前 `settings.json` 为 `setupDone=true`、1 只牛马、3 个供应商、`guideDone=true`；这是用户已经在用的配置，不是空首启。
- R101 的备份仍在 `%TEMP%\warmy-profile-before-r101-20261027-231434.zip`（含真实身份/凭据，**不要上传**）；它早于当前配置，不能拿来覆盖当前数据。
- 交付前已把应用平滑重启到第 102 轮构建（退出前确认：无进行中任务、输入框为空、唯一打开的 nm 文件无未保存改动）；重启后主窗口落回 `singleAi`，账号仍登录。
- 本轮没有再次删除配置；如果用户要重新走首启，需要先备份当前 profile，再另行删除。
