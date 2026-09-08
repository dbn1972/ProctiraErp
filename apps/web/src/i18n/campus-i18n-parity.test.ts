/**
 * G-405 / G-721 — i18n campus + redesign key parity check.
 *
 * Ensures campus modules and redesign hubs (fees, hostel, transport, library,
 * health, scholarships) expose critical message keys in every locale under
 * apps/web/src/messages. Every locale file must also match the English key
 * set for those namespaces (no missing / extra keys).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { locales as supportedLocales, rtlLocales } from './config';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, '../messages');

/** Critical keys that must exist (subset of the full English namespace). */
const REQUIRED: Record<string, string[]> = {
  transport: [
    'title',
    'subtitle',
    'routes',
    'vehicles',
    'assignments',
    'openRoutes',
    'openVehicles',
    'openAssignments',
  ],
  library: [
    'title',
    'subtitle',
    'catalog',
    'circulation',
    'overdues',
    'fines',
    'itemCount',
    'noHoldings',
  ],
  communication: ['title', 'campaigns', 'emergency', 'send'],
  hostel: [
    'title',
    'subtitle',
    'blocks',
    'rooms',
    'assignments',
    'hostels',
    'hostelCount',
    'structure',
    'visitors',
  ],
  fees: [
    'title',
    'subtitle',
    'invoices',
    'payments',
    'receipts',
    'plans',
    'planCount',
    'managePlans',
    'manageInvoices',
    'viewReceipts',
  ],
  health: [
    'title',
    'subtitle',
    'specialNeeds',
    'counselling',
    'screenings',
    'kpiRecords',
    'tableTitle',
    'accessDenied',
    'accessDeniedTitle',
  ],
  scholarships: [
    'title',
    'subtitle',
    'applications',
    'disbursements',
    'newProgram',
    'kpiActive',
    'emptyTitle',
    'createProgram',
    'statusOpen',
  ],
  nav: ['transport', 'library', 'communication', 'hostel', 'fees', 'health', 'scholarships'],
};

/** Namespaces owned by G-721 redesign work — full key-set parity required. */
const REDESIGN_NAMESPACES = [
  'fees',
  'hostel',
  'transport',
  'library',
  'health',
  'scholarships',
] as const;

describe('G-405 / G-721 campus + redesign i18n key parity', () => {
  const localeFiles = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'));
  const en = JSON.parse(readFileSync(join(MESSAGES_DIR, 'en.json'), 'utf8')) as Record<
    string,
    Record<string, string>
  >;

  it('has locale files for every supported locale', () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(2);
    expect(localeFiles).toContain('en.json');
    for (const locale of supportedLocales) {
      expect(localeFiles, `missing messages/${locale}.json`).toContain(`${locale}.json`);
    }
  });

  it('rtlLocales is a subset of locales that have message files (G-721)', () => {
    for (const rtl of rtlLocales) {
      expect(supportedLocales as readonly string[]).toContain(rtl);
      expect(localeFiles).toContain(`${rtl}.json`);
    }
    // Hebrew is intentionally not a messages locale — LanguageProvider may
    // still treat it as RTL for experimental UI, but config must not.
    expect(localeFiles).not.toContain('he.json');
    expect(rtlLocales.has('he')).toBe(false);
  });

  for (const file of localeFiles) {
    it(`${file} includes critical redesign keys`, () => {
      const data = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const [ns, keys] of Object.entries(REQUIRED)) {
        expect(data[ns], `${file} missing namespace ${ns}`).toBeDefined();
        for (const key of keys) {
          const value = data[ns]?.[key];
          expect(typeof value, `${file}:${ns}.${key}`).toBe('string');
          expect(String(value).trim().length, `${file}:${ns}.${key} empty`).toBeGreaterThan(0);
        }
      }
    });

    it(`${file} matches English key sets for redesign namespaces`, () => {
      const data = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      // Critical-key checks above cover nav/communication. Full key-set
      // equality is enforced only for redesign hubs (pre-existing nav drift
      // across locales is out of G-721 scope).
      for (const ns of REDESIGN_NAMESPACES) {
        const enKeys = Object.keys(en[ns] ?? {}).sort();
        const locKeys = Object.keys(data[ns] ?? {}).sort();
        expect(locKeys, `${file}:${ns} key set`).toEqual(enKeys);
      }
    });
  }
});
