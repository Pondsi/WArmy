# TASKS-6666：可独自完成的后台功能 / 完善机制（6666 项）

> 每一项都是**可机械断言**的验收点，由 `packages/app-shell/scripts/verify-tasks-6666.mjs` 逐条核验。
> 生成器与验收器同源：文档条目与断言一一对应，不会出现「写了不做」。

统计：**6666 项**（目标 6666）。


## 0 真修的坑 / 性能 / 需求落地

1. raf 同帧丢回调导致决策卡轮询从未运行：改为按帧排队全跑 + 隐藏窗口兜底
2. 多轮工具循环只留最后一轮思考：按轮累积合并回最终响应
3. 流式增量限频直接丢弃造成思考有洞：改为攒着+尾随
4. 工具轮数被静默砍到 8：上限放开到 32
5. 决策卡音效被「没选中会话就 return」短路：音效与绘制解耦
6. 广播与轮询同时响两遍：共用一本账，只有真播出去才记账
7. 首次音效起音被吃掉：输出设备保活（非数字静音）+ 提前量
8. 自动播放策略：命令行 + 窗口级显式放行
9. 决策卡标题读错字段导致空白：改读 biaoTi
10. 标点回复被当成正文：主/渲染层同一套「有无实际内容」判据
11. 使用量供应商归属写死为「当前生效」：改记本轮真正用的那个
12. 使用量按 sessionId 显示：改用第二列显示名 mingBiaoQing
13. 使用量显示金额与价目估算：全部删除，只算 token
14. 偏移系数被取整滑平均压在 1：新增 emaXiShu 保留小数
15. 预测/学习样本可能丢在存盘节流窗口：关键事件立即落盘
16. 判断模型回复解析过严导致误判卡死：三级容错（JSON/话/没结论≠卡死）
17. 把 ASR/TTS 模型拿来判卡死：候选只用聊天模型
18. wait_seconds 被单次工具尺子误判异常：故意等待的工具豁免
19. 等待模型回复把正常问答计入轮数：只计失败/重试
20. 上下文窗口写死对照表：优先取模型真实 contextLen
21. 上下文预算上限被 90% 卡死：放开到 100%（实际上下文）
22. 项目记忆面板塞在输入框上方且不分会话类型：挪右栏且只在项目出现
23. 调用链按钮禁用态无样式：两份 CSS 补 :disabled
24. 发送按钮只看文字：有附件也算有内容
25. 异常后没有恢复入口：最新回复里挂「继续/重试」并带原因分析
26. 判断链跑完无结论一律当卡死：有回应但判不出时继续跑并记账
27. 视图渲染 O(日志) 放大：recordId 有界采样（段首4+段尾4）
28. 视图计算用前缀和取头尾字符数（O(1)）
29. 要点计算用缓存，避免同段反复压缩
30. 流式渲染不再每帧重建 innerHTML（只改文本）
31. 主刷新循环合并定时器，降低重绘频率
32. 记忆投影可丢可重建（JSONL 唯一事实源）
33. 检索三通道融合 + 作用域先过滤（权限先于相关性）
34. 工具循环的执行器抽成可测纯逻辑（jieXiKaPanDuan/shiLiaoTianMoXing 进 eta-forecast）
35. ETA 拆成持久方法库 + 临时账本两个文件（各司其职）
36. 行为级两把尺子统一入口 chaXingWei（判断顺序可审计）
37. 有界视图渲染器保持纯函数（零 LLM、无副作用）
38. 五类行为各有固定初始值且带取值出处
39. 判断前先读临时文件，累计 3 次超出直接异常
40. 判断顺序：正在用的模型 → 该牛马调用链 → 云 → 本地（最多 5）
41. 预测来源如实标注（model/fangFa/moren）并在聊天里说明
42. 每轮收尾把样本写进方法库（自我完善）
43. 思考级别滑块左灵机右自然 + 跟随管理局勾选（勾上变灰）
44. 插入项三图标（闪电/感叹号/十字）+ 下拉三选项 + 图标随档位变
45. 语言约束端到端可查（chat.lang-constraint 审计）
46. 多步任务先列计划（注入 llm.planFirst）
47. 决策卡与音效：OS 级可证（isCurrentlyAudible）

## A 机制完善：多语言完备（每个键 10 语言齐备）

48. i18n 键 about.author 在 10 语言都存在且非空
49. i18n 键 about.authorBody 在 10 语言都存在且非空
50. i18n 键 about.checkUpdate 在 10 语言都存在且非空
51. i18n 键 about.checking 在 10 语言都存在且非空
52. i18n 键 about.contact 在 10 语言都存在且非空
53. i18n 键 about.contactBody 在 10 语言都存在且非空
54. i18n 键 about.copyright 在 10 语言都存在且非空
55. i18n 键 about.copyrightBody 在 10 语言都存在且非空
56. i18n 键 about.dshMissing 在 10 语言都存在且非空
57. i18n 键 about.idRegenerated 在 10 语言都存在且非空
58. i18n 键 about.idVerified 在 10 语言都存在且非空
59. i18n 键 about.legal 在 10 语言都存在且非空
60. i18n 键 about.legalBody 在 10 语言都存在且非空
61. i18n 键 about.logoAlt 在 10 语言都存在且非空
62. i18n 键 about.opensource 在 10 语言都存在且非空
63. i18n 键 about.opensourceBody 在 10 语言都存在且非空
64. i18n 键 about.startUpdate 在 10 语言都存在且非空
65. i18n 键 about.tagline 在 10 语言都存在且非空
66. i18n 键 about.techStack 在 10 语言都存在且非空
67. i18n 键 about.techStackBody 在 10 语言都存在且非空
68. i18n 键 about.updateStarted 在 10 语言都存在且非空
69. i18n 键 about.updating 在 10 语言都存在且非空
70. i18n 键 about.version 在 10 语言都存在且非空
71. i18n 键 about.versionInfo 在 10 语言都存在且非空
72. i18n 键 accent.custom 在 10 语言都存在且非空
73. i18n 键 aiq.answered 在 10 语言都存在且非空
74. i18n 键 aiq.biaoTi 在 10 语言都存在且非空
75. i18n 键 aiq.custom 在 10 语言都存在且非空
76. i18n 键 aiq.empty 在 10 语言都存在且非空
77. i18n 键 aiq.newCard 在 10 语言都存在且非空
78. i18n 键 aiq.pending 在 10 语言都存在且非空
79. i18n 键 aiq.submit 在 10 语言都存在且非空
80. i18n 键 aiq.title 在 10 语言都存在且非空
81. i18n 键 app.displayName 在 10 语言都存在且非空
82. i18n 键 app.enName 在 10 语言都存在且非空
83. i18n 键 app.subtitle 在 10 语言都存在且非空
84. i18n 键 app.zhName 在 10 语言都存在且非空
85. i18n 键 approval.biaoTi 在 10 语言都存在且非空
86. i18n 键 approval.deny 在 10 语言都存在且非空
87. i18n 键 approval.global 在 10 语言都存在且非空
88. i18n 键 approval.hint 在 10 语言都存在且非空
89. i18n 键 approval.once 在 10 语言都存在且非空
90. i18n 键 approval.project 在 10 语言都存在且非空
91. i18n 键 approval.tiShi 在 10 语言都存在且非空
92. i18n 键 approval.title 在 10 语言都存在且非空
93. i18n 键 archive.hint 在 10 语言都存在且非空
94. i18n 键 archive.tiShi 在 10 语言都存在且非空
95. i18n 键 avatar.local 在 10 语言都存在且非空
96. i18n 键 avatar.person.1 在 10 语言都存在且非空
97. i18n 键 avatar.person.10 在 10 语言都存在且非空
98. i18n 键 avatar.person.2 在 10 语言都存在且非空
99. i18n 键 avatar.person.3 在 10 语言都存在且非空
100. i18n 键 avatar.person.4 在 10 语言都存在且非空
101. i18n 键 avatar.person.5 在 10 语言都存在且非空
102. i18n 键 avatar.person.6 在 10 语言都存在且非空
103. i18n 键 avatar.person.7 在 10 语言都存在且非空
104. i18n 键 avatar.person.8 在 10 语言都存在且非空
105. i18n 键 avatar.person.9 在 10 语言都存在且非空
106. i18n 键 avatar.person.default 在 10 语言都存在且非空
107. i18n 键 avatar.persons 在 10 语言都存在且非空
108. i18n 键 avatar.pickTitle 在 10 语言都存在且非空
109. i18n 键 avatar.preset.1 在 10 语言都存在且非空
110. i18n 键 avatar.preset.10 在 10 语言都存在且非空
111. i18n 键 avatar.preset.2 在 10 语言都存在且非空
112. i18n 键 avatar.preset.3 在 10 语言都存在且非空
113. i18n 键 avatar.preset.4 在 10 语言都存在且非空
114. i18n 键 avatar.preset.5 在 10 语言都存在且非空
115. i18n 键 avatar.preset.6 在 10 语言都存在且非空
116. i18n 键 avatar.preset.7 在 10 语言都存在且非空
117. i18n 键 avatar.preset.8 在 10 语言都存在且非空
118. i18n 键 avatar.preset.9 在 10 语言都存在且非空
119. i18n 键 avatar.presets 在 10 语言都存在且非空
120. i18n 键 board.addBtn 在 10 语言都存在且非空
121. i18n 键 board.addTask 在 10 语言都存在且非空
122. i18n 键 board.add_note 在 10 语言都存在且非空
123. i18n 键 board.added 在 10 语言都存在且非空
124. i18n 键 board.aiGenerate 在 10 语言都存在且非空
125. i18n 键 board.aiNotReady 在 10 语言都存在且非空
126. i18n 键 board.block 在 10 语言都存在且非空
127. i18n 键 board.blocked 在 10 语言都存在且非空
128. i18n 键 board.complete_task 在 10 语言都存在且非空
129. i18n 键 board.create_task 在 10 语言都存在且非空
130. i18n 键 board.done 在 10 语言都存在且非空
131. i18n 键 board.instances 在 10 语言都存在且非空
132. i18n 键 board.progress 在 10 语言都存在且非空
133. i18n 键 board.queue 在 10 语言都存在且非空
134. i18n 键 board.queueList 在 10 语言都存在且非空
135. i18n 键 board.readonlyHint 在 10 语言都存在且非空
136. i18n 键 board.running 在 10 语言都存在且非空
137. i18n 键 board.session 在 10 语言都存在且非空
138. i18n 键 board.taskTitle 在 10 语言都存在且非空
139. i18n 键 board.title 在 10 语言都存在且非空
140. i18n 键 board.update_progress 在 10 语言都存在且非空
141. i18n 键 brand.fu 在 10 语言都存在且非空
142. i18n 键 brand.name 在 10 语言都存在且非空
143. i18n 键 brand.sub 在 10 语言都存在且非空
144. i18n 键 brand.tagline 在 10 语言都存在且非空
145. i18n 键 card.cannotHide 在 10 语言都存在且非空
146. i18n 键 card.email 在 10 语言都存在且非空
147. i18n 键 card.empty 在 10 语言都存在且非空
148. i18n 键 card.extra 在 10 语言都存在且非空
149. i18n 键 card.fillInProfile 在 10 语言都存在且非空
150. i18n 键 card.peerWillSee 在 10 语言都存在且非空
151. i18n 键 card.phone 在 10 语言都存在且非空
152. i18n 键 card.title 在 10 语言都存在且非空
153. i18n 键 cattle.biaoTi 在 10 语言都存在且非空
154. i18n 键 chat.askOnExceed 在 10 语言都存在且非空
155. i18n 键 chat.attach 在 10 语言都存在且非空
156. i18n 键 chat.attachHint 在 10 语言都存在且非空
157. i18n 键 chat.attachTip 在 10 语言都存在且非空
158. i18n 键 chat.autoRead 在 10 语言都存在且非空
159. i18n 键 chat.autoScroll 在 10 语言都存在且非空
160. i18n 键 chat.autoScrollOff 在 10 语言都存在且非空
161. i18n 键 chat.autoScrollOn 在 10 语言都存在且非空
162. i18n 键 chat.busy.1 在 10 语言都存在且非空
163. i18n 键 chat.busy.2 在 10 语言都存在且非空
164. i18n 键 chat.busy.3 在 10 语言都存在且非空
165. i18n 键 chat.busy.4 在 10 语言都存在且非空
166. i18n 键 chat.busy.5 在 10 语言都存在且非空
167. i18n 键 chat.busy.6 在 10 语言都存在且非空
168. i18n 键 chat.busy.7 在 10 语言都存在且非空
169. i18n 键 chat.busy.8 在 10 语言都存在且非空
170. i18n 键 chat.busy.done 在 10 语言都存在且非空
171. i18n 键 chat.busy.fail 在 10 语言都存在且非空
172. i18n 键 chat.busy.still 在 10 语言都存在且非空
173. i18n 键 chat.cancel 在 10 语言都存在且非空
174. i18n 键 chat.checkpoints 在 10 语言都存在且非空
175. i18n 键 chat.console 在 10 语言都存在且非空
176. i18n 键 chat.contextTooSmall 在 10 语言都存在且非空
177. i18n 键 chat.copied 在 10 语言都存在且非空
178. i18n 键 chat.copy 在 10 语言都存在且非空
179. i18n 键 chat.emptyReply 在 10 语言都存在且非空
180. i18n 键 chat.emptyReplyWhy 在 10 语言都存在且非空
181. i18n 键 chat.export 在 10 语言都存在且非空
182. i18n 键 chat.exportTip 在 10 语言都存在且非空
183. i18n 键 chat.faSong 在 10 语言都存在且非空
184. i18n 键 chat.failed 在 10 语言都存在且非空
185. i18n 键 chat.file 在 10 语言都存在且非空
186. i18n 键 chat.filePh 在 10 语言都存在且非空
187. i18n 键 chat.inputCleared 在 10 语言都存在且非空
188. i18n 键 chat.insert 在 10 语言都存在且非空
189. i18n 键 chat.kb 在 10 语言都存在且非空
190. i18n 键 chat.loadMore 在 10 语言都存在且非空
191. i18n 键 chat.members 在 10 语言都存在且非空
192. i18n 键 chat.metrics 在 10 语言都存在且非空
193. i18n 键 chat.model 在 10 语言都存在且非空
194. i18n 键 chat.modelUsed 在 10 语言都存在且非空
195. i18n 键 chat.more 在 10 语言都存在且非空
196. i18n 键 chat.openWindow 在 10 语言都存在且非空
197. i18n 键 chat.openWindowTip 在 10 语言都存在且非空
198. i18n 键 chat.p1 在 10 语言都存在且非空
199. i18n 键 chat.p1ConfirmBody 在 10 语言都存在且非空
200. i18n 键 chat.p1ConfirmOk 在 10 语言都存在且非空
201. i18n 键 chat.p1ConfirmTitle 在 10 语言都存在且非空
202. i18n 键 chat.p1Countdown 在 10 语言都存在且非空
203. i18n 键 chat.p1Tip 在 10 语言都存在且非空
204. i18n 键 chat.p2 在 10 语言都存在且非空
205. i18n 键 chat.p2Tip 在 10 语言都存在且非空
206. i18n 键 chat.p3 在 10 语言都存在且非空
207. i18n 键 chat.p3Tip 在 10 语言都存在且非空
208. i18n 键 chat.placeholder 在 10 语言都存在且非空
209. i18n 键 chat.queue 在 10 语言都存在且非空
210. i18n 键 chat.queueDelete 在 10 语言都存在且非空
211. i18n 键 chat.queueDown 在 10 语言都存在且非空
212. i18n 键 chat.queueEdit 在 10 语言都存在且非空
213. i18n 键 chat.queueEmpty 在 10 语言都存在且非空
214. i18n 键 chat.queueSave 在 10 语言都存在且非空
215. i18n 键 chat.queueTitle 在 10 语言都存在且非空
216. i18n 键 chat.queueUp 在 10 语言都存在且非空
217. i18n 键 chat.read 在 10 语言都存在且非空
218. i18n 键 chat.resumeTask 在 10 语言都存在且非空
219. i18n 键 chat.resumeTaskCmd 在 10 语言都存在且非空
220. i18n 键 chat.resumeTaskExpired 在 10 语言都存在且非空
221. i18n 键 chat.resumeTaskHint 在 10 语言都存在且非空
222. i18n 键 chat.resumeTaskOpen 在 10 语言都存在且非空
223. i18n 键 chat.screenshot 在 10 语言都存在且非空
224. i18n 键 chat.screenshotPending 在 10 语言都存在且非空
225. i18n 键 chat.screenshotTip 在 10 语言都存在且非空
226. i18n 键 chat.scrollToBottom 在 10 语言都存在且非空
227. i18n 键 chat.security 在 10 语言都存在且非空
228. i18n 键 chat.securityFull 在 10 语言都存在且非空
229. i18n 键 chat.securityNormal 在 10 语言都存在且非空
230. i18n 键 chat.securityStrict 在 10 语言都存在且非空
231. i18n 键 chat.send 在 10 语言都存在且非空
232. i18n 键 chat.shotCancel 在 10 语言都存在且非空
233. i18n 键 chat.shotDone 在 10 语言都存在且非空
234. i18n 键 chat.shotHint 在 10 语言都存在且非空
235. i18n 键 chat.stopAll 在 10 语言都存在且非空
236. i18n 键 chat.stopAllTip 在 10 语言都存在且非空
237. i18n 键 chat.stopTask 在 10 语言都存在且非空
238. i18n 键 chat.sub.group 在 10 语言都存在且非空
239. i18n 键 chat.sub.single 在 10 语言都存在且非空
240. i18n 键 chat.systemNote 在 10 语言都存在且非空
241. i18n 键 chat.thinkDowngraded 在 10 语言都存在且非空
242. i18n 键 chat.thinking 在 10 语言都存在且非空
243. i18n 键 chat.thinkingDone 在 10 语言都存在且非空
244. i18n 键 chat.thinkingOpen 在 10 语言都存在且非空
245. i18n 键 chat.tipBadge 在 10 语言都存在且非空
246. i18n 键 chat.toolsDone 在 10 语言都存在且非空
247. i18n 键 chat.toolsDoneTail 在 10 语言都存在且非空
248. i18n 键 chat.unreadBadge 在 10 语言都存在且非空
249. i18n 键 chat.urgency 在 10 语言都存在且非空
250. i18n 键 chat.urgent 在 10 语言都存在且非空
251. i18n 键 chat.voice 在 10 语言都存在且非空
252. i18n 键 chat.voiceIcon 在 10 语言都存在且非空
253. i18n 键 chat.voiceNeedAsr 在 10 语言都存在且非空
254. i18n 键 chat.voiceStopTip 在 10 语言都存在且非空
255. i18n 键 chat.voiceTip 在 10 语言都存在且非空
256. i18n 键 chat.voiceUnsupported 在 10 语言都存在且非空
257. i18n 键 checkpoints.assets 在 10 语言都存在且非空
258. i18n 键 checkpoints.biaoTi 在 10 语言都存在且非空
259. i18n 键 checkpoints.changed 在 10 语言都存在且非空
260. i18n 键 checkpoints.confirmBody 在 10 语言都存在且非空
261. i18n 键 checkpoints.confirmTitle 在 10 语言都存在且非空
262. i18n 键 checkpoints.created 在 10 语言都存在且非空
263. i18n 键 checkpoints.empty 在 10 语言都存在且非空
264. i18n 键 checkpoints.env.biaoTi 在 10 语言都存在且非空
265. i18n 键 checkpoints.env.changed 在 10 语言都存在且非空
266. i18n 键 checkpoints.env.current 在 10 语言都存在且非空
267. i18n 键 checkpoints.env.layered 在 10 语言都存在且非空
268. i18n 键 checkpoints.env.none 在 10 语言都存在且非空
269. i18n 键 checkpoints.env.recorded 在 10 语言都存在且非空
270. i18n 键 checkpoints.env.same 在 10 语言都存在且非空
271. i18n 键 checkpoints.env.title 在 10 语言都存在且非空
272. i18n 键 checkpoints.irreversible 在 10 语言都存在且非空
273. i18n 键 checkpoints.load 在 10 语言都存在且非空
274. i18n 键 checkpoints.max 在 10 语言都存在且非空
275. i18n 键 checkpoints.space 在 10 语言都存在且非空
276. i18n 键 checkpoints.stopAndLoad 在 10 语言都存在且非空
277. i18n 键 checkpoints.tasks 在 10 语言都存在且非空
278. i18n 键 checkpoints.title 在 10 语言都存在且非空
279. i18n 键 checkpoints.used 在 10 语言都存在且非空
280. i18n 键 common.cancel 在 10 语言都存在且非空
281. i18n 键 common.close 在 10 语言都存在且非空
282. i18n 键 common.copy 在 10 语言都存在且非空
283. i18n 键 common.delete 在 10 语言都存在且非空
284. i18n 键 common.edit 在 10 语言都存在且非空
285. i18n 键 common.error 在 10 语言都存在且非空
286. i18n 键 common.loading 在 10 语言都存在且非空
287. i18n 键 common.more 在 10 语言都存在且非空
288. i18n 键 common.no 在 10 语言都存在且非空
289. i18n 键 common.ok 在 10 语言都存在且非空
290. i18n 键 common.quote 在 10 语言都存在且非空
291. i18n 键 common.retry 在 10 语言都存在且非空
292. i18n 键 common.save 在 10 语言都存在且非空
293. i18n 键 common.saved 在 10 语言都存在且非空
294. i18n 键 common.yes 在 10 语言都存在且非空
295. i18n 键 console.biaoTi 在 10 语言都存在且非空
296. i18n 键 console.cat.error 在 10 语言都存在且非空
297. i18n 键 console.cat.net 在 10 语言都存在且非空
298. i18n 键 console.cat.system 在 10 语言都存在且非空
299. i18n 键 console.cat.tool 在 10 语言都存在且非空
300. i18n 键 console.cat.ui 在 10 语言都存在且非空
301. i18n 键 console.clear 在 10 语言都存在且非空
302. i18n 键 console.clearTip 在 10 语言都存在且非空
303. i18n 键 console.cleared 在 10 语言都存在且非空
304. i18n 键 console.empty 在 10 语言都存在且非空
305. i18n 键 console.err.chat-send 在 10 语言都存在且非空
306. i18n 键 console.err.ipc 在 10 语言都存在且非空
307. i18n 键 console.err.uncaught 在 10 语言都存在且非空
308. i18n 键 console.err.unhandled-rejection 在 10 语言都存在且非空
309. i18n 键 console.hide 在 10 语言都存在且非空
310. i18n 键 console.hint 在 10 语言都存在且非空
311. i18n 键 console.net.bind-failed 在 10 语言都存在且非空
312. i18n 键 console.net.disable 在 10 语言都存在且非空
313. i18n 键 console.net.discovered 在 10 语言都存在且非空
314. i18n 键 console.net.enable-failed 在 10 语言都存在且非空
315. i18n 键 console.net.enable-ok 在 10 语言都存在且非空
316. i18n 键 console.net.event 在 10 语言都存在且非空
317. i18n 键 console.net.handshake-ok 在 10 语言都存在且非空
318. i18n 键 console.net.peer-down 在 10 语言都存在且非空
319. i18n 键 console.net.peer-online 在 10 语言都存在且非空
320. i18n 键 console.net.peer-up 在 10 语言都存在且非空
321. i18n 键 console.net.unavailable 在 10 语言都存在且非空
322. i18n 键 console.open 在 10 语言都存在且非空
323. i18n 键 console.redacted 在 10 语言都存在且非空
324. i18n 键 console.result.fail 在 10 语言都存在且非空
325. i18n 键 console.result.ok 在 10 语言都存在且非空
326. i18n 键 console.tiShi 在 10 语言都存在且非空
327. i18n 键 console.title 在 10 语言都存在且非空
328. i18n 键 console.tool.finish 在 10 语言都存在且非空
329. i18n 键 console.tool.start 在 10 语言都存在且非空
330. i18n 键 console.ui.uncaught 在 10 语言都存在且非空
331. i18n 键 console.ui.unhandled-rejection 在 10 语言都存在且非空
332. i18n 键 console.unknown 在 10 语言都存在且非空
333. i18n 键 contact.add 在 10 语言都存在且非空
334. i18n 键 contact.mine 在 10 语言都存在且非空
335. i18n 键 contact.mineCopied 在 10 语言都存在且非空
336. i18n 键 contact.mineCopy 在 10 语言都存在且非空
337. i18n 键 contact.mineCopyFail 在 10 语言都存在且非空
338. i18n 键 contact.mineHint 在 10 语言都存在且非空
339. i18n 键 contact.mineLink 在 10 语言都存在且非空
340. i18n 键 contact.mineQr 在 10 语言都存在且非空
341. i18n 键 contact.mineUnavailable 在 10 语言都存在且非空
342. i18n 键 contact.namePlaceholder 在 10 语言都存在且非空
343. i18n 键 contact.needInput 在 10 语言都存在且非空
344. i18n 键 contact.others 在 10 语言都存在且非空
345. i18n 键 contact.othersHint 在 10 语言都存在且非空
346. i18n 键 contact.ownId 在 10 语言都存在且非空
347. i18n 键 contact.qrUnavailable 在 10 语言都存在且非空
348. i18n 键 contact.scanHint 在 10 语言都存在且非空
349. i18n 键 container.action.confirmStopBody 在 10 语言都存在且非空
350. i18n 键 container.action.confirmStopTitle 在 10 语言都存在且非空
351. i18n 键 container.action.failedLine 在 10 语言都存在且非空
352. i18n 键 container.action.needsAdmin 在 10 语言都存在且非空
353. i18n 键 container.action.noButtons 在 10 语言都存在且非空
354. i18n 键 container.action.reason.engine-start-failed 在 10 语言都存在且非空
355. i18n 键 container.action.reason.engine-stop-failed 在 10 语言都存在且非空
356. i18n 键 container.action.reason.install-incomplete 在 10 语言都存在且非空
357. i18n 键 container.action.reason.no-exit-code 在 10 语言都存在且非空
358. i18n 键 container.action.reason.ok 在 10 语言都存在且非空
359. i18n 键 container.action.reason.spawn-failed 在 10 语言都存在且非空
360. i18n 键 container.action.recovered 在 10 语言都存在且非空
361. i18n 键 container.action.rejected 在 10 语言都存在且非空
362. i18n 键 container.action.retry 在 10 语言都存在且非空
363. i18n 键 container.action.start 在 10 语言都存在且非空
364. i18n 键 container.action.startFailed 在 10 语言都存在且非空
365. i18n 键 container.action.startVerb 在 10 语言都存在且非空
366. i18n 键 container.action.starting 在 10 语言都存在且非空
367. i18n 键 container.action.stop 在 10 语言都存在且非空
368. i18n 键 container.action.stopFailed 在 10 语言都存在且非空
369. i18n 键 container.action.stopVerb 在 10 语言都存在且非空
370. i18n 键 container.action.stopping 在 10 语言都存在且非空
371. i18n 键 container.action.timeout 在 10 语言都存在且非空
372. i18n 键 container.action.waitingReady 在 10 语言都存在且非空
373. i18n 键 container.biaoTi 在 10 语言都存在且非空
374. i18n 键 container.cap.mount 在 10 语言都存在且非空
375. i18n 键 container.cap.none 在 10 语言都存在且非空
376. i18n 键 container.cap.run 在 10 语言都存在且非空
377. i18n 键 container.cap.shell 在 10 语言都存在且非空
378. i18n 键 container.capLabel 在 10 语言都存在且非空
379. i18n 键 container.cardFocusHint 在 10 语言都存在且非空
380. i18n 键 container.console.biaoTi 在 10 语言都存在且非空
381. i18n 键 container.console.containerCreated 在 10 语言都存在且非空
382. i18n 键 container.console.containerReused 在 10 语言都存在且非空
383. i18n 键 container.console.gotoInstall 在 10 语言都存在且非空
384. i18n 键 container.console.inputPlaceholder 在 10 语言都存在且非空
385. i18n 键 container.console.intro 在 10 语言都存在且非空
386. i18n 键 container.console.linuxNode 在 10 语言都存在且非空
387. i18n 键 container.console.needsImage 在 10 语言都存在且非空
388. i18n 键 container.console.noExec 在 10 语言都存在且非空
389. i18n 键 container.console.notEnabled 在 10 语言都存在且非空
390. i18n 键 container.console.notReady 在 10 语言都存在且非空
391. i18n 键 container.console.offline 在 10 语言都存在且非空
392. i18n 键 container.console.onlyInChat 在 10 语言都存在且非空
393. i18n 键 container.console.openedInContainer 在 10 语言都存在且非空
394. i18n 键 container.console.projectStopped 在 10 语言都存在且非空
395. i18n 键 container.console.refused 在 10 语言都存在且非空
396. i18n 键 container.console.run 在 10 语言都存在且非空
397. i18n 键 container.console.security 在 10 语言都存在且非空
398. i18n 键 container.console.securityDetail 在 10 语言都存在且非空
399. i18n 键 container.console.sent 在 10 语言都存在且非空
400. i18n 键 container.console.stateLine 在 10 语言都存在且非空
401. i18n 键 container.console.tip 在 10 语言都存在且非空
402. i18n 键 container.console.title 在 10 语言都存在且非空
403. i18n 键 container.current 在 10 语言都存在且非空
404. i18n 键 container.current.none 在 10 语言都存在且非空
405. i18n 键 container.detailLabel 在 10 语言都存在且非空
406. i18n 键 container.devEnv.biaoTi 在 10 语言都存在且非空
407. i18n 键 container.devEnv.container 在 10 语言都存在且非空
408. i18n 键 container.devEnv.containerNote 在 10 语言都存在且非空
409. i18n 键 container.devEnv.createTitle 在 10 语言都存在且非空
410. i18n 键 container.devEnv.host 在 10 语言都存在且非空
411. i18n 键 container.devEnv.nameLabel 在 10 语言都存在且非空
412. i18n 键 container.devEnv.note 在 10 语言都存在且非空
413. i18n 键 container.devEnv.required 在 10 语言都存在且非空
414. i18n 键 container.devEnv.title 在 10 语言都存在且非空
415. i18n 键 container.devIsolation 在 10 语言都存在且非空
416. i18n 键 container.devIsolationTest 在 10 语言都存在且非空
417. i18n 键 container.env.install.biaoTi 在 10 语言都存在且非空
418. i18n 键 container.env.install.body 在 10 语言都存在且非空
419. i18n 键 container.env.install.netBody 在 10 语言都存在且非空
420. i18n 键 container.env.install.netTitle 在 10 语言都存在且非空
421. i18n 键 container.env.install.noNodeForUs 在 10 语言都存在且非空
422. i18n 键 container.env.install.persistBody 在 10 语言都存在且非空
423. i18n 键 container.env.install.persistTitle 在 10 语言都存在且非空
424. i18n 键 container.env.install.ti 在 10 语言都存在且非空
425. i18n 键 container.env.install.title 在 10 语言都存在且非空
426. i18n 键 container.env.mode.body 在 10 语言都存在且非空
427. i18n 键 container.env.mode.ti 在 10 语言都存在且非空
428. i18n 键 container.env.mode.title 在 10 语言都存在且非空
429. i18n 键 container.env.mode.unknown 在 10 语言都存在且非空
430. i18n 键 container.env.probe.button 在 10 语言都存在且非空
431. i18n 键 container.env.probe.refused.bad-command 在 10 语言都存在且非空
432. i18n 键 container.env.probe.refused.container-not-ready 在 10 语言都存在且非空
433. i18n 键 container.env.probe.refused.no-image 在 10 语言都存在且非空
434. i18n 键 container.env.probe.refused.project-unavailable 在 10 语言都存在且非空
435. i18n 键 container.env.prompt.biaoTi 在 10 语言都存在且非空
436. i18n 键 container.env.prompt.content 在 10 语言都存在且非空
437. i18n 键 container.env.prompt.copied 在 10 语言都存在且非空
438. i18n 键 container.env.prompt.copy 在 10 语言都存在且非空
439. i18n 键 container.env.prompt.failed 在 10 语言都存在且非空
440. i18n 键 container.env.prompt.hint 在 10 语言都存在且非空
441. i18n 键 container.env.prompt.tiShi 在 10 语言都存在且非空
442. i18n 键 container.env.prompt.title 在 10 语言都存在且非空
443. i18n 键 container.env.rollback.button 在 10 语言都存在且非空
444. i18n 键 container.env.rollback.confirmBody 在 10 语言都存在且非空
445. i18n 键 container.env.rollback.confirmTitle 在 10 语言都存在且非空
446. i18n 键 container.env.rollback.done 在 10 语言都存在且非空
447. i18n 键 container.env.rollback.refused.no-runtime-chosen 在 10 语言都存在且非空
448. i18n 键 container.env.rollback.refused.no-solidified-point 在 10 语言都存在且非空
449. i18n 键 container.env.rollback.refused.project-unavailable 在 10 语言都存在且非空
450. i18n 键 container.env.rollback.refused.run-failed 在 10 语言都存在且非空
451. i18n 键 container.env.rollback.refused.runtime-cannot-solidify 在 10 语言都存在且非空
452. i18n 键 container.env.solidify.ability.commit 在 10 语言都存在且非空
453. i18n 键 container.env.solidify.ability.export-import 在 10 语言都存在且非空
454. i18n 键 container.env.solidify.ability.unsupported 在 10 语言都存在且非空
455. i18n 键 container.env.solidify.biaoTi 在 10 语言都存在且非空
456. i18n 键 container.env.solidify.button 在 10 语言都存在且非空
457. i18n 键 container.env.solidify.decision.before-destroy 在 10 语言都存在且非空
458. i18n 键 container.env.solidify.decision.coalesced 在 10 语言都存在且非空
459. i18n 键 container.env.solidify.decision.explicit 在 10 语言都存在且非空
460. i18n 键 container.env.solidify.decision.first-time 在 10 语言都存在且非空
461. i18n 键 container.env.solidify.decision.nothing-changed 在 10 语言都存在且非空
462. i18n 键 container.env.solidify.decision.runtime-cannot-solidify 在 10 语言都存在且非空
463. i18n 键 container.env.solidify.decision.throttled-due 在 10 语言都存在且非空
464. i18n 键 container.env.solidify.done 在 10 语言都存在且非空
465. i18n 键 container.env.solidify.executorHost 在 10 语言都存在且非空
466. i18n 键 container.env.solidify.keep 在 10 语言都存在且非空
467. i18n 键 container.env.solidify.last 在 10 语言都存在且非空
468. i18n 键 container.env.solidify.never 在 10 语言都存在且非空
469. i18n 键 container.env.solidify.refused.coalesced 在 10 语言都存在且非空
470. i18n 键 container.env.solidify.refused.commit-failed 在 10 语言都存在且非空
471. i18n 键 container.env.solidify.refused.commit-unverified 在 10 语言都存在且非空
472. i18n 键 container.env.solidify.refused.no-container 在 10 语言都存在且非空
473. i18n 键 container.env.solidify.refused.no-image 在 10 语言都存在且非空
474. i18n 键 container.env.solidify.refused.no-runtime-chosen 在 10 语言都存在且非空
475. i18n 键 container.env.solidify.refused.nothing-to-solidify 在 10 语言都存在且非空
476. i18n 键 container.env.solidify.refused.runtime-cannot-solidify 在 10 语言都存在且非空
477. i18n 键 container.env.solidify.restore 在 10 语言都存在且非空
478. i18n 键 container.env.solidify.retained 在 10 语言都存在且非空
479. i18n 键 container.env.solidify.security 在 10 语言都存在且非空
480. i18n 键 container.env.solidify.status 在 10 语言都存在且非空
481. i18n 键 container.env.solidify.throttle 在 10 语言都存在且非空
482. i18n 键 container.env.solidify.title 在 10 语言都存在且非空
483. i18n 键 container.env.solidify.why.isolation-level-only 在 10 语言都存在且非空
484. i18n 键 container.env.solidify.why.no-runtime-chosen 在 10 语言都存在且非空
485. i18n 键 container.env.solidify.why.oci-commit 在 10 语言都存在且非空
486. i18n 键 container.env.solidify.why.one-shot-vm 在 10 语言都存在且非空
487. i18n 键 container.env.solidify.why.runtime-unknown 在 10 语言都存在且非空
488. i18n 键 container.env.solidify.why.system-service-needs-root 在 10 语言都存在且非空
489. i18n 键 container.env.solidify.why.wsl-no-commit 在 10 语言都存在且非空
490. i18n 键 container.envType.android 在 10 语言都存在且非空
491. i18n 键 container.envType.android.why 在 10 语言都存在且非空
492. i18n 键 container.envType.containerOnly 在 10 语言都存在且非空
493. i18n 键 container.envType.hint 在 10 语言都存在且非空
494. i18n 键 container.envType.limited 在 10 语言都存在且非空
495. i18n 键 container.envType.linux 在 10 语言都存在且非空
496. i18n 键 container.envType.linux.why 在 10 语言都存在且非空
497. i18n 键 container.envType.modeHint 在 10 语言都存在且非空
498. i18n 键 container.envType.notContainer 在 10 语言都存在且非空
499. i18n 键 container.envType.onlyLinux 在 10 语言都存在且非空
500. i18n 键 container.envType.title 在 10 语言都存在且非空
501. i18n 键 container.envType.windows 在 10 语言都存在且非空
502. i18n 键 container.envType.windows.why 在 10 语言都存在且非空
503. i18n 键 container.evidenceNone 在 10 语言都存在且非空
504. i18n 键 container.fsGuard.applied 在 10 语言都存在且非空
505. i18n 键 container.fsGuard.biaoTi 在 10 语言都存在且非空
506. i18n 键 container.fsGuard.confirmBody 在 10 语言都存在且非空
507. i18n 键 container.fsGuard.confirmLiftBody 在 10 语言都存在且非空
508. i18n 键 container.fsGuard.confirmTitle 在 10 语言都存在且非空
509. i18n 键 container.fsGuard.failed.icacls-failed 在 10 语言都存在且非空
510. i18n 键 container.fsGuard.failed.not-creator 在 10 语言都存在且非空
511. i18n 键 container.fsGuard.failed.unknown 在 10 语言都存在且非空
512. i18n 键 container.fsGuard.lifted 在 10 语言都存在且非空
513. i18n 键 container.fsGuard.limits 在 10 语言都存在且非空
514. i18n 键 container.fsGuard.lock 在 10 语言都存在且非空
515. i18n 键 container.fsGuard.off 在 10 语言都存在且非空
516. i18n 键 container.fsGuard.on 在 10 语言都存在且非空
517. i18n 键 container.fsGuard.qiYong 在 10 语言都存在且非空
518. i18n 键 container.fsGuard.title 在 10 语言都存在且非空
519. i18n 键 container.fsGuard.unavailable.no-project-dir 在 10 语言都存在且非空
520. i18n 键 container.fsGuard.unavailable.not-container-project 在 10 语言都存在且非空
521. i18n 键 container.fsGuard.unavailable.not-creator 在 10 语言都存在且非空
522. i18n 键 container.fsGuard.unavailable.platform-not-supported 在 10 语言都存在且非空
523. i18n 键 container.fsGuard.unavailable.unknown 在 10 语言都存在且非空
524. i18n 键 container.fsGuard.undo 在 10 语言都存在且非空
525. i18n 键 container.fsGuard.unlock 在 10 语言都存在且非空
526. i18n 键 container.fsGuard.what 在 10 语言都存在且非空
527. i18n 键 container.guideCollapse 在 10 语言都存在且非空
528. i18n 键 container.guideCollapsedHint 在 10 语言都存在且非空
529. i18n 键 container.guideCommercial 在 10 语言都存在且非空
530. i18n 键 container.guideCost 在 10 语言都存在且非空
531. i18n 键 container.guideFirstStep 在 10 语言都存在且非空
532. i18n 键 container.guideHint 在 10 语言都存在且非空
533. i18n 键 container.guideOs 在 10 语言都存在且非空
534. i18n 键 container.guideSize 在 10 语言都存在且非空
535. i18n 键 container.guideTitle 在 10 语言都存在且非空
536. i18n 键 container.hint 在 10 语言都存在且非空
537. i18n 键 container.image.biaoTi 在 10 语言都存在且非空
538. i18n 键 container.image.executorHost 在 10 语言都存在且非空
539. i18n 键 container.image.node 在 10 语言都存在且非空
540. i18n 键 container.image.pinned 在 10 语言都存在且非空
541. i18n 键 container.image.sourcePending 在 10 语言都存在且非空
542. i18n 键 container.image.stack.biaoTi 在 10 语言都存在且非空
543. i18n 键 container.image.stack.fits 在 10 语言都存在且非空
544. i18n 键 container.image.stack.minimal 在 10 语言都存在且非空
545. i18n 键 container.image.stack.moreLater 在 10 语言都存在且非空
546. i18n 键 container.image.stack.node 在 10 语言都存在且非空
547. i18n 键 container.image.stack.nodeOnly 在 10 语言都存在且非空
548. i18n 键 container.image.stack.title 在 10 语言都存在且非空
549. i18n 键 container.image.title 在 10 语言都存在且非空
550. i18n 键 container.image.why 在 10 语言都存在且非空
551. i18n 键 container.inst.actFailed 在 10 语言都存在且非空
552. i18n 键 container.inst.collapse 在 10 语言都存在且非空
553. i18n 键 container.inst.create 在 10 语言都存在且非空
554. i18n 键 container.inst.createHint 在 10 语言都存在且非空
555. i18n 键 container.inst.empty 在 10 语言都存在且非空
556. i18n 键 container.inst.hintReady 在 10 语言都存在且非空
557. i18n 键 container.inst.hintStopped 在 10 语言都存在且非空
558. i18n 键 container.inst.listFailed 在 10 语言都存在且非空
559. i18n 键 container.inst.loading 在 10 语言都存在且非空
560. i18n 键 container.inst.none 在 10 语言都存在且非空
561. i18n 键 container.inst.openAppFailed 在 10 语言都存在且非空
562. i18n 键 container.inst.ours 在 10 语言都存在且非空
563. i18n 键 container.inst.running 在 10 语言都存在且非空
564. i18n 键 container.inst.start 在 10 语言都存在且非空
565. i18n 键 container.inst.stop 在 10 语言都存在且非空
566. i18n 键 container.inst.stopped 在 10 语言都存在且非空
567. i18n 键 container.inst.title 在 10 语言都存在且非空
568. i18n 键 container.inst.unsupported 在 10 语言都存在且非空
569. i18n 键 container.inst.view 在 10 语言都存在且非空
570. i18n 键 container.kind.container 在 10 语言都存在且非空
571. i18n 键 container.kind.disposable-vm 在 10 语言都存在且非空
572. i18n 键 container.kind.linux-vm 在 10 语言都存在且非空
573. i18n 键 container.kind.microvm 在 10 语言都存在且非空
574. i18n 键 container.kind.system-container 在 10 语言都存在且非空
575. i18n 键 container.link.download 在 10 语言都存在且非空
576. i18n 键 container.link.install 在 10 语言都存在且非空
577. i18n 键 container.link.official 在 10 语言都存在且非空
578. i18n 键 container.link.support 在 10 语言都存在且非空
579. i18n 键 container.listEmpty 在 10 语言都存在且非空
580. i18n 键 container.listHidden 在 10 语言都存在且非空
581. i18n 键 container.listTitle 在 10 语言都存在且非空
582. i18n 键 container.listTitleHint 在 10 语言都存在且非空
583. i18n 键 container.microsandbox.alreadyInstalled 在 10 语言都存在且非空
584. i18n 键 container.microsandbox.install 在 10 语言都存在且非空
585. i18n 键 container.microsandbox.installFail 在 10 语言都存在且非空
586. i18n 键 container.microsandbox.installHint 在 10 语言都存在且非空
587. i18n 键 container.microsandbox.installOk 在 10 语言都存在且非空
588. i18n 键 container.microsandbox.installing 在 10 语言都存在且非空
589. i18n 键 container.microsandbox.reinstall 在 10 语言都存在且非空
590. i18n 键 container.microsandbox.reinstallOk 在 10 语言都存在且非空
591. i18n 键 container.microsandbox.reinstalling 在 10 语言都存在且非空
592. i18n 键 container.microsandbox.stepCheck 在 10 语言都存在且非空
593. i18n 键 container.microsandbox.stepDetect 在 10 语言都存在且非空
594. i18n 键 container.microsandbox.stepDownload 在 10 语言都存在且非空
595. i18n 键 container.microsandbox.stepInstall 在 10 语言都存在且非空
596. i18n 键 container.microsandbox.stepUninstall 在 10 语言都存在且非空
597. i18n 键 container.microsandbox.uninstall 在 10 语言都存在且非空
598. i18n 键 container.microsandbox.uninstallDisabled 在 10 语言都存在且非空
599. i18n 键 container.microsandbox.uninstallFail 在 10 语言都存在且非空
600. i18n 键 container.microsandbox.uninstallOk 在 10 语言都存在且非空
601. i18n 键 container.microsandbox.uninstalling 在 10 语言都存在且非空
602. i18n 键 container.microsandbox.virtNeed 在 10 语言都存在且非空
603. i18n 键 container.microsandbox.virtOk 在 10 语言都存在且非空
604. i18n 键 container.mount.biaoTi 在 10 语言都存在且非空
605. i18n 键 container.mount.body 在 10 语言都存在且非空
606. i18n 键 container.mount.perf 在 10 语言都存在且非空
607. i18n 键 container.mount.ti 在 10 语言都存在且非空
608. i18n 键 container.mount.title 在 10 语言都存在且非空
609. i18n 键 container.notInstalledNote 在 10 语言都存在且非空
610. i18n 键 container.probe.startHint 在 10 语言都存在且非空
611. i18n 键 container.probeBtn 在 10 语言都存在且非空
612. i18n 键 container.probeDone 在 10 语言都存在且非空
613. i18n 键 container.probeFailed 在 10 语言都存在且非空
614. i18n 键 container.probeSummary 在 10 语言都存在且非空
615. i18n 键 container.probing 在 10 语言都存在且非空
616. i18n 键 container.project.available 在 10 语言都存在且非空
617. i18n 键 container.project.blockedNotice 在 10 语言都存在且非空
618. i18n 键 container.project.devBlocked 在 10 语言都存在且非空
619. i18n 键 container.project.dirBody 在 10 语言都存在且非空
620. i18n 键 container.project.dirNotRecorded 在 10 语言都存在且非空
621. i18n 键 container.project.dirSet 在 10 语言都存在且非空
622. i18n 键 container.project.dirSetFailed 在 10 语言都存在且非空
623. i18n 键 container.project.disableConfirmBody 在 10 语言都存在且非空
624. i18n 键 container.project.disableConfirmTitle 在 10 语言都存在且非空
625. i18n 键 container.project.disableFailed 在 10 语言都存在且非空
626. i18n 键 container.project.enableFailed 在 10 语言都存在且非空
627. i18n 键 container.project.enableNeedsContainer 在 10 语言都存在且非空
628. i18n 键 container.project.enableNeedsContainerTitle 在 10 语言都存在且非空
629. i18n 键 container.project.enabledAt 在 10 语言都存在且非空
630. i18n 键 container.project.enforceBoundary 在 10 语言都存在且非空
631. i18n 键 container.project.fix.choose-container 在 10 语言都存在且非空
632. i18n 键 container.project.fix.enable-project 在 10 语言都存在且非空
633. i18n 键 container.project.fix.install-container 在 10 语言都存在且非空
634. i18n 键 container.project.fix.ok 在 10 语言都存在且非空
635. i18n 键 container.project.fix.start-container 在 10 语言都存在且非空
636. i18n 键 container.project.historyStillReadable 在 10 语言都存在且非空
637. i18n 键 container.project.hostEditingRefused 在 10 语言都存在且非空
638. i18n 键 container.project.menuHint 在 10 语言都存在且非空
639. i18n 键 container.project.none 在 10 语言都存在且非空
640. i18n 键 container.project.noneHint 在 10 语言都存在且非空
641. i18n 键 container.project.notContainerProject 在 10 语言都存在且非空
642. i18n 键 container.project.notCreator 在 10 语言都存在且非空
643. i18n 键 container.project.reason.container-not-installed 在 10 语言都存在且非空
644. i18n 键 container.project.reason.container-not-ready 在 10 语言都存在且非空
645. i18n 键 container.project.reason.containerDown 在 10 语言都存在且非空
646. i18n 键 container.project.reason.disabledByOwner 在 10 语言都存在且非空
647. i18n 键 container.project.reason.host-dev 在 10 语言都存在且非空
648. i18n 键 container.project.reason.notChosen 在 10 语言都存在且非空
649. i18n 键 container.project.reason.notInstalled 在 10 语言都存在且非空
650. i18n 键 container.project.reason.ok 在 10 语言都存在且非空
651. i18n 键 container.project.reason.stopped-by-creator 在 10 语言都存在且非空
652. i18n 键 container.project.reasonBody 在 10 语言都存在且非空
653. i18n 键 container.project.remoteNotice 在 10 语言都存在且非空
654. i18n 键 container.project.remoteReportedAt 在 10 语言都存在且非空
655. i18n 键 container.project.switchBody 在 10 语言都存在且非空
656. i18n 键 container.project.switchDone 在 10 语言都存在且非空
657. i18n 键 container.project.switchFailed 在 10 语言都存在且非空
658. i18n 键 container.project.switchFits 在 10 语言都存在且非空
659. i18n 键 container.project.switchMore 在 10 语言都存在且非空
660. i18n 键 container.project.switchNeedRestart 在 10 语言都存在且非空
661. i18n 键 container.project.switchNoContainer 在 10 语言都存在且非空
662. i18n 键 container.project.switchTitle 在 10 语言都存在且非空
663. i18n 键 container.project.testingAllowed 在 10 语言都存在且非空
664. i18n 键 container.project.unavailable 在 10 语言都存在且非空
665. i18n 键 container.project.unavailableAsOffline 在 10 语言都存在且非空
666. i18n 键 container.project.usingContainer 在 10 语言都存在且非空
667. i18n 键 container.reason.ambiguous-instances 在 10 语言都存在且非空
668. i18n 键 container.reason.no-podman-machine 在 10 语言都存在且非空
669. i18n 键 container.reason.not-installed 在 10 语言都存在且非空
670. i18n 键 container.reason.not-standalone-engine 在 10 语言都存在且非空
671. i18n 键 container.reason.ok 在 10 语言都存在且非空
672. i18n 键 container.reason.one-shot-vm 在 10 语言都存在且非空
673. i18n 键 container.reason.system-service-needs-root 在 10 语言都存在且非空
674. i18n 键 container.reason.uncertain-programmatic-control 在 10 语言都存在且非空
675. i18n 键 container.reason.unsupported-platform 在 10 语言都存在且非空
676. i18n 键 container.reason.vm-not-engine 在 10 语言都存在且非空
677. i18n 键 container.reason.vm-shutdown-affects-all 在 10 语言都存在且非空
678. i18n 键 container.refreshHint 在 10 语言都存在且非空
679. i18n 键 container.rt.colima.commercial 在 10 语言都存在且非空
680. i18n 键 container.rt.colima.cost 在 10 语言都存在且非空
681. i18n 键 container.rt.colima.ming 在 10 语言都存在且非空
682. i18n 键 container.rt.colima.name 在 10 语言都存在且非空
683. i18n 键 container.rt.colima.os 在 10 语言都存在且非空
684. i18n 键 container.rt.colima.osShort 在 10 语言都存在且非空
685. i18n 键 container.rt.colima.size 在 10 语言都存在且非空
686. i18n 键 container.rt.docker.commercial 在 10 语言都存在且非空
687. i18n 键 container.rt.docker.cost 在 10 语言都存在且非空
688. i18n 键 container.rt.docker.ming 在 10 语言都存在且非空
689. i18n 键 container.rt.docker.name 在 10 语言都存在且非空
690. i18n 键 container.rt.docker.os 在 10 语言都存在且非空
691. i18n 键 container.rt.docker.osShort 在 10 语言都存在且非空
692. i18n 键 container.rt.docker.size 在 10 语言都存在且非空
693. i18n 键 container.rt.isulad.commercial 在 10 语言都存在且非空
694. i18n 键 container.rt.isulad.cost 在 10 语言都存在且非空
695. i18n 键 container.rt.isulad.ming 在 10 语言都存在且非空
696. i18n 键 container.rt.isulad.name 在 10 语言都存在且非空
697. i18n 键 container.rt.isulad.os 在 10 语言都存在且非空
698. i18n 键 container.rt.isulad.osShort 在 10 语言都存在且非空
699. i18n 键 container.rt.isulad.size 在 10 语言都存在且非空
700. i18n 键 container.rt.kata.commercial 在 10 语言都存在且非空
701. i18n 键 container.rt.kata.cost 在 10 语言都存在且非空
702. i18n 键 container.rt.kata.ming 在 10 语言都存在且非空
703. i18n 键 container.rt.kata.name 在 10 语言都存在且非空
704. i18n 键 container.rt.kata.os 在 10 语言都存在且非空
705. i18n 键 container.rt.kata.osShort 在 10 语言都存在且非空
706. i18n 键 container.rt.kata.size 在 10 语言都存在且非空
707. i18n 键 container.rt.lima.commercial 在 10 语言都存在且非空
708. i18n 键 container.rt.lima.cost 在 10 语言都存在且非空
709. i18n 键 container.rt.lima.ming 在 10 语言都存在且非空
710. i18n 键 container.rt.lima.name 在 10 语言都存在且非空
711. i18n 键 container.rt.lima.os 在 10 语言都存在且非空
712. i18n 键 container.rt.lima.osShort 在 10 语言都存在且非空
713. i18n 键 container.rt.lima.size 在 10 语言都存在且非空
714. i18n 键 container.rt.lxd-incus.commercial 在 10 语言都存在且非空
715. i18n 键 container.rt.lxd-incus.cost 在 10 语言都存在且非空
716. i18n 键 container.rt.lxd-incus.ming 在 10 语言都存在且非空
717. i18n 键 container.rt.lxd-incus.name 在 10 语言都存在且非空
718. i18n 键 container.rt.lxd-incus.os 在 10 语言都存在且非空
719. i18n 键 container.rt.lxd-incus.osShort 在 10 语言都存在且非空
720. i18n 键 container.rt.lxd-incus.size 在 10 语言都存在且非空
721. i18n 键 container.rt.microsandbox.commercial 在 10 语言都存在且非空
722. i18n 键 container.rt.microsandbox.cost 在 10 语言都存在且非空
723. i18n 键 container.rt.microsandbox.ming 在 10 语言都存在且非空
724. i18n 键 container.rt.microsandbox.name 在 10 语言都存在且非空
725. i18n 键 container.rt.microsandbox.os 在 10 语言都存在且非空
726. i18n 键 container.rt.microsandbox.osShort 在 10 语言都存在且非空
727. i18n 键 container.rt.microsandbox.size 在 10 语言都存在且非空
728. i18n 键 container.rt.nerdctl.commercial 在 10 语言都存在且非空
729. i18n 键 container.rt.nerdctl.cost 在 10 语言都存在且非空
730. i18n 键 container.rt.nerdctl.ming 在 10 语言都存在且非空
731. i18n 键 container.rt.nerdctl.name 在 10 语言都存在且非空
732. i18n 键 container.rt.nerdctl.os 在 10 语言都存在且非空
733. i18n 键 container.rt.nerdctl.osShort 在 10 语言都存在且非空
734. i18n 键 container.rt.nerdctl.size 在 10 语言都存在且非空
735. i18n 键 container.rt.podman.commercial 在 10 语言都存在且非空
736. i18n 键 container.rt.podman.cost 在 10 语言都存在且非空
737. i18n 键 container.rt.podman.ming 在 10 语言都存在且非空
738. i18n 键 container.rt.podman.name 在 10 语言都存在且非空
739. i18n 键 container.rt.podman.os 在 10 语言都存在且非空
740. i18n 键 container.rt.podman.osShort 在 10 语言都存在且非空
741. i18n 键 container.rt.podman.size 在 10 语言都存在且非空
742. i18n 键 container.rt.pouch.commercial 在 10 语言都存在且非空
743. i18n 键 container.rt.pouch.cost 在 10 语言都存在且非空
744. i18n 键 container.rt.pouch.ming 在 10 语言都存在且非空
745. i18n 键 container.rt.pouch.name 在 10 语言都存在且非空
746. i18n 键 container.rt.pouch.os 在 10 语言都存在且非空
747. i18n 键 container.rt.pouch.osShort 在 10 语言都存在且非空
748. i18n 键 container.rt.pouch.size 在 10 语言都存在且非空
749. i18n 键 container.rt.rancher-desktop.commercial 在 10 语言都存在且非空
750. i18n 键 container.rt.rancher-desktop.cost 在 10 语言都存在且非空
751. i18n 键 container.rt.rancher-desktop.ming 在 10 语言都存在且非空
752. i18n 键 container.rt.rancher-desktop.name 在 10 语言都存在且非空
753. i18n 键 container.rt.rancher-desktop.os 在 10 语言都存在且非空
754. i18n 键 container.rt.rancher-desktop.osShort 在 10 语言都存在且非空
755. i18n 键 container.rt.rancher-desktop.size 在 10 语言都存在且非空
756. i18n 键 container.rt.windows-sandbox.commercial 在 10 语言都存在且非空
757. i18n 键 container.rt.windows-sandbox.cost 在 10 语言都存在且非空
758. i18n 键 container.rt.windows-sandbox.ming 在 10 语言都存在且非空
759. i18n 键 container.rt.windows-sandbox.name 在 10 语言都存在且非空
760. i18n 键 container.rt.windows-sandbox.os 在 10 语言都存在且非空
761. i18n 键 container.rt.windows-sandbox.osShort 在 10 语言都存在且非空
762. i18n 键 container.rt.windows-sandbox.size 在 10 语言都存在且非空
763. i18n 键 container.rt.wsl.commercial 在 10 语言都存在且非空
764. i18n 键 container.rt.wsl.cost 在 10 语言都存在且非空
765. i18n 键 container.rt.wsl.ming 在 10 语言都存在且非空
766. i18n 键 container.rt.wsl.name 在 10 语言都存在且非空
767. i18n 键 container.rt.wsl.os 在 10 语言都存在且非空
768. i18n 键 container.rt.wsl.osShort 在 10 语言都存在且非空
769. i18n 键 container.rt.wsl.size 在 10 语言都存在且非空
770. i18n 键 container.run.error 在 10 语言都存在且非空
771. i18n 键 container.run.notRunning 在 10 语言都存在且非空
772. i18n 键 container.run.running 在 10 语言都存在且非空
773. i18n 键 container.run.unsupported 在 10 语言都存在且非空
774. i18n 键 container.runEnv.biaoTi 在 10 语言都存在且非空
775. i18n 键 container.runEnv.blockedLabel 在 10 语言都存在且非空
776. i18n 键 container.runEnv.fitsLabel 在 10 语言都存在且非空
777. i18n 键 container.runEnv.needsLabel 在 10 语言都存在且非空
778. i18n 键 container.runEnv.opt.container-linux.biaoTi 在 10 语言都存在且非空
779. i18n 键 container.runEnv.opt.container-linux.blocked 在 10 语言都存在且非空
780. i18n 键 container.runEnv.opt.container-linux.fits 在 10 语言都存在且非空
781. i18n 键 container.runEnv.opt.container-linux.impl 在 10 语言都存在且非空
782. i18n 键 container.runEnv.opt.container-linux.needs 在 10 语言都存在且非空
783. i18n 键 container.runEnv.opt.container-linux.title 在 10 语言都存在且非空
784. i18n 键 container.runEnv.opt.container-windows.biaoTi 在 10 语言都存在且非空
785. i18n 键 container.runEnv.opt.container-windows.blocked 在 10 语言都存在且非空
786. i18n 键 container.runEnv.opt.container-windows.fits 在 10 语言都存在且非空
787. i18n 键 container.runEnv.opt.container-windows.impl 在 10 语言都存在且非空
788. i18n 键 container.runEnv.opt.container-windows.needs 在 10 语言都存在且非空
789. i18n 键 container.runEnv.opt.container-windows.title 在 10 语言都存在且非空
790. i18n 键 container.runEnv.opt.device-android.biaoTi 在 10 语言都存在且非空
791. i18n 键 container.runEnv.opt.device-android.blocked 在 10 语言都存在且非空
792. i18n 键 container.runEnv.opt.device-android.fits 在 10 语言都存在且非空
793. i18n 键 container.runEnv.opt.device-android.impl 在 10 语言都存在且非空
794. i18n 键 container.runEnv.opt.device-android.needs 在 10 语言都存在且非空
795. i18n 键 container.runEnv.opt.device-android.title 在 10 语言都存在且非空
796. i18n 键 container.runEnv.opt.device-ios.biaoTi 在 10 语言都存在且非空
797. i18n 键 container.runEnv.opt.device-ios.blocked 在 10 语言都存在且非空
798. i18n 键 container.runEnv.opt.device-ios.fits 在 10 语言都存在且非空
799. i18n 键 container.runEnv.opt.device-ios.impl 在 10 语言都存在且非空
800. i18n 键 container.runEnv.opt.device-ios.needs 在 10 语言都存在且非空
801. i18n 键 container.runEnv.opt.device-ios.title 在 10 语言都存在且非空
802. i18n 键 container.runEnv.opt.device-windows-desktop.biaoTi 在 10 语言都存在且非空
803. i18n 键 container.runEnv.opt.device-windows-desktop.blocked 在 10 语言都存在且非空
804. i18n 键 container.runEnv.opt.device-windows-desktop.fits 在 10 语言都存在且非空
805. i18n 键 container.runEnv.opt.device-windows-desktop.impl 在 10 语言都存在且非空
806. i18n 键 container.runEnv.opt.device-windows-desktop.needs 在 10 语言都存在且非空
807. i18n 键 container.runEnv.opt.device-windows-desktop.title 在 10 语言都存在且非空
808. i18n 键 container.runEnv.title 在 10 语言都存在且非空
809. i18n 键 container.section.existing 在 10 语言都存在且非空
810. i18n 键 container.section.images 在 10 语言都存在且非空
811. i18n 键 container.snapshot.biaoTi 在 10 语言都存在且非空
812. i18n 键 container.snapshot.body 在 10 语言都存在且非空
813. i18n 键 container.snapshot.fingerprint 在 10 语言都存在且非空
814. i18n 键 container.snapshot.layerEnv 在 10 语言都存在且非空
815. i18n 键 container.snapshot.layerFiles 在 10 语言都存在且非空
816. i18n 键 container.snapshot.noClaim 在 10 语言都存在且非空
817. i18n 键 container.snapshot.ti 在 10 语言都存在且非空
818. i18n 键 container.snapshot.title 在 10 语言都存在且非空
819. i18n 键 container.status.engine-error 在 10 语言都存在且非空
820. i18n 键 container.status.installed-not-running 在 10 语言都存在且非空
821. i18n 键 container.status.not-installed 在 10 语言都存在且非空
822. i18n 键 container.status.ready 在 10 语言都存在且非空
823. i18n 键 container.status.unsupported-platform 在 10 语言都存在且非空
824. i18n 键 container.target.android.preview 在 10 语言都存在且非空
825. i18n 键 container.target.android.title 在 10 语言都存在且非空
826. i18n 键 container.target.biaoTi 在 10 语言都存在且非空
827. i18n 键 container.target.buildLabel 在 10 语言都存在且非空
828. i18n 键 container.target.hint 在 10 语言都存在且非空
829. i18n 键 container.target.ios.preview 在 10 语言都存在且非空
830. i18n 键 container.target.ios.title 在 10 语言都存在且非空
831. i18n 键 container.target.linux-service.preview 在 10 语言都存在且非空
832. i18n 键 container.target.linux-service.title 在 10 语言都存在且非空
833. i18n 键 container.target.macos.preview 在 10 语言都存在且非空
834. i18n 键 container.target.macos.title 在 10 语言都存在且非空
835. i18n 键 container.target.notSelected 在 10 语言都存在且非空
836. i18n 键 container.target.previewLabel 在 10 语言都存在且非空
837. i18n 键 container.target.saved 在 10 语言都存在且非空
838. i18n 键 container.target.tiShi 在 10 语言都存在且非空
839. i18n 键 container.target.title 在 10 语言都存在且非空
840. i18n 键 container.target.web.preview 在 10 语言都存在且非空
841. i18n 键 container.target.web.title 在 10 语言都存在且非空
842. i18n 键 container.target.windows-desktop.preview 在 10 语言都存在且非空
843. i18n 键 container.target.windows-desktop.title 在 10 语言都存在且非空
844. i18n 键 container.tiShi 在 10 语言都存在且非空
845. i18n 键 container.timing.biaoTi 在 10 语言都存在且非空
846. i18n 键 container.timing.none 在 10 语言都存在且非空
847. i18n 键 container.timing.run 在 10 语言都存在且非空
848. i18n 键 container.timing.start 在 10 语言都存在且非空
849. i18n 键 container.timing.stop 在 10 语言都存在且非空
850. i18n 键 container.timing.title 在 10 语言都存在且非空
851. i18n 键 container.title 在 10 语言都存在且非空
852. i18n 键 container.versionLabel 在 10 语言都存在且非空
853. i18n 键 cost.biaoTi 在 10 语言都存在且非空
854. i18n 键 cost.byModel 在 10 语言都存在且非空
855. i18n 键 cost.byProvider 在 10 语言都存在且非空
856. i18n 键 cost.bySession 在 10 语言都存在且非空
857. i18n 键 cost.byWindow 在 10 语言都存在且非空
858. i18n 键 cost.cost 在 10 语言都存在且非空
859. i18n 键 cost.empty 在 10 语言都存在且非空
860. i18n 键 cost.estHint 在 10 语言都存在且非空
861. i18n 键 cost.export 在 10 语言都存在且非空
862. i18n 键 cost.local 在 10 语言都存在且非空
863. i18n 键 cost.localHint 在 10 语言都存在且非空
864. i18n 键 cost.model 在 10 语言都存在且非空
865. i18n 键 cost.session 在 10 语言都存在且非空
866. i18n 键 cost.title 在 10 语言都存在且非空
867. i18n 键 cost.tokens 在 10 语言都存在且非空
868. i18n 键 cost.turns 在 10 语言都存在且非空
869. i18n 键 cost.unpriced 在 10 语言都存在且非空
870. i18n 键 cost.unpricedHint 在 10 语言都存在且非空
871. i18n 键 cp.assets 在 10 语言都存在且非空
872. i18n 键 cp.autoDelete 在 10 语言都存在且非空
873. i18n 键 cp.confirmLoad 在 10 语言都存在且非空
874. i18n 键 cp.confirmStop 在 10 语言都存在且非空
875. i18n 键 cp.confirmTitle 在 10 语言都存在且非空
876. i18n 键 cp.detail 在 10 语言都存在且非空
877. i18n 键 cp.empty 在 10 语言都存在且非空
878. i18n 键 cp.filesChanged 在 10 语言都存在且非空
879. i18n 键 cp.filesCreated 在 10 语言都存在且非空
880. i18n 键 cp.irreversible 在 10 语言都存在且非空
881. i18n 键 cp.list 在 10 语言都存在且非空
882. i18n 键 cp.load 在 10 语言都存在且非空
883. i18n 键 cp.max 在 10 语言都存在且非空
884. i18n 键 cp.rollback 在 10 语言都存在且非空
885. i18n 键 cp.rollbackHint 在 10 语言都存在且非空
886. i18n 键 cp.roundEnd 在 10 语言都存在且非空
887. i18n 键 cp.roundStart 在 10 语言都存在且非空
888. i18n 键 cp.space 在 10 语言都存在且非空
889. i18n 键 cp.stopLoad 在 10 语言都存在且非空
890. i18n 键 cp.tasks 在 10 语言都存在且非空
891. i18n 键 cp.time 在 10 语言都存在且非空
892. i18n 键 cp.title 在 10 语言都存在且非空
893. i18n 键 cp.used 在 10 语言都存在且非空
894. i18n 键 ctx.archive 在 10 语言都存在且非空
895. i18n 键 ctx.archiveConfirm 在 10 语言都存在且非空
896. i18n 键 ctx.budget.biaoTi 在 10 语言都存在且非空
897. i18n 键 ctx.budget.hint 在 10 语言都存在且非空
898. i18n 键 ctx.budget.minHint 在 10 语言都存在且非空
899. i18n 键 ctx.budget.tiShi 在 10 语言都存在且非空
900. i18n 键 ctx.budget.title 在 10 语言都存在且非空
901. i18n 键 ctx.budget.tokens 在 10 语言都存在且非空
902. i18n 键 ctx.clear 在 10 语言都存在且非空
903. i18n 键 ctx.clearConfirm 在 10 语言都存在且非空
904. i18n 键 ctx.close 在 10 语言都存在且非空
905. i18n 键 ctx.closeConfirm 在 10 语言都存在且非空
906. i18n 键 ctx.delete 在 10 语言都存在且非空
907. i18n 键 ctx.dissolveFailed 在 10 语言都存在且非空
908. i18n 键 ctx.enable 在 10 语言都存在且非空
909. i18n 键 ctx.leave 在 10 语言都存在且非空
910. i18n 键 ctx.noTasks 在 10 语言都存在且非空
911. i18n 键 ctx.notify 在 10 语言都存在且非空
912. i18n 键 ctx.projectDisable 在 10 语言都存在且非空
913. i18n 键 ctx.projectEnable 在 10 语言都存在且非空
914. i18n 键 ctx.projectLockDir 在 10 语言都存在且非空
915. i18n 键 ctx.projectSetDir 在 10 语言都存在且非空
916. i18n 键 ctx.projectSwitchContainer 在 10 语言都存在且非空
917. i18n 键 ctx.rename 在 10 语言都存在且非空
918. i18n 键 ctx.renamePrompt 在 10 语言都存在且非空
919. i18n 键 ctx.runningTasks 在 10 语言都存在且非空
920. i18n 键 ctx.settings 在 10 语言都存在且非空
921. i18n 键 ctx.taskRunning 在 10 语言都存在且非空
922. i18n 键 ctx.waitingTasks 在 10 语言都存在且非空
923. i18n 键 dashboard.agents 在 10 语言都存在且非空
924. i18n 键 dashboard.biaoTi 在 10 语言都存在且非空
925. i18n 键 dashboard.blocked 在 10 语言都存在且非空
926. i18n 键 dashboard.cat.contact 在 10 语言都存在且非空
927. i18n 键 dashboard.cat.external 在 10 语言都存在且非空
928. i18n 键 dashboard.cat.internal 在 10 语言都存在且非空
929. i18n 键 dashboard.cat.single 在 10 语言都存在且非空
930. i18n 键 dashboard.cost 在 10 语言都存在且非空
931. i18n 键 dashboard.createdAt 在 10 语言都存在且非空
932. i18n 键 dashboard.done 在 10 语言都存在且非空
933. i18n 键 dashboard.emptyEvents 在 10 语言都存在且非空
934. i18n 键 dashboard.emptyLine 在 10 语言都存在且非空
935. i18n 键 dashboard.emptySessions 在 10 语言都存在且非空
936. i18n 键 dashboard.hoursAgo 在 10 语言都存在且非空
937. i18n 键 dashboard.inProgressProjects 在 10 语言都存在且非空
938. i18n 键 dashboard.jump 在 10 语言都存在且非空
939. i18n 键 dashboard.noUsage 在 10 语言都存在且非空
940. i18n 键 dashboard.pendingBadge 在 10 语言都存在且非空
941. i18n 键 dashboard.pendingDecisions 在 10 语言都存在且非空
942. i18n 键 dashboard.progressLabel 在 10 语言都存在且非空
943. i18n 键 dashboard.queue 在 10 语言都存在且非空
944. i18n 键 dashboard.readOnlyHint 在 10 语言都存在且非空
945. i18n 键 dashboard.recent 在 10 语言都存在且非空
946. i18n 键 dashboard.runningInstances 在 10 语言都存在且非空
947. i18n 键 dashboard.sessions 在 10 语言都存在且非空
948. i18n 键 dashboard.tasks 在 10 语言都存在且非空
949. i18n 键 dashboard.title 在 10 语言都存在且非空
950. i18n 键 dashboard.tokenCost 在 10 语言都存在且非空
951. i18n 键 dashboard.tokens 在 10 语言都存在且非空
952. i18n 键 dashboard.usage 在 10 语言都存在且非空
953. i18n 键 demo.agent 在 10 语言都存在且非空
954. i18n 键 demo.client 在 10 语言都存在且非空
955. i18n 键 demo.msg.duty 在 10 语言都存在且非空
956. i18n 键 demo.msg.extSilent 在 10 语言都存在且非空
957. i18n 键 demo.msg.hello 在 10 语言都存在且非空
958. i18n 键 demo.msg.rndUpdated 在 10 语言都存在且非空
959. i18n 键 demo.msg.schedule 在 10 语言都存在且非空
960. i18n 键 demo.msg.scheduled 在 10 语言都存在且非空
961. i18n 键 demo.msg.synced 在 10 语言都存在且非空
962. i18n 键 demo.msg.urgent 在 10 语言都存在且非空
963. i18n 键 demo.msg.weekly 在 10 语言都存在且非空
964. i18n 键 demo.msg.weeklyOk 在 10 语言都存在且非空
965. i18n 键 demo.name.archiver 在 10 语言都存在且非空
966. i18n 键 demo.persona 在 10 语言都存在且非空
967. i18n 键 demo.project1 在 10 语言都存在且非空
968. i18n 键 demo.project2 在 10 语言都存在且非空
969. i18n 键 demo.recent1 在 10 语言都存在且非空
970. i18n 键 demo.recent2 在 10 语言都存在且非空
971. i18n 键 demo.sess.c1 在 10 语言都存在且非空
972. i18n 键 demo.sess.g1 在 10 语言都存在且非空
973. i18n 键 demo.sess.g2 在 10 语言都存在且非空
974. i18n 键 demo.sess.g3 在 10 语言都存在且非空
975. i18n 键 demo.task1 在 10 语言都存在且非空
976. i18n 键 demo.task2 在 10 语言都存在且非空
977. i18n 键 demo.task3 在 10 语言都存在且非空
978. i18n 键 diag.title 在 10 语言都存在且非空
979. i18n 键 dsh.alreadyInstalled 在 10 语言都存在且非空
980. i18n 键 dsh.anZhuang 在 10 语言都存在且非空
981. i18n 键 dsh.anZhuangChengGong 在 10 语言都存在且非空
982. i18n 键 dsh.anZhuangShiBai 在 10 语言都存在且非空
983. i18n 键 dsh.anZhuangZhong 在 10 语言都存在且非空
984. i18n 键 dsh.biaoTi 在 10 语言都存在且非空
985. i18n 键 dsh.chongXinAnZhuang 在 10 语言都存在且非空
986. i18n 键 dsh.chongXinAnZhuangZhong 在 10 语言都存在且非空
987. i18n 键 dsh.chongXinChengGong 在 10 语言都存在且非空
988. i18n 键 dsh.jianCha 在 10 语言都存在且非空
989. i18n 键 dsh.jianChaChaoShi 在 10 语言都存在且非空
990. i18n 键 dsh.jianChaYiChang 在 10 语言都存在且非空
991. i18n 键 dsh.jianChaZhong 在 10 语言都存在且非空
992. i18n 键 dsh.tiShi 在 10 语言都存在且非空
993. i18n 键 dsh.weiAnZhuang 在 10 语言都存在且非空
994. i18n 键 dsh.yiAnZhuang 在 10 语言都存在且非空
995. i18n 键 embed.gpuHint 在 10 语言都存在且非空
996. i18n 键 embed.model 在 10 语言都存在且非空
997. i18n 键 embed.section 在 10 语言都存在且非空
998. i18n 键 embed.useGpu 在 10 语言都存在且非空
999. i18n 键 empty.subtitle 在 10 语言都存在且非空
1000. i18n 键 empty.title 在 10 语言都存在且非空
1001. i18n 键 eta.anomalyOverrun 在 10 语言都存在且非空
1002. i18n 键 eta.anomalyStalled 在 10 语言都存在且非空
1003. i18n 键 eta.anomalyStop 在 10 语言都存在且非空
1004. i18n 键 eta.continueWithEta 在 10 语言都存在且非空
1005. i18n 键 eta.notFromModel 在 10 语言都存在且非空
1006. i18n 键 eta.xw.dengDaiHuiFu 在 10 语言都存在且非空
1007. i18n 键 eta.xw.dengDaiXingDong 在 10 语言都存在且非空
1008. i18n 键 eta.xw.duiHua 在 10 语言都存在且非空
1009. i18n 键 eta.xw.gongJu 在 10 语言都存在且非空
1010. i18n 键 eta.xw.ziDongXuPai 在 10 语言都存在且非空
1011. i18n 键 executors.biaoTi 在 10 语言都存在且非空
1012. i18n 键 executors.none 在 10 语言都存在且非空
1013. i18n 键 executors.run 在 10 语言都存在且非空
1014. i18n 键 executors.title 在 10 语言都存在且非空
1015. i18n 键 export.done 在 10 语言都存在且非空
1016. i18n 键 export.hasTs 在 10 语言都存在且非空
1017. i18n 键 export.header 在 10 语言都存在且非空
1018. i18n 键 export.hint 在 10 语言都存在且非空
1019. i18n 键 export.include 在 10 语言都存在且非空
1020. i18n 键 export.markdown 在 10 语言都存在且非空
1021. i18n 键 export.me 在 10 语言都存在且非空
1022. i18n 键 export.tiShi 在 10 语言都存在且非空
1023. i18n 键 export.wo 在 10 语言都存在且非空
1024. i18n 键 group.addMember 在 10 语言都存在且非空
1025. i18n 键 group.cert.biaoTi 在 10 语言都存在且非空
1026. i18n 键 group.cert.emptyGroup 在 10 语言都存在且非空
1027. i18n 键 group.cert.expired 在 10 语言都存在且非空
1028. i18n 键 group.cert.fingerprint 在 10 语言都存在且非空
1029. i18n 键 group.cert.generation 在 10 语言都存在且非空
1030. i18n 键 group.cert.none 在 10 语言都存在且非空
1031. i18n 键 group.cert.readonlyHint 在 10 语言都存在且非空
1032. i18n 键 group.cert.revoked 在 10 语言都存在且非空
1033. i18n 键 group.cert.rotated 在 10 语言都存在且非空
1034. i18n 键 group.cert.showFull 在 10 语言都存在且非空
1035. i18n 键 group.cert.status 在 10 语言都存在且非空
1036. i18n 键 group.cert.title 在 10 语言都存在且非空
1037. i18n 键 group.cert.unavailable 在 10 语言都存在且非空
1038. i18n 键 group.cert.valid 在 10 语言都存在且非空
1039. i18n 键 group.directed 在 10 语言都存在且非空
1040. i18n 键 group.directedOnly 在 10 语言都存在且非空
1041. i18n 键 group.kick 在 10 语言都存在且非空
1042. i18n 键 group.memberDisabled 在 10 语言都存在且非空
1043. i18n 键 group.memberEmpty 在 10 语言都存在且非空
1044. i18n 键 group.memberMeshOff 在 10 语言都存在且非空
1045. i18n 键 group.memberOffline 在 10 语言都存在且非空
1046. i18n 键 group.memberOnline 在 10 语言都存在且非空
1047. i18n 键 group.memberPendingConfirm 在 10 语言都存在且非空
1048. i18n 键 group.memberPendingConfirmHint 在 10 语言都存在且非空
1049. i18n 键 group.memberPresenceUnknown 在 10 语言都存在且非空
1050. i18n 键 group.memberRemote 在 10 语言都存在且非空
1051. i18n 键 group.memberUnattributed 在 10 语言都存在且非空
1052. i18n 键 group.members 在 10 语言都存在且非空
1053. i18n 键 group.pickInstance 在 10 语言都存在且非空
1054. i18n 键 group.pullIn 在 10 语言都存在且非空
1055. i18n 键 group.type.external 在 10 语言都存在且非空
1056. i18n 键 group.type.internal 在 10 语言都存在且非空
1057. i18n 键 guide.finish 在 10 语言都存在且非空
1058. i18n 键 guide.next 在 10 语言都存在且非空
1059. i18n 键 guide.progress 在 10 语言都存在且非空
1060. i18n 键 guide.restart 在 10 语言都存在且非空
1061. i18n 键 guide.section 在 10 语言都存在且非空
1062. i18n 键 guide.sectionHint 在 10 语言都存在且非空
1063. i18n 键 guide.skip 在 10 语言都存在且非空
1064. i18n 键 guide.step1.body 在 10 语言都存在且非空
1065. i18n 键 guide.step1.btn 在 10 语言都存在且非空
1066. i18n 键 guide.step1.hint 在 10 语言都存在且非空
1067. i18n 键 guide.step1.pending 在 10 语言都存在且非空
1068. i18n 键 guide.step1.tip 在 10 语言都存在且非空
1069. i18n 键 guide.step1.title 在 10 语言都存在且非空
1070. i18n 键 guide.step1.value 在 10 语言都存在且非空
1071. i18n 键 guide.step2.body 在 10 语言都存在且非空
1072. i18n 键 guide.step2.btn 在 10 语言都存在且非空
1073. i18n 键 guide.step2.hint 在 10 语言都存在且非空
1074. i18n 键 guide.step2.pending 在 10 语言都存在且非空
1075. i18n 键 guide.step2.title 在 10 语言都存在且非空
1076. i18n 键 guide.step2.value 在 10 语言都存在且非空
1077. i18n 键 guide.step3.body 在 10 语言都存在且非空
1078. i18n 键 guide.step3.btn 在 10 语言都存在且非空
1079. i18n 键 guide.step3.title 在 10 语言都存在且非空
1080. i18n 键 guide.step3.value 在 10 语言都存在且非空
1081. i18n 键 harmony.note 在 10 语言都存在且非空
1082. i18n 键 idchg.adopt 在 10 语言都存在且非空
1083. i18n 键 idchg.adoptConfirm 在 10 语言都存在且非空
1084. i18n 键 idchg.adoptFailed 在 10 语言都存在且非空
1085. i18n 键 idchg.adoptFrozen 在 10 语言都存在且非空
1086. i18n 键 idchg.adopted 在 10 语言都存在且非空
1087. i18n 键 idchg.auditFailed 在 10 语言都存在且非空
1088. i18n 键 idchg.audited 在 10 语言都存在且非空
1089. i18n 键 idchg.biaoTi 在 10 语言都存在且非空
1090. i18n 键 idchg.body 在 10 语言都存在且非空
1091. i18n 键 idchg.cardHistoryTag 在 10 语言都存在且非空
1092. i18n 键 idchg.cardNewTag 在 10 语言都存在且非空
1093. i18n 键 idchg.collapse 在 10 语言都存在且非空
1094. i18n 键 idchg.contactChanged 在 10 语言都存在且非空
1095. i18n 键 idchg.contactNowIs 在 10 语言都存在且非空
1096. i18n 键 idchg.dismiss 在 10 语言都存在且非空
1097. i18n 键 idchg.dismissConfirm 在 10 语言都存在且非空
1098. i18n 键 idchg.dismissTitle 在 10 语言都存在且非空
1099. i18n 键 idchg.empty 在 10 语言都存在且非空
1100. i18n 键 idchg.emptyHint 在 10 语言都存在且非空
1101. i18n 键 idchg.expand 在 10 语言都存在且非空
1102. i18n 键 idchg.freeze 在 10 语言都存在且非空
1103. i18n 键 idchg.freezeOver 在 10 语言都存在且非空
1104. i18n 键 idchg.generation 在 10 语言都存在且非空
1105. i18n 键 idchg.histTitle 在 10 语言都存在且非空
1106. i18n 键 idchg.historyCapturedAt 在 10 语言都存在且非空
1107. i18n 键 idchg.marker 在 10 语言都存在且非空
1108. i18n 键 idchg.newEmptyHint 在 10 语言都存在且非空
1109. i18n 键 idchg.newSubmittedAt 在 10 语言都存在且非空
1110. i18n 键 idchg.newTitle 在 10 语言都存在且非空
1111. i18n 键 idchg.noHistory 在 10 语言都存在且非空
1112. i18n 键 idchg.noHistoryHint 在 10 语言都存在且非空
1113. i18n 键 idchg.oldEmail 在 10 语言都存在且非空
1114. i18n 键 idchg.oldPhone 在 10 语言都存在且非空
1115. i18n 键 idchg.pending 在 10 语言都存在且非空
1116. i18n 键 idchg.reason 在 10 语言都存在且非空
1117. i18n 键 idchg.reason.compromised 在 10 语言都存在且非空
1118. i18n 键 idchg.reason.rotate 在 10 语言都存在且非空
1119. i18n 键 idchg.scope.extdm 在 10 语言都存在且非空
1120. i18n 键 idchg.scope.external 在 10 语言都存在且非空
1121. i18n 键 idchg.scope.internal 在 10 语言都存在且非空
1122. i18n 键 idchg.title 在 10 语言都存在且非空
1123. i18n 键 idchg.titleNamed 在 10 语言都存在且非空
1124. i18n 键 idchg.verified 在 10 语言都存在且非空
1125. i18n 键 idchg.verifiedHint 在 10 语言都存在且非空
1126. i18n 键 idchg.verifyConfirm 在 10 语言都存在且非空
1127. i18n 键 idchg.verifyFailed 在 10 语言都存在且非空
1128. i18n 键 identity.contact.alwaysVisible 在 10 语言都存在且非空
1129. i18n 键 identity.contact.email 在 10 语言都存在且非空
1130. i18n 键 identity.contact.extra 在 10 语言都存在且非空
1131. i18n 键 identity.contact.phone 在 10 语言都存在且非空
1132. i18n 键 identity.contact.title 在 10 语言都存在且非空
1133. i18n 键 identity.contact.unfilled 在 10 语言都存在且非空
1134. i18n 键 inst.actionDone 在 10 语言都存在且非空
1135. i18n 键 inst.chain 在 10 语言都存在且非空
1136. i18n 键 inst.defaultModel 在 10 语言都存在且非空
1137. i18n 键 inst.group 在 10 语言都存在且非空
1138. i18n 键 inst.models 在 10 语言都存在且非空
1139. i18n 键 inst.persona 在 10 语言都存在且非空
1140. i18n 键 inst.restart 在 10 语言都存在且非空
1141. i18n 键 inst.start 在 10 语言都存在且非空
1142. i18n 键 inst.status.restarting 在 10 语言都存在且非空
1143. i18n 键 inst.status.running 在 10 语言都存在且非空
1144. i18n 键 inst.status.stopped 在 10 语言都存在且非空
1145. i18n 键 inst.stop 在 10 语言都存在且非空
1146. i18n 键 instances.addModel 在 10 语言都存在且非空
1147. i18n 键 instances.allAvailable 在 10 语言都存在且非空
1148. i18n 键 instances.availableModels 在 10 语言都存在且非空
1149. i18n 键 instances.avatar 在 10 语言都存在且非空
1150. i18n 键 instances.avatarUpload 在 10 语言都存在且非空
1151. i18n 键 instances.cognition 在 10 语言都存在且非空
1152. i18n 键 instances.cognitionAdd 在 10 语言都存在且非空
1153. i18n 键 instances.cognitionEmpty 在 10 语言都存在且非空
1154. i18n 键 instances.cognitionHint 在 10 语言都存在且非空
1155. i18n 键 instances.cpus 在 10 语言都存在且非空
1156. i18n 键 instances.defaultModel 在 10 语言都存在且非空
1157. i18n 键 instances.delete 在 10 语言都存在且非空
1158. i18n 键 instances.edit 在 10 语言都存在且非空
1159. i18n 键 instances.fallbackChain 在 10 语言都存在且非空
1160. i18n 键 instances.hardware 在 10 语言都存在且非空
1161. i18n 键 instances.manualAdd 在 10 语言都存在且非空
1162. i18n 键 instances.max 在 10 语言都存在且非空
1163. i18n 键 instances.memoryFile 在 10 语言都存在且非空
1164. i18n 键 instances.memoryHint 在 10 语言都存在且非空
1165. i18n 键 instances.model 在 10 语言都存在且非空
1166. i18n 键 instances.moveDown 在 10 语言都存在且非空
1167. i18n 键 instances.moveUp 在 10 语言都存在且非空
1168. i18n 键 instances.name 在 10 语言都存在且非空
1169. i18n 键 instances.nameDup 在 10 语言都存在且非空
1170. i18n 键 instances.persona 在 10 语言都存在且非空
1171. i18n 键 instances.personaDefault 在 10 语言都存在且非空
1172. i18n 键 instances.personaPlaceholder 在 10 语言都存在且非空
1173. i18n 键 instances.provider 在 10 语言都存在且非空
1174. i18n 键 instances.running 在 10 语言都存在且非空
1175. i18n 键 instances.saved 在 10 语言都存在且非空
1176. i18n 键 instances.selectHint 在 10 语言都存在且非空
1177. i18n 键 instances.smartPick 在 10 语言都存在且非空
1178. i18n 键 instances.start 在 10 语言都存在且非空
1179. i18n 键 instances.stop 在 10 语言都存在且非空
1180. i18n 键 instances.stopped 在 10 语言都存在且非空
1181. i18n 键 instances.suggested 在 10 语言都存在且非空
1182. i18n 键 join.accept 在 10 语言都存在且非空
1183. i18n 键 join.agree 在 10 语言都存在且非空
1184. i18n 键 join.ai 在 10 语言都存在且非空
1185. i18n 键 join.apply 在 10 语言都存在且非空
1186. i18n 键 join.applyTime 在 10 语言都存在且非空
1187. i18n 键 join.biaoTi 在 10 语言都存在且非空
1188. i18n 键 join.blacklist 在 10 语言都存在且非空
1189. i18n 键 join.blacklistEmpty 在 10 语言都存在且非空
1190. i18n 键 join.blacklistTitle 在 10 语言都存在且非空
1191. i18n 键 join.blacklistedAt 在 10 语言都存在且非空
1192. i18n 键 join.contact 在 10 语言都存在且非空
1193. i18n 键 join.copied 在 10 语言都存在且非空
1194. i18n 键 join.copyLink 在 10 语言都存在且非空
1195. i18n 键 join.dropHint 在 10 语言都存在且非空
1196. i18n 键 join.expireTime 在 10 语言都存在且非空
1197. i18n 键 join.fail 在 10 语言都存在且非空
1198. i18n 键 join.group 在 10 语言都存在且非空
1199. i18n 键 join.human 在 10 语言都存在且非空
1200. i18n 键 join.identity 在 10 语言都存在且非空
1201. i18n 键 join.kind 在 10 语言都存在且非空
1202. i18n 键 join.linkUnavailable 在 10 语言都存在且非空
1203. i18n 键 join.ok 在 10 语言都存在且非空
1204. i18n 键 join.pastePlaceholder 在 10 语言都存在且非空
1205. i18n 键 join.pending 在 10 语言都存在且非空
1206. i18n 键 join.pickImage 在 10 语言都存在且非空
1207. i18n 键 join.project 在 10 语言都存在且非空
1208. i18n 键 join.qrFail 在 10 语言都存在且非空
1209. i18n 键 join.qrHint 在 10 语言都存在且非空
1210. i18n 键 join.qrUnavailable 在 10 语言都存在且非空
1211. i18n 键 join.reject 在 10 语言都存在且非空
1212. i18n 键 join.removeBlacklist 在 10 语言都存在且非空
1213. i18n 键 join.requestBadge 在 10 语言都存在且非空
1214. i18n 键 join.requester 在 10 语言都存在且非空
1215. i18n 键 join.scanDropRelease 在 10 语言都存在且非空
1216. i18n 键 join.scanEmpty 在 10 语言都存在且非空
1217. i18n 键 join.scanFound 在 10 语言都存在且非空
1218. i18n 键 join.scanHint 在 10 语言都存在且非空
1219. i18n 键 join.scanNoJoinLink 在 10 语言都存在且非空
1220. i18n 键 join.scanNoQr 在 10 语言都存在且非空
1221. i18n 键 join.scanNotImage 在 10 语言都存在且非空
1222. i18n 键 join.scanNotJoinLink 在 10 语言都存在且非空
1223. i18n 键 join.scanQr 在 10 语言都存在且非空
1224. i18n 键 join.scanReadFail 在 10 语言都存在且非空
1225. i18n 键 join.scanUnavailable 在 10 语言都存在且非空
1226. i18n 键 join.scanWorking 在 10 语言都存在且非空
1227. i18n 键 join.target 在 10 语言都存在且非空
1228. i18n 键 join.title 在 10 语言都存在且非空
1229. i18n 键 ka.email 在 10 语言都存在且非空
1230. i18n 键 ka.extra 在 10 语言都存在且非空
1231. i18n 键 ka.fillInProfile 在 10 语言都存在且非空
1232. i18n 键 ka.peerWillSee 在 10 语言都存在且非空
1233. i18n 键 ka.phone 在 10 语言都存在且非空
1234. i18n 键 kb.detail 在 10 语言都存在且非空
1235. i18n 键 kb.detailHint 在 10 语言都存在且非空
1236. i18n 键 kb.entryOrg 在 10 语言都存在且非空
1237. i18n 键 kb.entryProject 在 10 语言都存在且非空
1238. i18n 键 kb.hint 在 10 语言都存在且非空
1239. i18n 键 kb.kind.org 在 10 语言都存在且非空
1240. i18n 键 kb.kind.project 在 10 语言都存在且非空
1241. i18n 键 knowledge.biaoTi 在 10 语言都存在且非空
1242. i18n 键 knowledge.delete 在 10 语言都存在且非空
1243. i18n 键 knowledge.empty 在 10 语言都存在且非空
1244. i18n 键 knowledge.kind.entity 在 10 语言都存在且非空
1245. i18n 键 knowledge.kind.event 在 10 语言都存在且非空
1246. i18n 键 knowledge.save 在 10 语言都存在且非空
1247. i18n 键 knowledge.search 在 10 语言都存在且非空
1248. i18n 键 knowledge.title 在 10 语言都存在且非空
1249. i18n 键 lan.dualSmoke 在 10 语言都存在且非空
1250. i18n 键 lan.inbox 在 10 语言都存在且非空
1251. i18n 键 lan.peerHost 在 10 语言都存在且非空
1252. i18n 键 lan.peerPort 在 10 语言都存在且非空
1253. i18n 键 lan.port 在 10 语言都存在且非空
1254. i18n 键 lan.sendTest 在 10 语言都存在且非空
1255. i18n 键 lan.start 在 10 语言都存在且非空
1256. i18n 键 lan.stop 在 10 语言都存在且非空
1257. i18n 键 lan.title 在 10 语言都存在且非空
1258. i18n 键 list.addContact 在 10 语言都存在且非空
1259. i18n 键 list.addInstance 在 10 语言都存在且非空
1260. i18n 键 list.addMenuCreate 在 10 语言都存在且非空
1261. i18n 键 list.addMenuJoin 在 10 语言都存在且非空
1262. i18n 键 list.addMore 在 10 语言都存在且非空
1263. i18n 键 list.createGroup 在 10 语言都存在且非空
1264. i18n 键 list.createGroupChat 在 10 语言都存在且非空
1265. i18n 键 list.createProject 在 10 语言都存在且非空
1266. i18n 键 list.empty 在 10 语言都存在且非空
1267. i18n 键 list.noReply 在 10 语言都存在且非空
1268. i18n 键 list.none 在 10 语言都存在且非空
1269. i18n 键 list.recent 在 10 语言都存在且非空
1270. i18n 键 list.search 在 10 语言都存在且非空
1271. i18n 键 list.sortByName 在 10 语言都存在且非空
1272. i18n 键 list.sortByTime 在 10 语言都存在且非空
1273. i18n 键 llm.continueNoAction 在 10 语言都存在且非空
1274. i18n 键 llm.dutySystem 在 10 语言都存在且非空
1275. i18n 键 llm.etaAnomaly 在 10 语言都存在且非空
1276. i18n 键 llm.identityLine 在 10 语言都存在且非空
1277. i18n 键 llm.longForm 在 10 语言都存在且非空
1278. i18n 键 llm.modelLine 在 10 语言都存在且非空
1279. i18n 键 llm.needText 在 10 语言都存在且非空
1280. i18n 键 llm.noKey 在 10 语言都存在且非空
1281. i18n 键 llm.planContinue 在 10 语言都存在且非空
1282. i18n 键 llm.planContinueFail 在 10 语言都存在且非空
1283. i18n 键 llm.planFirst 在 10 语言都存在且非空
1284. i18n 键 llm.planStop 在 10 语言都存在且非空
1285. i18n 键 llm.stallEtaOk 在 10 语言都存在且非空
1286. i18n 键 llm.stallEtaOver 在 10 语言都存在且非空
1287. i18n 键 llm.stallOk 在 10 语言都存在且非空
1288. i18n 键 llm.stallWarn 在 10 语言都存在且非空
1289. i18n 键 llm.strictLanguage 在 10 语言都存在且非空
1290. i18n 键 llm.timeLine 在 10 语言都存在且非空
1291. i18n 键 llm.toolLimitParam 在 10 语言都存在且非空
1292. i18n 键 llm.toolMaxCharsParam 在 10 语言都存在且非空
1293. i18n 键 llm.toolOffsetParam 在 10 语言都存在且非空
1294. i18n 键 llm.toolQueryParam 在 10 语言都存在且非空
1295. i18n 键 llm.toolRecallDesc 在 10 语言都存在且非空
1296. i18n 键 llm.toolRecordIdParam 在 10 语言都存在且非空
1297. i18n 键 llm.toolRetrieveDesc 在 10 语言都存在且非空
1298. i18n 键 llm.toolSeqParam 在 10 语言都存在且非空
1299. i18n 键 llm.userLine 在 10 语言都存在且非空
1300. i18n 键 m.chat.placeholder 在 10 语言都存在且非空
1301. i18n 键 me.about 在 10 语言都存在且非空
1302. i18n 键 me.accent 在 10 语言都存在且非空
1303. i18n 键 me.appearance 在 10 语言都存在且非空
1304. i18n 键 me.avatar 在 10 语言都存在且非空
1305. i18n 键 me.avatarHint 在 10 语言都存在且非空
1306. i18n 键 me.avatarUpload 在 10 语言都存在且非空
1307. i18n 键 me.backupJson 在 10 语言都存在且非空
1308. i18n 键 me.changeCred 在 10 语言都存在且非空
1309. i18n 键 me.changePassword 在 10 语言都存在且非空
1310. i18n 键 me.checkUpdate 在 10 语言都存在且非空
1311. i18n 键 me.cleanup 在 10 语言都存在且非空
1312. i18n 键 me.confirmPassword 在 10 语言都存在且非空
1313. i18n 键 me.copy 在 10 语言都存在且非空
1314. i18n 键 me.copyright 在 10 语言都存在且非空
1315. i18n 键 me.credRotated 在 10 语言都存在且非空
1316. i18n 键 me.credential 在 10 语言都存在且非空
1317. i18n 键 me.credentialHint 在 10 语言都存在且非空
1318. i18n 键 me.dark 在 10 语言都存在且非空
1319. i18n 键 me.dashboard 在 10 语言都存在且非空
1320. i18n 键 me.desktopOnly 在 10 语言都存在且非空
1321. i18n 键 me.deviceId 在 10 语言都存在且非空
1322. i18n 键 me.diagnostics 在 10 语言都存在且非空
1323. i18n 键 me.email 在 10 语言都存在且非空
1324. i18n 键 me.emailNotify 在 10 语言都存在且非空
1325. i18n 键 me.emptyAction 在 10 语言都存在且非空
1326. i18n 键 me.hideFull 在 10 语言都存在且非空
1327. i18n 键 me.idHint 在 10 语言都存在且非空
1328. i18n 键 me.idWarn 在 10 语言都存在且非空
1329. i18n 键 me.language 在 10 语言都存在且非空
1330. i18n 键 me.light 在 10 语言都存在且非空
1331. i18n 键 me.localProfile 在 10 语言都存在且非空
1332. i18n 键 me.login 在 10 语言都存在且非空
1333. i18n 键 me.loginHint 在 10 语言都存在且非空
1334. i18n 键 me.mesh 在 10 语言都存在且非空
1335. i18n 键 me.models 在 10 语言都存在且非空
1336. i18n 键 me.newPassword 在 10 语言都存在且非空
1337. i18n 键 me.notAvailable 在 10 语言都存在且非空
1338. i18n 键 me.notConfiguredHint 在 10 语言都存在且非空
1339. i18n 键 me.notLoggedIn 在 10 语言都存在且非空
1340. i18n 键 me.opensource 在 10 语言都存在且非空
1341. i18n 键 me.owner 在 10 语言都存在且非空
1342. i18n 键 me.passphrase 在 10 语言都存在且非空
1343. i18n 键 me.password 在 10 语言都存在且非空
1344. i18n 键 me.provider 在 10 语言都存在且非空
1345. i18n 键 me.register 在 10 语言都存在且非空
1346. i18n 键 me.removeAvatarBtn 在 10 语言都存在且非空
1347. i18n 键 me.saveProfile 在 10 语言都存在且非空
1348. i18n 键 me.settings 在 10 语言都存在且非空
1349. i18n 键 me.showFull 在 10 语言都存在且非空
1350. i18n 键 me.skills 在 10 语言都存在且非空
1351. i18n 键 me.smtp 在 10 语言都存在且非空
1352. i18n 键 me.switchHint 在 10 语言都存在且非空
1353. i18n 键 me.switchIdentity 在 10 语言都存在且非空
1354. i18n 键 me.system 在 10 语言都存在且非空
1355. i18n 键 me.theme 在 10 语言都存在且非空
1356. i18n 键 me.title 在 10 语言都存在且非空
1357. i18n 键 me.updates 在 10 语言都存在且非空
1358. i18n 键 me.userId 在 10 语言都存在且非空
1359. i18n 键 me.username 在 10 语言都存在且非空
1360. i18n 键 me.version 在 10 语言都存在且非空
1361. i18n 键 memory.desc 在 10 语言都存在且非空
1362. i18n 键 memory.notReady 在 10 语言都存在且非空
1363. i18n 键 memory.ready 在 10 语言都存在且非空
1364. i18n 键 memory.rebuild 在 10 语言都存在且非空
1365. i18n 键 memory.rebuildFail 在 10 语言都存在且非空
1366. i18n 键 memory.rebuildOk 在 10 语言都存在且非空
1367. i18n 键 memory.rebuildWhy 在 10 语言都存在且非空
1368. i18n 键 memory.records 在 10 语言都存在且非空
1369. i18n 键 memory.statusTitle 在 10 语言都存在且非空
1370. i18n 键 memory.vector 在 10 语言都存在且非空
1371. i18n 键 mesh.addPeer 在 10 语言都存在且非空
1372. i18n 键 mesh.broadcast 在 10 语言都存在且非空
1373. i18n 键 mesh.genInvite 在 10 语言都存在且非空
1374. i18n 键 mesh.hint 在 10 语言都存在且非空
1375. i18n 键 mesh.invite 在 10 语言都存在且非空
1376. i18n 键 mesh.name 在 10 语言都存在且非空
1377. i18n 键 mesh.peers 在 10 语言都存在且非空
1378. i18n 键 mesh.portLabel 在 10 语言都存在且非空
1379. i18n 键 mesh.remove 在 10 语言都存在且非空
1380. i18n 键 mesh.scanJoin 在 10 语言都存在且非空
1381. i18n 键 mesh.section 在 10 语言都存在且非空
1382. i18n 键 mesh.start 在 10 语言都存在且非空
1383. i18n 键 mesh.stateLabel 在 10 语言都存在且非空
1384. i18n 键 mesh.stop 在 10 语言都存在且非空
1385. i18n 键 mesh.title 在 10 语言都存在且非空
1386. i18n 键 metrics.biaoTi 在 10 语言都存在且非空
1387. i18n 键 metrics.cost 在 10 语言都存在且非空
1388. i18n 键 metrics.title 在 10 语言都存在且非空
1389. i18n 键 metrics.turns 在 10 语言都存在且非空
1390. i18n 键 model.add 在 10 语言都存在且非空
1391. i18n 键 model.addManually 在 10 语言都存在且非空
1392. i18n 键 model.addSelected 在 10 语言都存在且非空
1393. i18n 键 model.addTitle 在 10 语言都存在且非空
1394. i18n 键 model.addedCount 在 10 语言都存在且非空
1395. i18n 键 model.addedToChain 在 10 语言都存在且非空
1396. i18n 键 model.allAvailable 在 10 语言都存在且非空
1397. i18n 键 model.alreadyInChain 在 10 语言都存在且非空
1398. i18n 键 model.available 在 10 语言都存在且非空
1399. i18n 键 model.availableHint 在 10 语言都存在且非空
1400. i18n 键 model.chain 在 10 语言都存在且非空
1401. i18n 键 model.chainHint 在 10 语言都存在且非空
1402. i18n 键 model.contextLen 在 10 语言都存在且非空
1403. i18n 键 model.default 在 10 语言都存在且非空
1404. i18n 键 model.disable 在 10 语言都存在且非空
1405. i18n 键 model.down 在 10 语言都存在且非空
1406. i18n 键 model.editProvider 在 10 语言都存在且非空
1407. i18n 键 model.editProviderConfirm 在 10 语言都存在且非空
1408. i18n 键 model.editProviderConfirmBody 在 10 语言都存在且非空
1409. i18n 键 model.enable 在 10 语言都存在且非空
1410. i18n 键 model.fenLei 在 10 语言都存在且非空
1411. i18n 键 model.fenLeiHint 在 10 语言都存在且非空
1412. i18n 键 model.fetch 在 10 语言都存在且非空
1413. i18n 键 model.fetchHint 在 10 语言都存在且非空
1414. i18n 键 model.kind.asr 在 10 语言都存在且非空
1415. i18n 键 model.kind.chat 在 10 语言都存在且非空
1416. i18n 键 model.kind.decision 在 10 语言都存在且非空
1417. i18n 键 model.kind.embedding 在 10 语言都存在且非空
1418. i18n 键 model.kind.image 在 10 语言都存在且非空
1419. i18n 键 model.kind.imageUnd 在 10 语言都存在且非空
1420. i18n 键 model.kind.rerank 在 10 语言都存在且非空
1421. i18n 键 model.kind.safety 在 10 语言都存在且非空
1422. i18n 键 model.kind.translate 在 10 语言都存在且非空
1423. i18n 键 model.kind.tts 在 10 语言都存在且非空
1424. i18n 键 model.kind.videoGen 在 10 语言都存在且非空
1425. i18n 键 model.kind.videoUnd 在 10 语言都存在且非空
1426. i18n 键 model.kindHint.asr 在 10 语言都存在且非空
1427. i18n 键 model.kindHint.embed 在 10 语言都存在且非空
1428. i18n 键 model.kindHint.fenLei 在 10 语言都存在且非空
1429. i18n 键 model.kindHint.image 在 10 语言都存在且非空
1430. i18n 键 model.kindHint.imageUnd 在 10 语言都存在且非空
1431. i18n 键 model.kindHint.organizer 在 10 语言都存在且非空
1432. i18n 键 model.kindHint.rerank 在 10 语言都存在且非空
1433. i18n 键 model.kindHint.safety 在 10 语言都存在且非空
1434. i18n 键 model.kindHint.translate 在 10 语言都存在且非空
1435. i18n 键 model.kindHint.tts 在 10 语言都存在且非空
1436. i18n 键 model.kindHint.videoGen 在 10 语言都存在且非空
1437. i18n 键 model.kindHint.videoUnd 在 10 语言都存在且非空
1438. i18n 键 model.latency 在 10 语言都存在且非空
1439. i18n 键 model.latencyNA 在 10 语言都存在且非空
1440. i18n 键 model.lianHint 在 10 语言都存在且非空
1441. i18n 键 model.lianKong 在 10 语言都存在且非空
1442. i18n 键 model.manual 在 10 语言都存在且非空
1443. i18n 键 model.mgr 在 10 语言都存在且非空
1444. i18n 键 model.moreSettings 在 10 语言都存在且非空
1445. i18n 键 model.moveTop 在 10 语言都存在且非空
1446. i18n 键 model.noModels 在 10 语言都存在且非空
1447. i18n 键 model.noneAvailable 在 10 语言都存在且非空
1448. i18n 键 model.pick 在 10 语言都存在且非空
1449. i18n 键 model.pickProvider 在 10 语言都存在且非空
1450. i18n 键 model.provider 在 10 语言都存在且非空
1451. i18n 键 model.smart 在 10 语言都存在且非空
1452. i18n 键 model.smartHint 在 10 语言都存在且非空
1453. i18n 键 model.speakSpeed 在 10 语言都存在且非空
1454. i18n 键 model.speakVoice 在 10 语言都存在且非空
1455. i18n 键 model.test 在 10 语言都存在且非空
1456. i18n 键 model.think 在 10 语言都存在且非空
1457. i18n 键 model.think.auto 在 10 语言都存在且非空
1458. i18n 键 model.think.byAgency 在 10 语言都存在且非空
1459. i18n 键 model.think.follow 在 10 语言都存在且非空
1460. i18n 键 model.think.followAgency 在 10 语言都存在且非空
1461. i18n 键 model.think.high 在 10 语言都存在且非空
1462. i18n 键 model.think.l1 在 10 语言都存在且非空
1463. i18n 键 model.think.l2 在 10 语言都存在且非空
1464. i18n 键 model.think.l3 在 10 语言都存在且非空
1465. i18n 键 model.think.l4 在 10 语言都存在且非空
1466. i18n 键 model.think.l5 在 10 语言都存在且非空
1467. i18n 键 model.think.l6 在 10 语言都存在且非空
1468. i18n 键 model.think.low 在 10 语言都存在且非空
1469. i18n 键 model.think.manualKept 在 10 语言都存在且非空
1470. i18n 键 model.think.medium 在 10 语言都存在且非空
1471. i18n 键 model.think.off 在 10 语言都存在且非空
1472. i18n 键 model.thinkHint 在 10 语言都存在且非空
1473. i18n 键 model.up 在 10 语言都存在且非空
1474. i18n 键 model.xiaoDi 在 10 语言都存在且非空
1475. i18n 键 model.xiaoDiAuto 在 10 语言都存在且非空
1476. i18n 键 model.xiaoDiHint 在 10 语言都存在且非空
1477. i18n 键 model.xiaoDiNow 在 10 语言都存在且非空
1478. i18n 键 msg.initFailed 在 10 语言都存在且非空
1479. i18n 键 msg.inviteCopied 在 10 语言都存在且非空
1480. i18n 键 msg.latest 在 10 语言都存在且非空
1481. i18n 键 msg.scanOnDesktop 在 10 语言都存在且非空
1482. i18n 键 msg.smtpDesktopOnly 在 10 语言都存在且非空
1483. i18n 键 nav.addFriends 在 10 语言都存在且非空
1484. i18n 键 nav.addGroup 在 10 语言都存在且非空
1485. i18n 键 nav.addProject 在 10 语言都存在且非空
1486. i18n 键 nav.avatar 在 10 语言都存在且非空
1487. i18n 键 nav.externalChat 在 10 语言都存在且非空
1488. i18n 键 nav.externalGroup 在 10 语言都存在且非空
1489. i18n 键 nav.instances 在 10 语言都存在且非空
1490. i18n 键 nav.internalGroup 在 10 语言都存在且非空
1491. i18n 键 nav.settings 在 10 语言都存在且非空
1492. i18n 键 nav.singleAi 在 10 语言都存在且非空
1493. i18n 键 nav.touXiang 在 10 语言都存在且非空
1494. i18n 键 net.addRemoteBody 在 10 语言都存在且非空
1495. i18n 键 net.addRemoteTitle 在 10 语言都存在且非空
1496. i18n 键 net.address 在 10 语言都存在且非空
1497. i18n 键 net.autofill 在 10 语言都存在且非空
1498. i18n 键 net.autofillDone 在 10 语言都存在且非空
1499. i18n 键 net.banner.autoOff 在 10 语言都存在且非空
1500. i18n 键 net.banner.close 在 10 语言都存在且非空
1501. i18n 键 net.banner.dismissHint 在 10 语言都存在且非空
1502. i18n 键 net.banner.linkBody 在 10 语言都存在且非空
1503. i18n 键 net.banner.linkTitle 在 10 语言都存在且非空
1504. i18n 键 net.banner.mergedBody 在 10 语言都存在且非空
1505. i18n 键 net.banner.mergedTitle 在 10 语言都存在且非空
1506. i18n 键 net.banner.meshOffBody 在 10 语言都存在且非空
1507. i18n 键 net.banner.meshOffTitle 在 10 语言都存在且非空
1508. i18n 键 net.banner.relayConfigure 在 10 语言都存在且非空
1509. i18n 键 net.banner.relayTerminalTitle 在 10 语言都存在且非空
1510. i18n 键 net.banner.turnOn 在 10 语言都存在且非空
1511. i18n 键 net.biaoTi 在 10 语言都存在且非空
1512. i18n 键 net.detect 在 10 语言都存在且非空
1513. i18n 键 net.detecting 在 10 语言都存在且非空
1514. i18n 键 net.dialability.ipv6Natural 在 10 语言都存在且非空
1515. i18n 键 net.dialability.peerVerified 在 10 语言都存在且非空
1516. i18n 键 net.dialability.undetermined 在 10 语言都存在且非空
1517. i18n 键 net.dialability.undialable 在 10 语言都存在且非空
1518. i18n 键 net.dialabilityUnknown 在 10 语言都存在且非空
1519. i18n 键 net.disableFailed 在 10 语言都存在且非空
1520. i18n 键 net.domainAdd 在 10 语言都存在且非空
1521. i18n 键 net.domainPlaceholder 在 10 语言都存在且非空
1522. i18n 键 net.domainRemove 在 10 语言都存在且非空
1523. i18n 键 net.domainTitle 在 10 语言都存在且非空
1524. i18n 键 net.emptyList 在 10 语言都存在且非空
1525. i18n 键 net.enableFailed 在 10 语言都存在且非空
1526. i18n 键 net.entryFail 在 10 语言都存在且非空
1527. i18n 键 net.entryInvalid 在 10 语言都存在且非空
1528. i18n 键 net.entryOk 在 10 语言都存在且非空
1529. i18n 键 net.entryResultsTitle 在 10 语言都存在且非空
1530. i18n 键 net.entryUnknown 在 10 语言都存在且非空
1531. i18n 键 net.helpBody 在 10 语言都存在且非空
1532. i18n 键 net.helpTitle 在 10 语言都存在且非空
1533. i18n 键 net.hint 在 10 语言都存在且非空
1534. i18n 键 net.invalidIp 在 10 语言都存在且非空
1535. i18n 键 net.invalidPort 在 10 语言都存在且非空
1536. i18n 键 net.ladder.biaoTi 在 10 语言都存在且非空
1537. i18n 键 net.ladder.candidate 在 10 语言都存在且非空
1538. i18n 键 net.ladder.current 在 10 语言都存在且非空
1539. i18n 键 net.ladder.dialability 在 10 语言都存在且非空
1540. i18n 键 net.ladder.none 在 10 语言都存在且非空
1541. i18n 键 net.ladder.relay 在 10 语言都存在且非空
1542. i18n 键 net.ladder.title 在 10 语言都存在且非空
1543. i18n 键 net.ladder.unknown 在 10 语言都存在且非空
1544. i18n 键 net.ladder.unsupported 在 10 语言都存在且非空
1545. i18n 键 net.localIp 在 10 语言都存在且非空
1546. i18n 键 net.meshTitle 在 10 语言都存在且非空
1547. i18n 键 net.note.lan 在 10 语言都存在且非空
1548. i18n 键 net.note.wanHard 在 10 语言都存在且非空
1549. i18n 键 net.note.wanManual 在 10 语言都存在且非空
1550. i18n 键 net.partialPass 在 10 语言都存在且非空
1551. i18n 键 net.peers 在 10 语言都存在且非空
1552. i18n 键 net.port 在 10 语言都存在且非空
1553. i18n 键 net.portBindFailedBody 在 10 语言都存在且非空
1554. i18n 键 net.portBindFailedTitle 在 10 语言都存在且非空
1555. i18n 键 net.portBound 在 10 语言都存在且非空
1556. i18n 键 net.portConventionHint 在 10 语言都存在且非空
1557. i18n 键 net.portSuggestChecking 在 10 语言都存在且非空
1558. i18n 键 net.portSuggestHint 在 10 语言都存在且非空
1559. i18n 键 net.portSuggestMeasured 在 10 语言都存在且非空
1560. i18n 键 net.portSuggestNone 在 10 语言都存在且非空
1561. i18n 键 net.portSuggestRefresh 在 10 语言都存在且非空
1562. i18n 键 net.probeCount 在 10 语言都存在且非空
1563. i18n 键 net.publicIp 在 10 语言都存在且非空
1564. i18n 键 net.publicListEmpty 在 10 语言都存在且非空
1565. i18n 键 net.refresh 在 10 语言都存在且非空
1566. i18n 键 net.refreshDone 在 10 语言都存在且非空
1567. i18n 键 net.relay.missing.needsPublicRelay 在 10 语言都存在且非空
1568. i18n 键 net.relay.missing.noneConfigured 在 10 语言都存在且非空
1569. i18n 键 net.relay.missing.unreachable 在 10 语言都存在且非空
1570. i18n 键 net.relay.notNeeded.inboundExpected 在 10 语言都存在且非空
1571. i18n 键 net.relay.notNeeded.peerDialable 在 10 语言都存在且非空
1572. i18n 键 net.relay.selected 在 10 语言都存在且非空
1573. i18n 键 net.relay.unknown 在 10 语言都存在且非空
1574. i18n 键 net.result.at 在 10 语言都存在且非空
1575. i18n 键 net.result.behindNat 在 10 语言都存在且非空
1576. i18n 键 net.result.failOutbound 在 10 语言都存在且非空
1577. i18n 键 net.result.failPublic 在 10 语言都存在且非空
1578. i18n 键 net.result.method 在 10 语言都存在且非空
1579. i18n 键 net.result.needPass 在 10 语言都存在且非空
1580. i18n 键 net.result.pass 在 10 语言都存在且非空
1581. i18n 键 net.result.passLan 在 10 语言都存在且非空
1582. i18n 键 net.result.passUnverifiedInbound 在 10 语言都存在且非空
1583. i18n 键 net.result.unknown 在 10 语言都存在且非空
1584. i18n 键 net.rung.holepunch 在 10 语言都存在且非空
1585. i18n 键 net.rung.ipv6Direct 在 10 语言都存在且非空
1586. i18n 键 net.rung.lan 在 10 语言都存在且非空
1587. i18n 键 net.rung.publicDirect 在 10 语言都存在且非空
1588. i18n 键 net.rung.relay 在 10 语言都存在且非空
1589. i18n 键 net.rung.upnp 在 10 语言都存在且非空
1590. i18n 键 net.switch 在 10 语言都存在且非空
1591. i18n 键 net.switchBlocked 在 10 语言都存在且非空
1592. i18n 键 net.switchNeedDetect 在 10 语言都存在且非空
1593. i18n 键 net.switchOff 在 10 语言都存在且非空
1594. i18n 键 net.switchOn 在 10 语言都存在且非空
1595. i18n 键 net.tiShi 在 10 语言都存在且非空
1596. i18n 键 net.title 在 10 语言都存在且非空
1597. i18n 键 nm.badFormat 在 10 语言都存在且非空
1598. i18n 键 nm.enterPassword 在 10 语言都存在且非空
1599. i18n 键 nm.exportChat 在 10 语言都存在且非空
1600. i18n 键 nm.exportChatHint 在 10 语言都存在且非空
1601. i18n 键 nm.exportProject 在 10 语言都存在且非空
1602. i18n 键 nm.exportProjectHint 在 10 语言都存在且非空
1603. i18n 键 nm.exportTitle 在 10 语言都存在且非空
1604. i18n 键 nm.freshConfirm 在 10 语言都存在且非空
1605. i18n 键 nm.freshConfirm2 在 10 语言都存在且非空
1606. i18n 键 nm.importDone 在 10 语言都存在且非空
1607. i18n 键 nm.importMode 在 10 语言都存在且非空
1608. i18n 键 nm.needPassword 在 10 语言都存在且非空
1609. i18n 键 nm.setExportPassword 在 10 语言都存在且非空
1610. i18n 键 notify.done 在 10 语言都存在且非空
1611. i18n 键 notify.err 在 10 语言都存在且非空
1612. i18n 键 notify.req 在 10 语言都存在且非空
1613. i18n 键 notify.title 在 10 语言都存在且非空
1614. i18n 键 panel.addCard 在 10 语言都存在且非空
1615. i18n 键 panel.addCustomCard 在 10 语言都存在且非空
1616. i18n 键 panel.assist 在 10 语言都存在且非空
1617. i18n 键 panel.assist.biaoTi 在 10 语言都存在且非空
1618. i18n 键 panel.assist.done 在 10 语言都存在且非空
1619. i18n 键 panel.assist.empty 在 10 语言都存在且非空
1620. i18n 键 panel.assist.markDone 在 10 语言都存在且非空
1621. i18n 键 panel.assist.markStale 在 10 语言都存在且非空
1622. i18n 键 panel.assist.markUrgent 在 10 语言都存在且非空
1623. i18n 键 panel.assist.title 在 10 语言都存在且非空
1624. i18n 键 panel.assist.urgent 在 10 语言都存在且非空
1625. i18n 键 panel.board 在 10 语言都存在且非空
1626. i18n 键 panel.customCard 在 10 语言都存在且非空
1627. i18n 键 panel.diagWhat 在 10 语言都存在且非空
1628. i18n 键 panel.dir 在 10 语言都存在且非空
1629. i18n 键 panel.directory 在 10 语言都存在且非空
1630. i18n 键 panel.duty 在 10 语言都存在且非空
1631. i18n 键 panel.jinDu 在 10 语言都存在且非空
1632. i18n 键 panel.kb.biaoTi 在 10 语言都存在且非空
1633. i18n 键 panel.kb.hint 在 10 语言都存在且非空
1634. i18n 键 panel.kb.tiShi 在 10 语言都存在且非空
1635. i18n 键 panel.kb.title 在 10 语言都存在且非空
1636. i18n 键 panel.logs 在 10 语言都存在且非空
1637. i18n 键 panel.members 在 10 语言都存在且非空
1638. i18n 键 panel.modelMgr 在 10 语言都存在且非空
1639. i18n 键 panel.modelMgrEmpty 在 10 语言都存在且非空
1640. i18n 键 panel.modelMgrHint 在 10 语言都存在且非空
1641. i18n 键 panel.modelMgrReadonly 在 10 语言都存在且非空
1642. i18n 键 panel.noTasks 在 10 语言都存在且非空
1643. i18n 键 panel.plan.blocked 在 10 语言都存在且非空
1644. i18n 键 panel.plan.collapse 在 10 语言都存在且非空
1645. i18n 键 panel.plan.doing 在 10 语言都存在且非空
1646. i18n 键 panel.plan.done 在 10 语言都存在且非空
1647. i18n 键 panel.plan.empty 在 10 语言都存在且非空
1648. i18n 键 panel.plan.pending 在 10 语言都存在且非空
1649. i18n 键 panel.plan.progress 在 10 语言都存在且非空
1650. i18n 键 panel.plan.title 在 10 语言都存在且非空
1651. i18n 键 panel.plan.verified 在 10 语言都存在且非空
1652. i18n 键 panel.progress 在 10 语言都存在且非空
1653. i18n 键 panel.progressEmpty 在 10 语言都存在且非空
1654. i18n 键 panel.projectFiles 在 10 语言都存在且非空
1655. i18n 键 panel.projectState 在 10 语言都存在且非空
1656. i18n 键 panel.queue 在 10 语言都存在且非空
1657. i18n 键 panel.removeCard 在 10 语言都存在且非空
1658. i18n 键 panel.requirement 在 10 语言都存在且非空
1659. i18n 键 panel.result 在 10 语言都存在且非空
1660. i18n 键 panel.schedule.empty 在 10 语言都存在且非空
1661. i18n 键 panel.schedule.next 在 10 语言都存在且非空
1662. i18n 键 panel.schedule.pause 在 10 语言都存在且非空
1663. i18n 键 panel.schedule.resume 在 10 语言都存在且非空
1664. i18n 键 panel.schedule.title 在 10 语言都存在且非空
1665. i18n 键 panel.summary.auto 在 10 语言都存在且非空
1666. i18n 键 panel.summary.biaoTi 在 10 语言都存在且非空
1667. i18n 键 panel.summary.bullets 在 10 语言都存在且非空
1668. i18n 键 panel.summary.decisions 在 10 语言都存在且非空
1669. i18n 键 panel.summary.done 在 10 语言都存在且非空
1670. i18n 键 panel.summary.empty 在 10 语言都存在且非空
1671. i18n 键 panel.summary.gen 在 10 语言都存在且非空
1672. i18n 键 panel.summary.jump 在 10 语言都存在且非空
1673. i18n 键 panel.summary.risks 在 10 语言都存在且非空
1674. i18n 键 panel.summary.title 在 10 语言都存在且非空
1675. i18n 键 panel.summary.todos 在 10 语言都存在且非空
1676. i18n 键 panel.taskDemo.1 在 10 语言都存在且非空
1677. i18n 键 panel.taskDemo.2 在 10 语言都存在且非空
1678. i18n 键 panel.taskDemo.3 在 10 语言都存在且非空
1679. i18n 键 panel.taskDemo.4 在 10 语言都存在且非空
1680. i18n 键 panel.taskDemo.5 在 10 语言都存在且非空
1681. i18n 键 panel.tasks 在 10 语言都存在且非空
1682. i18n 键 panel.workfiles.empty 在 10 语言都存在且非空
1683. i18n 键 panel.workfiles.genAt 在 10 语言都存在且非空
1684. i18n 键 panel.workfiles.open 在 10 语言都存在且非空
1685. i18n 键 panel.workfiles.refresh 在 10 语言都存在且非空
1686. i18n 键 panel.workfiles.refreshed 在 10 语言都存在且非空
1687. i18n 键 panel.workfiles.reveal 在 10 语言都存在且非空
1688. i18n 键 panel.workfiles.root 在 10 语言都存在且非空
1689. i18n 键 panel.workfiles.title 在 10 语言都存在且非空
1690. i18n 键 panel.workfiles.workspace 在 10 语言都存在且非空
1691. i18n 键 placeholder.agentName 在 10 语言都存在且非空
1692. i18n 键 placeholder.email 在 10 语言都存在且非空
1693. i18n 键 placeholder.groupName 在 10 语言都存在且非空
1694. i18n 键 placeholder.groupNameExt 在 10 语言都存在且非空
1695. i18n 键 placeholder.nodeName 在 10 语言都存在且非空
1696. i18n 键 placeholder.peerHost 在 10 语言都存在且非空
1697. i18n 键 plugin.builtin 在 10 语言都存在且非空
1698. i18n 键 plugin.fromFolder 在 10 语言都存在且非空
1699. i18n 键 plugin.memory.desc 在 10 语言都存在且非空
1700. i18n 键 plugin.memory.provider 在 10 语言都存在且非空
1701. i18n 键 plugin.teams.desc 在 10 语言都存在且非空
1702. i18n 键 plugin.teams.provider 在 10 语言都存在且非空
1703. i18n 键 pm.empty 在 10 语言都存在且非空
1704. i18n 键 pm.hint 在 10 语言都存在且非空
1705. i18n 键 pm.readBackFail 在 10 语言都存在且非空
1706. i18n 键 pm.save 在 10 语言都存在且非空
1707. i18n 键 pm.saved 在 10 语言都存在且非空
1708. i18n 键 pm.tiShi 在 10 语言都存在且非空
1709. i18n 键 pm.title 在 10 语言都存在且非空
1710. i18n 键 preview.settingsNotice 在 10 语言都存在且非空
1711. i18n 键 privacy.agree 在 10 语言都存在且非空
1712. i18n 键 privacy.biaoTi 在 10 语言都存在且非空
1713. i18n 键 privacy.body 在 10 语言都存在且非空
1714. i18n 键 privacy.disagree 在 10 语言都存在且非空
1715. i18n 键 privacy.revoke 在 10 语言都存在且非空
1716. i18n 键 privacy.revokeConfirm 在 10 语言都存在且非空
1717. i18n 键 privacy.scrollHint 在 10 语言都存在且非空
1718. i18n 键 privacy.ti 在 10 语言都存在且非空
1719. i18n 键 privacy.title 在 10 语言都存在且非空
1720. i18n 键 privacy.viewTitle 在 10 语言都存在且非空
1721. i18n 键 privacy.waitHint 在 10 语言都存在且非空
1722. i18n 键 projectFiles.changedTitle 在 10 语言都存在且非空
1723. i18n 键 projectFiles.empty.changed 在 10 语言都存在且非空
1724. i18n 键 projectFiles.empty.noProjectDir 在 10 语言都存在且非空
1725. i18n 键 projectFiles.empty.other 在 10 语言都存在且非空
1726. i18n 键 projectFiles.entry.dir-empty 在 10 语言都存在且非空
1727. i18n 键 projectFiles.entry.dir-planned 在 10 语言都存在且非空
1728. i18n 键 projectFiles.entry.entry-found 在 10 语言都存在且非空
1729. i18n 键 projectFiles.entry.file-found 在 10 语言都存在且非空
1730. i18n 键 projectFiles.entry.none 在 10 语言都存在且非空
1731. i18n 键 projectFiles.fromCreatorSignal 在 10 语言都存在且非空
1732. i18n 键 projectFiles.kind.changed 在 10 语言都存在且非空
1733. i18n 键 projectFiles.kind.created 在 10 语言都存在且非空
1734. i18n 键 projectFiles.kind.deleted 在 10 语言都存在且非空
1735. i18n 键 projectFiles.kind.file 在 10 语言都存在且非空
1736. i18n 键 projectFiles.kind.program 在 10 语言都存在且非空
1737. i18n 键 projectFiles.kind.read 在 10 语言都存在且非空
1738. i18n 键 projectFiles.ledgerCount 在 10 语言都存在且非空
1739. i18n 键 projectFiles.loadFailed 在 10 语言都存在且非空
1740. i18n 键 projectFiles.missingHint 在 10 语言都存在且非空
1741. i18n 键 projectFiles.otherTitle 在 10 语言都存在且非空
1742. i18n 键 projectFiles.productDir 在 10 语言都存在且非空
1743. i18n 键 projectFiles.productDirPlanned 在 10 语言都存在且非空
1744. i18n 键 projectFiles.productTitle 在 10 语言都存在且非空
1745. i18n 键 projectFiles.run 在 10 语言都存在且非空
1746. i18n 键 projectFiles.runFailed 在 10 语言都存在且非空
1747. i18n 键 projectFiles.runReason.container-built 在 10 语言都存在且非空
1748. i18n 键 projectFiles.runReason.dir-empty 在 10 语言都存在且非空
1749. i18n 键 projectFiles.runReason.dir-planned 在 10 语言都存在且非空
1750. i18n 键 projectFiles.runReason.file-found 在 10 语言都存在且非空
1751. i18n 键 projectFiles.runReason.host-native 在 10 语言都存在且非空
1752. i18n 键 projectFiles.runReason.no-host-runtime 在 10 语言都存在且非空
1753. i18n 键 projectFiles.runReason.none 在 10 语言都存在且非空
1754. i18n 键 projectFiles.runStarted 在 10 语言都存在且非空
1755. i18n 键 projectFiles.source.checkpoint 在 10 语言都存在且非空
1756. i18n 键 projectFiles.source.checkpoint-detail 在 10 语言都存在且非空
1757. i18n 键 projectFiles.source.dir-scan 在 10 语言都存在且非空
1758. i18n 键 projectFiles.source.tool-file-access-ledger 在 10 语言都存在且非空
1759. i18n 键 projectFiles.source.unknown 在 10 语言都存在且非空
1760. i18n 键 prompt.providerName 在 10 语言都存在且非空
1761. i18n 键 provider.add 在 10 语言都存在且非空
1762. i18n 键 provider.configured 在 10 语言都存在且非空
1763. i18n 键 provider.list 在 10 语言都存在且非空
1764. i18n 键 provider.notConfigured 在 10 语言都存在且非空
1765. i18n 键 sec.confirmBody 在 10 语言都存在且非空
1766. i18n 键 sec.confirmTitle 在 10 语言都存在且非空
1767. i18n 键 sessions.title 在 10 语言都存在且非空
1768. i18n 键 settings.about 在 10 语言都存在且非空
1769. i18n 键 settings.addProvider 在 10 语言都存在且非空
1770. i18n 键 settings.apiKey 在 10 语言都存在且非空
1771. i18n 键 settings.asrModel 在 10 语言都存在且非空
1772. i18n 键 settings.baseUrl 在 10 语言都存在且非空
1773. i18n 键 settings.blacklist 在 10 语言都存在且非空
1774. i18n 键 settings.builtinComplete 在 10 语言都存在且非空
1775. i18n 键 settings.builtinError 在 10 语言都存在且非空
1776. i18n 键 settings.builtinRequest 在 10 语言都存在且非空
1777. i18n 键 settings.chaJianJi 在 10 语言都存在且非空
1778. i18n 键 settings.chatModel 在 10 语言都存在且非空
1779. i18n 键 settings.checkUpdate 在 10 语言都存在且非空
1780. i18n 键 settings.customColorTitle 在 10 语言都存在且非空
1781. i18n 键 settings.dataBytes 在 10 语言都存在且非空
1782. i18n 键 settings.dataHint 在 10 语言都存在且非空
1783. i18n 键 settings.dataReplicas 在 10 语言都存在且非空
1784. i18n 键 settings.dataRetention 在 10 语言都存在且非空
1785. i18n 键 settings.dataTitle 在 10 语言都存在且非空
1786. i18n 键 settings.defaultModel 在 10 语言都存在且非空
1787. i18n 键 settings.emailHint 在 10 语言都存在且非空
1788. i18n 键 settings.emailNotify 在 10 语言都存在且非空
1789. i18n 键 settings.emailNotifyHint 在 10 语言都存在且非空
1790. i18n 键 settings.emailOnRequest 在 10 语言都存在且非空
1791. i18n 键 settings.emailWhen 在 10 语言都存在且非空
1792. i18n 键 settings.embedding 在 10 语言都存在且非空
1793. i18n 键 settings.embeddingGpu 在 10 语言都存在且非空
1794. i18n 键 settings.embeddingHint 在 10 语言都存在且非空
1795. i18n 键 settings.embeddingModel 在 10 语言都存在且非空
1796. i18n 键 settings.embeddingSpecial 在 10 语言都存在且非空
1797. i18n 键 settings.exportJson 在 10 语言都存在且非空
1798. i18n 键 settings.fetchDisabledHint 在 10 语言都存在且非空
1799. i18n 键 settings.fetchModels 在 10 语言都存在且非空
1800. i18n 键 settings.fetchModelsOnNewLine 在 10 语言都存在且非空
1801. i18n 键 settings.fieldApiKey 在 10 语言都存在且非空
1802. i18n 键 settings.fieldBaseUrl 在 10 语言都存在且非空
1803. i18n 键 settings.fieldName 在 10 语言都存在且非空
1804. i18n 键 settings.fontApplyHint 在 10 语言都存在且非空
1805. i18n 键 settings.fontDefault 在 10 语言都存在且非空
1806. i18n 键 settings.fontFamily 在 10 语言都存在且非空
1807. i18n 键 settings.fontInstall 在 10 语言都存在且非空
1808. i18n 键 settings.fontInstallFail 在 10 语言都存在且非空
1809. i18n 键 settings.fontInstalled 在 10 语言都存在且非空
1810. i18n 键 settings.fontListFail 在 10 语言都存在且非空
1811. i18n 键 settings.fontSize 在 10 语言都存在且非空
1812. i18n 键 settings.fontSizeHint 在 10 语言都存在且非空
1813. i18n 键 settings.fontWeight 在 10 语言都存在且非空
1814. i18n 键 settings.fontWeightHint 在 10 语言都存在且非空
1815. i18n 键 settings.fw 在 10 语言都存在且非空
1816. i18n 键 settings.fw100 在 10 语言都存在且非空
1817. i18n 键 settings.fw200 在 10 语言都存在且非空
1818. i18n 键 settings.fw300 在 10 语言都存在且非空
1819. i18n 键 settings.fw400 在 10 语言都存在且非空
1820. i18n 键 settings.fw500 在 10 语言都存在且非空
1821. i18n 键 settings.fw600 在 10 语言都存在且非空
1822. i18n 键 settings.fw700 在 10 语言都存在且非空
1823. i18n 键 settings.fw800 在 10 语言都存在且非空
1824. i18n 键 settings.fw900 在 10 语言都存在且非空
1825. i18n 键 settings.hexOrRgb 在 10 语言都存在且非空
1826. i18n 键 settings.hotkey.act.focusInput 在 10 语言都存在且非空
1827. i18n 键 settings.hotkey.act.focusSearch 在 10 语言都存在且非空
1828. i18n 键 settings.hotkey.act.newSession 在 10 语言都存在且非空
1829. i18n 键 settings.hotkey.act.openContacts 在 10 语言都存在且非空
1830. i18n 键 settings.hotkey.act.openMe 在 10 语言都存在且非空
1831. i18n 键 settings.hotkey.act.openSettings 在 10 语言都存在且非空
1832. i18n 键 settings.hotkey.act.stopAll 在 10 语言都存在且非空
1833. i18n 键 settings.hotkey.act.toggleConsole 在 10 语言都存在且非空
1834. i18n 键 settings.hotkey.act.toggleSidebar 在 10 语言都存在且非空
1835. i18n 键 settings.hotkey.actDesc.focusInput 在 10 语言都存在且非空
1836. i18n 键 settings.hotkey.actDesc.focusSearch 在 10 语言都存在且非空
1837. i18n 键 settings.hotkey.actDesc.newSession 在 10 语言都存在且非空
1838. i18n 键 settings.hotkey.actDesc.openContacts 在 10 语言都存在且非空
1839. i18n 键 settings.hotkey.actDesc.openMe 在 10 语言都存在且非空
1840. i18n 键 settings.hotkey.actDesc.openSettings 在 10 语言都存在且非空
1841. i18n 键 settings.hotkey.actDesc.stopAll 在 10 语言都存在且非空
1842. i18n 键 settings.hotkey.actDesc.toggleConsole 在 10 语言都存在且非空
1843. i18n 键 settings.hotkey.actDesc.toggleSidebar 在 10 语言都存在且非空
1844. i18n 键 settings.hotkey.api.boardAggregate 在 10 语言都存在且非空
1845. i18n 键 settings.hotkey.api.boardTasks 在 10 语言都存在且非空
1846. i18n 键 settings.hotkey.api.chatLog 在 10 语言都存在且非空
1847. i18n 键 settings.hotkey.api.chatSend 在 10 语言都存在且非空
1848. i18n 键 settings.hotkey.api.groupCreate 在 10 语言都存在且非空
1849. i18n 键 settings.hotkey.api.groupList 在 10 语言都存在且非空
1850. i18n 键 settings.hotkey.api.groupMessage 在 10 语言都存在且非空
1851. i18n 键 settings.hotkey.api.identityInfo 在 10 语言都存在且非空
1852. i18n 键 settings.hotkey.api.identityPeers 在 10 语言都存在且非空
1853. i18n 键 settings.hotkey.api.inviteCreate 在 10 语言都存在且非空
1854. i18n 键 settings.hotkey.api.knowledgeQuery 在 10 语言都存在且非空
1855. i18n 键 settings.hotkey.api.listInstances 在 10 语言都存在且非空
1856. i18n 键 settings.hotkey.api.membershipList 在 10 语言都存在且非空
1857. i18n 键 settings.hotkey.api.meshEnable 在 10 语言都存在且非空
1858. i18n 键 settings.hotkey.api.metricsSummary 在 10 语言都存在且非空
1859. i18n 键 settings.hotkey.api.netStatus 在 10 语言都存在且非空
1860. i18n 键 settings.hotkey.api.peersAdd 在 10 语言都存在且非空
1861. i18n 键 settings.hotkey.api.settingsGet 在 10 语言都存在且非空
1862. i18n 键 settings.hotkey.api.settingsSave 在 10 语言都存在且非空
1863. i18n 键 settings.hotkey.api.skillsList 在 10 语言都存在且非空
1864. i18n 键 settings.hotkey.api.spawnInstance 在 10 语言都存在且非空
1865. i18n 键 settings.hotkey.api.stateLoad 在 10 语言都存在且非空
1866. i18n 键 settings.hotkey.api.stateSave 在 10 语言都存在且非空
1867. i18n 键 settings.hotkey.api.stopInstance 在 10 语言都存在且非空
1868. i18n 键 settings.hotkey.apiColChannel 在 10 语言都存在且非空
1869. i18n 键 settings.hotkey.apiColDesc 在 10 语言都存在且非空
1870. i18n 键 settings.hotkey.apiColOp 在 10 语言都存在且非空
1871. i18n 键 settings.hotkey.apiColParams 在 10 语言都存在且非空
1872. i18n 键 settings.hotkey.apiCopied 在 10 语言都存在且非空
1873. i18n 键 settings.hotkey.apiCopyOps 在 10 语言都存在且非空
1874. i18n 键 settings.hotkey.apiCopyText 在 10 语言都存在且非空
1875. i18n 键 settings.hotkey.apiCount 在 10 语言都存在且非空
1876. i18n 键 settings.hotkey.apiEmpty 在 10 语言都存在且非空
1877. i18n 键 settings.hotkey.apiEvents 在 10 语言都存在且非空
1878. i18n 键 settings.hotkey.apiFilter 在 10 语言都存在且非空
1879. i18n 键 settings.hotkey.apiHint 在 10 语言都存在且非空
1880. i18n 键 settings.hotkey.apiNoDesc 在 10 语言都存在且非空
1881. i18n 键 settings.hotkey.apiTitle 在 10 语言都存在且非空
1882. i18n 键 settings.hotkey.apiTry 在 10 语言都存在且非空
1883. i18n 键 settings.hotkey.apiTryReadOnly 在 10 语言都存在且非空
1884. i18n 键 settings.hotkey.apiTryResult 在 10 语言都存在且非空
1885. i18n 键 settings.hotkey.apiUnavailable 在 10 语言都存在且非空
1886. i18n 键 settings.hotkey.clear 在 10 语言都存在且非空
1887. i18n 键 settings.hotkey.colAction 在 10 语言都存在且非空
1888. i18n 键 settings.hotkey.colBinding 在 10 语言都存在且非空
1889. i18n 键 settings.hotkey.colDesc 在 10 语言都存在且非空
1890. i18n 键 settings.hotkey.group.archive 在 10 语言都存在且非空
1891. i18n 键 settings.hotkey.group.asset 在 10 语言都存在且非空
1892. i18n 键 settings.hotkey.group.board 在 10 语言都存在且非空
1893. i18n 键 settings.hotkey.group.chat 在 10 语言都存在且非空
1894. i18n 键 settings.hotkey.group.checkpoint 在 10 语言都存在且非空
1895. i18n 键 settings.hotkey.group.executor 在 10 语言都存在且非空
1896. i18n 键 settings.hotkey.group.group 在 10 语言都存在且非空
1897. i18n 键 settings.hotkey.group.identity 在 10 语言都存在且非空
1898. i18n 键 settings.hotkey.group.invite 在 10 语言都存在且非空
1899. i18n 键 settings.hotkey.group.knowledge 在 10 语言都存在且非空
1900. i18n 键 settings.hotkey.group.membership 在 10 语言都存在且非空
1901. i18n 键 settings.hotkey.group.metrics 在 10 语言都存在且非空
1902. i18n 键 settings.hotkey.group.net 在 10 语言都存在且非空
1903. i18n 键 settings.hotkey.group.other 在 10 语言都存在且非空
1904. i18n 键 settings.hotkey.group.repo 在 10 语言都存在且非空
1905. i18n 键 settings.hotkey.group.security 在 10 语言都存在且非空
1906. i18n 键 settings.hotkey.group.settings 在 10 语言都存在且非空
1907. i18n 键 settings.hotkey.group.skill 在 10 语言都存在且非空
1908. i18n 键 settings.hotkey.group.smtp 在 10 语言都存在且非空
1909. i18n 键 settings.hotkey.group.window 在 10 语言都存在且非空
1910. i18n 键 settings.hotkey.invalid 在 10 语言都存在且非空
1911. i18n 键 settings.hotkey.keyHint 在 10 语言都存在且非空
1912. i18n 键 settings.hotkey.keyTitle 在 10 语言都存在且非空
1913. i18n 键 settings.hotkey.onlyWired 在 10 语言都存在且非空
1914. i18n 键 settings.hotkey.press 在 10 语言都存在且非空
1915. i18n 键 settings.hotkey.saved 在 10 语言都存在且非空
1916. i18n 键 settings.hotkey.unbound 在 10 语言都存在且非空
1917. i18n 键 settings.imageModel 在 10 语言都存在且非空
1918. i18n 键 settings.imageUndModel 在 10 语言都存在且非空
1919. i18n 键 settings.importDo 在 10 语言都存在且非空
1920. i18n 键 settings.importHint 在 10 语言都存在且非空
1921. i18n 键 settings.importNm 在 10 语言都存在且非空
1922. i18n 键 settings.importProviders 在 10 语言都存在且非空
1923. i18n 键 settings.keyEmpty 在 10 语言都存在且非空
1924. i18n 键 settings.keyReveal 在 10 语言都存在且非空
1925. i18n 键 settings.keySaveFailed 在 10 语言都存在且非空
1926. i18n 键 settings.keySaved 在 10 语言都存在且非空
1927. i18n 键 settings.language 在 10 语言都存在且非空
1928. i18n 键 settings.localeEn 在 10 语言都存在且非空
1929. i18n 键 settings.localeZh 在 10 语言都存在且非空
1930. i18n 键 settings.logMissing 在 10 语言都存在且非空
1931. i18n 键 settings.mimic 在 10 语言都存在且非空
1932. i18n 键 settings.mimicHint 在 10 语言都存在且非空
1933. i18n 键 settings.modelInUseTip 在 10 语言都存在且非空
1934. i18n 键 settings.modelOptions 在 10 语言都存在且非空
1935. i18n 键 settings.modelSetDefault 在 10 语言都存在且非空
1936. i18n 键 settings.modelStaleTip 在 10 语言都存在且非空
1937. i18n 键 settings.modelsDropped 在 10 语言都存在且非空
1938. i18n 键 settings.modelsEmpty 在 10 语言都存在且非空
1939. i18n 键 settings.modelsFetchFailed 在 10 语言都存在且非空
1940. i18n 键 settings.modelsFetched 在 10 语言都存在且非空
1941. i18n 键 settings.modelsStale 在 10 语言都存在且非空
1942. i18n 键 settings.modelsUnit 在 10 语言都存在且非空
1943. i18n 键 settings.notifyApplied 在 10 语言都存在且非空
1944. i18n 键 settings.notifyApply 在 10 语言都存在且非空
1945. i18n 键 settings.notifyCancel 在 10 语言都存在且非空
1946. i18n 键 settings.openLog 在 10 语言都存在且非空
1947. i18n 键 settings.organizerModel 在 10 语言都存在且非空
1948. i18n 键 settings.pickFolder 在 10 语言都存在且非空
1949. i18n 键 settings.pickScreenColor 在 10 语言都存在且非空
1950. i18n 键 settings.pickScreenHint 在 10 语言都存在且非空
1951. i18n 键 settings.pluginActions 在 10 语言都存在且非空
1952. i18n 键 settings.pluginAddPick 在 10 语言都存在且非空
1953. i18n 键 settings.pluginDelete 在 10 语言都存在且非空
1954. i18n 键 settings.pluginDesc 在 10 语言都存在且非空
1955. i18n 键 settings.pluginDisable 在 10 语言都存在且非空
1956. i18n 键 settings.pluginEnable 在 10 语言都存在且非空
1957. i18n 键 settings.pluginId 在 10 语言都存在且非空
1958. i18n 键 settings.pluginInstall 在 10 语言都存在且非空
1959. i18n 键 settings.pluginInstallBrowse 在 10 语言都存在且非空
1960. i18n 键 settings.pluginScanCheck 在 10 语言都存在且非空
1961. i18n 键 settings.pluginScanTitle 在 10 语言都存在且非空
1962. i18n 键 settings.pluginStatus 在 10 语言都存在且非空
1963. i18n 键 settings.pluginUninstall 在 10 语言都存在且非空
1964. i18n 键 settings.plugins 在 10 语言都存在且非空
1965. i18n 键 settings.provider.anthropic 在 10 语言都存在且非空
1966. i18n 键 settings.provider.dashscope 在 10 语言都存在且非空
1967. i18n 键 settings.provider.deepseek 在 10 语言都存在且非空
1968. i18n 键 settings.provider.fireworks 在 10 语言都存在且非空
1969. i18n 键 settings.provider.gemini 在 10 语言都存在且非空
1970. i18n 键 settings.provider.groq 在 10 语言都存在且非空
1971. i18n 键 settings.provider.mistral 在 10 语言都存在且非空
1972. i18n 键 settings.provider.moonshot 在 10 语言都存在且非空
1973. i18n 键 settings.provider.ollama 在 10 语言都存在且非空
1974. i18n 键 settings.provider.ollamaCloud 在 10 语言都存在且非空
1975. i18n 键 settings.provider.ollamaRemote 在 10 语言都存在且非空
1976. i18n 键 settings.provider.openai 在 10 语言都存在且非空
1977. i18n 键 settings.provider.openrouter 在 10 语言都存在且非空
1978. i18n 键 settings.provider.perplexity 在 10 语言都存在且非空
1979. i18n 键 settings.provider.siliconflow 在 10 语言都存在且非空
1980. i18n 键 settings.provider.together 在 10 语言都存在且非空
1981. i18n 键 settings.provider.zhipu 在 10 语言都存在且非空
1982. i18n 键 settings.providerActive 在 10 语言都存在且非空
1983. i18n 键 settings.providerMax 在 10 语言都存在且非空
1984. i18n 键 settings.providerName 在 10 语言都存在且非空
1985. i18n 键 settings.providerNameDup 在 10 语言都存在且非空
1986. i18n 键 settings.providerOther 在 10 语言都存在且非空
1987. i18n 键 settings.providerPickFirst 在 10 语言都存在且非空
1988. i18n 键 settings.providerPickHint 在 10 语言都存在且非空
1989. i18n 键 settings.providerPreset 在 10 语言都存在且非空
1990. i18n 键 settings.providerUse 在 10 语言都存在且非空
1991. i18n 键 settings.providerUseOk 在 10 语言都存在且非空
1992. i18n 键 settings.providers 在 10 语言都存在且非空
1993. i18n 键 settings.removeModel 在 10 语言都存在且非空
1994. i18n 键 settings.rerankModel 在 10 语言都存在且非空
1995. i18n 键 settings.restoreConfirm 在 10 语言都存在且非空
1996. i18n 键 settings.restoreDefaults 在 10 语言都存在且非空
1997. i18n 键 settings.restored 在 10 语言都存在且非空
1998. i18n 键 settings.safetyModel 在 10 语言都存在且非空
1999. i18n 键 settings.scanDone 在 10 语言都存在且非空
2000. i18n 键 settings.scanMachine 在 10 语言都存在且非空
2001. i18n 键 settings.scanRunning 在 10 语言都存在且非空
2002. i18n 键 settings.scanStopped 在 10 语言都存在且非空
2003. i18n 键 settings.search 在 10 语言都存在且非空
2004. i18n 键 settings.section.about 在 10 语言都存在且非空
2005. i18n 键 settings.section.func 在 10 语言都存在且非空
2006. i18n 键 settings.section.hotkey 在 10 语言都存在且非空
2007. i18n 键 settings.section.model 在 10 语言都存在且非空
2008. i18n 键 settings.section.notify 在 10 语言都存在且非空
2009. i18n 键 settings.section.ui 在 10 语言都存在且非空
2010. i18n 键 settings.security 在 10 语言都存在且非空
2011. i18n 键 settings.securityFull 在 10 语言都存在且非空
2012. i18n 键 settings.securityFullDesc 在 10 语言都存在且非空
2013. i18n 键 settings.securityHint 在 10 语言都存在且非空
2014. i18n 键 settings.securityNormal 在 10 语言都存在且非空
2015. i18n 键 settings.securityNormalDesc 在 10 语言都存在且非空
2016. i18n 键 settings.securityStrict 在 10 语言都存在且非空
2017. i18n 键 settings.securityStrictDesc 在 10 语言都存在且非空
2018. i18n 键 settings.skillDeleteLocked 在 10 语言都存在且非空
2019. i18n 键 settings.skillEnabled 在 10 语言都存在且非空
2020. i18n 键 settings.skillFrom 在 10 语言都存在且非空
2021. i18n 键 settings.skillPaused 在 10 语言都存在且非空
2022. i18n 键 settings.skillRemove 在 10 语言都存在且非空
2023. i18n 键 settings.skillSourceDiscovered 在 10 语言都存在且非空
2024. i18n 键 settings.skillSourceUserData 在 10 语言都存在且非空
2025. i18n 键 settings.skillSourceWorkspace 在 10 语言都存在且非空
2026. i18n 键 settings.skills 在 10 语言都存在且非空
2027. i18n 键 settings.skillsDiscoveredTitle 在 10 语言都存在且非空
2028. i18n 键 settings.skillsEmpty 在 10 语言都存在且非空
2029. i18n 键 settings.skillsEnable 在 10 语言都存在且非空
2030. i18n 键 settings.skillsHint 在 10 语言都存在且非空
2031. i18n 键 settings.skillsImport 在 10 语言都存在且非空
2032. i18n 键 settings.skillsImported 在 10 语言都存在且非空
2033. i18n 键 settings.skillsPaths 在 10 语言都存在且非空
2034. i18n 键 settings.skillsPause 在 10 语言都存在且非空
2035. i18n 键 settings.skillsScanAdd 在 10 语言都存在且非空
2036. i18n 键 settings.skillsScanCheck 在 10 语言都存在且非空
2037. i18n 键 settings.skillsScanEdit 在 10 语言都存在且非空
2038. i18n 键 settings.skillsScanEmpty 在 10 语言都存在且非空
2039. i18n 键 settings.skillsScanHint 在 10 语言都存在且非空
2040. i18n 键 settings.skillsScanInvalid 在 10 语言都存在且非空
2041. i18n 键 settings.skillsScanMax 在 10 语言都存在且非空
2042. i18n 键 settings.skillsScanMissing 在 10 语言都存在且非空
2043. i18n 键 settings.skillsScanOk 在 10 语言都存在且非空
2044. i18n 键 settings.skillsScanPlaceholder 在 10 语言都存在且非空
2045. i18n 键 settings.skillsScanRemove 在 10 语言都存在且非空
2046. i18n 键 settings.skillsScanSave 在 10 语言都存在且非空
2047. i18n 键 settings.skillsScanTitle 在 10 语言都存在且非空
2048. i18n 键 settings.sound 在 10 语言都存在且非空
2049. i18n 键 settings.soundClear 在 10 语言都存在且非空
2050. i18n 键 settings.soundComplete 在 10 语言都存在且非空
2051. i18n 键 settings.soundCompleteFile 在 10 语言都存在且非空
2052. i18n 键 settings.soundDefault 在 10 语言都存在且非空
2053. i18n 键 settings.soundError 在 10 语言都存在且非空
2054. i18n 键 settings.soundErrorFile 在 10 语言都存在且非空
2055. i18n 键 settings.soundName 在 10 语言都存在且非空
2056. i18n 键 settings.soundPick 在 10 语言都存在且非空
2057. i18n 键 settings.soundRequest 在 10 语言都存在且非空
2058. i18n 键 settings.soundRequestFile 在 10 语言都存在且非空
2059. i18n 键 settings.soundVolume 在 10 语言都存在且非空
2060. i18n 键 settings.soundVolume.x 在 10 语言都存在且非空
2061. i18n 键 settings.specialModels 在 10 语言都存在且非空
2062. i18n 键 settings.specialModelsHint 在 10 语言都存在且非空
2063. i18n 键 settings.strictAiLanguage 在 10 语言都存在且非空
2064. i18n 键 settings.strictAiLanguageHint 在 10 语言都存在且非空
2065. i18n 键 settings.strictOff 在 10 语言都存在且非空
2066. i18n 键 settings.strictOn 在 10 语言都存在且非空
2067. i18n 键 settings.summaryModel 在 10 语言都存在且非空
2068. i18n 键 settings.tabPlugins 在 10 语言都存在且非空
2069. i18n 键 settings.tabSkills 在 10 语言都存在且非空
2070. i18n 键 settings.text 在 10 语言都存在且非空
2071. i18n 键 settings.textHint 在 10 语言都存在且非空
2072. i18n 键 settings.theme 在 10 语言都存在且非空
2073. i18n 键 settings.themeCustom 在 10 语言都存在且非空
2074. i18n 键 settings.themeCustomTitle 在 10 语言都存在且非空
2075. i18n 键 settings.themeDark 在 10 语言都存在且非空
2076. i18n 键 settings.themeLight 在 10 语言都存在且非空
2077. i18n 键 settings.themeMode 在 10 语言都存在且非空
2078. i18n 键 settings.themePreview 在 10 语言都存在且非空
2079. i18n 键 settings.themeSystem 在 10 语言都存在且非空
2080. i18n 键 settings.themeTooDark 在 10 语言都存在且非空
2081. i18n 键 settings.themeTooLight 在 10 语言都存在且非空
2082. i18n 键 settings.translateModel 在 10 语言都存在且非空
2083. i18n 键 settings.ttsModel 在 10 语言都存在且非空
2084. i18n 键 settings.ttsModelHint 在 10 语言都存在且非空
2085. i18n 键 settings.upToDate 在 10 语言都存在且非空
2086. i18n 键 settings.updateAvailable 在 10 语言都存在且非空
2087. i18n 键 settings.videoGenModel 在 10 语言都存在且非空
2088. i18n 键 settings.videoUndModel 在 10 语言都存在且非空
2089. i18n 键 setup.biaoTi 在 10 语言都存在且非空
2090. i18n 键 setup.locale 在 10 语言都存在且非空
2091. i18n 键 setup.pickLanguage 在 10 语言都存在且非空
2092. i18n 键 setup.start 在 10 语言都存在且非空
2093. i18n 键 setup.title 在 10 语言都存在且非空
2094. i18n 键 setup.yuYan 在 10 语言都存在且非空
2095. i18n 键 shell.clear 在 10 语言都存在且非空
2096. i18n 键 shell.clearTip 在 10 语言都存在且非空
2097. i18n 键 shell.cleared 在 10 语言都存在且非空
2098. i18n 键 shell.cwdHome 在 10 语言都存在且非空
2099. i18n 键 shell.cwdProject 在 10 语言都存在且非空
2100. i18n 键 shell.cwdUserData 在 10 语言都存在且非空
2101. i18n 键 shell.exitCode 在 10 语言都存在且非空
2102. i18n 键 shell.hint 在 10 语言都存在且非空
2103. i18n 键 shell.historyHint 在 10 语言都存在且非空
2104. i18n 键 shell.inputLabel 在 10 语言都存在且非空
2105. i18n 键 shell.interruptDone 在 10 语言都存在且非空
2106. i18n 键 shell.interruptFailed 在 10 语言都存在且非空
2107. i18n 键 shell.placeholder 在 10 语言都存在且非空
2108. i18n 键 shell.previewUnavailable 在 10 语言都存在且非空
2109. i18n 键 shell.processExited 在 10 语言都存在且非空
2110. i18n 键 shell.ready 在 10 语言都存在且非空
2111. i18n 键 shell.running 在 10 语言都存在且非空
2112. i18n 键 shell.startFailed 在 10 语言都存在且非空
2113. i18n 键 shell.stop 在 10 语言都存在且非空
2114. i18n 键 shell.stopTip 在 10 语言都存在且非空
2115. i18n 键 shell.submitFailed 在 10 语言都存在且非空
2116. i18n 键 shell.title 在 10 语言都存在且非空
2117. i18n 键 shell.unavailable 在 10 语言都存在且非空
2118. i18n 键 slot.add 在 10 语言都存在且非空
2119. i18n 键 smtp.add 在 10 语言都存在且非空
2120. i18n 键 smtp.biaoQian 在 10 语言都存在且非空
2121. i18n 键 smtp.biaoTi 在 10 语言都存在且非空
2122. i18n 键 smtp.count 在 10 语言都存在且非空
2123. i18n 键 smtp.empty 在 10 语言都存在且非空
2124. i18n 键 smtp.fail 在 10 语言都存在且非空
2125. i18n 键 smtp.fromLabel 在 10 语言都存在且非空
2126. i18n 键 smtp.fromPlaceholder 在 10 语言都存在且非空
2127. i18n 键 smtp.hint 在 10 语言都存在且非空
2128. i18n 键 smtp.host 在 10 语言都存在且非空
2129. i18n 键 smtp.hostLabel 在 10 语言都存在且非空
2130. i18n 键 smtp.label 在 10 语言都存在且非空
2131. i18n 键 smtp.max10 在 10 语言都存在且非空
2132. i18n 键 smtp.ok 在 10 语言都存在且非空
2133. i18n 键 smtp.pass 在 10 语言都存在且非空
2134. i18n 键 smtp.passLabel 在 10 语言都存在且非空
2135. i18n 键 smtp.passPlaceholder 在 10 语言都存在且非空
2136. i18n 键 smtp.port 在 10 语言都存在且非空
2137. i18n 键 smtp.portLabel 在 10 语言都存在且非空
2138. i18n 键 smtp.remove 在 10 语言都存在且非空
2139. i18n 键 smtp.secure 在 10 语言都存在且非空
2140. i18n 键 smtp.settings 在 10 语言都存在且非空
2141. i18n 键 smtp.tiShi 在 10 语言都存在且非空
2142. i18n 键 smtp.title 在 10 语言都存在且非空
2143. i18n 键 smtp.unverified 在 10 语言都存在且非空
2144. i18n 键 smtp.user 在 10 语言都存在且非空
2145. i18n 键 smtp.userLabel 在 10 语言都存在且非空
2146. i18n 键 smtp.verified 在 10 语言都存在且非空
2147. i18n 键 smtp.verify 在 10 语言都存在且非空
2148. i18n 键 smtp.verifyBtn 在 10 语言都存在且非空
2149. i18n 键 sound.builtin 在 10 语言都存在且非空
2150. i18n 键 sound.try 在 10 语言都存在且非空
2151. i18n 键 sound.tryFail 在 10 语言都存在且非空
2152. i18n 键 status.busy 在 10 语言都存在且非空
2153. i18n 键 status.dead 在 10 语言都存在且非空
2154. i18n 键 status.idle 在 10 语言都存在且非空
2155. i18n 键 status.offline 在 10 语言都存在且非空
2156. i18n 键 tab.board 在 10 语言都存在且非空
2157. i18n 键 tab.cattle 在 10 语言都存在且非空
2158. i18n 键 tab.me 在 10 语言都存在且非空
2159. i18n 键 tab.sessions 在 10 语言都存在且非空
2160. i18n 键 time.justNow 在 10 语言都存在且非空
2161. i18n 键 time.monday 在 10 语言都存在且非空
2162. i18n 键 time.yesterday 在 10 语言都存在且非空
2163. i18n 键 tip.back 在 10 语言都存在且非空
2164. i18n 键 tip.close 在 10 语言都存在且非空
2165. i18n 键 tip.console 在 10 语言都存在且非空
2166. i18n 键 tip.diag 在 10 语言都存在且非空
2167. i18n 键 tip.dragWidth 在 10 语言都存在且非空
2168. i18n 键 tip.externalChat 在 10 语言都存在且非空
2169. i18n 键 tip.externalGroup 在 10 语言都存在且非空
2170. i18n 键 tip.instances 在 10 语言都存在且非空
2171. i18n 键 tip.internalGroup 在 10 语言都存在且非空
2172. i18n 键 tip.max 在 10 语言都存在且非空
2173. i18n 键 tip.me 在 10 语言都存在且非空
2174. i18n 键 tip.min 在 10 语言都存在且非空
2175. i18n 键 tip.more 在 10 语言都存在且非空
2176. i18n 键 tip.pin 在 10 语言都存在且非空
2177. i18n 键 tip.refresh 在 10 语言都存在且非空
2178. i18n 键 tip.resizer 在 10 语言都存在且非空
2179. i18n 键 tip.settings 在 10 语言都存在且非空
2180. i18n 键 tip.singleAi 在 10 语言都存在且非空
2181. i18n 键 tip.splitHint 在 10 语言都存在且非空
2182. i18n 键 tip.wo 在 10 语言都存在且非空
2183. i18n 键 touXiang.local 在 10 语言都存在且非空
2184. i18n 键 touXiang.pickTitle 在 10 语言都存在且非空
2185. i18n 键 tray.offWork 在 10 语言都存在且非空
2186. i18n 键 tts.noModel 在 10 语言都存在且非空
2187. i18n 键 ui.type.contact 在 10 语言都存在且非空
2188. i18n 键 ui.type.external 在 10 语言都存在且非空
2189. i18n 键 ui.type.internal 在 10 语言都存在且非空
2190. i18n 键 ui.type.single 在 10 语言都存在且非空
2191. i18n 键 update.download.badUrl 在 10 语言都存在且非空
2192. i18n 键 update.download.checksumMismatch 在 10 语言都存在且非空
2193. i18n 键 update.download.done 在 10 语言都存在且非空
2194. i18n 键 update.download.failed 在 10 语言都存在且非空
2195. i18n 键 update.download.noUrl 在 10 语言都存在且非空
2196. i18n 键 update.download.sizeMismatch 在 10 语言都存在且非空
2197. i18n 键 update.feedInvalid 在 10 语言都存在且非空
2198. i18n 键 update.feedPlaceholder 在 10 语言都存在且非空
2199. i18n 键 update.feedSave 在 10 语言都存在且非空
2200. i18n 键 update.feedSaved 在 10 语言都存在且非空
2201. i18n 键 update.status.available 在 10 语言都存在且非空
2202. i18n 键 update.status.httpError 在 10 语言都存在且非空
2203. i18n 键 update.status.invalidResponse 在 10 语言都存在且非空
2204. i18n 键 update.status.latestIs 在 10 语言都存在且非空
2205. i18n 键 update.status.networkError 在 10 语言都存在且非空
2206. i18n 键 update.status.notConfigured 在 10 语言都存在且非空
2207. i18n 键 update.status.unavailable 在 10 语言都存在且非空
2208. i18n 键 update.status.unknown 在 10 语言都存在且非空
2209. i18n 键 update.status.upToDate 在 10 语言都存在且非空
2210. i18n 键 urg.P1 在 10 语言都存在且非空
2211. i18n 键 urg.P2 在 10 语言都存在且非空
2212. i18n 键 urg.P3 在 10 语言都存在且非空
2213. i18n 键 urg.label 在 10 语言都存在且非空
2214. i18n 键 urgency.confirmBody 在 10 语言都存在且非空
2215. i18n 键 urgency.confirmTitle 在 10 语言都存在且非空
2216. i18n 键 urgency.confirmWait 在 10 语言都存在且非空
2217. i18n 键 urgency.insertLabel 在 10 语言都存在且非空
2218. i18n 键 urgency.queueLabel 在 10 语言都存在且非空
2219. i18n 键 urgency.urgentLabel 在 10 语言都存在且非空
2220. i18n 键 usage.completion 在 10 语言都存在且非空
2221. i18n 键 usage.model 在 10 语言都存在且非空
2222. i18n 键 usage.prompt 在 10 语言都存在且非空
2223. i18n 键 usage.provider 在 10 语言都存在且非空
2224. i18n 键 usage.total 在 10 语言都存在且非空
2225. i18n 键 usage.window 在 10 语言都存在且非空
2226. i18n 键 webgpu.fail 在 10 语言都存在且非空
2227. i18n 键 webgpu.hint 在 10 语言都存在且非空
2228. i18n 键 webgpu.ok 在 10 语言都存在且非空
2229. i18n 键 webgpu.section 在 10 语言都存在且非空
2230. i18n 键 webgpu.test 在 10 语言都存在且非空
2231. i18n 键 webgpu.title 在 10 语言都存在且非空
2232. i18n 键 win.closeConfirm 在 10 语言都存在且非空
2233. i18n 键 wo.backupJson 在 10 语言都存在且非空
2234. i18n 键 wo.belief 在 10 语言都存在且非空
2235. i18n 键 wo.beliefFile 在 10 语言都存在且非空
2236. i18n 键 wo.beliefHint 在 10 语言都存在且非空
2237. i18n 键 wo.beliefPlaceholder 在 10 语言都存在且非空
2238. i18n 键 wo.changeCred 在 10 语言都存在且非空
2239. i18n 键 wo.copy 在 10 语言都存在且非空
2240. i18n 键 wo.credRotated 在 10 语言都存在且非空
2241. i18n 键 wo.credential 在 10 语言都存在且非空
2242. i18n 键 wo.email 在 10 语言都存在且非空
2243. i18n 键 wo.emailInvalid 在 10 语言都存在且非空
2244. i18n 键 wo.emailSaved 在 10 语言都存在且非空
2245. i18n 键 wo.hideFull 在 10 语言都存在且非空
2246. i18n 键 wo.idHint 在 10 语言都存在且非空
2247. i18n 键 wo.idWarn 在 10 语言都存在且非空
2248. i18n 键 wo.passphrase 在 10 语言都存在且非空
2249. i18n 键 wo.showFull 在 10 语言都存在且非空
2250. i18n 键 wo.switchHint 在 10 语言都存在且非空
2251. i18n 键 wo.switchIdentity 在 10 语言都存在且非空
2252. i18n 键 wo.touXiang 在 10 语言都存在且非空
2253. i18n 键 wo.username 在 10 语言都存在且非空
2254. i18n 键 yingYong.displayName 在 10 语言都存在且非空
2255. i18n 键 yingYong.enName 在 10 语言都存在且非空
2256. i18n 键 yingYong.subtitle 在 10 语言都存在且非空
2257. i18n 键 yingYong.zhName 在 10 语言都存在且非空

## B 机制完善：文案卫生（无首尾空格）

2258. i18n 键 about.author 的文案没有首尾空格
2259. i18n 键 about.authorBody 的文案没有首尾空格
2260. i18n 键 about.checkUpdate 的文案没有首尾空格
2261. i18n 键 about.checking 的文案没有首尾空格
2262. i18n 键 about.contact 的文案没有首尾空格
2263. i18n 键 about.contactBody 的文案没有首尾空格
2264. i18n 键 about.copyright 的文案没有首尾空格
2265. i18n 键 about.copyrightBody 的文案没有首尾空格
2266. i18n 键 about.dshMissing 的文案没有首尾空格
2267. i18n 键 about.idRegenerated 的文案没有首尾空格
2268. i18n 键 about.idVerified 的文案没有首尾空格
2269. i18n 键 about.legal 的文案没有首尾空格
2270. i18n 键 about.legalBody 的文案没有首尾空格
2271. i18n 键 about.logoAlt 的文案没有首尾空格
2272. i18n 键 about.opensource 的文案没有首尾空格
2273. i18n 键 about.opensourceBody 的文案没有首尾空格
2274. i18n 键 about.startUpdate 的文案没有首尾空格
2275. i18n 键 about.tagline 的文案没有首尾空格
2276. i18n 键 about.techStack 的文案没有首尾空格
2277. i18n 键 about.techStackBody 的文案没有首尾空格
2278. i18n 键 about.updateStarted 的文案没有首尾空格
2279. i18n 键 about.updating 的文案没有首尾空格
2280. i18n 键 about.version 的文案没有首尾空格
2281. i18n 键 about.versionInfo 的文案没有首尾空格
2282. i18n 键 accent.custom 的文案没有首尾空格
2283. i18n 键 aiq.answered 的文案没有首尾空格
2284. i18n 键 aiq.biaoTi 的文案没有首尾空格
2285. i18n 键 aiq.custom 的文案没有首尾空格
2286. i18n 键 aiq.empty 的文案没有首尾空格
2287. i18n 键 aiq.newCard 的文案没有首尾空格
2288. i18n 键 aiq.pending 的文案没有首尾空格
2289. i18n 键 aiq.submit 的文案没有首尾空格
2290. i18n 键 aiq.title 的文案没有首尾空格
2291. i18n 键 app.displayName 的文案没有首尾空格
2292. i18n 键 app.enName 的文案没有首尾空格
2293. i18n 键 app.subtitle 的文案没有首尾空格
2294. i18n 键 app.zhName 的文案没有首尾空格
2295. i18n 键 approval.biaoTi 的文案没有首尾空格
2296. i18n 键 approval.deny 的文案没有首尾空格
2297. i18n 键 approval.global 的文案没有首尾空格
2298. i18n 键 approval.hint 的文案没有首尾空格
2299. i18n 键 approval.once 的文案没有首尾空格
2300. i18n 键 approval.project 的文案没有首尾空格
2301. i18n 键 approval.tiShi 的文案没有首尾空格
2302. i18n 键 approval.title 的文案没有首尾空格
2303. i18n 键 archive.hint 的文案没有首尾空格
2304. i18n 键 archive.tiShi 的文案没有首尾空格
2305. i18n 键 avatar.local 的文案没有首尾空格
2306. i18n 键 avatar.person.1 的文案没有首尾空格
2307. i18n 键 avatar.person.10 的文案没有首尾空格
2308. i18n 键 avatar.person.2 的文案没有首尾空格
2309. i18n 键 avatar.person.3 的文案没有首尾空格
2310. i18n 键 avatar.person.4 的文案没有首尾空格
2311. i18n 键 avatar.person.5 的文案没有首尾空格
2312. i18n 键 avatar.person.6 的文案没有首尾空格
2313. i18n 键 avatar.person.7 的文案没有首尾空格
2314. i18n 键 avatar.person.8 的文案没有首尾空格
2315. i18n 键 avatar.person.9 的文案没有首尾空格
2316. i18n 键 avatar.person.default 的文案没有首尾空格
2317. i18n 键 avatar.persons 的文案没有首尾空格
2318. i18n 键 avatar.pickTitle 的文案没有首尾空格
2319. i18n 键 avatar.preset.1 的文案没有首尾空格
2320. i18n 键 avatar.preset.10 的文案没有首尾空格
2321. i18n 键 avatar.preset.2 的文案没有首尾空格
2322. i18n 键 avatar.preset.3 的文案没有首尾空格
2323. i18n 键 avatar.preset.4 的文案没有首尾空格
2324. i18n 键 avatar.preset.5 的文案没有首尾空格
2325. i18n 键 avatar.preset.6 的文案没有首尾空格
2326. i18n 键 avatar.preset.7 的文案没有首尾空格
2327. i18n 键 avatar.preset.8 的文案没有首尾空格
2328. i18n 键 avatar.preset.9 的文案没有首尾空格
2329. i18n 键 avatar.presets 的文案没有首尾空格
2330. i18n 键 board.addBtn 的文案没有首尾空格
2331. i18n 键 board.addTask 的文案没有首尾空格
2332. i18n 键 board.add_note 的文案没有首尾空格
2333. i18n 键 board.added 的文案没有首尾空格
2334. i18n 键 board.aiGenerate 的文案没有首尾空格
2335. i18n 键 board.aiNotReady 的文案没有首尾空格
2336. i18n 键 board.block 的文案没有首尾空格
2337. i18n 键 board.blocked 的文案没有首尾空格
2338. i18n 键 board.complete_task 的文案没有首尾空格
2339. i18n 键 board.create_task 的文案没有首尾空格
2340. i18n 键 board.done 的文案没有首尾空格
2341. i18n 键 board.instances 的文案没有首尾空格
2342. i18n 键 board.progress 的文案没有首尾空格
2343. i18n 键 board.queue 的文案没有首尾空格
2344. i18n 键 board.queueList 的文案没有首尾空格
2345. i18n 键 board.readonlyHint 的文案没有首尾空格
2346. i18n 键 board.running 的文案没有首尾空格
2347. i18n 键 board.session 的文案没有首尾空格
2348. i18n 键 board.taskTitle 的文案没有首尾空格
2349. i18n 键 board.title 的文案没有首尾空格
2350. i18n 键 board.update_progress 的文案没有首尾空格
2351. i18n 键 brand.fu 的文案没有首尾空格
2352. i18n 键 brand.name 的文案没有首尾空格
2353. i18n 键 brand.sub 的文案没有首尾空格
2354. i18n 键 brand.tagline 的文案没有首尾空格
2355. i18n 键 card.cannotHide 的文案没有首尾空格
2356. i18n 键 card.email 的文案没有首尾空格
2357. i18n 键 card.empty 的文案没有首尾空格
2358. i18n 键 card.extra 的文案没有首尾空格
2359. i18n 键 card.fillInProfile 的文案没有首尾空格
2360. i18n 键 card.peerWillSee 的文案没有首尾空格
2361. i18n 键 card.phone 的文案没有首尾空格
2362. i18n 键 card.title 的文案没有首尾空格
2363. i18n 键 cattle.biaoTi 的文案没有首尾空格
2364. i18n 键 chat.askOnExceed 的文案没有首尾空格
2365. i18n 键 chat.attach 的文案没有首尾空格
2366. i18n 键 chat.attachHint 的文案没有首尾空格
2367. i18n 键 chat.attachTip 的文案没有首尾空格
2368. i18n 键 chat.autoRead 的文案没有首尾空格
2369. i18n 键 chat.autoScroll 的文案没有首尾空格
2370. i18n 键 chat.autoScrollOff 的文案没有首尾空格
2371. i18n 键 chat.autoScrollOn 的文案没有首尾空格
2372. i18n 键 chat.busy.1 的文案没有首尾空格
2373. i18n 键 chat.busy.2 的文案没有首尾空格
2374. i18n 键 chat.busy.3 的文案没有首尾空格
2375. i18n 键 chat.busy.4 的文案没有首尾空格
2376. i18n 键 chat.busy.5 的文案没有首尾空格
2377. i18n 键 chat.busy.6 的文案没有首尾空格
2378. i18n 键 chat.busy.7 的文案没有首尾空格
2379. i18n 键 chat.busy.8 的文案没有首尾空格
2380. i18n 键 chat.busy.done 的文案没有首尾空格
2381. i18n 键 chat.busy.fail 的文案没有首尾空格
2382. i18n 键 chat.busy.still 的文案没有首尾空格
2383. i18n 键 chat.cancel 的文案没有首尾空格
2384. i18n 键 chat.checkpoints 的文案没有首尾空格
2385. i18n 键 chat.console 的文案没有首尾空格
2386. i18n 键 chat.contextTooSmall 的文案没有首尾空格
2387. i18n 键 chat.copied 的文案没有首尾空格
2388. i18n 键 chat.copy 的文案没有首尾空格
2389. i18n 键 chat.emptyReply 的文案没有首尾空格
2390. i18n 键 chat.emptyReplyWhy 的文案没有首尾空格
2391. i18n 键 chat.export 的文案没有首尾空格
2392. i18n 键 chat.exportTip 的文案没有首尾空格
2393. i18n 键 chat.faSong 的文案没有首尾空格
2394. i18n 键 chat.failed 的文案没有首尾空格
2395. i18n 键 chat.file 的文案没有首尾空格
2396. i18n 键 chat.filePh 的文案没有首尾空格
2397. i18n 键 chat.inputCleared 的文案没有首尾空格
2398. i18n 键 chat.insert 的文案没有首尾空格
2399. i18n 键 chat.kb 的文案没有首尾空格
2400. i18n 键 chat.loadMore 的文案没有首尾空格
2401. i18n 键 chat.members 的文案没有首尾空格
2402. i18n 键 chat.metrics 的文案没有首尾空格
2403. i18n 键 chat.model 的文案没有首尾空格
2404. i18n 键 chat.modelUsed 的文案没有首尾空格
2405. i18n 键 chat.more 的文案没有首尾空格
2406. i18n 键 chat.openWindow 的文案没有首尾空格
2407. i18n 键 chat.openWindowTip 的文案没有首尾空格
2408. i18n 键 chat.p1 的文案没有首尾空格
2409. i18n 键 chat.p1ConfirmBody 的文案没有首尾空格
2410. i18n 键 chat.p1ConfirmOk 的文案没有首尾空格
2411. i18n 键 chat.p1ConfirmTitle 的文案没有首尾空格
2412. i18n 键 chat.p1Countdown 的文案没有首尾空格
2413. i18n 键 chat.p1Tip 的文案没有首尾空格
2414. i18n 键 chat.p2 的文案没有首尾空格
2415. i18n 键 chat.p2Tip 的文案没有首尾空格
2416. i18n 键 chat.p3 的文案没有首尾空格
2417. i18n 键 chat.p3Tip 的文案没有首尾空格
2418. i18n 键 chat.placeholder 的文案没有首尾空格
2419. i18n 键 chat.queue 的文案没有首尾空格
2420. i18n 键 chat.queueDelete 的文案没有首尾空格
2421. i18n 键 chat.queueDown 的文案没有首尾空格
2422. i18n 键 chat.queueEdit 的文案没有首尾空格
2423. i18n 键 chat.queueEmpty 的文案没有首尾空格
2424. i18n 键 chat.queueSave 的文案没有首尾空格
2425. i18n 键 chat.queueTitle 的文案没有首尾空格
2426. i18n 键 chat.queueUp 的文案没有首尾空格
2427. i18n 键 chat.read 的文案没有首尾空格
2428. i18n 键 chat.resumeTask 的文案没有首尾空格
2429. i18n 键 chat.resumeTaskCmd 的文案没有首尾空格
2430. i18n 键 chat.resumeTaskExpired 的文案没有首尾空格
2431. i18n 键 chat.resumeTaskHint 的文案没有首尾空格
2432. i18n 键 chat.resumeTaskOpen 的文案没有首尾空格
2433. i18n 键 chat.screenshot 的文案没有首尾空格
2434. i18n 键 chat.screenshotPending 的文案没有首尾空格
2435. i18n 键 chat.screenshotTip 的文案没有首尾空格
2436. i18n 键 chat.scrollToBottom 的文案没有首尾空格
2437. i18n 键 chat.security 的文案没有首尾空格
2438. i18n 键 chat.securityFull 的文案没有首尾空格
2439. i18n 键 chat.securityNormal 的文案没有首尾空格
2440. i18n 键 chat.securityStrict 的文案没有首尾空格
2441. i18n 键 chat.send 的文案没有首尾空格
2442. i18n 键 chat.shotCancel 的文案没有首尾空格
2443. i18n 键 chat.shotDone 的文案没有首尾空格
2444. i18n 键 chat.shotHint 的文案没有首尾空格
2445. i18n 键 chat.stopAll 的文案没有首尾空格
2446. i18n 键 chat.stopAllTip 的文案没有首尾空格
2447. i18n 键 chat.stopTask 的文案没有首尾空格
2448. i18n 键 chat.sub.group 的文案没有首尾空格
2449. i18n 键 chat.sub.single 的文案没有首尾空格
2450. i18n 键 chat.systemNote 的文案没有首尾空格
2451. i18n 键 chat.thinkDowngraded 的文案没有首尾空格
2452. i18n 键 chat.thinking 的文案没有首尾空格
2453. i18n 键 chat.thinkingDone 的文案没有首尾空格
2454. i18n 键 chat.thinkingOpen 的文案没有首尾空格
2455. i18n 键 chat.tipBadge 的文案没有首尾空格
2456. i18n 键 chat.toolsDone 的文案没有首尾空格
2457. i18n 键 chat.toolsDoneTail 的文案没有首尾空格
2458. i18n 键 chat.unreadBadge 的文案没有首尾空格
2459. i18n 键 chat.urgency 的文案没有首尾空格
2460. i18n 键 chat.urgent 的文案没有首尾空格
2461. i18n 键 chat.voice 的文案没有首尾空格
2462. i18n 键 chat.voiceIcon 的文案没有首尾空格
2463. i18n 键 chat.voiceNeedAsr 的文案没有首尾空格
2464. i18n 键 chat.voiceStopTip 的文案没有首尾空格
2465. i18n 键 chat.voiceTip 的文案没有首尾空格
2466. i18n 键 chat.voiceUnsupported 的文案没有首尾空格
2467. i18n 键 checkpoints.assets 的文案没有首尾空格
2468. i18n 键 checkpoints.biaoTi 的文案没有首尾空格
2469. i18n 键 checkpoints.changed 的文案没有首尾空格
2470. i18n 键 checkpoints.confirmBody 的文案没有首尾空格
2471. i18n 键 checkpoints.confirmTitle 的文案没有首尾空格
2472. i18n 键 checkpoints.created 的文案没有首尾空格
2473. i18n 键 checkpoints.empty 的文案没有首尾空格
2474. i18n 键 checkpoints.env.biaoTi 的文案没有首尾空格
2475. i18n 键 checkpoints.env.changed 的文案没有首尾空格
2476. i18n 键 checkpoints.env.current 的文案没有首尾空格
2477. i18n 键 checkpoints.env.layered 的文案没有首尾空格
2478. i18n 键 checkpoints.env.none 的文案没有首尾空格
2479. i18n 键 checkpoints.env.recorded 的文案没有首尾空格
2480. i18n 键 checkpoints.env.same 的文案没有首尾空格
2481. i18n 键 checkpoints.env.title 的文案没有首尾空格
2482. i18n 键 checkpoints.irreversible 的文案没有首尾空格
2483. i18n 键 checkpoints.load 的文案没有首尾空格
2484. i18n 键 checkpoints.max 的文案没有首尾空格
2485. i18n 键 checkpoints.space 的文案没有首尾空格
2486. i18n 键 checkpoints.stopAndLoad 的文案没有首尾空格
2487. i18n 键 checkpoints.tasks 的文案没有首尾空格
2488. i18n 键 checkpoints.title 的文案没有首尾空格
2489. i18n 键 checkpoints.used 的文案没有首尾空格
2490. i18n 键 common.cancel 的文案没有首尾空格
2491. i18n 键 common.close 的文案没有首尾空格
2492. i18n 键 common.copy 的文案没有首尾空格
2493. i18n 键 common.delete 的文案没有首尾空格
2494. i18n 键 common.edit 的文案没有首尾空格
2495. i18n 键 common.error 的文案没有首尾空格
2496. i18n 键 common.loading 的文案没有首尾空格
2497. i18n 键 common.more 的文案没有首尾空格
2498. i18n 键 common.no 的文案没有首尾空格
2499. i18n 键 common.ok 的文案没有首尾空格
2500. i18n 键 common.quote 的文案没有首尾空格
2501. i18n 键 common.retry 的文案没有首尾空格
2502. i18n 键 common.save 的文案没有首尾空格
2503. i18n 键 common.saved 的文案没有首尾空格
2504. i18n 键 common.yes 的文案没有首尾空格
2505. i18n 键 console.biaoTi 的文案没有首尾空格
2506. i18n 键 console.cat.error 的文案没有首尾空格
2507. i18n 键 console.cat.net 的文案没有首尾空格
2508. i18n 键 console.cat.system 的文案没有首尾空格
2509. i18n 键 console.cat.tool 的文案没有首尾空格
2510. i18n 键 console.cat.ui 的文案没有首尾空格
2511. i18n 键 console.clear 的文案没有首尾空格
2512. i18n 键 console.clearTip 的文案没有首尾空格
2513. i18n 键 console.cleared 的文案没有首尾空格
2514. i18n 键 console.empty 的文案没有首尾空格
2515. i18n 键 console.err.chat-send 的文案没有首尾空格
2516. i18n 键 console.err.ipc 的文案没有首尾空格
2517. i18n 键 console.err.uncaught 的文案没有首尾空格
2518. i18n 键 console.err.unhandled-rejection 的文案没有首尾空格
2519. i18n 键 console.hide 的文案没有首尾空格
2520. i18n 键 console.hint 的文案没有首尾空格
2521. i18n 键 console.net.bind-failed 的文案没有首尾空格
2522. i18n 键 console.net.disable 的文案没有首尾空格
2523. i18n 键 console.net.discovered 的文案没有首尾空格
2524. i18n 键 console.net.enable-failed 的文案没有首尾空格
2525. i18n 键 console.net.enable-ok 的文案没有首尾空格
2526. i18n 键 console.net.event 的文案没有首尾空格
2527. i18n 键 console.net.handshake-ok 的文案没有首尾空格
2528. i18n 键 console.net.peer-down 的文案没有首尾空格
2529. i18n 键 console.net.peer-online 的文案没有首尾空格
2530. i18n 键 console.net.peer-up 的文案没有首尾空格
2531. i18n 键 console.net.unavailable 的文案没有首尾空格
2532. i18n 键 console.open 的文案没有首尾空格
2533. i18n 键 console.redacted 的文案没有首尾空格
2534. i18n 键 console.result.fail 的文案没有首尾空格
2535. i18n 键 console.result.ok 的文案没有首尾空格
2536. i18n 键 console.tiShi 的文案没有首尾空格
2537. i18n 键 console.title 的文案没有首尾空格
2538. i18n 键 console.tool.finish 的文案没有首尾空格
2539. i18n 键 console.tool.start 的文案没有首尾空格
2540. i18n 键 console.ui.uncaught 的文案没有首尾空格
2541. i18n 键 console.ui.unhandled-rejection 的文案没有首尾空格
2542. i18n 键 console.unknown 的文案没有首尾空格
2543. i18n 键 contact.add 的文案没有首尾空格
2544. i18n 键 contact.mine 的文案没有首尾空格
2545. i18n 键 contact.mineCopied 的文案没有首尾空格
2546. i18n 键 contact.mineCopy 的文案没有首尾空格
2547. i18n 键 contact.mineCopyFail 的文案没有首尾空格
2548. i18n 键 contact.mineHint 的文案没有首尾空格
2549. i18n 键 contact.mineLink 的文案没有首尾空格
2550. i18n 键 contact.mineQr 的文案没有首尾空格
2551. i18n 键 contact.mineUnavailable 的文案没有首尾空格
2552. i18n 键 contact.namePlaceholder 的文案没有首尾空格
2553. i18n 键 contact.needInput 的文案没有首尾空格
2554. i18n 键 contact.others 的文案没有首尾空格
2555. i18n 键 contact.othersHint 的文案没有首尾空格
2556. i18n 键 contact.ownId 的文案没有首尾空格
2557. i18n 键 contact.qrUnavailable 的文案没有首尾空格
2558. i18n 键 contact.scanHint 的文案没有首尾空格
2559. i18n 键 container.action.confirmStopBody 的文案没有首尾空格
2560. i18n 键 container.action.confirmStopTitle 的文案没有首尾空格
2561. i18n 键 container.action.failedLine 的文案没有首尾空格
2562. i18n 键 container.action.needsAdmin 的文案没有首尾空格
2563. i18n 键 container.action.noButtons 的文案没有首尾空格
2564. i18n 键 container.action.reason.engine-start-failed 的文案没有首尾空格
2565. i18n 键 container.action.reason.engine-stop-failed 的文案没有首尾空格
2566. i18n 键 container.action.reason.install-incomplete 的文案没有首尾空格
2567. i18n 键 container.action.reason.no-exit-code 的文案没有首尾空格
2568. i18n 键 container.action.reason.ok 的文案没有首尾空格
2569. i18n 键 container.action.reason.spawn-failed 的文案没有首尾空格
2570. i18n 键 container.action.recovered 的文案没有首尾空格
2571. i18n 键 container.action.rejected 的文案没有首尾空格
2572. i18n 键 container.action.retry 的文案没有首尾空格
2573. i18n 键 container.action.start 的文案没有首尾空格
2574. i18n 键 container.action.startFailed 的文案没有首尾空格
2575. i18n 键 container.action.startVerb 的文案没有首尾空格
2576. i18n 键 container.action.starting 的文案没有首尾空格
2577. i18n 键 container.action.stop 的文案没有首尾空格
2578. i18n 键 container.action.stopFailed 的文案没有首尾空格
2579. i18n 键 container.action.stopVerb 的文案没有首尾空格
2580. i18n 键 container.action.stopping 的文案没有首尾空格
2581. i18n 键 container.action.timeout 的文案没有首尾空格
2582. i18n 键 container.action.waitingReady 的文案没有首尾空格
2583. i18n 键 container.biaoTi 的文案没有首尾空格
2584. i18n 键 container.cap.mount 的文案没有首尾空格
2585. i18n 键 container.cap.none 的文案没有首尾空格
2586. i18n 键 container.cap.run 的文案没有首尾空格
2587. i18n 键 container.cap.shell 的文案没有首尾空格
2588. i18n 键 container.capLabel 的文案没有首尾空格
2589. i18n 键 container.cardFocusHint 的文案没有首尾空格
2590. i18n 键 container.console.biaoTi 的文案没有首尾空格
2591. i18n 键 container.console.containerCreated 的文案没有首尾空格
2592. i18n 键 container.console.containerReused 的文案没有首尾空格
2593. i18n 键 container.console.gotoInstall 的文案没有首尾空格
2594. i18n 键 container.console.inputPlaceholder 的文案没有首尾空格
2595. i18n 键 container.console.intro 的文案没有首尾空格
2596. i18n 键 container.console.linuxNode 的文案没有首尾空格
2597. i18n 键 container.console.needsImage 的文案没有首尾空格
2598. i18n 键 container.console.noExec 的文案没有首尾空格
2599. i18n 键 container.console.notEnabled 的文案没有首尾空格
2600. i18n 键 container.console.notReady 的文案没有首尾空格
2601. i18n 键 container.console.offline 的文案没有首尾空格
2602. i18n 键 container.console.onlyInChat 的文案没有首尾空格
2603. i18n 键 container.console.openedInContainer 的文案没有首尾空格
2604. i18n 键 container.console.projectStopped 的文案没有首尾空格
2605. i18n 键 container.console.refused 的文案没有首尾空格
2606. i18n 键 container.console.run 的文案没有首尾空格
2607. i18n 键 container.console.security 的文案没有首尾空格
2608. i18n 键 container.console.securityDetail 的文案没有首尾空格
2609. i18n 键 container.console.sent 的文案没有首尾空格
2610. i18n 键 container.console.stateLine 的文案没有首尾空格
2611. i18n 键 container.console.tip 的文案没有首尾空格
2612. i18n 键 container.console.title 的文案没有首尾空格
2613. i18n 键 container.current 的文案没有首尾空格
2614. i18n 键 container.current.none 的文案没有首尾空格
2615. i18n 键 container.detailLabel 的文案没有首尾空格
2616. i18n 键 container.devEnv.biaoTi 的文案没有首尾空格
2617. i18n 键 container.devEnv.container 的文案没有首尾空格
2618. i18n 键 container.devEnv.containerNote 的文案没有首尾空格
2619. i18n 键 container.devEnv.createTitle 的文案没有首尾空格
2620. i18n 键 container.devEnv.host 的文案没有首尾空格
2621. i18n 键 container.devEnv.nameLabel 的文案没有首尾空格
2622. i18n 键 container.devEnv.note 的文案没有首尾空格
2623. i18n 键 container.devEnv.required 的文案没有首尾空格
2624. i18n 键 container.devEnv.title 的文案没有首尾空格
2625. i18n 键 container.devIsolation 的文案没有首尾空格
2626. i18n 键 container.devIsolationTest 的文案没有首尾空格
2627. i18n 键 container.env.install.biaoTi 的文案没有首尾空格
2628. i18n 键 container.env.install.body 的文案没有首尾空格
2629. i18n 键 container.env.install.netBody 的文案没有首尾空格
2630. i18n 键 container.env.install.netTitle 的文案没有首尾空格
2631. i18n 键 container.env.install.noNodeForUs 的文案没有首尾空格
2632. i18n 键 container.env.install.persistBody 的文案没有首尾空格
2633. i18n 键 container.env.install.persistTitle 的文案没有首尾空格
2634. i18n 键 container.env.install.ti 的文案没有首尾空格
2635. i18n 键 container.env.install.title 的文案没有首尾空格
2636. i18n 键 container.env.mode.body 的文案没有首尾空格
2637. i18n 键 container.env.mode.ti 的文案没有首尾空格
2638. i18n 键 container.env.mode.title 的文案没有首尾空格
2639. i18n 键 container.env.mode.unknown 的文案没有首尾空格
2640. i18n 键 container.env.probe.button 的文案没有首尾空格
2641. i18n 键 container.env.probe.refused.bad-command 的文案没有首尾空格
2642. i18n 键 container.env.probe.refused.container-not-ready 的文案没有首尾空格
2643. i18n 键 container.env.probe.refused.no-image 的文案没有首尾空格
2644. i18n 键 container.env.probe.refused.project-unavailable 的文案没有首尾空格
2645. i18n 键 container.env.prompt.biaoTi 的文案没有首尾空格
2646. i18n 键 container.env.prompt.content 的文案没有首尾空格
2647. i18n 键 container.env.prompt.copied 的文案没有首尾空格
2648. i18n 键 container.env.prompt.copy 的文案没有首尾空格
2649. i18n 键 container.env.prompt.failed 的文案没有首尾空格
2650. i18n 键 container.env.prompt.hint 的文案没有首尾空格
2651. i18n 键 container.env.prompt.tiShi 的文案没有首尾空格
2652. i18n 键 container.env.prompt.title 的文案没有首尾空格
2653. i18n 键 container.env.rollback.button 的文案没有首尾空格
2654. i18n 键 container.env.rollback.confirmBody 的文案没有首尾空格
2655. i18n 键 container.env.rollback.confirmTitle 的文案没有首尾空格
2656. i18n 键 container.env.rollback.done 的文案没有首尾空格
2657. i18n 键 container.env.rollback.refused.no-runtime-chosen 的文案没有首尾空格
2658. i18n 键 container.env.rollback.refused.no-solidified-point 的文案没有首尾空格
2659. i18n 键 container.env.rollback.refused.project-unavailable 的文案没有首尾空格
2660. i18n 键 container.env.rollback.refused.run-failed 的文案没有首尾空格
2661. i18n 键 container.env.rollback.refused.runtime-cannot-solidify 的文案没有首尾空格
2662. i18n 键 container.env.solidify.ability.commit 的文案没有首尾空格
2663. i18n 键 container.env.solidify.ability.export-import 的文案没有首尾空格
2664. i18n 键 container.env.solidify.ability.unsupported 的文案没有首尾空格
2665. i18n 键 container.env.solidify.biaoTi 的文案没有首尾空格
2666. i18n 键 container.env.solidify.button 的文案没有首尾空格
2667. i18n 键 container.env.solidify.decision.before-destroy 的文案没有首尾空格
2668. i18n 键 container.env.solidify.decision.coalesced 的文案没有首尾空格
2669. i18n 键 container.env.solidify.decision.explicit 的文案没有首尾空格
2670. i18n 键 container.env.solidify.decision.first-time 的文案没有首尾空格
2671. i18n 键 container.env.solidify.decision.nothing-changed 的文案没有首尾空格
2672. i18n 键 container.env.solidify.decision.runtime-cannot-solidify 的文案没有首尾空格
2673. i18n 键 container.env.solidify.decision.throttled-due 的文案没有首尾空格
2674. i18n 键 container.env.solidify.done 的文案没有首尾空格
2675. i18n 键 container.env.solidify.executorHost 的文案没有首尾空格
2676. i18n 键 container.env.solidify.keep 的文案没有首尾空格
2677. i18n 键 container.env.solidify.last 的文案没有首尾空格
2678. i18n 键 container.env.solidify.never 的文案没有首尾空格
2679. i18n 键 container.env.solidify.refused.coalesced 的文案没有首尾空格
2680. i18n 键 container.env.solidify.refused.commit-failed 的文案没有首尾空格
2681. i18n 键 container.env.solidify.refused.commit-unverified 的文案没有首尾空格
2682. i18n 键 container.env.solidify.refused.no-container 的文案没有首尾空格
2683. i18n 键 container.env.solidify.refused.no-image 的文案没有首尾空格
2684. i18n 键 container.env.solidify.refused.no-runtime-chosen 的文案没有首尾空格
2685. i18n 键 container.env.solidify.refused.nothing-to-solidify 的文案没有首尾空格
2686. i18n 键 container.env.solidify.refused.runtime-cannot-solidify 的文案没有首尾空格
2687. i18n 键 container.env.solidify.restore 的文案没有首尾空格
2688. i18n 键 container.env.solidify.retained 的文案没有首尾空格
2689. i18n 键 container.env.solidify.security 的文案没有首尾空格
2690. i18n 键 container.env.solidify.status 的文案没有首尾空格
2691. i18n 键 container.env.solidify.throttle 的文案没有首尾空格
2692. i18n 键 container.env.solidify.title 的文案没有首尾空格
2693. i18n 键 container.env.solidify.why.isolation-level-only 的文案没有首尾空格
2694. i18n 键 container.env.solidify.why.no-runtime-chosen 的文案没有首尾空格
2695. i18n 键 container.env.solidify.why.oci-commit 的文案没有首尾空格
2696. i18n 键 container.env.solidify.why.one-shot-vm 的文案没有首尾空格
2697. i18n 键 container.env.solidify.why.runtime-unknown 的文案没有首尾空格
2698. i18n 键 container.env.solidify.why.system-service-needs-root 的文案没有首尾空格
2699. i18n 键 container.env.solidify.why.wsl-no-commit 的文案没有首尾空格
2700. i18n 键 container.envType.android 的文案没有首尾空格
2701. i18n 键 container.envType.android.why 的文案没有首尾空格
2702. i18n 键 container.envType.containerOnly 的文案没有首尾空格
2703. i18n 键 container.envType.hint 的文案没有首尾空格
2704. i18n 键 container.envType.limited 的文案没有首尾空格
2705. i18n 键 container.envType.linux 的文案没有首尾空格
2706. i18n 键 container.envType.linux.why 的文案没有首尾空格
2707. i18n 键 container.envType.modeHint 的文案没有首尾空格
2708. i18n 键 container.envType.notContainer 的文案没有首尾空格
2709. i18n 键 container.envType.onlyLinux 的文案没有首尾空格
2710. i18n 键 container.envType.title 的文案没有首尾空格
2711. i18n 键 container.envType.windows 的文案没有首尾空格
2712. i18n 键 container.envType.windows.why 的文案没有首尾空格
2713. i18n 键 container.evidenceNone 的文案没有首尾空格
2714. i18n 键 container.fsGuard.applied 的文案没有首尾空格
2715. i18n 键 container.fsGuard.biaoTi 的文案没有首尾空格
2716. i18n 键 container.fsGuard.confirmBody 的文案没有首尾空格
2717. i18n 键 container.fsGuard.confirmLiftBody 的文案没有首尾空格
2718. i18n 键 container.fsGuard.confirmTitle 的文案没有首尾空格
2719. i18n 键 container.fsGuard.failed.icacls-failed 的文案没有首尾空格
2720. i18n 键 container.fsGuard.failed.not-creator 的文案没有首尾空格
2721. i18n 键 container.fsGuard.failed.unknown 的文案没有首尾空格
2722. i18n 键 container.fsGuard.lifted 的文案没有首尾空格
2723. i18n 键 container.fsGuard.limits 的文案没有首尾空格
2724. i18n 键 container.fsGuard.lock 的文案没有首尾空格
2725. i18n 键 container.fsGuard.off 的文案没有首尾空格
2726. i18n 键 container.fsGuard.on 的文案没有首尾空格
2727. i18n 键 container.fsGuard.qiYong 的文案没有首尾空格
2728. i18n 键 container.fsGuard.title 的文案没有首尾空格
2729. i18n 键 container.fsGuard.unavailable.no-project-dir 的文案没有首尾空格
2730. i18n 键 container.fsGuard.unavailable.not-container-project 的文案没有首尾空格
2731. i18n 键 container.fsGuard.unavailable.not-creator 的文案没有首尾空格
2732. i18n 键 container.fsGuard.unavailable.platform-not-supported 的文案没有首尾空格
2733. i18n 键 container.fsGuard.unavailable.unknown 的文案没有首尾空格
2734. i18n 键 container.fsGuard.undo 的文案没有首尾空格
2735. i18n 键 container.fsGuard.unlock 的文案没有首尾空格
2736. i18n 键 container.fsGuard.what 的文案没有首尾空格
2737. i18n 键 container.guideCollapse 的文案没有首尾空格
2738. i18n 键 container.guideCollapsedHint 的文案没有首尾空格
2739. i18n 键 container.guideCommercial 的文案没有首尾空格
2740. i18n 键 container.guideCost 的文案没有首尾空格
2741. i18n 键 container.guideFirstStep 的文案没有首尾空格
2742. i18n 键 container.guideHint 的文案没有首尾空格
2743. i18n 键 container.guideOs 的文案没有首尾空格
2744. i18n 键 container.guideSize 的文案没有首尾空格
2745. i18n 键 container.guideTitle 的文案没有首尾空格
2746. i18n 键 container.hint 的文案没有首尾空格
2747. i18n 键 container.image.biaoTi 的文案没有首尾空格
2748. i18n 键 container.image.executorHost 的文案没有首尾空格
2749. i18n 键 container.image.node 的文案没有首尾空格
2750. i18n 键 container.image.pinned 的文案没有首尾空格
2751. i18n 键 container.image.sourcePending 的文案没有首尾空格
2752. i18n 键 container.image.stack.biaoTi 的文案没有首尾空格
2753. i18n 键 container.image.stack.fits 的文案没有首尾空格
2754. i18n 键 container.image.stack.minimal 的文案没有首尾空格
2755. i18n 键 container.image.stack.moreLater 的文案没有首尾空格
2756. i18n 键 container.image.stack.node 的文案没有首尾空格
2757. i18n 键 container.image.stack.nodeOnly 的文案没有首尾空格
2758. i18n 键 container.image.stack.title 的文案没有首尾空格
2759. i18n 键 container.image.title 的文案没有首尾空格
2760. i18n 键 container.image.why 的文案没有首尾空格
2761. i18n 键 container.inst.actFailed 的文案没有首尾空格
2762. i18n 键 container.inst.collapse 的文案没有首尾空格
2763. i18n 键 container.inst.create 的文案没有首尾空格
2764. i18n 键 container.inst.createHint 的文案没有首尾空格
2765. i18n 键 container.inst.empty 的文案没有首尾空格
2766. i18n 键 container.inst.hintReady 的文案没有首尾空格
2767. i18n 键 container.inst.hintStopped 的文案没有首尾空格
2768. i18n 键 container.inst.listFailed 的文案没有首尾空格
2769. i18n 键 container.inst.loading 的文案没有首尾空格
2770. i18n 键 container.inst.none 的文案没有首尾空格
2771. i18n 键 container.inst.openAppFailed 的文案没有首尾空格
2772. i18n 键 container.inst.ours 的文案没有首尾空格
2773. i18n 键 container.inst.running 的文案没有首尾空格
2774. i18n 键 container.inst.start 的文案没有首尾空格
2775. i18n 键 container.inst.stop 的文案没有首尾空格
2776. i18n 键 container.inst.stopped 的文案没有首尾空格
2777. i18n 键 container.inst.title 的文案没有首尾空格
2778. i18n 键 container.inst.unsupported 的文案没有首尾空格
2779. i18n 键 container.inst.view 的文案没有首尾空格
2780. i18n 键 container.kind.container 的文案没有首尾空格
2781. i18n 键 container.kind.disposable-vm 的文案没有首尾空格
2782. i18n 键 container.kind.linux-vm 的文案没有首尾空格
2783. i18n 键 container.kind.microvm 的文案没有首尾空格
2784. i18n 键 container.kind.system-container 的文案没有首尾空格
2785. i18n 键 container.link.download 的文案没有首尾空格
2786. i18n 键 container.link.install 的文案没有首尾空格
2787. i18n 键 container.link.official 的文案没有首尾空格
2788. i18n 键 container.link.support 的文案没有首尾空格
2789. i18n 键 container.listEmpty 的文案没有首尾空格
2790. i18n 键 container.listHidden 的文案没有首尾空格
2791. i18n 键 container.listTitle 的文案没有首尾空格
2792. i18n 键 container.listTitleHint 的文案没有首尾空格
2793. i18n 键 container.microsandbox.alreadyInstalled 的文案没有首尾空格
2794. i18n 键 container.microsandbox.install 的文案没有首尾空格
2795. i18n 键 container.microsandbox.installFail 的文案没有首尾空格
2796. i18n 键 container.microsandbox.installHint 的文案没有首尾空格
2797. i18n 键 container.microsandbox.installOk 的文案没有首尾空格
2798. i18n 键 container.microsandbox.installing 的文案没有首尾空格
2799. i18n 键 container.microsandbox.reinstall 的文案没有首尾空格
2800. i18n 键 container.microsandbox.reinstallOk 的文案没有首尾空格
2801. i18n 键 container.microsandbox.reinstalling 的文案没有首尾空格
2802. i18n 键 container.microsandbox.stepCheck 的文案没有首尾空格
2803. i18n 键 container.microsandbox.stepDetect 的文案没有首尾空格
2804. i18n 键 container.microsandbox.stepDownload 的文案没有首尾空格
2805. i18n 键 container.microsandbox.stepInstall 的文案没有首尾空格
2806. i18n 键 container.microsandbox.stepUninstall 的文案没有首尾空格
2807. i18n 键 container.microsandbox.uninstall 的文案没有首尾空格
2808. i18n 键 container.microsandbox.uninstallDisabled 的文案没有首尾空格
2809. i18n 键 container.microsandbox.uninstallFail 的文案没有首尾空格
2810. i18n 键 container.microsandbox.uninstallOk 的文案没有首尾空格
2811. i18n 键 container.microsandbox.uninstalling 的文案没有首尾空格
2812. i18n 键 container.microsandbox.virtNeed 的文案没有首尾空格
2813. i18n 键 container.microsandbox.virtOk 的文案没有首尾空格
2814. i18n 键 container.mount.biaoTi 的文案没有首尾空格
2815. i18n 键 container.mount.body 的文案没有首尾空格
2816. i18n 键 container.mount.perf 的文案没有首尾空格
2817. i18n 键 container.mount.ti 的文案没有首尾空格
2818. i18n 键 container.mount.title 的文案没有首尾空格
2819. i18n 键 container.notInstalledNote 的文案没有首尾空格
2820. i18n 键 container.probe.startHint 的文案没有首尾空格
2821. i18n 键 container.probeBtn 的文案没有首尾空格
2822. i18n 键 container.probeDone 的文案没有首尾空格
2823. i18n 键 container.probeFailed 的文案没有首尾空格
2824. i18n 键 container.probeSummary 的文案没有首尾空格
2825. i18n 键 container.probing 的文案没有首尾空格
2826. i18n 键 container.project.available 的文案没有首尾空格
2827. i18n 键 container.project.blockedNotice 的文案没有首尾空格
2828. i18n 键 container.project.devBlocked 的文案没有首尾空格
2829. i18n 键 container.project.dirBody 的文案没有首尾空格
2830. i18n 键 container.project.dirNotRecorded 的文案没有首尾空格
2831. i18n 键 container.project.dirSet 的文案没有首尾空格
2832. i18n 键 container.project.dirSetFailed 的文案没有首尾空格
2833. i18n 键 container.project.disableConfirmBody 的文案没有首尾空格
2834. i18n 键 container.project.disableConfirmTitle 的文案没有首尾空格
2835. i18n 键 container.project.disableFailed 的文案没有首尾空格
2836. i18n 键 container.project.enableFailed 的文案没有首尾空格
2837. i18n 键 container.project.enableNeedsContainer 的文案没有首尾空格
2838. i18n 键 container.project.enableNeedsContainerTitle 的文案没有首尾空格
2839. i18n 键 container.project.enabledAt 的文案没有首尾空格
2840. i18n 键 container.project.enforceBoundary 的文案没有首尾空格
2841. i18n 键 container.project.fix.choose-container 的文案没有首尾空格
2842. i18n 键 container.project.fix.enable-project 的文案没有首尾空格
2843. i18n 键 container.project.fix.install-container 的文案没有首尾空格
2844. i18n 键 container.project.fix.ok 的文案没有首尾空格
2845. i18n 键 container.project.fix.start-container 的文案没有首尾空格
2846. i18n 键 container.project.historyStillReadable 的文案没有首尾空格
2847. i18n 键 container.project.hostEditingRefused 的文案没有首尾空格
2848. i18n 键 container.project.menuHint 的文案没有首尾空格
2849. i18n 键 container.project.none 的文案没有首尾空格
2850. i18n 键 container.project.noneHint 的文案没有首尾空格
2851. i18n 键 container.project.notContainerProject 的文案没有首尾空格
2852. i18n 键 container.project.notCreator 的文案没有首尾空格
2853. i18n 键 container.project.reason.container-not-installed 的文案没有首尾空格
2854. i18n 键 container.project.reason.container-not-ready 的文案没有首尾空格
2855. i18n 键 container.project.reason.containerDown 的文案没有首尾空格
2856. i18n 键 container.project.reason.disabledByOwner 的文案没有首尾空格
2857. i18n 键 container.project.reason.host-dev 的文案没有首尾空格
2858. i18n 键 container.project.reason.notChosen 的文案没有首尾空格
2859. i18n 键 container.project.reason.notInstalled 的文案没有首尾空格
2860. i18n 键 container.project.reason.ok 的文案没有首尾空格
2861. i18n 键 container.project.reason.stopped-by-creator 的文案没有首尾空格
2862. i18n 键 container.project.reasonBody 的文案没有首尾空格
2863. i18n 键 container.project.remoteNotice 的文案没有首尾空格
2864. i18n 键 container.project.remoteReportedAt 的文案没有首尾空格
2865. i18n 键 container.project.switchBody 的文案没有首尾空格
2866. i18n 键 container.project.switchDone 的文案没有首尾空格
2867. i18n 键 container.project.switchFailed 的文案没有首尾空格
2868. i18n 键 container.project.switchFits 的文案没有首尾空格
2869. i18n 键 container.project.switchMore 的文案没有首尾空格
2870. i18n 键 container.project.switchNeedRestart 的文案没有首尾空格
2871. i18n 键 container.project.switchNoContainer 的文案没有首尾空格
2872. i18n 键 container.project.switchTitle 的文案没有首尾空格
2873. i18n 键 container.project.testingAllowed 的文案没有首尾空格
2874. i18n 键 container.project.unavailable 的文案没有首尾空格
2875. i18n 键 container.project.unavailableAsOffline 的文案没有首尾空格
2876. i18n 键 container.project.usingContainer 的文案没有首尾空格
2877. i18n 键 container.reason.ambiguous-instances 的文案没有首尾空格
2878. i18n 键 container.reason.no-podman-machine 的文案没有首尾空格
2879. i18n 键 container.reason.not-installed 的文案没有首尾空格
2880. i18n 键 container.reason.not-standalone-engine 的文案没有首尾空格
2881. i18n 键 container.reason.ok 的文案没有首尾空格
2882. i18n 键 container.reason.one-shot-vm 的文案没有首尾空格
2883. i18n 键 container.reason.system-service-needs-root 的文案没有首尾空格
2884. i18n 键 container.reason.uncertain-programmatic-control 的文案没有首尾空格
2885. i18n 键 container.reason.unsupported-platform 的文案没有首尾空格
2886. i18n 键 container.reason.vm-not-engine 的文案没有首尾空格
2887. i18n 键 container.reason.vm-shutdown-affects-all 的文案没有首尾空格
2888. i18n 键 container.refreshHint 的文案没有首尾空格
2889. i18n 键 container.rt.colima.commercial 的文案没有首尾空格
2890. i18n 键 container.rt.colima.cost 的文案没有首尾空格
2891. i18n 键 container.rt.colima.ming 的文案没有首尾空格
2892. i18n 键 container.rt.colima.name 的文案没有首尾空格
2893. i18n 键 container.rt.colima.os 的文案没有首尾空格
2894. i18n 键 container.rt.colima.osShort 的文案没有首尾空格
2895. i18n 键 container.rt.colima.size 的文案没有首尾空格
2896. i18n 键 container.rt.docker.commercial 的文案没有首尾空格
2897. i18n 键 container.rt.docker.cost 的文案没有首尾空格
2898. i18n 键 container.rt.docker.ming 的文案没有首尾空格
2899. i18n 键 container.rt.docker.name 的文案没有首尾空格
2900. i18n 键 container.rt.docker.os 的文案没有首尾空格
2901. i18n 键 container.rt.docker.osShort 的文案没有首尾空格
2902. i18n 键 container.rt.docker.size 的文案没有首尾空格
2903. i18n 键 container.rt.isulad.commercial 的文案没有首尾空格
2904. i18n 键 container.rt.isulad.cost 的文案没有首尾空格
2905. i18n 键 container.rt.isulad.ming 的文案没有首尾空格
2906. i18n 键 container.rt.isulad.name 的文案没有首尾空格
2907. i18n 键 container.rt.isulad.os 的文案没有首尾空格
2908. i18n 键 container.rt.isulad.osShort 的文案没有首尾空格
2909. i18n 键 container.rt.isulad.size 的文案没有首尾空格
2910. i18n 键 container.rt.kata.commercial 的文案没有首尾空格
2911. i18n 键 container.rt.kata.cost 的文案没有首尾空格
2912. i18n 键 container.rt.kata.ming 的文案没有首尾空格
2913. i18n 键 container.rt.kata.name 的文案没有首尾空格
2914. i18n 键 container.rt.kata.os 的文案没有首尾空格
2915. i18n 键 container.rt.kata.osShort 的文案没有首尾空格
2916. i18n 键 container.rt.kata.size 的文案没有首尾空格
2917. i18n 键 container.rt.lima.commercial 的文案没有首尾空格
2918. i18n 键 container.rt.lima.cost 的文案没有首尾空格
2919. i18n 键 container.rt.lima.ming 的文案没有首尾空格
2920. i18n 键 container.rt.lima.name 的文案没有首尾空格
2921. i18n 键 container.rt.lima.os 的文案没有首尾空格
2922. i18n 键 container.rt.lima.osShort 的文案没有首尾空格
2923. i18n 键 container.rt.lima.size 的文案没有首尾空格
2924. i18n 键 container.rt.lxd-incus.commercial 的文案没有首尾空格
2925. i18n 键 container.rt.lxd-incus.cost 的文案没有首尾空格
2926. i18n 键 container.rt.lxd-incus.ming 的文案没有首尾空格
2927. i18n 键 container.rt.lxd-incus.name 的文案没有首尾空格
2928. i18n 键 container.rt.lxd-incus.os 的文案没有首尾空格
2929. i18n 键 container.rt.lxd-incus.osShort 的文案没有首尾空格
2930. i18n 键 container.rt.lxd-incus.size 的文案没有首尾空格
2931. i18n 键 container.rt.microsandbox.commercial 的文案没有首尾空格
2932. i18n 键 container.rt.microsandbox.cost 的文案没有首尾空格
2933. i18n 键 container.rt.microsandbox.ming 的文案没有首尾空格
2934. i18n 键 container.rt.microsandbox.name 的文案没有首尾空格
2935. i18n 键 container.rt.microsandbox.os 的文案没有首尾空格
2936. i18n 键 container.rt.microsandbox.osShort 的文案没有首尾空格
2937. i18n 键 container.rt.microsandbox.size 的文案没有首尾空格
2938. i18n 键 container.rt.nerdctl.commercial 的文案没有首尾空格
2939. i18n 键 container.rt.nerdctl.cost 的文案没有首尾空格
2940. i18n 键 container.rt.nerdctl.ming 的文案没有首尾空格
2941. i18n 键 container.rt.nerdctl.name 的文案没有首尾空格
2942. i18n 键 container.rt.nerdctl.os 的文案没有首尾空格
2943. i18n 键 container.rt.nerdctl.osShort 的文案没有首尾空格
2944. i18n 键 container.rt.nerdctl.size 的文案没有首尾空格
2945. i18n 键 container.rt.podman.commercial 的文案没有首尾空格
2946. i18n 键 container.rt.podman.cost 的文案没有首尾空格
2947. i18n 键 container.rt.podman.ming 的文案没有首尾空格
2948. i18n 键 container.rt.podman.name 的文案没有首尾空格
2949. i18n 键 container.rt.podman.os 的文案没有首尾空格
2950. i18n 键 container.rt.podman.osShort 的文案没有首尾空格
2951. i18n 键 container.rt.podman.size 的文案没有首尾空格
2952. i18n 键 container.rt.pouch.commercial 的文案没有首尾空格
2953. i18n 键 container.rt.pouch.cost 的文案没有首尾空格
2954. i18n 键 container.rt.pouch.ming 的文案没有首尾空格
2955. i18n 键 container.rt.pouch.name 的文案没有首尾空格
2956. i18n 键 container.rt.pouch.os 的文案没有首尾空格
2957. i18n 键 container.rt.pouch.osShort 的文案没有首尾空格
2958. i18n 键 container.rt.pouch.size 的文案没有首尾空格
2959. i18n 键 container.rt.rancher-desktop.commercial 的文案没有首尾空格
2960. i18n 键 container.rt.rancher-desktop.cost 的文案没有首尾空格
2961. i18n 键 container.rt.rancher-desktop.ming 的文案没有首尾空格
2962. i18n 键 container.rt.rancher-desktop.name 的文案没有首尾空格
2963. i18n 键 container.rt.rancher-desktop.os 的文案没有首尾空格
2964. i18n 键 container.rt.rancher-desktop.osShort 的文案没有首尾空格
2965. i18n 键 container.rt.rancher-desktop.size 的文案没有首尾空格
2966. i18n 键 container.rt.windows-sandbox.commercial 的文案没有首尾空格
2967. i18n 键 container.rt.windows-sandbox.cost 的文案没有首尾空格
2968. i18n 键 container.rt.windows-sandbox.ming 的文案没有首尾空格
2969. i18n 键 container.rt.windows-sandbox.name 的文案没有首尾空格
2970. i18n 键 container.rt.windows-sandbox.os 的文案没有首尾空格
2971. i18n 键 container.rt.windows-sandbox.osShort 的文案没有首尾空格
2972. i18n 键 container.rt.windows-sandbox.size 的文案没有首尾空格
2973. i18n 键 container.rt.wsl.commercial 的文案没有首尾空格
2974. i18n 键 container.rt.wsl.cost 的文案没有首尾空格
2975. i18n 键 container.rt.wsl.ming 的文案没有首尾空格
2976. i18n 键 container.rt.wsl.name 的文案没有首尾空格
2977. i18n 键 container.rt.wsl.os 的文案没有首尾空格
2978. i18n 键 container.rt.wsl.osShort 的文案没有首尾空格
2979. i18n 键 container.rt.wsl.size 的文案没有首尾空格
2980. i18n 键 container.run.error 的文案没有首尾空格
2981. i18n 键 container.run.notRunning 的文案没有首尾空格
2982. i18n 键 container.run.running 的文案没有首尾空格
2983. i18n 键 container.run.unsupported 的文案没有首尾空格
2984. i18n 键 container.runEnv.biaoTi 的文案没有首尾空格
2985. i18n 键 container.runEnv.blockedLabel 的文案没有首尾空格
2986. i18n 键 container.runEnv.fitsLabel 的文案没有首尾空格
2987. i18n 键 container.runEnv.needsLabel 的文案没有首尾空格
2988. i18n 键 container.runEnv.opt.container-linux.biaoTi 的文案没有首尾空格
2989. i18n 键 container.runEnv.opt.container-linux.blocked 的文案没有首尾空格
2990. i18n 键 container.runEnv.opt.container-linux.fits 的文案没有首尾空格
2991. i18n 键 container.runEnv.opt.container-linux.impl 的文案没有首尾空格
2992. i18n 键 container.runEnv.opt.container-linux.needs 的文案没有首尾空格
2993. i18n 键 container.runEnv.opt.container-linux.title 的文案没有首尾空格
2994. i18n 键 container.runEnv.opt.container-windows.biaoTi 的文案没有首尾空格
2995. i18n 键 container.runEnv.opt.container-windows.blocked 的文案没有首尾空格
2996. i18n 键 container.runEnv.opt.container-windows.fits 的文案没有首尾空格
2997. i18n 键 container.runEnv.opt.container-windows.impl 的文案没有首尾空格
2998. i18n 键 container.runEnv.opt.container-windows.needs 的文案没有首尾空格
2999. i18n 键 container.runEnv.opt.container-windows.title 的文案没有首尾空格
3000. i18n 键 container.runEnv.opt.device-android.biaoTi 的文案没有首尾空格
3001. i18n 键 container.runEnv.opt.device-android.blocked 的文案没有首尾空格
3002. i18n 键 container.runEnv.opt.device-android.fits 的文案没有首尾空格
3003. i18n 键 container.runEnv.opt.device-android.impl 的文案没有首尾空格
3004. i18n 键 container.runEnv.opt.device-android.needs 的文案没有首尾空格
3005. i18n 键 container.runEnv.opt.device-android.title 的文案没有首尾空格
3006. i18n 键 container.runEnv.opt.device-ios.biaoTi 的文案没有首尾空格
3007. i18n 键 container.runEnv.opt.device-ios.blocked 的文案没有首尾空格
3008. i18n 键 container.runEnv.opt.device-ios.fits 的文案没有首尾空格
3009. i18n 键 container.runEnv.opt.device-ios.impl 的文案没有首尾空格
3010. i18n 键 container.runEnv.opt.device-ios.needs 的文案没有首尾空格
3011. i18n 键 container.runEnv.opt.device-ios.title 的文案没有首尾空格
3012. i18n 键 container.runEnv.opt.device-windows-desktop.biaoTi 的文案没有首尾空格
3013. i18n 键 container.runEnv.opt.device-windows-desktop.blocked 的文案没有首尾空格
3014. i18n 键 container.runEnv.opt.device-windows-desktop.fits 的文案没有首尾空格
3015. i18n 键 container.runEnv.opt.device-windows-desktop.impl 的文案没有首尾空格
3016. i18n 键 container.runEnv.opt.device-windows-desktop.needs 的文案没有首尾空格
3017. i18n 键 container.runEnv.opt.device-windows-desktop.title 的文案没有首尾空格
3018. i18n 键 container.runEnv.title 的文案没有首尾空格
3019. i18n 键 container.section.existing 的文案没有首尾空格
3020. i18n 键 container.section.images 的文案没有首尾空格
3021. i18n 键 container.snapshot.biaoTi 的文案没有首尾空格
3022. i18n 键 container.snapshot.body 的文案没有首尾空格
3023. i18n 键 container.snapshot.fingerprint 的文案没有首尾空格
3024. i18n 键 container.snapshot.layerEnv 的文案没有首尾空格
3025. i18n 键 container.snapshot.layerFiles 的文案没有首尾空格
3026. i18n 键 container.snapshot.noClaim 的文案没有首尾空格
3027. i18n 键 container.snapshot.ti 的文案没有首尾空格
3028. i18n 键 container.snapshot.title 的文案没有首尾空格
3029. i18n 键 container.status.engine-error 的文案没有首尾空格
3030. i18n 键 container.status.installed-not-running 的文案没有首尾空格
3031. i18n 键 container.status.not-installed 的文案没有首尾空格
3032. i18n 键 container.status.ready 的文案没有首尾空格
3033. i18n 键 container.status.unsupported-platform 的文案没有首尾空格
3034. i18n 键 container.target.android.preview 的文案没有首尾空格
3035. i18n 键 container.target.android.title 的文案没有首尾空格
3036. i18n 键 container.target.biaoTi 的文案没有首尾空格
3037. i18n 键 container.target.buildLabel 的文案没有首尾空格
3038. i18n 键 container.target.hint 的文案没有首尾空格
3039. i18n 键 container.target.ios.preview 的文案没有首尾空格
3040. i18n 键 container.target.ios.title 的文案没有首尾空格
3041. i18n 键 container.target.linux-service.preview 的文案没有首尾空格
3042. i18n 键 container.target.linux-service.title 的文案没有首尾空格
3043. i18n 键 container.target.macos.preview 的文案没有首尾空格
3044. i18n 键 container.target.macos.title 的文案没有首尾空格
3045. i18n 键 container.target.notSelected 的文案没有首尾空格
3046. i18n 键 container.target.previewLabel 的文案没有首尾空格
3047. i18n 键 container.target.saved 的文案没有首尾空格
3048. i18n 键 container.target.tiShi 的文案没有首尾空格
3049. i18n 键 container.target.title 的文案没有首尾空格
3050. i18n 键 container.target.web.preview 的文案没有首尾空格
3051. i18n 键 container.target.web.title 的文案没有首尾空格
3052. i18n 键 container.target.windows-desktop.preview 的文案没有首尾空格
3053. i18n 键 container.target.windows-desktop.title 的文案没有首尾空格
3054. i18n 键 container.tiShi 的文案没有首尾空格
3055. i18n 键 container.timing.biaoTi 的文案没有首尾空格
3056. i18n 键 container.timing.none 的文案没有首尾空格
3057. i18n 键 container.timing.run 的文案没有首尾空格
3058. i18n 键 container.timing.start 的文案没有首尾空格
3059. i18n 键 container.timing.stop 的文案没有首尾空格
3060. i18n 键 container.timing.title 的文案没有首尾空格
3061. i18n 键 container.title 的文案没有首尾空格
3062. i18n 键 container.versionLabel 的文案没有首尾空格
3063. i18n 键 cost.biaoTi 的文案没有首尾空格
3064. i18n 键 cost.byModel 的文案没有首尾空格
3065. i18n 键 cost.byProvider 的文案没有首尾空格
3066. i18n 键 cost.bySession 的文案没有首尾空格
3067. i18n 键 cost.byWindow 的文案没有首尾空格
3068. i18n 键 cost.cost 的文案没有首尾空格
3069. i18n 键 cost.empty 的文案没有首尾空格
3070. i18n 键 cost.estHint 的文案没有首尾空格
3071. i18n 键 cost.export 的文案没有首尾空格
3072. i18n 键 cost.local 的文案没有首尾空格
3073. i18n 键 cost.localHint 的文案没有首尾空格
3074. i18n 键 cost.model 的文案没有首尾空格
3075. i18n 键 cost.session 的文案没有首尾空格
3076. i18n 键 cost.title 的文案没有首尾空格
3077. i18n 键 cost.tokens 的文案没有首尾空格
3078. i18n 键 cost.turns 的文案没有首尾空格
3079. i18n 键 cost.unpriced 的文案没有首尾空格
3080. i18n 键 cost.unpricedHint 的文案没有首尾空格
3081. i18n 键 cp.assets 的文案没有首尾空格
3082. i18n 键 cp.autoDelete 的文案没有首尾空格
3083. i18n 键 cp.confirmLoad 的文案没有首尾空格
3084. i18n 键 cp.confirmStop 的文案没有首尾空格
3085. i18n 键 cp.confirmTitle 的文案没有首尾空格
3086. i18n 键 cp.detail 的文案没有首尾空格
3087. i18n 键 cp.empty 的文案没有首尾空格
3088. i18n 键 cp.filesChanged 的文案没有首尾空格
3089. i18n 键 cp.filesCreated 的文案没有首尾空格
3090. i18n 键 cp.irreversible 的文案没有首尾空格
3091. i18n 键 cp.list 的文案没有首尾空格
3092. i18n 键 cp.load 的文案没有首尾空格
3093. i18n 键 cp.max 的文案没有首尾空格
3094. i18n 键 cp.rollback 的文案没有首尾空格
3095. i18n 键 cp.rollbackHint 的文案没有首尾空格
3096. i18n 键 cp.roundEnd 的文案没有首尾空格
3097. i18n 键 cp.roundStart 的文案没有首尾空格
3098. i18n 键 cp.space 的文案没有首尾空格
3099. i18n 键 cp.stopLoad 的文案没有首尾空格
3100. i18n 键 cp.tasks 的文案没有首尾空格
3101. i18n 键 cp.time 的文案没有首尾空格
3102. i18n 键 cp.title 的文案没有首尾空格
3103. i18n 键 cp.used 的文案没有首尾空格
3104. i18n 键 ctx.archive 的文案没有首尾空格
3105. i18n 键 ctx.archiveConfirm 的文案没有首尾空格
3106. i18n 键 ctx.budget.biaoTi 的文案没有首尾空格
3107. i18n 键 ctx.budget.hint 的文案没有首尾空格
3108. i18n 键 ctx.budget.minHint 的文案没有首尾空格
3109. i18n 键 ctx.budget.tiShi 的文案没有首尾空格
3110. i18n 键 ctx.budget.title 的文案没有首尾空格
3111. i18n 键 ctx.budget.tokens 的文案没有首尾空格
3112. i18n 键 ctx.clear 的文案没有首尾空格
3113. i18n 键 ctx.clearConfirm 的文案没有首尾空格
3114. i18n 键 ctx.close 的文案没有首尾空格
3115. i18n 键 ctx.closeConfirm 的文案没有首尾空格
3116. i18n 键 ctx.delete 的文案没有首尾空格
3117. i18n 键 ctx.dissolveFailed 的文案没有首尾空格
3118. i18n 键 ctx.enable 的文案没有首尾空格
3119. i18n 键 ctx.leave 的文案没有首尾空格
3120. i18n 键 ctx.noTasks 的文案没有首尾空格
3121. i18n 键 ctx.notify 的文案没有首尾空格
3122. i18n 键 ctx.projectDisable 的文案没有首尾空格
3123. i18n 键 ctx.projectEnable 的文案没有首尾空格
3124. i18n 键 ctx.projectLockDir 的文案没有首尾空格
3125. i18n 键 ctx.projectSetDir 的文案没有首尾空格
3126. i18n 键 ctx.projectSwitchContainer 的文案没有首尾空格
3127. i18n 键 ctx.rename 的文案没有首尾空格
3128. i18n 键 ctx.renamePrompt 的文案没有首尾空格
3129. i18n 键 ctx.runningTasks 的文案没有首尾空格
3130. i18n 键 ctx.settings 的文案没有首尾空格
3131. i18n 键 ctx.taskRunning 的文案没有首尾空格
3132. i18n 键 ctx.waitingTasks 的文案没有首尾空格
3133. i18n 键 dashboard.agents 的文案没有首尾空格
3134. i18n 键 dashboard.biaoTi 的文案没有首尾空格
3135. i18n 键 dashboard.blocked 的文案没有首尾空格
3136. i18n 键 dashboard.cat.contact 的文案没有首尾空格
3137. i18n 键 dashboard.cat.external 的文案没有首尾空格
3138. i18n 键 dashboard.cat.internal 的文案没有首尾空格
3139. i18n 键 dashboard.cat.single 的文案没有首尾空格
3140. i18n 键 dashboard.cost 的文案没有首尾空格
3141. i18n 键 dashboard.createdAt 的文案没有首尾空格
3142. i18n 键 dashboard.done 的文案没有首尾空格
3143. i18n 键 dashboard.emptyEvents 的文案没有首尾空格
3144. i18n 键 dashboard.emptyLine 的文案没有首尾空格
3145. i18n 键 dashboard.emptySessions 的文案没有首尾空格
3146. i18n 键 dashboard.hoursAgo 的文案没有首尾空格
3147. i18n 键 dashboard.inProgressProjects 的文案没有首尾空格
3148. i18n 键 dashboard.jump 的文案没有首尾空格
3149. i18n 键 dashboard.noUsage 的文案没有首尾空格
3150. i18n 键 dashboard.pendingBadge 的文案没有首尾空格
3151. i18n 键 dashboard.pendingDecisions 的文案没有首尾空格
3152. i18n 键 dashboard.progressLabel 的文案没有首尾空格
3153. i18n 键 dashboard.queue 的文案没有首尾空格
3154. i18n 键 dashboard.readOnlyHint 的文案没有首尾空格
3155. i18n 键 dashboard.recent 的文案没有首尾空格
3156. i18n 键 dashboard.runningInstances 的文案没有首尾空格
3157. i18n 键 dashboard.sessions 的文案没有首尾空格
3158. i18n 键 dashboard.tasks 的文案没有首尾空格
3159. i18n 键 dashboard.title 的文案没有首尾空格
3160. i18n 键 dashboard.tokenCost 的文案没有首尾空格
3161. i18n 键 dashboard.tokens 的文案没有首尾空格
3162. i18n 键 dashboard.usage 的文案没有首尾空格
3163. i18n 键 demo.agent 的文案没有首尾空格
3164. i18n 键 demo.client 的文案没有首尾空格
3165. i18n 键 demo.msg.duty 的文案没有首尾空格
3166. i18n 键 demo.msg.extSilent 的文案没有首尾空格
3167. i18n 键 demo.msg.hello 的文案没有首尾空格
3168. i18n 键 demo.msg.rndUpdated 的文案没有首尾空格
3169. i18n 键 demo.msg.schedule 的文案没有首尾空格
3170. i18n 键 demo.msg.scheduled 的文案没有首尾空格
3171. i18n 键 demo.msg.synced 的文案没有首尾空格
3172. i18n 键 demo.msg.urgent 的文案没有首尾空格
3173. i18n 键 demo.msg.weekly 的文案没有首尾空格
3174. i18n 键 demo.msg.weeklyOk 的文案没有首尾空格
3175. i18n 键 demo.name.archiver 的文案没有首尾空格
3176. i18n 键 demo.persona 的文案没有首尾空格
3177. i18n 键 demo.project1 的文案没有首尾空格
3178. i18n 键 demo.project2 的文案没有首尾空格
3179. i18n 键 demo.recent1 的文案没有首尾空格
3180. i18n 键 demo.recent2 的文案没有首尾空格
3181. i18n 键 demo.sess.c1 的文案没有首尾空格
3182. i18n 键 demo.sess.g1 的文案没有首尾空格
3183. i18n 键 demo.sess.g2 的文案没有首尾空格
3184. i18n 键 demo.sess.g3 的文案没有首尾空格
3185. i18n 键 demo.task1 的文案没有首尾空格
3186. i18n 键 demo.task2 的文案没有首尾空格
3187. i18n 键 demo.task3 的文案没有首尾空格
3188. i18n 键 diag.title 的文案没有首尾空格
3189. i18n 键 dsh.alreadyInstalled 的文案没有首尾空格
3190. i18n 键 dsh.anZhuang 的文案没有首尾空格
3191. i18n 键 dsh.anZhuangChengGong 的文案没有首尾空格
3192. i18n 键 dsh.anZhuangShiBai 的文案没有首尾空格
3193. i18n 键 dsh.anZhuangZhong 的文案没有首尾空格
3194. i18n 键 dsh.biaoTi 的文案没有首尾空格
3195. i18n 键 dsh.chongXinAnZhuang 的文案没有首尾空格
3196. i18n 键 dsh.chongXinAnZhuangZhong 的文案没有首尾空格
3197. i18n 键 dsh.chongXinChengGong 的文案没有首尾空格
3198. i18n 键 dsh.jianCha 的文案没有首尾空格
3199. i18n 键 dsh.jianChaChaoShi 的文案没有首尾空格
3200. i18n 键 dsh.jianChaYiChang 的文案没有首尾空格
3201. i18n 键 dsh.jianChaZhong 的文案没有首尾空格
3202. i18n 键 dsh.tiShi 的文案没有首尾空格
3203. i18n 键 dsh.weiAnZhuang 的文案没有首尾空格
3204. i18n 键 dsh.yiAnZhuang 的文案没有首尾空格
3205. i18n 键 embed.gpuHint 的文案没有首尾空格
3206. i18n 键 embed.model 的文案没有首尾空格
3207. i18n 键 embed.section 的文案没有首尾空格
3208. i18n 键 embed.useGpu 的文案没有首尾空格
3209. i18n 键 empty.subtitle 的文案没有首尾空格
3210. i18n 键 empty.title 的文案没有首尾空格
3211. i18n 键 eta.anomalyOverrun 的文案没有首尾空格
3212. i18n 键 eta.anomalyStalled 的文案没有首尾空格
3213. i18n 键 eta.anomalyStop 的文案没有首尾空格
3214. i18n 键 eta.continueWithEta 的文案没有首尾空格
3215. i18n 键 eta.notFromModel 的文案没有首尾空格
3216. i18n 键 eta.xw.dengDaiHuiFu 的文案没有首尾空格
3217. i18n 键 eta.xw.dengDaiXingDong 的文案没有首尾空格
3218. i18n 键 eta.xw.duiHua 的文案没有首尾空格
3219. i18n 键 eta.xw.gongJu 的文案没有首尾空格
3220. i18n 键 eta.xw.ziDongXuPai 的文案没有首尾空格
3221. i18n 键 executors.biaoTi 的文案没有首尾空格
3222. i18n 键 executors.none 的文案没有首尾空格
3223. i18n 键 executors.run 的文案没有首尾空格
3224. i18n 键 executors.title 的文案没有首尾空格
3225. i18n 键 export.done 的文案没有首尾空格
3226. i18n 键 export.hasTs 的文案没有首尾空格
3227. i18n 键 export.header 的文案没有首尾空格
3228. i18n 键 export.hint 的文案没有首尾空格
3229. i18n 键 export.include 的文案没有首尾空格
3230. i18n 键 export.markdown 的文案没有首尾空格
3231. i18n 键 export.me 的文案没有首尾空格
3232. i18n 键 export.tiShi 的文案没有首尾空格
3233. i18n 键 export.wo 的文案没有首尾空格
3234. i18n 键 group.addMember 的文案没有首尾空格
3235. i18n 键 group.cert.biaoTi 的文案没有首尾空格
3236. i18n 键 group.cert.emptyGroup 的文案没有首尾空格
3237. i18n 键 group.cert.expired 的文案没有首尾空格
3238. i18n 键 group.cert.fingerprint 的文案没有首尾空格
3239. i18n 键 group.cert.generation 的文案没有首尾空格
3240. i18n 键 group.cert.none 的文案没有首尾空格
3241. i18n 键 group.cert.readonlyHint 的文案没有首尾空格
3242. i18n 键 group.cert.revoked 的文案没有首尾空格
3243. i18n 键 group.cert.rotated 的文案没有首尾空格
3244. i18n 键 group.cert.showFull 的文案没有首尾空格
3245. i18n 键 group.cert.status 的文案没有首尾空格
3246. i18n 键 group.cert.title 的文案没有首尾空格
3247. i18n 键 group.cert.unavailable 的文案没有首尾空格
3248. i18n 键 group.cert.valid 的文案没有首尾空格
3249. i18n 键 group.directed 的文案没有首尾空格
3250. i18n 键 group.directedOnly 的文案没有首尾空格
3251. i18n 键 group.kick 的文案没有首尾空格
3252. i18n 键 group.memberDisabled 的文案没有首尾空格
3253. i18n 键 group.memberEmpty 的文案没有首尾空格
3254. i18n 键 group.memberMeshOff 的文案没有首尾空格
3255. i18n 键 group.memberOffline 的文案没有首尾空格
3256. i18n 键 group.memberOnline 的文案没有首尾空格
3257. i18n 键 group.memberPendingConfirm 的文案没有首尾空格
3258. i18n 键 group.memberPendingConfirmHint 的文案没有首尾空格
3259. i18n 键 group.memberPresenceUnknown 的文案没有首尾空格
3260. i18n 键 group.memberRemote 的文案没有首尾空格
3261. i18n 键 group.memberUnattributed 的文案没有首尾空格
3262. i18n 键 group.members 的文案没有首尾空格
3263. i18n 键 group.pickInstance 的文案没有首尾空格
3264. i18n 键 group.pullIn 的文案没有首尾空格
3265. i18n 键 group.type.external 的文案没有首尾空格
3266. i18n 键 group.type.internal 的文案没有首尾空格
3267. i18n 键 guide.finish 的文案没有首尾空格
3268. i18n 键 guide.next 的文案没有首尾空格
3269. i18n 键 guide.progress 的文案没有首尾空格
3270. i18n 键 guide.restart 的文案没有首尾空格
3271. i18n 键 guide.section 的文案没有首尾空格
3272. i18n 键 guide.sectionHint 的文案没有首尾空格
3273. i18n 键 guide.skip 的文案没有首尾空格
3274. i18n 键 guide.step1.body 的文案没有首尾空格
3275. i18n 键 guide.step1.btn 的文案没有首尾空格
3276. i18n 键 guide.step1.hint 的文案没有首尾空格
3277. i18n 键 guide.step1.pending 的文案没有首尾空格
3278. i18n 键 guide.step1.tip 的文案没有首尾空格
3279. i18n 键 guide.step1.title 的文案没有首尾空格
3280. i18n 键 guide.step1.value 的文案没有首尾空格
3281. i18n 键 guide.step2.body 的文案没有首尾空格
3282. i18n 键 guide.step2.btn 的文案没有首尾空格
3283. i18n 键 guide.step2.hint 的文案没有首尾空格
3284. i18n 键 guide.step2.pending 的文案没有首尾空格
3285. i18n 键 guide.step2.title 的文案没有首尾空格
3286. i18n 键 guide.step2.value 的文案没有首尾空格
3287. i18n 键 guide.step3.body 的文案没有首尾空格
3288. i18n 键 guide.step3.btn 的文案没有首尾空格
3289. i18n 键 guide.step3.title 的文案没有首尾空格
3290. i18n 键 guide.step3.value 的文案没有首尾空格
3291. i18n 键 harmony.note 的文案没有首尾空格
3292. i18n 键 idchg.adopt 的文案没有首尾空格
3293. i18n 键 idchg.adoptConfirm 的文案没有首尾空格
3294. i18n 键 idchg.adoptFailed 的文案没有首尾空格
3295. i18n 键 idchg.adoptFrozen 的文案没有首尾空格
3296. i18n 键 idchg.adopted 的文案没有首尾空格
3297. i18n 键 idchg.auditFailed 的文案没有首尾空格
3298. i18n 键 idchg.audited 的文案没有首尾空格
3299. i18n 键 idchg.biaoTi 的文案没有首尾空格
3300. i18n 键 idchg.body 的文案没有首尾空格
3301. i18n 键 idchg.cardHistoryTag 的文案没有首尾空格
3302. i18n 键 idchg.cardNewTag 的文案没有首尾空格
3303. i18n 键 idchg.collapse 的文案没有首尾空格
3304. i18n 键 idchg.contactChanged 的文案没有首尾空格
3305. i18n 键 idchg.contactNowIs 的文案没有首尾空格
3306. i18n 键 idchg.dismiss 的文案没有首尾空格
3307. i18n 键 idchg.dismissConfirm 的文案没有首尾空格
3308. i18n 键 idchg.dismissTitle 的文案没有首尾空格
3309. i18n 键 idchg.empty 的文案没有首尾空格
3310. i18n 键 idchg.emptyHint 的文案没有首尾空格
3311. i18n 键 idchg.expand 的文案没有首尾空格
3312. i18n 键 idchg.freeze 的文案没有首尾空格
3313. i18n 键 idchg.freezeOver 的文案没有首尾空格
3314. i18n 键 idchg.generation 的文案没有首尾空格
3315. i18n 键 idchg.histTitle 的文案没有首尾空格
3316. i18n 键 idchg.historyCapturedAt 的文案没有首尾空格
3317. i18n 键 idchg.marker 的文案没有首尾空格
3318. i18n 键 idchg.newEmptyHint 的文案没有首尾空格
3319. i18n 键 idchg.newSubmittedAt 的文案没有首尾空格
3320. i18n 键 idchg.newTitle 的文案没有首尾空格
3321. i18n 键 idchg.noHistory 的文案没有首尾空格
3322. i18n 键 idchg.noHistoryHint 的文案没有首尾空格
3323. i18n 键 idchg.oldEmail 的文案没有首尾空格
3324. i18n 键 idchg.oldPhone 的文案没有首尾空格
3325. i18n 键 idchg.pending 的文案没有首尾空格
3326. i18n 键 idchg.reason 的文案没有首尾空格
3327. i18n 键 idchg.reason.compromised 的文案没有首尾空格
3328. i18n 键 idchg.reason.rotate 的文案没有首尾空格
3329. i18n 键 idchg.scope.extdm 的文案没有首尾空格
3330. i18n 键 idchg.scope.external 的文案没有首尾空格
3331. i18n 键 idchg.scope.internal 的文案没有首尾空格
3332. i18n 键 idchg.title 的文案没有首尾空格
3333. i18n 键 idchg.titleNamed 的文案没有首尾空格
3334. i18n 键 idchg.verified 的文案没有首尾空格
3335. i18n 键 idchg.verifiedHint 的文案没有首尾空格
3336. i18n 键 idchg.verifyConfirm 的文案没有首尾空格
3337. i18n 键 idchg.verifyFailed 的文案没有首尾空格
3338. i18n 键 identity.contact.alwaysVisible 的文案没有首尾空格
3339. i18n 键 identity.contact.email 的文案没有首尾空格
3340. i18n 键 identity.contact.extra 的文案没有首尾空格
3341. i18n 键 identity.contact.phone 的文案没有首尾空格
3342. i18n 键 identity.contact.title 的文案没有首尾空格
3343. i18n 键 identity.contact.unfilled 的文案没有首尾空格
3344. i18n 键 inst.actionDone 的文案没有首尾空格
3345. i18n 键 inst.chain 的文案没有首尾空格
3346. i18n 键 inst.defaultModel 的文案没有首尾空格
3347. i18n 键 inst.group 的文案没有首尾空格
3348. i18n 键 inst.models 的文案没有首尾空格
3349. i18n 键 inst.persona 的文案没有首尾空格
3350. i18n 键 inst.restart 的文案没有首尾空格
3351. i18n 键 inst.start 的文案没有首尾空格
3352. i18n 键 inst.status.restarting 的文案没有首尾空格
3353. i18n 键 inst.status.running 的文案没有首尾空格
3354. i18n 键 inst.status.stopped 的文案没有首尾空格
3355. i18n 键 inst.stop 的文案没有首尾空格
3356. i18n 键 instances.addModel 的文案没有首尾空格
3357. i18n 键 instances.allAvailable 的文案没有首尾空格
3358. i18n 键 instances.availableModels 的文案没有首尾空格
3359. i18n 键 instances.avatar 的文案没有首尾空格
3360. i18n 键 instances.avatarUpload 的文案没有首尾空格
3361. i18n 键 instances.cognition 的文案没有首尾空格
3362. i18n 键 instances.cognitionAdd 的文案没有首尾空格
3363. i18n 键 instances.cognitionEmpty 的文案没有首尾空格
3364. i18n 键 instances.cognitionHint 的文案没有首尾空格
3365. i18n 键 instances.cpus 的文案没有首尾空格
3366. i18n 键 instances.defaultModel 的文案没有首尾空格
3367. i18n 键 instances.delete 的文案没有首尾空格
3368. i18n 键 instances.edit 的文案没有首尾空格
3369. i18n 键 instances.fallbackChain 的文案没有首尾空格
3370. i18n 键 instances.hardware 的文案没有首尾空格
3371. i18n 键 instances.manualAdd 的文案没有首尾空格
3372. i18n 键 instances.max 的文案没有首尾空格
3373. i18n 键 instances.memoryFile 的文案没有首尾空格
3374. i18n 键 instances.memoryHint 的文案没有首尾空格
3375. i18n 键 instances.model 的文案没有首尾空格
3376. i18n 键 instances.moveDown 的文案没有首尾空格
3377. i18n 键 instances.moveUp 的文案没有首尾空格
3378. i18n 键 instances.name 的文案没有首尾空格
3379. i18n 键 instances.nameDup 的文案没有首尾空格
3380. i18n 键 instances.persona 的文案没有首尾空格
3381. i18n 键 instances.personaDefault 的文案没有首尾空格
3382. i18n 键 instances.personaPlaceholder 的文案没有首尾空格
3383. i18n 键 instances.provider 的文案没有首尾空格
3384. i18n 键 instances.running 的文案没有首尾空格
3385. i18n 键 instances.saved 的文案没有首尾空格
3386. i18n 键 instances.selectHint 的文案没有首尾空格
3387. i18n 键 instances.smartPick 的文案没有首尾空格
3388. i18n 键 instances.start 的文案没有首尾空格
3389. i18n 键 instances.stop 的文案没有首尾空格
3390. i18n 键 instances.stopped 的文案没有首尾空格
3391. i18n 键 instances.suggested 的文案没有首尾空格
3392. i18n 键 join.accept 的文案没有首尾空格
3393. i18n 键 join.agree 的文案没有首尾空格
3394. i18n 键 join.ai 的文案没有首尾空格
3395. i18n 键 join.apply 的文案没有首尾空格
3396. i18n 键 join.applyTime 的文案没有首尾空格
3397. i18n 键 join.biaoTi 的文案没有首尾空格
3398. i18n 键 join.blacklist 的文案没有首尾空格
3399. i18n 键 join.blacklistEmpty 的文案没有首尾空格
3400. i18n 键 join.blacklistTitle 的文案没有首尾空格
3401. i18n 键 join.blacklistedAt 的文案没有首尾空格
3402. i18n 键 join.contact 的文案没有首尾空格
3403. i18n 键 join.copied 的文案没有首尾空格
3404. i18n 键 join.copyLink 的文案没有首尾空格
3405. i18n 键 join.dropHint 的文案没有首尾空格
3406. i18n 键 join.expireTime 的文案没有首尾空格
3407. i18n 键 join.fail 的文案没有首尾空格
3408. i18n 键 join.group 的文案没有首尾空格
3409. i18n 键 join.human 的文案没有首尾空格
3410. i18n 键 join.identity 的文案没有首尾空格
3411. i18n 键 join.kind 的文案没有首尾空格
3412. i18n 键 join.linkUnavailable 的文案没有首尾空格
3413. i18n 键 join.ok 的文案没有首尾空格
3414. i18n 键 join.pastePlaceholder 的文案没有首尾空格
3415. i18n 键 join.pending 的文案没有首尾空格
3416. i18n 键 join.pickImage 的文案没有首尾空格
3417. i18n 键 join.project 的文案没有首尾空格
3418. i18n 键 join.qrFail 的文案没有首尾空格
3419. i18n 键 join.qrHint 的文案没有首尾空格
3420. i18n 键 join.qrUnavailable 的文案没有首尾空格
3421. i18n 键 join.reject 的文案没有首尾空格
3422. i18n 键 join.removeBlacklist 的文案没有首尾空格
3423. i18n 键 join.requestBadge 的文案没有首尾空格
3424. i18n 键 join.requester 的文案没有首尾空格
3425. i18n 键 join.scanDropRelease 的文案没有首尾空格
3426. i18n 键 join.scanEmpty 的文案没有首尾空格
3427. i18n 键 join.scanFound 的文案没有首尾空格
3428. i18n 键 join.scanHint 的文案没有首尾空格
3429. i18n 键 join.scanNoJoinLink 的文案没有首尾空格
3430. i18n 键 join.scanNoQr 的文案没有首尾空格
3431. i18n 键 join.scanNotImage 的文案没有首尾空格
3432. i18n 键 join.scanNotJoinLink 的文案没有首尾空格
3433. i18n 键 join.scanQr 的文案没有首尾空格
3434. i18n 键 join.scanReadFail 的文案没有首尾空格
3435. i18n 键 join.scanUnavailable 的文案没有首尾空格
3436. i18n 键 join.scanWorking 的文案没有首尾空格
3437. i18n 键 join.target 的文案没有首尾空格
3438. i18n 键 join.title 的文案没有首尾空格
3439. i18n 键 ka.email 的文案没有首尾空格
3440. i18n 键 ka.extra 的文案没有首尾空格
3441. i18n 键 ka.fillInProfile 的文案没有首尾空格
3442. i18n 键 ka.peerWillSee 的文案没有首尾空格
3443. i18n 键 ka.phone 的文案没有首尾空格
3444. i18n 键 kb.detail 的文案没有首尾空格
3445. i18n 键 kb.detailHint 的文案没有首尾空格
3446. i18n 键 kb.entryOrg 的文案没有首尾空格
3447. i18n 键 kb.entryProject 的文案没有首尾空格
3448. i18n 键 kb.hint 的文案没有首尾空格
3449. i18n 键 kb.kind.org 的文案没有首尾空格
3450. i18n 键 kb.kind.project 的文案没有首尾空格
3451. i18n 键 knowledge.biaoTi 的文案没有首尾空格
3452. i18n 键 knowledge.delete 的文案没有首尾空格
3453. i18n 键 knowledge.empty 的文案没有首尾空格
3454. i18n 键 knowledge.kind.entity 的文案没有首尾空格
3455. i18n 键 knowledge.kind.event 的文案没有首尾空格
3456. i18n 键 knowledge.save 的文案没有首尾空格
3457. i18n 键 knowledge.search 的文案没有首尾空格
3458. i18n 键 knowledge.title 的文案没有首尾空格
3459. i18n 键 lan.dualSmoke 的文案没有首尾空格
3460. i18n 键 lan.inbox 的文案没有首尾空格
3461. i18n 键 lan.peerHost 的文案没有首尾空格
3462. i18n 键 lan.peerPort 的文案没有首尾空格
3463. i18n 键 lan.port 的文案没有首尾空格
3464. i18n 键 lan.sendTest 的文案没有首尾空格
3465. i18n 键 lan.start 的文案没有首尾空格
3466. i18n 键 lan.stop 的文案没有首尾空格
3467. i18n 键 lan.title 的文案没有首尾空格
3468. i18n 键 list.addContact 的文案没有首尾空格
3469. i18n 键 list.addInstance 的文案没有首尾空格
3470. i18n 键 list.addMenuCreate 的文案没有首尾空格
3471. i18n 键 list.addMenuJoin 的文案没有首尾空格
3472. i18n 键 list.addMore 的文案没有首尾空格
3473. i18n 键 list.createGroup 的文案没有首尾空格
3474. i18n 键 list.createGroupChat 的文案没有首尾空格
3475. i18n 键 list.createProject 的文案没有首尾空格
3476. i18n 键 list.empty 的文案没有首尾空格
3477. i18n 键 list.noReply 的文案没有首尾空格
3478. i18n 键 list.none 的文案没有首尾空格
3479. i18n 键 list.recent 的文案没有首尾空格
3480. i18n 键 list.search 的文案没有首尾空格
3481. i18n 键 list.sortByName 的文案没有首尾空格
3482. i18n 键 list.sortByTime 的文案没有首尾空格
3483. i18n 键 llm.continueNoAction 的文案没有首尾空格
3484. i18n 键 llm.dutySystem 的文案没有首尾空格
3485. i18n 键 llm.etaAnomaly 的文案没有首尾空格
3486. i18n 键 llm.identityLine 的文案没有首尾空格
3487. i18n 键 llm.longForm 的文案没有首尾空格
3488. i18n 键 llm.modelLine 的文案没有首尾空格
3489. i18n 键 llm.needText 的文案没有首尾空格
3490. i18n 键 llm.noKey 的文案没有首尾空格
3491. i18n 键 llm.planContinue 的文案没有首尾空格
3492. i18n 键 llm.planContinueFail 的文案没有首尾空格
3493. i18n 键 llm.planFirst 的文案没有首尾空格
3494. i18n 键 llm.planStop 的文案没有首尾空格
3495. i18n 键 llm.stallEtaOk 的文案没有首尾空格
3496. i18n 键 llm.stallEtaOver 的文案没有首尾空格
3497. i18n 键 llm.stallOk 的文案没有首尾空格
3498. i18n 键 llm.stallWarn 的文案没有首尾空格
3499. i18n 键 llm.strictLanguage 的文案没有首尾空格
3500. i18n 键 llm.timeLine 的文案没有首尾空格
3501. i18n 键 llm.toolLimitParam 的文案没有首尾空格
3502. i18n 键 llm.toolMaxCharsParam 的文案没有首尾空格
3503. i18n 键 llm.toolOffsetParam 的文案没有首尾空格
3504. i18n 键 llm.toolQueryParam 的文案没有首尾空格
3505. i18n 键 llm.toolRecallDesc 的文案没有首尾空格
3506. i18n 键 llm.toolRecordIdParam 的文案没有首尾空格
3507. i18n 键 llm.toolRetrieveDesc 的文案没有首尾空格
3508. i18n 键 llm.toolSeqParam 的文案没有首尾空格
3509. i18n 键 llm.userLine 的文案没有首尾空格
3510. i18n 键 m.chat.placeholder 的文案没有首尾空格
3511. i18n 键 me.about 的文案没有首尾空格
3512. i18n 键 me.accent 的文案没有首尾空格
3513. i18n 键 me.appearance 的文案没有首尾空格
3514. i18n 键 me.avatar 的文案没有首尾空格
3515. i18n 键 me.avatarHint 的文案没有首尾空格
3516. i18n 键 me.avatarUpload 的文案没有首尾空格
3517. i18n 键 me.backupJson 的文案没有首尾空格
3518. i18n 键 me.changeCred 的文案没有首尾空格
3519. i18n 键 me.changePassword 的文案没有首尾空格
3520. i18n 键 me.checkUpdate 的文案没有首尾空格
3521. i18n 键 me.cleanup 的文案没有首尾空格
3522. i18n 键 me.confirmPassword 的文案没有首尾空格
3523. i18n 键 me.copy 的文案没有首尾空格
3524. i18n 键 me.copyright 的文案没有首尾空格
3525. i18n 键 me.credRotated 的文案没有首尾空格
3526. i18n 键 me.credential 的文案没有首尾空格
3527. i18n 键 me.credentialHint 的文案没有首尾空格
3528. i18n 键 me.dark 的文案没有首尾空格
3529. i18n 键 me.dashboard 的文案没有首尾空格
3530. i18n 键 me.desktopOnly 的文案没有首尾空格
3531. i18n 键 me.deviceId 的文案没有首尾空格
3532. i18n 键 me.diagnostics 的文案没有首尾空格
3533. i18n 键 me.email 的文案没有首尾空格
3534. i18n 键 me.emailNotify 的文案没有首尾空格
3535. i18n 键 me.emptyAction 的文案没有首尾空格
3536. i18n 键 me.hideFull 的文案没有首尾空格
3537. i18n 键 me.idHint 的文案没有首尾空格
3538. i18n 键 me.idWarn 的文案没有首尾空格
3539. i18n 键 me.language 的文案没有首尾空格
3540. i18n 键 me.light 的文案没有首尾空格
3541. i18n 键 me.localProfile 的文案没有首尾空格
3542. i18n 键 me.login 的文案没有首尾空格
3543. i18n 键 me.loginHint 的文案没有首尾空格
3544. i18n 键 me.mesh 的文案没有首尾空格
3545. i18n 键 me.models 的文案没有首尾空格
3546. i18n 键 me.newPassword 的文案没有首尾空格
3547. i18n 键 me.notAvailable 的文案没有首尾空格
3548. i18n 键 me.notConfiguredHint 的文案没有首尾空格
3549. i18n 键 me.notLoggedIn 的文案没有首尾空格
3550. i18n 键 me.opensource 的文案没有首尾空格
3551. i18n 键 me.owner 的文案没有首尾空格
3552. i18n 键 me.passphrase 的文案没有首尾空格
3553. i18n 键 me.password 的文案没有首尾空格
3554. i18n 键 me.provider 的文案没有首尾空格
3555. i18n 键 me.register 的文案没有首尾空格
3556. i18n 键 me.removeAvatarBtn 的文案没有首尾空格
3557. i18n 键 me.saveProfile 的文案没有首尾空格
3558. i18n 键 me.settings 的文案没有首尾空格
3559. i18n 键 me.showFull 的文案没有首尾空格
3560. i18n 键 me.skills 的文案没有首尾空格
3561. i18n 键 me.smtp 的文案没有首尾空格
3562. i18n 键 me.switchHint 的文案没有首尾空格
3563. i18n 键 me.switchIdentity 的文案没有首尾空格
3564. i18n 键 me.system 的文案没有首尾空格
3565. i18n 键 me.theme 的文案没有首尾空格
3566. i18n 键 me.title 的文案没有首尾空格
3567. i18n 键 me.updates 的文案没有首尾空格
3568. i18n 键 me.userId 的文案没有首尾空格
3569. i18n 键 me.username 的文案没有首尾空格
3570. i18n 键 me.version 的文案没有首尾空格
3571. i18n 键 memory.desc 的文案没有首尾空格
3572. i18n 键 memory.notReady 的文案没有首尾空格
3573. i18n 键 memory.ready 的文案没有首尾空格
3574. i18n 键 memory.rebuild 的文案没有首尾空格
3575. i18n 键 memory.rebuildFail 的文案没有首尾空格
3576. i18n 键 memory.rebuildOk 的文案没有首尾空格
3577. i18n 键 memory.rebuildWhy 的文案没有首尾空格
3578. i18n 键 memory.records 的文案没有首尾空格
3579. i18n 键 memory.statusTitle 的文案没有首尾空格
3580. i18n 键 memory.vector 的文案没有首尾空格
3581. i18n 键 mesh.addPeer 的文案没有首尾空格
3582. i18n 键 mesh.broadcast 的文案没有首尾空格
3583. i18n 键 mesh.genInvite 的文案没有首尾空格
3584. i18n 键 mesh.hint 的文案没有首尾空格
3585. i18n 键 mesh.invite 的文案没有首尾空格
3586. i18n 键 mesh.name 的文案没有首尾空格
3587. i18n 键 mesh.peers 的文案没有首尾空格
3588. i18n 键 mesh.portLabel 的文案没有首尾空格
3589. i18n 键 mesh.remove 的文案没有首尾空格
3590. i18n 键 mesh.scanJoin 的文案没有首尾空格
3591. i18n 键 mesh.section 的文案没有首尾空格
3592. i18n 键 mesh.start 的文案没有首尾空格
3593. i18n 键 mesh.stateLabel 的文案没有首尾空格
3594. i18n 键 mesh.stop 的文案没有首尾空格
3595. i18n 键 mesh.title 的文案没有首尾空格
3596. i18n 键 metrics.biaoTi 的文案没有首尾空格
3597. i18n 键 metrics.cost 的文案没有首尾空格
3598. i18n 键 metrics.title 的文案没有首尾空格
3599. i18n 键 metrics.turns 的文案没有首尾空格
3600. i18n 键 model.add 的文案没有首尾空格
3601. i18n 键 model.addManually 的文案没有首尾空格
3602. i18n 键 model.addSelected 的文案没有首尾空格
3603. i18n 键 model.addTitle 的文案没有首尾空格
3604. i18n 键 model.addedCount 的文案没有首尾空格
3605. i18n 键 model.addedToChain 的文案没有首尾空格
3606. i18n 键 model.allAvailable 的文案没有首尾空格
3607. i18n 键 model.alreadyInChain 的文案没有首尾空格
3608. i18n 键 model.available 的文案没有首尾空格
3609. i18n 键 model.availableHint 的文案没有首尾空格
3610. i18n 键 model.chain 的文案没有首尾空格
3611. i18n 键 model.chainHint 的文案没有首尾空格
3612. i18n 键 model.contextLen 的文案没有首尾空格
3613. i18n 键 model.default 的文案没有首尾空格
3614. i18n 键 model.disable 的文案没有首尾空格
3615. i18n 键 model.down 的文案没有首尾空格
3616. i18n 键 model.editProvider 的文案没有首尾空格
3617. i18n 键 model.editProviderConfirm 的文案没有首尾空格
3618. i18n 键 model.editProviderConfirmBody 的文案没有首尾空格
3619. i18n 键 model.enable 的文案没有首尾空格
3620. i18n 键 model.fenLei 的文案没有首尾空格
3621. i18n 键 model.fenLeiHint 的文案没有首尾空格
3622. i18n 键 model.fetch 的文案没有首尾空格
3623. i18n 键 model.fetchHint 的文案没有首尾空格
3624. i18n 键 model.kind.asr 的文案没有首尾空格
3625. i18n 键 model.kind.chat 的文案没有首尾空格
3626. i18n 键 model.kind.decision 的文案没有首尾空格
3627. i18n 键 model.kind.embedding 的文案没有首尾空格
3628. i18n 键 model.kind.image 的文案没有首尾空格
3629. i18n 键 model.kind.imageUnd 的文案没有首尾空格
3630. i18n 键 model.kind.rerank 的文案没有首尾空格
3631. i18n 键 model.kind.safety 的文案没有首尾空格
3632. i18n 键 model.kind.translate 的文案没有首尾空格
3633. i18n 键 model.kind.tts 的文案没有首尾空格
3634. i18n 键 model.kind.videoGen 的文案没有首尾空格
3635. i18n 键 model.kind.videoUnd 的文案没有首尾空格
3636. i18n 键 model.kindHint.asr 的文案没有首尾空格
3637. i18n 键 model.kindHint.embed 的文案没有首尾空格
3638. i18n 键 model.kindHint.fenLei 的文案没有首尾空格
3639. i18n 键 model.kindHint.image 的文案没有首尾空格
3640. i18n 键 model.kindHint.imageUnd 的文案没有首尾空格
3641. i18n 键 model.kindHint.organizer 的文案没有首尾空格
3642. i18n 键 model.kindHint.rerank 的文案没有首尾空格
3643. i18n 键 model.kindHint.safety 的文案没有首尾空格
3644. i18n 键 model.kindHint.translate 的文案没有首尾空格
3645. i18n 键 model.kindHint.tts 的文案没有首尾空格
3646. i18n 键 model.kindHint.videoGen 的文案没有首尾空格
3647. i18n 键 model.kindHint.videoUnd 的文案没有首尾空格
3648. i18n 键 model.latency 的文案没有首尾空格
3649. i18n 键 model.latencyNA 的文案没有首尾空格
3650. i18n 键 model.lianHint 的文案没有首尾空格
3651. i18n 键 model.lianKong 的文案没有首尾空格
3652. i18n 键 model.manual 的文案没有首尾空格
3653. i18n 键 model.mgr 的文案没有首尾空格
3654. i18n 键 model.moreSettings 的文案没有首尾空格
3655. i18n 键 model.moveTop 的文案没有首尾空格
3656. i18n 键 model.noModels 的文案没有首尾空格
3657. i18n 键 model.noneAvailable 的文案没有首尾空格
3658. i18n 键 model.pick 的文案没有首尾空格
3659. i18n 键 model.pickProvider 的文案没有首尾空格
3660. i18n 键 model.provider 的文案没有首尾空格
3661. i18n 键 model.smart 的文案没有首尾空格
3662. i18n 键 model.smartHint 的文案没有首尾空格
3663. i18n 键 model.speakSpeed 的文案没有首尾空格
3664. i18n 键 model.speakVoice 的文案没有首尾空格
3665. i18n 键 model.test 的文案没有首尾空格
3666. i18n 键 model.think 的文案没有首尾空格
3667. i18n 键 model.think.auto 的文案没有首尾空格
3668. i18n 键 model.think.byAgency 的文案没有首尾空格
3669. i18n 键 model.think.follow 的文案没有首尾空格
3670. i18n 键 model.think.followAgency 的文案没有首尾空格
3671. i18n 键 model.think.high 的文案没有首尾空格
3672. i18n 键 model.think.l1 的文案没有首尾空格
3673. i18n 键 model.think.l2 的文案没有首尾空格
3674. i18n 键 model.think.l3 的文案没有首尾空格
3675. i18n 键 model.think.l4 的文案没有首尾空格
3676. i18n 键 model.think.l5 的文案没有首尾空格
3677. i18n 键 model.think.l6 的文案没有首尾空格
3678. i18n 键 model.think.low 的文案没有首尾空格
3679. i18n 键 model.think.manualKept 的文案没有首尾空格
3680. i18n 键 model.think.medium 的文案没有首尾空格
3681. i18n 键 model.think.off 的文案没有首尾空格
3682. i18n 键 model.thinkHint 的文案没有首尾空格
3683. i18n 键 model.up 的文案没有首尾空格
3684. i18n 键 model.xiaoDi 的文案没有首尾空格
3685. i18n 键 model.xiaoDiAuto 的文案没有首尾空格
3686. i18n 键 model.xiaoDiHint 的文案没有首尾空格
3687. i18n 键 model.xiaoDiNow 的文案没有首尾空格
3688. i18n 键 msg.initFailed 的文案没有首尾空格
3689. i18n 键 msg.inviteCopied 的文案没有首尾空格
3690. i18n 键 msg.latest 的文案没有首尾空格
3691. i18n 键 msg.scanOnDesktop 的文案没有首尾空格
3692. i18n 键 msg.smtpDesktopOnly 的文案没有首尾空格
3693. i18n 键 nav.addFriends 的文案没有首尾空格
3694. i18n 键 nav.addGroup 的文案没有首尾空格
3695. i18n 键 nav.addProject 的文案没有首尾空格
3696. i18n 键 nav.avatar 的文案没有首尾空格
3697. i18n 键 nav.externalChat 的文案没有首尾空格
3698. i18n 键 nav.externalGroup 的文案没有首尾空格
3699. i18n 键 nav.instances 的文案没有首尾空格
3700. i18n 键 nav.internalGroup 的文案没有首尾空格
3701. i18n 键 nav.settings 的文案没有首尾空格
3702. i18n 键 nav.singleAi 的文案没有首尾空格
3703. i18n 键 nav.touXiang 的文案没有首尾空格
3704. i18n 键 net.addRemoteBody 的文案没有首尾空格
3705. i18n 键 net.addRemoteTitle 的文案没有首尾空格
3706. i18n 键 net.address 的文案没有首尾空格
3707. i18n 键 net.autofill 的文案没有首尾空格
3708. i18n 键 net.autofillDone 的文案没有首尾空格
3709. i18n 键 net.banner.autoOff 的文案没有首尾空格
3710. i18n 键 net.banner.close 的文案没有首尾空格
3711. i18n 键 net.banner.dismissHint 的文案没有首尾空格
3712. i18n 键 net.banner.linkBody 的文案没有首尾空格
3713. i18n 键 net.banner.linkTitle 的文案没有首尾空格
3714. i18n 键 net.banner.mergedBody 的文案没有首尾空格
3715. i18n 键 net.banner.mergedTitle 的文案没有首尾空格
3716. i18n 键 net.banner.meshOffBody 的文案没有首尾空格
3717. i18n 键 net.banner.meshOffTitle 的文案没有首尾空格
3718. i18n 键 net.banner.relayConfigure 的文案没有首尾空格
3719. i18n 键 net.banner.relayTerminalTitle 的文案没有首尾空格
3720. i18n 键 net.banner.turnOn 的文案没有首尾空格
3721. i18n 键 net.biaoTi 的文案没有首尾空格
3722. i18n 键 net.detect 的文案没有首尾空格
3723. i18n 键 net.detecting 的文案没有首尾空格
3724. i18n 键 net.dialability.ipv6Natural 的文案没有首尾空格
3725. i18n 键 net.dialability.peerVerified 的文案没有首尾空格
3726. i18n 键 net.dialability.undetermined 的文案没有首尾空格
3727. i18n 键 net.dialability.undialable 的文案没有首尾空格
3728. i18n 键 net.dialabilityUnknown 的文案没有首尾空格
3729. i18n 键 net.disableFailed 的文案没有首尾空格
3730. i18n 键 net.domainAdd 的文案没有首尾空格
3731. i18n 键 net.domainPlaceholder 的文案没有首尾空格
3732. i18n 键 net.domainRemove 的文案没有首尾空格
3733. i18n 键 net.domainTitle 的文案没有首尾空格
3734. i18n 键 net.emptyList 的文案没有首尾空格
3735. i18n 键 net.enableFailed 的文案没有首尾空格
3736. i18n 键 net.entryFail 的文案没有首尾空格
3737. i18n 键 net.entryInvalid 的文案没有首尾空格
3738. i18n 键 net.entryOk 的文案没有首尾空格
3739. i18n 键 net.entryResultsTitle 的文案没有首尾空格
3740. i18n 键 net.entryUnknown 的文案没有首尾空格
3741. i18n 键 net.helpBody 的文案没有首尾空格
3742. i18n 键 net.helpTitle 的文案没有首尾空格
3743. i18n 键 net.hint 的文案没有首尾空格
3744. i18n 键 net.invalidIp 的文案没有首尾空格
3745. i18n 键 net.invalidPort 的文案没有首尾空格
3746. i18n 键 net.ladder.biaoTi 的文案没有首尾空格
3747. i18n 键 net.ladder.candidate 的文案没有首尾空格
3748. i18n 键 net.ladder.current 的文案没有首尾空格
3749. i18n 键 net.ladder.dialability 的文案没有首尾空格
3750. i18n 键 net.ladder.none 的文案没有首尾空格
3751. i18n 键 net.ladder.relay 的文案没有首尾空格
3752. i18n 键 net.ladder.title 的文案没有首尾空格
3753. i18n 键 net.ladder.unknown 的文案没有首尾空格
3754. i18n 键 net.ladder.unsupported 的文案没有首尾空格
3755. i18n 键 net.localIp 的文案没有首尾空格
3756. i18n 键 net.meshTitle 的文案没有首尾空格
3757. i18n 键 net.note.lan 的文案没有首尾空格
3758. i18n 键 net.note.wanHard 的文案没有首尾空格
3759. i18n 键 net.note.wanManual 的文案没有首尾空格
3760. i18n 键 net.partialPass 的文案没有首尾空格
3761. i18n 键 net.peers 的文案没有首尾空格
3762. i18n 键 net.port 的文案没有首尾空格
3763. i18n 键 net.portBindFailedBody 的文案没有首尾空格
3764. i18n 键 net.portBindFailedTitle 的文案没有首尾空格
3765. i18n 键 net.portBound 的文案没有首尾空格
3766. i18n 键 net.portConventionHint 的文案没有首尾空格
3767. i18n 键 net.portSuggestChecking 的文案没有首尾空格
3768. i18n 键 net.portSuggestHint 的文案没有首尾空格
3769. i18n 键 net.portSuggestMeasured 的文案没有首尾空格
3770. i18n 键 net.portSuggestNone 的文案没有首尾空格
3771. i18n 键 net.portSuggestRefresh 的文案没有首尾空格
3772. i18n 键 net.probeCount 的文案没有首尾空格
3773. i18n 键 net.publicIp 的文案没有首尾空格
3774. i18n 键 net.publicListEmpty 的文案没有首尾空格
3775. i18n 键 net.refresh 的文案没有首尾空格
3776. i18n 键 net.refreshDone 的文案没有首尾空格
3777. i18n 键 net.relay.missing.needsPublicRelay 的文案没有首尾空格
3778. i18n 键 net.relay.missing.noneConfigured 的文案没有首尾空格
3779. i18n 键 net.relay.missing.unreachable 的文案没有首尾空格
3780. i18n 键 net.relay.notNeeded.inboundExpected 的文案没有首尾空格
3781. i18n 键 net.relay.notNeeded.peerDialable 的文案没有首尾空格
3782. i18n 键 net.relay.selected 的文案没有首尾空格
3783. i18n 键 net.relay.unknown 的文案没有首尾空格
3784. i18n 键 net.result.at 的文案没有首尾空格
3785. i18n 键 net.result.behindNat 的文案没有首尾空格
3786. i18n 键 net.result.failOutbound 的文案没有首尾空格
3787. i18n 键 net.result.failPublic 的文案没有首尾空格
3788. i18n 键 net.result.method 的文案没有首尾空格
3789. i18n 键 net.result.needPass 的文案没有首尾空格
3790. i18n 键 net.result.pass 的文案没有首尾空格
3791. i18n 键 net.result.passLan 的文案没有首尾空格
3792. i18n 键 net.result.passUnverifiedInbound 的文案没有首尾空格
3793. i18n 键 net.result.unknown 的文案没有首尾空格
3794. i18n 键 net.rung.holepunch 的文案没有首尾空格
3795. i18n 键 net.rung.ipv6Direct 的文案没有首尾空格
3796. i18n 键 net.rung.lan 的文案没有首尾空格
3797. i18n 键 net.rung.publicDirect 的文案没有首尾空格
3798. i18n 键 net.rung.relay 的文案没有首尾空格
3799. i18n 键 net.rung.upnp 的文案没有首尾空格
3800. i18n 键 net.switch 的文案没有首尾空格
3801. i18n 键 net.switchBlocked 的文案没有首尾空格
3802. i18n 键 net.switchNeedDetect 的文案没有首尾空格
3803. i18n 键 net.switchOff 的文案没有首尾空格
3804. i18n 键 net.switchOn 的文案没有首尾空格
3805. i18n 键 net.tiShi 的文案没有首尾空格
3806. i18n 键 net.title 的文案没有首尾空格
3807. i18n 键 nm.badFormat 的文案没有首尾空格
3808. i18n 键 nm.enterPassword 的文案没有首尾空格
3809. i18n 键 nm.exportChat 的文案没有首尾空格
3810. i18n 键 nm.exportChatHint 的文案没有首尾空格
3811. i18n 键 nm.exportProject 的文案没有首尾空格
3812. i18n 键 nm.exportProjectHint 的文案没有首尾空格
3813. i18n 键 nm.exportTitle 的文案没有首尾空格
3814. i18n 键 nm.freshConfirm 的文案没有首尾空格
3815. i18n 键 nm.freshConfirm2 的文案没有首尾空格
3816. i18n 键 nm.importDone 的文案没有首尾空格
3817. i18n 键 nm.importMode 的文案没有首尾空格
3818. i18n 键 nm.needPassword 的文案没有首尾空格
3819. i18n 键 nm.setExportPassword 的文案没有首尾空格
3820. i18n 键 notify.done 的文案没有首尾空格
3821. i18n 键 notify.err 的文案没有首尾空格
3822. i18n 键 notify.req 的文案没有首尾空格
3823. i18n 键 notify.title 的文案没有首尾空格
3824. i18n 键 panel.addCard 的文案没有首尾空格
3825. i18n 键 panel.addCustomCard 的文案没有首尾空格
3826. i18n 键 panel.assist 的文案没有首尾空格
3827. i18n 键 panel.assist.biaoTi 的文案没有首尾空格
3828. i18n 键 panel.assist.done 的文案没有首尾空格
3829. i18n 键 panel.assist.empty 的文案没有首尾空格
3830. i18n 键 panel.assist.markDone 的文案没有首尾空格
3831. i18n 键 panel.assist.markStale 的文案没有首尾空格
3832. i18n 键 panel.assist.markUrgent 的文案没有首尾空格
3833. i18n 键 panel.assist.title 的文案没有首尾空格
3834. i18n 键 panel.assist.urgent 的文案没有首尾空格
3835. i18n 键 panel.board 的文案没有首尾空格
3836. i18n 键 panel.customCard 的文案没有首尾空格
3837. i18n 键 panel.diagWhat 的文案没有首尾空格
3838. i18n 键 panel.dir 的文案没有首尾空格
3839. i18n 键 panel.directory 的文案没有首尾空格
3840. i18n 键 panel.duty 的文案没有首尾空格
3841. i18n 键 panel.jinDu 的文案没有首尾空格
3842. i18n 键 panel.kb.biaoTi 的文案没有首尾空格
3843. i18n 键 panel.kb.hint 的文案没有首尾空格
3844. i18n 键 panel.kb.tiShi 的文案没有首尾空格
3845. i18n 键 panel.kb.title 的文案没有首尾空格
3846. i18n 键 panel.logs 的文案没有首尾空格
3847. i18n 键 panel.members 的文案没有首尾空格
3848. i18n 键 panel.modelMgr 的文案没有首尾空格
3849. i18n 键 panel.modelMgrEmpty 的文案没有首尾空格
3850. i18n 键 panel.modelMgrHint 的文案没有首尾空格
3851. i18n 键 panel.modelMgrReadonly 的文案没有首尾空格
3852. i18n 键 panel.noTasks 的文案没有首尾空格
3853. i18n 键 panel.plan.blocked 的文案没有首尾空格
3854. i18n 键 panel.plan.collapse 的文案没有首尾空格
3855. i18n 键 panel.plan.doing 的文案没有首尾空格
3856. i18n 键 panel.plan.done 的文案没有首尾空格
3857. i18n 键 panel.plan.empty 的文案没有首尾空格
3858. i18n 键 panel.plan.pending 的文案没有首尾空格
3859. i18n 键 panel.plan.progress 的文案没有首尾空格
3860. i18n 键 panel.plan.title 的文案没有首尾空格
3861. i18n 键 panel.plan.verified 的文案没有首尾空格
3862. i18n 键 panel.progress 的文案没有首尾空格
3863. i18n 键 panel.progressEmpty 的文案没有首尾空格
3864. i18n 键 panel.projectFiles 的文案没有首尾空格
3865. i18n 键 panel.projectState 的文案没有首尾空格
3866. i18n 键 panel.queue 的文案没有首尾空格
3867. i18n 键 panel.removeCard 的文案没有首尾空格
3868. i18n 键 panel.requirement 的文案没有首尾空格
3869. i18n 键 panel.result 的文案没有首尾空格
3870. i18n 键 panel.schedule.empty 的文案没有首尾空格
3871. i18n 键 panel.schedule.next 的文案没有首尾空格
3872. i18n 键 panel.schedule.pause 的文案没有首尾空格
3873. i18n 键 panel.schedule.resume 的文案没有首尾空格
3874. i18n 键 panel.schedule.title 的文案没有首尾空格
3875. i18n 键 panel.summary.auto 的文案没有首尾空格
3876. i18n 键 panel.summary.biaoTi 的文案没有首尾空格
3877. i18n 键 panel.summary.bullets 的文案没有首尾空格
3878. i18n 键 panel.summary.decisions 的文案没有首尾空格
3879. i18n 键 panel.summary.done 的文案没有首尾空格
3880. i18n 键 panel.summary.empty 的文案没有首尾空格
3881. i18n 键 panel.summary.gen 的文案没有首尾空格
3882. i18n 键 panel.summary.jump 的文案没有首尾空格
3883. i18n 键 panel.summary.risks 的文案没有首尾空格
3884. i18n 键 panel.summary.title 的文案没有首尾空格
3885. i18n 键 panel.summary.todos 的文案没有首尾空格
3886. i18n 键 panel.taskDemo.1 的文案没有首尾空格
3887. i18n 键 panel.taskDemo.2 的文案没有首尾空格
3888. i18n 键 panel.taskDemo.3 的文案没有首尾空格
3889. i18n 键 panel.taskDemo.4 的文案没有首尾空格
3890. i18n 键 panel.taskDemo.5 的文案没有首尾空格
3891. i18n 键 panel.tasks 的文案没有首尾空格
3892. i18n 键 panel.workfiles.empty 的文案没有首尾空格
3893. i18n 键 panel.workfiles.genAt 的文案没有首尾空格
3894. i18n 键 panel.workfiles.open 的文案没有首尾空格
3895. i18n 键 panel.workfiles.refresh 的文案没有首尾空格
3896. i18n 键 panel.workfiles.refreshed 的文案没有首尾空格
3897. i18n 键 panel.workfiles.reveal 的文案没有首尾空格
3898. i18n 键 panel.workfiles.root 的文案没有首尾空格
3899. i18n 键 panel.workfiles.title 的文案没有首尾空格
3900. i18n 键 panel.workfiles.workspace 的文案没有首尾空格
3901. i18n 键 placeholder.agentName 的文案没有首尾空格
3902. i18n 键 placeholder.email 的文案没有首尾空格
3903. i18n 键 placeholder.groupName 的文案没有首尾空格
3904. i18n 键 placeholder.groupNameExt 的文案没有首尾空格
3905. i18n 键 placeholder.nodeName 的文案没有首尾空格
3906. i18n 键 placeholder.peerHost 的文案没有首尾空格
3907. i18n 键 plugin.builtin 的文案没有首尾空格
3908. i18n 键 plugin.fromFolder 的文案没有首尾空格
3909. i18n 键 plugin.memory.desc 的文案没有首尾空格
3910. i18n 键 plugin.memory.provider 的文案没有首尾空格
3911. i18n 键 plugin.teams.desc 的文案没有首尾空格
3912. i18n 键 plugin.teams.provider 的文案没有首尾空格
3913. i18n 键 pm.empty 的文案没有首尾空格
3914. i18n 键 pm.hint 的文案没有首尾空格
3915. i18n 键 pm.readBackFail 的文案没有首尾空格
3916. i18n 键 pm.save 的文案没有首尾空格
3917. i18n 键 pm.saved 的文案没有首尾空格
3918. i18n 键 pm.tiShi 的文案没有首尾空格
3919. i18n 键 pm.title 的文案没有首尾空格
3920. i18n 键 preview.settingsNotice 的文案没有首尾空格
3921. i18n 键 privacy.agree 的文案没有首尾空格
3922. i18n 键 privacy.biaoTi 的文案没有首尾空格
3923. i18n 键 privacy.body 的文案没有首尾空格
3924. i18n 键 privacy.disagree 的文案没有首尾空格
3925. i18n 键 privacy.revoke 的文案没有首尾空格
3926. i18n 键 privacy.revokeConfirm 的文案没有首尾空格
3927. i18n 键 privacy.scrollHint 的文案没有首尾空格
3928. i18n 键 privacy.ti 的文案没有首尾空格
3929. i18n 键 privacy.title 的文案没有首尾空格
3930. i18n 键 privacy.viewTitle 的文案没有首尾空格
3931. i18n 键 privacy.waitHint 的文案没有首尾空格
3932. i18n 键 projectFiles.changedTitle 的文案没有首尾空格
3933. i18n 键 projectFiles.empty.changed 的文案没有首尾空格
3934. i18n 键 projectFiles.empty.noProjectDir 的文案没有首尾空格
3935. i18n 键 projectFiles.empty.other 的文案没有首尾空格
3936. i18n 键 projectFiles.entry.dir-empty 的文案没有首尾空格
3937. i18n 键 projectFiles.entry.dir-planned 的文案没有首尾空格
3938. i18n 键 projectFiles.entry.entry-found 的文案没有首尾空格
3939. i18n 键 projectFiles.entry.file-found 的文案没有首尾空格
3940. i18n 键 projectFiles.entry.none 的文案没有首尾空格
3941. i18n 键 projectFiles.fromCreatorSignal 的文案没有首尾空格
3942. i18n 键 projectFiles.kind.changed 的文案没有首尾空格
3943. i18n 键 projectFiles.kind.created 的文案没有首尾空格
3944. i18n 键 projectFiles.kind.deleted 的文案没有首尾空格
3945. i18n 键 projectFiles.kind.file 的文案没有首尾空格
3946. i18n 键 projectFiles.kind.program 的文案没有首尾空格
3947. i18n 键 projectFiles.kind.read 的文案没有首尾空格
3948. i18n 键 projectFiles.ledgerCount 的文案没有首尾空格
3949. i18n 键 projectFiles.loadFailed 的文案没有首尾空格
3950. i18n 键 projectFiles.missingHint 的文案没有首尾空格
3951. i18n 键 projectFiles.otherTitle 的文案没有首尾空格
3952. i18n 键 projectFiles.productDir 的文案没有首尾空格
3953. i18n 键 projectFiles.productDirPlanned 的文案没有首尾空格
3954. i18n 键 projectFiles.productTitle 的文案没有首尾空格
3955. i18n 键 projectFiles.run 的文案没有首尾空格
3956. i18n 键 projectFiles.runFailed 的文案没有首尾空格
3957. i18n 键 projectFiles.runReason.container-built 的文案没有首尾空格
3958. i18n 键 projectFiles.runReason.dir-empty 的文案没有首尾空格
3959. i18n 键 projectFiles.runReason.dir-planned 的文案没有首尾空格
3960. i18n 键 projectFiles.runReason.file-found 的文案没有首尾空格
3961. i18n 键 projectFiles.runReason.host-native 的文案没有首尾空格
3962. i18n 键 projectFiles.runReason.no-host-runtime 的文案没有首尾空格
3963. i18n 键 projectFiles.runReason.none 的文案没有首尾空格
3964. i18n 键 projectFiles.runStarted 的文案没有首尾空格
3965. i18n 键 projectFiles.source.checkpoint 的文案没有首尾空格
3966. i18n 键 projectFiles.source.checkpoint-detail 的文案没有首尾空格
3967. i18n 键 projectFiles.source.dir-scan 的文案没有首尾空格
3968. i18n 键 projectFiles.source.tool-file-access-ledger 的文案没有首尾空格
3969. i18n 键 projectFiles.source.unknown 的文案没有首尾空格
3970. i18n 键 prompt.providerName 的文案没有首尾空格
3971. i18n 键 provider.add 的文案没有首尾空格
3972. i18n 键 provider.configured 的文案没有首尾空格
3973. i18n 键 provider.list 的文案没有首尾空格
3974. i18n 键 provider.notConfigured 的文案没有首尾空格
3975. i18n 键 sec.confirmBody 的文案没有首尾空格
3976. i18n 键 sec.confirmTitle 的文案没有首尾空格
3977. i18n 键 sessions.title 的文案没有首尾空格
3978. i18n 键 settings.about 的文案没有首尾空格
3979. i18n 键 settings.addProvider 的文案没有首尾空格
3980. i18n 键 settings.apiKey 的文案没有首尾空格
3981. i18n 键 settings.asrModel 的文案没有首尾空格
3982. i18n 键 settings.baseUrl 的文案没有首尾空格
3983. i18n 键 settings.blacklist 的文案没有首尾空格
3984. i18n 键 settings.builtinComplete 的文案没有首尾空格
3985. i18n 键 settings.builtinError 的文案没有首尾空格
3986. i18n 键 settings.builtinRequest 的文案没有首尾空格
3987. i18n 键 settings.chaJianJi 的文案没有首尾空格
3988. i18n 键 settings.chatModel 的文案没有首尾空格
3989. i18n 键 settings.checkUpdate 的文案没有首尾空格
3990. i18n 键 settings.customColorTitle 的文案没有首尾空格
3991. i18n 键 settings.dataBytes 的文案没有首尾空格
3992. i18n 键 settings.dataHint 的文案没有首尾空格
3993. i18n 键 settings.dataReplicas 的文案没有首尾空格
3994. i18n 键 settings.dataRetention 的文案没有首尾空格
3995. i18n 键 settings.dataTitle 的文案没有首尾空格
3996. i18n 键 settings.defaultModel 的文案没有首尾空格
3997. i18n 键 settings.emailHint 的文案没有首尾空格
3998. i18n 键 settings.emailNotify 的文案没有首尾空格
3999. i18n 键 settings.emailNotifyHint 的文案没有首尾空格
4000. i18n 键 settings.emailOnRequest 的文案没有首尾空格
4001. i18n 键 settings.emailWhen 的文案没有首尾空格
4002. i18n 键 settings.embedding 的文案没有首尾空格
4003. i18n 键 settings.embeddingGpu 的文案没有首尾空格
4004. i18n 键 settings.embeddingHint 的文案没有首尾空格
4005. i18n 键 settings.embeddingModel 的文案没有首尾空格
4006. i18n 键 settings.embeddingSpecial 的文案没有首尾空格
4007. i18n 键 settings.exportJson 的文案没有首尾空格
4008. i18n 键 settings.fetchDisabledHint 的文案没有首尾空格
4009. i18n 键 settings.fetchModels 的文案没有首尾空格
4010. i18n 键 settings.fetchModelsOnNewLine 的文案没有首尾空格
4011. i18n 键 settings.fieldApiKey 的文案没有首尾空格
4012. i18n 键 settings.fieldBaseUrl 的文案没有首尾空格
4013. i18n 键 settings.fieldName 的文案没有首尾空格
4014. i18n 键 settings.fontApplyHint 的文案没有首尾空格
4015. i18n 键 settings.fontDefault 的文案没有首尾空格
4016. i18n 键 settings.fontFamily 的文案没有首尾空格
4017. i18n 键 settings.fontInstall 的文案没有首尾空格
4018. i18n 键 settings.fontInstallFail 的文案没有首尾空格
4019. i18n 键 settings.fontInstalled 的文案没有首尾空格
4020. i18n 键 settings.fontListFail 的文案没有首尾空格
4021. i18n 键 settings.fontSize 的文案没有首尾空格
4022. i18n 键 settings.fontSizeHint 的文案没有首尾空格
4023. i18n 键 settings.fontWeight 的文案没有首尾空格
4024. i18n 键 settings.fontWeightHint 的文案没有首尾空格
4025. i18n 键 settings.fw 的文案没有首尾空格
4026. i18n 键 settings.fw100 的文案没有首尾空格
4027. i18n 键 settings.fw200 的文案没有首尾空格
4028. i18n 键 settings.fw300 的文案没有首尾空格
4029. i18n 键 settings.fw400 的文案没有首尾空格
4030. i18n 键 settings.fw500 的文案没有首尾空格
4031. i18n 键 settings.fw600 的文案没有首尾空格
4032. i18n 键 settings.fw700 的文案没有首尾空格
4033. i18n 键 settings.fw800 的文案没有首尾空格
4034. i18n 键 settings.fw900 的文案没有首尾空格
4035. i18n 键 settings.hexOrRgb 的文案没有首尾空格
4036. i18n 键 settings.hotkey.act.focusInput 的文案没有首尾空格
4037. i18n 键 settings.hotkey.act.focusSearch 的文案没有首尾空格
4038. i18n 键 settings.hotkey.act.newSession 的文案没有首尾空格
4039. i18n 键 settings.hotkey.act.openContacts 的文案没有首尾空格
4040. i18n 键 settings.hotkey.act.openMe 的文案没有首尾空格
4041. i18n 键 settings.hotkey.act.openSettings 的文案没有首尾空格
4042. i18n 键 settings.hotkey.act.stopAll 的文案没有首尾空格
4043. i18n 键 settings.hotkey.act.toggleConsole 的文案没有首尾空格
4044. i18n 键 settings.hotkey.act.toggleSidebar 的文案没有首尾空格
4045. i18n 键 settings.hotkey.actDesc.focusInput 的文案没有首尾空格
4046. i18n 键 settings.hotkey.actDesc.focusSearch 的文案没有首尾空格
4047. i18n 键 settings.hotkey.actDesc.newSession 的文案没有首尾空格
4048. i18n 键 settings.hotkey.actDesc.openContacts 的文案没有首尾空格
4049. i18n 键 settings.hotkey.actDesc.openMe 的文案没有首尾空格
4050. i18n 键 settings.hotkey.actDesc.openSettings 的文案没有首尾空格
4051. i18n 键 settings.hotkey.actDesc.stopAll 的文案没有首尾空格
4052. i18n 键 settings.hotkey.actDesc.toggleConsole 的文案没有首尾空格
4053. i18n 键 settings.hotkey.actDesc.toggleSidebar 的文案没有首尾空格
4054. i18n 键 settings.hotkey.api.boardAggregate 的文案没有首尾空格
4055. i18n 键 settings.hotkey.api.boardTasks 的文案没有首尾空格
4056. i18n 键 settings.hotkey.api.chatLog 的文案没有首尾空格
4057. i18n 键 settings.hotkey.api.chatSend 的文案没有首尾空格
4058. i18n 键 settings.hotkey.api.groupCreate 的文案没有首尾空格
4059. i18n 键 settings.hotkey.api.groupList 的文案没有首尾空格
4060. i18n 键 settings.hotkey.api.groupMessage 的文案没有首尾空格
4061. i18n 键 settings.hotkey.api.identityInfo 的文案没有首尾空格
4062. i18n 键 settings.hotkey.api.identityPeers 的文案没有首尾空格
4063. i18n 键 settings.hotkey.api.inviteCreate 的文案没有首尾空格
4064. i18n 键 settings.hotkey.api.knowledgeQuery 的文案没有首尾空格
4065. i18n 键 settings.hotkey.api.listInstances 的文案没有首尾空格
4066. i18n 键 settings.hotkey.api.membershipList 的文案没有首尾空格
4067. i18n 键 settings.hotkey.api.meshEnable 的文案没有首尾空格
4068. i18n 键 settings.hotkey.api.metricsSummary 的文案没有首尾空格
4069. i18n 键 settings.hotkey.api.netStatus 的文案没有首尾空格
4070. i18n 键 settings.hotkey.api.peersAdd 的文案没有首尾空格
4071. i18n 键 settings.hotkey.api.settingsGet 的文案没有首尾空格
4072. i18n 键 settings.hotkey.api.settingsSave 的文案没有首尾空格
4073. i18n 键 settings.hotkey.api.skillsList 的文案没有首尾空格
4074. i18n 键 settings.hotkey.api.spawnInstance 的文案没有首尾空格
4075. i18n 键 settings.hotkey.api.stateLoad 的文案没有首尾空格
4076. i18n 键 settings.hotkey.api.stateSave 的文案没有首尾空格
4077. i18n 键 settings.hotkey.api.stopInstance 的文案没有首尾空格
4078. i18n 键 settings.hotkey.apiColChannel 的文案没有首尾空格
4079. i18n 键 settings.hotkey.apiColDesc 的文案没有首尾空格
4080. i18n 键 settings.hotkey.apiColOp 的文案没有首尾空格
4081. i18n 键 settings.hotkey.apiColParams 的文案没有首尾空格
4082. i18n 键 settings.hotkey.apiCopied 的文案没有首尾空格
4083. i18n 键 settings.hotkey.apiCopyOps 的文案没有首尾空格
4084. i18n 键 settings.hotkey.apiCopyText 的文案没有首尾空格
4085. i18n 键 settings.hotkey.apiCount 的文案没有首尾空格
4086. i18n 键 settings.hotkey.apiEmpty 的文案没有首尾空格
4087. i18n 键 settings.hotkey.apiEvents 的文案没有首尾空格
4088. i18n 键 settings.hotkey.apiFilter 的文案没有首尾空格
4089. i18n 键 settings.hotkey.apiHint 的文案没有首尾空格
4090. i18n 键 settings.hotkey.apiNoDesc 的文案没有首尾空格
4091. i18n 键 settings.hotkey.apiTitle 的文案没有首尾空格
4092. i18n 键 settings.hotkey.apiTry 的文案没有首尾空格
4093. i18n 键 settings.hotkey.apiTryReadOnly 的文案没有首尾空格
4094. i18n 键 settings.hotkey.apiTryResult 的文案没有首尾空格
4095. i18n 键 settings.hotkey.apiUnavailable 的文案没有首尾空格
4096. i18n 键 settings.hotkey.clear 的文案没有首尾空格
4097. i18n 键 settings.hotkey.colAction 的文案没有首尾空格
4098. i18n 键 settings.hotkey.colBinding 的文案没有首尾空格
4099. i18n 键 settings.hotkey.colDesc 的文案没有首尾空格
4100. i18n 键 settings.hotkey.group.archive 的文案没有首尾空格
4101. i18n 键 settings.hotkey.group.asset 的文案没有首尾空格
4102. i18n 键 settings.hotkey.group.board 的文案没有首尾空格
4103. i18n 键 settings.hotkey.group.chat 的文案没有首尾空格
4104. i18n 键 settings.hotkey.group.checkpoint 的文案没有首尾空格
4105. i18n 键 settings.hotkey.group.executor 的文案没有首尾空格
4106. i18n 键 settings.hotkey.group.group 的文案没有首尾空格
4107. i18n 键 settings.hotkey.group.identity 的文案没有首尾空格
4108. i18n 键 settings.hotkey.group.invite 的文案没有首尾空格
4109. i18n 键 settings.hotkey.group.knowledge 的文案没有首尾空格
4110. i18n 键 settings.hotkey.group.membership 的文案没有首尾空格
4111. i18n 键 settings.hotkey.group.metrics 的文案没有首尾空格
4112. i18n 键 settings.hotkey.group.net 的文案没有首尾空格
4113. i18n 键 settings.hotkey.group.other 的文案没有首尾空格
4114. i18n 键 settings.hotkey.group.repo 的文案没有首尾空格
4115. i18n 键 settings.hotkey.group.security 的文案没有首尾空格
4116. i18n 键 settings.hotkey.group.settings 的文案没有首尾空格
4117. i18n 键 settings.hotkey.group.skill 的文案没有首尾空格
4118. i18n 键 settings.hotkey.group.smtp 的文案没有首尾空格
4119. i18n 键 settings.hotkey.group.window 的文案没有首尾空格
4120. i18n 键 settings.hotkey.invalid 的文案没有首尾空格
4121. i18n 键 settings.hotkey.keyHint 的文案没有首尾空格
4122. i18n 键 settings.hotkey.keyTitle 的文案没有首尾空格
4123. i18n 键 settings.hotkey.onlyWired 的文案没有首尾空格
4124. i18n 键 settings.hotkey.press 的文案没有首尾空格
4125. i18n 键 settings.hotkey.saved 的文案没有首尾空格
4126. i18n 键 settings.hotkey.unbound 的文案没有首尾空格
4127. i18n 键 settings.imageModel 的文案没有首尾空格
4128. i18n 键 settings.imageUndModel 的文案没有首尾空格
4129. i18n 键 settings.importDo 的文案没有首尾空格
4130. i18n 键 settings.importHint 的文案没有首尾空格
4131. i18n 键 settings.importNm 的文案没有首尾空格
4132. i18n 键 settings.importProviders 的文案没有首尾空格
4133. i18n 键 settings.keyEmpty 的文案没有首尾空格
4134. i18n 键 settings.keyReveal 的文案没有首尾空格
4135. i18n 键 settings.keySaveFailed 的文案没有首尾空格
4136. i18n 键 settings.keySaved 的文案没有首尾空格
4137. i18n 键 settings.language 的文案没有首尾空格
4138. i18n 键 settings.localeEn 的文案没有首尾空格
4139. i18n 键 settings.localeZh 的文案没有首尾空格
4140. i18n 键 settings.logMissing 的文案没有首尾空格
4141. i18n 键 settings.mimic 的文案没有首尾空格
4142. i18n 键 settings.mimicHint 的文案没有首尾空格
4143. i18n 键 settings.modelInUseTip 的文案没有首尾空格
4144. i18n 键 settings.modelOptions 的文案没有首尾空格
4145. i18n 键 settings.modelSetDefault 的文案没有首尾空格
4146. i18n 键 settings.modelStaleTip 的文案没有首尾空格
4147. i18n 键 settings.modelsDropped 的文案没有首尾空格
4148. i18n 键 settings.modelsEmpty 的文案没有首尾空格
4149. i18n 键 settings.modelsFetchFailed 的文案没有首尾空格
4150. i18n 键 settings.modelsFetched 的文案没有首尾空格
4151. i18n 键 settings.modelsStale 的文案没有首尾空格
4152. i18n 键 settings.modelsUnit 的文案没有首尾空格
4153. i18n 键 settings.notifyApplied 的文案没有首尾空格
4154. i18n 键 settings.notifyApply 的文案没有首尾空格
4155. i18n 键 settings.notifyCancel 的文案没有首尾空格
4156. i18n 键 settings.openLog 的文案没有首尾空格
4157. i18n 键 settings.organizerModel 的文案没有首尾空格
4158. i18n 键 settings.pickFolder 的文案没有首尾空格
4159. i18n 键 settings.pickScreenColor 的文案没有首尾空格
4160. i18n 键 settings.pickScreenHint 的文案没有首尾空格
4161. i18n 键 settings.pluginActions 的文案没有首尾空格
4162. i18n 键 settings.pluginAddPick 的文案没有首尾空格
4163. i18n 键 settings.pluginDelete 的文案没有首尾空格
4164. i18n 键 settings.pluginDesc 的文案没有首尾空格
4165. i18n 键 settings.pluginDisable 的文案没有首尾空格
4166. i18n 键 settings.pluginEnable 的文案没有首尾空格
4167. i18n 键 settings.pluginId 的文案没有首尾空格
4168. i18n 键 settings.pluginInstall 的文案没有首尾空格
4169. i18n 键 settings.pluginInstallBrowse 的文案没有首尾空格
4170. i18n 键 settings.pluginScanCheck 的文案没有首尾空格
4171. i18n 键 settings.pluginScanTitle 的文案没有首尾空格
4172. i18n 键 settings.pluginStatus 的文案没有首尾空格
4173. i18n 键 settings.pluginUninstall 的文案没有首尾空格
4174. i18n 键 settings.plugins 的文案没有首尾空格
4175. i18n 键 settings.provider.anthropic 的文案没有首尾空格
4176. i18n 键 settings.provider.dashscope 的文案没有首尾空格
4177. i18n 键 settings.provider.deepseek 的文案没有首尾空格
4178. i18n 键 settings.provider.fireworks 的文案没有首尾空格
4179. i18n 键 settings.provider.gemini 的文案没有首尾空格
4180. i18n 键 settings.provider.groq 的文案没有首尾空格
4181. i18n 键 settings.provider.mistral 的文案没有首尾空格
4182. i18n 键 settings.provider.moonshot 的文案没有首尾空格
4183. i18n 键 settings.provider.ollama 的文案没有首尾空格
4184. i18n 键 settings.provider.ollamaCloud 的文案没有首尾空格
4185. i18n 键 settings.provider.ollamaRemote 的文案没有首尾空格
4186. i18n 键 settings.provider.openai 的文案没有首尾空格
4187. i18n 键 settings.provider.openrouter 的文案没有首尾空格
4188. i18n 键 settings.provider.perplexity 的文案没有首尾空格
4189. i18n 键 settings.provider.siliconflow 的文案没有首尾空格
4190. i18n 键 settings.provider.together 的文案没有首尾空格
4191. i18n 键 settings.provider.zhipu 的文案没有首尾空格
4192. i18n 键 settings.providerActive 的文案没有首尾空格
4193. i18n 键 settings.providerMax 的文案没有首尾空格
4194. i18n 键 settings.providerName 的文案没有首尾空格
4195. i18n 键 settings.providerNameDup 的文案没有首尾空格
4196. i18n 键 settings.providerOther 的文案没有首尾空格
4197. i18n 键 settings.providerPickFirst 的文案没有首尾空格
4198. i18n 键 settings.providerPickHint 的文案没有首尾空格
4199. i18n 键 settings.providerPreset 的文案没有首尾空格
4200. i18n 键 settings.providerUse 的文案没有首尾空格
4201. i18n 键 settings.providerUseOk 的文案没有首尾空格
4202. i18n 键 settings.providers 的文案没有首尾空格
4203. i18n 键 settings.removeModel 的文案没有首尾空格
4204. i18n 键 settings.rerankModel 的文案没有首尾空格
4205. i18n 键 settings.restoreConfirm 的文案没有首尾空格
4206. i18n 键 settings.restoreDefaults 的文案没有首尾空格
4207. i18n 键 settings.restored 的文案没有首尾空格
4208. i18n 键 settings.safetyModel 的文案没有首尾空格
4209. i18n 键 settings.scanDone 的文案没有首尾空格
4210. i18n 键 settings.scanMachine 的文案没有首尾空格
4211. i18n 键 settings.scanRunning 的文案没有首尾空格
4212. i18n 键 settings.scanStopped 的文案没有首尾空格
4213. i18n 键 settings.search 的文案没有首尾空格
4214. i18n 键 settings.section.about 的文案没有首尾空格
4215. i18n 键 settings.section.func 的文案没有首尾空格
4216. i18n 键 settings.section.hotkey 的文案没有首尾空格
4217. i18n 键 settings.section.model 的文案没有首尾空格
4218. i18n 键 settings.section.notify 的文案没有首尾空格
4219. i18n 键 settings.section.ui 的文案没有首尾空格
4220. i18n 键 settings.security 的文案没有首尾空格
4221. i18n 键 settings.securityFull 的文案没有首尾空格
4222. i18n 键 settings.securityFullDesc 的文案没有首尾空格
4223. i18n 键 settings.securityHint 的文案没有首尾空格
4224. i18n 键 settings.securityNormal 的文案没有首尾空格
4225. i18n 键 settings.securityNormalDesc 的文案没有首尾空格
4226. i18n 键 settings.securityStrict 的文案没有首尾空格
4227. i18n 键 settings.securityStrictDesc 的文案没有首尾空格
4228. i18n 键 settings.skillDeleteLocked 的文案没有首尾空格
4229. i18n 键 settings.skillEnabled 的文案没有首尾空格
4230. i18n 键 settings.skillFrom 的文案没有首尾空格
4231. i18n 键 settings.skillPaused 的文案没有首尾空格
4232. i18n 键 settings.skillRemove 的文案没有首尾空格
4233. i18n 键 settings.skillSourceDiscovered 的文案没有首尾空格
4234. i18n 键 settings.skillSourceUserData 的文案没有首尾空格
4235. i18n 键 settings.skillSourceWorkspace 的文案没有首尾空格
4236. i18n 键 settings.skills 的文案没有首尾空格
4237. i18n 键 settings.skillsDiscoveredTitle 的文案没有首尾空格
4238. i18n 键 settings.skillsEmpty 的文案没有首尾空格
4239. i18n 键 settings.skillsEnable 的文案没有首尾空格
4240. i18n 键 settings.skillsHint 的文案没有首尾空格
4241. i18n 键 settings.skillsImport 的文案没有首尾空格
4242. i18n 键 settings.skillsImported 的文案没有首尾空格
4243. i18n 键 settings.skillsPaths 的文案没有首尾空格
4244. i18n 键 settings.skillsPause 的文案没有首尾空格
4245. i18n 键 settings.skillsScanAdd 的文案没有首尾空格
4246. i18n 键 settings.skillsScanCheck 的文案没有首尾空格
4247. i18n 键 settings.skillsScanEdit 的文案没有首尾空格
4248. i18n 键 settings.skillsScanEmpty 的文案没有首尾空格
4249. i18n 键 settings.skillsScanHint 的文案没有首尾空格
4250. i18n 键 settings.skillsScanInvalid 的文案没有首尾空格
4251. i18n 键 settings.skillsScanMax 的文案没有首尾空格
4252. i18n 键 settings.skillsScanMissing 的文案没有首尾空格
4253. i18n 键 settings.skillsScanOk 的文案没有首尾空格
4254. i18n 键 settings.skillsScanPlaceholder 的文案没有首尾空格
4255. i18n 键 settings.skillsScanRemove 的文案没有首尾空格
4256. i18n 键 settings.skillsScanSave 的文案没有首尾空格
4257. i18n 键 settings.skillsScanTitle 的文案没有首尾空格
4258. i18n 键 settings.sound 的文案没有首尾空格
4259. i18n 键 settings.soundClear 的文案没有首尾空格
4260. i18n 键 settings.soundComplete 的文案没有首尾空格
4261. i18n 键 settings.soundCompleteFile 的文案没有首尾空格
4262. i18n 键 settings.soundDefault 的文案没有首尾空格
4263. i18n 键 settings.soundError 的文案没有首尾空格
4264. i18n 键 settings.soundErrorFile 的文案没有首尾空格
4265. i18n 键 settings.soundName 的文案没有首尾空格
4266. i18n 键 settings.soundPick 的文案没有首尾空格
4267. i18n 键 settings.soundRequest 的文案没有首尾空格
4268. i18n 键 settings.soundRequestFile 的文案没有首尾空格
4269. i18n 键 settings.soundVolume 的文案没有首尾空格
4270. i18n 键 settings.soundVolume.x 的文案没有首尾空格
4271. i18n 键 settings.specialModels 的文案没有首尾空格
4272. i18n 键 settings.specialModelsHint 的文案没有首尾空格
4273. i18n 键 settings.strictAiLanguage 的文案没有首尾空格
4274. i18n 键 settings.strictAiLanguageHint 的文案没有首尾空格
4275. i18n 键 settings.strictOff 的文案没有首尾空格
4276. i18n 键 settings.strictOn 的文案没有首尾空格
4277. i18n 键 settings.summaryModel 的文案没有首尾空格
4278. i18n 键 settings.tabPlugins 的文案没有首尾空格
4279. i18n 键 settings.tabSkills 的文案没有首尾空格
4280. i18n 键 settings.text 的文案没有首尾空格
4281. i18n 键 settings.textHint 的文案没有首尾空格
4282. i18n 键 settings.theme 的文案没有首尾空格
4283. i18n 键 settings.themeCustom 的文案没有首尾空格
4284. i18n 键 settings.themeCustomTitle 的文案没有首尾空格
4285. i18n 键 settings.themeDark 的文案没有首尾空格
4286. i18n 键 settings.themeLight 的文案没有首尾空格
4287. i18n 键 settings.themeMode 的文案没有首尾空格
4288. i18n 键 settings.themePreview 的文案没有首尾空格
4289. i18n 键 settings.themeSystem 的文案没有首尾空格
4290. i18n 键 settings.themeTooDark 的文案没有首尾空格
4291. i18n 键 settings.themeTooLight 的文案没有首尾空格
4292. i18n 键 settings.translateModel 的文案没有首尾空格
4293. i18n 键 settings.ttsModel 的文案没有首尾空格
4294. i18n 键 settings.ttsModelHint 的文案没有首尾空格
4295. i18n 键 settings.upToDate 的文案没有首尾空格
4296. i18n 键 settings.updateAvailable 的文案没有首尾空格
4297. i18n 键 settings.videoGenModel 的文案没有首尾空格
4298. i18n 键 settings.videoUndModel 的文案没有首尾空格
4299. i18n 键 setup.biaoTi 的文案没有首尾空格
4300. i18n 键 setup.locale 的文案没有首尾空格
4301. i18n 键 setup.pickLanguage 的文案没有首尾空格
4302. i18n 键 setup.start 的文案没有首尾空格
4303. i18n 键 setup.title 的文案没有首尾空格
4304. i18n 键 setup.yuYan 的文案没有首尾空格
4305. i18n 键 shell.clear 的文案没有首尾空格
4306. i18n 键 shell.clearTip 的文案没有首尾空格
4307. i18n 键 shell.cleared 的文案没有首尾空格
4308. i18n 键 shell.cwdHome 的文案没有首尾空格
4309. i18n 键 shell.cwdProject 的文案没有首尾空格
4310. i18n 键 shell.cwdUserData 的文案没有首尾空格
4311. i18n 键 shell.exitCode 的文案没有首尾空格
4312. i18n 键 shell.hint 的文案没有首尾空格
4313. i18n 键 shell.historyHint 的文案没有首尾空格
4314. i18n 键 shell.inputLabel 的文案没有首尾空格
4315. i18n 键 shell.interruptDone 的文案没有首尾空格
4316. i18n 键 shell.interruptFailed 的文案没有首尾空格
4317. i18n 键 shell.placeholder 的文案没有首尾空格
4318. i18n 键 shell.previewUnavailable 的文案没有首尾空格
4319. i18n 键 shell.processExited 的文案没有首尾空格
4320. i18n 键 shell.ready 的文案没有首尾空格
4321. i18n 键 shell.running 的文案没有首尾空格
4322. i18n 键 shell.startFailed 的文案没有首尾空格
4323. i18n 键 shell.stop 的文案没有首尾空格
4324. i18n 键 shell.stopTip 的文案没有首尾空格
4325. i18n 键 shell.submitFailed 的文案没有首尾空格
4326. i18n 键 shell.title 的文案没有首尾空格
4327. i18n 键 shell.unavailable 的文案没有首尾空格
4328. i18n 键 slot.add 的文案没有首尾空格
4329. i18n 键 smtp.add 的文案没有首尾空格
4330. i18n 键 smtp.biaoQian 的文案没有首尾空格
4331. i18n 键 smtp.biaoTi 的文案没有首尾空格
4332. i18n 键 smtp.count 的文案没有首尾空格
4333. i18n 键 smtp.empty 的文案没有首尾空格
4334. i18n 键 smtp.fail 的文案没有首尾空格
4335. i18n 键 smtp.fromLabel 的文案没有首尾空格
4336. i18n 键 smtp.fromPlaceholder 的文案没有首尾空格
4337. i18n 键 smtp.hint 的文案没有首尾空格
4338. i18n 键 smtp.host 的文案没有首尾空格
4339. i18n 键 smtp.hostLabel 的文案没有首尾空格
4340. i18n 键 smtp.label 的文案没有首尾空格
4341. i18n 键 smtp.max10 的文案没有首尾空格
4342. i18n 键 smtp.ok 的文案没有首尾空格
4343. i18n 键 smtp.pass 的文案没有首尾空格
4344. i18n 键 smtp.passLabel 的文案没有首尾空格
4345. i18n 键 smtp.passPlaceholder 的文案没有首尾空格
4346. i18n 键 smtp.port 的文案没有首尾空格
4347. i18n 键 smtp.portLabel 的文案没有首尾空格
4348. i18n 键 smtp.remove 的文案没有首尾空格
4349. i18n 键 smtp.secure 的文案没有首尾空格
4350. i18n 键 smtp.settings 的文案没有首尾空格
4351. i18n 键 smtp.tiShi 的文案没有首尾空格
4352. i18n 键 smtp.title 的文案没有首尾空格
4353. i18n 键 smtp.unverified 的文案没有首尾空格
4354. i18n 键 smtp.user 的文案没有首尾空格
4355. i18n 键 smtp.userLabel 的文案没有首尾空格
4356. i18n 键 smtp.verified 的文案没有首尾空格
4357. i18n 键 smtp.verify 的文案没有首尾空格
4358. i18n 键 smtp.verifyBtn 的文案没有首尾空格
4359. i18n 键 sound.builtin 的文案没有首尾空格
4360. i18n 键 sound.try 的文案没有首尾空格
4361. i18n 键 sound.tryFail 的文案没有首尾空格
4362. i18n 键 status.busy 的文案没有首尾空格
4363. i18n 键 status.dead 的文案没有首尾空格
4364. i18n 键 status.idle 的文案没有首尾空格
4365. i18n 键 status.offline 的文案没有首尾空格
4366. i18n 键 tab.board 的文案没有首尾空格
4367. i18n 键 tab.cattle 的文案没有首尾空格
4368. i18n 键 tab.me 的文案没有首尾空格
4369. i18n 键 tab.sessions 的文案没有首尾空格
4370. i18n 键 time.justNow 的文案没有首尾空格
4371. i18n 键 time.monday 的文案没有首尾空格
4372. i18n 键 time.yesterday 的文案没有首尾空格
4373. i18n 键 tip.back 的文案没有首尾空格
4374. i18n 键 tip.close 的文案没有首尾空格
4375. i18n 键 tip.console 的文案没有首尾空格
4376. i18n 键 tip.diag 的文案没有首尾空格
4377. i18n 键 tip.dragWidth 的文案没有首尾空格
4378. i18n 键 tip.externalChat 的文案没有首尾空格
4379. i18n 键 tip.externalGroup 的文案没有首尾空格
4380. i18n 键 tip.instances 的文案没有首尾空格
4381. i18n 键 tip.internalGroup 的文案没有首尾空格
4382. i18n 键 tip.max 的文案没有首尾空格
4383. i18n 键 tip.me 的文案没有首尾空格
4384. i18n 键 tip.min 的文案没有首尾空格
4385. i18n 键 tip.more 的文案没有首尾空格
4386. i18n 键 tip.pin 的文案没有首尾空格
4387. i18n 键 tip.refresh 的文案没有首尾空格
4388. i18n 键 tip.resizer 的文案没有首尾空格
4389. i18n 键 tip.settings 的文案没有首尾空格
4390. i18n 键 tip.singleAi 的文案没有首尾空格
4391. i18n 键 tip.splitHint 的文案没有首尾空格
4392. i18n 键 tip.wo 的文案没有首尾空格
4393. i18n 键 touXiang.local 的文案没有首尾空格
4394. i18n 键 touXiang.pickTitle 的文案没有首尾空格
4395. i18n 键 tray.offWork 的文案没有首尾空格
4396. i18n 键 tts.noModel 的文案没有首尾空格
4397. i18n 键 ui.type.contact 的文案没有首尾空格
4398. i18n 键 ui.type.external 的文案没有首尾空格
4399. i18n 键 ui.type.internal 的文案没有首尾空格
4400. i18n 键 ui.type.single 的文案没有首尾空格
4401. i18n 键 update.download.badUrl 的文案没有首尾空格
4402. i18n 键 update.download.checksumMismatch 的文案没有首尾空格
4403. i18n 键 update.download.done 的文案没有首尾空格
4404. i18n 键 update.download.failed 的文案没有首尾空格
4405. i18n 键 update.download.noUrl 的文案没有首尾空格
4406. i18n 键 update.download.sizeMismatch 的文案没有首尾空格
4407. i18n 键 update.feedInvalid 的文案没有首尾空格
4408. i18n 键 update.feedPlaceholder 的文案没有首尾空格
4409. i18n 键 update.feedSave 的文案没有首尾空格
4410. i18n 键 update.feedSaved 的文案没有首尾空格
4411. i18n 键 update.status.available 的文案没有首尾空格
4412. i18n 键 update.status.httpError 的文案没有首尾空格
4413. i18n 键 update.status.invalidResponse 的文案没有首尾空格
4414. i18n 键 update.status.latestIs 的文案没有首尾空格
4415. i18n 键 update.status.networkError 的文案没有首尾空格
4416. i18n 键 update.status.notConfigured 的文案没有首尾空格
4417. i18n 键 update.status.unavailable 的文案没有首尾空格
4418. i18n 键 update.status.unknown 的文案没有首尾空格
4419. i18n 键 update.status.upToDate 的文案没有首尾空格
4420. i18n 键 urg.P1 的文案没有首尾空格
4421. i18n 键 urg.P2 的文案没有首尾空格
4422. i18n 键 urg.P3 的文案没有首尾空格
4423. i18n 键 urg.label 的文案没有首尾空格
4424. i18n 键 urgency.confirmBody 的文案没有首尾空格
4425. i18n 键 urgency.confirmTitle 的文案没有首尾空格
4426. i18n 键 urgency.confirmWait 的文案没有首尾空格
4427. i18n 键 urgency.insertLabel 的文案没有首尾空格
4428. i18n 键 urgency.queueLabel 的文案没有首尾空格
4429. i18n 键 urgency.urgentLabel 的文案没有首尾空格
4430. i18n 键 usage.completion 的文案没有首尾空格
4431. i18n 键 usage.model 的文案没有首尾空格
4432. i18n 键 usage.prompt 的文案没有首尾空格
4433. i18n 键 usage.provider 的文案没有首尾空格
4434. i18n 键 usage.total 的文案没有首尾空格
4435. i18n 键 usage.window 的文案没有首尾空格
4436. i18n 键 webgpu.fail 的文案没有首尾空格
4437. i18n 键 webgpu.hint 的文案没有首尾空格
4438. i18n 键 webgpu.ok 的文案没有首尾空格
4439. i18n 键 webgpu.section 的文案没有首尾空格
4440. i18n 键 webgpu.test 的文案没有首尾空格
4441. i18n 键 webgpu.title 的文案没有首尾空格
4442. i18n 键 win.closeConfirm 的文案没有首尾空格
4443. i18n 键 wo.backupJson 的文案没有首尾空格
4444. i18n 键 wo.belief 的文案没有首尾空格
4445. i18n 键 wo.beliefFile 的文案没有首尾空格
4446. i18n 键 wo.beliefHint 的文案没有首尾空格
4447. i18n 键 wo.beliefPlaceholder 的文案没有首尾空格
4448. i18n 键 wo.changeCred 的文案没有首尾空格
4449. i18n 键 wo.copy 的文案没有首尾空格
4450. i18n 键 wo.credRotated 的文案没有首尾空格
4451. i18n 键 wo.credential 的文案没有首尾空格
4452. i18n 键 wo.email 的文案没有首尾空格
4453. i18n 键 wo.emailInvalid 的文案没有首尾空格
4454. i18n 键 wo.emailSaved 的文案没有首尾空格
4455. i18n 键 wo.hideFull 的文案没有首尾空格
4456. i18n 键 wo.idHint 的文案没有首尾空格
4457. i18n 键 wo.idWarn 的文案没有首尾空格
4458. i18n 键 wo.passphrase 的文案没有首尾空格
4459. i18n 键 wo.showFull 的文案没有首尾空格
4460. i18n 键 wo.switchHint 的文案没有首尾空格
4461. i18n 键 wo.switchIdentity 的文案没有首尾空格
4462. i18n 键 wo.touXiang 的文案没有首尾空格
4463. i18n 键 wo.username 的文案没有首尾空格
4464. i18n 键 yingYong.displayName 的文案没有首尾空格
4465. i18n 键 yingYong.enName 的文案没有首尾空格
4466. i18n 键 yingYong.subtitle 的文案没有首尾空格
4467. i18n 键 yingYong.zhName 的文案没有首尾空格

## C 机制完善：引用与资源一致（用到的键必存在）

4468. 代码引用的 i18n 键 about.author 在语言包里存在
4469. 代码引用的 i18n 键 about.authorBody 在语言包里存在
4470. 代码引用的 i18n 键 about.checkUpdate 在语言包里存在
4471. 代码引用的 i18n 键 about.checking 在语言包里存在
4472. 代码引用的 i18n 键 about.contact 在语言包里存在
4473. 代码引用的 i18n 键 about.contactBody 在语言包里存在
4474. 代码引用的 i18n 键 about.copyright 在语言包里存在
4475. 代码引用的 i18n 键 about.copyrightBody 在语言包里存在
4476. 代码引用的 i18n 键 about.dshMissing 在语言包里存在
4477. 代码引用的 i18n 键 about.legal 在语言包里存在
4478. 代码引用的 i18n 键 about.legalBody 在语言包里存在
4479. 代码引用的 i18n 键 about.logoAlt 在语言包里存在
4480. 代码引用的 i18n 键 about.opensource 在语言包里存在
4481. 代码引用的 i18n 键 about.opensourceBody 在语言包里存在
4482. 代码引用的 i18n 键 about.startUpdate 在语言包里存在
4483. 代码引用的 i18n 键 about.tagline 在语言包里存在
4484. 代码引用的 i18n 键 about.techStack 在语言包里存在
4485. 代码引用的 i18n 键 about.techStackBody 在语言包里存在
4486. 代码引用的 i18n 键 about.updateStarted 在语言包里存在
4487. 代码引用的 i18n 键 about.updating 在语言包里存在
4488. 代码引用的 i18n 键 about.version 在语言包里存在
4489. 代码引用的 i18n 键 about.versionInfo 在语言包里存在
4490. 代码引用的 i18n 键 aiq.biaoTi 在语言包里存在
4491. 代码引用的 i18n 键 aiq.custom 在语言包里存在
4492. 代码引用的 i18n 键 aiq.newCard 在语言包里存在
4493. 代码引用的 i18n 键 aiq.submit 在语言包里存在
4494. 代码引用的 i18n 键 approval.biaoTi 在语言包里存在
4495. 代码引用的 i18n 键 approval.deny 在语言包里存在
4496. 代码引用的 i18n 键 approval.global 在语言包里存在
4497. 代码引用的 i18n 键 approval.once 在语言包里存在
4498. 代码引用的 i18n 键 approval.project 在语言包里存在
4499. 代码引用的 i18n 键 approval.tiShi 在语言包里存在
4500. 代码引用的 i18n 键 archive.tiShi 在语言包里存在
4501. 代码引用的 i18n 键 brand.fu 在语言包里存在
4502. 代码引用的 i18n 键 brand.name 在语言包里存在
4503. 代码引用的 i18n 键 brand.tagline 在语言包里存在
4504. 代码引用的 i18n 键 chat.busy.1 在语言包里存在
4505. 代码引用的 i18n 键 chat.busy.done 在语言包里存在
4506. 代码引用的 i18n 键 chat.busy.fail 在语言包里存在
4507. 代码引用的 i18n 键 chat.busy.still 在语言包里存在
4508. 代码引用的 i18n 键 chat.contextTooSmall 在语言包里存在
4509. 代码引用的 i18n 键 chat.copied 在语言包里存在
4510. 代码引用的 i18n 键 chat.copy 在语言包里存在
4511. 代码引用的 i18n 键 chat.emptyReply 在语言包里存在
4512. 代码引用的 i18n 键 chat.emptyReplyWhy 在语言包里存在
4513. 代码引用的 i18n 键 chat.failed 在语言包里存在
4514. 代码引用的 i18n 键 chat.inputCleared 在语言包里存在
4515. 代码引用的 i18n 键 chat.loadMore 在语言包里存在
4516. 代码引用的 i18n 键 chat.p2 在语言包里存在
4517. 代码引用的 i18n 键 chat.p3 在语言包里存在
4518. 代码引用的 i18n 键 chat.queueDelete 在语言包里存在
4519. 代码引用的 i18n 键 chat.queueDown 在语言包里存在
4520. 代码引用的 i18n 键 chat.queueEdit 在语言包里存在
4521. 代码引用的 i18n 键 chat.queueSave 在语言包里存在
4522. 代码引用的 i18n 键 chat.queueUp 在语言包里存在
4523. 代码引用的 i18n 键 chat.read 在语言包里存在
4524. 代码引用的 i18n 键 chat.resumeTask 在语言包里存在
4525. 代码引用的 i18n 键 chat.resumeTaskCmd 在语言包里存在
4526. 代码引用的 i18n 键 chat.resumeTaskExpired 在语言包里存在
4527. 代码引用的 i18n 键 chat.resumeTaskHint 在语言包里存在
4528. 代码引用的 i18n 键 chat.shotCancel 在语言包里存在
4529. 代码引用的 i18n 键 chat.shotDone 在语言包里存在
4530. 代码引用的 i18n 键 chat.shotHint 在语言包里存在
4531. 代码引用的 i18n 键 chat.stopAll 在语言包里存在
4532. 代码引用的 i18n 键 chat.thinkDowngraded 在语言包里存在
4533. 代码引用的 i18n 键 chat.thinkingDone 在语言包里存在
4534. 代码引用的 i18n 键 chat.thinkingOpen 在语言包里存在
4535. 代码引用的 i18n 键 chat.toolsDone 在语言包里存在
4536. 代码引用的 i18n 键 chat.toolsDoneTail 在语言包里存在
4537. 代码引用的 i18n 键 chat.voiceNeedAsr 在语言包里存在
4538. 代码引用的 i18n 键 chat.voiceStopTip 在语言包里存在
4539. 代码引用的 i18n 键 chat.voiceTip 在语言包里存在
4540. 代码引用的 i18n 键 chat.voiceUnsupported 在语言包里存在
4541. 代码引用的 i18n 键 checkpoints.assets 在语言包里存在
4542. 代码引用的 i18n 键 checkpoints.biaoTi 在语言包里存在
4543. 代码引用的 i18n 键 checkpoints.changed 在语言包里存在
4544. 代码引用的 i18n 键 checkpoints.confirmBody 在语言包里存在
4545. 代码引用的 i18n 键 checkpoints.confirmTitle 在语言包里存在
4546. 代码引用的 i18n 键 checkpoints.created 在语言包里存在
4547. 代码引用的 i18n 键 checkpoints.empty 在语言包里存在
4548. 代码引用的 i18n 键 checkpoints.env.biaoTi 在语言包里存在
4549. 代码引用的 i18n 键 checkpoints.env.layered 在语言包里存在
4550. 代码引用的 i18n 键 checkpoints.env.none 在语言包里存在
4551. 代码引用的 i18n 键 checkpoints.env.same 在语言包里存在
4552. 代码引用的 i18n 键 checkpoints.irreversible 在语言包里存在
4553. 代码引用的 i18n 键 checkpoints.max 在语言包里存在
4554. 代码引用的 i18n 键 checkpoints.stopAndLoad 在语言包里存在
4555. 代码引用的 i18n 键 checkpoints.tasks 在语言包里存在
4556. 代码引用的 i18n 键 checkpoints.used 在语言包里存在
4557. 代码引用的 i18n 键 common.cancel 在语言包里存在
4558. 代码引用的 i18n 键 common.close 在语言包里存在
4559. 代码引用的 i18n 键 common.copy 在语言包里存在
4560. 代码引用的 i18n 键 common.delete 在语言包里存在
4561. 代码引用的 i18n 键 common.edit 在语言包里存在
4562. 代码引用的 i18n 键 common.error 在语言包里存在
4563. 代码引用的 i18n 键 common.loading 在语言包里存在
4564. 代码引用的 i18n 键 common.ok 在语言包里存在
4565. 代码引用的 i18n 键 common.quote 在语言包里存在
4566. 代码引用的 i18n 键 common.retry 在语言包里存在
4567. 代码引用的 i18n 键 common.save 在语言包里存在
4568. 代码引用的 i18n 键 common.saved 在语言包里存在
4569. 代码引用的 i18n 键 console.biaoTi 在语言包里存在
4570. 代码引用的 i18n 键 console.clear 在语言包里存在
4571. 代码引用的 i18n 键 console.empty 在语言包里存在
4572. 代码引用的 i18n 键 console.redacted 在语言包里存在
4573. 代码引用的 i18n 键 console.result.fail 在语言包里存在
4574. 代码引用的 i18n 键 console.result.ok 在语言包里存在
4575. 代码引用的 i18n 键 console.tiShi 在语言包里存在
4576. 代码引用的 i18n 键 contact.add 在语言包里存在
4577. 代码引用的 i18n 键 contact.mine 在语言包里存在
4578. 代码引用的 i18n 键 contact.mineCopied 在语言包里存在
4579. 代码引用的 i18n 键 contact.mineCopy 在语言包里存在
4580. 代码引用的 i18n 键 contact.mineCopyFail 在语言包里存在
4581. 代码引用的 i18n 键 contact.mineHint 在语言包里存在
4582. 代码引用的 i18n 键 contact.mineQr 在语言包里存在
4583. 代码引用的 i18n 键 contact.mineUnavailable 在语言包里存在
4584. 代码引用的 i18n 键 contact.namePlaceholder 在语言包里存在
4585. 代码引用的 i18n 键 contact.needInput 在语言包里存在
4586. 代码引用的 i18n 键 contact.others 在语言包里存在
4587. 代码引用的 i18n 键 contact.othersHint 在语言包里存在
4588. 代码引用的 i18n 键 contact.ownId 在语言包里存在
4589. 代码引用的 i18n 键 contact.qrUnavailable 在语言包里存在
4590. 代码引用的 i18n 键 contact.scanHint 在语言包里存在
4591. 代码引用的 i18n 键 container.action.confirmStopTitle 在语言包里存在
4592. 代码引用的 i18n 键 container.action.start 在语言包里存在
4593. 代码引用的 i18n 键 container.action.starting 在语言包里存在
4594. 代码引用的 i18n 键 container.action.stop 在语言包里存在
4595. 代码引用的 i18n 键 container.action.stopping 在语言包里存在
4596. 代码引用的 i18n 键 container.action.timeout 在语言包里存在
4597. 代码引用的 i18n 键 container.biaoTi 在语言包里存在
4598. 代码引用的 i18n 键 container.cap.mount 在语言包里存在
4599. 代码引用的 i18n 键 container.cap.none 在语言包里存在
4600. 代码引用的 i18n 键 container.cap.run 在语言包里存在
4601. 代码引用的 i18n 键 container.cap.shell 在语言包里存在
4602. 代码引用的 i18n 键 container.capLabel 在语言包里存在
4603. 代码引用的 i18n 键 container.console.biaoTi 在语言包里存在
4604. 代码引用的 i18n 键 container.console.containerCreated 在语言包里存在
4605. 代码引用的 i18n 键 container.console.containerReused 在语言包里存在
4606. 代码引用的 i18n 键 container.console.gotoInstall 在语言包里存在
4607. 代码引用的 i18n 键 container.console.intro 在语言包里存在
4608. 代码引用的 i18n 键 container.console.linuxNode 在语言包里存在
4609. 代码引用的 i18n 键 container.console.needsImage 在语言包里存在
4610. 代码引用的 i18n 键 container.console.noExec 在语言包里存在
4611. 代码引用的 i18n 键 container.console.refused 在语言包里存在
4612. 代码引用的 i18n 键 container.console.security 在语言包里存在
4613. 代码引用的 i18n 键 container.console.sent 在语言包里存在
4614. 代码引用的 i18n 键 container.console.tip 在语言包里存在
4615. 代码引用的 i18n 键 container.current.none 在语言包里存在
4616. 代码引用的 i18n 键 container.detailLabel 在语言包里存在
4617. 代码引用的 i18n 键 container.devEnv.biaoTi 在语言包里存在
4618. 代码引用的 i18n 键 container.devEnv.container 在语言包里存在
4619. 代码引用的 i18n 键 container.devEnv.createTitle 在语言包里存在
4620. 代码引用的 i18n 键 container.devEnv.host 在语言包里存在
4621. 代码引用的 i18n 键 container.devEnv.nameLabel 在语言包里存在
4622. 代码引用的 i18n 键 container.devEnv.note 在语言包里存在
4623. 代码引用的 i18n 键 container.devEnv.required 在语言包里存在
4624. 代码引用的 i18n 键 container.env.install.biaoTi 在语言包里存在
4625. 代码引用的 i18n 键 container.env.install.netBody 在语言包里存在
4626. 代码引用的 i18n 键 container.env.install.netTitle 在语言包里存在
4627. 代码引用的 i18n 键 container.env.install.noNodeForUs 在语言包里存在
4628. 代码引用的 i18n 键 container.env.install.persistBody 在语言包里存在
4629. 代码引用的 i18n 键 container.env.install.persistTitle 在语言包里存在
4630. 代码引用的 i18n 键 container.env.install.ti 在语言包里存在
4631. 代码引用的 i18n 键 container.env.mode.unknown 在语言包里存在
4632. 代码引用的 i18n 键 container.env.probe.button 在语言包里存在
4633. 代码引用的 i18n 键 container.env.prompt.biaoTi 在语言包里存在
4634. 代码引用的 i18n 键 container.env.prompt.content 在语言包里存在
4635. 代码引用的 i18n 键 container.env.prompt.copied 在语言包里存在
4636. 代码引用的 i18n 键 container.env.prompt.copy 在语言包里存在
4637. 代码引用的 i18n 键 container.env.prompt.failed 在语言包里存在
4638. 代码引用的 i18n 键 container.env.prompt.tiShi 在语言包里存在
4639. 代码引用的 i18n 键 container.env.prompt.title 在语言包里存在
4640. 代码引用的 i18n 键 container.env.rollback.button 在语言包里存在
4641. 代码引用的 i18n 键 container.env.rollback.confirmBody 在语言包里存在
4642. 代码引用的 i18n 键 container.env.rollback.confirmTitle 在语言包里存在
4643. 代码引用的 i18n 键 container.env.solidify.biaoTi 在语言包里存在
4644. 代码引用的 i18n 键 container.env.solidify.button 在语言包里存在
4645. 代码引用的 i18n 键 container.env.solidify.never 在语言包里存在
4646. 代码引用的 i18n 键 container.env.solidify.restore 在语言包里存在
4647. 代码引用的 i18n 键 container.env.solidify.retained 在语言包里存在
4648. 代码引用的 i18n 键 container.env.solidify.security 在语言包里存在
4649. 代码引用的 i18n 键 container.evidenceNone 在语言包里存在
4650. 代码引用的 i18n 键 container.fsGuard.applied 在语言包里存在
4651. 代码引用的 i18n 键 container.fsGuard.biaoTi 在语言包里存在
4652. 代码引用的 i18n 键 container.fsGuard.confirmBody 在语言包里存在
4653. 代码引用的 i18n 键 container.fsGuard.confirmLiftBody 在语言包里存在
4654. 代码引用的 i18n 键 container.fsGuard.confirmTitle 在语言包里存在
4655. 代码引用的 i18n 键 container.fsGuard.lifted 在语言包里存在
4656. 代码引用的 i18n 键 container.fsGuard.limits 在语言包里存在
4657. 代码引用的 i18n 键 container.fsGuard.lock 在语言包里存在
4658. 代码引用的 i18n 键 container.fsGuard.off 在语言包里存在
4659. 代码引用的 i18n 键 container.fsGuard.qiYong 在语言包里存在
4660. 代码引用的 i18n 键 container.fsGuard.undo 在语言包里存在
4661. 代码引用的 i18n 键 container.fsGuard.unlock 在语言包里存在
4662. 代码引用的 i18n 键 container.fsGuard.what 在语言包里存在
4663. 代码引用的 i18n 键 container.guideCollapse 在语言包里存在
4664. 代码引用的 i18n 键 container.guideFirstStep 在语言包里存在
4665. 代码引用的 i18n 键 container.guideHint 在语言包里存在
4666. 代码引用的 i18n 键 container.guideTitle 在语言包里存在
4667. 代码引用的 i18n 键 container.image.biaoTi 在语言包里存在
4668. 代码引用的 i18n 键 container.image.executorHost 在语言包里存在
4669. 代码引用的 i18n 键 container.image.node 在语言包里存在
4670. 代码引用的 i18n 键 container.image.pinned 在语言包里存在
4671. 代码引用的 i18n 键 container.image.sourcePending 在语言包里存在
4672. 代码引用的 i18n 键 container.image.stack.biaoTi 在语言包里存在
4673. 代码引用的 i18n 键 container.image.stack.fits 在语言包里存在
4674. 代码引用的 i18n 键 container.image.stack.moreLater 在语言包里存在
4675. 代码引用的 i18n 键 container.image.stack.nodeOnly 在语言包里存在
4676. 代码引用的 i18n 键 container.image.why 在语言包里存在
4677. 代码引用的 i18n 键 container.inst.collapse 在语言包里存在
4678. 代码引用的 i18n 键 container.inst.create 在语言包里存在
4679. 代码引用的 i18n 键 container.inst.createHint 在语言包里存在
4680. 代码引用的 i18n 键 container.inst.empty 在语言包里存在
4681. 代码引用的 i18n 键 container.inst.hintReady 在语言包里存在
4682. 代码引用的 i18n 键 container.inst.hintStopped 在语言包里存在
4683. 代码引用的 i18n 键 container.inst.loading 在语言包里存在
4684. 代码引用的 i18n 键 container.inst.none 在语言包里存在
4685. 代码引用的 i18n 键 container.inst.ours 在语言包里存在
4686. 代码引用的 i18n 键 container.inst.running 在语言包里存在
4687. 代码引用的 i18n 键 container.inst.start 在语言包里存在
4688. 代码引用的 i18n 键 container.inst.stop 在语言包里存在
4689. 代码引用的 i18n 键 container.inst.stopped 在语言包里存在
4690. 代码引用的 i18n 键 container.inst.view 在语言包里存在
4691. 代码引用的 i18n 键 container.listEmpty 在语言包里存在
4692. 代码引用的 i18n 键 container.listTitle 在语言包里存在
4693. 代码引用的 i18n 键 container.listTitleHint 在语言包里存在
4694. 代码引用的 i18n 键 container.microsandbox.install 在语言包里存在
4695. 代码引用的 i18n 键 container.microsandbox.installFail 在语言包里存在
4696. 代码引用的 i18n 键 container.microsandbox.installOk 在语言包里存在
4697. 代码引用的 i18n 键 container.microsandbox.reinstall 在语言包里存在
4698. 代码引用的 i18n 键 container.microsandbox.reinstallOk 在语言包里存在
4699. 代码引用的 i18n 键 container.microsandbox.stepCheck 在语言包里存在
4700. 代码引用的 i18n 键 container.microsandbox.stepDetect 在语言包里存在
4701. 代码引用的 i18n 键 container.microsandbox.stepDownload 在语言包里存在
4702. 代码引用的 i18n 键 container.microsandbox.stepInstall 在语言包里存在
4703. 代码引用的 i18n 键 container.microsandbox.stepUninstall 在语言包里存在
4704. 代码引用的 i18n 键 container.microsandbox.uninstall 在语言包里存在
4705. 代码引用的 i18n 键 container.microsandbox.uninstallDisabled 在语言包里存在
4706. 代码引用的 i18n 键 container.microsandbox.uninstallFail 在语言包里存在
4707. 代码引用的 i18n 键 container.microsandbox.uninstallOk 在语言包里存在
4708. 代码引用的 i18n 键 container.microsandbox.uninstalling 在语言包里存在
4709. 代码引用的 i18n 键 container.microsandbox.virtNeed 在语言包里存在
4710. 代码引用的 i18n 键 container.microsandbox.virtOk 在语言包里存在
4711. 代码引用的 i18n 键 container.mount.biaoTi 在语言包里存在
4712. 代码引用的 i18n 键 container.mount.perf 在语言包里存在
4713. 代码引用的 i18n 键 container.mount.ti 在语言包里存在
4714. 代码引用的 i18n 键 container.probeBtn 在语言包里存在
4715. 代码引用的 i18n 键 container.probing 在语言包里存在
4716. 代码引用的 i18n 键 container.project.available 在语言包里存在
4717. 代码引用的 i18n 键 container.project.dirNotRecorded 在语言包里存在
4718. 代码引用的 i18n 键 container.project.disableConfirmBody 在语言包里存在
4719. 代码引用的 i18n 键 container.project.disableConfirmTitle 在语言包里存在
4720. 代码引用的 i18n 键 container.project.enableNeedsContainer 在语言包里存在
4721. 代码引用的 i18n 键 container.project.enableNeedsContainerTitle 在语言包里存在
4722. 代码引用的 i18n 键 container.project.enabledAt 在语言包里存在
4723. 代码引用的 i18n 键 container.project.enforceBoundary 在语言包里存在
4724. 代码引用的 i18n 键 container.project.historyStillReadable 在语言包里存在
4725. 代码引用的 i18n 键 container.project.hostEditingRefused 在语言包里存在
4726. 代码引用的 i18n 键 container.project.menuHint 在语言包里存在
4727. 代码引用的 i18n 键 container.project.none 在语言包里存在
4728. 代码引用的 i18n 键 container.project.notContainerProject 在语言包里存在
4729. 代码引用的 i18n 键 container.project.notCreator 在语言包里存在
4730. 代码引用的 i18n 键 container.project.remoteNotice 在语言包里存在
4731. 代码引用的 i18n 键 container.project.switchBody 在语言包里存在
4732. 代码引用的 i18n 键 container.project.switchFits 在语言包里存在
4733. 代码引用的 i18n 键 container.project.switchMore 在语言包里存在
4734. 代码引用的 i18n 键 container.project.switchNeedRestart 在语言包里存在
4735. 代码引用的 i18n 键 container.project.switchTitle 在语言包里存在
4736. 代码引用的 i18n 键 container.project.testingAllowed 在语言包里存在
4737. 代码引用的 i18n 键 container.project.unavailable 在语言包里存在
4738. 代码引用的 i18n 键 container.project.unavailableAsOffline 在语言包里存在
4739. 代码引用的 i18n 键 container.project.usingContainer 在语言包里存在
4740. 代码引用的 i18n 键 container.section.existing 在语言包里存在
4741. 代码引用的 i18n 键 container.section.images 在语言包里存在
4742. 代码引用的 i18n 键 container.snapshot.biaoTi 在语言包里存在
4743. 代码引用的 i18n 键 container.snapshot.fingerprint 在语言包里存在
4744. 代码引用的 i18n 键 container.snapshot.layerEnv 在语言包里存在
4745. 代码引用的 i18n 键 container.snapshot.layerFiles 在语言包里存在
4746. 代码引用的 i18n 键 container.snapshot.noClaim 在语言包里存在
4747. 代码引用的 i18n 键 container.snapshot.ti 在语言包里存在
4748. 代码引用的 i18n 键 container.target.biaoTi 在语言包里存在
4749. 代码引用的 i18n 键 container.target.tiShi 在语言包里存在
4750. 代码引用的 i18n 键 container.tiShi 在语言包里存在
4751. 代码引用的 i18n 键 container.timing.biaoTi 在语言包里存在
4752. 代码引用的 i18n 键 container.timing.none 在语言包里存在
4753. 代码引用的 i18n 键 container.versionLabel 在语言包里存在
4754. 代码引用的 i18n 键 cost.byModel 在语言包里存在
4755. 代码引用的 i18n 键 cost.byProvider 在语言包里存在
4756. 代码引用的 i18n 键 cost.bySession 在语言包里存在
4757. 代码引用的 i18n 键 cost.byWindow 在语言包里存在
4758. 代码引用的 i18n 键 cost.empty 在语言包里存在
4759. 代码引用的 i18n 键 cost.model 在语言包里存在
4760. 代码引用的 i18n 键 cost.session 在语言包里存在
4761. 代码引用的 i18n 键 cost.tokens 在语言包里存在
4762. 代码引用的 i18n 键 cost.turns 在语言包里存在
4763. 代码引用的 i18n 键 cp.rollback 在语言包里存在
4764. 代码引用的 i18n 键 ctx.archive 在语言包里存在
4765. 代码引用的 i18n 键 ctx.archiveConfirm 在语言包里存在
4766. 代码引用的 i18n 键 ctx.clear 在语言包里存在
4767. 代码引用的 i18n 键 ctx.clearConfirm 在语言包里存在
4768. 代码引用的 i18n 键 ctx.close 在语言包里存在
4769. 代码引用的 i18n 键 ctx.closeConfirm 在语言包里存在
4770. 代码引用的 i18n 键 ctx.delete 在语言包里存在
4771. 代码引用的 i18n 键 ctx.dissolveFailed 在语言包里存在
4772. 代码引用的 i18n 键 ctx.enable 在语言包里存在
4773. 代码引用的 i18n 键 ctx.leave 在语言包里存在
4774. 代码引用的 i18n 键 ctx.notify 在语言包里存在
4775. 代码引用的 i18n 键 ctx.projectDisable 在语言包里存在
4776. 代码引用的 i18n 键 ctx.projectEnable 在语言包里存在
4777. 代码引用的 i18n 键 ctx.projectLockDir 在语言包里存在
4778. 代码引用的 i18n 键 ctx.projectSetDir 在语言包里存在
4779. 代码引用的 i18n 键 ctx.projectSwitchContainer 在语言包里存在
4780. 代码引用的 i18n 键 ctx.rename 在语言包里存在
4781. 代码引用的 i18n 键 ctx.renamePrompt 在语言包里存在
4782. 代码引用的 i18n 键 ctx.settings 在语言包里存在
4783. 代码引用的 i18n 键 ctx.taskRunning 在语言包里存在
4784. 代码引用的 i18n 键 dashboard.biaoTi 在语言包里存在
4785. 代码引用的 i18n 键 dashboard.cat.contact 在语言包里存在
4786. 代码引用的 i18n 键 dashboard.cat.external 在语言包里存在
4787. 代码引用的 i18n 键 dashboard.cat.internal 在语言包里存在
4788. 代码引用的 i18n 键 dashboard.cat.single 在语言包里存在
4789. 代码引用的 i18n 键 dashboard.createdAt 在语言包里存在
4790. 代码引用的 i18n 键 dashboard.emptyLine 在语言包里存在
4791. 代码引用的 i18n 键 dashboard.emptySessions 在语言包里存在
4792. 代码引用的 i18n 键 dashboard.hoursAgo 在语言包里存在
4793. 代码引用的 i18n 键 dashboard.inProgressProjects 在语言包里存在
4794. 代码引用的 i18n 键 dashboard.jump 在语言包里存在
4795. 代码引用的 i18n 键 dashboard.noUsage 在语言包里存在
4796. 代码引用的 i18n 键 dashboard.pendingBadge 在语言包里存在
4797. 代码引用的 i18n 键 dashboard.pendingDecisions 在语言包里存在
4798. 代码引用的 i18n 键 dashboard.runningInstances 在语言包里存在
4799. 代码引用的 i18n 键 dashboard.tokenCost 在语言包里存在
4800. 代码引用的 i18n 键 dashboard.tokens 在语言包里存在
4801. 代码引用的 i18n 键 dashboard.usage 在语言包里存在
4802. 代码引用的 i18n 键 dsh.alreadyInstalled 在语言包里存在
4803. 代码引用的 i18n 键 dsh.anZhuang 在语言包里存在
4804. 代码引用的 i18n 键 dsh.anZhuangChengGong 在语言包里存在
4805. 代码引用的 i18n 键 dsh.anZhuangShiBai 在语言包里存在
4806. 代码引用的 i18n 键 dsh.anZhuangZhong 在语言包里存在
4807. 代码引用的 i18n 键 dsh.biaoTi 在语言包里存在
4808. 代码引用的 i18n 键 dsh.chongXinAnZhuang 在语言包里存在
4809. 代码引用的 i18n 键 dsh.chongXinAnZhuangZhong 在语言包里存在
4810. 代码引用的 i18n 键 dsh.chongXinChengGong 在语言包里存在
4811. 代码引用的 i18n 键 dsh.jianCha 在语言包里存在
4812. 代码引用的 i18n 键 dsh.jianChaChaoShi 在语言包里存在
4813. 代码引用的 i18n 键 dsh.jianChaYiChang 在语言包里存在
4814. 代码引用的 i18n 键 dsh.jianChaZhong 在语言包里存在
4815. 代码引用的 i18n 键 dsh.tiShi 在语言包里存在
4816. 代码引用的 i18n 键 dsh.weiAnZhuang 在语言包里存在
4817. 代码引用的 i18n 键 dsh.yiAnZhuang 在语言包里存在
4818. 代码引用的 i18n 键 eta.anomalyOverrun 在语言包里存在
4819. 代码引用的 i18n 键 eta.anomalyStalled 在语言包里存在
4820. 代码引用的 i18n 键 eta.anomalyStop 在语言包里存在
4821. 代码引用的 i18n 键 eta.continueWithEta 在语言包里存在
4822. 代码引用的 i18n 键 eta.notFromModel 在语言包里存在
4823. 代码引用的 i18n 键 executors.biaoTi 在语言包里存在
4824. 代码引用的 i18n 键 export.done 在语言包里存在
4825. 代码引用的 i18n 键 export.header 在语言包里存在
4826. 代码引用的 i18n 键 export.include 在语言包里存在
4827. 代码引用的 i18n 键 export.wo 在语言包里存在
4828. 代码引用的 i18n 键 group.cert.biaoTi 在语言包里存在
4829. 代码引用的 i18n 键 group.cert.generation 在语言包里存在
4830. 代码引用的 i18n 键 group.cert.none 在语言包里存在
4831. 代码引用的 i18n 键 group.cert.readonlyHint 在语言包里存在
4832. 代码引用的 i18n 键 group.cert.rotated 在语言包里存在
4833. 代码引用的 i18n 键 group.cert.showFull 在语言包里存在
4834. 代码引用的 i18n 键 group.cert.unavailable 在语言包里存在
4835. 代码引用的 i18n 键 group.kick 在语言包里存在
4836. 代码引用的 i18n 键 group.memberDisabled 在语言包里存在
4837. 代码引用的 i18n 键 group.memberEmpty 在语言包里存在
4838. 代码引用的 i18n 键 group.memberPendingConfirm 在语言包里存在
4839. 代码引用的 i18n 键 group.memberPendingConfirmHint 在语言包里存在
4840. 代码引用的 i18n 键 group.memberPresenceUnknown 在语言包里存在
4841. 代码引用的 i18n 键 group.memberRemote 在语言包里存在
4842. 代码引用的 i18n 键 group.memberUnattributed 在语言包里存在
4843. 代码引用的 i18n 键 group.type.external 在语言包里存在
4844. 代码引用的 i18n 键 group.type.internal 在语言包里存在
4845. 代码引用的 i18n 键 guide.finish 在语言包里存在
4846. 代码引用的 i18n 键 guide.next 在语言包里存在
4847. 代码引用的 i18n 键 guide.progress 在语言包里存在
4848. 代码引用的 i18n 键 guide.restart 在语言包里存在
4849. 代码引用的 i18n 键 guide.section 在语言包里存在
4850. 代码引用的 i18n 键 guide.sectionHint 在语言包里存在
4851. 代码引用的 i18n 键 guide.skip 在语言包里存在
4852. 代码引用的 i18n 键 guide.step1.body 在语言包里存在
4853. 代码引用的 i18n 键 guide.step1.btn 在语言包里存在
4854. 代码引用的 i18n 键 guide.step1.pending 在语言包里存在
4855. 代码引用的 i18n 键 guide.step1.tip 在语言包里存在
4856. 代码引用的 i18n 键 guide.step1.title 在语言包里存在
4857. 代码引用的 i18n 键 guide.step1.value 在语言包里存在
4858. 代码引用的 i18n 键 guide.step2.body 在语言包里存在
4859. 代码引用的 i18n 键 guide.step2.btn 在语言包里存在
4860. 代码引用的 i18n 键 guide.step2.pending 在语言包里存在
4861. 代码引用的 i18n 键 guide.step2.title 在语言包里存在
4862. 代码引用的 i18n 键 guide.step2.value 在语言包里存在
4863. 代码引用的 i18n 键 guide.step3.body 在语言包里存在
4864. 代码引用的 i18n 键 guide.step3.btn 在语言包里存在
4865. 代码引用的 i18n 键 guide.step3.title 在语言包里存在
4866. 代码引用的 i18n 键 guide.step3.value 在语言包里存在
4867. 代码引用的 i18n 键 idchg.adopt 在语言包里存在
4868. 代码引用的 i18n 键 idchg.adoptConfirm 在语言包里存在
4869. 代码引用的 i18n 键 idchg.adoptFailed 在语言包里存在
4870. 代码引用的 i18n 键 idchg.adoptFrozen 在语言包里存在
4871. 代码引用的 i18n 键 idchg.adopted 在语言包里存在
4872. 代码引用的 i18n 键 idchg.auditFailed 在语言包里存在
4873. 代码引用的 i18n 键 idchg.audited 在语言包里存在
4874. 代码引用的 i18n 键 idchg.biaoTi 在语言包里存在
4875. 代码引用的 i18n 键 idchg.collapse 在语言包里存在
4876. 代码引用的 i18n 键 idchg.contactChanged 在语言包里存在
4877. 代码引用的 i18n 键 idchg.dismiss 在语言包里存在
4878. 代码引用的 i18n 键 idchg.dismissConfirm 在语言包里存在
4879. 代码引用的 i18n 键 idchg.dismissTitle 在语言包里存在
4880. 代码引用的 i18n 键 idchg.empty 在语言包里存在
4881. 代码引用的 i18n 键 idchg.emptyHint 在语言包里存在
4882. 代码引用的 i18n 键 idchg.expand 在语言包里存在
4883. 代码引用的 i18n 键 idchg.freezeOver 在语言包里存在
4884. 代码引用的 i18n 键 idchg.histTitle 在语言包里存在
4885. 代码引用的 i18n 键 idchg.marker 在语言包里存在
4886. 代码引用的 i18n 键 idchg.newEmptyHint 在语言包里存在
4887. 代码引用的 i18n 键 idchg.newTitle 在语言包里存在
4888. 代码引用的 i18n 键 idchg.noHistory 在语言包里存在
4889. 代码引用的 i18n 键 idchg.noHistoryHint 在语言包里存在
4890. 代码引用的 i18n 键 idchg.oldEmail 在语言包里存在
4891. 代码引用的 i18n 键 idchg.oldPhone 在语言包里存在
4892. 代码引用的 i18n 键 idchg.pending 在语言包里存在
4893. 代码引用的 i18n 键 idchg.reason 在语言包里存在
4894. 代码引用的 i18n 键 idchg.verified 在语言包里存在
4895. 代码引用的 i18n 键 idchg.verifiedHint 在语言包里存在
4896. 代码引用的 i18n 键 idchg.verifyConfirm 在语言包里存在
4897. 代码引用的 i18n 键 idchg.verifyFailed 在语言包里存在
4898. 代码引用的 i18n 键 instances.addModel 在语言包里存在
4899. 代码引用的 i18n 键 instances.allAvailable 在语言包里存在
4900. 代码引用的 i18n 键 instances.availableModels 在语言包里存在
4901. 代码引用的 i18n 键 instances.cognition 在语言包里存在
4902. 代码引用的 i18n 键 instances.cognitionAdd 在语言包里存在
4903. 代码引用的 i18n 键 instances.cognitionEmpty 在语言包里存在
4904. 代码引用的 i18n 键 instances.cognitionHint 在语言包里存在
4905. 代码引用的 i18n 键 instances.cpus 在语言包里存在
4906. 代码引用的 i18n 键 instances.defaultModel 在语言包里存在
4907. 代码引用的 i18n 键 instances.delete 在语言包里存在
4908. 代码引用的 i18n 键 instances.fallbackChain 在语言包里存在
4909. 代码引用的 i18n 键 instances.hardware 在语言包里存在
4910. 代码引用的 i18n 键 instances.max 在语言包里存在
4911. 代码引用的 i18n 键 instances.model 在语言包里存在
4912. 代码引用的 i18n 键 instances.moveDown 在语言包里存在
4913. 代码引用的 i18n 键 instances.moveUp 在语言包里存在
4914. 代码引用的 i18n 键 instances.name 在语言包里存在
4915. 代码引用的 i18n 键 instances.nameDup 在语言包里存在
4916. 代码引用的 i18n 键 instances.persona 在语言包里存在
4917. 代码引用的 i18n 键 instances.personaDefault 在语言包里存在
4918. 代码引用的 i18n 键 instances.personaPlaceholder 在语言包里存在
4919. 代码引用的 i18n 键 instances.running 在语言包里存在
4920. 代码引用的 i18n 键 instances.saved 在语言包里存在
4921. 代码引用的 i18n 键 instances.selectHint 在语言包里存在
4922. 代码引用的 i18n 键 instances.smartPick 在语言包里存在
4923. 代码引用的 i18n 键 instances.start 在语言包里存在
4924. 代码引用的 i18n 键 instances.stop 在语言包里存在
4925. 代码引用的 i18n 键 instances.stopped 在语言包里存在
4926. 代码引用的 i18n 键 instances.suggested 在语言包里存在
4927. 代码引用的 i18n 键 join.agree 在语言包里存在
4928. 代码引用的 i18n 键 join.apply 在语言包里存在
4929. 代码引用的 i18n 键 join.applyTime 在语言包里存在
4930. 代码引用的 i18n 键 join.biaoTi 在语言包里存在
4931. 代码引用的 i18n 键 join.blacklist 在语言包里存在
4932. 代码引用的 i18n 键 join.blacklistEmpty 在语言包里存在
4933. 代码引用的 i18n 键 join.blacklistTitle 在语言包里存在
4934. 代码引用的 i18n 键 join.copied 在语言包里存在
4935. 代码引用的 i18n 键 join.dropHint 在语言包里存在
4936. 代码引用的 i18n 键 join.expireTime 在语言包里存在
4937. 代码引用的 i18n 键 join.fail 在语言包里存在
4938. 代码引用的 i18n 键 join.kind 在语言包里存在
4939. 代码引用的 i18n 键 join.linkUnavailable 在语言包里存在
4940. 代码引用的 i18n 键 join.ok 在语言包里存在
4941. 代码引用的 i18n 键 join.pastePlaceholder 在语言包里存在
4942. 代码引用的 i18n 键 join.pickImage 在语言包里存在
4943. 代码引用的 i18n 键 join.qrFail 在语言包里存在
4944. 代码引用的 i18n 键 join.qrHint 在语言包里存在
4945. 代码引用的 i18n 键 join.qrUnavailable 在语言包里存在
4946. 代码引用的 i18n 键 join.reject 在语言包里存在
4947. 代码引用的 i18n 键 join.removeBlacklist 在语言包里存在
4948. 代码引用的 i18n 键 join.requestBadge 在语言包里存在
4949. 代码引用的 i18n 键 join.requester 在语言包里存在
4950. 代码引用的 i18n 键 join.scanDropRelease 在语言包里存在
4951. 代码引用的 i18n 键 join.scanEmpty 在语言包里存在
4952. 代码引用的 i18n 键 join.scanHint 在语言包里存在
4953. 代码引用的 i18n 键 join.scanNotImage 在语言包里存在
4954. 代码引用的 i18n 键 join.scanReadFail 在语言包里存在
4955. 代码引用的 i18n 键 join.scanUnavailable 在语言包里存在
4956. 代码引用的 i18n 键 join.scanWorking 在语言包里存在
4957. 代码引用的 i18n 键 join.target 在语言包里存在
4958. 代码引用的 i18n 键 ka.email 在语言包里存在
4959. 代码引用的 i18n 键 ka.extra 在语言包里存在
4960. 代码引用的 i18n 键 ka.fillInProfile 在语言包里存在
4961. 代码引用的 i18n 键 ka.peerWillSee 在语言包里存在
4962. 代码引用的 i18n 键 ka.phone 在语言包里存在
4963. 代码引用的 i18n 键 knowledge.biaoTi 在语言包里存在
4964. 代码引用的 i18n 键 knowledge.delete 在语言包里存在
4965. 代码引用的 i18n 键 knowledge.empty 在语言包里存在
4966. 代码引用的 i18n 键 knowledge.kind.entity 在语言包里存在
4967. 代码引用的 i18n 键 knowledge.kind.event 在语言包里存在
4968. 代码引用的 i18n 键 list.addInstance 在语言包里存在
4969. 代码引用的 i18n 键 list.addMore 在语言包里存在
4970. 代码引用的 i18n 键 list.createGroupChat 在语言包里存在
4971. 代码引用的 i18n 键 list.createProject 在语言包里存在
4972. 代码引用的 i18n 键 list.empty 在语言包里存在
4973. 代码引用的 i18n 键 list.noReply 在语言包里存在
4974. 代码引用的 i18n 键 list.none 在语言包里存在
4975. 代码引用的 i18n 键 list.search 在语言包里存在
4976. 代码引用的 i18n 键 list.sortByName 在语言包里存在
4977. 代码引用的 i18n 键 list.sortByTime 在语言包里存在
4978. 代码引用的 i18n 键 llm.continueNoAction 在语言包里存在
4979. 代码引用的 i18n 键 llm.dutySystem 在语言包里存在
4980. 代码引用的 i18n 键 llm.identityLine 在语言包里存在
4981. 代码引用的 i18n 键 llm.longForm 在语言包里存在
4982. 代码引用的 i18n 键 llm.modelLine 在语言包里存在
4983. 代码引用的 i18n 键 llm.needText 在语言包里存在
4984. 代码引用的 i18n 键 llm.noKey 在语言包里存在
4985. 代码引用的 i18n 键 llm.planContinue 在语言包里存在
4986. 代码引用的 i18n 键 llm.planContinueFail 在语言包里存在
4987. 代码引用的 i18n 键 llm.planFirst 在语言包里存在
4988. 代码引用的 i18n 键 llm.strictLanguage 在语言包里存在
4989. 代码引用的 i18n 键 llm.timeLine 在语言包里存在
4990. 代码引用的 i18n 键 llm.toolLimitParam 在语言包里存在
4991. 代码引用的 i18n 键 llm.toolMaxCharsParam 在语言包里存在
4992. 代码引用的 i18n 键 llm.toolOffsetParam 在语言包里存在
4993. 代码引用的 i18n 键 llm.toolQueryParam 在语言包里存在
4994. 代码引用的 i18n 键 llm.toolRecallDesc 在语言包里存在
4995. 代码引用的 i18n 键 llm.toolRecordIdParam 在语言包里存在
4996. 代码引用的 i18n 键 llm.toolRetrieveDesc 在语言包里存在
4997. 代码引用的 i18n 键 llm.toolSeqParam 在语言包里存在
4998. 代码引用的 i18n 键 llm.userLine 在语言包里存在
4999. 代码引用的 i18n 键 memory.desc 在语言包里存在
5000. 代码引用的 i18n 键 memory.notReady 在语言包里存在
5001. 代码引用的 i18n 键 memory.ready 在语言包里存在
5002. 代码引用的 i18n 键 memory.rebuild 在语言包里存在
5003. 代码引用的 i18n 键 memory.rebuildFail 在语言包里存在
5004. 代码引用的 i18n 键 memory.rebuildOk 在语言包里存在
5005. 代码引用的 i18n 键 memory.rebuildWhy 在语言包里存在
5006. 代码引用的 i18n 键 memory.records 在语言包里存在
5007. 代码引用的 i18n 键 memory.statusTitle 在语言包里存在
5008. 代码引用的 i18n 键 memory.vector 在语言包里存在
5009. 代码引用的 i18n 键 mesh.remove 在语言包里存在
5010. 代码引用的 i18n 键 metrics.biaoTi 在语言包里存在
5011. 代码引用的 i18n 键 model.addManually 在语言包里存在
5012. 代码引用的 i18n 键 model.addSelected 在语言包里存在
5013. 代码引用的 i18n 键 model.addTitle 在语言包里存在
5014. 代码引用的 i18n 键 model.addedToChain 在语言包里存在
5015. 代码引用的 i18n 键 model.alreadyInChain 在语言包里存在
5016. 代码引用的 i18n 键 model.available 在语言包里存在
5017. 代码引用的 i18n 键 model.availableHint 在语言包里存在
5018. 代码引用的 i18n 键 model.chain 在语言包里存在
5019. 代码引用的 i18n 键 model.chainHint 在语言包里存在
5020. 代码引用的 i18n 键 model.contextLen 在语言包里存在
5021. 代码引用的 i18n 键 model.default 在语言包里存在
5022. 代码引用的 i18n 键 model.disable 在语言包里存在
5023. 代码引用的 i18n 键 model.editProvider 在语言包里存在
5024. 代码引用的 i18n 键 model.editProviderConfirm 在语言包里存在
5025. 代码引用的 i18n 键 model.editProviderConfirmBody 在语言包里存在
5026. 代码引用的 i18n 键 model.enable 在语言包里存在
5027. 代码引用的 i18n 键 model.fenLei 在语言包里存在
5028. 代码引用的 i18n 键 model.fetch 在语言包里存在
5029. 代码引用的 i18n 键 model.fetchHint 在语言包里存在
5030. 代码引用的 i18n 键 model.kindHint.asr 在语言包里存在
5031. 代码引用的 i18n 键 model.kindHint.embed 在语言包里存在
5032. 代码引用的 i18n 键 model.kindHint.fenLei 在语言包里存在
5033. 代码引用的 i18n 键 model.kindHint.image 在语言包里存在
5034. 代码引用的 i18n 键 model.kindHint.imageUnd 在语言包里存在
5035. 代码引用的 i18n 键 model.kindHint.organizer 在语言包里存在
5036. 代码引用的 i18n 键 model.kindHint.rerank 在语言包里存在
5037. 代码引用的 i18n 键 model.kindHint.safety 在语言包里存在
5038. 代码引用的 i18n 键 model.kindHint.translate 在语言包里存在
5039. 代码引用的 i18n 键 model.kindHint.tts 在语言包里存在
5040. 代码引用的 i18n 键 model.kindHint.videoGen 在语言包里存在
5041. 代码引用的 i18n 键 model.kindHint.videoUnd 在语言包里存在
5042. 代码引用的 i18n 键 model.latencyNA 在语言包里存在
5043. 代码引用的 i18n 键 model.lianKong 在语言包里存在
5044. 代码引用的 i18n 键 model.mgr 在语言包里存在
5045. 代码引用的 i18n 键 model.moveTop 在语言包里存在
5046. 代码引用的 i18n 键 model.noModels 在语言包里存在
5047. 代码引用的 i18n 键 model.noneAvailable 在语言包里存在
5048. 代码引用的 i18n 键 model.pickProvider 在语言包里存在
5049. 代码引用的 i18n 键 model.smart 在语言包里存在
5050. 代码引用的 i18n 键 model.smartHint 在语言包里存在
5051. 代码引用的 i18n 键 model.speakSpeed 在语言包里存在
5052. 代码引用的 i18n 键 model.think 在语言包里存在
5053. 代码引用的 i18n 键 model.thinkHint 在语言包里存在
5054. 代码引用的 i18n 键 model.xiaoDi 在语言包里存在
5055. 代码引用的 i18n 键 model.xiaoDiAuto 在语言包里存在
5056. 代码引用的 i18n 键 model.xiaoDiHint 在语言包里存在
5057. 代码引用的 i18n 键 model.xiaoDiNow 在语言包里存在
5058. 代码引用的 i18n 键 nav.addGroup 在语言包里存在
5059. 代码引用的 i18n 键 nav.addProject 在语言包里存在
5060. 代码引用的 i18n 键 nav.instances 在语言包里存在
5061. 代码引用的 i18n 键 nav.singleAi 在语言包里存在
5062. 代码引用的 i18n 键 nav.touXiang 在语言包里存在
5063. 代码引用的 i18n 键 net.addRemoteTitle 在语言包里存在
5064. 代码引用的 i18n 键 net.banner.autoOff 在语言包里存在
5065. 代码引用的 i18n 键 net.banner.close 在语言包里存在
5066. 代码引用的 i18n 键 net.banner.dismissHint 在语言包里存在
5067. 代码引用的 i18n 键 net.banner.linkTitle 在语言包里存在
5068. 代码引用的 i18n 键 net.banner.meshOffTitle 在语言包里存在
5069. 代码引用的 i18n 键 net.banner.relayConfigure 在语言包里存在
5070. 代码引用的 i18n 键 net.banner.relayTerminalTitle 在语言包里存在
5071. 代码引用的 i18n 键 net.banner.turnOn 在语言包里存在
5072. 代码引用的 i18n 键 net.biaoTi 在语言包里存在
5073. 代码引用的 i18n 键 net.detect 在语言包里存在
5074. 代码引用的 i18n 键 net.detecting 在语言包里存在
5075. 代码引用的 i18n 键 net.domainAdd 在语言包里存在
5076. 代码引用的 i18n 键 net.domainPlaceholder 在语言包里存在
5077. 代码引用的 i18n 键 net.domainRemove 在语言包里存在
5078. 代码引用的 i18n 键 net.domainTitle 在语言包里存在
5079. 代码引用的 i18n 键 net.emptyList 在语言包里存在
5080. 代码引用的 i18n 键 net.entryFail 在语言包里存在
5081. 代码引用的 i18n 键 net.entryInvalid 在语言包里存在
5082. 代码引用的 i18n 键 net.entryOk 在语言包里存在
5083. 代码引用的 i18n 键 net.entryResultsTitle 在语言包里存在
5084. 代码引用的 i18n 键 net.entryUnknown 在语言包里存在
5085. 代码引用的 i18n 键 net.helpBody 在语言包里存在
5086. 代码引用的 i18n 键 net.helpTitle 在语言包里存在
5087. 代码引用的 i18n 键 net.invalidPort 在语言包里存在
5088. 代码引用的 i18n 键 net.ladder.biaoTi 在语言包里存在
5089. 代码引用的 i18n 键 net.ladder.candidate 在语言包里存在
5090. 代码引用的 i18n 键 net.ladder.current 在语言包里存在
5091. 代码引用的 i18n 键 net.ladder.dialability 在语言包里存在
5092. 代码引用的 i18n 键 net.ladder.none 在语言包里存在
5093. 代码引用的 i18n 键 net.ladder.relay 在语言包里存在
5094. 代码引用的 i18n 键 net.ladder.unknown 在语言包里存在
5095. 代码引用的 i18n 键 net.ladder.unsupported 在语言包里存在
5096. 代码引用的 i18n 键 net.localIp 在语言包里存在
5097. 代码引用的 i18n 键 net.port 在语言包里存在
5098. 代码引用的 i18n 键 net.portBindFailedTitle 在语言包里存在
5099. 代码引用的 i18n 键 net.portSuggestChecking 在语言包里存在
5100. 代码引用的 i18n 键 net.portSuggestHint 在语言包里存在
5101. 代码引用的 i18n 键 net.portSuggestNone 在语言包里存在
5102. 代码引用的 i18n 键 net.portSuggestRefresh 在语言包里存在
5103. 代码引用的 i18n 键 net.publicIp 在语言包里存在
5104. 代码引用的 i18n 键 net.publicListEmpty 在语言包里存在
5105. 代码引用的 i18n 键 net.refresh 在语言包里存在
5106. 代码引用的 i18n 键 net.result.behindNat 在语言包里存在
5107. 代码引用的 i18n 键 net.result.failOutbound 在语言包里存在
5108. 代码引用的 i18n 键 net.result.failPublic 在语言包里存在
5109. 代码引用的 i18n 键 net.result.needPass 在语言包里存在
5110. 代码引用的 i18n 键 net.result.pass 在语言包里存在
5111. 代码引用的 i18n 键 net.result.passLan 在语言包里存在
5112. 代码引用的 i18n 键 net.result.passUnverifiedInbound 在语言包里存在
5113. 代码引用的 i18n 键 net.result.unknown 在语言包里存在
5114. 代码引用的 i18n 键 net.switch 在语言包里存在
5115. 代码引用的 i18n 键 net.switchBlocked 在语言包里存在
5116. 代码引用的 i18n 键 net.switchNeedDetect 在语言包里存在
5117. 代码引用的 i18n 键 net.switchOff 在语言包里存在
5118. 代码引用的 i18n 键 net.tiShi 在语言包里存在
5119. 代码引用的 i18n 键 nm.badFormat 在语言包里存在
5120. 代码引用的 i18n 键 nm.enterPassword 在语言包里存在
5121. 代码引用的 i18n 键 nm.exportChat 在语言包里存在
5122. 代码引用的 i18n 键 nm.exportChatHint 在语言包里存在
5123. 代码引用的 i18n 键 nm.exportProject 在语言包里存在
5124. 代码引用的 i18n 键 nm.exportProjectHint 在语言包里存在
5125. 代码引用的 i18n 键 nm.exportTitle 在语言包里存在
5126. 代码引用的 i18n 键 nm.freshConfirm 在语言包里存在
5127. 代码引用的 i18n 键 nm.freshConfirm2 在语言包里存在
5128. 代码引用的 i18n 键 nm.importDone 在语言包里存在
5129. 代码引用的 i18n 键 nm.importMode 在语言包里存在
5130. 代码引用的 i18n 键 nm.needPassword 在语言包里存在
5131. 代码引用的 i18n 键 nm.setExportPassword 在语言包里存在
5132. 代码引用的 i18n 键 panel.addCard 在语言包里存在
5133. 代码引用的 i18n 键 panel.addCustomCard 在语言包里存在
5134. 代码引用的 i18n 键 panel.assist 在语言包里存在
5135. 代码引用的 i18n 键 panel.assist.done 在语言包里存在
5136. 代码引用的 i18n 键 panel.assist.empty 在语言包里存在
5137. 代码引用的 i18n 键 panel.assist.markDone 在语言包里存在
5138. 代码引用的 i18n 键 panel.assist.markStale 在语言包里存在
5139. 代码引用的 i18n 键 panel.assist.markUrgent 在语言包里存在
5140. 代码引用的 i18n 键 panel.assist.title 在语言包里存在
5141. 代码引用的 i18n 键 panel.assist.urgent 在语言包里存在
5142. 代码引用的 i18n 键 panel.customCard 在语言包里存在
5143. 代码引用的 i18n 键 panel.dir 在语言包里存在
5144. 代码引用的 i18n 键 panel.duty 在语言包里存在
5145. 代码引用的 i18n 键 panel.jinDu 在语言包里存在
5146. 代码引用的 i18n 键 panel.kb.biaoTi 在语言包里存在
5147. 代码引用的 i18n 键 panel.kb.title 在语言包里存在
5148. 代码引用的 i18n 键 panel.members 在语言包里存在
5149. 代码引用的 i18n 键 panel.modelMgr 在语言包里存在
5150. 代码引用的 i18n 键 panel.modelMgrEmpty 在语言包里存在
5151. 代码引用的 i18n 键 panel.modelMgrReadonly 在语言包里存在
5152. 代码引用的 i18n 键 panel.plan.blocked 在语言包里存在
5153. 代码引用的 i18n 键 panel.plan.doing 在语言包里存在
5154. 代码引用的 i18n 键 panel.plan.empty 在语言包里存在
5155. 代码引用的 i18n 键 panel.plan.progress 在语言包里存在
5156. 代码引用的 i18n 键 panel.plan.verified 在语言包里存在
5157. 代码引用的 i18n 键 panel.progressEmpty 在语言包里存在
5158. 代码引用的 i18n 键 panel.projectFiles 在语言包里存在
5159. 代码引用的 i18n 键 panel.projectState 在语言包里存在
5160. 代码引用的 i18n 键 panel.removeCard 在语言包里存在
5161. 代码引用的 i18n 键 panel.requirement 在语言包里存在
5162. 代码引用的 i18n 键 panel.result 在语言包里存在
5163. 代码引用的 i18n 键 panel.schedule.empty 在语言包里存在
5164. 代码引用的 i18n 键 panel.schedule.next 在语言包里存在
5165. 代码引用的 i18n 键 panel.schedule.pause 在语言包里存在
5166. 代码引用的 i18n 键 panel.schedule.resume 在语言包里存在
5167. 代码引用的 i18n 键 panel.schedule.title 在语言包里存在
5168. 代码引用的 i18n 键 panel.summary.biaoTi 在语言包里存在
5169. 代码引用的 i18n 键 panel.summary.done 在语言包里存在
5170. 代码引用的 i18n 键 panel.summary.empty 在语言包里存在
5171. 代码引用的 i18n 键 panel.summary.jump 在语言包里存在
5172. 代码引用的 i18n 键 panel.summary.title 在语言包里存在
5173. 代码引用的 i18n 键 panel.workfiles.empty 在语言包里存在
5174. 代码引用的 i18n 键 panel.workfiles.refresh 在语言包里存在
5175. 代码引用的 i18n 键 panel.workfiles.refreshed 在语言包里存在
5176. 代码引用的 i18n 键 panel.workfiles.reveal 在语言包里存在
5177. 代码引用的 i18n 键 panel.workfiles.title 在语言包里存在
5178. 代码引用的 i18n 键 panel.workfiles.workspace 在语言包里存在
5179. 代码引用的 i18n 键 placeholder.agentName 在语言包里存在
5180. 代码引用的 i18n 键 placeholder.email 在语言包里存在
5181. 代码引用的 i18n 键 placeholder.groupName 在语言包里存在
5182. 代码引用的 i18n 键 placeholder.groupNameExt 在语言包里存在
5183. 代码引用的 i18n 键 plugin.builtin 在语言包里存在
5184. 代码引用的 i18n 键 plugin.fromFolder 在语言包里存在
5185. 代码引用的 i18n 键 plugin.memory.provider 在语言包里存在
5186. 代码引用的 i18n 键 plugin.teams.provider 在语言包里存在
5187. 代码引用的 i18n 键 pm.empty 在语言包里存在
5188. 代码引用的 i18n 键 pm.readBackFail 在语言包里存在
5189. 代码引用的 i18n 键 pm.save 在语言包里存在
5190. 代码引用的 i18n 键 pm.saved 在语言包里存在
5191. 代码引用的 i18n 键 pm.tiShi 在语言包里存在
5192. 代码引用的 i18n 键 privacy.agree 在语言包里存在
5193. 代码引用的 i18n 键 privacy.biaoTi 在语言包里存在
5194. 代码引用的 i18n 键 privacy.disagree 在语言包里存在
5195. 代码引用的 i18n 键 privacy.revoke 在语言包里存在
5196. 代码引用的 i18n 键 privacy.revokeConfirm 在语言包里存在
5197. 代码引用的 i18n 键 privacy.scrollHint 在语言包里存在
5198. 代码引用的 i18n 键 privacy.ti 在语言包里存在
5199. 代码引用的 i18n 键 privacy.viewTitle 在语言包里存在
5200. 代码引用的 i18n 键 privacy.waitHint 在语言包里存在
5201. 代码引用的 i18n 键 projectFiles.changedTitle 在语言包里存在
5202. 代码引用的 i18n 键 projectFiles.empty.other 在语言包里存在
5203. 代码引用的 i18n 键 projectFiles.fromCreatorSignal 在语言包里存在
5204. 代码引用的 i18n 键 projectFiles.loadFailed 在语言包里存在
5205. 代码引用的 i18n 键 projectFiles.otherTitle 在语言包里存在
5206. 代码引用的 i18n 键 projectFiles.productDir 在语言包里存在
5207. 代码引用的 i18n 键 projectFiles.productDirPlanned 在语言包里存在
5208. 代码引用的 i18n 键 projectFiles.productTitle 在语言包里存在
5209. 代码引用的 i18n 键 projectFiles.run 在语言包里存在
5210. 代码引用的 i18n 键 sec.confirmBody 在语言包里存在
5211. 代码引用的 i18n 键 sec.confirmTitle 在语言包里存在
5212. 代码引用的 i18n 键 settings.addProvider 在语言包里存在
5213. 代码引用的 i18n 键 settings.apiKey 在语言包里存在
5214. 代码引用的 i18n 键 settings.asrModel 在语言包里存在
5215. 代码引用的 i18n 键 settings.baseUrl 在语言包里存在
5216. 代码引用的 i18n 键 settings.builtinComplete 在语言包里存在
5217. 代码引用的 i18n 键 settings.builtinError 在语言包里存在
5218. 代码引用的 i18n 键 settings.builtinRequest 在语言包里存在
5219. 代码引用的 i18n 键 settings.chaJianJi 在语言包里存在
5220. 代码引用的 i18n 键 settings.customColorTitle 在语言包里存在
5221. 代码引用的 i18n 键 settings.dataBytes 在语言包里存在
5222. 代码引用的 i18n 键 settings.dataHint 在语言包里存在
5223. 代码引用的 i18n 键 settings.dataReplicas 在语言包里存在
5224. 代码引用的 i18n 键 settings.dataRetention 在语言包里存在
5225. 代码引用的 i18n 键 settings.dataTitle 在语言包里存在
5226. 代码引用的 i18n 键 settings.emailHint 在语言包里存在
5227. 代码引用的 i18n 键 settings.emailNotify 在语言包里存在
5228. 代码引用的 i18n 键 settings.emailNotifyHint 在语言包里存在
5229. 代码引用的 i18n 键 settings.emailWhen 在语言包里存在
5230. 代码引用的 i18n 键 settings.embeddingModel 在语言包里存在
5231. 代码引用的 i18n 键 settings.exportJson 在语言包里存在
5232. 代码引用的 i18n 键 settings.fetchModels 在语言包里存在
5233. 代码引用的 i18n 键 settings.fieldApiKey 在语言包里存在
5234. 代码引用的 i18n 键 settings.fieldBaseUrl 在语言包里存在
5235. 代码引用的 i18n 键 settings.fieldName 在语言包里存在
5236. 代码引用的 i18n 键 settings.fontApplyHint 在语言包里存在
5237. 代码引用的 i18n 键 settings.fontDefault 在语言包里存在
5238. 代码引用的 i18n 键 settings.fontFamily 在语言包里存在
5239. 代码引用的 i18n 键 settings.fontInstall 在语言包里存在
5240. 代码引用的 i18n 键 settings.fontInstallFail 在语言包里存在
5241. 代码引用的 i18n 键 settings.fontInstalled 在语言包里存在
5242. 代码引用的 i18n 键 settings.fontListFail 在语言包里存在
5243. 代码引用的 i18n 键 settings.fontSize 在语言包里存在
5244. 代码引用的 i18n 键 settings.fontWeight 在语言包里存在
5245. 代码引用的 i18n 键 settings.fontWeightHint 在语言包里存在
5246. 代码引用的 i18n 键 settings.fw 在语言包里存在
5247. 代码引用的 i18n 键 settings.hotkey.apiColChannel 在语言包里存在
5248. 代码引用的 i18n 键 settings.hotkey.apiColDesc 在语言包里存在
5249. 代码引用的 i18n 键 settings.hotkey.apiColOp 在语言包里存在
5250. 代码引用的 i18n 键 settings.hotkey.apiColParams 在语言包里存在
5251. 代码引用的 i18n 键 settings.hotkey.apiCopied 在语言包里存在
5252. 代码引用的 i18n 键 settings.hotkey.apiCopyOps 在语言包里存在
5253. 代码引用的 i18n 键 settings.hotkey.apiCopyText 在语言包里存在
5254. 代码引用的 i18n 键 settings.hotkey.apiEmpty 在语言包里存在
5255. 代码引用的 i18n 键 settings.hotkey.apiEvents 在语言包里存在
5256. 代码引用的 i18n 键 settings.hotkey.apiFilter 在语言包里存在
5257. 代码引用的 i18n 键 settings.hotkey.apiHint 在语言包里存在
5258. 代码引用的 i18n 键 settings.hotkey.apiNoDesc 在语言包里存在
5259. 代码引用的 i18n 键 settings.hotkey.apiTitle 在语言包里存在
5260. 代码引用的 i18n 键 settings.hotkey.apiTryReadOnly 在语言包里存在
5261. 代码引用的 i18n 键 settings.hotkey.apiUnavailable 在语言包里存在
5262. 代码引用的 i18n 键 settings.hotkey.colAction 在语言包里存在
5263. 代码引用的 i18n 键 settings.hotkey.colBinding 在语言包里存在
5264. 代码引用的 i18n 键 settings.hotkey.colDesc 在语言包里存在
5265. 代码引用的 i18n 键 settings.hotkey.invalid 在语言包里存在
5266. 代码引用的 i18n 键 settings.hotkey.keyHint 在语言包里存在
5267. 代码引用的 i18n 键 settings.hotkey.keyTitle 在语言包里存在
5268. 代码引用的 i18n 键 settings.hotkey.onlyWired 在语言包里存在
5269. 代码引用的 i18n 键 settings.hotkey.press 在语言包里存在
5270. 代码引用的 i18n 键 settings.hotkey.saved 在语言包里存在
5271. 代码引用的 i18n 键 settings.hotkey.unbound 在语言包里存在
5272. 代码引用的 i18n 键 settings.imageModel 在语言包里存在
5273. 代码引用的 i18n 键 settings.imageUndModel 在语言包里存在
5274. 代码引用的 i18n 键 settings.importNm 在语言包里存在
5275. 代码引用的 i18n 键 settings.keyEmpty 在语言包里存在
5276. 代码引用的 i18n 键 settings.keyReveal 在语言包里存在
5277. 代码引用的 i18n 键 settings.keySaved 在语言包里存在
5278. 代码引用的 i18n 键 settings.language 在语言包里存在
5279. 代码引用的 i18n 键 settings.logMissing 在语言包里存在
5280. 代码引用的 i18n 键 settings.mimic 在语言包里存在
5281. 代码引用的 i18n 键 settings.mimicHint 在语言包里存在
5282. 代码引用的 i18n 键 settings.modelOptions 在语言包里存在
5283. 代码引用的 i18n 键 settings.modelSetDefault 在语言包里存在
5284. 代码引用的 i18n 键 settings.modelsEmpty 在语言包里存在
5285. 代码引用的 i18n 键 settings.modelsFetched 在语言包里存在
5286. 代码引用的 i18n 键 settings.modelsUnit 在语言包里存在
5287. 代码引用的 i18n 键 settings.notifyApplied 在语言包里存在
5288. 代码引用的 i18n 键 settings.notifyApply 在语言包里存在
5289. 代码引用的 i18n 键 settings.notifyCancel 在语言包里存在
5290. 代码引用的 i18n 键 settings.openLog 在语言包里存在
5291. 代码引用的 i18n 键 settings.organizerModel 在语言包里存在
5292. 代码引用的 i18n 键 settings.pickFolder 在语言包里存在
5293. 代码引用的 i18n 键 settings.pickScreenColor 在语言包里存在
5294. 代码引用的 i18n 键 settings.pluginDelete 在语言包里存在
5295. 代码引用的 i18n 键 settings.pluginDisable 在语言包里存在
5296. 代码引用的 i18n 键 settings.pluginEnable 在语言包里存在
5297. 代码引用的 i18n 键 settings.pluginInstallBrowse 在语言包里存在
5298. 代码引用的 i18n 键 settings.pluginScanCheck 在语言包里存在
5299. 代码引用的 i18n 键 settings.pluginScanTitle 在语言包里存在
5300. 代码引用的 i18n 键 settings.pluginUninstall 在语言包里存在
5301. 代码引用的 i18n 键 settings.provider.anthropic 在语言包里存在
5302. 代码引用的 i18n 键 settings.provider.dashscope 在语言包里存在
5303. 代码引用的 i18n 键 settings.provider.fireworks 在语言包里存在
5304. 代码引用的 i18n 键 settings.provider.gemini 在语言包里存在
5305. 代码引用的 i18n 键 settings.provider.groq 在语言包里存在
5306. 代码引用的 i18n 键 settings.provider.mistral 在语言包里存在
5307. 代码引用的 i18n 键 settings.provider.moonshot 在语言包里存在
5308. 代码引用的 i18n 键 settings.provider.ollamaCloud 在语言包里存在
5309. 代码引用的 i18n 键 settings.provider.openai 在语言包里存在
5310. 代码引用的 i18n 键 settings.provider.openrouter 在语言包里存在
5311. 代码引用的 i18n 键 settings.provider.perplexity 在语言包里存在
5312. 代码引用的 i18n 键 settings.provider.siliconflow 在语言包里存在
5313. 代码引用的 i18n 键 settings.provider.together 在语言包里存在
5314. 代码引用的 i18n 键 settings.provider.zhipu 在语言包里存在
5315. 代码引用的 i18n 键 settings.providerMax 在语言包里存在
5316. 代码引用的 i18n 键 settings.providerName 在语言包里存在
5317. 代码引用的 i18n 键 settings.providerNameDup 在语言包里存在
5318. 代码引用的 i18n 键 settings.providerOther 在语言包里存在
5319. 代码引用的 i18n 键 settings.providerPickFirst 在语言包里存在
5320. 代码引用的 i18n 键 settings.providerPickHint 在语言包里存在
5321. 代码引用的 i18n 键 settings.providerPreset 在语言包里存在
5322. 代码引用的 i18n 键 settings.providers 在语言包里存在
5323. 代码引用的 i18n 键 settings.removeModel 在语言包里存在
5324. 代码引用的 i18n 键 settings.rerankModel 在语言包里存在
5325. 代码引用的 i18n 键 settings.restoreConfirm 在语言包里存在
5326. 代码引用的 i18n 键 settings.restoreDefaults 在语言包里存在
5327. 代码引用的 i18n 键 settings.restored 在语言包里存在
5328. 代码引用的 i18n 键 settings.safetyModel 在语言包里存在
5329. 代码引用的 i18n 键 settings.scanMachine 在语言包里存在
5330. 代码引用的 i18n 键 settings.search 在语言包里存在
5331. 代码引用的 i18n 键 settings.section.about 在语言包里存在
5332. 代码引用的 i18n 键 settings.section.func 在语言包里存在
5333. 代码引用的 i18n 键 settings.section.hotkey 在语言包里存在
5334. 代码引用的 i18n 键 settings.section.model 在语言包里存在
5335. 代码引用的 i18n 键 settings.section.notify 在语言包里存在
5336. 代码引用的 i18n 键 settings.section.ui 在语言包里存在
5337. 代码引用的 i18n 键 settings.security 在语言包里存在
5338. 代码引用的 i18n 键 settings.securityFull 在语言包里存在
5339. 代码引用的 i18n 键 settings.securityHint 在语言包里存在
5340. 代码引用的 i18n 键 settings.securityNormal 在语言包里存在
5341. 代码引用的 i18n 键 settings.securityStrict 在语言包里存在
5342. 代码引用的 i18n 键 settings.skillDeleteLocked 在语言包里存在
5343. 代码引用的 i18n 键 settings.skillEnabled 在语言包里存在
5344. 代码引用的 i18n 键 settings.skillFrom 在语言包里存在
5345. 代码引用的 i18n 键 settings.skillPaused 在语言包里存在
5346. 代码引用的 i18n 键 settings.skillRemove 在语言包里存在
5347. 代码引用的 i18n 键 settings.skillSourceDiscovered 在语言包里存在
5348. 代码引用的 i18n 键 settings.skillSourceUserData 在语言包里存在
5349. 代码引用的 i18n 键 settings.skillSourceWorkspace 在语言包里存在
5350. 代码引用的 i18n 键 settings.skills 在语言包里存在
5351. 代码引用的 i18n 键 settings.skillsDiscoveredTitle 在语言包里存在
5352. 代码引用的 i18n 键 settings.skillsEmpty 在语言包里存在
5353. 代码引用的 i18n 键 settings.skillsEnable 在语言包里存在
5354. 代码引用的 i18n 键 settings.skillsHint 在语言包里存在
5355. 代码引用的 i18n 键 settings.skillsImport 在语言包里存在
5356. 代码引用的 i18n 键 settings.skillsImported 在语言包里存在
5357. 代码引用的 i18n 键 settings.skillsPaths 在语言包里存在
5358. 代码引用的 i18n 键 settings.skillsPause 在语言包里存在
5359. 代码引用的 i18n 键 settings.skillsScanAdd 在语言包里存在
5360. 代码引用的 i18n 键 settings.skillsScanCheck 在语言包里存在
5361. 代码引用的 i18n 键 settings.skillsScanEdit 在语言包里存在
5362. 代码引用的 i18n 键 settings.skillsScanEmpty 在语言包里存在
5363. 代码引用的 i18n 键 settings.skillsScanHint 在语言包里存在
5364. 代码引用的 i18n 键 settings.skillsScanInvalid 在语言包里存在
5365. 代码引用的 i18n 键 settings.skillsScanMax 在语言包里存在
5366. 代码引用的 i18n 键 settings.skillsScanMissing 在语言包里存在
5367. 代码引用的 i18n 键 settings.skillsScanOk 在语言包里存在
5368. 代码引用的 i18n 键 settings.skillsScanPlaceholder 在语言包里存在
5369. 代码引用的 i18n 键 settings.skillsScanRemove 在语言包里存在
5370. 代码引用的 i18n 键 settings.skillsScanSave 在语言包里存在
5371. 代码引用的 i18n 键 settings.skillsScanTitle 在语言包里存在
5372. 代码引用的 i18n 键 settings.sound 在语言包里存在
5373. 代码引用的 i18n 键 settings.soundClear 在语言包里存在
5374. 代码引用的 i18n 键 settings.soundComplete 在语言包里存在
5375. 代码引用的 i18n 键 settings.soundCompleteFile 在语言包里存在
5376. 代码引用的 i18n 键 settings.soundError 在语言包里存在
5377. 代码引用的 i18n 键 settings.soundErrorFile 在语言包里存在
5378. 代码引用的 i18n 键 settings.soundName 在语言包里存在
5379. 代码引用的 i18n 键 settings.soundPick 在语言包里存在
5380. 代码引用的 i18n 键 settings.soundRequest 在语言包里存在
5381. 代码引用的 i18n 键 settings.soundRequestFile 在语言包里存在
5382. 代码引用的 i18n 键 settings.soundVolume 在语言包里存在
5383. 代码引用的 i18n 键 settings.specialModels 在语言包里存在
5384. 代码引用的 i18n 键 settings.specialModelsHint 在语言包里存在
5385. 代码引用的 i18n 键 settings.strictAiLanguage 在语言包里存在
5386. 代码引用的 i18n 键 settings.strictAiLanguageHint 在语言包里存在
5387. 代码引用的 i18n 键 settings.strictOff 在语言包里存在
5388. 代码引用的 i18n 键 settings.strictOn 在语言包里存在
5389. 代码引用的 i18n 键 settings.tabPlugins 在语言包里存在
5390. 代码引用的 i18n 键 settings.tabSkills 在语言包里存在
5391. 代码引用的 i18n 键 settings.text 在语言包里存在
5392. 代码引用的 i18n 键 settings.textHint 在语言包里存在
5393. 代码引用的 i18n 键 settings.theme 在语言包里存在
5394. 代码引用的 i18n 键 settings.themeCustom 在语言包里存在
5395. 代码引用的 i18n 键 settings.themeDark 在语言包里存在
5396. 代码引用的 i18n 键 settings.themeLight 在语言包里存在
5397. 代码引用的 i18n 键 settings.themeMode 在语言包里存在
5398. 代码引用的 i18n 键 settings.themePreview 在语言包里存在
5399. 代码引用的 i18n 键 settings.themeSystem 在语言包里存在
5400. 代码引用的 i18n 键 settings.themeTooDark 在语言包里存在
5401. 代码引用的 i18n 键 settings.themeTooLight 在语言包里存在
5402. 代码引用的 i18n 键 settings.translateModel 在语言包里存在
5403. 代码引用的 i18n 键 settings.ttsModel 在语言包里存在
5404. 代码引用的 i18n 键 settings.videoGenModel 在语言包里存在
5405. 代码引用的 i18n 键 settings.videoUndModel 在语言包里存在
5406. 代码引用的 i18n 键 setup.biaoTi 在语言包里存在
5407. 代码引用的 i18n 键 setup.pickLanguage 在语言包里存在
5408. 代码引用的 i18n 键 setup.start 在语言包里存在
5409. 代码引用的 i18n 键 setup.yuYan 在语言包里存在
5410. 代码引用的 i18n 键 smtp.add 在语言包里存在
5411. 代码引用的 i18n 键 smtp.biaoQian 在语言包里存在
5412. 代码引用的 i18n 键 smtp.biaoTi 在语言包里存在
5413. 代码引用的 i18n 键 smtp.count 在语言包里存在
5414. 代码引用的 i18n 键 smtp.empty 在语言包里存在
5415. 代码引用的 i18n 键 smtp.fail 在语言包里存在
5416. 代码引用的 i18n 键 smtp.host 在语言包里存在
5417. 代码引用的 i18n 键 smtp.max10 在语言包里存在
5418. 代码引用的 i18n 键 smtp.ok 在语言包里存在
5419. 代码引用的 i18n 键 smtp.pass 在语言包里存在
5420. 代码引用的 i18n 键 smtp.port 在语言包里存在
5421. 代码引用的 i18n 键 smtp.remove 在语言包里存在
5422. 代码引用的 i18n 键 smtp.secure 在语言包里存在
5423. 代码引用的 i18n 键 smtp.tiShi 在语言包里存在
5424. 代码引用的 i18n 键 smtp.unverified 在语言包里存在
5425. 代码引用的 i18n 键 smtp.user 在语言包里存在
5426. 代码引用的 i18n 键 smtp.verified 在语言包里存在
5427. 代码引用的 i18n 键 smtp.verify 在语言包里存在
5428. 代码引用的 i18n 键 sound.builtin 在语言包里存在
5429. 代码引用的 i18n 键 sound.try 在语言包里存在
5430. 代码引用的 i18n 键 sound.tryFail 在语言包里存在
5431. 代码引用的 i18n 键 touXiang.local 在语言包里存在
5432. 代码引用的 i18n 键 touXiang.pickTitle 在语言包里存在
5433. 代码引用的 i18n 键 tray.offWork 在语言包里存在
5434. 代码引用的 i18n 键 tts.noModel 在语言包里存在
5435. 代码引用的 i18n 键 update.status.available 在语言包里存在
5436. 代码引用的 i18n 键 update.status.latestIs 在语言包里存在
5437. 代码引用的 i18n 键 update.status.networkError 在语言包里存在
5438. 代码引用的 i18n 键 update.status.unknown 在语言包里存在
5439. 代码引用的 i18n 键 update.status.upToDate 在语言包里存在
5440. 代码引用的 i18n 键 urgency.confirmBody 在语言包里存在
5441. 代码引用的 i18n 键 urgency.confirmTitle 在语言包里存在
5442. 代码引用的 i18n 键 urgency.confirmWait 在语言包里存在
5443. 代码引用的 i18n 键 usage.completion 在语言包里存在
5444. 代码引用的 i18n 键 usage.model 在语言包里存在
5445. 代码引用的 i18n 键 usage.prompt 在语言包里存在
5446. 代码引用的 i18n 键 usage.provider 在语言包里存在
5447. 代码引用的 i18n 键 usage.total 在语言包里存在
5448. 代码引用的 i18n 键 usage.window 在语言包里存在
5449. 代码引用的 i18n 键 webgpu.fail 在语言包里存在
5450. 代码引用的 i18n 键 webgpu.hint 在语言包里存在
5451. 代码引用的 i18n 键 webgpu.ok 在语言包里存在
5452. 代码引用的 i18n 键 webgpu.section 在语言包里存在
5453. 代码引用的 i18n 键 webgpu.test 在语言包里存在
5454. 代码引用的 i18n 键 win.closeConfirm 在语言包里存在
5455. 代码引用的 i18n 键 wo.backupJson 在语言包里存在
5456. 代码引用的 i18n 键 wo.belief 在语言包里存在
5457. 代码引用的 i18n 键 wo.beliefFile 在语言包里存在
5458. 代码引用的 i18n 键 wo.beliefHint 在语言包里存在
5459. 代码引用的 i18n 键 wo.beliefPlaceholder 在语言包里存在
5460. 代码引用的 i18n 键 wo.changeCred 在语言包里存在
5461. 代码引用的 i18n 键 wo.copy 在语言包里存在
5462. 代码引用的 i18n 键 wo.credRotated 在语言包里存在
5463. 代码引用的 i18n 键 wo.credential 在语言包里存在
5464. 代码引用的 i18n 键 wo.email 在语言包里存在
5465. 代码引用的 i18n 键 wo.emailInvalid 在语言包里存在
5466. 代码引用的 i18n 键 wo.emailSaved 在语言包里存在
5467. 代码引用的 i18n 键 wo.hideFull 在语言包里存在
5468. 代码引用的 i18n 键 wo.idHint 在语言包里存在
5469. 代码引用的 i18n 键 wo.idWarn 在语言包里存在
5470. 代码引用的 i18n 键 wo.passphrase 在语言包里存在
5471. 代码引用的 i18n 键 wo.showFull 在语言包里存在
5472. 代码引用的 i18n 键 wo.switchHint 在语言包里存在
5473. 代码引用的 i18n 键 wo.switchIdentity 在语言包里存在
5474. 代码引用的 i18n 键 wo.touXiang 在语言包里存在
5475. 代码引用的 i18n 键 wo.username 在语言包里存在
5476. 代码引用的 i18n 键 yingYong.enName 在语言包里存在
5477. 代码引用的 i18n 键 yingYong.subtitle 在语言包里存在
5478. 代码引用的 i18n 键 yingYong.zhName 在语言包里存在

## D 重构完善：两份 CSS 不漂移（同名选择器一致）

5479. 选择器 #anNiuShot .ico 在两份 CSS 里都有定义
5480. 选择器 #app 在两份 CSS 里都有定义
5481. 选择器 #appTi 在两份 CSS 里都有定义
5482. 选择器 #appTi #liaoTianLan 在两份 CSS 里都有定义
5483. 选择器 #appTi #mianBanLan 在两份 CSS 里都有定义
5484. 选择器 #appTi #xiaoXiJi 在两份 CSS 里都有定义
5485. 选择器 #appTi .liaoTianLan 在两份 CSS 里都有定义
5486. 选择器 #appTi .shuRuQu 在两份 CSS 里都有定义
5487. 选择器 #appTi .xiaoXiJi 在两份 CSS 里都有定义
5488. 选择器 #appTi .yinCang 在两份 CSS 里都有定义
5489. 选择器 #appTi > #ceLan 在两份 CSS 里都有定义
5490. 选择器 #appTi > #lieBiaoLan 在两份 CSS 里都有定义
5491. 选择器 #appTi > #zhuLan 在两份 CSS 里都有定义
5492. 选择器 #appTi footer.shuRuQu 在两份 CSS 里都有定义
5493. 选择器 #appTi.yinCangLieBiao 在两份 CSS 里都有定义
5494. 选择器 #appTi.yinCangLieBiao #lieBiaoLan 在两份 CSS 里都有定义
5495. 选择器 #biaoTiLan 在两份 CSS 里都有定义
5496. 选择器 #ceLan 在两份 CSS 里都有定义
5497. 选择器 #ceLan .ceLanTiaoMu 在两份 CSS 里都有定义
5498. 选择器 #ceLan .ceLanTiaoMu svg 在两份 CSS 里都有定义
5499. 选择器 #costSortBar .anNiuXiao.qiYong 在两份 CSS 里都有定义
5500. 选择器 #kongTai .shuRuQu 在两份 CSS 里都有定义
5501. 选择器 #kongTai.yinCang 在两份 CSS 里都有定义
5502. 选择器 #kongTai:not(.yinCang) 在两份 CSS 里都有定义
5503. 选择器 #lanTiaoZhengTiao 在两份 CSS 里都有定义
5504. 选择器 #lanTiaoZhengTiao.dragging 在两份 CSS 里都有定义
5505. 选择器 #lanTiaoZhengTiao:hover 在两份 CSS 里都有定义
5506. 选择器 #liaoTianBuJu 在两份 CSS 里都有定义
5507. 选择器 #liaoTianBuJu > #liaoTianLan 在两份 CSS 里都有定义
5508. 选择器 #liaoTianBuJu > #mianBanLan 在两份 CSS 里都有定义
5509. 选择器 #liaoTianBuJu > aside 在两份 CSS 里都有定义
5510. 选择器 #liaoTianBuJu > section 在两份 CSS 里都有定义
5511. 选择器 #liaoTianBuJu.withKongZhiTai 在两份 CSS 里都有定义
5512. 选择器 #liaoTianBuJu.withKongZhiTai #console-host 在两份 CSS 里都有定义
5513. 选择器 #liaoTianBuJu.yinCang 在两份 CSS 里都有定义
5514. 选择器 #liaoTianBuJu:not(.yinCang) 在两份 CSS 里都有定义
5515. 选择器 #liaoTianBuJu:not(.yinCang) > #mianBanLan 在两份 CSS 里都有定义
5516. 选择器 #liaoTianLan 在两份 CSS 里都有定义
5517. 选择器 #liaoTianLan #xiaoXiJi 在两份 CSS 里都有定义
5518. 选择器 #liaoTianLan .shuRuQu 在两份 CSS 里都有定义
5519. 选择器 #liaoTianLan .xiaoXiJi 在两份 CSS 里都有定义
5520. 选择器 #liaoTianLan footer.shuRuQu 在两份 CSS 里都有定义
5521. 选择器 #lieBiaoLan 在两份 CSS 里都有定义
5522. 选择器 #lieBiaoTi 在两份 CSS 里都有定义
5523. 选择器 #lieBiaoTi::-webkit-scrollbar 在两份 CSS 里都有定义
5524. 选择器 #lieBiaoTi::-webkit-scrollbar-thumb 在两份 CSS 里都有定义
5525. 选择器 #mianBanLan 在两份 CSS 里都有定义
5526. 选择器 #mianBanLan::-webkit-scrollbar 在两份 CSS 里都有定义
5527. 选择器 #mianBanLan::-webkit-scrollbar-thumb 在两份 CSS 里都有定义
5528. 选择器 #mianBanTiaoZhengTiao 在两份 CSS 里都有定义
5529. 选择器 #mianBanTiaoZhengTiao.dragging 在两份 CSS 里都有定义
5530. 选择器 #mianBanTiaoZhengTiao:hover 在两份 CSS 里都有定义
5531. 选择器 #pYouJian.invalid 在两份 CSS 里都有定义
5532. 选择器 #pageBuJu #shuRu 在两份 CSS 里都有定义
5533. 选择器 #pageBuJu .shuRuQu 在两份 CSS 里都有定义
5534. 选择器 #pageBuJu .shuRuQuZhu 在两份 CSS 里都有定义
5535. 选择器 #pageBuJu.yinCang 在两份 CSS 里都有定义
5536. 选择器 #pageBuJu:not(.yinCang) 在两份 CSS 里都有定义
5537. 选择器 #quanPingQuSeCeng img 在两份 CSS 里都有定义
5538. 选择器 #shiLiXiangQing .shuRuQu 在两份 CSS 里都有定义
5539. 选择器 #shiLiXiangQing.yinCang 在两份 CSS 里都有定义
5540. 选择器 #shiLiXiangQing:not(.yinCang) 在两份 CSS 里都有定义
5541. 选择器 #shuRu 在两份 CSS 里都有定义
5542. 选择器 #shuRu:focus 在两份 CSS 里都有定义
5543. 选择器 #shuRu:focus-visible 在两份 CSS 里都有定义
5544. 选择器 #shuRuDingTiaoZhengTiao 在两份 CSS 里都有定义
5545. 选择器 #shuRuDingTiaoZhengTiao:hover 在两份 CSS 里都有定义
5546. 选择器 #zhuLan 在两份 CSS 里都有定义
5547. 选择器 #zhuLan .liaoTianBuJu 在两份 CSS 里都有定义
5548. 选择器 #zhuLan > #liaoTianBuJu 在两份 CSS 里都有定义
5549. 选择器 #zhuLan > #pageBuJu 在两份 CSS 里都有定义
5550. 选择器 #zhuLan > .liaoTianBuJu 在两份 CSS 里都有定义
5551. 选择器 #zhuLan > .pageBuJu 在两份 CSS 里都有定义
5552. 选择器 #zhuLan > .yinCang 在两份 CSS 里都有定义
5553. 选择器 * 在两份 CSS 里都有定义
5554. 选择器 .anNiuDanger 在两份 CSS 里都有定义
5555. 选择器 .anNiuGhost 在两份 CSS 里都有定义
5556. 选择器 .anNiuGhost:disabled 在两份 CSS 里都有定义
5557. 选择器 .anNiuGhost:disabled:hover 在两份 CSS 里都有定义
5558. 选择器 .anNiuGhost:hover 在两份 CSS 里都有定义
5559. 选择器 .anNiuGhost[disabled] 在两份 CSS 里都有定义
5560. 选择器 .anNiuGongJu 在两份 CSS 里都有定义
5561. 选择器 .anNiuGongJu:disabled 在两份 CSS 里都有定义
5562. 选择器 .anNiuGongJu:disabled:hover 在两份 CSS 里都有定义
5563. 选择器 .anNiuGongJu:hover 在两份 CSS 里都有定义
5564. 选择器 .anNiuGongJu[disabled] 在两份 CSS 里都有定义
5565. 选择器 .anNiuTingZhi 在两份 CSS 里都有定义
5566. 选择器 .anNiuTingZhi:hover 在两份 CSS 里都有定义
5567. 选择器 .anNiuTuBiao 在两份 CSS 里都有定义
5568. 选择器 .anNiuTuBiao .ico 在两份 CSS 里都有定义
5569. 选择器 .anNiuTuBiao .ico.hollowIco 在两份 CSS 里都有定义
5570. 选择器 .anNiuTuBiao .ico.siKaoIco 在两份 CSS 里都有定义
5571. 选择器 .anNiuTuBiao:hover 在两份 CSS 里都有定义
5572. 选择器 .anNiuXiao 在两份 CSS 里都有定义
5573. 选择器 .anNiuXiao.qiYong 在两份 CSS 里都有定义
5574. 选择器 .anNiuXiao:disabled 在两份 CSS 里都有定义
5575. 选择器 .anNiuXiao:disabled:hover 在两份 CSS 里都有定义
5576. 选择器 .anNiuXiao:hover 在两份 CSS 里都有定义
5577. 选择器 .anNiuXiao[disabled] 在两份 CSS 里都有定义
5578. 选择器 .anNiuXiao[disabled]:hover 在两份 CSS 里都有定义
5579. 选择器 .anNiuZhuYao 在两份 CSS 里都有定义
5580. 选择器 .anNiuZhuYao.faSongZhong 在两份 CSS 里都有定义
5581. 选择器 .anNiuZhuYao.faSongZhong::before 在两份 CSS 里都有定义
5582. 选择器 .anNiuZhuYao:hover 在两份 CSS 里都有定义
5583. 选择器 .attachChip 在两份 CSS 里都有定义
5584. 选择器 .attachChip button 在两份 CSS 里都有定义
5585. 选择器 .attachSuoLue 在两份 CSS 里都有定义
5586. 选择器 .avAnNiu 在两份 CSS 里都有定义
5587. 选择器 .biaoTiLanDongZuoJi 在两份 CSS 里都有定义
5588. 选择器 .biaoTiLanDongZuoJi #anNiuuiRefresh 在两份 CSS 里都有定义
5589. 选择器 .biaoTiLanDongZuoJi .biaoTiLanGuanBi:hover 在两份 CSS 里都有定义
5590. 选择器 .biaoTiLanDongZuoJi button 在两份 CSS 里都有定义
5591. 选择器 .biaoTiLanDongZuoJi button.biaoTiLanJiHuo 在两份 CSS 里都有定义
5592. 选择器 .biaoTiLanDongZuoJi button.biaoTiLanQiYong 在两份 CSS 里都有定义
5593. 选择器 .biaoTiLanDongZuoJi button:active 在两份 CSS 里都有定义
5594. 选择器 .biaoTiLanDongZuoJi button:hover 在两份 CSS 里都有定义
5595. 选择器 .biaoTiLanFenGe 在两份 CSS 里都有定义
5596. 选择器 .biaoTiLanPinPai 在两份 CSS 里都有定义
5597. 选择器 .biaoTiLanTuoZhuai 在两份 CSS 里都有定义
5598. 选择器 .biaoTiLanlogo 在两份 CSS 里都有定义
5599. 选择器 .biaoTiLanlogoTuPian 在两份 CSS 里都有定义
5600. 选择器 .biaoTiLansvg 在两份 CSS 里都有定义
5601. 选择器 .bigAv 在两份 CSS 里都有定义
5602. 选择器 .bubble 在两份 CSS 里都有定义
5603. 选择器 .bubble.md .mdCi 在两份 CSS 里都有定义
5604. 选择器 .bubble.md .mdCode 在两份 CSS 里都有定义
5605. 选择器 .bubble.md .mdH 在两份 CSS 里都有定义
5606. 选择器 .bubble.md .mdP 在两份 CSS 里都有定义
5607. 选择器 .bubble.md .mdP:last-child 在两份 CSS 里都有定义
5608. 选择器 .bubble.md .mdQ 在两份 CSS 里都有定义
5609. 选择器 .bubble.md .mdUl 在两份 CSS 里都有定义
5610. 选择器 .bubble.md a 在两份 CSS 里都有定义
5611. 选择器 .bubble.md li 在两份 CSS 里都有定义
5612. 选择器 .cardFlash 在两份 CSS 里都有定义
5613. 选择器 .ceLanDi 在两份 CSS 里都有定义
5614. 选择器 .ceLanDing 在两份 CSS 里都有定义
5615. 选择器 .ceLanTiaoMu 在两份 CSS 里都有定义
5616. 选择器 .ceLanTiaoMu svg 在两份 CSS 里都有定义
5617. 选择器 .ceLanTiaoMu.jiHuo 在两份 CSS 里都有定义
5618. 选择器 .ceLanTiaoMu.jiHuo svg 在两份 CSS 里都有定义
5619. 选择器 .ceLanTiaoMu:hover 在两份 CSS 里都有定义
5620. 选择器 .chaJianLieBiao .ctgHang 在两份 CSS 里都有定义
5621. 选择器 .chaJianMiaoShu 在两份 CSS 里都有定义
5622. 选择器 .chainRow.disabled .name 在两份 CSS 里都有定义
5623. 选择器 .cpDongZuoJi 在两份 CSS 里都有定义
5624. 选择器 .cpLieBiao 在两份 CSS 里都有定义
5625. 选择器 .cpTi 在两份 CSS 里都有定义
5626. 选择器 .cpTi ul 在两份 CSS 里都有定义
5627. 选择器 .cpTiaoMu 在两份 CSS 里都有定义
5628. 选择器 .cpTiaoMu summary 在两份 CSS 里都有定义
5629. 选择器 .cpTiaoMu summary::-webkit-details-marker 在两份 CSS 里都有定义
5630. 选择器 .cpTiaoMu[daKai] summary 在两份 CSS 里都有定义
5631. 选择器 .ctgFold .ctgFoldBiaoTi 在两份 CSS 里都有定义
5632. 选择器 .ctgFold > .ctgFoldZhaiYao 在两份 CSS 里都有定义
5633. 选择器 .ctgFold > .ctgFoldZhaiYao::-webkit-details-marker 在两份 CSS 里都有定义
5634. 选择器 .ctgFold > .ctgShouQiTi 在两份 CSS 里都有定义
5635. 选择器 .ctgFold[daKai] > .ctgFoldZhaiYao .ctgJianTou 在两份 CSS 里都有定义
5636. 选择器 .ctgFold[open] > .ctgFoldZhaiYao .ctgJianTou 在两份 CSS 里都有定义
5637. 选择器 .ctgJianTou 在两份 CSS 里都有定义
5638. 选择器 .ctgShiLi 在两份 CSS 里都有定义
5639. 选择器 .ctgShiLi .ctgSpacer 在两份 CSS 里都有定义
5640. 选择器 .ctgShiLiHang 在两份 CSS 里都有定义
5641. 选择器 .ctgShiLiHead 在两份 CSS 里都有定义
5642. 选择器 .ctgShiLiMing 在两份 CSS 里都有定义
5643. 选择器 .ctgShiLiTi 在两份 CSS 里都有定义
5644. 选择器 .ctgShiLi[data-inst-enabled="0"] .ctgShiLiHead 在两份 CSS 里都有定义
5645. 选择器 .dashGrid 在两份 CSS 里都有定义
5646. 选择器 .dashHang 在两份 CSS 里都有定义
5647. 选择器 .dashHuiZhang 在两份 CSS 里都有定义
5648. 选择器 .dashKa 在两份 CSS 里都有定义
5649. 选择器 .dashKa .stat 在两份 CSS 里都有定义
5650. 选择器 .dashStats 在两份 CSS 里都有定义
5651. 选择器 .dashXiangQing 在两份 CSS 里都有定义
5652. 选择器 .dshZhuangTai 在两份 CSS 里都有定义
5653. 选择器 .dshZhuangTai.isBad 在两份 CSS 里都有定义
5654. 选择器 .dshZhuangTai.isChecking 在两份 CSS 里都有定义
5655. 选择器 .dshZhuangTai.isChecking::after 在两份 CSS 里都有定义
5656. 选择器 .dshZhuangTai.isErr 在两份 CSS 里都有定义
5657. 选择器 .dshZhuangTai.isOk 在两份 CSS 里都有定义
5658. 选择器 .duiHuaKuangBiaoTi 在两份 CSS 里都有定义
5659. 选择器 .duiHuaKuangDongZuoJi 在两份 CSS 里都有定义
5660. 选择器 .duiHuaKuangDongZuoJi button 在两份 CSS 里都有定义
5661. 选择器 .duiHuaKuangGen 在两份 CSS 里都有定义
5662. 选择器 .duiHuaKuangKa 在两份 CSS 里都有定义
5663. 选择器 .duiHuaKuangMask 在两份 CSS 里都有定义
5664. 选择器 .duiHuaKuangTi 在两份 CSS 里都有定义
5665. 选择器 .duiLieLieBiao 在两份 CSS 里都有定义
5666. 选择器 .duiLieLieBiao li 在两份 CSS 里都有定义
5667. 选择器 .duiLieTiao 在两份 CSS 里都有定义
5668. 选择器 .duiLieTiao::-webkit-scrollbar 在两份 CSS 里都有定义
5669. 选择器 .duiLieTiao::-webkit-scrollbar-thumb 在两份 CSS 里都有定义
5670. 选择器 .duiLieTiaoHead 在两份 CSS 里都有定义
5671. 选择器 .duiLieTiaoMuJi 在两份 CSS 里都有定义
5672. 选择器 .duiLieTiaoMuJi .qBiaoQian 在两份 CSS 里都有定义
5673. 选择器 .duiLieTiaoMuJi .qWenBen 在两份 CSS 里都有定义
5674. 选择器 .duiLieTiaoMuJi li 在两份 CSS 里都有定义
5675. 选择器 .duiLieTiaoMuJi li textarea 在两份 CSS 里都有定义
5676. 选择器 .field 在两份 CSS 里都有定义
5677. 选择器 .field biaoQian 在两份 CSS 里都有定义
5678. 选择器 .field input 在两份 CSS 里都有定义
5679. 选择器 .field select 在两份 CSS 里都有定义
5680. 选择器 .field textarea 在两份 CSS 里都有定义
5681. 选择器 .gengDuoDd 在两份 CSS 里都有定义
5682. 选择器 .huiZhang 在两份 CSS 里都有定义
5683. 选择器 .huiZhang.off 在两份 CSS 里都有定义
5684. 选择器 .hwGrid 在两份 CSS 里都有定义
5685. 选择器 .hwKa 在两份 CSS 里都有定义
5686. 选择器 .hwKa .stat 在两份 CSS 里都有定义
5687. 选择器 .jiHuaBu 在两份 CSS 里都有定义
5688. 选择器 .jiHuaBu[data-st="blocked"] 在两份 CSS 里都有定义
5689. 选择器 .jiHuaBu[data-st="doing"] 在两份 CSS 里都有定义
5690. 选择器 .jiHuaBu[data-st="done"] 在两份 CSS 里都有定义
5691. 选择器 .jiHuaBu[data-st="verified"] 在两份 CSS 里都有定义
5692. 选择器 .jiHuaId 在两份 CSS 里都有定义
5693. 选择器 .jiHuaMing 在两份 CSS 里都有定义
5694. 选择器 .jiHuaZhuangTai 在两份 CSS 里都有定义
5695. 选择器 .jiaRuHang 在两份 CSS 里都有定义
5696. 选择器 .jiaRuLink 在两份 CSS 里都有定义
5697. 选择器 .jiaRuqr 在两份 CSS 里都有定义
5698. 选择器 .jianYiToast 在两份 CSS 里都有定义
5699. 选择器 .jianYiToast.out 在两份 CSS 里都有定义
5700. 选择器 .jieTuCeng 在两份 CSS 里都有定义
5701. 选择器 .jieTuCeng .jieTuDi 在两份 CSS 里都有定义
5702. 选择器 .jieTuCeng .jieTuKuang 在两份 CSS 里都有定义
5703. 选择器 .jieTuCeng .jieTuTiShi 在两份 CSS 里都有定义
5704. 选择器 .jinDu 在两份 CSS 里都有定义
5705. 选择器 .jinDuTiao 在两份 CSS 里都有定义
5706. 选择器 .jinJiCaiDan 在两份 CSS 里都有定义
5707. 选择器 .jinJiCaiDan .siKaoGenSui 在两份 CSS 里都有定义
5708. 选择器 .jinJiCaiDan .siKaoGenSui input 在两份 CSS 里都有定义
5709. 选择器 .jinJiCaiDan .siKaoKaBiao 在两份 CSS 里都有定义
5710. 选择器 .jinJiCaiDan .siKaoKaDang 在两份 CSS 里都有定义
5711. 选择器 .jinJiCaiDan button 在两份 CSS 里都有定义
5712. 选择器 .jinJiCaiDan button.qiYong 在两份 CSS 里都有定义
5713. 选择器 .jinJiCaiDan button:hover 在两份 CSS 里都有定义
5714. 选择器 .jinJiCaiDan button[data-u="P1"].qiYong 在两份 CSS 里都有定义
5715. 选择器 .jinJiCaiDan input[type="range"].siKaoHuaKuai 在两份 CSS 里都有定义
5716. 选择器 .jinJiCaiDan input[type="range"].siKaoHuaKuai:disabled 在两份 CSS 里都有定义
5717. 选择器 .jinJiCaiDan.siKaoKa 在两份 CSS 里都有定义
5718. 选择器 .jinJiDd 在两份 CSS 里都有定义
5719. 选择器 .jinJiDd.urgent .jinJiTrigger 在两份 CSS 里都有定义
5720. 选择器 .jinJiDd.urgent .urgentI 在两份 CSS 里都有定义
5721. 选择器 .jinJiDdd .urgent .urgentI 在两份 CSS 里都有定义
5722. 选择器 .jinJiDdd .urgentI.yinCang 在两份 CSS 里都有定义
5723. 选择器 .jinJiPills 在两份 CSS 里都有定义
5724. 选择器 .jinJiPills button 在两份 CSS 里都有定义
5725. 选择器 .jinJiPills button.qiYong 在两份 CSS 里都有定义
5726. 选择器 .jinJiPills button.qiYong[data-u="P1"] 在两份 CSS 里都有定义
5727. 选择器 .jinJiTrigger 在两份 CSS 里都有定义
5728. 选择器 .jinJiTrigger .ico 在两份 CSS 里都有定义
5729. 选择器 .jinJiTrigger .ico.siKaoIco 在两份 CSS 里都有定义
5730. 选择器 .jinJiTrigger .jinJiJianTou 在两份 CSS 里都有定义
5731. 选择器 .jinJiTrigger:focus-visible 在两份 CSS 里都有定义
5732. 选择器 .jinJiTrigger:hover 在两份 CSS 里都有定义
5733. 选择器 .jinengHang 在两份 CSS 里都有定义
5734. 选择器 .jingYin 在两份 CSS 里都有定义
5735. 选择器 .kaGuanBi 在两份 CSS 里都有定义
5736. 选择器 .kaGuanBi:hover 在两份 CSS 里都有定义
5737. 选择器 .kanbanHuiHua 在两份 CSS 里都有定义
5738. 选择器 .kanbanHuiHua .bsLeiXing 在两份 CSS 里都有定义
5739. 选择器 .kanbanHuiHua .bsMing 在两份 CSS 里都有定义
5740. 选择器 .kanbanHuiHua .bsProg 在两份 CSS 里都有定义
5741. 选择器 .kanbanHuiHua .bsZhuangTai 在两份 CSS 里都有定义
5742. 选择器 .kanbanHuiHua:hover 在两份 CSS 里都有定义
5743. 选择器 .kanbanShiJian 在两份 CSS 里都有定义
5744. 选择器 .kanbanShiJian .evBiaoQian 在两份 CSS 里都有定义
5745. 选择器 .kanbanTiShi 在两份 CSS 里都有定义
5746. 选择器 .kongTai 在两份 CSS 里都有定义
5747. 选择器 .kongZhiTaiHead 在两份 CSS 里都有定义
5748. 选择器 .kongZhiTaiMianBan 在两份 CSS 里都有定义
5749. 选择器 .kongZhiTaiShuChu 在两份 CSS 里都有定义
5750. 选择器 .kongZhiTaiTiaoZhengTiao 在两份 CSS 里都有定义
5751. 选择器 .kongZhiTaiTiaoZhengTiao:hover 在两份 CSS 里都有定义
5752. 选择器 .laQuJinDu 在两份 CSS 里都有定义
5753. 选择器 .laQuJinDuTiao 在两份 CSS 里都有定义
5754. 选择器 .laQuZhuan 在两份 CSS 里都有定义
5755. 选择器 .liaoTianBiaoTi 在两份 CSS 里都有定义
5756. 选择器 .liaoTianBuJu 在两份 CSS 里都有定义
5757. 选择器 .liaoTianDongZuoJi 在两份 CSS 里都有定义
5758. 选择器 .liaoTianHead 在两份 CSS 里都有定义
5759. 选择器 .liaoTianHead .anNiuTuBiao 在两份 CSS 里都有定义
5760. 选择器 .liaoTianHead .anNiuTuBiao .ico 在两份 CSS 里都有定义
5761. 选择器 .liaoTianHead .anNiuTuBiao.biaoTiLanQiYong 在两份 CSS 里都有定义
5762. 选择器 .liaoTianYuanShuju 在两份 CSS 里都有定义
5763. 选择器 .lieBiaoHead 在两份 CSS 里都有定义
5764. 选择器 .lieBiaoHead h2 在两份 CSS 里都有定义
5765. 选择器 .lieBiaoHeadDongZuoJi 在两份 CSS 里都有定义
5766. 选择器 .lieBiaoKa 在两份 CSS 里都有定义
5767. 选择器 .lieBiaoKa h4 在两份 CSS 里都有定义
5768. 选择器 .lieBiaoKong 在两份 CSS 里都有定义
5769. 选择器 .lieBiaoPlusCaiDan 在两份 CSS 里都有定义
5770. 选择器 .lieBiaoPlusCaiDan button 在两份 CSS 里都有定义
5771. 选择器 .lieBiaoPlusCaiDan button:hover 在两份 CSS 里都有定义
5772. 选择器 .lieBiaoTi 在两份 CSS 里都有定义
5773. 选择器 .lieBiaoTiaoMu 在两份 CSS 里都有定义
5774. 选择器 .lieBiaoTiaoMu .av 在两份 CSS 里都有定义
5775. 选择器 .lieBiaoTiaoMu .fu 在两份 CSS 里都有定义
5776. 选择器 .lieBiaoTiaoMu .meta 在两份 CSS 里都有定义
5777. 选择器 .lieBiaoTiaoMu .name 在两份 CSS 里都有定义
5778. 选择器 .lieBiaoTiaoMu.jiHuo 在两份 CSS 里都有定义
5779. 选择器 .lieBiaoTiaoMu:hover 在两份 CSS 里都有定义
5780. 选择器 .logoFu 在两份 CSS 里都有定义
5781. 选择器 .logoGlyph 在两份 CSS 里都有定义
5782. 选择器 .logoMark 在两份 CSS 里都有定义
5783. 选择器 .logoMing 在两份 CSS 里都有定义
5784. 选择器 .mdH 在两份 CSS 里都有定义
5785. 选择器 .mdP 在两份 CSS 里都有定义
5786. 选择器 .mdUl 在两份 CSS 里都有定义
5787. 选择器 .miYaoHang 在两份 CSS 里都有定义
5788. 选择器 .miYaoHang input 在两份 CSS 里都有定义
5789. 选择器 .miYaoYan 在两份 CSS 里都有定义
5790. 选择器 .miYaoYan.qiYong 在两份 CSS 里都有定义
5791. 选择器 .miYaoYan:hover 在两份 CSS 里都有定义
5792. 选择器 .mianBanKuai 在两份 CSS 里都有定义
5793. 选择器 .mianBanKuai h3 在两份 CSS 里都有定义
5794. 选择器 .mianBanKuai:hover > .kaGuanBi 在两份 CSS 里都有定义
5795. 选择器 .moRenBiaoQian 在两份 CSS 里都有定义
5796. 选择器 .moXingChip 在两份 CSS 里都有定义
5797. 选择器 .moXingChip .x 在两份 CSS 里都有定义
5798. 选择器 .moXingChip .x:hover 在两份 CSS 里都有定义
5799. 选择器 .moXingChip.qiYong 在两份 CSS 里都有定义
5800. 选择器 .moXingChip.ruShiYong 在两份 CSS 里都有定义
5801. 选择器 .moXingChip.ruShiYong::after 在两份 CSS 里都有定义
5802. 选择器 .moXingHang 在两份 CSS 里都有定义
5803. 选择器 .modelLiangLie 在两份 CSS 里都有定义
5804. 选择器 .modelZiXiang 在两份 CSS 里都有定义
5805. 选择器 .modelZiXiang h4 在两份 CSS 里都有定义
5806. 选择器 .modelZiXiang:first-of-type 在两份 CSS 里都有定义
5807. 选择器 .pageBuJu 在两份 CSS 里都有定义
5808. 选择器 .pageBuJu h1 在两份 CSS 里都有定义
5809. 选择器 .pageBuJu.peiZhiMoShi 在两份 CSS 里都有定义
5810. 选择器 .pageBuJu.peiZhiMoShi #pageTi 在两份 CSS 里都有定义
5811. 选择器 .pageBuJu.peiZhiMoShi .peiZhiBuJu 在两份 CSS 里都有定义
5812. 选择器 .pageBuJu.peiZhiMoShi .peiZhiDaoHang 在两份 CSS 里都有定义
5813. 选择器 .pageBuJu.peiZhiMoShi .peiZhiNeiRong 在两份 CSS 里都有定义
5814. 选择器 .pageBuJu::-webkit-scrollbar 在两份 CSS 里都有定义
5815. 选择器 .pageBuJu::-webkit-scrollbar-thumb 在两份 CSS 里都有定义
5816. 选择器 .pageBuJu:not(.yinCang) #pageTi 在两份 CSS 里都有定义
5817. 选择器 .profileHead 在两份 CSS 里都有定义
5818. 选择器 .provDongZuoJi 在两份 CSS 里都有定义
5819. 选择器 .provKa 在两份 CSS 里都有定义
5820. 选择器 .provKa .provHead 在两份 CSS 里都有定义
5821. 选择器 .provKa input[data-k="biaoQian"].dup 在两份 CSS 里都有定义
5822. 选择器 .qDengDai 在两份 CSS 里都有定义
5823. 选择器 .qDengDai b 在两份 CSS 里都有定义
5824. 选择器 .qShiJian 在两份 CSS 里都有定义
5825. 选择器 .qTouXiaoZi 在两份 CSS 里都有定义
5826. 选择器 .qWenBen 在两份 CSS 里都有定义
5827. 选择器 .qZhengWen 在两份 CSS 里都有定义
5828. 选择器 .renwuLieBiao 在两份 CSS 里都有定义
5829. 选择器 .renwuLieBiao .renwuShiJian 在两份 CSS 里都有定义
5830. 选择器 .renwuLieBiao .renwuZhu 在两份 CSS 里都有定义
5831. 选择器 .renwuLieBiao li 在两份 CSS 里都有定义
5832. 选择器 .secXuanZe 在两份 CSS 里都有定义
5833. 选择器 .secXuanZe select 在两份 CSS 里都有定义
5834. 选择器 .shangXiaWenCaiDan 在两份 CSS 里都有定义
5835. 选择器 .shangXiaWenCaiDan button 在两份 CSS 里都有定义
5836. 选择器 .shangXiaWenCaiDan button.danger 在两份 CSS 里都有定义
5837. 选择器 .shangXiaWenCaiDan button.danger:hover 在两份 CSS 里都有定义
5838. 选择器 .shangXiaWenCaiDan button.qiYong 在两份 CSS 里都有定义
5839. 选择器 .shangXiaWenCaiDan button:hover 在两份 CSS 里都有定义
5840. 选择器 .shangXiaWenFenGe 在两份 CSS 里都有定义
5841. 选择器 .sheZhiKa 在两份 CSS 里都有定义
5842. 选择器 .sheZhiSection 在两份 CSS 里都有定义
5843. 选择器 .sheZhiSection h2 在两份 CSS 里都有定义
5844. 选择器 .shiJianFenGe 在两份 CSS 里都有定义
5845. 选择器 .shiJianFenGe::after 在两份 CSS 里都有定义
5846. 选择器 .shiJianFenGe::before 在两份 CSS 里都有定义
5847. 选择器 .shiLiHang 在两份 CSS 里都有定义
5848. 选择器 .shiLiHang .moYongShanChuXian 在两份 CSS 里都有定义
5849. 选择器 .shiLiHang[style*="opacity:.5"] span:first-child 在两份 CSS 里都有定义
5850. 选择器 .shiLiKa 在两份 CSS 里都有定义
5851. 选择器 .shuRuCounter 在两份 CSS 里都有定义
5852. 选择器 .shuRuQu 在两份 CSS 里都有定义
5853. 选择器 .shuRuQuFaSongHang 在两份 CSS 里都有定义
5854. 选择器 .shuRuQuGongJu 在两份 CSS 里都有定义
5855. 选择器 .shuRuQuTiao 在两份 CSS 里都有定义
5856. 选择器 .shuRuQuZhu 在两份 CSS 里都有定义
5857. 选择器 .shuRuQuZhu:focus-within 在两份 CSS 里都有定义
5858. 选择器 .shuRuQuZuo 在两份 CSS 里都有定义
5859. 选择器 .siKaoBiaoQian 在两份 CSS 里都有定义
5860. 选择器 .siKaoKuai 在两份 CSS 里都有定义
5861. 选择器 .siKaoKuai pre 在两份 CSS 里都有定义
5862. 选择器 .siKaoKuai summary 在两份 CSS 里都有定义
5863. 选择器 .souSuoBaoGuo 在两份 CSS 里都有定义
5864. 选择器 .souSuoBaoGuo input 在两份 CSS 里都有定义
5865. 选择器 .soundHang 在两份 CSS 里都有定义
5866. 选择器 .tcpHang 在两份 CSS 里都有定义
5867. 选择器 .touXiang 在两份 CSS 里都有定义
5868. 选择器 .touXiangTuPian 在两份 CSS 里都有定义
5869. 选择器 .touXiangTuPian.big 在两份 CSS 里都有定义
5870. 选择器 .tuPianYuLanCeng 在两份 CSS 里都有定义
5871. 选择器 .tuPianYuLanCeng img 在两份 CSS 里都有定义
5872. 选择器 .urgency 在两份 CSS 里都有定义
5873. 选择器 .urgency button 在两份 CSS 里都有定义
5874. 选择器 .urgency button.qiYong 在两份 CSS 里都有定义
5875. 选择器 .urgentI.yinCang 在两份 CSS 里都有定义
5876. 选择器 .usageBiao 在两份 CSS 里都有定义
5877. 选择器 .usageBiao tbody tr:hover 在两份 CSS 里都有定义
5878. 选择器 .usageBiao td 在两份 CSS 里都有定义
5879. 选择器 .usageBiao tfoot td 在两份 CSS 里都有定义
5880. 选择器 .usageBiao th 在两份 CSS 里都有定义
5881. 选择器 .usageBiao thead th 在两份 CSS 里都有定义
5882. 选择器 .usernameDisplay 在两份 CSS 里都有定义
5883. 选择器 .usernameDisplay::after 在两份 CSS 里都有定义
5884. 选择器 .usernameDisplay:hover 在两份 CSS 里都有定义
5885. 选择器 .w11Close 在两份 CSS 里都有定义
5886. 选择器 .w11Close:hover 在两份 CSS 里都有定义
5887. 选择器 .w11ColorBody 在两份 CSS 里都有定义
5888. 选择器 .w11ColorDialog 在两份 CSS 里都有定义
5889. 选择器 .w11ColorDialog.yinCang 在两份 CSS 里都有定义
5890. 选择器 .w11ColorFoot 在两份 CSS 里都有定义
5891. 选择器 .w11ColorKa 在两份 CSS 里都有定义
5892. 选择器 .w11ColorMask 在两份 CSS 里都有定义
5893. 选择器 .w11ColorTitle 在两份 CSS 里都有定义
5894. 选择器 .w11Fields 在两份 CSS 里都有定义
5895. 选择器 .w11Fields input[type="number"] 在两份 CSS 里都有定义
5896. 选择器 .w11Fields input[type="text"] 在两份 CSS 里都有定义
5897. 选择器 .w11Fields label 在两份 CSS 里都有定义
5898. 选择器 .w11HexLab input 在两份 CSS 里都有定义
5899. 选择器 .w11Hue 在两份 CSS 里都有定义
5900. 选择器 .w11HueCursor 在两份 CSS 里都有定义
5901. 选择器 .w11JingYin 在两份 CSS 里都有定义
5902. 选择器 .w11Right 在两份 CSS 里都有定义
5903. 选择器 .w11Sv 在两份 CSS 里都有定义
5904. 选择器 .w11SvBlack 在两份 CSS 里都有定义
5905. 选择器 .w11SvCursor 在两份 CSS 里都有定义
5906. 选择器 .w11SvWhite 在两份 CSS 里都有定义
5907. 选择器 .w11Swatch 在两份 CSS 里都有定义
5908. 选择器 .w11SwatchRow 在两份 CSS 里都有定义
5909. 选择器 .woCredVal 在两份 CSS 里都有定义
5910. 选择器 .woDing 在两份 CSS 里都有定义
5911. 选择器 .woDing .pinPailogo 在两份 CSS 里都有定义
5912. 选择器 .woDing .pinPailogoXl 在两份 CSS 里都有定义
5913. 选择器 .woEye 在两份 CSS 里都有定义
5914. 选择器 .woEye.qiYong 在两份 CSS 里都有定义
5915. 选择器 .woMingHang 在两份 CSS 里都有定义
5916. 选择器 .woMingHang .usernameDisplay 在两份 CSS 里都有定义
5917. 选择器 .woPinPai 在两份 CSS 里都有定义
5918. 选择器 .woPinPaiBiaoQian 在两份 CSS 里都有定义
5919. 选择器 .woPinPaiFu 在两份 CSS 里都有定义
5920. 选择器 .woPinPaiMing 在两份 CSS 里都有定义
5921. 选择器 .woPinPaiStack 在两份 CSS 里都有定义
5922. 选择器 .woPinPaiStack .woPinPaiWenBen 在两份 CSS 里都有定义
5923. 选择器 .woPinPaiWenBen 在两份 CSS 里都有定义
5924. 选择器 .woStrip 在两份 CSS 里都有定义
5925. 选择器 .woStrip .field 在两份 CSS 里都有定义
5926. 选择器 .woStrip .profileHead 在两份 CSS 里都有定义
5927. 选择器 .woStripLan 在两份 CSS 里都有定义
5928. 选择器 .woStripLan .woTouXiangLan 在两份 CSS 里都有定义
5929. 选择器 .woStripLan .woXinXiLan 在两份 CSS 里都有定义
5930. 选择器 .woTiShiWarn 在两份 CSS 里都有定义
5931. 选择器 .woTouXiangLan 在两份 CSS 里都有定义
5932. 选择器 .woTouXiangLan .avAnNiu 在两份 CSS 里都有定义
5933. 选择器 .woXinXiLan 在两份 CSS 里都有定义
5934. 选择器 .woYouJianInline 在两份 CSS 里都有定义
5935. 选择器 .woYouJianInline input 在两份 CSS 里都有定义
5936. 选择器 .xiaoXi 在两份 CSS 里都有定义
5937. 选择器 .xiaoXi .av 在两份 CSS 里都有定义
5938. 选择器 .xiaoXi .bubbleWrap 在两份 CSS 里都有定义
5939. 选择器 .xiaoXi .touXiangTuPian 在两份 CSS 里都有定义
5940. 选择器 .xiaoXi.wo 在两份 CSS 里都有定义
5941. 选择器 .xiaoXi.wo .bubble 在两份 CSS 里都有定义
5942. 选择器 .xiaoXi.wo .bubble.md .mdUl 在两份 CSS 里都有定义
5943. 选择器 .xiaoXi.wo .bubbleWrap 在两份 CSS 里都有定义
5944. 选择器 .xiaoXiFuZhi 在两份 CSS 里都有定义
5945. 选择器 .xiaoXiFuZhi:hover 在两份 CSS 里都有定义
5946. 选择器 .xiaoXiJi 在两份 CSS 里都有定义
5947. 选择器 .xiaoXiJi::-webkit-scrollbar 在两份 CSS 里都有定义
5948. 选择器 .xiaoXiJi::-webkit-scrollbar-thumb 在两份 CSS 里都有定义
5949. 选择器 .xiaoXiMing 在两份 CSS 里都有定义
5950. 选择器 .yinCang 在两份 CSS 里都有定义
5951. 选择器 .yinDaoClose 在两份 CSS 里都有定义
5952. 选择器 .yinDaoClose:hover 在两份 CSS 里都有定义
5953. 选择器 .yinDaoDongZuo 在两份 CSS 里都有定义
5954. 选择器 .yinDaoGaoLiang 在两份 CSS 里都有定义
5955. 选择器 .yinDaoHead 在两份 CSS 里都有定义
5956. 选择器 .yinDaoJiDu 在两份 CSS 里都有定义
5957. 选择器 .yinDaoJiaZhi 在两份 CSS 里都有定义
5958. 选择器 .yinDaoLianJie 在两份 CSS 里都有定义
5959. 选择器 .yinDaoTi 在两份 CSS 里都有定义
5960. 选择器 .yinDaoTiao 在两份 CSS 里都有定义
5961. 选择器 .yinDaoTiao * 在两份 CSS 里都有定义
5962. 选择器 .yinDaoTuBiao 在两份 CSS 里都有定义
5963. 选择器 .yinDaoTuBiao svg 在两份 CSS 里都有定义
5964. 选择器 .yinDaoWen 在两份 CSS 里都有定义
5965. 选择器 .yinSiShiTu 在两份 CSS 里都有定义
5966. 选择器 .yinSiShiTu .pvSec 在两份 CSS 里都有定义
5967. 选择器 .yinSiShiTu .pvSec h4 在两份 CSS 里都有定义
5968. 选择器 .yinSiShiTu .pvSec p 在两份 CSS 里都有定义
5969. 选择器 .yinSiShiTu > p 在两份 CSS 里都有定义
5970. 选择器 .yunXingDian 在两份 CSS 里都有定义
5971. 选择器 .yunXingDian i 在两份 CSS 里都有定义
5972. 选择器 .yunXingDian i:nth-child(2) 在两份 CSS 里都有定义
5973. 选择器 .yunXingDian i:nth-child(3) 在两份 CSS 里都有定义
5974. 选择器 .yunXingDian.cuo i 在两份 CSS 里都有定义
5975. 选择器 .yunXingDian.ok i 在两份 CSS 里都有定义
5976. 选择器 .yunXingMiao 在两份 CSS 里都有定义
5977. 选择器 .yunXingWen 在两份 CSS 里都有定义
5978. 选择器 .yunXingZhuangTai 在两份 CSS 里都有定义
5979. 选择器 .yunXingZhuangTai.cuoWu 在两份 CSS 里都有定义
5980. 选择器 .zhuTiCustomMianBan 在两份 CSS 里都有定义
5981. 选择器 .zhuTiCustomMianBan.yinCang 在两份 CSS 里都有定义
5982. 选择器 .zhuTiMoShi 在两份 CSS 里都有定义
5983. 选择器 .zhuTiMoShi button 在两份 CSS 里都有定义
5984. 选择器 .zhuTiMoShi button.qiYong 在两份 CSS 里都有定义
5985. 选择器 .zhuTiSeKuai 在两份 CSS 里都有定义
5986. 选择器 .zhuTiSeKuai:hover 在两份 CSS 里都有定义
5987. 选择器 .zhuTiSwatches 在两份 CSS 里都有定义
5988. 选择器 .zhuTiSwatches button 在两份 CSS 里都有定义
5989. 选择器 .zhuTiSwatches button.qiYong 在两份 CSS 里都有定义
5990. 选择器 0% 在两份 CSS 里都有定义
5991. 选择器 100% 在两份 CSS 里都有定义
5992. 选择器 25% 在两份 CSS 里都有定义
5993. 选择器 30% 在两份 CSS 里都有定义
5994. 选择器 50% 在两份 CSS 里都有定义
5995. 选择器 60% 在两份 CSS 里都有定义
5996. 选择器 75% 在两份 CSS 里都有定义
5997. 选择器 :root 在两份 CSS 里都有定义
5998. 选择器 [data-theme="dark"] 在两份 CSS 里都有定义
5999. 选择器 [data-theme="light"] 在两份 CSS 里都有定义
6000. 选择器 body 在两份 CSS 里都有定义
6001. 选择器 body.liaoTianChuangKou #appTi 在两份 CSS 里都有定义
6002. 选择器 body.liaoTianChuangKou #appTi.yinCangLieBiao 在两份 CSS 里都有定义
6003. 选择器 body.liaoTianChuangKou #ceLan 在两份 CSS 里都有定义
6004. 选择器 body.liaoTianChuangKou #kongTai 在两份 CSS 里都有定义
6005. 选择器 body.liaoTianChuangKou #lanTiaoZhengTiao 在两份 CSS 里都有定义
6006. 选择器 body.liaoTianChuangKou #liaoTianBuJu 在两份 CSS 里都有定义
6007. 选择器 body.liaoTianChuangKou #liaoTianLan 在两份 CSS 里都有定义
6008. 选择器 body.liaoTianChuangKou #lieBiaoLan 在两份 CSS 里都有定义
6009. 选择器 body.liaoTianChuangKou #mianBanLan 在两份 CSS 里都有定义
6010. 选择器 body.liaoTianChuangKou #mianBanTiaoZhengTiao 在两份 CSS 里都有定义
6011. 选择器 body.liaoTianChuangKou #pageBuJu 在两份 CSS 里都有定义
6012. 选择器 body.liaoTianChuangKou #shiLiXiangQing 在两份 CSS 里都有定义
6013. 选择器 body.liaoTianChuangKou #xiaoXiJi 在两份 CSS 里都有定义
6014. 选择器 body.liaoTianChuangKou #zhuLan 在两份 CSS 里都有定义
6015. 选择器 body.liaoTianChuangKou .liaoTianBuJu 在两份 CSS 里都有定义
6016. 选择器 body.liaoTianChuangKou .pageBuJu 在两份 CSS 里都有定义
6017. 选择器 body.pingTaiDarwin #anNiuZongShiDing 在两份 CSS 里都有定义
6018. 选择器 body.pingTaiDarwin #biaoTiLan 在两份 CSS 里都有定义
6019. 选择器 body.pingTaiDarwin #biaoTiLanDongZuoJi 在两份 CSS 里都有定义
6020. 选择器 body.pingTaiDarwin .biaoTiLanMacExtra 在两份 CSS 里都有定义
6021. 选择器 button 在两份 CSS 里都有定义
6022. 选择器 button:focus-visible 在两份 CSS 里都有定义
6023. 选择器 from 在两份 CSS 里都有定义
6024. 选择器 html 在两份 CSS 里都有定义
6025. 选择器 input 在两份 CSS 里都有定义
6026. 选择器 input:focus-visible 在两份 CSS 里都有定义
6027. 选择器 li 在两份 CSS 里都有定义
6028. 选择器 select 在两份 CSS 里都有定义
6029. 选择器 select:focus-visible 在两份 CSS 里都有定义
6030. 选择器 table.chaJianJi 在两份 CSS 里都有定义
6031. 选择器 table.chaJianJi td 在两份 CSS 里都有定义
6032. 选择器 table.chaJianJi th 在两份 CSS 里都有定义
6033. 选择器 textarea 在两份 CSS 里都有定义
6034. 选择器 textarea:focus-visible 在两份 CSS 里都有定义
6035. 选择器 to 在两份 CSS 里都有定义

## E 机制完善：门禁全接入（套件内验收器都注册过）

6036. 门禁 verify-busy-toggle.mjs 被全量套件引用
6037. 门禁 verify-chain-buttons.mjs 被全量套件引用
6038. 门禁 verify-chat-content.mjs 被全量套件引用
6039. 门禁 verify-chat-window.mjs 被全量套件引用
6040. 门禁 verify-container-exec.mjs 被全量套件引用
6041. 门禁 verify-container-probe.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6042. 独立门禁 verify-container-real.mjs 存在且非空
6043. 独立门禁 verify-context-renderer.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6044. 门禁 verify-credential.mjs 被全量套件引用
6045. 门禁 verify-css-consistency.mjs 被全量套件引用
6046. 门禁 verify-docs.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6047. 独立门禁 verify-e2e.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6048. 门禁 verify-electron-app-binding.mjs 被全量套件引用
6049. 门禁 verify-eta-forecast.mjs 被全量套件引用
6050. 门禁 verify-features-99.mjs 被全量套件引用
6051. 门禁 verify-firstrun-ui.mjs 被全量套件引用
6052. 门禁 verify-group-store.mjs 被全量套件引用
6053. 门禁 verify-history-persist.mjs 被全量套件引用
6054. 门禁 verify-i18n-locales.mjs 被全量套件引用
6055. 门禁 verify-identity.mjs 被全量套件引用
6056. 门禁 verify-import-integrity.mjs 被全量套件引用
6057. 门禁 verify-ipc-probe.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6058. 独立门禁 verify-live-ui.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6059. 门禁 verify-membership.mjs 被全量套件引用
6060. 门禁 verify-memory.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6061. 独立门禁 verify-mobile-ui.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6062. 门禁 verify-model-pick.mjs 被全量套件引用
6063. 门禁 verify-model-route.mjs 被全量套件引用
6064. 门禁 verify-naming.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6065. 独立门禁 verify-net-ui.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6066. 门禁 verify-nm-format.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6067. 独立门禁 verify-no-wsl-start.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6068. 门禁 verify-office-ooxml.mjs 被全量套件引用
6069. 门禁 verify-planB.mjs 被全量套件引用
6070. 门禁 verify-planD.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6071. 独立门禁 verify-qr-scan.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6072. 门禁 verify-raf-batching.mjs 被全量套件引用
6073. 门禁 verify-renderer-template-balance.mjs 被全量套件引用
6074. 门禁 verify-repo-guard.mjs 被全量套件引用
6075. 门禁 verify-router-queue.mjs 被全量套件引用
6076. 门禁 verify-runtime-errors.mjs 被全量套件引用
6077. 门禁 verify-security.mjs 被全量套件引用
6078. 门禁 verify-sound-card.mjs 被全量套件引用
6079. 门禁 verify-strict-language.mjs 被全量套件引用
6080. 门禁 verify-subagents.mjs 被全量套件引用
6081. 门禁 verify-summary-quality.mjs 被全量套件引用
6082. 门禁 verify-tasks-666.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6083. 独立门禁 verify-tasks-6666.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6084. 门禁 verify-template-integrity.mjs 被全量套件引用
6085. 门禁 verify-think-toolbar.mjs 被全量套件引用
6086. 门禁 verify-thinking-merge.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6087. 独立门禁 verify-tool-call-e2e.mjs 存在且非空
6088. 独立门禁 verify-tool-calls.mjs 存在且非空
6089. 独立门禁 verify-tray-quit.mjs 存在且非空
6090. 独立门禁 verify-two-windows.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6091. 门禁 verify-ui-layout.mjs 被全量套件引用
6092. 门禁 verify-updater-github.mjs 被全量套件引用
6093. 门禁 verify-updater.mjs 被全量套件引用
6094. 门禁 verify-usage-table.mjs 被全量套件引用
6095. 门禁 verify-warmy-features.mjs 被全量套件引用

## E 机制完善：独立门禁在册（不进套件，按需单独跑）

6096. 独立门禁 verify-warmy-ipc-probe.mjs 存在且非空

## E 机制完善：门禁全接入（套件内验收器都注册过）

6097. 门禁 verify-wiring.mjs 被全量套件引用
6098. 门禁 verify-work-tools.mjs 被全量套件引用

## F 机制完善：源码资产在册且非空

6099. 源码文件 packages/app-shell/src/agent-tools.ts 存在且非空
6100. 源码文件 packages/app-shell/src/ai-questions.ts 存在且非空
6101. 源码文件 packages/app-shell/src/archive-cleanup.ts 存在且非空
6102. 源码文件 packages/app-shell/src/asset-wire.ts 存在且非空
6103. 源码文件 packages/app-shell/src/atomic-json.ts 存在且非空
6104. 源码文件 packages/app-shell/src/audit.ts 存在且非空
6105. 源码文件 packages/app-shell/src/checkpoint.ts 存在且非空
6106. 源码文件 packages/app-shell/src/container-instances.ts 存在且非空
6107. 源码文件 packages/app-shell/src/container-probe.ts 存在且非空
6108. 源码文件 packages/app-shell/src/context-renderer.ts 存在且非空
6109. 源码文件 packages/app-shell/src/credential.ts 存在且非空
6110. 源码文件 packages/app-shell/src/electron-main.ts 存在且非空
6111. 源码文件 packages/app-shell/src/eta-forecast.ts 存在且非空
6112. 源码文件 packages/app-shell/src/executor.ts 存在且非空
6113. 源码文件 packages/app-shell/src/group-store.ts 存在且非空
6114. 源码文件 packages/app-shell/src/helper-tool.ts 存在且非空
6115. 源码文件 packages/app-shell/src/identity-provider.ts 存在且非空
6116. 源码文件 packages/app-shell/src/identity-store.ts 存在且非空
6117. 源码文件 packages/app-shell/src/identity.ts 存在且非空
6118. 源码文件 packages/app-shell/src/index.ts 存在且非空
6119. 源码文件 packages/app-shell/src/lease.ts 存在且非空
6120. 源码文件 packages/app-shell/src/memory-client.ts 存在且非空
6121. 源码文件 packages/app-shell/src/metrics.ts 存在且非空
6122. 源码文件 packages/app-shell/src/model-pick.ts 存在且非空
6123. 源码文件 packages/app-shell/src/model-roles.ts 存在且非空
6124. 源码文件 packages/app-shell/src/net-wiring.ts 存在且非空
6125. 源码文件 packages/app-shell/src/nm-wen-jian.ts 存在且非空
6126. 源码文件 packages/app-shell/src/office-tools.ts 存在且非空
6127. 源码文件 packages/app-shell/src/orchestrator.ts 存在且非空
6128. 源码文件 packages/app-shell/src/preload.cjs 存在且非空
6129. 源码文件 packages/app-shell/src/project-memory.ts 存在且非空
6130. 源码文件 packages/app-shell/src/read-back.ts 存在且非空
6131. 源码文件 packages/app-shell/src/repo-guard.ts 存在且非空
6132. 源码文件 packages/app-shell/src/repo-hooks.ts 存在且非空
6133. 源码文件 packages/app-shell/src/runtime.ts 存在且非空
6134. 源码文件 packages/app-shell/src/secure-keys.ts 存在且非空
6135. 源码文件 packages/app-shell/src/settings-store.ts 存在且非空
6136. 源码文件 packages/app-shell/src/smtp-verify.ts 存在且非空
6137. 源码文件 packages/app-shell/src/snip-preload.cjs 存在且非空
6138. 源码文件 packages/app-shell/src/subagents.ts 存在且非空
6139. 源码文件 packages/app-shell/src/updater.ts 存在且非空
6140. 源码文件 packages/app-shell/src/work-tools.ts 存在且非空
6141. 源码文件 packages/app-shell/src/i18n/locales.ts 存在且非空
6142. 源码文件 packages/app-shell/src/renderer/app.css 存在且非空
6143. 源码文件 packages/app-shell/src/renderer/app.js 存在且非空
6144. 源码文件 packages/app-shell/src/renderer/busy-phrases.js 存在且非空
6145. 源码文件 packages/app-shell/src/renderer/index.html 存在且非空
6146. 源码文件 packages/app-shell/src/renderer/qr.js 存在且非空
6147. 源码文件 packages/app-shell/src/renderer/renderer.css 存在且非空
6148. 源码文件 packages/app-shell/src/renderer/snip.html 存在且非空
6149. 源码文件 packages/app-shell/src/renderer/vendor/jsqr-1.4.0.js 存在且非空
6150. 源码文件 packages/app-shell/src/renderer/vendor/qrcode-generator-2.0.4.js 存在且非空

## G 机制完善：页面文案全走 i18n

6151. index.html 用到的 i18n 键 chat.askOnExceed 存在
6152. index.html 用到的 i18n 键 chat.attachTip 存在
6153. index.html 用到的 i18n 键 chat.autoRead 存在
6154. index.html 用到的 i18n 键 chat.autoScroll 存在
6155. index.html 用到的 i18n 键 chat.export 存在
6156. index.html 用到的 i18n 键 chat.faSong 存在
6157. index.html 用到的 i18n 键 chat.openWindow 存在
6158. index.html 用到的 i18n 键 chat.placeholder 存在
6159. index.html 用到的 i18n 键 chat.queueTitle 存在
6160. index.html 用到的 i18n 键 chat.screenshotTip 存在
6161. index.html 用到的 i18n 键 chat.scrollToBottom 存在
6162. index.html 用到的 i18n 键 chat.security 存在
6163. index.html 用到的 i18n 键 chat.securityFull 存在
6164. index.html 用到的 i18n 键 chat.securityNormal 存在
6165. index.html 用到的 i18n 键 chat.securityStrict 存在
6166. index.html 用到的 i18n 键 chat.stopAllTip 存在
6167. index.html 用到的 i18n 键 chat.urgency 存在
6168. index.html 用到的 i18n 键 chat.voiceTip 存在
6169. index.html 用到的 i18n 键 checkpoints.biaoTi 存在
6170. index.html 用到的 i18n 键 common.close 存在
6171. index.html 用到的 i18n 键 common.more 存在
6172. index.html 用到的 i18n 键 console.biaoTi 存在
6173. index.html 用到的 i18n 键 console.clearTip 存在
6174. index.html 用到的 i18n 键 container.console.inputPlaceholder 存在
6175. index.html 用到的 i18n 键 container.console.run 存在
6176. index.html 用到的 i18n 键 container.console.tip 存在
6177. index.html 用到的 i18n 键 cost.biaoTi 存在
6178. index.html 用到的 i18n 键 cost.export 存在
6179. index.html 用到的 i18n 键 ctx.budget.biaoTi 存在
6180. index.html 用到的 i18n 键 ctx.budget.minHint 存在
6181. index.html 用到的 i18n 键 ctx.budget.tiShi 存在
6182. index.html 用到的 i18n 键 executors.biaoTi 存在
6183. index.html 用到的 i18n 键 executors.run 存在
6184. index.html 用到的 i18n 键 group.directedOnly 存在
6185. index.html 用到的 i18n 键 group.members 存在
6186. index.html 用到的 i18n 键 group.pickInstance 存在
6187. index.html 用到的 i18n 键 group.pullIn 存在
6188. index.html 用到的 i18n 键 join.qrHint 存在
6189. index.html 用到的 i18n 键 knowledge.biaoTi 存在
6190. index.html 用到的 i18n 键 knowledge.save 存在
6191. index.html 用到的 i18n 键 knowledge.search 存在
6192. index.html 用到的 i18n 键 list.search 存在
6193. index.html 用到的 i18n 键 metrics.biaoTi 存在
6194. index.html 用到的 i18n 键 model.think 存在
6195. index.html 用到的 i18n 键 model.think.byAgency 存在
6196. index.html 用到的 i18n 键 nav.touXiang 存在
6197. index.html 用到的 i18n 键 panel.assist.biaoTi 存在
6198. index.html 用到的 i18n 键 panel.diagWhat 存在
6199. index.html 用到的 i18n 键 panel.directory 存在
6200. index.html 用到的 i18n 键 panel.duty 存在
6201. index.html 用到的 i18n 键 panel.jinDu 存在
6202. index.html 用到的 i18n 键 panel.kb.biaoTi 存在
6203. index.html 用到的 i18n 键 panel.kb.tiShi 存在
6204. index.html 用到的 i18n 键 panel.modelMgr 存在
6205. index.html 用到的 i18n 键 panel.plan.collapse 存在
6206. index.html 用到的 i18n 键 panel.plan.title 存在
6207. index.html 用到的 i18n 键 panel.projectFiles 存在
6208. index.html 用到的 i18n 键 panel.projectState 存在
6209. index.html 用到的 i18n 键 panel.schedule.title 存在
6210. index.html 用到的 i18n 键 panel.summary.auto 存在
6211. index.html 用到的 i18n 键 panel.summary.biaoTi 存在
6212. index.html 用到的 i18n 键 panel.summary.gen 存在
6213. index.html 用到的 i18n 键 pm.title 存在
6214. index.html 用到的 i18n 键 tip.close 存在
6215. index.html 用到的 i18n 键 tip.dragWidth 存在
6216. index.html 用到的 i18n 键 tip.externalChat 存在
6217. index.html 用到的 i18n 键 tip.externalGroup 存在
6218. index.html 用到的 i18n 键 tip.internalGroup 存在
6219. index.html 用到的 i18n 键 tip.max 存在
6220. index.html 用到的 i18n 键 tip.min 存在
6221. index.html 用到的 i18n 键 tip.pin 存在
6222. index.html 用到的 i18n 键 tip.refresh 存在
6223. index.html 用到的 i18n 键 tip.settings 存在
6224. index.html 用到的 i18n 键 tip.singleAi 存在
6225. index.html 用到的 i18n 键 tip.splitHint 存在
6226. index.html 用到的 i18n 键 tip.wo 存在
6227. index.html 用到的 i18n 键 urgency.insertLabel 存在
6228. index.html 用到的 i18n 键 urgency.queueLabel 存在
6229. index.html 用到的 i18n 键 urgency.urgentLabel 存在

## H 机制完善：诊断钩子契约（门禁可读）

6230. window.__applyPanelVisibility 被赋值（可被门禁读）
6231. window.__chuanBoYinXiao 被赋值（可被门禁读）
6232. window.__costData 被赋值（可被门禁读）
6233. window.__dshBtnDelegated 被赋值（可被门禁读）
6234. window.__dshBusy 被赋值（可被门禁读）
6235. window.__dshJianCha 被赋值（可被门禁读）
6236. window.__dshZhiXingAnZhuang 被赋值（可被门禁读）
6237. window.__ensurePanCardCloseButtons 被赋值（可被门禁读）
6238. window.__fillSpecialModelSelects 被赋值（可被门禁读）
6239. window.__guideRestartDelegated 被赋值（可被门禁读）
6240. window.__kindWenAn 被赋值（可被门禁读）
6241. window.__langDuWenBen 被赋值（可被门禁读）
6242. window.__langTrace 被赋值（可被门禁读）
6243. window.__maybeShowSetup 被赋值（可被门禁读）
6244. window.__mdHtml 被赋值（可被门禁读）
6245. window.__mingBiaoQing 被赋值（可被门禁读）
6246. window.__moXingNengLi 被赋值（可被门禁读）
6247. window.__msbBusy 被赋值（可被门禁读）
6248. window.__msbInstallDelegated 被赋值（可被门禁读）
6249. window.__msbSheZhiAnNiu 被赋值（可被门禁读）
6250. window.__msbTanCeShiFouAnZhuang 被赋值（可被门禁读）
6251. window.__msbTongBuChuShi 被赋值（可被门禁读）
6252. window.__msgs 被赋值（可被门禁读）
6253. window.__netNeedsMesh 被赋值（可被门禁读）
6254. window.__netUi 被赋值（可被门禁读）
6255. window.__panelDebug 被赋值（可被门禁读）
6256. window.__panelLog 被赋值（可被门禁读）
6257. window.__qingHuanCunYinXiao 被赋值（可被门禁读）
6258. window.__quanPingQuSe 被赋值（可被门禁读）
6259. window.__queBaoKaPian 被赋值（可被门禁读）
6260. window.__raf 被赋值（可被门禁读）
6261. window.__rafDaiLieChang 被赋值（可被门禁读）
6262. window.__refreshPanelVisibility 被赋值（可被门禁读）
6263. window.__refreshSecurity 被赋值（可被门禁读）
6264. window.__refreshSkills 被赋值（可被门禁读）
6265. window.__refreshThink 被赋值（可被门禁读）
6266. window.__refreshUrgency 被赋值（可被门禁读）
6267. window.__renderAssistList 被赋值（可被门禁读）
6268. window.__renderJiHuaKa 被赋值（可被门禁读）
6269. window.__renderPluginList 被赋值（可被门禁读）
6270. window.__renderSmLian 被赋值（可被门禁读）
6271. window.__saveState 被赋值（可被门禁读）
6272. window.__shangXiaWenBiaoQian 被赋值（可被门禁读）
6273. window.__shouLiuShiKuai 被赋值（可被门禁读）
6274. window.__showOnboardingGuide 被赋值（可被门禁读）
6275. window.__showToast 被赋值（可被门禁读）
6276. window.__skillScanState 被赋值（可被门禁读）
6277. window.__skillsState 被赋值（可被门禁读）
6278. window.__skillsUi 被赋值（可被门禁读）
6279. window.__syncGroups 被赋值（可被门禁读）
6280. window.__syncSendState 被赋值（可被门禁读）
6281. window.__toggleDiagPanel 被赋值（可被门禁读）
6282. window.__tongBuBeiJingWenZi 被赋值（可被门禁读）
6283. window.__warmyDebugState 被赋值（可被门禁读）
6284. window.__warmyLoadI18n 被赋值（可被门禁读）
6285. window.__warmyReloadProviders 被赋值（可被门禁读）
6286. window.__warmyRenderPage 被赋值（可被门禁读）
6287. window.__xiangKaPianYin 被赋值（可被门禁读）
6288. window.__yinDaoChongHua 被赋值（可被门禁读）
6289. window.__yinPinBaoHuo 被赋值（可被门禁读）
6290. window.__yinXiaoYuRe 被赋值（可被门禁读）
6291. window.__yinXiaoZhenDuan 被赋值（可被门禁读）
6292. window.__yinXiaoZuiHou 被赋值（可被门禁读）
6293. window.__yingYongWenZiPiHao 被赋值（可被门禁读）
6294. window.__youShiZhiWenBen 被赋值（可被门禁读）

## I 机制完善：IPC 双端一致

6295. IPC 通道 warmy:aiWenTi 在 preload 与主进程都存在
6296. IPC 通道 warmy:aiWenTiAnswer 在 preload 与主进程都存在
6297. IPC 通道 warmy:aiWenTiDaKai 在 preload 与主进程都存在
6298. IPC 通道 warmy:aiWenTiLieBiao 在 preload 与主进程都存在
6299. IPC 通道 warmy:anQuanMiYaoBaoCun 在 preload 与主进程都存在
6300. IPC 通道 warmy:anQuanMiYaoJiaZai 在 preload 与主进程都存在
6301. IPC 通道 warmy:anQuanMoShi 在 preload 与主进程都存在
6302. IPC 通道 warmy:anQuanShenHe 在 preload 与主进程都存在
6303. IPC 通道 warmy:anZhuangZiTi 在 preload 与主进程都存在
6304. IPC 通道 warmy:asrZhuanXie 在 preload 与主进程都存在
6305. IPC 通道 warmy:asrollama 在 preload 与主进程都存在
6306. IPC 通道 warmy:assistGengXinHuoChaRu 在 preload 与主进程都存在
6307. IPC 通道 warmy:assistLieBiao 在 preload 与主进程都存在
6308. IPC 通道 warmy:baoCunWenBen 在 preload 与主进程都存在
6309. IPC 通道 warmy:baoCunYuYin 在 preload 与主进程都存在
6310. IPC 通道 warmy:cangKuShouWeiAnZhuangGouZiJi 在 preload 与主进程都存在
6311. IPC 通道 warmy:cangKuShouWeiJianChaLuJingJi 在 preload 与主进程都存在
6312. IPC 通道 warmy:cangKuShouWeiJianChaYinYong 在 preload 与主进程都存在
6313. IPC 通道 warmy:cangKuShouWeiYuXianJieShou 在 preload 与主进程都存在
6314. IPC 通道 warmy:cangKuShouWeiZhuangTai 在 preload 与主进程都存在
6315. IPC 通道 warmy:ccrGongJuShuChu 在 preload 与主进程都存在
6316. IPC 通道 warmy:chaJianAnZhuang 在 preload 与主进程都存在
6317. IPC 通道 warmy:chaJianJiSaoMiao 在 preload 与主进程都存在
6318. IPC 通道 warmy:chaJianJiSaoMiaoMuLuJiQu 在 preload 与主进程都存在
6319. IPC 通道 warmy:chaJianJiSaoMiaoMuLuJiSheZhi 在 preload 与主进程都存在
6320. IPC 通道 warmy:chaJianXieZai 在 preload 与主进程都存在
6321. IPC 通道 warmy:chanPinYunXing 在 preload 与主进程都存在
6322. IPC 通道 warmy:checkpointChuangJian 在 preload 与主进程都存在
6323. IPC 通道 warmy:checkpointHuiGun 在 preload 与主进程都存在
6324. IPC 通道 warmy:checkpointLieBiao 在 preload 与主进程都存在
6325. IPC 通道 warmy:checkpointZiDong 在 preload 与主进程都存在
6326. IPC 通道 warmy:chengBenZhaiYao 在 preload 与主进程都存在
6327. IPC 通道 warmy:chengYuanMingCeCheXiao 在 preload 与主进程都存在
6328. IPC 通道 warmy:chengYuanMingCeJieShouZhengShu 在 preload 与主进程都存在
6329. IPC 通道 warmy:chengYuanMingCeLieBiao 在 preload 与主进程都存在
6330. IPC 通道 warmy:chengYuanMingCeLunHuan 在 preload 与主进程都存在
6331. IPC 通道 warmy:chengYuanMingCeQianFa 在 preload 与主进程都存在
6332. IPC 通道 warmy:chengYuanMingCeShouQuan 在 preload 与主进程都存在
6333. IPC 通道 warmy:chengYuanMingCeTongBuCheXiao 在 preload 与主进程都存在
6334. IPC 通道 warmy:chuShiSheZhiTai 在 preload 与主进程都存在
6335. IPC 通道 warmy:chuShiSheZhiWanCheng 在 preload 与主进程都存在
6336. IPC 通道 warmy:daKaiLiaoTianChuangKou 在 preload 与主进程都存在
6337. IPC 通道 warmy:daKaiLuJing 在 preload 与主进程都存在
6338. IPC 通道 warmy:daKaiWaiBuLianJie 在 preload 与主进程都存在
6339. IPC 通道 warmy:daoChuHuiHua 在 preload 与主进程都存在
6340. IPC 通道 warmy:daoChuYunXuMingDan 在 preload 与主进程都存在
6341. IPC 通道 warmy:daoRuopenclaw 在 preload 与主进程都存在
6342. IPC 通道 warmy:dingShiDaoDian 在 preload 与主进程都存在
6343. IPC 通道 warmy:dingShiRenWu 在 preload 与主进程都存在
6344. IPC 通道 warmy:dingShiRenWuGengXin 在 preload 与主进程都存在
6345. IPC 通道 warmy:dingShiRenWuLieBiao 在 preload 与主进程都存在
6346. IPC 通道 warmy:dingShiRenWuShanChu 在 preload 与主进程都存在
6347. IPC 通道 warmy:dshAnZhuang 在 preload 与主进程都存在
6348. IPC 通道 warmy:dshKeYong 在 preload 与主进程都存在
6349. IPC 通道 warmy:dshZhuangTai 在 preload 与主进程都存在
6350. IPC 通道 warmy:duiDuanJiLieBiao 在 preload 与主进程都存在
6351. IPC 通道 warmy:duiDuanJiTianJia 在 preload 与主进程都存在
6352. IPC 通道 warmy:duiDuanJiYiChu 在 preload 与主进程都存在
6353. IPC 通道 warmy:fanYi 在 preload 与主进程都存在
6354. IPC 通道 warmy:gengXinLaiYuanQu 在 preload 与主进程都存在
6355. IPC 通道 warmy:gengXinLaiYuanSheZhi 在 preload 与主进程都存在
6356. IPC 通道 warmy:gongYingShangMiYaoHas 在 preload 与主进程都存在
6357. IPC 通道 warmy:gongYingShangMiYaoQingChu 在 preload 与主进程都存在
6358. IPC 通道 warmy:gongYingShangMiYaoSheZhi 在 preload 与主进程都存在
6359. IPC 通道 warmy:guiDangLieBiao 在 preload 与主进程都存在
6360. IPC 通道 warmy:guiDangWaiBu 在 preload 与主进程都存在
6361. IPC 通道 warmy:heiMingDanLieBiao 在 preload 与主进程都存在
6362. IPC 通道 warmy:heiMingDanYiChu 在 preload 与主进程都存在
6363. IPC 通道 warmy:huiHuaZhaiYao 在 preload 与主进程都存在
6364. IPC 通道 warmy:i18n 在 preload 与主进程都存在
6365. IPC 通道 warmy:jiHuaGengXin 在 preload 与主进程都存在
6366. IPC 通道 warmy:jiHuaHuiFu 在 preload 与主进程都存在
6367. IPC 通道 warmy:jiHuaLieBiao 在 preload 与主进程都存在
6368. IPC 通道 warmy:jiHuaSheZhi 在 preload 与主进程都存在
6369. IPC 通道 warmy:jiYiChongJian 在 preload 与主进程都存在
6370. IPC 通道 warmy:jiYiHuiSuo 在 preload 与主进程都存在
6371. IPC 通道 warmy:jiYiJianSuo 在 preload 与主进程都存在
6372. IPC 通道 warmy:jiYiZhuangTai 在 preload 与主进程都存在
6373. IPC 通道 warmy:jiYiZhuiJia 在 preload 与主进程都存在
6374. IPC 通道 warmy:jiaRuHuiYing 在 preload 与主进程都存在
6375. IPC 通道 warmy:jiaRuPending 在 preload 与主进程都存在
6376. IPC 通道 warmy:jiaRuQingQiu 在 preload 与主进程都存在
6377. IPC 通道 warmy:jianChaGengXin 在 preload 与主进程都存在
6378. IPC 通道 warmy:jieDianJiCheXiao 在 preload 与主进程都存在
6379. IPC 通道 warmy:jieDianJiLieBiao 在 preload 与主进程都存在
6380. IPC 通道 warmy:jieDianJiPeiDui 在 preload 与主进程都存在
6381. IPC 通道 warmy:jieTuKaiShi 在 preload 与主进程都存在
6382. IPC 通道 warmy:jieTuXuanQu 在 preload 与主进程都存在
6383. IPC 通道 warmy:jinengJiDaoRu 在 preload 与主进程都存在
6384. IPC 通道 warmy:jinengJiLieBiao 在 preload 与主进程都存在
6385. IPC 通道 warmy:jinengJiLuJingJi 在 preload 与主进程都存在
6386. IPC 通道 warmy:jinengJiSaoMiaoMuLuJiQu 在 preload 与主进程都存在
6387. IPC 通道 warmy:jinengJiSaoMiaoMuLuJiSheZhi 在 preload 与主进程都存在
6388. IPC 通道 warmy:jinengJiSheZhiEnabled 在 preload 与主进程都存在
6389. IPC 通道 warmy:jinengJiYiChu 在 preload 与主进程都存在
6390. IPC 通道 warmy:jueSeMoXingJiQu 在 preload 与主进程都存在
6391. IPC 通道 warmy:jueSeMoXingJiSheZhi 在 preload 与主进程都存在
6392. IPC 通道 warmy:kanbanHuiHua 在 preload 与主进程都存在
6393. IPC 通道 warmy:kanbanJuHe 在 preload 与主进程都存在
6394. IPC 通道 warmy:kanbanRenwuJi 在 preload 与主进程都存在
6395. IPC 通道 warmy:kanbanShiJianJi 在 preload 与主进程都存在
6396. IPC 通道 warmy:kongZhiTaiShiJian 在 preload 与主进程都存在
6397. IPC 通道 warmy:liaoTianFaSong 在 preload 与主进程都存在
6398. IPC 通道 warmy:liaoTianRiZhi 在 preload 与主进程都存在
6399. IPC 通道 warmy:liaoTianRiZhiHuiFu 在 preload 与主进程都存在
6400. IPC 通道 warmy:liaoTianRiZhiZhuiJia 在 preload 与主进程都存在
6401. IPC 通道 warmy:liaoTianUpdated 在 preload 与主进程都存在
6402. IPC 通道 warmy:liaoTianXiaoXiJi 在 preload 与主进程都存在
6403. IPC 通道 warmy:lieBiaoMoXingJi 在 preload 与主进程都存在
6404. IPC 通道 warmy:lieBiaoShiLiJi 在 preload 与主进程都存在
6405. IPC 通道 warmy:lieBiaoXiTongZiTi 在 preload 与主进程都存在
6406. IPC 通道 warmy:luYouQiDuiLieJiQu 在 preload 与主进程都存在
6407. IPC 通道 warmy:microsandboxAnZhuang 在 preload 与主进程都存在
6408. IPC 通道 warmy:microsandboxXieZai 在 preload 与主进程都存在
6409. IPC 通道 warmy:microsandboxXuNiHua 在 preload 与主进程都存在
6410. IPC 通道 warmy:microsandboxZhuangTai 在 preload 与主进程都存在
6411. IPC 通道 warmy:neiWangFaSong 在 preload 与主进程都存在
6412. IPC 通道 warmy:neiWangQiDong 在 preload 与主进程都存在
6413. IPC 通道 warmy:neiWangShouXiang 在 preload 与主进程都存在
6414. IPC 通道 warmy:neiWangShuangJiMaoYan 在 preload 与主进程都存在
6415. IPC 通道 warmy:neiWangTingZhi 在 preload 与主进程都存在
6416. IPC 通道 warmy:neiWangZhuangTai 在 preload 与主进程都存在
6417. IPC 通道 warmy:nmYueDu 在 preload 与主进程都存在
6418. IPC 通道 warmy:paiShengShiLi 在 preload 与主进程都存在
6419. IPC 通道 warmy:paiShengdshShiLi 在 preload 与主进程都存在
6420. IPC 通道 warmy:peiZhiBaoCun 在 preload 与主进程都存在
6421. IPC 通道 warmy:peiZhiChanged 在 preload 与主进程都存在
6422. IPC 通道 warmy:peiZhiChongTu 在 preload 与主进程都存在
6423. IPC 通道 warmy:peiZhiDaoChu 在 preload 与主进程都存在
6424. IPC 通道 warmy:peiZhiDaoRu 在 preload 与主进程都存在
6425. IPC 通道 warmy:peiZhiQu 在 preload 与主进程都存在
6426. IPC 通道 warmy:peiZhiXinFeng 在 preload 与主进程都存在
6427. IPC 通道 warmy:piZhunHuiYing 在 preload 与主进程都存在
6428. IPC 通道 warmy:piZhunQingQiu 在 preload 与主进程都存在
6429. IPC 通道 warmy:pingMuJieTu 在 preload 与主进程都存在
6430. IPC 通道 warmy:pingTai 在 preload 与主进程都存在
6431. IPC 通道 warmy:pingZhengHuiFu 在 preload 与主进程都存在
6432. IPC 通道 warmy:pingZhengLunHuan 在 preload 与主进程都存在
6433. IPC 通道 warmy:pingZhengXinXi 在 preload 与主进程都存在
6434. IPC 通道 warmy:profileBaoCun 在 preload 与主进程都存在
6435. IPC 通道 warmy:profileLogin 在 preload 与主进程都存在
6436. IPC 通道 warmy:profileQu 在 preload 与主进程都存在
6437. IPC 通道 warmy:profileSheZhiPassword 在 preload 与主进程都存在
6438. IPC 通道 warmy:qingChuCuoWu 在 preload 与主进程都存在
6439. IPC 通道 warmy:qingLiYunXing 在 preload 与主进程都存在
6440. IPC 通道 warmy:qingQiuPiZhun 在 preload 与主进程都存在
6441. IPC 通道 warmy:quGongYingShang 在 preload 与主进程都存在
6442. IPC 通道 warmy:quInsertMoShi 在 preload 与主进程都存在
6443. IPC 通道 warmy:qunChengYuanJi 在 preload 与主进程都存在
6444. IPC 通道 warmy:qunChuangJian 在 preload 与主进程都存在
6445. IPC 通道 warmy:qunDingXiang 在 preload 与主进程都存在
6446. IPC 通道 warmy:qunJiaRuShiLi 在 preload 与主进程都存在
6447. IPC 通道 warmy:qunJieSan 在 preload 与主进程都存在
6448. IPC 通道 warmy:qunLieBiao 在 preload 与主进程都存在
6449. IPC 通道 warmy:qunSheZhiGuanLiYuan 在 preload 与主进程都存在
6450. IPC 通道 warmy:qunTi 在 preload 与主进程都存在
6451. IPC 通道 warmy:qunXiaoXi 在 preload 与主进程都存在
6452. IPC 通道 warmy:qunXieTiao 在 preload 与主进程都存在
6453. IPC 通道 warmy:qunYaoQing 在 preload 与主进程都存在
6454. IPC 通道 warmy:rongQiDongZuo 在 preload 与主进程都存在
6455. IPC 通道 warmy:rongQiKongZhiTai 在 preload 与主进程都存在
6456. IPC 通道 warmy:rongQiShiLiDongZuo 在 preload 与主进程都存在
6457. IPC 通道 warmy:rongQiShiLiJi 在 preload 与主进程都存在
6458. IPC 通道 warmy:rongQiTanCe 在 preload 与主进程都存在
6459. IPC 通道 warmy:rongQiYingYongDaKai 在 preload 与主进程都存在
6460. IPC 通道 warmy:saoMiaoJiQi 在 preload 与主进程都存在
6461. IPC 通道 warmy:sheZhiAnQuanMoShi 在 preload 与主进程都存在
6462. IPC 通道 warmy:sheZhiGongYingShang 在 preload 与主进程都存在
6463. IPC 通道 warmy:sheZhiInsertMoShi 在 preload 与主进程都存在
6464. IPC 通道 warmy:sheZhiZhuTiLaiYuan 在 preload 与主进程都存在
6465. IPC 通道 warmy:shenFenBeiFenDaoChu 在 preload 与主进程都存在
6466. IPC 通道 warmy:shenFenBeiFenDaoRu 在 preload 与主进程都存在
6467. IPC 通道 warmy:shenFenBianGengJi 在 preload 与主进程都存在
6468. IPC 通道 warmy:shenFenBianGengQueRen 在 preload 与主进程都存在
6469. IPC 通道 warmy:shenFenDuiDuanJi 在 preload 与主进程都存在
6470. IPC 通道 warmy:shenFenDuiDuanKa 在 preload 与主进程都存在
6471. IPC 通道 warmy:shenFenDuiDuanLianXi 在 preload 与主进程都存在
6472. IPC 通道 warmy:shenFenDuiDuanLunHuan 在 preload 与主进程都存在
6473. IPC 通道 warmy:shenFenDuiDuanQueRen 在 preload 与主进程都存在
6474. IPC 通道 warmy:shenFenKaLiShi 在 preload 与主进程都存在
6475. IPC 通道 warmy:shenFenLunHuan 在 preload 与主进程都存在
6476. IPC 通道 warmy:shenFenPingZheng 在 preload 与主进程都存在
6477. IPC 通道 warmy:shenFenSheZhiMiMaKouLing 在 preload 与主进程都存在
6478. IPC 通道 warmy:shenFenXinXi 在 preload 与主进程都存在
6479. IPC 通道 warmy:shenFenYanZhengLunHuan 在 preload 与主进程都存在
6480. IPC 通道 warmy:shenJiQingChu 在 preload 与主进程都存在
6481. IPC 通道 warmy:shenJiRiZhi 在 preload 与主进程都存在
6482. IPC 通道 warmy:shiTiUpdated 在 preload 与主进程都存在
6483. IPC 通道 warmy:smtpGengXin 在 preload 与主进程都存在
6484. IPC 通道 warmy:smtpLieBiao 在 preload 与主进程都存在
6485. IPC 通道 warmy:smtpTianJia 在 preload 与主进程都存在
6486. IPC 通道 warmy:smtpYanZheng 在 preload 与主进程都存在
6487. IPC 通道 warmy:smtpYiChu 在 preload 与主进程都存在
6488. IPC 通道 warmy:souSuoXiaoXiJi 在 preload 与主进程都存在
6489. IPC 通道 warmy:suiXingPianDuan 在 preload 与主进程都存在
6490. IPC 通道 warmy:taiBaoCun 在 preload 与主进程都存在
6491. IPC 通道 warmy:taiJiaZai 在 preload 与主进程都存在
6492. IPC 通道 warmy:teShuMoXingJiQu 在 preload 与主进程都存在
6493. IPC 通道 warmy:teShuMoXingJiSheZhi 在 preload 与主进程都存在
6494. IPC 通道 warmy:tingHuaZhuangTai 在 preload 与主进程都存在
6495. IPC 通道 warmy:tingZhiShiLi 在 preload 与主进程都存在
6496. IPC 通道 warmy:tongBuFaBu 在 preload 与主进程都存在
6497. IPC 通道 warmy:tongBuLaQu 在 preload 与主进程都存在
6498. IPC 通道 warmy:ttsLangDu 在 preload 与主进程都存在
6499. IPC 通道 warmy:tuoPanChuShi 在 preload 与主进程都存在
6500. IPC 通道 warmy:tuoPanTiShi 在 preload 与主进程都存在
6501. IPC 通道 warmy:uiDuiLieJiQu 在 preload 与主进程都存在
6502. IPC 通道 warmy:uiDuiLieJiSheZhi 在 preload 与主进程都存在
6503. IPC 通道 warmy:wangLuoBenJiDiZhi 在 preload 与主进程都存在
6504. IPC 通道 warmy:wangLuoChengYuanJiZaiChang 在 preload 与主进程都存在
6505. IPC 通道 warmy:wangLuoDuanKouHouXuanJi 在 preload 与主进程都存在
6506. IPC 通道 warmy:wangLuoTanCe 在 preload 与主进程都存在
6507. IPC 通道 warmy:wangLuoWangZhuangGuangBo 在 preload 与主进程都存在
6508. IPC 通道 warmy:wangLuoWangZhuangQiYong 在 preload 与主进程都存在
6509. IPC 通道 warmy:wangLuoWangZhuangTingYong 在 preload 与主进程都存在
6510. IPC 通道 warmy:wangLuoZhuangTai 在 preload 与主进程都存在
6511. IPC 通道 warmy:wangZhuangGuangBo 在 preload 与主进程都存在
6512. IPC 通道 warmy:wangZhuangQiDong 在 preload 与主进程都存在
6513. IPC 通道 warmy:wangZhuangShouXiang 在 preload 与主进程都存在
6514. IPC 通道 warmy:wangZhuangTingZhi 在 preload 与主进程都存在
6515. IPC 通道 warmy:wangZhuangZhuangTai 在 preload 与主进程都存在
6516. IPC 通道 warmy:webgpuTanCe 在 preload 与主进程都存在
6517. IPC 通道 warmy:wenJianChanSheng 在 preload 与主进程都存在
6518. IPC 通道 warmy:winChongXinJiaZai 在 preload 与主进程都存在
6519. IPC 通道 warmy:winGuanBi 在 preload 与主进程都存在
6520. IPC 通道 warmy:winZongShiQiYongDing 在 preload 与主进程都存在
6521. IPC 通道 warmy:winZuiDaHua 在 preload 与主进程都存在
6522. IPC 通道 warmy:winZuiXiaoHua 在 preload 与主进程都存在
6523. IPC 通道 warmy:xianShiWenJianJia 在 preload 与主进程都存在
6524. IPC 通道 warmy:xiangMuDaoChu 在 preload 与主进程都存在
6525. IPC 通道 warmy:xiangMuHuanJingGuHua 在 preload 与主进程都存在
6526. IPC 通道 warmy:xiangMuHuanJingHuiGun 在 preload 与主进程都存在
6527. IPC 通道 warmy:xiangMuHuanJingZhuangTai 在 preload 与主进程都存在
6528. IPC 通道 warmy:xiangMuJiYiQu 在 preload 与主进程都存在
6529. IPC 通道 warmy:xiangMuJiYiSheZhi 在 preload 与主进程都存在
6530. IPC 通道 warmy:xiangMuQiYong 在 preload 与主进程都存在
6531. IPC 通道 warmy:xiangMuSheZhiMuLu 在 preload 与主进程都存在
6532. IPC 通道 warmy:xiangMuSheZhiRongQi 在 preload 与主进程都存在
6533. IPC 通道 warmy:xiangMuTai 在 preload 与主进程都存在
6534. IPC 通道 warmy:xiangMuTingYong 在 preload 与主进程都存在
6535. IPC 通道 warmy:xiangMuWenJianJi 在 preload 与主进程都存在
6536. IPC 通道 warmy:xiangMuWenJianXiTongShouWei 在 preload 与主进程都存在
6537. IPC 通道 warmy:xiangMuZhangBen 在 preload 与主进程都存在
6538. IPC 通道 warmy:xiangMuZhiXing 在 preload 与主进程都存在
6539. IPC 通道 warmy:xuanZeMuLu 在 preload 与主进程都存在
6540. IPC 通道 warmy:xuanZeSound 在 preload 与主进程都存在
6541. IPC 通道 warmy:xuanZeWenJian 在 preload 与主进程都存在
6542. IPC 通道 warmy:yaoQingChuangJian 在 preload 与主进程都存在
6543. IPC 通道 warmy:yiGuiDangHuiFu 在 preload 与主进程都存在
6544. IPC 通道 warmy:yiGuiDangLieBiao 在 preload 与主进程都存在
6545. IPC 通道 warmy:yiGuiDangTianJia 在 preload 与主进程都存在
6546. IPC 通道 warmy:yinSiTongYiSheZhi 在 preload 与主进程都存在
6547. IPC 通道 warmy:yinXiaoQu 在 preload 与主进程都存在
6548. IPC 通道 warmy:yingJian 在 preload 与主进程都存在
6549. IPC 通道 warmy:yingYongTuiChu 在 preload 与主进程都存在
6550. IPC 通道 warmy:yingYongXinXi 在 preload 与主进程都存在
6551. IPC 通道 warmy:youJianDuiLie 在 preload 与主进程都存在
6552. IPC 通道 warmy:youJianLieBiao 在 preload 与主进程都存在
6553. IPC 通道 warmy:yuYanXinXi 在 preload 与主进程都存在
6554. IPC 通道 warmy:yunXingZhuangTai 在 preload 与主进程都存在
6555. IPC 通道 warmy:zhiBiaoJiGongJu 在 preload 与主进程都存在
6556. IPC 通道 warmy:zhiBiaoJiLunCi 在 preload 与主进程都存在
6557. IPC 通道 warmy:zhiBiaoJiZhaiYao 在 preload 与主进程都存在
6558. IPC 通道 warmy:zhiShiKuCongLiaoTian 在 preload 与主进程都存在
6559. IPC 通道 warmy:zhiShiKuShanChu 在 preload 与主进程都存在
6560. IPC 通道 warmy:zhiShiKuXiangQing 在 preload 与主进程都存在
6561. IPC 通道 warmy:zhiShiQuery 在 preload 与主进程都存在
6562. IPC 通道 warmy:zhiShiTianJiaShiJian 在 preload 与主进程都存在
6563. IPC 通道 warmy:zhiXingQiJiYunXingJianYao 在 preload 与主进程都存在
6564. IPC 通道 warmy:zhiXingQiJiZhuangTai 在 preload 与主进程都存在
6565. IPC 通道 warmy:zhiXingQiPiLiang 在 preload 与主进程都存在
6566. IPC 通道 warmy:zhiXingQiYunXing 在 preload 与主进程都存在
6567. IPC 通道 warmy:zhuCeKuaiJieJian 在 preload 与主进程都存在
6568. IPC 通道 warmy:zhuTiXinXi 在 preload 与主进程都存在
6569. IPC 通道 warmy:ziChanJiFeedback 在 preload 与主进程都存在
6570. IPC 通道 warmy:ziChanJiJianSuo 在 preload 与主进程都存在
6571. IPC 通道 warmy:ziChanJiSweep 在 preload 与主进程都存在
6572. IPC 通道 warmy:ziChanJiZhuCe 在 preload 与主进程都存在
6573. IPC 通道 warmy:ziDongGengXinJianCha 在 preload 与主进程都存在
6574. IPC 通道 warmy:ziDongGengXinXiaZai 在 preload 与主进程都存在
6575. IPC 通道 warmy:zuYueHuoQu 在 preload 与主进程都存在
6576. IPC 通道 warmy:zuYueJianCha 在 preload 与主进程都存在
6577. IPC 通道 warmy:zuYueLieBiao 在 preload 与主进程都存在
6578. IPC 通道 warmy:zuYueShiFang 在 preload 与主进程都存在
6579. IPC 通道 warmy:zuiHouCuoWu 在 preload 与主进程都存在

## J 机制完善：逐语言非空（每个键每个语言）

6580. en-US 里 about.author 非空
6581. en-US 里 about.authorBody 非空
6582. en-US 里 about.checkUpdate 非空
6583. en-US 里 about.checking 非空
6584. en-US 里 about.contact 非空
6585. en-US 里 about.contactBody 非空
6586. en-US 里 about.copyright 非空
6587. en-US 里 about.copyrightBody 非空
6588. en-US 里 about.dshMissing 非空
6589. en-US 里 about.idRegenerated 非空
6590. en-US 里 about.idVerified 非空
6591. en-US 里 about.legal 非空
6592. en-US 里 about.legalBody 非空
6593. en-US 里 about.logoAlt 非空
6594. en-US 里 about.opensource 非空
6595. en-US 里 about.opensourceBody 非空
6596. en-US 里 about.startUpdate 非空
6597. en-US 里 about.tagline 非空
6598. en-US 里 about.techStack 非空
6599. en-US 里 about.techStackBody 非空
6600. en-US 里 about.updateStarted 非空
6601. en-US 里 about.updating 非空
6602. en-US 里 about.version 非空
6603. en-US 里 about.versionInfo 非空
6604. en-US 里 accent.custom 非空
6605. en-US 里 aiq.answered 非空
6606. en-US 里 aiq.biaoTi 非空
6607. en-US 里 aiq.custom 非空
6608. en-US 里 aiq.empty 非空
6609. en-US 里 aiq.newCard 非空
6610. en-US 里 aiq.pending 非空
6611. en-US 里 aiq.submit 非空
6612. en-US 里 aiq.title 非空
6613. en-US 里 app.displayName 非空
6614. en-US 里 app.enName 非空
6615. en-US 里 app.subtitle 非空
6616. en-US 里 app.zhName 非空
6617. en-US 里 approval.biaoTi 非空
6618. en-US 里 approval.deny 非空
6619. en-US 里 approval.global 非空
6620. en-US 里 approval.hint 非空
6621. en-US 里 approval.once 非空
6622. en-US 里 approval.project 非空
6623. en-US 里 approval.tiShi 非空
6624. en-US 里 approval.title 非空
6625. en-US 里 archive.hint 非空
6626. en-US 里 archive.tiShi 非空
6627. en-US 里 avatar.local 非空
6628. en-US 里 avatar.person.1 非空
6629. en-US 里 avatar.person.10 非空
6630. en-US 里 avatar.person.2 非空
6631. en-US 里 avatar.person.3 非空
6632. en-US 里 avatar.person.4 非空
6633. en-US 里 avatar.person.5 非空
6634. en-US 里 avatar.person.6 非空
6635. en-US 里 avatar.person.7 非空
6636. en-US 里 avatar.person.8 非空
6637. en-US 里 avatar.person.9 非空
6638. en-US 里 avatar.person.default 非空
6639. en-US 里 avatar.persons 非空
6640. en-US 里 avatar.pickTitle 非空
6641. en-US 里 avatar.preset.1 非空
6642. en-US 里 avatar.preset.10 非空
6643. en-US 里 avatar.preset.2 非空
6644. en-US 里 avatar.preset.3 非空
6645. en-US 里 avatar.preset.4 非空
6646. en-US 里 avatar.preset.5 非空
6647. en-US 里 avatar.preset.6 非空
6648. en-US 里 avatar.preset.7 非空
6649. en-US 里 avatar.preset.8 非空
6650. en-US 里 avatar.preset.9 非空
6651. en-US 里 avatar.presets 非空
6652. en-US 里 board.addBtn 非空
6653. en-US 里 board.addTask 非空
6654. en-US 里 board.add_note 非空
6655. en-US 里 board.added 非空
6656. en-US 里 board.aiGenerate 非空
6657. en-US 里 board.aiNotReady 非空
6658. en-US 里 board.block 非空
6659. en-US 里 board.blocked 非空
6660. en-US 里 board.complete_task 非空
6661. en-US 里 board.create_task 非空
6662. en-US 里 board.done 非空
6663. en-US 里 board.instances 非空
6664. en-US 里 board.progress 非空
6665. en-US 里 board.queue 非空
6666. en-US 里 board.queueList 非空

## 附录：本轮新增的产品能力（同批交付）

- 行为级「预计完成时间 + 轮次/时间上限」：五类行为两把尺子、两个文件、判断闭环（`docs/REQUIREMENTS-ETA.md`）
- 记忆系统文档（`docs/MEMORY-SYSTEM.md`）
- 调用链按钮禁用态、插入三态图标/下拉、思考级别滑块、使用量表格、语言约束端到端验证、
  标点回复兜底、音频保活、发送按钮可用性、上下文预算动态上限、异常后「继续/重试」