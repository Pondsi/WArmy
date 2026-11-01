# WArmy 第 123 轮交接文档（0.2.33）

> 交接时间：2026-10-31
> 版本：`0.2.33`（已发布）
> 仓库：<https://github.com/Pondsi/WArmy>
> Release：<https://github.com/Pondsi/WArmy/releases/tag/v0.2.33>
> 安装包：`WArmy-Setup-0.2.33.exe`（228,775,742 字节）
> SHA-256：`03f0b484fc00db4d678b6b7f9d9f16fda4c4449225af21234df38c5c47e91073`
> 本机安装位置：`<安装目录>`
> 数据目录：`<安装目录>\WArmyData`
> 首启状态：已删除旧配置并启动安装版，当前停在**语言选择页**，等待验收。

---

## 一、这轮做了什么

### 1. 联网搜索：内置供应商，全部默认关闭

设置 → 功能 → **网络搜索**。内置四项，默认都没有启用：

| 供应商 | 能力 | 是否需要 Key | 备注 |
|---|---|---|---|
| Firecrawl Keyless | 搜索 + 抓正文 | 不填也能用免注册额度 | 填了 Key 走付费额度；Key 失效时自动退回 Keyless 重试一次 |
| Jina Reader | **只抓正文，不搜索** | 不需要 | 匿名约 20 RPM；部分网络会挡住 |
| Tavily | 搜索 + 抓取 | 需要 | 用户自己的 Key |
| DeepSeek Search | 搜索 | 需要 | 官方 `/v1/tools/search` |
| 自定义 | 搜索 | 可选 | 填名称、URL、可选 Key；支持 `{query}` GET 或 POST `{query,count}` |

真实测试结论（2026-10-31）：

- Firecrawl Keyless 的 `v2/search` 与 `v2/scrape` 都返回 200，能拿到真实结果和正文；精确的每日额度官方没有公布，按 IP 有请求数和 credit 双重限制，超限返回 429。
- Jina Reader 匿名可用；**Jina Search 匿名返回 401**，所以没有把 Jina Search 当成“免注册搜索”集成。
- 429 的处理：不编造结果；如实告诉用户是限流/额度/并发超限，并给出“等待 / 换供应商 / 停止”三个选择。模型调用遇到 429 也走同一套分类（`rate-limit`），提示等待、换模型/供应商或停止。

没有把搜索做成 skill 的原因：WArmy 的 skill 是给模型的 Markdown 指令包，不携带网络实现、Key 存储、配额/429/回退、IPC 校验、审计和会话权限。搜索后端必须留在宿主；将来最多加一个“引用规范/检索流程”的 skill，后端不变。

### 2. 本地搜索：统一入口 + 后台索引 + 按需扫描

聊天框上方搜索（含快捷键）打开统一搜索弹窗，顺序固定：

1. 当前会话
2. 程序全部界面文案（10 个语言包 + 渲染层静态文案；按钮、标签、提示都算）
3. 其他会话（按权限）
4. 知识库（用户搜索看全部层）
5. 本会话工作区
6. 程序外全盘

全盘结果标注盘符（`C:`、`D:` 等）。敏感内容不排除，但默认显示 `*****`；鼠标悬停时由主进程用 AES-256-GCM 解出**5 分钟、仅内存**的副本，移开恢复 `*****`。异步竞态有守卫，鼠标离开后迟到的解密结果不会把内容重新显示出来。

全盘索引（`packages/app-shell/src/disk-index.ts`）：

- SQLite FTS5（trigram）+ `files` 表；名称/路径先入库，正文后补。
- 所有根目录都走：用户主目录 + 所有盘符；**不跳过系统/临时文件**，只是降低优先级。
- 正文入 FTS 前先打码，索引里不出现密钥明文。
- 后台低占用循环：每轮工作 40 ms、休眠 400 ms；不阻塞主流程。
- 结果分页：每页 20 条，滚动到底继续取；取完如实说“已扫描完/已截断”。
- 设置里有“全盘搜索后台索引”勾选，默认开启；关闭后仍可按需扫描。
- 索引未命中时退回 `saoMiaoQuanPan` 按需扫描（12 秒 / 12 万文件 / 200 条上限），缓存 2 分钟供下拉分页。

### 3. 模型搜索权限（按会话类型）

`local_search` 是只读工具，没有写入/删除/重命名路径。权限矩阵：

| 会话类型 | 当前会话 | 程序 UI | 本会话可读知识层 | 其他会话 | 全盘 |
|---|---|---|---|---|---|
| 我的牛马 | ✅ | ✅ | ✅ | 需要授权卡；完全授权直接放行 | 需要单独的授权卡；完全授权直接放行 |
| 项目 | ✅ | ✅ | ✅ | 只能看**所有项目和群聊**，需要授权卡；完全授权直接放行 | ❌ 禁止，无授权途径 |
| 群聊 | ✅ | ✅ | ✅ | ❌ 直接拒绝，无授权途径 | ❌ 直接拒绝，无授权途径 |
| 联系人 | ✅ | ✅ | ✅ | ❌ 直接拒绝，无授权途径 | ❌ 直接拒绝，无授权途径 |

要点：

- 项目会话要求看“我的牛马/联系人”时，工具返回“无权查看，且没有授权途径”，不会弹卡。
- 群聊/联系人要求跨会话时，直接拒绝并说明这是被禁止的行为。
- 全盘搜索只对我的牛马开放；每次请求都弹卡（完全授权除外）。
- 搜索结果里的敏感片段对模型也保持打码，真实路径在敏感命中时隐藏。
- 用户主动搜索被视为已知风险且已授权：不弹提示、不弹授权卡，直接给结果。

### 4. 标语与文档

- 右上角标语改为：
  - 简体中文：**属于你的军团**
  - English: **An army that's yours.**
  - 其余 8 个语言包同步为等价表述。
- README.md / 说明.md 重写为“本地优先、私密优先、安全优先”的叙事，不是照搬营销模板；包括适用场景、边界、已知限制、开源致谢。
- 致谢里重点写了 **DeepSeek Harness (dsh)**，以及 Electron、Chromium、Node.js、TypeScript、pnpm、electron-builder、SQLite/FTS5、better-sqlite3、SQLCipher、ONNX Runtime Web、sherpa-onnx、qrcode-generator、jsQR 等。
- 公开仓库只发：源码、README.md、首启截图、说明.md、LICENSE、SPONSORS.md。共 437 个文件；`dev/`、`release/`、`docs/`（除截图）、测试脚本、交接文档、配置/日志都没有发。

### 5. 发布

- 0.2.32 先发布；发布后自查发现全盘搜索授权卡仍写“不建常驻索引”，与实现冲突；**当天修正文案并发布 0.2.33**。
- 0.2.33 的改动只有文案（授权卡、进度行、设置标签、门禁描述），没有改变搜索结果、权限或存储行为。
- 源码推送与 Release 都走 GitHub Git Data API（本机 `git push` 会挂起，见发布规范）。
- Release 资产校验：
  - `WArmy-Setup-0.2.33.exe`，228,775,742 字节，SHA-256 `03f0b484...e91073`（GitHub 返回的 digest 与本地一致）
  - `checksums.txt`，537 字节

---

## 二、验收记录

### 连续 3 轮静态门禁（每轮 19 项，全部 exit 0）

1. `verify-research-pipeline`
2. `verify-local-search`
3. `verify-search-providers`
4. `verify-i18n-locales`
5. `verify-docs`
6. `verify-gate-manifest`
7. `verify-security`
8. `verify-wiring`
9. `verify-ipc-probe`
10. `verify-import-integrity`
11. `verify-no-empty-catch`
12. `verify-strict-language`
13. `verify-css-consistency`
14. `verify-renderer-scope`
15. `verify-renderer-template-balance`
16. `verify-template-integrity`
17. `verify-work-tools`
18. `verify-tool-calls`
19. `verify-secret-at-rest`

结果：3 轮全部通过（`ALL PASS`）。

### 首启 UI 门禁

`verify-firstrun-ui.mjs` 连续 3 轮，每轮 **19/19**，覆盖：语言选择、条款、登录/注册、引导卡位置、设置页 12 分区布局、首启全程无渲染层异常。

### 打包件冒烟（0.2.33）

安装到 `<安装目录>` 后，用 CDP 真实启动：

- 版本 0.2.33、Electron 45
- 标语“属于你的军团”
- 网络搜索 4 项内置供应商存在且全部默认关闭
- 全盘索引默认开启
- 设置 → 功能有“网络搜索”卡
- 索引说明为“低占用后台建立”，不再出现“空闲时建立/不建索引”
- **10/10 通过**

### 干净首启（0.2.33）

删除 `WArmyData` 后启动安装版：

- 首启语言选择出现
- 10 个语言选项
- 默认选中简体中文
- “开始”按钮可用
- 品牌“无限牛马”、标语“属于你的军团”
- 版本 0.2.33
- **7/7 通过**

### 远程验收

- `main` 指向 `16e52f2a281f7cf659a48ccbad4d26beab5e0db7`
- tag `v0.2.33` 指向同一 commit
- Release 非 draft、非 prerelease，两个资产 digest 与本地一致
- 仓库树 437 个文件，无 `dev/`、`release/`、`HANDOFF`
- raw README 含 0.2.33 下载链接、标语、dsh 致谢
- Release 页面 HTTP 200

---

## 三、代码位置（本轮主要改动）

| 文件 | 作用 |
|---|---|
| `packages/app-shell/src/search-providers.ts` | 多供应商搜索层：Firecrawl/Tavily/DeepSeek/自定义、失败回退、429 |
| `packages/app-shell/src/research-tools.ts` | `web_search` / `web_extract`，Firecrawl Keyless、Jina Reader 回退、429 |
| `packages/app-shell/src/disk-index.ts` | 后台全盘 SQLite FTS5 索引、分页、打码正文、低占用循环 |
| `packages/app-shell/src/local-search.ts` | 统一搜索、UI 文案索引、按需扫描、分区整理、敏感打码 |
| `packages/app-shell/src/electron-main.ts` | 搜索配置/Key IPC、统一搜索、全盘分页、跨会话权限、429 文案、索引生命周期 |
| `packages/app-shell/src/work-tools.ts` | `local_search` 工具声明与 `include_other_sessions` / `include_disk` |
| `packages/app-shell/src/cuowu-fenlei.ts` | 模型 429 归类为 `rate-limit` |
| `packages/app-shell/src/preload.cjs` | 搜索配置、供应商 Key、索引状态 API |
| `packages/app-shell/src/renderer/app.js` | 设置页网络搜索卡、统一搜索弹窗、懒加载、悬停解密 |
| `packages/app-shell/src/renderer/app.css` | 搜索分区/命中/元信息样式 |
| `packages/app-shell/src/i18n/*.json` | 10 语言的搜索、权限、索引文案 |
| `packages/app-shell/scripts/verify-search-providers.mjs` | 18 项供应商门禁 |
| `packages/app-shell/scripts/verify-local-search.mjs` | 53 项统一搜索/权限门禁 |
| `README.md` / `说明.md` | 本地优先/私密优先/安全优先叙事、致谢、0.2.33 下载 |

---

## 四、还没完成的任务

### A. 需要用户协助（我做不了）

| 项 | 为什么需要你 | 可选方案 | 优点 | 缺点 / 建议 |
|---|---|---|---|---|
| 真实 IM 账号联调（微信/飞书/钉钉） | 需要真实账号扫码/企业租户；我没有可用账号 | ① 你提供一个测试账号/租户；② 继续用夹具和 mock 门禁 | 真实链路能验证收发、掉线、限流 | 账号有隐私和封号风险；建议用小号/测试租户，先只测文本 |
| 物理 4K / 高 DPI 显示器 | 当前机器没有 4K 物理屏；CDP 只能模拟 DPI | ① 你在一台 4K 机器上跑首启/设置/聊天；② 我用 CDP 覆盖 3840×2160 + 150%/200% 缩放 | 真实像素、字体、窗口吸附一次验完 | 模拟不能发现真实字体 hinting/多屏 DPI 切换问题；建议至少一次真机 |
| macOS 构建与公证 | 需要 Mac + Apple Developer 账号；Windows 交叉编译不可信 | ① 你提供 Mac/Apple 账号；② 只发未签名 macOS 包并明确告知 | 签名+公证后用户可直接打开 | Apple 开发者计划 $99/年；无签名会被 Gatekeeper 拦截；建议先出未签名 beta，再决定是否买 |
| Windows 代码签名证书 | 需要购买证书或使用云签名服务 | ① 购买 OV/EV 证书；② Azure Trusted Signing / SignPath 等云签名；③ 保持未签名 | 减少 SmartScreen 警告、提升信任 | EV 证书贵且要硬件令牌；云签名有资质门槛；当前安装包未签名，SmartScreen 可能警告 |
| 公网 VPS / 第二台真实设备 | 需要可用的公网服务器/NAT 环境与凭据 | ① 你提供 VPS；② 用现有局域网 + DHT 结果 | 能验证真实公网打洞/中继 | 云服务器有成本；不建议把密钥写进仓库，运行时注入 |
| W09 更新清单密钥托管 | 需要决定私钥放哪、谁签、轮换策略 | ① 本机离线私钥 + 手动签名；② CI secret；③ 云 KMS | 离线最安全；KMS 最方便 | 离线私钥丢失=无法更新；CI secret 有泄露面；建议先离线，写清楚轮换流程 |
| 搜索供应商付费 Key（Tavily/DeepSeek） | 需要你的账号和额度 | ① 你提供 Key 做真实 429/额度测试；② 保持默认关闭，用户自填 | 能验证真实配额和 429 | Key 不能进仓库；建议用临时 Key，测试后撤销 |

### B. 我可以继续做，但本轮没做

1. **R122 第 8/9/10 轮完整验收**
   - nm 查看器/媒体/文档全量矩阵；压力档 A（网页小游戏多轮制作）与 B（6000 轮 × 2M 记忆压力）；打包件 + 4K/高 DPI + 首启的完整 10 轮。
   - 现状：本轮只做了 3 轮聚焦验收（搜索、首启、打包冒烟），没有重跑全部 R122 十轮。

2. **跨会话权限的真实模型工具调用 E2E**
   - 现状：权限逻辑有源码门禁和静态断言，但没有用真实模型发起 `local_search(include_other_sessions=true)` 验证“弹卡→同意/拒绝→结果”的完整链路。
   - 方案：用 mock OpenAI 兼容服务器 + 真实 Electron，构造四种会话类型，逐条断言；不需要外部 Key。
   - 优点：把“源码正确”升级为“行为正确”；缺点：要写一套会话夹具，约半天。

3. **后台索引真正的 OS 空闲检测**
   - 现状：40 ms 工作 / 400 ms 休眠的低占用循环，应用打开期间一直跑；不是 `powerMonitor.getSystemIdleTime()` 那种“用户离开才建”。
   - 方案 A：用 `powerMonitor.getSystemIdleTime() > 60s` 才推进索引，用户回来立即暂停；
   - 方案 B：保留低占用循环，只在设置里写“低占用后台建立”（当前已改成这个口径）。
   - 优点：A 更省电、更符合“空闲时建立”；缺点：索引可能长期不完成，用户搜索时更常走按需扫描。建议 A+B：空闲时快跑，活跃时慢跑。

4. **Firecrawl Keyless 精确额度**
   - 官方没有公布每日具体数字；现在只能遇到 429 如实提示。
   - 方案：连续探测直到 429，记录请求数/credit；缺点：会消耗当天额度，且不同 IP 结果不同。建议不做“额度保证”承诺，只做 429 处理。

5. **UI 文案索引覆盖动态 DOM**
   - 现状：覆盖 10 个语言包 + 渲染层静态字符串；动态生成的用户内容走会话/知识库分区，不做 DOM 全量爬取。
   - 方案：打开过的页面做 DOM 文本快照；优点：能搜到动态标签；缺点：隐私面扩大、性能开销、需要脱敏和失效策略。建议保持现状，除非你明确要“连动态提示也要搜”。

6. **Jina Search**
   - 匿名 401，需要 Key；本轮按“免注册优先”没有集成。若你愿意填 Key，可以加成一个可选供应商。

7. **代码签名、macOS、4K 的自动化门禁**
   - 目前是文档/人工项；无法在没有硬件/证书的情况下变成真门禁。

### C. 已知限制（产品口径，不是缺陷隐瞒）

- 后台索引是低占用循环，不是 OS 空闲检测。
- 跨会话权限有源码门禁，未做真实模型 E2E。
- 工作区文件在解锁状态下多数是明文；云模型会收到你发送的内容。
- 安装包未签名，SmartScreen 可能提示。
- 只在 Windows 11 x64 验证；macOS 未构建，Linux 未验证。
- 物理 4K、真实 IM、云搜索 Key、macOS 仍未验证。

---

## 五、建议的下一步顺序

1. **你先验收首启**：语言页 → 条款 → 登录/注册 → 引导四步 → 设置 → 功能 → 网络搜索。重点看：默认四项全关、全盘索引默认开、搜索弹窗分区和盘符、敏感内容 `*****`/悬停显示。
2. 如果首启没问题，我再做 **B2 跨会话权限真实 E2E**（不需要你提供任何东西）。
3. 然后做 **B3 空闲检测**（如果你希望更省电；否则保持现状并保留“低占用后台建立”文案）。
4. 你再决定是否提供 **4K 机器 / IM 测试账号 / 签名证书 / VPS**；这些是外部阻塞，不影响本地功能使用。
5. R122 第 8/9/10 轮的完整验收可以在你确认优先级后继续；本轮没有把它们算作已完成。

---

## 六、复现命令

```bash
# 构建
cd packages/app-shell && npm run build

# 19 项静态门禁（单轮；逐项失败即停）
cd ../..
for g in verify-research-pipeline verify-local-search verify-search-providers \
  verify-i18n-locales verify-docs verify-gate-manifest verify-security verify-wiring \
  verify-ipc-probe verify-import-integrity verify-no-empty-catch verify-strict-language \
  verify-css-consistency verify-renderer-scope verify-renderer-template-balance \
  verify-template-integrity verify-work-tools verify-tool-calls verify-secret-at-rest; do
  node "packages/app-shell/scripts/$g.mjs" || { echo "FAIL $g"; exit 1; }
done

# 首启 UI 门禁
node packages/app-shell/scripts/verify-firstrun-ui.mjs

# 安装包
cd packages/app-shell && npm run dist
# 产物：release/WArmy-Setup-0.2.33.exe
```

---

## 七、交接结论

- 0.2.33 已发布，源码/安装包/校验和一致。
- 本轮用户点名的搜索、权限、429、标语、README/说明、三连验收、发布都已完成。
- 首启已删除旧配置并停留在语言选择页，等待你验收。
- 未完成项里，只有“真实 IM / 4K / macOS / 签名 / VPS / 付费 Key”需要你协助；其余我可以继续做。

Pondsi — 由 OpenClaw 自行提交
