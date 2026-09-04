import { describe, expect, it } from 'vitest';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { HostelService } from './hostel-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('HostelService', () => {
  it('creates and lists Hostel', async () => {
    const service = new HostelService(new InMemoryHostelRepository());
    const created = await service.createHostel(tenantId, {
      institutionId: '22222222-2222-4222-8222-222222222222',
      name: 'sample',
      gender: 'mixed',
      capacity: 1,
      status: 'active',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listHostels(tenantId);
    expect(rows).toHaveLength(1);
  });
});
