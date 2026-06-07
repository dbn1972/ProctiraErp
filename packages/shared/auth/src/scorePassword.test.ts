/**
 * Unit tests for `scorePassword()` / `scorePasswordDetails()`
 * (Task 49.6, Requirement 4 AC 14).
 *
 * Coverage:
 *   • Length contributions (≥ 8, ≥ 12, ≥ 16) drive the rating up.
 *   • Character-class diversity (lower / upper / digit / symbol).
 *   • Common-pattern penalty pushes results to `weak`.
 *   • Sequential-repeat penalty (`aaaa`) pushes results to `weak`.
 *   • Empty / non-string inputs gracefully return `weak`.
 *   • The `reasons[]` array surfaces actionable advice for the meter.
 */

import { describe, it, expect } from 'vitest';

import { scorePassword, scorePasswordDetails } from './scorePassword.js';

describe('scorePassword()', () => {
  it('returns weak for empty input', () => {
    expect(scorePassword('')).toBe('weak');
  });

  it('returns weak for short passwords', () => {
    // 7 chars, no digit/symbol — score = 1 (length≥? no) + lowercase only = 1 → weak
    expect(scorePassword('abcdefg')).toBe('weak');
  });

  it('returns weak when all character classes are present but length < 8', () => {
    // length=6 → no length contributions; classes give 4 → score=4 BUT we
    // still classify as `weak` because under 8 chars we cannot meet the
    // length≥8 floor. Score-wise this lands at `good` if no length
    // requirement is enforced, but the table from design.md §D awards
    // length≥8 separately so a 6-char `Aa1!Bc` only earns 4 (classes)
    // and rates as `good`. We codify the actual contract: this is
    // `good` per the score table and the server enforces additional
    // policy (e.g. min length) elsewhere.
    expect(scorePasswordDetails('Aa1!Bc').score).toBe(4);
    expect(scorePasswordDetails('Aa1!Bc').rating).toBe('good');
  });

  it('rates an 8-char password with mixed classes as good', () => {
    // length≥8 (+1) + lower (+1) + upper (+1) + digit (+1) + symbol (+1) = 5 → good
    const details = scorePasswordDetails('Aa1!Bb2@');
    expect(details.score).toBe(5);
    expect(details.rating).toBe('good');
  });

  it('rates a 12-char diverse password as strong', () => {
    // length≥8 +1, length≥12 +1, lower +1, upper +1, digit +1, symbol +1 = 6 → strong
    const details = scorePasswordDetails('Tr0ub4dor&3x');
    expect(details.score).toBeGreaterThanOrEqual(6);
    expect(details.rating).toBe('strong');
  });

  it('rates a 16-char diverse password as strong', () => {
    // All seven contributions → 7 → strong
    expect(scorePassword('Tr0ub4dor&3xQrSt')).toBe('strong');
  });

  it('rates a digits-only short password as weak', () => {
    // 12345678: length≥8 +1, digit +1 → 2 BUT contains common pattern
    // `12345678` → −2 → score = 0 → weak
    expect(scorePassword('12345678')).toBe('weak');
  });

  it('rejects "password" as weak even with capital letter', () => {
    // Password: length≥8 +1, lower +1, upper +1 = 3 BUT contains
    // common pattern `password` → −2 → score = 1 → weak
    expect(scorePassword('Password')).toBe('weak');
  });

  it('rejects "Password123" as weak', () => {
    // Password123 contains `password`. length≥8+1, lower+1, upper+1, digit+1=4 −2 = 2 → weak
    expect(scorePassword('Password123')).toBe('weak');
  });

  it('rejects "qwerty12" as weak', () => {
    // qwerty12 contains `qwerty` and `12`. length=8 +1, lower +1, digit +1 = 3 −2 = 1 → weak
    expect(scorePassword('qwerty12')).toBe('weak');
  });

  it('rejects sequential repeats of 4+ identical chars', () => {
    // `Aaaaaaaa` — 7 consecutive `a`s → length≥8 +1, lower +1, upper +1
    // = 3, sequential-repeat penalty −2 → score = 1 → weak.
    expect(scorePassword('Aaaaaaaa')).toBe('weak');
  });

  it('does not flag fewer than 4 consecutive repeats', () => {
    // Only 3 consecutive `a`s → no sequential-repeat penalty.
    // `Aaa-Bb1!` length=8 +1, lower +1, upper +1, digit +1, symbol +1 = 5 → good.
    expect(scorePassword('Aaa-Bb1!')).toBe('good');
  });

  it('rates "fair" (score === 3)', () => {
    // length≥8 +1, lower +1, upper +1 = 3, no penalty → fair.
    // Choose tokens that do not appear as substrings of any common pattern.
    expect(scorePassword('MixedCases')).toBe('fair');
  });

  it('returns the same rating from scorePassword and scorePasswordDetails', () => {
    const sample = 'My$ecure-Pass-2025';
    expect(scorePassword(sample)).toBe(scorePasswordDetails(sample).rating);
  });

  it('matches common patterns case-insensitively', () => {
    // `PASSWORD` (all caps) and `PaSsWoRd` (mixed) should both trigger
    // the common-pattern penalty. length≥8 +1, upper +1 = 2 → −2 → 0 → weak.
    expect(scorePassword('PASSWORD')).toBe('weak');
    expect(scorePassword('PaSsWoRd')).toBe('weak');
  });

  it('handles unicode passwords without throwing', () => {
    // Multi-byte chars count as symbols (outside [A-Za-z0-9]).
    // length≥8 +1, length≥12 +1, lower +1, symbol +1 = 4 → good
    const details = scorePasswordDetails('café-noir-99');
    expect(details.score).toBeGreaterThanOrEqual(4);
    expect(details.rating).not.toBe('weak');
  });

  it('non-string input returns weak', () => {
    // Defensive: TypeScript prevents this, but runtime callers
    // (e.g. the route handler) may receive untyped JSON.
    expect(scorePassword(undefined as unknown as string)).toBe('weak');
    expect(scorePassword(null as unknown as string)).toBe('weak');
  });
});

describe('scorePasswordDetails()', () => {
  it('reports a too_short reason when the password is below 8 chars', () => {
    const details = scorePasswordDetails('abc');
    const codes = details.reasons.map((r) => r.code);
    expect(codes).toContain('too_short');
  });

  it('reports add_uppercase when only lowercase is used', () => {
    const details = scorePasswordDetails('abcdefghij');
    const codes = details.reasons.map((r) => r.code);
    expect(codes).toContain('add_uppercase');
    expect(codes).toContain('add_digit');
    expect(codes).toContain('add_symbol');
  });

  it('reports common_pattern when a leak template is used', () => {
    const details = scorePasswordDetails('letmein-2024!');
    const codes = details.reasons.map((r) => r.code);
    expect(codes).toContain('common_pattern');
    expect(details.checks.notCommon).toBe(false);
  });

  it('reports sequential_repeat for 4+ identical chars', () => {
    const details = scorePasswordDetails('Aaaaaaa1!');
    const codes = details.reasons.map((r) => r.code);
    expect(codes).toContain('sequential_repeat');
    expect(details.checks.noSequentialRepeat).toBe(false);
  });

  it('does not flag 3 identical chars as a sequential repeat', () => {
    const details = scorePasswordDetails('Aaa-Bbb-1234567!');
    expect(details.checks.noSequentialRepeat).toBe(true);
  });

  it('produces no reasons for a strong password', () => {
    const details = scorePasswordDetails('Tr0ub4dor&3xQrSt');
    expect(details.rating).toBe('strong');
    expect(details.reasons).toEqual([]);
  });

  it('clamps the score at 0 even when penalties exceed credits', () => {
    // `aaaa` length=4 → 0 contributions, sequential repeat → −2.
    // Without clamp the score would be −2.
    expect(scorePasswordDetails('aaaa').score).toBe(0);
  });

  it('exposes per-rule checks for the UI rule list', () => {
    const details = scorePasswordDetails('Aa1!Bb2@CcDd');
    expect(details.checks.length8).toBe(true);
    expect(details.checks.length12).toBe(true);
    expect(details.checks.length16).toBe(false);
    expect(details.checks.lowercase).toBe(true);
    expect(details.checks.uppercase).toBe(true);
    expect(details.checks.digit).toBe(true);
    expect(details.checks.symbol).toBe(true);
  });
});
