/**
 * R298：开发模式硬规则 —— 机械低成本快响应约束 + 不可关闭的硬安全边界。
 *
 * 口径（计划《总结巡查预测发布闭环》§大型项目开发流程与低成本机械约束）：
 *  · 默认小批 12 文件/1000 修改行；单批机械上限 64 文件/5000 修改行；超限拆批继续，
 *    不将大型合法任务判非法，不静默放弃内容。
 *  · 快检查每切片 ≤4ms 并让出事件循环；完整构建异步且按变更范围触发。
 *  · 附加上下文默认 2000 tokens，包络 512–4096，但实际窗口 10% 上限优先，
 *    绝不为达到下限挤掉用户要求。
 *  · 自动修复同一诊断连续最多 2 次，仍失败转根因诊断/用户协助；新证据可继续新方案。
 *  · 运行命令遵守既有 1–600s 工具限制。
 *  · 硬安全始终保护凭据/用户修改/别的会话/程序目录/授权/Git 历史；开发模式不能关闭这些边界。
 *  · 测试/README/注释不能被改成恒真、删掉真实失败或跳 hook 来宣称修好。
 *  · 文件行数/复杂度阈值只提示重构，不能不经同意切文件（结构重构须下次对话询问用户）。
 *
 * 纯函数、无 IO —— 门禁直接 import 编译产物断言。
 */

export const KAI_FA_YING_BIAN_JIE = {
  /** 默认小批预算 */
  xiaoPiWenJian: 12,
  xiaoPiXiuGaiHang: 1000,
  /** 单批机械上限（超限拆批，不是非法） */
  danPiWenJianMax: 64,
  danPiXiuGaiHangMax: 5000,
  /** 快检查切片预算（ms），超过必须让出事件循环 */
  kuaiJianChaMs: 4,
  /** 同一诊断连续自动修复上限 */
  ziDongXiuFuMax: 2,
  /** 附加上下文包络与占比上限 */
  shangXiaWenMoRen: 2000,
  shangXiaWenMin: 512,
  shangXiaWenMax: 4096,
  shangXiaWenZhanBiMax: 0.10,
  /** 命令时限（沿用既有工具限制） */
  mingLingMsMin: 1000,
  mingLingMsMax: 600000,
  /** 混合执行段步骤上限（与定时一致） */
  stepsMax: 64,
} as const;

/** 不可关闭的硬安全（开发模式/软规则/总结自改进都不得越过） */
export const KAI_FA_BU_KE_GUAN = [
  'credentials',        // 凭据
  'user-modifications', // 用户修改
  'other-sessions',     // 别的会话
  'program-dir',        // 程序目录
  'authorization',      // 授权
  'git-history',        // Git 历史
  'test-truthfulness',  // 测试/README/注释真实性（不得恒真/删失败/跳 hook）
] as const;
export type KaiFaBuKeGuan = typeof KAI_FA_BU_KE_GUAN[number];

/** 批次预算判定：超小批→拆批建议；超机械上限→强制拆批；大型合法任务不判非法 */
export function jianYanPiCi(b: { files: number; lines: number }): { ok: true; chaiPi: boolean; jianYi: string } | { ok: false; error: string } {
  const f = Math.max(0, Math.floor(Number(b.files) || 0));
  const l = Math.max(0, Math.floor(Number(b.lines) || 0));
  if (!Number.isFinite(f) || !Number.isFinite(l)) return { ok: false, error: 'bad-batch' };
  const X = KAI_FA_YING_BIAN_JIE;
  if (f > X.danPiWenJianMax || l > X.danPiXiuGaiHangMax) {
    return { ok: true, chaiPi: true, jianYi: `超单批机械上限（${f}文件/${l}行 > ${X.danPiWenJianMax}/${X.danPiXiuGaiHangMax}）：拆批继续，不静默放弃内容` };
  }
  if (f > X.xiaoPiWenJian || l > X.xiaoPiXiuGaiHang) {
    return { ok: true, chaiPi: true, jianYi: `超默认小批预算（${f}文件/${l}行 > ${X.xiaoPiWenJian}/${X.xiaoPiXiuGaiHang}）：建议拆小批` };
  }
  return { ok: true, chaiPi: false, jianYi: '' };
}

/**
 * 附加上下文预算：包络 512–4096，但窗口 10% 上限优先；
 * 窗口太小时宁可低于 512，也不挤掉用户要求。
 */
export function shangXiaWenYuSuan(chuangKouTokens: number, qingQiuTokens?: number): number {
  const X = KAI_FA_YING_BIAN_JIE;
  const chuang = Math.max(0, Math.floor(Number(chuangKouTokens) || 0));
  const qing = Math.floor(Number(qingQiuTokens ?? X.shangXiaWenMoRen) || X.shangXiaWenMoRen);
  const baoLuo = Math.max(X.shangXiaWenMin, Math.min(X.shangXiaWenMax, qing));
  const shangXian = Math.floor(chuang * X.shangXiaWenZhanBiMax);
  return Math.max(0, Math.min(baoLuo, shangXian));
}

/** 同一诊断连续自动修复计数：≤2 次；超过转根因/用户协助；新证据重置（新方案） */
export function ziDongXiuFuYunXu(lianXuCiShu: number, youXinZhengJu: boolean): { yunXu: boolean; zhuanGenYin: boolean } {
  if (youXinZhengJu) return { yunXu: true, zhuanGenYin: false };
  const n = Math.max(0, Math.floor(Number(lianXuCiShu) || 0));
  return { yunXu: n < KAI_FA_YING_BIAN_JIE.ziDongXiuFuMax, zhuanGenYin: n >= KAI_FA_YING_BIAN_JIE.ziDongXiuFuMax };
}

/** 命令时限夹取（沿用既有 1–600s；开发模式不放开无限循环） */
export function mingLingShiXian(qingMs: number): number {
  const X = KAI_FA_YING_BIAN_JIE;
  const n = Number(qingMs);
  if (!Number.isFinite(n)) return 60000;
  return Math.max(X.mingLingMsMin, Math.min(X.mingLingMsMax, Math.floor(n)));
}

/** 软规则/自改进不得触碰的边界判定（白名单外的字段/动作一律拒绝） */
export function ruanGuiZePengYingBianJie(field: string, action: string): boolean {
  const ying = new Set<string>(KAI_FA_BU_KE_GUAN);
  if (ying.has(field) || ying.has(action)) return true;
  /** 权限/用户要求/提交范围/固定任务授权也不得被软规则改变 */
  if (/permission|authorization|user-requirement|commit-scope|task-grant/i.test(field + ' ' + action)) return true;
  return false;
}

/** 结构重构建议阈值：只提示，不执行（须下次对话询问用户同意） */
export function chongGouJianYi(wenJianHangShu: number, fuZaDu: number): { jianYi: boolean; liYou: string } {
  if (wenJianHangShu > 1500 || fuZaDu > 40) {
    return { jianYi: true, liYou: `文件 ${wenJianHangShu} 行/复杂度 ${fuZaDu} 超阈值：仅建议重构，须用户同意后才动结构` };
  }
  return { jianYi: false, liYou: '' };
}