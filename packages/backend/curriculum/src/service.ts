/**
 * G-923 — curriculum service.
 * Coverage % = taught units / planned units per subject × grade × period.
 */
import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import type {
  CreateLearningOutcomeInput,
  CreateLessonPlanInput,
  CreateSyllabusUnitInput,
  MarkTaughtInput,
} from './schemas.js';
import type {
  CurriculumStore,
  LearningOutcomeRecord,
  LessonPlanRecord,
  ListUnitsFilter,
  SyllabusUnitRecord,
  UnitCoverageRecord,
} from './store.js';

function nowIso(): string {
  return new Date().toISOString();
}

export type CoverageSummary = {
  subjectId: string;
  gradeId: string;
  academicPeriodId: string;
  planned: number;
  taught: number;
  percent: number;
  taughtUnitIds: string[];
};

export class CurriculumService {
  constructor(private readonly store: CurriculumStore) {}

  async createUnit(tenantId: string, input: CreateSyllabusUnitInput): Promise<SyllabusUnitRecord> {
    const now = nowIso();
    return this.store.createUnit({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId ?? null,
      subjectId: input.subjectId,
      gradeId: input.gradeId,
      academicPeriodId: input.academicPeriodId,
      code: input.code.trim(),
      name: input.name.trim(),
      sequence: input.sequence ?? 1,
      planned: input.planned !== false,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  }

  listUnits(tenantId: string, filter?: ListUnitsFilter) {
    return this.store.listUnits(tenantId, filter);
  }

  async getUnit(tenantId: string, id: string): Promise<SyllabusUnitRecord> {
    const row = await this.store.getUnit(tenantId, id);
    if (!row) throw new NotFoundError(`Syllabus unit ${id} not found`);
    return row;
  }

  async createLessonPlan(
    tenantId: string,
    unitId: string,
    input: CreateLessonPlanInput,
  ): Promise<LessonPlanRecord> {
    await this.getUnit(tenantId, unitId);
    const now = nowIso();
    return this.store.createLessonPlan({
      id: randomUUID(),
      tenantId,
      unitId,
      title: input.title.trim(),
      objectives: input.objectives?.trim() || null,
      plannedDate: input.plannedDate ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  listLessonPlans(tenantId: string, unitId: string) {
    return this.store.listLessonPlans(tenantId, unitId);
  }

  async createOutcome(
    tenantId: string,
    input: CreateLearningOutcomeInput,
  ): Promise<LearningOutcomeRecord> {
    if (input.unitId) await this.getUnit(tenantId, input.unitId);
    const now = nowIso();
    return this.store.createOutcome({
      id: randomUUID(),
      tenantId,
      unitId: input.unitId ?? null,
      subjectId: input.subjectId,
      gradeId: input.gradeId ?? null,
      code: input.code.trim(),
      statement: input.statement.trim(),
      createdAt: now,
      updatedAt: now,
    });
  }

  listOutcomes(
    tenantId: string,
    filter?: { subjectId?: string; unitId?: string; gradeId?: string },
  ) {
    return this.store.listOutcomes(tenantId, filter);
  }

  async markTaught(
    tenantId: string,
    unitId: string,
    input: MarkTaughtInput,
    actorId?: string | null,
  ): Promise<UnitCoverageRecord> {
    await this.getUnit(tenantId, unitId);
    const now = nowIso();
    return this.store.upsertCoverage({
      id: randomUUID(),
      tenantId,
      unitId,
      taughtAt: now,
      taughtBy: actorId ?? null,
      timetableMeetingId: input.timetableMeetingId ?? null,
      lmsSkillId: input.lmsSkillId ?? null,
      createdAt: now,
    });
  }

  /**
   * Coverage % = taught / planned units for the subject × grade × period scope.
   */
  async coverage(
    tenantId: string,
    filter: {
      subjectId: string;
      gradeId: string;
      academicPeriodId: string;
      institutionId?: string;
    },
  ): Promise<CoverageSummary> {
    if (!filter.subjectId || !filter.gradeId || !filter.academicPeriodId) {
      throw new ValidationError('subjectId, gradeId and academicPeriodId are required');
    }
    const units = await this.store.listUnits(tenantId, filter);
    const plannedUnits = units.filter((u) => u.planned);
    const coverageRows = await this.store.listCoverage(
      tenantId,
      plannedUnits.map((u) => u.id),
    );
    const taughtIds = [...new Set(coverageRows.map((c) => c.unitId))].filter((id) =>
      plannedUnits.some((u) => u.id === id),
    );
    const taught = taughtIds.length;
    const planned = plannedUnits.length;
    const percent = planned === 0 ? 0 : Math.round((taught / planned) * 1000) / 10;
    return {
      subjectId: filter.subjectId,
      gradeId: filter.gradeId,
      academicPeriodId: filter.academicPeriodId,
      planned,
      taught,
      percent,
      taughtUnitIds: taughtIds,
    };
  }
}
