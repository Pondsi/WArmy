# 时间口径与时区（第 91 轮，2026-10-26）

> 用户口径：
> 1. **所有时间的记录都以时间戳形式存在**；
> 2. 界面仍按现在的格式显示，但**按设置里选定的时区换算**；
> 3. 设置里新增时区，**默认 = 用户系统时区**；
> 4. 启动/登录后若系统时区与之前设置的不同，**5 秒后**弹提醒：保持之前的时区 / 更换到当前系统时区；
> 5. 模型使用的时间等**非界面**场景都用时间戳（epoch / ISO），避免时区干扰。

---

## 1. 数据口径

| 场景 | 存什么 | 说明 |
|---|---|---|
| 消息、会话、群消息、审计、心跳、定时任务、回收站、知识库、记忆库 | **epoch 毫秒（number）** | 原有主链路本来就是数字时间戳，本轮未改语义 |
| `helper-tool` 备份产物 `createdAt` | **epoch 毫秒** | 原为 ISO 字符串；本轮改为 `Date.now()`。文件名里的时间串只用于命名，不作为记录 |
| checkpoint 摘要 | 文本里的 **ISO 8601** | 记录本身仍有 `createdAt`（epoch）；摘要只是标签 |
| 更新源 `publishedAt`、身份 `untilIso` | ISO 8601（外部/契约） | 本身就是精确时间戳，不随界面时区变 |
| “日标记/归档文件名” | UTC 日期串（`YYYY-MM-DD`） | 是去重键/文件名，不是某一时刻 |
| 知识库“发生时间” | epoch（按原文解析） | 原文是“上个月5号”这类**日历日**语义；解析与展示仍按说话当时的本地日历，不做跨时区平移，否则会把日期算错一天 |

**不再出现**：把 `toLocaleString()` 的结果写进记录。`packages/app-shell/src` 下除统一工具 `time-utils.ts` 外，已无 `toLocaleString / toLocaleTimeString / toLocaleDateString`。

## 2. 界面显示

新增两个“唯一入口”：

- `packages/app-shell/src/renderer/time-tz.js`：界面时间唯一格式化器（纯 JS，可被门禁在 Node 里直接跑）。
  - `setTimezone(tz)` / `getTimezone()` / `systemTimezone()` / `valid(tz)`
  - `full / minute / hm / hms / monthDayHm / smart / crossPoint / sameDay`
  - `loc / locTime / locDate`（带 `timeZone` 的 `toLocale*`）
  - `zones()`：`Intl.supportedValuesOf('timeZone')`（旧环境有兜底），按 UTC 偏移排序，带 `UTC±HH:MM` 标签
  - `decide(saved, sys, keepFor)`：启动决策纯函数
- `packages/app-shell/src/time-utils.ts`：主进程用户可见时间 / 模型时间工具。
  - `isoZaiShiQu(ts, tz)`：如 `2026-10-26T08:30:00+08:00`
  - `shiJianChuoWen(ts)`：如 `1792974600000 (2026-10-26T00:30:00.000Z)`
  - `geShiShiJian(ts, tz, opts)`、`shiQuPianYiFen`、`shiQuHeFa`、`guiYiShiQu`

渲染层所有用户可见时间都改走 `time-tz.js`：聊天分隔点、气泡悬停、行动行、待执行队列、文件/产物、检查点、回收站、授权/审批、联系人加入时间、身份变更、网络检测、容器环境、计划任务、成本面板、控制台时间、独立 nm 查看器的保存状态等。数字千分位（`toLocaleString('en-US')`）不属于时间，保持原样。

时区换算由 `Intl.DateTimeFormat` 完成，**自动处理夏令时**；不做“固定 +8 小时”这类硬编码。

## 3. 设置与首次启动

设置字段（`settings.json`）：

```jsonc
{
  "timezone": "Asia/Shanghai",        // IANA；空 = 还没落盘过
  "timezoneKeepFor": ""               // 用户明确“保持”时记下当时的系统时区
}
```

- **默认**：`timezone` 为空哨兵，生效值回退到系统时区；设置页下拉第一项显示“系统时区：<tz>”。
- **首次登录后**：若 `timezone` 为空，把当时的系统时区写下来作为基线（不打扰用户）。
- **之后每次启动/登录**：
  - 已存时区 == 系统时区 ⇒ 不提示；
  - 已存时区 != 系统时区 ⇒ 登录后 **5000ms** 弹二选一；
  - `timezoneKeepFor == 当前系统时区` ⇒ 用户已经对这个系统时区说过“保持”，不再重复问；
  - 系统时区又变成另一个值 ⇒ 重新提醒。
- **保持**：时区不变，写 `timezoneKeepFor = 当前系统时区`。
- **更换**：`timezone = 当前系统时区`，清空 `timezoneKeepFor`。
- **在设置页手动改**：立刻落盘，清空 `timezoneKeepFor`，并重绘当前页；其它窗口通过 `warmy:peiZhiChanged` 跟上。
- **独立会话窗**只跟随设置，不弹提醒（提醒只在主窗口出一次）。
- 主进程保存时**校验 IANA 名**：非法值返回 `bad-timezone`，不静默退回系统时区。

## 4. 模型与非界面

- **注入模型的“当前时间”行**：`当前时间戳 epochMs=<ms>，UTC=<ISO>，用户时区=<IANA>`；不再给本地化字符串。
- **`get_time` 工具**：
  ```json
  {
    "epochMs": 1792974600000,
    "isoUtc": "2026-10-26T00:30:00.000Z",
    "timezone": "Asia/Shanghai",
    "timezoneIso": "2026-10-26T08:30:00+08:00",
    "networkEpochMs": 1792974600123,
    "networkIsoUtc": "2026-10-26T00:30:00.123Z",
    "driftMs": 123,
    "local": "2026-10-26T00:30:00.000Z",
    "network": "2026-10-26T00:30:00.123Z",
    "note": "等待/定时请用 epochMs 算差值"
  }
  ```
  `local/network` 只作旧字段名兼容，值仍是 UTC ISO；不再提供 `localText`。
- **工具提示里的时间**（步骤已做过、重复产物、子代理列表、`.nm` 包导出时间等）改为 `epoch (UTC ISO)`。
- **租约说明**改为 ISO 8601。
- **用户可见**的导出 Markdown、回档说明、群摘要标题等按当前设置时区格式化（生成时快照；记录本身仍带 epoch）。

### 不做的两件事

1. **不把 OS 计划任务改成用户时区**：`schtasks` / `launchd` 的 `/st` 是系统本地墙上时间，底层仍按 epoch 计算后交给系统；界面显示跟随用户时区。
2. **不把知识库“发生时间”做跨时区平移**：它是原文的日历日（“上个月5号”），不是某一瞬间；平移会算错日期。

## 5. 验证

新增两个门禁：

- `dev/gates/verify-r91-timezone.mjs`：**82 ok / 0 FAIL**
  - 时区格式化真值表（UTC / 上海 / 纽约夏令时 / 东京；跨日、跨小时、偏移标签、419 个时区）
  - `decide` 真值表（首次初始化 / 不同提醒 / 相同不动 / 保持后不重复 / 系统再变重新提醒 / 非法值）
  - `time-utils` 真值表（ISO 带偏移、偏移分钟、时间戳文案）
  - 设置持久化（默认空哨兵、写回、恢复出厂）
  - 10 语言 × 8 条文案齐全且占位符完整
  - 静态判据：`time-tz.js` 先于 `app.js` 加载、5 秒定时器、二选一、只提醒一次、独立窗不弹、无裸 `toLocale*`、模型只拿 epoch/ISO、helper/checkpoint 口径
- `dev/gates/verify-r91-timezone-live.mjs`：**20 ok / 0 FAIL**（真 Electron + CDP，临时 profile，跑两轮）
  - 登录后 5 秒弹出提醒，文案点名两个时区，按钮为“保持 / 更换”
  - 保持 ⇒ 时区不变、`timezoneKeepFor` 记住系统时区
  - 设置页 419 个时区选项；改成 Europe/Paris ⇒ 落盘、渲染层生效
  - 聊天分隔点与行动行都按 Paris 显示（固定时刻 `2026-01-16 00:30`）
  - 另一轮点“更换” ⇒ 落盘为系统时区
  - 全程无脚本错误

回归门禁（本轮实跑）：`verify-r67-firstrun` 80/0、`verify-r81-ui` 20/0、`verify-r79-regressions` 7/0、`verify-r82-r103` 18/0、`verify-r82-chatwin` 12/0、`verify-r67-chat-order` 20/0、`verify-r70-budget-name` 14/0、`verify-r78-nm-plugin` 7/0、`verify-r78-scroll` 6/0、`verify-renderer-scope` 9/0、`verify-r54-i18n-defaults` 17/0、`verify-r56-preset-i18n` 5/0、`verify-i18n-locales` 162/0、`verify-r78-prompt-limits` 29/0、`verify-r67-prompt-caps` 12/0、`verify-r90-prompt-10x` 10 轮全过。

### 两个历史门禁的既有红（与本轮无关）

- `verify-r69-join-create` **15/3**：断言“创建按钮初始必须禁用”，但当前代码里项目默认选中 `host`、群聊预填默认名称，初始即可创建。这是第 69 轮之后的产品改动，本轮未触碰。
- `verify-r44-ui` **53/14**：项 3 断言“添加按钮的父节点是 `#shouQuanKaiGuan`”，当前授权卡结构已变；项 4 依赖真实模型这一轮产出可见操作行，本次实跑模型写了文件但界面没有操作行。本轮另用真机夹具单独验证了行动行仍能渲染且时分按所选时区显示（见 live 门禁），排除了时间格式化的回归。

这两项需要按**当前产品口径**重写判据或修 UI，属另立任务。

## 6. 文件清单

- 新增：`packages/app-shell/src/time-utils.ts`、`packages/app-shell/src/renderer/time-tz.js`
- 新增门禁：`dev/gates/verify-r91-timezone.mjs`、`dev/gates/verify-r91-timezone-live.mjs`
- 设置：`settings-store.ts`（`timezone` / `timezoneKeepFor`）、`electron-main.ts`（保存校验）
- 渲染：`index.html`、`app.js`、`nm-viewer.html`、`nm-viewer.js`
- 非界面：`electron-main.ts`、`checkpoint.ts`、`helper-tool.ts`、`work-tools.ts`、`lease.ts`
- 文案：`src/i18n/*.json`（10 种语言各 8 条）
