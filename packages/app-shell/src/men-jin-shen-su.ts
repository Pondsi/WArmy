/**
 * R260 项「硬门禁误判解决方案」：申诉/复核通道（结合证据单元约束验证思路）。
 *
 * 口径（主人定稿：硬门禁优先，但门禁可能在某些情况错）：
 *  · **硬门禁（道 dao.md 等）永不可申诉**——即使提交证据也拒绝，只能用户本人在界面改。
 *  · **受保护区域误判**可申诉：宿主用同一套 protectedPathReason **二次校验**证据目标路径，
 *    若其实不在保护区（原拦截是误判）⇒ 申诉成立、一次性放行＋审计；
 *  · 若确在保护区 ⇒ 模型**不能自我放行**，交用户明确裁决（授权卡），同意才一次性放行＋审计＋告知。
 *
 * 纯函数（依赖 protected-paths 纯判定），便于真值表门禁；防滥用：限次/证据校验/用户知情由宿主侧落实。
 */
import { protectedPathReason, hardProtectedReason } from './protected-paths.js';

export interface ShenSuJieGuo {
  /** 申诉是否被受理处理（硬门禁直接 false） */
  ok: boolean;
  /** 申诉成立（复核为误判，可直接放行） */
  upheld: boolean;
  /** 需用户明确授权（确在保护区，模型不可自grant） */
  needsUser: boolean;
  reason: string;
  /** 争议目标路径（供宿主 grantProtectedOnce / 授权卡展示） */
  grantPath?: string;
}

/** 复核一条申诉：abs=争议目标绝对路径，baseDir=当前会话工作区。 */
export function shenHeShenSu(abs: string, baseDir: string): ShenSuJieGuo {
  const p = String(abs || '');
  if (!p) return { ok: false, upheld: false, needsUser: false, reason: '申诉缺少目标路径' };
  const hard = hardProtectedReason(p);
  if (hard) return { ok: false, upheld: false, needsUser: false, reason: '硬门禁不可申诉：' + hard };
  const why = protectedPathReason(p, baseDir);
  if (!why) {
    return { ok: true, upheld: true, needsUser: false, reason: '复核：目标不在受保护区域（原拦截为误判），予以放行', grantPath: p };
  }
  return { ok: true, upheld: false, needsUser: true, reason: '复核：目标确在受保护区域（' + why + '），需用户明确授权', grantPath: p };
}