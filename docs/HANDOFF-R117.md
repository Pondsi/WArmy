# 第 117 轮交接：全任务审计与“仅 @ai 才发言”接线

## 0. 结论

- 任务台账现有 **315 条全部为 completed**，没有遗漏的 pending/in_progress 任务。
- 本轮审计发现并修复一个真实功能缺口：**群聊“仅 @ai 才发言”只做到设置/持久化/路由判定，发送链路没有把被 @ 成员 id 传下去**，开启后消息会永远静默。现已接通并加门禁。
- 复跑 `verify-history-persist`：**ALL PASS**，把清单里过期的 known-red 改为 green；known-red 从 8 降到 7。

## 1. 审计范围

- 任务列表：315/315 completed。
- `docs/OPEN-ITEMS-*.md`（R98、R100–R106、R116）与 `HANDOFF-R111/R114/R115/R116` 的“未完成/边界/需要你”章节。
- 源码 `TODO/FIXME/未实现/待后续` 标记。
- 门禁清单 known-red、gate audit 与可本地复跑的门禁。

分类结果：
- **已完成/历史描述**：R104 nm 键盘/查找/历史、R115 copyFileSync 已由 R116 完成；R105 分段/5 轮、R111 加密/Kroot/IPC 等已完成；不再重复做。
- **本轮补做**：定向模式接线；history-persist 过期 known-red。
- **仍需外部条件/拍板**：见 `OPEN-ITEMS-R117.md`，不是漏做。

## 2. 定向模式修复

问题链：
1. `renderer/app.js` 的“仅@ai才发言”开关会调用 `groupDirected`，写入 `directedMode`；
2. `GroupChatRouter.route()` 在 `directedMode` 下要求 `mentionIds` 非空，否则 `silent:directed-no-mention`；
3. 但 `deliver()` 调 `groupOrchestrate({ groupId, content, urgency })` 时**没有 mentionIds**；`qunXieTiao` handler 也不接收该字段；
4. 所以开关打开后，所有消息都静默，属于真实断链。

修复：
- `deliver()` 在内部群发送前从 `groupMembers` 读取成员，按 `@昵称`（带边界，避免 `阿甲` 误命中 `阿甲2`）解析 local instanceId，去重后作为 `mentionIds` 传给 `groupOrchestrate`；
- `electron-main.ts` 的 `qunXieTiao` 接收并传递给 `xietiaoQunXiaoxi`，后者原本就把它送进 `router.route()`；
- 保持外部联系人/外部群不误用内部成员 id。

门禁 `packages/app-shell/scripts/verify-r117-directed.mjs` **9/9**：
- 无 @ 静默；
- @ 到阿甲只派阿甲；
- @ 不存在成员静默；
- @ 多个成员派多个；
- 渲染层 payload 带 mentionIds；
- 主进程接收并传递 mentionIds。

## 3. 门禁债处理

- `verify-history-persist`：用 `env -u ELECTRON_RUN_AS_NODE` 真跑，`failures=0 / ALL PASS`；`docs/GATE-MANIFEST.json` 改为 green，`knownRed` 从 8 改 7，总条目因新增 `verify-r117-directed` 从 120 改 121。
- 其余 known-red 仍是测试/环境债，不是产品任务：
  - `verify-e2e` 需要单实例锁空闲；
  - `verify-live-ui` 断言过期、缺 DOM 时把 skip 当 pass，需重写；
  - `verify-mobile-ui` / `verify-net-ui` 需要移动端 CDP / 预览壳；
  - `verify-qr-scan` 12s 等待 flaky；
  - `verify-tool-call-e2e` 桩环境缺 `fenLei` 能力位；
  - `verify-warmy-ipc-probe` harness 里 `ipcRenderer` 未定义；
  - `verify-history-persist` 已清。

## 4. 验证

| 项目 | 结果 |
|---|---|
| fast 档 | **131 项次 0 红** |
| `verify-r117-directed` | **9/9** |
| `verify-history-persist` | **ALL PASS**（真 Electron，临时 profile） |
| `verify-gate-manifest` | 23/23 |
| `pnpm -r typecheck` | 11/11 包通过 |
| `verify-r116-enc-stream` / `verify-r81-nm` | 34/34 / 63/63（fast 内） |

## 5. 改动文件

- `packages/app-shell/src/renderer/app.js`（mentionIds 解析与发送）
- `packages/app-shell/src/electron-main.ts`（qunXieTiao 接收/传递 mentionIds）
- `packages/app-shell/scripts/verify-r117-directed.mjs`（新增）
- `docs/GATE-MANIFEST.json`（新增门禁、history-persist 转绿、counts）
- `dev/gates/run-verify-22.mjs`（fast 清单加入 r117）

## 6. 交付

- `release/win-unpacked` 用最终源码同步；当前运行中的用户窗口需重启后加载本轮新代码（没有擅自关闭）。
- 真实 profile 未删除、未重置。
- 本轮未使用模型 API Key，未发布新的 GitHub Release。
