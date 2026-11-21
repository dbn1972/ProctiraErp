/**
 * Tamper-evident hash chain for audit entries (G-913).
 *
 * Every entry stores `prevHash` (the previous entry's `entryHash` for the same
 * tenant, `null` for the genesis entry) and `entryHash = sha256(canonical
 * payload + prevHash)`. Re-computing the chain from the first entry detects
 * any edit, deletion, or re-ordering — even by a DBA who disabled the
 * append-only trigger — because the stored hashes will no longer match.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

/**
 * PRC-M200 keyed chain. The canonical payload that both the unkeyed sha256
 * (legacy) and the keyed HMAC cover. Extracted so the two hashes protect the
 * exact same bytes (plus, for the HMAC, the signing key id so a row cannot be
 * replayed under a different key).
 */
function canonicalEntryPayload(
  entry: HashedAuditFields,
  prevHash: string | null,
  keyId?: string | null,
): string {
  return canonicalJson({
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
    ...(keyId === undefined ? {} : { keyId }),
  });
}

/** A named HMAC signing key for the keyed audit chain (PRC-M200). */
export interface AuditChainKey {
  /** Stable identifier persisted in `audit_log_entries.key_id`. */
  keyId: string;
  /** Raw key material (from the KMS/secret manager, or the fixed dev key). */
  secret: string | Buffer;
}

/**
 * The reserved key id used only when the process is NOT a deployed environment
 * (NODE_ENV development/test). The gateway boot guard refuses this id — and the
 * matching literal secret — in a deployed environment, so a development key can
 * never sign a chain that a production verifier would accept.
 */
export const DEV_AUDIT_CHAIN_KEY_ID = 'dev';

/**
 * Compute the keyed (HMAC-SHA256) hash for an audit entry under `key`. The MAC
 * covers the same canonical payload as {@link computeEntryHash} plus the key
 * id, so forging a row requires the secret, not just the algorithm.
 */
export function computeKeyedEntryHash(
  entry: HashedAuditFields,
  prevHash: string | null,
  key: AuditChainKey,
): string {
  const payload = canonicalEntryPayload(entry, prevHash, key.keyId);
  return createHmac('sha256', key.secret).update(payload, 'utf8').digest('hex');
}

/** Constant-time hex-string comparison; false on any length/shape mismatch. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Resolve the signing key for a given `key_id`. Returns `undefined` for an
 * unknown key id (the verifier then reports the row as unverifiable rather than
 * silently trusting it).
 */
export type AuditChainKeyResolver = (keyId: string) => AuditChainKey | undefined;

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

/** Options for the PRC-M200 keyed-chain verifier. */
export interface KeyedVerifyOptions {
  /**
   * Per-tenant cut-over sequence: the highest `chain_seq` that is allowed to be
   * a legacy unkeyed sha256 row. Rows at/below it are verified with the unkeyed
   * `computeEntryHash`; every row strictly above it MUST be keyed (HMAC under a
   * known key id). `0` (default) means the whole chain must be keyed.
   */
  cutoverSeq?: number;
}

/**
 * PRC-M200 keyed-chain verifier. Walks entries in `chain_seq` order and:
 *   - verifies links (sequence + prev_hash) exactly like {@link verifyEntrySequence};
 *   - at/below `cutoverSeq`, accepts a legacy unkeyed sha256 `entryHash`
 *     (`key_id` must be NULL) using {@link computeEntryHash};
 *   - above `cutoverSeq`, requires a non-null `key_id` that `resolveKey` knows
 *     and an HMAC `entryHash` that matches {@link computeKeyedEntryHash}.
 *
 * A legacy (unkeyed) row above the cut-over, a keyed row at/below it, an unknown
 * key id, or any hash mismatch breaks the chain — so a forger who recomputes the
 * unkeyed sha256 from a tampered row to the head is rejected (no key = no MAC).
 */
export function verifyKeyedEntrySequence(
  tenantId: string,
  entries: AuditLogEntry[],
  resolveKey: AuditChainKeyResolver,
  options: KeyedVerifyOptions = {},
): ChainVerification {
  const cutoverSeq = options.cutoverSeq ?? 0;
  const hashed = entries
    .filter((e) => e.chainSeq != null)
    .sort((a, b) => (a.chainSeq ?? 0) - (b.chainSeq ?? 0));
  const legacy = entries.filter((e) => e.chainSeq == null);

  let prevHash: string | null = null;
  let expectedSeq = 1;
  let brokenAt: ChainBreak | null = null;
  let checked = 0;
  let last: { seq: number; hash: string | null } | null = null;

  for (const entry of hashed) {
    const seq = entry.chainSeq ?? 0;
    last = { seq, hash: entry.entryHash ?? null };

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

    const keyId = entry.keyId ?? null;
    const isLegacySlot = seq <= cutoverSeq;
    if (isLegacySlot) {
      // Below/at the cut-over: must be an unkeyed legacy sha256 row.
      if (keyId !== null) {
        brokenAt = {
          chainSeq: seq,
          entryId: entry.id,
          reason: 'hash-mismatch',
          expected: 'legacy-unkeyed',
          actual: `keyed:${keyId}`,
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
    } else {
      // Above the cut-over: must be a keyed HMAC row under a known key.
      if (keyId === null) {
        brokenAt = {
          chainSeq: seq,
          entryId: entry.id,
          reason: 'missing-hash',
          expected: 'keyed-hmac',
          actual: 'unkeyed',
        };
        break;
      }
      const key = resolveKey(keyId);
      if (!key) {
        brokenAt = {
          chainSeq: seq,
          entryId: entry.id,
          reason: 'hash-mismatch',
          expected: `key:${keyId}`,
          actual: 'unknown-key',
        };
        break;
      }
      const recomputed = computeKeyedEntryHash(entry, prevHash, key);
      if (!hexEquals(recomputed, entry.entryHash)) {
        brokenAt = {
          chainSeq: seq,
          entryId: entry.id,
          reason: 'hash-mismatch',
          expected: recomputed,
          actual: entry.entryHash,
        };
        break;
      }
    }

    prevHash = entry.entryHash;
    expectedSeq += 1;
    checked += 1;
  }

  return {
    tenantId,
    valid: brokenAt === null,
    checkedEntries: checked,
    legacyEntries: legacy.length,
    unchainedAfterCutover: 0,
    headHash: last?.hash ?? null,
    headSeq: last?.seq ?? 0,
    brokenAt,
    verifiedAt: new Date().toISOString(),
  };
}
