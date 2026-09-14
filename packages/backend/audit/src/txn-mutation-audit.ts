/**
 * W1-SEC-10 COMPLETE — same-transaction mutation audit for regulated writes.
 *
 * Domain state and the audit row (and optional transactional outbox intent)
 * must commit atomically. A forced audit/outbox failure rolls back the domain
 * write so a 503 cannot leave an unaudited durable mutation.
 */
import { randomUUID } from 'node:crypto';

import {
  withPgTenant,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import { computeEntryHash } from './audit-hash.js';
import type { AuditLogEntry, AuditOperation, CreateAuditLogInput } from './audit-repository.js';

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

function mapEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    operation: String(row.operation) as AuditLogEntry['operation'],
    userId: String(row.user_id),
    userName: String(row.user_name),
    ipAddress: String(row.ip_address),
    timestamp:
      row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
    beforeValues: (row.before_values as Record<string, unknown> | null) ?? null,
    afterValues: (row.after_values as Record<string, unknown> | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    chainSeq: row.chain_seq == null ? null : Number(row.chain_seq),
    prevHash: row.prev_hash == null ? null : String(row.prev_hash),
    entryHash: row.entry_hash == null ? null : String(row.entry_hash),
  };
}

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
 * Append one audit_log_entries row (+ hash-chain head update) on the caller's
 * client. Must run inside the same transaction as the regulated domain write
 * (typically {@link withPgTenant}).
 */
export async function appendAuditEntryOnClient(
  client: PgQueryable,
  input: CreateAuditLogInput,
): Promise<AuditLogEntry> {
  await client.query(
    `INSERT INTO audit_chain_heads (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
    [input.tenantId],
  );
  const head = await client.query(
    `SELECT head_seq, head_hash FROM audit_chain_heads WHERE tenant_id = $1 FOR UPDATE`,
    [input.tenantId],
  );
  const headRow = head.rows[0] as { head_seq: unknown; head_hash: string | null } | undefined;
  const prevHash = headRow?.head_hash ?? null;
  const chainSeq = Number(headRow?.head_seq ?? 0) + 1;
  const entryHash = computeEntryHash(input, prevHash);

  const res = await client.query(
    `INSERT INTO audit_log_entries (
       id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
       ip_address, occurred_at, before_values, after_values, metadata,
       chain_seq, prev_hash, entry_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
     RETURNING *`,
    [
      input.id,
      input.tenantId,
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
      chainSeq,
      prevHash,
      entryHash,
    ],
  );
  await client.query(
    `UPDATE audit_chain_heads SET head_seq = $2, head_hash = $3, updated_at = now()
     WHERE tenant_id = $1`,
    [input.tenantId, chainSeq, entryHash],
  );
  return mapEntry(res.rows[0] as Record<string, unknown>);
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
