import { gatewayFetch } from './gateway';

export interface BellPeriod {
  id: string;
  tenantId: string;
  institutionId: string;
  name: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableSlot {
  id: string;
  tenantId: string;
  institutionId: string;
  classId: string;
  subjectId: string;
  staffId: string;
  bellPeriodId: string;
  roomId: string | null;
  dayOfWeek: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Substitution {
  id: string;
  tenantId: string;
  slotId: string;
  originalStaffId: string;
  substituteStaffId: string;
  date: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

async function unwrapList<T>(path: string): Promise<T[]> {
  try {
    const result = await gatewayFetch<{ data: T[] }>(path);
    return result.data?.data ?? [];
  } catch {
    return [];
  }
}

export function listBellPeriods() {
  return unwrapList<BellPeriod>('/timetables/periods');
}

export function listTimetableSlots() {
  return unwrapList<TimetableSlot>('/timetables/slots');
}

export function listSubstitutions() {
  return unwrapList<Substitution>('/timetables/substitutions');
}
