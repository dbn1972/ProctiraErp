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
 * handled is returned as a residual so the job fails closed: after the domain
 * anonymizers run, a coverage audit discovers every table linked to the
 * subject (tenant-data-registry.ts) and reports any unhandled or unclassified
 * table that still holds the subject's rows.
 *
 * Tenant wipe is deny-by-default: only tables the registry marks `wipe` are
 * deleted; statutory, audit, privacy-evidence and FK-dependency tables are
 * kept, and unclassified tables are left in place and reported as residual.
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
import {
  SUBJECT_LINK_COLUMNS,
  SUBJECT_LINK_REGISTRY,
  subjectKindFor,
  tenantWipeDisposition,
  type SubjectKind,
  type TenantWipeDisposition,
} from './tenant-data-registry.js';

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
  /**
   * Subject links (`table.column`, see SUBJECT_LINK_REGISTRY) this anonymizer
   * fully handles. Only covered `handled` links are exempt from the coverage audit.
   */
  readonly covers?: readonly string[];
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

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

const isType =
  (...types: string[]) =>
  (subjectType: string) =>
    types.includes(subjectType.trim().toLowerCase());

export const studentAnonymizer: DomainSubjectAnonymizer = {
  domain: 'students',
  covers: ['students.id'],
  appliesTo: isType('student'),
  async anonymize(client, input, token) {
    const res = await client.query(
      `UPDATE students
          SET first_name = 'Anonymised', last_name = $3, date_of_birth = DATE '1900-01-01',
              gender = 'other', national_id = NULL, custom_data = '{}'::jsonb,
              search_vector = NULL, updated_at = now()
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
        'students.gender',
        'students.national_id',
        'students.custom_data',
        'students.search_vector',
      ],
    };
  },
};

export const staffAnonymizer: DomainSubjectAnonymizer = {
  domain: 'staff',
  covers: ['staff.id'],
  appliesTo: isType('staff', 'employee', 'teacher'),
  async anonymize(client, input, token) {
    const res = await client.query(
      `UPDATE staff
          SET first_name = 'Anonymised', last_name = $3, identity_number = $3,
              date_of_birth = DATE '1900-01-01', custom_data = '{}'::jsonb,
              search_vector = NULL, updated_at = now()
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
        'staff.search_vector',
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
    covers: ['student_documents.student_id'],
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

/**
 * Student photo: object bytes erased via ObjectEraser, then the registry row is
 * deleted. Without an eraser nothing is deleted (the key is the only pointer
 * to the bytes) and a residual is reported.
 */
export function createStudentPhotoAnonymizer(objectEraser?: ObjectEraser): DomainSubjectAnonymizer {
  return {
    domain: 'photos',
    covers: ['student_photos.student_id'],
    appliesTo: isType('student'),
    async anonymize(client, input) {
      const res = await client.query(
        `SELECT object_key FROM student_photos
          WHERE student_id::text = $1 AND tenant_id::text = $2`,
        [input.subjectId, input.tenantId],
      );
      const rows = (res.rows ?? []) as Array<{ object_key: unknown }>;
      if (rows.length === 0) return { fieldsTouched: [] };
      if (!objectEraser) {
        return {
          fieldsTouched: [],
          residual: `photos: ${rows.length} stored photo object(s) not erased (no ObjectEraser configured)`,
        };
      }
      for (const row of rows) {
        await objectEraser.deleteObject(input.tenantId, String(row.object_key));
      }
      await client.query(
        `DELETE FROM student_photos WHERE student_id::text = $1 AND tenant_id::text = $2`,
        [input.subjectId, input.tenantId],
      );
      return { fieldsTouched: ['student_photos (rows + objects deleted)'] };
    },
  };
}

/** Sibling links name the subject's family relationships: deleted in both directions. */
export const studentSiblingsAnonymizer: DomainSubjectAnonymizer = {
  domain: 'siblings',
  covers: ['student_siblings.student_id', 'student_siblings.sibling_id'],
  appliesTo: isType('student'),
  async anonymize(client, input) {
    await client.query(
      `DELETE FROM student_siblings
        WHERE tenant_id::text = $2 AND (student_id::text = $1 OR sibling_id::text = $1)`,
      [input.subjectId, input.tenantId],
    );
    return { fieldsTouched: ['student_siblings (rows deleted)'] };
  },
};

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
    createStudentPhotoAnonymizer(options.objectEraser),
    studentSiblingsAnonymizer,
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
      const kind = subjectKindFor(input.subjectType);
      if (kind) {
        const covered = new Set(applicable.flatMap((d) => d.covers ?? []));
        const residual = await auditSubjectCoverage(client, input, kind, covered);
        if (residual) residuals.push(residual);
      }
      return {
        fieldsTouched,
        ...(residuals.length > 0 ? { residualNote: residuals.join('; ') } : {}),
      };
    });
  }
}

const MAX_LISTED_RESIDUAL_LINKS = 25;

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/**
 * Fail-closed coverage audit: discovers every column linking rows to the
 * subject and probes each link that is not covered by an applied anonymizer,
 * retained under statutory retention, or a pseudonymous key. Any remaining
 * subject row (or a failed probe) is a residual, so the erasure job cannot be
 * marked `completed` while child/staff PII is still present.
 */
async function auditSubjectCoverage(
  client: PgQueryable,
  input: AnonymizeSubjectInput,
  kind: SubjectKind,
  covered: ReadonlySet<string>,
): Promise<string | undefined> {
  const registry = new Map(SUBJECT_LINK_REGISTRY[kind].map((l) => [`${l.table}.${l.column}`, l]));
  const sp = 'privacy_coverage_audit';
  let discovered: Array<{ table: string; column: string; hasTenant: boolean }>;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const res = await client.query(
      `SELECT c.table_name, c.column_name,
              EXISTS (SELECT 1 FROM information_schema.columns t
                       WHERE t.table_schema = 'public' AND t.table_name = c.table_name
                         AND t.column_name = 'tenant_id') AS has_tenant
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND (c.column_name = ANY($1::text[])
               OR (c.table_name || '.' || c.column_name) = ANY($2::text[]))
        ORDER BY c.table_name, c.column_name`,
      [[...SUBJECT_LINK_COLUMNS[kind]], [...registry.keys()]],
    );
    discovered = ((res.rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      table: String(r['table_name']),
      column: String(r['column_name']),
      hasTenant: r['has_tenant'] === true || r['has_tenant'] === 't',
    }));
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return `coverage: subject-link discovery failed (${errMessage(err)}); erasure not verified`;
  }

  const remaining: string[] = [];
  for (const { table, column, hasTenant } of discovered) {
    const key = `${table}.${column}`;
    const entry = registry.get(key);
    if (entry?.handling === 'retained' || entry?.handling === 'pseudonymous') continue;
    if (entry?.handling === 'handled' && covered.has(key)) continue;
    const label = entry ? key : `${key} (unclassified)`;
    if (!SAFE_IDENT.test(table) || !SAFE_IDENT.test(column)) {
      remaining.push(`${label} (unsafe identifier, not probed)`);
      continue;
    }
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const res = await client.query(
        `SELECT 1 FROM "${table}" WHERE "${column}"::text = $1` +
          (hasTenant ? ' AND tenant_id::text = $2' : '') +
          ' LIMIT 1',
        hasTenant ? [input.subjectId, input.tenantId] : [input.subjectId],
      );
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      if ((res.rows ?? []).length > 0) remaining.push(label);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      remaining.push(`${label} (probe failed: ${errMessage(err)})`);
    }
  }
  if (remaining.length === 0) return undefined;
  const listed = remaining.slice(0, MAX_LISTED_RESIDUAL_LINKS).join(', ');
  const more =
    remaining.length > MAX_LISTED_RESIDUAL_LINKS
      ? ` (+${remaining.length - MAX_LISTED_RESIDUAL_LINKS} more)`
      : '';
  return `coverage: subject-linked rows not anonymised in ${listed}${more}`;
}

// ─── Tenant wipe ─────────────────────────────────────────────────────────────

/** Offboard checklist domain for a tenant-scoped table (`unclassified` → never deleted). */
export function classifyWipeTable(table: string): string {
  return tenantWipeDisposition(table)?.domain ?? 'unclassified';
}

export interface PgTenantWipeExecutorOptions {
  financeHealthMode?: FinanceHealthErasureMode;
  /** Deletes every stored object under the tenant prefix; absent → files residual. */
  objectStoreWiper?: { wipeTenant(tenantId: string): Promise<void> };
  /** Max FK-ordering passes (default 8). */
  maxPasses?: number;
}

type KeptDisposition = Exclude<TenantWipeDisposition, { action: 'wipe' }>;

/**
 * Real tenant data destruction, deny-by-default: deletes the tenant's rows only
 * from tables TENANT_WIPE_REGISTRY marks `wipe`, under the tenant's RLS
 * context, in repeated passes so FK order resolves. Statutory (fees, payroll,
 * health), audit, privacy-evidence and FK-dependency tables are kept and
 * reported as skipped; `manual` and unclassified tables are kept and reported
 * as residual so the offboard job fails closed.
 */
export class PgTenantWipeExecutor implements TenantWipeExecutor {
  constructor(
    private readonly pool: PrivacyPgPool,
    private readonly options: PgTenantWipeExecutorOptions = {},
  ) {}

  async wipe(input: TenantWipeInput): Promise<TenantWipeDomainResult[]> {
    const mode = this.options.financeHealthMode ?? 'retain';
    const maxPasses = this.options.maxPasses ?? 8;

    const outcome = await withPgTenant(this.pool, input.tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
          ORDER BY table_name`,
      );
      const tables = ((res.rows ?? []) as Array<{ table_name: unknown }>).map((r) =>
        String(r.table_name),
      );
      const toWipe = tables.filter(
        (t) => SAFE_IDENT.test(t) && tenantWipeDisposition(t)?.action === 'wipe',
      );
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

    const wiped = new Map<string, { tables: string[]; failed: string[] }>();
    const kept = new Map<string, { disposition: KeptDisposition; tables: string[] }>();
    const unclassified: string[] = [];
    for (const table of outcome.tables) {
      const disposition = SAFE_IDENT.test(table) ? tenantWipeDisposition(table) : undefined;
      if (!disposition) {
        unclassified.push(table);
      } else if (disposition.action === 'wipe') {
        const entry = wiped.get(disposition.domain) ?? { tables: [], failed: [] };
        entry.tables.push(table);
        if (outcome.failed.has(table)) entry.failed.push(table);
        wiped.set(disposition.domain, entry);
      } else {
        const key = `${disposition.action}:${disposition.domain}`;
        const entry = kept.get(key) ?? { disposition, tables: [] };
        entry.tables.push(table);
        kept.set(key, entry);
      }
    }

    const results: TenantWipeDomainResult[] = [];
    for (const [domain, entry] of [...wiped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      results.push(
        entry.failed.length > 0
          ? {
              domain,
              status: 'residual',
              note: `Delete failed for: ${entry.failed.join(', ')}`.slice(0, 500),
            }
          : { domain, status: 'completed', note: `${entry.tables.length} table(s) wiped` },
      );
    }
    for (const { disposition, tables } of [...kept.values()].sort((a, b) =>
      a.disposition.domain.localeCompare(b.disposition.domain),
    )) {
      const count = `${tables.length} table(s): ${tables.join(', ')}`;
      if (disposition.action === 'manual') {
        results.push({
          domain: disposition.domain,
          status: 'residual',
          note: `${disposition.basis}; not deleted — ${count}`.slice(0, 500),
        });
      } else {
        const modeNote =
          disposition.action === 'retain' ? ` (ERASURE_FINANCE_HEALTH_MODE=${mode})` : '';
        results.push({
          domain: disposition.domain,
          status: 'skipped',
          note: `${disposition.basis}${modeNote}; ${count}`.slice(0, 500),
        });
      }
    }
    if (unclassified.length > 0) {
      results.push({
        domain: 'unclassified',
        status: 'residual',
        note: `Not in the tenant wipe registry (deny by default); not deleted: ${unclassified.join(', ')}`.slice(
          0,
          500,
        ),
      });
    }
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
