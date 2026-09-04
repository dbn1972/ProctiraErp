import { randomUUID } from 'node:crypto';
import type {
  BellPeriodEntity,
  TimetableSlotEntity,
  SubstitutionEntity,
  TimetableRepository,
} from './timetable-repository.js';
import {
  TimetableClashError,
  type TimetableClashConflict,
} from './timetable-clash-error.js';

type SlotInput = Omit<TimetableSlotEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;

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

  async createTimetableSlot(tenantId: string, input: SlotInput) {
    await this.assertNoClash(tenantId, input);
    const now = new Date().toISOString();
    return this.repo.createTimetableSlot({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as TimetableSlotEntity);
  }

  async updateTimetableSlot(
    tenantId: string,
    id: string,
    patch: Partial<TimetableSlotEntity>,
  ) {
    const existing = await this.repo.getTimetableSlot(tenantId, id);
    if (!existing) return null;

    const candidate: SlotInput = {
      institutionId: patch.institutionId ?? existing.institutionId,
      classId: patch.classId ?? existing.classId,
      subjectId: patch.subjectId ?? existing.subjectId,
      staffId: patch.staffId ?? existing.staffId,
      bellPeriodId: patch.bellPeriodId ?? existing.bellPeriodId,
      roomId: patch.roomId !== undefined ? patch.roomId : existing.roomId,
      dayOfWeek: patch.dayOfWeek ?? existing.dayOfWeek,
      status: patch.status ?? existing.status,
    };

    await this.assertNoClash(tenantId, candidate, id);
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

  /**
   * Reject slots that share tenant + dayOfWeek + bellPeriodId with an existing
   * slot for the same staff, class, or (when set) room.
   */
  private async assertNoClash(
    tenantId: string,
    candidate: SlotInput,
    excludeSlotId?: string,
  ): Promise<void> {
    const slots = await this.repo.listTimetableSlots(tenantId);
    const conflicts: TimetableClashConflict[] = [];

    for (const slot of slots) {
      if (excludeSlotId && slot.id === excludeSlotId) continue;
      if (slot.dayOfWeek !== candidate.dayOfWeek) continue;
      if (slot.bellPeriodId !== candidate.bellPeriodId) continue;

      if (slot.staffId === candidate.staffId) {
        conflicts.push({
          slotId: slot.id,
          reason: 'staff',
          dayOfWeek: slot.dayOfWeek,
          bellPeriodId: slot.bellPeriodId,
          staffId: slot.staffId,
        });
      }
      if (slot.classId === candidate.classId) {
        conflicts.push({
          slotId: slot.id,
          reason: 'class',
          dayOfWeek: slot.dayOfWeek,
          bellPeriodId: slot.bellPeriodId,
          classId: slot.classId,
        });
      }
      if (
        candidate.roomId != null &&
        candidate.roomId !== '' &&
        slot.roomId != null &&
        slot.roomId === candidate.roomId
      ) {
        conflicts.push({
          slotId: slot.id,
          reason: 'room',
          dayOfWeek: slot.dayOfWeek,
          bellPeriodId: slot.bellPeriodId,
          roomId: slot.roomId,
        });
      }
    }

    if (conflicts.length > 0) {
      const reasons = [...new Set(conflicts.map((c) => c.reason))].join(', ');
      throw new TimetableClashError(
        `Timetable clash on day ${candidate.dayOfWeek} period ${candidate.bellPeriodId} (${reasons})`,
        conflicts,
      );
    }
  }
}
