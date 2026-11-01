# 第 69 轮交接（2026-10-23）——项目/群聊第二列合并入口

> 工作区仍未提交；本轮未 commit / 未 push。只改了第二列入口与对应真机门禁，没有重跑全量 fast/live。

## 0. 结论

- 项目/群聊第二列**去掉单独的「+」按钮**；只保留项目/群图标。
- 点项目/群图标打开一个**一体化窗口**：左侧加入（扫码/粘贴邀请链接 + 对方将看到的名片），右侧创建（项目：名称 + 开发环境；群聊：名称）。
- 两列各有自己的主按钮（「申请加入」/「创建项目」或「创建群聊」），底部只留「关闭」。
- 真机门禁 `verify-r69-join-create` **连续 3 遍 18/0**：包括实际创建一条项目与一条群聊、列表出现、无脚本错误。
- 最新构建已重开在**首启语言页**（真实 profile 仍是空白首启：`hasAccount=false`、无 `auth/`）；首启完成后即可在 项目/群聊 页看到新入口。

## 1. 用户口径

> 项目的第二列的 + 和项目图标分别代表了加入项目和创建项目的功能，现在把 + 这个按钮去掉，点击项目图标后出现加入项目和创建项目一体化的窗口，左侧是加入项目的界面，右侧是创建项目的窗口。群聊的第二列也和上面的项目一样改。

## 2. 实现

### 2.1 第二列
`packages/app-shell/src/renderer/app.js` 的 `setupListAction()`：
- 项目/群聊：给 `#anNiuJiaRuqr` 加 `yinCang` 并清空内容（不再显示「+」）；`#lieBiaoDongZuo` 仍显示项目/群 SVG。
- 图标 `title` / `aria-label` 改为「加入项目 / 创建项目」或「加入群聊 / 创建群聊」，点击调用 `createGroupFlow()`。
- 联系人页不变：仍只留联系人图标（`#anNiuJiaRuqr`），打开「添加联系人」。
- 我的牛马/其它页仍走 `setupListActionLegacy()`，保留原来的「+」语义。
- `setupListActionLegacy()` 也同步为：只有联系人页显示加入按钮；项目/群聊不再显示「+」。

### 2.2 一体化窗口
新增 `openJoinCreateDialog()`（`app.js`），由 `createGroupFlow()` 代理调用：
- 标题：`项目` / `群聊`。
- 左列 `加入项目` / `加入群聊`：
  - 复用 `joinDialogBodyHtml(ka)`：扫码区块、粘贴链接、对方将看到的名片、消息区。
  - 底部主按钮「申请加入」；空链接时如实提示且不关窗；成功后才收窗。
- 右列 `创建项目` / `创建群聊`：
  - 项目：项目名称 + 本机/容器二选一 + 说明；名称与开发环境都满足才启用「创建项目」。
  - 群聊：群名称；填名即启用「创建群聊」；创建时沿用 `directedMode: true`。
  - 创建成功后 `groupCreate` → 项目额外写 `containerDev` 本机镜像 → `syncGroupsFromStore()` → 关闭窗口；失败在右列内联提示，不弹阻塞框。
- 底部动作条只有一个「关闭」。
- 旧的 `projectCreateDialog()` 与创建专用旧分支已删除；`#anNiuJiaRuqr` 监听器里不可达的项目/群聊加入旧分支也已删除（联系人分支保留）。`createGroupFlow()` 保留为一体化窗口的别名，避免旧调用点失配。

### 2.3 CSS
`packages/app-shell/src/renderer/app.css` 新增：
- `.duiHuaKuangKa:has(.erHeYiGrid)`：宽 880px、`max-height: calc(100vh - 48px)`、内部滚动。
- `.erHeYiGrid` 两列（窄屏 720px 以下单列）、`.erHeYiLan` 边框卡片、`.erHeYiInput`、`.erHeYiBtnRow`。
- 复用现有 `.ctgSeg` 做开发环境二选一。

## 3. 验证

### 3.1 真机门禁
`dev/gates/verify-r69-join-create.mjs`（新增，真 Electron + CDP，临时 profile）：
- 项目页：`#anNiuJiaRuqr` `display:none` 且宽 0；项目图标仍在；title/aria 同时包含加入与创建。
- 点图标：标题「项目」，左「加入项目」/右「创建项目」；二维码/粘贴框/申请加入、名称/开发环境/创建按钮齐全；创建按钮初始禁用；两列并排。
- 加入侧空链接：提示非空、窗口不关。
- 项目只填名 → 创建仍禁用；选「本机」→ 启用；点创建 → 真实落库并出现在项目列表。
- 群聊页同样检查；群聊没有开发环境；填名即可创建；真实落库并出现在群聊列表。
- 无脚本/控制台错误。

读数（最终构建，连续 3 遍）：**18/0 ×3**。

### 3.2 仪器说明
- 测试 profile 的 `WARMY_AUTH_BYPASS=1` 只跳过认证；首启 setup/隐私/引导仍由 app.js 处理。门禁预置了 `setupDone/privacyConsent/guideDone`，但在临时 profile 里引导条仍可能把当前导航切去「我的牛马」；门禁在创建完成后会**重新点一次项目/群聊导航**再核列表，并等待图标真正可见。这是**测试环境的引导干扰**，不是产品导航回归；真实 profile 的 `guideDone` 已为 true。
- 没有使用真实用户数据；没有修改真实 profile 的 `auth/`、`identity/`、`secure/` 等保护区。

### 3.3 未覆盖
- 加入侧的**真实邀请链接**加入（扫码/粘贴到成功回执）本轮未跑；需要一条真实项目/群聊邀请链接与对端。空链接的守卫与界面已验。
- 联系人页「添加联系人」、我的牛马「+」、扫码识别等旧入口本轮未重跑。

## 4. 收尾

- `dev/gates/run-verify-22.mjs` 已登记 `verify-r69-join-create`（live 档，180s）。
- 应用已用最新构建重开在**首启语言页**（真实 profile：`setupDone=false`、`privacyConsent=false`、无 `auth/`；`hasAccount=false`）。
- 临时脚本/截图/测试 profile 收尾删除；未 commit / 未 push。
- 最终构建指纹：
  - `dist/renderer/app.js` 1,562,664 B `3da90390eeb488cda39e25fa153a6642ec34e2db7bed0cb24db74095bad26d21`
  - `dist/renderer/app.css` 206,613 B `d14c45d2f15cbb678c73afc27aa7da82aabf3c944c1f5f80712a0e69a9a71ee5`
  - `dist/electron-main.js` 1,598,300 B `2ae849bd03a38a3991a0681054a04b34a2d6b3f7335d06e8b163900d565080c7`

## 5. 历史未完成（未在本轮处理）

网络 B/A、真实微信扫码 E2E、全角色权限矩阵/服务商绑定二维码/审批流、项目群设置、右键分类、其他官方社交连接器、自动翻译校对、Unicode 软门禁、认证深锁、macOS/Linux 全量真机等仍按原状态保留。决策文档位置：`docs/HANDOFF-R67.md` 末节、`docs/DECISIONS-R63.md`、`docs/P0-5-ZITUOGUAN.md`、`docs/P0-6-TUMIN.md`；P2P/中继/互联取舍见 `docs/P2P-QUZHONGXINHUA.md`、`docs/SERVER-RELAY.md`、`docs/mesh-dual-machine.md`。
