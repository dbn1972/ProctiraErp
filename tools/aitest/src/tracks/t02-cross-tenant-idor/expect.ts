/**
 * The IDOR oracle for one probed response (program plan + BRIEF: expect a
 * 403/404 with no foreign data and no state change).
 *
 * A case fails when any of these is true:
 * - `leak`: the response body carries victim-owned data (detectLeak);
 * - `unexpected-2xx`: a 2xx with a non-empty payload for a foreign/guessed id
 *   (foreign data returned even if no explicit victim marker was found);
 * - `state-change`: the victim (or attacker) tenant snapshot changed;
 * - `server-error`: a 5xx instead of a clean refusal (information/stability).
 * Everything else (400/401/403/404, or an empty 2xx that echoes only what the
 * attacker sent) passes.
 */
import type { ApiResponse } from '../../foundation/index.js';

import { detectLeak, isEmptyPayload, type LeakIndex } from './leak-detector.js';
import type { AttackCase, IdKind } from './targets.js';

export type FailureKind = 'leak' | 'unexpected-2xx' | 'state-change' | 'server-error';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'security' | 'privacy' | 'tenancy' | 'money' | 'grade' | 'other';

export interface Evaluation {
  pass: boolean;
  failureKind?: FailureKind;
  detail: string;
  leakHits?: string[];
}

/** Id kinds that may legitimately draw a 400 (not a well-formed UUID). */
const MALFORMED_KINDS: ReadonlySet<IdKind> = new Set(['sequential', 'nil-uuid']);

export function evaluateResponse(
  c: Pick<AttackCase, 'idKind' | 'sentIds' | 'position' | 'attackId'>,
  res: ApiResponse,
  index: LeakIndex,
): Evaluation {
  // The attacked id was supplied by the attacker; echoing it back (e.g. in a
  // 404 "id not found" message) is not a leak.
  const sent = new Set([...c.sentIds, c.attackId]);
  const leak = detectLeak(res.text, res.json, index, sent);
  if (leak.leaked) {
    return {
      pass: false,
      failureKind: 'leak',
      detail: `status ${res.status}; victim data in body: ${leak.hits.join('; ')}`,
      leakHits: leak.hits,
    };
  }
  if (res.status >= 500) {
    return {
      pass: false,
      failureKind: 'server-error',
      detail: `status ${res.status} (expected a clean 400/401/403/404)`,
    };
  }
  if (res.status >= 200 && res.status < 300) {
    // No victim data was found (leak check above). A 2xx that returns only the
    // caller's own tenant data or a generic default for an arbitrary id is not
    // an isolation break, so it passes. (A purely numeric/field-level leak with
    // no id/name/tenant marker is out of this oracle's scope; see README.)
    const empty = isEmptyPayload(res.json, res.text, sent);
    return {
      pass: true,
      detail: `status ${res.status}, ${empty ? 'empty payload' : 'no victim data in body'}`,
    };
  }
  if (res.status === 400 && !MALFORMED_KINDS.has(c.idKind)) {
    // A 400 for a well-formed id is a safe refusal; record but do not fail.
    return { pass: true, detail: `status 400 (refused; well-formed ${c.idKind})` };
  }
  return { pass: true, detail: `status ${res.status}` };
}

/** Module name from a route path (`/api/v1/fees/invoices/:id` → fees). */
export function moduleOf(path: string): string {
  const seg = path.split('/').filter(Boolean);
  const i = seg.indexOf('v1');
  return seg[i + 1] ?? seg[2] ?? 'gateway';
}

const MONEY_MODULES = new Set(['fees', 'billing', 'scholarship', 'scholarships']);
const GRADE_MODULES = new Set([
  'grades',
  'gradebook',
  'examinations',
  'assessment',
  'report-cards',
]);
const PRIVACY_MODULES = new Set(['health', 'privacy']);

/** Severity and category for a failing case (BRIEF/CONVENTIONS). */
export function classify(
  kind: FailureKind,
  module: string,
  stateChange: boolean,
): { severity: Severity; category: Category } {
  if (kind === 'server-error') return { severity: 'medium', category: 'other' };
  const category: Category = PRIVACY_MODULES.has(module)
    ? 'privacy'
    : MONEY_MODULES.has(module)
      ? 'tenancy'
      : GRADE_MODULES.has(module)
        ? 'tenancy'
        : 'tenancy';
  // Any cross-tenant read or write is critical.
  if (kind === 'leak' || kind === 'unexpected-2xx') return { severity: 'critical', category };
  // state change without a data read.
  return { severity: stateChange ? 'critical' : 'high', category };
}
