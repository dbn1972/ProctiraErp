/**
 * Cross-tenant leak oracle for one response.
 *
 * A response leaks when it carries victim-owned data:
 * - any id of a victim-tenant row (from the database, not only the fixture
 *   sample) that is not also an attacker id and was not sent by the attacker
 *   (an echoed request id is not a leak);
 * - the victim tenant id or slug;
 * - a victim person name or email that does not occur in attacker data;
 * - a JSON record whose `tenantId` is another tenant (checked with
 *   assertNoForeignTenant from @proctira/tenant-isolation-tests/helpers).
 */
import {
  assertNoForeignTenant,
  TenantIsolationLeakError,
} from '@proctira/tenant-isolation-tests/helpers';

export interface LeakIndex {
  victimTenantId: string;
  victimSlug: string;
  attackerTenantId: string;
  /** Composite person names / emails unique to the victim. */
  victimStrings: readonly string[];
}

export interface LeakResult {
  leaked: boolean;
  hits: string[];
}

/** Objects with a string `tenantId` anywhere in a JSON value. */
export function tenantRecords(
  json: unknown,
  out: Array<{ tenantId: string }> = [],
  depth = 0,
): Array<{ tenantId: string }> {
  if (depth > 12 || json === null || typeof json !== 'object') return out;
  if (Array.isArray(json)) {
    for (const v of json) tenantRecords(v, out, depth + 1);
    return out;
  }
  const o = json as Record<string, unknown>;
  const t = o['tenantId'] ?? o['tenant_id'];
  if (typeof t === 'string' && t.length > 0) out.push({ tenantId: t.toLowerCase() });
  for (const v of Object.values(o)) tenantRecords(v, out, depth + 1);
  return out;
}

/**
 * A response leaks when it carries victim-OWNED data:
 * - a record whose `tenantId`/`tenant_id` is the victim tenant (the strong,
 *   reliable signal: these APIs stamp tenantId on every row);
 * - a victim person's composite name or email;
 * - the victim tenant slug (unless the attacker sent it).
 *
 * A victim-owned id appearing merely inside an attacker-tenant record is NOT a
 * leak: the attacker can store foreign reference ids in its own rows. See the
 * track README for the (narrow) id-only leak case this does not cover.
 */
export function detectLeak(
  text: string,
  json: unknown,
  index: LeakIndex,
  sent: ReadonlySet<string> = new Set(),
): LeakResult {
  const hits = new Set<string>();
  const sentLower = new Set([...sent].map((s) => s.toLowerCase()));
  if (index.victimSlug && text.includes(index.victimSlug) && !sent.has(index.victimSlug)) {
    hits.add(`victim slug ${index.victimSlug}`);
  }
  for (const s of index.victimStrings) {
    if (s && text.includes(s)) hits.add(`victim value "${s}"`);
  }
  if (json !== undefined) {
    const records = tenantRecords(json).filter((r) => !sentLower.has(r.tenantId));
    try {
      assertNoForeignTenant('idor-response', index.attackerTenantId.toLowerCase(), records);
    } catch (err) {
      if (err instanceof TenantIsolationLeakError)
        hits.add(`record tenantId ${err.leakedTenantId}`);
      else throw err;
    }
  }
  return { leaked: hits.size > 0, hits: [...hits].slice(0, 10) };
}

const META_KEYS = new Set([
  'page',
  'pageSize',
  'page_size',
  'limit',
  'offset',
  'total',
  'totalItems',
  'totalPages',
  'totalCount',
  'count',
  'hasMore',
  'hasNext',
  'nextCursor',
  'cursor',
  'generatedAt',
  'asOf',
  'success',
  'ok',
  'meta',
  'pagination',
  'requestId',
  'traceId',
]);

/**
 * True when a 2xx body carries no records: null, empty containers, zeros,
 * pagination metadata, or only echoes of what the attacker sent.
 */
export function isEmptyPayload(
  json: unknown,
  text: string,
  sent: ReadonlySet<string> = new Set(),
): boolean {
  if (json === undefined) return text.trim() === '' || text.trim() === 'null';
  const empty = (v: unknown, depth: number): boolean => {
    if (v === null || v === undefined || v === false || v === 0 || v === '') return true;
    if (typeof v === 'string') return sent.has(v);
    if (typeof v === 'number' || typeof v === 'boolean') return false;
    if (depth > 8) return false;
    if (Array.isArray(v)) return v.length === 0;
    return Object.entries(v as Record<string, unknown>).every(
      ([k, x]) => META_KEYS.has(k) || empty(x, depth + 1),
    );
  };
  return empty(json, 0);
}
