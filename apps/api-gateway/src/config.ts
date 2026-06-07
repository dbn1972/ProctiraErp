/**
 * API Gateway Configuration
 *
 * Loads configuration from environment variables with sensible defaults.
 */

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
  env: Type.Union([
    Type.Literal('development'),
    Type.Literal('production'),
    Type.Literal('test'),
  ], { default: 'development' }),
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
    methods: Type.Array(Type.String(), { default: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }),
    /** Allow credentials */
    credentials: Type.Boolean({ default: true }),
  }),
  /** JWT configuration */
  jwt: Type.Object({
    /** JWT signing secret */
    secret: Type.String(),
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
 * Load gateway configuration from environment variables.
 */
export function loadConfig(): GatewayConfig {
  const env = (process.env['NODE_ENV'] || 'development') as GatewayConfig['env'];

  // Parse CORS origins from comma-separated env var
  const corsOrigins = process.env['CORS_ORIGINS']
    ? process.env['CORS_ORIGINS'].split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

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

  return {
    port: parseInt(process.env['PORT'] || '3000', 10),
    host: process.env['HOST'] || '0.0.0.0',
    env,
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
      secret: process.env['JWT_SECRET'] || 'dev-secret-change-in-production',
      issuer: process.env['JWT_ISSUER'] || 'proctira-platform',
      audience: process.env['JWT_AUDIENCE'] || 'proctira-api',
      accessTokenExpiresIn: process.env['JWT_ACCESS_TOKEN_EXPIRES_IN'] || '15m',
    },
    tenant: {
      baseDomain: process.env['TENANT_BASE_DOMAIN'] || 'proctira.org',
      headerName: process.env['TENANT_HEADER_NAME'] || 'x-tenant-id',
    },
    services,
  };
}
