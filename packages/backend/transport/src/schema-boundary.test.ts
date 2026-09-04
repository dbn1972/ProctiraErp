/**
 * Phase 10 transport schema boundary checks (charter §19).
 * Transport-owned models live in schema "transport" with bare tenant_id.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(
  __dirname,
  '../../../shared/database/prisma/schema.prisma',
);

function modelBody(schemaText: string, modelName: string): string {
  const start = schemaText.indexOf(`model ${modelName} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const after = schemaText.slice(start);
  const end = after.indexOf('\n}');
  expect(end).toBeGreaterThan(0);
  return after.slice(0, end);
}

const MODELS = ['TransportRoute', 'RouteStop', 'Vehicle', 'DriverAssignment', 'StudentRouteAssignment'] as const;

const SCHEMAS_RE = /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/;

describe('Phase 10 transport schema boundaries', () => {
  const schemaText = readFileSync(schemaPath, 'utf8');

  it('declares transport among service-owned schemas', () => {
    expect(schemaText).toMatch(SCHEMAS_RE);
  });

  it('places transport-owned models in @@schema("transport")', () => {
    for (const model of MODELS) {
      expect(modelBody(schemaText, model)).toContain('@@schema("transport")');
    }
  });

  it('keeps transport tenant ids as bare UUIDs (no Tenant @relation)', () => {
    for (const model of MODELS) {
      const body = modelBody(schemaText, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
    }
  });
});
