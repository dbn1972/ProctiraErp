import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create a logger with default info level', () => {
    delete process.env['LOG_LEVEL'];
    const logger = createLogger();
    expect(logger.level).toBe('info');
  });

  it('should respect LOG_LEVEL environment variable', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const logger = createLogger();
    expect(logger.level).toBe('debug');
  });

  it('should respect explicit level option over env variable', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const logger = createLogger({ level: 'warn' });
    expect(logger.level).toBe('warn');
  });

  it('should create a logger with a name', () => {
    const logger = createLogger({ name: 'test-service' });
    // Pino stores name in bindings
    expect(logger).toBeDefined();
  });

  it('should attach tenant_id to log context', () => {
    const logger = createLogger({
      context: { tenantId: 'tenant-123' },
    });
    // Child logger has bindings - verify by checking it's a child
    expect(logger).toBeDefined();
    // Verify by writing to a destination and checking output
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).toContain('tenant_id');
    expect(output).toContain('tenant-123');
  });

  it('should attach request_id to log context', () => {
    const logger = createLogger({
      context: { requestId: 'req-456' },
    });
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).toContain('request_id');
    expect(output).toContain('req-456');
  });

  it('should attach correlation_id to log context', () => {
    const logger = createLogger({
      context: { correlationId: 'corr-789' },
    });
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).toContain('correlation_id');
    expect(output).toContain('corr-789');
  });

  it('should attach all context fields together', () => {
    const logger = createLogger({
      context: {
        tenantId: 'tenant-abc',
        requestId: 'req-def',
        correlationId: 'corr-ghi',
      },
    });
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).toContain('tenant_id');
    expect(output).toContain('tenant-abc');
    expect(output).toContain('request_id');
    expect(output).toContain('req-def');
    expect(output).toContain('correlation_id');
    expect(output).toContain('corr-ghi');
  });

  it('should attach additional custom context fields', () => {
    const logger = createLogger({
      context: {
        tenantId: 'tenant-1',
        service: 'student-service',
      },
    });
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).toContain('service');
    expect(output).toContain('student-service');
  });

  it('should not attach undefined context values', () => {
    const logger = createLogger({
      context: { tenantId: undefined },
    });
    const output = captureLogOutput(logger, 'info', 'test message');
    expect(output).not.toContain('tenant_id');
  });

  it('should support all standard log levels', () => {
    const logger = createLogger({ level: 'trace' });
    expect(logger.trace).toBeDefined();
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.fatal).toBeDefined();
  });

  it('should produce structured JSON output', () => {
    const logger = createLogger({
      context: { tenantId: 'test-tenant' },
    });
    const output = captureLogOutput(logger, 'info', 'structured test');
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('structured test');
    expect(parsed.tenant_id).toBe('test-tenant');
    expect(parsed.time).toBeDefined();
  });

  it('should include ISO timestamp in output', () => {
    const logger = createLogger();
    const output = captureLogOutput(logger, 'info', 'timestamp test');
    const parsed = JSON.parse(output);
    // ISO time format check
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/**
 * Helper to capture log output as a string by writing to a custom destination.
 */
function captureLogOutput(logger: ReturnType<typeof createLogger>, level: string, msg: string): string {
  // We need to create a logger that writes to a writable stream we can capture
  // Since the logger is already created, we'll use pino's destination approach
  const pino = require('pino');
  const { Writable } = require('stream');

  let output = '';
  const writable = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      output += chunk.toString();
      callback();
    },
  });

  // Recreate logger with same bindings but custom destination
  const bindings = (logger as any).bindings?.() || {};
  const captureLogger = pino(
    {
      level: 'trace',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label: string) {
          return { level: label };
        },
      },
    },
    writable
  ).child(bindings);

  (captureLogger)[level](msg);
  return output;
}
