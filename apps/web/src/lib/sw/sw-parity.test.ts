/**
 * PRC-L253 — public/sw.js hand-mirrors pickStrategy.ts. Load the real sw.js
 * in a VM sandbox and assert its classifier makes the same decision as the
 * unit-tested TS module for a table of URLs, so drift fails CI.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { pickStrategy } from './pickStrategy';

type SwPick = (method: string, url: string) => string;

function loadSwClassifier(): { pick: SwPick; events: string[] } {
  const source = readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');
  const events: string[] = [];
  const sandbox: Record<string, unknown> = {
    URL,
    Headers,
    Response,
    Request,
    Set,
    Map,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
    fetch: async () => new Response(''),
    self: {
      addEventListener: (type: string) => events.push(type),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined, matchAll: async () => [] },
      location: { origin: 'http://localhost' },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sw.js' });
  const pick = sandbox.pickStrategy;
  if (typeof pick !== 'function') throw new Error('sw.js no longer defines pickStrategy');
  return { pick: pick as SwPick, events };
}

const CASES: Array<[string, string]> = [
  ['GET', '/api/v1/dashboards/admin'],
  ['GET', '/api/v1/students'],
  ['GET', '/api/v1/students/123?page=2'],
  ['GET', '/api/v1/institutions/abc'],
  ['GET', '/api/v1/staff'],
  ['POST', '/api/v1/students'],
  ['PUT', '/api/v1/staff/1'],
  ['PATCH', '/api/v1/institutions/1'],
  ['DELETE', '/api/v1/students/1'],
  ['GET', '/api/v1/auth/session'],
  ['GET', '/api/v1/tenant/branding'],
  ['GET', '/api/v1/fees/invoices'],
  ['GET', '/_next/static/chunks/main.js'],
  ['GET', '/static/logo.png'],
  ['GET', '/fonts/inter.woff2'],
  ['GET', '/IMAGES/HERO.JPG'],
  ['GET', '/favicon.ico'],
  ['GET', '/students'],
  ['GET', '/'],
  ['get', '/api/v1/students'],
  ['HEAD', '/api/v1/students'],
  ['GET', 'https://cdn.example.com/a.svg'],
  ['GET', ''],
];

describe('sw.js classifier parity with pickStrategy.ts (PRC-L253)', () => {
  const { pick, events } = loadSwClassifier();

  it('registers install, activate and fetch handlers', () => {
    expect(events).toEqual(expect.arrayContaining(['install', 'activate', 'fetch']));
  });

  it.each(CASES)('%s %s', (method, url) => {
    expect(pick(method, url)).toBe(pickStrategy(method, url));
  });
});
