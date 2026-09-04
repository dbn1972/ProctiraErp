/**
 * Phase 7 examination schema boundary checks (charter §19).
 * Examination-owned models live in schema "examination" with bare tenant_id
 * (and bare student/period/center/area ids — no Tenant/Student joins).
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
  'Examination',
  'ExaminationCandidateRegistration',
  'ExaminationCandidate',
  'ExaminationPublication',
  'ExaminationResultAnalysis',
  'ExaminationAcademicRecord',
  'ExaminationDocumentJob',
] as const;

const SCHEMAS_RE =
  /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/;

describe('Phase 7 examination schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('declares examination among service-owned schemas', () => {
    expect(schema).toMatch(SCHEMAS_RE);
  });

  it('places examination-owned models in @@schema("examination")', () => {
    for (const model of MODELS) {
      expect(modelBody(schema, model)).toContain('@@schema("examination")');
    }
  });

  it('keeps examination tenant and foreign domain ids as bare UUIDs', () => {
    for (const model of MODELS) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
      expect(body).not.toMatch(/student\s+Student\s+@relation/);
      expect(body).not.toMatch(/academicPeriod\s+AcademicPeriod\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\bexaminations\s+Examination\[\]/);
    expect(tenant).not.toMatch(
      /\bexaminationCandidateRegistrations\s+ExaminationCandidateRegistration\[\]/,
    );
    expect(tenant).not.toMatch(/\bexaminationCandidates\s+ExaminationCandidate\[\]/);
    expect(tenant).not.toMatch(
      /\bexaminationPublications\s+ExaminationPublication\[\]/,
    );
    expect(tenant).not.toMatch(
      /\bexaminationResultAnalyses\s+ExaminationResultAnalysis\[\]/,
    );
    expect(tenant).not.toMatch(
      /\bexaminationAcademicRecords\s+ExaminationAcademicRecord\[\]/,
    );
    expect(tenant).not.toMatch(
      /\bexaminationDocumentJobs\s+ExaminationDocumentJob\[\]/,
    );
  });
});
