/**
 * gate-policy —— **硬门禁 / 软门禁的判定内核**（第 41 轮，纯函数，可无头断言）。
 *
 * 产品口径（用户原话整理）：
 *   1. **硬门禁不可绕过**：模型（牛马）无论用什么说法都不能让宿主不执行硬门禁；
 *      它**不能改硬门禁**，但**必须能说清**是哪一条在拦它，以及"改这条最坏会发生什么"。
 *   2. **软门禁不能轻易改**：除非用户明确要求，否则要先给出 **≥3 条互不相同的论证**，
 *      证明"必须改"且"没有别的办法"；其他方案置信度 <50% 视为**没有替代方案**。
 *      允许在后台直接改，但**改完必须立刻主动告知**：改了什么 / 好处 / 风险 / 要不要恢复。
 *   3. **新增硬门禁（冲突优先）**：软门禁永远不得与任何硬门禁冲突。改软门禁时先做冲突检查；
 *      冲突时**按硬门禁执行**，并立刻修正（必要时删除）该软门禁；这种情况不再需要 3 条论证 ——
 *      冲突本身就是"100% 必须改、100% 没有替代方案"。
 *
 * 为什么放在纯函数模块里：门禁这种东西**靠字符串锚点证明不了**。
 * 这里的判定要能被 verify 脚本直接 import 编译产物、喂输入、断言输出。
 */

export type MenJinLei = 'hard' | 'soft';

export interface YingMenJin {
  id: string;
  /** 界面/审计里显示的名字 */
  ming: string;
  /** 一句话规则 */
  guiZe: string;
  /** 如果有人真把这条改掉，**最坏会发生什么**（T2 要求必须能告诉用户） */
  zuiHuai: string;
}

/**
 * 四条硬门禁。**顺序即优先级**；`A/B/C` 是原有产品门禁，`D` 是第 41 轮新增的冲突门禁。
 * 这张表是**代码常量**：没有 IPC 能改它，模型也没有任何工具能写到它。
 */
export const YING_MEN_JIN: readonly YingMenJin[] = Object.freeze([
  {
    id: 'A',
    ming: '可复用能力必须落成 skill / 门禁 / 插件',
    guiZe: '用户给的可复用能力（key、接口、脚本、账号、流程）必须落成 skill / 门禁 / 插件，不许只留在聊天里。',
    zuiHuai: '最坏情况：这条能力只存在于一轮聊天记录里，下个会话完全失效；用户被迫每次重新交代，且无法审计这些凭据被谁用过。',
  },
  {
    id: 'B',
    ming: '所有任务都要进计划任务',
    guiZe: '收到任务先建计划（≥2 步），同一时刻只能有 1 步 doing，verified 只能由 plan_verify 给出。',
    zuiHuai: '最坏情况：任务做到一半没人知道还剩什么，失败无法定位到具体步骤，用户看到的是"说做完了但什么都没有"。',
  },
  {
    id: 'C',
    ming: '后台任务制度',
    guiZe: '长任务要按后台任务制度先交代：在跑什么、每轮多久、预计几点完成、完成后谁收结果。',
    zuiHuai: '最坏情况：长时间静默执行，用户不知道是否卡死；要么干等，要么误以为失败而重复派活。',
  },
  {
    id: 'D',
    ming: '软门禁不得与硬门禁冲突',
    guiZe: '任何软门禁都不得与硬门禁冲突；冲突时按硬门禁执行，并立刻修正或删除该软门禁。',
    zuiHuai: '最坏情况：软门禁把硬门禁"覆盖"掉，宿主的强制检查形同虚设 —— 安全/合规底线被一条用户自定义规则悄悄取消，而且从界面上看不出来。',
  },
]);

/** 按 id 取硬门禁（找不到返回 null） */
export function quYingMenJin(id: string): YingMenJin | null {
  return YING_MEN_JIN.find((x) => x.id === String(id)) || null;
}

/** 给模型看的清单：它要能报出"是哪一条"和"最坏情况" */
export function yingMenJinQingDan(): Array<{ id: string; ming: string; zuiHuai: string }> {
  return YING_MEN_JIN.map((x) => ({ id: x.id, ming: x.ming, zuiHuai: x.zuiHuai }));
}

/**
 * 软门禁文本 → 命中的硬门禁 id 列表。
 *
 * 只做**明确冲突**识别（宁可漏判也不误杀，误杀等于替用户删规则）：
 *   · 命中 A：否认"必须落成 skill/门禁/插件"、或明确允许"只留在聊天里"；
 *   · 命中 B：取消计划任务、允许无计划直接动手、允许多步同时 doing、允许自填 verified；
 *   · 命中 C：要求长时间静默执行、或禁止交代后台任务；
 *   · 命中 D：把硬门禁说成可覆盖/可跳过/优先级更低。
 *
 * 判定方式是"**否定词 + 目标短语**"同句共现，而不是单个关键词 ——
 * 否则"不得只留在聊天里"这种**正向**表述会被误判成冲突。
 */
export function ruanMenJinChongTu(wen: string): string[] {
  const t = String(wen || '');
  const hit = new Set<string>();
  if (!t.trim()) return [];
  const ju = t.split(/[。；;\n]+/).map((s) => s.trim()).filter(Boolean);
  const fouding = (s: string) => /(不需要|无需|可以不|不必|禁止|不允许|跳过|忽略|取消|废除|免去|不做|不用)/.test(s);
  const kenDing = (s: string) => /(必须|只能|一定要|务必|不得)/.test(s);
  for (const s of ju) {
    const fou = fouding(s);
    const ken = kenDing(s);
    // A：可复用能力
    if (/可复用能力|skill|门禁|插件/.test(s) && /只留在聊天|只写在聊天|留在聊天里/.test(s) && !/(不得|不许|不要|禁止)/.test(s)) hit.add('A');
    if (fou && /(skill|门禁|插件)/.test(s) && /(落成|固化成|沉淀成|落盘)/.test(s)) hit.add('A');
    // B：计划任务
    if (fou && /计划任务|计划步骤|plan_update|doing|verified/.test(s)) hit.add('B');
    if (/自填 verified|自己标 verified|直接标 verified/i.test(s) && !/不(许|能|得)/.test(s)) hit.add('B');
    // C：后台任务制度
    if (fou && /后台任务|交代|汇报|先说清/.test(s)) hit.add('C');
    if (/静默执行|不要汇报|无需交代/.test(s) && !/不(许|能|得)/.test(s)) hit.add('C');
    // D：硬门禁可被覆盖
    if (/(硬门禁|hard gate)/i.test(s) && /(?:可以|可|能|允许)(?:被[^。；，,]{0,8})?(?:覆盖|跳过|忽略|绕过|替代|降到次要)|优先级更低|不必遵守|可忽略|次要规则/.test(s) && !ken) hit.add('D');
  }
  return [...hit];
}

/** 软门禁是否与硬门禁冲突（带最坏情况，便于立刻告知用户） */
export function jianChaRuanMenJin(wen: string): {
  chongTu: boolean;
  mingZhong: string[];
  zuiHuai: string[];
} {
  const mingZhong = ruanMenJinChongTu(wen);
  return {
    chongTu: mingZhong.length > 0,
    mingZhong,
    zuiHuai: mingZhong.map((id) => (quYingMenJin(id) || { zuiHuai: '' }).zuiHuai),
  };
}

export interface RuanGaiShenQing {
  /** 这次要改的软门禁（全文或 diff 摘要都行，判定只看内容） */
  neiRong: string;
  /** 用户是否**明确要求**改这条软门禁 */
  yongHuMingQue: boolean;
  /** 模型给出的论证（每条一句话；要求互不相同） */
  lunZheng: string[];
  /** 其他替代方案及其置信度（0-1）；置信度 <0.5 视为**没有替代方案** */
  qiTaFangAn: Array<{ fangAn: string; zhiXinDu: number }>;
}

export interface RuanGaiJueDing {
  /** 能否改 */
  yunXu: boolean;
  /** 走的是哪条路径（冲突优先 / 用户明确要求 / 三论证 / 拒绝） */
  luJing: 'conflict-hard-wins' | 'user-explicit' | 'three-proofs' | 'rejected';
  /** 必须主动告知用户的内容（改了什么/好处/风险/是否恢复） */
  gaoZhi: string;
  /** 需要先修正/删除的软门禁条目（冲突时） */
  yingXiuZheng: string[];
  /** 拒绝原因（yunXu=false 时非空） */
  liYou?: string;
}

const LUN_ZHENG_ZUI_SHAO = 3;
const FANG_AN_ZHI_XIN_DU_XIAN = 0.5;

/** 「软门禁能不能改」的唯一判据 */
export function panDuanRuanGai(shen: RuanGaiShenQing): RuanGaiJueDing {
  const chong = jianChaRuanMenJin(shen.neiRong);
  const yingXiuZheng = chong.mingZhong
    .map((id) => {
      const g = quYingMenJin(id);
      return g ? `硬门禁 ${g.id}（${g.ming}）· 最坏情况：${g.zuiHuai}` : `硬门禁 ${id}`;
    });

  // ① 冲突优先：100% 必须改、100% 没有替代方案 —— 不需要三论证
  if (chong.chongTu) {
    return {
      yunXu: true,
      luJing: 'conflict-hard-wins',
      yingXiuZheng,
      gaoZhi: '这次改动与硬门禁冲突，已按**硬门禁优先**处理：冲突的软门禁需要立刻修正（必要时删除）。'
        + '\n冲突项：' + yingXiuZheng.join('；')
        + '\n冲突场景不需要再走三次论证 —— 与硬门禁冲突本身就等于「必须改、且没有替代方案」。',
    };
  }

  // ② 用户明确要求：直接放行，但仍要告知改了什么/风险/能否恢复
  if (shen.yongHuMingQue) {
    return {
      yunXu: true,
      luJing: 'user-explicit',
      yingXiuZheng: [],
      gaoZhi: '按你的明确要求修改了软门禁。'
        + '\n改了什么：' + zhaiYao(shen.neiRong)
        + '\n风险：软门禁是你自己的检查，改松之后不会再拦住同类问题；改紧可能让原本能过的任务被拒。'
        + '\n需要恢复原样的话告诉我，我立刻改回去。',
    };
  }

  // ③ 没有明确要求：要 ≥3 条互不相同的论证，且替代方案置信度都 <0.5
  const lun = (shen.lunZheng || []).map((s) => String(s || '').trim()).filter(Boolean);
  const buTong = new Set(lun.map((s) => s.replace(/[\s，,。.；;：:]/g, ''))).size;
  const youTiDai = (shen.qiTaFangAn || []).filter((x) => Number(x.zhiXinDu) >= FANG_AN_ZHI_XIN_DU_XIAN);
  if (buTong < LUN_ZHENG_ZUI_SHAO) {
    return {
      yunXu: false, luJing: 'rejected', yingXiuZheng: [], gaoZhi: '',
      liYou: `论证不足：需要 ${LUN_ZHENG_ZUI_SHAO} 条互不相同的论证，当前只有 ${buTong} 条（重复的说法不算）。`,
    };
  }
  if (youTiDai.length) {
    return {
      yunXu: false, luJing: 'rejected', yingXiuZheng: [], gaoZhi: '',
      liYou: '存在可信度 ≥50% 的替代方案（' + youTiDai.map((x) => x.fangAn).join('、') + '），应先试替代方案而不是改软门禁。',
    };
  }
  return {
    yunXu: true,
    luJing: 'three-proofs',
    yingXiuZheng: [],
    gaoZhi: '已按三次论证的结论修改软门禁。'
      + '\n改了什么：' + zhaiYao(shen.neiRong)
      + '\n好处：' + lun.slice(0, LUN_ZHENG_ZUI_SHAO).join(' / ')
      + '\n风险：检查标准变了，历史结论不能直接沿用；如果判断有偏差，可能放过本该拦住的问题。'
      + '\n要不要我恢复原样？（一句话即可）',
  };
}

/** 给模型看的硬门禁提示（它必须能报出"哪一条"和"最坏情况"） */
export function yingMenJinTiShi(): string {
  return '## 硬门禁（不可绕过、不可修改）\n'
    + '下面每一条都由宿主强制执行，**模型无法用任何说法让它不执行，也无法修改它们**。'
    + '如果某一步被挡住，你必须：① 明确说出是哪一条硬门禁在起作用（给出 id 与名字）；'
    + '② 说明"如果有人真的改掉这条，最坏会发生什么"；③ 给用户可执行的下一步。\n'
    + YING_MEN_JIN.map((x) => `- **${x.id}｜${x.ming}**：${x.guiZe}\n  最坏情况：${x.zuiHuai}`).join('\n');
}

function zhaiYao(s: string, n = 80): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const a = Array.from(t);
  return a.length <= n ? t : a.slice(0, n - 1).join('') + '…';
}
