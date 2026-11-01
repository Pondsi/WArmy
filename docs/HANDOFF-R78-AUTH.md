# HANDOFF · 第 78 轮 · 首启/登录 7 项

日期：2026-10-24　范围：`packages/app-shell/src/renderer/auth-gate.{js,css}`（未改 `electron-main.ts` / `app.js` / `she-jiao-adapter.ts` / `fwarmy/`）

## 结论

7 项全部实现，真机门禁 `39/0`（连跑两次稳定）；同步改写了 3 个与新行为冲突的旧门禁（改门禁、没有改回旧行为）。
新增门禁：`dev/gates/verify-r78-auth-tour.mjs`（纯函数 + 临时 profile 真 Electron + 截图）。

## 逐项：改了什么 / 怎么验

### ① 我的页勾「自动登录」二次确认；取消保持未勾选

- `onMyCardChange`：勾选时不直接落库，先 `askConfirm(myAutoConfirmTitle, myAutoConfirmBody, autoEnable)`。
- 取消：勾选框显式复位 `checked=false`，清账号卡签名缓存并重渲染；不调用 `authSetAutoLogin`，PIN 不受影响。
- 确认：才走原 `toggleMyAuto(true)`。**取消勾选不需要确认**（需求只要求“勾选时”）。
- 验：`verify-r78-auth-tour` ①三条（弹层出现 / 取消后 `checked=false && autoLogin=false && pinConfigured=true` / 确认后 `autoLogin=true`）；
  `verify-r68-auth-ui` 的自动登录段已改为先点弹层 OK。

### ② 首启语言平铺，点一下即选

- 删掉下拉按钮/菜单/Esc/`langOpen` 全链路；`renderLanguage` 改为 `.warmyAuthLangGrid` 两列 × 5 行 10 个 `.warmyAuthLangTile`（`role=radio`，选中态 `is-on`），底部保留「开始」+ 当前语言名。
- 点格子 = 原 `lang-pick`：立即换文案 / `html lang` / `settingsSave` 落盘，无需二次确认。
- 验：`verify-r78` ②四条（10 块、无 select/菜单/aria-haspopup、两列可见不出屏、点 English/简体后文案+选中态+落盘同步）；
  `verify-r68-firstrun-ui` 已按平铺重写；`verify-r67-firstrun` 静态断言同步。

### ③ 登录页：PIN 内嵌登录按钮、整页更小、保留返回语言页

- `renderLogin`：`#warmyAuthPin` 外包 `.warmyAuthPinRow`，按钮 `.warmyAuthPinGo` 绝对定位 `right:4px` 覆盖在输入框内（输入框 `padding-right:110px`），仍是 `data-auth-action="login-pin"`。
- 卡片加 `.warmyAuthCardCompact`（≤400px，内边距收紧）；左上 `login-lang-back`（`返回语言选择`）回到首启语言页。
- 按钮宽度随语言自适应：`fitPinInline()` 按按钮实测宽度设输入框 `padding-right`（法语 Se connecter / 西语 Iniciar sesión 也不截断）。
- 验：`verify-r78` ③：按钮矩形完全落在输入框内、`elementFromPoint` 命中的是登录按钮（输入框左侧命中输入框）、卡片 ≤420px、返回后能经条款再回登录、错 PIN 有错、正确 PIN 用该按钮登录成功。
- 注：返回语言页 → 开始 → 条款（3 秒）→ 登录，是刻意保留的完整路径，不是死路。

### ④ 语言 / 条款 / 登录持续播放同一牛马背景

- 新增 `stepHasScene()`，`render()` 给这三步加 `warmyAuthGateFirstRun`；条款/登录 `render` 注入同一个 `firstRunSceneLight()`，卡片浮在场景上（`.warmyAuthCardOnScene`）。
- `render()` 把 `.warmyAuthScene` **提升为门（viewport）的直接子节点**：卡片自身有 `overflow/backdrop-filter`，留在卡片里会被裁成一小块。
- 验：`verify-r78` ④：三屏场景均存在且铺满、语言页两次采样 `transform` 不同（真的在动）。

### ⑥ 助记词：成语 12 格（每格 2 个索引）/ 词组 24 格

- 新增 `pairIdiomItems()`：第 k 格 = 第 (2k+1, 2k+2) 个 BIP-39 词，显示 `P[k]=I[2k]`（I 为主进程按词序生成的 24 个成语），序号 `1-2 … 23-24`，`data-cover="1,2"`，`data-pair="成语A|成语B"`（第二个成语不丢，便于核对/后续做真·配对码本）。
- 词组模式不变：24 格、1–24。
- 映射/恢复：只是**展示折叠**，不改顺序、不改词表；关掉中文友好型仍是同一份 24 个 BIP-39 词（门禁逐字比对切换前后数组相同），恢复链路完全未动。
- 验：`verify-r78` ⑥五条 + 纯函数段（`pairIdiomItems` 直接跑 24→12 覆盖校验，不需要 Electron）；`verify-r68-auth-ui` 成语段改为 12 格断言。

### ⑦ 中文友好型：序号与词同一行、每条两行、不出屏

- `mnemonicMarkup` 友好格子加 `.warmyAuthWordFriendly`；CSS grid：`序号 | 词` 第一行、`拼音` 第二行（同一列）。
- `.warmyAuthMnemonic` 上限 `min(56vh,560px)` 自带滚动；`max-height:720px` 时降到 `50vh`。
- 验：`verify-r78` ⑦：每格序号/词中线差 ≤3px 且序号在左、拼音在词下方且左对齐；卡片与助记词区底边 ≤ 视口；
  另加 `Emulation` 1024×640 小窗复测仍不出屏（截图 `04b-mnemonic-small.png`）。

### ⑧ 引导卡 → 漫游式 spotlight，可跳过 / 可重看

- `auth-gate.js` 新增 tour 模块（每 220ms 巡检，不挂 app.js）：发现 `#yinDaoTiao` 且已进入软件（`state.step==='done'`）就接管：
  - `body.warmyTourOn` 把原底部条 `display:none`（仍留在 DOM，按钮继续由 app.js 驱动）；
  - 四块 `.warmyTourDim` 挖洞 + `.warmyTourHole` 橙色描边，**遮罩 pointer-events:none（非阻塞，保持原引导“不打断操作”原则）**；
  - `.warmyTourCard` 贴目标下方/上方，复制原条标题/正文/收益/外链/进度与真实图标，按钮代理 `[data-yd=skip|go|next|tip]`；
  - 跳过（按钮或 Esc）→ 原条 + 漫游层一起收；引导条再次出现（重看）自动重新接管。
- 重看入口：**设置 → 关于 → 重新打开首次引导卡**（app.js 既有），或 `window.__warmyTour.replay()`。
- 验：`verify-r78` ⑧六条（原条隐藏、遮罩穿透、洞套住 `.yinDaoGaoLiang`、卡片不压目标、代理「下一步」仍走 app 达成条件、跳过清场、重看回到第 1 步）；`verify-r67` 静态断言。

## 需要你补的 i18n 键（新文案全部 `tOr(key, fallback)`）

`tOr` 解析顺序：内置字典 → 已加载 i18n 语言包（`packages/app-shell/src/i18n/*.json`）→ 中文兜底。未补键时非中文界面会显示中文兜底。

| 键 | 中文兜底 | 用途 |
|---|---|---|
| `backToLanguage` | 返回语言选择 | 登录页返回首启语言页 |
| `myAutoConfirmTitle` | 开启本机自动登录 | 自动登录二次确认标题 |
| `myAutoConfirmBody` | 开启后本机会自动登录，不再每次输入 PIN。更改设备的硬件或系统升级都可能导致失效，助记词是唯一的恢复方法。确定开启吗？ | 确认正文 |
| `autoEnable`（复用） | 自动登录（绑定本机） | 确认按钮文案 |

引导相关文案全部复用 app.js 既有 `guide.*`（10 语言已在包内），无需新增。

## 门禁与复跑

```bash
node packages/app-shell/scripts/copy-assets.mjs      # src/renderer → dist/renderer（dist 是 gitignore）
node dev/gates/verify-r78-auth-tour.mjs              # 39 ok / 0 FAIL
node dev/gates/verify-r67-firstrun.mjs               # 80 ok / 0 FAIL
node dev/gates/verify-r68-firstrun-ui.mjs            # 25 ok / 0 FAIL
node dev/gates/verify-r68-auth-ui.mjs                # 46 ok / 0 FAIL
```

- 全部用临时 `--user-data-dir`，结束删目录；不联网、不调用真实 AI/微信、不安装任何东西。
- 截图：`%TEMP%\warmy-r78-auth\`：01 语言页 / 02 条款 / 03 登录(无账号) / 03b 登录(有账号，内嵌按钮启用) / 04 词组 24 / 04b 1024×640 小窗 / 05 成语 12 / 06 引导 spotlight / 07 自动登录确认。
- 改过的旧门禁：`verify-r67-firstrun`（下拉→平铺、新增 R78 静态段）、`verify-r68-firstrun-ui`（下拉/Esc→平铺点击）、`verify-r68-auth-ui`（成语 24→12、自动登录先点确认弹层）。

## 未完成 / 风险

1. **成语“12 个 → 24 词”的文本恢复**没有接到主进程解析器：`auth-core.mjs` 不在本轮文件清单，当前 12 格是展示折叠（含 `data-pair` 保留第二个成语）。若你要“只抄 12 个成语就能恢复”，需要在主进程加配对码本（P[k] ↔ 词 2k/2k+1）并改恢复页。
2. 背景动画只覆盖点名的三屏（语言/条款/登录）；助记词/PIN/用户名仍是普通卡片（24 格可读性）。要“一直播到 finishAuth”只需把 `stepHasScene()` 放开，但卡片会变窄。
3. 漫游层是**代理 app.js 引导条**：app.js 若大改 `#yinDaoTiao` 内部结构，卡片文案会取不到（会退化为无引导，不会报错）；完全重写引导建议直接做进 app.js。
4. 遮罩是点击穿透（有意）。若要“只能点高亮目标”的强引导，把 `.warmyTourDim` 的 `pointer-events` 改回 `auto`。
5. `packages/app-shell/scripts/verify-firstrun-ui.mjs`（GATE-MANIFEST 里的 `verify-firstrun-ui`）测的是 R67 之前的首启对话框（`#chuShiSheZhiYuYan`），已被认证门取代、与本次无关，未改；`verify-busy-toggle` 仍能点隐藏的 `#yinDaoTiao [data-yd=skip]`。
6. 未提交、未重置、未删任何用户配置。
