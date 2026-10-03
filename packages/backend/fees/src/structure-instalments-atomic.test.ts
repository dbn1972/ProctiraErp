/** PRC-M091: fee structure + instalments are created atomically. */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

describe('createFeeStructure with partCount (PRC-M091)', () => {
  it('creates instalments that sum to the total in one call', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    const s = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 100_001,
      partCount: 3,
    });
    const rows = await service.listInstalments(TENANT, s.id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(100_001);
  });

  it('leaves no structure when instalment creation fails', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    vi.spyOn(repository, 'replaceStructureInstalments').mockRejectedValue(new Error('db down'));
    await expect(
      service.createFeeStructure(TENANT, 'staff', {
        name: 'Tuition',
        category: 'tuition',
        amountCents: 1000,
        partCount: 2,
      }),
    ).rejects.toThrow('db down');
    expect(await service.listFeeStructures(TENANT)).toHaveLength(0);
  });
});
