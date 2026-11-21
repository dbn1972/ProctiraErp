/**
 * PRC-M200 — keyed HMAC audit chain primitives.
 *
 * These tests cover the application-side half of the keyed chain: the HMAC
 * hash and the key-id-aware verifier that accepts legacy unkeyed sha256 rows
 * only at/below the per-tenant cut-over sequence and requires an HMAC under a
 * known key id for every row above it. The SECURITY DEFINER write/seal path and
 * the cross-tenant 42501 guards are proven separately on live Postgres.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  computeEntryHash,
  computeKeyedEntryHash,
  verifyKeyedEntrySequence,
  type AuditChainKey,
  type AuditChainKeyResolver,
} from './audit-hash.js';
import type { AuditLogEntry } from './audit-repository.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const KEY: AuditChainKey = { keyId: 'k1', secret: 'test-key-k1-0123456789abcdef' };
const KEY2: AuditChainKey = { keyId: 'k2', secret: 'rotated-key-k2-fedcba9876543210' };

const resolve: AuditChainKeyResolver = (id) => (id === 'k1' ? KEY : id === 'k2' ? KEY2 : undefined);

function row(
  seq: number,
  prevHash: string | null,
  overrides: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    entityType: 'student',
    entityId: randomUUID(),
    operation: 'UPDATE',
    userId: 'user-1',
    userName: 'Admin',
    ipAddress: '10.0.0.1',
    timestamp: new Date(`2026-09-01T10:0${seq}:00.000Z`),
    beforeValues: { name: 'A' },
    afterValues: { name: 'B' },
    metadata: { requestId: `r${seq}` },
    chainSeq: seq,
    prevHash,
    entryHash: null,
    keyId: null,
    ...overrides,
  };
}

/** Build a fully keyed chain of `n` rows signed under `key`. */
function keyedChain(n: number, key: AuditChainKey): AuditLogEntry[] {
  const out: AuditLogEntry[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i += 1) {
    const r = row(i, prev, { keyId: key.keyId });
    r.entryHash = computeKeyedEntryHash(r, prev, key);
    prev = r.entryHash;
    out.push(r);
  }
  return out;
}

describe('computeKeyedEntryHash', () => {
  it('differs from the unkeyed sha256 and depends on the key + key id', () => {
    const r = row(1, null, { keyId: KEY.keyId });
    const unkeyed = computeEntryHash(r, null);
    const keyed = computeKeyedEntryHash(r, null, KEY);
    expect(keyed).not.toBe(unkeyed);
    // Different secret -> different MAC.
    expect(computeKeyedEntryHash(r, null, KEY2)).not.toBe(keyed);
    // Same bytes + same key -> stable.
    expect(computeKeyedEntryHash(r, null, KEY)).toBe(keyed);
  });
});

describe('verifyKeyedEntrySequence', () => {
  it('accepts a fully keyed chain under a known key', () => {
    const chain = keyedChain(3, KEY);
    const v = verifyKeyedEntrySequence(TENANT, chain, resolve);
    expect(v.valid).toBe(true);
    expect(v.checkedEntries).toBe(3);
    expect(v.brokenAt).toBeNull();
  });

  it('REJECTS a forged unkeyed sha256 row above the cut-over (no key = no MAC)', () => {
    // Attacker edits row 2, recomputes the UNKEYED sha256 chain from it forward.
    const chain = keyedChain(3, KEY);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[1]!.afterValues = { name: 'HACKED' };
    // Re-link with unkeyed sha256 (the only thing an attacker without the key can do).
    let prev: string | null = tampered[0]!.entryHash;
    for (let i = 1; i < tampered.length; i += 1) {
      tampered[i]!.keyId = null; // dropped to legacy because they can't sign
      tampered[i]!.prevHash = prev;
      tampered[i]!.entryHash = computeEntryHash(tampered[i]!, prev);
      prev = tampered[i]!.entryHash;
    }
    const v = verifyKeyedEntrySequence(TENANT, tampered, resolve);
    expect(v.valid).toBe(false);
    expect(v.brokenAt?.chainSeq).toBe(2);
  });

  it('accepts legacy unkeyed rows at/below the cut-over and keyed rows above', () => {
    // Rows 1..2 legacy sha256, rows 3..4 keyed under k1.
    const chain: AuditLogEntry[] = [];
    let prev: string | null = null;
    for (let i = 1; i <= 2; i += 1) {
      const r = row(i, prev, { keyId: null });
      r.entryHash = computeEntryHash(r, prev);
      prev = r.entryHash;
      chain.push(r);
    }
    for (let i = 3; i <= 4; i += 1) {
      const r = row(i, prev, { keyId: KEY.keyId });
      r.entryHash = computeKeyedEntryHash(r, prev, KEY);
      prev = r.entryHash;
      chain.push(r);
    }
    const v = verifyKeyedEntrySequence(TENANT, chain, resolve, { cutoverSeq: 2 });
    expect(v.valid).toBe(true);
    expect(v.checkedEntries).toBe(4);
  });

  it('rejects a legacy unkeyed row ABOVE the cut-over', () => {
    const chain: AuditLogEntry[] = [];
    let prev: string | null = null;
    const legacy = row(1, prev, { keyId: null });
    legacy.entryHash = computeEntryHash(legacy, prev);
    prev = legacy.entryHash;
    chain.push(legacy);
    // seq 2 is above cutover (0) and still unkeyed -> break.
    const v = verifyKeyedEntrySequence(TENANT, chain, resolve, { cutoverSeq: 0 });
    expect(v.valid).toBe(false);
    expect(v.brokenAt?.chainSeq).toBe(1);
  });

  it('rejects a keyed row signed by an unknown key id', () => {
    const chain = keyedChain(2, KEY2); // k2 known, but drop it from the resolver
    const onlyK1: AuditChainKeyResolver = (id) => (id === 'k1' ? KEY : undefined);
    const v = verifyKeyedEntrySequence(TENANT, chain, onlyK1);
    expect(v.valid).toBe(false);
    expect(v.brokenAt?.chainSeq).toBe(1);
  });

  it('rejects a keyed row at/below the cut-over (must be legacy there)', () => {
    const chain = keyedChain(2, KEY);
    const v = verifyKeyedEntrySequence(TENANT, chain, resolve, { cutoverSeq: 2 });
    expect(v.valid).toBe(false);
    expect(v.brokenAt?.chainSeq).toBe(1);
  });
});
