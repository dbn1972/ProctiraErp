/**
 * Hook Definition Helper
 *
 * Provides a type-safe way to define hook handlers that respond
 * to platform extension points (before-create, after-create, validation, etc.).
 */
import type { HookContext, HookResult, HookHandler } from '@proctira/backend-plugin';

/**
 * A hook definition linking an extension point to a handler function.
 */
export interface HookDefinition<TPayload = unknown, TResult = unknown> {
  /** The extension point ID to subscribe to (e.g., "student.after-create") */
  extensionPointId: string;
  /** Priority for execution order (lower = earlier, default 100) */
  priority: number;
  /** The handler function */
  handler: HookHandler<TPayload, TResult>;
}

/**
 * Define a hook handler for a platform extension point.
 *
 * @param extensionPointId - The extension point to subscribe to
 * @param handler - The handler function to execute
 * @param options - Optional configuration (priority)
 * @returns A hook definition
 *
 * @example
 * ```typescript
 * import { defineHook } from '@proctira/plugin-sdk';
 *
 * const onStudentCreate = defineHook(
 *   'student.after-create',
 *   async (payload, context) => {
 *     console.log(`Student created: ${payload.entityId}`);
 *     return { success: true, executionTimeMs: 5 };
 *   },
 *   { priority: 50 }
 * );
 * ```
 */
export function defineHook<TPayload = unknown, TResult = unknown>(
  extensionPointId: string,
  handler: HookHandler<TPayload, TResult>,
  options?: { priority?: number },
): HookDefinition<TPayload, TResult> {
  if (!extensionPointId) {
    throw new Error('extensionPointId is required for defineHook');
  }
  if (typeof handler !== 'function') {
    throw new Error('handler must be a function');
  }

  return {
    extensionPointId,
    priority: options?.priority ?? 100,
    handler,
  };
}
