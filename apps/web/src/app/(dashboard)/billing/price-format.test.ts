/**
 * PRC-L037 — plan prices keep their minor units and use the plan currency.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatAmount } from '../fees/_components/format-amount';

describe('billing plan price formatting (PRC-L037)', () => {
  it('shows a 49950 minor-unit plan as 499.50', () => {
    expect(formatAmount(49950, 'INR', 'en-IN')).toBe('₹499.50');
    expect(formatAmount(49950, 'USD', 'en-US')).toBe('$499.50');
  });

  it('page no longer hard-codes INR or zero fraction digits', () => {
    const src = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');
    expect(src).not.toContain("currency: 'INR'");
    expect(src).not.toContain('maximumFractionDigits: 0');
    expect(src).toContain('formatAmount(plan.priceMonthly, plan.currency, locale)');
  });
});
