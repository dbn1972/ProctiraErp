import { describe, expect, it } from 'vitest';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { LibraryService } from './library-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('LibraryService', () => {
  it('creates and lists LibraryTitle', async () => {
    const service = new LibraryService(new InMemoryLibraryRepository());
    const created = await service.createLibraryTitle(tenantId, {
      title: 'sample',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listLibraryTitles(tenantId);
    expect(rows).toHaveLength(1);
  });
});
