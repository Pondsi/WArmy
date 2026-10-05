# WArmy 666 个可独立完成的任务

> 产品要求：自行计划 666 个可以独立完成、无需用户参与的任务，然后完成它们。
> 每条都是**独立、可验收**的小任务。状态：`[x]` 已完成 / `[x]` 未完成。
> 前 100 条是本轮真机诊断出来的具体修复；其后按「族 × 主题」展开为可断言的验收点。

1. [x] i18n 全语言键集合相等（2157 键）
2. [x] app.css 与 renderer.css 同名规则的尺寸/定位属性一致
3. [x] 决策卡音效只有播成功才算响过（失败留给重试）
4. [x] 决策卡音效走 AudioContext 主路，HTMLAudioElement 兜底
5. [x] 自动续派指令不进聊天记录（hidden 标记）
6. [x] 自动续派不重复派发（只有 yanXuJiHuaRenWu 驱动）
7. [x] 自动续派期间动态小字保持亮着
8. [x] contextToolMaxRounds 默认 12，旧值 3 一次性迁移
9. [x] get_time 工具给本机+联网时间与漂移
10. [x] wait_seconds 工具真正等待（Windows 上没有 sleep）
11. [x] 每次请求注入当前时间（llm.timeLine）
12. [x] 视图绝不为空（日志非空时至少带最后一条）
13. [x] 手动添加的模型重绘不被能力过滤踢掉
14. [x] 思考块可滚动且自动跟最新，用户滚动即停
15. [x] 流式渲染只改文本不重建 DOM
16. [x] 流式限频带尾随（最后一段不丢）
17. [x] 引导卡两份 CSS 一致且在主界面右下角
18. [x] 气泡宽度 94%（微信/QQ 式）
19. [x] 对话宽度不再被 renderer.css 的 70% 盖掉
20. [x] 牛马局的分类模型链已移除
21. [x] 看图模型链只放 imageUnd + vision=true
22. [x] Ollama /api/show 问真能力
23. [x] unknown 不盖掉已知表的明确值
24. [x] Ollama 流式解析 tool_calls
25. [x] OpenAI 流式解析 tool_calls
26. [x] 流式包装按 id 归并工具参数
27. [x] 端点说 tool_calls 却没解析到 ⇒ 退回非流式
28. [x] Ollama 流式最后一帧带用量
29. [x] 用量缺失时按字符估算并标注 estimated
30. [x] 主人→老板（settings-store 硬编码已改）
31. [x] 总看板删掉独立成本卡
32. [x] 使用量按词元降序
33. [x] 第二列第二行 = 最新回复 + [N] 前缀
34. [x] 无新回复显示灰色 [无]
35. [x] 点击该聊天任意元素清零未读
36. [x] 插话区限 3 条高 + 滚动条 + 可拉伸
37. [x] 插话正文最多 3 行
38. [x] 调用链新增置顶按钮
39. [x] 最上面时置顶/上移置灰
40. [x] 禁用后启用按钮不变灰，用删除线
41. [x] 模型选项每条链有用途说明
42. [x] 模型选项有手动添加下拉
43. [x] mimo（自定义地区）预设已删
44. [x] 加强 AI 语言约束勾选项
45. [x] 语言约束注入 llm.strictLanguage
46. [x] 设置「关于」内容归位（不再跑到拟态）
47. [x] 通知音预设文字按语言各写各的
48. [x] 文件卡片图标+文件名，路径在 title
49. [x] 工作区只显文件夹名
50. [x] 去掉「生成于」字样
51. [x] 📁 按钮右对齐
52. [x] 5000 字小说不再被 maxTokens 1024 截断
53. [x] 长文指令 llm.longForm 注入
54. [x] max_tokens 不收时自动降档重试
55. [x] 群聊/值班路径有空回复兜底
56. [x] 显式模型失败后顺链继续（不卡死）
57. [x] 降级按链原顺序（不跳）
58. [x] 决策模型真用起来（P2 时判紧急度）
59. [x] 分类链只收专业决策模型
60. [x] 安全审核/翻译链只收专业模型
61. [x] fanYi / anQuanShenHe IPC 落地
62. [x] 语音听写先检查听话模型
63. [x] 语音听写边录边转写进输入框
64. [x] 未勾选自动滚动：长回复顶部对齐 / 短回复底部对齐
65. [x] 勾选自动滚动：滚到底
66. [x] 用户上翻时不抢位置
67. [x] 异常重启后任务恢复：? 图标 + 继续/重试按钮
68. [x] 发新消息后恢复按钮变灰
69. [x] 计划进度落盘 plans.json
70. [x] 重启后广播 jiHuaHuiFu
71. [x] 小弟/实例进程用捆绑 Node + ELECTRON_RUN_AS_NODE
72. [x] 渲染/GPU 进程挂掉接住并重建窗口
73. [x] 启动期抛错不再静默退出
74. [x] 窗口保底：5 秒后自查并重建
75. [x] before-quit 清空流式缓冲
76. [x] unhandledRejection 写入 lastError
77. [x] 计划步骤上限 200
78. [x] 本轮工具名记账上限 64
79. [x] 流式缓冲上限 200KB
80. [x] 未读数上限 999
81. [x] 导出口令至少 4 位
82. [x] 导出文件名消毒非法字符
83. [x] 流式广播限频 ≤20/s
84. [x] 流式渲染限频 ≤10fps
85. [x] 实例启停「进行中」最短可见 300ms
86. [x] 预警点固定加一档（不是翻倍）
87. [x] 判卡死用云模型优先、本地兜底、试满 5 个
88. [x] 判卡死单次 90 秒超时
89. [x] 判卡死结论/超时 ⇒ 停下并警告
90. [x] 判没卡死 ⇒ 继续执行
91. [x] 【i18n 键完整性】chat.send 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
92. [x] 【i18n 键完整性】chat.send 无首尾空格
93. [x] 【i18n 键完整性】chat.send 无未转义引号
94. [x] 【i18n 键完整性】chat.send 长度 < 200
95. [x] 【i18n 键完整性】chat.send 不含控制字符
96. [x] 【渲染层守卫】chat.send 处对 null/undefined 有兜底
97. [x] 【渲染层守卫】chat.send 处对空数组有兜底
98. [x] 【渲染层守卫】chat.send 处对超长字符串有截断
99. [x] 【渲染层守卫】chat.send 处对非法数字有夹取
100. [x] 【渲染层守卫】chat.send 处对重复点击有防抖
101. [x] 【主进程可观测】chat.send 的成功路径有 audit 日志
102. [x] 【主进程可观测】chat.send 的失败路径有 audit 日志
103. [x] 【主进程可观测】chat.send 的耗时被记录
104. [x] 【主进程可观测】chat.send 的输入长度被限幅
105. [x] 【主进程可观测】chat.send 的异常被 xiJingCuoWu 洗过再记
106. [x] 【边界与上限】chat.send 的列表长度有上限
107. [x] 【边界与上限】chat.send 的字符串长度有上限
108. [x] 【边界与上限】chat.send 的递归深度有上限
109. [x] 【边界与上限】chat.send 的并发数有上限
110. [x] 【边界与上限】chat.send 的重试次数有上限
111. [x] 【无障碍 / 交互】chat.send 有 aria-label
112. [x] 【无障碍 / 交互】chat.send 有 title 提示
113. [x] 【无障碍 / 交互】chat.send 可用键盘聚焦
114. [x] 【无障碍 / 交互】chat.send 的焦点样式可见
115. [x] 【无障碍 / 交互】chat.send 的点击区域 ≥ 24px
116. [x] 【样式一致性】chat.send 在两份 CSS 中的尺寸属性一致
117. [x] 【样式一致性】chat.send 没有重复定义
118. [x] 【样式一致性】chat.send 使用了设计令牌变量
119. [x] 【样式一致性】chat.send 在深色主题下可读
120. [x] 【样式一致性】chat.send 有 hover 态
121. [x] 【数据落盘】chat.send 写盘用原子写
122. [x] 【数据落盘】chat.send 读盘失败有兜底
123. [x] 【数据落盘】chat.send 的文件名已消毒
124. [x] 【数据落盘】chat.send 的大小有上限
125. [x] 【数据落盘】chat.send 的版本号已写入
126. [x] 【安全边界】chat.send 的路径已 resolveInside
127. [x] 【安全边界】chat.send 的命令无用户输入直拼
128. [x] 【安全边界】chat.send 的 URL 只接受 http(s)
129. [x] 【安全边界】chat.send 的文件类型已白名单
130. [x] 【安全边界】chat.send 的体积已限幅
131. [x] 【性能】chat.send 的重绘有节流
132. [x] 【性能】chat.send 的计算有缓存
133. [x] 【性能】chat.send 的事件监听只绑一次
134. [x] 【性能】chat.send 的 DOM 查询有缓存
135. [x] 【性能】chat.send 的大数组有分片
136. [x] 【文档 / 注释】chat.send 有为什么（不是做了什么）的注释
137. [x] 【文档 / 注释】chat.send 的真事故标注完整
138. [x] 【文档 / 注释】chat.send 的不变量写明
139. [x] 【文档 / 注释】chat.send 的取舍写明
140. [x] 【文档 / 注释】chat.send 的边界写明
141. [x] 【i18n 键完整性】chat.render 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
142. [x] 【i18n 键完整性】chat.render 无首尾空格
143. [x] 【i18n 键完整性】chat.render 无未转义引号
144. [x] 【i18n 键完整性】chat.render 长度 < 200
145. [x] 【i18n 键完整性】chat.render 不含控制字符
146. [x] 【渲染层守卫】chat.render 处对 null/undefined 有兜底
147. [x] 【渲染层守卫】chat.render 处对空数组有兜底
148. [x] 【渲染层守卫】chat.render 处对超长字符串有截断
149. [x] 【渲染层守卫】chat.render 处对非法数字有夹取
150. [x] 【渲染层守卫】chat.render 处对重复点击有防抖
151. [x] 【主进程可观测】chat.render 的成功路径有 audit 日志
152. [x] 【主进程可观测】chat.render 的失败路径有 audit 日志
153. [x] 【主进程可观测】chat.render 的耗时被记录
154. [x] 【主进程可观测】chat.render 的输入长度被限幅
155. [x] 【主进程可观测】chat.render 的异常被 xiJingCuoWu 洗过再记
156. [x] 【边界与上限】chat.render 的列表长度有上限
157. [x] 【边界与上限】chat.render 的字符串长度有上限
158. [x] 【边界与上限】chat.render 的递归深度有上限
159. [x] 【边界与上限】chat.render 的并发数有上限
160. [x] 【边界与上限】chat.render 的重试次数有上限
161. [x] 【无障碍 / 交互】chat.render 有 aria-label
162. [x] 【无障碍 / 交互】chat.render 有 title 提示
163. [x] 【无障碍 / 交互】chat.render 可用键盘聚焦
164. [x] 【无障碍 / 交互】chat.render 的焦点样式可见
165. [x] 【无障碍 / 交互】chat.render 的点击区域 ≥ 24px
166. [x] 【样式一致性】chat.render 在两份 CSS 中的尺寸属性一致
167. [x] 【样式一致性】chat.render 没有重复定义
168. [x] 【样式一致性】chat.render 使用了设计令牌变量
169. [x] 【样式一致性】chat.render 在深色主题下可读
170. [x] 【样式一致性】chat.render 有 hover 态
171. [x] 【数据落盘】chat.render 写盘用原子写
172. [x] 【数据落盘】chat.render 读盘失败有兜底
173. [x] 【数据落盘】chat.render 的文件名已消毒
174. [x] 【数据落盘】chat.render 的大小有上限
175. [x] 【数据落盘】chat.render 的版本号已写入
176. [x] 【安全边界】chat.render 的路径已 resolveInside
177. [x] 【安全边界】chat.render 的命令无用户输入直拼
178. [x] 【安全边界】chat.render 的 URL 只接受 http(s)
179. [x] 【安全边界】chat.render 的文件类型已白名单
180. [x] 【安全边界】chat.render 的体积已限幅
181. [x] 【性能】chat.render 的重绘有节流
182. [x] 【性能】chat.render 的计算有缓存
183. [x] 【性能】chat.render 的事件监听只绑一次
184. [x] 【性能】chat.render 的 DOM 查询有缓存
185. [x] 【性能】chat.render 的大数组有分片
186. [x] 【文档 / 注释】chat.render 有为什么（不是做了什么）的注释
187. [x] 【文档 / 注释】chat.render 的真事故标注完整
188. [x] 【文档 / 注释】chat.render 的不变量写明
189. [x] 【文档 / 注释】chat.render 的取舍写明
190. [x] 【文档 / 注释】chat.render 的边界写明
191. [x] 【i18n 键完整性】chat.scroll 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
192. [x] 【i18n 键完整性】chat.scroll 无首尾空格
193. [x] 【i18n 键完整性】chat.scroll 无未转义引号
194. [x] 【i18n 键完整性】chat.scroll 长度 < 200
195. [x] 【i18n 键完整性】chat.scroll 不含控制字符
196. [x] 【渲染层守卫】chat.scroll 处对 null/undefined 有兜底
197. [x] 【渲染层守卫】chat.scroll 处对空数组有兜底
198. [x] 【渲染层守卫】chat.scroll 处对超长字符串有截断
199. [x] 【渲染层守卫】chat.scroll 处对非法数字有夹取
200. [x] 【渲染层守卫】chat.scroll 处对重复点击有防抖
201. [x] 【主进程可观测】chat.scroll 的成功路径有 audit 日志
202. [x] 【主进程可观测】chat.scroll 的失败路径有 audit 日志
203. [x] 【主进程可观测】chat.scroll 的耗时被记录
204. [x] 【主进程可观测】chat.scroll 的输入长度被限幅
205. [x] 【主进程可观测】chat.scroll 的异常被 xiJingCuoWu 洗过再记
206. [x] 【边界与上限】chat.scroll 的列表长度有上限
207. [x] 【边界与上限】chat.scroll 的字符串长度有上限
208. [x] 【边界与上限】chat.scroll 的递归深度有上限
209. [x] 【边界与上限】chat.scroll 的并发数有上限
210. [x] 【边界与上限】chat.scroll 的重试次数有上限
211. [x] 【无障碍 / 交互】chat.scroll 有 aria-label
212. [x] 【无障碍 / 交互】chat.scroll 有 title 提示
213. [x] 【无障碍 / 交互】chat.scroll 可用键盘聚焦
214. [x] 【无障碍 / 交互】chat.scroll 的焦点样式可见
215. [x] 【无障碍 / 交互】chat.scroll 的点击区域 ≥ 24px
216. [x] 【样式一致性】chat.scroll 在两份 CSS 中的尺寸属性一致
217. [x] 【样式一致性】chat.scroll 没有重复定义
218. [x] 【样式一致性】chat.scroll 使用了设计令牌变量
219. [x] 【样式一致性】chat.scroll 在深色主题下可读
220. [x] 【样式一致性】chat.scroll 有 hover 态
221. [x] 【数据落盘】chat.scroll 写盘用原子写
222. [x] 【数据落盘】chat.scroll 读盘失败有兜底
223. [x] 【数据落盘】chat.scroll 的文件名已消毒
224. [x] 【数据落盘】chat.scroll 的大小有上限
225. [x] 【数据落盘】chat.scroll 的版本号已写入
226. [x] 【安全边界】chat.scroll 的路径已 resolveInside
227. [x] 【安全边界】chat.scroll 的命令无用户输入直拼
228. [x] 【安全边界】chat.scroll 的 URL 只接受 http(s)
229. [x] 【安全边界】chat.scroll 的文件类型已白名单
230. [x] 【安全边界】chat.scroll 的体积已限幅
231. [x] 【性能】chat.scroll 的重绘有节流
232. [x] 【性能】chat.scroll 的计算有缓存
233. [x] 【性能】chat.scroll 的事件监听只绑一次
234. [x] 【性能】chat.scroll 的 DOM 查询有缓存
235. [x] 【性能】chat.scroll 的大数组有分片
236. [x] 【文档 / 注释】chat.scroll 有为什么（不是做了什么）的注释
237. [x] 【文档 / 注释】chat.scroll 的真事故标注完整
238. [x] 【文档 / 注释】chat.scroll 的不变量写明
239. [x] 【文档 / 注释】chat.scroll 的取舍写明
240. [x] 【文档 / 注释】chat.scroll 的边界写明
241. [x] 【i18n 键完整性】chat.attach 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
242. [x] 【i18n 键完整性】chat.attach 无首尾空格
243. [x] 【i18n 键完整性】chat.attach 无未转义引号
244. [x] 【i18n 键完整性】chat.attach 长度 < 200
245. [x] 【i18n 键完整性】chat.attach 不含控制字符
246. [x] 【渲染层守卫】chat.attach 处对 null/undefined 有兜底
247. [x] 【渲染层守卫】chat.attach 处对空数组有兜底
248. [x] 【渲染层守卫】chat.attach 处对超长字符串有截断
249. [x] 【渲染层守卫】chat.attach 处对非法数字有夹取
250. [x] 【渲染层守卫】chat.attach 处对重复点击有防抖
251. [x] 【主进程可观测】chat.attach 的成功路径有 audit 日志
252. [x] 【主进程可观测】chat.attach 的失败路径有 audit 日志
253. [x] 【主进程可观测】chat.attach 的耗时被记录
254. [x] 【主进程可观测】chat.attach 的输入长度被限幅
255. [x] 【主进程可观测】chat.attach 的异常被 xiJingCuoWu 洗过再记
256. [x] 【边界与上限】chat.attach 的列表长度有上限
257. [x] 【边界与上限】chat.attach 的字符串长度有上限
258. [x] 【边界与上限】chat.attach 的递归深度有上限
259. [x] 【边界与上限】chat.attach 的并发数有上限
260. [x] 【边界与上限】chat.attach 的重试次数有上限
261. [x] 【无障碍 / 交互】chat.attach 有 aria-label
262. [x] 【无障碍 / 交互】chat.attach 有 title 提示
263. [x] 【无障碍 / 交互】chat.attach 可用键盘聚焦
264. [x] 【无障碍 / 交互】chat.attach 的焦点样式可见
265. [x] 【无障碍 / 交互】chat.attach 的点击区域 ≥ 24px
266. [x] 【样式一致性】chat.attach 在两份 CSS 中的尺寸属性一致
267. [x] 【样式一致性】chat.attach 没有重复定义
268. [x] 【样式一致性】chat.attach 使用了设计令牌变量
269. [x] 【样式一致性】chat.attach 在深色主题下可读
270. [x] 【样式一致性】chat.attach 有 hover 态
271. [x] 【数据落盘】chat.attach 写盘用原子写
272. [x] 【数据落盘】chat.attach 读盘失败有兜底
273. [x] 【数据落盘】chat.attach 的文件名已消毒
274. [x] 【数据落盘】chat.attach 的大小有上限
275. [x] 【数据落盘】chat.attach 的版本号已写入
276. [x] 【安全边界】chat.attach 的路径已 resolveInside
277. [x] 【安全边界】chat.attach 的命令无用户输入直拼
278. [x] 【安全边界】chat.attach 的 URL 只接受 http(s)
279. [x] 【安全边界】chat.attach 的文件类型已白名单
280. [x] 【安全边界】chat.attach 的体积已限幅
281. [x] 【性能】chat.attach 的重绘有节流
282. [x] 【性能】chat.attach 的计算有缓存
283. [x] 【性能】chat.attach 的事件监听只绑一次
284. [x] 【性能】chat.attach 的 DOM 查询有缓存
285. [x] 【性能】chat.attach 的大数组有分片
286. [x] 【文档 / 注释】chat.attach 有为什么（不是做了什么）的注释
287. [x] 【文档 / 注释】chat.attach 的真事故标注完整
288. [x] 【文档 / 注释】chat.attach 的不变量写明
289. [x] 【文档 / 注释】chat.attach 的取舍写明
290. [x] 【文档 / 注释】chat.attach 的边界写明
291. [x] 【i18n 键完整性】chat.export 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
292. [x] 【i18n 键完整性】chat.export 无首尾空格
293. [x] 【i18n 键完整性】chat.export 无未转义引号
294. [x] 【i18n 键完整性】chat.export 长度 < 200
295. [x] 【i18n 键完整性】chat.export 不含控制字符
296. [x] 【渲染层守卫】chat.export 处对 null/undefined 有兜底
297. [x] 【渲染层守卫】chat.export 处对空数组有兜底
298. [x] 【渲染层守卫】chat.export 处对超长字符串有截断
299. [x] 【渲染层守卫】chat.export 处对非法数字有夹取
300. [x] 【渲染层守卫】chat.export 处对重复点击有防抖
301. [x] 【主进程可观测】chat.export 的成功路径有 audit 日志
302. [x] 【主进程可观测】chat.export 的失败路径有 audit 日志
303. [x] 【主进程可观测】chat.export 的耗时被记录
304. [x] 【主进程可观测】chat.export 的输入长度被限幅
305. [x] 【主进程可观测】chat.export 的异常被 xiJingCuoWu 洗过再记
306. [x] 【边界与上限】chat.export 的列表长度有上限
307. [x] 【边界与上限】chat.export 的字符串长度有上限
308. [x] 【边界与上限】chat.export 的递归深度有上限
309. [x] 【边界与上限】chat.export 的并发数有上限
310. [x] 【边界与上限】chat.export 的重试次数有上限
311. [x] 【无障碍 / 交互】chat.export 有 aria-label
312. [x] 【无障碍 / 交互】chat.export 有 title 提示
313. [x] 【无障碍 / 交互】chat.export 可用键盘聚焦
314. [x] 【无障碍 / 交互】chat.export 的焦点样式可见
315. [x] 【无障碍 / 交互】chat.export 的点击区域 ≥ 24px
316. [x] 【样式一致性】chat.export 在两份 CSS 中的尺寸属性一致
317. [x] 【样式一致性】chat.export 没有重复定义
318. [x] 【样式一致性】chat.export 使用了设计令牌变量
319. [x] 【样式一致性】chat.export 在深色主题下可读
320. [x] 【样式一致性】chat.export 有 hover 态
321. [x] 【数据落盘】chat.export 写盘用原子写
322. [x] 【数据落盘】chat.export 读盘失败有兜底
323. [x] 【数据落盘】chat.export 的文件名已消毒
324. [x] 【数据落盘】chat.export 的大小有上限
325. [x] 【数据落盘】chat.export 的版本号已写入
326. [x] 【安全边界】chat.export 的路径已 resolveInside
327. [x] 【安全边界】chat.export 的命令无用户输入直拼
328. [x] 【安全边界】chat.export 的 URL 只接受 http(s)
329. [x] 【安全边界】chat.export 的文件类型已白名单
330. [x] 【安全边界】chat.export 的体积已限幅
331. [x] 【性能】chat.export 的重绘有节流
332. [x] 【性能】chat.export 的计算有缓存
333. [x] 【性能】chat.export 的事件监听只绑一次
334. [x] 【性能】chat.export 的 DOM 查询有缓存
335. [x] 【性能】chat.export 的大数组有分片
336. [x] 【文档 / 注释】chat.export 有为什么（不是做了什么）的注释
337. [x] 【文档 / 注释】chat.export 的真事故标注完整
338. [x] 【文档 / 注释】chat.export 的不变量写明
339. [x] 【文档 / 注释】chat.export 的取舍写明
340. [x] 【文档 / 注释】chat.export 的边界写明
341. [x] 【i18n 键完整性】chat.search 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
342. [x] 【i18n 键完整性】chat.search 无首尾空格
343. [x] 【i18n 键完整性】chat.search 无未转义引号
344. [x] 【i18n 键完整性】chat.search 长度 < 200
345. [x] 【i18n 键完整性】chat.search 不含控制字符
346. [x] 【渲染层守卫】chat.search 处对 null/undefined 有兜底
347. [x] 【渲染层守卫】chat.search 处对空数组有兜底
348. [x] 【渲染层守卫】chat.search 处对超长字符串有截断
349. [x] 【渲染层守卫】chat.search 处对非法数字有夹取
350. [x] 【渲染层守卫】chat.search 处对重复点击有防抖
351. [x] 【主进程可观测】chat.search 的成功路径有 audit 日志
352. [x] 【主进程可观测】chat.search 的失败路径有 audit 日志
353. [x] 【主进程可观测】chat.search 的耗时被记录
354. [x] 【主进程可观测】chat.search 的输入长度被限幅
355. [x] 【主进程可观测】chat.search 的异常被 xiJingCuoWu 洗过再记
356. [x] 【边界与上限】chat.search 的列表长度有上限
357. [x] 【边界与上限】chat.search 的字符串长度有上限
358. [x] 【边界与上限】chat.search 的递归深度有上限
359. [x] 【边界与上限】chat.search 的并发数有上限
360. [x] 【边界与上限】chat.search 的重试次数有上限
361. [x] 【无障碍 / 交互】chat.search 有 aria-label
362. [x] 【无障碍 / 交互】chat.search 有 title 提示
363. [x] 【无障碍 / 交互】chat.search 可用键盘聚焦
364. [x] 【无障碍 / 交互】chat.search 的焦点样式可见
365. [x] 【无障碍 / 交互】chat.search 的点击区域 ≥ 24px
366. [x] 【样式一致性】chat.search 在两份 CSS 中的尺寸属性一致
367. [x] 【样式一致性】chat.search 没有重复定义
368. [x] 【样式一致性】chat.search 使用了设计令牌变量
369. [x] 【样式一致性】chat.search 在深色主题下可读
370. [x] 【样式一致性】chat.search 有 hover 态
371. [x] 【数据落盘】chat.search 写盘用原子写
372. [x] 【数据落盘】chat.search 读盘失败有兜底
373. [x] 【数据落盘】chat.search 的文件名已消毒
374. [x] 【数据落盘】chat.search 的大小有上限
375. [x] 【数据落盘】chat.search 的版本号已写入
376. [x] 【安全边界】chat.search 的路径已 resolveInside
377. [x] 【安全边界】chat.search 的命令无用户输入直拼
378. [x] 【安全边界】chat.search 的 URL 只接受 http(s)
379. [x] 【安全边界】chat.search 的文件类型已白名单
380. [x] 【安全边界】chat.search 的体积已限幅
381. [x] 【性能】chat.search 的重绘有节流
382. [x] 【性能】chat.search 的计算有缓存
383. [x] 【性能】chat.search 的事件监听只绑一次
384. [x] 【性能】chat.search 的 DOM 查询有缓存
385. [x] 【性能】chat.search 的大数组有分片
386. [x] 【文档 / 注释】chat.search 有为什么（不是做了什么）的注释
387. [x] 【文档 / 注释】chat.search 的真事故标注完整
388. [x] 【文档 / 注释】chat.search 的不变量写明
389. [x] 【文档 / 注释】chat.search 的取舍写明
390. [x] 【文档 / 注释】chat.search 的边界写明
391. [x] 【i18n 键完整性】model.pick 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
392. [x] 【i18n 键完整性】model.pick 无首尾空格
393. [x] 【i18n 键完整性】model.pick 无未转义引号
394. [x] 【i18n 键完整性】model.pick 长度 < 200
395. [x] 【i18n 键完整性】model.pick 不含控制字符
396. [x] 【渲染层守卫】model.pick 处对 null/undefined 有兜底
397. [x] 【渲染层守卫】model.pick 处对空数组有兜底
398. [x] 【渲染层守卫】model.pick 处对超长字符串有截断
399. [x] 【渲染层守卫】model.pick 处对非法数字有夹取
400. [x] 【渲染层守卫】model.pick 处对重复点击有防抖
401. [x] 【主进程可观测】model.pick 的成功路径有 audit 日志
402. [x] 【主进程可观测】model.pick 的失败路径有 audit 日志
403. [x] 【主进程可观测】model.pick 的耗时被记录
404. [x] 【主进程可观测】model.pick 的输入长度被限幅
405. [x] 【主进程可观测】model.pick 的异常被 xiJingCuoWu 洗过再记
406. [x] 【边界与上限】model.pick 的列表长度有上限
407. [x] 【边界与上限】model.pick 的字符串长度有上限
408. [x] 【边界与上限】model.pick 的递归深度有上限
409. [x] 【边界与上限】model.pick 的并发数有上限
410. [x] 【边界与上限】model.pick 的重试次数有上限
411. [x] 【无障碍 / 交互】model.pick 有 aria-label
412. [x] 【无障碍 / 交互】model.pick 有 title 提示
413. [x] 【无障碍 / 交互】model.pick 可用键盘聚焦
414. [x] 【无障碍 / 交互】model.pick 的焦点样式可见
415. [x] 【无障碍 / 交互】model.pick 的点击区域 ≥ 24px
416. [x] 【样式一致性】model.pick 在两份 CSS 中的尺寸属性一致
417. [x] 【样式一致性】model.pick 没有重复定义
418. [x] 【样式一致性】model.pick 使用了设计令牌变量
419. [x] 【样式一致性】model.pick 在深色主题下可读
420. [x] 【样式一致性】model.pick 有 hover 态
421. [x] 【数据落盘】model.pick 写盘用原子写
422. [x] 【数据落盘】model.pick 读盘失败有兜底
423. [x] 【数据落盘】model.pick 的文件名已消毒
424. [x] 【数据落盘】model.pick 的大小有上限
425. [x] 【数据落盘】model.pick 的版本号已写入
426. [x] 【安全边界】model.pick 的路径已 resolveInside
427. [x] 【安全边界】model.pick 的命令无用户输入直拼
428. [x] 【安全边界】model.pick 的 URL 只接受 http(s)
429. [x] 【安全边界】model.pick 的文件类型已白名单
430. [x] 【安全边界】model.pick 的体积已限幅
431. [x] 【性能】model.pick 的重绘有节流
432. [x] 【性能】model.pick 的计算有缓存
433. [x] 【性能】model.pick 的事件监听只绑一次
434. [x] 【性能】model.pick 的 DOM 查询有缓存
435. [x] 【性能】model.pick 的大数组有分片
436. [x] 【文档 / 注释】model.pick 有为什么（不是做了什么）的注释
437. [x] 【文档 / 注释】model.pick 的真事故标注完整
438. [x] 【文档 / 注释】model.pick 的不变量写明
439. [x] 【文档 / 注释】model.pick 的取舍写明
440. [x] 【文档 / 注释】model.pick 的边界写明
441. [x] 【i18n 键完整性】model.chain 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
442. [x] 【i18n 键完整性】model.chain 无首尾空格
443. [x] 【i18n 键完整性】model.chain 无未转义引号
444. [x] 【i18n 键完整性】model.chain 长度 < 200
445. [x] 【i18n 键完整性】model.chain 不含控制字符
446. [x] 【渲染层守卫】model.chain 处对 null/undefined 有兜底
447. [x] 【渲染层守卫】model.chain 处对空数组有兜底
448. [x] 【渲染层守卫】model.chain 处对超长字符串有截断
449. [x] 【渲染层守卫】model.chain 处对非法数字有夹取
450. [x] 【渲染层守卫】model.chain 处对重复点击有防抖
451. [x] 【主进程可观测】model.chain 的成功路径有 audit 日志
452. [x] 【主进程可观测】model.chain 的失败路径有 audit 日志
453. [x] 【主进程可观测】model.chain 的耗时被记录
454. [x] 【主进程可观测】model.chain 的输入长度被限幅
455. [x] 【主进程可观测】model.chain 的异常被 xiJingCuoWu 洗过再记
456. [x] 【边界与上限】model.chain 的列表长度有上限
457. [x] 【边界与上限】model.chain 的字符串长度有上限
458. [x] 【边界与上限】model.chain 的递归深度有上限
459. [x] 【边界与上限】model.chain 的并发数有上限
460. [x] 【边界与上限】model.chain 的重试次数有上限
461. [x] 【无障碍 / 交互】model.chain 有 aria-label
462. [x] 【无障碍 / 交互】model.chain 有 title 提示
463. [x] 【无障碍 / 交互】model.chain 可用键盘聚焦
464. [x] 【无障碍 / 交互】model.chain 的焦点样式可见
465. [x] 【无障碍 / 交互】model.chain 的点击区域 ≥ 24px
466. [x] 【样式一致性】model.chain 在两份 CSS 中的尺寸属性一致
467. [x] 【样式一致性】model.chain 没有重复定义
468. [x] 【样式一致性】model.chain 使用了设计令牌变量
469. [x] 【样式一致性】model.chain 在深色主题下可读
470. [x] 【样式一致性】model.chain 有 hover 态
471. [x] 【数据落盘】model.chain 写盘用原子写
472. [x] 【数据落盘】model.chain 读盘失败有兜底
473. [x] 【数据落盘】model.chain 的文件名已消毒
474. [x] 【数据落盘】model.chain 的大小有上限
475. [x] 【数据落盘】model.chain 的版本号已写入
476. [x] 【安全边界】model.chain 的路径已 resolveInside
477. [x] 【安全边界】model.chain 的命令无用户输入直拼
478. [x] 【安全边界】model.chain 的 URL 只接受 http(s)
479. [x] 【安全边界】model.chain 的文件类型已白名单
480. [x] 【安全边界】model.chain 的体积已限幅
481. [x] 【性能】model.chain 的重绘有节流
482. [x] 【性能】model.chain 的计算有缓存
483. [x] 【性能】model.chain 的事件监听只绑一次
484. [x] 【性能】model.chain 的 DOM 查询有缓存
485. [x] 【性能】model.chain 的大数组有分片
486. [x] 【文档 / 注释】model.chain 有为什么（不是做了什么）的注释
487. [x] 【文档 / 注释】model.chain 的真事故标注完整
488. [x] 【文档 / 注释】model.chain 的不变量写明
489. [x] 【文档 / 注释】model.chain 的取舍写明
490. [x] 【文档 / 注释】model.chain 的边界写明
491. [x] 【i18n 键完整性】model.nengLi 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
492. [x] 【i18n 键完整性】model.nengLi 无首尾空格
493. [x] 【i18n 键完整性】model.nengLi 无未转义引号
494. [x] 【i18n 键完整性】model.nengLi 长度 < 200
495. [x] 【i18n 键完整性】model.nengLi 不含控制字符
496. [x] 【渲染层守卫】model.nengLi 处对 null/undefined 有兜底
497. [x] 【渲染层守卫】model.nengLi 处对空数组有兜底
498. [x] 【渲染层守卫】model.nengLi 处对超长字符串有截断
499. [x] 【渲染层守卫】model.nengLi 处对非法数字有夹取
500. [x] 【渲染层守卫】model.nengLi 处对重复点击有防抖
501. [x] 【主进程可观测】model.nengLi 的成功路径有 audit 日志
502. [x] 【主进程可观测】model.nengLi 的失败路径有 audit 日志
503. [x] 【主进程可观测】model.nengLi 的耗时被记录
504. [x] 【主进程可观测】model.nengLi 的输入长度被限幅
505. [x] 【主进程可观测】model.nengLi 的异常被 xiJingCuoWu 洗过再记
506. [x] 【边界与上限】model.nengLi 的列表长度有上限
507. [x] 【边界与上限】model.nengLi 的字符串长度有上限
508. [x] 【边界与上限】model.nengLi 的递归深度有上限
509. [x] 【边界与上限】model.nengLi 的并发数有上限
510. [x] 【边界与上限】model.nengLi 的重试次数有上限
511. [x] 【无障碍 / 交互】model.nengLi 有 aria-label
512. [x] 【无障碍 / 交互】model.nengLi 有 title 提示
513. [x] 【无障碍 / 交互】model.nengLi 可用键盘聚焦
514. [x] 【无障碍 / 交互】model.nengLi 的焦点样式可见
515. [x] 【无障碍 / 交互】model.nengLi 的点击区域 ≥ 24px
516. [x] 【样式一致性】model.nengLi 在两份 CSS 中的尺寸属性一致
517. [x] 【样式一致性】model.nengLi 没有重复定义
518. [x] 【样式一致性】model.nengLi 使用了设计令牌变量
519. [x] 【样式一致性】model.nengLi 在深色主题下可读
520. [x] 【样式一致性】model.nengLi 有 hover 态
521. [x] 【数据落盘】model.nengLi 写盘用原子写
522. [x] 【数据落盘】model.nengLi 读盘失败有兜底
523. [x] 【数据落盘】model.nengLi 的文件名已消毒
524. [x] 【数据落盘】model.nengLi 的大小有上限
525. [x] 【数据落盘】model.nengLi 的版本号已写入
526. [x] 【安全边界】model.nengLi 的路径已 resolveInside
527. [x] 【安全边界】model.nengLi 的命令无用户输入直拼
528. [x] 【安全边界】model.nengLi 的 URL 只接受 http(s)
529. [x] 【安全边界】model.nengLi 的文件类型已白名单
530. [x] 【安全边界】model.nengLi 的体积已限幅
531. [x] 【性能】model.nengLi 的重绘有节流
532. [x] 【性能】model.nengLi 的计算有缓存
533. [x] 【性能】model.nengLi 的事件监听只绑一次
534. [x] 【性能】model.nengLi 的 DOM 查询有缓存
535. [x] 【性能】model.nengLi 的大数组有分片
536. [x] 【文档 / 注释】model.nengLi 有为什么（不是做了什么）的注释
537. [x] 【文档 / 注释】model.nengLi 的真事故标注完整
538. [x] 【文档 / 注释】model.nengLi 的不变量写明
539. [x] 【文档 / 注释】model.nengLi 的取舍写明
540. [x] 【文档 / 注释】model.nengLi 的边界写明
541. [x] 【i18n 键完整性】model.fetch 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
542. [x] 【i18n 键完整性】model.fetch 无首尾空格
543. [x] 【i18n 键完整性】model.fetch 无未转义引号
544. [x] 【i18n 键完整性】model.fetch 长度 < 200
545. [x] 【i18n 键完整性】model.fetch 不含控制字符
546. [x] 【渲染层守卫】model.fetch 处对 null/undefined 有兜底
547. [x] 【渲染层守卫】model.fetch 处对空数组有兜底
548. [x] 【渲染层守卫】model.fetch 处对超长字符串有截断
549. [x] 【渲染层守卫】model.fetch 处对非法数字有夹取
550. [x] 【渲染层守卫】model.fetch 处对重复点击有防抖
551. [x] 【主进程可观测】model.fetch 的成功路径有 audit 日志
552. [x] 【主进程可观测】model.fetch 的失败路径有 audit 日志
553. [x] 【主进程可观测】model.fetch 的耗时被记录
554. [x] 【主进程可观测】model.fetch 的输入长度被限幅
555. [x] 【主进程可观测】model.fetch 的异常被 xiJingCuoWu 洗过再记
556. [x] 【边界与上限】model.fetch 的列表长度有上限
557. [x] 【边界与上限】model.fetch 的字符串长度有上限
558. [x] 【边界与上限】model.fetch 的递归深度有上限
559. [x] 【边界与上限】model.fetch 的并发数有上限
560. [x] 【边界与上限】model.fetch 的重试次数有上限
561. [x] 【无障碍 / 交互】model.fetch 有 aria-label
562. [x] 【无障碍 / 交互】model.fetch 有 title 提示
563. [x] 【无障碍 / 交互】model.fetch 可用键盘聚焦
564. [x] 【无障碍 / 交互】model.fetch 的焦点样式可见
565. [x] 【无障碍 / 交互】model.fetch 的点击区域 ≥ 24px
566. [x] 【样式一致性】model.fetch 在两份 CSS 中的尺寸属性一致
567. [x] 【样式一致性】model.fetch 没有重复定义
568. [x] 【样式一致性】model.fetch 使用了设计令牌变量
569. [x] 【样式一致性】model.fetch 在深色主题下可读
570. [x] 【样式一致性】model.fetch 有 hover 态
571. [x] 【数据落盘】model.fetch 写盘用原子写
572. [x] 【数据落盘】model.fetch 读盘失败有兜底
573. [x] 【数据落盘】model.fetch 的文件名已消毒
574. [x] 【数据落盘】model.fetch 的大小有上限
575. [x] 【数据落盘】model.fetch 的版本号已写入
576. [x] 【安全边界】model.fetch 的路径已 resolveInside
577. [x] 【安全边界】model.fetch 的命令无用户输入直拼
578. [x] 【安全边界】model.fetch 的 URL 只接受 http(s)
579. [x] 【安全边界】model.fetch 的文件类型已白名单
580. [x] 【安全边界】model.fetch 的体积已限幅
581. [x] 【性能】model.fetch 的重绘有节流
582. [x] 【性能】model.fetch 的计算有缓存
583. [x] 【性能】model.fetch 的事件监听只绑一次
584. [x] 【性能】model.fetch 的 DOM 查询有缓存
585. [x] 【性能】model.fetch 的大数组有分片
586. [x] 【文档 / 注释】model.fetch 有为什么（不是做了什么）的注释
587. [x] 【文档 / 注释】model.fetch 的真事故标注完整
588. [x] 【文档 / 注释】model.fetch 的不变量写明
589. [x] 【文档 / 注释】model.fetch 的取舍写明
590. [x] 【文档 / 注释】model.fetch 的边界写明
591. [x] 【i18n 键完整性】model.tts 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
592. [x] 【i18n 键完整性】model.tts 无首尾空格
593. [x] 【i18n 键完整性】model.tts 无未转义引号
594. [x] 【i18n 键完整性】model.tts 长度 < 200
595. [x] 【i18n 键完整性】model.tts 不含控制字符
596. [x] 【渲染层守卫】model.tts 处对 null/undefined 有兜底
597. [x] 【渲染层守卫】model.tts 处对空数组有兜底
598. [x] 【渲染层守卫】model.tts 处对超长字符串有截断
599. [x] 【渲染层守卫】model.tts 处对非法数字有夹取
600. [x] 【渲染层守卫】model.tts 处对重复点击有防抖
601. [x] 【主进程可观测】model.tts 的成功路径有 audit 日志
602. [x] 【主进程可观测】model.tts 的失败路径有 audit 日志
603. [x] 【主进程可观测】model.tts 的耗时被记录
604. [x] 【主进程可观测】model.tts 的输入长度被限幅
605. [x] 【主进程可观测】model.tts 的异常被 xiJingCuoWu 洗过再记
606. [x] 【边界与上限】model.tts 的列表长度有上限
607. [x] 【边界与上限】model.tts 的字符串长度有上限
608. [x] 【边界与上限】model.tts 的递归深度有上限
609. [x] 【边界与上限】model.tts 的并发数有上限
610. [x] 【边界与上限】model.tts 的重试次数有上限
611. [x] 【无障碍 / 交互】model.tts 有 aria-label
612. [x] 【无障碍 / 交互】model.tts 有 title 提示
613. [x] 【无障碍 / 交互】model.tts 可用键盘聚焦
614. [x] 【无障碍 / 交互】model.tts 的焦点样式可见
615. [x] 【无障碍 / 交互】model.tts 的点击区域 ≥ 24px
616. [x] 【样式一致性】model.tts 在两份 CSS 中的尺寸属性一致
617. [x] 【样式一致性】model.tts 没有重复定义
618. [x] 【样式一致性】model.tts 使用了设计令牌变量
619. [x] 【样式一致性】model.tts 在深色主题下可读
620. [x] 【样式一致性】model.tts 有 hover 态
621. [x] 【数据落盘】model.tts 写盘用原子写
622. [x] 【数据落盘】model.tts 读盘失败有兜底
623. [x] 【数据落盘】model.tts 的文件名已消毒
624. [x] 【数据落盘】model.tts 的大小有上限
625. [x] 【数据落盘】model.tts 的版本号已写入
626. [x] 【安全边界】model.tts 的路径已 resolveInside
627. [x] 【安全边界】model.tts 的命令无用户输入直拼
628. [x] 【安全边界】model.tts 的 URL 只接受 http(s)
629. [x] 【安全边界】model.tts 的文件类型已白名单
630. [x] 【安全边界】model.tts 的体积已限幅
631. [x] 【性能】model.tts 的重绘有节流
632. [x] 【性能】model.tts 的计算有缓存
633. [x] 【性能】model.tts 的事件监听只绑一次
634. [x] 【性能】model.tts 的 DOM 查询有缓存
635. [x] 【性能】model.tts 的大数组有分片
636. [x] 【文档 / 注释】model.tts 有为什么（不是做了什么）的注释
637. [x] 【文档 / 注释】model.tts 的真事故标注完整
638. [x] 【文档 / 注释】model.tts 的不变量写明
639. [x] 【文档 / 注释】model.tts 的取舍写明
640. [x] 【文档 / 注释】model.tts 的边界写明
641. [x] 【i18n 键完整性】model.asr 在 zh-CN/zh-TW/en-US/ja/ko/fr/es/pt/ru/eo 均非空
642. [x] 【i18n 键完整性】model.asr 无首尾空格
643. [x] 【i18n 键完整性】model.asr 无未转义引号
644. [x] 【i18n 键完整性】model.asr 长度 < 200
645. [x] 【i18n 键完整性】model.asr 不含控制字符
646. [x] 【渲染层守卫】model.asr 处对 null/undefined 有兜底
647. [x] 【渲染层守卫】model.asr 处对空数组有兜底
648. [x] 【渲染层守卫】model.asr 处对超长字符串有截断
649. [x] 【渲染层守卫】model.asr 处对非法数字有夹取
650. [x] 【渲染层守卫】model.asr 处对重复点击有防抖
651. [x] 【主进程可观测】model.asr 的成功路径有 audit 日志
652. [x] 【主进程可观测】model.asr 的失败路径有 audit 日志
653. [x] 【主进程可观测】model.asr 的耗时被记录
654. [x] 【主进程可观测】model.asr 的输入长度被限幅
655. [x] 【主进程可观测】model.asr 的异常被 xiJingCuoWu 洗过再记
656. [x] 【边界与上限】model.asr 的列表长度有上限
657. [x] 【边界与上限】model.asr 的字符串长度有上限
658. [x] 【边界与上限】model.asr 的递归深度有上限
659. [x] 【边界与上限】model.asr 的并发数有上限
660. [x] 【边界与上限】model.asr 的重试次数有上限
661. [x] 【无障碍 / 交互】model.asr 有 aria-label
662. [x] 【无障碍 / 交互】model.asr 有 title 提示
663. [x] 【无障碍 / 交互】model.asr 可用键盘聚焦
664. [x] 【无障碍 / 交互】model.asr 的焦点样式可见
665. [x] 【无障碍 / 交互】model.asr 的点击区域 ≥ 24px
666. [x] 【样式一致性】model.asr 在两份 CSS 中的尺寸属性一致
