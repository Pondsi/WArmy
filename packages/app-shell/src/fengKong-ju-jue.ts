/**
 * 供应商**风控拒绝**判定（纯函数，门禁可直接跑真值表）。
 *
 * 真机事故（第 45 轮 · `verify-round18` 真跑）：MiMo 网关没有报错，而是把一句
 * `The request was rejected because it was considered high risk` 当成**助手正文**回了过来。
 * 我们照单全收：写进会话历史、`ok:true` 返回、既不换模型也不告诉用户发生了什么 ——
 * 用户看到的是一句莫名其妙的英文，工具一个没调（审计：`gongJuDiaoYongJi:0`、`tingZhiYuanYin:'stop'`）。
 * 同一条 prompt 直接打端点（带同一份「道」当 system）却正常返回 `tool_calls` ⇒ 这是网关侧的**偶发风控**，
 * 属于"这一档模型这次没做成"，应该走降级链换下一只，而不是当成回答。
 *
 * 边界（**宁漏不误**）：模型正常拒绝用户（"我不能帮你写恶意代码"）是**合法回答**，不是网关故障。
 * 所以只认"网关样板话"：短、且命中下面这些固定措辞；并且调用方必须确认本轮**没有工具调用**。
 */

/** 网关/风控样板话（都是"平台说的"，不是"模型在回答用户"） */
const FENG_KONG_MO_SHI: Array<{ re: RegExp; ming: string }> = [
  { re: /request was rejected because it was considered high risk/i, ming: 'high-risk' },
  { re: /\b(content|safety)\s+(policy|filter|moderation)\b/i, ming: 'content-policy' },
  { re: /\b(flagged|blocked|filtered)\b[^.]{0,40}\b(risk|policy|moderation|safety)\b/i, ming: 'blocked-by-moderation' },
  { re: /(风控|内容安全|安全策略|敏感词|违规内容)(拦截|拒绝|未通过|不通过)?/, ming: '风控拦截' },
  { re: /(违反|触发)了?(平台|内容|安全)(规范|政策|条款)/, ming: '违反平台规范' },
  { re: /\brisk_control\b|\bcontent_filter\b|\bmoderation_blocked\b/i, ming: '风控错误码' },
];

/** 判成"网关风控"的正文长度上限（真回答很少这么短还在讲风控） */
export const FENG_KONG_ZUI_DA_ZI = 400;

/**
 * @returns 命中的风控类型名；**空串 = 不是风控拒绝**（按正常回答处理）
 * @param p.benLunGongJuShu 本轮工具调用次数（>0 说明模型真的在干活，那句短话是过程说明，不是网关拒绝）
 */
export function panFengKongJuJue(p: { huiFu?: string; benLunGongJuShu?: number }): string {
  const wen = String(p?.huiFu || '').trim();
  if (!wen) return '';
  if (Number(p?.benLunGongJuShu) > 0) return '';
  if (wen.length > FENG_KONG_ZUI_DA_ZI) return '';
  /** 正文里还带着别的内容（例如先解释了一句再提到 policy）⇒ 不当成网关样板话 */
  for (const { re, ming } of FENG_KONG_MO_SHI) if (re.test(wen)) return ming;
  return '';
}

/**
 * 报给用户的话（带上供应商原文，别只说"失败了"）。
 * `t` 是宿主的翻译函数（`tMain`）；纯模块里不 import 语言包，缺省就用中文兜底（门禁直接调也能跑）。
 * 占位符替换在**翻译结果**上做，并且用函数式替换 —— 供应商原文里若带 `$&`/`$1`，
 * 字符串式 `.replace` 会把它当成替换模式吃掉，原文就被改写了。
 */
export function fengKongJuJueTiShi(p: {
  yuanWen: string;
  ming: string;
  yiShiBai?: string[];
  t?: (key: string, fallback: string) => string;
}): string {
  const t = p.t || ((_k: string, d: string) => d);
  const huan = (p.yiShiBai || []).filter(Boolean);
  const yuan = String(p.yuanWen || '').slice(0, 200);
  return t('chat.moderation.blocked', '云端把这一轮**拦下来了**（风控判定：{ming}），不是模型的回答，也没有执行任何工具。')
      .replace('{ming}', () => p.ming)
    + (huan.length ? t('chat.moderation.tried', '已经换过这些模型仍被拦：{list}。').replace('{list}', () => huan.join('、')) : '')
    + t('chat.moderation.raw', '\n供应商原文：{raw}').replace('{raw}', () => yuan)
    + t('chat.moderation.tip', '\n可以：换一种说法再问一次、换一个供应商/模型，或点「重试」。');
}
