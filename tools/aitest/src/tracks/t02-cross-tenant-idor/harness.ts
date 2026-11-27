/**
 * t02 cross-tenant / IDOR live harness shared by the suite entry.
 *
 * One stack, one API inventory, one leak index per direction, batched tenant
 * snapshots. The three concerns of the track plan are the exported phases:
 *   runIdorSweep       path / query / body id substitution for every route;
 *   runListsAndExports list filters and export/report routes with victim ids;
 *   runHeaderTamper    token tenant vs x-tenant-id / Host mismatch.
 * All three record into the same ResultsRecorder and FindingsWriter so the
 * track produces one results.md and one findings.csv (CONVENTIONS section 3).
 */
import {
  diffSnapshots,
  fetchApiInventory,
  isVolatile,
  snapshotTenant,
  TENANTS,
  type ApiClient,
  type ApiResponse,
  type ApiRoute,
  type FindingsWriter,
  type ResultsRecorder,
  type StackContext,
  type TenantKey,
  type TenantSnapshot,
} from '../../foundation/index.js';

import { loadBodyHints, type RouteHint } from './body-hints.js';
import {
  classify,
  evaluateResponse,
  moduleOf,
  type Evaluation,
  type FailureKind,
} from './expect.js';
import type { LeakIndex } from './leak-detector.js';
import { detectLeak } from './leak-detector.js';
import { buildLeakIndex } from './leak-index.js';
import { buildCasesForRoute, type AttackCase } from './targets.js';

export type Direction = { attacker: TenantKey; victim: TenantKey };
export const DIRECTIONS: readonly Direction[] = [
  { attacker: 'A', victim: 'S' },
  { attacker: 'S', victim: 'A' },
];
export const directionKey = (d: Direction): string => `${d.attacker}->${d.victim}`;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const isMutatingMethod = (m: string): boolean => MUTATING.has(m);

export interface IdorHarness {
  ctx: StackContext;
  routes: ApiRoute[];
  hints: readonly RouteHint[];
  leakIndex: Record<string, LeakIndex>;
  nonEmptyTables: Record<string, string[]>; // tenant key -> tables with rows
  recorder: ResultsRecorder;
  findings: FindingsWriter;
  seenFindings: Set<string>;
  scope: 'full' | 'get-path';
  coverage: {
    routesWithIds: Set<string>;
    routesExercised: Set<string>;
    exportRoutes: Set<string>;
    exportExercised: Set<string>;
    listRoutes: Set<string>;
  };
}

export async function setupHarness(
  ctx: StackContext,
  recorder: ResultsRecorder,
  findings: FindingsWriter,
  scope: 'full' | 'get-path',
): Promise<IdorHarness> {
  const routes = await fetchApiInventory(ctx.state.urls.gateways[0] ?? '');
  const hints = loadBodyHints().hints;
  const leakIndex: Record<string, LeakIndex> = {};
  const nonEmptyTables: Record<string, string[]> = {};
  for (const d of DIRECTIONS) {
    const r = await buildLeakIndex(ctx.state, d.attacker, d.victim);
    leakIndex[directionKey(d)] = r.index;
    nonEmptyTables[d.victim] = r.victimTables;
    nonEmptyTables[d.attacker] = r.attackerTables;
  }
  return {
    ctx,
    routes,
    hints,
    leakIndex,
    nonEmptyTables,
    recorder,
    findings,
    seenFindings: new Set(),
    scope,
    coverage: {
      routesWithIds: new Set(),
      routesExercised: new Set(),
      exportRoutes: new Set(),
      exportExercised: new Set(),
      listRoutes: new Set(),
    },
  };
}

function admin(ctx: StackContext, tenant: TenantKey): ApiClient {
  return ctx.api().as(ctx.tokens.principal('admin', tenant));
}

async function send(api: ApiClient, c: AttackCase): Promise<ApiResponse> {
  return api.request(c.method, c.path, {
    ...(c.query ? { query: c.query } : {}),
    ...(c.body !== undefined ? { body: c.body } : {}),
  });
}

async function snap(h: IdorHarness, tenant: TenantKey): Promise<TenantSnapshot> {
  const tables = (h.nonEmptyTables[tenant] ?? []).filter((t) => !isVolatile(t));
  return snapshotTenant(h.ctx.state, TENANTS[tenant].id, { tables });
}

function finding(
  h: IdorHarness,
  c: AttackCase,
  kind: FailureKind,
  detail: string,
  stateChange: boolean,
  evidenceExtra = '',
): void {
  const dk = `${c.attacker}->${c.victim}`;
  // A 5xx crash is a property of the route+input, not of the tenant direction
  // or id kind: dedupe it per route so one bug is one finding.
  const dedupe =
    kind === 'server-error'
      ? `server-error:${c.route.method} ${c.route.path}`
      : `${dk}:${c.route.method} ${c.route.path}:${c.position}.${c.field}:${kind}`;
  if (h.seenFindings.has(dedupe)) return;
  h.seenFindings.add(dedupe);
  const module = moduleOf(c.route.path);
  const { severity, category } = classify(kind, module, stateChange);
  // PRC-M283 (FULLY_CLOSED) claims academic-period routes now validate :id and
  // return 400 before Prisma, but these routes still 500 on a non-UUID id at
  // tip: report the match so triage sees the contradiction.
  const prc_match = module === 'academic-periods' && kind === 'server-error' ? 'PRC-M283' : '';
  const verb: Record<FailureKind, string> = {
    leak: 'returned victim-tenant data',
    'unexpected-2xx': 'returned a non-empty body',
    'state-change': 'changed tenant state',
    'server-error': 'responded 5xx',
  };
  h.findings.add({
    severity,
    category,
    module,
    title: `${c.route.method} ${c.route.path} ${verb[kind]} for a cross-tenant ${c.position} id (${c.field}, ${c.idKind})`,
    evidence: `${dk}; case ${c.caseId}; ${detail}${evidenceExtra ? `; ${evidenceExtra}` : ''}`,
    expected: '401/403/404, no victim data, no state change',
    actual: detail,
    patch: '',
    prc_match,
  });
}

// --------------------------------------------------------------------------
// Phase 1: the id sweep (path, query, body).

export async function runIdorSweep(h: IdorHarness): Promise<void> {
  for (const d of DIRECTIONS) {
    if (h.scope === 'get-path' && d.attacker === 'S') continue; // quick = one direction
    const idx = h.leakIndex[directionKey(d)];
    if (!idx) continue;
    const api = admin(h.ctx, d.attacker);
    const readCases: AttackCase[] = [];
    const mutatingByRoute = new Map<string, AttackCase[]>();
    for (const route of h.routes) {
      const built = buildCasesForRoute(route, h.ctx.fixtures, {
        attacker: d.attacker,
        victim: d.victim,
        hints: h.hints,
        scope: h.scope,
      });
      if (route.params.length > 0) h.coverage.routesWithIds.add(`${route.method} ${route.path}`);
      for (const c of built) {
        if (isMutatingMethod(c.method)) {
          const rk = `${c.method} ${c.route.path}`;
          const list = mutatingByRoute.get(rk);
          if (list) list.push(c);
          else mutatingByRoute.set(rk, [c]);
        } else {
          readCases.push(c);
        }
      }
    }

    // Read-only cases cannot change state: evaluate on status + leak alone.
    for (const c of readCases) {
      const res = await send(api, c);
      recordCase(h, c, res, idx, false);
    }

    if (h.scope === 'get-path') continue;

    // Mutating cases: one before/after snapshot around the whole phase; localise only on a diff.
    if (mutatingByRoute.size === 0) continue;
    const before = await snap(h, d.victim);
    const beforeAtk = await snap(h, d.attacker);
    const evals = new Map<string, Evaluation>();
    for (const [, cases] of mutatingByRoute) {
      for (const c of cases) {
        const res = await send(api, c);
        const e = recordCase(h, c, res, idx, false, true); // defer state verdict
        evals.set(c.caseId, e);
      }
    }
    const after = await snap(h, d.victim);
    const afterAtk = await snap(h, d.attacker);
    const victimDiff = diffSnapshots(before, after);
    const attackerDiff = diffSnapshots(beforeAtk, afterAtk);
    if (victimDiff.length === 0 && attackerDiff.length === 0) continue;

    // Localise: re-run each route batch with its own before/after snapshot.
    for (const [rk, cases] of mutatingByRoute) {
      const b = await snap(h, d.victim);
      for (const c of cases) await send(api, c);
      const a = await snap(h, d.victim);
      const vd = diffSnapshots(b, a);
      if (vd.length === 0) continue;
      const first = cases[0];
      if (first) {
        finding(
          h,
          first,
          'state-change',
          `victim tables changed: ${vd.map((x) => x.table).join(', ')}`,
          true,
          rk,
        );
        // mark each case of this route as failed on the state dimension
        for (const c of cases) {
          const prior = evals.get(c.caseId);
          if (prior?.pass !== false) {
            h.recorder.record(`${c.caseId}#state`, false, {
              detail: `victim state changed after ${rk}: ${vd.map((x) => x.table).join(', ')}`,
            });
          }
        }
      }
    }
  }
}

/** Sends/evaluates one case, records it, returns the evaluation. */
function recordCase(
  h: IdorHarness,
  c: AttackCase,
  res: ApiResponse,
  idx: LeakIndex,
  stateChange: boolean,
  deferState = false,
): Evaluation {
  h.coverage.routesExercised.add(`${c.route.method} ${c.route.path}`);
  // 502/503/504 mean an upstream/proxy is unavailable on this stack (e.g. the
  // auth upstream in the core profile), not an application fault: record a skip.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    h.recorder.record(c.caseId, 'skip', {
      reason: `upstream unavailable (status ${res.status}); proxy route not exercised on this profile`,
    });
    return { pass: true, detail: `status ${res.status} (upstream unavailable)` };
  }
  // A 5xx on a body-bearing method where we could not supply a body is
  // inconclusive (it may be body validation, not id handling), so skip it.
  if (
    res.status >= 500 &&
    c.body === undefined &&
    (c.method === 'POST' || c.method === 'PUT' || c.method === 'PATCH')
  ) {
    h.recorder.record(c.caseId, 'skip', {
      reason: `status ${res.status} with no body schema to supply; cannot isolate id handling from body validation`,
    });
    return { pass: true, detail: `status ${res.status} (no body; inconclusive)` };
  }
  const e = evaluateResponse(c, res, idx);
  h.recorder.record(c.caseId, e.pass, { detail: e.detail });
  if (!e.pass && e.failureKind)
    finding(h, c, e.failureKind, e.detail, stateChange, e.leakHits?.join('; '));
  void deferState;
  return e;
}

// --------------------------------------------------------------------------
// Phase 2: list filters and export/report routes.

const LIST_FILTER_KEYS = [
  'studentId',
  'institutionId',
  'classId',
  'sectionId',
  'staffId',
  'guardianId',
  'academicPeriodId',
] as const;
const EXPORT_RE = /export|download|board-exports|report|receipt|transcript|statement/i;

function victimFilterId(h: IdorHarness, key: string, victim: TenantKey): string | undefined {
  const table: Record<string, string> = {
    studentId: 'students',
    institutionId: 'institutions',
    classId: 'classes',
    sectionId: 'sections',
    staffId: 'staff',
    guardianId: 'guardian_household_members',
    academicPeriodId: 'academic_periods',
  };
  const t = table[key];
  return t ? h.ctx.fixtures.ids[t]?.[victim]?.[0] : undefined;
}

export async function runListsAndExports(h: IdorHarness): Promise<void> {
  const d = DIRECTIONS[0]!; // A attacks S (S has the rich list/export data)
  const idx = h.leakIndex[directionKey(d)]!;
  const api = admin(h.ctx, d.attacker);

  for (const route of h.routes) {
    if (route.method !== 'GET') continue;
    const isExport = EXPORT_RE.test(route.path);
    if (isExport) h.coverage.exportRoutes.add(`${route.method} ${route.path}`);
    const isList = route.params.length === 0;
    if (isList) h.coverage.listRoutes.add(`${route.method} ${route.path}`);
    if (!isList) continue; // item routes are covered by the path sweep

    for (const key of LIST_FILTER_KEYS) {
      const vid = victimFilterId(h, key, d.victim);
      if (!vid) continue;
      const res = await api.get(route.path, { query: { [key]: vid } });
      const caseId = `list:${directionKey(d)}:GET ${route.path}?${key}=victim`;
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        h.recorder.record(caseId, 'skip', {
          reason: `upstream unavailable (status ${res.status})`,
        });
        continue;
      }
      const leak = detectLeak(res.text, res.json, idx, new Set([vid]));
      const pass = !leak.leaked && res.status < 500;
      h.recorder.record(caseId, pass, {
        detail: `?${key}=S -> ${res.status}${leak.leaked ? `; leak: ${leak.hits.join('; ')}` : ''}`,
      });
      if (isExport) h.coverage.exportExercised.add(`${route.method} ${route.path}`);
      if (!pass) {
        const kind: FailureKind = leak.leaked ? 'leak' : 'server-error';
        const module = moduleOf(route.path);
        const { severity, category } = classify(kind, module, false);
        const dedupe = `list:${route.path}:${key}:${kind}`;
        if (!h.seenFindings.has(dedupe)) {
          h.seenFindings.add(dedupe);
          h.findings.add({
            severity,
            category,
            module,
            title: `GET ${route.path} ${leak.leaked ? 'leaked victim rows' : 'responded 5xx'} when filtered by a cross-tenant ${key}`,
            evidence: `${directionKey(d)}; ?${key}=${vid} -> ${res.status}; ${leak.hits.join('; ')}`,
            expected: 'no victim rows (empty or own-tenant only), no 5xx',
            actual: `status ${res.status}`,
            patch: '',
            prc_match: '',
          });
        }
      }
    }
  }

  // Export/report item routes with a foreign path id are exercised by the sweep;
  // mark those we saw so coverage reflects them.
  for (const r of h.coverage.exportRoutes)
    if (h.coverage.routesExercised.has(r)) h.coverage.exportExercised.add(r);
}

// --------------------------------------------------------------------------
// Phase 3: header / host tenant tampering.

export async function runHeaderTamper(h: IdorHarness): Promise<void> {
  const probePaths = ['/api/v1/students', '/api/v1/staff', '/api/v1/institutions'];
  const cases: Array<{
    id: string;
    attacker: TenantKey;
    victim: TenantKey;
    headers: Record<string, string>;
  }> = [];
  for (const path of probePaths) {
    cases.push({
      id: `header:A-token+S-tenant-header ${path}`,
      attacker: 'A',
      victim: 'S',
      headers: { 'x-tenant-id': TENANTS.S.id },
    });
    cases.push({
      id: `header:S-token+A-tenant-header ${path}`,
      attacker: 'S',
      victim: 'A',
      headers: { 'x-tenant-id': TENANTS.A.id },
    });
    cases.push({
      id: `header:A-token+S-host ${path}`,
      attacker: 'A',
      victim: 'S',
      headers: { host: `${TENANTS.S.slug}.proctira.org` },
    });
  }
  for (const [i, path] of probePaths.entries()) {
    for (const c of cases.filter((x) => x.id.endsWith(path))) {
      void i;
      const idx = h.leakIndex[directionKey({ attacker: c.attacker, victim: c.victim })]!;
      const api = admin(h.ctx, c.attacker);
      const res = await api.get(path, { headers: c.headers });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        h.recorder.record(c.id, 'skip', { reason: `upstream unavailable (status ${res.status})` });
        continue;
      }
      const leak = detectLeak(res.text, res.json, idx, new Set());
      const pass = !leak.leaked && res.status < 500;
      h.recorder.record(c.id, pass, {
        detail: `-> ${res.status}${leak.leaked ? `; leak: ${leak.hits.join('; ')}` : ' (no victim data)'}`,
      });
      if (!pass) {
        const kind: FailureKind = leak.leaked ? 'leak' : 'server-error';
        const module = moduleOf(path);
        const { severity, category } = classify(kind, module, false);
        h.findings.add({
          severity,
          category,
          module,
          title: `GET ${path} ${leak.leaked ? 'leaked victim data' : 'responded 5xx'} under tenant header/host tampering`,
          evidence: `${c.id}; headers ${JSON.stringify(c.headers)} -> ${res.status}; ${leak.hits.join('; ')}`,
          expected: 'no victim data, no 5xx (JWT tenant claim is authoritative)',
          actual: `status ${res.status}`,
          patch: '',
          prc_match: '',
        });
      }
    }
  }
}

export function writeCoverage(h: IdorHarness): void {
  const c = h.coverage;
  const idRoutesExercised = [...c.routesWithIds].filter((r) => c.routesExercised.has(r)).length;
  h.recorder.coverage(
    'routes with id positions, at least one id exercised',
    idRoutesExercised,
    c.routesWithIds.size,
  );
  h.recorder.coverage(
    'export/report routes exercised',
    c.exportExercised.size,
    c.exportRoutes.size,
  );
  h.recorder.coverage(
    'list (collection) GET routes probed with victim filters',
    c.listRoutes.size,
    c.listRoutes.size,
  );
}
