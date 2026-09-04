/**
 * Phase 5 attendance schema boundary checks (charter §19).
 * Attendance-owned models live in schema "attendance" with bare tenant_id /
 * student_id / institution_id (no Tenant/Student/Institution Prisma relations).
 * Repository must not use include:{ student } joins.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(
  __dirname,
  '../../../shared/database/prisma/schema.prisma',
);
const repoPath = resolve(__dirname, './prisma-attendance-repository.ts');

function modelBody(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const after = schema.slice(start);
  const end = after.indexOf('\n}');
  expect(end).toBeGreaterThan(0);
  return after.slice(0, end);
}

describe('Phase 5 attendance schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const repo = readFileSync(repoPath, 'utf8');

  it('declares attendance among service-owned schemas', () => {
    expect(schema).toMatch(
      /schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/,
    );
  });

  it('places attendance-owned models in @@schema("attendance")', () => {
    for (const model of [
      'StudentAttendance',
      'StaffAttendance',
      'AttendanceAudit',
    ]) {
      expect(modelBody(schema, model)).toContain('@@schema("attendance")');
    }
  });

  it('keeps attendance tenant/student/institution refs as bare UUIDs', () => {
    for (const model of ['StudentAttendance', 'StaffAttendance']) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
      expect(body).not.toMatch(/student\s+Student\s+@relation/);
      expect(body).not.toMatch(/institution\s+Institution\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\bstudentAttendance\s+StudentAttendance\[\]/);
    expect(tenant).not.toMatch(/\bstaffAttendance\s+StaffAttendance\[\]/);
  });

  it('does not Prisma-include student in the attendance repository', () => {
    expect(repo).not.toMatch(/include:\s*\{\s*student\s*:\s*true\s*\}/);
    expect(repo).toMatch(/tx\.student\.findMany/);
    expect(repo).toMatch(/tx\.enrollment\.findMany/);
  });
});
