/**
 * Plugin audit port (PRC-L477).
 *
 * The plugin package previously wrote audit rows only through its own
 * repository's `createAuditEntry`, and the route layer attributed the actor to
 * the literal `'system'` whenever the verified principal had no `sub`. That
 * masked the real actor on security-relevant plugin lifecycle events.
 *
 * This port lets the composition root inject a durable, tenant-aware audit
 * sink that always carries the **real actor and tenant** from the verified
 * request. It is a package-local interface (dependency inversion): no new
 * package dependency is added, and when no port is injected the service falls
 * back to its repository so existing behaviour and tests are unchanged.
 */
import type { PluginAuditEntry } from './plugin-repository.js';

/** The audit event the service hands to the port: the real actor and tenant are mandatory. */
export type PluginAuditEvent = Omit<PluginAuditEntry, 'timestamp'>;

/**
 * Sink for plugin audit events. Implementations persist the event durably
 * (e.g. the platform's chained audit store) with the verified actor and tenant.
 */
export interface PluginAuditPort {
  record(event: PluginAuditEvent): Promise<void>;
}

/** Raised when a mutating plugin route cannot determine the real actor. */
export class PluginActorRequiredError extends Error {
  readonly statusCode = 401;
  readonly code = 'ACTOR_REQUIRED';

  constructor(message = 'A verified actor is required for this operation') {
    super(message);
    this.name = 'PluginActorRequiredError';
  }
}
