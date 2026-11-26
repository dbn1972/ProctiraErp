/**
 * PRC-L292 — live Postgres proof that a transcript's seal is classified and
 * that a new ISSUED transcript must be sealed with the dedicated KMS key
 * (db/sql/329).
 *
 * Before 329 any 64-hex signature_hmac satisfied the authenticity guard, so
 * 076's unkeyed legacy seal and a keyed HMAC looked the same, and a new row
 * could be issued with no key provenance at all. After 329 a new ISSUED row
 * needs seal_status = 'KMS_HMAC' plus metadata signatureAlg / signingKeyId /
 * kmsKeyRef; 'LEGACY_UNSIGNED' is refused on INSERT (it exists only for rows
 * 329 classified); PgGradebookRepository round-trips sealStatus.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 329.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { getSharedGradebookPool, PgGradebookRepository } from './pg-gradebook-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'transcript-seal-status.live.test' });
const pool = getSharedGradebookPool();
const live = Boolean(DATABASE_URL) && pool !== null;

const KEYED = {
  signatureAlg: 'HMAC-SHA256',
  signingKeyId: 'transcript-key-1',
  kmsKeyRef: 'env:TRANSCRIPT_SIGNING_SECRET',
};

async function seedStudent(): Promise<{ tenantId: string; studentId: string }> {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `l292-${tenantId.slice(0, 8)}`, `l292-${tenantId}`],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Seal', 'Student', '2008-01-15', 'F')`,
      [studentId, tenantId],
    );
  });
  return { tenantId, studentId };
}

describe('PRC-L292 transcript seal status (live)', () => {
  it.skipIf(!live)('stores and returns KMS_HMAC for a dedicated-key issuance', async () => {
    const { tenantId, studentId } = await seedStudent();
    const repo = new PgGradebookRepository(pool!);
    const now = new Date().toISOString();
    const row = await repo.createTranscript({
      id: randomUUID(),
      tenantId,
      studentId,
      version: 1,
      status: 'ISSUED',
      issuedAt: now,
      issuedBy: null,
      artifactUri: null,
      checksumSha256: 'a'.repeat(64),
      signatureHmac: 'b'.repeat(64),
      sealStatus: 'KMS_HMAC',
      metadata: { ...KEYED },
      createdAt: now,
      updatedAt: now,
    });
    expect(row.sealStatus).toBe('KMS_HMAC');
    const reread = await repo.getTranscript(tenantId, row.id);
    expect(reread?.sealStatus).toBe('KMS_HMAC');
  });

  it.skipIf(!live)('refuses a new ISSUED row that is not KMS-sealed', async () => {
    const { tenantId, studentId } = await seedStudent();
    await withPgTenant(pool!, tenantId, async (client) => {
      const insert = (version: number, sealStatus: string | null, metadata: object) =>
        client.query(
          `INSERT INTO transcript_issuances (
             id, tenant_id, student_id, version, status, checksum_sha256, signature_hmac,
             metadata, seal_status
           ) VALUES ($1, $2, $3, $4, 'ISSUED', repeat('a', 64), repeat('c', 64), $5::jsonb, $6)`,
          [randomUUID(), tenantId, studentId, version, JSON.stringify(metadata), sealStatus],
        );
      const cases: Array<[string | null, object, RegExp | string]> = [
        [null, KEYED, /seal_status KMS_HMAC/],
        ['LEGACY_UNSIGNED', { legacyAuthenticitySeal: true }, /seal_status KMS_HMAC/],
        ['KMS_HMAC', {}, '23514'],
        ['KMS_HMAC', { ...KEYED, legacyAuthenticitySeal: true }, '23514'],
      ];
      for (const [i, [sealStatus, metadata, expected]] of cases.entries()) {
        await client.query(`SAVEPOINT c${i}`);
        const attempt = insert(i + 1, sealStatus, metadata);
        if (typeof expected === 'string') {
          await expect(attempt).rejects.toMatchObject({ code: expected });
        } else {
          await expect(attempt).rejects.toThrow(expected);
        }
        await client.query(`ROLLBACK TO SAVEPOINT c${i}`);
      }
      // A draft carries no seal.
      await client.query(
        `INSERT INTO transcript_issuances (id, tenant_id, student_id, version, status, metadata)
         VALUES ($1, $2, $3, 9, 'DRAFT', '{}'::jsonb)`,
        [randomUUID(), tenantId, studentId],
      );
    });
  });
});
