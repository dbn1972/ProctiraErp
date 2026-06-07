'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { LanguageSwitcherProps, Language } from './types';

/**
 * LanguageSwitcher component with RTL toggle support.
 * Supports dropdown and inline display variants.
 * Meets WCAG 2.1 Level AA accessibility standards.
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

  const currentLang = languages.find((l) => l.code === currentLanguage);
  const effectiveRtl = isRtl ?? currentLang?.rtl ?? false;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleLanguageSelect = useCallback(
    (lang: Language) => {
      onLanguageChange(lang.code);
      // Auto-toggle RTL based on language if no manual override
      if (onRtlToggle && isRtl === undefined) {
        onRtlToggle(lang.rtl);
      }
      setIsOpen(false);
    },
    [onLanguageChange, onRtlToggle, isRtl]
  );

  const handleRtlToggle = useCallback(() => {
    onRtlToggle?.(!effectiveRtl);
  }, [onRtlToggle, effectiveRtl]);

  if (variant === 'inline') {
    return (
      <div className={`proctira-lang-switcher proctira-lang-switcher--inline ${className}`} role="group" aria-label="Language selection">
        <ul className="proctira-lang-switcher__list" role="listbox" aria-label="Available languages">
          {languages.map((lang) => (
            <li key={lang.code} role="option" aria-selected={lang.code === currentLanguage}>
              <button
                type="button"
                onClick={() => handleLanguageSelect(lang)}
                disabled={disabled}
                className={`proctira-lang-switcher__option ${lang.code === currentLanguage ? 'proctira-lang-switcher__option--active' : ''}`}
                aria-label={`Switch to ${lang.englishName}`}
                lang={lang.code}
              >
                {lang.flag && <span aria-hidden="true">{lang.flag}</span>}
                <span>{lang.nativeName}</span>
              </button>
            </li>
          ))}
        </ul>
        {showRtlToggle && (
          <button
            type="button"
            onClick={handleRtlToggle}
            disabled={disabled}
            className="proctira-lang-switcher__rtl-toggle"
            aria-pressed={effectiveRtl}
            aria-label={effectiveRtl ? 'Switch to left-to-right layout' : 'Switch to right-to-left layout'}
          >
            {effectiveRtl ? 'RTL ✓' : 'RTL'}
          </button>
        )}
      </div>
    );
  }

  // Dropdown variant
  return (
    <div ref={containerRef} className={`proctira-lang-switcher proctira-lang-switcher--dropdown ${className}`}>
      <div className="proctira-lang-switcher__controls" role="group" aria-label="Language selection">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="proctira-lang-switcher__trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={`Current language: ${currentLang?.englishName ?? currentLanguage}. Click to change.`}
          disabled={disabled}
        >
          {currentLang?.flag && <span aria-hidden="true">{currentLang.flag}</span>}
          <span lang={currentLang?.code}>{currentLang?.nativeName ?? currentLanguage}</span>
          <span className="proctira-lang-switcher__arrow" aria-hidden="true">
            {isOpen ? '▴' : '▾'}
          </span>
        </button>

        {showRtlToggle && (
          <button
            type="button"
            onClick={handleRtlToggle}
            disabled={disabled}
            className="proctira-lang-switcher__rtl-toggle"
            aria-pressed={effectiveRtl}
            aria-label={effectiveRtl ? 'Switch to left-to-right layout' : 'Switch to right-to-left layout'}
          >
            {effectiveRtl ? 'RTL ✓' : 'RTL'}
          </button>
        )}
      </div>

      {isOpen && (
        <ul className="proctira-lang-switcher__dropdown" role="listbox" aria-label="Available languages">
          {languages.map((lang) => (
            <li
              key={lang.code}
              role="option"
              aria-selected={lang.code === currentLanguage}
            >
              <button
                type="button"
                onClick={() => handleLanguageSelect(lang)}
                disabled={disabled}
                className={`proctira-lang-switcher__option ${lang.code === currentLanguage ? 'proctira-lang-switcher__option--active' : ''}`}
                aria-label={`Switch to ${lang.englishName}`}
                lang={lang.code}
              >
                {lang.flag && <span aria-hidden="true">{lang.flag}</span>}
                <span className="proctira-lang-switcher__option-native">{lang.nativeName}</span>
                <span className="proctira-lang-switcher__option-english">({lang.englishName})</span>
                {lang.rtl && <span className="proctira-lang-switcher__rtl-badge" aria-label="Right-to-left language">RTL</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
