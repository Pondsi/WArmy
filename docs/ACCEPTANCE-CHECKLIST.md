# WARMY / 无限牛马 — 全面验收清单

> 方法来源（已安装 skill）：
> - `webapp-testing`（anthropics/skills）— 侦察后行动、networkidle、截图、控制台零错误
> - `browser-testing-with-devtools`（addyosmani）— 复现→检查→诊断→修复→验证；控制台/网络/截图
> - `code-review-and-quality`（addyosmani）— 五轴评审：正确性/可读性/架构/安全/性能；严重级别
> - `test-driven-development`（addyosmani）— 先测后改、回归必带测

## 0. 严重级别

| 前缀 | 含义 | 动作 |
|------|------|------|
| Critical | 阻断 | 必须修 |
| （无前缀） | 必须改 | 修完才能过 |
| Optional | 建议 | 可记债 |
| Nit | 可忽略 | 风格 |
| FYI | 信息 | 无需动作 |

## 1. 改名残留门禁（静态）

- [ ] CSS 类型选择器：无裸 `ti` / `shuRu`（`#shuRu` ID 除外）
- [ ] CSS 属性：无 `you:` / `daKai:` / `display:yinCang`
- [ ] DOM API：`document.title` / `Event('input')` / `createElement('input')` / `addEventListener('open')`
- [ ] 元素 id：`$('shuRu')` / `getElementById('shuRu')`（不是 `$('input')`）
- [ ] HTML 属性：`title` / `hidden` / `input` 标签未被改名
- [ ] 英文文案：无 `qiYong` / `daKai it first` 等拼音残留
- [ ] 协议字段：`name`/`arguments`/`messages`/`apiKey`/`baseURL` 保持英文

## 2. 五轴代码评审（本轮改动）

### 正确性
- [ ] 需求对齐：滚动条/第四列滚动/门禁/安装包
- [ ] 边界：空态、隐藏面板、窗口拉矮
- [ ] 错误路径：元素不存在时不抛错
- [ ] 测试覆盖：18 门禁 + UAT 旅程

### 可读性
- [ ] 命名与项目规范一致（拼音标识符 + 平台关键字原样）
- [ ] 无死代码 / 假输入框 / 兼容 shim

### 架构
- [ ] CSS 显隐铁律 `:not(.yinCang)`
- [ ] src/dist 同步（copy-assets）
- [ ] 不把平台关键字纳入改名

### 安全
- [ ] 无密钥入库
- [ ] 法律声明 Pondsi 署名仍在
- [ ] XSS：escapeHtml 仍在用户内容路径

### 性能
- [ ] 列表/面板滚动用 `overflow:auto` 而非整页滚
- [ ] 无 N+1 或无界循环引入

## 3. 18 项门禁 × 3 轮

i18n · docs · naming · summary-quality · chat-window · tray-quit · features · memory · router · planB · planD · runtime-errors · live-ui · ui-layout · container-probe · updater-github · two-windows · no-wsl-start

## 4. 真机 UAT 旅程（CDP）

| 旅程 | 期望 |
|------|------|
| J1 启动 | 无红字；左侧导航可点 |
| J2 建项目 | 弹框确定生效；列表出现；重名拒绝 |
| J3 建牛马 | spawn 成功；列表显示 |
| J4 聊天 | 输入/发送/自动滚动可切换 |
| J5 设置 | 分区可切换；无聊天输入框叠放 |
| J6 供应商 | 下拉有预设；添加可点；卡片+1 |
| J7 第四列 | 窗口变矮可滚；整页无滚动条 |
| J8 新窗 | 名称与主界面一致 |
| H1 dsh | 关于页显示版本或「未安装」 |
| H2 法律 | Pondsi 署名可见 |

## 5. 产物

- [ ] `WArmy-Setup-0.1.0.exe` 存在且 >100MB
- [ ] dsh 默认安装路径/关于页正确
- [ ] copy-assets 后 src/dist 一致

## 6. 控制台标准（webapp-testing）

生产页面 **零 console error/warning**。有红字 = FAIL。

## 7. 通过标准

- 静态残留 = 0
- 五轴无 Critical/必须改
- 18 门禁 3 轮 CLEAN
- UAT 旅程全 PASS
- 产物齐全
- **连续 3 次全面排查均无问题** 才算完成
