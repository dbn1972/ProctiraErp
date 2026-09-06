/**
 * Timetable / bell / substitutions gateway client (WS1).
 *
 * Routes under `/api/v1/timetable/*`. Surfaces SCHEMA_MISSING and clash errors
 * honestly — no silent stub success.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface BellSchedule {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  dayPattern: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BellPeriod {
  id: string;
  tenantId: string;
  bellScheduleId: string;
  name: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionMeeting {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  sectionId: string;
  subjectId: string | null;
  staffId: string;
  periodId: string;
  roomId: string | null;
  dayOfWeek: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Substitution {
  id: string;
  tenantId: string;
  institutionId: string;
  sectionMeetingId: string;
  originalStaffId: string;
  substituteStaffId: string;
  substitutionDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  tenantId: string;
  institutionId: string;
  code: string;
  name: string;
  capacity: number;
  roomType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSection {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string | null;
  code: string;
  name: string;
  primaryTeacherId: string | null;
  defaultRoomId: string | null;
  capacity: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SectionEnrollment {
  id: string;
  tenantId: string;
  sectionId: string;
  studentId: string;
  status: string;
  enrolledAt: string;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendancePeriodSlot {
  meetingId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  periodId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  roomId: string | null;
  teacherStaffId: string | null;
}

export type TimetableLoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status?: number };

function mapError(error: unknown): { error: string; code?: string; status?: number } {
  if (error instanceof GatewayError) {
    return { error: error.message, code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: 'Unexpected timetable API error' };
}

export async function listBellSchedules(filters?: {
  institutionId?: string;
  academicPeriodId?: string;
}): Promise<TimetableLoadResult<BellSchedule[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    if (filters?.academicPeriodId) params.set('academicPeriodId', filters.academicPeriodId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: BellSchedule[] }>(
      `/timetable/bell-schedules${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createBellSchedule(input: {
  institutionId: string;
  academicPeriodId: string;
  name: string;
  dayPattern?: string;
  status?: string;
}): Promise<BellSchedule> {
  const result = await gatewayFetch<BellSchedule>('/timetable/bell-schedules', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Bell schedule create returned no body',
    });
  }
  return result.data;
}

export async function listPeriods(
  bellScheduleId: string,
): Promise<TimetableLoadResult<BellPeriod[]>> {
  try {
    const result = await gatewayFetch<{ data: BellPeriod[] }>(
      `/timetable/bell-schedules/${encodeURIComponent(bellScheduleId)}/periods`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createPeriod(
  bellScheduleId: string,
  input: { name: string; periodOrder: number; startTime: string; endTime: string },
): Promise<BellPeriod> {
  const result = await gatewayFetch<BellPeriod>(
    `/timetable/bell-schedules/${encodeURIComponent(bellScheduleId)}/periods`,
    { method: 'POST', json: input },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Period create returned no body',
    });
  }
  return result.data;
}

export async function listMeetings(filters?: {
  institutionId?: string;
  academicPeriodId?: string;
  staffId?: string;
}): Promise<TimetableLoadResult<SectionMeeting[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    if (filters?.academicPeriodId) params.set('academicPeriodId', filters.academicPeriodId);
    if (filters?.staffId) params.set('staffId', filters.staffId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: SectionMeeting[] }>(
      `/timetable/meetings${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createMeeting(input: {
  institutionId: string;
  academicPeriodId: string;
  sectionId: string;
  subjectId?: string | null;
  staffId: string;
  periodId: string;
  roomId?: string | null;
  dayOfWeek: number;
  status?: string;
}): Promise<SectionMeeting> {
  const result = await gatewayFetch<SectionMeeting>('/timetable/meetings', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Meeting create returned no body',
    });
  }
  return result.data;
}

export async function listSubstitutions(filters?: {
  institutionId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<TimetableLoadResult<Substitution[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    if (filters?.fromDate) params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params.set('toDate', filters.toDate);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: Substitution[] }>(
      `/timetable/substitutions${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createSubstitution(input: {
  sectionMeetingId: string;
  substituteStaffId: string;
  substitutionDate: string;
  originalStaffId?: string;
  institutionId?: string;
  reason?: string | null;
  status?: string;
}): Promise<Substitution> {
  const result = await gatewayFetch<Substitution>('/timetable/substitutions', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Substitution create returned no body',
    });
  }
  return result.data;
}

export async function listRooms(filters?: {
  institutionId?: string;
}): Promise<TimetableLoadResult<Room[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: Room[] }>(
      `/timetable/rooms${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function listSections(filters?: {
  institutionId?: string;
  academicPeriodId?: string;
  status?: string;
}): Promise<TimetableLoadResult<ScheduleSection[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    if (filters?.academicPeriodId) params.set('academicPeriodId', filters.academicPeriodId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: ScheduleSection[] }>(
      `/timetable/sections${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function getSection(
  sectionId: string,
): Promise<
  TimetableLoadResult<
    ScheduleSection & { enrollments: SectionEnrollment[]; meetings: SectionMeeting[] }
  >
> {
  try {
    const result = await gatewayFetch<
      ScheduleSection & { enrollments: SectionEnrollment[]; meetings: SectionMeeting[] }
    >(`/timetable/sections/${encodeURIComponent(sectionId)}`, {
      next: { revalidate: 0 },
    });
    if (!result.data) {
      return { ok: false, error: 'Section not found', status: 404 };
    }
    return {
      ok: true,
      data: {
        ...result.data,
        enrollments: result.data.enrollments ?? [],
        meetings: result.data.meetings ?? [],
      },
    };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function createSection(input: {
  institutionId: string;
  academicPeriodId: string;
  name: string;
  code?: string;
  gradeId?: string | null;
  primaryTeacherId?: string | null;
  defaultRoomId?: string | null;
  capacity?: number;
}): Promise<ScheduleSection> {
  const result = await gatewayFetch<ScheduleSection>('/timetable/sections', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Section create returned no body',
    });
  }
  return result.data;
}

export async function enrollStudent(
  sectionId: string,
  studentId: string,
): Promise<SectionEnrollment> {
  const result = await gatewayFetch<SectionEnrollment>(
    `/timetable/sections/${encodeURIComponent(sectionId)}/enrollments`,
    { method: 'POST', json: { studentId } },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Enroll returned no body',
    });
  }
  return result.data;
}

export async function withdrawStudent(
  sectionId: string,
  studentId: string,
): Promise<SectionEnrollment> {
  const result = await gatewayFetch<SectionEnrollment>(
    `/timetable/sections/${encodeURIComponent(sectionId)}/enrollments/${encodeURIComponent(studentId)}`,
    { method: 'DELETE' },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Withdraw returned no body',
    });
  }
  return result.data;
}

export async function publishSection(sectionId: string): Promise<ScheduleSection> {
  const result = await gatewayFetch<ScheduleSection>(
    `/timetable/sections/${encodeURIComponent(sectionId)}/publish`,
    { method: 'POST', json: {} },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Publish returned no body',
    });
  }
  return result.data;
}

export async function unpublishSection(sectionId: string): Promise<ScheduleSection> {
  const result = await gatewayFetch<ScheduleSection>(
    `/timetable/sections/${encodeURIComponent(sectionId)}/unpublish`,
    { method: 'POST', json: {} },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Unpublish returned no body',
    });
  }
  return result.data;
}

export async function listAttendancePeriods(filters: {
  institutionId: string;
  dayOfWeek?: number;
}): Promise<TimetableLoadResult<AttendancePeriodSlot[]>> {
  try {
    const params = new URLSearchParams();
    params.set('institutionId', filters.institutionId);
    if (filters.dayOfWeek != null) params.set('dayOfWeek', String(filters.dayOfWeek));
    const result = await gatewayFetch<{ data: AttendancePeriodSlot[] }>(
      `/timetable/attendance-periods?${params.toString()}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}
