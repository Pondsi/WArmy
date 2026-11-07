/**
 * 出厂默认提示词的多语言入口（第 54 轮项 1；**现行口径：预设提示词统一中文**）。
 *
 * 用户口径（本轮）：**预设的提示词全部直接使用中文，不再按界面语言单独翻译**；
 * 预设的名称（老板/牛马、模板名等）**照常翻译**（见 YONG_HU_MING_MO_REN 与 i18n 语言包）。
 * 因此道/术出厂稿所有界面语言都指向中文：zh-CN 用简体稿，zh-TW 用繁体稿（同属中文），
 * 其余语言一律用简体稿。旧版按语言播过种的历史出厂稿**继续识别为「未改过」**
 * （升级后不能把老用户的出厂稿误判成"用户改过"而不再跟版）。
 *
 * 这里只放**道 / 术**两层的正文（每层都有固定上限，见 ti-shi-shang-xian.ts）。
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

const ZH_JIAN: MoRenYuYan = { dao: D_ZH, shu: S_ZH };
const ZH_FAN: MoRenYuYan = { dao: D_ZH_TW, shu: S_ZH_TW };

/** 与 i18n 的语言包同键（新增语言必须两边一起加，门禁会查）；值统一中文出厂稿 */
export const MO_REN_YU_YAN: Record<string, MoRenYuYan> = {
  'zh-CN': ZH_JIAN,
  'zh-TW': ZH_FAN,
  'en-US': ZH_JIAN,
  ja: ZH_JIAN,
  ko: ZH_JIAN,
  fr: ZH_JIAN,
  es: ZH_JIAN,
  pt: ZH_JIAN,
  ru: ZH_JIAN,
  eo: ZH_JIAN,
  de: ZH_JIAN,
  it: ZH_JIAN,
  nl: ZH_JIAN,
  pl: ZH_JIAN,
  sv: ZH_JIAN,
  cs: ZH_JIAN,
  hu: ZH_JIAN,
  da: ZH_JIAN,
  nb: ZH_JIAN,
  tr: ZH_JIAN,
  uk: ZH_JIAN,
  id: ZH_JIAN,
  vi: ZH_JIAN,
  th: ZH_JIAN,
  hi: ZH_JIAN,
  ar: ZH_JIAN,
  fa: ZH_JIAN,
};

export const MO_REN_YU_YAN_KE = Object.keys(MO_REN_YU_YAN);

/** 历史语言出厂稿（旧版本按界面语言播过种）：只用于识别「未改过」，不再用作默认值 */
const LI_SHI_CHU_CHANG: readonly MoRenYuYan[] = [
  { dao: D_EN, shu: S_EN },
  { dao: D_JA, shu: S_JA },
  { dao: D_KO, shu: S_KO },
  { dao: D_FR, shu: S_FR },
  { dao: D_ES, shu: S_ES },
  { dao: D_PT, shu: S_PT },
  { dao: D_RU, shu: S_RU },
  { dao: D_EO, shu: S_EO },
];

/** 取某语言的出厂稿；没有这一种就用 zh-CN（绝不返回空串，空串会把用户的道清掉） */
export function quMoRen(lang: string): MoRenYuYan {
  return MO_REN_YU_YAN[String(lang || '')] || MO_REN_YU_YAN['zh-CN']!;
}

/**
 * 默认称呼（用户没改过的话跟着界面语言走；判"没改过"用 `shiMoRenYongHuMing`）。
 * 这是**预设的名称**，按用户口径照常翻译到所有支持语言。
 */
export const YONG_HU_MING_MO_REN: Record<string, string> = {
  'zh-CN': '老板', 'zh-TW': '老闆', 'en-US': 'Boss', ja: 'ボス', ko: '사장님',
  fr: 'Patron', es: 'Jefe', pt: 'Chefe', ru: 'Шеф', eo: 'Ĉefo',
  de: 'Chef', it: 'Capo', nl: 'Baas', pl: 'Szef', sv: 'Chef',
  cs: 'Šéf', hu: 'Főnök', da: 'Chef', nb: 'Sjef', tr: 'Patron',
  uk: 'Шеф', id: 'Bos', vi: 'Sếp', th: 'นาย', hi: 'बॉस',
  ar: 'المدير', fa: 'رئیس',
};

/** 这个称呼是不是"出厂默认"（任一语言的默认都算 ⇒ 用户没改过，可以随语言切换） */
export function shiMoRenYongHuMing(ming: string): boolean {
  const s = String(ming || '').trim();
  return !!s && Object.values(YONG_HU_MING_MO_REN).includes(s);
}

/** 这段内容是不是"出厂稿"（任意语言、任意一层）：是 ⇒ 没被用户改过，可以跟版 */
export function shiChuChangGao(wen: string): boolean {
  const s = String(wen || '');
  if (!s.trim()) return false;
  const all = [...Object.values(MO_REN_YU_YAN), ...LI_SHI_CHU_CHANG];
  return all.some((x) => x.dao === s || x.shu === s);
}
