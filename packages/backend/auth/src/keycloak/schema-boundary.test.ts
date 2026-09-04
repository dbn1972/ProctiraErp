/**
 * Phase 2 auth schema boundary checks (charter §19).
 * Ensures the Prisma schema declares platform/auth ownership and that auth
 * models do not declare cross-service Tenant relations.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(
  __dirname,
  '../../../../../packages/shared/database/prisma/schema.prisma',
);

function modelBody(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const after = schema.slice(start);
  const end = after.indexOf('\n}');
  expect(end).toBeGreaterThan(0);
  return after.slice(0, end);
}

describe('Phase 2 platform/auth schema boundaries', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  it('enables multi-schema ownership for platform through attendance schemas', () => {
    expect(schema).toMatch(/schemas\s*=\s*\["platform",\s*"auth",\s*"institution",\s*"student",\s*"attendance",\s*"assessment",\s*"examination",\s*"staff",\s*"scholarship",\s*"transport",\s*"health",\s*"workflow",\s*"notification",\s*"report",\s*"survey",\s*"registration",\s*"public"\]/);
  });

  it('places tenants and themes in platform and identity tables in auth', () => {
    expect(modelBody(schema, 'Tenant')).toContain('@@schema("platform")');
    expect(modelBody(schema, 'TenantThemeVersion')).toContain('@@schema("platform")');
    expect(modelBody(schema, 'TenantThemeDraft')).toContain('@@schema("platform")');
    expect(modelBody(schema, 'User')).toContain('@@schema("auth")');
    expect(modelBody(schema, 'UserIdentity')).toContain('@@schema("auth")');
    expect(modelBody(schema, 'RefreshToken')).toContain('@@schema("auth")');
    expect(modelBody(schema, 'UserSession')).toContain('@@schema("auth")');
    expect(modelBody(schema, 'UserRoleAssignment')).toContain('@@schema("auth")');
    expect(modelBody(schema, 'UserInvite')).toContain('@@schema("auth")');
  });

  it('keeps auth tenant_id as a bare UUID without Tenant relation/FK', () => {
    for (const model of [
      'User',
      'UserIdentity',
      'RefreshToken',
      'UserSession',
      'UserRoleAssignment',
      'UserInvite',
    ]) {
      const body = modelBody(schema, model);
      expect(body).toMatch(/tenantId\s+String/);
      expect(body).not.toMatch(/tenant\s+Tenant\s+@relation/);
    }
    const tenant = modelBody(schema, 'Tenant');
    expect(tenant).not.toMatch(/\busers\s+User\[\]/);
    expect(tenant).not.toMatch(/\bidentities\s+UserIdentity\[\]/);
    expect(tenant).not.toMatch(/\brefreshTokens\s+RefreshToken\[\]/);
    expect(tenant).not.toMatch(/\bsessions\s+UserSession\[\]/);
  });
});
