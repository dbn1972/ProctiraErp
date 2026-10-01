'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { Language, LanguageSwitcherProps } from './types';

const t = {
  group: 'Language selection',
  changeLanguage: 'Change language',
  availableLanguages: 'Available languages',
  rtlToggle: 'RTL',
  rtlToggleDescription: 'right-to-left layout',
  rtlBadge: 'RTL',
};

/**
 * LanguageSwitcher component with RTL toggle support.
 * Supports dropdown (disclosure) and inline display variants.
 *
 * Keyboard (dropdown): Enter/Space/ArrowDown on the trigger opens and focuses the
 * current language; ArrowUp/ArrowDown/Home/End move between languages; Escape
 * closes and returns focus to the trigger.
 *
 * @example
 * ```tsx
 * <LanguageSwitcher
 *   languages={[
 *     { code: 'en', nativeName: 'English', englishName: 'English', rtl: false },
 *     { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true },
 *   ]}
 *   currentLanguage="en"
 *   onLanguageChange={(code) => setLocale(code)}
 *   showRtlToggle
 * />
 * ```
 */
export function LanguageSwitcher({
  languages,
  currentLanguage,
  onLanguageChange,
  showRtlToggle = false,
  onRtlToggle,
  isRtl,
  variant = 'dropdown',
  disabled = false,
  className = '',
}: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${useId()}-languages`;
  const currentLang = languages.find((l) => l.code === currentLanguage);
  const effectiveRtl = isRtl ?? currentLang?.rtl ?? false;

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside click (focus stays where the user clicked)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // When opened, move focus to the current language (or the first one)
  useEffect(() => {
    if (!isOpen) return;
    const options = optionButtons();
    (options.find((b) => b.dataset['current'] === 'true') ?? options[0])?.focus();
  }, [isOpen]);

  const optionButtons = (): HTMLButtonElement[] =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);

  const handleListKeyDown = (event: React.KeyboardEvent) => {
    const options = optionButtons();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % options.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    options[next]?.focus();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' && !disabled) {
      event.preventDefault();
      setIsOpen(true);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close(true);
    }
  };

  const handleLanguageSelect = useCallback(
    (lang: Language) => {
      onLanguageChange(lang.code);
      // Auto-toggle RTL based on language if no manual override
      if (onRtlToggle && isRtl === undefined) {
        onRtlToggle(lang.rtl);
      }
      if (variant === 'dropdown') close(true);
    },
    [onLanguageChange, onRtlToggle, isRtl, variant, close],
  );

  const handleRtlToggle = useCallback(() => {
    onRtlToggle?.(!effectiveRtl);
  }, [onRtlToggle, effectiveRtl]);

  const rtlToggle = showRtlToggle && (
    <button
      type="button"
      onClick={handleRtlToggle}
      disabled={disabled}
      className={`proctira-lang-switcher__rtl-toggle ${effectiveRtl ? 'proctira-lang-switcher__rtl-toggle--active' : ''}`}
      aria-pressed={effectiveRtl}
      aria-label={`${t.rtlToggle} (${t.rtlToggleDescription})`}
    >
      {t.rtlToggle}
      {effectiveRtl && <span aria-hidden="true"> ✓</span>}
    </button>
  );

  if (variant === 'inline') {
    return (
      <div
        className={`proctira-lang-switcher proctira-lang-switcher--inline ${className}`}
        role="group"
        aria-label={t.group}
      >
        <ul className="proctira-lang-switcher__list" aria-label={t.availableLanguages}>
          {languages.map((lang) => {
            const current = lang.code === currentLanguage;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  onClick={() => handleLanguageSelect(lang)}
                  disabled={disabled}
                  className={`proctira-lang-switcher__option ${current ? 'proctira-lang-switcher__option--active' : ''}`}
                  aria-current={current ? 'true' : undefined}
                >
                  {lang.flag && <span aria-hidden="true">{lang.flag}</span>}
                  <span lang={lang.code}>{lang.nativeName}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {rtlToggle}
      </div>
    );
  }

  // Dropdown variant: disclosure button + list of buttons (no listbox roles)
  return (
    <div
      ref={containerRef}
      className={`proctira-lang-switcher proctira-lang-switcher--dropdown ${className}`}
    >
      <div className="proctira-lang-switcher__controls" role="group" aria-label={t.group}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleTriggerKeyDown}
          className="proctira-lang-switcher__trigger"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={`${currentLang?.nativeName ?? currentLanguage} – ${t.changeLanguage}`}
          disabled={disabled}
        >
          {currentLang?.flag && <span aria-hidden="true">{currentLang.flag}</span>}
          <span lang={currentLang?.code}>{currentLang?.nativeName ?? currentLanguage}</span>
          <span className="proctira-lang-switcher__arrow" aria-hidden="true">
            {isOpen ? '▴' : '▾'}
          </span>
        </button>
        {rtlToggle}
      </div>
      {isOpen && (
        <ul
          ref={listRef}
          id={listId}
          className="proctira-lang-switcher__dropdown"
          aria-label={t.availableLanguages}
          onKeyDown={handleListKeyDown}
        >
          {languages.map((lang) => {
            const current = lang.code === currentLanguage;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  onClick={() => handleLanguageSelect(lang)}
                  disabled={disabled}
                  data-current={current ? 'true' : undefined}
                  className={`proctira-lang-switcher__option ${current ? 'proctira-lang-switcher__option--active' : ''}`}
                  aria-current={current ? 'true' : undefined}
                >
                  {lang.flag && <span aria-hidden="true">{lang.flag}</span>}
                  <span className="proctira-lang-switcher__option-native" lang={lang.code}>
                    {lang.nativeName}
                  </span>
                  <span className="proctira-lang-switcher__option-english">
                    ({lang.englishName})
                  </span>
                  {lang.rtl && (
                    <span className="proctira-lang-switcher__rtl-badge">{t.rtlBadge}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
