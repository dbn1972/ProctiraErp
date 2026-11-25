/**
 * PRC-L449: custom field values are stored only for an owning record that
 * exists in the tenant; an unknown entity id is refused and nothing is written.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { CustomFieldService, type CustomFieldEntityLookup } from './custom-field-service.js';
import {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';

const TENANT = 'tenant-1';
const KNOWN_STUDENT = randomUUID();

describe('PRC-L449 custom field entity existence', () => {
  let definitions: InMemoryCustomFieldDefinitionRepository;
  let values: InMemoryCustomFieldValueRepository;
  let service: CustomFieldService;
  const lookup: CustomFieldEntityLookup = {
    exists: async (tenantId, entityType, entityId) =>
      tenantId === TENANT && entityType === 'student' && entityId === KNOWN_STUDENT,
  };

  beforeEach(() => {
    definitions = new InMemoryCustomFieldDefinitionRepository();
    values = new InMemoryCustomFieldValueRepository();
    service = new CustomFieldService(definitions, values, { entityLookup: lookup });
  });

  async function textField() {
    return service.createDefinition(TENANT, {
      entityType: 'student',
      fieldKey: 'house',
      label: 'House',
      fieldType: 'text',
      validationRules: {},
    });
  }

  it('setValue for an unknown entity is 404 and stores nothing', async () => {
    const def = await textField();
    const unknown = randomUUID();
    await expect(
      service.setValue(TENANT, 'student', unknown, def.id, 'Blue'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.getValuesForEntity(TENANT, 'student', unknown)).toEqual([]);
    const stored = await service.setValue(TENANT, 'student', KNOWN_STUDENT, def.id, 'Blue');
    expect(stored.entityId).toBe(KNOWN_STUDENT);
  });

  it('bulkSetValues for an unknown entity is 404 and stores nothing', async () => {
    const def = await textField();
    const unknown = randomUUID();
    await expect(
      service.bulkSetValues(TENANT, 'student', unknown, { [def.id]: 'Red' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.getValuesForEntity(TENANT, 'student', unknown)).toEqual([]);
  });

  it('production-like without an entity lookup refuses value writes (503)', async () => {
    const def = await textField();
    const bare = new CustomFieldService(definitions, values, { nodeEnv: 'production' });
    await expect(
      bare.setValue(TENANT, 'student', KNOWN_STUDENT, def.id, 'Blue'),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
