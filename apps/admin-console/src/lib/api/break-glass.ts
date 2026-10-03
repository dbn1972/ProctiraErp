/**
 * Break-glass access control API client.
 *
 * Implements Section 41 break-glass policy:
 *  - approved use cases only
 *  - approval chain (requester + approver, distinct identities)
 *  - duration-limited (TTL on grant)
 *  - least-privilege mode (scope tags)
 *  - audit trail for every state transition
 */
import { GATEWAY_UNREACHABLE_WRITE_ERROR, gatewayFetch } from './gateway';
import { RESOURCE_ID_PATTERN, pathSegment, verbSegment } from './path-segment';

export { BREAK_GLASS_USE_CASES, BREAK_GLASS_MAX_MINUTES } from './break-glass-constants';
export type { BreakGlassUseCase } from './break-glass-constants';

export type BreakGlassStatus =
  'pending_approval' | 'approved' | 'active' | 'expired' | 'revoked' | 'denied';

export interface BreakGlassRequest {
  id: string;
  /** Requesting operator's email. */
  requester: string;
  /** Tenant being accessed (or 'platform' for platform-level operations). */
  targetTenantId: string;
  /** Functional scope: 'read', 'support', 'admin'. */
  scope: 'read' | 'support' | 'admin';
  /** Justification text (required at submission). */
  justification: string;
  /** Use case picked from the approved catalogue. */
  useCase: string;
  /** Maximum grant duration in minutes. */
  durationMinutes: number;
  status: BreakGlassStatus;
  createdAt: string;
  /** Verified JWT subject of the requester (set by the gateway, PRC-H003). */
  requesterSub?: string;
  /** Approver email, if approved. */
  approver?: string;
  /** Verified JWT subject of the approver (set by the gateway, PRC-H003). */
  approverSub?: string;
  approvedAt?: string;
  /** ISO timestamp at which the grant expires. */
  expiresAt?: string;
}

/**
 * PRC-H003: an active grant for this operator on this tenant, still inside its window.
 * Matches on the verified subject when the gateway provides it (email only for legacy rows).
 */
export function hasActiveBreakGlassGrant(
  requests: BreakGlassRequest[],
  tenantId: string | undefined,
  operator: { sub: string; email?: string | null },
  now: Date = new Date(),
): boolean {
  if (!tenantId) return false;
  return requests.some((request) => {
    if (request.status !== 'active' || request.targetTenantId !== tenantId) return false;
    if (!request.expiresAt || Date.parse(request.expiresAt) <= now.getTime()) return false;
    if (request.requesterSub) return request.requesterSub === operator.sub;
    return !!operator.email && request.requester.toLowerCase() === operator.email.toLowerCase();
  });
}

const STUB_REQUESTS: BreakGlassRequest[] = [
  {
    id: 'bg_001',
    requester: 'engineer1@proctira.org',
    targetTenantId: 'tnt_002',
    scope: 'read',
    justification:
      'Customer reports that grade reports are not exporting. Need to inspect failed job logs to diagnose.',
    useCase: 'Production incident triage',
    durationMinutes: 60,
    status: 'pending_approval',
    createdAt: '2025-02-25T10:30:00Z',
  },
  {
    id: 'bg_002',
    requester: 'support1@proctira.org',
    targetTenantId: 'tnt_001',
    scope: 'support',
    justification:
      'Tenant administrator requested help recovering a deleted student record (case #4421).',
    useCase: 'Customer-requested support',
    durationMinutes: 120,
    status: 'active',
    createdAt: '2025-02-25T08:00:00Z',
    approver: 'security1@proctira.org',
    approvedAt: '2025-02-25T08:15:00Z',
    expiresAt: '2025-02-25T10:15:00Z',
  },
  {
    id: 'bg_003',
    requester: 'engineer2@proctira.org',
    targetTenantId: 'tnt_003',
    scope: 'admin',
    justification: 'Pilot tenant offboarding cleanup.',
    useCase: 'Scheduled maintenance',
    durationMinutes: 30,
    status: 'expired',
    createdAt: '2025-02-22T14:00:00Z',
    approver: 'security1@proctira.org',
    approvedAt: '2025-02-22T14:05:00Z',
    expiresAt: '2025-02-22T14:35:00Z',
  },
];

export async function listBreakGlassRequests(): Promise<{
  requests: BreakGlassRequest[];
  source: 'gateway' | 'stub';
}> {
  const response = await gatewayFetch<{
    items?: BreakGlassRequest[];
    data?: BreakGlassRequest[];
  }>('/break-glass');
  if (response.ok && response.data) {
    return {
      requests: response.data.items ?? response.data.data ?? [],
      source: 'gateway',
    };
  }
  if (response.status > 0) {
    return { requests: [], source: 'gateway' };
  }
  return { requests: STUB_REQUESTS, source: 'stub' };
}

export async function getBreakGlassRequest(id: string): Promise<BreakGlassRequest | null> {
  if (!RESOURCE_ID_PATTERN.test(id)) return null;
  const response = await gatewayFetch<BreakGlassRequest>(`/break-glass/${pathSegment(id)}`);
  if (response.ok && response.data) return response.data;
  // PRC-M002: a gateway answer (e.g. 404) is authoritative; fixtures only when unreachable.
  if (response.status > 0) return null;
  return STUB_REQUESTS.find((r) => r.id === id) ?? null;
}

export interface CreateBreakGlassInput {
  targetTenantId: string;
  scope: 'read' | 'support' | 'admin';
  justification: string;
  useCase: string;
  durationMinutes: number;
}

export async function createBreakGlassRequest(
  input: CreateBreakGlassInput,
): Promise<{ ok: boolean; request?: BreakGlassRequest; error?: string }> {
  const response = await gatewayFetch<BreakGlassRequest>('/break-glass', {
    method: 'POST',
    json: input,
  });
  if (response.ok && response.data) {
    return { ok: true, request: response.data };
  }
  // PRC-H002: never fabricate a request (id, requester) when the gateway is unreachable.
  if (response.status === 0) return { ok: false, error: GATEWAY_UNREACHABLE_WRITE_ERROR };
  return { ok: false, error: response.error?.message ?? 'Submission failed.' };
}

export const BREAK_GLASS_DECISIONS = ['approve', 'deny', 'revoke'] as const;
export async function decideBreakGlassRequest(
  id: string,
  decision: 'approve' | 'deny' | 'revoke',
  reason: string,
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const response = await gatewayFetch<unknown>(
    `/break-glass/${pathSegment(id)}/${verbSegment(decision, BREAK_GLASS_DECISIONS)}`,
    {
      method: 'POST',
      json: { reason },
    },
  );
  if (response.ok) return { ok: true };
  // PRC-H002: an unreachable gateway is a failed write, never a simulated success.
  if (response.status === 0) return { ok: false, error: GATEWAY_UNREACHABLE_WRITE_ERROR };
  // PRC-H003: keep the gateway's policy code (SELF_APPROVAL_FORBIDDEN, INVALID_STATE, ...).
  return {
    ok: false,
    error: response.error?.message ?? 'Action failed.',
    code: response.error?.code,
  };
}
