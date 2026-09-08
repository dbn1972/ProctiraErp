/**
 * Provider barrel exports.
 *
 * All application-level providers are exported from here for clean imports.
 * The provider hierarchy order is documented in App.tsx and Design Section A.
 */

export {
  BrandConfigProvider,
  useBrand,
  DEFAULT_BRAND,
  BRAND_CACHE_TTL_MS,
  BRAND_ENDPOINT,
  clearBrandCache,
  fetchBrandCached,
  defaultBrandFetcher,
  injectBrandCSSVariables,
  normalizeBrandResponse,
} from './BrandConfigProvider';
export type {
  Brand,
  BrandConfigContextValue,
  BrandConfigProviderProps,
  BrandFetcher,
} from './BrandConfigProvider';

export {
  LanguageProvider,
  useLanguage,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  getDirection,
  LANGUAGE_STORAGE_KEY_SUFFIX,
  FALLBACK_LANGUAGE_STORAGE_KEY,
} from './LanguageProvider';
export type {
  Locale,
  Direction,
  LanguageContextValue,
  LanguageProviderProps,
  TranslationMap,
} from './LanguageProvider';

export {
  ThemeProvider,
  useTheme,
  getThemeBootScript,
  THEME_STORAGE_KEY_SUFFIX,
  FALLBACK_STORAGE_KEY,
} from './ThemeProvider';
export type {
  ThemeMode,
  ResolvedTheme,
  ThemeContextValue,
  ThemeProviderProps,
} from './ThemeProvider';

export { ConnectivityProvider, useConnectivity } from './ConnectivityProvider';
export type {
  ConnectivityStatus,
  ConnectivityContextValue,
  ConnectivityProviderProps,
} from './ConnectivityProvider';

export { AuthProvider, useAuth } from './AuthProvider';
export type {
  AuthStatus,
  AuthUser,
  UserScope,
  AuthContextValue,
  AuthProviderProps,
} from './AuthProvider';

export {
  FeatureFlagsProvider,
  useFeatureFlags,
  DEFAULT_FEATURE_FLAGS,
  LEGACY_MOBILE_ROUTES_FEATURE_KEY,
} from './FeatureFlagsProvider';
export type {
  FeatureFlags,
  FeatureFlagKey,
  FeatureFlagsContextValue,
  FeatureFlagsProviderProps,
} from './FeatureFlagsProvider';
