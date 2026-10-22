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

import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import type { PrismaClient } from '@proctira/database';

import { requireInstitution } from '../education/assignable-guards.js';
import type { InstitutionRepository } from '../institution-repository.js';

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
  /**
   * PRC-L318: look up a completed (non-dry-run) ledger row for an idempotency
   * key so a replayed request returns the stored summary instead of re-executing.
   */
  findCompletedRolloverRun?: (input: {
    tenantId: string;
    idempotencyKey: string;
  }) => Promise<RolloverSummary | null>; /**
   * PRC-L318: claim-first ledger. Atomically inserts the real-run ledger row
   * with status `running` BEFORE any write (or re-claims a previously `failed`
   * row). Returns `claimed` with the row id, or the state of the row that
   * already owns the key. Requires the `running` status in the ledger CHECK
   * (schema migration); wired only when `ROLLOVER_LEDGER_CLAIM_FIRST` is on.
   */
  claimRolloverRun?: (input: {
    tenantId: string;
    actorId: string;
    sourcePeriodId: string;
    targetPeriodId: string;
    idempotencyKey: string;
    request: Record<string, unknown>;
  }) => Promise<RolloverClaim>;
  /** PRC-L318: finalise a claimed run as `completed` (with summary) or `failed`. */
  finishRolloverRun?: (input: {
    tenantId: string;
    runId: string;
    status: 'completed' | 'failed';
    summary: RolloverSummary | null;
  }) => Promise<void>;
};
/** PRC-L318: outcome of a claim-first ledger insert. */
export type RolloverClaim =
  | { state: 'claimed'; runId: string }
  | { state: 'completed'; summary: RolloverSummary }
  | { state: 'running' };

/**
 * PRC-L318: dry-run previews must not consume the real run's idempotency key
 * (the ledger is unique on (tenant_id, idempotency_key)), so they are recorded
 * under a namespaced key.
 */
export function ledgerIdempotencyKey(key: string | undefined, dryRun: boolean): string | null {
  if (!key) return null;
  return dryRun ? `dry_run:${key}` : key;
}

export interface AcademicCalendarServiceDeps {
  prisma: PrismaClient;
  store: CalendarStore;
  rolloverExtras?: RolloverExtras;
  /**
   * PRC-M286: when provided, `addEvent` requires `dto.institutionId` (when
   * set) to exist and belong to the caller's tenant before it is stored.
   * Optional so existing tests that construct the service without it are
   * unaffected.
   */
  institutionRepository?: InstitutionRepository;
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

/** PRC-M525: retries for a serializable rollover-write race. */
const SERIALIZATION_RETRIES = 3;

/** Prisma P2034 / Postgres 40001: the transaction must be retried. */
function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  return (
    e.code === 'P2034' ||
    e.code === '40001' ||
    e.meta?.code === '40001' ||
    (typeof e.message === 'string' && /could not serialize access|40001/.test(e.message))
  );
}

export class AcademicCalendarService {
  private readonly rolloverExtras?: RolloverExtras;

  private readonly prisma: PrismaClient;
  private readonly store: CalendarStore;
  private readonly institutionRepository?: InstitutionRepository;

  constructor(deps: AcademicCalendarServiceDeps) {
    this.prisma = deps.prisma;
    this.store = deps.store;
    this.rolloverExtras = deps.rolloverExtras;
    this.institutionRepository = deps.institutionRepository;
  }

  setRolloverExtras(extras: RolloverExtras) {
    (this as unknown as { rolloverExtras?: RolloverExtras }).rolloverExtras = extras;
  }

  /**
   * PRC-M525: run `fn` inside a serializable DB transaction when the client
   * supports one, otherwise run it directly (in-memory shim). Mirrors
   * `AreaHierarchyService.runInTransaction()`'s retry-on-serialization-
   * failure logic verbatim. `this.prisma` is already the tenant-bound client
   * in production (`tenant-bound-prisma.ts`'s `$transaction` proxy routes
   * through `withTenantTransaction`), so no explicit tenant binding is
   * needed here.
   */
  private async runInTransaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    const prisma = this.prisma as unknown as {
      $transaction?<R>(
        cb: (tx: PrismaClient) => Promise<R>,
        options?: { isolationLevel?: 'Serializable' },
      ): Promise<R>;
    };
    if (typeof prisma.$transaction !== 'function') {
      return fn(this.prisma);
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await prisma.$transaction<T>((tx) => fn(tx), { isolationLevel: 'Serializable' });
      } catch (error) {
        if (attempt >= SERIALIZATION_RETRIES || !isSerializationFailure(error)) throw error;
      }
    }
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
    if (this.institutionRepository && dto.institutionId) {
      await requireInstitution(this.institutionRepository, tenantId, dto.institutionId);
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
    const period = await this.requirePeriod(tenantId, periodId);
    const existing = await this.store.findById(tenantId, eventId);
    if (!existing || existing.academicPeriodId !== periodId) {
      throw new NotFoundError(`Calendar event '${eventId}' not found`);
    }
    // PRC-L124: archived periods are read-only (mirrors addEvent).
    if (period.status === 'archived') {
      throw new ConflictError('Cannot remove calendar events from an archived period');
    }
    await this.store.delete(tenantId, eventId);
  }

  // ─── Rollover ─────────────────────────────────────────────────────────────

  /**
   * @param actorId authenticated caller (JWT `sub`); recorded on the run ledger
   *   and passed to every clone hook (PRC-L319).
   */
  async rollover(
    tenantId: string,
    sourcePeriodId: string,
    dto: RolloverRequestDto,
    actorId: string,
  ): Promise<RolloverSummary> {
    if (!actorId?.trim()) {
      throw new ValidationError('Rollover requires an authenticated actor', [
        { field: 'actorId', rule: 'required', message: 'Authenticated actor is required' },
      ]);
    }
    const dryRun = dto.dryRun ?? true;
    // PRC-L318: replay of a completed real run returns its stored summary.
    if (!dryRun && dto.idempotencyKey && this.rolloverExtras?.findCompletedRolloverRun) {
      const previous = await this.rolloverExtras.findCompletedRolloverRun({
        tenantId,
        idempotencyKey: dto.idempotencyKey,
      });
      if (previous) {
        if (
          previous.sourcePeriodId !== sourcePeriodId ||
          previous.targetPeriodId !== dto.targetPeriodId
        ) {
          throw new ConflictError('Idempotency key was already used for a different rollover');
        }
        return previous;
      }
    }
    if (dto.targetPeriodId === sourcePeriodId) {
      throw new ValidationError('Target period must differ from the source period', [
        { field: 'targetPeriodId', rule: 'distinct', message: 'Target must differ from source' },
      ]);
    }
    // PRC-L320: fail before any write when a requested extra has no wired hook,
    // instead of reporting success with zero counts.
    const unavailable = [
      dto.copyFeeStructures && !this.rolloverExtras?.copyFeeStructures ? 'copyFeeStructures' : null,
      dto.copyTimetable && !this.rolloverExtras?.copyTimetable ? 'copyTimetable' : null,
      dto.copyLmsAssignments && !this.rolloverExtras?.copyLmsAssignments
        ? 'copyLmsAssignments'
        : null,
    ].filter((name): name is string => name !== null);
    if (unavailable.length > 0) {
      throw new BusinessRuleError(
        `Rollover extras not available in this deployment: ${unavailable.join(', ')}`,
      );
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

    const extras = this.rolloverExtras;
    // PRC-L318: claim the idempotency key BEFORE executing so two concurrent
    // same-key requests cannot both run; the loser sees `running` (409) or the
    // winner's stored summary.
    if (!dryRun && dto.idempotencyKey && extras?.claimRolloverRun && extras.finishRolloverRun) {
      const claim = await extras.claimRolloverRun({
        tenantId,
        actorId,
        sourcePeriodId,
        targetPeriodId: dto.targetPeriodId,
        idempotencyKey: dto.idempotencyKey,
        request: { ...dto } as unknown as Record<string, unknown>,
      });
      if (claim.state === 'completed') {
        if (
          claim.summary.sourcePeriodId !== sourcePeriodId ||
          claim.summary.targetPeriodId !== dto.targetPeriodId
        ) {
          throw new ConflictError('Idempotency key was already used for a different rollover');
        }
        return claim.summary;
      }
      if (claim.state === 'running') {
        throw new ConflictError('A rollover with this idempotency key is already in progress');
      }
      let summary: RolloverSummary;
      try {
        summary = await this.executeRollover(
          tenantId,
          sourcePeriodId,
          dto,
          actorId,
          source,
          target,
          dryRun,
        );
      } catch (err) {
        await extras.finishRolloverRun({
          tenantId,
          runId: claim.runId,
          status: 'failed',
          summary: null,
        });
        throw err;
      }
      await extras.finishRolloverRun({
        tenantId,
        runId: claim.runId,
        status: 'completed',
        summary,
      });
      return summary;
    }
    const summary = await this.executeRollover(
      tenantId,
      sourcePeriodId,
      dto,
      actorId,
      source,
      target,
      dryRun,
    );
    if (this.rolloverExtras?.recordRolloverRun) {
      await this.rolloverExtras.recordRolloverRun({
        tenantId,
        actorId,
        sourcePeriodId,
        targetPeriodId: dto.targetPeriodId,
        dryRun,
        idempotencyKey: ledgerIdempotencyKey(dto.idempotencyKey, dryRun),
        request: { ...dto } as unknown as Record<string, unknown>,
        summary,
        status: dryRun ? 'dry_run' : 'completed',
      });
    }

    return summary;
  }
  private async executeRollover(
    tenantId: string,
    sourcePeriodId: string,
    dto: RolloverRequestDto,
    actorId: string,
    source: PeriodRow,
    target: PeriodRow,
    dryRun: boolean,
  ): Promise<RolloverSummary> {
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

    // PRC-M525: new target-period classes are created in their own
    // serializable transaction before the enrollment plan is built, so
    // `targetByKey` (used below to match a promoted student into the
    // correct section) reflects classes created by *this* run before the
    // section-matching logic reads it, matching the original single-run
    // ordering (class-create happened before enrollment planning).
    //
    // Postgres's SERIALIZABLE detection (SSI) only catches a conflict when
    // the *read* that justifies a write and the write itself are in the same
    // transaction — a read taken before the transaction starts (as
    // `classesToCreate`, computed above, was) creates no predicate lock, so
    // two concurrent transactions can both decide independently "this class
    // doesn't exist yet" and both insert it with no conflict detected. Each
    // create below re-checks for a matching row *inside* this transaction
    // immediately before inserting, so the existence read and the write
    // share one transaction and SSI can abort the loser for retry.
    if (!dryRun) {
      await this.runInTransaction(async (tx) => {
        for (const c of classesToCreate) {
          const alreadyCreated = (await tx.class.findFirst({
            where: {
              tenantId,
              institutionId: c.institutionId,
              gradeId: c.gradeId,
              academicPeriodId: target.id,
              name: c.name,
              deletedAt: null,
            },
          })) as ClassRow | null;
          if (alreadyCreated) {
            targetByKey.set(classKey(alreadyCreated), alreadyCreated);
            continue;
          }
          const created = (await tx.class.create({
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
      });
    }

    // PRC-M525: the plan computed below for enrollments is write material
    // consumed by the second transaction further down — populated here
    // (reads only), executed there (one atomic write).
    let enrollmentPlan: Array<{
      e: EnrollmentRow;
      nextGradeId: string;
      nextClassId: string | null;
      retain: boolean;
    }> = [];
    let graduatingEnrollments: EnrollmentRow[] = [];

    // ── Enrollments (optional) ──
    if (dto.promoteEnrollments) {
      const grades = (await this.prisma.grade.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { order: 'asc' },
      })) as GradeRow[];

      // PRC-M280: promotion is inferred from the numeric grade order. A
      // duplicate order collapses two grades into one Map slot (students go to
      // an arbitrary grade); a gap (e.g. 5 -> 7) makes a non-terminal student
      // look terminal and get an irreversible GRADUATED write. Refuse the whole
      // rollover (fail closed) rather than silently corrupting data. The caller
      // must fix the grade ladder first.
      const seenOrders = new Set<number>();
      const duplicateOrders = new Set<number>();
      for (const g of grades) {
        if (seenOrders.has(g.order)) duplicateOrders.add(g.order);
        seenOrders.add(g.order);
      }
      if (duplicateOrders.size > 0) {
        throw new BusinessRuleError(
          `Cannot roll over: grade order is not unique (duplicate order(s): ${[...duplicateOrders]
            .sort((a, b) => a - b)
            .join(', ')}). Fix the grade ladder before promoting students.`,
        );
      }
      const sortedOrders = [...seenOrders].sort((a, b) => a - b);
      const gapAfter: number[] = [];
      for (let i = 0; i < sortedOrders.length - 1; i += 1) {
        const current = sortedOrders[i]!;
        const next = sortedOrders[i + 1]!;
        if (next - current > 1) gapAfter.push(current);
      }

      const gradeOrder = new Map(grades.map((g) => [g.id, g.order]));
      const gradeByOrder = new Map(grades.map((g) => [g.order, g.id]));
      const maxOrder = sortedOrders.length > 0 ? sortedOrders[sortedOrders.length - 1]! : -1;

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
          // PRC-M280: only a genuine terminal grade (highest order in the
          // ladder) graduates. A missing order+1 while a higher grade exists
          // means the ladder has a gap — graduating here would be a wrong,
          // irreversible status change, so refuse the whole run.
          if (order !== undefined && order < maxOrder) {
            throw new BusinessRuleError(
              `Cannot roll over: grade order ${order} has no successor (order ${order + 1} is missing) ` +
                `while higher grades exist${
                  gapAfter.length > 0 ? ` (gaps after order ${gapAfter.join(', ')})` : ''
                }. Fix the grade ladder before promoting students.`,
            );
          }
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

      // PRC-M525: capture the plan for the single transaction below — no
      // writes happen in this block.
      enrollmentPlan = plan;
      graduatingEnrollments = graduating;
    }

    // PRC-M525: the enrollment-create loop and the graduating updateMany run
    // inside one transaction so two concurrent rollover runs cannot
    // interleave and duplicate enrollment rows. The reads above
    // (enrollmentPlan, graduatingEnrollments) only need a consistent-enough
    // snapshot — the fix's purpose is making the *writes* atomic.
    //
    // As with the class-create loop above, the `inTarget` membership check
    // that built `enrollmentPlan` ran before this transaction started, so it
    // creates no predicate lock SSI can use to detect a concurrent racer.
    // Re-check for an existing target-period enrollment for this student
    // *inside* the transaction, immediately before inserting, so the
    // existence read and the write share one transaction.
    if (!dryRun) {
      await this.runInTransaction(async (tx) => {
        for (const { e, nextGradeId, nextClassId, retain } of enrollmentPlan) {
          const alreadyEnrolled = await tx.enrollment.findFirst({
            where: { tenantId, studentId: e.studentId, academicPeriodId: target.id },
          });
          if (alreadyEnrolled) continue;
          await tx.enrollment.create({
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
        for (const e of graduatingEnrollments) {
          await tx.enrollment.updateMany({
            where: { id: e.id, tenantId, status: 'ENROLLED' },
            data: { status: 'GRADUATED', exitedAt: source.endDate },
          });
        }
      });
    }

    // ── Fee / timetable / LMS extras (preview counts on dry-run) ──
    if (dto.copyFeeStructures) {
      if (this.rolloverExtras?.copyFeeStructures) {
        summary.feeStructures = await this.rolloverExtras.copyFeeStructures(
          tenantId,
          actorId,
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      }
    }
    if (dto.copyTimetable) {
      if (this.rolloverExtras?.copyTimetable) {
        summary.timetable = await this.rolloverExtras.copyTimetable(
          tenantId,
          actorId,
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      }
    }
    if (dto.copyLmsAssignments) {
      if (this.rolloverExtras?.copyLmsAssignments) {
        summary.lmsAssignments = await this.rolloverExtras.copyLmsAssignments(
          tenantId,
          actorId,
          sourcePeriodId,
          dto.targetPeriodId,
          { dryRun },
        );
      }
    }

    return summary;
  }
}
