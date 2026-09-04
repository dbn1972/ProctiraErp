import { describe, expect, it } from 'vitest';
import { InMemoryLmsRepository } from './in-memory-repository.js';
import { LmsService } from './lms-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('LmsService', () => {
  it('creates and lists LmsCourse', async () => {
    const service = new LmsService(new InMemoryLmsRepository());
    const created = await service.createLmsCourse(tenantId, {
      institutionId: '22222222-2222-4222-8222-222222222222',
      title: 'sample',
      status: 'draft',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listLmsCourses(tenantId);
    expect(rows).toHaveLength(1);
  });
});
