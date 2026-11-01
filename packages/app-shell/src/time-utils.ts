/**
 * 统一时间口径（第 91 轮）。
 *
 * 用户定稿：
 *  · **所有记录都以时间戳（epoch 毫秒）保存**；
 *  · 界面仍按现在的格式显示，但按设置里选定的时区换算；
 *  · 模型用的时间、工具回执、审计等**非界面**场景只给 epoch / ISO 8601，
 *    不用本地化字符串 —— 本地化字符串没有固定语义，换时区/换机器就变。
 *
 * 这个模块只做"没有副作用"的换算；读写设置由调用方负责。
 */

export const SHI_QU_UTC = 'UTC';

export function xiTongShiQu(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || SHI_QU_UTC;
  } catch {
    return SHI_QU_UTC;
  }
}

/** IANA 时区名是否被当前 Intl 认可（不认可就不静默当成系统时区）。 */
export function shiQuHeFa(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 生效时区：合法就用传入值，否则退回系统时区。 */
export function guiYiShiQu(tz: unknown): string {
  return shiQuHeFa(tz) ? String(tz) : xiTongShiQu();
}

/**
 * 某 IANA 时区在某一刻相对 UTC 的偏移（分钟，东八区 = 480）。
 * 用 formatToParts 取墙上时间再与 UTC 相比，自动覆盖夏令时。
 */
export function shiQuPianYiFen(tz: string, at: number = Date.now()): number {
  const zone = guiYiShiQu(tz);
  const ms = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const qiangShang = (z: string): number => {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: z,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
    return Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute), Number(o.second));
  };
  try {
    return Math.round((qiangShang(zone) - qiangShang(SHI_QU_UTC)) / 60000);
  } catch {
    return 0;
  }
}

/** 把时间戳写成该时区的 ISO 8601（带偏移），例如 `2026-10-26T18:03:04+08:00`。 */
export function isoZaiShiQu(ts: number, tz: string): string {
  const n = Number.isFinite(Number(ts)) && Number(ts) > 0 ? Number(ts) : Date.now();
  const zone = guiYiShiQu(tz);
  const p = (v: number): string => String(v).padStart(2, '0');
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    const o: Record<string, string> = {};
    for (const part of f.formatToParts(new Date(n))) if (part.type !== 'literal') o[part.type] = part.value;
    const off = shiQuPianYiFen(zone, n);
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
  } catch {
    return new Date(n).toISOString();
  }
}

/** 给模型/日志的紧凑时间戳：`<epochMs> (<UTC ISO>)`。 */
export function shiJianChuoWen(ts: number): string {
  const n = Number.isFinite(Number(ts)) && Number(ts) > 0 ? Number(ts) : Date.now();
  return `${Math.trunc(n)} (${new Date(n).toISOString()})`;
}

/** 用户可见文字：按选定 IANA 时区格式化（locale 由调用方决定，默认跟随系统语言）。 */
export function geShiShiJian(
  ts: number,
  tz: string,
  opts: Intl.DateTimeFormatOptions = {},
  locale?: string,
): string {
  const n = Number.isFinite(Number(ts)) && Number(ts) > 0 ? Number(ts) : Date.now();
  try {
    return new Date(n).toLocaleString(locale, { ...opts, timeZone: guiYiShiQu(tz) });
  } catch {
    return new Date(n).toISOString();
  }
}
