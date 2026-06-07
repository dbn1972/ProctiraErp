/**
 * Unit tests for Active Period Validator with mocked Prisma.
 * Validates that enrollment/attendance/assessment operations are rejected
 * when the academic period is not active.
 *
 * @requirements 5.7, 5.8
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateActivePeriod, ActivePeriodValidator } from './active-period-validator.js';
import { NotFoundError, BusinessRuleError } from '@proctira/common';

function createMockPrisma() {
  return {
    academicPeriod: {
      findFirst: vi.fn(),
    },
  } as any;
}

const TENANT_ID = 'tenant-001';

describe('validateActivePeriod', () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('should return the period when it is active', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: '2024-2025',
      code: '2024',
      status: 'active',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    const result = await validateActivePeriod(prisma, TENANT_ID, 'period-1');
    expect(result).toEqual(period);
  });

  it('should throw NotFoundError if period does not exist', async () => {
    prisma.academicPeriod.findFirst.mockResolvedValue(null);

    await expect(
      validateActivePeriod(prisma, TENANT_ID, 'nonexistent'),
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw BusinessRuleError if period is inactive', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: '2023-2024',
      status: 'inactive',
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    await expect(
      validateActivePeriod(prisma, TENANT_ID, 'period-1'),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('should throw BusinessRuleError if period is archived', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: '2022-2023',
      status: 'archived',
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    await expect(
      validateActivePeriod(prisma, TENANT_ID, 'period-1'),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('should include period name and status in error message', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: 'Fall 2023',
      status: 'archived',
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    try {
      await validateActivePeriod(prisma, TENANT_ID, 'period-1');
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error.message).toContain('Fall 2023');
      expect(error.message).toContain('archived');
      expect(error.message).toContain('not currently active');
    }
  });
});

describe('ActivePeriodValidator (class-based)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let validator: ActivePeriodValidator;

  beforeEach(() => {
    prisma = createMockPrisma();
    validator = new ActivePeriodValidator({ prisma });
  });

  it('should validate active period via class method', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: '2024-2025',
      status: 'active',
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    const result = await validator.validate(TENANT_ID, 'period-1');
    expect(result).toEqual(period);
  });

  it('should reject inactive period via class method', async () => {
    const period = {
      id: 'period-1',
      tenantId: TENANT_ID,
      name: '2023-2024',
      status: 'inactive',
      deletedAt: null,
    };
    prisma.academicPeriod.findFirst.mockResolvedValue(period);

    await expect(
      validator.validate(TENANT_ID, 'period-1'),
    ).rejects.toThrow(BusinessRuleError);
  });
});
