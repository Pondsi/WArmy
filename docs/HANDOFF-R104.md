# 第 104 轮交接（2026-10-28）：全量加密 vault / 供应商取消 / nm WebContentsView

> 本轮用户点名：10. 凭证恢复 B（导出加密 vault，所有数据可加密导出导入，登录后自动解锁、退出后不可查看）；11. 停止后供应商仍可能计费，接各供应商 cancel/stop；12. nm 网页模式改用 WebContentsView（方案 C）。
> 未完成/需协助见 [`OPEN-ITEMS-R104.md`](./OPEN-ITEMS-R104.md)。

---

## 1. 项 10：全量加密 vault

### 1.1 设计（如实说明边界）

- **静态仓库**：`userData/vault.bin`，AES-256-GCM；密钥 = HKDF-SHA256(账号主密钥, `warmy-data-vault/v1`)。账号主密钥来自助记词/PIN/自动登录，登录成功后才解密。
- **工作副本**：应用解锁期间，数据以普通文件存在 `userData`，现有模块与记忆子进程完全不用改；退出/注销/改 PIN 时重新打包、加密并删除明文。
- **登录后的重启**：登录/自动登录成功后，主进程解包，再把主密钥用 OS 保护（safeStorage）写成一次性 `vault.session`，重启应用；第二次启动在 `yindao()` 之前解包，AuthService 用同一主密钥恢复会话，登录页直接进入主界面。令牌读完立即删除。
- **干净封存标记** `vault.clean`：登录前 `yindao`/渲染层写出的默认配置不能被误当成“崩溃遗留的最新数据”；有标记就先清默认文件再解包。没有标记但有明文 ⇒ 上次异常退出，保留明文（下次封存收进仓库）。
- **不随静态仓库存放的**：`auth/`（登录前必须可读）、`identity/`（本身已用主密钥/OS 保护）、`secure/`（safeStorage 保护的 API Key）。它们已有各自的加密层。
- **不进仓库的**：Electron 缓存/锁文件、`memory-runtime/`、`updates/`、`node_modules`、`.git` 等运行时文件。
- **覆盖**：settings/profile/groups/plans/queues/chat-meta/nodes/trash/eta/token/审计/归档/检查点/知识库/黑板/提示词（dao/shu/agents/Memory/要求/规范/印象）/workspace/products/instances/net/skills/回收站等。

### 1.2 导出 / 导入

- 设置页（及「我的」）原来的「导出配置/导入配置」按钮改为**全量仓库**：
  - 导出：`导出全部数据（加密 .wvault）`，用户口令 scrypt + AES-256-GCM；包含 `auth/`、`identity/`、`secure/`（完整换机恢复）。
  - 导入：`导入加密仓库（.wvault）`，先完整解到临时目录校验（口令错/包坏不碰现有数据），再封存当前明文、整包覆盖；随后重启，按导入包登录。
- 旧 `.NM` 项目/聊天导出仍保留（它是给 AI 读的明文包，和全量 vault 是两件事）。

### 1.3 验证

- `packages/app-shell/scripts/verify-r104-vault.mjs` **36/0**：主密钥派生、登录/注销/改 PIN/退出接线、`.wvault` 导出导入、封存/解包、干净标记、lockfile 排除、错误口令不写半包。
- 临时 profile 真机链路：注册 → 设置/workspace → 退出（settings 与 workspace 明文消失、vault.bin 出现）→ 自动登录（解包+重启）→ settings 与 workspace 恢复 → 再退出（再次封存）。**通过**。
- **边界**：运行期间是明文工作副本（像挂载的加密卷）；进程崩溃时明文可能残留，下次登录优先保留它（`vault.unseal-skip-plaintext`）。外部项目目录（用户自己选的、不在 `userData` 下）不属于本仓库。safeStorage 保护的 API Key/社交密码是机器绑定的，换机后需重新输入。

---

## 2. 项 11：停止时的供应商 cancel/stop

- `MoxingGongYing` 新增可选 `cancel({id,signal})`；基类默认 `supported:false`，不冒充有接口。
- **真实服务端取消**：只有 OpenAI **Responses API** 的 `resp_…` 支持 `POST /responses/{id}/cancel`；本产品聊天走 Chat Completions，拿到的 `chatcmpl-…` 没有该接口。
- OpenAI 兼容（MiMo/DeepSeek/OpenRouter/Gemini 兼容/自定义）、Anthropic Messages、Ollama `/api/chat`：**没有标准服务端取消接口**；停止仍以客户端 `AbortController` 断开连接为准，并审计 `llm.cancel`（`supported:false`）。
- 主进程登记每个会话最近一次供应商；`zhongZhiXinHao` 与项目停止逐个调用 cancel 钩子并写审计。
- 执行者：`ZhixingqiRenwu.signal` + `executorSignal`，项目停止现在能真正掐断执行者在途 HTTP（以前只有标志位）。
- 参考：OpenAI Chat Completions（无 cancel）/Responses cancel；OpenRouter generation ID 只在响应头，未发现公开 cancel 端点；Ollama 无 cancel 端点。

---

## 3. 项 12：nm 网页模式迁 WebContentsView

- 远程 `http(s)` 页面：主进程 `WebContentsView`（`partition:'nm-web'`，sandbox/contextIsolation、无 preload），用 `contentView.addChildView`；渲染层把 `#wangYeKuangHe` 的 `getBoundingClientRect()` 传上去，窗口/分栏/工具栏变化用 ResizeObserver + window resize 同步边界。
- 本地网页：继续 sandbox iframe + `srcdoc`（可编辑源码、即时预览），不受影响。
- 安全：`setWindowOpenHandler` 拒绝新窗；`will-navigate` 只允许 http(s)；权限请求/检查默认拒绝；不改 `webSecurity`。
- 状态：`did-navigate`/`page-title-updated`/`did-start/stop-loading`/`render-process-gone` 回传渲染层；远程打印走 `webContents.print()`；远程查找有 `findInPage` IPC（UI 仍主要给本地源码查找用）。
- 窗口池/吸附/最大化：仍是 BrowserWindow，WebContentsView 只是子视图；关闭窗口销毁视图。
- 验证：临时 Electron 真机 smoke：打开 nm → `nmWangYeKai` → reload → 收到 `url=http://127.0.0.1:…` 与 `title=remote-ok` 事件；`nmWangYeGuan` 正常。`verify-r63-nm` **41/0**（含本地 iframe 与无未捕获异常），`verify-r101-changes` **57/0**（本地 iframe 保留 + WebContentsView 接线）。

---

## 4. 当前状态 / 校验

- fast 门禁三连 **360 项次 0 红**（每遍 120 项）。
- 真实应用已重启到本轮构建，真实 profile 未删除；自动登录成功、主界面已解锁（authState.unlocked=true）。
- 真实 profile 尚未封存（应用正在运行）；下次退出/注销会生成 `vault.bin` 并删除明文。
- 备份：`%TEMP%\warmy-r104-profile-backup-full-*`（本地，不外传；验收后可删）。
- 命令：

```bash
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/copy-assets.mjs
node scripts/verify-r104-vault.mjs
node scripts/verify-r63-nm.mjs
node scripts/verify-r101-changes.mjs
node scripts/verify-gate-manifest.mjs
cd ../..
node dev/gates/run-verify-22.mjs --times=1 --tier=fast
```

- 已知本轮遗留：启动日志 `paiShengShiLi ... instance exists`（持久化实例恢复重复调用，界面正常）；4K 真机目检与签名路线仍是上一轮事项。
