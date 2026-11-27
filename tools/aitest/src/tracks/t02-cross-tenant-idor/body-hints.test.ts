import { describe, expect, it } from 'vitest';

import {
  loadBodyHints,
  matchHint,
  normaliseRegistrationPath,
  patternRegex,
  scanRegistrations,
  shapeOf,
  type RouteHint,
} from './body-hints.js';

describe('scanRegistrations', () => {
  it('finds the schema each handler validates its body/query with', () => {
    const src = `
      fastify.post(\`\${prefix}/payments\`, async (request) => {
        const r = validate(RecordPaymentSchema, request.body);
        return r;
      });
      fastify.get(\`\${prefix}/items\`, async (request) => {
        const q = validate(ListItemsQuery, request.query);
        return q;
      });
      fastify.get('/api/v1/health', async () => ({ ok: true }));
    `;
    const regs = scanRegistrations(src);
    expect(regs).toHaveLength(3);
    expect(regs[0]).toMatchObject({
      method: 'POST',
      pattern: '*/payments',
      bodySchema: 'RecordPaymentSchema',
    });
    expect(regs[1]).toMatchObject({
      method: 'GET',
      pattern: '*/items',
      querySchema: 'ListItemsQuery',
    });
    expect(regs[2]).toMatchObject({ method: 'GET', pattern: '/api/v1/health' });
    expect(regs[2]?.bodySchema).toBeUndefined();
  });

  it('does not bleed a later handler schema into an earlier registration', () => {
    const src = `
      app.put('/a/:id', async (req) => { return 1; });
      app.post('/b', async (req) => { validate(BSchema, req.body); });
    `;
    const regs = scanRegistrations(src);
    expect(regs[0]?.bodySchema).toBeUndefined();
    expect(regs[1]?.bodySchema).toBe('BSchema');
  });
});

describe('normaliseRegistrationPath', () => {
  it('replaces template expressions with * and TypeBox braces with colons', () => {
    expect(normaliseRegistrationPath('${prefix}/units/:id')).toBe('*/units/:id');
    expect(normaliseRegistrationPath('/api/v1/students/{id}')).toBe('/api/v1/students/:id');
    expect(normaliseRegistrationPath('${prefix}/')).toBe('*');
  });
});

describe('patternRegex / matchHint', () => {
  it('matches a prefix-relative pattern against a full route shape', () => {
    expect(patternRegex(shapeOf('*/units/:id')).test(shapeOf('/api/v1/curriculum/units/:x'))).toBe(
      true,
    );
    expect(patternRegex(shapeOf('*/units/:id')).test(shapeOf('/api/v1/curriculum/units'))).toBe(
      false,
    );
  });

  it('prefers the pattern whose module appears in the path and the more literal tail', () => {
    const hints: RouteHint[] = [
      {
        module: 'fees',
        file: 'f.ts',
        method: 'POST',
        pattern: '*/invoices/:id/pay',
        bodyIdFields: [],
        queryIdFields: [],
      },
      {
        module: 'billing',
        file: 'b.ts',
        method: 'POST',
        pattern: '*/:id/pay',
        bodyIdFields: [],
        queryIdFields: [],
      },
    ];
    const hit = matchHint({ method: 'POST', path: '/api/v1/fees/invoices/:id/pay' }, hints);
    expect(hit?.module).toBe('fees');
  });

  it('requires the module token for a short prefix-relative pattern', () => {
    const hints: RouteHint[] = [
      {
        module: 'hostel',
        file: 'h.ts',
        method: 'PUT',
        pattern: '*/:id',
        bodyIdFields: [],
        queryIdFields: [],
      },
    ];
    expect(matchHint({ method: 'PUT', path: '/api/v1/fees/invoices/:id' }, hints)).toBeUndefined();
    expect(matchHint({ method: 'PUT', path: '/api/v1/hostel/:id' }, hints)?.module).toBe('hostel');
  });

  it('returns undefined on an ambiguous tie with different fields', () => {
    const hints: RouteHint[] = [
      {
        module: 'a',
        file: 'a.ts',
        method: 'POST',
        pattern: '*/x/:id',
        bodyTemplate: { p: 1 },
        bodyIdFields: [],
        queryIdFields: [],
      },
      {
        module: 'b',
        file: 'b.ts',
        method: 'POST',
        pattern: '*/x/:id',
        bodyTemplate: { q: 2 },
        bodyIdFields: [],
        queryIdFields: [],
      },
    ];
    expect(matchHint({ method: 'POST', path: '/api/v1/z/x/:id' }, hints)).toBeUndefined();
  });
});

describe('loadBodyHints (committed file)', () => {
  it('loads and validates the generated body-hints.json', () => {
    const doc = loadBodyHints();
    expect(doc.hints.length).toBeGreaterThan(100);
    expect(doc.hints.some((h) => h.bodyIdFields.length > 0)).toBe(true);
    for (const h of doc.hints.slice(0, 20)) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(h.method);
    }
  });
});
