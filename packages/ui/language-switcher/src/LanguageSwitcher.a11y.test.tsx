import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { LanguageSwitcher } from './LanguageSwitcher';
import type { Language } from './types';

/**
 * PRC-L597 — widget-level axe-core WCAG 2.1 AA gate for `<LanguageSwitcher>`.
 * Covers both the dropdown and inline variants, including an RTL language in
 * the list so the direction/badge markup is exercised by axe.
 *
 * Regression gate (not failing-first): asserts the current accessible
 * contract and guards it going forward.
 */
const languages: Language[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', rtl: false, flag: '🇬🇧' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true, flag: '🇸🇦' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', rtl: false, flag: '🇫🇷' },
];

describe('<LanguageSwitcher /> — axe-core WCAG 2.1 AA gate (PRC-L597)', () => {
  it('dropdown variant (closed) has no violations', async () => {
    const { container } = render(
      <LanguageSwitcher languages={languages} currentLanguage="en" onLanguageChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('inline variant has no violations', async () => {
    const { container } = render(
      <LanguageSwitcher
        variant="inline"
        languages={languages}
        currentLanguage="ar"
        isRtl
        onLanguageChange={vi.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('dropdown with the RTL toggle shown has no violations', async () => {
    const { container } = render(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="en"
        showRtlToggle
        onLanguageChange={vi.fn()}
        onRtlToggle={vi.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
