'use server';

/**
 * Server Actions for notification rules admin (G-1002).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createNotificationRule,
  deleteNotificationRule,
  updateNotificationRule,
  type NotificationChannel,
  type NotificationRuleEvent,
} from '@/lib/api/notifications-rules.server';

export interface NotificationRulesActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

const channelSchema = z.enum(['email', 'in_app', 'push', 'webhook', 'sms']);
const eventSchema = z.enum(['create', 'update', 'delete', 'threshold', 'schedule']);

const createRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  entityType: z.string().trim().min(1, 'Entity type is required').max(100),
  event: eventSchema,
  templateId: z.string().uuid('Choose a valid template'),
  channels: z.array(channelSchema).min(1, 'Select at least one channel'),
  isActive: z.boolean().optional(),
});

function flatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value?.[0]) out[key] = value[0];
  }
  return out;
}

export async function createNotificationRuleAction(
  input: z.input<typeof createRuleSchema>,
): Promise<NotificationRulesActionState> {
  const parsed = createRuleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: flatten(parsed.error.flatten().fieldErrors),
    };
  }

  const { rule, error } = await createNotificationRule({
    ...parsed.data,
    event: parsed.data.event as NotificationRuleEvent,
    channels: parsed.data.channels as NotificationChannel[],
  });

  if (!rule) {
    return { status: 'error', message: error ?? 'Could not create rule' };
  }

  revalidatePath('/admin/notification-rules');
  return { status: 'success', message: `Created rule “${rule.name}”` };
}

export async function toggleNotificationRuleAction(
  ruleId: string,
  isActive: boolean,
): Promise<NotificationRulesActionState> {
  if (!ruleId) return { status: 'error', message: 'Missing rule' };

  const { rule, error } = await updateNotificationRule(ruleId, { isActive });
  if (!rule) {
    return { status: 'error', message: error ?? 'Could not update rule' };
  }

  revalidatePath('/admin/notification-rules');
  return {
    status: 'success',
    message: isActive ? 'Rule activated' : 'Rule paused',
  };
}

export async function deleteNotificationRuleAction(
  ruleId: string,
): Promise<NotificationRulesActionState> {
  if (!ruleId) return { status: 'error', message: 'Missing rule' };

  const { ok, error } = await deleteNotificationRule(ruleId);
  if (!ok) {
    return { status: 'error', message: error ?? 'Could not delete rule' };
  }

  revalidatePath('/admin/notification-rules');
  return { status: 'success', message: 'Rule deleted' };
}
