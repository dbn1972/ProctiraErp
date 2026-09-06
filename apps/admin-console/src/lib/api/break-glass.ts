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
import { gatewayFetch } from './gateway';

export {
  BREAK_GLASS_USE_CASES,
  BREAK_GLASS_MAX_MINUTES,
} from './break-glass-constants';
export type { BreakGlassUseCase } from './break-glass-constants';

export type BreakGlassStatus =
  | 'pending_approval'
  | 'approved'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'denied';

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
  /** Approver email, if approved. */
  approver?: string;
  approvedAt?: string;
  /** ISO timestamp at which the grant expires. */
  expiresAt?: string;
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

export async function getBreakGlassRequest(
  id: string,
): Promise<BreakGlassRequest | null> {
  const response = await gatewayFetch<BreakGlassRequest>(`/break-glass/${id}`);
  if (response.ok && response.data) return response.data;
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
  if (response.status === 0) {
    const stub: BreakGlassRequest = {
      id: `bg_${Math.random().toString(36).slice(2, 8)}`,
      requester: 'current-user@proctira.org',
      targetTenantId: input.targetTenantId,
      scope: input.scope,
      justification: input.justification,
      useCase: input.useCase,
      durationMinutes: input.durationMinutes,
      status: 'pending_approval',
      createdAt: new Date().toISOString(),
    };
    return { ok: true, request: stub };
  }
  return { ok: false, error: response.error?.message ?? 'Submission failed.' };
}

export async function decideBreakGlassRequest(
  id: string,
  decision: 'approve' | 'deny' | 'revoke',
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await gatewayFetch<unknown>(`/break-glass/${id}/${decision}`, {
    method: 'POST',
    json: { reason },
  });
  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: true };
  return { ok: false, error: response.error?.message ?? 'Action failed.' };
}
