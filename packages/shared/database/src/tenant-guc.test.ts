/**
 * W1-DATA-12 — canonical tenant GUC binder unit tests.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  APP_TENANT_ID_GUC,
  APP_TENANT_ID_LEGACY_GUC,
  BIND_TENANT_GUC_SQL,
  bindTenantGuc,
  bindTenantGucPrisma,
} from './tenant-guc.js';

describe('tenant-guc (W1-DATA-12)', () => {
  it('exports canonical and legacy GUC names', () => {
    expect(APP_TENANT_ID_GUC).toBe('app.tenant_id');
    expect(APP_TENANT_ID_LEGACY_GUC).toBe('app.current_tenant_id');
    expect(BIND_TENANT_GUC_SQL).toContain("set_config('app.tenant_id', $1, true)");
    expect(BIND_TENANT_GUC_SQL).toContain("set_config('app.current_tenant_id', $1, true)");
  });

  it('bindTenantGuc sets canonical + legacy alias in one parameterized statement', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await bindTenantGuc({ query }, 'tenant-a');
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(BIND_TENANT_GUC_SQL, ['tenant-a']);
  });

  it('bindTenantGucPrisma uses the same SQL via $executeRawUnsafe', async () => {
    const $executeRawUnsafe = vi.fn(async () => 0);
    await bindTenantGucPrisma({ $executeRawUnsafe }, '11111111-1111-4111-8111-111111111111');
    expect($executeRawUnsafe).toHaveBeenCalledWith(
      BIND_TENANT_GUC_SQL,
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('rejects empty tenant ids', async () => {
    await expect(bindTenantGuc({ query: async () => ({}) }, '  ')).rejects.toThrow(/tenantId/);
    await expect(
      bindTenantGucPrisma({ $executeRawUnsafe: async () => 0 }, ''),
    ).rejects.toThrow(/tenantId/);
  });
});
