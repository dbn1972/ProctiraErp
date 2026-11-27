/**
 * Promotion commands against the live backend: `AcademicCalendarService.rollover`
 * with `promoteEnrollments` over the tenant-bound Prisma client, wired like
 * packages/backend/institution/src/academic-calendar/rollover-concurrency.pg.test.ts.
 *
 * Configured rule in code (calendar-service.ts, G-905 / W2-SIS-05 / PRC-M280):
 * every ENROLLED student of the source year moves to the grade with order + 1
 * in the same section position, a student on the retain list repeats the
 * grade, a student in the highest grade graduates (source row -> GRADUATED),
 * nobody is enrolled twice in the target year, and a dry run writes nothing.
 * There is no marks-based promotion rule in the code; see results.md.
 */
import { randomUUID } from 'node:crypto';

import {
  AcademicCalendarService,
  AcademicPeriodService,
  createTenantBoundPrisma,
  PgCalendarStore,
  tenantContext,
} from '@proctira/backend-institution';
import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import fc from 'fast-check';

import {
  agree,
  attempt,
  COMMON_INVARIANTS,
  pick,
  type CommandStats,
  type InvariantMeta,
  type ViolationLog,
} from './core.js';
import type { DomainSpec, RealBase } from './runner.js';

type Pool = NonNullable<ReturnType<typeof getSharedPgPool>>;
type Prisma = ReturnType<typeof createPrismaClient>;
type Bound = ReturnType<typeof createTenantBoundPrisma>;

let prisma: Prisma | null = null;
function sharedPrisma(): Prisma {
  prisma ??= createPrismaClient({ datasourceUrl: process.env['DATABASE_URL']! });
  return prisma;
}
export async function closePromotionPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = null;
}

export const PROMOTION_INVARIANTS: InvariantMeta[] = [
  {
    id: 'promotion-follows-ladder',
    title:
      'Each promoted student moves exactly one grade up (retained: same grade) into the matching section',
    module: 'institution-rollover',
    category: 'grade',
    severity: 'high',
    source: 'calendar-service.ts executeRollover (G-905, W2-SIS-05, PRC-M280)',
  },
  {
    id: 'promotion-once',
    title:
      'A student has at most one enrollment in the target year; withdrawn students are not promoted',
    module: 'institution-rollover',
    category: 'grade',
    severity: 'high',
    source: 'PRC-M525 re-check inside the transaction; ENROLLED filter',
  },
  {
    id: 'graduation-terminal-only',
    title: 'Only students of the highest grade (not retained) graduate',
    module: 'institution-rollover',
    category: 'grade',
    severity: 'high',
    source: 'PRC-M280 only a genuine terminal grade graduates',
  },
  {
    id: 'summary-matches',
    title: 'The rollover summary counts what the plan does',
    module: 'institution-rollover',
    category: 'grade',
    severity: 'medium',
    source: 'RolloverSummary',
  },
  {
    id: 'dry-run-no-writes',
    title: 'A dry run writes no enrollment or class',
    module: 'institution-rollover',
    category: 'grade',
    severity: 'high',
    source: 'RolloverRequestSchema dryRun (default true)',
  },
  ...COMMON_INVARIANTS('institution-rollover'),
];

interface MStudent {
  id: string;
  order: number;
  section: number;
  status: 'ENROLLED' | 'WITHDRAWN' | 'GRADUATED';
  enrollmentId: string;
}

export interface PromotionModel {
  students: MStudent[];
  retain: Set<string>;
  /** student -> target {order, section} */
  target: Map<string, { order: number; section: number }>;
}

export interface PromotionConfig {
  ladder: number;
  sections: number[];
  toString(): string;
}

export interface PromotionReal extends RealBase {
  pool: Pool;
  tenantId: string;
  db: Bound;
  service: AcademicCalendarService;
  institutionId: string;
  sourceId: string;
  targetId: string;
  sourceEnd: Date;
  grades: Array<{ id: string; order: number }>;
  /** order -> source class ids by section position */
  classes: Map<number, string[]>;
  config: PromotionConfig;
}

type Cmd = fc.AsyncCommand<PromotionModel, PromotionReal, boolean>;

const inTenant = <T>(r: { tenantId: string }, fn: () => Promise<T>) =>
  tenantContext.run({ tenantId: r.tenantId }, fn);

async function counts(r: PromotionReal) {
  return withPgTenant(r.pool, r.tenantId, async (c) => {
    const e = await c.query(`SELECT count(*)::int AS n FROM enrollments WHERE tenant_id = $1`, [
      r.tenantId,
    ]);
    const k = await c.query(`SELECT count(*)::int AS n FROM classes WHERE tenant_id = $1`, [
      r.tenantId,
    ]);
    const g = await c.query(
      `SELECT count(*)::int AS n FROM enrollments WHERE tenant_id = $1 AND status = 'GRADUATED'`,
      [r.tenantId],
    );
    const n = (res: { rows: unknown[] }) => Number((res.rows[0] as { n: number }).n);
    return { enrollments: n(e), classes: n(k), graduated: n(g) };
  });
}

abstract class PromotionCommand implements Cmd {
  abstract readonly name: string;
  check(_m: Readonly<PromotionModel>): boolean {
    return true;
  }
  protected abstract exec(m: PromotionModel, r: PromotionReal): Promise<boolean>;
  async run(m: PromotionModel, r: PromotionReal): Promise<void> {
    r.stats.note(this.name, await this.exec(m, r));
  }
  abstract toString(): string;
}

class Enrol extends PromotionCommand {
  readonly name = 'Enrol';
  constructor(
    readonly gradeIdx: number,
    readonly sectionIdx: number,
  ) {
    super();
  }
  protected async exec(m: PromotionModel, r: PromotionReal) {
    const grade = pick(r.grades, this.gradeIdx)!;
    const sections = r.classes.get(grade.order)!;
    const section = this.sectionIdx % sections.length;
    const studentId = randomUUID();
    await ensurePgTestStudent(r.pool, r.tenantId, studentId);
    const got = await attempt(() =>
      inTenant(
        r,
        () =>
          r.db.enrollment.create({
            data: {
              tenantId: r.tenantId,
              studentId,
              institutionId: r.institutionId,
              gradeId: grade.id,
              classId: sections[section]!,
              academicPeriodId: r.sourceId,
              status: 'ENROLLED',
              enrolledAt: new Date('2026-01-05'),
            },
          }) as unknown as Promise<{ id: string }>,
      ),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'fixture' }, got)) return false;
    m.students.push({
      id: studentId,
      order: grade.order,
      section,
      status: 'ENROLLED',
      enrollmentId: got.value.id,
    });
    return true;
  }
  toString() {
    return `Enrol(grade#${this.gradeIdx}, section#${this.sectionIdx})`;
  }
}

class Withdraw extends PromotionCommand {
  readonly name = 'Withdraw';
  constructor(readonly studentIdx: number) {
    super();
  }
  check(m: Readonly<PromotionModel>) {
    return m.students.some((s) => s.status === 'ENROLLED');
  }
  protected async exec(m: PromotionModel, r: PromotionReal) {
    const s = pick(
      m.students.filter((x) => x.status === 'ENROLLED'),
      this.studentIdx,
    )!;
    const got = await attempt(() =>
      inTenant(
        r,
        () =>
          r.db.enrollment.updateMany({
            where: { id: s.enrollmentId, tenantId: r.tenantId },
            data: { status: 'WITHDRAWN', exitedAt: new Date('2026-06-01') },
          }) as unknown as Promise<unknown>,
      ),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'fixture' }, got)) return false;
    s.status = 'WITHDRAWN';
    return true;
  }
  toString() {
    return `Withdraw(student#${this.studentIdx})`;
  }
}

class Retain extends PromotionCommand {
  readonly name = 'Retain';
  constructor(readonly studentIdx: number) {
    super();
  }
  check(m: Readonly<PromotionModel>) {
    return m.students.length > 0;
  }
  protected exec(m: PromotionModel) {
    m.retain.add(pick(m.students, this.studentIdx)!.id);
    return Promise.resolve(true);
  }
  toString() {
    return `Retain(student#${this.studentIdx})`;
  }
}

class Rollover extends PromotionCommand {
  readonly name: string;
  constructor(readonly dryRun: boolean) {
    super();
    this.name = dryRun ? 'RolloverDryRun' : 'Rollover';
  }
  protected async exec(m: PromotionModel, r: PromotionReal) {
    const top = r.config.ladder;
    const enrolled = m.students.filter((s) => s.status === 'ENROLLED');
    const fresh = enrolled.filter((s) => !m.target.has(s.id));
    const retained = fresh.filter((s) => m.retain.has(s.id));
    const promote = fresh.filter((s) => !m.retain.has(s.id) && s.order < top);
    const graduate = fresh.filter((s) => !m.retain.has(s.id) && s.order === top);
    const before = await counts(r);
    const got = await attempt(() =>
      inTenant(r, () =>
        r.service.rollover(
          r.tenantId,
          r.sourceId,
          {
            targetPeriodId: r.targetId,
            promoteEnrollments: true,
            dryRun: this.dryRun,
            retainStudentIds: [...m.retain],
          },
          'registrar-1',
        ),
      ),
    );
    // A student whose section position does not exist in the target grade
    // cannot keep the position (enrollments_enrolled_requires_class needs a
    // class). Either a clear refusal or a placement in that grade is correct.
    const hasSection = (order: number, section: number) =>
      (r.config.sections[order - 1] ?? 0) > section;
    const needsPlacement =
      !this.dryRun &&
      [
        ...promote.map((s) => [s.order + 1, s.section]),
        ...retained.map((s) => [s.order, s.section]),
      ].some(([o, sec]) => !hasSection(o!, sec!));
    if (needsPlacement && !got.ok && got.kind === 'rejected') return false;
    if (!agree(r.log, String(this), { accept: true, why: 'valid ladder and periods' }, got))
      return false;
    const e = got.value.enrollments;
    const exp = {
      considered: enrolled.length,
      alreadyInTarget: enrolled.length - fresh.length,
      toPromote: promote.length,
      toRetain: retained.length,
      graduating: graduate.length,
      promoted: this.dryRun ? 0 : promote.length,
      retained: this.dryRun ? 0 : retained.length,
    };
    const gotCounts = {
      considered: e.considered,
      alreadyInTarget: e.alreadyInTarget,
      toPromote: e.toPromote,
      toRetain: e.toRetain,
      graduating: e.graduating,
      promoted: e.promoted,
      retained: e.retained,
    };
    r.log.check(
      'summary-matches',
      JSON.stringify(gotCounts) === JSON.stringify(exp),
      () =>
        `${String(this)}: summary ${JSON.stringify(gotCounts)}, expected ${JSON.stringify(exp)}`,
    );
    const after = await counts(r);
    if (this.dryRun) {
      r.log.check(
        'dry-run-no-writes',
        JSON.stringify(before) === JSON.stringify(after),
        () => `dry run changed counts ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
      return true;
    }
    for (const s of promote) m.target.set(s.id, { order: s.order + 1, section: s.section });
    for (const s of retained) m.target.set(s.id, { order: s.order, section: s.section });
    for (const s of graduate) s.status = 'GRADUATED';
    await checkTarget(m, r);
    return true;
  }
  toString() {
    return `Rollover(${this.dryRun ? 'dry run' : 'real'})`;
  }
}

async function checkTarget(m: PromotionModel, r: PromotionReal): Promise<void> {
  const rows = await withPgTenant(r.pool, r.tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT e.student_id, e.academic_period_id, e.status, g."order" AS grade_order,
              cl.name AS class_name, cg."order" AS class_grade_order
         FROM enrollments e
         JOIN grades g ON g.id = e.grade_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         LEFT JOIN grades cg ON cg.id = cl.grade_id
        WHERE e.tenant_id = $1`,
      [r.tenantId],
    );
    return rows as Array<Record<string, unknown>>;
  });
  const target = rows.filter((x) => x.academic_period_id === r.targetId);
  const perStudent = new Map<string, number>();
  for (const t of target)
    perStudent.set(String(t.student_id), (perStudent.get(String(t.student_id)) ?? 0) + 1);
  for (const [sid, n] of perStudent) {
    const s = m.students.find((x) => x.id === sid);
    // A student withdrawn after the rollover keeps the target row; one withdrawn
    // before it has no model target and is caught below.
    r.log.check(
      'promotion-once',
      n === 1 && s !== undefined,
      () =>
        `student ${sid.slice(0, 8)} has ${n} target enrollment(s); source status ${String(s?.status)}`,
    );
  }
  for (const s of m.students) {
    const exp = m.target.get(s.id);
    const row = target.find((t) => t.student_id === s.id);
    if (!exp) {
      r.log.check(
        'promotion-once',
        row === undefined,
        () => `student ${s.id.slice(0, 8)} (${s.status}) unexpectedly enrolled in target`,
      );
      continue;
    }
    // Same section position in the target grade; without that position any
    // section of the target grade is a valid placement.
    const hasSection = (r.config.sections[exp.order - 1] ?? 0) > exp.section;
    const expectedClass = hasSection ? `${exp.order}-${'AB'.charAt(exp.section)}` : null;
    r.log.check(
      'promotion-follows-ladder',
      row !== undefined &&
        Number(row.grade_order) === exp.order &&
        row.class_name != null &&
        (expectedClass === null || row.class_name === expectedClass) &&
        Number(row.class_grade_order) === exp.order,
      () =>
        `student from ${s.order}-${'AB'.charAt(s.section)} expected in ${String(expectedClass)}, got grade ${String(row?.grade_order)} class ${String(row?.class_name)}`,
    );
  }
  const graduated = rows.filter(
    (x) => x.academic_period_id === r.sourceId && x.status === 'GRADUATED',
  );
  for (const g of graduated) {
    const s = m.students.find((x) => x.id === g.student_id);
    r.log.check(
      'graduation-terminal-only',
      Number(g.grade_order) === r.config.ladder && s?.status === 'GRADUATED',
      () =>
        `student ${String(g.student_id).slice(0, 8)} graduated from grade ${String(g.grade_order)} of ${r.config.ladder} (model ${String(s?.status)})`,
    );
  }
  r.log.check(
    'graduation-terminal-only',
    graduated.length === m.students.filter((s) => s.status === 'GRADUATED').length,
    () =>
      `${graduated.length} GRADUATED rows, model ${m.students.filter((s) => s.status === 'GRADUATED').length}`,
  );
}

const idx = fc.nat({ max: 40 });

function weighted<T>(pairs: Array<[fc.Arbitrary<T>, number]>): Array<fc.Arbitrary<T>> {
  return pairs.flatMap(([a, w]) => Array.from({ length: w }, () => a));
}

export const promotionCommands: Array<fc.Arbitrary<Cmd>> = weighted<Cmd>([
  [fc.tuple(idx, idx).map(([g, s]) => new Enrol(g, s)), 5],
  [idx.map((s) => new Withdraw(s)), 1],
  [idx.map((s) => new Retain(s)), 1],
  [fc.boolean().map((d) => new Rollover(d)), 2],
]);

export function promotionSpec(): DomainSpec<PromotionModel, PromotionReal, PromotionConfig> {
  return {
    domain: 'promotion',
    invariants: PROMOTION_INVARIANTS,
    commands: promotionCommands,
    config: fc.integer({ min: 1, max: 4 }).chain((ladder) =>
      fc
        .array(fc.integer({ min: 1, max: 2 }), { minLength: ladder, maxLength: ladder })
        .map((sections) => ({
          ladder,
          sections,
          toString: () => `ladder ${ladder} grades, sections ${JSON.stringify(sections)}`,
        })),
    ),
    maxCommands: 20,
    async setup(log: ViolationLog, stats: CommandStats, config: PromotionConfig) {
      const pool = getSharedPgPool();
      if (!pool) throw new Error('DATABASE_URL is required for the promotion property');
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);
      const institutionId = randomUUID();
      const areaId = randomUUID();
      await withPgTenant(pool, tenantId, async (c) => {
        await c.query(
          `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
           VALUES ($1, $2, 'Prop District', $3, 1, NULL, $4, 1, 2)`,
          [areaId, tenantId, `AREA-${areaId.slice(0, 8)}`, `/${areaId}`],
        );
        await c.query(
          `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
           VALUES ($1, $2, 'Prop School', $3, $4, 'primary', 'public', 'government', 'active')`,
          [institutionId, tenantId, `PS-${institutionId.slice(0, 8)}`, areaId],
        );
      });
      const db = createTenantBoundPrisma(sharedPrisma());
      const r0 = { tenantId };
      const periods = new AcademicPeriodService({ prisma: db });
      const tag = randomUUID().slice(0, 8);
      const source = await inTenant(r0, () =>
        periods.create(tenantId, {
          name: 'Year 1',
          code: `Y1-${tag}`,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      );
      const target = await inTenant(r0, () =>
        periods.create(tenantId, {
          name: 'Year 2',
          code: `Y2-${tag}`,
          startDate: '2027-01-01',
          endDate: '2027-12-31',
        }),
      );
      const grades: Array<{ id: string; order: number }> = [];
      const classes = new Map<number, string[]>();
      for (let order = 1; order <= config.ladder; order += 1) {
        const g = (await inTenant(
          r0,
          () =>
            db.grade.create({
              data: { tenantId, name: `Grade ${order}`, code: `G${order}-${tag}`, order },
            }) as unknown as Promise<{ id: string }>,
        )) as { id: string };
        grades.push({ id: g.id, order });
        const ids: string[] = [];
        for (let s = 0; s < config.sections[order - 1]!; s += 1) {
          const cl = (await inTenant(
            r0,
            () =>
              db.class.create({
                data: {
                  tenantId,
                  institutionId,
                  gradeId: g.id,
                  academicPeriodId: source.id,
                  name: `${order}-${'AB'.charAt(s)}`,
                },
              }) as unknown as Promise<{ id: string }>,
          )) as { id: string };
          ids.push(cl.id);
        }
        classes.set(order, ids);
      }
      const service = new AcademicCalendarService({
        prisma: db,
        store: new PgCalendarStore(pool as never),
      });
      return {
        model: { students: [], retain: new Set(), target: new Map() },
        real: {
          log,
          stats,
          pool,
          tenantId,
          db,
          service,
          institutionId,
          sourceId: source.id,
          targetId: target.id,
          sourceEnd: new Date('2026-12-31'),
          grades,
          classes,
          config,
        },
      };
    },
  };
}
