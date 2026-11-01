# 第 70 轮交接（2026-10-23）——称呼修复 + 牛马管理局上下文预算滑杆

> 工作区仍未提交；本轮未 commit / 未 push。只改了本轮点名的三处，没有重跑全量 fast/live。
> 真实 profile **没有再次清空**；应用已用最新构建重开。

## 0. 结论

- **紧急项（称呼）**：我的页里改名以前只改内存/界面、没有调用 `profileSave`，而牛马提示词读的是 `profile.json` 里的旧名字 ⇒ 用户把名字改成「列   表」，牛马仍按旧 profile 叫「老板」。已修为即时落盘；并新增 `llm.userCallRule`（10 语言）要求只按当前用户名称呼，中文身份锚不再把用户称为“老板”，忙碌短语/印象提取提示里的“老板”也改为中性“用户”。
- **牛马管理局上下文预算**：数字填空已换成和聊天框下方**同一个** `shangXiaWenSlider` range 滑杆 + 同一套百分比/词元/下限文案；默认 60%，下限按 32K 词元兜底（32K 窗口时显示 100%）。
- **副身/执行者真正使用该预算**：主进程旧代码只把牛马预算写进审计、没传给子代理循环；现在 `youPeizhiSuanShangXiaWenYuSuan` 接受百分比覆盖，子代理把 `zuiDaQingQiuZi` 传进请求窗口，并按 `max(设置值, 32K 下限)` 计算。
- **验收**：新增 `verify-r70-budget-name` **14/0 ×3**；`verify-i18n-locales` 162/0；`verify-r67-firstrun` 75/0；`verify-docs` 95/0。
- 应用已重开在**首启语言页**（真实 profile 仍是空白首启：`hasAccount=false`、无 `auth/`），没有覆盖用户已有数据。

## 1. 紧急项：牛马仍叫“老板”

### 1.1 根因（两处）
1. `packages/app-shell/src/renderer/app.js` 的 `commitName()` 只更新 `state.profile.username` 和界面文本，**没有调用 `saveProfile()`** ⇒ 我的页显示「列   表」，`profile.json` 还是「老板」；主进程 `dangQianYongHuMing()` 读 `profile.json`，提示词自然还是老板。
2. 提示词的身份锚在多语言里写着“用户是你的老板”，且没有“只准用当前用户名”的硬规则 ⇒ 即使名字对，模型也倾向用泛称“老板”。

### 1.2 修复
- `commitName()`：名字变化时立即 `saveProfile()`；空值/未变不写；按 Escape 回退。
- `electron-main.ts` 身份注入：在有真实用户名时，除 `llm.userLine` 外再注入 `llm.userCallRule`：只使用「{u}」这个名字，不要叫“老板/主人/用户”等泛称（除非用户本来就叫这个）。
- 10 个语言包都新增 `llm.userCallRule`；zh-CN/zh-TW 的 `llm.identityAnchor` 改为“用户是你的服务对象”，英文及其它语言的身份锚去掉 “the user is your boss”。
- 可见的忙碌短语“顺手想老板会问什么”改为“顺手想你会问什么”；印象提取提示中的“老板”改为“用户”，避免后台提示继续强化泛称。
- **注意**：如果用户之前只在旧版我的页里临时改过名字（没落盘），升级后需要再输入一次并点走（现在会保存）；如果名字是在账号设置/称呼页写的，已在 `profile.json`，下一轮提示词直接用新名字。

## 2. 牛马管理局上下文预算滑杆

### 2.1 UI
- 位置：我的牛马 → 牛马管理局 → 某只牛马 → 模型配置区的“上下文预算”。
- 旧：`<input type="number">` 填空（留空=跟随全局）。
- 新：`<input id="iCtxBudget" class="shangXiaWenSlider" type="range" min=… max=100 step=5>` + 同一套 `.shangXiaWenPopYuanShuju`（百分比 + `ctx.budget.tokens` 词元）+ `.shangXiaWenPopMin` 下限提示；和聊天框下方完全同一套 class/样式。
- 默认 60%；下限：
  - `max(10%, ceil(32768 / 模型窗口 × 100), 实测固定开销%)`；
  - 32K 窗口 ⇒ 100%；64K ⇒ 50%；128K ⇒ 25%；1M ⇒ 10%。
- 初值：该牛马已存 `contextBudgetPercent` 就用它；否则用全局 `contextBudgetPercent`（默认 60）。拖动即时更新百分比/词元并落盘（`stateSave({instances})`；页面刚打开时 `window.__saveState` 可能还没挂上，所以直接走 IPC 兜底）。
- 模型窗口按 `ctxWindowForModel()` 取（与聊天滑杆共用同一套 modelCaps/已知表/名字标记解析）。

### 2.2 主进程真正生效
- `youPeizhiSuanShangXiaWenYuSuan(model, sample, provider, percentOverride?)` 增加百分比覆盖。
- `paoXiaoDiRenWu`：
  - 取牛马百分比（无则全局）；
  - 按该子代理模型窗口算 32K 下限，`percent = max(设置值, 下限)`；
  - 把预算窗口（字符）作为 `zuiDaQingQiuZi` 传给 `liaoTianDaiGongJu` 的第 4 个参数；
  - 审计 `chat.xiaodi-budget-source` 记录 `settingPercent/floor32/window/chars/laiYuan`。
- 旧代码只记审计、没把 `yuSuanLaiYuan.percent` 传给循环，这是本轮一并修掉的真实缺口。

## 3. 32K 能不能跑？最小建议

用用户真实一次 Ollama Qwen3.6（128K 窗口、60% 预算）的 `chat.budget.allocated` 审计：

| 项 | 实测 |
|---|---|
| 固定提示词（身份/规矩/人设/能力等） | **8,308 token** |
| 工具规格 | **9,750 token** |
| 固定 + 工具 | ≈ **18,058 token** |
| 计入最小视图/执行余量后的最小预算 `zuiXiaoYuSuan` | **19,548 token** |
| 60% 预算 | 72,960 token |
| 历史视图 | 54,901 token |

- **32K 窗口**：60% 只有 **19.2K**，低于实测最小 19,548；聊天滑杆会被下限抬到约 61%，牛马管理局的 32K 词元下限会把 32K 窗口显示为 **100%**。实际给历史只剩 **约 10K**；短问答能跑，多步工具/项目会长距离压缩，**不建议作为项目运行的最低档**。
- **最小建议**：
  - 只跑短任务：32K 窗口可启动，但要接受历史很少；最好同时精简不必要的工具/技能/规矩（工具规格单项就近 10K）。
  - 正常项目：**64K 窗口**起步（60% = 38.4K，扣掉固定 19.5K 后约 19K 历史）。
  - 多牛马协同 / 长项目 / 频繁工具：**128K 窗口**（60% = 76.8K，约 57K 历史），这也是用户当前实测配置。
  - 若坚持“32K 是**预算**”，则窗口必须大于 32K（要给输出留位）；32K 窗口无法同时满足 32K 输入预算 + 输出。
- 因此牛马管理局的“不少于 32K”按 **token 预算下限**实现；窗口小于 32K 时只能显示满窗口，并会在实际预算计算里保留输出/安全余量。

## 4. 验证与收尾

- 新增 `dev/gates/verify-r70-budget-name.mjs`（真 Electron + CDP，临时 profile）：
  - 预算控件为同款 range 滑杆、无数字输入框；1M 模型默认 60% 且词元 ≥32K；拖动 20% 落盘回读；
  - 32K 模型下限 100%、词元 32768；
  - 我的页改名「列   表」→ `profileGet` 回读、reload 后仍显示；
  - 10 语言 `llm.userCallRule`、主进程注入、zh-CN 身份锚、32K 主进程预算接线静态断言。
  - **14/0 连续 3 遍**（同一最终构建）。
- 其它：`verify-i18n-locales` 162/0、`verify-r67-firstrun` 75/0、`verify-docs` 95/0。
- `dev/gates/run-verify-22.mjs` 已登记 `verify-r70-budget-name`。
- 真实 profile 未清空；应用已重开在首启语言页（`hasAccount=false`）。临时 profile/脚本/截图收尾删除；未 commit / 未 push。

## 5. 未覆盖 / 历史未完成

- 本轮**没有真实调用模型**验证“它一定不再说老板”：已修数据落盘 + 身份锚 + 10 语言硬规则，但模型是否 100% 遵守仍取决于模型。若真机仍出现泛称，下一轮优先加“称呼后处理/再提醒”而不是放宽判据。
- 子代理预算接线做了编译与静态门禁，未真跑一个派生子代理去看 `chat.xiaodi-budget-source` 的实际 `chars`。
- 历史未完成不变：网络 B/A、真实微信扫码 E2E、全角色权限矩阵/服务商绑定/审批流/项目群设置/右键分类/其他社交连接器/自动翻译校对/Unicode 软门禁/认证深锁/macOS/Linux 全量真机；回档仍不捕获 `run_shell` 工作区外写盘。
- 决策文档：`docs/HANDOFF-R67.md` 末节、`docs/DECISIONS-R63.md`、`docs/P0-5-ZITUOGUAN.md`、`docs/P0-6-TUMIN.md`；P2P/中继/互联见 `docs/P2P-QUZHONGXINHUA.md`、`docs/SERVER-RELAY.md`、`docs/mesh-dual-machine.md`。
