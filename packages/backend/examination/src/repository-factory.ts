/**
 * Examination repository composition.
 *
 *   - `DATABASE_URL` set → Prisma repositories (Postgres + RLS)
 *   - otherwise          → in-memory repositories (dev / tests)
 *
 * The three factories share one Prisma client per database URL so wiring all
 * of them (examination + result + document) does not open three pools.
 */
import {
  assertInMemoryFallbackAllowed,
  createPrismaClient,
  getSharedPgPool,
} from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type { DocumentRepository } from './document-repository.js';
import type { ExaminationRepository } from './examination-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { InMemoryExamOpsStore, PgExamOpsStore, type ExamOpsStore } from './ops-store.js';
import { PrismaDocumentRepository } from './prisma-document-repository.js';
import { PrismaExaminationRepository } from './prisma-examination-repository.js';
import { PrismaResultRepository } from './prisma-result-repository.js';
import type { ResultRepository } from './result-repository.js';

export interface ExaminationRepositoryConfig {
  databaseUrl?: string;
}

const clientCache = new Map<string, PrismaClient>();

function resolveDatabaseUrl(config: ExaminationRepositoryConfig): string | undefined {
  return config.databaseUrl ?? process.env['DATABASE_URL'];
}

/** True when Postgres-backed examination repositories should be used. */
export function isPgExaminationEnabled(): boolean {
  return Boolean(process.env['DATABASE_URL']?.trim());
}

function getPrismaClient(databaseUrl: string): PrismaClient {
  let client = clientCache.get(databaseUrl);
  if (!client) {
    client = createPrismaClient({ datasourceUrl: databaseUrl });
    clientCache.set(databaseUrl, client);
  }
  return client;
}

export function createExaminationRepository(
  config: ExaminationRepositoryConfig = {},
): ExaminationRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    assertInMemoryFallbackAllowed('examination');
    return new InMemoryExaminationRepository();
  }
  return new PrismaExaminationRepository(getPrismaClient(databaseUrl));
}

export function createResultRepository(config: ExaminationRepositoryConfig = {}): ResultRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemoryResultRepository();
  }
  return new PrismaResultRepository(getPrismaClient(databaseUrl));
}

export function createExamOpsStore(config: ExaminationRepositoryConfig = {}): ExamOpsStore {
  const databaseUrl = resolveDatabaseUrl(config);
  const pool = getSharedPgPool(databaseUrl);
  if (!pool) {
    assertInMemoryFallbackAllowed('examination');
    return new InMemoryExamOpsStore();
  }
  return new PgExamOpsStore(pool);
}

export function createDocumentRepository(
  config: ExaminationRepositoryConfig = {},
  seatingStore?: ExamOpsStore,
): DocumentRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemoryDocumentRepository(seatingStore);
  }
  return new PrismaDocumentRepository(getPrismaClient(databaseUrl), seatingStore);
}
