# FWArmy 三平台交付交接（2026-10-26）

> 用户要求：判断 FWArmy 改用 Java 是否更好；如果可行，把运行时打进包里，产出 Windows/macOS/Linux 都能直接运行的程序；验证通过后发布到 GitHub，替换旧 FWArmy。若 Java 不合适或有更好方案，先商量。
>
> 追加问题：现有 Node 方案能否在三个平台**不买 Apple Developer ID 类似公证**的情况下双击运行？有哪些方案能实现？
>
> 结论：**不改 Java**；保留 Node，用 GitHub Actions 四平台真实构建 + 无证书安装器（curl/irm 安装，macOS ad-hoc 签名，Windows 无 MOTW），验证后发布 0.5.0。

## 1. 为什么不用 Java

| 事实 | 影响 |
|---|---|
| `jpackage` 明确不能交叉编译，每个安装格式必须在目标平台构建 | Java 仍需 Windows/macOS/Linux 三套构建，和 Node SEA 一样；没有“一次构建三平台”优势 |
| 自带 JRE 仍是按平台的 JRE | 不能一个包通吃三平台；用户仍需对应架构 |
| 现有 FWArmy 2,621 行服务端 + 513 行 CLI + 管理页，已覆盖 TLS 自签/指纹固定、Ed25519、STUN/NAT-PMP、限额、扩网、AES-GCM 凭据存储 | Java 重写约 4,000 行，协议兼容风险最高、周期最长 |
| 体积：Node SEA 93–127 MB；Java 约 50–60 MB；Go 约 12–15 MB | Java 只赢 Node 一点，输 Go 很多；但三者都要面对同样的 macOS Gatekeeper/Windows SmartScreen |
| 现有源码门禁 41 条全绿 | 保留 Node 可以把风险压到最低 |

如果未来确实要“更小、零运行时”，正确方向是 Go 重写（真交叉编译、12–15 MB 静态文件），不是 Java。Java 只在“团队只熟 JVM”时有意义；本项目不是。

## 2. 无证书双击的真话

| 场景 | macOS | Windows | Linux | 付费证书 |
|---|---|---|---|---|
| 浏览器下载 → 首次双击零警告 | 必须 Developer ID + 公证 | 只有 Microsoft Store 能保证 | 不需要 | macOS 是；Windows 看渠道 |
| 一行命令装好 → 之后双击 | 可以：curl 安装 + ad-hoc 签名 | 可以：irm/curl 安装，避开 MOTW；Smart App Control 可能拦 | 可以：tar.gz + `.desktop` | 不需要 |
| 浏览器下载 → 手动放行一次 | 系统设置 → 仍要打开，或 `xattr` | 更多信息 → 仍要运行 | 不需要 | 不需要 |

机制：

- macOS Gatekeeper 只检查带 `com.apple.quarantine` 的文件；浏览器下载会打标记，`curl`/`scp` 不会。
- Apple Silicon 要求所有原生代码至少 ad-hoc 签名；ad-hoc 不等于公证。`build-sea.mjs` 已执行 `codesign --sign -`。
- macOS 15 取消右键“打开”；部分 26.x “仍要打开”不稳定，最后只能 `xattr -dr com.apple.quarantine`。
- Windows SmartScreen 看签名/MOTW/声誉；未签名浏览器下载首次会警告。`Invoke-WebRequest`/`curl` 通常不加 MOTW。
- Windows 11 Smart App Control 会直接拦未签名程序，跟 MOTW 无关；要彻底解决只能 Store 或有效签名。
- EV 证书已不再即时免警告；Microsoft Store 是唯一“永不警告”保证。
- Java/Go/Node 都一样，这是 OS 策略，不是语言问题。

### 本次选择的落地方式

- macOS：`curl` 安装器下载 tar.gz（不带 quarantine），构建时 ad-hoc 签名；安装后双击 `FWArmy.command`。浏览器下载时安装器尝试 `xattr -dr`。
- Windows：`irm` 安装器下载 zip（不带 MOTW），解压到 `%LOCALAPPDATA%\FWArmy` 并建开始菜单快捷方式；双击不触发 SmartScreen。Smart App Control 例外写进 README。
- Linux：tar.gz + 生成 `~/.local/share/applications/fwarmy.desktop` 和 `~/.local/bin/fwarmy`；应用菜单双击启动。
- 结论：**装一次，之后三平台双击**，零付费证书；不能保证“浏览器下载压缩包后首次双击零警告”。

### 如果以后要浏览器下载零警告

- macOS：Apple Developer Program 99 美元/年 + `codesign` + `notarytool` + `stapler`（公证免费）。
- Windows：Microsoft Store（唯一保证）或 Artifact Signing/OV 证书（约 9.99 美元/月起，首次仍可能警告）。
- Linux：无需。
- 签名是构建后的附加步骤；现有 CI 可直接加 `codesign`/`signtool`。需要用户提供账号/证书；代理不能代购。

## 3. 本轮实现

### 3.1 打包/安装

- `package.json` 0.5.0；新增 `test:binary`、`package` 脚本。
- `build-sea.mjs`：
  - SEA 资源增加 `logo.svg`，修复单文件 `/assets/logo.svg` 可能 500。
  - 按平台拷贝安装脚本、`FWArmy.command`、`FWArmy.desktop`、`assets/logo.svg`；`.sh`/`.command` 设可执行位。
- `install.sh`：
  - 平台/架构识别（macOS arm64/x64、Linux x86_64）。
  - 从 Release 或 `FWARMY_BASE` 下载、读取 `SHA256SUMS`、校验。
  - macOS 装 `~/Applications/FWArmy`、`xattr` 清理、保留 `data/`。
  - Linux 装 `~/.local/share/fwarmy`、软链、`.desktop`、保留 `data/`。
- `install.ps1`：
  - Windows x64，下载、SHA256、解压 `%LOCALAPPDATA%\FWArmy`、开始菜单快捷方式、保留 `data/`。
  - 已加 UTF-8 BOM（Windows PowerShell 5.1 读中文必需，否则脚本解析失败）。
- `FWArmy.command`：macOS 双击后台启动并打开管理页。
- `FWArmy.desktop`：Linux 桌面项模板（安装器写绝对路径版本）。
- `ctl.mjs`：`stop` 先调 `/api/admin/shutdown`，三平台优雅落盘并 exit(0)；信号杀只作回退。Windows 上不再依赖 SIGTERM。
- `packaging/package.mjs`：只收程序文件，绝不收 `data/`；生成平台目录、zip/tar.gz、SHA256。
- `.github/workflows/build.yml`：四平台矩阵。

### 3.2 验收

- `verify-binary.mjs`：31 条黑盒验收，不 import 源码，直接跑构建出的单文件：
  - `--version`、健康检查、管理页、内嵌 logo、首次凭据 pending=false；
  - 新建凭据、无凭据 401、Ed25519 A/B 注册、在线查询、心跳、批量在线；
  - A→B 入队、同 msgId 第二次允许（max 2）、第三次 409、B 取到 2 个信封、取走后不重复、bye 后离线；
  - 管理面证书指纹、同端口 TLS 握手、指纹匹配；
  - Host 非回环 403、跨站 Origin 403、表单 POST 403；
  - 被扩网凭据、`/api/expand/ping`、CLI `table`；
  - 管理面 shutdown、第二次启动、CLI `stop`、停后端口不响应。
- 本地 Windows 11：`verify-expand` 41/0；`verify-binary` 31/0；`install.ps1` 本地 artifact 安装、升级保留 `data/` 通过。
- 本地 WSL Ubuntu 26.04：构建 Linux 单文件；`verify-expand` 41/0；`verify-binary` 31/0；`install.sh` 安装、`.desktop`/软链、升级保留 `data/` 通过。
- CI：Windows / macOS 26 arm64 / macOS 26 Intel / Ubuntu 四个真实 runner 全部通过：
  - 每个平台：`verify-expand` 41/0 + `verify-binary` 31/0 + 安装器冒烟；
  - macOS 额外 `codesign --verify --strict` 通过（ad-hoc，未公证）；
  - run：https://github.com/Pondsi/FWArmy/actions/runs/40273569952
- 发布后实测：
  - Windows 11 用发布页 `irm .../v0.5.0/install.ps1 | iex` 全新安装，输出无错误，`--version` 为 0.5.0；
  - WSL Ubuntu 用发布页 `curl .../v0.5.0/install.sh | sh` 全新安装，`--version`、`.desktop`、软链均正常；
  - 发布资产逐个按 `SHA256SUMS` 校验通过。

## 4. 产物与版本

- 版本：0.5.0（与 `server.mjs` 的 `VERSION` 对齐）。
- Release：https://github.com/Pondsi/FWArmy/releases/tag/v0.5.0
- 四个平台包（GitHub 资产 SHA256 已核对）：
  - `FWArmy-0.5.0-win-x64.zip` — 34,943,921 B — `17fe7f5ee417ba0c050794b89514f80ccd2688305c1ed26e299a81798ced13c4`
  - `FWArmy-0.5.0-linux-x64.tar.gz` — 43,344,381 B — `42ad7330198ece9dfa6b92771e8214ccec0713f8b5177ca62904e35f4819d902`
  - `FWArmy-0.5.0-macos-x64.tar.gz` — 40,571,584 B — `1d6df6f5928d043d78a84b7853a4222b3ea9a696723869a49069de8783ba9eef`
  - `FWArmy-0.5.0-macos-arm64.tar.gz` — 38,616,095 B — `0a178e3ae0727182b3803116b8ed36729eb634abd41eea82865a3bb921102bfd`
- 发布附加：`install.sh`（4,616 B，`12105b45…`）、`install.ps1`（4,647 B，`ca278169…`）、`SHA256SUMS`。
- 单文件本体大小：Windows 93,722,624 B；Linux 126,749,888 B；macOS x64 124,272,896 B；macOS arm64 121,194,496 B。
- 旧 Release v0.1.0（仅 Windows exe）保留历史，但 README 和“Latest”指向 0.5.0；是否删除旧 release 由用户决定（不可逆）。

## 5. 已知限制

1. macOS 未公证：浏览器下载会被 Gatekeeper 拦；用 curl 安装或 `xattr` 放行。
2. Windows 未签名：浏览器下载会 SmartScreen；Smart App Control 开启时可能直接拦。
3. Linux 只提供 x64；arm64 Linux 需要再加构建矩阵。
4. 没有 AppImage；Linux 用 tar.gz + `.desktop`。AppImage 可后续加，体积约 127 MB，部分发行版缺 libfuse2。
5. macOS 双击是 `.command`（会弹终端），不是原生 `.app`。要做 `.app` 需把数据目录改为 `~/Library/Application Support/FWArmy` 并处理 bundle 只读；本轮未做。
6. 安装器不做自动更新；升级重新跑一行命令，`data/` 保留。
7. 不注册系统服务/开机自启（有意，避免“程序自己启动”）；需要常开可自行配 launchd/systemd/计划任务。
8. CI 的 macOS 验收是 headless：跑了二进制、TLS、管理页、安装器、codesign；没有模拟 Finder GUI 双击。真实双击靠 ad-hoc 签名 + 无 quarantine 机制，文档写明。

## 6. 最坏情况

- 用户从浏览器下载 macOS 包直接双击：被 Gatekeeper 拦，需要一次 `xattr` 或系统设置放行。
- 用户 Windows 11 开着 Smart App Control：未签名 exe 被直接拦，需要关闭或等签名版本。
- 用户把管理端口映射公网：管理面只回环，仍拒绝；业务面会暴露，需要防火墙/反代。
- 用户删安装目录：凭据/统计一起丢；`data/` 没有云端备份。
- 用户只替换 exe 不跑安装器：旧桌面项/脚本可能残留；重跑安装器对齐。

## 7. 文件地图

FWArmy 仓库（`../FWArmy`）：

- `server.mjs`：服务端（本轮未改协议）。
- `ctl.mjs`：CLI；`stop` 改优雅关闭。
- `build-sea.mjs`：单文件构建 + 平台资源拷贝。
- `install.sh` / `install.ps1`：三平台无证书安装器。
- `FWArmy.command` / `FWArmy.desktop`：macOS/Linux 双击入口。
- `verify-binary.mjs`：31 条单文件黑盒验收。
- `packaging/package.mjs`：平台包 + SHA256。
- `.github/workflows/build.yml`：四平台 CI。
- `README.md` / `说明.md` / `docs/INSTALL-3-PLATFORMS.md`：安装与系统拦截说明。

WArmy 仓库：

- 本文件 `docs/HANDOFF-FWARMY-3PLATFORM.md`。
- WArmy 集成门禁仍通过 `../FWArmy` 读取 `server.mjs`；协议未变。

## 8. 还需用户决定/协助

1. 是否要“浏览器下载零警告”：
   - 要：需购买 Apple Developer ID（99 美元/年）并提供证书；Windows 需 Store 或 Artifact Signing/OV 证书。代理可接 CI，但不能代购。
   - 不要：当前无证书方案已可用，保持现状。
2. 旧 Release v0.1.0 是否删除：保留（推荐，历史可查）或删除（不可逆）。
3. Linux arm64 是否本轮就要：要则加 `ubuntu-24.04-arm` runner 或交叉构建；不要则 0.5.0 只发 x64。
4. macOS 是否要做原生 `.app`（而非 `.command`）：要则需改数据目录和 bundle 结构，属于下一轮产品改动。
5. 是否要 AppImage：要则加 127 MB 左右产物和 libfuse2 说明；不要则维持 `.desktop`。

## 9. 最终发布记录（2026-10-26）

- Release：https://github.com/Pondsi/FWArmy/releases/tag/v0.5.0
- 四平台 CI 全绿：https://github.com/Pondsi/FWArmy/actions/runs/40273569952
- tag v0.5.0 触发的第二次 CI：https://github.com/Pondsi/FWArmy/actions/runs/40276118087（同样全绿）
- 发布 commit：`bb1813c163bd250e424fb15d6af631ac9f5732f6`（tag v0.5.0）
- main 最新：`51852d44d79dcd993e667a9044218b242c51a495`（安装器 ASCII 热修 + 最终验收文档）

### 9.1 发布后实测

- Windows 11：发布页 `irm .../v0.5.0/install.ps1 | iex` 全新安装，输出干净、无 PowerShell 解析错误，`FWArmy.exe --version` = 0.5.0。
- WSL Ubuntu 26.04：发布页 `curl .../v0.5.0/install.sh | sh` 全新安装，`FWArmy --version` = 0.5.0，`.local/bin/fwarmy` 与 `.desktop` 均生成。
- 发布资产 `SHA256SUMS` 下载后逐项 `sha256sum -c`：4 个归档 + 2 个安装脚本全部 OK。
- macOS：CI 内 `verify-expand` 41/0、`verify-binary` 31/0、安装器冒烟、`codesign --verify --strict` 全通过；本地无 macOS，未做 Finder 双击 GUI 点击。

### 9.2 发布期发现并修掉的问题

1. 仓库缺 `verify-expand.mjs`：本地有、发布仓库从未提交，首轮 CI 在 `node verify-expand.mjs` 直接 MODULE_NOT_FOUND；已补入仓库并重跑。
2. `install.ps1` 的 UTF-8 BOM：`-File` 能跑，但 `irm release-asset | iex` 会把 BOM 当命令片段，先报一个非致命错误。已改为纯 ASCII 文案、无 BOM；发布页根目录的 `install.ps1` 已重新上传为 `text/plain; charset=utf-8`，实测 `irm | iex` 干净。
3. 发布资产默认 `application/octet-stream`：`irm` 会拿到 byte[]，`iex` 不接受。已把 `install.ps1` / `install.sh` / `SHA256SUMS` 的内容类型改为 `text/plain; charset=utf-8`。
4. Windows zip 内的 `install.ps1` 是构建时副本（旧 BOM 版，`-File` 可正常用）；一键安装始终使用发布页根目录的 ASCII 版。若要做到“zip 内也完全一致”，下一版重新跑 CI 并在构建前同步安装器即可。

### 9.3 仍未做/待拍板

- 付费签名/公证（macOS Developer ID、Windows Store 或 Artifact Signing/OV）。
- 旧 Release v0.1.0 是否删除（保留历史更稳）。
- Linux arm64、macOS 原生 `.app`、AppImage。
- 安装器自动更新、系统服务/开机自启（当前有意不做）。
- macOS 的 Finder 双击 GUI 验收只能等有真机时补；CI 已覆盖二进制运行、安装器、签名验证。
