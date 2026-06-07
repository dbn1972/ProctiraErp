/**
 * Property-Based Test: Transport Route Assignment Overlap Prevention
 *
 * Invariant: A student cannot be assigned to two overlapping transport routes
 * for the same time period. The service must reject the second assignment
 * when a student already has an active assignment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import { TransportService } from '../transport-service.js';
import { InMemoryTransportRepository } from '../in-memory-repository.js';

describe('Transport Service - No Overlapping Student Assignments (Property)', () => {
  let service: TransportService;
  let repository: InMemoryTransportRepository;
  const tenantId = uuidv4();

  beforeEach(() => {
    repository = new InMemoryTransportRepository();
    service = new TransportService(repository);
  });

  it('should never allow a student to have two active route assignments simultaneously', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a student ID
        fc.uuid(),
        // Generate two distinct route names
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
        ),
        // Generate start dates (ISO date strings)
        fc.date({
          min: new Date('2024-01-01'),
          max: new Date('2025-12-31'),
        }),
        async (studentId, [routeName1, routeName2], startDate) => {
          // Setup: Create two active routes
          const route1 = await service.createRoute(tenantId, {
            name: `Route-${routeName1}-${uuidv4().slice(0, 8)}`,
            startLocation: 'School',
            endLocation: 'Town A',
            operatingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          });

          const route2 = await service.createRoute(tenantId, {
            name: `Route-${routeName2}-${uuidv4().slice(0, 8)}`,
            startLocation: 'School',
            endLocation: 'Town B',
            operatingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          });

          const startDateStr = startDate.toISOString().split('T')[0]!;

          // First assignment should succeed
          const assignment1 = await service.createStudentAssignment(tenantId, {
            studentId,
            routeId: route1.id,
            startDate: startDateStr,
          });

          expect(assignment1.isActive).toBe(true);
          expect(assignment1.studentId).toBe(studentId);

          // Second assignment for the same student should be rejected
          // because the student already has an active assignment
          await expect(
            service.createStudentAssignment(tenantId, {
              studentId,
              routeId: route2.id,
              startDate: startDateStr,
            }),
          ).rejects.toThrow(
            'Student already has an active transport route assignment',
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});
