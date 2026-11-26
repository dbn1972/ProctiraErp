/**
 * F-D1 / F-D2 live proof for the read-only detection report
 * (tools/scripts/fees-scholarship-netting-report.{sql,mjs}) as the runtime role
 * proctira_app: legacy netting rows that credited ₹0 (F-D1), a capped netting whose excess
 * was never recorded (F-D2) and a legacy "credit reserved" row are listed with expected and
 * actual credit in paise; a correct netting is not listed; the report writes nothing and
 * sees only the bound tenant. Skips without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'pg-fees-scholarship-netting-report.live.test',
});
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

const REPORT_MODULE = pathToFileURL(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../tools/scripts/fees-scholarship-netting-report.mjs',
  ),
).href;

type ReportRow = Record<string, string | number | null>;
type ReportModule = {
  runReport: (client: pg.Client, tenantId: string | null) => Promise<ReportRow[]>;
};

async function runReport(tenantId: string): Promise<ReportRow[]> {
  const mod = (await import(REPORT_MODULE)) as ReportModule;
  const client = new pg.Client({ connectionString: DATABASE_URL! });
  await client.connect();
  try {
    return await mod.runReport(client, tenantId);
  } finally {
    await client.end();
  }
}

async function paidDisbursement(tenantId: string, studentId: string, amountCents: number) {
  const programId = randomUUID();
  const applicationId = randomUUID();
  const disbursementId = randomUUID();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO scholarship_programs
         (id, tenant_id, name, application_start_date, application_end_date, total_slots,
          amount_per_recipient, amount_per_recipient_cents, currency, status)
       VALUES ($1, $2, 'Live report programme', DATE '2020-01-01', DATE '2099-12-31', 5,
               $3, $4, 'INR', 'open')`,
      [programId, tenantId, amountCents / 100, amountCents],
    );
    await client.query(
      `INSERT INTO scholarship_applications
         (id, tenant_id, program_id, applicant_id, institution_id, status)
       VALUES ($1, $2, $3, $4, $5, 'approved')`,
      [applicationId, tenantId, programId, studentId, randomUUID()],
    );
    await client.query(
      `INSERT INTO scholarship_disbursements
         (id, tenant_id, application_id, amount, amount_cents, scheduled_date, paid_date,
          payment_status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_DATE, 'paid')`,
      [disbursementId, tenantId, applicationId, amountCents / 100, amountCents],
    );
  });
  return disbursementId;
}

/** Insert a netting row the way the pre-fix code left it (no ledger leg posted). */
async function legacyNettingRow(
  tenantId: string,
  row: {
    studentId: string;
    structureId: string;
    invoiceId: string | null;
    amountCents: number;
    disbursementId: string;
  },
) {
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO fee_concessions
         (id, tenant_id, student_id, structure_id, invoice_id, kind, amount_cents, reason,
          source_disbursement_id, approver_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'amount', $6, $7, $8, 'scholarship-netting', 'approved',
               'scholarship-netting')`,
      [
        randomUUID(),
        tenantId,
        row.studentId,
        row.structureId,
        row.invoiceId,
        row.amountCents,
        `scholarship_netting:${row.disbursementId}`,
        row.disbursementId,
      ],
    );
  });
}

async function tableCounts(tenantId: string) {
  return withPgTenant(pool!, tenantId, async (client) => {
    const res = await client.query(
      `SELECT (SELECT count(*) FROM fee_concessions)::int AS concessions,
              (SELECT count(*) FROM fee_ledger_entries)::int AS ledger,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM parent_fee_invoices)::bigint AS faces`,
    );
    return res.rows[0] as Record<string, unknown>;
  });
}

describe('scholarship netting detection report (live, F-D1/F-D2)', () => {
  it.skipIf(!live)(
    'lists ₹0, capped and reserved nettings with expected vs actual credit',
    async () => {
      const repo = new PgFeesRepository(pool!);
      const service = new FeesService(repo, new SandboxPaymentAdapter());
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await ensurePgTestStudent(pool!, tenantId, studentId);
      const anchor = await service.createFeeStructure(tenantId, 'staff-1', {
        code: 'SCHOLARSHIP_NET',
        name: 'Scholarship netting',
        category: 'scholarship',
        amountCents: 0,
      });

      // F-D1 legacy: ad-hoc ₹2,000.00 invoice, ₹500.25 recorded, nothing posted.
      const adhoc = await service.createInvoice(tenantId, 'staff-1', {
        studentId,
        title: 'Ad-hoc',
        amountCents: 200_000,
      });
      const d1 = await paidDisbursement(tenantId, studentId, 50_025);
      await legacyNettingRow(tenantId, {
        studentId,
        structureId: anchor.id,
        invoiceId: adhoc.id,
        amountCents: 50_025,
        disbursementId: d1,
      });

      // F-D2: ₹1,500 on a ₹1,000 structure invoice; ₹1,000 credited, ₹500 not recorded.
      const structure = await service.createFeeStructure(tenantId, 'staff-1', {
        name: 'Tuition',
        category: 'tuition',
        amountCents: 100_000,
      });
      const { created } = await service.bulkInvoiceClass(tenantId, 'staff-1', {
        structureId: structure.id,
        studentIds: [studentId],
      });
      const d2 = await paidDisbursement(tenantId, studentId, 150_000);
      await service.applyScholarshipNetting(tenantId, 'scholarship-netting', {
        studentId,
        disbursementId: d2,
        amountCents: 150_000,
        invoiceId: created[0]!.id,
      });

      // Legacy reserved row: no invoice, never credited.
      const d3 = await paidDisbursement(tenantId, studentId, 12_345);
      await legacyNettingRow(tenantId, {
        studentId,
        structureId: anchor.id,
        invoiceId: null,
        amountCents: 12_345,
        disbursementId: d3,
      });

      // Correct netting: fully applied, must not be listed.
      const d4 = await paidDisbursement(tenantId, studentId, 25_025);
      await service.applyScholarshipNetting(tenantId, 'scholarship-netting', {
        studentId,
        disbursementId: d4,
        amountCents: 25_025,
        invoiceId: adhoc.id,
      });

      const before = await tableCounts(tenantId);
      const rows = await runReport(tenantId);
      expect(await tableCounts(tenantId)).toEqual(before);

      const byId = new Map(rows.map((r) => [r.disbursement_id, r]));
      expect([...byId.keys()].sort()).toEqual([d1, d2, d3].sort());
      expect(byId.get(d1)).toMatchObject({
        expected_credit_cents: 50_025,
        recorded_credit_cents: 50_025,
        applied_credit_cents: 0,
        uncredited_cents: 50_025,
        remaining_cents: 0,
        reversal_overstated_cents: 50_025,
        findings: 'F-D1_zero_or_short_credit',
      });
      expect(byId.get(d2)).toMatchObject({
        expected_credit_cents: 150_000,
        recorded_credit_cents: 100_000,
        applied_credit_cents: 100_000,
        uncredited_cents: 50_000,
        remaining_cents: 50_000,
        reversal_overstated_cents: 0,
        findings: 'F-D2_remainder_not_netted',
      });
      expect(byId.get(d3)).toMatchObject({
        expected_credit_cents: 12_345,
        recorded_credit_cents: 12_345,
        applied_credit_cents: 0,
        reserved_cents: 12_345,
        uncredited_cents: 12_345,
        findings: 'reserved_not_applied',
      });

      // RLS: another tenant sees none of these rows.
      const otherTenant = randomUUID();
      await ensurePgTestTenant(pool!, otherTenant);
      expect(await runReport(otherTenant)).toEqual([]);
    },
  );
});
