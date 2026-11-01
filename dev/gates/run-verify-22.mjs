/**
 * run-verify-22.mjs —— 第 22 轮"全面检验"的唯一入口（可连续跑 N 遍，日志可复核）
 *
 * 为什么写成清单：用户要求"连续 3 次没有问题"。跑什么、每支多久、红在哪一行，
 * 必须落在一份能回看的日志里，而不是散在终端历史里。
 *
 * 两档：
 *   --tier=fast（默认）  纯本地、可重复、不依赖外部服务的门禁。**这一档连续跑 3 遍**。
 *   --tier=live          真机 Electron 门禁（要启动应用、抢单实例锁、真 Ollama/真模型）。
 *   --tier=stress        压力档（第 45 轮）：A 六轮网页小游戏真跑到真 Chromium；B 记忆 2M 字符/轮（缩放档，满档见脚本头）。
 *                        跑之前/之后**先清场**：上一支真机门禁遗留的 electron 会让下一支
 *                        `EVAL_TIMEOUT`（本轮实测：遗留实例占住 9523 与单实例锁）。
 *
 * 用法：
 *   node run-verify-22.mjs --times=3                  # 连续 3 遍 fast（全绿才算过）
 *   node run-verify-22.mjs --tier=live                # 真机档跑一遍
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
/**
 * 轮数**严格按请求值**执行：旧实现 `Math.min(9, …)` 会把 `--times=10` 静默截成 9，
 * 让"十连"从未真正发生。无效输入直接报错，不替用户改口径。
 */
function quLunShu() {
  const raw = (argv.find((a) => /^--times=/.test(a)) || '').split('=')[1];
  if (raw === undefined || raw === '') return 1;
  if (!/^[0-9]+$/.test(raw)) {
    console.error(`✗ --times 必须是正整数，收到：${raw}`);
    process.exit(2);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
    console.error(`✗ --times 超出允许范围 1..100，收到：${raw}`);
    process.exit(2);
  }
  return n;
}
const TIMES = quLunShu();
const TIER = (argv.find((a) => /^--tier=/.test(a)) || '--tier=fast').split('=')[1];
if (!['fast', 'live', 'stress'].includes(TIER)) {
  console.error(`✗ --tier 只能是 fast|live|stress，收到：${TIER}`);
  process.exit(2);
}

/** 纯本地、可重复 */
const FAST = [
  ['assets', 'verify-assets-fresh', 5],
  ['app-shell', 'verify-security', 120],
  ['app-shell', 'check-syntax', 120],
  ['app-shell', 'verify-gate-manifest', 120],
  ['app-shell', 'verify-secret-at-rest', 120],
  ['app-shell', 'verify-no-empty-catch', 120],
  ['app-shell', 'verify-repo-guard', 120],
  ['app-shell', 'verify-docs', 180],
  ['app-shell', 'verify-truth-guard', 180],
  ['app-shell', 'verify-import-integrity', 180],
  ['app-shell', 'verify-template-integrity', 180],
  ['app-shell', 'verify-renderer-scope', 120],
  ['app-shell', 'verify-renderer-template-balance', 120],
  ['app-shell', 'verify-css-consistency', 120],
  ['app-shell', 'verify-i18n-locales', 180],
  ['app-shell', 'verify-strict-language', 180],
  ['app-shell', 'verify-naming', 180],
  ['app-shell', 'verify-wiring', 180],
  ['app-shell', 'verify-ipc-probe', 180],
  ['app-shell', 'verify-electron-app-binding', 180],
  ['app-shell', 'verify-work-tools', 240],
  ['app-shell', 'verify-tool-calls', 240],
  ['app-shell', 'verify-model-kind', 120],
  ['app-shell', 'verify-model-pick', 240],
  /** 第 98 轮：值班者派发计划（紧急度管插话、难易度管挑人/思考；不得指定模型） */
  ['app-shell', 'verify-zhi-ban-pai-fa', 120],
  /** 第 99 轮：三轴五档 + 模型/思考映射 + 三档授权 + 本轮 UI 接缝 */
  ['app-shell', 'verify-r99-five-axis', 120],
  /** 第 100 轮：停止语义 / 现场保留 / 独立窗关闭 / nm 插件装卸（纯静态 + 真值表，不起 Electron） */
  ['app-shell', 'verify-r100-stop', 120],
  /** 第 116 轮：nm 查看器远程页导航状态/查找 UI/键盘转发（隐藏 Electron + 真实 preload） */
  ['root', 'verify-r81-nm', 300],
  /** 第 101 轮：话筒菜单 / 操作浮雕 / 窗口位置 / 滚动链接 / 授权无超时 / 过程引用 / nm 打开矩阵 / 旧台账 */
  ['app-shell', 'verify-r101-changes', 120],
  /** 第 102 轮：下箭头/未查看摘要、引导卡去聊天不自动收起、nm 与主窗口预留第四列最大化（纯几何） */
  ['app-shell', 'verify-r102-changes', 120],
  /** 第 103 轮：4K/高 DPI 静态接线（真机四视口另见 verify-r103-4k） */
  ['app-shell', 'verify-r103-4k-static', 120],
  /** 第 104 轮：全量加密 vault（登录解锁/退出封存/加密导出导入）+ 供应商 cancel + nm WebContentsView */
  ['app-shell', 'verify-r104-vault', 300],
  /** 第 107 轮：定时导出（多位置/无变化跳过/凭证缺失/循环次数/明文与主密钥包） */
  ['root', 'verify-r107-export-schedule', 180],
  /** 第 110 轮：回复不得被覆盖、计划证据不误判 docx、完成音一次、整理特效可取消 */
  ['root', 'verify-r110-replies', 120],
  /** 第 111 轮：.nm v2/Kroot/外部编辑/脱敏/IPC schema/旧群重建；SQLCipher 记忆库 */
  ['root', 'verify-r111-data', 180],
  ['root', 'verify-r111-storage', 120],
  ['root', 'verify-r113-export-retention', 120],
  ['app-shell', 'verify-model-route', 240],
  ['app-shell', 'verify-eta-forecast', 240],
  ['app-shell', 'verify-router-queue', 240],
  ['app-shell', 'verify-group-store', 240],
  ['app-shell', 'verify-membership', 240],
  ['app-shell', 'verify-identity', 180],
  ['app-shell', 'verify-credential', 180],
  ['app-shell', 'verify-nm-format', 180],
  ['app-shell', 'verify-ctx-budget', 240],
  ['app-shell', 'verify-zip-look', 240],
  ['app-shell', 'verify-industry-gates', 180],
  ['app-shell', 'verify-media-format', 180],
  ['app-shell', 'verify-audio-first-class', 240],
  ['app-shell', 'verify-updater', 240],
  ['app-shell', 'verify-updater-github', 240],
  ['app-shell', 'verify-office-doc-suite', 420],
  ['app-shell', 'verify-research-pipeline', 240],
  ['app-shell', 'verify-nat', 300],
  ['app-shell', 'verify-context-renderer', 1800, ['--no-electron']],
  ['sync-protocol', 'verify-all', 900],
  ['sync-protocol', 'verify-connectivity', 900],
  ['spikes', 'verify-all/run-full', 1200],
  ['root', 'verify-round20-badge', 300],
  ['root', 'verify-round20-clip', 300],
  ['root', 'verify-round20-css', 300],
  ['root', 'verify-round20-enhance', 600],
  ['root', 'verify-round20-esm', 300],
  ['root', 'verify-round20-ink', 300],
  ['root', 'verify-round20-install', 300],
  ['root', 'verify-round20-play', 300],
  ['root', 'verify-round20-route', 300],
  ['root', 'verify-round20-sound', 300],
  ['root', 'verify-round20-stream', 300],
  ['root', 'verify-round21-long-memory', 300],
  ['root', 'verify-round21-ui-loop', 300],
  ['root', 'verify-round22-decision', 300],
  ['root', 'verify-round22-longrun', 1200],
  ['root', 'verify-round27-changes', 300],
  ['root', 'verify-round28-changes', 300],
  ['root', 'verify-round34-changes', 300],
  ['root', 'verify-round35-changes', 300],
  ['root', 'verify-round36-changes', 300],
  ['root', 'verify-round37-changes', 300],
  ['root', 'verify-round38-changes', 300],
  ['root', 'verify-round39-budget', 300],
  ['root', 'verify-round40-heartbeat', 300],
  ['root', 'verify-tool-args', 300],
  /** 第 44 轮：长文副本防护的真值表（纯函数单测，不起 Electron ⇒ 归 fast 档，每遍都跑） */
  ['root', 'verify-r44-fuzhi', 60],
  /** 第 44 轮后半：token 真实化的数学与接线不变量（纯函数 + 静态扫描，不起 Electron ⇒ fast 档） */
  ['root', 'verify-r44-token', 90],
  /** 第 44 轮后半（用户 #2/#3/#4）：预算=所有发给模型的内容的分段计价、分配等式与降级顺序 */
  ['root', 'verify-r44-yuSuan', 90],
  /** 第 48 轮：任务黑板 + 结构化蒸馏 + 队列冲刷同协议 + 三层缓存顺序（假模型端到端 + 真记忆服务，确定性 ⇒ fast 档） */
  ['app-shell', 'verify-r52-layers', 180],
  /** 第 52 轮（用户项 11）：④「被拒即停用」按**任务**算的真值表 + 拒绝唯一出口的结构断言（不起 Electron ⇒ fast 档） */
  ['app-shell', 'verify-r52-jujue', 90],
  /** 第 52 轮（用户项 4）：分层压缩的泵道真值表（半极限→真极限、一层一轮、道永不进队列、层内倒序） */
  ['app-shell', 'verify-r52-yasuo', 90],
  /** 第 52 轮（用户项 6/7 + 项 2）：知识库归层真值表 + 脱敏概要（白名单/禁现/哨兵）+ 归档后整理 + 在途跳过 */
  ['app-shell', 'verify-r52-kb', 90],
  /** 第 53 轮（用户项 5）：知识库双时间 —— 相对日期以说话时刻为锚、记录时间写一次、取代不删除、两轴查询与排序 */
  ['app-shell', 'verify-r53-shijian', 90],
  /** 第 53 轮（用户项 2）：提示词每层固定上限 + AI 友好格式 + 超限自愈（去空行→搬最旧条目进知识库，字级守恒） */
  ['app-shell', 'verify-r53-tishangxian', 90],
  /** 第 53 轮（用户项 7/9）：脱敏概要的 k-匿名抑制、白名单自检、重建攻击、血缘传播、方案对照文档 */
  ['app-shell', 'verify-r53-tumin', 90],
  /** 第 53 轮（用户项 4）：知识库可靠性三件套 —— 实体归一三层裁决、证据闸（evidence-before-belief）、陈旧降权不删除 */
  ['app-shell', 'verify-r53-zhishi', 90],
  /** 第 54 轮（用户项 1）：10 种语言的出厂默认层 + 切语言跟着变 + 上限按语言折算 */
  ['app-shell', 'verify-r54-i18n-defaults', 120],
  /** 第 67 轮：每语言每提示词连续三轮上限审计 + 重译脚本存在性 */
  ['root', 'verify-r67-prompt-caps', 120],
  /** 第 67 轮：首启新流程（语言页/条款/分流/拼音/用户名/PIN 文案） */
  ['root', 'verify-r67-firstrun', 120],
  /** 第 67 轮：nm 四边吸附 + 只读缩放拖动（纯几何真值表 + 静态接线） */
  ['root', 'verify-r67-nm-edges', 120],
  /** 第 67 轮：聊天时序/附加内容/回档/微信多账号/卡片注入标记 */
  ['root', 'verify-r67-chat-order', 120],
  /** 第 54 轮（用户项 3）：脱敏白名单自更新（模型提案→宿主校验）+ 三个知识工具真的声明成工具 */
  ['app-shell', 'verify-r54-zi-geng', 90],
  /** 第 55 轮（用户项 1/2/3）：授权三档真值表 + 知识库合并/重构/待整理区 + token 专属校准随模型消亡 */
  ['app-shell', 'verify-r55-shouquan-kb', 90],
  /** 第 56 轮（用户项 3）：认知预设分类 + 51 个牛马模板名的 10 语言版本 */
  ['app-shell', 'verify-r56-preset-i18n', 90],
  /** 第 57 轮（用户项 2）：群消息弱一致的确定性排序/缺口补拉/待排序队列/错位判定 */
  ['app-shell', 'verify-r57-ruo-yizhi', 90],
  /** 第 58 轮：可选服务器（内存中继）协议 + 端到端加密边界 + 离线/篡改/伪造真链路 */
  ['app-shell', 'verify-r58-zhongji', 120],
  /** 第 59 轮：多服务器网络配置 + 会话级绑定 + 扇出 + 服务器管理面（凭据/统计/限流/公网IP/启停） */
  ['app-shell', 'verify-r59-wangluo', 90],
  /** 第 60 轮：nm 查看器（打开/自动保存/所在目录/历史快照/查找替换）+ 独立服务器项目 + 群只读策略 */
  ['app-shell', 'verify-r60-nm-server', 90],
  /** 第 62 轮：nm 真机几何（下半屏）+ 主窗口真机贴边（Win32 移动，临时 userData） */
  ['app-shell', 'verify-r62-ui', 180],
  /** 第 63 轮：吸附落盘/图标主题/覆盖卡/慢任务/ASR/主窗吸附的静态与纯函数锚点 */
  ['app-shell', 'verify-r63-main-ui', 90],
  /** 第 64 轮：FWArmy 独立服务器（改名/单文件/统计/逐凭据限额/无界面启动器/管理面边界） */
  ['app-shell', 'verify-r64-fwarmy', 180],
  /** 第 63 轮：nm 查看器渲染层（工具栏/分栏/预览/缩放/全屏/未保存/音乐/视频进度条） */
  ['app-shell', 'verify-r63-nm', 180],
  /** 第 63 轮：网络设置主机模式/服务商/IP 检测/host:port/上限/凭证存储 */
  ['app-shell', 'verify-r63-net', 180],
  /** 第 66 轮：nm 工具栏/只读搜索/二进制/吸附静态判据（真窗口见 r65-nm-pair-live / r62） */
  ['app-shell', 'verify-r66-nm', 90],
  /** 第 66 轮：助记词/PIN/自动登录绑定真值表（纯函数） */
  ['app-shell', 'verify-r66-auth', 120],
  /** 第 65 轮：A/B 会话交错流式、成员/文件/收尾串台（离线行为夹具 + 负向对照） */
  ['app-shell', 'verify-r65-session-isolation', 120],
  /** 第 65 轮：两个真实 nm 窗口吸附/联动（真窗口，临时文件） */
  ['app-shell', 'verify-r65-nm-pair-live', 120],
  /** 第 65 轮：nm 吸附几何纯函数真值表（阈值/方向/高度/相邻判定） */
  ['app-shell', 'verify-r65-nm-pair', 90],
  /** 第 65 轮：最近成功 5 路 + 5 并发竞速 + 失败/离线/不安全服务商的纯函数真值表（不起 Electron） */
  ['app-shell', 'verify-r65-route', 90],
  /** 第 65 轮：话筒停止后最后一块音频/预览排队/会话切换隔离（假 MediaRecorder，不起 Electron） */
  ['app-shell', 'verify-r65-mic-lifecycle', 90],
  /** 第 65 轮：微信 iLink 文本/回复协议夹具（离线 fetch 桩；不代替真实端到端） */
  ['app-shell', 'verify-r65-shejiao', 90],
  /** 第 61 轮：产品硬门禁的"效果只增不减"覆盖审计（条款/撤除项去向/宿主强制点/注入唯一） */
  ['app-shell', 'verify-hard-gates', 90],
  ['root', 'verify-r48-heiban', 300],
  /** 第 48 轮：契约 v1.1 每一份都有真实消费点（或标【未落地】）、不许另写一份同名定义 */
  ['root', 'verify-r48-qiyue', 120],
  /** 第 50 轮：计划/定时「变更不删旧」+ 软门禁分区可见（用户口径 2026-10-20） */
  ['root', 'verify-r50-plan-schedule', 60],
  /**
   * 第 52 轮注入阶梯的两支钉桩门禁（顺序：硬门禁>道>术>规范>教条>束缚>工具>软门禁>认知>印象）。
   * 它们此前**不在任何一档清单里** ⇒ 阶梯改动从来没被验收遍覆盖过（纯静态判据，不起 Electron ⇒ fast 档）。
   */
  ['root', 'verify-prompt-layers', 60],
  ['root', 'verify-dao-safety', 60],
  /** 第 106 轮：群聊入站消息的群成员/内外层 session 校验（纯真值表 + 主进程接线） */
  ['root', 'verify-r106-inbound', 60],
  /** 第 114 轮：运行期静态加密（JSON/JSONL/迁移/边界）+ 外部编辑显式会话 + 入口/口径 */
  ['root', 'verify-r114-crypto', 120],
  /** 第 115 轮：加密层大文件流式读取/迁移（不整文件读入内存） */
  ['root', 'verify-r115-streaming', 180],
  /** 第 116 轮：跨加密边界复制/流式写入（copyFileSync/createWriteStream 分块、原子替换、写守卫） */
  ['root', 'verify-r116-enc-stream', 180],
  /** 第 117 轮：群聊定向模式 @ 成员 id 的渲染层/主进程/路由真值表 */
  ['app-shell', 'verify-r117-directed', 60],
  /** 第 119 轮：创建牛马的本机/容器选项、实例 devEnv 与容器可用性拒绝 */
  ['app-shell', 'verify-r119-instance-devenv', 60],
  /** 第 119/120 轮：存储恢复底线 + 加密 JSONL 逻辑索引 + W01–W04 加固 */
  ['app-shell', 'verify-r119-storage-recovery', 120],
  ['app-shell', 'verify-r119-memory-jsonl', 120],
  ['app-shell', 'verify-r120-hardening', 180],
  /** 第 120 轮：技能/插件加密边界（代码明文可执行、配置密文） */
  ['app-shell', 'verify-r120-plugin-code-plain', 60],
  /** 第 120 轮：.nm 预览/导入共用一次解包 + 令牌绑定 */
  ['app-shell', 'verify-r120-nm-stage', 120],
  /** 第 120 轮：promises 真异步 + 外部编辑流式/冲突；召回补算 single-flight/取消 */
  ['app-shell', 'verify-r120-async-boundary', 120],
  ['app-shell', 'verify-r120-recall-cancel', 120],
  /** 第 120 轮：键盘可达/减少动态/静态阴影层/nm 下载闭环 */
  ['app-shell', 'verify-r120-ui-a11y', 60],
  /** 第 120 轮：独立 profile 备份 + 可验证清单 */
  ['app-shell', 'verify-r120-backup', 120],
  /** 第 121 轮：6 项决定（副本/永久授权/分身/会话下载目录/计量） */
  ['app-shell', 'verify-r121-decisions', 120],
  /** 第 122 轮：公开可发现（C 方案，默认关）——真实 DHT 发布/查询/拒读/篡改/关闭语义 */
  ['root', 'verify-r122-discovery', 120],
  /** 第 122 轮：加密存储按数据类别覆盖（W05） */
  ['root', 'verify-r122-w05-storage', 120],
  /** 第 122 轮：网络投递 outbox + 业务 ACK（W07，真握手） */
  ['root', 'verify-r122-w07-toudi', 180],
  /** 第 122 轮：企微/钉钉接收协议（W08，离线夹具） */
  ['root', 'verify-r122-w08-receive', 120],
  /** 第 122 轮：签名更新清单（W09） */
  ['root', 'verify-r122-w09-manifest', 120],
  /** 第 122 轮：dsh 随包携带与检测路径（静态 + 可选打包产物） */
  ['root', 'verify-r122-dsh-bundle', 60],
];

/** 真机：要起 Electron / 真模型，跑前先清场 */
const LIVE = [
  /** 第 122 轮：dsh 检测 / 名片弹窗 / 斑马头位置 / 中间回复样式 */
  ['root', 'verify-r122-ui-tweaks', 300],
  /** 第 110 轮真机：两条回复都保留 + 操作各归各的；整理特效真实 DOM + 完成音一次 */
  ['root', 'verify-r110-replies-ui', 180],
  ['root', 'verify-r110-voice-ui', 180],
  /** 第 112 轮真机：卡片手柄去除/授权添加靠左/话筒箭头贴合/中间回复一行折叠/语音按光标插入/亮字切换 */
  ['root', 'verify-r112-ui', 240],
  ['root', 'verify-r113-ui', 240],
  /** 第 114 轮真机：我的页三个数据入口可见、设置页已移除、全量加密状态 */
  ['root', 'verify-r114-ui', 180],
  /** 第 115 轮修复：历史认证巡游门禁（首启语言/退出登录/登录页返回） */
  ['root', 'verify-r78-auth-tour', 300],
  /** 第 111 轮真机：定时导出/手动导出弹窗不超高、范围只有一棵细化树、循环次数+间隔同一行 */
  ['root', 'verify-r111-data-ui', 180],
  /** 第 111 轮真机：真实注册 → keyEnvelope + memory.db 迁密文 + 加密记忆可写 */
  ['root', 'verify-r111-auth-storage-ui', 240],
  /** 第 119 轮真机：创建牛马的运行环境选项 + 容器实例未就绪禁用 */
  ['app-shell', 'verify-r119-instance-devenv-ui', 180],
  ['app-shell', 'verify-runtime-errors', 600],
  ['root', 'verify-round12', 900],
  // round16 从清单里挪出：它的 ①②⑤（本地模型写 5200 字长文落盘）与 ⑥ 在**换回 HEAD 的 electron-main.ts + context-renderer.ts** 后同样红 ⇒ 第 21 轮遗留，不是本轮引入（见 docs/ROUND12-LEDGER.md 第 22 轮）
  ['root', 'verify-round16', 3000], // 本机 27B 写 5200 字长文：实测单轮 700 秒量级 ⇒ 预算给足（不够就是仪器先超时）
  ['root', 'verify-round17', 2400],
  ['root', 'verify-round18', 900],
  ['root', 'verify-round18b', 900],
  ['root', 'verify-round18c', 900],
  ['root', 'verify-round18d', 900],
  ['root', 'verify-round18e', 900],
  ['root', 'verify-round18f', 900],
  ['root', 'verify-round19', 900],
  ['root', 'verify-round20-team', 1500, ['--ollama']],
  /** 同一支用云端 MiMo 再跑一遍（要 MIMO_KEY_FILE；没 key 时它自己判红"什么都没跑"，不会假绿） */
  ['root', 'verify-round20-team', 900],
  ['root', 'verify-round27-live', 300],
  ['root', 'verify-round28-live', 1200],
  ['root', 'verify-round34-ui', 600],
  ['root', 'verify-round34-live', 2400],
  ['root', 'verify-round38-asr', 400],
  ['root', 'verify-round38-qr', 200],
  ['root', 'verify-round38-restart', 600],
  ['root', 'verify-round39-longchat', 900],
  /**
   * 会话历史持久化（第 44 轮后半 · 用户 #7「写入侧不许丢原文」的验收）：
   * 自己 spawn Electron 副本（真重启 + 真记忆服务 + mock 供应商）⇒ 归 live 档，跑前要清场/占坑。
   * 以前它**不在任何一档里**，所以"原文不丢 + 锚点可执行"从来没有被验收遍覆盖过（2026-10-19 补上并转绿）。
   */
  ['app-shell', 'verify-history-persist', 900],
  ['root', 'verify-round39-quota-ui', 700],
  /** 第 48 轮：能力表随设置当场生效 + 手动添加模型真落盘（真界面 + 真 Ollama 验证 + 同 profile 重启；r34 本地腿 7 红的根因） */
  ['root', 'verify-r48-nengli-tongbu', 900],
  /** 第 48 轮：中间回复画进「执行过程」且重启不丢；写完的轮次重启后不被当成"被中断"（假模型 SSE + 真界面 + 同 profile 重启） */
  ['root', 'verify-r48-zhongjian-ui', 600],
  ['root', 'verify-round40-heartbeat-live', 600],
  ['root', 'verify-round40-heartbeat-wake', 600],
  /** 第 44 轮（用户项 1/2/3/4 与项 5 T15）：两支都要起真 Electron ⇒ 都归 live 档 */
  ['root', 'verify-r44-ui', 1800],
  ['root', 'verify-r44-shejiao', 1200],
  /** 第 44 轮后半（用户第 9 条）：token 真实化的真进程证明（3 次启动 + 真 Ollama 往返 ⇒ ~6 分钟） */
  ['root', 'verify-r44-token-live', 420],
  ['root', 'verify-round35-ui', 600],
  /** 第 68 轮：首启语言页并排布局 + 品牌牛/月亮/循环动画真机判据（临时 profile） */
  ['root', 'verify-r68-firstrun-ui', 180],
  /** 第 68 轮：条款无勾选框 + 注册直达助记词 + 全拼 24/12 组 + 登录页 PIN/两入口真机判据 */
  ['root', 'verify-r68-auth-ui', 240],
  /** 第 68 轮：我的页布局/自动登录联动 + 助记词登录后旧 PIN/旧自动登录失效（临时 vault） */
  ['root', 'verify-r68-auth-security', 120],
  /** 第 68 轮：五幕「静谧 · 幽深 · 宏大」像素冲锋预览（本地页面 + 真 Chromium） */
  ['root', 'verify-r68-charge-preview', 180],
  /** 第 69 轮：项目/群聊第二列去掉「+」，图标打开左加入/右创建一体化窗口（临时 profile） */
  ['root', 'verify-r69-join-create', 180],
  /** 第 70 轮：牛马管理局预算滑杆（同聊天框样式/32K 下限）+ 我的页名称落盘与称呼提示词（临时 profile） */
  ['root', 'verify-r70-budget-name', 180],
  /** 第 73 轮：P0-6 白名单 D —— 自动加入的能力类别可审计、可一键撤销（临时 profile） */
  ['root', 'verify-r73-nengli', 180],
  /** 第 105 轮：真模型连续 5 轮（R1 问答 / R2 多工具切段 / R3 停止+继续 / R4 设置+4K / R5 上下文记忆）。
   *  要 MiMo token（WARMY_KEY_DIR 或仓库上级目录的 tp-*.txt）；没 key 时脚本判红，不会假绿。 */
  ['root', 'r105-live-5-rounds', 1800],
  ['root', 'verify-r106-interim-ui', 180],
  ['root', 'verify-ui-lag', 900],
  ['root', 'verify-click-lag', 900],
];

/**
 * 压力档（第 45 轮 · 用户点名的两套新档，都要求真模型/真浏览器，单跑一整轮很贵）：
 *  · **A 网页小游戏 6 轮**：连做 6 轮，每轮当场验收产物，最后一轮**在真 Chromium 里跑起来**（像素指纹证明它在动、按键有反应）；
 *  · **B 记忆 2M 字符/轮**：每轮用户内容 2,000,000 字符（用户口径："2M 指用户送进来的量，不是发给模型的量"），
 *    固定开销按生产实测值压进来 ⇒ 验的是"视图只剩一点时，原文丢不丢、能不能召回"。
 * ⚠️ B 的**满档**（6000 轮 × 2M ≈ 28.5 GiB、本机实测 3 轮 14.25 MB / 15 秒线性外推 ≈ 8 小时）不在验收清单里跑：
 *    清单里跑的是**已测代价的缩放档**（30 轮），满档要人工确认后用 `--yesBig` 单独跑（见脚本头与账本）。
 */
const STRESS = [
  /**
   * A 档实测代价（本机 Ollama · Qwen3 27B q4）：**单轮 700 秒量级**（第 2 轮 718 秒），6 轮 + 纠正/返修
   * ⇒ 一整档 60–90 分钟。预算给到 7200 秒；轮内超时由脚本自己的 `YI_LUN_CHAO_SHI`（默认 30 分钟/轮）管。
   */
  ['root', 'verify-r46-youxi', 7200],
  ['root', 'verify-memory-stress', 1800, ['--rounds', '30', '--runs', '1', '--turnChars', '2000000', '--no-probe']],
];

const QINGDAN0 = TIER === 'live' ? LIVE : (TIER === 'stress' ? STRESS : FAST);
/** `--skip=verify-round16,verify-x` 把**已归因为预存在**的门禁暂时挪出清单（不改代码、只在日志里写明跳过原因） */
/**
 * Qoder/CI 环境可能带着 `ELECTRON_RUN_AS_NODE=1`：它会让所有 Electron 子进程按 Node 解析参数，
 * `--user-data-dir` 直接被判 bad option（第 65 轮第 1 遍 r62/r63-net 的红因）。门禁是"跑真机"，
 * 不是当 Node 用 —— 在派生子进程前统一摘掉。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
const SKIP = new Set((argv.find((a) => /^--skip=/.test(a)) || '').split('=')[1]?.split(',').filter(Boolean) || []);
const QINGDAN = QINGDAN0.filter(([, id]) => !SKIP.has(id));
for (const [, id] of QINGDAN0) if (SKIP.has(id)) console.log(`  · 跳过 ${id}（已归因，见 docs/HANDOFF-NEXT.md 遗留项）`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'GATE-MANIFEST.json'), 'utf8'));
const KNOWN_RED = new Set(manifest.entries.filter((e) => e.status === 'known-red').map((e) => e.id));

function luJing(where, id) {
  /** 第 37 轮：根级门禁已收进 `dev/gates/`（仓库整理），这里跟着走 */
  if (where === 'root') return path.join(root, 'dev', 'gates', id + '.mjs');
  if (where === 'spikes') return path.join(root, 'spikes', id + '.mjs');
  if (where === 'sync-protocol') return path.join(root, 'packages', 'sync-protocol', 'scripts', id + '.mjs');
  return path.join(root, 'packages', 'app-shell', 'scripts', id + '.mjs');
}

/**
 * **采样进程**（三处共用）。原来三处各自 `JSON.parse(execFileSync(...))` + `catch` 返回"零个/空表"：
 * 一台 electron 都没有时 `ConvertTo-Json` 给的是**空串** ⇒ `JSON.parse('')` 抛 ⇒ 落进同一个 catch，
 * 于是"查询失败"与"场地真的空"共用一个返回值。查询失败被读成"空场地"就会起第二支真机门禁，
 * 两边读数全废 —— 正是这道闸门要防的事。现在把两者分开：**查不到就返回 null**，调用方一律当"占着/未知"处理。
 */
function dianZiCheng() {
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "name=\'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const raw = String(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 }) || '');
    if (!raw.trim()) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [j];
  } catch { return null; }
}

/**
 * **只清自己起的**：命令行里带 `--remote-debugging-port` 的 electron（真机门禁的调试壳）。
 * 用户的正式实例没有这个参数 ⇒ 绝不误杀。
 */
function qingChang() {
  const arr = dianZiCheng();
  if (arr === null) return 0;
  const kou = arr.filter((p) => /remote-debugging-port/.test(String(p.CommandLine || '')));
  for (const p of kou) {
    try { execFileSync('taskkill', ['/PID', String(p.ProcessId), '/T', '/F'], { encoding: 'utf8', timeout: 30000 }); } catch { /* 已经退了 */ }
  }
  return kou.length;
}

/**
 * **坑位闸门**（第 38 轮自己踩出来的规矩，写成机械的、不靠记性）：
 * 真机门禁共用同一条真实桌面 + 同一个单实例锁 ⇒ **两串真机验证并行 = 两边的读数全都作废**。
 * 上一轮就是这么把自己的验收污染掉的（日志还在长大就起了下一串）。
 * 所以每遍 live 起跑前先数"这台机器上到底还有几个 electron 在跑我们的应用"，
 * 等不到 0 就**直接退出**（而不是硬跑一遍假绿）。
 */
function dianZiShu() {
  const arr = dianZiCheng();
  /** 采样失败返回 -1 = "未知，按占着处理"（宁可中止这一遍，也不并发两支真机门禁）；真的空场地是 0 */
  if (arr === null) return -1;
  /**
   * 第 44 轮改过这一条。原来它数**所有** `electron-main.js` 进程 ⇒ 用户自己开着应用（没带调试端口）时
   * 坑位永远"不空"，live 档整整 180 秒后直接中止，而 `results` 是空的 ⇒ 汇总写"无产品红（0 项次）"、**退出码 0**。
   * 驱动器把这一遍当成绿了 —— 空跑判绿比判红危险得多。
   * 现在：坑位只拦**别的真机验证串**（它们带 `--remote-debugging-port`，会共用同一条真实桌面，并行 = 两边读数全废）；
   * 用户自己的实例由下面的 `yongHuShiLiZaiPao()` 单独报，依赖真实 userData 的门禁会被标成"环境阻塞"（不算产品红、也不算验过）。
   */
  return arr.filter((p) => /electron-main\.js/.test(String(p.CommandLine || '')) && /remote-debugging-port/.test(String(p.CommandLine || ''))).length;
}
function dengKeng(dengMaxMs = 180000) {
  const kaiShi = Date.now();
  for (;;) {
    const n = dianZiShu();
    if (n === 0) return true;
    if (Date.now() - kaiShi > dengMaxMs) {
      console.log(n < 0 ? '\n✗ 坑位状态查不到（进程采样失败）⇒ 按"被占"处理，这一遍不跑。'
        : `\n✗ 坑位没空：还有 ${n} 个 electron 实例在跑（可能有另一串真机验证正在进行）。`);
      console.log('  两串真机门禁并行 ⇒ 两边读数全部作废，所以这一遍**不跑**。等它跑完再来。');
      return false;
    }
    console.log(`  · 等坑位：${n < 0 ? '采样失败（按占着处理）' : n + ' 个 electron 实例还在跑'}（已等 ${Math.round((Date.now() - kaiShi) / 1000)}s）`);
    const shou = new Date(Date.now() + 5000);
    while (Date.now() < shou.getTime()) { /* 5 秒一轮 */ }
  }
}

/**
 * 有没有**用户自己的实例**在跑（没有 --remote-debugging-port、却加载了 electron-main.js）。
 *
 * 为什么要单独报：一批真机门禁（round12–19 等）**故意在真实 userData 上跑**（要验的就是真配置），
 * 而应用是"禁止多开"的：第二个实例拿到锁失败就立刻退出 ⇒ 调试端口根本起不来 ⇒
 * 日志里只有一句 "CDP not up"，看起来像产品坏了，其实是**用户的应用没关**。
 * 这里提前说清楚，别让下一个人去改代码找不存在的 bug。
 */
function yongHuShiLiZaiPao() {
  const arr = dianZiCheng();
  if (arr === null) return [];
  const xiao = arr.filter((p) => /electron-main\.js/.test(String(p.CommandLine || '')) && !/remote-debugging-port/.test(String(p.CommandLine || '')));
  return xiao.map((p) => Number(p.ProcessId));
}

function ziJianAssetsFresh() {
  const zuiXin = (dir, exts, skip) => {
    let m = 0;
    if (!fs.existsSync(dir)) return m;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip && skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) m = Math.max(m, zuiXin(p, exts, skip));
      else if (exts.some((x) => e.name.endsWith(x))) m = Math.max(m, fs.statSync(p).mtimeMs);
    }
    return m;
  };
  const srcM = zuiXin(path.join(root, 'packages', 'app-shell', 'src'), ['.ts', '.cjs'], new Set(['renderer', 'i18n', 'assets']));
  const distM = zuiXin(path.join(root, 'packages', 'app-shell', 'dist'), ['.js', '.cjs', '.map'], null);
  const okRun = distM >= srcM;
  console.log(`  [${okRun ? 'PASS' : 'FAIL'}] verify-assets-fresh   dist=${new Date(distM).toISOString()} src=${new Date(srcM).toISOString()}`);
  return okRun;
}

function pao(where, id, extra, msLimit) {
  if (where === 'assets') return { ok: ziJianAssetsFresh(), ms: 0, tail: '' };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [luJing(where, id), ...(extra || [])], {
    cwd: root, encoding: 'utf8', timeout: msLimit * 1000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WARMY_AUTH_BYPASS: '1' },
  });
  const out = String(r.stdout || '') + '\n' + String(r.stderr || '');
  /**
   * 尾巴里**优先挑失败行**：红的时候只截最后 3 行常常看不到"红在哪一条"
   * （本轮就有一次 verify-tool-calls 红，日志里只剩一句 FAILED，无法复盘）。
   */
  const hang = out.split('\n').filter((l) => l.trim());
  const shibai = hang.filter((l) => /FAIL|失败项|Error|崩溃|超时/i.test(l)).slice(0, 6);
  const wei = (shibai.length ? shibai : hang.slice(-3)).join(' | ').slice(0, 700);
  const timedOut = r.error?.code === 'ETIMEDOUT' || (!!r.signal && /SIGTERM|SIGKILL/i.test(String(r.signal)));
  return { ok: r.status === 0, ms: Date.now() - t0, tail: wei, signal: r.signal || '', timedOut, status: r.status, error: r.error?.code || '' };
}

/**
 * 全验判分：**只有"每一遍 × 每一个必测项都真的跑过且通过"才算通过**。
 * 缺文件、被 --skip 跳过、环境阻塞、超时、known-red、轮数没跑满，一律不能给全验通过。
 * 这是纯函数，`--self-test` 用反例自证它不是恒真。
 */
function panDingQuanYan({ results, expectedIds, times, skippedIds, roundsCompleted, tier }) {
  const reasons = [];
  if (roundsCompleted !== times) reasons.push(`只完成 ${roundsCompleted}/${times} 遍`);
  if (skippedIds.length) reasons.push(`被 --skip 跳过：${skippedIds.join(',')}`);
  for (let lun = 1; lun <= times; lun++) {
    for (const id of expectedIds) {
      const r = results.find((x) => x.lun === lun && x.id === id);
      if (!r) { reasons.push(`第 ${lun} 遍缺少 ${id}`); continue; }
      if (r.ok) continue;
      const why = r.missing ? '缺文件' : r.blocked ? '环境阻塞' : r.timedOut ? '超时' : r.knownRed ? 'known-red 未真正通过' : '失败';
      reasons.push(`第 ${lun} 遍 ${id}：${why}${r.status !== undefined && r.status !== 0 ? `（exit=${r.status}）` : ''}`);
    }
  }
  return { pass: reasons.length === 0, reasons, tier };
}

function ziJianPanDing() {
  const mk = (lun, id, extra = {}) => ({ lun, tier: 'fast', id, ok: true, knownRed: false, ms: 1, ...extra });
  const ids = ['a', 'b'];
  const allPass = [mk(1, 'a'), mk(1, 'b'), mk(2, 'a'), mk(2, 'b')];
  assert.equal(panDingQuanYan({ results: allPass, expectedIds: ids, times: 2, skippedIds: [], roundsCompleted: 2, tier: 'fast' }).pass, true);
  assert.equal(panDingQuanYan({ results: allPass.slice(0, 3), expectedIds: ids, times: 2, skippedIds: [], roundsCompleted: 2, tier: 'fast' }).pass, false, '少一项必须红');
  assert.equal(panDingQuanYan({ results: allPass, expectedIds: ids, times: 2, skippedIds: ['b'], roundsCompleted: 2, tier: 'fast' }).pass, false, 'skip 必须红');
  assert.equal(panDingQuanYan({ results: allPass.slice(0, 2), expectedIds: ids, times: 2, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, '轮数没跑满必须红');
  assert.equal(panDingQuanYan({ results: [mk(1, 'a'), mk(1, 'b', { ok: false })], expectedIds: ids, times: 1, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, '非零退出必须红');
  assert.equal(panDingQuanYan({ results: [mk(1, 'a', { ok: false, timedOut: true }), mk(1, 'b')], expectedIds: ids, times: 1, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, '超时必须红');
  assert.equal(panDingQuanYan({ results: [mk(1, 'a', { ok: false, knownRed: true }), mk(1, 'b')], expectedIds: ids, times: 1, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, 'known-red 不能算全验');
  assert.equal(panDingQuanYan({ results: [mk(1, 'a', { ok: false, missing: true })], expectedIds: ids, times: 1, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, '缺文件必须红');
  assert.equal(panDingQuanYan({ results: [mk(1, 'a', { ok: false, blocked: true })], expectedIds: ids, times: 1, skippedIds: [], roundsCompleted: 1, tier: 'fast' }).pass, false, '环境阻塞必须红');
  console.log('runner 自证：少项/skip/轮数不足/非零退出/超时/known-red/缺文件/阻塞 均判红；全通过才判绿');
  console.log('✓ run-verify-22 判分自证通过（9 个反例）');
}
if (argv.includes('--self-test')) {
  ziJianPanDing();
  process.exit(0);
}

const results = [];
/** 必测全集（含被 --skip 的项）：跳过不等于不存在，跳过会让全验判红 */
const expectedIds = QINGDAN0.map(([, id]) => id);
const skippedIds = [...SKIP];
if (skippedIds.length) {
  console.log(`\n⚠ 已请求跳过 ${skippedIds.length} 项：${skippedIds.join(', ')}`);
  console.log('  诊断运行可以跳过；但这一遍**不能**算完整验收通过（判分不会把跳过当绿）。');
}
const ZHEN_JI = TIER === 'live' || TIER === 'stress';
const yonghuPids = ZHEN_JI ? yongHuShiLiZaiPao() : [];
/** 压力档与真机档一样要清场：两边都会起 Electron，遗留实例会占住单实例锁与调试端口 */
const yaoQingChang = ZHEN_JI;
let roundsCompleted = 0;
if (yonghuPids.length) {
  console.log(`\n⚠ 检测到**用户自己的应用实例**正在运行（PID ${yonghuPids.join(', ')}）。`);
  console.log('  应用禁止多开：真机门禁里那些"故意在真实 userData 上跑"的（round12–19、ui-lag、click-lag…）');
  console.log('  第二个实例拿不到单实例锁会立刻退出 ⇒ 调试端口起不来 ⇒ 只会报 "CDP not up"。');
  console.log('  这类失败在下面记为【环境阻塞】，不算产品红。**要真验这批，请先关闭应用再跑一遍。**');
}
for (let lun = 1; lun <= TIMES; lun++) {
  console.log(`\n######## 第 ${lun}/${TIMES} 遍 · tier=${TIER} ########`);
  if (yaoQingChang && !dengKeng()) { console.log('\n=== run-verify-22 中止：坑位未空，未产生任何读数 ==='); break; }
  let hong = 0, jzh = 0, que = 0;
  for (const [where, id, ms, extra] of QINGDAN) {
    if (where !== 'assets') {
      const f = luJing(where, id);
      if (!fs.existsSync(f)) {
        que++;
        console.log(`  [缺失] ${id}（${f}）`);
        results.push({ lun, tier: TIER, id, ok: false, knownRed: false, blocked: false, missing: true, ms: 0 });
        continue;
      }
    }
    let qing = 0;
    if (yaoQingChang) qing = qingChang();
    if (qing) console.log(`  · 清场：收掉 ${qing} 个遗留调试实例`);
    const r = pao(where, id, extra, ms);
    if (yaoQingChang) qingChang();
    /** 用户实例占着真实 userData ⇒ 这类红不是产品红，单独记（别让人去修不存在的 bug） */
    const beiSuo = !r.ok && yaoQingChang && yonghuPids.length > 0 && /CDP not up|no CDP/i.test(String(r.tail || ''));
    const biaoji = r.ok ? 'PASS' : KNOWN_RED.has(id) ? '已知红' : beiSuo ? '环境阻塞' : r.timedOut ? '超时' : 'FAIL';
    if (!r.ok && !KNOWN_RED.has(id) && !beiSuo) hong++;
    if ((KNOWN_RED.has(id) || beiSuo) && !r.ok) jzh++;
    console.log(`  [${biaoji.padEnd(5)}] ${(id + (extra && extra.length ? ' ' + extra.join(' ') : '')).padEnd(32)} ${String(r.ms).padStart(8)}ms${r.ok ? '' : '  ' + r.tail}`);
    results.push({ lun, tier: TIER, id, ok: r.ok, knownRed: KNOWN_RED.has(id), blocked: beiSuo, timedOut: r.timedOut, status: r.status, ms: r.ms });
  }
  roundsCompleted += 1;
  console.log(`\n---- 第 ${lun} 遍汇总（tier=${TIER}）：真红 ${hong} · 已知红(环境依赖) ${jzh} · 缺文件 ${que} ----`);
  if ((hong || que) && !argv.includes('--keep-going')) { console.log('有红项 ⇒ 停止后续轮次（如实报，不硬凑十遍）'); break; }
}
const zong = results.filter((r) => !r.ok && !r.knownRed && !r.blocked).length;
const zongShu = results.length;
const beiSuoShu = results.filter((r) => r.blocked).length;
const pan = panDingQuanYan({ results, expectedIds, times: TIMES, skippedIds, roundsCompleted, tier: TIER });
console.log('\n=== run-verify-22 tier=' + TIER + '：' + TIMES + ' 遍 · ' + (pan.pass ? '完整全验通过' : '未通过') + ' · 项次 ' + zongShu + ' ===');
if (zong) console.log('  产品红：' + zong);
if (beiSuoShu) console.log('  环境阻塞（用户实例/坑位）：' + beiSuoShu);
if (!pan.pass) {
  console.log('  不能给完整通过的原因（最多列 20 条）：');
  for (const r of pan.reasons.slice(0, 20)) console.log('   - ' + r);
  if (pan.reasons.length > 20) console.log(`   … 另有 ${pan.reasons.length - 20} 条`);
}
fs.writeFileSync(
  path.join(root, `verify-22-${TIER}-${TIMES}x.log`),
  results.map((r) => `${r.lun}\t${r.ok ? 'PASS' : r.missing ? 'MISSING' : r.blocked ? 'BLOCKED' : r.timedOut ? 'TIMEOUT' : r.knownRed ? 'KNOWN-RED' : 'FAIL'}\t${r.id}\t${r.ms}ms`).join('\n')
    + `\n# verdict=${pan.pass ? 'PASS' : 'FAIL'}; requested=${TIMES}; completed=${roundsCompleted}; skipped=${skippedIds.join(',') || '-'}; reasons=${pan.reasons.length}\n`,
  'utf8'
);
process.exit(pan.pass ? 0 : 1);
