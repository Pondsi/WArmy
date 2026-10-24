/**
 * 出厂默认提示词的多语言版本（第 54 轮项 1）。
 *
 * 口径：**切换界面语言时，未被用户改过的默认层跟着换语言；改过的保持用户版本不动**（改用户的文字比不翻译更糟）。
 * 判定"改没改过"不靠时间戳：内容等于**任意一种语言**的出厂稿 ⇒ 视为未改（这样连续切两次语言也不会把第二次判成"用户改过"）。
 *
 * 这里只放**道 / 术**两层的正文（每层都有固定上限，翻译长度受它约束）。
 * 认知预设、默认牛马名等短文案在各自的模板文件里按语言取；新增语言时两边都要补。
 */
import { DAO_MOREN as D_ZH } from '../dao-default.js';
import { SHU_MOREN as S_ZH } from '../shu-default.js';
import { DAO_MOREN as D_ZH_TW, SHU_MOREN as S_ZH_TW } from './zh-TW.js';
import { DAO_MOREN as D_EN, SHU_MOREN as S_EN } from './en-US.js';
import { DAO_MOREN as D_JA, SHU_MOREN as S_JA } from './ja.js';
import { DAO_MOREN as D_KO, SHU_MOREN as S_KO } from './ko.js';
import { DAO_MOREN as D_FR, SHU_MOREN as S_FR } from './fr.js';
import { DAO_MOREN as D_ES, SHU_MOREN as S_ES } from './es.js';
import { DAO_MOREN as D_PT, SHU_MOREN as S_PT } from './pt.js';
import { DAO_MOREN as D_RU, SHU_MOREN as S_RU } from './ru.js';
import { DAO_MOREN as D_EO, SHU_MOREN as S_EO } from './eo.js';

export type MoRenYuYan = { dao: string; shu: string };

/** 与 i18n 的 10 个语言包同键（新增语言必须两边一起加，门禁会查） */
export const MO_REN_YU_YAN: Record<string, MoRenYuYan> = {
  'zh-CN': { dao: D_ZH, shu: S_ZH },
  'zh-TW': { dao: D_ZH_TW, shu: S_ZH_TW },
  'en-US': { dao: D_EN, shu: S_EN },
  ja: { dao: D_JA, shu: S_JA },
  ko: { dao: D_KO, shu: S_KO },
  fr: { dao: D_FR, shu: S_FR },
  es: { dao: D_ES, shu: S_ES },
  pt: { dao: D_PT, shu: S_PT },
  ru: { dao: D_RU, shu: S_RU },
  eo: { dao: D_EO, shu: S_EO },
};

export const MO_REN_YU_YAN_KE = Object.keys(MO_REN_YU_YAN);

/** 取某语言的出厂稿；没有这一种就用 zh-CN（绝不返回空串，空串会把用户的道清掉） */
export function quMoRen(lang: string): MoRenYuYan {
  return MO_REN_YU_YAN[String(lang || '')] || MO_REN_YU_YAN['zh-CN']!;
}

/** 默认称呼（用户没改过的话跟着界面语言走；判"没改过"用 `shiMoRenYongHuMing`） */
export const YONG_HU_MING_MO_REN: Record<string, string> = {
  'zh-CN': '老板', 'zh-TW': '老闆', 'en-US': 'Boss', ja: 'ボス', ko: '사장님',
  fr: 'Patron', es: 'Jefe', pt: 'Chefe', ru: 'Шеф', eo: 'Ĉefo',
};

/** 这个称呼是不是"出厂默认"（任一语言的默认都算 ⇒ 用户没改过，可以随语言切换） */
export function shiMoRenYongHuMing(ming: string): boolean {
  const s = String(ming || '').trim();
  return !!s && Object.values(YONG_HU_MING_MO_REN).includes(s);
}

/** 这段内容是不是"出厂稿"（任意语言、任意一层）：是 ⇒ 没被用户改过，可以随语言切换 */
export function shiChuChangGao(wen: string): boolean {
  const s = String(wen || '');
  if (!s.trim()) return false;
  return Object.values(MO_REN_YU_YAN).some((x) => x.dao === s || x.shu === s);
}
