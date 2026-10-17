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
 * 解析部分是纯函数、零第三方依赖（自己写 YAML 子集解析，不引 yaml 包）—— 门禁可无头断言。
 * 唯一的副作用在**依赖探测**（`chaYiLaiQueShao`）：会 `where/which` 起一个子进程查 PATH，
 * 带 TTL 缓存且不解析输出（本地路径不进日志）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  /** 社区常用写法：`requires: git, jq`（也可能是解析后落到 extra 里） */
  requires?: string | string[];
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

/* ══════════════════════════════════════════════════════════════
 * 依赖门控（requires）+ 大目录检索索引 —— 第 27 轮 项 4
 *
 * 官方口径（不是推断）：Agent Skills 规范把前置条件写在 `compatibility`
 * （官方例子原文 "Requires git, docker, jq, and access to the internet"）；
 * 《How to add skills support》的 Filtering 一节要求
 * **"Hide filtered skills entirely from the catalog rather than listing them and
 * blocking at activation time"** —— 依赖不满足就**整条从给模型的目录里藏掉**，
 * 不是"列出来再在激活时拒绝"。`fenLanJiNeng` 就是这条的实现。
 * 检索接口官方**没有**规定形态（调研结论"未找到权威来源"），下面这套倒排索引是本工程的实现。
 * ══════════════════════════════════════════════════════════════ */

export interface JinengYiLai {
  /** 需要能在 PATH 里找到的命令（git / docker / jq / python…） */
  mingLing: string[];
  /** 需要的环境变量 */
  huanJingBianLiang: string[];
  /** 限定的操作系统（win32 / linux / darwin） */
  caozuoXiTong: string[];
  /** 声明里是否要求联网（只做文案，不主动外连探测） */
  xuYaoWangLuo: boolean;
  /** 原始声明文本（UI 要原样给人看） */
  yuanWen: string;
}

const YI_LAI_GUO_LV = new Set(['requires', 'require', 'and', 'the', 'access', 'internet', 'to', 'of', 'with', 'for', '需要', '以及', '和']);

/** 从 frontmatter 解析依赖：`compatibility` 为主，`metadata.requires` / `requires-bins` 为辅 */
export function jieXiYiLai(fm: SkillFrontmatter): JinengYiLai {
  const yuan = String(fm.compatibility || '').slice(0, 500);
  const fu = String((fm.metadata && (fm.metadata.requires || fm.metadata['requires-bins'])) || '').slice(0, 300);
  /** 显式 `requires:` 字段（社区常见写法；未识别的 frontmatter 键会进 extra）—— 直接当清单解析，不再猜句式 */
  const xian = Array.isArray((fm as { requires?: unknown }).requires)
    ? (fm as unknown as { requires: string[] }).requires.join(', ')
    : String((fm as { requires?: unknown }).requires || fm.extra?.requires || fm.extra?.['requires-bins'] || '').slice(0, 300);
  const quan = `${yuan} ; ${fu}${xian ? ' ; requires ' + xian : ''}`;
  const xiaoXie = quan.toLowerCase();
  const qingXi = (zheng: string) => zheng
    .split(/[,，、;；\s]+/)
    .map((x) => x.replace(/[^a-z0-9_.+-]/gi, ''))
    .filter((x) => x.length >= 2 && !YI_LAI_GUO_LV.has(x.toLowerCase()));
  const mingLing: string[] = [];
  for (const ju of quan.split(/[;；\n]+/)) {
    const miao = String(ju || '').trim();
    if (!miao) continue;
    /** "Requires git, docker, jq" 这种句式优先；没有句式但像逗号清单的（短、多逗号）也认 */
    const yi = /requires?\s+(.+)/i.exec(miao);
    const cai = yi ? yi[1] : (miao.length < 200 && miao.split(/[,，]/).length >= 2 ? miao : '');
    if (!cai) continue;
    for (const dan of qingXi(cai)) {
      if (/internet|network|网络/.test(dan)) continue;
      if (!mingLing.includes(dan)) mingLing.push(dan);
    }
    break;
  }
  const huanJingBianLiang = [...new Set((quan.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []).filter((x) => !['AND', 'THE', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'SKILL', 'CLI', 'PATH', 'OSS'].includes(x)))];
  const caozuoXiTong: string[] = [];
  if (/windows|win32/.test(xiaoXie)) caozuoXiTong.push('win32');
  if (/\blinux\b|ubuntu|debian/.test(xiaoXie)) caozuoXiTong.push('linux');
  if (/macos|darwin|osx/.test(xiaoXie)) caozuoXiTong.push('darwin');
  return {
    mingLing: mingLing.slice(0, 12),
    huanJingBianLiang: huanJingBianLiang.slice(0, 8),
    caozuoXiTong,
    xuYaoWangLuo: /internet|network|联网|网络/.test(xiaoXie),
    yuanWen: yuan || fu,
  };
}

/** 命令在不在 PATH（只看退出码，不解析输出 ⇒ 本地路径不进任何日志）。带 TTL 缓存，避免每次刷新技能列表都 spawn。 */
const mingLingManCun = new Map<string, { ok: boolean; at: number }>();
const MING_LING_TTL_MS = 10 * 60 * 1000;
function mingLingZai(ming: string): boolean {
  const xian = mingLingManCun.get(ming);
  if (xian && Date.now() - xian.at < MING_LING_TTL_MS) return xian.ok;
  let ok = false;
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [ming], {
      encoding: 'utf8', timeout: 2500, windowsHide: true,
    });
    ok = !!r && r.status === 0;
  } catch { ok = false; }
  mingLingManCun.set(ming, { ok, at: Date.now() });
  return ok;
}
/** 依赖探测结果里"缺什么"（空数组 = 满足） */
export interface JinengQueShao {
  mingLing: string[];
  huanJing: string[];
  caozuoXiTong: string[];
}

export function chaYiLaiQueShao(y: JinengYiLai): JinengQueShao {
  const que: JinengQueShao = { mingLing: [], huanJing: [], caozuoXiTong: [] };
  for (const m of y.mingLing) if (!mingLingZai(m)) que.mingLing.push(m);
  for (const h of y.huanJingBianLiang) if (!process.env[h]) que.huanJing.push(h);
  if (y.caozuoXiTong.length && !y.caozuoXiTong.includes(process.platform)) que.caozuoXiTong.push(y.caozuoXiTong.join('/'));
  return que;
}

export function queShaoShuoMing(que: JinengQueShao): string {
  const bu: string[] = [];
  if (que.mingLing.length) bu.push(`缺命令 ${que.mingLing.join(' / ')}`);
  if (que.huanJing.length) bu.push(`缺环境变量 ${que.huanJing.join(' / ')}`);
  if (que.caozuoXiTong.length) bu.push(`只在 ${que.caozuoXiTong.join(' / ')} 可用（本机是 ${process.platform}）`);
  return bu.join('；');
}

export function qingKongYiLaiManCun(): void { mingLingManCun.clear(); }

/**
 * 分栏：**给模型的目录**只留可用的；**给界面的全量视图**保留全部与"为什么不能用"。
 * （官方 Filtering 口径：给模型的整条藏掉；对用户则要能解释"我装的技能去哪了"。）
 */
export function fenLanJiNeng(quan: Array<SkillJieGuo & { dir: string; dirName: string }>): {
  quanBu: Array<{ s: SkillJieGuo & { dir: string; dirName: string }; shiYong: boolean; yuanYin: string }>;
  geiMoXing: Array<SkillJieGuo & { dir: string; dirName: string }>;
} {
  const quanBu = quan.map((s) => {
    if (!s.valid) return { s, shiYong: false, yuanYin: 'SKILL.md 不合规范（name/description 缺失或格式不对）' };
    const que = queShaoShuoMing(chaYiLaiQueShao(jieXiYiLai(s.frontmatter)));
    return que ? { s, shiYong: false, yuanYin: que } : { s, shiYong: true, yuanYin: '' };
  });
  return { quanBu, geiMoXing: quanBu.filter((x) => x.shiYong).map((x) => x.s) };
}

/** 索引条目（第 1 层信息：名称 + 用途 + 位置；正文按需再读） */
export interface JinengSuoXiangMu {
  dir: string;
  dirName: string;
  name: string;
  description: string;
  ziShu: number;
  zhaiYao: string;
  valid: boolean;
  shiYong: boolean;
  yuanYin: string;
}

export interface JinengSuo {
  qianMing: string;
  xiang: JinengSuoXiangMu[];
  daoPai: Map<string, Set<number>>;
  saoMiaoShu: number;
  buHeGuiShu: number;
}

let jiNengSuo: JinengSuo | null = null;
const TING_ZI_MU = new Set(['.git', 'node_modules', '.pnpm', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache']);

function genQianMing(roots: string[]): string {
  const bu: string[] = [];
  for (const r of roots) {
    let shu = -1;
    let mt = 0;
    try {
      mt = Math.round(fs.statSync(r).mtimeMs);
      shu = fs.readdirSync(r).length;
    } catch { /* 不存在的根也进签名：从无到有必须重建 */ }
    bu.push(`${r}|${shu}|${mt}`);
  }
  return bu.join('||');
}

function shouJiJiNeng(roots: string[], shangXian = 2000): Array<SkillJieGuo & { dir: string; dirName: string }> {
  const out: Array<SkillJieGuo & { dir: string; dirName: string }> = [];
  const kan = (dir: string, ceng: number) => {
    if (ceng > 5 || out.length >= shangXian) return;
    let ems: string[] = [];
    try { ems = fs.readdirSync(dir); } catch { return; }
    for (const e of ems) {
      if (out.length >= shangXian) return;
      if (TING_ZI_MU.has(e) || e.startsWith('.')) continue;
      const p = path.join(dir, e);
      try {
        if (!fs.statSync(p).isDirectory()) continue;
      } catch { continue; }
      if (fs.existsSync(path.join(p, 'SKILL.md'))) {
        const jie = duSkillMuLu(p);
        // 技能包内部不再往下钻：scripts/ 里不会有第二个技能
        if (jie) out.push(jie);
        continue;
      }
      kan(p, ceng + 1);
    }
  };
  for (const r of roots) { try { kan(r, 0); } catch { /* 单根不可读不影响其它根 */ } }
  return out;
}

/**
 * 建/取技能索引：**签名一致就直接复用，不再走盘**。
 * 以前 `find_skill` 每次调用都 `saoMiaoJiNeng` 全量读目录 + 读每个 SKILL.md，
 * 用户技能目录一大（几百个包）就是几十秒级的卡顿源。
 */
export function jiNengSuoYin(roots: string[], qiangZhiChongJian = false): JinengSuo {
  const qianMing = genQianMing(roots);
  if (!qiangZhiChongJian && jiNengSuo && jiNengSuo.qianMing === qianMing) return jiNengSuo;
  const quan = shouJiJiNeng(roots);
  const fen = fenLanJiNeng(quan);
  const xiang: JinengSuoXiangMu[] = [];
  const daoPai = new Map<string, Set<number>>();
  for (const x of fen.quanBu) {
    const i = xiang.length;
    xiang.push({
      dir: x.s.dir, dirName: x.s.dirName,
      name: x.s.frontmatter.name || x.s.dirName,
      description: String(x.s.frontmatter.description || '').slice(0, 300),
      ziShu: (x.s.body || '').length,
      zhaiYao: zhaiYao(x.s),
      valid: x.s.valid, shiYong: x.shiYong, yuanYin: x.yuanYin,
    });
    const wen = `${x.s.frontmatter.name || x.s.dirName} ${x.s.frontmatter.description || ''} ${(x.s.body || '').slice(0, 4000)}`.toLowerCase();
    for (const ci of new Set(wen.split(/[^a-z0-9_\u4e00-\u9fff-]+/).filter((c) => c.length >= 2))) {
      const ji = daoPai.get(ci) || new Set<number>();
      ji.add(i);
      daoPai.set(ci, ji);
    }
  }
  jiNengSuo = { qianMing, xiang, daoPai, saoMiaoShu: quan.length, buHeGuiShu: quan.filter((s) => !s.valid).length };
  return jiNengSuo;
}

export function qingKongJiNengSuoYin(): void { jiNengSuo = null; }

/** 在索引里检索（不走盘）。依赖不满足的一律不进结果（与给模型的目录同一把尺子）。 */
export function souSuoJiNeng(s: JinengSuo, query: string, zuiDuo = 20): Array<{ xiang: JinengSuoXiangMu; fen: number; mingZhong: string[] }> {
  if (!query) return s.xiang.filter((x) => x.shiYong).slice(0, zuiDuo).map((x) => ({ xiang: x, fen: 1, mingZhong: [] }));
  const ciList = String(query).toLowerCase().split(/[^a-z0-9_\u4e00-\u9fff-]+/).filter((x) => x.length >= 2);
  const de = new Map<number, { fen: number; ci: string[] }>();
  for (const c of ciList) {
    for (const [key, ji] of s.daoPai) {
      if (key !== c && !key.includes(c)) continue;
      for (const i of ji) {
        const duo = s.xiang[i];
        if (!duo || !duo.shiYong) continue;
        const yi = de.get(i) || { fen: 0, ci: [] };
        yi.fen += (key === c ? 3 : 1) * (duo.name.toLowerCase().includes(c) ? 10 : duo.description.toLowerCase().includes(c) ? 5 : 1);
        if (!yi.ci.includes(c)) yi.ci.push(c);
        de.set(i, yi);
      }
    }
  }
  return [...de.entries()]
    .map(([i, x]) => ({ xiang: s.xiang[i]!, fen: x.fen, mingZhong: x.ci }))
    .sort((a, b) => b.fen - a.fen || a.xiang.name.localeCompare(b.xiang.name))
    .slice(0, zuiDuo);
}
