import { randomUUID } from 'node:crypto';
import type {
  BellPeriodEntity,
  TimetableSlotEntity,
  SubstitutionEntity,
  TimetableRepository,
} from './timetable-repository.js';

export class TimetableService {
  constructor(private readonly repo: TimetableRepository) {}

  listBellPeriods(tenantId: string) {
    return this.repo.listBellPeriods(tenantId);
  }
  getBellPeriod(tenantId: string, id: string) {
    return this.repo.getBellPeriod(tenantId, id);
  }
  createBellPeriod(
    tenantId: string,
    input: Omit<BellPeriodEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createBellPeriod({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as BellPeriodEntity);
  }
  updateBellPeriod(tenantId: string, id: string, patch: Partial<BellPeriodEntity>) {
    return this.repo.updateBellPeriod(tenantId, id, patch);
  }
  listTimetableSlots(tenantId: string) {
    return this.repo.listTimetableSlots(tenantId);
  }
  getTimetableSlot(tenantId: string, id: string) {
    return this.repo.getTimetableSlot(tenantId, id);
  }
  createTimetableSlot(
    tenantId: string,
    input: Omit<TimetableSlotEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createTimetableSlot({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as TimetableSlotEntity);
  }
  updateTimetableSlot(tenantId: string, id: string, patch: Partial<TimetableSlotEntity>) {
    return this.repo.updateTimetableSlot(tenantId, id, patch);
  }
  listSubstitutions(tenantId: string) {
    return this.repo.listSubstitutions(tenantId);
  }
  getSubstitution(tenantId: string, id: string) {
    return this.repo.getSubstitution(tenantId, id);
  }
  createSubstitution(
    tenantId: string,
    input: Omit<SubstitutionEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createSubstitution({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as SubstitutionEntity);
  }
  updateSubstitution(tenantId: string, id: string, patch: Partial<SubstitutionEntity>) {
    return this.repo.updateSubstitution(tenantId, id, patch);
  }
}
