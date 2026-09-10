/**
 * Pipeline Repository Interface
 *
 * Defines the contract for pipeline persistence operations.
 * Implementations can use PostgreSQL, in-memory storage, etc.
 */
import type { Pipeline, PipelineExecution } from './schemas.js';

export interface PipelineListFilter {
  search?: string;
  enabled?: boolean;
}

export interface PipelineListResult {
  data: Pipeline[];
  total: number;
}

/**
 * Repository interface for pipeline CRUD operations.
 */
export interface PipelineRepository {
  create(pipeline: Pipeline): Promise<Pipeline>;
  update(id: string, tenantId: string, updates: Partial<Pipeline>): Promise<Pipeline>;
  delete(id: string, tenantId: string): Promise<void>;
  findById(id: string, tenantId: string): Promise<Pipeline | null>;
  list(
    tenantId: string,
    filter: PipelineListFilter,
    page: number,
    pageSize: number,
  ): Promise<PipelineListResult>;

  // Execution log operations
  createExecution(execution: PipelineExecution): Promise<PipelineExecution>;
  updateExecution(id: string, updates: Partial<PipelineExecution>): Promise<PipelineExecution>;
  getExecution(id: string, tenantId: string): Promise<PipelineExecution | null>;
  listExecutions(
    pipelineId: string,
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: PipelineExecution[]; total: number }>;
}
