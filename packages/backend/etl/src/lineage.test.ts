/**
 * Thin lineage helper unit tests (P2-WH).
 */
import { describe, it, expect } from 'vitest';
import { buildExecutionLineage } from './lineage.js';
import type { Pipeline } from './schemas.js';

function basePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Lineage Test',
    description: null,
    source: {
      type: 'csv',
      fileContent: 'a,b\n1,2',
      hasHeader: true,
    },
    destination: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'dw',
      username: 'u',
      password: 'p',
      table: 'facts',
      schema: 'public',
    },
    fieldMappings: [{ sourceField: 'a', destinationField: 'a' }],
    schedule: null,
    retryPolicy: { maxRetries: 0, backoffMs: 0 },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildExecutionLineage', () => {
  it('builds thin lineage for csv → postgresql', () => {
    const lineage = buildExecutionLineage(basePipeline());
    expect(lineage).toEqual({
      sourceType: 'csv',
      destinationType: 'postgresql',
      sourceLabel: 'inline-csv',
      destinationLabel: 'public.facts',
      fieldMappingCount: 1,
    });
  });

  it('uses file path and truncates long postgresql queries', () => {
    const longQuery = `SELECT ${'x'.repeat(200)} FROM t`;
    const lineage = buildExecutionLineage(
      basePipeline({
        source: {
          type: 'postgresql',
          host: 'db',
          port: 5432,
          database: 'ops',
          username: 'u',
          password: 'p',
          query: longQuery,
        },
        destination: {
          type: 'rest_api',
          url: 'https://example.test/ingest',
        },
        fieldMappings: [
          { sourceField: 'a', destinationField: 'a' },
          { sourceField: 'b', destinationField: 'b' },
        ],
      }),
    );
    expect(lineage.sourceType).toBe('postgresql');
    expect(lineage.destinationType).toBe('rest_api');
    expect(lineage.sourceLabel.startsWith('ops:')).toBe(true);
    expect(lineage.sourceLabel.length).toBeLessThanOrEqual(120);
    expect(lineage.destinationLabel).toBe('https://example.test/ingest');
    expect(lineage.fieldMappingCount).toBe(2);
  });
});
