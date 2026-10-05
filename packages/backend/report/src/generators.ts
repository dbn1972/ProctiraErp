import { createHash } from 'node:crypto';

import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

import type { CatalogueReportFormat, CatalogueReportKey } from './catalogue.js';
import { catalogueEntryFor } from './catalogue.js';
import { buildXlsx } from './xlsx-writer.js';

export interface ReportColumn {
  name: string;
  label: string;
}

export interface ReportTable {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * PRC-M382: OWASP CSV-injection guard — text starting with = + - @ tab or CR is
 * prefixed with a single quote; numbers and plain numeric strings are untouched.
 */
export function csvSafeText(text: string): string {
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return csvSafeText(String(value));
}

/**
 * PRC-M341: neutralise spreadsheet formula injection. Cells starting with
 * `=`, `+`, `-`, `@`, TAB or CR are prefixed with a single quote so Excel /
 * Sheets treat them as text, then RFC 4180 quoting is applied.
 */
export function escapeCsv(field: string): string {
  const safe = /^[=+\-@\t\r]/.test(field) ? `'${field}` : field;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function generateCsv(table: ReportTable): Buffer {
  const headers = table.columns.map((c) => c.label);
  const lines = [headers.map((h) => escapeCsv(csvSafeText(h))).join(',')];
  for (const row of table.rows) {
    lines.push(table.columns.map((col) => escapeCsv(cell(row[col.name]))).join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

export function generateXlsx(table: ReportTable, title: string): Buffer {
  const headers = table.columns.map((c) => c.label);
  const rows = table.rows.map((row) => table.columns.map((col) => cell(row[col.name])));
  return buildXlsx(headers, rows, title.slice(0, 31) || 'Report');
}

export async function generatePdf(table: ReportTable, title: string): Promise<Buffer> {
  const doc = new PdfDocument({ title, author: 'ProctiraERP Reports' });
  const flow = new PdfFlow(doc, {
    header: title,
    footer: 'ProctiraERP report — page {page} of {pages}',
  });
  flow.heading(title, 16);
  flow.table(
    table.columns.map((c) => ({ header: c.label, weight: 1 })),
    table.rows.map((row) => table.columns.map((col) => cell(row[col.name]))),
  );
  return flow.finish();
}

export async function generateReportBytes(
  key: CatalogueReportKey,
  format: CatalogueReportFormat,
  table: ReportTable,
): Promise<Buffer> {
  const title = catalogueEntryFor(key).name;
  if (format === 'csv') return generateCsv(table);
  if (format === 'xlsx') return generateXlsx(table, title);
  return generatePdf(table, title);
}

export function contentTypeFor(format: CatalogueReportFormat): string {
  if (format === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (format === 'pdf') return 'application/pdf';
  return 'text/csv; charset=utf-8';
}

export function filenameFor(key: CatalogueReportKey, format: CatalogueReportFormat): string {
  return `${key}.${format}`;
}
