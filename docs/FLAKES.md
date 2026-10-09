# 门禁抖动台账（FLAKES）

> 只记「跑一次失败、重跑通过」的用例。已知抖动不卡发布，但必须被认领并修掉；
> 重跑仍失败的属于未知失败，不会记到这里 —— 它直接卡发布。

| 时间 | 门禁 | 首次失败摘要 |
| --- | --- | --- |
| 2026-10-09T18:36:52.687Z | packages/app-shell/scripts/verify-container-probe.mjs | **：镜] PASS 17-12 回退点上的环境指纹文案：环境变了要**提前告知**"文件回退了、环境回不去"（中英都有） === 结果 === { "pass": false, "failures": 3, "total": 163 } 结果写入: <user-home>\AppData\Local\Temp\perf\container\container-probe-result.json  |
