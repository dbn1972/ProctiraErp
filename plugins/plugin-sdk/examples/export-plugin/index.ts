/**
 * Example: Export Plugin
 *
 * Demonstrates how to build a plugin that adds custom export formats
 * and data transformation capabilities.
 *
 * This plugin:
 * - Hooks into the 'export' extension point to add a custom CSV format
 * - Subscribes to 'report.generated' events for post-processing
 * - Provides a UI slot for export configuration in the reports section
 */
import { definePlugin, defineHook, defineEventHandler, defineUISlot } from '../../src/index.js';
import type { HookResult } from '../../src/index.js';

interface ExportPayload {
  entityId: string;
  entityType: string;
  format: string;
  data: Record<string, unknown>[];
  metadata: {
    reportName: string;
    generatedBy: string;
    generatedAt: string;
    filters: Record<string, unknown>;
  };
}

interface ExportResult {
  content: string;
  mimeType: string;
  filename: string;
}

export default definePlugin({
  manifest: {
    name: 'custom-csv-export',
    owner: 'proctira-official',
    version: '1.0.0',
    supportedProductVersions: '>=1.0.0 <2.0.0',
    requiredPermissions: ['report.read', 'export.write', 'student.read', 'institution.read'],
    requiredExtensionPoints: ['report.export'],
    configSchema: {
      type: 'object',
      properties: {
        delimiter: {
          type: 'string',
          description: 'CSV delimiter character',
          default: ',',
          enum: [',', ';', '\t', '|'],
        },
        includeHeaders: {
          type: 'boolean',
          description: 'Whether to include column headers',
          default: true,
        },
        dateFormat: {
          type: 'string',
          description: 'Date format for export',
          default: 'YYYY-MM-DD',
        },
        encoding: {
          type: 'string',
          description: 'Output file encoding',
          default: 'utf-8',
          enum: ['utf-8', 'utf-16', 'iso-8859-1'],
        },
        maxRows: {
          type: 'number',
          description: 'Maximum rows per export file',
          default: 50000,
        },
      },
    },
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all export operations including format, row count, and file size',
  },

  hooks: [
    defineHook<ExportPayload, ExportResult>(
      'report.export',
      async (payload, context): Promise<HookResult<ExportResult>> => {
        // Only handle our custom format
        if (payload.format !== 'custom-csv') {
          return { success: true, executionTimeMs: 0 };
        }

        const delimiter = ','; // Would come from plugin configuration
        const includeHeaders = true;

        // Transform data to CSV
        const rows = payload.data;
        if (rows.length === 0) {
          return {
            success: true,
            data: {
              content: '',
              mimeType: 'text/csv',
              filename: `${payload.metadata.reportName}.csv`,
            },
            executionTimeMs: 1,
          };
        }

        const headers = Object.keys(rows[0]!);
        const lines: string[] = [];

        if (includeHeaders) {
          lines.push(headers.map((h) => escapeCSV(h, delimiter)).join(delimiter));
        }

        for (const row of rows) {
          const values = headers.map((h) => escapeCSV(String(row[h] ?? ''), delimiter));
          lines.push(values.join(delimiter));
        }

        const content = lines.join('\n');

        return {
          success: true,
          data: {
            content,
            mimeType: 'text/csv; charset=utf-8',
            filename: `${payload.metadata.reportName}_${payload.metadata.generatedAt}.csv`,
          },
          executionTimeMs: rows.length * 0.01, // Approximate
        };
      },
      { priority: 100 },
    ),
  ],

  eventHandlers: [
    defineEventHandler('export.completed', async (event, context): Promise<void> => {
      // Log export completion for analytics
      console.log(
        `[custom-csv-export] Export completed: ${event.data['format']} ` +
          `(${event.data['rowCount']} rows, ${event.data['fileSize']} bytes)`,
      );
    }),
  ],

  uiSlots: [
    defineUISlot('report-section.export-options', 'custom-csv-export-config', {
      label: 'Custom CSV Export',
      icon: 'file-csv',
      order: 50,
    }),
  ],
});

/**
 * Escape a value for CSV output.
 */
function escapeCSV(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
