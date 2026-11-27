import { describe, expect, it } from 'vitest';

import type { ApiRoute, FixtureManifest } from '../../foundation/index.js';

import type { RouteHint } from './body-hints.js';
import { placeholder } from './schema-sample.js';
import {
  buildCasesForRoute,
  ID_KINDS,
  NIL_UUID,
  RANDOM_UUID,
  SEQUENTIAL_ID,
  type AttackCase,
} from './targets.js';

const S_STUDENT = '0000000a-0000-4000-8000-0000000000s1';
const S_INVOICE = '0000000a-0000-4000-8000-0000000000i1';
const A_STUDENT = '0000000b-0000-4000-8000-0000000000a1';
const A_INVOICE = '0000000b-0000-4000-8000-0000000000b1';

const manifest: FixtureManifest = {
  generatedAt: '',
  gitSha: '',
  tenants: {
    S: { id: 'tenant-s', slug: 's', status: 'active', institutions: [] },
    A: { id: 'tenant-a', slug: 'a', status: 'active', institutions: [] },
  } as unknown as FixtureManifest['tenants'],
  ids: {
    students: { S: [S_STUDENT], A: [A_STUDENT] },
    fee_invoices: { S: [S_INVOICE], A: [A_INVOICE] },
    invoices: { S: [S_INVOICE], A: [A_INVOICE] },
  },
  principals: { guardians: {}, students: {} },
};

const route = (method: ApiRoute['method'], path: string): ApiRoute => ({
  method,
  path,
  params: [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? ''),
  mutating: method !== 'GET',
  source: 'openapi',
});

describe('buildCasesForRoute path substitution', () => {
  it('attacks a GET path id with every id kind, using victim id for foreign', () => {
    const cases = buildCasesForRoute(route('GET', '/api/v1/students/:id'), manifest, {
      attacker: 'A',
      victim: 'S',
      hints: [],
    });
    expect(cases.map((c) => c.idKind).sort()).toEqual([...ID_KINDS].sort());
    const byKind = Object.fromEntries(cases.map((c) => [c.idKind, c]));
    expect(byKind['foreign']?.path).toBe(`/api/v1/students/${S_STUDENT}`);
    expect(byKind['random-uuid']?.path).toBe(`/api/v1/students/${RANDOM_UUID}`);
    expect(byKind['nil-uuid']?.path).toBe(`/api/v1/students/${NIL_UUID}`);
    expect(byKind['sequential']?.path).toBe(`/api/v1/students/${SEQUENTIAL_ID}`);
    expect(byKind['foreign']?.victimTable).toBe('students');
  });

  it('fills non-attacked path params with the attacker own id', () => {
    const r = route('GET', '/api/v1/students/:studentId/invoices/:id');
    const cases = buildCasesForRoute(r, manifest, { attacker: 'A', victim: 'S', hints: [] });
    const attackId = cases.find((c) => c.field === 'id' && c.idKind === 'foreign');
    // studentId is filled with the attacker's own student; :id (fee_invoices) with the victim invoice.
    expect(attackId?.path).toBe(`/api/v1/students/${A_STUDENT}/invoices/${S_INVOICE}`);
    expect(attackId?.sentIds).toContain(A_STUDENT);
  });

  it('skips a route whose attacker-side path id cannot be resolved', () => {
    const empty: FixtureManifest = { ...manifest, ids: { fee_invoices: { S: [S_INVOICE] } } };
    const cases = buildCasesForRoute(route('GET', '/api/v1/students/:studentId/x/:id'), empty, {
      attacker: 'A',
      victim: 'S',
      hints: [],
    });
    // :studentId has no attacker id -> no foreign case for :id can be built, but :studentId itself is attacked.
    expect(cases.every((c) => c.field === 'studentId')).toBe(true);
  });

  it('quick scope emits only GET path cases', () => {
    const cases = buildCasesForRoute(route('POST', '/api/v1/students/:id/pay'), manifest, {
      attacker: 'A',
      victim: 'S',
      hints: [],
      scope: 'get-path',
    });
    expect(cases).toHaveLength(0);
  });
});

describe('buildCasesForRoute body substitution', () => {
  const hint: RouteHint = {
    module: 'fees',
    file: 'f.ts',
    method: 'POST',
    pattern: '*/payments',
    bodySchema: 'RecordPaymentSchema',
    bodyTemplate: { invoiceId: placeholder('invoiceId'), amountCents: 1 },
    bodyIdFields: [{ path: 'invoiceId', name: 'invoiceId', array: false, required: true }],
    queryIdFields: [],
  };

  it('substitutes a body id with the victim id and keeps the rest attacker-owned', () => {
    const r = route('POST', '/api/v1/fees/payments');
    const cases = buildCasesForRoute(r, manifest, { attacker: 'A', victim: 'S', hints: [hint] });
    const foreign = cases.find(
      (c) => c.position === 'body' && c.idKind === 'foreign',
    ) as AttackCase;
    expect(foreign).toBeTruthy();
    expect((foreign.body as Record<string, unknown>)['invoiceId']).toBe(S_INVOICE);
    expect((foreign.body as Record<string, unknown>)['amountCents']).toBe(1);
  });

  it('generates a stable, direction-tagged case id', () => {
    const cases = buildCasesForRoute(route('GET', '/api/v1/students/:id'), manifest, {
      attacker: 'A',
      victim: 'S',
      hints: [],
    });
    expect(cases[0]?.caseId).toMatch(/^idor:A->S:GET \/api\/v1\/students\/:id:path\.id:/);
  });
});
