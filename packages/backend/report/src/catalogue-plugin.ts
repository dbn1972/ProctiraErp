import { isProductionLike } from '@proctira/common';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createReportBlobStore, type ReportBlobStore } from './blob-store.js';
import { registerCatalogueRoutes } from './catalogue-routes.js';
import { CatalogueService } from './catalogue-service.js';
import { createReportStore } from './create-report-store.js';
import type { DenialAuditCoalescingOptions } from './denial-audit-coalescer.js';
import type { ReportAuditPort } from './report-audit.js';
import type { ReportStore } from './report-store.js';
import {
  EmailScheduleDelivery,
  NoopScheduleDelivery,
  type ScheduleDeliveryPort,
  type ScheduleEmailSender,
} from './schedule-delivery.js';
import { readAllowedRecipientDomains } from './schedule-recipients.js';
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
  /** UAT-9d: denial audit coalescing (window, key bound, clock for tests). */
  denialAudit?: DenialAuditCoalescingOptions;
  /**
   * PRC-L341: school email domains schedule recipients must use. Defaults to
   * REPORT_RECIPIENT_ALLOWED_DOMAINS. With live delivery (delivery/emailSender) in a
   * production-like environment and no domains, recipients are refused.
   */
  allowedRecipientDomains?: readonly string[];
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
    const delivery: ScheduleDeliveryPort =
      options.delivery ??
      (options.emailSender
        ? new EmailScheduleDelivery(options.emailSender, { appBaseUrl: options.appBaseUrl })
        : new NoopScheduleDelivery());
    // PRC-L341: once schedules really email links in production, recipients must use
    // a configured school domain.
    const allowedDomains = options.allowedRecipientDomains ?? readAllowedRecipientDomains();
    const requireAllowedDomains =
      isProductionLike(process.env.NODE_ENV) && Boolean(options.delivery ?? options.emailSender);
    const service = new CatalogueService(
      store,
      blobStore,
      delivery,
      {
        error: (message, context) => fastify.log.error(context, message),
        info: (message, context) => fastify.log.info(context, message),
      },
      { allowedDomains, requireAllowedDomains },
    );
    fastify.decorate('reportCatalogueService', service);

    registerCatalogueRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/reports',
      publicApiBaseUrl: options.publicApiBaseUrl,
      audit: options.audit,
      denialAudit: options.denialAudit,
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
