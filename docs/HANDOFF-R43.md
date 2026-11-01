# 第 43 轮交接（2026-10-19）

> 顶部指针见 `HANDOFF-NEXT.md`。第 42 轮内容在 `HANDOFF-R42.md`。

## 0. 一句话现状

本轮完成 **2 项**：**T10 nm 文件插件（完整）** 与 **语音输入“识别错误”的真根因修复**。
验收：`npx tsc -b` 0、`check-syntax` OK、`verify-r42.mjs` **连续 3 轮 36 ok / 0 FAIL**。

## 1. T10 nm 文件插件（已完成）

| 能力 | 实现 |
|---|---|
| 独立窗口 | `nm-viewer-win.ts` 窗口池；可移动、可拉伸、多开、**总在最前**开关 |
| 吸附 | 24px 内贴边；**移动联动**（双向 `bing/shu`）；并排时顶部对齐且**高度取两者最大**；关掉吸附即双向解链、且不再参与别人吸附；16ms 节流 |
| 文本类可编辑 | txt/log/md/代码/json/xml/yaml/ini：保存、另存为、后退、前进、自动换行、查找（UTF-16 BOM 兼容、保留 CRLF、>8MB 转只读） |
| 其余只读 | docx/xlsx/pptx/pdf 走 `doc-extract.tiQuWenDang`（pptx 按页、xlsx 按表）→ **文字可被查找**；图片/音频/视频用 `file://`；未知二进制给十六进制预览 |
| 默认启用 + 接管文件链接 | `nm-file` 插件保持 enabled；`data-art-open` 与 `warmy:daKaiLuJing` 在插件启用时改走查看器，目录仍走系统，查看器失败**如实回退** |

**已知限制（不是 bug，是取舍）**：xlsx 以制表符文本呈现，不是表格网格；后退/前进是“本窗口内打开过的文件”历史。

## 2. 语音输入“识别错误、和以前一样” —— 真根因

两处独立缺陷，都在 `electron-main.ts` 的 `warmy:asrZhuanXie`：

1. **拿错了供应商**：不管链里选中的是哪个听话模型，一律用**当前聊天供应商**的 baseURL/key 去调。
   于是本机 whisper 被发给云端、云端 ASR 被发给别家端点 ⇒ 不是 400，就是**聊天模型顺着上下文编一段通顺的话**。
2. **Ollama 兜底字段是拼音占位**：请求体写 `tiShiCi`、响应读 `xiangYingTi` —— 等于什么都没发、也永远读不到结果。

修法：
- 逐个模型用 `jieMoXingGongYingShang(mo)` 解析**它自己的**供应商再调，失败才换下一个；
- **ollama 模型一律不走 chat-completions**（whisper GGUF 不是聊天模型）—— 宁可如实报 `local-asr-not-chat`，也绝不把编出来的字塞进输入框；
- Ollama 请求/响应字段改回 `prompt` / `response`，空结果明确报 `empty-transcript`。

> 为什么以前“看起来修过”：旧代码确实加过“只认 asr 类模型”的过滤，但**供应商**这条腿没跟着模型走，所以症状一模一样。

## 3. 复现命令

```bash
cd packages/app-shell && npx tsc -b && node scripts/check-syntax.mjs && node scripts/copy-assets.mjs
cd ../.. && Copy-Item packages/app-shell/src/preload.cjs packages/app-shell/dist/preload.cjs -Force
node scripts/verify-r42.mjs        # 期望 36 ok / 0 FAIL，连续 3 轮
```

## 4. 待用户确认

- 语音修复**需要真机说话验证**（自动化只能验到“不再拿错供应商、不再编字”）。若仍不对，请提供 `%APPDATA%\@warmy\app-shell\audit\audit.jsonl` 里 `asr.request` / `asr.result` 那两行 —— 里面有模型、供应商、字节数、耗时、错误首行。
- T10 未做“在运行中的应用里点文件链接”的真人点验（子代理只做了静态路径审查 + 真 Electron 窗口测试）。请点一次项目内文件确认。
- 程序当前状态：沿用上一轮（未重置首启）。
