/**
 * diwen-integration —— 迪文化落点统一集成层（R193）。
 *
 * 一次性摸排全项目可迪文化落点，分三类（见 DIWEN_LUO_DIAN）：
 *  A 适合迪文化：结构化知识/事实，迪文带来可验证表示 + 原文回退 + 压缩；
 *  B 已结构化、增益有限：机器契约/配置已是稳定 JSON，迪文化收益小（不强改）；
 *  C 不该迪文化（红线）：append-only 日志真相、密码学载荷、用户可见自然语、自由文本。
 *
 * 所有 A 类落点共用 diwen-bridge 的三态门控（确定→迪文/不确定→原文/没有→不编）。
 * 用户可见落点一律回退原文；迪文只给机器看；S8 非安全/加密层。
 */
import { diwenHua, diwenYongHuSouSuo, gcfBianMa, diwenValidate, type DiwenHuaJieGuo } from './diwen-bridge.js';
import { fenLeiI5, i5MingOf } from './diwen-i5.js';

export type LuoDianFenLei = 'A-适合' | 'B-增益有限' | 'C-不该';
export interface LuoDian { id: string; ming: string; fenLei: LuoDianFenLei; liYou: string; yongHuKeJian?: boolean; }

/** 全项目迪文化落点摸排清单（A 适合 / B 增益有限 / C 红线不该）。 */
export const DIWEN_LUO_DIAN: LuoDian[] = [
  // ── A 适合迪文化（结构化知识/事实） ──
  { id: 'agent-comm', ming: '智能体互通（值班↔执行/本体↔分身/多智能体）', fenLei: 'A-适合', liYou: '结构化事实交换，可验证+GCF压缩；自由文本指令保留原文' },
  { id: 'kb-entry', ming: '知识库条目', fenLei: 'A-适合', liYou: '确定结构化→迪文，用户搜索回退原文', yongHuKeJian: true },
  { id: 'ctx-summary', ming: '上下文摘要/提示词总结', fenLei: 'A-适合', liYou: '机器看，结构化事实迪文化+补丁压缩' },
  { id: 'memory-gate', ming: '记忆写入口证据闸', fenLei: 'A-适合', liYou: '结构化事实写入前迪文校验作可验证层' },
  { id: 'archive-summary', ming: '归档摘要（archives/index.jsonl 结构化结论）', fenLei: 'A-适合', liYou: '归档结论迪文化，召回可验证' },
  { id: 'exchange-format', ming: '跨智能体/跨设备交换格式', fenLei: 'A-适合', liYou: 'GCF1 传输+差量补丁省 token' },
  { id: 'task-state', ming: '计划/任务状态（board.jsonl 看板）', fenLei: 'A-适合', liYou: '承诺-义务用 L4 协议状态机，违约/矛盾检测' },
  { id: 'tool-result', ming: '工具返回的结构化事实', fenLei: 'A-适合', liYou: '结构化结果迪文化校验' },
  { id: 'kb-promote', ming: '知识库升层/复盘判定', fenLei: 'A-适合', liYou: '升层时校验结构化条目真实合法' },
  { id: 'cross-sync', ming: '跨设备同步的结构化知识', fenLei: 'A-适合', liYou: '同步载荷迪文+GCF' },
  { id: 'persona-traits', ming: '人设结构化特质', fenLei: 'A-适合', liYou: '可枚举角色/职责/约束迪文化；自由文本人设保留原文' },
  { id: 'skill-contract', ming: '技能契约结构化部分', fenLei: 'A-适合', liYou: '输入/输出/权限契约可验证' },
  { id: 'smart-profile', ming: '智能档案 zhinengpeizhi 可枚举偏好', fenLei: 'A-适合', liYou: '结构化质量/偏好记录迪文化' },
  { id: 'reflection', ming: '复盘/反思结构化结论', fenLei: 'A-适合', liYou: '与归档同源，升层校验' },
  { id: 'model-meta', ming: '模型能力转交元数据', fenLei: 'A-适合', liYou: '能力声明/转交条件结构化' },
  { id: 'user-pref', ming: '用户偏好可枚举项', fenLei: 'A-适合', liYou: '可枚举偏好迪文化；自由文本保留' },
  // ── B 已结构化、增益有限（不强改） ──
  { id: 'error-contract', ming: '错误契约 GuileiCuowu', fenLei: 'B-增益有限', liYou: '已是冻结 P0 结构化契约（category/code/recoverable），迪文化收益小且动冻结契约有风险' },
  { id: 'dht-record', ming: 'DHT 服务/定位记录能力载荷', fenLei: 'B-增益有限', liYou: '已签名加密结构化记录；能力声明可迪文化作知识，但签名仍 Ed25519，S8 非安全层' },
  { id: 'settings', ming: 'settings/appearance 配置', fenLei: 'B-增益有限', liYou: '是配置不是知识，迪文化无意义' },
  { id: 'update-feed', ming: '更新 feed/latest.json', fenLei: 'B-增益有限', liYou: '机器配置非知识' },
  // ── C 不该迪文化（红线） ──
  { id: 'audit-log', ming: '审计日志/fast-memory.jsonl 原文', fenLei: 'C-不该', liYou: 'append-only 唯一事实源不可改写，迪文化破坏「日志为准」' },
  { id: 'crypto', ming: '密码学签名/加密载荷', fenLei: 'C-不该', liYou: 'S8 只防手抄漂移不防篡改，绝不替代 Ed25519/TLS' },
  { id: 'user-nl', ming: '用户可见自然语（界面/聊天回复/卡片搜索）', fenLei: 'C-不该', liYou: '用户看原文，迪文只给机器', yongHuKeJian: true },
  { id: 'free-text', ming: '自由文本指令', fenLei: 'C-不该', liYou: '无法可靠映射受控槽位，强行迪文化丢信息/编造' },
  { id: 'diag-obs', ming: 'diag.jsonl/token-observations.jsonl', fenLei: 'C-不该', liYou: '运行时观测/日志非知识，可能含敏感路径' },
];

/** A 类落点统一迪文化（机器侧）。用户可见落点请走 yongHuKeJianLuoDian。
 *  R212：agent-comm/exchange-format 额外带 I5 协作言语行为归类（承诺/质询/证据/拒绝/请求/汇报/纠错）。 */
export async function luoDianDiwenHua(luoDianId: string, input: { text?: string; doc?: any }): Promise<DiwenHuaJieGuo & { luoDian: string; i5?: { lei: string | null; ming: string } }> {
  const ld = DIWEN_LUO_DIAN.find((x) => x.id === luoDianId);
  const i5 = (luoDianId === 'agent-comm' || luoDianId === 'exchange-format')
    ? (() => { const lei = fenLeiI5(String(input?.text ?? '')); return { i5: { lei, ming: i5MingOf(lei) } }; })()
    : {};
  if (!ld) return { ...(await diwenHua(input)), luoDian: luoDianId, ...i5 };
  if (ld.fenLei === 'C-不该') return { mode: 'fallback-text', text: String(input?.text ?? ''), luoDian: luoDianId, ...i5 }; // 红线落点恒回原文
  if (ld.yongHuKeJian) return { mode: 'fallback-text', text: await diwenYongHuSouSuo(input), luoDian: luoDianId, ...i5 }; // 用户可见恒原文
  return { ...(await diwenHua(input)), luoDian: luoDianId, ...i5 };
}

/** 用户可见落点：永远只回原文（自然语）。 */
export async function yongHuKeJianLuoDian(input: { text?: string; doc?: any }): Promise<string> {
  return diwenYongHuSouSuo(input);
}

/** 交换格式落点：GCF1 编码（机器间传输）。 */
export async function jiaoHuanGeShiBianMa(doc: any): Promise<string | null> { return gcfBianMa(doc); }

/** 证据闸/升层落点：结构校验。 */
export async function zhengJuZhaJiaoYan(doc: any): Promise<{ valid: boolean; errors?: any[]; unavailable?: boolean }> { return diwenValidate(doc); }

/** 摸排统计（供门禁/文档）。 */
export function luoDianTongJi(): { A: number; B: number; C: number; total: number } {
  return {
    A: DIWEN_LUO_DIAN.filter((x) => x.fenLei === 'A-适合').length,
    B: DIWEN_LUO_DIAN.filter((x) => x.fenLei === 'B-增益有限').length,
    C: DIWEN_LUO_DIAN.filter((x) => x.fenLei === 'C-不该').length,
    total: DIWEN_LUO_DIAN.length,
  };
}