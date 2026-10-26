/**
 * PRC-M547: imported students get an admission number, the same way
 * StudentService.create issues one (W2-SIS-01).
 */
import { describe, expect, it } from 'vitest';

import { InMemoryStudentRepository as CoreInMemoryStudentRepository } from '../in-memory-repository.js';
import { CoreRepositoryImportAdapter } from './core-repository-import-adapter.js';
import { ImportService } from './import-service.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import type { ImportStudentRow } from './types.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const ADMISSION = /^ADM-\d{4}-\d{4}$/;

const rows: ImportStudentRow[] = [
  {
    rowNumber: 2,
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '2010-01-15',
    nationalId: 'N1',
  },
  {
    rowNumber: 3,
    firstName: 'Alan',
    lastName: 'Turing',
    dateOfBirth: '2010-02-20',
    nationalId: 'N2',
  },
];

function setup() {
  const core = new CoreInMemoryStudentRepository();
  const adapter = new CoreRepositoryImportAdapter(core);
  const service = new ImportService({
    studentRepository: adapter,
    importQueue: new InMemoryImportQueue(),
  });
  return { core, adapter, service };
}

function admissionOf(customData: Record<string, unknown> | null | undefined) {
  return customData?.['admissionNo'];
}

describe('import issues admission numbers (PRC-M547)', () => {
  it('bulk import issues a distinct admission number per created student', async () => {
    const { core, service } = setup();
    const result = await service.processRows(TENANT, rows, { duplicateResolution: 'skip' });
    expect(result.successCount).toBe(2);
    const students = (await core.list(TENANT, {}, { page: 1, pageSize: 10 })).data;
    const numbers = students.map((s) => admissionOf(s.customData));
    for (const [i, n] of numbers.entries()) {
      expect(n).toMatch(ADMISSION);
      expect(students[i]!.customData?.['admissionNumber']).toBe(n);
    }
    expect(new Set(numbers).size).toBe(2);
  });

  it('adapter.create alone issues one too', async () => {
    const { adapter } = setup();
    const created = await adapter.create(TENANT, {
      firstName: 'Grace',
      lastName: 'Hopper',
      dateOfBirth: '2010-03-10',
      gender: null,
      nationalId: 'N3',
      nationality: null,
      contactPhone: null,
      contactEmail: null,
      guardianName: null,
      guardianPhone: null,
      institutionCode: null,
      customData: null,
    });
    expect(admissionOf(created.customData)).toMatch(ADMISSION);
  });

  it('keeps an admission number supplied in customData', async () => {
    const { adapter } = setup();
    const created = await adapter.create(TENANT, {
      firstName: 'Grace',
      lastName: 'Hopper',
      dateOfBirth: '2010-03-10',
      gender: null,
      nationalId: 'N4',
      nationality: null,
      contactPhone: null,
      contactEmail: null,
      guardianName: null,
      guardianPhone: null,
      institutionCode: null,
      customData: { admissionNumber: 'LEGACY-77' },
    });
    expect(created.customData).toMatchObject({
      admissionNo: 'LEGACY-77',
      admissionNumber: 'LEGACY-77',
    });
  });

  it('an update re-import keeps the original admission number', async () => {
    const { core, service } = setup();
    await service.processRows(TENANT, rows, { duplicateResolution: 'skip' });
    const before = (await core.list(TENANT, {}, { page: 1, pageSize: 10 })).data;
    const original = new Map(before.map((s) => [s.id, admissionOf(s.customData)]));
    const renamed = rows.map((r) => ({ ...r, lastName: `${r.lastName}-B` }));
    await service.processRows(TENANT, renamed, { duplicateResolution: 'update' });
    const after = (await core.list(TENANT, {}, { page: 1, pageSize: 10 })).data;
    expect(after).toHaveLength(2);
    for (const s of after) {
      expect(admissionOf(s.customData)).toBe(original.get(s.id));
    }
  });
});
