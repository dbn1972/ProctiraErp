/**
 * @proctira/i18n - RTL (Right-to-Left) language detection utilities
 */

/**
 * Locale codes that use right-to-left text direction.
 * Includes primary language codes and common regional variants.
 */
export const RTL_LOCALES: ReadonlySet<string> = new Set([
  'ar', // Arabic
  'he', // Hebrew
  'fa', // Persian (Farsi)
  'ur', // Urdu
  'ps', // Pashto
  'sd', // Sindhi
  'yi', // Yiddish
  'dv', // Divehi (Maldivian)
  'ku', // Kurdish (Sorani)
  'ckb', // Central Kurdish
  'arc', // Aramaic
  'syr', // Syriac
]);

/**
 * Determines if a given locale uses right-to-left text direction.
 * Checks both the full locale code and the base language code.
 *
 * @param locale - A locale code (e.g., 'ar', 'ar-SA', 'he-IL')
 * @returns true if the locale is RTL, false otherwise
 */
export function isRtl(locale: string): boolean {
  const normalized = locale.toLowerCase().trim();

  // Check exact match first
  if (RTL_LOCALES.has(normalized)) {
    return true;
  }

  // Check base language code (e.g., 'ar-SA' → 'ar')
  const baseLanguage = normalized.split('-')[0];
  if (baseLanguage && RTL_LOCALES.has(baseLanguage)) {
    return true;
  }

  return false;
}

/**
 * Returns the text direction for a given locale.
 *
 * @param locale - A locale code
 * @returns 'rtl' for right-to-left locales, 'ltr' otherwise
 */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}
