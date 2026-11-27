/**
 * t03 property-invariants core: invariant catalogue, violation log, outcome
 * classification and the shared helpers every domain model uses.
 *
 * A property run never stops on the first violated invariant (observe mode):
 * every invariant is checked after every command and violations are counted.
 * A violated invariant is then re-run in focus mode, where only that invariant
 * throws, so fast-check shrinks the command sequence to a minimal reproduction
 * of that one defect (see runner.ts).
 */

export type Domain = 'fees' | 'payroll' | 'grades' | 'promotion';

export interface InvariantMeta {
  /** Short id; the case id is `prop:<domain>:<id>`. */
  id: string;
  title: string;
  module: string;
  category: 'money' | 'grade' | 'other';
  /** Default triage severity when violated. */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Where the expected rule comes from (code comment, doc, brief). */
  source: string;
}

export function caseId(domain: Domain, invariant: string): string {
  return `prop:${domain}:${invariant}`;
}

export class InvariantError extends Error {
  constructor(
    readonly invariant: string,
    readonly detail: string,
  ) {
    super(`invariant ${invariant} violated: ${detail}`);
    this.name = 'InvariantError';
  }
}

export interface ViolationRecord {
  count: number;
  firstDetail: string;
  /** Command list (toString) of the run that first violated it, unshrunk. */
  firstRun?: string;
}

/**
 * Per-run violation sink. In observe mode it only records. In focus mode the
 * focused invariant throws InvariantError; other invariants are ignored so the
 * shrinker keeps reproducing the same defect.
 */
export class ViolationLog {
  readonly violations = new Map<string, ViolationRecord>();
  constructor(
    private readonly known: ReadonlySet<string>,
    private readonly focus: string | null = null,
  ) {}

  check(invariant: string, ok: boolean, detail: () => string): void {
    if (!this.known.has(invariant) && !invariant.startsWith(`${UNEXPECTED}:`)) {
      throw new Error(`unknown invariant ${invariant}`);
    }
    if (ok) return;
    const d = detail();
    if (this.focus !== null) {
      if (invariant === this.focus) throw new InvariantError(invariant, d);
      return;
    }
    const prior = this.violations.get(invariant);
    if (prior) prior.count += 1;
    else this.violations.set(invariant, { count: 1, firstDetail: d });
  }
}

/**
 * Unexpected (non-domain) errors are reported per command, as
 * `no-unexpected-error:<Command>`, so one known crash listed in
 * pending-fixes.json never hides a new crash in another command.
 */
export const UNEXPECTED = 'no-unexpected-error';

export function commandName(label: string): string {
  return /^([A-Za-z]+(?::[a-z]+)?)/.exec(label)?.[1] ?? 'command';
}

/** Outcome of calling the system under test. */
export type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'rejected'; error: Error }
  | { ok: false; kind: 'unexpected'; error: Error };

const DOMAIN_ERROR_NAMES = new Set([
  'BusinessRuleError',
  'NotFoundError',
  'ValidationError',
  'ConflictError',
  'ReferenceNotFoundError',
  'GradeLockedError',
  'PayrollRunAlreadyPostedError',
  'InsufficientLeaveBalanceError',
  'UnbalancedJournalError',
]);

/** A domain rejection is an AppError-style 4xx; anything else is unexpected. */
export function isDomainRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (DOMAIN_ERROR_NAMES.has(error.name) || DOMAIN_ERROR_NAMES.has(error.constructor.name)) {
    return true;
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return isDomainRejection(error)
      ? { ok: false, kind: 'rejected', error }
      : { ok: false, kind: 'unexpected', error };
  }
}

/**
 * Compare the model's expectation with what the service did. Records
 * `model-agreement` (accept vs reject) and `no-unexpected-error`. Returns true
 * when the service accepted the command (callers then apply the effect, so the
 * model follows reality and the sequence can continue after a disagreement).
 */
export function agree<T>(
  log: ViolationLog,
  label: string,
  expected: { accept: boolean; why: string },
  got: Attempt<T>,
): got is { ok: true; value: T } {
  if (!got.ok && got.kind === 'unexpected') {
    log.check(
      `${UNEXPECTED}:${commandName(label)}`,
      false,
      () => `${label}: ${got.error.message.slice(0, 600)}`,
    );
    return false;
  }
  const accepted = got.ok;
  log.check(
    'model-agreement',
    accepted === expected.accept,
    () =>
      `${label}: model expected ${expected.accept ? 'accept' : 'reject'} (${expected.why}), service ${
        accepted ? 'accepted' : `rejected: ${(got as { error: Error }).error.message.slice(0, 200)}`
      }`,
  );
  return accepted;
}

/** Deterministic pick of an element by a generated index (index modulo length). */
export function pick<T>(list: readonly T[], index: number): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.abs(index) % list.length];
}

/** Command call counters for the coverage report. */
export class CommandStats {
  readonly byCommand = new Map<string, { run: number; accepted: number }>();
  note(name: string, accepted: boolean): void {
    const row = this.byCommand.get(name) ?? { run: 0, accepted: 0 };
    row.run += 1;
    if (accepted) row.accepted += 1;
    this.byCommand.set(name, row);
  }
  merge(other: CommandStats): void {
    for (const [k, v] of other.byCommand) {
      const row = this.byCommand.get(k) ?? { run: 0, accepted: 0 };
      row.run += v.run;
      row.accepted += v.accepted;
      this.byCommand.set(k, row);
    }
  }
}

/** Invariants every domain carries. */
export const COMMON_INVARIANTS = (module: string): InvariantMeta[] => [
  {
    id: 'model-agreement',
    title: 'Service accepts exactly the operations the business rules allow',
    module,
    category: module === 'fees' || module === 'staff-payroll' ? 'money' : 'grade',
    severity: 'medium',
    source: 'service doc comments and BRIEF rules, re-implemented in the model',
  },
  {
    id: UNEXPECTED,
    title:
      'No operation fails with an unexpected (non-domain) error; per-command cases no-unexpected-error:<Command> carry known crashes',
    module,
    category: 'other',
    severity: 'medium',
    source: 'services raise typed domain errors (4xx) for refused operations',
  },
];
