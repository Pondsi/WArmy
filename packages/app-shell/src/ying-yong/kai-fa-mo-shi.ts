/**
 * R298：开发模式会话状态 + 软规则自改进管线 —— 唯一 owner。
 *
 * 口径（计划《总结巡查预测发布闭环》§开发模式入口与隔离/§反馈归因与可验证自我改进）：
 *  · 每会话独立开关，默认不勾；切会话/主窗/独立窗同步；复制/新建会话不自动开启。
 *  · 分身/值班/支线继承所属会话的规则版本，不继承别的会话。
 *  · 切换不中断在飞任务；每轮固定模式版本；危险动作核对最新权限（宿主既有授权系统）。
 *  · 检测到可能创建程序只提示是否开启（收益/风险/建议），拒绝后同任务不反复提示。
 *  · 软规则：受限 JSON 候选，字段/动作白名单，≤40 项、每项 ≤300 字符、总量 ≤8KiB；
 *    不执行生成 JS/正则，不改硬安全/权限/用户要求/提交范围/固定任务授权。
 *  · 提案→校验→隔离验证→生效版本四阶段；≥18 个可核实标注任务、固定 1/3 留出且 ≥6；
 *    任务 ID 划分落盘；留出样本不进生成提案的材料；样本不足仅建议不生效。
 *  · 验证：质量/验收失败/重复 bug 率不得恶化；至少一项效率指标改善 ≥3%；
 *    其余关键成本恶化 ≤5%；未知/样本不足/不能安全隔离 ⇒ 只建议。
 *  · 生效只更新该会话；保存原因/基线/候选证据/版本/回滚；可复现退化 ⇒ 停止候选回前版。
 *  · 结构重构建议只保存证据，下次对话询问用户；未经同意零实际重构。
 */
import { KAI_FA_BU_KE_GUAN, ruanGuiZePengYingBianJie } from '../ji-chu/kai-fa-gui-ze.js';

export interface RuanGuiZe {
  id: string;
  field: string;
  action: string;
  value: string;
  reason: string;
  version: number;
  status: 'proposed' | 'validated' | 'active' | 'rolled-back' | 'rejected' | 'suggest-only';
  evidence?: { baseline: string; candidate: string; metrics?: { qualityDelta: number; efficiencyGainPct: number; costDeltaPct: number } };
  /** 回滚指针：生效前的 active 规则快照 */
  qianBan?: RuanGuiZe | null;
  createdAt: number;
  updatedAt: number;
}
export interface KaiFaHuiHuaZhuangTai {
  enabled: boolean;
  /** 开关 CAS 版本（多窗口按 sid 合并，不整 map 覆盖） */
  version: number;
  /** 每轮固定的模式版本（软规则生效/回滚时递增） */
  modeVersion: number;
  suggestedTaskIds: string[];
  refusedTaskIds: string[];
  ruanGuiZe: RuanGuiZe[];
  /** 暂停自动优化（用户可随时停；暂停期间总结巡查不生成/不验证候选，已生效规则仍监测退化） */
  autoOptPaused?: boolean;
  liuChu?: { training: string[]; holdout: string[]; at: number };
  /** 结构重构建议（只存证据，下次对话询问） */
  chongGouJianYi?: Array<{ id: string; wenTi: string; zhengJu: string; youDian: string; queDian: string; fengXian: string; fanWei: string; yanZheng: string; huiGun: string; zhuangTai: 'pending' | 'asked' | 'agreed' | 'declined' | 'deferred'; version: number; createdAt: number }>;
}

export const RUAN_GUI_ZE_XIAN_ZHI = { xiangMax: 40, xiangZiFuMax: 300, zongZiJieMax: 8192, liuChuZuiShao: 18, liuChuHoldoutZuiShao: 6 } as const;
export const RUAN_GUI_ZE_ZI_DUAN = ['verify-order', 'context-organization', 'task-chunking', 'commit-suggestion', 'code-style', 'structure-suggestion', 'management-method', 'prompt-wording'] as const;
export const RUAN_GUI_ZE_DONG_ZUO = ['suggest', 'reorder', 'annotate', 'template'] as const;

const BAO_LIU = 200;
function kong(sid: string): KaiFaHuiHuaZhuangTai {
  return { enabled: false, version: 0, modeVersion: 1, suggestedTaskIds: [], refusedTaskIds: [], ruanGuiZe: [] };
}

export interface KaiFaMoShiYiLai {
  /** 读全量映射（main 从最新 settings.sessionDevelopment 读，按 sid 合并写回） */
  du: () => Record<string, KaiFaHuiHuaZhuangTai> | undefined;
  cun: (m: Record<string, KaiFaHuiHuaZhuangTai>) => boolean;
  now?: () => number;
}

export function chuangJianKaiFaMoShi(yiLai: KaiFaMoShiYiLai) {
  const now = yiLai.now ?? (() => Date.now());
  let map: Record<string, KaiFaHuiHuaZhuangTai> = {};
  /** 读全量映射；返回是否读到有效对象（供宿主在启动早期读失败/尚未落盘时重试） */
  function du(): boolean {
    const j = yiLai.du();
    if (j && typeof j === 'object') {
      map = {};
      for (const [sid, st] of Object.entries(j)) {
        if (!st || typeof st !== 'object') continue;
        map[sid] = { ...kong(sid), ...st, suggestedTaskIds: (st.suggestedTaskIds || []).slice(-BAO_LIU), refusedTaskIds: (st.refusedTaskIds || []).slice(-BAO_LIU), ruanGuiZe: (st.ruanGuiZe || []).slice(-RUAN_GUI_ZE_XIAN_ZHI.xiangMax * 2) };
      }
      return true;
    }
    return false;
  }
  function zhuangTai(sid: string): KaiFaHuiHuaZhuangTai {
    if (!map[sid]) map[sid] = kong(sid);
    return map[sid];
  }
  function cunSid(sid: string): boolean { return yiLai.cun(map); }

  /** 开关：CAS 版本递增；不触碰在飞任务（宿主语义）；默认关 */
  function qieHuan(sid: string, enabled: boolean, version?: number): { ok: boolean; error?: string; state?: KaiFaHuiHuaZhuangTai } {
    const st = zhuangTai(sid);
    if (version !== undefined && version !== st.version) return { ok: false, error: 'version-conflict' };
    st.enabled = !!enabled;
    st.version += 1;
    if (!cunSid(sid)) { st.enabled = !enabled; st.version -= 1; return { ok: false, error: 'persist-failed' }; }
    return { ok: true, state: { ...st } };
  }

  /** 检测到可能创建程序：只建议一次/任务；拒绝后同任务不再提示；已开启不提示 */
  function jianYiKaiQi(sid: string, taskId: string): { suggest: boolean; reason: string } {
    const st = zhuangTai(sid);
    if (st.enabled) return { suggest: false, reason: 'already-enabled' };
    if (!taskId) return { suggest: false, reason: 'no-task' };
    if (st.refusedTaskIds.includes(taskId)) return { suggest: false, reason: 'refused-for-task' };
    if (st.suggestedTaskIds.includes(taskId)) return { suggest: false, reason: 'already-suggested' };
    st.suggestedTaskIds = [...st.suggestedTaskIds, taskId].slice(-BAO_LIU);
    cunSid(sid);
    return { suggest: true, reason: '代码核验/返工减少收益；额外检查时间与模型费用成本；可能误拦正常任务；建议确定性开发任务开启' };
  }
  function juJue(sid: string, taskId: string): void {
    const st = zhuangTai(sid);
    if (taskId && !st.refusedTaskIds.includes(taskId)) st.refusedTaskIds = [...st.refusedTaskIds, taskId].slice(-BAO_LIU);
    cunSid(sid);
  }
  /** 暂停/恢复自动优化：只影响候选生成与验证，不关闭开发模式本身，不影响硬边界 */
  function zanTingZiGaiJin(sid: string, paused: boolean): { ok: boolean; state?: KaiFaHuiHuaZhuangTai } {
    const st = zhuangTai(sid);
    st.autoOptPaused = !!paused;
    if (!cunSid(sid)) { st.autoOptPaused = !paused; return { ok: false }; }
    return { ok: true, state: { ...st } };
  }
  /** 分身/值班/支线继承所属会话（只读快照；不继承别的会话） */
  function jiCheng(fuSid: string): { enabled: boolean; modeVersion: number; ruanGuiZe: RuanGuiZe[] } {
    const st = zhuangTai(fuSid);
    return { enabled: st.enabled, modeVersion: st.modeVersion, ruanGuiZe: st.ruanGuiZe.filter((r) => r.status === 'active').map((r) => ({ ...r })) };
  }

  /* ── 留出划分：任务 ID 落盘，固定 1/3，重启同一划分 ── */
  function liuChuHuaFen(sid: string, taskIds: string[]): { ok: boolean; error?: string; training?: string[]; holdout?: string[] } {
    const st = zhuangTai(sid);
    const ids = [...new Set(taskIds.filter((x) => typeof x === 'string' && x))];
    if (st.liuChu && st.liuChu.training.length + st.liuChu.holdout.length >= RUAN_GUI_ZE_XIAN_ZHI.liuChuZuiShao) {
      /** 已有划分：只追加新任务（按同一序号规则），不重洗旧划分 */
      const yiYou = new Set([...st.liuChu.training, ...st.liuChu.holdout]);
      let xu = st.liuChu.training.length + st.liuChu.holdout.length;
      for (const id of ids) {
        if (yiYou.has(id)) continue;
        if (xu % 3 === 0) st.liuChu.holdout.push(id); else st.liuChu.training.push(id);
        xu += 1;
      }
      cunSid(sid);
      return { ok: true, training: [...st.liuChu.training], holdout: [...st.liuChu.holdout] };
    }
    if (ids.length < RUAN_GUI_ZE_XIAN_ZHI.liuChuZuiShao) return { ok: false, error: 'insufficient-samples（≥18 个可核实标注任务才生效；不足仅建议）' };
    const training: string[] = [], holdout: string[] = [];
    ids.forEach((id, i) => { if (i % 3 === 0) holdout.push(id); else training.push(id); });
    if (holdout.length < RUAN_GUI_ZE_XIAN_ZHI.liuChuHoldoutZuiShao) return { ok: false, error: 'holdout-too-small' };
    st.liuChu = { training, holdout, at: now() };
    cunSid(sid);
    return { ok: true, training, holdout };
  }

  /* ── 软规则候选校验 ── */
  function jianYanHouXuan(raw: unknown): { ok: true; value: { field: string; action: string; value: string; reason: string } } | { ok: false; error: string } {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad-candidate' };
    const o = raw as Record<string, unknown>;
    const field = String(o['field'] || ''), action = String(o['action'] || ''), value = String(o['value'] ?? ''), reason = String(o['reason'] || '');
    if (!(RUAN_GUI_ZE_ZI_DUAN as readonly string[]).includes(field)) return { ok: false, error: 'field-not-whitelisted' };
    if (!(RUAN_GUI_ZE_DONG_ZUO as readonly string[]).includes(action)) return { ok: false, error: 'action-not-whitelisted' };
    if (ruanGuiZePengYingBianJie(field, action)) return { ok: false, error: 'touches-hard-boundary' };
    if (!value || value.length > RUAN_GUI_ZE_XIAN_ZHI.xiangZiFuMax) return { ok: false, error: 'value-bounds' };
    if (!reason || reason.length > RUAN_GUI_ZE_XIAN_ZHI.xiangZiFuMax) return { ok: false, error: 'reason-bounds' };
    /** 不执行生成 JS/正则：候选值只是数据，含可执行形态一律拒绝 */
    if (/```|function\s*\(|=>|eval\(|new\s+RegExp|require\(|import\s/.test(value)) return { ok: false, error: 'executable-content-rejected' };
    return { ok: true, value: { field, action, value, reason } };
  }

  /** 提案：校验 + 留出隔离（材料不得含留出样本）+ 总量界 */
  function tiAn(sid: string, raw: unknown, caiLiaoTaskIds: string[]): { ok: boolean; error?: string; rule?: RuanGuiZe } {
    const st = zhuangTai(sid);
    const j = jianYanHouXuan(raw);
    if (!j.ok) return { ok: false, error: j.error };
    if (!st.liuChu) return { ok: false, error: 'no-holdout-split（先划分留出集；样本不足仅建议）' };
    const holdout = new Set(st.liuChu.holdout);
    if (caiLiaoTaskIds.some((id) => holdout.has(id))) return { ok: false, error: 'holdout-leaked-into-material' };
    const zhanYong = st.ruanGuiZe.filter((r) => r.status === 'proposed' || r.status === 'active' || r.status === 'validated');
    if (zhanYong.length >= RUAN_GUI_ZE_XIAN_ZHI.xiangMax) return { ok: false, error: 'too-many-rules' };
    const zong = JSON.stringify([...zhanYong, j.value]).length;
    if (zong > RUAN_GUI_ZE_XIAN_ZHI.zongZiJieMax) return { ok: false, error: 'total-size-exceeded' };
    const n = now();
    const rule: RuanGuiZe = { id: 'rf-' + n.toString(36) + '-' + Math.random().toString(36).slice(2, 6), ...j.value, version: 1, status: 'proposed', createdAt: n, updatedAt: n };
    st.ruanGuiZe.push(rule);
    cunSid(sid);
    return { ok: true, rule: { ...rule } };
  }

  /** 隔离验证裁决：质量不恶化 + 效率 ≥3% + 成本 ≤5%；未知/不能隔离 ⇒ 只建议 */
  function yanZheng(sid: string, ruleId: string, metrics: { qualityDelta: number; efficiencyGainPct: number; costDeltaPct: number; unknown?: boolean; geLi?: boolean; baseline: string; candidate: string }): { ok: boolean; error?: string; status?: RuanGuiZe['status'] } {
    const st = zhuangTai(sid);
    const r = st.ruanGuiZe.find((x) => x.id === ruleId);
    if (!r || r.status !== 'proposed') return { ok: false, error: 'not-proposed' };
    r.evidence = { baseline: String(metrics.baseline || '').slice(0, 300), candidate: String(metrics.candidate || '').slice(0, 300), metrics: { qualityDelta: metrics.qualityDelta, efficiencyGainPct: metrics.efficiencyGainPct, costDeltaPct: metrics.costDeltaPct } };
    r.updatedAt = now();
    if (metrics.unknown || metrics.geLi === false) { r.status = 'suggest-only'; cunSid(sid); return { ok: true, status: 'suggest-only' }; }
    if (!(metrics.qualityDelta >= 0)) { r.status = 'rejected'; cunSid(sid); return { ok: false, error: 'quality-degraded', status: 'rejected' }; }
    if (!(metrics.efficiencyGainPct >= 3)) { r.status = 'rejected'; cunSid(sid); return { ok: false, error: 'efficiency-below-3pct', status: 'rejected' }; }
    if (!(metrics.costDeltaPct <= 5)) { r.status = 'rejected'; cunSid(sid); return { ok: false, error: 'cost-above-5pct', status: 'rejected' }; }
    r.status = 'validated';
    cunSid(sid);
    return { ok: true, status: 'validated' };
  }

  /** 生效：只更新该会话；保存前版回滚指针；模式版本递增（下一轮固定使用） */
  function shengXiao(sid: string, ruleId: string): { ok: boolean; error?: string } {
    const st = zhuangTai(sid);
    const r = st.ruanGuiZe.find((x) => x.id === ruleId);
    if (!r || r.status !== 'validated') return { ok: false, error: 'not-validated' };
    const qian = st.ruanGuiZe.find((x) => x.status === 'active' && x.field === r.field) || null;
    r.qianBan = qian ? { ...qian } : null;
    if (qian) qian.status = 'rolled-back';
    r.status = 'active';
    r.updatedAt = now();
    st.modeVersion += 1;
    if (!cunSid(sid)) { r.status = 'validated'; if (qian) qian.status = 'active'; st.modeVersion -= 1; return { ok: false, error: 'persist-failed' }; }
    return { ok: true };
  }

  /** 回滚（手动或监测到可复现退化）：回到前版，模式版本递增 */
  function huiGun(sid: string, ruleId: string, reason: string): { ok: boolean; error?: string } {
    const st = zhuangTai(sid);
    const r = st.ruanGuiZe.find((x) => x.id === ruleId);
    if (!r || r.status !== 'active') return { ok: false, error: 'not-active' };
    r.status = 'rolled-back';
    r.reason = `${r.reason}（回滚：${String(reason).slice(0, 120)}）`;
    r.updatedAt = now();
    if (r.qianBan) {
      const qian = st.ruanGuiZe.find((x) => x.id === r.qianBan!.id);
      if (qian) { qian.status = 'active'; qian.updatedAt = now(); }
    }
    st.modeVersion += 1;
    cunSid(sid);
    return { ok: true };
  }
  /** 生效后监测：可复现退化 ⇒ 自动回滚（条件性改进，不宣称永久） */
  function jianCeTuiHua(sid: string, ruleId: string, metrics: { qualityDelta: number; keFuXian: boolean }): { rolledBack: boolean } {
    if (metrics.keFuXian && metrics.qualityDelta < 0) { huiGun(sid, ruleId, '监测到可复现退化'); return { rolledBack: true }; }
    return { rolledBack: false };
  }

  /* ── 结构重构建议：只存证据，下次对话询问；同问题/版本去重；拒绝后不催促 ── */
  function baoCunChongGouJianYi(sid: string, j: { id: string; wenTi: string; zhengJu: string; youDian: string; queDian: string; fengXian: string; fanWei: string; yanZheng: string; huiGun: string }): { ok: boolean; dedup?: boolean } {
    const st = zhuangTai(sid);
    st.chongGouJianYi = st.chongGouJianYi || [];
    if (st.chongGouJianYi.some((x) => x.id === j.id)) return { ok: true, dedup: true };
    st.chongGouJianYi.push({ ...j, zhuangTai: 'pending', version: 1, createdAt: now() });
    st.chongGouJianYi = st.chongGouJianYi.slice(-50);
    cunSid(sid);
    return { ok: true };
  }
  function chongGouJueDing(sid: string, id: string, jue: 'agreed' | 'declined' | 'deferred'): { ok: boolean } {
    const st = zhuangTai(sid);
    const j = (st.chongGouJianYi || []).find((x) => x.id === id);
    if (!j) return { ok: false };
    j.zhuangTai = jue;
    cunSid(sid);
    return { ok: true };
  }
  /** 下次对话取待询问建议（asked 后不再重复催） */
  function daiXunWen(sid: string): Array<{ id: string; wenTi: string; youDian: string; queDian: string; fengXian: string; fanWei: string; yanZheng: string; huiGun: string }> {
    const st = zhuangTai(sid);
    return (st.chongGouJianYi || []).filter((x) => x.zhuangTai === 'pending').map((x) => ({ id: x.id, wenTi: x.wenTi, youDian: x.youDian, queDian: x.queDian, fengXian: x.fengXian, fanWei: x.fanWei, yanZheng: x.yanZheng, huiGun: x.huiGun }));
  }
  function biaoJiYiXunWen(sid: string, id: string): void {
    const st = zhuangTai(sid);
    const j = (st.chongGouJianYi || []).find((x) => x.id === id);
    if (j && j.zhuangTai === 'pending') { j.zhuangTai = 'asked'; cunSid(sid); }
  }

  return {
    du, zhuangTai, qieHuan, jianYiKaiQi, juJue, zanTingZiGaiJin, jiCheng,
    liuChuHuaFen, jianYanHouXuan, tiAn, yanZheng, shengXiao, huiGun, jianCeTuiHua,
    baoCunChongGouJianYi, chongGouJueDing, daiXunWen, biaoJiYiXunWen,
    yingBianJie: KAI_FA_BU_KE_GUAN,
  };
}
export type KaiFaMoShi = ReturnType<typeof chuangJianKaiFaMoShi>;