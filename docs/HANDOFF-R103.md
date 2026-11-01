# 第 103 轮交接（2026-10-28）：10×10 验收 / 4K 高 DPI / 签名与公证

> 本轮用户点名：7. 连续 10×10 验收（A：10 项目 × 10 轮，本轮开始）；8. 4K/高 DPI（联网调研后自行决定并完成）；9. 代码签名/macOS 公证，查最新免费或绕过限制的合规方案。
> 未完成/需协助见 [`OPEN-ITEMS-R103.md`](./OPEN-ITEMS-R103.md)，签名详表见 [`SIGNING-R103.md`](./SIGNING-R103.md)。

---

## 1. 10 项目 × 10 轮真实验收

### 1.1 设计与改动

基于 R98 的 10 牛马 × 5 项目 × 10 轮 harness，新增 [`dev/gates/verify-r103-ten-by-ten.mjs`](../dev/gates/verify-r103-ten-by-ten.mjs)：

- **10 个项目 × 每项目 10 轮**（共 100 个项目轮次）；
- **只用 MiMo + 本地 Ollama**：脚本只从本地 key 文件提取 MiMo token，不提取/不使用 DeepSeek key；
- 10 只牛马：5 只 MiMo **pro**（执行者）、2 只本地 9B、3 只本地 27B（纯调度/值班）；
- 每项目 5 只成员：3 只 MiMo pro 可执行 + 2 只本地模型纯调度/值班；每轮 1 个值班 + 2 个执行者；
- **2 个项目一批**（`WARMY_R103_BATCH`，默认 2），避免 20 个执行者同时打爆本地 27B 或触发云端限流；
- 保留 R98 的断言：真实产物、项目知识库验收码、任务黑板、上下文压缩、提示词压缩、对话历史、重启恢复；
- 供应商瞬时故障（429/5xx/超时）原样重派最多 3 次，重派次数会被记录，不掩盖产品异常。

### 1.2 运行状态

```bash
cd <repo>
node dev/gates/verify-r103-ten-by-ten.mjs
# 可选：WARMY_ACCEPT_RUNS=1 WARMY_R103_BATCH=2
```

运行结果见下方“结果”（本文件随跑随更新）。若失败，失败 profile 与审计尾部会写到 `%TEMP%\warmy-r103-failure-*.json`，修复后从第 1 轮重跑。

**第三次运行（正式结果）**：**10 轮全部 10/10 项目通过**，单轮 148.0–300.7 秒，累计 1990.3 秒（约 33 分钟），共 **3585 条断言 0 红**；结束后重启应用，10 个项目的历史与 5 名成员全部恢复，验收日志 `chat.history.restore` ≥20 条；10×10 使用临时 profile，跑完自动删除，未触碰真实 profile。

轮时明细（秒）：`300.7 / 193.7 / 191.3 / 192.2 / 181.1 / 211.9 / 148.0 / 182.6 / 187.9 / 196.6`。

**前两次失败定性**（均已修测试脚本，不是产品缺陷）：
- 第一次：R1–R8 全绿，R9 项目 I 因门禁把“说产出了但没找到”的警告行当成冒充真产物（产品实际正确标注了未核实路径），修正判据后重跑。
- 第二次：R1 通过，R2 项目 B 因 MiMo flash 执行者只回正文、不调用写文件（`laiYuan: zheng_wen`），项目级重派 3 次仍无产物；应用如实暴露“无产物”。执行者统一改为 MiMo **pro** 后，第三次 10 轮全绿。

**结论**：10 项目 × 10 轮 = 100 个项目轮次，真实产物、项目知识库验收码、黑板、上下文压缩、提示词压缩、对话历史、重启恢复全部通过；0 执行器错误、0 产品红。

### 1.3 Fast 门禁三连

`node dev/gates/run-verify-22.mjs --times=3 --tier=fast`：3 遍全部通过，**每遍 119 项、共 357 项次，真红 0 · 已知红 0 · 缺文件 0**（含本轮新增的 `verify-r103-4k-static`）。三遍跑完后按用户指示不再追加测试。

---

## 2. 4K / 高 DPI

### 2.1 调研结论

先核对了 Electron 40 / Chromium 144 与 Windows 高 DPI 的最新文档，关键结论：

- Electron 仍是 **DIP（device-independent pixels）模型**：CSS px = DIP；4K@200% 的逻辑视口是 **1920×1080**，不是 3840×2160；4K@150% 是 2560×1440。现有 `@media(min-width:3200px)` 只覆盖 4K@100%/超宽，不能把 3840 当 4K@200%。
- 不能把系统 `scaleFactor` 再乘进 CSS/zoom，否则 200% 会变成 4 倍物理尺寸；也不要关闭 DPI 感知或 `--force-device-scale-factor=1` 来“修复模糊”。
- 主窗口是自定义无边框标题栏：`#biaoTiLan` 是 border-box 40px，含 1px 下边框后内容 39px，而 logo/按钮写 40px 会溢出 0.5px（200% 下约 1 物理像素）；应统一 token，按钮/logo 高 `calc(--titlebar-h - 1px)`。
- 四列最小宽度数学：`64(rail) + list(176–300) + chat(≥480) + panel(240–420)`；960 宽正好 960。不能把 3840 断点当 4K@200%，也不能整页 `transform:scale`/`zoom` 当 DPI 策略。
- 初始窗口/最小尺寸要按目标显示器 `workArea` 夹紧：1080p@200% 的逻辑高度可能小于 600，固定 `minHeight:600` 会把窗口撑出屏幕。
- 验收：CDP 仿真 4K@200% 应传 `width:1920,height:1080,deviceScaleFactor:2`；4K@100% 传 `3840×2160@1`。原生拖拽/任务栏只能真机另测。

### 2.2 已落地

文件：`packages/app-shell/src/renderer/renderer.css`、`app.css`、`app.js`、`electron-main.ts`

- 新增 `--titlebar-h` token：默认 40px，`@media (min-width:3200px)` 为 46px；
- `#biaoTiLan` 高度、logo 容器/图片、窗控按钮高度都走 token；按钮内容减 1px，消除 border-box 1px 溢出；
- 所有整页高度 `calc(100vh - 40px)` 改成 `calc(100vh - var(--titlebar-h,40px))`；模态遮罩 `top` 同步；
- 4K@100% 额外放大左栏图标、列表行/头像、下箭头，字号档仍由现有 `FS_ZHI_DA`（15/22）与阅读宽度 1320 负责；
- 四列布局新增 **聊天区 480px 硬下限**：960 宽时列表 176、第四列 240、聊天 480；用户拖过的列宽也按此夹紧；
- 初始窗口尺寸/最小尺寸按 `screen.getPrimaryDisplay().workArea` 夹紧（1080p@200% 不再撑出屏幕）。

### 2.3 验收

- `verify-r103-4k-static` **9/0**：token、整页高度、480 下限、workArea 夹紧与负向变异。
- `dev/gates/verify-r103-4k.mjs` **40/0**，五种视口：
  - 3440×1392@100%（本机）：标题栏 46、fs-md 15/fs-xl 22、阅读宽 1320、聊天列充足；
  - 3840×2160@100%：标题栏 46、fs-md 15/fs-xl 22、阅读宽 1320、聊天 3076、无水平溢出；
  - 1920×1080@200%：标题栏 40、fs-md 14、聊天 1280、无重复放大；
  - 2560×1440@150%：标题栏 40、fs-md 14、聊天 1806；
  - 960×600@100%：聊天 480、列表 176、第四列 240、无水平溢出。
- 原生最大化/任务栏由 R102 live 覆盖；本轮没有 4K 物理屏，CDP 仿真不等同于真机 4K 屏，已在未完成项标明。

### 2.4 来源

- Electron 40：<https://www.electronjs.org/blog/electron-40-0>
- Electron screen / Display：<https://www.electronjs.org/docs/latest/api/screen>、<https://www.electronjs.org/docs/latest/api/structures/display>
- Electron 自定义标题栏/窗口交互：<https://www.electronjs.org/docs/latest/tutorial/custom-title-bar>、<https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions>
- Microsoft 屏幕断点：<https://learn.microsoft.com/en-us/windows/apps/design/layout/screen-sizes-and-breakpoints-for-responsive-design>
- MDN devicePixelRatio：<https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio>
- CDP Emulation：<https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setDeviceMetricsOverride>
- WCAG 2.2 Target Size：<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>

---

## 3. 代码签名 / macOS 公证

详见 [`SIGNING-R103.md`](./SIGNING-R103.md)。一句话结论：

- **没有双平台、对个人开源项目完全免费且官方认可的方案**；
- Windows 有 **SignPath Foundation**（合资格 OSS，$0）可走；也可选 Azure Artifact Signing（约 $9.99/月）或 OV 证书；EV 2024 起不再有 SmartScreen 特权；
- macOS 对个人没有免费官方路径：Developer ID + 公证必须 Apple Developer Program **$99/年**；免费 Apple ID 只能本机开发签名；ad-hoc 可在本机跑但**不能公证、不能消除 Gatekeeper 警告**，macOS 15 起右键打开被移除，macOS 26 部分场景无法放行；
- 不建议关闭 Gatekeeper/SIP、伪造签名或公开分发自签名证书；无预算时如实标“未公证/实验性”，给 SHA-256 + 放行说明，不承诺自动更新。

---

## 4. 当前运行状态

- 10×10 已完成：RUN 1/1 PASS，10 轮全 10/10，3585 条断言 0 红，累计 1990.3 秒；临时 profile 已删除。
- Fast 门禁三连已完成：357 项次 0 红；按用户指示不再追加测试。
- 本轮没有使用 DeepSeek key；10×10 只使用 MiMo pro + 本地 Ollama。
- 真实 profile 未删除；4K 验收使用临时 profile，10×10 也使用临时 profile。
- 10×10 结束后已把真实应用重启到最新 4K 构建（同一真实 profile，未删除、未改账号数据）。
- 重启日志出现 `paiShengShiLi ... instance exists`（持久化实例恢复被重复调用）；界面正常加载，本轮未改代码，已记入 OPEN-ITEMS 待下轮确认。
- 未完成项只剩 4K 物理屏目检与签名路线选择（见 OPEN-ITEMS-R103）。

## 5. 校验命令

```bash
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/check-syntax.mjs
node scripts/copy-assets.mjs
node scripts/verify-r103-4k-static.mjs
node scripts/verify-r102-changes.mjs
node scripts/verify-zhi-ban-pai-fa.mjs
node scripts/verify-gate-manifest.mjs

cd ../..
node dev/gates/verify-r103-4k.mjs
node dev/gates/verify-r103-ten-by-ten.mjs
node dev/gates/run-verify-22.mjs --times=3 --tier=fast
```
