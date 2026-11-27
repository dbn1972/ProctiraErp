'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { genericActionErrorMessage } from '@/lib/api/action-error';
import {
  createBellSchedule,
  createMeeting,
  deleteMeeting,
  createPeriod,
  createSection,
  createSubstitution,
  enrollStudent,
  bulkEnrollStudents,
  publishSection,
  unpublishSection,
  withdrawStudent,
  runGenerationJob,
  markTeacherAbsent,
} from '@/lib/api/timetable';
import type { MeetingClash } from '@/lib/timetable/meeting-conflict-label';
import { bellScheduleInputSchema } from '@/lib/validation/action-input-schema';

export type TimetableActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code?: string; status?: number; conflicts?: MeetingClash[] };

function clashList(details: unknown): MeetingClash[] | undefined {
  if (!details || typeof details !== 'object' || !('conflicts' in details)) return undefined;
  const conflicts = (details as { conflicts?: unknown }).conflicts;
  return Array.isArray(conflicts) ? (conflicts as MeetingClash[]) : undefined;
}

/** Gateway refusal text from TimetableService.createSubstitution (matched server-side only). */
const INACTIVE_MEETING_GATEWAY_MESSAGE = 'Cannot substitute an inactive or cancelled meeting';
const INACTIVE_MEETING_ACTION_MESSAGE =
  'This meeting slot is inactive or cancelled, so it cannot take a substitute. Choose an active slot.';

function fail(
  error: unknown,
  fallback = 'The timetable change could not be saved.',
): TimetableActionResult {
  // RAW-WEB: fixed copy plus a reference; code, status and the structured clash list stay.
  const message = genericActionErrorMessage(error, fallback);
  if (error instanceof GatewayError) {
    return {
      ok: false,
      error: message,
      code: error.code,
      status: error.status,
      conflicts: clashList(error.details),
    };
  }
  return { ok: false, error: message };
}

export async function createBellScheduleAction(input: {
  institutionId: string;
  academicPeriodId: string;
  name: string;
  dayPattern?: string;
}): Promise<TimetableActionResult> {
  const parsed = bellScheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid bell schedule' };
  }
  try {
    const row = await createBellSchedule(parsed.data);
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

export async function deleteMeetingAction(input: {
  institutionId: string;
  meetingId: string;
  sectionId: string;
}): Promise<TimetableActionResult> {
  try {
    await deleteMeeting(input.meetingId);
    revalidatePath(`/institutions/${input.institutionId}/timetable`);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return { ok: true, id: input.meetingId };
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
    // UATENV-D37: name the cause with fixed copy; the gateway text itself stays server-side.
    if (
      error instanceof GatewayError &&
      error.status === 400 &&
      error.message === INACTIVE_MEETING_GATEWAY_MESSAGE
    ) {
      return fail(error, INACTIVE_MEETING_ACTION_MESSAGE);
    }
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

export async function bulkEnrollStudentsAction(input: {
  institutionId: string;
  sectionId: string;
  studentIds: string[];
}): Promise<
  | {
      ok: true;
      enrolled: number;
      failed: Array<{ studentId: string; message: string }>;
    }
  | TimetableActionResult
> {
  try {
    const result = await bulkEnrollStudents(input.sectionId, input.studentIds);
    revalidatePath(`/institutions/${input.institutionId}/schedule/${input.sectionId}`);
    return {
      ok: true,
      enrolled: result.summary.enrolled,
      failed: result.failed.map((f) => ({ studentId: f.studentId, message: f.message })),
    };
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
    revalidatePath(`/institutions/${input.institutionId}/timetable`);
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
    revalidatePath(`/institutions/${input.institutionId}/timetable`);
    return { ok: true, id: row.id };
  } catch (error) {
    return fail(error);
  }
}

export async function runGenerationJobAction(input: {
  institutionId: string;
  academicPeriodId: string;
  bellScheduleId?: string;
  persistMeetings?: boolean;
  demands: Array<{
    sectionId: string;
    subjectId: string;
    staffId: string;
    periodsPerWeek: number;
    preferredRoomId?: string | null;
    enrollmentCount?: number;
  }>;
}): Promise<TimetableActionResult & { clashCount?: number; assignedCount?: number }> {
  try {
    const row = await runGenerationJob(input);
    revalidatePath(`/institutions/${input.institutionId}/timetable`);
    revalidatePath(`/institutions/${input.institutionId}/timetable/generate`);
    return { ok: true, id: row.id, clashCount: row.clashCount, assignedCount: row.assignedCount };
  } catch (error) {
    return fail(error);
  }
}

export async function markTeacherAbsentAction(input: {
  institutionId: string;
  staffId: string;
  absenceDate: string;
  reason?: string | null;
}): Promise<TimetableActionResult & { affectedCount?: number }> {
  try {
    const row = await markTeacherAbsent(input);
    revalidatePath(`/institutions/${input.institutionId}/timetable/substitutions`);
    revalidatePath('/staff/substitutions');
    return { ok: true, id: row.absence.id, affectedCount: row.affected.length };
  } catch (error) {
    return fail(error);
  }
}
