# WArmy 操作文档（给其他 AI / 智能体）

> **先读本文件再调用 WARMY 的 IPC / `window.warmy.*`。**
> 设置 → 快捷 →「复制 AI 操作指引」可一键复制本路径说明。

## 如何调用

- 渲染层（桌面 UI 内）：`window.warmy.<apiName>(...args)`
- 主进程 IPC 通道名：`warmy:` + kebab-case（如 `chatSend` → `warmy:chat-send`）
- **形参**以本表为准；返回值多为 `{ ok, ... }` 或数组/对象事实，**失败不静默**
- **R**=只读，**W**=会改状态（请谨慎；不要在未授权时批量调用）

## 产品约束（必须遵守）

1. 容器开发项目：容器未就绪时**禁止**假装在主机上开发。
2. 端口绑定失败**禁止**静默换端口。
3. 看板仅 duty 可写；队列不丢弃。
4. 项目 MEMORY 唯一落点 `project.memory`；勿与 memory-os 流水双写。
5. 聊天 UI 显示完整真实记录；给模型的上下文才是有界视图。
6. 更新源默认可指向 GitHub Releases API。

## 常用路径

| 目标 | 做法 |
| --- | --- |
| 发消息到项目 | `groupOrchestrate({ groupId, content, urgency })` 或 `chatSend` |
| 读项目状态 | `projectState({ sessionId })` |
| 读/写项目记忆 | `projectMemoryGet/Set({ sessionId, memory })` |
| AI 问人类 | `aiQuestionOpen` → 用户点选 → `aiQuestionAnswer` |
| 记忆 | `memoryRecall` / `memoryRetrieve` |
| 更新 | `checkUpdate`；源 `updateSourceSet({ url })` |

## 接口一览

| API | Params | 说明 | 类 |
| --- | --- | --- | --- |
| `hardware` | `()` | 读本机 CPU/内存，给出建议最大牛马数 | R |
| `listInstances` | `()` | 列出本机牛马实例 | R |
| `spawnInstance` | `(cfg: {id,name,dutyEligible?})` | 启动牛马实例 | W |
| `stopInstance` | `(id: string)` | 停止实例 | W |
| `securityMode` | `()` | 读全局安全模式 | R |
| `setSecurityMode` | `(mode: 'full'|'normal'|'strict')` | 写全局安全模式 | W |
| `memoryRecall` | `(q: string | {query,limit?,scope?})` | 记忆检索卡片 | R |
| `memoryAppend` | `(body: string)` | 追加记忆 | W |
| `memoryRetrieve` | `(payload: {seq?, recordId?})` | 取回历史原文 | R |
| `memoryStatus` | `()` | 记忆服务状态 | R |
| `memoryRebuild` | `()` | 重建记忆投影 | W |
| `i18n` | `(locale: string)` | 加载语言包 | R |
| `localeInfo` | `()` | 语言信息 | R |
| `setThemeSource` | `(s: 'system'|'dark'|'light')` | 设置主题 | W |
| `themeInfo` | `()` | 读主题 | R |
| `listModels` | `(cfg: {protocol,baseURL?,apiKey?})` | 拉取模型列表 | R |
| `checkUpdate` | `()` | 检查更新 | R |
| `groupCreate` | `(cfg: {name,type?,directedMode?,devEnv?,directory?})` | 创建项目/群 | W |
| `groupList` | `()` | 列出项目/群 | R |
| `groupMembers` | `(groupId: string)` | 读群成员 | R |
| `groupMessage` | `(msg: {groupId,content,urgency?,userId?})` | 群消息 | W |
| `groupOrchestrate` | `(msg: {groupId,content,urgency?})` | 值班编排 | W |
| `updateSourceGet` | `()` | 读更新源 | R |
| `updateSourceSet` | `(payload: {url: string})` | 写更新源 | W |
| `boardTasks` | `(groupId?: string)` | 看板任务 | R |
| `boardEvents` | `()` | 看板事件 | R |
| `boardAggregate` | `()` | 看板聚合 | R |
| `setProvider` | `(cfg: {presetId,apiKey?,baseURL?,model?})` | 设置供应商 | W |
| `getProvider` | `()` | 读供应商 | R |
| `chatSend` | `(msg: {sessionId,content,urgency?})` | 发送消息 | W |
| `chatLog` | `(payload: {sessionId,mode?,limit?})` | 会话日志 | R/W |
| `chatLogRestore` | `()` | 从记忆恢复日志 | W |
| `checkpointCreate` | `(phase?: string)` | 创建回退点 | W |
| `checkpointList` | `()` | 列出回退点 | R |
| `checkpointRollback` | `(id: string)` | 回滚 | W |
| `knowledgeQuery` | `(q: string)` | 知识库检索 | R |
| `knowledgeAddEvent` | `(ev: {title,body?,groupId?})` | 知识库事件 | W |
| `metricsSummary` | `()` | 指标汇总 | R |
| `metricsTurns` | `()` | 轮次指标 | R |
| `metricsTools` | `()` | 工具指标 | R |
| `settingsGet` | `()` | 读设置 | R |
| `settingsSave` | `(partial: Partial<AppSettings>)` | 合并保存设置 | W |
| `containerProbe` | `(opts?: {force?: boolean})` | 探测容器运行时 | R |
| `containerAction` | `(payload: {id,action:'start'|'stop'})` | 引擎启停 | W |
| `containerShell` | `(payload: {runtimeId,action:'open'|'write'|'close'|'status',sessionId?,data?})` | 容器 shell | W |
| `projectState` | `(payload: {sessionId})` | 项目状态 | R |
| `projectEnable` | `(payload: {sessionId})` | 启用项目 | W |
| `projectDisable` | `(payload: {sessionId})` | 停用项目 | W |
| `projectFiles` | `(payload: {sessionId})` | 项目文件面板 | R |
| `projectEnvStatus` | `(payload: {sessionId})` | 环境固化状态 | R |
| `projectEnvSolidify` | `(payload: {sessionId,explicit?,beforeDestroy?})` | 固化环境 | W |
| `projectEnvRollback` | `(payload: {sessionId,imageRef?})` | 环境回滚 | W |
| `projectLedger` | `(payload: {sessionId,limit?})` | 文件台账 | R |
| `projectMemoryGet` | `(payload: {sessionId})` | 读项目 MEMORY | R |
| `projectMemorySet` | `(payload: {sessionId,memory: string})` | 写项目 MEMORY | W |
| `aiQuestionOpen` | `(payload: {groupId,title,body?,options[]})` | 打开决策卡 | W |
| `aiQuestionList` | `(groupId?: string)` | 列出决策卡 | R |
| `aiQuestionAnswer` | `(payload: {id,optionId,customText?})` | 回答决策卡 | W |
| `skillsList` | `()` | 技能列表 | R |
| `skillsPaths` | `()` | 技能根路径 | R |
| `skillsScanDirsGet` | `()` | 自动发现目录 | R |
| `skillsScanDirsSet` | `(dirs: string[] max10)` | 设置自动发现目录 | W |
| `skillsSetEnabled` | `(payload: {id,enabled})` | 技能启停 | W |
| `uiQueuesGet` | `()` | UI 队列 | R |
| `uiQueuesSet` | `(queues: Record<chatId,items>)` | 写 UI 队列 | W |
| `routerQueuesGet` | `()` | Router 队列快照 | R |
| `identityInfo` | `()` | 身份信息 | R |
| `identityPeers` | `()` | 对端身份 | R |
| `membershipList` | `(payload?: {groupId?})` | 成员凭证 | R |
| `netStatus` | `()` | 组网状态 | R |
| `netPortCandidates` | `(payload: {requestedPort?,want?})` | 候选端口实测 | R |
| `meshEnable` | `(payload: {port?: number})` | 启用组网 | W |
| `meshDisable` | `()` | 关闭组网 | W |
| `peersList` | `()` | 已知节点 | R |
| `peersAdd` | `(p: {host,port,name?})` | 添加节点 | W |
| `executorsStatus` | `()` | 执行者状态 | R |
| `executorsRunBrief` | `(payload: {brief,contextItems?})` | 试跑简报（写执行） | W |
| `setupState` | `()` | 首启 setupDone | R |
| `setupComplete` | `(payload: {locale?})` | 完成首启语言选择 | W |
| `searchMessages` | `(q: string)` | 搜索消息 | R |
| `archiveList` | `(groupId?: string)` | 归档列表 | R |
| `archiveExternal` | `(payload: {groupId,title,summary,anchors?})` | 归档+提炼知识/偏好 | W |
| `lastError` | `()` | 最近主进程错误 | R |
| `clearError` | `()` | 清除错误 | W |
| `platformInfo` | `()` | 平台信息 | R |
| `costSummary` | `()` | 成本汇总 | R |
| `exportSession` | `(payload: {sessionId,title,messages[]})` | 导出会话 | W |
| `checkUpdate / autoUpdateCheck` | `()` | 更新检查（双入口） | R |

## 上下文超限重试语义

- 每次注入的**总预算** ≤ 用户设置的百分比 × 模型窗口（默认 60%，留余地）。
- 若模型报 context/token 超限：自动按 **100% → 60% → 35% → 20%** 收缩重试。
- 到最小值（约 2048 tokens）仍失败 ⇒ **停止重试**，如实告知「该模型上下文太小无法满足当前聊天需求」。
- **群聊**不暴露滑块，由后台自动判断；**联系人**不涉及。
- 预算是**上限**，不是配额：有损压缩/截断/指针在预算充足时给更多余量，但**不把预算用满**。

## 实测说明

开发机上通过 Electron IPC 对只读接口做过探测；结果见 `docs/API-OPERATIONS-RESULTS.json`（若存在）。
写操作请走产品 UI 或在明确授权的自动化脚本中调用，并做 **read-back**。

## 一键复制内容（其他 AI 请使用）

```text
To operate WArmy / 无限牛马:
1) Open docs/API-OPERATIONS.md in the repository root.
2) Use window.warmy.<api> or IPC warmy:* with the params in that file.
3) Respect product constraints (no silent port switch, no fake host edit on container projects).
File path hint: <repo>/docs/API-OPERATIONS.md
```

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
