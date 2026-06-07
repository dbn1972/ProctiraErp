/**
 * Fastify Student Plugin
 *
 * Registers student routes and service on a Fastify instance.
 * Provides the student service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { StudentRepository } from './student-repository.js';
import { StudentService } from './student-service.js';
import { registerStudentRoutes } from './routes.js';

/**
 * Options for the student plugin.
 */
export interface StudentPluginOptions {
  /** Student repository implementation */
  repository: StudentRepository;
  /** Route prefix for students (default: '/students') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    studentService: StudentService;
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
    const { repository, prefix = '/students' } = options;

    // Create student service instance
    const studentService = new StudentService(repository);

    // Decorate fastify with the student service
    fastify.decorate('studentService', studentService);

    // Register student routes
    await registerStudentRoutes(fastify, {
      studentService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-student',
    fastify: '4.x',
    dependencies: [],
  },
);
