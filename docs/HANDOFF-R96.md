# 第 96 轮交接：首启细节、助记拼音、截屏保护、短记忆频率、滚动与操作时序

日期：2026-10-26
本轮性质：代码修改 + 真机验证 + 首启交付。
上一轮凭证审计见 [`HANDOFF-R95.md`](./HANDOFF-R95.md)；未完成项见 [`OPEN-ITEMS-R96.md`](./OPEN-ITEMS-R96.md)。

## 0. 一句话结论

- 首启关闭热区、牛马轨道、助记拼音颜色、截屏保护已改。
- 短记忆改为**会话时间线窗口 + 180 天半衰期使用分 + 共享层 3/5 上限 + 要点去重 + 按内容敏感度即时分层**。
- 用户滚动抢控制问题补了三条路径：scroll 同步识别、程序滚动目标记录、流式/行动重排前后恢复位置；单段思考也按时间混排操作。
- 授权卡过多的真因之一是 `protectedCommandReason` 把**当前会话工作区里的脚本命令**误判为禁止区，已修；其余主要是模型用法和“常规授权逐命令询问”的产品边界。
- 助记词仍不能在新设备恢复数据（G1/G2 未做），详见 R95。

## 1. 首启关闭：热区、牛马轨道、路径

- 关闭热区 **180×160**（原 140×140），叉 **48×48**（原 44）。
- 牛马轨道：**透明背景**（无渐变/圆角/边框），高 150px；从 `x=-size-60` 进、`x=W+60` 出。
- 路径随机比例：平移 28% / 斜线 40% / 曲线 32%；斜线 y 差 30–75px，曲线控制点 45–100px，明显比上一轮更斜/更弯。
- 打开时三只分别在 20%/45%/70% 行程处，之后每 360–1180ms 从左补一只，同屏≤6；返回/关闭即停。
- 文件：`auth-gate.js` 的 `spawnQuitHorse/startQuitHorses`；`auth-gate.css` 的 `.warmyAuthQuitHorses/.warmyAuthQuitRunner`。

## 2. 助记拼音与配色

- 10 个语言包的 `pinyinFriendly` 标签全部改名：
  - 中文「助记拼音」/「助記拼音」，英文 “Mnemonic pinyin”，其余语言对应翻译。
- 助记词格现在显示：
  - 序号：低调灰 `#8f8a82`；
  - **英文 BIP-39 词（助记词本体）**：主题色 `var(--accent)`（浅色主题下 `#a4552f`）；
  - 中文码字：灰 `#8a8680`；
  - 拼音：灰 `#9a948c`。
- 中文友好型/中文码字仍作为辅助显示；关闭后只显示 24 个英文词。
- 文件：`auth-gate.js` 的 `mnemonicMarkup`；`auth-gate.css` 的 `.warmyAuthWordEn` 等。

## 3. 助记词屏的防截屏

### 3.1 已做

- **系统级截屏保护**：`BrowserWindow.setContentProtection(true)`（Windows `WDA_EXCLUDEFROMCAPTURE`，macOS `NSWindowSharingNone`）。
  - 主进程 IPC：`warmy:authScreenProtect`；
  - 渲染层在 `mnemonic-register / mnemonic-reminder / recover / viewer / login / pin-setup` 时请求开启，离开后关闭；
  - 返回 `supported:false` 时不假装已保护。
- **失焦即隐藏**：`blur` / `visibilitychange` 时助记词换成「已隐藏助记词 · 点击显示」；回到窗口必须主动点一下才显示。10 个语言包都有提示文案。
- 原有“关闭后清空 DOM、不把明文助记词留在隐藏节点”保持不变。

### 3.2 边界（必须如实说）

- 它挡的是**常规截屏/录屏/截图工具**；挡不住同机恶意程序、带外摄像头、远程桌面底层采集、系统级屏幕读取器。
- 本轮实测：Electron 自己的 CDP `Page.captureScreenshot` 仍能截到内容（`isContentProtected()` 为 true），所以这不是“绝对防读取”。
- Linux 可能不支持该 API；代码会返回 `supported:false`，不会假称成功。
- 想更强只能靠 OS/硬件级安全显示、分次显示、外部纸笔；普通桌面应用无法承诺“任何程序都读不到”。

## 4. 短记忆：不再回写知识库

- 删除短记忆条目时**不再** `knowledge.internal.addEvent('短记忆溢出')`。内容本来就来自知识库，删除只删短记忆副本。
- 为满足“知识库应包含短记忆中所有内容”：更新时若发现老短记忆条目没有对应知识事件，会按内容敏感度补写一次（`laiYuan: 'short-memory:migrate'`）；写不进去（群聊里的私密内容）就保留并审计，不降层硬塞。
- 文件：`electron-main.ts` 的 `yaSuoDuanJiYi` / `guiNaDuanJiYi`。

## 5. 使用频率：会话时间线窗口 + 时间衰减 + 共享层 3/5

### 5.1 已实现口径

- 知识事件新增 `useLog`（最近 64 次被 `knowledge_query` 命中的时间戳），不再只有 `useCount/lastUsedAt`。
- **窗口**：
  - 会话内容：最近 **1000 个有对话的活跃日**；允许跨过无对话空档，但日历跨度最多 **2000 天**；
  - 超过 2000 天仍不足 1000 活跃日时，退化为“会话内实际存在的活跃日 + 世界真实时间最近 1000 天”（`capped=true`）；
  - 非本会话（共享 session 层）内容：按真实今天最近 1000 天。
- **排序分**：不是简单次数，而是时间衰减使用分  
  `score = Σ 0.5^(距今天数 / 180)`  
  （180 天半衰期；会话内容按会话最后对话日算，共享内容按真实今天算）。
- 新增时按 score 降序；压缩时删 score 最低的；同分再比 lastUsedAt。
- **共享层上限**：来自 `session` 层（所有会话共用）的条目最多占本会话短记忆的 **3/5**；`internal/private` 不受此比例限制。
- **要点去重**：读取本会话最新归档摘要的 `bullets/decisions/todos/risks`，短记忆新增和已有条目都不得与它们重复（已有重复条目会被清掉）。
- 文件：`knowledge-base/src/index.ts`（useLog）、`electron-main.ts` 的 `huiHuaShiJianChuang / duanJiYiShiYongFen / guiNaDuanJiYi / yaSuoDuanJiYi / duBenHuiHuaYaoDian`。

### 5.2 对用户原公式的评价

用户提出的 `排序因数 = (使用次数 + 距今天数) / 距今天数 = 1 + 次数/距今天数`：
- 优点：简单、不会除零（若 age>0）、同时考虑次数和最近性。
- 问题：
  1. 分母是“距最后一次使用”，不是观察窗口；100 次在 100 天前和 1 次在 1 天前会得到接近的分数（约 2），不能区分持续高频与一次性。
  2. 没有衰减/窗口；很久以前的高频会长期占位，近期一次性使用也可能虚高。
  3. 没有考虑“会话活跃天数”与“真实时间”的差别。
  4. 对少量样本没有先验/置信度，容易被一次偶发命中影响。
- 更好的方案：**时间衰减计数**（本轮采用）+ 可选先验：
  - `score = Σ 0.5^(age/H)`，H=180 天；
  - 可选 `score = (S + α) / (1 + α)`，α=0.5，抑制单次偶发；
  - 若要显式分开“频率”和“新鲜度”，可加 `λ * log1p(n)` 或 `S * (0.8 + 0.2 * recency)`，但参数更多、更难解释。
  - 业界参考：Hacker News 的 `(votes-1)^0.8/(age+2)^1.8` 是幂律衰减；Elasticsearch `function_score` 提供 gauss/exp/linear 衰减；Mem0 2026 的 Memory Decay 用最近访问做 0.3x–1.5x 软重排；Bayesian/Wilson 适合小样本置信度。
- 结论：用户公式可作为“粗排”，不建议作为最终保留/删除判据；本轮采用衰减计数，更容易解释和审计。

### 5.3 一个需要拍板的副作用

严格执行“共享 session 层最多 3/5”后，**群聊/联系人如果只有 session 层可读写，候选全是共享内容，短记忆会一直为空**（第一条共享内容就无法达到 3/5）。
当前按字面严格执行；若要让群聊也有短记忆，需要你选一个例外（见 OPEN-ITEMS-R96）。

## 6. 即时“记住”/踩坑：按内容敏感度分层

- `jiShiXieRu` 改为走 `kbWritable(sid, undefined, 标题+正文)`：
  - 身份证/住址/健康/评价等 → private；
  - 客户/报价/合同/项目等业务 → internal；
  - 公开表达 → session；
  - 不可写层直接拒绝并审计，不降层。
- “记住”识别补充了生气/重复抱怨/反问语义：
  `不记得|忘了|又忘|怎么又|为什么还是|怎么还是|说了多少|每次都要|每次都得|老是|总是|又犯|不是说了|我说过|你是不是|重复`。
- 工具失败/被守卫拦下（包括权限拒绝、禁止路径）现在也会当场记“踩坑”；只跳过用户取消/停止/预算/纯重复。
- 测试：`verify-r96-memory` 13/0 验证 private/internal/session 三档与守卫失败。

## 7. 聊天滚动与操作记录时序（优先项）

### 7.1 滚动

- `scroll` 事件里**同步**判断用户接管（不再等 rAF，避免新回复 IPC 抢在识别前）。
- 记录程序滚动目标 `chatZiGunTop`；重画时若当前位置与目标不一致，补记用户接管。
- 用户接管后：
  - `renderChat` 整块重画恢复原 `scrollTop`；
  - 流式块 `xuanRanLiuShiKuai` 追加前后恢复；
  - `guiNaXingDong` 重排操作行前后恢复；
  - `keepScroll` 也恢复。
- 真机门禁：`verify-r96-live` 在 45% 位置模拟流式追加和最终重画，`scrollTop` 前后完全一致；`verify-r94-ui-live` 28/0。

### 7.2 操作记录时序

- 根因：最终渲染只在 `reasoningDuan.length >= 2` 时生成带 `data-ts` 的 `.siKaoDuanKuai`；**只有一段思考**时退化成无 ts 的 `<pre>`，`guiNaXingDong` 找不到段落，把所有操作追加到末尾。
- 修改：1 段也生成 `.siKaoDuanKuai`；完全无分段时也用带 `data-ts="0"` 的段。操作行按 ts 与思考段混排。
- 真机门禁：单段测试消息的操作行排在思考段之后且带 ts。

## 8. 授权卡过多的原因（实测）

本轮真实测试（模型 `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M`，Ollama）：

- 12 张授权卡：8×`run_shell`、2×`write_file`、1×`make_pptx`、2×`open_path`、1×`read_file`；5 次一次性 grant。
- 任务本身涉及桌面文件、外部 `.lnk` 和自动学习脚本，工作区外操作需要逐文件/逐命令授权，这是产品安全边界，不是“系统坏了”。
- **项目 bug**：`protectedCommandReason` 有一条粗判据“命令里同时出现 appdata + workspace 就拒绝”。模型把临时 PowerShell 脚本写进**当前会话工作区**后执行，被误判为禁止区；模型于是换命令/换工具反复试，增加授权卡。已删除粗判据，保留逐 token 路径解析（其他会话工作区/程序目录仍拒绝）。
- **模型问题**：27B Q4 模型用 `run_shell` 做大量小步骤（读快捷方式、查脚本、写临时 ps1、重复读），没有合并命令；同样的任务用文件工具/一次脚本可以少很多卡。弱模型 + 多步桌面任务 = 卡多。
- **产品选择**：常规授权就是逐文件/逐命令询问，没有“本会话允许工作区内命令”的长期选项；完全授权可以免掉工作区内 shell 卡。是否加会话级命令白名单需要你拍板（默认不建议，风险高）。

## 9. 助记词不能恢复原会话，那它有什么意义？

- 它能恢复**同一把 Ed25519 私钥/同一指纹**：对端/中继认的是这把钥匙；不是新账号。
- 但当前缺 G1（新设备只输助记词不能恢复）和 G2（联系人/群/聊天不随身份走），所以实际可用性接近“新账号”。
- 结论：助记词是**身份连续性的根**，不是数据备份。要让换机有意义，必须做 G1 + G2；否则只能整份复制 profile 或重新配对。
- 旧设备不会因新设备恢复而失效（G4）；换证/备份导入与 vault 不一致（G5）。

## 10. 验证

- 新增 `dev/gates/verify-r96-ui.mjs`：35/0
- 新增 `dev/gates/verify-r96-memory.mjs`：13/0（真 Electron + 临时 profile）
- 新增 `dev/gates/verify-r96-live.mjs`：16/0（首启 UI + 单段时序 + 流式/重画滚动）
- 回归：
  - `verify-r94-ui` 27/0、`verify-r94-ui-live` 28/0
  - `verify-r67-firstrun` 80/0、`verify-r68-auth-ui` 47/0、`verify-r78-scroll` 6/0、`verify-r81-ui` 20/0、`verify-r67-chat-order` 20/0
  - `verify-r92-live` 20/0、`verify-r92-duanjiyi-yaoqiu` 42/0、`verify-r93-memory-security` 39/0
  - `verify-r53-tishangxian` 81/0、`verify-r52-layers` 54/0、`verify-prompt-layers` 31/0、`verify-r82-r103` 18/0
  - `verify-i18n-locales` 162/0、`verify-work-tools` 59/0、`verify-renderer-scope` 9/0、`verify-ipc-probe` 46/46

## 11. 首启交付

- 真实 profile：`%APPDATA%\@warmy\app-shell`（删除前已备份到系统临时目录）。
- 交付状态：`setupDone=false`、`privacyConsent=false`、`providers=0`、`instances=0`。
- 源码 Electron 启动，停在首启语言页；未签名打包 exe 仍受本机 Device Guard 限制（U4）。
