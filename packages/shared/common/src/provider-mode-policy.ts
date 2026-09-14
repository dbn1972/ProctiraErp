/**
 * W1-ARCH-08 — provider delivery mode policy (notifications / communications / payments).
 *
 * Sandbox and test stubs must never be the *silent* production default. Operators
 * must explicitly request live mode or opt into sandbox providers.
 *
 * Non-production: defaults to sandbox unless `PROVIDER_MODE=live`.
 * Production:
 *   - `PROVIDER_MODE=live` → live path (adapters may still refuse if unimplemented)
 *   - explicit sandbox opt-in → `PROVIDER_MODE=sandbox` and/or `ALLOW_SANDBOX_PROVIDERS=1`
 *   - otherwise → throw at config load (fail-closed)
 */

export type ProviderDeliveryMode = 'sandbox' | 'live';

export interface ProviderModeEnv {
  NODE_ENV?: string;
  PROVIDER_MODE?: string;
  /**
   * Explicit production opt-in for sandbox/test provider stubs.
   * Accepted truthy values: 1 / true / yes (case-insensitive).
   * Do not set in real production once live adapters + secrets are wired.
   */
  ALLOW_SANDBOX_PROVIDERS?: string;
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Snapshot env into a typed bag (avoids unsafe ProcessEnv default params). */
export function readProviderModeEnv(
  source?: Record<string, string | undefined>,
): ProviderModeEnv {
  const env = source ?? {
    NODE_ENV: process.env['NODE_ENV'],
    PROVIDER_MODE: process.env['PROVIDER_MODE'],
    ALLOW_SANDBOX_PROVIDERS: process.env['ALLOW_SANDBOX_PROVIDERS'],
  };
  return {
    NODE_ENV: env.NODE_ENV,
    PROVIDER_MODE: env.PROVIDER_MODE,
    ALLOW_SANDBOX_PROVIDERS: env.ALLOW_SANDBOX_PROVIDERS,
  };
}

function normalizedMode(env: ProviderModeEnv): string | undefined {
  const raw = env.PROVIDER_MODE?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : undefined;
}

/** Whether sandbox/test stubs are explicitly allowed for this environment. */
export function isSandboxProvidersExplicitlyAllowed(env: ProviderModeEnv): boolean {
  const mode = normalizedMode(env);
  return mode === 'sandbox' || truthy(env.ALLOW_SANDBOX_PROVIDERS);
}

/**
 * Resolve sandbox vs live delivery for a config loader, or throw when production
 * would otherwise silently default to sandbox (W1-ARCH-08).
 */
export function resolveProviderDeliveryMode(
  domain: string,
  env: ProviderModeEnv = readProviderModeEnv(),
): ProviderDeliveryMode {
  const mode = normalizedMode(env);

  if (mode === 'live') {
    return 'live';
  }

  if (mode !== undefined && mode !== 'sandbox') {
    throw new Error(
      `[providers] ${domain}: unknown PROVIDER_MODE='${mode}' ` +
        `(expected 'sandbox' | 'live') — W1-ARCH-08`,
    );
  }

  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && !isSandboxProvidersExplicitlyAllowed(env)) {
    throw new Error(
      `[providers] ${domain}: sandbox/test providers are not allowed as the silent ` +
        `production default (W1-ARCH-08). Set PROVIDER_MODE=live for live adapters, ` +
        `or explicitly opt in with PROVIDER_MODE=sandbox and/or ALLOW_SANDBOX_PROVIDERS=1.`,
    );
  }

  return 'sandbox';
}
