# WArmy 交接文档 R124（给下一个会话）

> 交接时间：2026-10-31
> 版本：`0.2.33`（已发布）
> 仓库：<https://github.com/Pondsi/WArmy>
> Release：<https://github.com/Pondsi/WArmy/releases/tag/v0.2.33>
> 本文写给**没有看过上一段对话的 AI**。先读第 0 节，再按需读后面的章节。

> **R125 更新（2026-11-01）**：
> - 操作记录见第 13 节。核心：工作区清理（只删被 .gitignore 忽略的日志/临时目录，git 状态零变化）；勾选框/滑块/单选钮全局改用主题色（app.css / renderer.css / nm-viewer.css 各加 1 条 `accent-color: var(--accent)` 全局规则，Electron 真实渲染验证通过）；多终端同步设计稿补充 8 项评审缺口（§9.1–§9.8，其中 DEK 来源等 4 项标注 P0 前必须拍板）。
> - **用户拍板（同步方案）**：不使用中继来传递邮箱内容（设计稿 §4.5 / §7 P3 / §9 第 3 条已更新）。
> - **未发布**：CSS 改动与文档更新都未发布；版本仍 0.2.33，远程 main 仍 `920d544`。

---

## 0. 一分钟状态

- **产品**：WArmy（无限牛马），本地优先的多智能体桌面指挥中心；当前 0.2.33。
- **本轮做了什么**：重写 README.md 和 说明.md，加入“个人助手 / 私密专家团队 / 多人项目室”三种用法，明确本地优先、私密优先、安全优先；新增多终端同步设计稿；写这份交接文档，并把“如何给下一个 AI 写交接”写进本文第 9 节；修复赞助页 404，发布两张收款码并加入 PayPal 链接。
- **没有做什么**：没有改业务代码，没有改版本号，没有重新打包。README/说明和赞助页都已发布；最新 commit：`920d544eb6c0de31e52cc6896905cfd6f0a36b0e`（README/说明）；上一 commit `d2598da2bc3b58ce109cdf985401db79f08f989e`（SPONSORS + 两张收款码 + PayPal）。
- **当前最该做的**：先读第 3 节确认本地/远程状态；如果用户要发布文档，按第 5 节走；如果用户要继续做多终端同步，按第 6 节从 P0 开始。
- **不要做**：不要 `git push`（本机会挂起）；不要在没有用户确认时发布；不要在群聊/项目/联系人会话里开放全盘搜索；不要把助记词或密钥写进任何文件。

---

## 1. 项目身份与路径

| 项 | 值 |
|---|---|
| 产品名 | WArmy / 无限牛马 / Workhorse Army |
| 标语 | 属于你的军团 / An army that's yours. |
| 技术栈 | Electron 45.1.0 + TypeScript + pnpm workspace + 原生 JS 渲染层 |
| 仓库根目录 | `<仓库根目录>`（本机路径含中文；需要 ASCII 别名时用 `C:\wbuild`，若仍存在） |
| 主进程 | `packages/app-shell/src/electron-main.ts` |
| 渲染层 | `packages/app-shell/src/renderer/app.js` |
| 身份/组网协议 | `packages/sync-protocol/src/` |
| 记忆 | `packages/memory-os/src/` + `packages/app-shell/src/electron-main.ts` 的记忆子进程接线 |
| 搜索 | `packages/app-shell/src/research-tools.ts`、`search-providers.ts`、`local-search.ts`、`disk-index.ts` |
| i18n | `packages/app-shell/src/i18n/*.json`（10 语言，键集必须一致） |
| 文档 | `README.md`、`说明.md`、`docs/` |
| 发布规范 | 同级目录 `发布规范/`（凭据文件永不发布；只在脚本内读 token，绝不打印） |

### 1.1 版本与发布事实

- `package.json` 和 `packages/app-shell/package.json`：`0.2.33`。
- `feed/latest.json`：`0.2.33`，指向 `WArmy-Setup-0.2.33.exe`。
- `checksums.txt`：含 0.2.32、0.2.33 两行。
- 0.2.33 安装包：`release/WArmy-Setup-0.2.33.exe`，228,775,742 字节，SHA-256 `03f0b484fc00db4d678b6b7f9d9f16fda4c4449225af21234df38c5c47e91073`。
- 远程 `main` 最新 commit（README/说明发布后）：`920d544eb6c0de31e52cc6896905cfd6f0a36b0e`；上一 commit `d2598da2bc3b58ce109cdf985401db79f08f989e` 是赞助页/二维码修复。
- 远程 Release `v0.2.33` 已存在，资产 `checksums.txt` + `WArmy-Setup-0.2.33.exe`，GitHub digest 与本地一致。

> 注意：README/说明已发布，Release 不需要重做；安装包、版本号和 feed 都没变。

### 1.2 本机安装与数据

- 安装位置：`<安装目录>`（上一轮安装）。
- 数据目录：`<安装目录>\WArmyData`。
- 上一轮结束时已删除旧 `%APPDATA%\@warmy\app-shell` 并做了 0.2.33 首启；用户可能已经在该 profile 里操作过。
- **不要随手删除 `WArmyData`**：它可能已经是用户正在验收的数据。新增测试请用 `--user-data-dir=<临时目录>` 隔离。
- 用户偏好：不要读取 `settings.json` 等配置文件内容；需要状态时走 UI/API。

---

## 2. 本轮改了什么（精确清单）

### 2.1 README.md

- 重写为更吸引人的英文主入口：
  - 标题/标语/一句话定位：`Your private AI team — on your machine, under your rules.`
  - 新增 **Three ways to use WArmy**：私密个人助手 / 私密专家团队 / 多人项目室。
  - 新增 **Why WArmy**：本地优先、私密优先、安全优先、记忆、模型中立。
  - 新增 **One workspace, more than one device**：明确“当前单机；账号级同步未发布；路线分阶段”，没有把未完成能力写成已支持。
  - 保留并强化 `What you get`、`What you can do`、`The system`、`Install`、`How it works`、`Small details and technical notes`、`Memory you can inspect`、`59599` 等门禁关键字。
  - 增加“三种用法”表、具体场景、本地/私密/安全的诚实边界。
  - 保留 0.2.33 下载链接、10 语言、dsh 致谢、构建说明、FAQ。
- 事实口径：**多终端同步没有写成已完成**；写的是“designed for / next milestone / not shipped yet”。

### 2.2 说明.md

- 第 1 节重写并扩展：
  - 1.1 三种用法（个人助手 / 私密专家团队 / 多人项目室），带具体例子。
  - 1.2 本地优先。
  - 1.3 私密优先。
  - 1.4 安全优先。
  - 1.5 产品形态（优点）。
  - 1.6 **多终端同步：现状与目标**（明确当前未发布；设计方向；可行性条件）。
  - 1.7 工程。
- 保留第 2 节记忆系统、第 3 节同类产品、第 4 节安装、第 5 节使用、第 6 节技术要点、第 7 节文件范围、第 8 节限制、第 9 节致谢、第 10 节贡献、第 11 节法律。
- 保留文件末尾唯一署名行（`Pondsi (+…) — automatically committed by Xiaomi MiMo Desktop`）；`verify-docs` 会查这个。

### 2.3 新增文档

- `docs/SYNC-MULTIDEVICE-R124.md`：多终端同步设计稿（架构、威胁模型、备选方案、分阶段、测试矩阵、参考）。
- `docs/HANDOFF-R124.md`：本文件。
- `docs/HANDOFF.md`：顶部已加指向最新交接的提示（若未加，补上）。

### 2.4 赞助页修复（已发布）

- 现象：`SPONSORS.md` 引用 `sponsors/wxd.png` / `sponsors/zfbd.png`，但发布物里没有这两个文件，页面 404。
- 原因：`scripts/prepare-publish.mjs` 的发布清单只收 `packages/` 和固定根文件，`sponsors/` 目录与 `.png` 被过滤。
- 修复：
  - `scripts/prepare-publish.mjs` 的 `EXTRA_FILES` 加入 `sponsors/wxd.png`、`sponsors/zfbd.png`；
  - `SPONSORS.md` 加入 PayPal：<https://www.paypal.com/paypalme/pondsi>；
  - 通过 Git Data API 发布 `SPONSORS.md` + 两张 PNG（commit `d2598da2bc3b58ce109cdf985401db79f08f989e`）。
- 验证：raw 图片 200；`SPONSORS.md` 页面 200；页面 HTML 含两张图与 PayPal 链接；`prepare-publish` 从 437 文件变为 439 文件，审计 0 问题。

### 2.5 没有改的

- 没有改业务代码。
- 没有改版本号/feed/checksums/安装包。
- 没有重新打 Release；只更新了仓库文档与赞助资源。
- README/说明已经发布（commit `920d544eb6c0de31e52cc6896905cfd6f0a36b0e`）。

---

## 3. 当前事实 vs 假设（接手先核对）

### 3.1 已核实事实

- `verify-docs.mjs`：**93 ok / 0 FAIL**（README/说明重写后跑过）。
- `verify-strict-language.mjs`：**10 ok / 0 FAIL**。
- README/说明远程 raw 已核对：含新定位、三种用法、多终端同步状态；`说明.md` 含新 1.1/1.6；main 指向 `920d544eb6c0de31e52cc6896905cfd6f0a36b0e`。
- 0.2.33 在本轮之前已经过：
  - 19 项静态门禁 × 3 轮，全部 exit 0；
  - 首启 UI 门禁 19/19 × 3；
  - 打包件冒烟 10/10；
  - 干净首启 7/7；
  - 远程 Release/资产 digest 校验通过。
- 0.2.33 的安装包/feed/checksums 与 Release 一致。
- README/说明本轮没有改代码，所以不需要重新构建/打包；它们已经发布，远程 README/说明已更新。

### 3.2 假设（不要当事实）

- 安装版可能仍在运行，也可能已被用户关闭。
- `WArmyData` 可能已有用户验收产生的数据。
- 本地 git 工作区是脏的（多轮改动未提交）；不要假定 `git status` 干净。
- 远程 `main` 仍是文档重写前的 commit；除非你按第 5 节发布。

### 3.3 需要现场核对的命令

```bash
cd <仓库根目录>
node -e "console.log(require('./package.json').version)"
node packages/app-shell/scripts/verify-docs.mjs
node packages/app-shell/scripts/verify-strict-language.mjs
git status --porcelain | head -40
```

远程核对（不打印 token，脚本内读 `发布规范/凭据与隐私信息.md` 或 `.git-credentials`）：

```bash
curl -s https://api.github.com/repos/Pondsi/WArmy/git/ref/heads/main
curl -s https://api.github.com/repos/Pondsi/WArmy/releases/tags/v0.2.33
```

---

## 4. 多终端同步：给下一个会话的结论

完整设计稿全文见本文第 11 节；源文件是 `docs/SYNC-MULTIDEVICE-R124.md`。这里给接手要点：

### 4.1 推荐路线

**P2P + DHT + 中继 + 可选加密邮箱；先记录，后文件；先设备，后数据。**

- 设备身份：每台设备独立密钥 + 已授权设备签发的设备证书；二维码 + SAS 配对；签名设备列表 + 吊销列表；助记词不复制。
- 记录同步：每域 op log（`opId`、`seq`、`prevHash`、`lamport`、签名、加密 payload）；交换 heads，拉缺失 op，持久化后 ACK；断线续传/幂等。
- 文件：FastCDC 分块 + 每文件密钥 + AES-256-GCM + 密文哈希 + Merkle manifest + 断点续传 + 版本并列。
- 传输：复用 `SecureMesh`/`handshake`/`secure-channel`/`relay`/`dht`；中继只转字节；离线邮箱只存密文信封。
- 冲突：聊天只追加；看板/知识库用 OR-Map/LWW/RGA 或版本并列；文件不覆盖；冲突卡 UI。
- 范围：默认同步“我的牛马”的会话/记忆/看板；项目按项目开关；密钥/凭证默认不同步。

### 4.2 “同账号多终端同时在线就互连同步”的答案

**可行，但有条件：**

- 双方至少一方可拨入 → 直连；
- 双方都在 CGNAT 后 → 必须中继；
- 一方离线 → 等上线或加密邮箱；
- 没有中继且都不可拨入 → 不能同步，必须如实报错；
- 被撤销设备 → 拒绝。

不要写“永远实时”。正确文案：**“设备在线且网络可达时自动同步；不可达走中继；离线等上线或走邮箱。”**

### 4.3 为什么不做成“同步文件夹”

聊天不能 LWW 覆盖；记忆索引要本地重建；成员移除要轮换密钥；文件要版本化。网盘只同步字节，不同步“记录、关系、权限、版本”。

### 4.4 待拍板

1. CRDT 选型：自研 op-log + LWW 起步，还是直接 Automerge/Yjs？
2. 根私钥只在一台主设备，还是多设备门限签名？
3. 加密邮箱默认关还是开？自托管中继的默认地址？
4. 同步范围默认值（全部 / 仅我的牛马 / 按项目）？
5. 文件同步是否放到 P2？

建议：P0 设备配对 + P1 记录同步先做；文件 P2；邮箱 P3；CRDT P4。

---

## 5. 发布流程（文档与赞助页已发布；后续照此走）

### 5.1 先确认用户是否要发布新改动

README/说明已发布（commit `920d544eb6c0de31e52cc6896905cfd6f0a36b0e`），赞助页/二维码已发布（commit `d2598da2bc3b58ce109cdf985401db79f08f989e`）。如果用户后续要发布新文档或新代码，先确认范围；不要因为“上次发过”就自动发布新版本。

### 5.2 发布约束（必须遵守）

- 只发布项目代码 + `README.md`、`说明.md`、`LICENSE`、`SPONSORS.md`、首启截图；配置/测试/交接文档/`dev/`/`release/`/`docs/`（除截图）都不发布。
- 除代码注释、`说明.md`、`LICENSE`、`SPONSORS.md` 外，其余发布文件必须全英文（i18n 语言包例外）。
- 发布前跑 `node scripts/prepare-publish.mjs`（审计英文/秘密/本机信息），再加 `--stage` 复制到 `_publish/WArmy`。
- **`git push` 在本机会挂起**，不要用；用 GitHub Git Data API（blobs → tree → commit → PATCH ref）。
- Token 在 `发布规范/凭据与隐私信息.md`；只在脚本内读，绝不打印/提交。
- 不要发布 `%APPDATA%`、`WArmyData`、`settings.json`、`docs/HANDOFF-*`、`docs/SYNC-*`、测试脚本。

### 5.3 文档-only 发布的建议步骤

1. `node scripts/prepare-publish.mjs` 确认 0 问题。
2. 若通过，`node scripts/prepare-publish.mjs --stage`。
3. 用 Git Data API 推送 `_publish/WArmy` 的 437 个文件（README/说明更新；业务源码不变）。
4. 不需要重新打 Release/安装包（除非同时改了版本/代码）。
5. 推送后用 `raw.githubusercontent.com/Pondsi/WArmy/main/README.md` 验证新内容。
6. 清理 `_publish` 临时目录。

> 如果你改了版本/安装包，才需要更新 `feed/latest.json`、`checksums.txt`、Build、Release、上传资产。不要把“文档-only”误做成新版本。

---

## 6. 接手后的建议顺序

### 6.1 前 30 分钟

1. 读本文第 0–5 节。
2. 跑第 3.3 节的本地核对命令；确认版本/文档门禁/git 状态。
3. 问用户：这轮是“只发布文档”还是“继续做多终端同步”？
4. 若发布：按第 5 节；若做同步：按第 6.2 节。
5. 不要删除用户 `WArmyData`；测试用临时 `--user-data-dir`。

### 6.2 如果继续做多终端同步

1. 读 `docs/SYNC-MULTIDEVICE-R124.md` 全文。
2. 从 P0 开始：设备密钥/证书/设备列表/配对/撤销；先写纯 Node 测试，不碰 UI。
3. 复用 `packages/sync-protocol/src/handshake.ts`、`secure-channel.ts`、`identity.ts`、`membership.ts`、`relay.ts`；不要另起一套 crypto。
4. P0 通过后再做 P1 记录同步；不要先做文件。
5. 每阶段加门禁：3 设备、断网、重连、并发、重放、回滚、撤销、恶意中继。
6. 更新 `docs/SYNC-MULTIDEVICE-R124.md` 的“状态/决定”与本文第 6 节。

---

## 7. 仍未完成/需要用户协助

### 7.1 需要用户（外部阻塞）

| 项 | 需要什么 | 方案/建议 |
|---|---|---|
| 真实 IM 联调 | 微信/飞书/钉钉测试账号或租户 | 用小号/测试租户；先文本；不要用主账号 |
| 物理 4K / 高 DPI | 4K 显示器或远程 4K 环境 | 真机跑首启/设置/聊天；CDP 模拟只能兜底 |
| macOS 构建/公证 | Mac + Apple Developer 账号 | 先未签名 beta，再决定是否买 $99/年 |
| Windows 代码签名 | 证书或云签名 | OV/EV 或 Azure Trusted Signing；否则 SmartScreen 会提示 |
| 公网 VPS / 第二台设备 | 服务器与网络环境 | 用于 NAT/中继真实验证；密钥运行时注入 |
| W09 更新密钥托管 | 私钥存放/轮换策略 | 先离线私钥 + 手动签名；写清丢失/轮换流程 |
| 付费搜索 Key | Tavily/DeepSeek Key | 临时 Key 做 429/额度测试，测完撤销 |

### 7.2 可自行继续

- R122 第 8/9/10 轮完整验收（nm/媒体/文档、压力档 A/B、打包+4K+首启十轮）。
- 跨会话权限的真实模型工具调用 E2E（mock provider + 真实 Electron）。
- 后台索引真正的 OS 空闲检测。
- Firecrawl Keyless 精确额度探测。
- UI 文案索引覆盖动态 DOM（可选）。
- 多终端同步 P0–P4（按第 6 节）。

### 7.3 已知限制（不要写成已完成）

- 账号级多终端同步未发布；当前只有单机 + 可选项目组网。
- 后台索引是 40ms/400ms 低占用循环，不是 OS 空闲检测。
- 跨会话权限有源码门禁，未做真实模型 E2E。
- 工作区文件解锁时多数明文；云模型会收到发送内容。
- 安装包未签名；只在 Windows 11 x64 验证；macOS/Linux 未验证。
- 物理 4K、真实 IM、云搜索 Key、macOS 未验证。

---

## 8. 关键命令与环境陷阱

### 8.1 构建/验证

```bash
cd <仓库根目录>
pnpm build
node packages/app-shell/scripts/verify-docs.mjs
node packages/app-shell/scripts/verify-strict-language.mjs
node packages/app-shell/scripts/verify-firstrun-ui.mjs
node packages/app-shell/scripts/verify-local-search.mjs
node packages/app-shell/scripts/verify-search-providers.mjs
```

安装包：

```bash
cd packages/app-shell
npm run dist
# 产物：release/WArmy-Setup-<version>.exe
```

### 8.2 本机陷阱

- 中文路径：PowerShell 内联 `$`/引号会被 Git Bash 吃掉；写 `.ps1` 文件再执行。
- 安装器从中文路径启动会失败；先复制到 ASCII 临时路径。
- `git push` 挂起；用 GitHub API。
- `git credential fill` 有时会卡；优先读 `.git-credentials`（脚本内，不打印）。
- 不要读 `settings.json`；不要打印 token/key。
- 测试用的临时 profile 用完删除；不要覆盖用户 `WArmyData`。
- 公开文档不要出现本机绝对路径、用户名、私网 IP、token。

---

## 9. 如何给下一个 AI 写交接（方法论，写进本文）

> 这一节本身是“可复用能力”。下次交接可以照这个结构写。

### 9.1 核心原则

1. **假设读者零上下文**：不写“如上所述”，写完整名词、路径、版本、命令。
2. **当前状态优先**：先写“现在是什么”，再写“怎么走到这里”；历史只保留影响决策的部分。
3. **区分事实/假设/未知**：已验证的写“已核实”，没验证的写“假设”，不要混。
4. **决策带理由**：每个重要决定写“选了什么、为什么、否决了什么、代价是什么”。
5. **下一步可执行**：按顺序写动作、验收标准、停止条件；不要写“继续优化”这种空话。
6. **命令可复制**：写完整命令、工作目录、预期结果。
7. **列出禁区**：不能碰的配置/目录、不能发布的内容、不能绕过的安全边界。
8. **渐进披露**：开头 5 条摘要；细节分节；长文/日志用链接，不要整段粘贴。
9. **控制长度**：交接文档给“上下文预算”让路；只留下一个 AI 真正需要的，不把整个聊天记录倒进去。
10. **持续更新**：每完成一个里程碑就更新，不要等到最后；写时间戳。

### 9.2 推荐模板

```markdown
# Handoff — <项目> <版本> <日期>

## 0. 一分钟状态
- 当前版本/发布状态：
- 本轮完成：
- 未完成/下一步：
- 绝对不要做：

## 1. 项目身份
- 产品/路径/技术栈/入口文件/文档位置

## 2. 当前事实
- 版本、commit、release、安装包、hash、数据目录
- 已验证 vs 假设

## 3. 本轮改了什么
- 文件清单 + 目的 + 是否已发布

## 4. 关键决策
- 决定 / 理由 / 否决方案 / 代价

## 5. 验证
- 命令 + 结果 + 覆盖范围 + 没覆盖什么

## 6. 剩余工作（按顺序）
- 每项：目标、输入、输出、验收、停止条件

## 7. 风险/未知/需要用户
- 外部阻塞、需要账号/硬件/证书/预算

## 8. 运行与发布
- 构建/测试/发布命令；token 在哪（不打印）；不能用的通道

## 9. 禁区与安全
- 不能碰的目录/配置；隐私边界；发布边界

## 10. 接手前 30 分钟
- 先跑什么、先读什么、先问什么

## 11. 附录
- 关键文档链接、ADR、设计稿、参考
```

### 9.3 给 AI 的额外提示

- 开头写明：“你没有看过上一段对话；以下事实按可信度分级。”
- 把“不要重新讨论的决定”单独列出，避免下一个会话反复问。
- 给“上下文预算”：先读第 0/2/6 节，再按需读设计稿；不要一上来全仓库 grep。
- 给“验证优先”：先跑一条只读命令确认状态，再改代码。
- 给“失败模式”：本机已知的坑（中文路径、PowerShell、git push、端口占用）。
- 给“完成定义”：什么算完成、什么算阻塞、什么时候该停下来问用户。
- 子代理交接要写“合同”：目标、输入、输出、约束、验收、停止条件；不要让子代理自己猜范围。

### 9.4 参考（方法论）

- Martin Fowler, “Context Engineering for Coding Agents” (2026-02-05)：上下文要分层、按需加载、控制体量；规则文件应渐进增长，不要把一切都塞进去。 <https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html>
- AGENTS.md 指南（2026）：根/作用域/角色分层；handoff contract；保持精简，作为索引而非百科。 <https://www.aihero.dev/a-complete-guide-to-agents-md> · <https://www.betterclaw.io/blog/agents-md-multi-agent-best-practices>
- README 写法（2026）：一句话说清“是什么/为什么/怎么开始”；视觉演示；快速开始；诚实边界；避免墙式文字。 <https://www.kunalganglani.com/blog/write-good-readme-guide> · <https://github.com/matiassingers/awesome-readme>

---

## 10. 文件索引（下一个会话先看这些）

| 文件 | 用途 |
|---|---|
| `README.md` | 英文主入口；本轮已重写并发布 |
| `说明.md` | 中文完整说明书；本轮已重写第 1 节并发布 |
| `docs/SYNC-MULTIDEVICE-R124.md` | 多终端同步设计稿（必读） |
| `docs/HANDOFF-R124.md` | 本文件 |
| `docs/HANDOFF.md` | 旧总交接；顶部应指向最新交接 |
| `docs/DECISIONS-R123.md` | 上一轮搜索/索引决策；§8 是最终状态 |
| `docs/GATE-MANIFEST.json` | 门禁清单 |
| `packages/app-shell/src/electron-main.ts` | 主进程；搜索/权限/记忆/组网接线 |
| `packages/app-shell/src/search-providers.ts` | 搜索供应商层 |
| `packages/app-shell/src/disk-index.ts` | 后台全盘索引 |
| `packages/app-shell/src/local-search.ts` | 本地搜索/分区/打码 |
| `packages/sync-protocol/src/handshake.ts` | HS1–HS4 握手 |
| `packages/sync-protocol/src/secure-channel.ts` | AES-GCM 记录层 |
| `packages/sync-protocol/src/relay.ts` | 中继（含恶意中继测试模式） |
| `packages/sync-protocol/src/membership.ts` | 成员证书/吊销 |
| `feed/latest.json` | 更新 feed；当前 0.2.33 |
| `checksums.txt` | 0.2.32/0.2.33 安装包 hash |

---

## 11. 多终端同步设计稿（全文）

> 源文件：`docs/SYNC-MULTIDEVICE-R124.md`。以下全文并入交接，便于新会话不跳文件直接读完；两处内容应保持同步。

> 状态：**设计稿，未实现**。0.2.33 仍是单机数据 + 可选项目组网。
> 目标：同一个身份下的多台设备，在**不依赖统一账号服务器**的前提下，安全、可恢复地同步聊天、记忆、看板、知识库和文件。
> 本文把“可行吗、怎么做、先做什么、哪些做不到”一次写清，供下一个会话直接继续。

---

### 0. 结论先行

**可行，但不要把它做成“网盘同步文件夹”。**

推荐路线：

1. **先设备，后数据**：设备密钥 + 二维码/短码配对 + 已授权设备签发设备证书 + 可撤销设备列表。
2. **先记录，后文件**：聊天/记忆/看板/知识库走加密操作日志；文件走加密分块 + 不可变版本。
3. **先直连，后中继**：复用现有 SecureMesh（X25519 ECDHE + Ed25519 + AES-256-GCM）；NAT 打不通走现有中继；离线设备可选“加密邮箱”。
4. **冲突显式化**：聊天只追加；看板/知识库按字段合并；文件冲突生成并列版本，不静默覆盖。
5. **可选自托管**：默认纯 P2P；用户可以在 NAS/VPS 上跑一个只存密文的中继/邮箱，提高离线可靠性；它不是账号服务器。

“同账号多终端同时在线就能互连并同步”在多数网络下成立，但**不是无条件实时**：

- 双方至少一方可被拨入 → 直连；
- 双方都在 CGNAT 后 → 需要中继；
- 一方离线 → 等它上线，或走加密邮箱；
- 没有中继、又都不可拨入 → 同步不了，必须如实告诉用户，不能假装“正在同步”。

---

### 1. 现状盘点（别重复造已有轮子）

项目已经有可复用的底层：

| 能力 | 现有实现 | 对本方案的意义 |
|---|---|---|
| 身份 | Ed25519 + 指纹 + safeStorage + 助记词恢复（`app-shell/src/identity.ts`、`packages/sync-protocol/src/identity.ts`） | 账号根身份可复用；**设备身份要新建**，不能把助记词复制到每台设备 |
| 安全握手 | HS1–HS4，Ed25519 双向认证 + X25519 ECDHE + HKDF（`handshake.ts`） | 直连/中继上的每条连接都可复用 |
| 加密通道 | AES-256-GCM 分帧、方向计数器、KeyUpdate（`secure-channel.ts`） | 传输层机密性/完整性已有；记录层再加一层信封加密 |
| 组网 | SecureMesh、局域网发现、DHT、NAT-PMP/STUN、阶梯拨号（`mesh.ts`、`dht.ts`、`nat.ts`、`ladder.ts`） | 设备发现与直连路径可复用 |
| 中继 | 纯字节转发 + 配对 token + 恶意中继测试模式（`relay.ts`） | 解决双 CGNAT；中继看不到明文 |
| 成员信任 | 成员证书 + 吊销列表 + 版本单调（`membership.ts`） | 项目成员信任模型可复用；账号设备信任是另一套，不要混用 |
| 消息投递 | outbox + 业务 ACK（W07） | 可扩展成加密信封的重投/确认 |
| 本地记录 | 聊天 JSONL、记忆 JSONL + SQLite 投影、看板/知识库结构化存储 | 记录级同步的数据源 |
| 数据包 | `.nm` 全量/选择性导出导入、加密 vault | 已有的“离线迁移”兜底，不是实时同步 |

**缺口：**

- 没有“账号下的设备”概念；当前一台设备一个身份。
- 没有设备配对、设备证书、设备列表、设备撤销。
- 没有记录级同步协议（只有项目消息总线和文件 JSONL）。
- 没有 CRDT/合并规则。
- 没有文件分块/加密清单/断点续传。
- 没有离线加密邮箱。
- 没有多设备冲突 UI。

---

### 2. 需求与非目标

#### 2.1 必须满足

1. 不要求统一账号服务器；默认可纯 P2P。
2. 中继/邮箱只接触密文；不能读聊天、文件、记忆。
3. 新设备必须经用户明确配对；不能凭助记词静默加入。
4. 设备可撤销；撤销后不能再拉取新数据。
5. 聊天记录只追加，不被“最后写入者赢”覆盖。
6. 断网、重启、重复投递后不丢、不重、不乱序。
7. 冲突必须可见、可解释、可恢复。
8. 用户能按项目/会话选择同步范围；密钥类内容默认不同步。
9. 设备丢失/换机有明确恢复路径；没有服务器也能恢复。
10. 同步状态必须如实：已同步 / 等待设备 / 需要中继 / 被撤销 / 冲突。

#### 2.2 非目标（至少第一阶段不做）

- 不做“所有文件系统实时镜像”。
- 不做多人实时同时编辑同一段文本（先做记录同步，CRDT 后置）。
- 不做匿名网络/抗流量分析；中继仍会看到 IP、设备 ID、时间和大小。
- 不做服务端搜索/服务端解密；索引始终在本地重建。
- 不做“忘记助记词还能找回”——没有服务器就没有这种魔法。

---

### 3. 威胁模型

| 威胁 | 边界/对策 |
|---|---|
| 中继偷看 | 传输层 E2EE + 记录层信封加密；中继只做字节转发/存密文 |
| 中继篡改/重放/重排 | 现有方向计数器 + 持久化 replay guard；记录层 opId + 哈希链 + 单调版本 |
| 恶意设备冒充新设备 | 二维码含临时公钥 + 一次性 token + SAS/emoji 短码确认；已有设备签发证书 |
| 被撤销设备继续拉数据 | 设备列表/吊销列表单调递增；服务端（中继）只转发；其他设备拒绝其证书；项目密钥轮换 |
| 回滚旧状态 | 每个设备/项目单调版本；拒绝低版本设备列表、吊销列表、同步头 |
| 时钟漂移 | 逻辑时钟（Lamport）+ 设备 id 打破平局；物理时间只做展示/粗筛 |
| 设备丢失 | 远程撤销 + 项目密钥轮换；本地 vault 已加密；不承诺远程擦除 |
| 元数据泄露 | 明确告知中继/发现服务可见 deviceId、IP、时间、大小；可选自托管中继；不做“完全匿名”承诺 |
| 供应链/依赖 | 只复用现有 crypto 与 Node 标准库；不引入自研密码学 |

---

### 4. 目标架构

```text
账号根身份（助记词派生 Ed25519，离线保存）
   │ 签发
   ├── 设备 A 证书（设备公钥 + 角色 + 有效期 + 父签名）
   ├── 设备 B 证书
   └── 设备 C 证书
        │
        ▼
   设备列表（签名、单调版本、可撤销）
        │
        ▼
   同步层
   ├── 记录日志（chat / memory / board / knowledge）
   │     · 每设备 seq + opId + 前序哈希
   │     · 交换 heads → 拉缺失 op → 持久化 → ACK
   ├── 文件层（chunk + 每文件密钥 + Merkle manifest）
   └── 冲突层（CRDT / 版本并列 / 冲突卡）
        │
        ▼
   传输层（复用现有）
   ├── 直连：SecureMesh（X25519 ECDHE + Ed25519 + AES-GCM）
   ├── 发现：LAN / DHT（可选）
   ├── 中继：纯字节转发（双 CGNAT）
   └── 邮箱：加密信封暂存（离线设备，可选自托管）
```

#### 4.1 设备身份与配对

**账号根身份**：沿用现有助记词派生的 Ed25519 身份。它只用于“证明这是同一个账号”和签发设备证书；**不直接用于日常同步**。

**设备身份**：每台设备本地生成独立 Ed25519 密钥对 + X25519 密钥对；设备证书包含：

- `accountId`（根公钥指纹）
- `deviceId`（设备公钥指纹）
- `devicePublicKey`
- `role`：`owner` / `editor` / `read-only`
- `issuedAt` / `expiresAt`
- `issuedBy`（根或某台已授权设备）
- `parentCertId` / `supersedes`（换设备/换证链）
- 根或父设备签名

**配对流程（推荐 QR + SAS）：**

1. 新设备生成临时 X25519 密钥对 + 一次性 token，显示二维码（含临时公钥、token、设备公钥、设备名）。
2. 已授权设备扫描；双方通过临时密钥建立一次性加密通道。
3. 双方显示 6 位短码/emoji（SAS），用户在两台设备上确认一致，防中间人。
4. 已授权设备签发新设备证书，并把账号数据密钥（DEK）用新设备公钥包裹后发送；同时发送当前设备列表/同步头。
5. 新设备写本地设备库，开始拉记录；旧设备记录“设备已加入”审计。
6. 用户可在“我的 → 设备”看到设备列表、最后在线、角色，并可撤销。

**不要做的事：**

- 不要把助记词输入到新设备来“登录”；那等于复制根私钥。
- 不要让新设备仅凭账号密码/邮箱自行加入；没有服务器可验证。
- 不要把设备证书和项目成员证书混为一谈：前者是“同一个人拥有的设备”，后者是“项目里的成员身份”。

#### 4.2 记录同步协议

每个同步域（chat / memory / board / knowledge / settings）一条逻辑日志：

```text
op = {
  opId: base32(sha256(accountId | deviceId | seq | payloadHash)),
  accountId, deviceId, seq,
  domain, entityId,
  kind: 'append' | 'update' | 'delete' | 'tombstone',
  lamport, prevHash,
  payload: <encrypted envelope>,
  sig: <device signature over canonical header + payloadHash>
}
```

- `seq`：每设备每域单调递增，不重复。
- `prevHash`：该设备上一条 op 的哈希，形成每设备哈希链；接收方拒绝断链/回滚。
- `lamport`：并发排序；平局用 `deviceId`。
- `payload`：用域密钥 AES-256-GCM 加密；中继/邮箱看不到。
- `opId`：幂等键；重复投递直接丢弃。
- `ACK`：接收方持久化后才 ACK；发送方按 ACK 推进 `ackedSeq`。

**同步握手：**

1. A → B：`sync-hello { accountId, deviceId, cert, domainHeads: {deviceId: seq}, deviceListVersion, revocationVersion }`
2. B 验证证书链、设备列表、吊销列表、版本单调；拒绝未知/已撤销设备。
3. B 计算缺失 op（按每设备 seq），分批发送；A 持久化后 ACK。
4. A 反向拉 B 缺失的 op；完成后双方更新 heads。
5. 断线重连从 `ackedSeq` 继续；不重扫全量。

**分页/背压**：每批最多 N 条或 M 字节；大记录走文件层；避免一次拉爆内存。

#### 4.3 各数据域的合并规则

| 域 | 规则 | 冲突处理 |
|---|---|---|
| 聊天消息 | 只追加；编辑/删除写 tombstone op | 不覆盖正文；显示“已编辑/已删除” |
| 记忆事件/实体 | 只追加 + 标签/链接用 CRDT Set | 重复 op 幂等；标签并发取并集 |
| 看板/任务 | OR-Map + LWW-Register（Lamport）+ RGA 列表 | 并发字段修改保留双方值，UI 冲突卡 |
| 知识库条目 | 实体/事件 op + 版本链 | 冲突生成新版本，旧版本可回看 |
| 设置 | 分 `device` 与 `shared`；只同步 shared 白名单 | 设备本地优先；shared 用 LWW + 审计 |
| 文件/产物 | 不可变 blob + 版本清单 | 同名并发写 → 并列版本，不静默覆盖 |
| 密钥/凭证 | **不同步**（默认） | 需要时用设备公钥重新包裹，单独授权 |

**原则：** 任何“覆盖”都必须有版本号、来源设备和审计；任何“删除”都是 tombstone，不是物理消失（至少保留到所有在线设备确认）。

#### 4.4 文件/产物同步

- **分块**：内容定义分块（FastCDC 或滚动哈希），固定大小块会在插入时全变。
- **加密**：每个文件一个随机 fileKey；每块 AES-256-GCM；密文按哈希寻址。
- **清单**：Merkle manifest 记录块顺序、大小、密文哈希、fileKey 包裹信息；清单本身加密。
- **版本**：文件内容不可变；修改生成新 manifest；同名并发生成 sibling version。
- **断点续传**：按块 ACK；断电/断网后只补缺失块。
- **去重**：同一密文块可跨版本复用；注意不要跨账号去重（会泄露相等性）。
- **密钥分发**：fileKey 用每个授权设备的 X25519 公钥包裹；撤销设备后新文件不再包裹给它；旧文件无法收回。

#### 4.5 传输与中继/邮箱

- **直连**：复用 `SecureMesh`；先 LAN，再 DHT/已知地址，再 NAT 打洞。
- **中继**：复用 `relay.ts`；中继只按 token 配对转发字节；记录层再加密一次，防止中继终止 TLS 后看到内容。
- **加密邮箱**：中继可存“收件人 deviceId + 过期时间 + 密文信封”；接收方上线后拉取并 ACK；TTL/配额/删除策略明确。邮箱只存密文和最小路由元数据。
- **自托管**：用户可在 NAS/VPS 跑 `warmy-relay`/`warmy-mailbox`；也可以完全关闭。
- **不用统一服务器**：发现用的 bootstrap/DHT 种子可由用户配置；没有种子时用局域网/手动地址。

#### 4.6 密钥与恢复

- 账号根私钥只在用户保存助记词的那台“主设备”或离线备份中存在；不复制到每台设备。
- 新设备拿到的是**被包裹的 DEK**，不是根私钥。
- 设备撤销：更新签名设备列表 + 吊销列表；项目密钥轮换；中继邮箱拒绝该 deviceId。
- 全部设备丢失：助记词 + 之前的加密 vault/.nm 备份恢复；没有服务器兜底。
- 设备换证：`supersedes` 链保持同一设备身份；旧证书进吊销列表。

---

### 5. “同账号多终端同时在线就互连并同步”是否可行？

**可行，但要分条件说清楚：**

| 场景 | 能否同步 | 路径 |
|---|---|---|
| 同一局域网，发现开启 | 可以，低延迟 | mDNS/广播 + 直连 |
| 一方有公网/可拨入，另一方出站 | 可以 | DHT/地址交换 + 直连 |
| 双方都在 CGNAT 后 | 需要中继 | 现有 relay；没有中继则不行 |
| 一方离线 | 不能实时；上线后补 | 记录日志 + ACK；可选邮箱 |
| 设备被撤销 | 不能 | 证书/吊销拒绝 |
| 没有共同 bootstrap/DHT 且不在同一 LAN | 需要手动地址或中继 | 用户配置 |

所以“同时在线”是**必要不充分条件**。产品文案应写“设备在线且网络可达时自动同步；不可达时走中继；离线时等上线或走加密邮箱”，不要承诺“永远实时”。

---

### 6. 备选方案对比

| 方案 | 做法 | 优点 | 缺点 | 适用 |
|---|---|---|---|---|
| **A. P2P + DHT + 中继 + 可选邮箱**（推荐） | 设备直连，打洞失败走中继，离线走邮箱 | 无统一服务器；隐私最好；复用现有代码 | NAT/中继复杂度；离线依赖邮箱；元数据仍暴露 | 默认方案 |
| **B. 自托管加密 Hub** | 用户在 NAS/VPS 跑一个只存密文的同步服务 | 离线可靠；实现比 P2P 简单；可备份 | 用户要运维；Hub 看到元数据；有单点 | 高级用户/小团队 |
| **C. 第三方哑存储 + E2EE** | S3/WebDAV 只存加密块，客户端合并 | 便宜、可靠、易备份 |  Provider 看到元数据；冲突层仍要自己做；依赖第三方 | 备份目标，不作主路径 |
| **D. 中心化 E2EE 服务** | 类似 Obsidian Sync | 体验最好；多端稳定 | 需要运营/信任；违背“不提供统一服务器” | 不考虑 |
| **E. 手动 .nm 导入导出** | 已有功能 | 零基础设施；完全可控 | 不实时；易忘；冲突靠人 | 永远保留的兜底 |

**建议：A 为默认，B 为可选高级模式，C 只作备份目标，D 不做，E 永远保留。**

---

### 7. 分阶段落地

#### P0：设备身份与配对（先做，最关键）

- 设备密钥、设备证书、签名设备列表、吊销列表。
- QR + SAS 配对；设备管理页（查看/撤销/改名）。
- 单元测试：证书链、过期、撤销、换证、重放、错误 SAS。
- **验收门禁**：新设备未配对不能拉数据；撤销后立即拒绝；旧证书不能复活。

#### P1：记录同步（聊天/记忆/看板/知识库）

- op log、heads 交换、分页、ACK、断线续传、幂等。
- 各域合并规则；冲突卡第一版。
- 复用 SecureMesh/relay；先不做邮箱。
- **验收**：3 台设备、断网重连、并发编辑、重复投递、时钟漂移、10k ops。

#### P2：文件/产物同步

- FastCDC + 每文件密钥 + Merkle manifest + 断点续传 + 版本并列。
- **验收**：1GB 文件、断网续传、并发同名写、去重、撤销设备后新文件不再给它。

#### P3：离线邮箱与自托管中继

- 加密信封、TTL、配额、ACK/删除、自托管脚本、滥用限制。
- **验收**：两端不同时在线；邮箱只看到密文；重放/伪造被拒；配额耗尽如实报错。

#### P4：多写者实时协作

- 文本/看板 CRDT、presence、光标/选区（可选）。
- **验收**：两人同时编辑、离线合并、冲突可视化、不丢字。

---

### 8. 测试矩阵（做成门禁，不靠手测）

| 维度 | 用例 |
|---|---|
| 设备数 | 2 / 3 / 5 台 |
| 网络 | 同 LAN / 一方公网 / 双 CGNAT+中继 / 断网 / 高延迟 / 丢包 |
| 生命周期 | 首次配对 / 换证 / 撤销 / 设备丢失 / 全部设备丢失 |
| 数据 | 10k 聊天 op / 1GB 文件 / 大知识库 / 并发看板编辑 |
| 攻击 | 重放 / 篡改 / 重排 / 回滚旧 heads / 伪造设备证书 / 恶意中继 / 错误 SAS |
| 恢复 | 崩溃后重启 / 断电 / 邮箱 TTL / 密钥轮换 |
| 资源 | CPU/内存/磁盘/电量；同步可暂停/限速 |

现有 `relay.ts` 已有 `replay-once` / `tamper-once` / `swap-once` 恶意中继模式，可直接复用为攻击面门禁。

---

### 9. 风险与待拍板

1. **CRDT 选型**：Automerge（历史/同步协议成熟，体积较大）vs Yjs（文本强，生态大）vs 自研小型 op-log + LWW（可控，功能少）。建议 P1 先用自研 op-log + LWW/OR-Map，P4 再评估 CRDT 库。
2. **设备根信任**：根私钥只在一台设备，还是用门限/多设备签名？建议先单主设备 + 助记词恢复，简单可验证。
3. **邮箱是否默认开**：建议默认关，用户在设置里选择自托管/社区中继；开启时明确告知元数据。
4. **同步范围默认值**：建议默认只同步“我的牛马”的会话/记忆/看板，项目按项目开关；密钥/凭证默认不同步。
5. **文件同步是否第一阶段做**：不建议；记录同步价值更高、风险更低。
6. **中继成本/滥用**：需要配额、token bucket、黑名单；否则公共中继会被刷爆。
7. **元数据最小化**：是否做填充/批量/延迟？会增加复杂度和流量；先如实披露，不承诺匿名。

---

### 10. 参考（行业做法）

- Signal, “A Synchronized Start for Linked Devices” (2025-01-27)：新设备二维码 + 临时公钥 + 一次性 token + 设备独立密钥 + 设备到设备加密传输历史；服务器不持有明文。 <https://signal.org/blog/a-synchronized-start-for-linked-devices/>
- Syncthing, “Security Principles” (v2.0)：设备 ID = 证书指纹；TLS；中继只转发，但会看到设备 ID/IP；发现服务会暴露设备在线关系。 <https://docs.syncthing.net/v2.0.0/users/security.html>
- Matrix, “Implementing more advanced E2EE features, such as cross-signing”：主密钥/自签名密钥/用户签名密钥；设备交叉签名；SAS/emoji 验证；密钥备份。 <https://matrix.org/docs/older/e2ee-cross-signing/>
- Automerge / CRDT local-first sync：CRDT 合并并发编辑；E2EE 可在客户端加密后再交给中继/服务器。 <https://automerge.org/> · <https://kerkour.com/crdt-end-to-end-encryption-research-notes>
- Local-first software principles：数据所有权、离线可用、协作、长期可用。 <https://www.inkandswitch.com/local-first/>
- NAT 穿透/中继：TURN/relay 只转发，不保证可读；双 CGNAT 需要中继。 <https://www.offlineprotocol.com/learning/delivery/what-is-a-relay-server>

---

### 11. 一句话建议

**先做“设备配对 + 加密记录日志 + 冲突卡”，不要先做“同步整个文件夹”。** 这条路线能复用现有安全组网，风险最低，也最符合“无统一服务器、私密优先、传输安全”的产品口径。

---

## 12. 交接结论

- 0.2.33 已发布；README/说明的“更有吸引力”版本已发布（commit `920d544eb6c0de31e52cc6896905cfd6f0a36b0e`）并通过文档门禁。
- 多终端同步的推荐方案、备选方案、分阶段路线、测试矩阵、风险和待拍板项已全文并入本文第 11 节，源文件为 `docs/SYNC-MULTIDEVICE-R124.md`。
- 下一个会话不需要重新调研 README 写法或同步架构；从本文第 6 节开始执行即可。
- 用户要的是“新会话继续”，所以优先把本文第 0、2、3、5、6 节读透，再动代码。

---

## 13. R125 操作记录（2026-11-01）

### 13.1 工作区清理

- 删除全部被 .gitignore 忽略的临时产物（git status 595 行 → 595 行，零变化）：
  - 根目录全部 `*.log`（`.r44-*` / `.r122-*` / `round18*-r1` / `verify-22-*` / `.tmp-3x` / `.tmp-local-server2` / `.r57-fast` / `.r50-mem-pilot*` 等约 45 个）；
  - `.tmp-r45-frame.cjs`、`.tmp-r45-ps.ps1`；
  - 临时目录 `.tmp-r52/`、`.tmp-r78/`、`.tmp-r81/`、`.tmp-video/`（测试 HTML/视频/脚本产物）。
- 未动：`spikes/`（tracked 实验代码）、根目录 `index.html`/`preview.*`（tracked 旧预览页）、`vendor/`（空占位）、`.qoder/`（别的工具配置）、`.mimocode/`（项目 skills）。

### 13.2 CSS 主题色修复（未发布）

- 现象：勾选框/滑块/单选钮显示浏览器默认蓝。
- 根因：全仓无硬编码蓝色；大量原生控件未设 accent-color。
- 修改：app.css、renderer.css（index.html 仍加载的旧副本，必须同步）、nm-viewer.css 各加一条全局规则：
  `input[type="checkbox"], input[type="radio"], input[type="range"] { accent-color: var(--accent); }`
- 验证：verify-css-consistency 8/8、verify-security 28 PASS；Electron 无头窗口真实渲染，三种控件计算样式均为 rgb(168,118,84)（#A87654）。
- 未动：auth-gate（本就是主题色同值 #a87654）；独立页（firstrun/snip/mimic）无表单控件。

### 13.3 多终端同步设计稿评审与决策

- 评审补充 8 项（docs/SYNC-MULTIDEVICE-R124.md §9.1–§9.8）：DEK 来源、设备列表合并规则（OR-Set）、签发权限矩阵、op log 快照/压缩、证书绑定握手公钥、撤销传播、同步域↔存储映射、与项目组网信任隔离。
- **用户拍板：不使用中继传递邮箱内容**——邮箱若做只能是自托管，或不做；公共中继只做实时转发。已同步更新设计稿 §4.5、§7 P3、§9 第 3 条。
- 待用户拍板：DEK 来源（建议助记词 HKDF 派生）、同步范围默认值、CRDT 选型（P1 前）。

### 13.4 拟态（mimic）功能状态核实

- **主体已实现**：桌宠窗口（置顶/穿透/拖动/命中测试）、内置默认角色 builtin-default.svg、语音模式（off/wake/always/smart）、判断模型、字幕、看一眼（截图授权）、拟态记忆、定时任务接线、动作/角色扫描（IPC）、门禁 verify-r83-mimic-look.mjs。
- 未完成：动作模型需用户自备资源（resources/mimic/actions 或 userData/mimic/actions）；真实麦克风/系统音频/语音唤醒的真机验证待做。

### 13.5 未发布清单

- 本轮所有改动（CSS、docs）均未发布；版本号/安装包/feed/Release 均未动。远程 main 仍 920d544。

### 13.6 截图修复（R125，未发布）

现象（真机反馈）：首次截很卡；截图完成后卡住无法成功。

根因：
- 整屏 PNG 转 base64（数 MB~几十 MB）通过 IPC 注入遮罩窗/回传渲染层，跨进程大字符串 + 渲染层大图 DOM 把界面拖死；
- 遮罩窗 `done()` 不等待 invoke 结果、失败无恢复 ⇒ 通道异常时永久卡"处理中…"，窗口无边框还关不掉；
- 无超时兜底：任何异常导致选区 promise 不 resolve ⇒ 主窗口不回来；
- Windows 屏幕捕获管线首次调用冷启动慢（"首次很卡"）。

修复（4 处）：
- `packages/app-shell/src/electron-main.ts` `warmy:jieTuKaiShi`：全屏图先落临时文件，遮罩窗用 file:// 路径加载（不再注入大 base64）；回传改为 480px 缩略图（60KB 级）；选区 promise 加 90s 超时兜底；临时文件用完即删。
- `electron-main.ts` 新增 `yuReJieTu()` 预热：启动 3s 后后台小尺寸抓屏一次，初始化捕获管线。
- `packages/app-shell/src/renderer/snip.html` `done()`：invoke 失败恢复 `yiTiJiao=false` 并提示重试，不再永久卡死。
- `packages/app-shell/src/renderer/app.js` 附件放大预览：优先 `file://` 原图路径（缩略图 480px 放大会糊）。

验证：
- `tsc -b` EXIT 0；check-syntax 通过；verify-security 28 PASS。
- 基准（3440x1440）：getSources≈400ms、toPNG≈53ms、写盘 2ms、缩略图 base64 60KB（原整屏 base64 数 MB~几十 MB）。
- 开发版已启动供用户首启验收（临时数据目录 `%TEMP%\warmy-accept-r125`，未碰任何用户数据）。

---

Pondsi — 由 OpenClaw 自行提交
