import { describe, it, expect } from 'vitest';

import type { DomainEvent, TaskMessage, EventHandler, TaskHandler } from '../types';

describe('Event Types', () => {
  it('should create a valid DomainEvent', () => {
    const event: DomainEvent<{ name: string }> = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'tenant-001',
      type: 'student.enrolled',
      aggregateId: 'student-123',
      aggregateType: 'student',
      payload: { name: 'John Doe' },
      metadata: {
        timestamp: '2024-01-15T10:30:00.000Z',
        correlationId: 'corr-001',
        causationId: 'cause-001',
        userId: 'user-001',
      },
    };

    expect(event.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(event.tenantId).toBe('tenant-001');
    expect(event.type).toBe('student.enrolled');
    expect(event.aggregateId).toBe('student-123');
    expect(event.aggregateType).toBe('student');
    expect(event.payload.name).toBe('John Doe');
    expect(event.metadata.timestamp).toBe('2024-01-15T10:30:00.000Z');
    expect(event.metadata.correlationId).toBe('corr-001');
    expect(event.metadata.causationId).toBe('cause-001');
    expect(event.metadata.userId).toBe('user-001');
  });

  it('should create a valid TaskMessage', () => {
    const task: TaskMessage<{ reportId: string }> = {
      id: 'task-001',
      tenantId: 'tenant-001',
      type: 'report.generate',
      payload: { reportId: 'rpt-123' },
      options: {
        priority: 5,
        delay: 0,
        maxRetries: 3,
        retryCount: 0,
      },
    };

    expect(task.id).toBe('task-001');
    expect(task.tenantId).toBe('tenant-001');
    expect(task.type).toBe('report.generate');
    expect(task.payload.reportId).toBe('rpt-123');
    expect(task.options.priority).toBe(5);
    expect(task.options.delay).toBe(0);
    expect(task.options.maxRetries).toBe(3);
    expect(task.options.retryCount).toBe(0);
  });

  it('should type-check EventHandler', () => {
    const handler: EventHandler = async (event) => {
      expect(event.type).toBeDefined();
    };
    expect(handler).toBeDefined();
  });

  it('should type-check TaskHandler', () => {
    const handler: TaskHandler = async (task) => {
      expect(task.type).toBeDefined();
    };
    expect(handler).toBeDefined();
  });
});
