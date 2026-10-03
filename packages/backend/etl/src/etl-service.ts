/**
 * ETL Service
 *
 * Core service for managing ETL pipelines, executing extractions,
 * transformations, and loads, and tracking execution history.
 * Supports scheduled execution, retry with exponential backoff,
 * structured execution logging, and Kafka event publishing.
 */
import { AppError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { defaultConnectorFactory, type ConnectorFactory } from './connectors/index.js';
import { ExecutionLogger, type LogSink } from './execution-logger.js';
import { buildExecutionLineage } from './lineage.js';
import {
  type PipelineEventPublisher,
  InMemoryEventPublisher,
  createPipelineEvent,
} from './pipeline-events.js';
import type { PipelineRepository, PipelineListFilter } from './pipeline-repository.js';
import {
  PipelineScheduler,
  isValidCronExpression,
  type SchedulerConfig,
} from './pipeline-scheduler.js';
import {
  RetryExecutor,
  TestableRetryExecutor,
  type AdminNotifier,
  InMemoryAdminNotifier,
} from './retry-executor.js';
import type {
  Pipeline,
  PipelineExecution,
  CreatePipelineInput,
  UpdatePipelineInput,
  RetryPolicy,
} from './schemas.js';
import { containsRedactedSecret, restoreRedactedSecrets } from './secret-redaction.js';
import { transformRows } from './transformations/index.js';

export interface ETLServiceConfig {
  /** Default retry policy for pipelines without explicit config */
  defaultRetryPolicy: RetryPolicy;
  /** Log sink for execution logging (optional, defaults to console) */
  logSink?: LogSink;
  /** Admin notifier for failure alerts (optional, defaults to in-memory) */
  adminNotifier?: AdminNotifier;
  /** Event publisher for Kafka events (optional, defaults to in-memory) */
  eventPublisher?: PipelineEventPublisher;
  /** Scheduler configuration (optional) */
  schedulerConfig?: Partial<SchedulerConfig>;
  /** Use testable retry executor (no actual sleep) - for testing */
  testMode?: boolean;
  /** PRC-M222: connector construction (defaults to the fail-closed production factory). */
  connectorFactory?: ConnectorFactory;
  /**
   * PRC-M225: a `running` execution older than this is treated as abandoned (crashed
   * process) and no longer blocks a new run. Default 6 hours.
   */
  runningExecutionStaleMs?: number;
}

/** Default abandonment window for `running` executions (PRC-M225). */
export const DEFAULT_RUNNING_EXECUTION_STALE_MS = 6 * 60 * 60 * 1000;

export class ETLService {
  private readonly logger: ExecutionLogger;
  private readonly retryExecutor: RetryExecutor;
  private readonly scheduler: PipelineScheduler;
  private readonly eventPublisher: PipelineEventPublisher;
  private readonly adminNotifier: AdminNotifier;
  /** Tenants whose durable pipeline schedules have been loaded into the in-process Map. */
  private readonly hydratedTenants = new Set<string>();
  /**
   * W1-ARCH-07: when false, HTTP `/execute` and new scheduled starts are refused.
   * In-flight work already past the gate continues until drained.
   */
  private acceptingWork = true;
  /** Promises for in-flight pipeline executions (API + scheduled). */
  private readonly inFlight = new Set<Promise<unknown>>();

  private readonly connectors: ConnectorFactory;
  constructor(
    private readonly repository: PipelineRepository,
    private readonly config: ETLServiceConfig,
  ) {
    this.connectors = config.connectorFactory ?? defaultConnectorFactory;
    this.adminNotifier = config.adminNotifier ?? new InMemoryAdminNotifier();
    this.logger = new ExecutionLogger(config.logSink);
    this.retryExecutor = config.testMode
      ? new TestableRetryExecutor(this.adminNotifier)
      : new RetryExecutor(this.adminNotifier);
    this.scheduler = new PipelineScheduler(config.schedulerConfig);
    this.eventPublisher = config.eventPublisher ?? new InMemoryEventPublisher();

    // Wire up scheduler to execute pipelines when due
    this.scheduler.onDue(async (entry) => {
      await this.executePipelineWithRetry(entry.tenantId, entry.pipelineId, true);
    });
  }

  /**
   * Get the pipeline scheduler instance.
   */
  getScheduler(): PipelineScheduler {
    return this.scheduler;
  }

  /** True until `stopAcceptingAndDrain()` refuses new executions. */
  isAcceptingWork(): boolean {
    return this.acceptingWork;
  }

  /** Count of tracked in-flight executions (tests / diagnostics). */
  getInFlightExecutionCount(): number {
    return this.inFlight.size;
  }

  /**
   * W1-ARCH-07: refuse new pipeline executions, stop the scheduler interval,
   * await in-flight API/scheduled runs, then drain any remaining tick.
   * Invoked from Fastify `onClose` before process-level DB/pool close.
   */
  async stopAcceptingAndDrain(): Promise<void> {
    this.acceptingWork = false;
    this.scheduler.stop();
    const pending = [...this.inFlight];
    await Promise.allSettled(pending);
    await this.scheduler.stopAndDrain();
  }

  /**
   * Gate + track a pipeline execution so shutdown can refuse new work and drain.
   */
  private async withExecutionGate<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.acceptingWork) {
      throw new AppError(
        'ETL service is shutting down and is not accepting new pipeline executions',
        'SERVICE_UNAVAILABLE',
        503,
      );
    }
    const work = fn();
    this.inFlight.add(work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(work);
    }
  }

  /**
   * Get the execution logger instance.
   */
  getLogger(): ExecutionLogger {
    return this.logger;
  }

  /**
   * Get the event publisher instance.
   */
  getEventPublisher(): PipelineEventPublisher {
    return this.eventPublisher;
  }

  /**
   * W2-JOB-05: rebuild in-process schedule Map from durable pipeline rows.
   * Tip PipelineScheduler keeps schedules only in memory — lost on restart.
   */
  async hydrateSchedules(tenantId: string): Promise<number> {
    const { data } = await this.repository.list(tenantId, { enabled: true }, 1, 10_000);
    let registered = 0;
    for (const pipeline of data) {
      if (pipeline.schedule && pipeline.enabled) {
        // PRC-M223: one poisoned row (e.g. legacy invalid cron) must not brick every
        // ETL endpoint for the tenant — skip and log it, keep hydrating the rest.
        try {
          this.scheduler.registerSchedule(pipeline.id, pipeline.tenantId, pipeline.schedule, true);
          registered += 1;
        } catch (error: unknown) {
          this.scheduler.unregisterSchedule(pipeline.id);
          this.logger.logScheduleSkipped(
            pipeline.id,
            pipeline.tenantId,
            error instanceof Error ? error.message : 'invalid schedule',
          );
        }
      } else {
        this.scheduler.unregisterSchedule(pipeline.id);
      }
    }
    this.hydratedTenants.add(tenantId);
    return registered;
  }

  /** Ensure schedules for a tenant are loaded once after process start. */
  private async ensureSchedulesHydrated(tenantId: string): Promise<void> {
    if (this.hydratedTenants.has(tenantId)) return;
    await this.hydrateSchedules(tenantId);
  }

  /**
   * Create a new pipeline definition.
   */
  /**
   * PRC-C003: validate source/destination connector config at create/update time so an
   * unsafe filePath (LFI) or non-public/non-https URL (SSRF) is rejected before it is ever
   * stored or executed. Connectors are also guarded at execute time (stored rows may predate
   * this check), but rejecting here gives the tenant immediate feedback and fails closed.
   */
  private async assertConnectorConfigSafe(input: {
    source: CreatePipelineInput['source'];
    destination: CreatePipelineInput['destination'];
  }): Promise<void> {
    const source = await this.connectors.createSource(input.source).validate();
    if (!source.valid) {
      throw new AppError(
        source.error ?? 'Invalid source configuration',
        'INVALID_SOURCE_CONFIG',
        400,
      );
    }
    const destination = await this.connectors.createDestination(input.destination).validate();
    if (!destination.valid) {
      throw new AppError(
        destination.error ?? 'Invalid destination configuration',
        'INVALID_DESTINATION_CONFIG',
        400,
      );
    }
  }

  async createPipeline(tenantId: string, input: CreatePipelineInput): Promise<Pipeline> {
    // PRC-H115: the redaction placeholder is never a valid credential.
    assertNoRedactedSecret(input.source, 'source');
    assertNoRedactedSecret(input.destination, 'destination');
    assertValidSchedule(input.schedule);
    await this.ensureSchedulesHydrated(tenantId);
    await this.assertConnectorConfigSafe(input);
    const now = new Date();
    const pipeline: Pipeline = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      source: input.source,
      destination: input.destination,
      fieldMappings: input.fieldMappings,
      schedule: input.schedule ?? null,
      retryPolicy: input.retryPolicy ?? this.config.defaultRetryPolicy,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.repository.create(pipeline);

    // Register schedule if provided
    if (created.schedule && created.enabled) {
      const entry = this.scheduler.registerSchedule(created.id, tenantId, created.schedule, true);
      await this.eventPublisher.publish(
        createPipelineEvent('pipeline.schedule.registered', tenantId, created.id, {
          pipelineName: created.name,
          cronExpression: created.schedule,
          nextRunAt: entry.nextRunAt,
        }),
      );
    }

    return created;
  }

  /**
   * Update an existing pipeline definition.
   */
  async updatePipeline(
    tenantId: string,
    pipelineId: string,
    input: UpdatePipelineInput,
  ): Promise<Pipeline> {
    // PRC-M223: reject an invalid cron before anything is written.
    assertValidSchedule(input.schedule);
    await this.ensureSchedulesHydrated(tenantId);
    const existing = await this.repository.findById(pipelineId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Pipeline not found: ${pipelineId}`);
    }

    // PRC-C003: validate any connector config being changed so a PATCH cannot store an unsafe
    // filePath (LFI) or non-public/non-https URL (SSRF) that bypassed create-time checks.
    if (input.source !== undefined || input.destination !== undefined) {
      await this.assertConnectorConfigSafe({
        source: input.source ?? existing.source,
        destination: input.destination ?? existing.destination,
      });
    }

    const updates: Partial<Pipeline> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description ?? null;
    // PRC-H115: clients echo the redaction placeholder for unchanged secrets;
    // keep the stored value, and reject placeholders with nothing to restore.
    if (input.source !== undefined) {
      updates.source = restoreRedactedSecrets(input.source, existing.source);
      assertNoRedactedSecret(updates.source, 'source');
    }
    if (input.destination !== undefined) {
      updates.destination = restoreRedactedSecrets(input.destination, existing.destination);
      assertNoRedactedSecret(updates.destination, 'destination');
    }
    if (input.fieldMappings !== undefined) updates.fieldMappings = input.fieldMappings;
    if (input.schedule !== undefined) updates.schedule = input.schedule ?? null;
    if (input.retryPolicy !== undefined) updates.retryPolicy = input.retryPolicy;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    const updated = await this.repository.update(pipelineId, tenantId, updates);

    // Update schedule registration
    const effectiveSchedule = updated.schedule;
    if (effectiveSchedule && updated.enabled) {
      const entry = this.scheduler.registerSchedule(updated.id, tenantId, effectiveSchedule, true);
      await this.eventPublisher.publish(
        createPipelineEvent('pipeline.schedule.registered', tenantId, updated.id, {
          pipelineName: updated.name,
          cronExpression: effectiveSchedule,
          nextRunAt: entry.nextRunAt,
        }),
      );
    } else {
      this.scheduler.unregisterSchedule(updated.id);
      if (existing.schedule) {
        await this.eventPublisher.publish(
          createPipelineEvent('pipeline.schedule.removed', tenantId, updated.id, {
            pipelineName: updated.name,
          }),
        );
      }
    }

    return updated;
  }

  /**
   * Delete a pipeline definition.
   */
  async deletePipeline(tenantId: string, pipelineId: string): Promise<void> {
    await this.ensureSchedulesHydrated(tenantId);
    const existing = await this.repository.findById(pipelineId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Pipeline not found: ${pipelineId}`);
    }

    // Remove schedule
    this.scheduler.unregisterSchedule(pipelineId);
    if (existing.schedule) {
      await this.eventPublisher.publish(
        createPipelineEvent('pipeline.schedule.removed', tenantId, pipelineId, {
          pipelineName: existing.name,
        }),
      );
    }

    await this.repository.delete(pipelineId, tenantId);
  }

  /**
   * Get a pipeline by ID.
   */
  async getPipeline(tenantId: string, pipelineId: string): Promise<Pipeline> {
    const pipeline = await this.repository.findById(pipelineId, tenantId);
    if (!pipeline) {
      throw new NotFoundError(`Pipeline not found: ${pipelineId}`);
    }
    return pipeline;
  }

  /**
   * List pipelines with filtering and pagination.
   */
  async listPipelines(
    tenantId: string,
    filter: PipelineListFilter,
    page: number,
    pageSize: number,
  ) {
    await this.ensureSchedulesHydrated(tenantId);
    return this.repository.list(tenantId, filter, page, pageSize);
  }

  /**
   * Execute a pipeline: extract → transform → load.
   * This is the basic execution without retry logic.
   * W1-ARCH-07: gated — refused after `stopAcceptingAndDrain()`.
   */
  async executePipeline(tenantId: string, pipelineId: string): Promise<PipelineExecution> {
    return this.withExecutionGate(() => this.executePipelineUngated(tenantId, pipelineId));
  }

  private async executePipelineUngated(
    tenantId: string,
    pipelineId: string,
  ): Promise<PipelineExecution> {
    await this.ensureSchedulesHydrated(tenantId);
    const pipeline = await this.getPipeline(tenantId, pipelineId);

    if (!pipeline.enabled) {
      throw new AppError('Pipeline is disabled', 'PIPELINE_DISABLED', 400);
    }

    const execution = await this.startExecution(pipeline, tenantId);
    return this.runPipelineExecution(pipeline, tenantId, 0, false, execution);
  }

  /**
   * PRC-M225: create the single run row for this execution (shared by every retry
   * attempt). Fails with 409 when the pipeline already has a running execution.
   */
  private async startExecution(pipeline: Pipeline, tenantId: string): Promise<PipelineExecution> {
    const execution: PipelineExecution = {
      id: uuidv4(),
      pipelineId: pipeline.id,
      tenantId,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      extractedCount: 0,
      transformedCount: 0,
      loadedCount: 0,
      errorCount: 0,
      errors: [],
      lineage: buildExecutionLineage(pipeline),
    };
    const staleBefore = new Date(
      Date.now() - (this.config.runningExecutionStaleMs ?? DEFAULT_RUNNING_EXECUTION_STALE_MS),
    );
    const started = await this.repository.createExecutionIfIdle(execution, staleBefore);
    if (!started) {
      throw new ConflictError(`Pipeline ${pipeline.id} already has a running execution`);
    }
    return execution;
  }

  /**
   * Execute a pipeline with retry logic based on its configured retry policy.
   * Publishes events and notifies administrators on final failure.
   * W1-ARCH-07: gated — refused after `stopAcceptingAndDrain()`.
   */
  async executePipelineWithRetry(
    tenantId: string,
    pipelineId: string,
    scheduledExecution: boolean = false,
  ): Promise<PipelineExecution> {
    return this.withExecutionGate(() =>
      this.executePipelineWithRetryUngated(tenantId, pipelineId, scheduledExecution),
    );
  }

  private async executePipelineWithRetryUngated(
    tenantId: string,
    pipelineId: string,
    scheduledExecution: boolean,
  ): Promise<PipelineExecution> {
    await this.ensureSchedulesHydrated(tenantId);
    const pipeline = await this.getPipeline(tenantId, pipelineId);

    if (!pipeline.enabled) {
      throw new AppError('Pipeline is disabled', 'PIPELINE_DISABLED', 400);
    }

    // PRC-M225: one run row for the whole retry sequence; 409 if one is running.
    const execution = await this.startExecution(pipeline, tenantId);
    const executionId = execution.id;

    try {
      return await this.runWithRetries(pipeline, tenantId, scheduledExecution, execution);
    } finally {
      // PRC-M225: retry bookkeeping is per run; drop it once the run is settled.
      this.retryExecutor.clearState(executionId);
    }
  }

  private async runWithRetries(
    pipeline: Pipeline,
    tenantId: string,
    scheduledExecution: boolean,
    execution: PipelineExecution,
  ): Promise<PipelineExecution> {
    const pipelineId = pipeline.id;
    const executionId = execution.id;

    // Publish execution started event
    await this.eventPublisher.publish(
      createPipelineEvent(
        'pipeline.execution.started',
        tenantId,
        pipelineId,
        {
          pipelineName: pipeline.name,
          attempt: 0,
          scheduledExecution,
        } satisfies Record<string, unknown>,
        executionId,
      ),
    );

    const retryResult = await this.retryExecutor.executeWithRetry(
      pipelineId,
      executionId,
      tenantId,
      pipeline.name,
      pipeline.retryPolicy,
      async (attempt: number) => {
        if (attempt > 0) {
          // Publish retrying event
          await this.eventPublisher.publish(
            createPipelineEvent(
              'pipeline.execution.retrying',
              tenantId,
              pipelineId,
              {
                pipelineName: pipeline.name,
                attempt,
                maxRetries: pipeline.retryPolicy.maxRetries,
                lastError: this.retryExecutor.getRetryState(executionId)?.lastError ?? 'Unknown',
              } satisfies Record<string, unknown>,
              executionId,
            ),
          );
        }

        return this.runPipelineExecution(
          pipeline,
          tenantId,
          attempt,
          scheduledExecution,
          execution,
        );
      },
    );

    if (retryResult.success && retryResult.result) {
      // Publish completion event
      await this.eventPublisher.publish(
        createPipelineEvent(
          'pipeline.execution.completed',
          tenantId,
          pipelineId,
          {
            pipelineName: pipeline.name,
            extractedCount: retryResult.result.extractedCount,
            transformedCount: retryResult.result.transformedCount,
            loadedCount: retryResult.result.loadedCount,
            errorCount: retryResult.result.errorCount,
            durationMs: retryResult.result.completedAt
              ? retryResult.result.completedAt.getTime() - retryResult.result.startedAt.getTime()
              : 0,
          } satisfies Record<string, unknown>,
          executionId,
        ),
      );

      return retryResult.result;
    }

    // All retries exhausted - publish failure event
    await this.eventPublisher.publish(
      createPipelineEvent(
        'pipeline.execution.failed',
        tenantId,
        pipelineId,
        {
          pipelineName: pipeline.name,
          error: retryResult.lastError ?? 'Unknown error',
          attempt: retryResult.attempts,
          retriesExhausted: true,
        } satisfies Record<string, unknown>,
        executionId,
      ),
    );

    // PRC-M225: settle the same run row (no extra row per attempt / on exhaustion).
    const failedExecution: PipelineExecution = {
      ...execution,
      status: 'failed',
      completedAt: new Date(),
      errorCount: 1,
      errors: [
        {
          row: -1,
          field: null,
          message: `Pipeline failed after ${retryResult.attempts} attempts: ${retryResult.lastError ?? 'unknown error'}`,
          data: null,
        },
      ],
    };

    await this.repository.updateExecution(executionId, failedExecution);
    return failedExecution;
  }

  /**
   * Internal: Run a single pipeline execution attempt.
   */
  private async runPipelineExecution(
    pipeline: Pipeline,
    tenantId: string,
    attempt: number,
    _scheduledExecution: boolean,
    execution: PipelineExecution,
  ): Promise<PipelineExecution> {
    const executionId = execution.id;
    const startedAt = execution.startedAt;

    // Log execution start
    this.logger.logExecutionStart(executionId, pipeline.id, tenantId, attempt);

    // PRC-M225: each attempt reuses the run row; reset per-attempt counters.
    execution.status = 'running';
    execution.completedAt = null;
    execution.extractedCount = 0;
    execution.transformedCount = 0;
    execution.loadedCount = 0;
    execution.errorCount = 0;
    execution.errors = [];
    try {
      // PRC-M222: build + validate both connectors before touching any data, so an
      // invalid / unimplemented config fails the run instead of "succeeding".
      const sourceConnector = this.connectors.createSource(pipeline.source);
      const destConnector = this.connectors.createDestination(pipeline.destination);
      const [sourceCheck, destCheck] = await Promise.all([
        sourceConnector.validate(),
        destConnector.validate(),
      ]);
      if (!sourceCheck.valid) {
        throw new AppError(
          sourceCheck.error ?? 'Invalid source configuration',
          'INVALID_SOURCE_CONFIG',
          400,
        );
      }
      if (!destCheck.valid) {
        throw new AppError(
          destCheck.error ?? 'Invalid destination configuration',
          'INVALID_DESTINATION_CONFIG',
          400,
        );
      }

      // 1. Extract
      const extractStart = Date.now();
      const extractionResult = await sourceConnector.extract();
      const extractDuration = Date.now() - extractStart;
      execution.extractedCount = extractionResult.totalCount;

      // Log extraction results
      this.logger.logExtraction(executionId, pipeline.id, tenantId, {
        sourceType: pipeline.source.type,
        extractedCount: extractionResult.totalCount,
        durationMs: extractDuration,
      });

      // 2. Transform
      const transformStart = Date.now();
      const transformResult = transformRows(extractionResult.rows, pipeline.fieldMappings);
      const transformDuration = Date.now() - transformStart;
      execution.transformedCount = transformResult.transformedCount;

      // Map transform errors to execution errors
      const transformErrors = transformResult.errors.map((err) => ({
        row: err.row,
        field: err.field,
        message: err.message,
        data: null as Record<string, unknown> | null,
      }));

      for (const err of transformErrors) {
        execution.errors.push(err);
      }

      // Log transformation results
      this.logger.logTransformation(executionId, pipeline.id, tenantId, {
        transformedCount: transformResult.transformedCount,
        errorCount: transformResult.errors.length,
        durationMs: transformDuration,
        errors: transformResult.errors.map((e) => ({
          row: e.row,
          field: e.field,
          message: e.message,
        })),
      });

      // 3. Load
      const loadStart = Date.now();
      // PRC-M225: run id is the idempotency key, stable across retry attempts.
      const loadResult = await destConnector.load(transformResult.rows, {
        idempotencyKey: executionId,
      });
      const loadDuration = Date.now() - loadStart;
      execution.loadedCount = loadResult.loadedCount;

      // Map load errors to execution errors
      // PRC-M224: row index + message only; row values are never stored or logged.
      for (const err of loadResult.errors) {
        execution.errors.push({
          row: err.row,
          field: null,
          message: err.message,
          data: null,
        });
      }

      // Log load results
      this.logger.logLoad(executionId, pipeline.id, tenantId, {
        destinationType: pipeline.destination.type,
        loadedCount: loadResult.loadedCount,
        errorCount: loadResult.errors.length,
        durationMs: loadDuration,
        errors: loadResult.errors.map((e) => ({
          row: e.row,
          field: null,
          message: e.message,
        })),
      });

      execution.errorCount = execution.errors.length;
      // PRC-M227: partial failure is visible in the run status.
      execution.status = execution.errorCount > 0 ? 'completed_with_errors' : 'completed';
      execution.completedAt = new Date();

      // Log execution summary
      const totalDuration = execution.completedAt.getTime() - startedAt.getTime();
      this.logger.logExecutionComplete({
        executionId,
        pipelineId: pipeline.id,
        tenantId,
        status: execution.status,
        startedAt,
        completedAt: execution.completedAt,
        totalDurationMs: totalDuration,
        extraction: {
          sourceType: pipeline.source.type,
          extractedCount: execution.extractedCount,
          durationMs: extractDuration,
        },
        transformation: {
          transformedCount: execution.transformedCount,
          errorCount: transformResult.errors.length,
          durationMs: transformDuration,
        },
        load: {
          destinationType: pipeline.destination.type,
          loadedCount: execution.loadedCount,
          errorCount: loadResult.errors.length,
          durationMs: loadDuration,
        },
        retryAttempt: attempt,
        totalErrors: execution.errorCount,
      });
    } catch (error: unknown) {
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.errorCount = 1;
      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
      execution.errors.push({
        row: -1,
        field: null,
        message: errorMessage,
        data: null,
      });

      // Log failure
      this.logger.logExecutionFailure(executionId, pipeline.id, tenantId, errorMessage, attempt);

      await this.repository.updateExecution(execution.id, execution);

      // Re-throw so retry executor can catch it
      throw error;
    }

    await this.repository.updateExecution(execution.id, execution);
    return execution;
  }

  /**
   * Start the pipeline scheduler.
   */
  startScheduler(): void {
    this.scheduler.start();
  }

  /**
   * Stop the pipeline scheduler (clears interval; does not await in-flight tick).
   * Process shutdown uses Fastify onClose → `stopAcceptingAndDrain()`.
   */
  stopScheduler(): void {
    this.scheduler.stop();
  }

  /**
   * Get an execution log by ID.
   */
  async getExecution(tenantId: string, executionId: string): Promise<PipelineExecution> {
    const execution = await this.repository.getExecution(executionId, tenantId);
    if (!execution) {
      throw new NotFoundError(`Execution not found: ${executionId}`);
    }
    return execution;
  }

  /**
   * List executions for a pipeline.
   */
  async listExecutions(tenantId: string, pipelineId: string, page: number, pageSize: number) {
    // Verify pipeline exists and belongs to tenant
    await this.getPipeline(tenantId, pipelineId);
    return this.repository.listExecutions(pipelineId, tenantId, page, pageSize);
  }
}

/** PRC-M223: schedules are validated (400) before persistence. */
function assertValidSchedule(schedule: string | null | undefined): void {
  if (schedule === undefined || schedule === null) return;
  if (!isValidCronExpression(schedule)) {
    throw new ValidationError('Invalid cron expression', [
      {
        field: 'schedule',
        rule: 'cron',
        message: 'Use a 5-field cron expression (minute hour day month weekday) or an alias',
      },
    ]);
  }
}

function assertNoRedactedSecret(config: unknown, field: 'source' | 'destination'): void {
  if (containsRedactedSecret(config)) {
    throw new ValidationError('Credential placeholder cannot be saved; enter the secret value.', [
      { field, rule: 'redacted', message: 'Redacted credential placeholder is not a valid value' },
    ]);
  }
}
