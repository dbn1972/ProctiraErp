/**
 * Pipeline Events Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventPublisher, createPipelineEvent } from './pipeline-events.js';

describe('InMemoryEventPublisher', () => {
  it('should publish and store events', async () => {
    const publisher = new InMemoryEventPublisher();

    await publisher.publish(
      createPipelineEvent(
        'pipeline.execution.started',
        'tenant-1',
        'pipe-1',
        {
          pipelineName: 'Test',
          attempt: 0,
          scheduledExecution: false,
        },
        'exec-1',
      ),
    );

    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]!.type).toBe('pipeline.execution.started');
    expect(publisher.events[0]!.tenantId).toBe('tenant-1');
    expect(publisher.events[0]!.pipelineId).toBe('pipe-1');
    expect(publisher.events[0]!.executionId).toBe('exec-1');
  });

  it('should filter events by type', async () => {
    const publisher = new InMemoryEventPublisher();

    await publisher.publish(
      createPipelineEvent('pipeline.execution.started', 'tenant-1', 'pipe-1', {}, 'exec-1'),
    );
    await publisher.publish(
      createPipelineEvent('pipeline.execution.completed', 'tenant-1', 'pipe-1', {}, 'exec-1'),
    );
    await publisher.publish(
      createPipelineEvent('pipeline.execution.failed', 'tenant-1', 'pipe-2', {}, 'exec-2'),
    );

    expect(publisher.getByType('pipeline.execution.started')).toHaveLength(1);
    expect(publisher.getByType('pipeline.execution.completed')).toHaveLength(1);
    expect(publisher.getByType('pipeline.execution.failed')).toHaveLength(1);
  });

  it('should filter events by pipeline', async () => {
    const publisher = new InMemoryEventPublisher();

    await publisher.publish(
      createPipelineEvent('pipeline.execution.started', 'tenant-1', 'pipe-1', {}, 'exec-1'),
    );
    await publisher.publish(
      createPipelineEvent('pipeline.execution.completed', 'tenant-1', 'pipe-1', {}, 'exec-1'),
    );
    await publisher.publish(
      createPipelineEvent('pipeline.execution.started', 'tenant-1', 'pipe-2', {}, 'exec-2'),
    );

    expect(publisher.getByPipeline('pipe-1')).toHaveLength(2);
    expect(publisher.getByPipeline('pipe-2')).toHaveLength(1);
  });

  it('should clear all events', async () => {
    const publisher = new InMemoryEventPublisher();

    await publisher.publish(
      createPipelineEvent('pipeline.execution.started', 'tenant-1', 'pipe-1', {}),
    );
    publisher.clear();

    expect(publisher.events).toHaveLength(0);
  });
});

describe('createPipelineEvent', () => {
  it('should create event with all fields', () => {
    const event = createPipelineEvent(
      'pipeline.execution.started',
      'tenant-1',
      'pipe-1',
      { pipelineName: 'Test', attempt: 0 },
      'exec-1',
    );

    expect(event.type).toBe('pipeline.execution.started');
    expect(event.tenantId).toBe('tenant-1');
    expect(event.pipelineId).toBe('pipe-1');
    expect(event.executionId).toBe('exec-1');
    expect(event.payload).toEqual({ pipelineName: 'Test', attempt: 0 });
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('should create event without executionId', () => {
    const event = createPipelineEvent('pipeline.schedule.registered', 'tenant-1', 'pipe-1', {
      cronExpression: '@hourly',
    });

    expect(event.executionId).toBeUndefined();
  });
});
