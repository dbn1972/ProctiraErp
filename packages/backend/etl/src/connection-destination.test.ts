/**
 * PRC-M109 — destinations referenced by a server-managed connection id; the
 * registry exposes ids/labels only and unknown ids fail closed.
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listDestinationConnections,
  resolveDestinationConnection,
} from './connectors/connection-registry.js';
import { defaultConnectorFactory, type ConnectorFactory } from './connectors/index.js';
import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { registerETLRoutes } from './routes.js';
import { MemoryDestination } from './test-support/memory-connector-factory.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const REGISTRY = JSON.stringify({
  warehouse: {
    label: 'District warehouse',
    type: 'postgresql',
    host: 'dw.internal',
    port: 5433,
    database: 'dw',
    username: 'loader',
    password: 's3cret',
  },
  'bad id!': { type: 'postgresql', host: 'x', database: 'y', username: 'z' },
});

async function app(connectorFactory?: ConnectorFactory) {
  const fastify = Fastify();
  fastify.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = tenantId;
    (request as unknown as { user: unknown }).user = {
      sub: 'etl-user',
      tenantId,
      roles: [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }],
    };
  });
  await registerETLRoutes(fastify, {
    etlService: new ETLService(new InMemoryPipelineRepository(), {
      defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
      connectorFactory,
    }),
    prefix: '/pipelines',
  });
  await fastify.ready();
  return fastify;
}

const body = (connectionId: string) => ({
  name: 'Roster export',
  source: { type: 'csv', fileContent: 'id,name\n1,A', hasHeader: true },
  destination: { type: 'connection', connectionId, table: 'roster' },
  fieldMappings: [{ sourceField: 'id', destinationField: 'id' }],
  enabled: false,
});

describe('connection destinations (PRC-M109)', () => {
  const previous = process.env.ETL_DESTINATION_CONNECTIONS;
  beforeEach(() => {
    process.env.ETL_DESTINATION_CONNECTIONS = REGISTRY;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.ETL_DESTINATION_CONNECTIONS;
    else process.env.ETL_DESTINATION_CONNECTIONS = previous;
  });

  it('lists ids and labels only, skipping invalid ids', () => {
    expect(listDestinationConnections()).toEqual([
      { id: 'warehouse', label: 'District warehouse', type: 'postgresql' },
    ]);
    expect(JSON.stringify(listDestinationConnections())).not.toContain('s3cret');
  });

  it('resolves a reference server-side', () => {
    expect(
      resolveDestinationConnection({ connectionId: 'warehouse', table: 'roster' }),
    ).toMatchObject({ type: 'postgresql', host: 'dw.internal', port: 5433, table: 'roster' });
    expect(resolveDestinationConnection({ connectionId: 'nope', table: 'x' })).toBeNull();
  });

  it('GET /pipelines/connections never returns credentials', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/pipelines/connections' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('s3cret');
    expect(res.payload).not.toContain('dw.internal');
    expect(res.json().data).toHaveLength(1);
  });

  it('creates a pipeline from a connection id and rejects an unknown one', async () => {
    // Known ids resolve server-side to a postgresql destination; that connector
    // is fail-closed (PRC-M222), so route resolved connections to a memory sink.
    const server = await app({
      createSource: (config) => defaultConnectorFactory.createSource(config),
      createDestination: (config) =>
        config.type === 'connection' && resolveDestinationConnection(config)
          ? new MemoryDestination()
          : defaultConnectorFactory.createDestination(config),
    });
    const ok = await server.inject({
      method: 'POST',
      url: '/pipelines',
      payload: body('warehouse'),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().destination).toEqual({
      type: 'connection',
      connectionId: 'warehouse',
      table: 'roster',
    });
    expect(ok.json().enabled).toBe(false);
    const bad = await server.inject({ method: 'POST', url: '/pipelines', payload: body('ghost') });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
  });

  it('fails closed (501) for a known connection while the postgresql destination is unimplemented', async () => {
    const server = await app();
    const res = await server.inject({
      method: 'POST',
      url: '/pipelines',
      payload: body('warehouse'),
    });
    expect(res.statusCode).toBe(501);
    expect(res.payload).not.toContain('s3cret');
    expect(res.payload).not.toContain('dw.internal');
    const list = await server.inject({ method: 'GET', url: '/pipelines' });
    expect(list.json().data).toHaveLength(0);
  });

  it('offers no connections when the registry is unset or malformed', () => {
    process.env.ETL_DESTINATION_CONNECTIONS = '{not json';
    expect(listDestinationConnections()).toEqual([]);
    delete process.env.ETL_DESTINATION_CONNECTIONS;
    expect(listDestinationConnections()).toEqual([]);
  });
});
