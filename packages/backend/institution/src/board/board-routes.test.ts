import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerBoardRoutes } from './board-routes.js';
import { BoardService } from './board-service.js';

describe('Board routes', () => {
  it('lists boards for the request tenant', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: '22222222-2222-2222-2222-222222222222',
        name: 'Central Board of Secondary Education',
        code: 'CBSE',
        type: 'NATIONAL',
        status: 'active',
        createdAt: new Date('2026-09-04T00:00:00Z'),
        updatedAt: new Date('2026-09-04T00:00:00Z'),
      },
    ]);
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = '22222222-2222-2222-2222-222222222222';
    });
    await registerBoardRoutes(app, {
      service: { list } as unknown as BoardService,
    });

    const response = await app.inject({ method: 'GET', url: '/boards' });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].code).toBe('CBSE');
    expect(list).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
    await app.close();
  });
});
