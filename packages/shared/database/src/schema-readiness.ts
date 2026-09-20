/**
 * Read-only database schema readiness checks for application runtimes.
 *
 * Schema changes are owned by the migrator role. Runtime roles verify both
 * required relations and the minimum migration contract; they never replay DDL.
 */

import { DATABASE_SCHEMA_CONTRACTS, type DatabaseSchemaContractName } from './schema-contracts.js';

/** Minimal query surface accepted from node-pg pools and test doubles. */
export interface SchemaReadinessQueryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** Latest non-seed domain migration required by this application build. */
export const CURRENT_RUNTIME_SCHEMA_MIGRATION = '097_admissions_public_context.sql';

/** Integrity migrations whose live contracts remain required after newer releases. */
export const PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS = [
  '082_repair_strict_tenant_fk_validate.sql',
  '092_hostel_assignment_uniqueness.sql',
  '093_developer_portal_tenant_fks.sql',
  '094_developer_portal_api_key_lookup.sql',
  // Residual 047 policies fail closed only once this migration is applied. Keep it
  // permanently required so a later marker bump cannot silently stop verifying it.
  '095_w1_data_02_rls_safe_deny.sql',
  // Single audit authority: validated parent FKs plus SELECT-only runtime grants on
  // the trigger-owned audit tables. Stays required so a later marker bump cannot
  // let a database with unvalidated audit FKs pass readiness.
  '096_w1_data_14_audit_fk_integrity.sql',
  // Admissions public submissions require durable context snapshots and the
  // tenant-scoped submission-key unique index even after later marker bumps.
  '097_admissions_public_context.sql',
] as const;

export function requiredRuntimeMigrationsFor(currentMigration: string): readonly string[] {
  return [...new Set([...PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS, currentMigration])];
}

/** Latest marker plus permanent integrity contracts required by this build. */
export const REQUIRED_RUNTIME_MIGRATIONS = requiredRuntimeMigrationsFor(
  CURRENT_RUNTIME_SCHEMA_MIGRATION,
);

export const SCHEMA_READINESS_SQL = `
  WITH relation_status AS (
    SELECT 'relation'::text AS requirement_type,
           requested.relation_name AS requirement_name,
           to_regclass(requested.relation_name) IS NOT NULL AS requirement_exists,
           requested.position
      FROM unnest($1::text[]) WITH ORDINALITY
        AS requested(relation_name, position)
  ), migration_status AS (
    SELECT 'migration'::text AS requirement_type,
           status.migration_name AS requirement_name,
           status.migration_applied AS requirement_exists,
           status.position
      FROM public.proctira_runtime_migration_status($2::text[])
        WITH ORDINALITY AS status(migration_name, migration_applied, position)
  )
  SELECT requirement_type, requirement_name, requirement_exists
    FROM relation_status
  UNION ALL
  SELECT requirement_type, requirement_name, requirement_exists
    FROM migration_status
   ORDER BY requirement_type, requirement_name
`;

const QUALIFIED_RELATION = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const MIGRATION_FILENAME = /^[0-9][0-9A-Za-z_]*\.sql$/;

export type DatabaseSchemaRelations = readonly string[] | DatabaseSchemaContractName;

function resolveRelations(requiredRelations: DatabaseSchemaRelations): readonly string[] {
  return typeof requiredRelations === 'string'
    ? DATABASE_SCHEMA_CONTRACTS[requiredRelations]
    : requiredRelations;
}

function normalizeRequirements(
  domain: string,
  requiredRelations: readonly string[],
  requiredMigrations: readonly string[],
): {
  domain: string;
  relations: string[];
  migrations: string[];
} {
  const normalizedDomain = domain.trim();
  if (!normalizedDomain) {
    throw new TypeError('Database schema readiness domain must not be empty');
  }
  if (requiredRelations.length === 0) {
    throw new TypeError(`Database schema readiness for "${normalizedDomain}" requires relations`);
  }
  if (requiredMigrations.length === 0) {
    throw new TypeError(`Database schema readiness for "${normalizedDomain}" requires migrations`);
  }

  const relations = [...new Set(requiredRelations.map((relation) => relation.trim()))];
  const invalidRelations = relations.filter((relation) => !QUALIFIED_RELATION.test(relation));
  if (invalidRelations.length > 0) {
    throw new TypeError(
      `Database schema readiness relations must be schema-qualified identifiers: ${invalidRelations.join(', ')}`,
    );
  }

  const migrations = [...new Set(requiredMigrations.map((migration) => migration.trim()))];
  const invalidMigrations = migrations.filter((migration) => !MIGRATION_FILENAME.test(migration));
  if (invalidMigrations.length > 0) {
    throw new TypeError(
      `Database schema readiness migrations must be numbered SQL filenames: ${invalidMigrations.join(', ')}`,
    );
  }

  return { domain: normalizedDomain, relations, migrations };
}

export class DatabaseSchemaNotReadyError extends Error {
  readonly code = 'DATABASE_SCHEMA_NOT_READY';

  constructor(
    readonly domain: string,
    readonly missingRelations: readonly string[],
    readonly missingMigrations: readonly string[] = [],
  ) {
    const missing = [
      missingRelations.length > 0 ? `relation(s): ${missingRelations.join(', ')}` : null,
      missingMigrations.length > 0 ? `migration(s): ${missingMigrations.join(', ')}` : null,
    ].filter(Boolean);
    super(
      `Database schema for "${domain}" is not ready; missing required ${missing.join('; ')}. ` +
        'Apply migrations with the migrator role before starting the application: ' +
        'pnpm --filter @proctira/database run prisma:migrate:deploy, then ' +
        'APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh. Runtime roles must not execute DDL.',
    );
    this.name = 'DatabaseSchemaNotReadyError';
  }
}

function isReadinessContractUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42883' || code === '42501';
}

/**
 * Assert required relations and migrations through read-only catalog access.
 * Migration status comes from the narrowly permissioned SECURITY DEFINER
 * function installed by 091; the runtime cannot read migration ledgers.
 */
export async function assertDatabaseSchemaReady(
  queryable: SchemaReadinessQueryable,
  domain: string,
  requiredRelations: readonly string[],
  requiredMigrations: readonly string[] = REQUIRED_RUNTIME_MIGRATIONS,
): Promise<void> {
  const requirements = normalizeRequirements(domain, requiredRelations, requiredMigrations);
  let result: { rows: unknown[] };
  try {
    result = await queryable.query(SCHEMA_READINESS_SQL, [
      requirements.relations,
      requirements.migrations,
    ]);
  } catch (error) {
    if (isReadinessContractUnavailable(error)) {
      throw new DatabaseSchemaNotReadyError(requirements.domain, [], requirements.migrations);
    }
    throw error;
  }

  const relationStates = new Map<string, boolean>();
  const migrationStates = new Map<string, boolean>();
  for (const rawRow of result.rows) {
    if (!rawRow || typeof rawRow !== 'object') continue;
    const row = rawRow as Record<string, unknown>;
    const name = String(row['requirement_name'] ?? '');
    const exists = row['requirement_exists'] === true;
    if (row['requirement_type'] === 'relation') relationStates.set(name, exists);
    if (row['requirement_type'] === 'migration') migrationStates.set(name, exists);
  }

  const missingRelations = requirements.relations.filter(
    (relation) => relationStates.get(relation) !== true,
  );
  const missingMigrations = requirements.migrations.filter(
    (migration) => migrationStates.get(migration) !== true,
  );
  if (missingRelations.length > 0 || missingMigrations.length > 0) {
    throw new DatabaseSchemaNotReadyError(requirements.domain, missingRelations, missingMigrations);
  }
}

/** Callable per-pool memo with an explicit reset hook for isolated tests. */
export interface DatabaseSchemaReadinessCheck {
  (queryable: SchemaReadinessQueryable): Promise<void>;
  reset(queryable?: SchemaReadinessQueryable): void;
}

/**
 * Build a per-pool memoized readiness check. Failures are evicted so a process
 * can recover after an operator applies missing migrations.
 */
export function createDatabaseSchemaReadinessCheck(
  domain: string,
  requiredRelations: DatabaseSchemaRelations,
  requiredMigrations: readonly string[] = REQUIRED_RUNTIME_MIGRATIONS,
): DatabaseSchemaReadinessCheck {
  const requirements = normalizeRequirements(
    domain,
    resolveRelations(requiredRelations),
    requiredMigrations,
  );
  let pendingByQueryable = new WeakMap<object, Promise<void>>();

  const check = async (queryable: SchemaReadinessQueryable): Promise<void> => {
    const key = queryable as object;
    let pending = pendingByQueryable.get(key);
    if (!pending) {
      pending = assertDatabaseSchemaReady(
        queryable,
        requirements.domain,
        requirements.relations,
        requirements.migrations,
      );
      pendingByQueryable.set(key, pending);
    }

    try {
      await pending;
    } catch (error) {
      pendingByQueryable.delete(key);
      throw error;
    }
  };

  check.reset = (queryable?: SchemaReadinessQueryable): void => {
    if (queryable) pendingByQueryable.delete(queryable as object);
    else pendingByQueryable = new WeakMap<object, Promise<void>>();
  };

  return check;
}
