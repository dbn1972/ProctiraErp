import { describe, expect, it, vi } from 'vitest';

import { DATABASE_SCHEMA_CONTRACTS } from './schema-contracts.js';
import {
  assertDatabaseSchemaReady,
  createDatabaseSchemaReadinessCheck,
  CURRENT_RUNTIME_SCHEMA_MIGRATION,
  DatabaseSchemaNotReadyError,
  REQUIRED_RUNTIME_MIGRATIONS,
  requiredRuntimeMigrationsFor,
  SCHEMA_READINESS_SQL,
  type SchemaReadinessQueryable,
} from './schema-readiness.js';

function statusRows(
  relations: readonly string[],
  options: {
    missingRelations?: readonly string[];
    migrations?: readonly string[];
    missingMigrations?: readonly string[];
  } = {},
) {
  const migrations = options.migrations ?? REQUIRED_RUNTIME_MIGRATIONS;
  return [
    ...relations.map((requirement_name) => ({
      requirement_type: 'relation',
      requirement_name,
      requirement_exists: !options.missingRelations?.includes(requirement_name),
    })),
    ...migrations.map((requirement_name) => ({
      requirement_type: 'migration',
      requirement_name,
      requirement_exists: !options.missingMigrations?.includes(requirement_name),
    })),
  ];
}

describe('database schema readiness', () => {
  it('uses one parameterized, read-only relation and migration query', async () => {
    const relations = ['public.tenants', 'public.students'];
    const query = vi.fn(async () => ({ rows: statusRows(relations) }));

    await assertDatabaseSchemaReady({ query }, 'student', relations);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(SCHEMA_READINESS_SQL, [
      relations,
      REQUIRED_RUNTIME_MIGRATIONS,
    ]);
    expect(SCHEMA_READINESS_SQL).toContain('to_regclass');
    expect(SCHEMA_READINESS_SQL).toContain('proctira_runtime_migration_status');
    expect(SCHEMA_READINESS_SQL).not.toMatch(/\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i);
  });

  it('fails closed with actionable relation and migration details', async () => {
    const relations = ['public.tenants', 'public.students'];
    const missingMigration = CURRENT_RUNTIME_SCHEMA_MIGRATION;
    const query = vi.fn(async () => ({
      rows: statusRows(relations, {
        missingRelations: ['public.students'],
        missingMigrations: [missingMigration],
      }),
    }));

    const error = await assertDatabaseSchemaReady({ query }, 'student', relations).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DatabaseSchemaNotReadyError);
    expect(error).toMatchObject({
      code: 'DATABASE_SCHEMA_NOT_READY',
      domain: 'student',
      missingRelations: ['public.students'],
      missingMigrations: [missingMigration],
    });
    expect((error as Error).message).toMatch(/migrator role/i);
    expect((error as Error).message).toMatch(/APPLY_STRICT_FKS=1/);
    expect((error as Error).message).toMatch(/Runtime roles must not execute DDL/);
  });

  it('treats malformed or incomplete catalog results as missing', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          requirement_type: 'relation',
          requirement_name: 'public.tenants',
        },
      ],
    }));

    await expect(
      assertDatabaseSchemaReady({ query }, 'platform', ['public.tenants', 'public.users']),
    ).rejects.toMatchObject({
      missingRelations: ['public.tenants', 'public.users'],
      missingMigrations: REQUIRED_RUNTIME_MIGRATIONS,
    });
  });

  it('turns a missing or inaccessible readiness function into a migration-required error', async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error('function does not exist'), { code: '42883' });
    });

    await expect(
      assertDatabaseSchemaReady({ query }, 'platform', ['public.tenants']),
    ).rejects.toMatchObject({
      missingRelations: [],
      missingMigrations: REQUIRED_RUNTIME_MIGRATIONS,
    });
  });

  it('requires qualified relation names and numbered migration filenames', async () => {
    const query = vi.fn();

    await expect(assertDatabaseSchemaReady({ query }, '', ['public.tenants'])).rejects.toThrow(
      /domain must not be empty/,
    );
    await expect(assertDatabaseSchemaReady({ query }, 'x', [])).rejects.toThrow(
      /requires relations/,
    );
    await expect(assertDatabaseSchemaReady({ query }, 'x', ['tenants'])).rejects.toThrow(
      /schema-qualified/,
    );
    await expect(assertDatabaseSchemaReady({ query }, 'x', ['public.tenants'], [])).rejects.toThrow(
      /requires migrations/,
    );
    await expect(
      assertDatabaseSchemaReady({ query }, 'x', ['public.tenants'], ['latest']),
    ).rejects.toThrow(/numbered SQL filenames/);
    expect(query).not.toHaveBeenCalled();
  });

  it('retains permanent integrity checks when a newer migration becomes current', () => {
    expect(requiredRuntimeMigrationsFor('097_future_schema.sql')).toEqual([
      '082_repair_strict_tenant_fk_validate.sql',
      '092_hostel_assignment_uniqueness.sql',
      '093_developer_portal_tenant_fks.sql',
      '094_developer_portal_api_key_lookup.sql',
      '095_w1_data_02_rls_safe_deny.sql',
      '096_w1_data_14_audit_fk_integrity.sql',
      '097_admissions_public_context.sql',
      '098_staff_identity_link.sql',
      '099_w1_data_02_legacy_guc_safe_deny.sql',
      '100_tenant_id_uuid_fks.sql',
      '101_outbox_redrive.sql',
      '097_future_schema.sql',
    ]);
  });

  it('memoizes success per queryable and retries after a failed check', async () => {
    const relation = 'public.tenants';
    let attempt = 0;
    const queryMock = vi.fn(async (_text: string, _values?: unknown[]) => {
      attempt += 1;
      return {
        rows: statusRows([relation], {
          missingRelations: attempt === 1 ? [relation] : [],
        }),
      };
    });
    const check = createDatabaseSchemaReadinessCheck('platform', [relation]);
    const pool: SchemaReadinessQueryable = { query: queryMock };

    await expect(check(pool)).rejects.toBeInstanceOf(DatabaseSchemaNotReadyError);
    await check(pool);
    await check(pool);
    check.reset(pool);
    await check(pool);
    check.reset();
    await check(pool);

    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('resolves every named adapter contract from the centralized catalog', async () => {
    const query = vi.fn(async (_text: string, values?: unknown[]) => {
      const relations = (values?.[0] ?? []) as string[];
      return { rows: statusRows(relations) };
    });

    for (const [name, relations] of Object.entries(DATABASE_SCHEMA_CONTRACTS)) {
      expect(relations.length, `${name} contract must not be empty`).toBeGreaterThan(0);
      const check = createDatabaseSchemaReadinessCheck(
        name,
        name as keyof typeof DATABASE_SCHEMA_CONTRACTS,
      );
      await check({ query });
    }

    expect(query).toHaveBeenCalledTimes(Object.keys(DATABASE_SCHEMA_CONTRACTS).length);
  });
});
