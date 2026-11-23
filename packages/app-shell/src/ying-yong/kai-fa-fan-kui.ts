/**
 * R298：开发反馈归因 —— 区分"用户说过但模型理解错"与"用户没说过模型猜测不准"。
 *
 * 口径（计划《总结巡查预测发布闭环》§反馈归因与可验证自我改进）：
 *  · 每条用户修改关联任务/需求/产物/代码及测试版本；分类：显式要求未达成、假设意图纠正、
 *    新需求、用户改变要求、环境变化、未知。不能把所有修改都算模型失败。
 *  · 已说过却未落实 ⇒ 误理解证据；没说过、猜测被纠正 ⇒ 猜测误差，不追溯成用户旧要求。
 *  · "反复修未达标"需相同缺陷签名 + 验收再复现 / 重复需求证据共同支持；单凭文本相似不确认。
 *  · 保存真实返工次数/复现次数/通过/失败/未验/耗时/token；模型自述完成、没回复、权限拒绝、
 *    取消不当成功/能力失败。局部原文只保留受保护指针；可外传日志绝不含正文/凭据。
 *
 * 纯函数 + 有界记录 —— 门禁直接 import 编译产物断言。
 */

export type FanKuiFenLei = 'explicit-missed' | 'assumption-correction' | 'new-requirement' | 'user-changed' | 'environment' | 'unknown';

export interface FenLeiZhengJu {
  /** 用户此前是否明确说过该要求（有原文锚点） */
  userSaidBefore: boolean;
  /** 是否全新需求（此前从未提过） */
  isNewRequirement: boolean;
  /** 用户是否改变了先前要求 */
  userChangedMind: boolean;
  /** 是否环境变化导致（依赖/平台/外部服务） */
  environmentChanged: boolean;
}

/** 分类优先级：环境 → 用户改变 → 新需求 → 显式未达成（说过） → 猜测纠正（没说过） */
export function fenLeiFanKui(z: FenLeiZhengJu): FanKuiFenLei {
  if (z.environmentChanged) return 'environment';
  if (z.userChangedMind) return 'user-changed';
  if (z.isNewRequirement) return 'new-requirement';
  if (z.userSaidBefore) return 'explicit-missed';
  return 'assumption-correction';
}

export type FanKuiJieJu = 'pass' | 'fail' | 'unverified';
export interface KaiFaFanKuiJiLu {
  id: string;
  taskId: string;
  requirementId?: string;
  fenLei: FanKuiFenLei;
  /** 缺陷签名（规范化：文件+诊断码+行为，不含正文） */
  defectSignature?: string;
  /** 受保护指针（原文位置引用，不是正文） */
  pointer?: string;
  /** 真实结局：模型自述完成≠pass；没回复/权限拒绝/取消≠能力失败 */
  jieJu: FanKuiJieJu;
  /** 是否返工 */
  rework: boolean;
  /** 验收再复现（同一签名在验收时再次出现） */
  acceptanceRecurrence?: boolean;
  /** 重复需求证据（用户再次提出同一要求的锚点） */
  repeatedRequirement?: boolean;
  ts: number;
  tokens?: number;
  ms?: number;
}

const JI_LU_MAX = 500;

/** 有界追加（裁剪最旧；指针不含正文） */
export function zhuiJiaFanKui(lie: KaiFaFanKuiJiLu[], r: KaiFaFanKuiJiLu): KaiFaFanKuiJiLu[] {
  const next = [...lie, { ...r, pointer: r.pointer ? String(r.pointer).slice(0, 200) : undefined }];
  return next.slice(-JI_LU_MAX);
}

/**
 * 反复修未达标确认：相同缺陷签名 ≥2 次，且（验收再复现 或 重复需求证据）。
 * 单凭文本相似不确认；无签名不确认。
 */
export function chongFuQueXian(lie: KaiFaFanKuiJiLu[], signature: string): { confirmed: boolean; count: number; evidence: string[] } {
  if (!signature) return { confirmed: false, count: 0, evidence: [] };
  const tong = lie.filter((r) => r.defectSignature === signature);
  const count = tong.length;
  const youFuXian = tong.some((r) => r.acceptanceRecurrence);
  const youChongFu = tong.some((r) => r.repeatedRequirement);
  const evidence: string[] = [];
  if (count >= 2) evidence.push(`same-signature×${count}`);
  if (youFuXian) evidence.push('acceptance-recurrence');
  if (youChongFu) evidence.push('repeated-requirement');
  return { confirmed: count >= 2 && (youFuXian || youChongFu), count, evidence };
}

/** 统计：真实返工/复现/通过/失败/未验；分类分布（不把一切修改算模型失败） */
export function tongJiFanKui(lie: KaiFaFanKuiJiLu[]): {
  total: number; reworkCount: number; pass: number; fail: number; unverified: number;
  byCategory: Record<FanKuiFenLei, number>; modelFaultCount: number;
} {
  const byCategory: Record<FanKuiFenLei, number> = { 'explicit-missed': 0, 'assumption-correction': 0, 'new-requirement': 0, 'user-changed': 0, environment: 0, unknown: 0 };
  let rework = 0, pass = 0, fail = 0, unverified = 0;
  for (const r of lie) {
    byCategory[r.fenLei] = (byCategory[r.fenLei] || 0) + 1;
    if (r.rework) rework += 1;
    if (r.jieJu === 'pass') pass += 1;
    else if (r.jieJu === 'fail') fail += 1;
    else unverified += 1;
  }
  /** 模型责任只计"说过未达成"与"猜测纠正"；新需求/用户改变/环境不算模型失败 */
  const modelFaultCount = byCategory['explicit-missed'] + byCategory['assumption-correction'];
  return { total: lie.length, reworkCount: rework, pass, fail, unverified, byCategory, modelFaultCount };
}

/** 结局规范化：自述完成/没回复/权限拒绝/取消 的真实归类 */
export function guiFanJieJu(input: { modelSaidDone: boolean; verified: boolean; noReply: boolean; permissionDenied: boolean; cancelled: boolean }): FanKuiJieJu {
  if (input.cancelled || input.permissionDenied || input.noReply) return 'unverified';
  if (input.verified) return 'pass';
  if (input.modelSaidDone && !input.verified) return 'unverified'; // 自述完成不算成功
  return 'fail';
}