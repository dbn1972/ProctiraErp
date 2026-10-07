/**
 * PRC-H049: plugin submissions and marketplace listings must be durable, not
 * per-process memory. These tests use a shared store behind a pg-shaped mock
 * pool so a second PgDeveloperPortalDurableStore instance (restart / replica)
 * sees the same rows — the property the in-memory residual lacked
 * ("reviewer approves on pod 1, publish on pod 2 returns 404").
 */
import { describe, it, expect } from 'vitest';

import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';
import type {
  MarketplaceListingEntity,
  PluginSubmissionEntity,
} from './developer-portal-repository.js';

type Row = Record<string, unknown>;

function createSharedPool() {
  const submissions: Row[] = [];
  const listings: Row[] = [];

  function run(text: string, values: unknown[] = []): { rows: Row[]; rowCount: number } {
    const sql = text.trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('set_config')) return { rows: [], rowCount: 0 };

    if (sql.startsWith('INSERT INTO developer_portal_submissions')) {
      const [
        id,
        account_id,
        name,
        version,
        display_name,
        description,
        category,
        supported_product_versions,
        required_permissions,
        source_url,
        documentation_url,
        icon_url,
        screenshots,
        tags,
        license,
        status,
        review_notes,
        reviewed_by,
        reviewed_at,
        submitted_at,
        published_at,
      ] = values;
      const row: Row = {
        id,
        account_id,
        name,
        version,
        display_name,
        description,
        category,
        supported_product_versions,
        required_permissions,
        source_url,
        documentation_url,
        icon_url,
        screenshots,
        tags,
        license,
        status,
        review_notes,
        reviewed_by,
        reviewed_at,
        submitted_at,
        published_at,
      };
      submissions.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM developer_portal_submissions WHERE id = $1')) {
      const [id] = values;
      const f = submissions.find((r) => r['id'] === id);
      return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE developer_portal_submissions')) {
      const [id, status, reviewNotes, reviewedBy] = values;
      const f = submissions.find((r) => r['id'] === id);
      if (!f) return { rows: [], rowCount: 0 };
      f['status'] = status;
      if (reviewNotes != null) f['review_notes'] = reviewNotes;
      if (reviewedBy != null) {
        f['reviewed_by'] = reviewedBy;
        f['reviewed_at'] = new Date();
      }
      if (status === 'published') f['published_at'] = new Date();
      return { rows: [f], rowCount: 1 };
    }
    if (sql.includes('count(*)::int AS c FROM developer_portal_submissions')) {
      return { rows: [{ c: submissions.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM developer_portal_submissions')) {
      return { rows: submissions, rowCount: submissions.length };
    }

    if (sql.startsWith('INSERT INTO developer_portal_listings')) {
      const name = values[0];
      const account_id = values[6];
      const existing = listings.find((r) => r['name'] === name);
      if (existing) {
        if (existing['account_id'] !== account_id) {
          // ON CONFLICT ... WHERE account_id = EXCLUDED.account_id → no row.
          return { rows: [], rowCount: 0 };
        }
        existing['version'] = values[4];
        existing['updated_at'] = new Date();
        return { rows: [existing], rowCount: 1 };
      }
      const row: Row = {
        name,
        display_name: values[1],
        description: values[2],
        category: values[3],
        version: values[4],
        author: values[5],
        account_id,
        icon_url: values[7],
        screenshots: values[8],
        tags: values[9],
        license: values[10],
        installs: values[11],
        average_rating: values[12],
        rating_count: values[13],
        published_at: values[14],
        updated_at: values[15],
      };
      listings.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM developer_portal_listings WHERE name = $1')) {
      const [name] = values;
      const f = listings.find((r) => r['name'] === name);
      return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
    }
    if (sql.includes('count(*)::int AS c FROM developer_portal_listings')) {
      return { rows: [{ c: listings.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM developer_portal_listings')) {
      return { rows: listings, rowCount: listings.length };
    }

    throw new Error(`unexpected SQL: ${sql}`);
  }

  const client = {
    query: (text: string, values?: unknown[]) => Promise.resolve(run(text, values)),
    release: () => {},
  };
  return {
    connect: () => Promise.resolve(client),
    query: (text: string, values?: unknown[]) => Promise.resolve(run(text, values)),
  };
}

function sampleSubmission(overrides: Partial<PluginSubmissionEntity> = {}): PluginSubmissionEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    name: 'acme-plugin',
    version: '1.0.0',
    displayName: 'ACME',
    description: 'desc',
    category: 'tools',
    supportedProductVersions: '>=1.0',
    requiredPermissions: ['read'],
    sourceUrl: null,
    documentationUrl: null,
    iconUrl: null,
    screenshots: [],
    tags: ['a'],
    license: 'MIT',
    status: 'submitted',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
    ...overrides,
  };
}

function sampleListing(overrides: Partial<MarketplaceListingEntity> = {}): MarketplaceListingEntity {
  return {
    name: 'acme-plugin',
    displayName: 'ACME',
    description: 'desc',
    category: 'tools',
    version: '1.0.0',
    author: 'Alice',
    accountId: '22222222-2222-4222-8222-222222222222',
    iconUrl: null,
    screenshots: [],
    tags: ['a'],
    license: 'MIT',
    installs: 5,
    averageRating: 4.2,
    ratingCount: 3,
    publishedAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PgDeveloperPortalDurableStore submissions/listings (PRC-H049)', () => {
  it('submission survives a "restart" (second store instance)', async () => {
    const pool = createSharedPool();
    const store1 = new PgDeveloperPortalDurableStore(pool as never);
    await store1.createSubmission(sampleSubmission());
    await store1.updateSubmissionStatus(
      sampleSubmission().id,
      'approved',
      'ok',
      'reviewer-1',
    );

    const store2 = new PgDeveloperPortalDurableStore(pool as never);
    const found = await store2.getSubmissionById(sampleSubmission().id);
    expect(found).not.toBeNull();
    expect(found?.status).toBe('approved');
    expect(found?.reviewedBy).toBe('reviewer-1');
  });

  it('listing persists across instances and is found by name', async () => {
    const pool = createSharedPool();
    const store1 = new PgDeveloperPortalDurableStore(pool as never);
    await store1.createListing(sampleListing());

    const store2 = new PgDeveloperPortalDurableStore(pool as never);
    const found = await store2.getListingByName('acme-plugin');
    expect(found).not.toBeNull();
    expect(found?.installs).toBe(5);
    expect(found?.averageRating).toBeCloseTo(4.2);
  });

  it('publishing a listing name owned by another account is rejected (no hijack)', async () => {
    const pool = createSharedPool();
    const store = new PgDeveloperPortalDurableStore(pool as never);
    await store.createListing(sampleListing());
    await expect(
      store.createListing(
        sampleListing({ accountId: '33333333-3333-4333-8333-333333333333', author: 'Mallory' }),
      ),
    ).rejects.toThrow(/owned by another account/i);
    // Original listing stats are untouched.
    const found = await store.getListingByName('acme-plugin');
    expect(found?.author).toBe('Alice');
    expect(found?.installs).toBe(5);
  });

  it('same-owner re-publish updates in place (preserves stats)', async () => {
    const pool = createSharedPool();
    const store = new PgDeveloperPortalDurableStore(pool as never);
    await store.createListing(sampleListing());
    const updated = await store.createListing(sampleListing({ version: '2.0.0' }));
    expect(updated.version).toBe('2.0.0');
    expect(updated.installs).toBe(5); // stats preserved
  });
});
