import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createReportBlobStore, type ReportBlobStore } from './blob-store.js';
import { registerCatalogueRoutes } from './catalogue-routes.js';
import { CatalogueService } from './catalogue-service.js';
import { createReportStore } from './create-report-store.js';
import type { ReportStore } from './report-store.js';
import {
  EmailScheduleDelivery,
  NoopScheduleDelivery,
  type ScheduleDeliveryPort,
  type ScheduleEmailSender,
} from './schedule-delivery.js';
import { createReportScheduler, type ReportScheduler } from './scheduler.js';

export interface ReportCataloguePluginOptions {
  store?: ReportStore;
  blobStore?: ReportBlobStore;
  prefix?: string;
  /** Skip the in-process scheduler (tests). */
  disableScheduler?: boolean;
  schedulerIntervalMs?: number;
  /**
   * PRC-M338: delivery port for schedule recipients. Takes precedence over `emailSender`.
   */
  delivery?: ScheduleDeliveryPort;
  /**
   * PRC-M338: the notification service's email sender (same `EmailSender` shape). When
   * set, recipients get an email through it. Without `delivery` or `emailSender` nothing
   * is sent and nothing is counted as delivered (previously an in-memory port was used
   * and every schedule with recipients was reported as delivered).
   */
  emailSender?: ScheduleEmailSender;
  /** Absolute web origin for links in delivery emails (e.g. https://school.example). */
  appBaseUrl?: string;
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
    const delivery: ScheduleDeliveryPort =
      options.delivery ??
      (options.emailSender
        ? new EmailScheduleDelivery(options.emailSender, { appBaseUrl: options.appBaseUrl })
        : new NoopScheduleDelivery());
    const service = new CatalogueService(store, blobStore, delivery, {
      error: (message, context) => fastify.log.error(context, message),
      info: (message, context) => fastify.log.info(context, message),
    });
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
