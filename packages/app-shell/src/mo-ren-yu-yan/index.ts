/**
 * 出厂默认提示词的多语言入口（第 54 轮项 1；**R147 项7b 现行口径：27 语各有真实出厂稿**）。
 *
 * R147 项7b（用户拍板「真补 17 份」）：原先只有 10 份语言稿、其余 17 语回落中文，
 * 现在 27 语**各有真实的道/术出厂稿**（de it nl pl sv cs hu da nb tr uk id vi th hi ar fa 已补齐）。
 * 每份都按简体中文上限写（道 ≤2600 / 术 ≤4200，见 ti-shi-shang-xian.ts），条目结构一致、大意不变。
 * 预设的名称（老板/牛马、模板名等）照常翻译（见 YONG_HU_MING_MO_REN 与 i18n 语言包）。
 * 旧版中文出厂稿与按语言播过种的历史稿**继续识别为「未改过」**
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
import { DAO_MOREN as D_DE, SHU_MOREN as S_DE } from './de.js';
import { DAO_MOREN as D_IT, SHU_MOREN as S_IT } from './it.js';
import { DAO_MOREN as D_NL, SHU_MOREN as S_NL } from './nl.js';
import { DAO_MOREN as D_PL, SHU_MOREN as S_PL } from './pl.js';
import { DAO_MOREN as D_SV, SHU_MOREN as S_SV } from './sv.js';
import { DAO_MOREN as D_CS, SHU_MOREN as S_CS } from './cs.js';
import { DAO_MOREN as D_HU, SHU_MOREN as S_HU } from './hu.js';
import { DAO_MOREN as D_DA, SHU_MOREN as S_DA } from './da.js';
import { DAO_MOREN as D_NB, SHU_MOREN as S_NB } from './nb.js';
import { DAO_MOREN as D_TR, SHU_MOREN as S_TR } from './tr.js';
import { DAO_MOREN as D_UK, SHU_MOREN as S_UK } from './uk.js';
import { DAO_MOREN as D_ID, SHU_MOREN as S_ID } from './id.js';
import { DAO_MOREN as D_VI, SHU_MOREN as S_VI } from './vi.js';
import { DAO_MOREN as D_TH, SHU_MOREN as S_TH } from './th.js';
import { DAO_MOREN as D_HI, SHU_MOREN as S_HI } from './hi.js';
import { DAO_MOREN as D_AR, SHU_MOREN as S_AR } from './ar.js';
import { DAO_MOREN as D_FA, SHU_MOREN as S_FA } from './fa.js';

export type MoRenYuYan = { dao: string; shu: string };

const ZH_JIAN: MoRenYuYan = { dao: D_ZH, shu: S_ZH };
const ZH_FAN: MoRenYuYan = { dao: D_ZH_TW, shu: S_ZH_TW };

/** 与 i18n 的语言包同键（新增语言必须两边一起加，门禁会查）；R147 项7b：各语言用自己的真实出厂稿 */
export const MO_REN_YU_YAN: Record<string, MoRenYuYan> = {
  'zh-CN': ZH_JIAN,
  'zh-TW': ZH_FAN,
  'en-US': { dao: D_EN, shu: S_EN },
  ja: { dao: D_JA, shu: S_JA },
  ko: { dao: D_KO, shu: S_KO },
  fr: { dao: D_FR, shu: S_FR },
  es: { dao: D_ES, shu: S_ES },
  pt: { dao: D_PT, shu: S_PT },
  ru: { dao: D_RU, shu: S_RU },
  eo: { dao: D_EO, shu: S_EO },
  de: { dao: D_DE, shu: S_DE },
  it: { dao: D_IT, shu: S_IT },
  nl: { dao: D_NL, shu: S_NL },
  pl: { dao: D_PL, shu: S_PL },
  sv: { dao: D_SV, shu: S_SV },
  cs: { dao: D_CS, shu: S_CS },
  hu: { dao: D_HU, shu: S_HU },
  da: { dao: D_DA, shu: S_DA },
  nb: { dao: D_NB, shu: S_NB },
  tr: { dao: D_TR, shu: S_TR },
  uk: { dao: D_UK, shu: S_UK },
  id: { dao: D_ID, shu: S_ID },
  vi: { dao: D_VI, shu: S_VI },
  th: { dao: D_TH, shu: S_TH },
  hi: { dao: D_HI, shu: S_HI },
  ar: { dao: D_AR, shu: S_AR },
  fa: { dao: D_FA, shu: S_FA },
};

export const MO_REN_YU_YAN_KE = Object.keys(MO_REN_YU_YAN);

/** 历史语言出厂稿（旧版本按界面语言播过种）：只用于识别「未改过」，不再用作默认值 */
const LI_SHI_CHU_CHANG: readonly MoRenYuYan[] = [
  ZH_JIAN,
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
  /* 未知语言回落 zh-CN（简体中文是出厂稿的事实来源）；绝不返回空串，空串会把用户的道清掉 */
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

/** 行尾归一化（CRLF→LF）：出厂稿比较/匹配前必须做，防止用户用编辑器保存后行尾变化导致误判"改过" */
function normalizeLineEndings(s: string): string {
  return String(s || '').replace(/\r\n/g, '\n');
}

/** 这段内容是不是"出厂稿"（任意语言、任意一层）：是 ⇒ 没被用户改过，可以跟版 */
export function shiChuChangGao(wen: string): boolean {
  const s = normalizeLineEndings(String(wen || ''));
  if (!s.trim()) return false;
  const all = [...Object.values(MO_REN_YU_YAN), ...LI_SHI_CHU_CHANG];
  return all.some((x) => normalizeLineEndings(x.dao) === s || normalizeLineEndings(x.shu) === s);
}
