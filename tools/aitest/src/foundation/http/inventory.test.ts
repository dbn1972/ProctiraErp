import { describe, expect, it } from 'vitest';

import { repoRootFromHere } from '../repo.js';
import type { FixtureManifest } from '../seed/fixtures.js';

import {
  mergeStatic,
  normalisePath,
  resolveRoutePath,
  routesFromOpenApi,
  scanStaticRoutes,
} from './inventory.js';
import { dynamicSegments, listWebRoutes, resolveWebRoute, routeFromPageDir } from './web-routes.js';

/** Trimmed shape of the gateway's GET /docs/json. */
const SAMPLE = {
  openapi: '3.0.3',
  paths: {
    '/api/v1/students': { get: {}, post: {} },
    '/api/v1/students/{id}': { get: {}, patch: {}, delete: {}, parameters: [] },
    '/api/v1/fees/invoices/{invoiceId}/payments': { post: {} },
    '/health': { get: {} },
  },
};

const manifest = {
  tenants: { S: { id: 'ts', slug: 's', status: 'active', institutions: [] } },
  ids: { students: { S: ['s-1'] }, fee_invoices: { S: ['inv-1'] } },
  principals: { guardians: {}, students: {} },
} as unknown as FixtureManifest;

describe('API inventory', () => {
  it('reads OpenAPI paths and methods', () => {
    const routes = routesFromOpenApi(SAMPLE);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/v1/fees/invoices/:invoiceId/payments',
      'GET /api/v1/students',
      'POST /api/v1/students',
      'DELETE /api/v1/students/:id',
      'GET /api/v1/students/:id',
      'PATCH /api/v1/students/:id',
      'GET /health',
    ]);
    expect(routes.find((r) => r.method === 'DELETE')).toMatchObject({
      params: ['id'],
      mutating: true,
      source: 'openapi',
    });
    expect(normalisePath('/a/{b}/c/')).toBe('/a/:b/c');
  });

  it('adds static registrations missing from OpenAPI', () => {
    const merged = mergeStatic(routesFromOpenApi(SAMPLE), [
      { method: 'GET', path: '/api/v1/students/:studentId', file: 'x.ts' },
      { method: 'POST', path: '/api/v1/hidden', file: 'y.ts' },
    ]);
    expect(merged.filter((r) => r.source === 'static').map((r) => r.path)).toEqual([
      '/api/v1/hidden',
    ]);
  });

  it('finds literal route registrations in the real source tree', () => {
    // Most plugins register under a prefix variable (`${prefix}/x`), which a
    // static scan cannot resolve; OpenAPI is the primary source.
    const statics = scanStaticRoutes(repoRootFromHere());
    expect(statics.length).toBeGreaterThan(0);
    expect(statics.every((s) => s.path.startsWith('/api/v1/'))).toBe(true);
  });

  it('resolves route params from the manifest', () => {
    const [payments] = routesFromOpenApi(SAMPLE);
    expect(resolveRoutePath(payments!, manifest, 'S')).toEqual({
      path: '/api/v1/fees/invoices/inv-1/payments',
      unresolved: [],
      used: { invoiceId: { table: 'fee_invoices', id: 'inv-1' } },
    });
    const byId = routesFromOpenApi(SAMPLE).find((r) => r.path === '/api/v1/students/:id')!;
    expect(resolveRoutePath(byId, manifest, 'S').path).toBe('/api/v1/students/s-1');
    expect(resolveRoutePath(byId, manifest, 'S', { id: 'x y' }).path).toBe(
      '/api/v1/students/x%20y',
    );
    expect(
      resolveRoutePath({ ...byId, path: '/api/v1/nope/:id', params: ['id'] }, manifest, 'S')
        .unresolved,
    ).toEqual(['id']);
  });
});

describe('web routes', () => {
  it('strips route groups and slots and lists dynamic segments', () => {
    expect(routeFromPageDir('')).toBe('/');
    expect(routeFromPageDir('(dashboard)/students/[id]/@modal/edit')).toBe('/students/[id]/edit');
    expect(dynamicSegments('/docs/[[...slug]]/[id]')).toEqual(['slug', 'id']);
  });

  it('lists at least 250 screens across the six Next apps', () => {
    const routes = listWebRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(250);
    expect(new Set(routes.map((r) => r.app)).size).toBe(6);
    expect(routes.every((r) => !r.route.includes('('))).toBe(true);
  });

  it('resolves dynamic segments from the manifest', () => {
    const r = {
      app: 'web' as const,
      route: '/students/[id]/docs/[[...rest]]',
      file: '',
      dynamic: ['id', 'rest'],
    };
    expect(resolveWebRoute(r, manifest, 'S')).toEqual({
      url: '/students/s-1/docs',
      unresolved: [],
    });
    expect(resolveWebRoute({ ...r, route: '/x/[thing]' }, manifest, 'S').unresolved).toEqual([
      'thing',
    ]);
  });
});
