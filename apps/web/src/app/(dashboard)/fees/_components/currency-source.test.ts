/**
 * PRC-L040 — fees UI uses the shared formatAmount with the row currency and
 * lets the server / selected plan decide currency on create.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const api = vi.hoisted(() => ({
  createFeeStructure: vi.fn(async () => ({ id: 'structure-1' })),
  generateInstalments: vi.fn(),
}));
vi.mock('@/lib/api/fees', () => api);

import { createFeeStructureAction } from '@/lib/fees/actions';
import { formatAmount } from './format-amount';

const componentFiles = readdirSync(__dirname).filter(
  (name) => name.endsWith('.tsx') && !name.includes('.test.'),
);

describe('fees currency handling (PRC-L040)', () => {
  it("no fees component hard-codes currency: 'INR' or a private money formatter", () => {
    for (const name of componentFiles) {
      const src = readFileSync(resolve(__dirname, name), 'utf8');
      expect(src, name).not.toMatch(/currency:\s*'INR'/);
      expect(src, name).not.toMatch(/function format(Amount|Money)\(/);
      expect(src, name).not.toContain('value="INR"');
    }
  });

  it('formats with the row currency', () => {
    expect(formatAmount(123450, 'USD', 'en-US')).toBe('$1,234.50');
  });

  it('createFeeStructureAction leaves currency to the server default', async () => {
    const result = await createFeeStructureAction({
      name: 'Tuition',
      category: 'tuition',
      amount: 100,
    });
    expect(result.success).toBe(true);
    const [input] = api.createFeeStructure.mock.calls[0]! as unknown as [Record<string, unknown>];
    expect(input).not.toHaveProperty('currency');
    expect(input.amountCents).toBe(10000);
  });
});
