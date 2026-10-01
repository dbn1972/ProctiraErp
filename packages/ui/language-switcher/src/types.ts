export interface Language {
  /** Language code (e.g., 'en', 'ar', 'fr') */
  code: string;
  /** Display name in the language itself (e.g., 'العربية' for Arabic) */
  nativeName: string;
  /** Display name in English */
  englishName: string;
  /** Whether this language uses RTL direction */
  rtl: boolean;
  /** Optional flag emoji or icon */
  flag?: string;
}

/** Built-in (screen-reader and visible) strings; supply translations via `labels`. */
export interface LanguageSwitcherLabels {
  /** Group name, e.g. "Language selection" */
  group?: string;
  /** Appended to the trigger name: "<native name> – Change language" */
  changeLanguage?: string;
  /** Name of the language list */
  availableLanguages?: string;
  /** Visible text of the RTL toggle */
  rtlToggle?: string;
  /** Appended to the RTL toggle name: "RTL (right-to-left layout)" */
  rtlToggleDescription?: string;
  /** Visible badge on RTL languages */
  rtlBadge?: string;
}

export interface LanguageSwitcherProps {
  /** Available languages */
  languages: Language[];
  /** Currently selected language code */
  currentLanguage: string;
  /** Callback when language is changed */
  onLanguageChange: (languageCode: string) => void;
  /** Whether to show RTL toggle separately */
  showRtlToggle?: boolean;
  /** Callback when RTL is toggled manually */
  onRtlToggle?: (isRtl: boolean) => void;
  /** Current RTL state (overrides language default) */
  isRtl?: boolean;
  /** Display variant */
  variant?: 'dropdown' | 'inline';
  /** Whether the switcher is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Localised overrides for built-in strings */
  labels?: LanguageSwitcherLabels;
  /**
   * When true (default), selecting a language calls `onRtlToggle(lang.rtl)`,
   * clearing any manual RTL override. Set false to keep a manual override.
   */
  rtlFollowsLanguage?: boolean;
  /** When true, sets `<html lang dir>` from the current language/RTL state. */
  applyToDocument?: boolean;
}
