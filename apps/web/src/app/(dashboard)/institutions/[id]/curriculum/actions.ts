'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createLearningOutcome,
  createLessonPlan,
  createSyllabusUnit,
  deleteLearningOutcome,
  deleteLessonPlan,
  markUnitTaught,
  unmarkUnitTaught,
  updateLearningOutcome,
  updateLessonPlan,
} from '@/lib/api/curriculum';
import {
  createLearningOutcomeFormSchema,
  createLessonPlanFormSchema,
  createSyllabusUnitFormSchema,
  markTaughtFormSchema,
} from '@/lib/validation/curriculum-schema';

export type CurriculumActionResult =
  { ok: true; id: string; extra?: Record<string, unknown> } | { ok: false; error: string };

function fail(error: unknown): CurriculumActionResult {
  if (error instanceof GatewayError) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'Unexpected error' };
}

function revalidateCurriculum(institutionId: string) {
  revalidatePath(`/institutions/${institutionId}/curriculum`);
}

export async function createSyllabusUnitAction(
  institutionId: string,
  values: {
    subjectId: string;
    gradeId: string;
    academicPeriodId: string;
    code: string;
    name: string;
    sequence?: number;
    notes?: string;
  },
): Promise<CurriculumActionResult> {
  const parsed = createSyllabusUnitFormSchema.safeParse({
    ...values,
    institutionId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid syllabus unit' };
  }
  try {
    const row = await createSyllabusUnit({
      institutionId,
      subjectId: parsed.data.subjectId,
      gradeId: parsed.data.gradeId,
      academicPeriodId: parsed.data.academicPeriodId,
      code: parsed.data.code,
      name: parsed.data.name,
      sequence: parsed.data.sequence,
      notes: parsed.data.notes || undefined,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function createLessonPlanAction(
  institutionId: string,
  values: { unitId: string; title: string; objectives?: string; plannedDate?: string },
): Promise<CurriculumActionResult> {
  const parsed = createLessonPlanFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid lesson plan' };
  }
  try {
    const row = await createLessonPlan(parsed.data.unitId, {
      title: parsed.data.title,
      objectives: parsed.data.objectives || undefined,
      plannedDate: parsed.data.plannedDate || undefined,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function markUnitTaughtAction(
  institutionId: string,
  values: { unitId: string; timetableMeetingId?: string; lmsSkillId?: string },
): Promise<CurriculumActionResult> {
  const parsed = markTaughtFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid mark-taught' };
  }
  try {
    const row = await markUnitTaught(parsed.data.unitId, {
      timetableMeetingId: parsed.data.timetableMeetingId || null,
      lmsSkillId: parsed.data.lmsSkillId || null,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id, extra: { taughtAt: row.taughtAt } };
  } catch (error) {
    return fail(error);
  }
}

export async function createLearningOutcomeAction(
  institutionId: string,
  values: {
    subjectId: string;
    gradeId?: string;
    unitId?: string;
    code: string;
    statement: string;
  },
): Promise<CurriculumActionResult> {
  const parsed = createLearningOutcomeFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid learning outcome' };
  }
  try {
    const row = await createLearningOutcome({
      subjectId: parsed.data.subjectId,
      gradeId: parsed.data.gradeId || null,
      unitId: parsed.data.unitId || null,
      code: parsed.data.code,
      statement: parsed.data.statement,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLessonPlanAction(
  institutionId: string,
  values: { id: string; title: string; plannedDate?: string },
): Promise<CurriculumActionResult> {
  try {
    const row = await updateLessonPlan(values.id, {
      title: values.title,
      plannedDate: values.plannedDate || null,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteLessonPlanAction(
  institutionId: string,
  id: string,
): Promise<CurriculumActionResult> {
  try {
    await deleteLessonPlan(id);
    revalidateCurriculum(institutionId);
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

export async function unmarkUnitTaughtAction(
  institutionId: string,
  unitId: string,
): Promise<CurriculumActionResult> {
  try {
    await unmarkUnitTaught(unitId);
    revalidateCurriculum(institutionId);
    return { ok: true, id: unitId };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteLearningOutcomeAction(
  institutionId: string,
  id: string,
): Promise<CurriculumActionResult> {
  try {
    await deleteLearningOutcome(id);
    revalidateCurriculum(institutionId);
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLearningOutcomeAction(
  institutionId: string,
  values: { id: string; code: string; statement: string; unitId?: string },
): Promise<CurriculumActionResult> {
  try {
    const row = await updateLearningOutcome(values.id, {
      code: values.code,
      statement: values.statement,
      unitId: values.unitId || null,
    });
    revalidateCurriculum(institutionId);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}
