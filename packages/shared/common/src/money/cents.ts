/**
 * W2-FIN-08: major-currency ↔ integer-cents conversion without silent float drift.
 *
 * Scholarship / admissions store NUMERIC major units; the fee ledger is integer cents.
 * Never use bare `Math.round(Number(x) * 100)` at call sites — centralize the guard here.
 */

import { BusinessRuleError } from '@proctira/common';

const CENT_EPS = 1e-8;

/**
 * Convert a major-unit money value to integer cents.
 * - Strings must be finite decimals with at most 2 fractional digits.
 * - Numbers must be within {@link CENT_EPS} of an exact cent (rejects 1/3-like values).
 */
export function majorUnitsToCents(major: number | string): number {
  if (typeof major === 'string') {
    const raw = major.trim();
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
      throw new BusinessRuleError(`Money amount is not a non-negative decimal: ${major}`);
    }
    const [wholePart, fracPart = ''] = raw.split('.');
    if (fracPart.length > 2) {
      throw new BusinessRuleError(
        `Money amount has more than 2 decimal places (not representable in cents): ${raw}`,
      );
    }
    const frac = (fracPart + '00').slice(0, 2);
    const cents = Number.parseInt(wholePart || '0', 10) * 100 + Number.parseInt(frac, 10);
    if (!Number.isSafeInteger(cents)) {
      throw new BusinessRuleError(`Money amount overflows safe integer cents: ${raw}`);
    }
    return cents;
  }

  if (typeof major !== 'number' || !Number.isFinite(major)) {
    throw new BusinessRuleError(`Money amount is not a finite number: ${String(major)}`);
  }
  if (major < 0) {
    throw new BusinessRuleError(`Money amountCents must be non-negative: ${major}`);
  }

  const scaled = major * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents)) {
    throw new BusinessRuleError(`Money amount overflows safe integer cents: ${major}`);
  }
  if (Math.abs(scaled - cents) > CENT_EPS) {
    throw new BusinessRuleError(
      `Money amount is not representable in integer cents within epsilon: ${major}`,
    );
  }
  return cents;
}

/** Inverse of {@link majorUnitsToCents} for reconciliation displays. */
export function centsToMajorUnits(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new BusinessRuleError('centsToMajorUnits requires an integer cent amount');
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Assert major units and cents agree (reconciliation guard). */
export function assertMajorMatchesCents(major: number | string, cents: number): void {
  const expected = majorUnitsToCents(major);
  if (expected !== cents) {
    throw new BusinessRuleError(
      `Scholarship amount ${String(major)} does not reconcile to ${cents} cents (expected ${expected})`,
    );
  }
}
