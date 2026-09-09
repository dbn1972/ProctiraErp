/**
 * Tamper-evident hash chain for audit entries (G-913).
 *
 * Every entry stores `prevHash` (the previous entry's `entryHash` for the same
 * tenant, `null` for the genesis entry) and `entryHash = sha256(canonical
 * payload + prevHash)`. Re-computing the chain from the first entry detects
 * any edit, deletion, or re-ordering — even by a DBA who disabled the
 * append-only trigger — because the stored hashes will no longer match.
 */
import { createHash } from 'node:crypto';

import type { AuditLogEntry, CreateAuditLogInput } from './audit-repository.js';

/** Fields covered by the hash. Anything not listed here is not tamper-protected. */
export type HashedAuditFields = Pick<
  CreateAuditLogInput,
  | 'id'
  | 'tenantId'
  | 'entityType'
  | 'entityId'
  | 'operation'
  | 'userId'
  | 'userName'
  | 'ipAddress'
  | 'timestamp'
  | 'beforeValues'
  | 'afterValues'
> & { metadata?: Record<string, unknown> | null };

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

export function computeEntryHash(entry: HashedAuditFields, prevHash: string | null): string {
  const payload = canonicalJson({
    id: entry.id,
    tenantId: entry.tenantId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.operation,
    userId: entry.userId,
    userName: entry.userName,
    ipAddress: entry.ipAddress,
    timestamp: entry.timestamp.toISOString(),
    beforeValues: entry.beforeValues ?? null,
    afterValues: entry.afterValues ?? null,
    metadata: entry.metadata ?? null,
    prevHash,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export interface ChainBreak {
  /** Chain position (1-based) of the first entry that fails verification. */
  chainSeq: number;
  entryId: string;
  reason: 'hash-mismatch' | 'prev-hash-mismatch' | 'missing-hash' | 'sequence-gap';
  expected: string | null;
  actual: string | null;
}

export interface ChainVerification {
  tenantId: string;
  valid: boolean;
  /** Entries that carry a hash and were re-computed. */
  checkedEntries: number;
  /** Entries written before the chain existed (no hash) — reported, not failed. */
  legacyEntries: number;
  headHash: string | null;
  headSeq: number;
  brokenAt: ChainBreak | null;
  verifiedAt: string;
}

/**
 * Walks entries in chain order (ascending `chainSeq`) and re-computes every
 * hash. Legacy rows (no `chainSeq`) are counted but skipped; the chain proper
 * starts at the first hashed row.
 */
export function verifyEntrySequence(tenantId: string, entries: AuditLogEntry[]): ChainVerification {
  const hashed = entries
    .filter((e) => e.chainSeq != null)
    .sort((a, b) => (a.chainSeq ?? 0) - (b.chainSeq ?? 0));
  const legacyEntries = entries.length - hashed.length;

  let prevHash: string | null = null;
  let expectedSeq = 1;
  let brokenAt: ChainBreak | null = null;

  for (const entry of hashed) {
    const seq = entry.chainSeq ?? 0;
    if (seq !== expectedSeq) {
      brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'sequence-gap',
        expected: String(expectedSeq),
        actual: String(seq),
      };
      break;
    }
    if (!entry.entryHash) {
      brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'missing-hash',
        expected: null,
        actual: null,
      };
      break;
    }
    if ((entry.prevHash ?? null) !== prevHash) {
      brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'prev-hash-mismatch',
        expected: prevHash,
        actual: entry.prevHash ?? null,
      };
      break;
    }
    const recomputed = computeEntryHash(entry, prevHash);
    if (recomputed !== entry.entryHash) {
      brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'hash-mismatch',
        expected: recomputed,
        actual: entry.entryHash,
      };
      break;
    }
    prevHash = entry.entryHash;
    expectedSeq += 1;
  }

  const checkedEntries = brokenAt ? brokenAt.chainSeq - 1 : hashed.length;
  return {
    tenantId,
    valid: brokenAt === null,
    checkedEntries,
    legacyEntries,
    headHash: hashed.length > 0 ? (hashed[hashed.length - 1]!.entryHash ?? null) : null,
    headSeq: hashed.length > 0 ? (hashed[hashed.length - 1]!.chainSeq ?? 0) : 0,
    brokenAt,
    verifiedAt: new Date().toISOString(),
  };
}
