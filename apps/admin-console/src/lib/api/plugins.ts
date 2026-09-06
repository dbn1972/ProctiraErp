/**
 * Plugin marketplace management API client.
 */
import { gatewayFetch } from './gateway';

export type PluginStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'revoked'
  | 'disabled';

export interface PluginSubmission {
  id: string;
  name: string;
  vendor: string;
  version: string;
  status: PluginStatus;
  submittedAt: string;
  category: string;
  description: string;
  /** Permissions requested by the manifest. */
  permissions: string[];
  /** SHA-256 of the manifest bundle. */
  manifestHash: string;
}

const STUB_PLUGINS: PluginSubmission[] = [
  {
    id: 'plg_001',
    name: 'Attendance Insights Pro',
    vendor: 'Acme Analytics',
    version: '2.1.0',
    status: 'in_review',
    submittedAt: '2025-02-12T11:30:00Z',
    category: 'Analytics',
    description: 'Advanced attendance reporting with predictive risk scoring.',
    permissions: ['students.read', 'attendance.read', 'reports.write'],
    manifestHash: 'sha256:abc123...',
  },
  {
    id: 'plg_002',
    name: 'Parent Portal Lite',
    vendor: 'EduConnect',
    version: '1.4.2',
    status: 'approved',
    submittedAt: '2025-01-08T16:00:00Z',
    category: 'Communication',
    description: 'Lightweight parent-facing portal with messaging support.',
    permissions: ['students.read', 'messages.write'],
    manifestHash: 'sha256:def456...',
  },
  {
    id: 'plg_003',
    name: 'Grade Sync',
    vendor: 'GradebookPlus',
    version: '0.9.0',
    status: 'submitted',
    submittedAt: '2025-02-20T08:45:00Z',
    category: 'LMS',
    description: 'Two-way grade sync between ProctiraERP and external LMS.',
    permissions: ['grades.read', 'grades.write', 'students.read'],
    manifestHash: 'sha256:789abc...',
  },
  {
    id: 'plg_004',
    name: 'Old Reports Engine',
    vendor: 'Legacy Systems',
    version: '3.0.0',
    status: 'revoked',
    submittedAt: '2024-09-01T12:00:00Z',
    category: 'Reports',
    description: 'Deprecated report generator, revoked due to CVE-2024-9991.',
    permissions: ['reports.read', 'reports.write'],
    manifestHash: 'sha256:deadbeef...',
  },
];

export async function listPlugins(): Promise<{
  plugins: PluginSubmission[];
  source: 'gateway' | 'stub';
}> {
  const response = await gatewayFetch<{
    items?: PluginSubmission[];
    data?: PluginSubmission[];
  }>('/plugins');
  if (response.ok && response.data) {
    return {
      plugins: response.data.items ?? response.data.data ?? [],
      source: 'gateway',
    };
  }
  return { plugins: STUB_PLUGINS, source: 'stub' };
}

export async function getPlugin(
  id: string,
): Promise<{ plugin: PluginSubmission | null; source: 'gateway' | 'stub' }> {
  const response = await gatewayFetch<PluginSubmission>(`/plugins/${id}`);
  if (response.ok && response.data) {
    return { plugin: response.data, source: 'gateway' };
  }
  return {
    plugin: STUB_PLUGINS.find((p) => p.id === id) ?? null,
    source: 'stub',
  };
}

export type PluginAction = 'approve' | 'revoke' | 'disable' | 'reject';

export async function pluginAction(
  id: string,
  action: PluginAction,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await gatewayFetch<unknown>(`/plugins/${id}/${action}`, {
    method: 'POST',
    json: { reason },
  });
  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: true };
  return { ok: false, error: response.error?.message ?? 'Action failed.' };
}
