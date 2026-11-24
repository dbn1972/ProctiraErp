/**
 * PRC-L274: which students a guardian, parent or student may download report
 * cards for on `GET /report-cards/jobs/:id/download`.
 *
 * Guardians and parents get the same children the parent portal shows them:
 * `ParentPortalService.listChildrenForParent`, which keeps an active link only
 * when the parent's household holds active custody of the student and no
 * `blocks_all_access` restriction applies. The parent portal checks this before
 * it issues the download URL, so the download honours the same rule. A student
 * gets their own student record(s).
 */
import type { AssessmentPortalBinding } from '@proctira/backend-assessment';
import { ParentPortalService, type ParentPortalRepository } from '@proctira/backend-parent-portal';

export type LearnerStudentIdsLookup = (
  tenantId: string,
  learnerUserId: string,
) => Promise<string[]>;

export function createAssessmentPortalBinding(
  parentRepository: ParentPortalRepository,
  learnerStudentIds: LearnerStudentIdsLookup,
): AssessmentPortalBinding {
  const parentPortal = new ParentPortalService(parentRepository);
  return {
    listReadableStudentIds: async (tenantId, actorUserId) => {
      const links = await parentPortal.listChildrenForParent(tenantId, actorUserId);
      const own = await learnerStudentIds(tenantId, actorUserId);
      return [...links.map((link) => link.studentId), ...own];
    },
  };
}
