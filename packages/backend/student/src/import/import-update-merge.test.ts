/**
 * M1-I2: an "Update existing records" import changes only the columns the row
 * carries. customData keys (the admission number) are merged into the stored
 * student, never replaced.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryStudentRepository as CoreInMemoryStudentRepository } from '../in-memory-repository.js';
import { StaleStudentUpdateError } from '../student-repository.js';
import type { StudentEntity } from '../student-repository.js';
import { CoreRepositoryImportAdapter } from './core-repository-import-adapter.js';
import { ImportService } from './import-service.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import type { ImportStudentRow } from './types.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const MOTHER = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Mara',
  lastName: 'Guardian',
  relationship: 'mother',
  contactPhone: '000-111',
  contactEmail: 'mara@guardian.test',
};
const FATHER = {
  id: '22222222-2222-4222-8222-222222222222',
  firstName: 'Ferd',
  lastName: 'Guardian',
  relationship: 'father',
  contactPhone: '000-222',
  contactEmail: 'ferd@guardian.test',
};

async function setup() {
  const core = new CoreInMemoryStudentRepository();
  const adapter = new CoreRepositoryImportAdapter(core);
  const service = new ImportService({
    studentRepository: adapter,
    importQueue: new InMemoryImportQueue(),
  });
  const stored = await core.create({
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT,
    firstName: 'Ada',
    lastName: 'Learner',
    dateOfBirth: '2014-05-01',
    gender: 'female',
    nationalId: 'NID-1',
    nationality: null,
    contacts: [],
    guardians: [MOTHER, FATHER],
    identityDocuments: [],
    customData: { admissionNo: 'ADM-2026-0007', admissionNumber: 'ADM-2026-0007', house: 'Red' },
  });
  return { core, adapter, service, stored };
}

function updateRow(extra: Partial<ImportStudentRow>): ImportStudentRow {
  return {
    rowNumber: 2,
    firstName: 'Ada',
    lastName: 'Updated',
    dateOfBirth: '2014-05-01',
    nationalId: 'NID-1',
    ...extra,
  };
}

async function reload(core: CoreInMemoryStudentRepository, id: string): Promise<StudentEntity> {
  const entity = await core.findById(id, TENANT);
  if (!entity) throw new Error('student missing');
  return entity;
}

describe('import "update existing" merges (M1-I2)', () => {
  it('an institution_code column keeps the admission number and other customData keys', async () => {
    const { core, service, stored } = await setup();
    const result = await service.processRows(
      TENANT,
      [updateRow({ institutionCode: 'E2E-SCH-001' })],
      { duplicateResolution: 'update' },
    );
    expect(result.duplicateCount).toBe(1);
    const after = await reload(core, stored.id);
    expect(after.lastName).toBe('Updated');
    expect(after.customData).toEqual({
      admissionNo: 'ADM-2026-0007',
      admissionNumber: 'ADM-2026-0007',
      house: 'Red',
      institutionCode: 'E2E-SCH-001',
    });
  });

  it('a row without customData columns leaves customData and guardians untouched', async () => {
    const { core, service, stored } = await setup();
    await service.processRows(TENANT, [updateRow({})], { duplicateResolution: 'update' });
    const after = await reload(core, stored.id);
    expect(after.guardians).toEqual([MOTHER, FATHER]);
    expect(after.customData).toEqual(stored.customData);
  });

  it('the non-batch update path merges the same way', async () => {
    const { core, adapter, stored } = await setup();
    await adapter.update(TENANT, stored.id, { institutionCode: 'E2E-SCH-001' });
    const after = await reload(core, stored.id);
    expect(after.customData['admissionNo']).toBe('ADM-2026-0007');
    expect(after.customData['institutionCode']).toBe('E2E-SCH-001');
  });

  it('a concurrent edit between the merge read and the write aborts the batch', async () => {
    const { core, service, stored } = await setup();
    const read = core.findById.bind(core);
    // Every read returns the row as it was, then another writer changes it.
    core.findById = async (id, tenantId) => {
      const entity = await read(id, tenantId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await core.update(id, tenantId, { guardians: [FATHER] });
      return entity;
    };
    await expect(
      service.processRows(TENANT, [updateRow({ institutionCode: 'E2E-SCH-001' })], {
        duplicateResolution: 'update',
      }),
    ).rejects.toBeInstanceOf(StaleStudentUpdateError);
    const after = await read(stored.id, TENANT);
    expect(after?.lastName).toBe('Learner');
    expect(after?.guardians).toEqual([FATHER]);
    expect(after?.customData['institutionCode']).toBeUndefined();
  });
});
