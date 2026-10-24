/**
 * 真正的"蒸馏返回"（ADR000 P5 · 契约 v1.1 `GongzuozheJieguo`）——纯函数，门禁直接跑真值表。
 *
 * 修之前：执行者的"蒸馏结论"= 模型最后一段正文原样（executor.ts 旧第 151 行），字数要求只写在提示词里
 * （≤300/≤200 字），唯一真实上限是 maxTokens（有工具时默认 4096 token，能写几千字）；
 * 多执行者时整段拼起来再从尾部一刀截到 3000 字，排后面的结论整段消失，截断提示还写着
 * "完整结论在各自的操作记录里"——而完整结论哪里都没存（指向不存在的地方）。
 *
 * 现在的口径（出处见 docs/HANDOFF-R44.md §17.1）：
 *  1. **结构化交付优先走工具**：`jiao_fu` 用 JSON schema 约束字段（OpenAI/Anthropic 文档都指出：
 *     schema 约束的工具参数比"在正文里写 JSON"可靠）；没调工具就找正文里的 ```json 块；都没有才按正文兜底。
 *  2. **硬上限**：结论 ≤300 字（有工具）/≤200 字（无工具）；事实/决定/问题/产物各有条数与单条上限。
 *  3. **超长不截丢**：结论超限 ⇒ 完整原文存进记忆库（kind:'worker'），结论里放可执行的 retrieve 指针；
 *     **存成功才给指针**，存不上就如实说"本次未能存档"。
 *  4. **产物宿主核实**：它说产出的每个文件，宿主逐个查是否真的存在；不存在的进 `unverifiedArtifacts`，
 *     在回复里点名（口头执行看得见）。
 *  5. **公平配额**：一轮里 N 个执行者平分回复份额（每人不少于 MEI_REN_ZUI_SHAO），不再先到先得。
 */
import type { GongzuozheJieguo, ZhengLiuJueDing, GuileiCuowu } from '@warmy/contracts';
import type { GongJuGuiGe } from '@warmy/providers';

export const JIE_LUN_YOU_GONG_JU = 300;
export const JIE_LUN_WU_GONG_JU = 200;
/** 一轮回复里所有执行者小节的总份额（字符） */
export const ZHENG_LIU_LUN_ZONG_E = 3000;
export const MEI_REN_ZUI_SHAO = 400;
export const SHI_SHI_SHANG_XIAN = { tiao: 5, zi: 160 } as const;
export const JUE_DING_SHANG_XIAN = { tiao: 4, zi: 160 } as const;
export const WEN_TI_SHANG_XIAN = { tiao: 3, zi: 160 } as const;
export const CHAN_WU_SHANG_XIAN = 8;
export const JIAO_FU_GONG_JU_MING = 'jiao_fu';

export interface JiaoFuCanShu {
  jieLun: string;
  chanWu: string[];
  shiShi: string[];
  jueDing: ZhengLiuJueDing[];
  wenTi: string[];
}

/** 提交工具（strict schema：jieLun 必填，其余数组可空） */
export function jiaoFuGongJu(): GongJuGuiGe {
  return {
    type: 'function',
    function: {
      name: JIAO_FU_GONG_JU_MING,
      description: '做完后**必须调用一次**：提交这次任务的结构化结果（宿主据此汇总给值班者，并逐个核实你说的产物是否真的存在）。'
        + '不要在正文里复述过程。',
      parameters: {
        type: 'object',
        properties: {
          jieLun: { type: 'string', description: `结论（≤${JIE_LUN_YOU_GONG_JU} 字，说清做成了什么、没做成什么）` },
          chanWu: { type: 'array', items: { type: 'string' }, description: '产物文件的**绝对路径**（没有就给空数组）' },
          shiShi: { type: 'array', items: { type: 'string' }, description: `关键事实（≤${SHI_SHI_SHANG_XIAN.tiao} 条）` },
          jueDing: {
            type: 'array',
            description: `做出的决定（≤${JUE_DING_SHANG_XIAN.tiao} 条；zhuTi 写这条决定是关于什么的）`,
            items: { type: 'object', properties: { zhuTi: { type: 'string' }, nei: { type: 'string' } }, required: ['zhuTi', 'nei'] },
          },
          wenTi: { type: 'array', items: { type: 'string' }, description: `还没解决、需要值班者或用户定的问题（≤${WEN_TI_SHANG_XIAN.tiao} 条）` },
        },
        required: ['jieLun', 'chanWu'],
      },
    },
  };
}

function wen(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function shuZu(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function jianZi(s: string, n: number): string {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n) + '…' : x;
}

/** 校验工具参数；jieLun 缺失 ⇒ null（交由正文兜底，而不是收一份空交付） */
export function jieXiJiaoFu(args: unknown): JiaoFuCanShu | null {
  let o: Record<string, unknown> | null = null;
  if (typeof args === 'string') { try { o = JSON.parse(args) as Record<string, unknown>; } catch { o = null; } }
  else if (args && typeof args === 'object') o = args as Record<string, unknown>;
  if (!o) return null;
  const jieLun = wen(o.jieLun);
  if (!jieLun) return null;
  return {
    jieLun,
    chanWu: shuZu(o.chanWu).map(wen).filter(Boolean),
    shiShi: shuZu(o.shiShi).map(wen).filter(Boolean),
    jueDing: shuZu(o.jueDing).map((d) => ({ zhuTi: wen((d as { zhuTi?: unknown })?.zhuTi), nei: wen((d as { nei?: unknown })?.nei) })).filter((d) => d.zhuTi && d.nei),
    wenTi: shuZu(o.wenTi).map(wen).filter(Boolean),
  };
}

/** 正文里能认出的文件路径（绝对路径或带扩展名的文件名；版本号这类不算） */
const LU_JING = /(?:[A-Za-z]:[\\/][^\s"'`<>|*?，。；、（）()]+|\/(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,6}|\b[\w.-]+\.(?:txt|md|html?|css|js|ts|json|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|svg|zip|py|sh|yaml|yml)\b)/g;
export function zhengWenLuJing(text: string): string[] {
  const chu = new Set<string>();
  for (const m of String(text || '').matchAll(LU_JING)) {
    const lu = m[0].replace(/[.,;:：，。；]+$/, '');
    if (/^\d+(\.\d+)+$/.test(lu)) continue;
    chu.add(lu);
  }
  return [...chu].slice(0, CHAN_WU_SHANG_XIAN);
}

/** 没调交付工具时：先找 ```json 块，没有就按正文兜底（结论 = 正文，产物 = 正文里认出的路径） */
export function jieXiZhengWen(text: string): { can: JiaoFuCanShu; laiYuan: 'json' | 'zheng_wen' } {
  const t = String(text || '');
  const kuai = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i.exec(t);
  if (kuai) {
    const j = jieXiJiaoFu(kuai[1]);
    if (j) return { can: j, laiYuan: 'json' };
  }
  return { can: { jieLun: t.trim(), chanWu: zhengWenLuJing(t), shiShi: [], jueDing: [], wenTi: [] }, laiYuan: 'zheng_wen' };
}

/** N 个执行者平分一轮份额（每人不少于 MEI_REN_ZUI_SHAO） */
export function meiRenPeiE(n: number, zong = ZHENG_LIU_LUN_ZONG_E): number {
  const k = Math.max(1, Math.floor(Number(n) || 1));
  return Math.max(MEI_REN_ZUI_SHAO, Math.floor(zong / k));
}

/** 在句子边界截（截在半句话中间比不截还难读）；返回是否截了 */
export function jieDuanJieLun(s: string, shangXian: number): { wen: string; chaoChang: boolean } {
  const x = String(s || '').trim();
  if (x.length <= shangXian) return { wen: x, chaoChang: false };
  const tou = x.slice(0, shangXian);
  const bian = Math.max(tou.lastIndexOf('。'), tou.lastIndexOf('！'), tou.lastIndexOf('？'), tou.lastIndexOf('. '), tou.lastIndexOf('\n'));
  return { wen: (bian > shangXian * 0.5 ? tou.slice(0, bian + 1) : tou).trim(), chaoChang: true };
}

/**
 * 把一次执行的原始产出蒸馏成契约 `GongzuozheJieguo`。
 * `heShi(lu)`：宿主核实产物 —— 返回真实存在的绝对路径，不存在返回空串。
 * 返回 `quanWen`（超长时要存进记忆库的完整原文）；存成功后用 `zhengLiuZhiZhen` 挂指针。
 */
export function zhengLiu(p: {
  taskId: string;
  jiaoFu: JiaoFuCanShu | null;
  zhengWen: string;
  youGongJu: boolean;
  heShi: (lu: string) => string;
  stats: GongzuozheJieguo['stats'];
  error?: GuileiCuowu;
}): { jieGuo: GongzuozheJieguo; chaoChang: boolean; quanWen: string } {
  const jie = p.jiaoFu ? { can: p.jiaoFu, laiYuan: 'jiao_fu' as const } : jieXiZhengWen(p.zhengWen);
  const can = jie.can;
  const shangXian = p.youGongJu ? JIE_LUN_YOU_GONG_JU : JIE_LUN_WU_GONG_JU;
  const jd = jieDuanJieLun(can.jieLun, shangXian);
  const artifacts: string[] = [];
  const unverified: string[] = [];
  for (const lu of can.chanWu.slice(0, CHAN_WU_SHANG_XIAN)) {
    let zhen = '';
    try { zhen = String(p.heShi(lu) || ''); } catch { zhen = ''; }
    if (zhen) { if (!artifacts.includes(zhen)) artifacts.push(zhen); }
    else if (!unverified.includes(lu)) unverified.push(lu);
  }
  /** 超长时要存档的完整原文：整段结论 + 全部事实/决定/问题（不截，一字不丢） */
  const quanWen = jd.chaoChang
    ? [
      can.jieLun,
      can.shiShi.length ? '事实：' + can.shiShi.join('；') : '',
      can.jueDing.length ? '决定：' + can.jueDing.map((d) => `${d.zhuTi}=${d.nei}`).join('；') : '',
      can.wenTi.length ? '待决：' + can.wenTi.join('；') : '',
      can.chanWu.length ? '产物（自报）：' + can.chanWu.join('、') : '',
    ].filter(Boolean).join('\n')
    : '';
  const jieGuo: GongzuozheJieguo = {
    taskId: p.taskId,
    distilled: jd.wen,
    artifacts,
    stats: p.stats,
    ...(p.error ? { error: p.error } : {}),
    facts: can.shiShi.slice(0, SHI_SHI_SHANG_XIAN.tiao).map((s) => jianZi(s, SHI_SHI_SHANG_XIAN.zi)),
    decisions: can.jueDing.slice(0, JUE_DING_SHANG_XIAN.tiao).map((d) => ({ zhuTi: jianZi(d.zhuTi, 40), nei: jianZi(d.nei, JUE_DING_SHANG_XIAN.zi) })),
    questions: can.wenTi.slice(0, WEN_TI_SHANG_XIAN.tiao).map((s) => jianZi(s, WEN_TI_SHANG_XIAN.zi)),
    unverifiedArtifacts: unverified,
    laiYuan: jie.laiYuan,
  };
  return { jieGuo, chaoChang: jd.chaoChang, quanWen };
}

/** 完整结论**存成功之后**才挂指针（存不上就不许给 recordId：指向不存在的地方比不给更坏） */
export function zhengLiuZhiZhen(jg: GongzuozheJieguo, recordId: string): GongzuozheJieguo {
  const id = String(recordId || '').trim();
  return id ? { ...jg, fullRecordId: id } : jg;
}

export interface ZhengLiuWenAn {
  chanWu: string;
  weiZhaoDao: string;
  daiJue: string;
  quanWenYiCun: string;
  quanWenWeiCun: string;
}
export const ZHENG_LIU_WEN_AN_MO_REN: ZhengLiuWenAn = {
  chanWu: '产物：{list}',
  weiZhaoDao: '⚠ 说产出了但没找到：{list}',
  daiJue: '待决：{list}',
  quanWenYiCun: '（结论较长已截取开头；完整结论已存档：retrieve(recordId="{id}")）',
  quanWenWeiCun: '（结论较长已截取开头；完整结论本次未能存档）',
};

/**
 * 回复里一个执行者的小节，**有界**：先放结论与产物，配额不够时依次舍掉"待决 → 决定细节"，
 * 舍掉的内容仍在任务黑板里（宿主补记过），不会凭空消失。
 */
export function zhengLiuXiaoJie(jg: GongzuozheJieguo, ming: string, peiE: number, chaoChang: boolean, w: ZhengLiuWenAn = ZHENG_LIU_WEN_AN_MO_REN): string {
  const ti = (s: string, k: string, v: string) => s.replace(`{${k}}`, () => v);
  const hang: string[] = [`【${ming}】${jg.distilled || '（没有结论）'}`];
  if (chaoChang) hang.push(jg.fullRecordId ? ti(w.quanWenYiCun, 'id', jg.fullRecordId) : w.quanWenWeiCun);
  if (jg.artifacts.length) hang.push(ti(w.chanWu, 'list', jg.artifacts.join('、')));
  if (jg.unverifiedArtifacts && jg.unverifiedArtifacts.length) hang.push(ti(w.weiZhaoDao, 'list', jg.unverifiedArtifacts.join('、')));
  const keSheng: string[] = [];
  if (jg.questions && jg.questions.length) keSheng.push(ti(w.daiJue, 'list', jg.questions.join('；')));
  let chu = hang.join('\n');
  for (const h of keSheng) {
    if (chu.length + h.length + 1 <= peiE) chu += '\n' + h;
  }
  return chu.length > peiE ? chu.slice(0, Math.max(0, peiE - 1)) + '…' : chu;
}
