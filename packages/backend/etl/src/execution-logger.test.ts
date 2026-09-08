/**
 * Execution Logger Unit Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionLogger, InMemoryLogSink } from './execution-logger.js';

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger;
  let sink: InMemoryLogSink;

  beforeEach(() => {
    sink = new InMemoryLogSink();
    logger = new ExecutionLogger(sink);
  });

  describe('logExecutionStart', () => {
    it('should log pipeline execution start', () => {
      logger.logExecutionStart('exec-1', 'pipe-1', 'tenant-1');

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('info');
      expect(sink.entries[0]!.phase).toBe('pipeline');
      expect(sink.entries[0]!.message).toContain('Pipeline execution started');
      expect(sink.entries[0]!.pipelineId).toBe('pipe-1');
      expect(sink.entries[0]!.executionId).toBe('exec-1');
      expect(sink.entries[0]!.tenantId).toBe('tenant-1');
    });

    it('should include retry attempt in message', () => {
      logger.logExecutionStart('exec-1', 'pipe-1', 'tenant-1', 2);

      expect(sink.entries[0]!.message).toContain('retry attempt 2');
    });
  });

  describe('logExtraction', () => {
    it('should log extraction results', () => {
      logger.logExtraction('exec-1', 'pipe-1', 'tenant-1', {
        sourceType: 'csv',
        extractedCount: 100,
        durationMs: 250,
      });

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('info');
      expect(sink.entries[0]!.phase).toBe('extraction');
      expect(sink.entries[0]!.message).toContain('100 rows');
      expect(sink.entries[0]!.message).toContain('csv');
      expect(sink.entries[0]!.message).toContain('250ms');
    });
  });

  describe('logTransformation', () => {
    it('should log transformation results at info level when no errors', () => {
      logger.logTransformation('exec-1', 'pipe-1', 'tenant-1', {
        transformedCount: 95,
        errorCount: 0,
        durationMs: 150,
      });

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('info');
      expect(sink.entries[0]!.phase).toBe('transformation');
      expect(sink.entries[0]!.message).toContain('95 rows');
    });

    it('should log at warn level when there are errors', () => {
      logger.logTransformation('exec-1', 'pipe-1', 'tenant-1', {
        transformedCount: 90,
        errorCount: 5,
        durationMs: 200,
        errors: [
          { row: 3, field: 'age', message: 'Invalid number' },
          { row: 7, field: 'email', message: 'Invalid format' },
        ],
      });

      // 1 summary + 2 row errors
      expect(sink.entries).toHaveLength(3);
      expect(sink.entries[0]!.level).toBe('warn');
      expect(sink.entries[1]!.level).toBe('error');
      expect(sink.entries[1]!.message).toContain('Row 3');
      expect(sink.entries[1]!.message).toContain('Invalid number');
      expect(sink.entries[2]!.message).toContain('Row 7');
    });
  });

  describe('logLoad', () => {
    it('should log load results at info level when no errors', () => {
      logger.logLoad('exec-1', 'pipe-1', 'tenant-1', {
        destinationType: 'postgresql',
        loadedCount: 95,
        errorCount: 0,
        durationMs: 500,
      });

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('info');
      expect(sink.entries[0]!.phase).toBe('load');
      expect(sink.entries[0]!.message).toContain('95 rows');
      expect(sink.entries[0]!.message).toContain('postgresql');
    });

    it('should log row-level errors', () => {
      logger.logLoad('exec-1', 'pipe-1', 'tenant-1', {
        destinationType: 'postgresql',
        loadedCount: 90,
        errorCount: 2,
        durationMs: 600,
        errors: [{ row: 5, field: null, message: 'Duplicate key violation' }],
      });

      expect(sink.entries).toHaveLength(2);
      expect(sink.entries[0]!.level).toBe('warn');
      expect(sink.entries[1]!.level).toBe('error');
      expect(sink.entries[1]!.message).toContain('Row 5');
      expect(sink.entries[1]!.message).toContain('Duplicate key violation');
    });
  });

  describe('logExecutionComplete', () => {
    it('should log completed execution summary', () => {
      const now = new Date();
      logger.logExecutionComplete({
        executionId: 'exec-1',
        pipelineId: 'pipe-1',
        tenantId: 'tenant-1',
        status: 'completed',
        startedAt: now,
        completedAt: new Date(now.getTime() + 1000),
        totalDurationMs: 1000,
        extraction: { sourceType: 'csv', extractedCount: 100, durationMs: 200 },
        transformation: { transformedCount: 95, errorCount: 5, durationMs: 300 },
        load: { destinationType: 'postgresql', loadedCount: 95, errorCount: 0, durationMs: 500 },
        retryAttempt: 0,
        totalErrors: 5,
      });

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('info');
      expect(sink.entries[0]!.message).toContain('completed');
      expect(sink.entries[0]!.message).toContain('1000ms');
    });

    it('should log failed execution at error level', () => {
      const now = new Date();
      logger.logExecutionComplete({
        executionId: 'exec-1',
        pipelineId: 'pipe-1',
        tenantId: 'tenant-1',
        status: 'failed',
        startedAt: now,
        completedAt: new Date(now.getTime() + 500),
        totalDurationMs: 500,
        extraction: null,
        transformation: null,
        load: null,
        retryAttempt: 2,
        totalErrors: 1,
      });

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('error');
      expect(sink.entries[0]!.message).toContain('failed');
    });
  });

  describe('logExecutionFailure', () => {
    it('should log execution failure with error message', () => {
      logger.logExecutionFailure('exec-1', 'pipe-1', 'tenant-1', 'Connection timeout', 1);

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.level).toBe('error');
      expect(sink.entries[0]!.phase).toBe('pipeline');
      expect(sink.entries[0]!.message).toContain('Connection timeout');
    });
  });

  describe('InMemoryLogSink', () => {
    it('should filter entries by phase', () => {
      logger.logExtraction('exec-1', 'pipe-1', 'tenant-1', {
        sourceType: 'csv',
        extractedCount: 10,
        durationMs: 100,
      });
      logger.logExecutionStart('exec-1', 'pipe-1', 'tenant-1');

      expect(sink.getByPhase('extraction')).toHaveLength(1);
      expect(sink.getByPhase('pipeline')).toHaveLength(1);
    });

    it('should filter entries by level', () => {
      logger.logExtraction('exec-1', 'pipe-1', 'tenant-1', {
        sourceType: 'csv',
        extractedCount: 10,
        durationMs: 100,
      });
      logger.logExecutionFailure('exec-1', 'pipe-1', 'tenant-1', 'Error');

      expect(sink.getByLevel('info')).toHaveLength(1);
      expect(sink.getByLevel('error')).toHaveLength(1);
    });

    it('should clear all entries', () => {
      logger.logExecutionStart('exec-1', 'pipe-1', 'tenant-1');
      sink.clear();
      expect(sink.entries).toHaveLength(0);
    });
  });
});
