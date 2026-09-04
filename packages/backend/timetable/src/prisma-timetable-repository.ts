import type { PrismaClient } from '@proctira/database';
import type {
  BellPeriodEntity,
  TimetableSlotEntity,
  SubstitutionEntity,
  TimetableRepository,
} from './timetable-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaTimetableRepository implements TimetableRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listBellPeriods(tenantId: string) {
    const rows = await (this.prisma as any).bellPeriod.findMany({ where: { tenantId } });
    return rows.map(mapBellPeriod);
  }
  async getBellPeriod(tenantId: string, id: string) {
    const row = await (this.prisma as any).bellPeriod.findFirst({ where: { id, tenantId } });
    return row ? mapBellPeriod(row) : null;
  }
  async createBellPeriod(row: BellPeriodEntity) {
    const created = await (this.prisma as any).bellPeriod.create({ data: toBellPeriod(row) });
    return mapBellPeriod(created);
  }
  async updateBellPeriod(tenantId: string, id: string, patch: Partial<BellPeriodEntity>) {
    const existing = await this.getBellPeriod(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).bellPeriod.update({
      where: { id },
      data: toBellPeriod({ ...existing, ...patch, id, tenantId }),
    });
    return mapBellPeriod(updated);
  }
  async listTimetableSlots(tenantId: string) {
    const rows = await (this.prisma as any).timetableSlot.findMany({ where: { tenantId } });
    return rows.map(mapTimetableSlot);
  }
  async getTimetableSlot(tenantId: string, id: string) {
    const row = await (this.prisma as any).timetableSlot.findFirst({ where: { id, tenantId } });
    return row ? mapTimetableSlot(row) : null;
  }
  async createTimetableSlot(row: TimetableSlotEntity) {
    const created = await (this.prisma as any).timetableSlot.create({ data: toTimetableSlot(row) });
    return mapTimetableSlot(created);
  }
  async updateTimetableSlot(tenantId: string, id: string, patch: Partial<TimetableSlotEntity>) {
    const existing = await this.getTimetableSlot(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).timetableSlot.update({
      where: { id },
      data: toTimetableSlot({ ...existing, ...patch, id, tenantId }),
    });
    return mapTimetableSlot(updated);
  }
  async listSubstitutions(tenantId: string) {
    const rows = await (this.prisma as any).substitution.findMany({ where: { tenantId } });
    return rows.map(mapSubstitution);
  }
  async getSubstitution(tenantId: string, id: string) {
    const row = await (this.prisma as any).substitution.findFirst({ where: { id, tenantId } });
    return row ? mapSubstitution(row) : null;
  }
  async createSubstitution(row: SubstitutionEntity) {
    const created = await (this.prisma as any).substitution.create({ data: toSubstitution(row) });
    return mapSubstitution(created);
  }
  async updateSubstitution(tenantId: string, id: string, patch: Partial<SubstitutionEntity>) {
    const existing = await this.getSubstitution(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).substitution.update({
      where: { id },
      data: toSubstitution({ ...existing, ...patch, id, tenantId }),
    });
    return mapSubstitution(updated);
  }
}

function mapBellPeriod(row: any): BellPeriodEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    name: row.name,
    periodOrder: row.periodOrder,
    startTime: row.startTime,
    endTime: row.endTime,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toBellPeriod(row: BellPeriodEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    name: row.name,
    periodOrder: row.periodOrder,
    startTime: row.startTime,
    endTime: row.endTime,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapTimetableSlot(row: any): TimetableSlotEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    classId: row.classId,
    subjectId: row.subjectId,
    staffId: row.staffId,
    bellPeriodId: row.bellPeriodId,
    roomId: row.roomId ?? null,
    dayOfWeek: row.dayOfWeek,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toTimetableSlot(row: TimetableSlotEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    classId: row.classId,
    subjectId: row.subjectId,
    staffId: row.staffId,
    bellPeriodId: row.bellPeriodId,
    roomId: row.roomId ?? null,
    dayOfWeek: row.dayOfWeek,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapSubstitution(row: any): SubstitutionEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slotId: row.slotId,
    originalStaffId: row.originalStaffId,
    substituteStaffId: row.substituteStaffId,
    date: row.date,
    reason: row.reason ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toSubstitution(row: SubstitutionEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slotId: row.slotId,
    originalStaffId: row.originalStaffId,
    substituteStaffId: row.substituteStaffId,
    date: row.date,
    reason: row.reason ?? null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
