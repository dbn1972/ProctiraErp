/**
 * PRC-L352 — key-listed date revival keeps ISO-looking codes as strings.
 */
import { describe, expect, it } from 'vitest';
import { PgDocumentCollection, reviveDates } from './pg-document-store';
import type { PgQueryable } from './pg-tenant';

function poolReturning(data: unknown): PgQueryable {
  return {
    query: async (text: string) =>
      text.startsWith('SELECT *')
        ? {
            rows: [
              { id: 'd1', tenant_id: null, data, created_at: new Date(0), updated_at: new Date(0) },
            ],
          }
        : { rows: [] },
  };
}

const stored = {
  code: '2026-01-01T00:00:00Z',
  expiresAt: '2026-02-01T00:00:00Z',
  nested: { code: '2026-01-01T00:00:00Z', expiresAt: '2026-03-01T00:00:00Z' },
};

describe('PgDocumentCollection date revival (PRC-L352)', () => {
  it('key list: {code: ISO} round-trips as string unless key listed', async () => {
    const docs = new PgDocumentCollection<typeof stored>(poolReturning(stored), 'c', {
      reviveDates: ['expiresAt'],
    });
    const doc = (await docs.get('d1', { platformAdmin: true }))!;
    expect(doc.code).toBe('2026-01-01T00:00:00Z');
    expect(doc.nested.code).toBe('2026-01-01T00:00:00Z');
    expect(doc.expiresAt).toBeInstanceOf(Date);
    expect((doc.nested.expiresAt as unknown as Date).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('reviveDates: false leaves every string untouched', async () => {
    const docs = new PgDocumentCollection<typeof stored>(poolReturning(stored), 'c', {
      reviveDates: false,
    });
    const doc = (await docs.get('d1', { platformAdmin: true }))!;
    expect(doc.expiresAt).toBe('2026-02-01T00:00:00Z');
  });

  it('default keeps legacy revive-all behaviour (backward compatible)', async () => {
    const docs = new PgDocumentCollection<typeof stored>(poolReturning(stored), 'c');
    const doc = (await docs.get('d1', { platformAdmin: true }))!;
    expect(doc.code as unknown).toBeInstanceOf(Date);
  });

  it('reviveDates(value, keys) helper only touches listed keys', () => {
    const out = reviveDates({ a: '2026-01-01T00:00:00Z', at: '2026-01-01T00:00:00Z' }, ['at']);
    expect(out.a).toBe('2026-01-01T00:00:00Z');
    expect(out.at as unknown).toBeInstanceOf(Date);
  });
});
