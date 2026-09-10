/**
 * Property-based tests for Institution Validation.
 *
 * Property 8: Institution Validation Without Persistence
 * Property 32: Deactivated Institution Prevents Operations
 *
 * **Validates: Requirements 5.3, 5.4, 5.1**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConflictError, BusinessRuleError, EntityStatus } from '@proctira/common';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { InstitutionService } from './institution-service.js';
import type { CreateInstitutionInput } from './schemas.js';

// --- Arbitraries ---

/**
 * Generates a valid UUID v4 string matching the schema pattern.
 */
const uuidV4Arb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-4${p3}-${variant}${p4}-${p5}`);

/**
 * Generates a valid institution name (non-empty, max 255 chars).
 */
const institutionNameArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'.split('')),
  { minLength: 1, maxLength: 50 },
);

/**
 * Generates a valid institution code (non-empty, max 50 chars).
 */
const institutionCodeArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
  { minLength: 1, maxLength: 20 },
);

/**
 * Generates a valid CreateInstitutionInput with all required fields.
 */
const validInstitutionInputArb: fc.Arbitrary<CreateInstitutionInput> = fc.record({
  name: institutionNameArb,
  code: institutionCodeArb,
  areaId: uuidV4Arb,
  typeId: uuidV4Arb,
  sectorId: uuidV4Arb,
  ownershipId: uuidV4Arb,
});

/**
 * Generates a tenant ID.
 */
const tenantIdArb: fc.Arbitrary<string> = uuidV4Arb;

/**
 * Generates a deactivation reason string.
 */
const deactivationReasonArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,'.split('')),
  { minLength: 1, maxLength: 100 },
);

// --- Property 8: Institution Validation Without Persistence ---

describe('Property 8: Institution Validation Without Persistence', () => {
  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any institution creation or update request with invalid data
   * (duplicate code, duplicate name within area), the system SHALL reject
   * the request with a structured error identifying the conflict, and no
   * database state change SHALL occur.
   */

  let repository: InMemoryInstitutionRepository;
  let service: InstitutionService;

  beforeEach(() => {
    repository = new InMemoryInstitutionRepository();
    service = new InstitutionService(repository);
  });

  it('duplicate institution code is rejected and no new record is persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        validInstitutionInputArb,
        validInstitutionInputArb,
        async (tenantId, input1, input2) => {
          // Reset repository for each test case
          repository.clear();

          // Use the same code for both inputs to trigger duplicate code validation
          const sharedCode = input1.code;
          const secondInput: CreateInstitutionInput = { ...input2, code: sharedCode };

          // Create the first institution successfully
          await service.create(tenantId, input1);

          // Capture the repository state before the second create attempt
          const listBefore = await service.list(tenantId, {}, { page: 1, pageSize: 1000 });
          const countBefore = listBefore.meta.totalItems;

          // Attempt to create a second institution with the same code — must throw
          let threw = false;
          try {
            await service.create(tenantId, secondInput);
          } catch (error) {
            threw = true;
            // Verify it's a ConflictError with a meaningful message
            expect(error).toBeInstanceOf(ConflictError);
            expect((error as ConflictError).message).toContain(sharedCode);
          }

          // The code is globally unique, so it must always throw
          expect(threw).toBe(true);

          // Verify no data was persisted — count should remain the same
          const listAfter = await service.list(tenantId, {}, { page: 1, pageSize: 1000 });
          expect(listAfter.meta.totalItems).toBe(countBefore);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('duplicate institution name within the same area is rejected and no new record is persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        institutionNameArb,
        institutionCodeArb,
        institutionCodeArb,
        uuidV4Arb,
        uuidV4Arb,
        uuidV4Arb,
        uuidV4Arb,
        uuidV4Arb,
        async (
          tenantId,
          sharedName,
          code1,
          code2,
          sharedAreaId,
          typeId,
          sectorId,
          ownershipId,
          typeId2,
        ) => {
          // Reset repository for each test case
          repository.clear();

          // Ensure distinct codes
          const distinctCode1 = code1 + '-FIRST';
          const distinctCode2 = code2 + '-SECOND';

          const firstInput: CreateInstitutionInput = {
            name: sharedName,
            code: distinctCode1,
            areaId: sharedAreaId,
            typeId,
            sectorId,
            ownershipId,
          };

          const secondInput: CreateInstitutionInput = {
            name: sharedName,
            code: distinctCode2,
            areaId: sharedAreaId,
            typeId: typeId2,
            sectorId,
            ownershipId,
          };

          // Create the first institution
          await service.create(tenantId, firstInput);

          // Capture state before second attempt
          const listBefore = await service.list(tenantId, {}, { page: 1, pageSize: 1000 });
          const countBefore = listBefore.meta.totalItems;

          // Attempt to create a second institution with the same name in the same area
          let threw = false;
          try {
            await service.create(tenantId, secondInput);
          } catch (error) {
            threw = true;
            // Verify it's a ConflictError
            expect(error).toBeInstanceOf(ConflictError);
            expect((error as ConflictError).message).toContain(sharedName);
          }

          // Same name + same area + same tenant must always throw
          expect(threw).toBe(true);

          // Verify no data was persisted
          const listAfter = await service.list(tenantId, {}, { page: 1, pageSize: 1000 });
          expect(listAfter.meta.totalItems).toBe(countBefore);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('validation failure on update with duplicate code does not persist changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        validInstitutionInputArb,
        validInstitutionInputArb,
        async (tenantId, input1, input2) => {
          // Reset repository for each test case
          repository.clear();

          // Ensure distinct codes for initial creation
          const firstInput: CreateInstitutionInput = { ...input1, code: input1.code + '-A' };
          const secondInput: CreateInstitutionInput = { ...input2, code: input2.code + '-B' };

          // Create two institutions
          const inst1 = await service.create(tenantId, firstInput);
          const inst2 = await service.create(tenantId, secondInput);

          // Capture inst2's state before update attempt
          const inst2Before = await service.getById(tenantId, inst2.id);

          // Attempt to update inst2's code to inst1's code
          let threw = false;
          try {
            await service.update(tenantId, inst2.id, { code: firstInput.code });
          } catch (error) {
            threw = true;
            expect(error).toBeInstanceOf(ConflictError);
          }

          // Must always throw since codes are distinct
          expect(threw).toBe(true);

          // Verify inst2 was NOT modified
          const inst2After = await service.getById(tenantId, inst2.id);
          expect(inst2After.code).toBe(inst2Before.code);
          expect(inst2After.name).toBe(inst2Before.name);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('validation failure on update with duplicate name in area does not persist changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        institutionCodeArb,
        institutionCodeArb,
        uuidV4Arb,
        uuidV4Arb,
        uuidV4Arb,
        uuidV4Arb,
        async (tenantId, code1, code2, sharedAreaId, typeId, sectorId, ownershipId) => {
          // Reset repository for each test case
          repository.clear();

          // Use fixed distinct names and distinct codes
          const firstInput: CreateInstitutionInput = {
            name: 'School Alpha',
            code: code1 + '-1',
            areaId: sharedAreaId,
            typeId,
            sectorId,
            ownershipId,
          };
          const secondInput: CreateInstitutionInput = {
            name: 'School Beta',
            code: code2 + '-2',
            areaId: sharedAreaId,
            typeId,
            sectorId,
            ownershipId,
          };

          // Create two institutions in the same area with different names
          await service.create(tenantId, firstInput);
          const inst2 = await service.create(tenantId, secondInput);

          // Capture inst2's state before update attempt
          const inst2Before = await service.getById(tenantId, inst2.id);

          // Attempt to update inst2's name to inst1's name (same area)
          let threw = false;
          try {
            await service.update(tenantId, inst2.id, { name: 'School Alpha' });
          } catch (error) {
            threw = true;
            expect(error).toBeInstanceOf(ConflictError);
          }

          // Must throw since names collide in same area
          expect(threw).toBe(true);

          // Verify inst2 was NOT modified
          const inst2After = await service.getById(tenantId, inst2.id);
          expect(inst2After.name).toBe(inst2Before.name);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// --- Property 32: Deactivated Institution Prevents Operations ---

describe('Property 32: Deactivated Institution Prevents Operations', () => {
  /**
   * **Validates: Requirements 5.1**
   *
   * For any institution with inactive status, attempts to create new
   * enrollments or staff assignments to that institution SHALL be rejected.
   */

  let repository: InMemoryInstitutionRepository;
  let service: InstitutionService;

  beforeEach(() => {
    repository = new InMemoryInstitutionRepository();
    service = new InstitutionService(repository);
  });

  it('isActive returns false for any deactivated institution', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        validInstitutionInputArb,
        deactivationReasonArb,
        async (tenantId, input, reason) => {
          // Reset repository for each test case
          repository.clear();

          // Create and deactivate an institution
          const created = await service.create(tenantId, input);
          await service.deactivate(tenantId, created.id, reason);

          // Verify isActive returns false — this is the guard used by
          // enrollment and staff assignment services
          const active = await service.isActive(tenantId, created.id);
          expect(active).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('deactivated institution has INACTIVE status and records the reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        validInstitutionInputArb,
        deactivationReasonArb,
        async (tenantId, input, reason) => {
          // Reset repository for each test case
          repository.clear();

          // Create and deactivate
          const created = await service.create(tenantId, input);
          const deactivated = await service.deactivate(tenantId, created.id, reason);

          // Verify the institution status is INACTIVE
          expect(deactivated.status).toBe(EntityStatus.INACTIVE);

          // Verify the deactivation reason is recorded
          expect(deactivated.deactivationReason).toBe(reason);

          // Verify that the institution cannot be deactivated again
          // (demonstrates the institution is in a terminal inactive state)
          let threw = false;
          try {
            await service.deactivate(tenantId, created.id, 'another reason');
          } catch (error) {
            threw = true;
            expect(error).toBeInstanceOf(BusinessRuleError);
          }
          expect(threw).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('active institution allows operations but deactivated one does not', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        validInstitutionInputArb,
        validInstitutionInputArb,
        deactivationReasonArb,
        async (tenantId, activeInput, inactiveInput, reason) => {
          // Reset repository for each test case
          repository.clear();

          // Ensure distinct codes
          const activeInst: CreateInstitutionInput = {
            ...activeInput,
            code: activeInput.code + '-ACT',
          };
          const inactiveInst: CreateInstitutionInput = {
            ...inactiveInput,
            code: inactiveInput.code + '-INACT',
          };

          // Create two institutions
          const active = await service.create(tenantId, activeInst);
          const inactive = await service.create(tenantId, inactiveInst);

          // Deactivate one
          await service.deactivate(tenantId, inactive.id, reason);

          // Active institution allows operations
          const activeCheck = await service.isActive(tenantId, active.id);
          expect(activeCheck).toBe(true);

          // Inactive institution prevents operations
          const inactiveCheck = await service.isActive(tenantId, inactive.id);
          expect(inactiveCheck).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
