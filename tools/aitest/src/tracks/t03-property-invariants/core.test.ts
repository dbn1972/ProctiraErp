import { describe, expect, it } from 'vitest';
import {
  agree,
  attempt,
  caseId,
  commandName,
  CommandStats,
  InvariantError,
  isDomainRejection,
  pick,
  ViolationLog,
} from './core.js';

class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}

describe('t03 core', () => {
  it('observe mode counts violations without throwing', () => {
    const log = new ViolationLog(new Set(['a', 'b']));
    log.check('a', true, () => 'never');
    log.check('a', false, () => 'first');
    log.check('a', false, () => 'second');
    expect(log.violations.get('a')).toEqual({ count: 2, firstDetail: 'first' });
    expect(log.violations.has('b')).toBe(false);
    expect(() => log.check('zzz', true, () => '')).toThrow(/unknown invariant/);
  });

  it('focus mode throws only for the focused invariant', () => {
    const log = new ViolationLog(new Set(['a', 'b']), 'b');
    expect(() => log.check('a', false, () => 'ignored')).not.toThrow();
    expect(() => log.check('b', false, () => 'boom')).toThrow(InvariantError);
    expect(log.violations.size).toBe(0);
  });

  it('accepts per-command unexpected-error invariants', () => {
    const log = new ViolationLog(new Set(['model-agreement']));
    log.check('no-unexpected-error:Pay', false, () => 'x');
    expect(log.violations.get('no-unexpected-error:Pay')?.count).toBe(1);
  });

  it('classifies domain rejections and unexpected errors', async () => {
    expect(isDomainRejection(new BusinessRuleError('no'))).toBe(true);
    expect(isDomainRejection(Object.assign(new Error('x'), { statusCode: 409 }))).toBe(true);
    expect(isDomainRejection(new TypeError('bug'))).toBe(false);
    expect(await attempt(async () => 1)).toEqual({ ok: true, value: 1 });
    const rej = await attempt(async () => {
      throw new BusinessRuleError('refused');
    });
    expect(rej.ok === false && rej.kind).toBe('rejected');
    const bad = await attempt(async () => {
      throw new Error('duplicate key value violates unique constraint');
    });
    expect(bad.ok === false && bad.kind).toBe('unexpected');
  });

  it('agree records model disagreement and unexpected errors per command', async () => {
    const log = new ViolationLog(new Set(['model-agreement']));
    expect(agree(log, 'Pay(inv#0)', { accept: true, why: 'w' }, { ok: true, value: 1 })).toBe(true);
    const rejected = await attempt(async () => {
      throw new BusinessRuleError('no');
    });
    expect(agree(log, 'Pay(inv#0)', { accept: true, why: 'open' }, rejected)).toBe(false);
    expect(log.violations.get('model-agreement')?.firstDetail).toMatch(/expected accept \(open\)/);
    const crash = await attempt(async () => {
      throw new Error('23505');
    });
    expect(agree(log, 'Replace(month#1)', { accept: true, why: '' }, crash)).toBe(false);
    expect(log.violations.has('no-unexpected-error:Replace')).toBe(true);
  });

  it('helpers', () => {
    expect(caseId('fees', 'ledger-balanced')).toBe('prop:fees:ledger-balanced');
    expect(pick([1, 2, 3], 7)).toBe(2);
    expect(pick([], 1)).toBeUndefined();
    expect(commandName('Transition:submit(entry#1)')).toBe('Transition:submit');
    expect(commandName('ScholarshipNetting(new, 5)')).toBe('ScholarshipNetting');
    const a = new CommandStats();
    a.note('Pay', true);
    a.note('Pay', false);
    const b = new CommandStats();
    b.note('Pay', true);
    b.merge(a);
    expect(b.byCommand.get('Pay')).toEqual({ run: 3, accepted: 2 });
  });
});
