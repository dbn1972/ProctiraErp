/**
 * W1-SEC-04 — AWS KMS (or env-selected stub) client for PHI envelope unwrap.
 *
 * Production `PHI_ENVELOPE_PROVIDER=kms` requires a real {@link PhiKmsClient}.
 * Gateway boot calls {@link createPhiKmsClientFromEnv} and injects the result
 * into {@link ensurePhiEnvelopeProvider}.
 */
import { PhiEnvelopeMisconfiguredError, type PhiKmsClient } from './phi-envelope.js';
import { LocalStubPhiKmsClient, getPhiEnvelopeProviderKind } from './phi-envelope.js';

function envFlag(name: string, env: NodeJS.ProcessEnv): boolean {
  const flag = env[name]?.trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

/** Thin adapter over `@aws-sdk/client-kms` matching {@link PhiKmsClient}. */
export class AwsKmsPhiClient implements PhiKmsClient {
  constructor(
    private readonly kms: {
      send(command: unknown): Promise<{
        Plaintext?: Uint8Array;
        CiphertextBlob?: Uint8Array;
      }>;
    },
    private readonly commands: {
      DecryptCommand: new (input: {
        KeyId?: string;
        CiphertextBlob: Uint8Array;
      }) => unknown;
      GenerateDataKeyCommand: new (input: {
        KeyId: string;
        KeySpec?: string;
      }) => unknown;
    },
  ) {}

  async decrypt(params: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
  }): Promise<{ Plaintext: Uint8Array }> {
    const out = await this.kms.send(
      new this.commands.DecryptCommand({
        KeyId: params.KeyId,
        CiphertextBlob: params.CiphertextBlob,
      }),
    );
    if (!out.Plaintext) {
      throw new PhiEnvelopeMisconfiguredError('AWS KMS Decrypt returned empty Plaintext');
    }
    return { Plaintext: out.Plaintext };
  }

  async generateDataKey(params: {
    KeyId: string;
    KeySpec?: 'AES_256';
  }): Promise<{ Plaintext: Uint8Array; CiphertextBlob: Uint8Array }> {
    const out = await this.kms.send(
      new this.commands.GenerateDataKeyCommand({
        KeyId: params.KeyId,
        KeySpec: params.KeySpec ?? 'AES_256',
      }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) {
      throw new PhiEnvelopeMisconfiguredError('AWS KMS GenerateDataKey returned incomplete material');
    }
    return { Plaintext: out.Plaintext, CiphertextBlob: out.CiphertextBlob };
  }
}

/**
 * Resolve a PHI KMS client for gateway boot.
 *
 * - Non-`kms` provider kinds → `undefined` (local-stub / env-hmac handle themselves)
 * - `PHI_KMS_CLIENT=local-stub` + `ALLOW_PHI_KMS_STUB=1` → {@link LocalStubPhiKmsClient}
 * - otherwise → AWS KMS via dynamic `@aws-sdk/client-kms` import (fail closed if missing)
 */
export async function createPhiKmsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PhiKmsClient | undefined> {
  const kind = getPhiEnvelopeProviderKind(env);
  if (kind !== 'kms') {
    return undefined;
  }

  const clientMode = env.PHI_KMS_CLIENT?.trim().toLowerCase();
  if (clientMode === 'local-stub') {
    if (!envFlag('ALLOW_PHI_KMS_STUB', env)) {
      throw new PhiEnvelopeMisconfiguredError(
        'W1-SEC-04: PHI_KMS_CLIENT=local-stub requires ALLOW_PHI_KMS_STUB=1',
      );
    }
    return new LocalStubPhiKmsClient(env.PHI_KMS_STUB_SECRET?.trim());
  }

  try {
    const sdk = await import('@aws-sdk/client-kms');
    const region =
      env.PHI_KMS_REGION?.trim() ||
      env.AWS_REGION?.trim() ||
      env.AWS_DEFAULT_REGION?.trim() ||
      'us-east-1';
    const client = new sdk.KMSClient({ region });
    return new AwsKmsPhiClient(client, {
      DecryptCommand: sdk.DecryptCommand,
      GenerateDataKeyCommand: sdk.GenerateDataKeyCommand,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PhiEnvelopeMisconfiguredError(
      'W1-SEC-04: PHI_ENVELOPE_PROVIDER=kms requires @aws-sdk/client-kms at gateway boot ' +
        '(or PHI_KMS_CLIENT=local-stub with ALLOW_PHI_KMS_STUB=1). ' +
        `Import failed: ${message}`,
    );
  }
}
