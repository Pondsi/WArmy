# WArmy：项目记忆 / 任务树 / 决策卡 / 门禁 / read-back / 去重 / Dream

与 MiMo Desktop 模式对齐时的**产品实现原则**（避免重复机制）。

## 1. 项目 MEMORY.md + 恢复注入

| | 项目 MEMORY | memory-os（已有） |
|--|-------------|-------------------|
| 角色 | **当前有效**规矩/目标（覆盖式） | 会话/工具**流水**（JSONL 唯一事实） |
| 落点 | `groups.json` → `project.memory` | `userData/memory/fast-memory.jsonl` |
| 注入 | 值班上下文开头 `[项目记忆]`（≤1200 字截断） | 有界视图 + `recall`/`retrieve` |
| 是否双写 | **否**（不另存 MEMORY.md 文件、不 append 流水） | — |

IPC：`warmy:project-memory-get/set`（set **read-back** 确认）。

## 2. 任务树 + 进度条

**不是第二套任务系统。** 看板 `BoardTask` 增加可选 `parentId`：

- 指令：`新建任务 父任务 / 子任务`（或 `>`）
- 父任务进度 = 子任务平均（`withTreeAggregation`）
- UI「进度」仍读同一 `warmy:board-tasks`，仅多一层父子聚合

## 3. AI 决策选项卡（会话中）

- 触发：AI **工作过程中**需要人类点选（不是创建项目表单本身）
- 数据：`AiQuestionHub`；IPC `warmy:ai-question-open/list/answer`
- 选项后**永远**附带「其他（自行输入）」
- 注入下一轮：`[人类决策] 问题 → 选项`
- 去重：同群同标题 pending 只保留一张
- 若人类让 AI **在会话里创建项目**并询问是否容器开发 → 同一机制

## 4. 门禁判停

- 项目属性 `gateVerify: string[]`（仓库相对脚本路径，最多 4 条）
- **仅**在：看板 `完成` 指令，或消息含 `验收/门禁/verify/gate` 时触发
- 同项目 **3s 节流**；结果写入 `gateLast`；**不**每次对话跑脚本

## 5. 写操作 read-back

- `read-back.ts` → `withReadBack(save, read, equals)`
- 已接：项目记忆、skillScanDirs（含路径去重）、update-source-set
- **confident=false 时不许 UI 说「已保存」**

## 6. 自动化/配置去重

- `dedupeByNorm` + `normPathKey`：skill 自动发现目录去重
- 决策卡：同题 pending 去重
- 台账：同路径同操作刷新而非堆叠（既有）

## 7. Dream 类：我们已有的「整理」能力（详细说明）

WArmy **没有**照搬 `/dream` 定时子代理，而是产品内已有三条整理通道：

### 7.1 知识库（KnowledgeBase）

- 路径：`userData/knowledge/knowledge.json`
- 模型：实体（person/org/project/…）+ 事件 + 证据锚点（file/seq/recordId）
- 写入：值班/会话中的 `upsertEntity` / `addEvent`；检索 `warmy:knowledge-query`
- **职责**：可检索的**结构化事实**，偏「名词与事件」

### 7.2 归档流水线（KnowledgeArchiver）

- 路径：`userData/archive/archives.jsonl`
- 内容：`{ groupId, title, summary, anchors[] }`
- 入口：`warmy:archive-external`（外部群会话归档）
- **职责**：把整段会话压成**摘要 + 锚点**，可回原文（memory retrieve）

### 7.3 记忆流水（memory-os）+ 项目 MEMORY

- 流水：一切对话/工具结果（JSONL）
- 项目 MEMORY：**覆盖式**当前规矩——由人类或值班在确认后写入，不自动从流水「晋升」除非用户/值班显式保存

### 7.4 与 MiMo `/dream` 的对应关系

| MiMo dream | WArmy |
|------------|-------|
| 扫描近期轨迹 | memory-os JSONL + 归档 anchors |
| 晋升耐久知识 | **项目 MEMORY 人工/值班覆盖写**（更可控） |
| 剪枝过期条目 | CleanupManager（检查点/语音）+ 台账有界 + MEMORY 覆盖即剪枝 |
| 定时执行 | 可选：项目门禁/提醒自动化（见 automation 去重纪律） |

**结论**：知识库 + 归档 + 项目 MEMORY 分工清晰，**不需要**再加第二套 dream 引擎；若要自动化，只做「从归档摘要生成 MEMORY 草稿 → 人类确认后覆盖保存」。

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
