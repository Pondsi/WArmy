# 第 41 轮交接（2026-10-19）

> 本文档是第 41 轮**新增**内容；上一轮的完整台账仍在 `HANDOFF-NEXT.md`（不要覆盖它）。
> 本轮**没有**完成 21 项里的全部内容 —— 下面「已完成 / 未完成」分开写清，新窗口请从这里接着做。

---

## 0. 一句话现状

本轮交付 **8 项**（含 1 个新硬门禁、1 个回收站子系统、4 个真机缺陷修复），**13 项未完成**。
所有改动已 `tsc -b` 通过、`copy-assets` 已跑、6 个核心门禁全绿、并用 CDP 在**真实运行的应用**里逐项验证过。

---

## 1. 已完成（有代码 + 有验证）

| 项 | 落点 | 验证方式 |
|---|---|---|
| **T17 删除心跳设置界面** | `renderer/app.js`：删掉 `data-sec="xintiao"` 导航与两个区块；`secIds` 去掉 `xintiao`；`groups` 缺键导致"每个分区都显示心跳"的根因一并消除 | CDP 读取设置导航 = 界面/通知/模型/功能/技能/工具/插件/门禁/快捷/拟态/赞助/关于（**无心跳**） |
| **T12 分类模型标签「决策」→「分类」** | `i18n/*.json` 10 个语言包的 `model.chip.decision` / `model.kind.decision` | `verify-i18n-locales` 158 ok / 0 FAIL |
| **T11/T13 分类模型判错 + clef 未知** | `electron-main.ts`：`CAPS_VERSION` 2→3；口径不符时把 `fenLeiChain` 收敛回 `fenLeiManual`；`modelCaps` 重算 | 磁盘 `modelCaps` 里 `orcarouter/*` 的 `kind=decision`、`clef=unknown` 都是旧口径产物；版本迁移后下次拉取模型按新规则重写 |
| **T1 新默认头像** | `icons/avatars/user-default.svg` 第 4 版：向内收卷的连续缎带 + 薄荷细弧 + 珊瑚短弧 + 金色圆核；四色（象牙/珊瑚/薄荷/金）+ 深夜蓝底；无五官/服饰/象征 | 渲染成 PNG 目视确认；CDP 加载 `naturalWidth=100` |
| **T14 供应商模型右键设置窗只看到黑遮罩** | **根因**：`.shouDongMoXingTan` 节点直接挂在 `<body>`，但**两份 CSS 里都没有任何定位样式** ⇒ 被 `z-index:12000` 的遮罩整块盖住。已在 `app.css` + `renderer.css` 补 `position:fixed; z-index:12001;` 居中卡片；并修正深底浅字导致的"空按钮" | CDP 实测：`z=12001 / fixed / 560×584 / 背景 #f5f5f5`，按钮文字可见；截图确认 |
| **T19 授权卡按钮文字不对齐** | 两份 CSS：`.shouQuanCheXiaoXiao` 改 `inline-flex + align/justify center + line-height:1.2 + min-height:22px` | `verify-css-consistency` 6 ok / 0 FAIL |
| **T8 最近删除（48h 可恢复）** | 新增 `packages/app-shell/src/trash-store.ts`（纯 Node，可单测）；`electron-main.ts` 在删除**之前**快照名字/摘要/payload；IPC `laJiJiLu` / `laJiLieBiao` / `laJiHuiFu` / `laJiYongJiuShanChu`；`preload.cjs` 暴露；设置「关于」底部 `#laJiQu` 折叠区（默认收起） | 单测：add→list→摘要截断 140→purge→空；**在线** IPC 实测 `add=true, n=1, previewLen=140, purge=true, left=0`；CDP 确认区块折叠且为关于卡最后一个子节点 |
| **T9 右击删除免二次确认** | `app.js`：牛马右键删除直接 `sessionDelete(mode:'purge')` 并带 `name/payload` 存回收站；群/项目/联系人右键删除先 `laJiJiLu` 再解散 | 代码路径已改；`verify-wiring` 238 通过 / 0 失败 |

### T2 / T3 / T4 硬门禁与软门禁

新增 `packages/app-shell/src/gate-policy.ts`（纯函数，11 条断言全过）：

* **4 条硬门禁**：A（可复用能力必须落成 skill/门禁/插件）、B（所有任务进计划任务）、C（后台任务制度）、**D（新增：软门禁不得与硬门禁冲突）**；每条都带 `zuiHuai`（最坏情况）文案。
* `ruanMenJinChongTu()`：按「否定词 + 目标短语」同句共现判定冲突，避免把"不得只留在聊天里"误判成冲突。
* `panDuanRuanGai()`：**冲突优先（100% 必须改、无需三论证）→ 用户明确要求 → ≥3 条互不相同论证且替代方案置信度全部 <50% → 拒绝**；放行时必返回告知文本（改了什么/好处/风险/是否恢复）。
* `builtin-rules.ts` 新增 `MENJIN_D` 并拼进 `CHANPIN_MENJIN`；`electron-main.ts` 把 `yingMenJinTiShi()` 注入系统提示（模型必须能报出"是哪一条 + 最坏情况"）。
* IPC：`menJinYingQingDan` / `menJinRuanJianCha` / `menJinRuanShenQing`。

在线实测：`ids=[A,B,C,D]`；`硬门禁可以被软门禁覆盖` → `chongTu=true, mingZhong=[D]`；只有 1 条论证 → `yunXu=false, 论证不足`。

> **仍未做的（重要）**：软门禁**落盘入口**尚未接到这套裁决上（现在只有 IPC 与提示词层）。
> 下一步：在"保存软门禁"和 work 工具 `write_file` 写入门禁目录处调用 `menJinRuanShenQing`，
> 拒绝时把 `gaoZhi` 原文返回给模型/用户。

---

## 2. 未完成（13 项）

| 项 | 现状 / 卡在哪 | 建议下一步 |
|---|---|---|
| T5 MCP 桥接插件 | 未开始。插件系统是"扫描目录 + `warmyPlugin` 标记"，默认目录 `userData/scan-dirs/plugins`（当前为空） | 写 `mcp-bridge/plugin.json` + `index.mjs`（stdio JSON-RPC：initialize / tools/list / tools/call），播种到默认目录，`enabled:false` |
| T6 Cron 时区 / 活跃时段 / 分身执行 / 事件触发器 / checkpoint / 额度联动 | **仅调研结论**（见 §3），无代码 | 复用 `xin-tiao.ts` 的到期闹钟；`cron-parser` 计算 IANA 时区下一次触发；分身卡走 `subagents.ts` |
| T7 定时任务按会话归属 + 删除级联 | 未开始。`scheduled-tasks.json` 目前是全局数组 | 给任务加 `sessionId`；删除会话时级联删任务并二次确认 |
| T10 nm 文件插件（多格式查看/编辑 + 多窗口吸附） | **未开始**。注意 `nm-wen-jian.ts` 是 `.nm` 加密包，**不是**这个插件 | 新建 Electron `BrowserWindow` 池；文本编辑用 textarea/CodeMirror；docx/xlsx/pptx 用现有 `doc-extract.ts`/`office-tools.ts` 抽文本；吸附＝窗口坐标联动 + `setBounds` 等高 |
| T15 微信 iLink ClawBot | 未开始。第 38 轮记录过"二维码内容不是图片"，本轮未触碰 | 先确认扫码回调与 `qrcode_img_content` 的真实返回，再补"已连接"提示与消息回灌 |
| T16 思考链与操作记录交替 | **已有实现但用户仍报不对**（第 38 轮做过 `.siKaoDuanKuai` 分段，`guiNaXingDong` 按 `data-ts` 插入） | 断点：`renderChat` 是否真的产出多段 `<pre data-ts>`；流式期间 `reasoningDuan` 是否持续追加 |
| T18 等待 30 秒实际更久 + 资源管理器忙 | **已完成分析**（见 §3），未改代码 | 见 §3 结论：计时源已经是心跳，超时来自模型多轮往返；资源占用来自 OpenClaw 网关进程，不是 WArmy |
| T20 连续 5 次验收 | **只完成 1 轮**（6 个核心门禁全绿） | 需要 3 轮本轮 + 2 轮全项目；`run-verify-22.mjs` 可用，但全量耗时长 |
| T21 交接文档 | 本文档 | 新窗口继续 |
| 其余 | — | — |

---

## 3. T18 结论（用户点名"本轮测试"）

**问：牛马是不是等得比 30 秒久？**
是，但**不是计时器不准**。`wait_seconds` 已经走心跳：`keng.dengDai(miao)`，返回 `jiShiYuan:'xin-tiao'`，并实测 `waitedMs`。
审计里那一轮是 **24 轮 / 28 次工具调用 / 689 秒** —— 用户感知的"超过 30 秒"来自 ① 模型把 30 秒拆成多次 `wait_seconds`；② 每轮模型思考 + 工具往返的固定开销；③ 收尾还要写 6000 字小说。

**问：用心跳计时会更好吗？**
会，而且**已经这么做了**（第 40 轮 + 本轮复核）。心跳的到期闹钟把触发夹到真正那一秒，中断时还能撤销等待；裸 `setTimeout` 做不到。
但它**不会**把"模型多跑几轮"变快 —— 那是额度/轮次策略的事。

**问：资源管理器为什么一直忙？**
实测：`electron` 全部子进程 CPU 0%，占用 98% CPU 的是 **OpenClaw 网关（node.exe, 2.4GB）**，也就是跑这轮任务的宿主，不是 WArmy。
WArmy 侧只有常驻子进程（memory-runtime / instances）在待命。**结论：不是本项目的泄漏。**

---

## 4. 本轮改动文件清单

新增：
- `packages/app-shell/src/trash-store.ts`
- `packages/app-shell/src/gate-policy.ts`
- `C:/wbuild/docs/HANDOFF-R41.md`（本文）

修改：
- `packages/app-shell/src/electron-main.ts`（trash 实例/快照/IPC；gate IPC；CAPS_VERSION=3 + 链迁移；注入硬门禁提示）
- `packages/app-shell/src/preload.cjs`（6 个新通道）
- `packages/app-shell/src/builtin-rules.ts`（MENJIN_D）
- `packages/app-shell/src/renderer/app.js`（删心跳设置区；右键删除免确认；回收站 UI）
- `packages/app-shell/src/renderer/app.css` / `renderer.css`（额度弹窗定位与配色、授权按钮对齐、回收站样式）
- `packages/app-shell/src/renderer/icons/avatars/user-default.svg`（第 4 版）
- `packages/app-shell/src/i18n/*.json`（10 个语言包的分类标签）

---

## 5. 复现与验证命令

```bash
cd packages/app-shell && npx tsc -b && node scripts/check-syntax.mjs && node scripts/copy-assets.mjs
node packages/app-shell/scripts/verify-css-consistency.mjs
node packages/app-shell/scripts/verify-i18n-locales.mjs
node packages/app-shell/scripts/verify-no-empty-catch.mjs
node packages/app-shell/scripts/verify-import-integrity.mjs
node packages/app-shell/scripts/verify-wiring.mjs
node packages/app-shell/scripts/verify-renderer-scope.mjs
```

> ⚠️ `copy-assets.mjs` **不会**复制 `preload.cjs`；改过 preload 后必须手动 `Copy-Item src/preload.cjs dist/preload.cjs`（本轮踩过：dist 里是旧 preload，新 IPC 全部 `undefined`）。

---

## 6. 程序当前状态

* 应用**正在运行**（带 `--remote-debugging-port=9222`），已加载本轮新代码；`setupDone` 仍为已有会话状态，**不是首启**。
* 收尾要求（删除配置、关闭程序、以首启状态重开）**尚未执行** —— 因为 T20 的五轮验收还没做完，先保留现场给下一个窗口。
* 回滚：本轮无破坏性数据迁移；`trash.json` 可整文件删除，`settings.json` 里 `modelCapsVersion` 可改回 2。
