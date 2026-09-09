/**
 * Pure instalment allocation — sum(parts) === amountCents by construction.
 */
import { BusinessRuleError } from '@proctira/common';

export function allocateInstalments(amountCents: number, partCount: number): number[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new BusinessRuleError('Structure amountCents must be a non-negative integer');
  }
  if (!Number.isInteger(partCount) || partCount < 1) {
    throw new BusinessRuleError('Instalment count must be an integer >= 1');
  }
  const base = Math.floor(amountCents / partCount);
  const remainder = amountCents % partCount;
  return Array.from({ length: partCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function allocateByShares(amountCents: number, shares: number[]): number[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new BusinessRuleError('Structure amountCents must be a non-negative integer');
  }
  if (shares.length === 0) {
    throw new BusinessRuleError('At least one instalment share is required');
  }
  if (shares.some((s) => !Number.isFinite(s) || s < 0)) {
    throw new BusinessRuleError('Instalment shares must be non-negative numbers');
  }
  const total = shares.reduce((acc, s) => acc + s, 0);
  if (total <= 0) {
    throw new BusinessRuleError('Instalment shares must sum to a positive total');
  }
  const raw = shares.map((s) => Math.floor((amountCents * s) / total));
  let gap = amountCents - raw.reduce((acc, n) => acc + n, 0);
  for (let i = raw.length - 1; i >= 0 && gap !== 0; i -= 1) {
    const step = gap > 0 ? 1 : -1;
    if (raw[i]! + step < 0) continue;
    raw[i]! += step;
    gap -= step;
  }
  return raw;
}

export function concessionDiscountCents(
  structureAmountCents: number,
  input: { kind: 'percent' | 'amount'; percent?: number | null; amountCents?: number | null },
): number {
  if (input.kind === 'percent') {
    const percent = input.percent ?? 0;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new BusinessRuleError('Concession percent must be between 0 and 100');
    }
    return Math.min(structureAmountCents, Math.floor((structureAmountCents * percent) / 100));
  }
  const amount = input.amountCents ?? 0;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new BusinessRuleError('Concession amountCents must be a non-negative integer');
  }
  return Math.min(structureAmountCents, amount);
}

export function remainingRefundableCents(paidCents: number, alreadyRefundedCents: number): number {
  return Math.max(0, paidCents - alreadyRefundedCents);
}

export function assertRefundWithinPaid(
  paidCents: number,
  alreadyRefundedCents: number,
  refundCents: number,
): void {
  if (!Number.isInteger(refundCents) || refundCents <= 0) {
    throw new BusinessRuleError('Refund amountCents must be a positive integer');
  }
  if (alreadyRefundedCents + refundCents > paidCents) {
    throw new BusinessRuleError('Refund cannot exceed amount paid');
  }
}
