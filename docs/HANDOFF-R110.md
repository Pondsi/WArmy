# 第 110 轮交接：回复不得被覆盖、完成提示音、整理特效与可取消

日期：2026-10-28
本轮针对用户真机测试暴露的三类问题：**模型回复被后一发覆盖/消失**、**整轮结束后没有完成提示音**、**语音整理缺少可取消的输入框特效**。另修正了导致“多生成一次最终回复”的计划证据门禁。

---

## 1. 现场证据（不是猜的）

真实 profile 的 `chat-meta.json` / `memory/fast-memory.jsonl` / `audit/audit.jsonl` 能还原整个过程：

- 第一条助手回复：`ts=1793196297778`，正文 **870 字**（任务完成汇报）。
- 第二条助手回复：`ts=1793196350343`，正文 **623 字**（“计划被宿主验证门禁卡住”的核对说明）。
- 审计：
  - `14:04:58 plan.auto-continue { why: "completion-check" }` —— 第一条最终回复之后，宿主又派了一轮“完成核对”。
  - `14:05:20 plan.verify-rejected { id: "T1", que: ["本次任务还没有写出 .docx 文件"] }`。
  - 用户原话只要求 **txt** 和 **ppt**，计划步骤标题是「生成桌面 txt 文档」。
- 因此第二条最终回复不是模型“需要再回答一次”，而是宿主门禁误判触发的。

### 根因链

1. `buZhouXuYaoZhengJu()` 用 `/docx?|word|文档/i` 判断 Word 文档，**把泛称“文档”也算成 .docx**。步骤「生成桌面 txt 文档」同时被要求 `txt` 与 `docx` 两种证据。
2. 模型确实写出了 txt，但 `plan_verify` 仍被拒；`jiHuaQueZhengJu()` 非空 ⇒ 判 `completion-check`，又派一轮内部模型请求。
3. 旧 `zhuiJiaLiaoTianRiZhi()` 的 `mergeWithPrev` 把内部续派轮的回复**并进上一条助手消息**（第二条最终回复出现时，上一条不再作为独立回复存在）；界面看起来就是“之前的回复完全消失了”。
4. 完成音只在渲染层 `deliver()` 的 `finally` 里播：第一轮因 `planPending=true` 不播；内部轮由主进程直接收尾，根本不经过渲染层 `deliver()` ⇒ 整轮完成也没有声音。

---

## 2. 修复

### 2.1 计划证据：txt 文档 ≠ Word 文档

`packages/app-shell/src/electron-main.ts`：

- 只认明确的 Word/docx 表述：`/(?:\.docx\b|\bdocx\b|\bword\b)/i`。
- 泛称“文档”不再替模型指定格式；「生成桌面 txt 文档」只要求 txt 证据。
- 这样本轮这条真实的 `plan_verify` 拒绝不会再发生，也就不会再多派那一轮“完成核对”。

### 2.2 所有模型回复独立保留，按时间排序

- `zhuiJiaLiaoTianRiZhi()` 删除 `mergeWithPrev` 合并路径：**正文、思考分段、中间回复、操作、词元都不再改写上一条**。续派/核对轮也作为一条新的 assistant 消息追加，时间戳取落账时刻。
- `loadSessionMessages()` 合并主进程与本地消息后按 `ts` 升序排序；`tuisongXiaoxi()` 本地推送也排序（稳定排序，同毫秒保持到达顺序）。
- `guiNaXingDong()` 的操作归属改为纯函数 `guiShuMuBiao()`：
  - 操作发生在某条回复之前 ⇒ 归时间上第一条不早于它的回复；
  - 操作发生在最后一条正式回复之后、且当前有流式气泡 ⇒ 归流式气泡；
  - 不跨用户轮；
  - 一个用户轮里多条回复时，各轮的思考/中间回复/工具记录各归各的，不会再全部堆到最后一条。
- 主进程每发回复落账后清空 `ZHU_SI_KAO_DUAN`（先把这一发的分段存进 `siKaoBenLun`），下一发内部续派从空开始；否则第二条回复会把第一条的思考再带一遍（现在不合并，会直接看见重复）。
- 以后“是否还要续派”仍是产品原有逻辑：只有宿主看到**真实未完成证据**才续派；本轮这种“只是计划状态未更新”的误判已消除。若真的还有没做完的工作，续派产生的新回复也会独立保留，不再覆盖前一条。

### 2.3 完成提示音：整轮真正结束只响一次

- 从 `deliver()` 的 `finally`、`endOfRound()` 移除旧的完成音播放点。
- 统一收口到 `yunXingZhuangTaiGuan()`：
  - 渲染层一轮收尾与主进程 `kai:false` 广播都走这里；
  - `run.yinXiangBoGuo` 保证同一轮只响一次；
  - 受设置「通知音 → 完成」开关、声音大小/自定义音频文件、会话「提醒」静音控制；
  - 群聊（internal/extgroup）按既有口径不响；
  - 失败音仍在 `deliver()` 的失败分支播，不会与完成音重复。
- 这样“第一轮 planPending、内部轮主进程收尾”的场景也会在真正结束时响。

### 2.4 语音整理：输入框主题色特效、再点话筒立即取消

渲染层 `app.js` / `app.css`：

- 整理开始时在输入框本体覆盖一层与 textarea 同字体、同 padding、同换行的文字层：
  - 约 28% 字符随机做 2.4–5.2 秒的明暗呼吸，亮起时用主题色并带轻微光晕；
  - 底层 canvas 画 18 颗极小光点，从四周缓慢向文字区汇聚，带极细尾迹；透明度上限 0.34；
  - 只用主题色 `--accent` 及其明暗/透明度变化，整体淡，不抢正文；
  - `prefers-reduced-motion` 下只保留静态淡光；
  - 特效层只覆盖 textarea 本体，不盖住计数行/工具条；textarea 真实文字临时透明，结束时恢复。
- 整理中话筒不再叠呼吸/波纹，只留一个静态主题色小点与提示“再点一下话筒停止”。
- **取消**：
  - 话筒点击处理顺序改为“整理中取消 → 录音中停止 → 新录音”；
  - `quXiaoZhengLi()` 立即移除特效、恢复原话、清空本发请求号，并调用主进程 `warmy:zhengLiQuXiao`；
  - 主进程按 `requestId` 用 `AbortController` 中止上游模型（`wenTeShuMoXing` 每个模型/每条腿都检查），不再继续换模型；
  - 晚到结果用世代号 `zhengLiJieGuoKeYong(dai, 当前, 已取消)` 判断，只丢弃**被取消的那一发**；
  - 下一次语音重新整理时拿新的世代号，仍处理**整个输入框**（`yuan = String(ru.value)`），不会被上一次的丢弃误伤。
- 用户等待整理时若自己改了输入框，结果不会覆盖用户修改（宁可不整理，也不吞字）。

新增 i18n（10 个语言包）：`chat.voiceOrganizingStopTip`、`chat.voiceReorgStop`。

---

## 3. 验证

### 新增门禁

| 门禁 | 结果 | 覆盖 |
|---|---|---|
| `dev/gates/verify-r110-replies.mjs` | **27/27** | txt 文档不再要 docx、回复独立落库、时间排序、操作归属真值表、完成音一次、整理世代/取消/特效静态接线 |
| `dev/gates/verify-r110-replies-ui.mjs` | **6/6** | 真 Electron：一轮两条回复都保留、各归各的操作、主进程连续写两条不覆盖 |
| `dev/gates/verify-r110-voice-ui.mjs` | **8/8** | 真 Electron：特效真实 DOM/尺寸对齐/随机亮字/粒子/取消恢复；完成音真实走 `yunXingZhuangTaiGuan` 且同轮只一次 |

### 回归

- `verify-r100-stop` 50/50（已更新旧“续派合并”断言为“独立保留”）
- `verify-r101-changes` 92/92
- `verify-r106-interim-ui` 23/23（另有独立窗/导出/引导卡）
- `verify-r107-export-schedule` 27/27
- `verify-r104-vault` 50/50
- `verify-i18n-locales` 163/0、`verify-strict-language` 10/0
- `verify-renderer-scope` 9/0、`verify-css-consistency` 8/0、`verify-gate-manifest` 23/23
- 完整 fast 档：**123 项次 0 红**

### 截图

整理特效真机截图：`<临时目录>/warmy-r110-voice-effect.png`
裁剪（输入框本体）：`<临时目录>/warmy-r110-voice-effect-crop.png`

---

## 4. 改动文件

- `packages/app-shell/src/electron-main.ts`
  - 计划证据正则；删除回复合并；每发落账后清空主进程思考分段；整理请求 `requestId` + `AbortController`。
- `packages/app-shell/src/renderer/app.js`
  - 回复独立/排序、`guiShuMuBiao`、完成音、整理特效/取消/世代、非覆盖用户修改。
- `packages/app-shell/src/renderer/app.css`
  - 整理特效层/逐字呼吸/粒子层/话筒静态提示/减少动态。
- `packages/app-shell/src/preload.cjs`
  - `zhengLiQuXiao`。
- `packages/app-shell/src/context-renderer.ts`
  - 移除 `mergeWithPrev` 字段与“合并次数”语义（`turnCount` 保留为工具循环轮数）。
- `packages/app-shell/src/i18n/*.json`（10 个）
- `dev/gates/verify-r110-replies.mjs`、`verify-r110-replies-ui.mjs`、`verify-r110-voice-ui.mjs`
- `dev/gates/run-verify-22.mjs`（fast 加静态 R110；live 加两条真机 R110）
- `packages/app-shell/scripts/verify-r100-stop.mjs`（旧合并断言更新）
- `packages/app-shell/scripts/verify-r65-session-isolation.mjs`、`verify-r65-mic-lifecycle.mjs`（测试桩补新依赖）
- `dev/gates/verify-round38-changes.mjs`（旧“续派合并富字段”断言改为“每发独立落账”）
- `dev/gates/verify-r97-static.mjs`（旧 `guiShu` 断言更新）

---

## 5. 首启

- 真实 profile 已备份后删除：`<用户目录>\AppData\Roaming\@warmy\app-shell.backup-20261028-225909-r110`（只在本机保留，不上传）。
- 新 profile 为全新首启：`settings.json` 中 `setupDone=false`，应用停在语言选择页。
- 首启截图：`<临时目录>\warmy-r110-firstrun.png`。
- 正常启动（无调试端口）停在语言选择页；用户可先在语言页验收，再继续注册/配置。

## 6. 仍开放/需要用户确认

1. **完成音是否真的被听见**：自动化只能验证“整轮结束确实走了一次完成音请求/设置生效”，无法在无声卡/无扬声器的测试环境确认听感。请在有声音的机器上勾选「设置 → 通知 → 完成」，跑一轮真实回复确认。
2. **整理特效的观感**：已按“淡、主题色、不抢正文”实现并截图；如果希望更明显/更淡，改 CSS 的 `--accent` 混比、粒子透明度上限和亮字比例即可，不需要动逻辑。
3. **续派策略**：本轮消除的是“计划状态误判导致的多一轮最终回复”。如果真实任务还有未完成工作，宿主仍会续派，新回复会独立保留。如果你希望“最终回复出现后永不自动续派”，这是产品策略变更，需要你明确拍板。
4. **旧独立门禁 `dev/gates/verify-r97-static.mjs`**：它不在 fast/live 清单里，当前有 7 条与滚动/模型路由演进相关的历史漂移（不是本轮引入，也不是本轮改动点）。本轮只更新了其中与 `guiShu` 相关的断言；是否要花时间整支清理，下一轮可定。
