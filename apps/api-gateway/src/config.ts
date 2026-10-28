/**
 * API Gateway Configuration
 *
 * Loads configuration from environment variables with sensible defaults.
 */

import { isDeployedEnvironment as isDeployedProcessEnvironment } from '@proctira/common/node-env';
import { Type, type Static } from '@sinclair/typebox';

/**
 * Service route definition for proxying requests to backend services.
 */
export const ServiceRouteSchema = Type.Object({
  /** URL prefix for this service (e.g., '/institutions') */
  prefix: Type.String(),
  /** Target service URL (e.g., 'http://localhost:3001') */
  target: Type.String(),
  /** Health check path on the target service */
  healthCheck: Type.String({ default: '/health' }),
  /** Upstream request timeout in milliseconds (default: 15000) */
  timeoutMs: Type.Optional(Type.Number()),
});

export type ServiceRoute = Static<typeof ServiceRouteSchema>;

/**
 * Gateway configuration schema.
 */
export const GatewayConfigSchema = Type.Object({
  /** Server port */
  port: Type.Number({ default: 3000 }),
  /** Server host */
  host: Type.String({ default: '0.0.0.0' }),
  /** Environment */
  env: Type.Union([Type.Literal('development'), Type.Literal('production'), Type.Literal('test')], {
    default: 'development',
  }),
  /**
   * Socket peers whose forwarding headers Fastify may trust. Empty/omitted
   * means direct socket IP only; never enable broad `trustProxy: true`.
   */
  trustedProxyCidrs: Type.Optional(Type.Array(Type.String(), { default: [] })),
  /** Rate limiting configuration */
  rateLimiting: Type.Object({
    /** Time window in milliseconds */
    windowMs: Type.Number({ default: 60000 }),
    /** Maximum requests per window */
    maxRequests: Type.Number({ default: 100 }),
  }),
  /** CORS configuration */
  cors: Type.Object({
    /** Allowed origins */
    origins: Type.Array(Type.String(), { default: ['http://localhost:3000'] }),
    /** Allowed HTTP methods */
    methods: Type.Array(Type.String(), {
      default: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
    /** Allow credentials */
    credentials: Type.Boolean({ default: true }),
  }),
  /** JWT configuration */
  jwt: Type.Object({
    /** JWT signing secret (current / kid=current) */
    secret: Type.String(),
    /**
     * Previous JWT signing secret accepted during rotation (G-504).
     * Set JWT_SECRET_PREVIOUS while old tokens remain valid, then clear.
     */
    previousSecret: Type.Optional(Type.String()),
    /** Token issuer */
    issuer: Type.String({ default: 'proctira-platform' }),
    /** Token audience */
    audience: Type.String({ default: 'proctira-api' }),
    /** Access token expiration */
    accessTokenExpiresIn: Type.String({ default: '15m' }),
  }),
  /** Tenant resolution configuration */
  tenant: Type.Object({
    /** Base domain for subdomain extraction */
    baseDomain: Type.String({ default: 'proctira.org' }),
    /** Header name for tenant ID */
    headerName: Type.String({ default: 'x-tenant-id' }),
  }),
  /** Backend service routes */
  services: Type.Record(Type.String(), ServiceRouteSchema, { default: {} }),
});

export type GatewayConfig = Static<typeof GatewayConfigSchema>;

/**
 * Resolve the non-secret access-token lifetime. Kubernetes manifests use the
 * `JWT_ACCESS_TTL` alias so secret scanners do not mistake a duration for key
 * material; the historical variable remains supported for compatibility.
 */
export function resolveAccessTokenExpiresIn(
  source: Record<string, string | undefined> = process.env,
): string {
  return source['JWT_ACCESS_TTL']?.trim() || source['JWT_ACCESS_TOKEN_EXPIRES_IN']?.trim() || '15m';
}

/** Dev-only fallback; refused outright when NODE_ENV=production (G-703). */
export const DEV_JWT_SECRET = 'dev-secret-change-in-production';

/**
 * PRC-L475: the literal JWT_SECRET committed in
 * infrastructure/k8s/overlays/development/secrets.yaml. That value is 51
 * chars — long enough to pass the length gate below — so it would not be
 * caught if this exact dev overlay were ever applied against a cluster with
 * NODE_ENV=production forced some other way. Refuse it explicitly, same as
 * every other known placeholder.
 */
export const DEV_OVERLAY_JWT_SECRET = 'dev-only-jwt-secret-not-for-production-0123456789ab';

const WEAK_JWT_SECRETS = new Set([
  DEV_JWT_SECRET,
  DEV_OVERLAY_JWT_SECRET,
  'CHANGE_ME',
  'CHANGE_ME_IN_PRODUCTION',
  'secret',
  'changeme',
]);

/** Minimum HS256 key length (bytes) accepted in production. */
export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

/** Parse explicit trusted proxy IP/CIDR entries; blank means trust no proxy. */
export function parseTrustedProxyCidrs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Resolve the HS256 signing secret. Deployed environments fail closed
 * (PRC-L566: staging included, see {@link isDeployedEnvironment}): missing,
 * weak, or short secrets throw at boot instead of silently signing with a
 * default. `env` is the process NODE_ENV (unset counts as deployed).
 */
export function resolveJwtSecret(
  env: string | undefined,
  raw: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  const secret = raw?.trim() ?? '';
  if (!isDeployedEnvironment(env, processEnv)) {
    return secret.length > 0 ? secret : DEV_JWT_SECRET;
  }
  if (secret.length === 0) {
    throw new Error(
      'JWT_SECRET is required when NODE_ENV=production or in any deployed environment (G-703)',
    );
  }
  if (WEAK_JWT_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET uses a known placeholder value; refusing to start in production or staging',
    );
  }
  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production or staging`,
    );
  }
  return secret;
}

/**
 * PRC-M011: JWT_SECRET_PREVIOUS is still accepted for verification during a
 * rotation window, so in a deployed environment (PRC-L566) it gets the same
 * placeholder / length checks as JWT_SECRET and must differ from the current
 * secret.
 */
export function resolvePreviousJwtSecret(
  env: string | undefined,
  raw: string | undefined,
  current: string,
  processEnv: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const previous = raw?.trim() ?? '';
  if (previous.length === 0) return undefined;
  if (!isDeployedEnvironment(env, processEnv)) return previous === current ? undefined : previous;
  if (WEAK_JWT_SECRETS.has(previous)) {
    throw new Error(
      'JWT_SECRET_PREVIOUS uses a known placeholder value; refusing to start in production or staging',
    );
  }
  if (previous.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET_PREVIOUS must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production or staging`,
    );
  }
  if (previous === current) {
    throw new Error('JWT_SECRET_PREVIOUS must differ from JWT_SECRET (PRC-M011)');
  }
  return previous;
}

const LOCALHOST_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

/**
 * PRC-L566: deployed (staging or production) unless NODE_ENV is development /
 * test without a deployed APP_ENV / DEPLOY_ENV stage. Delegates to the shared
 * fail-closed predicate in `@proctira/common/node-env`, so `NODE_ENV=staging`
 * (the Kustomize staging overlay) and an unset NODE_ENV get every production
 * boot guard.
 */
export function isDeployedEnvironment(
  configEnv: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  return isDeployedProcessEnvironment(configEnv, processEnv);
}

/**
 * PRC-M011: refuse unsafe auth boot configurations outside development/test.
 * - No Keycloak config → local HS-JWT fallback only when ALLOW_LOCAL_HS_AUTH=1.
 * - Keycloak mode → KEYCLOAK_REDIRECT_URI and NEXT_PUBLIC_WEB_URL must be set
 *   explicitly and must not point at localhost.
 */
export function assertAuthBootPolicy(input: {
  configEnv: string;
  keycloakConfigured: boolean;
  processEnv?: NodeJS.ProcessEnv;
}): void {
  const env = input.processEnv ?? process.env;
  if (!isDeployedEnvironment(input.configEnv, env)) return;
  if (!input.keycloakConfigured) {
    if (env['ALLOW_LOCAL_HS_AUTH'] !== '1') {
      throw new Error(
        'Keycloak is not configured (KEYCLOAK_ISSUER/KEYCLOAK_CLIENT_ID); refusing local HS-JWT auth in a deployed environment. Set ALLOW_LOCAL_HS_AUTH=1 only for an approved headless deployment (PRC-M011).',
      );
    }
    return;
  }
  for (const name of ['KEYCLOAK_REDIRECT_URI', 'NEXT_PUBLIC_WEB_URL'] as const) {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`${name} must be set in a deployed environment (PRC-M011)`);
    }
    if (LOCALHOST_URL.test(value)) {
      throw new Error(`${name} must not point at localhost in a deployed environment (PRC-M011)`);
    }
  }
}

/**
 * PRC-M524: parse CORS_ORIGINS. A production boot-fail guard (mirroring
 * resolveJwtSecret's refusal of a silent default) was deferred — see the
 * CANONICAL_LEDGER.csv PARTIAL residual for PRC-M524: this repo's own
 * config.test.ts boots the gateway with NODE_ENV=production and no
 * CORS_ORIGINS set (to isolate an unrelated JWT_SECRET_PREVIOUS assertion),
 * which is exactly the class of existing-boot-path dependency the batch plan
 * flagged as a reason to keep this additive-only rather than silently
 * changing gateway boot behavior.
 */
export function resolveCorsOrigins(_env: string, raw: string | undefined): string[] {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }
  return trimmed
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Load gateway configuration from environment variables.
 */
export function loadConfig(): GatewayConfig {
  const env = (process.env['NODE_ENV'] || 'development') as GatewayConfig['env'];

  const corsOrigins = resolveCorsOrigins(env, process.env['CORS_ORIGINS']);

  // Parse service routes from SERVICE_ROUTES env var (JSON) or use defaults
  let services: Record<string, ServiceRoute> = {};
  if (process.env['SERVICE_ROUTES']) {
    try {
      services = JSON.parse(process.env['SERVICE_ROUTES']) as Record<string, ServiceRoute>;
    } catch {
      // Use defaults if parsing fails
    }
  }

  // Default service routes for development
  if (Object.keys(services).length === 0) {
    services = {
      auth: {
        prefix: '/auth',
        target: 'http://localhost:3001',
        healthCheck: '/health',
      },
      institutions: {
        prefix: '/institutions',
        target: 'http://localhost:3002',
        healthCheck: '/health',
      },
      students: {
        prefix: '/students',
        target: 'http://localhost:3003',
        healthCheck: '/health',
      },
      staff: {
        prefix: '/staff',
        target: 'http://localhost:3004',
        healthCheck: '/health',
      },
      assessments: {
        prefix: '/assessments',
        target: 'http://localhost:3005',
        healthCheck: '/health',
      },
      attendance: {
        prefix: '/attendance',
        target: 'http://localhost:3006',
        healthCheck: '/health',
      },
      examinations: {
        prefix: '/examinations',
        target: 'http://localhost:3007',
        healthCheck: '/health',
      },
    };
  }

  // PRC-L566: the deployed-environment guard reads the raw NODE_ENV, so an
  // unset value or NODE_ENV=staging is guarded like production.
  const nodeEnv = process.env['NODE_ENV'];
  const jwtSecret = resolveJwtSecret(nodeEnv, process.env['JWT_SECRET']);
  return {
    port: parseInt(process.env['PORT'] || '3000', 10),
    host: process.env['HOST'] || '0.0.0.0',
    env,
    trustedProxyCidrs: parseTrustedProxyCidrs(process.env['TRUSTED_PROXY_CIDRS']),
    rateLimiting: {
      windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '60000', 10),
      maxRequests: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '100', 10),
    },
    cors: {
      origins: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: jwtSecret,
      previousSecret: resolvePreviousJwtSecret(
        nodeEnv,
        process.env['JWT_SECRET_PREVIOUS'],
        jwtSecret,
      ),
      issuer: process.env['JWT_ISSUER'] || 'proctira-platform',
      audience: process.env['JWT_AUDIENCE'] || 'proctira-api',
      accessTokenExpiresIn: resolveAccessTokenExpiresIn(),
    },
    tenant: {
      baseDomain: process.env['TENANT_BASE_DOMAIN'] || 'proctira.org',
      headerName: process.env['TENANT_HEADER_NAME'] || 'x-tenant-id',
    },
    services,
  };
}
