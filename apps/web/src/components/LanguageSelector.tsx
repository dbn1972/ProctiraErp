'use client';

/**
 * LanguageSelector — Native-name locale dropdown (Task 48.3).
 *
 * Renders the supported Indian_Language_Set + RTL pilot (`ar`) as a
 * shadcn/ui DropdownMenu. Each menu item displays the locale by its
 * **native name** (हिन्दी, தமிழ், తెలుగు, मराठी, বাংলা, ગુજરાતી, ಕನ್ನಡ,
 * English, العربية) per Requirement 18 AC 7.
 *
 * Selecting an item calls `useLanguage().setLocale()`, which:
 *   - persists the chosen locale to brand-aware localStorage,
 *   - stamps `<html lang>` and `<html dir>` (LTR/RTL) on every change,
 *   - rebuilds the `t()` fallback chain so subsequent translations
 *     resolve in the new active locale (Task 48.1).
 *
 * The trigger is an icon button matching `<ThemeToggle>` so the header
 * cluster reads as a coherent set of controls. Active locale is marked
 * with a check icon for keyboard / screen-reader users.
 *
 * Requirements: 18.1, 18.6, 18.7, 18.10, 18.11
 * Design: Section C
 */

import React from 'react';
import { Check, Globe } from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@proctira/ui/components';
import { useLanguage } from '@/providers/LanguageProvider';

// ─── Locale → native name table ──────────────────────────────────────────────

/**
 * Native-name labels for every locale the LanguageSelector renders.
 *
 * Order is fixed so the dropdown reads consistently across sessions and
 * languages. English is first (platform default), Indian_Language_Set
 * follows in the canonical order from `SUPPORTED_LOCALES`, and the RTL
 * pilot `ar` sits at the bottom (above a separator) so it is clearly
 * grouped as a non-Indian preview locale (Task 48.5).
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  mr: 'मराठी',
  bn: 'বাংলা',
  gu: 'ગુજરાતી',
  kn: 'ಕನ್ನಡ',
  ar: 'العربية',
};

/**
 * Locale order used by the dropdown. Indian_Language_Set first, then the
 * RTL pilot. Mirrors `SUPPORTED_LOCALES` plus `ar` for task 48.5.
 */
export const LANGUAGE_SELECTOR_LOCALES: readonly string[] = [
  'en',
  'hi',
  'ta',
  'te',
  'mr',
  'bn',
  'gu',
  'kn',
  'ar',
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export interface LanguageSelectorProps {
  /** Optional className passthrough for layout-specific spacing. */
  className?: string;
}

/**
 * Native-name language dropdown. Mounted in `<Header>` and
 * `<MarketingHeader>` (and the login page) so every shell can switch
 * locale without leaving the current view.
 */
export function LanguageSelector({ className }: LanguageSelectorProps = {}) {
  const { locale, setLocale } = useLanguage();

  const currentNative = LOCALE_NATIVE_NAMES[locale] ?? locale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Select language"
          data-testid="language-selector"
          data-current-locale={locale}
          // Match <ThemeToggle> so the header reads as a coherent cluster
          // of icon buttons (Task 47.4 / Requirement 37 AC 3 — 48 px target).
          className={['min-h-[48px] min-w-[48px]', className]
            .filter(Boolean)
            .join(' ')}
          title={currentNative}
        >
          <Globe className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGE_SELECTOR_LOCALES.map((code) => {
          const native = LOCALE_NATIVE_NAMES[code] ?? code;
          const isActive = code === locale;
          return (
            <DropdownMenuItem
              key={code}
              onSelect={() => {
                setLocale(code);
              }}
              data-locale={code}
              data-active={isActive ? 'true' : undefined}
              aria-current={isActive ? 'true' : undefined}
              role="menuitemradio"
              aria-checked={isActive}
              // Stamp the native script's `lang` so screen readers and the
              // browser pick the correct font shaping for each label.
              lang={code}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate">{native}</span>
              {isActive ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSelector;
