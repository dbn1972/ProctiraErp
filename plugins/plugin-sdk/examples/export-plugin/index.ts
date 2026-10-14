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

/** Options the host may thread through payload metadata. */
interface ExportConfig {
  delimiter?: string;
  includeHeaders?: boolean;
  maxRows?: number;
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
      async (payload, _context): Promise<HookResult<ExportResult>> => {
        // Only handle our custom format
        if (payload.format !== 'custom-csv') {
          return { success: true, executionTimeMs: 0 };
        }

        // NOTE: the SDK HookContext does not yet thread tenant configuration
        // into hook invocation, so the example reads its options from the
        // payload metadata (populated by the host) and falls back to the
        // manifest configSchema defaults. The important behaviours — CSV
        // formula-injection neutralisation and the row cap — are always
        // enforced regardless of configuration.
        const exportConfig = (payload.metadata as { exportConfig?: ExportConfig }).exportConfig;
        const delimiter = exportConfig?.delimiter ?? ',';
        const includeHeaders = exportConfig?.includeHeaders ?? true;
        const maxRows = exportConfig?.maxRows ?? 50000;

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

        // Enforce the configured row cap (fail closed rather than silently
        // exporting an unbounded file).
        if (rows.length > maxRows) {
          return {
            success: false,
            errors: [
              {
                field: 'maxRows',
                message: `Export of ${rows.length} rows exceeds the configured maximum of ${maxRows}.`,
                code: 'EXPORT_ROW_LIMIT_EXCEEDED',
              },
            ],
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
 * Escape a value for CSV output with spreadsheet formula-injection
 * neutralisation (PRC-L484).
 *
 * A cell whose first character is one of `= + - @` or a leading tab/CR is a
 * potential formula in Excel / Google Sheets / LibreOffice. We prefix such a
 * cell with a single apostrophe so the spreadsheet treats it as text and never
 * executes it. We then apply standard RFC-4180 quoting for the delimiter,
 * embedded quotes, and newlines (including a bare carriage return).
 */
export function escapeCSV(value: string, delimiter: string): string {
  let sanitised = value;
  if (/^[=+\-@\t\r]/.test(sanitised)) {
    sanitised = `'${sanitised}`;
  }
  if (
    sanitised.includes(delimiter) ||
    sanitised.includes('"') ||
    sanitised.includes('\n') ||
    sanitised.includes('\r')
  ) {
    return `"${sanitised.replace(/"/g, '""')}"`;
  }
  return sanitised;
}
