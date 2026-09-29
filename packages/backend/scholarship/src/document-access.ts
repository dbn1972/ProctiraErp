/**
 * Who may touch a scholarship application's files.
 * Staff stay inside scholarship RBAC. Parents and students see only their
 * own applicant id. A missing application is 404 (including cross-tenant);
 * a known application the caller does not own is 403.
 */
import { ForbiddenError } from '@proctira/common';
import type { FastifyRequest } from 'fastify';

import { hasScholarshipAccess, normalizeScholarshipRoles } from './scholarship-access.js';
import type { ScholarshipApplicationEntity } from './scholarship-repository.js';

const APPLICANT_ROLES = new Set(['parent', 'guardian', 'student', 'applicant']);

export interface ScholarshipActor {
  userId: string;
  userName: string;
  roles: unknown;
  studentId: string | null;
  linkedStudentIds: string[];
  ipAddress: string;
}

export function actorFromRequest(
  request: FastifyRequest,
  linkedStudentIds: string[] = [],
): ScholarshipActor {
  const user = (
    request as FastifyRequest & {
      user?: {
        sub?: string;
        userId?: string;
        email?: string;
        name?: string;
        roles?: unknown;
        studentId?: string;
        linkedStudentIds?: string[];
      };
      ip?: string;
    }
  ).user;
  const fromJwt = Array.isArray(user?.linkedStudentIds)
    ? user.linkedStudentIds.filter((id) => typeof id === 'string')
    : [];
  return {
    userId: user?.sub ?? user?.userId ?? '',
    userName: user?.name ?? user?.email ?? user?.sub ?? 'unknown',
    roles: user?.roles ?? [],
    studentId: typeof user?.studentId === 'string' ? user.studentId : null,
    linkedStudentIds: [...new Set([...fromJwt, ...linkedStudentIds])],
    ipAddress: request.ip || '0.0.0.0',
  };
}

export function isApplicantRole(roles: unknown): boolean {
  return normalizeScholarshipRoles(roles).some((role) => APPLICANT_ROLES.has(role));
}

export function ownsApplicant(actor: ScholarshipActor, applicantId: string): boolean {
  if (!applicantId) return false;
  if (actor.userId && actor.userId === applicantId) return true;
  if (actor.studentId && actor.studentId === applicantId) return true;
  return actor.linkedStudentIds.includes(applicantId);
}

function isStaffReader(actor: ScholarshipActor): boolean {
  return hasScholarshipAccess(actor.roles, 'scholarship.read');
}

function isStaffWriter(actor: ScholarshipActor): boolean {
  return (
    hasScholarshipAccess(actor.roles, 'application.submit') ||
    hasScholarshipAccess(actor.roles, 'application.decide')
  );
}

export function assertCanCreateApplication(actor: ScholarshipActor, applicantId: string): void {
  if (hasScholarshipAccess(actor.roles, 'application.submit')) return;
  if (isApplicantRole(actor.roles) && ownsApplicant(actor, applicantId)) return;
  throw new ForbiddenError('Forbidden: cannot submit a scholarship application for this student');
}

export function assertCanReadDocuments(
  actor: ScholarshipActor,
  application: ScholarshipApplicationEntity,
): void {
  if (isStaffReader(actor)) return;
  if (isApplicantRole(actor.roles) && ownsApplicant(actor, application.applicantId)) return;
  throw new ForbiddenError('Forbidden: cannot view documents for this application');
}

export function assertCanUpload(
  actor: ScholarshipActor,
  application: ScholarshipApplicationEntity,
): void {
  const openForApplicant = application.status === 'draft';
  if (isApplicantRole(actor.roles) && ownsApplicant(actor, application.applicantId)) {
    if (!openForApplicant) {
      throw new ForbiddenError(
        'Documents can only be uploaded before the application is submitted',
      );
    }
    return;
  }
  if (isStaffWriter(actor)) return;
  throw new ForbiddenError('Forbidden: cannot upload documents for this application');
}

export function assertCanDelete(
  actor: ScholarshipActor,
  application: ScholarshipApplicationEntity,
): void {
  if (isStaffWriter(actor)) return;
  if (
    isApplicantRole(actor.roles) &&
    ownsApplicant(actor, application.applicantId) &&
    application.status === 'draft'
  ) {
    return;
  }
  throw new ForbiddenError(
    'Forbidden: documents can be removed by the applicant before submission, or by scholarship staff',
  );
}

export function assertCanVerify(actor: ScholarshipActor): void {
  if (hasScholarshipAccess(actor.roles, 'application.decide')) return;
  throw new ForbiddenError('Forbidden: only a scholarship reviewer can verify or reject documents');
}

export function assertCanFinalize(
  actor: ScholarshipActor,
  application: ScholarshipApplicationEntity,
): void {
  if (hasScholarshipAccess(actor.roles, 'application.submit')) return;
  if (isApplicantRole(actor.roles) && ownsApplicant(actor, application.applicantId)) return;
  throw new ForbiddenError('Forbidden: cannot submit this application');
}
