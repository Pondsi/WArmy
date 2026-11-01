# 第 63 轮交接（2026-10-22 · 新会话从这里开始）

> 本轮用户 5 点：① 后台翻译的真实进度与预计完成时间；② 清理「自动化」里无用的条目；③ 把需要拍板的事讲清楚（是什么/作用/方案/优缺点/例子/最坏情况）；④ 服务器不要登录/验证管理员的步骤，像普通本地软件一样打开就能操作；⑤ 还有哪些没做。
>
> **本轮没有 commit、没有 push。** 应用产物未改：`packages/app-shell/dist/electron-main.js` = 1,561,524 字节，sha256 前缀 `feb72b9cea3f8be4`（2026-10-22 06:38:35 本地），HEAD `0e4226a`。本轮只改了 `fwarmy/`、门禁脚本、`dev/i18n/` 和文档，所以**不需要重建 dist，也不需要重跑整遍 live**。

---

## 0. 一分钟读懂

| # | 用户项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 翻译进度/ETA | 上一会话结束后进程已停；名称/副标题 **9 语言全部 2200/2200**；正文 en-US **2200/2200**，其余 8 语言正在 8 进程并行跑。修复了两个真缺陷：整批 JSON 失败整批丢、`fetch` 无超时/并发共用 `.tmp` 导致 EPERM 中止。当前速度约 **3.5–4 小时**完成剩余 8×2200 条（会随后台波动） | §1；进度文件 `packages/app-shell/src/i18n/persona/*.progress.json` |
| 2 | 自动化清理 | Qoder 里只剩一条**已删除**的旧任务；它的 **144 条运行历史**（131 missed / 11 completed / 1 failed / 1 cancelled）已清空，当前自动化任务列表为空 | §2；Qoder `scheduled_task_run_logs` 0 行 |
| 3 | 待拍板说明 | 新增 `docs/DECISIONS-R63.md`：8 组事项，每组都有作用/方案/优缺点/例子/最坏情况/建议/回复模板 | 本文 §3（摘要） |
| 4 | 服务器免登录 | 管理页**本机打开即用**，不再生成/读取/填写管理密钥；`ctl.mjs`/一键脚本也不再打印密钥。保留四道边界：回环直连、Host 必须回环名、同源/无 Origin、管理写操作必须是 JSON。门禁 **35/0 + 24/0 连续 3 轮**；真浏览器冒烟通过 | §4；`fwarmy/server.mjs`、`ctl.mjs`、`README.md` |
| 5 | 还没做的 | 见 §5：P0-5 代码、网络设置 UI/接线、实体复核队列、nm 全部替换、8 语言正文（正在跑）、可选整遍 live 记录、若干待拍板项 | §5 |

---

## 1. 翻译（第 1 项）

### 1.1 真实状态（不要再被旧交接误导）

- 上一会话结束时，后台 `translate-personas.mjs` **已经停了**（不是还在跑）；重启后还遇到网络挂起和文件写冲突，已修。
- 名称/副标题：**9 种翻译语言全部 2200/2200**（zh-TW、en-US、ja、ko、fr、es、pt、ru、eo；逐条对比源模板，0 缺失）。
- 正文：en-US **2200/2200**；其余 8 种正在跑（2026-10-22 14:58 快照：zh-TW 1359、ja 966、ko 951、fr 1005、es 1043、pt 1069、ru 785、eo 555，合计 7733/17600，约 44%）。
- 预计：按约 66 条/分钟（8 语言合计）估算，剩余 **约 2.5–3.5 小时**（14:58 起算，约 17:30–18:30 完成）；若 API 限流/波动会更久。8 个进程已用 `detached + unref` 启动，**本次会话结束后仍会继续跑**。
- 已知 13 条单条不合格（CJK 残留，集中在 ru 的 office/code 类）；当前进程的待办列表是启动时算好的，不会在本轮重试。全部跑完后用同一个启动器再跑一次即可只补这些缺口。

### 1.2 本轮修的三个翻译真缺陷

1. **整批失败就整批丢**：老实现一批 20 条里 JSON 解析失败/漏条目，就把整批 20 条都记失败；fr 曾一次丢 242 条。现在失败会二分重试（20→10→5→2→1），只把真正译不出的单条留在待办。
2. **`fetch` 无超时**：网络一挂，整条流水线永久等。现在 180 秒超时；超时按失败重试/二分。
3. **并发 worker 共用 `.tmp`**：两个 worker 同时 `rename` 同一个 `zh-TW.json.tmp` ⇒ Windows `EPERM`，整个语言进程中止。现在每个 worker 用带 pid + 随机串的唯一 tmp，并有重试/覆盖兜底。

### 1.3 现在的跑法（8 个**分离进程**，互不写同一文件，会话结束也不会被回收）

```bash
cd <仓库目录>
export MIMO_KEY_FILE='<密钥文件>'   # 只从环境变量读，不打印、不落仓库
node dev/i18n/run-content-parallel.mjs            # 默认 8 语言、batch=3、每语言 concurrency=2
# 只跑部分语言 / 调参：
node dev/i18n/run-content-parallel.mjs --langs=ja,ko --batch=3 --concurrency=2
```

- 启动器用 `detached + unref` 把每种语言变成独立进程；PID 写 `%TEMP%\warmy-i18n-content-pids.json`。
- 进度看 `packages/app-shell/src/i18n/persona/<lang>.progress.json`（`done` 里以 `:content` 结尾的条数）。
- 日志：`%TEMP%\warmy-i18n-content-<lang>.log`，每 10 批一行 `[lang] 进度 N/M`；`单条不合格` 会写原因（`ratio=` / `cjk` / `empty`）。
- 中断后重跑同一条命令即可续跑，不会重复翻译已完成条目。
- **不要对同一语言同时起两个进程**；不同语言可以并行（各写各的文件）。
- 如果启动器提示「已有翻译进程在跑」，先确认 PID 文件里的进程是否还活着；确实要重启用 `--force`。

### 1.4 质量门槛（要说清楚）

机器翻译目前只过**确定性校验**：JSON 可解析、字段非空、长度比在范围内、非中日韩语言不许残留汉字。**没有逐条人工语义校对**。建议每种语言抽 20 条做 LQA（见 `DECISIONS-R63.md` §7）。

---

## 2. 自动化清理（第 2 项）

- 用户说的「自动化」= Qoder 的 Automations。
- 现状：`scheduled_tasks` 里只有一条旧任务 `R51 全任务推进器`，`deleted_at` 已置位、`enabled=0`；任务本身早已删除。
- 但它的 **144 条运行历史**仍留在 `scheduled_task_run_logs`，UI 的自动化列表里会显示很多条目。本轮已清空：
  - 备份：`%TEMP%\qoder-main-before-cron-clean-<时间戳>.sqlite`（**确认无异常后可删**）；
  - 清理后 `scheduled_task_run_logs` = **0 行**；
  - 任务列表 `qoder_cron list` = 空。
- 如果 UI 仍显示缓存，重启 Qoder 或刷新 Automations 页面即可。

---

## 3. 待拍板（第 3 项）

完整说明在 [`docs/DECISIONS-R63.md`](./DECISIONS-R63.md)。摘要：

| # | 事项 | 选项 | 我的建议 | 最坏情况 |
|---|---|---|---|---|
| 1 | `write_file` 整篇覆盖本会话自己写过的文件 | 现状已有「变短/不重合就拦」的闸，但模型可自带 `overwrite:true` 绕过；A 现状 / B 只留痕 / C 核对用户原话 / D 破坏性覆盖弹卡 / E 扩大覆盖面 | **D**：保留现有闸，丢一半以上或删 >1000 字时弹卡确认，其它覆盖留痕 | 无人值守任务被卡住；但默认不覆盖比静默丢前文安全 |
| 2.1 | P0-6 白名单新增要不要人工确认 | A 自动 / B 每条弹卡 / C 待审区 / D 自动+审计+可撤销 | **D**；隐私优先选 C | 宽短语被加入后，k=2 仍可能输出一次敏感概要；D 至少可见可撤销 |
| 2.2 | 历史会话库重扫 | A 不扫 / B 先 dry-run 再替换 / C 直接全量 | **B** | 不扫 ⇒ 旧泄漏一直留着；直接全量 ⇒ 历史概要大面积消失 |
| 2.3 | canary 红队进 live | A 不加 / B 加一条 / C 人工 | **B** | 不加 ⇒ 只证明检查器能挡，证明不了端到端链路 |
| 2.4 | 受众分档（群内/可导出） | 现在做 / 暂缓 | **暂缓** | 不做 ⇒ 一份概要同时给群友和外部导出 |
| 2.5 | 概要 TTL | 暂缓 / 180 天 / 其它 | **暂缓** | 太短 ⇒ 牛马忘事；没有 ⇒ 陈旧敏感信息长期在 |
| 3 | 旧文档/日志密钥文件名 | A 保持 / B 删旧日志 / C 替换占位 | **B** | 未跟踪日志被 `git add -A` 会公开本机路径/文件名（不是密钥内容） |
| 4 | round16 本机 27B 写不满 5200 字 | A 换更快模型 / B 抬 1800 秒硬顶 / C 登记已知红 | **先 A，再考虑 B，C 兜底** | B 可能把真卡死等成慢；C 丢长文信号 |
| 5 | 整遍 live 连续 3 次的形式记录 | A 不补 / B 补 1 遍 / C 补 3 遍 | **A**（当前构建未改；已有 fast 3× + 冒烟 3×） | 不补 ⇒ 少一个整遍形式记录；补 3× ⇒ 约 4.5 小时且可能环境假红 |
| 6 | 出厂默认牛马 | A 产品承诺 / B 首启让用户建 | **B** | A ⇒ 用户没选模型/名字就被塞一只 |
| 7 | 8 语言正文质量门槛 | A 全量 MT + 抽样 LQA / B 只翻名称 / C 全量人工 | **A + 每种 20 条 LQA** | 某些语义偏差长度检查发现不了 |
| 8 | 服务器免登录边界 | 接受 / 不接受（加回本机 PIN） | **接受**（但别放多人共用机、别映射公网） | 同机其它本地进程/用户可直接调管理接口 |

---

## 4. 服务器本机免登录（第 4 项）

### 4.1 改了什么

- `fwarmy/server.mjs`
  - 删除管理密钥文件的生成/读取与 `x-admin-key` 校验；
  - 新增 `isAdminRequest(req)`：回环直连 + `Host` 必须是 `127.0.0.1`/`localhost`/`[::1]`（可带端口）+ Origin 为空或同源 + `Sec-Fetch-Site` 不是 `cross-site` + POST 必须是 `application/json`；
  - 管理页删掉密钥输入框和「保存并连接」，打开即 `ls(); stat();`，每 5 秒刷新。
- `fwarmy/ctl.mjs`
  - 不再读/传/打印 `data/admin-key.txt`；`start` 打印「本机直接打开，无需密钥」。
- 文档：`fwarmy/README.md`、`docs/SERVER-RELAY.md` 更新，并写明最坏情况。

### 4.2 为什么「无密钥」仍然有边界（不是裸奔）

| 边界 | 挡什么 |
|---|---|
| 只接受回环地址（127.0.0.1/::1/::ffff:127.0.0.1） | 公网/局域网直接访问管理面 |
| `Host` 必须是回环名 | DNS rebinding（攻击者域名解析到 127.0.0.1 后，浏览器仍带攻击者 Host） |
| Origin 为空或同源；`Sec-Fetch-Site: cross-site` 拒绝 | 浏览器里的恶意页面借刀 POST |
| 管理写操作必须 `application/json` | 简单表单跨站 POST（不需要预检的那类） |
| 业务面仍需 `Authorization: Bearer <凭据>`；心跳/取信/下线仍需 Ed25519 签名 | 未授权业务访问、替别人上线/取信 |

**最坏情况**：同机其它本地进程/本地用户可以直接调用管理接口（生成/吊销凭据、改限流、关服务器）。这是「普通本地软件、打开即用」的代价；不要把服务器放多人共用机，也不要把管理端口映射到公网。

### 4.3 验收读数

- `verify-r58-zhongji.mjs`：**35 ok / 0 FAIL × 3 轮**（新增无密钥生成凭据、不生成 admin-key、Host 非回环 403、Host 为 localhost 200、跨站 Origin 403、表单 POST 403、同源 200、健康检查无需凭据且能认出 `warmy-relay`）。
- `verify-r60-nm-server.mjs`：**24 ok / 0 FAIL × 3 轮**（新增「本机管理面不再要求密钥/登录，四道边界仍在」）。
- 真浏览器冒烟（临时端口 8798、临时数据目录）：页面打开无密钥输入框、统计自动加载；生成凭据成功；改 `ratePerMin=7`、`accepting=false` 保存成功；关闭服务器返回 `bye:true` 且进程退出。
- `ctl.mjs` 真链路：`start → status → cred-new → cred-list → switch → stop` 全部通过；`stop` 靠健康检查确认 `warmy-relay` 后停止。
- **顺手修的健康检查顺序缺陷**：`/api/health` 原来放在业务凭据校验之后，`ctl stop` 永远拿到 401、无法确认端口上是不是自己的服务。现在健康检查在凭据校验之前，无需凭据、不返回敏感信息。
- `verify-security` 28 PASS、`verify-docs` 95/0、`verify-gate-manifest` 23/23。
- **fast 档连续 3 遍 × 291 项次全绿**（`真红 0 · 已知红 0 · 缺文件 0`）；其中 `verify-r59-wangluo` 的旧 `x-admin-key` 断言已改成「本机免登录边界」，复跑 20/0。日志：`%TEMP%\warmy-r63-fast3.log`。

### 4.4 没有做的

- 没有把「启动/停止服务器」做进主应用（Electron）界面：目前仍是独立 `fwarmy/` 项目，用 `start.bat` / `start.sh` / `ctl.mjs start --open` 启动并自动打开管理页。用户说「在服务器上打开我们的程序」，如果指的是**主应用**而不是服务器程序，这算一个还没做的点（见 §5 第 6 条）。
- 管理面没有远程 TLS/会话；因为管理面永远只允许本机，不做远程管理。

---

## 5. 还有哪些没做（第 5 项）

### 5.1 产品/功能缺口（按优先级）

1. **P0-5 自托管凭证**：方案第 54 轮已定稿（伪 PIN + Argon2id→KEK、设备/系统账号/随机硬件绑定、60 天期限进 AAD、每天续期、三平台锁屏清内存密钥、24 词助记词唯一恢复、跨设备同凭证可解），**代码还没写**（没有 `pin-ce-lue.ts` 之类模块，也没有解锁/锁屏钩子）。
2. **网络设置 UI 与接线**：设置页「服务器列表/公网 IP」、第四列「网络设置」卡（按会话多选）、发送路径接 `touDiDaoSuoYou` + 心跳定时器——目前只有逻辑层（`wangLuo-peiZhi.ts`），没有 UI/未接线。
3. **实体复核队列 UI**：`kb.entity-review` 只落审计，没有「合并/分开」卡片；复核的是「两条实体记录是不是同一个真实对象」，不是「要不要进知识库」。
4. **nm 查看器「全部替换」**：查找/替换的只读文档行为还没验证/补齐。
5. **8 语言正文翻译**：正在跑（见 §1），预计 3.5–4 小时；完成后还要抽样 LQA 和跑 i18n 门禁。
6. **主应用内启动/操作中转服务器**（如果用户要的是这个）：需要在设置页加「服务器」卡、IPC、spawn `fwarmy/server.mjs`，还要把 `fwarmy/` 打进安装包；本轮只做了独立服务器程序的免登录管理页。
7. **整遍 live 连续 3 次的形式记录**：当前是「前一构建整遍 live + 最终构建 fast 3×291 + 真机冒烟 3×」；本轮没改 `dist`，所以没有重跑整遍 live。要不要补见 `DECISIONS-R63.md` §5。
8. **round16 本机 27B 已知红**：环境/模型吞吐相关，时红时绿；三条出路见决策文档 §4。
9. **round12 ④ 间歇悬挂的最终根因**：已补 `chat.card-waiting/answered` 审计和授权卡处理器，最终构建上 3 遍冒烟全绿；但「等卡 vs 工具轮悬挂」的判别还没有在 red 现场复现（已知红登记在 R51/R62）。
10. **P0-6 剩余边界**：历史重扫、canary 进 live、受众分档、TTL、白名单人工确认（见决策文档 §2）。
11. **`write_file` 整篇覆盖收紧**（见决策文档 §1）。
12. **旧未跟踪日志的密钥文件名**（`.r50-logs/` 里有一处真实路径；跟踪文件里 0 处）——建议删旧日志（见决策文档 §3）。
13. **出厂默认牛马是否产品承诺**（见决策文档 §6）。
14. **首启验收**：应用仍开在首启页（`setupDone=false`、`privacyConsent=false`），等用户亲手走一遍。

### 5.2 本轮已完成、不要再重做

- nm 下半屏根因、主界面吸附、硬门禁 31 条审计、服务器管理页（第 62 轮）。
- 最终构建 fast 3×291 项、真机冒烟 3×（每遍 13/0 + 11/11）。
- 名称/副标题 9 语言 2200/2200；en-US 正文 2200/2200。
- 服务器免登录 + 四道边界 + 3 轮门禁 + 真浏览器冒烟。
- Qoder 自动化 144 条历史清理。

---

## 6. 现场与复现命令

### 6.1 构建/指纹

```bash
cd <仓库目录>
node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync('packages/app-shell/dist/electron-main.js');console.log(b.length,c.createHash('sha256').update(b).digest('hex').slice(0,16))"
# 期望 1561524 feb72b9cea3f8be4
```

### 6.2 本轮相关门禁

```bash
node packages/app-shell/scripts/verify-r58-zhongji.mjs   # 35/0
node packages/app-shell/scripts/verify-r59-wangluo.mjs   # 20/0
node packages/app-shell/scripts/verify-r60-nm-server.mjs # 24/0
node packages/app-shell/scripts/verify-i18n-locales.mjs  # 162/0
node packages/app-shell/scripts/verify-r56-preset-i18n.mjs # 5/0
node packages/app-shell/scripts/verify-security.mjs      # 28 PASS
node packages/app-shell/scripts/verify-docs.mjs          # 95/0
node packages/app-shell/scripts/verify-gate-manifest.mjs # 23/23
```

### 6.3 翻译

```bash
# 看进度
node -e "const fs=require('fs');for(const l of ['zh-TW','ja','ko','fr','es','pt','ru','eo']){const j=JSON.parse(fs.readFileSync('packages/app-shell/src/i18n/persona/'+l+'.progress.json','utf8'));console.log(l,(j.done||[]).filter(x=>x.endsWith(':content')).length)}"

# 续跑（分离进程，会话结束也不停；只从环境变量读密钥）
export MIMO_KEY_FILE='<密钥文件>'
node dev/i18n/run-content-parallel.mjs
```

### 6.4 服务器

```bash
cd fwarmy
node ctl.mjs start --open --host=0.0.0.0 --port=8787
# 管理页 http://127.0.0.1:8787/ 本机打开即用，无需密钥
node ctl.mjs stop
```

---

## 7. 本轮改过的文件

```
fwarmy/server.mjs                         # 管理免登录 + Host/Origin/JSON 边界；删除 admin key
fwarmy/ctl.mjs                            # 不再读/传/打印 admin key
fwarmy/README.md                          # 管理页免登录 + 最坏情况
docs/SERVER-RELAY.md                            # 同上
packages/app-shell/scripts/verify-r58-zhongji.mjs # 34 条（新增无密钥/Host/Origin/JSON）
packages/app-shell/scripts/verify-r60-nm-server.mjs # 24 条（新增免登录边界）
dev/i18n/translate-personas.mjs                 # 二分重试 + fetch 超时 + 唯一 tmp + 进度日志
dev/i18n/run-content-parallel.mjs               # 8 语言分离进程启动器（会话结束不停）
docs/DECISIONS-R63.md                           # 新增（待拍板说明）
docs/HANDOFF-R63.md                             # 本文件
docs/CHANGELOG.md                               # 第 63 轮条目 + 第 62 轮翻译口径订正
docs/HANDOFF-R62.md                             # 顶部 R63 指针 + 管理密钥旧行为标注
```

**没有改**：`packages/app-shell/src/**`、`dist/**`、任何 `CHANPIN_MENJIN` 条款、任何密钥文件、用户真实 profile。

---

## 8. 未完成、需要你配合的内容（固定提醒）

### 8.1 需要你拍板

逐条说明与回复模板见 [`docs/DECISIONS-R63.md`](./DECISIONS-R63.md)。最小回复方式：

```
1=D  2.1=D  2.2=B  2.3=B  2.4=暂缓  2.5=暂缓  3=B  4=A  5=A  6=B  7=A  8=接受
```

### 8.2 需要你动手/提供

- **首启窗口已开在桌面**：请亲手走一遍引导；验收完直接关窗即可。
- 如果你要的是「主应用里一键启动服务器」而不是独立 `start.bat`/`ctl.mjs`，请明确说一声；这需要加 IPC + 打包 `fwarmy/`。
- 翻译还在后台跑（8 进程）；如果新会话要接手，先看 §1.3 的进度命令，不要重复起同一语言。

### 8.3 我可以继续做

- 翻译完成后：抽样 LQA、跑 i18n 门禁 3 轮、把正文缺失清单收敛到 0。
- 你拍板后：`write_file` 覆盖收紧、P0-6 剩余边界、旧日志清理、round16 方案。
- 大块未做：P0-5 代码、网络设置 UI/接线、实体复核队列 UI、nm 全部替换、主应用内服务器启停。

---

## 9. 第 64 轮追加：服务器改名 FWArmy（2026-10-22 晚）

> 本节由服务器子代理追加。第 63 轮的免登录/四道边界结论不变；服务器项目从旧目录名 `relay-server/` 整体改名为 `fwarmy/`，产品名 **FWArmy**（用户也写 FWAmry / fwamry）。

### 9.1 做了什么

- **改名**：`relay-server/` → `fwarmy/`；门禁、README、`docs/SERVER-RELAY.md`、历史交接里的路径同步；旧目录不再存在。数据文件格式未变，旧 `data/credentials.json` / `config.json` 可直接复用。
- **管理界面**：`fwarmy/admin.html` 自包含（无外部脚本/样式/CDN），本机打开即用；总览、逐凭据用量（日/月/年、最近 60 秒速度、峰值/分钟）、新建/改名/停用/删除（删除需再输入名称）、全局设置、日志查看、公网 IP、关服务器。
- **首次凭据**：首次启动自动生成「默认凭据」，明文只写 `data/first-credential.txt` 并在管理页显示一次；确认后删除；日志不含明文。
- **逐凭据限额**：名称、`ratePerMin`（令牌桶，允许一分钟突发）、`bytesPerMin`、`dailyBytes/monthlyBytes/yearlyBytes`、`disabled`；留空继承全局，0=不限；旧凭据的 `ratePerMin/dailyBytes` 迁移为覆盖值。
- **统计**：`data/stats.json` 原子写，按本机时区日/月/年分桶，累计每凭据/总数的请求、上行/下行字节、转发/投递/拒绝/离线、峰值；最近 60 秒速度内存窗口；重启不丢；损坏改名后按空表启动。
- **单文件**：`fwarmy/build-sea.mjs` 用 Node SEA（esbuild 打包 + postject 注入 + 内嵌 `admin.html`），Windows 产物 `fwarmy/dist/FWArmy.exe`，自带 Node，无需安装；macOS/Linux 用 `build-sea.sh` 在目标系统构建。
- **无界面/控制台**：`fwarmy-headless.bat` 隐藏窗口、不开浏览器、写 `data/server.log`；`fwarmy-console.bat` 对齐表格显示状态/凭据/日/月/年；另有 `.sh` 版本。

### 9.2 Windows 实机读数（2026-10-22）

- 产物：`fwarmy/dist/FWArmy.exe` = **93,611,008 字节**，sha256 `b16eae84b20cafe1a5adc11b6855d8a81d380e1397b1b5c78ec16159427f3ea9`（Node v24.20.0 win32-x64）。
- `FWArmy.exe --version` → `FWArmy 0.2.0`；`--server --port=8831 --host=127.0.0.1 --data=<临时目录> --no-open` 启动成功。
- `/api/health` → `{"server":"fwarmy-relay","product":"FWArmy","version":"0.2.0"}`；管理页 27,614 字节，含 `credTable`。
- 首次凭据：pending=true，token 长度 43；`credentials.json` 不含明文。
- 凭据级限速 `ratePerMin=2`：3 次 lookup 状态 `200,200,429`；日/月/年配额分别返回 `daily-quota` / `monthly-quota` / `yearly-quota`。
- 统计：7 请求 / 630 字节（1 条密文信封入队，B 轮询取走 1 条）；重启后仍为 7 / 630 / 今日 7 / 本月 7 / 今年 7。
- `FWArmy.exe table` 输出含今日/本月/今年列与对齐分隔线；`fwarmy-headless.bat` 启动后 `/api/health` 正常，`data/server.log` 5 行。
- 日志/数据文件均不含测试消息明文；日志行格式 `ISO时间 INFO  [fwarmy]|req ...`。

### 9.3 门禁

- `verify-r58-zhongji` **35/0**、`verify-r59-wangluo` **20/0**、`verify-r60-nm-server` **24/0**、新增 `verify-r64-fwarmy` **39/0**；四支各连续 **3 轮全绿**。
- `verify-docs` 95/0、`verify-security` 28/0、`verify-gate-manifest` 23/23。

### 9.4 未完成/风险

- **macOS/Linux 未在本机实测**：只提供在目标系统构建的脚本和平台分支；没有公证/安装包。不能声称“三平台安装包已可用”。
- 单文件未做代码签名，Windows SmartScreen / macOS Gatekeeper 可能拦截。
- 管理面仍是本机免登录语义；同机其它本地进程/用户可直接调管理接口，不要把管理端口映射公网。
