import { describe, it, expect, beforeEach } from 'vitest';

import { I18nServiceImpl } from './i18n-service';
import type { I18nConfig, TranslationMap } from './types';

describe('I18nServiceImpl', () => {
  let service: I18nServiceImpl;

  const enTranslations: TranslationMap = {
    common: {
      greeting: 'Hello {{name}}',
      welcome: 'Welcome to ProctiraERP',
      buttons: {
        save: 'Save',
        cancel: 'Cancel',
      },
    },
    errors: {
      notFound: 'Resource not found',
      validation: '{{field}} is invalid',
    },
  };

  const arTranslations: TranslationMap = {
    common: {
      greeting: 'مرحبا {{name}}',
      welcome: 'مرحبا بكم في ProctiraERP',
      buttons: {
        save: 'حفظ',
      },
    },
  };

  const frTranslations: TranslationMap = {
    common: {
      greeting: 'Bonjour {{name}}',
      welcome: 'Bienvenue sur ProctiraERP',
      buttons: {
        save: 'Enregistrer',
        cancel: 'Annuler',
      },
    },
    errors: {
      notFound: 'Ressource introuvable',
      validation: '{{field}} est invalide',
    },
  };

  const config: I18nConfig = {
    supportedLocales: ['en', 'ar', 'fr'],
    defaultLocale: 'en',
    fallbackLocale: 'en',
  };

  beforeEach(() => {
    service = new I18nServiceImpl({
      config,
      translations: { en: enTranslations, ar: arTranslations, fr: frTranslations },
    });
  });

  describe('translate', () => {
    it('should translate a simple key', () => {
      expect(service.translate('common.welcome')).toBe('Welcome to ProctiraERP');
    });

    it('should translate a nested key', () => {
      expect(service.translate('common.buttons.save')).toBe('Save');
    });

    it('should interpolate parameters', () => {
      expect(service.translate('common.greeting', { name: 'John' })).toBe('Hello John');
    });

    it('should interpolate multiple parameters', () => {
      expect(service.translate('errors.validation', { field: 'Email' })).toBe('Email is invalid');
    });

    it('should keep unresolved placeholders when params are missing', () => {
      expect(service.translate('common.greeting')).toBe('Hello {{name}}');
    });

    it('should return key name when translation is not found in any locale', () => {
      expect(service.translate('nonexistent.key')).toBe('nonexistent.key');
    });
  });

  describe('fallback chain', () => {
    it('should fall back to platform default when key is missing in user locale', () => {
      service.setLocale('ar');
      // 'errors.notFound' exists in 'en' but not in 'ar'
      expect(service.translate('errors.notFound')).toBe('Resource not found');
    });

    it('should fall back to tenant default before platform default', () => {
      const serviceWithTenant = new I18nServiceImpl({
        config: {
          ...config,
          tenantDefaultLocale: 'fr',
        },
        translations: { en: enTranslations, ar: arTranslations, fr: frTranslations },
      });

      serviceWithTenant.setLocale('ar');
      // 'errors.notFound' is missing in 'ar', present in 'fr' (tenant default)
      expect(serviceWithTenant.translate('errors.notFound')).toBe('Ressource introuvable');
    });

    it('should use user locale first when key exists there', () => {
      service.setLocale('ar');
      expect(service.translate('common.greeting', { name: 'أحمد' })).toBe('مرحبا أحمد');
    });

    it('should fall back through chain: user → tenant → platform → key', () => {
      const serviceWithTenant = new I18nServiceImpl({
        config: {
          ...config,
          tenantDefaultLocale: 'fr',
        },
        translations: {
          en: enTranslations,
          ar: arTranslations,
          fr: frTranslations,
        },
      });

      serviceWithTenant.setLocale('ar');
      // Key that doesn't exist anywhere
      expect(serviceWithTenant.translate('totally.missing.key')).toBe('totally.missing.key');
    });

    it('should not duplicate lookups when locales overlap in chain', () => {
      // When user locale is same as default, should still work
      service.setLocale('en');
      expect(service.translate('common.welcome')).toBe('Welcome to ProctiraERP');
    });
  });

  describe('setLocale / getLocale', () => {
    it('should set and get the current locale', () => {
      service.setLocale('ar');
      expect(service.getLocale()).toBe('ar');
    });

    it('should not set an unsupported locale', () => {
      service.setLocale('xx');
      expect(service.getLocale()).toBe('en'); // stays at default
    });

    it('should default to the config defaultLocale', () => {
      expect(service.getLocale()).toBe('en');
    });
  });

  describe('formatDate', () => {
    const testDate = new Date('2024-03-15T10:30:00Z');

    it('should format date in short style for English', () => {
      const formatted = service.formatDate(testDate, 'short');
      // Should contain numeric month, day, year
      expect(formatted).toMatch(/\d/);
      expect(formatted).toMatch(/2024/);
    });

    it('should format date in medium style for English', () => {
      const formatted = service.formatDate(testDate, 'medium');
      expect(formatted).toMatch(/Mar/);
      expect(formatted).toMatch(/2024/);
    });

    it('should format date in long style for English', () => {
      const formatted = service.formatDate(testDate, 'long');
      expect(formatted).toMatch(/March/);
      expect(formatted).toMatch(/2024/);
    });

    it('should format date respecting Arabic locale', () => {
      service.setLocale('ar');
      const formatted = service.formatDate(testDate, 'short');
      // Arabic locale should produce a different format
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should format date respecting French locale', () => {
      service.setLocale('fr');
      const formatted = service.formatDate(testDate, 'long');
      expect(formatted).toMatch(/mars/i);
      expect(formatted).toMatch(/2024/);
    });

    it('should default to medium style', () => {
      const formatted = service.formatDate(testDate);
      expect(formatted).toMatch(/Mar/);
    });
  });

  describe('formatNumber', () => {
    it('should format a number with default options', () => {
      const formatted = service.formatNumber(1234567.89);
      expect(formatted).toContain('1');
      // English uses comma as thousands separator
      expect(formatted).toMatch(/1,234,567/);
    });

    it('should format a number with fraction digits', () => {
      const formatted = service.formatNumber(3.14159, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(formatted).toBe('3.14');
    });

    it('should format a percentage', () => {
      const formatted = service.formatNumber(0.85, { style: 'percent' });
      expect(formatted).toContain('85');
      expect(formatted).toContain('%');
    });

    it('should format number respecting Arabic locale', () => {
      service.setLocale('ar');
      const formatted = service.formatNumber(1234.56);
      // Arabic may use different numerals or separators
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should format number respecting French locale', () => {
      service.setLocale('fr');
      const formatted = service.formatNumber(1234567.89);
      // French uses space as thousands separator and comma as decimal
      // The exact character may be a non-breaking space
      expect(formatted).toBeDefined();
      expect(formatted).toMatch(/1/);
    });
  });

  describe('formatCurrency', () => {
    it('should format USD currency in English', () => {
      const formatted = service.formatCurrency(1234.56, 'USD');
      expect(formatted).toContain('$');
      expect(formatted).toMatch(/1,234\.56/);
    });

    it('should format EUR currency in French', () => {
      service.setLocale('fr');
      const formatted = service.formatCurrency(1234.56, 'EUR');
      // French EUR format typically has € after the number
      expect(formatted).toContain('€');
    });

    it('should format currency with code display', () => {
      const formatted = service.formatCurrency(100, 'GBP', { display: 'code' });
      expect(formatted).toContain('GBP');
    });

    it('should format currency respecting Arabic locale', () => {
      service.setLocale('ar');
      const formatted = service.formatCurrency(5000, 'SAR');
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('getDirection', () => {
    it('should return ltr for English', () => {
      service.setLocale('en');
      expect(service.getDirection()).toBe('ltr');
    });

    it('should return rtl for Arabic', () => {
      service.setLocale('ar');
      expect(service.getDirection()).toBe('rtl');
    });

    it('should return ltr for French', () => {
      service.setLocale('fr');
      expect(service.getDirection()).toBe('ltr');
    });
  });

  describe('getAvailableLocales', () => {
    it('should return locale info for all supported locales', () => {
      const locales = service.getAvailableLocales();
      expect(locales).toHaveLength(3);
      expect(locales.map((l) => l.code)).toEqual(['en', 'ar', 'fr']);
    });

    it('should include direction info for each locale', () => {
      const locales = service.getAvailableLocales();
      const arLocale = locales.find((l) => l.code === 'ar');
      const enLocale = locales.find((l) => l.code === 'en');
      expect(arLocale?.direction).toBe('rtl');
      expect(enLocale?.direction).toBe('ltr');
    });
  });
});
