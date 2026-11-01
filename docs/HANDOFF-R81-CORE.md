# 第 81 轮交接 · 核心/认证/视频（进行中）

> 未 commit、未 push。只记录已落地并有验证证据的部分。

## #13【优先】视频附件被误判“没有看图/视频模型”

**根因**：`kanShiPinWeiTuo` 只找 `videoUnd` 专用模型；没配置就直接返回空，调用方于是报“没有可用模型”，完全没用已配置的 `imageUnd`（看图模型）和 `asr`（听话模型）。

**修复**：
- 新增 `shiPinChouZhen()`：隐藏 BrowserWindow + `<video>` + canvas 抽首帧（≤64MB、20s 超时），不执行视频脚本。
- `kanShiPinWeiTuo` 改为三级回退：
  1. 有 `videoUnd` 先用；
  2. 否则/失败 ⇒ 抽帧交给 `imageUnd` 链（真实看图模型）；
  3. 再用 `yinPinZhuanWav` + `zhuanXieYinPinBuf` 走 ASR 链识别视频语音；
  4. 两路结果用【视频画面】/【视频语音】拼给主模型；都没有才如实报告缺能力。
- 审计新增 `video-delegate.frame` / `video-delegate.asr` / `video-delegate.asr-failed`。

**验证**：新增 `verify-r79-ten-rounds --rounds=11`，真实 MiMo + 本地 Ollama 视觉模型 + 真实 `flower.mp4`：
`视频附件有真实回复`、`不再误报没有看图/视频模型`、`描述含花/植物/自然`、`审计有回退证据` 4/4 通过。

## #2 登录页返回语言选择

- 去掉文字，改成 32×32 圆形按钮 + 18px 返回箭头 SVG，`title/aria-label` 保留“返回语言选择”。

## #3 助记词恢复页支持“成语 12 格”

- `auth-service.recoverBegin` 现在同时返回 `friendlyWords` / `friendlyIdioms`（24 个真实词/成语）。
- 恢复页新增「词组 / 成语」开关；打开成语后变成 **12 格**，每格两格输入（序号 1-2、3-4…），提交时按 24 个顺序值换行拼接，后端仍按 24 格解析；关闭则回到 24 格。
- 只改输入布局，不改变 BIP-39 索引顺序。

## #16 微信扫码确认后“连接中”很久

- 判定：`getupdates` 是长轮询；首次探活（4s）超时后适配器仍要等下一次服务端响应才置 `zaiXian`，这主要是协议/外部时延，不是渲染层卡死。
- 已做：首次探活请求带 `longpolling_timeout_ms`（3.5s），让支持该参数的服务端尽快返回第一次响应；服务端忽略时行为不变。
- 仍需真实微信扫码实测确认是否变快；没有真实账号无法在离线夹具证明。

## #25 道只有一份

- `moRenYuYanTongBu()` 不再把「道」随界面语言替换成另一种语言的出厂稿；**道只在首次运行播种一次，之后永远用「我的」页那份 `dao.md`**。术仍可按出厂稿跟随语言。
- 这同时消除“切英文后道被换成 7949 字符英文稿”的问题。

## #26 提示词上限与语言

- 上限本来就按语言折算：道基准 2600 中文字符；英文系数 3.75 ⇒ 9750；俄语 3.3 ⇒ 8580；法语 4 ⇒ 10400。英文道 7949 字符**没有超过英文上限**。
- 用户看到的 2600 是中文基准值；`warmy:tiShiShangXian` 返回的是按当前语言折算后的值。道不可压缩，超限只拒绝保存并报“现在多少/上限多少”。

## #27/#28/#29 第四列提示词

- 已写 `docs/PROMPT-LAYERS-R81.md`：规范=当前会话做事规范；项目记忆=项目/群共享事实；印象=牛马对你的长期理解（与「我的」页同一份，会话可有副本）。群聊/项目第四列的“印象”仍是“对你的印象”，不是“群的印象”。

## 删除首启十幕「场景查看页」

用户口径：首启背景已定，专门用来看十幕的查看页不再维护、不再测试。

- 删除 `preview/firstrun-scenes/`（`index.html` 带 HUD/选择条/自动轮播的查看页）。
- 运行期改为 `packages/app-shell/src/renderer/firstrun-scenes/index.html`：只有 `#stage > canvas#scene`，`object-fit: cover` 铺满；按 `?scenes=N` 固定本次启动的一幕，`rotate=1` 仅保留调试用轮播；没有 HUD、选择条、标题、全屏按钮。
- `engine.js` 对 HUD 元素做了空值保护（`buildChooser`/`setText`/`fsBtn`/`autoBtn`），页面缺这些元素也能正常渲染。
- `copy-assets.mjs` 删除从 `preview/` 特殊拷贝的代码块（`src/renderer` 已递归复制）。
- 删除 `dev/gates/verify-r74-firstrun-scenes.mjs`，并从 `scripts/verify-r78-3x.mjs`、`dev/gates/run-verify-22.mjs` 移除。
- `dev/gates/verify-r68-firstrun-ui.mjs` 的嵌入断言从「`#stage` 有 `is-clean`」改为「iframe 里没有 `#chooser`/`#sTitle`（即没有查看器 HUD）」。
- `preview/charge-scenes/`（牛马冲锋十幕概念图，暗色历史选型）与本轮首启背景无关，保留。

## 修复：启动尾巴抢走「设置」导航（引导卡在「模型」的真因之一）

- 现象：偶尔点「去设置」后，高亮已经走到「模型」，但人还停在「我的牛马」页；模型按钮矩形是 0×0，引导随后卡住。
- 根因：`app.js` 启动尾巴无条件 `setNav('singleAi')`，并在 100ms 后 `openChat` 第一个会话。数据加载慢时它晚于用户/引导的点击执行，把刚打开的设置页又盖掉；每一步 `done()` 只看 `state.nav`，于是引导误以为设置已完成。
- 修复：
  - 启动尾巴只在 `state.nav === 'singleAi'` 时复位；`openChat` 的 100ms 定时器同样先检查导航。
  - 第 1 步 `done()` 现在同时要求 `#pageBuJu` 没有被 `yinCang` 隐藏（页面真的渲染出来才算完成）。
  - 引导「去操作」的 `catch` 不再静默：记录 `window.__yinDaoActionError` 并 `console.error`，真跳转失败会进门禁的「零控制台错误」断言，不再假装成功。
- 门禁：`verify-r78-auth-tour` 的引导/退出步骤改为「每次重试重新取中心再点」（`realClickUntil`），避免 reload/重渲染后在同一坐标继续点；复跑 10 次全绿。

## 待办

- 隐私与条款全文替换已落地（见 `HANDOFF-R81-LEGAL.md`）。
- 引导、滚动、模型删除、预算、微信展示、nm 查看器均已落地并由 `verify-r81-ui` / `verify-r81-nm` / `verify-r78-auth-tour` / `verify-r68-firstrun-ui` 覆盖。
- 仍未拍板的网络/权限/知识库/校对/向导类方案见 `DECISIONS-R81.md`。
