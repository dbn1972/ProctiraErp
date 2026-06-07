/**
 * Mock Event Payload Factory
 *
 * Creates mock DomainEventPayload objects for testing plugin event handlers.
 */
import type { ApprovedEvent, DomainEventPayload } from '@proctira/backend-plugin';

/**
 * Options for creating a mock event payload.
 */
export interface MockEventPayloadOptions {
  tenantId?: string;
  entityId?: string;
  entityType?: string;
  actorId?: string;
  timestamp?: Date;
  data?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Create a mock DomainEventPayload for testing.
 *
 * @param eventType - The event type
 * @param options - Override default values
 * @returns A fully populated DomainEventPayload
 *
 * @example
 * ```typescript
 * import { mockEventPayload } from '@proctira/plugin-sdk/testing';
 *
 * const event = mockEventPayload('student.created', {
 *   entityId: 'student-123',
 *   data: { name: 'Jane Doe', grade: '10' },
 * });
 * ```
 */
export function mockEventPayload(
  eventType: ApprovedEvent,
  options: MockEventPayloadOptions = {},
): DomainEventPayload {
  // Derive entity type from event type (e.g., "student.created" -> "student")
  const derivedEntityType = eventType.split('.')[0] ?? 'unknown';

  return {
    eventType,
    tenantId: options.tenantId ?? 'test-tenant-001',
    entityId: options.entityId ?? `test-entity-${Date.now()}`,
    entityType: options.entityType ?? derivedEntityType,
    actorId: options.actorId ?? 'test-user-001',
    timestamp: options.timestamp ?? new Date(),
    data: options.data ?? {},
    correlationId: options.correlationId ?? `test-corr-${Date.now()}`,
  };
}
