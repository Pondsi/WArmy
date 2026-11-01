/**
 * 界面时间的**唯一入口**（第 91 轮）。
 *
 * 记录永远存 epoch 毫秒；这里只负责把时间戳按“用户选定的 IANA 时区”变成界面文字。
 * 默认时区 = 系统时区；设置页改动后调用 `setTimezone()`，随后重绘即可。
 * 不读写设置、不碰 DOM —— 这样门禁可以直接在 Node 里跑真值表。
 */
(() => {
  const SYS = (() => {
    try {
      const z = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      new Intl.DateTimeFormat('en-CA', { timeZone: z });
      return z;
    } catch { return 'UTC'; }
  })();
  let cur = SYS;

  function valid(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
  }
  function setTimezone(tz) {
    cur = valid(tz) ? tz : SYS;
    return cur;
  }
  const getTimezone = () => cur;
  const systemTimezone = () => SYS;
  /**
   * 启动/登录时的决定（纯函数，门禁跑真值表）：
   *   init   —— 从没存过：把系统时区写下来当基线；
   *   prompt —— 存过且与当前系统时区不同：5 秒后问用户保持还是更换；
   *   none   —— 存过且相同：什么都不做。
   */
  function decide(saved, sys, keepFor) {
    const s = String(saved || '');
    const system = valid(sys) ? sys : SYS;
    if (!valid(s)) return { action: 'init', timezone: system, system };
    if (s === system) return { action: 'none', timezone: s, system };
    /** 用户已经对这个系统时区说过"保持" ⇒ 不再重复打扰；系统时区再变才会重新问 */
    if (String(keepFor || '') === system) return { action: 'none', timezone: s, system, kept: true };
    return { action: 'prompt', timezone: s, system };
  }

  function parts(ts, tz) {
    const n = Number(ts);
    const d = new Date(Number.isFinite(n) && n > 0 ? n : Date.now());
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: valid(tz) ? tz : cur,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    const o = {};
    for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
    return {
      year: Number(o.year), month: Number(o.month), day: Number(o.day),
      hour: Number(o.hour), minute: Number(o.minute), second: Number(o.second),
    };
  }

  const p2 = (n) => String(n).padStart(2, '0');
  const full = (ts) => {
    const p = parts(ts);
    return `${p.year}-${p2(p.month)}-${p2(p.day)} ${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}`;
  };
  const minute = (ts) => {
    const p = parts(ts);
    return `${p.year}-${p2(p.month)}-${p2(p.day)} ${p2(p.hour)}:${p2(p.minute)}`;
  };
  const hm = (ts) => {
    const p = parts(ts);
    return `${p2(p.hour)}:${p2(p.minute)}`;
  };
  const hms = (ts) => {
    const p = parts(ts);
    return `${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}`;
  };
  const monthDayHm = (ts) => {
    const p = parts(ts);
    return `${p.month}月${p.day}日 ${p2(p.hour)}:${p2(p.minute)}`;
  };
  const sameDay = (a, b) => {
    const x = parts(a); const y = parts(b);
    return x.year === y.year && x.month === y.month && x.day === y.day;
  };
  /** 聊天分隔点：同一天 HH:mm，跨日 M月D日 HH:mm（沿用原格式） */
  const smart = (ts) => (sameDay(ts, Date.now()) ? hm(ts) : monthDayHm(ts));
  /** 是否要插时间分隔点：跨小时 / 跨日 */
  const crossPoint = (a, b) => {
    const x = parts(a); const y = parts(b);
    return x.hour !== y.hour || x.day !== y.day || x.month !== y.month || x.year !== y.year;
  };

  function loc(ts, locale, opts) {
    const o = Object.assign({}, opts || {}, { timeZone: cur });
    return new Date(Number(ts) || Date.now()).toLocaleString(locale || undefined, o);
  }
  function locTime(ts, locale, opts) {
    const o = Object.assign({}, opts || {}, { timeZone: cur });
    return new Date(Number(ts) || Date.now()).toLocaleTimeString(locale || undefined, o);
  }
  function locDate(ts, locale, opts) {
    const o = Object.assign({}, opts || {}, { timeZone: cur });
    return new Date(Number(ts) || Date.now()).toLocaleDateString(locale || undefined, o);
  }

  /** 某时区相对 UTC 的偏移分钟（东八区 480） */
  function offsetMinutes(tz) {
    const at = Date.now();
    const qiang = (z) => {
      const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
      const o = {};
      for (const p of f.formatToParts(new Date(at))) if (p.type !== 'literal') o[p.type] = p.value;
      return Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute), Number(o.second));
    };
    try { return Math.round((qiang(valid(tz) ? tz : cur) - qiang('UTC')) / 60000); } catch { return 0; }
  }
  function offsetLabel(tz) {
    const m = offsetMinutes(tz);
    const sign = m >= 0 ? '+' : '-';
    const a = Math.abs(m);
    return `UTC${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  }

  /** 旧版 Intl 没有 supportedValuesOf 时的兜底（不追求全量，够选到常用地区） */
  const FALLBACK_ZONES = [
    'UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul',
    'Asia/Singapore', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila', 'Asia/Kolkata',
    'Asia/Dubai', 'Asia/Tehran', 'Asia/Jerusalem', 'Europe/Moscow', 'Europe/Istanbul',
    'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
    'Europe/London', 'Europe/Lisbon', 'Europe/Warsaw', 'Europe/Kyiv', 'Africa/Cairo',
    'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima', 'America/Santiago',
    'Pacific/Auckland', 'Pacific/Honolulu', 'Australia/Sydney', 'Australia/Melbourne',
    'Australia/Brisbane', 'Australia/Perth', 'Asia/Kathmandu', 'Asia/Karachi',
    'Asia/Dhaka', 'Asia/Yangon', 'America/Anchorage', 'Atlantic/Reykjavik',
  ];

  let zonesCache = null;
  /** 全部 IANA 时区（按 UTC 偏移、时区名排序）；每项带 offset 标签 */
  function zones() {
    if (zonesCache) return zonesCache;
    let list = [];
    try {
      const f = Intl.supportedValuesOf;
      if (typeof f === 'function') list = f('timeZone') || [];
    } catch { list = []; }
    if (!Array.isArray(list) || !list.length) list = FALLBACK_ZONES.slice();
    if (!list.includes('UTC')) list.unshift('UTC');
    zonesCache = list
      .filter((z) => valid(z))
      .map((tz) => ({ tz, offset: offsetMinutes(tz), label: offsetLabel(tz) }))
      .sort((a, b) => (a.offset - b.offset) || a.tz.localeCompare(b.tz));
    return zonesCache;
  }

  window.__warmyTime = {
    systemTimezone, getTimezone, setTimezone, valid, decide,
    parts, full, minute, hm, hms, monthDayHm, smart, crossPoint, sameDay,
    loc, locTime, locDate, offsetMinutes, offsetLabel, zones,
  };
})();
