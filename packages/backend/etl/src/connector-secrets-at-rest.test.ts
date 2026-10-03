/**
 * PRC-M224 — connector credentials are sealed at rest, row values never reach
 * the log sink, and lineage labels drop query strings.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AesGcmConnectorSecretCipher,
  createConnectorSecretCipher,
  isSealedSecret,
} from './connector-secret-crypto.js';
import { ExecutionLogger, InMemoryLogSink } from './execution-logger.js';
import { buildExecutionLineage } from './lineage.js';
import { PgPipelineRepository } from './pg-pipeline-repository.js';
import type { Pipeline } from './schemas.js';

const TENANT = '5f0c3a2b-1d4e-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '6a1d4b3c-2e5f-4b7c-9d8e-0f1a2b3c4d5e';

/** Minimal pg pool double: stores etl_pipelines documents by id. */
function fakePool() {
  const docs = new Map<string, string>();
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^INSERT INTO etl_pipelines/.test(sql.trim())) {
        docs.set(String(params[0]), String(params[4]));
      } else if (/^UPDATE etl_pipelines/.test(sql.trim())) {
        docs.set(String(params[0]), String(params[4]));
      } else if (/SELECT document FROM etl_pipelines WHERE id=\$1/.test(sql)) {
        const d = docs.get(String(params[0]));
        return { rows: d ? [{ document: JSON.parse(d) }] : [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client, query: client.query }, docs };
}

function pipeline(): Pipeline {
  const now = new Date();
  return {
    id: '7b2e4c5d-3f6a-4c8d-ae9f-1a2b3c4d5e6f',
    tenantId: TENANT,
    name: 'p',
    description: null,
    source: {
      type: 'rest_api',
      url: 'https://api.example.com/x?token=abc',
      method: 'GET',
      authType: 'bearer',
      authConfig: { token: 'tok-SECRET' },
    },
    destination: {
      type: 'postgresql',
      host: 'db.example.com',
      port: 5432,
      database: 'w',
      username: 'u',
      password: 'pw-SECRET',
      table: 't',
      writeMode: 'insert',
    },
    fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
    schedule: null,
    retryPolicy: { maxRetries: 0, backoffMs: 100 },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  } as Pipeline;
}

describe('connector secrets at rest (PRC-M224)', () => {
  it('the stored document contains no plaintext password or token, and reads back', async () => {
    const { pool, docs } = fakePool();
    const cipher = new AesGcmConnectorSecretCipher(randomBytes(32));
    const repo = new PgPipelineRepository(pool as never, cipher);
    const p = pipeline();
    await repo.create(p);
    const raw = docs.get(p.id)!;
    expect(raw).not.toContain('pw-SECRET');
    expect(raw).not.toContain('tok-SECRET');
    const stored = JSON.parse(raw) as { destination: { password: string } };
    expect(isSealedSecret(stored.destination.password)).toBe(true);

    const back = await repo.findById(p.id, TENANT);
    expect((back!.destination as { password: string }).password).toBe('pw-SECRET');
    expect((back!.source as { authConfig: { token: string } }).authConfig.token).toBe(
      'tok-SECRET',
    );
  });

  it('ciphertext is tenant-bound', () => {
    const cipher = new AesGcmConnectorSecretCipher(randomBytes(32));
    const sealed = cipher.seal(TENANT, 'x');
    expect(() => cipher.open(OTHER, sealed)).toThrow();
  });

  it('production without a key refuses to store secrets (503)', async () => {
    const { pool } = fakePool();
    const cipher = createConnectorSecretCipher({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    const repo = new PgPipelineRepository(pool as never, cipher);
    await expect(repo.create(pipeline())).rejects.toMatchObject({ statusCode: 503 });
  });

  it('log sink output for a failed load carries no row values', () => {
    const sink = new InMemoryLogSink();
    const logger = new ExecutionLogger(sink);
    logger.logLoad('e1', 'p1', TENANT, {
      destinationType: 'rest_api',
      loadedCount: 0,
      errorCount: 1,
      durationMs: 1,
      errors: [{ row: 3, field: null, message: 'API error: 500', data: { email: 'a@b.c' } }],
    });
    logger.logTransformation('e1', 'p1', TENANT, {
      transformedCount: 0,
      errorCount: 1,
      durationMs: 1,
      errors: [{ row: 4, field: 'n', message: 'bad', data: { email: 'a@b.c' } } as never],
    });
    const out = JSON.stringify(sink.entries);
    expect(out).not.toContain('a@b.c');
    expect(out).toContain('"row":3');
  });

  it('lineage labels drop query strings and SQL text', () => {
    const p = pipeline();
    const lineage = buildExecutionLineage(p);
    expect(lineage.sourceLabel).toBe('https://api.example.com/x');
    const pg = buildExecutionLineage({
      ...p,
      source: {
        type: 'postgresql',
        host: 'h',
        port: 5432,
        database: 'w',
        username: 'u',
        password: 'p',
        query: "SELECT * FROM t WHERE ssn='123'",
      },
    } as Pipeline);
    expect(pg.sourceLabel).not.toContain('ssn');
  });
});
