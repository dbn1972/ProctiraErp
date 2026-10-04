/**
 * PRC-L348: shared repository contract. The same assertions run against the
 * in-memory repository (always) and Postgres (when DATABASE_URL is set), so
 * search and sort semantics cannot drift between the two implementations.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import {
  escapeLikePattern,
  getSharedScholarshipPool,
  orderByClause,
  PgScholarshipRepository,
} from './pg-scholarship-repository.js';
import type { ScholarshipRepository } from './scholarship-repository.js';

type Factory = () => Promise<{ repo: ScholarshipRepository; tenantId: string }>;

const factories: Array<{ name: string; skip: boolean; make: Factory }> = [
  {
    name: 'in-memory',
    skip: false,
    make: async () => ({ repo: new InMemoryScholarshipRepository(), tenantId: randomUUID() }),
  },
  {
    name: 'postgres',
    skip: !isPgScholarshipEnabled(),
    make: async () => {
      const pool = getSharedScholarshipPool();
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool!, tenantId);
      return { repo: new PgScholarshipRepository(pool!), tenantId };
    },
  },
];

async function seedPrograms(repo: ScholarshipRepository, tenantId: string, names: string[]) {
  for (const name of names) {
    await repo.createProgram({
      id: randomUUID(),
      tenantId,
      name,
      description: null,
      applicationStartDate: '2026-01-01',
      applicationEndDate: '2026-12-31',
      totalSlots: 10,
      usedSlots: 0,
      amountPerRecipient: 1000,
      amountPerRecipientCents: 100_000,
      currency: 'USD',
      disbursementFrequency: 'one_time',
      eligibility: {},
      status: 'open',
      academicPeriodId: null,
      fundingSourceId: null,
    });
  }
}

const NAMES = ['Beta grant', 'Alpha 50% grant', 'Gamma_x award'];

for (const factory of factories) {
  describe(`ScholarshipRepository contract (${factory.name})`, () => {
    it.skipIf(factory.skip)('treats LIKE wildcards in search literally', async () => {
      const { repo, tenantId } = await factory.make();
      await seedPrograms(repo, tenantId, NAMES);
      const page = { page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc' as const };
      const percent = await repo.listPrograms(tenantId, { search: '%' }, page);
      expect(percent.data.map((p) => p.name)).toEqual(['Alpha 50% grant']);
      const underscore = await repo.listPrograms(tenantId, { search: '_' }, page);
      expect(underscore.data.map((p) => p.name)).toEqual(['Gamma_x award']);
      const plain = await repo.listPrograms(tenantId, { search: 'GRANT' }, page);
      expect(plain.data.map((p) => p.name)).toEqual(['Alpha 50% grant', 'Beta grant']);
    });

    it.skipIf(factory.skip)('honours sortBy/sortOrder on programs', async () => {
      const { repo, tenantId } = await factory.make();
      await seedPrograms(repo, tenantId, NAMES);
      const asc = await repo.listPrograms(
        tenantId,
        {},
        { page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc' },
      );
      expect(asc.data.map((p) => p.name)).toEqual([
        'Alpha 50% grant',
        'Beta grant',
        'Gamma_x award',
      ]);
      const desc = await repo.listPrograms(
        tenantId,
        {},
        { page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'desc' },
      );
      expect(desc.data.map((p) => p.name)).toEqual([
        'Gamma_x award',
        'Beta grant',
        'Alpha 50% grant',
      ]);
    });
  });
}

describe('Pg SQL helpers (PRC-L348)', () => {
  it('escapes LIKE metacharacters', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });

  it('maps whitelisted sortBy and falls back for unknown/injected values', () => {
    const cols = { name: 'name' };
    const fallback = { column: 'created_at', order: 'desc' as const };
    expect(
      orderByClause(cols, { page: 1, pageSize: 1, sortBy: 'name', sortOrder: 'asc' }, fallback),
    ).toBe('ORDER BY name ASC, id ASC');
    expect(
      orderByClause(
        cols,
        { page: 1, pageSize: 1, sortBy: 'name; DROP TABLE x', sortOrder: 'asc' },
        fallback,
      ),
    ).toBe('ORDER BY created_at DESC, id DESC');
  });
});
