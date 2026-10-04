import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDocumentLanguage, LanguageSwitcher } from './LanguageSwitcher';
import type { Language } from './types';

const languages: Language[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', rtl: false },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true },
];

describe('LanguageSwitcher labels, RTL reset and document lang/dir (PRC-L522)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });

  it('localises aria-labels via labels prop', () => {
    render(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="ar"
        onLanguageChange={vi.fn()}
        showRtlToggle
        onRtlToggle={vi.fn()}
        labels={{
          group: 'اختيار اللغة',
          changeLanguage: 'تغيير اللغة',
          availableLanguages: 'اللغات المتاحة',
          rtlToggle: 'RTL',
          rtlToggleDescription: 'تخطيط من اليمين إلى اليسار',
        }}
      />,
    );
    expect(screen.getByRole('group', { name: 'اختيار اللغة' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'العربية – تغيير اللغة' });
    expect(
      screen.getByRole('button', { name: 'RTL (تخطيط من اليمين إلى اليسار)' }),
    ).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('list', { name: 'اللغات المتاحة' })).toBeInTheDocument();
  });

  it('switching from an RTL to an LTR language clears a manual RTL override', () => {
    const onRtlToggle = vi.fn();
    render(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="ar"
        onLanguageChange={vi.fn()}
        onRtlToggle={onRtlToggle}
        isRtl
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    fireEvent.click(screen.getByRole('button', { name: /English \(English\)/ }));
    expect(onRtlToggle).toHaveBeenCalledWith(false);
  });

  it('keeps a manual override when rtlFollowsLanguage is false', () => {
    const onRtlToggle = vi.fn();
    render(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="ar"
        onLanguageChange={vi.fn()}
        onRtlToggle={onRtlToggle}
        isRtl
        rtlFollowsLanguage={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    fireEvent.click(screen.getByRole('button', { name: /English \(English\)/ }));
    expect(onRtlToggle).not.toHaveBeenCalled();
  });

  it('applies lang/dir to <html> when applyToDocument is set', () => {
    const { rerender } = render(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="ar"
        onLanguageChange={vi.fn()}
        applyToDocument
      />,
    );
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    rerender(
      <LanguageSwitcher
        languages={languages}
        currentLanguage="en"
        onLanguageChange={vi.fn()}
        applyToDocument
      />,
    );
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });

  it('applyDocumentLanguage helper sets lang and dir', () => {
    applyDocumentLanguage('ur', true);
    expect(document.documentElement.lang).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
