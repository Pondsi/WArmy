/**
 * R287 P5-2：计划步骤证据需求解析纯函数唯一 owner（自 electron-main 迁出，行为逐字保持）。
 *  · yaoQiuZiShu：从要求文本解析字数下限（100–200000，否则 0）；
 *  · buZhouXuYaoZhengJu：一步要什么证据——等待/打开/落盘格式组/作答/字数。
 *    「txt 文档」不是 Word（第 110 轮真机根因）：只认明确 docx/word 表述，泛称"文档"不替模型指定格式；
 *    只有「点名文件」且「有创建动作」才要求落盘证据。
 * 零依赖纯函数（正则），门禁可直接 import 跑断言。
 */
export type BuZhouZhengJu = { deng: boolean; kai: boolean; zu: string[][]; xie: boolean; ziShu: number; da: boolean };

export function yaoQiuZiShu(wen: string): number {
  const s = String(wen || '');
  const m = s.match(/(?:不少于|不低于|至少|最少|不低于|超过|多于|满)?\s*([0-9]{2,7})\s*(?:个)?\s*(?:字|字符|words?)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 100 && n <= 200000 ? n : 0;
}

export function buZhouXuYaoZhengJu(wen: string): BuZhouZhengJu {
  const s = String(wen || '');
  const zu: string[][] = [];
  if (/txt|文本|记事本/i.test(s)) zu.push(['txt']);
  if (/pptx?|幻灯片|演示文稿|slides?/i.test(s)) zu.push(['ppt', 'pptx']);
  /**
   * **“txt 文档”不是 Word 文档**（第 110 轮真机根因）：
   * 旧正则把泛称「文档」也当成 .docx ⇒ 计划步骤「生成桌面 txt 文档」被同时要求
   * txt 与 docx 两种证据，模型明明写出了 txt 也被 `plan_verify` 拒绝，随后触发
   * 一次完成核对，最终出现第二个“最终回复”并覆盖了第一份。
   * 这里只认明确的 Word/docx 表述；泛称“文档”不替模型指定格式。
   */
  if (/(?:\.docx\b|\bdocx\b|\bword\b|word\s*文档)/i.test(s)) zu.push(['doc', 'docx']);
  if (/xlsx?|excel|表格/i.test(s)) zu.push(['xls', 'xlsx', 'csv']);
  if (/pdf/i.test(s)) zu.push(['pdf']);
  if (/markdown|\.md\b/i.test(s)) zu.push(['md']);
  /** 只有「点名了文件」且「有创建动作」才要求落盘证据（"写一篇小说发给我"可以直接写在回复里；"打开这 2 个文件"只要打开） */
  const shiWenJian = zu.length > 0 || /文件|\bfiles?\b/i.test(s);
  const xie = shiWenJian && /生成|创建|写入|写一|写个|保存|新建|制作|做一|做个|导出|另存|\bcreate\b|\bwrite\b|\bsave\b|\bmake\b|\bexport\b/i.test(s);
  return {
    deng: /等待|等\s*\d+\s*(?:秒|分钟)|\bwait\b|\bsleep\b/i.test(s),
    kai: /打开|\bopen\b/i.test(s),
    zu: xie ? zu : [],
    xie,
    ziShu: /写|创作|撰写|编写|生成|write/i.test(s) ? yaoQiuZiShu(s) : 0,
    da: /告诉|回答|答复|说明|汇报|介绍|解释|描述|总结|回复|发给我|给我看|你是谁|我是谁|能否|是否|可以.{0,16}吗|看到|看得到|什么内容|为什么|\btell\b|\banswer\b|\bexplain\b|\bdescribe\b/i.test(s),
  };
}