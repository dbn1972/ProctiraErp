/**
 * Plugin Testing Harness
 *
 * Provides utilities for testing plugins in isolation:
 * - createTestHarness: Sets up a sandboxed environment for plugin testing
 * - mockHookContext: Creates mock hook contexts
 * - mockEventPayload: Creates mock domain event payloads
 * - assertHookResult: Validates hook handler results
 */

export { createTestHarness } from './test-harness.js';
export type { TestHarness, TestHarnessOptions } from './test-harness.js';

export { mockHookContext } from './mock-hook-context.js';
export { mockEventPayload } from './mock-event-payload.js';
export { assertHookResult, assertPluginManifest } from './assertions.js';
