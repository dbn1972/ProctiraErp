import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { Language } from './types';

const testLanguages: Language[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', rtl: false, flag: '🇬🇧' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true, flag: '🇸🇦' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', rtl: false, flag: '🇫🇷' },
];

describe('LanguageSwitcher', () => {
  describe('dropdown variant', () => {
    it('renders trigger with current language', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
        />
      );

      expect(screen.getByText('English')).toBeInTheDocument();
    });

    it('opens dropdown on trigger click', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
        />
      );

      const trigger = screen.getByRole('button', { name: /current language: english/i });
      fireEvent.click(trigger);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('العربية')).toBeInTheDocument();
      expect(screen.getByText('Français')).toBeInTheDocument();
    });

    it('calls onLanguageChange when a language is selected', () => {
      const onLanguageChange = vi.fn();
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={onLanguageChange}
        />
      );

      // Open dropdown
      fireEvent.click(screen.getByRole('button', { name: /current language: english/i }));

      // Select Arabic
      fireEvent.click(screen.getByRole('button', { name: /switch to arabic/i }));

      expect(onLanguageChange).toHaveBeenCalledWith('ar');
    });

    it('auto-toggles RTL when selecting RTL language', () => {
      const onRtlToggle = vi.fn();
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          onRtlToggle={onRtlToggle}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /current language: english/i }));
      fireEvent.click(screen.getByRole('button', { name: /switch to arabic/i }));

      expect(onRtlToggle).toHaveBeenCalledWith(true);
    });

    it('shows RTL toggle button when showRtlToggle is true', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          showRtlToggle
          onRtlToggle={vi.fn()}
        />
      );

      const rtlToggle = screen.getByRole('button', { name: /switch to right-to-left layout/i });
      expect(rtlToggle).toBeInTheDocument();
      expect(rtlToggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles RTL state on RTL button click', () => {
      const onRtlToggle = vi.fn();
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          showRtlToggle
          onRtlToggle={onRtlToggle}
          isRtl={false}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /switch to right-to-left layout/i }));
      expect(onRtlToggle).toHaveBeenCalledWith(true);
    });

    it('disables all controls when disabled', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          showRtlToggle
          onRtlToggle={vi.fn()}
          disabled
        />
      );

      expect(screen.getByRole('button', { name: /current language/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /switch to right-to-left/i })).toBeDisabled();
    });

    it('has proper WCAG attributes on trigger', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
        />
      );

      const trigger = screen.getByRole('button', { name: /current language: english/i });
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('inline variant', () => {
    it('renders all languages as buttons', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          variant="inline"
        />
      );

      expect(screen.getByRole('button', { name: /switch to english/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /switch to arabic/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /switch to french/i })).toBeInTheDocument();
    });

    it('marks current language as active', () => {
      render(
        <LanguageSwitcher
          languages={testLanguages}
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          variant="inline"
        />
      );

      const activeOption = screen.getByRole('option', { selected: true });
      expect(activeOption).toBeInTheDocument();
    });
  });
});
