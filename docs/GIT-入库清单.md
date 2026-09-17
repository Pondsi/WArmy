# GIT 入库清单（上传 GitHub 前请过一遍）

> 生成时间：2026-09-17
> 当前状态：已跟踪 **275 个文件，合计 201.9 MB**；其中 **约 200 MB 是 `resources/node/` 下的 5 个 Node 归档包**。

---

## 一、结论先说

**这个仓库现在不适合直接上传**：体积的 99% 是可以随时下载回来的二进制，而真正有价值的源码不到 2 MB。建议按下面第三节调整后再建远程仓库。

---

## 二、已经被 `.gitignore` 排除的（无需你操心）

| 规则 | 排除内容 | 说明 |
| :--- | :--- | :--- |
| `node_modules/` | 全部依赖 | 正确 |
| `dist/` | 各包构建产物 | 正确（由 `pnpm build` 生成） |
| `release/` | 打包产物 | 正确 |
| `*.log` `*.tsbuildinfo` | 日志与增量编译缓存 | 正确 |
| `.env` `.env.*` | 环境变量 | 正确，务必保持 |
| `*.db` `*.db-journal/-shm/-wal` | SQLite 投影 | 正确（JSONL 才是事实源） |
| `vendor/agency-agents/` | 第三方 agent 库 | 正确：它有自己的 LICENSE，不该并进本仓库 |
| `spikes/*/models/`、`spikes/spike-07-onnx/models/` | ONNX 模型（约 23 MB） | 正确 |
| `spikes/node_modules/`、`spikes/*/node_modules/` | spike 的依赖 | 正确 |
| `spikes/spike-08-helper/backups/` | hosts 备份 | **本次新增**：是证据，但内容是本机 hosts 快照，不宜入库 |

## 三、需要你决定的（建议全部按"不入库"处理）

| # | 内容 | 现状 | 体积 | 建议 |
| :--- | :--- | :--- | ---: | :--- |
| 1 | `resources/node/*.zip` `*.tar.gz` `*.tar.xz`（5 个平台 Node 归档） | **已入库** | ~200 MB | **移出版本管理**。它们可从 npmmirror 稳定重下（本机实测可达），或改用 Git LFS。仅此一项就能把仓库从 202 MB 降到 ~2 MB |
| 2 | `resources/node/win-x64/node.exe`（解压出的捆绑 Node，记忆服务运行时） | 未入库（未跟踪） | 89 MB | **保持不入库**。改为「构建/首次运行按需解压或下载」 |
| 3 | `spikes/p2-memory/result.json` | 已入库 | 0.11 MB | 可保留（是实测原始证据，有价值且小） |
| 4 | `spikes/spike-*/result.json` 等证据文件 | 已入库 | 均 < 30 KB | **保留**。本次工作的核心就是"让判定有原始输出支撑" |
| 5 | `pnpm-lock.yaml` | 已入库 | 0.09 MB | **必须保留**（ADR 要求它是唯一真理） |

## 四、安全与合规检查（已核）

- **没有跟踪任何凭据文件**：`git ls-files` 搜 `.env` / `secret` / `credential` / `*.key` / `*.pem` / `password` 均无命中（唯一命中 `tokenizer.ts` 是误报，它是分词器实现）。
- **`audit.jsonl` 未入库**：它落在 userData，符合 ADR「审计日志绝不上传」。
- **`vendor/agency-agents/` 未入库**：避免把第三方内容与其 LICENSE 一起并进本仓库；若确实要随仓库分发，应单独标注来源与许可证。
- **`resources/node/` 的 Node 二进制**：属第三方产物（Node.js，MIT），如要入库需一并保留其 LICENSE。

## 五、建议动作（可直接照做）

1. 把归档包移出版本管理（保留磁盘文件）：
   ```bash
   git rm --cached "resources/node/*.zip" "resources/node/*.tar.gz" "resources/node/*.tar.xz"
   ```
2. 追加 `.gitignore`：
   ```
   # 可重新下载的 Node 运行时产物，不入库
   resources/node/*.zip
   resources/node/*.tar.gz
   resources/node/*.tar.xz
   resources/node/*/node
   resources/node/*/node.exe
   ```
3. 新增 `scripts/fetch-node.mjs`：从 npmmirror 拉取并把 `resources/node/<platform>-<arch>/node(.exe)` 解压到位，
   让「全新 clone → 一条命令 → 可构建」成立（否则打包出的应用记忆层会因缺少 Node 而启动失败）。
4. 之后仓库应约为 **2 MB / 300 来个文件**，可以放心上传。

## 六、上传 GitHub 时还要注意

- 本机 **`github.com` 当前不可达**（DNS 解析失败），但 npm registry 与 npmmirror 可达。上传需要你先解决 GitHub 的连通性（代理/镜像/换网络）。
- 单个文件超过 **100 MB** 会被 GitHub 直接拒收——这正是第 1、2 项的另一个理由。
- 建库后，可以把「检查更新」的默认更新源指向该仓库的 **Releases**，这样更新功能才有一个真实 feed 可用（目前只能手填 URL）。

## 七、与打包有关的关联说明

`release/win-unpacked/无限牛马.exe`（解包版，179.9 MB）是**可用**的独立程序；完整的 NSIS 安装包在本机构建失败，原因是
electron-builder 需要解压 `winCodeSign-2.6.0.7z`（内含 macOS 符号链接），在 Windows 上需要**开发者模式或管理员权限**。
开启方式：设置 → 系统 → 开发者选项 → 打开「开发人员模式」，或用管理员身份运行构建。
