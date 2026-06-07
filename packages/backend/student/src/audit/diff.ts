/**
 * Object Diff Utility
 *
 * Compares two objects and generates an array of AuditChange entries
 * representing the differences between them. Used to automatically
 * detect what fields changed during an update operation.
 *
 * Requirements:
 * - 6.6: Capture changed field, previous value, new value
 */

import type { AuditChange } from './types.js';

/**
 * Primitive value types that can be compared and stored in audit changes.
 */
type AuditableValue = string | number | boolean | null | undefined;

/**
 * A record of auditable values (flat object, no nested objects).
 */
export type AuditableRecord = Record<string, AuditableValue>;

/**
 * Fields to exclude from audit comparison by default.
 * These are typically metadata fields managed by the system.
 */
const DEFAULT_EXCLUDED_FIELDS = new Set(['updatedAt', 'createdAt']);

/**
 * Options for the diff function.
 */
export interface DiffOptions {
  /**
   * Fields to exclude from comparison.
   * Defaults to ['updatedAt', 'createdAt'].
   */
  excludeFields?: string[];

  /**
   * If true, only compare fields present in the newObj.
   * Useful for partial updates where only changed fields are provided.
   * Defaults to false (compare all fields from both objects).
   */
  partialComparison?: boolean;
}

/**
 * Normalizes a value for comparison and storage.
 * Converts undefined to null for consistent comparison.
 */
function normalizeValue(value: AuditableValue): string | number | boolean | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Compares two objects and returns an array of changes.
 *
 * For create operations: pass an empty object as oldObj
 * For delete operations: pass an empty object as newObj
 * For update operations: pass the before and after states
 *
 * @param oldObj - The previous state of the object
 * @param newObj - The new state of the object
 * @param options - Configuration options for the diff
 * @returns Array of AuditChange entries for fields that differ
 *
 * @example
 * ```ts
 * const changes = generateChanges(
 *   { name: 'John', age: 20 },
 *   { name: 'Jane', age: 20 }
 * );
 * // Returns: [{ field: 'name', oldValue: 'John', newValue: 'Jane' }]
 * ```
 */
export function generateChanges(
  oldObj: AuditableRecord,
  newObj: AuditableRecord,
  options: DiffOptions = {},
): AuditChange[] {
  const excludeFields = new Set(options.excludeFields ?? [...DEFAULT_EXCLUDED_FIELDS]);
  const partialComparison = options.partialComparison ?? false;

  const changes: AuditChange[] = [];

  // Determine which fields to compare
  const fieldsToCompare = new Set<string>();

  if (partialComparison) {
    // Only compare fields present in the new object
    for (const key of Object.keys(newObj)) {
      if (!excludeFields.has(key)) {
        fieldsToCompare.add(key);
      }
    }
  } else {
    // Compare all fields from both objects
    for (const key of Object.keys(oldObj)) {
      if (!excludeFields.has(key)) {
        fieldsToCompare.add(key);
      }
    }
    for (const key of Object.keys(newObj)) {
      if (!excludeFields.has(key)) {
        fieldsToCompare.add(key);
      }
    }
  }

  for (const field of fieldsToCompare) {
    const oldValue = normalizeValue(Object.hasOwn(oldObj, field) ? oldObj[field] : undefined);
    const newValue = normalizeValue(Object.hasOwn(newObj, field) ? newObj[field] : undefined);

    if (oldValue !== newValue) {
      changes.push({
        field,
        oldValue,
        newValue,
      });
    }
  }

  // Sort changes by field name for deterministic output
  changes.sort((a, b) => a.field.localeCompare(b.field));

  return changes;
}
