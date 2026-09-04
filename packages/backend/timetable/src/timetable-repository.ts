/** Timetable repository ports (P19). */

export interface BellPeriodEntity {
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

export interface TimetableSlotEntity {
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

export interface SubstitutionEntity {
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

export interface TimetableRepository {
  listBellPeriods(tenantId: string): Promise<BellPeriodEntity[]>;
  getBellPeriod(tenantId: string, id: string): Promise<BellPeriodEntity | null>;
  createBellPeriod(row: BellPeriodEntity): Promise<BellPeriodEntity>;
  updateBellPeriod(tenantId: string, id: string, patch: Partial<BellPeriodEntity>): Promise<BellPeriodEntity | null>;
  listTimetableSlots(tenantId: string): Promise<TimetableSlotEntity[]>;
  getTimetableSlot(tenantId: string, id: string): Promise<TimetableSlotEntity | null>;
  createTimetableSlot(row: TimetableSlotEntity): Promise<TimetableSlotEntity>;
  updateTimetableSlot(tenantId: string, id: string, patch: Partial<TimetableSlotEntity>): Promise<TimetableSlotEntity | null>;
  listSubstitutions(tenantId: string): Promise<SubstitutionEntity[]>;
  getSubstitution(tenantId: string, id: string): Promise<SubstitutionEntity | null>;
  createSubstitution(row: SubstitutionEntity): Promise<SubstitutionEntity>;
  updateSubstitution(tenantId: string, id: string, patch: Partial<SubstitutionEntity>): Promise<SubstitutionEntity | null>;
}
