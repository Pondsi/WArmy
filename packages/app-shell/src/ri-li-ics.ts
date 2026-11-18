/**
 * R260 项「日历/深度邮件」：本地 .ics（iCalendar RFC5545）解析/生成 —— 纯函数、无依赖、可测。
 *
 * 日历读写以 .ics 为载体（用户日历文件 / CalDAV 拉下来的 .ics 都走这里）；
 * 深度邮件的 SMTP 已有，IMAP 线程/附件由子进程适配器按需对接（未装如实降级）。
 * 本模块只做确定性的 .ics 文本处理：折行展开、VEVENT 解析、VEVENT/VCALENDAR 生成、文本转义。
 */

export interface RiLiShiJian {
  uid: string;
  summary: string;
  dtstart: string;
  dtend?: string;
  location?: string;
  description?: string;
}

/** 展开折行：以空格/制表符开头的行是上一行的续行（RFC5545 §3.1）。 */
export function zhanKaiZheHang(ics: string): string[] {
  const out: string[] = [];
  for (const raw of String(ics || '').split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

const zhuanYi = (s: string): string => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fanZhuanYi = (s: string): string => String(s || '').replace(/\\n/gi, '\n').replace(/\\;/g, ';').replace(/\\,/g, ',').replace(/\\\\/g, '\\');

/** 取属性值（容许参数，如 DTSTART;TZID=...:value）。 */
function quZhi(hang: string, ming: string): string | null {
  const m = new RegExp('^' + ming + '(?:;[^:]*)?:(.*)$', 'i').exec(hang);
  return m ? m[1]! : null;
}

/** 解析 .ics 里的全部 VEVENT。 */
export function jieXiVEVENT(ics: string): RiLiShiJian[] {
  const out: RiLiShiJian[] = [];
  let cur: Partial<RiLiShiJian> | null = null;
  for (const hang of zhanKaiZheHang(ics)) {
    const h = hang.trim();
    if (/^BEGIN:VEVENT$/i.test(h)) { cur = {}; continue; }
    if (/^END:VEVENT$/i.test(h)) {
      if (cur && cur.uid) out.push({ uid: cur.uid, summary: cur.summary || '', dtstart: cur.dtstart || '', dtend: cur.dtend, location: cur.location, description: cur.description });
      cur = null; continue;
    }
    if (!cur) continue;
    const uid = quZhi(h, 'UID'); if (uid !== null) cur.uid = fanZhuanYi(uid);
    const sum = quZhi(h, 'SUMMARY'); if (sum !== null) cur.summary = fanZhuanYi(sum);
    const ds = quZhi(h, 'DTSTART'); if (ds !== null) cur.dtstart = ds;
    const de = quZhi(h, 'DTEND'); if (de !== null) cur.dtend = de;
    const loc = quZhi(h, 'LOCATION'); if (loc !== null) cur.location = fanZhuanYi(loc);
    const desc = quZhi(h, 'DESCRIPTION'); if (desc !== null) cur.description = fanZhuanYi(desc);
  }
  return out;
}

/** 生成单个 VEVENT 块。 */
export function shengChengVEVENT(ev: RiLiShiJian): string {
  const lines = ['BEGIN:VEVENT', 'UID:' + zhuanYi(ev.uid), 'DTSTAMP:' + (ev.dtstart || '19700101T000000Z')];
  if (ev.dtstart) lines.push('DTSTART:' + ev.dtstart);
  if (ev.dtend) lines.push('DTEND:' + ev.dtend);
  lines.push('SUMMARY:' + zhuanYi(ev.summary));
  if (ev.location) lines.push('LOCATION:' + zhuanYi(ev.location));
  if (ev.description) lines.push('DESCRIPTION:' + zhuanYi(ev.description));
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/** 生成完整 VCALENDAR（含若干 VEVENT）。 */
export function riLiWenBen(events: RiLiShiJian[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WArmy//Calendar//CN', ...events.map(shengChengVEVENT), 'END:VCALENDAR'].join('\r\n');
}