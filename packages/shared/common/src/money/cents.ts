/**
 * W2-FIN-08 / W1-DATA-09: major-currency ↔ integer-cents conversion without silent float drift.
 *
 * Scholarships dual-write NUMERIC major + BIGINT cents (`amount_per_recipient_cents`,
 * `amount_cents`); the fee ledger is integer cents only. Never use bare
 * `Math.round(Number(x) * 100)` or bare `Number(bigint)` at call sites — centralize here.
 */

import { BusinessRuleError } from '../exceptions/index.js';

const CENT_EPS = 1e-8;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

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

/**
 * W1-DATA-09: coerce Postgres INTEGER / BIGINT money columns to JS safe integer cents.
 *
 * `node-pg` returns BIGINT as string; INTEGER may arrive as number. Bare `Number(bigint)`
 * silently loses precision past 2^53−1 and accepts float strings like `"10.5"`.
 */
export function pgIntegerCents(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value > MAX_SAFE || value < MIN_SAFE) {
      throw new BusinessRuleError(`Money cents overflow safe integer: ${value}`);
    }
    return Number(value);
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new BusinessRuleError(`Money cents must be a safe integer: ${value}`);
    }
    return value;
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw || !/^-?\d+$/.test(raw)) {
      throw new BusinessRuleError(`Money cents is not an integer string: ${value}`);
    }
    let asBig: bigint;
    try {
      asBig = BigInt(raw);
    } catch {
      throw new BusinessRuleError(`Money cents is not an integer string: ${value}`);
    }
    if (asBig > MAX_SAFE || asBig < MIN_SAFE) {
      throw new BusinessRuleError(`Money cents overflow safe integer: ${raw}`);
    }
    return Number(asBig);
  }

  throw new BusinessRuleError(`Money cents has unsupported type: ${typeof value}`);
}

/** Like {@link pgIntegerCents} but maps SQL NULL to `null`. */
export function pgOptionalIntegerCents(value: unknown): number | null {
  if (value == null) return null;
  return pgIntegerCents(value);
}

/**
 * W1-DATA-09: coerce Postgres NUMERIC major-unit money to integer cents.
 * `node-pg` returns NUMERIC as string — prefer that path over `Number(numeric)`.
 */
export function pgNumericMajorToCents(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number') {
    return majorUnitsToCents(value);
  }
  throw new BusinessRuleError(
    `Money major units has unsupported type: ${typeof value}`,
  );
}

/** Display major units derived from integer cents (string → number for API compat). */
export function majorUnitsNumberFromCents(cents: number): number {
  return Number(centsToMajorUnits(cents));
}
