/**
 * AD-T1: tenant ownership of the ids an admissions write names.
 *
 * `admission_enquiries`, `seat_matrix`, `merit_lists`, `admission_applications` (placement)
 * and `admission_interview_slots` store `institution_id` / `academic_period_id` / `grade_id`
 * without a tenant-composite FK (some with no FK at all; tenant FKs are the B1-B3 schema
 * lane). Without a check, tenant A's staff could save rows that point at tenant B's period,
 * grade or institution. Every staff write that names one of these ids first asks the
 * checker whether the ids belong to the caller's tenant and refuses with the #739 safe form
 * (422 `REFERENCE_NOT_FOUND`, fixed message, correlation id) when any does not. The body
 * never says which id failed or whether it exists in another tenant.
 */
import { AppError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import type { FastifyRequest } from 'fastify';

import type { PgPoolLike } from './pg-registration-repository.js';

/** The tenant-owned ids an admissions write can name. */
export interface TenantReferenceIds {
  institutionId?: string;
  academicPeriodId?: string;
  gradeId?: string;
}

export type TenantReferenceField = keyof TenantReferenceIds;

export interface TenantReferenceChecker {
  /** The fields of `refs` whose id is not a row of `tenantId` (empty when all are owned). */
  findForeignReferences(
    tenantId: string,
    refs: TenantReferenceIds,
  ): Promise<TenantReferenceField[]>;
}

/** Same code and copy as the gateway's 23503 mapping (#739, H-D4a). */
export const REFERENCE_NOT_FOUND_CODE = 'REFERENCE_NOT_FOUND';
export const REFERENCE_NOT_FOUND_MESSAGE = 'A referenced record does not exist.';

export class ReferenceNotFoundError extends AppError {
  constructor() {
    super(REFERENCE_NOT_FOUND_MESSAGE, REFERENCE_NOT_FOUND_CODE, 422);
  }
}

/** Throws {@link ReferenceNotFoundError} when any id in `refs` is not owned by `tenantId`. */
export async function assertTenantReferences(
  checker: TenantReferenceChecker | undefined,
  tenantId: string,
  refs: TenantReferenceIds,
): Promise<void> {
  if (!checker) return;
  const foreign = await checker.findForeignReferences(tenantId, refs);
  if (foreign.length > 0) throw new ReferenceNotFoundError();
}

/** Correlation id the gateway puts on its own safe bodies (`error-handler.ts`). */
function correlationIdOf(request: FastifyRequest): string {
  const value = (request as unknown as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' && value.length > 0 ? value : String(request.id);
}

/** Safe body for a route that sends `AppError` bodies itself: adds the correlation id. */
export function referenceNotFoundBody(error: ReferenceNotFoundError, request: FastifyRequest) {
  return { ...error.toJSON(), correlationId: correlationIdOf(request) };
}

/**
 * Postgres: each id must be a row of the caller's tenant (`tenant_id = $1`), read under the
 * tenant GUC so RLS applies as well. Unknown ids are refused like foreign ones.
 */
export class PgTenantReferenceChecker implements TenantReferenceChecker {
  constructor(private readonly pool: PgPoolLike) {}

  async findForeignReferences(
    tenantId: string,
    refs: TenantReferenceIds,
  ): Promise<TenantReferenceField[]> {
    const institutionId = refs.institutionId ?? null;
    const academicPeriodId = refs.academicPeriodId ?? null;
    const gradeId = refs.gradeId ?? null;
    if (!institutionId && !academicPeriodId && !gradeId) return [];
    const row = await withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT
           ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM institutions WHERE tenant_id = $1::uuid AND id = $2::uuid)) AS institution_ok,
           ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM academic_periods WHERE tenant_id = $1::uuid AND id = $3::uuid)) AS period_ok,
           ($4::uuid IS NULL OR EXISTS (
              SELECT 1 FROM grades WHERE tenant_id = $1::uuid AND id = $4::uuid)) AS grade_ok`,
        [tenantId, institutionId, academicPeriodId, gradeId],
      );
      return (result.rows as Array<Record<string, unknown>>)[0] ?? {};
    });
    const foreign: TenantReferenceField[] = [];
    if (row.institution_ok !== true) foreign.push('institutionId');
    if (row.period_ok !== true) foreign.push('academicPeriodId');
    if (row.grade_ok !== true) foreign.push('gradeId');
    return foreign;
  }
}

/**
 * In-memory (unit tests and no-database dev): there are no parent tables, so only ids
 * registered with {@link register} have a known owner. An id registered to another tenant
 * is refused; an unregistered id is accepted, as the in-memory stores accept any id.
 */
export class InMemoryTenantReferenceChecker implements TenantReferenceChecker {
  private readonly owners = new Map<string, string>();

  register(tenantId: string, ...ids: string[]): this {
    for (const id of ids) this.owners.set(id, tenantId);
    return this;
  }

  findForeignReferences(
    tenantId: string,
    refs: TenantReferenceIds,
  ): Promise<TenantReferenceField[]> {
    const fields: TenantReferenceField[] = ['institutionId', 'academicPeriodId', 'gradeId'];
    return Promise.resolve(
      fields.filter((field) => {
        const id = refs[field];
        if (!id) return false;
        const owner = this.owners.get(id);
        return owner !== undefined && owner !== tenantId;
      }),
    );
  }
}
