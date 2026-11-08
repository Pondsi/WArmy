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
  'de',
  'it',
  'nl',
  'pl',
  'sv',
  'cs',
  'hu',
  'da',
  'nb',
  'tr',
  'uk',
  'id',
  'vi',
  'th',
  'hi',
  'ar',
  'fa',
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
  de: 'Deutsch',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  sv: 'Svenska',
  cs: 'Čeština',
  hu: 'Magyar',
  da: 'Dansk',
  nb: 'Norsk bokmål',
  tr: 'Türkçe',
  uk: 'Українська',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  hi: 'हिन्दी',
  ar: 'العربية',
  fa: 'فارسی',
};

/** Right-to-left locales — UI must flip to dir=rtl (W3C: set dir on <html>, mirror with logical CSS). */
export const RTL_LOCALES: readonly string[] = ['ar', 'fa'];

export function isRtlLocale(yuYan: string | undefined | null): boolean {
  return RTL_LOCALES.includes(jiexiYuyan(yuYan));
}

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
  if (l.startsWith('zh-tw') || l.startsWith('zh-hant') || l.startsWith('zh-hk') || l.startsWith('zh-mo')) return 'zh-TW';
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('fr')) return 'fr';
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('eo')) return 'eo';
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('it')) return 'it';
  if (l.startsWith('nl')) return 'nl';
  if (l.startsWith('pl')) return 'pl';
  if (l.startsWith('sv')) return 'sv';
  if (l.startsWith('cs') || l.startsWith('cz')) return 'cs';
  if (l.startsWith('hu')) return 'hu';
  if (l.startsWith('da')) return 'da';
  if (l.startsWith('nb') || l.startsWith('no') || l.startsWith('nn')) return 'nb';
  if (l.startsWith('tr')) return 'tr';
  if (l.startsWith('uk')) return 'uk';
  if (l.startsWith('id') || l.startsWith('in')) return 'id';
  if (l.startsWith('vi')) return 'vi';
  if (l.startsWith('th')) return 'th';
  if (l.startsWith('hi')) return 'hi';
  if (l.startsWith('ar')) return 'ar';
  if (l.startsWith('fa') || l.startsWith('per')) return 'fa';
  if (l.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

/** True when `yuYan` is an exact supported pack id. */
export function isSupportedLocale(yuYan: string): yuYan is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(yuYan);
}
