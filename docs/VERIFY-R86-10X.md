# 0.2.28 连续 10 轮全功能验收

开始：2026-10-25T15:15:31.612Z

规则：5 种内容 × 各 2 轮；每轮先跑 32 门禁 fast 套件，再跑该内容的额外实测；任一轮失败停止，修复后从第 1 轮重跑。

| 轮 | 标签 | 结果 | 末行 | 秒 |
|---|---|---|---|---|
| 1 | fast 32 门禁（第 1 轮） | PASS | R78 3x PASSED | 148 |
| 1 | UI/IPC 接线 r82-r103（第 1 轮） | PASS | verify-r82-r103: 18 ok / 0 FAIL | 5 |
| 2 | fast 32 门禁（第 2 轮） | PASS | R78 3x PASSED | 169 |
| 2 | UI/IPC 接线 r82-r103（第 2 轮） | PASS | verify-r82-r103: 18 ok / 0 FAIL | 5 |
| 3 | fast 32 门禁（第 3 轮） | PASS | R78 3x PASSED | 162 |
| 3 | 长会话记忆 round39-longchat（第 3 轮） | PASS | 第 39 轮超长会话门禁：15 通过 / 0 失败 | 19 |
| 3 | ASR 路由 round38-asr（第 3 轮） | PASS | ==== verify-round38-asr：12 ok / 0 FAIL ==== | 30 |
| 4 | fast 32 门禁（第 4 轮） | PASS | R78 3x PASSED | 157 |
| 4 | 长会话记忆 round39-longchat（第 4 轮） | PASS | 第 39 轮超长会话门禁：15 通过 / 0 失败 | 14 |
| 4 | ASR 路由 round38-asr（第 4 轮） | PASS | ==== verify-round38-asr：12 ok / 0 FAIL ==== | 29 |
| 5 | fast 32 门禁（第 5 轮） | PASS | R78 3x PASSED | 149 |
| 5 | 微信凭据/队列 r44（第 5 轮） | PASS | verify-r44-shejiao: 27 PASS / 0 FAIL (source + loopback HTTP; no Electron/live WeChat) | 4 |
| 5 | 微信协议 r65（第 5 轮） | PASS | ==== verify-r65-shejiao: 15 PASS / 0 FAIL ==== | 0 |
| 6 | fast 32 门禁（第 6 轮） | PASS | R78 3x PASSED | 156 |
| 6 | 微信凭据/队列 r44（第 6 轮） | PASS | verify-r44-shejiao: 27 PASS / 0 FAIL (source + loopback HTTP; no Electron/live WeChat) | 4 |
| 6 | 微信协议 r65（第 6 轮） | PASS | ==== verify-r65-shejiao: 15 PASS / 0 FAIL ==== | 0 |
| 7 | fast 32 门禁（第 7 轮） | PASS | R78 3x PASSED | 149 |
| 7 | FWArmy 扩网（第 7 轮） | PASS | ==== FWArmy 扩网/安全门禁：41 ok / 0 FAIL ==== | 9 |
| 8 | fast 32 门禁（第 8 轮） | PASS | R78 3x PASSED | 154 |
| 8 | FWArmy 扩网（第 8 轮） | PASS | ==== FWArmy 扩网/安全门禁：41 ok / 0 FAIL ==== | 9 |
| 9 | fast 32 门禁（第 9 轮） | PASS | R78 3x PASSED | 149 |
| 9 | 预算/额度 round39-budget（第 9 轮） | PASS | 第 39 轮额度行为门禁：76 通过 / 0 失败 | 0 |
| 9 | 独立会话窗 r82-chatwin（第 9 轮） | PASS | verify-r82-chatwin: 12 ok / 0 FAIL | 7 |
| 10 | fast 32 门禁（第 10 轮） | PASS | R78 3x PASSED | 148 |
| 10 | 预算/额度 round39-budget（第 10 轮） | PASS | 第 39 轮额度行为门禁：76 通过 / 0 失败 | 0 |
| 10 | 独立会话窗 r82-chatwin（第 10 轮） | PASS | verify-r82-chatwin: 12 ok / 0 FAIL | 7 |

## 结论

10 轮全部 PASSED（5 种内容各连续 2 轮）。结束：2026-10-25T15:43:36.479Z
