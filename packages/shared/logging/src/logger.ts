import type { Logger, LoggerOptions } from 'pino';
import pino from 'pino';

/**
 * Context fields that can be attached to log entries for
 * multi-tenant request tracing.
 */
export interface LogContext {
  tenantId?: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Options for creating a logger instance.
 */
export interface CreateLoggerOptions {
  /** Service or module name */
  name?: string;
  /** Log level override (defaults to LOG_LEVEL env or 'info') */
  level?: string;
  /** Initial context bindings (tenant, request, correlation IDs) */
  context?: LogContext;
  /** Enable pretty printing (defaults to true when NODE_ENV=development) */
  pretty?: boolean;
  /** Extra pino redact paths, merged with {@link DEFAULT_REDACT_PATHS}. */
  redactPaths?: string[];
  /** Optional destination stream (tests / custom sinks). Ignored when pretty printing. */
  destination?: pino.DestinationStream;
}

/**
 * PRC-L353 — secrets/credentials that must never reach log sinks.
 * Covers top-level and one-level-nested fields plus request header shapes.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'password',
  'token',
  'otp',
  'secret',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.token',
  '*.otp',
  '*.secret',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
];

/**
 * Creates a configured Pino logger with structured JSON output,
 * tenant context, request ID, and correlation ID support.
 *
 * Log level is determined by (in priority order):
 * 1. Explicit `level` option
 * 2. LOG_LEVEL environment variable
 * 3. Default: 'info'
 *
 * Pretty printing is enabled when:
 * 1. Explicit `pretty` option is true
 * 2. NODE_ENV is 'development' (and pretty is not explicitly false)
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const {
    name,
    level = process.env['LOG_LEVEL'] || 'info',
    context = {},
    pretty,
    redactPaths = [],
    destination,
  } = options;

  const isDevelopment = process.env['NODE_ENV'] === 'development';
  const usePretty = pretty ?? isDevelopment;

  const pinoOptions: LoggerOptions = {
    level,
    ...(name && { name }),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...DEFAULT_REDACT_PATHS, ...redactPaths], censor: '[Redacted]' },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    ...(usePretty && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
  };

  const bindings: Record<string, unknown> = {};

  if (context.tenantId) {
    bindings['tenant_id'] = context.tenantId;
  }
  if (context.requestId) {
    bindings['request_id'] = context.requestId;
  }
  if (context.correlationId) {
    bindings['correlation_id'] = context.correlationId;
  }

  // Add any additional context fields
  for (const [key, value] of Object.entries(context)) {
    if (!['tenantId', 'requestId', 'correlationId'].includes(key) && value !== undefined) {
      bindings[key] = value;
    }
  }

  const logger = destination && !usePretty ? pino(pinoOptions, destination) : pino(pinoOptions);

  // Return a child logger with context bindings if any exist
  if (Object.keys(bindings).length > 0) {
    return logger.child(bindings);
  }

  return logger;
}
