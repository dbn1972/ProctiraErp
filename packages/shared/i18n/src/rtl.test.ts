import { describe, it, expect } from 'vitest';

import { isRtl, getDirection, RTL_LOCALES } from './rtl';

describe('RTL utilities', () => {
  describe('RTL_LOCALES', () => {
    it('should include Arabic', () => {
      expect(RTL_LOCALES.has('ar')).toBe(true);
    });

    it('should include Hebrew', () => {
      expect(RTL_LOCALES.has('he')).toBe(true);
    });

    it('should include Persian', () => {
      expect(RTL_LOCALES.has('fa')).toBe(true);
    });

    it('should include Urdu', () => {
      expect(RTL_LOCALES.has('ur')).toBe(true);
    });

    it('should not include English', () => {
      expect(RTL_LOCALES.has('en')).toBe(false);
    });

    it('should not include French', () => {
      expect(RTL_LOCALES.has('fr')).toBe(false);
    });
  });

  describe('isRtl', () => {
    it('should return true for Arabic', () => {
      expect(isRtl('ar')).toBe(true);
    });

    it('should return true for Hebrew', () => {
      expect(isRtl('he')).toBe(true);
    });

    it('should return true for Persian', () => {
      expect(isRtl('fa')).toBe(true);
    });

    it('should return true for Urdu', () => {
      expect(isRtl('ur')).toBe(true);
    });

    it('should return true for Arabic regional variant (ar-SA)', () => {
      expect(isRtl('ar-SA')).toBe(true);
    });

    it('should return true for Hebrew regional variant (he-IL)', () => {
      expect(isRtl('he-IL')).toBe(true);
    });

    it('should return true for Arabic with uppercase (ar-EG)', () => {
      expect(isRtl('ar-EG')).toBe(true);
    });

    it('should return false for English', () => {
      expect(isRtl('en')).toBe(false);
    });

    it('should return false for French', () => {
      expect(isRtl('fr')).toBe(false);
    });

    it('should return false for Spanish', () => {
      expect(isRtl('es')).toBe(false);
    });

    it('should return false for English regional variant (en-US)', () => {
      expect(isRtl('en-US')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(isRtl('AR')).toBe(true);
      expect(isRtl('He')).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(isRtl(' ar ')).toBe(true);
    });
  });

  describe('getDirection', () => {
    it('should return rtl for Arabic', () => {
      expect(getDirection('ar')).toBe('rtl');
    });

    it('should return rtl for Hebrew', () => {
      expect(getDirection('he')).toBe('rtl');
    });

    it('should return ltr for English', () => {
      expect(getDirection('en')).toBe('ltr');
    });

    it('should return ltr for French', () => {
      expect(getDirection('fr')).toBe('ltr');
    });

    it('should return rtl for Arabic regional variant', () => {
      expect(getDirection('ar-SA')).toBe('rtl');
    });

    it('should return ltr for unknown locale', () => {
      expect(getDirection('xx')).toBe('ltr');
    });
  });
});
