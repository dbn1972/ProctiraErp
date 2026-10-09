/**
 * @vitest-environment node
 *
 * PRC-L032 / PRC-L256: audit retention cannot be lowered below the statutory
 * floor (12 months) from the UI; the server action rejects it and never calls
 * the gateway with a sub-floor value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveAuditRetention = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/platform.server', () => ({
  saveAuditRetention: (...a: unknown[]) => saveAuditRetention(...a),
  runAuditArchival: vi.fn(),
  verifyAuditChain: vi.fn(),
}));

import { saveRetentionAction } from './actions';
import { AUDIT_RETENTION_HARD_FLOOR_MONTHS, minAuditRetentionMonths } from './retention-policy';

const ORIGINAL_MIN = process.env.AUDIT_RETENTION_MIN_MONTHS;

beforeEach(() => {
  saveAuditRetention.mockReset().mockResolvedValue(undefined);
  delete process.env.AUDIT_RETENTION_MIN_MONTHS;
});

afterEach(() => {
  if (ORIGINAL_MIN === undefined) delete process.env.AUDIT_RETENTION_MIN_MONTHS;
  else process.env.AUDIT_RETENTION_MIN_MONTHS = ORIGINAL_MIN;
});

describe('audit retention floor (PRC-L032/PRC-L256)', () => {
  it('rejects a 1-month retention and does not call the gateway', async () => {
    const res = await saveRetentionAction({
      retentionMonths: 1,
      archivalEnabled: false,
      archivalDestination: null,
    });
    expect(res.status).toBe('error');
    expect(res.fieldErrors?.retentionMonths).toMatch(/At least 12 months/);
    expect(saveAuditRetention).not.toHaveBeenCalled();
  });

  it('accepts a value at or above the floor', async () => {
    const res = await saveRetentionAction({
      retentionMonths: 12,
      archivalEnabled: false,
      archivalDestination: null,
    });
    expect(res.status).toBe('success');
    expect(saveAuditRetention).toHaveBeenCalledWith(
      expect.objectContaining({ retentionMonths: 12 }),
    );
  });

  it('honours a higher configured minimum but never below the hard floor', () => {
    expect(minAuditRetentionMonths()).toBe(AUDIT_RETENTION_HARD_FLOOR_MONTHS);
    process.env.AUDIT_RETENTION_MIN_MONTHS = '24';
    expect(minAuditRetentionMonths()).toBe(24);
    process.env.AUDIT_RETENTION_MIN_MONTHS = '3';
    expect(minAuditRetentionMonths()).toBe(AUDIT_RETENTION_HARD_FLOOR_MONTHS);
  });
});
