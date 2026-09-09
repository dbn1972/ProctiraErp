/**
 * Property  G-908: after invigilator allocation, no staff member is
 * double-booked on overlapping exam sessions.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { invigilatorsAreClashFree, type TimedSlot } from './clash.js';
import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { ExamOpsService } from './ops-service.js';
import { InMemoryExamOpsStore } from './ops-store.js';
import type { CreateExaminationInput } from './schemas.js';

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Property Exam',
    code: `PX-${randomUUID().slice(0, 8)}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(14),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Hall', code: 'HALL', institutionId: randomUUID(), capacity: 100 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

const SLOT_STARTS = ['08:00', '09:00', '10:00', '13:00', '14:00'] as const;
const SLOT_ENDS = ['09:00', '10:00', '12:00', '15:00', '16:00'] as const;
const ROOMS = ['R1', 'R2', 'R3'] as const;

describe('Property: no invigilator is double-booked after allocation', () => {
  it('allocation rejects overlapping staff assignments', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 2, max: 4 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 2 })), {
          minLength: 3,
          maxLength: 12,
        }),
        async (sessionCount, staffCount, attempts) => {
          const tenantId = randomUUID();
          const repository = new InMemoryExaminationRepository();
          const store = new InMemoryExamOpsStore();
          const exams = new ExaminationService(repository);
          const ops = new ExamOpsService({ store, examinations: repository });
          const exam = await exams.create(tenantId, examBody());
          const actor = { userId: randomUUID(), roles: ['Administrator'] };
          const date = futureDate(8);
          const sessionIds: string[] = [];
          const slots: TimedSlot[] = [];

          for (let i = 0; i < sessionCount; i += 1) {
            const start = SLOT_STARTS[i % SLOT_STARTS.length]!;
            const end = SLOT_ENDS[i % SLOT_ENDS.length]!;
            if (end <= start) continue;
            const created = await ops.createSession(
              tenantId,
              exam.id,
              {
                subjectId: exam.subjects[0]!.id,
                date,
                startTime: start,
                endTime: end,
                roomId: `${ROOMS[i % ROOMS.length]}-${i}`,
                centerId: exam.centers[0]!.id,
              },
              actor,
            );
            if (!created.ok) continue;
            sessionIds.push(created.session.id);
            slots.push({
              id: created.session.id,
              date: created.session.date,
              startTime: created.session.startTime,
              endTime: created.session.endTime,
              roomId: created.session.roomId,
            });
          }
          if (sessionIds.length === 0) return;

          const staffIds = Array.from({ length: staffCount }, () => randomUUID());
          const accepted: { sessionId: string; staffId: string }[] = [];
          for (const [sessionIdx, staffIdx] of attempts) {
            const sessionId = sessionIds[sessionIdx % sessionIds.length];
            const staffId = staffIds[staffIdx % staffIds.length];
            if (!sessionId || !staffId) continue;
            try {
              const outcome = await ops.allocateInvigilator(
                tenantId,
                exam.id,
                sessionId,
                { staffId },
                actor,
              );
              if (outcome.ok) {
                accepted.push({ sessionId, staffId });
              }
            } catch (error) {
              if (!(error instanceof ConflictError)) throw error;
            }
          }

          expect(invigilatorsAreClashFree(slots, accepted)).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });
});
