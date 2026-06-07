/**
 * In-Memory Pipeline Repository
 *
 * In-memory implementation of PipelineRepository for testing and development.
 */
import type { Pipeline, PipelineExecution } from './schemas.js';
import type { PipelineRepository, PipelineListFilter, PipelineListResult } from './pipeline-repository.js';

export class InMemoryPipelineRepository implements PipelineRepository {
  private pipelines: Map<string, Pipeline> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();

  async create(pipeline: Pipeline): Promise<Pipeline> {
    this.pipelines.set(pipeline.id, { ...pipeline });
    return { ...pipeline };
  }

  async update(id: string, tenantId: string, updates: Partial<Pipeline>): Promise<Pipeline> {
    const existing = this.pipelines.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Pipeline not found: ${id}`);
    }
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.pipelines.set(id, updated);
    return { ...updated };
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const existing = this.pipelines.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Pipeline not found: ${id}`);
    }
    this.pipelines.delete(id);
  }

  async findById(id: string, tenantId: string): Promise<Pipeline | null> {
    const pipeline = this.pipelines.get(id);
    if (!pipeline || pipeline.tenantId !== tenantId) {
      return null;
    }
    return { ...pipeline };
  }

  async list(
    tenantId: string,
    filter: PipelineListFilter,
    page: number,
    pageSize: number,
  ): Promise<PipelineListResult> {
    let results = Array.from(this.pipelines.values()).filter(
      (p) => p.tenantId === tenantId,
    );

    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          (p.description && p.description.toLowerCase().includes(search)),
      );
    }

    if (filter.enabled !== undefined) {
      results = results.filter((p) => p.enabled === filter.enabled);
    }

    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);

    return { data: data.map((p) => ({ ...p })), total };
  }

  async createExecution(execution: PipelineExecution): Promise<PipelineExecution> {
    this.executions.set(execution.id, { ...execution });
    return { ...execution };
  }

  async updateExecution(id: string, updates: Partial<PipelineExecution>): Promise<PipelineExecution> {
    const existing = this.executions.get(id);
    if (!existing) {
      throw new Error(`Execution not found: ${id}`);
    }
    const updated = { ...existing, ...updates };
    this.executions.set(id, updated);
    return { ...updated };
  }

  async getExecution(id: string, tenantId: string): Promise<PipelineExecution | null> {
    const execution = this.executions.get(id);
    if (!execution || execution.tenantId !== tenantId) {
      return null;
    }
    return { ...execution };
  }

  async listExecutions(
    pipelineId: string,
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: PipelineExecution[]; total: number }> {
    const results = Array.from(this.executions.values()).filter(
      (e) => e.pipelineId === pipelineId && e.tenantId === tenantId,
    );
    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);
    return { data: data.map((e) => ({ ...e })), total };
  }
}
