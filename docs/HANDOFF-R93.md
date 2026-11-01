# 第 93 轮交接总览（2026-10-26）

> 本轮用户 3 条：短记忆按使用频率从知识库更新/压缩；“记住”与反复踩坑的即时方案；完全授权的边界（其他会话/历史/程序目录 + 命令路径检查）。

## 1. 分项交接

| 项 | 文档 |
|---|---|
| 短记忆按使用频率更新 / 压缩（含频率侧车设计） | [HANDOFF-R93-SHORT-MEMORY-FREQ.md](./HANDOFF-R93-SHORT-MEMORY-FREQ.md) |
| “记住”与反复踩坑的即时处理 | [HANDOFF-R93-INSTANT-MEMORY.md](./HANDOFF-R93-INSTANT-MEMORY.md) |
| 完全授权边界（文件工具 + 命令路径） | [HANDOFF-R93-AUTH-BOUNDARY.md](./HANDOFF-R93-AUTH-BOUNDARY.md) |

## 2. 关键变化

- **频率**：知识事件新增 `useCount/lastUsedAt`；仅 `knowledge_query` 真命中时累加。短记忆正文保持干净，频率放 `guifan/<sid>.freq.json` 侧车。
- **归档补入**：只从 `kbLayersFor(sid)` 里挑 `useCount>0` 且不在短记忆中的条目，按次数降序最多 10 条。
- **压缩**：超 2000 字时删 `n` 最小的条目（同 n 比 last，再比先后），不再删最旧；删掉的进内部知识库。
- **即时记住**：用户说“记住/以后/每次/别再…”⇒ 当场写入允许的知识层（单机私密/项目内部/群聊会话），本轮 system 告知模型“已记下”。
- **即时踩坑**：工具失败/被守卫拦下 ⇒ 写 `踩坑·<tool>` 条目；过滤常规权限拒绝；操作明细新增“原因”。
- **完全授权边界**：其他会话工作区/历史、程序安装目录、账号/设置文件统一禁止；文件工具弹卡单独授权；`run_shell` 静态路径扫描命中即失败（不打扰用户）。

## 3. 验证

- `verify-r93-memory-security`：**39/0**（知识频率、短记忆高频补入/低频删除、即时记住/踩坑、禁止区真值表、文件工具行为级）。
- `verify-r92-duanjiyi-yaoqiu`：42/0
- `verify-r92-live`：20/0
- `verify-r53-tishangxian`：81/0
- `verify-prompt-layers`：31/0
- `verify-r82-r103`：18/0
- `verify-r67-firstrun`：80/0
- `verify-r81-ui`：20/0
- `verify-r67-chat-order`：20/0
- `verify-r52-layers`：54/0
- `verify-renderer-scope`：9/0
- `verify-i18n-locales`：162/0
- `verify-ipc-probe`：46/46

既有红未处理：`verify-renderer-template-balance`、`verify-css-consistency`（`.yinYongTiao`）、`verify-r44-ui` 53/14、`verify-r69-join-create` 15/3；原因见 `docs/TIMEZONE-R91.md` 与 `OPEN-ITEMS-R92.md`。

## 4. 残余风险

- 命令扫描是静态的，不能对抗高度混淆/运行时生成路径；要绝对隔离需 OS 沙箱/容器/低权限账户（待拍板）。
- 频率是“被 knowledge_query 命中”的代理，不等于“对答案真的有用”；旧短记忆条目没有历史频率，按 1 起步。
