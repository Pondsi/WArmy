# P0 Spike 结果（本机 Windows x64 / Node v24.20.0）

> 产品定位澄清：CCArmy 是**多模型通用**桌面应用。DeepSeek 仅为 ADR 参考运行时与缓存指标来源；
> Provider 抽象在 P1 落地。下列涉及 DeepSeek 的 Spike 只验证「架构策略在带 prefix-cache 的 API 上是否成立」。

## Spike 1 — dsh / node-pty 加载
**状态：部分通过**

| 项 | 结果 |
|---|---|
| `@deepseek-ai/dsh` | 0.1.5-rc.1 可加载 |
| `node-pty` | prebuild 可用 |
| 5 平台 bundled Node | 待 CI |

## Spike 2 — better-sqlite3 长驻子进程 IPC
**状态：通过**

| 模式 | hash P95 | FTS P95 |
|---|---|---|
| per-query fork | 37.6ms | 40.0ms |
| **长驻子进程** | **0.11ms** | **0.08ms** |

结论：L2 必须是长驻 child_process。

## Spike 3 — in-history 缓存稳定性
**状态：架构通过（DoD 按多轮增长修正）**

模型：`deepseek-flash`（官方现网模型之一）

| 策略 | 观察 |
|---|---|
| 固定前缀连打 3 次 | hit=0（同请求未复用短 TTL 缓存 / 冷启动） |
| **in-history** 第5轮注入状态后 | **hit 稳定在 128 tokens**，后续 5 轮不掉 |
| rewrite-system | 仅第6轮出现 128 hit，均值 **0.078** vs in-history 均值 **0.42** |

结论（架构级，与厂商无关）：
1. **只追加 + in-history 注入能保住已缓存 system 前缀**（本例 128 tokens ≈ 2 个缓存块）
2. **每轮重写 system 会破坏前缀**，缓存重建更慢、更不稳
3. ADR 原 DoD「多轮命中率 >95%」在**历史不断增长**时不可达——新增 token 必然 miss。正确指标应是：
   - system 前缀 hit 稳定不掉
   - 单轮增量 token 可控（ADR 写 <500，实测增量 ~12）
4. 多模型：OpenAI/Anthropic 等无同款 cache token 字段时，用「前缀是否稳定重放」做代理指标；Provider 层统一上报

脚本：`spikes/spike-03-in-history/run.mjs`

## Spike 4 — FTS5 中文短语边界
**状态：通过（25/25，2字词 100%）**

## Spike 5 — agent-teams + memory-plus 共存
**状态：通过（安装 + 运行时 profile 合并）**

| 项 | 结果 |
|---|---|
| `@nanmicoder/dsh-agent-teams@0.1.17` | 安装成功 |
| memory-plus 源 | `QIANLING-0831/dsh-memory-plus` → `dsh-memory-bundle` |
| 自测 | 47/48（memory-index 1 失败，上游） |
| **dsh profile 合并** | **通过** — `--dump-config` 同时含 `agent-teams` 与 `dsh-memory-*` 全套 |
| 冲突面 | memory-bundle 按设计 disable 基座 `session-query-sqlite` / `compaction-basic`；teams 只 insert tools，不改检索 |
| 脚本 | `spikes/spike-05-plugins/run-merge2.mjs` + 手工 patch（见 RESULTS 合并步骤） |

合并要点（写入 P1 插件管理）：
1. `cordis.patch.yml` 必须是**单一顶层 YAML 数组**（不能 `[]` 后再追加）
2. profile `package.json` 不能带 UTF-8 BOM
3. 需绝对路径 pnpm（Windows PATH 对 dsh 子进程不可见）
4. `dsh.profile.bundles` 声明包名 + patch insert id，二者都要


## Spike 6 — DeepSeek V4 Pro 可用性
**状态：通过**

| 模型 ID | 结果 |
|---|---|
| **`deepseek-v4-pro`** | **可用** |
| `deepseek-flash` | 可用 |
| `deepseek-chat` / `deepseek-reasoner` | 仍可调用（兼容 ID） |
| `deepseek-pro` | 400（旧 ID 失效） |
| `deepseek-v4.1-flash` | 400（当前 models 列表无此 ID） |

现网 `models` 列表：`deepseek-flash`, `deepseek-v4-pro`  
→ ADR「V4 Pro 继续提供」**成立**；代码不得硬编码封杀 V4 Pro。

## Spike 7 — ONNX WASM 嵌入
**状态：通过**

模型：`Xenova/bge-small-zh-v1.5` quantized，vocab 21128，输出 dim **512**

| 后端 | load | P50 | P95 |
|---|---|---|---|
| webgpu（Node 不可用，回退 wasm） | 162ms | 6.6ms | 8.0ms |
| **wasm-simd** | 37ms | 6.5ms | **9.2ms** |
| wasm-nosimd | 35ms | 6.3ms | 7.4ms |

DoD（P95 < 50ms）**达标**。边界输入（空串/超长/纯标点）输出形状正确。  
注：WebGPU 需在 Electron 浏览器上下文测；Node 侧已验证 WASM 兜底足够。

## Spike 8 — gsudo Helper
**状态：通过**（v2.6.1，hosts 提权写入成功，已清缓存）

## Spike 9 — 本地回环
**状态：通过**（RTT 0.34ms）

## Spike 10 — 双节点同步模拟
**状态：通过**

| 项 | 结果 |
|---|---|
| A→B 消息 | 通过文件总线互通 |
| B→A 消息 | 互通 |
| 远程 incognito | 执行后本地文件数不变，零痕迹 |
| 远程 become_duty | **拒绝**（不变量 11） |

## P0 总览

| # | 名称 | 状态 |
|---|---|---|
| 1 | bundled/dsh 加载 | 部分（本机） |
| 2 | SQLite IPC | **通过** |
| 3 | in-history | **架构通过** |
| 4 | FTS CJK | **通过** |
| 5 | 插件共存 | **通过（含 profile 合并）** |
| 6 | V4 Pro | **通过** |
| 7 | ONNX WASM | **通过** |
| 8 | gsudo | **通过** |
| 9 | 回环 IPC | **通过** |
| 10 | 双节点模拟 | **通过** |

## 架构决策（Spike 确认）
1. Node **24** LTS + pnpm workspace
2. L2 = **长驻** memory child process（better-sqlite3 仅在子进程）
3. FTS5 CJK：双侧字符插空格 + 短语 MATCH
4. Windows Helper = **gsudo**
5. **Provider 抽象必需**：DeepSeek 仅作参考实现；缓存指标字段各厂不同，统一到 `CacheUsage { hitTokens, missTokens, source }`
6. in-history 更新写在 JSONL 追加流里，禁止重写 system 前缀
7. memory-plus 源仓库以 GitHub 搜索结果为准，ADR 原 nanmicoder 路径作废
8. **Provider 三协议**（P1 已落地）：OpenAI 兼容（DeepSeek/SiliconFlow/Kimi/GLM…）/ Anthropic / Ollama；预设 7 个，可改 baseURL
