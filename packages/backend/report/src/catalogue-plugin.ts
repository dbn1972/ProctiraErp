import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createReportBlobStore, type ReportBlobStore } from './blob-store.js';
import { registerCatalogueRoutes } from './catalogue-routes.js';
import { CatalogueService } from './catalogue-service.js';
import { createReportStore } from './create-report-store.js';
import type { ReportAuditPort } from './report-audit.js';
import type { ReportStore } from './report-store.js';
import { createReportScheduler, type ReportScheduler } from './scheduler.js';
import { prepareReportDownloadSigningAtStartup } from './signed-download.js';

export interface ReportCataloguePluginOptions {
  store?: ReportStore;
  blobStore?: ReportBlobStore;
  prefix?: string;
  /** Skip the in-process scheduler (tests). */
  disableScheduler?: boolean;
  schedulerIntervalMs?: number;
  /**
   * PRC-L338: trusted public API base for absolute report download links.
   * Comes from deployment configuration, never from the request. Defaults to
   * PUBLIC_API_BASE_URL / PUBLIC_BASE_URL (resolved in the routes).
   */
  publicApiBaseUrl?: string;
  /**
   * PRC-L340 (topic 5): audit sink for report GENERATE / DOWNLOAD / SCHEDULE
   * events. The gateway wires a real sink; defaults to a no-op so the catalogue
   * works when audit is not configured. Event emission only — not the durable
   * keyed hash chain (B07).
   */
  audit?: ReportAuditPort;
}

declare module 'fastify' {
  interface FastifyInstance {
    reportCatalogueService?: CatalogueService;
    reportScheduler?: ReportScheduler;
  }
}

export const reportCataloguePlugin = fp(
  async function reportCataloguePluginImpl(
    fastify: FastifyInstance,
    options: ReportCataloguePluginOptions = {},
  ) {
    const store = options.store ?? createReportStore().store;
    const blobStore = options.blobStore ?? (await createReportBlobStore());
    // PRC-L337: fail-closed check of the dedicated report download signing
    // secret at boot (production-like logs an actionable error; dev mints an
    // ephemeral in-memory key once).
    prepareReportDownloadSigningAtStartup(process.env, {
      warn: (obj, msg) => {
        fastify.log.warn(obj, msg);
      },
      error: (obj, msg) => {
        fastify.log.error(obj, msg);
      },
    });
    const service = new CatalogueService(store, blobStore);
    fastify.decorate('reportCatalogueService', service);

    registerCatalogueRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/reports',
      publicApiBaseUrl: options.publicApiBaseUrl,
      audit: options.audit,
    });

    if (!options.disableScheduler) {
      const scheduler = createReportScheduler({
        service,
        intervalMs: options.schedulerIntervalMs,
        logger: {
          info: (obj, msg) => fastify.log.info(obj, msg),
          error: (obj, msg) => fastify.log.error(obj, msg),
        },
      });
      scheduler.start();
      fastify.decorate('reportScheduler', scheduler);
      fastify.addHook('onClose', () => {
        scheduler.stop();
      });
    }
  },
  {
    name: '@proctira/backend-report-catalogue',
    fastify: '5.x',
    dependencies: [],
  },
);
