/**
 * Server-side notification rules + templates API (G-1002).
 *
 * Wraps gateway `/notifications/rules` and `/notifications/templates`.
 * Import only from Server Components or Server Actions.
 */
import { gatewayFetch } from './gateway';
import { scaffoldSourceFromResponse, type ScaffoldDataSource } from './insights-source';

export type { ScaffoldDataSource };

export type NotificationRuleEvent = 'create' | 'update' | 'delete' | 'threshold' | 'schedule';
export type NotificationChannel = 'email' | 'in_app' | 'push' | 'webhook' | 'sms';

export interface NotificationRule {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  event: NotificationRuleEvent;
  conditions: Record<string, unknown>;
  templateId: string;
  channels: NotificationChannel[];
  recipientQuery: Record<string, unknown>;
  isActive: boolean;
  schedule: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplate {
  id: string;
  tenantId: string;
  name: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationRuleInput {
  name: string;
  entityType: string;
  event: NotificationRuleEvent;
  conditions?: Record<string, unknown>;
  templateId: string;
  channels: NotificationChannel[];
  recipientQuery?: Record<string, unknown>;
  isActive?: boolean;
  schedule?: string | null;
}

export type UpdateNotificationRuleInput = Partial<CreateNotificationRuleInput>;

export async function listNotificationRules(): Promise<{
  rules: NotificationRule[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: NotificationRule[] }>('/notifications/rules', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { rules: result.data?.data ?? [], source: 'gateway' };
  }
  return { rules: [], source: scaffoldSourceFromResponse(false, result.status) };
}

export async function listNotificationTemplates(): Promise<{
  templates: NotificationTemplate[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: NotificationTemplate[] }>('/notifications/templates', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { templates: result.data?.data ?? [], source: 'gateway' };
  }
  return { templates: [], source: scaffoldSourceFromResponse(false, result.status) };
}

export async function createNotificationRule(
  input: CreateNotificationRuleInput,
): Promise<{ rule: NotificationRule | null; error?: string }> {
  const result = await gatewayFetch<NotificationRule>('/notifications/rules', {
    method: 'POST',
    json: {
      conditions: {},
      recipientQuery: {},
      isActive: true,
      ...input,
    },
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { rule: result.data };
  }
  return { rule: null, error: result.error?.message ?? 'Could not create rule' };
}

export async function updateNotificationRule(
  ruleId: string,
  input: UpdateNotificationRuleInput,
): Promise<{ rule: NotificationRule | null; error?: string }> {
  const result = await gatewayFetch<NotificationRule>(`/notifications/rules/${ruleId}`, {
    method: 'PUT',
    json: input,
    throwOnError: false,
  });
  if (result.ok && result.data) {
    return { rule: result.data };
  }
  return { rule: null, error: result.error?.message ?? 'Could not update rule' };
}

export async function deleteNotificationRule(
  ruleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await gatewayFetch<null>(`/notifications/rules/${ruleId}`, {
    method: 'DELETE',
    throwOnError: false,
  });
  if (result.ok || result.status === 204) {
    return { ok: true };
  }
  return { ok: false, error: result.error?.message ?? 'Could not delete rule' };
}
