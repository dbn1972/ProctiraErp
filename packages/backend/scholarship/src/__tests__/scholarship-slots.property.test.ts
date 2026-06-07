/**
 * Property-Based Test: Scholarship Slot Allocation Never Exceeds totalSlots
 *
 * Invariant: For any sequence of approval operations on a scholarship program,
 * the usedSlots must never exceed totalSlots. Once all slots are filled,
 * further approvals must be rejected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import { ScholarshipService } from '../scholarship-service.js';
import { InMemoryScholarshipRepository } from '../in-memory-repository.js';

describe('Scholarship Service - Slot Allocation Invariant (Property)', () => {
  let service: ScholarshipService;
  let repository: InMemoryScholarshipRepository;
  const tenantId = uuidv4();

  beforeEach(() => {
    repository = new InMemoryScholarshipRepository();
    service = new ScholarshipService(repository);
  });

  it('should never allow usedSlots to exceed totalSlots after any sequence of approvals', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate totalSlots between 1 and 10
        fc.integer({ min: 1, max: 10 }),
        // Generate number of applicants (more than totalSlots to test overflow)
        fc.integer({ min: 1, max: 20 }),
        async (totalSlots, applicantCount) => {
          // Create a scholarship program with limited slots
          const today = new Date();
          const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0]!;
          const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0]!;

          const program = await service.createProgram(tenantId, {
            name: `Program-${uuidv4().slice(0, 8)}`,
            applicationStartDate: startDate,
            applicationEndDate: endDate,
            totalSlots,
            amountPerRecipient: 1000,
            eligibility: {
              minGpa: 2.0,
              requiredDocuments: [],
            },
          });

          // Open the program for applications
          await repository.updateProgram(program.id, tenantId, { status: 'open' });

          // Submit applications (more than available slots)
          const applicationIds: string[] = [];
          const actualApplicantCount = Math.min(applicantCount, 20);

          for (let i = 0; i < actualApplicantCount; i++) {
            try {
              const app = await service.submitApplication(tenantId, {
                programId: program.id,
                applicantId: uuidv4(),
                institutionId: uuidv4(),
                academicRecords: { gpa: 3.5 },
                financialInfo: { income: 30000 },
                documents: [],
              });
              applicationIds.push(app.id);
            } catch {
              // Expected: "No available slots remaining" once slots are full
              // during submission phase — this is fine
            }
          }

          // Try to approve all submitted applications
          let approvedCount = 0;
          for (const appId of applicationIds) {
            try {
              await service.approveApplication(tenantId, appId);
              approvedCount++;
            } catch {
              // Expected: rejection when slots are exhausted
            }
          }

          // INVARIANT: approved count must never exceed totalSlots
          expect(approvedCount).toBeLessThanOrEqual(totalSlots);

          // Verify the program's usedSlots in the repository
          const updatedProgram = await service.getProgramById(tenantId, program.id);
          expect(updatedProgram.usedSlots).toBeLessThanOrEqual(updatedProgram.totalSlots);
          expect(updatedProgram.usedSlots).toBe(approvedCount);
        },
      ),
      { numRuns: 30 },
    );
  });
});
