/**
 * Fastify Attendance Plugin
 *
 * Registers attendance routes and service on a Fastify instance.
 * Provides the attendance service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 9.1: Student attendance recording with configurable mode
 * - 9.2: Staff attendance with leave types
 * - 9.3: Pre-populate roster from enrollment
 * - 9.7: Date validation (no future dates)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AttendanceRepository } from './attendance-repository.js';
import { AttendanceService } from './attendance-service.js';
import { registerAttendanceOpsRoutes } from './ops-routes.js';
import { AttendanceOpsService } from './ops-service.js';
import type { AttendanceOpsStore } from './ops-store.js';
import { createAttendanceOpsStore } from './repository-factory.js';
import { registerAttendanceRoutes } from './routes.js';

/**
 * Options for the attendance plugin.
 */
export interface AttendancePluginOptions {
  /** Attendance repository implementation */
  repository: AttendanceRepository;
  /** G-919 ops store (optional — factory default) */
  opsStore?: AttendanceOpsStore;
  /** Route prefix for attendance (default: '/attendance') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    attendanceService: AttendanceService;
  }
}

/**
 * Fastify plugin that registers the attendance service and routes.
 */
export const attendancePlugin = fp(
  async function attendancePluginImpl(fastify: FastifyInstance, options: AttendancePluginOptions) {
    const { repository, prefix = '/attendance' } = options;

    // Create attendance service instance
    const attendanceService = new AttendanceService(repository);
    const opsStore = options.opsStore ?? createAttendanceOpsStore();
    const opsService = new AttendanceOpsService(opsStore, repository);

    // Decorate fastify with the attendance service
    fastify.decorate('attendanceService', attendanceService);

    // Register attendance routes
    await registerAttendanceRoutes(fastify, {
      attendanceService,
      prefix,
    });
    await registerAttendanceOpsRoutes(fastify, { opsService, prefix });
  },
  {
    name: '@proctira/backend-attendance',
    fastify: '5.x',
    dependencies: [],
  },
);
