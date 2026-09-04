import type {
  LmsCourseEntity,
  LmsLessonEntity,
  LmsEnrollmentEntity,
  LmsRepository,
} from './lms-repository.js';

export class InMemoryLmsRepository implements LmsRepository {
  private readonly lmsCourses = new Map<string, LmsCourseEntity>();
  private readonly lmsLessons = new Map<string, LmsLessonEntity>();
  private readonly lmsEnrollments = new Map<string, LmsEnrollmentEntity>();

  async listLmsCourses(tenantId: string) {
    return [...this.lmsCourses.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLmsCourse(tenantId: string, id: string) {
    const row = this.lmsCourses.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLmsCourse(row: LmsCourseEntity) {
    this.lmsCourses.set(row.id, row);
    return row;
  }
  async updateLmsCourse(tenantId: string, id: string, patch: Partial<LmsCourseEntity>) {
    const cur = await this.getLmsCourse(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.lmsCourses.set(id, next);
    return next;
  }
  async listLmsLessons(tenantId: string) {
    return [...this.lmsLessons.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLmsLesson(tenantId: string, id: string) {
    const row = this.lmsLessons.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLmsLesson(row: LmsLessonEntity) {
    this.lmsLessons.set(row.id, row);
    return row;
  }
  async updateLmsLesson(tenantId: string, id: string, patch: Partial<LmsLessonEntity>) {
    const cur = await this.getLmsLesson(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.lmsLessons.set(id, next);
    return next;
  }
  async listLmsEnrollments(tenantId: string) {
    return [...this.lmsEnrollments.values()].filter((x) => x.tenantId === tenantId);
  }
  async getLmsEnrollment(tenantId: string, id: string) {
    const row = this.lmsEnrollments.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createLmsEnrollment(row: LmsEnrollmentEntity) {
    this.lmsEnrollments.set(row.id, row);
    return row;
  }
  async updateLmsEnrollment(tenantId: string, id: string, patch: Partial<LmsEnrollmentEntity>) {
    const cur = await this.getLmsEnrollment(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.lmsEnrollments.set(id, next);
    return next;
  }
}
