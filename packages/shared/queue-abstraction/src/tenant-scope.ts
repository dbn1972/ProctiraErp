/**
 * W1-SEC-11 — Tenant-prefixed queue/topic naming for queue-abstraction.
 *
 * Publishers use {@link buildTenantName}; subscribe/consume paths must also
 * reject unscoped caller topics (not convention-only).
 */

import { isProductionNodeEnv } from '@proctira/common/node-env';

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function isProductionEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return isProductionNodeEnv(nodeEnv);
}

/**
 * Emergency escape hatch — must never be set in normal production.
 * When set, subscribe/consume will not reject unscoped topics.
 */
export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'queue',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/**
 * Format: `tenant.{tenantId|*} .{suffix...}` or platform pattern `tenant.#`.
 * Rejects bare topics (`events`), empty tenant segments (`tenant..x`), and
 * fully unscoped wildcards (`#`, `*`).
 */
export function isTenantScopedQueueName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const parts = name.split('.');
  if (parts[0] !== 'tenant') return false;
  const tenantSeg = parts[1];
  if (!tenantSeg || tenantSeg.trim().length === 0) return false;
  // `tenant.#` — all tenants (platform worker); still namespaced under tenant.
  if (parts.length === 2) return tenantSeg === '#';
  // `tenant.<id|*>.<rest...>`
  return true;
}

export function assertTenantScopedQueueName(name: string, surface = 'queue'): void {
  if (!isTenantScopedQueueName(name)) {
    throw new TenantScopeError(
      `${surface}: unscoped name rejected — expected tenant.{tenantId}.{name} (W1-SEC-11): "${name}"`,
    );
  }
}

/**
 * Whether subscribe/consume must reject unscoped topics.
 * Defaults to fail-closed always (builders style) unless emergency hatch;
 * production always requires unless hatch is set.
 */
export function shouldRequireTenantScopedQueueTopics(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  // Always enforce for subscribe (residual from PARTIAL): missing scope fails closed.
  // Production is the compliance bar; non-prod also rejects unless hatch is set.
  void isProductionEnv(env.NODE_ENV);
  return true;
}

/**
 * Gate for adapter subscribe/consume — rejects unscoped caller topics.
 */
export function assertTenantScopedSubscribeTopic(
  topic: string,
  options: { env?: NodeJS.ProcessEnv; requireTenantScope?: boolean; surface?: string } = {},
): void {
  const required = shouldRequireTenantScopedQueueTopics(
    options.env ?? process.env,
    options.requireTenantScope,
  );
  if (required) {
    assertTenantScopedQueueName(topic, options.surface ?? 'queue.subscribe');
  }
}

/**
 * PRC-M365 — AMQP-style topic wildcards (`*` = exactly one segment, `#` = zero or
 * more segments) are only honoured by the RabbitMQ and in-memory adapters. Kafka
 * and SQS treated `tenant.*.jobs` as a *literal* topic/queue name, so a wildcard
 * subscription silently matched nothing on those backends (a correctness bug, not
 * a leak). These helpers let the Kafka adapter translate a wildcard to a RegExp
 * (kafkajs supports RegExp topics) and let the SQS adapter fail closed.
 */
export function isWildcardTopic(topic: string): boolean {
  return topic.split('.').some((seg) => seg === '*' || seg === '#');
}

/**
 * Convert an AMQP-style wildcard routing key to an anchored RegExp for kafkajs.
 *   `*` → exactly one dot-free segment
 *   `#` → zero or more segments (including the dots between them)
 * Literal segments are escaped so a tenant id or event name cannot inject regex.
 */
export function wildcardTopicToRegExp(topic: string): RegExp {
  const parts = topic.split('.');
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const seg = parts[i] ?? '';
    if (seg === '*') {
      tokens.push('[^.]+');
    } else if (seg === '#') {
      // `#` absorbs the following dot too, so `a.#` matches `a` and `a.b.c`.
      tokens.push('(?:[^.]+(?:\\.[^.]+)*)?');
    } else {
      tokens.push(seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }
  // Join with `\.` but collapse the separator around a trailing/leading `#`.
  let pattern = '';
  for (let i = 0; i < tokens.length; i += 1) {
    if (i > 0) {
      const prev = parts[i - 1] ?? '';
      const cur = parts[i] ?? '';
      // Avoid a mandatory separator next to a `#` that may match zero segments.
      pattern += prev === '#' || cur === '#' ? '\\.?' : '\\.';
    }
    pattern += tokens[i];
  }
  return new RegExp(`^${pattern}$`);
}

// eslint-disable-next-line no-control-regex
const UNSAFE_TENANT_SEGMENT = /[.*#>\s\u0000-\u001f\u007f]/;

/** Reject tenant ids that would shift or widen a `tenant.{id}.…` routing name. */
export function assertSafeTenantSegment(tenantId: string, surface = 'queue'): void {
  if (UNSAFE_TENANT_SEGMENT.test(tenantId)) {
    throw new TenantScopeError(
      `${surface}: tenantId must not contain '.', '*', '#', '>', whitespace or control characters (PRC-L355)`,
    );
  }
}

/**
 * Concrete tenant segment of a `tenant.{tenantId}.{…}` name, or undefined when the
 * name is unscoped or the segment is a wildcard (`*` / `#`).
 */
export function tenantFromScopedName(name: string): string | undefined {
  const parts = name.split('.');
  if (parts[0] !== 'tenant' || parts.length < 3) return undefined;
  const seg = parts[1];
  if (!seg || seg === '*' || seg === '#') return undefined;
  return seg;
}

/**
 * PRC-L355 — receive-side guard: the body's `tenantId` must equal the tenant the
 * broker routed on (concrete topic / queue name). Messages failing this check
 * must not reach the handler.
 */
export function messageTenantMatchesRoute(
  routedName: string,
  message: { tenantId?: unknown } | null | undefined,
): boolean {
  const routeTenant = tenantFromScopedName(routedName);
  if (!routeTenant || !message || typeof message.tenantId !== 'string') return false;
  return message.tenantId === routeTenant;
}
