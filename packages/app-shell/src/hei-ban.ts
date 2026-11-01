/**
 * 任务级共享黑板（ADR000 P5「SharedContext」· 契约 v1.1 第 13 份 `HeiBanTiao`）
 *
 * 要解决的真问题：同一个任务派给多个执行者时，它们**并行**跑、彼此看不见 ——
 * A 写了什么文件、定了什么，B 不知道 ⇒ 重复干活、或者给同一个东西做出互相矛盾的决定
 * （Cognition《Don't Build Multi-Agents》：动作携带隐含决策，决策冲突出坏结果）。
 *
 * 设计口径（每条都有出处，见 docs/HANDOFF-R44.md §17.1）：
 *  · **只追加**：改口不改旧条目，新写一条并用 `tiDai` 声明替代哪条（LangGraph 的追加型 reducer）；
 *  · **来源宿主盖章**：条目来源由宿主按"是哪个执行者的会话在调这个工具"写入，参数里自报的身份一律不认
 *    （MetaGPT 的 `sent_from` 由发布者自填、不防伪，是反面例子）；
 *  · **每条带真 recordId**：写进记忆库（kind:'blackboard'）成功才算落盘，只有落盘的条目才给 retrieve 指针；
 *  · **O(任务规模)**：进执行者上下文的只是有界摘要（≤ HEI_BAN_ZHAI_YAO_ZI 字，按"冲突 > 未决 > 决定 > 产物 > 事实"
 *    的优先级取最近几条）+ 可执行指针，黑板再大摘要也不变长（Anthropic：子代理结果存外部、只回轻量引用）；
 *  · **冲突交值班者裁决**：同一主题、不同执行者、说法不同 ⇒ 列为冲突，写进回复让人看见（不替人选）。
 *
 * 本模块是纯逻辑（不读盘、不调模型），持久化由调用方注入 `HeiBanCunChu`，门禁可直接 import 跑真值表。
 */
import type { HeiBanTiao, HeiBanLei, HeiBanLaiYuan } from '@warmy/contracts';
import type { GongJuGuiGe } from '@warmy/providers';

/** 单条正文上限：黑板放的是结论性的短条目，长内容写文件、黑板里记产物路径 */
export const HEI_BAN_DAN_TIAO_ZI = 600;
export const HEI_BAN_ZHU_TI_ZI = 40;
/** 每个任务最多条目数（防止一个执行者刷屏把黑板变成第二份聊天记录） */
export const HEI_BAN_MEI_REN_WU_TIAO = 200;
/** 进执行者上下文的摘要上限（字符）：远小于 Anthropic 建议的 ≤2k token 级别 */
export const HEI_BAN_ZHAI_YAO_ZI = 2400;
/** heiban_read 一次返回的上限（字符） */
export const HEI_BAN_DU_ZI = 4000;

const LEI_JI: readonly HeiBanLei[] = ['fact', 'decision', 'artifact', 'question', 'answer'];
const LEI_MING: Record<HeiBanLei, string> = { fact: '事实', decision: '决定', artifact: '产物', question: '未决问题', answer: '回答' };

/** 执行者调 heiban_write 时能给的参数（**不含来源**：来源只由宿主传） */
export interface HeiBanShuRu {
  lei?: unknown;
  nei?: unknown;
  zhuTi?: unknown;
  luJing?: unknown;
  guanLian?: unknown;
  tiDai?: unknown;
}

/** 持久化适配：宿主实现（写记忆库）。返回 true = 真的写进去了（之后才给 retrieve 指针） */
export interface HeiBanCunChu {
  xie(t: HeiBanTiao): Promise<boolean> | boolean;
}

function wen(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 主题归一：去空白与常见标点、转小写（"输出 文件名" 与 "输出文件名：" 是同一个主题） */
export function guiYiZhuTi(s: unknown): string {
  return wen(s).toLowerCase().replace(/[\s，,。.:：;；、!！?？"'“”‘’()（）[\]【】]/g, '').slice(0, HEI_BAN_ZHU_TI_ZI);
}

function guiYiNei(s: unknown): string {
  return wen(s).toLowerCase().replace(/\s+/g, '').replace(/[，,。.!！?？;；：:]+$/g, '');
}

function guiYiLuJing(s: unknown): string {
  return wen(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 校验一条输入；返回空串 = 通过，否则是**给执行者看的**拒收原因（它据此改参数重发）。
 * `yiYou` 是当前任务已有条目（判 answer/tiDai 引用的 id 是否存在、条目数是否超限）。
 */
export function xiaoYanShuRu(shuRu: HeiBanShuRu, yiYou: readonly HeiBanTiao[]): string {
  const lei = wen(shuRu.lei) as HeiBanLei;
  if (!LEI_JI.includes(lei)) return `lei 只能是 ${LEI_JI.join(' / ')} 之一`;
  const nei = wen(shuRu.nei);
  if (!nei) return 'nei（内容）不能为空';
  if (nei.length > HEI_BAN_DAN_TIAO_ZI) return `nei 超过 ${HEI_BAN_DAN_TIAO_ZI} 字：黑板只放结论性的短条目——长内容写进文件，再用 lei=artifact 记下文件路径`;
  if (lei === 'decision' && !guiYiZhuTi(shuRu.zhuTi)) return 'lei=decision 必须带 zhuTi（这条决定是关于什么的，例如「输出文件名」）：冲突检测靠它';
  if (lei === 'artifact' && !wen(shuRu.luJing)) return 'lei=artifact 必须带 luJing（产物的绝对路径）';
  if (lei === 'answer') {
    const q = wen(shuRu.guanLian);
    if (!q) return 'lei=answer 必须带 guanLian（回答的是哪条 question 的 id）';
    if (!yiYou.some((t) => t.id === q && t.lei === 'question')) return `guanLian=${q} 不是本任务里已有的 question`;
  }
  const td = wen(shuRu.tiDai);
  if (td && !yiYou.some((t) => t.id === td)) return `tiDai=${td} 不是本任务里已有的条目 id（只追加：改口要指明替代哪条已有的）`;
  if (yiYou.length >= HEI_BAN_MEI_REN_WU_TIAO) return `本任务黑板已有 ${yiYou.length} 条，到上限了：只写最关键的结论，别把过程记上来`;
  return '';
}

/** 被替代掉的条目 id 集合（只追加：旧条目还在，只是不再"有效"） */
function beiTiDai(tiao: readonly HeiBanTiao[]): Set<string> {
  return new Set(tiao.map((t) => wen(t.tiDai)).filter(Boolean));
}

/** 当前仍然有效的条目（没被替代；同一来源对同一主题的决定只认最新一条） */
export function youXiaoTiao(tiao: readonly HeiBanTiao[]): HeiBanTiao[] {
  const tiDai = beiTiDai(tiao);
  const zuiXinJueDing = new Map<string, string>();
  for (const t of tiao) {
    if (t.lei === 'decision' && !tiDai.has(t.id)) zuiXinJueDing.set(`${t.laiYuan.id}|${guiYiZhuTi(t.zhuTi)}`, t.id);
  }
  return tiao.filter((t) => {
    if (tiDai.has(t.id)) return false;
    if (t.lei === 'decision') return zuiXinJueDing.get(`${t.laiYuan.id}|${guiYiZhuTi(t.zhuTi)}`) === t.id;
    return true;
  });
}

export interface HeiBanChongTu {
  zhuTi: string;
  ge: Array<{ id: string; ming: string; nei: string }>;
}

/** 冲突：同一主题、**不同来源**、有效决定的内容不同（同一来源改主意不算冲突，最新一条为准） */
export function heiBanChongTu(tiao: readonly HeiBanTiao[]): HeiBanChongTu[] {
  const zu = new Map<string, HeiBanTiao[]>();
  for (const t of youXiaoTiao(tiao)) {
    if (t.lei !== 'decision') continue;
    const k = guiYiZhuTi(t.zhuTi);
    if (!k) continue;
    const lie = zu.get(k);
    if (lie) lie.push(t); else zu.set(k, [t]);
  }
  const chu: HeiBanChongTu[] = [];
  for (const lie of zu.values()) {
    const laiYuan = new Set(lie.map((t) => t.laiYuan.id));
    const neiJi = new Set(lie.map((t) => guiYiNei(t.nei)));
    if (laiYuan.size >= 2 && neiJi.size >= 2) {
      chu.push({ zhuTi: wen(lie[0]!.zhuTi), ge: lie.map((t) => ({ id: t.id, ming: t.laiYuan.ming, nei: t.nei })) });
    }
  }
  return chu;
}

/** 同一产物被多个来源写过（可能互相覆盖）——不判对错，只提醒 */
export function chanWuChongDie(tiao: readonly HeiBanTiao[]): Array<{ luJing: string; ming: string[] }> {
  const zu = new Map<string, { luJing: string; ming: Set<string> }>();
  for (const t of youXiaoTiao(tiao)) {
    if (t.lei !== 'artifact' || !t.luJing) continue;
    const k = guiYiLuJing(t.luJing);
    const x = zu.get(k) || { luJing: t.luJing, ming: new Set<string>() };
    x.ming.add(t.laiYuan.ming);
    zu.set(k, x);
  }
  return [...zu.values()].filter((x) => x.ming.size >= 2).map((x) => ({ luJing: x.luJing, ming: [...x.ming] }));
}

/** 还没有回答的问题 */
export function weiJieWenTi(tiao: readonly HeiBanTiao[]): HeiBanTiao[] {
  const yiDa = new Set(tiao.filter((t) => t.lei === 'answer').map((t) => wen(t.guanLian)));
  return youXiaoTiao(tiao).filter((t) => t.lei === 'question' && !yiDa.has(t.id));
}

function jian(s: string, n: number): string {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n) + '…' : x;
}

function hangOf(t: HeiBanTiao): string {
  const tou = t.lei === 'decision' && t.zhuTi ? `${jian(t.zhuTi, 24)}：` : '';
  const lu = t.lei === 'artifact' && t.luJing ? `${t.luJing}${t.nei && t.nei !== t.luJing ? '（' + jian(t.nei, 60) + '）' : ''}` : jian(t.nei, 120);
  const zhi = t.yiLuoPan ? ` · ${t.id}` : '';
  return `· [${LEI_MING[t.lei]}] ${tou}${lu}（${t.laiYuan.ming}${zhi}）`;
}

/**
 * 进执行者上下文的**有界摘要**（O(任务规模)：黑板再大，这段也不超过 zongZi）。
 * 优先级：冲突 > 未决问题 > 决定 > 产物 > 事实；每类只取最近几条，装不下的条数如实写出来并给取回路径。
 * 只有已落盘的条目才带 recordId（没落盘的给了 id 也取不回，宁缺不假）。
 */
export function heiBanZhaiYao(tiao: readonly HeiBanTiao[], renWuId: string, zongZi = HEI_BAN_ZHAI_YAO_ZI): string {
  const you = youXiaoTiao(tiao);
  if (!you.length) return '';
  const ji = (l: HeiBanLei) => you.filter((t) => t.lei === l).length;
  const tou = `【任务黑板 · ${renWuId}】共 ${you.length} 条有效（决定 ${ji('decision')} · 产物 ${ji('artifact')} · 事实 ${ji('fact')} · 未决 ${weiJieWenTi(tiao).length}）`;
  /** 冲突行不是条目：分开记，"另有几条没列出"只按条目算（否则冲突越多，漏报的条数越多） */
  const chongTuHang: string[] = [];
  for (const c of heiBanChongTu(tiao).slice(0, 3)) {
    chongTuHang.push(`⚠ 冲突「${jian(c.zhuTi, 24)}」：` + c.ge.map((g) => `${g.ming}：${jian(g.nei, 60)}`).join(' ／ '));
  }
  const tiaoHang: string[] = [];
  const zuiJin = (l: HeiBanLei, n: number) => you.filter((t) => t.lei === l).slice(-n).reverse();
  for (const t of weiJieWenTi(tiao).slice(-4).reverse()) tiaoHang.push(hangOf(t));
  for (const t of zuiJin('decision', 5)) tiaoHang.push(hangOf(t));
  for (const t of zuiJin('artifact', 5)) tiaoHang.push(hangOf(t));
  for (const t of zuiJin('fact', 5)) tiaoHang.push(hangOf(t));
  const wei = '（完整黑板：heiban_read；已落盘的单条原文：retrieve(recordId="…")）';
  const chu: string[] = [tou];
  let yong = tou.length + wei.length + 40;
  let lieChuTiao = 0;
  const hang = [...chongTuHang, ...tiaoHang];
  for (let i = 0; i < hang.length; i++) {
    const h = hang[i]!;
    if (yong + h.length + 1 > zongZi) break;
    chu.push(h);
    yong += h.length + 1;
    if (i >= chongTuHang.length) lieChuTiao++;
  }
  const meiLie = you.length - lieChuTiao;
  if (meiLie > 0) chu.push(`（另有 ${meiLie} 条没列出：用 heiban_read 取，不要凭印象猜）`);
  chu.push(wei);
  return chu.join('\n');
}

/** heiban_read 工具的返回（有界、最新在前、带 id） */
export function heiBanDuChu(tiao: readonly HeiBanTiao[], canShu: { lei?: unknown; limit?: unknown } | null | undefined, renWuId: string): string {
  const lei = wen(canShu?.lei) as HeiBanLei;
  const n = Math.min(50, Math.max(1, Math.floor(Number(canShu?.limit) || 20)));
  const you = youXiaoTiao(tiao).filter((t) => !LEI_JI.includes(lei) || t.lei === lei);
  if (!you.length) return `[heiban_read] 任务 ${renWuId} 的黑板上${LEI_JI.includes(lei) ? `还没有「${LEI_MING[lei]}」` : '还没有任何条目'}。`;
  const chu: string[] = [`[heiban_read] 任务 ${renWuId}：有效 ${you.length} 条，最新在前（最多 ${n} 条）`];
  let yong = chu[0]!.length;
  for (const t of you.slice(-n).reverse()) {
    const h = `${t.id} ${hangOf(t)}${t.tiDai ? `（替代 ${t.tiDai}）` : ''}`;
    if (yong + h.length + 1 > HEI_BAN_DU_ZI) { chu.push('…（到读取上限了：缩小 lei 或 limit 再读）'); break; }
    chu.push(h);
    yong += h.length + 1;
  }
  const ct = heiBanChongTu(tiao);
  if (ct.length) chu.push(`⚠ 当前有 ${ct.length} 处决定冲突（同一主题、不同执行者、说法不同）：别各做各的，先在黑板上写清楚、或交给值班者定`);
  return chu.join('\n');
}

/** 写进记忆库的正文（FTS 友好：带任务号、种类、主题、路径、来源，recall("任务号") 就能找回整块黑板） */
export function heiBanJiLuWen(t: HeiBanTiao): string {
  return `〔任务黑板 ${t.renWuId} · ${LEI_MING[t.lei]}〕${t.zhuTi ? t.zhuTi + '：' : ''}${t.nei}${t.luJing ? ' · 路径 ' + t.luJing : ''}${t.tiDai ? ' · 替代 ' + t.tiDai : ''} · 来源 ${t.laiYuan.ming}`;
}

/**
 * 一个任务的黑板（只追加）。来源由调用方（宿主）在 `xie` 时传入 —— 工具处理器按"哪个执行者在调"绑定，
 * 执行者自己没有任何途径改写来源。
 */
export class RenWuHeiBan {
  private tiao: HeiBanTiao[] = [];
  private xu = 0;
  constructor(
    readonly renWuId: string,
    readonly groupId: string,
    private readonly cun?: HeiBanCunChu,
    private readonly shiZhong: () => number = () => Date.now(),
  ) {}

  lie(): readonly HeiBanTiao[] {
    return this.tiao;
  }

  /** 只追加写一条；通过校验才写，写记忆库成功才标 yiLuoPan */
  async xie(shuRu: HeiBanShuRu, laiYuan: HeiBanLaiYuan): Promise<{ ok: true; tiao: HeiBanTiao } | { ok: false; cuo: string }> {
    const cuo = xiaoYanShuRu(shuRu, this.tiao);
    if (cuo) return { ok: false, cuo };
    this.xu += 1;
    const lei = wen(shuRu.lei) as HeiBanLei;
    const t: HeiBanTiao = {
      id: `hb-${this.renWuId}-${this.xu}`,
      renWuId: this.renWuId,
      groupId: this.groupId,
      lei,
      nei: wen(shuRu.nei),
      ...(lei === 'decision' ? { zhuTi: wen(shuRu.zhuTi).slice(0, HEI_BAN_ZHU_TI_ZI) } : {}),
      ...(wen(shuRu.luJing) ? { luJing: wen(shuRu.luJing) } : {}),
      ...(wen(shuRu.guanLian) ? { guanLian: wen(shuRu.guanLian) } : {}),
      ...(wen(shuRu.tiDai) ? { tiDai: wen(shuRu.tiDai) } : {}),
      laiYuan: { id: String(laiYuan.id || ''), ming: String(laiYuan.ming || laiYuan.id || ''), jueSe: laiYuan.jueSe },
      ts: this.shiZhong(),
      yiLuoPan: false,
    };
    this.tiao.push(t);
    if (this.cun) {
      try { t.yiLuoPan = (await this.cun.xie(t)) === true; } catch { t.yiLuoPan = false; }
    }
    return { ok: true, tiao: t };
  }

  /** 宿主补记：执行者交付里的事实/决定/产物/问题，它自己没往黑板写的，由宿主按它的名义补上（去重） */
  async buJi(shuRu: HeiBanShuRu, laiYuan: HeiBanLaiYuan): Promise<boolean> {
    const lei = wen(shuRu.lei);
    const yiYou = this.tiao.some((t) => t.lei === lei && t.laiYuan.id === laiYuan.id && (
      lei === 'artifact' ? guiYiLuJing(t.luJing) === guiYiLuJing(shuRu.luJing)
        : guiYiNei(t.nei) === guiYiNei(shuRu.nei) && (lei !== 'decision' || guiYiZhuTi(t.zhuTi) === guiYiZhuTi(shuRu.zhuTi))));
    if (yiYou) return false;
    const r = await this.xie(shuRu, laiYuan);
    return r.ok;
  }
}

/** 给执行者的两件工具（来源不在参数里：宿主按调用者绑定） */
export function heiBanGongJu(): GongJuGuiGe[] {
  return [
    {
      type: 'function',
      function: {
        name: 'heiban_write',
        description: '把本任务里的**事实 / 决定 / 产物 / 未决问题 / 回答**写到共享黑板：同一任务的其他执行者马上能看到，避免重复干活或各做各的。'
          + '只追加：改口就新写一条并用 tiDai 指明替代哪条。decision 必须带 zhuTi（主题，冲突检测靠它）；artifact 必须带 luJing（绝对路径）；answer 必须带 guanLian（问题的 id）。只写结论，不写过程。',
        parameters: {
          type: 'object',
          properties: {
            lei: { type: 'string', enum: ['fact', 'decision', 'artifact', 'question', 'answer'], description: '条目种类' },
            nei: { type: 'string', description: `内容（≤${HEI_BAN_DAN_TIAO_ZI} 字）` },
            zhuTi: { type: 'string', description: 'decision 的主题（例：输出文件名、采用的方案）' },
            luJing: { type: 'string', description: 'artifact 的绝对路径' },
            guanLian: { type: 'string', description: 'answer 回答的 question 的 id' },
            tiDai: { type: 'string', description: '这条替代哪条已有条目的 id（改口时用）' },
          },
          required: ['lei', 'nei'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'heiban_read',
        description: '读本任务共享黑板上的有效条目（最新在前，带 id）：开始干活前先看别人已经做了什么、定了什么，有冲突要先说清楚。',
        parameters: {
          type: 'object',
          properties: {
            lei: { type: 'string', enum: ['fact', 'decision', 'artifact', 'question', 'answer'], description: '只看某一种（可省）' },
            limit: { type: 'number', description: '最多几条（默认 20，上限 50）' },
          },
          required: [],
        },
      },
    },
  ];
}

export const HEI_BAN_GONG_JU_MING = new Set(['heiban_write', 'heiban_read']);
