/**
 * NEW-g7_platform-006: real Postgres per-domain correction appliers for DSAR rectification.
 *
 * A correction is only "applied" when the owning domain writes the new value. These appliers
 * rectify a strict allowlist of correctable identity fields on the students / staff tables, under
 * the tenant's RLS context, using parameterised queries. Anything outside the allowlist exposes no
 * field path and so fails closed (the privacy service rejects it before any write).
 *
 * Composed via CompositeCorrectionApplier keyed by subject type and wired into the gateway privacy
 * plugin, so an approved rectification actually persists instead of throwing
 * PrivacyExecutorNotConfiguredError (501).
 */
import { withPgTenant } from '@proctira/database';

import type { CorrectionApplier, CorrectionTarget } from './correction-applier.js';
import type { PrivacyPgPool } from './domain-anonymizers.js';

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

interface DomainCorrectionConfig {
  table: string;
  /** fieldPath (as sent by the DSAR request) → physical column. Allowlist = correctable fields. */
  fieldToColumn: Readonly<Record<string, string>>;
}

/**
 * Generic single-table correction applier. The fieldToColumn map is the allowlist: a fieldPath not
 * present yields no permission (allowedFieldPaths excludes it) and readCurrentValue/applyValue
 * throw, so unlisted fields can never be written.
 */
export class PgTableCorrectionApplier implements CorrectionApplier {
  constructor(
    private readonly pool: PrivacyPgPool,
    private readonly config: DomainCorrectionConfig,
  ) {
    if (!SAFE_IDENT.test(config.table)) {
      throw new Error(`Unsafe correction table identifier: ${config.table}`);
    }
    for (const column of Object.values(config.fieldToColumn)) {
      if (!SAFE_IDENT.test(column)) {
        throw new Error(`Unsafe correction column identifier: ${column}`);
      }
    }
  }

  allowedFieldPaths(): readonly string[] {
    return Object.keys(this.config.fieldToColumn);
  }

  private columnFor(fieldPath: string): string {
    const column = this.config.fieldToColumn[fieldPath];
    if (!column) {
      throw new Error(`Field '${fieldPath}' is not correctable on ${this.config.table}`);
    }
    return column;
  }

  async readCurrentValue(target: CorrectionTarget): Promise<string | null> {
    const column = this.columnFor(target.fieldPath);
    return withPgTenant(this.pool, target.tenantId, async (client) => {
      const res = await client.query(
        `SELECT "${column}"::text AS value FROM "${this.config.table}"
          WHERE id::text = $1 AND tenant_id::text = $2`,
        [target.subjectId, target.tenantId],
      );
      const rows = (res.rows ?? []) as Array<{ value: string | null }>;
      if (rows.length === 0) {
        // Mirror the port contract: a missing subject is a hard error, never a silent success.
        throw new Error(
          `Correction subject not found: ${this.config.table} id=${target.subjectId}`,
        );
      }
      return rows[0]!.value;
    });
  }

  async applyValue(target: CorrectionTarget & { value: string }): Promise<void> {
    const column = this.columnFor(target.fieldPath);
    await withPgTenant(this.pool, target.tenantId, async (client) => {
      const res = await client.query(
        `UPDATE "${this.config.table}" SET "${column}" = $3, updated_at = now()
          WHERE id::text = $1 AND tenant_id::text = $2`,
        [target.subjectId, target.tenantId, target.value],
      );
      const rowCount = (res as { rowCount?: number | null }).rowCount ?? 0;
      if (rowCount === 0) {
        // Fail closed: never report `applied` when nothing was written.
        throw new Error(
          `Correction write affected no rows: ${this.config.table} id=${target.subjectId}`,
        );
      }
    });
  }
}

/** Correctable identity fields on the students table (strict allowlist). */
export function createStudentCorrectionApplier(pool: PrivacyPgPool): CorrectionApplier {
  return new PgTableCorrectionApplier(pool, {
    table: 'students',
    fieldToColumn: {
      first_name: 'first_name',
      last_name: 'last_name',
      'name.first': 'first_name',
      'name.last': 'last_name',
      national_id: 'national_id',
    },
  });
}

/** Correctable identity fields on the staff table (strict allowlist). */
export function createStaffCorrectionApplier(pool: PrivacyPgPool): CorrectionApplier {
  return new PgTableCorrectionApplier(pool, {
    table: 'staff',
    fieldToColumn: {
      first_name: 'first_name',
      last_name: 'last_name',
      'name.first': 'first_name',
      'name.last': 'last_name',
      identity_number: 'identity_number',
    },
  });
}
