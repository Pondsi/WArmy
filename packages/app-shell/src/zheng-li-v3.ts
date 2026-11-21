/**
 * zheng-li-v3 —— 语言重组V3 中文前置规则遍（R280，纯 node、可无头断言）。
 *
 * 口径（主人定稿）：
 *  · 只在界面语言为中文时启用；其他语言完全交由模型自行整理（旧模式）。
 *  · **严禁回溯/预览/保留原文恢复**：快速改完直接显示结果，用户不认可自行修改。
 *  · 规则遍只做**确定性、不改语义**的清理：语气填充词、紧邻重复/口吃、标点规范化；
 *    并提取**保护集**（数字/日期/金额/路径/URL/代码/引号/邮箱/电话/否定词），
 *    交给 LLM 遍要求逐字保留；LLM 结果缺保护集⇒回退规则遍结果（绝不回退到"原文恢复" UI）。
 *  · 不新增命题、不改事实、不改语气立场（与 ASR-CLEANUP 设计 P0/P1 同向）。
 */

/** 合法叠词（不是口吃/重复噪声），重复折叠时跳过 */
const DIE_CI_BAI = new Set(['天天', '慢慢', '看看', '谢谢', '刚刚', '常常', '往往', '仅仅', '偏偏', '悄悄', '渐渐', '连连', '频频', '屡屡', '明明', '息息', '稍稍', '略微', '频频', '默默', '偷偷', '轻轻', '重重', '高高', '低低', '大大', '小小', '多多', '少少', '好好', '坏坏', '早早', '晚晚', '快快', '慢慢', '远远', '近近', '深深', '浅浅', '真真', '假假', '是是', '非非']);

/** 语气填充词分级：纯话语标记（可直接删，不论后接什么）vs 指示/连接兼用词（仅后接标点/边界才删，防误删“那个文件”） */
const TIAN_CHONG_CHUN = '(?:嗯+|呃+|唉+|啊+|噢+|喔+|对吧|对不对|你知道吗|怎么说呢|这个嘛|就是说|就是呢|然后呢|那个)';
const TIAN_CHONG_JIAN = '(?:就是|然后)';
/** 纯话语标记的后接边界：标点/空白/结尾，或代词/能愿动词/介词（口述填充词常直接粘这些）；
 *  后接普通名词（如“那个文件”）不算填充词，保留。 */
const HOU_JIE = '(?=[，。！？；、：\\s]|$|[我你他她它咱大家要会能就都也还把被给在有是])';

export interface YuChuLiJieGuo {
  text: string;
  edits: Array<{ type: string; from: string; to: string }>;
  protected: string[];
}

/** 保护集提取：这些 span 逐字保留，LLM 不得改写/省略/翻译 */
export function baoHuJiHe(text: string): string[] {
  const t = String(text || '');
  const out: string[] = [];
  const push = (re: RegExp) => { for (const m of t.matchAll(re)) if (m[0] && m[0].trim()) out.push(m[0]); };
  push(/```[\s\S]*?```/g);
  push(/`[^`\n]+`/g);
  push(/https?:\/\/[^\s，。；）)]+/g);
  push(/[A-Za-z]:\\[^\s，。；]+/g);
  push(/(?:^|[\s（(])\/[^\s，。；）)]+/g);
  push(/\b[\w.-]+\.(?:txt|md|js|ts|json|png|jpg|jpeg|gif|pdf|docx|pptx|xlsx|csv|html|css|py|mjs|cjs|exe|zip|nm|svg|wav|mp3|mp4)\b/gi);
  push(/[\w.+-]+@[\w-]+\.[\w.]+/g);
  push(/(?<!\d)1[3-9]\d{9}(?!\d)/g);
  push(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/g);
  push(/\d{1,2}[:：]\d{2}(?:[:：]\d{2})?/g);
  push(/\d+(?:\.\d+)?\s*(?:元|块|万|亿|千|百|十|个|条|次|天|小时|分钟|秒|年|月|日|号|%|％|kg|g|km|m|cm|mm|MB|GB|KB|TB|字|行|页|轮)/g);
  push(/[一二三四五六七八九十百千万亿两]+\s*(?:元|块|万|亿|千|百|十|个|条|次|天|小时|分钟|秒|年|月|日|号|字|行|页|轮)/g);
  push(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g);
  push(/“[^”]*”/g);
  push(/"[^"\n]*"/g);
  push(/@[A-Za-z0-9_一-龥-]+/g);
  // 去重保序
  return [...new Set(out)];
}

/** 否定词计数校验：清理/改写不得减少否定词（防"意思反转"） */
export const FOU_DING_ZI = ['不', '没', '别', '勿', '未', '非', '莫'];
export function fouDingJiShu(t: string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const c of FOU_DING_ZI) o[c] = (String(t || '').match(new RegExp(c, 'g')) || []).length;
  return o;
}

/** 中文规则遍：填充词/紧邻重复/口吃/标点规范化；返回清理稿＋编辑留痕＋保护集 */
export function zhongWenYuChuLi(text: string): YuChuLiJieGuo {
  const yuan = String(text || '');
  const edits: Array<{ type: string; from: string; to: string }> = [];
  let t = yuan;
  // 1) 纯话语标记：前后边界即可删（后接内容词也删，口述填充词常直接粘内容）
  const tianChunRe = new RegExp('(^|[，。！？；、：\\s])' + TIAN_CHONG_CHUN + HOU_JIE, 'g');
  t = t.replace(tianChunRe, (m, qian) => { edits.push({ type: 'filler', from: m, to: qian }); return qian; });
  // 1b) 兼用词：仅后接标点/边界才删（保留“那个文件/就是这样”的句法用法）
  const tianJianRe = new RegExp('(^|[，。！？；、：\\s])' + TIAN_CHONG_JIAN + '(?=[，。！？；、：\\s]|$)', 'g');
  t = t.replace(tianJianRe, (m, qian) => { edits.push({ type: 'filler', from: m, to: qian }); return qian; });
  // 2) 紧邻重复/口吃折叠（跳过合法叠词；**纯数字重复不折**：2026-11-22 / 3000 里的 11/22/000 是事实）
  t = t.replace(/([一-龥A-Za-z0-9]{1,4})\1+/g, (m, dan) => {
    if (/^\d+$/.test(dan) || /^\d+$/.test(m)) return m;
    if (DIE_CI_BAI.has(dan) || DIE_CI_BAI.has(m)) return m;
    edits.push({ type: 'repetition', from: m, to: dan });
    return dan;
  });
  // 3) 标点规范化：重复逗号/句号折叠、省略号统一、去掉标点前空白、逗号紧贴句号、首尾残留标点
  t = t.replace(/[，,]{2,}/g, (m) => { edits.push({ type: 'punct', from: m, to: '，' }); return '，'; });
  t = t.replace(/(?<!\.)\.{2,}(?!\.)/g, (m) => { edits.push({ type: 'punct', from: m, to: '…' }); return '…'; });
  t = t.replace(/\s+([，。！？；、：])/g, (m, b) => { edits.push({ type: 'punct', from: m, to: b }); return b; });
  t = t.replace(/([，。！？；、：])\s+(?=[一-龥])/g, (m, b) => b);
  t = t.replace(/[，,]+([。！？])/g, (m, b) => { edits.push({ type: 'punct', from: m, to: b }); return b; });
  t = t.replace(/^[，,、：\s]+/, '');
  // 4) 首尾空白
  t = t.trim();
  return { text: t, edits, protected: baoHuJiHe(yuan) };
}

/** 校验：保护集缺失项＋否定词减少项（返回问题清单；空=通过） */
export function yanZhengBaoHu(baoHu: string[], chu: string, yuan?: string): string[] {
  const problems: string[] = [];
  const c = String(chu || '');
  for (const p of baoHu) if (p && !c.includes(p)) problems.push('protected-missing:' + p.slice(0, 40));
  if (yuan !== undefined) {
    const a = fouDingJiShu(yuan); const b = fouDingJiShu(c);
    for (const k of FOU_DING_ZI) if ((b[k] || 0) < (a[k] || 0)) problems.push('negation-lost:' + k);
  }
  return problems;
}