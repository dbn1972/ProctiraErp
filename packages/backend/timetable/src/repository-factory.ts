/**
 * Prefer Postgres raw-SQL repository when DATABASE_URL is set; else in-memory.
 * No Prisma on the timetable certification path.
 */
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import {
  createPgTimetableRepository,
  isPgTimetableEnabled,
} from './pg-timetable-repository.js';
import type { TimetableRepository } from './timetable-repository.js';

export function createTimetableRepository(): TimetableRepository {
  if (isPgTimetableEnabled()) {
    const pg = createPgTimetableRepository();
    if (pg) return pg;
  }
  return new InMemoryTimetableRepository();
}
