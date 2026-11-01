# 第 92 轮交接总览（2026-10-26）

> 本轮用户 4 条要求：短记忆（原规范）隐藏且只由归档更新；新增会话「要求」；我的页布局；解释注入与上下文余缺处理。
> 另按惯例：汇总历史未完成项、删除真实配置、首启交付、逐项交接。

## 1. 分项交接

| 项 | 文档 |
|---|---|
| 短记忆（原规范）隐藏、改名、归档更新 | [HANDOFF-R92-SHORT-MEMORY.md](./HANDOFF-R92-SHORT-MEMORY.md) |
| 会话「要求」卡片与注入层 | [HANDOFF-R92-REQUIREMENTS.md](./HANDOFF-R92-REQUIREMENTS.md) |
| 我的页布局 | [HANDOFF-R92-MY-PAGE.md](./HANDOFF-R92-MY-PAGE.md) |
| 注入内容 + 上下文有余/不足处理（含例子） | [PROMPT-INJECTION-R92.md](./PROMPT-INJECTION-R92.md) |
| 历史未完成项与待拍板 | [OPEN-ITEMS-R92.md](./OPEN-ITEMS-R92.md) |

## 2. 优先级阶梯（第 92 轮）

产品硬门禁 > 道 > 术 > **要求** > **短记忆** > 印象 > 工具 > 软门禁 > 教条 > 束缚 > 认知 > 身份/模型/时间

- 要求：用户亲写、每会话一份、模型不可改、上限 2000、可压缩（晚于短记忆）。
- 短记忆：原规范，界面不可见、用户不可改、只由归档模型更新、上限 2000、可压缩（本层最先）。
- 压缩第三层：`短记忆 → 要求 → 术`。

## 3. 关键文件

- 主进程：`electron-main.ts`（注入 1162x、要求 IPC 1666x、短记忆归档 1762x）
- 设置/上限：`ti-shi-shang-xian.ts`、`yaSuo-fenCeng.ts`、`builtin-rules.ts`（门禁 E）
- 渲染：`renderer/app.js`（要求卡、我的页）、`renderer/index.html`（要求卡 DOM）、`renderer/auth-gate.css`（我的页布局）
- 工具边界：`work-tools.ts`（yaoqiu-readonly）
- 文案：`src/i18n/*.json`（10 语言，要求 10 条/语言）
- 门禁：`dev/gates/verify-r92-duanjiyi-yaoqiu.mjs`、`dev/gates/verify-r92-live.mjs`

## 4. 验证汇总

- `verify-r92-duanjiyi-yaoqiu`：**42/0**
- `verify-r92-live`：**20/0**（真 Electron 两会话隔离 + 我的页量盒）
- `verify-prompt-layers`：**31/0**
- `verify-r53-tishangxian`：**81/0**
- `verify-r82-hu-chi`：**34/0**
- `verify-r52-layers`：**54/0**
- `verify-r82-r103`：**18/0**
- `verify-r67-firstrun`：**80/0**
- `verify-r67-chat-order`：**20/0**
- `verify-r81-ui`：**20/0**
- `verify-r78-auth-tour`：**47/0**
- `verify-r79-regressions`：7/0
- `verify-r82-chatwin`：12/0
- `verify-r54-i18n-defaults`：17/0
- `verify-r56-preset-i18n`：5/0
- `verify-i18n-locales`：**162/0**
- `verify-renderer-scope`：9/0
- `verify-ipc-probe`：46/46
- `verify-r90-prompt-10x`：10 轮全过
- `verify-r78-prompt-limits`：29/0
- `verify-r67-prompt-caps`：12/0

### 既有红（未由本轮引入）

- `verify-renderer-template-balance`：`app.js` 知识库用户切换的 `<label><select>…` 拼接被静态检查误报；该段本轮未改。
- `verify-css-consistency`：`.yinYongTiao` 两份 CSS 的 `max-width` 写法不同；本轮未改。
- `verify-r44-ui` 53/14、`verify-r69-join-create` 15/3：见上一轮 [TIMEZONE-R91.md](./TIMEZONE-R91.md) 的说明（授权卡结构/真实模型产出/项目默认 host/群聊预填名），本轮未触碰。

## 5. 真实配置与首启

- 交付前会备份并删除真实 profile（`%APPDATA%\@warmy\app-shell`），再用源码构建启动到首启语言页，等待你人工验收。
- 具体时间与命令见本轮最终回复；**未 commit、未 push**。

## 6. 下一步建议

- 先处理 `OPEN-ITEMS-R92.md` 的 U4（Device Guard）与 U1/U2（企微/钉钉接收 + 真实凭据）。
- 记忆工程 M1–M3 与 FWArmy F1 按文档中的方案选项拍板后即可逐项落地。
