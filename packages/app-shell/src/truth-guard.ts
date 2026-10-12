/**
 * truth-guard.ts —— **「嘴上说做了、实际一次工具都没调」的如实性判定**
 *
 * 真机事故（2026-10-12 04:07）：用户让牛马"在桌面生成 txt + ppt，然后打开让我验收"，
 * 模型**一次工具都没调**（审计 `chat.tools.done | gongJuDiaoYongJi: 0`），却在回复里写
 * 「📄 桌面文件已生成并打开 ✅ 请老板验收」——桌面上那两个文件其实是上一轮的旧文件，
 * 第四列的「文件产物」当然是空的。用户看到的是"它说做了、但什么都没有"。
 *
 * 这类失败比"工具报错"更糟：报错至少是诚实的。所以要在**返回给用户之前**把它逮住，
 * 由上层：① 如实告知"本轮没有实际执行"；② 触发一次"直接调用工具"的续派（真的去做）。
 *
 * 纯函数、零依赖 —— 便于门禁直接测（见 scripts/verify-truth-guard.mjs）。
 */

/** 回复里"声称已经做过文件操作"的说法（过去式/完成态） */
const CHENG_DAN_DONG_ZUO = /(已|已经|均已|全都)?\s*(生成|写入|写好|写好了|保存|创建|新建|制作|导出|转换成|打开|打开好)(了|完成|好了|成功)?|已生成|已写入|已保存|已创建|已打开|已导出|✅\s*(文件|已)|文件[^\n]{0,12}(已生成|已保存|已打开)/;

/** 被提到的"文件/产物"迹象（说明这轮本该用到文件工具） */
const WEN_JIAN_JI_XIANG = /(文件|文本|文档|表格|幻灯片|演示|截图|图片|txt|docx?|xlsx?|pptx?|pdf|csv|md|pptx|桌面|Desktop|路径|目录|保存到|写到|导出)/i;

/** 用户话里"要我动手做东西"的迹象（判定"这轮本该调用工具"） */
export const YAO_DONG_SHOU = /(生成|写入|写好|保存|创建|新建|制作|导出|打开|下载|安装|跑一下|执行|改一下|改成|整理|汇总|翻译|画一张|做一?个|写一?个|写一?篇|帮我做|帮我写)/;

export interface KouTouPanDing {
  /** true = 嘴上说做了、实际没调工具 */
  kouTou: boolean;
  /** 一句话理由（进审计/诊断，不编） */
  liYou: string;
}

/**
 * 判定"口头完成"。
 * @param reply 本轮助手回复正文
 * @param yongHuWen 本轮用户说的原文（用来判断"这轮本该动手"）
 * @param gongJuCiShu 本轮**实际**工具调用次数（审计里的 `gongJuDiaoYongJi`）
 */
export function panKouTouWanCheng(reply: string, yongHuWen: string, gongJuCiShu: number): KouTouPanDing {
  const hui = String(reply || '');
  const wen = String(yongHuWen || '');
  if (!hui.trim()) return { kouTou: false, liYou: 'empty-reply' };
  if (gongJuCiShu > 0) return { kouTou: false, liYou: 'has-tool-calls' };
  // 这轮用户要求的是"动手做"（不是纯聊天问答），且回复里出现了文件/产物字样
  const yaoDongShou = YAO_DONG_SHOU.test(wen);
  if (!yaoDongShou) return { kouTou: false, liYou: 'no-action-ask' };
  if (!WEN_JIAN_JI_XIANG.test(hui) && !WEN_JIAN_JI_XIANG.test(wen)) return { kouTou: false, liYou: 'no-artifact-talk' };
  if (!CHENG_DAN_DONG_ZUO.test(hui)) return { kouTou: false, liYou: 'no-completion-claim' };
  return { kouTou: true, liYou: 'claimed-done-without-tools' };
}

/** 给用户看的如实说明（追加在回复末尾，措辞与「异常通知」区分开，别让它看起来像能力不足） */
export function kouTouTiShi(): string {
  return '\n\n⚠️ 【如实说明】本轮我**没有实际调用任何工具**（write_file / make_docx / make_pptx / open_path 等都没跑），'
    + '上面提到的"已生成/已打开"并没有真的发生 —— 文件不会凭空出现。'
    + '我已经自动改用"直接动手"的方式再试一次；若仍未生成，请回一句「重试」。';
}
