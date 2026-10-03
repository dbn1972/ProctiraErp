/**
 * PRC-H046 (decision): the webhook event catalogue.
 *
 * Partners may only subscribe to (and the gateway may only fan out) events named here, plus the
 * `*` wildcard which matches catalogue events only. Internal job types (`webhook.*`,
 * `workflow.escalation`, ...) are never deliverable.
 *
 * Defaulted: fan-out is OFF until WEBHOOK_FANOUT_EVENTS lists catalogue events (least data
 * exposure — payloads leave the platform). Owner may enable via WEBHOOK_FANOUT_EVENTS=<csv> or
 * WEBHOOK_FANOUT_EVENTS=catalogue (every catalogue event).
 */
import { BusinessRuleError } from '@proctira/common';

export const WEBHOOK_EVENT_CATALOGUE = Object.freeze([
  'student.created',
  'student.updated',
  'student.enrolled',
  'student.withdrawn',
  'attendance.marked',
  'fees.invoice.created',
  'fees.payment.succeeded',
  'fees.refund.posted',
  'admissions.application.submitted',
  'admissions.offer.accepted',
  'examination.results.published',
] as const);

export type WebhookCatalogueEvent = (typeof WEBHOOK_EVENT_CATALOGUE)[number];

const CATALOGUE = new Set<string>(WEBHOOK_EVENT_CATALOGUE);

export function isCatalogueEvent(event: string): event is WebhookCatalogueEvent {
  return CATALOGUE.has(event);
}

/** Subscriptions must name catalogue events (or `*`). */
export function assertWebhookEventsInCatalogue(events: readonly string[]): void {
  const unknown = events.filter((e) => e !== '*' && !isCatalogueEvent(e));
  if (unknown.length > 0) {
    throw new BusinessRuleError(
      `Unknown webhook event(s): ${unknown.join(', ')}. Allowed: ${WEBHOOK_EVENT_CATALOGUE.join(', ')} or *`,
    );
  }
}
