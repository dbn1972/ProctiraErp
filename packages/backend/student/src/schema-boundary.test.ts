/**
 * Phase 4 student schema boundary checks (charter §19).
 * Student-owned models live in schema "student" with bare tenant_id.
 * Enrollment may relate to Student in-schema, but not to institution/Tenant.
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

describe('Phase 4 student schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('declares student among service-owned schemas', () => {
    expect(schema).toMatch(
      /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/,
    );
  });

  it('places student-owned models in @@schema("student")', () => {
    for (const model of [
      'Student',
      'Enrollment',
      'EnrollmentHistory',
      'StudentTransfer',
    ]) {
      expect(modelBody(schema, model)).toContain('@@schema("student")');
    }
  });

  it('keeps student tenant_id as a bare UUID without Tenant relation/FK', () => {
    for (const model of [
      'Student',
      'Enrollment',
      'EnrollmentHistory',
      'StudentTransfer',
    ]) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\bstudents\s+Student\[\]/);
    expect(tenant).not.toMatch(/\benrollments\s+Enrollment\[\]/);
    expect(tenant).not.toMatch(/\benrollmentHistory\s+EnrollmentHistory\[\]/);
    expect(tenant).not.toMatch(/\bstudentTransfers\s+StudentTransfer\[\]/);
  });

  it('allows Enrollment→Student in-schema relation but not institution joins', () => {
    const body = modelBody(schema, 'Enrollment');
    expect(body).toMatch(/student\s+Student\s+@relation/);
    expect(body).not.toMatch(/institution\s+Institution\s+@relation/);
    expect(body).not.toMatch(/grade\s+Grade\s+@relation/);
    expect(body).not.toMatch(/class\s+Class\?\s+@relation/);
    expect(body).not.toMatch(/academicPeriod\s+AcademicPeriod\s+@relation/);
  });
});
