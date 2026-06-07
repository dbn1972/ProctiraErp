/**
 * Event Handler Definition Helper
 *
 * Provides a type-safe way to define event handlers that respond
 * to approved domain events (student.created, workflow.transitioned, etc.).
 */
import type { ApprovedEvent, DomainEventPayload, HookContext } from '@proctira/backend-plugin';

/**
 * Event handler function type.
 */
export type PluginEventHandler = (
  event: DomainEventPayload,
  context: HookContext,
) => Promise<void>;

/**
 * An event handler definition linking a domain event to a handler function.
 */
export interface EventHandlerDefinition {
  /** The domain event type to subscribe to */
  eventType: ApprovedEvent;
  /** Optional filter conditions to narrow which events are delivered */
  filter?: Record<string, unknown>;
  /** The handler function */
  handler: PluginEventHandler;
}

/**
 * Define an event handler for a platform domain event.
 *
 * @param eventType - The approved event type to subscribe to
 * @param handler - The handler function to execute when the event fires
 * @param options - Optional filter conditions
 * @returns An event handler definition
 *
 * @example
 * ```typescript
 * import { defineEventHandler } from '@proctira/plugin-sdk';
 *
 * const onStudentTransfer = defineEventHandler(
 *   'student.transferred',
 *   async (event, context) => {
 *     // Send notification about the transfer
 *     console.log(`Student ${event.entityId} transferred`);
 *   },
 *   { filter: { 'data.reason': 'relocation' } }
 * );
 * ```
 */
export function defineEventHandler(
  eventType: ApprovedEvent,
  handler: PluginEventHandler,
  options?: { filter?: Record<string, unknown> },
): EventHandlerDefinition {
  if (!eventType) {
    throw new Error('eventType is required for defineEventHandler');
  }
  if (typeof handler !== 'function') {
    throw new Error('handler must be a function');
  }

  return {
    eventType,
    filter: options?.filter ?? undefined,
    handler,
  };
}
