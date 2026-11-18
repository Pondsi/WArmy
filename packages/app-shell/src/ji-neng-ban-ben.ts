/**
 * R260 项「技能版本更新」：技能 semver 版本提取＋比较＋更新检测。
 *
 * 技能以 SKILL.md 为载体；版本写在 frontmatter 的 `version:` 行（如 `version: 1.2.3`）。
 * 本模块纯函数：提取已装技能版本、与市场最新版本比较（semver），给出是否有更新。
 * 与插件市场 detectUpdate 同口径（推荐版高于已装 ⇒ 有更新），供技能更新流程复用。
 */

export interface BanBen { major: number; minor: number; patch: number; pre: string[] }

/** 解析 semver（容许前缀 v；预发布 -rc.1 等）；非法返回 null。 */
export function jieXiBanBen(v: string): BanBen | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? String(m[4]).split('.') : [] };
}

/** 比较两版本：a<b ⇒ -1；a==b ⇒ 0；a>b ⇒ 1。预发布 < 同号正式版；非法版本视为最低。 */
export function biJiaoBanBen(a: string, b: string): number {
  const pa = jieXiBanBen(a); const pb = jieXiBanBen(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  // 预发布优先级：无预发布 > 有预发布；都有则逐段比较（数字段按数值，其余按字典序）
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa.pre[i]; const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d < 0 ? -1 : 1; }
    else if (xn) return -1;
    else if (yn) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 从 SKILL.md 提取版本：frontmatter 内 `version: x.y.z`（也容许 `version:x.y.z`）；没有返回 null。 */
export function tiQuSkillBanBen(md: string): string | null {
  const s = String(md || '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(s);
  const scope = fm ? fm[1]! : s;
  const m = /^\s*version\s*:\s*["']?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)["']?\s*$/im.exec(scope);
  return m ? m[1]! : null;
}

/** 更新检测： latest 高于 installed ⇒ 有更新。任一缺失/非法 ⇒ 保守判无更新（不臆造）。 */
export function jianCeGengXin(installed: string | null, latest: string | null): { hasUpdate: boolean; installed: string | null; latest: string | null } {
  const i = installed && jieXiBanBen(installed) ? installed : null;
  const l = latest && jieXiBanBen(latest) ? latest : null;
  if (!i || !l) return { hasUpdate: false, installed: i, latest: l };
  return { hasUpdate: biJiaoBanBen(l, i) > 0, installed: i, latest: l };
}