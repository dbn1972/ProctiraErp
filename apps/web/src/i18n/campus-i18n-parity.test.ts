/**
 * G-405 — i18n campus key parity check.
 *
 * Ensures top campus modules (transport, library, communication, hostel, fees)
 * expose critical message keys in every locale under apps/web/src/messages.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, '../messages');

const REQUIRED: Record<string, string[]> = {
  transport: ['title', 'routes', 'vehicles', 'assignments'],
  library: ['title', 'catalog', 'circulation', 'overdues', 'fines'],
  communication: ['title', 'campaigns', 'emergency', 'send'],
  hostel: ['title', 'blocks', 'rooms', 'assignments'],
  fees: ['title', 'invoices', 'payments', 'receipts'],
  nav: ['transport', 'library', 'communication', 'hostel', 'fees'],
};

describe('G-405 campus i18n key parity', () => {
  const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'));

  it('has locale files', () => {
    expect(locales.length).toBeGreaterThanOrEqual(2);
    expect(locales).toContain('en.json');
  });

  for (const file of locales) {
    it(`${file} includes critical campus keys`, () => {
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
  }
});
