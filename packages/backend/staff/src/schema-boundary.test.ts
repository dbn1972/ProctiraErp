/**
 * Phase 8 staff schema boundary checks (charter §19).
 * Staff-owned models live in schema "staff" with bare tenant_id
 * (and bare institution/subject/class/staff ids — no Tenant joins).
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
  'Staff',
  'StaffAssignment',
  'StaffAppraisalTemplate',
  'StaffAppraisal',
  'StaffTrainingProgram',
  'StaffTrainingSession',
  'StaffTrainingAttendance',
  'StaffCertification',
] as const;

const SCHEMAS_RE =
  /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/;

describe('Phase 8 staff schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('declares staff among service-owned schemas', () => {
    expect(schema).toMatch(SCHEMAS_RE);
  });

  it('places staff-owned models in @@schema("staff")', () => {
    for (const model of MODELS) {
      expect(modelBody(schema, model)).toContain('@@schema("staff")');
    }
  });

  it('keeps staff tenant and foreign domain ids as bare UUIDs', () => {
    for (const model of MODELS) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
      expect(body).not.toMatch(/institution\s+Institution\s+@relation/);
      expect(body).not.toMatch(/subject\s+Subject\s+@relation/);
      expect(body).not.toMatch(/class\s+Class\s+@relation/);
    }
    const assignment = modelBody(schema, 'StaffAssignment');
    expect(assignment).not.toMatch(/staff\s+Staff\s+@relation/);
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\bstaff\s+Staff\[\]/);
    expect(tenant).not.toMatch(/\bstaffAssignments\s+StaffAssignment\[\]/);
  });
});
