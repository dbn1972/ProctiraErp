/**
 * Plans + entitlements API client.
 */
import { gatewayFetch } from './gateway';

export interface Plan {
  id: string;
  name: string;
  tier: 'pilot' | 'standard' | 'enterprise';
  /** Active subscription count (display-only). */
  activeTenants: number;
  /** Feature entitlements granted by this plan. */
  entitlements: Entitlement[];
  /** Optional included quotas (rate limits, storage, etc.). */
  quotas?: Record<string, number>;
}

export interface Entitlement {
  key: string;
  label: string;
  description?: string;
  enabled: boolean;
}

const STUB_PLANS: Plan[] = [
  {
    id: 'plan_pilot',
    name: 'Pilot',
    tier: 'pilot',
    activeTenants: 6,
    entitlements: [
      { key: 'core', label: 'Core SIS', enabled: true },
      { key: 'sis', label: 'Student Information', enabled: true },
      { key: 'lms', label: 'Learning Management', enabled: false },
      { key: 'analytics', label: 'Analytics', enabled: false },
      { key: 'finance', label: 'Finance & Billing', enabled: false },
    ],
    quotas: { users: 250, storageGB: 5 },
  },
  {
    id: 'plan_standard',
    name: 'Standard',
    tier: 'standard',
    activeTenants: 42,
    entitlements: [
      { key: 'core', label: 'Core SIS', enabled: true },
      { key: 'sis', label: 'Student Information', enabled: true },
      { key: 'lms', label: 'Learning Management', enabled: true },
      { key: 'analytics', label: 'Analytics', enabled: false },
      { key: 'finance', label: 'Finance & Billing', enabled: false },
    ],
    quotas: { users: 5000, storageGB: 100 },
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    tier: 'enterprise',
    activeTenants: 11,
    entitlements: [
      { key: 'core', label: 'Core SIS', enabled: true },
      { key: 'sis', label: 'Student Information', enabled: true },
      { key: 'lms', label: 'Learning Management', enabled: true },
      { key: 'analytics', label: 'Analytics', enabled: true },
      { key: 'finance', label: 'Finance & Billing', enabled: true },
    ],
    quotas: { users: 100000, storageGB: 5000 },
  },
];

export async function listPlans(): Promise<{
  plans: Plan[];
  source: 'gateway' | 'stub';
}> {
  const response = await gatewayFetch<{ items?: Plan[]; data?: Plan[] }>(
    '/plans',
  );
  if (response.ok && response.data) {
    return {
      plans: response.data.items ?? response.data.data ?? [],
      source: 'gateway',
    };
  }
  return { plans: STUB_PLANS, source: 'stub' };
}

export async function getPlan(
  id: string,
): Promise<{ plan: Plan | null; source: 'gateway' | 'stub' }> {
  const response = await gatewayFetch<Plan>(`/plans/${id}`);
  if (response.ok && response.data) {
    return { plan: response.data, source: 'gateway' };
  }
  return {
    plan: STUB_PLANS.find((p) => p.id === id) ?? null,
    source: 'stub',
  };
}

export interface UpdatePlanEntitlementsInput {
  planId: string;
  entitlements: Array<{ key: string; enabled: boolean }>;
}

export async function updatePlanEntitlements(
  input: UpdatePlanEntitlementsInput,
): Promise<{ ok: boolean; error?: string }> {
  const response = await gatewayFetch<unknown>(
    `/plans/${input.planId}/entitlements`,
    { method: 'PUT', json: { entitlements: input.entitlements } },
  );
  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: true };
  return {
    ok: false,
    error: response.error?.message ?? 'Failed to update entitlements.',
  };
}
