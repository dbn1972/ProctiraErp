import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AcademicVisibilityStore } from './academic-visibility.js';
import type { AdmissionsOffersPort } from './admissions-offers-port.js';
import { createAcademicVisibilityStore } from './create-parent-portal-repository.js';
import type { ParentPortalRepository } from './parent-portal-repository.js';
import {
  ParentPortalService,
  type FeesLedgerPort,
  type ParentPortalAuditActor,
} from './parent-portal-service.js';
import { registerParentPortalRoutes } from './routes.js';

export interface ParentPortalPluginOptions {
  repository: ParentPortalRepository;
  academicStore?: AcademicVisibilityStore;
  admissionsOffers?: AdmissionsOffersPort;
  prefix?: string;
  studentPrefix?: string;
  feesService?: FeesLedgerPort;
  /**
   * PRC-M533: resolves the same-transaction audit actor (userId/userName/ipAddress) from the
   * Fastify request for the 6 regulated mutation call sites (consent decide/withdraw/supersede,
   * link create, invoice void, payment record). Absent ⇒ no audit row is appended for any of
   * them (the mutations themselves are unaffected) — wired at the gateway registration site,
   * mirroring fees-plugin.ts's buildPaymentAuditBinder/buildMoneyAuditSink convention.
   */
  auditActor?: (request: FastifyRequest) => ParentPortalAuditActor;
}

declare module 'fastify' {
  interface FastifyInstance {
    parentPortalService: ParentPortalService;
  }
}

export const parentPortalPlugin = fp(
  async function parentPortalPluginImpl(
    fastify: FastifyInstance,
    options: ParentPortalPluginOptions,
  ) {
    const {
      repository,
      academicStore,
      admissionsOffers,
      prefix = '/parent-portal',
      studentPrefix = '/student-portal',
      feesService,
      auditActor,
    } = options;
    const parentPortalService = new ParentPortalService(
      repository,
      academicStore ?? createAcademicVisibilityStore(),
      feesService,
    );
    fastify.decorate('parentPortalService', parentPortalService);
    await registerParentPortalRoutes(fastify, {
      parentPortalService,
      admissionsOffers,
      prefix,
      studentPrefix,
      auditActor,
    });
  },
  {
    name: '@proctira/backend-parent-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
