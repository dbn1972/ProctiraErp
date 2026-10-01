'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  bulkTransitionGradeEntries,
  computeClassRank,
  computeGpa,
  createCommentsBank,
  createReportCardJob,
  issueTranscript,
  transitionGradeEntry,
  upsertGradeEntry,
  type GradeWorkflowAction,
} from '@/lib/api/gradebook';
import {
  bulkTransitionGradeFormSchema,
  commentsBankFormSchema,
  computeGpaActionSchema,
  computeRankFormSchema,
  createReportCardJobActionSchema,
  issueTranscriptActionSchema,
  transitionGradeFormSchema,
  upsertGradeEntryActionSchema,
} from '@/lib/validation/gradebook-workflow-schema';

export type GradebookActionResult =
  | { ok: true; id: string; extra?: Record<string, unknown> }
  | { ok: false; error: string; code?: string; status?: number };

function invalid(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const issue = error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return {
    ok: false as const,
    error: `${where}${issue?.message ?? 'Invalid input'}`,
    code: 'VALIDATION_ERROR',
    status: 400,
  };
}
function fail(error: unknown): GradebookActionResult {
  if (error instanceof GatewayError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status: error.status,
    };
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Unexpected error',
  };
}

export async function upsertGradeEntryAction(input: {
  sectionId?: string | null;
  studentId: string;
  assessmentCode?: string | null;
  numericScore?: number | null;
  letterGrade?: string | null;
  creditRuleCode?: string | null;
  remark?: string | null;
  commentBankId?: string | null;
  institutionId?: string;
}): Promise<GradebookActionResult> {
  const parsed = upsertGradeEntryActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const { institutionId, ...payload } = parsed.data;
    const row = await upsertGradeEntry(payload);
    if (institutionId) {
      revalidatePath(`/institutions/${institutionId}/gradebook`);
    }
    revalidatePath('/students/records');
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function computeGpaAction(input: {
  studentId: string;
  academicPeriodId?: string | null;
  boardId?: string | null;
  institutionId?: string;
}): Promise<GradebookActionResult> {
  const parsed = computeGpaActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const { institutionId, ...payload } = parsed.data;
    const snap = await computeGpa(payload);
    if (institutionId) {
      revalidatePath(`/institutions/${institutionId}/gradebook`);
    }
    revalidatePath('/students/records');
    return {
      ok: true,
      id: snap.id,
      extra: {
        weightedGpa: snap.weightedGpa,
        unweightedGpa: snap.unweightedGpa,
        creditsEarned: snap.creditsEarned,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function issueTranscriptAction(input: {
  studentId: string;
  gpaSnapshotId?: string | null;
}): Promise<GradebookActionResult> {
  const parsed = issueTranscriptActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const row = await issueTranscript(parsed.data);
    revalidatePath('/students/records');
    return {
      ok: true,
      id: row.id,
      extra: { version: row.version, checksumSha256: row.checksumSha256 },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function createReportCardJobAction(input: {
  studentId: string;
  boardId: string;
  institutionId?: string | null;
  academicPeriodId?: string | null;
}): Promise<GradebookActionResult> {
  const parsed = createReportCardJobActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const job = await createReportCardJob(parsed.data);
    revalidatePath('/students/records');
    if (parsed.data.institutionId) {
      revalidatePath(`/institutions/${parsed.data.institutionId}/gradebook`);
    }
    return {
      ok: true,
      id: job.id,
      extra: { status: job.status, artifactUri: job.artifactUri },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function transitionGradeEntryAction(input: {
  id: string;
  action: GradeWorkflowAction;
  institutionId: string;
}): Promise<GradebookActionResult> {
  const parsed = transitionGradeFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid transition' };
  }
  try {
    const row = await transitionGradeEntry(parsed.data.id, parsed.data.action);
    revalidatePath(`/institutions/${parsed.data.institutionId}/gradebook`);
    revalidatePath('/assessments/report-cards');
    return { ok: true, id: row.id, extra: { workflowStatus: row.metadata?.workflowStatus } };
  } catch (error) {
    return fail(error);
  }
}

export async function bulkTransitionGradeEntriesAction(input: {
  ids: string[];
  action: GradeWorkflowAction;
  institutionId: string;
}): Promise<GradebookActionResult> {
  const parsed = bulkTransitionGradeFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid bulk transition' };
  }
  try {
    const rows = await bulkTransitionGradeEntries(parsed.data.ids, parsed.data.action);
    revalidatePath(`/institutions/${parsed.data.institutionId}/gradebook`);
    revalidatePath('/assessments/report-cards');
    return {
      ok: true,
      id: rows[0]?.id ?? parsed.data.ids[0]!,
      extra: { count: rows.length },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function createCommentsBankAction(input: {
  institutionId: string;
  subjectId?: string;
  gradeBand?: string;
  label: string;
  body: string;
}): Promise<GradebookActionResult> {
  const parsed = commentsBankFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid comment' };
  }
  try {
    const row = await createCommentsBank({
      institutionId: parsed.data.institutionId,
      subjectId: parsed.data.subjectId || null,
      gradeBand: parsed.data.gradeBand || null,
      label: parsed.data.label,
      body: parsed.data.body,
    });
    revalidatePath(`/institutions/${parsed.data.institutionId}/gradebook`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function computeClassRankAction(input: {
  sectionId: string;
  institutionId: string;
  academicPeriodId?: string;
  boardId?: string;
}): Promise<GradebookActionResult> {
  const parsed = computeRankFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid rank request' };
  }
  try {
    const result = await computeClassRank({
      sectionId: parsed.data.sectionId,
      academicPeriodId: parsed.data.academicPeriodId || null,
      boardId: parsed.data.boardId || null,
    });
    revalidatePath(`/institutions/${parsed.data.institutionId}/gradebook`);
    return {
      ok: true,
      id: result.batchId,
      extra: { computedAt: result.computedAt, count: result.ranks.length },
    };
  } catch (error) {
    return fail(error);
  }
}
