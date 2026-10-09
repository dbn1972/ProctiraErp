/**
 * PRC-M590 — ReDoS guard for user-defined custom-field regex patterns.
 */
import { describe, expect, it } from 'vitest';

import {
  isPotentiallyCatastrophic,
  MAX_INPUT_LENGTH,
  MAX_PATTERN_LENGTH,
  safeRegexTest,
} from './safe-regex-guard.js';

describe('safeRegexTest (PRC-M590)', () => {
  it('matches a safe pattern', () => {
    const r = safeRegexTest('^[A-Z]{3}-\\d{4}$', 'ABC-1234');
    expect(r).toEqual({ ok: true, matches: true });
  });

  it('reports non-match for a safe pattern', () => {
    const r = safeRegexTest('^[A-Z]{3}$', 'abc');
    expect(r).toEqual({ ok: true, matches: false });
  });

  it('rejects a classic catastrophic-backtracking pattern (nested quantifiers)', () => {
    const r = safeRegexTest('(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!');
    expect(r).toEqual({ ok: false, reason: 'unsafe-pattern' });
  });

  it('rejects (.*)* style patterns', () => {
    expect(safeRegexTest('(.*)*$', 'x').ok).toBe(false);
  });

  it('rejects adjacent unbounded quantifiers', () => {
    expect(safeRegexTest('a+*', 'a').ok).toBe(false);
  });

  it('rejects an over-long pattern', () => {
    const r = safeRegexTest('a'.repeat(MAX_PATTERN_LENGTH + 1), 'a');
    expect(r).toEqual({ ok: false, reason: 'pattern-too-long' });
  });

  it('rejects an over-long input', () => {
    const r = safeRegexTest('^a+$', 'a'.repeat(MAX_INPUT_LENGTH + 1));
    expect(r).toEqual({ ok: false, reason: 'input-too-long' });
  });

  it('rejects an invalid pattern (fail closed, not skipped)', () => {
    const r = safeRegexTest('(', 'x');
    expect(r).toEqual({ ok: false, reason: 'invalid-pattern' });
  });

  it('completes quickly on the known ReDoS input (guard short-circuits)', () => {
    const start = Date.now();
    safeRegexTest('(a+)+$', `${'a'.repeat(40)}X`);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('isPotentiallyCatastrophic flags nested quantified groups', () => {
    expect(isPotentiallyCatastrophic('(\\d+)+')).toBe(true);
    expect(isPotentiallyCatastrophic('(?:ab+)*')).toBe(true);
    expect(isPotentiallyCatastrophic('^[a-z]{2,5}$')).toBe(false);
  });
});
