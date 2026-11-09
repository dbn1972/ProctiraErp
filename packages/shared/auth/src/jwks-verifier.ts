/**
 * PRC-L254 / PRC-L202: dependency-free JWKS access-token verifier for the BFF
 * and console shells (topic 1 Option A).
 *
 * Uses Web Crypto only (`crypto.subtle`, `fetch`, `atob`), so it runs in the
 * Next.js Edge middleware as well as in Node route handlers. It mirrors the
 * gateway's Keycloak verifier (`packages/backend/auth/src/keycloak/verify.ts`):
 *
 * - only RS256 and ES256 are accepted (`none` and every HMAC alg are refused);
 * - `iss` must equal the configured issuer exactly;
 * - audience: `aud` contains the configured audience (default: the client id),
 *   or `azp` equals the client id;
 * - `exp` must be in the future (callers may ask to skip only this check to
 *   run their refresh path) and `nbf` may not be more than 30 s ahead;
 * - keys are cached per `kid` with a TTL; an unknown `kid` forces at most one
 *   refresh per `minRefreshIntervalMs`; every fetch has a timeout; a failed
 *   refresh keeps the previously fetched keys.
 */

// Type-only import (erased at runtime): one set of Web Crypto types whatever
// lib the consuming package compiles with (Node, DOM or Edge).
import type { webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;

/** `globalThis.crypto.subtle` typed through Node's Web Crypto declarations. */
function subtle(): webcrypto.SubtleCrypto {
  return (globalThis.crypto as unknown as webcrypto.Crypto).subtle;
}

/** Claims returned by a successful verification. */
export type VerifiedJwtClaims = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  aud?: string | string[];
  azp?: string;
};

/** Why a token was refused. */
export type JwksTokenErrorCode =
  | 'malformed'
  | 'unsupported_alg'
  | 'unknown_key'
  | 'bad_signature'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'jwks_unavailable';

export class JwksTokenError extends Error {
  readonly code: JwksTokenErrorCode;
  constructor(code: JwksTokenErrorCode, message: string) {
    super(message);
    this.name = 'JwksTokenError';
    this.code = code;
  }
}

export interface JwksVerifierConfig {
  /** Expected `iss` (exact match). */
  issuer: string;
  /** JWKS endpoint (Keycloak: `<issuer>/protocol/openid-connect/certs`). */
  jwksUri: string;
  /** OAuth client id; accepted as `azp` and as the default audience. */
  clientId?: string;
  /** Expected audience; defaults to {@link clientId}. */
  audience?: string;
  /** Key cache TTL (default 10 min). */
  ttlMs?: number;
  /** Timeout for every JWKS fetch (default 3 s). */
  fetchTimeoutMs?: number;
  /** Minimum gap between unknown-`kid` forced refreshes (default 30 s). */
  minRefreshIntervalMs?: number;
  /** Injected fetch (tests). */
  fetcher?: typeof fetch;
}

export interface VerifyOptions {
  /** Current time in seconds (tests). */
  nowSeconds?: number;
  /**
   * Skip only the `exp` check, so a caller can send an expired-but-authentic
   * token down its refresh path. Signature, issuer, audience and `nbf` are
   * still enforced.
   */
  ignoreExpiry?: boolean;
}

export interface JwksVerifier {
  verify(token: string, options?: VerifyOptions): Promise<VerifiedJwtClaims>;
}

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown; crit?: unknown };

type Jwk = {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

type SupportedAlg = 'RS256' | 'ES256';

const NBF_SKEW_SECONDS = 30;

const ALGORITHMS: Record<
  SupportedAlg,
  {
    kty: 'RSA' | 'EC';
    importParams: webcrypto.RsaHashedImportParams | webcrypto.EcKeyImportParams;
    verifyParams: webcrypto.AlgorithmIdentifier | webcrypto.EcdsaParams;
  }
> = {
  RS256: {
    kty: 'RSA',
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
  },
  ES256: {
    kty: 'EC',
    importParams: { name: 'ECDSA', namedCurve: 'P-256' },
    verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
  },
};

function isSupportedAlg(alg: unknown): alg is SupportedAlg {
  return alg === 'RS256' || alg === 'ES256';
}

/**
 * base64url → bytes. Throws on invalid input. `lenient` also accepts standard
 * base64 (`+`, `/`, `=`), matching the shells' previous decode-only parsing.
 */
export function base64UrlToBytes(segment: string, lenient = false): Uint8Array {
  if (!(lenient ? /^[A-Za-z0-9_\-+/]*=*$/ : /^[A-Za-z0-9_-]*$/).test(segment)) {
    throw new JwksTokenError('malformed', 'Token segment is not base64url');
  }
  const base64 = segment.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string, lenient = false): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(segment, lenient)),
    );
  } catch {
    throw new JwksTokenError('malformed', 'Token segment is not JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JwksTokenError('malformed', 'Token segment is not a JSON object');
  }
  return value as Record<string, unknown>;
}

/** Splits a compact JWS and decodes header and payload (no verification). */
export function decodeJwtUnverified(token: string): {
  header: JwtHeader;
  payload: VerifiedJwtClaims;
  signingInput: string;
  signature: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new JwksTokenError('malformed', 'Token is not a signed compact JWS');
  }
  return {
    header: decodeJsonSegment(parts[0]) as JwtHeader,
    payload: decodeJsonSegment(parts[1]) as VerifiedJwtClaims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
  };
}

function audienceIncludes(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}

/** Copies into a fresh ArrayBuffer (avoids cross-realm/SharedArrayBuffer typing issues). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

class KeyCache {
  private keys = new Map<string, { alg: SupportedAlg; key: CryptoKey }>();
  private fetchedAt = 0;
  private lastForcedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly jwksUri: string,
    private readonly fetcher: typeof fetch,
    private readonly ttlMs: number,
    private readonly fetchTimeoutMs: number,
    private readonly minRefreshIntervalMs: number,
  ) {}

  async getKey(kid: string, alg: SupportedAlg): Promise<CryptoKey> {
    const now = Date.now();
    if (this.fetchedAt === 0 || now - this.fetchedAt > this.ttlMs) {
      await this.refresh().catch((error: unknown) => {
        // Keep serving the previous key set if a periodic refresh fails.
        if (this.keys.size === 0) throw error;
      });
    }
    let entry = this.keys.get(kid);
    if (!entry && Date.now() - this.lastForcedAt >= this.minRefreshIntervalMs) {
      this.lastForcedAt = Date.now();
      await this.refresh().catch(() => undefined);
      entry = this.keys.get(kid);
    }
    if (!entry || entry.alg !== alg) {
      throw new JwksTokenError('unknown_key', 'No JWKS key matches the token kid and alg');
    }
    return entry.key;
  }

  private refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.load().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async load(): Promise<void> {
    let body: { keys?: Jwk[] };
    try {
      const response = await this.fetcher(this.jwksUri, {
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = (await response.json()) as { keys?: Jwk[] };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new JwksTokenError('jwks_unavailable', `Failed to load JWKS: ${reason}`);
    }
    const next = new Map<string, { alg: SupportedAlg; key: CryptoKey }>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      const alg: SupportedAlg | undefined =
        jwk.kty === 'RSA' && jwk.n && jwk.e
          ? 'RS256'
          : jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y
            ? 'ES256'
            : undefined;
      if (!alg || (jwk.alg && jwk.alg !== alg)) continue;
      const material: webcrypto.JsonWebKey =
        alg === 'RS256'
          ? { kty: 'RSA', n: jwk.n, e: jwk.e }
          : { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
      try {
        const key = await subtle().importKey('jwk', material, ALGORITHMS[alg].importParams, false, [
          'verify',
        ]);
        next.set(jwk.kid, { alg, key });
      } catch {
        // Skip keys Web Crypto cannot import.
      }
    }
    this.keys = next;
    this.fetchedAt = Date.now();
  }
}

/** Creates a verifier bound to one issuer/JWKS endpoint. */
export function createJwksVerifier(config: JwksVerifierConfig): JwksVerifier {
  const expectedAudience = config.audience?.trim() || config.clientId?.trim() || '';
  if (!config.issuer || !config.jwksUri || !expectedAudience) {
    throw new Error('JWKS verifier needs issuer, jwksUri and an audience or client id');
  }
  const cache = new KeyCache(
    config.jwksUri,
    config.fetcher ?? ((input, init) => fetch(input, init)),
    config.ttlMs ?? 10 * 60 * 1000,
    config.fetchTimeoutMs ?? 3000,
    config.minRefreshIntervalMs ?? 30 * 1000,
  );

  return {
    async verify(token, options = {}) {
      const { header, payload, signingInput, signature } = decodeJwtUnverified(token);
      if (!isSupportedAlg(header.alg)) {
        throw new JwksTokenError('unsupported_alg', `Unsupported JWT alg: ${String(header.alg)}`);
      }
      if (header.crit !== undefined) {
        throw new JwksTokenError('unsupported_alg', 'JWT crit header is not supported');
      }
      if (typeof header.kid !== 'string' || !header.kid) {
        throw new JwksTokenError('unknown_key', 'JWT has no kid');
      }
      const key = await cache.getKey(header.kid, header.alg);
      const valid = await subtle().verify(
        ALGORITHMS[header.alg].verifyParams,
        key,
        toArrayBuffer(base64UrlToBytes(signature)),
        toArrayBuffer(new TextEncoder().encode(signingInput)),
      );
      if (!valid) throw new JwksTokenError('bad_signature', 'JWT signature is invalid');

      const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
      if (payload.iss !== config.issuer) {
        throw new JwksTokenError('issuer_mismatch', 'JWT issuer mismatch');
      }
      if (
        !audienceIncludes(payload.aud, expectedAudience) &&
        !(config.clientId && payload.azp === config.clientId)
      ) {
        throw new JwksTokenError('audience_mismatch', 'JWT audience mismatch');
      }
      if (typeof payload.nbf === 'number' && payload.nbf > now + NBF_SKEW_SECONDS) {
        throw new JwksTokenError('not_yet_valid', 'JWT not yet valid');
      }
      if (typeof payload.exp !== 'number') {
        throw new JwksTokenError('expired', 'JWT has no exp');
      }
      if (!options.ignoreExpiry && payload.exp <= now) {
        throw new JwksTokenError('expired', 'JWT expired');
      }
      return payload;
    },
  };
}

type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Reads the verifier config from the env names the gateway already uses for
 * Keycloak (`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_AUDIENCE`,
 * `KEYCLOAK_JWKS_URI`). Returns undefined when issuer or client id/audience is
 * missing.
 */
export function loadJwksVerifierConfig(env: EnvLike): JwksVerifierConfig | undefined {
  const issuer = env['KEYCLOAK_ISSUER']?.trim();
  const clientId = env['KEYCLOAK_CLIENT_ID']?.trim() || undefined;
  const audience = env['KEYCLOAK_AUDIENCE']?.trim() || undefined;
  if (!issuer || (!clientId && !audience)) return undefined;
  const jwksUri =
    env['KEYCLOAK_JWKS_URI']?.trim() ||
    `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`;
  return {
    issuer,
    jwksUri,
    ...(clientId ? { clientId } : {}),
    ...(audience ? { audience } : {}),
  };
}

/** APP_ENV / DEPLOY_ENV values that name a deployed stage. */
const DEPLOYED_STAGES: ReadonlySet<string> = new Set(['staging', 'production', 'prod']);

/** How a BFF/console shell treats access tokens in this process. */
export type ShellTokenVerification =
  { mode: 'verify'; verifier: JwksVerifier } | { mode: 'decode-only' } | { mode: 'unavailable' };

let cachedVerifier: { key: string; verifier: JwksVerifier } | null = null;

/**
 * Chooses the shell's token policy:
 * - JWKS configured → `verify` (every token is checked);
 * - not configured but APP_ENV / DEPLOY_ENV names a deployed stage →
 *   `unavailable` (fail closed: no session);
 * - otherwise (local dev, CI e2e, the gateway's own HS-JWT headless
 *   fallback, where no JWKS exists) → `decode-only`, the behaviour before
 *   this verifier. The gateway still verifies every forwarded token.
 */
export function resolveShellTokenVerification(env: EnvLike): ShellTokenVerification {
  const config = loadJwksVerifierConfig(env);
  if (config) {
    const key = JSON.stringify([config.issuer, config.jwksUri, config.clientId, config.audience]);
    if (!cachedVerifier || cachedVerifier.key !== key) {
      cachedVerifier = { key, verifier: createJwksVerifier(config) };
    }
    return { mode: 'verify', verifier: cachedVerifier.verifier };
  }
  const stage = (env['APP_ENV'] ?? env['DEPLOY_ENV'] ?? '').trim().toLowerCase();
  return DEPLOYED_STAGES.has(stage) ? { mode: 'unavailable' } : { mode: 'decode-only' };
}

/** Result of {@link verifyShellAccessToken}. */
export type ShellTokenResult =
  | { ok: true; claims: VerifiedJwtClaims; verified: boolean }
  | { ok: false; reason: JwksTokenErrorCode | 'verification_unavailable' };

/**
 * One call for shells: applies {@link resolveShellTokenVerification} and
 * returns the claims, or the reason the token was refused. `verified` is
 * false only in `decode-only` mode.
 */
export async function verifyShellAccessToken(
  token: string,
  env: EnvLike,
  options: VerifyOptions = {},
): Promise<ShellTokenResult> {
  const policy = resolveShellTokenVerification(env);
  if (policy.mode === 'unavailable') return { ok: false, reason: 'verification_unavailable' };
  try {
    if (policy.mode === 'verify') {
      return { ok: true, claims: await policy.verifier.verify(token, options), verified: true };
    }
    // decode-only keeps the previous shell parsing: three segments and a JSON
    // object payload; header and signature are not inspected.
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) throw new JwksTokenError('malformed', 'Malformed token');
    return {
      ok: true,
      claims: decodeJsonSegment(parts[1], true) as VerifiedJwtClaims,
      verified: false,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof JwksTokenError ? error.code : 'malformed',
    };
  }
}

/** Test hook: drop the cached env-derived verifier. */
export function __resetShellTokenVerifierCache(): void {
  cachedVerifier = null;
}
