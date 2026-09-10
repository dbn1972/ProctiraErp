/**
 * Execution Logger
 *
 * Provides structured logging for ETL pipeline executions.
 * Logs extraction counts, transformation results, load counts,
 * and row-level errors as required by Requirement 14.3.
 */

export interface ExecutionLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  phase: 'extraction' | 'transformation' | 'load' | 'pipeline';
  pipelineId: string;
  executionId: string;
  tenantId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractionLogData {
  sourceType: string;
  extractedCount: number;
  durationMs: number;
}

export interface TransformationLogData {
  transformedCount: number;
  errorCount: number;
  durationMs: number;
  errors?: RowError[];
}

export interface LoadLogData {
  destinationType: string;
  loadedCount: number;
  errorCount: number;
  durationMs: number;
  errors?: RowError[];
}

export interface RowError {
  row: number;
  field: string | null;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface ExecutionSummary {
  executionId: string;
  pipelineId: string;
  tenantId: string;
  status: 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date;
  totalDurationMs: number;
  extraction: ExtractionLogData | null;
  transformation: TransformationLogData | null;
  load: LoadLogData | null;
  retryAttempt: number;
  totalErrors: number;
}

/**
 * Logger interface that consumers can implement (e.g., Pino, console, etc.)
 */
export interface LogSink {
  info(entry: ExecutionLogEntry): void;
  warn(entry: ExecutionLogEntry): void;
  error(entry: ExecutionLogEntry): void;
}

/**
 * Default console-based log sink for development/testing.
 */
export class ConsoleLogSink implements LogSink {
  info(entry: ExecutionLogEntry): void {
    console.log(`[ETL][${entry.phase}][INFO] ${entry.message}`, entry.metadata ?? '');
  }

  warn(entry: ExecutionLogEntry): void {
    console.warn(`[ETL][${entry.phase}][WARN] ${entry.message}`, entry.metadata ?? '');
  }

  error(entry: ExecutionLogEntry): void {
    console.error(`[ETL][${entry.phase}][ERROR] ${entry.message}`, entry.metadata ?? '');
  }
}

/**
 * In-memory log sink for testing - stores all log entries.
 */
export class InMemoryLogSink implements LogSink {
  public entries: ExecutionLogEntry[] = [];

  info(entry: ExecutionLogEntry): void {
    this.entries.push(entry);
  }

  warn(entry: ExecutionLogEntry): void {
    this.entries.push(entry);
  }

  error(entry: ExecutionLogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries = [];
  }

  getByPhase(phase: ExecutionLogEntry['phase']): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.phase === phase);
  }

  getByLevel(level: ExecutionLogEntry['level']): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }
}

/**
 * ExecutionLogger provides structured logging for each phase of pipeline execution.
 */
export class ExecutionLogger {
  private readonly sink: LogSink;
  private summaries: Map<string, ExecutionSummary> = new Map();

  constructor(sink?: LogSink) {
    this.sink = sink ?? new ConsoleLogSink();
  }

  /**
   * Log the start of a pipeline execution.
   */
  logExecutionStart(
    executionId: string,
    pipelineId: string,
    tenantId: string,
    retryAttempt: number = 0,
  ): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level: 'info',
      phase: 'pipeline',
      pipelineId,
      executionId,
      tenantId,
      message: `Pipeline execution started${retryAttempt > 0 ? ` (retry attempt ${retryAttempt})` : ''}`,
      metadata: { retryAttempt },
    };
    this.sink.info(entry);
  }

  /**
   * Log extraction phase results.
   */
  logExtraction(
    executionId: string,
    pipelineId: string,
    tenantId: string,
    data: ExtractionLogData,
  ): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level: 'info',
      phase: 'extraction',
      pipelineId,
      executionId,
      tenantId,
      message: `Extracted ${data.extractedCount} rows from ${data.sourceType} in ${data.durationMs}ms`,
      metadata: { ...data },
    };
    this.sink.info(entry);
  }

  /**
   * Log transformation phase results.
   */
  logTransformation(
    executionId: string,
    pipelineId: string,
    tenantId: string,
    data: TransformationLogData,
  ): void {
    const level = data.errorCount > 0 ? 'warn' : 'info';
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level,
      phase: 'transformation',
      pipelineId,
      executionId,
      tenantId,
      message: `Transformed ${data.transformedCount} rows with ${data.errorCount} errors in ${data.durationMs}ms`,
      metadata: {
        transformedCount: data.transformedCount,
        errorCount: data.errorCount,
        durationMs: data.durationMs,
      },
    };

    if (level === 'warn') {
      this.sink.warn(entry);
    } else {
      this.sink.info(entry);
    }

    // Log individual row errors
    if (data.errors && data.errors.length > 0) {
      for (const err of data.errors) {
        const errorEntry: ExecutionLogEntry = {
          timestamp: new Date(),
          level: 'error',
          phase: 'transformation',
          pipelineId,
          executionId,
          tenantId,
          message: `Row ${err.row}: ${err.message}${err.field ? ` (field: ${err.field})` : ''}`,
          metadata: { row: err.row, field: err.field, data: err.data },
        };
        this.sink.error(errorEntry);
      }
    }
  }

  /**
   * Log load phase results.
   */
  logLoad(executionId: string, pipelineId: string, tenantId: string, data: LoadLogData): void {
    const level = data.errorCount > 0 ? 'warn' : 'info';
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level,
      phase: 'load',
      pipelineId,
      executionId,
      tenantId,
      message: `Loaded ${data.loadedCount} rows to ${data.destinationType} with ${data.errorCount} errors in ${data.durationMs}ms`,
      metadata: {
        loadedCount: data.loadedCount,
        errorCount: data.errorCount,
        durationMs: data.durationMs,
        destinationType: data.destinationType,
      },
    };

    if (level === 'warn') {
      this.sink.warn(entry);
    } else {
      this.sink.info(entry);
    }

    // Log individual row errors
    if (data.errors && data.errors.length > 0) {
      for (const err of data.errors) {
        const errorEntry: ExecutionLogEntry = {
          timestamp: new Date(),
          level: 'error',
          phase: 'load',
          pipelineId,
          executionId,
          tenantId,
          message: `Row ${err.row}: ${err.message}`,
          metadata: { row: err.row, data: err.data },
        };
        this.sink.error(errorEntry);
      }
    }
  }

  /**
   * Log execution completion with summary.
   */
  logExecutionComplete(summary: ExecutionSummary): void {
    this.summaries.set(summary.executionId, summary);

    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level: summary.status === 'failed' ? 'error' : 'info',
      phase: 'pipeline',
      pipelineId: summary.pipelineId,
      executionId: summary.executionId,
      tenantId: summary.tenantId,
      message: `Pipeline execution ${summary.status} in ${summary.totalDurationMs}ms (errors: ${summary.totalErrors})`,
      metadata: {
        status: summary.status,
        totalDurationMs: summary.totalDurationMs,
        extractedCount: summary.extraction?.extractedCount ?? 0,
        transformedCount: summary.transformation?.transformedCount ?? 0,
        loadedCount: summary.load?.loadedCount ?? 0,
        totalErrors: summary.totalErrors,
        retryAttempt: summary.retryAttempt,
      },
    };

    if (summary.status === 'failed') {
      this.sink.error(entry);
    } else {
      this.sink.info(entry);
    }
  }

  /**
   * Log a pipeline execution failure.
   */
  logExecutionFailure(
    executionId: string,
    pipelineId: string,
    tenantId: string,
    error: string,
    retryAttempt: number = 0,
  ): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date(),
      level: 'error',
      phase: 'pipeline',
      pipelineId,
      executionId,
      tenantId,
      message: `Pipeline execution failed: ${error}`,
      metadata: { retryAttempt },
    };
    this.sink.error(entry);
  }

  /**
   * Get execution summary by ID.
   */
  getSummary(executionId: string): ExecutionSummary | undefined {
    return this.summaries.get(executionId);
  }
}
