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
}
