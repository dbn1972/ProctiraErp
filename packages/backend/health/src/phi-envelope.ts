/**
 * W1-SEC-04 COMPLETE — PHI envelope provider (KMS-backed / fail-closed).
 *
 * Production must not silently use a process-env master secret alone.
 * Configure `PHI_ENVELOPE_PROVIDER=kms` with `PHI_KMS_KEY_ID` (and a
 * wrapped root key). CI may use `local-stub` (fake KMS client) without
 * calling real AWS. `env-hmac` is allowed only outside production.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export type PhiEnvelopeProviderKind = 'kms' | 'env-hmac' | 'local-stub';

export interface PhiCryptoScope {
  tenantId: string;
  institutionId: string;
}

/** Minimal KMS surface used for envelope wrap/unwrap (injectable for CI). */
export interface PhiKmsClient {
  decrypt(params: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
  }): Promise<{ Plaintext: Uint8Array }>;
  generateDataKey?(params: {
    KeyId: string;
    KeySpec?: 'AES_256';
  }): Promise<{ Plaintext: Uint8Array; CiphertextBlob: Uint8Array }>;
}

export interface PhiEnvelopeProvider {
  readonly kind: PhiEnvelopeProviderKind;
  /** Rotation label mixed into DEK derivation (e.g. key alias version). */
  readonly keyVersion: string;
  /** Resolve the 32-byte root key used to derive institution DEKs. */
  resolveRootKey(): Buffer;
}

export class PhiEnvelopeMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhiEnvelopeMisconfiguredError';
  }
}

export class PhiKeyMissingError extends Error {
  constructor() {
    super(
      'PHI encryption is not configured: set PHI_ENVELOPE_PROVIDER=kms with PHI_KMS_KEY_ID ' +
        '(and PHI_KMS_WRAPPED_ROOT_KEY), or ALLOW_PLAINTEXT_PHI=1 to explicitly accept plaintext PHI at rest',
    );
    this.name = 'PhiKeyMissingError';
  }
}

function envFlag(name: string, env: NodeJS.ProcessEnv): boolean {
  const flag = env[name]?.trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export function plaintextPhiAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return envFlag('ALLOW_PLAINTEXT_PHI', env);
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

function parseMasterKeyMaterial(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    // fall through
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Env-HMAC provider — non-production (or explicit degrade) only. */
export class EnvHmacPhiEnvelopeProvider implements PhiEnvelopeProvider {
  readonly kind = 'env-hmac' as const;
  readonly keyVersion: string;
  private readonly root: Buffer;

  constructor(masterRaw: string, keyVersion = 'env-v1') {
    this.root = parseMasterKeyMaterial(masterRaw);
    this.keyVersion = keyVersion;
  }

  resolveRootKey(): Buffer {
    return this.root;
  }
}

/**
 * KMS envelope provider: root key is the plaintext of a KMS-wrapped blob.
 * Rotation: bump `PHI_KMS_KEY_VERSION` and re-wrap root under the new CMK/alias.
 */
export class KmsPhiEnvelopeProvider implements PhiEnvelopeProvider {
  readonly kind: 'kms' | 'local-stub';
  readonly keyVersion: string;
  private root: Buffer | null = null;

  constructor(
    private readonly kms: PhiKmsClient,
    private readonly keyId: string,
    private readonly wrappedRootKeyB64: string,
    options: { kind?: 'kms' | 'local-stub'; keyVersion?: string } = {},
  ) {
    this.kind = options.kind ?? 'kms';
    this.keyVersion = options.keyVersion ?? 'kms-v1';
  }

  resolveRootKey(): Buffer {
    if (this.root) return this.root;
    throw new PhiEnvelopeMisconfiguredError(
      'KMS PHI envelope root key is not unwrapped yet — call unwrapRootKey() at boot',
    );
  }

  async unwrapRootKey(): Promise<Buffer> {
    const blob = Buffer.from(this.wrappedRootKeyB64, 'base64');
    const result = await this.kms.decrypt({
      KeyId: this.keyId,
      CiphertextBlob: new Uint8Array(blob),
    });
    const plain = Buffer.from(result.Plaintext);
    if (plain.length < 32) {
      throw new PhiEnvelopeMisconfiguredError('KMS-unwrapped PHI root key must be at least 32 bytes');
    }
    this.root = plain.length === 32 ? plain : createHash('sha256').update(plain).digest();
    return this.root;
  }
}

/**
 * Local stub KMS for CI — AES-GCM wrap/unwrap with a deterministic stub key.
 * Does **not** call AWS. Allowed in production only with ALLOW_PHI_KMS_STUB=1.
 */
export class LocalStubPhiKmsClient implements PhiKmsClient {
  private readonly stubKey: Buffer;

  constructor(stubSecret = 'phi-local-stub-kms-not-for-prod') {
    this.stubKey = createHash('sha256').update(stubSecret, 'utf8').digest();
  }

  /** Create a wrapped root blob for tests / stub boot. */
  wrapRootKey(plaintext: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.stubKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  async decrypt(params: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
  }): Promise<{ Plaintext: Uint8Array }> {
    void params.KeyId;
    const buf = Buffer.from(params.CiphertextBlob);
    if (buf.length < 28) throw new Error('Invalid stub KMS ciphertext');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.stubKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return { Plaintext: new Uint8Array(plain) };
  }

  async generateDataKey(params: {
    KeyId: string;
    KeySpec?: 'AES_256';
  }): Promise<{ Plaintext: Uint8Array; CiphertextBlob: Uint8Array }> {
    void params.KeySpec;
    const plain = randomBytes(32);
    const wrapped = Buffer.from(this.wrapRootKey(plain), 'base64');
    return { Plaintext: new Uint8Array(plain), CiphertextBlob: new Uint8Array(wrapped) };
  }
}

let activeProvider: PhiEnvelopeProvider | null | undefined;

/** Test/DI hook — reset between unit tests. */
export function setPhiEnvelopeProviderForTests(provider: PhiEnvelopeProvider | null): void {
  activeProvider = provider;
}

export function resetPhiEnvelopeProviderForTests(): void {
  activeProvider = undefined;
}

export function getPhiEnvelopeProviderKind(
  env: NodeJS.ProcessEnv = process.env,
): PhiEnvelopeProviderKind | 'plaintext' | 'missing' {
  const explicit = env.PHI_ENVELOPE_PROVIDER?.trim().toLowerCase();
  if (explicit === 'kms' || explicit === 'env-hmac' || explicit === 'local-stub') {
    return explicit;
  }
  if (env.PHI_KMS_KEY_ID?.trim() && env.PHI_KMS_WRAPPED_ROOT_KEY?.trim()) return 'kms';
  if (env.PHI_ENCRYPTION_KEY?.trim()) return 'env-hmac';
  if (plaintextPhiAllowed(env)) return 'plaintext';
  return 'missing';
}

/**
 * Boot-time / first-use configuration.
 * Production refuses env-only masters unless an explicit plaintext opt-out is set.
 */
export function assertPhiEnvelopeConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (plaintextPhiAllowed(env) && !env.PHI_ENCRYPTION_KEY?.trim() && !env.PHI_KMS_KEY_ID?.trim()) {
    return;
  }
  const kind = getPhiEnvelopeProviderKind(env);
  if (kind === 'plaintext' || kind === 'missing') {
    if (!plaintextPhiAllowed(env)) throw new PhiKeyMissingError();
    return;
  }
  if (isProductionEnv(env) && kind === 'env-hmac') {
    throw new PhiEnvelopeMisconfiguredError(
      'W1-SEC-04: production forbids env-only PHI master secrets. ' +
        'Set PHI_ENVELOPE_PROVIDER=kms with PHI_KMS_KEY_ID and PHI_KMS_WRAPPED_ROOT_KEY ' +
        '(or PHI_ENVELOPE_PROVIDER=local-stub with ALLOW_PHI_KMS_STUB=1 for non-AWS CI).',
    );
  }
  if (isProductionEnv(env) && kind === 'local-stub' && !envFlag('ALLOW_PHI_KMS_STUB', env)) {
    throw new PhiEnvelopeMisconfiguredError(
      'W1-SEC-04: local-stub PHI envelope requires ALLOW_PHI_KMS_STUB=1 in production',
    );
  }
  if (kind === 'kms' || kind === 'local-stub') {
    if (!env.PHI_KMS_KEY_ID?.trim()) {
      throw new PhiEnvelopeMisconfiguredError('PHI_KMS_KEY_ID is required for KMS PHI envelope');
    }
    if (!env.PHI_KMS_WRAPPED_ROOT_KEY?.trim() && kind === 'kms') {
      throw new PhiEnvelopeMisconfiguredError(
        'PHI_KMS_WRAPPED_ROOT_KEY is required for KMS PHI envelope',
      );
    }
  }
}

export async function createPhiEnvelopeProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: { kmsClient?: PhiKmsClient } = {},
): Promise<PhiEnvelopeProvider | null> {
  assertPhiEnvelopeConfigured(env);
  const kind = getPhiEnvelopeProviderKind(env);
  if (kind === 'plaintext' || kind === 'missing') return null;

  const keyVersion =
    env.PHI_KMS_KEY_VERSION?.trim() ||
    env.PHI_ENVELOPE_KEY_VERSION?.trim() ||
    (kind === 'env-hmac' ? 'env-v1' : 'kms-v1');

  if (kind === 'env-hmac') {
    const raw = env.PHI_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    return new EnvHmacPhiEnvelopeProvider(raw, keyVersion);
  }

  const keyId = env.PHI_KMS_KEY_ID?.trim() || 'alias/proctira-phi';
  let wrapped = env.PHI_KMS_WRAPPED_ROOT_KEY?.trim() ?? '';
  let client = deps.kmsClient;

  if (kind === 'local-stub') {
    const stub = new LocalStubPhiKmsClient(env.PHI_KMS_STUB_SECRET?.trim());
    client = client ?? stub;
    if (!wrapped) {
      const root = env.PHI_ENCRYPTION_KEY?.trim()
        ? parseMasterKeyMaterial(env.PHI_ENCRYPTION_KEY.trim())
        : createHash('sha256').update('phi-local-stub-root', 'utf8').digest();
      wrapped = stub.wrapRootKey(root);
    }
  }

  if (!client) {
    throw new PhiEnvelopeMisconfiguredError(
      'KMS PHI envelope requires an injected PhiKmsClient (real AWS KMS not wired in this process). ' +
        'Use PHI_ENVELOPE_PROVIDER=local-stub for CI, or inject a KMS client at gateway boot.',
    );
  }

  const provider = new KmsPhiEnvelopeProvider(client, keyId, wrapped, {
    kind: kind === 'local-stub' ? 'local-stub' : 'kms',
    keyVersion,
  });
  await provider.unwrapRootKey();
  return provider;
}

export async function ensurePhiEnvelopeProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: { kmsClient?: PhiKmsClient } = {},
): Promise<PhiEnvelopeProvider | null> {
  if (activeProvider !== undefined) return activeProvider;
  activeProvider = await createPhiEnvelopeProvider(env, deps);
  return activeProvider;
}

export function resolvePhiRootKeySync(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  if (activeProvider) return activeProvider.resolveRootKey();

  // Sync path for unit tests / legacy callers before async boot:
  // production still fail-closes via assertPhiEnvelopeConfigured.
  assertPhiEnvelopeConfigured(env);
  const kind = getPhiEnvelopeProviderKind(env);
  if (kind === 'plaintext' || kind === 'missing') return null;
  if (kind === 'env-hmac') {
    const raw = env.PHI_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    const p = new EnvHmacPhiEnvelopeProvider(raw);
    activeProvider = p;
    return p.resolveRootKey();
  }
  if (kind === 'local-stub') {
    // Allow sync local-stub when wrapped root already set and stub client can decrypt sync...
    // Prefer async ensurePhiEnvelopeProvider in gateway boot; for sync encrypt in tests:
    const stub = new LocalStubPhiKmsClient(env.PHI_KMS_STUB_SECRET?.trim());
    let wrapped = env.PHI_KMS_WRAPPED_ROOT_KEY?.trim() ?? '';
    const root = env.PHI_ENCRYPTION_KEY?.trim()
      ? parseMasterKeyMaterial(env.PHI_ENCRYPTION_KEY.trim())
      : createHash('sha256').update('phi-local-stub-root', 'utf8').digest();
    if (!wrapped) wrapped = stub.wrapRootKey(root);
    // Sync unwrap via Node crypto (stub only)
    const blob = Buffer.from(wrapped, 'base64');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const stubKey = createHash('sha256')
      .update(env.PHI_KMS_STUB_SECRET?.trim() || 'phi-local-stub-kms-not-for-prod', 'utf8')
      .digest();
    const decipher = createDecipheriv('aes-256-gcm', stubKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    const normalized = plain.length === 32 ? plain : createHash('sha256').update(plain).digest();
    const provider: PhiEnvelopeProvider = {
      kind: 'local-stub',
      keyVersion: env.PHI_KMS_KEY_VERSION?.trim() || 'kms-v1',
      resolveRootKey: () => normalized,
    };
    activeProvider = provider;
    return normalized;
  }
  throw new PhiEnvelopeMisconfiguredError(
    'KMS PHI envelope root must be unwrapped asynchronously at boot (ensurePhiEnvelopeProvider)',
  );
}

export function deriveInstitutionDek(
  root: Buffer,
  scope: PhiCryptoScope,
  keyVersion = 'v1',
): Buffer {
  return createHmac('sha256', root)
    .update(`phi:v2:${keyVersion}:${scope.tenantId}:${scope.institutionId}`, 'utf8')
    .digest();
}

export function activePhiKeyVersion(): string {
  return activeProvider?.keyVersion ?? 'v1';
}
