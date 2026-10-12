/**
 * skill-md —— **SKILL.md 规范对齐**（前台元数据 + 渐进披露）。
 *
 * 为什么必须对齐
 * ---------------------------------------------------------------------------
 * 真事故：`find_skill` 只是把 SKILL.md 的**前 3 行**当描述拼给模型 ——
 * 于是"技能名"实际是个 markdown 标题，"能力说明"是半句话，模型据此判断
 * "这个技能对不对口"，几乎必然挑错；而 `install_skill` 也只检查了"有没有 SKILL.md"，
 * 一个空的 SKILL.md 也能装。
 *
 * 规范（Agent Skills 开放规范，各家一致的那部分）：
 *   · SKILL.md = YAML frontmatter（`---` 包起来）+ Markdown 正文；
 *   · frontmatter **必填** `name`（≤64，小写字母/数字/连字符，首尾不能是连字符）、
 *     `description`（≤1024，非空，写清"做什么 + 什么时候用"）；
 *   · 选填 `license` / `compatibility`（≤500）/ `metadata`（字符串键值映射）/ `allowed-tools`；
 *   · 目录里可选 `scripts/`（可执行脚本）、`references/`（按需加载的长文档）、`assets/`（模板等）。
 *
 * 渐进披露（progressive disclosure）在**工具面**上怎么落：
 *   第 1 层：启动/搜索时只给 name + description（约 100 token）——`zhaiYao()`；
 *   第 2 层：技能被选中后才读全文正文 ——`zhengWen()`；
 *   第 3 层：正文里指向的 `scripts/`、`references/`、`assets/` 文件按需读。
 *
 * 纯函数、零依赖（自己写 YAML 子集解析，不引 yaml 包）—— 门禁可无头断言。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  /** 规范之外的字段原样留着（不丢信息） */
  extra?: Record<string, string>;
}

export interface SkillJieGuo {
  ok: boolean;
  /** frontmatter 是否合法（必填字段齐、格式对） */
  valid: boolean;
  frontmatter: SkillFrontmatter;
  /** Markdown 正文（frontmatter 之后） */
  body: string;
  /** 正文总字符数（用于判断是否超建议体量） */
  bodyChars: number;
  /** 目录里可用的资源（渐进披露第 3 层） */
  resources: { scripts: string[]; references: string[]; assets: string[] };
  /** 不合法/可疑之处（**如实列出**，供 UI 与模型决策） */
  problems: string[];
}

const MING_ZUI_CHANG = 64;
const MIAOSHU_ZUI_CHANG = 1024;
const XIERONG_ZUI_CHANG = 500;
const MING_HE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 极简 YAML 子集：`key: value`、一层嵌套映射、`- item` 列表（列表合并成逗号串） */
function jieXiYaml(text: string): { map: Record<string, string>; nested: Record<string, Record<string, string>> } {
  const map: Record<string, string> = {};
  const nested: Record<string, Record<string, string>> = {};
  let curNest = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indented = /^\s+\S/.test(raw);
    const line = raw.trim();
    const kv = /^([A-Za-z0-9_.\-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      if (/^-\s+/.test(line)) {
        // 列表项：并入上一个键（逗号分隔），够用且不丢内容
        const item = line.replace(/^-\s+/, '').trim();
        if (curNest) {
          const g = nested[curNest]!;
          const keys = Object.keys(g);
          const last = keys[keys.length - 1];
          if (last) g[last] = (g[last] ? g[last] + ', ' : '') + item;
        }
        continue;
      }
      continue;
    }
    const k = kv[1]!;
    let v = (kv[2] ?? '').trim();
    if (v === '' && indented === false) {
      // 可能是嵌套映射的开始
      if (Object.keys(map).length || Object.keys(nested).length || true) { curNest = k; nested[curNest] = nested[curNest] || {}; }
      continue;
    }
    // 去引号
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (indented && curNest) {
      nested[curNest] = nested[curNest] || {};
      nested[curNest]![k] = v;
      continue;
    }
    map[k] = v;
    curNest = '';
  }
  return { map, nested };
}

/** 解析一份 SKILL.md 文本 */
export function jieXiSkillMd(text: string): SkillJieGuo {
  const yuan = String(text ?? '');
  const problems: string[] = [];
  let fmRaw = '';
  let body = yuan;
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(yuan);
  if (m) {
    fmRaw = m[1] || '';
    body = yuan.slice(m[0].length);
  } else if (/^\s*---/.test(yuan)) {
    problems.push('frontmatter 没有正确闭合（缺少结尾的 ---）');
  } else {
    problems.push('缺少 YAML frontmatter（规范要求文件以 --- 开头）');
  }
  const { map, nested } = jieXiYaml(fmRaw);
  const fm: SkillFrontmatter = {
    name: map['name'],
    description: map['description'],
    license: map['license'],
    compatibility: map['compatibility'],
    'allowed-tools': map['allowed-tools'] ?? map['allowed_tools'],
    metadata: Object.keys(nested['metadata'] || {}).length ? { ...nested['metadata'] } : undefined,
  };
  const yiZhi = new Set(['name', 'description', 'license', 'compatibility', 'allowed-tools', 'allowed_tools', 'metadata']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) if (!yiZhi.has(k)) extra[k] = v;
  if (Object.keys(extra).length) fm.extra = extra;

  if (!fm.name) problems.push('缺必填字段 name');
  else {
    if (fm.name.length > MING_ZUI_CHANG) problems.push(`name 超过 ${MING_ZUI_CHANG} 字符`);
    if (!MING_HE.test(fm.name)) problems.push('name 只允许小写字母/数字/连字符，且不能以连字符开头或结尾');
  }
  if (!fm.description) problems.push('缺必填字段 description');
  else if (fm.description.length > MIAOSHU_ZUI_CHANG) problems.push(`description 超过 ${MIAOSHU_ZUI_CHANG} 字符`);
  if (fm.compatibility && fm.compatibility.length > XIERONG_ZUI_CHANG) problems.push(`compatibility 超过 ${XIERONG_ZUI_CHANG} 字符`);

  return {
    ok: true,
    valid: problems.length === 0,
    frontmatter: fm,
    body,
    bodyChars: body.length,
    resources: { scripts: [], references: [], assets: [] },
    problems,
  };
}

/** 读一个技能目录（SKILL.md + 资源清单） */
export function duSkillMuLu(dir: string): (SkillJieGuo & { dir: string; dirName: string }) | null {
  const sk = path.join(dir, 'SKILL.md');
  try {
    if (!fs.existsSync(sk)) return null;
    const jie = jieXiSkillMd(fs.readFileSync(sk, 'utf8'));
    for (const [key, sub] of [['scripts', 'scripts'], ['references', 'references'], ['assets', 'assets']] as const) {
      const p = path.join(dir, sub);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          jie.resources[key] = fs.readdirSync(p).slice(0, 50);
        }
      } catch { /* 单个资源目录读不到不影响技能本身 */ }
    }
    return { ...jie, dir, dirName: path.basename(dir) };
  } catch {
    return null;
  }
}

/** 渐进披露第 1 层：一行式摘要（给模型挑技能用；**大约 100 token**） */
export function zhaiYao(s: { frontmatter: SkillFrontmatter; dirName: string; resources?: SkillJieGuo['resources'] }): string {
  const ming = s.frontmatter.name || s.dirName;
  const shuo = s.frontmatter.description || '（没有 description：这份技能不符合规范，别乱装）';
  const zi = s.resources && (s.resources.scripts.length || s.resources.references.length || s.resources.assets.length)
    ? ` [附带 ${s.resources.scripts.length} 脚本/${s.resources.references.length} 参考/${s.resources.assets.length} 资源]` : '';
  return `${ming} :: ${shuo}${zi}`;
}

/** 渐进披露第 2 层：选中技能后给模型读的正文（超长则截断并如实说明） */
export function zhengWen(s: SkillJieGuo & { dir?: string }, maxChars = 12000): string {
  const head = s.frontmatter.name ? `# ${s.frontmatter.name}\n` : '';
  const body = s.body.length > maxChars ? s.body.slice(0, maxChars) + `\n…（正文共 ${s.bodyChars} 字符，已截断）` : s.body;
  const res: string[] = [];
  if (s.resources.scripts.length) res.push(`scripts/：${s.resources.scripts.join(' ')}`);
  if (s.resources.references.length) res.push(`references/：${s.resources.references.join(' ')}`);
  if (s.resources.assets.length) res.push(`assets/：${s.resources.assets.join(' ')}`);
  return head + body + (res.length ? `\n\n（按需读取：${res.join('；')}）` : '');
}

/** 扫描若干根目录下的技能（一层目录 + 一层子目录，够覆盖常见布局） */
export function saoMiaoJiNeng(roots: string[], maxPerRoot = 200): Array<ReturnType<typeof duSkillMuLu>> {
  const out: Array<ReturnType<typeof duSkillMuLu>> = [];
  const kan = (dir: string, ceng: number) => {
    if (ceng > 3) return;
    let ems: string[] = [];
    try { ems = fs.readdirSync(dir); } catch { return; }
    for (const e of ems.slice(0, maxPerRoot)) {
      const p = path.join(dir, e);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (fs.existsSync(path.join(p, 'SKILL.md'))) {
        const jie = duSkillMuLu(p);
        if (jie) out.push(jie);
      } else kan(p, ceng + 1);
    }
  };
  for (const r of roots) { try { kan(r, 0); } catch { /* 单个根目录不可读不影响其它 */ } }
  return out.filter(Boolean);
}

/** 关键词打分（name 权重更高）—— 让 find_skill 真的"按能力找"而不是按前 3 行撞运气 */
export function jiNengDaFen(s: { frontmatter: SkillFrontmatter; dirName: string; body: string }, q: string): number {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return 1;
  const ming = (s.frontmatter.name || s.dirName).toLowerCase();
  const miao = (s.frontmatter.description || '').toLowerCase();
  const wen = (s.body || '').toLowerCase();
  let fen = 0;
  for (const ci of k.split(/\s+/).filter(Boolean)) {
    if (ming.includes(ci)) fen += 10;
    if (miao.includes(ci)) fen += 5;
    if (wen.includes(ci)) fen += 1;
  }
  return fen;
}
