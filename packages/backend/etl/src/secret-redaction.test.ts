/**
 * PRC-H115: pipeline responses never return stored credentials, and the
 * redaction placeholder round-trips on update without overwriting secrets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerETLRoutes } from './routes.js';
import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { REDACTED_SECRET } from './secret-redaction.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const DB_PASSWORD = 'db-secret-value';
const API_TOKEN = 'api-token-value';

const body = {
  name: 'Secret pipeline',
  source: {
    type: 'rest_api',
    url: 'https://api.example.test/records',
    headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: 'application/json' },
    authType: 'api_key',
    authConfig: { apiKey: API_TOKEN },
  },
  destination: {
    type: 'postgresql',
    host: 'db.internal',
    port: 5432,
    database: 'warehouse',
    username: 'etl',
    password: DB_PASSWORD,
    table: 'records',
  },
  fieldMappings: [{ sourceField: 'id', destinationField: 'id' }],
};

describe('PRC-H115 — ETL credential redaction', () => {
  let app: FastifyInstance;
  let repository: InMemoryPipelineRepository;

  beforeEach(async () => {
    app = Fastify();
    repository = new InMemoryPipelineRepository();
    const etlService = new ETLService(repository, {
      defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
    });
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });
    await registerETLRoutes(app, { etlService, prefix: '/pipelines' });
    await app.ready();
  });

  async function create(): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/pipelines', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.payload).not.toContain(DB_PASSWORD);
    expect(res.payload).not.toContain(API_TOKEN);
    return JSON.parse(res.payload).id as string;
  }

  it('GET /pipelines/:id and list never return password, authConfig or auth headers', async () => {
    const id = await create();
    const one = await app.inject({ method: 'GET', url: `/pipelines/${id}` });
    expect(one.statusCode).toBe(200);
    expect(one.payload).not.toContain(DB_PASSWORD);
    expect(one.payload).not.toContain(API_TOKEN);
    const parsed = JSON.parse(one.payload);
    expect(parsed.destination.password).toBe(REDACTED_SECRET);
    expect(parsed.source.authConfig.apiKey).toBe(REDACTED_SECRET);
    expect(parsed.source.headers.Authorization).toBe(REDACTED_SECRET);
    expect(parsed.source.headers.Accept).toBe('application/json');

    const list = await app.inject({ method: 'GET', url: '/pipelines' });
    expect(list.payload).not.toContain(DB_PASSWORD);
    expect(list.payload).not.toContain(API_TOKEN);
  });

  it('PUT with the placeholder keeps the stored secret; a new value replaces it', async () => {
    const id = await create();
    const fetched = JSON.parse(
      (await app.inject({ method: 'GET', url: `/pipelines/${id}` })).payload,
    );

    const put = await app.inject({
      method: 'PUT',
      url: `/pipelines/${id}`,
      payload: { source: fetched.source, destination: { ...fetched.destination, table: 'x' } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.payload).not.toContain(DB_PASSWORD);
    const stored = await repository.findById(id, tenantId);
    expect((stored!.destination as { password: string }).password).toBe(DB_PASSWORD);
    expect((stored!.source as { authConfig: Record<string, string> }).authConfig.apiKey).toBe(
      API_TOKEN,
    );
    expect((stored!.source as { headers: Record<string, string> }).headers.Authorization).toBe(
      `Bearer ${API_TOKEN}`,
    );

    await app.inject({
      method: 'PUT',
      url: `/pipelines/${id}`,
      payload: { destination: { ...fetched.destination, password: 'rotated' } },
    });
    const rotated = await repository.findById(id, tenantId);
    expect((rotated!.destination as { password: string }).password).toBe('rotated');
  });

  it('rejects the placeholder on create (it is never a real credential)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pipelines',
      payload: { ...body, destination: { ...body.destination, password: REDACTED_SECRET } },
    });
    expect(res.statusCode).toBe(400);
  });
});
