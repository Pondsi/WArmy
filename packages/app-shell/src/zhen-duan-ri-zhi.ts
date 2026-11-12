/**
 * 诊断日志（**可对外**）—— 与内部审计 `audit.jsonl` 完全分离的第二本账。
 *
 * 为什么需要它：内部审计的 `detail` 里有用户路径、会话内容、工具参数、报错原文，
 * **绝不能发给别人**；但用户报障 / 我们自检时又需要一份「拿出去也不泄密、 yet 能定位问题」的日志。
 * 以前没有这种东西，报障只能靠口述或截全量审计（泄密风险）。
 *
 * 隐私最大的做法不是「事后过滤」，而是**构造即脱敏**：
 *   · 本模块**只接受白名单结构化字段**：枚举事件码 / 枚举模块 / 枚举错误类别 / 数字 / 布尔 /
 *     脱敏后的栈帧（只剩源码文件名+行号）。**没有任何自由文本字段** ——
 *     报错原文、用户路径、会话内容、模型名、URL 一律进不来，从根上杜绝漏过滤。
 *   · 栈帧只留 basename+行号（`electron-main.ts:1234`），绝对路径在写入前就被剥掉。
 *   · 导出时**再整体脱敏一次**（纵深防御）：即使将来有人误加了字段，导出兜底仍会抹掉
 *     路径 / URL / IP / 邮箱 / 长十六进制（钥匙、设备 ID）/ 长 base64。
 *   · **绝不上传**：没有任何网络发送路径；对外只能由用户显式「导出」成一个本地文件。
 *   · 不记设备指纹：`boot` 是**每次启动随机**的 8 位十六进制，不落盘复用、不由 deviceId 派生，
 *     仅用于把同一次启动里的事件串成一条链。
 *   · 有界环形：超过上限只保留最新一半，旧数据不长期滞留；用户可一键清空 / 关闭。
 *
 * 定位问题的能力靠「稳定事件码 + 模块 + 错误类别/码 + 耗时/次数/状态码 + 栈帧 + 启动链」，
 * 这些足以回答「哪个子系统、哪一类错、在哪一行、重试了几次、多久」，而不需要任何用户内容。
 * 本地排障仍可用全量 `audit.jsonl`（按 ts 与本账对照），本账是它的**安全子集**。
 *
 * 纯函数 + 注入式探针：核心不 import electron / 不做网络，门禁可直接 import 编译产物跑真值表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fenLeiCuoWu } from './cuowu-fenlei.js';

/** schema 版本：导出 manifest 会带上，便于将来演进时识别旧包 */
export const ZHEN_DUAN_SCHEMA = 1;

/** 严重度（枚举，非自由文本） */
export type YanZhong = 'info' | 'warn' | 'error' | 'fatal';

/** 模块（枚举）：只允许这些子系统名，避免把任意字符串当模块塞进来 */
export const MO_KUAI = [
  'boot', 'main', 'renderer', 'ipc', 'memory', 'model', 'net', 'update',
  'settings', 'secure', 'enc', 'tool', 'sync', 'selfcheck', 'diag',
] as const;
export type MoKuai = typeof MO_KUAI[number];

/**
 * 稳定事件码登记表。**改码就是改对外契约**：报障模板 / 门禁 / 文档都引用这些码，
 * 只增不改不删（废弃的码保留注释），保证历史日志永远可读。
 */
export const SHI_JIAN_MA = [
  'boot.start', 'boot.ready', 'boot.fail',
  'selfcheck.start', 'selfcheck.pass', 'selfcheck.fail', 'selfcheck.done',
  'ipc.dead', 'ipc.timeout',
  'memory.spawn.fail', 'memory.ipc.fail',
  'model.call.fail', 'model.rate-limit', 'model.context-overflow', 'model.unavailable',
  'update.check.fail', 'update.delta.fail', 'update.install.fail',
  'net.bind.fail',
  'settings.load.fail', 'settings.save.fail',
  'secure.unavailable', 'enc.module.missing', 'renderer.bridge.missing',
  'crash.uncaught', 'crash.unhandled',
  'tool.boundary', 'tool.exec.fail',
  'diag.export', 'diag.clear', 'diag.disabled',
] as const;
export type ShiJianMa = typeof SHI_JIAN_MA[number];

/** 一条诊断记录：**全部字段都在白名单内**，无自由文本 */
export interface ZhenDuanTiaoMu {
  v: number;
  /** 本次启动内单调序号（串链用） */
  seq: number;
  /** 距启动的毫秒（单调，不受系统改时间影响） */
  t: number;
  /** 粗粒度墙钟（到秒）：便于和用户口述时间 / 全量审计对照；不含时区偏移细节 */
  ts: string;
  /** 每次启动随机 id（非设备指纹） */
  boot: string;
  code: ShiJianMa;
  ji: YanZhong;
  mo: MoKuai;
  /** 契约错误类别（枚举，来自 cuowu-fenlei） */
  lei?: string;
  /** 契约错误码（枚举） */
  dai?: string;
  /** 耗时 ms */
  miao?: number;
  /** 次数 / 重试数 */
  ci?: number;
  /** HTTP 状态码 */
  zhuang?: number;
  /** 只允许 number / boolean 的指标（字节、行数、档位…），杜绝字符串夹带 */
  zhi?: Record<string, number | boolean>;
  /** 脱敏栈帧：仅 `basename:line`，最多 8 帧 */
  zhan?: string[];
}

/** 运行环境（**不含**主机名 / 用户名 / 完整 OS 版本 / 任何路径） */
export interface YunXingHuanJing {
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  /** 只到族：win32 / darwin / linux */
  osFamily: string;
  /** 只到主版本号 */
  osMajor: string;
  arch: string;
}

/* ───────────────────────── 脱敏（纵深防御兜底） ───────────────────────── */

/**
 * 把一段文本里**可能敏感**的片段抹掉。注意：正常写入路径根本不产生自由文本，
 * 这里只用于栈帧 basename 与「导出整体兜底」。宁可多抹（隐私最大），不可漏抹。
 * 顺序有讲究：先 URL（内含 host/ip/query），再路径，再邮箱，再 IP，再长串钥匙。
 */
export function tuoMin(wen: string): string {
  let s = String(wen ?? '');
  // URL（含 query 里的 key/token）整体抹掉
  s = s.replace(/https?:\/\/\S+/gi, '[url]');
  // UNC 与 Windows 盘符路径（含用户名）
  s = s.replace(/\\\\[^\s"']+/g, '[path]');
  s = s.replace(/\b[A-Za-z]:\\[^\s"']*/g, '[path]');
  // posix 家目录 / 常见绝对路径
  s = s.replace(/(?:^|[\s"'(=])\/(?:home|Users|root|tmp|var|etc|opt|mnt|media|private)\/[^\s"')，。]*/g, '$1[path]');
  // 邮箱（完整 local@domain）
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  // 裸 @域名（无 local part，或 TLD 未知）：@ 后含点的非空白串一律抹掉（隐私最大）
  s = s.replace(/@[^\s@]*\.[^\s@]*/g, '[email]');
  // 裸域名 / 主机名（含 .local / .lan 内网名）
  s = s.replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|cn|io|dev|app|local|lan|internal)(?::\d+)?\b/gi, '[host]');
  // IPv4
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]');
  // IPv6（要求 ≥4 组或含 ::，避免误伤 12:30:45 这类时间）
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){3,}[0-9a-fA-F]{1,4}\b/g, '[ip]');
  s = s.replace(/::1\b/g, '[ip]');
  // 长十六进制（钥匙 / 哈希 / 设备 ID 片段）
  s = s.replace(/\b[0-9a-fA-F]{32,}\b/g, '[hex]');
  // 长大写串（现役设备 ID 形态）
  s = s.replace(/\b[A-Z0-9]{40,}\b/g, '[id]');
  // 长 base64
  s = s.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[b64]');
  return s;
}

/** 栈 → 仅 `basename:line`，剥掉一切路径与报错原文，最多 8 帧 */
export function zhanZhenTuoMin(stack: unknown): string[] {
  const s = String(stack ?? '');
  const out: string[] = [];
  for (const line of s.split('\n')) {
    const m = /(?:at\s+)?(?:.*?\s+\()?([^()\\\s/]+?\.(?:ts|js|mjs|cjs)):(\d+):\d+\)?/.exec(line);
    if (m && m[1]) {
      const base = tuoMin(String(m[1]).split(/[\\/]/).pop() || '');
      out.push(`${base}:${m[2]}`);
    }
    if (out.length >= 8) break;
  }
  return out;
}

/** 指标白名单清洗：只留 number / boolean；有限数字才要 */
function zhiQingXi(zhi: unknown): Record<string, number | boolean> | undefined {
  if (!zhi || typeof zhi !== 'object') return undefined;
  const out: Record<string, number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(zhi as Record<string, unknown>)) {
    if (n >= 12) break;
    const key = tuoMin(String(k)).slice(0, 24);
    if (typeof v === 'boolean') { out[key] = v; n++; }
    else if (typeof v === 'number' && Number.isFinite(v)) { out[key] = Math.round(v * 100) / 100; n++; }
    // 字符串 / 对象 / 数组一律丢弃（杜绝夹带）
  }
  return n ? out : undefined;
}

/* ───────────────────────── 自检（注入式探针） ───────────────────────── */

export interface ZiJianXiang {
  /** 稳定检查码 */
  code: string;
  ok: boolean;
  /** 只允许数字/布尔的度量 */
  zhi?: Record<string, number | boolean>;
}
export type ZiJianTanZhen = () => ZiJianXiang | Promise<ZiJianXiang>;

/** 跑一组探针；单个探针抛错 = 该项 fail（不让自检自己崩掉） */
export async function yunXingZiJian(tanZhen: Record<string, ZiJianTanZhen>): Promise<ZiJianXiang[]> {
  const out: ZiJianXiang[] = [];
  for (const [code, fn] of Object.entries(tanZhen)) {
    try {
      const r = await fn();
      out.push({ code, ok: !!r.ok, ...(r.zhi ? { zhi: zhiQingXi(r.zhi) } : {}) });
    } catch {
      out.push({ code, ok: false });
    }
  }
  return out;
}


/* ───────────────── 审计 op → 脱敏诊断事件（单一 choke point 的纯映射） ───────────────── */

/** 只取有限数字 */
function youXianShu(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** op → [事件码, 严重度, 模块]。只增不改不删（对外契约）。 */
const YING_SHE: Record<string, [ShiJianMa, YanZhong, MoKuai]> = {
  'chat.error-classified': ['model.call.fail', 'error', 'model'],
  'special-model.failed': ['model.call.fail', 'error', 'model'],
  'capability-chain.failed': ['model.call.fail', 'error', 'model'],
  'chat.refusal-retry-failed': ['model.call.fail', 'warn', 'model'],
  'chat.xiao-di-fail': ['model.call.fail', 'warn', 'model'],
  'chat.xiao-di-retry-fail': ['model.call.fail', 'warn', 'model'],
  'chat.pre-recall-failed': ['memory.ipc.fail', 'warn', 'memory'],
  'special-model.unavailable': ['model.unavailable', 'warn', 'model'],
  'chat.tools.unavailable': ['model.unavailable', 'warn', 'model'],
  'models.fetch-failed': ['model.unavailable', 'warn', 'model'],
  'chat.context-overflow-retry': ['model.context-overflow', 'warn', 'model'],
  'chat.stream-timeout': ['model.call.fail', 'warn', 'model'],
  'chat.stream-fallback-timeout': ['model.call.fail', 'warn', 'model'],
  'chat.tools.stalled': ['model.call.fail', 'warn', 'model'],
  'chat.tools.hard-cap': ['model.call.fail', 'warn', 'model'],
  'update.install-open-failed': ['update.install.fail', 'error', 'update'],
  'export.schedule.error': ['settings.save.fail', 'warn', 'settings'],
  'net.enable.failed': ['net.bind.fail', 'error', 'net'],
  'net.discovery-start-failed': ['net.bind.fail', 'warn', 'net'],
  'net.discovery-publish-failed': ['net.bind.fail', 'warn', 'net'],
  'net.discoverable-on-failed': ['net.bind.fail', 'warn', 'net'],
  'cred.social-decrypt-failed': ['secure.unavailable', 'error', 'secure'],
  'chat.protected-path-denied': ['tool.boundary', 'warn', 'tool'],
  'rc.exec-denied': ['tool.boundary', 'warn', 'tool'],
  'chat.tool-denied-locked': ['tool.boundary', 'warn', 'tool'],
  'chat.write-overwrite-blocked': ['tool.boundary', 'warn', 'tool'],
  'local.index.init-failed': ['memory.ipc.fail', 'warn', 'memory'],
  'chat.archive-core-fail': ['memory.ipc.fail', 'warn', 'memory'],
  'chat.auto-archive-fail': ['memory.ipc.fail', 'warn', 'memory'],
  'token.recalc-fail': ['model.context-overflow', 'warn', 'model'],
  'plan.auto-continue-fail': ['model.call.fail', 'warn', 'model'],
  'shejiao.queue-task-failed': ['ipc.dead', 'warn', 'ipc'],
  'shejiao.in-handle-failed': ['ipc.dead', 'warn', 'ipc'],
};

/**
 * 把一条内部审计 op+detail 映射成**脱敏**诊断字段；不在表里返回 null（不写）。
 * 只提取：枚举类别/码（经 fenLeiCuoWu）、有限数字、布尔、栈帧。**绝不复制自由文本。**
 */
export function yingSheShenJi(op: string, detail: unknown): {
  code: ShiJianMa; ji: YanZhong; mo: MoKuai;
  lei?: string; dai?: string; miao?: number; ci?: number; zhuang?: number;
  zhi?: Record<string, number | boolean>; stack?: unknown;
} | null {
  const d = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
  let hit = YING_SHE[op];
  if (!hit) {
    if (/^memory\./.test(op) && /fail|dead|exit|timeout/.test(op)) hit = ['memory.ipc.fail', 'error', 'memory'];
    else if (/^update\./.test(op) && /fail|error/.test(op)) hit = [/delta/.test(op) ? 'update.delta.fail' : /install/.test(op) ? 'update.install.fail' : 'update.check.fail', 'error', 'update'];
    else if (/^settings\./.test(op) && /fail|error/.test(op)) hit = ['settings.load.fail', 'error', 'settings'];
    else if (/^ipc\./.test(op) && /dead|closed|timeout/.test(op)) hit = ['ipc.dead', 'error', 'ipc'];
  }
  if (!hit) return null;
  const [code, ji, mo] = hit;
  const out: { code: ShiJianMa; ji: YanZhong; mo: MoKuai; lei?: string; dai?: string; miao?: number; ci?: number; zhuang?: number; zhi?: Record<string, number | boolean>; stack?: unknown } = { code, ji, mo };
  const err = d.error ?? d.cuoWu ?? d.reason ?? d.message;
  if (err != null) {
    const fl = fenLeiCuoWu(err);
    out.lei = fl.category; out.dai = fl.code;
  }
  const miao = youXianShu(d.ms ?? d.shiJiMs ?? d.haoShi ?? d.elapsedMs);
  if (miao != null) out.miao = miao;
  const ci = youXianShu(d.ci ?? d.n ?? d.round ?? d.attempt);
  if (ci != null) out.ci = ci;
  const zhuang = youXianShu(d.status ?? d.zhuang ?? d.statusCode);
  if (zhuang != null) out.zhuang = zhuang;
  const zhi: Record<string, number | boolean> = {};
  for (const k of ['bytes', 'zi', 'hang', 'lines', 'kb', 'freeMb', 'count', 'len', 'lv']) {
    const v = youXianShu(d[k]);
    if (v != null) zhi[k] = v;
  }
  if (typeof d.ok === 'boolean') zhi.ok = d.ok;
  if (Object.keys(zhi).length) out.zhi = zhi;
  const stack = d.stack ?? (err && typeof err === 'object' ? (err as { stack?: unknown }).stack : undefined);
  if (stack) out.stack = stack;
  return out;
}

/* ───────────────────────── 落盘（有界环形） ───────────────────────── */

export interface ZhenDuanPeiZhi {
  userData: string;
  huanJing: YunXingHuanJing;
  /** 关闭后只记一条 diag.disabled，不再写任何事件 */
  qiYong?: boolean;
  /** 行数上限（超过保留最新一半） */
  zuiDaHang?: number;
  /** 字节上限 */
  zuiDaZiJie?: number;
}

export class ZhenDuanRiZhi {
  private file: string;
  private seq = 0;
  private boot: string;
  private qiYong: boolean;
  private zuiDaHang: number;
  private zuiDaZiJie: number;
  private xieCi = 0;
  readonly huanJing: YunXingHuanJing;
  readonly kaiShi = Date.now();

  constructor(p: ZhenDuanPeiZhi) {
    this.huanJing = p.huanJing;
    this.qiYong = p.qiYong !== false;
    this.zuiDaHang = p.zuiDaHang ?? 2000;
    this.zuiDaZiJie = p.zuiDaZiJie ?? 512 * 1024;
    // 每次启动随机，不复用、不派生自设备 ID
    this.boot = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    const dir = path.join(p.userData, 'diag');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 写不进就算了，绝不影响业务 */ }
    this.file = path.join(dir, 'diag.jsonl');
  }

  get enabled(): boolean { return this.qiYong; }
  set enabled(v: boolean) { this.qiYong = !!v; }

  /** 记一条。**只接受白名单字段**；未知 code / 模块直接拒绝（返回 false），不写脏数据 */
  jiLu(code: ShiJianMa, ji: YanZhong, mo: MoKuai, fu?: {
    lei?: string; dai?: string; miao?: number; ci?: number; zhuang?: number;
    zhi?: Record<string, number | boolean>; stack?: unknown;
  }): boolean {
    if (!this.qiYong) return false;
    if (!(SHI_JIAN_MA as readonly string[]).includes(code)) return false;
    if (!(MO_KUAI as readonly string[]).includes(mo)) return false;
    const tiao: ZhenDuanTiaoMu = {
      v: ZHEN_DUAN_SCHEMA,
      seq: ++this.seq,
      t: Date.now() - this.kaiShi,
      ts: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      boot: this.boot,
      code, ji, mo,
    };
    if (fu?.lei) tiao.lei = tuoMin(String(fu.lei)).slice(0, 40);
    if (fu?.dai) tiao.dai = tuoMin(String(fu.dai)).slice(0, 40);
    if (typeof fu?.miao === 'number' && Number.isFinite(fu.miao)) tiao.miao = Math.round(fu.miao);
    if (typeof fu?.ci === 'number' && Number.isFinite(fu.ci)) tiao.ci = Math.round(fu.ci);
    if (typeof fu?.zhuang === 'number' && Number.isFinite(fu.zhuang)) tiao.zhuang = Math.round(fu.zhuang);
    const zhi = zhiQingXi(fu?.zhi);
    if (zhi) tiao.zhi = zhi;
    if (fu?.stack) {
      const zhan = zhanZhenTuoMin(fu.stack);
      if (zhan.length) tiao.zhan = zhan;
    }
    this.xie(tiao);
    return true;
  }

  private xie(tiao: ZhenDuanTiaoMu): void {
    const hang = JSON.stringify(tiao) + '\n';
    try {
      fs.appendFileSync(this.file, hang, 'utf8');
    } catch {
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, hang, 'utf8'); }
      catch { /* 磁盘/权限：放弃，绝不影响业务 */ }
    }
    // 每 64 次写检查一次上限，避免每条都 stat
    if (++this.xieCi % 64 === 0) this.lunHuan();
  }

  /** 有界环形：超行数或超字节 ⇒ 只保留最新一半 */
  lunHuan(): void {
    try {
      const st = fs.statSync(this.file);
      const hang = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      if (hang.length <= this.zuiDaHang && st.size <= this.zuiDaZiJie) return;
      const baoLiu = hang.slice(-Math.max(1, Math.floor(this.zuiDaHang / 2)));
      fs.writeFileSync(this.file, baoLiu.join('\n') + '\n', 'utf8');
    } catch { /* 旋转失败不影响写入 */ }
  }

  read(limit = 200): ZhenDuanTiaoMu[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-limit)
        .map((l) => { try { return JSON.parse(l) as ZhenDuanTiaoMu; } catch { return null; } })
        .filter((x): x is ZhenDuanTiaoMu => !!x);
    } catch { return []; }
  }

  clear(): void {
    try { fs.writeFileSync(this.file, '', 'utf8'); this.seq = 0; } catch { /* ignore */ }
  }

  /**
   * 导出包：**再整体脱敏一次**（纵深防御）+ manifest + 隐私声明。
   * 返回纯数据；落盘 / 保存对话框由调用方决定，本模块不碰网络。
   */
  daoChu(): { manifest: Record<string, unknown>; entries: ZhenDuanTiaoMu[] } {
    const entries = this.read(this.zuiDaHang).map((t) => JSON.parse(tuoMin(JSON.stringify(t))) as ZhenDuanTiaoMu);
    return {
      manifest: {
        schema: ZHEN_DUAN_SCHEMA,
        kind: 'warmy-diagnostic-log',
        generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        boot: this.boot,
        entryCount: entries.length,
        huanJing: this.huanJing,
        privacy: '本文件不含用户路径、用户名、主机名、设备ID、会话内容、模型提示/回复、密钥、URL、IP。'
          + '仅含枚举事件码/模块/错误类别、数字指标、脱敏栈帧(文件名:行号)与每次启动随机id。绝不自动上传。',
        includes: ['枚举事件码', '模块', '错误类别/码', '耗时/次数/状态码', '数字指标', '脱敏栈帧', '启动链id', '运行环境(族/主版本)'],
        excludes: ['用户路径', '用户名/主机名', '设备ID', '会话内容', '模型提示/回复', '密钥/token', 'URL/IP/邮箱', '自由文本报错原文'],
      },
      entries,
    };
  }
}