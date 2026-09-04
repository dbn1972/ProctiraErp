/** LMS repository ports (P26). */

export interface LmsCourseEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  classId: string | null;
  subjectId: string | null;
  staffId: string | null;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LmsLessonEntity {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  contentRef: string | null;
  lessonOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LmsEnrollmentEntity {
  id: string;
  tenantId: string;
  courseId: string;
  studentId: string;
  status: string;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
}

export interface LmsRepository {
  listLmsCourses(tenantId: string): Promise<LmsCourseEntity[]>;
  getLmsCourse(tenantId: string, id: string): Promise<LmsCourseEntity | null>;
  createLmsCourse(row: LmsCourseEntity): Promise<LmsCourseEntity>;
  updateLmsCourse(tenantId: string, id: string, patch: Partial<LmsCourseEntity>): Promise<LmsCourseEntity | null>;
  listLmsLessons(tenantId: string): Promise<LmsLessonEntity[]>;
  getLmsLesson(tenantId: string, id: string): Promise<LmsLessonEntity | null>;
  createLmsLesson(row: LmsLessonEntity): Promise<LmsLessonEntity>;
  updateLmsLesson(tenantId: string, id: string, patch: Partial<LmsLessonEntity>): Promise<LmsLessonEntity | null>;
  listLmsEnrollments(tenantId: string): Promise<LmsEnrollmentEntity[]>;
  getLmsEnrollment(tenantId: string, id: string): Promise<LmsEnrollmentEntity | null>;
  createLmsEnrollment(row: LmsEnrollmentEntity): Promise<LmsEnrollmentEntity>;
  updateLmsEnrollment(tenantId: string, id: string, patch: Partial<LmsEnrollmentEntity>): Promise<LmsEnrollmentEntity | null>;
}
