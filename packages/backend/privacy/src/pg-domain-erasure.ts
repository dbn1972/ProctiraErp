/**
 * PRC-H077: real Postgres domain erasure for the privacy worker.
 *
 * `PgSubjectAnonymizer` pseudonymises / deletes a data subject's records across the student,
 * guardian, staff, health, fees and file domains inside ONE tenant transaction (RLS-bound via
 * withPgTenant). `PgTenantWipeExecutor` purges every tenant-owned table except statutory
 * retention tables.
 *
 * Erasure semantics (decision, PRC-H077):
 * - Financial records (invoices, payments, refunds, journals) are RETAINED for statutory
 *   accounting but pseudonymised: they keep amounts and point at the pseudonymised subject;
 *   payer identities are replaced with an erasure token. Owner may change via
 *   PRIVACY_ERASURE_FINANCIAL=retain (no payer pseudonymisation).
 * - Health / counselling records are DELETED (least data exposure). Owner may change via
 *   PRIVACY_ERASURE_HEALTH=retain.
 * - Audit trails and privacy/legal-hold records are retained (they hold ids, not PII payloads).
 *
 * Anything the executor cannot finish (missing file-object deleter, platform user account
 * owned by the auth control plane, unknown subject type) is reported as `residualNote` so
 * the job ends `failed` and the request stays retryable — never a false "completed".
 */
import { createHash } from 'node:crypto';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  AnonymizeSubjectInput,
  AnonymizeSubjectResult,
  SubjectAnonymizer,
  TenantWipeDomainResult,
  TenantWipeExecutor,
  TenantWipeInput,
} from './subject-anonymizer.js';

type Pool = Parameters<typeof withPgTenant>[0];

export type ErasureFinancialMode = 'pseudonymise' | 'retain';
export type ErasureHealthMode = 'delete' | 'retain';

export interface ErasurePolicy {
  financial: ErasureFinancialMode;
  health: ErasureHealthMode;
}

export function resolveErasurePolicy(
  env: Record<string, string | undefined> = process.env,
): ErasurePolicy {
  return {
    financial:
      env['PRIVACY_ERASURE_FINANCIAL']?.trim().toLowerCase() === 'retain'
        ? 'retain'
        : 'pseudonymise',
    health: env['PRIVACY_ERASURE_HEALTH']?.trim().toLowerCase() === 'retain' ? 'retain' : 'delete',
  };
}

export interface PgErasureOptions {
  pool: Pool;
  policy?: ErasurePolicy;
  /** Deletes a stored file object (student documents / photos). Absent → residual. */
  deleteObject?: (key: string) => Promise<void>;
  /** Anonymises the platform user account of a guardian/staff login. Absent → residual. */
  anonymizeUserAccount?: (input: { tenantId: string; userId: string }) => Promise<void>;
}

/** Child-first order so diagnosis-linked rows go before health_diagnoses. */
const STUDENT_HEALTH_TABLES = [
  'health_accommodation_plans',
  'health_referrals',
  'health_diagnoses',
  'health_allergies',
  'health_conditions',
  'health_insurance',
  'health_measurements',
  'health_nurse_incidents',
  'health_special_needs_assessments',
  'health_vaccinations',
  'health_phi_break_glass',
  'counselling_sessions',
] as const;

export function erasureToken(input: { tenantId: string; subjectType: string; subjectId: string }) {
  return `ERASED-${createHash('sha256')
    .update(`${input.tenantId}:${input.subjectType}:${input.subjectId}`)
    .digest('hex')
    .slice(0, 16)}`;
}

async function relationExists(client: PgQueryable, name: string): Promise<boolean> {
  const res = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return Boolean((res.rows[0] as { reg?: string | null } | undefined)?.reg);
}

async function run(
  client: PgQueryable,
  touched: string[],
  table: string,
  sql: string,
  params: unknown[],
): Promise<number> {
  if (!(await relationExists(client, table))) return 0;
  const res = (await client.query(sql, params)) as { rowCount?: number | null };
  const count = res.rowCount ?? 0;
  if (count > 0) touched.push(table);
  return count;
}

export class PgSubjectAnonymizer implements SubjectAnonymizer {
  private readonly policy: ErasurePolicy;

  constructor(private readonly options: PgErasureOptions) {
    this.policy = options.policy ?? resolveErasurePolicy();
  }

  async anonymize(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    const type = input.subjectType.trim().toLowerCase();
    if (type === 'student') return this.eraseStudent(input);
    if (type === 'staff') return this.eraseStaff(input);
    if (type === 'guardian' || type === 'parent') return this.eraseGuardian(input);
    return {
      fieldsTouched: [],
      residualNote: `No domain anonymizer for subject type '${input.subjectType}'`,
    };
  }

  private async eraseStudent(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    const token = erasureToken(input);
    const touched: string[] = [];
    const objectKeys: string[] = [];
    const p = [input.tenantId, input.subjectId];
    await withPgTenant(this.options.pool, input.tenantId, async (client) => {
      const updated = await run(
        client,
        touched,
        'students',
        `UPDATE students
            SET first_name = 'Erased', last_name = $3, date_of_birth = DATE '1900-01-01',
                national_id = NULL, admission_number = NULL, custom_data = '{}'::jsonb,
                search_vector = NULL, deleted_at = COALESCE(deleted_at, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [...p, token],
      );
      if (updated === 0) throw new Error(`Student ${input.subjectId} not found in tenant`);
      if (this.policy.health === 'delete') {
        for (const table of STUDENT_HEALTH_TABLES) {
          await run(
            client,
            touched,
            table,
            `DELETE FROM ${table} WHERE tenant_id = $1 AND student_id = $2`,
            p,
          );
        }
      }
      await run(
        client,
        touched,
        'student_discipline_incidents',
        `UPDATE student_discipline_incidents SET description = $3, action_taken = NULL
          WHERE tenant_id = $1 AND student_id = $2`,
        [...p, token],
      );
      await run(
        client,
        touched,
        'fee_concessions',
        `UPDATE fee_concessions SET reason = $3 WHERE tenant_id = $1 AND student_id = $2`,
        [...p, token],
      );
      for (const table of ['student_documents', 'student_photos']) {
        if (!(await relationExists(client, table))) continue;
        const keys = await client.query(
          `SELECT object_key FROM ${table} WHERE tenant_id = $1 AND student_id = $2`,
          p,
        );
        for (const row of keys.rows as Array<{ object_key: string }>)
          objectKeys.push(row.object_key);
        await run(
          client,
          touched,
          table,
          `DELETE FROM ${table} WHERE tenant_id = $1 AND student_id = $2`,
          p,
        );
      }
    });
    return this.finishWithObjects(touched, objectKeys);
  }

  private async eraseStaff(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    const token = erasureToken(input);
    const touched: string[] = [];
    let userId: string | null = null;
    await withPgTenant(this.options.pool, input.tenantId, async (client) => {
      const res = await client.query(
        `UPDATE staff
            SET first_name = 'Erased', last_name = $3, date_of_birth = DATE '1900-01-01',
                identity_number = $3, custom_data = '{}'::jsonb, search_vector = NULL,
                deleted_at = COALESCE(deleted_at, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING user_id::text AS user_id`,
        [input.tenantId, input.subjectId, token],
      );
      if ((res as { rowCount?: number | null }).rowCount === 0) {
        throw new Error(`Staff ${input.subjectId} not found in tenant`);
      }
      touched.push('staff');
      userId = (res.rows[0] as { user_id?: string | null } | undefined)?.user_id ?? null;
    });
    return this.finishWithAccount(touched, input.tenantId, userId);
  }

  private async eraseGuardian(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    const token = erasureToken(input);
    const touched: string[] = [];
    const p = [input.tenantId, input.subjectId];
    await withPgTenant(this.options.pool, input.tenantId, async (client) => {
      await run(
        client,
        touched,
        'parent_child_links',
        `DELETE FROM parent_child_links WHERE tenant_id = $1 AND parent_user_id = $2`,
        p,
      );
      await run(
        client,
        touched,
        'guardian_household_members',
        `DELETE FROM guardian_household_members WHERE tenant_id = $1 AND parent_user_id = $2`,
        p,
      );
      if (this.policy.financial === 'pseudonymise') {
        await run(
          client,
          touched,
          'parent_fee_payments',
          `UPDATE parent_fee_payments SET payer_user_id = $3
            WHERE tenant_id = $1 AND payer_user_id = $2`,
          [...p, token],
        );
      }
    });
    return this.finishWithAccount(touched, input.tenantId, input.subjectId);
  }

  private async finishWithObjects(
    touched: string[],
    objectKeys: string[],
  ): Promise<AnonymizeSubjectResult> {
    if (objectKeys.length === 0) return { fieldsTouched: touched };
    if (!this.options.deleteObject) {
      return {
        fieldsTouched: touched,
        residualNote: `${objectKeys.length} stored file object(s) need purge; no object deleter is configured`,
      };
    }
    const failed: string[] = [];
    for (const key of objectKeys) {
      try {
        await this.options.deleteObject(key);
      } catch {
        failed.push(key);
      }
    }
    return failed.length === 0
      ? { fieldsTouched: [...touched, 'file_objects'] }
      : {
          fieldsTouched: touched,
          residualNote: `${failed.length} stored file object(s) could not be deleted; retry`,
        };
  }

  private async finishWithAccount(
    touched: string[],
    tenantId: string,
    userId: string | null,
  ): Promise<AnonymizeSubjectResult> {
    if (!userId) return { fieldsTouched: touched };
    if (!this.options.anonymizeUserAccount) {
      return {
        fieldsTouched: touched,
        residualNote:
          'Tenant records erased; the platform login account is owned by the auth control plane and was not anonymised (no account anonymizer configured)',
      };
    }
    await this.options.anonymizeUserAccount({ tenantId, userId });
    return { fieldsTouched: [...touched, 'user_account'] };
  }
}

/**
 * Statutory retention on tenant offboarding (decision, PRC-H077): financial ledgers, audit
 * trails and privacy/legal-hold evidence are kept; every other tenant-owned table is purged.
 */
export const OFFBOARD_RETAINED_TABLE_PATTERNS: readonly RegExp[] = [
  /^parent_fee_(invoices|payments|receipts)$/,
  /^fee_(refunds|credit_notes|write_offs|journal.*|ledger.*)$/,
  /^finance_/,
  /audit/,
  /^privacy_/,
  /^legal_hold/,
  /^schema_migrations$/,
  /^tenants$/,
  /^outbox_events$/,
];

export function isRetainedOnOffboard(table: string): boolean {
  return OFFBOARD_RETAINED_TABLE_PATTERNS.some((re) => re.test(table));
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

const PSEUDONYMISE_ON_OFFBOARD: ReadonlyArray<readonly [string, string]> = [
  [
    'students',
    `UPDATE students SET first_name = 'Erased', last_name = $2, date_of_birth = DATE '1900-01-01',
            national_id = NULL, admission_number = NULL, custom_data = '{}'::jsonb,
            search_vector = NULL, deleted_at = COALESCE(deleted_at, now()), updated_at = now()
      WHERE tenant_id::text = $1`,
  ],
  [
    'staff',
    `UPDATE staff SET first_name = 'Erased', last_name = $2, date_of_birth = DATE '1900-01-01',
            identity_number = $2 || '-' || id::text, custom_data = '{}'::jsonb,
            search_vector = NULL, deleted_at = COALESCE(deleted_at, now()), updated_at = now()
      WHERE tenant_id::text = $1`,
  ],
];

export class PgTenantWipeExecutor implements TenantWipeExecutor {
  constructor(private readonly options: { pool: Pool; maxPasses?: number }) {}

  async wipe(input: TenantWipeInput): Promise<TenantWipeDomainResult[]> {
    return withPgTenant(this.options.pool, input.tenantId, async (client) => {
      const tablesRes = await client.query(
        `SELECT c.table_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
            AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name`,
      );
      const all = (tablesRes.rows as Array<{ table_name: string }>)
        .map((r) => r.table_name)
        .filter((name) => SAFE_IDENT.test(name));
      const retained = all.filter(isRetainedOnOffboard);
      let pending = all.filter((t) => !isRetainedOnOffboard(t));
      const purged: string[] = [];
      const maxPasses = this.options.maxPasses ?? 12;
      // FK order is unknown up front: retry tables that hit a FK violation on later passes.
      for (let pass = 0; pass < maxPasses && pending.length > 0; pass += 1) {
        const next: string[] = [];
        for (const table of pending) {
          await client.query('SAVEPOINT wipe_table');
          try {
            await client.query(`DELETE FROM ${table} WHERE tenant_id::text = $1`, [input.tenantId]);
            await client.query('RELEASE SAVEPOINT wipe_table');
            purged.push(table);
          } catch {
            await client.query('ROLLBACK TO SAVEPOINT wipe_table');
            next.push(table);
          }
        }
        if (next.length === pending.length) {
          pending = next;
          break;
        }
        pending = next;
      }
      // Rows still referenced by retained financial records are pseudonymised instead.
      const pseudonymised: string[] = [];
      for (const [table, sql] of PSEUDONYMISE_ON_OFFBOARD) {
        if (!pending.includes(table)) continue;
        await client.query(sql, [input.tenantId, `ERASED-OFFBOARD-${input.jobId.slice(0, 8)}`]);
        pseudonymised.push(table);
        pending = pending.filter((t) => t !== table);
      }
      const results: TenantWipeDomainResult[] = [
        {
          domain: 'tenant_tables',
          status: 'completed',
          note:
            `${purged.length} tables purged` +
            (pseudonymised.length
              ? `; pseudonymised (referenced by retained ledgers): ${pseudonymised.join(', ')}`
              : ''),
        },
        {
          domain: 'statutory_retention',
          status: 'skipped',
          note: `retained by policy: ${retained.join(', ') || 'none'}`,
        },
      ];
      if (pending.length > 0) {
        results.push({
          domain: 'blocked_tables',
          status: 'residual',
          note: `could not purge (referenced by retained rows or constraints): ${pending.join(', ')}`,
        });
      }
      return results;
    });
  }
}
