/**
 * PRC-H052 — the durable worker must inject the shared (Postgres-backed)
 * DocumentBlobStore so worker-generated PDFs are downloadable by the API, and
 * must fail closed in production when no durable store is configured.
 *
 * These unit tests exercise the exported builders directly (the module no
 * longer auto-runs main() on import), so no broker/DB is required.
 */
import { type DocumentBlobStore, DocumentGenerationService } from '@proctira/backend-examination';
import { describe, it, expect } from 'vitest';

import { buildDocumentGenerationService, resolveWorkerBlobStore } from '../main.js';

class FakeBlobStore implements DocumentBlobStore {
  async put(): Promise<void> {}
  async get(): Promise<Buffer | null> {
    return null;
  }
}

describe('PRC-H052 worker blob store wiring', () => {
  it('returns the durable store from the factory when one is configured', () => {
    const durable = new FakeBlobStore();
    const resolved = resolveWorkerBlobStore(() => durable, {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(resolved).toBe(durable);
  });

  it('fails closed in production when no durable store is available (DATABASE_URL unset)', () => {
    expect(() =>
      resolveWorkerBlobStore(() => null, { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/PRC-H052/);
  });

  it('allows an undefined store outside production (dev/test convenience)', () => {
    const resolved = resolveWorkerBlobStore(() => null, { NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(resolved).toBeUndefined();
  });

  it('injects the resolved blob store into the DocumentGenerationService', () => {
    const durable = new FakeBlobStore();
    const service = buildDocumentGenerationService(durable);
    expect(service).toBeInstanceOf(DocumentGenerationService);
    // The service keeps the injected store on a private field; assert via the
    // documented behaviour that it is not the in-memory default by reading the
    // private reference (test-only).
    const injected = (service as unknown as { blobStore: DocumentBlobStore }).blobStore;
    expect(injected).toBe(durable);
  });
});
