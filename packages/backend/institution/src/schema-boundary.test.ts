/**
 * Phase 3 institution schema boundary checks (charter §19).
 * Institution-owned models live in schema "institution" with bare tenant_id
 * (no Tenant relation/FK). Enrollment (student schema) must not Prisma-join institution tables.
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

const INSTITUTION_MODELS = [
  'GeographicArea',
  'Board',
  'Institution',
  'AcademicPeriod',
  'Grade',
  'Class',
  'Subject',
  'InstitutionSubject',
] as const;

describe('Phase 3 institution schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('declares institution among service-owned schemas', () => {
    expect(schema).toMatch(
      /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"public"\]/,
    );
  });

  it('places institution-owned models in @@schema("institution")', () => {
    for (const model of INSTITUTION_MODELS) {
      expect(modelBody(schema, model)).toContain('@@schema("institution")');
    }
  });

  it('keeps institution tenant_id as a bare UUID without Tenant relation/FK', () => {
    for (const model of INSTITUTION_MODELS) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\binstitutions\s+Institution\[\]/);
    expect(tenant).not.toMatch(/\bboards\s+Board\[\]/);
    expect(tenant).not.toMatch(/\bgeographicAreas\s+GeographicArea\[\]/);
    expect(tenant).not.toMatch(/\bacademicPeriods\s+AcademicPeriod\[\]/);
    expect(tenant).not.toMatch(/\bgrades\s+Grade\[\]/);
    expect(tenant).not.toMatch(/\bclasses\s+Class\[\]/);
  });

  it('keeps Enrollment institution/grade/class/period refs as bare UUIDs', () => {
    const body = modelBody(schema, 'Enrollment');
    expect(body).toContain('@@schema("student")');
    expect(body).toMatch(/institutionId\s+String/);
    expect(body).toMatch(/gradeId\s+String/);
    expect(body).toMatch(/classId\s+String\?/);
    expect(body).toMatch(/academicPeriodId\s+String/);
    expect(body).not.toMatch(/institution\s+Institution\s+@relation/);
    expect(body).not.toMatch(/grade\s+Grade\s+@relation/);
    expect(body).not.toMatch(/class\s+Class\?\s+@relation/);
    expect(body).not.toMatch(/academicPeriod\s+AcademicPeriod\s+@relation/);
  });
});
