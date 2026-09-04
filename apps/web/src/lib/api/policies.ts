/**
 * Policy service client (server-side).
 *
 * Wraps gateway routes under `/policies/*`. Returns empty data when the
 * gateway is unreachable or the policy plugin is not mounted so admin UI
 * can still render empty states.
 *
 * Backend contract: packages/backend/policy (GET /policies).
 */
import { gatewayFetch } from './gateway';

export type PolicyStatus = 'draft' | 'active' | 'inactive';
export type PolicyScope = 'platform' | 'tenant' | 'institution';
export type PolicyType =
  | 'data_retention'
  | 'password_complexity'
  | 'session_timeout'
  | 'rate_limiting';

export interface AccessPolicy {
  id: string;
  name: string;
  description: string | null;
  type: PolicyType | string;
  scope: PolicyScope | string;
  status: PolicyStatus | string;
  rules: Record<string, unknown>;
  version: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

/** Lists tenant access policies; empty when unavailable. */
export async function listPolicies(): Promise<AccessPolicy[]> {
  const result = await gatewayFetch<{ data: AccessPolicy[] } | AccessPolicy[]>(
    '/policies?pageSize=100',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return unwrapList(result.data);
}
