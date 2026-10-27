import { execFileSync } from 'node:child_process';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Test-only: move a tenant's loan due date into the past. The API refuses
 * past due dates (PRC-M104), so the overdue → fine path is set up in the DB.
 * Shared by the library live specs so the psql-writing setup cannot drift.
 */
export function backdateLibraryLoan(loanId: string, dueAt: string, tenantId: string): void {
  const url = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATOR_DATABASE_URL or DATABASE_URL is required to backdate a loan');
  if (!UUID_RE.test(loanId)) throw new Error(`Unexpected loan id: ${loanId}`);
  if (!UUID_RE.test(tenantId)) throw new Error(`Unexpected tenant id: ${tenantId}`);
  if (Number.isNaN(Date.parse(dueAt))) throw new Error(`Unexpected due date: ${dueAt}`);
  // One psql session: the session-level tenant setting satisfies RLS when the
  // URL is the non-owner app role; RETURNING proves exactly this row changed.
  const out = execFileSync(
    'psql',
    [
      url,
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
      '-c',
      `SELECT set_config('app.tenant_id', '${tenantId}', false)`,
      '-c',
      `UPDATE library_loans SET due_at = '${dueAt}'::timestamptz WHERE id = '${loanId}'::uuid AND tenant_id = '${tenantId}'::uuid RETURNING id`,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  if (!out.includes(loanId)) throw new Error(`Loan ${loanId} was not backdated: ${out}`);
}
