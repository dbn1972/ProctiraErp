'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createBellSchedule,
  createMeeting,
  createPeriod,
  createSection,
  createSubstitution,
  enrollStudent,
  publishSection,
  unpublishSection,
  withdrawStudent,
} from '@/lib/api/timetable';

export type TimetableActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code?: string; status?: number };

function fail(error: unknown): TimetableActionResult {
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

export async function createBellScheduleAction(input: {
  institutionId: string;
  academicPeriodId: string;
  name: string;
  dayPattern?: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await createBellSchedule(input);
    revalidatePath(`/academic-periods/${input.academicPeriodId}/bell-schedules`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function createPeriodAction(input: {
  bellScheduleId: string;
  academicPeriodId: string;
  name: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
}): Promise<TimetableActionResult> {
  try {
    const { bellScheduleId, academicPeriodId, ...body } = input;
    const row = await createPeriod(bellScheduleId, body);
    revalidatePath(`/academic-periods/${academicPeriodId}/bell-schedules`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function createMeetingAction(input: {
  institutionId: string;
  academicPeriodId: string;
  sectionId: string;
  staffId: string;
  periodId: string;
  dayOfWeek: number;
  subjectId?: string | null;
  roomId?: string | null;
}): Promise<TimetableActionResult> {
  try {
    const row = await createMeeting(input);
    revalidatePath(`/institutions/${input.institutionId}/timetable`);
    revalidatePath(`/institutions/${input.institutionId}/schedule`);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function createSubstitutionAction(input: {
  sectionMeetingId: string;
  substituteStaffId: string;
  substitutionDate: string;
  reason?: string | null;
}): Promise<TimetableActionResult> {
  try {
    const row = await createSubstitution(input);
    revalidatePath('/staff/substitutions');
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function createSectionAction(input: {
  institutionId: string;
  academicPeriodId: string;
  name: string;
  code?: string;
  capacity?: number;
  primaryTeacherId?: string;
  defaultRoomId?: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await createSection(input);
    revalidatePath(`/institutions/${input.institutionId}/schedule`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function enrollStudentAction(input: {
  institutionId: string;
  sectionId: string;
  studentId: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await enrollStudent(input.sectionId, input.studentId);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function withdrawStudentAction(input: {
  institutionId: string;
  sectionId: string;
  studentId: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await withdrawStudent(input.sectionId, input.studentId);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function publishSectionAction(input: {
  institutionId: string;
  sectionId: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await publishSection(input.sectionId);
    revalidatePath(`/institutions/${input.institutionId}/schedule`);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function unpublishSectionAction(input: {
  institutionId: string;
  sectionId: string;
}): Promise<TimetableActionResult> {
  try {
    const row = await unpublishSection(input.sectionId);
    revalidatePath(`/institutions/${input.institutionId}/schedule`);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}
