import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createGradebookExtrasStore } from './extras-factory.js';
import type { GradebookExtrasStore } from './extras-store.js';
import {
  isGradebookSectionMembership,
  type GradebookRepository,
  type GradebookSectionMembership,
} from './gradebook-repository.js';
import {
  GradebookService,
  type GradebookAuditSink,
  type StaffActiveAssignmentCheck,
} from './gradebook-service.js';
import { registerGradebookRoutes } from './routes.js';
import { prepareTranscriptSigningAtStartup } from './signed-download.js';

/**
 * PRC-C006: resolves the student ids a portal caller (parent/guardian/student) may read.
 * Returns the caller's own student id (student) or linked wards (guardian/parent). When absent,
 * portal callers are denied on self-scopable read routes (fail closed).
 */
export interface GradebookStudentBinding {
  listReadableStudentIds(tenantId: string, actorUserId: string): Promise<string[]>;
}

export interface GradebookPluginOptions {
  repository: GradebookRepository;
  extras?: GradebookExtrasStore;
  prefix?: string;
  /** PRC-C006: portal self-scope binding. */
  studentBinding?: GradebookStudentBinding;
  /** PRC-M266: durable audit writer (shared audit log). */
  auditSink?: GradebookAuditSink | null;
  /**
   * PRC-H066: teacher-section / student-enrollment lookups for grade writes. Defaults to the
   * repository when it implements them (Pg + in-memory both do). When none is available,
   * production-like envs fail closed (503) on grade writes.
   */
  sectionMembership?: GradebookSectionMembership | null;
  /** PRC-H066: section teachers must also hold an active staff assignment at the school. */
  staffHasActiveAssignmentAt?: StaffActiveAssignmentCheck | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    gradebookService: GradebookService;
  }
}

export const gradebookPlugin = fp(
  async function gradebookPluginImpl(fastify: FastifyInstance, options: GradebookPluginOptions) {
    prepareTranscriptSigningAtStartup(process.env, {
      warn: (obj, msg) => {
        fastify.log.warn(obj, msg);
      },
      error: (obj, msg) => {
        fastify.log.error(obj, msg);
      },
    });
    const extras = options.extras ?? createGradebookExtrasStore();
    const service = new GradebookService(options.repository, extras, {
      auditSink: options.auditSink ?? null,
      sectionMembership:
        options.sectionMembership ??
        (isGradebookSectionMembership(options.repository) ? options.repository : null),
      staffHasActiveAssignmentAt: options.staffHasActiveAssignmentAt ?? null,
    });
    fastify.decorate('gradebookService', service);
    await registerGradebookRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/gradebook',
      studentBinding: options.studentBinding,
    });
  },
  {
    name: '@proctira/backend-gradebook',
    fastify: '5.x',
    dependencies: [],
  },
);
