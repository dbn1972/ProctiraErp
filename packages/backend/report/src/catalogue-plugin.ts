import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createReportBlobStore, type ReportBlobStore } from './blob-store.js';
import { registerCatalogueRoutes } from './catalogue-routes.js';
import { CatalogueService } from './catalogue-service.js';
import { createReportStore } from './create-report-store.js';
import type { ReportStore } from './report-store.js';
import { createReportScheduler, type ReportScheduler } from './scheduler.js';

export interface ReportCataloguePluginOptions {
  store?: ReportStore;
  blobStore?: ReportBlobStore;
  prefix?: string;
  /** Skip the in-process scheduler (tests). */
  disableScheduler?: boolean;
  schedulerIntervalMs?: number;
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
    const service = new CatalogueService(store, blobStore);
    fastify.decorate('reportCatalogueService', service);

    registerCatalogueRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/reports',
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
