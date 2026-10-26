/**
 * PRC-L123 — shared guards for creating classes / subject links.
 *
 * Deactivated (INACTIVE) institutions must not receive new assignments and
 * soft-deleted institutions are treated as absent (404). Archived academic
 * periods are read-only, so no new classes can be created in them.
 */
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import type { PrismaClient } from '@proctira/database';

import type { InstitutionRepository } from '../institution-repository.js';

interface InstitutionLike {
  status?: string | null;
  deletedAt?: Date | string | null;
}

/** Load an institution in the tenant and require it to be ACTIVE and not soft-deleted. */
export async function requireAssignableInstitution(
  prisma: PrismaClient,
  tenantId: string,
  institutionId: string,
): Promise<void> {
  const institution = (await prisma.institution.findFirst({
    where: { id: institutionId, tenantId, deletedAt: null },
  })) as InstitutionLike | null;
  if (!institution || institution.deletedAt) {
    throw new NotFoundError(`Institution '${institutionId}' not found`);
  }
  // DB default is lowercase 'active'; the domain entity uses 'ACTIVE' / 'INACTIVE'.
  if ((institution.status ?? 'active').toUpperCase() !== 'ACTIVE') {
    throw new BusinessRuleError(
      `Institution '${institutionId}' is inactive and cannot accept new assignments`,
    );
  }
}

/**
 * PRC-M286 — require that `institutionId` belongs to `tenantId` before it is
 * stored on a row (infrastructure land, repair request, calendar event).
 * Unlike {@link requireAssignableInstitution} this does NOT require ACTIVE
 * status: decommissioning infrastructure on an inactive institution, or
 * logging a calendar event tied to one, is a legitimate workflow. Only
 * existence + tenant ownership are checked.
 */
export async function requireInstitution(
  repository: InstitutionRepository,
  tenantId: string,
  institutionId: string,
): Promise<void> {
  const institution = await repository.findById(institutionId, tenantId);
  if (!institution) {
    throw new NotFoundError(`Institution '${institutionId}' not found`);
  }
}

/** Reject archived academic periods for write paths that create new rows. */
export function assertPeriodNotArchived(period: { id: string; status?: string | null }): void {
  if ((period.status ?? '').toLowerCase() === 'archived') {
    throw new BusinessRuleError(`Academic period '${period.id}' is archived`);
  }
}
