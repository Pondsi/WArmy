/**
 * Supported UI locales for WArmy / 无限牛马.
 * Single source of truth for pack resolution, settings, and yuYan selects.
 * Main process, preview bridge, and renderer must all resolve through this.
 */
export const SUPPORTED_LOCALES = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja',
  'ko',
  'ru',
  'es',
  'fr',
  'pt',
  'eo',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Native display names (used in yuYan selects; not translated). */
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  eo: 'Esperanto',
};

/**
 * Resolve an arbitrary yuYan tag to a supported pack id.
 * Maps language prefixes to the full chanPin set — never collapses to only zh-CN/en-US.
 */
export function jiexiYuyan(yuYan: string | undefined | null): SupportedLocale {
  if (!yuYan) return 'zh-CN';
  const raw = String(yuYan).trim();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as SupportedLocale;
  }
  const l = raw.toLowerCase().replace('_', '-');
  if (l.startsWith('zh-tw') || l.startsWith('zh-hant') || l === 'zh-hk' || l === 'zh-mo' || l === 'zh-hant') return 'zh-TW';
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('fr')) return 'fr';
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('eo')) return 'eo';
  if (l.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

/** True when `yuYan` is an exact supported pack id. */
export function isSupportedLocale(yuYan: string): yuYan is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(yuYan);
}
