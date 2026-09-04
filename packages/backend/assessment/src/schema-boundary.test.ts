/**
 * Phase 6 assessment schema boundary checks (charter §19).
 * Assessment-owned models live in schema "assessment" with bare tenant_id
 * (and bare subject/student/period/scheme ids — no Tenant/Student/Subject joins).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(
  __dirname,
  '../../../shared/database/prisma/schema.prisma',
);

function modelBody(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const after = schema.slice(start);
  const end = after.indexOf('\n}');
  expect(end).toBeGreaterThan(0);
  return after.slice(0, end);
}

const MODELS = [
  'GradingScheme',
  'AssessmentItem',
  'AssessmentOutcome',
  'AssessmentResult',
] as const;

describe('Phase 6 assessment schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('declares assessment among service-owned schemas', () => {
    expect(schema).toMatch(
      /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"public"\]/,
    );
  });

  it('places assessment-owned models in @@schema("assessment")', () => {
    for (const model of MODELS) {
      expect(modelBody(schema, model)).toContain('@@schema("assessment")');
    }
  });

  it('keeps assessment tenant and foreign domain ids as bare UUIDs', () => {
    for (const model of MODELS) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
      expect(body).not.toMatch(/student\s+Student\s+@relation/);
      expect(body).not.toMatch(/subject\s+Subject\s+@relation/);
      expect(body).not.toMatch(/academicPeriod\s+AcademicPeriod\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\bgradingSchemes\s+GradingScheme\[\]/);
    expect(tenant).not.toMatch(/\bassessmentItems\s+AssessmentItem\[\]/);
    expect(tenant).not.toMatch(/\bassessmentOutcomes\s+AssessmentOutcome\[\]/);
    expect(tenant).not.toMatch(/\bassessmentResults\s+AssessmentResult\[\]/);
  });
});
