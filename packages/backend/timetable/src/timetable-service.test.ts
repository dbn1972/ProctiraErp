import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('TimetableService', () => {
  it('creates and lists BellPeriod', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const created = await service.createBellPeriod(tenantId, {
      institutionId: '22222222-2222-4222-8222-222222222222',
      name: 'sample',
      periodOrder: 1,
      startTime: 'sample',
      endTime: 'sample',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listBellPeriods(tenantId);
    expect(rows).toHaveLength(1);
  });
});
