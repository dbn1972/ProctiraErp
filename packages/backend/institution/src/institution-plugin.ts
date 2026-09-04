/**
 * Fastify Institution Plugin
 *
 * Registers institution routes and service on a Fastify instance.
 * Provides the institution service as a decorator for other plugins to use.
 * Also registers area hierarchy routes for geographic area management.
 */
import type { PrismaClient } from '@proctira/database';
import { getPrismaClient } from '@proctira/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { AcademicPeriodService, registerAcademicPeriodRoutes } from './academic-period/index.js';
import { AreaHierarchyService } from './area-hierarchy/area-hierarchy.service.js';
import type { AreaHierarchyDbClient } from './area-hierarchy/area-hierarchy.service.js';
import { registerAreaHierarchyRoutes } from './area-hierarchy/area-hierarchy.routes.js';
import { BoardService, registerBoardRoutes } from './board/index.js';
import {
  ClassService,
  GradeService,
  SubjectService,
  registerClassRoutes,
  registerGradeRoutes,
  registerSubjectRoutes,
} from './education/index.js';
import type { InstitutionRepository } from './institution-repository.js';
import { InstitutionService } from './institution-service.js';
import { registerInstitutionRoutes } from './routes.js';

/**
 * Options for the institution plugin.
 */
export interface InstitutionPluginOptions {
  /** Institution repository implementation */
  repository: InstitutionRepository;
  /**
   * Database client for area hierarchy operations.
   * When omitted, falls back to `prisma` (or the DATABASE_URL singleton) so
   * GeographicArea routes mount whenever Postgres is available — same pattern
   * as boards/periods/grades/classes/subjects.
   */
  areaHierarchyDb?: AreaHierarchyDbClient;
  /** Prisma client for academic structure. Falls back to DATABASE_URL singleton. */
  prisma?: PrismaClient;
  /** Route prefix for institutions (default: '/institutions') */
  prefix?: string;
  /** Route prefix for areas (default: '/areas') */
  areaPrefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    institutionService: InstitutionService;
    areaHierarchyService?: AreaHierarchyService;
  }
}

/**
 * Fastify plugin that registers the institution service and routes.
 * Registers area hierarchy routes when areaHierarchyDb or Prisma is available.
 */
export const institutionPlugin = fp(
  async function institutionPluginImpl(
    fastify: FastifyInstance,
    options: InstitutionPluginOptions,
  ) {
    const {
      repository,
      areaHierarchyDb,
      prefix = '/institutions',
      areaPrefix = '/areas',
    } = options;

    // Create institution service instance
    const institutionService = new InstitutionService(repository);

    // Decorate fastify with the institution service
    fastify.decorate('institutionService', institutionService);

    // Register institution routes
    await registerInstitutionRoutes(fastify, {
      institutionService,
      prefix,
    });

    const prisma = options.prisma ?? (process.env['DATABASE_URL'] ? getPrismaClient() : undefined);

    // GeographicArea lives on the same Prisma client as boards/periods/etc.
    // Prefer an explicit areaHierarchyDb (tests / custom clients), else Prisma.
    const areaDb: AreaHierarchyDbClient | undefined =
      areaHierarchyDb ?? (prisma as AreaHierarchyDbClient | undefined);

    if (areaDb) {
      const areaHierarchyService = new AreaHierarchyService(areaDb);
      fastify.decorate('areaHierarchyService', areaHierarchyService);

      await registerAreaHierarchyRoutes(fastify, {
        areaHierarchyService,
        prefix: areaPrefix,
      });
    }

    if (prisma) {
      await registerBoardRoutes(fastify, { service: new BoardService({ prisma }) });
      await registerAcademicPeriodRoutes(fastify, {
        service: new AcademicPeriodService({ prisma }),
      });
      await registerGradeRoutes(fastify, { service: new GradeService({ prisma }) });
      await registerClassRoutes(fastify, { service: new ClassService({ prisma }) });
      await registerSubjectRoutes(fastify, { service: new SubjectService({ prisma }) });
    }
  },
  {
    name: '@proctira/backend-institution',
    fastify: '4.x',
    dependencies: [],
  },
);
