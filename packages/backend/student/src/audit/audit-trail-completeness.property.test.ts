/**
 * Property-based tests for Audit Trail Completeness.
 *
 * Property 14: Audit Trail Completeness
 *
 * For any create, update, or delete operation on a protected entity,
 * the system SHALL record an audit log entry containing the authenticated
 * user, timestamp, IP address, affected entity type and ID, operation type,
 * and before/after field values.
 *
 * **Validates: Requirements 6.6, 21.1, 21.2**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import { AuditService } from './audit-service.js';
import { InMemoryAuditStore } from './in-memory-audit-store.js';
import type { AuditContext } from './audit-service.js';
import type { AuditEntry, AuditOperation } from './types.js';
import type { AuditableRecord } from './diff.js';

// --- Arbitraries ---

/**
 * Generates a valid user ID string.
 */
const userIdArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 3, maxLength: 30 },
).map((s) => `user-${s}`);

/**
 * Generates a valid tenant ID string.
 */
const tenantIdArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 3, maxLength: 20 },
).map((s) => `tenant-${s}`);

/**
 * Generates a valid IP address string.
 */
const ipAddressArb: fc.Arbitrary<string> = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 1, max: 254 }),
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/**
 * Generates an audit context with all required fields.
 */
const auditContextArb: fc.Arbitrary<AuditContext> = fc.record({
  userId: userIdArb,
  tenantId: tenantIdArb,
  ipAddress: ipAddressArb,
});

/**
 * Generates a valid entity type string.
 */
const entityTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'student', 'enrollment', 'guardian', 'contact', 'identity_document',
);

/**
 * Generates a valid entity ID string.
 */
const entityIdArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 3, maxLength: 20 },
).map((s) => `entity-${s}`);

/**
 * Generates a field name (alphanumeric, camelCase-like).
 */
const fieldNameArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 2, maxLength: 15 },
);

/**
 * Generates a primitive value suitable for audit fields.
 */
const fieldValueArb: fc.Arbitrary<string | number | boolean> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.integer({ min: -10000, max: 10000 }),
  fc.boolean(),
);

/**
 * Generates a non-empty auditable record (flat object with 1-5 fields).
 * Ensures field names are unique and not in the default excluded set.
 */
const auditableRecordArb: fc.Arbitrary<AuditableRecord> = fc
  .array(
    fc.tuple(fieldNameArb, fieldValueArb),
    { minLength: 1, maxLength: 5 },
  )
  .map((pairs) => {
    const record: AuditableRecord = {};
    const excluded = new Set(['updatedAt', 'createdAt']);
    for (const [key, value] of pairs) {
      if (!excluded.has(key)) {
        record[key] = value;
      }
    }
    // Ensure at least one field
    if (Object.keys(record).length === 0) {
      record['name'] = 'default';
    }
    return record;
  });

/**
 * Generates a modified version of a record (at least one field changed).
 */
function modifiedRecordArb(original: AuditableRecord): fc.Arbitrary<AuditableRecord> {
  const keys = Object.keys(original);
  if (keys.length === 0) {
    return fc.constant({ name: 'modified' });
  }
  return fc.tuple(
    fc.constantFrom(...keys),
    fieldValueArb,
  ).map(([keyToChange, newValue]) => {
    const modified = { ...original };
    // Ensure the value is actually different
    if (modified[keyToChange] === newValue) {
      if (typeof newValue === 'string') {
        modified[keyToChange] = newValue + '_changed';
      } else if (typeof newValue === 'number') {
        modified[keyToChange] = (newValue as number) + 1;
      } else {
        modified[keyToChange] = !(newValue as boolean);
      }
    } else {
      modified[keyToChange] = newValue;
    }
    return modified;
  });
}

/**
 * Represents a single modification operation in a sequence.
 */
interface ModificationOp {
  type: AuditOperation;
  context: AuditContext;
  entityType: string;
  entityId: string;
  oldState: AuditableRecord;
  newState: AuditableRecord;
}

// --- Property 14: Audit Trail Completeness ---

describe('Property 14: Audit Trail Completeness', () => {
  /**
   * **Validates: Requirements 6.6, 21.1, 21.2**
   *
   * For any sequence of student record modifications, every change produces
   * an audit entry with all required fields (changed field, previous value,
   * new value, timestamp, user).
   */

  let store: InMemoryAuditStore;
  let service: AuditService;

  beforeEach(() => {
    store = new InMemoryAuditStore();
    service = new AuditService(store);
  });

  it('every create operation produces an audit entry with all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditContextArb,
        entityTypeArb,
        entityIdArb,
        auditableRecordArb,
        async (context, entityType, entityId, newState) => {
          store.clear();

          const entry = await service.recordCreate(context, entityType, entityId, newState);

          // Entry must exist
          expect(entry).toBeDefined();

          // Required fields from Requirement 21.2
          expect(entry.userId).toBe(context.userId);
          expect(entry.tenantId).toBe(context.tenantId);
          expect(entry.ipAddress).toBe(context.ipAddress);
          expect(entry.entityType).toBe(entityType);
          expect(entry.entityId).toBe(entityId);
          expect(entry.operation).toBe('create');

          // Timestamp must be a valid ISO 8601 string (Requirement 6.6)
          expect(entry.timestamp).toBeDefined();
          const parsedDate = new Date(entry.timestamp);
          expect(parsedDate.toISOString()).toBe(entry.timestamp);

          // Unique ID must be assigned
          expect(entry.id).toBeDefined();
          expect(entry.id.length).toBeGreaterThan(0);

          // Changes must capture all fields from newState (Requirement 6.6)
          const nonExcludedFields = Object.keys(newState).filter(
            (k) => k !== 'updatedAt' && k !== 'createdAt',
          );
          expect(entry.changes.length).toBe(nonExcludedFields.length);

          // Each change must have: field name, oldValue (null for create), newValue
          for (const change of entry.changes) {
            expect(change.field).toBeDefined();
            expect(change.field.length).toBeGreaterThan(0);
            expect(change.oldValue).toBeNull(); // create: previous value is null
            expect(change.newValue).toBe(newState[change.field]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every update operation with actual changes produces an audit entry with before/after values', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditContextArb,
        entityTypeArb,
        entityIdArb,
        auditableRecordArb,
        async (context, entityType, entityId, oldState) => {
          store.clear();

          // Generate a modified state that differs from oldState
          const modifiedState = await fc.sample(modifiedRecordArb(oldState), 1)[0];

          const entry = await service.recordUpdate(
            context, entityType, entityId, oldState, modifiedState,
          );

          // Entry must exist since we guaranteed at least one field changed
          expect(entry).not.toBeNull();

          // Required fields from Requirement 21.2
          expect(entry!.userId).toBe(context.userId);
          expect(entry!.tenantId).toBe(context.tenantId);
          expect(entry!.ipAddress).toBe(context.ipAddress);
          expect(entry!.entityType).toBe(entityType);
          expect(entry!.entityId).toBe(entityId);
          expect(entry!.operation).toBe('update');

          // Timestamp must be valid ISO 8601
          expect(entry!.timestamp).toBeDefined();
          const parsedDate = new Date(entry!.timestamp);
          expect(parsedDate.toISOString()).toBe(entry!.timestamp);

          // Changes must have at least one entry
          expect(entry!.changes.length).toBeGreaterThan(0);

          // Each change must capture field, previous value, and new value (Requirement 6.6)
          for (const change of entry!.changes) {
            expect(change.field).toBeDefined();
            expect(change.field.length).toBeGreaterThan(0);
            // oldValue should match the original state for that field
            expect(change.oldValue).toEqual(oldState[change.field] ?? null);
            // newValue should match the modified state for that field
            expect(change.newValue).toEqual(modifiedState[change.field] ?? null);
            // old and new must differ (otherwise it wouldn't be a change)
            expect(change.oldValue).not.toEqual(change.newValue);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every delete operation produces an audit entry with all previous field values', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditContextArb,
        entityTypeArb,
        entityIdArb,
        auditableRecordArb,
        async (context, entityType, entityId, oldState) => {
          store.clear();

          const entry = await service.recordDelete(context, entityType, entityId, oldState);

          // Entry must exist
          expect(entry).toBeDefined();

          // Required fields from Requirement 21.2
          expect(entry.userId).toBe(context.userId);
          expect(entry.tenantId).toBe(context.tenantId);
          expect(entry.ipAddress).toBe(context.ipAddress);
          expect(entry.entityType).toBe(entityType);
          expect(entry.entityId).toBe(entityId);
          expect(entry.operation).toBe('delete');

          // Timestamp must be valid ISO 8601
          expect(entry.timestamp).toBeDefined();
          const parsedDate = new Date(entry.timestamp);
          expect(parsedDate.toISOString()).toBe(entry.timestamp);

          // Changes must capture all fields from oldState (Requirement 6.6)
          const nonExcludedFields = Object.keys(oldState).filter(
            (k) => k !== 'updatedAt' && k !== 'createdAt',
          );
          expect(entry.changes.length).toBe(nonExcludedFields.length);

          // Each change must have: field name, oldValue (from previous state), newValue (null for delete)
          for (const change of entry.changes) {
            expect(change.field).toBeDefined();
            expect(change.field.length).toBeGreaterThan(0);
            expect(change.oldValue).toBe(oldState[change.field]);
            expect(change.newValue).toBeNull(); // delete: new value is null
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a sequence of modifications produces one audit entry per operation with correct metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditContextArb,
        entityIdArb,
        auditableRecordArb,
        fc.array(fieldValueArb, { minLength: 1, maxLength: 5 }),
        async (context, entityId, initialState, updateValues) => {
          store.clear();

          const entityType = 'student';

          // Step 1: Create
          await service.recordCreate(context, entityType, entityId, initialState);

          // Step 2: Sequence of updates
          let currentState = { ...initialState };
          const firstKey = Object.keys(currentState)[0];
          let updateCount = 0;

          for (const newValue of updateValues) {
            const oldState = { ...currentState };
            currentState[firstKey] = newValue;

            // Only record if value actually changed
            if (oldState[firstKey] !== currentState[firstKey]) {
              await service.recordUpdate(context, entityType, entityId, oldState, currentState);
              updateCount++;
            }
          }

          // Step 3: Delete
          await service.recordDelete(context, entityType, entityId, currentState);

          // Verify total audit entries: 1 create + N updates + 1 delete
          const allEntries = await service.query({ entityId, entityType });
          expect(allEntries.length).toBe(1 + updateCount + 1);

          // Verify each entry has all required fields
          for (const entry of allEntries) {
            // Required metadata (Requirement 21.2)
            expect(entry.userId).toBe(context.userId);
            expect(entry.tenantId).toBe(context.tenantId);
            expect(entry.ipAddress).toBe(context.ipAddress);
            expect(entry.entityType).toBe(entityType);
            expect(entry.entityId).toBe(entityId);
            expect(entry.operation).toBeDefined();
            expect(['create', 'update', 'delete']).toContain(entry.operation);

            // Timestamp (Requirement 6.6)
            expect(entry.timestamp).toBeDefined();
            const parsedDate = new Date(entry.timestamp);
            expect(parsedDate.toISOString()).toBe(entry.timestamp);

            // Unique ID
            expect(entry.id).toBeDefined();
            expect(entry.id.length).toBeGreaterThan(0);

            // Changes array (Requirement 6.6)
            expect(entry.changes).toBeDefined();
            expect(Array.isArray(entry.changes)).toBe(true);
            expect(entry.changes.length).toBeGreaterThan(0);

            // Each change has field, oldValue, newValue
            for (const change of entry.changes) {
              expect(change).toHaveProperty('field');
              expect(change).toHaveProperty('oldValue');
              expect(change).toHaveProperty('newValue');
              expect(change.field.length).toBeGreaterThan(0);
            }
          }

          // Verify all entry IDs are unique
          const ids = allEntries.map((e) => e.id);
          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('audit entries are stored in append-only fashion and retrievable by entity', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditContextArb,
        entityTypeArb,
        entityIdArb,
        auditableRecordArb,
        async (context, entityType, entityId, state) => {
          store.clear();

          // Perform a create operation
          const entry = await service.recordCreate(context, entityType, entityId, state);

          // Verify the entry is retrievable by ID
          const found = await service.findById(entry.id);
          expect(found).not.toBeNull();
          expect(found!.id).toBe(entry.id);
          expect(found!.entityType).toBe(entityType);
          expect(found!.entityId).toBe(entityId);
          expect(found!.userId).toBe(context.userId);

          // Verify the entry is retrievable by entity filter
          const byEntity = await service.query({ entityType, entityId });
          expect(byEntity.length).toBe(1);
          expect(byEntity[0].id).toBe(entry.id);

          // Verify count matches
          const count = await service.count({ entityType, entityId });
          expect(count).toBe(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});
