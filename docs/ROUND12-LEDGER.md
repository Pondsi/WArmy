# 第 12 轮台账（中途不汇报，只记台账）

> 目录：本项目根（下文用 `<工作区>` 指代）

## 已定位的根因（证据来自 audit.jsonl / probe-mimo-asr.mjs）

| # | 现象 | 根因 | 证据 |
|---|---|---|---|
| 16/17/18-ASR | 话筒说"需配听话模型"、转不出文字 | **MiMo 只收 `wav`/`mp3`；麦克风录的是 `webm`** ⇒ 400 Param Incorrect | `probe-mimo-asr.mjs`: `input_audio.format must be one of: wav, mp3. Got: webm` |
| 18-ASR2 | 附件音频"说没配 ASR" | `yuYinZhuanXie()` 只试链上**第一个**模型，且只走 `/audio/transcriptions`（无 chat 回退） | `asr-delegate.failed {status:404}` / `asr-delegate.no-model` |
| 18-看图 | "说无法看图" | 当前模型 vision=false ⇒ 转交；转交成功但提示没强约束模型"用这段描述、别说看不了" | `chat.capability-delegate imageUnd chars:671` |
| 18-卡死 | 5 分钟不结束、重复执行 | 同一步骤 `plan.auto-continue` 反复派 + 工具循环无重复指纹去重 ⇒ 撞 600s 硬超时 | `tool-loop-timeout(600s)` / `plan.eta-limit-hit ciShu:6,7,8` |
| 18-身份 | 忘了自己是牛马、自称 qwen | `llm.modelLine` 直说"你运行在模型 X 上"；无防漂移约束；实例 persona **从未注入提示** | `model-degraded` 后自称 qwen |
| 2 | 点击卡顿 | `renderPage()` 整页 innerHTML 重绘 + 原生 select + 桌宠 forward | HANDOFF 第 11 轮 |

## 改动清单（逐项打勾）

- [x] A. ASR：渲染层 webm→wav 转码；主进程双路 + 链回退 + 诚实报错
- [x] B. 看图转交：强约束"用描述、别说看不了"（`llm.delegateUseIt`）
- [x] C. 循环防护：工具指纹去重 + 续派同步骤上限（4 次）
- [x] D. 身份防漂移：modelLine 免责 + 身份锚（每轮重申）+ 注入实例 persona
- [x] E. UI 卡顿：只刷供应商列表（`provKaEl`/`renderProvList`）/ 桌宠改主进程光标轮询命中测试（弃用 forward）
- [x] 1. 音频测试：同一行、倒计时 5s、峰值 + 播放录音、去掉分割线与标题、勾选框下移
- [x] 3. 空白处右键菜单取消（只有"全选"时不出菜单）
- [x] 6. 文件大小：统一 `renLeiDaXiao`（B→KB→MB→GB）、补 preload 缺失的 `wenJianYuLan`/`wenJianDaXiao` 桥
- [x] 7. 文件图标：四处统一走 `wenJianIco`（含"其他文件"行）
- [x] 8. 「我的」页新增「配置」卡：agents.md 路径 + 导出/导入配置按钮
- [x] 9. 第四列「其他文件」样式对齐「文件产物」（大小·时间 + 定位按钮）
- [x] 12/13/14/15. 技能/工具/插件/门禁：启用勾选框、删除（二次确认）、门禁去掉「运行」
- [x] 17. 话筒呼吸动画加强（半透明底 + 缩放呼吸 + 外扩波纹）；`tingHuaZhuangTai` 改扫整条链
- [x] 10. 动态小字牛马 logo 配速：区间拉开（1.6s~9.0s）+ 爬升 2.4 s/s + 维持 1.1s（"看不出来"的根因是幅度太小/过渡太慢）
- [ ] 4/5/11. 以说明为主（见最终汇报）

## 真机验证（`verify-round12.mjs`，**连续 3 轮全绿**）

每轮 11/11：①UI 下拉 <400ms + 添加供应商只刷列表（7~9ms、整页未重绘）②真实列模型（本地 Ollama 23 个 / MiMo 8 个）
③真实对话有回复 ④真实工具调用并**在磁盘上确认文件存在** ⑤MiMo TTS 合成真语音 → `asrTranscribe` **往返转出文字**
⑥问"你是谁" → 认「牛马-1」、不自称 qwen。

> 改了 logo 配速后又**重新跑了 3 轮**（仍 11/11），满足"修完必须再连过 3 轮"。

## 环境事实（实测）

# ══════ 第 13 轮 ══════

## 卡顿根因（第 4 条，专项验证 3 轮全绿）

| 现象 | 根因 | 证据 |
|---|---|---|
| 点击卡、鼠标忙样式、过一会恢复 | `lieBiaoXiTongZiTi` 用 **`execFileSync('powershell.exe')`**（字体列表）同步卡住**主进程** 1~5s；设置页每次渲染都调 | 页内计时 59ms 正常，但进设置/切分区必卡 |
| 弹「无法确认谁发布了 **msb.exe**」前几秒卡 | `microsandboxZhuangTai` 每次进设置**连调两次** ⇒ spawn `~/.microsandbox/bin/msb.exe`（未签名）+ 两个 PowerShell；Defender 扫描时卡住 | `msbCunZai exists=true`（本机确实装了 msb） |
| icacls 解锁目录 | `runIcaclsSync` = `execFileSync`（60s 超时） | 同上 |

**修法**：字体列表改**异步 + 落盘缓存 24h + 并发去重**；msb 状态**缓存 30s**、没装就直接返回、显示状态改用**零进程** `msbCunZai`（纯 fs）；虚拟化检查 5min 缓存 + 每会话一次；icacls 改异步。

**专项点验**（`verify-ui-lag.mjs`，页内 `performance.now()` 计时）：
启动→可交互 516~539ms；进设置 66~144ms；切分区 10~54ms；下拉 9~14ms；加供应商 10~11ms；切功能 9~25ms；回我的 17~80ms；长任务 0~1 条（≤70ms）；msb 零进程 0~2ms。
**连续 3 轮全绿**。

## 第 13 轮其余改动

- [x] 1. 格式验收门禁：`providers/media-format.ts`（识别/分类/可接受清单/转换目标/pass-convert-reject）
       + 发送前 `yanShouGeShi` + `verify-media-format.mjs` 11 断言；`modelCaps.mediaFormats` 拉取时落盘
- [x] 2. 跨轮重复指纹（`huiHuaChongFu`）：同一指纹 ≥3 次 ⇒ 判异常；判卡死模型的提示里也带上「重复执行检查」
- [x] 3. 拉取模型后按 kind 标签自动归位到 听话/说话/向量/看图/画图/对话/整理 链（只追加、不打乱已排顺序）
- [x] 5. 思考级别 auto：模型不支持思考 ⇒ **静默**按不思考（只有用户显式选档位才提示降级）
- [x] 9. 牛马 logo 配速：9.7/2.3s + 0.7 s/s + 1.1s 维持 + 66% 慢速
- [x] 10. 「恢复默认设置」连**牛马实例**一起删（`instances/` 清空）⇒ 首启 0 头
- [x] 11. 导出/导入配置挪到「我的」页**切换身份同一排**
- [x] 15. 已提交并推送 GitHub（`00dda96..4ee53f5`）

## 验证汇总（本轮）

`run-gates --smoke` 6/6 · `verify-security` 28/28 · `verify-i18n` 158/0 ·
`verify-media-format` 11/11 · `verify-ui-lag` 3 轮全绿 · `verify-round12` 真机 3 轮全绿（11/11）
配置已重置（含牛马实例清空），应用已按**首次启动**打开待验收。

- **用户的实例还在运行**（PID 41256 等，02:53 启动，带着 02:53 那轮测试会话）。
- main 里 `app.setPath('userData', '%APPDATA%\@warmy\app-shell')` 是**硬固定**的；
  `requestSingleInstanceLock()` 判定为第二实例 ⇒ `app.quit()+process.exit(0)`。
  实测：**改 `APPDATA` / `--user-data-dir` 都无法避开**用户实例持有的锁
  （boot log 只写到 `main loaded dir=` 就退出）。
- 结论：**真机验证必须先关闭用户实例**。计划：改完 → 关实例 → 真机验证 3 轮 → 删配置 → 重新启动给用户验收。
- `asr.failed` / probe 结论：MiMo 只接受 `input_audio.format ∈ {wav, mp3}`；麦克风默认 webm ⇒ 必失败。

---

## 第 22 轮（交接项清零 + 长程/门禁修复）

- [x] 1. **verify-context-renderer 两支历史红修绿**（不再是"环境红"）：
       ① `budgetChars=200 指针完整可执行` —— 产品侧真缺陷：`xuanranYoujieShitu` 的"绝不给空视图"那一步
       把最后一条真实消息塞在最前，于是**已经完整的指针**被 `yingQianzhi` 从尾部裁成 `seq 1..30`
       （半根指针谁也解不了引用，`stats.pointers` 却仍报 1）。现在：先按 `zhizhenQianzhui('min')`
       的字数**预留**，余量才给真实消息；指针三线索（seq 范围 / recordId / recall）齐 ⇒ `pointers` 如实可执行。
       ② `verify-all 跑完且零失败` —— `spikes/verify-all/run-full.mjs` 把 `memory-os/node_modules`
       （pnpm 下常是空壳）junction 进临时目录 ⇒ `Cannot find module 'better-sqlite3'` **未捕获**，
       整个套件在第 7 节直接炸掉（后面几十条断言根本没跑）。现在按本平台
       `prebuilds/<platform>-<arch>.node` 找真包，并把该节包进 try：缺依赖只红那一条，不拖垮全 suite。
- [x] 2. **T34 决策卡扩展**：卡点挂在**唯一中断登记出口** `biaoRenWuZhongDuan` 上 ⇒
       `step-capped`（新增：同一步骤续派到顶且后面一步不剩时不再谎报 `done`）、`eta-anomaly`、
       `length-short`、`tool-loop-stall`、`tool-loop-hard-cap`、调用链全败、计划续派出错 全部有卡；
       同一会话同一类卡点只挂一张；默认仍等 24h（不烧 token）；24h 没人答 ⇒ 什么都不做。
       工具循环硬顶可被用户批准的"**再给它 30 分钟**"抬高（一次性，用完即失效，不许批一次永久免检）。
       选"重试这一步"会把 `blocked` 步骤放回 `pending`；选"接着干"走界面同一条 `deliver` 路径
       （模型/牛马配置在界面那侧，主进程只有 sessionId 时不自己拼 payload）。
- [x] 3. **NAT-PMP / STUN / 同时打洞客户端**（`packages/sync-protocol/src/nat.ts`，零 npm 依赖）：
       STUN Binding Request/Response 编解码（XOR-MAPPED-ADDRESS IPv4+IPv6、错误码、4 字节对齐、
       交易 ID 不匹配的响应丢弃）；NAT-PMP 请求/响应编解码 + **只读探针**（version=1 让路由器回
       UNSUPPORTED_VERSION，从而"证明它听得懂"却**不创建映射**）+ 租期 0 撤销 + 公网地址不许当网关；
       同时打洞（令牌由两端指纹排序后 sha256 推出、`timingSafeEqual` 校验、命中才提前结束）。
       阶梯 `upnp` / `holepunch` 两档改由 `chuangJianUpnpYingCelue` / `chuangJianDaDongCelue` 提供，
       **只有 TCP 真拨通才算成功**（UDP 双向命中但 TCP 拨不通 ⇒ `punch-udp-only` 判失败）。
       隐私默认：**不内置任何公网 STUN 服务器**；映射必须用户显式触发。UI 侧把这两档从"尚未实现"
       改成"已实现，未接入"（`net.ladder.needsConfig` + `data-state='needs-config'`，10 语言）。
       IPC `warmy:wangLuoNatNengLi` 现按 `mechanism` 分流 upnp/natpmp/stun。
- [x] 4. **长程实机验证**：新增 `verify-round22-longrun.mjs` —— 把 24 小时压成注入式时间轴，
       跑真磁盘/真 SQLite/**真子进程重启**：决策卡 24h 语义、租约过期与续租、600 轮 checkpoint
       （数量≤limit、空间≤上限、回滚逐字节 + 留 `kind=rollback` 标记与备份文件）、800 条记忆
       重启后逐字节取回、有界视图、ETA 方法库跨 24h 样本 + 重启读回、定时任务文件契约与到点判定。
       `--live --rounds=6` 用**真实 Ollama** 跑 6 轮：6/6 真的落文件、重启后 6 条真实结论逐条可取回、
       日志长 6 倍而注入视图只长 1.22 倍。**墙钟 24h 仍未挂机跑过**（这条如实留在遗留项里）。
- [x] 5. 顺手修掉的**真缺陷**（都是门禁实测出来的，不是顺手改风格）：
       ① `quGongYingYuShe('mimo')` 不走旧 id 别名 ⇒ 拆分后按旧名取预设拿到 undefined，
       界面里 MiMo 的默认模型/baseURL 会**静默变空**（`verify-audio-first-class` 抓到）；
       ② `app.js` 读 `window.__maiKeFengId` 但全仓库没人赋值（只读别名，`verify-renderer-scope` 抓到）；
       ③ 模型 chip 模板的外层 `<span>` 开在一个字面量、闭在另一个拼接里（`verify-renderer-template-balance` 抓到）；
       ④ PowerShell 的 `$m){$m.Count}` 写在模板字面量里长得像"被剥掉的 `${}` 残留" ⇒ 改普通字符串拼接；
       ⑤ 决策卡方向判定顺序：「按原调用链再试一次」字面带"调用链"，先判换模型会把"重试"偷换成
       "你自己去设置里改" ⇒ 改为先判"接着干"，且换模型分支不用裸"调用链"当判据。
- [x] 6. **门禁自身诚实化**（不许假装绿、也不许把改好的实现说成"未实现"）：
       `sync-protocol` 四个协议套件（handshake/dht/announce/liveness）+ connectivity 共 262 项
       此前因拼音改名漂移（`fingerprint`→`zhiWen`、`send`→`faSong`、`step`→`buZhou`、
       `bootstrap`→`yindao`、`list`→`LieBiao`、`fallback`→`huiTui`）而**崩溃或全红**，已修回；
       新增 `verify-nat.mjs`（73 项：真 UDP 往返、只读探针、公网网关护栏、打洞令牌、
       "UDP 通了不算打通"）；`verify-round22-decision.mjs`（52 项：分类器/卡面从 dist 抠出来跑真输入）；
       `verify-tool-args.mjs` 两条按第 21 轮新契约重写（墙钟改进展尺、gongJu 120s/12）；
       `GATE-MANIFEST` 里 `verify-context-renderer` 从 known-red 转为 green（known-red 9→8）。

## 验证汇总（第 22 轮）

- `tsc -b providers/group-router/sync-protocol/app-shell` = 0 错误；`copy-assets` 已跑。
- **`node dev/gates/run-verify-22.mjs --tier=fast --times=3`：连续 3 遍全绿**（每遍 61 支、共 183 项次、真红 0、缺文件 0）。
  还原 HEAD 对照后又跑了一遍确认（第 4 遍）同样全绿。
- 首轮 sweep 里 `verify-tool-calls` 的「超长记录分段取回拼回全文」偶发红过 1 次：
  单独复跑 3 次 + 之后 3 遍 sweep 全绿 ⇒ 判偶发；顺带把 runner 改成"红时优先打印失败行"
  （原来只截最后 3 行，红完看不出红在哪一条，无法复盘）。
- **`verify-round16` ①②⑤（本地模型写 ≥5200 字长文并落盘）与 ⑥（10+ 步计划）红**：
  用第 21 轮审计同一招对照——把 `electron-main.ts` + `context-renderer.ts` **换回 HEAD** 重跑，
  失败项**完全一致**（同样是 `(未找到)（0 字符）`）⇒ 与本轮改动无关，是**预存在**的真机红
  （本地 Ollama 在 600s 预算内写不出 5200 字长文；同一轮里 ③ 授权写桌面/④ 压缩包条目/⑦ 身份都过，
  工具链本身是通的）。已用 `--skip=verify-round16` 归因跳过，留给第 23 轮。
- 真机档（`--tier=live`：Electron + 真实 Ollama，每支前后自动清场带调试端口的遗留实例）：
  `verify-runtime-errors` ✓、`verify-round12` ✓（38.9s）；其余见下一条完整记录。
- `verify-round22-longrun.mjs --live --rounds=6`：真实 Ollama 6 轮全过（6/6 落盘、重启后 6 条结论逐条取回、
  日志长 6 倍而注入视图只长 1.22 倍）。

### sweep 过程中又抓到并修掉的两个"假绿/漏说"

- **`verify-round20-team.mjs --ollama` 是假绿**：整个验证体被 `if (key)` 包住 ⇒ 没云端 key 又加 `--ollama`
  时**一项都没跑却 exit 0**（我的 live sweep 里它以 55ms"通过"露馅）。现在 `--ollama` 独立生效，
  既没 key 又没 `--ollama` ⇒ 直接判失败并打印"什么都没跑 ≠ 通过"。修好后**真实 Ollama 连跑 3 轮 29/29**。
- **"没写够必须如实说明"被提前 return 跳过**：那段披露原来在 `eta-anomaly` 分支的 `return` **之后**，
  于是"分段追加 13 次仍没写满 ⇒ 被判异常提前收尾"这一路一个字都没交代，界面看着像做完了
  （真机：要求 5200 字、实际 4014 字）。现在披露块移到所有停机分支**之前**，
  `step-capped` / `eta-anomaly` / `length-capped` / `no-progress` / `done` 五条路都会说。

### 真机档（`--tier=live`）实测结论

- ✓ `verify-runtime-errors`(17.7s)、`verify-round12`(29.5s)、`verify-ui-lag`、`verify-click-lag`、
  `verify-round20-team --ollama`（真实模型 3 轮 29/29）。
- ✗ `verify-round16` ①②⑤/⑥：**预存在**（换回 HEAD 的 `electron-main.ts` + `context-renderer.ts` 重跑，失败项完全一致）。
- ✗ `verify-round17`（**已重跑 1 次，同样 3 条红**）：⑥ ASR 语言下拉选项数/默认值与当前实现有出入（与本轮无关，待核）；
  追加A 本地模型 6 次分段追加只写到 1966 字（同 round16 一类的模型能力问题）；
  追加A④ 「没写满却没在回复里说明」——门禁认的是回复正文里的**「本轮未跑完」**，
  而重跑明细是 `中断 0 / 判异常 0` ⇒ 这一轮**根本没走任何中断路径**，所以本轮前移的披露块没被执行
  ⇒ **仍有一条 Ending（模型自己收工、无计划步骤要补）没被披露覆盖**，已列进第 23 轮第一件事。
- ✗ `verify-round18` / `18b`~`18f` / `19`：`need MIMO_KEY` —— 本机没有云端 key，**属环境依赖，不算通过也不算回归**。


## R23 running notes
- WCAG 2.2 SC 1.4.3 contrast 4.5:1 body / 3:1 large; luminance L=0.2126R+0.7152G+0.0722B
- TTS params (ElevenLabs): voice_id, model_id, language_code, stability, similarity_boost, style, speed, output_format, seed
- OpenAI speech: model, voice, speed, response_format, instructions
- DSH package = @deepseek-ai/dsh, check via npm view registry


## R23 done notes
- fast 3x all green 183; team ollama+mimo 29/29; r23-live 22/22
- ink system, skills UI, file rows, tokens, breath, speaker restore, work-tool ledger, usage persist
- security 28/28 after removing user paths from test scripts
