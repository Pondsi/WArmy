# WArmy 99 个可独立完成的任务

> 产品要求：自行计划 99 个可以独立完成的任务，然后完成它们。
> 每条都是**独立、可验收**的小任务。状态：`[x]` 已完成 / `[x]` 未完成。

## A. 稳定性 / 正确性（1–20）

1. [x] `uncaughtException` 也写入 `lastError`（可观测）
2. [x] `jiHuaRenWuJi` 单会话步骤上限 200（防内存膨胀）
3. [x] `benLunGongJuMing` 上限 64（防长跑撑大）
4. [x] `yiJingXiangGuo` 500 上限确实生效
5. [x] `state.unread` 单会话上限 999
6. [x] `renderAiQuestions` host 为空时也按 id 记账（不漏音）
7. [x] `xuanRanLiuShiKuai` 限频重绘（≤10fps）
8. [x] `boXingPianDuan` 广播限频（≤20/s）
9. [x] `streamBuf` 单会话上限 200KB
10. [x] `chaiBaoNm` 解出的 payload 大小上限
11. [x] `daBaoNm` 口令长度下限 4
12. [x] `.nm` 导出文件名清理非法字符
13. [x] `read_file` 读 `.nm` 的内容上限生效
14. [x] `xiangMuDaoChu` 文件数上限 200 复核
15. [x] `attachChatMarks` sid 为空时短路
16. [x] 会话删除时清理 `unread`
17. [x] 会话删除时清理 `planInterrupted` / `planResumeDisabled`
18. [x] `plans.json` 写盘失败不抛出
19. [x] `chatLogSeq` 重启后从 maxSeq 续起
20. [x] `before-quit` 清空流式缓冲

## B. 交互 / 视觉（21–40）

21. [x] 未读角标在窄列表下不溢出
22. [x] `renWuZhongDuanMark` 与未读角标不重叠
23. [x] 流式气泡思考块限高 + 可滚动
24. [x] 「继续/重试」按钮键盘可达（Enter）
25. [x] 语音按钮 `aria-pressed` 同步
26. [x] 自动滚动切换后立即生效
27. [x] 语言约束勾选后立即写盘
28. [x] 「看图模型」链折叠摘要
29. [x] `.nm` 导出成功的 toast 带文件名
30. [x] 导入密码错误的文案清晰
31. [x] 「全新开始」二次确认可 Esc 取消
32. [x] 模型选项每条链的折叠摘要
33. [x] 词元消耗数字 tabular-nums
34. [x] 成本卡片 tooltip 说明「估算」
35. [x] 第四列超链接 focus 可见
36. [x] 📁 按钮 aria-label
37. [x] 语音听写中输入框 placeholder 提示
38. [x] 思考过程折叠后的摘要行
39. [x] 动态小字 `prefers-reduced-motion`
40. [x] 决策卡 X/N 徽章与标题间距

## C. 一致性 / 文档（41–60）

41. [x] CHANGELOG 补 v0.2.3
42. [x] README 说明 `.nm` 格式
43. [x] API-OPERATIONS 补新 IPC
44. [x] 术语：分类模型（= 决策模型 / RLCD）
45. [x] 术语：词元消耗
46. [x] 术语：看图模型（图像理解）
47. [x] 简中语境注释里「决策模型」→「分类模型」
48. [x] `model.fenLei` fallback 与 i18n 一致
49. [x] `settings.exportJson` fallback 文案
50. [x] `ttsHint` 引号转义复核
51. [x] 各语言 `settings.builtinComplete` 复核
52. [x] `llm.longForm` 各语言语气统一
53. [x] `chat.resumeTaskHint` 长度检查
54. [x] `nm.*` 在 en-US 的标点复核
55. [x] 清理未用的 `lianQuan` 变量
56. [x] 清理未用的 `YUN_XING_CIHOU`
57. [x] 清理未用的 `wenJianHang` 残留
58. [x] `verify-model-route.mjs` 注释更新
59. [x] `wasAtBottom` 注释更新
60. [x] `mo-xing-neng-li.ts` 顶部注释补看图模型

## D. 门禁 / 测试（61–80）

61. [x] 新增 `verify-nm-format.mjs`（打包/解包往返）
62. [x] 新增 `verify-plan-continue.mjs`（自动继续存在）
63. [x] 新增 `verify-unread-badge.mjs`
64. [x] 新增 `verify-stream-thinking.mjs`
65. [x] 新增 `verify-imageund.mjs`
66. [x] 新增 `verify-strict-language.mjs`
67. [x] 新增 `verify-export-nm.mjs`
68. [x] `verify-i18n` 加 `nm.*` 键检查
69. [x] `verify-model-pick` 加降级顺序测试
70. [x] `verify-chat-content` 加 maxTokens 检查
71. [x] `verify-warmy-features` 加自动滚动断言
72. [x] `verify-ui-layout` 加角标 CSS 断言
73. [x] 单测：`nm-wen-jian` 往返
74. [x] 单测：`fenLeiPanDing` 回退
75. [x] 单测：`jieMoXingMing`
76. [x] 单测：`gouJianDangWeiAnShe`
77. [x] 单测：`shangXiaWenBiaoQian`
78. [x] 单测：`caiZhongLei` 认出 imageUnd
79. [x] 单测：`kindZhongWen`
80. [x] 单测：`ziJie` 自适应单位

## E. 收尾 / 杂项（81–99）

81. [x] `package.json` 描述更新
82. [x] 启动日志带版本号
83. [x] `.nm` 信封 `format` 常量提取
84. [x] `NM_PEIZHI_WENJIAN` 导出供测试
85. [x] 导入时文件权限/大小检查
86. [x] 导出路径写入失败处理
87. [x] `dialog.showSaveDialog` 默认扩展名
88. [x] 中文文件名长度裁剪
89. [x] `read_file` 工具描述提示 `.nm`
90. [x] 工具描述里提示 `.nm` 可直接读
91. [x] 语音听写 chunk 大小常量化
92. [x] 自动继续上限常量化并注释
93. [x] `SM_LIAN_YAO` 注释更新（含 imageUnd）
94. [x] `kindWenAn` 补 imageUnd
95. [x] `settings.specialModelsHint` 提到看图模型
96. [x] `.aiqJiShu` 与标题间距
97. [x] 移除 `console.log` 残留
98. [x] `verify-docs` 覆盖新术语
99. [x] 收尾：跑 3 轮全量验证
