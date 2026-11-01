# 第 115 轮交接：全项目复查与优化

## 0. 结论

在 R114 完成后做了一次全项目复查，修掉了 4 个真实问题：

1. 加密层的大文件路径会整文件读入内存（DataVault 封存/导出、登录迁移都会触发）⇒ 改为分块流式解密/加密。
2. 注销后 `settings.json` 被登录页重新写成明文（已有仓库、未登录）⇒ 受管写入守卫拒绝；并保证注销后仍显示登录页而不是首启页。
3. 注销/封存失败时界面静默（用户以为退出了）⇒ 现在显示错误、不 reload。
4. 历史独立门禁 `verify-r78-auth-tour` 30/5 ⇒ 35/0（首启 aria 断言、注销后重新拉起进程、登录页断言）。

另外：全 workspace `pnpm -r typecheck` 11 个包全绿；`verify-r115-streaming` 7/7；fast 档 **128 项次 0 红**。

## 1. 加密层流式化

- `createReadStream`：
  - type0（普通文件）：读头/nonce 后按 1MB 分块 `decipher.update`，末尾校验 GCM tag；
  - type1（JSONL）：逐记录读取、逐记录解密；
  - 带 `start/end` 的少量调用仍保留按字节切片（不用于大文件封存/导出）。
- `migrateOne`：
  - 普通文件 `sealFileToPath`：分块 `cipher.update`，不把整个文件读进内存；
  - JSONL `sealJsonlToPath`：只保留一个读取块 + 半行，逐记录封装；最后回填 header 的逻辑长度/记录数。
- 兼容：小文件/原有格式不变；错误 key 仍抛错；迁移失败不覆盖原文件。
- 门禁 `verify-r115-streaming` 7/7：8MB 普通文件流式解密（多 chunk）、历史明文大文件迁移、60k 行 JSONL 迁移与完整读回。

## 2. 注销后的登录页 / 写守卫

- `enc-fs.cjs` 新增 `setWriteGuard`：已有 `vault.bin` 但 DEK 不在时，受管文件写入直接拒绝，不再落明文；首启无仓库时仍允许写引导配置。
- `auth-gate.js`：
  - 有账号但设置被封存时，`settingsGet` 读不到 `setupDone/privacyConsent`；现在以“有账号 = 已同意过条款”为前提，直接进登录页；
  - 撤销隐私时写 `auth/privacy-revoked` 明文布尔标记（auth 目录已有独立保护），下次启动仍先看条款；
  - 注销失败不再静默 reload，而是显示错误。
- `chuShiSheZhiTai` 返回 `privacyRevoked`，隐私同意/撤销时同步写/删标记。
- 真实链路：注册 → 注销 → 重新拉起 → 登录页（PIN/助记词/返回语言页）可用。

## 3. 历史门禁 R78 修复

- 首启语言的 `aria-haspopup` 断言只统计**可见**元素（旧断言把隐藏的话筒下拉也算进去）。
- 注销后等待旧进程退出并**手动重新拉起**同一 profile（测试环境的 `app.relaunch` 不总是被 CDP 等到），再断言登录页/PIN/返回语言页。
- 结果 **35/35**，并加入 LIVE 清单。

## 4. 边界/未做

- R114 的边界继续有效：workspace、外部项目目录、截图/字体、mimic、Chromium 缓存、auth/identity/secure 不在逐文件加密层；加密的是应用管理的结构化数据与聊天/知识/审计/检查点等。
- 大文件 `copyFileSync` 跨加密边界（选择性导出复制加密文件到临时目录）仍是整文件读取；常规 `.nm` 封存/导出走流式，已不再是主要路径。若后续大附件导出成为常态，再把 copyFileSync 也改流式。
- 真实第二设备恢复、进程隔离、真实 TTS/画图/视频供应商仍沿用 R111 边界。
- 本轮未发布新的 GitHub Release。

## 5. 测试

| 门禁 | 结果 |
|---|---|
| fast 档 | **128 项次 0 红** |
| `verify-r115-streaming` | 7/7 |
| `verify-r78-auth-tour` | 35/35 |
| `verify-r114-crypto` | 19/19 |
| `verify-r114-ui` | 7/7 |
| `verify-r111-storage` | 12/12 |
| `verify-r111-auth-storage-ui` | 8/8 |
| `verify-r111-data` | 36/36 |
| `verify-r104-vault` | 51/51 |
| `verify-r67-firstrun` | 80/80 |
| `verify-strict-language` | 10/10 |
| `pnpm -r typecheck` | 11/11 包通过 |

## 6. 改动文件

- `packages/app-shell/src/enc-fs.cjs`（流式读取/迁移、写守卫、DIPS/SharedStorage/mimic 边界）
- `packages/app-shell/src/electron-main.ts`（隐私撤销标记、注销错误可见、写守卫接线、启动语言刷新）
- `packages/app-shell/src/data-vault.ts`（封存不删 auth/identity/secure）
- `packages/app-shell/src/renderer/auth-gate.js`（有账号时跳过首启、注销失败可见）
- `packages/app-shell/src/renderer/app.js` / `app.css` / `auth-gate.css`（R114 UI/加密状态/外部编辑条）
- `packages/app-shell/src/i18n/*.json`（隐私条款改为登录后静态加密；外部编辑/加密状态文案）
- 门禁：`dev/gates/verify-r115-streaming.mjs`、`verify-r114-crypto.mjs`、`verify-r114-ui.mjs`、`verify-r78-auth-tour.mjs`、`run-verify-22.mjs`

## 7. 交付

- `release/win-unpacked` 已用最终源码同步，应用已用现有真实 profile 正常启动。
- **没有删除真实 profile、没有做首启重置**：该 profile 已有账号/数据，删除会丢用户数据；若需要全新首启，应先备份再删除（需用户确认）。
- 本轮未发布新的 GitHub Release。
