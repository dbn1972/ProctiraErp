import { describe, it, expect } from 'vitest';
import { getDirection, isValidLocale, defaultLocale, locales } from './config';

describe('i18n config', () => {
  describe('getDirection', () => {
    it('returns rtl for Arabic', () => {
      expect(getDirection('ar')).toBe('rtl');
    });

    it('returns rtl for Hebrew', () => {
      expect(getDirection('he')).toBe('rtl');
    });

    it('returns ltr for English', () => {
      expect(getDirection('en')).toBe('ltr');
    });

    it('returns ltr for French', () => {
      expect(getDirection('fr')).toBe('ltr');
    });

    it('returns ltr for Spanish', () => {
      expect(getDirection('es')).toBe('ltr');
    });

    it('returns ltr for Hindi', () => {
      expect(getDirection('hi')).toBe('ltr');
    });

    it('returns ltr for Tamil', () => {
      expect(getDirection('ta')).toBe('ltr');
    });
  });

  describe('isValidLocale', () => {
    it('returns true for supported locales', () => {
      for (const locale of locales) {
        expect(isValidLocale(locale)).toBe(true);
      }
    });

    it('returns true for all Indian Language Set locales', () => {
      const indianLocales = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'];
      for (const locale of indianLocales) {
        expect(isValidLocale(locale)).toBe(true);
      }
    });

    it('returns false for unsupported locales', () => {
      expect(isValidLocale('de')).toBe(false);
      expect(isValidLocale('zh')).toBe(false);
      expect(isValidLocale('')).toBe(false);
      expect(isValidLocale('invalid')).toBe(false);
    });
  });

  describe('defaultLocale', () => {
    it('is English', () => {
      expect(defaultLocale).toBe('en');
    });

    it('is included in supported locales', () => {
      expect(locales).toContain(defaultLocale);
    });
  });
});
