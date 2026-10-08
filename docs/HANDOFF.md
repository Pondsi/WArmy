# WArmy 交接文档（HANDOFF）

> 交接时间：2026-10-08
> 上一会话：`ses_ffe5f4032c1e6ffeyyCQHiNS2f`
> 当前版本：`0.2.19` · 最近提交 `34fb1c7`
> 仓库：`Pondsi/WArmy`（public）

---

## 一、项目是什么

**WArmy（无限牛马）** —— Electron 多智能体群聊桌面应用。

- 路径：`C:\Users\p\.openclaw\workspace\大龙虾互动区\WArmy`
- ASCII 别名：`C:\wbuild`（junction，遇到中文路径问题时用）
- 技术栈：Electron + TypeScript + 原生 JS 渲染层（无框架）
- 包结构：`packages/app-shell`（主）、`contracts`、`providers`、`group-router`、`memory-os`、`knowledge-base`、`board` 等

### 关键目录

| 路径 | 作用 |
|---|---|
| `packages/app-shell/src/electron-main.ts` | 主进程（12000+ 行，单一文件） |
| `packages/app-shell/src/renderer/app.js` | 渲染层（18000+ 行，单一文件） |
| `packages/app-shell/src/renderer/index.html` | 界面骨架 |
| `packages/app-shell/src/renderer/snip.html` | 截图选区窗（独立 BrowserWindow） |
| `packages/app-shell/src/renderer/mimic.html` | 拟态桌宠窗（独立 BrowserWindow） |
| `packages/app-shell/src/i18n/*.json` | 10 个语言包（各 2258+ 键，键集合必须完全一致） |
| `packages/app-shell/scripts/verify-*.mjs` | 53 个门禁脚本 |
| `docs/dao.md` | 全局最高优先级提示词（「道」） |
| `docs/TASKS-666.md` | 任务台账（6900+ 断言） |

---

## 二、必守约定（用户偏好，勿违反）

1. **中文回复**
2. **中途不提问** —— 遇到无法自行操作的事，全部做完后一次性说明
3. **用证据说话**，不臆测；无法验证时明确说"无法验证"
4. **连续 3 轮全量验证通过**才算完成（`FULL_VERIFY_3X_PASSED`）
5. **每次验收前删配置从首启打开**
6. **发布新版本不覆盖旧版**
7. **最终一次性完整汇报**
8. **绝不查看本地配置文件内容**（WArmy 的 `settings.json` 等）
9. **不绕过安全策略**
10. **不并发开多个子代理**（会压垮引擎）；单个后台子代理可用

---

## 三、搜索能力（已接入，勿再重复探索）

调用链（按优先级降级）见 `C:\Users\p\.openclaw\workspace\大龙虾互动区\搜索助手.py`：

```bash
python 搜索助手.py probe                    # 逐层探活
python 搜索助手.py search "关键词" --count 10
python 搜索助手.py extract <url> --query "聚焦问题"
python 搜索助手.py chain "关键词"           # 自动降级
python 搜索助手.py chainx <url>
python 搜索助手.py ollama "要总结的文本"
```

| 层 | 状态 |
|---|---|
| Tavily（key 从 `C:\Users\p\.openclaw\openclaw.json` 运行时读取，**不落地不打印**） | ✅ |
| Firecrawl（**免 key 可用**，实测 scrape/search 都返回 200） | ✅ |
| Ollama `127.0.0.1:11434`（`qwen3.8-27b` 等） | ✅ |
| webfetch + Bing | ✅ |
| SearXNG `127.0.0.1:8888` | ❌ 缺依赖（用户已明确**不用它**） |
| baidu-search | ❌ 无 `BAIDU_API_KEY` |

**注意**：`websearch` 技能要求 Browser Use（`agent.browsers`），该工具不在工具面里 —— 直接用 `搜索助手.py` 即可。

---

## 四、常用脚本（均在 `%TEMP%`）

| 脚本 | 用途 |
|---|---|
| `warmy-open-0214.py` | 删配置 + 首启打开（portable 被拦则回退签名 Electron 运行时） |
| `warmy-privacy-scan.py` | 隐私扫描（预期 6 处夹具，无真密钥） |
| `warmy-push-029.py <版本>` | 走 Git Data API 推代码（`git push` 不可用，remote 路径损坏） |
| `warmy-search.py` / `搜索助手.py` | 搜索助手 |
| `warmy-rel-0214.py` | 发 Release |

### 构建 / 验证

```powershell
cd packages\app-shell; npm run build          # tsc -b + 语法检查 + 拷贝资产
cd <repo>; node scripts/full-verify-rounds.mjs 3   # 3 轮全量门禁
```

---

## 五、已知陷阱

1. **中文路径**：`Set-Content -Encoding UTF8` 会毁中文源文件；PowerShell 内联 Python 带中文/引号会 ParserError → **一律写 `%TEMP%\*.py` 再执行**
2. **`Test-Path` 对全角字符路径会误报 False**（如 `[声音ID：13068].wav`）→ 用 `Get-ChildItem -Recurse -Filter`
3. **i18n 门禁只查键集合/占位符，不查"是否真的翻译了"** → 英文泄漏要人工扫
4. **推送脚本漏文件**：`renderer/mimic/**`、`sounds/tixing.mp3` 未被推上去（疑似扩展名/体积过滤）→ 见任务台账 T-新-07
5. **函数作用域陷阱**（刚踩）：右栏独立渲染的组件若引用设置页作用域内的函数，**没打开过设置页就不存在** → 新功能要么放顶层，要么加安全回退

---

## 六、当前任务台账

见 `docs/HANDOFF-TASKS.md`（15 项未完成 + 1 项基建）。
