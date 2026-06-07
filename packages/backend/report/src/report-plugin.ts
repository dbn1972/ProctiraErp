/**
 * Fastify Report Engine Plugin
 *
 * Registers report routes and service on a Fastify instance.
 * Provides the report service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 17.1: Configurable report generation with filters, grouping, aggregation
 * - 17.2: Multi-format export (XLSX, PDF, CSV)
 * - 17.3: Report card templates with merge fields, conditional sections, branding
 * - 17.4: Queue long-running reports for background processing
 * - 17.5: RBAC-scoped data filtering
 * - 17.6: Scheduled report generation with delivery
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ReportRepository, ReportDataSource } from './report-repository.js';
import {
  ReportService,
  type XlsxExporter,
  type PdfExporter,
  type CsvExporter,
  type ReportQueuePublisher,
  type ReportFileStorage,
  type ReportServiceConfig,
} from './report-service.js';
import { registerReportRoutes } from './routes.js';

/**
 * Options for the report plugin.
 */
export interface ReportPluginOptions {
  /** Report repository implementation */
  repository: ReportRepository;
  /** Data source for fetching report data */
  dataSource: ReportDataSource;
  /** XLSX exporter implementation (optional - uses default if not provided) */
  xlsxExporter?: XlsxExporter;
  /** PDF exporter implementation (optional - uses default if not provided) */
  pdfExporter?: PdfExporter;
  /** CSV exporter implementation (optional - uses default if not provided) */
  csvExporter?: CsvExporter;
  /** Queue publisher for background processing (optional) */
  queuePublisher?: ReportQueuePublisher;
  /** File storage for generated reports (optional) */
  fileStorage?: ReportFileStorage;
  /** Service configuration overrides */
  config?: Partial<ReportServiceConfig>;
  /** Route prefix for reports (default: '/reports') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    reportService: ReportService;
  }
}

/**
 * Fastify plugin that registers the report service and routes.
 */
export const reportPlugin = fp(
  async function reportPluginImpl(
    fastify: FastifyInstance,
    options: ReportPluginOptions,
  ) {
    const {
      repository,
      dataSource,
      xlsxExporter,
      pdfExporter,
      csvExporter,
      queuePublisher,
      fileStorage,
      config,
      prefix = '/reports',
    } = options;

    // Create report service instance
    const reportService = new ReportService(
      repository,
      dataSource,
      xlsxExporter,
      pdfExporter,
      csvExporter,
      queuePublisher,
      fileStorage,
      config,
    );

    // Decorate fastify with the report service
    fastify.decorate('reportService', reportService);

    // Register report routes
    await registerReportRoutes(fastify, {
      reportService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-report',
    fastify: '4.x',
    dependencies: [],
  },
);
