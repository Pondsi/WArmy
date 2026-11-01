# 第 80 轮交接（2026-10-24）

> 未 commit、未 push。本轮按用户 4 条：首启背景随机单幕、铺满、引导点设置后无法继续、完成可独立完成项。

## 1. 首启牛马背景：本次启动随机一幕、固定不轮播

- 之前：iframe 固定 `scenes=1,2,4,6,9,10&period=12000`，页面内每 12s 轮播。
- 现在：`auth-gate.js` 在模块加载时从 `[1,2,4,6,9,10]` 随机取一幕，写入 `sessionStorage['warmy.firstScene']`；同一次启动内语言切换、登录/注册/恢复各步都用这一幅；进程重启后 sessionStorage 清空，重新随机。
- embed 引擎只在显式 `rotate=1` 时轮播；首启传 `rotate=0`，不会在页面里换幕。
- 门禁：`verify-r78-auth-tour` 纯函数检查随机+固定+单幕 URL；真机检查语言页/条款/登录三步同一 `src` 且帧计数持续增长。
- 结果：`verify-r78-auth-tour` **43/0**。

## 2. 牛马背景铺满界面

- 嵌入 iframe 本来就 `inset:0;width/height:100%`；问题是 canvas 用 `object-fit:contain`，宽高比不一致时上下/左右留白。
- `preview/firstrun-scenes/index.html`：embed 模式给 `<html>` 加 `.embed`，`#scene { object-fit: cover; }`，裁切铺满，不再出现白边。
- 门禁：`verify-r68-firstrun-ui` 读取 iframe 内 canvas 的计算样式，断言 `object-fit === 'cover'`；**24/0**。

## 3. 引导：点“设置”后只能点设置、无法继续

- 根因：第 1 步 `target` 是静态选择器 `#peiZhiDaoHang button[data-sec="model"], [data-nav="settings"]`。`querySelector` 永远先命中页面里更靠前的左侧“设置”，所以跳转后高亮仍停在设置；用户看得到“模型”但点不到（或被 spotlight 误导）。
- 修法：
  - `target` 改为函数：设置页渲染出“模型”分区后优先返回该按钮，否则才返回“设置”；
  - 新增 `window.__yinDaoTargetRefresh()`，漫游层 220ms 心跳在目标变化时重选高亮；页面切换后高亮自动跟到“模型”；
  - 第 2 步同样改成函数（优先“牛马管理局”按钮，其次列表头按钮）。
- 门禁：`verify-r78-auth-tour` 真机点“去设置”→ 等 `.yinDaoGaoLiang` 变成 `data-sec=model` → `elementFromPoint` 命中模型按钮 → 真鼠标点击。**43/0**（连续两遍）。
- 注意：第 1 步仍要求真的添加了可用供应商才能“下一步”（未满足会停在第 1 步并提示）；这是原设计，不是卡死。用户可以“跳过”。

## 4. 可独立完成项

- 新增 `scripts/sync-unpacked.mjs`：不依赖 electron-builder，把 app-shell 与 10 个 workspace 包的最新 dist 同步进 `release/win-unpacked`，同时更新 `resources/warmy/*` 与 `resources/app/node_modules/@warmy/*` 两份副本。解决第 79 轮“打包版缺 `ZHISHI_CENG` 导出”的根因（只同步了 app-shell）。
- **打包工具链已修复**：`pnpm install` 补齐依赖、Electron 缓存恢复后，`electron-builder 25.1.8 --dir` 可正常出包；已用官方流程重建 `release/win-unpacked`，打包版首启冒烟：10 语言、`scenes=4&rotate=0`、截图 `%TEMP%\warmy-r80-package.png`。`sync-unpacked.mjs` 保留为兜底。
- **项目/群聊改名权限**：加入别人的项目/群聊（`joinedByOther`）不再显示“改名”，只有创建者能改；这是 #108 权限矩阵落地前的最保守边界（管理员角色模型未定，不冒充）。
- 仍未做（需要拍板/凭据/设备）：#103 知识库授权、#106 会话网络路由、#108 邀请权限、#109 自动校对、#112-36/37 项目/群设置弹窗与右键分类、#113/#115 飞书钉钉双向/网络 B-A、第 30 轮 A9 拟态运行时、A16 道同源；真实微信扫码/物理话筒/公网双机。详见 `HANDOFF-R79.md` §4 的方案/代价/最坏情况表。

## 5. 验收

- **真实 MiMo + 本地 Ollama**：`verify-r79-ten-rounds` **40/0，连续 3 遍全过**（每遍 10 轮不同任务：对话/写读文件/本地模型/链降级/记忆/计划/nm/UI/重启）。
- **全量 fast 套件**：`scripts/verify-r78-3x.mjs`（16 门禁×3）**连续 3 次执行全部 PASSED**。
- `verify-docs` 95/0；`supervisor-check` self todo 0 / blocked 0。
- 首启截图：`%TEMP%\warmy-r68-firstrun-default.png`、`%TEMP%\warmy-r80-final-firstrun.png`（单幕、cover 铺满、10 语言）。
- 启动包：`release/win-unpacked/WARMY.exe`（官方 electron-builder 重建）。
- 收尾：已关闭程序、真实 profile 备份到 `%TEMP%\warmy-profile-backup-20261024-083318` 后移除；已重新打开**全新首启**（`setupDone=false`），停在语言页待验收。
