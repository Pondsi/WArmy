/**
 * 难易度分诊（第 99 轮五级化）—— 三个独立轴，各 5 档：
 *
 *  · **难易**（单步计算/推理本身有多难）：很难 5 / 较难 4 / 难易适中 3 / 较易 2 / 极易 1。
 *    难 ⇒ 更智能的模型（链上更强的模型）；易 ⇒ 可以交给更小/更快的模型。
 *  · **杂简**（步骤多、可拆分、子任务关联深）：很杂 5 / 较杂 4 / 杂简适中 3 / 较简 2 / 极简 1。
 *    杂 ⇒ 更高思考级别；简 ⇒ 更低思考级别。
 *  · **急缓**（投递/插话/延迟敏感度）：很急 5 / 较急 4 / 急缓适中 3 / 较缓 2 / 极缓 1。
 *    急 ⇒ 优先云端/带 flash/速度快的模型，并可能在难易/杂简允许的范围内压低思考级别；
 *    缓 ⇒ 优先强模型、高思考，允许本地慢跑。
 *
 * 三个轴**不互相冒充**：步数多不等于单步难；紧急不等于任务难；重要/风险只是护栏，
 * 不是第四条主维度（高风险会抬思考，但不会把“易”说成“难”）。
 *
 * 纯函数、无模型调用；模型分类器可用时以模型 JSON 为准（见 electron-main）。
 */

export type NanDang = 1 | 2 | 3 | 4 | 5;
export type ZaDang = 1 | 2 | 3 | 4 | 5;
export type JiDang = 1 | 2 | 3 | 4 | 5;

/** 内部思考档位：与界面 THINK_STOPS 一致（off + l1..l6；auto 不参与难度计算） */
export type SiKaoDang = 'off' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'l6';

export interface NanYiDuJieGuo {
  /** 单步计算/推理本身的难度 1-5（5=很难） */
  nan: number;
  /** 步骤/子任务关联的复杂度 1-5（5=很杂） */
  za: number;
  /** 紧急度 1-5（5=很急）；单聊不参与模型/思考，项目里参与插话与速度偏好 */
  ji: number;
  /** 对用户的重要程度/风险 1-5（安全护栏，不是第四条主维度） */
  importance: number;
  /** 五档中文：很难 / 较难 / 难易适中 / 较易 / 极易 */
  nanBan: string;
  /** 五档中文：很杂 / 较杂 / 杂简适中 / 较简 / 极简 */
  zaBan: string;
  /** 五档中文：很急 / 较急 / 急缓适中 / 较缓 / 极缓 */
  jiBan: string;
  /** 兼容旧调用方：high = nan 4-5，mid = 3，low = 1-2 */
  modelTier: 'high' | 'mid' | 'low';
  /** 兼容旧调用方；新代码用 nan 直接算五档 */
  nanTier: NanDang;
  /** 思考档：off / l1..l6（界面 8 档去掉 auto） */
  thinkLevel: SiKaoDang;
  /** 三轴组合，例如「很难·很杂·很急」 */
  combo: string;
  confidence: number;
  reason: string;
}

export const NAN_BAN: Record<number, string> = { 5: '很难', 4: '较难', 3: '难易适中', 2: '较易', 1: '极易' };
export const ZA_BAN: Record<number, string> = { 5: '很杂', 4: '较杂', 3: '杂简适中', 2: '较简', 1: '极简' };
export const JI_BAN: Record<number, string> = { 5: '很急', 4: '较急', 3: '急缓适中', 2: '较缓', 1: '极缓' };

const qie = (n: number, lo = 1, hi = 5): number => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

/** P0–P3 → 急缓五档；P0=很急、P1=较急、P2=急缓适中、P3=较缓。极缓留给后台/批处理。 */
export function jinJiCongP(urgency?: string): JiDang {
  const u = String(urgency || '').toUpperCase();
  if (u === 'P0') return 5;
  if (u === 'P1') return 4;
  if (u === 'P2') return 3;
  if (u === 'P3') return 2;
  if (u === 'P4') return 1;
  return 3;
}

/** P 档 + 文字里的“马上/不急”修饰 → 五级急缓（用户手动 P 档是底，文字只微调一档） */
export function jiCongWenBen(urgency: string | undefined, content: string): JiDang {
  let ji = jinJiCongP(urgency);
  const s = String(content || '');
  if (/马上|立刻|立即|赶紧|尽快|现在就|十万火急|asap|urgent/i.test(s)) ji += 1;
  if (/不急|慢慢|有空再|不着急|闲时|batch|后台/i.test(s)) ji -= 1;
  return qie(ji) as JiDang;
}

export function banOf(n: number, B: Record<number, string>): string {
  return B[qie(n)] || B[3]!;
}

/** 思考档位排序（只用于“抬/压一档”，auto 不在这里） */
const SI_KAO_ORDER: SiKaoDang[] = ['off', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
function siKaoIndex(s: SiKaoDang): number {
  const i = SI_KAO_ORDER.indexOf(s);
  return i < 0 ? 3 : i;
}
function siKaoAt(i: number): SiKaoDang {
  return SI_KAO_ORDER[Math.max(0, Math.min(SI_KAO_ORDER.length - 1, i))]!;
}
/** 抬到至少 floor 档 */
function siKaoFloor(cur: SiKaoDang, floor: SiKaoDang): SiKaoDang {
  return siKaoIndex(cur) >= siKaoIndex(floor) ? cur : floor;
}
/** 压一档但不得低于 floor */
function siKaoLower(cur: SiKaoDang, floor: SiKaoDang): SiKaoDang {
  return siKaoAt(Math.max(siKaoIndex(floor), siKaoIndex(cur) - 1));
}

/** 杂简 1-5 → 基础思考档（5→参悟 l6、4→穷理 l5、3→明辨 l4、2→慎思 l2、1→灵机 off） */
export function siKaoCongZa(za: number): SiKaoDang {
  const z = qie(za);
  if (z >= 5) return 'l6';
  if (z === 4) return 'l5';
  if (z === 3) return 'l4';
  if (z === 2) return 'l2';
  return 'off';
}

/** 难易 1-5 → 思考下限：单步很难也要给足推理预算 */
export function siKaoXiaXianCongNan(nan: number): SiKaoDang {
  const n = qie(nan);
  if (n >= 5) return 'l4';
  if (n === 4) return 'l3';
  if (n === 3) return 'l2';
  if (n === 2) return 'l1';
  return 'off';
}

/**
 * 由 nan/za/importance/confidence/urgency 推出模型档、思考档与三轴组合。
 *
 * 规则（可解释、可门禁）：
 *  - 模型：nan 5/4 → high；3 → mid；2/1 → low（实际五档用 `nan` 传下去）。
 *  - 思考：先由 za 定基础档；nan 给下限；importance≥4 再抬下限；
 *    高难/低置信/高风险/顶模型仍可能失手时抬到 l6。
 *  - 急缓只在“难易/杂简允许”的范围内压低一档，绝不压到下限以下。
 */
export function panDuanNanZa(
  nan: number,
  za: number,
  importance: number,
  confidence: number,
  urgency?: string,
  reason = '',
  jiOverride?: number,
): NanYiDuJieGuo {
  const n = qie(nan);
  const z = qie(za);
  const imp = qie(importance);
  const conf = Math.max(0, Math.min(1, Number(confidence) || 0));
  const ji = qie(jiOverride == null ? jinJiCongP(urgency) : Number(jiOverride));

  const modelTier: NanYiDuJieGuo['modelTier'] = n >= 4 ? 'high' : n === 3 ? 'mid' : 'low';
  const liYou: string[] = [];
  if (reason) liYou.push(reason);

  // ① 杂简决定基础思考档
  let thinkLevel = siKaoCongZa(z);
  // ② 难易给出“单步推理”下限
  let floor = siKaoXiaXianCongNan(n);
  // ③ 重要/高风险再抬下限（不是主维度，只做护栏）
  if (imp >= 5) floor = siKaoFloor(floor, 'l4');
  else if (imp >= 4) floor = siKaoFloor(floor, 'l3');
  thinkLevel = siKaoFloor(thinkLevel, floor);
  if (siKaoIndex(floor) > siKaoIndex(siKaoXiaXianCongNan(n))) liYou.push('高风险/重要→抬思考下限');

  // ④ 顶模型仍可能失手：高难、低置信、高风险 ⇒ 直接 l6（用户口径：即使任务“简”也可以抬）
  if (n >= 5 || (n >= 4 && (conf < 0.6 || imp >= 4))) {
    if (thinkLevel !== 'l6') {
      thinkLevel = 'l6';
      liYou.push('顶模型仍可能失手→高思考');
    }
  }

  // ⑤ 急缓：仅在“不难、不杂”时允许压一档；绝不冲突（不低于 nan/za/importance 下限）
  if (ji >= 4 && n <= 3 && z <= 2) {
    const lowered = siKaoLower(thinkLevel, floor);
    if (lowered !== thinkLevel) {
      thinkLevel = lowered;
      liYou.push('很急且任务简单→低一档思考（不冲突下限）');
    }
  }

  const combo = `${NAN_BAN[n] || NAN_BAN[3]}·${ZA_BAN[z] || ZA_BAN[3]}·${JI_BAN[ji] || JI_BAN[3]}`;
  return {
    nan: n,
    za: z,
    ji,
    importance: imp,
    nanBan: NAN_BAN[n] || NAN_BAN[3]!,
    zaBan: ZA_BAN[z] || ZA_BAN[3]!,
    jiBan: JI_BAN[ji] || JI_BAN[3]!,
    modelTier,
    nanTier: n as NanDang,
    thinkLevel,
    combo,
    confidence: conf,
    reason: liYou.join('；') || `难易 ${n}/5 · 杂简 ${z}/5 · 急缓 ${ji}/5`,
  };
}

/** 本地分诊：分别估“单步难度”“步骤复杂度”“急缓”，不把步数当难度、不把难度当步数 */
export function guSuanZhongYaoFuZa(content: string, urgency?: string): NanYiDuJieGuo {
  const s = String(content || '');
  const chang = s.length;
  const gaoFeng = /生产|正式环境|付款|转账|删除|清空|重置|权限|密钥|隐私|安全|合同|医疗|法律|发布|推送|force|sudo|rm\s+-rf/i.test(s);
  const gongJu = /文件|目录|代码|项目|运行|执行|生成|修改|删除|发布|部署|数据库|API|工具|测试|排查|修复/i.test(s);
  const duoBu = (s.match(/然后|并且|以及|同时|分别|先|再|最后|步骤|全部|逐个|首先|多步|分步|逐步|分多|多个步骤|多个任务|一系列|流程|\d+[.、)]/g) || []).length;
  const guanLian = /拆|拆分|多任务|子任务|多步|分步|逐步|并行|依赖|关联|串联|汇总|协同|各|每个|分别|分批|流水线|前后|互相/.test(s);

  /** 单步难度：专业计算/深度推理/高风险/长难题 */
  let nan = 2;
  if (/证明|推导|算法|公式|复杂计算|精确计算|优化|加密|并发|架构|根因|原理|数学|统计推断|策略|权衡|审计|法律|医疗|税务|合同|安全/i.test(s)) nan++;
  if (gaoFeng) nan += 2;
  if (chang > 500) nan++;
  if (/高难|难题|专家|深度|严谨|不能出错|一次性|关键判断/i.test(s)) nan++;
  nan = qie(nan);

  /** 步骤复杂度：多步、多任务、可拆分、互相关联 */
  let za = 1;
  if (chang > 120) za++;
  if (chang > 500) za++;
  if (duoBu >= 2) za++;
  if (duoBu >= 4) za++;
  if (gongJu) za++;
  if (guanLian) za++;
  za = qie(za);

  /** 急缓：P 档为底；文字里的“马上/立刻”抬一档，“不急/慢慢/有空”压一档 */
  const ji = jiCongWenBen(urgency, s);

  const importance = qie(2 + (gongJu ? 1 : 0) + (gaoFeng ? 2 : 0));
  const confidence = gaoFeng ? 0.9 : (duoBu >= 2 || guanLian ? 0.7 : 0.6);
  return panDuanNanZa(
    nan, za, importance, confidence, urgency,
    `本地分诊：单步难 ${nan}/5；步骤杂 ${za}/5；急缓 ${ji}/5`,
    ji,
  );
}
