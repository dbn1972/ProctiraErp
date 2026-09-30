/**
 * PRC-H031 — drafts were create-only, so edits made after the first save (including the
 * personal statement typed on the Review step) were silently dropped. A draft can now be
 * updated until it is submitted.
 */
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  majorUnitsToCents,
} from '@proctira/common';

import { isApplicantRole, ownsApplicant, type ScholarshipActor } from './document-access.js';
import type { AcademicRecord, FinancialInfo } from './schemas.js';
import { hasScholarshipAccess } from './scholarship-access.js';
import type {
  ScholarshipApplicationEntity,
  ScholarshipRepository,
} from './scholarship-repository.js';

export interface UpdateDraftInput {
  programId?: string;
  academicRecords?: AcademicRecord[];
  financialInfo?: FinancialInfo;
  personalStatement?: string | null;
}

function assertCanEditDraft(actor: ScholarshipActor, application: ScholarshipApplicationEntity) {
  if (hasScholarshipAccess(actor.roles, 'application.submit')) return;
  if (isApplicantRole(actor.roles) && ownsApplicant(actor, application.applicantId)) return;
  throw new ForbiddenError('Forbidden: cannot edit this application');
}

/** PRC-H031: persist the wizard's current state onto a draft before it is submitted. */
export async function updateDraftApplication(
  repository: ScholarshipRepository,
  tenantId: string,
  id: string,
  actor: ScholarshipActor,
  patch: UpdateDraftInput,
): Promise<ScholarshipApplicationEntity> {
  const application = await repository.findApplicationById(id, tenantId);
  if (!application) {
    throw new NotFoundError(`Scholarship application with id '${id}' not found`);
  }
  assertCanEditDraft(actor, application);
  if (application.status !== 'draft') {
    throw new BusinessRuleError(
      `Cannot edit application in '${application.status}' status; only drafts can change`,
    );
  }
  if (patch.programId && patch.programId !== application.programId) {
    const program = await repository.findProgramById(patch.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Scholarship program with id '${patch.programId}' not found`);
    }
    if (program.status !== 'open') {
      throw new BusinessRuleError('Scholarship program is not currently accepting applications');
    }
    const duplicate = await repository.findApplicationByApplicantAndProgram(
      application.applicantId,
      patch.programId,
      tenantId,
    );
    if (duplicate && duplicate.id !== application.id) {
      throw new ConflictError('Applicant has already applied to this program');
    }
  }
  if (patch.financialInfo) {
    // Same cent-representability rule as create.
    if (patch.financialInfo.familyIncome !== undefined) {
      majorUnitsToCents(patch.financialInfo.familyIncome);
    }
    for (const other of patch.financialInfo.otherScholarships ?? []) {
      majorUnitsToCents(other.amount);
    }
  }
  const changes: Partial<ScholarshipApplicationEntity> = {};
  if (patch.programId) changes.programId = patch.programId;
  if (patch.academicRecords) changes.academicRecords = patch.academicRecords;
  if (patch.financialInfo) changes.financialInfo = patch.financialInfo;
  if (patch.personalStatement !== undefined) {
    changes.personalStatement = patch.personalStatement || null;
  }
  const updated = await repository.updateApplication(id, tenantId, changes);
  if (!updated) {
    throw new NotFoundError(`Scholarship application with id '${id}' not found`);
  }
  return updated;
}
