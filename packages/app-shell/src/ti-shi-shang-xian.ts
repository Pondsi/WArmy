/**
 * 提示词层的**硬上限 + 压缩提纯**（第 53 轮项 2，用户口径）。
 *
 * 三件事：
 *  1. **每一层都有固定上限**：用户写到超限 ⇒ 保存入口直接拒绝（不是"存进去再说"，那样等于骗人）；
 *  2. **项目自己改超限要立刻修**：出厂稿或程序归纳把某层顶超限 ⇒ 当场压缩提纯（压不动就把**最旧的条目搬进知识库**，
 *     不是删掉 —— 用户点名"太旧的内容放入知识库"）。**例外：「道」/「产品门禁」一个字都不许程序动**
 *     （`BU_KE_YA_SUO` 是唯一判据），它们超限只报警，由用户自己删；
 *  3. **要点不许丢**：压缩只允许"改措辞、去空行、去重复"，**条目数量与关键要点必须可核对**，
 *     判据是两条一起过：要点数守恒 + **字级守恒**（留下的 + 搬走的 = 原文，一个字符不多一个字符少）。
 *     任一条对不上就整步放弃并如实报（宁可超限报警，也不要"看起来变短了其实把规矩吞了"）。
 *
 * 另外：这一层的文本是给 AI 读的，不是给人读的 ⇒ `jinCouHua` 把空行、行尾空白、装饰性分隔线压掉（省 token）。
 * 纯函数 ⇒ 门禁跑真值表（scripts/verify-r53-tishangxian.mjs）。
 */

/** 各层上限（字符）。定得比注入预算小一档：这些字每轮都发，超了就是整条请求的成本。 */
export const TI_SHI_SHANG_XIAN: Record<string, number> = {
  道: 2600,
  术: 4200,
  /** 用户亲写的会话级要求（第 92 轮）；模型不可改 */
  要求: 2000,
  /** 原「规范」：第 92 轮更名为短记忆，只由归档模型更新、界面不可见 */
  短记忆: 2000,
  /** 旧名保留：历史文件/旧门禁仍按同一上限 */
  规范: 2000,
  印象: 2600,
  教条: 4000,
  束缚: 4000,
  认知: 1600,
};

/**
 * 各层**加在一起**的天花板（字符）。单层不超限不等于发得起：这些字每一轮都要发。
 * 比各层上限之和更小，所以它真的会咬人 —— 启动自检算出超了记 `prompt.over-total`（只报警，不自动删人的内容）。
 */
export const TI_SHI_ZONG_HE = 16000;

/**
 * 各语言的**字符折算系数**（第 54 轮项 1）。
 *
 * **第 90 轮用户口径（现行）**：所有语言一律使用与简体中文**相同**的上限，
 * 不再按语言放大 —— 其它语言提示词超限时按中文重译/压缩到简体中文的限制内（内容可略有精简，大意不变）；
 * 简体中文的基准上限（道 2600 / 术 4200 / …）一个字都不改。
 * 保留这张表是为了以后若要恢复折算时有唯一入口；现在全部为 1。
 */
export const YU_YAN_ZI_SHU_BEI_LV: Record<string, number> = {
  'zh-CN': 1,
  'zh-TW': 1,
  'en-US': 1,
  ja: 1,
  ko: 1,
  fr: 1,
  es: 1,
  pt: 1,
  ru: 1,
  eo: 1,
};

/**
 * 第 66 轮 项 18：**按 token 等价折算**，而不是拉丁语言按字符数和中文硬比。
 * 中文约 1 token/字；英文/法文/西文/俄文约 0.25–0.34 token/字符；日文约 0.7；韩文约 0.8。
 * 这样 "英文道 7949 字符" 不会因为 7949 > 2600 被误判超限，也不会让总量报警虚高。
 */
export const YU_YAN_DENG_JIA_XI_SHU: Record<string, number> = {
  'zh-CN': 1,
  'zh-TW': 1.05,
  'en-US': 0.31,
  ja: 0.7,
  ko: 0.8,
  fr: 0.3,
  es: 0.3,
  pt: 0.31,
  ru: 0.34,
  eo: 0.3,
};

/** 一段文本折合成"中文字符当量"（用于总量上限，不再让英文按字符数吃亏） */
export function dengJiaZiShu(wenBen: string, lang = 'zh-CN'): number {
  return Math.round(String(wenBen || '').length * (YU_YAN_DENG_JIA_XI_SHU[lang] || 1));
}

/**
 * 某一层的上限（**取数的唯一入口**）：存储闸、注入预算、保存拒绝、门禁真值表都从这里拿，
 * 免得同一层出现两个数字（旧代码里 印象 有 6000/3000 两套、术 有 8000/4200 两套，就是这套口径漏出来的）。
 * `lang` 不给就按 zh-CN 的基准值。
 */
export function shangXianOf(ceng: string, lang = 'zh-CN'): number {
  const base = Number(TI_SHI_SHANG_XIAN[ceng]) || 0;
  const f = Number(YU_YAN_ZI_SHU_BEI_LV[lang]) || 1;
  return Math.round(base * f);
}

/** 超出上限？（保存入口与自检共用同一个判据，不留两套口径） */
export function chaoShangXian(ceng: string, wenBen: string, lang = 'zh-CN'): { chao: boolean; ziShu: number; shangXian: number } {
  const shangXian = shangXianOf(ceng, lang);
  const ziShu = String(wenBen || '').length;
  return { chao: shangXian > 0 && ziShu > shangXian, ziShu, shangXian };
}

/**
 * AI 友好格式：删空行、行尾空白、单独的装饰分隔线，**不动任何正文字符**。
 * 判据（门禁钉住）：压缩前后"去掉所有空白后的字符序列"必须完全相同 ⇒ 省 token 不可能吃掉要点。
 */
export function jinCouHua(wenBen: string): string {
  return String(wenBen || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !/^\s*[-*_]{3,}\s*$/.test(l))
    .join('\n');
}

/** 忽略空白的指纹（用来证明"压缩没吃字"） */
export function wuKongBaiZhiWen(wenBen: string): string {
  return String(wenBen || '').replace(/\s+/g, '');
}

/** 一条提示词的"要点"计数：编号条目 + 列表项 + 小节标题（三者都算要点，防止把整节标题删了还自称没丢） */
export function yaoDianJiShu(wenBen: string): number {
  const hang = String(wenBen || '').split('\n');
  const tiao = hang.filter((l) => /^\s*(?:\d+[\.、)]|[-*·—]\s+)/.test(l)).length;
  const jie = hang.filter((l) => /^\s*#{1,6}\s/.test(l)).length;
  return tiao + jie;
}

export type JianDuan = { biao: string; hang: string[] };

/** 按 `## 小节` 切块（没有小节的按整块处理），供"整节不动、只丢最旧条目"的取舍用 */
export function qieXiaoJie(wenBen: string): JianDuan[] {
  const hang = String(wenBen || '').split('\n');
  const duan: JianDuan[] = [];
  let ke: JianDuan = { biao: '', hang: [] };
  for (const h of hang) {
    if (/^##\s/.test(h)) {
      if (ke.hang.length || ke.biao) duan.push(ke);
      ke = { biao: h, hang: [h] };
    } else ke.hang.push(h);
  }
  if (ke.hang.length || ke.biao) duan.push(ke);
  return duan;
}

/**
 * 压缩前后的**字级守恒**：把原文与"留下的 + 搬走的"都按字符计数比一次（顺序无关）。
 * 这条判据是能真的失败的：搬条目时多切一行、把续行吞掉、或者重复搬一条，这里就对不上 ⇒ 整步放弃。
 * （只数"要点数"是不够的：要点数守恒但正文丢半句，照样看不出来。）
 */
export function ziShuShouHeng(yuan: string, xinWen: string, yiChu: string[]): boolean {
  const jia = (s: string, m: Map<string, number>) => { for (const c of String(s || '')) m.set(c, (m.get(c) || 0) + 1); return m; };
  const a = jia(wuKongBaiZhiWen(yuan), new Map<string, number>());
  const b = jia(wuKongBaiZhiWen(yiChu.join('')) + wuKongBaiZhiWen(xinWen), new Map<string, number>());
  if (a.size !== b.size) return false;
  for (const [c, n] of a) if (b.get(c) !== n) return false;
  return true;
}

export type YaSuoJiHua = {
  /** 压完之后该层的内容 */
  xinWen: string;
  /** 因为超限被搬走的**最旧条目**（原样文本，调用方写进知识库，绝不直接丢） */
  yiChu: string[];
  yaoDianQian: number;
  yaoDianHou: number;
  ziShuQian: number;
  ziShuHou: number;
  /** 是否真的做到了"不超限" */
  gaoDing: boolean;
  /** 条目被搬走时保留的字样数：证明只搬旧、不吞新（要点数守恒 by 搬移计数） */
  liYou: string;
};

/**
 * 把某层压回上限内的规划器（**只丢最旧的整条条目，且丢下来的原文交出去归档**）：
 *  ① 先做 `jinCouHua`（去空行/装饰，零信息损失）；
 *  ② 还超就从**最靠前的条目**开始整条搬出（提示词里是"先写的先旧"的惯例；小节标题不搬，避免结构塌陷）；
 *  ③ 每搬一条都核对：剩余要点数 = 原要点数 − 搬出条数，对不上就放弃整步并如实报（宁可不压，不许偷偷吞）；
 *  ④ 搬尽条目仍超限 ⇒ `gaoDing:false`（调用方记审计报警，人来决定删什么）。
 */
export function guiHuaYaSuo(ceng: string, wenBen: string, lang = 'zh-CN'): YaSuoJiHua {
  const shangXian = shangXianOf(ceng, lang);
  const yuan = jinCouHua(wenBen);
  const yaoDianQian = yaoDianJiShu(wenBen);
  if (!shangXian || yuan.length <= shangXian) {
    return {
      xinWen: yuan, yiChu: [], yaoDianQian, yaoDianHou: yaoDianJiShu(yuan),
      ziShuQian: String(wenBen || '').length, ziShuHou: yuan.length,
      gaoDing: !shangXian || yuan.length <= shangXian, liYou: yuan.length < String(wenBen || '').length ? '只去空行与装饰' : '未超限',
    };
  }
  const duan = qieXiaoJie(yuan);
  const yiChu: string[] = [];
  let qiang = duan.map((d) => ({ biao: d.biao, hang: d.hang.slice() }));
  const chuan = () => qiang.map((d) => d.hang.join('\n')).join('\n');
  for (let lun = 0; lun < 400; lun++) {
    if (chuan().length <= shangXian) break;
    let banDong = false;
    for (const d of qiang) {
      const xh = d.hang.findIndex((l) => /^\s*(?:\d+[\.、)]|[-*·—]\s+)/.test(l));
      if (xh < 0) continue;
      const tiao = d.hang[xh]!;
      /** 小节标题占的行不算条目；一条一行地搬（列表项本就单行；两行的续行一起搬） */
      let zhi = xh + 1;
      while (zhi < d.hang.length && d.hang[zhi] && /^\s{2,}\S/.test(d.hang[zhi]!) && !/^\s*(?:\d+[\.、)]|[-*·—]\s+)/.test(d.hang[zhi]!)) zhi++;
      const kan = d.hang.slice(xh, zhi);
      d.hang.splice(xh, zhi - xh);
      yiChu.push(kan.join('\n'));
      banDong = true;
      break;
    }
    if (!banDong) break;
  }
  const xinWen = chuan();
  const yaoDianHou = yaoDianJiShu(xinWen);
  const yiChuYaoDian = yiChu.reduce((n, t) => n + yaoDianJiShu(t), 0);
  const yaoDianShouHeng = yaoDianHou + yiChuYaoDian === yaoDianQian;
  const shouHeng = yaoDianShouHeng && ziShuShouHeng(yuan, xinWen, yiChu);
  return {
    xinWen: shouHeng ? xinWen : yuan,
    yiChu: shouHeng ? yiChu : [],
    yaoDianQian, yaoDianHou: shouHeng ? yaoDianHou : yaoDianQian,
    ziShuQian: String(wenBen || '').length, ziShuHou: shouHeng ? xinWen.length : yuan.length,
    gaoDing: shouHeng && xinWen.length <= shangXian,
    liYou: !shouHeng
      ? (!yaoDianShouHeng ? '要点数不守恒 ⇒ 整步放弃（宁可报警也不偷偷吞要点）'
        : '字级不守恒（搬走的是整条、留下的一条没少）对不上 ⇒ 整步放弃')
      : yiChu.length ? `搬出 ${yiChu.length} 条最旧条目进知识库` : '仍超限：没有可搬的条目，需人来定删什么',
  };
}

/** 溢出条目该进哪一层的知识库（用户口径：太旧的进知识库；个人形象类已去过隐私 ⇒ 会话库） */
export function yiChuGuiXiang(ceng: string): 'session' | 'internal' {
  return ceng === '印象' ? 'session' : 'internal';
}
