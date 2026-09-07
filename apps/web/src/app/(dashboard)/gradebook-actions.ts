'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  computeGpa,
  createReportCardJob,
  issueTranscript,
  upsertGradeEntry,
} from '@/lib/api/gradebook';

export type GradebookActionResult =
  | { ok: true; id: string; extra?: Record<string, unknown> }
  | { ok: false; error: string; code?: string; status?: number };

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
  institutionId?: string;
}): Promise<GradebookActionResult> {
  try {
    const row = await upsertGradeEntry(input);
    if (input.institutionId) {
      revalidatePath(`/institutions/${input.institutionId}/gradebook`);
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
  try {
    const snap = await computeGpa(input);
    if (input.institutionId) {
      revalidatePath(`/institutions/${input.institutionId}/gradebook`);
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
  try {
    const row = await issueTranscript(input);
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
  try {
    const job = await createReportCardJob(input);
    revalidatePath('/students/records');
    if (input.institutionId) {
      revalidatePath(`/institutions/${input.institutionId}/gradebook`);
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
