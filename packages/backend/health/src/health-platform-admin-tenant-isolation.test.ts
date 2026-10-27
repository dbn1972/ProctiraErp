/**
 * D2 CORRECTION (PRC-M015) — platform_admin health / PHI tenant-isolation proof.
 *
 * platform_admin is the cross-tenant PLATFORM / control-plane operator; system_admin is the
 * per-TENANT administrator. The first D2 implementation wrongly added platform_admin alongside
 * system_admin to the health allow-lists (break-glass approver, tenant-wide actor, PHI access
 * log), granting a platform operator tenant-scoped student PHI access and breaking tenant
 * isolation. The correction removes platform_admin from those health allow-lists.
 *
 * These tests assert the corrected boundary and are the failing-first tenant-isolation proof:
 * they FAIL against the pre-correction over-grant and PASS after platform_admin is removed.
 *
 *  (a) platform_admin CANNOT approve break-glass, is NOT a tenant-wide health actor, and
 *      CANNOT read the PHI access log; and
 *  (b) the per-tenant admins (health_admin, system_admin) retain every grant — no regression.
 */
import { describe, expect, it } from 'vitest';

import { canApproveHealthBreakGlass } from './phi-field-acl.js';
import {
  HealthService,
  isTenantWideHealthActor,
  type HealthAccessContext,
  type HealthRepository,
} from './health-service.js';

function ctx(roles: string[]): HealthAccessContext {
  return { userId: 'u', roles };
}

// Minimal repository stub. `listPhiAccessLogs` is intentionally absent so the service returns
// `[]` for a privileged caller without a real data layer; an unprivileged caller is rejected
// before the repository is consulted.
const service = new HealthService({} as HealthRepository);

describe('platform_admin health tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin CANNOT approve a health PHI break-glass request', () => {
    expect(canApproveHealthBreakGlass(['platform_admin'])).toBe(false);
  });

  it('health_admin and system_admin can STILL approve (per-tenant admin unchanged)', () => {
    expect(canApproveHealthBreakGlass(['health_admin'])).toBe(true);
    expect(canApproveHealthBreakGlass(['system_admin'])).toBe(true);
  });

  it('an unrelated role still cannot approve (fail-closed unchanged)', () => {
    expect(canApproveHealthBreakGlass(['counsellor'])).toBe(false);
    expect(canApproveHealthBreakGlass(['teacher'])).toBe(false);
  });

  it('platform_admin is NOT a tenant-wide health actor; system_admin still is', () => {
    expect(isTenantWideHealthActor(ctx(['platform_admin']))).toBe(false);
    expect(isTenantWideHealthActor(ctx(['system_admin']))).toBe(true);
    expect(isTenantWideHealthActor(ctx(['health_admin']))).toBe(true);
    expect(isTenantWideHealthActor(ctx(['counsellor']))).toBe(false);
  });

  it('platform_admin CANNOT read the PHI access log; system_admin can', async () => {
    await expect(service.listPhiAccessLogs('tenant-1', ctx(['platform_admin']))).rejects.toThrow(
      /PHI access log/,
    );
    await expect(service.listPhiAccessLogs('tenant-1', ctx(['system_admin']))).resolves.toEqual([]);
  });
});
