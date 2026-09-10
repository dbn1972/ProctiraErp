/**
 * Gradebook workflow types + pure status reader.
 *
 * Client-safe: no gateway / `next/headers` imports. Client components must
 * import from here (not `@/lib/api/gradebook`, which is server-only).
 */
export type GradeWorkflowStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'LOCKED'
  | 'PUBLISHED'
  | 'REJECTED';

export type GradeWorkflowAction = 'submit' | 'approve' | 'reject' | 'lock' | 'publish' | 'reopen';

export interface GradeEntry {
  id: string;
  tenantId: string;
  sectionId: string | null;
  studentId: string;
  assessmentCode: string | null;
  numericScore: number | null;
  letterGrade: string | null;
  enteredBy: string | null;
  enteredAt: string;
  lockedAt: string | null;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommentsBankItem {
  id: string;
  tenantId: string;
  institutionId: string | null;
  subjectId: string | null;
  gradeBand: string | null;
  label: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassRankSnapshot {
  id?: string;
  studentId: string;
  classRank: number;
  tieCount: number;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  cgpa: number | null;
  creditsEarned: number | null;
}

export function readGradeWorkflowStatus(entry: GradeEntry): GradeWorkflowStatus {
  if (entry.publishedAt) return 'PUBLISHED';
  const raw = entry.metadata?.workflowStatus;
  if (
    raw === 'DRAFT' ||
    raw === 'SUBMITTED' ||
    raw === 'APPROVED' ||
    raw === 'LOCKED' ||
    raw === 'PUBLISHED' ||
    raw === 'REJECTED'
  ) {
    return raw;
  }
  if (entry.lockedAt) return 'LOCKED';
  return 'DRAFT';
}
