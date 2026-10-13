# WArmy 交接（第 11 轮 → 第 12 轮）—— 点击卡顿专项

> 路径一律用占位符。中文回复、中途不汇报只记台账、脚本写 `.mjs` 别内联 `node -e`、
> 改 `.ts` 后必须 `copy-assets`、`verify-security` 不许真实用户路径/密钥文件名。

---

## 0. 一句话现状

**点击卡顿**已定位并修复主因：无边框窗口里的**原生 `<select>` 弹层** + **设置页整页 innerHTML 重绘**。
实测「选择要添加的供应商」下拉开合 **1–4ms**（原先经常卡住）；smoke 6/6。
本轮**只验了卡顿**，其它功能未重跑 3 轮。

---

## 1. 根因（为何鼠标能动、点击却卡）

| 层 | 原因 | 说明 |
|---|---|---|
| Chromium | **长任务阻塞主线程** | 鼠标移动走合成器线程，**点击要在主线程做命中测试**；主线程 >50ms 长任务 ⇒ 点击排队/丢失 |
| Electron | **无边框窗口 + 原生 `<select>`** | Windows 上原生下拉弹层在 `frame:false` 里又慢又怪 |
| 应用 | **`renderPage()` 整页重绘** | 设置页模板 3000+ 行，一次 innerHTML 数百毫秒～数秒 |
| 桌宠 | `setIgnoreMouseEvents(true,{forward:true})` | Windows 上 forward 点击转发不稳（见 electron#35030）；桌宠开着时会挡点击 |

联网结论（web.dev / Chromium jank / Electron issues）：
- 长任务要**拆分**或 **跳过屏外渲染**
- `forward:true` 穿透在 Windows 有 bug
- 原生 select 在 frameless 里应换成自定义下拉

---

## 2. 本轮改动

| 项 | 做法 |
|---|---|
| 供应商下拉 | **自定义按钮 + 浮层**（`provXiaLa`），不再用原生 select；点击 1–4ms |
| 设置页卡顿 | `.sheZhiKa { content-visibility: auto }` 跳过屏外渲染 |
| 添加供应商 | 保存后**先更新按钮/占位**，`renderPage` 挪到 `setTimeout(0)`，点击立刻返回 |
| 桌宠穿透 | 代码注释已标明 Windows `forward` 风险（未改行为，本轮只验卡顿） |

**实测**（`verify-click-lag.mjs`）：
```
dropdown panel latencyMs = 1~4
8 clicks = 1,1,2,1,3,1,1,1  → LAG TEST PASS
```
「添加供应商」按钮仍会触发整页重绘（约 2.6s），已改成异步，**点击本身不再卡死**。

---

## 3. 必守约定（延续）

1. 中文回复；中途不汇报只记台账；做完一并汇报。
2. 写中文用 write/edit；脚本写 `.mjs`。
3. 改 `.ts` → `node scripts/copy-assets.mjs`。
4. 测试用真本地 ollama；改行为后要 3 轮 `round3-verify` 全绿（本轮只验卡顿，未跑）。
5. `verify-security` / `verify-i18n-locales` 等门禁先过再交。
6. userData 固定 `@warmy/app-shell`；首启**不预置牛马**（只恢复磁盘实例）。
7. 工具参数已支持 path/file/filePath 别名 + 自动补 office 扩展名；整轮工具循环超时 600s。

---

## 4. 环境

| 项 | 值 |
|---|---|
| 真 node | `<工作区>\resources\node\win-x64\node.exe` |
| 记忆/实例子进程 | **优先 electron.exe + ELECTRON_RUN_AS_NODE**（避免未签名 node.exe 被 Windows 拦） |
| 探针 | `verify-click-lag.mjs`（点验下拉延迟） |
| 门禁 | `run-gates.mjs --smoke`、`verify-security.mjs`、`verify-i18n-locales.mjs` |

---

## 5. 待办（第 12 轮）

1. **继续压卡顿**：
   - 「添加供应商」仍会 `renderPage()` 整页重绘（~2.6s）→ 抽成只刷新供应商列表
   - 其它原生 `<select>`（音频设备、安全档位等）也可换成同一套自定义下拉
   - 桌宠 `forward:true`：Windows 上改为「离开本体才 ignore 且不 forward」或 `setShape`
2. **真机点验**：设置里连续点下拉/切换分区/滚动，确认不再出现「点击没反应」
3. 若 Windows 仍弹「无法验证发布者」：正式发布需**代码签名**；开发期可对 electron/node 解除锁定（MOTW）
4. 需要时再跑 3 轮 `round3-verify` + 推 GitHub

### 校验
```powershell
Set-Location C:\wbuild
& "C:\wbuild\resources\node\win-x64\node.exe" verify-click-lag.mjs
& "C:\wbuild\resources\node\win-x64\node.exe" run-gates.mjs --smoke
& node "C:\wbuild\node_modules\typescript\bin\tsc" -b packages/providers packages/app-shell
# 改 .ts 后：
Set-Location C:\wbuild\packages\app-shell
& node scripts/copy-assets.mjs
```

---

## 6. 新窗口开场白（可直接粘贴）

```
读 docs/HANDOFF-NEXT.md（第 11 轮·点击卡顿专项）。继续压 UI 卡顿：
把 renderPage 整页重绘拆掉/只刷供应商列表，其余原生 select 换自定义下拉，
桌宠 forward 穿透在 Windows 改稳妥方案。用 verify-click-lag.mjs 点验延迟。
中文回复、中途不汇报、脚本写 .mjs、改 .ts 记得 copy-assets、门禁先过。
```
