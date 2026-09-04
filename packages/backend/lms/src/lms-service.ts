import { randomUUID } from 'node:crypto';
import type {
  LmsCourseEntity,
  LmsLessonEntity,
  LmsEnrollmentEntity,
  LmsRepository,
} from './lms-repository.js';

export class LmsService {
  constructor(private readonly repo: LmsRepository) {}

  listLmsCourses(tenantId: string) {
    return this.repo.listLmsCourses(tenantId);
  }
  getLmsCourse(tenantId: string, id: string) {
    return this.repo.getLmsCourse(tenantId, id);
  }
  createLmsCourse(
    tenantId: string,
    input: Omit<LmsCourseEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLmsCourse({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LmsCourseEntity);
  }
  updateLmsCourse(tenantId: string, id: string, patch: Partial<LmsCourseEntity>) {
    return this.repo.updateLmsCourse(tenantId, id, patch);
  }
  listLmsLessons(tenantId: string) {
    return this.repo.listLmsLessons(tenantId);
  }
  getLmsLesson(tenantId: string, id: string) {
    return this.repo.getLmsLesson(tenantId, id);
  }
  createLmsLesson(
    tenantId: string,
    input: Omit<LmsLessonEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLmsLesson({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LmsLessonEntity);
  }
  updateLmsLesson(tenantId: string, id: string, patch: Partial<LmsLessonEntity>) {
    return this.repo.updateLmsLesson(tenantId, id, patch);
  }
  listLmsEnrollments(tenantId: string) {
    return this.repo.listLmsEnrollments(tenantId);
  }
  getLmsEnrollment(tenantId: string, id: string) {
    return this.repo.getLmsEnrollment(tenantId, id);
  }
  createLmsEnrollment(
    tenantId: string,
    input: Omit<LmsEnrollmentEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createLmsEnrollment({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as LmsEnrollmentEntity);
  }
  updateLmsEnrollment(tenantId: string, id: string, patch: Partial<LmsEnrollmentEntity>) {
    return this.repo.updateLmsEnrollment(tenantId, id, patch);
  }
}
