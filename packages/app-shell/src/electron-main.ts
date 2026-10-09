/**
 * Electron 主进程 — 零原生模块
 * 注意：Windows 中文路径下 fork 子进程可能乱码，memory ipc 先拷到 userData（ASCII）
 */
import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, Tray, nativeImage, globalShortcut, screen, desktopCapturer, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chuangJianP1YunXingShi } from './runtime.js';
import {
  JiyiCangKeHu,
  memoryToolSpecs,
  yunxingJiyiCangGongju,
  chatRoleOfRecordId,
  neirongZhaiyao,
  DEFAULT_MEMORY_TOOL_LABELS,
  type JiyiCangGongjuBiaoqian,
} from './memory-client.js';
import { GroupChatRouter, DEFAULT_PERMISSIONS } from '@warmy/group-router';
import { KanbanCang, JieLing } from '@warmy/board';
import {
  congYuSheChuangJian,
  liaoTianDaiGongJu,
  gongYingZhiChiGongJu,
  neiRongWenBen,
  moXingNengLi,
  gouJianDangWeiAnShe,
  pinJieUrl,
  type LiaoTianXiaoXi,
  type LiaoTianQingQiu,
  type MoxingGongYing,
  type GongJuXunHuanGuo,
  type GongJuGuiGe,
  type GongJuDiaoYong as GongJuDiaoYongTi,
} from '@warmy/providers';
import { CcrGateway } from '@warmy/ccr-compressor';
import { KnowledgeBase } from '@warmy/knowledge-base';
import { EtaZhangBen, EtaLinShi, shuoShiChang, renWuQianMing, jiaEtaMiao, xingWeiGui, XING_WEI_MOREN, CHAO_SHI_LIAN_XU_XIAN, PAN_MO_XING_SHANG_XIAN, jieXiKaPanDuan, shiLiaoTianMoXing, type EtaYuCe, type XingWei } from './eta-forecast.js';
import { JianChaDianCang } from './checkpoint.js';
import { ShenJiRiZhi } from './audit.js';
import { DAO_MOREN } from './dao-default.js';
import { FIND_SKILL_MD } from './skills-default.js';
import { AnQuanMiyaoCang } from './secure-keys.js';
import * as credentialModule from './credential.js';
import { ZhiShiGuiDangQi, QingLiGuanLiQi, congGuiDangTiQuZhiShi, heBingYongHuPianHao, tiQuJieGouHuaZhaiYao } from './archive-cleanup.js';
import { type JueseMoxingPeizhi } from './model-roles.js';
import { xietiaoQunXiaoxi, buildStatusCard } from './orchestrator.js';
import { projectMemoryForContext, readProjectMemory, writeProjectMemory } from './project-memory.js';
import { AiWenTiZhongXin, AI_QUESTION_CUSTOM } from './ai-questions.js';
import { daiHuiDuYanZheng, anGuiFanHuaQuChong, guiFanLuJingMiyao } from './read-back.js';
import {
  xuanranYoujieShitu,
  DEFAULT_CONTEXT_BUDGET_CHARS,
  DEFAULT_KEEP_HEAD,
  DEFAULT_KEEP_TAIL,
  type LogEntry,
} from './context-renderer.js';
import { yunxingDuanCunhuoZhixingqi, yunXingZhiXingQiJi } from './executor.js';
import { chuShiZiChanGuanLi, retrieveAssetsForChat, zhuCeLiaoTianZiChan, jiLuZiChanShiYong, qingLiZiChan } from './asset-wire.js';
import { ZhiBiaoCaiJiQi } from './metrics.js';
import { BenDiZhangHuCang, PeizhiCang, shengChengPingzheng, type YingYongPeizhi, WARMY_DEFAULT_NET_PORT, SKILL_SCAN_DIRS_MAX,} from './settings-store.js';
/**
 * 执行环境探测器（ADR 004）：探测本机**已有**的容器运行时 + 驱动其启停。
 * 纯 node 模块（不依赖 electron），因此可以被 scripts/verify-container-probe.mjs 在真机上直接断言。
 */
import {
  tanCeRongQiYunXing,
  qingRongQiTanCeHuanCun,
  yunxingRongqiDongzuo,
  zuiHouRongQiTanCeBaoGao,
  rongQiYunXingGuiGeOf,
  CONTAINER_SHELL_SECURITY,
  rongQiKongZhiTaiMenJin,
  guiFanKongZhiTaiQingQiu,
  xiangMuYuanYinJian,
  xiangMuBuKeYongJuJue,
  deriveProjectState,
  huanJingGuHuaNengLi,
  quYinQingXiTongMoShi,
  shiFouGaiGuHua,
  guHuaBaoLiu,
  SOLIDIFY_KEEP,
  SOLIDIFY_COALESCE_MS,
  CONTAINER_BASE_IMAGES,
  /* ── 第十六批：真实的容器内执行 / 固化 / 回滚 / 宿主目录加锁 ── */
  yunXingRongQiZhiXing,
  rongQiXiangMuMing,
  shiFouHeFaRongQiXiangMuMing,
  solidifiedImageRef,
  shiFouYunXuJingXiang,
  RONGQI_XIANGMU_GUAZAI,
  CONTAINER_EXEC_SECURITY,
  CONTAINER_FIXED_COMMAND_IDS,
  ENV_SOLIDIFY_SECURITY,
  daKaiKongZhiTaiHuiHua,
  xieRuKongZhiTaiHuiHua,
  guanBiKongZhiTaiHuiHua,
  guanBiZhiDingHuiHua,
  zhuJiMuLuHuLanJiHua,
  HOST_DIR_GUARD_SECURITY,
  shiFouYongHuSid,
  type RongQiGuDingMingLingId,
  type RongqiXiangmuZhuangtai,
} from './container-probe.js';
import { lieYunXingShiLi, yunXingShiLiDongZuo, daKaiYunXingYingYong } from './container-instances.js';
import { ShenFenCang, type ChengYuanMingceCang } from './identity-store.js';
import {
  CONTACT_CARD_I18N,
  CONTACT_FREEZE_NOTE,
  DAISHU_GUIZE_BEIZHU,
  zhiwenPipei,
  isValidFingerprint,
  yanZhengShenFenKa,
  verifyRevocationDeclaration,
  verifyRotationDeclaration,
  type LianXiKa,
  type ShenFenKa,
  type ShenfenShengming,
  type YaoShiHuanTiaoMu,
  type LunHuanShengMing,
} from './identity.js';
import { QunCang, type QunLieBiaoJieGuo, type QunChengYuanJieGuo } from './group-store.js';
import {
  Gengxinqi,
  gengXinqiBuKeYongJianCha,
  gengXinqiBuKeYongXiaZai,
  jiaoyanGengxinyuanUrl,
  type GengXinJianChaJieGuo,
  type GengXinXiaZaiJieGuo,
  type GengXinYuanXinXi,
} from './updater.js';
import { duJsonWenJian, qingLiLinShiWenJian, anQuanYuanZiXieJson } from './atomic-json.js';
/**
 * ADR 004 第十六批：**工具文件访问台账**的接线。
 * helper-tool 之前**只写文件、不记路径** —— 这就是"最近改动文件"那块面板长期空态的原因之一。
 * 现在它的每一次真实读写都通过 sink 落到**项目记录**里（项目级、成员可见），
 * **不是**落到本机设置里（产品主：记录文件的改动是无限牛马的功能，不是本机的功能）。
 */
import { setFileAccessSink, withFileAccessScope, dangqianWenjianFangwenZuoyongyu } from './helper-tool.js';
import { isWorkTool, runWorkTool, workToolSpecs, workspaceDirOf, WORK_TOOL_SECURITY, WORK_TOOL_LIMITS, isHostTool, hostToolSpecs, yingSheYongHuWenJianJia, resolveInside, jieXiGongJuCanShu } from './work-tools.js';
import {
  anquanJianCeMingLing, anquanJianCeJiNeng, panDuanShouQuan, yunXingMingLing,
  duDocx, duPptx, zhuaQuWangZhi, xiaZaiWenJian,
  type AnquanDang,
} from './agent-tools.js';
import { jueCeMoXing, jieMoXingMing, type MoXingJueCeShuRu } from './model-pick.js';
import { daBaoNm, chaiBaoNm, duXinFeng } from './nm-wen-jian.js';
import { XiaoDiDengJiBu, xiaoDiToolSpecs, isXiaoDiTool } from './subagents.js';
import { JieDianMingCe, TongbuZongxian, chuangjianYaoQing, shiYongYaoQing } from '@warmy/sync-protocol';
import { findDshPackageDir, ensureDshProfile, writeDshInstanceEntry } from '@warmy/dsh-runtime';
// 组网：**鉴权通道**（SecureSyncServer/Client + 名册 + 持久化重放防护），旧 lan.ts/mesh.ts 只留数据层 PeerRegistry
import { DuiDuanMingCe } from '@warmy/sync-protocol';
import {
  NET_NOTES,
  SecureMesh,
  faxianGongWangIp,
  baoZhangWangLuoMuLu,
  lieBenJiDiZhi,
  benjiDizhiXinxi,
  xuanDuanKouHouXuan,
  tanCeWangLuo,
  secureLoopbackSmoke,
  tcpProbe,
  /* ── ADR 004 第十六批：**项目级属性**的跨机同步（记录文件的改动是产品功能） ── */
  XIANGMU_SHUXING_TONGDAO,
  XIANGMU_SHUXING_LEIXING,
  xiangmuShuxingXiaoxi,
  parseProjectAttrsMessage,
  projectAttrsToStateInput,
  xiangmuRuXiangMenjin,
  type WangzhuangDuiduanYinyong,
  type WangzhuangZhuangtaiJieguo,
  type KedaxingTishi,
  type AnQuanRuXiangXiaoXi,
} from './net-wiring.js';
// 身份 ↔ 组网的唯一接缝：指纹推导 + 签名者注入 + 「能否后台签名」的门控
import {
  ShenFenBuKeYongCuoWu,
  yingYongRuXiangCheXiaoGengXin,
  duanyanTuidaoPipei,
  buildIdentityChangeEntries,
  goujianChengyuanZaichang,
  chuangjianShenfenGongyingshang,
  chuangjianShenfenQianmingzhe,
  jieshiMingCeJueCe,
  yingYongCengZhiWenTuiDao,
  wentiChengyuanZhengshu,
  yiZhiLianXiZhiWenJi,
  lieDuiDuanLianXiShiTu,
  quChengYuanWenJian,
  chengYuanKuaiZhao,
  quChengYuanMingceCang,
  peerContactKeys,
  yaoQiuKeQianMingShenFen,
  chexiaoChengyuanZhengshu,
  lunHuanChengYuanZhengShu,
} from './identity-provider.js';
// 本体协作层：ref/路径门禁 + 租约（写操作前 acquire、写完 release）
import { jiaoYanTuiSongLuJing, jiaoYanYinYongGengXin, type TuiSongLuJingTiaoMu } from './repo-guard.js';
import { LeaseRegistry, type HuoQuQingQiu, type ZuYueYinYongQingQiu } from './lease.js';
import {
  chuangJianGitYunXingQi,
  chaZhaoGouZiJiaoBen,
  anzhuangYuXianJieShouGouZi,
  yunXingYuXianJieShou,
  type YuXianJieShouJieGuo,
} from './repo-hooks.js';
import { yanZhengSmtp, type SmtpPeizhi } from './smtp-verify.js';
import { jiexiYuyan, SUPPORTED_LOCALES } from './i18n/locales.js';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootLog = path.join(app.getPath('userData'), 'warmy-boot.log');

function qidong(xiaoXi: string) {
  try {
    fs.appendFileSync(bootLog, `${new Date().toISOString()} ${xiaoXi}\n`);
  } catch {
    /* ignore */
  }
}
qidong(`main loaded dir=${__dirname}`);
// 去掉 File/Edit/View/Window/Help 应用菜单
Menu.setApplicationMenu(null);

function loadMainStrings(yuYan: string | undefined): Record<string, string> {
  const f = jiexiYuyan(yuYan);
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', `${f}.json`), 'utf8'));
  } catch {
    return {};
  }
}
const MAIN_I18N = loadMainStrings(app.getLocale());
function tMain(k: string, huiTui = ''): string {
  return MAIN_I18N[k] || huiTui || k;
}

let win: BrowserWindow | null = null;
let p1: Awaited<ReturnType<typeof chuangJianP1YunXingShi>> | null = null;
let memory: JiyiCangKeHu | null = null;
const aiQuestions = new AiWenTiZhongXin();

/**
 * **任务栏 / 系统托盘专用图标**：白底版。
 *
 * 为什么单独一套：原图标是**透明底 + 棕色牛马标记**，放到深色任务栏/托盘上几乎看不清
 * （产品主："任务栏的图标和系统托盘的图标要有白色的底"）。白底版由
 * `packages/app-shell/scripts/gen-taskbar-icons.py` 生成（裁出墨迹 → 居中放在白色圆角方块上）。
 * **其它位置（标题栏/我的页/关于页）继续用原来的透明底图标**，不做改动。
 */
function warmyTaskbarIcon(): string {
  const candidates: string[] = [
    path.join(__dirname, 'renderer', 'icons', 'app-white.ico'),
    path.join(__dirname, 'renderer', 'icons', 'app-white-256.png'),
    path.join(__dirname, 'renderer', 'icons', 'app-white-64.png'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* next */ }
  }
  return warmyWindowIcon();
}

/** 窗口/托盘图标路径：产品 logo（yingYong.ico → logo.ico → build/icon.ico → png） */
function warmyWindowIcon(): string {
  const candidates: string[] = [
    path.join(__dirname, 'renderer', 'icons', 'yingYong.ico'),
    path.join(__dirname, 'renderer', 'icons', 'logo.ico'),
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'renderer', 'icons', 'app-256.png'),
    path.join(__dirname, 'renderer', 'icons', 'logo-256.png'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* next */ }
  }
  return candidates[0] as string;
}

/** 按项目类型自动选择 gateVerify（授权由产品主授予；防过度执行） */
function gateVerifyForProjectType(opts: { directory?: string; devEnv?: string; ming?: string }): string[] {
  const dir = String(opts.directory || '').replace(/\\/g, '/');
  const ming = String(opts.ming || '');
  const suoyinwen = `${ming} ${dir}`.toLowerCase();
  const isDocsOnly = /(^|[^a-z])(docs?|说明|readme|spec|adr|手册|guide)([^a-z]|$)/i.test(suoyinwen) &&
    !/(packages\/|src\/|node_modules|\.ts$|\.js$|\.py$|api|backend|frontend)/i.test(suoyinwen);
  const isCode =
    /package\.json|tsconfig|pyproject|cargo\.toml|go\.mod|pom\.xml|build\.gradle/i.test(dir) ||
    /(packages\/|src\/|backend|frontend|server|client|api|repo|monorepo)/i.test(suoyinwen) ||
    /code|开发|dev[-_]?env|工程/i.test(ming) ||
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|c|h)$/i.test(dir);
  const base = [
    'packages/app-shell/scripts/verify-docs.mjs',
    'packages/app-shell/scripts/verify-i18n-locales.mjs',
  ];
  if (isDocsOnly) return ['packages/app-shell/scripts/verify-docs.mjs'];
  if (isCode) {
    return [
      ...base,
      'packages/app-shell/scripts/verify-router-queue.mjs',
      'packages/app-shell/scripts/verify-memory.mjs',
    ];
  }
  return base;
}

/** 新项目默认门禁（授权由产品主授予；只跑轻量文档/一致性检查，防过度执行） */
const DEFAULT_GATE_VERIFY = [
  'packages/app-shell/scripts/verify-docs.mjs',
  'packages/app-shell/scripts/verify-i18n-locales.mjs',
];
const router = new GroupChatRouter({
  queueWhenFixedBusy: false,
  onQueueMutated: () => {
    luoPanLuYouQiDuiLie();
  },
});

/**
 * Router 队列持久化（userData/router-queues.json）。
 * 产品口径：队列是用户待办，**进程退出不得丢**；"弹出即丢弃"的旧实现已废弃。
 */
const ROUTER_QUEUES_VERSION = 1;
function routerQueuesFile(): string {
  try {
    return path.join(app.getPath('userData'), 'router-queues.json');
  } catch {
    return '';
  }
}
function luoPanLuYouQiDuiLie(): void {
  const file = routerQueuesFile();
  if (!file) return;
  try {
    anQuanYuanZiXieJson(file, router.serializeState());
  } catch {
    /* 落盘失败不影响运行 */
  }
}
function huiFuLuYouQiDuiLie(): void {
  const file = routerQueuesFile();
  if (!file) return;
  try {
    const snap = duJsonWenJian<{ version?: number } | null>(file, null);
    if (snap && (snap as { version?: number }).version === ROUTER_QUEUES_VERSION) {
      router.restoreState(snap as never);
    }
  } catch {
    /* 损坏快照：从空队列开始，不崩溃 */
  }
}

/** 渲染层「待执行队列」落盘（userData/ui-queues.json）—— 与 Router 队列分开，语义不同 */
function uiQueuesFile(): string {
  try {
    return path.join(app.getPath('userData'), 'ui-queues.json');
  } catch {
    return '';
  }
}
function luoPanJieMianDuiLie(queues: Record<string, unknown>): void {
  const file = uiQueuesFile();
  if (!file) return;
  try {
    anQuanYuanZiXieJson(file, { version: 1, savedAt: Date.now(), queues });
  } catch {
    /* ignore */
  }
}
function huiFuJieMianDuiLie(): Record<string, unknown> {
  const file = uiQueuesFile();
  if (!file) return {};
  try {
    const snap = duJsonWenJian<{ version?: number; queues?: Record<string, unknown> } | null>(file, null);
    if (snap && snap.version === 1 && snap.queues && typeof snap.queues === 'object') return snap.queues;
  } catch { /* ignore */ }
  return {};
}
let board: KanbanCang | null = null;
const ccr = new CcrGateway(4000);
let knowledge: KnowledgeBase | null = null;
let checkpoints: JianChaDianCang | null = null;
const metrics = new ZhiBiaoCaiJiQi();
let audit: ShenJiRiZhi | null = null;
let secureKeys: AnQuanMiyaoCang | null = null;
let archiver: ZhiShiGuiDangQi | null = null;
let cleanup: QingLiGuanLiQi | null = null;
let roleModels: JueseMoxingPeizhi = {};
let accountStore: BenDiZhangHuCang | null = null;
let settingsStore: PeizhiCang | null = null;
/**
 * 身份层（ADR 003 附五.2 第 1 步）：Ed25519 身份 + 公钥指纹 + 单调代次 + 加密私钥。
 * 它是握手 / DHT 签名 / 成员证书的共同前提，所以在启动时最先就绪。
 */
let identityStore: ShenFenCang | null = null;
/** 群列表 / 群成员的真实持久化（userData/groups.json） */
let groupStore: QunCang | null = null;
/** 自动更新（真实查询 + 真实下载校验；安装未实现） */
let updater: Gengxinqi | null = null;
let nodeReg: JieDianMingCe | null = null;
let syncBus: TongbuZongxian | null = null;
const emailQueue: Array<{ to: string; subject: string; text: string; ts: number }> = [];
let lastError: { ts: number; message: string; context?: string } | null = null;
let dengdaiPizhun = new Map<string, { resolve: (d: { allowed: boolean; scope: string }) => void }>();
let pizhunXulie = 0;
/**
 * 组网服务（**鉴权通道**）：一台 SecureSyncServer + 出站 SecureSyncClient。
 * 取代原先的 `LanSyncServer` / `MeshNode`（明文 JSONL、无握手、无身份）——
 * 那两处是"发一行 JSON 即 ACK"，任何能被连上的进程都能发/收消息。
 */
let secureMesh: SecureMesh | null = null;
let localNodeId = 'node-local';
let peerReg: DuiDuanMingCe | null = null;
/**
 * 本体协作层：任务/目录/文件租约（进程内唯一权威实例）。
 * 只保护"写入前的声明"：拿到租约才能写；写完释放。见 `lease.ts` 的接线说明。
 */
let leases: LeaseRegistry | null = null;
/** 换证横幅「已核实 / 已关闭」的本地留痕（审计是硬要求，落盘失败即拒绝关闭） */
let biangengQuerenWenjian = '';
/** 会话消息历史（主进程侧）—— 日志的镜像（不变量 #1/#5），视图由 chatLogs 渲染而来 */
const chatHistories = new Map<string, LiaoTianXiaoXi[]>();
/**
 * 会话日志（只追加，ADR 002 / 不变量 #1）：不变量 #2 的"日志"侧。
 * chat-send、群消息、值班者输入共用这一份；注入模型的是 renderBoundedView 的有界视图。
 */
const chatLogs = new Map<string, LogEntry[]>();
/**
 * 日志序号：单调计数器（ADR §6「seq 由单调计数器分配」，决定裁剪顺序）。
 * 记忆服务可用时对齐它分配的 seq，这样指针里的 `retrieve(seq=…)` 能走 sqlite:seq 精确命中。
 */
let chatLogSeq = 0;
/** recordId 内的单调后缀：`m-${Date.now()}` 同毫秒会撞 id（记忆服务里 id 是 UNIQUE，撞了就 REPLACE） */
let chatLogIdSeq = 0;
/** 视图预算下限（字符）：再小连可执行指针都放不下 */
const MIN_CONTEXT_BUDGET_CHARS = 200;

/**
 * 重启历史重建的上限（ADR 002 §9.4 待办 4）。
 * 只重建最近这些条：更早的记录**不丢**（JSONL 是唯一事实来源，seq/recordId 仍可 retrieve），
 * 只是不进本进程的日志镜像 —— 视图本来就有界，指针才是取回旧内容的通道。
 */
const HISTORY_RESTORE_LIMIT = 400;
const HISTORY_RESTORE_MAX_CHARS = 400000;
/** 记忆服务重新拉起的冷却：晚起/崩过的场景下别把 fork 打爆 */
const MEMORY_ENSURE_COOLDOWN_MS = 15000;

/**
 * 上一次历史重建的结果（可观测：IPC 与验证脚本都读它）。
 * `done` = 尝试已结束，`ok` = 真的从记忆服务重建成功。
 */
let historyRestore: {
  done: boolean;
  ok: boolean;
  entries: number;
  sessions: number;
  maxSeq: number;
  reason: string;
  trigger: string;
  at: number;
} = { done: false, ok: false, entries: 0, sessions: 0, maxSeq: 0, reason: '', trigger: '', at: 0 };
let memoryEnsureAt = 0;

function xiaYiLiaoTianXuLie(memSeq?: number): number {
  const s =
    typeof memSeq === 'number' && Number.isFinite(memSeq) && memSeq > chatLogSeq
      ? Math.floor(memSeq)
      : chatLogSeq + 1;
  chatLogSeq = s;
  return s;
}

function xinLiaoTianJiLuId(prefix: 'm' | 'a' | 'g'): string {
  chatLogIdSeq += 1;
  return `${prefix}-${Date.now()}-${chatLogIdSeq}`;
}

/** 记忆服务 IPC 的 append 回包是 { ok, seq }；兼容直接返回记录对象的实现 */
function memSeqOf(res: unknown): number | undefined {
  const r = res as { seq?: unknown; result?: { seq?: unknown } } | null | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const n = Number(r.seq ?? r.result?.seq);
  return Number.isFinite(n) ? n : undefined;
}

/** 会话日志 → 模型消息数组（chatHistories 只是它的派生镜像，见下） */
function quHuiHuaXiaoXiJi(key: string): LiaoTianXiaoXi[] {
  return (chatLogs.get(key) || []).map((e) => ({ role: e.role, content: e.content }));
}

/**
 * 只追加日志（不变量 #1）+ 同步派生镜像。
 * **唯一写入点**：只有这样，"chatHistories 与 chatLogs 是同一份东西"才是结构性成立的，
 * 而不是靠每个调用点自觉（历史 bug 就是两处各自 push，重启后一起清零、与 JSONL 脱节）。
 */
/**
 * **跨窗口广播**：主窗口与独立会话窗是同一份数据的两个视图，
 * 必须都收到同一份变化通知（否则"在新窗口里发的消息，主界面看不到"）。
 *
 * `exceptId` = 发起方自己的 webContents.id：跳过它，避免自己触发自己再渲染一遍。
 */
function broadcastToWindows(channel: string, payload: unknown, exceptId?: number): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (w.isDestroyed()) continue;
        if (exceptId !== undefined && w.webContents.id === exceptId) continue;
        w.webContents.send(channel, payload);
      } catch {
        /* 窗口正在销毁：丢一条通知不影响主流程 */
      }
    }
  } catch {
    /* 广播绝不冒泡到调用方 */
  }
}

/**
 * 角色归一：同一条消息有两条写入路径 ——
 *   · 主进程 chat-send / 群聊编排写的是 `user` / `assistant`；
 *   · 渲染层统一推送里补写的是 `wo` / `them`。
 * 去重按 role 比对，两种写法并存就会**两条都写进日志** ⇒ 合并时同一句话显示 2 遍（本轮真事故）。
 * 一律归一成 `user` / `assistant`，其它角色（system 等）原样保留。
 */
function guiYiJiaoSe(role: string): string {
  const r = String(role || '').toLowerCase();
  if (r === 'wo' || r === 'user') return 'user';
  if (r === 'them' || r === 'assistant') return 'assistant';
  return String(role || '');
}

/**
 * 每个模型**实际支持**的思考档位（拉取模型时从端点元数据里记下来；拿不到就空）。
 * 我们的 8 档按**比例**映射到这份清单上 —— 档数不同也能正确对应。
 */
const modelThinkMeta = new Map<string, string[]>();
/** 模型能力（视觉/思考/工具/种类/上下文长度）——拉模型时问出来的 + 已知表兑底 */
const modelNengLiMeta = new Map<string, { vision: boolean | 'unknown'; thinking: boolean | 'unknown'; tools: boolean | 'unknown'; thinkLevels: string[]; source: string; kind?: string; contextLen?: number }>();
/** 思考档位映射（我们的档 ↔ 该模型的档）——拉取模型时构建，使用时直接查 */
const modelDangWeiAnShe = new Map<string, { woDaoMo: Record<string, string | null>; moDaoWo: Record<string, string> }>();

/** 我们的 8 档 → 归一化强度：-1=关闭，null=自动（交系统），0..1=强度 */
function siKaoQiangDu(level: string | undefined): number | null {
  const order = ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'auto'];
  const i = order.indexOf(String(level || 'auto'));
  if (i === 0) return -1;
  if (i < 0 || i === order.length - 1) return null;
  return (i - 1) / (order.length - 3);
}
/** 把 0..1 强度按比例映射到目标档位清单（1 档 → 唯一档；n 档 → 四舍五入取位） */
function yingSheDangWei(qiang: number, dangWei: string[]): string {
  if (!dangWei.length) return '';
  if (dangWei.length === 1) return String(dangWei[0] ?? '');
  const i = Math.round(Math.max(0, Math.min(1, qiang)) * (dangWei.length - 1));
  return String(dangWei[Math.max(0, Math.min(dangWei.length - 1, i))] ?? '');
}

/**
 * 思考级别 → 请求附加参数。
 * **按拉取模型时建好的映射表**发（各家档数不同也能正确对应）；
 * 没有映射表就按强度比例现算一次兜底。
 */
function siKaoCanShu(level: string | undefined, urgency: string | undefined, modelId?: string): Record<string, unknown> | undefined {
  const q = siKaoQiangDu(level);
  const mid = String(modelId || '');
  const anShe = modelDangWeiAnShe.get(mid) || gouJianDangWeiAnShe(modelThinkMeta.get(mid) || []);
  if (q === -1) {
    const off = anShe.woDaoMo.off;
    return off ? { enable_thinking: false, thinking_level: off, reasoning_effort: off } : { enable_thinking: false };
  }
  let qq = q;
  if (qq === null) {
    const u = String(urgency || 'P2');
    qq = (u === 'P0' || u === 'P1') ? 0.85 : (u === 'P3' ? 0.15 : 0.5);
  }
  // 0..1 强度 → 我们的 l1..l6 → 该模型的档
  const liu = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
  const idx = Math.round(Math.max(0, Math.min(1, qq)) * (liu.length - 1));
  const wo = liu[Math.max(0, Math.min(liu.length - 1, idx))]!;
  const mo = anShe.woDaoMo[wo] || anShe.woDaoMo.auto || '';
  if (!mo) return undefined;
  return { reasoning_effort: mo, thinking_level: mo, enable_thinking: true };
}

/**
 * **同一条消息只写一次**（真机反馈：牛马"回复两次"，日志里每条都出现两份）。
 *
 * 事实：用户消息有两条写入路径（渲染层 `chatLogAppend` 补写 + 主进程 `chatSend` 自己记账），
 * 助手回复同样如此；两条路径会**竞态**，而且不止一次 —— 实测用户消息 5ms 内写两次、
 * 助手回复 75 秒后又被写一次（自动续派那一轮又走了同一条记账）。
 * 只在 `zhuiJiaLiaoTianRiZhi` 里按「上一条 + 3 秒」去重**挡不住 JSONL 那一层**：
 * `memory.append` 发生在去重之前，重复的那次照样进了唯一事实源。
 *
 * 这里做**内容级短窗去重**（按 会话+角色+内容 取键），并**在写 JSONL 之前**调用，
 * 因此重复的那次既不会进 JSONL，也不会进会话日志。
 */
const __yiXieRu = new Map<string, Array<{ content: string; ts: number }>>();
/**
 * 窗口取 **10 分钟**（真机事故：同一句回复隔 102 秒又被写了一遍 —— 那次是自动续派/续跑
 * 吐出了与上一轮**逐字相同**的收尾语，20 秒窗口挡不住）。
 * 10 分钟内同一会话同一角色吐**逐字相同**的内容，几乎必是重复写入而非"用户真想再说一遍"。
 */
const CHONG_XIE_CHUANG_MS = 600_000;
/** 助手回复最多记几条（见下） */
const CHONG_XIE_BAO_CUN = 12;
function yiJingXieGuo(sid: string, role: string, content: string, now = Date.now()): boolean {
  const jiao = guiYiJiaoSe(role);
  const k = `${sid}|${jiao}`;
  /**
   * **助手回复要记「最近若干条」，不能只记上一条**（真机事故复盘）：
   * 只留一条时，同一轮里只要后面又写了任何一条**别的**助手消息（eta 停轮说明、
   * 续派合并、值班记录…），原本那条的重复写入就再也比对不上了 ——
   * 渲染层迟到的补写照样进日志，界面就又多一条一模一样的回复。
   *
   * **用户消息照旧只记一条**：手打的短消息真的可能重复（"继续""好"），不能吃掉。
   */
  const shangXian = jiao === 'assistant' ? CHONG_XIE_BAO_CUN : 1;
  const jiu = (__yiXieRu.get(k) || []).filter((x) => now - x.ts < CHONG_XIE_CHUANG_MS);
  const mingZhong = jiu.some((x) => x.content === content);
  const i = jiu.findIndex((x) => x.content === content);
  // 命中也刷新时间戳：否则"原写"和"重复写"会一起过期，第三次再写就漏过去了
  if (i >= 0) jiu[i] = { content, ts: now };
  else jiu.push({ content, ts: now });
  while (jiu.length > shangXian) jiu.shift();
  __yiXieRu.set(k, jiu);
  return mingZhong;
}
function qingChongXieJiLu(sid?: string): void {
  if (!sid) { __yiXieRu.clear(); return; }
  for (const k of [...__yiXieRu.keys()]) if (k.startsWith(sid + '|')) __yiXieRu.delete(k);
}

/**
 * **会话镜像的唯一写入点**（不变量：日志是唯一事实来源，镜像只能由日志派生）。
 * hidden（内部指令）与普通消息都走这里 ⇒ 源码里不会再出现第二处镜像写入。
 */
function jingXiangXieRu(key: string, role: LiaoTianXiaoXi['role'], content: string): void {
  const yingshe = chatHistories.get(key);
  if (yingshe) yingshe.push({ role, content });
  else chatHistories.set(key, [{ role, content }]);
}

function zhuiJiaLiaoTianRiZhi(key: string, entry: LogEntry): void {
  // 归一后写入：去重、镜像、回读全部只认这一套角色名
  const tiaoMu = { ...entry, role: guiYiJiaoSe(entry.role) } as LogEntry;
  /**
   * **内部指令不进聊天记录**（真事故：用户看到聊天里冒出「【继续执行计划】…」自己没说过的话）。
   * 自动续派的工单只进模型上下文（chatHistories），不进会话日志（chatLogs）⇒ 界面不显示。
   */
  if ((entry as { hidden?: boolean }).hidden) {
    jingXiangXieRu(key, tiaoMu.role, tiaoMu.content);
    return;
  }
  /**
   * **续派回合的回复合并进上一条**（产品要求：一次用户对话 = 一条思考 + 一条回复）。
   * 自动续派产生的 assistant 回复不再单开气泡，而是追加到上一条 assistant 消息末尾。
   */
  if ((entry as { mergeWithPrev?: boolean }).mergeWithPrev && tiaoMu.role === 'assistant') {
    const shuZu = chatLogs.get(key);
    if (shuZu && shuZu.length) {
      const last = shuZu[shuZu.length - 1];
      if (last && last.role === 'assistant') {
        last.content = String(last.content || '') + '\n\n---\n\n' + String(tiaoMu.content || '');
        if (tiaoMu.reasoning) last.reasoning = String(last.reasoning || '') + '\n\n' + String(tiaoMu.reasoning || '');
        // 同步镜像
        const yingshe = chatHistories.get(key);
        if (yingshe && yingshe.length) {
          const lastM = yingshe[yingshe.length - 1];
          if (lastM && lastM.role === 'assistant') lastM.content = last.content;
        }
        try { broadcastToWindows('warmy:liaoTianUpdated', { sessionId: key, seq: null, ts: Date.now() }); } catch { /* noop */ }
        return;
      }
    }
  }
  /**
   * **纯标点/零宽不入账**（真机反馈：回答完下面多出一个只有「。」的回复）。
   * 主进程各条写入路径都经这里，所以在入口统一拦掉 —— 任何来源的空话都不进会话日志。
   * （JSONL 侧另有 `yiJingXieGuo`；系统提示类（system:true）如实保留。）
   */
  if (!tiaoMu.system && tiaoMu.role !== 'user' && String(tiaoMu.content || '').trim() && !youShiZhiWenBen(String(tiaoMu.content))) {
    try { audit?.log('chat.punct-only-dropped', { sessionId: key, chars: String(tiaoMu.content || '').length }); } catch { /* noop */ }
    return;
  }
  /**
   * **短窗口去重**：同一条消息有两条写入路径（渲染层统一推送里补写 + 主进程自己的路径
   * chat-send / 群聊编排里的值班记录），不去重就会在日志里出现两份 ⇒ 用户看到"消息显示 2 次"。
   * 只对"与上一条完全相同、且 3 秒内"生效：用户真连发两句一样的话（间隔 > 3 秒）仍各显示一条。
   */
  {
    const arr0 = chatLogs.get(key) || [];
    const last = arr0[arr0.length - 1];
    const ts = Number(tiaoMu.ts || 0) || Date.now();
    if (last && last.role === tiaoMu.role && String(last.content) === String(tiaoMu.content) && ts - Number(last.ts || 0) < 3000) {
      return; // 跳过：同一条消息被两条路径重复写入
    }
  }
  const shuZu = chatLogs.get(key);
  if (shuZu) shuZu.push(tiaoMu);
  else chatLogs.set(key, [tiaoMu]);
  jingXiangXieRu(key, tiaoMu.role, tiaoMu.content);
  /**
   * 日志一写就**播给所有窗口**：对方（另一个窗口）据此重新拉一次该会话的日志。
   * 只带 sessionId 与 seq，不带正文 —— 正文仍由渲染层按既有通道回读，
   * 保证"看到的就是日志里那份"，不会出现第二个真相。
   */
  try {
    broadcastToWindows('warmy:liaoTianUpdated', { sessionId: key, seq: (entry as { seq?: number }).seq ?? null, ts: Date.now() });
  } catch { /* noop */ }
}

/** 读会话历史（缺镜像时按需从日志派生，绝不返回第二份真相） */
function quHuiHuaLiShi(key: string): LiaoTianXiaoXi[] {
  const cached = chatHistories.get(key);
  if (cached) return cached;
  const yiTuiDao = quHuiHuaXiaoXiJi(key);
  chatHistories.set(key, yiTuiDao);
  return yiTuiDao;
}

/**
 * 从记忆服务的只追加日志重建会话日志 —— ADR 002 §9.4 待办 4 / 不变量 #5。
 *
 * `chatHistories` 原本是纯进程内内存数组，重启即丢，与"JSONL 是唯一事实来源"有差距。
 * 现在启动（以及记忆服务重新拉起）后从 `tail()` 拉回最近 `HISTORY_RESTORE_LIMIT` 条
 * `kind='message'` 记录：seq 直接用记忆服务分配的 seq（与 `nextChatSeq` 同一条序列），
 * 角色由 recordId 前缀还原（见 memory-client.CHAT_RECORD_PREFIX）。
 *
 * **降级**：记忆服务不可用/超时 → 什么都不做（日志与镜像为空），对话照常发送。
 */
async function youJiYiHuiFuHuiHuaRiZhi(trigger: string): Promise<typeof historyRestore> {
  const report = {
    done: true,
    ok: false,
    entries: 0,
    sessions: 0,
    maxSeq: 0,
    reason: '',
    trigger,
    at: Date.now(),
  };
  if (!memory || !memory.isReady) {
    report.reason = 'memory-unavailable';
    historyRestore = report;
    qidong(`chat log restore skipped (trigger): memory unavailable`);
    return report;
  }
  try {
    const res = await memory.tail(HISTORY_RESTORE_LIMIT);
    const records: Array<Record<string, unknown>> = Array.isArray(res?.records) ? res.records : [];
    // tail() 是 seq 倒序（最近的在前），重建要按 seq 升序灌入
    const shengxu = [...records]
      .filter((r) => r && typeof r === 'object')
      .sort((a, b) => Number(a['seq'] ?? 0) - Number(b['seq'] ?? 0));
    const yiYou = new Map<string, Set<number>>();
    for (const [k, shuZu] of chatLogs) yiYou.set(k, new Set(shuZu.map((e) => e.seq)));
    const sessions = new Set<string>();
    let chars = 0;
    for (const r of shengxu) {
      if (String(r['kind'] ?? '') !== 'message') continue;
      const key = String(r['sessionId'] ?? '');
      const seq = Number(r['seq']);
      const ti = typeof r['ti'] === 'string' ? r['ti'] : '';
      if (!key || !Number.isFinite(seq) || seq <= 0) continue;
      const yiKanDao = yiYou.get(key) ?? new Set<number>();
      if (yiKanDao.has(seq)) continue;
      if (chars + ti.length > HISTORY_RESTORE_MAX_CHARS) continue;
      yiKanDao.add(seq);
      yiYou.set(key, yiKanDao);
      chars += ti.length;
      const rid = String(r['id'] ?? '');
      zhuiJiaLiaoTianRiZhi(key, {
        seq,
        role: chatRoleOfRecordId(rid),
        content: ti,
        recordId: rid || undefined,
        ts: Number(r['ts']) || undefined,
      });
      sessions.add(key);
      if (seq > report.maxSeq) report.maxSeq = seq;
      report.entries += 1;
    }
    chatLogSeq = Math.max(chatLogSeq, report.maxSeq);
    // 镜像整份重派生：重建后 chatHistories 与日志逐条对齐
    for (const key of chatLogs.keys()) chatHistories.set(key, quHuiHuaXiaoXiJi(key));
    report.ok = true;
    report.sessions = sessions.size;
    historyRestore = report;
    qidong(
      `chat log restored (trigger): ${report.entries} 条 / ${report.sessions} 会话 / maxSeq=${report.maxSeq}`
    );
    audit?.log('chat.history.restore', {
      trigger,
      entries: report.entries,
      sessions: report.sessions,
      maxSeq: report.maxSeq,
      limit: HISTORY_RESTORE_LIMIT,
    });
    return report;
  } catch (e) {
    report.reason = `restore-failed: ${xiJingCuoWu(e)}`;
    historyRestore = report;
    qidong(`chat log restore failed (trigger): ${report.reason}`);
    return report;
  }
}

/**
 * 记忆服务可用性（工具暴露 + 历史重建的前提）。
 * 不可用一律**不报错**：撤回工具、跳过重建，对话继续用进程内日志发出去。
 */
async function baozhangJiyiCangJiuxu(): Promise<boolean> {
  if (!memory) return false;
  if (memory.isReady) return true;
  const now = Date.now();
  if (now - memoryEnsureAt < MEMORY_ENSURE_COOLDOWN_MS) return false;
  memoryEnsureAt = now;
  try {
    await memory.start();
    qidong('memory ready (re-start)');
    void youJiYiHuiFuHuiHuaRiZhi('memory-restart');
    return memory.isReady;
  } catch (e) {
    qidong(`memory re-start fail ${String(e)}`);
    return false;
  }
}

/** 工具描述（i18n，缺键时退回 memory-client 的中文默认文案） */
function toolLabels(): Partial<JiyiCangGongjuBiaoqian> {
  const d = DEFAULT_MEMORY_TOOL_LABELS;
  return {
    recall: tMain('llm.toolRecallDesc', d.recall),
    retrieve: tMain('llm.toolRetrieveDesc', d.retrieve),
    queryParam: tMain('llm.toolQueryParam', d.queryParam),
    limitParam: tMain('llm.toolLimitParam', d.limitParam),
    recordIdParam: tMain('llm.toolRecordIdParam', d.recordIdParam),
    seqParam: tMain('llm.toolSeqParam', d.seqParam),
    offsetParam: tMain('llm.toolOffsetParam', d.offsetParam),
    maxCharsParam: tMain('llm.toolMaxCharsParam', d.maxCharsParam),
  };
}

/** 工具调用上限（settings 可配；越界值一律夹到安全区间） */
function toolLimits(): { zuiDaLunShu: number; zuiDaJieGuoZiShu: number; totalChars: number } {
  let s: Partial<YingYongPeizhi> | undefined;
  try {
    s = settingsStore?.load();
  } catch {
    /* 配置坏了就用默认 */
  }
  const lunShu = Number(s?.contextToolMaxRounds);
  const mei = Number(s?.contextToolResultChars);
  const total = Number(s?.contextToolTotalChars);
  return {
    /**
     * 轮数上限：**多任务必须能跑完**。真事故：默认 3 轮时
     * 「生成 txt + 生成 ppt + 打开 + 等 30 秒 + 写 6000 字小说」跑到一半就
     * `tingZhiYuanYin: 'max-rounds'`，任务直接停了。现在默认 12、最多 32。
     */
    zuiDaLunShu: Number.isFinite(lunShu) ? Math.min(32, Math.max(0, Math.floor(lunShu))) : 12,
    zuiDaJieGuoZiShu: Number.isFinite(mei) ? Math.min(8000, Math.max(200, Math.floor(mei))) : 4000,
    totalChars: Number.isFinite(total) ? Math.min(40000, Math.max(200, Math.floor(total))) : 12000,
  };
}

/**
 * **所有**注入模型的对话都从这里走（ADR 002 §9.4 待办 2）：
 * 有界视图 → 多轮工具调用（recall / retrieve 走记忆服务）→ 结果回给模型 → 终答。
 *
 * 降级链（任一环节不满足就退回"现状"的普通单轮对话，**不报错**）：
 *   1. 记忆服务不可用 → 不暴露工具；
 *   2. `settings.contextToolMaxRounds = 0` → 不暴露工具；
 *   3. provider 不支持 function calling（如 Ollama）→ chatWithTools 内部降级；
 *   4. 首次带 tools 的请求报错（中转/模型不吃 tools）→ 重试一次不带工具。
 *
 * 审计：decide / enabled / unavailable / tool / degraded / done 六个事件全程留痕，
 * 只记工具名、锚点、长度与错误摘要 —— **不落 API Key，也不落工具结果正文**。
 */
/**
 * 这个会话的 AI 能不能**真的干活**（写文件等）。
 *
 * 产品定稿：**我的牛马**与**项目**里的 AI 必须能干活；**群聊**里的牛马只能聊天。
 * 项目在本产品里就是「internal 群」，所以判据是：有群记录 ⇒ 看它的 type；
 * 没有群记录 ⇒ 我的牛马 / 联系人会话 ⇒ 允许（工具只落在本会话自己的工作区里）。
 */
/** 会话的显示名（给小弟命名用；拿不到就用 sessionId） */
function sessionMingOf(sessionId: string): string {
  try {
    const g = groupStore?.getGroup?.(sessionId) as { ming?: string; name?: string } | undefined;
    if (g) return String(g.ming || g.name || sessionId);
  } catch { /* noop */ }
  return String(sessionId || 'agent');
}

function huiHuaKeGanHuo(sessionId: string): boolean {
  try {
    const g = groupStore?.getGroup?.(sessionId) as { type?: string } | undefined;
    if (g) return g.type === 'internal';
    return true;
  } catch {
    return true;
  }
}




/**
 * 规范化 OpenAI 兼容端点的 baseURL：`chat/completions` / `models` 都挂在 `/v1` 下，
 * 少了 `/v1` 就是 **HTTP 404**（真事故：DeepSeek 预设写成 `https://api.deepseek.com`，
 * 而且已落盘的旧配置还会一直带着错地址）。
 */
function guiFanBaseURL(u: string): string {
  const s0 = String(u || '').trim().replace(/\/+$/, '');
  if (!s0) return s0;
  if (/\/v\d+[a-z]*$/i.test(s0)) return s0;                       // 已带版本段：不动
  if (/api\.deepseek\.com$|api\.xiaomimimo\.com$|api\.openai\.com$|api\.moonshot\.cn$|api\.siliconflow\.cn$|open\.bigmodel\.cn\/api\/paas$/i.test(s0)) {
    return s0 + '/v1';
  }
  return s0;
}

/** 安装技能包：复制到技能根目录（含 SKILL.md 的文件夹）。安装点由 jinengGen() 定 */
async function anZhuangJiNengBao(yuan: string, ziMing: string): Promise<string> {
  try {
    const gen = jinengGen();
    const gen0 = gen[0]?.root;
    if (!gen0) return '[install_skill] 没有可用的技能安装目录';
    const ming = String(ziMing || path.basename(yuan) || 'skill').replace(/[^\w.\-]/g, '_').slice(0, 60) || 'skill';
    const muBiao = path.join(gen0, ming);
    fs.mkdirSync(muBiao, { recursive: true });
    // 递归复制（限层限量，防止把整个盘拷进去）
    let jiShu = 0;
    const fu = (src: string, dst: string, ceng = 0) => {
      if (ceng > 5 || jiShu > 300) return;
      let ems: string[] = [];
      try { ems = fs.readdirSync(src); } catch { return; }
      for (const e of ems) {
        const s = path.join(src, e), d = path.join(dst, e);
        let st: fs.Stats; try { st = fs.statSync(s); } catch { continue; }
        jiShu++;
        if (st.isDirectory()) { fs.mkdirSync(d, { recursive: true }); fu(s, d, ceng + 1); }
        else { try { fs.copyFileSync(s, d); } catch { /* skip */ } }
      }
    };
    fu(yuan, muBiao);
    return `[install_skill] 已安装到 ${muBiao}（${jiShu} 个文件）。重启会话后该技能生效。`;
  } catch (e) { return `[install_skill] 安装失败：${xiJingCuoWu(e)}`; }
}

/**
 * **真能跑**的模型清单：只列那些供应商已配 Key、或本身是 Ollama（无需 Key）的模型。
 * 真事故：智能选模型挑到没密钥的 DeepSeek ⇒ 报「未配置 API Key」，而 Ollama 明明有可用模型。
 */
async function lieKeYongMoXing(): Promise<string[]> {
  try {
    const s = settingsStore?.load() as {
      providers?: Array<{ id?: string; protocol?: string; models?: unknown[]; defaultModel?: string }>
    } | undefined;
    const lie = Array.isArray(s?.providers) ? s.providers : [];
    const out: string[] = [];
    for (const p of lie) {
      const xieYi = String(p.protocol || '');
      const keYong = xieYi === 'ollama';
      if (!keYong) {
        const k = await jiexiGongyingshangMiyao(String(p.id || ''));
        if (!k) continue;
      }
      for (const m of (p.models || [])) {
        const id = String(typeof m === 'string' ? m : (m as { id?: string })?.id || '');
        if (id && !out.includes(id)) out.push(id);
      }
    }
    return out;
  } catch { return []; }
}

/** 当前安全档位 + 「超出权限是否询问」（默认询问） */
function anQuanDangWei(): { full: boolean; ask: boolean; dang: AnquanDang } {
  try {
    const s = settingsStore?.load() as { globalSecurity?: string; askOnExceed?: boolean } | undefined;
    const raw = String(s?.globalSecurity || 'normal');
    const dang: AnquanDang = raw === 'full' ? 'full' : raw === 'strict' ? 'strict' : 'normal';
    return { full: dang === 'full', ask: s?.askOnExceed !== false, dang };
  } catch {
    return { full: false, ask: true, dang: 'normal' };
  }
}

/** 轮询等某张请求卡被回答（400ms 一次）；超时返回 ''（视为未回答） */
async function dengDaiKaPian(id: string, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const q = aiQuestions.LieBiao().find((x) => x.id === id);
    if (q && q.status === 'answered' && q.answer) {
      const extra = q.answer.customText ? `（自定义）${q.answer.customText}` : '';
      return `${q.answer.biaoQian}${extra}`;
    }
    if (Date.now() - t0 > timeoutMs) return '';
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * 在聊天输入框上方弹一张**请求卡**并阻塞等待用户选择。
 * 用途：① 越权操作（读取/写入工作区外）的同意/拒绝；② AI 自己拿不准时的选择（永远带「其他」）。
 * 返回用户选的文案（'' = 超时未答）。渲染层 `#aiqHost` / `#piZhunHost` 就在输入框上方。
 */
/**
 * **发给模型前的消息形状规范化**。
 * 硬约束（Ollama / 一批 OpenAI 兼容端都会直接 400）：**结尾不得有 2 条及以上连续 assistant**。
 * 处理：把结尾连续的 assistant 合并成一条（内容按 `\n\n` 拼），保留最后一条的其余字段。
 * 只在发送前做，日志里的原文一字不动。
 */
function guiZhengXiaoXiJiZhuang<T extends { role?: string; content?: unknown }>(msgs: T[]): T[] {
  const xs = Array.isArray(msgs) ? msgs.slice() : [];
  if (xs.length < 2) return xs;
  const shi = (m: T | undefined): boolean => !!m && String(m.role || '') === 'assistant';
  if (!shi(xs[xs.length - 1])) return xs;
  let j = xs.length - 1;
  while (j - 1 >= 0 && shi(xs[j - 1])) j -= 1;
  if (j === xs.length - 1) return xs; // 结尾只有一条 assistant，无需处理
  const duan = xs.slice(j).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')));
  const last = xs[xs.length - 1];
  if (!last) return xs;
  const merged = { ...last, content: duan.filter(Boolean).join('\n\n') } as T;
  return [...xs.slice(0, j), merged];
}

/**
 * 授权的去重键 = **纯标题 + 请求详情**（与渲染层 `shouQuanJian` 同一套归一化）。
 * 请求前先拿它查授权卡：命中就直接放行 ⇒ 卡上的内容永远不会重复出现。
 */
function shouQuanJian(t?: unknown, d?: unknown): string {
  const a = String(t ?? '').replace(/\s+/g, ' ').trim();
  const b = String(d ?? '').replace(/\s+/g, ' ').trim();
  return b ? a + '\n' + b : a;
}

/** 「自动选择」开关（设置里那个勾选；默认关）。关着时任何卡都必须等人点。 */
function ziDongXuanZe(): boolean {
  try {
    const s = settingsStore?.load() as { autoSelectRecommended?: unknown } | undefined;
    return s?.autoSelectRecommended === true;
  } catch { return false; }
}

async function qingQiuKaPian(
  sessionId: string,
  biaoTi: string,
  ti: string,
  options: Array<{ id?: string; biaoQian: string; description?: string; tuiJian?: boolean }>,
  timeoutMs = 10 * 60 * 1000,
): Promise<string> {
  /**
   * **先查授权卡**（产品要求）：仅对「授权类」卡片生效 —— 必须同时存在拒绝项与同意项。
   * AI 的普通选择卡（继续/暂停之流）绝不能被长期授权顶掉。
   * 命中同样的键 ⇒ 直接按「同意」放行，于是卡上内容永远不重复。
   */
  const juJue = options.find((o) => /拒绝|Reject|否/i.test(String(o?.biaoQian || '')));
  const tongYi = options.find((o) => /同意|允许|通过|Allow|Approve|Yes/i.test(String(o?.biaoQian || '')));
  if (juJue && tongYi) {
    const key = shouQuanJian(biaoTi, ti);
    if (key && shouQuanQu(sessionId).some((x) => x.text === key)) {
      try { audit?.log('auth.auto-pass', { sessionId, key }); } catch { /* noop */ }
      return String(tongYi.biaoQian || '同意');
    }
  }
  const q = aiQuestions.daKai({ groupId: sessionId, sessionId, biaoTi, ti, options });
  /**
   * **自动选择**（设置里勾了才生效）：卡里有模型自评的「推荐」方案 ⇒ 直接按它执行、不弹卡等人。
   * 没有标「推荐」的卡**一律不代选** —— 宁可停下来等人，也不替人拿主意。
   * 仍然先开卡再作答，这样决策记录照旧进 `contextFor`（模型下一轮知道选了什么）。
   */
  if (ziDongXuanZe()) {
    const tui = q.options.find((o) => o.tuiJian) || null;
    if (tui) {
      aiQuestions.answer(q.id, tui.id);
      try { audit?.log('aiq.auto-select', { sessionId, biaoTi, choice: tui.biaoQian }); } catch { /* noop */ }
      return String(tui.biaoQian || '');
    }
  }
  try { broadcastToWindows('warmy:aiWenTi', { sessionId, id: q.id }); } catch { /* noop */ }
  // 请求卡出现 ⇒ 播「请求」音效（渲染层在 onAiWenTi 里处理）
  return dengDaiKaPian(q.id, timeoutMs);
}


/** 当前用户的名字（我的页 profile.json 里那个） */
function dangQianYongHuMing(): string {
  try {
    const p = accountStore?.loadProfile() as { username?: string } | undefined;
    return String(p?.username || '').trim();
  } catch { return ''; }
}

/** 本轮工具调用的名字（空回复兜底时如实告诉用户"干了什么"） */
let benLunGongJuMing: string[] = [];

/**
 * **这段文字有没有实际内容**（真机反馈修：回复完成后多出一条只有「。」的回复）。
 *
 * 模型偶尔会只吐一个标点（`.`／`。`／`…`／零宽字符）当作"答复"。
 * 原判据是 `!text.trim()`，标点不是空白 ⇒ 被判成"有正文" ⇒ 界面上就多出一个只有句号的气泡。
 * 这里把"只有标点/空白/零宽字符"一律视为**没有内容**，走既有的空回复兜底（如实说明 + 工具总结），
 * 并把这件事记进审计（`chat.empty-reply`），下次再遇到能查出来是哪个模型干的。
 */
function youShiZhiWenBen(wen: string): boolean {
  const s = String(wen || '')
    .replace(/[\s\u200B-\u200F\uFEFF]/g, '')          // 空白 + 零宽
    .replace(/[.,;:!?'"`~^\-_=+*\\/|<>()[\]{}@#$%&。，、；：！？…·—～「」『』（）【】《》“”‘’]/g, '');
  return s.length > 0;
}

/**
 * **这条回复是不是「自称做不到 / 拒答」**（真机事故：模型说「我没有权限操作你的桌面文件系统」，
 * 而 write_file / make_pptx / open_path / run_shell / wait_seconds 就在工具表里，本轮一个都没调）。
 *
 * 判据只认**明确的无能宣称**，不含正常的能力说明（例如"我可以用工具帮你写文件"不该命中）。
 */
function shiJueDaiJueKou(wen: string): boolean {
  const s = String(wen || '');
  if (!s) return false;
  return /没有权限|无权限|无权|够不着|触不到|摸不到|无法操作|无法访问|不能操作|不能访问|不被允许|不许我|我无法(操作|访问|执行|计时|异步)|我做不到(这些|这个|这点)|无法(计时|异步执行)|请你在本地|请在本地|自己(在)?本地(操作|做)/.test(s);
}


/**
 * **流式包装**：把 `chat()` 换成「用 chatStream 边收边回调」的等价实现。
 * 用途：**思考过程要边出边显示**（产品要求），而不是全部跑完才一次性冒出来。
 * 回调里带 `reasoning` / `content` 的增量；返回值仍是完整的 `LiaoTianXiangYing`，
 * 所以工具循环（`liaoTianDaiGongJu`）一行都不用改。
 */
function baoZhuangLiuShi(
  yuan: MoxingGongYing,
  onPian: (p: { reasoning?: string; content?: string }) => void,
  /** 一次请求真的结束（含失败）时回调：用来量"等待模型回复"这个行为的耗时 */
  onWan?: (p: { ms: number; ok: boolean }) => void,
): MoxingGongYing {
  return {
    ...yuan,
    protocol: yuan.protocol,
    baseURL: yuan.baseURL,
    supportsTools: yuan.supportsTools,
    async chat(Qiu, signal) {
      const t0 = Date.now();
      const jieShu = (ok: boolean) => { try { onWan?.({ ms: Date.now() - t0, ok }); } catch { /* noop */ } };
      // 端点不支持流式 / 出错 ⇒ 退回普通 chat（不因为"想看流式"就把一轮搞黄）
      try {
        let reasoning = '';
        let content = '';
        let shangCiR = '';
        let shangCiC = '';
        const gongJu: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
        let finishReason: string | null = null;
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheHitTokens: number; cacheMissTokens: number; source: 'native' | 'estimated' | 'none' } = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, source: 'none' };
        let model = Qiu.model;
        for await (const pian of yuan.chatStream(Qiu, signal)) {
          const d = pian.choices?.[0]?.delta || {};
          if ((d as { reasoning?: string }).reasoning) {
            reasoning += String((d as { reasoning?: string }).reasoning);
            onPian({ reasoning: reasoning.slice(shangCiR.length) });
            shangCiR = reasoning;
          }
          if (d.content) {
            content += String(d.content);
            onPian({ content: content.slice(shangCiC.length) });
            shangCiC = content;
          }
          const g = (d as { gongJuDiaoYongJi?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }).gongJuDiaoYongJi;
          if (Array.isArray(g)) {
            for (const c of g) {
              if (!c) continue;
              /**
               * 同一个 id 可能拆成多帧（OpenAI 逐段发 `arguments`，Ollama 也一样）——
               * **按 id 归并**，名字取第一个非空、参数**拼接**，不是"看见重名就丢掉"。
               */
              const id = String(c.id || `call-${gongJu.length}`);
              const yiYou = gongJu.find((x) => x.id === id);
              const arg = String(c.function?.arguments || '');
              if (yiYou) {
                yiYou.function.arguments = String(yiYou.function.arguments || '') + arg;
                if (!yiYou.function.name && c.function?.name) yiYou.function.name = String(c.function.name);
              } else {
                gongJu.push({
                  id,
                  type: 'function',
                  function: { name: String(c.function?.name || ''), arguments: arg },
                });
              }
            }
          }
          const fr = pian.choices?.[0]?.finishReason;
          if (fr) finishReason = String(fr);
          if (pian.model) model = pian.model;
          if (pian.usage) usage = pian.usage;
        }
        /**
         * **用量兜底**：端点在流式里没吐用量 ⇒ 按字符估算（标注 `estimated`，不冒充原生数据）。
         * 真事故：不估的话总看板的「词元消耗」永远是 0。
         */
        if (!usage.promptTokens && !usage.completionTokens) {
          const ruZi = (Qiu.xiaoXiJi || []).reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
          const chuZi = content.length + reasoning.length;
          usage = {
            promptTokens: Math.max(0, Math.round(ruZi / 3)),
            completionTokens: Math.max(0, Math.round(chuZi / 3)),
            totalTokens: Math.round((ruZi + chuZi) / 3),
            cacheHitTokens: 0,
            cacheMissTokens: Math.max(0, Math.round(ruZi / 3)),
            source: 'estimated',
          };
        }
        /**
         * **兜底**：端点说 `tool_calls` 但我们一个工具都没解析出来
         * （某个 provider 的流式解析漏了工具字段）⇒ 退回一次非流式对话把工具拿回来。
         * 绝不能因为"想看流式"就把工具调用吃掉（真事故：界面变成纯文本对话）。
         */
        if (finishReason === 'tool_calls' && !gongJu.length) {
          audit?.log('chat.stream-fallback-tools', { model });
          const hui = await yuan.chat(Qiu, signal);
          jieShu(true);
          return hui;
        }
        const chu = {
          id: 'stream-' + Date.now(),
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content,
              ...(reasoning ? { reasoning } : {}),
              ...(gongJu.length ? { gongJuDiaoYongJi: gongJu } : {}),
            },
            finishReason: (finishReason as 'stop') || (gongJu.length ? 'tool_calls' : 'stop'),
          }],
          usage,
        };
        jieShu(true);
        return chu;
      } catch {
        // 流式失败 ⇒ 就地退回一次普通对话（绝不把"想看流式"变成整轮失败）
        const hui = await yuan.chat(Qiu, signal);
        jieShu(false);
        return hui;
      }
    },
    chatStream: (Qiu, signal) => yuan.chatStream(Qiu, signal),
    listModels: (s) => yuan.listModels(s),
    ping: (s) => yuan.ping(s),
  } as MoxingGongYing;
}

/**
 * 本轮「思考/正文」增量广播给界面（思考过程边出边显示）。**限频 ≤20/s**，免得刷爆渲染层。
 *
 * ⚠️ 限频必须是「**攒着 + 尾随**」，不能是「丢掉」（真事故：以前密集到 50ms 内的增量直接
 * `return` ⇒ 流式里的思考有洞，看着比真实内容少；而正式回复落地后显示的又是完整内容，
 * 两边对不上）。现在超出频次的增量被合进待发缓冲，60ms 内一定补发出去。
 */
let _boXingShangCi = 0;
const _boXingDai = new Map<string, { reasoning: string; content: string }>();
let _boXingDingShi: ReturnType<typeof setTimeout> | null = null;
function _boXingSong(sessionId: string, d: { reasoning: string; content: string }, ts: number) {
  if (!d.reasoning && !d.content) return;
  try {
    broadcastToWindows('warmy:suiXingPianDuan', {
      sessionId,
      reasoning: d.reasoning || '',
      content: d.content || '',
      ts,
    });
  } catch { /* noop */ }
}
function boXingPianDuan(sessionId: string, p: { reasoning?: string; content?: string }) {
  const now = Date.now();
  const dai = _boXingDai.get(sessionId) || { reasoning: '', content: '' };
  dai.reasoning += p.reasoning || '';
  dai.content += p.content || '';
  _boXingDai.set(sessionId, dai);
  if (now - _boXingShangCi >= 50) {
    _boXingShangCi = now;
    _boXingDai.delete(sessionId);
    _boXingSong(sessionId, dai, now);
    return;
  }
  if (!_boXingDingShi) {
    _boXingDingShi = setTimeout(() => {
      _boXingDingShi = null;
      _boXingShangCi = Date.now();
      const pail = [..._boXingDai.entries()];
      _boXingDai.clear();
      for (const [sid, d] of pail) _boXingSong(sid, d, Date.now());
    }, 60);
  }
}

async function yunXingLiaoTianXunHuan(
  sessionId: string,
  provider: MoxingGongYing,
  Qiu: LiaoTianQingQiu,
  /** 小弟数量：'auto'（=32）或 0..8（0 = 不许派小弟）—— 牛马管理里设的 */
  xiaoDiShuLiang?: string | number
): Promise<GongJuXunHuanGuo & { tooled: boolean }> {
  const limits = toolLimits();
  const jiyiJiuxu = await baozhangJiyiCangJiuxu();
  const keGanHuo = huiHuaKeGanHuo(sessionId);
  const jiyiTools: GongJuGuiGe[] = jiyiJiuxu ? (memoryToolSpecs(toolLabels()) as unknown as GongJuGuiGe[]) : [];
  // 小弟数量：自适应 = 32（历史上限）；0 = 不给 spawn_subagent；N = 本轮最多派 N 个
  const xiaoDiShangXian = (() => {
    const v = xiaoDiShuLiang;
    if (v === undefined || v === null || v === '' || v === 'auto') return 32;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 32;
  })();
  let yiPaiXiaoDi = 0;
  // 干活工具：只有「我的牛马 / 项目」暴露；群聊保持仅聊天
  const ganHuoTools = keGanHuo
    ? ([
        ...workToolSpecs(),
        ...hostToolSpecs(),
        ...(xiaoDiShangXian > 0 ? (xiaoDiToolSpecs() as unknown as GongJuGuiGe[]) : []),
      ] as unknown as GongJuGuiGe[])
    : [];
  /**
   * **工具启停**（产品要求）：设置→工具里停掉的工具，模型就看不到它。
   * 自定义工具（从文件夹导入的 TOOL.json）也在这里挂上。
   */
  const ziDing = ziDingGongJuJiQu().filter((g) => gongJuKeJian(g.name));
  const ziDingGuiGe = ziDing.map((g) => ({
    type: 'function' as const,
    function: { name: g.name, description: g.description || `自定义工具：${g.name}`, parameters: g.parameters },
  })) as unknown as GongJuGuiGe[];
  const jiaJu = [...ganHuoTools, ...jiyiTools, ...ziDingGuiGe].filter((g) => gongJuKeJian(g.function.name));
  const tools: GongJuGuiGe[] | undefined = jiaJu.length && limits.zuiDaLunShu > 0 ? jiaJu : undefined;
  const supported = gongYingZhiChiGongJu(provider);

  audit?.log('chat.tools.decide', {
    sessionId,
    memoryReady: jiyiJiuxu,
    supported,
    exposed: !!tools,
    zuiDaLunShu: limits.zuiDaLunShu,
    jieGuoZiShu: limits.zuiDaJieGuoZiShu,
    totalChars: limits.totalChars,
  });
  if (tools) {
    audit?.log('chat.tools.enabled', { sessionId, tools: tools.map((t) => t.function.name) });
  } else {
    audit?.log('chat.tools.unavailable', {
      sessionId,
      reason: !jiyiJiuxu ? 'memory-unavailable' : 'disabled-by-settings',
    });
  }

  /**
   * 用**流式包装**跑工具循环：思考过程与正文**边出边广播**给界面（产品要求：
   * 不要等全部跑完才一次性冒出来）。工具循环本身一行没改。
   *
   * **可取消**（用户反馈"停止功能还是不行"）：包一层，把本会话的 AbortSignal
   * 作为默认取消信号传给 provider —— 点「停止」就真能把在途的那次模型请求掐掉，
   * 而不是只置一个标志位让它跑完再写回来。
   */
  const benLunXinHao = xinHaoGuo(sessionId);
  const keQuXiao: MoxingGongYing = {
    ...provider,
    chat: (q, sig) => provider.chat(q, sig || benLunXinHao),
    chatStream: (q, sig) => provider.chatStream(q, sig || benLunXinHao),
    listModels: (sig) => provider.listModels(sig),
    ping: (sig) => provider.ping(sig),
  };
  const liuShiProvider = baoZhuangLiuShi(
    keQuXiao,
    (p) => boXingPianDuan(sessionId, p),
    /** 「等待模型回复」这个行为：**失败/超时的重试次数**才计入轮数（正常一问一答不算"轮"） */
    (wan) => {
      void (async () => {
        try {
          let ci = 0;
          if (!wan.ok) {
            ci = (dengDaiCiShu.get(sessionId) || 0) + 1;
            dengDaiCiShu.set(sessionId, ci);
          }
          const jieDuan = wan.ok
            ? `等待模型回复：本次耗时 ${shuoShiChang(wan.ms)}`
            : `等待模型回复：本次失败，耗时 ${shuoShiChang(wan.ms)}（失败/重试第 ${ci} 次）`;
          const jie = await chaXingWei({
            xingWei: 'dengDaiHuiFu', sessionId,
            moXing: String(Qiu.model || providerCfg.model || ''),
            shiJiMs: wan.ms, ciShu: ci,
            qianMing: renWuQianMing({ gongJuMing: benLunGongJuMing, buShu: (jiHuaRenWuJi.get(sessionId) || []).length, moXing: String(Qiu.model || '') }),
            jieDuan, zhongLei: wan.ms >= xingWeiGui('dengDaiHuiFu').miao ? 'shiJian' : 'ciShu',
          });
          if (jie.yiChang) biaoEtaYiChang(sessionId, 'dengDaiHuiFu', jie.liYou);
        } catch { /* 守卫自身出错不许影响这一轮对话 */ }
      })();
    },
  );
  /**
   * 单次工具调用也要有"两把尺子"（产品要求：工具的使用/等待都有预计完成时间与轮数限制）。
   * 这里在**执行完之后**如实记账：这一步耗时多少、同一工具本轮第几次；
   * 超过预警点（首次 60 秒 / 3 次）就走 `chaXingWei` 的完整判断流程。
   * 为什么是事后判断：工具执行本身可能有硬超时（由传输层负责），
   * 而**"这一步是否异常"这件事只能在有结果时才算得清**（同步阻塞的工具也没法被抢占）。
   */
  const gongJuCiShu = new Map<string, number>();
  /** 「等待模型回复」本轮第几次请求（同一个会话累计） */
  const dengDaiCiShu = new Map<string, number>();
      type GongJuDiaoYong = GongJuDiaoYongTi;
  const zhiXingGongJu = async (call: GongJuDiaoYong, ctx: { round: number; zuiDaJieGuoZiShu: number }) => {
        const t1 = Date.now();
        const toolName = String((call && call.function && call.function.name) || 'tool');
        fachuKongzhitai({ cat: 'tool', code: 'tool.start', data: { tool: toolName, round: ctx.round, sessionId } });
      // 干活工具（写/读/列目录）走工作区沙箱；记忆工具走记忆服务。
      // 两者都在文件访问作用域里执行 ⇒ 真实读写会记到**这个会话**的项目台账上。
      const gongJuMing = String((call && call.function && call.function.name) || '');
      // 本轮工具名记账：上限 64（防长跑无限增长）
      if (gongJuMing && benLunGongJuMing.length < 64) benLunGongJuMing.push(gongJuMing);
      // 小弟：派出子代理 / 列出小弟
      if (isXiaoDiTool(gongJuMing)) {
        const bu = new XiaoDiDengJiBu(path.join(app.getPath('userData'), 'xiaodi.json'));
        if (gongJuMing === 'list_subagents') {
          const fuMing = sessionMingOf(sessionId);
          const LieBiao = bu.list(fuMing);
          const wenBen = LieBiao.length
            ? LieBiao.map((x) => `${x.ming}（第${x.hao}号 · ${new Date(x.createdAt).toLocaleString()}）`).join('\n')
            : '（还没有派出小弟）';
          audit?.log('chat.xiao-di-list', { sessionId, fuMing, count: LieBiao.length });
          fachuKongzhitai({ cat: 'tool', code: 'tool.finish', data: { tool: gongJuMing, round: ctx.round, sessionId, ok: true, chars: wenBen.length, ms: Date.now() - t1 } });
          return wenBen;
        }
        // spawn_subagent：命名 + 登记 + 用同一个模型把子任务跑一轮
        const rawArgs = call && call.function ? call.function.arguments : undefined;
        const jieXd = jieXiGongJuCanShu(rawArgs);
        const args: { task?: string; title?: string } = (jieXd.args || {}) as { task?: string; title?: string };
        // 本牛马的小弟数量上限（牛马管理里设的）：到顶就如实拒绝
        if (yiPaiXiaoDi >= xiaoDiShangXian) {
          return `[spawn_subagent] 已达本牛马的小弟数量上限（${xiaoDiShangXian}），请等小弟完成或调高「小弟数量」。`;
        }
        const fuMing = sessionMingOf(sessionId);
        const pai = bu.pai(fuMing, Date.now(), {
          sessionId: String(sessionId || ''),
          task: String(args.task || '').slice(0, 4000),
          model: String(Qiu.model || ''),
          status: 'running',
        });
        if (!pai.ok) {
          audit?.log('chat.xiao-di-fail', { sessionId, fuMing, error: pai.error });
          return `[spawn_subagent] 失败：${pai.error}`;
        }
        const lu = pai.lu;
        yiPaiXiaoDi += 1;
        // 子代理一出现就通知界面 ⇒ 第四列「分身」卡**自动加回来**（用户不用手动添加）
        try { broadcastToWindows('warmy:xiaoDiBianGeng', { sessionId, id: lu.id, status: 'running' }); } catch { /* noop */ }
        audit?.log('chat.xiao-di-spawn', { sessionId, fuMing, xiaoDi: lu.ming, hao: lu.hao, taskChars: String(args.task || '').length, shangXian: xiaoDiShangXian });
        // 子代理：**可以真干活**（写/读/列目录，同一个工作区沙箱），
        // 但**不允许再派小弟**（防止子代理无限繁殖）。
        let jieGuo = '';
        const xdKai = Date.now();
        try {
          const ziRenWu = `你是子代理「${lu.ming}」，由「${fuMing}」派出。请独立完成下面这一件具体的事，需要写文件就直接写（路径用工作区相对路径），并在最后给出可交付的结论。\n\n【子任务】${String(args.task || '').slice(0, 2000)}`;
          const subBase = workspaceDirOf(app.getPath('userData'), sessionId);
          try { fs.mkdirSync(subBase, { recursive: true }); } catch { /* noop */ }
          const subLoop = await liaoTianDaiGongJu(
            provider,
            {
              model: String(Qiu.model || ''),
              xiaoXiJi: [{ role: 'user', content: ziRenWu }],
              maxTokens: 1024,
              // 只给文件工具；不给 spawn_subagent
              tools: workToolSpecs() as unknown as GongJuGuiGe[],
            },
            async (subCall) => {
              const subName = String((subCall && subCall.function && subCall.function.name) || '');
              const subOut = runWorkTool(subBase, subCall as { function?: { name?: string; arguments?: unknown } });
              audit?.log('chat.xiao-di-tool', {
                sessionId,
                xiaoDi: lu.ming,
                tool: subOut.meta.tool || subName,
                ok: subOut.meta.ok,
                bytes: subOut.meta.bytes,
                path: subOut.meta.path,
                error: subOut.meta.error,
                security: WORK_TOOL_SECURITY,
              });
              return String(subOut.content).slice(0, 2000);
            },
            { zuiDaLunShu: 4, zuiDaJieGuoZiShu: ctx.zuiDaJieGuoZiShu, maxToolResultChars: 8000 },
          );
          jieGuo = String(subLoop.xiangYingTi?.choices?.[0]?.message?.content || '').slice(0, ctx.zuiDaJieGuoZiShu);
          /** 「等待某个行动完成」：子代理真干完一次就量一次（到点/到次走完整判断流程） */
          try {
            const haoShi = Date.now() - xdKai;
            const jie = await chaXingWei({
              xingWei: 'dengDaiXingDong', sessionId,
              moXing: String(Qiu.model || providerCfg.model || ''),
              shiJiMs: haoShi, ciShu: subLoop.lunShu || 1,
              qianMing: renWuQianMing({ gongJu: 'spawn_subagent', gongJuMing: benLunGongJuMing, buShu: (jiHuaRenWuJi.get(sessionId) || []).length }),
              jieDuan: `等待子代理「${lu.ming}」完成：耗时 ${shuoShiChang(haoShi)}、内部 ${subLoop.lunShu} 轮`,
              zhongLei: haoShi >= xingWeiGui('dengDaiXingDong').miao ? 'shiJian' : 'ciShu',
            });
            if (jie.yiChang) biaoEtaYiChang(sessionId, 'dengDaiXingDong', jie.liYou);
          } catch { /* 守卫出错不许影响子代理结论 */ }
        } catch (e) {
          jieGuo = `[${lu.ming}] 执行失败：${xiJingCuoWu(e)}`;
          try { bu.gengXin(lu.id, { status: 'failed', endedAt: Date.now() }); } catch { /* noop */ }
        }
        /**
         * 状态回写 + 广播：第四列「分身」卡按 `status` 画**竖线 / 删除线**，
         * 并在子代理出现时**自动把卡加进来**（产品要求，用户不用手动添加）。
         */
        try {
          const zuang = bu.gengXin(lu.id, { status: jieGuo.startsWith('[' + lu.ming + '] 执行失败') ? 'failed' : 'done', endedAt: Date.now() });
          broadcastToWindows('warmy:xiaoDiBianGeng', { sessionId, id: lu.id, status: zuang?.status || 'done' });
        } catch { /* noop */ }
        const huiBao = `[派出小弟] ${lu.ming}（第${lu.hao}号）\n【任务】${String(args.task || '').slice(0, 200)}\n【结论】${jieGuo}`;
        fachuKongzhitai({ cat: 'tool', code: 'tool.finish', data: { tool: gongJuMing, round: ctx.round, sessionId, ok: true, chars: huiBao.length, ms: Date.now() - t1 } });
        return huiBao.slice(0, ctx.zuiDaJieGuoZiShu);
      }
      if (isHostTool(gongJuMing) || ziDingGongJuJiQu().some((g) => g.name === gongJuMing)) {
        /**
         * 宿主工具：打开文件/网页、登记定时任务。
         * 权限：普通/严格授权下 open_path 只允许**工作区内**；完全授权才放开任意本机路径。
         * open_url 只收 http(s)（用系统默认浏览器打开）。
         */
        const t1h = Date.now();
        const baseH = workspaceDirOf(app.getPath('userData'), sessionId);
        const rawArgsH = call && call.function ? (call.function as { arguments?: unknown }).arguments : undefined;
        // 容错解析：截断/手写的 JSON 尽量修出来；修不出如实回参数错误，**不把裸解析器报错当回复**
        const jieH = jieXiGongJuCanShu(rawArgsH);
        const argsH: Record<string, unknown> = jieH.args;
        const quanQuan = () => {
          try { return String((settingsStore?.load() as { globalSecurity?: string } | undefined)?.globalSecurity || 'normal') === 'full'; }
          catch { return false; }
        };
        let huiBaoH = '';
        let okH = true;
        if (!jieH.ok) {
          okH = false;
          huiBaoH = `[${gongJuMing}] ${jieH.error || '参数不是合法 JSON'}`;
        }
        try {
          if (!jieH.ok) { /* 已如实回参错，跳过执行 */ }
          /**
           * **自定义工具**（设置→工具里从文件夹导入的 TOOL.json）：
           * 只是把 `command` 里 `{{arg}}` 换成实参后交给命令行 —— **走 run_shell 同一套安全检查**
           * （anquanJianCeMingLing + panDuanShouQuan + 越权询问），绝不绕过。
           */
          else if (ziDingGongJuJiQu().some((g) => g.name === gongJuMing)) {
            const ziDingGongJu = ziDingGongJuJiQu().find((g) => g.name === gongJuMing)!;
            let cmd = ziDingGongJu.command;
            for (const [k, v] of Object.entries(argsH || {})) {
              cmd = cmd.split('{{' + k + '}}').join(String(v ?? ''));
            }
            cmd = cmd.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
            const jian = anquanJianCeMingLing(cmd);
            const { dang: dangZ, ask: wenZ } = anQuanDangWei();
            const pan = panDuanShouQuan(dangZ, wenZ, 'shell', jian);
            if (!pan.allow && !pan.needAsk) {
              okH = false;
              huiBaoH = `[${gongJuMing}] 被拒（${dangZ}授权）：${pan.why}`;
            } else if (pan.allow || !wenZ) {
              const r2 = await yunXingMingLing(cmd, { cwd: baseH, timeoutMs: Number(argsH.timeoutMs) || 60000 });
              huiBaoH = `[${gongJuMing}] exit=${r2.code} (${r2.ms}ms)\n${r2.stdout}${r2.stderr ? '\n[stderr] ' + r2.stderr : ''}`;
              if (r2.code !== 0) okH = false;
            } else {
              const da = await qingQiuKaPian(sessionId, 'AI 请求运行自定义工具',
                `工具：${gongJuMing}\n命令：${cmd}\n（拒绝 = 不执行）`,
                [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }]);
              if (/^同意/.test(da)) {
                const r2 = await yunXingMingLing(cmd, { cwd: baseH, timeoutMs: Number(argsH.timeoutMs) || 60000 });
                huiBaoH = `[${gongJuMing}] exit=${r2.code} (${r2.ms}ms)\n${r2.stdout}${r2.stderr ? '\n[stderr] ' + r2.stderr : ''}`;
                if (r2.code !== 0) okH = false;
              } else {
                okH = false;
                huiBaoH = `[${gongJuMing}] 用户拒绝执行`;
              }
            }
          }
          else if (gongJuMing === 'ask_user') {
            /**
             * AI 拿不准时的**选择卡**：列出候选项（永远带「其他」自定义），用户选完自动继续。
             * 这是"不许自己瞎猜、也不许因此停下"的落点（产品要求）。
             */
            const biaoTi0 = String(argsH.title || argsH.biaoTi || '需要你做个决定');
            const ti0 = String(argsH.hint || argsH.ti || '');
            /**
             * 选项两种形态都收：`"纯字符串"` 或 `{ label, recommended, description }`。
             * `recommended: true` = 模型自评的最优方案 ⇒ 界面标「推荐」，
             * 且「自动选择」开着时按它直接执行（见 qingQiuKaPian）。
             */
            const houXuan = Array.isArray(argsH.options) ? (argsH.options as unknown[]).map((o) => {
              if (o && typeof o === 'object') {
                const it = o as { label?: unknown; biaoQian?: unknown; value?: unknown; id?: unknown; recommended?: unknown; tuiJian?: unknown; description?: unknown };
                const bq = String(it.label ?? it.biaoQian ?? it.value ?? it.id ?? '');
                return {
                  biaoQian: bq,
                  tuiJian: it.recommended === true || it.tuiJian === true,
                  ...(it.description ? { description: String(it.description) } : {}),
                };
              }
              return { biaoQian: String(o ?? ''), tuiJian: false };
            }).filter((o) => o.biaoQian.trim()) : [];
            const da = await qingQiuKaPian(sessionId, biaoTi0, ti0, houXuan.length ? houXuan : [{ biaoQian: '继续' }, { biaoQian: '暂停' }]);
            huiBaoH = da
              ? `[ask_user] 用户选择：${da}`
              : '[ask_user] 用户暂时没有选择（已等满时限）。请按最稳妥的理解继续，并在回复里说明你假设了什么。';
          } else if (gongJuMing === 'plan_update' || gongJuMing === 'plan_verify') {
            /**
             * 计划模式：AI 先列计划、逐个完成、逐个验证（任务树 T1/T1.1）。
             * 界面第四列的「计划任务」卡片实时跟着更新（被关掉也会自动补回）。
             */
            const jiu = jiHuaRenWuJi.get(sessionId) || [];
            if (gongJuMing === 'plan_update') {
              const bu = Array.isArray(argsH.steps) ? (argsH.steps as unknown[]).map((x) => {
                const it = (x && typeof x === 'object') ? x as Record<string, unknown> : {};
                return {
                  id: String(it.id || ''),
                  title: String(it.title || '').slice(0, 200),
                  status: (['pending', 'doing', 'done', 'verified', 'blocked'].includes(String(it.status)) ? String(it.status) : 'pending') as JiHuaBu['status'],
                  note: String(it.note || '').slice(0, 300),
                };
              }) : [];
              /**
               * **保留已验证状态**（真事故：模型每轮重发全量计划，把 verified 重置成 pending
               * ⇒ 无限重复派发同一步，用户看到"同一任务做了 10 遍"）。
               * 只有新计划里**没有**的步骤才算被删；已 verified 的步骤不被降级。
               */
              const jiuMap = new Map(jiu.map((x) => [x.id, x]));
              const heBing = bu.map((x) => {
                const old = jiuMap.get(x.id);
                if (old && old.status === 'verified' && x.status !== 'verified') {
                  return { ...x, status: 'verified' as const, note: old.note || x.note };
                }
                return x;
              });
              jiHuaBaoCun(sessionId, heBing);
              const shengYu = heBing.filter((x) => x.status !== 'verified').length;
              huiBaoH = `[plan_update] 已更新计划（${heBing.length} 步，其中 ${shengYu} 步待完成）。界面右侧「计划任务」卡片已同步；请继续逐个完成并逐个验证。`;
            } else {
              const id0 = String(argsH.id || '');
              const i0 = jiu.findIndex((x) => x.id === id0);
              if (i0 < 0) { okH = false; huiBaoH = `[plan_verify] 找不到步骤 ${id0}`; }
              else {
                const jiuX = jiu[i0];
                if (!jiuX) {
                  okH = false;
                  huiBaoH = `[plan_verify] 找不到步骤 ${id0}`;
                } else {
                  const xin: JiHuaBu = { ...jiuX, id: jiuX.id || id0, title: jiuX.title || id0, status: 'verified', note: String(argsH.note || jiuX.note || '').slice(0, 300) };
                  jiu[i0] = xin;
                  jiHuaBaoCun(sessionId, jiu);
                  huiBaoH = `[plan_verify] ${id0} 已标记为 verified（证据：${xin.note || '—'}）。剩余 ${jiu.filter((x) => x.status !== 'verified').length} 步待完成/验证。`;
                }
              }
            }
          } else if (gongJuMing === 'get_time') {
            /**
             * **感知时间**（产品要求）：本机时间 + 联网时间一起给，
             * 并算出漂移。凡是"等一会儿/到几点"的判断都要先问它，别凭感觉估
             * （真事故：模型说"30 秒只花了 115 毫秒"——它根本没有可信的时间源）。
             */
            const benDi = new Date();
            let wangLuo = '';
            let piaoYiMs: number | null = null;
            try {
              // HTTP Date 头是最轻的联网时间源；失败就如实说没有
              const res = await fetch('https://www.baidu.com', { method: 'HEAD', signal: AbortSignal.timeout(4000) });
              const h = res.headers.get('date');
              if (h) {
                wangLuo = new Date(h).toISOString();
                const w = new Date(h).getTime();
                if (Number.isFinite(w)) piaoYiMs = w - benDi.getTime();
              }
            } catch { /* 联网时间拿不到就如实留空 */ }
            huiBaoH = JSON.stringify({
              local: benDi.toISOString(),
              localText: benDi.toLocaleString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
              epochMs: benDi.getTime(),
              network: wangLuo || null,
              driftMs: piaoYiMs,
              note: wangLuo
                ? '本机与联网时间都给你了；需要等待/定时请用 epochMs 算差值，别凭感觉估。'
                : '联网时间没拿到（断网或被拦）；请以 local/epochMs 为准。',
            });
          } else if (gongJuMing === 'wait_seconds') {
            /**
             * **真正等待 N 秒**（跨平台）。真事故：模型用 `run_shell` 跑 `sleep 30`，
             * Windows 上没有 `sleep` ⇒ 秒回"30 秒到了（115 毫秒）"，任务被假完成。
             */
            const miao = Math.max(0.5, Math.min(600, Number(argsH.seconds) || 0));
            const kai = Date.now();
            await new Promise((r2) => setTimeout(r2, Math.round(miao * 1000)));
            const shi = Date.now() - kai;
            huiBaoH = JSON.stringify({ waitedMs: shi, requestedSeconds: miao, local: new Date().toISOString(), note: '已按请求等待；请用 waitedMs 确认真的等满了。' });
          } else if (gongJuMing === 'open_url') {
            const url = String(argsH.url || '').trim();
            if (!/^https?:\/\//i.test(url)) { okH = false; huiBaoH = '[open_url] 只接受 http/https 网址'; }
            else { await shell.openExternal(url); huiBaoH = `[open_url] 已用系统浏览器打开 ${url}`; }
          } else if (gongJuMing === 'open_path' || gongJuMing === 'open_file') {
            const p0 = String(argsH.path || '').trim();
            const { full: quanQuan2, ask: yaoWen } = anQuanDangWei();
            let abs = '';
            let yueQuan = false;
            // 系统用户目录别名（Desktop/桌面/…）→ 真实路径（真事故：模型写 Desktop/x.txt 以为是系统桌面）
            let zhenLu: { abs: string; rest: string } | null = null;
            try { zhenLu = yingSheYongHuWenJianJia(p0); } catch { zhenLu = null; }
            if (zhenLu) {
              abs = zhenLu.rest ? path.resolve(zhenLu.abs, zhenLu.rest) : path.resolve(zhenLu.abs);
              yueQuan = true;   // 系统目录在工作区外 ⇒ 走越权流程（完全授权直接放行）
            } else if (path.isAbsolute(p0)) {
              if (quanQuan2) abs = p0;
              else yueQuan = true;
            } else {
              abs = path.resolve(baseH, p0);
              const rel = path.relative(baseH, abs);
              if (rel.startsWith('..') || path.isAbsolute(rel)) yueQuan = true;
            }
            if (yueQuan) {
              if (quanQuan2) {
                // 完全授权：系统目录/绝对路径直接放行
              } else if (yaoWen) {
                const da = await qingQiuKaPian(
                  sessionId,
                  'AI 请求打开工作区外的文件',
                  `路径：${p0}\n（拒绝 = 只能开工作区内文件）`,
                  [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }],
                );
                // 同意放行：保留上面已解析好的 abs（含系统目录映射结果）
                if (/^同意/.test(da)) { /* abs 已就绪 */ }
                else { okH = false; abs = ''; huiBaoH = `[open_path] 用户拒绝/未授权打开 ${p0}。若需要，请让用户在顶部改成「完全授权」。`; }
              } else {
                okH = false;
                huiBaoH = '[open_path] 普通/严格授权只允许工作区内的相对路径（要开本机任意路径请改成「完全授权」，或勾上「超出权限询问」由用户批准）';
              }
            }
            if (okH && abs) {
              const r0 = await shell.openPath(abs);
              if (r0) { okH = false; huiBaoH = `[open_path] 打开失败：${r0}`; }
              else huiBaoH = `[open_path] 已用系统默认程序打开 ${abs}`;
            }
          } else if (gongJuMing === 'run_shell') {
            const cmd = String(argsH.command || '').trim();
            const { dang, ask: yaoWen2 } = anQuanDangWei();
            const jian = anquanJianCeMingLing(cmd);
            const pan = panDuanShouQuan(dang, yaoWen2, 'shell', jian);
            if (!cmd) { okH = false; huiBaoH = '[run_shell] 请给出 command'; }
            else if (!pan.allow && !pan.needAsk) { okH = false; huiBaoH = `[run_shell] 被拒（${dang}授权）：${pan.why}`; }
            else if (!pan.allow) {
              const da = await qingQiuKaPian(sessionId, 'AI 请求执行命令',
                `命令：${cmd}\n风险：${jian.summary}\n（拒绝 = 不执行）`,
                [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }]);
              if (/^同意/.test(da)) {
                const r2 = await yunXingMingLing(cmd, { cwd: String(argsH.cwd || baseH), timeoutMs: Number(argsH.timeoutMs) || 60000 });
                huiBaoH = `[run_shell] exit=${r2.code} (${r2.ms}ms)\n${r2.stdout}${r2.stderr ? '\n[stderr] ' + r2.stderr : ''}`;
              } else { okH = false; huiBaoH = `[run_shell] 用户拒绝执行：${cmd}`; }
            } else {
              const r2 = await yunXingMingLing(cmd, { cwd: String(argsH.cwd || baseH), timeoutMs: Number(argsH.timeoutMs) || 60000 });
              huiBaoH = `[run_shell] exit=${r2.code} (${r2.ms}ms, 风险 ${jian.risk})\n${r2.stdout}${r2.stderr ? '\n[stderr] ' + r2.stderr : ''}`;
              if (r2.code !== 0) okH = false;
            }
          } else if (gongJuMing === 'check_safety') {
            const cmd = String(argsH.command || '');
            const p0 = String(argsH.path || '');
            const jian = p0 ? anquanJianCeJiNeng(p0) : anquanJianCeMingLing(cmd);
            huiBaoH = `[check_safety] ${jian.summary}（risk=${jian.risk}, autoOk=${jian.autoOk}）`;
          } else if (gongJuMing === 'find_skill') {
            const q = String(argsH.query || '').trim().toLowerCase();
            const zhuan = String(argsH.path || '').trim();
            const lie: string[] = [];
            const sao = (dir: string, ceng = 0) => {
              if (ceng > 3) return;
              let ems: string[] = [];
              try { ems = fs.readdirSync(dir); } catch { return; }
              for (const e of ems.slice(0, 80)) {
                const p = path.join(dir, e);
                let st: fs.Stats; try { st = fs.statSync(p); } catch { continue; }
                if (st.isDirectory()) {
                  if (fs.existsSync(path.join(p, 'SKILL.md'))) {
                    let desc = '';
                    try { desc = fs.readFileSync(path.join(p, 'SKILL.md'), 'utf8').split('\n').filter((l) => l.trim()).slice(0, 3).join(' ').slice(0, 120); } catch { /* noop */ }
                    const x = `${e} — ${p}${desc ? ' :: ' + desc : ''}`;
                    if (!q || x.toLowerCase().includes(q)) lie.push(x);
                  } else sao(p, ceng + 1);
                }
              }
            };
            if (zhuan) sao(zhuan);
            for (const root of jinengGen()) { try { sao(root.root); } catch { /* noop */ } }
            huiBaoH = lie.length
              ? `[find_skill] 找到 ${lie.length} 个技能：\n` + lie.slice(0, 20).join('\n')
              : '[find_skill] 没有匹配的技能。可让用户把技能包放进技能目录，或用 install_skill 安装本地目录。';
          } else if (gongJuMing === 'install_skill') {
            const p0 = String(argsH.path || '').trim();
            const { dang: dang2, ask: yaoWen3 } = anQuanDangWei();
            const jian = anquanJianCeJiNeng(p0);
            const pan = panDuanShouQuan(dang2, yaoWen3, 'skill', jian);
            if (!p0 || !fs.existsSync(p0)) { okH = false; huiBaoH = `[install_skill] 目录不存在：${p0}`; }
            else if (!fs.existsSync(path.join(p0, 'SKILL.md'))) { okH = false; huiBaoH = '[install_skill] 不是技能包（缺 SKILL.md）'; }
            else if (!pan.allow && !pan.needAsk) { okH = false; huiBaoH = `[install_skill] 被拒（${dang2}授权）：${pan.why}`; }
            else if (!pan.allow) {
              const da = await qingQiuKaPian(sessionId, 'AI 请求安装技能',
                `技能目录：${p0}\n安全检测：${jian.summary}\n（拒绝 = 不安装）`,
                [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }]);
              if (/^同意/.test(da)) huiBaoH = await anZhuangJiNengBao(p0, String(argsH.name || ''));
              else { okH = false; huiBaoH = `[install_skill] 用户拒绝安装 ${p0}`; }
            } else {
              huiBaoH = await anZhuangJiNengBao(p0, String(argsH.name || ''));
            }
          } else if (gongJuMing === 'read_docx') {
            const p0 = String(argsH.path || '').trim();
            const r2 = duDocx(p0);
            okH = !!r2.ok;
            huiBaoH = r2.ok ? `[read_docx] ${p0}\n${r2.text.slice(0, 8000)}` : `[read_docx] 失败：${r2.error}`;
          } else if (gongJuMing === 'read_pptx') {
            const p0 = String(argsH.path || '').trim();
            const r2 = duPptx(p0);
            okH = !!r2.ok;
            huiBaoH = r2.ok
              ? `[read_pptx] ${p0}（${r2.slides.length} 页）\n` + r2.slides.map((s, i) => `--- 第 ${i + 1} 页 ---\n${s.slice(0, 1200)}`).join('\n').slice(0, 8000)
              : `[read_pptx] 失败：${r2.error}`;
          } else if (gongJuMing === 'fetch_url') {
            const url = String(argsH.url || '').trim();
            const r2 = await zhuaQuWangZhi(url, { maxBytes: Number(argsH.maxBytes) || 200000 });
            okH = !!r2.ok;
            huiBaoH = r2.ok ? `[fetch_url] HTTP ${r2.status}（${r2.bytes} 字节）\n${r2.text}` : `[fetch_url] 失败：${r2.error}`;
          } else if (gongJuMing === 'download_file') {
            const url = String(argsH.url || '').trim();
            const { dang: dang3, ask: yaoWen4 } = anQuanDangWei();
            const jian = anquanJianCeMingLing('curl ' + url);
            const pan = panDuanShouQuan(dang3, yaoWen4, 'shell', jian);
            // 保存路径沿用工作区/系统目录映射与越权流程
            let baoCun = '';
            try {
              const resolved = resolveInside(baseH, String(argsH.path || ''), dang3 === 'full');
              baoCun = resolved;
            } catch (eP) {
              if (yaoWen4) {
                const da = await qingQiuKaPian(sessionId, 'AI 请求下载到工作区外',
                  `地址：${url}\n保存到：${String(argsH.path || '')}\n（拒绝 = 不保存）`,
                  [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }]);
                if (/^同意/.test(da)) baoCun = String(argsH.path || '');
                else { okH = false; huiBaoH = '[download_file] 用户拒绝'; }
              } else { okH = false; huiBaoH = '[download_file] ' + String((eP as Error)?.message || eP); }
            }
            if (okH && baoCun) {
              const r2 = await xiaZaiWenJian(url, baoCun, { maxBytes: Number(argsH.maxBytes) || 50 * 1024 * 1024 });
              okH = !!r2.ok;
              huiBaoH = r2.ok ? `[download_file] 已保存 ${r2.path}（${r2.bytes} 字节）` : `[download_file] 失败：${r2.error}`;
            }
          } else if (gongJuMing === 'knowledge_query') {
            // **知识库检索**（实体/事件；与 recall 记忆互补）
            const q = String(argsH.query || '').trim();
            if (!q) { okH = false; huiBaoH = '[knowledge_query] 需要 query 参数'; }
            else if (!knowledge) { okH = false; huiBaoH = '[knowledge_query] 知识库未就绪'; }
            else {
              const jieGuo = knowledge.query(q);
              okH = true;
              const shiTi = (jieGuo.entities || []).slice(0, 10);
              const shiJian = (jieGuo.events || []).slice(0, 10);
              huiBaoH = `[knowledge_query] "${q}" 命中实体 ${shiTi.length}、事件 ${shiJian.length}\n`
                + (shiTi.length ? '实体:\n' + shiTi.map((e) => `· [${e.kind}] ${e.ming}${Object.keys(e.attrs || {}).length ? ' ' + JSON.stringify(e.attrs) : ''} (id=${e.id})`).join('\n') + '\n' : '')
                + (shiJian.length ? '事件:\n' + shiJian.map((e) => `· ${e.biaoTi}${e.result ? ' → ' + String(e.result).slice(0, 120) : ''} (id=${e.id})`).join('\n') : '')
                + (!shiTi.length && !shiJian.length ? '（无命中；可换关键词，或用 knowledge_add 记下新事实）' : '');
            }
          } else if (gongJuMing === 'knowledge_add') {
            // **知识库写入**（实体和/或事件；结构化事实，不是对话流水）
            if (!knowledge) { okH = false; huiBaoH = '[knowledge_add] 知识库未就绪'; }
            else {
              try {
                const eIn = (argsH.entity || null) as { id?: string; kind?: string; ming?: string; attrs?: Record<string, string> } | null;
                const vIn = (argsH.event || null) as { biaoTi?: string; result?: string; tool?: string; method?: string; entityIds?: string[] } | null;
                const ji = [];
                if (eIn && eIn.ming) {
                  const e = knowledge.upsertEntity({
                    id: String(eIn.id || ('e-' + Date.now().toString(36))),
                    kind: (eIn.kind as never) || 'concept',
                    ming: String(eIn.ming),
                    attrs: (eIn.attrs as Record<string, string>) || {},
                    anchors: [],
                  });
                  ji.push('实体 ' + e.ming + ' (id=' + e.id + ')');
                }
                if (vIn && vIn.biaoTi) {
                  const ids = Array.isArray(vIn.entityIds) ? vIn.entityIds.map(String) : [];
                  const e = knowledge.addEvent({
                    id: 'ev-' + Date.now().toString(36),
                    biaoTi: String(vIn.biaoTi),
                    result: vIn.result ? String(vIn.result).slice(0, 2000) : undefined,
                    tool: vIn.tool ? String(vIn.tool) : undefined,
                    method: vIn.method ? String(vIn.method) : undefined,
                    entityIds: ids,
                    anchors: [],
                    ts: Date.now(),
                  });
                  ji.push('事件 ' + e.biaoTi + ' (id=' + e.id + ')');
                }
                okH = ji.length > 0;
                huiBaoH = ji.length ? '[knowledge_add] 已记：' + ji.join('；') : '[knowledge_add] 未提供 entity.ming 或 event.biaoTi';
              } catch (eK) {
                okH = false;
                huiBaoH = '[knowledge_add] 失败：' + xiJingCuoWu(eK);
              }
            }
          } else {
            // schedule_task
            const ren = await dengJiDingShiRenWu(sessionId, {
              name: String(argsH.name || '').trim() || '定时任务',
              prompt: String(argsH.prompt || '').trim(),
              everyMinutes: Number(argsH.everyMinutes) || 0,
              dailyAt: String(argsH.dailyAt || '').trim(),
            });
            okH = !!ren.ok;
            huiBaoH = ren.ok
              ? `[schedule_task] 已登记「${ren.task?.name}」（id=${ren.task?.id}，${ren.task?.desc}）。到点系统会自动发这一轮，界面右栏「定时任务」卡片可查看。`
              : `[schedule_task] 登记失败：${ren.error}`;
          }
        } catch (eH) {
          okH = false;
          huiBaoH = `[${gongJuMing}] 失败：${xiJingCuoWu(eH)}`;
        }
        audit?.log('chat.host-tool', { sessionId, tool: gongJuMing, ok: okH, security: quanQuan() ? 'full' : 'normal' });
        metrics.recordToolCall({ ts: Date.now(), sessionId, round: ctx.round, tool: gongJuMing, ok: okH, chars: huiBaoH.length, ms: Date.now() - t1h });
        fachuKongzhitai({ cat: 'tool', code: 'tool.finish', data: { tool: gongJuMing, round: ctx.round, sessionId, ok: okH, chars: huiBaoH.length, ms: Date.now() - t1h } });
        return huiBaoH.slice(0, ctx.zuiDaJieGuoZiShu);
      }
      if (isWorkTool(gongJuMing)) {
        const base = workspaceDirOf(app.getPath('userData'), sessionId);
        try { fs.mkdirSync(base, { recursive: true }); } catch { /* 建不出来下面会如实失败 */ }
        const { full, ask } = anQuanDangWei();
        /**
         * 完全授权 ⇒ 直接放开（可读写本机任意路径，AI 真正能操作这台电脑）；
         * 普通/严格 ⇒ 先在工作区内做；越权时按「超出权限是否询问」弹请求卡，
         * 用户同意就**这一次**放开，拒绝就如实回绝（AI 不会硬来）。
         */
        let wr = runWorkTool(base, call as { function?: { name?: string; arguments?: unknown } }, full, app.getAppPath());
        if (!wr.meta.ok && /workspace-escape|absolute-path-not-allowed/.test(String(wr.meta.error || '')) && !full) {
          let luJing = '';
          try {
            const rawA = (call as { function?: { arguments?: unknown } }).function?.arguments;
            const oa = typeof rawA === 'string' ? JSON.parse(rawA || '{}') : (rawA || {});
            luJing = String((oa as { path?: unknown }).path || '');
          } catch { /* 参数解析失败就空着 */ }
          if (ask) {
            const da = await qingQiuKaPian(
              sessionId,
              'AI 请求访问工作区外的文件',
              `操作：${gongJuMing}\n路径：${luJing}\n（拒绝 = 改用工作区内路径）`,
              [{ id: 'yes', biaoQian: '同意' }, { id: 'no', biaoQian: '拒绝' }],
            );
            if (/^同意/.test(da)) {
              wr = runWorkTool(base, call as { function?: { name?: string; arguments?: unknown } }, true, app.getAppPath());
            } else {
              wr = {
                ok: false,
                content: `[${gongJuMing}] 用户拒绝/未授权这次越权操作（路径：${luJing || '未知'}）。请改用工作区内的相对路径，或先请用户在顶部把授权改成「完全授权」。`,
                meta: { tool: gongJuMing, ok: false, bytes: 0, error: 'user-denied' },
              };
            }
          }
        }
        // 有文件生成 ⇒ 广播给界面（自动补上「文件产物」卡片，见渲染层）
        if (wr.ok && wr.meta && (wr.meta.tool === 'write_file' || wr.meta.tool === 'make_docx' || wr.meta.tool === 'make_pptx')) {
          try {
            /**
             * abs 必须是**真实绝对路径**：桌面/文档这类系统目录写出的文件，
             * meta.path 本身就是绝对路径，再 path.join(base, …) 会拼出垃圾路径
             * （真事故：产物卡点开报错 not-found / workspace-escape）。
             */
            const luJing = String(wr.meta.path || '');
            const zhenAbs = String(wr.meta.abs || '')
              || (path.isAbsolute(luJing) ? luJing : path.join(base, luJing));
            broadcastToWindows('warmy:wenJianChanSheng', { sessionId, path: luJing, abs: zhenAbs, bytes: wr.meta.bytes || 0, root: base, ts: Date.now() });
          } catch { /* noop */ }
        }
        audit?.log('chat.work-tool', {
          sessionId,
          tool: wr.meta.tool,
          ok: wr.meta.ok,
          bytes: wr.meta.bytes,
          path: wr.meta.path,
          error: wr.meta.error,
          security: WORK_TOOL_SECURITY,
        });
        metrics.recordToolCall({ ts: Date.now(), sessionId, round: ctx.round, tool: wr.meta.tool, ok: wr.meta.ok, chars: String(wr.content).length, ms: Date.now() - t1 });
        fachuKongzhitai({
          cat: 'tool',
          code: 'tool.finish',
          data: { tool: wr.meta.tool, round: ctx.round, sessionId, ok: wr.meta.ok, chars: String(wr.content).length, ms: Date.now() - t1 },
        });
        return String(wr.content).slice(0, ctx.zuiDaJieGuoZiShu);
      }
      const out = await withFileAccessScope(sessionId, () => yunxingJiyiCangGongju(memory, call, { maxChars: ctx.zuiDaJieGuoZiShu }));
      metrics.recordToolCall({
        ts: Date.now(),
        sessionId,
        round: ctx.round,
        tool: out.meta.tool,
        ok: out.ok,
        chars: out.chars,
        ms: Date.now() - t1,
      });
      // T194：工具调用结束（结论 + 字节数 + 耗时）
      fachuKongzhitai({
        cat: 'tool',
        code: 'tool.finish',
        data: { tool: out.meta.tool || toolName, round: ctx.round, sessionId, ok: out.ok, chars: out.chars, ms: Date.now() - t1 },
      });
      audit?.log('chat.tool', {
        sessionId,
        round: ctx.round,
        tool: out.meta.tool,
        ok: out.ok,
        chars: out.chars,
        anchor: out.meta.anchor,
        cards: out.meta.cards,
        hitLevel: out.meta.hitLevel,
        truncated: out.meta.truncated,
        queryChars: out.meta.queryChars,
        error: out.meta.error,
        ms: Date.now() - t1,
      });
      return out.content;
  };
  const loop = await liaoTianDaiGongJu(
    liuShiProvider,
    { ...Qiu, tools },
    async (call, ctx) => {
      const t1 = Date.now();
      const out = await zhiXingGongJu(call, ctx as { round: number; zuiDaJieGuoZiShu: number });
      // 单次工具调用的"两把尺子"：耗时 + 同一工具本轮第几次
      try {
        const ming = String((call as { function?: { name?: string } } | undefined)?.function?.name || 'tool');
        /**
         * **故意等待的工具不算异常**（真机反馈：`wait_seconds` 一等就是几十秒，
         * 被"单次工具 60 秒"的尺子判成异常 ⇒ 任务被误停）。这类工具的耗时就是它的功能本身。
         */
        const guYiDengDai = ming === 'wait_seconds' || ming === 'schedule_task';
        const ci = (gongJuCiShu.get(ming) || 0) + 1;
        gongJuCiShu.set(ming, ci);
        const haoShi = Date.now() - t1;
        const jieDuan = `单次工具调用 ${ming}：耗时 ${shuoShiChang(haoShi)}、本轮第 ${ci} 次`;
        if (!guYiDengDai) {
          const jie = await chaXingWei({
            xingWei: 'gongJu', sessionId,
            moXing: String(Qiu.model || providerCfg.model || ''),
            shiJiMs: haoShi, ciShu: ci,
            qianMing: renWuQianMing({ gongJu: ming, gongJuMing: benLunGongJuMing, buShu: (jiHuaRenWuJi.get(sessionId) || []).length }),
            jieDuan, zhongLei: haoShi >= xingWeiGui('gongJu').miao ? 'shiJian' : 'ciShu',
          });
          if (jie.yiChang) {
            // 判异常 ⇒ 这一轮不再往下干（工具循环里没法回溯取消，但能拦住后续工具与续派）
            benLunGongJuMing.length = 0;
            throw new Error(`[eta-anomaly] ${jie.liYou}`);
          }
        }
      } catch (e) {
        if (String((e as Error)?.message || '').startsWith('[eta-anomaly]')) throw e;
        /* 守卫自身出错不许影响工具结果 */
      }
      return out;
    },
    {
      zuiDaLunShu: limits.zuiDaLunShu,
      zuiDaJieGuoZiShu: limits.zuiDaJieGuoZiShu,
      maxToolResultChars: limits.totalChars,
      onEvent: (Shi) => {
        if (Shi.kind === 'degraded') audit?.log('chat.tools.degraded', { sessionId, detail: Shi.detail });
      },
    }
  );

  metrics.recordToolLoop({
    ts: Date.now(),
    sessionId,
    qingQiuJi: loop.qingQiuJi,
    lunShu: loop.lunShu,
    gongJuDiaoYongJi: loop.gongJuDiaoYongJi,
    toolResultChars: loop.toolResultChars,
    degraded: loop.degraded,
    tingZhiYuanYin: loop.tingZhiYuanYin,
  });
  audit?.log('chat.tools.done', {
    sessionId,
    qingQiuJi: loop.qingQiuJi,
    lunShu: loop.lunShu,
    gongJuDiaoYongJi: loop.gongJuDiaoYongJi,
    toolResultChars: loop.toolResultChars,
    degraded: loop.degraded,
    tingZhiYuanYin: loop.tingZhiYuanYin,
  });
  return { ...loop, tooled: !!tools };
}

/** 视图预算：SettingsStore 可配（ADR 002 要求"注入上下文有固定上限"且可调） */
/** 由百分比 → 实际字符预算；并保证不低于最小可用 token（约 2048） */
const MIN_CONTEXT_TOKENS = 2048;
const CHARS_PER_TOKEN_EST = 1.6;
/** 已知模型上下文窗口（token）；settings.modelContextTokens 可覆盖 */
const MODEL_CTX_MAP: Record<string, number> = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'mimo-v2.5-pro': 131072,
  'mimo-v2.5': 131072,
  'qwen3.7-max': 131072,
  'qwen3.8-27b': 32768,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-5-sonnet': 200000,
};
function modelWindowTokens(modelId?: string): number | null {
  if (!modelId) return null;
  const m = String(modelId).trim();
  /**
   * **真实能力优先**（真机反馈）：上下文窗口要跟着**当前这个牛马实际在用的模型**走，
   * 不是写死的对照表。真实值是"拉取模型"时问出来的 `contextLen`（`modelNengLiMeta`），
   * 拿不到才退回已知表。滑块的最高也因此跟着变。
   */
  try {
    const neng = modelNengLiMeta.get(m) || modelNengLiMeta.get(m.split('/').pop() || '');
    const zhen = Number(neng && (neng as { contextLen?: number }).contextLen) || 0;
    if (zhen >= 1024) return zhen;
  } catch { /* 读不到就退回已知表 */ }
  return MODEL_CTX_MAP[m] || MODEL_CTX_MAP[m.split('/').pop() || ''] || null;
}
function youPeizhiSuanShangXiaWenYuSuan(modelId?: string): { chars: number; percent: number; tokens: number; maxTokens: number; minPercent: number } {
  let percent = 60;
  let maxTokens = 32768;
  let youZhenShi = false;
  try {
    const mw = modelWindowTokens(modelId);
    if (mw && mw >= 4096) { maxTokens = mw; youZhenShi = true; }

    const s = settingsStore?.load();
    const p = Number(s?.contextBudgetPercent);
    // 上限放开到 100%：滑块的最高 = 当前牛马的**实际上下文**（真机反馈）
    if (Number.isFinite(p)) percent = Math.min(100, Math.max(10, Math.round(p)));
    const m = Number(s?.modelContextTokens);
    // 用户显式覆盖只在**拿不到真实窗口**时生效（不许把"实际上下文"盖掉）
    if (!youZhenShi && Number.isFinite(m) && m >= 4096) maxTokens = m;
  } catch { /* 用默认 */ }
  const minPercent = Math.min(100, Math.ceil((MIN_CONTEXT_TOKENS / maxTokens) * 100));
  const effPercent = Math.max(percent, minPercent);
  const tokens = Math.max(MIN_CONTEXT_TOKENS, Math.round((effPercent / 100) * maxTokens));
  const chars = Math.max(200, Math.round(tokens * CHARS_PER_TOKEN_EST));
  return { chars, percent: effPercent, tokens, maxTokens, minPercent };
}

const SHANGXIAWEN_CHONGSHI_BUZHOU = [1.0, 0.6, 0.35, 0.2];
function isContextLengthError(err: unknown): boolean {
  const s = String((err as Error)?.message || err || '');
  return /context|token|too long|maximum length|context_length|maximum context/i.test(s);
}
function budgetCharsForStep(baseChars: number, buZhou: number): number {
  return Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.round(baseChars * buZhou));
}

/**
 * 上下文超限时自动收缩重试：100% → 60% → 35% → 20%（相对基础预算）。
 * 群聊等无滑块场景由后台自动判断；到最小值仍失败则如实告知用户，不再无限重试。
 */
async function daiShangXiaWenChongShiYunXing<T>(
  baseChars: number,
  fn: (budgetChars: number) => Promise<T>,
  isCtxErr: (e: unknown) => boolean = isContextLengthError
): Promise<{ result: T; usedBudget: number; retries: number; gaveUp?: string }> {
  let lastErr: unknown;
  let retries = 0;
  for (let i = 0; i < SHANGXIAWEN_CHONGSHI_BUZHOU.length; i++) {
    const budget = budgetCharsForStep(baseChars, SHANGXIAWEN_CHONGSHI_BUZHOU[i]!);
    try {
      const result = await fn(budget);
      return { result, usedBudget: budget, retries };
    } catch (e) {
      lastErr = e;
      if (!isCtxErr(e)) throw e;
      retries += 1;
    }
  }
  const xiaoXi = String((lastErr as Error)?.message || lastErr || 'context-too-small');
  return {
    result: { ok: false, error: xiaoXi, contextTooSmall: true, retries } as unknown as T,
    usedBudget: budgetCharsForStep(baseChars, SHANGXIAWEN_CHONGSHI_BUZHOU[SHANGXIAWEN_CHONGSHI_BUZHOU.length - 1]!),
    retries,
    gaveUp: xiaoXi,
  };
}

function contextBudgetChars(modelId?: string): number {
  try {
    const v = Number(settingsStore?.load()?.contextBudgetChars) || youPeizhiSuanShangXiaWenYuSuan(modelId).chars;
    // 低于下限会让可执行指针放不下（下限 200 + 上限 20 万，防止误配出荒唐值）
    if (Number.isFinite(v)) {
      return Math.min(200000, Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.floor(v)));
    }
  } catch {
    /* 配置坏了就退回默认 */
  }
  return DEFAULT_CONTEXT_BUDGET_CHARS;
}

/** 统一的视图渲染入口：所有注入点都走这里，不许另写一份（不变量 #2） */
function renderChatView(key: string, recallHint?: string, budgetCharsOverride?: number) {
  const shitu = xuanranYoujieShitu(chatLogs.get(key) || [], {
    budgetChars: Number.isFinite(budgetCharsOverride as number) ? Number(budgetCharsOverride) : contextBudgetChars(),
    keepHead: DEFAULT_KEEP_HEAD,
    keepTail: DEFAULT_KEEP_TAIL,
    recallHint,
  });
  metrics.recordView({
    ts: Date.now(),
    sessionId: key,
    logEntries: shitu.stats.logEntries,
    logBytes: shitu.stats.logBytes,
    viewBytes: shitu.stats.viewBytes,
    budgetChars: shitu.stats.budgetChars,
    pointers: shitu.stats.pointers,
  });
  return shitu;
}

/** 运行中的插入指令级别 */
const insertMode = new Map<string, 'outer' | 'inner'>();
/**
 * Provider 配置（由设置 UI 写入）。
 * **落盘**：元数据进 settings.json 的 `activeProvider`，密钥进 SecureKeyStore，
 * 所以重启后"配好的供应商"还在（以前只活在内存里，重启即丢）。
 */
let providerCfg = {
  presetId: 'deepseek',
  apiKey: '',
  baseURL: '',
  model: 'deepseek-chat',
  protocol: 'openai-compatible' as 'openai-compatible' | 'anthropic' | 'ollama',
};

// 密钥存储实例见上方 `let secureKeys`（同一份；这里不再重复声明）

/** 启动时把「当前生效的供应商」从设置读回内存，密钥按 id 从 SecureKeyStore 解出 */
function huiFuHuoYueGongYingShang(): void {
  try {
    const s = settingsStore?.load();
    const a = s?.activeProvider;
    if (!a?.presetId) return;
    providerCfg = {
      presetId: a.presetId,
      apiKey: '',
      baseURL: guiFanBaseURL(a.baseURL || ''),
      // 模型名必须是纯 id：历史设置里可能存的是「供应商 · 模型」复合展示标签（发出去会 HTTP 400）
      model: jieMoXingMing(a.model || providerCfg.model) || providerCfg.model,
      protocol: a.protocol || 'openai-compatible',
    };
  } catch { /* 读不回就保持默认；界面里能重新配 */ }
}

/**
 * 取某个供应商的密钥：
 *  · 界面上刚输入的明文优先；
 *  · 否则按 id 从 SecureKeyStore 解出（这样重启后无需重输）。
 */
async function jiexiGongyingshangMiyao(presetId: string, shuru?: string): Promise<string> {
  const yiLeiXing = String(shuru || '');
  if (yiLeiXing) return yiLeiXing;
  try {
    return (await secureKeys?.load(presetId)) || '';
  } catch {
    return '';
  }
}

/**
 * 聊天/拉取模型前调用：内存里没有密钥就按 id 从 SecureKeyStore 解出来。
 * 解不出来时**保持没有**（调用方照旧如实报"没有密钥"），不编也不假装。
 */
async function baozhangGongyingshangMiyao(): Promise<void> {
  if (providerCfg.apiKey || providerCfg.protocol === 'ollama') return;
  const k = await jiexiGongyingshangMiyao(providerCfg.presetId);
  if (k) providerCfg.apiKey = k;
}

/**
 * **模型 → 供应商**：找到真正拥有这个模型的那一家（settings.providers 里 models 含它，或它的默认模型就是它）。
 *
 * 真事故：用户用 **Ollama 的模型**聊天，但「当前生效供应商」是没配密钥的 DeepSeek ⇒
 * 报「未配置 API Key」。Ollama 本来就不需要 key —— 根因是**没有按模型路由供应商**。
 * 找不到归属时返回 null（调用方退回当前生效供应商，保持旧行为）。
 */
type MoXingGongYingXinXi = {
  presetId: string;
  baseURL: string;
  protocol: 'openai-compatible' | 'anthropic' | 'ollama';
  apiKey: string;
  biaoQian: string;
};
async function jieMoXingGongYingShang(modelId: string): Promise<MoXingGongYingXinXi | null> {
  try {
    const s = settingsStore?.load() as {
      providers?: Array<{ id?: string; biaoQian?: string; baseURL?: string; protocol?: string; models?: unknown[]; defaultModel?: string }>
    } | undefined;
    const lie = Array.isArray(s?.providers) ? s.providers : [];
    const ming = String(modelId || '').trim();
    if (!ming) return null;
    let hit = lie.find((p) => Array.isArray(p.models) && p.models.some((m) => String(typeof m === 'string' ? m : (m as { id?: string })?.id || '') === ming));
    if (!hit) hit = lie.find((p) => String(p.defaultModel || '') === ming);
    if (!hit) return null;
    const xieYi = (String(hit.protocol || '') as MoXingGongYingXinXi['protocol']);
    return {
      presetId: String(hit.id || providerCfg.presetId),
      baseURL: guiFanBaseURL(String(hit.baseURL || '')),
      protocol: xieYi === 'ollama' || xieYi === 'anthropic' ? xieYi : 'openai-compatible',
      apiKey: xieYi === 'ollama' ? '' : (await jiexiGongyingshangMiyao(String(hit.id || ''))),
      biaoQian: String(hit.biaoQian || hit.id || ''),
    };
  } catch { return null; }
}

/**
 * **决策模型**（RLCD 类：小而快、输出带置信度的判定）——
 * 紧急度还是默认 P2 时，先让决策模型判一下「急 / 一般 / 省着用」。
 * 判不动就保持 P2（宁可不判，也不瞎改用户意图）。
 * 真事故：设置里的「决策模型」链存了却**从未被调用**，是个空壳。
 */
async function fenLeiPanDing(content: string): Promise<string> {
  const txt = await wenTeShuMoXing('fenLei', [
    { role: 'system', content: '你是分类模型。只输出一个 JSON：{"urgency":"P1|P2|P3","intent":"question|task|chat|command","confidence":0-1}。urgency：P1=紧急/必须立刻准确完成，P2=一般，P3=简单闲聊或省着用。' },
    { role: 'user', content: String(content || '').slice(0, 500) },
  ], 64);
  if (txt === null) return 'P2';   // 没有可用分类模型 ⇒ 保持界面传进来的紧急度
  const mJ = txt.match(/"urgency"\s*:\s*"(P[123])"/i);
  const mC = txt.match(/"confidence"\s*:\s*([0-9.]+)/i);
  const xin = mC ? Number(mC[1]) : 1;
  if (mJ && xin >= 0.5) return String(mJ[1]).toUpperCase();
  return 'P2';
}

/**
 * **专业模型路由（无痛无感）** —— 产品要求：
 *   凡是"无需人类参与、由 AI 自动分类/判定/审核/翻译"的场景，**流程上**优先派给
 *   设置里对应的专业模型（分类 / 安全审核 / 翻译 / 重排 / 画图 / 看视频 / 做视频…）；
 *   没有配置、或那个模型挂了 ⇒ **静默回退**到该牛马自己的对话模型调用链，用户无感。
 *
 * 这是**路由**，不是提示词：调用点只声明"我要做哪类活"，由这里决定用谁。
 * 特殊模型链的键与设置页一致（`<key>Chain` / `<key>Disabled`）。
 */
type TeShuMoXingLei = 'fenLei' | 'safety' | 'translate' | 'rerank' | 'image' | 'imageUnd' | 'videoUnd' | 'videoGen' | 'asr' | 'tts';

/** 解析特殊模型链上第一个「已启用」的模型（不考虑可用性） */
function jieTeShuMoXingKey(lei: TeShuMoXingLei): string {
  try {
    const sm = (settingsStore?.load() as { specialModels?: Record<string, unknown> } | undefined)?.specialModels || {};
    const lian = Array.isArray(sm[lei + 'Chain']) ? (sm[lei + 'Chain'] as string[]) : [];
    const jin = Array.isArray(sm[lei + 'Disabled']) ? (sm[lei + 'Disabled'] as string[]) : [];
    return lian.find((m) => m && !jin.includes(m)) || '';
  } catch { return ''; }
}

/** 该专业模型是否真的可用（存在于某个供应商，且已配 Key 或是 Ollama） */
async function teShuMoXingKeYong(lei: TeShuMoXingLei): Promise<{ mo: string; an: MoXingGongYingXinXi } | null> {
  const mo = jieTeShuMoXingKey(lei);
  if (!mo) return null;
  const an = await jieMoXingGongYingShang(mo);
  if (!an) return null;
  if (!an.apiKey && an.protocol !== 'ollama') return null;
  return { mo, an };
}

/**
 * 让专业模型干一件活。**返回 null = 没有可用的专业模型（或它失败了）**，
 * 调用方据此回退到「该牛马的大模型调用链」—— 回退是**静默**的。
 */
async function wenTeShuMoXing(
  lei: TeShuMoXingLei,
  xiaoXiJi: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxTokens = 256,
): Promise<string | null> {
  try {
    const hit = await teShuMoXingKeYong(lei);
    if (!hit) {
      audit?.log('special-model.fallback', { lei, reason: 'not-configured-or-unusable' });
      return null;
    }
    const p = congYuSheChuangJian(hit.an.presetId, { apiKey: hit.an.apiKey, baseURL: hit.an.baseURL || undefined, protocol: hit.an.protocol } as never, hit.an.protocol);
    const r = await p.chat({ model: hit.mo, xiaoXiJi: xiaoXiJi as never, maxTokens });
    const txt = neiRongWenBen(r.choices[0]?.message?.content) || '';
    audit?.log('special-model.used', { lei, model: hit.mo, chars: txt.length });
    return txt;
  } catch (e) {
    audit?.log('special-model.failed', { lei, error: xiJingCuoWu(e).slice(0, 160) });
    return null;
  }
}

/** 安全审核：有安全模型就让它判，没有就**回退到调用方的大模型判断**（返回 null） */
async function anQuanShenHeWenBen(wenBen: string): Promise<{ safe: boolean; reason: string; by: string } | null> {
  const txt = await wenTeShuMoXing('safety', [
    { role: 'system', content: '你是内容安全审核模型。只输出 JSON：{"safe":true|false,"reason":"简短理由"}。明显违规才判 false。' },
    { role: 'user', content: String(wenBen || '').slice(0, 2000) },
  ], 96);
  if (txt === null) return null;
  const m = txt.match(/"safe"\s*:\s*(true|false)/i);
  const r = txt.match(/"reason"\s*:\s*"([^"]*)"/i);
  return { safe: m ? String(m[1]).toLowerCase() === 'true' : true, reason: r ? String(r[1]) : '', by: 'safety-model' };
}

/** 翻译：有翻译模型就让它翻，没有就返回 null（回退到大模型链） */
async function fanYiWenBen(wenBen: string, muBiao: string): Promise<string | null> {
  return wenTeShuMoXing('translate', [
    { role: 'system', content: `你是翻译模型。只输出译文，不要解释。目标语言：${muBiao || '中文'}。` },
    { role: 'user', content: String(wenBen || '').slice(0, 4000) },
  ], 1024);
}

/** 打包态资源根目录；开发态下 Electron 也会给值，兜底空串便于拼路径 */
const JIEGUO_GEN = process.resourcesPath || '';

/**
 * 解析记忆服务要用的 Node 运行时。
 * ADR 不变量 #4 要求「记忆服务一律 spawn 捆绑的独立 Node」，不能拿 Electron 当 Node：
 * 实测用 electron.exe 跑该子进程会立刻崩溃（crashpad not connected），
 * 而且那条路径还额外要求 ELECTRON_RUN_AS_NODE。
 * 顺序：捆绑 Node → 环境变量 → Electron 兜底。
 */
function jiexiJiedianYunxingShi(): { path: string; source: string } {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'node.exe' : 'node';
  // 仓库里的 Node 压缩包按 win-x64 / darwin-arm64 / linux-x64 命名，
  // 与 process.platform（win32）不同名，两种目录名都要认。
  const pingtaiMulu = [isWin ? 'win-' + process.arch : process.platform + '-' + process.arch,
                    process.platform + '-' + process.arch];
  const roots = [process.resourcesPath || '',
                 path.join(__dirname, '..', '..', '..', 'resources')];
  const candidates: Array<{ p: string; source: string }> = [];
  for (const r of roots) {
    for (const d of pingtaiMulu) {
      candidates.push({ p: path.join(r, 'node', d, exe), source: 'bundled:' + path.join('node', d) });
    }
    candidates.push({ p: path.join(r, 'node', exe), source: 'bundled:node/' + exe });
  }
  candidates.push({ p: process.env['WARMY_NODE'] || process.env['CCARM_NODE'] || '', source: process.env['WARMY_NODE'] ? 'env:WARMY_NODE' : (process.env['CCARM_NODE'] ? 'env:CCARM_NODE(legacy)' : 'env:WARMY_NODE') });
  for (const c of candidates) {
    if (c.p && fs.existsSync(c.p)) return { path: c.p, source: c.source };
  }
  return { path: process.execPath, source: 'electron-fallback(不推荐)' };
}

function zhunbeiJiyiCangYunxingShi(): { ipcEntry: string; CangLu: string } {
  const userData = app.getPath('userData');
  const CangLu = path.join(userData, 'memory');
  const yunxingShiMulu = path.join(userData, 'memory-runtime');
  const srcCandidates = [
    path.join(__dirname, '..', '..', 'memory-os', 'dist'),
    path.join(app.getAppPath(), 'node_modules', '@warmy', 'memory-os', 'dist'),
  ];
  const src = srcCandidates.find((d) => fs.existsSync(path.join(d, 'ipc.js')));
  if (!src) {
    qidong(`memory ipc source missing among ${srcCandidates.join(' | ')}`);
    throw new Error('memory-os dist not found');
  }
  fs.mkdirSync(yunxingShiMulu, { recursive: true });
  // 拷贝 dist 下全部 js（ipc + index + map 可选）
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.js') && !f.endsWith('.js.map')) continue;
    fs.copyFileSync(path.join(src, f), path.join(yunxingShiMulu, f));
  }
  // 复制 package.json 便于 Node 解析 type=module
  const srcPkg = path.join(src, '..', 'package.json');
  if (fs.existsSync(srcPkg)) {
    fs.copyFileSync(srcPkg, path.join(yunxingShiMulu, 'package.json'));
  }
  // 链接 better-sqlite3：开发态与打包态布局不同，而且旧链接可能是坏的，必须校验 + 可修复。
  // 历史教训：这里原本只做 `existsSync(nmSrc) && !existsSync(nmDst)`。
  //   - existsSync 对**空目录**也返回 true，包目录一度是空壳时就会链到空目录；
  //   - 链接一旦存在就不再重建，即使依赖后来补齐也修不回来；
  //   结果子进程报 `Cannot find module 'better-sqlite3'`，记忆服务永远启动超时（L2 实际从未起来）。
  const jiyiBaoMulu = path.dirname(src);
  const mingchengMubiao = path.join(yunxingShiMulu, 'node_modules');
  const yuanshengMing = process.platform + '-' + process.arch + '.node';
  /** 目录里是否有**可用**的 better-sqlite3（含本平台原生二进制） */
  const sqliteKeyong = (dir: string): boolean => {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
    try {
      // v13 用 prebuilds/<platform>-<arch>.node；旧版走 build/Release
      const ku = fs.readFileSync(path.join(dir, 'lib', 'binding.js'), 'utf8');
      if (ku.includes('prebuilds')) return fs.existsSync(path.join(dir, 'prebuilds', yuanshengMing));
    } catch {
      /* 读不到就退回通用判断 */
    }
    return (
      fs.existsSync(path.join(dir, 'prebuilds', yuanshengMing)) ||
      fs.existsSync(path.join(dir, 'build', 'Release', 'better_sqlite3.node'))
    );
  };
  const sqliteVer = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(yunxingShiMulu, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      return pkg.dependencies?.['better-sqlite3'] || '13.0.3';
    } catch {
      return '13.0.3';
    }
  })();
  const sqliteHouxuan = [
    path.join(jiyiBaoMulu, 'node_modules', 'better-sqlite3'),                                   // 开发态：包内 junction
    path.join(JIEGUO_GEN, 'pnpm-store', 'better-sqlite3@' + sqliteVer,
      'node_modules', 'better-sqlite3'),                                                      // 打包态
    path.join(JIEGUO_GEN, 'pnpm-store', 'better-sqlite3'),                    // 打包态（扁平）
  ].filter((p) => p && !p.startsWith(path.sep + 'pnpm-store'));

  const srcSqlite = sqliteHouxuan.find(sqliteKeyong);
  const mubiaoSqlite = path.join(mingchengMubiao, 'better-sqlite3');
  if (srcSqlite && !sqliteKeyong(mubiaoSqlite)) {
    // 只拆链接/空目录，绝不递归删除（junction 递归删会连带删掉目标内容）
    try {
      fs.unlinkSync(mingchengMubiao);
    } catch {
      try {
        fs.rmdirSync(mingchengMubiao);
      } catch {
        /* 目标不存在或非空目录，交给下面的 mkdir 报错 */
      }
    }
    fs.mkdirSync(mingchengMubiao, { recursive: true });
    try {
      fs.unlinkSync(mubiaoSqlite);
    } catch {
      /* 不存在就算了 */
    }
    try {
      fs.symlinkSync(srcSqlite, mubiaoSqlite, 'junction');
      qidong('memory sqlite linked: ' + srcSqlite);
    } catch {
      try {
        fs.cpSync(srcSqlite, mubiaoSqlite, { recursive: true });
        qidong('memory sqlite copied: ' + srcSqlite);
      } catch (e) {
        qidong('memory sqlite link failed ' + String(e));
      }
    }
  } else if (!srcSqlite) {
    qidong('memory sqlite not found in ' + sqliteHouxuan.join(' | '));
  }
  return { ipcEntry: path.join(yunxingShiMulu, 'ipc.js'), CangLu };
}

async function yindao() {
  p1 = await chuangJianP1YunXingShi({
    instancesRoot: path.join(app.getPath('userData'), 'instances'),
    /**
     * **必须用捆绑的 Node**，不能拿 Electron 当 Node：
     * 兜底成 `process.execPath`（electron.exe）时，每个牛马实例都会以「第二个 Electron 应用」
     * 的姿态启动 —— 拉 GPU/网络进程、抢单实例锁、窗口一闪就退（用户看到的"闪退"）。
     */
    nodePath: jiexiJiedianYunxingShi().path,
    onApprove: async (Qiu) => {
      // 安全模式 full 时自动放行；normal/strict 向渲染进程请求审批
      const mode = p1?.security.getMode();
      if (mode === 'full') return { action: Qiu.action, scope: 'once', allowed: true };
      const id = 'ap' + ++pizhunXulie;
      return new Promise((resolve) => {
        dengdaiPizhun.set(id, { resolve: resolve as never });
        win?.webContents.send('warmy:piZhunQingQiu', { id, action: Qiu.action, suggested: Qiu.suggested });
        setTimeout(() => {
          const p = dengdaiPizhun.get(id);
          if (p) {
            dengdaiPizhun.delete(id);
            (p.resolve as (d: unknown) => void)({ allowed: false, scope: 'deny' });
          }
        }, 30000);
      });
    },
  });
  qidong('p1 ready');
  const userData = app.getPath('userData');
  board = new KanbanCang(path.join(userData, 'board'));
  knowledge = new KnowledgeBase(path.join(userData, 'knowledge'));
  checkpoints = new JianChaDianCang(path.join(userData, 'checkpoints'));
  accountStore = new BenDiZhangHuCang(path.join(userData, 'profile.json'));
  settingsStore = new PeizhiCang(path.join(userData, 'settings.json'));
  secureKeys = new AnQuanMiyaoCang(userData);
  huiFuHuoYueGongYingShang();
  /**
   * **拉取时存下的模型能力**（尤其 `contextLen`）先填回来：
   * 上下文预算滑块一打开就有**真实上下文**，不必等用户重新拉取模型（真机反馈）。
   */
  try {
    const caps = (settingsStore?.load() as { modelCaps?: Record<string, { contextLen?: number; kind?: string }> } | undefined)?.modelCaps || {};
    for (const [id0, c0] of Object.entries(caps)) {
      const jiu = (modelNengLiMeta.get(id0) || {}) as Record<string, unknown>;
      modelNengLiMeta.set(id0, {
        ...(jiu as object),
        contextLen: Number(c0 && c0.contextLen) || 0,
        kind: String((c0 && c0.kind) || jiu.kind || ''),
        source: 'saved',
      } as never);
    }
  } catch { /* 读不到就等下次拉取 */ }
  groupStore = new QunCang(path.join(userData, 'groups.json'));
  /**
   * ADR 004 第十六批：把 helper-tool 的文件访问记录接到**项目台账**上。
   * 产品主的原话：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
   *  ⇒ 记进**项目记录**（`groups.json` 里的项目台账），随项目同步给成员；
   *  没有作用域（不属于任何一个项目）时**什么都不记** —— 绝不退化成"本机设置里的一份日志"。
   */
  setFileAccessSink((sessionId, entry) => {
    try {
      const qunId = String(sessionId || '');
      if (!qunId || !groupStore) return;
      const r = groupStore.recordFileAccess(qunId, entry);
      if (r.ok) void faBuXiangMuShuXing(qunId);
    } catch {
      /* 记账失败不影响真实文件操作 */
    }
  });
  updater = new Gengxinqi({
    currentVersion: yingyongBanben(),
    downloadDir: path.join(userData, 'updates'),
    getSettings: () => settingsStore?.load() ?? null,
    env: process.env,
    userAgent: `WArmy/${yingyongBanben()} (${process.platform}; ${process.arch})`,
    log: (xiaoXi) => qidong(`updater: ${xiaoXi}`),
  });
  qingLiLinShiWenJian(path.join(userData, 'updates'));
  huiFuQunLieBiao();
  // 群骨架恢复之后再灌队列快照（否则 createGroup 会把 queues Map 清空）
  huiFuLuYouQiDuiLie();
  qidong(`router queues restored file=${routerQueuesFile() || 'n/a'}`);
  // 计划进度也落盘（崩了/重启后才能检测到"还有正在跑的任务"并让用户续上）
  try {
    const jiHuaShu = huiFuJiHua();
    qidong(`plans restored: ${jiHuaShu} sessions`);
    if (jiHuaShu > 0) {
      audit?.log('plan.restored', { sessions: jiHuaShu });
      // 让界面在第二列亮起「?」并给出「继续/重试」按钮
      try { broadcastToWindows('warmy:jiHuaHuiFu', { sessions: [...jiHuaRenWuJi.keys()] }); } catch { /* noop */ }
    }
  } catch (e) { qidong(`plans restore fail ${String(e)}`); }
  nodeReg = new JieDianMingCe(path.join(userData, 'nodes.json'));
  syncBus = new TongbuZongxian(path.join(userData, 'bus'));
  peerReg = new DuiDuanMingCe(path.join(userData, 'peers.json'));
  if (!nodeReg.LieBiao().some((n) => n.isLocal)) {
    nodeReg.registerLocal('local');
  }
  localNodeId = nodeReg.LieBiao().find((n) => n.isLocal)?.nodeId || 'node-local';
  chuShiZiChanGuanLi(path.join(userData, 'assets.json'));
  audit = new ShenJiRiZhi(userData);
  secureKeys = new AnQuanMiyaoCang(userData);
  archiver = new ZhiShiGuiDangQi(userData);
  cleanup = new QingLiGuanLiQi(userData);
  // ── 身份层：首次运行即生成（ADR 003 附三 C6「首次运行即生成唯一 ID 与凭证」）──
  // 私钥用 safeStorage 包裹的 DEK 加密后落盘；启用口令后连同一台机器也不够（附五.1 第一层）。
  identityStore = new ShenFenCang(path.join(userData, 'identity', 'identity.json'), {
    onAudit: (op, detail) => audit?.log(op, detail),
  });
  try {
    const profile = accountStore.loadProfile();
    /**
     * 凭证即私钥：身份由 profile 里的凭证派生（老身份文件已存在则原样加载）。
     *
     * **历史 ID 升级**：`loadProfile()` 会把 9 位 / 17 位数字、UUID 这类**不是密钥种子**的
     * 老 ID 换成真凭证（并记下 `deviceIdUpgradedFrom`）。既然身份必须由凭证派生，
     * 这里就要把身份**按新凭证重建**（旧身份文件先备份，绝不静默丢弃），
     * 否则会出现"ID 与身份不是同一把密钥"——那等于产品承诺的"ID 即私钥"不成立。
     */
    const qidongPingzheng = profile.deviceId || shengChengPingzheng();
    const upgradedFrom = String(profile.deviceIdUpgradedFrom || '');
    const idInit = identityStore.ensureIdentity(qidongPingzheng, {
      email: profile.email || '',
    }, { credential: qidongPingzheng });
    if (idInit.ok && upgradedFrom) {
      try {
        const rebuilt = identityStore.restoreFromCredential(qidongPingzheng, profile.username || undefined);
        if (rebuilt.ok) {
          /**
           * 升级**只做一次**：清掉标记并落盘，否则每次启动都会重建身份 + 多一个备份文件。
           */
          try {
            const { deviceIdUpgradedFrom: _done, ...qiYu } = profile;
            accountStore.saveProfile(qiYu as never);
          } catch { /* 清标记失败不致命：最多下次再重建一次（身份内容相同、不会漂移） */ }
          audit?.log('identity.credential.upgraded', { from: 'legacy-numeric-or-uuid', to: 'credential-51', zhiWen: rebuilt.info.zhiWen, backup: rebuilt.backupFile || '' });
          qidong(`identity upgraded to credential-51 fp=${rebuilt.info.zhiWen} backup=${rebuilt.backupFile || 'none'}`);
        } else {
          qidong(`identity upgrade failed（保留原身份）: ${rebuilt.error}`);
        }
      } catch (e) {
        qidong(`identity upgrade threw: ${xiJingCuoWu(e)}`);
      }
    }
    if (idInit.ok) {
      qidong(
        `identity ${idInit.created ? 'created' : 'loaded'} fp=${idInit.info.zhiWen} gen=${idInit.info.generation} alias=${idInit.info.bieMing} protection=${idInit.info.passphraseProtected ? 'passphrase' : idInit.info.osProtected ? idInit.info.osLabel : 'none'}`
      );
    } else {
      // 绝不静默重建：文件损坏时保留证据（已隔离为 .corrupt-*），由用户走"导入备份"恢复
      qidong(`identity init fail: ${idInit.error}`);
      lastError = { ts: Date.now(), message: `身份初始化失败：${idInit.error}`, context: 'identity' };
    }
  } catch (e) {
    qidong(`identity init fail ${String(e)}`);
  }
  // 启动时结算一次对端冻结期：到期则把"待采用的新名片"提升为本机留存值（纯本地判定，无定时器）
  try {
    const yiJieSuan = identityStore.settlePeerContacts();
    qidong(`identity peer-contacts settled promoted=${yiJieSuan.promoted}/${yiJieSuan.total}`);
  } catch (e) {
    qidong(`identity peer settle fail ${String(e)}`);
  }
  audit.log('app.start', { platform: process.platform });
  // ── 成员证书 / 吊销列表（ADR §附八.8）：先"热身"建好带审计回调的实例 ──
  // ⚠️ 顺序有讲究：`membershipStoreFor` 按 IdentityStore 实例缓存，第一次调用决定它有没有审计回调；
  // 这里先建，后续所有调用点（名册/在线态/IPC）都拿到同一个带审计的实例，
  // 证书签发/拒收、吊销应用/拒绝都会落到审计日志（audit 已在上面初始化）。
  {
    const ms = quChengYuanMingceCang(identityStore, { onAudit: (op, detail) => audit?.log(op, detail) });
    const heJi = ms?.summary();
    if (heJi) qidong(`membership ready groups=${heJi.groupCount} certs=${heJi.certCount} revoked=${heJi.revokedCount}`);
  }
  // ── 租约表（本体协作层）：写操作的唯一仲裁者 ──
  leases = new LeaseRegistry({ idPrefix: 'warmy' });
  // ── 换证横幅的确认留痕（「已核实 / 已关闭」）；审计写不进去时拒绝关闭，见 IPC ──
  biangengQuerenWenjian = path.join(userData, 'identity', 'change-acks.json');
  // ── 组网（鉴权通道）：**门控在前**，身份拿不到签名能力就不起监听、不发宣告 ──
  const netDir = baoZhangWangLuoMuLu(userData);
  if (!netDir.ok) qidong(`net dir unavailable: ${netDir.error}`);
  try {
    // 启动自检：身份层指纹必须能由身份文件里的公钥推出；不一致则整条组网线不可用
    const check = duanyanTuidaoPipei(identityStore);
    qidong(`identity derivation ok fp=${check.zhiWen} raw=${check.publicKeyRawBytes}`);
  } catch (e) {
    const err = e as ShenFenBuKeYongCuoWu;
    qidong(`identity derivation FAILED: ${err.name}: ${err.message}`);
    lastError = { ts: Date.now(), message: err.message, context: 'identity-derivation' };
  }
  secureMesh = new SecureMesh({
    userDataDir: userData,
    nodeId: localNodeId,
    store: () => identityStore,
    peers: () => duiduanYinyong(),
    onInbound: (xiaoXi) => {
      qidong(`mesh inbound ${xiaoXi.channel} from ${xiaoXi.peerFingerprint.slice(0, 12)}`);
      // 成员证书 / 吊销列表的**同步落点**：对端指纹来自握手（xiaoXi.peerFingerprint），
      // 不是消息体自称 —— 只有本群创建者发来的吊销列表才会被接受。
      const payload = xiaoXi.payload as { type?: string; groupId?: string; LieBiao?: unknown } | null;
      /**
       * ADR 004 第十六批：**项目属性 / 可用性信号的落点**（成员侧）。
       * 「记录文件的改动是产品功能」这条要求的另一半就在这：异地成员收到的项目属性
       * 写进本地项目记录 ⇒ 成员的 UI 能看到"这是容器项目 + 创建者那边为什么不可用"，
       * 并**复用既有「创建者离线」那一套**（不新造第三种状态）。
       * 纪律：只接受**校验通过**的消息（不认识就如实拒绝），且**只补创建者指纹、绝不覆盖**。
       */
      if (xiaoXi.channel === XIANGMU_SHUXING_TONGDAO && (xiaoXi.payload as { kind?: unknown } | null)?.kind === XIANGMU_SHUXING_LEIXING) {
        const parsed = parseProjectAttrsMessage(xiaoXi.payload);
        if (!parsed.ok) {
          audit?.log('project.attrs.inbound', { ok: false, code: parsed.error });
          qidong(`project attrs inbound rejected: ${parsed.error}`);
        } else {
          const v = parsed.value;
          // 指纹用**握手**得到的那个（消息体自称的不采信），只在本地还不知道创建者时补上
          const apply = groupStore?.applyProjectSync(v.groupId, {
            ...(v.ming ? { ming: v.ming } : {}),
            ...(v.type ? { type: v.type } : {}),
            project: {
              devEnv: v.project.devEnv,
              runtimeId: v.project.runtimeId,
              disabledAt: v.project.disabledAt,
              ...(v.project.directory ? { directory: v.project.directory } : {}),
              ...(v.project.directorySource ? { directorySource: v.project.directorySource } : {}),
              ...(v.project.env ? { env: v.project.env } : {}),
            },
            creatorFingerprint: xiaoXi.peerFingerprint,
          });
          // 台账尾部：**项目级、成员可见**（去重由 store 负责；只记路径/操作/时间）
          let zhangbenYitianjia = 0;
          if (apply && apply.ok && Array.isArray(v.ledgerTail) && groupStore) {
            for (const e2 of v.ledgerTail) {
              if (!e2.path || !e2.op) continue;
              const r = groupStore.recordFileAccess(v.groupId, {
                op: (['read', 'write', 'edit', 'create', 'delete', 'backup', 'restore'].includes(e2.op) ? e2.op : 'write') as never,
                path: e2.path, ts: e2.ts || Date.now(), ok: e2.ok !== false, by: e2.by || 'remote',
                ...(e2.bytes ? { bytes: e2.bytes } : {}),
              });
              if (r.ok) zhangbenYitianjia++;
            }
          }
          /**
           * 成员侧入站门控：项目不可用 ⇒ 挂到**创建者离线**那一档（同一句既有文案）。
           * 这里只把结论记进审计/事件流；真正的"拒绝入站"由群消息处理路径用它判定。
           */
          if (!projectAttrsAreRemote(v.groupId)) {
            // 本机就是创建者：自己的信号回声，忽略（不要用对端的值覆盖本机事实）
            audit?.log('project.attrs.inbound', { groupId: v.groupId, ok: true, echo: true, zhangbenYitianjia });
          } else {
            const menjin = xiangmuRuXiangMenjin({
              running: v.availability.availability === 'available' && v.project.disabledAt === 0,
              code: v.project.disabledAt > 0 ? 'disabled-by-owner' : (v.availability.code || 'container-not-ready'),
            });
            audit?.log('project.attrs.inbound', { groupId: v.groupId, ok: true, queue: menjin.queue, zhangbenYitianjia });
            if (!menjin.allow) {
              fachuKongzhitai({ cat: 'net', code: 'project.inbound.queued', data: { groupId: v.groupId, projectCode: menjin.projectCode, memberFaceKey: menjin.memberFaceKey } });
            }
            qidong(`project attrs inbound ${v.groupId} allow=${menjin.allow} code=${menjin.projectCode} ledger+${zhangbenYitianjia}`);
          }
          fachuKongzhitai({ cat: 'system', code: 'project.attrs.applied', data: { groupId: v.groupId, devEnv: v.project.devEnv } });
        }
      }
      if (payload && payload.type === 'warmy.membership.revocation') {
        const qunId = String(payload.groupId || xiaoXi.groupId || '');
        const membership = quChengYuanMingceCang(identityStore);
        const yuQi = expectedIssuerFor(qunId);
        const r = yingYongRuXiangCheXiaoGengXin({
          membership: membership as ChengYuanMingceCang,
          groupId: qunId,
          LieBiao: payload.LieBiao as never,
          fromFingerprint: xiaoXi.peerFingerprint,
          ...(yuQi ? { expectedIssuerFingerprint: yuQi } : {}),
        });
        audit?.log('membership.revocation.inbound', { groupId: qunId, ok: r.ok, code: r.code, changed: r.changed ?? false });
        qidong(`membership revocation inbound ok=${r.ok} code=${r.code}`);
      }
    },
    onEvent: (Shi) => {
      if (Shi.type === 'handshake-ok' || Shi.type === 'offline') qidong(`mesh ${Shi.type} ${Shi.peer ?? ''}`);
      // T194：对端会话上下线 / 握手 / 局域网发现 —— 组网层的**真实**事件，直接进控制台。
      // 这里**只**推手指纹（peer）与方向/原因（detail），不推消息正文。
      switch (Shi.type) {
        case 'session':
          fachuKongzhitai({ cat: 'net', code: 'net.peer-up', data: { peer: Shi.peer, detail: Shi.detail } });
          break;
        case 'online':
          fachuKongzhitai({ cat: 'net', code: 'net.peer-online', data: { peer: Shi.peer } });
          break;
        case 'offline':
          fachuKongzhitai({ cat: 'net', code: 'net.peer-down', data: { peer: Shi.peer, detail: Shi.detail } });
          break;
        case 'handshake-ok':
          fachuKongzhitai({ cat: 'net', code: 'net.handshake-ok', data: { peer: Shi.peer } });
          break;
        case 'discovered':
          fachuKongzhitai({ cat: 'net', code: 'net.discovered', data: { peer: Shi.peer, detail: Shi.detail } });
          break;
        default:
          fachuKongzhitai({ cat: 'net', code: 'net.event', data: { type: String(Shi.type || ''), detail: Shi.detail } });
          break;
      }
    },
  });
  {
    const menjin = yaoQiuKeQianMingShenFen(identityStore);
    qidong(`net gate signReady=${menjin.ok} mode=${menjin.unlock?.mode ?? 'none'} error=${menjin.errorCode ?? '-'}`);
  }
  qidong('board/knowledge/checkpoints/account/sync/mesh/assets ready');
}

// ── 群路由 / 群成员：持久化与重启恢复 ──

/** 本机实例入群（路由 + 持久化成员表），已入群则跳过 */
function joinLocalInstances(groupId: string): void {
  for (const inst of p1?.instances.LieBiao() || []) {
    if (router.listMembers(groupId).some((m) => m.id === inst.id)) continue;
    try {
      router.join(groupId, {
        id: inst.id,
        ming: inst.ming,
        local: true,
        dutyEligible: inst.dutyEligible,
        status: inst.status === 'running' ? 'idle' : 'offline',
      });
    } catch {
      continue;
    }
    groupStore?.addMemberWithFingerprint(
      groupId,
      { ming: inst.ming, role: 'member', source: 'instance', instanceId: inst.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
  }
}

/** 把路由里已有但成员表没有的成员补进持久化（幂等） */
function syncMembersFromRouter(groupId: string): void {
  if (!groupStore) return;
  const g = router.getGroup(groupId);
  if (!g) return;
  for (const m of router.listMembers(groupId)) {
    groupStore.addMemberWithFingerprint(
      groupId,
      { ming: m.ming, role: 'member', source: 'instance', instanceId: m.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
  }
}

/**
 * 重启后恢复：把持久化的群灌回路由（否则重启后群聊收不到消息），
 * 并从旧版会话状态（settings.json 的 state.groups）回填一次。
 */
function huiFuQunLieBiao(): void {
  if (!groupStore) return;
  try {
    const s = settingsStore?.load() as unknown as { groups?: unknown } | undefined;
    const uiGroups = Array.isArray(s?.groups) ? (s?.groups as Array<{ id?: unknown; ming?: unknown; type?: unknown }>) : [];
    const yiQianYi = groupStore.migrateFrom(uiGroups);
    if (yiQianYi) qidong(`groups migrated from ui state: migrated`);
    for (const g of groupStore.listGroups()) {
      if (!router.getGroup(g.groupId)) {
        try {
          router.createGroup({
            groupId: g.groupId,
            ming: g.ming,
            type: g.type,
            dutyInstanceId: g.dutyInstanceId,
            directedMode: g.directedMode,
            members: [],
            permissions: DEFAULT_PERMISSIONS as never,
            checkpointLimit: 50,
          });
        } catch {
          continue;
        }
      }
      joinLocalInstances(g.groupId);
    }
    qidong(`groups restored: ${groupStore.listGroups().length}`);
  } catch {
    qidong('groups restore failed');
  }
}

function qishiJiyiCangYibu() {
  try {
    const { ipcEntry, CangLu } = zhunbeiJiyiCangYunxingShi();
    qidong(`memory ipc=ipcEntry`);
    const nodeRt = jiexiJiedianYunxingShi();
    qidong(`memory node=${nodeRt.path} (${nodeRt.source})`);
    memory = new JiyiCangKeHu({ nodePath: nodeRt.path, ipcEntry, CangLu, log: qidong });
    memory
      .start()
      .then(() => {
        qidong('memory ready');
        // 不变量 #5：记忆服务的 JSONL 是唯一事实来源 → 启动即重建会话日志（ADR 002 §9.4 待办 4）
        return youJiYiHuiFuHuiHuaRiZhi('boot');
      })
      .catch((e) => {
        qidong(`memory start fail ${String(e)}`);
        // 降级路径的可观测信号：记忆服务没起来，重建被跳过（对话仍可发送）
        historyRestore = {
          done: true,
          ok: false,
          entries: 0,
          sessions: 0,
          maxSeq: 0,
          reason: 'memory-start-failed',
          trigger: 'boot',
          at: Date.now(),
        };
      });
  } catch (e) {
    qidong(`memory prepare fail ${String(e)}`);
    historyRestore = {
      done: true,
      ok: false,
      entries: 0,
      sessions: 0,
      maxSeq: 0,
      reason: 'memory-prepare-failed',
      trigger: 'boot',
      at: Date.now(),
    };
  }
}

let qiangzhiTuichu = false;
/** 托盘实例：全应用只允许一个；退出时必须 destroy，否则通知区残留 */
let tray: import('electron').Tray | null = null;

/**
 * 禁止多开后的行为：重复启动不新建实例，只把**已运行**主窗口
 * 恢复 → 移到屏幕中央 → 获得焦点。
 */
function zhuJiaoZhuChuangKouJuZhong(): void {
  try {
    if (!win || win.isDestroyed()) {
      chuangjianChuangkou();
      return;
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // 居中到窗口当前所在显示器的工作区（无窗口时用主显示器）
    try {
      const b0 = win.getBounds();
      const display = screen.getDisplayMatching(b0) || screen.getPrimaryDisplay();
      const wa = display.workArea;
      const w = b0.width || wa.width;
      const h = b0.height || wa.height;
      win.setBounds({
        x: Math.round(wa.x + (wa.width - w) / 2),
        y: Math.round(wa.y + (wa.height - h) / 2),
        width: w,
        height: h,
      });
    } catch { /* 居中失败不影响聚焦 */ }
    win.focus();
    try { win.moveTop(); } catch { /* noop */ }
  } catch {
    try { chuangjianChuangkou(); } catch { /* noop */ }
  }
}

/**
 * 真正退出：托盘「下班」/ 隐私撤销 / IPC app-quit 统一走这里。
 *
 * 根因修复：窗口 close 在 !forceQuit 时 preventDefault 并 hide（点叉=最小化到托盘）。
 * 若只调 app.quit() 而不置 forceQuit，close 会被拦掉，进程和托盘都还在 ——
 * 表现为「右键下班点了关不掉」。
 */
function tuichuYingyong(reason?: string): void {
  qiangzhiTuichu = true;
  try { audit?.log('app.quit', { reason: String(reason || 'quit') }); } catch { /* noop */ }
  try { tray?.destroy(); } catch { /* noop */ }
  tray = null;
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.destroy();
      } catch { /* noop */ }
    }
  } catch { /* noop */ }
  try { app.quit(); } catch { /* noop */ }
  // 兜底：若仍有钩子拖住进程，强制退出（托盘/子进程清理已在 before-quit 尽力执行）
  setTimeout(() => {
    try { app.exit(0); } catch { try { process.exit(0); } catch { /* noop */ } }
  }, 1500);
}

function chuangkouZhuangtaiWenjian(): string {
  try { return path.join(app.getPath('userData'), 'window-state.json'); } catch { return ''; }
}
function jiaZaiChuangKouZhuangTai(): { width?: number; height?: number; x?: number; y?: number; maximized?: boolean } {
  const f = chuangkouZhuangtaiWenjian();
  if (!f) return {};
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    const out: { width?: number; height?: number; x?: number; y?: number; maximized?: boolean } = {};
    if (Number(j.width) >= 960) out.width = Math.round(Number(j.width));
    if (Number(j.height) >= 600) out.height = Math.round(Number(j.height));
    // 位置：只接受落在可见屏幕内的 x/y，避免显示器变更后窗口跑到屏幕外
    if (Number.isFinite(Number(j.x)) && Number.isFinite(Number(j.y))) {
      try {
        const { screen } = require('electron');
        const b = { x: Number(j.x), y: Number(j.y), width: out.width || 1280, height: out.height || 800 };
        const quyu = screen.getDisplayMatching(b).workArea;
        const kejian = b.x < quyu.x + quyu.width - 40 && b.y < quyu.y + quyu.height - 40 && b.x + 80 > quyu.x && b.y + 40 > quyu.y;
        if (kejian) { out.x = Math.round(Number(j.x)); out.y = Math.round(Number(j.y)); }
      } catch { /* 无 screen 时忽略位置 */ }
    }
    if (j.maximized === true) out.maximized = true;
    return out;
  } catch { return {}; }
}
let windowSaveTimer: NodeJS.Timeout | null = null;
function baocunChuangkouZhuangtaiJiukuai(yanchi = 500): void {
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => {
    windowSaveTimer = null;
    const f = chuangkouZhuangtaiWenjian();
    if (!f || !win || win.isDestroyed()) return;
    try {
      const maximized = win.isMaximized();
      const b = maximized ? (win as unknown as { getNormalBounds?: () => { x: number; y: number; width: number; height: number } }).getNormalBounds?.() || win.getBounds() : win.getBounds();
      const out = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
      anQuanYuanZiXieJson(f, out);
    } catch { /* 忽略 */ }
  }, yanchi);
}

function chuangjianChuangkou() {
  const isMac = process.platform === 'darwin';
  const ws = jiaZaiChuangKouZhuangTai();
  // 任务栏图标：**白底版**（深色任务栏上棕色标记才看得清）
  const tuBiaoLuJing = warmyTaskbarIcon();
  win = new BrowserWindow({
    width: ws.width || 1280,
    height: ws.height || 800,
    ...(Number.isFinite(ws.x as number) && Number.isFinite(ws.y as number) ? { x: ws.x, y: ws.y } : {}),
    minWidth: 960,
    minHeight: 600,
    title: '无限牛马',
    // macOS：系统原生标题栏与红绿灯；Windows/Linux：无边框 + **渲染层 #biaoTiLan 可拖动**
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 10 } : undefined,
    backgroundColor: '#ededed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      // 提示音（决策卡"叮"一声）不受用户手势限制：见 app.setName 附近的说明
      autoplayPolicy: 'no-user-gesture-required',
    },
    icon: tuBiaoLuJing,
  });
  try { win.setIcon?.(nativeImage.createFromPath(tuBiaoLuJing)); } catch { /* noop */ }
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('ready-to-show', () => {
    if (ws.maximized) { try { win?.maximize(); } catch { /* noop */ } }
    win?.show();
    qidong(`window ready platform=${process.platform}`);
  // 定时任务到点检查（登记后由宿主替用户发一轮）
  try { qiDongDingShiJianCha(); } catch { /* noop */ }
  });
  win.on('resize', () => baocunChuangkouZhuangtaiJiukuai());
  win.on('move', () => baocunChuangkouZhuangtaiJiukuai());
  win.on('maximize', () => baocunChuangkouZhuangtaiJiukuai(200));
  win.on('unmaximize', () => baocunChuangkouZhuangtaiJiukuai(200));
  // 点击叉 = 最小化到托盘，不关闭窗口。只有托盘「下班」才真正退出。
  win.on('close', (e) => {
    try { baocunChuangkouZhuangtaiJiukuai(0); } catch { /* noop */ }
    if (!qiangzhiTuichu) {
      e.preventDefault();
      win?.hide();
    }
  });
}

// ── 安全 IPC 辅助函数 ──
function anQuanChuLi<T>(fn: () => T, huiTui: T): T {
  try { return fn(); } catch (e) { return huiTui; }
}
async function anQuanChuLiYiBu<T>(fn: () => Promise<T>, huiTui: T): Promise<T> {
  try { return await fn(); } catch (e) { return huiTui; }
}
/**
 * 统一 IPC 收口：所有 `warmy:*` 通道自动获得
 *   1) try/catch —— 任何未捕获异常都不会变成渲染进程的未处理 rejection；
 *   2) 错误脱敏 —— 完整错误只写主进程日志，回传给渲染进程的 message 里
 *      不含绝对路径 / 堆栈 / 凭据片段；
 *   3) 重复通道保护 —— 重复注册只记日志并跳过，而不是让 Electron 抛异常把主进程带崩。
 */
const ipcZhuce = new Set<string>();
function xiJingCuoWu(e: unknown): string {
  const raw = e instanceof Error ? (e.message || e.name) : String(e);
  // noUncheckedIndexedAccess：split(..)[0] 的类型是 string | undefined，必须兜一下
  const shouHang = String(raw ?? '').split('\n')[0] ?? '';
  const yiQingLi = shouHang
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')                        // Windows 绝对路径
    .replace(/\/(?:Users|home|var|tmp|opt|mnt)\/[^\s"'<>|]*/g, '<path>')  // POSIX 绝对路径
    .slice(0, 200);
  return yiQingLi || 'unknown error';
}
/**
 * IPC 注册 + **兼容层**：改名后旧英文频道（如 warmy:group-create）仍可用。
 * 别名表：src/ipc-aliases.json（English -> 当前拼音频道），构建时拷到 dist。
 */
const IPC_ALIASES: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'ipc-aliases.json'), 'utf8'));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc-aliases.json'), 'utf8'));
    } catch { return {}; }
  }
})();
function chuliIpc(channel: string, fn: (event: import('electron').IpcMainInvokeEvent, ...args: any[]) => any): void {
  /** 只接受本应用窗口（file:// 本地页）调用；**fail-closed**：拿不到来源一律拒绝 */
  const yunXuLaiYuan = (event: import('electron').IpcMainInvokeEvent): boolean => {
    try {
      const frame = event.senderFrame;
      if (!frame) return false; // 无 frame = 异常调用方，拒绝
      const u = String(frame.url || '');
      if (!u) return false;
      if (u.startsWith('file:')) return true;
      // DevTools 前端页默认不给 IPC（避免任意 devtools 页面打全量通道）。
      // 页面内 CDP Runtime.evaluate 的 senderFrame 仍是 page 的 file://，不受影响。
      if (u.startsWith('devtools://') && process.env.WARMY_ALLOW_DEVTOOLS_IPC === '1') return true;
      return false;
    } catch { return false; }
  };
  const guaGou = async (event: import('electron').IpcMainInvokeEvent, ...args: any[]) => {
    if (!yunXuLaiYuan(event)) {
      const err = new Error('ipc: forbidden sender');
      console.error('[ipc] ' + channel + ' rejected non-file sender');
      throw err;
    }
    try {
      return await fn(event, ...args);
    } catch (e) {
      console.error('[ipc] ' + channel + ' failed:', e);
      fachuKongzhitai({ cat: 'error', code: 'err.ipc', data: { channel, message: xiJingCuoWu(e) } });
      throw new Error(xiJingCuoWu(e));
    }
  };
  try { ipcMain.handle(channel, guaGou); } catch { /* already registered */ }
  for (const [yingWen, pinYin] of Object.entries(IPC_ALIASES)) {
    if (pinYin === channel && yingWen !== channel) {
      try { ipcMain.handle(yingWen, guaGou); } catch { /* already */ }
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   T194：控制台事件流（主进程 → 渲染层，**推送**不是轮询）
   ---------------------------------------------------------------------------
   推什么：工具调用开始/结束、组网事件（开/关/端口绑定失败/对端会话上下线/发现）、
          错误（未捕获 + 已处理失败）。
   推什么形状：{ seq, ts, cat, code, data }。**文案不在这里拼** —— i18n 全在渲染层，
   主进程只给结构化事实（工具名/端口/错误码/毫秒数），渲染层按 code 取文案。
   安全：推送内容一律只含"事件元数据"（工具名、端口、errno、频道名、脱敏后的错误首行），
         **不带** API Key / token / 消息正文 / 文件路径；渲染层还会再打一遍码（双保险）。
   seq 单调递增：渲染层据此去重（窗口重建/重复投递不会刷屏）。
   ══════════════════════════════════════════════════════════════════════════ */
let kongzhitaiXulie = 0;
function fachuKongzhitai(Shi: { cat: 'tool' | 'net' | 'error' | 'system'; code: string; data?: Record<string, unknown> }): void {
  try {
    const payload = { seq: ++kongzhitaiXulie, ts: Date.now(), cat: Shi.cat, code: Shi.code, data: Shi.data || {} };
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send('warmy:kongZhiTaiShiJian', payload);
      } catch {
        /* 窗口正在销毁：控制台丢一行不影响主流程 */
      }
    }
  } catch {
    /* 控制台推送绝不冒泡到调用方 */
  }
}

/** 未捕获异常 / 未处理的 Promise 拒绝：如实进控制台。用 Monitor 版本，**不**改变默认崩溃语义。 */
process.on('uncaughtExceptionMonitor', (err) => {
  try {
    fachuKongzhitai({ cat: 'error', code: 'err.uncaught', data: { message: xiJingCuoWu(err) } });
  } catch {
    /* noop */
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    fachuKongzhitai({ cat: 'error', code: 'err.unhandled-rejection', data: { message: xiJingCuoWu(reason) } });
  } catch {
    /* noop */
  }
});
/**
 * **真正的**未捕获异常兜底（产品要求：一轮聊天不许把主进程打崩）。
 *
 * 为什么必须用 `uncaughtException` 而不是 `uncaughtExceptionMonitor`：
 * Monitor 只是"看一眼"，默认语义仍是**打印并退出进程** —— 用户看到的就是
 * 「A JavaScript error occurred in the main process」，之后所有 IPC 全部失效。
 * 这里接住、如实报给界面（走既有「错误 + 重试」提示），并让进程继续活着。
 * 注意：这**不**是掩盖问题 —— 错误原文会进控制台与 lastError，便于定位真正的缺陷。
 */
process.on('uncaughtException', (err) => {
  try {
    fachuKongzhitai({ cat: 'error', code: 'err.uncaught', data: { message: xiJingCuoWu(err) } });
  } catch { /* noop */ }
  try {
    lastError = { ts: Date.now(), message: xiJingCuoWu(err).slice(0, 800), context: 'main-uncaught' };
  } catch { /* noop */ }
});


// 应用身份：影响任务栏悬停/右键菜单里显示的名称（默认会显示 Electron）
app.setName('无限牛马');
if (process.platform === 'win32') app.setAppUserModelId('com.pondsi.warmy');

/**
 * **提示音不许被自动播放策略拦掉**（真事故：首次出现的决策卡没声音）。
 *
 * Chromium 的自动播放策略会让"没有用户手势"时创建的 `AudioContext` 停在 `suspended`，
 * 只有等到用户点一下才肯出声 —— 而**决策卡恰恰是"AI 主动跳出来"的**
 * （用户可能只按了回车、或根本没碰窗口），于是卡片一声不响，点完才有音。
 *
 * 这是桌面应用，不是网页：不存在"广告自动爆音"的场景，用户已经主动装了这个程序。
 * 所以显式关掉用户手势要求（`webPreferences.autoplayPolicy` 也同步设一遍，
 * 因为窗口级设置优先于命令行开关）—— 让"卡一跳出来就响"成为**确定性行为**。
 */
try { app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); } catch { /* noop */ }

/**
 * 单实例（产品定稿）：**禁止多开**。
 * 重复启动不会新开进程/托盘，只把已运行主窗口**移到屏幕中央并获得焦点**。
 */
const dedaoDangeSuo = app.requestSingleInstanceLock();
if (!dedaoDangeSuo) {
  // 第二实例：不初始化托盘/窗口，尽快退出
  try { app.quit(); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30);
} else {
  app.on('second-instance', () => {
    zhuJiaoZhuChuangKouJuZhong();
  });
}

// 任务栏/窗口图标统一用产品 logo（yingYong.ico 优先）
try {
  const tubiao = warmyWindowIcon();
  if (tubiao && fs.existsSync(tubiao)) {
    app.whenReady().then(() => {
      try { nativeImage.createFromPath(tubiao); } catch { /* noop */ }
    }).catch(() => {});
  }
} catch { /* noop */ }

if (dedaoDangeSuo) {
  app
    .whenReady()
    .then(async () => {
      qidong('whenReady');
      boZhongDaoMoRen();
      boZhongNeiZhiJiNeng();
      chuangjianChuangkou();
      qidong('window created');
      /**
       * **窗口保底**（用户反馈"突然停止/闪退"）：
       * 上面任何一步抛错、或窗口被意外销毁，都会让用户看到"程序不见了"。
       * 这里 5 秒后自查一次：一个可用窗口都没有就再建一个，并如实记日志。
       */
      setTimeout(() => {
        try {
          const huo = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
          if (!huo.length) {
            qidong('window guard: no live window, recreating');
            chuangjianChuangkou();
          }
        } catch (e) { qidong(`window guard error ${String(e)}`); }
      }, 5000);
      await yindao();
      qishiJiyiCangYibu();
      try { dshMoRenBaoZhuang(); qidong('dsh auto-install scheduled'); } catch (e) { qidong(`dsh auto ${String(e)}`); }
      try { chuangjianTuopan(); qidong('tray ready'); } catch (e) { qidong(`tray fail ${String(e)}`); }
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) chuangjianChuangkou();
      });
    })
    .catch((e) => {
      // 启动期就抛错：**不能静默退出**（那就是"闪退"）。记日志 + 尽力建窗口。
      qidong(`whenReady error ${String(e)}`);
      try { chuangjianChuangkou(); } catch { /* noop */ }
    });

  /**
   * **崩坏防护**（用户反馈"突然停止/闪退"）：
   * 渲染进程、GPU 进程、其它子进程挂掉时，Electron 默认可能直接把整个应用带走。
   * 这里一律**接住 + 记日志 + 恢复窗口**，绝不让一次子进程崩溃变成"应用闪退"。
   */
  app.on('render-process-gone', (_e, wc, details) => {
    qidong(`render-process-gone reason=${details?.reason || '?'} exitCode=${details?.exitCode ?? '?'}`);
    audit?.log('app.render-gone', { reason: details?.reason || '', exitCode: details?.exitCode ?? 0 });
    // 只要还开着窗口，就把它的渲染进程重新加载起来（数据在日志/磁盘里，不会丢）
    try {
      if (wc && !wc.isDestroyed() && details?.reason !== 'clean-exit') wc.reload();
    } catch { /* noop */ }
  });
  app.on('child-process-gone', (_e, details) => {
    qidong(`child-process-gone type=${details?.type || '?'} reason=${details?.reason || '?'} exitCode=${details?.exitCode ?? '?'}`);
    audit?.log('app.child-gone', { type: details?.type || '', reason: details?.reason || '', exitCode: details?.exitCode ?? 0 });
    // GPU 进程没了是可恢复的：重建窗口即可（不退出应用）
    if (details?.type === 'GPU' && details?.reason !== 'clean-exit') {
      try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch { /* noop */ }
    }
  });
}

app.on('window-all-closed', () => {
  qidong('window-all-closed');
  if (process.platform !== 'darwin') tuichuYingyong('window-all-closed');
});

app.on('before-quit', () => {
  qiangzhiTuichu = true;
  // 收尾：把流式"正在进行"的气泡收掉（否则退出后界面上留着半截）
  try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId: '*', reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
  // 托盘必须销毁，否则任务栏/通知区残留图标
  try { tray?.destroy(); } catch { /* noop */ }
  tray = null;
  // 退出前再落一次盘，避免内存变更没跟上文件
  try {
    luoPanLuYouQiDuiLie();
  } catch { /* ignore */ }
  // 预计完成时间账本是"越用越准"的资产：退出前把节流里那次也落下去
  // 预计完成时间：**两个文件**都要在退出前落盘（方法库是资产，临时文件要让"同一轮"能续上）
  try { etaBaCun(); } catch { /* ignore */ }
  void (async () => {
    try {
      await memory?.stop();
      await p1?.instances.stopAll();
      await p1?.teardown.shutdownAll();
    } catch {
      /* ignore */
    }
  })();
});

/** 渲染层「待执行队列」持久化 IPC（重启后不丢 P2/P3 待办） */
chuliIpc('warmy:uiDuiLieJiQu', async () => {
  try {
    return { ok: true, queues: huiFuJieMianDuiLie() };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), queues: {} };
  }
});
chuliIpc('warmy:uiDuiLieJiSheZhi', async (_e, payload?: { queues?: Record<string, unknown> }) => {
  try {
    const q = payload?.queues;
    if (!q || typeof q !== 'object') return { ok: false, error: 'queues must be an object' };
    luoPanJieMianDuiLie(q as Record<string, unknown>);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
/** Router 队列只读快照（诊断/巡检用） */
chuliIpc('warmy:luYouQiDuiLieJiQu', async () => {
  try {
    luoPanLuYouQiDuiLie();
    return { ok: true, snapshot: router.serializeState(), file: routerQueuesFile() };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:yingJian', () => anQuanChuLi(() => p1?.instances.hardwareAdvice(), null));
chuliIpc('warmy:lieBiaoShiLiJi', () => anQuanChuLi(() => (p1?.instances.LieBiao() ?? []).map((x) => ({ ...x, name: x.ming })), []));
chuliIpc(
  'warmy:paiShengShiLi',
  async (_e, cfg: { id: string; ming: string; dutyEligible?: boolean }) => {
    if (!p1) throw new Error('runtime not ready');
    return p1.instances.spawn({
      config: {
        id: cfg.id,
        ming: cfg.ming || (cfg as { name?: string }).name || cfg.id,
        workspace: path.join(app.getPath('userData'), 'instances', cfg.id),
        dutyEligible: !!cfg.dutyEligible,
      },
    });
  }
);
chuliIpc('warmy:tingZhiShiLi', async (_e, id: string) => {
  try {
    // **标记停止**：续派循环查到就不再往下派（否则 stopInstance 只杀进程，续派还跑）
    stoppedSessions.add(id);
    zhongZhiXinHao(id); // 真的把在途请求取消掉
    yanXuZhuangTai.delete(id);
    try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId: id, kai: false, ts: Date.now() }); } catch { /* noop */ }
    try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId: id, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
    await p1?.instances.stop(id);
    return true;
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/**
 * **只停当前会话的 AI 请求/续派**（不停用牛马实例）。
 * 产品要求：停止键只影响当前会话，不影响其他会话中的 AI，也不停用牛马。
 */
chuliIpc('warmy:tingZhiDuiHua', (_e, sessionId: string) => {
  try {
    stoppedSessions.add(sessionId);
    zhongZhiXinHao(sessionId); // 真的把在途请求取消掉
    yanXuZhuangTai.delete(sessionId);
    try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: false, ts: Date.now() }); } catch { /* noop */ }
    try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
    audit?.log('chat.stop-by-user', { sessionId });
    return true;
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/**
 * ══════════════════════════════════════════════════════════════
 * 拟态（桌宠）
 * ── 窗口要点（依 Electron 官方实践 / issue #52456）：
 *    transparent + frame:false + alwaysOnTop + skipTaskbar + focusable:false；
 *    **点击穿透**用 `setIgnoreMouseEvents(true, { forward: true })`，
 *    并且只在鼠标**离开桌宠本体**时开启穿透（否则它会把桌面上所有点击都吃掉）。
 * ══════════════════════════════════════════════════════════════
 */
let mimicWin: BrowserWindow | null = null;
let mimicDragCun: { x: number; y: number; bx: number; by: number } | null = null;

/** 拟态资源根目录：优先用户数据目录，其次随包资源目录 */
function mimicGen(): { chars: string; actions: string; users: string } {
  const users = path.join(app.getPath('userData'), 'mimic');
  const bundled = path.join(__dirname, 'renderer', 'mimic');
  return { chars: bundled, actions: bundled, users };
}

/** 扫描人物模型（静态图 / 精灵图 JSON / Live2D） */
function mimicSaoRenWu(): Array<{ id: string; name: string; file: string; kind: string }> {
  const out: Array<{ id: string; name: string; file: string; kind: string }> = [];
  const roots: string[] = [];
  try { roots.push(path.join(app.getPath('userData'), 'mimic', 'characters')); } catch { /* noop */ }
  try { roots.push(path.join(__dirname, 'renderer', 'mimic', 'characters')); } catch { /* noop */ }
  for (const root of roots) {
    let names: string[] = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const n of names) {
      const fp = path.join(root, n);
      const ext = path.extname(n).toLowerCase();
      // 内置默认（随包）用 app 相对路径，用户目录用 file://
      const isBundled = root.includes(path.join('renderer', 'mimic'));
      const ref = isBundled ? './mimic/characters/' + n : 'file://' + fp.replace(/\\/g, '/');
      if (ext === '.json') {
        // 精灵图定义
        try {
          const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const sheet = String(d.sheet || d.image || n.replace(/\.json$/i, '.png'));
          const sheetRef = isBundled ? './mimic/characters/' + sheet : 'file://' + path.join(path.dirname(fp), sheet).replace(/\\/g, '/');
          out.push({ id: n.replace(/\.json$/i, ''), name: String(d.name || n.replace(/\.json$/i, '')), file: sheetRef, kind: 'sheet' });
        } catch { /* 坏 json 跳过 */ }
      } else if (ext === '.model3.json') {
        out.push({ id: n.replace(/\.model3\.json$/i, ''), name: n.replace(/\.model3\.json$/i, ''), file: ref, kind: 'live2d' });
      } else if (['.png', '.webp', '.gif', '.svg'].includes(ext)) {
        out.push({ id: n.replace(/\.[^.]+$/, ''), name: n.replace(/\.[^.]+$/, ''), file: ref, kind: 'image' });
      }
    }
  }
  // 去重（同名以内置优先）
  const jian = new Map<string, { id: string; name: string; file: string; kind: string }>();
  for (const x of out) if (!jian.has(x.id)) jian.set(x.id, x);
  return [...jian.values()];
}

/** 扫描动作模型（每个子目录一个 action.json） */
function mimicSaoDongZuo(): Array<{ id: string; name: string; desc: string; trigger: string; duration: number; cooldown: number; priority: number; file: string }> {
  const out: Array<{ id: string; name: string; desc: string; trigger: string; duration: number; cooldown: number; priority: number; file: string }> = [];
  const roots: Array<{ root: string; bundled: boolean }> = [];
  try { roots.push({ root: path.join(app.getPath('userData'), 'mimic', 'actions'), bundled: false }); } catch { /* noop */ }
  try { roots.push({ root: path.join(__dirname, 'renderer', 'mimic', 'actions'), bundled: true }); } catch { /* noop */ }
  for (const { root, bundled } of roots) {
    let subs: string[] = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const d of subs) {
      const jp = path.join(root, d, 'action.json');
      try {
        const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
        const sheet = String(j.sheet?.image || 'sheet.png');
        const ref = bundled ? './mimic/actions/' + d + '/' + sheet
          : 'file://' + path.join(root, d, sheet).replace(/\\/g, '/');
        out.push({
          id: d,
          name: String(j.name || d),
          desc: String(j.desc || ''),
          trigger: String(j.trigger || ''),
          duration: Number(j.duration) || 1500,
          cooldown: Number(j.cooldown) || 8000,
          priority: Number(j.priority) || 5,
          file: ref,
        });
      } catch { /* 没 action.json 或坏 json：跳过 */ }
    }
  }
  return out;
}

chuliIpc('warmy:mimicRenWuLieBiao', () => ({ ok: true, items: mimicSaoRenWu() }));
chuliIpc('warmy:mimicDongZuoLieBiao', () => ({ ok: true, items: mimicSaoDongZuo() }));

/** 启动桌宠窗口 */
chuliIpc('warmy:mimicStart', async (_e, p0?: { character?: string }) => {
  try {
    if (mimicWin && !mimicWin.isDestroyed()) {
      try { mimicWin.focus(); } catch { /* noop */ }
      return { ok: true, already: true };
    }
    const disp = screen.getPrimaryDisplay();
    const wa = disp.workAreaSize;
    const W = 240, H = 260;
    mimicWin = new BrowserWindow({
      width: W, height: H,
      x: Math.round(wa.width - W - 40), y: Math.round(wa.height - H - 20),
      frame: false, transparent: true, resizable: false, movable: true,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'mimic-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, webSecurity: true,
        backgroundThrottling: false,
      },
    });
    mimicWin.setAlwaysOnTop(true, 'screen-saver');
    // 初始整窗穿透；渲染层会在鼠标进入桌宠本体时关掉穿透
    try { mimicWin.setIgnoreMouseEvents(true, { forward: true }); } catch { /* noop */ }
    await mimicWin.loadFile(path.join(__dirname, 'renderer', 'mimic.html'));
    const cap = String(p0?.character || '');
    if (cap) {
      const list = mimicSaoRenWu();
      const hit = list.find((x) => x.id === cap) || list[0];
      if (hit) { try { mimicWin.webContents.send('warmy:mimicSetTi', { src: hit.file }); } catch { /* noop */ } }
    }
    mimicWin.on('closed', () => { mimicWin = null; });
    try { broadcastToWindows('warmy:mimicState', { on: true }); } catch { /* noop */ }
    audit?.log('mimic.start', { character: cap });
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:mimicStop', () => {
  try {
    if (mimicWin && !mimicWin.isDestroyed()) mimicWin.close();
    mimicWin = null;
    try { broadcastToWindows('warmy:mimicState', { on: false }); } catch { /* noop */ }
    audit?.log('mimic.stop', {});
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:mimicZhuangTai', () => ({ ok: true, on: !!(mimicWin && !mimicWin.isDestroyed()) }));

/** 让桌宠说话（字幕 + 可选语音由渲染层负责） */
chuliIpc('warmy:mimicShuo', (_e, p0?: { text?: string; ms?: number }) => {
  try {
    if (mimicWin && !mimicWin.isDestroyed()) {
      mimicWin.webContents.send('warmy:mimicSay', { text: String(p0?.text || ''), ms: Number(p0?.ms) || 0 });
    }
    return { ok: true };
  } catch { return { ok: false }; }
});

/** 状态灯（语音模式开着时亮） */
chuliIpc('warmy:mimicDian', (_e, p0?: { on?: boolean }) => {
  try {
    if (mimicWin && !mimicWin.isDestroyed()) mimicWin.webContents.send('warmy:mimicDot', { on: !!p0?.on });
    return { ok: true };
  } catch { return { ok: false }; }
});

/** 拖动桌宠：用屏幕坐标差移动窗口（不是 CSS 位移，桌宠不会跑出屏幕） */
ipcMain.on('warmy:mimicDragStart', (_e, p0?: { x?: number; y?: number }) => {
  try {
    if (!mimicWin || mimicWin.isDestroyed()) return;
    const b = mimicWin.getBounds();
    mimicDragCun = { x: Number(p0?.x) || 0, y: Number(p0?.y) || 0, bx: b.x, by: b.y };
  } catch { /* noop */ }
});
ipcMain.on('warmy:mimicDragMove', (_e, p0?: { x?: number; y?: number }) => {
  try {
    if (!mimicWin || mimicWin.isDestroyed() || !mimicDragCun) return;
    const dx = (Number(p0?.x) || 0) - mimicDragCun.x;
    const dy = (Number(p0?.y) || 0) - mimicDragCun.y;
    const b = mimicWin.getBounds();
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const nx = Math.max(-b.width / 3, Math.min(wa.width - b.width * 2 / 3, mimicDragCun.bx + dx));
    const ny = Math.max(0, Math.min(wa.height - b.height / 3, mimicDragCun.by + dy));
    mimicWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: b.width, height: b.height });
  } catch { /* noop */ }
});
ipcMain.on('warmy:mimicDragEnd', () => { mimicDragCun = null; });

/** 点击穿透开关（Windows 支持 forward，鼠标移动事件仍能到渲染层） */
ipcMain.on('warmy:mimicClickThrough', (_e, on: boolean) => {
  try { if (mimicWin && !mimicWin.isDestroyed()) mimicWin.setIgnoreMouseEvents(!!on, { forward: true }); } catch { /* noop */ }
});

/** 双击桌宠 ⇒ 唤醒主窗口并打开与原形牛马的会话 */
ipcMain.on('warmy:mimicOpenChat', () => {
  try {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); broadcastToWindows('warmy:mimicOpenChat', {}); }
  } catch { /* noop */ }
});

chuliIpc('warmy:anQuanMoShi', () => anQuanChuLi(() => p1?.security.getMode(), 'normal'));
chuliIpc(
  'warmy:sheZhiAnQuanMoShi',
  async (_e, mode: 'full' | 'normal' | 'strict') => {
    await p1?.security.setMode(mode);
    return p1?.security.getMode();
  }
);
chuliIpc('warmy:jiYiHuiSuo', async (_e, payload?: string | { query?: string; limit?: number; scope?: Record<string, string> }) => {
  try {
    if (!memory) return { cards: [], error: 'memory-unavailable' };
    const q = typeof payload === 'string' ? payload : String(payload?.query || '');
    const limit = typeof payload === 'object' && payload?.limit ? Number(payload.limit) : 10;
    const scope = typeof payload === 'object' ? payload?.scope : undefined;
    return await memory.recallScoped(q, limit, scope);
  } catch (e) {
    return { cards: [], error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:jiYiZhuiJia', async (_e, text: string) => {
  try {
    return await memory?.append({
      id: `m-${Date.now()}`,
      sessionId: 'ui',
      kind: 'message',
      ti: text,
      groupId: 'ui',
      entityType: 'manual',
    });
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:jiYiJianSuo', async (_e, payload?: { seq?: number; recordId?: string }) => {
  try {
    if (!memory) return { ok: false, error: 'memory-unavailable' };
    return await memory.retrieve({ seq: payload?.seq, recordId: payload?.recordId });
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:jiYiZhuangTai', async () => {
  try {
    const ready = !!(memory?.isReady);
    let vector: unknown = null;
    let stats: unknown = null;
    if (ready) {
      try { vector = await memory!.vectorStatus(); } catch { vector = { ok: false }; }
      try { stats = await memory!.stats(); } catch { stats = null; }
    }
    return {
      ok: true,
      ready,
      CangLu: path.join(app.getPath('userData'), 'memory'),
      jsonl: path.join(app.getPath('userData'), 'memory', 'fast-memory.jsonl'),
      vector,
      stats,
      historyRestore,
    };
  } catch (e) {
    return { ok: false, ready: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:jiYiChongJian', async () => {
  try {
    if (!memory?.isReady) return { ok: false, error: 'memory-unavailable' };
    const r = await memory.rebuildProjection();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── i18n：文案全部在独立 json，中文产品名「无限牛马」，其余「WArmy」 ──
function i18nDir(): string {
  const candidates = [
    path.join(__dirname, 'i18n'),
    path.join(__dirname, '..', 'src', 'i18n'),
  ];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'zh-CN.json')));
  return found ?? candidates[0]!;
}

chuliIpc('warmy:i18n', (_e, yuYan: string) => {
  // Resolve to any of the 10 supported packs — never collapse to zh-CN/en-US only.
  const weiZhi = jiexiYuyan(yuYan);
  const file = path.join(i18nDir(), `${weiZhi}.json`);
  let strings: Record<string, string> = {};
  try {
    strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    strings = {};
  }
  // Trust the pack's own brand strings (ja=無限社畜 WArmy, ko=무한 사축 WArmy, zh=无限牛马, else WArmy).
  if (!strings['yingYong.displayName']) {
    strings['yingYong.displayName'] =
      strings['brand.name'] ||
      (weiZhi === 'zh-CN' || weiZhi === 'zh-TW' ? strings['yingYong.zhName'] || '无限牛马' : strings['yingYong.enName'] || 'WArmy');
  }
  // Non-Chinese packs may still list zh ming in copyright context; UI display uses displayName.
  win?.setTitle(strings['yingYong.displayName'] || 'WArmy');
  return { yuYan: weiZhi, strings, displayName: strings['yingYong.displayName'], supported: SUPPORTED_LOCALES };
});

// ── Microsandbox：虚拟化前提 / 安装 / 卸载 / 重装（msb 可能在 ~/.microsandbox/bin） ──
/** msb CLI 的常见落盘位置（安装脚本默认写到用户目录，不一定进 PATH） */
function msbHouXuanLuJing(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return [
    path.join(home, '.microsandbox', 'bin', process.platform === 'win32' ? 'msb.exe' : 'msb'),
    path.join(home, '.local', 'bin', 'msb'),
    'msb',
  ];
}
async function zhaoMsbKe(): Promise<string | null> {
  for (const p of msbHouXuanLuJing()) {
    if (p === 'msb') {
      const r = await new Promise<{ ok: boolean }>((resolve) => {
        execFile('msb', ['--version'], { timeout: 8000, windowsHide: true }, (err) => resolve({ ok: !err }));
      });
      if (r.ok) return 'msb';
      continue;
    }
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* next */ }
  }
  return null;
}

/** 平台虚拟化前提是否满足（Windows=虚拟机平台 / Linux=KVM / macOS=Apple Silicon） */
chuliIpc('warmy:microsandboxXuNiHua', async () => {
  try {
    if (process.platform === 'win32') {
      // 不依赖管理员：HypervisorPresent 为真 ⇒ 虚拟化栈已起来（VirtualMachinePlatform/Hyper-V 至少一套可用）
      let hypervisorPresent = false;
      try {
        const r = await new Promise<{ out: string }>((resolve) => {
          execFile('powershell.exe', [
            '-NoProfile', '-Command',
            '(Get-CimInstance Win32_ComputerSystem).HypervisorPresent',
          ], { timeout: 15000, windowsHide: true }, (_e, stdout) => resolve({ out: String(stdout || '') }));
        });
        hypervisorPresent = /true/i.test(r.out || '');
      } catch { /* below */ }
      // 可选功能状态（需要管理员；失败不许当成「没开」）
      let featureState = 'unknown';
      try {
        const r2 = await new Promise<{ out: string; err: string; code: number | null }>((resolve) => {
          execFile('powershell.exe', [
            '-NoProfile', '-Command',
            "(Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State",
          ], { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
            resolve({ out: String(stdout || ''), err: String(stderr || ''), code: error ? 1 : 0 });
          });
        });
        featureState = (r2.out || '').trim().toLowerCase() || (r2.code ? 'need-admin' : 'unknown');
      } catch { featureState = 'need-admin'; }
      const enabled = hypervisorPresent
        || featureState === 'enabled'
        || featureState === 'enablepending';
      return {
        platform: 'win32',
        ok: enabled,
        feature: 'VirtualMachinePlatform',
        state: hypervisorPresent ? 'hypervisor-present' : featureState,
        howTo: enabled
          ? ''
          : '启用「虚拟机平台」：鼠标右击开始菜单（或 Win+R）→ 运行 → 输入 optionalfeatures → 确定 → 勾选「虚拟机平台」→ 重启。（或管理员 PowerShell：Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All）',
      };
    }
    if (process.platform === 'linux') {
      const kvm = fs.existsSync('/dev/kvm');
      let hint = '';
      if (!kvm) {
        hint = '启用 KVM：BIOS 开 VT-x/SVM 后，终端执行 sudo modprobe kvm_intel（或 kvm_amd）；桌面版一般还需 sudo usermod -aG kvm $USER 后重新登录。';
      }
      return { platform: 'linux', ok: kvm, feature: 'kvm', state: kvm ? 'ok' : 'missing', howTo: hint };
    }
    if (process.platform === 'darwin') {
      const arm = process.arch === 'arm64';
      return {
        platform: 'darwin',
        ok: arm,
        feature: 'apple-silicon',
        state: arm ? 'ok' : 'unsupported-arch',
        howTo: arm ? '' : 'macOS 仅支持 Apple Silicon（M 系列）；Intel Mac 无法使用本地 microVM。',
      };
    }
    return { platform: process.platform, ok: false, feature: 'unknown', state: 'unsupported', howTo: '当前系统不支持 Microsandbox 本地 microVM。' };
  } catch (e) {
    return { platform: process.platform, ok: false, feature: 'error', state: 'error', howTo: String(e) };
  }
});

chuliIpc('warmy:microsandboxAnZhuang', async (e, opts?: { force?: boolean }) => {
  try {
    const isWin = process.platform === 'win32';
    const script = isWin
      ? "irm https://install.microsandbox.dev/windows | iex"
      : "curl -fsSL https://install.microsandbox.dev | sh";
    const file = isWin ? 'powershell.exe' : 'sh';
    const args = isWin ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script] : ['-c', script];
    const r = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      execFile(file, args, { timeout: 300000, windowsHide: true, maxBuffer: 1 << 22 }, (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof (error as { code?: number }).code === 'number' ? (error as { code?: number }).code! : 1) : 0,
          out: String(stdout || '').slice(-800),
          err: String(stderr || error?.message || '').slice(-800),
        });
      });
    });
    // 成功判定：以「msb 二进制真的在」为准（安装脚本可能非 0 退出但已装好）
    const bin = await zhaoMsbKe();
    qingRongQiTanCeHuanCun();
    const rep = await tanCeRongQiYunXing({ cacheMs: 0, only: ['microsandbox'] });
    const row = (rep.runtimes || []).find((x) => x.id === 'microsandbox');
    const ok = !!bin && (!row || row.status !== 'not-installed');
    return {
      ok,
      code: r.code,
      out: r.out,
      err: r.err,
      bin,
      status: row?.status || (bin ? 'installed' : 'not-installed'),
      version: row?.version || null,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 卸载 Microsandbox：删用户目录安装树；再探一次用事实说话 */
chuliIpc('warmy:microsandboxXieZai', async () => {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const dir = path.join(home, '.microsandbox');
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    qingRongQiTanCeHuanCun();
    const rep = await tanCeRongQiYunXing({ cacheMs: 0, only: ['microsandbox'] });
    const row = (rep.runtimes || []).find((x) => x.id === 'microsandbox');
    const gone = !fs.existsSync(dir) && (!row || row.status === 'not-installed');
    return { ok: gone, removedDir: dir, status: row?.status || 'not-installed', err: gone ? '' : 'dir still exists or still detected' };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 当前 Microsandbox 状态（装没装 + 版本 + 虚拟化前提） */
chuliIpc('warmy:microsandboxZhuangTai', async () => {
  const bin = await zhaoMsbKe();
  qingRongQiTanCeHuanCun();
  const rep = await tanCeRongQiYunXing({ cacheMs: 0, only: ['microsandbox'] });
  const row = (rep.runtimes || []).find((x) => x.id === 'microsandbox');
  let virt: { ok: boolean; howTo: string; platform: string; state: string } = { ok: false, howTo: '', platform: process.platform, state: 'unknown' };
  try {
    // 复用虚拟化检查逻辑（与 IPC 同实现，避免再起进程）
    if (process.platform === 'win32') {
      let hypervisorPresent = false;
      try {
        const rh = await new Promise<{ out: string }>((resolve) => {
          execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystem).HypervisorPresent'], { timeout: 15000, windowsHide: true }, (_e, stdout) => resolve({ out: String(stdout || '') }));
        });
        hypervisorPresent = /true/i.test(rh.out || '');
      } catch { /* ignore */ }
      let featureState = 'unknown';
      try {
        const r = await new Promise<{ out: string; code: number | null }>((resolve) => {
          execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State'], { timeout: 15000, windowsHide: true }, (error, stdout) => resolve({ out: String(stdout || ''), code: error ? 1 : 0 }));
        });
        featureState = (r.out || '').trim().toLowerCase() || (r.code ? 'need-admin' : 'unknown');
      } catch { featureState = 'need-admin'; }
      const enabled = hypervisorPresent || featureState === 'enabled' || featureState === 'enablepending';
      virt = {
        ok: enabled,
        platform: 'win32',
        state: hypervisorPresent ? 'hypervisor-present' : featureState,
        howTo: enabled ? '' : '启用「虚拟机平台」：右击开始菜单（或 Win+R）→ 运行 → 输入 optionalfeatures → 勾选「虚拟机平台」→ 重启',
      };
    } else if (process.platform === 'linux') {
      const kvm = fs.existsSync('/dev/kvm');
      virt = { ok: kvm, platform: 'linux', state: kvm ? 'ok' : 'missing', howTo: kvm ? '' : '启用 KVM：BIOS 开 VT-x/SVM 后执行 sudo modprobe kvm_intel（或 kvm_amd）' };
    } else if (process.platform === 'darwin') {
      const arm = process.arch === 'arm64';
      virt = { ok: arm, platform: 'darwin', state: arm ? 'ok' : 'unsupported-arch', howTo: arm ? '' : 'macOS 仅支持 Apple Silicon（M 系列）' };
    }
  } catch { /* keep unknown */ }
  return {
    ok: !!bin && (!row || row.status !== 'not-installed'),
    bin,
    status: row?.status || (bin ? 'installed' : 'not-installed'),
    version: row?.version || null,
    virt,
  };
});



/* ── 文字（字体 / 粗细 / 大小）────────────────────────────────────────────
   法律立场（产品定稿）：**安装包不内置任何字体**（零再分发 ⇒ 零授权风险）。
   字体来源两条，都合法：
     1) **系统已装字体**：只「点名使用」，不复制、不打包、不再分发；
     2) **用户自行安装**：用户把自己有权使用的字体装进本应用（仅存本机 userData）。
   ─────────────────────────────────────────────────────────────────────── */
chuliIpc('warmy:lieBiaoXiTongZiTi', () => {
  /**
   * ⚠️ 必须给**字体家族名**（font-family 认的是家族名）。
   * 以前这里拿字体**文件名**近似（arialbd / ANTQUAB…）⇒ CSS 里写 `font-family:"arialbd"`
   * 根本匹配不到任何字体 ⇒ 「改了字体没生效」。Windows 用 GDI+ 的
   * InstalledFontCollection 拿家族名；拿不到再退回文件名近似（其它平台）。
   */
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }',
      ], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      const jia = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (jia.length) {
        return { ok: true, fonts: Array.from(new Set(jia)).sort((a, b) => a.localeCompare(b)) };
      }
    } catch { /* 落到下面的通用路径 */ }
  }
  try {
    const dir = process.platform === 'win32'
      ? [path.join(process.env.windir || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')]
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')]
        : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts')];
    const jia = new Set<string>();
    for (const d of dir) {
      try {
        for (const f of fs.readdirSync(d)) {
          if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
          // 用文件名做「家族名」近似：去掉扩展名与常见样式后缀
          const base = f.replace(/\.(ttf|otf|ttc)$/i, '')
            .replace(/[-_ ]?(regular|bold|italic|light|medium|semibold|black|thin|bolditalic|oblique)$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim();
          if (base && base.length <= 40) jia.add(base);
        }
      } catch { /* 目录不可读：跳过 */ }
    }
    const list = [...jia].sort((x: string, y: string) => x.localeCompare(y, 'zh-Hans-CN'));
    return { ok: true, fonts: list.slice(0, 400) };
  } catch (err) {
    return { ok: false, error: xiJingCuoWu(err), fonts: [] };
  }
});

chuliIpc('warmy:anZhuangZiTi', async (_e, p0?: { path?: string }) => {
  try {
    const src = String(p0?.path || '').trim();
    if (!src || !/\.(ttf|otf|ttc)$/i.test(src)) return { ok: false, error: 'bad-font-file' };
    if (!fs.existsSync(src)) return { ok: false, error: 'not-found' };
    const muLu = path.join(app.getPath('userData'), 'fonts');
    fs.mkdirSync(muLu, { recursive: true });
    const ming = path.basename(src);
    const dst = path.join(muLu, ming);
    fs.copyFileSync(src, dst);
    // 家族名近似（与列表一致）
    const jia = ming.replace(/\.(ttf|otf|ttc)$/i, '')
      .replace(/[-_ ]?(regular|bold|italic|light|medium|semibold|black|thin|bolditalic|oblique)$/i, '')
      .replace(/[-_]+/g, ' ').trim() || ming;
    audit?.log('settings.font-installed', { ming, jia });
    return { ok: true, path: dst, family: jia };
  } catch (err) {
    return { ok: false, error: xiJingCuoWu(err) };
  }
});

// 用**系统默认浏览器**打开外链（引导里的「获取 API Key」等），不走内置浏览器
chuliIpc('warmy:daKaiWaiBuLianJie', async (_e, url?: string) => {
  try {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'bad-url' };
    await shell.openExternal(u);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: xiJingCuoWu(err) };
  }
});

// ── 全屏取色：截当前屏幕给渲染层点选（浏览器 EyeDropper 出不了窗口） ──

/**
 * 真·全屏截图（产品要求：在**真实屏幕**上截图，不是软件界面里框一块）。
 * 流程：藏主窗 → 抓整屏 → 开一个**独立全屏遮罩窗**（覆盖整个桌面）→ 用户框选
 *       → 右键/Esc 取消、单击/回车=整屏 → 按设备像素比裁切落盘 → 回主窗。
 */
let jieTuDengDai: ((q: { x: number; y: number; w: number; h: number } | null) => void) | null = null;
chuliIpc('warmy:jieTuKaiShi', async () => {
  try {
    let cangQi = false;
    try {
      if (win && win.isVisible()) { win.hide(); cangQi = true; await new Promise((r) => setTimeout(r, 300)); }
    } catch { /* noop */ }
    const disp = screen.getPrimaryDisplay();
    const { width, height } = disp.size;
    const scale = disp.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
    const src = sources.find((x) => x.display_id === String(disp.id)) || sources[0];
    if (!src) { if (cangQi) win?.show(); return { ok: false, error: 'no-screen' }; }
    const dataUrl = src.thumbnail.toDataURL();
    const ne = new BrowserWindow({
      x: disp.bounds.x, y: disp.bounds.y, width, height,
      frame: false, transparent: false, resizable: false, movable: false,
      fullscreen: true, alwaysOnTop: true, skipTaskbar: true, focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'snip-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, webSecurity: true,
      },
    });
    ne.setMenuBarVisibility(false);
    ne.setAlwaysOnTop(true, 'screen-saver');
    const qu = await new Promise<{ x: number; y: number; w: number; h: number } | null>((resolve) => {
      jieTuDengDai = resolve;
      // 图在 loadFile 完成后注入（见下）
      void ne.loadFile(path.join(__dirname, 'renderer', 'snip.html')).then(() => {
        void ne.webContents.executeJavaScript(`window.__setCap && window.__setCap(${JSON.stringify(dataUrl)})`);
      }).catch(() => resolve(null));
      ne.on('closed', () => { if (jieTuDengDai) { const d = jieTuDengDai; jieTuDengDai = null; d(null); } });
    });
    try { ne.close(); } catch { /* noop */ }
    if (cangQi) { try { win?.show(); } catch { /* noop */ } }
    if (qu === null) return { ok: true, cancelled: true };
    // 选区（CSS 像素）→ 设备像素裁切
    const img = src.thumbnail;
    const zhen = img.getSize();
    const k = zhen.width / width;
    const cai = qu.w > 0 && qu.h > 0
      ? { x: Math.round(qu.x * k), y: Math.round(qu.y * k), width: Math.max(1, Math.round(qu.w * k)), height: Math.max(1, Math.round(qu.h * k)) }
      : { x: 0, y: 0, width: zhen.width, height: zhen.height };
    const tu = img.crop(cai);
    let lu = '';
    try {
      const dir = path.join(app.getPath('userData'), 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      lu = path.join(dir, `shot-${Date.now()}.png`);
      fs.writeFileSync(lu, tu.toPNG());
    } catch { /* 落盘失败不影响截图本身 */ }
    return { ok: true, cancelled: false, dataUrl: tu.toDataURL(), path: lu, width: cai.width, height: cai.height };
  } catch (e) {
    try { if (win && !win.isVisible()) win.show(); } catch { /* noop */ }
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:jieTuXuanQu', (_e, q0?: { x?: number; y?: number; w?: number; h?: number } | null) => {
  const d = jieTuDengDai;
  jieTuDengDai = null;
  if (d) d(q0 === null ? null : { x: Number(q0?.x) || 0, y: Number(q0?.y) || 0, w: Number(q0?.w) || 0, h: Number(q0?.h) || 0 });
});

chuliIpc('warmy:pingMuJieTu', async () => {
  try {
    /**
     * **先把自己藏起来再抓屏**：窗口最大化时它铺满屏幕，直接抓只会拍到自己的界面
     *（用户反馈"怎么把聊天框变成屏幕来截图了"）。
     */
    let cangQi = false;
    try {
      if (win && win.isVisible()) { win.hide(); cangQi = true; await new Promise((r) => setTimeout(r, 280)); }
    } catch { /* 藏不了就直接抓 */ }
    const disp = screen.getPrimaryDisplay();
    const { width, height } = disp.size;
    const scale = disp.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
    const src = sources.find((s) => s.display_id === String(disp.id)) || sources[0];
    if (!src) return { ok: false, error: 'no-screen' };
    const dataUrl = src.thumbnail.toDataURL();
    /**
     * 同时落盘一张 PNG：附件要能被**打开**、也要能被 AI 的文件工具读到。
     * 目录：<userData>/screenshots/，文件名带时间戳。
     */
    let shotPath = '';
    try {
      const dir = path.join(app.getPath('userData'), 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      shotPath = path.join(dir, `shot-${Date.now()}.png`);
      fs.writeFileSync(shotPath, src.thumbnail.toPNG());
    } catch { /* 落盘失败不影响截屏本身 */ }
    if (cangQi) { try { win?.show(); } catch { /* noop */ } }
    return { ok: true, dataUrl, path: shotPath, width: src.thumbnail.getSize().width, height: src.thumbnail.getSize().height };
  } catch (e) {
    try { if (win && !win.isVisible()) win.show(); } catch { /* noop */ }
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:yuYanXinXi', () =>
  anQuanChuLi(
    () => {
      const xitongTiShi = app.getLocale();
      return { system: xitongTiShi, resolved: jiexiYuyan(xitongTiShi), isZh: xitongTiShi.startsWith('zh'), supported: SUPPORTED_LOCALES };
    },
    { system: 'zh-CN', resolved: 'zh-CN', isZh: true, supported: SUPPORTED_LOCALES },
  ),
);

// ── 主题 ──
chuliIpc('warmy:sheZhiZhuTiLaiYuan', (_e, source: 'system' | 'light' | 'dark') => {
  try {
    nativeTheme.themeSource = source === 'system' ? 'system' : source;
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:zhuTiXinXi', () => anQuanChuLi(() => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors, themeSource: nativeTheme.themeSource }), { shouldUseDarkColors: false, themeSource: 'system' }));

// ── 拉取供应商模型列表（OpenAI 兼容 /models） ──
chuliIpc(
  'warmy:lieBiaoMoXingJi',
  async (_e, cfg: { protocol: string; baseURL: string; apiKey?: string; providerId?: string }) => {
    try {
      const { chuangjianGongYing } = await import('@warmy/providers');
      /**
       * 密钥来源：界面刚输入的明文优先，否则按供应商 id 从安全存储解出。
       * 界面**从不**回传已保存的密钥（读不回），所以"重新拉取"必须能自己取到它。
       */
      const key = await jiexiGongyingshangMiyao(String(cfg.providerId || providerCfg.presetId || ''), cfg.apiKey);
      const p = chuangjianGongYing(
        (cfg.protocol as 'openai-compatible' | 'anthropic' | 'ollama') || 'openai-compatible',
        { baseURL: cfg.baseURL, apiKey: key }
      );
      const models = await p.listModels();
      /**
       * 问出**该模型会什么**（视觉 / 思考档位 / 工具）：
       *  · 端点给字段（`input_modalities`/`capabilities`/`supported_parameters`）就用端点的；
       *  · 官方端点（DeepSeek / MiMo 等）只回 id ⇒ 用**已知模型能力表**兑底；
       *  · 两者都没有 ⇒ 如实 unknown（界面上不显示能力徽章，不猜）。
       */
      try {
        const det = await (p as unknown as { listModelsDetailed?: (sig?: AbortSignal) => Promise<Array<{ id: string; thinkLevels: string[]; vision?: boolean | 'unknown'; tools?: boolean | 'unknown'; supportsThinking?: boolean; kind?: string; contextLen?: number }>> }).listModelsDetailed?.();
        /**
         * **拉取时就要把"上下文大小"存下来**（真机反馈）：Ollama `/api/show` 等端点本来就能问到
         * `contextLen`，以前只存了 vision/thinking/tools ⇒ 上下文预算滑块只能退回写死的对照表。
         */
        const duanDianBiao = new Map<string, { vision?: boolean | 'unknown'; thinking?: boolean | 'unknown'; tools?: boolean | 'unknown'; thinkLevels?: string[]; kind?: string; contextLen?: number }>();
        if (Array.isArray(det)) {
          for (const m of det) {
            if (!m || !m.id) continue;
            duanDianBiao.set(m.id, {
              vision: m.vision,
              thinking: m.supportsThinking === undefined ? undefined : m.supportsThinking,
              tools: m.tools,
              thinkLevels: m.thinkLevels,
              kind: m.kind,
              contextLen: Number(m.contextLen) || 0,
            });
          }
        }
        for (const id of models) {
          const neng = moXingNengLi(id, (duanDianBiao.get(id) || null) as never);
          modelNengLiMeta.set(id, neng as never);
          if (neng.thinkLevels.length) modelThinkMeta.set(id, neng.thinkLevels);
          /**
           * **思考档位映射**（拉取时就建好，之后按它发请求）：
           * 各家档数不同（3 档 / 4 档 / 6 档…），按**强度比例**铺到我们的 l1..l6，
           * 数量不同也能正确对应（见 gouJianDangWeiAnShe）。
           */
          try {
            const anShe = gouJianDangWeiAnShe(neng.thinkLevels || []);
            modelDangWeiAnShe.set(id, anShe);
          } catch { /* noop */ }
        }
      } catch { /* 可选：拿不到就按通用档位 */ }
      /**
       * **拉取到的能力要落盘**（真机反馈："拉取模型的时候保存这个值，以便使用"）：
       * 重启后不必重新拉取，也能知道每个模型的**真实上下文大小**（上下文预算滑块据此显示）。
       */
      try {
        const caps: Record<string, { contextLen?: number; kind?: string; tools?: boolean | 'unknown'; vision?: boolean | 'unknown' }> = {};
        for (const [id0, neng0] of modelNengLiMeta) {
          const n = neng0 as { contextLen?: number; kind?: string; tools?: boolean | 'unknown'; vision?: boolean | 'unknown' };
          // **能力全量落盘**（不只看 contextLen）：kind/tools 是警示图标与筛选的依据
          caps[id0] = {
            contextLen: Number(n.contextLen) || 0,
            kind: String(n.kind || ''),
            tools: n.tools,
            vision: n.vision,
          };
        }
        const cur = (settingsStore?.load() as { modelCaps?: Record<string, unknown> } | undefined) || {};
        settingsStore?.save({ ...(cur as object), modelCaps: { ...(cur.modelCaps || {}), ...caps } } as never);
      } catch { /* 落盘失败不影响本次拉取 */ }
      return {
        ok: true,
        models,
        thinkMeta: Object.fromEntries(modelThinkMeta),
        /** 模型能力（视觉/思考/工具/上下文）——拉取时问出来的 + 已知表兑底 + 落盘存下的 */
        nengLi: Object.fromEntries(modelNengLiMeta),
      };
    } catch (e) {
      return { ok: false, models: [], error: xiJingCuoWu(e) };
    }
  }
);

/**
 * 通知音：优先用户选的文件；**没选/被清除 ⇒ 用内置默认音效**（随包在 dist/renderer/sounds）。
 * 以 data URL 交给渲染层播放（渲染层不碰文件系统）。
 */
chuliIpc('warmy:yinXiaoQu', (_e, p0?: { kind?: string }) => {
  try {
    const kind = p0?.kind === 'request' ? 'request' : p0?.kind === 'error' ? 'error' : 'complete';
    const s = settingsStore?.load() as { soundFiles?: Record<string, string> } | undefined;
    const yongHu = String(s?.soundFiles?.[kind] || '').trim();
    const wenJian = kind === 'request' ? 'request.wav' : kind === 'error' ? 'error.mp3' : 'complete.wav';
    const neiZhi = path.join(__dirname, 'renderer', 'sounds', wenJian);
    const lu = yongHu && fs.existsSync(yongHu) ? yongHu : neiZhi;
    if (!fs.existsSync(lu)) return { ok: false, error: 'no-sound-file', builtin: neiZhi };
    const buf = fs.readFileSync(lu);
    const mime = /\.mp3$/i.test(lu) ? 'audio/mpeg' : /\.ogg$/i.test(lu) ? 'audio/ogg' : 'audio/wav';
    return { ok: true, path: lu, builtin: lu === neiZhi, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 选择本地提示音文件 ──
chuliIpc('warmy:xuanZeSound', async () => {
  try {
    if (!win) return { ok: false };
    const r = await dialog.showOpenDialog(win, {
      title: 'Select sound',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 检查更新：真实网络查询，状态可区分（不再恒定返回 upToDate:true） ──
chuliIpc('warmy:jianChaGengXin', async () =>
  anQuanChuLiYiBu<GengXinJianChaJieGuo>(
    async () => (updater ? await updater.check() : gengXinqiBuKeYongJianCha(yingyongBanben())),
    gengXinqiBuKeYongJianCha(yingyongBanben())
  )
);

// ── 选择附件文件 ──
chuliIpc('warmy:xuanZeWenJian', async (_e, opts?: { filters?: string[] }) => {
  try {
    if (!win) return { ok: false };
    const ext = opts?.filters?.length ? opts.filters : undefined;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: ext ? [{ name: ext.join('/'), extensions: ext }] : undefined,
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 群聊编排 + 看板 ──
chuliIpc(
  'warmy:qunChuangJian',
  (_e, cfg: { groupId: string; ming: string; type: 'internal' | 'external'; directedMode?: boolean; devEnv?: 'host' | 'container'; directory?: string }) => {
    try {
      // 已存在（例如重启后 restoreGroups 已恢复）则不再 createGroup，直接复用
      if (!router.getGroup(cfg.groupId)) {
        router.createGroup({
          groupId: cfg.groupId,
          ming: cfg.ming,
          type: cfg.type,
          dutyInstanceId: null,
          directedMode: !!cfg.directedMode,
          members: [],
          permissions: DEFAULT_PERMISSIONS as never,
          checkpointLimit: 50,
        });
      }
      // 群记录落盘（group-list 的真实数据来源）
      const saved = groupStore?.upsertGroup({
        groupId: cfg.groupId,
        ming: cfg.ming,
        type: cfg.type,
        directedMode: !!cfg.directedMode,
        // 本机建的群 = 本机身份是创建者（成员证书的签发者就是它）。
        // 拿不到身份时**不填**（留空 = 未知），上层会退回"首次收到的签发者即群主"。
        ...(identityStore?.info()?.zhiWen ? { creatorFingerprint: String(identityStore.info()?.zhiWen) } : {}),
      });
      if (saved && !saved.ok) return { ok: false, error: 'cannot persist group' };
      /**
       * ADR 004（第十六批）：**创建时选的开发环境写进项目记录**（项目级、随项目同步给成员）。
       * 之前这一步是写本机 `settings.containerDev` —— 于是异地成员永远看不到
       * "这是一个容器开发项目"（产品主指出的正是这件事）。
       * 这里还顺手把创建者的身份指纹记为**上报者**，成员侧据此判断"这是创建者说的"。
       */
      // 项目属性：开发环境/目录/gateVerify 一律在创建时写入（不依赖 devEnv 是否填了）
      sheZhiXiangMuShuXing(cfg.groupId, {
        ...(cfg.devEnv === 'container' || cfg.devEnv === 'host' ? { devEnv: cfg.devEnv } : {}),
        ...(cfg.directory && fs.existsSync(cfg.directory) ? { directory: cfg.directory, directorySource: 'creator-picked' as const } : {}),
        gateVerify: gateVerifyForProjectType({ directory: cfg.directory, devEnv: cfg.devEnv, ming: cfg.ming }),
      });
      // 本机实例全部可值班（同时写入持久化成员表）
      joinLocalInstances(cfg.groupId);
      audit?.log('group.create', { groupId: cfg.groupId, type: cfg.type, devEnv: cfg.devEnv === 'container' ? 'container' : 'host' });
      return { ok: true, groupId: cfg.groupId, project: groupStore?.projectOf(cfg.groupId) || null };
    } catch (e) {
      return { ok: false, error: 'group create failed' };
    }
  }
);

// ── 群列表：来自 userData/groups.json（真实存储），不是空数组 / 演示数据 ──
chuliIpc('warmy:qunLieBiao', () =>
  anQuanChuLi<QunLieBiaoJieGuo>(
    () => {
      if (!groupStore) return { ok: false, groups: [], count: 0, error: 'group store unavailable' };
      const snap = groupStore.snapshot();
      const groups = snap.groups
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((g) => ({
          ...g,
          // 渲染层兼容：同时提供 name 与 ming（改名后存储字段是 ming）
          name: g.ming,
          memberCount: (snap.members[g.groupId] || []).length,
          jiHuo: !!router.getGroup(g.groupId),
        }));
      return { ok: true, groups, count: groups.length };
    },
    { ok: false, groups: [], count: 0, error: 'group store unavailable' }
  )
);

chuliIpc(
  'warmy:qunXiaoXi',
  async (
    _e,
    xiaoXi: { groupId: string; userId?: string; content: string; urgency?: string; mentionIds?: string[] }
  ) => {
    const urgency = (xiaoXi.urgency || 'P2') as 'P0' | 'P1' | 'P2' | 'P3';
    const route = router.route({
      groupId: xiaoXi.groupId,
      userId: xiaoXi.userId || 'local-user',
      content: xiaoXi.content,
      urgency,
      mentionIds: xiaoXi.mentionIds || [],
      timestamp: Date.now(),
    });

    // 外部群：无 @ 静默（不变量：仅聊天）
    const g = router.getGroup(xiaoXi.groupId);
    if (g?.type === 'external' && route.action === 'silent') {
      return { ok: true, action: 'silent', reason: route.reason, reply: null };
    }

    // 值班者看板解析（仅 duty 写入）
    if (board && route.action !== 'silent') {
      const parsed = JieLing(xiaoXi.content, xiaoXi.groupId);
      if (parsed) {
        try {
          board.append(parsed, 'duty');
        } catch {
          /* ignore */
        }
      }
    }

    // 请求时邮件提醒：仅在该会话勾选了「提醒」时才入队
    const notifyOk = (p1?.instances.LieBiao().find((x) => x.id === xiaoXi.groupId)?.dutyEligible !== false);
    const sset = settingsStore?.load();
    const emailOn = sset?.emailNotify?.request !== false || sset?.emailOnRequest;
    if (emailOn && notifyOk) {
      const profile = accountStore?.loadProfile();
      if (profile?.email) {
        emailQueue.push({
          to: profile.email,
          subject: `WArmy request ${xiaoXi.groupId}`,
          text: xiaoXi.content.slice(0, 500),
          ts: Date.now(),
        });
      }
    }
    const dutyUserRecordId = xinLiaoTianJiLuId('g');
    let dutyUserSeq: number | undefined;
    if (yiJingXieGuo(xiaoXi.groupId, 'user', xiaoXi.content)) {
      try { audit?.log('chat.dup-write-skipped', { sessionId: xiaoXi.groupId, role: 'user', chars: xiaoXi.content.length, from: 'group-duty' }); } catch { /* noop */ }
    } else {
      try {
        dutyUserSeq = memSeqOf(
          await memory?.append({
            id: dutyUserRecordId,
            sessionId: xiaoXi.groupId,
            kind: 'message',
            ti: xiaoXi.content,
            groupId: xiaoXi.groupId,
            entityType: 'chat',
          }, 'duty')
        );
      } catch {
        /* optional */
      }
    }
    // 日志只追加 + 真实 recordId/seq（不变量 #1、#5）。
    // recordId 只在记忆服务**真的写入成功**时才挂到日志上：否则指针会给出一个解引用不到的死 id
    // （降级路径下宁可只留 seq + recall 两种线索，也不给假线索）。
    zhuiJiaLiaoTianRiZhi(xiaoXi.groupId, {
      seq: xiaYiLiaoTianXuLie(dutyUserSeq),
      role: 'user',
      content: xiaoXi.content,
      recordId: dutyUserSeq !== undefined ? dutyUserRecordId : undefined,
      ts: Date.now(),
    });

    // 值班者调用 LLM 生成回复（有 Key 时）——按模型找所属供应商（Ollama 无需密钥）
    let llmReply: string | null = null;
    {
      const zhibanMoxing0 = providerCfg.model;
      const anD = await jieMoXingGongYingShang(String(zhibanMoxing0 || ''));
      const zhuD = anD || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
      if (zhuD.apiKey || zhuD.protocol === 'ollama') {
      try {
        const provider = congYuSheChuangJian(zhuD.presetId, {
          apiKey: zhuD.apiKey,
          baseURL: zhuD.baseURL || undefined,
          protocol: zhuD.protocol,
        } as never, zhuD.protocol);
        // 注意：用户消息已经在上面 appendChatLog 时进了镜像（chatHistories 不再是独立真相，
        // 见 appendChatLog —— 历史 bug 就是两处各自 push，重启后与 JSONL 脱节）
        // 不变量 #2：注入的是有界渲染视图（原来这里是 hist.slice(-20)，只按条数有界）。
        // 值班系统提示是**冻结头**，不随日志增长，作为固定前缀在预算之外（常数开销）。
        // 计划1/2：值班路径同样自动收敛重试
        const zhibanMoxing = providerCfg.model;
        const dutyBase = contextBudgetChars(zhibanMoxing);
        const zhibanChongshi = await daiShangXiaWenChongShiYunXing(dutyBase, async (budgetChars) => {
          const shitu = renderChatView(xiaoXi.groupId, xiaoXi.content, budgetChars);
          // ADR 002 §9.4 待办 2：值班者路径也只走这一个循环入口（工具/降级/审计行为一致）
          const loop = await yunXingLiaoTianXunHuan(xiaoXi.groupId, provider, {
            model: zhibanMoxing,
            xiaoXiJi: [
              { role: 'system', content: tMain('llm.dutySystem') },
              ...(shitu.xiaoXiJi as LiaoTianXiaoXi[]),
            ],
            maxTokens: 512,
          });
          return { loop, budgetChars };
        });
        const loop = zhibanChongshi.result?.loop as Awaited<ReturnType<typeof yunXingLiaoTianXunHuan>> | undefined;
        if (!loop && zhibanChongshi.gaveUp) {
          llmReply = tMain('chat.contextTooSmall', '该模型上下文太小，无法满足当前聊天需求（已自动收缩重试到最小值仍失败）');
        } else if (loop) {
          llmReply = neiRongWenBen(loop.xiangYingTi.choices[0]?.message?.content);
          /**
           * **空回复不再是死路**（与单聊同一套兜底）：工具跑完没吐正文时，
           * 如实合成一段总结；再要一次纯文本；都不行就明说原因。
           * 真事故：多轮工具后返回 `（本条回复无内容）`。
           * 「只有标点」也算没内容（真机反馈：多出一句只有「。」的回复）。
           */
          const zhiBiaoDian = !!String(llmReply || '').trim() && !youShiZhiWenBen(llmReply);
          if (zhiBiaoDian) {
            audit?.log('chat.empty-reply', { sessionId: xiaoXi.groupId, chars: String(llmReply || '').length, punctuationOnly: true, model: zhibanMoxing });
            llmReply = '';
          }
          if (!youShiZhiWenBen(llmReply)) {
            const zhongFu = [...new Set(benLunGongJuMing)];
            if (zhongFu.length) {
              llmReply = tMain('chat.toolsDone', '本轮我调用了工具来完成这件事：') + zhongFu.join('、')
                + tMain('chat.toolsDoneTail', '。工具已执行完毕，没有额外要补充的文字说明。');
            }
          }
          if (!youShiZhiWenBen(llmReply)) {
            try {
              const zaiWen = await provider.chat({
                model: zhibanMoxing,
                xiaoXiJi: [
                  { role: 'system', content: tMain('llm.needText', '请用简短中文直接回答用户，不要调用工具。') },
                  { role: 'user', content: String(xiaoXi.content || '').slice(0, 2000) },
                ],
                maxTokens: 512,
              });
              llmReply = neiRongWenBen(zaiWen.choices[0]?.message?.content);
            } catch { /* 走如实说明 */ }
          }
          if (!youShiZhiWenBen(llmReply)) {
            llmReply = tMain('chat.emptyReplyWhy', '本轮模型没有返回文字内容（可能是工具调用后未作说明）。请再问一次，或换个说法。');
          }
        }
        zhuiJiaLiaoTianRiZhi(xiaoXi.groupId, {
          seq: xiaYiLiaoTianXuLie(),
          role: 'assistant',
          content: llmReply || '',
          recordId: xinLiaoTianJiLuId('a'),
          ts: Date.now(),
        });
      } catch (e) {
        llmReply = `LLM error: ${xiJingCuoWu(e).slice(0, 160)}`;
      }
      }
    }

    return {
      ok: true,
      action: route.action,
      reason: route.reason,
      duty: route.duty?.id,
      decision: route.decision,
      queueLength: router.listQueue(xiaoXi.groupId).length,
      reply: llmReply,
    };
  }
);

chuliIpc('warmy:kanbanRenwuJi', (_e, groupId?: string) => {
  try {
    return { ok: true, RenwuJi: board?.listTasks(groupId) || [] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:kanbanShiJianJi', () => {
  try {
    return { ok: true, events: board?.tailEvents(30) || [] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:kanbanJuHe', () => {
  try {
    return { ok: true, sessions: board?.aggregateByGroup() || [] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:qunJiaRuShiLi', (_e, groupId: string, instanceId: string) => {
  try {
    const inst = p1?.instances.LieBiao().find((x) => x.id === instanceId);
    if (!inst) return { ok: false };
    router.join(groupId, {
      id: inst.id,
      ming: inst.ming,
      local: true,
      dutyEligible: inst.dutyEligible,
      status: inst.status === 'running' ? 'idle' : 'offline',
    });
    // 成员关系落盘：重启后仍在群里
    groupStore?.addMemberWithFingerprint(
      groupId,
      { ming: inst.ming, role: 'member', source: 'instance', instanceId: inst.id },
      { onAudit: (op, detail) => audit?.log(op, detail) }
    );
    return { ok: true };
  } catch (e) { return { ok: false, error: 'join failed' }; }
});

// ── 真 LLM 对话 ──
chuliIpc('warmy:sheZhiGongYingShang', async (_e, cfg: Partial<typeof providerCfg>) => {
  try {
    const shuru = cfg.apiKey;
    providerCfg = { ...providerCfg, ...cfg };
    // 模型名同上：界面可能传来「供应商 · 模型」复合标签，必须剥成纯 id
    if (providerCfg.model) providerCfg.model = jieMoXingMing(providerCfg.model);
    // baseURL 必须带 /v1（少了会 404）
    providerCfg.baseURL = guiFanBaseURL(providerCfg.baseURL || '');
    /**
     * 界面不再回传明文密钥（密钥只在输入那一刻进 SecureKeyStore）。
     * 这里按 id 把密钥解出来放进内存，保证聊天路径和以前一样可用。
     */
    if (!providerCfg.apiKey || !shuru) {
      const k = await jiexiGongyingshangMiyao(providerCfg.presetId, shuru);
      if (k) providerCfg.apiKey = k;
    }
    /**
     * 落盘：只写**可公开的元数据**，密钥一个字节都不进设置文件。
     * 有了它，重启后组网/聊天才知道该用哪个供应商、哪个模型。
     */
    try {
      settingsStore?.save({
        activeProvider: {
          presetId: providerCfg.presetId,
          baseURL: providerCfg.baseURL || '',
          model: providerCfg.model || '',
          protocol: providerCfg.protocol,
        },
      } as never);
    } catch { /* 设置写失败不影响本次生效 */ }
    return { ok: true, providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' } };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/**
 * 供应商密钥：**只进 SecureKeyStore**（safeStorage）。
 * 明确拒绝在没有 OS 保护时写明文（`no-safe-storage`），并把这个结果**如实**回给界面，
 * 由界面告诉用户"这台机器上没有可用的加密存储"，绝不静默降级。
 */
chuliIpc('warmy:gongYingShangMiYaoSheZhi', async (_e, payload: { providerId?: string; apiKey?: string }) => {
  const id = String(payload?.providerId || '');
  const key = String(payload?.apiKey || '');
  if (!id) return { ok: false, error: 'bad-provider-id' };
  if (!key) return { ok: false, error: 'empty-key' };
  try {
    if (!secureKeys) return { ok: false, error: 'secure-store-unavailable' };
    await secureKeys.save(id, key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:gongYingShangMiYaoHas', async (_e, payload: { providerIds?: string[] } = {}) => {
  const idJi = Array.isArray(payload.providerIds) ? payload.providerIds.map((x) => String(x)) : [];
  const has: Record<string, boolean> = {};
  for (const id of idJi) {
    try { has[id] = !!(await secureKeys?.load(id)); } catch { has[id] = false; }
  }
  return { ok: true, has };
});

chuliIpc('warmy:gongYingShangMiYaoQingChu', (_e, payload: { providerId?: string } = {}) => {
  try {
    const id = String(payload?.providerId || '');
    if (id && secureKeys) secureKeys.delete(id);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:quGongYingShang', () => ({
  ok: true,
  providerCfg: { ...providerCfg, apiKey: providerCfg.apiKey ? '***' : '' },
  hasKey: !!providerCfg.apiKey || providerCfg.protocol === 'ollama',
}));

/**
 * 真正的「发一轮」实现 —— IPC 与**多循环自动继续**共用同一个入口，
 * 避免两套逻辑各自漂移（真事故：模型说"接着做下一个"，然后就没下一轮了）。
 */
async function zhenZhengFaSong(
  _e: unknown,
  xiaoXi: {
      sessionId: string;
      role?: 'user';
      content: string;
      model?: string;
      /** 「智能选模型」的决策输入（渲染层把牛马的配置如实带过来；决策只在这里做） */
      moXingJueCe?: MoXingJueCeShuRu;
      /** 思考级别：auto/off/low/medium/high（聊天框的一次性覆盖 > 牛马默认档） */
      thinkLevel?: string;
      /** 小弟数量：'auto' 或 0..8（0 = 不许派小弟） */
      xiaoDiShuLiang?: string | number;
      /** 这只牛马的名字：**强制注入**身份（它得知道自己叫什么） */
      ming?: string;
      /** 指令插入：outer=外循环后，inner=内循环边界 */
      insertMode?: 'outer' | 'inner';
      /** 附件（图片走多模态让模型**真的看到**；其它文件只带路径） */
      attachments?: Array<{ name?: string; path?: string; dataUrl?: string }>;
      /** **内部指令**（自动续派等）：进模型上下文但**不出现在聊天记录**里 */
      internal?: boolean;
    }
): Promise<{ ok: boolean; reply: string; [k: string]: unknown }> {
    const sessionId = xiaoXi.sessionId;
    // 新的一轮**用户**消息 ⇒ 自动继续计数清零（自动续派的那几轮自己带计数，不清）
    if (!String(xiaoXi.content || '').startsWith('【继续执行计划】') && !String(xiaoXi.content || '').startsWith('【继续执行】')) {
      yanXuZhuangTai.delete(sessionId);
      /**
       * 用户**自己说话了** ⇒ 上一轮自动任务到此为止。
       * 这种收尾也可能是"任务其实做完了"⇒ 把预测/实际作为样本学掉（经验留住），
       * 然后清掉这轮的当下状态。
       */
      try {
        const qm = benLunQianMing(sessionId, false, providerCfg.model);
        etaHuo().xueXi(sessionId, 'ziDongXuPai', qm, etaCang());
        etaHuo().jieShuLun(sessionId);
        etaYiChang.delete(sessionId);
      } catch { /* 学习失败不影响这一轮对话 */ }
    }
    if (xiaoXi.insertMode) insertMode.set(sessionId, xiaoXi.insertMode);

    /**
     * ADR 004 第七批定稿：**项目不可用**时不可聊天（也不可在宿主侧执行这一轮）。
     *  - 容器开发项目：容器没启动 ⇒ 不可用（等同创建者下线）；
     *  - 任何项目：被创建者**停用** ⇒ 不可用；
     *  - **本机开发且未被停用**的项目、以及「我的牛马」⇒ 直接放行（含探测都不做，不误伤）。
     * 历史记录仍然可读（`historyReadable: true` 一并回给渲染层）。
     */
    const KaiFaJuJue = await projectUnavailableFor(sessionId);
    if (KaiFaJuJue) {
      fachuKongzhitai({ cat: 'system', code: 'container.project.unavailable', data: { sessionId, projectCode: KaiFaJuJue.projectCode } });
      return {
        ok: false,
        reply: '',
        code: KaiFaJuJue.code,
        projectCode: KaiFaJuJue.projectCode,
        reasonKey: KaiFaJuJue.reasonKey,
        fix: KaiFaJuJue.fix,
        // 成员侧看到的就是"创建者下线"那一套（同一个文案键）
        memberFaceKey: 'group.memberOffline',
        hostExecutionRefused: true,
        historyReadable: true,
      };
    }

    // 写入侧 CCR
    const yiYaSuo = ccr.beforeLog({ kind: 'message', content: xiaoXi.content });
    metrics.recordCcr({
      ts: Date.now(),
      kind: 'message',
      originalBytes: yiYaSuo.originalBytes,
      compressedBytes: yiYaSuo.compressedBytes,
    });
    // 用户开口了（含点「继续/重试」发出的续传指令）⇒ 清掉「从哪一步断的」标记
    try { etaHuo().qingZhongDuan(sessionId); } catch { /* noop */ }
    // 日志只追加（不变量 #1）：先写入记忆服务，拿到**真实 recordId + seq** 再落日志，
    // 这样指针里的 retrieve(recordId=…)/retrieve(seq=…) 真的能回到这条原文。
    // recordId 只在写入成功时才挂到日志（失败时宁缺勿假：死 id 会让模型白跑一轮工具）。
    const userRecordId = xinLiaoTianJiLuId('m');
    let userMemSeq: number | undefined;
    const shiNeiBuCaiDan = !!(xiaoXi as { internal?: boolean }).internal;
    if (yiJingXieGuo(sessionId, 'user', yiYaSuo.content)) {
      try { audit?.log('chat.dup-write-skipped', { sessionId, role: 'user', chars: yiYaSuo.content.length }); } catch { /* noop */ }
    } else if (!shiNeiBuCaiDan) {
      try {
        userMemSeq = memSeqOf(
          await memory?.append(
            {
              id: userRecordId,
              sessionId,
              kind: 'message',
              // role 一并落 JSONL（SQLite 投影查不到它，但 JSONL 才是事实来源；
              // 重建时先用 recordId 前缀，将来有读 JSONL 的 IPC 就能直接用这个字段）
              role: 'user',
              ti: yiYaSuo.content,
              groupId: sessionId,
              entityType: 'chat',
            },
            'duty'
          )
        );
      } catch {
        /* optional */
      }
    }
    zhuiJiaLiaoTianRiZhi(sessionId, {
      seq: xiaYiLiaoTianXuLie(userMemSeq),
      role: 'user',
      content: yiYaSuo.content,
      recordId: userMemSeq !== undefined ? userRecordId : undefined,
      ts: Date.now(),
      /**
       * **内部指令不进聊天记录**（真事故：用户看到聊天里冒出一段自己没说过的话）。
       * 自动续派的「继续执行计划…」只是给模型的工单，要进上下文、但界面不显示。
       */
      hidden: shiNeiBuCaiDan,
    });

    await baozhangGongyingshangMiyao();
    /**
     * **决策模型**真用起来（详见 fenLeiPanDing）：
     * 紧急度还是默认 P2 时，先让决策模型判一下这句是急/一般/省着用。
     */
    let jueCeJinJiDu = (xiaoXi.moXingJueCe && xiaoXi.moXingJueCe.urgency) || 'P2';
    if (jueCeJinJiDu === 'P2') {
      jueCeJinJiDu = await fenLeiPanDing(String(xiaoXi.content || ''));
    }
    /**
     * 「智能选模型」：显式 > 牛马默认 > 调用链+紧急度 > 角色表 > 兜底（见 model-pick.ts）
     * **先**定模型，再按模型找它所属的供应商 —— 否则用 Ollama 的模型会撞上
     * 「当前生效供应商没配密钥」的误报（真事故）。
     *
     * 只从**真能跑**的模型里挑（供应商已配 Key 或是 Ollama）——
     * 真事故：挑到没密钥的 deepseek-chat ⇒ 报「未配置 API Key」，而 Ollama 明明有可用模型。
     */
    const keYongMoXing = await lieKeYongMoXing();
    const yiShiBai: string[] = [];
    let jueCe: ReturnType<typeof jueCeMoXing> | null = null;
    let modelId = '';
    let an: MoXingGongYingXinXi | null = null;
    let zhu: MoXingGongYingXinXi = {
      presetId: providerCfg.presetId,
      baseURL: providerCfg.baseURL || '',
      protocol: providerCfg.protocol,
      apiKey: providerCfg.apiKey || '',
      biaoQian: providerCfg.presetId,
    };
    /**
     * **自动降级**：按调用链逐个试 —— 挑中的模型不可用（没 Key / 不存在）或本轮已失败，
     * 就换下一个，直到有能跑的；**整条链（全部可用模型）都试完**才如实报错。
     * 上限 = 可用模型数 + 2（兜底/角色还能落一两次），不再写死 3/8。
     */
    const zuiDaLun = Math.max(4, keYongMoXing.length + 2, (xiaoXi.moXingJueCe && xiaoXi.moXingJueCe.chain || []).length + 2);
    for (let lun = 0; lun < zuiDaLun; lun++) {
      jueCe = jueCeMoXing({
        explicit: xiaoXi.model,
        ...(xiaoXi.moXingJueCe || {}),
        // 决策模型判过的紧急度优先于界面默认 P2
        urgency: jueCeJinJiDu,
        roles: roleModels,
        fallback: providerCfg.model || 'deepseek-chat',
        keYongMoXing,
        tiaoGuo: yiShiBai,
      });
      modelId = jueCe.model;
      if (yiShiBai.includes(modelId) && yiShiBai.length >= Math.max(1, keYongMoXing.length)) break;
      an = await jieMoXingGongYingShang(modelId);
      zhu = an || {
        presetId: providerCfg.presetId,
        baseURL: providerCfg.baseURL || '',
        protocol: providerCfg.protocol,
        apiKey: providerCfg.apiKey || '',
        biaoQian: providerCfg.presetId,
      };
      // 能跑 = 有 Key 或 Ollama
      if (zhu.apiKey || zhu.protocol === 'ollama') break;
      yiShiBai.push(modelId);
      audit?.log('chat.model-degraded', { sessionId, model: modelId, reason: 'no-key', provider: zhu.presetId });
      if (!keYongMoXing.length) break;
    }
    if (!jueCe) {
      jueCe = { model: providerCfg.model || 'deepseek-chat', why: 'fallback', chainIndex: -1 };
      modelId = jueCe.model;
    }
    if (!zhu.apiKey && zhu.protocol !== 'ollama') {
      const reply = tMain('llm.noKey') + xiaoXi.content.slice(0, 80)
        + `\n（本轮模型 ${modelId} 属于供应商「${zhu.biaoQian}」，该家尚未配置 API Key；Ollama 无需密钥，其它供应商请在「设置 → 模型」里填 Key。）`;
      zhuiJiaLiaoTianRiZhi(sessionId, {
        seq: xiaYiLiaoTianXuLie(),
        role: 'assistant',
        content: reply,
        recordId: xinLiaoTianJiLuId('a'),
        ts: Date.now(),
      });
      return { ok: true, reply, usage: null, needsKey: true };
    }

    const qiShiShiJian = Date.now();
    benLunGongJuMing = [];
    let zuiHouCuo = '';
    /**
     * **调用失败自动降级**：把**整条调用链 / 全部可用模型**都试完（不是只试 3 个）——
     * 一个挂了换下一个，直到链上没有可换的才如实报错。
     */
    for (let shi = 0; shi < zuiDaLun; shi++) {
    try {
      const provider = congYuSheChuangJian(zhu.presetId, {
        apiKey: zhu.apiKey,
        baseURL: zhu.baseURL || undefined,
        protocol: zhu.protocol,
      } as never, zhu.protocol);
      audit?.log('chat.model-picked', { sessionId, model: modelId, why: jueCe.why, chainIndex: jueCe.chainIndex, urgency: (xiaoXi.moXingJueCe && xiaoXi.moXingJueCe.urgency) || '', provider: zhu.presetId, protocol: zhu.protocol });
      // 思考级别 → 请求附加参数；模型不支持时**降级为自动**再试，并在回复开头如实标注
      const siKaoExtra = siKaoCanShu(xiaoXi.thinkLevel, xiaoXi.moXingJueCe && xiaoXi.moXingJueCe.urgency, modelId);
      let jiangJiTiShi = false;
      const baseBudget = contextBudgetChars(modelId);
      // 计划1/2：上下文超限自动收缩重试（100%→60%→35%→20%），到最小仍失败则如实停止
      const chongshi = await daiShangXiaWenChongShiYunXing(baseBudget, async (budgetChars) => {
        // 不变量 #2：注入的是日志的**有界渲染视图**，不是日志本身（ADR 002 §4/§6）
        const shitu = renderChatView(sessionId, xiaoXi.content, budgetChars);
        /**
         * **长文判定**（真事故：要 5000 字小说，只回 546 字且停在句中）：
         * 既影响输出预算（1024 → 8192），也影响给模型的指令（别提前收尾）。
         */
        const yaoChangWen = /(\d{3,6})\s*字|小说|长文|长篇|完整写|详细写|写一篇|写一份|报告|论文|剧本|方案|策划|文案|说明书|白皮书/.test(String(xiaoXi.content || ''));
        // ADR 002 §9.4 待办 2：模型可以当轮调用 recall/retrieve 把被省略的原文取回来
        /**
         * 优先级（产品定稿）：**道（dao.md）> 规矩（agents.md）> 身份/模型/时间 > 有界视图**。
         * 道是全局最高：与任何指示冲突时以道为准。
         */
        const shenFenTou: LiaoTianXiaoXi[] = [];
        const dao = duDao().trim();
        if (dao) {
          shenFenTou.push({
            role: 'system',
            content: '【道 · 全局最高优先级】\n' + dao + '\n（以上是用户的「道」：它高于其它一切指示。与任何指令、惯例或后文冲突时，一律以本段为准，冲突的指令作废。）',
          } as LiaoTianXiaoXi);
        }
        const zuiGao = duZuiGaoXinNian().trim();
        if (zuiGao) {
          shenFenTou.push({
            role: 'system',
            content: '【规矩 · 仅次于「道」】\n' + zuiGao + '\n（以上是用户的规矩：与「道」冲突时以「道」为准；与其它指示冲突时以本段为准。）',
          } as LiaoTianXiaoXi);
        }
        {
          const yongHu = dangQianYongHuMing();
          const ju = [];
          if (xiaoXi.ming) ju.push(tMain('llm.identityLine', '你是「{ming}」。').replace('{ming}', String(xiaoXi.ming)));
          // 让它知道自己跑在哪个模型上（真事故：用户问"你是哪个模型"，它说"看不清蹄子底下"）
          if (modelId) ju.push(tMain('llm.modelLine', '你当前运行在模型「{model}」上。').replace('{model}', String(modelId)));
          if (yongHu) ju.push(tMain('llm.userLine', '你的用户是「{u}」，请这样称呼他。').replace('{u}', yongHu));
          /**
           * 长文指令（真事故：用户要 5000 字小说，模型写到 546 字就停）。
           * 光调大输出预算是必要条件，还得**明确告诉它别提前收尾**。
           */
          if (yaoChangWen) {
            ju.push(tMain('llm.longForm', '用户要的是长文：请**完整写出**，不要提前收尾、不要省略、不要只给提纲或开头；篇幅按用户要求（如「N 字」）尽量写足，直到自然结束。'));
          }
          /**
           * **时间感知**（产品要求）：每次请求都带上当前时刻，模型才知道"现在几点"、
           * "过了多久"。需要更精确的时刻/联网时间时用 `get_time` 工具。
           */
          {
            const xz = new Date();
            ju.push(tMain('llm.timeLine', '当前时间是 {time}（时区 {tz}，时间戳 {epoch}）。需要精确时刻或联网时间时调用 get_time 工具；做"等待 N 秒"这类事请按时间戳算差值，不要凭感觉。')
              .replace('{time}', xz.toLocaleString())
              .replace('{tz}', Intl.DateTimeFormat().resolvedOptions().timeZone || 'local')
              .replace('{epoch}', String(xz.getTime())));
          }
          /**
           * **加强 AI 语言约束**（设置 → 语言里那个勾）：思考过程与回复都严格用界面语言。
           * 不勾时不加这段（不干涉模型自己选语言）。
           */
          try {
            const yueGe = (settingsStore?.load() as { strictAiLanguage?: boolean } | undefined)?.strictAiLanguage;
            if (yueGe) {
              const muBiaoYuYan = (settingsStore?.load() as { yuYan?: string } | undefined)?.yuYan || app.getLocale();
              const yuMing = {
                'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en-US': 'English', 'ja': '日本語',
                'ko': '한국어', 'fr': 'français', 'es': 'español', 'pt': 'português', 'ru': 'русский', 'eo': 'Esperanto',
              }[muBiaoYuYan] || muBiaoYuYan;
              const yueGeJu = tMain('llm.strictLanguage', '【语言约束】请**始终**使用{lang}作答：思考过程与正文都用{lang}，不要夹杂其他语言。').replace(/\{lang\}/g, yuMing);
              ju.push(yueGeJu);
              /**
               * 审计留痕（"这个勾到底有没有生效"必须可查 —— 真机反馈里用户就是这么问的）。
               * 只记"开没开 + 目标语言 + 注入了几字符"，不记正文。
               */
              audit?.log('chat.lang-constraint', { sessionId, on: true, lang: muBiaoYuYan, chars: yueGeJu.length });
            } else {
              audit?.log('chat.lang-constraint', { sessionId, on: false });
            }
          } catch { /* 配置坏了就不加约束 */ }
          /**
           * **多步任务先列计划**（真机反馈：这次没出现「计划任务」卡片 —— 模型自己跳过了 plan_update）。
           * 产品期望：右边栏的计划卡片要能看到步骤；这是提示层的默认行为，不是可选项。
           */
          try {
            ju.push(tMain('llm.planFirst', '【多步任务】如果这件事要做三件以上、或需要按顺序完成多个步骤，请先用 plan_update 列出步骤（id / 标题 / 状态），再逐个完成并用 plan_verify 标记验证；界面右侧的「计划任务」卡片会同步显示进度。'));
          } catch { /* noop */ }
          /**
           * **知识库触发器**（依据：Self-RAG 的「按需检索」 arXiv:2310.11511 +
           * RAG 七类失败点 arXiv:2401.05856）。
           *
           * 真实缺口：以前只挂了个 UI 的查询入口，模型侧既没有工具、也没人告诉它知识库存在，
           * 所以它**从不主动查**。这里补三件事：
           *   ① 告诉它知识库存在、现在有多少条（不给这句，它不知道有这条路）；
           *   ② 给**明确的触发条件**（不做"每轮都查"的无差别检索 —— 那会降低质量）；
           *   ③ 给**查不到时怎么办**（RAG 最常见的失败点就是"知识库里没有却硬编"）。
           */
          try {
            if (knowledge) {
              const quan = knowledge.query('');
              const shiTiShu = (quan.entities || []).length;
              const shiJianShu = (quan.events || []).length;
              if (shiTiShu + shiJianShu > 0) {
                ju.push(tMain(
                  'llm.knowledgeTrigger',
                  '【知识库】本机知识库现有 {e} 个实体、{v} 条事件（结构化事实：人/组织/项目/工具/概念 + 事件结果），' +
                    '与 recall/retrieve 的「对话原文」是两回事。\n' +
                    '**该查的四种情形**：① 用户提到某个人/项目/工具/结论，而当前上下文里找不到它的来历；' +
                    '② 你要对"以前定过的事"下结论或引用；③ 需要结构化属性（某项目的目录/某工具的用法/某人的偏好）；' +
                    '④ 用户明确问"我们以前是不是说过/记过"。\n' +
                    '**不该查**：闲聊、当前上下文已经写清楚的事、纯创作与算数。不要每轮都查。\n' +
                    '**怎么用**：先 knowledge_query("关键词")；命中就用其中的事实作答，并写明来自知识库；' +
                    '**没命中就如实说"知识库里没有这条"**，绝不拿猜测当事实 —— 然后如值得沉淀，用 knowledge_add 记下来。'
                ).replace('{e}', String(shiTiShu)).replace('{v}', String(shiJianShu)));
              }
            }
          } catch { /* 拿不到知识库就不加这段（不影响正常对话） */ }
          /**
           * **能力声明**（真机反馈：模型说「我没有权限操作你的桌面文件系统」「我无法计时」，
           * 可是 write_file / make_pptx / open_path / run_shell / wait_seconds 就在工具表里，
           * 一个都没调）。
           *
           * 这不是"没暴露工具"（审计里 `chat.tools.enabled` 列了全部），是**模型不知道自己有工具**。
           * 所以必须在提示里**逐个点名**，并明确禁止"说自己做不到"。
           */
          try {
            ju.push(tMain(
              'llm.toolCapability',
              '【能力清单】你可以**真的**做到下面这些事，用工具即可：' +
                '写文件（write_file）、建 Word（make_docx）、建 PPT（make_pptx）、打开文件/目录（open_path / open_file）、' +
                '读文件（read_file）、列目录（list_dir）、建目录（make_dir）、跑命令（run_shell）、' +
                '取当前时间（get_time）、等待若干秒（wait_seconds）、向用户提问（ask_user）。\n' +
                '用户要求「生成文件 / 放到桌面 / 写入文档 / 打开给我看 / 等 N 秒」这类**落地动作**时，' +
                '**必须调用对应工具去完成**，再如实回报做了什么、文件在哪。\n' +
                '**绝对不要说**「我没有权限 / 我够不着 / 我无法操作 / 我无法计时 / 请你自己在本地做」—— 这是事实错误：' +
                '这些工具就在你手里。只有当某个工具调用**真的失败**时，才如实说失败原因与替代方案。'
            ));
          } catch { /* noop */ }
          if (ju.length) shenFenTou.push({ role: 'system', content: ju.join('') } as LiaoTianXiaoXi);
        }
        /**
         * 图片附件 → 多模态内容块：模型因此能**真的看到**截图/图片
         * （真事故：以前只把文件路径塞进文本，模型 read_file 到 PNG 字节 ⇒「没看出来」）。
         * 只挑图片（有 dataUrl 或扩展名像图）；单张上限 6MB，过大如实跳过并注明。
         */
        const tuKuaiJi: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
        const tiaoGuoJi: string[] = [];
        for (const a of (xiaoXi.attachments || [])) {
          const ming = String(a.name || a.path || '').trim();
          let dataUrl = String(a.dataUrl || '');
          try {
            if (!dataUrl && a.path && /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path) && fs.existsSync(a.path)) {
              const bb = fs.readFileSync(a.path);
              if (bb.length > 6 * 1024 * 1024) { tiaoGuoJi.push(ming + '（图片超过 6MB，未喂给模型）'); continue; }
              const mt = /\.jpe?g$/i.test(a.path) ? 'image/jpeg' : /\.gif$/i.test(a.path) ? 'image/gif' : /\.webp$/i.test(a.path) ? 'image/webp' : /\.bmp$/i.test(a.path) ? 'image/bmp' : 'image/png';
              dataUrl = `data:${mt};base64,${bb.toString('base64')}`;
            }
          } catch { tiaoGuoJi.push(ming + '（读取失败，未喂给模型）'); continue; }
          if (dataUrl && /^data:image\//i.test(dataUrl)) {
            if (dataUrl.length > 8 * 1024 * 1024) { tiaoGuoJi.push(ming + '（图片过大，未喂给模型）'); continue; }
            tuKuaiJi.push({ type: 'image_url', image_url: { url: dataUrl } });
          }
        }
        const yuanXiaoXiJi = [...shenFenTou, ...(shitu.xiaoXiJi as LiaoTianXiaoXi[])];
        let xiaoXiJiZui: LiaoTianXiaoXi[] = yuanXiaoXiJi;
        if (tuKuaiJi.length) {
          // 把图片块并进**最后一条用户消息**（模型看到的是"文字 + 图"）
          xiaoXiJiZui = yuanXiaoXiJi.map((m, i) => {
            if (i !== yuanXiaoXiJi.length - 1) return m;
            const yuanWen = typeof m.content === 'string' ? m.content : (m.content as Array<{ text?: string }>).map((b) => b.text || '').join('');
            const bu = [
              { type: 'text' as const, text: yuanWen + (tiaoGuoJi.length ? `\n（未喂给模型的附件：${tiaoGuoJi.join('；')}）` : '') },
              ...tuKuaiJi,
            ];
            return { ...m, content: bu };
          });
          audit?.log('chat.image-attached', { sessionId, count: tuKuaiJi.length, skipped: tiaoGuoJi.length });
        }
        /**
         * **输出预算**（真事故：用户要 5000 字小说，回复只有 546 字且**停在句中**）
         * 根因：这里硬编码 `maxTokens: 1024` —— 模型写到一半就被截断。
         * 现在：默认 4096；用户明确要长文（N 字 / 小说 / 长文 / 报告 / 论文…）时给 8192。
         */
        const shuChuShangXian = yaoChangWen ? 8192 : 4096;
        /**
         * **发给模型前必须规范化消息形状**。
         *
         * 真事故（用户报"又卡死了"）：Ollama 反复报 HTTP 400
         * `Cannot have 2 or more assistant messages at the end of the list.`
         * —— 自动续派时内部指令没落到消息列表里，历史结尾出现**连续两条 assistant**。
         * 于是请求被拒 → 模型降级到链上下一个 → 那个模型也不收工具 → 又续派 →
         * `plan.auto-continue` 在同一个 T4 上连跑 11 次，界面看起来就是死循环。
         * 修法：在**发送边界**统一收口 —— 结尾连续的 assistant 合并成一条。
         * 只改发出去的副本，**不改写进日志的原文**。
         */
        xiaoXiJiZui = guiZhengXiaoXiJiZhuang(xiaoXiJiZui);
        const jiBenQiu = {
          model: modelId,
          xiaoXiJi: xiaoXiJiZui,
          maxTokens: shuChuShangXian,
        };
        let loop: Awaited<ReturnType<typeof yunXingLiaoTianXunHuan>>;
        try {
          loop = await yunXingLiaoTianXunHuan(sessionId, provider, siKaoExtra ? { ...jiBenQiu, extra: siKaoExtra } : jiBenQiu, xiaoXi.xiaoDiShuLiang);
        } catch (e0) {
          const mo = String((e0 as Error)?.message || e0);
          /**
           * 有的端/模型不收大 max_tokens（报 400 / max_tokens / num_predict 不合法）——
           * 那就**降一档重试**，而不是把整轮打成失败。
           */
          if (/max_?tokens|num_predict|maxTokens|too large|exceed|invalid.*(token|length)|400/i.test(mo) && shuChuShangXian > 1024) {
            audit?.log('chat.max-tokens-downgraded', { sessionId, from: shuChuShangXian, error: mo.slice(0, 160) });
            try {
              loop = await yunXingLiaoTianXunHuan(sessionId, provider, { ...jiBenQiu, maxTokens: 2048 }, xiaoXi.xiaoDiShuLiang);
            } catch (e1) {
              const mo1 = String((e1 as Error)?.message || e1);
              if (/max_?tokens|num_predict|maxTokens|too large|exceed|invalid.*(token|length)|400/i.test(mo1)) {
                loop = await yunXingLiaoTianXunHuan(sessionId, provider, { ...jiBenQiu, maxTokens: 1024 }, xiaoXi.xiaoDiShuLiang);
              } else { throw e1; }
            }
          } else if (siKaoExtra && /reasoning|thinking|effort|unsupported|unknown (parameter|field)|invalid.*parameter|400/i.test(mo)) {
            jiangJiTiShi = true;
            audit?.log('chat.think-downgraded', { sessionId, level: xiaoXi.thinkLevel || 'auto', error: mo.slice(0, 160) });
            loop = await yunXingLiaoTianXunHuan(sessionId, provider, jiBenQiu, xiaoXi.xiaoDiShuLiang);
          } else {
            throw e0;
          }
        }
        /**
         * **自称做不到 ⇒ 纠正并重跑一轮完整工具循环**（真机事故：模型回「我没有权限操作你的
         * 桌面文件系统」「我无法计时」，可 write_file / make_pptx / open_path / run_shell /
         * wait_seconds 就在工具表里，本轮 `gongJuDiaoYongJi=0` —— 一个都没调）。
         *
         * 项目侧能做的就是这两件：① 提示里逐个点名能力（见 `llm.toolCapability`）；
         * ② 识别这种"无能宣称"，把能力清单**再钉一次**，并给它一次真正动手的机会
         * （走完整工具循环，不是只让它再打字）。只重试一次，避免死循环。
         */
        if (
          !!loop.tooled &&
          !Number(loop.gongJuDiaoYongJi || 0) &&
          shiJueDaiJueKou(neiRongWenBen(loop.xiangYingTi.choices[0]?.message?.content))
        ) {
          const yuanWen = neiRongWenBen(loop.xiangYingTi.choices[0]?.message?.content);
          audit?.log('chat.refusal-detected', { sessionId, model: modelId, chars: yuanWen.length });
          try {
            const jiuZheng: LiaoTianXiaoXi[] = [
              {
                role: 'system',
                content: tMain('llm.forceTools',
                  '【纠正 · 上一条回答不成立】你说自己「没有权限 / 够不着 / 无法操作 / 无法计时」—— 这是事实错误。' +
                  '你手上有这些工具，并且**可以真的**做到：write_file（写任意文件，含桌面）、make_docx、make_pptx、' +
                  'open_path / open_file（用系统默认程序打开）、read_file、list_dir、make_dir、run_shell、' +
                  'get_time（取当前时间）、wait_seconds（等待 N 秒）、ask_user。\n' +
                  '请**立即调用工具**，把用户的每一项要求真正落地：生成 txt 与 ppt → 写入内容 → 打开给用户看 → wait_seconds 等待 → 写出长文。' +
                  '全部做完后，再用文字如实汇报每一步做了什么、文件在哪。**禁止再说做不到**；只有工具调用真的失败时才报失败原因。'),
              } as LiaoTianXiaoXi,
              ...(xiaoXiJiZui as LiaoTianXiaoXi[]),
            ];
            const loop2 = await yunXingLiaoTianXunHuan(
              sessionId,
              provider,
              siKaoExtra ? { ...jiBenQiu, xiaoXiJi: jiuZheng, extra: siKaoExtra } : { ...jiBenQiu, xiaoXiJi: jiuZheng },
              xiaoXi.xiaoDiShuLiang,
            );
            const hou2 = neiRongWenBen(loop2.xiangYingTi.choices[0]?.message?.content);
            // 只有"真的动手了"或"真的吐了非拒答正文"才替换；否则保留原回复（至少如实）
            const dongShou = Number(loop2.gongJuDiaoYongJi || 0) > 0;
            if (dongShou || (youShiZhiWenBen(hou2) && !shiJueDaiJueKou(hou2))) {
              audit?.log('chat.refusal-corrected', { sessionId, model: modelId, toolsUsed: Number(loop2.gongJuDiaoYongJi || 0), from: 'retry' });
              loop = loop2;
            }
          } catch (eJ) {
            audit?.log('chat.refusal-retry-failed', { sessionId, error: xiJingCuoWu(eJ).slice(0, 160) });
          }
        }
        return { shitu, loop, budgetChars };
      });
      if (chongshi.gaveUp || !chongshi.result?.loop) {
        const msgTxt = chongshi.gaveUp || 'context-too-small';
        lastError = { ts: Date.now(), message: msgTxt, context: 'chat-send-context' };
        return {
          ok: false,
          error: msgTxt,
          contextTooSmall: true,
          retries: chongshi.retries,
          reply: tMain('chat.contextTooSmall', '该模型上下文太小，无法满足当前聊天需求（已自动收缩重试到最小值仍失败）'),
        };
      }
      const { loop } = chongshi.result;
      const xiangYing = loop.xiangYingTi;
      let reply0 = neiRongWenBen(xiangYing.choices[0]?.message?.content);
      /**
       * **空回复不再是死路**（真事故：多轮工具调用后模型没吐正文 ⇒ 界面只有「（本条回复无内容）」）。
       * 依次兜底：① 本轮工具活动合成一段如实总结；② 再要一次纯文本；③ 都不行就如实说明。
       */
      if (!youShiZhiWenBen(reply0)) {
        // 「只有标点」也走这条路（真机反馈：多出一句只有「。」的回复）
        if (String(reply0 || '').trim()) {
          audit?.log('chat.empty-reply', { sessionId, chars: String(reply0 || '').length, punctuationOnly: true, model: modelId });
        }
        reply0 = '';
      }
      if (!reply0.trim()) {
        // 从本轮工具活动合成（工具名由执行器记账，见下）
        const zhongFu = [...new Set(benLunGongJuMing)];
        if (zhongFu.length) {
          reply0 = tMain('chat.toolsDone', '本轮我调用了工具来完成这件事：') + zhongFu.join('、')
            + tMain('chat.toolsDoneTail', '。工具已执行完毕，没有额外要补充的文字说明。');
        }
      }
      if (!reply0.trim()) {
        // 再要一次纯文本答案（不带工具），逼出正文
        try {
          const zaiWen = await provider.chat({
            model: modelId,
            xiaoXiJi: [
              { role: 'system', content: tMain('llm.needText', '请用简短中文直接回答用户，不要调用工具。') },
              { role: 'user', content: xiaoXi.content.slice(0, 2000) },
            ],
            maxTokens: 512,
          });
          reply0 = neiRongWenBen(zaiWen.choices[0]?.message?.content);
        } catch { /* 重试失败就走如实说明 */ }
      }
      if (!youShiZhiWenBen(reply0)) {
        reply0 = tMain('chat.emptyReplyWhy', '本轮模型没有返回文字内容（可能是工具调用后未作说明）。请再问一次，或换个说法。');
      }
      // 思考过程：DeepSeek 等放在 message.reasoning_content，有的叫 reasoning / thinking
      const rawMsg = ((xiangYing.raw as { choices?: Array<{ message?: Record<string, unknown> }> } | undefined)?.choices?.[0]?.message) || {};
      /**
       * **provider 归一后的 message.reasoning 优先**。
       * Ollama 把思考放在 `message.thinking`（不是 reasoning_content），provider 层已折进
       * `reasoning` —— 真事故：这里只读 raw 的 reasoning_content ⇒ Ollama 的 Qwen3
       * 思考过程永远不显示。
       */
      const normMsgReasoning = (xiangYing.choices[0]?.message as { reasoning?: unknown } | undefined)?.reasoning;
      const siKaoGuoCheng = String(normMsgReasoning ?? rawMsg.reasoning_content ?? rawMsg.reasoning ?? rawMsg.thinking ?? '');
      // 思考档位被模型拒绝 ⇒ 已降级为「自动」，回复**开头**如实标注（产品要求）
      const reply = jiangJiTiShi
        ? (tMain('chat.thinkDowngraded', '【提示】该模型不支持所选思考档位，已降级为「自动」。') + '\n\n' + reply0)
        : reply0;
      metrics.recordTurn({
        sessionId,
        ts: Date.now(),
        promptTokens: xiangYing.usage.promptTokens,
        completionTokens: xiangYing.usage.completionTokens,
        cacheHitTokens: xiangYing.usage.cacheHitTokens,
        cacheMissTokens: xiangYing.usage.cacheMissTokens,
        durationMs: Date.now() - qiShiShiJian,
        /**
         * **本轮的供应商 = 真正跑这一轮的那个**（真机反馈：本地 ollama 跑出来却显示 deepseek）。
         * 以前写的是 `providerCfg.presetId`（设置里"当前生效的供应商"，默认 deepseek），
         * 而实际调用会因调用链/降级落到别的供应商上 ⇒ 归属全错。
         * `zhu` 是本轮解析出来的供应商，它才是事实。
         */
        providerId: String((zhu as { presetId?: string } | undefined)?.presetId || providerCfg.presetId || ''),
        providerName: String((zhu as { biaoQian?: string } | undefined)?.biaoQian || ''),
        model: modelId || xiaoXi.model || providerCfg.model,
      });
      const replyRecordId = xinLiaoTianJiLuId('a');
      let replyMemSeq: number | undefined;
      const replyChongFu = yiJingXieGuo(sessionId, 'assistant', reply);
      if (replyChongFu) {
        // 重复写入：**连会话日志也不写**（只留第一次），避免界面上出现两条一模一样的回复
        try { audit?.log('chat.dup-write-skipped', { sessionId, role: 'assistant', chars: reply.length }); } catch { /* noop */ }
        return {
          ok: true,
          reply,
          reasoning: siKaoGuoCheng || undefined,
          thinkDowngraded: jiangJiTiShi || undefined,
          usage: xiangYing.usage,
          needsKey: false,
          moXing: modelId,
          gongYingShang: zhu.biaoQian || zhu.presetId,
          xuanZeYuanYin: jueCe.why,
          tools: {
            requested: !!loop.tooled,
            diaoYongJi: loop.gongJuDiaoYongJi,
            lunShu: loop.lunShu,
            qingQiuJi: loop.qingQiuJi,
            degraded: loop.degraded,
            tingZhiYuanYin: loop.tingZhiYuanYin,
          },
        };
      }
      try {
        replyMemSeq = memSeqOf(
          await memory?.append(
            // 与日志正文**一致**地落盘：之前这里 slice(0,4000)，会让 retrieve(recordId) 只能回到前 4000 字符，
            // 而日志里是全量 —— 两份真相不一致，等于长回复的尾巴取不回来（不丢细节的前提是两边同一份内容）。
            { id: replyRecordId, sessionId, kind: 'message', role: 'assistant', ti: reply, groupId: sessionId, entityType: 'chat' },
            'duty'
          )
        );
      } catch {
        /* optional */
      }
      zhuiJiaLiaoTianRiZhi(sessionId, {
        seq: xiaYiLiaoTianXuLie(replyMemSeq),
        role: 'assistant',
        content: reply,
        reasoning: siKaoGuoCheng || undefined,
        recordId: replyMemSeq !== undefined ? replyRecordId : undefined,
        ts: Date.now(),
        moXing: modelId || undefined,
        /** **续派回合合并进上一条**（一次对话 = 一条回复） */
        mergeWithPrev: !!(xiaoXi as { internal?: boolean }).internal,
      });
      if (knowledge && reply.length > 0) {
        knowledge.upsertEntity({
          id: 'session-' + sessionId,
          kind: 'project',
          ming: sessionId,
          attrs: {},
          anchors: [],
        });
      }
      /**
       * **多循环自动继续**：判据在 `yingGaiZiDongJiXu()` 里 ——
       *   · 计划里还有 `pending`/`doing`；**或**
       *   · 这一轮**零工具调用**却在"宣告下一步"（真机诊断出的正是这种"只说不做"）。
       *
       * ⚠️ **内部轮次（自动续派）不再自己再往下派** —— 否则会和 `yanXuJiHuaRenWu`
       * 的递归**同时**各派一次（真事故：日志里同一指令出现两遍、模型收到两次同样的工单）。
       * 续派的调度**只由 `yanXuJiHuaRenWu` 负责**。
       */
      const shiNeiBu = !!(xiaoXi as { internal?: boolean }).internal;
      /**
       * **对话轮**这一类行为的两把尺子：这一轮墙钟耗时 + 模型请求次数。
       * 到点 ⇒ 走完整判断流程；判"没卡死"就加一档继续，判异常就把这轮回复换成"已停下"的说明。
       */
      if (!shiNeiBu) {
        try {
          const haoShi = Date.now() - qiShiShiJian;
          const jie = await chaXingWei({
            xingWei: 'duiHua', sessionId, moXing: modelId,
            shiJiMs: haoShi, ciShu: loop.qingQiuJi,
            qianMing: benLunQianMing(sessionId, false, modelId),
            jieDuan: `对话轮：本轮耗时 ${shuoShiChang(haoShi)}、模型请求 ${loop.qingQiuJi} 次`,
            zhongLei: haoShi >= xingWeiGui('duiHua').miao ? 'shiJian' : 'ciShu',
          });
          if (jie.yiChang) {
            const wen = etaYiChangHuiFu(sessionId, 'duiHua', jie.liYou);
            zhuiJiaLiaoTianRiZhi(sessionId, { seq: xiaYiLiaoTianXuLie(), role: 'assistant', content: wen, ts: Date.now() });
            return {
              ok: true, reply: wen, reasoning: siKaoGuoCheng || undefined, usage: xiangYing.usage,
              needsKey: false, moXing: modelId, gongYingShang: zhu.biaoQian || zhu.presetId, xuanZeYuanYin: jueCe.why,
              etaStopped: true,
              tools: { requested: !!loop.tooled, diaoYongJi: loop.gongJuDiaoYongJi, lunShu: loop.lunShu, qingQiuJi: loop.qingQiuJi, degraded: loop.degraded, tingZhiYuanYin: loop.tingZhiYuanYin },
            };
          }
        } catch { /* 守卫出错不许影响正常回复 */ }
      }
      // **自动续派是否还要接着跑**：渲染层据此决定"这一轮是不是真的完了"
      let planPending = false;
      if (!shiNeiBu && yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, { diaoYongJi: loop.gongJuDiaoYongJi, huiFu: reply }).jiXu) {
        planPending = true;
        stoppedSessions.delete(sessionId); // 新一轮续派前清掉旧的停止标记
        setTimeout(() => {
          void yanXuJiHuaRenWu(sessionId, xiaoXi as never, { diaoYongJi: loop.gongJuDiaoYongJi, huiFu: reply });
        }, 250);
      } else if (!shiNeiBu) {
        yanXuZhuangTai.delete(sessionId);
        // **整轮真的结束了** ⇒ 把流式"正在进行"的气泡收掉
        try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
      }
      return {
        ok: true,
        planPending,
        reply,
        reasoning: siKaoGuoCheng || undefined,
        thinkDowngraded: jiangJiTiShi || undefined,
        usage: xiangYing.usage,
        needsKey: false,
        /** 本轮**实际调用的模型与供应商**（产品要求：模型的调用必须清晰可见） */
        moXing: modelId,
        gongYingShang: zhu.biaoQian || zhu.presetId,
        xuanZeYuanYin: jueCe.why,
        /** 工具调用观测（渲染层可据此展示"本轮调用了 retrieve/recall"） */
        tools: {
          requested: !!loop.tooled,
          diaoYongJi: loop.gongJuDiaoYongJi,
          lunShu: loop.lunShu,
          qingQiuJi: loop.qingQiuJi,
          degraded: loop.degraded,
          tingZhiYuanYin: loop.tingZhiYuanYin,
        },
      };
    } catch (e) {
      const err = xiJingCuoWu(e);
      zuiHouCuo = err;
      // 这一档模型失败 ⇒ 记下它，换下一个再来（不直接把错误丢给用户）
      yiShiBai.push(modelId);
      audit?.log('chat.model-degraded', { sessionId, model: modelId, reason: err.slice(0, 120), provider: zhu.presetId });
      const xiaYiGe = jueCeMoXing({
        explicit: xiaoXi.model,
        ...(xiaoXi.moXingJueCe || {}),
        urgency: jueCeJinJiDu,
        roles: roleModels,
        fallback: providerCfg.model || 'deepseek-chat',
        keYongMoXing,
        tiaoGuo: yiShiBai,
      });
      if (!xiaYiGe || !xiaYiGe.model || xiaYiGe.model === modelId || yiShiBai.includes(xiaYiGe.model)) break;
      const an2 = await jieMoXingGongYingShang(xiaYiGe.model);
      const zhu2 = an2 || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
      if (!zhu2.apiKey && zhu2.protocol !== 'ollama') continue;
      jueCe = xiaYiGe; modelId = xiaYiGe.model; an = an2; zhu = zhu2;
      continue;
    }
    break;
    }
    if (zuiHouCuo) {
      lastError = { ts: Date.now(), message: zuiHouCuo, context: 'chat-send' };
      fachuKongzhitai({ cat: 'error', code: 'err.chat-send', data: { sessionId, message: zuiHouCuo } });
      // 模型调用失败 ⇒ 任务停在半路：界面在最新回复里挂「继续 / 重试」
      biaoRenWuZhongDuan(sessionId, '模型调用失败（整条调用链都试过了）', zuiHouCuo, '模型调用');
      return { ok: false, reply: '', error: zuiHouCuo, needsKey: false, retry: true };
    }
    // 兜底：整条链跑完既没成功也没留错（理论上不该走到，但类型必须闭合）
    biaoRenWuZhongDuan(sessionId, '模型调用失败（没有可用模型）', 'no-model-available', '模型调用');
    return { ok: false, reply: '', error: 'no-model-available', needsKey: false, retry: true };
}
chuliIpc('warmy:liaoTianFaSong', zhenZhengFaSong);

/**
 * **多循环任务自动继续**（产品缺陷修复：模型说"接着做下一个"然后就停了）。
 *
 * 真机诊断（2026-10-05）：模型这一轮**一个工具都没调**（`gongJuDiaoYongJi: 0`、
 * `tingZhiYuanYin: 'stop'`），只回了一句"接下来我会做 X"，工具循环就收工了 ——
 * 根本没有下一轮。所以"看到只说不做就接着派一轮"和"计划里还有步骤就接着派"同样重要。
 *
 * 继续的判据（任一成立）：
 *   · 计划里还有 `pending`/`doing` 步骤；
 *   · 这一轮**零工具调用**，而回复在"宣告下一步"（接下来/下一步/然后我/我将…）——
 *     且这轮是被要求做多步活（用户原话含任务/步骤/逐个/依次/完成…）或本来就在续派中。
 *
 * **预警上限**（不是硬上限，产品要求）：
 *   到达次数/时间预警点时，**请模型判一次是否卡死**（优先用正在干活的模型；
 *   无响应不马上认定卡死，换模型再试，**云模型优先**、本地兜底，5 次都失败才算没响应）。
 *   · 判「没卡死」⇒ **预警点翻倍**，继续跑，不打扰用户；
 *   · 判定卡死 / 分析超时 / 5 次都没响应 ⇒ 当异常处理：停下并发出警告。
 */
const YANXU_YUJING_CI = 40;                          // 首次次数预警：40 次自动继续
const YANXU_YUJING_SHIJIAN_MS = 20 * 60 * 1000;      // 首次时间预警：20 分钟
const KASI_PAN_CHAOSHI_MS = 90 * 1000;               // 单次卡死分析超时：90 秒
const KASI_CHANGSHI = PAN_MO_XING_SHANG_XIAN;        // 分析最多换 5 个模型（= 产品要求的 5 次上限）

/**
 * **两个文件，各司其职**（产品要求分开，别混在一起）：
 *   · 持久 `userData/eta.json`      —— 预测**方法库**（跨会话复用、越用越准）
 *   · 临时 `userData/eta-live.json` —— **本轮**状态（第几次超时、上次/本次预计完成时间戳）
 *
 * 为什么必须分开：方法库是"资产"（删了就把学到的经验丢了），本轮状态是"账本"
 * （一轮结束就该清掉，否则下一次判断会读到上一轮的超时次数 ⇒ 误判异常）。
 */
let etaZhangBen: EtaZhangBen | null = null;
let etaLinShi: EtaLinShi | null = null;
function etaWenJian(): string {
  try { return path.join(app.getPath('userData'), 'eta.json'); } catch { return ''; }
}
function etaLinShiWenJian(): string {
  try { return path.join(app.getPath('userData'), 'eta-live.json'); } catch { return ''; }
}
export function etaCang(): EtaZhangBen {
  if (!etaZhangBen) etaZhangBen = new EtaZhangBen(etaWenJian());
  return etaZhangBen;
}
export function etaHuo(): EtaLinShi {
  if (!etaLinShi) etaLinShi = new EtaLinShi(etaLinShiWenJian());
  return etaLinShi;
}
export function etaBaCun(): void {
  try { etaZhangBen?.baCun(); } catch { /* noop */ }
  try { etaLinShi?.baCun(); } catch { /* noop */ }
}
/** 本轮任务的**签名**（预测经验按它聚类；只用与工作量相关的稳定特征） */
function benLunQianMing(sessionId: string, zhiShuoBuZuo: boolean, moXing?: string): string {
  const bu = (jiHuaRenWuJi.get(sessionId) || []).length;
  return renWuQianMing({ buShu: bu, gongJuMing: benLunGongJuMing, zhiShuoBuZuo, moXing });
}

/** 行为名（给用户看的；审计与聊天里都用它，避免各处各写一套说法） */
function xingWeiMing(x: XingWei): string {
  return tMain(`eta.xw.${x}`, xingWeiGui(x).ming);
}

/**
 * **这个牛马自己的模型调用链**（渲染层把 `state.instances` 存进了设置文件）。
 * 判断"卡死/超时"要换模型时，先按它换（产品要求），换不到再用云端/本地兜底。
 * 链上被禁用的模型不参与（禁用是用户的明确表态）。
 */
function lianMingOf(sessionId: string): string[] {
  try {
    const s = settingsStore?.load() as { instances?: Array<{ id?: string; ming?: string; name?: string; chain?: unknown; chainDisabled?: unknown }> } | undefined;
    const lie = Array.isArray(s?.instances) ? s!.instances! : [];
    const sid = String(sessionId || '');
    const cur = lie.find((x) => x && (String(x.id || '') === sid || String(x.ming || '') === sid || String(x.name || '') === sid));
    if (!cur) return [];
    const lian = Array.isArray(cur.chain) ? (cur.chain as unknown[]).map((x) => String(x || '')).filter(Boolean) : [];
    const jin = Array.isArray(cur.chainDisabled) ? new Set((cur.chainDisabled as unknown[]).map((x) => String(x || ''))) : new Set<string>();
    return lian.filter((m) => m && !jin.has(m));
  } catch { return []; }
}

/**
 * **判定出"异常"后要在这一轮里拦住后续动作**的标记。
 * 判异常时正在跑的那一步没法"回溯取消"，但**下一轮续派/下一个工具必须停**。
 */
const etaYiChang = new Map<string, { xingWei: XingWei; liYou: string; at: number }>();
/** 判异常的那段话每个会话只说一次（续派递归会反复经过这里） */
const yiShuoGuo = new Set<string>();
function biaoEtaYiChang(sessionId: string, xingWei: XingWei, liYou: string): void {
  etaYiChang.set(String(sessionId || ''), { xingWei, liYou, at: Date.now() });
  biaoRenWuZhongDuan(sessionId, liYou, 'eta-anomaly', xingWeiMing(xingWei));
}

/**
 * **任务被异常打断**（卡死/闪退/超时/超限/模型调用失败…）⇒ 让界面在**牛马的最新回复里**
 * 挂一个「继续 / 重试」按钮：点了先分析原因、规避/修复，再接着做；
 * 用户若直接发了新对话且 AI 已收到，按钮会变灰失效（渲染层负责）。
 */
function biaoRenWuZhongDuan(sessionId: string, why: string, error?: string, jieDuan?: string): void {
  try {
    // 记进临时账本：续传时能说清「从哪一步断的」，不是只说"被打断了"
    try {
      etaHuo().jiZhongDuan(sessionId, {
        jieDuan: String(jieDuan || '').slice(0, 200),
        why: String(why || '').slice(0, 200),
        error: error ? String(error).slice(0, 200) : undefined,
      });
    } catch { /* 账本写不进去不影响广播 */ }
    broadcastToWindows('warmy:jiHuaHuiFu', {
      sessions: [String(sessionId || '')],
      sessionId: String(sessionId || ''),
      why: String(why || '').slice(0, 300),
      error: String(error || '').slice(0, 300),
      jieDuan: String(jieDuan || '').slice(0, 200),
    });
    audit?.log('plan.task-interrupted', { sessionId, why: String(why || '').slice(0, 160), error: String(error || '').slice(0, 160), jieDuan: String(jieDuan || '').slice(0, 120) });
  } catch { /* 广播失败不影响主流程 */ }
}
function quEtaYiChang(sessionId: string): { xingWei: XingWei; liYou: string; at: number } | null {
  const v = etaYiChang.get(String(sessionId || ''));
  return v && Date.now() - v.at < 30 * 60 * 1000 ? v : null;   // 30 分钟前的旧标记不清算旧账
}

/**
 * **按持久文件里的方法预测**；没有方法就请模型自己预测（模型给了就用模型的），
 * 最后兜到该类行为的**首次固定值**。**每一步都如实标注来源**，不编数字。
 */
function etaYuCeBingJiLu(
  sessionId: string,
  x: XingWei,
  qianMing: string,
  jie: { eta: EtaYuCe | null; etaRaw: number | null; etaJiShi: string; by: string },
): { yu: EtaYuCe; laiYuan: EtaYuCe['laiYuan'] } {
  // ① 模型自己给了 ⇒ 以它为准（方法库只当参考，不当替身）
  if (jie.eta) return { yu: jie.eta, laiYuan: 'model' };
  // ② 模型没给 ⇒ 用持久文件里这类行为/这类任务的方法
  const anFangFa = etaCang().yuCeByFangFa(x, qianMing);
  if (anFangFa) {
    const rec = etaHuo().jiYuCe(sessionId, x, { etaMs: anFangFa.etaMs, genJu: anFangFa.genJu, laiYuan: 'fangFa' });
    audit?.log('plan.eta-predict', { sessionId, xingWei: x, laiYuan: 'fangFa', etaMs: rec.etaMs, qianMing });
    return { yu: rec, laiYuan: 'fangFa' };
  }
  // ③ 连方法都没有（第一次遇到这类行为）⇒ 首次固定值；这一次跑完就会长出方法
  const gui = xingWeiGui(x);
  const rec = etaHuo().jiYuCe(sessionId, x, { etaMs: gui.miao, genJu: `首次固定值（${gui.ju}）`, laiYuan: 'moren' });
  audit?.log('plan.eta-predict', { sessionId, xingWei: x, laiYuan: 'moren', etaMs: rec.etaMs, qianMing });
  return { yu: rec, laiYuan: 'moren' };
}

/**
 * **行为级的"时间到 / 次数到 ⇒ 判一次"**（产品需求的核心执行点）。
 *
 * 顺序严格按需求：
 *   ① 看**临时文件**：这个行为在本轮有没有"上次预测的完成时间" ⇒ 与当前时间比，超了就把次数 +1；
 *      同一轮累计 3 次超出 ⇒ **直接判异常，不再问模型**；
 *   ② 没到 3 次 ⇒ **请模型判一次**（优先行为正在用的模型 → 该牛马调用链 → 5 个都没反应即异常）；
 *   ③ 判"没卡死" ⇒ 重新预测完成时间（模型给 → 持久文件的方法 → 首次固定值），
 *      预警点加一档、临时文件写下"第几次 + 新的完成时间戳"；判"卡死" ⇒ 异常。
 *
 * 返回值只报告"要不要停"，**不杀正在跑的东西**（那一步无法回溯取消）：真正拦住的是后续动作。
 */
async function chaXingWei(o: {
  xingWei: XingWei;
  sessionId: string;
  moXing?: string;
  /** 这一步实际耗时（毫秒）—— 与预警点比较 */
  shiJiMs: number;
  /** 本轮的次数（例如第几轮工具 / 第几次尝试 / 第几轮续派） */
  ciShu: number;
  qianMing: string;
  /** 触发说明（写进审计与聊天，例如"单次工具调用 read_file 耗时 92 秒"） */
  jieDuan: string;
  /** 这次是因为什么触发（时间到还是次数到） */
  zhongLei: 'shiJian' | 'ciShu';
}): Promise<{ ting: boolean; yiChang: boolean; liYou: string; yu: EtaYuCe | null; chaoShiCiShu: number }> {
  const { xingWei: x, sessionId, moXing, shiJiMs, ciShu, qianMing, jieDuan, zhongLei } = o;
  try {
    const w = etaHuo().xingWei(sessionId, x);
    // 没到预警点：什么都不做（这是绝大多数情况，绝不给用户添噪音）
    if (shiJiMs < w.yuJingMiao && ciShu < w.yuJingLun) return { ting: false, yiChang: false, liYou: '', yu: null, chaoShiCiShu: w.chaoShiCiShu };

    etaHuo().jiZhongLei(sessionId, x, zhongLei);
    audit?.log('plan.eta-limit-hit', {
      sessionId, xingWei: x, zhongLei, shiJiMs, ciShu, yuJingMiao: w.yuJingMiao, yuJingLun: w.yuJingLun, qianMing,
    });

    // ① 先看临时文件（上一轮/本轮已经超了几次）
    const chao = etaHuo().panChaoShi(sessionId, x);
    if (chao.shiZong) {
      // "应存在却查不到"——临时状态丢过，如实记线索，不假装没发生
      audit?.log('plan.eta-live-missing', { sessionId, xingWei: x, jiYouChaoShiCiShu: chao.ciShu });
    }
    if (chao.yiChang) {
      const liYou = tMain('eta.anomalyOverrun', '同一轮里「{xw}」已经 {n} 次超出模型自己给出的预计完成时间')
        .replace('{xw}', xingWeiMing(x)).replace('{n}', String(chao.ciShu));
      fachuKongzhitai({ cat: 'error', code: 'err.eta-anomaly', data: { sessionId, xingWei: x, ciShu: chao.ciShu, why: 'overrun-3' } });
      audit?.log('plan.eta-anomaly', { sessionId, xingWei: x, ciShu: chao.ciShu, why: 'overrun-3', qianMing });
      biaoEtaYiChang(sessionId, x, liYou);
      return { ting: true, yiChang: true, liYou, yu: null, chaoShiCiShu: chao.ciShu };
    }

    // ② 请模型判一次（它自己之前的预测 + 持久文件里的方法都给它）
    const jie = await panDuanKaSi(sessionId, String(moXing || providerCfg.model || ''), jieDuan, qianMing, x);
    if (jie.stalled) {
      const liYou = tMain('eta.anomalyStalled', '模型判定「{xw}」卡住了：{reason}').replace('{xw}', xingWeiMing(x)).replace('{reason}', jie.reason || '未给出理由');
      fachuKongzhitai({ cat: 'error', code: 'err.eta-anomaly', data: { sessionId, xingWei: x, ciShu: chao.ciShu, why: 'stalled', by: jie.by } });
      audit?.log('plan.eta-anomaly', { sessionId, xingWei: x, ciShu: chao.ciShu, why: 'stalled', by: jie.by, qianMing });
      biaoEtaYiChang(sessionId, x, liYou);
      return { ting: true, yiChang: true, liYou, yu: null, chaoShiCiShu: chao.ciShu };
    }

    // ③ 没卡死 ⇒ 重新预测 + 预警点加一档 + 更新临时文件
    const { yu, laiYuan } = etaYuCeBingJiLu(sessionId, x, qianMing, jie);
    const dang = etaHuo().jiaYiDang(sessionId, x);
    try {
      zhuiJiaLiaoTianRiZhi(sessionId, {
        seq: xiaYiLiaoTianXuLie(),
        role: 'assistant',
        system: true,
        content: tMain('eta.continueWithEta', '（{xw} 已到预警点（{why}），模型判断"没卡死"，继续；它预计还需 {eta} 完成。预警点已放宽到 {miao} / {lun}。）')
          .replace('{xw}', xingWeiMing(x))
          .replace('{why}', jieDuan)
          .replace('{eta}', shuoShiChang(yu.etaMs))
          .replace('{miao}', shuoShiChang(dang.yuJingMiao))
          .replace('{lun}', String(dang.yuJingLun))
          + (laiYuan === 'model' ? '' : tMain('eta.notFromModel', '（这个预计值不是模型给的：{ju}）').replace('{ju}', yu.genJu)),
        ts: Date.now(),
      });
    } catch { /* 写不进聊天也不影响继续 */ }
    return { ting: false, yiChang: false, liYou: '', yu, chaoShiCiShu: chao.ciShu };
  } catch (e) {
    audit?.log('plan.eta-check-fail', { sessionId, xingWei: x, error: xiJingCuoWu(e).slice(0, 160) });
    return { ting: false, yiChang: false, liYou: '', yu: null, chaoShiCiShu: 0 };
  }
}

/** 判异常后写给用户的话（一处生成，别各处各写一套） */
function etaYiChangHuiFu(sessionId: string, x: XingWei, liYou: string): string {
  return tMain('eta.anomalyStop', '⚠️ 【已停下 · 按异常处理】{liYou}。\n'
    + '这一类行为本轮已到上限，程序**不再继续往下走**：请看一眼进度（右栏「计划任务」/「文件产物」），'
    + '确认是任务真的比预计复杂得多，还是卡住了；然后回一句话我就接着做。')
    .replace('{liYou}', liYou);
}

interface YanXuZhuangTai {
  yanXu: number;          // 已经自动继续了几次
  ciYuJing: number;       // 次数预警点（每次判「没卡死」就翻倍）
  kaiShi: number;         // 本轮任务开始时间
  shiJianYuJing: number;  // 时间预警点（毫秒；同样翻倍）
}
const yanXuZhuangTai = new Map<string, YanXuZhuangTai>();
/**
 * **用户主动停止**的会话：续派循环每一步都查这个集合，一旦命中就不再往下派。
 * 以前停止按钮只杀实例进程，续派 `setTimeout` 还会照跑 ⇒ "停不下来"。
 */
const stoppedSessions = new Set<string>();
/**
 * **取消信号**（用户反馈"停止功能还是不行，无法让会话内的 AI 停止工作"）。
 *
 * 真缺陷：`provider.chat(Qiu, signal)` **本来就收 AbortSignal**（见 providers/types.ts），
 * 但主进程从头到尾**一个信号都没传过** —— 点「停止」只置了一个标志位，
 * 而在途的那次 HTTP 请求照跑照写回，所以看起来"停不下来"。
 * 这里给每个会话一个 AbortController：点停止就 abort，配套标志位继续拦后续轮次。
 */
const quXiaoZhong = new Map<string, AbortController>();
function xinHaoGuo(sessionId: string): AbortSignal {
  const k = String(sessionId || '');
  let c = quXiaoZhong.get(k);
  if (!c || c.signal.aborted) {
    c = new AbortController();
    quXiaoZhong.set(k, c);
  }
  return c.signal;
}
function zhongZhiXinHao(sessionId: string): void {
  const k = String(sessionId || '');
  try { quXiaoZhong.get(k)?.abort(); } catch { /* noop */ }
  quXiaoZhong.delete(k);
}

function yanXuTai(sessionId: string): YanXuZhuangTai {
  let t = yanXuZhuangTai.get(sessionId);
  if (!t) {
    t = { yanXu: 0, ciYuJing: YANXU_YUJING_CI, kaiShi: Date.now(), shiJianYuJing: YANXU_YUJING_SHIJIAN_MS };
    yanXuZhuangTai.set(sessionId, t);
  }
  return t;
}

function jiHuaHuanYouBuWeiBu(sessionId: string): JiHuaBu | null {
  const bu = jiHuaRenWuJi.get(sessionId) || [];
  return bu.find((x) => x.status === 'pending' || x.status === 'doing') || null;
}

/** 「只说不做」的措辞：模型在宣告下一步却没动手 */
const ZHISHUO_BUZUO = /(接下来|下一步|然后我|接着我|我将|我会继续|即将|开始执行|继续完成|依次完成|now i(?:'| a| wi)ll|next,? i|let me (?:now )?|i will (?:now )?)/i;
/** 用户这轮要的是"多步活"（不是普通一问一答） */
const DUOBU_YAOQIU = /(任务|步骤|计划|逐个|依次|全部|都做|完成这些|一步一步|分步|流程|清单|todo|task|step|plan)/i;

/**
 * 这一轮要不要自动接着派。
 * @param shangLun 上一轮的工具循环结果（用来判"零工具调用"）
 */
function yingGaiZiDongJiXu(
  sessionId: string,
  xiaoXi: { content?: string },
  shangLun?: { diaoYongJi?: number; huiFu?: string },
): { jiXu: boolean; liYou: string } {
  /** 已经判过异常 ⇒ **一步都不许再往下走**（用户回一句话才会清掉这个标记） */
  if (quEtaYiChang(sessionId)) return { jiXu: false, liYou: 'eta-anomaly' };
  if (jiHuaHuanYouBuWeiBu(sessionId)) return { jiXu: true, liYou: 'plan-pending' };
  const t = yanXuZhuangTai.get(sessionId);
  const yiZaiXu = !!t && t.yanXu > 0;
  const lingGongJu = !shangLun || !shangLun.diaoYongJi;
  const shangLunHuiFu = String(shangLun?.huiFu || '');
  const yaoDuoBu = DUOBU_YAOQIU.test(String(xiaoXi.content || '')) || yiZaiXu;
  if (lingGongJu && yaoDuoBu && ZHISHUO_BUZUO.test(shangLunHuiFu)) {
    return { jiXu: true, liYou: 'talk-only' };
  }
  return { jiXu: false, liYou: 'done' };
}

/**
 * **判卡死 + 要一个预计完成时间**。
 * 选模型顺序：正在干活的那个 → 云模型（有 Key 的非 ollama）→ 本地模型（ollama）。
 * 每个模型给 `KASI_PAN_CHAOSHI_MS`；**无响应不马上认定卡死**，换下一个；5 次都失败才算没响应。
 *
 * 预计完成时间（ETA）：
 *   · 提问里带上**它自己本轮写过的历次预测**（含"超了没"）、同类任务的经验统计、
 *     以及本轮已经跑了多久 —— 让它能自我修正（越写越准）；
 *   · 模型没给 / 给得不合法时不硬编：退到统计推算（标注 `history`/`default`），
 *     并如实告诉用户这个数不是模型给的。
 */
async function panDuanKaSi(
  sessionId: string,
  dangQianMoXing: string,
  jieDuan: string,
  qianMing: string,
  xingWei: XingWei = 'ziDongXuPai',
): Promise<{ stalled: boolean; by: string; reason: string; eta: EtaYuCe | null; etaRaw: number | null; etaJiShi: string }> {
  const bu = jiHuaRenWuJi.get(sessionId) || [];
  const qingDan = bu.length ? bu.map((x) => `${x.id} ${x.title} [${x.status}]`).join('\n') : '（没有显式计划）';
  const jinJi = (chatLogs.get(sessionId) || []).slice(-8).map((e) => `${e.role}: ${String(e.content || '').slice(0, 160)}`).join('\n');
  /**
   * 两块参考信息（产品要求"参考它自己之前写的"+"用持久文件里的方法预测"）：
   *   · 临时文件：**本轮**它自己写过的历次预测（含"超了没、还差多久"）
   *   · 持久文件：**这类行为**的历史方法（中位/90 分位/偏移系数/命中率）
   */
  const canKaoHuo = etaHuo().canKaoWenBen(sessionId, xingWei);
  const canKaoFangFa = etaCang().canKaoWenBen(xingWei, qianMing);
  const gui = xingWeiGui(xingWei);
  const yiYong = (() => {
    const h = etaHuo().huiHua(sessionId);
    return shuoShiChang(h ? Date.now() - h.kaiShi : 0);
  })();
  const wen = `这是一个正在自动执行的任务。现在触发了**预警**（${jieDuan}）。

【正在判断的行为】${xingWeiMing(xingWei)}
【这一类行为的默认上限】最长等待 ${shuoShiChang(gui.miao)} / 最多 ${gui.lun} 次

【本轮已经跑了】${yiYong}

【最近对话】
${jinJi}

【计划】
${qingDan}

${canKaoHuo ? canKaoHuo + '\n\n' : ''}${canKaoFangFa}

请判断这个行为是否**卡死/在原地打转**（比如反复说同样的话、反复失败、明显没有进展），
并给出你**预计还需多久能完成**（预计完成时间）。

只输出 JSON：{"stalled":true|false,"reason":"一句话理由","etaSeconds":数字（预计还需多少秒完成；给偏保守的值）,"etaBasis":"一句话依据（你凭什么这么估）"}`;

  /**
   * 候选顺序（产品要求）：**这个行为正在用的模型** → 该牛马模型调用链里的其它模型
   * （链里显式列出的排前面） → 云端（有 Key 的非 ollama） → 本地（ollama）兜底。
   * 每个模型 `KASI_PAN_CHAOSHI_MS`；**无响应不马上判卡死**，换下一个；5 个都没反应 ⇒ 异常。
   */
  const sm = (settingsStore?.load() as { providers?: Array<{ id?: string; protocol?: string; models?: unknown[] }> } | undefined)?.providers || [];
  const yun: string[] = [];
  const benDi: string[] = [];
  for (const p of sm) {
    const ids = (p.models || []).map((m) => String(typeof m === 'string' ? m : (m as { id?: string })?.id || '')).filter(Boolean);
    if (String(p.protocol || '') === 'ollama') benDi.push(...ids);
    else if (await jiexiGongyingshangMiyao(String(p.id || ''))) yun.push(...ids);
  }
  const houXuan: string[] = [];
  const jia = (m: string) => {
    const s = String(m || '').trim();
    // 只用聊天模型判卡死（whisper/tts/embed 这类只会回错误或空答，白白吃掉名额）
    if (s && !houXuan.includes(s) && shiLiaoTianMoXing(s)) houXuan.push(s);
  };
  jia(dangQianMoXing);                       // ① 正在用的那个模型
  for (const m of lianMingOf(sessionId)) jia(m);   // ② 这个牛马的调用链
  yun.forEach(jia);                          // ③ 云端
  benDi.forEach(jia);                        // ④ 本地兜底（一定排在云之后）

  const changGuo: string[] = [];
  /** 有回应但没给结论（≠ 没反应）；与"压根没回应"分开记账 */
  let huiDaDanPanBuChu = 0;
  let genBenMeiHuiDa = 0;
  for (const mo of houXuan.slice(0, KASI_CHANGSHI)) {
    changGuo.push(mo);
    try {
      const an = await jieMoXingGongYingShang(mo);
      if (!an || (!an.apiKey && an.protocol !== 'ollama')) { genBenMeiHuiDa += 1; continue; }
      const p = congYuSheChuangJian(an.presetId, { apiKey: an.apiKey, baseURL: an.baseURL || undefined, protocol: an.protocol } as never, an.protocol);
      const r = await Promise.race([
        p.chat({ model: mo, xiaoXiJi: [{ role: 'user', content: wen }], maxTokens: 240 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('analysis-timeout')), KASI_PAN_CHAOSHI_MS)),
      ]);
      const txt = neiRongWenBen((r as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content) || '';
      const jie = jieXiKaPanDuan(txt);
      if (jie.stalled === null) {
        // 有回应但判不出结论（话没说清/格式怪）⇒ 换下一个；**不等于卡死**
        huiDaDanPanBuChu += 1;
        audit?.log('plan.stall-analysis-badreply', { sessionId, by: mo, panBuChu: true });
        continue;
      }
      const stalled = jie.stalled;
      const etaMs = jie.etaSeconds == null ? null : jiaEtaMiao(jie.etaSeconds);
      audit?.log('plan.stall-analysis', {
        sessionId, by: mo, stalled, attempt: changGuo.length,
        /** 只记结构化事实：给了多久、有没有给 —— 不记正文 */
        etaSeconds: etaMs === null ? null : Math.round(etaMs / 1000),
        etaGiven: etaMs !== null,
      });
      return {
        stalled,
        by: mo,
        reason: jie.reason || '',
        etaRaw: etaMs,
        etaJiShi: jie.etaBasis || '',
        /** 模型给了就先记进**临时文件**（"参考自己之前写的"那本账）；没给由调用方按方法库/首次值兜 */
        eta: etaMs === null
          ? null
          : etaHuo().jiYuCe(sessionId, xingWei, { etaMs, genJu: (jie.etaBasis || '').slice(0, 200), laiYuan: 'model', moXing: mo }),
      };
    } catch (e) {
      genBenMeiHuiDa += 1;
      audit?.log('plan.stall-analysis-fail', { sessionId, by: mo, error: xiJingCuoWu(e).slice(0, 120) });
    }
  }
  /**
   * **收尾语义**（产品要求对"5 个模型都没有反应"的解释）：
   *   · **压根没反应**（超时/报错/没 Key）一个都没有 ⇒ 异常（stalled）；
   *   · **有回应但判不出结论** ⇒ **不能当成卡死**（那是我们解析不了，不是用户的任务坏了）
   *     ⇒ 判"没卡死"继续跑，并如实记账，让下一次判断能被看见。
   */
  if (huiDaDanPanBuChu > 0) {
    audit?.log('plan.stall-analysis-unparseable', { sessionId, huiDaDanPanBuChu, genBenMeiHuiDa, changGuo: changGuo.length });
    return {
      stalled: false,
      by: '',
      reason: `no-conclusion（${huiDaDanPanBuChu} 个模型有回应但判不出结论；不视为卡死，继续跑）`,
      eta: null, etaRaw: null, etaJiShi: '',
    };
  }
  return { stalled: true, by: '', reason: `no-response（试过 ${changGuo.length} 个模型都没有反应）`, eta: null, etaRaw: null, etaJiShi: '' };
}



async function yanXuJiHuaRenWu(sessionId: string, xiaoXi: Parameters<typeof zhenZhengFaSong>[1], shangLun?: { diaoYongJi?: number; huiFu?: string }): Promise<void> {
  try {
    // **用户已点停止** ⇒ 一步都不再派（真事故：停止按钮按了，AI 还在继续干活）
    if (stoppedSessions.has(sessionId)) {
      audit?.log('plan.auto-continue-stopped', { sessionId });
      yanXuZhuangTai.delete(sessionId);
      etaHuo().jieShuLun(sessionId);
      try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: false, ts: Date.now() }); } catch { /* noop */ }
      try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
      return;
    }
    const pan = yingGaiZiDongJiXu(sessionId, xiaoXi as { content?: string }, shangLun);
    const dangQian0 = String((xiaoXi as { model?: string }).model || providerCfg.model || '');
    const qianMing0 = benLunQianMing(sessionId, pan.liYou === 'talk-only', dangQian0);
    if (!pan.jiXu) {
      /**
       * 这一轮**真的收尾了**（没有下一步可接着做）⇒ 学习时机：
       * 把"最后一次预计完成时间 vs 实际总耗时"作为样本写进**持久文件的方法库**，
       * 同类任务的下一次预测就有自己的历史（越用越准）；然后清掉**临时文件**里这一轮。
       */
      try {
        const xue = etaHuo().xueXi(sessionId, 'ziDongXuPai', qianMing0, etaCang());
        if (xue.xueLe) {
          audit?.log('plan.eta-learn', { sessionId, xingWei: 'ziDongXuPai', qianMing: xue.qianMing, shiJiMs: xue.shiJiMs, mingZhong: xue.mingZhong });
        }
      } catch { /* 学习失败不影响收尾 */ }
      // 判过异常：把"为什么停"如实说一次（然后不再续派）
      if (pan.liYou === 'eta-anomaly') {
        const yi = quEtaYiChang(sessionId);
        if (yi && !yiShuoGuo.has(sessionId)) {
          yiShuoGuo.add(sessionId);
          zhuiJiaLiaoTianRiZhi(sessionId, {
            seq: xiaYiLiaoTianXuLie(), role: 'assistant',
            content: etaYiChangHuiFu(sessionId, yi.xingWei, yi.liYou), ts: Date.now(),
          });
        }
        yanXuZhuangTai.delete(sessionId);
        try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: false, ts: Date.now() }); } catch { /* noop */ }
        try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
        return;
      }
      etaHuo().jieShuLun(sessionId);
      etaYiChang.delete(sessionId);
      yiShuoGuo.delete(sessionId);
      yanXuZhuangTai.delete(sessionId);
      // **整轮真的结束了** ⇒ 关动态小字、收流式气泡
      try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: false, ts: Date.now() }); } catch { /* noop */ }
      try { broadcastToWindows('warmy:suiXingPianDuan', { sessionId, reasoning: '', content: '', end: true, ts: Date.now() }); } catch { /* noop */ }
      return;
    }

    /**
     * **自动续派**受"多步自动续派任务"这一类行为的两把尺子约束：
     *   · 时间：本轮累计工作时长 vs 预警点（首次 20 分钟，判"没卡死"加一档）
     *   · 次数：已续派几次 vs 预警点（首次 40 次，判"没卡死"加一档）
     * 到点就走 `chaXingWei` 的完整流程（临时文件 → 3 次异常 → 模型判断 → 重新预测）。
     */
    const w = etaHuo().xingWei(sessionId, 'ziDongXuPai');
    const tai = yanXuTai(sessionId);
    const yongShi = Date.now() - w.gengXinTs > 0 ? Date.now() - etaHuo().huiHua(sessionId).kaiShi : Date.now() - tai.kaiShi;
    if (tai.yanXu + 1 >= w.yuJingLun || yongShi >= w.yuJingMiao) {
      const ciShuDao = tai.yanXu + 1 >= w.yuJingLun;
      const jieDuan = ciShuDao
        ? `自动续派次数到点（已续 ${tai.yanXu} 次，预警点 ${w.yuJingLun} 次）`
        : `自动续派时间到点（已连续工作 ${Math.round(yongShi / 60000)} 分钟，预警点 ${shuoShiChang(w.yuJingMiao)}）`;
      const jie = await chaXingWei({
        xingWei: 'ziDongXuPai', sessionId, moXing: dangQian0,
        shiJiMs: yongShi, ciShu: tai.yanXu + 1, qianMing: qianMing0, jieDuan,
        zhongLei: ciShuDao ? 'ciShu' : 'shiJian',
      });
      if (jie.yiChang) {
        zhuiJiaLiaoTianRiZhi(sessionId, {
          seq: xiaYiLiaoTianXuLie(), role: 'assistant',
          content: etaYiChangHuiFu(sessionId, 'ziDongXuPai', jie.liYou), ts: Date.now(),
        });
        // （`biaoEtaYiChang` 里已经广播了「继续/重试」，这里不再重复）
        etaHuo().jieShuLun(sessionId);
        yanXuZhuangTai.delete(sessionId);
        return;
      }
      // 判"没卡死"⇒ 预警点已在 chaXingWei 里加了一档，这里同步既有的次数预警点
      tai.ciYuJing = Math.max(tai.ciYuJing + YANXU_YUJING_CI, w.yuJingLun);
      tai.shiJianYuJing = Math.max(tai.shiJianYuJing + YANXU_YUJING_SHIJIAN_MS, w.yuJingMiao);
      tai.kaiShi = Date.now();
    }

    tai.yanXu += 1;
    const bu = jiHuaRenWuJi.get(sessionId) || [];
    const qingDan = bu.length ? bu.map((x) => `${x.id} ${x.title} [${x.status}]`).join('\n') : '（没有显式计划：请自己判断还剩哪些没做完）';
    const xia = jiHuaHuanYouBuWeiBu(sessionId);
    const zhiLing = pan.liYou === 'talk-only'
      ? tMain('llm.continueNoAction', '【继续执行】你上一条**只说了要做什么，没有真的调用工具**。请现在**直接调用工具**把它做掉，做完再简短汇报；不要说"接下来我会…"就停。')
      : tMain('llm.planContinue', '【继续执行计划】请接着完成下一步（用工具真的去干，不要只说要做）。完成后用 plan_verify 标记验证，再继续下一步。');
    audit?.log('plan.auto-continue', { sessionId, why: pan.liYou, step: xia ? xia.id : '', n: tai.yanXu });
    /**
     * **续派期间动态小字要一直亮着**（真事故：主轮 `deliver` 收尾把小字关了，
     * 而续派还在跑 ⇒ 界面像"已经结束"，其实 AI 还在干活）。
     * 一直亮到**整轮真的结束**才关（在 `!pan.jiXu` 分支里关）。
     */
    try { broadcastToWindows('warmy:yunXingZhuangTai', { sessionId, kai: true, ts: Date.now() }); } catch { /* noop */ }
    const r = await zhenZhengFaSong(undefined, {
      ...xiaoXi,
      /** 内部指令：进模型上下文，但**不出现在聊天记录**里 */
      internal: true,
      content: zhiLing + (xia ? `\n\n【下一步】${xia.id} ${xia.title}` : '') + `\n\n【当前计划/进度】\n${qingDan}\n\n（这是系统自动接着派的一轮，不需要等我说话。）`,
    } as never);
    // **不再在这里关小字** —— 整轮结束才关（否则每步之间小字会闪"干完了"）
    if (!r || r.ok !== true) {
      zhuiJiaLiaoTianRiZhi(sessionId, {
        seq: xiaYiLiaoTianXuLie(),
        role: 'assistant',
        content: tMain('llm.planContinueFail', '（自动继续下一步时出错，已停下。）') + '\n' + String((r && (r as { error?: string }).error) || ''),
        ts: Date.now(),
      });
      biaoRenWuZhongDuan(sessionId, tMain('llm.planContinueFail', '（自动继续下一步时出错，已停下。）'), String((r && (r as { error?: string }).error) || ''), '计划续派');
      etaHuo().jieShuLun(sessionId);   // 出错中止：不当作"完成"，不进学习样本
      return;
    }
    // 递归接着派（判据会在每轮重新算）
    const xiaLun = (r as { tools?: { diaoYongJi?: number } }).tools || {};
    await yanXuJiHuaRenWu(sessionId, xiaoXi, { diaoYongJi: xiaLun.diaoYongJi, huiFu: String((r as { reply?: string }).reply || '') });
  } catch (e) {
    audit?.log('plan.auto-continue-fail', { sessionId, error: xiJingCuoWu(e).slice(0, 160) });
    biaoRenWuZhongDuan(sessionId, tMain('llm.planContinueFail', '（自动继续下一步时出错，已停下。）'), xiJingCuoWu(e).slice(0, 160), '计划续派');
    try { etaHuo().jieShuLun(sessionId); } catch { /* noop */ }
    yanXuZhuangTai.delete(sessionId);
  }
}

/**
 * ── 一键导出 / 导入配置（`.NM`，带口令） ──────────────────────────────
 * 产品定稿：导出时设口令；导入必须给对口令；格式是**我们专有的 `.NM`**。
 * 导入两种模式：
 *   · **全新开始**：把当前配置文件全部删掉，再灌入导入包（界面要二次确认）；
 *   · **合并配置**：与当前配置合并，**有冲突的逐项问用户**要本地还是导入的。
 */
const NM_PEIZHI_WENJIAN = [
  'settings.json', 'profile.json', 'groups.json', 'plans.json',
  'router-queues.json', 'ui-queues.json', 'scheduled-tasks.json',
];
function daBaoDangQianPeizhi(): Record<string, unknown> {
  const root = app.getPath('userData');
  const out: Record<string, unknown> = {};
  for (const f of NM_PEIZHI_WENJIAN) {
    try {
      const p = path.join(root, f);
      if (fs.existsSync(p)) out[f] = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* 单个坏了不拖垮整包 */ }
  }
  // 身份（私钥）也一并备份 —— 换机/重装后能找回同一个身份
  try {
    const idDir = path.join(root, 'identity');
    if (fs.existsSync(idDir)) {
      const hun: Record<string, unknown> = {};
      for (const n of fs.readdirSync(idDir)) {
        try { hun[n] = fs.readFileSync(path.join(idDir, n), 'utf8'); } catch { /* skip */ }
      }
      if (Object.keys(hun).length) out['__identity__'] = hun;
    }
  } catch { /* skip */ }
  return out;
}

chuliIpc('warmy:peiZhiDaoChu', async (_e, p0?: { password?: string; defaultName?: string }) => {
  try {
    const pw = String(p0?.password || '');
    if (!pw) return { ok: false, error: 'need-password（导出必须设置口令）' };
    if (pw.length < 4) return { ok: false, error: 'weak-password（口令至少 4 位）' };
    const payload = daBaoDangQianPeizhi();
    const wenBen = daBaoNm('config', payload, pw, { app: 'wamy', version: yingyongBanben(), files: Object.keys(payload) });
    const r = await dialog.showSaveDialog({
      title: tMain('nm.exportTitle', '导出配置'),
      defaultPath: String(p0?.defaultName || `WArmy-配置-${new Date().toISOString().slice(0, 10)}.NM`).replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'WArmy 配置', extensions: ['NM', 'nm'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
    fs.writeFileSync(r.filePath, wenBen, 'utf8');
    audit?.log('config.export', { path: r.filePath, files: Object.keys(payload).length });
    return { ok: true, path: r.filePath, files: Object.keys(payload).length };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** 导入前先看信封（不需口令）：这是什么包、什么时候导的、有哪些文件 */
chuliIpc('warmy:peiZhiXinFeng', (_e, p0?: { text?: string; path?: string }) => {
  try {
    let text = String(p0?.text || '');
    if (!text && p0?.path) text = fs.readFileSync(String(p0.path), 'utf8');
    const xin = duXinFeng(text);
    if (!xin) return { ok: false, error: 'bad-format（不是 WArmy 的 .nm 文件，或文件已损坏）' };
    return { ok: true, kind: xin.kind, createdAt: xin.createdAt, meta: xin.meta || {} };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** 冲突预览：哪些配置项本地与导入包不一致（合并模式要逐项问用户） */
function suanPeizhiChongTu(bao: Record<string, unknown>): Array<{ wenJian: string; jian: string; benDi: string; daoRu: string }> {
  const root = app.getPath('userData');
  const chongTu: Array<{ wenJian: string; jian: string; benDi: string; daoRu: string }> = [];
  for (const [f, v] of Object.entries(bao)) {
    if (f === '__identity__') continue;
    let benDi: unknown = null;
    try {
      const p = path.join(root, f);
      if (fs.existsSync(p)) benDi = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* 本地坏 = 冲突 */ }
    const a = JSON.stringify(benDi ?? null);
    const b = JSON.stringify(v ?? null);
    if (a === b) continue;
    if (benDi && typeof benDi === 'object' && v && typeof v === 'object' && !Array.isArray(benDi) && !Array.isArray(v)) {
      const o1 = benDi as Record<string, unknown>;
      const o2 = v as Record<string, unknown>;
      for (const k of new Set([...Object.keys(o1), ...Object.keys(o2)])) {
        const s1 = JSON.stringify(o1[k] ?? null);
        const s2 = JSON.stringify(o2[k] ?? null);
        if (s1 !== s2) {
          chongTu.push({
            wenJian: f,
            jian: k,
            benDi: s1.length > 120 ? s1.slice(0, 120) + '…' : s1,
            daoRu: s2.length > 120 ? s2.slice(0, 120) + '…' : s2,
          });
        }
      }
    } else {
      chongTu.push({
        wenJian: f,
        jian: '*',
        benDi: a.length > 120 ? a.slice(0, 120) + '…' : a,
        daoRu: b.length > 120 ? b.slice(0, 120) + '…' : b,
      });
    }
  }
  return chongTu;
}

chuliIpc('warmy:peiZhiDaoRu', (_e, p0?: { text?: string; path?: string; password?: string; mode?: 'fresh' | 'merge'; xuanZe?: Record<string, 'local' | 'import'> }) => {
  try {
    let text = String(p0?.text || '');
    if (!text && p0?.path) text = fs.readFileSync(String(p0.path), 'utf8');
    const mode = p0?.mode === 'fresh' ? 'fresh' : 'merge';
    const ming = chaiBaoNm(text, String(p0?.password || ''));
    if (ming.kind !== 'config') return { ok: false, error: 'bad-kind（这不是配置包，是' + ming.kind + '包）' };
    const bao = (ming.payload || {}) as Record<string, unknown>;
    const root = app.getPath('userData');
    /**
     * **全新开始**：先把现有配置文件全部删掉，再灌入导入包（界面必须二次确认）。
     * **合并**：逐项比对，冲突按 `xuanZe` 里用户的决定处理；没给决定的**默认保留本地**（不瞎覆盖）。
     */
    if (mode === 'fresh') {
      for (const f of NM_PEIZHI_WENJIAN) {
        try { fs.rmSync(path.join(root, f), { force: true }); } catch { /* noop */ }
      }
    }
    const xuan = p0?.xuanZe || {};
    const yiYingYong: string[] = [];
    for (const [f, v] of Object.entries(bao)) {
      if (f === '__identity__') {
        try {
          const idDir = path.join(root, 'identity');
          fs.mkdirSync(idDir, { recursive: true });
          for (const [n, s] of Object.entries((v || {}) as Record<string, unknown>)) {
            fs.writeFileSync(path.join(idDir, n), String(s), 'utf8');
          }
          yiYingYong.push(f);
        } catch { /* skip */ }
        continue;
      }
      const p = path.join(root, f);
      if (mode === 'fresh') {
        try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); yiYingYong.push(f); } catch { /* skip */ }
        continue;
      }
      // 合并：本地没有 ⇒ 直接写；有且不同 ⇒ 看用户怎么选（没选 = 保留本地）
      let benDi: unknown = null;
      try { if (fs.existsSync(p)) benDi = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 视为没有 */ }
      if (benDi === null) {
        try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); yiYingYong.push(f); } catch { /* skip */ }
        continue;
      }
      const xuanZe = xuan[f] || xuan['*'];
      if (xuanZe !== 'import') continue;   // 默认保留本地
      // 用户选了「用导入的」：对象做键级合并（导入的覆盖本地）
      if (benDi && typeof benDi === 'object' && v && typeof v === 'object' && !Array.isArray(benDi) && !Array.isArray(v)) {
        const he = { ...(benDi as Record<string, unknown>), ...(v as Record<string, unknown>) };
        try { fs.writeFileSync(p, JSON.stringify(he, null, 2), 'utf8'); yiYingYong.push(f); } catch { /* skip */ }
      } else {
        try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); yiYingYong.push(f); } catch { /* skip */ }
      }
    }
    audit?.log('config.import', { mode, files: yiYingYong.length });
    return { ok: true, mode, applied: yiYingYong, chongTu: mode === 'merge' ? suanPeizhiChongTu(bao) : [] };
  } catch (e) {
    // 口令错 / 包坏：**如实报错**，绝不半解、绝不覆盖
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 冲突预览（合并导入前调一次，界面据此弹窗逐项问） */
chuliIpc('warmy:peiZhiChongTu', (_e, p0?: { text?: string; path?: string }) => {
  try {
    let text = String(p0?.text || '');
    if (!text && p0?.path) text = fs.readFileSync(String(p0.path), 'utf8');
    const xin = duXinFeng(text);
    if (!xin) return { ok: false, error: 'bad-format' };
    // 信封只给预览；真正解密放到导入那步（这里不需要口令，也就不能给内容）
    return { ok: true, kind: xin.kind, createdAt: xin.createdAt, meta: xin.meta || {}, note: 'need-password-for-details' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/**
 * **导出项目**（产品要求）：把该项目的**全部内容**打包成一个 `.nm` ——
 * 聊天记录、产出的文件、计划进度、项目配置…一次带走。**不加密**，这样
 * 我们内置的 `read_nm` 工具能直接读给 AI 看（产品要求：AI 要能查看 .nm 了解内容）。
 */
chuliIpc('warmy:xiangMuDaoChu', async (_e, p0?: { sessionId?: string; kind?: 'project' | 'chat' }) => {
  try {
    const sid = String(p0?.sessionId || '');
    if (!sid) return { ok: false, error: 'need-sessionId' };
    const kind: 'project' | 'chat' = p0?.kind === 'chat' ? 'chat' : 'project';
    const root = app.getPath('userData');
    const payload: Record<string, unknown> = {
      sessionId: sid,
      ming: sessionMingOf(sid),
      exportedAt: Date.now(),
      // 聊天记录（只追加日志的这一份 = 唯一事实来源）
      chat: (chatLogs.get(sid) || []).map((e) => ({ seq: e.seq, role: e.role, content: e.content, ts: e.ts, moXing: e.moXing })),
    };
    if (kind === 'project') {
      // 计划进度
      payload['plans'] = jiHuaRenWuJi.get(sid) || [];
      // 项目属性（看板/门禁/记忆）
      try { payload['project'] = groupStore?.projectOf(sid) || null; } catch { payload['project'] = null; }
      try { payload['memory'] = readProjectMemory(groupStore, sid); } catch { payload['memory'] = ''; }
      // 产出的工作区文件（文本类直接内联；二进制只记路径与大小）
      const ws = workspaceDirOf(root, sid);
      const wenJian: Array<{ path: string; bytes: number; ts: number; inline?: string }> = [];
      try {
        const zou = (dir: string, ceng = 0) => {
          if (ceng > 4 || wenJian.length >= 200) return;
          let ems: string[] = [];
          try { ems = fs.readdirSync(dir, { withFileTypes: true }).map((x) => x.name); } catch { return; }
          for (const n of ems) {
            const p = path.join(dir, n);
            let st: fs.Stats; try { st = fs.statSync(p); } catch { continue; }
            if (st.isDirectory()) { zou(p, ceng + 1); continue; }
            const rel = path.relative(ws, p);
            const item: { path: string; bytes: number; ts: number; inline?: string } = { path: rel, bytes: st.size, ts: st.mtimeMs };
            // 小文本直接带上内容，AI 打开 .nm 就能读到
            if (st.size < 64 * 1024 && /\.(txt|md|json|ts|js|py|csv|yml|yaml|html|css)$/i.test(n)) {
              try { item.inline = fs.readFileSync(p, 'utf8'); } catch { /* skip */ }
            }
            wenJian.push(item);
          }
        };
        zou(ws);
      } catch { /* skip */ }
      payload['files'] = wenJian;
      payload['workspace'] = ws;
    }
    const wenBen = daBaoNm(kind, payload, '', { app: 'wamy', version: yingyongBanben(), sessionId: sid, ming: sessionMingOf(sid) });
    const r = await dialog.showSaveDialog({
      title: kind === 'project' ? tMain('nm.exportProject', '导出项目') : tMain('nm.exportChat', '导出聊天'),
      defaultPath: `${sessionMingOf(sid).replace(/[\\/:*?"<>|]/g, '_')}-${kind === 'project' ? '项目' : '聊天'}-${Date.now()}.nm`,
      filters: [{ name: 'WArmy 包', extensions: ['nm', 'NM'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
    fs.writeFileSync(r.filePath, wenBen, 'utf8');
    audit?.log('project.export', { sessionId: sid, kind, path: r.filePath });
    return { ok: true, path: r.filePath, kind, files: (payload['files'] as unknown[] | undefined)?.length || 0 };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** **内置查看 `.nm`**（产品要求：AI 要能直接读 .nm 了解内容）。明文包直接给内容；加密包要口令。 */
chuliIpc('warmy:nmYueDu', (_e, p0?: { path?: string; text?: string; password?: string }) => {
  try {
    let text = String(p0?.text || '');
    if (!text && p0?.path) text = fs.readFileSync(String(p0.path), 'utf8');
    const xin = duXinFeng(text);
    if (!xin) return { ok: false, error: 'bad-format（不是 WArmy 的 .nm 文件）' };
    if (!String(xin.data || '').startsWith('plain.') && !p0?.password) {
      return { ok: false, needPassword: true, kind: xin.kind, meta: xin.meta, error: 'need-password（这是加密包，需要口令）' };
    }
    const ming = chaiBaoNm(text, String(p0?.password || ''));
    return { ok: true, kind: ming.kind, createdAt: ming.createdAt, meta: ming.meta, payload: ming.payload };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 检查点 ──
/**
 * ADR 004 §7.6（第八批）：**回退点 = 文件 + 环境指纹**。
 * 分层（别想当然）：
 *   · 文件回退 = 现有回退点机制（git / shadow-git / CoW），**不依赖容器**；没有容器也必须有回退点；
 *   · 环境回退 = 容器镜像 / 快照（commit），**快照覆盖不到** bind mount 进来的项目文件；
 *   · 增益：每个回退点顺便记下当时的**环境指纹**（运行时 + 我们镜像表的 digest 快照），
 *     这样"回退了代码但环境变了"能被提前告知，而不是等跑不起来才发现。
 */
function currentEnvFingerprint(groupId: string): { jiHuo: boolean; runtimeId: string; revision: string; at: number; imageDigests: Record<string, string> } {
  const qunId = String(groupId || '');
  const runtimeId = qunId ? quXiangMuYunXingShi(qunId) : '';
  const isContainer = !!qunId && quXiangMuKaiFaHuanJing(qunId) === 'container' && !!runtimeId;
  const imageDigests: Record<string, string> = {};
  for (const tuPian of CONTAINER_BASE_IMAGES) if (tuPian.digest) imageDigests[tuPian.ref] = tuPian.digest;
  if (!isContainer) return { jiHuo: false, runtimeId: '', revision: 'host', at: Date.now(), imageDigests: {} };
  const revision = crypto.createHash('sha256').update(JSON.stringify({ runtimeId, imageDigests })).digest('hex').slice(0, 12);
  return { jiHuo: true, runtimeId, revision, at: Date.now(), imageDigests };
}
/** 把当前环境指纹挂到刚建的回退点上（缺容器开发信息时如实记 host，不编） */
function recordCheckpointEnv(cpId: string, groupId?: string): void {
  try {
    if (!cpId || !settingsStore) return;
    const fp = currentEnvFingerprint(String(groupId || ''));
    const s = settingsStore.load();
    const m = { ...((s && s.checkpointEnv) || {}) };
    m[cpId] = fp;
    settingsStore.save({ checkpointEnv: m } as never);
  } catch {
    /* 记不上就不记（宁可缺，也不编） */
  }
}
chuliIpc('warmy:checkpointChuangJian', (_e, phase: 'round_start' | 'round_end', groupId?: string) => {
  try {
    if (!checkpoints) return { ok: false };
    const jiYiMuLu = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(jiYiMuLu, 'fast-memory.jsonl');
    const cp = checkpoints.create({ phase, logSeq: Date.now(), jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined });
    recordCheckpointEnv(String((cp && cp.id) || ''), groupId);
    return { ok: true, checkpoint: cp, LieBiao: checkpoints.LieBiao(), env: currentEnvFingerprint(String(groupId || '')) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:checkpointLieBiao', (_e, payload?: { sessionId?: string }) => ({
  ok: true,
  LieBiao: checkpoints?.LieBiao() || [],
  space: checkpoints?.space() || { maxBytes: 512 * 1024 * 1024, usedBytes: 0, count: 0 },
  /** 每个回退点当时的**环境指纹**（没记过就没有 —— 不编） */
  envByCheckpoint: (settingsStore?.load()?.checkpointEnv) || {},
  /** 当前环境指纹（用来和回退点上的对比） */
  currentEnv: currentEnvFingerprint(String(payload?.sessionId || '')),
  /**
   * **分层事实**（写进响应，UI 照它说明，不许对用户声称"有容器回退点就更简单了"）：
   *   fileRollbackIndependent = true（文件回退不依赖容器，没容器也必须有回退点）
   *   snapshotCoversProjectFiles = false（commit 只快照容器可写层；bind mount 的项目文件在快照之外）
   */
  layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false, envRollbackNeedsRuntime: true },
}));

chuliIpc('warmy:checkpointHuiGun', (_e, id: string, opts?: { stopFirst?: boolean; sessionId?: string }) => {
  try {
    if (!checkpoints) return { ok: false };
    if (opts?.stopFirst) {
      void p1?.instances.stopAll();
    }
    const jiYiMuLu = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(jiYiMuLu, 'fast-memory.jsonl');
    const ok = checkpoints.rollback(id, { jsonlPath: jsonl });
    // 回退后**如实对比环境**：环境变了就提前告知（文件回退了、环境回不去）
    const jilu = (settingsStore?.load()?.checkpointEnv || {})[String(id)] || null;
    const current = currentEnvFingerprint(String(opts?.sessionId || ''));
    const envChanged = !!jilu && String(jilu.revision || '') !== String(current.revision || '');
    return {
      ok,
      env: { jilu, current, changed: envChanged, jiHuo: current.jiHuo },
      /** 文件回退成功 ≠ 环境也回退了 —— 这条一起回给渲染层，让 UI 如实提示 */
      noteKey: envChanged ? 'checkpoints.env.changed' : 'checkpoints.env.same',
    };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 知识库 ──
chuliIpc('warmy:zhiShiQuery', (_e, q: string) => {
  try {
    return { ok: true, ...(knowledge?.query(q) || { entities: [], events: [] }) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc(
  'warmy:zhiShiTianJiaShiJian',
  (_e, Shi: { id: string; biaoTi: string; entityIds?: string[]; result?: string }) => {
    knowledge?.upsertEntity({
      id: 'default',
      kind: 'project',
      ming: 'default',
      attrs: {},
      anchors: [],
    });
    knowledge?.addEvent({
      id: Shi.id,
      biaoTi: Shi.biaoTi,
      result: Shi.result,
      entityIds: Shi.entityIds || ['default'],
      anchors: [],
      ts: Date.now(),
    });
    return { ok: true };
  }
);

// ── 指令插入级别 ──
chuliIpc('warmy:sheZhiInsertMoShi', (_e, sessionId: string, mode: 'outer' | 'inner') => {
  try {
    insertMode.set(sessionId, mode);
    return { ok: true, mode };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:quInsertMoShi', (_e, sessionId: string) => ({
  ok: true,
  mode: insertMode.get(sessionId) || 'outer',
}));

// ── 指标 ──
chuliIpc('warmy:zhiBiaoJiZhaiYao', () => anQuanChuLi(() => ({ ok: true, ...metrics.summary() }), { ok: true, turns: 0, avgDurationMs: 0, promptTokens: 0, completionTokens: 0, cacheHitRate: 0, cacheHitTokens: 0, cacheMissTokens: 0, ccrOriginalBytes: 0, ccrCompressedBytes: 0, ccrRatio: 1, healthyCache: false, viewSamples: 0, viewBytes: 0, logBytes: 0, viewBudgetChars: 0, viewBytesMin: 0, viewBytesMax: 0, logEntries: 0, viewPointers: 0, viewBounded: true, gongJuDiaoYongJi: 0, toolCallsOk: 0, toolChars: 0, toolTurns: 0, toolDegradedTurns: 0, toolStopReasons: {}, toolLoopBounded: true }))
chuliIpc('warmy:zhiBiaoJiLunCi', () => anQuanChuLi(() => ({ ok: true, turns: metrics.lastTurns(20) }), { ok: true, turns: [] }))
chuliIpc('warmy:zhiBiaoJiGongJu', () => anQuanChuLi(() => ({ ok: true, diaoYongJi: metrics.lastToolCalls(50) }), { ok: true, diaoYongJi: [] }))

/**
 * 会话日志（只追加）的只读视图 —— ADR 002 §9.4 待办 4 的观测面。
 * 只回 seq / 角色 / 长度 / 摘要，不回正文（正文在记忆服务里，靠 retrieve 取）。
 */
/**
 * **会话消息正文**（跨窗口同步用）：独立会话窗与主窗口是同一个会话的两个视图，
 * 打开时都必须能读到**同一份**内容 —— 以前渲染层只有自己的内存副本，
 * 新窗口打开一片空白，这就是"新窗口和主界面记录不同步"的根因。
 * 内容一律从主进程的日志取（唯一事实来源），渲染层不自造第二份。
 */
chuliIpc('warmy:liaoTianXiaoXiJi', (_e, payload?: { sessionId?: string; limit?: number }) => {
  try {
    const sessionId = String(payload?.sessionId || '');
    if (!sessionId) return { ok: false, sessionId, xiaoXiJi: [] };
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(payload?.limit)) || 500));
    const all = chatLogs.get(sessionId) || [];
    return {
      ok: true,
      sessionId,
      count: all.length,
      xiaoXiJi: all.slice(-limit).map((e) => ({ role: e.role, text: e.content, ts: e.ts ?? null, reasoning: e.reasoning || null, system: e.system || false, moXing: e.moXing || '' })),
    };
  } catch (e2) {
    return { ok: false, sessionId: String(payload?.sessionId || ''), xiaoXiJi: [], error: xiJingCuoWu(e2) };
  }
});

/**
 * **把一条消息补写进会话日志**（渲染层在用）。
 *
 * 为什么需要：项目/群聊的消息以前只 push 在发送窗口的内存里，主进程日志是空的 ——
 * 新开的窗口因此看不到任何记录（实测：主窗口 localCount=2 而 ipcCount=0）。
 * 去重：与**最后一条**的 role+content 相同时跳过，这样单聊路径（chat-send 已记账）
 * 不会因为渲染层也补写而重复。
 */
chuliIpc('warmy:liaoTianRiZhiZhuiJia', async (_e, payload?: { sessionId?: string; role?: string; content?: string; system?: boolean; moXing?: string }) => {
  try {
    const sid = String(payload?.sessionId || '');
    // 角色归一：wo|user → user，them|assistant → assistant（旧实现只认 'wo'，
    // 传 'user' 会被错认成 assistant ⇒ 去重失效 ⇒ 同一句话两条 ⇒ 界面显示两遍）
    const role = guiYiJiaoSe(payload?.role || '');
    const content = String(payload?.content || '');
    if (!sid || !content || (role !== 'user' && role !== 'assistant')) {
      return { ok: false, appended: false, error: 'bad-payload' };
    }
    const shuZu = chatLogs.get(sid) || [];
    const last = shuZu[shuZu.length - 1];
    if (last && last.role === role && String(last.content) === content) {
      return { ok: true, appended: false, deduped: true };
    }
    /**
     * 与 chat-send **同一条账**：先落记忆 JSONL，再用它分配的 seq 写会话日志。
     * 以前这里只调 `xiaYiLiaoTianXuLie()`（本地计数），渲染层补写的条目和 JSONL 的 seq 永远对不上 ——
     * 「日志 seq ↔ JSONL seq 逐条一致」这条不变量在补写路径上是坏的（实测长回复一致性检查整段错位）。
     * 记忆服务不可用时照样补写日志（降级不改语义），只是不挂 recordId（指针宁缺勿假）。
     */
    const recordId = xinLiaoTianJiLuId(role === 'assistant' ? 'a' : 'm');
    let memSeq: number | undefined;
    // 内容级去重：主进程自己的记账路径已经写过这条 ⇒ 这里不再写第二遍（真机反馈"回复两次"）
    if (yiJingXieGuo(sid, role, content)) {
      try { audit?.log('chat.dup-write-skipped', { sessionId: sid, role, chars: content.length, from: 'chatLogAppend' }); } catch { /* noop */ }
      /**
       * **真机事故的根因就在下面这一行**（"回复两次"屡修不绝）：
       * 原来这里只跳过了**记忆 JSONL**，`zhuiJiaLiaoTianRiZhi` 依然**无条件**执行 ——
       * 而它自带的去重窗口只有 3 秒、且只比对紧邻的上一条。
       * 渲染层的这条补写只要迟到超过 3 秒（实测：审计里 `from: chatLogAppend` 命中去重，
       * 界面却还是多出一条一模一样的回复），会话日志里就会多一份 ⇒ 用户看到两条。
       *
       * 正确做法：**既然内容已经在会话日志里，就整条跳过**。
       * 但只有确认"日志里真的已经有了"才敢跳 —— 否则宁可多写一条，也绝不丢消息。
       */
      const yiZai = (chatLogs.get(sid) || []).some(
        (x) => guiYiJiaoSe(x.role) === guiYiJiaoSe(role) && String(x.content) === String(content)
      );
      if (yiZai) return { ok: true, appended: false, deduped: true };
    } else {
      try {
        memSeq = memSeqOf(
          await memory?.append({ id: recordId, sessionId: sid, kind: 'message', role, ti: content, groupId: sid, entityType: 'chat' }, 'duty')
        );
      } catch {
        /* 记忆服务不可用：日志照写，seq 走本地计数 */
      }
    }
    zhuiJiaLiaoTianRiZhi(sid, {
      seq: xiaYiLiaoTianXuLie(memSeq),
      role,
      content,
      recordId: memSeq !== undefined ? recordId : undefined,
      ts: Date.now(),
      system: payload?.system || undefined,
      moXing: payload?.moXing || undefined,
    });
    return { ok: true, appended: true };
  } catch (e3) {
    return { ok: false, appended: false, error: xiJingCuoWu(e3) };
  }
});

chuliIpc('warmy:liaoTianRiZhi', (_e, payload?: { sessionId?: string; limit?: number }) => {
  try {
    const sessionId = String(payload?.sessionId ?? '');
    const limit = Math.min(500, Math.max(1, Math.floor(Number(payload?.limit)) || 200));
    const all = chatLogs.get(sessionId) || [];
    return {
      ok: true,
      sessionId,
      count: all.length,
      entries: all.slice(-limit).map((e) => ({
        seq: e.seq,
        role: e.role,
        chars: e.content.length,
        recordId: e.recordId || null,
        digest: neirongZhaiyao(e.content),
        ts: e.ts ?? null,
      })),
      stats: {
        sessions: [...chatLogs.keys()],
        logSeq: chatLogSeq,
        restore: historyRestore,
        // 缺镜像时按需从日志派生（历史上是两份各自 push 的真相，重启后一起清零）
        historyMirror: quHuiHuaLiShi(sessionId).length,
      },
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 手动触发一次历史重建（排障/验证用；与启动路径同一函数） */
chuliIpc('warmy:liaoTianRiZhiHuiFu', async () => {
  const report = await youJiYiHuiFuHuiHuaRiZhi('ipc');
  return { ok: report.ok, restore: report, sessions: [...chatLogs.keys()], logSeq: chatLogSeq };
});

// ── 设置持久化 ──
chuliIpc('warmy:peiZhiQu', () => anQuanChuLi(() => ({ ok: true, settings: settingsStore?.load() }), { ok: true, settings: undefined }))
chuliIpc('warmy:peiZhiBaoCun', (e, partial: Record<string, unknown>) => {
  // 恢复出厂默认：清空设置文件后写回最小默认（保留 Chromium 缓存不动）
  if (partial && (partial as { restoreDefaults?: boolean }).restoreDefaults) {
    try {
      const ji = settingsStore?.reset();
      try { broadcastToWindows('warmy:peiZhiChanged', { keys: ['restoreDefaults'] }, e?.sender?.id); } catch { /* noop */ }
      return { ok: true, settings: ji, restored: true };
    } catch (err) { return { ok: false, error: xiJingCuoWu(err) }; }
  }
  const next = settingsStore?.save(partial as never);
  /**
   * **设置改动要播给其它窗口**：主界面和独立会话窗都从同一份设置渲染，
   * 一边改了主题/语言/供应商，另一边必须跟着变（"它们的选项等都应该同步"）。
   * 跳过发起方自己（它已经渲染过了）。
   */
  try { broadcastToWindows('warmy:peiZhiChanged', { keys: Object.keys(partial || {}) }, e?.sender?.id); } catch { /* noop */ }
  return { ok: true, settings: next };
});

/**
 * 计划任务（隐藏的「计划模式」）：长任务先列计划、逐个完成、逐个验证。
 * 形态按用户定稿：**任务树 T1/T1.1**、步骤可见可阻塞/恢复、进度落盘可审计、与看板对齐。
 * AI 用 plan_update 列/改步骤，plan_verify 逐个验证；卡片在第四列自动出现。
 */
type JiHuaBu = { id: string; title: string; status: 'pending' | 'doing' | 'done' | 'verified' | 'blocked'; note?: string };
const jiHuaRenWuJi = new Map<string, JiHuaBu[]>();
/**
 * 计划**落盘**（userData/plans.json）。
 * 产品要求：长任务的进度**进程退出/崩溃不得丢** —— 重启后要能检测到"还有正在跑的任务"，
 * 并让用户点「继续/重试」接着做（见 `jiHuaHuiFu` 与渲染层的恢复按钮）。
 */
function jiHuaWenJian(): string {
  try { return path.join(app.getPath('userData'), 'plans.json'); } catch { return ''; }
}
function luoPanJiHua(): void {
  const f = jiHuaWenJian();
  if (!f) return;
  try {
    anQuanYuanZiXieJson(f, {
      version: 1,
      savedAt: Date.now(),
      plans: Object.fromEntries([...jiHuaRenWuJi.entries()].map(([k, v]) => [k, v])),
    });
  } catch { /* 落盘失败不影响本次运行 */ }
}
function huiFuJiHua(): number {
  const f = jiHuaWenJian();
  if (!f) return 0;
  try {
    const snap = duJsonWenJian<{ version?: number; plans?: Record<string, JiHuaBu[]> } | null>(f, null);
    if (!snap || snap.version !== 1 || !snap.plans) return 0;
    for (const [k, v] of Object.entries(snap.plans)) {
      if (Array.isArray(v) && v.length) jiHuaRenWuJi.set(k, v);
    }
    return jiHuaRenWuJi.size;
  } catch { return 0; }
}
function jiHuaBaoCun(sessionId: string, steps: JiHuaBu[]) {
  // 单会话步骤上限 200（防长跑把内存撑大；超了只留前 200，如实截断）
  const san = Array.isArray(steps) ? steps.slice(0, 200) : [];
  jiHuaRenWuJi.set(sessionId, san);
  luoPanJiHua();
  try { broadcastToWindows('warmy:jiHuaGengXin', { sessionId, steps }); } catch { /* noop */ }
}
chuliIpc('warmy:jiHuaLieBiao', (_e, p0?: { sessionId?: string }) =>
  anQuanChuLi(() => ({ ok: true, steps: jiHuaRenWuJi.get(String(p0?.sessionId || '')) || [] }), { ok: true, steps: [] }));
chuliIpc('warmy:jiHuaSheZhi', (_e, p0?: { sessionId?: string; steps?: JiHuaBu[] }) => {
  try {
    const sid = String(p0?.sessionId || '');
    const steps = Array.isArray(p0?.steps) ? p0.steps.slice(0, 200).map((x) => ({
      id: String(x.id || ''),
      title: String(x.title || '').slice(0, 200),
      status: (['pending', 'doing', 'done', 'verified', 'blocked'].includes(String(x.status)) ? x.status : 'pending') as JiHuaBu['status'],
      note: String(x.note || '').slice(0, 300),
    })) : [];
    if (!sid) return { ok: false, error: 'bad-session' };
    jiHuaBaoCun(sid, steps);
    return { ok: true, steps: jiHuaRenWuJi.get(sid) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** 最高信念：单独文件 `<userData>/agents.md`（用户可编辑；与任何指示冲突时以它为准） */
function zuiGaoXinNianLu(): string {
  return path.join(app.getPath('userData'), 'agents.md');
}
function duZuiGaoXinNian(): string {
  try {
    if (!fs.existsSync(zuiGaoXinNianLu())) return '';
    return fs.readFileSync(zuiGaoXinNianLu(), 'utf8');
  } catch { return ''; }
}
chuliIpc('warmy:zuiGaoXinNianDu', () => anQuanChuLi(
  () => ({ ok: true, text: duZuiGaoXinNian(), path: zuiGaoXinNianLu() }),
  { ok: false, text: '', path: '' },
));
chuliIpc('warmy:zuiGaoXinNianShe', (_e, p0?: { text?: string }) => {
  try {
    const t0 = String(p0?.text ?? '').slice(0, 20000);
    fs.mkdirSync(path.dirname(zuiGaoXinNianLu()), { recursive: true });
    fs.writeFileSync(zuiGaoXinNianLu(), t0, 'utf8');
    audit?.log('settings.agents-md-saved', { chars: t0.length });
    return { ok: true, path: zuiGaoXinNianLu(), chars: t0.length };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * **内置 find-skill 技能**（产品要求）：让 AI 自己能找到并装上需要的技能。
 * 首次运行播种到 `userData/skills/find-skill/SKILL.md`，之后完全由用户编辑（不再覆盖）。
 */
function boZhongNeiZhiJiNeng(): void {
  try {
    const mu = path.join(app.getPath('userData'), 'skills', 'find-skill');
    const wen = path.join(mu, 'SKILL.md');
    if (fs.existsSync(wen)) return;
    fs.mkdirSync(mu, { recursive: true });
    fs.writeFileSync(wen, FIND_SKILL_MD, 'utf8');
    audit?.log('skill.find-skill-seeded', { chars: FIND_SKILL_MD.length });
  } catch { /* noop */ }
}

/**
 * **「道」**（`userData/dao.md`）：全局**最高优先级**的提示词，高于「规矩」(agents.md)。
 * 产品定稿：冲突时以道为准；规矩只在不与道冲突时生效。
 */
function daoLu(): string {
  return path.join(app.getPath('userData'), 'dao.md');
}
/**
 * 首次运行播种：`dao.md` 不存在时写入出厂「合篇」（`dao-default.ts`）。
 * 只在文件缺失时写一次；用户改过/删过之后**不覆盖**（删空表示用户主动清空）。
 */
function boZhongDaoMoRen(): void {
  try {
    const p = daoLu();
    if (fs.existsSync(p)) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, DAO_MOREN, 'utf8');
    audit?.log('settings.dao-md-seeded', { chars: DAO_MOREN.length });
  } catch { /* noop */ }
}
function duDao(): string {
  try {
    if (!fs.existsSync(daoLu())) return '';
    return fs.readFileSync(daoLu(), 'utf8');
  } catch { return ''; }
}
chuliIpc('warmy:daoDu', () => anQuanChuLi(
  () => ({ ok: true, text: duDao(), path: daoLu() }),
  { ok: false, text: '', path: '' },
));
chuliIpc('warmy:daoShe', (_e, p0?: { text?: string }) => {
  try {
    const t0 = String(p0?.text ?? '').slice(0, 20000);
    fs.mkdirSync(path.dirname(daoLu()), { recursive: true });
    fs.writeFileSync(daoLu(), t0, 'utf8');
    audit?.log('settings.dao-md-saved', { chars: t0.length });
    return { ok: true, path: daoLu(), chars: t0.length };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   ADR 004 P1：执行环境探测 / 启停（设置 → 功能 → 容器）
   ---------------------------------------------------------------------------
   纪律（都写进契约里，不给后来人留口子）：
   · **只探测与驱动**：不安装、不下载、不提权、不创建容器、不拉镜像；
   · `container-action` **只接受预定义运行时 id + 'start' | 'stop'**，
     **绝不接受任意命令字符串**（否则这里就是一个远程命令执行入口）；
   · 启停**只能由本机用户点击触发**：没有任何网络/群成员/智能体路径会调用它；
   · 任何失败都如实回原始输出与退出码，**不当作成功**。
   ══════════════════════════════════════════════════════════════════════════ */
chuliIpc('warmy:rongQiTanCe', async (_e, opts?: { force?: boolean; cacheMs?: number; deep?: boolean }) => {
  try {
    const report = await tanCeRongQiYunXing({
      cacheMs: opts?.force ? 0 : (typeof opts?.cacheMs === 'number' ? opts.cacheMs : 8000),
      /**
       * deep 由**调用方**决定（默认 false ⇒ 不启动 WSL）：
       *   · 用户显式点「查看本机已有容器」⇒ deep:true；
       *   · 进入容器卡片 / 会话右栏等自动探测 ⇒ deep:false（报 not-probed，不 spawn wsl.exe）。
       * 父进程链实测：deep:true 时会出现 parent=electron.exe 的
       * `wsl.exe -d Ubuntu -- true`（它会把发行版真的启动起来）。
       */
      deep: opts?.deep === true,
    });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), report: zuiHouRongQiTanCeBaoGao() };
  }
});
chuliIpc('warmy:rongQiDongZuo', async (_e, payload?: { id?: string; action?: string }) => {
  // 参数形状**只**认 { id, action }：多余字段一律忽略，也不会被拼进命令
  const r = await yunxingRongqiDongzuo({ id: payload?.id, action: payload?.action });
  if (r.ok) fachuKongzhitai({ cat: 'system', code: 'container.action.accepted', data: { id: r.id, action: r.action } });
  else fachuKongzhitai({ cat: 'error', code: 'container.action.rejected', data: { code: r.code, error: r.error } });
  return r;
});

/**
 * 容器**实例**：环境类型不再是抽象选项，**具体实例就是环境**。
 * 列表按引擎自己的 CLI 现问现答；不支持的引擎如实返回 supported:false。
 */
chuliIpc('warmy:rongQiShiLiJi', async (_e, payload?: { id?: string }) => {
  try {
    return await lieYunXingShiLi(String(payload?.id || ''));
  } catch (e) {
    return { ok: false, id: String(payload?.id || ''), supported: false, instances: [], reason: 'unexpected', evidence: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:rongQiShiLiDongZuo', async (_e, payload?: { id?: string; action?: string; instance?: string }) => {
  const action = payload?.action === 'stop' ? 'stop' : payload?.action === 'start' ? 'start' : null;
  if (!action) return { ok: false, id: String(payload?.id || ''), action: 'start', instance: '', error: 'bad-action' };
  return yunXingShiLiDongZuo(String(payload?.id || ''), action, String(payload?.instance || ''));
});
/** 打开容器产品自己的界面：创建实例由用户在那边做（各引擎造法不同，我们不代造） */
chuliIpc('warmy:rongQiYingYongDaKai', async (_e, payload?: { id?: string }) => {
  try {
    return await daKaiYunXingYingYong(String(payload?.id || ''));
  } catch (e) {
    return { ok: false, id: String(payload?.id || ''), opened: false, reason: 'unexpected', evidence: xiJingCuoWu(e) };
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   ADR 004 第七批定稿：**项目可用性** + **容器只负责开发**
   ---------------------------------------------------------------------------
   · 创建时选了「开发环境 = 容器」的项目：**容器必须启动，项目才可用**；否则项目
     置灰、不可聊天、其中功能不可用 —— **只能翻看之前的记录（历史仍可读）**。
   · **创建时没选容器 或 这是「我的牛马」⇒ 无需容器也能正常聊天**（绝不误伤）。
   · 对成员的可见效果**等同「创建者下线」**（复用 ADR 003 §2.4 / R6 既有语义，不新造状态）。
   · **『停用项目』与容器无关**：任何项目都能被创建者停用（右键菜单），效果同为"不可用、只看历史"。
   · **容器切换只属于容器开发项目**，入口=项目右键菜单（右侧顶部不再有切换入口）。
   · **「运行/测试在容器中」这个选项已作废删除**（容器 = 开发环境；测试/运行不在其职责内）。
   · **容器项目 = 只能在容器里开发**：本应用**不提供**宿主侧编辑；容器没起来就整个不可用，
     绝不"退到主机上悄悄改"。
   · 判定用**同一份纯实现**（container-probe.deriveProjectState），渲染层不再猜一套。

   诚实边界：我们能拒绝写/改项目文件、把项目显示成不可用、禁用开发与功能入口；
   我们**不能**阻止用户自己用外部编辑器打开那个目录（应用侧强约束，不是文件系统级强制）。
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 项目属性的**读取顺序**（第十六批定稿）：**项目记录优先 → 本机旧设置兜底**。
 *
 * 为什么这么改（产品主的原话）：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
 * —— 开发环境 / 选定的容器 / 启用停用 / 项目目录 / 文件台账都是**项目的事实**，
 * 存在 `groups.json` 的项目记录里，因此**会随项目同步给成员**；
 * `settings.containerDev / containerProjectRuntime / projectDisabled` 只作为**旧版本兼容读**保留
 * （老安装里已经写进本机设置的那些项目不能因为升级就"变成别的项目"）。
 *
 * `projectSource` 会一路带到 IPC 响应与渲染层：
 *   · `local`           = 本机就是项目主，属性是本机自己写的；
 *   · `creator-signal`  = 属性来自**创建者节点同步过来的信号**（异地的成员就是这样看到状态的）。
 */
interface XiangmuShuxingShitu {
  devEnv: 'host' | 'container';
  runtimeId: string;
  disabledAt: number;
  directory: string;
  directorySource: 'creator-picked' | 'checkpoint-workspace' | 'not-recorded';
  availability: string;
  availabilityCode: string;
  availabilityAt: number;
  reportedBy: string;
  source: 'project-record' | 'legacy-local-settings';
}

function quXiangMuShuXing(groupId: string): XiangmuShuxingShitu {
  const qunId = String(groupId || '');
  const yichan = (): XiangmuShuxingShitu => {
    let devEnv: 'host' | 'container' = 'host';
    let runtimeId = '';
    let disabledAt = 0;
    try {
      const s = settingsStore?.load();
      const kaifa = (s && s.containerDev) || {};
      devEnv = kaifa[qunId] === 'container' ? 'container' : 'host';
      const rt = (s && s.containerProjectRuntime) || {};
      runtimeId = String(rt[qunId] || '');
      const dis = (s && s.projectDisabled) || {};
      const n = Number(dis[qunId] || 0);
      disabledAt = Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      /* 拿不到就按默认（本机 / 未停用） */
    }
    return {
      devEnv, runtimeId, disabledAt,
      directory: '', directorySource: 'not-recorded',
      availability: 'unknown', availabilityCode: '', availabilityAt: 0, reportedBy: '',
      source: 'legacy-local-settings',
    };
  };
  const xiangMu = groupStore?.projectOf(qunId);
  if (!xiangMu) return yichan();
  return {
    devEnv: xiangMu.devEnv === 'container' ? 'container' : 'host',
    runtimeId: String(xiangMu.runtimeId || ''),
    disabledAt: Number(xiangMu.disabledAt) > 0 ? Number(xiangMu.disabledAt) : 0,
    directory: String(xiangMu.directory || ''),
    directorySource: xiangMu.directory ? (xiangMu.directorySource || 'creator-picked') : 'not-recorded',
    availability: String(xiangMu.availability || 'unknown'),
    availabilityCode: String(xiangMu.availabilityCode || ''),
    availabilityAt: Number(xiangMu.availabilityAt) || 0,
    reportedBy: String(xiangMu.reportedBy || ''),
    source: 'project-record',
  };
}

/** 这个项目的属性是不是**别人的节点同步过来的**（= 本机不是项目主） */
function projectAttrsAreRemote(groupId: string): boolean {
  const qunId = String(groupId || '');
  const shitu = quXiangMuShuXing(qunId);
  if (shitu.source !== 'project-record') return false;
  const reportedBy = shitu.reportedBy;
  if (!reportedBy) return false;
  try {
    const benJiZhiWen = String(identityStore?.info()?.zhiWen || '');
    return !!benJiZhiWen && !zhiwenPipei(reportedBy, benJiZhiWen);
  } catch {
    return false;
  }
}

function quXiangMuKaiFaHuanJing(groupId: string): 'host' | 'container' {
  return quXiangMuShuXing(groupId).devEnv;
}
function xiangMuTingYongShiJian(groupId: string): number {
  return quXiangMuShuXing(groupId).disabledAt;
}
/** 项目目录（**产品级事实**：成员据此解析"最近改动文件"的根） */
function quXiangMuMuLu(groupId: string): { dir: string; reason: string } {
  const v = quXiangMuShuXing(String(groupId || ''));
  if (v.directory) return { dir: v.directory, reason: v.directorySource };
  return { dir: '', reason: 'not-recorded' };
}
/** 容器开发项目选定的运行时（右键菜单「切换容器…」写入项目记录） */
function quXiangMuYunXingShi(sessionId: string): string {
  return quXiangMuShuXing(String(sessionId || '')).runtimeId;
}

/**
 * 写项目属性：**只写项目记录**（项目级）—— 不再写本机设置。
 * `runtimeId`/`disabledAt` 传 `undefined` = 保持原样（不覆盖已知事实）。
 */
function sheZhiXiangMuShuXing(
  groupId: string,
  patch: {
    devEnv?: 'host' | 'container';
    runtimeId?: string;
    disabledAt?: number;
    directory?: string;
    directorySource?: 'creator-picked' | 'checkpoint-workspace';
    availability?: 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen' | 'unknown';
    availabilityCode?: string;
    env?: { containerRef?: string; imageRef?: string; solidifiedAt?: number };
    /** 门禁验收脚本（相对仓库根）；只在 complete/验收 时跑 */
    gateVerify?: string[];
    gateLast?: { at: number; pass: boolean; summary: string };
    /** 项目 MEMORY（覆盖式 Markdown） */
    memory?: string;
  }
): { ok: boolean; error?: string } {
  const qunId = String(groupId || '');
  if (!groupStore || !qunId) return { ok: false, error: 'group store unavailable' };
  const r = groupStore.setProjectAttrs(qunId, {
    ...(patch.devEnv ? { devEnv: patch.devEnv } : {}),
    ...(typeof patch.runtimeId === 'string' ? { runtimeId: patch.runtimeId } : {}),
    ...(typeof patch.disabledAt === 'number' ? { disabledAt: patch.disabledAt } : {}),
    ...(patch.directory ? { directory: patch.directory, directorySource: patch.directorySource || 'creator-picked' } : {}),
    ...(patch.availability ? { availability: patch.availability } : {}),
    ...(typeof patch.availabilityCode === 'string' ? { availabilityCode: patch.availabilityCode } : {}),
    availabilityAt: Date.now(),
    ...(patch.env ? { env: patch.env } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error };
  void faBuXiangMuShuXing(qunId);
  return { ok: true };
}

/**
 * 把项目属性（含创建者节点的**实时可用性**）广播给成员。
 *
 * 这是"记录文件改动是产品功能、不是本机功能"那条要求落到**网络**上的一步：
 * 成员那边的 UI 从这条信号里就能知道"这是容器开发项目 / 创建者停用了它 /
 * 创建者那台机器的容器现在没就绪 / 项目目录在哪 / 工具动过哪些文件"，
 * 从而**看到原因**并**复用既有「创建者离线」那一套表现**（不新造第三种状态）。
 *
 * 未组网 / 没起 mesh ⇒ 直接返回（**不报错、不假装发出去了**）。
 */
async function faBuXiangMuShuXing(groupId: string): Promise<{ ok: boolean; sent: boolean; reason?: string }> {
  const qunId = String(groupId || '');
  if (!qunId) return { ok: false, sent: false, reason: 'no-group-id' };
  const shitu = quXiangMuShuXing(qunId);
  const g = groupStore?.getGroup(qunId);
  const ledger = (groupStore?.listFileAccess(qunId, 30) || []).map((e) => ({ op: e.op, path: e.path, ts: e.ts, ok: e.ok, by: e.by, ...(e.bytes ? { bytes: e.bytes } : {}) }));
  let creatorFingerprint = '';
  try {
    creatorFingerprint = String(g?.creatorFingerprint || identityStore?.info()?.zhiWen || '');
  } catch {
    creatorFingerprint = String(g?.creatorFingerprint || '');
  }
  const availabilityCode = shitu.availabilityCode || shitu.availability || 'unknown';
  const payload = xiangmuShuxingXiaoxi({
    groupId: qunId,
    ...(g?.ming ? { ming: g.ming } : {}),
    ...(g ? { type: g.type } : {}),
    project: {
      devEnv: shitu.devEnv,
      runtimeId: shitu.runtimeId,
      disabledAt: shitu.disabledAt,
      ...(shitu.directory ? { directory: shitu.directory, directorySource: shitu.directorySource === 'checkpoint-workspace' ? 'checkpoint-workspace' as const : 'creator-picked' as const } : {}),
    },
    availability: {
      availability: (['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen'] as const).includes(shitu.availability as never)
        ? (shitu.availability as 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen')
        : 'unknown',
      code: availabilityCode,
      at: shitu.availabilityAt || Date.now(),
    },
    ...(creatorFingerprint ? { creatorFingerprint } : {}),
    ledger,
  });
  if (!secureMesh || !secureMesh.enabled) return { ok: true, sent: false, reason: 'mesh-not-running' };
  try {
    const r = await secureMesh.broadcast({ to: '*', channel: XIANGMU_SHUXING_TONGDAO, payload });
    return { ok: r.failed === 0, sent: r.sent > 0, reason: r.errors && r.errors.length ? r.errors[0] : undefined };
  } catch (e) {
    return { ok: false, sent: false, reason: xiJingCuoWu(e) };
  }
}

/** 未就绪时顺手探一次（主进程侧有短缓存）。探不到 ⇒ null ⇒ 按未就绪处理（不乐观放开） */
async function quRongQiZhuangTai(runtimeId: string): Promise<string | null> {
  if (!runtimeId) return null;
  let report = zuiHouRongQiTanCeBaoGao();
  const huanchunHang = report ? (report.runtimes || []).find((x) => x.id === runtimeId) : undefined;
  if (!huanchunHang) {
    try {
      /**
       * **只探这个项目真正在用的运行时**（`only`），并且**不深探**。
       *
       * 为什么（用户实测的问题："打开新窗口为什么会触发打开 WSL"）：
       * 全量探测会把 12 个运行时挨个跑一遍，其中 WSL 那一步是 `wsl -d <发行版> -- true` ——
       * **那会把发行版真的启动起来**。于是"打开一个项目会话 → 查容器就绪没"就顺手拉起了 WSL。
       * 现在：只探需要的那一个、且不允许代为启动发行版。
       */
      // 注意：这里**不传 deep** ⇒ 例行路径绝不启动 WSL（见 probeWsl 的默认静默）
      report = await tanCeRongQiYunXing({ cacheMs: 8000, only: [runtimeId] });
    } catch {
      return null;
    }
  }
  const hang = (report?.runtimes || []).find((x) => x.id === runtimeId);
  if (!hang) return null;
  // `not-probed` 不是事实断言（只是"本轮没探它"）：如实返回 null，由调用方按未就绪处理
  return hang.status === 'not-probed' ? null : String(hang.status);
}

/**
 * 「只有创建者能启用/停用项目」——判定依据与 `warmy:qunChengYuanJi` **完全相同**
 * （group-store 里建群时写入的 creatorFingerprint vs 本机当前身份指纹），
 * 不在渲染层猜、也不新增第二套"谁是创建者"的定义。拿不到指纹 ⇒ false（宁可少给权限）。
 */
function benJiShiXiangMuChuangJianZhe(groupId: string): boolean {
  try {
    const qunId = String(groupId || '');
    if (!groupStore || !qunId) return false;
    const chuangJianZheZhiWen = String(groupStore.getGroup(qunId)?.creatorFingerprint || '');
    const benJiZhiWen = String(identityStore?.info()?.zhiWen || '');
    return !!chuangJianZheZhiWen && !!benJiZhiWen && zhiwenPipei(chuangJianZheZhiWen, benJiZhiWen);
  } catch {
    return false;
  }
}

/**
 * 会话/项目的容器事实 → 结构化可用性状态。**唯一入口**（渲染层、门禁、右键动作都走它）。
 *
 * 第十六批的两处变化：
 *  ① 事实来源改成**项目属性**（项目记录优先，旧设置兜底）—— 所以**异地成员**也会看到
 *     "这是容器开发项目"，而不是把它当成一台普通的本机项目；
 *  ② 本机不是项目主时（`projectAttrsAreRemote`），**容器状态不再拿本机探测去猜**：
 *     用创建者节点同步过来的**可用性信号**（`availability`）顶替，
 *     于是成员看到的是"创建者那边现在不可用 + 具体原因"，而不是"我这台机器上没有这个容器"。
 *     这正好落在既有的「创建者离线」语义上（同一份 deriveProjectState ⇒ 同一个 memberFace）。
 */
async function quXiangMuTai(sessionId: string, opts: { probe?: boolean } = {}): Promise<RongqiXiangmuZhuangtai> {
  const id = String(sessionId || '');
  const attrs = quXiangMuShuXing(id);
  const remote = projectAttrsAreRemote(id);
  if (remote) {
    const shiShi = projectAttrsToStateInput({
      project: {
        devEnv: attrs.devEnv,
        runtimeId: attrs.runtimeId,
        disabledAt: attrs.disabledAt,
      },
      availability: {
        availability: (['available', 'stopped', 'not-ready', 'not-installed', 'not-chosen'] as const).includes(attrs.availability as never)
          ? (attrs.availability as 'available' | 'stopped' | 'not-ready' | 'not-installed' | 'not-chosen')
          : 'unknown',
        code: attrs.availabilityCode,
        at: attrs.availabilityAt,
      },
    });
    return deriveProjectState({
      devEnv: shiShi.devEnv,
      runtimeId: shiShi.runtimeId,
      runtimeStatus: shiShi.runtimeStatus as never,
      disabledByOwner: shiShi.disabledByOwner,
    });
  }
  const devEnv = attrs.devEnv;
  const runtimeId = attrs.runtimeId;
  let status: string | null = null;
  if (devEnv === 'container' && runtimeId) {
    const cached = zuiHouRongQiTanCeBaoGao();
    const hang = cached ? (cached.runtimes || []).find((x) => x.id === runtimeId) : undefined;
    status = hang ? String(hang.status) : opts.probe === false ? null : await quRongQiZhuangTai(runtimeId);
  }
  return deriveProjectState({
    devEnv,
    runtimeId,
    runtimeStatus: (status as never) ?? null,
    disabledByOwner: attrs.disabledAt > 0,
  });
}

/**
 * 把**本机算出来的可用性**记进项目属性并广播（只在**变化时**才写/发）。
 *
 * 为什么需要：成员要看到的不仅是"这是容器项目 / 被停用了"，还要看到**原因**
 * （创建者那边的容器没就绪 / 没装 / 还没选）。这条现场事实只能由**创建者的节点**上报，
 * 所以在这里落一次 —— 写进项目记录（成员可见）并走 `project-attrs` 频道播出去。
 * ⚠️ 写入失败/无变化一律静默（不能因为"状态记不下来"就把渲染层卡住）。
 */
function jiluBenjiKeyongxing(groupId: string, code: string): void {
  const qunId = String(groupId || '');
  if (!qunId || !groupStore) return;
  const cur = groupStore.projectOf(qunId);
  if (!cur) return; // 没有项目记录的不写（例如「我的牛马」的聊天、联系人）
  const availability =
    code === 'host-dev' || code === 'ok' ? 'available'
      : code === 'disabled-by-owner' ? 'stopped'
        : code === 'container-not-installed' ? 'not-installed'
          : code === 'container-not-chosen' ? 'not-chosen'
            : 'not-ready';
  if (cur.availability === availability && cur.availabilityCode === code) return;
  let benJiZhiWen = '';
  try {
    benJiZhiWen = String(identityStore?.info()?.zhiWen || '');
  } catch {
    benJiZhiWen = '';
  }
  const r = groupStore.setProjectAttrs(qunId, {
    availability,
    availabilityCode: code,
    availabilityAt: Date.now(),
    ...(benJiZhiWen ? { reportedBy: benJiZhiWen } : {}),
  });
  if (r.ok) void faBuXiangMuShuXing(qunId);
}

/** 项目不可用时的结构化拒绝（chat-send / 值班编排 / 各功能入口共用） */
async function projectUnavailableFor(sessionId: string): Promise<ReturnType<typeof xiangMuBuKeYongJuJue>> {
  const id = String(sessionId || '');
  const devEnv = quXiangMuKaiFaHuanJing(id);
  // 本机开发 + 未被停用：与容器毫无关系 ⇒ 直接放行，连探测都不做（不误伤）
  if (devEnv !== 'container' && xiangMuTingYongShiJian(id) === 0) return null;
  return xiangMuBuKeYongJuJue(await quXiangMuTai(id));
}

/** 项目可用性状态（渲染层**唯一**的事实来源；含"历史仍可读"这条事实） */
chuliIpc('warmy:xiangMuTai', async (_e, payload?: { sessionId?: string }) => {
  try {
    const sessionId = String(payload?.sessionId || '');
    const state = await quXiangMuTai(sessionId);
    const attrs = quXiangMuShuXing(sessionId);
    const remote = projectAttrsAreRemote(sessionId);
    // 本机是项目主 ⇒ 把**现场算出来的可用性**记进项目属性并广播（成员据此看到原因）
    if (!remote) jiluBenjiKeyongxing(sessionId, state.code);
    return {
      ok: true,
      state: { ...state, reasonKey: xiangMuYuanYinJian(state.code), runtimeId: attrs.runtimeId },
      /**
       * 与"创建者下线"同一套表现（渲染层据此用同一个文案键，而不是新造第三种状态）。
       * ⚠️ 成员侧也一样：项目不可用时**入站流量按创建者离线处理**（见 projectInboundGate）。
       */
      memberFaceKey: state.memberFace === 'creator-offline' ? 'group.memberOffline' : null,
      /** 创建者能不能启用/停用（渲染层据此灰掉菜单项；判定本身在主进程） */
      localIsCreator: benJiShiXiangMuChuangJianZhe(sessionId),
      /** **历史仍可读**：不可用 ≠ 整块禁掉（渲染层必须继续显示已存在的记录） */
      historyReadable: true,
      /**
       * 这条状态是**谁说的**：
       *  · 'local'          = 本机就是项目主（事实由本机现场探测得出）；
       *  · 'creator-signal' = 属性与可用性来自**创建者节点同步来的信号**（异地成员的情况）——
       *    渲染层据此多给一行"由创建者的节点上报"，**复用**同一句「创建者离线」文案。
       */
      projectSource: remote ? 'creator-signal' : 'local',
      /** 信号到达时间（远端才有意义；本机为 0） */
      projectReportedAt: remote ? attrs.availabilityAt : 0,
      /** 项目目录（产品级事实：成员据此解析"最近改动文件"的根） */
      projectDir: attrs.directory,
      projectDirReason: attrs.directorySource,
      /** 成员侧入站门控结论（可断言的事实：不可用 ⇒ 排队为 creator-offline） */
      inboundGate: xiangmuRuXiangMenjin({ running: state.running, code: state.code }),
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「启用项目」（右键菜单）：**只有创建者**能启用。
 * 容器开发项目**必须先有就绪的容器** —— 否则如实拒绝并给"去设置启动容器"的引导，**不假装启用**。
 */
chuliIpc('warmy:xiangMuQiYong', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!benJiShiXiangMuChuangJianZhe(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can enable or disable this project' };
    }
    if (xiangMuTingYongShiJian(id) > 0) {
      // **写项目记录**（项目级事实 ⇒ 会同步给成员），不再只写本机设置
      const w = sheZhiXiangMuShuXing(id, { disabledAt: 0 });
      if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    }
    const after = await quXiangMuTai(id);
    if (!after.running) {
      // 不静默降级：容器没起就说容器没起，并给出下一步该做什么
      return {
        ok: false,
        code: after.code === 'container-not-chosen' ? 'container-not-chosen' : 'container-not-ready',
        projectCode: after.code,
        reasonKey: xiangMuYuanYinJian(after.code),
        fix: after.fix,
        needsContainer: true,
        state: after,
      };
    }
    audit?.log('container.project-enable', { sessionId: id });
    fachuKongzhitai({ cat: 'system', code: 'container.project.enabled', data: { sessionId: id } });
    tongzhiShitiBiangeng(id, 'project');
    return { ok: true, running: true, enabledAt: Date.now(), state: after };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「停用项目」（右键菜单）：**只有创建者**能停用；**与是否选了容器无关**。
 * 效果：项目置灰、不可聊天、其中功能不可用，**只能翻看之前的记录**（历史仍可读）。
 * 对成员的效果**等同创建者下线**（复用既有语义，不新造）。
 *
 * 第十六批：停用时间戳写进**项目记录**（项目级）并广播出去 —— 否则异地的成员看到的
 * 还是一台"普通的本机项目"（这正是产品主要修的那件事）。
 */
chuliIpc('warmy:xiangMuTingYong', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!benJiShiXiangMuChuangJianZhe(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can enable or disable this project' };
    }
    const at = Date.now();
    const w = sheZhiXiangMuShuXing(id, { disabledAt: at });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    const state = await quXiangMuTai(id);
    audit?.log('container.project-disable', { sessionId: id, memberFace: state.memberFace });
    fachuKongzhitai({ cat: 'system', code: 'container.project.disabled', data: { sessionId: id } });
    // 项目属性也是"这个实体的属性"：另一处视图（独立窗/主界面）要立刻反映"已停用"
    tongzhiShitiBiangeng(id, 'project');
    return { ok: true, disabled: true, disabledAt: at, state, historyReadable: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「切换容器…」（右键菜单的弹窗）：**只有创建时选了容器开发的项目**才有这个出口。
 * 只接受设置里已探测到的运行时 id（`{ sessionId, runtimeId }`）；
 * **不接受任何命令字符串**（运行时 id 必须在预定义清单里，否则拒绝）。
 */
chuliIpc('warmy:xiangMuSheZhiRongQi', async (_e, payload?: { sessionId?: string; runtimeId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = String(payload?.runtimeId || '');
    if (!benJiShiXiangMuChuangJianZhe(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can change this project container' };
    }
    if (quXiangMuKaiFaHuanJing(id) !== 'container') {
      return { ok: false, code: 'not-container-project', error: 'this project does not develop in a container' };
    }
    if (!rongQiYunXingGuiGeOf(runtimeId)) {
      return { ok: false, code: 'unknown-runtime', error: `unknown runtime id: runtimeId` };
    }
    const w = sheZhiXiangMuShuXing(id, { runtimeId });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    const state = await quXiangMuTai(id);
    audit?.log('container.project-set-container', { sessionId: id, runtimeId });
    return {
      ok: true,
      runtimeId,
      state,
      /** 项目**正在运行**时切换 ⇒ 界面必须提示"重启项目才能生效"（不假装已切过去） */
      restartRequired: state.running,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * ADR 004 §七.3 / 第十六批：**项目文件事实**（右侧三块面板的真实数据来源）。
 *
 * 第十六批把两个"数据源缺口"补成真的（产品主的原话：**「记录文件的改动应该是无限牛马的功能，
 * 不是本机的功能」** —— 所以台账是**项目级**的，随项目同步给成员）：
 *  ① **工具文件访问台账**（`tool-file-access-ledger`）：记录在**项目记录**里，
 *     由 helper-tool 的真实读写 + 容器内执行共同填充（读/写/改/删/建/备份/回滚七类操作）；
 *  ② **项目目录记录**（`project-directory-record`）：`GroupRecord.project.directory`
 *     （创建者选目录时写入；没有就用回退点里记的 workspace —— 两侧都如实标来源）。
 *
 * 于是四类真实来源：台账 / 回退点明细 / 项目目录扫描（真实 mtime）/ 产物目录扫描。
 * **仍然拿不到的**（例如项目目录没被记录过）⇒ 如实写进 `missingSources`，绝不编数据。
 */
async function projectFilesFor(sessionId: string): Promise<{
  ok: true;
  sessionId: string;
  projectDir: string | null;
  projectDirReason: string;
  projectSource: string;
  changed: Array<{ path: string; ts: number; kind: string; scope: string; source?: string }>;
  other: Array<{ path: string; ts: number; kind: string; scope: string; source: string }>;
  ledger: Array<{ path: string; op: string; ts: number; ok: boolean; by: string; bytes?: number; scope: string }>;
  missingSources: string[];
  chanPin: {
    dir: string;
    dirExists: boolean;
    dirKind: 'planned' | 'existing';
    kind: 'program' | 'file' | 'none';
    entry: string | null;
    entryHostRunnable: boolean;
    entryReason: string;
    files: Array<{ path: string; ming: string }>;
  };
}> {
  const id = String(sessionId || '');
  const missingSources: string[] = [];
  const changed: Array<{ path: string; ts: number; kind: string; scope: string; source?: string }> = [];
  let projectDir: string | null = null;
  let projectDirReason = 'not-recorded';
  const attrs = quXiangMuShuXing(id);
  const remote = projectAttrsAreRemote(id);

  // ① 项目目录：**项目记录里记了的**优先（产品级事实，成员也拿得到）
  if (attrs.directory) {
    projectDir = attrs.directory;
    projectDirReason = attrs.directorySource;
  }
  // ② 回退点明细（真实 path + 真实 ts）
  try {
    const cps = checkpoints?.LieBiao() || [];
    for (const cp of cps.slice(-20)) {
      const detail = (cp && (cp as unknown as { detail?: { filesChanged?: Array<{ path: string; ts: number }>; filesCreated?: Array<{ path: string; ts: number }> } }).detail) || {};
      for (const f of detail.filesChanged || []) changed.push({ path: String(f.path), ts: Number(f.ts) || 0, kind: 'changed', scope: 'other', source: 'checkpoint-detail' });
      for (const f of detail.filesCreated || []) changed.push({ path: String(f.path), ts: Number(f.ts) || 0, kind: 'created', scope: 'other', source: 'checkpoint-detail' });
      const ws = (cp as unknown as { workspace?: string }).workspace;
      if (!projectDir && ws && fs.existsSync(ws)) {
        projectDir = ws;
        projectDirReason = 'checkpoint-workspace';
      }
    }
  } catch {
    /* 拿不到就保持空 */
  }
  // ③ **工具文件访问台账**（项目级、成员可见；真实发生过才在）
  const zhangBenHang = (groupStore?.listFileAccess(id, 200) || []).map((e2) => {
    const inProject = !!projectDir && path.resolve(e2.path).startsWith(path.resolve(projectDir) + path.sep);
    return { path: e2.path, op: e2.op, ts: e2.ts, ok: e2.ok, by: e2.by, ...(e2.bytes ? { bytes: e2.bytes } : {}), scope: inProject ? 'project' : 'other' };
  });
  for (const e2 of zhangBenHang) {
    // 台账里的 read 不进"最近改动文件"（**读不是改动**），但写/改/删/建/备份/回滚都进
    if (e2.op === 'read') continue;
    changed.push({ path: e2.path, ts: e2.ts, kind: e2.op === 'delete' ? 'deleted' : e2.op === 'create' ? 'created' : 'changed', scope: e2.scope, source: 'tool-file-access-ledger' });
  }
  // ④ 项目目录**真实 mtime 扫描**（有目录记录时才做；有界、跳过重目录）
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'target']);
      const yiKanDao: Array<{ path: string; ts: number }> = [];
      const bianli = (dir: string, depth: number): void => {
        if (depth > 3 || yiKanDao.length >= 400) return;
        let entries: import('node:fs').Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const tiaoMu of entries) {
          if (yiKanDao.length >= 400) return;
          if (tiaoMu.name.startsWith('.') && tiaoMu.name !== '.env') continue;
          const fp = path.join(dir, tiaoMu.name);
          if (tiaoMu.isDirectory()) {
            if (skip.has(tiaoMu.name)) continue;
            bianli(fp, depth + 1);
            continue;
          }
          if (!tiaoMu.isFile()) continue;
          try {
            const st = fs.statSync(fp);
            yiKanDao.push({ path: fp, ts: st.mtimeMs });
          } catch {
            /* 拿不到就跳过 */
          }
        }
      };
      bianli(projectDir, 0);
      for (const f of yiKanDao.sort((a, b) => b.ts - a.ts).slice(0, 60)) {
        changed.push({ path: f.path, ts: f.ts, kind: 'changed', scope: 'project', source: 'dir-scan' });
      }
    } catch {
      /* 扫不到就不扫（不编） */
    }
  }
  // 去重（同一路径取最新的一条，并保留它自己的来源标注）
  const byPath = new Map<string, { path: string; ts: number; kind: string; scope: string; source?: string }>();
  for (const c of changed) {
    const prev = byPath.get(c.path);
    if (!prev || prev.ts <= c.ts) byPath.set(c.path, c);
  }
  const all = [...byPath.values()].sort((a, b) => b.ts - a.ts);
  for (const c of all) {
    if (projectDir && path.resolve(c.path).startsWith(path.resolve(projectDir) + path.sep)) c.scope = 'project';
  }
  const ziji = all.filter((c) => c.scope === 'project');
  /**
   * 「其他文件（非项目内）」= 被工具动过、但**不在项目目录下**的路径（例如 ~/.warmy 备份、
   * 临时产物、别的盘的路径）。这是产品明确要的那一栏；来源如实标注。
   */
  const other = all.filter((c) => c.scope !== 'project').map((c) => ({ ...c, source: c.source || 'unknown' }));

  /**
   * **仍然缺什么**（如实报告，不填假数据）：
   *  · 没有项目目录记录 ⇒ 成员与"最近改动文件"都缺一个解析根（写进 missingSources）；
   *  · 台账存在但为空 ⇒ **不是缺口**（就是"这段时间没有任何工具动过文件"这个事实本身）。
   *  · 远端成员：项目目录/可用性来自创建者的信号，界面会另有一行说明来源。
   */
  if (!projectDir) missingSources.push('project-directory-record');
  if (remote && !attrs.availabilityAt) missingSources.push('creator-availability-signal');

  // 产物目录（我们计划的存放位置；不存在也如实显示"即将存放"）
  const shengchanMulu = path.join(app.getPath('userData'), 'products', id || 'default');
  let dirExists = false;
  let files: Array<{ path: string; ming: string }> = [];
  try {
    dirExists = fs.existsSync(shengchanMulu) && fs.statSync(shengchanMulu).isDirectory();
    if (dirExists) {
      files = fs
        .readdirSync(shengchanMulu, { withFileTypes: true })
        .filter((e) => e.isFile())
        .slice(0, 50)
        .map((e) => {
          const fp = path.join(shengchanMulu, e.name);
          let bytes = 0;
          let ts = 0;
          try {
            const st = fs.statSync(fp);
            bytes = st.size;
            ts = st.mtimeMs;
          } catch {
            /* 拿不到就 0 */
          }
          return { path: fp, ming: e.name, bytes, ts };
        })
        .sort((a, b) => b.ts - a.ts);
    }
  } catch {
    /* 忽略 */
  }
  const entryOf = (LieBiao: Array<{ path: string; ming: string }>): { entry: string | null; kind: 'program' | 'file' | 'none'; reason: string } => {
    const prog = LieBiao.find((f) => /\.(exe|cmd|bat|js|mjs|cjs|py)$/i.test(f.ming)) || null;
    if (prog) return { entry: prog.path, kind: 'program', reason: 'entry-found' };
    const anyFile = LieBiao.find((f) => /\.(md|txt|docx?|pptx?|xlsx?|csv|pdf|mp[34]|wav|png|jpe?g|zip)$/i.test(f.ming)) || LieBiao[0] || null;
    if (anyFile) return { entry: anyFile.path, kind: 'file', reason: 'file-found' };
    return { entry: null, kind: 'none', reason: dirExists ? 'dir-empty' : 'dir-planned' };
  };
  const e = entryOf(files);
  // "能不能在主机上跑"：只有**本机开发的项目** + 宿主原生扩展 才可点；其余一律置灰并说明原因
  const devEnv = quXiangMuKaiFaHuanJing(id);
  const zhujiYuansheng = !!e.entry && /\.(exe|cmd|bat|js|mjs|cjs)$/i.test(path.basename(e.entry));
  const entryHostRunnable = e.kind === 'program' && zhujiYuansheng && devEnv === 'host';
  const entryReason = e.kind !== 'program'
    ? e.reason
    : devEnv !== 'host'
      ? 'container-built'
      : zhujiYuansheng
        ? 'host-native'
        : 'no-host-runtime';
  return {
    ok: true,
    sessionId: id,
    projectDir,
    projectDirReason,
    /** 属性是本地事实还是创建者信号（渲染层据此多一行"由创建者的节点上报"） */
    projectSource: remote ? 'creator-signal' : 'local',
    changed: ziji,
    other,
    ledger: zhangBenHang,
    missingSources,
    chanPin: {
      dir: shengchanMulu,
      dirExists,
      dirKind: dirExists ? 'existing' : 'planned',
      kind: e.kind,
      entry: e.entry,
      entryHostRunnable,
      entryReason,
      files,
    },
  };
}

chuliIpc('warmy:xiangMuWenJianJi', async (_e, payload?: { sessionId?: string }) => {
  try {
    return await projectFilesFor(String(payload?.sessionId || ''));
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「运行」（产物面板）：**真的在主机上运行**那个程序（与容器无关）。
 * 安全：入口路径**由主进程自己解析**（渲染层只给 sessionId，**不接受任何路径/命令字符串**），
 * 且必须满足 `entryHostRunnable`（本机开发 + 宿主原生扩展）才允许；不满足就如实拒绝。
 */
chuliIpc('warmy:chanPinYunXing', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const shiShi = await projectFilesFor(id);
    const p = shiShi.chanPin;
    if (!p.entry || p.kind !== 'program') return { ok: false, code: 'no-entry', reason: p.entryReason, executed: false };
    if (!p.entryHostRunnable) return { ok: false, code: p.entryReason, executed: false, entry: p.entry };
    // 归一化后再校验：必须落在产物目录里（防路径穿越/软链逃逸）
    const zhenshi = fs.realpathSync(p.entry);
    const zhenshiMulu = fs.realpathSync(p.dir);
    if (!zhenshi.startsWith(zhenshiMulu + path.sep)) return { ok: false, code: 'outside-product-dir', executed: false };
    const ext = path.extname(zhenshi).toLowerCase();
    let file = zhenshi;
    let args: string[] = [];
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      // 用**本机捆绑的 Node** 跑（Windows 版），不假设系统里有 node
      const bundled = path.join(process.resourcesPath || '', 'node', process.platform === 'win32' ? 'win-x64' : 'linux-x64', process.platform === 'win32' ? 'node.exe' : 'node');
      file = fs.existsSync(bundled) ? bundled : 'node';
      args = [zhenshi];
    }
    const Zhi = spawn(file, args, { cwd: zhenshiMulu, detached: true, stdio: 'ignore', windowsHide: false });
    Zhi.unref();
    audit?.log('chanPin.run', { sessionId: id, entry: zhenshi });
    fachuKongzhitai({ cat: 'system', code: 'chanPin.run.started', data: { sessionId: id } });
    return { ok: true, executed: true, pid: Zhi.pid || 0, entry: zhenshi };
  } catch (e) {
    return { ok: false, code: 'spawn-failed', error: xiJingCuoWu(e), executed: false };
  }
});

/**
 * 项目环境台账（**本机侧**的执行记录）：记住这个项目用哪个容器 / 上次固化在哪一层。
 * ⚠️ 与"项目属性"分开存：
 *   · `settings.projectEnv` = **本机**的容器引用与固化历史（别的机器上不是同一份容器）；
 *   · `GroupRecord.project.env` = 随项目同步的**摘要**（成员据此看到"这个项目固化过"）。
 * 两边都只写**真发生过**的事；没发生过就不写（绝不编一个"已固化"）。
 */
function projectEnvLedgerOf(groupId: string): { runtimeId: string; containerRef?: string; lastImageRef?: string; lastSolidifiedAt?: number; solidifyHistory?: Array<{ imageRef: string; at: number }> } {
  try {
    const m = (settingsStore?.load()?.projectEnv || {})[String(groupId)] || null;
    if (m) return m;
  } catch {
    /* 拿不到就当没有 */
  }
  return { runtimeId: '' };
}

function writeProjectEnvLedger(
  groupId: string,
  patch: { runtimeId?: string; containerRef?: string; imageRef?: string; solidifiedAt?: number }
): void {
  try {
    const qunId = String(groupId || '');
    if (!settingsStore || !qunId) return;
    const all = { ...(settingsStore.load().projectEnv || {}) };
    const cur = all[qunId] || { runtimeId: '' };
    const next = { ...cur };
    if (patch.runtimeId !== undefined) next.runtimeId = patch.runtimeId;
    if (patch.containerRef !== undefined) next.containerRef = patch.containerRef;
    if (patch.imageRef && patch.solidifiedAt) {
      next.lastImageRef = patch.imageRef;
      next.lastSolidifiedAt = patch.solidifiedAt;
      const liShi = [...(cur.solidifyHistory || []), { imageRef: patch.imageRef, at: patch.solidifiedAt }];
      // 只留最近 N 个（与 ADR 的保留策略一致）；被裁掉的**只报告不删**（删镜像要用户明确同意）
      next.solidifyHistory = guHuaBaoLiu(liShi).keep;
    }
    all[qunId] = next;
    settingsStore.save({ projectEnv: all } as never);
    // 同步给成员的**摘要**（项目级）
    sheZhiXiangMuShuXing(qunId, {
      env: {
        ...(next.containerRef ? { containerRef: next.containerRef } : {}),
        ...(next.lastImageRef ? { imageRef: next.lastImageRef } : {}),
        ...(next.lastSolidifiedAt ? { solidifiedAt: next.lastSolidifiedAt } : {}),
      },
    });
  } catch {
    /* 记账失败不影响主流程，但也不假装成功（返回值里本来就没有"已固化"） */
  }
}

/** 项目容器现在在不在（真的问引擎，不猜） */
async function projectContainerStatusOf(groupId: string, runtimeId: string): Promise<{ running: boolean; exists: boolean; containerRef: string; raw: string }> {
  const ming = rongQiXiangMuMing(groupId);
  const r = await yunXingRongQiZhiXing(runtimeId, 'ps', { ming }, 30000);
  if (!r.executed) return { running: false, exists: false, containerRef: '', raw: r.err };
  const Hang = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  const status = Hang.split('|')[2] || '';
  return { running: /(^|\s)Up\b/i.test(status), exists: !!Hang, containerRef: ming, raw: Hang };
}

/** 确保项目容器存在（不存在就按项目镜像起一个，**默认不删** ⇒ 保留可写层） */
async function baozhangXiangmuRongqi(
  groupId: string,
  runtimeId: string,
  opts: { image?: string; hostDir?: string } = {}
): Promise<{ ok: boolean; code: string; containerRef: string; created: boolean; raw: string }> {
  const ming = rongQiXiangMuMing(groupId);
  const cur = await projectContainerStatusOf(groupId, runtimeId);
  if (cur.exists) return { ok: true, code: 'already-exists', containerRef: ming, created: false, raw: cur.raw };
  // 镜像来源：优先用**上次固化出来的**那一层（真有才用），否则用镜像表里钉死 digest 的默认镜像
  const ledger = projectEnvLedgerOf(groupId);
  let image = String(opts.image || '');
  if (!image) {
    if (ledger.lastImageRef && shiFouYunXuJingXiang(ledger.lastImageRef)) image = ledger.lastImageRef;
    else {
      const jiedianTupian = CONTAINER_BASE_IMAGES.find((x) => x.id === 'node-24-slim');
      const zuixiao = CONTAINER_BASE_IMAGES.find((x) => x.id === 'alpine-3.20');
      const pick = jiedianTupian || zuixiao;
      image = pick && pick.digest ? `${pick.ref}@${pick.digest}` : '';
    }
  }
  if (!shiFouYunXuJingXiang(image)) return { ok: false, code: 'no-image', containerRef: ming, created: false, raw: 'no allowed image reference available' };
  const dir = String(opts.hostDir || quXiangMuMuLu(groupId).dir || '');
  const r = await yunXingRongQiZhiXing(runtimeId, 'run-detached', {
    ming,
    image,
    ...(dir && fs.existsSync(dir) ? { hostDir: dir } : {}),
    projectLabel: groupId,
  }, 180000);
  if (!r.ok) {
    return { ok: false, code: r.codeReason || 'run-failed', containerRef: ming, created: false, raw: jinyaoWenben(`${r.out} ${r.err}`, 300) };
  }
  writeProjectEnvLedger(groupId, { runtimeId, containerRef: ming, ...(image ? {} : {}) });
  return { ok: true, code: 'created', containerRef: ming, created: true, raw: r.out };
}

function jinyaoWenben(s: string, max = 300): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * ADR 004 §7.8/§7.9（第八、九批 + 第十六批）：**项目环境状态**
 * （当前容器 / 能不能固化 / 上次固化时间 / 现在该不该固化 / 保留几个）。
 * 全部来自真实事实：运行时的固化能力（按运行时区分，**不假定 Linux 容器**）、
 * 真探测里的**引擎系统模式**、以及**真发生过的**固化记录（没发生过就不写）。
 */
chuliIpc('warmy:xiangMuHuanJingZhuangTai', async (_e, payload?: { sessionId?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const state = await quXiangMuTai(id);
    const runtimeId = quXiangMuYunXingShi(id);
    const shangXian = huanJingGuHuaNengLi(runtimeId);
    const ledger = projectEnvLedgerOf(id);
    const mode = quYinQingXiTongMoShi(zuiHouRongQiTanCeBaoGao(), runtimeId);
    const container = state.devEnv === 'container' && runtimeId && state.running
      ? await projectContainerStatusOf(id, runtimeId)
      : { running: false, exists: false, containerRef: '', raw: '' };
    const decision = shiFouGaiGuHua({
      lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
      dirty: container.exists,
      programmatic: shangXian.programmatic,
    });
    const liShi = ledger.solidifyHistory || [];
    return {
      ok: true,
      sessionId: id,
      devEnv: state.devEnv,
      runtimeId,
      /** 引擎的**真实系统模式**（docker 是 linux / windows；wsl 是某个发行版；拿不到 = unknown） */
      engineMode: mode,
      solidify: {
        kind: shangXian.kind,
        programmatic: shangXian.programmatic,
        yuanYin: shangXian.reason,
        lastImageRef: ledger.lastImageRef || '',
        lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
        history: guHuaBaoLiu(liShi).keep,
        /** 保留策略：要**留着**的与可以手动清理的（我们不自作主张删镜像） */
        pruneCandidates: guHuaBaoLiu(liShi).prune,
        /** 现在该不该固化（节流 + 时机） */
        decision,
        keep: SOLIDIFY_KEEP,
        coalesceMs: SOLIDIFY_COALESCE_MS,
        /** 证据等级：有镜像引用 ⇒ 真的 commit 成功过（不是"点了就算"） */
        evidence: ledger.lastImageRef ? 'commit-succeeded' : 'none',
        security: ENV_SOLIDIFY_SECURITY,
      },
      /** 项目容器**真的在不在**（问过引擎，不是猜） */
      container: { ref: container.containerRef || rongQiXiangMuMing(id), exists: container.exists, running: container.running, probeRaw: container.raw },
      /** 项目容器**默认保留**（长期存在、不用 --rm ⇒ 停止/启动保留可写层） */
      containerRetained: true,
      /** 环境维度与文件维度是**分层**的（不许对用户说"有容器回退点就更简单"） */
      layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false },
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「固化当前环境」（第九批 + 第十六批：**真的 commit**）。
 *
 * 真的做了：能力判定（Docker/Podman/nerdctl 可 commit；**WSL 没有 commit**）→ 节流判定
 * （45s 合并 / 显式按钮 / 销毁前一定固化一次）→ `commit` 项目容器 → **回读镜像 id 才算成功** →
 * 写台账（本机记录 + 项目级摘要）→ 只留最近 3 个（多的只**报告**不删）。
 *
 * 绝不撒谎的三条：
 *   · 没真的 commit 成功 ⇒ 证据等级是 `refused`，响应里 `executed:false`，**不写"已固化"记录**；
 *   · WSL / 系统服务 / 一次性沙箱 ⇒ 如实说"做不到"（能力表说了算）；
 *   · **安全提醒**随响应回传（commit 会把整个文件系统、可能包括密钥一起固化）。
 */
chuliIpc('warmy:xiangMuHuanJingGuHua', async (_e, payload?: { sessionId?: string; explicit?: boolean; beforeDestroy?: boolean }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = quXiangMuYunXingShi(id);
    const shangXian = huanJingGuHuaNengLi(runtimeId);
    const ledger = projectEnvLedgerOf(id);
    const decision = shiFouGaiGuHua({
      lastSolidifiedAt: ledger.lastSolidifiedAt || 0,
      dirty: true,
      explicit: payload?.explicit === true,
      beforeDestroy: payload?.beforeDestroy === true,
      programmatic: shangXian.programmatic,
    });
    const security = ENV_SOLIDIFY_SECURITY;
    if (shangXian.programmatic !== true) {
      return { ok: false, code: 'runtime-cannot-solidify', solidifyKind: shangXian.kind, yuanYin: shangXian.reason, executed: false, decision, evidence: 'refused', security };
    }
    if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, decision, evidence: 'refused', security };
    // 节流：窗口内不重复固化（除非这次是"销毁前/显式"—— 那两条 shouldSolidifyAt 已经放行）
    if (decision.solidify !== true) {
      return { ok: false, code: decision.code === 'coalesced' ? 'coalesced' : 'nothing-to-solidify', executed: false, decision, evidence: 'not-attempted', security };
    }
    // 容器必须真的在（不在就没东西可固化 —— 不自动起容器来"凑"一次固化）
    const container = await projectContainerStatusOf(id, runtimeId);
    if (!container.exists) {
      return {
        ok: false, code: 'no-container', executed: false, decision, evidence: 'refused',
        detail: 'the project container does not exist yet (start the project first)',
        containerRef: container.containerRef || rongQiXiangMuMing(id), security,
      };
    }
    const at = Date.now();
    const imageRef = solidifiedImageRef(id, at);
    const commit = await yunXingRongQiZhiXing(runtimeId, 'commit', { ming: container.containerRef, imageRef }, 600000);
    if (!commit.ok) {
      return {
        ok: false, code: 'commit-failed', executed: true, evidence: 'refused', decision,
        detail: commit.codeReason || 'commit failed',
        rawOutput: jinyaoWenben(`${commit.out} ${commit.err}`, 400),
        imageRef, security,
      };
    }
    // **回读**：拿镜像 id 才算真的固化成功（"命令 rc=0"不足以当证据）
    const jiancha = await yunXingRongQiZhiXing(runtimeId, 'image-inspect', { image: imageRef }, 60000);
    const imageId = jiancha.ok ? String(jiancha.out.split('|')[0] || '').trim() : '';
    if (!jiancha.ok || !imageId) {
      return {
        ok: false, code: 'commit-unverified', executed: true, evidence: 'refused', decision, imageRef,
        detail: 'commit returned success but the image could not be read back',
        rawOutput: jinyaoWenben(`${jiancha.out} ${jiancha.err ?? ''}`, 300), security,
      };
    }
    writeProjectEnvLedger(id, { runtimeId, containerRef: container.containerRef, imageRef, solidifiedAt: at });
    audit?.log('container.project-solidify', { sessionId: id, runtimeId, imageRef });
    fachuKongzhitai({ cat: 'system', code: 'container.project.solidified', data: { sessionId: id, imageRef } });
    const liShi = projectEnvLedgerOf(id).solidifyHistory || [];
    return {
      ok: true,
      executed: true,
      evidence: 'commit-succeeded',
      decision,
      imageRef,
      imageId,
      ms: commit.ms,
      containerRef: container.containerRef,
      solidifiedAt: at,
      history: guHuaBaoLiu(liShi).keep,
      pruneCandidates: guHuaBaoLiu(liShi).prune,
      /** 安全提醒：这次固化把当时的**整个文件系统**一起冻进去了（可能含密钥/缓存） */
      security,
      securityNotice: 'whole-filesystem-frozen',
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), executed: false, evidence: 'refused' };
  }
});

/**
 * 「回滚到固化点」（第十六批）：从固化出来的镜像**真的起一个容器**。
 *
 * 与"文件回退点"是**分层**的两件事（ADR §8.5）：固化镜像只覆盖容器可写层，
 * **bind mount 的项目文件不在里面** —— 所以响应里把这条事实一起回给渲染层，别让用户误解。
 * 步骤：确保容器在（不在就按镜像起）→ 用指定/最近的固化镜像重建 → 回读容器 id。
 */
chuliIpc('warmy:xiangMuHuanJingHuiGun', async (_e, payload?: { sessionId?: string; imageRef?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const runtimeId = quXiangMuYunXingShi(id);
    const shangXian = huanJingGuHuaNengLi(runtimeId);
    if (!runtimeId) return { ok: false, code: 'no-runtime-chosen', executed: false, evidence: 'refused' as const };
    if (shangXian.programmatic !== true) return { ok: false, code: 'runtime-cannot-solidify', yuanYin: shangXian.reason, executed: false, evidence: 'refused' as const };
    const ledger = projectEnvLedgerOf(id);
    const want = String(payload?.imageRef || ledger.lastImageRef || '');
    if (!want || !shiFouYunXuJingXiang(want)) {
      return { ok: false, code: 'no-solidified-point', executed: false, evidence: 'refused' as const, detail: 'no solidified image recorded for this project' };
    }
    const state = await quXiangMuTai(id);
    if (!state.running) {
      // 项目不可用 ⇒ 不越权起容器（那正是"等同创建者下线"要拦的事）
      return { ok: false, code: 'project-unavailable', projectCode: state.code, executed: false, evidence: 'refused' as const };
    }
    const ming = rongQiXiangMuMing(id);
    const cur = await projectContainerStatusOf(id, runtimeId);
    /**
     * 重建前**先固化一次**（"可能销毁容器之前一定固化一次"这条时机的落点）：
     * 不这么做，回滚就等于把用户刚装的东西丢掉。固化失败也**照实说**，但不挡住回滚本身。
     */
    let preSolidify: { ok: boolean; code: string; imageRef?: string } = { ok: false, code: 'skipped' };
    if (cur.exists) {
      const decision = shiFouGaiGuHua({ lastSolidifiedAt: ledger.lastSolidifiedAt || 0, dirty: true, beforeDestroy: true, programmatic: shangXian.programmatic });
      if (decision.solidify) {
        const at = Date.now();
        const ref = solidifiedImageRef(id, at);
        const c = await yunXingRongQiZhiXing(runtimeId, 'commit', { ming, imageRef: ref }, 600000);
        const shiLi = c.ok ? await yunXingRongQiZhiXing(runtimeId, 'image-inspect', { image: ref }, 60000) : null;
        const JingXiangId = shiLi && shiLi.ok ? String(shiLi.out.split('|')[0] || '').trim() : '';
        if (c.ok && JingXiangId) {
          writeProjectEnvLedger(id, { runtimeId, containerRef: ming, imageRef: ref, solidifiedAt: at });
          preSolidify = { ok: true, code: 'before-destroy', imageRef: ref };
        } else {
          preSolidify = { ok: false, code: c.ok ? 'commit-unverified' : (c.codeReason || 'commit-failed') };
        }
      }
    }
    guanBiZhiDingHuiHua(id);
    if (cur.exists) await yunXingRongQiZhiXing(runtimeId, 'rm', { ming }, 120000);
    const dir = quXiangMuMuLu(id).dir;
    const run = await yunXingRongQiZhiXing(runtimeId, 'run-detached', {
      ming, image: want, ...(dir && fs.existsSync(dir) ? { hostDir: dir } : {}), projectLabel: id,
    }, 180000);
    if (!run.ok) {
      return {
        ok: false, code: run.codeReason || 'run-failed', executed: true, evidence: 'refused' as const,
        imageRef: want, rawOutput: jinyaoWenben(`${run.out} ${run.err}`, 400), preSolidify,
      };
    }
    const after = await projectContainerStatusOf(id, runtimeId);
    audit?.log('container.project-rollback', { sessionId: id, runtimeId, imageRef: want });
    fachuKongzhitai({ cat: 'system', code: 'container.project.rolledback', data: { sessionId: id, imageRef: want } });
    return {
      ok: true,
      executed: true,
      /** 证据等级：真的从那个镜像起了一个容器（有名字 + 真实 ps 为证） */
      evidence: 'container-started' as const,
      imageRef: want,
      containerRef: ming,
      containerRunning: after.running,
      ms: run.ms,
      preSolidify,
      /** 分层事实：环境回退 ≠ 文件回退（bind mount 的项目文件不在镜像里） */
      layering: { fileRollbackIndependent: true, snapshotCoversProjectFiles: false },
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), executed: false, evidence: 'refused' as const };
  }
});

/**
 * ADR 004 P4（第十六批：**真的接上容器内执行**）：**容器内的 shell**（= 控制台本体）。
 *
 * 控制台**就是容器里的控制台**，其价值是给主机带来安全性防护；它**不是**应用内部事件日志
 * （那一版做错了，已撤销：事件日志降级为独立的诊断视图，见渲染层的 `#kongZhiTaiMianBan`）。
 *
 * 架构（产品主第七批定稿）：**AI 执行器留在主机，只把"用户项目的命令/工具执行"送进容器**
 * （即 `exec` 进那个项目容器）。所以镜像**不需要**因为"我们的执行器是 Node 写的"而塞 Node ——
 * 镜像按项目技术栈选（见 CONTAINER_BASE_IMAGES / CONTAINER_NODE_NEEDED_CASES）。
 *
 * 现在真的做了什么（每一步都能查证）：
 *   · `daKai`  ⇒ 确保项目容器存在（`docker run -d`，**默认不删** ⇒ 保留可写层）→ `docker exec -i sh`；
 *   · `write` ⇒ 把 data 写进那个 shell 的 **stdin**，并把容器回显的输出取回来（`executed:true`）；
 *   · `close` ⇒ 关掉 stdin（1.5s 后退不掉才杀我们自己的子进程）；
 *   · `status`⇒ 真的问引擎（`ps`）在不在，并回会话清单。
 * ⚠️ 本处理函数**自己不 spawn 任何东西**：所有进程都由 container-probe 的
 *    `runContainerExec` / `openContainerShellSession` 起（argv 由那张**固定命令表**拼）。
 *
 * 安全契约（逐条对应 CONTAINER_SHELL_SECURITY / CONTAINER_EXEC_SECURITY，并随响应回给渲染层）：
 *   只有本机的人手动输入才会执行；远程/群成员/智能体/网络内容没有注入路径；
 *   不自动执行；不把本机密钥类环境变量带进容器；**未就绪 ⇒ 一条命令都不执行**。
 */
chuliIpc('warmy:rongQiKongZhiTai', async (_e, payload?: { runtimeId?: string; action?: string; sessionId?: string; data?: string }) => {
  const guiFanHua = guiFanKongZhiTaiQingQiu(payload);
  if (!guiFanHua.ok) {
    fachuKongzhitai({ cat: 'error', code: 'container.console.rejected', data: { code: guiFanHua.code } });
    return { ok: false, code: guiFanHua.code, error: guiFanHua.error, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY };
  }
  const { Qiu } = guiFanHua;
  const state = await quXiangMuTai(Qiu.sessionId);
  const runtimeId = Qiu.runtimeId || quXiangMuYunXingShi(Qiu.sessionId);
  const status = runtimeId ? await quRongQiZhuangTai(runtimeId) : null;
  const menjin = rongQiKongZhiTaiMenJin({
    inProjectOrCattle: true,
    // 控制台只属于**容器开发**的项目（"运行/测试在容器中"那个选项已作废删除）
    runInContainer: state.devEnv === 'container',
    projectStopped: state.stopped,
    runtimeId,
    runtimeStatus: (status as never) ?? null,
    /**
     * 镜像来源**已经定了**：镜像表里钉死 digest 的基础镜像（+ 我们自己固化出来的层）。
     * 所以门禁的第 ⑤ 档不再长期成立 —— 引擎就绪就能真的开 shell（这条是本轮的实质变化）。
     */
    imageReady: !!runtimeId && state.devEnv === 'container' && shiFouYunXuJingXiang(defaultProjectImageRef()),
  });
  if (!menjin.available) {
    if (Qiu.action === 'write' || Qiu.action === 'daKai') {
      fachuKongzhitai({ cat: 'error', code: 'container.console.refused', data: { code: menjin.code, reasonKey: menjin.reason, action: Qiu.action } });
    }
    return {
      ok: false,
      code: menjin.code,
      reasonKey: menjin.reason,
      needsInstall: menjin.needsInstall,
      executed: false, // 【核心】没就绪 ⇒ **一条命令都没执行**
      runtimeId,
      projectCode: state.code,
      security: CONTAINER_SHELL_SECURITY,
      execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }

  const ming = rongQiXiangMuMing(Qiu.sessionId);
  if (Qiu.action === 'status') {
    const cur = await projectContainerStatusOf(Qiu.sessionId, runtimeId);
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: false, runtimeId, containerRef: cur.containerRef || ming,
      containerExists: cur.exists, containerRunning: cur.running,
      sessionId: String(payload?.sessionId || ''),
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  if (Qiu.action === 'daKai') {
    const yiBaoZhang = await baozhangXiangmuRongqi(Qiu.sessionId, runtimeId);
    if (!yiBaoZhang.ok) {
      fachuKongzhitai({ cat: 'error', code: 'container.console.refused', data: { code: yiBaoZhang.code, action: 'daKai' } });
      return {
        ok: false, code: yiBaoZhang.code, reasonKey: yiBaoZhang.code === 'no-image' ? 'needsImage' : 'notReady',
        executed: false, runtimeId, containerRef: yiBaoZhang.containerRef, rawOutput: yiBaoZhang.raw,
        projectCode: state.code, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
      };
    }
    // **解锁**宿主目录（如果这个项目被加过锁）：容器要在同一份 bind mount 上写，
    // 让锁和正在运行的容器同时存在会互相打脸（这条在 fsGuard 那边也写着）
    liftFsGuardIfAny(Qiu.sessionId, 'container-started');
    const opened = daKaiKongZhiTaiHuiHua({ groupId: Qiu.sessionId, runtimeId, containerName: yiBaoZhang.containerRef });
    if (!opened.ok) {
      fachuKongzhitai({ cat: 'error', code: 'container.console.refused', data: { code: opened.code, action: 'daKai' } });
      return {
        ok: false, code: opened.code || 'spawn-failed', reasonKey: 'notReady', executed: false,
        runtimeId, containerRef: yiBaoZhang.containerRef, error: opened.error,
        security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
      };
    }
    fachuKongzhitai({ cat: 'system', code: 'container.console.opened', data: { sessionId: Qiu.sessionId, containerRef: yiBaoZhang.containerRef } });
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId, containerRef: yiBaoZhang.containerRef,
      sessionId: opened.sessionId, /** 真的是容器里的 shell（不是宿主 shell、不是事件日志） */
      insideContainer: true, containerCreated: yiBaoZhang.created,
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  if (Qiu.action === 'close') {
    // `sessionId` 既可以是 shell 会话 id，也可以是项目 id（container-probe 侧两者都能解析）
    const r = guanBiKongZhiTaiHuiHua(Qiu.sessionId || String(payload?.sessionId || ''));
    return {
      ok: true, code: 'ok', reasonKey: 'ok', executed: r.closed, runtimeId, containerRef: ming,
      closed: r.closed, security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  // write：真的写进那个 shell 的 stdin
  const xieru = await xieRuKongZhiTaiHuiHua(Qiu.sessionId, Qiu.data);
  if (!xieru.ok) {
    // 会话没了 ⇒ 如实说"得先打开"，**不**偷偷开一条新的（那会绕过用户的重启意图）
    return {
      ok: false, code: xieru.code || 'no-session', reasonKey: 'notReady', executed: false,
      runtimeId, containerRef: ming, error: xieru.error, shuChu: '',
      security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
    };
  }
  fachuKongzhitai({ cat: 'tool', code: 'container.console.exec', data: { sessionId: Qiu.sessionId, bytes: Qiu.data.length } });
  /**
   * 「一条控制台命令之后」这个固化时机（ADR §8.6 的时机表之一）：
   * 只在**节流窗口外**且确实该固化时才真的 commit（45s 合并，避免"敲一行就固化一个镜像"）。
   * 失败不影响命令本身的返回（如实附带 autoSolidify 结果）。
   */
  const autoSolidify = await maybeSolidifyAfterConsole(Qiu.sessionId, runtimeId);
  /**
   * 容器里的命令**真的可能改了项目文件** ⇒ 如实记一条台账（项目级、成员可见）。
   * 我们只记"发生过一次容器内命令"这个事实 + 挂载点，**不假装知道具体改了哪个文件**
   * （容器里没有文件系统审计，编一个路径出来比不记更糟）。
   */
  const dir = quXiangMuMuLu(Qiu.sessionId).dir;
  if (dir) {
    beizhuWaibuWenjianFangwenQiu(Qiu.sessionId, 'write', `${path.sep}${RONGQI_XIANGMU_GUAZAI.replace(/^\//, '')}`, { by: 'container-shell' });
  }
  return {
    ok: true, code: 'ok', reasonKey: 'ok', executed: true, runtimeId, containerRef: ming,
    shuChu: xieru.shuChu || '', autoSolidify,
    security: CONTAINER_SHELL_SECURITY, execSecurity: CONTAINER_EXEC_SECURITY,
  };
});

/** 默认项目镜像引用（镜像表里带 Node 的那个；取不到就退回最小镜像） */
function defaultProjectImageRef(): string {
  const jiedianTupian = CONTAINER_BASE_IMAGES.find((x) => x.id === 'node-24-slim' && x.digest);
  const min = CONTAINER_BASE_IMAGES.find((x) => x.digest);
  const pick = jiedianTupian || min;
  return pick && pick.digest ? `${pick.ref}@${pick.digest}` : '';
}

/** 记一条外部（容器侧）文件访问到项目台账 */
function beizhuWaibuWenjianFangwenQiu(groupId: string, op: 'write' | 'edit' | 'create' | 'delete' | 'read', file: string, extra: { by?: string } = {}): void {
  try {
    const qunId = String(groupId || '');
    if (!groupStore || !qunId) return;
    groupStore.recordFileAccess(qunId, { op, path: String(file), ts: Date.now(), ok: true, by: extra.by || 'container' });
    void faBuXiangMuShuXing(qunId);
  } catch {
    /* 记账失败不影响执行 */
  }
}

/**
 * 「一条控制台命令之后」的固化时机：只在**该固化**且**真的成功**时写台账。
 * 返回结构化结果（渲染层可以如实显示"这一轮顺带固化了一次"或"被节流了"）。
 */
async function maybeSolidifyAfterConsole(
  groupId: string,
  runtimeId: string
): Promise<{ attempted: boolean; done: boolean; code: string; imageRef?: string }> {
  try {
    const shangXian = huanJingGuHuaNengLi(runtimeId);
    const ledger = projectEnvLedgerOf(groupId);
    const decision = shiFouGaiGuHua({ lastSolidifiedAt: ledger.lastSolidifiedAt || 0, dirty: true, programmatic: shangXian.programmatic });
    if (!decision.solidify) return { attempted: false, done: false, code: decision.code };
    const ming = rongQiXiangMuMing(groupId);
    const cur = await projectContainerStatusOf(groupId, runtimeId);
    if (!cur.exists) return { attempted: false, done: false, code: 'no-container' };
    const at = Date.now();
    const ref = solidifiedImageRef(groupId, at);
    const c = await yunXingRongQiZhiXing(runtimeId, 'commit', { ming, imageRef: ref }, 600000);
    if (!c.ok) return { attempted: true, done: false, code: c.codeReason || 'commit-failed' };
    const shiLi = await yunXingRongQiZhiXing(runtimeId, 'image-inspect', { image: ref }, 60000);
    const JingXiangId = shiLi.ok ? String(shiLi.out.split('|')[0] || '').trim() : '';
    if (!JingXiangId) return { attempted: true, done: false, code: 'commit-unverified' };
    writeProjectEnvLedger(groupId, { runtimeId, containerRef: ming, imageRef: ref, solidifiedAt: at });
    fachuKongzhitai({ cat: 'system', code: 'container.project.solidified', data: { sessionId: groupId, imageRef: ref, trigger: 'after-console' } });
    return { attempted: true, done: true, code: 'after-console', imageRef: ref };
  } catch (e) {
    return { attempted: true, done: false, code: 'error:' + xiJingCuoWu(e) };
  }
}

/**
 * 「把项目的命令送进容器」（第十六批）：在项目容器里跑一条**固定命令**（枚举），
 * 用于环境探测 / 证明工具调用真的跑在容器里。
 * ⚠️ 参数里**没有命令字符串**：`command` 只能取 `CONTAINER_FIXED_COMMAND_IDS` 里的 id。
 */
chuliIpc('warmy:xiangMuZhiXing', async (_e, payload?: { sessionId?: string; command?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const command = String(payload?.command || 'env-probe');
    if (!CONTAINER_FIXED_COMMAND_IDS.includes(command as RongQiGuDingMingLingId)) {
      return { ok: false, code: 'bad-command', executed: false, error: `command must be one of ${CONTAINER_FIXED_COMMAND_IDS.join('|')}` };
    }
    const state = await quXiangMuTai(id);
    const runtimeId = quXiangMuYunXingShi(id);
    if (state.devEnv !== 'container' || state.stopped || !runtimeId) {
      // **绝不静默退回宿主执行**：项目不可用 ⇒ 直接拒绝（这就是那条硬纪律）
      return { ok: false, code: 'project-unavailable', projectCode: state.code, executed: false, hostExecutionRefused: true };
    }
    const status = await quRongQiZhuangTai(runtimeId);
    if (status !== 'ready') return { ok: false, code: 'container-not-ready', executed: false, needsInstall: true };
    const yiBaoZhang = await baozhangXiangmuRongqi(id, runtimeId);
    if (!yiBaoZhang.ok) return { ok: false, code: yiBaoZhang.code, executed: false, containerRef: yiBaoZhang.containerRef, rawOutput: yiBaoZhang.raw };
    liftFsGuardIfAny(id, 'container-started');
    const r = await yunXingRongQiZhiXing(runtimeId, 'exec-capture', { ming: yiBaoZhang.containerRef, command }, 120000);
    fachuKongzhitai({ cat: 'tool', code: 'container.project.exec', data: { sessionId: id, command, ok: r.ok } });
    return {
      ok: r.ok,
      executed: r.executed,
      /** 结果**来自容器**（`insideContainer:true` 是事实，不是文案） */
      insideContainer: true,
      command,
      containerRef: yiBaoZhang.containerRef,
      code: r.code,
      shuChu: r.out,
      error: r.err,
      ms: r.ms,
      codeReason: r.codeReason,
      security: CONTAINER_EXEC_SECURITY,
      fixedCommands: CONTAINER_FIXED_COMMAND_IDS,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), executed: false };
  }
});

/**
 * 「设置项目目录」（第十六批）：把项目目录记进**项目记录**（产品级事实，成员可见）。
 *
 * 为什么需要它：`GroupRecord` 之前**没有目录字段**，所以"最近改动文件 / 其他文件 / 产物目录"
 * 三块都没有一个解析根（ADR §8.3 的第二个数据源缺口）。现在由创建者选一次目录，
 * 记录进项目记录并同步给成员 —— 成员那边也能按同一个根解析。
 * 安全：只接受 `{ sessionId }`，目录**由主进程弹系统对话框选**（渲染层给不了任意路径）。
 */
chuliIpc('warmy:xiangMuSheZhiMuLu', async (_e, payload?: { sessionId?: string; dir?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    if (!benJiShiXiangMuChuangJianZhe(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can set the project directory' };
    }
    let dir = String(payload?.dir || '');
    if (!dir) {
      if (!win) return { ok: false, code: 'no-window', error: 'no window' };
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      dir = r.filePaths[0];
    }
    if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { ok: false, code: 'bad-dir', error: 'directory does not exist' };
    }
    const w = sheZhiXiangMuShuXing(id, { directory: dir, directorySource: 'creator-picked' });
    if (!w.ok) return { ok: false, code: 'cannot-persist', error: w.error };
    audit?.log('container.project-set-directory', { sessionId: id });
    const shiShi = await projectFilesFor(id);
    return { ok: true, dir, projectDirReason: shiShi.projectDirReason, projectSource: shiShi.projectSource };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 「工具文件访问台账」（第十六批）：**项目级、成员可见**的读取入口。
 * 产品主的原话：**「记录文件的改动应该是无限牛马的功能，不是本机的功能」**
 * ⇒ 台账存在项目记录里、会随项目同步给成员，所以成员也能看到"谁改了什么、什么时候改的"。
 */
chuliIpc('warmy:xiangMuZhangBen', (_e, payload?: { sessionId?: string; limit?: number }) => {
  try {
    const id = String(payload?.sessionId || '');
    const rows = groupStore?.listFileAccess(id, Number(payload?.limit) || 200) || [];
    const attrs = quXiangMuShuXing(id);
    const dir = attrs.directory;
    return {
      ok: true,
      sessionId: id,
      /** 成员可见的台账（项目级） */
      entries: rows.map((e2) => ({
        op: e2.op, path: e2.path, ts: e2.ts, ok: e2.ok, by: e2.by,
        ...(e2.bytes ? { bytes: e2.bytes } : {}),
        scope: dir && path.resolve(e2.path).startsWith(path.resolve(dir) + path.sep) ? 'project' : 'other',
      })),
      projectDir: dir,
      projectDirReason: attrs.directory ? attrs.directorySource : 'not-recorded',
      projectSource: projectAttrsAreRemote(id) ? 'creator-signal' : 'local',
      /** 台账的归属是项目而不是本机 —— 把这条事实一起回给渲染层（可断言） */
      scope: 'project',
      entryLimit: 200,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   宿主侧目录加锁（P5）：把"宿主侧不许编辑"从**应用内拒绝**推进到**文件系统**
   ---------------------------------------------------------------------------
   背景（ADR 004 §7.1 的诚实边界）：应用侧能拒绝自己写，拦不住用户用外部编辑器改。
   实现（最小侵入 + 可撤销，见 container-probe.HOST_DIR_GUARD_SECURITY）：
     · **只有用户显式按键**才加锁（绝不自动加）；Windows 上用一条继承式 deny ACE
       （`icacls <dir> /deny *<sid>:(OI)(CI)(W)`）挂在项目目录根上；
     · 撤销 = `icacls <dir> /remove:d *<sid>`（一条命令；目录属主永远能改自己的 DACL）；
     · 记录写在本机设置 `fsGuard[groupId]`（ACL 是本机事实，不是项目属性）；
     · **容器一启动就自动解锁**（容器要在同一份 bind mount 上写，锁着会互相打脸），
       并在响应里如实说明"因为容器启动了所以解锁了"。
   做不到的（如实写在 UI 里）：这不是加密/沙箱，同机管理员与系统进程照样能写。
   ══════════════════════════════════════════════════════════════════════════ */

/** 当前用户的 SID（`whoami /user` 的真实输出；拿不到就不给加锁入口） */
async function dangqianYonghuHuihuaId(): Promise<string> {
  if (process.platform !== 'win32') return '';
  return new Promise((resolve) => {
    try {
      const Zhi = execFile('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 15000, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve('');
        const m = String(stdout || '').match(/(S-1-\d+(?:-\d+)+)/);
        resolve(m && m[1] ? m[1] : '');
      });
      Zhi.on('error', () => resolve(''));
    } catch {
      resolve('');
    }
  });
}

async function runIcacls(plan: { file: string; args: string[] }): Promise<{ ok: boolean; code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    try {
      execFile(plan.file, plan.args, { windowsHide: true, timeout: 120000, maxBuffer: 1 << 22, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, code: 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
        const e2 = err as NodeJS.ErrnoException & { code?: number | string };
        resolve({ ok: false, code: typeof e2.code === 'number' ? e2.code : null, out: String(stdout || '').trim(), err: String(stderr || e2.message || '').trim() });
      });
    } catch (e) {
      resolve({ ok: false, code: null, out: '', err: xiJingCuoWu(e) });
    }
  });
}

function fsGuardRecordOf(groupId: string): { dir: string; sid: string; appliedAt: number; liftedAt?: number } | null {
  try {
    const m = (settingsStore?.load()?.fsGuard || {})[String(groupId)];
    return m || null;
  } catch {
    return null;
  }
}

function writeFsGuardRecord(groupId: string, jiLu: { dir: string; sid: string; appliedAt: number; liftedAt?: number } | null): void {
  try {
    if (!settingsStore) return;
    const all = { ...(settingsStore.load().fsGuard || {}) };
    if (jiLu) all[String(groupId)] = jiLu;
    else delete all[String(groupId)];
    settingsStore.save({ fsGuard: all } as never);
  } catch {
    /* 记不上就不记（下一次 status 会如实报"查不到记录"） */
  }
}

/** 容器一启动就解锁（如果这个项目被加过锁）；如实返回发生了什么 */
function liftFsGuardIfAny(groupId: string, reason: string): { lifted: boolean; dir?: string } {
  const jiLu = fsGuardRecordOf(groupId);
  if (!jiLu || jiLu.liftedAt) return { lifted: false };
  try {
    const plan = zhuJiMuLuHuLanJiHua({ action: 'lift', dir: jiLu.dir, sid: jiLu.sid });
    if (!plan.ok) return { lifted: false };
    const r = runIcaclsSync(plan.plan);
    if (!r.ok) return { lifted: false };
    writeFsGuardRecord(groupId, { ...jiLu, liftedAt: Date.now() });
    audit?.log('container.fs-guard.lift', { sessionId: groupId, reason });
    fachuKongzhitai({ cat: 'system', code: 'container.fsGuard.lifted', data: { sessionId: groupId, reason } });
    return { lifted: true, dir: jiLu.dir };
  } catch {
    return { lifted: false };
  }
}

/** 同步跑一次 icacls（"启动容器之前"这条关键路径必须先把锁摘掉） */
function runIcaclsSync(plan: { file: string; args: string[] }): { ok: boolean; err: string } {
  try {
    execFileSync(plan.file, plan.args, { windowsHide: true, timeout: 60000, stdio: 'ignore' });
    return { ok: true, err: '' };
  } catch (e) {
    return { ok: false, err: xiJingCuoWu(e) };
  }
}

/**
 * 「锁定 / 解锁项目目录」（右键菜单，**只有创建者**）：
 *   · `status` = 只读查询（目录 + SID + 加锁记录 + 当前那条 ACE 在不在）；
 *   · `apply`  = 真的加锁（一条继承式 deny ACE）；
 *   · `lift`   = 真的撤销（一条 `/remove:d`）—— **永远给出还原路径**。
 */
chuliIpc('warmy:xiangMuWenJianXiTongShouWei', async (_e, payload?: { sessionId?: string; action?: string }) => {
  try {
    const id = String(payload?.sessionId || '');
    const action = String(payload?.action || 'status');
    if (!['apply', 'lift', 'status'].includes(action)) return { ok: false, code: 'bad-action', error: 'action must be apply|lift|status' };
    if (action !== 'status' && !benJiShiXiangMuChuangJianZhe(id)) {
      return { ok: false, code: 'not-creator', error: 'only the creator can lock or unlock the project directory' };
    }
    const attrs = quXiangMuShuXing(id);
    const dir = attrs.directory;
    const jiLu = fsGuardRecordOf(id);
    const sid = await dangqianYonghuHuihuaId();
    const base = {
      ok: true,
      sessionId: id,
      action,
      dir: dir || '',
      dirReason: attrs.directory ? attrs.directorySource : 'not-recorded',
      sid,
      /** 只有容器开发项目才谈得上"宿主侧不该改" */
      devEnv: attrs.devEnv,
      record: jiLu,
      /** 平台能力：非 Windows 如实说做不到（不假装） */
      platformSupported: process.platform === 'win32' && !!sid,
      security: HOST_DIR_GUARD_SECURITY,
      notes: {
        userInitiatedOnly: true,
        undo: 'icacls <dir> /remove:d *<sid>  (one command; the owner can always change their own DACL)',
        limitations: 'not encryption/sandbox; admin and system processes can still write',
      },
    };
    if (!dir) return { ...base, ok: false, code: 'no-project-dir', error: 'project directory is not recorded yet' };
    if (attrs.devEnv !== 'container') return { ...base, ok: false, code: 'not-container-project', error: 'only container-dev projects can lock their host directory' };
    if (process.platform !== 'win32' || !sid) return { ...base, ok: false, code: 'platform-not-supported', error: 'locking is only implemented on Windows (icacls)' };

    if (action === 'status') {
      const plan = zhuJiMuLuHuLanJiHua({ action: 'status', dir, sid });
      if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
      const r = await runIcacls(plan.plan);
      const denies = String(r.out || '')
        .split(/\r?\n/)
        .filter((l) => /\(DENY\)/i.test(l))
        .map((l) => jinyaoWenben(l, 200));
      return {
        ...base,
        ok: true,
        /** 文件系统层面**现在**是不是锁着（读真实 ACL，不看我们的记录） */
        guarded: r.ok && denies.length > 0,
        denyEntries: denies.slice(0, 5),
        raw: jinyaoWenben(r.out || r.err, 500),
        /**
         * 记录与事实不一致时**如实标出来**（例如用户自己在应用外改了 ACL）：
         * 这是我们"不假装锁着"的判据。
         */
        recordMatchesFilesystem: jiLu ? (r.ok && denies.length > 0 && !jiLu.liftedAt) : false,
      };
    }

    if (action === 'apply') {
      if (jiLu && !jiLu.liftedAt) return { ...base, ok: true, guarded: true, already: true };
      const plan = zhuJiMuLuHuLanJiHua({ action: 'apply', dir, sid });
      if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
      const r = await runIcacls(plan.plan);
      if (!r.ok) return { ...base, ok: false, code: 'icacls-failed', error: jinyaoWenben(r.err, 300) };
      writeFsGuardRecord(id, { dir, sid, appliedAt: Date.now() });
      audit?.log('container.fs-guard.apply', { sessionId: id });
      fachuKongzhitai({ cat: 'system', code: 'container.fsGuard.applied', data: { sessionId: id } });
      return { ...base, ok: true, guarded: true, appliedAt: Date.now(), denies: plan.plan.denies };
    }

    // lift
    const plan = zhuJiMuLuHuLanJiHua({ action: 'lift', dir, sid });
    if (!plan.ok) return { ...base, ok: false, code: plan.code, error: plan.error };
    const r = await runIcacls(plan.plan);
    if (!r.ok) return { ...base, ok: false, code: 'icacls-failed', error: jinyaoWenben(r.err, 300) };
    writeFsGuardRecord(id, { dir, sid, appliedAt: jiLu ? jiLu.appliedAt : Date.now(), liftedAt: Date.now() });
    audit?.log('container.fs-guard.lift', { sessionId: id, reason: 'user' });
    fachuKongzhitai({ cat: 'system', code: 'container.fsGuard.lifted', data: { sessionId: id, reason: 'user' } });
    return { ...base, ok: true, guarded: false, liftedAt: Date.now() };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 本地账号 ──

// ── 本地 SKILL：扫描 / 删除 ──
function skillMdInfo(file: string): { ming: string; description: string } {
  let ming = '';
  let description = '';
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    const touBu = fm && fm[1] ? fm[1] : '';
    if (touBu) {
      const mingCheng = touBu.match(/^\s*ming\s*:\s*(.+)$/m);
      const dm = touBu.match(/^\s*description\s*:\s*(.+)$/m);
      if (mingCheng && mingCheng[1]) ming = mingCheng[1].trim().replace(/^["']|["']$/g, '');
      if (dm && dm[1]) description = dm[1].trim().replace(/^["']|["']$/g, '');
    }
    if (!ming) {
      const h = raw.match(/^#\s+(.+)$/m);
      if (h && h[1]) ming = h[1].trim();
    }
    if (!description) {
      const ti = raw.replace(/^---[\s\S]*?---/, '').replace(/^#.*$/gm, '').trim();
      description = (ti.split(/\n\s*\n/)[0] || '').replace(/\s+/g, ' ').slice(0, 180);
    }
  } catch {
    /* 忽略 */
  }
  return { ming, description };
}

/** Read skill auto-discovery directories from the EXISTING settings channel. */
function jiaZaiJinengSaomiaoLuJing(): string[] {
  try {
    const s = settingsStore?.load() as { skillScanDirs?: unknown } | undefined;
    const dirs = s && Array.isArray(s.skillScanDirs) ? s.skillScanDirs : [];
    return dirs.map((d) => String(d || '').trim()).filter(Boolean).slice(0, SKILL_SCAN_DIRS_MAX);
  } catch {
    return [];
  }
}

/** Honest per-directory status: missing / not-a-directory / read-failed are reported, never silently ignored. */
function jinengSaomiaoZhuangtai(dirs: string[]): Array<{ path: string; ok: boolean; error: string | null; skillCount: number }> {
  return dirs.map((p) => {
    const jueDuiLu = path.resolve(p);
    if (!fs.existsSync(jueDuiLu)) return { path: p, ok: false, error: 'missing', skillCount: 0 };
    let st: import('node:fs').Stats;
    try {
      st = fs.statSync(jueDuiLu);
    } catch {
      return { path: p, ok: false, error: 'stat-failed', skillCount: 0 };
    }
    if (!st.isDirectory()) return { path: p, ok: false, error: 'not-a-directory', skillCount: 0 };
    let skillCount = 0;
    try {
      // Directory itself may be a skill (contains SKILL.md)
      if (fs.existsSync(path.join(jueDuiLu, 'SKILL.md'))) skillCount += 1;
      const zixiang = fs.readdirSync(jueDuiLu, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      for (const d of zixiang) {
        if (fs.existsSync(path.join(jueDuiLu, d, 'SKILL.md'))) skillCount += 1;
      }
    } catch {
      return { path: p, ok: false, error: 'read-failed', skillCount: 0 };
    }
    return { path: p, ok: true, error: null, skillCount };
  });
}

function jinengGen(): Array<{ root: string; source: string }> {
  const roots: Array<{ root: string; source: string }> = [];
  try {
    roots.push({ root: path.join(app.getPath('userData'), 'skills'), source: 'userData' });
  } catch {
    /* 忽略 */
  }
  const local = path.join(process.cwd(), 'skills');
  if (fs.existsSync(local)) roots.push({ root: local, source: 'workspace' });
  // Auto-discovery directories (source = 'discovered'); invalid paths are kept out of the
  // scan roots but reported via skillScanStatus qiYong skills-list / skills-scan-dirs-get.
  for (const dir of jiaZaiJinengSaomiaoLuJing()) {
    try {
      const jueDuiLu = path.resolve(dir);
      if (fs.existsSync(jueDuiLu) && fs.statSync(jueDuiLu).isDirectory()) {
        roots.push({ root: jueDuiLu, source: 'discovered' });
      }
    } catch {
      /* status is reported separately */
    }
  }
  return roots;
}

/* ══════════════════════════════════════════════════════════════════════
   「工具」面板（产品要求）：AI 要用的工具都放在这里，和技能一样
   可停用/启用、手动安装/导入、添加自动发现的目录。
   ══════════════════════════════════════════════════════════════════════ */

/** 自定义工具（从文件夹导入的 TOOL.json）：只声明"叫什么/长什么样/跑哪条命令" */
interface ZiDingGongJu {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 要跑的命令行；参数用 {{arg}} 占位（走 run_shell 同一套安全检查） */
  command: string;
  source?: string;
}
function ziDingGongJuJiQu(): ZiDingGongJu[] {
  try {
    const s = settingsStore?.load() as { customTools?: ZiDingGongJu[] } | undefined;
    const a = s?.customTools;
    return Array.isArray(a) ? a.filter((x) => x && x.name && x.command) : [];
  } catch { return []; }
}
function gongJuQiYongBiao(): Record<string, boolean> {
  try {
    const s = settingsStore?.load() as { toolEnabled?: Record<string, boolean> } | undefined;
    return s?.toolEnabled && typeof s.toolEnabled === 'object' ? { ...s.toolEnabled } : {};
  } catch { return {}; }
}
/** 这个工具对模型可见吗（默认可见；显式 false 才隐藏） */
function gongJuKeJian(ming: string): boolean {
  return gongJuQiYongBiao()[String(ming)] !== false;
}

/**
 * **授权卡**（产品要求）：每个会话一份长期授权，互不干扰。
 * 授权过的不再重复询问；可在右栏撤销。
 */
const shouQuanCang = new Map<string, Array<{ id: string; text: string; ts: number }>>();
function shouQuanQu(sid: string): Array<{ id: string; text: string; ts: number }> {
  return shouQuanCang.get(String(sid)) || [];
}
function shouQuanCun(sid: string, list: Array<{ id: string; text: string; ts: number }>): void {
  shouQuanCang.set(String(sid), list);
  try {
    const s = (settingsStore?.load() as { authGrants?: Record<string, unknown> } | undefined) || {};
    const all = (s.authGrants && typeof s.authGrants === 'object') ? { ...s.authGrants } : {};
    all[String(sid)] = list;
    settingsStore?.save({ authGrants: all } as never);
  } catch { /* 落盘失败不影响本次 */ }
  try { broadcastToWindows('warmy:shouQuanUpdated', { sessionId: String(sid) }); } catch { /* noop */ }
}
/** 启动时把落盘的授权读回内存 */
function shouQuanHuiFu(): void {
  try {
    const s = settingsStore?.load() as { authGrants?: Record<string, unknown> } | undefined;
    const all = (s?.authGrants && typeof s.authGrants === 'object') ? s.authGrants : {};
    for (const [sid, list] of Object.entries(all)) {
      if (Array.isArray(list)) shouQuanCang.set(sid, list as Array<{ id: string; text: string; ts: number }>);
    }
  } catch { /* noop */ }
}
chuliIpc('warmy:shouQuanLieBiao', (_e, sid: string) => ({ ok: true, items: shouQuanQu(sid) }));
chuliIpc('warmy:shouQuanTianJia', (_e, p0?: { sessionId?: string; key?: string }) => {
  try {
    const sid = String(p0?.sessionId || '');
    const key = String(p0?.key || '').trim();
    if (!sid || !key) return { ok: false, error: 'bad-payload' };
    const list = shouQuanQu(sid);
    if (!list.some((x) => x.text === key)) list.push({ id: 'a-' + Date.now(), text: key, ts: Date.now() });
    shouQuanCun(sid, list);
    return { ok: true, items: list };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:shouQuanCheXiao', (_e, p0?: { sessionId?: string; id?: string }) => {
  try {
    const sid = String(p0?.sessionId || '');
    const list = shouQuanQu(sid).filter((x) => x.id !== String(p0?.id || ''));
    shouQuanCun(sid, list);
    return { ok: true, items: list };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 查是否已有该授权（有则跳过重复询问） */
chuliIpc('warmy:shouQuanYouMeiYou', (_e, p0?: { sessionId?: string; key?: string }) => {
  const sid = String(p0?.sessionId || '');
  const key = String(p0?.key || '');
  return { ok: true, has: shouQuanQu(sid).some((x) => x.text === key) };
});

/** 已落盘的模型能力（拉取时存的）——渲染层启动时读回，重启后警示图标也能显示 */chuliIpc('warmy:moXingNengLiQu', () => {
  try {
    const s = settingsStore?.load() as { modelCaps?: Record<string, unknown> } | undefined;
    const m = (s && s.modelCaps && typeof s.modelCaps === 'object') ? s.modelCaps : {};
    // 与内存里的合并（本次运行拉取到的优先）
    for (const [id, v] of modelNengLiMeta) {
      m[id] = {
        contextLen: Number((v as { contextLen?: number }).contextLen) || 0,
        kind: String((v as { kind?: string }).kind || ''),
        tools: (v as { tools?: boolean | 'unknown' }).tools,
        vision: (v as { vision?: boolean | 'unknown' }).vision,
      };
    }
    return { ok: true, caps: m };
  } catch { return { ok: true, caps: {} }; }
});

chuliIpc('warmy:gongJuLieBiao', () => {
  const qi = gongJuQiYongBiao();
  const out: Array<{ name: string; description: string; source: string; enabled: boolean }> = [];
  const add = (specs: Array<{ function: { name: string; description?: string } }> | undefined, source: string) => {
    for (const s of specs || []) {
      const name = String(s.function?.name || '');
      if (!name) continue;
      out.push({ name, description: String(s.function?.description || ''), source, enabled: qi[name] !== false });
    }
  };
  try { add(workToolSpecs() as never, 'work'); } catch { /* noop */ }
  try { add(hostToolSpecs() as never, 'host'); } catch { /* noop */ }
  try { add(memory?.isReady ? (memoryToolSpecs() as never) : undefined, 'memory'); } catch { /* noop */ }
  for (const g of ziDingGongJuJiQu()) {
    out.push({ name: g.name, description: g.description, source: 'custom', enabled: qi[g.name] !== false });
  }
  return { ok: true, tools: out };
});

chuliIpc('warmy:gongJuQiYong', (_e, p0?: { name?: string; enabled?: boolean }) => {
  try {
    const name = String(p0?.name || '');
    if (!name) return { ok: false, error: 'bad-payload' };
    const s = settingsStore?.load() as { toolEnabled?: Record<string, boolean> } | undefined;
    const m = { ...((s && s.toolEnabled) || {}) };
    if (p0?.enabled === false) m[name] = false;
    else delete m[name];
    settingsStore?.save({ toolEnabled: m } as never);
    return { ok: true, enabled: m[name] !== false };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** 工具自动发现目录（与技能同款机制，独立一份设置） */
function gongJuSaomiaoLuJingQu(): string[] {
  try {
    const s = settingsStore?.load() as { toolScanDirs?: unknown } | undefined;
    const dirs = s && Array.isArray(s.toolScanDirs) ? s.toolScanDirs : [];
    return dirs.map((d) => String(d || '').trim()).filter(Boolean).slice(0, SKILL_SCAN_DIRS_MAX);
  } catch { return []; }
}
chuliIpc('warmy:gongJuSaoMiaoMuLuJiQu', () => ({ ok: true, dirs: gongJuSaomiaoLuJingQu() }));
chuliIpc('warmy:gongJuSaoMiaoMuLuJiSheZhi', (_e, dirs: unknown) => {
  try {
    const LieBiao = (Array.isArray(dirs) ? dirs : []).map((d) => String(d || '').trim()).filter(Boolean).slice(0, SKILL_SCAN_DIRS_MAX);
    settingsStore?.save({ toolScanDirs: LieBiao } as never);
    return { ok: true, dirs: LieBiao };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 扫描自动发现目录里带 `TOOL.json` 的工具包（只登记、不执行） */
chuliIpc('warmy:gongJuSaoMiao', () => {
  const faXian: ZiDingGongJu[] = [];
  for (const dir of gongJuSaomiaoLuJingQu()) {
    let ems: string[] = [];
    try { ems = fs.readdirSync(dir); } catch { continue; }
    for (const e of ems.slice(0, 50)) {
      const p = path.join(dir, e, 'TOOL.json');
      const one = duGongJuBao(p);
      if (one) faXian.push(one);
    }
  }
  return { ok: true, found: faXian };
});
/** 读一个工具包（`TOOL.json`，可选 `TOOL.md` 做说明）；不合格返回 null */
function duGongJuBao(josnLu: string): ZiDingGongJu | null {
  try {
    if (!josnLu || !fs.existsSync(josnLu)) return null;
    const j = JSON.parse(fs.readFileSync(josnLu, 'utf8'));
    const name = String(j?.name || '').trim();
    const command = String(j?.command || '').trim();
    if (!name || !command) return null;
    if (!/^[\w.\-]{1,64}$/.test(name)) return null;
    let description = String(j?.description || '').slice(0, 400);
    const md = path.join(path.dirname(josnLu), 'TOOL.md');
    if (!description && fs.existsSync(md)) description = fs.readFileSync(md, 'utf8').slice(0, 400);
    return {
      name,
      description,
      parameters: (j?.parameters && typeof j.parameters === 'object') ? j.parameters : { type: 'object', properties: {} },
      command: command.slice(0, 2000),
      source: path.dirname(josnLu),
    };
  } catch { return null; }
}
/** 手动安装/导入：从文件夹读 TOOL.json，登记为自定义工具 */
chuliIpc('warmy:gongJuAnZhuang', (_e, mu: string) => {
  try {
    const dir = String(mu || '');
    if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'folder-not-found' };
    const josnLu = fs.statSync(dir).isDirectory() ? path.join(dir, 'TOOL.json') : dir;
    const one = duGongJuBao(josnLu);
    if (!one) return { ok: false, error: 'not-a-tool-package', hint: '需要 TOOL.json（含 name 与 command）' };
    const yiYou = ziDingGongJuJiQu().filter((x) => x.name !== one.name);
    settingsStore?.save({ customTools: [...yiYou, one] } as never);
    return { ok: true, tool: one };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:gongJuXieZai', (_e, name: string) => {
  try {
    const n = String(name || '');
    settingsStore?.save({ customTools: ziDingGongJuJiQu().filter((x) => x.name !== n) } as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:jinengJiLieBiao', () => {
  const jinengJi: Array<Record<string, unknown>> = [];
  const saoMiaoMuluZhuangtai = jinengSaomiaoZhuangtai(jiaZaiJinengSaomiaoLuJing());
  const QiYongBiao = ((): Record<string, boolean> => {
    try {
      const s = settingsStore?.load() as { skillEnabled?: Record<string, boolean> } | undefined;
      return s?.skillEnabled && typeof s.skillEnabled === 'object' ? { ...s.skillEnabled } : {};
    } catch { return {}; }
  })();
  for (const { root, source } of jinengGen()) {
    if (!fs.existsSync(root)) continue;
    const tuiSongYiTiao = (dirName: string, md: string) => {
      const info = skillMdInfo(md);
      let mtime = 0;
      try {
        mtime = fs.statSync(md).mtimeMs;
      } catch {
        /* 忽略 */
      }
      const id = source === 'discovered' ? 'discovered:' + path.basename(root) + ':' + dirName : dirName;
      const enabled = QiYongBiao[id] !== false;
      jinengJi.push({
        id,
        ming: info.ming || dirName,
        description: info.description,
        source,
        root,
        mtime,
        enabled,
        removable: source !== 'discovered',
      });
    };
    // A discovered root may itself be a skill package (SKILL.md at the root)
    if (source === 'discovered') {
      const benJiMiaoShu = path.join(root, 'SKILL.md');
      if (fs.existsSync(benJiMiaoShu)) tuiSongYiTiao(path.basename(root), benJiMiaoShu);
    }
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const md = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      tuiSongYiTiao(d, md);
    }
  }
  jinengJi.sort((x, y) => Number(y.mtime || 0) - Number(x.mtime || 0));
  return { ok: true, jinengJi, scanDirs: saoMiaoMuluZhuangtai, maxScanDirs: SKILL_SCAN_DIRS_MAX };
});

chuliIpc('warmy:jinengJiSaoMiaoMuLuJiQu', () => {
  const dirs = jiaZaiJinengSaomiaoLuJing();
  return { ok: true, dirs, scanDirs: jinengSaomiaoZhuangtai(dirs), max: SKILL_SCAN_DIRS_MAX };
});

chuliIpc('warmy:jinengJiSaoMiaoMuLuJiSheZhi', (_e, dirs: unknown) => {
  const LieBiao = Array.isArray(dirs) ? dirs.map((d) => String(d || '').trim()).filter(Boolean) : [];
  if (LieBiao.length > SKILL_SCAN_DIRS_MAX) {
    return { ok: false, error: 'too-many-dirs', max: SKILL_SCAN_DIRS_MAX, count: LieBiao.length };
  }
  try {
    const next = settingsStore?.save({ skillScanDirs: LieBiao } as never);
    return { ok: true, dirs: LieBiao, scanDirs: jinengSaomiaoZhuangtai(LieBiao), settings: next };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});


chuliIpc('warmy:jinengJiDaoRu', async () => {
  if (!win) return { ok: false, error: 'no window' };
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0];
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    return { ok: false, error: 'SKILL.md not found in the selected folder' };
  }
  const id = path.basename(src);
  const dest = path.join(app.getPath('userData'), 'skills', id);
  // 写操作门禁：导入技能会整目录覆盖 → 先拿租约（另一台/另一个身份正在导入同一目录就被挡住）
  const guarded = daiZuYue('skills', ['skills'], () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    return id;
  });
  try {
    if (!guarded.ok) return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason, conflicts: guarded.conflicts };
    return { ok: true, id: guarded.value };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 资源管理器选目录（技能/插件自动发现共用） */
/**
 * 「检查所有硬盘」：整机扫描技能 / 插件。
 *
 * 产品要求是"检测整机所有位置"，但**不能无限跑**：真实机器上百万级目录会挂住 UI。
 * 因此实现为**有界扫描**并**如实报告边界**（扫了哪些盘、剪掉了哪些目录、是否因预算提前停）：
 *   - 盘：枚举 A–Z 中真实存在的固定盘（Windows）；其它平台从 `/` 开始
 *   - 深度上限、目录数上限、时间预算（默认 25s）、结果上限，任一触顶即停止并说明
 *   - 剪枝：系统/缓存/包管理目录（Windows、Program Files、node_modules、.git、dist、Temp…）
 *   - 技能标记：目录内含 `SKILL.md`
 *   - 插件标记：目录内含 `package.json`，且包名/字段与 warmy|plugin 相关
 * 返回结构含 `bound` 段，UI 据此如实展示"为什么会提前结束"。
 */
const JIQI_SAOMIAO_XIANZHI = { maxDepth: 6, maxDirs: 40000, budgetMs: 25000, maxResults: 300 };
const JIQI_SAOMIAO_JIANZHI = new Set([
  'windows', 'winnt', '$recycle.bin', 'system volume information', 'program files',
  'program files (x86)', 'programdata', 'node_modules', '.git', 'dist', 'build', 'out',
  'temp', 'tmp', 'cache', 'caches', '.cache', '.npm', '.pnpm-store', '.pnpm', 'appdata',
  'library', 'perflogs', 'recovery', '$windows.~ws', '.vscode', '.idea', 'coverage',
]);

function jiqiSaomiaoGen(): string[] {
  const roots: string[] = [];
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const p = String.fromCharCode(c) + ':\\';
      try { if (fs.existsSync(p)) roots.push(p); } catch { /* 无权限的盘直接跳过 */ }
    }
  } else {
    roots.push('/');
  }
  return roots;
}

function looksLikeWarmyPlugin(pkgPath: string): { ok: boolean; ming?: string; desc?: string } {
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    const ming = String(j.name || '');
    const deps = { ...(j.dependencies as Record<string, string> | undefined), ...(j.devDependencies as Record<string, string> | undefined) };
    const yilaiMingzhong = Object.keys(deps || {}).some((k) => /warmy|plugin/i.test(k));
    const ziduanMingzhong = 'warmy' in j || 'warmyPlugin' in j || Array.isArray((j.keywords as unknown[])) && (j.keywords as string[]).some((k) => /warmy|plugin/i.test(String(k)));
    const mingMingzhong = /warmy|plugin/i.test(ming);
    return { ok: mingMingzhong || yilaiMingzhong || ziduanMingzhong, ming, desc: String(j.description || '') };
  } catch { return { ok: false }; }
}

async function scanMachineFor(kind: 'skills' | 'chaJianJi') {
  const qiShiShiJian = Date.now();
  const roots = jiqiSaomiaoGen();
  const found: Array<{ id: string; ming: string; path: string; desc?: string; root: string }> = [];
  const pruned: Array<{ dir: string; reason: string }> = [];
  let fangwen = 0;
  let stoppedBy: string | null = null;

  const queue: Array<{ dir: string; depth: number; root: string }> = roots.map((r) => ({ dir: r, depth: 0, root: r }));
  while (queue.length) {
    if (Date.now() - qiShiShiJian > JIQI_SAOMIAO_XIANZHI.budgetMs) { stoppedBy = 'time-budget'; break; }
    if (fangwen >= JIQI_SAOMIAO_XIANZHI.maxDirs) { stoppedBy = 'max-dirs'; break; }
    if (found.length >= JIQI_SAOMIAO_XIANZHI.maxResults) { stoppedBy = 'max-results'; break; }
    const cur = queue.shift()!;
    fangwen += 1;
    // 命中标记：先把当前目录判定一次
    try {
      const jinengWenjian = path.join(cur.dir, 'SKILL.md');
      if (kind === 'skills') {
        if (fs.existsSync(jinengWenjian)) {
          const id = `machine:${path.basename(cur.dir)}`;
          if (!found.some((f) => f.path === cur.dir)) {
            found.push({ id, ming: path.basename(cur.dir), path: cur.dir, root: cur.root });
          }
          continue; // 技能目录内部不再下钻
        }
      } else {
        const pkg = path.join(cur.dir, 'package.json');
        if (fs.existsSync(pkg)) {
          const mingZhong = looksLikeWarmyPlugin(pkg);
          if (mingZhong.ok) {
            found.push({ id: mingZhong.ming || path.basename(cur.dir), ming: mingZhong.ming || path.basename(cur.dir), path: cur.dir, desc: mingZhong.desc, root: cur.root });
            continue;
          }
        }
      }
    } catch { /* 单个目录失败不影响整轮 */ }

    if (cur.depth >= JIQI_SAOMIAO_XIANZHI.maxDepth) { pruned.push({ dir: cur.dir, reason: 'max-depth' }); continue; }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const di = e.name.toLowerCase();
      if (JIQI_SAOMIAO_JIANZHI.has(di)) { pruned.push({ dir: path.join(cur.dir, e.name), reason: 'pruned-system-dir' }); continue; }
      if (di.startsWith('.')) { pruned.push({ dir: path.join(cur.dir, e.name), reason: 'hidden-dir' }); continue; }
      queue.push({ dir: path.join(cur.dir, e.name), depth: cur.depth + 1, root: cur.root });
    }
  }
  const bound = {
    roots: roots.length,
    dirsVisited: fangwen,
    dirsPruned: pruned.length,
    prunedSample: pruned.slice(0, 12),
    stoppedBy,
    elapsedMs: Date.now() - qiShiShiJian,
    limits: JIQI_SAOMIAO_XIANZHI,
  };
  audit?.log('machine.scan', { kind, found: found.length, dirs: fangwen, stoppedBy });
  return { ok: true, kind, found, bound, scannedRoots: roots };
}
chuliIpc('warmy:saoMiaoJiQi', async (_e, kind?: string) => {
  try {
    const k = kind === 'chaJianJi' ? 'chaJianJi' : 'skills';
    return await scanMachineFor(k);
  } catch (e) {
    return { ok: false, found: [], error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:xuanZeMuLu', async () => {
  if (!win) return { ok: false, error: 'no window' };
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, path: r.filePaths[0] };
});

/** 等待协助：userData/assist.json —— AI 运行中需要人处理的事项（项目级会话可见） */
type AssistStatus = 'daKai' | 'done' | 'stale';
type AssistPriority = 'normal' | 'urgent';
interface AssistItem {
  id: string;
  sessionId: string;
  biaoTi: string;
  ti?: string;
  status: AssistStatus;
  priority: AssistPriority;
  createdAt: number;
  updatedAt: number;
}
function assistFile(): string {
  return path.join(app.getPath('userData'), 'assist.json');
}
function jiaZaiXieZhuTiaoMu(): AssistItem[] {
  try {
    const raw = duJsonWenJian<{ items?: AssistItem[] } | null>(assistFile(), null);
    return Array.isArray(raw?.items) ? raw!.items! : [];
  } catch { return []; }
}
function baoCunXieZhuTiaoMu(items: AssistItem[]): void {
  try { anQuanYuanZiXieJson(assistFile(), { version: 1, items }); } catch { /* noop */ }
}
chuliIpc('warmy:assistLieBiao', (_e, sessionId?: string) => {
  try {
    let items = jiaZaiXieZhuTiaoMu();
    const sid = typeof sessionId === 'string' && sessionId ? sessionId : '';
    // 合并 AI 决策卡（pending=daKai / answered=done）
    try {
      const qs = aiQuestions.LieBiao(sid || undefined);
      for (const q of qs) {
        const id = 'q' + q.id;
        const exists = items.find((x) => x.id === id);
        const mapped: AssistItem = {
          id,
          sessionId: q.groupId || sid,
          biaoTi: q.biaoTi,
          ti: q.ti || '',
          status: q.status === 'pending' ? 'daKai' : q.status === 'answered' ? 'done' : 'stale',
          priority: 'normal',
          createdAt: q.createdAt,
          updatedAt: (q.answer && q.answer.answeredAt) || q.createdAt,
        };
        if (exists) {
          // 人工标记优先于自动状态；仅在仍为 daKai 时跟随决策卡
          if (exists.status === 'daKai' && mapped.status === 'done') {
            exists.status = 'done';
            exists.updatedAt = mapped.updatedAt;
          }
        } else {
          items.push(mapped);
        }
      }
      baoCunXieZhuTiaoMu(items);
    } catch { /* noop */ }
    if (sid) items = items.filter((x) => !x.sessionId || x.sessionId === sid);
    // 有界：每会话最多保留 200 条
    if (items.length > 200) items = items.slice(-200);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:assistGengXinHuoChaRu', (_e, payload: Partial<AssistItem> & { id?: string }) => {
  try {
    const id = String(payload?.id || '').trim();
    if (!id) return { ok: false, error: 'missing-id' };
    const items = jiaZaiXieZhuTiaoMu();
    const now = Date.now();
    const i = items.findIndex((x) => x.id === id);
    const prev = i >= 0 ? items[i] : null;
    const next: AssistItem = {
      id,
      sessionId: String(payload.sessionId || prev?.sessionId || ''),
      biaoTi: String(payload.biaoTi || prev?.biaoTi || '').slice(0, 200),
      ti: String(payload.ti || prev?.ti || '').slice(0, 500),
      status: (payload.status as AssistStatus) || prev?.status || 'daKai',
      priority: (payload.priority as AssistPriority) || prev?.priority || 'normal',
      createdAt: prev?.createdAt || Number(payload.createdAt) || now,
      updatedAt: now,
    };
    if (next.status === 'done' || next.status === 'stale') next.priority = 'normal';
    if (i >= 0) items[i] = next;
    else items.push(next);
    baoCunXieZhuTiaoMu(items);
    audit?.log('assist.upsert', { id, status: next.status, priority: next.priority });
    return { ok: true, item: next };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 隐私政策同意/撤销 */
chuliIpc('warmy:yinSiTongYiSheZhi', (_e, consent: boolean) => {
  try {
    const next = settingsStore?.save({ privacyConsent: !!consent } as never);
    audit?.log('privacy.consent', { consent: !!consent });
    return { ok: true, consent: !!consent, settings: next };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 拒绝隐私政策 / 撤销同意 / 主动退出 → 统一 quitApp（会置 forceQuit，否则 close 会拦截） */
chuliIpc('warmy:yingYongTuiChu', (_e, reason?: string) => {
  setTimeout(() => tuichuYingyong(String(reason || 'ipc')), 40);
  return { ok: true };
});

/** 唯一凭证：指纹（证明你是你）；私钥不落渲染层明文 */
chuliIpc('warmy:shenFenPingZheng', () =>
  anQuanChuLi(() => {
    const info = identityStore?.info() ?? null;
    return {
      ok: true,
      zhiWen: info?.zhiWen || '',
      generation: info?.generation ?? 0,
      bieMing: info?.bieMing || '',
    };
  }, { ok: true, zhiWen: '', generation: 0, bieMing: '' })
);

/** 切换身份：粘贴备份 JSON + 口令 → importBackup */
chuliIpc('warmy:shenFenBeiFenDaoRu', (_e, payload: { backupJson?: string; passphrase?: string }) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const raw = String(payload?.backupJson || '').trim();
    if (!raw) return { ok: false, error: 'backup-required' };
    let backup: unknown;
    try { backup = JSON.parse(raw); } catch { return { ok: false, error: 'backup-invalid-json' }; }
    const r = identityStore.importBackup(backup as never, { passphrase: String(payload?.passphrase || '') });
    if (!r.ok) return { ok: false, error: r.error };
    audit?.log('identity.backup.import', { zhiWen: r.info.zhiWen });
    return { ok: true, identity: r.info, zhiWen: r.info.zhiWen };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 插件自动发现目录扫描：目录下一层含 package.json 的子目录视为插件候选 */
chuliIpc('warmy:chaJianJiSaoMiaoMuLuJiQu', () =>
  anQuanChuLi(() => {
    const s = settingsStore?.load?.() || (settingsStore as { get?: () => unknown })?.get?.() || {};
    const dirs = Array.isArray((s as { pluginScanDirs?: string[] }).pluginScanDirs)
      ? (s as { pluginScanDirs: string[] }).pluginScanDirs
      : [];
    return { ok: true, dirs: dirs.map(String).slice(0, 10) };
  }, { ok: true, dirs: [] })
);
chuliIpc('warmy:chaJianJiSaoMiaoMuLuJiSheZhi', (_e, dirs: unknown) => {
  try {
    const LieBiao = (Array.isArray(dirs) ? dirs : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, SKILL_SCAN_DIRS_MAX);
    const next = settingsStore?.save({ pluginScanDirs: LieBiao } as never);
    return { ok: true, dirs: LieBiao, settings: next };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:chaJianJiSaoMiao', () => {
  try {
    const s = (settingsStore?.load?.() || {}) as { pluginScanDirs?: string[] };
    const dirs = Array.isArray(s.pluginScanDirs) ? s.pluginScanDirs.slice(0, 10) : [];
    const found: Array<{ id: string; path: string; ming: string; desc: string }> = [];
    const skipped: Array<{ dir: string; reason: string }> = [];
    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          skipped.push({ dir, reason: 'not-a-directory' });
          continue;
        }
        for (const ming of fs.readdirSync(dir)) {
          const p = path.join(dir, ming);
          try {
            if (!fs.statSync(p).isDirectory()) continue;
            const pkg = path.join(p, 'package.json');
            const jineng = path.join(p, 'SKILL.md');
            if (!fs.existsSync(pkg) && !fs.existsSync(jineng)) continue;
            let xiangmuMing = ming;
            let xiangmuShuoming = '';
            if (fs.existsSync(pkg)) {
              try {
                const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
                xiangmuMing = String(j.name || ming);
                xiangmuShuoming = String(j.description || '');
              } catch { /* keep folder ming */ }
            }
            if (found.some((f) => f.id === xiangmuMing)) continue;
            found.push({ id: xiangmuMing, path: p, ming: xiangmuMing, desc: xiangmuShuoming });
          } catch { /* skip entry */ }
        }
      } catch (e) {
        skipped.push({ dir, reason: xiJingCuoWu(e) });
      }
    }
    audit?.log('chaJianJi.scan', { dirs: dirs.length, found: found.length });
    return { ok: true, found, skipped, scannedDirs: dirs };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:jinengJiLuJingJi', () => anQuanChuLi(() => ({ ok: true, paths: jinengGen().map((r) => r.root), scanDirs: jinengSaomiaoZhuangtai(jiaZaiJinengSaomiaoLuJing()) }), { ok: true, paths: [], scanDirs: [] }))

chuliIpc('warmy:jinengJiYiChu', (_e, id: string) => {
  try {
    // 删除也是写操作：与导入共用同一把租约（否则导入中途被删 = 半个目录）
    // Discovered skills live in user-owned auto-discovery directories — never delete those sources.
    if (String(id || '').startsWith('discovered:')) {
      return { ok: false, error: 'discovered-skill-not-removable' };
    }
    const guarded = daiZuYue('skills', ['skills'], () => {
      for (const { root, source } of jinengGen()) {
        if (source === 'discovered') continue;
        const dir = path.resolve(root, String(id || ''));
        // 防目录穿越：必须仍在该 root 之下
        if (!dir.startsWith(path.resolve(root) + path.sep)) continue;
        if (!fs.existsSync(dir)) continue;
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
      }
      return false;
    });
    if (!guarded.ok) return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason };
    return guarded.value ? { ok: true } : { ok: false, error: 'skill not found' };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:profileQu', () => anQuanChuLi(() => ({ ok: true, profile: accountStore?.loadProfile() }), { ok: true, profile: undefined }))
// 读自家 package.json 的版本；dev 下 app.getVersion() 返回的是 Electron 版本，不可用
function yingyongBanben(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg && pkg.version) return String(pkg.version);
  } catch {
    /* 忽略 */
  }
  return app.getVersion();
}


/** 读 dsh 包版本；未安装/读不到则返回 null（关于页如实显示「未检测到」） */
function duquDshBanben(): string | null {
  try {
    const cands = [
      path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      path.join(process.cwd(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    ];
    for (const p of cands) {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j && typeof j.version === 'string' && j.version) return j.version;
      }
    }
  } catch { /* noop */ }
  return null;
}

// 关于页：版本 / 运行时 / 平台 / 用户 ID 及其签名校验状态
chuliIpc('warmy:yingYongXinXi', () => {
  try {
    const st = accountStore?.idStatus();
    return {
      ok: true,
      ming: '无限牛马',
      enName: 'WArmy',
      version: yingyongBanben(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      dsh: duquDshBanben(),
      deviceId: st?.id || '',
      deviceIdValid: st?.valid ?? false,
      // 身份层（ADR 003）：deviceId 只是人读别名，身份以公钥指纹为准
      identityFingerprint: identityStore?.info()?.zhiWen || '',
      identityGeneration: identityStore?.info()?.generation ?? 0,
    };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:profileBaoCun', (_e, p: { username: string; email: string; avatarDataUrl?: string }) => {
  try {
    const prev = accountStore?.loadProfile();
    const next = { ...prev!, ...p };
    return { ok: true, profile: accountStore?.saveProfile(next) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:profileSheZhiPassword', (_e, pw: string) => {
  try {
    accountStore?.setPassword(pw);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:profileLogin', (_e, pw: string) => {
  try {
    const r = accountStore?.loginLocal(pw) || { ok: false };
    return r;
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 身份层（ADR 003 附五 / 附五.1 / 附六） ──
/**
 * 身份公开信息。**只给公开部分**：指纹 / 公钥 / 代次 / 名片 / 退役公钥 / 时间线。
 * 私钥永远不出主进程（导出也只能是加密备份）。
 */
chuliIpc('warmy:shenFenXinXi', () =>
  anQuanChuLi(
    () => ({
      ok: true,
      identity: identityStore?.info() ?? null,
      unlock: identityStore?.unlockState() ?? null,
      /** 换证 / 作废时间线（含**旧名片快照**，供附六的横幅展示旧联系方式） */
      timeline: identityStore?.timeline() ?? [],
      /** ⚠️ 代次规则的诚实说明，UI 文案必须照此写：只防回滚，不防抢占（附五.1） */
      generationRuleNote: DAISHU_GUIZE_BEIZHU,
      /** 名片占位/标签所需 i18n 键：渲染层自己 t()，主进程不拼中文 */
      contactI18n: CONTACT_CARD_I18N,
      /** 7 天联系信息冻结期的说明（含"从本机收到通知起算"） */
      contactFreezeNote: CONTACT_FREEZE_NOTE,
      /** 导出/换证都要口令；这里只声明需求，不代填 */
      passphraseMinLength: 8,
    }),
    {
      ok: true,
      identity: null,
      unlock: null,
      timeline: [],
      generationRuleNote: DAISHU_GUIZE_BEIZHU,
      contactI18n: CONTACT_CARD_I18N,
      contactFreezeNote: CONTACT_FREEZE_NOTE,
      passphraseMinLength: 8,
    },
  ),
);

/**
 * 换证（主动轮换）：用**旧私钥**签迁移声明（旧公钥→新公钥 + 代次 + 时间戳，**不含任何联系方式**）
 * 与"旧的作废"声明，代次 +1，旧公钥进退役列表（保公钥丢私钥），并开启 7 天联系信息冻结期。
 * `previousCard` 取自**本机留存历史**（不是声明）—— 横幅展示旧联系方式用它。
 */
chuliIpc('warmy:shenFenLunHuan', (_e, payload: { reason?: string; passphrase?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const r = identityStore.rotate(payload || {});
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      identity: r.info,
      /** 迁移声明：随 DHT 记录 / 群内记录 / 联系人通道传播（接收方用旧公钥验签 + 代次规则判定） */
      declaration: r.declaration,
      /** 作废声明：由旧私钥自签，表示"这把旧钥匙下线了" */
      revocation: r.revocation,
      /** 换证前的名片：来自本机留存（声明里没有联系方式，也不该有） */
      previousCard: r.previousCard,
      contactFreezeUntil: r.contactFreezeUntil,
      timeline: identityStore.timeline(),
      generationRuleNote: DAISHU_GUIZE_BEIZHU,
      contactFreezeNote: CONTACT_FREEZE_NOTE,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 本机的名片历史（旧值留存；换证横幅的"旧联系方式"取自这里） */
chuliIpc('warmy:shenFenKaLiShi', () =>
  anQuanChuLi(() => ({ ok: true, history: identityStore?.contactCardHistory() ?? [], freeze: identityStore?.contactFreeze() ?? null }), { ok: true, history: [], freeze: null }),
);

/**
 * 接收方侧：记录对方的名片（加入时交换 / 换证后补发）。
 * 首次加入直接留存、**不冻结**；处于冻结期则只记为 pending，展示继续用本机留存值。
 */
chuliIpc('warmy:shenFenDuiDuanKa', (_e, payload: { zhiWen?: string; ka?: LianXiKa; signedCard?: ShenFenKa } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    let zhiWen = payload?.zhiWen || '';
    let ka = payload?.ka as LianXiKa | undefined;
    if (payload?.signedCard) {
      // 带签名的名片先验签（自签 + 指纹自洽），再决定是否留存
      const v = yanZhengShenFenKa(payload.signedCard);
      if (!v.ok) return { ok: false, error: `bad-card:${v.reason}` };
      zhiWen = payload.signedCard.zhiWen;
      ka = payload.signedCard.contactCard;
    }
    if (!zhiWen || !isValidFingerprint(zhiWen)) return { ok: false, error: 'fingerprint-required' };
    return { ok: true, peer: identityStore.recordPeerCard(zhiWen, ka || {}, Date.now()) };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 接收方侧：记录"收到换证通知"并**从本机此刻**起算 7 天冻结（不用声明里的时间戳）。
 * 先验签 + 走代次规则，规则不过就不落地。
 */
chuliIpc(
  'warmy:shenFenDuiDuanLunHuan',
  (_e, payload: { declaration?: LunHuanShengMing; knownKeys?: YaoShiHuanTiaoMu[]; currentGeneration?: number } = {}) => {
    try {
      if (!identityStore) return { ok: false, error: 'identity-unavailable' };
      const d = payload?.declaration;
      if (!d) return { ok: false, error: 'declaration-required' };
      const caijue = verifyRotationDeclaration(d, {
        ...(payload?.knownKeys ? { knownKeys: payload.knownKeys } : {}),
        ...(typeof payload?.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
      });
      if (!caijue.accepted) return { ok: false, error: caijue.reason, caijue };
      const peer = identityStore.recordPeerRotation(d, Date.now());
      return { ok: true, caijue, peer };
    } catch (e) {
      return { ok: false, error: xiJingCuoWu(e) };
    }
  },
);

/** 接收方侧：取某指纹的对端名片视图（旧/新两个字段并列 + 冻结状态） */
chuliIpc('warmy:shenFenDuiDuanLianXi', (_e, zhiWen: string) =>
  anQuanChuLi(() => ({ ok: true, peer: zhiWen ? identityStore?.peerContact(zhiWen) ?? null : null }), { ok: true, peer: null }),
);

/**
 * 接收方侧：**手动确认**采用对方的新名片（冻结期结束后才生效）。
 * 对应 UI 文案「冻结期已结束，但不会自动采用新值——需要你手动确认」。
 */
chuliIpc('warmy:shenFenDuiDuanQueRen', (_e, zhiWen: string) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    if (!zhiWen) return { ok: false, error: 'fingerprint-required' };
    const peer = identityStore.confirmPeerCard(zhiWen);
    if (!peer) return { ok: false, error: 'unknown-peer' };
    return { ok: true, peer, adopted: !peer.awaitingConfirmation && !peer.pendingCard };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 导出身份凭证备份（附三 C6：产品无服务器，凭证必须用户自持）。
 * **永远是加密文件**：不存在"明文导出私钥"这条路径（附五：默认不显示明文）。
 */
/** 凭证：当前本机 ID（= 私钥凭证）。界面只展示给本人，复制即备份。 */
chuliIpc('warmy:pingZhengXinXi', () =>
  anQuanChuLi(() => {
    const p = accountStore?.loadProfile?.() as { deviceId?: string } | undefined;
    const pingzheng = String(p?.deviceId || '');
    return { ok: true, credential: pingzheng, valid: credentialModule.isValidCredential(pingzheng), formatted: pingzheng ? credentialModule.formatCredential(pingzheng) : '' };
  }, { ok: true, credential: '', valid: false, formatted: '' })
);

/**
 * **更换凭证**：因为"ID 就是私钥"，换凭证与换身份必须是**同一个动作** ——
 * 只换一个会留下"两把不同的密钥"，产品承诺当场失效。这里：
 *   1) 备份当前身份文件（restoreFromCredential 内部做）；
 *   2) 生成新凭证；
 *   3) 用它派生出新身份；
 *   4) 把新凭证写回 profile。
 */
chuliIpc('warmy:pingZhengLunHuan', () => {
  try {
    if (!identityStore || !accountStore) return { ok: false, error: 'identity-unavailable' };
    const xinxian = shengChengPingzheng();
    const r = identityStore.restoreFromCredential(xinxian);
    if (!r.ok) return { ok: false, error: r.error };
    try {
      const raw = accountStore.loadProfile() as unknown as Record<string, unknown>;
      accountStore.saveProfile({ ...raw, deviceId: xinxian } as never);
    } catch { /* profile 写失败不影响身份本身 */ }
    audit?.log('identity.credential.rotated', { zhiWen: r.info.zhiWen, backup: r.backupFile || '' });
    return {
      ok: true,
      credential: xinxian,
      formatted: credentialModule.formatCredential(xinxian),
      zhiWen: r.info.zhiWen,
      backupFile: r.backupFile || null,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 用凭证恢复身份（换机 / 误删配置）：只凭这一串即可找回同一身份与指纹 */
chuliIpc('warmy:pingZhengHuiFu', (_e, credential: string) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const r = identityStore.restoreFromCredential(String(credential || ''));
    if (!r.ok) return { ok: false, error: r.error };
    // 同步写回 profile：ID 与身份保持一致
    try {
      const raw = accountStore?.loadProfile?.() as Record<string, unknown> | undefined;
      if (raw) accountStore?.saveProfile?.({ ...raw, deviceId: String(credential || '') } as never);
    } catch { /* profile 写失败不影响身份本身 */ }
    audit?.log('identity.restore.credential', { zhiWen: r.info.zhiWen });
    return { ok: true, identity: r.info, zhiWen: r.info.zhiWen, backupFile: r.backupFile || null };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:shenFenBeiFenDaoChu', (_e, payload: { passphrase?: string; writeFile?: boolean } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const passphrase = payload?.passphrase || '';
    const r = identityStore.exportBackup({ passphrase });
    if (!r.ok) return { ok: false, error: r.error };
    let savedTo: string | null = null;
    if (payload?.writeFile !== false) {
      const dir = path.join(app.getPath('userData'), 'identity-backup');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `identity-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(f, JSON.stringify(r.backup, null, 2), 'utf8');
      savedTo = f;
      audit?.log('identity.backup.save', { file: path.basename(f), zhiWen: r.backup.zhiWen });
    }
    return {
      ok: true,
      savedTo,
      // 备份本身是口令加密的密文（可打印 / 拷到别的硬盘），不含明文私钥
      backup: r.backup,
      zhiWen: r.backup.zhiWen,
      generation: r.backup.generation,
    };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 设置 / 启用私钥口令保护（附五.1 第一层：投入产出比最高的一条预防）。
 * 两种用法：
 *   ① 首次运行且 OS 钥匙串不可用 —— 用口令创建身份（否则身份层会拒绝明文落盘）；
 *   ② 已有身份（OS 模式）—— 升级成口令模式：此后"文件 + 同一台机器"都不够，必须知道口令。
 * ⚠️ 代价必须对用户讲清：口令忘了 = 身份没了（产品无服务器，不存在找回/补发）。
 */
chuliIpc('warmy:shenFenSheZhiMiMaKouLing', (_e, payload: { passphrase?: string; currentPassphrase?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const passphrase = payload?.passphrase || '';
    if (!identityStore.exists()) {
      const profile = accountStore?.loadProfile();
      const yiChuangJian = identityStore.ensureIdentity(profile?.deviceId || shengChengPingzheng(), { email: profile?.email || '' }, { passphrase });
      if (!yiChuangJian.ok) return { ok: false, error: yiChuangJian.error };
      return { ok: true, created: yiChuangJian.created, identity: yiChuangJian.info, timeline: identityStore.timeline() };
    }
    const r = identityStore.setPassphrase(passphrase, {
      ...(payload?.currentPassphrase ? { currentPassphrase: payload.currentPassphrase } : {}),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, created: false, identity: r.info, timeline: identityStore.timeline() };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * 联系人侧：验一条换证 / 作废声明并应用**单调代次规则**（横幅分支与信任更新用）。
 * 返回值里的 generationRuleNote 必须一路带到 UI —— 它明确写了"不防抢先"。
 */
chuliIpc(
  'warmy:shenFenYanZhengLunHuan',
  (_e, payload: { declaration?: ShenfenShengming; knownKeys?: YaoShiHuanTiaoMu[]; currentGeneration?: number } = {}) => {
    try {
      const d = payload?.declaration;
      if (!d) return { ok: false, error: 'declaration-required' };
      if (d.kind === 'warmy.identity.revocation') {
        const r = verifyRevocationDeclaration(d);
        return { ok: true, kind: d.kind, accepted: r.accepted, reason: r.reason, warnings: r.warnings, honestNote: r.honestNote, detail: r.detail ?? '' };
      }
      const r = verifyRotationDeclaration(d as LunHuanShengMing, {
        ...(payload?.knownKeys ? { knownKeys: payload.knownKeys } : {}),
        ...(typeof payload?.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
      });
      return {
        ok: true,
        kind: 'warmy.identity.rotation',
        accepted: r.accepted,
        reason: r.reason,
        warnings: r.warnings,
        honestNote: r.honestNote,
        oldFingerprint: r.oldFingerprint,
        newFingerprint: r.newFingerprint,
        generation: r.generation,
        detail: r.detail ?? '',
      };
    } catch (e) {
      return { ok: false, error: xiJingCuoWu(e) };
    }
  },
);

// ── 语音保存 ──
chuliIpc('warmy:baoCunYuYin', async (_e, data: { dataUrl: string; ext?: string }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const ext = (data.ext || 'webm').replace(/[^\w]/g, '');
    const file = path.join(dir, `v-${Date.now()}.${ext}`);
    const b64 = String(data.dataUrl).replace(/^data:[^,]+,/, '');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 节点 / 邀请 ──
chuliIpc('warmy:jieDianJiLieBiao', () => anQuanChuLi(() => ({ ok: true, nodes: nodeReg?.LieBiao() || [] }), { ok: true, nodes: [] }))
chuliIpc('warmy:jieDianJiPeiDui', (_e, nodeId: string, ming: string) => ({
  ok: true,
  node: nodeReg?.pairRemote(nodeId, ming),
}));

// ── D. 身份变更横幅（UI 已经按这个形状写完：identityChanges / identityChangeAcknowledge / identityPeers） ──

interface biangengQuerenJilu {
  level: 'dismiss' | 'verified';
  at: number;
  auditId: string;
}

function duBiangengQueRen(): Record<string, biangengQuerenJilu> {
  return duJsonWenJian<Record<string, biangengQuerenJilu>>(biangengQuerenWenjian, {});
}

function xieBiangengQueRen(map: Record<string, biangengQuerenJilu>): { ok: boolean; error?: string } {
  return anQuanYuanZiXieJson(biangengQuerenWenjian, map);
}

/**
 * 身份变更 = ① 本机换证（声明由本机自己写、可信） ② 对端换证（本机记过 receivedAt 的条目）。
 * 组装逻辑放在 `identity-provider.buildIdentityChangeEntries`（纯函数、可被验证脚本真跑），
 * 这里只负责「读确认留痕 → 交给它 → 返回 UI 契约形状」。
 * ⚠️ previousCard **只从本机留存历史取**：换证声明是攻击者可控数据。
 */
chuliIpc('warmy:shenFenBianGengJi', (_e, payload: { scope?: string } = {}) => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable', changes: [] };
    void payload;
    const changes = buildIdentityChangeEntries(identityStore, {
      now: Date.now(),
      acks: duBiangengQueRen(),
      // 成员表给了才能把「某个指纹换了证」精确定位到群/项目（scopes）；
      // 拿不到映射时 computeChangeScopes 会如实退回 [{kind:'all'}] 并标 scopeBasis
      membership: quChengYuanMingceCang(identityStore),
      directory: groupStore,
    });
    return { ok: true, changes };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), changes: [] };
  }
});

/**
 * 「已核实 / 关闭提示」——**必须先审计成功**：审计写不进去就拒绝关闭
 * （UI 明确依赖这一点：`{ok:false}` 时不会把横幅消掉）。
 * auditId 同时写进审计日志与本地留痕，便于事后对账。
 */
chuliIpc('warmy:shenFenBianGengQueRen', (_e, payload: { changeId?: string; level?: 'dismiss' | 'verified' } = {}) => {
  try {
    if (!audit) return { ok: false, error: 'audit-unavailable' };
    if (!identityStore) return { ok: false, error: 'identity-unavailable' };
    const changeId = String(payload.changeId || '');
    const level: biangengQuerenJilu['level'] | '' = payload.level === 'verified' ? 'verified' : payload.level === 'dismiss' ? 'dismiss' : '';
    if (!changeId || !level) return { ok: false, error: 'invalid-request' };
    const auditId = `idchg-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    audit.log('identity.change.ack', { changeId, level, auditId });
    // 审计真的落地了吗？AuditLogger.log 会吞掉写失败 → 读回来确认（不确认就等于假装记过了）
    const last = audit.read(1)[0];
    const luodi =
      !!last && last.op === 'identity.change.ack' && (last.detail as { auditId?: string } | undefined)?.auditId === auditId;
    if (!luodi) return { ok: false, error: 'audit-write-failed' };
    const acks = duBiangengQueRen();
    acks[changeId] = { level, at: Date.now(), auditId };
    const w = xieBiangengQueRen(acks);
    if (!w.ok) return { ok: false, error: 'ack-persist-failed' };
    return { ok: true, auditId };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 本机已知的**全部**对端名片状态（UI 靠它知道"有谁换了证"；按指纹单查的通道见 identity-peer-contact） */
// ── D2. 成员证书 / 吊销列表（ADR §2.3 第 6 条 + §附八.8 + §附五.1 第四层） ──
//
// 这里只做**接线**：协议与验签在 `@warmy/sync-protocol` 的 membership.ts（可单测），
// 签发/换证/吊销的编排在 identity-provider.ts。主进程只回结构化数据 + 错误码，**不拼文案**。

/** 该群的创建者（群主）指纹：群记录里有就用它，否则用本机已钉住的那个 */
function expectedIssuerFor(groupId: string): string {
  const fromGroup = groupStore?.getGroup(groupId)?.creatorFingerprint ?? '';
  if (fromGroup) return fromGroup;
  return quChengYuanMingceCang(identityStore)?.groupState(groupId)?.issuerFingerprint ?? '';
}

/** 用本机身份（必须是该群创建者且已解锁）为成员签发证书 */
async function weiQunQianFaChengYuanZhengShu(
  groupId: string,
  input: {
    memberFingerprint: string;
    memberPublicKey: string;
    displayName?: string;
    role?: 'creator' | 'admin' | 'member';
    memberId?: string;
    supersedes?: string;
    ttlMs?: number;
  }
): Promise<{ ok: boolean; code: string; cert?: { certId: string; memberFingerprint: string; expiresAt: number }; detail?: string }> {
  const membership = quChengYuanMingceCang(identityStore);
  if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
  const signer = chuangjianShenfenQianmingzhe(identityStore);
  const yuQi = expectedIssuerFor(groupId);
  if (yuQi && !zhiwenPipei(yuQi, signer.zhiWen)) {
    // 本机不是该群的创建者 → 无权签发（星型拓扑里只有群主能发证书）
    // 诊断串用 ASCII（主进程不拼面向用户的文字；界面文案一律走 i18n）
    return { ok: false, code: 'not-the-creator', detail: `issuer=${yuQi} local=${signer.zhiWen}` };
  }
  const r = await wentiChengyuanZhengshu({
    signer,
    membership,
    groupId,
    memberFingerprint: input.memberFingerprint,
    memberPublicKey: input.memberPublicKey,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.ttlMs ? { ttlMs: input.ttlMs } : {}),
    ...(yuQi ? { expectIssuerFingerprint: yuQi } : {}),
  });
  if (!r.ok || !r.cert) return { ok: false, code: r.code, detail: r.detail };
  audit?.log('membership.cert.issued', {
    groupId,
    certId: r.cert.certId,
    member: r.cert.memberFingerprint,
    supersedes: r.cert.supersedes ?? '',
  });
  return {
    ok: true,
    code: r.code,
    cert: { certId: r.cert.certId, memberFingerprint: r.cert.memberFingerprint, expiresAt: r.cert.expiresAt },
  };
}

/** 把新版吊销列表广播给在线成员（走**已鉴权**通道；失败不重试，与本设计一致） */
async function guangBoCheXiaoBiao(groupId: string, LieBiao: unknown): Promise<{ sent: number; failed: number } | null> {
  try {
    if (!secureMesh?.enabled) return null;
    const r = await secureMesh.broadcast({
      to: '*',
      channel: 'control',
      groupId,
      payload: { type: 'warmy.membership.revocation', groupId, LieBiao },
    });
    audit?.log('membership.revocation.broadcast', { groupId, sent: r.sent, failed: r.failed });
    return { sent: r.sent, failed: r.failed };
  } catch (e) {
    audit?.log('membership.revocation.broadcast.failed', { groupId, error: xiJingCuoWu(e) });
    return null;
  }
}

/**
 * 收到成员证书（例如刚入群时对端送来一张）。
 * 签发者必须是**本群创建者**：群记录里有创建者指纹就按它校验，否则按本机已钉住的那个。
 */
chuliIpc('warmy:chengYuanMingCeJieShouZhengShu', (_e, payload: { groupId?: string; cert?: unknown } = {}) => {
  try {
    const membership = quChengYuanMingceCang(identityStore);
    if (!membership) return { ok: false, code: 'identity-missing' };
    const groupId = String(payload?.groupId || '');
    if (!groupId || !payload?.cert || typeof payload.cert !== 'object') return { ok: false, code: 'malformed' };
    const yuQi = expectedIssuerFor(groupId);
    const r = membership.putCertificate(payload.cert as never, yuQi ? { expectIssuerFingerprint: yuQi } : {});
    return { ok: r.ok, code: r.code, stored: r.stored, certId: r.certId, detail: r.detail ?? '' };
  } catch (e) {
    return { ok: false, code: 'error', detail: xiJingCuoWu(e) };
  }
});

/** 同步（收到）一份吊销列表：验签 + 单调合并（回滚 / 条目变少一律拒绝） */
chuliIpc('warmy:chengYuanMingCeTongBuCheXiao', (_e, payload: { groupId?: string; LieBiao?: unknown } = {}) => {
  try {
    const membership = quChengYuanMingceCang(identityStore);
    if (!membership) return { ok: false, code: 'identity-missing' };
    const groupId = String(payload?.groupId || '');
    if (!groupId || !payload?.LieBiao || typeof payload.LieBiao !== 'object') return { ok: false, code: 'malformed' };
    const yuQi = expectedIssuerFor(groupId);
    const r = membership.yingYongCheXiaoBiao(groupId, payload.LieBiao as never, yuQi ? { expectIssuerFingerprint: yuQi } : {});
    return {
      ok: r.ok,
      code: r.code,
      changed: r.changed,
      listVersion: r.listVersion,
      previousVersion: r.previousVersion,
      detail: r.detail ?? '',
    };
  } catch (e) {
    return { ok: false, code: 'error', detail: xiJingCuoWu(e) };
  }
});

/** 成员证书与吊销列表的结构化快照（UI 只读；含本地时钟判定结果） */
chuliIpc('warmy:chengYuanMingCeLieBiao', (_e, payload: { groupId?: string } = {}) => {
  try {
    const membership = quChengYuanMingceCang(identityStore);
    if (!membership) return { ok: false, schema: 'warmy.membership.file.v1', groups: [] };
    const qunId = String(payload?.groupId || '');
    const snap = chengYuanKuaiZhao(membership, qunId ? { groupId: qunId } : {});
    return { ...snap, summary: membership.summary() };
  } catch (e) {
    return { ok: false, schema: 'warmy.membership.file.v1', groups: [], error: xiJingCuoWu(e) };
  }
});

/** 名册判定（含依据）：给 UI/排障用的只读通道，不改任何状态 */
chuliIpc(
  'warmy:chengYuanMingCeShouQuan',
  (_e, payload: { zhiWen?: string; groupId?: string; requireCertificate?: boolean } = {}) => {
    try {
      const fp = String(payload?.zhiWen || '');
      if (!fp) return { ok: false, error: 'fingerprint-required' };
      const membership = quChengYuanMingceCang(identityStore);
      const caijue = jieshiMingCeJueCe(identityStore, fp, {
        membership,
        ...(payload?.requireCertificate === true ? { requireCertificate: true } : {}),
      });
      return { ok: true, caijue };
    } catch (e) {
      return { ok: false, error: xiJingCuoWu(e) };
    }
  }
);

/** 签发成员证书（创建者；身份锁着就如实回 identity-locked） */
chuliIpc(
  'warmy:chengYuanMingCeQianFa',
  async (
    _e,
    payload: {
      groupId?: string;
      memberFingerprint?: string;
      memberPublicKey?: string;
      displayName?: string;
      role?: string;
      memberId?: string;
      supersedes?: string;
      ttlMs?: number;
    } = {}
  ) => {
    const groupId = String(payload?.groupId || '');
    const memberFingerprint = String(payload?.memberFingerprint || '');
    const memberPublicKey = String(payload?.memberPublicKey || '');
    if (!groupId || !memberFingerprint || !memberPublicKey) return { ok: false, code: 'malformed' };
    return await weiQunQianFaChengYuanZhengShu(groupId, {
      memberFingerprint,
      memberPublicKey,
      ...(payload?.displayName ? { displayName: String(payload.displayName) } : {}),
      ...(payload?.role === 'admin' || payload?.role === 'creator' ? { role: payload.role } : {}),
      ...(payload?.memberId ? { memberId: String(payload.memberId) } : {}),
      ...(payload?.supersedes ? { supersedes: String(payload.supersedes) } : {}),
      ...(typeof payload?.ttlMs === 'number' ? { ttlMs: payload.ttlMs } : {}),
    });
  }
);

/**
 * **换证后重签**（§附五.1 第四层的落地点）。
 * 需要：本机有该成员的旧证书 + 成员用旧私钥签的换证声明。
 * 成功后旧证书进吊销列表（rotation），新指纹持有 `supersedes` 链 → "新指纹 = 原成员"。
 */
chuliIpc(
  'warmy:chengYuanMingCeLunHuan',
  async (
    _e,
    payload: {
      groupId?: string;
      declaration?: unknown;
      currentGeneration?: number;
      knownKeys?: unknown[];
      ttlMs?: number;
    } = {}
  ) => {
    try {
      const membership = quChengYuanMingceCang(identityStore);
      if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
      const groupId = String(payload?.groupId || '');
      if (!groupId || !payload?.declaration || typeof payload.declaration !== 'object') {
        return { ok: false, code: 'malformed' };
      }
      const yuQi = expectedIssuerFor(groupId);
      const signer = chuangjianShenfenQianmingzhe(identityStore);
      if (yuQi && !zhiwenPipei(yuQi, signer.zhiWen)) {
        return { ok: false, code: 'not-the-creator' };
      }
      const r = await lunHuanChengYuanZhengShu({
        signer,
        membership,
        groupId,
        declaration: payload.declaration as never,
        ...(typeof payload.currentGeneration === 'number' ? { currentGeneration: payload.currentGeneration } : {}),
        ...(Array.isArray(payload.knownKeys) ? { knownKeys: payload.knownKeys as never } : {}),
        ...(typeof payload.ttlMs === 'number' ? { ttlMs: payload.ttlMs } : {}),
      });
      if (!r.ok || !r.cert) {
        return { ok: false, code: r.code, reason: r.verification?.reason ?? '', detail: r.detail ?? '' };
      }
      // 证书链落盘后**顺手把成员表的指纹换成新指纹**：
      // 这样横幅（scopes）与在线态映射立刻跟着新指纹走，不用等下次加入。
      const member = groupStore
        ?.listMembers(groupId)
        .find((m) => m.zhiWen && zhiwenPipei(m.zhiWen, String(r.verification?.oldFingerprint || '')));
      let memberPatched: string | null = null;
      if (member && groupStore) {
        const dabuding = groupStore.setMemberFingerprint(groupId, member.id, r.cert.memberFingerprint);
        memberPatched = dabuding.ok && dabuding.changed ? member.id : null;
      }
      void guangBoCheXiaoBiao(groupId, r.revocation);
      audit?.log('membership.cert.rotated', {
        groupId,
        old: r.verification?.oldFingerprint ?? '',
        next: r.cert.memberFingerprint,
        certId: r.cert.certId,
        supersedes: r.cert.supersedes ?? '',
        replacement: memberPatched ?? '',
      });
      return {
        ok: true,
        code: 'ok',
        cert: {
          certId: r.cert.certId,
          memberFingerprint: r.cert.memberFingerprint,
          supersedes: r.cert.supersedes ?? '',
          expiresAt: r.cert.expiresAt,
        },
        memberId: memberPatched ?? member?.id ?? '',
        listVersion: r.revocation?.listVersion ?? 0,
      };
    } catch (e) {
      return { ok: false, code: 'error', detail: xiJingCuoWu(e) };
    }
  }
);

/** 主动吊销（踢人之外的场景：私钥泄漏 / 管理员处置） */
chuliIpc(
  'warmy:chengYuanMingCeCheXiao',
  async (_e, payload: { groupId?: string; certId?: string; memberFingerprint?: string; reason?: string } = {}) => {
    try {
      const membership = quChengYuanMingceCang(identityStore);
      if (!membership || !identityStore) return { ok: false, code: 'identity-missing' };
      const groupId = String(payload?.groupId || '');
      const reason = String(payload?.reason || 'admin');
      const allowed = ['rotation', 'compromise', 'departed', 'admin'];
      if (!groupId || !allowed.includes(reason)) return { ok: false, code: 'malformed' };
      const cert =
        (payload?.certId ? membership.certificateById(groupId, String(payload.certId)) : null) ??
        (payload?.memberFingerprint ? membership.certificateForFingerprint(groupId, String(payload.memberFingerprint)) : null);
      if (!cert) return { ok: false, code: 'no-certificate' };
      const yuQi = expectedIssuerFor(groupId);
      const signer = chuangjianShenfenQianmingzhe(identityStore);
      if (yuQi && !zhiwenPipei(yuQi, signer.zhiWen)) return { ok: false, code: 'not-the-creator' };
      const r = await chexiaoChengyuanZhengshu({
        signer,
        membership,
        groupId,
        certId: cert.certId,
        memberFingerprint: cert.memberFingerprint,
        reason: reason as never,
        ...(yuQi ? { expectation: yuQi } : {}),
      });
      if (!r.ok) return { ok: false, code: r.code, detail: r.detail ?? '' };
      void guangBoCheXiaoBiao(groupId, r.LieBiao);
      return { ok: true, code: 'ok', certId: cert.certId, listVersion: r.LieBiao?.listVersion ?? 0 };
    } catch (e) {
      return { ok: false, code: 'error', detail: xiJingCuoWu(e) };
    }
  }
);

chuliIpc('warmy:shenFenDuiDuanJi', () => {
  try {
    if (!identityStore) return { ok: false, error: 'identity-unavailable', peers: [] };
    return { ok: true, peers: lieDuiDuanLianXiShiTu(identityStore) };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e), peers: [] };
  }
});

// ── C. 本体协作层接线：ref / 路径门禁 + 租约 ──
//
// 这里**不删减任何既有校验**：IPC 只是把 repo-guard / lease 的既有实现暴露出去，
// pre-receive 钩子（scripts/git-hooks/pre-receive.mjs）跑的是同一份实现（repo-hooks.ts）。
// 也**不动**用户机器上的全局 git config（只写目标仓库自己的 hooks/pre-receive）。

interface RepoGuardRefInput {
  ref?: string;
  oldSha?: string;
  newSha?: string;
  role?: 'member' | 'admin' | 'creator' | 'duty';
  memberId?: string;
  knownSha?: string;
  repoDir?: string;
  force?: boolean;
  assumeFastForward?: boolean;
  allowForceByCreator?: boolean;
  protectedRefs?: string[];
  proposalPrefixes?: string[];
  memberPrefixes?: string[];
  envRefPrefixes?: string[];
  blockedRefPrefixes?: string[];
}

/**
 * 写操作门禁：先拿租约，写完释放。拿不到就**不写**，也不假装成功。
 * holder = 本机身份指纹（不同身份/实例互斥）。
 */
function daiZuYue<T>(  scope: string,
  paths: string[],
  fn: () => T
):
  | { ok: true; value: T; leaseId: string }
  | { ok: false; errorCode: string; reason: string; conflicts: unknown[] } {
  if (!leases) return { ok: false, errorCode: 'no-registry', reason: 'lease-registry-unavailable', conflicts: [] };
  const holder = leaseHolder();
  const acq = leases.acquire({ holder, kind: 'dir', scope, paths });
  if (!acq.ok || !acq.lease) {
    audit?.log('lease.denied', { scope, error: acq.error?.code, conflicts: acq.conflicts?.length ?? 0 });
    return {
      ok: false,
      errorCode: acq.error?.code ?? 'acquire-failed',
      reason: acq.error?.reason ?? 'unknown',
      conflicts: acq.conflicts ?? [],
    };
  }
  const leaseId = acq.lease.id;
  try {
    return { ok: true, value: fn(), leaseId };
  } finally {
    leases.release({ holder, leaseId });
  }
}

chuliIpc('warmy:cangKuShouWeiJianChaYinYong', (_e, payload: RepoGuardRefInput = {} as RepoGuardRefInput) => {
  try {
    const ref = String(payload.ref || '');
    const oldSha = String(payload.oldSha || '');
    const newSha = String(payload.newSha || '');
    if (!ref) return { ok: false, error: 'ref-required' };
    let knownSha = typeof payload.knownSha === 'string' ? payload.knownSha : '';
    let isAncestor: ((a: string, d: string) => boolean | undefined) | undefined;
    const repoDir = payload.repoDir ? String(payload.repoDir) : '';
    if (repoDir) {
      const git = chuangJianGitYunXingQi(repoDir);
      const probe = git(['rev-parse', '--absolute-git-dir']);
      if (probe.code !== 0) return { ok: false, error: 'not-a-git-repo' };
      if (!knownSha) {
        const k = git(['rev-parse', '--verify', '--quiet', ref]);
        if (k.code === 0) knownSha = k.stdout.trim();
      }
      const cache = new Map<string, boolean | undefined>();
      isAncestor = (a: string, d: string): boolean | undefined => {
        const key = `${a}..${d}`;
        if (cache.has(key)) return cache.get(key);
        const r = git(['merge-base', '--is-ancestor', a, d]);
        const v: boolean | undefined = r.code === 0 ? true : r.code === 1 ? false : undefined;
        cache.set(key, v);
        return v;
      };
    }
    const result = jiaoYanYinYongGengXin(ref, oldSha, newSha, {
      role: payload.role ?? 'member',
      ...(payload.memberId ? { memberId: String(payload.memberId) } : {}),
      ...(knownSha ? { knownSha } : {}),
      ...(isAncestor ? { isAncestor } : {}),
      force: payload.force === true,
      assumeFastForward: payload.assumeFastForward === true,
      allowForceByCreator: payload.allowForceByCreator === true,
      ...(Array.isArray(payload.protectedRefs) ? { protectedRefs: payload.protectedRefs.map(String) } : {}),
      ...(Array.isArray(payload.proposalPrefixes) ? { proposalPrefixes: payload.proposalPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.memberPrefixes) ? { memberPrefixes: payload.memberPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.envRefPrefixes) ? { envRefPrefixes: payload.envRefPrefixes.map(String) } : {}),
      ...(Array.isArray(payload.blockedRefPrefixes) ? { blockedRefPrefixes: payload.blockedRefPrefixes.map(String) } : {}),
    });
    return { ok: true, result, knownSha, usedGit: !!repoDir };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:cangKuShouWeiJianChaLuJingJi', (_e, payload: { paths?: Array<string | TuiSongLuJingTiaoMu> | string; base?: 'worktree' | 'gitdir' } = {}) => {
  try {
    const jiaoyan = jiaoYanTuiSongLuJing(payload.paths ?? [], {
      base: payload.base === 'gitdir' ? 'gitdir' : 'worktree',
    });
    return { ok: true, jiaoyan };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 真跑一遍 pre-receive 逻辑（stdin 三列格式）；UI / 验证脚本 / 钩子共用同一实现 */
chuliIpc(
  'warmy:cangKuShouWeiYuXianJieShou',
  (_e, payload: { stdin?: string; role?: string; memberId?: string; repoDir?: string; assumeFastForward?: boolean } = {}) => {
    try {
      const git = chuangJianGitYunXingQi(payload.repoDir ? String(payload.repoDir) : undefined);
      const result: YuXianJieShouJieGuo = yunXingYuXianJieShou({
        git,
        stdin: String(payload.stdin ?? ''),
        role: (payload.role as 'member' | 'admin' | 'creator' | 'duty') ?? 'member',
        memberId: payload.memberId ? String(payload.memberId) : '',
        assumeFastForward: payload.assumeFastForward === true,
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: xiJingCuoWu(e) };
    }
  }
);

/** 给仓库初始化（安装）pre-receive 钩子；找不到钩子脚本时如实报错，不假装装好了 */
chuliIpc('warmy:cangKuShouWeiAnZhuangGouZiJi', (_e, payload: { repoDir?: string; force?: boolean } = {}) => {
  try {
    const repoDir = String(payload.repoDir || '');
    if (!repoDir) return { ok: false, error: 'repo-dir-required' };
    const appRoot = path.join(__dirname, '..');
    const hookScript = chaZhaoGouZiJiaoBen(appRoot);
    if (!hookScript) return { ok: false, error: 'hook-script-not-found', searched: appRoot };
    const r = anzhuangYuXianJieShouGouZi({
      repoDir,
      hookScript,
      nodeBin: process.execPath,
      force: payload.force === true,
    });
    audit?.log('repo.hook.install', { ok: r.ok, error: r.error, alreadyInstalled: r.alreadyInstalled === true });
    return { ...r, script: hookScript };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:cangKuShouWeiZhuangTai', () =>
  anQuanChuLi(
    () => ({
      ok: true,
      hookScript: chaZhaoGouZiJiaoBen(path.join(__dirname, '..')),
      leaseStats: leases?.stats() ?? null,
      mesh: secureMesh?.diagnostics() ?? null,
      netDir: baoZhangWangLuoMuLu(app.getPath('userData')).ok,
    }),
    { ok: false, hookScript: null, leaseStats: null, mesh: null, netDir: false }
  )
);

chuliIpc('warmy:zuYueHuoQu', (_e, Qiu: HuoQuQingQiu = {} as HuoQuQingQiu) => {
  try {
    if (!leases) return { ok: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' }, leases: [] };
    const r = leases.acquire({ ...Qiu, holder: Qiu.holder || leaseHolder() });
    if (r.ok) audit?.log('lease.acquire', { scope: r.lease?.scope, holder: r.lease?.holder, kind: r.lease?.kind });
    return { ...r, leases: leases.LieBiao() };
  } catch (e) {
    return { ok: false, error: { code: 'invalid-request', reason: xiJingCuoWu(e) }, leases: [] };
  }
});

chuliIpc('warmy:zuYueShiFang', (_e, Qiu: ZuYueYinYongQingQiu = {} as ZuYueYinYongQingQiu) => {
  try {
    if (!leases) return { ok: false, released: false, error: { code: 'no-registry', reason: 'lease-registry-unavailable' } };
    const r = leases.release({ ...Qiu, ...(Qiu.holder || Qiu.leaseId ? {} : { holder: leaseHolder() }) });
    if (r.released) audit?.log('lease.release', { leaseId: r.lease?.id, scope: r.lease?.scope });
    return { ...r, leases: leases.LieBiao() };
  } catch (e) {
    return { ok: false, released: false, error: { code: 'invalid-request', reason: xiJingCuoWu(e) } };
  }
});

chuliIpc('warmy:zuYueLieBiao', () =>
  anQuanChuLi(
    () => ({
      ok: true,
      holder: leaseHolder(),
      leases: leases?.LieBiao() ?? [],
      expired: leases?.expiredHistory() ?? [],
      stats: leases?.stats() ?? null,
    }),
    { ok: true, holder: '', leases: [], expired: [], stats: null }
  )
);

chuliIpc('warmy:zuYueJianCha', (_e, payload: { holder?: string; path?: string; paths?: string[] } = {}) => {
  try {
    if (!leases) return { ok: false, errorCode: 'no-registry', results: [] };
    const holder = payload.holder || leaseHolder();
    const LieBiao = Array.isArray(payload.paths) && payload.paths.length ? payload.paths.map(String) : [String(payload.path ?? '')];
    const results = LieBiao.map((p) => leases!.checkWrite(holder, p));
    return { ok: results.every((r) => r.allowed), holder, results, holders: LieBiao.map((p) => leases!.holdersOf(p)) };
  } catch (e) {
    return { ok: false, errorCode: xiJingCuoWu(e), results: [] };
  }
});
chuliIpc('warmy:jieDianJiCheXiao', (_e, nodeId: string) => {
  try {
    nodeReg?.revoke(nodeId);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:yaoQingChuangJian', (_e, groupId?: string) => anQuanChuLi(() => ({ ok: true, invite: chuangjianYaoQing(15 * 60_000, groupId) }), { ok: true, invite: { token: "", expiresAt: 0, used: false } }))
chuliIpc('warmy:yaoQingShiYong', (_e, tok: { token: string; expiresAt: number; used: boolean }) => ({
  ok: shiYongYaoQing(tok),
}));
chuliIpc('warmy:tongBuFaBu', (_e, env: { fromNode: string; toNode: string; channel: string; payload: unknown; groupId?: string; incognito?: boolean }) => ({
  ok: true,
  envelope: syncBus?.publish(env as never),
}));
chuliIpc('warmy:tongBuLaQu', (_e, nodeId: string) => anQuanChuLi(() => ({ ok: true, xiaoXiJi: syncBus?.pull(nodeId) || [] }), { ok: true, xiaoXiJi: [] }))

// ── WebGPU 探测（硬件信息；无则如实不可用） ──
chuliIpc('warmy:webgpuTanCe', () => {
  try {
    // 渲染进程才有 WebGPU；主进程只回「需在渲染层探测」标记
    return { ok: false, reason: 'probe-in-renderer', note: 'WebGPU probe runs in renderer via navigator.gpu' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── dsh 实例入口（可选） ──

/** dsh 安装目标目录（用户数据下，不污染系统全局） */
function dshAnZhuangMuLu(): string {
  return path.join(app.getPath('userData'), 'dsh-packages');
}
function dshHouXuanLuJing(): string[] {
  const dest = path.join(dshAnZhuangMuLu(), 'node_modules', '@deepseek-ai', 'dsh');
  return [
    dest,
    path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(process.cwd(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ];
}
chuliIpc('warmy:dshZhuangTai', () => {
  try {
    const dir = findDshPackageDir(dshHouXuanLuJing());
    let version: string | null = null;
    if (dir) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        version = typeof j.version === 'string' ? j.version : null;
      } catch { /* noop */ }
    }
    return { ok: !!dir, dir: dir || null, version, required: process.platform !== 'darwin' || true, platform: process.platform };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 一键安装 dsh：npm 安装到 userData/dsh-packages（PC 必装；移动端不需要） */
async function dshZhiXingAnZhuang(_opts?: { force?: boolean }): Promise<{ ok: boolean; dir?: string | null; version?: string | null; error?: string; hint?: string }> {
  try {
    const dest = dshAnZhuangMuLu();
    fs.mkdirSync(dest, { recursive: true });
    const BaoJson = path.join(dest, 'package.json');
    if (!fs.existsSync(BaoJson)) {
      fs.writeFileSync(BaoJson, JSON.stringify({ name: 'warmy-dsh-packages', private: true, dependencies: {} }, null, 2));
    }
    const spec = ' @deepseek-ai/dsh@0.1.5-rc.1 ';
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(npmCmd, ['install', '--no-fund', '--no-audit', spec.trim()], {
      cwd: dest,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const dir = findDshPackageDir(dshHouXuanLuJing());
    if (!dir) {
      return {
        ok: false,
        error: (r.stderr || r.stdout || 'dsh install failed').slice(-400),
        hint: 'install-failed',
      };
    }
    let version: string | null = null;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      version = j.version || null;
    } catch { /* noop */ }
    return { ok: true, dir, version };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e), hint: 'install-exception' }; }
}
chuliIpc('warmy:dshAnZhuang', async (_e, opts?: { force?: boolean }) => dshZhiXingAnZhuang(opts));

/** 产品定稿：PC 安装后**默认装 dsh**（后台一次；失败不挡启动，可在设置里手动再装） */
function dshMoRenBaoZhuang(): void {
  try {
    if (process.platform === 'android') return;
    const already = findDshPackageDir(dshHouXuanLuJing());
    if (already) return;
    const flag = path.join(app.getPath('userData'), 'dsh-autoinstall.json');
    // 同一天失败过就不再自动重试（避免每次启动都打 npm）
    try {
      if (fs.existsSync(flag)) {
        const j = JSON.parse(fs.readFileSync(flag, 'utf8'));
        const day = String(j && j.day || '');
        const today = new Date().toISOString().slice(0, 10);
        if (day === today && j && j.ok === false) return;
      }
    } catch { /* flag 坏了就继续装 */ }
    void dshZhiXingAnZhuang().then((r) => {
      try {
        fs.writeFileSync(flag, JSON.stringify({ day: new Date().toISOString().slice(0, 10), ok: !!r.ok, version: r.version || null, at: Date.now() }, null, 2));
      } catch { /* noop */ }
      if (r.ok) console.log('dsh auto-install ok', r.version);
      else console.log('dsh auto-install fail', r.hint || r.error);
    });
  } catch (e) { console.log('dsh auto-install skip', xiJingCuoWu(e)); }
}

chuliIpc('warmy:dshKeYong', () => {
  try {
    const dir = findDshPackageDir(dshHouXuanLuJing());
    let version: string | null = null;
    if (dir) { try { version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch { /* noop */ } }
    return { ok: !!dir, dir: dir || null, version };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:paiShengdshShiLi', async (_e, cfg: { id: string; ming: string }) => {
  const dshDir = findDshPackageDir([
    path.join(app.getAppPath(), 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
    path.join(__dirname, '..', '..', '..', 'spikes', 'spike-05-plugins', 'node_modules', '@deepseek-ai', 'dsh'),
  ]);
  if (!dshDir) return { ok: false, error: 'dsh not found' };
  const dshJiaMuLu = path.join(app.getPath('userData'), 'dsh-home');
  const profile = 'warmy';
  await ensureDshProfile({
    // 同上：这里是 Node 运行时，不是"再起一个 Electron 应用"
    nodePath: jiexiJiedianYunxingShi().path,
    dshPackageDir: dshDir,
    dshJiaMuLu,
    profile,
  });
  const entry = path.join(app.getPath('userData'), 'instances', cfg.id, 'dsh-entry.mjs');
  writeDshInstanceEntry(entry, { dshPackageDir: dshDir, dshJiaMuLu, profile });
  const handle = await p1!.instances.spawn({
    config: {
      id: cfg.id,
      ming: cfg.ming,
      workspace: path.join(app.getPath('userData'), 'instances', cfg.id),
      dutyEligible: true,
    },
    entryScript: entry,
  });
  return { ok: true, handle };
});

// ── 邮件提醒（队列占位，功能待接 SMTP） ──
chuliIpc('warmy:youJianDuiLie', (_e, mail: { to: string; subject: string; text: string }) => {
  try {
    emailQueue.push({ ...mail, ts: Date.now() });
    return { ok: true, pending: emailQueue.length };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:youJianLieBiao', () => anQuanChuLi(() => ({ ok: true, items: emailQueue }), { ok: true, items: [] }))

// ── SMTP 验证（用户设置，非写死） ──
chuliIpc('warmy:smtpYanZheng', async (_e, cfg: SmtpPeizhi & { id?: string }) => {
  try {
    const r = await yanZhengSmtp(cfg);
    if (r.ok && cfg.id && settingsStore) {
      const s = settingsStore.load();
      const leiJi = (s.smtpAccounts || []).find((a) => a.id === cfg.id);
      if (leiJi) {
        leiJi.yiYanZheng = true;
        leiJi.lastVerifyAt = Date.now();
        settingsStore.save({ smtpAccounts: s.smtpAccounts });
      }
    }
    return r;
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:smtpLieBiao', () => {
  try {
    const s = settingsStore?.load();
    const accounts = (s?.smtpAccounts || []).map((a) => ({
      ...a,
      pass: a.pass ? '••••••••' : '',
    }));
    return { ok: true, accounts, max: 10 };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:smtpTianJia', (_e, leiJi: { biaoQian?: string; label?: string; host: string; port: number; secure: boolean; user: string; pass: string }) => {
  try {
    const s = settingsStore!.load();
    const LieBiao = s.smtpAccounts || [];
    if (LieBiao.length >= 10) return { ok: false, error: 'max 10' };
    const Quan = {
      id: 'smtp-' + Date.now().toString(36),
      biaoQian: leiJi.biaoQian || leiJi.label || leiJi.user || `smtp-${LieBiao.length + 1}`,
      host: leiJi.host,
      port: leiJi.port || 465,
      secure: leiJi.secure !== false,
      user: leiJi.user,
      pass: leiJi.pass,
    };
    LieBiao.push(Quan);
    settingsStore!.save({ smtpAccounts: LieBiao });
    return { ok: true, accounts: LieBiao.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })), max: 10 };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:smtpYiChu', (_e, id: string) => {
  try {
    const s = settingsStore!.load();
    const LieBiao = (s.smtpAccounts || []).filter((a) => a.id !== id);
    settingsStore!.save({ smtpAccounts: LieBiao });
    return { ok: true, accounts: LieBiao.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:smtpGengXin', (_e, id: string, patch: Partial<{ label: string; host: string; port: number; secure: boolean; user: string; pass: string }>) => {
  try {
    const s = settingsStore!.load();
    const LieBiao = s.smtpAccounts || [];
    const leiJi = LieBiao.find((a) => a.id === id);
    if (!leiJi) return { ok: false, error: 'not found' };
    Object.assign(leiJi, patch);
    settingsStore!.save({ smtpAccounts: LieBiao });
    return { ok: true, accounts: LieBiao.map((a) => ({ ...a, pass: a.pass ? '••••••••' : '' })) };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 组网：**鉴权通道**（取代原 lan.ts / mesh.ts 的明文 JSONL TCP） ──
//
// 旧实现（`LanSyncServer` / `LanSyncClient` / `MeshNode`）是「发一行 JSON 即 ACK」：
// 任何能连上端口的人都能收发消息、不需要身份。现在两处都换成 `SecureSyncServer` /
// `SecureSyncClient`：先跑 HS1–HS4（Ed25519 双向认证 + X25519 ECDHE + HKDF + AES-256-GCM），
// 名册外的人直接被 `not-authorized` 拒绝，重放计数**持久化**到 userData/net/replay-guard.json。
// 通道名与返回形状保持向后兼容（lan-* / mesh-* 一个都没删）。
// `PeerRegistry` 仍然保留，但它只当**地址簿**用（没有任何鉴权语义）：能不能通信由握手 + 名册决定。

/** PeerRegistry（地址簿）→ 组网层要的对端列表 */
function duiduanYinyong(): WangzhuangDuiduanYinyong[] {
  return (peerReg?.LieBiao() ?? [])
    .filter((p) => !!p && typeof p.host === 'string' && Number(p.port) > 0)
    .map((p) => ({
      nodeId: p.nodeId,
      ming: p.ming,
      host: p.host,
      port: Number(p.port),
      kind: p.kind,
      lastSeen: p.lastSeen,
    }));
}

/** 本机节点 id 刷新（nodeReg 里的 isLocal 那条） */
function refreshLocalNodeId(): string {
  const local = nodeReg?.LieBiao().find((n) => n.isLocal);
  localNodeId = local?.nodeId || 'node-local';
  return localNodeId;
}

/** 身份指纹（写操作租约的持有者 id；没有身份时退回本机节点 id） */
function leaseHolder(): string {
  return identityStore?.info()?.zhiWen || localNodeId || 'local';
}

/**
 * 起组网（鉴权）。**门控在前**：拿不到签名能力就返回 `identity-locked`，
 * 既不监听也不宣告 —— UI 会据此显示「身份未解锁」，而不是"打开了但谁连不上"。
 *
 * 端口：**只用调用方给的那一个**。绑不上就返回 `port-bind-failed` + 底层 errno
 * （`error` 字段）并**保持 requestedPort 不变** —— 不自动换端口、不改设置。
 * 用户由界面引导自己选（见 settings-store 的 WARMY_SUGGESTED_NET_PORTS）。
 */
async function qiDongAnQuanWangZhuang(port: number, opts: { discovery?: boolean; announce?: boolean } = {}) {
  refreshLocalNodeId();
  if (!secureMesh) {
    fachuKongzhitai({ cat: 'net', code: 'net.unavailable' });
    return { ok: false as const, errorCode: 'net-unavailable', error: 'net-wiring-unavailable' };
  }
  const r = await secureMesh.enable(port, opts);
  if (!r.ok) {
    audit?.log('net.enable.failed', {
      errorCode: r.errorCode,
      port,
      errno: r.error,
    });
    // T194：组网开启失败 —— 端口绑不上是最要紧的一类（要能一眼看出是哪个端口、什么 errno）
    fachuKongzhitai({
      cat: 'net',
      code: r.errorCode === 'port-bind-failed' ? 'net.bind-failed' : 'net.enable-failed',
      data: { port, requestedPort: (r as { requestedPort?: number }).requestedPort ?? port, errorCode: r.errorCode, error: r.error },
    });
    return r;
  }
  audit?.log('net.enable', {
    port: r.port,
    requestedPort: r.requestedPort,
    nodeId: r.nodeId,
    discovery: opts.discovery === true,
    announce: opts.announce === true,
  });
  fachuKongzhitai({ cat: 'net', code: 'net.enable-ok', data: { port: r.port, requestedPort: r.requestedPort, nodeId: r.nodeId } });
  return r;
}

chuliIpc('warmy:neiWangQiDong', async (_e, port = WARMY_DEFAULT_NET_PORT) => {
  try {
    const r = await qiDongAnQuanWangZhuang(Number(port) || WARMY_DEFAULT_NET_PORT, { discovery: false, announce: false });
    if (!r.ok) return r;
    return { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:neiWangTingZhi', async () => {
  try {
    await secureMesh?.disable();
    fachuKongzhitai({ cat: 'net', code: 'net.disable', data: { reason: 'lan-stop' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc(
  'warmy:neiWangFaSong',
  async (
    _e,
    xiaoXi: { host: string; port: number; to?: string; payload: unknown; groupId?: string; incognito?: boolean; zhiWen?: string } = {
      host: '',
      port: 0,
      payload: null,
    }
  ) => {
    try {
      if (!secureMesh) return { ok: false, error: 'net-unavailable' };
      const host = String(xiaoXi.host || '');
      const port = Number(xiaoXi.port);
      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, error: 'invalid-target' };
      // 出站一次拨号一次握手。给了 fingerprint 就 pin（同时在名册里放行它），
      // 没给则 TOFU + 严格名册校验（只有本机已知联系人能通过）。
      return await secureMesh.sendToHost(
        host,
        port,
        {
          to: xiaoXi.to || '*',
          channel: 'group',
          ...(xiaoXi.groupId ? { groupId: xiaoXi.groupId } : {}),
          payload: xiaoXi.payload,
          ...(xiaoXi.incognito ? { incognito: true } : {}),
        },
        { ...(xiaoXi.zhiWen ? { pin: String(xiaoXi.zhiWen) } : {}) }
      );
    } catch (e) {
      return { ok: false, error: xiJingCuoWu(e) };
    }
  }
);

chuliIpc('warmy:neiWangShouXiang', () => anQuanChuLi(() => ({ ok: true, xiaoXiJi: secureMesh?.inboxOf() ?? [] }), { ok: true, xiaoXiJi: [] }));

chuliIpc('warmy:neiWangZhuangTai', () =>
  anQuanChuLi(
    () => ({
      ok: true,
      listening: !!secureMesh?.enabled,
      port: secureMesh?.enabled ? secureMesh.boundPort : undefined,
      requestedPort: secureMesh?.requestedNetPort || undefined,
      bind: secureMesh?.enabled ? secureMesh.bindInfo() : undefined,
      nodeId: localNodeId,
    }),
    { ok: true, listening: false, port: undefined, requestedPort: undefined, bind: undefined, nodeId: localNodeId }
  )
);

chuliIpc('warmy:neiWangShuangJiMaoYan', async (_e, opts: { localPort?: number; peerHost?: string; peerPort?: number } = {}) => {
  try {
    refreshLocalNodeId();
    // 回环冒烟用**一次性**身份：握手层拒绝"对端指纹 == 本机指纹"（自反射），
    // 拿本机身份自己连自己必定失败 —— 这不是缺陷，是设计。
    return await secureLoopbackSmoke({
      nodeId: localNodeId,
      localPort: Number(opts.localPort) || 7790,
      ...(opts.peerHost ? { peerHost: opts.peerHost } : {}),
      ...(opts.peerPort ? { peerPort: Number(opts.peerPort) } : {}),
    });
  } catch (e) {
    return {
      serverPort: 0,
      loopbackOk: false,
      peerOk: false,
      peerError: xiJingCuoWu(e),
      secure: { handshakeOk: false, ephemeral: true as const, peerFingerprint: '' },
    };
  }
});

// ── 多节点 mesh（同样走鉴权通道；UDP 只做地址发现，不传业务数据） ──
chuliIpc('warmy:wangZhuangQiDong', async (_e, port = WARMY_DEFAULT_NET_PORT) => {
  try {
    const r = await qiDongAnQuanWangZhuang(Number(port) || WARMY_DEFAULT_NET_PORT, { discovery: true, announce: true });
    if (!r.ok) return r;
    return { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId, notes: NET_NOTES };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:wangZhuangTingZhi', async () => {
  try {
    await secureMesh?.disable();
    fachuKongzhitai({ cat: 'net', code: 'net.disable', data: { reason: 'mesh-stop' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:duiDuanJiLieBiao', () => ({
  ok: true,
  peers: peerReg?.LieBiao() || [],
  notes: NET_NOTES,
}));

chuliIpc(
  'warmy:duiDuanJiTianJia',
  (_e, p: { nodeId?: string; ming: string; host: string; port: number; kind?: 'lan' | 'wan' }) => {
    const nodeId = p.nodeId || `peer-${p.host}-${p.port}`;
    const info = peerReg!.addManual(nodeId, p.ming || nodeId, p.host, p.port, p.kind || 'wan');
    return { ok: true, peer: info, peers: peerReg!.LieBiao() };
  }
);

chuliIpc('warmy:duiDuanJiYiChu', (_e, nodeId: string) => {
  try {
    peerReg?.revoke(nodeId);
    return { ok: true, peers: peerReg?.LieBiao() || [] };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:wangZhuangGuangBo', async (_e, payload: unknown, groupId?: string) => {
  try {
    if (!secureMesh?.enabled) return { ok: false, error: 'mesh not started' };
    const r = await secureMesh.broadcast({
      to: '*',
      channel: 'group',
      ...(groupId ? { groupId } : {}),
      payload,
    });
    return { ok: true, sent: r.sent, failed: r.failed, errors: r.errors };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:wangZhuangShouXiang', () => anQuanChuLi(() => ({ ok: true, xiaoXiJi: secureMesh?.inboxOf() ?? [] }), { ok: true, xiaoXiJi: [] }));

chuliIpc('warmy:wangZhuangZhuangTai', () =>
  anQuanChuLi(
    () => ({
      ok: true,
      listening: !!secureMesh?.enabled,
      /** **实际**绑定的端口（走了兜底链就是兜底那一档，不是用户填的那个） */
      port: secureMesh?.enabled ? secureMesh.boundPort : undefined,
      requestedPort: secureMesh?.requestedNetPort || undefined,
      bind: secureMesh?.enabled ? secureMesh.bindInfo() : undefined,
      nodeId: localNodeId,
      peerCount: peerReg?.LieBiao().length || 0,
      sessions: secureMesh?.sessionCount ?? 0,
    }),
    { ok: true, listening: false, port: undefined, requestedPort: undefined, bind: undefined, nodeId: localNodeId, peerCount: 0, sessions: 0 }
  )
);

// ── 组网状态 / 探测（UI 的 netStatus/netProbe/netLocalAddress/netMembersPresence/meshEnable/meshDisable） ──
//
// 真实现：网卡枚举、TCP 连通性（含时延）、DNS 解析、出站连通性、公网地址回显、监听端口自测、活会话表、
//        IPv6 地址分档、中继候选判定（附八.9 / 附八.3）。
// 降级：**入站可达性**（别人拨我）需要一台真的在公网的第三方对端 → 一律 `inboundVerified:false`，
//       且 `isPublic` 只由地址事实推出（私网/回环/链路本地/CGNAT 恒 false），绝不硬编码 true。
// 未实现：UPnP/NAT-PMP 端口映射、STUN+同时打洞；中继的**判定与选中**已实现，但**转发隧道尚未启用**。

/**
 * 异步可达性（附八.3 的「双不可拨入且无中继」终态只能在这里才算得出来）：
 * `secureMesh.reachabilityFor()` 会**真的拨一次中继候选**（1.5s 超时），而 UI 每秒轮询
 * `net-status` —— 每轮都去拨是不可接受的，所以这里带 TTL 缓存。
 * TTL(20s) < UI 侧保鲜期(30s)，保证 UI 不会拿到"已过期却还没刷新"的结论。
 * ⚠️ 判定必须有**一个对端**：没有已知对端指纹时如实返回 null（不编造中继结论）。
 */
let netReachCache: { at: number; value: KedaxingTishi | null } = { at: 0, value: null };
const NET_REACH_TTL_MS = 20_000;

async function wangLuoKeDaXingHuanCun(): Promise<KedaxingTishi | null> {
  const now = Date.now();
  if (now - netReachCache.at < NET_REACH_TTL_MS) return netReachCache.value;
  let value: KedaxingTishi | null = null;
  try {
    const benJiZhiWen = identityStore?.info()?.zhiWen;
    const peers = secureMesh?.presence() ?? [];
    const peer = peers.find((p) => !!p.zhiWen && p.zhiWen !== benJiZhiWen);
    if (secureMesh && peer?.zhiWen) {
      value = await secureMesh.reachabilityFor(peer.zhiWen, peer.online === true);
    }
  } catch {
    value = null; // 探测失败不影响 net-status 本身：上层按"未知"处理
  }
  netReachCache = { at: now, value };
  return value;
}

chuliIpc('warmy:wangLuoZhuangTai', async () => {
  const huiTui: WangzhuangZhuangtaiJieguo = {
    ok: true,
    meshEnabled: false,
    link: { reachable: false, lastError: 'net-unavailable', peers: [] },
    unlock: identityStore ? yaoQiuKeQianMingShenFen(identityStore).unlock ?? null : null,
  };
  return await anQuanChuLiYiBu<WangzhuangZhuangtaiJieguo>(async () => {
    const base = (await secureMesh?.status()) ?? huiTui;
    // status() 里的 reachability 是**同步且刻意保守**的（needsPublicRelayNotice 恒 false）。
    // 终态能力在异步的 reachabilityFor() 里，必须在这里合并出去，否则 UI 的终态横幅
    // 在真实应用里永远不会出现（只有异步路径才敢说"两端都拨不进来、而且没有中继"）。
    const dada = await wangLuoKeDaXingHuanCun();
    return dada ? { ...base, reachability: dada } : base;
  }, huiTui);
});

chuliIpc('warmy:wangLuoTanCe', async (_e, input: { ip?: string; port?: number; domains?: string[] } = {}) => {
  try {
    return await tanCeWangLuo({
      ip: String(input.ip ?? ''),
      port: Number(input.port),
      ...(Array.isArray(input.domains) ? { domains: input.domains.map(String) } : {}),
    });
  } catch (e) {
    return { ok: false, isPublic: false, outboundOk: false, errorCode: xiJingCuoWu(e), inboundVerified: false as const };
  }
});

chuliIpc('warmy:wangLuoBenJiDiZhi', async () => {
  const port = secureMesh?.enabled ? secureMesh.boundPort : undefined;
  return await anQuanChuLiYiBu(
    async () => await benjiDizhiXinxi(port ? { port } : {}),
    { ok: true, localIp: '127.0.0.1', interfaces: [], hasPublicInterface: false, behindNat: true }
  );
});

chuliIpc('warmy:wangLuoChengYuanJiZaiChang', (_e, payload: { groupId?: string } = {}) => {
  try {
    const groupId = String(payload.groupId || '');
    const members = groupId ? groupStore?.listMembers(groupId) ?? [] : [];
    const meshEnabled = !!secureMesh?.enabled;
    const liveness = secureMesh?.presence() ?? [];
    const liveSessions = liveness.filter((p) => p.online).length;
    const instances = p1?.instances.LieBiao() ?? [];
    // 判定逻辑在 identity-provider 的 goujianChengyuanZaichang（纯函数、验证脚本能真跑）：
    //  · 本机实例成员 → InstanceManager 的真实状态（presenceBasis: 'local-instance'）；
    //  · **有指纹**的异地成员 → 用活连接集合（SecureMesh / ConnectionLiveness）按指纹判
    //    （presenceBasis: 'mesh-session'：没有活连接就是不在线，不假装知道）；
    //  · **没指纹**的异地成员 → presenceBasis: 'unattributed'，如实**不给** online。
    const rows = goujianChengyuanZaichang({ members, instances, liveness, meshEnabled });
    return {
      ok: true,
      meshEnabled,
      presenceAvailable: meshEnabled,
      remoteSessions: liveSessions,
      members: rows,
    };
  } catch (e) {
    return { ok: false, meshEnabled: false, members: [], error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:wangLuoWangZhuangQiYong', async (_e, input: { ip?: string; port?: number; domains?: string[]; publicAddresses?: string[] } = {}) => {
  try {
    const port = Number(input.port) || WARMY_DEFAULT_NET_PORT;
    const r = await qiDongAnQuanWangZhuang(port, { discovery: true, announce: true });
    return r.ok
      ? { ok: true, port: r.port, requestedPort: r.requestedPort, bind: r.bind, nodeId: r.nodeId, errorCode: r.errorCode }
      : r;
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/**
 * R13：**实测**的候选端口（只推荐本机真的绑得上的端口）。
 *
 * 为什么要有这个 IPC：静态候选表"干净"不等于本机现在绑得上（可能被别的进程占用、
 * 也可能落在 OS 保留段里 EACCES）。渲染层拿不到实测结果就只能瞎猜，所以这里把
 * "带结果的候选列表"（每个候选带 status）交给界面，界面才能解释"为什么少了某个号"。
 *
 * 语义约束：**只读、只探测** —— 不绑定、不改配置、不替用户做主。
 * 探测并发有上限、总超时 4s，绝不让界面卡住。
 */
chuliIpc('warmy:wangLuoDuanKouHouXuanJi', async (_e, input: { requestedPort?: number; want?: number } = {}) => {
  try {
    const requestedPort = Number(input.requestedPort);
    return {
      ok: true,
      ...(await xuanDuanKouHouXuan({
        ...(Number.isInteger(requestedPort) && requestedPort > 0 ? { requestedPort } : {}),
        ...(Number.isFinite(Number(input.want)) ? { want: Number(input.want) } : {}),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: xiJingCuoWu(e),
      requestedPort: Number(input.requestedPort) || 0,
      recommended: [],
      probed: [],
      coverage: 'pool',
      timedOut: false,
      elapsedMs: 0,
      probedAt: Date.now(),
      host: '0.0.0.0',
    };
  }
});

chuliIpc('warmy:wangLuoWangZhuangTingYong', async () => {
  try {
    await secureMesh?.disable();
    fachuKongzhitai({ cat: 'net', code: 'net.disable', data: { reason: 'net-mesh-disable' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:wangLuoWangZhuangGuangBo', async (_e, reason: 'startup' | 'address-changed' | 'manual' = 'manual') => {
  try {
    if (!secureMesh?.enabled) return { ok: false, errorCode: 'mesh-disabled' };
    return await secureMesh.announce(reason);
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 窗口控制（自定义标题栏） ──
chuliIpc('warmy:winZuiXiaoHua', () => anQuanChuLi(() => win?.minimize(), null))
chuliIpc('warmy:winZuiDaHua', () => {
  try {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
// 窗口按钮：作用于**发送 IPC 的那个窗口**（独立会话窗点关闭只关自己，不关主界面）
chuliIpc('warmy:winGuanBi', (e) => anQuanChuLi(() => {
  const sender = BrowserWindow.fromWebContents(e.sender);
  if (sender && !sender.isDestroyed()) {
    if (win && sender.id === win.id) {
      // 主窗口：点叉 = 隐藏到托盘（产品语义）
      win.close();
    } else {
      // 独立会话窗：真正关闭本窗
      try { sender.destroy(); } catch { sender.close(); }
    }
    return true;
  }
  win?.close();
  return true;
}, null));
chuliIpc('warmy:winZuiXiaoHua', (e) => anQuanChuLi(() => {
  const sender = BrowserWindow.fromWebContents(e.sender) || win;
  sender?.minimize();
  return true;
}, null));
chuliIpc('warmy:winZuiDaHua', (e) => anQuanChuLi(() => {
  const sender = BrowserWindow.fromWebContents(e.sender) || win;
  if (!sender) return false;
  if (sender.isMaximized()) sender.unmaximize();
  else sender.maximize();
  return true;
}, null));
chuliIpc('warmy:winChongXinJiaZai', () => {
  try {
    if (!win) return { ok: false };
    // 清 HTTP 缓存后重载，避免旧 JS/CSS 残留
    const huihua = win.webContents.session;
    huihua.clearCache().catch(() => {});
    win.webContents.reloadIgnoringCache();
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:winZongShiQiYongDing', (_e, qiYong?: boolean) => {
  try {
    if (!win) return { ok: false };
    const next = typeof qiYong === 'boolean' ? qiYong : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    return { ok: true, alwaysOnTop: next };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:pingTai', () => ({
  ok: true,
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWin: process.platform === 'win32',
  isLinux: process.platform === 'linux',
}));


// ── P5 短命执行者 ──
chuliIpc('warmy:zhiXingQiYunXing', async (_e, renwu: { taskId?: string; brief: string; contextItems?: string[] }) => {
  try {
    await baozhangGongyingshangMiyao();
    const mo = String(providerCfg.model || '');
    const an = await jieMoXingGongYingShang(mo);
    const zhu = an || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
    if (!zhu.apiKey && zhu.protocol !== 'ollama') {
      return { ok: false, error: `no key（模型 ${mo || '—'} 属于供应商「${zhu.biaoQian}」；Ollama 无需密钥）` };
    }
    const r = await yunxingDuanCunhuoZhixingqi(
      {
        taskId: renwu.taskId || 'x-' + Date.now(),
        brief: renwu.brief,
        contextItems: renwu.contextItems || [],
      },
      {
        presetId: zhu.presetId,
        apiKey: zhu.apiKey,
        baseURL: zhu.baseURL || undefined,
        model: mo,
        protocol: zhu.protocol,
      }
    );
    return { ok: !r.error, ...r };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:zhiXingQiPiLiang', async (_e, RenwuJi: Array<{ taskId?: string; brief: string; contextItems?: string[] }>) => {
  try {
    await baozhangGongyingshangMiyao();
    const mo = String(providerCfg.model || '');
    const an = await jieMoXingGongYingShang(mo);
    const zhu = an || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
    if (!zhu.apiKey && zhu.protocol !== 'ollama') {
      return { ok: false, error: `no key（模型 ${mo || '—'} 属于供应商「${zhu.biaoQian}」；Ollama 无需密钥）` };
    }
    const rs = await yunXingZhiXingQiJi(
      RenwuJi.map((t) => ({ taskId: t.taskId || 'x-' + Date.now(), brief: t.brief, contextItems: t.contextItems || [] })),
      {
        presetId: zhu.presetId,
        apiKey: zhu.apiKey,
        baseURL: zhu.baseURL || undefined,
        model: mo,
        protocol: zhu.protocol,
      }
    );
    return { ok: true, results: rs };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── P7 资产治理 ──
chuliIpc('warmy:ziChanJiJianSuo', (_e, opts?: { scope?: string; strict?: boolean }) => ({
  ok: true,
  assets: retrieveAssetsForChat({ scope: opts?.scope as never, strict: opts?.strict }),
}));

chuliIpc('warmy:ziChanJiZhuCe', (_e, a: { id: string; biaoTi: string; ti: string; scope?: string }) => {
  try {
    zhuCeLiaoTianZiChan({ id: a.id, biaoTi: a.biaoTi, ti: a.ti, scope: a.scope as never });
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:ziChanJiFeedback', (_e, id: string, good: boolean) => {
  try {
    jiLuZiChanShiYong(id, good);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:ziChanJiSweep', () => anQuanChuLi(() => ({ ok: true, n: 0 }), { ok: true, n: 0 }))

// ── P6 知识库：从对话写入 ──
chuliIpc('warmy:zhiShiKuCongLiaoTian', (_e, payload: { sessionId: string; biaoTi: string; ti: string }) => {
  try {
    knowledge?.upsertEntity({
      id: 'sess-' + payload.sessionId,
      kind: 'project',
      ming: payload.sessionId,
      attrs: {},
      anchors: [],
    });
    const evId = 'ev-' + Date.now();
    knowledge?.addEvent({
      id: evId,
      biaoTi: payload.biaoTi,
      result: payload.ti.slice(0, 500),
      entityIds: ['sess-' + payload.sessionId],
      anchors: [],
      ts: Date.now(),
    });
    zhuCeLiaoTianZiChan({
      id: evId,
      biaoTi: payload.biaoTi,
      ti: payload.ti,
      scope: 'session',
    });
    return { ok: true, eventId: evId };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/* ══════════════════════════════════════════════════════════════════════
   **自动归档**（产品要求）：把勾了「自动归档」的会话整理后放进知识库。
   关键点是**增量**：每个会话记一个游标（上次归档到哪条消息），下次只归档新内容，
   绝不每次都从头再做一遍 —— 否则既浪费调用，又会往知识库里塞重复条目。
   ══════════════════════════════════════════════════════════════════════ */

/** 归档游标：sessionId → 上次归档到的最后一条消息的 seq/ts */
type GuiDangYouBiaoJi = Record<string, number>;
function guiDangYouBiaoQu(): GuiDangYouBiaoJi {
  try {
    const s = settingsStore?.load() as { archiveCursors?: GuiDangYouBiaoJi } | undefined;
    return (s?.archiveCursors && typeof s.archiveCursors === 'object') ? { ...s.archiveCursors } : {};
  } catch { return {}; }
}
function guiDangYouBiaoCun(next: GuiDangYouBiaoJi): void {
  try { settingsStore?.save({ archiveCursors: next } as never); } catch { /* 游标写失败不影响本次归档 */ }
}
/** 一条消息的时间戳（用来推进游标）：优先 seq，没有就用 ts */
function xiaoXiShiJian(x: { seq?: number | string; ts?: number | string } | null | undefined): number {
  const n = Number(x && (x.seq ?? x.ts)) || 0;
  return n;
}

/**
 * 归档一个会话的**新增**内容进知识库。
 *  - `fromCursor` 为 true 时按游标只归档增量（默认）；false 时全量重做（「立即归档」里的"从头归档"）。
 *  - `moXing` 是用户在设置里选的整理模型；没给或调不通就**如实降级**为原文摘要，不假装整理过。
 */
async function guiDangYiGeHuiHua(
  sessionId: string,
  opts?: { moXing?: string; biaoTi?: string; quanLiang?: boolean },
): Promise<{ ok: boolean; tiaoShu?: number; zhiShiJian?: string; jiangJi?: boolean; error?: string }> {
  try {
    const sid = String(sessionId || '');
    if (!sid) return { ok: false, error: 'bad-session' };
    const suoyou = chatLogs.get(sid) || [];
    const youBiao = guiDangYouBiaoQu();
    const qiDian = opts?.quanLiang ? 0 : Number(youBiao[sid] || 0);
    const xin = suoyou.filter((x) => xiaoXiShiJian(x) > qiDian && !((x as { hidden?: boolean }).hidden));
    if (!xin.length) return { ok: true, tiaoShu: 0 };
    const zuiHou = xin.reduce((mx, x) => Math.max(mx, xiaoXiShiJian(x)), qiDian);

    // 先拼出"要整理的原文"，再看要不要让模型润一遍
    const yuanWen = xin.map((x) => `[${guiYiJiaoSe(x.role)}] ${String(x.content || '')}`).join('\n');
    let zhengLi = yuanWen;
    let jiangJi = false;
    /**
     * 设置里存的是「供应商 · 模型id」（与可用模型同款），而 `jieMoXingGongYingShang` 要**裸模型 id**。
     * 不剥前缀的话模型永远解析不到 ⇒ 每次都静默降级，"归档使用的模型"就成了摆设。
     */
    const moQuan = String(opts?.moXing || '').trim();
    const mo = moQuan.includes('·') ? moQuan.split('·').pop()!.trim() : moQuan;
    if (mo) {
      try {
        const an = await jieMoXingGongYingShang(mo);
        if (an && (an.apiKey || an.protocol === 'ollama')) {
          const p = congYuSheChuangJian(an.presetId, { apiKey: an.apiKey, baseURL: an.baseURL || undefined, protocol: an.protocol } as never, an.protocol);
          const r = await Promise.race([
            p.chat({
              model: mo,
              xiaoXiJi: [{
                role: 'user',
                content: '把下面这段会话整理成一条可检索的知识条目：先给一句概括标题，再列要点/决定/待办/风险，最后保留关键事实。只输出整理结果，不要寒暄。\n\n' + yuanWen.slice(0, 12000),
              }],
              maxTokens: 900,
            }),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('archive-timeout')), 60000)),
          ]);
          const txt = neiRongWenBen((r as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content) || '';
          if (txt.trim()) zhengLi = txt.trim();
          else jiangJi = true;
        } else {
          jiangJi = true;
        }
      } catch {
        jiangJi = true; // 模型没跑通：如实降级，不假装整理过
      }
    }

    const biaoTi = String(opts?.biaoTi || '')
      || (zhengLi.split('\n')[0] || '').slice(0, 60)
      || ('会话归档 ' + new Date().toISOString().slice(0, 10));
    const evId = 'ev-arc-' + Date.now().toString(36);
    knowledge?.upsertEntity({ id: 'sess-' + sid, kind: 'project', ming: sid, attrs: {}, anchors: [] });
    knowledge?.addEvent({
      id: evId,
      biaoTi,
      result: zhengLi.slice(0, 500),
      entityIds: ['sess-' + sid],
      anchors: [],
      ts: Date.now(),
    });
    zhuCeLiaoTianZiChan({ id: evId, biaoTi, ti: zhengLi, scope: 'session' });

    const next = guiDangYouBiaoQu();
    next[sid] = zuiHou;
    guiDangYouBiaoCun(next);
    try {
      audit?.log('chat.archive-done', { sessionId: sid, tiaoShu: xin.length, jiangJi, hasMoXing: !!mo });
    } catch { /* noop */ }
    return { ok: true, tiaoShu: xin.length, zhiShiJian: evId, jiangJi };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
}

/** 增量归档：只归档一个会话的新增内容（渲染层按 autoArchive 勾选决定调不调） */
chuliIpc('warmy:guiDangZengLiang', async (_e, p0?: { sessionId?: string; moXing?: string; quanLiang?: boolean }) => {
  return guiDangYiGeHuiHua(String(p0?.sessionId || ''), {
    moXing: p0?.moXing,
    quanLiang: p0?.quanLiang === true,
  });
});
/** 批量增量归档（渲染层把勾了「自动归档」的会话 id 传进来） */
chuliIpc('warmy:guiDangYiPi', async (_e, p0?: { sessionIds?: string[]; moXing?: string; quanLiang?: boolean }) => {
  const ids = Array.isArray(p0?.sessionIds) ? (p0!.sessionIds as string[]).map(String).filter(Boolean) : [];
  const jieGuo: Array<{ sessionId: string; tiaoShu: number; ok: boolean; jiangJi: boolean }> = [];
  for (const sid of ids) {
    const r = await guiDangYiGeHuiHua(sid, { moXing: p0?.moXing, quanLiang: p0?.quanLiang === true });
    jieGuo.push({ sessionId: sid, tiaoShu: r.tiaoShu || 0, ok: !!r.ok, jiangJi: !!r.jiangJi });
  }
  return { ok: true, jieGuo };
});
/** 归档游标查询/清空（排障用） */
chuliIpc('warmy:guiDangYouBiaoQu', () => ({ ok: true, cursors: guiDangYouBiaoQu() }));
chuliIpc('warmy:guiDangYouBiaoQing', (_e, p0?: { sessionId?: string }) => {
  const next = guiDangYouBiaoQu();
  if (p0?.sessionId) delete next[String(p0.sessionId)];
  guiDangYouBiaoCun(next);
  return { ok: true, cursors: next };
});



// ── 3 权限审批弹窗 ──
chuliIpc('warmy:qingQiuPiZhun', (_e, Qiu: { action: string; suggested?: string }) => {
  try {
    const id = 'ap' + ++pizhunXulie;
    return new Promise((resolve) => {
      dengdaiPizhun.set(id, { resolve });
      win?.webContents.send('warmy:piZhunQingQiu', { id, action: Qiu.action, suggested: Qiu.suggested || 'once' });
      setTimeout(() => {
        const p = dengdaiPizhun.get(id);
        if (p) {
          dengdaiPizhun.delete(id);
          p.resolve({ allowed: false, scope: 'deny' });
        }
      }, 30000);
    });
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:piZhunHuiYing', (_e, id: string, allowed: boolean, scope: string) => {
  try {
    const p = dengdaiPizhun.get(id);
    if (!p) return { ok: false };
    dengdaiPizhun.delete(id);
    p.resolve({ allowed, scope });
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 4 自动检查点 ──
chuliIpc('warmy:checkpointZiDong', (_e, phase: 'round_start' | 'round_end', logSeq?: number) => {
  try {
    if (!checkpoints) return { ok: false };
    const jiYiMuLu = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(jiYiMuLu, 'fast-memory.jsonl');
    const cp = checkpoints.create({
      phase,
      logSeq: logSeq || Date.now(),
      jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
    });
    return { ok: true, checkpoint: cp, LieBiao: checkpoints.LieBiao() };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 6 成本仪表盘 ──
chuliIpc('warmy:chengBenZhaiYao', () => {
  try {
    const m = metrics.summary();
    const estCost = ((m.promptTokens + m.completionTokens) / 1000) * 0.002;
    return {
      ok: true,
      turns: m.turns,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      cacheHitRate: m.cacheHitRate,
      avgDurationMs: m.avgDurationMs,
      estCostCny: +estCost.toFixed(4),
    };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 1 值班编排闭环 ──
chuliIpc('warmy:qunXieTiao', async (_e, xiaoXi: { groupId: string; content: string; urgency?: string; userId?: string }) => {
  /**
   * ADR 004 第七批定稿：项目不可用（容器开发项目 + 容器没起，或被创建者停用）⇒ 拒绝派发
   * （**不**退到主机上跑）。启用/停用与切换容器的入口在**项目右键菜单**：
   * `warmy:xiangMuQiYong` / `warmy:xiangMuTingYong` / `warmy:xiangMuSheZhiRongQi`。
   */
  const KaiFaJuJue = await projectUnavailableFor(String(xiaoXi?.groupId || ''));
  if (KaiFaJuJue) {
    fachuKongzhitai({ cat: 'system', code: 'container.project.unavailable', data: { sessionId: xiaoXi?.groupId, projectCode: KaiFaJuJue.projectCode } });
    return {
      ok: false,
      action: 'error',
      code: KaiFaJuJue.code,
      projectCode: KaiFaJuJue.projectCode,
      reasonKey: KaiFaJuJue.reasonKey,
      fix: KaiFaJuJue.fix,
      memberFaceKey: 'group.memberOffline',
      hostExecutionRefused: true,
      historyReadable: true,
    };
  }
  const instList = (p1?.instances.LieBiao() || []).map((x) => ({
    id: x.id,
    ming: x.ming,
    status: x.status,
    dutyEligible: x.dutyEligible,
  }));

  const result = await xietiaoQunXiaoxi(
    {
      router,
      board: board!,
      ccr,
      history: chatHistories,
      // 值班者输入与 chat-send 共享同一份日志 + 同一个渲染器（不变量 #2）
      logOf: (key: string) => chatLogs.get(key) || [],
      contextBudgetChars: () => contextBudgetChars(providerCfg.model),
      // ADR 002 §9.4 待办 2：值班者路径共用同一套工具与限额（memory-client 是唯一实现）
      toolSpecs: () => (memory?.isReady && toolLimits().zuiDaLunShu > 0 ? memoryToolSpecs(toolLabels()) : undefined),
      toolLimits,
      runTool: async (call, ctx) => {
        const t1 = Date.now();
        const toolName = String((call && call.function && call.function.name) || 'tool');
        fachuKongzhitai({ cat: 'tool', code: 'tool.start', data: { tool: toolName, round: ctx.round, sessionId: xiaoXi.groupId } });
        // 工具里对文件做过的真实读写都记到**这个项目**的台账上（scope = 会话 id）
        const out = await withFileAccessScope(xiaoXi.groupId, () => yunxingJiyiCangGongju(memory, call, { maxChars: ctx.zuiDaJieGuoZiShu }));
        metrics.recordToolCall({
          ts: Date.now(),
          sessionId: xiaoXi.groupId,
          round: ctx.round,
          tool: out.meta.tool,
          ok: out.ok,
          chars: out.chars,
          ms: Date.now() - t1,
        });
        fachuKongzhitai({
          cat: 'tool',
          code: 'tool.finish',
          data: { tool: out.meta.tool || toolName, round: ctx.round, sessionId: xiaoXi.groupId, ok: out.ok, chars: out.chars, ms: Date.now() - t1 },
        });
        audit?.log('chat.tool', {
          sessionId: xiaoXi.groupId,
          round: ctx.round,
          tool: out.meta.tool,
          ok: out.ok,
          chars: out.chars,
          anchor: out.meta.anchor,
          error: out.meta.error,
        });
        return out.content;
      },
      listInstances: () => instList,
      // 项目 MEMORY：从 group-store 读，**不**从 memory-os 流水复制（避免双源）
      projectMemory: (qunId) => projectMemoryForContext(groupStore, qunId),
      decisionContext: (qunId) => aiQuestions.contextFor(qunId),
      runProjectGate: async (qunId, reason) => yunxingXiangmuMenjinYici(qunId, reason),
      addEvent: (biaoTi, ti, groupId) => {
        knowledge?.upsertEntity({ id: 'grp-' + groupId, kind: 'project', ming: groupId, attrs: {}, anchors: [] });
        knowledge?.addEvent({
          id: 'ev-' + Date.now(),
          biaoTi,
          result: ti.slice(0, 400),
          entityIds: ['grp-' + groupId],
          anchors: [],
          ts: Date.now(),
        });
      },
    },
    {
      presetId: providerCfg.presetId,
      apiKey: providerCfg.apiKey,
      baseURL: providerCfg.baseURL || undefined,
      model: providerCfg.model,
    },
    {
      groupId: xiaoXi.groupId,
      userId: xiaoXi.userId,
      content: xiaoXi.content,
      urgency: xiaoXi.urgency as never,
    }
  );

  if (result.usage) {
    metrics.recordTurn({
      sessionId: xiaoXi.groupId,
      ts: Date.now(),
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      cacheMissTokens: Math.max(0, result.usage.promptTokens - result.usage.cacheHitTokens),
      durationMs: 0,
      // 群聊这条路径的供应商同样要如实记（不是"当前生效的供应商"，而是这一轮真正用的）
      providerId: String((result as { providerId?: string }).providerId || providerCfg.presetId),
      providerName: String((result as { providerName?: string }).providerName || ''),
      model: String((result as { model?: string }).model || providerCfg.model),
    });
  }

  try {
    const jiYiMuLu = path.join(app.getPath('userData'), 'memory');
    const jsonl = path.join(jiYiMuLu, 'fast-memory.jsonl');
    checkpoints?.create({
      phase: 'round_end',
      logSeq: Date.now(),
      jsonlPath: fs.existsSync(jsonl) ? jsonl : undefined,
    });
  } catch { /* noop */ }

  return { ok: result.action !== 'error', ...result };
});


// ── C. 执行者状态 ──
const executorStatus: Array<{ id: string; ming: string; taskId: string; brief: string; status: string; durationMs: number; ts: number }> = [];
chuliIpc('warmy:zhiXingQiJiZhuangTai', () => anQuanChuLi(() => ({ ok: true, items: executorStatus.slice(-10) }), { ok: true, items: [] }))
chuliIpc('warmy:zhiXingQiJiYunXingJianYao', async (_e, payload: { brief: string; contextItems?: string[]; executorIds?: string[] }) => {
  try {
    const idJi = payload.executorIds?.length
      ? payload.executorIds
      : (p1?.instances.LieBiao() || []).filter((x) => x.status === 'running').map((x) => x.id).slice(0, 3);
    const qiShiShiJian = Date.now();
    const results = await Promise.all(
      idJi.map(async (id) => {
        const item = { id, ming: id, taskId: 't-' + Date.now(), brief: payload.brief, status: 'running', durationMs: 0, ts: Date.now() };
        executorStatus.push(item);
        const r = await yunxingDuanCunhuoZhixingqi(
          { taskId: item.taskId, brief: payload.brief, contextItems: payload.contextItems || [] },
          { presetId: providerCfg.presetId, apiKey: providerCfg.apiKey, baseURL: providerCfg.baseURL || undefined, model: providerCfg.model }
        );
        item.status = r.error ? 'error' : 'done';
        item.durationMs = Date.now() - qiShiShiJian;
        return r;
      })
    );
    return { ok: true, results };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});


// ── E. 会话状态持久化 ──
chuliIpc('warmy:taiBaoCun', (_e, state: { chaJianJi?: unknown[]; instances?: unknown[]; groups?: unknown[]; chats?: unknown[] }) => {
  try {
    if (!settingsStore) return { ok: false };
    const cur = settingsStore.load();
    const next = { ...cur, ...state } as never;
    settingsStore.save(next as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:taiJiaZai', () => {
  try {
    const s = settingsStore?.load() as never;
    return { ok: true, state: s || {} };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});



// ── 知识库删除 ──
chuliIpc('warmy:zhiShiKuShanChu', (_e, payload: { kind: 'entity' | 'event'; id: string }) => {
  try {
    if (!knowledge) return { ok: false, error: 'kb not ready' };
    const removed = payload?.kind === 'event' ? knowledge.removeEvent(payload.id) : knowledge.removeEntity(payload.id);
    return { ok: removed };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 通用：把文本保存到文件（CSV / Markdown 等）──
chuliIpc('warmy:baoCunWenBen', async (_e, payload: { defaultName?: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
  try {
    if (!win) return { ok: false, error: 'no window' };
    const r = await dialog.showSaveDialog(win, {
      defaultPath: payload?.defaultName || 'warmy-export.txt',
      filters: (payload?.filters || [{ name: 'Text', extensions: ['txt'] }]).map((f) => ({ name: f.name, extensions: f.extensions })),
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, String(payload?.content ?? ''), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── 卡顿自检（diagnostics IPC）已下线：功能整块移除，IPC 通道不再注册 ──

// ── D. ASR 语音转文字（**优先用设置里的「听话模型」**；没有再退回当前供应商） ──
/**
 * 听话模型是否就绪（界面点语音按钮前先问这一句 —— 没配就提示去配，而不是录完才发现转不出来）。
 */
chuliIpc('warmy:tingHuaZhuangTai', async () => {
  try {
    await baozhangGongyingshangMiyao();
    const hit = await teShuMoXingKeYong('asr');
    if (hit) return { ok: true, ready: true, model: hit.mo, provider: hit.an.biaoQian, source: 'asr-chain' };
    // 没配专业听话模型：看看当前供应商能不能顶一下（DeepSeek 等不一定有 /audio/transcriptions）
    const keYong = !!(providerCfg.apiKey || providerCfg.protocol === 'ollama');
    return {
      ok: true,
      ready: false,
      model: '',
      source: keYong ? 'chat-provider-fallback' : 'none',
      reason: keYong ? 'no-asr-model（用的是当前供应商的兜底转写，建议在「设置 → 模型 → 听话模型」里配一个）' : 'no-asr-model',
    };
  } catch (e) { return { ok: false, ready: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:asrZhuanXie', async (_e, payload: { dataUrl: string; ext?: string }) => {
  try {
    await baozhangGongyingshangMiyao();
    const b64 = String(payload.dataUrl).replace(/^data:[^,]+,/, '');
    const buf = Buffer.from(b64, 'base64');
    const biaodan = () => {
      const f = new FormData();
      f.append('file', new Blob([buf], { type: 'audio/webm' }), 'voice.webm');
      return f;
    };
    /**
     * ① **设置里的听话模型优先**（产品要求：有专业模型就用它，没有才回退）。
     * 真事故：以前完全无视「听话模型」设置，硬发 whisper-1 给当前供应商 ⇒ 转不出来，
     * 界面只能显示 `[语音] xxx.webm`。
     */
    const hit = await teShuMoXingKeYong('asr');
    if (hit) {
      const form = biaodan();
      form.append('model', hit.mo);
      try {
        const res = await fetch(pinJieUrl(hit.an.baseURL, 'audio/transcriptions'), {
          method: 'POST',
          headers: hit.an.apiKey ? { Authorization: 'Bearer ' + hit.an.apiKey } : undefined,
          body: form,
        });
        if (res.ok) {
          const data = (await res.json()) as { text?: string };
          audit?.log('asr.used', { model: hit.mo, chars: String(data.text || '').length, source: 'asr-chain' });
          return { ok: true, text: data.text || '', model: hit.mo, source: 'asr-chain' };
        }
        audit?.log('asr.failed', { model: hit.mo, status: res.status });
      } catch (e1) {
        audit?.log('asr.failed', { model: hit.mo, error: xiJingCuoWu(e1).slice(0, 120) });
      }
    }
    // ② 回退：当前生效供应商的 /audio/transcriptions（无感兜底）
    if (!providerCfg.apiKey && providerCfg.protocol !== 'ollama') return { ok: false, error: 'no-asr-model（请在「设置 → 模型 → 听话模型」里配置）' };
    const base = (providerCfg.baseURL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const form2 = biaodan();
    form2.append('model', 'whisper-1');
    const res2 = await fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + providerCfg.apiKey },
      body: form2,
    });
    if (!res2.ok) return { ok: false, error: 'http ' + res2.status };
    const data2 = (await res2.json()) as { text?: string };
    return { ok: true, text: data2.text || '', model: 'whisper-1', source: 'chat-provider-fallback' };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});


// ── H. 多窗口：在新窗口打开会话 ──
// 产品定稿：独立会话窗 = **可拖动顶栏** + 聊天（第3列）+ 右侧事项（第4列）。
// 不要再做成「完整主界面」；不要无边框导致无法拖动。
const chatWindows = new Map<string, BrowserWindow>();
chuliIpc('warmy:daKaiLiaoTianChuangKou', (_e, payload: { id: string; biaoTi?: string; title?: string; ming?: string; kind?: string; mode?: string; iconDataUrl?: string }) => {
  const biaoTi = String(payload.biaoTi || payload.title || payload.ming || payload.id || 'WArmy');
  try {
    if (chatWindows.has(payload.id)) {
      chatWindows.get(payload.id)?.focus();
      return { ok: true };
    }
    // 独立会话窗同样是任务栏窗口：图标也用白底版（随后被聊天对象头像覆盖，那份也已合成白底）
    const tuBiaoLuJing = warmyTaskbarIcon();
    let winTubiao = nativeImage.createFromPath(tuBiaoLuJing);
    try {
      if (payload.iconDataUrl && String(payload.iconDataUrl).startsWith('data:image')) {
        const fromChat = nativeImage.createFromDataURL(String(payload.iconDataUrl));
        if (!fromChat.isEmpty()) winTubiao = fromChat;
      }
    } catch { /* fallback logo */ }
    const w = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 640,
      minHeight: 420,
      title: biaoTi,
      // Windows/Linux：无系统边框，但渲染层保留 #biaoTiLan（可拖动 + 窗控）
      frame: process.platform === 'darwin',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      backgroundColor: '#ededed',
      icon: tuBiaoLuJing,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 独立会话窗也要能播提示音（决策卡可能出现"没选中会话"的那一侧）
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    try { if (!winTubiao.isEmpty()) w.setIcon(winTubiao); } catch { /* noop */ }
    // 独立会话窗一律 chat+panel 模式（不再展示完整主界面）
    void w.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
      query: {
        chatId: payload.id,
        chatKind: payload.kind || 'single',
        chatBiaoTi: biaoTi,
        mode: 'fu',
      },
    });
    w.on('closed', () => chatWindows.delete(payload.id));
    chatWindows.set(payload.id, w);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── I. 全局热键 ──
chuliIpc('warmy:zhuCeKuaiJieJian', (_e, accel: string) => {
  try {
    globalShortcut.unregister(accel);
    const ok = globalShortcut.register(accel, () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    return { ok };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── J. 托盘 ──
let tuopanGuanGongzuoBiaoqian = '下班';
let daochuTouBiaoqian = '导出自';
let exportMeLabel = '我';
function chuangjianTuopan() {
  if (tray) return;
  // 系统托盘：白底版
  const tuBiaoLuJing = warmyTaskbarIcon();
  let tuPian = nativeImage.createFromPath(tuBiaoLuJing);
  if (tuPian.isEmpty()) {
    tuPian = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icons', 'logo-32.png'));
  }
  if (tuPian.isEmpty()) {
    tuPian = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icons', 'app-32.png'));
  }
  if (tuPian.isEmpty()) {
    tuPian = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAAgQAAF/lPurAAAAAElFTkSuQmCC', 'base64')
    );
  }
  const t = new Tray(tuPian);
  t.setToolTip('无限牛马 WArmy');
  // 下班 = 真正退出（必须走 quitApp：置 forceQuit + 毁托盘，否则 close 会把退出拦成隐藏）
  t.setContextMenu(Menu.buildFromTemplate([
    { label: tuopanGuanGongzuoBiaoqian, click: () => { tuichuYingyong('tray-off-work'); } },
  ]));
  t.on('double-click', () => { zhuJiaoZhuChuangKouJuZhong(); });
  tray = t;
}
chuliIpc('warmy:tuoPanChuShi', () => {
  try {
    chuangjianTuopan();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});


// 托盘提示语由渲染层按当前语言下发（logo 文案随语言变化）
chuliIpc('warmy:tuoPanTiShi', (_e, payload: string | { text?: string; offWork?: string; header?: string; wo?: string }) => {
  try {
    const p = typeof payload === 'string' ? { text: payload } : payload || {};
    if (p.text) tray?.setToolTip(String(p.text).slice(0, 120));
    if (p.offWork && p.offWork !== tuopanGuanGongzuoBiaoqian) {
      tuopanGuanGongzuoBiaoqian = String(p.offWork);
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: tuopanGuanGongzuoBiaoqian, click: () => { tuichuYingyong('tray-off-work'); } },
      ]));
    }
    if (p.header) daochuTouBiaoqian = String(p.header);
    if (p.wo) exportMeLabel = String(p.wo);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── K. 会话导出 Markdown ──
chuliIpc('warmy:daoChuHuiHua', (_e, payload: { biaoTi?: string; title?: string; xiaoXiJi: Array<{ role: string; text: string; ts?: number }> }) => {
  try {
    // 字段名两种都收（渲染层历史上发过 title）；取值兜底，绝不 undefined.replace
    const biaoTi = String(payload?.biaoTi || payload?.title || '会话导出');
    const dir = path.join(app.getPath('userData'), 'exports');
    // 写操作门禁：导出目录是共享产物，先拿租约再写
    const guarded = daiZuYue('exports', ['exports'], () => {
      fs.mkdirSync(dir, { recursive: true });
      const HangJi = [
        '# ' + biaoTi,
        '',
        '> ' + daochuTouBiaoqian + ' WArmy · ' + new Date().toLocaleString(),
        '',
      ];
      for (const xiaoXi of payload.xiaoXiJi || []) {
        // 角色两套命名都要认（wo|user = 我）：只认 'wo' 会把 user 标成对方
        const shui = (xiaoXi.role === 'wo' || xiaoXi.role === 'user') ? exportMeLabel : biaoTi;
        const time = xiaoXi.ts ? new Date(xiaoXi.ts).toLocaleString() : '';
        HangJi.push(`**${shui}** ${time}`);
        HangJi.push('');
        HangJi.push(xiaoXi.text || '');
        HangJi.push('');
      }
      const file = path.join(dir, `${biaoTi.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.md`);
      fs.writeFileSync(file, HangJi.join('\n'), 'utf8');
      return file;
    });
    if (!guarded.ok) {
      return { ok: false, error: 'lease-denied', errorCode: guarded.errorCode, reason: guarded.reason, conflicts: guarded.conflicts };
    }
    return { ok: true, path: guarded.value };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

// ── L. 自动更新（真实查询 + 真实下载校验；自动安装未实现，明确标记） ──
chuliIpc('warmy:ziDongGengXinJianCha', async () =>
  anQuanChuLiYiBu<GengXinJianChaJieGuo>(
    async () => (updater ? await updater.check() : gengXinqiBuKeYongJianCha(yingyongBanben())),
    gengXinqiBuKeYongJianCha(yingyongBanben())
  )
);
chuliIpc('warmy:ziDongGengXinXiaZai', async () =>
  anQuanChuLiYiBu<GengXinXiaZaiJieGuo>(
    async () => (updater ? await updater.download() : gengXinqiBuKeYongXiaZai(yingyongBanben())),
    gengXinqiBuKeYongXiaZai(yingyongBanben())
  )
);

// ── L2. 更新源配置（写入 settings.json 的 updateFeedUrl / updateChannel） ──
function updateSourceSnapshot(): GengXinYuanXinXi & { ok: boolean } {
  const info = updater?.getSourceInfo();
  if (info) return { ok: true, ...info };
  return {
    ok: false,
    configured: false,
    url: null,
    origin: 'none',
    channel: '',
    currentVersion: yingyongBanben(),
    error: 'updater unavailable',
  };
}
chuliIpc('warmy:gengXinLaiYuanQu', () => anQuanChuLi(() => updateSourceSnapshot(), updateSourceSnapshot()));
chuliIpc('warmy:gengXinLaiYuanSheZhi', (_e, payload: { url?: string; channel?: string }) => {
  try {
    if (!settingsStore) return { ok: false, error: 'settings not ready' };
    const patch: Record<string, unknown> = {};
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (url) {
      const v = jiaoyanGengxinyuanUrl(url);
      if (!v.ok) return { ok: false, error: v.error }; // 校验信息是给用户看的，不含内部路径
      patch['updateFeedUrl'] = v.url;
    } else {
      patch['updateFeedUrl'] = ''; // 清空 = 未配置
    }
    if (typeof payload?.channel === 'string') patch['updateChannel'] = payload.channel.trim().slice(0, 40);
    const w = settingsStore.save(patch as never);
    if (!w) return { ok: false, error: 'cannot persist update source' };
    audit?.log('update.source.set', { configured: !!url });
    return updateSourceSnapshot();
  } catch {
    return { ok: false, error: 'cannot persist update source' };
  }
});


// ── M. 群成员管理（真实持久化：userData/groups.json） ──
chuliIpc('warmy:qunChengYuanJi', (_e, groupId: string) =>
  anQuanChuLi<QunChengYuanJieGuo & { localIsCreator?: boolean }>(
    () => {
      const qunId = String(groupId || '');
      if (!groupStore) return { ok: false, groupId: qunId, members: [], error: 'group store unavailable' };
      // 路由里已有但成员表缺的（例如更早版本入群）补一次，保证列表与路由一致
      syncMembersFromRouter(qunId);
      const members = groupStore.listMembers(qunId);
      /**
       * ADR 004 §2.2：**只有创建者**能启动/停止项目。
       * 判定依据是 group-store 里记的 `creatorFingerprint`（建群时写入的**本机身份指纹**）
       * 与本机当前身份指纹是否相等 —— 不在渲染层猜、也不新增一套"谁是创建者"的定义。
       * 拿不到指纹时如实回 false（宁可少一个按钮，也不要给错人权限）。
       */
      const chuangJianZheZhiWen = String(groupStore.getGroup(qunId)?.creatorFingerprint || '');
      const benJiZhiWen = String(identityStore?.info()?.zhiWen || '');
      const localIsCreator = !!chuangJianZheZhiWen && !!benJiZhiWen && zhiwenPipei(chuangJianZheZhiWen, benJiZhiWen);
      return { ok: true, groupId: qunId, members, localIsCreator };
    },
    { ok: false, members: [], error: 'group store unavailable' }
  )
);
/**
 * 邀请入群。**邀请时若带了对方的身份名片（fingerprint + publicKey）就顺手签发成员证书**
 * （ADR §2.3 第 6 条：成员加入时由项目主签发）。
 * 拿不到名片也照常加入，但**指纹留空**并记一条审计 —— 不猜、不伪造。
 */
chuliIpc(
  'warmy:qunYaoQing',
  async (
    _e,
    payload: { groupId: string; ming: string; role?: string; zhiWen?: string; publicKey?: string; displayName?: string }
  ) => {
    try {
      if (!groupStore) return { ok: false, error: 'group store unavailable' };
      const qunId = String(payload?.groupId || '');
      const role = payload?.role === 'admin' ? 'admin' : 'member';
      const fp = String(payload?.zhiWen || '').trim();
      const pub = String(payload?.publicKey || '').trim();
      const r = groupStore.addMemberWithFingerprint(
        qunId,
        {
          ming: String(payload?.ming || payload?.displayName || ''),
          role,
          source: 'invite',
          ...(fp ? { zhiWen: fp } : {}),
        },
        { onAudit: (op, detail) => audit?.log(op, detail) }
      );
      if (!r.ok) return { ok: false, error: r.error || 'invite failed', members: r.members };
      audit?.log('group.invite', { groupId: qunId, withFingerprint: !!fp });
      const result: { ok: boolean; members: typeof r.members; certId?: string; certError?: string } = {
        ok: true,
        members: r.members,
      };
      if (fp && pub) {
        const issued = await weiQunQianFaChengYuanZhengShu(qunId, {
          memberFingerprint: fp,
          memberPublicKey: pub,
          displayName: String(payload?.displayName || payload?.ming || ''),
          role,
          memberId: String(payload?.ming || ''),
        });
        if (issued.ok && issued.cert) result.certId = issued.cert.certId;
        else result.certError = String(issued.code);
      }
      return result;
    } catch {
      return { ok: false, error: 'invite failed' };
    }
  }
);
/**
 * 踢人 —— **同时吊销他的成员证书**（reason: 'departed'），并把新版吊销列表广播给在线成员。
 * 这是"吊销后拿旧证书重连必须被拒"的真实入口：证书先在本地吊销，再同步出去。
 */
chuliIpc('warmy:qunTi', async (_e, payload: { groupId: string; memberId: string }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const qunId = String(payload?.groupId || '');
    const zhongJian = String(payload?.memberId || '');
    const before = groupStore.listMembers(qunId).find((m) => m.id === zhongJian);
    const r = groupStore.removeMember(qunId, zhongJian);
    if (!r.ok) return { ok: false, error: r.error || 'kick failed', members: r.members };
    // 本机实例被踢时同步退出路由值班池
    const ti = router.listMembers(qunId).find((m) => m.id === zhongJian || `inst:${m.id}` === zhongJian);
    if (ti) router.leave(qunId, ti.id);
    audit?.log('group.kick', { groupId: qunId });
    let revoked: { certId: string; listVersion: number } | null = null;
    let revokeError: string | null = null;
    const membership = quChengYuanMingceCang(identityStore);
    const targetFp = before?.zhiWen ?? '';
    if (membership && targetFp) {
      const cert = membership.certificateForFingerprint(qunId, targetFp);
      const signer = identityStore ? chuangjianShenfenQianmingzhe(identityStore) : null;
      if (!cert) {
        revokeError = 'no-certificate';
      } else if (!signer) {
        revokeError = 'identity-missing';
      } else {
        const rv = await chexiaoChengyuanZhengshu({
          signer,
          membership,
          groupId: qunId,
          certId: cert.certId,
          memberFingerprint: cert.memberFingerprint,
          reason: 'departed',
        });
        if (rv.ok && rv.LieBiao) {
          revoked = { certId: cert.certId, listVersion: rv.LieBiao.listVersion };
          audit?.log('membership.revoked', { groupId: qunId, certId: cert.certId, reason: 'departed' });
          void guangBoCheXiaoBiao(qunId, rv.LieBiao);
        } else {
          revokeError = String(rv.code);
        }
      }
    } else if (membership && !targetFp) {
      revokeError = 'no-fingerprint';
    }
    return {
      ok: true,
      members: r.members,
      revoked,
      ...(revokeError ? { revokeError } : {}),
    };
  } catch {
    return { ok: false, error: 'kick failed' };
  }
});
chuliIpc('warmy:qunSheZhiGuanLiYuan', (_e, payload: { groupId: string; memberId: string; admin: boolean }) => {
  try {
    if (!groupStore) return { ok: false, error: 'group store unavailable' };
    const qunId = String(payload?.groupId || '');
    const zhongJian = String(payload?.memberId || '');
    const r = groupStore.setAdmin(qunId, zhongJian, !!payload?.admin);
    if (!r.ok) return { ok: false, error: r.error || 'set admin failed', members: r.members };
    return { ok: true, members: r.members };
  } catch {
    return { ok: false, error: 'set admin failed' };
  }
});
/**
 * **实体级状态变了**：同一个会话/群/项目/联系人的**两处视图**都要跟着变。
 *
 * 产品主的表述很准："主界面的窗口和新窗口是同一个实体……就是它们本窗口、2 处显示"。
 * 所以这里既不是"把新窗口的内容发给主界面"，也不是各存一份状态，而是：
 * 实体状态只存在主进程这一处（群定向、项目属性、成员、禁用…都改了这里），
 * 改完只发一条**变化通知**，两个窗口各自按同一份事实重新渲染自己的那处视图。
 */
function tongzhiShitiBiangeng(id: string, kind: string, exceptId?: number): void {
  const key = String(id || '');
  if (!key) return;
  try { broadcastToWindows('warmy:shiTiUpdated', { id: key, kind, ts: Date.now() }, exceptId); } catch { /* noop */ }
}

chuliIpc('warmy:qunDingXiang', (e, payload: { groupId: string; directed: boolean }) => {
  try {
    const g = router.getGroup(payload.groupId);
    if (!g) return { ok: false, error: 'no group' };
    g.directedMode = !!payload.directed;
    groupStore?.setDirected(payload.groupId, g.directedMode);
    /**
     * 实体级状态（"只回我"开关）也是**同一个实体的属性**：另一个窗口若正看着这个群，
     * 它的开关必须跟着变 —— 两个窗口是同一实体的两处视图，不是两份各自的状态。
     */
    tongzhiShitiBiangeng(payload.groupId, 'group', e?.sender?.id);
    return { ok: true, directedMode: g.directedMode };
  } catch (e2) { return { ok: false, error: 'directed mode failed' }; }
});


// ── N. 会话内嵌看板 ──
chuliIpc('warmy:kanbanHuiHua', (_e, groupId: string) => ({
  ok: true,
  RenwuJi: board?.listTasks(groupId) || [],
  events: (board?.tailEvents(20) || []).filter((e) => e.groupId === groupId),
}));


// ── O. CCR 工具输出压缩 ──
chuliIpc('warmy:ccrGongJuShuChu', (_e, payload: { toolName?: string; content: string }) => {
  try {
    const r = ccr.beforeLog({ kind: 'tool_result', content: payload.content, toolName: payload.toolName });
    metrics.recordCcr({ ts: Date.now(), kind: 'tool_result', originalBytes: r.originalBytes, compressedBytes: r.compressedBytes });
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});


// ── P. 知识库详情 ──
chuliIpc('warmy:zhiShiKuXiangQing', (_e, q: string) => {
  try {
    const r = knowledge?.query(q) || { entities: [], events: [] };
    return {
      ok: true,
      entities: r.entities.map((e) => ({ id: e.id, ming: e.ming, kind: e.kind, attrs: e.attrs, eventIds: e.eventIds })),
      events: r.events.map((e) => ({ id: e.id, biaoTi: e.biaoTi, result: e.result, ts: e.ts, entityIds: e.entityIds })),
    };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});


// ── Q. 错误提示 ──
chuliIpc('warmy:zuiHouCuoWu', () => anQuanChuLi(() => ({ ok: true, error: lastError }), { ok: true, error: null }))
chuliIpc('warmy:qingChuCuoWu', () => { lastError = null; return { ok: true }; });



// ── 项目 MEMORY / AI 决策卡 / 门禁 / read-back / 去重 ──

/** 项目 MEMORY：唯一落点 = groups.json project.memory */
chuliIpc('warmy:xiangMuJiYiQu', (_e, payload?: { sessionId?: string }) => {
  try {
    const qunId = String(payload?.sessionId || '');
    const memory = readProjectMemory(groupStore, qunId);
    return { ok: true, groupId: qunId, memory, chars: memory.length };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:xiangMuJiYiSheZhi', async (_e, payload?: { sessionId?: string; memory?: string }) => {
  try {
    const qunId = String(payload?.sessionId || '');
    const jiYi = String(payload?.memory ?? '');
    const w = writeProjectMemory(groupStore, qunId, jiYi);
    if (!w.ok) return { ok: false, error: w.error };
    // read-back：从存储读回再确认
    const rb = await daiHuiDuYanZheng(
      () => jiYi,
      () => readProjectMemory(groupStore, qunId),
      (saved, back) => String(saved).slice(0, 8000) === String(back).slice(0, 8000)
    );
    void faBuXiangMuShuXing(qunId);
    return { ok: rb.confident, saved: w.chars, memory: rb.readBack || '', readBack: rb.match, error: rb.error };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** AI 工作中求助选项卡（永远含「其他」自定义输入） */
chuliIpc('warmy:aiWenTiDaKai', (_e, payload?: { groupId?: string; sessionId?: string; biaoTi?: string; ti?: string; options?: Array<{ id?: string; biaoQian: string; description?: string; tuiJian?: boolean }> }) => {
  try {
    const q = aiQuestions.daKai({
      groupId: String(payload?.groupId || payload?.sessionId || ''),
      sessionId: payload?.sessionId,
      biaoTi: String(payload?.biaoTi || '需要你的决定'),
      ti: payload?.ti,
      options: payload?.options || [],
    });
    fachuKongzhitai({ cat: 'system', code: 'ai.question.daKai', data: { id: q.id, groupId: q.groupId, biaoTi: q.biaoTi } });
    return { ok: true, question: q };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:aiWenTiLieBiao', (_e, groupId?: string) => {
  try {
    return { ok: true, items: aiQuestions.LieBiao(typeof groupId === 'string' ? groupId : undefined) };
  } catch (e) {
    return { ok: false, items: [], error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:aiWenTiAnswer', (_e, payload?: { id?: string; optionId?: string; customText?: string }) => {
  try {
    const r = aiQuestions.answer(String(payload?.id || ''), String(payload?.optionId || AI_QUESTION_CUSTOM), payload?.customText);
    return r;
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** 门禁判停：仅项目配置了 gateVerify 时才可能跑；主进程串行防并发风暴 */
const menjinYunxing = new Map<string, number>();
async function yunxingXiangmuMenjinYici(groupId: string, reason: string): Promise<{ pass: boolean; summary: string } | null> {
  try {
    const xiangMu = groupStore?.projectOf(groupId);
    const gates = xiangMu?.gateVerify || [];
    if (!gates.length) return null;
    const now = Date.now();
    const last = menjinYunxing.get(groupId) || 0;
    if (now - last < 3000) return { pass: !!xiangMu?.gateLast?.pass, summary: '节流：3s 内不重复跑门禁' };
    menjinYunxing.set(groupId, now);
    const repo = path.resolve(__dirname, '..', '..', '..');
    const HangJi: string[] = [];
    let allPass = true;
    for (const xiangDuiLu of gates.slice(0, 4)) {
      const script = path.join(repo, xiangDuiLu);
      if (!fs.existsSync(script)) {
        allPass = false;
        HangJi.push(`${xiangDuiLu}: missing`);
        continue;
      }
      const out = await new Promise<{ code: number; tail: string }>((resolve) => {
        // windowsHide：仓库钩子脚本是后台跑的，不该在桌面上弹控制台窗口
        const Zhi = spawn(process.execPath, [script], { cwd: repo, env: process.env, windowsHide: true });
        let buf = '';
        Zhi.stdout?.on('data', (d) => { buf += String(d); if (buf.length > 4000) buf = buf.slice(-2000); });
        Zhi.stderr?.on('data', (d) => { buf += String(d); if (buf.length > 4000) buf = buf.slice(-2000); });
        Zhi.on('close', (code) => resolve({ code: code ?? 1, tail: buf.split('\n').filter(Boolean).slice(-3).join(' | ') }));
        Zhi.on('error', () => resolve({ code: 1, tail: 'spawn-failed' }));
      });
      const pass = out.code === 0;
      if (!pass) allPass = false;
      HangJi.push(`${xiangDuiLu}: ${pass ? 'pass' : 'fail(rc=' + out.code + ')'} ${out.tail}`.slice(0, 160));
    }
    groupStore?.setProjectAttrs(groupId, { gateLast: { at: now, pass: allPass, summary: HangJi.join(' ; ') } });
    return { pass: allPass, summary: HangJi.join(' ; ') || 'no gates' };
  } catch (e) {
    return { pass: false, summary: xiJingCuoWu(e) };
  }
}

/** skills-scan-dirs-set：路径去重 + read-back */
const _skillsScanSet = chuliIpc;
chuliIpc('warmy:jinengJiSaoMiaoMuLuJiSheZhi', (_e, dirs: unknown) => {
  const raw = Array.isArray(dirs) ? dirs.map((d) => String(d || '').trim()).filter(Boolean) : [];
  const { LieBiao, removed } = anGuiFanHuaQuChong(raw, guiFanLuJingMiyao);
  if (LieBiao.length > SKILL_SCAN_DIRS_MAX) {
    return { ok: false, error: 'too-many-dirs', max: SKILL_SCAN_DIRS_MAX, count: LieBiao.length };
  }
  try {
    const next = settingsStore?.save({ skillScanDirs: LieBiao } as never);
    const readBack = ((next as any)?.skillScanDirs || []) as string[];
    const match = readBack.length === LieBiao.length && LieBiao.every((x, i) => guiFanLuJingMiyao(readBack[i]) === guiFanLuJingMiyao(x));
    return { ok: true, dirs: LieBiao, scanDirs: jinengSaomiaoZhuangtai(LieBiao), settings: next, removedDups: removed, readBack: match, confident: match };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

/** update-source-set：read-back */
chuliIpc('warmy:gengXinLaiYuanSheZhi', async (_e, payload?: { url?: string }) => {
  try {
    const url = String(payload?.url || '').trim();
    const patch: Record<string, unknown> = { updateFeedUrl: url };
    const saved = settingsStore?.save(patch as never);
    const readBack = ((saved as any)?.updateFeedUrl || '') as string;
    const match = readBack === url;
    return { ok: true, configured: !!url, url: readBack, origin: url ? 'settings' : 'none', readBack: match, confident: match };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});


/* ── 定时任务：登记 / 列表 / 删除；到点由宿主广播给界面发一轮 ────────────────
   产品要求：用户让牛马执行定时任务时自动出现「定时任务」卡片；即使被关掉，
   到点执行时也会检查卡片是否存在、不存在就补回来（见渲染层 __queBaoKaPian）。 */
type DingShiRenWu = {
  id: string; sessionId: string; name: string; prompt: string;
  everyMinutes: number; dailyAt: string; desc: string;
  nextAt: number; lastAt: number; enabled: boolean;
  /** 创建时间（产品要求：卡片上要显示） */
  createdAt: number;
  /** 循环几次：0 = 无限（产品要求：卡片上要显示） */
  repeat: number;
};
const dingShiRenWuJi: DingShiRenWu[] = [];
function dingShiWenJian() { return path.join(app.getPath('userData'), 'scheduled-tasks.json'); }
function baoCunDingShi() {
  try { fs.writeFileSync(dingShiWenJian(), JSON.stringify(dingShiRenWuJi, null, 2)); } catch { /* 不影响本次 */ }
}
function duQuDingShi() {
  try {
    const j = JSON.parse(fs.readFileSync(dingShiWenJian(), 'utf8'));
    if (Array.isArray(j)) { dingShiRenWuJi.length = 0; dingShiRenWuJi.push(...j); }
  } catch { /* 首次没有 */ }
}
function suanXiaCi(everyMinutes: number, dailyAt: string): number {
  const now = Date.now();
  if (everyMinutes > 0) return now + everyMinutes * 60000;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(dailyAt || ''));
  if (m) {
    const d = new Date(now);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return now + 60 * 60000;
}
async function dengJiDingShiRenWu(sessionId: string, p: { name: string; prompt: string; everyMinutes?: number; dailyAt?: string; repeat?: number }) {
  try {
    if (!String(p.prompt || '').trim()) return { ok: false, error: 'empty-prompt' };
    const everyMinutes = Math.max(0, Math.floor(Number(p.everyMinutes) || 0));
    const dailyAt = String(p.dailyAt || '').trim();
    if (!everyMinutes && !/^(\d{1,2}):(\d{2})$/.test(dailyAt)) return { ok: false, error: 'need-everyMinutes-or-dailyAt' };
    /** 循环次数：0 = 无限；负数/非数字按 0（无限）处理 */
    const repeat = Math.max(0, Math.floor(Number(p.repeat) || 0));
    const ren: DingShiRenWu = {
      id: 'sch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      sessionId: String(sessionId || ''), name: String(p.name || '定时任务').slice(0, 60),
      prompt: String(p.prompt).slice(0, 2000), everyMinutes, dailyAt,
      desc: everyMinutes ? `每隔 ${everyMinutes} 分钟` : `每天 ${dailyAt}`,
      nextAt: suanXiaCi(everyMinutes, dailyAt), lastAt: 0, enabled: true,
      createdAt: Date.now(),
      repeat,
    };
    dingShiRenWuJi.push(ren);
    baoCunDingShi();
    try { broadcastToWindows('warmy:dingShiRenWu', { tasks: dingShiRenWuJi }); } catch { /* noop */ }
    return { ok: true, task: ren };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
}
/** 分身（子代理）卡：列出会话里的子代理 / 手动停止 */
function xiaoDiBu() {
  return new XiaoDiDengJiBu(path.join(app.getPath('userData'), 'xiaodi.json'));
}
chuliIpc('warmy:xiaoDiLieBiao', (_e, sessionId?: string) => anQuanChuLi(
  () => {
    const sid = String(sessionId || '');
    const bu = xiaoDiBu();
    const items = sid ? bu.listHuiHua(sid) : bu.all();
    return { ok: true, items, all: bu.all() };
  },
  { ok: true, items: [], all: [] },
));
chuliIpc('warmy:xiaoDiTingZhi', (_e, p0?: { id?: string }) => anQuanChuLi(() => {
  const id = String(p0?.id || '');
  if (!id) return { ok: false, error: 'bad-id' };
  const lu = xiaoDiBu().gengXin(id, { status: 'stopped', endedAt: Date.now() });
  if (lu) {
    try { broadcastToWindows('warmy:xiaoDiBianGeng', { sessionId: lu.sessionId, id, status: 'stopped' }); } catch { /* noop */ }
    return { ok: true, lu };
  }
  return { ok: false, error: 'not-found' };
}, { ok: false, error: 'failed' }));

/**
 * **删除会话**（产品要求：右键「清空」改名「删除」；二次确认后回到"创建前的样子"）。
 * 做四件事：
 *   ① 牛马：先查它在不在任何群聊/项目里 —— 在的话**如实拒绝并写清在哪儿**，要求先移除；
 *   ② 停掉实例；
 *   ③ 删掉**本会话自己的**知识库（`sess-<id>` 实体）与它的工作区目录；
 *   ④ 会话记录本身由渲染层从列表里去掉（主进程不再持有它）。
 * **已经归档进「知识库」（项目级）的内容不动** —— 那是另一份资产。
 */
chuliIpc('warmy:huiHuaShanChu', async (_e, p0?: { id?: string; kind?: string }) => {
  try {
    const id = String(p0?.id || '');
    if (!id) return { ok: false, error: 'bad-id' };
    const kind = String(p0?.kind || '');
    // ① 牛马：在群聊/项目里就不许删
    if (kind === 'agent' || kind === 'single') {
      const zai: string[] = [];
      try {
        const ji = (groupStore as { listGroups?: () => unknown[] } | null)?.listGroups?.() || [];
        for (const g of ji) {
          const o = (g || {}) as { members?: unknown; ming?: string; name?: string; groupId?: string; id?: string };
          const ms = Array.isArray(o.members) ? o.members.map(String) : [];
          const gid = String(o.groupId || o.id || '');
          if (ms.includes(id) || (gid && gid === id)) zai.push(String(o.ming || o.name || gid));
        }
      } catch { /* 拿不到就当没在群里 */ }
      if (zai.length) return { ok: false, error: 'in-membership', where: zai };
      // 停掉实例（与 `warmy:tingZhiShiLi` 同一套步骤：先标记停止，续派循环才不会再往下派）
      try {
        stoppedSessions.add(id);
        zhongZhiXinHao(id); // 真的把在途请求取消掉
        yanXuZhuangTai.delete(id);
        await p1?.instances.stop(id);
      } catch { /* 停不掉也继续删 */ }
    }
    // ③ 本会话自己的知识库 + 工作区
    let kb = false;
    try { kb = !!knowledge?.removeEntity('sess-' + id); } catch { /* noop */ }
    let ws = false;
    try {
      const dir = workspaceDirOf(app.getPath('userData'), id);
      if (dir && fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); ws = true; }
    } catch { /* 删不掉就如实说 */ }
    try { audit?.log('session.delete', { sessionId: id, kind, kb, workspace: ws }); } catch { /* noop */ }
    return { ok: true, removed: { knowledge: kb, workspace: ws } };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});


function qiDongDingShiJianCha() {
  duQuDingShi();
  setInterval(() => {
    const now = Date.now();
    for (const ren of dingShiRenWuJi) {
      if (!ren.enabled || ren.nextAt > now) continue;
      ren.lastAt = now;
      ren.nextAt = suanXiaCi(ren.everyMinutes, ren.dailyAt);
      baoCunDingShi();
      // 到点：广播给界面发一轮（顺带把卡片补回来，见渲染层）
      try { broadcastToWindows('warmy:dingShiDaoDian', { sessionId: ren.sessionId, prompt: ren.prompt, taskId: ren.id, name: ren.name }); } catch { /* noop */ }
    }
  }, 20000);
}
chuliIpc('warmy:dingShiRenWuLieBiao', () => anQuanChuLi(() => ({ ok: true, tasks: dingShiRenWuJi }), { ok: true, tasks: [] }));
chuliIpc('warmy:dingShiRenWuShanChu', (_e, p0?: { id?: string }) => {
  try {
    const i = dingShiRenWuJi.findIndex((x) => x.id === String(p0?.id || ''));
    if (i >= 0) dingShiRenWuJi.splice(i, 1);
    baoCunDingShi();
    try { broadcastToWindows('warmy:dingShiRenWu', { tasks: dingShiRenWuJi }); } catch { /* noop */ }
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
// 定时任务暂停/恢复（enabled 开关）
chuliIpc('warmy:dingShiRenWuGengXin', (_e, p0?: { id?: string; enabled?: boolean }) => {
  try {
    const it = dingShiRenWuJi.find((x) => x.id === String(p0?.id || ''));
    if (!it) return { ok: false, error: 'not-found' };
    it.enabled = p0?.enabled !== false;
    baoCunDingShi();
    try { broadcastToWindows('warmy:dingShiRenWu', { tasks: dingShiRenWuJi }); } catch { /* noop */ }
    return { ok: true, enabled: it.enabled };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/**
 * **朗读文字**（说话模型 / TTS）：用「模型选项 → 说话模型」里默认那个。
 * 没有可用的说话模型就如实回错误，不假装读了。
 */
chuliIpc('warmy:ttsLangDu', async (_e, p0?: { text?: string }) => {
  try {
    const s = String(p0?.text || '').trim();
    if (!s) return { ok: false, error: 'empty-text' };
    // 说话模型：取 tts 调用链上第一个未禁用的
    const sm = (settingsStore?.load() as { specialModels?: Record<string, unknown> } | undefined)?.specialModels || {};
    const lian = Array.isArray(sm.ttsChain) ? (sm.ttsChain as string[]) : [];
    const jin = Array.isArray(sm.ttsDisabled) ? (sm.ttsDisabled as string[]) : [];
    const mo = lian.find((m) => m && !jin.includes(m)) || '';
    if (!mo) return { ok: false, error: 'no-tts-model（请在「设置 → 模型 → 说话模型」里配置）' };
    const an = await jieMoXingGongYingShang(mo);
    if (!an) return { ok: false, error: 'tts-provider-not-found（模型 ' + mo + ' 不在任何供应商里）' };
    if (!an.apiKey && an.protocol !== 'ollama') return { ok: false, error: 'no-key（' + an.biaoQian + ' 未配密钥）' };
    const provider = congYuSheChuangJian(an.presetId, { apiKey: an.apiKey, baseURL: an.baseURL || undefined, protocol: an.protocol } as never, an.protocol);
    /**
     * TTS 非通用接口：先试 OpenAI 兼容 `/audio/speech`；Ollama 不支持则如实说。
     * 取不到音频就返回明确错误 —— **不假装读了**。
     */
    try {
      const res = await fetch(pinJieUrl(an.baseURL, 'audio/speech'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${an.apiKey}` },
        body: JSON.stringify({ model: mo, input: s.slice(0, 500), voice: (sm as { ttsVoice?: string }).ttsVoice || 'alloy', speed: Number((sm as { ttsSpeed?: number }).ttsSpeed || 1) }),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { ok: true, dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, model: mo };
      }
      return { ok: false, error: `tts HTTP ${res.status}（模型 ${mo} 可能不支持 /audio/speech）` };
    } catch (e2) {
      return { ok: false, error: 'tts-failed：' + xiJingCuoWu(e2) };
    }
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/**
 * **翻译**（专业模型优先，缺失回退）：有翻译模型就用它；没有就交给当前生效的对话模型。
 * 用户无感 —— 界面上只多一个「翻译」动作，用谁由这里决定。
 */
chuliIpc('warmy:fanYi', async (_e, p0?: { text?: string; target?: string }) => {
  try {
    const s = String(p0?.text || '').trim();
    if (!s) return { ok: false, error: 'empty-text' };
    const muBiao = String(p0?.target || '中文');
    const zhuan = await fanYiWenBen(s, muBiao);
    if (zhuan !== null) return { ok: true, text: zhuan || s, by: 'translate-model' };
    // 回退：用当前生效的对话模型
    const zhu = await jieMoXingGongYingShang(providerCfg.model || '');
    const use = zhu || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
    if (!use.apiKey && use.protocol !== 'ollama') return { ok: false, error: 'no-model（请先在「设置 → 模型」里配置供应商密钥）' };
    const p = congYuSheChuangJian(use.presetId, { apiKey: use.apiKey, baseURL: use.baseURL || undefined, protocol: use.protocol } as never, use.protocol);
    const r = await p.chat({
      model: providerCfg.model || 'deepseek-chat',
      xiaoXiJi: [
        { role: 'system', content: `你是翻译。只输出译文，不要解释。目标语言：${muBiao}。` },
        { role: 'user', content: s.slice(0, 4000) },
      ],
      maxTokens: 1024,
    });
    return { ok: true, text: neiRongWenBen(r.choices[0]?.message?.content) || s, by: 'chat-model(fallback)' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/**
 * **内容安全审核**（专业模型优先，缺失回退）：有安全模型就让它判；没有则交给对话模型判。
 * 返回 `by` 让界面/审计知道这一判是谁做的（无感但不无痕）。
 */
chuliIpc('warmy:anQuanShenHe', async (_e, p0?: { text?: string }) => {
  try {
    const s = String(p0?.text || '');
    if (!s.trim()) return { ok: true, safe: true, reason: '', by: 'skip(empty)' };
    const zhuan = await anQuanShenHeWenBen(s);
    if (zhuan) return { ok: true, ...zhuan };
    // 回退：对话模型判断
    const zhu = await jieMoXingGongYingShang(providerCfg.model || '');
    const use = zhu || { presetId: providerCfg.presetId, baseURL: providerCfg.baseURL || '', protocol: providerCfg.protocol, apiKey: providerCfg.apiKey || '', biaoQian: providerCfg.presetId };
    if (!use.apiKey && use.protocol !== 'ollama') return { ok: true, safe: true, reason: '', by: 'no-model(allow)' };
    const p = congYuSheChuangJian(use.presetId, { apiKey: use.apiKey, baseURL: use.baseURL || undefined, protocol: use.protocol } as never, use.protocol);
    const r = await p.chat({
      model: providerCfg.model || 'deepseek-chat',
      xiaoXiJi: [
        { role: 'system', content: '你是内容安全审核。只输出 JSON：{"safe":true|false,"reason":"简短理由"}。明显违规才判 false。' },
        { role: 'user', content: s.slice(0, 2000) },
      ],
      maxTokens: 96,
    });
    const txt = neiRongWenBen(r.choices[0]?.message?.content) || '';
    const m = txt.match(/"safe"\s*:\s*(true|false)/i);
    const rr = txt.match(/"reason"\s*:\s*"([^"]*)"/i);
    return { ok: true, safe: m ? String(m[1]).toLowerCase() === 'true' : true, reason: rr ? String(rr[1]) : '', by: 'chat-model(fallback)' };
  } catch (e) { return { ok: true, safe: true, reason: '', by: 'error(allow)', error: xiJingCuoWu(e) }; }
});

/** 界面上的「打开」按钮：用系统默认程序打开文件/目录。
 *  **这是用户自己在界面上点的**（产物卡/文件列表），不是 AI 工具 —— AI 开文件走 `open_path`（有越权门槛）。
 *  因此这里不做工作区外限制：AI 产出的桌面文件，用户点开必须能看（真事故：点了报 workspace-escape）。 */
chuliIpc('warmy:daKaiLuJing', async (_e, p0?: { path?: string }) => {
  try {
    const p = String(p0?.path || '').trim();
    if (!p) return { ok: false, error: 'bad-path' };
    const base = path.join(app.getPath('userData'), 'workspace');
    const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
    if (!fs.existsSync(abs)) return { ok: false, error: 'not-found：' + abs };
    const r = await shell.openPath(abs);
    return r ? { ok: false, error: r } : { ok: true, path: abs };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 图片附件预览：小图给 data URL（读不了/不是图片如实返回 ok:false） */
chuliIpc('warmy:wenJianYuLan', (_e, p0?: { path?: string; maxBytes?: number }) => {
  try {
    const p = String(p0?.path || '').trim();
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    const cap = Math.max(1024, Math.min(Number(p0?.maxBytes) || 3 * 1024 * 1024, 8 * 1024 * 1024));
    const st = fs.statSync(p);
    if (st.size > cap) return { ok: false, error: 'too-large' };
    const mime = /\.png$/i.test(p) ? 'image/png'
      : /\.jpe?g$/i.test(p) ? 'image/jpeg'
      : /\.gif$/i.test(p) ? 'image/gif'
      : /\.webp$/i.test(p) ? 'image/webp'
      : /\.bmp$/i.test(p) ? 'image/bmp'
      : /\.svg$/i.test(p) ? 'image/svg+xml'
      : '';
    if (!mime) return { ok: false, error: 'not-image' };
    return { ok: true, dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`, bytes: st.size };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
/** 在资源管理器里显示这个文件（导出后给用户看文件在哪） */
chuliIpc('warmy:xianShiWenJianJia', (_e, p0?: { path?: string }) => {
  try {
    const p = String(p0?.path || '').trim();
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'not-found' };
    shell.showItemInFolder(p);
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── R. 启动引导 ──
chuliIpc('warmy:chuShiSheZhiTai', () => {
  try {
    const s = settingsStore?.load() as Record<string, unknown> | undefined;
    // 首次运行/安装后首启：setupDone 非 true 一律弹语言选择
    const done = (s as { setupDone?: boolean })?.setupDone === true;
    const guideDone = (s as { guideDone?: boolean })?.guideDone === true;
    return { ok: true, done, guideDone, yuYan: s?.yuYan || app.getLocale() };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:chuShiSheZhiWanCheng', (_e, payload: { yuYan?: string; provider?: Record<string, unknown>; guideDone?: boolean }) => {
  try {
    if (payload.yuYan) settingsStore?.save({ yuYan: payload.yuYan } as never);
    if (payload.guideDone) settingsStore?.save({ guideDone: true } as never);
    if (payload.provider) {
      // 预填 provider
      Object.assign(providerCfg, {
        presetId: (payload.provider.presetId as string) || providerCfg.presetId,
        apiKey: (payload.provider.apiKey as string) || providerCfg.apiKey,
        baseURL: (payload.provider.baseURL as string) || providerCfg.baseURL,
        model: (payload.provider.model as string) || providerCfg.model,
      });
    }
    const cur = settingsStore?.load() as unknown as Record<string, unknown>;
    settingsStore?.save({ ...cur, setupDone: true } as never);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

/** Skill enable/pause flags (default enabled when key missing) */
function jinengQiyongYingShe(): Record<string, boolean> {
  try {
    const s = settingsStore?.load() as { skillEnabled?: Record<string, boolean> } | undefined;
    return (s && s.skillEnabled && typeof s.skillEnabled === 'object') ? { ...s.skillEnabled } : {};
  } catch {
    return {};
  }
}
chuliIpc('warmy:jinengJiSheZhiEnabled', (_e, payload: { id?: string; enabled?: boolean }) => {
  try {
    const id = String(payload?.id || '');
    if (!id) return { ok: false, error: 'missing-id' };
    const map = jinengQiyongYingShe();
    map[id] = payload?.enabled !== false;
    settingsStore?.save({ skillEnabled: map } as never);
    return { ok: true, id, enabled: map[id] };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
// patch skills-list to include enabled flag
const _skillsListHandler = async () => {
  const jinengJi: Array<Record<string, unknown>> = [];
  const saoMiaoMuluZhuangtai = jinengSaomiaoZhuangtai(jiaZaiJinengSaomiaoLuJing());
  const QiYongBiao = jinengQiyongYingShe();
  for (const { root, source } of jinengGen()) {
    if (!fs.existsSync(root)) continue;
    const tuiSongYiTiao = (dirName: string, md: string) => {
      const info = skillMdInfo(md);
      let mtime = 0;
      try { mtime = fs.statSync(md).mtimeMs; } catch { /* ignore */ }
      const id = source === 'discovered' ? 'discovered:' + path.basename(root) + ':' + dirName : dirName;
      const enabled = QiYongBiao[id] !== false;
      jinengJi.push({ id, ming: info.ming || dirName, description: info.description, source, root, mtime, enabled, removable: source !== 'discovered' });
    };
    if (source === 'discovered') {
      const benJiMiaoShu = path.join(root, 'SKILL.md');
      if (fs.existsSync(benJiMiaoShu)) tuiSongYiTiao(path.basename(root), benJiMiaoShu);
    }
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch { continue; }
    for (const d of dirs) {
      const md = path.join(root, d, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      tuiSongYiTiao(d, md);
    }
  }
  jinengJi.sort((x, y) => Number(y.mtime || 0) - Number(x.mtime || 0));
  return { ok: true, jinengJi, scanDirs: saoMiaoMuluZhuangtai, maxScanDirs: SKILL_SCAN_DIRS_MAX };
};
// re-register by replacing through handleIpc if it overwrites; electron handleIpc likely last-wins
chuliIpc('warmy:jinengJiLieBiao', () => _skillsListHandler());

// ── S. 消息搜索（从 memory-os recall） ──
chuliIpc('warmy:souSuoXiaoXiJi', async (_e, q: string) => {
  try {
    const r = await memory?.recall(q, 20);
    return { ok: true, hits: r?.cards || [] };
  } catch (e) {
    return { ok: false, hits: [], error: xiJingCuoWu(e) };
  }
});


// ── V. 插件真实安装/卸载 ──
chuliIpc('warmy:chaJianAnZhuang', (_e, pkg: string) => {
  try {
    const dshJiaMuLu = path.join(app.getPath('userData'), 'dsh-home');
    const profile = 'warmy';
    // 用 pnpm 安装到 profile
    const profileDir = path.join(dshJiaMuLu, 'profiles', profile);
    fs.mkdirSync(profileDir, { recursive: true });
    const BaoJson = path.join(profileDir, 'package.json');
    if (!fs.existsSync(BaoJson)) {
      fs.writeFileSync(BaoJson, JSON.stringify({ name: 'dsh-profile-warmy', private: true, dependencies: {} }, null, 2));
    }
    const xiangMuPeiZhi = JSON.parse(fs.readFileSync(BaoJson, 'utf8'));
    xiangMuPeiZhi.dependencies = xiangMuPeiZhi.dependencies || {};
    // 禁止裸 latest：必须带显式版本（name@1.2.3），避免供应链漂移
    const pin = String(pkg || '').trim();
    const m = pin.match(/^(?<name>(?:@[^/]+\/)?[^@]+)@(?<ver>[^@\s]+)$/);
    const pinName = m?.groups?.name;
    const pinVer = m?.groups?.ver;
    if (!pinName || !pinVer || pinVer === 'latest') {
      return { ok: false, error: 'plugin spec must pin a version (e.g. pkg@1.2.3), not latest', hint: 'pin-version' };
    }
    xiangMuPeiZhi.dependencies[pinName] = pinVer;
    fs.writeFileSync(BaoJson, JSON.stringify(xiangMuPeiZhi, null, 2));
    return { ok: true, profileDir, pkg: pinName, version: pinVer };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:chaJianXieZai', (_e, pkg: string) => {
  try {
    const dshJiaMuLu = path.join(app.getPath('userData'), 'dsh-home');
    const BaoJson = path.join(dshJiaMuLu, 'profiles', 'warmy', 'package.json');
    if (fs.existsSync(BaoJson)) {
      const xiangMuPeiZhi = JSON.parse(fs.readFileSync(BaoJson, 'utf8'));
      const pin = String(pkg || '').trim();
      const nm = (pin.match(/^(?<name>(?:@[^/]+\/)?[^@]+)(?:@[^@]+)?$/) || [])[1] || pin;
      if (xiangMuPeiZhi.dependencies) {
        delete xiangMuPeiZhi.dependencies[nm];
        delete xiangMuPeiZhi.dependencies[pin];
      }
      fs.writeFileSync(BaoJson, JSON.stringify(xiangMuPeiZhi, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});


// ── X. 归档列表 ──
const archived: Array<{ id: string; ming: string; kind: string; ts: number }> = [];
chuliIpc('warmy:yiGuiDangLieBiao', () => anQuanChuLi(() => ({ ok: true, items: archived }), { ok: true, items: [] }))
chuliIpc('warmy:yiGuiDangTianJia', (_e, payload: { id: string; ming: string; kind: string }) => {
  try {
    archived.push({ ...payload, ts: Date.now() });
    return { ok: true, items: archived };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:yiGuiDangHuiFu', (_e, id: string) => {
  try {
    const suoYin = archived.findIndex((x) => x.id === id);
    if (suoYin < 0) return { ok: false };
    const item = archived.splice(suoYin, 1)[0];
    return { ok: true, item };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});


// ── 审计日志 ──
chuliIpc('warmy:shenJiRiZhi', (_e, limit?: number) => ({
  ok: true,
  entries: audit?.read(limit || 50) || [],
}));
chuliIpc('warmy:shenJiQingChu', () => {
  try {
    audit?.clear();
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── SafeStorage 密钥 ──
chuliIpc('warmy:anQuanMiYaoBaoCun', async (_e, payload: { providerId: string; apiKey: string }) => {
  try {
    await secureKeys?.save(payload.providerId, payload.apiKey);
    audit?.log('key.save', { providerId: payload.providerId });
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:anQuanMiYaoJiaZai', async (_e, providerId: string) => {
  try {
    const key = await secureKeys?.load(providerId);
    return { ok: !!key, key: key || null };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── KnowledgeArchiver ──
chuliIpc('warmy:guiDangWaiBu', (_e, payload: { groupId: string; biaoTi: string; summary: string; anchors?: Array<{ file: string; seq: number }> }) => {
  let tiqu = null as null | ReturnType<typeof congGuiDangTiQuZhiShi> | { error?: string };
  let structured = null as null | ReturnType<typeof tiQuJieGouHuaZhaiYao>;
  try {
    tiqu = congGuiDangTiQuZhiShi({
      groupId: String(payload.groupId || ''),
      biaoTi: String(payload.biaoTi || ''),
      summary: String(payload.summary || ''),
    });
    structured = tiQuJieGouHuaZhaiYao({
      groupId: String(payload.groupId || ''),
      biaoTi: String(payload.biaoTi || ''),
      ti: String(payload.summary || ''),
    });
  } catch (e) {
    tiqu = { error: xiJingCuoWu(e) };
  }
  const r = archiver?.archive({
    id: 'arc-' + Date.now(),
    groupId: payload.groupId,
    biaoTi: payload.biaoTi,
    summary: payload.summary,
    anchors: payload.anchors || [],
    ...(structured ? { structured: { bullets: structured.bullets, decisions: structured.decisions, todos: structured.todos, risks: structured.risks } } : {}),
  });
  // 归档触发整理：摘要 → 知识库实体/事件 + 使用者偏好（持久跨会话）
  try {
    if (knowledge && tiqu && !(tiqu as { error?: string }).error) {
      const liWai = tiqu as ReturnType<typeof congGuiDangTiQuZhiShi>;
      for (const e of liWai.entities) {
        const LeiXingBiao = ['person', 'org', 'material', 'place', 'concept', 'tool', 'project'] as const;
        const kind = (LeiXingBiao as readonly string[]).includes(String(e.kind)) ? (e.kind as (typeof LeiXingBiao)[number]) : 'concept';
        knowledge.upsertEntity({ id: e.id, kind, ming: e.ming, attrs: e.attrs || {}, anchors: [] });
      }
      knowledge.upsertEntity({
        id: `grp-${payload.groupId}`,
        kind: 'project',
        ming: String(payload.groupId),
        attrs: {},
        anchors: (payload.anchors || []).map((a) => ({ file: a.file, seq: a.seq, recordId: `seq:${a.seq}` })),
      });
      for (const Shi of liWai.events) {
        knowledge.addEvent({
          id: Shi.id,
          biaoTi: Shi.biaoTi,
          result: Shi.result || '',
          entityIds: [`grp-${payload.groupId}`],
          anchors: (payload.anchors || []).map((a) => ({ file: a.file, seq: a.seq, recordId: `seq:${a.seq}` })),
          ts: Date.now(),
        });
      }
      if (liWai.preferences?.length) heBingYongHuPianHao(app.getPath('userData'), liWai.preferences);
    }
  } catch (e) {
    tiqu = { error: xiJingCuoWu(e) };
  }
  audit?.log('archive.external', { groupId: payload.groupId, prefs: (tiqu as { preferences?: unknown[] } | null)?.preferences?.length || 0 });
  return { ok: true, entry: r, tiqu, structured };
});
chuliIpc('warmy:huiHuaZhaiYao', async (_e, payload?: { sessionId?: string; auto?: boolean }) => {
  try {
    const qunId = String(payload?.sessionId || '');
    if (!qunId) return { ok: false, error: 'sessionId required' };
    const rizhi = chatLogs.get(qunId) || [];
    const recent = rizhi.slice(-30).map((l) => `${l.role}: ${String(l.content || '').slice(0, 160)}`).join('\n');
    if (!recent.trim()) return { ok: false, error: 'no-history' };
    const biaoTi = `${qunId} 会话摘要 ${new Date().toLocaleString()}`;
    const structured = tiQuJieGouHuaZhaiYao({ groupId: qunId, biaoTi, ti: recent });
    const summary =
      [
        `# ${biaoTi}`,
        structured.decisions.length ? `## 决策\n${structured.decisions.map((d) => '- ' + d).join('\n')}` : '',
        structured.todos.length ? `## 待办\n${structured.todos.map((d) => '- ' + d).join('\n')}` : '',
        structured.risks.length ? `## 风险\n${structured.risks.map((d) => '- ' + d).join('\n')}` : '',
        `## 要点\n${structured.bullets.map((d) => '- ' + d).join('\n')}`,
      ].filter(Boolean).join('\n\n').slice(0, 4000);
    // 尽量带上锚点：用最近日志的 seq（便于右栏「跳到原文」）
    const anchors = rizhi.slice(-5)
      .filter((l) => l && l.seq != null)
      .map((l) => ({ file: 'chat-log', seq: Number(l.seq || 0), recordId: `seq:${l.seq}` }));
    const entry = archiver?.archive({
      id: 'arc-' + Date.now(),
      groupId: qunId,
      biaoTi,
      summary,
      anchors,
      structured: {
        bullets: structured.bullets,
        decisions: structured.decisions,
        todos: structured.todos,
        risks: structured.risks,
      },
    });
    try {
      const liWai = congGuiDangTiQuZhiShi({ groupId: qunId, biaoTi, summary });
      if (knowledge) {
        knowledge.upsertEntity({ id: `grp-${qunId}`, kind: 'project', ming: qunId, attrs: {}, anchors: [] });
        for (const e of liWai.entities) {
          const LeiXingBiao = ['person','org','material','place','concept','tool','project'] as const;
          const kind = (LeiXingBiao as readonly string[]).includes(String(e.kind)) ? (e.kind as (typeof LeiXingBiao)[number]) : 'concept';
          knowledge.upsertEntity({ id: e.id, kind, ming: e.ming, attrs: e.attrs || {}, anchors: [] });
        }
        for (const Shi of liWai.events) {
          knowledge.addEvent({ id: Shi.id, biaoTi: Shi.biaoTi, result: Shi.result || '', entityIds: [`grp-${qunId}`], anchors: [], ts: Date.now() });
        }
      }
      if (liWai.preferences?.length) heBingYongHuPianHao(app.getPath('userData'), liWai.preferences);
    } catch { /* 提炼失败不影响摘要落盘 */ }
    audit?.log('session.summary', { sessionId: qunId, auto: !!payload?.auto });
    return { ok: true, entry, structured };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});
chuliIpc('warmy:guiDangLieBiao', (_e, groupId?: string) => ({
  ok: true,
  entries: archiver?.LieBiao(groupId) || [],
}));

// ── CleanupManager ──
chuliIpc('warmy:qingLiYunXing', (_e, opts?: { checkpoints?: number }) => {
  try {
    const n = cleanup?.cleanCheckpoints(opts?.checkpoints || 20) || 0;
    const v = cleanup?.cleanVoice() || 0;
    audit?.log('cleanup.run', { checkpoints: n, voice: v });
    return { ok: true, checkpointsRemoved: n, voiceRemoved: v };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 模型角色分配 ──
chuliIpc('warmy:jueSeMoXingJiSheZhi', (_e, roles: JueseMoxingPeizhi) => {
  try {
    roleModels = { ...roleModels, ...roles };
    audit?.log('roles.set', roles);
    return { ok: true, roles: roleModels };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:jueSeMoXingJiQu', () => anQuanChuLi(() => ({ ok: true, roles: roleModels }), { ok: true, roles: {} }))

// ── 解散群组 ──
chuliIpc('warmy:qunJieSan', (_e, groupId: string) => {
  try {
    // 只有创建者可解散（简化：本机节点）
    const g = router.getGroup(groupId);
    if (!g) return { ok: false, error: 'no group' };
    // 从 router 移除
    const members = router.listMembers(groupId);
    for (const m of members) router.leave(groupId, m.id);
    // 持久化的群记录与成员一起删掉
    const r = groupStore?.removeGroup(String(groupId || ''));
    if (r && !r.ok) return { ok: false, error: 'cannot persist dissolve' };
    audit?.log('group.dissolve', { groupId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'dissolve failed' };
  }
});

// ── 允许库导出 ──
chuliIpc('warmy:daoChuYunXuMingDan', () => {
  try {
    const LieBiao = p1?.security.listAllowlist() || [];
    const dir = path.join(app.getPath('userData'), 'permissions');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'allowlist-export.json');
    fs.writeFileSync(file, JSON.stringify(LieBiao, null, 2), 'utf8');
    audit?.log('allowlist.export', { count: LieBiao.length });
    return { ok: true, path: file, count: LieBiao.length };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── dsh-app:// 自定义协议（零对外端口） ──
// 仅在 Electron 内部注册，不对外暴露端口
try {
  app.setAsDefaultProtocolClient('dsh-app');
} catch {
  /* noop */
}

// ── 导入 openclaw.json 供应商配置 ──
chuliIpc('warmy:daoRuopenclaw', () => {
  try {
    const ocLujing = path.join(app.getPath('userData'), '..', 'openclaw.json');
    if (!fs.existsSync(ocLujing)) return { ok: false, error: 'openclaw.json not found' };
    const j = JSON.parse(fs.readFileSync(ocLujing, 'utf8'));
    const gongYingShangJi = Object.entries(j.models?.providers || {}).map(([id, pv]) => {
      const p = pv as { baseURL?: string; baseUrl?: string; apiKey?: string; api?: string; models?: Array<{ name?: string; id?: string }> };
      return {
        id, label: id, protocol: 'openai-compatible' as const,
        baseURL: p.baseURL || p.baseUrl || '',
        apiKey: p.apiKey || p.api || '',
        defaultModel: (p.models?.[0]?.name || p.models?.[0]?.id) || '',
        models: (p.models || []).map((m) => m.name || m.id).filter(Boolean) as string[],
      };
    });
    if (settingsStore) {
      const cur = settingsStore.load() as unknown as Record<string, unknown>;
      settingsStore.save({ ...cur, importedProviders: gongYingShangJi } as never);
    }
    audit?.log('providers.import', { count: gongYingShangJi.length });
    return { ok: true, providers: gongYingShangJi };
  } catch (e) {
    return { ok: false, error: xiJingCuoWu(e) };
  }
});

chuliIpc('warmy:teShuMoXingJiSheZhi', (_e, cfg: { asr?: { provider: string }; embedding?: { provider: string }; summary?: { provider: string; model?: string }; organizer?: { provider: string; model?: string }; fenLeiChain?: string[]; fenLeiDisabled?: string[] }) => {
  try {
    if (settingsStore) {
      const cur = settingsStore.load() as unknown as Record<string, unknown>;
      settingsStore.save({ ...cur, specialModels: cfg } as never);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:teShuMoXingJiQu', () => {
  try {
    const s = settingsStore?.load() as unknown as Record<string, unknown>;
    return { ok: true, specialModels: s?.specialModels || {} };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

chuliIpc('warmy:asrollama', async (_e, payload: { audioBase64: string; model?: string }) => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: payload.model || 'dimavz/whisper-tiny', tiShiCi: 'Transcribe audio:', stream: false, options: { audio: payload.audioBase64 } }),
    });
    if (!res.ok) return { ok: false, error: 'http ' + res.status };
    const data = (await res.json()) as { xiangYingTi?: string };
    return { ok: true, text: data.xiangYingTi || '' };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});

// ── 加入请求 / 黑名单 ──
const joinRequests: Array<{ id: string; ming: string; kind: string; target: string; targetType: string; ts: number; expireAt: number }> = [];
const blacklist: Array<{ id: string; ming: string; blockedAt: number; target: string }> = [];
chuliIpc('warmy:jiaRuQingQiu', (_e, payload: { ming: string; kind: string; target: string; targetType: string }) => {
  try {
    const id = "jr" + Date.now();
    const ts = Date.now();
    joinRequests.push({ id, ming: payload.ming, kind: payload.kind, target: payload.target, targetType: payload.targetType, ts, expireAt: ts + 30 * 24 * 3600_000 });
    audit?.log('join.request', { id, ming: payload.ming, target: payload.target });
    return { ok: true, id };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:jiaRuPending', () => {
  try {
    const now = Date.now();
    const valid = joinRequests.filter((r) => r.expireAt > now);
    return { ok: true, items: valid, count: valid.length };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:jiaRuHuiYing', (_e, payload: { id: string; action: 'agree' | 'reject' | 'block' }) => {
  try {
    const suoYin = joinRequests.findIndex((r) => r.id === payload.id);
    if (suoYin < 0) return { ok: false };
    const Qiu = joinRequests[suoYin];
    if (!Qiu) return { ok: false };
    if (payload.action === 'block') {
      blacklist.push({ id: Qiu.id, ming: Qiu.ming, blockedAt: Date.now(), target: Qiu.target });
    }
    joinRequests.splice(suoYin, 1);
    audit?.log('join.respond', { id: Qiu.id, action: payload.action });
    return { ok: true, shengYu: joinRequests.filter((r) => r.expireAt > Date.now()).length };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
chuliIpc('warmy:heiMingDanLieBiao', () => anQuanChuLi(() => ({ ok: true, items: blacklist }), { ok: true, items: [] }))
chuliIpc('warmy:heiMingDanYiChu', (_e, id: string) => {
  try {
    const i = blacklist.findIndex((b) => b.id === id);
    if (i >= 0) blacklist.splice(i, 1);
    return { ok: true };
  } catch (e) { return { ok: false, error: xiJingCuoWu(e) }; }
});
