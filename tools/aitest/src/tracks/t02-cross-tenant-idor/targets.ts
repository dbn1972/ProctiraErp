/**
 * Builds cross-tenant / IDOR attack cases from the live API inventory and the
 * fixture manifest.
 *
 * For every route, every id position (path param, query key, body field) is
 * attacked with:
 * - `foreign`: an id owned by the victim tenant (the real IDOR);
 * - `random-uuid`: a well-formed UUID that belongs to nobody;
 * - `sequential`: a short guessable id (`1`);
 * - `nil-uuid`: the all-zero UUID.
 * Non-attacked path/body ids are filled with the attacker's own ids so the
 * request reaches the id-handling code. Each case names its attacker and
 * victim tenant; the suites run A→S (victim has rich data) and, for tables
 * where A has rows, S→A.
 */
import type { ApiRoute, FixtureManifest, HttpMethod, TenantKey } from '../../foundation/index.js';
import { resolveParam } from '../../foundation/index.js';

import { matchHint, type RouteHint } from './body-hints.js';
import { candidateFixtureTables } from './fixture-tables.js';
import { fillTemplate, type IdField } from './schema-sample.js';

export type IdKind = 'foreign' | 'random-uuid' | 'sequential' | 'nil-uuid';
export const ID_KINDS: readonly IdKind[] = ['foreign', 'random-uuid', 'sequential', 'nil-uuid'];

export const RANDOM_UUID = '3f0e8c2a-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const SEQUENTIAL_ID = '1';

export type Position = 'path' | 'query' | 'body';

export interface AttackCase {
  caseId: string;
  route: ApiRoute;
  method: HttpMethod;
  position: Position;
  /** Param name (path/query) or dotted body path. */
  field: string;
  idKind: IdKind;
  attacker: TenantKey;
  victim: TenantKey;
  /** Resolved request path with the attack id in a path param, attacker ids elsewhere. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** The attacked id value. */
  attackId: string;
  /** All ids the attacker legitimately put in the request (echoes are not leaks). */
  sentIds: string[];
  /** Victim table the attacked id came from (foreign kind only). */
  victimTable?: string;
}

function idForKind(kind: IdKind, foreign: string | undefined): string | undefined {
  switch (kind) {
    case 'foreign':
      return foreign;
    case 'random-uuid':
      return RANDOM_UUID;
    case 'nil-uuid':
      return NIL_UUID;
    case 'sequential':
      return SEQUENTIAL_ID;
  }
}

/** Victim id for a named field, trying every candidate fixture table. */
export function victimIdForField(
  name: string,
  segmentsBefore: string[],
  f: FixtureManifest,
  victim: TenantKey,
): { id: string; table: string } | undefined {
  const viaParam = resolveParam(name, segmentsBefore, f, victim);
  if (viaParam) return { id: viaParam.id, table: viaParam.table };
  for (const table of candidateFixtureTables(name)) {
    const id = f.ids[table]?.[victim]?.[0];
    if (id) return { id, table };
  }
  return undefined;
}

function attackerFill(
  name: string,
  segmentsBefore: string[],
  f: FixtureManifest,
  attacker: TenantKey,
): string | undefined {
  const viaParam = resolveParam(name, segmentsBefore, f, attacker);
  if (viaParam) return viaParam.id;
  for (const table of candidateFixtureTables(name)) {
    const id = f.ids[table]?.[attacker]?.[0];
    if (id) return id;
  }
  return undefined;
}

const caseId = (c: Omit<AttackCase, 'caseId'>): string =>
  `idor:${c.attacker}->${c.victim}:${c.method} ${c.route.path}:${c.position}.${c.field}:${c.idKind}`;

export interface BuildOptions {
  attacker: TenantKey;
  victim: TenantKey;
  hints: readonly RouteHint[];
  /** GET routes with path ids only (nightly quick scope). */
  scope?: 'full' | 'get-path';
  idKinds?: readonly IdKind[];
}

export function buildCasesForRoute(
  route: ApiRoute,
  f: FixtureManifest,
  o: BuildOptions,
): AttackCase[] {
  const kinds = o.idKinds ?? ID_KINDS;
  const quick = o.scope === 'get-path';
  if (quick && route.method !== 'GET') return [];
  const cases: AttackCase[] = [];
  const segments = route.path.split('/');

  // Attacker-filled base path (every path param = attacker's own id).
  const pathParamFill: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    if (!seg.startsWith(':')) continue;
    const name = seg.slice(1);
    const fill = attackerFill(name, segments.slice(0, i), f, o.attacker);
    if (fill) pathParamFill[name] = fill;
  }

  const buildPath = (override: { name: string; value: string }): string =>
    segments
      .map((seg) => {
        if (!seg.startsWith(':')) return seg;
        const name = seg.slice(1);
        const value = name === override.name ? override.value : pathParamFill[name];
        return value !== undefined ? encodeURIComponent(value) : seg;
      })
      .join('/');

  const pathParams = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1));

  // A mutating route needs a body to reach its id handling; attach the route's
  // body template filled entirely with attacker ids (no foreign override) so a
  // path/query id case exercises the id, not body validation.
  const hint = matchHint(route, o.hints);
  let attackerBody: unknown;
  let attackerBodyIds: string[] = [];
  if (route.mutating && !quick && hint?.bodyTemplate !== undefined) {
    const filled = fillBody(hint, '__none__', '', f, o.attacker);
    attackerBody = filled.body;
    attackerBodyIds = filled.bodyIds;
  }

  // 1. Path params. Attack one param at a time; skip when another path param
  // could not be filled with an attacker id (the request would be malformed).
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    if (!seg.startsWith(':')) continue;
    const name = seg.slice(1);
    const othersUnresolved = pathParams.some((p) => p !== name && pathParamFill[p] === undefined);
    if (othersUnresolved) continue;
    const before = segments.slice(0, i);
    const foreign = victimIdForField(name, before, f, o.victim);
    const sentOthers = Object.entries(pathParamFill)
      .filter(([k]) => k !== name)
      .map(([, v]) => v);
    for (const kind of kinds) {
      if (kind === 'foreign' && !foreign) continue;
      const attackId = idForKind(kind, foreign?.id);
      if (attackId === undefined) continue;
      const base: Omit<AttackCase, 'caseId'> = {
        route,
        method: route.method,
        position: 'path',
        field: name,
        idKind: kind,
        attacker: o.attacker,
        victim: o.victim,
        path: buildPath({ name, value: attackId }),
        ...(attackerBody !== undefined ? { body: attackerBody } : {}),
        attackId,
        sentIds: [...sentOthers, ...attackerBodyIds],
        ...(kind === 'foreign' && foreign ? { victimTable: foreign.table } : {}),
      };
      cases.push({ ...base, caseId: caseId(base) });
    }
  }

  if (quick) return cases;

  const basePath = segments
    .map((seg) => {
      if (!seg.startsWith(':')) return seg;
      const v = pathParamFill[seg.slice(1)];
      return v !== undefined ? encodeURIComponent(v) : seg;
    })
    .join('/');
  const pathResolved = !segments.some(
    (s) => s.startsWith(':') && pathParamFill[s.slice(1)] === undefined,
  );
  if (!pathResolved) return cases;

  if (!hint) return cases;

  // 2. Query id keys (from the route's query-validation schema).
  for (const qf of hint.queryIdFields) {
    cases.push(...queryCases(route, basePath, pathParamFill, qf, hint, f, o, kinds));
  }

  // 3. Body id fields (mutating routes with a body hint).
  if (route.mutating && hint.bodyTemplate !== undefined) {
    for (const bf of hint.bodyIdFields) {
      cases.push(...bodyCases(route, basePath, pathParamFill, bf, hint, f, o, kinds));
    }
  }
  return cases;
}

function queryCases(
  route: ApiRoute,
  basePath: string,
  pathFill: Record<string, string>,
  qf: IdField,
  hint: RouteHint,
  f: FixtureManifest,
  o: BuildOptions,
  kinds: readonly IdKind[],
): AttackCase[] {
  const out: AttackCase[] = [];
  const baseQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(hint.queryTemplate ?? {})) {
    if (typeof v === 'string' && !v.startsWith('{{id:')) baseQuery[k] = v;
  }
  const foreign = victimIdForField(qf.name, [], f, o.victim);
  const sent = Object.values(pathFill);
  for (const kind of kinds) {
    if (kind === 'foreign' && !foreign) continue;
    const attackId = idForKind(kind, foreign?.id);
    if (attackId === undefined) continue;
    const base: Omit<AttackCase, 'caseId'> = {
      route,
      method: route.method,
      position: 'query',
      field: qf.name,
      idKind: kind,
      attacker: o.attacker,
      victim: o.victim,
      path: basePath,
      query: { ...baseQuery, [qf.name]: attackId },
      attackId,
      sentIds: sent,
      ...(kind === 'foreign' && foreign ? { victimTable: foreign.table } : {}),
    };
    out.push({ ...base, caseId: caseId(base) });
  }
  return out;
}

function bodyCases(
  route: ApiRoute,
  basePath: string,
  pathFill: Record<string, string>,
  bf: IdField,
  hint: RouteHint,
  f: FixtureManifest,
  o: BuildOptions,
  kinds: readonly IdKind[],
): AttackCase[] {
  const out: AttackCase[] = [];
  const foreign = victimIdForField(bf.name, [], f, o.victim);
  const sentPath = Object.values(pathFill);
  for (const kind of kinds) {
    if (kind === 'foreign' && !foreign) continue;
    const attackId = idForKind(kind, foreign?.id);
    if (attackId === undefined) continue;
    const sent = new Set(sentPath);
    const { body, bodyIds } = fillBody(hint, bf.path, attackId, f, o.attacker);
    for (const id of bodyIds) sent.add(id);
    sent.delete(attackId);
    const base: Omit<AttackCase, 'caseId'> = {
      route,
      method: route.method,
      position: 'body',
      field: bf.path,
      idKind: kind,
      attacker: o.attacker,
      victim: o.victim,
      path: basePath,
      body,
      attackId,
      sentIds: [...sent],
      ...(kind === 'foreign' && foreign ? { victimTable: foreign.table } : {}),
    };
    out.push({ ...base, caseId: caseId(base) });
  }
  return out;
}

/** Fill a body template: attacked field = attackId, other id slots = attacker ids. */
export function fillBody(
  hint: RouteHint,
  attackedPath: string,
  attackId: string,
  f: FixtureManifest,
  attacker: TenantKey,
): { body: unknown; bodyIds: string[] } {
  const bodyIds: string[] = [];
  const resolve = (name: string): string => {
    const fill = attackerFill(name, [], f, attacker);
    const v = fill ?? RANDOM_UUID;
    bodyIds.push(v);
    return v;
  };
  const body = fillTemplate(hint.bodyTemplate, resolve, { [attackedPath]: attackId });
  return { body, bodyIds };
}
