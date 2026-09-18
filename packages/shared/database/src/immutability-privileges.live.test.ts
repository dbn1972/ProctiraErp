/**
 * W1-DATA-08 — immutability privileges + transcript authenticity (053/069/076).
 *
 * Before 053/069: archive rows mutable; ISSUED transcripts lacked DB authenticity.
 * After 053+069: UPDATE/DELETE rejected on ledger/audit/archive/transcript;
 * ISSUED inserts require checksum_sha256 + signature_hmac; DROP TRIGGER denied.
 * After 076: authenticity CHECK VALIDATED; transcript_signing_keys registry present.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { ensurePgTestStudent } from './test-fixtures.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'immutability-privileges.live.test' });

const IMMUTABLE_APPEND_ONLY_TRIGGERS = [
  { table: 'fee_ledger_entries', trigger: 'trg_fee_ledger_append_only' },
  { table: 'audit_log_entries', trigger: 'trg_audit_log_append_only' },
  { table: 'audit_log_archive', trigger: 'trg_audit_log_archive_append_only' },
  { table: 'workflow_transition_audit', trigger: 'trg_workflow_transition_audit_immutable' },
  { table: 'transcript_issuances', trigger: 'trg_transcript_issuances_append_only' },
] as const;

describe.skipIf(!DATABASE_URL)('W1-DATA-08 immutability privileges (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('DATABASE_URL connects as non-owner proctira_app', async () => {
    const { rows } = await pool.query<{ current_user: string; rolsuper: boolean }>(`
      SELECT
        current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper
    `);
    expect(rows[0]!.current_user).toBe('proctira_app');
    expect(rows[0]!.rolsuper).toBe(false);
  });

  it('runtime role cannot DROP immutability triggers on ledger/audit/transcript tables', async () => {
    for (const { table, trigger } of IMMUTABLE_APPEND_ONLY_TRIGGERS) {
      await expect(pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`)).rejects.toThrow(
        /must be owner|permission denied/i,
      );
    }
  });

  it('runtime role cannot UPDATE issued transcript rows (append-only + REVOKE)', async () => {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    const transcriptId = randomUUID();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'Immut Test', $2, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, `immut-${tenantId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
         VALUES ($1, $2, 'Test', 'Student', '2010-01-01', 'unspecified')
         ON CONFLICT (id) DO NOTHING`,
        [studentId, tenantId],
      );
      await client.query(
        `INSERT INTO transcript_issuances (
           id, tenant_id, student_id, version, status, checksum_sha256, signature_hmac, metadata
         ) VALUES ($1, $2, $3, 1, 'ISSUED', repeat('a', 64), repeat('c', 64), '{}'::jsonb)`,
        [transcriptId, tenantId, studentId],
      );
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(
          `UPDATE transcript_issuances SET checksum_sha256 = repeat('b', 64) WHERE id = $1`,
          [transcriptId],
        ),
      ).rejects.toThrow(/append-only|permission denied/i);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`DELETE FROM transcript_issuances WHERE id = $1`, [transcriptId]),
      ).rejects.toThrow(/append-only|permission denied/i);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('runtime role cannot UPDATE/DELETE audit_log_archive rows (append-only + REVOKE)', async () => {
    const tenantId = randomUUID();
    const entryId = randomUUID();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(
        `INSERT INTO audit_log_archive (
           id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, destination
         ) VALUES (
           $1, $2, 'student', 's1', 'CREATE', 'u1', 'Tester',
           '127.0.0.1', NOW(), 's3://audit-archive/test'
         )`,
        [entryId, tenantId],
      );
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`UPDATE audit_log_archive SET entity_id = 'tampered' WHERE id = $1`, [
          entryId,
        ]),
      ).rejects.toThrow(/append-only|permission denied/i);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`DELETE FROM audit_log_archive WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/append-only|permission denied/i);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('rejects ISSUED transcript INSERT without checksum/signature authenticity', async () => {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(
        `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'Auth Test', $2, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, `auth-${tenantId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
         VALUES ($1, $2, 'Auth', 'Student', '2010-01-01', 'unspecified')
         ON CONFLICT (id) DO NOTHING`,
        [studentId, tenantId],
      );

      await client.query('SAVEPOINT missing_checksum');
      await expect(
        client.query(
          `INSERT INTO transcript_issuances (
             id, tenant_id, student_id, version, status, checksum_sha256, metadata
           ) VALUES ($1, $2, $3, 1, 'ISSUED', NULL, '{}'::jsonb)`,
          [randomUUID(), tenantId, studentId],
        ),
      ).rejects.toThrow(/checksum_sha256|authenticity|integrity/i);
      await client.query('ROLLBACK TO SAVEPOINT missing_checksum');

      await client.query('SAVEPOINT missing_signature');
      await expect(
        client.query(
          `INSERT INTO transcript_issuances (
             id, tenant_id, student_id, version, status, checksum_sha256, signature_hmac, metadata
           ) VALUES ($1, $2, $3, 2, 'ISSUED', repeat('a', 64), NULL, '{}'::jsonb)`,
          [randomUUID(), tenantId, studentId],
        ),
      ).rejects.toThrow(/signature_hmac|authenticity|integrity/i);
      await client.query('ROLLBACK TO SAVEPOINT missing_signature');

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('W1-DATA-08 COMPLETE: authenticity CHECK is VALID after 076 backfill', async () => {
    const { rows } = await pool.query<{
      conname: string;
      convalidated: boolean;
    }>(`
      SELECT c.conname, c.convalidated
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'transcript_issuances'
        AND c.conname = 'transcript_issuances_issued_authenticity_chk'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0]!.convalidated).toBe(true);
  });

  it('W1-DATA-08 COMPLETE: transcript_signing_keys registry exists with kms_key_ref', async () => {
    const { rows } = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'transcript_signing_keys'
        AND column_name IN ('kms_key_ref', 'key_id', 'tenant_id', 'institution_id', 'status')
      ORDER BY column_name
    `);
    expect(rows.map((r) => r.column_name)).toEqual([
      'institution_id',
      'key_id',
      'kms_key_ref',
      'status',
      'tenant_id',
    ]);
  });

  it('runtime role cannot UPDATE fee_ledger_entries (existing append-only trigger)', async () => {
    const tenantId = randomUUID();
    const journalId = randomUUID();
    const invoiceId = randomUUID();
    const legId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestStudent(pool, tenantId, studentId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO parent_fee_invoices (
           id, tenant_id, student_id, title, description, amount_cents, currency, status
         ) VALUES ($1, $2, $3, 'Immutability fixture', '', 100, 'INR', 'open')`,
        [invoiceId, tenantId, studentId],
      );
      await client.query(
        `INSERT INTO fee_ledger_entries (
           id, tenant_id, journal_id, invoice_id, account, side, amount_cents, currency
         ) VALUES ($1, $2, $3, $4, 'cash', 'debit', 100, 'INR')`,
        [legId, tenantId, journalId, invoiceId],
      );
      await client.query(
        `INSERT INTO fee_ledger_entries (
           id, tenant_id, journal_id, invoice_id, account, side, amount_cents, currency
         ) VALUES ($1, $2, $3, $4, 'accounts_receivable', 'credit', 100, 'INR')`,
        [randomUUID(), tenantId, journalId, invoiceId],
      );

      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`UPDATE fee_ledger_entries SET amount_cents = 1 WHERE id = $1`, [legId]),
      ).rejects.toThrow(/append-only|permission denied/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
