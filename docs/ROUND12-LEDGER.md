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

- **用户的实例还在运行**（PID 41256 等，02:53 启动，带着 02:53 那轮测试会话）。
- main 里 `app.setPath('userData', '%APPDATA%\@warmy\app-shell')` 是**硬固定**的；
  `requestSingleInstanceLock()` 判定为第二实例 ⇒ `app.quit()+process.exit(0)`。
  实测：**改 `APPDATA` / `--user-data-dir` 都无法避开**用户实例持有的锁
  （boot log 只写到 `main loaded dir=` 就退出）。
- 结论：**真机验证必须先关闭用户实例**。计划：改完 → 关实例 → 真机验证 3 轮 → 删配置 → 重新启动给用户验收。
- `asr.failed` / probe 结论：MiMo 只接受 `input_audio.format ∈ {wav, mp3}`；麦克风默认 webm ⇒ 必失败。
