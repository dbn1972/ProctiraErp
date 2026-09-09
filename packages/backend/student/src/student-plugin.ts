/**
 * Fastify Student Plugin
 *
 * Registers student, enrollment, and bulk-import routes on a Fastify instance
 * (G-701: enrollment + import were previously exported but never mounted).
 * Provides the student service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createEnrollmentRepository } from './enrollment/create-enrollment-repository.js';
import type { EnrollmentRepository } from './enrollment/enrollment-repository.js';
import { registerEnrollmentRoutes } from './enrollment/enrollment-routes.js';
import { EnrollmentService } from './enrollment/enrollment-service.js';
import { CoreRepositoryImportAdapter } from './import/core-repository-import-adapter.js';
import { registerImportRoutes } from './import/import-routes.js';
import { ImportService } from './import/import-service.js';
import { InMemoryImportQueue } from './import/in-memory-import-queue.js';
import type { ImportQueue } from './import/types.js';
import { registerStudentRoutes } from './routes.js';
import type { StudentRepository } from './student-repository.js';
import { StudentService } from './student-service.js';
import { createStudentBlobStore, type StudentBlobStore } from './students-360/blob-store.js';
import { createStudents360Store } from './students-360/create-store.js';
import { getBoundAttendanceHeatmapSource } from './students-360/attendance-bridge.js';
import { registerStudents360Routes } from './students-360/routes.js';
import {
  Students360Service,
  type AttendanceHeatmapSource,
} from './students-360/service.js';
import type { Students360Store } from './students-360/store.js';

/**
 * Options for the student plugin.
 */
export interface StudentPluginOptions {
  /** Student repository implementation */
  repository: StudentRepository;
  /** Route prefix for students (default: '/students') */
  prefix?: string;
  /** Enrollment repository (default: Pg when DATABASE_URL, else in-memory) */
  enrollmentRepository?: EnrollmentRepository;
  /** Route prefix for enrollments (default: '/enrollments') */
  enrollmentPrefix?: string;
  /** Import job queue (default: in-process queue) */
  importQueue?: ImportQueue;
  /** Set false to skip enrollment + import routes (unit tests of student routes only) */
  registerEnrollmentAndImport?: boolean;
  /** G-914 persistence (default: Pg when DATABASE_URL, else in-memory) */
  students360Store?: Students360Store;
  /** G-914 photo blobs (default: S3/MinIO when bucket set, else local disk) */
  studentBlobStore?: StudentBlobStore;
  /** G-914 heatmap source (default: lazy `fastify.attendanceService`) */
  attendanceHeatmap?: AttendanceHeatmapSource;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    studentService: StudentService;
    enrollmentService: EnrollmentService;
  }
}

/**
 * Fastify plugin that registers the student service and routes.
 */
export const studentPlugin = fp(
  async function studentPluginImpl(fastify: FastifyInstance, options: StudentPluginOptions) {
    const {
      repository,
      prefix = '/students',
      enrollmentPrefix = '/enrollments',
      registerEnrollmentAndImport = true,
    } = options;

    const studentService = new StudentService(repository);
    fastify.decorate('studentService', studentService);

    await registerStudentRoutes(fastify, {
      studentService,
      prefix,
    });

    const attendanceHeatmap: AttendanceHeatmapSource = options.attendanceHeatmap ?? {
      async listStudentAttendanceInRange(tenantId, studentId, startDate, endDate) {
        const att =
          (fastify as FastifyInstance & { attendanceService?: AttendanceHeatmapSource })
            .attendanceService ?? getBoundAttendanceHeatmapSource();
        if (!att?.listStudentAttendanceInRange) return [];
        return att.listStudentAttendanceInRange(tenantId, studentId, startDate, endDate);
      },
    };
    const student360Service = new Students360Service({
      students: repository,
      store: options.students360Store ?? createStudents360Store(),
      blobs: options.studentBlobStore ?? createStudentBlobStore(),
      attendance: attendanceHeatmap,
    });
    await registerStudents360Routes(fastify, { service: student360Service, prefix });

    if (!registerEnrollmentAndImport) return;

    const enrollmentRepository = options.enrollmentRepository ?? createEnrollmentRepository();
    const enrollmentService = new EnrollmentService(enrollmentRepository);
    fastify.decorate('enrollmentService', enrollmentService);
    await registerEnrollmentRoutes(fastify, {
      enrollmentService,
      prefix: enrollmentPrefix,
    });

    const importService = new ImportService({
      studentRepository: new CoreRepositoryImportAdapter(repository),
      importQueue: options.importQueue ?? new InMemoryImportQueue(),
    });
    await registerImportRoutes(fastify, { importService, prefix });
  },
  {
    name: '@proctira/backend-student',
    fastify: '5.x',
    dependencies: [],
  },
);
