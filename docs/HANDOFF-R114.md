# 第 114 轮交接：数据入口 / 全量加密 / 外部编辑显式授权

## 0. 结论

第 12–16 项已完成：

- 导入数据、导出数据、定时导出移到「我的」页用户名下方；设置→关于不再保留这三个入口。
- 运行期静态加密：设置、JSONL、知识库、审计、看板、归档、检查点、 prompt 文件等**应用管理数据在磁盘上是密文**，进程内按需解密；workspace 与外部项目目录保持显式边界。
- 全局没有任何「定时导入」入口或类型；只有定时导出。
- 旧群重建明确「旧消息不会迁入新群」，没有迁移提示/兼容路径。
- 外部编辑删除“文件 2 秒不变 ⇒ 认为改完”的启发式，改为显式会话：确认后副本一直开放，用户点「结束并封存」或退出应用才回写；拒绝则不生成副本。

验收：最终 fast **127 项次 0 红**；`verify-r114-crypto` 19/19、`verify-r114-ui` 7/7、`verify-r111-storage` 12/12、`verify-r111-auth-storage-ui` 8/8、`verify-r111-data` 36/36、`verify-r104-vault` 51/51、`verify-r67-firstrun` 80/80、`verify-strict-language` 10/10。

## 1. 第 12 项：三个数据入口移到「我的」

- `app.js` 我的页 `.woR68Profile` 用户名下方新增 `.woDataHang`：
  - `anNiuDaoRuWo`（导入数据）
  - `anNiuDaoChuWo`（导出数据）
  - `anNiuDingShiDaoChuWo`（定时导出…）
- 设置→关于只保留「恢复默认设置」「打开启动日志」，旧 `anNiuDaoChuSheZhi` / `anNiuDaoRuSheZhi` / `anNiuDingShiDaoChu` 已删除。
- 用户名下方同时显示全量加密状态（未登录=登录后开启；登录后显示已加密文件数与待迁移数）。
- `auth-gate.css` 新增 `.woDataHang/.woDataBtn/.woJiaMiHang`，窄宽度自动换行。

## 2. 第 13 项：全量运行期加密（第二阶段）

### 2.1 方案

没有把全部对象再迁进单一 SQLite 表，而是采用**逐文件 AEAD 层 + SQLCipher memory.db**：

- `packages/app-shell/src/enc-fs.cjs`：主进程与记忆子进程共用的 fs 包装层。
  - 普通文件：`WARMYEF2` 头 + 12B nonce + AES-256-GCM 密文 + 16B tag；AAD 含类型与逻辑长度。
  - JSONL：逐记录 AEAD 追加（记录号 + nonce + 密文 + tag），追加 O(1)，读取按记录解密；文件头维护逻辑长度/记录数。
  - 写入自动加密、读取自动解密；`stat.size` 对密文返回**逻辑明文大小**；`copyFileSync` 跨边界时按需解密/加密。
  - 错误 key 读取直接抛错，不静默返回垃圾。
- 登录/解包拿到 DEK 后 `setKey`；退出/注销封存后清 key。
- `qianYiQuanLiangJiaMi()` 在登录/解包后 400ms 扫描受管文件，把历史明文迁成密文；失败只记日志，下次再试。
- **未登录写守卫**：已有仓库但 DEK 不在时，受管文件写入直接拒绝（不留明文）；首启无仓库时才允许写引导配置。修复了“注销后登录页把 settings.json 重新写成明文”的边界。
- 记忆子进程通过 `--require enc-fs.cjs` + `WARMY_ENC_ROOT/WARMY_DATA_KEY_HEX` 使用同一套格式；`memory.db` 仍由 SQLCipher 单独加密并排除在 fs 层之外。
- `DataVault` 封存/导出/导入读取的是**逻辑明文**（`createReadStream` 包装按需解密），因此 `.nm`/`vault.bin` 跨账号仍可用；导入后由迁移扫描重新加密。
- 封存删除新增 `auth/identity/secure` 强制保护：即使清单异常，也绝不删除登录前必须可读的目录。

### 2.2 覆盖范围与边界

**加密**：`settings.json`、`appearance.json`、`chat-meta.json`、`plans.json`、`ui-queues.json`、`router-queues.json`、`groups.json`、`nodes.json`、`instances/`、`knowledge/`、`audit/`、`archive/`、`board/`、`bus/`、`net/`、`mimic/`、`checkpoints/`、`logical-import/`、`memory/`（除 `memory.db*`）、`token-*`、`eta*`、`xin-tiao.json`、`dao.md/shu.md/agents.md/Memory.md/yinxiang.md` 等。

**明确不加密（不是遗忘）**：

- `workspace/`：外部工具/IDE/Office 的工作区，保持明文；Office/IDE 仍可用。
- 外部项目目录（userData 之外）：用户自己的目录，不属于应用仓库。
- `auth/ identity/ secure/`：已有 Kroot/keyEnvelope/safeStorage 独立保护，且登录前必须可读。
- `screenshots/`、`fonts/`、`mimic/`（桌面宠物图片由 Chromium `file://` 读）、Chromium 缓存、`vault.bin*`、`memory.db*`、日志、node_modules、dsh-home。
- 首启隐私条款里“这些本机文件多数默认是明文”的旧说法已同步改为“登录/解锁后使用账号密钥静态加密”，并列出上述边界。
- OS 页面文件/崩溃转储、同 OS 用户的内存转储/调试、旧明文在 SSD 的法证擦除：不在应用层承诺范围。

### 2.3 状态展示

- 我的页显示 `全量加密：登录后开启` / `全量加密：已开启 · 已加密 N 个文件 [· M 个待迁移]`。
- `warmy:quanLiangJiaMiZhuangTai` 返回加密/待迁移文件数、字节数和边界说明；不把 workspace 说成已加密。

## 3. 第 14 项：没有「定时导入」

全局（源码、i18n、门禁）没有 `定时导入`/`dingShiDaoRu`；定时任务只有导出。`verify-r114-crypto` 静态断言锁住这一口径。

## 4. 第 15 项：旧群不迁消息

- 旧群仍按「新建 + 重新邀请」处理，旧群只读。
- 重建确认文案明确「旧消息不会迁入新群」，没有“是否迁移旧消息”的提示或代码路径。
- 没有无指纹成员的自动可信兼容路径。

## 5. 第 16 项：外部编辑显式会话

- `external-edit.ts` 删除 `setInterval` 的“2 秒内容不变 ⇒ 回写”启发式。
- `start()` 生成明文副本后状态保持 `open`；不会自动回写/删除。
- 新增 IPC `warmy:waiBuBianJiJieShu`（`{id, discard?}`）；preload 暴露 `waiBuBianJiJieShu`、`onWaiBuBianJiZhuangTai`。
- 界面：右下角常驻「外部编辑进行中」卡片，列出每个副本，按钮：
  - 「结束并封存」= 回写并清理；
  - 「放弃更改」= 丢弃副本、不动原文件。
- 退出/注销时 `finishAll()` 仍会写回所有开启副本（用户主动退出是明确动作）。
- 确认框明确：确认后一直开放，直到点击结束或退出；拒绝不生成副本；不承诺外部工具被沙箱。

## 6. 测试

| 门禁 | 结果 | 覆盖 |
|---|---|---|
| fast 档 | **127 项次 0 红** | 全量静态 + Electron 快档 |
| `verify-r114-crypto` | 19/19 | JSON/JSONL 密文、错误 key、明文迁移、workspace 边界、未登录写拒绝、显式外部编辑、入口/口径静态 |
| `verify-r114-ui` | 7/7 | 我的页三入口可见/顺序/设置页移除/加密状态 |
| `verify-r111-storage` | 12/12 | SQLCipher + JSONL 密文 + 子进程 key |
| `verify-r111-auth-storage-ui` | 8/8 | 真实注册 → keyEnvelope → memory.db/JSONL 密文 |
| `verify-r111-data` | 36/36 | 选择性导出/导入、旧 vault、外部编辑显式结束 |
| `verify-r104-vault` | 51/51 | 封存/解包/导出/导入/回滚 |
| `verify-r67-firstrun` | 80/80 | 我的页布局回归 |
| `verify-strict-language` | 10/10 | 审计读取 |

## 7. 改动文件

- `packages/app-shell/src/enc-fs.cjs`（新，主进程/记忆子进程共用）
- `packages/app-shell/src/electron-main.ts`（安装加密层、DEK 生命周期、迁移、加密状态 IPC、外部编辑结束 IPC）
- `packages/app-shell/src/memory-client.ts`（子进程 preload/key/根目录）
- `packages/app-shell/src/data-vault.ts`（封存不删受保护目录）
- `packages/app-shell/src/external-edit.ts`（显式会话）
- `packages/app-shell/src/preload.cjs`（新 API/事件）
- `packages/app-shell/src/renderer/app.js`（我的页入口/状态、外部编辑条、文案）
- `packages/app-shell/src/renderer/app.css` / `auth-gate.css`
- `packages/app-shell/src/i18n/*.json`（10 包：外部编辑/全量加密/旧群文案）
- `packages/app-shell/scripts/copy-assets.mjs`（复制 enc-fs.cjs）
- 门禁：`dev/gates/verify-r114-crypto.mjs`、`verify-r114-ui.mjs`、`run-verify-22.mjs`、`verify-r111-storage.mjs`、`verify-r111-auth-storage-ui.mjs`、`verify-r111-data.mjs`、`verify-r67-firstrun.mjs`、`packages/app-shell/scripts/verify-strict-language.mjs`

## 8. 交付

- `release/win-unpacked` 已用最终源码同步；应用启动到首启页。
- 首启截图：`<临时目录>/warmy-r114-final-firstrun.png`。
- 本轮未发布新的 GitHub Release。
