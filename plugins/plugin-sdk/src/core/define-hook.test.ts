/**
 * Tests for defineHook
 */
import { describe, it, expect } from 'vitest';
import { defineHook } from './define-hook.js';

describe('defineHook', () => {
  it('should create a hook definition with default priority', () => {
    const handler = async () => ({ success: true, executionTimeMs: 0 });
    const hook = defineHook('student.after-create', handler);

    expect(hook.extensionPointId).toBe('student.after-create');
    expect(hook.priority).toBe(100);
    expect(hook.handler).toBe(handler);
  });

  it('should accept custom priority', () => {
    const handler = async () => ({ success: true, executionTimeMs: 0 });
    const hook = defineHook('student.before-create', handler, { priority: 50 });

    expect(hook.priority).toBe(50);
  });

  it('should throw if extensionPointId is empty', () => {
    const handler = async () => ({ success: true, executionTimeMs: 0 });
    expect(() => defineHook('', handler)).toThrow('extensionPointId is required');
  });

  it('should throw if handler is not a function', () => {
    expect(() => defineHook('student.after-create', 'not-a-function' as any)).toThrow(
      'handler must be a function',
    );
  });
});
