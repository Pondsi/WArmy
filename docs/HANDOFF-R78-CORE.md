# 第 78 轮交接 · 核心 UI 与场景（2026-10-24）

> 未提交、未 push。对应监督器 `docs/supervisor-state.json` 的 10/12/13/17/19/23/25/26 与 22 的预览部分。

## 已完成

### 10 十种语言默认提示词限长
- 新增 `dev/gates/verify-r78-prompt-limits.mjs`：逐语言检查道/术（按 `YU_YAN_ZI_SHU_BEI_LV` 折算上限），并检查 9 套人格预设的 `content` 不超过「认知」上限。
- 结果：**29/0**；道/术 0 超限，人格预设最大 2505 字符（上限 5280–6400）。
- 既有 `verify-r54-i18n-defaults` 17/0 仍通过。

### 12 思考级别 / 小弟数量 / 上下文预算同一行
- `app.js` 牛马管理局三块包进一个 flex 行，分别 `flex:1 1 240/180/260px`，窄屏自动换行。
- 未改任何控件 id 与保存逻辑。

### 13 微信（个人）改名
- 适配器与渲染层兜底清单均改为「微信（个人）」；旧门禁 `verify-r67-chat-order` 同步更新，20/0。

### 17 未勾选自动滚动时不再强行顶部对齐
- 新增 `yingDingBuDuiQi(suppressed, key, lastKey, atBottom)`：用户手动滚过（wheel/touchstart/pointerdown）、点“到底”箭头、同一段流式内容重复更新、已经在底部 ⇒ 都不拉。
- 每会话记录 suppressed；用户发送新消息时清空，下一次新对话可重新顶部对齐。
- 新增 `dev/gates/verify-r78-scroll.mjs` 真值表 + 接线检查：**6/0**。

### 19 工具与中间回复按时间混入思考
- `guiNaXingDong` 末尾按 `data-ts` 对「思考段 + 操作行」整体重排，DOM 顺序必等于真实时间顺序；不再依赖插入路径的偶然正确。
- `verify-r67-chat-order` 20/0（同步更新了两条已过时的 ASR/微信断言）。

### 23 创建项目/群聊默认名称与“本机”
- 打开创建窗口即填入“项目/群聊 + MM-DD HH:mm”默认名；项目默认选中 `host`（本机），创建按钮直接可用。
- 用户可改；未改 i18n。

### 25 第二列更窄且不挡 logo
- 默认宽度 240→200，拖动下限 200→180，重置 200；`renderer.css` 的兜底值同步 200。
- 第二列底部水印改为 `background-size: min(168px, calc(100% - 24px)) auto`，窄列不裁切。

### 26 项目/群聊/联系人第二列按钮去外框
- `#lieBiaoDongZuo, #anNiuJiaRuqr { border:none; background:transparent }`，保留图标与悬停反馈。

### 1–9 首启 / 登录 / 我的页（与 A 组交接）
- 自动登录二次确认；语言 10 种平铺；PIN 内嵌登录按钮、可返回语言页；语言/条款/登录/助记词/PIN/恢复/用户名全程共用同一背景；成语 12 格、词组 24 格；中文友好型序号与词同一行；漫游引导。
- 我的页：左侧品牌占 46% 居中，右侧资料居中短邮箱，账号区去卡片底色；取消自动登录先弹 PIN，设置成功才生效，取消则保持勾选。后端 `changePin` 支持同一笔写入 `disableAutoLogin`，该路径不锁当前会话。
- 验证：`verify-r78-auth-tour` 40/0、`verify-r67-firstrun` 80/0、`verify-r68-firstrun-ui` 23/0、`verify-r68-auth-ui` 46/0。

### 22 第 10 幕远近与缩放（已接入首启）
- 花野路线改为横向为主：`hx = 640 + 360 sin(hs)`，`hs` 更慢；深度 `hy = 600 - 22 sin(hs+0.6)`，`k = 13.5 + (hy-600)*0.05`（约 ±1.1），不再出现“几乎水平走却明显变大”。
- `verify-r74-firstrun-scenes` **50/0**。
- **已接入正式首启/登录**：`auth-gate.js` 在 gate 下常驻一个 `firstrun-scenes/index.html?embed=1&scenes=1,2,4,6,9,10&period=12000` iframe，HUD 隐藏、铺满窗口、切页不重载、进入软件后隐藏；`copy-assets.mjs` 会把预览目录复制进 `dist/renderer/firstrun-scenes`。
- 浏览器单独预览：`http://127.0.0.1:8899/preview/firstrun-scenes/index.html?embed=1&scenes=1,2,4,6,9,10`（当前临时静态服务仍在跑）。

## 验证

- `verify-r78-prompt-limits` 29/0
- `verify-r78-scroll` 6/0
- `verify-r67-chat-order` 20/0
- `verify-r74-firstrun-scenes` 50/0
- `check-syntax` 通过

## 未完成

- 22 的正式首启接入（预览已可看）。
- 1–9 由 `HANDOFF-R78-AUTH.md` 记录；18/20/21 由 `HANDOFF-R78-NM.md`；11 由 `HANDOFF-R78-FWARMY.md`。
