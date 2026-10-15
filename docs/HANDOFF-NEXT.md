# WArmy 交接（第 23 轮 → 第 24 轮）

> 中文、脚本 `.mjs`、改 `.ts` 后 `copy-assets`、门禁无用户路径/密钥名。只能派 1 个子代理。
> ⚠️ 千万别用 PowerShell 读写源码（GBK 毁中文）。
> 仓库目录含中文，`run-gates.mjs` / `run-verify-22.mjs` 用 `C:\wbuild`（ASCII 绑定路径）跑。

## 0. 一句话现状

**第 23 轮 13 项已做完**（字体颜色全局统一与对比度、技能页对齐工具、文件卡片时间/最近改动、词元信息、呼吸加强、喇叭跨页恢复、云端 ASR 说明、DeepSeek Shell 文案、TTS 调研、Ollama+MiMo 真机联调、fast 3 遍全绿、配置已清、安全扫描过）。
`node run-verify-22.mjs --tier=fast --times=3` → **连续 3 遍全绿（183 项次）**；
`verify-round20-team.mjs --ollama` + `MIMO_KEY_FILE` → **29/29**；
`verify-round23-live.mjs` → **22/22**（Ollama 对话/工具落盘 + MiMo token-plan 真实调用）。

## 1. 本轮已做（第 23 轮）

| 项 | 结果 |
|---|---|
| 字体颜色 | `applyInk` 派生 `--muted`/`--ink-dim`（淡化自字体色）；对话气泡 `tiaoZhengInkDuiBi` 按主题色/气泡底明暗灰度校正 ≥4.5 对比；强调文字仍走 `--accent`（主题色） |
| 云端语音识别 | **不删**：主路径是听话模型链；云端 Deepgram/AssemblyAI 仅在听话模型效果不好时可选。提示文案已改清楚 |
| 技能页 | 去掉「本地 SKILL」标题 →「AI 技能」；列表在上、自动发现目录在下（同工具页）；勾选框右侧 +「启用」，删除紧挨其右 |
| DeepSeek Shell | 包名是 `@deepseek-ai/dsh`（不是 deepseek-harness）；`npm view` 失败时文案改为「registry 查询失败：网络不可达或未安装」 |
| 呼吸效果 | `langDuHuXi` 光晕从 18%/38% 提到 32%/55% |
| TTS 参数 | 已有语速（50–200）+ 音色（speakers 下拉）；ElevenLabs 常见参数：voice_id/model_id/stability/similarity_boost/style/speed；OpenAI：model/voice/speed/response_format/instructions。MiMo 有 `mimo-v2.5-tts` 但标准 `/audio/speech` 在 token-plan 端点 404 |
| 喇叭图标 | `window.__langDuZhongKey` 跨 `renderChat` 重绘恢复播放态 |
| 文件产物 | 时间（时分）放名称前、不截断；名称可截断；悬停年月日时分秒+大小 |
| 最近改动 | work-tool 写/改/删/移写入 `groupStore.recordFileAccess`（新增 `move` 档）；无项目目录时并入工作区产出 |
| 词元信息 | 时间右侧「输入X，输出Y」；usage 随 `LogEntry`/`chatLogAppend`/`liaoTianXiaoXiJi` 落盘可恢复 |
| 真机联调 | Ollama 真实对话+usage；write_file/move_file 真实落盘；MiMo `token-plan-cn` + key 可用（`tp-` 开头，Bearer 直传） |
| 安全 | `verify-security` 28/28；配置已清；无密钥/用户路径入库 |

## 2. 验证结果

- `tsc -b` 四包 = 0；`copy-assets` 已跑。
- **fast 3 遍连续全绿** 183 项次。
- `verify-round20-team --ollama`（带 `MIMO_KEY_FILE`）29/29。
- `verify-round23-live` 22/22。

## 3. 环境

```bash
cd C:\wbuild
node node_modules/typescript/bin/tsc -b packages/providers packages/group-router packages/sync-protocol packages/app-shell
cd packages/app-shell; node scripts/copy-assets.mjs; cd ../..
node run-verify-22.mjs --tier=fast --times=3
$env:MIMO_KEY_FILE="<key文件>"; node verify-round20-team.mjs --ollama
$env:MIMO_KEY_FILE="<key文件>"; node verify-round23-live.mjs
```

## 4. 关键事实

1. 禁止 PowerShell 读写源码（GBK 毁中文）。
2. **MiMo key 形如 `tp-…`，走 `https://token-plan-cn.xiaomimimo.com/v1`**，`Authorization: Bearer <key>`（不要加 `sk-`）。`api.xiaomimimo.com` 会 401。
3. MiMo 模型列表：`mimo-v2.5` / `mimo-v2.5-pro` / `mimo-v2.6-flash` / `mimo-v2.6-pro` / `mimo-v2.5-asr` / `mimo-v2.5-tts`（及 voiceclone/voicedesign）。
4. **安全门禁会扫根目录脚本**：测试脚本里不能出现 `C:\Users\<name>`、`大龙虾互动区` 等；key 用 `MIMO_KEY_FILE` 环境变量。
5. work-tool 成功路径会 `recordFileAccess`（create/edit/delete/move）；`group-store` 的 op 已含 `move`。
6. 对话气泡文字色 = `tiaoZhengInkDuiBi(字体色, 气泡底)`，思考框仍用 `--muted`。

## 5. 第 24 轮优先（遗留）

1. **墙钟 24h 长程**仍未挂机（只做过压缩时间轴）。
2. **UPnP/STUN 跨真 NAT 成功率**：需两台真机器/真路由器。
3. **known-red 8 支**：`verify-e2e` / `verify-history-persist` / `verify-live-ui` / `verify-mobile-ui` / `verify-net-ui` / `verify-qr-scan` / `verify-tool-call-e2e` / `verify-warmy-ipc-probe`。
4. **verify-round16 ①②⑤ / round17 追加A**：本地小模型写不足 5200 字（预存在，别当产品缺陷）。
5. **verify-round17 ⑥ ASR 语言下拉**选项数与断言不一致，待核。
6. **verify-round18*/19** 需云端 key 环境才能跑（本机已可配 token-plan key）。
7. **usage 在 `mergeWithPrev` 续派合并**时如何累计显示，待产品定。
8. **TTS 音色**：MiMo tts 模型的 voice 列表/参数尚未在 UI 联调（标准 speech 端点 404，可能要走 chat 式）。
9. 改动已提交/推送 + 打了 `v0.2.22` 标签；exe 在 `release/`，GitHub Release 需手动挂附件或用带 token 的 `gh`。

## 6. 新窗口开场白

```
读 docs/HANDOFF-NEXT.md（第 23 轮交接）。先看 §5 遗留：
墙钟 24h、跨真 NAT、known-red 8 支、round16/17 长文与 ASR 下拉、TTS 音色联调。
中文、中途不汇报、脚本 .mjs、改 .ts 记 copy-assets、门禁先过。
验证入口：node run-verify-22.mjs --tier=fast --times=3（连续 3 遍全绿才算过）；
MiMo key 走 token-plan-cn + Bearer tp-…（环境变量 MIMO_KEY_FILE）。
⚠️ 千万别用 PowerShell 读写源码。
```
