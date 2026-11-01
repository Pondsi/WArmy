# 第 121 轮：6 项决定的落地记录（2026-10-30）

## 1. 技能/插件加密边界 C：代码明文、配置加密、执行时最小副本

- 代码/文档继续明文（外部 Node/Python 可直接执行）；配置仍为 `WARMYEF2` 密文。
- 新增 `plugin-exec-copy.ts`：执行前只复制 `plugin.json`、`package.json`、入口文件和需要解密的配置到一个 0700 临时目录；
  配置以应用内 fs 解密后写 0600，源配置保持密文；`cleanup()` 删除整棵副本；不需要配置时可 `withConfig:false`。
- 门禁 `verify-r121-decisions` 用真实加密层验证：源配置密文、副本入口明文、副本配置解密、无关文件不复制、源配置不被就地解密、cleanup 删除。
- **限制**：当前内置 mcp-bridge 仍由外部解释器直接读明文代码，尚未接入“执行副本”调用点；副本器已可用，接入连接器/插件运行器时直接调用即可。

## 2. run_shell C 混合隔离：永久授权账本

- 保留：工作区 cwd 解析、越界一次性“宿主执行”授权、环境变量白名单、Windows `taskkill /T /F`、POSIX 进程组清理、输出上限。
- 新增永久授权：授权卡第三个选项「永久同意（相同命令和目录）」；账本键 = `sha256(规范化命令 + 解析后的 cwd)`，
  相同命令+相同目录只问一次；设置 `commandGrants` 持久化（最多 200 条），使用/新增/撤销都写审计。
- 可见可撤销：设置 → 安全新增「永久命令授权」列表（刷新/撤销），IPC `mingLingShouQuanLieBiao` / `mingLingShouQuanCheXiao`。
- **边界**：永久授权只对完全相同的规范化命令和目录生效；换目录/改参数会重新询问。容器/沙箱仍只属于“项目”和“牛马”，联系人/群聊没有。

## 3. 创建牛马的本机/容器选项

- 第 119 轮已实现并在本轮复核：创建弹窗「名称 + 本机/容器中」，默认本机；实例 `devEnv` 持久化；
  牛马设置可选容器；容器未就绪时禁止发送；10 语言文案与 `verify-r119-instance-devenv` / 真机 UI 门禁仍在。

## 4. 值班者本体永不执行，只派唯一分身

- 路由器不再把值班者本体塞进执行者列表（`zhiXingQiJi.push(duty.id)` 已删除）。
- 编排器新增唯一分身执行器 `__duty_subagent__`：
  - 只在“无执行者 / 执行者全失败 / 用户点名值班者”时派出；
  - 分身使用值班者自己的模型、人格、工具，在独立执行循环里跑；
  - 模块级 `dutyFenShenBusy` 保证同一时间**最多 1 个**分身；重复请求返回 `duty-subagent-busy`，不排队、不并发；
  - 值班者本体只做派发/汇总，旧的直接 provider 生成路径已删除；
  - 审计 `group.duty-subagent-start/done/failed`。
- 用户明确禁止值班者执行时，本体和分身都不执行，如实说明。
- 门禁：`verify-r121-decisions`（路由器行为 + 静态语义/互斥/唯一执行者）、`verify-r48-heiban` 更新为“三轮都派分身、每轮一次启动”、
  `verify-context-renderer` 验证分身 prompt 有界且不是 200 条全量。

## 5. nm 远程页下载：首次询问、记住位置、按会话工作区默认

- nm 窗口打开时记录 `huiHuaId`；同一文件不同会话**不复用**同一窗口，避免下载目录串会话。
- 网页下载 `will-download`：
  - 该会话第一次下载 → `showSaveDialogSync` 询问位置，默认 `<会话工作区>/downloads`（自动创建）；
  - 选择后把**目录**记入 `settings.nmDownloadDirs[sessionId]`，之后同一会话直接同目录，同名自动 `(1)(2)`；
  - 取消对话框 = 取消本次下载；下载完成/失败/目录选择都写审计。
- 无法识别会话（例如无会话的独立 nm）才退回系统下载目录并每次询问。
- 门禁 `verify-r121-decisions` 覆盖窗口会话绑定、首次询问/记住目录/默认目录/持久化/渲染层传 sessionId。

## 6. 额度、审批等待和会话级总量：只修计量

- **审批等待不计入执行时间**：审批卡创建/回答时累计 `dengDaiPiZhunMs`；聊天指标与执行者 `durationMs`
  统一用 `jiSuanGongZuoHaoShi(墙钟起点, 审批起点, 现在, 审批现在)` 扣除等待，结果不为负；墙钟本身不变。
- **实际 usage**：聊天/执行者指标继续使用供应商返回的 `xiangYing.usage`（prompt/completion/cache）；仅当端点完全不返回用量时
  才按同一 token 口径估算并如实标 `estimated`，不冒充原生。
- **不加默认会话硬上限**：只保留既有预算/额度/窗口机制，没有新增 session 级硬上限。
- 门禁 `verify-r121-decisions`：公式真值表（含时钟回绕）、执行者/聊天接线、审批累计、实际 usage 字段、无新增硬上限。

## 7. 验证

- `verify-r121-decisions` **44/44**。
- 回归：`verify-r48-heiban` 68/68、`verify-context-renderer --no-electron` 全过、`verify-r101-changes` 92/92、
  `verify-zhi-ban-pai-fa` 53/53、`verify-r99-five-axis` 51/51、`verify-r117-directed` 9/9、
  `verify-r44-yuSuan` 176/0、`verify-r81-nm` 63/63、`verify-security` 28/28、`verify-i18n-locales` 163/0。
- fast：**3 遍 · 426 项次 0 红 · 完整全验通过**（严格判分）；`pnpm -r typecheck` 11/11；`verify-gate-manifest` 23/23。

## 8. 仍未完成 / 边界

- 执行副本尚未接到实际插件运行器（当前内置 mcp-bridge 直接读明文代码）。
- 企微/钉钉接收协议仍需真实账号+公网回调；W05 全量存储迁移、W07 outbox/业务 ACK、W09 签名 manifest、
  W11 完整十轮真实验收、W12 最终安装包重建仍未完成。
- 未提交、未推送、未发布；release 安装包仍是此前构建，未用本轮代码重打。
