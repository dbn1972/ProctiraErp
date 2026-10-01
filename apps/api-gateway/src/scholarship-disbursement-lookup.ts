/**
 * PRC-H020: bridges the fees netting routes to the scholarship domain so that a
 * fee credit can only be minted from a real, tenant-scoped, paid disbursement.
 */
import type {
  NettableScholarshipDisbursement,
  ScholarshipDisbursementLookup,
} from '@proctira/backend-fees';
import type { DisbursementEntity, ScholarshipRepository } from '@proctira/backend-scholarship';

const MAX_PAID_ROWS = 200;
/** Postgres SQLSTATE 22P02 (e.g. a non-UUID string bound to a uuid column). */
function isInvalidTextRepresentation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '22P02' || (cause !== error && isInvalidTextRepresentation(cause));
}

async function toNettable(
  repository: ScholarshipRepository,
  tenantId: string,
  disbursement: DisbursementEntity,
): Promise<NettableScholarshipDisbursement | null> {
  if (disbursement.tenantId !== tenantId) return null;
  const application = await repository.findApplicationById(disbursement.applicationId, tenantId);
  if (!application || application.tenantId !== tenantId) return null;
  const program = await repository.findProgramById(application.programId, tenantId);
  return {
    id: disbursement.id,
    tenantId,
    studentId: application.applicantId,
    amountCents: disbursement.amountCents,
    paymentStatus: disbursement.paymentStatus,
    currency: program?.currency ?? null,
    paidDate: disbursement.paidDate,
  };
}

/**
 * `getRepository` is resolved per call so the fees domain reads the same
 * repository instance the scholarship domain mounted (matters for in-memory mode).
 */
export function createScholarshipDisbursementLookup(
  getRepository: () => ScholarshipRepository,
): ScholarshipDisbursementLookup {
  return {
    async findDisbursement(tenantId, disbursementId) {
      const repository = getRepository();
      let disbursement: DisbursementEntity | null;
      try {
        disbursement = await repository.findDisbursementById(disbursementId, tenantId);
      } catch (error) {
        // An operator-typed id that is not a UUID cannot name a real
        // disbursement; treat Postgres invalid_text_representation as "not found"
        // so netting answers 4xx instead of a 500.
        if (isInvalidTextRepresentation(error)) return null;
        throw error;
      }
      if (!disbursement) return null;
      return toNettable(repository, tenantId, disbursement);
    },
    async listPaidDisbursements(tenantId, filter) {
      const repository = getRepository();
      const page = await repository.listDisbursements(
        tenantId,
        { paymentStatus: 'paid' },
        { page: 1, pageSize: MAX_PAID_ROWS },
      );
      const rows: NettableScholarshipDisbursement[] = [];
      for (const disbursement of page.data) {
        const row = await toNettable(repository, tenantId, disbursement);
        if (!row) continue;
        if (filter.studentId && row.studentId !== filter.studentId) continue;
        rows.push(row);
      }
      return rows;
    },
  };
}
