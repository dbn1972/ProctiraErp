'use server';

/**
 * Server Actions for the attendance pages.
 *
 * Wraps bulk attendance marking and percentage report calls through the API
 * gateway. Validation mirrors the backend Typebox schema via zod.
 */
import { revalidatePath } from 'next/cache';

import {
  calculateAttendancePercentage,
  createLeaveRequest,
  createRegularisation,
  decideLeaveRequest,
  decideRegularisation,
  recordBulkAttendance,
  type AttendancePercentageResult,
  type BulkAttendanceInput,
  type BulkAttendanceResponse,
  type StudentAttendanceStatus,
} from '@/lib/api/attendance';
import { GatewayError } from '@/lib/api/gateway';
import {
  attendanceMarkingFormSchema,
  attendanceReportFiltersSchema,
  type AttendanceMarkingFormValues,
  type AttendanceReportFiltersValues,
} from '@/lib/validation/attendance-schema';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

function zodFlatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0 && value[0]) out[key] = value[0];
  }
  return out;
}

function toErrorState<T = unknown>(error: unknown, fallback: string): ActionState<T> {
  if (error instanceof GatewayError) {
    return { status: 'error', message: error.message || fallback };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
}

export async function markAttendanceAction(
  values: AttendanceMarkingFormValues,
): Promise<ActionState<BulkAttendanceResponse>> {
  const parsed = attendanceMarkingFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: BulkAttendanceInput = {
    institutionId: parsed.data.institutionId,
    classId: parsed.data.classId,
    academicPeriodId: parsed.data.academicPeriodId,
    date: parsed.data.date,
    records: parsed.data.records.map((r) => {
      const out: { studentId: string; status: StudentAttendanceStatus; comment?: string } = {
        studentId: r.studentId,
        status: r.status,
      };
      if (r.comment) out.comment = r.comment;
      return out;
    }),
  };

  try {
    const response = await recordBulkAttendance(payload);
    revalidatePath('/attendance');
    revalidatePath('/attendance/reports');
    return {
      status: 'success',
      message: `Recorded ${response.summary.totalRecorded} new and updated ${response.summary.totalUpdated} existing records.`,
      data: response,
    };
  } catch (error) {
    return toErrorState<BulkAttendanceResponse>(error, 'Failed to record attendance');
  }
}

export async function getAttendanceReportAction(
  values: AttendanceReportFiltersValues,
): Promise<ActionState<AttendancePercentageResult>> {
  const parsed = attendanceReportFiltersSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const result = await calculateAttendancePercentage({
      scope: parsed.data.scope,
      ...(parsed.data.studentId ? { studentId: parsed.data.studentId } : {}),
      ...(parsed.data.classId ? { classId: parsed.data.classId } : {}),
      ...(parsed.data.institutionId ? { institutionId: parsed.data.institutionId } : {}),
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });
    if (!result) {
      return {
        status: 'error',
        message: 'No attendance data is available for the selected scope.',
      };
    }
    return { status: 'success', data: result };
  } catch (error) {
    return toErrorState<AttendancePercentageResult>(
      error,
      'Failed to calculate attendance percentage',
    );
  }
}

export async function createRegularisationAction(input: {
  attendanceId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  attendanceDate: string;
  fromStatus: string;
  toStatus: StudentAttendanceStatus;
  reason?: string;
}): Promise<ActionState<{ id: string }>> {
  try {
    const row = await createRegularisation(input);
    revalidatePath('/attendance/ops');
    return { status: 'success', data: { id: row.id } };
  } catch (error) {
    return toErrorState(error, 'Failed to request regularisation');
  }
}

export async function decideRegularisationAction(
  id: string,
  decision: 'approve' | 'reject',
): Promise<ActionState<{ id: string }>> {
  try {
    const row = await decideRegularisation(id, decision);
    revalidatePath('/attendance/ops');
    revalidatePath('/attendance');
    return { status: 'success', data: { id: row.id } };
  } catch (error) {
    return toErrorState(error, 'Failed to decide regularisation');
  }
}

export async function createLeaveRequestAction(input: {
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  attachmentUrl?: string;
}): Promise<ActionState<{ id: string }>> {
  try {
    const row = await createLeaveRequest(input);
    revalidatePath('/attendance/ops');
    return { status: 'success', data: { id: row.id } };
  } catch (error) {
    return toErrorState(error, 'Failed to request leave');
  }
}

export async function decideLeaveAction(
  id: string,
  decision: 'approve' | 'reject',
): Promise<ActionState<{ id: string }>> {
  try {
    const row = await decideLeaveRequest(id, decision);
    revalidatePath('/attendance/ops');
    revalidatePath('/attendance');
    return { status: 'success', data: { id: row.id } };
  } catch (error) {
    return toErrorState(error, 'Failed to decide leave');
  }
}
