/**
 * Unit tests for the V15-19 error-code registry gate.
 *
 * The selection rule is asserted on fixtures rather than only on the live tree, because the
 * live tree changes underneath the gate and a rule that is only ever exercised against it
 * cannot be shown to reject the right things.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluate, parseRegistry, scanSource } from './check-error-code-registry.mjs';

test('selects codes in envelope position', () => {
  const found = scanSource(`
    return reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Access denied',
      statusCode: 403,
    });
  `);
  assert.deepEqual([...found.keys()], ['FORBIDDEN']);
  assert.deepEqual([...found.get('FORBIDDEN')], [403]);
});

test('ignores `code` used as an ordinary domain field', () => {
  // This is the distinction that took the live count from 111 to 41: subject, board and
  // academic-year codes all use a `code:` property and are not error codes.
  const found = scanSource(`
    const subjects = [
      { code: 'MATH', name: 'Mathematics' },
      { code: 'SCI', name: 'Science' },
    ];
    const board = { code: 'CBSE', label: 'Central Board' };
    const term = { code: 'AY25', startsOn: '2025-04-01' };
  `);
  assert.equal(found.size, 0);
});

test('does not treat a distant statusCode as a sibling', () => {
  const lines = [
    "const subject = { code: 'MATH' };",
    ...Array.from({ length: 8 }, () => '// filler'),
    'const response = { statusCode: 400 };',
  ].join('\n');
  assert.equal(scanSource(lines).size, 0);
});

test('records every status a code is emitted with', () => {
  const found = scanSource(`
    reply.status(404).send({ code: 'NOT_FOUND', message: 'a', statusCode: 404 });
    reply.status(403).send({ code: 'NOT_FOUND', message: 'b', statusCode: 403 });
  `);
  assert.deepEqual([...found.get('NOT_FOUND')].sort(), [403, 404]);
});

test('parseRegistry reads code and httpStatus pairs', () => {
  const registry = parseRegistry(`
    {
      code: 'TENANT_REQUIRED',
      httpStatus: 400,
      description: 'x',
      since: '1.2.0',
      retryable: false,
    },
  `);
  assert.equal(registry.get('TENANT_REQUIRED'), 400);
});

test('fails on a code that is emitted but not registered', () => {
  const report = evaluate({
    emitted: new Map([['NEW_THING', new Set([418])]]),
    registry: new Map([['FORBIDDEN', 403]]),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.unregistered, [{ code: 'NEW_THING', statuses: [418] }]);
});

test('fails when the registry claims a status the source never emits', () => {
  // A published status a client would switch on and never see is as misleading as a missing
  // entry.
  const report = evaluate({
    emitted: new Map([['TENANT_REQUIRED', new Set([400])]]),
    registry: new Map([['TENANT_REQUIRED', 500]]),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.statusDrift, [
    { code: 'TENANT_REQUIRED', declared: 500, observed: [400] },
  ]);
});

test('passes when the registry lists one of several observed statuses', () => {
  // `NOT_FOUND` is emitted at both 404 and 403 in this codebase; the registry names the
  // canonical one and the gate must not treat the second as drift.
  const report = evaluate({
    emitted: new Map([['NOT_FOUND', new Set([404, 403])]]),
    registry: new Map([['NOT_FOUND', 404]]),
  });
  assert.equal(report.ok, true);
});

test('fails on a waiver that no longer matches any emit site', () => {
  // A stale waiver is a lie with a comment on it. This arm fired on its own author during
  // development, which is why it exists.
  const report = evaluate({
    emitted: new Map([['FORBIDDEN', new Set([403])]]),
    registry: new Map([['FORBIDDEN', 403]]),
    waived: new Map([['GONE_FOREVER', 'no longer emitted']]),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.staleWaivers, ['GONE_FOREVER']);
});

test('a waived code is neither reported nor required in the registry', () => {
  const report = evaluate({
    emitted: new Map([['VENDOR_CODE', new Set([502])]]),
    registry: new Map(),
    waived: new Map([['VENDOR_CODE', 'raised by an upstream SDK']]),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.unregistered, []);
});
