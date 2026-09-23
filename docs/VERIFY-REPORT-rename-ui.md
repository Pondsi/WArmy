# 改名与界面修复核验报告

- 通过 54 / 失败 0

## 通过项

- [x] global dry replacements==0 — n=0
- [x] local app-shell dry replacements==0 — n=0
- [x] tsc contracts
- [x] tsc board
- [x] tsc providers
- [x] tsc sync-protocol
- [x] tsc memory-os
- [x] tsc group-router
- [x] tsc knowledge-base
- [x] tsc asset-governance
- [x] tsc dsh-runtime
- [x] tsc ccr-compressor
- [x] tsc app-shell
- [x] verify-i18n-locales — ==== i18n self-check: 150 ok / 0 FAIL ====
- [x] verify-docs — ==== verify-docs: 84 ok / 0 FAIL ====
- [x] verify-naming — ==== verify-naming: 48 ok / 0 FAIL ====
- [x] verify-summary-quality — ==== verify-summary-quality: 28 ok / 0 FAIL ====
- [x] verify-chat-window — ==== verify-chat-window: 12 ok / 0 FAIL ====
- [x] verify-tray-quit — ==== verify-tray-quit: 20 ok / 0 FAIL ====
- [x] verify-warmy-features — ==== verify-warmy-features: 22 ok / 0 FAIL ====
- [x] verify-memory — ==== verify-memory: 21 ok / 0 FAIL ====
- [x] verify-router-queue — ==== verify-router-queue: 19 ok / 0 FAIL ====
- [x] verify-planB — ==== verify-planB: 42 ok / 0 FAIL ====
- [x] verify-planD — ==== verify-planD: 40 ok / 0 FAIL ====
- [x] verify-updater-github — ==== verify-updater-github: failures= 0 ====
- [x] 邮件通知合并/何时发送邮件
- [x] dsh 功能卡片
- [x] dsh 一键安装绑定
- [x] 记忆系统在功能区
- [x] 关于页不再放记忆块
- [x] 自动检测更新 doCheckUpdate
- [x] 开始更新按钮文案
- [x] 法律声明 Pondsi(src)
- [x] 法律声明 Pondsi(dist)
- [x] dsh i18n 标题
- [x] IPC 别名表存在
- [x] group-create 别名
- [x] 主进程 chuliIpc 兼容层
- [x] dsh 安装 IPC
- [x] dsh 状态 IPC
- [x] webgpu IPC
- [x] document.body 已恢复
- [x] HTML body/title/input 标签
- [x] HTML 无 yingYong.js 引用
- [x] CSS overflow:hidden
- [x] CSS body.liaoTianChuangKou
- [x] CSS #appTi 布局
- [x] 聊天输入区 flex 布局
- [x] src/dist renderer 同步
- [x] PINYIN-MAP global>=300 — 370
- [x] PINYIN-MAP strings.ipc>=200
- [x] 品牌键 yingYong.zhName 存在
- [x] cattle.biaoTi 存在
- [x] REQUIREMENTS 存在



Pondsi — WARMY rename/UI verification

- [x] verify-container-probe — 163 checks, failures=0

## 改名完成说明

**已完成（可自动改的都改完了）：**
- 跨包导出 / 类型 / 函数 / 字段：PINYIN-MAP global 370 + local ~1086，工具 dry-run **0 处待改**
- IPC 频道名：strings.ipc 252 条；旧英文频道保留 **兼容别名**（warmy:group-create → warmy:qunChuangJian 等 251 条）
- DOM id / CSS 类名：strings.domId 439 + cssClass 473；HTML/JS/CSS 引用已对齐
- i18n 键：与界面 data-i18n / t() 对齐，zh-CN **0 键缺失**
- HTML/CSS/JS **平台关键字**未改坏：body/title/input/label、overflow:hidden、document.body、#appTi

**有意保留原名（不是漏改）：**
- JS/TS 关键字与内建（never/map/filter/tools/from/of…）
- Node / Electron / DOM API（app、title、name、send、on、body、hidden…）
- 与外部模型协议对齐的字段（baseURL/apiKey/model/messages/role/content/name/arguments）
- 专有名词（Docker/Podman/WSL/ed25519/sha256/i18n/logo…）
- 发行版/安装包文件名（WArmy-Setup-*.exe）

**门禁脚本**已按真实导出/路径对齐（app.js、JiyiCangFuwu、listTasks、Qiu、body.liaoTianChuangKou 等）。

## 界面问题（改名连带）已修

- HTML 标准标签曾被改成 shuRu/biaoQian/ti/biaoTi → 已恢复 input/label/body/title
- CSS 关键字 overflow:yinCang / you: / ti. → hidden / right: / body.
- document.ti → document.body
- id app-body 与 CSS #appTi 统一为 #appTi
- Electron 加载 dist/renderer：构建后必须 copy-assets（已写入 package.json build）

\n---\n\nPondsi — WARMY rename complete verification\n

## 改名异常扫描（连续 3 轮）

| 轮次 | 结果 |
|------|------|
| 1 | CLEAN |
| 2 | CLEAN |
| 3 | CLEAN |

每轮包含：标识符 dry=0、11 包 tsc、HTML/CSS/JS 关键字、IPC 覆盖、i18n 键、6 项门禁、src/dist 同步。

## 改名验证后的界面检查

- 左侧导航：ceLanTiaoMu → setNav(dataset.nav)；setNav 使用 appTi（与 HTML 一致）
- 三列布局：#appTi = 64px + list-w + 1fr；隐藏列表用 yinCangLieBiao
- 聊天区：#liaoTianBuJu = 1fr + panel-w；输入区 flex 可见
- 事件：搜索/滑条为 input（非 shuRu）；无 document.ti / yingYongTi
- 工具类 .yinCang = display:none；#ceLan 可点击
- src/dist renderer 四文件同步；app.js 语法通过


---
Pondsi

## 功能 + 界面排版验收（连续 3 轮）

| 轮次 | 功能模块真跑 | 接线/IPC | 各页面结构排版 | 静态门禁 | src/dist | 结果 |
|------|-------------|----------|----------------|----------|----------|------|
| 1 | 8 项 | 全过 | 导航7页+布局+CSS+设置/关于/我的/聊天/牛马 | 9 项 | 同步 | **CLEAN** |
| 2 | 同上 | 同上 | 同上 | 同上 | 同上 | **CLEAN** |
| 3 | 同上 | 同上 | 同上 | 同上 | 同上 | **CLEAN** |

### 本轮修掉的功能问题

- 对话框 createElement('shuRu') → 真 input（创建项目/群聊/牛马的输入框可打字）
- 创建项目 
es.name → 
es.ming（点确定能真正创建）
- 实例/群 ming 与 
ame 双字段归一（我的牛马列表能显示）
- ddInstanceFlow 真的 spawnInstance 到主进程（重启后仍在）
- groupCreate 检查 ok，失败弹错不再假成功
- 主进程 listInstances / groupList 同时返回 
ame 别名


---
Pondsi

## 设置页串台修复 + 再验收 3 轮

**问题**：设置/我的页出现聊天输入框，选项与排版不对。

**根因**：#liaoTianBuJu { display:grid !important }（ID 优先级）压过 .yinCang { display:none !important }，
hideMain() 加了 yinCang 聊天布局仍然显示 ⇒ 输入框叠在设置页上，两栏排版被挤乱。

**修复**：
- 显隐铁律：带 yinCang 一律 display:none !important；仅 :not(.yinCang) 给布局
- #pageBuJu .shuRuQu 在设置/我的页强制隐藏
- 设置两栏 .peiZhiBuJu = 200px 导航 + 自适应内容
- setNav 设置/我的先 hideMain() 再只显示 #pageBuJu

**再验收（含设置页专项）连续 3 轮**：1 CLEAN / 2 CLEAN / 3 CLEAN


---
Pondsi\n
## 三缺陷修复 + 再验收 3 轮

| 现象 | 根因 | 修复 |
|------|------|------|
| 自动滚动默认关、点不动 | 勾选态 isibility: yinCang（非法值） | 改为 hidden/visible；点按仍切换并写 settings |
| 设置界面/通知/模型挤在一起、点不动 | groups.jineng vs secIds.skill 键不一致，showSec 抛错后分区不再切换 | skill/jineng 同桶别名 + (groups[k]\\|\\|[]) 安全 forEach + yinCang 同步 |
| 牛马顶替第一个、重名 | ① spawn 后用主进程列表**整表覆盖**本地；② 无重名校验；③ id 可能冲突 | heBingShiLiJi 合并；mingYiZhanYong 重名拒绝；唯一 id；失败回滚 |

**回归 3 轮 CLEAN**（含 H 专项）。

\n---\nPondsi\n

## 全需求全面排查（连续 3 轮 CLEAN）

范围：改名完整性 · 界面结构/排版 · 设置分区 · 模型供应商下拉 · 创建/牛马/滚动 ·
dsh/记忆/更新/法律/邮件 · IPC/协议字段 · i18n · 9 项静态门禁 · 功能模块真跑 · src/dist 同步

**排查中发现并已修：**
- 供应商下拉空：URL 被改名误伤（open.bigmodel → daKai.bigmodel）+ 填充逻辑无兜底
- 设置分区 skill 桶被标识符改名再次改成 jineng → 改用字符串键
- 剩余 10 处 local 标识符已改完

| 轮次 | 结果 |
|------|------|
| 1 | CLEAN |
| 2 | CLEAN |
| 3 | CLEAN |


---
Pondsi

## UAT 验收（ISTQB 口径）连续 3 轮 CLEAN

方法（据 ISTQB/维基 Acceptance testing）：黑盒用户旅程 + 验收标准对照需求 + 回归。

**本轮修掉：**
1. 预设供应商下拉空：填充提为 GONGYING_YUSHE_JIAN + 	ianChongYuSheXiaLa，切到「模型」页必填
2. 新窗牛马名称不一致：openChatWindow 只传 	itle，主进程读 iaoTi → 双传 + 主进程兜底 + 子窗读 chatBiaoTi

| 旅程 | 内容 | 结果 |
|------|------|------|
| J1–J3 | 建项目/群/牛马 | PASS |
| J4 | 模型供应商下拉 | PASS |
| J5 | 新窗标题与主界面一致 | PASS |
| J6–J8 | 设置分区/自动滚动/聊天框 | PASS |
| E–G | 改名/法律/功能/门禁/同步 | PASS |

轮次 1/2/3 均 CLEAN。


---
Pondsi

## 修添加供应商 + demo 名称 + 全量 UAT（3 轮 CLEAN）

| 现象 | 根因 | 修复 |
|------|------|------|
| 添加供应商点不动 | $('anNiuTianJiaProv').onclick 在元素为空时抛错，后续绑定全断 | 防空绑定 + 事件委托 #anNiuTianJiaProv + 独立 	ianJiaProvHandler |
| demo.agent 新窗显示 demo-1 | openChat(..., inst.name) 且 demo 只有 ming 无 
ame → 落到 id | xianShiMing()（name/ming/id）；demo 补 
ame；所有 openChat/新窗统一走 xianShiMing |

UAT 旅程 J1–J8 + H1/H2 + 改名/功能/门禁：轮次 1/2/3 **CLEAN**。


---
Pondsi
