# WArmy 100 项独立任务清单
# 格式: T001 | 类别 | 描述
T001 | 改名残留 | 全库扫 CSS 类型选择器 ti/shuRu
T002 | 改名残留 | 全库扫 querySelector 类型选择器
T003 | 改名残留 | 全库扫 new Event/createElement 平台名
T004 | 改名残留 | 全库扫 document.title/document.biaoTi
T005 | 改名残留 | 全库扫 getAttribute/setAttribute title
T006 | 改名残留 | 全库扫 DOMRect.right/.you
T007 | 改名残留 | 全库扫 WS addEventListener open/daKai
T008 | 改名残留 | 全库扫 c.send/c.faSong
T009 | 改名残留 | 全库扫 \$('input')/\$('shuRu') id
T010 | 改名残留 | 全库扫 Event('input'/'shuRu')
T011 | 模板字面量 | 扫 electron-main.ts 丢 ${}
T012 | 模板字面量 | 扫 group-store.ts 丢 ${}
T013 | 模板字面量 | 扫 orchestrator.ts 丢 ${}
T014 | 模板字面量 | 扫其余 *.ts 丢 ${}
T015 | 模板字面量 | 修 xinLiaoTianJiLuId 插值
T016 | 模板字面量 | 修成员 id 插值
T017 | 模板字面量 | 修 max 上限插值
T018 | 模板字面量 | 修 qidong 日志插值
T019 | 模板字面量 | 修 userAgent 插值
T020 | 模板字面量 | 修镜像 ref 插值
T021 | 模板字面量 | 修 LLM error 插值
T022 | 模板字面量 | 修 restore-failed 插值
T023 | 模板字面量 | 修 boot 日志插值
T024 | 模板字面量 | recordId 唯一性运行时断言
T025 | 模板字面量 | verify-template-integrity 门禁
T026 | 根因工具 | pinyin-rename lock ${}/}
T027 | 根因工具 | pinyin-rename 回滚减插值替换
T028 | 安全-密钥 | 扫 ghp_/gho_/github_pat
T029 | 安全-密钥 | 扫 sk-/sk-proj-
T030 | 安全-密钥 | 扫 AIza/AKIA/xox
T031 | 安全-密钥 | 扫 JWT eyJ
T032 | 安全-密钥 | 扫 PEM 私钥体
T033 | 安全-密钥 | git 不跟踪密钥文件
T034 | 安全-隐私 | 脱敏用户绝对路径
T035 | 安全-隐私 | 脱敏主机名 DESKTOP-*
T036 | 安全-隐私 | 脱敏密钥文件名
T037 | 安全-隐私 | 脱敏工作区中文名
T038 | 安全-隐私 | 脱敏 F:\XZM 本地盘
T039 | 安全-隐私 | spikes 结果文件脱敏
T040 | 安全-隐私 | docs 路径脱敏
T041 | 安全-XSS | innerHTML t() 转义
T042 | 安全-XSS | 用户字段未转义扫描
T043 | 安全-XSS | escapeHtml 存在性
T044 | 安全-IPC | senderFrame fail-closed
T045 | 安全-IPC | 拒非 file 来源
T046 | 安全-IPC | devtools 默认拒
T047 | 安全-更新 | 拒远程 http feed
T048 | 安全-更新 | 无 sha256 不落盘
T049 | 安全-更新 | downloadUrl 走 https 校验
T050 | 安全-更新 | installImplemented 诚实标记
T051 | 安全-Node | fetch-node SHASUMS256
T052 | 安全-Node | SHA 不符即删文件
T053 | 安全-插件 | 安装锁版本拒 latest
T054 | 安全-插件 | 卸载按包名解析
T055 | 安全-沙箱 | contextIsolation true
T056 | 安全-沙箱 | nodeIntegration false
T057 | 安全-沙箱 | webSecurity 未关
T058 | 安全-沙箱 | CSP 存在
T059 | 安全-执行 | 无 eval/new Function
T060 | 安全-执行 | 无 document.write
T061 | UI-滚动 | 第四列 overflow-y auto
T062 | UI-滚动 | body overflow hidden
T063 | UI-滚动 | 整页无滚动条规则
T064 | UI-滚动 | 显隐铁律 :not(.yinCang)
T065 | UI-列表 | 列表行 class=name 对齐
T066 | UI-输入 | 聊天输入框 id=shuRu
T067 | UI-输入 | maxlength=8000
T068 | UI-HTML | body/input 标签未改名
T069 | 测试对齐 | run-full MemoryService→JiyiCangFuwu
T070 | 测试对齐 | run-full dataDir→CangLu
T071 | 测试对齐 | run-full title→biaoTi
T072 | 测试对齐 | run-full list()→LieBiao()
T073 | 测试对齐 | yingYong.js→app.js 路径
T074 | 测试对齐 | verify-context-renderer 导入去重
T075 | 测试对齐 | verify-context-renderer 消息字段
T076 | 测试对齐 | CDP DevTools 正则 on
T077 | 测试对齐 | CDP /json/list 路径
T078 | 测试对齐 | verify-planD title→biaoTi
T079 | 测试对齐 | 预算下限尊重设置
T080 | 测试对齐 | 末轮指针取 lastP
T081 | 测试对齐 | verify-updater verified→yiYanZheng
T082 | 测试对齐 | verify-live-ui DOMRect.right
T083 | 测试对齐 | verify-live-ui title 字段
T084 | 测试对齐 | verify-mobile-ui document.title
T085 | 测试对齐 | verify-net-ui Users/<user>
T086 | CI-门禁 | verify-security.mjs 入库
T087 | CI-门禁 | verify-template-integrity 入 CI
T088 | CI-门禁 | verify-security 入 CI
T089 | CI-门禁 | run-full 调 template 门禁
T090 | CI-门禁 | security-rounds.mjs 跑批器入库
T091 | CI-门禁 | 扫描器跳过自身文件
T092 | CI-门禁 | 防回归旧 API 规则
T093 | 文档 | README Electron 40
T094 | 文档 | 说明.md Electron 40
T095 | 文档 | CHANGELOG 补验收条目
T096 | 文档 | ACCEPTANCE-CHECKLIST 入库
T097 | 文档 | i18n 仓库链接 WArmy
T098 | 文档 | LICENSE 署名核对
T099 | 文档 | package.json license 字段
T100 | 产物 | src/dist 同步核对
