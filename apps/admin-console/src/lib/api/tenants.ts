/**
 * Tenant management API client + stub fixtures.
 *
 * Calls /tenants endpoints on the tenant-service via the gateway. When the
 * gateway is unavailable (developer running the admin console standalone)
 * we fall back to deterministic stub data so the screens still render.
 */
import {
  type AdminDataSource,
  GATEWAY_UNREACHABLE_WRITE_ERROR,
  gatewayFetch,
  unreachableFallback,
} from './gateway';
import { RESOURCE_ID_PATTERN, pathSegment, verbSegment } from './path-segment';

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'decommissioning' | 'archived';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: string;
  region: string;
  createdAt: string;
  /** Null when the tenant service does not hold it (PRC-H005). */
  contactEmail: string | null;
  /** Number of active users; null when unknown — never a fabricated 0 (PRC-H005). */
  activeUsers: number | null;
  /** Latest entitlement summary. */
  entitlements: string[];
}

const STUB_TENANTS: Tenant[] = [
  {
    id: 'tnt_001',
    slug: 'ministry-edu',
    name: 'Ministry of Education',
    status: 'active',
    plan: 'enterprise',
    region: 'us-east-1',
    createdAt: '2024-01-15T08:00:00Z',
    contactEmail: 'admin@ministry-edu.gov',
    activeUsers: 12450,
    entitlements: ['core', 'analytics', 'sis', 'lms', 'finance'],
  },
  {
    id: 'tnt_002',
    slug: 'district-northwest',
    name: 'Northwest School District',
    status: 'active',
    plan: 'standard',
    region: 'us-west-2',
    createdAt: '2024-03-22T10:30:00Z',
    contactEmail: 'it@nwsd.edu',
    activeUsers: 3220,
    entitlements: ['core', 'sis', 'lms'],
  },
  {
    id: 'tnt_003',
    slug: 'pilot-school',
    name: 'Pilot Demonstration School',
    status: 'suspended',
    plan: 'pilot',
    region: 'eu-west-1',
    createdAt: '2024-08-01T09:15:00Z',
    contactEmail: 'pilot@example.org',
    activeUsers: 0,
    entitlements: ['core'],
  },
  {
    id: 'tnt_004',
    slug: 'evergreen-academy',
    name: 'Evergreen Academy',
    status: 'provisioning',
    plan: 'standard',
    region: 'us-east-1',
    createdAt: '2025-02-10T14:00:00Z',
    contactEmail: 'admin@evergreen.edu',
    activeUsers: 0,
    entitlements: ['core', 'sis'],
  },
];

export interface ListTenantsParams {
  status?: TenantStatus | 'all';
  search?: string;
}

/** List tenants. Falls back to stub data when gateway is unavailable. */
export async function listTenants(params: ListTenantsParams = {}): Promise<{
  tenants: Tenant[];
  source: AdminDataSource;
}> {
  const search = new URLSearchParams();
  if (params.status && params.status !== 'all') {
    search.set('status', params.status);
  }
  if (params.search) search.set('q', params.search);

  const path = `/tenants${search.toString() ? `?${search.toString()}` : ''}`;
  const response = await gatewayFetch<{ items?: Tenant[]; data?: Tenant[] }>(path);
  if (response.ok && response.data) {
    const items = response.data.items ?? response.data.data ?? [];
    return { tenants: items, source: 'gateway' };
  }
  // Prefer live gateway: if the host responded, do not invent stub rows.
  if (response.status > 0) {
    return { tenants: [], source: 'gateway' };
  }

  const fallback = unreachableFallback(STUB_TENANTS, [] as Tenant[]);
  const filtered = fallback.value.filter((tenant) => {
    if (params.status && params.status !== 'all' && tenant.status !== params.status) {
      return false;
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      return tenant.name.toLowerCase().includes(q) || tenant.slug.toLowerCase().includes(q);
    }
    return true;
  });
  return { tenants: filtered, source: fallback.source };
}

/** Fetch a single tenant by id. Falls back to stub fixtures. */
export async function getTenant(
  id: string,
): Promise<{ tenant: Tenant | null; source: AdminDataSource }> {
  if (!RESOURCE_ID_PATTERN.test(id)) return { tenant: null, source: 'gateway' };
  const response = await gatewayFetch<Tenant>(`/tenants/${pathSegment(id)}`);
  if (response.ok && response.data) {
    return { tenant: response.data, source: 'gateway' };
  }
  if (response.status > 0) {
    return { tenant: null, source: 'gateway' };
  }
  const fallback = unreachableFallback(STUB_TENANTS, [] as Tenant[]);
  return {
    tenant: fallback.value.find((t) => t.id === id) ?? null,
    source: fallback.source,
  };
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  contactEmail: string;
  plan: string;
  region: string;
}

export interface CreateTenantResult {
  ok: boolean;
  tenant?: Tenant;
  error?: string;
}

/** Provision a new tenant via the tenant-service. */
export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const response = await gatewayFetch<Tenant>('/tenants', {
    method: 'POST',
    json: input,
  });
  if (response.ok && response.data) {
    return { ok: true, tenant: response.data };
  }
  // PRC-H002: never simulate tenant provisioning when the gateway is unreachable.
  if (response.status === 0) return { ok: false, error: GATEWAY_UNREACHABLE_WRITE_ERROR };
  return {
    ok: false,
    error: response.error?.message ?? 'Failed to provision tenant.',
  };
}

export const TENANT_LIFECYCLE_ACTIONS = [
  'suspend',
  'reactivate',
  'decommission',
  'offboard',
] as const;
export type TenantLifecycleAction = (typeof TENANT_LIFECYCLE_ACTIONS)[number];

/** Perform a tenant lifecycle action (suspend/reactivate/etc.). */
export async function tenantAction(
  id: string,
  action: TenantLifecycleAction,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const seg = pathSegment(id);
  const verb = verbSegment(action, TENANT_LIFECYCLE_ACTIONS);
  const path = verb === 'offboard' ? `/tenants/${seg}` : `/tenants/${seg}/${verb}`;
  const method = action === 'offboard' ? 'DELETE' : 'POST';

  const response = await gatewayFetch<unknown>(path, {
    method,
    json: { reason },
  });
  if (response.ok) return { ok: true };
  // PRC-H002: an unreachable gateway is a failed write, never a simulated success.
  if (response.status === 0) return { ok: false, error: GATEWAY_UNREACHABLE_WRITE_ERROR };
  return { ok: false, error: response.error?.message ?? 'Action failed.' };
}
