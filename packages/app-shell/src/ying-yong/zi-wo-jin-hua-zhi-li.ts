/**
 * R298：自我改进治理 owner（用户 2026-11-23 十项口径）。
 *
 * 硬门禁（违背 ⇒ 直接拒绝、静默丢弃，仅审计）：
 *  H1 可改进/可自我进化/可自行调整的内容**必须**自我改进（单方面停止改进 ⇒ 拒）；
 *  H2 不可违背安全性原则（凭据/用户修改/别的会话/程序目录/授权/Git 历史/测试真实性）；
 *  H9 进化必须朝正方向：应用类提案须有有效且非负的证据（无证据/退化 ⇒ 拒，不应用）。
 * 软门禁（违背 ⇒ 向用户提出申请，批准后才执行）：
 *  S3 可改进清单的添加/删除（清单本身不是硬门禁，可增删，但须用户批准）；
 *  S10 正方向定义必须有（软门禁），其修改须用户批准。
 * 嵌套进化（#7/#8）：自我改进方法本身也被自我改进；嵌套深度 ≤3，
 *  超过 ⇒ 归纳/重算，合并为 1–2 层（保留链首尾证据，中间节点标记 merged）。
 *
 * 纯函数 + 有界状态；门禁直接 import 编译产物断言。
 */
import { KAI_FA_BU_KE_GUAN } from '../ji-chu/kai-fa-gui-ze.js';

export type JinHuaZhongLei = 'prediction' | 'evolution' | 'quality' | 'policy' | 'transform' | 'meta';
export interface ZhengFangXiang { zhiBiao: string; fangXiang: 'max' | 'min'; dingYi: string }
export interface JinHuaXiangMu { id: string; ming: string; zhongLei: JinHuaZhongLei; zhengFangXiang: ZhengFangXiang; cengJi: number }

/** 软门禁 #3：当前程序内全部自我改进/进化/改造/调整内容的统计清单（可经批准增删）。 */
export const JIN_HUA_QING_DAN: JinHuaXiangMu[] = [
  { id: 'lu-you-yu-ce', ming: '路由预测参数自优化', zhongLei: 'prediction', zhengFangXiang: { zhiBiao: '留出回放质量', fangXiang: 'max', dingYi: '质量不恶化且延迟成本≤+5%（隔离回放证据）' }, cengJi: 1 },
  { id: 'eta-yu-ce', ming: 'ETA 预测钳制/拆分自优化', zhongLei: 'prediction', zhengFangXiang: { zhiBiao: '预测误差', fangXiang: 'min', dingYi: '|预测−实际| 收敛（条件分桶+收缩估计）' }, cengJi: 1 },
  { id: 'harness-zi-jin-hua', ming: 'Harness 守卫自进化（启用/停用/更换/分句器）', zhongLei: 'evolution', zhengFangXiang: { zhiBiao: '净收益', fangXiang: 'max', dingYi: 'netTokens 省增加且失败不增；持续负收益自动停用' }, cengJi: 1 },
  { id: 'zi-qu-zhi-liang', ming: '自驱质量元素进化（UCB1）', zhongLei: 'quality', zhengFangXiang: { zhiBiao: '用户反馈奖励', fangXiang: 'max', dingYi: '奖励均值提升（次线性遗憾）；约束经裁决只收紧' }, cengJi: 1 },
  { id: 'kai-fa-ruan-gui-ze', ming: '开发模式会话软规则', zhongLei: 'policy', zhengFangXiang: { zhiBiao: '验证效率', fangXiang: 'max', dingYi: '质量不恶化+效率≥3%+成本≤5%；无隔离证据⇒仅建议' }, cengJi: 1 },
  { id: 'gong-zuo-liang-aimd', ming: '总结工作量判断（AIMD）', zhongLei: 'policy', zhengFangXiang: { zhiBiao: '前台影响', fangXiang: 'min', dingYi: '前台 p95 影响≤5% 且批量吞吐不塌' }, cengJi: 1 },
  { id: 'diwen-fen-pi', ming: '迪文确定性内容分批改造', zhongLei: 'transform', zhengFangXiang: { zhiBiao: '改造覆盖率', fangXiang: 'max', dingYi: '覆盖率提升且零信息丢失（原文永在）不变量' }, cengJi: 1 },
  { id: 'ni-tai-zi-gai', ming: '拟态频率/动作/回复与设备使用自改进', zhongLei: 'evolution', zhengFangXiang: { zhiBiao: '有反馈帮助质量', fangXiang: 'max', dingYi: '减少无价值打扰、失败不增；设备权限与仲裁不可学习覆盖' }, cengJi: 1 },
  { id: 'jin-hua-zhi-li', ming: '自我改进治理方法本身（元进化）', zhongLei: 'meta', zhengFangXiang: { zhiBiao: '治理有效性', fangXiang: 'max', dingYi: '验收通过率升/回归数降；嵌套≤3 层' }, cengJi: 1 },
];

export const JIN_HUA_YING_MEN = ['must-improve', 'safety-first', 'positive-direction'] as const;
export const JIN_HUA_RUAN_MEN = ['inventory-membership', 'positive-definition'] as const;
export const QIAN_TAO_SHANG_XIAN = 3;
export const JI_LU_SHANG = 200;

export interface JinHuaZhengJu { qian: number; hou: number; youXiao?: boolean }
export interface JinHuaTiAn {
  xiangMuId: string;
  leiXing: 'improve' | 'add' | 'remove' | 'redefine-positive' | 'meta-improve' | 'stop-improving';
  anQuanYingXiang?: string[];
  zhengJu?: JinHuaZhengJu;
  fuId?: string;
  neiRong?: string;
  xinDingYi?: ZhengFangXiang;
  xinXiangMu?: JinHuaXiangMu;
}
export type JinHuaCaiJue =
  | { ok: true; xuYaoPiZhun: false; xuYaoGuiBing?: boolean; liYou: string }
  | { ok: true; xuYaoPiZhun: true; ruan: string[]; liYou: string }
  | { ok: false; jingMo: true; ying: string[]; liYou: string };

/** 门禁裁决（纯函数）：硬违⇒静默拒；软违⇒须批准；嵌套>3⇒须归纳合并。 */
export function pingGuJinHua(tiAn: JinHuaTiAn, qingDan: JinHuaXiangMu[], fuCengJi: number): JinHuaCaiJue {
  const ying: string[] = [];
  const anQuan = (tiAn.anQuanYingXiang || []).filter((x) => (KAI_FA_BU_KE_GUAN as readonly string[]).includes(String(x)));
  if (anQuan.length) ying.push('safety-first');
  if (tiAn.leiXing === 'stop-improving') ying.push('must-improve');
  const xiang = qingDan.find((x) => x.id === tiAn.xiangMuId);
  if ((tiAn.leiXing === 'improve' || tiAn.leiXing === 'meta-improve') && xiang) {
    const z = tiAn.zhengJu;
    if (!z || z.youXiao === false || !Number.isFinite(z.qian) || !Number.isFinite(z.hou)) ying.push('positive-direction');
    else {
      const delta = xiang.zhengFangXiang.fangXiang === 'min' ? z.qian - z.hou : z.hou - z.qian;
      if (!(delta >= 0)) ying.push('positive-direction');
    }
  }
  if (ying.length) return { ok: false, jingMo: true, ying, liYou: '硬门禁违背，静默丢弃：' + ying.join(',') };
  const ruan: string[] = [];
  if (tiAn.leiXing === 'add' || tiAn.leiXing === 'remove') ruan.push('inventory-membership');
  if (tiAn.leiXing === 'redefine-positive') ruan.push('positive-definition');
  if (ruan.length) return { ok: true, xuYaoPiZhun: true, ruan, liYou: '软门禁须用户批准：' + ruan.join(',') };
  if (tiAn.leiXing === 'meta-improve' && fuCengJi + 1 > QIAN_TAO_SHANG_XIAN) {
    return { ok: true, xuYaoPiZhun: false, xuYaoGuiBing: true, liYou: '嵌套超 3 层，须归纳重算合并为 1–2 层' };
  }
  return { ok: true, xuYaoPiZhun: false, liYou: '通过' };
}

export interface JinHuaJiLu { id: string; xiangMuId: string; leiXing: string; fuId?: string; cengJi: number; ts: number; zhengJu?: JinHuaZhengJu; zhuangTai: 'applied' | 'merged' | 'declined' }
export interface JinHuaPiZhun { id: string; tiAn: JinHuaTiAn; ruan: string[]; ts: number; zhuangTai: 'pending' | 'agreed' | 'declined' }
export interface JinHuaZhuangTai { qingDan: JinHuaXiangMu[]; jiLu: JinHuaJiLu[]; piZhun: JinHuaPiZhun[] }

export function kongJinHua(): JinHuaZhuangTai { return { qingDan: JIN_HUA_QING_DAN.map((x) => ({ ...x, zhengFangXiang: { ...x.zhengFangXiang } })), jiLu: [], piZhun: [] }; }

/** 链深：沿 fuId 上溯（有界防环）。 */
export function cengJiOf(jiLu: JinHuaJiLu[], fuId?: string): number {
  let n = 0; let cur = fuId; const seen = new Set<string>();
  while (cur && !seen.has(cur) && n <= JI_LU_SHANG) { seen.add(cur); const r = jiLu.find((x) => x.id === cur); if (!r) break; n = Math.max(n, r.cengJi); cur = r.fuId; }
  return n;
}

/** 归纳合并（#8）：深度>3 的链 ⇒ 链首尾证据聚合为一条 depth1 派生记录，中间节点 merged。 */
export function guiBingHeBing(jiLu: JinHuaJiLu[]): { jiLu: JinHuaJiLu[]; heBing: number } {
  const out = jiLu.map((x) => ({ ...x }));
  let heBing = 0;
  const byId = new Map(out.map((x) => [x.id, x]));
  for (const r of out) {
    if (r.zhuangTai !== 'applied' || r.cengJi <= QIAN_TAO_SHANG_XIAN) continue;
    // 上溯链尾→链首
    const chain: JinHuaJiLu[] = [r];
    let cur = r.fuId; const seen = new Set<string>([r.id]);
    while (cur && !seen.has(cur)) { seen.add(cur); const p = byId.get(cur); if (!p) break; chain.push(p); cur = p.fuId; }
    if (chain.length <= QIAN_TAO_SHANG_XIAN) continue;
    const shou = chain[chain.length - 1];
    const wei = chain[0];
    if (!shou || !wei) continue;
    const ju: JinHuaZhengJu | undefined = shou.zhengJu && wei.zhengJu ? { qian: shou.zhengJu.qian, hou: wei.zhengJu.hou, youXiao: shou.zhengJu.youXiao !== false && wei.zhengJu.youXiao !== false } : undefined;
    for (const c of chain) c.zhuangTai = 'merged';
    out.push({ id: 'hb-' + r.id, xiangMuId: r.xiangMuId, leiXing: 'meta-improve', cengJi: 1, ts: r.ts, zhengJu: ju, zhuangTai: 'applied' });
    heBing++;
  }
  return { jiLu: out.slice(-JI_LU_SHANG), heBing };
}

export interface JinHuaYiLai {
  du: () => unknown;
  cun: (j: JinHuaZhuangTai) => void;
  now?: () => number;
  audit?: (op: string, d: unknown) => void;
  /** 软门禁申请通知（系统消息）；批准动作由宿主 IPC 回调 piZhun。 */
  qingQiuPiZhun?: (p: JinHuaPiZhun) => void;
}

export function chuangJianJinHuaZhiLi(yiLai: JinHuaYiLai) {
  const now = yiLai.now ?? (() => Date.now());
  let st: JinHuaZhuangTai = kongJinHua();
  try {
    const j = yiLai.du() as Partial<JinHuaZhuangTai> | undefined;
    if (j && typeof j === 'object') {
      st = {
        qingDan: Array.isArray(j.qingDan) ? j.qingDan.filter((x) => x && x.id && x.zhengFangXiang) : st.qingDan,
        jiLu: Array.isArray(j.jiLu) ? j.jiLu.slice(-JI_LU_SHANG) : [],
        piZhun: Array.isArray(j.piZhun) ? j.piZhun.slice(-50) : [],
      };
    }
  } catch { /* 损坏按默认清单 */ }
  let xu = 0;
  const idOf = (q: string) => q + '-' + now().toString(36) + '-' + (++xu);
  function luoPan() { try { yiLai.cun(st); } catch { /* noop */ } }

  /** 提交提案：硬违静默拒；软违挂批准；通过即记录（meta 超层先合并）。 */
  function tiAnChuLi(tiAn: JinHuaTiAn): { caiJue: JinHuaCaiJue; piZhunId?: string; jiLuId?: string } {
    const fuCeng = cengJiOf(st.jiLu, tiAn.fuId);
    const caiJue = pingGuJinHua(tiAn, st.qingDan, fuCeng);
    if (!caiJue.ok) {
      yiLai.audit?.('jinHua.rejected', { xiangMuId: tiAn.xiangMuId, leiXing: tiAn.leiXing, ying: caiJue.ying });
      return { caiJue };
    }
    if (caiJue.xuYaoPiZhun) {
      const p: JinHuaPiZhun = { id: idOf('pz'), tiAn, ruan: caiJue.ruan, ts: now(), zhuangTai: 'pending' };
      st.piZhun = [...st.piZhun, p].slice(-50);
      luoPan();
      yiLai.qingQiuPiZhun?.(p);
      yiLai.audit?.('jinHua.approval-requested', { id: p.id, ruan: caiJue.ruan });
      return { caiJue, piZhunId: p.id };
    }
    if (caiJue.xuYaoGuiBing) {
      /* 把待应用节点并入链后归纳重算：链首尾证据聚合为 depth1 派生记录，中间节点 merged */
      const linShi: JinHuaJiLu = { id: idOf('jh'), xiangMuId: tiAn.xiangMuId, leiXing: 'meta-improve', fuId: tiAn.fuId, cengJi: fuCeng + 1, ts: now(), zhengJu: tiAn.zhengJu, zhuangTai: 'applied' };
      const r = guiBingHeBing([...st.jiLu, linShi]);
      st.jiLu = r.jiLu;
      luoPan();
      yiLai.audit?.('jinHua.meta-merged', { heBing: r.heBing });
      return { caiJue, jiLuId: 'hb-' + linShi.id };
    }
    return { caiJue, jiLuId: yingYong(tiAn, fuCeng) };
  }

  /** 应用（仅经裁决通过或批准后调用）：记录证据与层级；正方向由裁决保证。 */
  function yingYong(tiAn: JinHuaTiAn, fuCeng?: number): string {
    const ceng = tiAn.leiXing === 'meta-improve' ? Math.min(QIAN_TAO_SHANG_XIAN, (fuCeng ?? cengJiOf(st.jiLu, tiAn.fuId)) + 1) : 1;
    const r: JinHuaJiLu = { id: idOf('jh'), xiangMuId: tiAn.xiangMuId, leiXing: tiAn.leiXing, fuId: tiAn.fuId, cengJi: ceng, ts: now(), zhengJu: tiAn.zhengJu, zhuangTai: 'applied' };
    st.jiLu = [...st.jiLu, r].slice(-JI_LU_SHANG);
    if (tiAn.leiXing === 'redefine-positive' && tiAn.xinDingYi) {
      const x = st.qingDan.find((y) => y.id === tiAn.xiangMuId);
      if (x) x.zhengFangXiang = { ...tiAn.xinDingYi };
    }
    if (tiAn.leiXing === 'add' && tiAn.xinXiangMu && !st.qingDan.some((y) => y.id === tiAn.xinXiangMu!.id)) {
      st.qingDan = [...st.qingDan, { ...tiAn.xinXiangMu, cengJi: 1 }];
    }
    if (tiAn.leiXing === 'remove') st.qingDan = st.qingDan.filter((y) => y.id !== tiAn.xiangMuId);
    luoPan();
    yiLai.audit?.('jinHua.applied', { id: r.id, xiangMuId: tiAn.xiangMuId, leiXing: tiAn.leiXing, cengJi: ceng });
    return r.id;
  }

  /** 用户批准/拒绝软门禁申请；批准后才执行。 */
  function piZhun(id: string, agreed: boolean): { ok: boolean; jiLuId?: string } {
    const p = st.piZhun.find((x) => x.id === id);
    if (!p || p.zhuangTai !== 'pending') return { ok: false };
    let jiLuId: string | undefined;
    if (agreed) {
      /* 批准时重验当前清单与硬门禁；期间环境/规则变化不能让旧申请绕过安全。 */
      const caiJue = pingGuJinHua(p.tiAn, st.qingDan, cengJiOf(st.jiLu, p.tiAn.fuId));
      if (!caiJue.ok) {
        p.zhuangTai = 'declined';
        yiLai.audit?.('jinHua.approval-hard-rejected', { id, ying: caiJue.ying });
      } else jiLuId = yingYong(p.tiAn);
    } else {
      p.zhuangTai = 'declined';
      st.jiLu = [...st.jiLu, { id: idOf('jh'), xiangMuId: p.tiAn.xiangMuId, leiXing: p.tiAn.leiXing, cengJi: 1, ts: now(), zhuangTai: 'declined' as const }].slice(-JI_LU_SHANG);
    }
    luoPan();
    yiLai.audit?.('jinHua.approval-decided', { id, agreed });
    return { ok: true, jiLuId };
  }

  /** 子系统应用登记（观测＋正方向追踪）：已有自身证据闸的子系统在此留痕。 */
  function jiLuYingYong(xiangMuId: string, zhengJu: JinHuaZhengJu, fuId?: string): string | null {
    const xiang = st.qingDan.find((x) => x.id === xiangMuId);
    if (!xiang) return null;
    const delta = xiang.zhengFangXiang.fangXiang === 'min' ? zhengJu.qian - zhengJu.hou : zhengJu.hou - zhengJu.qian;
    if (!(delta >= 0) || zhengJu.youXiao === false) {
      yiLai.audit?.('jinHua.regress-blocked', { xiangMuId, delta });
      return null;
    }
    return yingYong({ xiangMuId, leiXing: 'improve', zhengJu, fuId });
  }

  return {
    tiAnChuLi, piZhun, jiLuYingYong,
    qingDanCha: () => ({ qingDan: st.qingDan.map((x) => ({ ...x })), jiLu: st.jiLu.slice(-50), piZhun: st.piZhun.filter((x) => x.zhuangTai === 'pending') }),
    zhuangTai: () => st,
  };
}
export type JinHuaZhiLi = ReturnType<typeof chuangJianJinHuaZhiLi>;