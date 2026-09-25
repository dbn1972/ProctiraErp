/**
 * Fastify Institution Plugin
 *
 * Registers institution routes and service on a Fastify instance.
 * Provides the institution service as a decorator for other plugins to use.
 * Also registers area hierarchy routes for geographic area management.
 *
 * G-901: also mounts the academics sub-domains that were previously defined in
 * this package but unreachable through the gateway — academic periods, grades,
 * classes, subjects / institution-subjects and the infrastructure hierarchy.
 * Pass `academics: false` to opt out (e.g. a standalone institution-only boot).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import {
  AcademicCalendarService,
  type RolloverExtras,
} from './academic-calendar/calendar-service.js';
import { registerAcademicCalendarRoutes } from './academic-calendar/routes.js';
import { registerAcademicPeriodRoutes } from './academic-period/academic-period-routes.js';
import { AcademicPeriodService } from './academic-period/academic-period-service.js';
import { createAcademicsDeps, type AcademicsDeps } from './academics-factory.js';
import { registerAreaHierarchyRoutes } from './area-hierarchy/area-hierarchy.routes.js';
import type { AreaHierarchyDbClient } from './area-hierarchy/area-hierarchy.service.js';
import { AreaHierarchyService } from './area-hierarchy/area-hierarchy.service.js';
import { registerClassRoutes } from './education/class-routes.js';
import { ClassService } from './education/class-service.js';
import { registerGradeRoutes } from './education/grade-routes.js';
import { GradeService } from './education/grade-service.js';
import { registerSubjectRoutes } from './education/subject-routes.js';
import { SubjectService } from './education/subject-service.js';
import { registerInfrastructureRoutes } from './infrastructure/routes.js';
import { InfrastructureService } from './infrastructure/service.js';
import type { InstitutionRepository } from './institution-repository.js';
import { InstitutionService } from './institution-service.js';
import { registerInstitutionRoutes } from './routes.js';
import { tenantContext } from './tenant-context.js';

/**
 * Options for the institution plugin.
 */
export interface InstitutionPluginOptions {
  /** World-class year rollover fee/timetable/LMS/audit hooks. */
  rolloverExtras?: RolloverExtras;
  /** Institution repository implementation */
  repository: InstitutionRepository;
  /** Database client for area hierarchy operations (optional - if not provided, area routes are not registered) */
  areaHierarchyDb?: AreaHierarchyDbClient;
  /** Route prefix for institutions (default: '/institutions') */
  prefix?: string;
  /** Route prefix for areas (default: '/areas') */
  areaPrefix?: string;
  /**
   * G-901 — mount academic periods / grades / classes / subjects /
   * infrastructure. Defaults to `true`. Provide an {@link AcademicsDeps}
   * object to inject persistence (tests), or `false` to skip.
   */
  academics?: boolean | AcademicsDeps;
  /** Prefixes for the academics routes (defaults shown). */
  academicsPrefixes?: Partial<{
    academicPeriods: string;
    grades: string;
    classes: string;
    subjects: string;
    institutionSubjects: string;
    infrastructure: string;
  }>;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    institutionService: InstitutionService;
    areaHierarchyService?: AreaHierarchyService;
    academicPeriodService?: AcademicPeriodService;
    academicCalendarService?: AcademicCalendarService;
    infrastructureService?: InfrastructureService;
  }
}

/**
 * Fastify plugin that registers the institution service and routes.
 * Optionally registers area hierarchy routes if areaHierarchyDb is provided.
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
      academics = true,
      academicsPrefixes = {},
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

    const registerAreaRoutes = async (db: AreaHierarchyDbClient) => {
      const areaHierarchyService = new AreaHierarchyService(db);
      fastify.decorate('areaHierarchyService', areaHierarchyService);

      await registerAreaHierarchyRoutes(fastify, {
        areaHierarchyService,
        prefix: areaPrefix,
      });
    };

    if (academics === false) {
      // Area routes need an explicit client when academics are skipped.
      if (areaHierarchyDb) await registerAreaRoutes(areaHierarchyDb);
      return;
    }

    const deps: AcademicsDeps =
      academics === true ? createAcademicsDeps({ institutionRepository: repository }) : academics;

    /**
     * Area hierarchy shares the academics persistence.
     *
     * These routes used to register only when a caller passed
     * `areaHierarchyDb`, and no caller ever did: `apps/api-gateway` composes
     * this plugin without it. So `/areas/*` was never mounted, the web
     * institution module's `GET /areas/tree` was default-denied (403) by the
     * gateway's unmapped-resource rule, and `apps/web` swallowed that error
     * and substituted three fabricated areas. Those invented areas were what
     * users saw in the area filter, the "Blocks / Areas" KPI and the create
     * form — and an invented id cannot satisfy
     * `institutions.area_id REFERENCES geographic_areas(id)`.
     *
     * `deps.prisma` is the tenant-bound client (`createTenantBoundPrisma`), so
     * every area read/write runs inside `withTenantTransaction` under FORCE
     * RLS, matching the guarantee the academics services already get.
     */
    await registerAreaRoutes(areaHierarchyDb ?? (deps.prisma as unknown as AreaHierarchyDbClient));

    // Request-scoped tenant for stores whose contract has no tenant argument
    // (infrastructure). Callback-style hook so `run` wraps the rest of the
    // request lifecycle, mirroring @fastify/request-context.
    fastify.addHook('onRequest', (request, _reply, done) => {
      const tenantId =
        (request as { tenantId?: string }).tenantId ??
        (request as { user?: { tenantId?: string } }).user?.tenantId;
      tenantContext.run({ tenantId }, done);
    });

    const academicPeriodService = new AcademicPeriodService({ prisma: deps.prisma });
    fastify.decorate('academicPeriodService', academicPeriodService);
    await registerAcademicPeriodRoutes(fastify, {
      service: academicPeriodService,
      prefix: academicsPrefixes.academicPeriods ?? '/academic-periods',
    });

    const academicCalendarService = new AcademicCalendarService({
      prisma: deps.prisma,
      store: deps.calendarStore,
      rolloverExtras: options.rolloverExtras,
    });
    fastify.decorate('academicCalendarService', academicCalendarService);
    await registerAcademicCalendarRoutes(fastify, {
      service: academicCalendarService,
      prefix: academicsPrefixes.academicPeriods ?? '/academic-periods',
    });

    await registerGradeRoutes(fastify, {
      service: new GradeService({ prisma: deps.prisma }),
      prefix: academicsPrefixes.grades ?? '/grades',
    });

    await registerClassRoutes(fastify, {
      service: new ClassService({ prisma: deps.prisma }),
      prefix: academicsPrefixes.classes ?? '/classes',
    });

    await registerSubjectRoutes(fastify, {
      service: new SubjectService({ prisma: deps.prisma }),
      subjectPrefix: academicsPrefixes.subjects ?? '/subjects',
      institutionSubjectPrefix: academicsPrefixes.institutionSubjects ?? '/institution-subjects',
    });

    const infrastructureService = new InfrastructureService({
      store: deps.infrastructureStore,
      conditionStore: deps.conditionStore,
    });
    fastify.decorate('infrastructureService', infrastructureService);
    await registerInfrastructureRoutes(fastify, {
      infrastructureService,
      prefix: academicsPrefixes.infrastructure ?? '/infrastructure',
    });
  },
  {
    name: '@proctira/backend-institution',
    fastify: '5.x',
    dependencies: [],
  },
);
