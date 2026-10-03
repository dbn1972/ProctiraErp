/**
 * PRC-M384: import is transactional only when the store runs one DB
 * transaction; the compensation fallback is reported honestly.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryStudentRepository as CoreInMemoryStudentRepository } from '../in-memory-repository.js';
import { CoreRepositoryImportAdapter } from './core-repository-import-adapter.js';
import { ImportRollbackError, ImportService } from './import-service.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import type { ImportStudentRow } from './types.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

const rows: ImportStudentRow[] = [
  { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15', nationalId: 'A' },
  { rowNumber: 3, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2005-02-20', nationalId: 'B' },
  { rowNumber: 4, firstName: 'Carol', lastName: 'Lee', dateOfBirth: '2005-03-10', nationalId: 'C' },
];

describe('student import transactionality (PRC-M384)', () => {
  it('core store bulkWrite: failure on row N leaves table and fields unchanged', async () => {
    const core = new CoreInMemoryStudentRepository();
    const adapter = new CoreRepositoryImportAdapter(core);
    const prior = await adapter.create(TENANT, {
      firstName: 'Prior',
      lastName: 'Student',
      dateOfBirth: '2004-01-01',
      gender: null,
      nationalId: 'P',
      nationality: null,
      contactPhone: null,
      contactEmail: null,
      guardianName: null,
      guardianPhone: null,
      institutionCode: null,
      customData: null,
    });
    let n = 0;
    const originalCreate = core.create.bind(core);
    core.create = async (data) => {
      n += 1;
      if (n === 3) throw new Error('unique violation on row 3');
      return originalCreate(data);
    };
    const service = new ImportService({
      studentRepository: adapter,
      importQueue: new InMemoryImportQueue(),
    });
    await expect(
      service.processRows(TENANT, rows, { duplicateResolution: 'skip' }),
    ).rejects.toThrow(/row 3/);
    const page = await core.list(TENANT, {}, { page: 1, pageSize: 100 });
    expect(page.data.map((s) => s.id)).toEqual([prior.id]);
    expect(page.data[0]).toMatchObject({ firstName: 'Prior', nationalId: 'P' });
  });

  it('successful bulk commit reports transactional: true', async () => {
    const service = new ImportService({
      studentRepository: new CoreRepositoryImportAdapter(new CoreInMemoryStudentRepository()),
      importQueue: new InMemoryImportQueue(),
    });
    const result = await service.processRows(TENANT, rows, { duplicateResolution: 'skip' });
    expect(result).toMatchObject({ transactional: true, successCount: 3 });
  });

  it('store without bulkImport -> transactional: false', async () => {
    const repo = new InMemoryStudentRepository();
    Object.assign(repo, { bulkImport: undefined });
    const service = new ImportService({ studentRepository: repo, importQueue: new InMemoryImportQueue() });
    const result = await service.processRows(TENANT, rows, { duplicateResolution: 'skip' });
    expect(result.transactional).toBe(false);
  });

  it('fallback: compensation releases national IDs and surfaces compensation failures', async () => {
    const repo = new InMemoryStudentRepository();
    Object.assign(repo, { bulkImport: undefined });
    const nationalIdClears: string[] = [];
    const originalUpdate = repo.update.bind(repo);
    repo.update = async (tenantId, id, data) => {
      if (data.nationalId === null) nationalIdClears.push(id);
      return originalUpdate(tenantId, id, data);
    };
    let n = 0;
    const originalCreate = repo.create.bind(repo);
    repo.create = async (tenantId, data) => {
      n += 1;
      if (n === 3) throw new Error('boom');
      return originalCreate(tenantId, data);
    };
    repo.delete = async () => {
      throw new Error('delete failed');
    };
    const service = new ImportService({ studentRepository: repo, importQueue: new InMemoryImportQueue() });
    const err = await service
      .processRows(TENANT, rows, { duplicateResolution: 'skip' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportRollbackError);
    expect((err as ImportRollbackError).rollbackFailures).toHaveLength(2);
    expect(nationalIdClears).toHaveLength(2);
  });
});
