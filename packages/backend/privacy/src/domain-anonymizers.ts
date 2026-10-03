/**
 * PRC-H077: real per-domain SubjectAnonymizers and a Postgres TenantWipeExecutor.
 *
 * Subject erasure pseudonymises PII in place (students, staff), revokes and
 * pseudonymises guardian links, and removes subject files (object bytes via an
 * injected ObjectEraser). Financial (fees ledger) and health records are
 * retained intact under statutory retention by default
 * (`ERASURE_FINANCE_HEALTH_MODE=retain`, the only supported mode today) and are
 * reported as retained — never silently claimed as erased.
 *
 * Every statement runs under withPgTenant (RLS) and each domain runs inside a
 * SAVEPOINT so a missing table or failed statement is reported as a residual
 * for that domain instead of aborting the whole erasure. Anything not fully
 * handled is returned as a residual so the job fails closed.
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

/** Pool accepted by withPgTenant. */
export type PrivacyPgPool = Parameters<typeof withPgTenant>[0];

/** Statutory handling of financial / health records on erasure. */
export type FinanceHealthErasureMode = 'retain';

/** Parse ERASURE_FINANCE_HEALTH_MODE (default and only supported value: `retain`). */
export function readFinanceHealthErasureMode(
  env: Record<string, string | undefined> = process.env,
): FinanceHealthErasureMode {
  const raw = env['ERASURE_FINANCE_HEALTH_MODE']?.trim().toLowerCase();
  if (!raw || raw === 'retain') return 'retain';
  throw new Error(
    `ERASURE_FINANCE_HEALTH_MODE='${raw}' is not supported (only 'retain'); refusing to start`,
  );
}

/** Deletes stored object bytes (tenant-scoped object storage). */
export interface ObjectEraser {
  deleteObject(tenantId: string, objectKey: string): Promise<void>;
}

export interface DomainAnonymizeOutcome {
  fieldsTouched: string[];
  residual?: string;
}

export interface DomainSubjectAnonymizer {
  readonly domain: string;
  appliesTo(subjectType: string): boolean;
  anonymize(
    client: PgQueryable,
    input: AnonymizeSubjectInput,
    token: string,
  ): Promise<DomainAnonymizeOutcome>;
}

function anonToken(input: AnonymizeSubjectInput): string {
  return createHash('sha256')
    .update(`${input.tenantId}:${input.subjectType}:${input.subjectId}`)
    .digest('hex')
    .slice(0, 16);
}

function rowCount(res: unknown): number {
  const n = (res as { rowCount?: number | null }).rowCount;
  return typeof n === 'number' ? n : 0;
}

const isType =
  (...types: string[]) =>
  (subjectType: string) =>
    types.includes(subjectType.trim().toLowerCase());

export const studentAnonymizer: DomainSubjectAnonymizer = {
  domain: 'students',
  appliesTo: isType('student'),
  async anonymize(client, input, token) {
    const res = await client.query(
      `UPDATE students
          SET first_name = 'Anonymised', last_name = $3, date_of_birth = DATE '1900-01-01',
              national_id = NULL, custom_data = '{}'::jsonb, updated_at = now()
        WHERE id::text = $1 AND tenant_id::text = $2`,
      [input.subjectId, input.tenantId, `ANON-${token}`],
    );
    if (rowCount(res) === 0) {
      return { fieldsTouched: [], residual: 'students: subject row not found' };
    }
    return {
      fieldsTouched: [
        'students.first_name',
        'students.last_name',
        'students.date_of_birth',
        'students.national_id',
        'students.custom_data',
      ],
    };
  },
};

export const staffAnonymizer: DomainSubjectAnonymizer = {
  domain: 'staff',
  appliesTo: isType('staff', 'employee', 'teacher'),
  async anonymize(client, input, token) {
    const res = await client.query(
      `UPDATE staff
          SET first_name = 'Anonymised', last_name = $3, identity_number = $3,
              date_of_birth = DATE '1900-01-01', custom_data = '{}'::jsonb, updated_at = now()
        WHERE id::text = $1 AND tenant_id::text = $2`,
      [input.subjectId, input.tenantId, `ANON-${token}`],
    );
    if (rowCount(res) === 0) {
      return { fieldsTouched: [], residual: 'staff: subject row not found' };
    }
    return {
      fieldsTouched: [
        'staff.first_name',
        'staff.last_name',
        'staff.identity_number',
        'staff.date_of_birth',
        'staff.custom_data',
      ],
    };
  },
};

/**
 * Guardians: links are revoked and the guardian user id pseudonymised. The
 * guardian's identity-provider account (name/email) is outside this database
 * and is reported as a residual so the erasure is not claimed complete.
 */
export const guardianAnonymizer: DomainSubjectAnonymizer = {
  domain: 'guardians',
  appliesTo: isType('guardian', 'parent'),
  async anonymize(client, input, token) {
    const pseudo = `anon:${token}`;
    await client.query(
      `UPDATE parent_child_links SET status = 'revoked', parent_user_id = $3, updated_at = now()
        WHERE parent_user_id = $1 AND tenant_id::text = $2`,
      [input.subjectId, input.tenantId, pseudo],
    );
    await client.query(
      `UPDATE guardian_household_members
          SET status = 'revoked', parent_user_id = $3, updated_at = now()
        WHERE parent_user_id = $1 AND tenant_id::text = $2`,
      [input.subjectId, input.tenantId, pseudo],
    );
    return {
      fieldsTouched: [
        'parent_child_links.parent_user_id',
        'parent_child_links.status',
        'guardian_household_members.parent_user_id',
        'guardian_household_members.status',
      ],
      residual:
        'guardians: identity-provider account (name/email) must be erased in the IdP; not handled here',
    };
  },
};

/** Student files: object bytes erased via ObjectEraser, then registry rows deleted. */
export function createStudentFilesAnonymizer(objectEraser?: ObjectEraser): DomainSubjectAnonymizer {
  return {
    domain: 'files',
    appliesTo: isType('student'),
    async anonymize(client, input) {
      const res = await client.query(
        `SELECT id, object_key FROM student_documents
          WHERE student_id::text = $1 AND tenant_id::text = $2`,
        [input.subjectId, input.tenantId],
      );
      const rows = (res.rows ?? []) as Array<{ id: unknown; object_key: unknown }>;
      if (rows.length === 0) return { fieldsTouched: [] };
      if (!objectEraser) {
        await client.query(
          `UPDATE student_documents SET file_name = 'redacted'
            WHERE student_id::text = $1 AND tenant_id::text = $2`,
          [input.subjectId, input.tenantId],
        );
        return {
          fieldsTouched: ['student_documents.file_name'],
          residual: `files: ${rows.length} stored object(s) not erased (no ObjectEraser configured)`,
        };
      }
      for (const row of rows) {
        await objectEraser.deleteObject(input.tenantId, String(row.object_key));
      }
      await client.query(
        `DELETE FROM student_documents WHERE student_id::text = $1 AND tenant_id::text = $2`,
        [input.subjectId, input.tenantId],
      );
      return { fieldsTouched: ['student_documents (rows + objects deleted)'] };
    },
  };
}

/** Fees ledger / health records: retained under statutory retention (no mutation). */
export function createRetainedRecordsAnonymizer(
  domain: 'fees' | 'health',
  mode: FinanceHealthErasureMode,
): DomainSubjectAnonymizer {
  return {
    domain,
    appliesTo: isType('student', 'staff', 'employee', 'teacher'),
    async anonymize() {
      return { fieldsTouched: [`${domain}:retained_statutory(${mode})`] };
    },
  };
}

export interface PgDomainSubjectAnonymizerOptions {
  financeHealthMode?: FinanceHealthErasureMode;
  objectEraser?: ObjectEraser;
  domains?: DomainSubjectAnonymizer[];
}

export function defaultDomainAnonymizers(
  options: PgDomainSubjectAnonymizerOptions = {},
): DomainSubjectAnonymizer[] {
  const mode = options.financeHealthMode ?? 'retain';
  return [
    studentAnonymizer,
    guardianAnonymizer,
    staffAnonymizer,
    createStudentFilesAnonymizer(options.objectEraser),
    createRetainedRecordsAnonymizer('fees', mode),
    createRetainedRecordsAnonymizer('health', mode),
  ];
}

/** Composite Postgres SubjectAnonymizer (one tenant transaction, savepoint per domain). */
export class PgDomainSubjectAnonymizer implements SubjectAnonymizer {
  private readonly domains: DomainSubjectAnonymizer[];

  constructor(
    private readonly pool: PrivacyPgPool,
    options: PgDomainSubjectAnonymizerOptions = {},
  ) {
    this.domains = options.domains ?? defaultDomainAnonymizers(options);
  }

  async anonymize(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    const applicable = this.domains.filter((d) => d.appliesTo(input.subjectType));
    if (applicable.length === 0) {
      return {
        fieldsTouched: [],
        residualNote: `No domain anonymizer implemented for subject type '${input.subjectType}'`,
      };
    }
    const token = anonToken(input);
    return withPgTenant(this.pool, input.tenantId, async (client) => {
      const fieldsTouched: string[] = [];
      const residuals: string[] = [];
      for (const [i, domain] of applicable.entries()) {
        const sp = `privacy_domain_${i}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const out = await domain.anonymize(client, input, token);
          fieldsTouched.push(...out.fieldsTouched);
          if (out.residual) residuals.push(out.residual);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          residuals.push(
            `${domain.domain}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
          );
        }
      }
      return {
        fieldsTouched,
        ...(residuals.length > 0 ? { residualNote: residuals.join('; ') } : {}),
      };
    });
  }
}

// ─── Tenant wipe ─────────────────────────────────────────────────────────────

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

/** Tables never deleted by a tenant wipe (control plane, privacy evidence, audit). */
const PRESERVED_PREFIXES = ['privacy_', 'audit', 'tenants', 'schema_migrations', 'outbox'];

/** Offboard checklist domain for a tenant-scoped table. */
export function classifyWipeTable(table: string): string {
  if (/^(fee|fees_|parent_fee|payment|invoice|receipt|ledger)/.test(table)) return 'fees';
  if (/^health/.test(table)) return 'health';
  if (/^audit/.test(table)) return 'audit_archives';
  if (/(_documents|_files|_attachments)$/.test(table)) return 'files_storage';
  if (/^staff|^payroll|^hr_/.test(table)) return 'staff';
  if (/^student|^guardian|^parent_|^enrol|^admission/.test(table)) return 'students';
  return 'other';
}

export interface PgTenantWipeExecutorOptions {
  financeHealthMode?: FinanceHealthErasureMode;
  /** Deletes every stored object under the tenant prefix; absent → files residual. */
  objectStoreWiper?: { wipeTenant(tenantId: string): Promise<void> };
  /** Max FK-ordering passes (default 8). */
  maxPasses?: number;
}

/**
 * Real tenant data destruction: deletes every row of `tenant_id` from all
 * tenant-scoped public tables (discovered from information_schema) under the
 * tenant's RLS context, in repeated passes so FK order resolves. Fees/health
 * are retained under `retain` mode; audit and privacy evidence are preserved.
 */
export class PgTenantWipeExecutor implements TenantWipeExecutor {
  constructor(
    private readonly pool: PrivacyPgPool,
    private readonly options: PgTenantWipeExecutorOptions = {},
  ) {}

  async wipe(input: TenantWipeInput): Promise<TenantWipeDomainResult[]> {
    const mode = this.options.financeHealthMode ?? 'retain';
    const retained = new Set(mode === 'retain' ? ['fees', 'health'] : []);
    const maxPasses = this.options.maxPasses ?? 8;

    const outcome = await withPgTenant(this.pool, input.tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
          ORDER BY table_name`,
      );
      const tables = ((res.rows ?? []) as Array<{ table_name: unknown }>)
        .map((r) => String(r.table_name))
        .filter((t) => SAFE_IDENT.test(t))
        .filter((t) => !PRESERVED_PREFIXES.some((p) => t.startsWith(p)));
      const toWipe = tables.filter((t) => !retained.has(classifyWipeTable(t)));
      const failed = new Map<string, string>();
      let pending = [...toWipe];
      for (let pass = 0; pass < maxPasses && pending.length > 0; pass += 1) {
        const next: string[] = [];
        for (const table of pending) {
          await client.query('SAVEPOINT tenant_wipe_table');
          try {
            await client.query(`DELETE FROM "${table}" WHERE tenant_id::text = $1`, [
              input.tenantId,
            ]);
            await client.query('RELEASE SAVEPOINT tenant_wipe_table');
            failed.delete(table);
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT tenant_wipe_table');
            failed.set(table, err instanceof Error ? err.message : String(err));
            next.push(table);
          }
        }
        if (next.length === pending.length) break; // no progress
        pending = next;
      }
      return { tables, failed };
    });

    const byDomain = new Map<string, { tables: string[]; failed: string[] }>();
    for (const table of outcome.tables) {
      const domain = classifyWipeTable(table);
      const entry = byDomain.get(domain) ?? { tables: [], failed: [] };
      entry.tables.push(table);
      if (outcome.failed.has(table)) entry.failed.push(table);
      byDomain.set(domain, entry);
    }

    const results: TenantWipeDomainResult[] = [];
    for (const [domain, entry] of [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (retained.has(domain)) {
        results.push({
          domain,
          status: 'skipped',
          note: `Retained under statutory retention (ERASURE_FINANCE_HEALTH_MODE=${mode}); ${entry.tables.length} table(s)`,
        });
      } else if (entry.failed.length > 0) {
        results.push({
          domain,
          status: 'residual',
          note: `Delete failed for: ${entry.failed.join(', ')}`.slice(0, 500),
        });
      } else {
        results.push({ domain, status: 'completed', note: `${entry.tables.length} table(s) wiped` });
      }
    }
    results.push({
      domain: 'audit_archives',
      status: 'skipped',
      note: 'Audit and privacy evidence preserved by policy',
    });
    if (this.options.objectStoreWiper) {
      try {
        await this.options.objectStoreWiper.wipeTenant(input.tenantId);
        results.push({ domain: 'object_storage', status: 'completed' });
      } catch (err) {
        results.push({
          domain: 'object_storage',
          status: 'residual',
          note: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      results.push({
        domain: 'object_storage',
        status: 'residual',
        note: 'No object store wiper configured; stored files not erased',
      });
    }
    return results;
  }
}
