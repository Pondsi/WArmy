# WArmy 第二批 100 项独立任务
U001 | i18n | 10 语包键集与 zh-CN 对齐
U002 | i18n | en-US 无中文泄漏（白名单键除外）
U003 | i18n | 占位符 {n}/{fields} 跨包一致
U004 | i18n | 品牌名 WArmy/无限牛马 锁定
U005 | i18n | 无 locale.startsWith('en') 双向塌缩
U006 | IPC | preload 暴露通道与主进程注册对齐
U007 | IPC | 旧英文别名 ipc-aliases 覆盖
U008 | IPC | 无未处理的 ipcMain.handle 重复注册
U009 | 诚实 | 更新失败不伪装成功
U010 | 诚实 | 容器未就绪如实上报
U011 | 诚实 | 端口绑定失败如实上报
U012 | 诚实 | installImplemented:false 诚实
U013 | 诚实 | 记忆服务不可用时降级不抛
U014 | 持久化 | groups.json 原子写
U015 | 持久化 | router-queues.json 重启恢复
U016 | 持久化 | ui-queues.json 落盘
U017 | 持久化 | settings.json 浅合并 load
U018 | 持久化 | identity.json 加密私钥
U019 | 持久化 | chat JSONL 只追加
U020 | 持久化 | checkpoint CoW 回滚
U021 | 记忆 | recordId 前缀 m/a/g 角色还原
U022 | 记忆 | seq 单调不回退
U023 | 记忆 | recall 三路 RRF 融合存在
U024 | 记忆 | retrieve 逐字节一致接口
U025 | 记忆 | 向量通道可关（enabled:false）
U026 | 路由 | 队列弹出不丢弃
U027 | 路由 | duty 选择 remote 不 eligible
U028 | 路由 | directedMode 无@不响应
U029 | 看板 | writer 校验 duty/router
U030 | 看板 | 任务树 parent/jinDu
U031 | 身份 | Ed25519 指纹校验
U032 | 身份 | 代次 generation 单调
U033 | 身份 | 换证冻结期
U034 | 身份 | 吊销列表广播
U035 | 组网 | 0.0.0.0 显式开启
U036 | 组网 | WSL 例行路径不启动
U037 | 组网 | 中继 token 非凭据注释
U038 | 组网 | E2E 会话加密存在
U039 | 组网 | 防重放持久化
U040 | 容器 | 探测不编造耗时体积
U041 | 容器 | WSL 无 commit 能力表
U042 | 容器 | 项目停用=创建者下线
U043 | 容器 | 宿主目录锁可撤销
U044 | 容器 | 固化后回读镜像 id
U045 | 容器 | 台账不记文件内容
U046 | 文件 | 台账操作类型白名单
U047 | 文件 | 项目级台账有界 200
U048 | 文件 | 台账同路径同操作不堆叠
U049 | UI | 聊天自动滚动可切换
U050 | UI | 新窗名称与主界面一致
U051 | UI | 独立窗只有聊天+右栏
U052 | UI | 设置页无聊天输入框
U053 | UI | 添加供应商可点
U054 | UI | 供应商下拉有预设
U055 | UI | 重名牛马拒绝
U056 | UI | 托盘下班真退出
U057 | UI | 单实例居中聚焦
U058 | UI | 白底任务栏图标
U059 | UI | logo 透明底不被换
U060 | UI | 独立窗头像白底合成
U061 | 快捷键 | Ctrl+B 切侧栏
U062 | 快捷键 | 打字时不抢键
U063 | 快捷键 | 快捷键表可重绑
U064 | 导出 | 会话 Markdown 导出
U065 | 导出 | 身份备份 JSON+口令
U066 | 导出 | 模型成本 CSV
U067 | 隐私 | 隐私同意可撤回
U068 | 隐私 | 审计日志不外传
U069 | 隐私 | 私钥不进 UI 明文
U070 | 隐私 | 无第三方统计 SDK
U071 | 通知 | 完成/请求/错误可开关
U072 | 通知 | 声音文件可自定义
U073 | 邮件 | SMTP 队列不硬编码服务器
U074 | 邮件 | SMTP 验证接口存在
U075 | dsh | 一键安装到 userData
U076 | dsh | 关于页显示版本或未安装
U077 | dsh | 启动默认安装（PC）
U078 | dsh | 安装失败不挡启动
U079 | 更新 | feed https 校验
U080 | 更新 | 版本比较 semver
U081 | 更新 | draft/prerelease 不当正式版
U082 | 更新 | 下载大小上限
U083 | 更新 | 半成品 .part 清理
U084 | 更新 | 状态文件 lastCheck/lastDownload
U085 | 构建 | electron-builder 配置存在
U086 | 构建 | extraResources memory-os
U087 | 构建 | 捆绑 Node win-x64
U088 | 构建 | artifactName WArmy-Setup
U089 | 构建 | asar:false 注释原因
U090 | 安全 | CSP meta/headers
U091 | 安全 | 无 allowRunningInsecureContent
U092 | 安全 | 无 remote module 滥用
U093 | 安全 | dialog 路径过滤
U094 | 安全 | 审计 log 不含密钥
U095 | 质量 | check-syntax TDZ 通过
U096 | 质量 | CSS 括号平衡
U097 | 质量 | 无 system alert(
U098 | 质量 | uiAlert/uiConfirm/uiPrompt 存在
U099 | 质量 | 18 项门禁脚本齐全
U100 | 质量 | security-rounds 跑批器可复现
