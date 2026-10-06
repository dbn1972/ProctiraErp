/**
 * PRC-M211 / PRC-H046 — gateway wiring for envelope-encrypted webhook signing secrets.
 *
 * Secrets live in `developer_portal_webhook_signing_secrets` (db/sql/113, PR #544) through
 * {@link EnvelopeWebhookSigningSecrets}. The KMS client is the existing PHI envelope client
 * (`createPhiKmsClientFromEnv` from @proctira/backend-health) driven by webhook-specific env:
 *
 *   WEBHOOK_SIGNING_KMS_KEY_ID      KMS key id / alias / ARN for GenerateDataKey (required in prod)
 *   WEBHOOK_SIGNING_KMS_REGION      optional region override (else AWS_REGION)
 *   WEBHOOK_SIGNING_KMS_CLIENT      `local-stub` to use the deterministic stub KMS
 *   ALLOW_WEBHOOK_KMS_STUB=1        required for `local-stub` when NODE_ENV=production
 *   WEBHOOK_SIGNING_KMS_STUB_SECRET optional stub seed
 *
 * Outside production with no key id, the deterministic local stub is used (same key on every
 * replica, so multi-pod dev/CI stays signable). In production with no key id, nothing is wired:
 * webhook create/rotation answer 503 and deliveries fail closed — never unsigned.
 */
import {
  EnvelopeWebhookSigningSecrets,
  InMemoryWebhookSigningSecretStore,
  PgWebhookSigningSecretStore,
  getSharedDeveloperPortalPool,
  isPgDeveloperPortalEnabled,
  type WebhookSecretKmsClient,
  type WebhookSigningSecretStore,
} from '@proctira/backend-developer-portal';
import { LocalStubPhiKmsClient, createPhiKmsClientFromEnv } from '@proctira/backend-health';
import { isProductionNodeEnv } from '@proctira/common/node-env';

export const WEBHOOK_SIGNING_LOCAL_STUB_KEY_REF = 'local-stub:webhook-signing';

function flag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

export interface WebhookSigningSecretsWiringDeps {
  kmsClient?: WebhookSecretKmsClient;
  store?: WebhookSigningSecretStore;
  warn?: (message: string) => void;
}

export async function createWebhookSigningSecretsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: WebhookSigningSecretsWiringDeps = {},
): Promise<EnvelopeWebhookSigningSecrets | undefined> {
  const production = isProductionNodeEnv(env.NODE_ENV);
  const keyId = env.WEBHOOK_SIGNING_KMS_KEY_ID?.trim();
  const clientMode = env.WEBHOOK_SIGNING_KMS_CLIENT?.trim().toLowerCase();
  const store =
    deps.store ??
    (isPgDeveloperPortalEnabled()
      ? new PgWebhookSigningSecretStore(getSharedDeveloperPortalPool()!)
      : new InMemoryWebhookSigningSecretStore());

  if (!keyId) {
    if (production) {
      deps.warn?.(
        'PRC-M211: WEBHOOK_SIGNING_KMS_KEY_ID is unset — webhook registration returns 503 and ' +
          'deliveries fail closed until KMS envelope signing is configured',
      );
      return undefined;
    }
    return new EnvelopeWebhookSigningSecrets({
      store,
      kms: deps.kmsClient ?? new LocalStubPhiKmsClient(env.WEBHOOK_SIGNING_KMS_STUB_SECRET?.trim()),
      kmsKeyRef: WEBHOOK_SIGNING_LOCAL_STUB_KEY_REF,
    });
  }

  if (clientMode === 'local-stub' && production && !flag(env.ALLOW_WEBHOOK_KMS_STUB)) {
    throw new Error(
      'PRC-M211: WEBHOOK_SIGNING_KMS_CLIENT=local-stub requires ALLOW_WEBHOOK_KMS_STUB=1',
    );
  }
  // Reuse the PHI envelope KMS client factory (AWS SDK import + stub gate live there).
  const kms =
    deps.kmsClient ??
    (await createPhiKmsClientFromEnv({
      NODE_ENV: env.NODE_ENV,
      PHI_ENVELOPE_PROVIDER: 'kms',
      PHI_KMS_KEY_ID: keyId,
      PHI_KMS_CLIENT: clientMode,
      ALLOW_PHI_KMS_STUB: clientMode === 'local-stub' ? '1' : undefined,
      PHI_KMS_STUB_SECRET: env.WEBHOOK_SIGNING_KMS_STUB_SECRET,
      PHI_KMS_REGION: env.WEBHOOK_SIGNING_KMS_REGION ?? env.AWS_REGION,
      AWS_REGION: env.AWS_REGION,
      AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION,
    }));
  if (!kms?.generateDataKey) {
    throw new Error('PRC-M211: webhook signing KMS client must support GenerateDataKey');
  }
  return new EnvelopeWebhookSigningSecrets({
    store,
    kms: kms as WebhookSecretKmsClient,
    kmsKeyRef: keyId,
  });
}
