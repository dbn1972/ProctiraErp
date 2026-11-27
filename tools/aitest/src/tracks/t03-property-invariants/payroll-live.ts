/**
 * Payroll commands against the live backend: `StaffHrService` over
 * `PgStaffHrStore`, `StaffService` over `PrismaStaffRepository` and approved
 * unpaid leave from `PgStaffLeaveRepository`, wired as staff-plugin.ts does.
 * Each property run uses a fresh random tenant and a random
 * PAYROLL_PRORATION / PAYROLL_LOP_DIVISOR configuration.
 */
import { randomUUID } from 'node:crypto';

import {
  PgStaffHrStore,
  PgStaffLeaveRepository,
  PrismaStaffRepository,
  StaffHrService,
  StaffLeaveService,
  StaffService,
  type PayrollExportResult,
} from '@proctira/backend-staff';
import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import fc from 'fast-check';

import { agree, attempt, pick, type CommandStats, type ViolationLog } from './core.js';
import {
  emptyPayrollModel,
  monthDates,
  oracleRun,
  PAYROLL_INVARIANTS,
  type Divisor,
  type Mark,
  type PayrollModel,
  type Proration,
} from './payroll-model.js';
import type { DomainSpec, RealBase } from './runner.js';

type Pool = NonNullable<ReturnType<typeof getSharedPgPool>>;
type Prisma = ReturnType<typeof createPrismaClient>;

export interface PayrollReal extends RealBase {
  pool: Pool;
  tenantId: string;
  staffService: StaffService;
  hr: StaffHrService;
  leave: StaffLeaveService;
}

type Cmd = fc.AsyncCommand<PayrollModel, PayrollReal, boolean>;

/** Months include a leap February and a 31-day month; all are in the past. */
export const PAYROLL_MONTHS = ['2024-02', '2026-01', '2026-02', '2026-04'] as const;

let prisma: Prisma | null = null;
function sharedPrisma(): Prisma {
  prisma ??= createPrismaClient({ datasourceUrl: process.env['DATABASE_URL']! });
  return prisma;
}
export async function closePayrollPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = null;
}

interface RunRow {
  id: string;
  month: string;
  status: string;
  gross: number;
  deductions: number;
  net: number;
  reverses: string | null;
  replaces: string | null;
  lines: Array<{ staffId: string; grossCents: number; deductionsCents: number; netCents: number }>;
  trial: { debitCents: number; creditCents: number; accounts?: Record<string, number> };
}

async function loadRuns(pool: Pool, tenantId: string): Promise<RunRow[]> {
  return withPgTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT id, month, status, gross_cents, deductions_cents, net_cents, reverses_run_id,
              replaces_run_id, lines_json, trial_balance_json
         FROM staff_payroll_runs WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      month: String(r.month),
      status: String(r.status),
      gross: Number(r.gross_cents),
      deductions: Number(r.deductions_cents),
      net: Number(r.net_cents),
      reverses: r.reverses_run_id == null ? null : String(r.reverses_run_id),
      replaces: r.replaces_run_id == null ? null : String(r.replaces_run_id),
      lines: (r.lines_json ?? []) as RunRow['lines'],
      trial: (r.trial_balance_json ?? {}) as RunRow['trial'],
    }));
  });
}

/** Database-level run invariants after every command. */
async function checkRuns(m: PayrollModel, r: PayrollReal): Promise<void> {
  const runs = await loadRuns(r.pool, r.tenantId);
  const reversed = new Set(runs.filter((x) => x.status === 'reversal').map((x) => x.reverses));
  for (const month of new Set(runs.map((x) => x.month))) {
    const current = runs.filter(
      (x) => x.month === month && x.status === 'posted' && !reversed.has(x.id),
    );
    r.log.check(
      'posted-once-per-month',
      current.length <= 1 && (current[0]?.id ?? null) === (m.posted.get(month) ?? null),
      () =>
        `month ${month}: ${current.length} current posted run(s) ${current.map((x) => x.id.slice(0, 8)).join(',')}, model ${m.posted.get(month)?.slice(0, 8) ?? 'none'}`,
    );
  }
  for (const run of runs) {
    if (run.status === 'reversal') {
      const target = runs.find((x) => x.id === run.reverses);
      r.log.check(
        'posted-once-per-month',
        target !== undefined &&
          target.status === 'posted' &&
          target.month === run.month &&
          target.gross === run.gross &&
          target.net === run.net,
        () => `reversal ${run.id.slice(0, 8)} does not mirror a posted run of ${run.month}`,
      );
      continue;
    }
    if (run.replaces) {
      r.log.check(
        'posted-once-per-month',
        reversed.has(run.replaces),
        () =>
          `replacement ${run.id.slice(0, 8)} replaces ${String(run.replaces?.slice(0, 8))} which was never reversed`,
      );
    }
    const sum = (k: 'grossCents' | 'deductionsCents' | 'netCents') =>
      run.lines.reduce((s, l) => s + l[k], 0);
    r.log.check(
      'run-totals-balance',
      run.gross === sum('grossCents') &&
        run.deductions === sum('deductionsCents') &&
        run.net === sum('netCents') &&
        run.trial.debitCents === run.trial.creditCents &&
        run.trial.debitCents === run.gross,
      () =>
        `run ${run.month}: stored ${run.gross}/${run.deductions}/${run.net} vs lines ${sum('grossCents')}/${sum('deductionsCents')}/${sum('netCents')}, trial ${run.trial.debitCents}/${run.trial.creditCents}`,
    );
    r.log.check(
      'net-equals-gross-minus-deductions',
      run.net === run.gross - run.deductions,
      () => `run ${run.month}: net ${run.net} != ${run.gross} - ${run.deductions}`,
    );
  }
}

abstract class PayrollCommand implements Cmd {
  abstract readonly name: string;
  check(_m: Readonly<PayrollModel>): boolean {
    return true;
  }
  protected abstract exec(m: PayrollModel, r: PayrollReal): Promise<boolean>;
  async run(m: PayrollModel, r: PayrollReal): Promise<void> {
    const accepted = await this.exec(m, r);
    r.stats.note(this.name, accepted);
    await checkRuns(m, r);
  }
  abstract toString(): string;
}

class AddStaff extends PayrollCommand {
  readonly name = 'AddStaff';
  constructor(readonly grossCents: number) {
    super();
  }
  protected async exec(m: PayrollModel, r: PayrollReal) {
    const staff = await attempt(() =>
      r.staffService.create(r.tenantId, {
        firstName: 'Prop',
        lastName: `Staff${m.staff.length + 1}`,
        dateOfBirth: '1985-05-05',
        identityNumber: `T03-${randomUUID().slice(0, 12)}`,
        contactPhone: '+15550000000',
        position: 'Teacher',
      }),
    );
    if (!agree(r.log, `${String(this)} staff`, { accept: true, why: 'valid staff' }, staff)) {
      return false;
    }
    const contract = await attempt(() =>
      r.hr.createContract(r.tenantId, {
        staffId: staff.value.id,
        contractType: 'permanent',
        startDate: '2020-01-01',
        monthlyGrossCents: this.grossCents,
      }),
    );
    if (
      !agree(r.log, `${String(this)} contract`, { accept: true, why: 'valid contract' }, contract)
    ) {
      return false;
    }
    m.staff.push({ id: staff.value.id, grossCents: this.grossCents, offboardDate: null });
    return true;
  }
  toString() {
    return `AddStaff(${this.grossCents})`;
  }
}

class MarkAttendance extends PayrollCommand {
  readonly name = 'MarkAttendance';
  constructor(
    readonly staffIdx: number,
    readonly monthIdx: number,
    readonly day: number,
    readonly mark: Mark,
  ) {
    super();
  }
  check(m: Readonly<PayrollModel>) {
    return m.staff.length > 0;
  }
  protected async exec(m: PayrollModel, r: PayrollReal) {
    const s = pick(m.staff, this.staffIdx)!;
    const dates = monthDates(pick(PAYROLL_MONTHS, this.monthIdx)!);
    const date = dates[this.day % dates.length]!;
    const got = await attempt(() =>
      r.hr.markAttendance(r.tenantId, { staffId: s.id, date, status: this.mark }, 'hr-admin'),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'past date, existing staff' }, got)) {
      return false;
    }
    const map = m.attendance.get(s.id) ?? new Map<string, Mark>();
    map.set(date, this.mark);
    m.attendance.set(s.id, map);
    return true;
  }
  toString() {
    return `MarkAttendance(staff#${this.staffIdx}, month#${this.monthIdx}, day ${this.day}, ${this.mark})`;
  }
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

class UnpaidLeave extends PayrollCommand {
  readonly name = 'UnpaidLeave';
  constructor(
    readonly staffIdx: number,
    readonly monthIdx: number,
    readonly day: number,
    readonly length: number,
  ) {
    super();
  }
  check(m: Readonly<PayrollModel>) {
    return m.staff.length > 0;
  }
  protected async exec(m: PayrollModel, r: PayrollReal) {
    const s = pick(m.staff, this.staffIdx)!;
    const dates = monthDates(pick(PAYROLL_MONTHS, this.monthIdx)!);
    const start = dates[this.day % dates.length]!;
    const end = addDays(start, this.length - 1);
    const overlaps = m.unpaidLeave.some(
      (l) => l.staffId === s.id && l.start <= end && start <= l.end,
    );
    const created = await attempt(() =>
      r.leave.createLeave(r.tenantId, {
        staffId: s.id,
        leaveType: 'unpaid',
        startDate: start,
        endDate: end,
        reason: 'aitest',
      }),
    );
    const why = `overlaps an approved leave: ${overlaps}`;
    if (!agree(r.log, `${String(this)} request`, { accept: !overlaps, why }, created)) return false;
    const decided = await attempt(() =>
      r.leave.decideLeave(r.tenantId, created.value.id, { status: 'approved' }, 'hr-admin'),
    );
    if (!agree(r.log, `${String(this)} approve`, { accept: true, why: 'pending leave' }, decided)) {
      return false;
    }
    m.unpaidLeave.push({ staffId: s.id, start, end });
    return true;
  }
  toString() {
    return `UnpaidLeave(staff#${this.staffIdx}, month#${this.monthIdx}, day ${this.day}, ${this.length} days)`;
  }
}

class Offboard extends PayrollCommand {
  readonly name = 'Offboard';
  constructor(
    readonly staffIdx: number,
    readonly monthIdx: number,
    readonly day: number,
  ) {
    super();
  }
  check(m: Readonly<PayrollModel>) {
    return m.staff.length > 0;
  }
  protected async exec(m: PayrollModel, r: PayrollReal) {
    const s = pick(m.staff, this.staffIdx)!;
    const dates = monthDates(pick(PAYROLL_MONTHS, this.monthIdx)!);
    const date = dates[this.day % dates.length]!;
    const got = await attempt(() =>
      r.staffService.offboard(r.tenantId, s.id, { effectiveDate: date }, 'hr-admin'),
    );
    const accept = s.offboardDate === null;
    if (
      !agree(
        r.log,
        String(this),
        { accept, why: `already offboarded ${String(s.offboardDate)}` },
        got,
      )
    ) {
      return false;
    }
    s.offboardDate = date;
    return true;
  }
  toString() {
    return `Offboard(staff#${this.staffIdx}, month#${this.monthIdx}, day ${this.day})`;
  }
}

function compareRows(
  m: PayrollModel,
  r: PayrollReal,
  month: string,
  res: PayrollExportResult,
  label: string,
): void {
  const expected = oracleRun(m, month);
  const got = new Map(res.rows.map((x) => [x.staffId, x]));
  const exp = new Map(expected.map((x) => [x.staffId, x]));
  r.log.check(
    'eligibility',
    got.size === exp.size && [...exp.keys()].every((k) => got.has(k)),
    () =>
      `${label}: paid ${got.size} staff, expected ${exp.size} (offboarded before ${month}-01 excluded)`,
  );
  for (const row of res.rows) {
    const s = m.staff.find((x) => x.id === row.staffId);
    r.log.check(
      'net-equals-gross-minus-deductions',
      row.netCents === row.grossCents - row.deductionsCents,
      () => `${label}: net ${row.netCents} != ${row.grossCents} - ${row.deductionsCents}`,
    );
    r.log.check(
      'deductions-within-gross',
      row.deductionsCents >= 0 &&
        row.deductionsCents <= row.grossCents &&
        (s === undefined || row.grossCents <= s.grossCents),
      () =>
        `${label}: gross ${row.grossCents} (contract ${String(s?.grossCents)}), deductions ${row.deductionsCents}`,
    );
    const e = exp.get(row.staffId);
    if (!e) continue;
    r.log.check(
      'proration-matches-policy',
      row.grossCents === e.grossCents,
      () =>
        `${label} [${m.proration}]: gross ${row.grossCents}, expected ${e.grossCents} (contract ${String(s?.grossCents)}, last day ${String(s?.offboardDate)})`,
    );
    if (row.grossCents !== e.grossCents) continue;
    const double = row.deductionsCents > e.deductionsCents;
    r.log.check(
      double ? 'no-double-lop' : 'lop-matches-policy',
      row.deductionsCents === e.deductionsCents,
      () =>
        `${label} [${m.divisor}]: deductions ${row.deductionsCents}, expected ${e.deductionsCents} for ${e.halfDays / 2} LOP day(s) (gross ${row.grossCents})`,
    );
  }
}

class Post extends PayrollCommand {
  readonly name: string;
  constructor(
    readonly monthIdx: number,
    readonly replace: boolean,
  ) {
    super();
    this.name = replace ? 'Replace' : 'Post';
  }
  protected async exec(m: PayrollModel, r: PayrollReal) {
    const month = pick(PAYROLL_MONTHS, this.monthIdx)!;
    const before = m.posted.get(month);
    const got = await attempt(() =>
      r.hr.exportPayroll(
        r.tenantId,
        { month, ...(this.replace ? { replace: true } : {}) },
        'hr-admin',
      ),
    );
    if (!agree(r.log, String(this), { accept: true, why: 'export never refuses' }, got))
      return false;
    const res = got.value;
    if (!this.replace && before) {
      r.log.check(
        'idempotent-repost',
        res.idempotent && res.runId === before,
        () =>
          `${String(this)}: re-post returned run ${res.runId.slice(0, 8)} idempotent ${res.idempotent}, stored ${before.slice(0, 8)}`,
      );
      return true;
    }
    r.log.check(
      'idempotent-repost',
      !res.idempotent && res.runId !== before,
      () => `${String(this)}: expected a new run, got idempotent ${res.idempotent}`,
    );
    compareRows(m, r, month, res, `${String(this)} ${month}`);
    m.posted.set(month, res.runId);
    return true;
  }
  toString() {
    return `${this.name}(month#${this.monthIdx})`;
  }
}

const idx = fc.nat({ max: 40 });
const gross = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 1_000_000, max: 15_000_000 }) },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: 99_999 }) },
  { weight: 1, arbitrary: fc.constant(0) },
);

function weighted<T>(pairs: Array<[fc.Arbitrary<T>, number]>): Array<fc.Arbitrary<T>> {
  return pairs.flatMap(([a, w]) => Array.from({ length: w }, () => a));
}

export const payrollCommands: Array<fc.Arbitrary<Cmd>> = weighted<Cmd>([
  [gross.map((g) => new AddStaff(g)), 2],
  [
    fc
      .tuple(
        idx,
        idx,
        fc.nat({ max: 30 }),
        fc.constantFrom<Mark>('present', 'absent', 'absent', 'half_day', 'leave'),
      )
      .map(([s, mo, d, mk]) => new MarkAttendance(s, mo, d, mk)),
    6,
  ],
  [
    fc
      .tuple(idx, idx, fc.nat({ max: 30 }), fc.integer({ min: 1, max: 12 }))
      .map(([s, mo, d, n]) => new UnpaidLeave(s, mo, d, n)),
    2,
  ],
  [fc.tuple(idx, idx, fc.nat({ max: 30 })).map(([s, mo, d]) => new Offboard(s, mo, d)), 1],
  [idx.map((mo) => new Post(mo, false)), 2],
  [idx.map((mo) => new Post(mo, true)), 2],
]);

export interface PayrollConfig {
  proration: Proration;
  divisor: Divisor;
  toString(): string;
}

export function payrollSpec(): DomainSpec<PayrollModel, PayrollReal, PayrollConfig> {
  return {
    domain: 'payroll',
    invariants: PAYROLL_INVARIANTS,
    commands: payrollCommands,
    config: fc
      .tuple(
        fc.constantFrom<Proration>('calendar_days', 'working_days', 'full_month'),
        fc.constantFrom<Divisor>('calendar_days', 'thirty', 'working_days'),
      )
      .map(([proration, divisor]) => ({
        proration,
        divisor,
        toString: () => `PAYROLL_PRORATION=${proration} PAYROLL_LOP_DIVISOR=${divisor}`,
      })),
    maxCommands: 30,
    async setup(log: ViolationLog, stats: CommandStats, config: PayrollConfig) {
      const pool = getSharedPgPool();
      if (!pool) throw new Error('DATABASE_URL is required for the payroll property');
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);
      const staffService = new StaffService(new PrismaStaffRepository(sharedPrisma()));
      const leaveRepo = new PgStaffLeaveRepository(pool);
      const hr = new StaffHrService(new PgStaffHrStore(pool), staffService, {
        payrollProration: config.proration,
        lopDivisor: config.divisor,
        unpaidLeaveSource: leaveRepo,
      });
      const leave = new StaffLeaveService(leaveRepo);
      return {
        model: emptyPayrollModel(config.proration, config.divisor),
        real: { log, stats, pool, tenantId, staffService, hr, leave },
      };
    },
  };
}
