/**
 * Synthetic tenants every aitest stack seeds (program plan D6).
 *
 * S is the rich victim tenant (Sunrise demo + UAT detail records); A is the
 * attacker tenant for cross-tenant checks. AA/BB/REG come from the repo's e2e
 * seeds; SUSP and EMPTY from aitest-tenants.sql. No real personal data.
 */
export type TenantKey = 'S' | 'A' | 'AA' | 'BB' | 'REG' | 'SUSP' | 'EMPTY';

export interface TenantInfo {
  id: string;
  slug: string;
  status: 'active' | 'suspended';
  note: string;
}

export const TENANTS: Readonly<Record<TenantKey, TenantInfo>> = Object.freeze({
  S: {
    id: '00000000-0000-4000-8000-00000000a501',
    slug: 'sunrise-public-school',
    status: 'active',
    note: 'victim: Sunrise demo seed (006) + UAT detail records',
  },
  A: {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'e2e-tenant-a',
    status: 'active',
    note: 'attacker: e2e tenant A (students, guardian household, institution, section)',
  },
  AA: {
    id: '00000000-0000-4000-8000-0000000000aa',
    slug: 'e2e-tenant-aa',
    status: 'active',
    note: 'e2e tenant AA (health smokes), tenant row only',
  },
  BB: {
    id: '00000000-0000-4000-8000-0000000000bb',
    slug: 'e2e-tenant-bb',
    status: 'active',
    note: 'e2e tenant BB (isolation), tenant row only',
  },
  REG: {
    id: '00000000-0000-4000-8000-00000000e001',
    slug: 'e2e-registration',
    status: 'active',
    note: 'registration portal fixture: institution + published admission form',
  },
  SUSP: {
    id: '00000000-0000-4000-8000-0000000a1701',
    slug: 'aitest-suspended',
    status: 'suspended',
    note: 'aitest: suspended tenant with one institution',
  },
  EMPTY: {
    id: '00000000-0000-4000-8000-0000000a1702',
    slug: 'aitest-empty',
    status: 'active',
    note: 'aitest: active tenant with no data',
  },
});

export const TENANT_KEYS = Object.keys(TENANTS) as TenantKey[];

/** Registration fixture institution (seed-e2e-registration.sql -v institution_id). */
export const REGISTRATION_INSTITUTION_ID = '00000000-0000-4000-8000-00000000e101';

export function tenantKeyForId(id: string): TenantKey | undefined {
  return TENANT_KEYS.find((k) => TENANTS[k].id === id);
}
