/**
 * D2 role-catalogue normalization (PRC-M015) — health PHI / break-glass widening proof.
 *
 * The system_admin -> platform_admin normalization is ADD-ONLY in the health module: every
 * list that named system_admin now also names platform_admin, and system_admin is never
 * removed. This widens who may approve break-glass / read PHI logs / act tenant-wide, so it
 * is flagged for the security reviewer in-source. These tests fix the resulting contract:
 *
 *  (a) platform_admin can now approve a health PHI break-glass request and act tenant-wide; and
 *  (b) the previously-authorized roles (health_admin, system_admin) retain every grant.
 */
import { describe, expect, it } from 'vitest';

import { canApproveHealthBreakGlass } from './phi-field-acl.js';
import { isTenantWideHealthActor, type HealthAccessContext } from './health-service.js';

function ctx(roles: string[]): HealthAccessContext {
  return { userId: 'u', roles };
}

describe('health break-glass / PHI platform_admin widening (D2)', () => {
  it('platform_admin can now approve a break-glass request (widening, flagged)', () => {
    expect(canApproveHealthBreakGlass(['platform_admin'])).toBe(true);
  });

  it('health_admin and system_admin can STILL approve (no removal)', () => {
    expect(canApproveHealthBreakGlass(['health_admin'])).toBe(true);
    expect(canApproveHealthBreakGlass(['system_admin'])).toBe(true);
  });

  it('an unrelated role still cannot approve (fail-closed unchanged)', () => {
    expect(canApproveHealthBreakGlass(['counsellor'])).toBe(false);
    expect(canApproveHealthBreakGlass(['teacher'])).toBe(false);
  });

  it('platform_admin is now a tenant-wide health actor alongside system_admin', () => {
    expect(isTenantWideHealthActor(ctx(['platform_admin']))).toBe(true);
    expect(isTenantWideHealthActor(ctx(['system_admin']))).toBe(true);
    expect(isTenantWideHealthActor(ctx(['health_admin']))).toBe(true);
    expect(isTenantWideHealthActor(ctx(['counsellor']))).toBe(false);
  });
});
