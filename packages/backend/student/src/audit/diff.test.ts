/**
 * Unit tests for the diff utility (generateChanges).
 *
 * Tests cover:
 * - Detecting field changes between two objects
 * - Handling create operations (empty old object)
 * - Handling delete operations (empty new object)
 * - Excluding specified fields
 * - Partial comparison mode
 * - Handling null and undefined values
 * - Deterministic output ordering
 */
import { describe, it, expect } from 'vitest';

import { generateChanges } from './diff.js';

describe('generateChanges', () => {
  describe('basic change detection', () => {
    it('should detect a single field change', () => {
      const oldObj = { name: 'John', age: 20 };
      const newObj = { name: 'Jane', age: 20 };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: 'name',
        oldValue: 'John',
        newValue: 'Jane',
      });
    });

    it('should detect multiple field changes', () => {
      const oldObj = { name: 'John', age: 20, city: 'NYC' };
      const newObj = { name: 'Jane', age: 21, city: 'NYC' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({ field: 'name', oldValue: 'John', newValue: 'Jane' });
      expect(changes).toContainEqual({ field: 'age', oldValue: 20, newValue: 21 });
    });

    it('should return empty array when objects are identical', () => {
      const oldObj = { name: 'John', age: 20 };
      const newObj = { name: 'John', age: 20 };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(0);
    });

    it('should detect boolean changes', () => {
      const oldObj = { active: true };
      const newObj = { active: false };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'active', oldValue: true, newValue: false });
    });
  });

  describe('create operations (empty old object)', () => {
    it('should list all new fields as changes', () => {
      const oldObj = {};
      const newObj = { name: 'John', age: 20, active: true };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(3);
      expect(changes).toContainEqual({ field: 'name', oldValue: null, newValue: 'John' });
      expect(changes).toContainEqual({ field: 'age', oldValue: null, newValue: 20 });
      expect(changes).toContainEqual({ field: 'active', oldValue: null, newValue: true });
    });
  });

  describe('delete operations (empty new object)', () => {
    it('should list all removed fields as changes', () => {
      const oldObj = { name: 'John', age: 20 };
      const newObj = {};

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({ field: 'name', oldValue: 'John', newValue: null });
      expect(changes).toContainEqual({ field: 'age', oldValue: 20, newValue: null });
    });
  });

  describe('null and undefined handling', () => {
    it('should treat undefined as null', () => {
      const oldObj = { name: undefined };
      const newObj = { name: null };

      const changes = generateChanges(oldObj, newObj);

      // Both normalize to null, so no change
      expect(changes).toHaveLength(0);
    });

    it('should detect change from null to a value', () => {
      const oldObj = { phone: null };
      const newObj = { phone: '+1234567890' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'phone', oldValue: null, newValue: '+1234567890' });
    });

    it('should detect change from a value to null', () => {
      const oldObj = { phone: '+1234567890' };
      const newObj = { phone: null };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'phone', oldValue: '+1234567890', newValue: null });
    });

    it('should detect field added (not in old, present in new)', () => {
      const oldObj = { name: 'John' };
      const newObj = { name: 'John', email: 'john@example.com' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'email', oldValue: null, newValue: 'john@example.com' });
    });

    it('should detect field removed (present in old, not in new)', () => {
      const oldObj = { name: 'John', email: 'john@example.com' };
      const newObj = { name: 'John' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'email', oldValue: 'john@example.com', newValue: null });
    });
  });

  describe('field exclusion', () => {
    it('should exclude default fields (updatedAt, createdAt)', () => {
      const oldObj = { name: 'John', updatedAt: '2024-01-01', createdAt: '2024-01-01' };
      const newObj = { name: 'Jane', updatedAt: '2024-02-01', createdAt: '2024-01-01' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('name');
    });

    it('should exclude custom specified fields', () => {
      const oldObj = { name: 'John', internalId: '123', version: 1 };
      const newObj = { name: 'Jane', internalId: '456', version: 2 };

      const changes = generateChanges(oldObj, newObj, {
        excludeFields: ['internalId', 'version'],
      });

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('name');
    });

    it('should override default exclusions when custom excludeFields is provided', () => {
      const oldObj = { name: 'John', updatedAt: '2024-01-01' };
      const newObj = { name: 'Jane', updatedAt: '2024-02-01' };

      // Custom excludeFields replaces defaults
      const changes = generateChanges(oldObj, newObj, {
        excludeFields: ['name'],
      });

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('updatedAt');
    });
  });

  describe('partial comparison mode', () => {
    it('should only compare fields present in newObj when partialComparison is true', () => {
      const oldObj = { name: 'John', age: 20, city: 'NYC' };
      const newObj = { name: 'Jane' };

      const changes = generateChanges(oldObj, newObj, { partialComparison: true });

      // Only 'name' is compared because it's the only field in newObj
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ field: 'name', oldValue: 'John', newValue: 'Jane' });
    });

    it('should not report removed fields in partial comparison mode', () => {
      const oldObj = { name: 'John', age: 20, city: 'NYC' };
      const newObj = { name: 'John' };

      const changes = generateChanges(oldObj, newObj, { partialComparison: true });

      // name is unchanged, age and city are not in newObj so not compared
      expect(changes).toHaveLength(0);
    });
  });

  describe('deterministic ordering', () => {
    it('should sort changes by field name alphabetically', () => {
      const oldObj = { zebra: 'a', alpha: 'b', middle: 'c' };
      const newObj = { zebra: 'x', alpha: 'y', middle: 'z' };

      const changes = generateChanges(oldObj, newObj);

      expect(changes[0].field).toBe('alpha');
      expect(changes[1].field).toBe('middle');
      expect(changes[2].field).toBe('zebra');
    });
  });
});
