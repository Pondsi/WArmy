/**
 * xin-tiao.ts —— **全应用唯一的计时源**（第 40 轮）
 *
 * 为什么要单独做这个模块（真机事故驱动）：
 *   1. 原来"计时"散在四五个互不相干的定时器里：定时任务巡检自己 `setInterval(20000)`、
 *      租约 `sweep()` 注释写着"集成方可在心跳里调"**但根本没人调**、限流滑窗只有发请求时才清、
 *      工具循环看门狗每个循环各起一个。⇒ 进程一关全忘，重启后**错过到点的任务不补、
 *      `repeat` 次数不生效**，过期租约永远躺在内存里。
 *   2. 用户口径很明确：**"多久之后"、"等 N 秒"、模型估的时长，都要用心跳来计时**；
 *      心跳管不到（程序被关了）就必须落到**系统层**协助完成。
 *   3. 门禁要能证：埋在两万多行的主进程里只能 grep 字符串，grep 证明不了"补跑/合并/重入/退避"。
 *      所以内核放在这个**零依赖**模块里，注入时钟 + 注入定时器，直接 import 编译产物跑断言。
 *
 * 口径（定稿，改代码可以，改口径要重新对齐）：
 *   - **一个 tick 驱动一切**：基础 tick + 一个"最早到期闹钟"，闹钟把间隔夹到真正的下一件事，
 *     所以空闲成本低（默认 2 秒一跳），而 `wait_seconds` 这类等待能准到约 1 秒内。
 *   - **错过要诚实，不能刷屏**：一次 tick 内一个任务**最多跑一次**（`queGuoCiShu` 如实记几次）；
 *     迟到超过 `chiXianMs` 判**跳过**并留痕，不硬补一堆旧 tick（node-cron 的 grace 口径）。
 *   - **重入保护**：上一轮还没跑完 ⇒ 本轮跳过并记 `skip-busy`，绝不并发跑同一个任务。
 *   - **错误隔离 + 退避**：单个任务抛错不影响别的任务；连续失败按 2 的幂退避（封顶 32 个周期），
 *     成功一次清零 —— 坏掉的任务**不会被丢掉**，只是跑得慢一点，且账本上看得见为什么。
 *   - **时钟不可信就如实说**：用单调钟对比墙上钟检测**时钟跳变/休眠唤醒**（`clock-jump` / `long-gap`），
 *     跳变时不假装一切正常；到期判据仍按墙上钟（epoch）算，所以"睡前定 5 分钟、醒来已过期"会补跑。
 *   - **落盘 = 跨重启的记账**：任务下次到期时刻与一次性到期都写盘；重启后过期的**补跑一次**并告知迟到多久。
 *   - **脱离程序的到期交给系统**：`osShouShi` 钩子（主进程用 schtasks 实现，execFile 数组参数、不过 shell）
 *     在到点时留一条痕，本机下次启动（或第二实例唤起既有实例）时 ingest ⇒ 到期不会因"程序没开着"而静默消失。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 一次 tick 递给任务的上下文 */
export type XinTiaoCi = {
  now: number;
  /** 本次相对原定到期迟了多久（毫秒） */
  tuoYanMs: number;
  /** 这次执行合并掉了几次错过（≥1） */
  queGuoCiShu: number;
  /** 迟到超过宽限被丢弃的错过次数（累计） */
  tiaoGuoChi: number;
  /** 是不是"重启后补的"那一次 */
  buPao: boolean;
};

export type XinTiaoRenWu = {
  /** 稳定 id：审计、界面、门禁都靠它 */
  id: string;
  /** 界面显示名（中文） */
  ming: string;
  /** 周期毫秒；≤0 = 不自动跑（只能手动 `paoYiCi`） */
  meiMs: number;
  /** 迟到多少毫秒以内还算"补跑"；超过就判跳过。默认 `max(2×meiMs, 60s)` */
  chiXianMs?: number;
  /**
   * **单次执行超时**（毫秒，0 = 不限）。第 40 轮调研借鉴：LangGraph/PydanticAI 给每一步设超时，
   * Temporal 把"卡在活动里"当一等公民处理。我们原来的重入保护只写"上一轮没跑完就跳过"，
   * 但**如果那个任务永远不返回**（网络挂死、第三方 SDK 不回调），占用就永不释放 ⇒
   * 这个任务从那一刻起**每轮都被判忙、再也不跑**，而账本上只会看到"正忙"两个字，没人知道为什么。
   * 所以超时不只是记一条事件：它**释放占用、按失败退避**，晚到的完成会被忽略（不许再把下一次结掉）。
   */
  chaoShiMs?: number;
  /** 注册即跑一次（不等周期） */
  kanPao?: boolean;
  run: (ci: XinTiaoCi) => void | Promise<void>;
};

/** 一次性到期（"20 分钟后提醒我"）：落盘，可跨重启补跑 */
export type DaoJiJiLu = {
  id: string;
  yaoAt: number;
  beiZhu: string;
  miaoShu: number;
  /** 随附上下文（例如 sessionId / prompt），触发时原样带回 */
  chang: Record<string, unknown>;
  yiFa: boolean;
  /** 触发来源：xin-tiao=本机心跳；buPao=重启补跑；os=系统留痕 */
  laiYuan: string;
  huoShiAt: number;
  /** 是否已经向系统挂了离线保底 */
  osGui?: boolean;
};

export type XinTiaoShiJian = {
  at: number;
  type: string;
  id: string;
  xiangxi: Record<string, unknown>;
};

export type OsShouShiGou = {
  /**
   * 挂一个系统层保底：到点必须留痕（哪怕本程序没开着）。
   * 返回 `false` = **没挂**（开关关着、命令太长等原因）⇒ 内核不许把它记成"已挂保底"，
   * 因为界面会把这个数字显示给用户看。
   */
  chuangJian(x: { id: string; yaoAt: number; beiZhu: string }): Promise<void | boolean> | void | boolean;
  shanChu(id: string): Promise<void> | void;
};

type RenZhang = {
  xiaCiAt: number;
  shangCiAt: number;
  lianXuShiBai: number;
  ciShu: number;
  zuiHouMs: number;
  tiaoGuoChi: number;
  queGuoZong: number;
  /** 超时被掐掉的次数（挂死不走完的任务） */
  chaoShuCi: number;
  /**
   * **上一次为什么没跑**（借鉴 OpenClaw：它的 `heartbeat last` 会直接打印 skip reason）。
   * "心跳没响"这类问题必须有地方能当场回答，否则用户只能猜、我们也只能翻日志。
   */
  lastSkip: { yuanYin: string; at: number; xiangxi: Record<string, unknown> } | null;
};

type DengDaiR = { id: string; yaoAt: number; miao: number; resolve: (v: Record<string, unknown>) => void; quXiao?: () => void };

type Pers = {
  v: 1;
  qiDongAt: number;
  zuiHouNow: number;
  ren: Record<string, RenZhang>;
  daoJi: DaoJiJiLu[];
};

export type XinTiaoGouZi = {
  /** 落盘文件；不传 = 纯内存（测试可用） */
  wenjian?: string;
  /** 基础 tick，默认 2000ms */
  tiaoduMs?: number;
  now?: () => number;
  /** 单调毫秒（检测时钟跳变用）；默认 `process.hrtime` */
  danDiao?: () => number;
  zaoShiZhong?: (ms: number, fn: () => void) => unknown;
  qingShiZhong?: (h: unknown) => void;
  onShiJian?: (e: XinTiaoShiJian) => void;
  /** 脱离程序时的系统层保底（不传 = 只用本机心跳） */
  osShouShi?: OsShouShiGou;
  /** 一次性到期多久以上才值得挂系统保底，默认 60s */
  osZhiShangMs?: number;
};

const MO_REN_TIAODU = 2000;
const MO_REN_OS_ZHI_SHANG = 60_000;
const BAO_CHI_LIU = 200;

function danDiaoMoRen(): number {
  try { return Number(process.hrtime.bigint() / 1000000n); } catch { return Date.now(); }
}

export class XinTiao {
  private readonly gou: XinTiaoGouZi;
  private readonly tickMs: number;
  private readonly renWu = new Map<string, XinTiaoRenWu & { zhang: RenZhang }>();
  private readonly zaiTuan = new Map<string, { an: Record<string, unknown>; kai: number }>();
  private readonly zaiDeng: DengDaiR[] = [];
  private daoJi: DaoJiJiLu[] = [];
  private readonly luPan: XinTiaoShiJian[] = [];
  private dingShi: unknown = null;
  private zhong: unknown = null;
  private zhongAt = 0;
  private yiQiDong = false;
  private wu = false;
  private lastFlush = 0;
  private lastNow = 0;
  private zuiHouTickDanDiao = 0;
  private ticks = 0;
  private readonly qiDongAt: number;
  private readonly kaiShiDanDiao: number;

  constructor(gou: XinTiaoGouZi = {}) {
    this.gou = gou;
    this.tickMs = Math.max(50, Number(gou.tiaoduMs) || MO_REN_TIAODU);
    this.qiDongAt = this.now();
    this.kaiShiDanDiao = this.danDiao();
    this.duPan();
  }

  now(): number { return this.gou.now ? this.gou.now() : Date.now(); }
  private danDiao(): number { return this.gou.danDiao ? this.gou.danDiao() : danDiaoMoRen(); }

  /**
   * 落盘读回：只在**第一次构造**时读。
   * 读回来的账本用来回答"上次心跳是什么时候活着停的"，并驱动重启补跑。
   */
  private duPan(): void {
    const f = this.gou.wenjian;
    if (!f) return;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as Pers;
      if (!j || typeof j !== 'object') return;
      this.lastNow = Number(j.zuiHouNow) || 0;
      if (j.ren && typeof j.ren === 'object') this.panDuRen = j.ren;
      if (Array.isArray(j.daoJi)) this.daoJi = j.daoJi.filter((x) => x && Number.isFinite(x.yaoAt));
    } catch { /* 首次没有 / 写坏了都不该挡住启动 */ }
  }

  /** 读盘时暂存的旧账本（zhuCe 时并回） */
  private panDuRen: Record<string, RenZhang> = {};

  private chiJiuHua(): void {
    const f = this.gou.wenjian;
    if (!f) return;
    this.wu = false;
    this.lastFlush = this.now();
    try {
      const j: Pers = {
        v: 1, qiDongAt: this.qiDongAt, zuiHouNow: this.lastNow || this.now(),
        ren: Object.fromEntries([...this.renWu.entries()].map(([k, v]) => [k, v.zhang])),
        daoJi: this.daoJi.slice(-BAO_CHI_LIU),
      };
      const mu = path.dirname(f);
      try { fs.mkdirSync(mu, { recursive: true }); } catch { /* 已存在 */ }
      const lin = f + '.tmp';
      fs.writeFileSync(lin, JSON.stringify(j, null, 1));
      fs.renameSync(lin, f);
    } catch { /* 落盘失败不影响本次心跳，下次再试 */ }
  }

  /** 标脏：真正写盘推迟到 tick 里做（最多每秒一次），避免任务多时反复写文件 */
  private biaoZang(): void { this.wu = true; }

  private shiJian(type: string, id: string, xiangxi: Record<string, unknown> = {}): void {
    const e: XinTiaoShiJian = { at: this.now(), type, id, xiangxi };
    this.luPan.push(e);
    if (this.luPan.length > 400) this.luPan.splice(0, this.luPan.length - 400);
    try { this.gou.onShiJian?.(e); } catch { /* 观察口不能挡住心跳 */ }
  }

  /** 注册周期任务（同 id 覆盖 run，**账本保留**：改实现不该把"已经欠了几次"洗白） */
  zhuCe(ren: XinTiaoRenWu): void {
    const jiu = this.renWu.get(ren.id);
    const zhang: RenZhang = {
      xiaCiAt: 0, shangCiAt: 0, lianXuShiBai: 0, ciShu: 0, zuiHouMs: 0, tiaoGuoChi: 0, queGuoZong: 0,
      chaoShuCi: 0, lastSkip: null,
      ...((jiu && jiu.zhang) || this.panDuRen[ren.id] || {}),
    };
    /** 老账本（升级前落的盘）没有这几个字段 ⇒ 补齐，不许让界面显示 undefined 或让判据 NaN */
    zhang.chaoShuCi = Math.max(0, Number(zhang.chaoShuCi) || 0);
    if (!zhang.lastSkip) zhang.lastSkip = null;
    if (!Number.isFinite(zhang.xiaCiAt) || zhang.xiaCiAt === 0) zhang.xiaCiAt = this.now() + (ren.meiMs > 0 ? ren.meiMs : 0);
    /**
     * `kanPao` 的任务**每次进程启动都先跑一次**（新任务与"重启后恢复的老账本"都算）：
     * 探针这类"界面一打开就该有数"的东西，如果只按上次落盘的 xiaCiAt 排队，
     * 重启后的头几十秒面板上就是空数（真机 r40-live-⑩b 就是这个形态）。
     */
    if (ren.kanPao) zhang.xiaCiAt = Math.min(zhang.xiaCiAt, this.now());
    if (!Number.isFinite(zhang.xiaCiAt)) zhang.xiaCiAt = this.now() + Math.max(1000, ren.meiMs);
    const it = { ...ren, zhang } as XinTiaoRenWu & { zhang: RenZhang };
    it.chiXianMs = Number(ren.chiXianMs) > 0 ? Number(ren.chiXianMs) : Math.max(2 * Math.max(ren.meiMs, 1000), 60_000);
    this.renWu.set(ren.id, it);
    this.biaoZang();
    if (ren.kanPao && this.yiQiDong) void this.paoYiCi(ren.id, 'kanPao');
  }

  xinChuCe(id: string): boolean { return this.renWu.delete(id); }

  qiDong(): void {
    if (this.yiQiDong) return;
    this.yiQiDong = true;
    const n = this.now();
    /**
     * **心跳自己是否停了很久**，用单调钟和墙上钟各测一次：
     * 两者不一致（差 > 5 秒）= 系统改过时间或被挂起过 ⇒ 如实记事件，不假装"一切正常"。
     * 这是补跑判据的前提：分不清"程序卡了 3 分钟"和"用户把时间往前调了 1 小时"，
     * 就会把该补的漏掉、或不该补的乱补。
     */
    const danDiaoGuoQu = this.danDiao() - this.kaiShiDanDiao;
    const qiangGuoQu = n - this.qiDongAt;
    if (this.lastNow > 0) {
      const jianGe = n - this.lastNow;
      if (jianGe < -2000) {
        this.shiJian('clock-back', 'kernel', { tiaoHuiMs: jianGe, qiangGuoQu, danDiaoGuoQu });
      } else if (jianGe > 3 * this.tickMs + 60_000) {
        this.shiJian('long-gap', 'kernel', { jianGeMs: jianGe, qiangGuoQu, danDiaoGuoQu });
      } else if (Math.abs((n - this.qiDongAt) - danDiaoGuoQu) > 5000) {
        this.shiJian('clock-jump', 'kernel', { qiangGuoQu, danDiaoGuoQu, pianChaMs: qiangGuoQu - danDiaoGuoQu });
      }
    }
    this.lastNow = n;
    // 冷启动先走一遍：把"关机期间到过点的事"结清
    this.yiCi(n, true);
    this.jiChuDong();
    this.jiHuaZhong();
  }

  /**
   * 基础 tick 用**自续期单发定时器**而不是 `setInterval`：
   * 内核要能在门禁里被假时钟/假定时器驱动（注入的 `zaoShiZhong` 就是单发语义），
   * 而且自续期天然扛得住"一次 tick 跑得很慢"——不会出现 tick 堆叠。
   */
  private jiChuDong(): void {
    if (!this.yiQiDong) return;
    const fire = () => { this.dingShi = null; this.tiaoCi('interval'); this.jiChuDong(); };
    this.dingShi = this.gou.zaoShiZhong ? this.gou.zaoShiZhong(this.tickMs, fire) : setTimeout(fire, this.tickMs);
  }

  tingZhi(): void {
    this.yiQiDong = false;
    if (this.dingShi != null) {
      this.gou.qingShiZhong ? this.gou.qingShiZhong(this.dingShi) : clearTimeout(this.dingShi as NodeJS.Timeout);
      this.dingShi = null;
    }
    if (this.zhong != null) {
      this.gou.qingShiZhong ? this.gou.qingShiZhong(this.zhong) : clearTimeout(this.zhong as NodeJS.Timeout);
      this.zhong = null;
    }
    this.chiJiuHua();
  }

  tiaoCi(_liYou = 'manual'): void { this.yiCi(this.now(), false); }

  /** 最早到期时刻（周期任务 / 等待 / 一次性到期三张表一起看），没有排事返回 Infinity */
  private zuiZaoDaoQi(): number {
    let m = Number.POSITIVE_INFINITY;
    for (const r of this.renWu.values()) if (r.meiMs > 0 && r.zhang.xiaCiAt < m) m = r.zhang.xiaCiAt;
    for (const d of this.zaiDeng) if (d.yaoAt < m) m = d.yaoAt;
    for (const d of this.daoJi) if (!d.yiFa && d.yaoAt < m) m = d.yaoAt;
    return m;
  }

  /**
   * 闹钟**总是**夹到最早的那件到期事上（不因为"离基础 tick 还远"就省掉）：
   * 准点性直接对用户可见 —— "30 秒后提醒我"晚 2 秒才响，用户就叫错时间了。
   * 基础 tick 退化成空转检查；已排好的闹钟若到期时刻没变就不重排（否则每 tick 清建一次定时器）。
   */
  private jiHuaZhong(): void {
    if (!this.yiQiDong) return;
    const n = this.now();
    const m = this.zuiZaoDaoQi();
    if (this.zhong != null && this.zhongAt === m) return;
    if (this.zhong != null) {
      this.gou.qingShiZhong ? this.gou.qingShiZhong(this.zhong) : clearTimeout(this.zhong as NodeJS.Timeout);
      this.zhong = null;
      this.zhongAt = 0;
    }
    if (!Number.isFinite(m)) return;
    const ms = Math.max(20, Math.min(m - n, 2_147_000_000));
    this.zhongAt = m;
    this.zhong = this.gou.zaoShiZhong ? this.gou.zaoShiZhong(ms, () => { this.zhong = null; this.zhongAt = 0; this.tiaoCi('alarm'); this.jiHuaZhong(); })
      : setTimeout(() => { this.zhong = null; this.zhongAt = 0; this.tiaoCi('alarm'); this.jiHuaZhong(); }, ms);
  }

  private yiCi(n: number, lengQiDong: boolean): void {
    this.ticks += 1;
    /**
     * **自检：心跳自己有没有被卡住**（借鉴 OpenClaw 把"为什么没跑"当成一等可观测项）。
     * 用单调钟量两跳之间的真实间隔：明显超过节奏 ⇒ 主进程事件循环被占住（大 JSON、同步 IO、
     * 崩溃前的长任务）。这时候"任务没跑"不是任务的错，得让审计能这么归因，否则下次排查
     * 会把锅扣在某个周期任务头上。
     */
    const dd = this.danDiao();
    if (this.zuiHouTickDanDiao > 0) {
      const ge = dd - this.zuiHouTickDanDiao;
      if (ge > this.tickMs * 3 + 2000) this.shiJian('tick-starved', 'kernel', { jianGeMs: ge, yinQiMs: this.tickMs });
    }
    this.zuiHouTickDanDiao = dd;
    if (this.lastNow > 0 && n - this.lastNow < -2000) {
      this.shiJian('clock-back', 'kernel', { tiaoHuiMs: n - this.lastNow });
    }
    this.lastNow = n;
    for (const id of [...this.renWu.keys()]) {
      const r = this.renWu.get(id);
      if (!r || r.meiMs <= 0) continue;
      if (r.zhang.xiaCiAt > n) continue;
      this.paoRen(r, n, lengQiDong);
    }
    this.daoJiDao(n, lengQiDong);
    for (const d of this.zaiDeng.filter((x) => x.yaoAt <= n)) this.dengDaiDao(d);
    if (this.wu && n - this.lastFlush >= 1000) this.chiJiuHua();
    else if (this.wu) { /* 攒着，下次 tick 再写 */ }
    this.jiHuaZhong();
  }

  private paoRen(r: XinTiaoRenWu & { zhang: RenZhang }, n: number, buPao: boolean): void {
    const z = r.zhang;
    const tuoYan = Math.max(0, n - z.xiaCiAt);
    if (tuoYan > (r.chiXianMs || 0)) {
      /**
       * 迟到太多 ⇒ **跳过而不是硬补**：任务已经欠了一大堆，一次 tick 全补等于把自己钉死，
       * 而且这些旧 tick 的产出早就没意义了（凌晨 3 点的巡检在中午 12 点补 9 遍只会刷垃圾）。
       * 但必须留痕并让界面看见"跳过了几次"，不能静默吞掉。
       */
      const ys = Math.max(1, Math.floor(tuoYan / Math.max(1, r.meiMs)));
      z.tiaoGuoChi += ys;
      z.xiaCiAt = n + r.meiMs;
      z.lastSkip = { yuanYin: 'late', at: n, xiangxi: { tuoYanMs: tuoYan, ys, chiXianMs: r.chiXianMs } };
      this.shiJian('skip-late', r.id, { tuoYanMs: tuoYan, ys, chiXianMs: r.chiXianMs });
      this.biaoZang();
      return;
    }
    const mang = this.zaiTuan.get(r.id);
    if (mang) {
      z.xiaCiAt = n + Math.min(r.meiMs, 5000);
      z.lastSkip = { yuanYin: 'busy', at: n, xiangxi: { zhanYongMs: Math.max(0, this.danDiao() - mang.kai) } };
      this.shiJian('skip-busy', r.id, { zhanYongMs: Math.max(0, this.danDiao() - mang.kai) });
      return;
    }
    const queGuo = Math.max(1, Math.floor(tuoYan / Math.max(1, r.meiMs)) + 1);
    z.queGuoZong += queGuo - 1;
    const kai = this.danDiao();
    /**
     * 占用带**凭据**：超时先手结算之后，那个任务自己晚到的完成回调不许再来结第二次账
     * （否则它会掐掉"下一次"的占用，两个执行同时在跑 —— 正是重入保护要挡的事）。
     */
    const an: Record<string, unknown> = {};
    this.zaiTuan.set(r.id, { an, kai });
    const ci: XinTiaoCi = { now: n, tuoYanMs: tuoYan, queGuoCiShu: queGuo, tiaoGuoChi: z.tiaoGuoChi, buPao: buPao || z.shangCiAt === 0 };
    // 先按"原定时刻 + 周期×合并次数"对齐推进，避免每次 tick 都把积压一口气摊成新的未来
    z.xiaCiAt = z.xiaCiAt + r.meiMs * queGuo;
    if (z.xiaCiAt <= n) z.xiaCiAt = n + r.meiMs;
    z.shangCiAt = n;
    z.ciShu += 1;
    this.biaoZang();
    try {
      const r2 = r.run(ci);
      if (r2 && typeof (r2 as Promise<void>).then === 'function') {
        /**
         * 异步任务在**完成回调里**收尾（成功/失败都要收，否则 `zaiTuan` 卡住 ⇒ 这个任务以后
         * 每一轮都被判"忙"、再也不跑）。这条路径上不能同步返回成功。
         */
        const chaoShiMs = Math.max(0, Number(r.chaoShiMs) || 0);
        if (chaoShiMs > 0) {
          const fire = () => this.chaoShi(r, an, chaoShiMs);
          if (this.gou.zaoShiZhong) this.gou.zaoShiZhong(chaoShiMs, fire);
          else setTimeout(fire, chaoShiMs);
        }
        void (r2 as Promise<void>).then(
          () => this.wanCheng(r, kai, true, '', n, an),
          (e: unknown) => this.wanCheng(r, kai, false, String((e as Error)?.message || e).slice(0, 200), n, an),
        );
        return;
      }
    } catch (e) {
      this.wanCheng(r, kai, false, String((e as Error)?.message || e).slice(0, 200), n, an);
      return;
    }
    this.wanCheng(r, kai, true, '', n, an);
  }

  /**
   * **单次执行超时**：释放占用、按失败退避、并把原因写进 `lastSkip`。
   * 没有这一条，"重入保护"就变成"永久卡死"：一个永不 resolve 的任务会让它自己再也不跑。
   */
  private chaoShi(r: XinTiaoRenWu & { zhang: RenZhang }, an: Record<string, unknown>, chaoShiMs: number): void {
    const dangQian = this.zaiTuan.get(r.id);
    if (!dangQian || dangQian.an !== an) return;   // 已经自己收完了，不许多结一次
    this.zaiTuan.delete(r.id);
    an.yiGuoQi = true;
    const z = r.zhang;
    const n = this.now();
    const zhanYongMs = Math.max(0, this.danDiao() - dangQian.kai);
    z.chaoShuCi += 1;
    z.lianXuShiBai += 1;
    const tuiBi = Math.min(32, 2 ** Math.max(0, z.lianXuShiBai - 2));
    z.xiaCiAt = n + Math.max(1000, r.meiMs) * tuiBi;
    z.lastSkip = { yuanYin: 'timeout', at: n, xiangxi: { chaoShiMs, zhanYongMs } };
    this.shiJian('timeout', r.id, { chaoShiMs, zhanYongMs, tuiBiBeiShu: tuiBi });
    this.biaoZang();
  }

  private wanCheng(r: XinTiaoRenWu & { zhang: RenZhang }, kai: number, ok: boolean, cuo: string, n: number, an?: Record<string, unknown>): void {
    const z = r.zhang;
    const dangQian = this.zaiTuan.get(r.id);
    if (!an || (dangQian && dangQian.an === an)) this.zaiTuan.delete(r.id);
    if (an && an.yiGuoQi === true) return;         // 超时已经结过账，晚到的完成只丢弃
    if (ok) z.lastSkip = null;
    z.zuiHouMs = Math.max(0, this.danDiao() - kai);
    z.shangCiAt = z.shangCiAt || n;
    if (ok) {
      if (z.lianXuShiBai) this.shiJian('recover', r.id, { lianXuShiBai: z.lianXuShiBai });
      z.lianXuShiBai = 0;
      this.shiJian('ok', r.id, { haoShiMs: z.zuiHouMs, ciShu: z.ciShu });
    } else {
      z.lianXuShiBai += 1;
      /** 连续失败退避：2 的幂、封顶 32 个周期。不丢任务，只是别把错误刷成风暴 */
      const tuiBi = Math.min(32, 2 ** Math.max(0, z.lianXuShiBai - 2));
      z.xiaCiAt = n + Math.max(1000, r.meiMs) * tuiBi;
      this.shiJian('err', r.id, { lianXuShiBai: z.lianXuShiBai, tuiBiBeiShu: tuiBi, cuo: cuo.slice(0, 160) });
    }
    this.biaoZang();
  }

  /** 手动跑一次（不等周期、不受宽限限制，但仍受重入保护） */
  async paoYiCi(id: string, liYou = 'manual'): Promise<{ ok: boolean; tiaoGuo?: string }> {
    const r = this.renWu.get(id);
    if (!r) return { ok: false, tiaoGuo: 'no-such-task' };
    const mang = this.zaiTuan.get(id);
    if (mang) {
      r.zhang.lastSkip = { yuanYin: 'busy', at: this.now(), xiangxi: { zhanYongMs: Math.max(0, this.danDiao() - mang.kai), liYou } };
      this.shiJian('skip-busy', id, { liYou, zhanYongMs: Math.max(0, this.danDiao() - mang.kai) });
      return { ok: false, tiaoGuo: 'busy' };
    }
    const n = this.now();
    const z = r.zhang;
    /**
     * 手动触发**也要记账**：界面上点了「立即跑」而"已跑次数"一动不动，
     * 用户只能怀疑按钮是画的（真机 r40-live-⑦ 就是这么红的）。
     */
    z.ciShu += 1;
    z.shangCiAt = n;
    this.biaoZang();
    const kai = this.danDiao();
    const an: Record<string, unknown> = {};
    this.zaiTuan.set(id, { an, kai });
    try {
      await r.run({ now: n, tuoYanMs: 0, queGuoCiShu: 1, tiaoGuoChi: z.tiaoGuoChi, buPao: false });
      this.wanCheng(r, kai, true, '', n, an);
      return { ok: true };
    } catch (e) {
      this.wanCheng(r, kai, false, String((e as Error)?.message || e).slice(0, 200), n, an);
      return { ok: false, tiaoGuo: 'error' };
    }
  }

  /* ── 一次性到期（"多久之后"）：落盘、可跨重启补跑、可挂系统保底 ── */

  daoJiShenQing(x: { id?: string; yaoAt?: number; miao?: number; beiZhu?: string; chang?: Record<string, unknown> }): DaoJiJiLu {
    const n = this.now();
    const yaoAt = Number.isFinite(Number(x.yaoAt)) && Number(x.yaoAt) > 0 ? Number(x.yaoAt) : n + Math.max(0, Number(x.miao) || 0) * 1000;
    const ji: DaoJiJiLu = {
      id: String(x.id || ('dj-' + n + '-' + Math.random().toString(36).slice(2, 6))),
      yaoAt, beiZhu: String(x.beiZhu || '').slice(0, 120), miaoShu: Math.max(0, Math.round((yaoAt - n) / 1000)),
      chang: (x.chang && typeof x.chang === 'object') ? { ...x.chang } : {},
      yiFa: false, laiYuan: '', huoShiAt: 0,
    };
    this.daoJi.push(ji);
    /**
     * 同 id 再登记 = **覆盖到期**（保留最后一条），不是"再排一次"也不是"忽略"：
     * 定时任务每跑一轮都要把"下一次"挂上去，若保留第一条，第二次起就永远按旧时间到点。
     */
    {
      const byId = new Map<string, DaoJiJiLu>();
      for (const d of this.daoJi) byId.set(d.id, d);
      this.daoJi = [...byId.values()].slice(-BAO_CHI_LIU);
    }
    this.biaoZang();
    this.shiJian('daoJi-ji', ji.id, { yaoAt, miaoShu: ji.miaoShu, beiZhu: ji.beiZhu });
    void this.guiOs(ji);
    if (this.yiQiDong) this.jiHuaZhong();
    return ji;
  }

  private async guiOs(ji: DaoJiJiLu): Promise<void> {
    const g = this.gou.osShouShi;
    if (!g) return;
    const xianZhi = Number(this.gou.osZhiShangMs) > 0 ? Number(this.gou.osZhiShangMs) : MO_REN_OS_ZHI_SHANG;
    if (ji.yaoAt - this.now() < xianZhi) return;   // 短等待心跳自己就够，不值得动用系统
    /**
     * **先占位再 await**：`chuangJian` 是异步的，如果等它回来才置 `osGui`，
     * 那"登记完马上就到期"的点到就会漏撤系统那条 ⇒ 留下一个还会自己响的僵尸计划任务。
     * 挂不上再回滚标记，并如实留 `os-fail` 痕（别让用户以为保底生效了）。
     */
    ji.osGui = true;
    try {
      const cheng = await g.chuangJian({ id: ji.id, yaoAt: ji.yaoAt, beiZhu: ji.beiZhu });
      /** 钩子明说"没挂"（开关关着 / 命令太长）⇒ 账本不许记成挂了 */
      if (cheng === false) ji.osGui = false;
      this.biaoZang();
      if (ji.osGui) this.shiJian('os-arm', ji.id, { yaoAt: ji.yaoAt });
    } catch (e) {
      ji.osGui = false;
      this.shiJian('os-fail', ji.id, { cuo: String((e as Error)?.message || e).slice(0, 160) });
    }
  }

  /**
   * **把所有系统保底卸掉**（用户口径：程序必须能被主动完全关闭）。
   * 只撤系统那一条，**到期记录本身保留** —— 关掉开关不等于取消用户的定时任务，
   * 那些任务回到"程序开着才计时"的默认形态，重新打开时照旧补跑。
   */
  async osXieZai(): Promise<number> {
    const yaoXie = this.daoJi.filter((d) => d.osGui);
    for (const d of yaoXie) {
      try { await this.gou.osShouShi?.shanChu(d.id); } catch { /* 撤不掉也照样清标记 */ }
      d.osGui = false;
    }
    if (yaoXie.length) { this.biaoZang(); this.shiJian('os-disarm', 'kernel', { shu: yaoXie.length }); }
    return yaoXie.length;
  }

  daoJiQuXiao(id: string): boolean {    const i = this.daoJi.findIndex((d) => d.id === String(id));
    if (i < 0) return false;
    const d = this.daoJi[i];
    this.daoJi.splice(i, 1);
    if (d && d.osGui) { try { void this.gou.osShouShi?.shanChu(d.id); } catch { /* noop */ } }
    this.biaoZang();
    this.shiJian('daoJi-qu', String(id), {});
    return true;
  }

  private daoJiDao(n: number, lengQiDong: boolean): void {
    for (const d of this.daoJi) {
      if (d.yiFa || d.yaoAt > n) continue;
      d.yiFa = true;
      d.huoShiAt = n;
      const laiYuan = lengQiDong ? 'buPao' : 'xin-tiao';
      this.shiJian('daoJi-fire', d.id, { yaoAt: d.yaoAt, lateMs: Math.max(0, n - d.yaoAt), laiYuan, beiZhu: d.beiZhu, chang: d.chang, miaoShu: d.miaoShu });
      if (d.osGui) { try { void this.gou.osShouShi?.shanChu(d.id); } catch { /* 到点了，系统那条没用了 */ } d.osGui = false; }
    }
    this.biaoZang();
  }

  /**
   * ingest 系统留痕：程序没开着的时候到过的点，由系统记下了痕。
   * 这些痕**只用于核对**"心跳有没有漏"（漏了会补触发并说明迟到多久），
   * 不重复触发已经由心跳发过的到期。
   */
  waiBuDaoQi(id: string, beiJingMs: number): { ok: boolean; yiFaGuo?: boolean; buFa?: boolean } {
    const d = this.daoJi.find((x) => x.id === String(id));
    if (!d) return { ok: false };
    if (d.yiFa) return { ok: true, yiFaGuo: true };
    d.yiFa = true;
    d.huoShiAt = this.now();
    this.shiJian('daoJi-fire', d.id, { yaoAt: d.yaoAt, lateMs: Math.max(0, this.now() - d.yaoAt), laiYuan: 'os', beiZhu: d.beiZhu, chang: d.chang, beiJingMs });
    this.biaoZang();
    return { ok: true, buFa: true };
  }

  /* ── 等待（wait_seconds 走这里）：由心跳的到期闹钟驱动，可取消 ── */

  dengDai(miao: number, opts: { id?: string; quXiao?: () => void } = {}): Promise<Record<string, unknown>> {
    const n = this.now();
    const m = Math.max(0, Number(miao) || 0);
    const id = String(opts.id || ('wait-' + n + '-' + Math.random().toString(36).slice(2, 6)));
    if (m <= 0) return Promise.resolve({ waitedMs: 0, requestedMs: 0, yaoAt: n, now: n, tickMs: this.tickMs, miao: 0 });
    return new Promise((resolve) => {
      const r: DengDaiR = { id, yaoAt: n + Math.round(m * 1000), miao: m, resolve, quXiao: opts.quXiao };
      this.zaiDeng.push(r);
      if (this.yiQiDong) this.jiHuaZhong();
      else {
        /**
         * 心跳没起来（单测、或主进程还没 `qiDong`）时**不能让等待永久挂住**：
         * 退回一次性定时器把它叫醒，并如实记 `wait-no-heartbeat` —— 计时源降级必须看得见，
         * 否则"用心跳计时"这句话在程序没跑起来的那段时间里就是假的。
         */
        this.shiJian('wait-no-heartbeat', id, { miao: m });
        const ms = Math.round(m * 1000);
        if (this.gou.zaoShiZhong) this.gou.zaoShiZhong(ms, () => this.dengDaiDao(r));
        else setTimeout(() => this.dengDaiDao(r), ms);
      }
    });
  }

  private dengDaiDao(r: DengDaiR): void {
    const yi = this.zaiDeng.indexOf(r);
    if (yi >= 0) this.zaiDeng.splice(yi, 1);
    const n = this.now();
    r.resolve({ waitedMs: Math.max(0, n - (r.yaoAt - Math.round(r.miao * 1000))), requestedMs: Math.round(r.miao * 1000), yaoAt: r.yaoAt, now: n, tickMs: this.tickMs });
    this.shiJian('wait-fire', r.id, { miao: r.miao, wai: true });
  }

  dengDaiQuXiao(id: string): boolean {
    const i = this.zaiDeng.findIndex((d) => d.id === String(id));
    if (i < 0) return false;
    const d = this.zaiDeng[i];
    this.zaiDeng.splice(i, 1);
    if (!d) return false;
    try { d.quXiao?.(); } catch { /* noop */ }
    d.resolve({ cancelled: true, requestedMs: Math.round(d.miao * 1000), yaoAt: d.yaoAt, now: this.now() });
    this.shiJian('wait-cancel', d.id, {});
    return true;
  }

  /* ── 可观测 ── */

  zhuangTai(): Record<string, unknown> {
    const n = this.now();
    return {
      yiQiDong: this.yiQiDong, qiDongAt: this.qiDongAt, ticks: this.ticks, tickMs: this.tickMs,
      xiaCiAt: Number.isFinite(this.zuiZaoDaoQi()) ? this.zuiZaoDaoQi() : null,
      zaiTuan: [...this.zaiTuan.keys()],
      zuiHouTickMs: this.zuiHouTickDanDiao > 0 ? Math.max(0, this.danDiao() - this.zuiHouTickDanDiao) : null,
      dengDaiShu: this.zaiDeng.length,
      daoJi: { weiFa: this.daoJi.filter((d) => !d.yiFa).length, yiFa: this.daoJi.filter((d) => d.yiFa).length, osGui: this.daoJi.filter((d) => d.osGui).length },
      ren: [...this.renWu.values()].map((r) => ({
        id: r.id, ming: r.ming, meiMs: r.meiMs, chaoShiMs: Math.max(0, Number(r.chaoShiMs) || 0),
        xiaCiAt: r.zhang.xiaCiAt, daoJiMs: r.meiMs > 0 ? Math.max(0, r.zhang.xiaCiAt - n) : null,
        shangCiAt: r.zhang.shangCiAt, shangCiMs: r.zhang.zuiHouMs, ciShu: r.zhang.ciShu,
        lianXuShiBai: r.zhang.lianXuShiBai, tiaoGuoChi: r.zhang.tiaoGuoChi, queGuoZong: r.zhang.queGuoZong,
        chaoShuCi: r.zhang.chaoShuCi, lastSkip: r.zhang.lastSkip,
        zaiTuan: this.zaiTuan.has(r.id),
        zhanYongMs: this.zaiTuan.has(r.id) ? Math.max(0, this.danDiao() - (this.zaiTuan.get(r.id) || { kai: this.danDiao() }).kai) : 0,
      })),
    };
  }

  daoJiLieBiao(weiFaOnly = true): DaoJiJiLu[] {
    return this.daoJi.filter((d) => !weiFaOnly || !d.yiFa).map((d) => ({ ...d, chang: { ...d.chang } }));
  }

  zuiJinShiJian(n = 50): XinTiaoShiJian[] {
    return this.luPan.slice(-Math.max(1, n)).map((e) => ({ ...e, xiangxi: { ...e.xiangxi } }));
  }

  /** 退出前落盘（主进程 before-quit 调） */
  guanBi(): void { this.tingZhi(); }
}

export function chuangjianXinTiao(gou: XinTiaoGouZi = {}): XinTiao { return new XinTiao(gou); }
