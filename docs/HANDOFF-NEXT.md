# WArmy 交接（第 37 轮 → 第 38 轮）

> **本文件顶部永远是最新一轮**；第 36/35/34 轮的原文全部保留在下面作历史依据，别删。
> 本轮结束时**已做首启动交付**，程序是首次启动状态（`setupDone=false`）。

> 铁律（每轮都适用）：
> · 回复用中文；脚本一律 `.mjs`；**绝不用 PowerShell 读写源码**（`Set-Content` 会写成 GBK，中文全毁）。
> · 改 `.ts` 后必须 `node scripts/copy-assets.mjs`；改 `app.js`/`.css` 后必须 `check-syntax` + `copy-assets`。
> · CSS 有**两份**（`app.css` + `renderer.css`，后者后加载会覆盖）——改外观必须两边一起改。
> · 语言包是**扁平点号键**（`"wo.yinXiang": "印象"`），不是嵌套对象；10 个包键集合必须相等。
> · 仓库路径含中文 ⇒ 构建/门禁统一在 **`C:\wbuild`** 下跑。
> · 门禁脚本里**不得出现真实用户路径 / 密钥名**（`verify-security` 连注释一起扫）。
> · **杀进程不要用 taskkill**：本轮已加 `--warmy-quit`，让应用自己走退出函数（见 §2 项 10）。

---

## 0. 一句话现状

第 37 轮 13 项全部落码，**连续 5 次验收全绿**：

| 计次 | 类型 | round37-changes | round36-changes | round35-changes | ui | live-func | 全项目 fast |
|---|---|---|---|---|---|---|---|
| 1 | 本轮变更 | **33/0** | **38/0** | **79/0** | **37/0** | **20/0** | — |
| 2 | 本轮变更 | **33/0** | — | **79/0** | **37/0** | **20/0** | — |
| 3 | 本轮变更 | **33/0** | — | **79/0** | **37/0** | **20/0** | — |
| 4 | 全项目 | **33/0** | — | — | **37/0** | **20/0** | **68 项次无红** |
| 5 | 全项目 | **33/0** | — | — | **37/0** | **20/0** | **68 项次无红** |

另：i18n 158/0、作用域 9/0、CSS 一致性 6/0、安全 28 PASS、TS 0 错。

**两条最关键的真机证据**：
1. **ASR 之前"毫无变化"的真正原因不在协议层** —— 我用真音频打 `warmy:asrZhuanXie` 一直是**逐字正确**的；
   问题在**采集端**：拿设备默认格式（常见 48k 立体声 + 浏览器降噪/回声消除）再自己重采样，而且
   **录到静音/底噪时照样发给模型**（模型只能顺着编一段通顺的话 = 用户看到的"识别明显是错的"）。
   本轮改成"**采集端就要 16k 单声道**、优先 wav 容器、近静音拒发并如实提示"，并加了**话筒自检**。
2. **微信 ClawBot 是腾讯官方开放的**（iLink 协议，域名 `ilinkai.weixin.qq.com`）。
   我在本机实测了两个端点，**都通**：
   ```
   GET /ilink/bot/get_bot_qrcode?bot_type=3   → 200 {"qrcode":"…","qrcode_img_content":"https://liteapp.weixin.qq.com/q/…"}
   GET /ilink/bot/get_qrcode_status?qrcode=…  → 200 {"ret":0,"status":"wait"}
   ```
   ⇒ 扫码连接**可以实现**（不是逆向协议）。前提只有一个：**用户的微信要被灰度到 ClawBot 插件**。

---

## 1. 13 项逐条

### 项 1：内置技能 `warmy-self-modify` 改造
- **播到默认技能目录**（`userData/scan-dirs/skills`，与 `find-skill` 同一个），因此**一定出现在「设置 → 技能」里**。
  老位置 `userData/skills` 里的同名播种，只有内容与出厂稿逐字相同才删（用户改过的不动）。
- **正文彻底重写**：去掉了仓库地图 / 本机路径 / 构建命令 / 密钥；改成"怎么改造**本机这一份**"——
  先问验收标准 → 找安装位置 → 备份 → 分形态（源码 / 打包）→ 按风险从低到高改 → 自证 → 回滚，
  并明确"不要把本机路径/账号/密钥写进任何文件"。

### 项 2：「印象」（`yonghushuju.md`）
- **位置**：「我的」页，**道 与 规矩 之间**，同样 textarea + 确定/取消（复用 `zuHe` 那一套）。
- **注入**：系统提示里在「规矩」之后插一段 `【印象 · 牛马对用户的长期理解（低于「规矩」）】`，
  预算 3000 字（`YIN_XIANG_INJECT_CHARS`），并明写"**可能是错的**、与用户当场说的冲突以用户为准、被否认的永不再用"。
- **归档时归纳**：`guiDangYiGeHuiHua` 里调 `zhengLiYinXiang()`，素材只用**用户自己说过的话**
  （带"以后/每次/我不喜欢/记住…"这类长期措辞的句子）。**确定性提取、不调模型** ⇒ 永不幻觉。
- **防膨胀**：行数 120 + 字符 6000 双上限，超出按"最旧先丢"裁；每次归档都整理一遍。
- **软门禁**：`YIN_XIANG_TIQU_MENJIN`（要提取什么 / 不要提取什么 / 一行 40 字 / "三个月后还成立吗"自检）。
- **硬门禁**：用户否认 → `warmy:yinXiangZhiYi` → 在印象里找最像的一条（关键词命中 ≥2）→
  标成「（已被用户否认 <日期>：用户说"…"）」+ **追加一条提取纪律**（下次归纳按新纪律排除同类）。

### 项 3 / 项 4：现有归档与"用户偏好文件"（如实交代）
- **点赞/踩**存 `userData/zhinengpeizhi.md`（`smart-config.ts`），归档时 `zhengLi()` 会按模型分组整理；
  但它**只喂分诊模型**（判断重要/复杂度），**不进系统提示词**。
- 另有一个 `user-preferences.json`（v3）**只写不读**（`fuPanTiaoGuoGuiZe` / `biaoJiZanShiTiaoGuo` 全仓无调用方）
  ⇒ 是**死路径**，本轮没动它，建议第 38 轮清掉或接上。
- **归档实际做的三件事**：
  ① `shengChengHuiHuaZhaiYao` → 生成 `{bullets, decisions, todos, risks}` 摘要 → 写 `archive/archives.jsonl`
     → 最近 8 条 join 后 `slice(0,3000)` 作为「更早的对话（已归档摘要）」注入；
  ② `guiDangYiGeHuiHua` 增量归档 → 写知识库事件 + 注册资产 + 整理 `zhinengpeizhi.md`（本轮又加了"整理印象"）；
  ③ `congGuiDangTiQuZhiShi` → 抽实体/事件/偏好写知识库与 `user-preferences.json`（后者没人读）。

### 项 5：微信扫码接入（已实现）
- 主进程两个 IPC：`warmy:sheJiaoSaoMaKaiShi`（拿二维码）、`warmy:sheJiaoSaoMaZhuangTai`（轮询状态）。
- 状态机：`wait / scaned / expired / confirmed`；`confirmed` 后拿 `bot_token` + `ilink_bot_id`，
  **加密写入这只牛马的社交配置**，并默认 `huiHuaYingShe.default = 这只牛马的会话`。
- UI：社交接入块里 `ilink` 平台多一个「微信扫码连接」按钮 → 弹层显示二维码 + 状态文字；
  失败**显示服务端原话**，不假装成功。
- ⚠️ 仍需用户侧条件：微信被灰度到 ClawBot；若服务端要求客户端标识头，
  在设置里填 `sheJiaoClient.appId / version / botType`（代码已支持透传，未填就不发）。

### 项 6：11 张预设头像重做
`preset-1..10` + `user-default` 全部重画成**抽象的人**：整圆底 + 几何人形（圆/圆角方头 + 弧/梯形肩）+ 中性装饰，
**不画**头发形状、五官、服饰、肤色、性别特征 ⇒ 与政治/宗教/种族/职业/年龄都无关。

### 项 7：授权卡撤销按钮对齐
`.shouQuanCheXiaoXiao { margin-left:auto }` + `.shouQuanCaoZuo { flex:1 1 auto }` + `.shouQuanShui` 限宽截断
⇒ 每行「撤销」都在同一列。

### 项 8：附件只给"读"
- `warmy:fuJianShouQuan` 写入的授权条目显式带 `cls:'read'`；
- 要**改/写**这条路径时，卡片改口：「AI 请求**修改**你给它的这个文件」+「你只授权了「读取」；这次要改/写，属于另一件事」。

### 项 9：执行过程看不到工具操作（真因）
`guiNaXingDong` 只把明细挂到**已经落地的**回复上，而 `data-streaming="1"` 的流式气泡被排除 ⇒
**第一次对话（还没有正式回复）时，工具跑了但界面上一条都没有**。
现在优先挂到**流式气泡**的 `.siKaoKuai`，并新增 `window.__r35.guiNa` 供门禁重放；
界面门禁有一条"流式气泡里也能看到工具操作"的断言。

### 项 10：退出改走应用自己的路
主进程 `second-instance` 支持 `--warmy-quit` / `--warmy-exit` 参数 ⇒ 直接调 `tuichuYingyong()`
（与托盘「下班」同一条路）。`r37-firstrun.mjs` 就是用它来关程序的（3 秒兜底才 app.quit，**全程没有 taskkill**；
只有"应用没在 20 秒内退干净"时，才对**仍然活着且确认属于本应用**的 PID 兜底）。

### 项 11：社交凭据更安全
`cred-vault.ts` 新增 `jiaMiWenBen/jieMiWenBen`（`enc:v1:<base64>`，走 `safeStorage`）。
社交配置的 id/secret **落盘加密**、内存里仍是明文（适配器不用改）；系统保护不可用时**如实退明文**并记审计。

### 项 12：社交按牛马
配置存 `inst.sheJiaoJieRu[pingTai]`（旧的全局 `settings.sheJiao` 只作为回落读）；
连接表键 `实例::平台`（同一个 bot token 两只牛马不会互相吃消息）；默认映射到**这只牛马自己的会话**。

---

## 2. 本轮改了哪些文件

| 文件 | 关键改动 |
|---|---|
| `src/builtin-rules.ts` | `ZIZHU_GAIZAO_SKILL` 全文重写（面向本机副本，无仓库地图/路径/密钥） |
| `src/electron-main.ts` | 技能播种改到默认目录 + 清老位置；`yinXiangLu/duYinXiang/xieYinXiang`、`zhengLiYinXiang`、`YIN_XIANG_TIQU_MENJIN`、`warmy:yinXiangDu/She/ZhiYi`；印象注入；归档里调归纳；`--warmy-quit`；`jiaMiWenBen` 接线；`warmy:sheJiaoSaoMaKaiShi/ZhuangTai`；附件 `cls:'read'` + "修改附件"卡片 |
| `src/cred-vault.ts` | 新增通用 `jiaMiWenBen` / `jieMiWenBen` |
| `src/preload.cjs` | `yinXiangDu/She/ZhiYi`、`sheJiaoSaoMaKaiShi/ZhuangTai` |
| `src/renderer/app.js` | 印象卡（道与规矩之间）+ 绑定；否认→归因；`guiNaXingDong` 支持流式气泡；`__r35.guiNa`；社交块扫码按钮与二维码弹层；**ASR 采集端改造**（16k 单声道、wav 优先、真实 mime、近静音拒发、诊断记录、话筒自检） |
| `src/renderer/app.css` | 撤销按钮对齐 |
| `src/renderer/icons/avatars/*.svg` | 11 张抽象人头像 |
| `src/i18n/*.json`（10） | +23 键（印象 4 / ASR 7 / 扫码 12）⇒ 每包 **2797 键** |
| `verify-round37-changes.mjs`（**新增**） | 33 条静态断言 |
| `verify-round35-ui.mjs` | 新增"流式气泡里也能看到工具操作"；项4 预留位 ≥20px |
| `r37-firstrun.mjs`（**新增**） | 首启动交付（用 `--warmy-quit`） |

---

## 3. 已知遗留 / 建议第 38 轮

1. **ASR 还需要一次真机确认**：本轮把采集端改对了并加了「话筒自检」，
   但**无法在没有麦克风的环境里自证"用户说话时一定对"**。请让用户点一次
   「设置 → 功能 → 本地语音与文字互转 → **话筒自检**」，把弹窗里的
   **容器格式 / 时长 / 采样率 / 声道 / 音量峰值 / 识别模型 / 听到的文字** 发回来。
   若峰值 < 0.02 ⇒ 麦克风问题（选错设备/被静音）；若峰值正常但文字仍错 ⇒ 换模型或查 MiMo 端。
2. **微信扫码**：端点实测可用，但"扫码后能否 confirmed"取决于用户微信是否被灰度。若失败请照报错原文判断；
   必要时让用户在设置里补 `sheJiaoClient.appId/version`（代码已支持透传）。
3. **`user-preferences.json` 是死路径**（只写不读），建议清理或明确接入。
4. **印象的"归纳质量"**目前是确定性规则（永不幻觉但偏保守）。若用户觉得"该记的没记"，
   下一步可以：让模型在归档时**显式调用**一次归纳（用 `YIN_XIANG_TIQU_MENJIN` 当提示词），
   但必须保留"用户否认 → 改纪律"这条回路。
5. 「印象」与「规矩」的界面样式目前是复制粘贴的两张卡，建议抽成一个渲染函数（三张卡同源）。
6. 我**没有**把 `chat.tokensTitle` / `chat.xdUpdated` 这类已不再使用的键清掉（等一次全语言包未引用键扫描）。

---

## 4. 首启动交付（本轮已做，可逆）

把 18 项配置/状态**移进** `%APPDATA%\@warmy\app-shell\__r38-firstrun-1792261485201\`
（settings/profile/appearance/plans/xiaodi/eta*/router-queues/ui-queues/window-state/fonts-cache/
warmy-boot.log/assist.json/audit/checkpoints/scan-dirs/knowledge/instances/Local Storage/Session Storage/Preferences），
**保护区不动**：`identity/`、`secure/`（密钥仓）、`memory-runtime/`、`memory/`、`workspace/`、`updates/`、`skills/`、
既有 `__*` 备份、Chromium 纯缓存。
程序已用当前构建重开，复核 `settings.json`：`setupDone=false`、`privacyConsent=false`、`instances` 0 条。
**搬回原样**：关程序 → 把备份目录里的条目 mv 回上一级。

---


> **本文件顶部永远是最新一轮**；下面第 35 / 34 轮的原文全部保留作历史依据，别删。

> 铁律（每轮都适用）：
> · 回复用中文；脚本一律 `.mjs`；**绝不用 PowerShell 读写源码**（`Set-Content` 会写成 GBK，中文全毁）。
> · 改 `.ts` 后必须 `node scripts/copy-assets.mjs`；改 `app.js`/`.css` 后必须 `check-syntax` + `copy-assets`。
> · CSS 有**两份**（`app.css` + `renderer.css`，后者后加载会覆盖），改外观必须两边一起改。
> · 语言包是**扁平点号键**（`"chat.actionLog": "执行过程"`），不是嵌套对象。
> · 仓库路径含中文 ⇒ 构建/门禁统一在 **`C:\wbuild`** 下跑。
> · 门禁脚本里**不得出现真实用户路径 / 密钥名**（连注释里都不行：`verify-security` 会扫源码）。
> · 杀进程**必须**用"命令行含本仓库真实路径"这种窄条件；用 `/electron-main\.js/` 会把宿主自己的 electron 一起杀掉（第 35 轮踩过）。

---

## 0. 一句话现状

第 36 轮的 **8 项需求全部落码**，两个【本轮测试】问题都找到了**真根因**并修掉：
①**思考档位把内部名 `l3` 当 `reasoning_effort` 发给 MiMo ⇒ HTTP 400 ⇒ 整轮判失败**
（用户看到的"一直在要授权、始终完不成"就是这么来的）；
②**同一路径每换一个工具就重新要一次授权**（旧授权键里塞了工具名）⇒ 一次任务被问 10 次。
另外：查看文件被标"编辑"（`read_file` 说明写死"只能工作区内相对路径"，模型只好改调 `edit_file`）、
社交接入搬到每只牛马（并补上**一直缺失的 preload 桥**，那块 UI 以前是死的）、
执行明细并入思考块并按用户给的格式重排、木马图标取强调色、预留位加宽、头像换新。

**验收：连续 5 次全绿**

| 计次 | 类型 | round36-changes | round35-changes | ui | live-func | 全项目 fast |
|---|---|---|---|---|---|---|
| 1 | 本轮变更 | **38/0** | **78/0** | **36/0** | **20/0** | — |
| 2 | 本轮变更 | **38/0** | **78/0** | **36/0** | **20/0** | — |
| 3 | 本轮变更 | **38/0** | **78/0** | **36/0** | **20/0** | — |
| 4 | 全项目 | **38/0** | — | **36/0** | **20/0** | **67 项次无红** |
| 5 | 全项目 | **38/0** | — | **36/0** | **20/0** | **67 项次无红** |

另：i18n 158/0、作用域 9/0、CSS 一致性 6/0、安全 28 PASS、TS 0 错。
**首启动交付已做**（`__r37-firstrun-<ts>`，`setupDone=false`）。

---

## 1. 8 项逐条（根因 → 改法）

### 项 1：头像
- 预设第 10 张（`person-10.svg`）**换成原默认头像**的内容 ⇒ 老默认仍可被挑中；
- 新做 `user-default.svg` 作为**用户默认头像**（`PERSON_DEFAULT`）：扁平矢量、整圆底、100×100，
  无头发形状 / 无肤色色块 / 无职业服饰 ⇒ 不分性别年龄种族职业；表情是浅微笑（愉快而不夸张）。

### 项 2：社交接入搬到「牛马管理局 → 单只牛马设置」（社交信息**上面**）
- 新 `sheJiaoJieRuKuaiHtml(inst)`，插在 `${sheJiaoKuaiHtml(inst)}` 之前；设置→功能里那块**删掉**（不留两套入口）。
- **配置按牛马存**：`inst.sheJiaoJieRu = { [pingTai]: {...} }`；`duSheJiaoPeiZhi(instId)` 先读它，
  再回落旧全局 `settings.sheJiao`（老数据不丢）。
- 连接表键改成 `${instId}::${pingTai}`（同一个 bot token 给两只牛马配不会互相吃 `getUpdates` 的 offset）。
- 没填会话映射时默认 `{default: instId}`（否则"连上了"但消息进不来）。
- ⚠️ **P0 级修复**：`preload.cjs` 里**从来没有** `sheJiao*` 桥 ⇒ 界面里 `window.warmy.sheJiaoXxx?.()`
  全是 `undefined`，**这块 UI 一直是死的**。本轮补齐 5 个方法。
- 凭据仍按原样存 settings（**明文**，历史遗留）。建议下一轮改走 `cred-vault` 的 `safeStorage`。

**给用户的说明（也写进了界面提示 `social.jieRuHint`）**
| 平台 | 填什么 | 去哪拿 |
|---|---|---|
| Telegram Bot | `botToken` | Telegram 找 `@BotFather` → `/newbot` |
| 企业微信智能机器人 | `botId` + `appSecret` | work.weixin.qq.com → 应用管理 → 自建应用/智能机器人 |
| 飞书 / Lark | `appId`（cli_ 开头）+ `appSecret` | open.feishu.cn → 开发者后台 → 企业自建应用 → 凭证与基础信息（再开机器人能力 + `im.message.receive_v1` 长连接）|
| Slack / Discord / Matrix | token + channel/room | 各自开发者后台 |
| 微信 iLink ClawBot | `botId` + `appSecret` | 由 iLink/ClawBot 渠道分配（实验通道，有风控）|

**为什么 OpenClaw 连微信是扫码、我们不是**：它走的是**个人微信登录态**（把手机当授权端，
扫完码拿到一个模拟客户端的会话 token），本质是登录一个真人微信号；有风控与封号风险。
本产品只做**机器人通道**（拿 bot 凭据长轮询），所以**没有码可扫**。
要支持扫码得新增一条登录态通道（协议逆向 + 风控），属于新功能，不是搬 UI 能解决的。

### 项 3：执行中的木马图标取强调色
`<img>` 改不了颜色 ⇒ 换成 `<span class="xdIco">` + `mask: url(./icons/muMa.svg)` + `background: var(--accent)`。

### 项 4：执行明细展开后的格式（按用户逐字给的样例）
```
开始 ·2026/10/18 01:03:09
创建 ·<完整路径>
失败 ·2026/10/18 01:03:12 · 耗时 2秒
```
- 状态**写在前面**；第 2 行**写明是什么操作**（创建/修改/读取/运行命令…）+ 具体内容；
- **删掉**那条重复的「更新 …」；第 3 行只在**已有结局**时出现。

### 项 5：执行内容放进「思考」里
`guiNaXingDong` 不再 new 一个 `details.xingDongKuai`，而是找到**本轮最后一条牛马回复**的
`.siKaoKuai`（执行过程），把动作行**按 ts 升序**追加进去 —— 一个块、一条时间线。

### 项 6【本轮测试】反复申请授权 + 始终完不成 —— 两个真根因
1. **`reasoning_effort: 'l3'` 被 MiMo 判 400**（实测：只收 `none/low/medium/high`）。
   后果：整轮 `chat.tools.done … tingZhiYuanYin:"error"`，模型只能另起一轮重来。
   修法：`jingHuaSiKaoCanShu()` 把 l1–l6/off 映射成供应商词汇，认不出来的值**直接删掉**。
2. **授权键里塞了工具名** ⇒ 同一路径换工具就再问一次（那次会话问了 10 次：
   list_dir/read_file/read_document/read_pptx/write_file/make_pptx/edit_file…）。
   修法：授权按**路径 + 读写类别**记（`cls:'read'|'write'`），写覆盖读、读不覆盖写。
3. 顺带：系统提示里直接给出**本机真实目录**（工作区/桌面/文档/下载）并明令
   "不要自己拼 `C:\Users\<名>\Desktop`"（用户的桌面被重定向到了别的盘，模型猜的路径读不到）。

### 项 7【本轮测试】查看文件为什么是"编辑"
真根因：`read_file` 的工具说明写着「**路径必须是工作区内的相对路径**」—— 模型看到
`F:\XXZ\Qoder-win-x64-user.exe` 这种工作区外路径就不敢用它，转而调 `edit_file`，于是被记成"编辑"。
修法三件：①说明改成"**查看就用它**，绝对路径也行（工作区外会先征求同意）"；
②二进制/可执行也回**类型+大小+修改时间+文件头判定**，并明说"这就是它是什么，别再换工具读一遍"；
③会改动文件的那一类中文标签从"编辑"改成**"修改"**，与"读取"彻底区分。

### 项 8：蹦跶预留位加宽
`.niuMaBeng` 14px→**22px**（`flex: 0 0 22px`），图标 14→16px，两处 CSS 同步。

---

## 2. 本轮改过的文件

| 文件 | 关键改动 |
|---|---|
| `src/builtin-rules.ts` | （上轮）门禁 A/B/C + 自我改造技能 |
| `src/electron-main.ts` | `jingHuaSiKaoCanShu`；`ZHI_DU_GONG_JU_MING`/`gongJuQuanLei`/`luJingQuanPiPei`/`jiLuLuJingQuan`；越权守卫改按路径授权；`【本机真实目录】` 注入；社交接入 5 个 IPC 加 `instId` + 按牛马存 + 连接键按实例 |
| `src/preload.cjs` | **补齐** `sheJiaoPingTai/PeiZhiQu/BaoCunPeiZhi/LianJie/DuanKai/FaSong`（以前完全没有） |
| `src/renderer/app.js` | `PERSON_DEFAULT=user-default.svg`；`sheJiaoJieRuKuaiHtml`；`renderSheJiao(inst,host)`；`guiNaXingDong` 并入 `.siKaoKuai`；`xingDongHangNode` 新格式 + `<span class="xdIco">`；`修改` 标签；删设置页社交块 |
| `src/renderer/app.css` / `renderer.css` | 木马蒙版+强调色；`.siKaoKuai .xingDongZu`；预留位 22px（两份） |
| `src/work-tools.ts` | `read_file` 说明重写；二进制/可执行返回元信息结论；SVG 放行 |
| `src/renderer/icons/avatars/person-10.svg` / `user-default.svg` | 换 / 新做 |
| `src/i18n/*.json`（10） | +3 键（`social.jieRuTi`/`social.jieRuHint`/`chat.xdStart`）⇒ 每包 **2774 键** |
| `verify-round36-changes.mjs`（**新增**） | 38 条静态断言 |
| `verify-round35-changes.mjs` / `-ui.mjs` / `-live-func.mjs` | 判据跟着新结构/新格式更新；live-func 增 3 条**项 6 回归闸**（无 400 / 无 max-tokens 降级 / grant-once ≤3） |
| `run-verify-22.mjs` | 登记 `verify-round36-changes`（fast） |
| `r36-firstrun.mjs`（**新增**） | 首启动交付脚本（进程筛选条件已收紧） |

---

## 3. 已知遗留 / 建议第 37 轮

1. **社交凭据仍是明文**（`settings.sheJiao[].zheng` / `inst.sheJiaoJieRu[].zheng`）。搬成按牛马后份数变多，
   泄露面变大 ⇒ 应改走 `cred-vault` 的 `safeStorage`（`enc:v1:` 前缀 + `*BaoHu` 标记）。
2. **社交接入没有会话映射 UI**：现在默认映射到这只牛马自己的会话，但用户无法指定"哪个群 → 哪个会话"。
3. **iLink/个人微信**仍只是机器人通道；扫码登录需单独立项（登录态 + 风控 + 存储）。
4. `verify-round35-ui` 的 `window.__r35` 测试接缝仍在（门禁依赖，别直接删）。
5. `chat.tokensTitle` / `chat.xdUpdated` 已不再使用，可做一次"全语言包未引用键扫描"再清。
6. 项 6 的"反复授权"已从机制上减少，但**授权卡 UI 没有"这个路径允许读写"的可读展示**
   （现在显示"允许读写：<路径>"），建议在授权卡里加一列"类型（读/写）"。

---

## 4. 首启动交付（本轮已做，可逆）

做法：把 21 项配置/状态**移进** `%APPDATA%\@warmy\app-shell\__r37-firstrun-<ts>\`
（settings/profile/appearance/plans/xiaodi/eta*/router-queues/ui-queues/window-state/fonts-cache/
warmy-boot.log/assist.json/audit/checkpoints/scan-dirs/knowledge/instances/Local Storage/Session Storage/Preferences），
**保护区不动**：`identity/`、`secure/`、`memory-runtime/`、`memory/`、`workspace/`、`updates/`、`skills/`、既有 `__*` 与 Chromium 纯缓存。
然后用当前构建重开；复核 `settings.json` = `setupDone:false`、`instances/` 不存在。
**搬回原样**：关程序后把备份目录里的条目 mv 回上一级即可。

---

---


> **本文件顶部永远是"最新一轮"**；下面「第 34 轮 → 第 35 轮」的原文全部保留作历史依据，别删。

> 铁律（每轮都适用）：
> · 回复用中文；脚本一律 `.mjs`；**绝不用 PowerShell 读写源码**（`Set-Content` 会写成 GBK，中文全毁）。
> · 改 `.ts` 后必须 `node scripts/copy-assets.mjs`；改 `app.js`/`.css` 后必须 `node scripts/check-syntax.mjs` + `copy-assets`。
> · 仓库路径含中文 ⇒ 构建/门禁统一在 ASCII 绑定目录 **`C:\wbuild`** 下跑。
> · 门禁脚本里**不得出现真实用户路径 / 密钥名**（用 `os.homedir()`；密钥只走 `MIMO_KEY_FILE` 环境变量，只取第一行，永不打印）。
> · 只派 1 个子代理（本轮派了 1 个做只读诊断，见 §7）。
> · 临时文件（`%TEMP%\warmy-r35-*`、`.tmp-*`）最后**全部删掉**，绝不动不是本轮产生的东西。

---

## 0. 一句话现状

第 35 轮用户提的 **15 项需求全部落码并通过验收**：新增 3 条产品门禁 + 1 个内置技能；
修掉 `clef` 被标「画图」、ASR 转写错、执行过程一团乱、心内行信息不全/不对齐、路径截断与假菜单、
喇叭动效看不见、附件每次都要再授权等一串真问题。

**验收（连续 5 次全绿，协议达成）**

| 计次 | 类型 | changes | ui | live-func | 全项目 fast |
|---|---|---|---|---|---|
| 1 | 本轮变更 | **77/0** | **36/0** | **10/0** | — |
| 2 | 本轮变更 | **77/0** | **36/0** | **17/0** | — |
| 3 | 本轮变更 | **77/0** | **36/0** | **17/0** | — |
| 4 | 全项目 | **77/0** | **36/0** | **17/0** | **66 项次无红** |
| 5 | 全项目 | **77/0** | **36/0** | **17/0** | **66 项次无红** |

其他：i18n **158/0**、模板配平 PASS、作用域 **9/0**、CSS 一致性 **6/0**、安全 **28 PASS**、TS 编译 0 错。
**首启动交付仪式已按用户指令做完**（配置全部搬进可逆备份目录、程序已用当前构建重开，见 §6）。

---

## 1. 15 项逐条（根因 → 改法 → 证据）

### 项 1/2/3：三条**产品门禁**（这是"软件门禁"，不是口头规则）
新文件：**`packages/app-shell/src/builtin-rules.ts`**
- **门禁 A**：用户新增的"可复用能力"（key/接口/文档/脚本/「以后都这样」）必须 ①先真跑验证
  ②按判定表做成 **skill / 门禁 / 插件** ③写进设置 ④在回复里交代落点与撤销方式。
  判定表口径：**靠谁强制** —— 模型"知道就会"⇒ skill；"系统不许/必须"⇒ 门禁；"需要新工具"⇒ 插件。
- **门禁 B**：所有任务都要进计划任务（≥3 步才建、2–10 步、动词开头、同一时刻 1 步 doing、
  `verified` 只由 `plan_verify` 给）+ **宿主校验**：一轮里第 3 次工具调用仍无计划步骤 ⇒
  记审计 `plan.missing` 并把条款以 `hidden:true` 系统条目塞回模型上下文（用户看不到这条）。
- **门禁 C**：后台任务制度（≥5 分钟无活可干 ⇒ 先回复：在跑什么/每轮多久/几点几分完成/
  不用值守/计划任务里能看到/还有交代可以继续说），并禁止空转轮询与"跑完不汇报"。
注入点：`electron-main.ts` 的 `shenFenTou`（道 → 规矩 → **产品门禁** → 身份/模型/时间）。

### 项 4：动态小字左侧**始终预留**蹦跶牛马的位置
`app.js` 新增 `NIUMA_BENG` 常量 + `niuMaBengGengXin(n)`；`yunXingZhuangTaiKai` 的 DOM 变成
`预留位(.niuMaBeng) + 裁切窗(.niuMaKuai > .niuMaGui)`。CSS **两份都要改**（`app.css` + `renderer.css`，
后者后加载会覆盖）：预留位 `visibility:hidden` 常驻占位、`.youHouTai` 才显形；
蹦跶周期 = 奔跑组同一套配速（`peiSuXunHuan` 里写 `animationDuration = dangQian*0.42`）。

### 项 5：内置技能「改造 WArmy 本体」
`builtin-rules.ts` 的 `ZIZHU_GAIZAO_SKILL`，启动时播种到 `userData/skills/warmy-self-modify/SKILL.md`
（只播一次，之后用户可改）。内容：三条铁律（PS 写坏中文/`C:\wbuild`/改完必重建）、
**仓库地图**（"要改什么→去哪个文件"）、标准流程、定位缺陷方法（审计→控制台→CDP→"ok≠成功"）、
性能注意点、收尾清单。

### 项 6：有没有"自我改进的长期记忆"？（结论）
**有分层长期记忆，但没有自我改进回路**：
- 事实层：`userData/memory/fast-memory.jsonl`（写：`electron-main.ts` 的 `zhuiJiaLiaoTianRiZhi` 路径）；
- 检索层：`userData/memory.db`（fts_uni/fts_tri/vec，`packages/memory-os/src/index.ts` 的 `recall/retrieve`）；
  服务子进程 `userData/memory-runtime/ipc.js`；
- 项目记忆：`groups.json` 的 `project.memory`（上限 8000，注入截断 1200）；
- 另有 `knowledge/`、`archive/archives.jsonl`、`checkpoints/`、`agents.md`（规矩）、`dao.md`（道）；
- 注入点：`context-renderer.ts` 的 `xuanranYoujieShitu`（有界视图 `budgetChars`）+ `orchestrator.ts` 的项目记忆注入。
- **缺口**：`docs/WARMY-MEMORY-TASK-GATE.md` 明确"不自动从流水晋升"，建议的"归档→MEMORY 草稿→人确认"
  **没有实现**；唯一会自己变的只有 `eta-forecast.ts` 的 EMA 校准系数。⇒ **想真"自我改进"，下一轮要建这条回路。**
- 附带发现：`~/.local/share/mimocode/memory/global/MEMORY.md` 显示乱码不是文件坏了，是**读侧按 GBK 解码 UTF-8**；
  本项目不写这个文件（`packages/` 里没有引用）。

### 项 7：`clef:latest` / `clef-flash:latest` 为什么被标「画图」
**真因（真机实测）**：Ollama `/api/show` 对这两个模型回 `capabilities: ["decision","vision"]` ——
**没有 completion**。`providers/src/ollama.ts` 旧逻辑"有 vision 且无 completion ⇒ kind='image'"，
于是把**能看图的分类模型**标成了"画图"。而 Ollama **根本不会生成图片**。
修法：①先认 `decision` ⇒ `kind='decision'`（界面「决策」）②vision 无 completion ⇒ `'imageUnd'`（「识图」）
③名字像 flux/sdxl 也归 `imageUnd`。
**避免再次发生**：①`modelCapsVersion`（落盘能力带版本，口径一变旧记录不再采信，下次刷新模型列表自动重探）
②不认识的模型界面标「未知」而不是假装"对话"。
**"拉取时有没有能力信息"**：有 —— `/api/show` 的 `capabilities` 就是；项目在"刷新模型列表"时全量落盘
（`settings.modelCaps`），本项目**没有 `/api/pull`**（不做下载），所以探测点只有"刷新模型列表"。

### 项 8：心内行（模型名/词元/气泡/对齐/间距）
- 模型名**全称**：主进程写日志时拼成 `供应商显示名 · 模型 id`（`gongYingShangXianShiMing` + `zhu.presetId`）；
- 词元与**轮次**：`turnCount`（工具循环轮数）写进日志并随 `warmy:liaoTianXiaoXiJi` 回传（以前重启就丢）；
- **气泡合并**：时间/词元/喇叭/引用/复制 共用同一个 `tip`（时间 + 模型全称 + 输入输出 + 轮次 + 降级说明），
  动作语义移进 `aria-label`；
- 左对齐：删掉 `xiaoXiJiaoHang` 的内联 `margin-left:12px`（第一行 x=0、第二行 x=12 就是错位的根因）；
- 喇叭间距：`.xiaoXiLangDu{margin-left:12px}`。

### 项 9：播放时"看不到动态喇叭"——真因
原来声波 `path` 没有 `transform-box`，SVG 子元素默认 `transform-origin` 是**用户坐标原点(0,0)**，
`scale()` 只是让两道弧**轻微漂移**；24×24 viewBox 又被渲染成 12px（1px 粗）。
修法：`transform-box:fill-box; transform-origin:left center` + 两道弧错相位（0.28s）+ 按钮外圈扩散光环
（`::after` + `langDuHuan`）。界面门禁现在实测 `display!=none`、`animation-name=langDuBo`、光环在跑、底色变强调色。

### 项 10：用户附件自动进授权卡（只读）
新 IPC `warmy:fuJianShouQuan`：把每个附件写成 `{text:'允许读取：<完整路径>', path, du:true}`。
越权守卫里新增 `duFang` 分支：**路径精确匹配 + 工具属于只读类**（`ZHI_DU_CHONG_FU`）⇒ 直接放行并记
`auth.attachment-read`；**写/删/跑命令照旧弹卡**（豁免不外溢）。渲染层在 `deliver()` 里发送前自动登记。

### 项 11：路径超链接与右键菜单
- **空格截断**：正则里加了"单个内部空格"规则（` (?=[^\s])`）＋ 前缀分隔符组（`(^|[分隔符])`），
  否则会从"示例路径："这种前置文字一路吞进来；
- **虚拟/占位路径不该有菜单**：新 IPC `warmy:luJingCunZai` 批量核存在性；存在 ⇒ `data-real=1` 才给菜单，
  不存在 ⇒ **退回纯文字**；
- 末尾散文（`…报告 v2.docx 里`）由 `luJingHouXuan()` **逐级剥掉末尾一段**再核一次，找到真路径为止。

### 项 12/13/14：执行过程（行动明细重做）
- 标题统一 **「执行过程」**（`chat.thinking*` / `chat.actionLog` / `chat.actingNow` 十国语言包全部改口）；
- **行动过程不再是单独区块**：`guiNaXingDong` 改成一个 `details.zhiXingKuai`，动作行与中间回复
  **按 ts 升序混排**（中间回复节点加了 `data-ts`）；
- **同一操作只写一次**：新 IPC 通道 `warmy:xingDongShiJian`（台账专用，**带完整路径/命令**；
  控制台那条通道的安全约束"不许带路径"没被破坏），`start` 建条目、`finish` 按 `hao` 改同一条；
- 图标换成 **`F:\XXZ\木马.svg`**（复制到 `renderer/icons/muMa.svg`，随 copy-assets 打包）；
- 右侧状态**只有失败用强调色**（进行中/完成都是 muted，另用左边缘细条区分）；
- 点开三行：**开始 年月日时分秒 · 状态** / **具体内容（完整路径可点＋右键菜单，走"打开编辑"绝不运行）** /
  **更新 年月日时分秒 · 耗时 · 状态**（后续状态变化继续往下追加）；
- 单行**凸出浮雕**（渐变 + 内外阴影 + hover 抬 1px）；
- 展开**不限高、不出滚动条**（`app.css` 与 `renderer.css` **两处都要改**，否则被后者覆盖）。

### 项 15：ASR 转写"明显是错的"——三个真根因
1. **兜底把音频发给了聊天模型**：`warmy:asrZhuanXie` 的兜底写的是
   `asrChatShi(anDie, providerCfg.model || 'mimo-v2.5-asr', …)` —— `providerCfg.model` 是**当前聊天模型**，
   它收到音频不报错、会顺着编一段通顺的话 ⇒ 用户看到"识别错了"。现在只挑真正的听话模型（`nengLiLianMoXing('asr')`），
   没有就如实报 `no-asr-model`。
2. **识别语言写死 `'zh'`** ⇒ 现在跟随设置（`auto` 一个参数都不传）。
3. **降采样混叠**：`blobZhuanWav` 用最近邻抽样 48k→16k，8kHz 以上能量折回（人声的 s/sh/x/f 正在那儿）⇒
   改成**区间均值**（箱式低通+抽取）并去直流。
   另加合理性闸：`字数/秒 > 12` 或同一句重复 ≥3 次 ⇒ 判幻觉。
   **真机验证**：用真实 TTS 音频（"你好，这是第三十五轮的语音识别测试，牛马正在工作。"）喂给真
   `mimo-v2.5-asr`，**转写逐字一致**。

---

## 2. 本轮改了哪些文件（定位用）

| 文件 | 关键改动 |
|---|---|
| `src/builtin-rules.ts`（**新增**） | `MENJIN_A/B/C`、`CHANPIN_MENJIN`、`panDuanLuoDian`、`ZIZHU_GAIZAO_SKILL` |
| `src/electron-main.ts` | 门禁注入 `shenFenTou`；`plan.missing` 宿主校验；`boZhongNeiZhiJiNeng` 播 `warmy-self-modify`；`dangQianXingDong`/`fachuXingDong`/`warmy:xingDongShiJian`；`warmy:luJingCunZai`、`warmy:daKaiBianJi`（`BU_KE_BIAN_JI`）、`warmy:fuJianShouQuan` + `duFang` 守卫；`moXing` 全称 + `turnCount`；`CAPS_VERSION`；ASR 兜底与 `jieGuoHeLi` |
| `src/preload.cjs` | `onXingDong`、`luJingCunZai`、`daKaiBianJi`、`fuJianShouQuan` |
| `src/renderer/app.js` | `NIUMA_BENG`/`niuMaBengGengXin`/预留位 DOM/配速；`guiNaXingDong` 重做 + `xingDongHangNode`；台账 upsert + `bindXingDong`；心内行 footer 重写（tip 合并）；路径正则与 `biaoJiZhenShiLuJing`/`luJingHouXuan`；`__r35` 测试接缝；`blobZhuanWav` 抗混叠；`nengLiBiaoQian` 未知模型 |
| `src/renderer/app.css` / `renderer.css` | 预留位+蹦跶；心内行对齐/间距；声波动效+光环；执行过程不限高；行动行浮雕与状态色（**两份 CSS 都要同步**） |
| `src/i18n/*.json`（10 个） | **扁平键**：改名 7 条（执行过程/执行中…等）+ 新增 11 条 ⇒ 每包 **2771 键，集合相等** |
| `packages/providers/src/ollama.ts` | `decision` 优先；vision 无 completion ⇒ `imageUnd`；名字生成类 ⇒ `imageUnd` |
| `run-verify-22.mjs` | 登记 `verify-round35-changes`（fast）与 `verify-round35-ui`（live） |
| `verify-round35-changes.mjs`（**新增**） | 77 条静态+单元断言（含真跑 `moXingNengLi`、`taoAsrChatBody`、`jieXiSkillMd`） |
| `verify-round35-ui.mjs`（**新增**） | 36 条确定性界面断言（CDP 真点击/真右键/真计算样式） |
| `verify-round35-live-func.mjs`（**新增**） | 17 条**真实功能**断言（真 Ollama 探测 + 真 MiMo 对话 + 真 ASR 音频回环） |
| `verify-round28-changes.mjs` | 把"行动中/行动过程"写死文案的断言改成**口径级**（两个不同的键） |

---

## 3. 本轮踩到并记下的三个新坑（第 36 轮别再踩）

1. **语言包是"扁平点号键"，不是嵌套对象**。写脚本按 `j.chat.actionLog` 改会新建一棵 `chat` 对象，
   而运行时读的是 `state.t['chat.actionLog']` ⇒ 改了等于没改（本轮第一次验收就是这么假绿的：
   界面门禁看到 `行动过程` 才发现）。判据：`Object.keys(j).filter(k=>k.includes('.'))` 才是真键。
2. **正则里出现裸引号会打爆渲染层作用域门禁**。`verify-renderer-scope.mjs` 先做词法剥离，
   `["'`]` 会让它把后面一大段当字符串 ⇒ 报一堆"函数跨作用域泄漏"（`p`/`close`/`k` 全中招）。
   写正则里的引号请用 `\x22`/`\x27`/`\x60`。
3. **两份 CSS 都要改**（`app.css` 与 `renderer.css`，后者后加载）。
   `verify-css-consistency` 专门查这个：本轮 `.siKaoKuai pre` 与 `.yunXingDian.niuMaPao` 各被抓到一次。

---

## 4. 验收方法（本轮新增第三层）

- `verify-round35-changes.mjs`（**77 条**）：一条一判据，写"少了它这项需求就复发"；单元部分**真跑编译产物**
  （`moXingNengLi('clef:latest',{vision:true,kind:'imageUnd'})` ⇒ `decision/imageUnd`；
  `taoAsrChatBody` 的 `input_audio` 与"auto 不传 language"；`jieXiSkillMd` 解析内置技能）。
- `verify-round35-ui.mjs`（**36 条**）：夹具 + 真点击；点击前"滚进视口 + 等矩形稳定 + `elementFromPoint` 命中"；
  用 `window.__r35` 接缝注入消息/台账（门禁专用，生产无调用者）。
- `verify-round35-live-func.mjs`（**17 条**）：**真机真模型**。①真 Ollama `/api/show` 判 `clef` 类型
  ②真 MiMo 对话 + 真工具调用（看行动行/全称/词元/轮次）③**真 TTS 音频 → 真 ASR 转写**回环
  ④附件授权卡真 IPC。**密钥只走 `MIMO_KEY_FILE`**（脚本里不含任何用户路径）。

---

## 5. 已知遗留 / 建议第 36 轮

1. **自我改进回路还是缺口**（项 6）：建议把"归档 → MEMORY 草稿 → 人确认"真正实现，
   并让纠正（赞/踩、失败复盘）能写回 `agents.md`/项目记忆。
2. `chat.tokensTitle` 已不再使用（本模块化后合并进 `tip`），可清；建议做一次**全语言包未引用键扫描**。
3. `panDuanLuoDian()` 目前只有单元级使用；建议接进"安装技能/插件"的真实入口做**校验**（现在靠门禁文本+模型自觉）。
4. 项 3 的后台任务制度目前是"门禁文本 + 界面支持"；若要更强，可让宿主在检测到长任务时**主动**渲染
   "这条任务无需模型参与"的计划状态（现在靠模型自己写）。
5. `verify-round35-ui` 的 `__r35` 接缝是给门禁用的；若将来清理测试钩子，记得同步改门禁。

---

## 6. 首启动交付（本轮已做，可逆）

做法（与本仓惯例一致，**没有删任何东西**）：把 17 项配置/状态**移进**
`%APPDATA%\@warmy\app-shell\__r36-firstrun-<ts>\`
（settings.json / profile.json / appearance.json / plans.json / xiaodi.json / eta*.json / router-queues.json /
ui-queues.json / window-state.json / fonts-cache.json / warmy-boot.log / audit / checkpoints / scan-dirs /
knowledge / instances / Local Storage / Session Storage / Preferences），
**保护区不动**：`identity/`、`secure/`、`memory-runtime/`、`memory/`、`workspace/`、`updates/`、既有 `__*` 备份、
以及 Chromium 纯缓存。
然后用当前构建重开：`cd C:\wbuild\packages\app-shell && ./node_modules/.bin/electron dist/electron-main.js`
⇒ 复核 `settings.json` 是 `setupDone=false`、`instances` 0 条。
**要搬回原样**：先关程序，再把备份目录里的条目 mv 回 `%APPDATA%\@warmy\app-shell\`。

---

## 7. 子代理取舍

本轮派了 **1 个**（`explore`，只读诊断 项 6/7/15，给出 file:line 级根因）。
它在 3 分钟量级内定位到 `ollama.ts:594` 与 `electron-main.ts` 的 ASR 兜底两处真根因，
**质量高于我自己边读边猜**；写码与验收全部由我自己串行完成（同一份构建、同一批门禁，避免互踩）。

---

# 第 34 轮 → 第 35 轮（原文保留）

> 铁律（每轮都适用，别重新摸索）：
> · 回复用中文；脚本一律 `.mjs`；**绝不用 PowerShell 读写源码**（`Set-Content` 会写成 GBK，中文全毁）。
> · 改 `.ts` 后必须 `node scripts/copy-assets.mjs`；改 `app.js` 后必须 `node scripts/check-syntax.mjs`。
> · 仓库路径含中文 ⇒ 构建/门禁统一在 ASCII 绑定目录 **`C:\wbuild`** 下跑。
> · 门禁脚本里**不得出现真实用户路径 / 密钥名**（用 `os.homedir()`；密钥只走 `MIMO_KEY_FILE` 环境变量，只取第一行，永不打印）。
> · 只能派 1 个子代理（必要时再补 1 个善后）。本轮**没有派子代理**（见 §7 的取舍）。
> · 临时文件（`%TEMP%\r34-*`、`warmy-r34-*` profile、`r34-live-*.log`）最后**全部删掉**，但**绝不动不是本轮产生的东西**。

---

## 0. 一句话现状

第 34 轮的 12 项需求全部落码；项 12（真机"任务循环执行好几遍还是没完成"）到这里一共找到并修掉 **17 个真根因**
（前 5 个见下表，6–13 见 §4，**14–17 是本轮收尾从 r35 第 5 次跑的审计里挖出来的**），
外加 **2 个门禁自身的假红来源**（第 18 条：我把"认交付物"改成按文件名猜；以及 5 处写死字节锚的老门禁）。

**停下时的状态（用户要求：跑完这一轮就汇报）**：
`verify-round34-changes` **116/0**、`verify-round34-ui` **38/0**、`run-verify-22 --tier=fast` **65 项次无红**、
i18n 158/0、桌面基线 `new 0 / missing 0`；真机 r36 第 1 计次 **3/4**（MiMo 三次全绿、零续派、三份交付物各自到位），
唯一红的那次里 5 条来自我的门禁假红（已修 + 补了 6 条离线回放），只剩 **1 条真问题**：
27B 偶尔不自报引擎型号（§4 第 19 条，给了三个候选修法）。
⇒ **连续 5 次全绿还没达成（0/5）**；**首启动交付仪式已按用户指令提前做过一次**（配置全部搬进可逆备份目录、程序已用当前构建重开，见本节末）。

本轮把验收方法本身也换了：新增**确定性界面门禁** + **只认"世界状态 + 轨迹"的真机回放 pass^k**（τ-bench 口径），
收尾又加了**可离线回放的判分纯函数**（同一份口径，红/绿不再靠再烧一次 8 分钟真机来确认）。

| # | 真根因（有真机证据） | 后果 | 修法 |
|---|---|---|---|
| 1 | 用户原话说"在桌面生成"，模型却按工具说明的默认口径发**裸文件名** ⇒ 落进工作区，随后再往桌面补一份 | 同一交付物**两份**；多绕一次重复调用；工作区出现桌面副本 | `jiaoFuWuLuoDian()`：执行**前**把裸文件名改成 `Desktop/<名>`，照常走"访问工作区外"授权卡；工作区零副本（审计 `chat.deliverable-target-fixed`） |
| 2 | "一模一样的交付物不做第二遍"的闸**只在续接轮生效**（`if (!benLunXuJie.get(sid)) return null;` 在检查之前） | 首轮就能把同一个 PPT **整篇重造 4 遍**，把工具预算打到顶、整轮被判中断 | 把"同路径同内容/同内容再生成/同路径且文件还在"三条搬进**所有轮共用**的块，保留 `overwrite:true` 逃生口 |
| 3 | **只读探测的重复**被当成"任务在打转"（`chat.tool-repeat-stopped`） | 模型把同一个 pptx 的 zip 条目读两遍 ⇒ 整轮判死 | 只读类回缓存 + 记中性 `chat.tool-repeat-cached`；跨轮 ≥3 次也先判幂等（`ZHI_DU_CHONG_FU`） |
| 4 | **上下文爆炸打死本地模型**：长文每加一段就**整篇重发**，历史里堆了十几份全文 | 实测一次请求 **23 万 token** → Ollama `400 request exceeds the available context size (131072)`，45 秒后整轮报废 | `yaSuoMoXingXiaoXi()` 发请求前压实（旧版整篇正文换成一句说明，只留最新版；**本地历史与用户可见日志不动**）；被 400 拒过 ⇒ 压硬一档**自动重发一次**；写入结果里引导下一段用 `append:true` |
| 5 | **字数永远差最后几十个字**：宿主按**精确值**催写，而达标线其实是 95% | 27B 一路把同一文件写 20+ 遍、每遍只多几十~几百字节，写到**轮数封顶**才停（1183 秒） | 达标线 = `ceil(要求 × 0.95)`；**停滞判定**：同一文件连续 3 次每次增不到 `max(80, 2%)` 字 ⇒ 判定写不动了，明确叫停 + 要它如实汇报，"字数不够"这条续派理由同时作废（`chat.length-stall` / `plan.length-stall-stop`） |

另有 2 个**本轮跑验收时新抓到的**判分面缺陷（已修）：
- 同参数且**此前已成功**的 `write_file` 重复，按幂等定义不该算循环 ⇒ `IDEMPOTENT_CHONG_FU` + `chengGongZhiWen`，`append:true` 除外；
- 模型写完长文后**换个名字另存一份副本去自己数字数**（`novel_check.txt` 5646 字）⇒ `changWenFuZhiLan()`：内容与本任务已写过的长文重合约 ≥80% 且目标文件还不存在 ⇒ 拒写并说明"字数宿主会报给你"。

**首次启动**：**已经做过了（2026-10-17 深夜，用户明确要求"删除配置文件，首启让我验收"）**，
这是在"连续 5 次全绿还没达成"的情况下**按用户指令提前做的**，不是流程走完的产物 ⇒ 第 35 轮跑完 5 连后不必再做一次，
但如果那 5 连期间用户又用了这个实例，收尾时再按同样做法处理一次即可。
做法（**全部可逆，没有删任何东西**）：把 20 项配置/状态**移进**
`%APPDATA%\@warmy\app-shell\__r36-firstrun-1792249873235\`
（settings.json、profile.json、appearance.json、plans.json、xiaodi.json、eta.json、eta-live.json、
router-queues.json、ui-queues.json、window-state.json、fonts-cache.json、warmy-boot.log、
audit/、checkpoints/、scan-dirs/、knowledge/、instances/、Local Storage/、Session Storage/、Preferences），
**保护区一律不动**：`identity/`、`secure/`、`memory-runtime/`、`memory/`、`workspace/`、`updates/`、既有 `__*` 备份、
以及 Chromium 纯缓存（GPUCache/Cache/Code Cache/Network/DIPS/Shared*/Local State）。
然后用当前构建重开：`cd /c/wbuild/packages/app-shell && ./node_modules/.bin/electron dist/electron-main.js`
⇒ 复核到新写的 `settings.json` 是 `setupDone=false`、`instances` 0 头、`instances/` 目录不存在（**只恢复不预置**生效）。
**要搬回原样**：先关程序，再把备份目录里的条目 `mv` 回 `%APPDATA%\@warmy\app-shell\`（脚本 `r36-firstrun.mjs` 只搬走、不覆盖，回搬时同理）。

---

## 1. 第 34 轮 12 项逐条交代

### 1.1 项 1：删掉「本地语音识别（本机服务）」这个预设供应商选项
**实情（要说清楚，别以为我改了个不存在的东西）**：下拉选项本身在**更早的轮次就已经不存在**了。
本轮核实了三处：`GONGYING_YUSHE_JIAN()`（渲染层唯一数据源）、启动页兜底表、用户 `settings.providers` 实测只有 DeepSeek / MiMo / Ollama 三条。
真正还留着的是**两条陈旧文案**，它们还在教用户"去供应商里添加「本地语音识别（本机服务）」"：
`settings.asrLocalHow`、`settings.asrLocalHint` ⇒ **10 个语言包全部删除**。

### 1.2 项 2：牛马管理局调用链"名称和按钮不在同一行、按钮高一截"
根因是**内联样式压过了 CSS**：其中一处渲染点写了 `style="...flex-wrap:wrap"` + `.lianMing{min-width:180px}`。
窄栏里名称放不下 ⇒ 按钮被挤到下一行、视觉上"高一些"。
修法：删掉那处内联 `align-items/flex-wrap/min-width`，对齐统一交给 CSS：
`.shiLiHang.lianHang{flex-wrap:nowrap;align-items:center}` + `> button{height:28px}` + 名称/能力标签 `line-height:28px`。
**界面门禁实测**：逐行比较名称与按钮的垂直中线差 < 6px 且 `offsetTop` 相同（`verify-round34-ui.mjs` 项 2）。

### 1.3 项 3：计划任务不该"按换行秒建"，应由模型按门禁规则添加
已联网核对行业做法后落地：**门禁写进工具说明 + 宿主硬校验**，宿主不再按句替用户拆计划。
`plan_update` 的 description 里现在有：≥3 步才建、新计划 2–10 步、同名步骤去重、同一时刻只允许 1 步 `doing`、
`verified` 只能由 `plan_verify` 给、每步必须是"可验证的动作"（动词开头）、**不许逐句照抄用户原话**、每次提交全量步骤表。
真机门禁断言：`计划不是宿主按句拆的（没有 host-seed）` ⇒ 现在 `host-seed` **只被读来退役历史数据，代码里没有任何地方再写它**。

### 1.4 项 4：设置→功能 的分块顺序
`音频设备 → 本地语音与文字互转 → 信任文件夹（独立成块）`，且「信任文件夹」不再是音频设备的内嵌段。
顺带补齐了三个一直只靠硬编码兜底、语言包里根本没有的键（10 国语言）：
`settings.trustedFoldersTitle` / `settings.trustedFoldersHint` / `settings.addTrustedFolder`。

### 1.5 项 5：图标统一（"ppt 是一个类"，不是只有 .ppt）
同族表 `WEN_JIAN_ZU` 现在覆盖：
- `ppt`：ppt/pptx/pptm/pot/potx/potm/pps/ppsx/ppsm/ppa/ppam/odp/otp/key/dps/dpt
- `biaoGe`：xls/xlsx/xlsm/xlsb/xlt/xltx/xltm/xlam/csv/tsv/psv/ods/ots/numbers/et/ett
- `wenBen`：txt/md/markdown/rtf/doc/docx/docm/dot*/odt/pages/wps/tex/srt/vtt/epub/mobi/azw3…
- `tuPian`/`yinPin`/`shiPin`/`yaSuo`/`zhiXing`/`daiMa` 同样按族铺开
无扩展名的有名文件也认族（README/LICENSE→文本，Makefile/Dockerfile→代码）。
**界面门禁真跑分类函数**（`window.__wenJianIcoLei`）断言同族同图标、未知扩展名 → `kongBai`（瞎猜也算错）。

### 1.6 项 6：第四列授权卡"又到顶部 / 无法展开"
**三个根因，全部实测复现过**（`verify-round34-ui.mjs` 用夹具重放）：
1. 授权卡**不在 `PAN_ALL`** ⇒ 拖拽顺序永远不落盘，每次进来都按默认排到最前；现补 `mianBanShouQuanKuai:'auth'`，并纳入 `applyPanelVisibility` 统一管显隐。
2. **两层折叠状态打架**：授权卡自己的处理器只 toggle 列表 `yinCang`，通用折叠只管卡片 `shouQi`；渲染一次就把列表显示出来，用户点标题反而把列表藏了 ⇒ 读作"点不开"。现统一走 `panKaFanZhuan()`，**卡片级 `shouQi` 是唯一事实**。
3. 展开时还被"收起态存下来的 53px 高度"夹着（`maxHeight` 也一起写死了）⇒ 列表只剩 5px。现在：只认用户**真的拉过右下角**（右下角 18px 内按下）才记高度；只存 >60px 的值；**不再写 maxHeight**；展开时若 inline 高度 <100px 自动放开。
另外：`openChat` 现在会主动 `renderShouQuanKa()`（以前只有广播才渲染 ⇒ 重启后卡是空的）。

### 1.7 项 7：去掉「↻ 刷新」，改动时自动及时刷新
按钮 + 事件 + id 注册表项**全删**。自动刷新链路：
- 主进程 `kaiWenJianJianShi()`：按窗口记账 watcher；会话工作区/产物目录**递归**，项目目录**只盯一层**（可能是整个仓库，递归会注册几万个 watcher 把主进程拖死），外加已显示文件的父目录 ≤8 个；忽略 `node_modules/.git/dist/Cache/点开头`；**防抖 600ms**；`webContentsdestroyed` 时全部回收。
- 铺监听不需要额外接口：渲染层每次显示这张卡都会调 `warmy:xiangMuWenJianJi`，主进程顺手铺上。
- `move_file`/`delete_file` 以前完全不广播 ⇒ 删掉的文件还挂在卡上；现在也发中性 `warmy:wenJianBianGeng`。
- 渲染层：收到变化防抖重画；`gongZuoWenJian` 加 `sid` **按会话过滤**（以前所有会话共用一份，A 牛马的文件会冒进 B 会话）；按真实存在性 `wenJianDaXiao` 逐个 stat，**不存在就剪掉、大小变了就更新**；段落折叠状态存 `window.__pfSectionShou`，自动重画后**重新贴回**（否则每次刷新都把用户收起来的段弹开）。
- 计数器 `state.wenJianBianCi` 经 `__panelDebug()` 暴露，界面门禁用它证明"外部改文件 → 宿主广播 → 卡片重画"这条路真的通。

### 1.8 项 8：思考/模型悬停提示里删掉"已改用上面那个"
两处都改了：主进程降级提示不再拼 `，已改用：X`；渲染层 `jiangJiWenBen()` 同样去掉尾巴（那一行显示的就是最终在用的模型，重复一遍是废话）。语言包键 `chat.modelDegradedTo` 一并删除（10 国）。

### 1.9 项 9：分身卡重做（这条改动最大，主进程也动了）
界面：
- 默认**一行**：`时分 · 任务（截断 46 字）· 状态`（进行中/已完成/已停止）。
- **点该行**展开详情：年月日时分秒、任务全文、**派发者=牛马的名字**（不是 `inst-xxxx`）、**执行者=小弟X号**（并附全名）、**模型全称含供应商**（`MiMo token plan（cn） · mimo-v2.6-flash`）、结束时间。
- **悬停气泡**五项：创建时间 / 任务内容 / 派发者 / 执行者 / 模型。
- **右键菜单**两项：`停止`、`重试`；已停下/已完成的「停止」灰掉，正在跑的「重试」灰掉；选中行有强调外框。
- 竖线与删除线：进行中=强调色竖线；已完成=无竖线；**未完成但已停止=无竖线 + 整行删除线**（`.isStop`）。
- 标题旁计数 `运行:失败:已完成`。
主进程：
- 记录里新增 `presetId` 与 `modelId`（`model` 是给人看的全称，重试要用原始 modelId）。
- **`停止` 现在真的掐掉在途请求**：每个小弟一个 `AbortController`，`liaoTianDaiGongJu` 本来就接 `signal`；以前只改 status，用户看到"已停止"而它还在后台跑完并冒结论。
- 新增 `warmy:xiaoDiChongShi`（+ preload `xiaoDiChongShi`）：**同供应商同模型把同一件子任务真跑一遍**，复用同一个登记条目（编号不变）；正在跑的不许重试；后台跑完由 `paoXiaoDiRenWu()` 统一回写 done/failed/stopped 并广播。
- 派出与重试**共用 `paoXiaoDiRenWu()`**（以前重试没法复用那段内联逻辑）。
- 重启后不再"分身卡不见了"：`renderFenShenKa()` 有数据就 `queBaoKaPian('mianBanFenShenKuai')`，`openChat` 主动拉一次。

### 1.10 项 10：所有卡片都要能折叠（含自定义卡片）
根因两组，都实测复现：
1. **按下即 `setPointerCapture`** ⇒ 规范里后续 `click` 被重新定向到捕获元素 ⇒ 标题、标题里每一行的点击全被拖拽面吞掉。
   改成：**按下只记账，移动超过阈值才起拖**，move/up 挂 `window`（根本不捕获）；只有**真拖过**才吞掉**一次**收尾 click，且 400ms 后自动解除（以前是在拖拽面上永久 `click → stopPropagation`，把标题里的按钮/箭头一起废了）。
2. 分身/定时/项目记忆的标题是 `.mianBanBiaoTi`，**拖拽绑定的选择器里没有它** ⇒ 落进"整张卡片当拖拽面"的兜底 ⇒ 正文每行都被吞。现补进选择器，并**删掉整卡兜底**（没标题行的卡只认左上角手柄，正文一律不动）。
3. 折叠绑定/拖拽绑定的选择器从 `:scope > .mianBanKuai` 放宽到 `.mianBanKuai` —— 自定义卡片在 `#panZiDingYiJi` **容器里面**，用直接子选择器永远绑不到。
4. 折叠状态**落盘**（`settings.panelCardCollapsed`）+ 启动读回（含 `panCards` 顺序、`panelCardHeights`、`customCards`）；以前只写不读，每次重启都回默认。
5. 收起的表达改成 **CSS 唯一事实**：`.mianBanKuai.shouQi > :not([data-ka-title]) { display:none }`。
   ⚠️ **这里我自己引入过一个严重回归并被界面门禁抓到**：靠专用入口折叠的卡（授权/进度/模型）从没被标记 `[data-ka-title]` ⇒ 一收起**连标题都被藏掉**，卡变成 26px 的一条，**折得起来却再也点不开**。修法：把标记补进 `panKaFanZhuan()` 与 `huanYuanKaShou()`，不管走哪条折叠路径都一定打上。
6. 自定义卡片也参与拖拽排序（拖完把 `state.customCards` 的顺序落盘，卡片编号不变）。

### 1.11 项 11：分身卡与计划卡的显示排序（每次内容变化都重排，编号不变）
- 计划：`已完成(verified/done) → 已停止(deleted/blocked) → 进行中(doing) → 刚创建(pending)`。
- 分身：`已完成 → 已停止/失败 → 进行中`（最下面）。
- **只排显示**：`qingLiJiHuaBianHao()`（编号）在排序**之前**跑完，`state.jiHuaRenWu` 数据顺序不动 ⇒ 编号、续派、清理逻辑全部不受影响。
  界面门禁重画两次比对 `data-jh` 序列一致来证明这点。

### 1.12 项 12：见 §0 的 5 个根因表 + §3 的验收方法改造

---

## 2. 本轮改过的文件（定位用）

| 文件 | 关键改动 |
|---|---|
| `packages/app-shell/src/electron-main.ts` | `jiaoFuWuLuoDian`/`jiaoFuWuLei`/`LING_LEI_MING`/`jiaoFuWuGaiXie`/`jiaoFuWuZaiDing`、`buZhouYiZuoGuo` 所有轮共用块 + `keLanTongMing`、`changWenFuZhiLan`、`yaSuoMoXingXiaoXi`、`ziShuJinDuHang` 95% 线 + 停滞、`ZHI_DU_CHONG_FU`/`IDEMPOTENT_CHONG_FU`/`chengGongZhiWen`、`kaiWenJianJianShi` + `xiangMuWenJianJi` 铺监听、`paoXiaoDiRenWu`/`xiaoDiKongZhi`/`warmy:xiaoDiChongShi`、`gongYingShangXianShiMing`、降级提示去掉"已改用" |
| `packages/app-shell/src/subagents.ts` | `XiaoDiJiLu` 新增 `presetId` / `modelId` |
| `packages/providers/src/tools.ts` | `GongJuXunHuanXuan.yaSuoLai` 钩子；`diaoYongMoXing` 超出上下文时压硬一档**重发一次**；事件 kind 增加 `'retry'`；`chunWenBen` 也走压实 |
| `packages/app-shell/src/preload.cjs` | `onWenJianBianGeng`（带退订）、`xiaoDiChongShi` |
| `packages/app-shell/src/renderer/app.js` | `PAN_ALL` 加 auth、`panKaFanZhuan`/`jiZhuKaShou`/`huanYuanKaShou`、`ensurePanCardCollapse`（后代选择器 + 箭头 bug）、`yinPanKaTuo` 惰性起拖重写、`ensurePanCardDrag`（含 `.mianBanBiaoTi`、去整卡兜底）、`ensurePanCardResize`（只认用户拉过、不写 maxHeight）、`applyPanelVisibility` 授权卡 + `huanYuanKaShou`、启动读回四样、`openChat` 主动渲染授权/分身/定时 + `jiHuaLieBiao` 拉计划、`renderShouQuanKa` 不再强补卡、`bindShouQuanToggle` 统一折叠 + MutationObserver 同步箭头、`renderJiHuaKaInner` 统一折叠 + 显示排序、`renderFenShenKa` 重做、`renderProjectFilesBlock` 删刷新按钮/按会话过滤/存在性校正、`jiangJiWenBen` 去尾、图标同族表 |
| `packages/app-shell/src/renderer/app.css` | `.mianBanKuai.shouQi` 规则组、标题 `user-select:none`、`.fenShenZt`/`.fenShenXiang`/`.isStop` |
| `packages/app-shell/src/i18n/*.json`（10 个） | 删 `settings.asrLocalHow`/`asrLocalHint`/`chat.modelDegradedTo`/`panel.workfiles.refresh`/`refreshed`；加 15 个键（分身 12 + 信任文件夹 3）⇒ 每包 **2759 键，集合相等**；**收尾又加 `llm.lengthProgressSoft`（10 国全补，占位符 {n}{p}{y}{x} 逐包校验）⇒ 每包 2760 键**；并把 `localSpeech.title` 的八份英文占位补成真翻译、`chat.voiceNeedAsr` 指向改名后的块 |
| `packages/app-shell/src/work-tools.ts`（收尾） | `workMakePptx` **认等价字段**（content/text/paragraphs/body/bullets/pages）+ **空稿闸**（正文净字数 0 ⇒ 不写文件、如实失败并给 schema）+ 成功行报"正文合计 N 字"；`make_docx`/`make_xlsx`/`make_pdf` 同样加空稿闸；`WorkToolResult.meta` 新增 `ziShu`/`pian` |
| `verify-round34-jiaofu.mjs`（**新增，纯函数**） | `renJiaoFu({xin,kai,dengKai})`：**"哪两份文件才是用户要的交付物"的唯一判据**，按证据强度退级（轨迹 = 30 秒等待前打开的那两份 > 正文关键词 > 文件名关键词），txt/ppt 各认各的、认不到就如实返回空。live 门禁 import 它；changes 门禁拿三次真机实录离线回放它（6 条） |
| `verify-round34-changes.mjs` / `-live.mjs`（收尾） | changes 85→**116 条**（空稿闸、blocked-repeat 中性化、空壳补做放行、弃稿 ≥2 次写入、软话术 + 十国键齐全 + 单元真跑 `workMakePptx/Docx/Xlsx/Pdf` + 6 条交付物认定回放）；live **删掉两条按长度/文件名猜交付物的判据**、改为 import 纯函数并按**路径身份**排除交付物，新增"**不许有空壳交付物**（办公文件正文 ≥20 字）" |
| `verify-model-route.mjs` / `verify-office-doc-suite.mjs` / `verify-eta-forecast.mjs` / `verify-round20-stream.mjs` / `verify-round28-changes.mjs`（收尾） | 五处**字节锚/旧名字**改成**口径级**判据（切片窗口 16000→24000、`tiQuWenDang(p0`→按真实调用、`quEtaYiChang(sessionId)`→`sid` 也认、`huiHuaZhenShiZiShu`→`renWuZiShu` 任一、ASR 断言改为"指引块名 == `localSpeech.title` 值"并检查十国包不指旧名） |
| `run-verify-22.mjs` | 登记 `verify-round34-changes`（fast）与 `verify-round34-ui` / `verify-round34-live`（live）。⚠️ **runner 只有 `--tier/--times/--skip/--keep-going`，没有 `--only`**（今天踩了：写 `--only=` 会被忽略 ⇒ 整份 live 清单全跑） |

---

## 3. 验收方法（本轮换了方法，这是项 12 的另一半）

用户原话："以前也检验过几次，都说通过了，但实际上每次都有问题（同样的问题），所以更换更科学更精准的方法来测试。"
联网核对后的结论：AI agent 的可靠性**不能只看终态**，要看**轨迹**（τ-bench 的 pass^k 要求 k 次全对，不是 1 次；
工具幂等定义是"执行一次与多次终态相同"；重复调用要在执行前用幂等键去重；durable execution 要 journal 已完成副作用）。
本轮据此做了三层：

### 3.1 `verify-round34-changes.mjs`（静态 + 单元，**116 条断言**）
每条都写成"**少了它这轮问题就会复发**"的形式，例如：
`一模一样交付物不做第二遍：所有轮都拦（以前只在续接轮拦）` 用的是
`if (!shiFuGaiQueRen(a)) { … }` **出现在** `if (!benLunXuJie.get(sid)) return null;` **之前**这个结构判据 —— 不是查字符串有没有出现，而是查**顺序**。
单元部分真跑编译产物，不只看源码里有没有那句话：
- `subagents.js`：`XiaoDiDengJiBu` 编号递增、`modelId/presetId` 落盘与重启读回、按会话倒序；
- `work-tools.js` + `doc-extract.js`：**空稿闸真行为**（只给 path 不给 slides ⇒ 如实失败**且不留文件**；
  正文落在 `content` 上也能生成，并且 `tiQuWenDang` 抽回来的正文里真的有标题；docx/xlsx/pdf 的空白参数同样被拦）；
- `verify-round34-jiaofu.mjs`：**6 条离线回放**，拿三次真机实录（自由起名 `身份.txt`、小说追加进短稿的合并事故、空壳 ppt）
  验"认交付物"的三级退让与"两份各认各的"，另验十国语言包新键的占位符一致。
⚠️ 断言里**不要写死变量名/函数名/字节偏移**（本轮 5 条老门禁就是这么假红的）—— 判**行为与关系**，不判字形。

### 3.2 `verify-round34-ui.mjs`（新增，确定性界面门禁，38 条）
把**触发条件本身做成夹具**，这样"能不能展开/折得起来/排得对"每次都能重放：
- `panelCardHeights.mianBanShouQuanKuai = 53`（就是那个压死展开的收起态高度）
- `panCards` 里授权卡**排在第 3 位**（验证"不再回到顶部"）
- `xiaodi.json` 4 条：running / done / stopped / failed 各一，顺序故意打乱（验显示排序）
- `plans.json` 5 步混排 4 种状态；`customCards` 1 张；`authGrants` 3 条
- 工作区放两个文件，其中一个**从外部删除**（验监听 → 广播 → 自动重画 → 剪掉）
关键手法：点击前**先滚进视口 + 轮询到矩形稳定 + 回读 `elementFromPoint` 确认命中**，
并在每条断言里把"命中了什么元素"打出来。⚠️ 第一版没做这步，把好功能误判成"点标题不能收起"——
**界面自动化测不出来"点得到点不到"，是这个方法论层面的坑，第 35 轮别再踩。**
真实右键走 CDP `Input.dispatchMouseEvent(button:'right', contextmenu:true)`，不是合成事件。

### 3.3 `verify-round34-live.mjs`（真机原样回放，pass^k）
用户那句六件事的提示**一字不改**回放；判分只认**世界状态 + 轨迹**：
`<桌面>` 桌面差分、审计事件序列、Ollama `server.log` 的 4xx/5xx、授权卡次数、字数进度次数、
"同一个文件没有被整篇重写第二遍"、"工作区里没有桌面交付物的同名副本"、
"没有哪一轮是被轮数/预算截断收场的"、"模型想重做已完成步骤的次数 ≤2"、
**"生成的办公文件不是空壳（正文净字数 ≥20）"**（本轮新加，r35-live5 那个 9 字 ppt 就是这么漏网的）。
**"哪两份才是交付物"不再写在门禁里**，改成 import `verify-round34-jiaofu.mjs` 的纯函数
（轨迹 > 正文 > 文件名，txt/ppt 各认各的），门禁只负责把它的结论拿去判分 ⇒ 口径可以离线回放，不用每次烧 8 分钟真机。
**跑法（必须带这两个环境变量）**：
```bash
cd /c/wbuild && MIMO_KEY_FILE="%USERPROFILE%\.openclaw\workspace\<中文工作区目录>\<密钥文件>.txt" \
  WARMY_OPEN_PATH_DRYRUN=1 node dev/gates/verify-round34-live.mjs --trials=3 --ollama-trials=1 --all > "$TEMP/r34-live-*.log" 2>&1
```
- 日志**最后一行 `exit=N` 才是真结果**（后台任务的 exit code 不可信）。
- `WARMY_OPEN_PATH_DRYRUN=1` 走完整条打开链路但不真弹 Office（否则锁住测试产物、用户桌面弹一堆窗口）。
- 端口从 9971 起按试验递增；profile 默认**保留**以便复盘（`· profile 保留以便复盘：…`）。

### 3.4 关于 8B 与 27B（诚实边界）
本机 24G 显存能装下的最强视觉模型是 `huihui_ai/qwen3-vl-abliterated:8b`，它**写不出 6000 字、也读不懂 svg**。
这不是宿主问题，是模型能力问题 ⇒ 视觉链用 `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M-128K` 打头，
主对话也用它，8B/4B 只做降级候选。**别把"换了个更小的模型就跑不出来"当成宿主要修的 bug。**

---

## 4. 第 34 轮验收计数（真实状态，含失败与教训）

协议：**前 3 次只验收本轮变更（changes + ui + live），后 2 次全面验收整个项目（fast 全量 + live 全量）**；
**只要改过构建就从第 1 次重新计数**。

静态/界面层目前稳定全绿（多轮重复验证）：`verify-round34-changes` **90/0**、`verify-round34-ui` **38/0**、
i18n **158/0**、模板配平、作用域检查、TS 编译全绿；桌面基线每次核对 `new 0 / missing 0`。

真机回放（`verify-round34-live`，3 次 MiMo + 1 次 Ollama）共跑了 **8 次**，每次暴露一个**更下游**的真缺陷：

| 次数 | 结果 | 暴露并修掉的根因 |
|---|---|---|
| 1 | 2/4 | ①落点错（工作区副本）②同内容重做只在续接轮拦 ③只读重复被判循环 |
| 2（中止） | — | 构建与最终代码不一致 ⇒ **主动停**，不能拿不一致的产物当验收 |
| 3 | 2/4 | ④上下文爆炸（23 万 token 打死 12.8 万窗口）⇒ 压实 + 超限重发 + 引导 append |
| 4 | 2/4 | ⑤字数永远差几十个字 ⇒ 95% 达标线 + 连续三次微增量判停滞并**叫停** |
| 5 | 2/4 | 幂等重复（同参已成功的 write_file）被误判循环；跨轮 ≥3 次同样误判 |
| 6 | 2/4 | 模型**另存副本自查**（`ppt验证副本.pptx`）与换名重做 ⇒ 加"同目录同族"守卫 |
| 7 | **0/4** | ⚠️ **上一条守卫是我自己引入的误伤**：同任务里"桌面 txt + 一份 6000 字小说"是两个合法 .txt，被"同族第二份"拦掉 ⇒ 小说写不出来 ⇒ 四连同红 |
| 8 | 3/4 | ⚠️ 上一条守卫是我自己引入的**误伤**：同任务里"桌面 txt + 一份 6000 字小说"是两个合法 .txt，被"同族第二份"拦掉 ⇒ 小说写不出来 ⇒ 四连同红。判据已改成"**归一化同名 或 内容重合 ≥50%**" |
| 9 | **3/4** | **MiMo 三连绿**（454s / 441s / 477s，失败项全为"无"）。只剩 `r34-ollama-4`：本地 27B 跑这条六件事任务要 **1657 秒**，撞到轮数/预算上限收场，并按设计弹出"请你选下一步"决策卡 ⇒ 两条红 |

### 第 10 次跑：我在追的那条红**已经修掉了**，但又暴露一条更下游的

| 试验 | 结果 | 用时 |
|---|---|---|
| r34-mimo-1 | **PASS** | 417s |
| r34-mimo-2 | FAIL | 622s |
| r34-mimo-3 | **PASS** | 375s |
| r34-ollama-4 | **PASS** | **447s**（上一次是 1657s 撞上限红） |

**修法生效**：给长文预加 8 轮 + 预算按"是否还在有效推进"动态翻倍之后，本地 27B 从"1657 秒被上限掐死 + 弹决策卡"
变成 **447 秒正常跑完、失败项为无**。⇒ 证实那条红确实是"额度不够"，不是宿主逻辑错。

**新暴露的第 8 个根因（弃稿重来）**：MiMo 第 2 次的轨迹是
`小说_钟表匠的最后一课.txt` 写 3 遍（没到 6000 字）→ **半路又开 `小说_修钟的人.txt` 从头写 3 遍**
⇒ 桌面上两篇都不够长（判分同时红在"小说字数不够""桌面多出东西""长文只有一份"）。
这跟"换名重做同一份"不是一回事：文件名不同、内容也不同，前面那条守卫**故意不拦**它（否则会误伤
"第一篇写完用户还要第二篇"这种合法情况）。
已加精确判据 `abandon-draft`：**同目录里存在一篇"写了 ≥800 净字但还没到 95% 达标线"的长文**时，
再新建一篇长文就拒，并点名那篇没写完的、要求它对**那个原样路径** `append:true` 接着写；
第一篇一旦到线，第二篇就放行（合法情况仍然不误伤）。

### 计数进度（真实）

| 计次 | 构建 | changes | ui | live（3×MiMo + 1×Ollama） | 桌面差分 |
|---|---|---|---|---|---|
| 1 | 含 abandon-draft | 90/0 | 38/0 | **4/4 PASS**（MiMo 407/432/371s 零续派；Ollama 702s、1 次续派） | new 0 / missing 0 |
| — | 又改（见下 11–13） | 93/0 | 38/0 | 第 2 计次跑过后作废重计 | — |
| 1′ | 含 open_path + ask-length + abandon-draft | 93/0 | 38/0 | **4/4 PASS，四次全部零续派**（338/367/418/545s） | new 0 / missing 0 |
| 2′ | 同上 | 93/0 | 38/0 | **跑中** | — |

⇒ **当前连续全绿 1 次**（协议要求：3 次本轮 + 2 次全项目，中途改构建即归零重计）。

### 第 11–13 个根因（真机 r35 第 2 次跑暴露，已修）

那次 MiMo 三次仍全绿，红在本地 27B，且是**一条因果链**：
写到 3507/6000 字时它先被记了一次 `open_path` 循环异常，接着**弹决策卡把"长文还差字数要不要补完"抛回用户**，
于是那一轮以"问用户"收场 ⇒ 小说不够长、最终回复变成目录索引 ⇒ 5 条判分同时红。

1. **`open_path` 被通用指纹闸抢跑**：宿主本来有更准的处理（`huiHuaYiDaKai`：本任务已打开过的文件不再重复打开，
   如实回"已经打开过了"，算正常完成）。通用 `zhiWenPaiChu` 里没有它 ⇒ 抢在先、记成 `tool-repeat-stopped`。
   修法：把 `open_path`/`open_file` 加进 `zhiWenPaiChu`，交回专用处理。
2. **"长文差多少字"不许弹决策卡抛回用户**（产品口径：这种问题不配打断用户，答案永远是"继续写"）：
   仅当"用户确实要求了字数且还没到 95% 达标线"且问句在说长文/篇幅/补完/续写时 ⇒ 不弹卡，
   回它"对那个原样路径 `append:true` 继续写；写不动就停下如实汇报，不要问、也不要另起一篇"（审计 `chat.ask-length-blocked`）。
3. **弃稿重来**（第一篇没写完就另起文件名从头写第二篇）⇒ `abandon-draft`：
   同目录存在"写了 ≥800 净字但未达 95% 达标线"的长文时，新建第二篇长文被拒并点名那篇没写完的；
   第一篇到线后放行第二篇（合法情况不误伤）。

### 第 14–17 个根因（真机 r35 第 5 次跑暴露，已修；等 r36 五连验收确认）

那次 4 个试验红了 2 个，而且**两个红是同一条因果链上的不同段** —— 逐条对着审计与保留的 profile 复盘出来的：

1. **`make_pptx` 会"成功地写出一个空壳"**（r35-live5-ollama-4：桌面上 `我是谁你是谁.pptx` 提取出来只有 **9 字**，
   连用户要的标题都没有 —— 那 9 个字是模板自带的占位字）。原因：模型这次没发 `slides`（正文落在 `content` 上），
   旧代码兜底成 `[{title:'',body:['']}]` **照样写文件、照样 ok=true**，`plan.evidence-autoverify` 还把那一步判成了 verified
   ⇒ **假成功比失败更危险**：审计全绿、用户拿到空文件。
   修法三件（`work-tools.ts`）：① 认等价字段（`content/text/paragraphs/body/bullets/pages`）把内容救回来；
   ② **空稿闸**：参数里的正文净字数为 0 ⇒ **不写文件**、如实失败并点名该填哪个字段（`make_docx/make_xlsx/make_pdf` 同样加上）；
   ③ 成功行报"正文合计 N 字"，模型自己也能看见写进去多少。
2. **被守卫拦下的调用，原样重发一次就被记成循环**（同一条审计：`chat.tool-repeat-stopped … lei:"fei-ming-deng"`）。
   守卫的拦截话术本身就在教模型"带上 overwrite:true 再发一次"，而通用指纹闸只看到"同参数第二次出现" ⇒ 判死整轮。
   修法：`lanXiaZhiWen` 记住被拦的指纹与当时那段说明；重发时**原样回那段说明**并记中性的 `blocked-repeat`
   （`chat.tool-repeat-cached`），不再进"循环异常"名单。
3. **"本任务刚产出的文件不许重做"把补做空壳也拦了**（`chat.write-overwrite-blocked liYou:"regen-own"`，就在模型
   用 `read_pptx` 自己发现那份 PPT 是空的之后 10 秒）。修法：`benRenWuZiJiChanChuLan()` 的生成器分支先看**磁盘事实** ——
   用 `tiQuWenDang()` 抽那份文件的正文，净字数 < 20 ⇒ 放行重做（审计 `chat.deliverable-repair`）。
   ⚠️ 这条与第 7 次的教训同型：**守卫必须留出"合法补做"的口子**，否则拦下来的是修复而不是打转。
4. **字数要求 latch 到错误的文件上**（r35-live5-mimo-1：用户同时要 ①《你是谁，我是谁》txt ②6000 字小说，
   模型把 ① 写了 876 字（恰好超过 720 的门槛）⇒ 宿主的进度行直接命令它"对这个路径 append 到 6000 字"，
   ② 的新文件又被**弃稿闸**拦住（它只看字数窗口，看不出"只写过一次"），于是小说被追加进短稿，
   桌面只剩一份 6144 字的混合文件 ⇒ 两条要求都没交付，判分连着红 5 项）。
   修法两件：① `xieRuCiShu` 记录每个路径被成功写入的次数，**弃稿闸只在同一份写过 ≥2 次时才认为"真有半篇长文没写完"**；
   ② 第一次报字数时**把判断交回模型**（新话术 `llm.lengthProgressSoft`，十国语言包都已补）：
   "这份就是那篇长文 ⇒ 继续 append；这份只是短交付物、长文还没开工 ⇒ 直接新建那个文件"。同一份写第二次就恢复成明确命令。

**同时修掉的 5 处"门禁自己不精准"**（这些不是产品缺陷，但会制造假红，一样要改）：
`verify-model-route` 的聊天切片写死 16000 字符（路由代码被本轮接线顶到 17.7k 之外）⇒ 放宽到 24000；
`verify-office-doc-suite` 按变量名 `tiQuWenDang(p0` 判（变量已改名 `absD`）⇒ 改判真实口径；
`verify-eta-forecast` 写死 `quEtaYiChang(sessionId)`（实参已统一成 `sid`）⇒ 两个都认；
`verify-round20-stream` 写死旧函数名 `huiHuaZhenShiZiShu`（本轮改名 `renWuZiShu`）⇒ 认任一名字、仍要求 ≥3 处调用；
`verify-round28-changes` 的 ASR 断言指向本轮已删除的键 `settings.asrLocalHint` ⇒ 改成口径级检查
（指引里的块名必须等于 `localSpeech.title` 的值、十国包都不许再指旧块名）。
**顺带抓到一条真的产品缺陷**：话筒不可用时的提示写的是"设置 → 功能 → 本地语音识别"，
而那块本轮已改名"本地语音与文字互转" ⇒ 用户照着找不到；十国语言包的 `chat.voiceNeedAsr` + `localSpeech.title` 已同步
（另发现 `localSpeech.title` 此前只有中英两份是真翻译，其余八份是英文占位，已补）。
真机门禁新增一条**空壳交付物**判分：桌面上每个办公文件（ppt/doc/xls/pdf）抽出来的正文净字数必须 ≥20。

### r36 第 1 计次（收尾四项修好之后第一次跑，用户要求"跑完这轮就停下汇报"）

| 试验 | 结果 | 用时 | 关键事实 |
|---|---|---|---|
| r34-mimo-1 | **PASS** | 471s | **零续派**；桌面三份各自到位（ppt 279 字 / txt 416 字 / 小说 6127 字） |
| r34-mimo-2 | **PASS** | 488s | 零续派 |
| r34-mimo-3 | **PASS** | 1150s | 零续派（这条最长，仍没撞上限） |
| r34-ollama-4 | FAIL | 429s | **6 条红里 5 条是我自己写坏的门禁假红**，只有 1 条是真问题（见下） |
| 界面门禁 | **38/0** | — | 项 1/2/4/5/6/7/9/10/11 全绿 |
| 桌面基线 | `new 0 / missing 0` | — | 跑前跑后各 30 项，无残留、无用户文件被动 |

**收尾那四项修生效了**：本轮 4 个试验 `续派 zong=0`（以前每轮 1–6 次续派），
没有任何 `chat.tool-repeat-stopped` / `regen-own` / `abandon-draft` / `fei-ming-deng`，
也没有空壳 ppt（`make_pptx` 现在要么写出有正文的、要么如实失败）。

**第 18 个根因 = 我自己引入的门禁假红（必须记进教训）**：我把"认交付物"从"正文含两句 + <2000 字"
改成"按文件名含「你是谁」"，可用户原话是「生成一个txt文本，生成一个ppt，**写入** 你是谁，我是谁」——
**根本没规定文件名**。27B 起名叫 `身份.txt` / `身份.pptx`（小说另起 `牛马记.txt`，6234 字），
于是判分认不出交付物 ⇒ **一条假红级联成 4 条红**（"没有 txt""打开的不止那两个""桌面多出东西""两个文件各打开一次"）。
修法：判据抽成**可离线回放的纯函数** `verify-round34-jiaofu.mjs`，按证据强度退级
**轨迹（30 秒等待前打开的那两份）> 正文关键词 > 文件名关键词**，txt / ppt **各认各的**
（第一版写成"两份都凑齐才算数"，会把已经认出的那份也丢掉 —— 这个 bug 是回放 B 抓出来的）；
后面三条判分共用同一份结果、按**路径身份**排除交付物。
`verify-round34-changes` 里加了 **6 条离线回放**，用三次真机实录（自由起名 / 合并事故 / 空壳 ppt）钉住口径 ⇒ **116/116 全绿**，
不用再烧一次 8 分钟真机去验门禁。
同时**取消**了我加的"正文必须逐字写着你是谁/我是谁"这种措辞级判据（`身份.txt` 写的是"我是牛马-1，你是老板"，
语义正是用户要的那两句）；改为硬判"这份非空 + ppt 正文 ≥20 字（防空壳）"。

**唯一剩下的真问题（第 19 条，未修）**：27B 这条回复没自报引擎型号——
"模型：我本身不绑定具体型号，底层模型由你在 WArmy 设置里配置，我这边不一定知道自己具体是哪一只基座"，
于是 `回复里说了在用什么模型` 判红。同一模型在 r35 第 4 次跑里答对过（报了 `orcarouter/Qwen3.8-27B…`）⇒
**非确定性行为**。候选修法（按推荐顺序）：
1. **宿主补事实**：把"你正在用的模型：<供应商名> · <模型 id>"作为**必答项**写进身份/系统提示的这一段（`context-renderer.ts`），
   并要求"用户问用什么模型时必须原样报这一行"。MiMo 与 27B 都答得出来，且不依赖模型自觉。
2. **验收口径加一条硬事实**：审计里本来就有 `chat.model-picked`，可以判"回复里出现供应商名或模型 id 的子串"，
   而不是只 `/qwen|huihui|ollama/i` 正则 —— 现在这条正则对 27B 的回答其实够用，是它压根没提。
3. 不动产品，把这条红在 **Ollama 试验**上标成"记录不判死"—— **不推荐**（这正是"验收说过了下次又犯"的老路）。

### 计数进度（真实，截至停下时）

| 计次 | 构建 | changes | ui | live | 桌面差分 |
|---|---|---|---|---|---|
| r36-1 | 含第 14–17 条修复 | 106/0 | 38/0 | **3/4**（唯一红 = 门禁假红，已修门禁） | new 0 / missing 0 |
| r36-1′ | 同上 + 门禁抽函数 | **116/0** | 38/0 | **未重跑**（用户要求停下汇报） | new 0 / missing 0 |

⇒ **连续全绿 0 次**（协议要求连续 5 次：3 次本轮 + 2 次全项目；改过门禁判据也必须重新计数，
因为"测量仪器换了"就不能拿旧读数充当新读数）。**首启动交付仪式因此还没做。**
**下一轮怎么接**：直接按 §6 的命令跑 r36 第 1 计次（changes 116 + ui 38 + live 4 次），连续到 5 次全绿，
再做首启动（§0 末尾的固定做法），最后按 §5 处理遗留。若第 1 次就红在 `回复里说了在用什么模型`，
先落 §4 第 19 条候选 1（宿主补必答行），因为它同时修 MiMo 与 Ollama 两条链路。



### 计数进度之前的历史记录（第 1–10 次怎么一步步收敛的）

| 1–9 次 | 依次暴露并修掉 |
|---|---|
| 1 | 落点错（桌面交付物在工作区留副本）／同内容重做只在续接轮拦／只读重复被误判成循环 |
| 2 | （主动中止：构建与最终代码不一致，不能拿它当验收） |
| 3 | 上下文爆炸 23 万 token 打死本地模型 ⇒ 发请求前压实 + 超限重发一次 |
| 4 | 字数永远差几十个字 ⇒ 95% 达标线 + 连续三次微增量判"写不动了"并叫停 |
| 5 | 幂等重复（同参已成功的 write_file、跨轮 ≥3 次）仍被误判成循环 |
| 6 | 换名重做／`copy_file` 另存"验证副本"去自查 ⇒ 加同目录守卫 |
| 7 | **我自己引入的误伤**：把合法的"桌面 txt + 小说 txt"当重复拦掉 ⇒ 四连同红（教训已写进 §4 第 35 轮清单） |
| 8 | 判据收窄为"归一化同名 或 内容重合 ≥50%" |
| 9 | 长文额度：MiMo 3/3 绿；Ollama 因固定轮数/预算被掐死 ⇒ 改为长文预加 8 轮 + 预算按有效推进动态翻倍 |
| 10 | 弃稿重来（第一篇没写完就另起一篇从头写）⇒ `abandon-draft` 精确判据 |

红在本地 27B，不在宿主主链路（MiMo 已三连绿）。性质是**慢模型 + 宿主上限**的组合：
27B 写 6000 字长文每段只能出 1300–2000 字，`ziShuJinDu` 要催 4–6 次，单次响应又要 60–180 秒，
于是累计到 `zuiDaLunShu`(20，动态最多 32) / `toolCallBudget`(40) 才停，停了就按"到顶"弹决策卡问用户。

三个候选（按推荐顺序）：
1. **只给"长文续写"单独放宽轮数，不全局放宽预算**：仅当 `yaoQiuZiShu()>0` 且**仍在有效增长**（本次净增 ≥ 上次的 60%）时多给几轮；净增一掉就立刻停。既让 27B 写得完，也不给"打转"续命。
2. **宿主分段驱动长文**：把"还差 N 字"的续写次数限成 `ceil(差字数 / 每段中位字数)`（现在写长文续派硬顶是固定 8 次，与模型单段实际产出无关），超了就如实汇报当前字数。
3. **确认是模型能力边界后调验收口径**：同一条任务 MiMo 三次全绿、只卡本地 27B 时，可把"到顶 / 决策卡"两条红在 **Ollama 试验**上降级为"记录但不判死"，但必须同时写明是哪一步慢 —— **不许静默改成永久绿**。

### 必须记住的三条教训（第 35 轮别再犯）

1. **"加守卫"最容易犯的错是误伤合法情况**。本轮我就犯过一次（第 7 次四连红）。
   所以任何新守卫落地时，**必须同时写一条"合法情况不被拦"的断言**（例：长文一段段变长要放行、
   同目录两份不同主题的文件要放行）。这条比"能拦住 bug"更重要。
2. **中止真机验收会留下桌面残留**（脚本走不到自清理）。本轮出现过一次 `new 2`，另一次是模型把小说写进
   `<桌面>novel/` 子目录 ⇒ 目录不在脚本的"逐文件归属"清理范围内。**中止或失败后必须先 `r34-xzm-diff.mjs` 核对并手工清掉自己造成的残留**，
   否则下一轮的基线被污染，会出现"看起来全红但其实不是产品问题"的假象（本轮第 1 次就这样白跑了一轮）。
3. **界面自动化测不出"点得到点不到"**：必须先滚进视口 + 等矩形稳定 + 回读 `elementFromPoint` 命中目标，
   否则会把好功能误判成坏（本轮第 1 版界面门禁就误判过"点标题不能收起"）。
4. **"ok=true"不等于成功**（§4 第 14 条）。工具层最容易骗人的就是"写出一个文件并报成功"。
   凡是生成类工具，**返回前必须量一次参数里的正文有没有真的进文件**（净字数/页数/工作表数），
   并把量到的数**回给模型**；门禁也要有一条按文件系统事实的"不许有空壳"判据。
   否则审计全绿、计划步骤被自动判 verified，而用户打开是个空 PPT。
5. **门禁的判据不要锚在会漂的东西上**（变量名、函数名、字节偏移）。本轮一次改构建就同时打红 5 条门禁，
   全部是"锚漂了"而不是"产品坏了"：写死 16000 字符的切片窗口、`tiQuWenDang(p0`、`quEtaYiChang(sessionId)`、
   旧函数名 `huiHuaZhenShiZiShu`、已删的 i18n 键。**改成口径级**（认任一名字、认调用关系、认块名一致性）之后才是可复用的门禁。
   反过来也成立：**门禁假红要当场修门禁**（并在交接里写明它不是产品缺陷），否则会像本轮第 1 次那样白跑一整轮。

---

## 5. 已知遗留 / 建议第 35 轮做

0. **五连验收没跑完**（这是**唯一**还挡着"交付仪式"的事）：收尾的 4 个根因（§4 第 14–17）落码后，
   只跑了 **r36 第 1 计次**（结果见 §4 末尾）。协议要求**连续 5 次全绿**（3 次本轮 + 2 次全项目），
   中途任何一次红 ⇒ 修完**从第 1 次重新计数**。跑完 5 次才做 §0 末尾的"首启动交付仪式"。
1. **`verify-round34-live.mjs` 建议加一条前置预警**：监听 `chat.context-compressed` 的 `yuanZiShu`，
   超过 ~30 万字符就**在 400 之前**报警（现在只能事后从 `Ollama 4xx` 看出来）。本轮没加，因为**跑验收期间不能改门禁**（改了要重新计数）。
2. `buZhouYiZuoGuo` 续接轮分支里 `write|key` 相同内容的判断，与新的"所有轮共用块"有重叠（当前无害、但重复），可以合并。
3. 进度卡/协助卡仍用**各自**的折叠实现（只 toggle 内部列表 `yinCang`），没走 `panKaFanZhuan`。
   功能上没问题，但它们是"两层状态"这一类 bug 的下一个候选 ⇒ 建议统一。
4. 分身 `重试` 的并发保护目前靠"正在跑不许重试" + `list_subagents`；没有"同一父牛马同时跑 N 个小弟"的节流。
5. `docs/GATE-MANIFEST.json` 里没有 round27/28/34 的条目（runner 只用它取 known-red，所以不影响），要统一登记时一起补。
6. 第 30 项 `settings.asrLocalHow` 那类"陈旧文案"建议做一次**全语言包未引用键扫描**（本轮只清了语音相关的 2 条 + 图标/降级 3 条 + 收尾的 `llm.lengthProgressSoft`）。
   同族问题本轮又抓到一条并已修：**块改名了但指引没跟着改**（话筒提示仍说"本地语音识别"）。
   值得做成门禁：`verify-i18n-locales` 里加"**文案里出现的『设置 → …』块名必须能在 `localSpeech.title` / 分区标题里找到**"。
7. **软话术仍可能不够**（§4 第 17 条）：`llm.lengthProgressSoft` 把"这份是不是那篇长文"的判断交回模型。
   本地 27B 这类弱模型可能仍把小说追加进短稿。若 r36 后续计次再出现这条红，**下一步做硬事实判别**：
   用任务原话里点过的交付物名（正则抽《》/"你是谁我是谁"这类专名）建立"短交付物名单"，
   **命中名单的路径一律不挂字数目标**（而不是靠话术劝）。
8. `zhiWenOf()` 仍按 JSON **前 400 字符**算指纹 ⇒ 长正文里"路径/标题在前、正文在后"的两个**不同**调用可能撞指纹
   （本轮靠 `lanXiaZhiWen` + 空稿闸绕开了实际事故，但根子还在）。建议改成"路径 + 全文哈希"。

---

## 6. 常用命令（照抄可用）

```bash
# 构建（改了 .ts 必须跟着 copy-assets）
cd /c/wbuild && node node_modules/typescript/bin/tsc -b packages/providers packages/group-router \
  packages/sync-protocol packages/app-shell packages/knowledge-base
cd /c/wbuild/packages/app-shell && node scripts/check-syntax.mjs \
  && node scripts/verify-renderer-template-balance.mjs && node scripts/verify-renderer-scope.mjs \
  && node scripts/copy-assets.mjs && node scripts/verify-i18n-locales.mjs

# 本轮三层门禁
cd /c/wbuild && node dev/gates/verify-round34-changes.mjs     # 116 条（含 work-tools 空稿闸真行为 + 交付物认定 6 条离线回放）
cd /c/wbuild && node --check dev/gates/verify-round34-jiaofu.mjs && node dev/gates/verify-round34-ui.mjs
# 真机（一次计次 = 界面 + 真机串跑，中间无空档；密钥只走环境变量、只取第一行、永不打印）
cd /c/wbuild && (node dev/gates/verify-round34-ui.mjs; echo "ui-exit=$?"; \
  MIMO_KEY_FILE="<工作区上级目录>/<密钥文件>.txt" WARMY_OPEN_PATH_DRYRUN=1 \
  node dev/gates/verify-round34-live.mjs --trials=3 --ollama-trials=1 --all; echo "live-exit=$?") \
  > "$TEMP/r36-live-<N>.log" 2>&1
#    ⇒ 判读只看两处：每行 `FAIL` 的标题，和最后 `试验 4 次 · 过 X · 败 Y` + `gate-exit=`（exit=0 才算这一次绿）

# 全项目
cd /c/wbuild && node dev/gates/run-verify-22.mjs --tier=fast            # 约 65 项次
cd /c/wbuild && node dev/gates/run-verify-22.mjs --tier=live            # 已知红用 --skip=verify-round16 挪出清单（只在日志注明，不改代码）

# 桌面基线核对（每次真机验收前拍快照、跑完必须 new 0 / missing 0）
cd "$TEMP" && node r35-xzm.mjs snap "$TEMP/r36-xzm-before.json"     # 拍快照（当前 30 项）
cd "$TEMP" && node r35-xzm.mjs "$TEMP/r36-xzm-before.json"          # 跑完核对差分
#    ⚠️ `snap` 必须带第二个参数（文件名）；漏了会 ERR_INVALID_ARG_TYPE
```

**安全红线**（本轮踩过、务必遵守）：
- 杀进程**只按 PID**，且只杀**自己起的**带 `--remote-debugging-port` 的 Electron；**绝不用 `taskkill /IM electron.exe`**（会杀掉用户的正式实例）。
- 渲染层从 `dist/renderer` 加载 ⇒ **真机验收跑着的时候不要 copy-assets/构建**（会把在测的构建换掉，等于没测这份代码）。
- 门禁/脚本里不要出现真实用户路径与密钥名。

---

## 7. 本轮的子代理取舍（说明，不是遗漏）

允许派 1 个子代理，但本轮**没有派**：项 12 的进展完全依赖"跑一次真机 ⇒ 读轨迹 ⇒ 改宿主 ⇒ 重新计数"这条串行链路，
拆给子代理会让它拿到一份**正在变的构建**和一份**已被污染的桌面基线**，风险高于收益。
界面门禁与静态门禁的部分本可并行，但两者都要 `copy-assets` 到同一个 `dist` ⇒ 会互踩。

---

## 8. 联网核对过的外部依据（第 35 轮要辩护"为什么这么做"时引这些）

- τ-bench（pass^k：k 次全对才算稳，单次通过不代表可靠）：arXiv 2406.12045
- 工具调用**幂等**与去重（幂等键 = 工具名 + 规范化参数；只读可安全重放，写操作必须去重；LLM agent 因超时/校验错误会重放 15–30%）
- **Verified tool calls**：盲目重试会导致重复动作与状态损坏 ⇒ 重试要带校验（arXiv 2608.02645）
- OpenAI Agents SDK：`reset_tool_choice`、max-turn 与完成判定**交给模型自然停止**，不拿"状态未 verified"当续派理由
- LangGraph / Temporal：**durable execution + journal**，已完成副作用恢复时不重跑（对应本轮 `benCiRenWuBuZhou` 台账扩到所有轮）
- Manus 上下文工程：**压缩/卸载大负载**，把被取代的旧正文换成可寻址的短说明（对应 `yaSuoMoXingXiaoXi`）
- Claude Code：写前必读、TodoWrite 进度外置（对应【字数进度】由宿主报数、不许自数）
- Codex / OpenHands / smolagents：工具轮数与预算的显式上限与到顶语义（"预算用完就停下如实汇报"，不是"被拒绝"）
- WAI-ARIA APG Disclosure Pattern：折叠必须**同一状态只有一处真相**（对应本轮两层 `yinCang`/`shouQi` 打架）
- Material Icon Theme：**按文件族**给图标（pptx 归 PPT 一族）—— 项 5 的依据
- Node `fs.watch` / chokidar：递归监听要限深度与忽略目录，否则 watcher 爆炸 —— 项 7 的依据
- Pointer Events 规范：`setPointerCapture` 会把后续 `click` 重定向到捕获元素 —— 项 10 的依据
- MiMo / Ollama 官方文档：能力端点与模型上下文窗口取值（`contextLen` 真实值优先于写死对照表）
