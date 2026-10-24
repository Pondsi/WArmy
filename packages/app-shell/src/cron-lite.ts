/**
 * cron-lite —— **5 字段 Cron 表达式 + IANA 时区**（第 42 轮，零依赖、可单测）。
 *
 * 为什么自己写：项目不想为一条定时任务引入外部依赖；而 `cron-parser` 的体积与
 * 供应链风险不成比例。这里只实现真正需要的子集：
 *   · 字段：分 时 日 月 周（`minute hour dom month dow`）
 *   · 取值：`*`、`N`、`a-b`、`a-b/s`、`* /s`、逗号列表
 *   · 周：0-7（0 与 7 都表示周日）
 *
 * 时区：用 `Intl.DateTimeFormat` 取"某时刻在某时区的墙上时间"，
 * 再用"墙上时间 + 偏移"推进，避免逐分钟格式化（那会慢到几秒）。
 * DST 切换时偏移会变，所以推进后再校验一次偏移，不一致就按真实时刻重算。
 *
 * 纯函数、无 IO、无 Electron —— 门禁可以直接 import 编译产物断言。
 */

export interface CronZiDuan {
  fen: Set<number>;
  shi: Set<number>;
  ri: Set<number>;
  yue: Set<number>;
  zhou: Set<number>;
}

const FAN_WEI: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** 解析单个字段（支持 *、a、a-b、a-b/s、*\/s、逗号列表） */
function jieXiZiDuan(text: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  const kuai = String(text || '').trim();
  if (!kuai) return null;
  for (const item of kuai.split(',')) {
    const s = item.trim();
    if (!s) return null;
    const bu = /^(.+)\/(\d+)$/.exec(s);
    const zhu = bu ? String(bu[1]) : s;
    const buChang = bu ? Number(bu[2]) : 1;
    if (!Number.isFinite(buChang) || buChang <= 0) return null;
    let a = min;
    let b = max;
    if (zhu !== '*') {
      const fan = /^(\d+)-(\d+)$/.exec(zhu);
      if (fan) {
        a = Number(fan[1] ?? 0);
        b = Number(fan[2] ?? 0);
      } else if (/^\d+$/.test(zhu)) {
        a = Number(zhu);
        b = bu ? max : a; // `5/10` 等价于 5 起每 10
      } else {
        return null;
      }
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
    for (let v = a; v <= b; v += buChang) {
      if (v < min || v > max) continue;
      out.add(v);
    }
  }
  return out.size ? out : null;
}

/** 解析表达式；非法返回 null（调用方据此回退到 everyMinutes/dailyAt） */
export function jieXiCron(expr: string): CronZiDuan | null {
  const t = String(expr || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const parts = t.split(' ');
  if (parts.length !== 5) return null;
  const sets: Array<Set<number> | null> = [];
  for (let i = 0; i < 5; i += 1) {
    const [min, max] = FAN_WEI[i]!;
    sets.push(jieXiZiDuan(parts[i]!, min, max));
  }
  if (sets.some((s) => !s)) return null;
  const [fen, shi, ri, yue, zhou0] = sets as Set<number>[];
  /** 周日：0 与 7 都算 */
  const zhou = new Set<number>();
  for (const v of zhou0!) zhou.add(v === 7 ? 0 : v);
  return { fen: fen!, shi: shi!, ri: ri!, yue: yue!, zhou };
}

type QiangShang = { y: number; m: number; d: number; hh: number; mm: number; dow: number };

/** 某时刻在某 IANA 时区的墙上时间（失败抛错，不猜） */
export function qiangShangShiJian(ts: number, tz: string): QiangShang {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date(ts));
  const qu = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const y = Number(qu('year'));
  const m = Number(qu('month'));
  const d = Number(qu('day'));
  const hh = Number(qu('hour')) % 24;
  const mm = Number(qu('minute'));
  const zhouMing: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = zhouMing[qu('weekday')] ?? 0;
  if (![y, m, d, hh, mm].every((x) => Number.isFinite(x))) throw new Error('bad-timezone');
  return { y, m, d, hh, mm, dow };
}

/** 墙上时间（按 UTC 解释）→ 毫秒数；只用来做日历运算，不是真实 epoch */
function qiangToMs(q: QiangShang): number {
  return Date.UTC(q.y, q.m - 1, q.d, q.hh, q.mm, 0, 0);
}
function msToQiang(ms: number): QiangShang {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: t.getUTCDay() };
}

/**
 * 计算下一次触发时刻（epoch ms）；找不到（表达式永不匹配）返回 0。
 * @param now 当前 epoch
 * @param tz IANA 时区名（如 `Asia/Shanghai`；空=本机时区）
 */
export function xiaCiCron(expr: string, tz: string, now = Date.now()): number {
  const c = jieXiCron(expr);
  if (!c) return 0;
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let qiang: QiangShang;
  try { qiang = qiangShangShiJian(now, zone); } catch { return 0; }
  /** 偏移（墙上 - 真实），用来在墙上空间推进 */
  let pianYi = qiangToMs(qiang) - Math.floor(now / 60000) * 60000;
  let wall = qiangToMs(qiang) + 60000; // 从下一分钟开始找
  /** 上限：一年（够覆盖 2 月 29 日这类最稀疏的匹配） */
  for (let i = 0; i < 366 * 1440; i += 1) {
    const q = msToQiang(wall);
    const piPei = c.fen.has(q.mm) && c.shi.has(q.hh) && c.yue.has(q.m) && c.ri.has(q.d) && c.zhou.has(q.dow);
    if (piPei) {
      const cand = wall - pianYi;
      /** DST 校验：候选时刻的偏移若变了，用新偏移重算一次 */
      try {
        const q2 = qiangShangShiJian(cand, zone);
        const p2 = qiangToMs(q2) - Math.floor(cand / 60000) * 60000;
        if (p2 !== pianYi) {
          pianYi = p2;
          const cand2 = wall - pianYi;
          return cand2 > now ? cand2 : 0;
        }
      } catch { return 0; }
      return cand > now ? cand : 0;
    }
    wall += 60000;
  }
  return 0;
}

/** 给界面看的人话描述 */
export function miaoShuCron(expr: string, tz: string): string {
  const c = jieXiCron(expr);
  if (!c) return '无效的 Cron 表达式';
  return `Cron ${expr.trim()}（时区 ${tz || '本机'}）`;
}
