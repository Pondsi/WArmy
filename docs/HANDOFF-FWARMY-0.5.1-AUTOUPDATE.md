# FWArmy 0.5.1 自动更新 + 三平台使用手册交接

日期：2026-10-26
仓库：`../FWArmy`（GitHub `Pondsi/FWArmy`）

## 1. 用户要求

1. 做自动更新。
2. 说明 Windows/macOS/Linux 上完整的使用流程、可能出现的问题和额外操作。

## 2. 自动更新实现

### 2.1 更新源与产物

- 更新源：`https://api.github.com/repos/Pondsi/FWArmy/releases/latest`（稳定 Release；测试可覆盖）。
- 平台产物：
  - Windows x64：`*-win-x64.zip`
  - macOS arm64：`*-macos-arm64.tar.gz`
  - macOS x64：`*-macos-x64.tar.gz`
  - Linux x64：`*-linux-x64.tar.gz`
- 校验：GitHub 资产 `digest` 的 sha256；缺失时回退 Release 的 `SHA256SUMS`。下载大小不符也会拒绝。

### 2.2 策略

`data/update.json`：

```json
{
  "auto": "check",
  "intervalHours": 6,
  "lastCheck": 0,
  "latest": { "version": "", "asset": { "name": "", "sha256": "" } },
  "lastError": "",
  "lastInstall": null
}
```

- `off`：不自动检查；管理页仍可手动检查。
- `check`（默认）：启动 60 秒后检查，之后每 `intervalHours` 检查；只提示。
- `install`：发现新版且本机内存队列为空时自动下载/校验/替换/重启；队列非空延后 60 秒重试。
- 管理页「更新」标签可切换策略/间隔（1–168 小时）、检查、立即下载并重启。
- CLI：`FWArmy update`、`update --yes`、`update --yes --force`、`update --auto=install`、`update --auto=check --interval=12`、`update --status`。

### 2.3 安装流程

1. 拉 releases/latest，选当前平台资产。
2. 下载到 `data/updates/<版本>/`。
3. 校验 sha256 / SHA256SUMS。
4. 解压：Windows 优先 `C:\Windows\System32\tar.exe -xf`，失败回退 PowerShell `Expand-Archive`；macOS/Linux `tar -xzf`。
5. 找到 `FWArmy.exe`/`FWArmy`，运行 `--version` 确认能执行且版本匹配。
6. 复制到当前程序旁的 `FWArmy.new` / `FWArmy.exe.new`。
7. 管理面返回 `restarting`；500ms 后关闭监听、落盘 stats/expand/security。
8. 当前程序改名 `FWArmy.old-<ts>`，`.new` 改名为当前程序，带原 `--port/--host/--data/--no-open` 启动新进程。
9. 旧进程轮询 `http://127.0.0.1:<port>/api/health`，最多 30 秒；新进程健康才退出（exit 0）；不健康则杀新进程、回滚旧文件、重启旧进程并记录错误。
10. 新进程启动 15 秒后清理 `.old-*`。

### 2.4 安全/可靠性决策

- 默认 `check`，不默认无人值守重启：避免服务器在转发时突然重启。用户显式切 `install` 才自动安装。
- 队列非空时自动安装延后；手动安装会提示，确认后可 `force`。
- 下载失败/哈希不符/解压失败/新二进制不能运行/新服务不健康 ⇒ 不动当前程序（或回滚），服务保持可用。
- macOS 新二进制无 quarantine、ad-hoc 签名；替换的是文件内容，签名保留。
- Windows 若 Smart App Control / WDAC 拦新 exe，更新会在“新二进制不能运行”处安全失败；旧版本保留。
- 更新源只允许 HTTPS GitHub（测试环境允许本地 HTTP）；不执行任意 URL。
- 数据目录不变，`data/` 保留。
- 0.5.0 没有更新器：0.5.0 → 0.5.1 必须手动装一次；0.5.1 起可更新到后续版本。

## 3. 三平台使用手册

完整手册：[FWArmy docs/USAGE-3-PLATFORMS.md](../../FWArmy/docs/USAGE-3-PLATFORMS.md)（仓库内为 `docs/USAGE-3-PLATFORMS.md`）。

覆盖：

- Windows：`irm` 安装、SmartScreen/Smart App Control、开始菜单、管理页自签提示、建凭据、连 WArmy、防火墙/端口转发、headless/console、更新、卸载、排错。
- macOS：`curl` 安装、Gatekeeper/quarantine、`FWArmy.command`、Apple Silicon/Intel、防火墙、LaunchAgent 可选、更新、卸载、排错。
- Linux：`install.sh`、`.desktop`/软链、SSH 隧道访问管理页、ufw/firewalld、systemd 用户服务、更新、卸载、排错。
- 通用：WArmy 客户端地址/凭据/TLS 指纹、扩网/被扩网、NAT-PMP/STUN、日志、备份迁移（含 `secret.key`）、安全边界、上线检查清单。

## 4. 代码/文件

- `server.mjs`：更新检查/下载/校验/解压/替换/重启/回滚；`update.json`；`/api/admin/update*`；`buildStats().update`；启动 60 秒检查与定时器。
- `admin.html`：新增「更新」标签、卡片、设置、检查/安装按钮、日志/错误/发布说明；顶部“更新 x.y.z” pill。
- `ctl.mjs`：`update` 命令与帮助。
- `verify-update.mjs`：14 条 mock 更新门禁。
- `verify-binary.mjs`：34 条，新增更新状态/设置/管理页标签。
- `.github/workflows/build.yml`：四平台构建 + 41 + 34 + 安装器冒烟 + 14 条更新门禁。
- `docs/USAGE-3-PLATFORMS.md`：三平台完整手册。
- `README.md` / `docs/INSTALL-3-PLATFORMS.md`：版本/自动更新/门禁说明。

## 5. 验收

- 本地 Windows：源码 `verify-expand` 41/0；本机 WDAC 拦新构建的未签名 `FWArmy.exe`（CodeIntegrity 3033），所以 Windows 单文件/更新门禁以 CI 为准；不把本机环境限制写成产品通过。
- WSL Ubuntu 26.04：0.5.1 单文件 `verify-binary` 34/0；`verify-update` 14/0。
- 发布页 `curl .../v0.5.1/install.sh | sh` 在 WSL 全新安装通过；装好后 `FWArmy update` 对真实 GitHub 检查到最新 0.5.1，判定“已是最新”（无更新时不误装）。
- GitHub Actions：
  - 最终 run：https://github.com/Pondsi/FWArmy/actions/runs/40280822789
  - tag v0.5.1 触发的第二次：https://github.com/Pondsi/FWArmy/actions/runs/40285407698
  - Windows / macOS 26 arm64 / macOS 26 Intel / Ubuntu 四个 runner 全部成功：每个 41/0 + 34/0 + 14/0 + 安装器冒烟；macOS 额外 `codesign --verify --strict` 通过。
- Release：https://github.com/Pondsi/FWArmy/releases/tag/v0.5.1（7 个资产，逐项 digest 与本地一致）。
  - `FWArmy-0.5.1-win-x64.zip` 8cf28adb…
  - `FWArmy-0.5.1-linux-x64.tar.gz` efad824e…
  - `FWArmy-0.5.1-macos-x64.tar.gz` f15b6275…
  - `FWArmy-0.5.1-macos-arm64.tar.gz` 8b34fc3a…
  - `install.sh` 3b48cff5…、`install.ps1` b0661a50…、`SHA256SUMS`。

### 发布期修掉的两个真实问题

1. **macOS 工作区里的 `FWArmy.new` 在 500ms 内被系统删除**：更新暂存写到当前 exe 旁的 `.new`，`installUpdate` 记下存在，`applyUpdate` 再查就没了（macOS CI 日志 `exists=true` → `exists=false`）。改为**暂存到 `data/updates/<版本>/`**，应用时直接 rename 到当前程序（跨卷 EXDEV 时才 copy），不再在安装目录长期放 `.new`。
2. **旧进程健康检查用 `fetch` 不够稳**：改为 `http.get` + 700ms 超时 + 30 秒总等待；新进程健康才 exit(0)，否则杀新进程、回滚旧文件、重启旧程序并记录错误。

## 6. 已知限制/待拍板

1. 默认只检查提示；自动安装需手动切 `install`。
2. macOS 首次更新可能因 Gatekeeper/签名校验让新进程启动较慢；旧进程最多等 30 秒后才决定退出/回滚。
3. Windows Smart App Control/WDAC 可能拦未签名新版本；更新会安全失败，需要系统放行或签名。
4. 更新源只靠 HTTPS + GitHub Release + SHA256；没有独立签名（后续可加 minisign/Ed25519 feed 签名）。
5. 0.5.0 用户必须手动升级一次到 0.5.1。
6. GitHub API 未登录限流约 60 次/小时；默认 6 小时检查一次。
7. 仍没有付费签名/公证、Linux arm64、macOS 原生 `.app`、AppImage、开机自启；需要时另开。
8. `--force` 只跳过队列检查，不会把同版本当新版本。

## 7. 文件地图

- FWArmy：`server.mjs`、`ctl.mjs`、`admin.html`、`verify-update.mjs`、`verify-binary.mjs`、`docs/USAGE-3-PLATFORMS.md`、`docs/INSTALL-3-PLATFORMS.md`、`README.md`、`.github/workflows/build.yml`。
- WArmy：本文 `docs/HANDOFF-FWARMY-0.5.1-AUTOUPDATE.md`。
