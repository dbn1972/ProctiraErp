/**
 * G-905 — academic calendar service.
 *
 *  - Calendar events (holidays / breaks / grading & exam windows) attached to
 *    a period and constrained to its date range.
 *  - Year-end rollover: clone class sections from a source period into a
 *    target period and (optionally) promote ENROLLED students one grade up.
 *    Idempotent — existing target sections / enrollments are skipped, so a
 *    partially-applied run can simply be re-executed.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';
import type { PrismaClient } from '@proctira/database';

import type { CalendarEventRecord, CalendarStore } from './calendar-store.js';
import type { CreateCalendarEventDto, RolloverRequestDto, RolloverSummary } from './schemas.js';

export type RolloverExtras = {
  copyFeeStructures?: (
    tenantId: string,
    actorId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options?: { dryRun?: boolean },
  ) => Promise<{ cloned: number; source: number }>;
  copyTimetable?: (
    tenantId: string,
    actorId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options?: { dryRun?: boolean },
  ) => Promise<{ sectionsCloned: number; meetingsCloned: number }>;
  copyLmsAssignments?: (
    tenantId: string,
    actorId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options?: { dryRun?: boolean },
  ) => Promise<{ cloned: number; source: number }>;
  recordRolloverRun?: (input: {
    tenantId: string;
    actorId: string;
    sourcePeriodId: string;
    targetPeriodId: string;
    dryRun: boolean;
    idempotencyKey: string | null;
    request: Record<string, unknown>;
    summary: RolloverSummary;
    status: 'completed' | 'dry_run';
  }) => Promise<void>;
};

export interface AcademicCalendarServiceDeps {
  prisma: PrismaClient;
  store: CalendarStore;
  rolloverExtras?: RolloverExtras;
}

interface PeriodRow {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date;
}

interface ClassRow {
  id: string;
  institutionId: string;
  gradeId: string;
  name: string;
  capacity: number | null;
}

interface EnrollmentRow {
  id: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string | null;
  status: string;
}

interface GradeRow {
  id: string;
  order: number;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export class AcademicCalendarService {
  private readonly rolloverExtras?: RolloverExtras;

  private readonly prisma: PrismaClient;
  private readonly store: CalendarStore;

  constructor(deps: AcademicCalendarServiceDeps) {
    this.prisma = deps.prisma;
    this.store = deps.store;
    this.rolloverExtras = deps.rolloverExtras;
  }

  setRolloverExtras(extras: RolloverExtras) {
    (this as unknown as { rolloverExtras?: RolloverExtras }).rolloverExtras = extras;
  }

  private async requirePeriod(tenantId: string, id: string): Promise<PeriodRow> {
    const period = (await this.prisma.academicPeriod.findFirst({
      where: { id, tenantId, deletedAt: null },
    })) as PeriodRow | null;
    if (!period) throw new NotFoundError(`Academic period '${id}' not found`);
    return period;
  }

  // ─── Calendar events ──────────────────────────────────────────────────────

  async listEvents(tenantId: string, periodId: string): Promise<CalendarEventRecord[]> {
    await this.requirePeriod(tenantId, periodId);
    return this.store.listByPeriod(tenantId, periodId);
  }

  async addEvent(
    tenantId: string,
    periodId: string,
    dto: CreateCalendarEventDto,
  ): Promise<CalendarEventRecord> {
    const period = await this.requirePeriod(tenantId, periodId);
    if (period.status === 'archived') {
      throw new BusinessRuleError('Cannot add calendar events to an archived period');
    }
    if (dto.endDate < dto.startDate) {
      throw new ValidationError('End date must be on or after start date', [
        { field: 'endDate', rule: 'dateRange', message: 'End date must be on or after start date' },
      ]);
    }
    const periodStart = isoDate(period.startDate);
    const periodEnd = isoDate(period.endDate);
    if (dto.startDate < periodStart || dto.endDate > periodEnd) {
      throw new ValidationError('Event must fall inside the academic period', [
        {
          field: 'startDate',
          rule: 'withinPeriod',
          message: `Event must fall between ${periodStart} and ${periodEnd}`,
        },
      ]);
    }
    return this.store.create({
      id: randomUUID(),
      tenantId,
      academicPeriodId: periodId,
      institutionId: dto.institutionId ?? null,
      kind: dto.kind,
      name: dto.name.trim(),
      startDate: dto.startDate,
      endDate: dto.endDate,
      notes: dto.notes?.trim() || null,
      createdAt: new Date(),
    });
  }

  async removeEvent(tenantId: string, periodId: string, eventId: string): Promise<void> {
    const existing = await this.store.findById(tenantId, eventId);
    if (!existing || existing.academicPeriodId !== periodId) {
      throw new NotFoundError(`Calendar event '${eventId}' not found`);
    }
    await this.store.delete(tenantId, eventId);
  }

  // ─── Rollover ─────────────────────────────────────────────────────────────

  async rollover(
    tenantId: string,
    sourcePeriodId: string,
    dto: RolloverRequestDto,
  ): Promise<RolloverSummary> {
    const dryRun = dto.dryRun ?? true;
    if (dto.targetPeriodId === sourcePeriodId) {
      throw new ValidationError('Target period must differ from the source period', [
        { field: 'targetPeriodId', rule: 'distinct', message: 'Target must differ from source' },
      ]);
    }
    const [source, target] = await Promise.all([
      this.requirePeriod(tenantId, sourcePeriodId),
      this.requirePeriod(tenantId, dto.targetPeriodId),
    ]);
    if (target.status === 'archived') {
      throw new BusinessRuleError('Cannot roll over into an archived period');
    }
    if (target.startDate <= source.startDate) {
      throw new BusinessRuleError('Target period must start after the source period');
    }

    const institutionFilter = dto.institutionId ? { institutionId: dto.institutionId } : {};

    // ── Classes ──
    const [sourceClasses, targetClasses] = await Promise.all([
      this.prisma.class.findMany({
        where: { tenantId, academicPeriodId: source.id, deletedAt: null, ...institutionFilter },
      }) as Promise<ClassRow[]>,
      this.prisma.class.findMany({
        where: { tenantId, academicPeriodId: target.id, deletedAt: null, ...institutionFilter },
      }) as Promise<ClassRow[]>,
    ]);
    const classKey = (c: ClassRow) => `${c.institutionId}|${c.gradeId}|${c.name.toLowerCase()}`;
    const targetByKey = new Map(targetClasses.map((c) => [classKey(c), c]));
    const classesToCreate = sourceClasses.filter((c) => !targetByKey.has(classKey(c)));

    const summary: RolloverSummary = {
      dryRun,
      sourcePeriodId: source.id,
      targetPeriodId: target.id,
      classes: {
        toCreate: classesToCreate.length,
        existing: sourceClasses.length - classesToCreate.length,
        created: 0,
      },
      enrollments: {
        considered: 0,
        toPromote: 0,
        promoted: 0,
        toRetain: 0,
        retained: 0,
        graduating: 0,
        alreadyInTarget: 0,
      },
    };

    if (!dryRun) {
      for (const c of classesToCreate) {
        const created = (await this.prisma.class.create({
          data: {
            tenantId,
            institutionId: c.institutionId,
            gradeId: c.gradeId,
            academicPeriodId: target.id,
            name: c.name,
            capacity: c.capacity,
          },
        })) as ClassRow;
        targetByKey.set(classKey(created), created);
        summary.classes.created += 1;
      }
    }

    // ── Enrollments (optional) ──
    if (dto.promoteEnrollments) {
      const grades = (await this.prisma.grade.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { order: 'asc' },
      })) as GradeRow[];
      const gradeOrder = new Map(grades.map((g) => [g.id, g.order]));
      const gradeByOrder = new Map(grades.map((g) => [g.order, g.id]));

      const [sourceEnrollments, targetEnrollments] = await Promise.all([
        this.prisma.enrollment.findMany({
          where: {
            tenantId,
            academicPeriodId: source.id,
            status: 'ENROLLED',
            ...institutionFilter,
          },
        }) as Promise<EnrollmentRow[]>,
        this.prisma.enrollment.findMany({
          where: { tenantId, academicPeriodId: target.id, ...institutionFilter },
        }) as Promise<EnrollmentRow[]>,
      ]);
      const inTarget = new Set(targetEnrollments.map((e) => e.studentId));
      const sourceClassById = new Map(sourceClasses.map((c) => [c.id, c]));

      const byInstitutionGrade = (rows: ClassRow[]) => {
        const groups = new Map<string, ClassRow[]>();
        for (const c of rows) {
          const key = `${c.institutionId}|${c.gradeId}`;
          const group = groups.get(key) ?? [];
          group.push(c);
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          group.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        }
        return groups;
      };
      const sourceSections = byInstitutionGrade(sourceClasses);
      const targetSections = byInstitutionGrade(Array.from(targetByKey.values()));

      summary.enrollments.considered = sourceEnrollments.length;
      const retainIds = new Set(dto.retainStudentIds ?? []);
      const plan: Array<{
        e: EnrollmentRow;
        nextGradeId: string;
        nextClassId: string | null;
        retain: boolean;
      }> = [];
      const graduating: EnrollmentRow[] = [];
      for (const e of sourceEnrollments) {
        if (inTarget.has(e.studentId)) {
          summary.enrollments.alreadyInTarget += 1;
          continue;
        }
        const retain = retainIds.has(e.studentId);
        if (retain) {
          // W2-SIS-05: repeat the same grade/section band in the target year.
          let nextClassId: string | null = null;
          const sourceClass = e.classId ? sourceClassById.get(e.classId) : undefined;
          if (sourceClass) {
            const siblings = sourceSections.get(`${e.institutionId}|${e.gradeId}`) ?? [];
            const position = siblings.findIndex((c) => c.id === sourceClass.id);
            const candidates = targetSections.get(`${e.institutionId}|${e.gradeId}`) ?? [];
            nextClassId = candidates[position]?.id ?? null;
          }
          plan.push({ e, nextGradeId: e.gradeId, nextClassId, retain: true });
          continue;
        }
        const order = gradeOrder.get(e.gradeId);
        const nextGradeId = order === undefined ? undefined : gradeByOrder.get(order + 1);
        if (!nextGradeId) {
          summary.enrollments.graduating += 1;
          graduating.push(e);
          continue;
        }
        let nextClassId: string | null = null;
        const sourceClass = e.classId ? sourceClassById.get(e.classId) : undefined;
        if (sourceClass) {
          const siblings = sourceSections.get(`${e.institutionId}|${e.gradeId}`) ?? [];
          const position = siblings.findIndex((c) => c.id === sourceClass.id);
          const candidates = targetSections.get(`${e.institutionId}|${nextGradeId}`) ?? [];
          nextClassId = candidates[position]?.id ?? null;
        }
        plan.push({ e, nextGradeId, nextClassId, retain: false });
      }
      summary.enrollments.toPromote = plan.filter((p) => !p.retain).length;
      summary.enrollments.toRetain = plan.filter((p) => p.retain).length;

      if (!dryRun) {
        for (const { e, nextGradeId, nextClassId, retain } of plan) {
          await this.prisma.enrollment.create({
            data: {
              tenantId,
              studentId: e.studentId,
              institutionId: e.institutionId,
              gradeId: nextGradeId,
              classId: nextClassId,
              academicPeriodId: target.id,
              status: 'ENROLLED',
              enrolledAt: target.startDate,
            },
          });
          if (retain) summary.enrollments.retained += 1;
          else summary.enrollments.promoted += 1;
        }
        // Wave 11 — terminal-grade students are graduated on the source period
        // (not only counted). Idempotent: re-run skips non-ENROLLED rows.
        for (const e of graduating) {
          await this.prisma.enrollment.updateMany({
            where: { id: e.id, tenantId, status: 'ENROLLED' },
            data: { status: 'GRADUATED', exitedAt: source.endDate },
          });
        }
      }
    }

    // ── Fee / timetable / LMS extras (preview counts on dry-run) ──
    if (dto.copyFeeStructures) {
      if (this.rolloverExtras?.copyFeeStructures) {
        summary.feeStructures = await this.rolloverExtras.copyFeeStructures(
          tenantId,
          'rollover',
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      } else {
        summary.feeStructures = { cloned: 0, source: 0 };
      }
    }
    if (dto.copyTimetable) {
      if (this.rolloverExtras?.copyTimetable) {
        summary.timetable = await this.rolloverExtras.copyTimetable(
          tenantId,
          'rollover',
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      } else {
        summary.timetable = { sectionsCloned: 0, meetingsCloned: 0 };
      }
    }
    if (dto.copyLmsAssignments) {
      if (this.rolloverExtras?.copyLmsAssignments) {
        summary.lmsAssignments = await this.rolloverExtras.copyLmsAssignments(
          tenantId,
          'rollover',
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      } else {
        summary.lmsAssignments = { cloned: 0, source: 0 };
      }
    }

    if (this.rolloverExtras?.recordRolloverRun) {
      await this.rolloverExtras.recordRolloverRun({
        tenantId,
        actorId: 'rollover',
        sourcePeriodId,
        targetPeriodId: dto.targetPeriodId,
        dryRun,
        idempotencyKey: dto.idempotencyKey ?? null,
        request: { ...dto } as unknown as Record<string, unknown>,
        summary,
        status: dryRun ? 'dry_run' : 'completed',
      });
    }

    return summary;
  }
}
