# 第 112 轮交接：第四列卡片 / 话筒光标 / 整理特效 / 中间回复折叠

## 0. 结论

本轮 5 项 UI/交互改动已完成。`verify-r112-ui` 19/19 通过，`verify-r110-voice-ui` 10/10、`verify-r106-interim-ui` 23/23 回归通过。未改主进程协议、数据格式或安全边界。

## 1. 改动

### 1.1 第四列卡片去掉三点拖拽手柄

- 删除 `ensurePanCardDrag()` 里动态创建的 `.kaTuoBa` 按钮及其 CSS。
- 保留标题行拖拽（`h3` / `.mianBanKaiGuan` / `.mianBanBiaoTi` / `.aiqBiaoTi` / `summary`），卡片上面部分仍可移动。
- 自定义卡片有 `h3`，仍可拖。

### 1.2 授权卡「添加」靠左

- `#shouQuanKaiGuan > span:first-of-type` 从 `flex:1 1 auto` 改为 `flex:0 0 auto`。
- 「添加」紧跟“授权”（gap 6px），箭头继续 `margin-left:auto` 靠最右。
- 两份 CSS（`app.css` / `renderer.css`）同步。

### 1.3 话筒与下拉箭头更紧

- `.yuYinDd` 左移从 `-12px` 改为 `-13px`；箭头按钮 20→18px、图标 16→14px、高度 30→28px、透明度 .86。
- 实测图标间距 ≤2px（`verify-r112-ui` 量的是 SVG 边界，不是按钮盒）。

### 1.4 语音按光标插入 + 结束即特效

- 新增 `shuRuGuangBiaoWei`：用户点/键/选中输入框时记住真实光标；点话筒时从该位置开始，**没碰过输入框才追加到末尾**。
- 新增 `yuYinChaRuJieGuo()`（`window.__yuYinChaRuJieGuo` 供门禁用）：
  - 同一光标锚点：只替换自己上次插入的语音片段，避免“第一句第一句第二句”；
  - 用户点/键到新位置：旧片段原样保留，只把“上次识别之后新增的后缀”插入新光标；
  - 不删除用户选中的文字，不覆盖用户手动输入。
- 点话筒结束录音时，`yuYinJieShu()` 调 `yuYinZhengLiTiQianKai()`：勾选“重组语言”且有整理模型时，**在等最终转写的同时就挂上整理特效**；最终转写到达后直接复用同一特效，不闪一下重来。
- 未勾选重组/无整理模型/没有可整理内容时不提前亮；最终没有转写成功（`youZhuanXie===false`）会收掉提前特效，不改已有文字。

### 1.5 整理特效更快、更明显

- 逐字亮光改成 JS 随机调度：每 120ms 点亮 3–10 颗新字，单颗 0.5–0.8 秒后恢复；不再用无限 CSS 呼吸。
- 初始点亮约 14%（上限 14 颗），基础文字颜色更偏主题色，发光 10px；外层描边/光晕、汇聚光点（26 颗、alpha 上限 0.5）加强。
- `prefers-reduced-motion` 下只保留静态亮字，不启动随机计时器。
- 长文（>6000 字）保留整段淡光 + 2 秒呼吸，不逐字建节点。

### 1.6 中间回复：去掉标签、一行折叠、展开全文

- `summary` 不再写“中间回复”，改为 `zhongJianZhaiYao(e.text)`：去 Markdown 标记后的内容摘要。
- 折叠态：`summary` 单行 `nowrap + overflow:hidden + text-overflow:ellipsis`，只显示一行。
- 展开态：`summary` 变成右上角一个小箭头（用于收回），摘要隐藏，`.zhongJianHuiFu` 直接显示完整 Markdown 正文。
- 默认仍 `open`，保持“中间回复默认展开”的既有口径；用户手动折叠/展开状态重绘后保留（沿用原 `data-key` 机制）。

## 2. 验收

| 门禁 | 结果 | 覆盖 |
|---|---|---|
| `dev/gates/verify-r112-ui.mjs` | **19/19** | 无手柄；授权添加靠左；话筒箭头 ≤2px；中间回复无标签/一行省略/展开全文；语音初始光标/同锚点替换/换锚点增量；亮字切换与发光；点话筒结束提前特效接线 |
| `verify-r110-voice-ui` | **10/10** | 整理只读、特效 DOM/尺寸、真实输入无效、取消恢复、完成音一次 |
| `verify-r106-interim-ui` | **23/23** | 12 条中间回复、折叠/展开/重绘保持、定时导出/导入分类（顺带修了 R111 后的旧选择器） |
| `verify-r48-zhongjian-ui` | **10/10** | 真实 mock 模型：中间回复落地、时间顺序、重启保留（补 auth bypass 与列表选择） |
| `verify-r65-mic-lifecycle` | **12/12** | 短录音/预览/失败/设备/异常释放（harness 适配新的按光标插入） |
| fast 档 | **1 遍 × 125 项次，0 红** | 全量静态 + Electron 快档 |

打包/首启：`release/win-unpacked/WARMY.exe` 已用最终源码重建；启动到「隐私与使用条款」页（截图 `<临时目录>/warmy-r112-firstrun.png`）。

## 3. 未完成 / 边界

本轮没有新增数据/安全边界。R111 已知边界继续有效（全量加密第二阶段、真实第二设备、真实 TTS/画图/视频供应商、进程隔离、外部项目目录明文等），见 [`HANDOFF-R111.md`](./HANDOFF-R111.md) §3。

## 4. 改动文件

- `packages/app-shell/src/renderer/app.js`
- `packages/app-shell/src/renderer/app.css`
- `packages/app-shell/src/renderer/renderer.css`
- `dev/gates/verify-r112-ui.mjs`（新）
- `dev/gates/run-verify-22.mjs`（登记 LIVE）
- `dev/gates/verify-r48-zhongjian-ui.mjs`、`dev/gates/verify-r106-interim-ui.mjs`（适配新中间回复/导入选择器）
