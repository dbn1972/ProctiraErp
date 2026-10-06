/**
 * PRC-M211 / PRC-H046 — envelope-encrypted webhook signing secrets.
 *
 * Storage is `developer_portal_webhook_signing_secrets`
 * (db/sql/113_developer_portal_webhook_signing_secrets.sql, shipped by PR #544):
 *   * a fresh per-secret data key (DEK) from KMS `GenerateDataKey` seals the secret
 *     with AES-256-GCM (12-byte nonce, 16-byte tag, AAD bound to tenant + webhook + row id)
 *   * only the KMS-wrapped DEK (`wrapped_data_key`) and the key reference are stored;
 *     the database never sees the DEK or the plaintext secret
 *   * one `active` row per webhook; rotation retires the previous row in the same transaction
 *
 * The KMS surface is structurally the PHI envelope client (`PhiKmsClient` in
 * `@proctira/backend-health`), so the gateway injects the same `AwsKmsPhiClient` /
 * `LocalStubPhiKmsClient` implementations rather than a second crypto stack.
 *
 * Reading goes through the {@link WebhookSigningSecretResolver} port. Signing is mandatory:
 * a missing row, missing table (113 not applied), KMS failure or authentication failure
 * throws {@link WebhookSigningSecretUnavailableError}; callers fail the delivery closed.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppError } from '@proctira/common';
import { withPgTenant, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type { WebhookEntity } from './developer-portal-repository.js';

export const WEBHOOK_SIGNING_SECRETS_TABLE = 'developer_portal_webhook_signing_secrets';
const ALGORITHM = 'AES-256-GCM';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEK_BYTES = 32;

/** KMS envelope surface (structurally compatible with `PhiKmsClient`). */
export interface WebhookSecretKmsClient {
  generateDataKey(params: {
    KeyId: string;
    KeySpec?: 'AES_256';
  }): Promise<{ Plaintext: Uint8Array; CiphertextBlob: Uint8Array }>;
  decrypt(params: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
  }): Promise<{ Plaintext: Uint8Array }>;
}

/** PRC-H046 read port: the decrypted signing secret for a webhook at send time. */
export interface WebhookSigningSecretResolver {
  resolveSigningSecret(webhook: WebhookEntity): Promise<string | undefined>;
}

/** Write port used by webhook create / secret rotation. */
export interface WebhookSigningSecretWriter {
  storeSigningSecret(
    webhook: Pick<WebhookEntity, 'id' | 'tenantId'>,
    secret: string,
  ): Promise<void>;
}

export type WebhookSigningSecretFailureReason =
  'not_configured' | 'schema_not_ready' | 'missing' | 'undecryptable' | 'kms_error';

/** 503 at the HTTP edge; a failed (never unsigned) attempt in the delivery worker. */
export class WebhookSigningSecretUnavailableError extends AppError {
  constructor(
    readonly reason: WebhookSigningSecretFailureReason,
    message: string,
  ) {
    super(message, 'WEBHOOK_SIGNING_UNAVAILABLE', 503);
  }
}

/** One `developer_portal_webhook_signing_secrets` row (bytes as Buffers). */
export interface WebhookSigningSecretRecord {
  id: string;
  tenantId: string;
  webhookId: string;
  keyVersion: number;
  algorithm: typeof ALGORITHM;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  kmsKeyRef: string;
  status: 'active' | 'retired';
  createdAt: Date;
  retiredAt: Date | null;
}

export type NewWebhookSigningSecretRecord = Omit<
  WebhookSigningSecretRecord,
  'keyVersion' | 'status' | 'createdAt' | 'retiredAt'
>;

/** Persistence for sealed secrets. `rotate` is atomic: retire active + insert next version. */
export interface WebhookSigningSecretStore {
  rotate(record: NewWebhookSigningSecretRecord): Promise<WebhookSigningSecretRecord>;
  getActive(tenantId: string, webhookId: string): Promise<WebhookSigningSecretRecord | null>;
}

function aad(tenantId: string, webhookId: string, rowId: string): Buffer {
  return Buffer.from(
    `proctira:webhook-signing-secret:v1:${tenantId}:${webhookId}:${rowId}`,
    'utf8',
  );
}

export class EnvelopeWebhookSigningSecrets
  implements WebhookSigningSecretResolver, WebhookSigningSecretWriter
{
  constructor(
    private readonly options: {
      store: WebhookSigningSecretStore;
      kms: WebhookSecretKmsClient;
      /** KMS key id / alias / ARN used for GenerateDataKey (stored as kms_key_ref). */
      kmsKeyRef: string;
    },
  ) {
    if (!options.kmsKeyRef.trim()) {
      throw new WebhookSigningSecretUnavailableError(
        'not_configured',
        'Webhook signing secret KMS key reference is required',
      );
    }
  }

  async storeSigningSecret(
    webhook: Pick<WebhookEntity, 'id' | 'tenantId'>,
    secret: string,
  ): Promise<void> {
    const keyRef = this.options.kmsKeyRef.trim();
    let dataKey: Buffer;
    let wrapped: Buffer;
    try {
      const generated = await this.options.kms.generateDataKey({
        KeyId: keyRef,
        KeySpec: 'AES_256',
      });
      dataKey = Buffer.from(generated.Plaintext);
      wrapped = Buffer.from(generated.CiphertextBlob);
    } catch {
      throw new WebhookSigningSecretUnavailableError(
        'kms_error',
        'KMS GenerateDataKey failed for the webhook signing secret',
      );
    }
    try {
      if (dataKey.length !== DEK_BYTES) {
        throw new WebhookSigningSecretUnavailableError(
          'kms_error',
          'KMS returned a data key that is not 32 bytes',
        );
      }
      const id = uuidv4();
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dataKey, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      cipher.setAAD(aad(webhook.tenantId, webhook.id, id));
      const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
      await this.options.store.rotate({
        id,
        tenantId: webhook.tenantId,
        webhookId: webhook.id,
        algorithm: ALGORITHM,
        ciphertext,
        nonce,
        authTag: cipher.getAuthTag(),
        wrappedDataKey: wrapped,
        kmsKeyRef: keyRef,
      });
    } finally {
      dataKey.fill(0);
    }
  }

  async resolveSigningSecret(webhook: WebhookEntity): Promise<string | undefined> {
    const row = await this.options.store.getActive(webhook.tenantId, webhook.id);
    if (!row) {
      throw new WebhookSigningSecretUnavailableError(
        'missing',
        `Webhook ${webhook.id} has no active signing secret; rotate the secret to resume deliveries`,
      );
    }
    if (row.tenantId !== webhook.tenantId || row.webhookId !== webhook.id) {
      throw new WebhookSigningSecretUnavailableError(
        'undecryptable',
        'Webhook signing secret row does not belong to this webhook',
      );
    }
    let dataKey: Buffer;
    try {
      const out = await this.options.kms.decrypt({
        KeyId: row.kmsKeyRef,
        CiphertextBlob: new Uint8Array(row.wrappedDataKey),
      });
      dataKey = Buffer.from(out.Plaintext);
    } catch {
      throw new WebhookSigningSecretUnavailableError(
        'kms_error',
        `KMS could not unwrap the signing secret data key for webhook ${webhook.id}`,
      );
    }
    try {
      if (
        dataKey.length !== DEK_BYTES ||
        row.nonce.length !== NONCE_BYTES ||
        row.authTag.length !== AUTH_TAG_BYTES
      ) {
        throw new Error('envelope shape');
      }
      // Tag length pinned: a truncated tag must not authenticate.
      const decipher = createDecipheriv('aes-256-gcm', dataKey, row.nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(aad(row.tenantId, row.webhookId, row.id));
      decipher.setAuthTag(row.authTag);
      return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new WebhookSigningSecretUnavailableError(
        'undecryptable',
        `Webhook ${webhook.id} signing secret failed authentication; rotate the secret`,
      );
    } finally {
      dataKey.fill(0);
    }
  }
}

/** In-memory store (tests / non-production in-memory developer-portal repository). */
export class InMemoryWebhookSigningSecretStore implements WebhookSigningSecretStore {
  readonly rows: WebhookSigningSecretRecord[] = [];

  async rotate(record: NewWebhookSigningSecretRecord): Promise<WebhookSigningSecretRecord> {
    const now = new Date();
    let maxVersion = 0;
    for (const row of this.rows) {
      if (row.tenantId !== record.tenantId || row.webhookId !== record.webhookId) continue;
      maxVersion = Math.max(maxVersion, row.keyVersion);
      if (row.status === 'active') {
        row.status = 'retired';
        row.retiredAt = now;
      }
    }
    const stored: WebhookSigningSecretRecord = {
      ...record,
      keyVersion: maxVersion + 1,
      status: 'active',
      createdAt: now,
      retiredAt: null,
    };
    this.rows.push(stored);
    return stored;
  }

  async getActive(tenantId: string, webhookId: string): Promise<WebhookSigningSecretRecord | null> {
    return (
      this.rows.find(
        (r) => r.tenantId === tenantId && r.webhookId === webhookId && r.status === 'active',
      ) ?? null
    );
  }
}

function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '42P01';
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string' && value.startsWith('\\x'))
    return Buffer.from(value.slice(2), 'hex');
  throw new WebhookSigningSecretUnavailableError('undecryptable', 'Unexpected bytea encoding');
}

function mapRow(row: Record<string, unknown>): WebhookSigningSecretRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    webhookId: String(row.webhook_id),
    keyVersion: Number(row.key_version),
    algorithm: ALGORITHM,
    ciphertext: toBuffer(row.ciphertext),
    nonce: toBuffer(row.nonce),
    authTag: toBuffer(row.auth_tag),
    wrappedDataKey: toBuffer(row.wrapped_data_key),
    kmsKeyRef: String(row.kms_key_ref),
    status: row.status === 'retired' ? 'retired' : 'active',
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    retiredAt:
      row.retired_at == null
        ? null
        : row.retired_at instanceof Date
          ? row.retired_at
          : new Date(String(row.retired_at)),
  };
}

/**
 * Postgres store over the 113 table, tenant-bound via `withPgTenant` (RLS + FORCE RLS).
 * A missing table (113 not yet applied) fails closed as `schema_not_ready`; no DDL here.
 */
export class PgWebhookSigningSecretStore implements WebhookSigningSecretStore {
  constructor(private readonly pool: PgPoolWithConnect | PgQueryable) {}

  private async scoped<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    try {
      return await withPgTenant(this.pool, tenantId, fn);
    } catch (err) {
      if (isUndefinedTable(err)) {
        throw new WebhookSigningSecretUnavailableError(
          'schema_not_ready',
          `${WEBHOOK_SIGNING_SECRETS_TABLE} is missing (apply db/sql/113_developer_portal_webhook_signing_secrets.sql)`,
        );
      }
      throw err;
    }
  }

  async rotate(record: NewWebhookSigningSecretRecord): Promise<WebhookSigningSecretRecord> {
    return this.scoped(record.tenantId, async (client) => {
      // Serialise rotations per webhook so key_version and the active index never race.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `webhook-signing-secret:${record.tenantId}:${record.webhookId}`,
      ]);
      await client.query(
        `UPDATE ${WEBHOOK_SIGNING_SECRETS_TABLE}
            SET status = 'retired', retired_at = now()
          WHERE tenant_id = $1::uuid AND webhook_id = $2::uuid AND status = 'active'`,
        [record.tenantId, record.webhookId],
      );
      const result = await client.query(
        `INSERT INTO ${WEBHOOK_SIGNING_SECRETS_TABLE} (
           id, tenant_id, webhook_id, key_version, algorithm, ciphertext, nonce, auth_tag,
           wrapped_data_key, kms_key_ref, status
         )
         SELECT $1::uuid, $2::uuid, $3::uuid, COALESCE(MAX(key_version), 0) + 1, $4, $5, $6, $7, $8, $9, 'active'
           FROM ${WEBHOOK_SIGNING_SECRETS_TABLE}
          WHERE tenant_id = $2::uuid AND webhook_id = $3::uuid
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.webhookId,
          record.algorithm,
          record.ciphertext,
          record.nonce,
          record.authTag,
          record.wrappedDataKey,
          record.kmsKeyRef,
        ],
      );
      return mapRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async getActive(tenantId: string, webhookId: string): Promise<WebhookSigningSecretRecord | null> {
    return this.scoped(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM ${WEBHOOK_SIGNING_SECRETS_TABLE}
          WHERE tenant_id = $1::uuid AND webhook_id = $2::uuid AND status = 'active'
          LIMIT 1`,
        [tenantId, webhookId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRow(row) : null;
    });
  }
}
