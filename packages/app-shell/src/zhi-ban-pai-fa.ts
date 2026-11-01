/**
 * 项目值班者派发计划（第 99 轮五级化，纯函数、可无头断言）。
 *
 * 用户口径：
 *  · **难易 / 杂简 / 急缓是三套东西**：
 *      - 难易决定“交给多强的模型”；
 *      - 杂简决定“用多高的思考级别”；
 *      - 急缓决定“插话方式、投递快慢、优先云端/flash/速度快的模型”。
 *  · 值班者可以决定：执行者、每个执行者的思考级别、目标正在忙时的插话方式
 *    （停止 / 加急 / 插入 / 排队）。
 *  · 值班者**不能决定模型**；模型由每只牛马自己的设置决定（本模块绝不产出 model 字段）。
 *  · 值班者只有在“执行者明确无法完成（置信度 > 65%）且自己完成置信度 < 45%”、
 *    没有执行者可用、或用户明确要求时才自己执行；否则必须先派执行者。
 *
 * 这是宿主侧的**派发规则**（和 pai-fa-pan-ding 的并行/接力判定同一层）：
 * 值班者模型负责说话/汇报，宿主负责按纪律把“谁干、怎么插话、思考多深”落到执行者。
 * 这样不会因为值班者模型幻觉而绕开牛马自己的模型设置。
 */
import type { Jinji, CuoHuaFangShi, ZhiXingFenPei, SiKaoDangWei } from '@warmy/contracts';
import { guSuanMoXingQiangDu, guSuanMoXingSuDu, zuiQiangMoXing, zuiKuaiMoXing } from './mo-xing-qiang-du.js';

export type { CuoHuaFangShi, ZhiXingFenPei };
export type FenPeiSiKao = SiKaoDangWei;

export interface PaiFaHouXuan {
  id: string;
  ming: string;
  /** 实例进程状态：running / stopped / dead … */
  status?: string;
  /** 这只牛马当前是否正在对话/任务中（由宿主如实提供） */
  busy?: boolean;
  /** 人设/擅长（来自牛马设置）——用于匹配任务，不用于选模型 */
  persona?: string;
  /** 牛马自己的思考级别；auto = 跟随任务难易度 */
  thinkLevel?: string;
  /** 成员顺序（稳定排序/公平兜底） */
  order?: number;
  pureDispatcher?: boolean;
  /** 自己调用链里的模型（含默认模型）；只用于值班者“挑谁”，不改变模型 */
  models?: string[];
  /** 这组模型里最强的档 1-5（宿主算好；不传就按 models 现算） */
  modelQiang?: number;
  /** 这组模型里最快的档 1-5（同上） */
  modelKuai?: number;
  /** 是否会走本地/免费模型（宿主算好） */
  benDi?: boolean;
}

export interface PaiFaQingQiu {
  /** P0-P3 投递等级（兼容旧入口）；真正的细粒度急缓看 difficulty.ji */
  urgency: Jinji;
  content: string;
  difficulty: {
    nan: number;
    za: number;
    /** 五级急缓 1-5；不传就从 urgency 推 */
    ji?: number;
    importance?: number;
    modelTier?: string;
    /** 任务建议思考档：off/l1..l6（不再用 low/medium/high） */
    thinkLevel: string;
    combo?: string;
  };
  candidates: PaiFaHouXuan[];
  /** 期望几个执行者；缺省 很急=3、其余=2（不超过候选数） */
  want?: number;
  /** 用户是否明确要求“停止/中断”某个执行者 */
  stopIntent?: boolean;
  /** 同一目标连续催促次数（第二次催促可升级为 P0 硬停） */
  urgeCount?: number;
}

export interface PaiFaJiHua {
  urgency: Jinji;
  difficulty: {
    nan: number; za: number; ji: number; importance: number;
    modelTier: string; thinkLevel: string; combo: string;
    nanBan?: string; zaBan?: string; jiBan?: string;
  };
  assignments: ZhiXingFenPei[];
  /** 硬约束：值班者不得指定模型 */
  modelLocked: true;
}

type JiNengZu = { name: string; ci: RegExp; ren: RegExp };

/** 任务关键词 → 能力标签。人设/名字命中同一标签才算“合适”。 */
const JI_NENG: JiNengZu[] = [
  { name: '前端', ci: /(前端|网页|页面|界面|UI|React|Vue|HTML|CSS|小程序|可视化)/i, ren: /(前端|网页|页面|界面|UI|React|Vue|HTML|CSS|小程序|可视化)/i },
  { name: '后端', ci: /(后端|接口|API|服务端|数据库|SQL|服务|架构|并发|微服务)/i, ren: /(后端|接口|API|服务端|数据库|SQL|服务|架构|并发|微服务)/i },
  { name: '测试', ci: /(测试|验收|排查|复现|回归|门禁|质量|缺陷|bug)/i, ren: /(测试|验收|排查|回归|质量|缺陷|QA)/i },
  { name: '写作', ci: /(文案|写作|文章|报告|文档|总结|润色|标题|说明)/i, ren: /(写作|文案|编辑|文档|报告|文字|记者)/i },
  { name: '设计', ci: /(设计|海报|配色|视觉|插画|图标|排版|图片)/i, ren: /(设计|视觉|插画|图标|配色|美术)/i },
  { name: '数据', ci: /(数据|分析|统计|表格|Excel|CSV|指标|报表|图表)/i, ren: /(数据|分析|统计|表格|Excel|报表|指标)/i },
  { name: '运维', ci: /(运维|部署|服务器|Docker|容器|CI|发布|上线|监控|日志)/i, ren: /(运维|部署|服务器|Docker|容器|CI|监控)/i },
  { name: '翻译', ci: /(翻译|英文|英语|日语|韩语|多语言|本地化)/i, ren: /(翻译|英文|英语|日语|韩语|多语言|本地化)/i },
  { name: '财务', ci: /(财务|发票|报销|预算|成本|对账|合同金额)/i, ren: /(财务|会计|发票|报销|预算|对账)/i },
  { name: '法律', ci: /(法律|合同|合规|条款|法务|风险)/i, ren: /(法律|法务|合同|合规|律师)/i },
  { name: '文档', ci: /(PPT|幻灯片|演示|Word|Excel|PDF|文档排版)/i, ren: /(PPT|幻灯片|演示|文档|Office)/i },
];

/** 任务文本里命中的能力标签 */
export function renWuBiaoQian(content: string): string[] {
  const s = String(content || '');
  return JI_NENG.filter((z) => z.ci.test(s)).map((z) => z.name);
}

/** ASCII/数字词 + 中文 2~4 字片段（只用于人设匹配，不用于模型/计费） */
function ciPian(content: string): string[] {
  const s = String(content || '');
  const out = new Set<string>();
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_+.#-]{1,30}/g)) out.add(String(m[0]).toLowerCase());
  for (const m of s.matchAll(/[\u4e00-\u9fff]{2,4}/g)) out.add(String(m[0]));
  return [...out];
}

const qie = (n: number, lo = 1, hi = 5): number => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

/** 五级急缓：P0=5、P1=4、P2=3、P3=2；没有 P 档时按 3 */
export function jiCongP(urgency?: string): number {
  const u = String(urgency || '').toUpperCase();
  if (u === 'P0') return 5;
  if (u === 'P1') return 4;
  if (u === 'P2') return 3;
  if (u === 'P3') return 2;
  if (u === 'P4') return 1;
  return 3;
}

function siKaoCongNanYi(du: PaiFaQingQiu['difficulty']): FenPeiSiKao {
  const t = String(du.thinkLevel || 'l4');
  return /^(auto|off|l[1-6])$/.test(t) ? (t as FenPeiSiKao) : 'l4';
}

/**
 * 插话方式：
 *  - 目标空闲 / 不需要插话 ⇒ none（默认就是直接插入对话）
 *  - 用户明确要求停止：很急或已催促第二次 ⇒ stop；较急 ⇒ urgent
 *  - 否则按急缓：很急/较急 ⇒ urgent；适中 ⇒ insert；较缓/极缓 ⇒ queue
 */
export function chaHuaCongJi(ji: number, stopIntent = false, urgeCount = 0): CuoHuaFangShi {
  const j = qie(ji);
  if (stopIntent) {
    if (j >= 5 || urgeCount >= 2) return 'stop';
    if (j >= 4) return 'urgent';
  }
  if (j >= 4) return 'urgent';
  if (j === 3) return 'insert';
  return 'queue';
}

/**
 * 生成派发计划：只返回“谁、什么思考级别、怎么插话、为什么”，**绝不返回模型**。
 * 任何输入都不抛错；没有候选时返回空 assignments（由调用方让值班者自己答）。
 */
export function paiFaZhiXingZhe(q: PaiFaQingQiu): PaiFaJiHua {
  const urgency: Jinji = q.urgency || 'P2';
  const du = q.difficulty || { nan: 3, za: 3, ji: 3, importance: 3, thinkLevel: 'l4' };
  const nan = qie(du.nan);
  const za = qie(du.za);
  const ji = qie(du.ji == null ? jiCongP(urgency) : Number(du.ji));
  const ren = String(q.content || '');
  const biaoQian = new Set(renWuBiaoQian(ren));
  const ci = ciPian(ren);
  const yuan = (q.candidates || []).filter((c) => c && c.id && !c.pureDispatcher);
  const want = Math.max(1, Math.min(Number(q.want) || (ji >= 5 ? 3 : 2), yuan.length || 1));
  const stopIntent = q.stopIntent === true || /(停止|停下|停下来|中断|取消|别做|不要做|立刻停|马上停|stop|cancel|abort)/i.test(ren);
  const urgeCount = Math.max(0, Number(q.urgeCount) || 0);

  const daFen = yuan.map((c) => {
    const wen = `${c.ming || ''} ${c.persona || ''}`;
    const mingCi = new Set(renWuBiaoQian(wen));
    let score = 0;
    const liYou: string[] = [];
    for (const b of biaoQian) {
      if (mingCi.has(b)) { score += 40; liYou.push('匹配:' + b); }
    }
    let ciZhong = 0;
    for (const t of ci) {
      if (t.length >= 2 && wen.includes(t)) { ciZhong += 1; score += 4; }
    }
    if (ciZhong) liYou.push('关键词x' + ciZhong);

    /** 模型强弱/速度：只影响“挑谁”，不改变这只牛马最终用哪个模型 */
    const models = Array.isArray(c.models) ? c.models : [];
    const qiang = Number(c.modelQiang) || (models.length ? guSuanMoXingQiangDu(zuiQiangMoXing(models)) : 3);
    const kuai = Number(c.modelKuai) || (models.length ? guSuanMoXingSuDu(zuiKuaiMoXing(models)) : 3);
    if (qiang >= nan) score += 18;
    else score -= (nan - qiang) * 35;
    if (ji >= 4) {
      score += (kuai - 3) * 12;
      if (!c.benDi) score += 8;
      if (kuai >= 4) score += 10;
    } else if (ji <= 2) {
      score += (qiang - 3) * 6;
      if (c.benDi) score += 4;
    } else {
      score += (qiang - 3) * 3 + (kuai - 3) * 3;
    }
    liYou.push(`模型强${qiang}/快${kuai}`);

    /** 思考级别匹配：杂任务要能深想；很急的小任务反而偏好低思考（不冲突下限） */
    const own = String(c.thinkLevel || 'auto');
    if (za >= 4) {
      if (own === 'off' || own === 'l1' || own === 'l2') { score -= 30; liYou.push('思考偏低'); }
      else if (own === 'l5' || own === 'l6') { score += 18; liYou.push('思考够深'); }
      else if (own === 'auto') { score += 6; }
    } else if (za <= 2 && ji >= 4) {
      if (own === 'off' || own === 'l1' || own === 'l2') score += 8;
      else if (own === 'l5' || own === 'l6') score -= 4;
    }

    if (c.busy) {
      score += ji >= 5 ? 6 : ji === 4 ? 1 : ji === 3 ? -120 : -1000;
      liYou.push('忙碌');
    } else {
      score += 30;
      liYou.push('空闲');
    }
    if (c.status && c.status !== 'running') {
      score -= 50;
      liYou.push('实例' + c.status);
    }
    score -= Math.max(0, Number(c.order) || 0) * 0.01;
    return { c, score, liYou };
  });

  daFen.sort((a, b) => b.score - a.score || (a.c.order || 0) - (b.c.order || 0));
  const chosen = daFen.slice(0, want);
  const thinkFromTask = siKaoCongNanYi(du);
  const assignments: ZhiXingFenPei[] = chosen.map(({ c, liYou }) => {
    const own = String(c.thinkLevel || 'auto');
    /** 牛马自己选了具体档位 ⇒ 值班者不覆盖；只有 auto 才按任务三轴给建议 */
    const thinkLevel: FenPeiSiKao = own && own !== 'auto' ? 'auto' : thinkFromTask;
    const interrupt = c.busy ? chaHuaCongJi(ji, stopIntent, urgeCount) : 'none';
    const why = [
      ...liYou,
      own && own !== 'auto' ? '思考跟随牛马设置' : `难${nan}/杂${za}/急${ji}→思考 ${thinkLevel}`,
      interrupt === 'none' ? '无需插话' : `插话 ${interrupt}`,
    ].join('；');
    return { executorId: c.id, ming: c.ming || c.id, thinkLevel, interrupt, why };
  });

  return {
    urgency,
    difficulty: {
      nan,
      za,
      ji,
      importance: qie(du.importance == null ? 3 : du.importance),
      modelTier: String(du.modelTier || (nan >= 4 ? 'high' : nan === 3 ? 'mid' : 'low')),
      thinkLevel: String(du.thinkLevel || 'l4'),
      combo: String(du.combo || `${nan >= 4 ? '难' : '易'}${za >= 4 ? '杂' : '简'}${ji >= 4 ? '急' : '缓'}`),
    },
    assignments,
    modelLocked: true,
  };
}

/** 派发顺序：停止/加急/插入优先，排队最后；同档按原顺序稳定 */
export function paiFaXianHou(a: ZhiXingFenPei): number {
  if (a.interrupt === 'stop') return 0;
  if (a.interrupt === 'urgent') return 1;
  if (a.interrupt === 'insert' || a.interrupt === 'none') return 2;
  return 3;
}

/**
 * 值班者能不能自己执行（用户定稿 · 第 102 轮补充兜底）：
 *   0. 用户明确禁止值班者自己执行 ⇒ **不可以**；
 *   1. 用户明确要求“值班者自己做” ⇒ 可以；
 *   2. 没有执行者可用 ⇒ 可以；
 *   3. **其他执行者全部失败** ⇒ 可以（不再看置信度；用户要求先派人的意图已经执行过）；
 *   4. 执行者明确无法完成的置信度 > 0.65，且值班者自己无法完成的置信度 < 0.45 ⇒ 可以；
 *   其余情况一律先派执行者。
 */
export function zhiBanKeZiXing(q: {
  userAsked?: boolean;
  userForbidden?: boolean;
  hasExecutor?: boolean;
  allExecutorsFailed?: boolean;
  executorConfidence?: number;
  dutyConfidence?: number;
}): { ok: boolean; why: string } {
  if (q.userForbidden === true) return { ok: false, why: '用户明确禁止值班者自己执行' };
  if (q.userAsked === true) return { ok: true, why: '用户明确要求值班者自己执行' };
  if (q.hasExecutor !== true) return { ok: true, why: '没有执行者可用' };
  if (q.allExecutorsFailed === true) return { ok: true, why: '其他执行者全部失败 ⇒ 值班者兜底（不看置信度）' };
  const ex = Number(q.executorConfidence) || 0;
  const du = Number(q.dutyConfidence);
  if (ex > 0.65 && Number.isFinite(du) && du < 0.45) {
    return { ok: true, why: `执行者无法完成置信度 ${(ex * 100).toFixed(0)}%>65%，值班者 ${(du * 100).toFixed(0)}%<45%` };
  }
  return { ok: false, why: `执行者仍有能力完成（执行者置信度 ${(ex * 100).toFixed(0)}%，值班者 ${Number.isFinite(du) ? (du * 100).toFixed(0) : '未知'}%）⇒ 必须先派执行者` };
}

/** 用户是否明确要求值班者自己做（避免模型自作主张抢活） */
export function yongHuYaoQiuZhiBanZiZuo(content: string): boolean {
  const s = String(content || '');
  return /(值班者|你自己|你亲自|你来(做|完成|执行|处理)|自己(来|做|完成|执行)|不要派|别派|无需派|不用派)/i.test(s);
}

/** 用户是否明确**禁止**值班者自己执行（避免兜底越过用户意图） */
export function yongHuJinZhiZhiBanZiZuo(content: string): boolean {
  const s = String(content || '');
  return /(?:(?:不要|别|不需要|无需|不用|不必|禁止|不允许|不能)[^，。！？\n]{0,16}(?:值班者|你)[^，。！？\n]{0,12}(?:自己|亲自|来)?[^，。！？\n]{0,8}(?:执行|做|完成|处理|接手|兜底))|(?:(?:值班者|你)[^，。！？\n]{0,12}(?:不要|别|不能|禁止|不允许|无需|不需要|不用|不必)[^，。！？\n]{0,12}(?:自己|亲自|来)?[^，。！？\n]{0,8}(?:执行|做|完成|处理|接手|兜底))/i.test(s);
}
