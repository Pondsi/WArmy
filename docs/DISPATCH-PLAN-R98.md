# 项目值班者派发计划（第 98 轮追加，2026-10-27）

> **第 99 轮更新**：三轴各五档；P4=极缓；P0 硬停需明确停止意图；值班者自执行增加 65%/45% 门槛；
> 值班者按模型强弱/快慢/思考档挑人。以 [`HANDOFF-R99.md`](./HANDOFF-R99.md) 为准；本文保留第 98 轮记录。

> 用户口径：
> “紧急度和难易度（难易/杂简）是不同的，紧急度会影响队列、投递、插话方式等。
> 在项目中值班者会根据紧急度和难易度选择合适的牛马进行任务的分配（甚至为牛马指定思考级别
> （如果该牛马有正在进行中的对话或任务，值班者还可以指定该任务的插话方式
> （加急、插入、排队，还是停止任务等），但不能指定模型，模型由牛马自己的设置决定）。”

---

## 一、两套维度，彻底分开

| 维度 | 来源 | 影响 | 不影响 |
|---|---|---|---|
| **紧急度 P0–P3** | 用户发送时的投递选择 / 群消息 urgency | 消息投递、插队、排队、插话方式（停止/加急/插入/排队） | 选哪个牛马、思考级别、模型 |
| **难易（nan）** | `nan-yi-du.ts` 本地分诊 / 模型分诊 | **模型档**（难→high）；挑执行者时也作为难度依据 | 消息插队/队列顺序 |
| **杂简（za）** | 同上 | **思考档**（杂→high）；顶模型仍可能失手时即使简也抬思考 | 模型档（模型只由 nan 决定） |
| **模型** | 每只牛马自己的设置（默认模型 / 调用链 / 智能模式） | 这一轮真正发给哪个模型 | 值班者不能改；派发计划里没有 `model` 字段 |

> P0–P3 不是重要程度。`P0` 只表示“停止当前任务”，不是“这件事最重要”。

---

## 二、派发计划长什么样

`PaiFaJiHua`：

```json
{
  "urgency": "P2",
  "difficulty": { "nan": 3, "za": 4, "importance": 3, "modelTier": "mid", "thinkLevel": "high", "combo": "易杂缓" },
  "assignments": [
    {
      "executorId": "nm-yi",
      "ming": "牛马乙",
      "thinkLevel": "medium",
      "interrupt": "none",
      "why": "匹配:前端；空闲；难 3/杂 4→思考 high；无需插话"
    }
  ],
  "modelLocked": true
}
```

- **`thinkLevel`**：`auto` = 跟随牛马自己的思考级别；`off/low/medium/high` = 值班者为本次任务指定。
- **`interrupt`**：`none`（目标空闲）/ `stop` / `urgent` / `insert` / `queue`。
- **`modelLocked: true`**：硬约束；计划类型里没有 `model`，宿主也不会从计划里读模型。
- 计划通过 `groupOrchestrate` 的返回值和审计 `orchestrator.dispatch-plan` 可查。

---

## 三、值班者怎么挑人

纯函数 `zhi-ban-pai-fa.ts` 的 `paiFaZhiXingZhe`：

1. 候选池由 `GroupChatRouter.route()` 提供：除值班者外、本机、非纯调度、未离线/未死的成员；
   空闲优先，忙碌成员也进池。
2. 对每个候选打分：
   - **能力标签匹配**：任务里的“前端/后端/测试/写作/设计/数据/运维/翻译/财务/法律/文档”
     与人设/名字里的同一标签命中 ⇒ +40/项；
   - 关键词重合：任务里的中文 2–4 字片段/英文词出现在人设/名字里 ⇒ +4/个；
   - 空闲 +30；忙碌按紧急度惩罚（P0 +8、P1 +1、P2 −120、P3 −1000）；
   - 实例非 running −50；序号越靠前有极小优先（稳定/公平兜底）。
3. 取分数最高的前 N 个：默认 **2 个**，`P0` 最多 **3 个**，不超过候选数。
4. 纯调度成员永远不会被选为执行者。

**例子**：任务“给网页做前端界面”，候选是“测试牛马 / 前端牛马 / 通用牛马”，
前端牛马 +40 排第一；另一个名额按空闲/序号给测试牛马。计划里不会出现模型名。

**例子**：P2 时“前端牛马”正在忙，“通用牛马”空闲 ⇒ 先选空闲的通用牛马；
P0 时同样条件会抢忙碌的前端牛马，并写 `interrupt=stop`。

---

## 四、思考级别怎么定

- 牛马自己的思考级别**不是** `auto` ⇒ 计划写 `thinkLevel: "auto"`，**不覆盖用户设置**。
- 是 `auto` ⇒ 用难易度的 `thinkLevel`（`off/low/medium/high`）。
- 主进程把级别按执行者自己的模型能力映射成请求参数；
  - 模型没有思考能力/没有档位元数据 ⇒ 不发送思考参数（普通请求），不硬塞；
  - `low/medium/high` 也按同一强度表换算，不会把内部档位名当供应商参数发出去。

**例子**：高难多步任务（nan4/za4）⇒ 计划 `modelTier=high`、`thinkLevel=high`；
执行者模型支持思考 ⇒ 请求里带 `thinking_level=high`；不支持 ⇒ 普通请求，审计仍记 `thinkLevel=high`。

---

## 五、插话方式怎么执行

| 模式 | 目标空闲 | 目标正在忙 |
|---|---|---|
| `none` | 直接派发 | — |
| `stop`（P0） | 无需停止 | 宿主 `stopInstanceTask` 真的 abort 它的在途对话/续派；没在跑就记“没有可停的” |
| `urgent`（P1） | 立即派发 | **立即派发，不等待**（加急） |
| `insert`（P2） | 立即派发 | **立即派发**（插入） |
| `queue`（P3） | 按顺序派发 | 调 `waitInstanceIdle` 等它当前任务结束，**最多 30 秒**；等到了再派，超时也派但审计如实记 `waitedMs` 与“没等到” |

- 有排队任务时，本轮执行方式强制改为**接力**：`stop/urgent` 先、`insert/none` 次、`queue` 最后。
- `stop` 只 abort 当前对话/续派，**不停用牛马实例**（和聊天窗停止键同一语义）。
- 审计：`group.interrupt` 记 `targetBusy/applied/waitedMs/detail`；`group.executor-done` 记
  `thinkLevel/interrupt/attempts/model/provider`。

**边界**：
- “正在忙”目前来自主进程的在途对话/续派表（`quXiaoZhong`/`yanXuZhuangTai`）；
  项目执行者的短命任务不在这个表里（它们本来就是本轮新起的）。
- P3 的等待只覆盖“能被主进程观测到的当前对话/任务”；不是通用进程级任务队列。
- P1/P2 对忙碌目标是**并发派发**，不会中止目标当前任务；需要中止请用 P0。

---

## 六、模型为什么不会被值班者改

- `executorConfig(instanceId, nanYi)` 只返回该牛马自己的模型、供应商、候选链；
  值班者只传 `nanYi`（难易度），**不传模型**。
- 牛马自己勾了智能模式 ⇒ 宿主用**它自己的** `smartMode/modelTier/本地清单/调用链`
  调 `jueCeMoXing` 选第一个模型；未勾 ⇒ 默认模型优先、失败严格顺链。
- 值班者给 `thinkLevel` 时只影响思考参数，不影响模型。
- 审计 `group.executor-route` 记 `smartMode/tier/picked/why/chainIndex`（只记，不改计划）。

**例子**：牛马乙默认 `deepseek-chat`、链 `[deepseek-chat, 本地27B]`、智能模式开、任务 `low`
⇒ 它自己选本地 27B；值班者无法把它改成 `deepseek-chat`。

---

## 七、代码位置

- `packages/app-shell/src/zhi-ban-pai-fa.ts`（新）：选人/思考级别/插话方式/派发顺序纯函数。
- `packages/app-shell/src/nan-yi-du.ts`（新）：难易/杂简分估、八组合、顶模型提思考（单聊分诊回退也复用它）。
- `packages/contracts/src/index.ts`：`CuoHuaFangShi`、`ZhiXingFenPei`、`OrchestrationDecision.candidateIds/assignments`。
- `packages/group-router/src/index.ts`：候选池（本机、非纯调度、含忙碌成员）。
- `packages/app-shell/src/orchestrator.ts`：
  `shengChengPaiFa` 生成计划、`zhiXingChaHua` 执行插话、
  `paiFaZhiXingZheLun` 按计划顺序派发并把 `thinkLevel` 传进执行者任务。
- `packages/app-shell/src/executor.ts`：`thinkLevel/thinkExtra` 进入请求参数。
- `packages/app-shell/src/electron-main.ts`：
  `listInstances` 带人设/思考级别/忙碌；`executorConfig` 支持牛马自己的智能模式；
  `executorThink` 按模型能力映射；`stopInstanceTask` / `waitInstanceIdle` 落在途任务。

---

## 八、验证

- `packages/app-shell/scripts/verify-zhi-ban-pai-fa.mjs`：**36/0**（人设匹配、忙碌惩罚、
  P0–P3 插话映射、思考级别不覆盖用户档、纯调度排除、空候选、派发顺序、难易/杂简八组合）。
- `dev/gates/verify-r48-heiban.mjs`：**67/0**
  - ④ 派发计划：2 个执行者、`modelLocked`、计划里没有 `model`；
  - ④c 高难任务 ⇒ `thinkLevel=high`，执行者请求真的带 `thinking_level=high`，
    模型仍是各牛马自己的 `fake-model-*`；
  - ④d P0 + 忙碌 ⇒ 计划 `stop`，宿主 `stopInstanceTask` 真的被调用两次；
- `verify-router-queue`：**19/0**；`verify-r48-qiyue`：**29/0**（契约类型无包外同名重复）。
- `run-verify-22 --tier=fast`：**114 项次 · 0 红**。

---

## 九、边界与未做

1. **值班者自答也已用它自己的模型设置**：没有配置该牛马模型/供应商时回落群/全局；
   执行者仍各自解析自己的模型。审计 `group.duty-config` 可查 `fromInstance`。
2. **挑人是宿主规则，不是值班者 LLM 自由发挥**：能力标签/人设关键词匹配，可预测、可测试；
   没有让值班者模型输出 JSON 计划（那会多一次模型调用且不可复现）。
3. **执行者数量固定**：默认 2、P0 最多 3；不是按任务规模动态 1–5。
4. **P3 等待上限 30 秒**；超过就照常派发并如实记“没等到”。
5. **忙碌判定只认主进程在途对话/续派**；后台子进程、外部系统里的任务不算。
6. **计划未在聊天界面单独展示**；目前通过返回值/审计查看。要不要加一行“值班安排”需要 UI 文案与门禁。
7. **能力标签是固定表**；用户人设里没有这些词时退化为空闲/序号。要更准需要给牛马增加“擅长标签”字段。
8. **难/杂阈值**：nan≥4 记“难”、za≥4 记“杂”；3 归入“易/简”。这是为了让八组合是二值，
   不代表 3 分没有成本（3 分仍会得到 mid 模型 / medium 思考）。
