/**
 * PRC-H030 — who a scholarship application is *for*.
 *
 * H030: the web wizard used to post a placeholder nil UUID as applicantId and
 * institutionId. The subject is now resolved server-side from the authenticated
 * principal (student id / single linked child / role institution); placeholder ids
 * are rejected, and — when a student lookup is configured — the applicant must be a
 * student of the caller's tenant.
 */
import { ValidationError } from '@proctira/common';
import type { FastifyRequest } from 'fastify';

import { actorFromRequest, type ScholarshipActor } from './document-access.js';
import { normalizeScholarshipRoles } from './scholarship-access.js';

/** Placeholder ids that must never be persisted as a real subject. */
const PLACEHOLDER_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000000',
]);

export function isPlaceholderId(id: string | undefined | null): boolean {
  return typeof id === 'string' && PLACEHOLDER_IDS.has(id.toLowerCase());
}

/** Returns true when `studentId` is a student of `tenantId`. */
export type ApplicantStudentLookup = (tenantId: string, studentId: string) => Promise<boolean>;

/** Actor for the request, including DB-resolved guardian links when available. */
export async function resolveScholarshipActor(
  request: FastifyRequest,
  tenantId: string,
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>,
): Promise<ScholarshipActor> {
  const base = actorFromRequest(request);
  if (!resolveLinkedStudentIds || !base.userId) return base;
  try {
    return actorFromRequest(request, await resolveLinkedStudentIds(tenantId, base.userId));
  } catch {
    // JWT claims still apply when the link table is unavailable.
    return base;
  }
}

function roleInstitutionId(request: FastifyRequest): string | null {
  const roles = (request as FastifyRequest & { user?: { roles?: unknown } }).user?.roles;
  if (!Array.isArray(roles)) return null;
  for (const role of roles) {
    const id = (role as { institutionId?: unknown })?.institutionId;
    if (typeof id === 'string' && id.length > 0 && !isPlaceholderId(id)) return id;
  }
  return null;
}

/** The applicant the caller may apply for without naming one explicitly. */
function defaultApplicantId(actor: ScholarshipActor): string | null {
  if (actor.studentId) return actor.studentId;
  if (actor.linkedStudentIds.length === 1) return actor.linkedStudentIds[0] ?? null;
  if (normalizeScholarshipRoles(actor.roles).includes('student') && actor.userId) {
    return actor.userId;
  }
  return null;
}

export async function resolveApplicationSubject(input: {
  request: FastifyRequest;
  tenantId: string;
  actor: ScholarshipActor;
  applicantId?: string;
  institutionId?: string;
  applicantExists?: ApplicantStudentLookup;
}): Promise<{ applicantId: string; institutionId: string }> {
  const { request, tenantId, actor, applicantExists } = input;
  if (isPlaceholderId(input.applicantId) || isPlaceholderId(input.institutionId)) {
    throw new ValidationError('Placeholder applicant or institution ids are not accepted', [
      {
        field: isPlaceholderId(input.applicantId) ? 'applicantId' : 'institutionId',
        rule: 'placeholder',
        message: 'Choose a real student and institution',
      },
    ]);
  }
  const applicantId = input.applicantId ?? defaultApplicantId(actor);
  if (!applicantId) {
    throw new ValidationError('Select the student this application is for', [
      { field: 'applicantId', rule: 'required', message: 'applicantId is required' },
    ]);
  }
  if (applicantExists && !(await applicantExists(tenantId, applicantId))) {
    // Same answer for "unknown" and "belongs to another tenant" — no cross-tenant oracle.
    throw new ValidationError('Applicant is not a student of this school', [
      { field: 'applicantId', rule: 'exists', message: 'Unknown student' },
    ]);
  }
  const institutionId = input.institutionId ?? roleInstitutionId(request);
  if (!institutionId) {
    throw new ValidationError('The applicant institution could not be determined', [
      { field: 'institutionId', rule: 'required', message: 'institutionId is required' },
    ]);
  }
  return { applicantId, institutionId };
}
