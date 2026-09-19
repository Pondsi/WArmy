# WArmy：上下文接近上限 · 知识整理时机 · 聊天记录懒加载 · gateVerify

## 上下文接近上限时我们怎么做

产品内**不会**把超长历史原样塞进模型。机制：

1. **会话日志唯一事实**：`chatLogs` / memory-os `fast-memory.jsonl`（只追加）
2. **注入模型的是有界视图**：`renderBoundedView`（默认预算 `contextBudgetChars`，默认 **4000 字符**）
   - 保留冻结头 + 最近尾部（keepHead/keepTail）
   - 中间被裁掉的部分变成 **指针**：`[已省略 N 条历史，seq a..b] retrieve(seq=…)`
3. **工具解引用**：模型可 `recall`（发现）/ `retrieve`（取回原文），细节不丢
4. **项目 MEMORY**：覆盖式规矩片段，注入时 **≤1200 字截断**
5. **设置**：`contextBudgetChars` 可调（下限 200）

**UI 聊天区永远显示完整真实记录**（不是压缩记忆）。为性能采用懒加载窗口（默认 40 条/次），上滑加载更多；底层 `__msgs` / 日志不删减。

## 知识库何时触发整理

| 触发点 | 动作 |
|--------|------|
| 值班解析看板指令 / 会话事件 | `knowledge.upsertEntity` + `addEvent`（既有） |
| **归档** `warmy:archive-external` | 摘要提炼实体/事件进知识库 + **使用者偏好** 写入 `user-preferences.json` |
| 人工知识库增删 | 设置/右栏知识库 IPC（既有） |
| 项目 MEMORY 保存 | **不**自动进知识库（避免双写）；属当前规矩 |

归档提炼实现：`archive-cleanup.ts` → `extractKnowledgeFromArchive` + `mergeUserPreferences`。

## gateVerify 是什么

- 项目属性里的**验收脚本路径列表**（相对仓库根，最多 4 条）
- **何时跑**：值班收到「完成」看板指令，或消息含「验收/门禁/verify」
- **防过度**：同项目 3 秒节流；空列表则完全不跑
- **建议默认值**（新项目可配置）：
  - `packages/app-shell/scripts/verify-docs.mjs`
  - `packages/app-shell/scripts/verify-i18n-locales.mjs`
  - 代码项目再加：`verify-wiring.mjs` / 相关包测试
- **不建议**：把所有 verify-* 每次对话都跑（慢且无意义）

## 值班语义（已定）

- 任务树：`新建任务 父任务 / 子任务`
- 人类决策：工具/卡片 `askUser`，选项后永远含「其他」
- 门禁：仅 complete/验收 触发

## 决策卡与权限卡

- 同一 **通知区 `#notify-zone`**（消息列表下方）
- 权限卡：工具写盘/命令的 Allow once / project / global
- 决策卡：AI 工作中的选择题（含自定义输入）
- 两者视觉同构（同边框/圆角），语义区分标题

## 首次语言弹窗

- **仅安装后第一次**打开时弹出（`settings.setupDone !== true`）
- 用户关闭/确认后写 `setupDone: true`，之后不再弹
- 重置仅用于开发演示，**发布流程不应写回 false**

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
