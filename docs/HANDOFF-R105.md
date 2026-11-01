# 第 105 轮交接（2026-10-28）：执行过程按中间回复切段 / 全量真实验收 / 详细交接

> 本轮用户点名：13. 删除上一轮“过程引用”，用中间回复把执行过程切成多段（执行过程默认折叠、中间回复默认展开浮雕）；14. 全部完成后做连续 5 轮真实测试（含前几轮未验收任务，内容每轮不同，发现问题立即停下修复后从第 1 轮重跑）；15. 详细交接。
> 未完成/需协助见 [`OPEN-ITEMS-R105.md`](./OPEN-ITEMS-R105.md)。

---

## 1. 项 13：执行过程按中间回复切段

### 1.1 删除旧“过程引用”

- 删除 `app.js` 的 `guoChengYinYongHtml` 与正式回复下方调用；
- 删除 `app.css` 的 `.guoChengYinYong` / `.gcy*` 样式；
- 删除 10 个语言包的 `chat.processRefs*` 键；
- 更新第 101 轮静态门禁：旧过程引用必须不存在，改为断言新的多段执行过程；第 101 轮 live harness 的旧卡断言改为“旧卡不存在”。

### 1.2 新结构

`guoChengLieHtml(思考分段, 中间回复)` 生成：

- `.guoChengLie` 总容器；
- 每段 `.siKaoKuai.guoChengDuan`（**默认折叠**，`<details>` 不带 `open`），里面是该段的思考段与工具行；
- 每条中间回复 `.zhongJianKa`（**默认展开**，`<details open>`），自身是浮雕卡，里面是中间回复原文（`mdHtml`）。

`guiNaXingDong` 按“中间回复时间戳 ≤ 动作时间戳”的数量得到 `fen`，把动作放进对应 `details[data-fen]`；没有对应段就补一个（支持“中间回复后只有工具没有思考”的情况）。工具与思考在同一段内按 `data-ts` 升序排。流式与完成后重绘共用同一套结构。

无障碍：每个执行过程段都带 `aria-label="执行过程第 N 段 · M 个操作"`（10 语言键 `chat.processSegment`），段内操作数在 `guiNaXingDong` 收尾时更新；屏幕阅读器不会把多段都读成同一个「执行过程」。

### 1.3 真机结果

`dev/gates/r105-live-5-rounds.mjs` 的第 2 轮（MiMo pro，临时 profile）真实模型任务：

```
seg: [ {open:false, acts:0}, {open:false, acts:1}, {open:false, acts:1} ]
mid: [ {open:true, text:"第一步：我先..."}, {open:true, text:"第二步：接着..."} ]
old: 0, acts: 2
```

即：**3 段执行过程默认折叠 + 2 条中间回复默认展开浮雕 + 2 条真实工具操作**，与用户给的例子一致。

---

## 2. 项 14：连续 5 轮真实验收

### 2.1 5 轮真实模型测试（每轮内容不同，只用 MiMo/Ollama，不用 DeepSeek key）

`dev/gates/r105-live-5-rounds.mjs`（临时 profile，MiMo `mimo-v2.6-pro`）：

| 轮 | 测试内容 | 关键断言 |
|---|---|---|
| R1 | 纯问答：13×7 | 回复 91；旧过程引用卡 0 |
| R2 | 两步写文件 + 每步先说一句再调用工具 | 最终回复非空；执行过程 ≥1 段且全部默认折叠；每段 aria-label 的段号/操作数与 DOM 一致；中间回复 ≥1 条且全部默认展开；工具 ≥1；旧卡 0 |
| R3 | 6 步长任务中途停止 → 再问 2+3 | 停止气泡 `stopped`；停止后 0 新操作；继续对话得到 5 |
| R4 | 设置主题 dark → 3840×2160@100% → 短诗 | 主题回读 dark；无横向溢出；标题栏 46px；模型仍可回复 |
| R5 | 记住 517 → 下一轮取回 | 下一轮回复包含 517 |

结果：**23 PASS / 0 FAIL**（第 105 轮追补无障碍断言后重跑），用时约 4–5 分钟。每轮提示词、文件名、数字均不同。

> 偶发观测：追补断言后的第一遍在 R3「停止后继续」超时（其余 16 项通过）；未改产品代码，给 harness 补了超时现场与失败保留 profile，重跑 23/0。未拿到失败现场前不定性为产品修复。

### 2.2 门禁 / 历史功能覆盖

| 范围 | 结果 |
|---|---|
| fast 档三连 | **360 项次 0 红**（每遍 120 项，含第 104 轮全部静态/Vault/nm 门禁） |
| 4K 真机 CDP 五视口 | `verify-r103-4k` **40/0** |
| 第 102 轮 live（下箭头/引导卡去聊天/nm 最大化） | `verify-r102-live` **31/0** |
| 第 103 轮项目 10×10 | 上一轮 **3585 断言 0 红**（10 轮全 10/10）；本轮未改动编排器主路径 |
| 第 104 轮全量 Vault | `verify-r104-vault` **36/0**；临时 profile 注册→封存→自动登录解包→数据恢复链路上一轮通过 |
| 第 104 轮 nm WebContentsView | `verify-r63-nm` **41/0**；临时 Electron WebContentsView smoke 上一轮通过 |
| 第 93 轮短记忆安全（之前一红） | 复核后确认是旧判据：无聊天时允许最多 3 条 KB 起步（第 97/98 轮口径）；更新门禁为 `shared ≤ 3`，**39/0** |
| 第 101 轮静态 | `verify-r101-changes` **62/0**（含本轮新增的执行过程无障碍正/负向断言） |
| 启动实例恢复日志 | 修复 `paiShengShiLi` 重复注册：已存在实例返回 `alreadyRunning` 而不是抛错；真实应用重启后 boot log 无 `instance exists` |

### 2.3 仍需用户 / 硬件参与，无法本地自动验收

- 多显示器、任务栏实际显示；
- IM 真实账号（需要测试账号或 bot token，不要密码）；
- 第二台设备 / 组网；
- 4K 物理屏目检（本机 3440×1392）；
- 签名/公证路线拍板（SignPath Foundation / Apple $99/年 / ad-hoc）；
- Vault 崩溃明文窗口、safeStorage 机器绑定密钥换机重输、强制重注册旧 vault 不可解（风险已记录）。

---

## 3. 项 15：详细交接

- 代码位置：`packages/app-shell/src/renderer/app.js`（`guoChengLieHtml`、`guiNaXingDong`、渲染入口）、`packages/app-shell/src/renderer/app.css`（`.guoChengLie` / `.guoChengDuan` / `.zhongJianKa`）、10 个 i18n 包（`chat.interimReply` / `chat.processSegment`）。
- 门禁改动：`verify-r101-changes`、`verify-r100-stop`、`verify-round28-changes`、`verify-round35-changes`、`verify-round36-changes`、`verify-round38-changes`、`verify-r67-chat-order`、`verify-r93-memory-security`；新增真机 `dev/gates/r105-live-5-rounds.mjs`，并登记进 `run-verify-22.mjs` 的 LIVE 数组。
- 历史文档：`docs/HANDOFF-R101.md` §2.8 已标注旧“过程引用”第 105 轮废弃。
- 构建与验证命令：

```bash
cd packages/app-shell
node ../../node_modules/typescript/bin/tsc -b
node scripts/copy-assets.mjs
node scripts/verify-r101-changes.mjs
node scripts/verify-r104-vault.mjs
node scripts/verify-r63-nm.mjs
cd ../..
node dev/gates/r105-live-5-rounds.mjs
node dev/gates/verify-r103-4k.mjs
node dev/gates/verify-r102-live.mjs
node dev/gates/run-verify-22.mjs --times=3 --tier=fast
```
