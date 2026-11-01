# 第 94 轮交接：首启细节 + 聊天滚动控制权

日期：2026-10-26
范围：用户当轮 5 条（首启语言页、关闭热区、关闭确认牛马动画、助记词弹窗按钮、聊天滚动）。

## 1. 首启语言页不再显示“当前选择的语言”

- 位置：`packages/app-shell/src/renderer/auth-gate.js` 的 `renderLanguage()`。
- 改动：删掉底部 `<span class="warmyAuthLangPick">…</span>`（原先显示 `简体 / English …`）。
  选中态仍由语言方块的 `.is-on` + `✓` 表达；底部只剩「开始」按钮并居中。
- 样式：`packages/app-shell/src/renderer/auth-gate.css`
  - `.warmyAuthLangFoot` 由 `space-between` 改为 `center`；
  - 删除 `.warmyAuthLangPick` 两条规则（亮/暗主题）。

## 2. 首启右上角关闭的触发范围放大

- 热区：`.warmyAuthCloseHot` **72×72 → 140×140**。
- 叉本身：`.warmyAuthCloseX` **34×34 → 44×44**（点击目标 ≥42px），图标 18px。
- 行为不变：鼠标进入 140×140 热区任意位置就显示叉；键盘 `:focus-visible` 也显示。
  点击热区内的叉仍然先弹“返回界面 / 关闭程序”二次确认。

## 3. 关闭确认：静止的一排牛马 → 从左往右跑动的牛马 logo

### 3.1 结构

- 删除 6 个 `<img class="warmyAuthQuitHorse">`（logo-color / logo-tight / logo-16 / muMa / prompt-ai / mimic）。
- 改成动画轨道：`<div class="warmyAuthQuitHorses" id="warmyAuthQuitTrack">`。
- 每只牛马是**内联 SVG**（`QUIT_HORSE_SVG`），来自项目像素牛马 logo，但拆成：
  - `.qLeg` × 4（两条腿一组，可独立绕髋摆动）；
  - `.qTail`（尾巴，绕尾根摆）；
  - `.qHead`（头，绕颈部偶尔微动）；
  - `.qBodyBob`（身体轻微起伏）。
- 颜色/像素与原 logo 一致（`#A0522D / #8B5A2B / #3E2723 / #C19A6B`），`shape-rendering: crispEdges`。

### 3.2 动作与随机

- **步频跟速度**：行走行程 4.3–6.9s，奔跑 2.1–3.8s；腿周期 = 行程 × 7%–11.5%，
  写入元素 CSS 变量 `--step`，奔跑时摆幅更大（`--swing` 19–24°，行走 10–15°）。
- **尾巴跟步频**：`animation-duration = calc(var(--step) * 2)`。
- **头部偶尔微动**：随机时长 1.3–3.4s + 随机负延迟 0–2.6s；关键帧大部分时间不动，
  只在 60%–84% 区间快速点两下（-3.5° / +2.5° / -1.5°），所以不是固定节奏。
- **路径随机**：直线（36%）、斜线（34%）、二次贝塞尔曲线（30%，5 个采样关键帧）。
- **速度/尺寸/车道随机**：深度 46–90px，行程时长与步频/摆幅联动。
- **持续生成**：打开对话框先放 3 只（1 只刚入场、2 只已在半路），之后每 360–1180ms
  从左侧随机补一只；到右侧自动移除；同屏封顶 6 只。
- **停止**：点「返回界面」、点遮罩、Esc、退出程序、离开首启登录层，都会
  `stopQuitHorses()`：清 timer、取消 Web Animations、移除节点。
- **减少动态偏好**：`prefers-reduced-motion: reduce` 下不跑，静态放 3 只。

### 3.3 代码位置

- JS：`auth-gate.js` 的 `QUIT_HORSE_SVG / quitHorseNode / spawnQuitHorse / startQuitHorses / stopQuitHorses`，
  以及 `ensureOverlay()` 里的关闭确认接线。
- CSS：`auth-gate.css` 的 `.warmyAuthQuitHorses / .warmyAuthQuitRunner / .qLeg / .qTail / .qHead /
  .qBodyBob` 与 `@keyframes warmyAuthQuitLeg / Tail / Head / Body`。

## 4. 助记词确认弹窗的“取消”改为“返回”

- `askConfirm` 新增第 5 个参数 `cancelText`（默认仍是 `t('cancel')`，其他确认框不受影响）。
- 仅“助记词是你唯一的凭证…确定你已抄写两份并分开放置了吗？”这一处传 `t('back')`：
  `askConfirm('', t('confirmBody'), t('confirmOk'), true, t('back'))`。
- `back` 在 10 个语言包里都存在（中文“返回”、英文 Back、日文 戻る…）。

## 5. 聊天滚动：用户接管后，程序一个像素都不动

### 5.1 真因

`renderChat()` 每次整块重画都会 `heZi.innerHTML = ''`，浏览器把 `scrollTop` 清成 0。
旧实现只在上滚时跳过“顶部对齐”，但没有把原位置放回去 ⇒ 新回复一来，用户正看到的位置
被直接打到最上面。另外，旧代码只监听 `wheel / touchstart / pointerdown`，拖动滚动条、
键盘翻页、辅助设备滚动都可能没被识别成“用户滚过”。

### 5.2 修法

- 重画前记下同一会话的 `prevScrollTop`（用 `heZi.dataset.chatSid` 判断是不是同一会话；
  切会话仍由 `chatScrollPos` 负责）。
- 未勾选「自动滚动聊天记录」且本会话 `topAlignSuppress.has(sid)` 时：
  - 不顶部对齐、不追底；
  - 把 `prevScrollTop` 原样放回（按新 `scrollHeight` 夹紧）；
  - 只更新“新内容提示”气泡，不改变滚动位置。
- `keepScroll` 重画同样恢复 `prevScrollTop`（加载历史/夹具重画不再跳顶）。
- 用户滚动识别补齐：
  - 保留 `wheel / touchstart / pointerdown`；
  - 增加 `mousedown / touchmove`（拖动滚动条/触摸滑动）；
  - 增加 `keydown`：PageUp / PageDown / Home / End / ArrowUp / ArrowDown / Space；
  - 任何**非程序触发**的 `scroll` 事件也算用户接管。
- 程序滚动保护期：`chatZiGunUntil = performance.now() + 180`。`scrollToBottom`、顶部对齐、
  位置恢复、切会话恢复、问题卡重排都先 `markZiGun()`；保护期内的 scroll 事件不误判成用户滚动。
  重建可能超过 180ms，因此在重建结束、真正设置 `scrollTop` 前再续一次保护期。
- 用户发下一条消息时仍会清掉抑制（`tuisongXiaoxi` 的 `role='wo'` 分支），下一轮新回复
  恢复“顶部对齐”，不会永久卡在旧位置。
- 仅测试面：`window.__r35.chongHuaQuan()` 走非 `keepScroll` 的整块重画，供门禁验证。

## 6. 验证

构建：`cd packages/app-shell && npm run build`（tsc + check-syntax + copy-assets）。

新增门禁：

- `dev/gates/verify-r94-ui.mjs` — **27 ok / 0 FAIL**（静态：文案移除、热区尺寸、
  SVG 分包、三档路径、随机生成、停止、助记词返回值、滚动保护/恢复）。
- `dev/gates/verify-r94-ui-live.mjs` — **28 ok / 0 FAIL**（Electron + CDP，两个临时 profile）：
  - 首启语言页底部只剩开始按钮；热区 140×140、叉 44×44、悬停可见；
  - 关闭确认里 4 只牛马，每只 4 腿/1 尾/1 头；腿周期/行程比 6%–13%；
    尾周期 = 步频×2；头时长 1.2–3.6s；速度/尺寸/时长彼此不同；
    腿/尾/头动画真的挂在元素上，300ms 内腿与尾巴的 transform 真的变化；
    900ms 内向右移动、1.8s 内出现新 id、同屏 ≤6；返回后 0 只残留；
  - 助记词确认弹窗正文正确，“取消”按钮文字为「返回」；
  - 未勾选自动滚动时，上滚/下滚后追加新回复，`scrollTop` 前后完全相同（不是 0）。
  - 连跑 4 遍全绿（最后一版 28 项）。

回归：

- `verify-r68-auth-ui`：47/0（更新了 2 条第 92 轮已过时的我的页布局断言：
  资料列/账号列不再要求顶对齐，邮箱改在账号列且在助记词上方）。
- `verify-r67-firstrun` 80/0、`verify-r78-scroll` 6/0、`verify-r81-ui` 20/0、
  `verify-r67-chat-order` 20/0、`verify-r78-auth-tour` 47/0。
- `verify-r92-live` 20/0、`verify-r93-memory-security` 39/0、`verify-r92-duanjiyi-yaoqiu` 42/0。
- `verify-r53-tishangxian` 81/0、`verify-prompt-layers` 31/0、`verify-r52-layers` 54/0、
  `verify-r82-r103` 18/0、`verify-i18n-locales` 162/0、`verify-work-tools` 59/0、
  `verify-renderer-scope` 9/0、`verify-ipc-probe` 46/46。

## 7. 已知历史红（本轮未触碰，非本轮引入）

- `verify-security` 27/28（`verify-r79-ten-rounds.mjs` 含真实本机路径）
- `verify-docs` 93/95（README 里的旧安装包名）
- `verify-renderer-template-balance`
- `verify-css-consistency`（`.yinYongTiao`）
- `verify-r44-ui` 53/14
- `verify-r69-join-create` 15/3

## 8. 首启交付

- 真实 profile：`%APPDATA%\@warmy\app-shell`（删除前已备份到系统临时目录）。
- 交付前状态：`setupDone=false`、`privacyConsent=false`、`providers=0`、`instances=0`。
- 以源码 Electron 启动（`packages/app-shell/dist/electron-main.js`），窗口标题「无限牛马」，
  停留在首启语言页；未签名打包 exe 会被本机 Device Guard 拦截，因此验收用源码构建。
