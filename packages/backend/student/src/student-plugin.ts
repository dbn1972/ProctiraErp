/**
 * Fastify Student Plugin
 *
 * Registers student routes and service on a Fastify instance.
 * Provides the student service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { EnrollmentRepository } from './enrollment/enrollment-repository.js';
import { EnrollmentService } from './enrollment/enrollment-service.js';
import { registerEnrollmentRoutes } from './enrollment/enrollment-routes.js';
import { createEnrollmentRepository } from './repository-factory.js';
import type { StudentRepository } from './student-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';
import { ImportService } from './import/import-service.js';
import { InMemoryImportQueue } from './import/in-memory-import-queue.js';
import { createImportStudentRepository } from './import/import-repository-factory.js';
import { registerImportRoutes } from './import/import-routes.js';
import type { ImportQueue, StudentRepository as ImportStudentRepository } from './import/types.js';

/**
 * Options for the student plugin.
 */
export interface StudentPluginOptions {
  /** Student repository implementation */
  repository: StudentRepository;
  /** Enrollment repository. Defaults to Prisma when DATABASE_URL is set. */
  enrollmentRepository?: EnrollmentRepository;
  /**
   * Import-module student repository (flat StudentRecord shape).
   * Defaults to Prisma when DATABASE_URL is set, else in-memory.
   */
  importStudentRepository?: ImportStudentRepository;
  /** Import job queue. Defaults to in-memory queue. */
  importQueue?: ImportQueue;
  /** Route prefix for students (default: '/students') */
  prefix?: string;
  /** Route prefix for enrollments (default: '/enrollments') */
  enrollmentPrefix?: string;
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
  async function studentPluginImpl(
    fastify: FastifyInstance,
    options: StudentPluginOptions,
  ) {
    const {
      repository,
      enrollmentRepository = createEnrollmentRepository(),
      importStudentRepository = createImportStudentRepository(),
      importQueue = new InMemoryImportQueue(),
      prefix = '/students',
      enrollmentPrefix = '/enrollments',
    } = options;

    // Create student service instance
    const studentService = new StudentService(repository);
    const enrollmentService = new EnrollmentService(enrollmentRepository);

    // Decorate fastify with the student service
    fastify.decorate('studentService', studentService);
    fastify.decorate('enrollmentService', enrollmentService);

    // Register student routes
    await registerStudentRoutes(fastify, {
      studentService,
      prefix,
    });

    await registerEnrollmentRoutes(fastify, {
      enrollmentService,
      prefix: enrollmentPrefix,
    });

    // Bulk import — mount when DATABASE_URL/Prisma is available so imports
    // persist to the real student store. In-memory-only env skips mount to
    // avoid a disconnected secondary student store.
    if (process.env['DATABASE_URL'] || options.importStudentRepository) {
      const importService = new ImportService({
        studentRepository: importStudentRepository,
        importQueue,
      });
      await registerImportRoutes(fastify, {
        importService,
        prefix,
      });
    }
  },
  {
    name: '@proctira/backend-student',
    fastify: '4.x',
    dependencies: [],
  },
);
