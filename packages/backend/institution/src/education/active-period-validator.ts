/**
 * Active Period Validator
 *
 * Utility to validate that an academic period is active before allowing
 * enrollment, attendance, or assessment operations.
 *
 * @requirements 5.7, 5.8
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PrismaClient, AcademicPeriod } from '@proctira/database';

export interface ActivePeriodValidatorDeps {
  prisma: PrismaClient;
}

/**
 * Validates that an academic period is active.
 * Throws BusinessRuleError if the period is not active.
 * Throws NotFoundError if the period does not exist.
 *
 * This utility is intended to be used by enrollment, attendance, and assessment
 * services before performing operations scoped to an academic period.
 */
export async function validateActivePeriod(
  prisma: PrismaClient,
  tenantId: string,
  academicPeriodId: string,
): Promise<AcademicPeriod> {
  const period = await prisma.academicPeriod.findFirst({
    where: { id: academicPeriodId, tenantId, deletedAt: null },
  });

  if (!period) {
    throw new NotFoundError(`Academic period '${academicPeriodId}' not found`);
  }

  if (period.status !== 'active') {
    throw new BusinessRuleError(
      `The referenced academic period '${period.name}' is not currently active. ` +
        `Current status: ${period.status}. ` +
        `Only active periods allow enrollment, attendance, and assessment operations.`,
    );
  }

  return period;
}

/**
 * Class-based wrapper for dependency injection scenarios.
 */
export class ActivePeriodValidator {
  private readonly prisma: PrismaClient;

  constructor(deps: ActivePeriodValidatorDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Validate that the given academic period is active.
   */
  async validate(tenantId: string, academicPeriodId: string): Promise<AcademicPeriod> {
    return validateActivePeriod(this.prisma, tenantId, academicPeriodId);
  }
}
