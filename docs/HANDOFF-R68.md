# 第 68 轮交接（2026-10-23）——首启 / 我的页 / 冲锋预览验收反馈修订

> 工作区仍是未提交状态；本轮未 commit / 未 push。真实配置只做可逆备份。
> 本轮按要求**只测改动过的功能**（首启、认证、我的页、凭证失效、五幕预览），没有重跑全量 fast/live。
> **当前最终状态以 §3.2 为准。** §0–§3.1 保留为同日较早的中间版本记录；其中“国旗”已按后续反馈删除，测试计数也以 §3.2 为准。

## 0. 结论（最终）

- 首启语言页：语言选择与「开始」并排；**无国旗**；首启卡 330px、选单约 220px；10 种语言短名。
- 我的页：左侧一小半品牌 logo + 名称；右侧左列头像/名称/邮箱+名片同行，右列账号卡（助记词已保存或查看、自动登录、修改 PIN/退出并排，开启自动登录时修改 PIN 不可用；无“账号与助记词”标题）。
- 本机凭证：用助记词登录并生成新手动 PIN 或新自动登录后，旧 PIN 与旧自动登录都失效；我的页开启自动登录会清旧 PIN，关闭后可重新设置 PIN。
- 牛马冲锋预览：五幕独立网页 `preview/charge-scenes/index.html`，按“静谧、幽深、宏大、丰富但不拥挤”重做；底部选择条不再遮住近景。
- 改动门禁（同一构建**连续 3 遍**全绿）：
  - `verify-r67-firstrun`：3 × 75/0（静态）
  - `verify-r66-auth`：3 × 15/0
  - `verify-r68-auth-security`：3 × 7/0（AuthService + 临时 vault）
  - `verify-r68-firstrun-ui`：3 × 32/0（真 Electron + CDP）
  - `verify-r68-auth-ui`：3 × 30/0（真 Electron：首启→认证→我的页→自动登录→改 PIN→旧/新 PIN 登录）
  - `verify-r68-charge-preview`：3 × 25/0（真 Chromium：五幕、键盘、慢动画、无错误）
- 最终验收：真实配置可逆备份到 `<配置目录>/__r68-final-2026-10-23T09-57-57-996Z`（含验收期间创建的本机账号、`auth/` 与聊天数据；`identity/secure/memory-runtime/memory` 只复制备份、原处保留）；旧 settings/profile/auth 已移入备份，重开后应用只生成默认 settings（`setupDone=false`、`privacyConsent=false`）与默认 profile，无 `auth/vault.json`；应用重新打开在**语言选择页**，`hasAccount=false`。
- 最终指纹：
  - `dist/renderer/auth-gate.js` 141,310 B `1f271b9a9e2cbefc0a463111bd6da4d3713e9e884901713269a9c70c00eaa5e6`
  - `dist/renderer/auth-gate.css` 19,571 B `2f2298c6f228e9520895a3432fdd3dbf6d3db6f301bb73ee46bb31d091e8947f`
  - `dist/renderer/app.js` 1,565,549 B `6d784eb4d89d5977ee3e9eab6e6fdd498dc3bebb9bf3ae738dfa54902d52ef06`
  - `dist/auth-service.js` 32,406 B `9669fc9e9ae771e54d81723dedf42ee17487317c31091bb5137baffa10668b27`
  - `preview/charge-scenes/index.html` 6,302 B `22f49ec49a0b973601224be09d6867f4b3be6a269421eaa74b017292426c0f39`

## 1. 用户反馈逐条

### 1.1 语言选择和开始并排
- `.warmyAuthFirstCard` 改为 `flex-direction: row`，整卡宽度约 392px；语言选择占剩余宽度，开始按钮 `width: auto`。
- 真机量盒：两者中线差 ≤ 4px；开始按钮在右侧、间距 ≥ 6px，宽度 < 视口 35%。

### 1.2 选项短一些 + 国旗（**已被后续反馈取代：国旗已全部删除**）
- 语言短名：简体 / 繁體 / English / 日本語 / 한국어 / Русский / Español / Français / Português / Esperanto。
- 国旗是内联 SVG（Windows 不渲染国旗 emoji）：中国、台湾、美国、日本、韩国、俄罗斯、西班牙、法国、葡萄牙、世界语。
- 原生 `<select>` 改为自定义列表：两列菜单、10 项、当前项打勾；点按钮开合、Esc 收起；切换后本页开始按钮与 `html.lang` 立即更新，仍会写设置并加载语言包。
- 隐藏的 `#warmyAuthLocale` 保留当前语言值，开始流程不变。
- **最终状态**：按用户“语言选择中去掉国旗图标，选框再短一些”的要求，国旗相关 DOM/CSS/生成函数全部删除；卡片 330px、选单约 220px。见 §3.2。

### 1.3 右上角“一竖”
- 旧实现是 54×54 的米色方块上盖 36×54 深色块，只剩一条 18px 竖边，确实看不出是月亮。
- 新实现：48×48、六行像素块拼成圆月，带三个环形坑、亮点与 `drop-shadow` 辉光；`verify-r68-firstrun-ui` 量到宽高 ≥ 30px 且宽高比接近 1。

### 1.4 logo 融入动画
- 删除 `.warmyAuthCornerLogo` 与对应 CSS。
- 真实的 `icons/logo-tight.png` 像素牛进入场景右侧领跑位，与首启卡不重叠；有独立 `warmyAuthLead` 原地踏步循环（`steps + infinite`）、上下起伏和扬尘，不再随队伍跑出画面。
- 军旗改为红底 + 牛头徽记，不再把一整张图贴在旗面上。

### 1.5 更丰富的冲锋
- 牛马从 4 头增加到 6 头，按远近距离分层，脚下落地；新增跑步腿（两组交替）、尾巴摆动、披风、旗帜摆动、喊话波纹。
- 天空新增月亮辉光、两朵漂移云、两颗流星；地面新增草丛/碎石、第二组扬尘；全场景 19 个 `@keyframes`，均为 `steps` + `infinite` 的像素循环。

## 2. 改动文件

- `packages/app-shell/src/renderer/auth-gate.js`
  - `LOCALE_SHORT`、`flagSvg()`、自定义语言菜单、开关/选中/Esc 处理。
  - `firstRunScene()` / `beastSvg()` 重绘；品牌牛与军旗徽记。
- `packages/app-shell/src/renderer/auth-gate.css`
  - 并排卡片、国旗/菜单样式；月亮/云/流星/余烬/腿/尾巴/披风/旗帜/领跑牛动画；删除角落 logo 样式。
- `dev/gates/verify-r67-firstrun.mjs`
  - 首启静态判据更新到新布局，新增国旗真值、菜单交互、月亮形状、品牌牛位置/动画等；60 项。
- `dev/gates/verify-r68-firstrun-ui.mjs`（新增）
  - 真 Electron + CDP：并排几何、菜单 10 项、10 面唯一国旗、Esc、切换即时生效、品牌牛在卡右侧且不重叠、月亮几何、动画 computed 值、真实 transform 变化、进入条款页；33 项。
- `dev/gates/run-verify-22.mjs`
  - 新真机门禁登记进 live 档（不改变本轮只测改动范围的口径）。

## 3. 验收与清理

- 临时 profile 每次测试后删除；截图只在 `%TEMP%` 供本轮核对，收尾删除。
- 真实配置用可逆重命名备份到 `<配置目录>/__r68-firstrun-<时间戳>`，没有 `rm -rf` 用户数据；`identity/secure/memory-runtime/local-speech` 等保护区不搬。
- 首启验收页：语言选择 + 开始并排、菜单 10 国国旗、品牌牛常驻右侧、圆月与循环冲锋动画。

## 3.1 同日二次首启/认证修订（验收反馈）

- **语言页**：去掉全部国旗图标；首启卡 330px，语言选单约 220px；10 种语言短名保留。
- **条款页**：删除“滚动…才能勾选同意”提示与“我已阅读并同意…”勾选框；滚到条款底部后才开始计时，满 3 秒“同意并继续”按钮启用（`termsBottomAt`，不是从打开页面计时）。
- **入口页**：不再有“创建助记词账号”介绍页/品牌块/标题。**始终显示 PIN 输入 + 登录确认**；无账号时 PIN 与登录按钮置灰，并提示先注册/用助记词登录；下方固定两个入口“使用助记词登录 / 注册新账号”，注册直达助记词页；有账号时 PIN 与登录按钮正常可用。
- **助记词页**：去掉品牌块与标题；简体中文默认勾选“中文友好型（全拼）”，其他语言默认不勾选。全拼显示去掉内部编码的音调数字与连字符，不再显示逐词编号；两音节一组（24 组）或四音节一组（12 组）可切换。仍兼容同一份 24 词英文助记词的恢复；`auth-core` 新增展示全拼解析。
  - 说明：4 音节一组是把同一份 48 音节展示按四个音节分组，不是另造 12 个中文成语/12 词助记词；没有改变派生密钥的底层助记词，避免旧账号失效。
- **文案**：助记词正文追加“助记词是你唯一的凭证，没有任何找回的方法！”；确认弹层改为“助记词是你唯一的凭证，没有任何找回的方法！刚刚的助记词将被销毁，之后无法再次查看，确定你已抄写两份并分开放置了吗？”；10 语言同步更新。
- **用户名页**：删除“这个称呼只保存在本机…”说明与“称呼”标签；保留“给自己起个称呼”标题与无障碍名称。
- **验证（同一构建连续 3 遍）**：`verify-r67-firstrun` 3×66/0；`verify-r68-firstrun-ui` 3×32/0；新增 `verify-r68-auth-ui` 3×19/0（临时 profile 全流程：语言→条款→入口→助记词→PIN→用户名→登出登录页）；`verify-r66-auth` 3×15/0。认证全流程无脚本错误。
- **首启交付**：真实 profile 的配置与 `auth/` 可逆备份到 `<配置目录>/__r68-auth-feedback-2026-10-23T09-25-35`（旧备份 `__r68-firstrun-2026-10-23T08-50-39` 仍在）；应用重新打开在语言页，`setupDone=false`、无账号、无 `vault.json`。
- 最终认证相关指纹：
  - `dist/renderer/auth-gate.js` 141,345 B `63d3f90c0c66fb619d187087f6b52d78326700a6e84df4cfcf0ce74916642d0f`
  - `dist/renderer/auth-gate.css` 17,349 B `16bf292b156c66bf46ed7f413195050510257712c85942a43069bf5bae4730eb`
  - `dist/auth-core.mjs` 16,002 B `03ef44a8aac5e80f7ee4628cdb2ad22ab5044094676358633d6262cbbc6b9dcc`

## 3.2 同日三次修订（当前最终状态）

### 3.2.1 我的页
- 布局：`.woDingR68` 横向三块。左侧 `.woBrandR68`（`logo-tight.png` 104px + 品牌名，27%）；右侧 `.woR68Body` 再分 `.woR68Profile`（头像、名称、邮箱输入+名片图标同一行，44%）与 `#warmyAuthMyCard`（账号列，46%）。980px/700px 两档改为上下叠放。
- 账号卡：**没有**“账号与助记词”标题；第一行“助记词：已保存”（中文全角冒号；未确认时变成“查看助记词”按钮），下面“本机自动登录”勾选项，再下面“修改 PIN / 退出账号”并排；自动登录勾选后“修改 PIN”按钮 `disabled`，取消后恢复。PIN 未配置时按钮文案是“设置 PIN”。
- 名片弹窗沿用第 67 轮协议（头像勾选、服务商多选、无服务商不生成、头像嵌入二维码中心），本轮未改；真机门禁新增点开检查：头像勾选默认选中、服务商列表存在、无服务商时“生成”置灰且不出码，关闭后账号卡重新挂载再继续。
- 真机量盒写进 `verify-r68-auth-ui`：品牌在左、资料列与账号列不重叠、邮箱与名片中线差 ≤3px、按钮同一行且修改 PIN 在退出左侧、卡片不溢出。
- 未确认助记词态通过 `authConfirmMnemonic('later')` + 重绘账号卡验证，随后恢复 `'confirm'`。

### 3.2.2 助记词登录后的本机凭证失效
- 口径：用助记词登录/恢复后，如果本机生成新的手动 PIN，或生成新的自动登录凭证，**原来的 PIN 和原来的自动登录都必须失效**。
- 实现：
  - `registerCommit` / `recoverCommit` 每次都构造全新的 `AuthVaultFile` 并整体写入（`pin`/`autoLogin` 只来自本次选择），旧文件里的凭证不会被合并续用。
  - `setAutoLogin(true)` 生成新自动登录记录时清掉 `pin`、`failedAttempts`、`lockUntil`；旧 PIN 立即 `pin-not-configured`。
  - `changePin` 允许在“自动登录已关闭且当前无 PIN”时设置新 PIN；自动登录开启时仍返回 `auto-login-enabled`。
  - 负向保护：未确认助记词 → `auto-login-requires-confirmed-mnemonic`；系统保护不可用 → `os-protection-unavailable`；这两种失败都不清旧 PIN。
- `dev/gates/verify-r68-auth-security.mjs`（新增，7 项，假 protector + 临时 vault，不碰真实数据）覆盖：
  A 恢复+新 PIN；B 恢复+新自动登录（比较 machine id 证明旧记录被替换）；C 恢复只生成自动登录；D 恢复+新 PIN 不复活旧自动登录；E 我的页开启自动登录清旧 PIN、关闭后设新 PIN；F 两条负向保护；G 强制重新注册后旧 PIN 失效。
- 真机 `verify-r68-auth-ui` 追加：勾选自动登录后旧 PIN 立即 `pin-not-configured`；关闭自动登录后设置 `New1234`，回登录页旧 PIN `Test1234` 失败、新 PIN 成功。

### 3.2.3 五幕静谧冲锋预览
- 入口：`preview/charge-scenes/index.html`（本地双击即可；无外链、无服务器）。五幕：
  1. `mist` 雾关 · 长驱：冷月、层叠山脊、戍楼、山脊细队、雾带；近景一牛一指挥。
  2. `river` 长河 · 夜渡：暮色大河、落日碎金倒影、远岸城灯、涉水细线、芦苇与岸灯。
  3. `snow` 雪岭 · 灯河：大月、极淡极光、雪夜火把长队、近景披霜牛。
  4. `ruins` 荒原 · 残旗：暖灰天光、断墙/残柱/枯树、余火与烟、远处几头牛马、近景继续走的人。
  5. `clouds` 云海 · 天关：云海、天关屋脊/拱洞/灯、云上山脊小队、近景牛与指挥。
- 动态约束：五幕都没有 `screenShake` / `lightningBolt` / `flame` / `dustCloud`；粒子稀、雾/云/星光慢速；`verify-r68-charge-preview` 用真实画布采样证明“在动但变化面积 <45%、平均亮度变化 <24”。
- 布局：底部选择条固定在视口底部；五幕近景牛/指挥者的脚都不超过 320px（选择条顶约 323px 以上），不再被遮住。键盘 1–5、←/→、F 全屏，点击 5 个标签也可切换。
- 这五幕是**独立选型页**，本轮没有替换应用内的首启 SVG 动画；选定后再接入。

### 3.2.4 最终验收与清理
- 同一构建连续 3 遍：`verify-r67-firstrun` 75/0、`verify-r66-auth` 15/0、`verify-r68-auth-security` 7/0、`verify-r68-firstrun-ui` 32/0、`verify-r68-auth-ui` 30/0（含名片弹窗）、`verify-r68-charge-preview` 25/0，无一遍失败。
- `dev/gates/run-verify-22.mjs` 登记新增的 `verify-r68-auth-security` 与 `verify-r68-charge-preview`。
- 真实配置可逆备份：`<配置目录>/__r68-final-2026-10-23T09-57-57-996Z`。其中包含验收期间创建的本机账号 `auth/`、profile、settings、聊天/实例/归档等；`identity/secure/memory-runtime/memory` 仅复制备份、原处保留（保护区不动）。
- 活动 profile 的旧 settings/profile/auth 已移入备份；重开后应用生成默认 settings（`setupDone=false`、`privacyConsent=false`）与默认 profile，无 `auth/`；真机读到 `lang=zh-CN`、`start=开始`、10 个语言选项、0 面国旗、卡宽 330px、`hasAccount=false`。
- 临时脚本/截图/profile 收尾删除；未 commit / 未 push。

### 3.2.5 需要拍板 / 历史未完成
- **需要你拍板**：五幕里选哪一幕接入应用首启动画，或要合并哪几幕的元素（例如雾关的山脊细队 + 长河的落日）。
- 历史未完成：网络 B/A（稳定签名邀请名片、会话路由/在线/流式、扩网跳数上限+双向签名+附加文本频率限制）；真实微信扫码 E2E（需手机扫码，真实收发未验）；全角色权限矩阵/服务商绑定二维码/审批流/项目群设置/右键分类/其他社交连接器/自动翻译校对/Unicode 软门禁接入写代码工具/认证身份深锁/macOS/Linux 全量真机。
- 回档限制：进程内文件写入可记账；`run_shell` 子进程在工作区外写盘仍不被 journal 捕获。
- 决策文档位置与待拍板项不变：`docs/HANDOFF-R67.md` 末节、`docs/DECISIONS-R63.md`、`docs/P0-5-ZITUOGUAN.md`、`docs/P0-6-TUMIN.md`。

## 4. 未改/未完成（历史遗留，未在本轮处理）

- 网络 B/A：稳定签名邀请名片、会话路由/在线/流式、扩网跳数上限+双向签名+附加文本频率限制。
- 真实微信扫码 E2E 仍需手机扫码；真实收发未验。
- 全角色权限矩阵、服务商绑定二维码/审批流、项目/群设置弹窗、右键分类、其他官方社交连接器、自动翻译校对、Unicode 软门禁接入写代码工具、认证身份深锁、macOS/Linux 单文件与全量真机。
- 回档限制：进程内文件写入可记账；`run_shell` 子进程在工作区外写盘仍不被 journal 捕获。前几轮的决策文档位置与待拍板项不变（见 `docs/HANDOFF-R67.md` 末节、`docs/DECISIONS-R63.md`、`docs/P0-5-ZITUOGUAN.md`、`docs/P0-6-TUMIN.md`）。
