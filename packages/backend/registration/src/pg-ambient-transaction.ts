/**
 * PRC-M537: one Postgres transaction across the registration stores.
 *
 * The CRM waitlist store, the admissions pipeline store and the applications
 * repository each open their own `withPgTenant` transaction. A waitlist
 * promotion (dequeue head, application status, placement, new offer) must
 * commit or roll back as one unit, so `runInRegistrationTransaction` opens one
 * tenant transaction and every store call made inside `work` (same tenant)
 * joins it through `withRegistrationTenant` instead of opening its own.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { withPgTenant, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

interface AmbientTransaction {
  tenantId: string;
  client: PgQueryable;
}

const ambient = new AsyncLocalStorage<AmbientTransaction>();

/** `withPgTenant`, but joins the ambient registration transaction for the same tenant. */
export function withRegistrationTenant<T>(
  pool: PgPoolWithConnect | PgQueryable,
  tenantId: string,
  fn: (client: PgQueryable) => Promise<T>,
): Promise<T> {
  const current = ambient.getStore();
  if (current && current.tenantId === tenantId) return fn(current.client);
  return withPgTenant(pool, tenantId, fn);
}

/** Runs `work` in one tenant transaction; any throw rolls back every joined store write. */
export function runInRegistrationTransaction<T>(
  pool: PgPoolWithConnect | PgQueryable,
  tenantId: string,
  work: () => Promise<T>,
): Promise<T> {
  const current = ambient.getStore();
  if (current && current.tenantId === tenantId) return work();
  return withPgTenant(pool, tenantId, (client) => ambient.run({ tenantId, client }, work));
}
