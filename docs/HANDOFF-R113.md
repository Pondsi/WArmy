# 第 113 轮交接：思考与执行 / 悬停操作 / 斑马头 / 定时导出保留

## 0. 结论

第 6–11 项已完成。`verify-r113-ui` 17/17、`verify-r113-export-retention` 7/7，fast 档 **126 项次 0 红**；R106 23/23、R107 29/29、R101 92/92、R48 10/10 回归通过。

## 1. 改动

### 1.1 执行过程改名

- `chat.actionLog` / `chat.thinking` / `thinkingDone` 改为「思考与执行」；`chat.actingNow` 改为「进行中...」；段无障碍名称改为「思考与执行第 N 段 · M 个操作」。
- 10 个语言包同步更新；旧「执行过程」不再出现在界面文案。

### 1.2 思考与执行 / 中间回复的悬停操作

- 每个 `guoChengDuan` 和 `zhongJianKa` 内新增 `.guoChengCaoZuo`：
  - 模型名（消息模型；流式阶段取当前路由模型）
  - 完整时间（年月日时分秒，走 `TZ.full`）
  - 赞 / 踩 / 朗读 / 引用 / 复制，复用最终回复的按钮与事件委托
- 默认 `opacity:0`，悬停该条内容时 `opacity:1`；中间回复默认展开，思考与执行段展开后可见。
- 赞踩事件支持从 `data-vote-model` / `data-vote-text` 取内容，避免误取最终回复正文。

### 1.3 计划任务标题单行

- `#jiHuaKaiGuan { white-space: nowrap; min-width: 0; }`，标题 span `flex: 0 0 auto`；默认宽度下「计划任务」一行显示。

### 1.4 最终回复斑马头

- 复制 `F:\XXZ\斑马头.svg` 到 `packages/app-shell/src/renderer/assets/zebra-head.svg`。
- 最终回复外层 `.zuiZhongHang` 内、白色 `.bubble` 外右侧显示 `.banMaTou`；18px、主题色 `--accent`、`scaleX(-1)`、CSS mask 着色。
- 只有存在思考分段或中间回复时才显示；纯最终回复（无思考/无中间回复）不显示，避免与牛头位置冲突；微信入站卡片不包裹该图标。

### 1.5 定时导出任务号 / 旧包清理

- `DingShiDaoChu` 增加 `scheduleId`（固定任务编号）和 `copies`（默认 1，允许 0）。
- 设置弹窗生成并保存 `scheduleId`；旧配置首次打开生成，之后不改任务就复用。
- `.nm` v2 头增加明文可读 `scheduleId`；`inspectNmPackage` 无需解密即可读。
- 每次定时导出成功后，扫描目标目录下**所有 `.nm`**（不只当前任务），按包头 `createdAt` / 文件 mtime 倒序保留最新 `copies` 份（新文件必留），删除其余；`copies=0` 不检查/不删除，每次新增。
- `scheduleId` 仍写入包头并用于审计，但保留数量按“目录下所有 `.nm`”计算；清理失败如实计入 partial/审计。

### 1.6 副本数 UI

- 定时导出弹窗新增「同时存几个副本」数字输入：默认 1、最小 0、整数；0 = 不检查，每次保留新文件。
- 保存后 `dingShiDaoChuGet` 回读 `scheduleId` 和 `copies`，门禁验证落盘。

## 2. 验收

| 门禁 | 结果 | 覆盖 |
|---|---|---|
| `dev/gates/verify-r113-ui.mjs` | **17/17** | 改名/进行中、过程与中间回复悬停操作（模型/完整时间/5 个按钮）、斑马头显示/隐藏/翻转、计划任务单行、副本输入与保存落盘 |
| `dev/gates/verify-r113-export-retention.mjs` | **7/7** | .nm 明文 scheduleId、copies 默认/0/负数、目录下所有 .nm 保留 N |
| `verify-r106-interim-ui` | **23/23** | 中间回复折叠/展开/重绘保持；定时导出/导入分类 |
| `verify-r107-export-schedule` | **29/29** | 定时导出配置/执行/跳过/锁仓/partial/选择性 |
| `verify-r101-changes` | **92/92** | 历史回归 |
| `verify-r48-zhongjian-ui` | **10/10** | 中间回复真实 mock 模型与重启 |
| fast 档 | **126 项次 0 红** | 全量静态 + Electron 快档 |

## 3. 明确边界

- 悬停操作条的模型名：**新数据**在 `reasoningDuan` / `zhongJian` 条目里记录实际模型；**历史数据**没有逐段模型字段，回退到该条消息/当前路由模型（不伪造）。操作按钮与最终回复共用现有事件与安全边界。
- 保留策略会参与目录下**所有 `.nm`**（包括其它任务、手工包、没有 `scheduleId` 的旧包），这是用户第 11 项口径；`copies=0` 才完全不清理。
- `copies=0` 与第 10 项“同任务删旧”是互斥口径：0 明确表示不检查、不删。
- 斑马头依赖外部 SVG mask；若资源缺失，图标不显示但不影响回复。
- 其余 R111 边界（全量加密第二阶段、真实第二设备、真实 TTS/画图/视频、进程隔离、外部项目目录明文）继续有效，见 [`HANDOFF-R111.md`](./HANDOFF-R111.md) §3。

## 4. 当前交付

`release/win-unpacked/WARMY.exe` 已用最终源码重建（`scripts/sync-unpacked.mjs`）并启动到「隐私与使用条款」页；截图 `<临时目录>/warmy-r113-final-firstrun.png`。最终 fast 档 **126 项次 0 红**（含 `verify-r113-export-retention`）；`verify-r113-ui` 17/17。本轮未重新发布 GitHub Release。

## 5. 改动文件

- `packages/app-shell/src/renderer/app.js`
- `packages/app-shell/src/renderer/app.css`
- `packages/app-shell/src/renderer/assets/zebra-head.svg`（新）
- `packages/app-shell/src/data-vault.ts`（.nm header `scheduleId`）
- `packages/app-shell/src/export-schedule.ts`（目录下所有 .nm 保留 N 份）
- `packages/app-shell/src/settings-store.ts`（`scheduleId` / `copies` 类型与默认）
- `packages/app-shell/src/i18n/*.json`（10 包）
- `dev/gates/verify-r113-ui.mjs`、`verify-r113-export-retention.mjs`（新）
- `dev/gates/run-verify-22.mjs`、`verify-r101-changes.mjs`、`verify-round35-*`、`r105-live-5-rounds.mjs`（标签适配）
