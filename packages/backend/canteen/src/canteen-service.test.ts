import { describe, expect, it } from 'vitest';
import { InMemoryCanteenRepository } from './in-memory-repository.js';
import { CanteenService } from './canteen-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('CanteenService', () => {
  it('creates and lists MealMenu', async () => {
    const service = new CanteenService(new InMemoryCanteenRepository());
    const created = await service.createMealMenu(tenantId, {
      institutionId: '22222222-2222-4222-8222-222222222222',
      date: 'sample',
      mealType: 'lunch',
      items: 'sample',
      status: 'published',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listMealMenus(tenantId);
    expect(rows).toHaveLength(1);
  });
});
