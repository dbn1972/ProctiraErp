/**
 * G-901 follow-up — bind RLS for the academics services.
 *
 * `AcademicPeriodService`, `GradeService`, `ClassService` and `SubjectService`
 * call `prisma.<model>.<op>()` directly with `where: { tenantId }` filters.
 * Filtering alone does not satisfy Postgres once `FORCE ROW LEVEL SECURITY`
 * is on (db/sql/021): `app.tenant_id` must be bound on the same connection,
 * which only `withTenantTransaction` guarantees.
 *
 * Rather than rewriting the four services, this wraps the real client so each
 * model operation runs inside `withTenantTransaction(prisma, currentTenantId())`,
 * with the tenant taken from the request-scoped `tenantContext` the plugin
 * enters in its `onRequest` hook. Non-model members (`$transaction`,
 * `$executeRaw`, `$connect`, …) are passed through untouched.
 */
import { withTenantTransaction, type PrismaClient } from '@proctira/database';

import { requireTenantId } from './tenant-context.js';

const MODEL_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

export function createTenantBoundPrisma(prisma: PrismaClient): PrismaClient {
  const delegateCache = new Map<string, unknown>();

  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || prop.startsWith('$') || prop.startsWith('_')) {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      const original = Reflect.get(target, prop, receiver) as unknown;
      if (original === null || typeof original !== 'object') {
        return original;
      }
      let delegate = delegateCache.get(prop);
      if (!delegate) {
        delegate = new Proxy(original, {
          get(delegateTarget, op, delegateReceiver) {
            const member = Reflect.get(delegateTarget, op, delegateReceiver) as unknown;
            if (
              typeof op !== 'string' ||
              !MODEL_OPERATIONS.has(op) ||
              typeof member !== 'function'
            ) {
              return member;
            }
            return (...args: unknown[]) => {
              const tenantId = requireTenantId();
              return withTenantTransaction(prisma, tenantId, (tx) => {
                const txDelegate = (tx as unknown as Record<string, Record<string, unknown>>)[prop];
                const txOp = txDelegate?.[op];
                if (typeof txOp !== 'function') {
                  throw new Error(`tenant-bound prisma: ${prop}.${op} unavailable in transaction`);
                }
                return (txOp as (...a: unknown[]) => Promise<unknown>).apply(txDelegate, args);
              });
            };
          },
        });
        delegateCache.set(prop, delegate);
      }
      return delegate;
    },
  });
}
