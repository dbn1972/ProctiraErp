import { describe, expect, it } from 'vitest';

import { closeDatabaseResources } from './close-database-resources';

describe('closeDatabaseResources (W1-ARCH-07)', () => {
  it('is a no-op when no Prisma clients or shared pools are open', async () => {
    await expect(closeDatabaseResources()).resolves.toBeUndefined();
  });
});
