/**
 * Guards the gateway pageSize ceiling.
 *
 * The bug this prevents was silent: the gateway rejects pageSize > 100 with a 400,
 * and the list clients swallow non-ok results into `[]`, so an over-sized request
 * rendered as "no data" rather than as an error. It showed up as the dashboard
 * reporting "INSTITUTIONS 0" against an API that returned 6, and as "—" in the
 * Grade/Section columns on /students and /staff.
 */
import { describe, expect, it } from 'vitest';

import { PAGINATION_DEFAULTS } from '@proctira/common';

import { clampPageSize, DEFAULT_API_PAGE_SIZE, MAX_API_PAGE_SIZE } from './pagination';

describe('clampPageSize', () => {
  it('tracks the same constant the gateway enforces', () => {
    // The cap is a root-level preHandler in
    // apps/api-gateway/src/plugins/pagination-cap.ts reading
    // PAGINATION_DEFAULTS.MAX_PAGE_SIZE — not a per-route schema. This assertion is
    // the one most likely to catch drift, so it compares against the shared constant
    // rather than a literal.
    expect(MAX_API_PAGE_SIZE).toBe(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
  });

  it('clamps the exact value that caused the regression', () => {
    // 13 call sites asked for 200 and silently received nothing.
    expect(clampPageSize(200)).toBe(100);
  });

  it('clamps anything above the ceiling', () => {
    expect(clampPageSize(101)).toBe(100);
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(Number.MAX_SAFE_INTEGER)).toBe(100);
  });

  it('passes through values the gateway accepts', () => {
    expect(clampPageSize(1)).toBe(1);
    expect(clampPageSize(20)).toBe(20);
    expect(clampPageSize(100)).toBe(100);
  });

  it('defaults when unspecified', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_API_PAGE_SIZE);
    expect(clampPageSize()).toBe(DEFAULT_API_PAGE_SIZE);
  });

  it('never returns a value the gateway would reject', () => {
    // minimum: 1 server-side, so 0 and negatives must floor to 1 rather than
    // pass through and earn a different 400.
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
  });

  it('floors fractional input', () => {
    expect(clampPageSize(20.7)).toBe(20);
  });

  it('falls back rather than emitting NaN', () => {
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_API_PAGE_SIZE);
  });

  it('treats Infinity as "as much as allowed", not as unspecified', () => {
    // Previously Infinity fell to the 50 default while MAX_SAFE_INTEGER clamped to
    // 100, so asking for everything returned fewer rows than asking for a large
    // finite number. Requirement: any positive over-request clamps to the maximum.
    expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(MAX_API_PAGE_SIZE);
    expect(clampPageSize(Number.MAX_SAFE_INTEGER)).toBe(MAX_API_PAGE_SIZE);
  });

  it('floors a negative infinity to the minimum the gateway accepts', () => {
    expect(clampPageSize(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_API_PAGE_SIZE);
  });
});
