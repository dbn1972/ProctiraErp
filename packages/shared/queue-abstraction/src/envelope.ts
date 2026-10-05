/**
 * PRC-L355 — receive-side envelope validation.
 *
 * Consumers must not trust a raw broker body: it is parsed against a zod
 * schema and its `tenantId` must equal the concrete tenant segment of the
 * routing key / topic the broker delivered on. Anything else is rejected
 * before the handler runs (adapters dead-letter it).
 */
import { z } from 'zod';

import { messageTenantMatchesRoute } from './tenant-scope';
import type { QueueMessage } from './types';

const SAFE_TENANT_ID = /^[^.*#>\s]+$/;

export const QueueMessageEnvelopeSchema = z.object({
  id: z.string().min(1).max(512),
  tenantId: z.string().min(1).max(128).regex(SAFE_TENANT_ID),
  type: z.string().min(1).max(256),
  payload: z.unknown(),
  timestamp: z.string().min(1).max(64),
  metadata: z
    .object({
      correlationId: z.string().optional(),
      causationId: z.string().optional(),
      userId: z.string().optional(),
      priority: z.number().optional(),
      delay: z.number().optional(),
      maxRetries: z.number().optional(),
      retryCount: z.number().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .loose()
    .optional(),
});

export type EnvelopeRejection = 'invalid-envelope' | 'tenant-route-mismatch';

export type EnvelopeCheck =
  | { ok: true; message: QueueMessage }
  | { ok: false; reason: EnvelopeRejection; message?: QueueMessage };

/**
 * Validate a decoded body against the envelope schema and the routed name.
 * `routedName` is the concrete `tenant.{tenantId}.…` key the broker routed on.
 */
export function checkQueueEnvelope(body: unknown, routedName: string): EnvelopeCheck {
  const parsed = QueueMessageEnvelopeSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'invalid-envelope' };
  const message = parsed.data as QueueMessage;
  if (!messageTenantMatchesRoute(routedName, message)) {
    return { ok: false, reason: 'tenant-route-mismatch', message };
  }
  return { ok: true, message };
}
