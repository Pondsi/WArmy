# 第 93 轮交接 · 完全授权的边界

> 用户口径：
>  · 完全授权只多给“本会话工作区 + 除程序安装目录外的其他目录”；
>  · **其他会话的工作区/历史仍然禁止**；
>  · **程序安装目录仍然禁止**；
>  · 访问这些要单独申请授权；
>  · 命令类操作也要检查：命中禁止区域就直接失败、告诉模型换方法，不打扰用户，操作记录写明原因。

## 1. 禁止区定义（`protected-paths.ts`）

| 禁止区 | 判定 |
|---|---|
| 程序安装目录 | `app.getAppPath()`、其父目录、`process.execPath` 目录；开发态再向上找到仓库根（`.git`/`pnpm-workspace.yaml`） |
| 本会话工作区根 / 其他会话工作区 | `userData/workspace`；不是当前 `baseDir` 的一律禁止 |
| 会话历史 / 记忆 | `userData/{memory,checkpoints,archive,guifan,impressions,yaoqiu,board,bus,auth}` |
| 账号 / 会话历史文件 | `chat-logs.json`、`chat-meta.json`、`profile.json`、`settings.json`、`appearance.json`、`join-requests.json`、`plans.json` |

> 当前会话工作区仍然放行；桌面/文档/下载等普通系统目录仍然按完全授权放行。

## 2. 文件工具

- `resolveInside()` 解析出绝对路径后统一过 `protectedPathReason()`：
  - 命中且没有一次性授权 ⇒ 抛 `protected-path: <原因>`；
  - `write_file/edit_file/copy_file/move_file/read_file/list_dir/...` 全部走同一条。
- 主进程收到 `protected-path`：
  - **即使完全授权也会弹授权卡**（“AI 请求访问受保护的目录”，写明原因）；
  - 用户同意 ⇒ `grantProtectedOnce(abs)` 一次性放行；同意会被记入路径授权，之后同路径同类操作自动放行；
  - 拒绝 ⇒ 工具失败，模型收到“受保护目录，不要换命令绕过”。
- `open_path` / 读文档 / `lsp_diagnostics` / `download_file` 也各自检查，不再只靠 `write_file`。

## 3. 命令类（run_shell）

`protectedCommandReason(cmd, cwd, baseDir)`：

- 先检查命令的 `cwd` 本身是否在禁止区；
- 拒绝动态执行/编码路径：`-EncodedCommand`、`FromBase64String`、`Invoke-Expression`、`iex`、`eval`；
- 按 `&& || ; 换行 |` 拆段，跟踪 `cd/chdir/Set-Location/pushd/sl` 后的 cwd；
- 对每个“像路径”的 token（盘符、UNC、`/`、`./`、`../`、`~`、`%VAR%`、`$env:`）展开环境变量后解析，检查禁止区；
- 额外拦截“命令同时出现 appdata/@warmy 与 workspace/memory/guifan/yaoqiu…”的混淆写法。
- 命中 ⇒ **直接失败，不弹用户卡**；工具结果告诉模型“这是禁止区域，换方法”；审计 `chat.protected-path-denied`；执行过程明细显示原因。

## 4. 授权语义

- **完全授权 ≠ 访问禁止区**；禁止区需要用户单独授权（文件类可弹卡，命令类直接失败）。
- 普通/严格授权本来就只允许工作区；禁止区同样被拦。
- 用户对某个路径同意过后，路径授权表会记住（读/写分档）；禁止区也复用这张表（但完全授权本身不产生授权）。

## 5. 残余风险（如实写）

- 这是**静态路径扫描 + 宿主校验**，不是 OS 沙箱。经过高度混淆（变量拼接、运行时生成路径、下载脚本再执行）仍可能绕过 `run_shell` 的字符串检查；真正绝对的做法需要 OS 级沙箱/容器/ACL，成本与兼容性都高。
- 已堵住：直接绝对路径、相对路径、`cd`、常见环境变量、编码命令、文件工具、`open_path`、读文档、lsp、下载。
- 如果用户需要“绝对不可越界”，建议下一步接容器/低权限账户运行工具（列入待拍板）。

## 6. 验证

`verify-r93-memory-security`：

- 纯真值表：本会话工作区放行；其他会话工作区、workspace 根、memory、guifan、yaoqiu、程序目录被拒；桌面放行。
- 命令：`cd ../s2`、`%APPDATA%…workspace\s2`、程序目录绝对路径、`-EncodedCommand` 被拒；普通 `echo hi > ok.txt` 放行。
- 文件工具行为级：完全授权下写其他会话工作区 / 程序目录被拒；本会话工作区仍可写（负向断言不误伤）。
