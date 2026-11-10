/**
 * W1-SEC-10 COMPLETE — same-transaction mutation audit for regulated writes.
 *
 * Domain state and the audit row (and optional transactional outbox intent)
 * must commit atomically. A forced audit/outbox failure rolls back the domain
 * write so a 503 cannot leave an unaudited durable mutation.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import { computeKeyedEntryHash, DEV_AUDIT_CHAIN_KEY_ID, type AuditChainKey } from './audit-hash.js';
import type { AuditLogEntry, AuditOperation, CreateAuditLogInput } from './audit-repository.js';

/**
 * PRC-M200 — module-level HMAC signing key for the synchronous audit chain.
 *
 * The chain head is advanced only through the SECURITY DEFINER functions
 * (audit_chain_lock_head / audit_chain_append, migrations 292/294): the runtime
 * role no longer has direct DML on audit_chain_heads. The HMAC itself is still
 * computed in the application under the KMS-held key so the database never sees
 * the secret.
 *
 * The 9 `appendAuditEntryOnClient(client, input)` callers (examination, fees,
 * health, parent-portal, scholarship, timetable, domain-plugins,
 * domain-audit-sink, pg-audit-repository) keep their exact signature. The
 * gateway boot sequence calls {@link configureAuditChainKey} with the real key
 * resolved from the secret manager; its boot guard refuses the dev key (and a
 * missing key) in a deployed environment, so a development key can never sign a
 * chain a production verifier would accept.
 */
let configuredChainKey: AuditChainKey | null = null;

/**
 * The fixed development/test key used ONLY when no real key was configured. It
 * carries the reserved {@link DEV_AUDIT_CHAIN_KEY_ID} so a deployed verifier
 * (and the gateway boot guard) can reject any row it signed.
 */
const DEV_CHAIN_KEY: AuditChainKey = {
  keyId: DEV_AUDIT_CHAIN_KEY_ID,
  secret: 'proctira-dev-audit-chain-key-not-for-production',
};

/**
 * Install the HMAC signing key used by {@link appendAuditEntryOnClient}. Called
 * once at gateway boot. Passing `null` resets to the dev fallback (used by tests
 * and non-deployed runs).
 */
export function configureAuditChainKey(key: AuditChainKey | null): void {
  configuredChainKey = key;
}

/** The key currently in effect (configured key, else the dev fallback). */
export function currentAuditChainKey(): AuditChainKey {
  return configuredChainKey ?? DEV_CHAIN_KEY;
}

/** Minimal outbox surface so callers can dual-write without a hard dependency. */
export type MutationAuditOutboxEnqueue = {
  enqueue: (entry: unknown, client: PgQueryable) => Promise<unknown>;
};

export type MutationAuditTxnInput = {
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string;
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  id?: string;
  timestamp?: Date;
};

export function toCreateAuditLogInput(input: MutationAuditTxnInput): CreateAuditLogInput {
  return {
    id: input.id ?? uuidv4(),
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    userId: input.userId,
    userName: input.userName,
    ipAddress: input.ipAddress,
    timestamp: input.timestamp ?? new Date(),
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    metadata: input.metadata ?? null,
  };
}

/**
 * Append one audit_log_entries row (+ keyed hash-chain head advance) on the
 * caller's client. Must run inside the same transaction as the regulated domain
 * write (typically {@link withPgTenant}).
 *
 * PRC-M200: the head is advanced through the SECURITY DEFINER functions
 * (audit_chain_lock_head -> audit_chain_append) because the runtime role no
 * longer has direct DML on audit_chain_heads (migration 294). The entry_hash is
 * the HMAC-SHA256 of the canonical payload under the configured chain key
 * ({@link currentAuditChainKey}); the row records that key's id in `key_id`. The
 * definer functions bind every append to the caller's bound tenant
 * (app.tenant_id), so a cross-tenant client cannot advance another tenant's
 * chain (42501).
 */
export async function appendAuditEntryOnClient(
  client: PgQueryable,
  input: CreateAuditLogInput,
): Promise<AuditLogEntry> {
  const key = currentAuditChainKey();

  // Lock the tenant head FOR UPDATE and read the current (seq, hash). The
  // definer function creates the head row on first use and tenant-binds the
  // call; a cross-tenant client raises 42501.
  const headRes = await client.query(`SELECT head_seq, head_hash FROM audit_chain_lock_head($1)`, [
    input.tenantId,
  ]);
  const headRow = headRes.rows[0] as { head_seq: unknown; head_hash: string | null } | undefined;
  const prevHash = headRow?.head_hash ?? null;
  const chainSeq = Number(headRow?.head_seq ?? 0) + 1;

  // HMAC the entry in-process under the KMS/dev key; the DB never sees the key.
  const entryHash = computeKeyedEntryHash(input, prevHash, key);

  // Append the keyed row at head_seq+1 and advance the head atomically. The
  // function re-locks the head itself, so the lock above only serialises
  // concurrent writers in the same transaction window.
  await client.query(
    `SELECT chain_seq, prev_hash FROM audit_chain_append(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14
     )`,
    [
      input.tenantId,
      input.id,
      input.entityType,
      input.entityId,
      input.operation,
      input.userId,
      input.userName,
      input.ipAddress,
      input.timestamp,
      input.beforeValues == null ? null : JSON.stringify(input.beforeValues),
      input.afterValues == null ? null : JSON.stringify(input.afterValues),
      input.metadata == null ? null : JSON.stringify(input.metadata),
      entryHash,
      key.keyId,
    ],
  );

  return {
    id: input.id,
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    userId: input.userId,
    userName: input.userName,
    ipAddress: input.ipAddress,
    timestamp: input.timestamp,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    metadata: input.metadata ?? null,
    chainSeq,
    prevHash,
    entryHash,
    keyId: key.keyId,
  };
}

export type RunRegulatedMutationInTxnOptions<T> = {
  pool: PgPoolWithConnect | PgQueryable;
  tenantId: string;
  audit: MutationAuditTxnInput;
  mutate: (client: PgQueryable) => Promise<T>;
  /**
   * Optional transactional outbox dual-write (same txn). When enqueue throws,
   * domain + audit inserts roll back together.
   */
  outbox?: {
    store: MutationAuditOutboxEnqueue;
    entry: unknown;
  };
};

/**
 * Run a regulated domain write and persist the audit row in one tenant
 * transaction. Optional outbox enqueue shares the same commit boundary.
 */
export async function runRegulatedMutationInTxn<T>(
  options: RunRegulatedMutationInTxnOptions<T>,
): Promise<{ result: T; audit: AuditLogEntry }> {
  const createInput = toCreateAuditLogInput(options.audit);
  return withPgTenant(options.pool, options.tenantId, async (client) => {
    const result = await options.mutate(client);
    const audit = await appendAuditEntryOnClient(client, createInput);
    if (options.outbox) {
      await options.outbox.store.enqueue(options.outbox.entry, client);
    }
    return { result, audit };
  });
}

/** Stable id helper for outbox / audit correlation. */
export function newMutationAuditCorrelationId(): string {
  return randomUUID();
}
