/**
 * G-811 / PRC-H044 — Plan entitlement & quota enforcement at the gateway.
 *
 * Before this, billing plans, trial/suspension state and quotas had no effect
 * on tenant traffic: `createEntitlementMiddleware` / `checkEntitlement` had no
 * caller outside the billing package, so a tenant could use premium features
 * and exceed seat limits regardless of its subscription.
 *
 * This module gates a curated set of premium-feature routes and quota-limited
 * create routes against the tenant's real subscription via
 * `BillingService.checkEntitlement`. `checkEntitlement` is read-only (it does
 * NOT consume quota, unlike `enforceQuota`), so the gateway preHandler never
 * double-counts usage against the downstream service.
 *
 * Fail-closed default (documented): once enforcement is enabled, a tenant with
 * NO active subscription (no plan assigned) is DENIED on every gated route —
 * premium features return 402 SUBSCRIPTION_REQUIRED and quota-limited creates
 * return 402 as well. A lapsed trial / suspended subscription is likewise
 * denied by `checkEntitlement`.
 *
 * Enforcement is opt-in per deployment via `BILLING_ENTITLEMENTS_ENFORCED`
 * (default off). This is the safest default we can pick without a product
 * decision: turning hard default-deny on globally would lock every tenant that
 * has not yet been migrated onto a subscription out of core create flows. When
 * a deployment seeds subscriptions it sets the flag to `true` and the fail-
 * closed semantics above take over. The flag only chooses *whether* the gate
 * runs; it never weakens the deny decision once running.
 */
import type { FastifyRequest } from 'fastify';

/**
 * Minimal surface of BillingService used here (keeps this module free of a hard
 * dependency on the concrete class for testing).
 */
export interface EntitlementChecker {
  checkEntitlement(
    tenantId: string,
    feature: string,
  ): Promise<{ allowed: boolean; reason?: string; quota?: { used: number; limit: number } }>;
}

/**
 * Premium-feature routes: first path segment under `/api/v1` → feature key that
 * the tenant's plan must include and enable. Reads and writes are both gated —
 * a tenant without the feature should not see premium data either.
 */
export const PREMIUM_FEATURE_ROUTES: Readonly<Record<string, string>> = {
  // Advanced/optional modules sold as add-ons.
  lms: 'lms',
  hostel: 'hostel',
  transport: 'transport',
  library: 'library',
};

/**
 * Quota-limited create routes: `METHOD /api/v1/<segment>` → quota metric. These
 * fire only on create (POST) so updates/reads are never blocked by a seat cap.
 */
export const QUOTA_LIMITED_CREATES: ReadonlyArray<{
  segment: string;
  method: string;
  metric: string;
}> = [
  { segment: 'students', method: 'POST', metric: 'students' },
  { segment: 'staff', method: 'POST', metric: 'staff' },
];

/** Is gateway billing enforcement enabled for this deployment? */
export function billingEntitlementsEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['BILLING_ENTITLEMENTS_ENFORCED'] ?? '').trim().toLowerCase();
  return ['true', '1', 'on', 'yes'].includes(raw);
}

function firstSegment(urlPath: string): string | undefined {
  const path = urlPath.split('?')[0] ?? urlPath;
  if (!path.startsWith('/api/v1/')) return undefined;
  const rest = path.slice('/api/v1/'.length);
  const [segment] = rest.split('/').filter(Boolean);
  return segment;
}

export interface EntitlementDenial {
  statusCode: 402 | 403 | 429;
  code: 'SUBSCRIPTION_REQUIRED' | 'FEATURE_NOT_ENTITLED' | 'QUOTA_EXCEEDED';
  message: string;
  /** Present for feature-gated denials. */
  feature?: string;
  /** Present for quota denials. */
  metric?: string;
  quota?: { used: number; limit: number };
}

function denialFromCheck(
  result: { allowed: boolean; reason?: string; quota?: { used: number; limit: number } },
  context: { feature?: string; metric?: string },
): EntitlementDenial | null {
  if (result.allowed) return null;
  const noSubscription = result.reason === 'No active subscription';
  if (context.metric) {
    // Quota-limited create.
    if (noSubscription) {
      return {
        statusCode: 402,
        code: 'SUBSCRIPTION_REQUIRED',
        message: result.reason ?? 'An active subscription is required',
        metric: context.metric,
      };
    }
    return {
      statusCode: 429,
      code: 'QUOTA_EXCEEDED',
      message: result.reason ?? `Quota exceeded for '${context.metric}'`,
      metric: context.metric,
      ...(result.quota ? { quota: result.quota } : {}),
    };
  }
  // Premium feature.
  if (noSubscription) {
    return {
      statusCode: 402,
      code: 'SUBSCRIPTION_REQUIRED',
      message: result.reason ?? 'An active subscription is required',
      feature: context.feature,
    };
  }
  return {
    statusCode: 403,
    code: 'FEATURE_NOT_ENTITLED',
    message: result.reason ?? `Feature '${context.feature ?? 'unknown'}' is not available`,
    feature: context.feature,
  };
}

/**
 * Evaluate the billing entitlement gate for a single request. Returns a denial
 * descriptor to send, or null to allow. Does not consume quota.
 *
 * Fails closed: if the billing service throws (store unavailable) on a gated
 * route, the request is denied with 402 rather than allowed.
 */
export async function evaluateBillingEntitlement(
  billing: EntitlementChecker,
  tenantId: string | undefined,
  method: string,
  urlPath: string,
): Promise<EntitlementDenial | null> {
  const segment = firstSegment(urlPath);
  if (!segment) return null;

  const quotaRule = QUOTA_LIMITED_CREATES.find(
    (rule) => rule.segment === segment && rule.method === method.toUpperCase(),
  );
  const feature = PREMIUM_FEATURE_ROUTES[segment];
  if (!quotaRule && !feature) return null;

  if (!tenantId) {
    // A gated route with no tenant context cannot be entitled.
    return {
      statusCode: 402,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Tenant context required for entitlement check',
      ...(quotaRule ? { metric: quotaRule.metric } : { feature }),
    };
  }

  try {
    if (quotaRule) {
      const result = await billing.checkEntitlement(tenantId, quotaRule.metric);
      const denial = denialFromCheck(result, { metric: quotaRule.metric });
      if (denial) return denial;
    }
    if (feature) {
      const result = await billing.checkEntitlement(tenantId, feature);
      const denial = denialFromCheck(result, { feature });
      if (denial) return denial;
    }
  } catch {
    return {
      statusCode: 402,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Entitlement could not be verified; request denied',
      ...(quotaRule ? { metric: quotaRule.metric } : { feature }),
    };
  }
  return null;
}

/** Resolve the tenant id from the verified JWT / tenant context (never from args). */
export function tenantIdFromRequest(request: FastifyRequest): string | undefined {
  const req = request as FastifyRequest & {
    tenantId?: string;
    user?: { tenantId?: string };
  };
  return req.tenantId ?? req.user?.tenantId;
}
