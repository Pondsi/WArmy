# HANDOFF-R122 — 0.2.31 发布、未完成项与首启交付

日期：2026-10-31
版本：0.2.31（安装目录数据 + 安装位置选择）；0.2.30 的功能基线不变
源码提交（GitHub `Pondsi/WArmy` main）：`12750b45ce413df76b7ae2f97b1f7120d99e5dc3`
发布页：https://github.com/Pondsi/WArmy/releases/tag/v0.2.31
安装包：`WArmy-Setup-0.2.31.exe`，228,745,515 B
SHA-256：`406496826f51bc7e61595a60f5a2cfcd47178f2a05915b1e5456a1b7b600f111`

> 本文件是交接文档，**不发布到 GitHub**。公开仓库按用户口径只含：项目代码 + `说明.md`、`LICENSE`、`SPONSORS.md`。

---

## 0. 本次交付摘要

| 项 | 结果 |
| :--- | :--- |
| 源码发布 | Git Data API 提交 `12750b4`，434 个文件；英文审计 0 处、秘密/本机信息 0 处 |
| Release | `v0.2.31`，资产 `WArmy-Setup-0.2.31.exe` + `checksums.txt` |
| 打包冒烟 | `release/win-unpacked/WARMY.exe` 启动、nm 查看器读文件、Markdown 分栏出现（PKG-SMOKE-OK） |
| 连续 10 轮验收 | **未完成**：修复后从第 1 轮重启，已完成第 1–5 轮；第 6–10 轮未跑（用户在此时要求发布/交接/首启） |
| 首启 | 真实 profile 已备份并删除；`release/win-unpacked/WARMY.exe` 已启动，停在首启语言页，等待用户验收 |

### 0.1 0.2.31：数据目录与安装位置（2026-10-31）

- **数据目录**：Windows 打包态从 `%APPDATA%\@warmy\app-shell` 改为 `<安装目录>\WArmyData`；`app.setPath('userData')` + `sessionData` 在 ready 前设置，Chromium 缓存/本地存储/记忆/身份/设置/审计都在该目录。
- **安装位置可选**：`electron-builder.yml` 改用 `nsis.oneClick: false` + `allowToChangeInstallationDirectory: true`；静默安装 `/S /D=<目录>` 实测落到指定目录。
- **升级迁移**：首次启动若新目录为空且旧 `%APPDATA%` 目录存在，复制旧数据（跳过 Chromium 缓存/锁文件）并写 `.migrated-from-appdata`；旧目录保留作备份。
- **卸载/升级保留**：`build/installer.nsh` 的 `customRemoveFiles` 遍历安装目录顶层，除 `WArmyData` 外全部删除；升级安装同样保留。锁住的数据不会被删除。
- **覆盖优先级**：显式 `--user-data-dir=` 仍然优先（验收脚本/多实例隔离不变）；只读安装目录（如 Program Files）会回退到旧 `%APPDATA%` 并在 boot log 说明。
- **验证**：fast 148/0；live 121/0（首启 24、认证 41、认证安全 9、nm 17、市场 14、能力/模型 16）；打包实测：指定目录安装、`WArmyData` 落位、迁移标记、`--user-data-dir` 覆盖、旧目录不再被写、卸载保留、覆盖安装保留、`pnpm typecheck` 与构建通过。
- **发布**：提交 `12750b4`，Release `v0.2.31`。

**必须如实说明**：0.2.30/0.2.31 的检查覆盖见第 2 节；它不是“连续 10 轮全绿”的产物。第 6–10 轮的命令在第 4 节，随时可继续。

---

## 1. 本轮完成的功能（用户第 19–23 项）

### 19. 整理文字时鼠标不再变等待，改成与聊天框配合的魔法光标
- 原问题：整理期间输入框 `cursor: progress`，鼠标变转圈等待。
- 实现：`zhengLiMoFaGuangBiao(color)` 用主题色生成星芒 SVG data URI，整理期间作为输入框光标；结束/取消 `zhengLiTeXiaoGuan()` 移除内联 cursor 与只读态。
- 门禁：`verify-r122-ui-tweaks` 断言 CSS 无 `cursor: progress`、光标是主题色 data URI、结束后移除。

### 20. 语音输入有选区时替换选区
- 原问题：只按光标插入，框选文字没被替换。
- 实现：`yuYinChaRuJieGuo` 增加 `hasSel`：有选区时 `same=false`，插入锚点取选区 `start/end`，替换选区；同一锚点后续识别只替换“自己插入的片段”，用户原有文字不丢。
- 门禁：`verify-r122-ui-tweaks` 真机模拟选区 + 真实函数调用；`verify-r112-ui` 覆盖同锚点更新、换锚点只插增量、程序化插入在只读态仍成功。

### 21. 语音没有新内容时静默
- 原问题：空识别/静音会弹提示。
- 实现：`yuYinKongJieGuo()` 正则覆盖 `empty-audio|audio-silent|no-speech|asr-empty-result|bendi-yuyin-empty-result`；删除 `chat.voiceTooQuiet` 提示与无语音错误 toast。配置/网络错误仍提示（不吞真错误）。
- 门禁：`verify-r122-ui-tweaks` 负向断言“空/静音静默、配置/网络仍提示”。

### 22. 整理特效重做
- 字保持字体本色；随机约 1/6 的字临时变主题色、发光、闪两次并爆小星芒；随机字轻微挪动/旋转再归位；canvas 三十多颗光点（约四成四角星）缓慢汇聚；整理结果写回后新字逐字归位、先主题色再回本色，整层淡出；`prefers-reduced-motion` 只保留静态淡光；整理中可取消，取消立即解绑监听、恢复输入框。
- 实现：`zhengLiTeXiaoKai` / `zhengLiTeXiaoShouWei` / `zhengLiTeXiaoGuan`，样式在 `app.css` 的 `.zhengLiZi/.isLiang/.isPaiLie/.zhengLiCongLai/.zhengLiShou`。
- 门禁：`verify-r122-ui-tweaks` 20 条；`verify-r112-ui` 整理特效动态亮字切换/发光/归位/取消解除等待。

### 23. nm 查看器浏览器模式
| 子项 | 实现 | 门禁/证据 |
| :--- | :--- | :--- |
| a. 标签页在地址栏上方 | `#wangYeHang2` 移到 `#wangYeHang1` 之前 | `verify-r122-ui-tweaks` 静态断言 + 真机截图 |
| b. “在新标签页打开”是开关 | `#anNiuWangYeXinBiaoQian` `aria-pressed`；开启后 `will-navigate`/`setWindowOpenHandler` 改发 `openInNewTab`，当前页不跳转 | 真机 WebContentsView 冒烟（R122 记录）+ 门禁 |
| c. 标签栏 “+” 新建 | `#anNiuWangYeTabJia`，默认 `https://www.numumu.com/`（`WANG_YE_XIN_MO_REN`） | `verify-r81-nm`、`verify-r122-ui-tweaks` |
| d. 关闭叉美化 | `.tabGuan` 透明无边框，悬停标签右侧才显示，10×10 SVG | CSS 断言 + 截图 |
| e. 分栏分割线可拖动 | 新增 `#wangYeFenGe`，鼠标/双击/键盘调整；拖动时隐藏 WebContentsView 防吃事件 | `verify-r81-nm`、真机拖动 |
| f. 分栏按标签页保存 | `wangYeKa()` 每标签 `fenLan/fenLanBi`；切换标签应用各自分栏 | `verify-r81-nm` 74/0 |
| g. 远程只读页显示源码 | `nmWangYeYuan` 主进程取 `document.documentElement.outerHTML`（2MB 上限），只读展示 | 真机 WebContentsView 源码提取冒烟 |

---

## 2. 验收记录（修复后从第 1 轮重启）

| 轮 | 方法 | 实际结果 |
| :--- | :--- | :--- |
| 1 | 离线全量 `run-verify-22 --tier=fast` | ✅ 148 项次，真红 0 |
| 2 | 类型/构建/安全/发布审计 | ✅ `pnpm typecheck`、app-shell build、`verify-security` 28 PASS、`prepare-publish --stage` 431 文件 |
| 3 | 真机 UI 核心（9 支） | ✅ 30+6+10+19+17+7+23+9+17 = 138，0 失败 |
| 4 | 认证/首启/邀请（8 支） | ✅ 35+24+41+9+19+14+7+8 = 157，0 失败 |
| 5 | 真实 Ollama 端到端（5 支） | ✅ 33（多牛马）+16（能力表）+9（长文）+14（市场 UI）+32（token 校准），0 失败 |
| 6 | 记忆/上下文/长会话 | ⏳ 未跑（命令见 §4.1） |
| 7 | 网络/组网/社交协议 | ⏳ 未跑（命令见 §4.2） |
| 8 | nm/媒体/文档 | ⏳ 部分覆盖：`verify-r97-nm-live` 17/0（修复后）；其余见 §4.3 |
| 9 | 压力档 A+B | ⏳ 未跑（命令见 §4.4） |
| 10 | 打包件 + 4K/高 DPI + 首启 | ⏳ 部分：0.2.31 安装包已构建，打包冒烟通过；4K 四视口未跑（命令见 §4.5） |

> 之前的第 5–7 轮曾在修复前全绿，但发现 nm IPC 缺陷后按用户口径从第 1 轮重启，旧记录不计入连续 10 轮。

---

## 3. 本轮发现并修复的重要缺陷

### 3.1 nm 查看器全部业务 IPC 被拒（严重，已修）
- 现象：nm 查看器打不开任何文件；Markdown 无分栏；`warmy:nmShiTuDu`、`warmy:nmYueDu`、`warmy:peiZhiQu`、`warmy:nmXiaZaiLieBiao` 全部 `ipc: forbidden sender`。
- 根因：R111 收紧的 IPC 发送方白名单只允许 `renderer/index.html`，而 nm 查看器与「编辑聊天内容」窗口加载 `renderer/nm-viewer.html`（共用 `preload.cjs`）。
- 修复：`electron-main.ts` 的 `yunXuLaiYuan` 改为同目录**精确两页**白名单（`index.html`、`nm-viewer.html`）；仍要求 `senderFrame === mainFrame`、仍是 `file:`、仍拒绝其它 renderer 页面与 URL 前缀；`verify-security` 判据同步（28 PASS）。
- 验证：真机 `nmDu` 成功、Markdown 分栏出现；`verify-r97-nm-live` 17/0；打包冒烟 PKG-SMOKE-OK。
- 影响面：nm 查看器的网页源码（用户第 23.g 项）、下载管理、缩略图、设置读取都依赖这条通道，一并恢复。

### 3.2 认证与封存（承接第 4 轮，已修）
1. `JiyiCangKeHu.stop()` 现在等记忆子进程真正退出（最多 3 秒，超时强杀并等 exit），解决 Windows 上 SQLite/WAL 未释放导致的 `vault-seal-failed: EBUSY`。
2. `AuthService.changePin()` 按 `willLock` 返回，不再在“设置 PIN + 关闭自动登录”时误锁会话。
3. 改 PIN 封存后 `dataVault.clearSessionToken()`，避免重启自动 resume 成已登录。
4. `SKIP_NAMES` 扩充 Chromium 运行时文件/目录，封存不再因浏览器缓存被占用而失败。

### 3.3 门禁自身的过期/错误（已修）
- `verify-round27-live`：干净 profile 上首启语言页盖住市场弹窗，遮罩断言量错对象。改为 `WARMY_AUTH_BYPASS=1`（与其余 UI 门禁一致），首启另由 r35–r38/r68 覆盖。
- `verify-r48-nengli-tongbu`：B 段改写时丢了 `appJs` 定义与 `settingsSave` 参数；补齐后 16/0。
- 前序已修：`verify-r68-firstrun-ui`、`verify-r68-auth-ui`、`verify-r69-join-create`、`verify-r70-budget-name` 的过期断言。

---

## 4. 未完成任务（可自行继续，按优先级）

### 4.1 第 6 轮：记忆/上下文/长会话（约 20–30 分钟）
```bash
node packages/app-shell/scripts/verify-history-persist.mjs
node dev/gates/verify-round39-longchat.mjs --quick
node dev/gates/verify-r48-zhongjian-ui.mjs
node dev/gates/verify-r48-heiban.mjs
node dev/gates/verify-r48-qiyue.mjs
node dev/gates/verify-context-carry.mjs
```
预期：历史持久化 ALL PASS；longchat 9/0；中间回复 10/0；黑板 68/0；契约 29/0；上下文携带 15/0。

### 4.2 第 7 轮：网络/组网/社交（约 10–20 分钟）
```bash
node dev/gates/verify-r122-discovery.mjs
node dev/gates/verify-r122-w07-toudi.mjs
node dev/gates/verify-r122-w08-receive.mjs
node dev/gates/verify-r122-w09-manifest.mjs
node dev/gates/verify-r44-shejiao.mjs
node dev/gates/verify-r83-im.mjs
node dev/gates/verify-r83-invite-sign.mjs
node dev/gates/verify-r83-join-signed.mjs
node dev/gates/verify-r82-chuan-shu.mjs
node dev/gates/verify-r82-hu-chi.mjs
```
预期：31/28/23/10/27/16/9/12/16/34，全部 0 失败。

### 4.3 第 8 轮：nm/媒体/文档（约 20–30 分钟）
```bash
node dev/gates/verify-r97-nm-live.mjs        # 已 17/0
node dev/gates/verify-r67-nm-edges.mjs
node dev/gates/verify-r78-nm-plugin.mjs
node dev/gates/verify-r81-nm.mjs
node dev/gates/verify-r82-chatwin.mjs
node dev/gates/verify-r81-ui.mjs
```
注意：r81/r78 可能依赖旧 UI 断言；若红先判断是门禁过期还是产品回归，不得放宽判据。

### 4.4 第 9 轮：压力档 A+B（约 1–2 小时）
```bash
node dev/gates/verify-r46-youxi.mjs           # 真模型 6 轮网页小游戏；默认每轮 30 分钟上限
node dev/gates/verify-memory-stress.mjs --runs 2 --rounds 300 --no-probe   # 缩放档；6000 轮全量需数小时
```
建议先跑缩放档，确认无回归再决定是否跑 6000 轮全量。

### 4.5 第 10 轮：打包件 + 4K + 首启
```bash
node dev/gates/verify-r103-4k.mjs             # 四视口布局（1920/2560/3840 等）
# 安装包冒烟（已做一次）
node "<临时目录>/warmy-pkg-smoke.mjs"   # 临时脚本可能已被清理；可用 dev/gates 里的真机门禁替代
```
4K：本机无 3840×2160 物理屏，CDP 视口仿真不能等同物理屏；见 §5.D。

### 4.6 发布一致性
- `feed/latest.json` 已本地更新到 0.2.31，但 `feed/` 按规则不发布；应用默认读 GitHub `releases/latest`，新 Release 已生效。
- 0.2.30 → 0.2.31 的真实自动更新链路未测（需要旧版本安装环境）。验证步骤见 §5.G。

---

## 5. 需要你协助的任务（详细）

### A. MiMo 云端密钥缺失（影响所有云端腿）
- **为什么需要你**：本机没有 `tp-*.txt` / `MIMO_KEY_FILE`，云端 ASR/TTS、云端模型、`verify-round39-longchat` 的 S3、`r105-live-5-rounds`、`verify-round20-team` 云端腿都只能标 BLOCKED，不能用本地 Ollama 冒充。
- **怎么做**：把密钥放进任意本地文件（例：`C:\Users\<你>\mimo-key.txt`），运行前设 `MIMO_KEY_FILE` 指向它。示例：
  ```powershell
  $env:MIMO_KEY_FILE="C:\Users\你\mimo-key.txt"; node dev/gates/verify-r44-token-live.mjs
  ```
- **方案与权衡**：
  1) 提供测试密钥（推荐）：最真实；缺点是会消耗额度。
  2) 只跑本地腿并保留 BLOCKED：不影响本机功能，但云端兼容性无证据。
  3) 用第三方 OpenAI 兼容代理：可测协议形状，但不能证明 MiMo 语义/计费口径。
- **建议**：给一个**低额度专用**密钥，仅用于门禁；测完可在服务商后台吊销。
- **最坏情况**：不提供 ⇒ 发布说明与交接继续标注云端未验证，用户遇到云端差异时需自行排查。

### B. 真实 IM 账号（微信个人 / 企微 / 钉钉）
- **为什么需要你**：扫码登录、企业后台建应用、可信域名、回调地址都只能由账号持有人完成；本机无可用账号。
- **怎么做**：
  - 微信个人（iLink ClawBot）：打开“设置 → 功能 → 社交接入 → 微信”，用手机扫码；保持窗口直到“已连接”。
  - 企微/钉钉：在企业后台建自建应用，拿 CorpID/AgentID/Secret（或 AppKey/AppSecret），在应用内填入；把回调指向本机可达地址（局域网/公网隧道）。
- **方案与权衡**：
  1) 你提供测试企业（推荐）：可做真实收发；缺点是要管理员权限与回调网络。
  2) 只保留夹具门禁：协议形状已验证；缺点是无法证明真实后台兼容。
  3) 用个人微信小号：最快；缺点是有封号风险，不建议主力号。
- **建议**：先用企微测试企业（权限清晰、可回滚），个人微信只做扫码冒烟。
- **最坏情况**：平台改协议/风控 ⇒ 适配器需要跟进；当前已把协议与错误分类做成独立层，改动面可控。

### C. 物理 4K / 高 DPI 屏幕
- **为什么需要你**：本机只有普通分辨率；CDP 可以改视口，但改不了真实像素密度、系统缩放与多屏 DPI 混合。
- **怎么做**：接一台 3840×2160 显示器（或支持 4K 的远程桌面），把系统缩放设为 150%/200%，运行 `verify-r103-4k.mjs` 并截图。
- **方案与权衡**：
  1) 物理 4K（推荐）：唯一能证明真实渲染；成本是硬件。
  2) 远程 4K 虚拟机：可复现；缺点是无法覆盖本机显卡缩放差异。
  3) 仅 CDP 仿真：成本最低；不能宣称“物理 4K 已验证”。
- **建议**：若短期没有 4K 屏，保持“仿真通过、物理待验”的如实口径。

### D. macOS 真机 / 构建
- **为什么需要你**：无 Mac 主机，Electron 的 macOS 打包、公证、菜单栏、窗口行为无法验证。
- **怎么做**：一台 Apple Silicon 或 Intel Mac（macOS 13+），安装 Node 24 + pnpm，执行 `pnpm install && pnpm build && pnpm --filter @warmy/app-shell dist`。
- **方案与权衡**：
  1) 借/租 Mac（推荐）：可真机验证；成本高。
  2) GitHub Actions macOS runner：可出包；缺点是无 Apple 开发者证书时只能出未签名包，且无法人工验收 UI。
  3) 暂不支持 macOS：最省事；需在说明里明确只支持 Windows。
- **建议**：先做 Actions 出包（未签名）+ 你手上有 Mac 时做一次人工冒烟。

### E. 代码签名 / 公证
- **为什么需要你**：无证书、无 signtool 凭据、无 Apple 开发者账号；当前安装包未签名，SmartScreen 会提示“未知发布者”。
- **怎么做（Windows）**：
  - OV/EV 代码签名证书（DigiCert/Sectigo 等），或 Azure Trusted Signing（订阅制，身份校验后可用）。
  - 在 `electron-builder.yml` 配置 `win.certificateFile/certificatePassword` 或 `azureSignOptions`。
- **方案与权衡**：
  1) EV 证书：SmartScreen 信誉最快建立；成本最高（年费+硬件令牌）。
  2) OV 证书：便宜些；仍需积累信誉。
  3) Azure Trusted Signing：无需硬件令牌、CI 友好；有月费与地区/身份限制。
  4) 自签名：免费；用户仍会看到警告，不适合公开发布。
- **建议**：面向公众分发选 OV 或 Trusted Signing；内部使用可先不签，但在说明里写清 SmartScreen 提示。
- **最坏情况**：不签名 ⇒ 下载转化率与信任度受影响；安装包本身功能不受影响。

### F. 公网直连 VPS / 端口映射
- **为什么需要你**：云侧只映射了 3389，59599/7800 未放行；无法完成真实的公网 NAT 直连验收。
- **怎么做**：在服务商控制台的安全组/防火墙放行 TCP+UDP 59599（组网）与 7800（如启用），或给一台可自由配端口的 VPS。
- **方案与权衡**：
  1) 放行端口（推荐）：最直接；缺点是暴露面变大，需要 ACL/密钥。
  2) 换一台云主机：可控；成本增加。
  3) 走志愿者中继 B：不暴露端口；但需要目录运营与信任模型（见 G）。
- **建议**：先放行 UDP 59599 做一次双机实测，测完可关闭。

### G. 志愿者中继 B / DHT 公开发现的运营口径
- **为什么需要你**：目录由谁运营、是否计费、是否做流量混淆、滥用如何处理，都是产品/合规决策，代码不能替用户拍板。
- **现状**：DHT 公开发现默认关，开启需引导节点；关闭后不谎称撤销（TTL 内仍可查到，界面如实说明）。
- **方案与权衡**：
  1) 只做局域网 + 手动交换地址（最稳、无运营成本；跨网需用户自己解决）。
  2) 自建引导节点（可控；需要服务器与备案/合规评估）。
  3) 志愿者中继（抗 NAT 强；需要信誉/计费/滥用治理）。
- **建议**：先按 1 发布；2 作为下一步小规模内测；3 等有明确运营主体再做。

### H. W09 签名更新清单的密钥托管
- **为什么需要你**：Ed25519 公钥怎么发、私钥放哪、怎么轮换，涉及发布安全与责任归属。
- **现状**：已支持签名清单校验；未配置公钥时保持旧行为（不假称已签名）。
- **方案与权衡**：
  1) 私钥离线保管、公钥硬编码进客户端（最安全；轮换需发版）。
  2) 私钥放 CI Secret，公钥随清单下发（轮换灵活；CI 被攻破则失效）。
  3) 多签/阈值签名（最强；实现与运维复杂）。
- **建议**：先用 1，轮换流程写进发布手册；等更新频率上来再考虑 2。

---

## 6. 已知边界与风险

- **未签名**：SmartScreen 警告；首次运行可能被安全软件拦截。安装包哈希已公开，可自行校验。
- **只验证了 Windows 11 x64**：Linux 未在 0.2.31 验证；macOS 未构建。
- **云端能力未验证**：MiMo 云端模型/ASR/TTS 缺密钥；ComfyUI 图像/视频需要外部服务地址。
- **真实 IM 未验证**：适配器与夹具通过，真实后台需账号。
- **DHT 公开发现默认关**：开启需引导节点；关闭不等于立即从网络删除（TTL 内仍可查）。
- **自动更新**：默认读 GitHub `releases/latest`；0.2.30 → 0.2.31 的真实升级未测。
- **物理 4K/高 DPI**：仅 CDP 视口仿真。
- **发布范围**：公开仓库不含 README、CHANGELOG、docs、dev、tests、scripts、feed、release；这是按你的口径执行的。构建必需的 `package.json`/`pnpm-lock.yaml`/`tsconfig*`/`electron-builder.yml` 保留。
- **凭证**：发布使用了本机 Windows 凭据管理器里的 GitHub 凭据（`git:https://github.com`，Basic `x-access-token`）；未写入仓库、未打印；临时提取文件已在使用后删除。

---

## 7. 首启交付

- 备份目录：`%APPDATA%\@warmy\app-shell.backup-<时间戳>-r122`（备份后删除原 profile）
- 启动：`release/win-unpacked/WARMY.exe`（或安装 `WArmy-Setup-0.2.31.exe`）
- 预期首屏：语言选择页（1280×800 左右），选语言 → 同意条款 → 注册/登录 → 配置供应商与模型 → 创建牛马 → 第一句对话。
- 本次没有预置任何密钥/供应商/牛马；所有本机配置为空，符合“删配置首启”。

验收建议顺序：
1. 选语言、过条款，确认首启不卡、关闭按钮与二次确认正常。
2. 注册账号：记下助记词与 PIN；退出登录再登录一次，确认数据仓解锁正常。
3. 设置 → 模型：添加本机 Ollama（`http://127.0.0.1:11434`）或云端供应商，拉取模型列表，选一个模型。
4. 创建牛马 → 发一句“你好”，确认流式回复、停止、重试都正常。
5. 打开 nm 查看器（文件/网页模式），确认标签页、+、开关、分栏拖动、远程源码。
6. 语音：麦克风权限、按光标插入、选区替换、空结果静默。
7. 导入/导出：我的 → 导出（可加密）→ 换一个 profile 导入，确认凭证匹配与解密。

---

## 8. 发布规则执行记录

- 允许清单：`scripts/prepare-publish.mjs`，共 **434** 文件（含 app-shell 构建必需的 `check-syntax.mjs` / `copy-assets.mjs`、`build/installer.nsh`，以及用户批准的 `README.md` 与首启截图 `docs/screenshots/readme-first-run.png`）。
- 英文审计（非代码、非例外）：**32** 个文件，含非英文 **0**。
- 秘密/本机信息扫描：**429** 个文件，命中 **0**。
- 排除：`docs/`、`dev/`、`scripts/`、`release/`、`feed/`、`checksums.txt`、`README.md`、日志、profile、凭据、测试夹具。
- 保留的三个非必要文件：`说明.md`、`LICENSE`、`SPONSORS.md`（中文允许）。
- 发布方式：Git Data API（本机 `git push` 到 github.com 会挂）。发布提交 `12750b4`（tag `v0.2.31` 指向它）；Release `v0.2.31`。
- 用户批准的一次发布例外：公开 `README.md` 与首启截图 `docs/screenshots/readme-first-run.png`，其余 `docs/`、`dev/`、测试与交接文档仍不发布。README 的非英文仅限品牌名 `无限牛马`、中文说明书文件名和 10 种语言的自称；`prepare-publish` 对这几种字符串做精确豁免，其余非英文仍判红。
- 源码构建验证：把暂存树复制到临时目录，`pnpm install --ignore-scripts && pnpm build` 通过（11 个包 Done、app-shell dist 产出）。第一次“失败”是先前中断留下的增量缓存假象，清掉 `dist/tsconfig.tsbuildinfo` 后单次干净构建成功。

---

## 9. 决策与记录索引

- `docs/DECISIONS-R122.md`：第 122 轮的决定（含 §14 第 19–22 项、§15 第 23 项、发布范围 §12）。
- `docs/ACCEPTANCE-R122-10X.md`：10 轮验收方法、已发现问题与修复、重启后的进度。
- `docs/HANDOFF-R122.md`：本文件。
- `docs/CHANGELOG.md`、`docs/TECHNICAL.md`、`docs/REQUIREMENTS.md`：功能与技术口径（不发布）。
- 门禁清单：`dev/gates/run-verify-22.mjs`（fast 档 148 项）。

---

## 10. 交接时的现场状态

- 源码工作区：`<项目目录>`（main，含未提交的本地改动与文档；GitHub 上为发布快照）。
- 0.2.31 安装包：`release/WArmy-Setup-0.2.31.exe`；解包目录：`release/win-unpacked/WARMY.exe`。
- 临时产物：验收日志与临时 profile 在 `%TEMP%` 下，可按需清理；`_publish/WArmy` 为暂存副本（434 文件，含 README、首启截图与 installer.nsh）。
- 未运行中的后台任务：无（第 5 轮已结束，安装包上传见 Release 资产）。
- 首启窗口：已启动，等待用户验收。
