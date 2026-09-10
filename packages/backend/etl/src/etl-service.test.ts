/**
 * ETL Service Unit Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import type { CreatePipelineInput } from './schemas.js';

describe('ETLService', () => {
  let service: ETLService;
  let repository: InMemoryPipelineRepository;
  const tenantId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    repository = new InMemoryPipelineRepository();
    service = new ETLService(repository, {
      defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
    });
  });

  const validPipelineInput: CreatePipelineInput = {
    name: 'Test Pipeline',
    description: 'A test ETL pipeline',
    source: {
      type: 'csv',
      fileContent: 'name,age\nJohn,30\nJane,25',
      hasHeader: true,
    },
    destination: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      username: 'user',
      password: 'pass',
      table: 'users',
    },
    fieldMappings: [
      { sourceField: 'name', destinationField: 'full_name' },
      {
        sourceField: 'age',
        destinationField: 'age',
        transformation: 'type_cast',
        transformConfig: { targetType: 'integer' },
      },
    ],
  };

  describe('createPipeline', () => {
    it('should create a pipeline with valid input', async () => {
      const pipeline = await service.createPipeline(tenantId, validPipelineInput);

      expect(pipeline.id).toBeDefined();
      expect(pipeline.tenantId).toBe(tenantId);
      expect(pipeline.name).toBe('Test Pipeline');
      expect(pipeline.description).toBe('A test ETL pipeline');
      expect(pipeline.source.type).toBe('csv');
      expect(pipeline.destination.type).toBe('postgresql');
      expect(pipeline.fieldMappings).toHaveLength(2);
      expect(pipeline.enabled).toBe(true);
      expect(pipeline.retryPolicy).toEqual({ maxRetries: 3, backoffMs: 1000 });
    });

    it('should use custom retry policy when provided', async () => {
      const input = {
        ...validPipelineInput,
        retryPolicy: { maxRetries: 5, backoffMs: 2000 },
      };

      const pipeline = await service.createPipeline(tenantId, input);

      expect(pipeline.retryPolicy).toEqual({ maxRetries: 5, backoffMs: 2000 });
    });

    it('should set schedule when provided', async () => {
      const input = {
        ...validPipelineInput,
        schedule: '0 */6 * * *',
      };

      const pipeline = await service.createPipeline(tenantId, input);

      expect(pipeline.schedule).toBe('0 */6 * * *');
    });
  });

  describe('updatePipeline', () => {
    it('should update pipeline name', async () => {
      const pipeline = await service.createPipeline(tenantId, validPipelineInput);
      const updated = await service.updatePipeline(tenantId, pipeline.id, {
        name: 'Updated Pipeline',
      });

      expect(updated.name).toBe('Updated Pipeline');
      expect(updated.description).toBe('A test ETL pipeline');
    });

    it('should throw NotFoundError for non-existent pipeline', async () => {
      await expect(
        service.updatePipeline(tenantId, '00000000-0000-4000-8000-000000000000', { name: 'X' }),
      ).rejects.toThrow('Pipeline not found');
    });

    it('should throw NotFoundError for wrong tenant', async () => {
      const pipeline = await service.createPipeline(tenantId, validPipelineInput);
      const otherTenant = '660e8400-e29b-41d4-a716-446655440000';

      await expect(service.updatePipeline(otherTenant, pipeline.id, { name: 'X' })).rejects.toThrow(
        'Pipeline not found',
      );
    });
  });

  describe('deletePipeline', () => {
    it('should delete an existing pipeline', async () => {
      const pipeline = await service.createPipeline(tenantId, validPipelineInput);
      await service.deletePipeline(tenantId, pipeline.id);

      await expect(service.getPipeline(tenantId, pipeline.id)).rejects.toThrow(
        'Pipeline not found',
      );
    });

    it('should throw NotFoundError for non-existent pipeline', async () => {
      await expect(
        service.deletePipeline(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow('Pipeline not found');
    });
  });

  describe('getPipeline', () => {
    it('should return a pipeline by ID', async () => {
      const created = await service.createPipeline(tenantId, validPipelineInput);
      const fetched = await service.getPipeline(tenantId, created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe('Test Pipeline');
    });

    it('should throw NotFoundError for non-existent pipeline', async () => {
      await expect(
        service.getPipeline(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow('Pipeline not found');
    });
  });

  describe('listPipelines', () => {
    it('should list pipelines for a tenant', async () => {
      await service.createPipeline(tenantId, validPipelineInput);
      await service.createPipeline(tenantId, { ...validPipelineInput, name: 'Second Pipeline' });

      const result = await service.listPipelines(tenantId, {}, 1, 20);

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('should filter by search term', async () => {
      await service.createPipeline(tenantId, validPipelineInput);
      await service.createPipeline(tenantId, { ...validPipelineInput, name: 'Import Students' });

      const result = await service.listPipelines(tenantId, { search: 'student' }, 1, 20);

      expect(result.total).toBe(1);
      expect(result.data[0]!.name).toBe('Import Students');
    });

    it('should filter by enabled status', async () => {
      await service.createPipeline(tenantId, validPipelineInput);
      await service.createPipeline(tenantId, {
        ...validPipelineInput,
        name: 'Disabled',
        enabled: false,
      });

      const result = await service.listPipelines(tenantId, { enabled: true }, 1, 20);

      expect(result.total).toBe(1);
      expect(result.data[0]!.name).toBe('Test Pipeline');
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createPipeline(tenantId, { ...validPipelineInput, name: `Pipeline ${i}` });
      }

      const page1 = await service.listPipelines(tenantId, {}, 1, 2);
      const page2 = await service.listPipelines(tenantId, {}, 2, 2);

      expect(page1.data).toHaveLength(2);
      expect(page2.data).toHaveLength(2);
      expect(page1.total).toBe(5);
    });
  });

  describe('executePipeline', () => {
    it('should execute a pipeline with CSV source', async () => {
      const pipeline = await service.createPipeline(tenantId, validPipelineInput);
      const execution = await service.executePipeline(tenantId, pipeline.id);

      expect(execution.id).toBeDefined();
      expect(execution.pipelineId).toBe(pipeline.id);
      expect(execution.status).toBe('completed');
      expect(execution.startedAt).toBeInstanceOf(Date);
      expect(execution.completedAt).toBeInstanceOf(Date);
    });

    it('should throw error for disabled pipeline', async () => {
      const pipeline = await service.createPipeline(tenantId, {
        ...validPipelineInput,
        enabled: false,
      });

      await expect(service.executePipeline(tenantId, pipeline.id)).rejects.toThrow(
        'Pipeline is disabled',
      );
    });

    it('should throw NotFoundError for non-existent pipeline', async () => {
      await expect(
        service.executePipeline(tenantId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow('Pipeline not found');
    });
  });
});
