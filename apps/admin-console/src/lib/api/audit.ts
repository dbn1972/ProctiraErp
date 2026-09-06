/**
 * Platform audit log query API client.
 */
import { gatewayFetch } from './gateway';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  /** Functional role of the actor at the time of the event. */
  actorRole?: string;
  action: string;
  /** Targeted entity (tenant/plugin/theme/break-glass/...). */
  resource: string;
  resourceType: string;
  /** Tenant scope of the change (or 'platform' for platform-level). */
  tenantId: string;
  /** Outcome of the action. */
  outcome: 'success' | 'failure';
  /** Optional reason / justification recorded with the action. */
  reason?: string;
}

const STUB_ENTRIES: AuditEntry[] = [
  {
    id: 'aud_001',
    timestamp: '2025-02-25T11:00:00Z',
    actor: 'security1@proctira.org',
    actorRole: 'security',
    action: 'plugin.approve',
    resource: 'Parent Portal Lite v1.4.2',
    resourceType: 'plugin',
    tenantId: 'platform',
    outcome: 'success',
    reason: 'Manifest reviewed; no privileged scopes requested.',
  },
  {
    id: 'aud_002',
    timestamp: '2025-02-25T08:15:00Z',
    actor: 'security1@proctira.org',
    actorRole: 'security',
    action: 'break_glass.approve',
    resource: 'bg_002',
    resourceType: 'break-glass',
    tenantId: 'tnt_001',
    outcome: 'success',
    reason: 'Customer-approved support case #4421.',
  },
  {
    id: 'aud_003',
    timestamp: '2025-02-24T15:42:00Z',
    actor: 'billing1@proctira.org',
    actorRole: 'billing',
    action: 'tenant.suspend',
    resource: 'tnt_003',
    resourceType: 'tenant',
    tenantId: 'tnt_003',
    outcome: 'success',
    reason: 'Pilot programme ended; 30-day grace period started.',
  },
  {
    id: 'aud_004',
    timestamp: '2025-02-24T12:10:00Z',
    actor: 'platform1@proctira.org',
    actorRole: 'platform_admin',
    action: 'plan.update',
    resource: 'plan_standard',
    resourceType: 'plan',
    tenantId: 'platform',
    outcome: 'success',
    reason: 'Enabled lms entitlement for standard plan.',
  },
];

export interface AuditQuery {
  search?: string;
  actor?: string;
  resourceType?: string;
  tenantId?: string;
}

export async function listAudit(
  query: AuditQuery = {},
): Promise<{ entries: AuditEntry[]; source: 'gateway' | 'stub' }> {
  const search = new URLSearchParams();
  if (query.search) search.set('q', query.search);
  if (query.actor) search.set('actor', query.actor);
  if (query.resourceType) search.set('resourceType', query.resourceType);
  if (query.tenantId) search.set('tenantId', query.tenantId);

  const path = `/audit${search.toString() ? `?${search.toString()}` : ''}`;
  const response = await gatewayFetch<{
    items?: AuditEntry[];
    data?: AuditEntry[];
  }>(path);
  if (response.ok && response.data) {
    return {
      entries: response.data.items ?? response.data.data ?? [],
      source: 'gateway',
    };
  }
  if (response.status > 0) {
    return { entries: [], source: 'gateway' };
  }

  const filtered = STUB_ENTRIES.filter((entry) => {
    if (query.actor && entry.actor !== query.actor) return false;
    if (query.resourceType && entry.resourceType !== query.resourceType) {
      return false;
    }
    if (query.tenantId && entry.tenantId !== query.tenantId) return false;
    if (query.search) {
      const q = query.search.toLowerCase();
      return (
        entry.action.toLowerCase().includes(q) ||
        entry.resource.toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q)
      );
    }
    return true;
  });
  return { entries: filtered, source: 'stub' };
}
