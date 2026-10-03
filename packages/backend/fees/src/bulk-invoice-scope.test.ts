/**
 * PRC-M086: bulk invoicing never runs unscoped, previews match what is
 * created, and a mid-batch failure creates nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { FeesService } from './fees-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CLASS_ID = '00000000-0000-4000-8000-0000000000c1';
const S1 = '00000000-0000-4000-8000-000000000091';
const S2 = '00000000-0000-4000-8000-000000000092';
const S3 = '00000000-0000-4000-8000-000000000093';

describe('bulk invoice scope (PRC-M086)', () => {
  let repository: InMemoryFeesRepository;
  let service: FeesService;
  let structureId: string;
  beforeEach(async () => {
    repository = new InMemoryFeesRepository();
    service = new FeesService(repository);
    repository.seedClassRoster(TENANT, {}, [S1, S2, S3]); // "everyone"
    repository.seedClassRoster(TENANT, { classId: CLASS_ID }, [S1, S2]);
    repository.seedClassRoster(OTHER, { classId: CLASS_ID }, [S3]);
    const structure = await service.createFeeStructure(TENANT, 'staff', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 50_000,
    });
    structureId = structure.id;
  });

  it('rejects a run with no class, grade or students and creates zero invoices', async () => {
    await expect(service.bulkInvoiceClass(TENANT, 'staff', { structureId })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.previewBulkInvoice(TENANT, { structureId })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await repository.listInvoicesForTenant(TENANT)).toHaveLength(0);
  });

  it('allows an unscoped run only with the explicit allStudents flag', async () => {
    const res = await service.bulkInvoiceClass(TENANT, 'staff', { structureId, allStudents: true });
    expect(res.created).toHaveLength(3);
  });

  it('preview count and total equal what is created; cross-tenant students excluded', async () => {
    const preview = await service.previewBulkInvoice(TENANT, { structureId, classId: CLASS_ID });
    expect(preview).toMatchObject({ studentCount: 2, toCreateCount: 2, totalAmountCents: 100_000 });
    const res = await service.bulkInvoiceClass(TENANT, 'staff', { structureId, classId: CLASS_ID });
    expect(res.created).toHaveLength(preview.toCreateCount);
    expect(res.created.map((i) => i.studentId).sort()).toEqual([S1, S2]);
    const again = await service.previewBulkInvoice(TENANT, { structureId, classId: CLASS_ID });
    expect(again).toMatchObject({ toCreateCount: 0, skippedCount: 2 });
  });

  it('rolls back the whole batch when one invoice fails', async () => {
    const original = repository.createInvoice.bind(repository);
    let calls = 0;
    vi.spyOn(repository, 'createInvoice').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return original(input);
    });
    await expect(
      service.bulkInvoiceClass(TENANT, 'staff', { structureId, classId: CLASS_ID }),
    ).rejects.toThrow('boom');
    expect(await repository.listInvoicesForTenant(TENANT)).toHaveLength(0);
  });
});

describe('class ids are classes, not sections (PRC-M087)', () => {
  it('rejects a section/unknown id as classId on structure create and bulk invoice', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    const SECTION_ID = '00000000-0000-4000-8000-0000000000e5';
    await expect(
      service.createFeeStructure(TENANT, 'staff', {
        name: 'T',
        category: 'tuition',
        amountCents: 100,
        classId: SECTION_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // Another tenant's class is unknown here as well.
    repository.seedClass(OTHER, CLASS_ID);
    await expect(
      service.createFeeStructure(TENANT, 'staff', {
        name: 'T',
        category: 'tuition',
        amountCents: 100,
        classId: CLASS_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const s = await service.createFeeStructure(TENANT, 'staff', {
      name: 'T',
      category: 'tuition',
      amountCents: 100,
    });
    await expect(
      service.bulkInvoiceClass(TENANT, 'staff', { structureId: s.id, classId: SECTION_ID }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('bulk invoices exactly the enrolled students of a real class', async () => {
    const repository = new InMemoryFeesRepository();
    const service = new FeesService(repository);
    repository.seedClassRoster(TENANT, { classId: CLASS_ID }, [S1, S2]);
    const s = await service.createFeeStructure(TENANT, 'staff', {
      name: 'T',
      category: 'tuition',
      amountCents: 100,
      classId: CLASS_ID,
    });
    const res = await service.bulkInvoiceClass(TENANT, 'staff', { structureId: s.id });
    expect(res.created.map((i) => i.studentId).sort()).toEqual([S1, S2]);
  });
});
