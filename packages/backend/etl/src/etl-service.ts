/**
 * ETL Service
 *
 * Core service for managing ETL pipelines, executing extractions,
 * transformations, and loads, and tracking execution history.
 * Supports scheduled execution, retry with exponential backoff,
 * structured execution logging, and Kafka event publishing.
 */
import { v4 as uuidv4 } from 'uuid';
import { AppError, NotFoundError } from '@proctira/common';

import type {
  Pipeline,
  PipelineExecution,
  CreatePipelineInput,
  UpdatePipelineInput,
  RetryPolicy,
} from './schemas.js';
import type { PipelineRepository, PipelineListFilter } from './pipeline-repository.js';
import { createSourceConnector, createDestinationConnector } from './connectors/index.js';
import { transformRows } from './transformations/index.js';
import { ExecutionLogger, type LogSink } from './execution-logger.js';
import { buildExecutionLineage } from './lineage.js';
import {
  RetryExecutor,
  TestableRetryExecutor,
  type AdminNotifier,
  InMemoryAdminNotifier,
} from './retry-executor.js';
import { PipelineScheduler, type SchedulerConfig } from './pipeline-scheduler.js';
import {
  type PipelineEventPublisher,
  InMemoryEventPublisher,
  createPipelineEvent,
} from './pipeline-events.js';

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
}

export class ETLService {
  private readonly logger: ExecutionLogger;
  private readonly retryExecutor: RetryExecutor;
  private readonly scheduler: PipelineScheduler;
  private readonly eventPublisher: PipelineEventPublisher;
  private readonly adminNotifier: AdminNotifier;

  constructor(
    private readonly repository: PipelineRepository,
    private readonly config: ETLServiceConfig,
  ) {
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
   * Create a new pipeline definition.
   */
  async createPipeline(tenantId: string, input: CreatePipelineInput): Promise<Pipeline> {
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
    const existing = await this.repository.findById(pipelineId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Pipeline not found: ${pipelineId}`);
    }

    const updates: Partial<Pipeline> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description ?? null;
    if (input.source !== undefined) updates.source = input.source;
    if (input.destination !== undefined) updates.destination = input.destination;
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
    return this.repository.list(tenantId, filter, page, pageSize);
  }

  /**
   * Execute a pipeline: extract → transform → load.
   * This is the basic execution without retry logic.
   */
  async executePipeline(tenantId: string, pipelineId: string): Promise<PipelineExecution> {
    const pipeline = await this.getPipeline(tenantId, pipelineId);

    if (!pipeline.enabled) {
      throw new AppError('Pipeline is disabled', 'PIPELINE_DISABLED', 400);
    }

    return this.runPipelineExecution(pipeline, tenantId, 0, false);
  }

  /**
   * Execute a pipeline with retry logic based on its configured retry policy.
   * Publishes events and notifies administrators on final failure.
   */
  async executePipelineWithRetry(
    tenantId: string,
    pipelineId: string,
    scheduledExecution: boolean = false,
  ): Promise<PipelineExecution> {
    const pipeline = await this.getPipeline(tenantId, pipelineId);

    if (!pipeline.enabled) {
      throw new AppError('Pipeline is disabled', 'PIPELINE_DISABLED', 400);
    }

    const executionId = uuidv4();

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

        return this.runPipelineExecution(pipeline, tenantId, attempt, scheduledExecution);
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

    // Create a failed execution record
    const failedExecution: PipelineExecution = {
      id: executionId,
      pipelineId,
      tenantId,
      status: 'failed',
      startedAt: new Date(),
      completedAt: new Date(),
      extractedCount: 0,
      transformedCount: 0,
      loadedCount: 0,
      errorCount: 1,
      errors: [
        {
          row: -1,
          field: null,
          message: `Pipeline failed after ${retryResult.attempts} attempts: ${retryResult.lastError}`,
          data: null,
        },
      ],
      lineage: buildExecutionLineage(pipeline),
    };

    await this.repository.createExecution(failedExecution);
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
  ): Promise<PipelineExecution> {
    const executionId = uuidv4();
    const startedAt = new Date();

    // Log execution start
    this.logger.logExecutionStart(executionId, pipeline.id, tenantId, attempt);

    // Create execution record (thin lineage breadcrumb — P2-WH / PRD-018)
    const execution: PipelineExecution = {
      id: executionId,
      pipelineId: pipeline.id,
      tenantId,
      status: 'running',
      startedAt,
      completedAt: null,
      extractedCount: 0,
      transformedCount: 0,
      loadedCount: 0,
      errorCount: 0,
      errors: [],
      lineage: buildExecutionLineage(pipeline),
    };

    await this.repository.createExecution(execution);

    try {
      // 1. Extract
      const extractStart = Date.now();
      const sourceConnector = createSourceConnector(pipeline.source);
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
      const destConnector = createDestinationConnector(pipeline.destination);
      const loadResult = await destConnector.load(transformResult.rows);
      const loadDuration = Date.now() - loadStart;
      execution.loadedCount = loadResult.loadedCount;

      // Map load errors to execution errors
      for (const err of loadResult.errors) {
        execution.errors.push({
          row: err.row,
          field: null,
          message: err.message,
          data: err.data,
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
          data: e.data,
        })),
      });

      execution.errorCount = execution.errors.length;
      execution.status = 'completed';
      execution.completedAt = new Date();

      // Log execution summary
      const totalDuration = execution.completedAt.getTime() - startedAt.getTime();
      this.logger.logExecutionComplete({
        executionId,
        pipelineId: pipeline.id,
        tenantId,
        status: 'completed',
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
   * Stop the pipeline scheduler.
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
