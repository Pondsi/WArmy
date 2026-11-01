# 第 100 轮交接（2026-10-27）

> 本轮用户清单 0–10：停止按钮彻底停下 + 完整保留现场、nm 查看器插件装卸、独立会话窗关闭免确认、
> 完成后思考/中间回复变少、连续 5 轮真实模型验收、删配置首启。
>
> 结论：**单聊停止已从“只 abort HTTP”改成“世代 + 停止现场 + 不降级/不续派 + 晚到结果丢弃”**；
> 连续 5 轮真实模型验收 **28 PASS / 0 FAIL**；fast 全量 **3 遍 348 项次 0 红**（单遍 116）；
> 新门禁 `verify-r100-stop` **49/0**。

---

## 1. 为什么停止按钮反复修不好（根因，先看这一段）

### 1.1 真机证据（用户 20:15 那轮测试，审计原文）

| 时间（epoch ms） | 审计事件 | 含义 |
|---|---|---|
| 1793103347320 | `chat.dispatch` | 用户发任务 |
| 1793103369647 | `chat.stop-by-user` | 用户点停止 |
| 1793103369648 | `chat.model-degraded` `"This operation was aborted"` | **abort 被当成“模型失败”** |
| 1793103369649 | `chat.model-picked` `orcarouter/Qwen…` | **顺链换下一个模型继续干** |
| 1793103413773 | 第二个模型的回复“好的，这一轮就到这里…” | 停止后 44 秒又冒出一条完整回复 |
| 1793103414028 | `plan.auto-continue`（completion-check） | **停止后还自动续派** |
| 1793103588–3673 | 内部续派轮继续跑工具、写计划 | 用户看到“停不下来” |

### 1.2 旧代码的四个结构性缺陷

1. **abort 走降级**：`zhenZhengFaSongBen` 的 catch 把所有异常都当“这个模型失败”，
   `This operation was aborted` 被计进 `yiShiBai`，然后 `jueCeMoXing` 换链上下一个模型。
2. **续派自己擦掉停止标志**：`xuPan.jiXu` 分支里有一句 `stoppedSessions.delete(sessionId)`，
   等于主轮结束后把“用户已停止”擦掉，250ms 后的自动续派照跑。
3. **界面只抓了第一段思考**：旧 `stopAllAi` 从流式气泡里取
   `querySelector('.siKaoKuai pre')`（**第一个** `<pre>`）和 `.bubble`（**最后**一个正文气泡），
   中间的思考段、中间回复、工具操作全部没取；`renderChat` 一重建就丢。
4. **续派合并没合并思考分段**：`zhuiJiaLiaoTianRiZhi` 的 `mergeWithPrev` 合并了
   `content/reasoning/zhongJian`，但**没合并 `reasoningDuan`** ⇒ 一次用户任务里的内部续派轮跑完，
   界面上只剩第一轮的思考段（用户项 6“完成后思考变少”的根因）。
   另外操作台账 id 是 `xd1/xd2…`，**重启后计数器从 1 开始**，会覆盖上一轮同名操作；
   旧 `chat-meta` 里已经存着 `xd1`，新动作被当成“同一条”更新，界面上条数不变、内容错位。

### 1.3 现在的停止语义（不变量）

- **停止是一个动作，不是一次 HTTP abort**：`warmy:tingZhiDuiHua` 先取现场、落一条 `stopped` 日志，
  再中止在途请求与工具循环，最后广播现场。
- **停止世代**：每次停止 `TING_ZHI_DAI[sid]++`；每一轮开工时记下世代，之后任何关键点
  （模型循环头、拿到回包、写完成日志前、自动续派前、工具执行前）都比对；变了就收手。
- **停止标志只在“用户再次开口”清一次**：内部续派轮永远不清；新用户消息（包括点“继续/重试”
  发出的续传指令）才清，所以“停止后 250ms 又续派”不会复发，也不会把会话永久卡死。
- **晚到结果一律丢**：渲染层点停止时把 `sessionRuns[sid].generation + 1`，
  `deliver` 的 `benLunYouXiao()` 直接为 false；主进程侧 `benLunBeiTing()` 也会在写完成日志前拦住。
- **现场完整保留**：`luoPanTingZhi` 落一条 `assistant` 日志，带
  `reasoningDuan`（思考分段）、`zhongJian`（中间回复）、`content`（已吐出的正文）、`stopped: true`；
  工具操作本来就在旁路台账里，按 ts 归到这条消息的「执行过程」。
- **进行中的工具不谎报完成**：`biaoJiXingDongTingZhi` 把 `XING_DONG_ZAI_PAO` 中正在跑的行动改成
  「已停止」；工具稍后真的返回成功也不会覆盖（`XING_DONG_BEI_TING` 兜底）。
- **停止后不再执行新工具**：`zhiXingGongJu` 开头比一次世代；停止那一毫秒模型刚返回的 tool_calls
  也不会去改文件。
- **行动 id 跨重启唯一**：`xd-<时间戳>-<序号>`，不再用 `xd1` 覆盖旧台账。
- **停止现场跨重启**：`chat-meta` 记录 `stopped`；重启用「±5 秒时间相邻」认领，
  只标真正的停止气泡，不会把整段会话的正常回复都标成停止。

---

## 2. 逐项交付（用户 0–10）

### 项 0：联网查“停止/取消”的业界做法

查了 Vercel AI SDK / Ably / OpenAI Agents SDK / MDN AbortController，核心结论已落进实现：

- `AbortController` 只停止**客户端消费**；上游可能继续生成、继续计费 ⇒ 宿主必须保留 run 世代，
  把晚到结果丢掉，并在 abort 时**落盘部分输出**。
- 停止必须是**后端级别的取消**（停止标志/世代），不能只靠关 HTTP。
- agent 的工具循环每一步都要检查取消信号，而不是只在入口检查一次。

参考链接见 §8。

### 项 1：独立会话窗关闭无需二次确认

- 根因：`state.chatWindow` 在 `state` 初始化时读取 `document.body.classList`，但独立窗的
  `liaoTianChuangKou` class 是**之后**才加的 ⇒ 关闭按钮误以为自己是主窗口，弹“确认退出？”。
- 修复：
  - `mode=fu` 分支加 `state.chatWindow = true`（`app.js:30421`）；
  - 关闭判断同时看 `document.body.classList`（`app.js:22428` 附近），双保险；
  - 主窗口仍保留二次确认；nm 查看器自己的未保存确认不受影响。
- 验证：CDP 打开 `mode=fu` 窗口 → 点关闭 → 目标直接消失，没有确认框。

### 项 2：nm 查看器在插件页可见、可卸载、不会被更新装回

- 根因：设置加载时只要 `settings.chaJianJi` 非空就**整个替换**默认表，而落盘列表里没有内置条目 ⇒
  `nm文件` 和 `warmy-memory-system` 在插件页消失。
- 修复：
  - 加载时合并内置条目：`warmy-memory` 永远在；`nm-file` 只有用户明确卸载过才不加回
    （`app.js:31098–31110` 附近）。
  - 插件页删除 `nm-file` 时写 `state.nmFileRemoved = true`、关掉 `nmKaiWenJian`、立即落盘
    （`app.js:14900` 附近）；主进程 `nmChaJianQiYong` 先看 `settings.nmFileRemoved`
    （`electron-main.ts:26569`）。
  - 新用户/更新不会自动装回；只有设置→功能里的「安装nm查看器」清标记。
- 验证：插件页删 nm → 重启 → 插件页无 nm、功能页显示「安装nm查看器」且启用勾选框灰；
  点安装 → 插件页恢复 nm、功能页显示「重装nm查看器」、设置里 `nmFileRemoved=false`。

### 项 3：设置→功能里加“安装/重装 nm 查看器”按钮

- 位置：`使用 nm 查看器打开项目内文件` 的「启用」右侧（`app.js:13218`）。
- 未安装：按钮文字「安装nm查看器」，状态写“尚未安装…内置插件，不联网”；
- 已安装：按钮文字「重装nm查看器」，点击把插件恢复为**已安装 + 启用**（内置代码不能真删，
  “重装”= 重置插件状态和卸载标记，不会改用户文件）。
- 插件页删/装后会就地刷新功能页这一行（`window.__shuaXinNmKaiWenJian`）。

### 项 4：停止时思考/工具/中间回复/正文完整放进「执行中」折叠

- `stopAllAi` 不再只抓第一个 `<pre>`：
  - 思考：`siKaoQuDuan(sid)`（全部真实分段）；
  - 中间回复：`state.streamInterim[sid]`；
  - 正文：`state.streamBuf[sid].content`；
  - 操作：主进程台账（按 ts 归到这条停止消息）。
- 停止消息是**正常牛马气泡**（不是 system 小字），带：
  - 「已停止 · 已执行 N 个操作（最近：X）· 思考 M 段 · 正文 C 字」摘要；
  - 「执行过程」折叠块（与正常回复同一套 `guiNaXingDong`）；
  - 每个操作行：完成/失败/已停止三态；停止时正在跑的那条显示「已停止」。
- 占位文案不算正文（摘要显示 0 字，而不是把“（已停止…）”算 17 字）。

### 项 5：停止必须马上停、不能再继续、顺序不能乱

- 主进程：abort 不再进降级链（`chat.stop-aborted`）；
- 自动续派前检查 `benLunBeiTing()`/`stoppedSessions`（`chat.stop-block-auto-continue`）；
- 工具入口检查世代（`chat.tool-blocked-after-stop`）；
- 渲染层：停止时作废本轮 generation，晚到的 `chatSend` 结果、晚到的流式分片都不再显示；
- 停止不再额外推一条「停止」空气泡（用户测试里那条 normal 气泡已删除）。
- 空闲时点停止只回 `idle`，不产生任何消息（不让常显的停止键凭空多一条「已停止」）。
- 真机复现：点停止后 1 秒内 busy 消失、发送恢复；8–30 秒内没有新回复；
  审计只有 `chat.stop-aborted` / `chat.stop-partial-saved` / `chat.stop-by-user`，没有
  `chat.model-degraded`、没有 `plan.auto-continue`。

### 项 6：完成后思考/中间回复变少

- 根因：`mergeWithPrev` 没合并 `reasoningDuan`（见 1.2 第 4 条）；
- 修复：`heBingDuan` 按 `ts|text` 去重、升序、上限 200；续派合并同时合并 `reasoningDuan` 和
  `zhongJian`（`electron-main.ts:1451/1504/1507`）。
- 验证：第 4 轮真实任务落盘最终回复 `rd=6`、`xd=7`；刷新/重启后仍在。

### 项 7：连续 5 轮真实模型验收

- 脚本：`dev/gates/r100-live-5-rounds.mjs`；模型：MiMo（默认）+ 本地 Ollama 链；
  **没有使用用户另提供的 DeepSeek key**。
- 5 轮内容不同：纯问答 / 写读文件 / 停止 / 多步计划+等待+持久化 / 设置插件+独立窗+短问答。
- 结果：**28 PASS / 0 FAIL**（细节见 §4.4）。
- 说明：真实麦克风、IM 账号、第二台设备、4K/签名安装包、项目值班派发需要用户环境，
  见 `OPEN-ITEMS-R100.md`。

### 项 8：详细交接文档

本文件。

### 项 9：未完成/需要协助

`docs/OPEN-ITEMS-R100.md`（每项写清：干什么、有什么用、方案 A/B/C、例子、最坏情况）。

### 项 10：删除配置、首启验收

见 §6（备份路径、恢复步骤、首启状态）。

---

## 3. 代码位置（本轮改动）

| 文件 | 关键位置 | 作用 |
|---|---|---|
| `packages/app-shell/src/electron-main.ts` | `TING_ZHI_DAI` / `tingZhiDaiOf`（15041） | 停止世代 |
| 同上 | `benLunBeiTing`（11668）、模型循环守卫（11932）、回包后（13533）、写日志前（14063）、续派前（14180）、catch（14243） | 停止后不降级/不续派/不落完成 |
| 同上 | `luoPanTingZhi`（9635）、`biaoJiXingDongTingZhi`（9668）、`warmy:tingZhiDuiHua`（9697） | 停止现场落盘、行动改已停止、广播 |
| 同上 | `XING_DONG_ZAI_PAO` / `XING_DONG_BEI_TING`（9204） | 进行中操作 / 已停止操作 |
| 同上 | `dangQianXingDong` 唯一 id（4393） | `xd-<时间戳>-<序号>`，跨重启不覆盖 |
| 同上 | `heBingDuan`（1451）、`mergeWithPrev`（1487/1504/1507） | 思考分段/中间回复去重合并 |
| 同上 | `chat-meta` 的 `stopped`（1213 附近、`yingYongMeta`） | 停止标记跨重启，按 ±5 秒认领 |
| 同上 | `chatMessages` 的 stopped 兜底（约 16700） | 旧数据占位文案也认作 stopped |
| 同上 | `nmChaJianQiYong`（26569） | 用户卸载后不自动启用 |
| `packages/app-shell/src/renderer/app.js` | `stopAllAi`（9280） | 三段缓冲取现场、noLog、作废世代、空闲不产生消息 |
| 同上 | `onTingZhiKuai`（30729） | 合并主进程现场、不重复气泡 |
| 同上 | `guiShu`（4469） | 操作按用户轮边界归属，上一轮尾巴不跑到下一轮 |
| 同上 | `tingZhiZhaiYao`（5635–5672） | 停止摘要 / 折叠执行过程 |
| 同上 | `state.chatWindow`（30421）、关闭判断（22428） | 独立窗关闭免确认 |
| 同上 | `nmFileRemoved`（174）、插件合并（31098）、安装按钮（13218/16151）、卸载标记（14909） | nm 插件装卸 |
| `packages/app-shell/src/context-renderer.ts` | `LogEntry.stopped` | 停止现场字段 |
| `packages/app-shell/src/settings-store.ts` | `nmFileRemoved`（263） | 卸载标记持久化 |
| `packages/app-shell/src/preload.cjs` | `stopChat(sessionId, opts)` / `onTingZhiKuai` | IPC |
| `packages/app-shell/src/orchestrator.ts` | `isStopped` / `onExecutorStart/End` | 项目停止也停到执行者 |

---

## 4. 验证记录

### 4.1 fast 全量

```bash
node dev/gates/run-verify-22.mjs --times=1
# === run-verify-22 tier=fast：1 遍 · 无产品红（116 项次） ===

node dev/gates/run-verify-22.mjs --times=3
# === run-verify-22 tier=fast：3 遍 · 无产品红（348 项次） ===
```

### 4.2 新门禁

```bash
node packages/app-shell/scripts/verify-r100-stop.mjs
# ==== verify-r100-stop: 49 PASS / 0 FAIL ====
```

覆盖：停止不降级/不续派、唯一清标志点、停止现场三样、进行中操作改已停止、工具入口拦停止、
行动 id 唯一、思考分段合并、stopAllAi 三段缓冲/世代/空闲保护、guiShu 真值表（正常轮/停止边界/
下一轮/流式）、chat-meta stopped 相邻认领、独立窗关闭、nm 插件合并/卸载标记/安装按钮、10 语言键。

### 4.3 真机停止复现（用户现场同类）

- 点停止 ≈1 秒内 busy=false、发送恢复；
- 停止气泡：`已停止 · 已执行 1 个操作 · 最近：wait_seconds · 思考 1 段 · 正文 0 字`；
- 执行过程折叠，操作行显示「已停止」；
- 8–30 秒内无新回复；
- 审计无 `chat.model-degraded` / `plan.auto-continue`；
- 重启后 stopped 气泡仍有思考/操作/摘要。

### 4.4 连续 5 轮真实模型（`node dev/gates/r100-live-5-rounds.mjs`）

| 轮 | 内容 | 结果 |
|---|---|---|
| 1 | 纯问答 17×23 | 391 |
| 2 | write_file + read_file + 文件落盘 | 内容 `WArmy-R100-OK` |
| 3 | wait_seconds 30 中停止 | 已停止现场、1 个操作「已停止」、8 秒无新回复、之后 1+1 正常 |
| 4 | plan 3 步 + 写文件 + 等待 + 读回 | 7 个操作；落盘 rd=6、xd=7 |
| 5 | 插件页/安装按钮/独立窗/短问答 | nm 可见、按钮存在、标题“牛马-1”、关闭无确认、短问答正常 |

**28 PASS / 0 FAIL**。

### 4.5 nm 卸载/重装（真实 UI）

- 插件页删 nm → 确认框文案说明可重装 → 重启后插件页无 nm、功能页「安装nm查看器」、勾选框灰；
- 点安装 → 功能页「重装nm查看器」、插件页恢复、`settings.nmFileRemoved=false`；
- 全程没有联网、没有改用户文件。

### 4.6 独立会话窗

- 打开后 `document.title` = “牛马-1”；
- 点关闭目标直接消失，没有“确认退出？”。

### 4.7 重启持久化

- 停止气泡重启后仍 `stopped:true`，带 `reasoningDuan`、操作行「已停止」、摘要；
- 正常回复不会被误标 stopped（±5 秒相邻认领）。

---

## 5. 未完成 / 需要协助

见 `docs/OPEN-ITEMS-R100.md`。其中需要用户环境/拍板的：真实麦克风与 ASR、整理模型质量、
真实模型思考档位清单、nm 最大化宽度/多显示器、任务栏实际显示、完全授权碰项目/他人会话、
项目值班者自执行、IM 真实账号、第二台设备、4K、签名/公证、连续 10×10 验收。

---

## 6. 删除配置与首启（项 10，已完成）

- **备份**：`%TEMP%\warmy-profile-before-r100-20261027-214116.zip`（2,759,120 字节，337 个条目，含 `settings.json`）。
- **删除**：`%APPDATA%\@warmy\app-shell`（已删除，校验 `PROFILE_EXISTS=False`）。
- **首启验证（CDP）**：标题“无限牛马”、`window.__warmyAuthGate` 存在、页面显示 10 种语言
  （简体/繁體/English/日本語/한국어/Русский/Español/Français/Português/Esperanto）+「开始」、
  没有旧引导（`.startGuide` / `.yinDaoTiao` 均不存在）、主界面是「暂无内容 / 去创建牛马」。
- **恢复旧数据**：退出应用 → 解压备份覆盖 `%APPDATA%\@warmy\app-shell` → 重启。
- 备份文件不会删除；若要恢复按上面步骤覆盖。

---

## 7. 复跑命令

```bash
# 构建
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/check-syntax.mjs
node scripts/copy-assets.mjs

# fast 全量
cd ../..
node dev/gates/run-verify-22.mjs --times=1

# 本轮门禁
node packages/app-shell/scripts/verify-r100-stop.mjs

# 5 轮真实模型（应用需以 --remote-debugging-port=9888 启动）
node dev/gates/r100-live-5-rounds.mjs
```

---

## 8. 参考（联网）

- Vercel AI SDK — Stopping Streams：https://ai-sdk.dev/docs/advanced/stopping-streams
- Ably — stop vs disconnect: canceling AI streaming：https://ably.com/blog/stop-vs-disconnect-canceling-ai-streaming
- OpenAI Agents SDK — Running agents（取消/停止点）：https://openai.github.io/openai-agents-python/running_agents/
- MDN AbortController：https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Kimi CLI abort signal 传播 issue（abort 要传到 HTTP 层）：https://github.com/MoonshotAI/kimi-cli/issues/2375

---

## 9. 一句话给下一轮

停止按钮的问题不在 UI，而在**主进程把 abort 当成模型失败**、**续派自己擦停止标志**、
**界面只保存了第一段思考**；这三条本轮都用“世代 + 唯一清标志点 + 一条 stopped 现场日志”
堵住了。若还要改停止相关逻辑，先跑 `verify-r100-stop`，再看审计里有没有
`chat.model-degraded` / `plan.auto-continue` 出现在 `chat.stop-by-user` 之后。
