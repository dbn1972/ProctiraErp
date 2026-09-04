import type { PrismaClient } from '@proctira/database';
import type {
  LmsCourseEntity,
  LmsLessonEntity,
  LmsEnrollmentEntity,
  LmsRepository,
} from './lms-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaLmsRepository implements LmsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listLmsCourses(tenantId: string) {
    const rows = await (this.prisma as any).lmsCourse.findMany({ where: { tenantId } });
    return rows.map(mapLmsCourse);
  }
  async getLmsCourse(tenantId: string, id: string) {
    const row = await (this.prisma as any).lmsCourse.findFirst({ where: { id, tenantId } });
    return row ? mapLmsCourse(row) : null;
  }
  async createLmsCourse(row: LmsCourseEntity) {
    const created = await (this.prisma as any).lmsCourse.create({ data: toLmsCourse(row) });
    return mapLmsCourse(created);
  }
  async updateLmsCourse(tenantId: string, id: string, patch: Partial<LmsCourseEntity>) {
    const existing = await this.getLmsCourse(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).lmsCourse.update({
      where: { id },
      data: toLmsCourse({ ...existing, ...patch, id, tenantId }),
    });
    return mapLmsCourse(updated);
  }
  async listLmsLessons(tenantId: string) {
    const rows = await (this.prisma as any).lmsLesson.findMany({ where: { tenantId } });
    return rows.map(mapLmsLesson);
  }
  async getLmsLesson(tenantId: string, id: string) {
    const row = await (this.prisma as any).lmsLesson.findFirst({ where: { id, tenantId } });
    return row ? mapLmsLesson(row) : null;
  }
  async createLmsLesson(row: LmsLessonEntity) {
    const created = await (this.prisma as any).lmsLesson.create({ data: toLmsLesson(row) });
    return mapLmsLesson(created);
  }
  async updateLmsLesson(tenantId: string, id: string, patch: Partial<LmsLessonEntity>) {
    const existing = await this.getLmsLesson(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).lmsLesson.update({
      where: { id },
      data: toLmsLesson({ ...existing, ...patch, id, tenantId }),
    });
    return mapLmsLesson(updated);
  }
  async listLmsEnrollments(tenantId: string) {
    const rows = await (this.prisma as any).lmsEnrollment.findMany({ where: { tenantId } });
    return rows.map(mapLmsEnrollment);
  }
  async getLmsEnrollment(tenantId: string, id: string) {
    const row = await (this.prisma as any).lmsEnrollment.findFirst({ where: { id, tenantId } });
    return row ? mapLmsEnrollment(row) : null;
  }
  async createLmsEnrollment(row: LmsEnrollmentEntity) {
    const created = await (this.prisma as any).lmsEnrollment.create({ data: toLmsEnrollment(row) });
    return mapLmsEnrollment(created);
  }
  async updateLmsEnrollment(tenantId: string, id: string, patch: Partial<LmsEnrollmentEntity>) {
    const existing = await this.getLmsEnrollment(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).lmsEnrollment.update({
      where: { id },
      data: toLmsEnrollment({ ...existing, ...patch, id, tenantId }),
    });
    return mapLmsEnrollment(updated);
  }
}

function mapLmsCourse(row: any): LmsCourseEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    classId: row.classId ?? null,
    subjectId: row.subjectId ?? null,
    staffId: row.staffId ?? null,
    title: row.title,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLmsCourse(row: LmsCourseEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    classId: row.classId ?? null,
    subjectId: row.subjectId ?? null,
    staffId: row.staffId ?? null,
    title: row.title,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapLmsLesson(row: any): LmsLessonEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    title: row.title,
    contentRef: row.contentRef ?? null,
    lessonOrder: row.lessonOrder,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLmsLesson(row: LmsLessonEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    title: row.title,
    contentRef: row.contentRef ?? null,
    lessonOrder: row.lessonOrder,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapLmsEnrollment(row: any): LmsEnrollmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    studentId: row.studentId,
    status: row.status,
    progressPct: row.progressPct,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toLmsEnrollment(row: LmsEnrollmentEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    studentId: row.studentId,
    status: row.status,
    progressPct: row.progressPct,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
