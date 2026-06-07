/**
 * Auth configuration with sensible defaults.
 * All durations are in seconds unless otherwise noted.
 */

/**
 * Auth configuration interface.
 */
export interface AuthConfig {
  /** JWT configuration */
  jwt: {
    /** Secret key for signing JWTs */
    secret: string;
    /** Token issuer */
    issuer: string;
    /** Token audience */
    audience: string;
    /** Access token expiration in seconds (5min–24h, default 15min = 900s) */
    accessTokenExpiresIn: number;
  };
  /** Refresh token configuration */
  refreshToken: {
    /** Maximum lifetime in seconds (default 30 days) */
    maxLifetime: number;
  };
  /** Session configuration */
  session: {
    /** Session duration in seconds (1h–24h, default 8h = 28800s) */
    duration: number;
  };
  /** Password hashing configuration */
  password: {
    /** bcrypt salt rounds (default 12) */
    saltRounds: number;
  };
  /** Account lockout configuration */
  lockout: {
    /** Max consecutive failures before lockout (default 3) */
    maxAttempts: number;
    /** Window in seconds to track failures (default 15min = 900s) */
    windowSeconds: number;
    /** Lockout duration in seconds (1min–24h, default 15min = 900s) */
    durationSeconds: number;
  };
}

/** Minimum access token expiration: 5 minutes */
export const MIN_ACCESS_TOKEN_EXPIRES = 5 * 60; // 300 seconds

/** Maximum access token expiration: 24 hours */
export const MAX_ACCESS_TOKEN_EXPIRES = 24 * 60 * 60; // 86400 seconds

/** Default access token expiration: 15 minutes */
export const DEFAULT_ACCESS_TOKEN_EXPIRES = 15 * 60; // 900 seconds

/** Maximum refresh token lifetime: 30 days */
export const MAX_REFRESH_TOKEN_LIFETIME = 30 * 24 * 60 * 60; // 2592000 seconds

/** Default refresh token lifetime: 30 days */
export const DEFAULT_REFRESH_TOKEN_LIFETIME = 30 * 24 * 60 * 60; // 2592000 seconds

/** Minimum session duration: 1 hour */
export const MIN_SESSION_DURATION = 60 * 60; // 3600 seconds

/** Maximum session duration: 24 hours */
export const MAX_SESSION_DURATION = 24 * 60 * 60; // 86400 seconds

/** Default session duration: 8 hours */
export const DEFAULT_SESSION_DURATION = 8 * 60 * 60; // 28800 seconds

/** Default bcrypt salt rounds */
export const DEFAULT_SALT_ROUNDS = 12;

/**
 * Creates a default auth configuration.
 * Values can be overridden via environment variables or explicit options.
 */
export function createAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    jwt: {
      secret: overrides?.jwt?.secret ?? process.env['JWT_SECRET'] ?? 'change-me-in-production',
      issuer: overrides?.jwt?.issuer ?? process.env['JWT_ISSUER'] ?? 'proctira-platform',
      audience: overrides?.jwt?.audience ?? process.env['JWT_AUDIENCE'] ?? 'proctira-api',
      accessTokenExpiresIn: clamp(
        overrides?.jwt?.accessTokenExpiresIn ?? parseIntEnv('JWT_ACCESS_TOKEN_EXPIRES', DEFAULT_ACCESS_TOKEN_EXPIRES),
        MIN_ACCESS_TOKEN_EXPIRES,
        MAX_ACCESS_TOKEN_EXPIRES,
      ),
    },
    refreshToken: {
      maxLifetime: Math.min(
        overrides?.refreshToken?.maxLifetime ?? parseIntEnv('REFRESH_TOKEN_MAX_LIFETIME', DEFAULT_REFRESH_TOKEN_LIFETIME),
        MAX_REFRESH_TOKEN_LIFETIME,
      ),
    },
    session: {
      duration: clamp(
        overrides?.session?.duration ?? parseIntEnv('SESSION_DURATION', DEFAULT_SESSION_DURATION),
        MIN_SESSION_DURATION,
        MAX_SESSION_DURATION,
      ),
    },
    password: {
      saltRounds: overrides?.password?.saltRounds ?? parseIntEnv('BCRYPT_SALT_ROUNDS', DEFAULT_SALT_ROUNDS),
    },
    lockout: {
      maxAttempts: overrides?.lockout?.maxAttempts ?? parseIntEnv('LOCKOUT_MAX_ATTEMPTS', 3),
      windowSeconds: overrides?.lockout?.windowSeconds ?? parseIntEnv('LOCKOUT_WINDOW_SECONDS', 900),
      durationSeconds: overrides?.lockout?.durationSeconds ?? parseIntEnv('LOCKOUT_DURATION_SECONDS', 900),
    },
  };
}

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse an integer from environment variable with a default fallback.
 */
function parseIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
