import { describe, expect, it } from 'vitest';

import { detectLeak, isEmptyPayload, tenantRecords, type LeakIndex } from './leak-detector.js';

const VICTIM = '00000000-0000-4000-8000-00000000a501';
const ATTACKER = '00000000-0000-4000-8000-000000000001';
const VICTIM_ROW = 'ab25a529-838e-59fd-a859-bfde670b1d2b';
const ATTACKER_ROW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SHARED_ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const index: LeakIndex = {
  victimTenantId: VICTIM,
  victimSlug: 'sunrise-public-school',
  attackerTenantId: ATTACKER,
  victimStrings: ['Aanya Agarwal', 'aanya@sunrise.test'],
};

function body(json: unknown) {
  return { text: JSON.stringify(json), json };
}

describe('detectLeak', () => {
  it('flags a record whose tenantId is the victim tenant', () => {
    const b = body({ data: [{ id: VICTIM_ROW, tenantId: VICTIM }] });
    const r = detectLeak(b.text, b.json, index);
    expect(r.leaked).toBe(true);
    expect(r.hits.join(' ')).toContain('record tenantId');
  });

  it('flags a victim composite name or email', () => {
    const b = body({ data: [{ firstName: 'Aanya Agarwal' }] });
    expect(detectLeak(b.text, b.json, index).leaked).toBe(true);
    const e = body({ email: 'aanya@sunrise.test' });
    expect(detectLeak(e.text, e.json, index).leaked).toBe(true);
  });

  it('does not flag the attacker own data', () => {
    const b = body({ data: [{ id: ATTACKER_ROW, tenantId: ATTACKER }] });
    expect(detectLeak(b.text, b.json, index).leaked).toBe(false);
  });

  it('does NOT flag a victim-owned id stored inside an attacker-tenant record', () => {
    // The attacker can put a foreign reference id in its own row; that is not a read.
    const b = body({ data: [{ id: ATTACKER_ROW, tenantId: ATTACKER, institutionId: VICTIM_ROW }] });
    expect(detectLeak(b.text, b.json, index).leaked).toBe(false);
    const bare = body({ data: [{ id: SHARED_ROW }] });
    expect(detectLeak(bare.text, bare.json, index).leaked).toBe(false);
  });

  it('ignores a tenantId the attacker itself supplied (echoed scope)', () => {
    const b = body({ tenantId: VICTIM, items: [] });
    expect(detectLeak(b.text, b.json, index, new Set([VICTIM.toLowerCase()])).leaked).toBe(false);
  });

  it('flags the victim slug unless it was sent by the attacker', () => {
    const b = body({ url: 'https://sunrise-public-school.example/x' });
    expect(detectLeak(b.text, b.json, index).leaked).toBe(true);
    expect(detectLeak(b.text, b.json, index, new Set(['sunrise-public-school'])).leaked).toBe(
      false,
    );
  });
});

describe('tenantRecords', () => {
  it('collects every object carrying a tenantId / tenant_id', () => {
    const recs = tenantRecords({ a: { tenantId: 'x' }, b: [{ tenant_id: 'y' }], c: 1 });
    expect(recs.map((r) => r.tenantId).sort()).toEqual(['x', 'y']);
  });
});

describe('isEmptyPayload', () => {
  it('treats null, empty containers, zeros and pagination metadata as empty', () => {
    expect(isEmptyPayload(null, 'null')).toBe(true);
    expect(isEmptyPayload({ data: [], meta: { page: 1, totalItems: 0 } }, '')).toBe(true);
    expect(isEmptyPayload({ count: 0, items: [] }, '')).toBe(true);
    expect(isEmptyPayload(undefined, '')).toBe(true);
  });

  it('treats a non-empty record list as not empty', () => {
    expect(isEmptyPayload({ data: [{ id: 'x' }] }, '')).toBe(false);
    expect(isEmptyPayload({ firstName: 'Aanya' }, '')).toBe(false);
  });

  it('treats a body that only echoes sent ids as empty', () => {
    expect(isEmptyPayload({ id: VICTIM_ROW }, '', new Set([VICTIM_ROW]))).toBe(true);
  });
});
