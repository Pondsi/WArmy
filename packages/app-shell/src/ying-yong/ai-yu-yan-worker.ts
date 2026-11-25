/** R301：语种检测 worker（隔离 Node，纯 JS franc-all + Unicode 脚本）。不确定一律 unknown，不触发纠偏。 */
import { parentPort } from 'node:worker_threads';
import { francAll } from 'franc-all';
import { yuYanJianCeWen, type YuYanMuBiao, type YuYanCanShu, type YuYanJianCe } from './ai-yu-yan-yue-shu.js';

/** ISO 639-3 → 设置语言码（与 yue-shu 表同源；worker 内联避免循环依赖）。 */
const ISO_MAP: Record<string, string> = {
  cmn: 'zh-CN', eng: 'en-US', jpn: 'ja', kor: 'ko', fra: 'fr', spa: 'es', por: 'pt', rus: 'ru',
  epo: 'eo', deu: 'de', ita: 'it', nld: 'nl', pol: 'pl', swe: 'sv', ces: 'cs', hun: 'hu',
  dan: 'da', nob: 'nb', tur: 'tr', ukr: 'uk', ind: 'id', vie: 'vi', tha: 'th', hin: 'hi',
  arb: 'ar', pes: 'fa',
};
const UNIQUE_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0900-\u097f\u0e00-\u0e7f\u0400-\u04ff\u0590-\u05ff\u10a0-\u10ff\u0d80-\u0dff\u0980-\u09ff\u0a00-\u0a7f\u0b80-\u0bff\u0c00-\u0c7f\u0d00-\u0d7f]/;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const KANA = /[\u3040-\u30ff]/;
const HANGUL = /[\uac00-\ud7af]/;
/** 简繁粗判：常见繁体字集合命中≥2 且简体特征少 ⇒ zh-TW，否则 zh-CN。 */
const FAN_TI = /[繁體們來說話時後點問間開關們學國數萬與東車馬鳥魚龍風雲電話腦機]/;

function jianCeYiGe(wen: string, target: YuYanMuBiao, policy: YuYanCanShu): YuYanJianCe {
  const clean = yuYanJianCeWen(wen).replace(/\s+/g, ' ').trim();
  const youXiao = clean.replace(/[\d\p{P}\p{S}]/gu, '').length;
  const duTe = UNIQUE_SCRIPT.test(clean);
  const min = duTe ? policy.scriptMin : policy.latinMin;
  if (youXiao < min) return 'unknown';
  /* 独特文字先按脚本归族，避免 franc 把中文猜成日文等近邻。 */
  if (CJK.test(clean) && !KANA.test(clean) && !HANGUL.test(clean)) {
    if (target.code !== 'zh-CN' && target.code !== 'zh-TW') return 'mismatch';
    const fan = (clean.match(new RegExp(FAN_TI.source, 'g')) || []).length;
    const detected = fan >= 2 ? 'zh-TW' : 'zh-CN';
    return detected === target.code ? 'pass' : (youXiao >= 40 ? 'mismatch' : 'unknown');
  }
  if (KANA.test(clean)) return target.code === 'ja' ? 'pass' : 'mismatch';
  if (HANGUL.test(clean)) return target.code === 'ko' ? 'pass' : 'mismatch';
  const ranks = francAll(clean, { minLength: 10 });
  if (!ranks.length) return 'unknown';
  const top = ranks[0]!;
  const topCode = ISO_MAP[top[0]] || '';
  const targetRank = ranks.find((r) => ISO_MAP[r[0]] === target.code);
  if (!topCode) return 'unknown';
  if (topCode === target.code) return 'pass';
  /* 排名分数不是概率：只有明显差距才判违规。 */
  const gap = top[1] - (targetRank ? targetRank[1] : 0);
  if (gap >= policy.margin * top[1]) return 'mismatch';
  return 'unknown';
}

parentPort?.on('message', (m: { id: number; texts: string[]; target: YuYanMuBiao; policy: YuYanCanShu }) => {
  let results: YuYanJianCe[];
  try { results = m.texts.map((t) => jianCeYiGe(t, m.target, m.policy)); }
  catch { results = m.texts.map(() => 'unknown'); }
  parentPort?.postMessage({ id: m.id, results });
});