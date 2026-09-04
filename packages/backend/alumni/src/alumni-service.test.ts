import { describe, expect, it } from 'vitest';
import { InMemoryAlumniRepository } from './in-memory-repository.js';
import { AlumniService } from './alumni-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('AlumniService', () => {
  it('creates and lists AlumniProfile', async () => {
    const service = new AlumniService(new InMemoryAlumniRepository());
    const created = await service.createAlumniProfile(tenantId, {
      fullName: 'sample',
      graduationYear: 1,
      status: 'active',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listAlumniProfiles(tenantId);
    expect(rows).toHaveLength(1);
  });
});
