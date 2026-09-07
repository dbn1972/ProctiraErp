/**
 * Communication repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import type { CommunicationRepository } from './communication-repository.js';
import { InMemoryCommunicationRepository } from './in-memory-repository.js';
import {
  getSharedCommunicationPool,
  PgCommunicationRepository,
} from './pg-communication-repository.js';

export function isPgCommunicationEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createCommunicationRepository(): CommunicationRepository {
  if (isPgCommunicationEnabled()) {
    const pool = getSharedCommunicationPool();
    if (pool) return new PgCommunicationRepository(pool);
  }
  return new InMemoryCommunicationRepository();
}
