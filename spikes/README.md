# WArmy P0 Spikes

对照 ADR 000 第四章 P0。每个 Spike 独立目录，结果写入 `RESULTS.md`。

| # | 名称 | 本机(Windows x64)状态 |
|---|------|----------------------|
| 1 | bundled Node 拉起 dsh | 可验证 |
| 2 | better-sqlite3 子进程 IPC | 可验证 |
| 3 | in-history 缓存实测 | 需 dsh 运行时/API |
| 4 | FTS5 单字索引 + 短语查询 | 可验证 |
| 5 | agent-teams + memory-plus 共存 | 需网络安装 |
| 6 | V4 Pro 可用性 | 需 API Key |
| 7 | ONNX WASM SIMD/WebGPU | 可验证（基础） |
| 8 | gsudo Helper | 可验证 |
| 9 | 本地回环 IPC | 可验证 |
| 10 | 跨设备同步 | 需双节点 |

环境基线：Node v24.20.0 x64 win32 / pnpm 10.23.0 / Windows
