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
  /**
   * PRC-M176 / NEW-g7_platform-012: in strict mode, the number of unchained
   * (chain_seq NULL) rows that appear AFTER the chain has started — i.e. direct
   * inserts framed as "legacy". These fail verification because tamper-evidence
   * cannot cover rows that were never chained.
   */
  unchainedAfterCutover: number;
  headHash: string | null;
  headSeq: number;
  brokenAt: ChainBreak | null;
  verifiedAt: string;
}

export interface VerifyOptions {
  /**
   * When true (default false for backward compatibility), any unchained row whose
   * timestamp is at/after the first chained row's timestamp is treated as a chain
   * break (reason 'missing-hash'). Pre-chain rows strictly before the genesis row
   * are still tolerated as genuine legacy data.
   */
  strict?: boolean;
}

/**
 * Walks entries in chain order (ascending `chainSeq`) and re-computes every
 * hash. Legacy rows (no `chainSeq`) are counted but skipped; the chain proper
 * starts at the first hashed row.
 */
/**
 * PRC-M085: incremental chain verifier. Feed hashed entries in chain_seq
 * order with {@link ChainVerifier.push}; it carries prev_hash so callers can
 * stream pages instead of buffering the whole chain.
 */
export class ChainVerifier {
  private prevHash: string | null = null;
  private expectedSeq = 1;
  private hashedCount = 0;
  private lastHead: { seq: number; hash: string | null } | null = null;
  brokenAt: ChainBreak | null = null;

  constructor(private readonly tenantId: string) {}

  /** Returns false once the chain is broken (stop feeding). */
  push(entry: AuditLogEntry): boolean {
    if (this.brokenAt) return false;
    this.hashedCount += 1;
    const seq = entry.chainSeq ?? 0;
    this.lastHead = { seq, hash: entry.entryHash ?? null };
    if (seq !== this.expectedSeq) {
      this.brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'sequence-gap',
        expected: String(this.expectedSeq),
        actual: String(seq),
      };
      return false;
    }
    if (!entry.entryHash) {
      this.brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'missing-hash',
        expected: null,
        actual: null,
      };
      return false;
    }
    if ((entry.prevHash ?? null) !== this.prevHash) {
      this.brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'prev-hash-mismatch',
        expected: this.prevHash,
        actual: entry.prevHash ?? null,
      };
      return false;
    }
    const recomputed = computeEntryHash(entry, this.prevHash);
    if (recomputed !== entry.entryHash) {
      this.brokenAt = {
        chainSeq: seq,
        entryId: entry.id,
        reason: 'hash-mismatch',
        expected: recomputed,
        actual: entry.entryHash,
      };
      return false;
    }
    this.prevHash = entry.entryHash;
    this.expectedSeq += 1;
    return true;
  }

  /**
   * @param legacyEntries pre-chain rows (chain_seq NULL)
   * @param head the true chain head (highest chain_seq); defaults to the last
   *        entry pushed, which is the head when the chain was read to the end.
   */
  finish(
    legacyEntries: number,
    head: { seq: number; hash: string | null } | null = this.lastHead,
    unchainedAfterCutover = 0,
  ): ChainVerification {
    const checkedEntries = this.brokenAt ? this.brokenAt.chainSeq - 1 : this.hashedCount;
    return {
      tenantId: this.tenantId,
      valid: this.brokenAt === null && unchainedAfterCutover === 0,
      checkedEntries,
      legacyEntries,
      unchainedAfterCutover,
      headHash: head?.hash ?? null,
      headSeq: head?.seq ?? 0,
      brokenAt:
        this.brokenAt ??
        (unchainedAfterCutover > 0
          ? {
              chainSeq: 0,
              entryId: '',
              reason: 'missing-hash',
              expected: null,
              actual: null,
            }
          : null),
      verifiedAt: new Date().toISOString(),
    };
  }
}

export function verifyEntrySequence(
  tenantId: string,
  entries: AuditLogEntry[],
  options: VerifyOptions = {},
): ChainVerification {
  const hashed = entries
    .filter((e) => e.chainSeq != null)
    .sort((a, b) => (a.chainSeq ?? 0) - (b.chainSeq ?? 0));
  const verifier = new ChainVerifier(tenantId);
  for (const entry of hashed) {
    if (!verifier.push(entry)) break;
  }
  const last = hashed[hashed.length - 1];
  const legacy = entries.filter((e) => e.chainSeq == null);

  // PRC-M176 / NEW-g7_platform-012: in strict mode, any unchained row at/after the
  // genesis chained row's timestamp is a direct insert that evaded chaining and must
  // fail verification. Rows strictly before genesis are genuine pre-chain legacy data.
  let unchainedAfterCutover = 0;
  if (options.strict && hashed.length > 0) {
    const genesisTs = hashed[0]!.timestamp.getTime();
    unchainedAfterCutover = legacy.filter((e) => e.timestamp.getTime() >= genesisTs).length;
  }

  return verifier.finish(
    legacy.length,
    last ? { seq: last.chainSeq ?? 0, hash: last.entryHash ?? null } : null,
    unchainedAfterCutover,
  );
}
