import type {
  BellPeriodEntity,
  TimetableSlotEntity,
  SubstitutionEntity,
  TimetableRepository,
} from './timetable-repository.js';

export class InMemoryTimetableRepository implements TimetableRepository {
  private readonly bellPeriods = new Map<string, BellPeriodEntity>();
  private readonly timetableSlots = new Map<string, TimetableSlotEntity>();
  private readonly substitutions = new Map<string, SubstitutionEntity>();

  async listBellPeriods(tenantId: string) {
    return [...this.bellPeriods.values()].filter((x) => x.tenantId === tenantId);
  }
  async getBellPeriod(tenantId: string, id: string) {
    const row = this.bellPeriods.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createBellPeriod(row: BellPeriodEntity) {
    this.bellPeriods.set(row.id, row);
    return row;
  }
  async updateBellPeriod(tenantId: string, id: string, patch: Partial<BellPeriodEntity>) {
    const cur = await this.getBellPeriod(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.bellPeriods.set(id, next);
    return next;
  }
  async listTimetableSlots(tenantId: string) {
    return [...this.timetableSlots.values()].filter((x) => x.tenantId === tenantId);
  }
  async getTimetableSlot(tenantId: string, id: string) {
    const row = this.timetableSlots.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createTimetableSlot(row: TimetableSlotEntity) {
    this.timetableSlots.set(row.id, row);
    return row;
  }
  async updateTimetableSlot(tenantId: string, id: string, patch: Partial<TimetableSlotEntity>) {
    const cur = await this.getTimetableSlot(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.timetableSlots.set(id, next);
    return next;
  }
  async listSubstitutions(tenantId: string) {
    return [...this.substitutions.values()].filter((x) => x.tenantId === tenantId);
  }
  async getSubstitution(tenantId: string, id: string) {
    const row = this.substitutions.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createSubstitution(row: SubstitutionEntity) {
    this.substitutions.set(row.id, row);
    return row;
  }
  async updateSubstitution(tenantId: string, id: string, patch: Partial<SubstitutionEntity>) {
    const cur = await this.getSubstitution(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.substitutions.set(id, next);
    return next;
  }
}
