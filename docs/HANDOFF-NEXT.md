# WArmy 交接（第 10 轮 → 第 11 轮）

> 本文是**接手文档**：读完就能干活。路径一律用占位符（`<工作区>` / `<用户目录>` / `<会话目录>`），
> **不写真实用户路径**（硬门禁 `verify-security` 要求）。

---

## 0. 一句话现状

版本 **0.2.21**；第 10 轮已修：**牛马无法完成任务**（工具参数空 path / 缺扩展名 / 超时误杀 / userData 分裂）、
**超时超次数约定未改乱**（ETA 53/0）、**继续/重试去文案并居中**。
round3-verify **44/44 × 连续 3 轮全绿**（真 Ollama）；smoke 6/6。
配置已清、首启已打开供验收。**未推 GitHub**。

---

## 1. 必守约定（延续）

1. **中文回复**；**中途不汇报、只记台账**，做完一并汇报。
2. **写中文用 write/edit**；不要 PowerShell `Set-Content`。
3. **不要内联 `node -e`**（引号会被拆）→ 写 `.mjs` 再跑。
4. **改 `.ts` 后 `node scripts/copy-assets.mjs`**。
5. **先联网检索**（`搜索助手.py`；Browser Use/IAB 不在工具面时如实说明）。
6. **真本地 ollama 测试**；连续 3 轮 `round3-verify.mjs` 全绿。
7. **门禁三处同步**；**verify-security** 不许真实用户路径/密钥文件名。
8. **`electron-main.ts` 是 CRLF**：用单行锚点或 `.mjs` 替换。

---

## 2. 环境硬事实

| 事实 | 说明 |
|---|---|
| userData | **固定 `@warmy/app-shell`**（不带 --user-data-dir 也不落 Electron 目录） |
| 真 node | `<工作区>\resources\node\win-x64\node.exe` |
| ASCII 联接 | `C:\wbuild` |
| MiMo TTS | 只走 `/v1/chat/completions` |
| Ollama required | `tool_choice:'required'` 走 `/v1/chat/completions` |
| 验收脚本 | `round3-verify.mjs` / `run-gates.mjs --smoke` / `verify-tool-args.mjs` / `verify-round9-fixes.mjs` |

### ETA / 超时超次数（**产品约定，勿改乱**）
- 单次工具：60s / 3 次；等待回复：2min / 5；多步续派：20min / 40
- 连续预测超时 9 次才异常；卡死分析最多换 5 个模型
- 判「没卡死」→ 预警点**加一档**（不是翻倍）

---

## 3. 本轮（第 10 轮）做了什么

| 项 | 根因 | 落地 |
|---|---|---|
| 牛马无法完成任务 | `write_file` 空 path、`make_pptx` 缺后缀、180s 整轮误杀、空 tool 名、userData 分裂 | 路径字段归一（path/file/filePath…）+ 自动补扩展名；整轮超时 600s；过滤空 tool 名；userData 固定；首启恢复/补默认牛马 |
| 超时/超次数 | — | 结构断言 16/16 + ETA 53/0，约定未改乱 |
| 继续/重试 UI | 打断提示冗长 | 去掉「上次的任务被打断了…」；按钮水平居中 |
| 实测 | MiMo 多工具空 path + 180s 掐断 | 修复后 round3 44/44 × 3；工具 get_time/write_file 真成功 |

---

## 4. 待办（第 11 轮）

1. **推 GitHub**（远端 `79e5f158`；本轮未提交未推）。
2. **首启点验**：默认牛马-1 是否出现；继续/重试按钮居中无长文案；多步任务真调工具。
3. 版本可 bump 0.2.22。
4. `spawnInstance` 对已存在实例报错噪声可改成幂等 ok。

### 校验
```powershell
Set-Location C:\wbuild\packages\app-shell
& node "C:\wbuild\node_modules\typescript\bin\tsc" -b
& node scripts/copy-assets.mjs
& "C:\wbuild\resources\node\win-x64\node.exe" C:\wbuild\run-gates.mjs --smoke
& "C:\wbuild\resources\node\win-x64\node.exe" C:\wbuild\verify-tool-args.mjs
```
