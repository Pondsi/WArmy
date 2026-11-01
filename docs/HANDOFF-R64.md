# 第 64 轮交接（2026-10-22）

> 本轮用户 40 项，范围很大。本文按「已落地 / 进行中 / 未完成 / 需要你拍板」四块写，**每完成一块就更新**，不把未验证的东西写成已完成。
> 所有改动未 commit、未 push。最终构建（2026-10-22 21:23）：
> `packages/app-shell/dist/electron-main.js` = **1,569,331 字节**，sha256 前缀 **`bffda81d45403507`**；
> `dist/renderer/app.js` = **1,538,393 字符**，sha256 前缀 **`5101bf710570e025`**；HEAD `0e4226a`。

---

## 0. 本轮已完成（有代码/静态门禁证据）

### 0.1 主界面与设置

| 用户项 | 结果 | 证据 |
|---|---|---|
| 1 吸附默认开 + 落盘 | `zhuXiFuKai` 写入 settings，默认 true；主进程读写；重启保持 | `settings-store.ts`、`electron-main.ts` 的 `zhuXiFuDangQian()` / IPC；`verify-r62-ui` 新增落盘断言；`verify-r63-main-ui` 17/0 |
| 1 吸附/置顶样式 | 两个按钮都改成 **currentColor 内联 SVG**；未启用 = 字体色，启用 = `--accent`；置顶图标改成 nm 同款 | `index.html`、`app.css`/`renderer.css` |
| 17 用户气泡/左栏图标 | 用户气泡底色改为 `var(--accent)`；左栏未选中 `--rail-fg: var(--ink-dim)`、选中 `--rail-accent-ink`（按对比度算）；设置加载/变化都同步 `--me-bubble` | `app.css`、`renderer.css`、`app.js` |
| 16 执行中标题条 | `.siKaoKuai > summary` 从 `inline-flex` 改为 `flex; width:100%`，突出条包住整行 | 两份 CSS |
| 21 置顶图标统一 | 主界面改用 nm 的 pin path；nm 主题参数仍由主进程传入 | `index.html`、`nm-viewer.html`（nm 子代理） |
| 24/25 吸附 | 主窗口贴边改为**拖动结束 160ms 后**再贴（减少与 Windows Aero Snap 打架）；nm 窗口把主界面作为吸附目标（id=-1，只移动 nm，不动主界面） | `electron-main.ts`、`nm-viewer-win.ts`；静态门禁 |
| 26 操作记录 | 行首只写动作（写入/生成/修改/删除/查看文件夹…）；展开明细显示**完整绝对路径**；`plan_update` 展开显示步数与进行中/最近完成 | `electron-main.ts`、`app.js` |
| 27 nm 打开项目文件 | 新增设置卡「使用 nm 查看器打开项目内文件」+ 启用勾选；插件不可用时灰色；左键/右键按勾选状态一正一反；新增 `nmKaiWenJian` 设置 | `app.js`、`settings-store.ts`；新 i18n 键 10 语言 |
| 28 话筒/ASR | **修了真 bug**：本机语音「启用」没勾时，`asrLocalOnly` 默认 true 仍把它拦住，永远不走听话模型链。现在只有本机语音确实启用时才执行「仅使用本机」。真机门禁新增「本机未启用 + asrLocalOnly=true」场景，MiMo ASR 正常转写 | `electron-main.ts`、`dev/gates/verify-round38-asr.mjs`；**10/0** |
| 15 联系人右键菜单 | 新增 查看资料 / 重命名 / 备注 / 自动归档 / 提醒 / 删除（本地备注与显示名持久化；删除走 `sessionDelete` 回收站） | `app.js` `contactMenu` |
| 33 旧日志清理 | 已删除 `.r50-logs/`、`.r6x` 旧验收日志与 `round18*-r1.log`、`verify-22-*`（均未跟踪；用户已批准） | 文件系统 |

### 0.2 第 7–10 项决策落地（用户已给选项）

- **7 write_file 破坏性覆盖**：已实现「本任务写过的文件、新内容 < 旧内容 50%」时弹确认卡；卡里有**推荐项**（用户原话明确要求重写/精简 ⇒ 推荐覆盖，否则推荐不写）；2 分钟超时默认不写；写审计 `chat.write-overwrite-card`；文件名和字数进入卡面。`verify-r63-main-ui` 17/0。
- **8 P0-6 白名单 D**：本轮只落了代码锚点/文档，**尚未实现审计+一键撤销 UI**（见未完成）。
- **9 P0-6 历史重扫 B**：尚未执行（dry-run 脚本未写）。
- **10 canary 进 live B**：尚未接进 live 档（fast 已有 canary 探针）。
- **11 三层知识库统一**：尚未改 `kbLayersFor` 矩阵；当前仍是群聊只读会话层、项目会话+内部、联系人会话层、我的牛马三层。用户新口径「三层统一、群内专有知识靠聊天记录」需要改读矩阵与第四列卡，未做。
- **12 第四列三个授权勾选**：尚未做。
- **13 知识库用户切换/HNS 标识**：尚未做。
- **34 round16 慢任务**：已改工具循环硬顶——只要 `huizhuYouJinZhan` 看到净进展，就把硬顶计时清零；真正卡住仍由「5 分钟零产出」判定。测试仍可用更快的本机模型。
- **35 整遍 live 1 遍**：尚未跑（等新构建/重启后）。
- **36 出厂默认牛马 B**：当前首启仍是 `instances=0`，与 B 一致；无代码改动。
- **37 有道词典**：调研结论 **不可行**（见 §2）；保留「MT + 每种 20 条 LQA」。
- **38 服务器免登录**：你已接受。
- **39 FWArmy 独立程序**：子代理正在做（见 §1）。

### 0.3 翻译（第 5 项）

- 名称/副标题 9 语言 **2200/2200**；en-US 正文 **2200/2200**。
- 其余 8 语言正文：zh-TW/ja/ko/fr/es/pt/eo 全部完成，ru **2185/2200**；合计 **17,585/17,600（99.91%）**。ru 剩 15 条反复卡在「残留汉字」校验（模型坚持保留中文专名/术语），已用「禁止残留汉字、专名转写」提示重试；这些条目**没有写入可用文件**（不会出现中俄混排），列为待人工/下一轮处理。
- 质量：机器翻译 + 确定性校验；有道词典 17,600 条逐条校对不可行（见 §2），保留「MT + 每种 20 条 LQA」，LQA 尚未开始。

---

## 1. 进行中（子代理，完成时补读数）

- **FWArmy（第 39 项）已完成**：`fwarmy/` 从旧名 `relay-server/` 改名；自包含管理页、首次自动凭据、逐凭据速度/日/月/年配额/停用/删除、`data/stats.json` 统计、Windows 单文件 `dist/FWArmy.exe`、headless/console 启动器均已落地。四支门禁 35/20/24/39 各 3 轮全绿；Windows 实机读数见 §6。macOS/Linux 只给了目标系统构建脚本，未实测。
- **nm 查看器**：`nm-viewer.{html,js,css}` 已更新；新增 `packages/app-shell/scripts/verify-r63-nm.mjs`，**38/0 × 3 轮全绿**。覆盖：工具栏一行与查找/替换顺序、SVG 左源码右效果可拖动、DOCX/XLSX/PPTX 预览页、缩放/打印、双击全屏、未保存关闭确认、只读自动保存禁用、音乐信息条、视频进度条悬停不变短、主题回退。
- **网络设置 UI**：子代理正在做主机模式折叠、IP 检测（≥1.3s）、host:port/59599、主机≤10、服务商≤1000/7 行、增删改；只做 UI/持久化，不声称协议打通。

---

## 2. 调研结论（联网 + 代码核对）

### 2.1 组网（用户第 2/3 项）

**已有**：Ed25519 握手 + X25519 ECDHE + AES-GCM、TOFU/证书/吊销、LAN 广播发现、STUN/NAT-PMP、中继隧道类与判定、IP/公网/阶梯 UI。
**缺 UI**：主机模式折叠、≥1.3s 真实动画、直连三态、`host:port` 解析、地址≤10、服务商≤1000/7 行/增删改、首屏自动填公网 IP；现地址列表无上限、只在点“刷新”时填入公网 IP；服务商后端有但无 UI、凭据明文回渲染层。
**缺协议/接线**：中继隧道未启用、DHT/会合未接、重启不自动开组网、relay 队列仅内存 30s；A/B 双发无 msgId 会重复/可重放；身份仅 Ed25519，relay 需 X25519 box key；在线文件传输未实现。
**最坏**：把公网地址当“可直连”（入站本机无法验证）、1000 并发耗尽 FD/内存、旧 IP 冒用 + TOFU 首连 MITM、A/B 重复、凭据泄露。首日可用；次日/第三日只有静态 IP/DDNS+端口映射+手动重开时才成立。

### 2.2 有道词典（第 37 项）

`<词典安装目录>`（有道词典 11.3.24.0）是 CEF GUI；未发现 CLI/本地 API、当前无监听端口/服务；`yddict://` 只有 doc/screenshot 等深链；官方云端 OpenAPI 需要 appKey/appSecret，与桌面端无关；条款禁止反向工程。GUI 自动化 17,600 条理想下限 10–15 小时，实际脆弱/干扰桌面/可能触发风控且无审计。**结论：不可行**，保留 MT + 每种 20 条 LQA；词典只做人工抽检。

### 2.3 概要 TTL（第 32 项，先回答）

TTL 指的是**知识库里的概要条目**（`internal`/`session` 层的“能力概要”，不是聊天原文、不是提示词里的常驻文本、不是归档摘要文件）。当前没有 TTL；是否加见决策文档 2.5。

---

## 3. 未完成（下一轮继续）

1. 第 11–13 项：三层知识库统一读矩阵、第四列三个授权勾选、知识库用户切换/HNS 标识/跨用户在线请求。
2. 第 14 项：群聊/项目成员显示名与权限（创建者/管理员/本人/牛马归属）。
3. 第 6 项：10 语言界面文字两轮全量检查（新文案已进包，但还没逐项跑两轮）。
4. P0-6 白名单审计+一键撤销 UI；历史重扫 dry-run；canary 进 live。
5. 中继隧道/DHT/跨天自动重连/A-B 去重/在线文件传输（协议层，未做）。
6. `write_file` 覆盖卡的真机行为测试（静态门禁已过，真实弹卡/推荐项还需真机）。
7. 第 34 项 27B 慢任务真机验证；第 35 项整遍 live 1 遍。
8. 首启验收（最终会关程序、清配置、重开）。

---

## 4. 需要你拍板/协助（固定提醒）

- **需要确认**：第 37 项有道词典 GUI 无法脚本化，是否接受「MT + 每种 20 条 LQA」；第 11–13 项知识库授权默认值是否就按你给的（群聊=会话；项目=会话+内部；联系人=会话；我的牛马=三层）、用户切换是否只允许在线用户。
- **需要动手**：首启验收（最后会开好窗口）；如果你要 FWArmy 的 macOS/Linux 安装包，需要对应平台构建环境（Windows 本机只能实测 Windows）；第 3 项「第一天/第二天/第三天多用户联调」需要**第二台机器/第二个网络**和跨天时段，单机无法伪造这条证据。
- **我可以继续**：翻译收尾 + 抽样 LQA；第 11–14 项；P0-6 剩余边界；协议层组网；live 结果与首启。

---

## 5. 测试口径与已跑读数（完成后补）

- 新构建 fast 档：`verify-r63-main-ui` 3×、`verify-i18n-locales` 3×、`verify-r56-preset-i18n` 3×；网络/ nm/ FWArmy 子代理各自 3 轮。
- 已跑（2026-10-22 18:3x–19:1x，构建 `9f614e481cc320b7`）：
  - `verify-r62-ui` **17/0**（含吸附落盘开/关、真机贴边）
  - `verify-r63-main-ui` **17/0 × 3**
  - `verify-r63-nm` **38/0 × 3**（工具栏/预览/缩放/全屏/未保存/音乐/视频）
  - `verify-r63-net` **78/78 × 3**（主机模式/服务商/IP 检测/上限/凭证 SecureKeyStore/旧配置迁移）
  - `verify-r64-fwarmy` **39/0 × 3**；`verify-r58` 35/0、`verify-r59` 20/0、`verify-r60` 24/0 各 3 轮
  - `verify-round38-asr` **10/0 × 3**（新增「本机未启用 + asrLocalOnly=true」真机场景，MiMo ASR 正常）
  - `verify-round12` **11/11 × 3**（Ollama 25 个模型 + MiMo 真实对话/工具落盘/TTS→ASR）
  - `verify-strict-language` **10/0 × 2**、`verify-i18n-locales` **162/0 × 2**（第 6 项两轮文字检查的可执行部分）
  - 最终 fast 档 **3 遍 × 303 项次全绿**（`真红 0 · 已知红 0 · 缺文件 0`）
- 完整 live 1 遍：本轮已启动（约 1.5 小时），结果待补；期间不 build、不启第二个 Electron。
  - **2026-10-22 20:57/21:23 读数**：`verify-runtime-errors`、`verify-round12`、18/18b/18c/18d/18e/18f、19、20-team、27-live、28-live、34-ui、38-asr/qr/restart、39-longchat、history-persist、39-quota-ui、48-nengli/zhongjian、40-heartbeat、44-ui/shejiao/token-live、35-ui、ui-lag、click-lag 均 PASS；整遍 **3 红**：`verify-round16`（3000s，0 字符落盘）、`verify-round17`（2400s，0/14 文件、工具 0）、`verify-round34-live`（`守灯人.txt ×2`，模型带 overwrite 把 1743 字覆盖成 961 字）。前两支是**本机 27B 吞吐/无工具输出**；第三支是**真产品缺口**（旧闸看到 `overwrite:true` 直接放行），已在最终构建补上：模型自带 overwrite 但内容变短也先拦/弹卡。
  - **最终构建复跑（连续 3 轮）**：round16 **PASS ×3**（5816 字落盘）、round17 **PASS ×3**（6028 字分段追加、计划全 verified、TTS/ASR 往返）、round34 `--trials=1 --ollama-trials=0` **PASS ×3**（`同一个文件没有被整篇重写` 绿，小说 7738 字）。round16/17 使用 `OLLAMA_MODEL=Qwen3.6-35B-A3B-IQ3_M:latest-128K`（用户第 34 项授权），round34 用 MiMo 腿。
  - 说明：整遍 live 的读数跑在补守卫前的构建；最终构建（`bffda81d45403507`）上 fast 3×303 与上述三支 3 轮复跑覆盖了差异。
- **首启**：`r38-firstrun.mjs` EXIT=0；运行中本应用 0 → 搬走 25 项到 `%APPDATA%\@warmy\app-shell\__r40-firstrun-1792678152238` → 重开 pid 36568；新 `settings.json`：`setupDone=false`、`privacyConsent=false`、`instances=0`，`local-speech` 保护区仍在。应用**已开在首启页**等用户验收。
- 任何红：修 → 从头重跑 3 遍；不要用改小任务/放宽判据变绿。
- 最终：关闭程序 → 备份/清配置 → 重开首启。

---

## 6. FWArmy 子代理完成读数（第 39 项）

### 6.1 产物与入口

- 目录：`fwarmy/`（旧名 `relay-server/` 已不存在）；产品名 **FWArmy**。
- Windows 单文件：`fwarmy/dist/FWArmy.exe`，**93,611,008 字节**，sha256 `b16eae84b20cafe1a5adc11b6855d8a81d380e1397b1b5c78ec16159427f3ea9`，构建于 Node v24.20.0 win32-x64；自带 Node，无需安装。
- 便携目录还含 `start.bat` / `stop.bat` / `fwarmy-headless.bat` / `fwarmy-console.bat` / `README.md`；源码目录另有 `.sh` 版本与 `build-sea.sh`。
- 界面 = 自包含浏览器管理页（`admin.html` 内嵌进单文件，无外部 CDN/Electron）；总览、凭据、设置、日志四页。
- 单文件构建需要联网下载固定版本 `esbuild@0.25.10` + `postject@1.0.0-alpha.6`；**运行期零依赖**。

### 6.2 实机验证（Windows）

```bat
dist\FWArmy.exe --version
dist\FWArmy.exe --server --port=8831 --host=127.0.0.1 --data=<临时目录> --no-open
dist\FWArmy.exe table --data=<临时目录>
dist\FWArmy.exe stop --data=<临时目录>
```

- `--version` → `FWArmy 0.2.0`；健康检查 → `fwarmy-relay / FWArmy / 0.2.0`；管理页 27,614 字节。
- 首次凭据：自动生成，token 43 字符；`credentials.json` 不含明文。
- 限速 2 次/分 → 3 次 lookup 状态 `200,200,429`；日/月/年配额分别返回 `daily-quota` / `monthly-quota` / `yearly-quota`；停用 → 401；错名称删除 → 400，正确确认 → 删除并 401。
- 统计：7 请求 / 630 字节（1 条信封入队 + 1 条取走）；重启后完全一致（7/630，今日/本月/今年均 7）。
- `fwarmy-headless.bat`：隐藏窗口启动，8787 健康检查通过，`data/server.log` 5 行；`fwarmy-console.bat` 表格含日/月/年列并对齐。
- 数据目录所有文件与日志均不含测试消息明文；日志不含凭据明文。

### 6.3 门禁

- `verify-r58-zhongji` 35/0、`verify-r59-wangluo` 20/0、`verify-r60-nm-server` 24/0、`verify-r64-fwarmy` 39/0，四支各连续 **3 轮全绿**。
- `verify-docs` 95/0、`verify-security` 28/0、`verify-gate-manifest` 23/23。

### 6.4 风险（未完成）

- **macOS/Linux 产物未实测**：SEA 必须在目标系统构建；已给 `build-sea.sh`（macOS 自动 ad-hoc 签名）与 `.sh` 启停脚本，但没有公证、`.dmg`/`.deb`/AppImage。不要对外声称三平台安装包已可用。
- Windows 单文件未代码签名，SmartScreen 可能提示未知发布者。
- 管理面仍是本机免登录；同机其它本地进程/用户可直接操作管理接口，不要把管理端口映射公网。
- 统计的最近 60 秒速度是内存窗口，重启归零；日/月/年与峰值落盘保留。

### 6.5 关键文件

```
fwarmy/server.mjs / admin.html / ctl.mjs / package.json / README.md
fwarmy/build-sea.mjs / build-sea.sh / sea-main.mjs
fwarmy/start.bat|sh / stop.bat|sh / fwarmy-headless.bat|sh / fwarmy-console.bat|sh
fwarmy/dist/FWArmy.exe（构建产物，dist/ 不入库）
packages/app-shell/scripts/verify-r64-fwarmy.mjs（39 条，新增）
docs/SERVER-RELAY.md（§6/§8 更新）
```
