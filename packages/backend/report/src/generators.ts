import { createHash } from "node:crypto";

import { PdfDocument, PdfFlow } from "@proctira/pdf-lite";

import type { CatalogueReportFormat, CatalogueReportKey } from "./catalogue.js";
import { catalogueEntryFor } from "./catalogue.js";
import { buildXlsx } from "./xlsx-writer.js";

export interface ReportColumn {
  name: string;
  label: string;
}

export interface ReportTable {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCsv(field: string): string {
  if (/[",\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function generateCsv(table: ReportTable): Buffer {
  const headers = table.columns.map((c) => c.label);
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((col) => escapeCsv(cell(row[col.name]))).join(","));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

export function generateXlsx(table: ReportTable, title: string): Buffer {
  const headers = table.columns.map((c) => c.label);
  const rows = table.rows.map((row) => table.columns.map((col) => cell(row[col.name])));
  return buildXlsx(headers, rows, title.slice(0, 31) || "Report");
}

export async function generatePdf(table: ReportTable, title: string): Promise<Buffer> {
  const doc = new PdfDocument({ title, author: "ProctiraERP Reports" });
  const flow = new PdfFlow(doc, {
    header: title,
    footer: "ProctiraERP report — page {page} of {pages}",
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
  if (format === "csv") return generateCsv(table);
  if (format === "xlsx") return generateXlsx(table, title);
  return generatePdf(table, title);
}

export function contentTypeFor(format: CatalogueReportFormat): string {
  if (format === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (format === "pdf") return "application/pdf";
  return "text/csv; charset=utf-8";
}

export function filenameFor(key: CatalogueReportKey, format: CatalogueReportFormat): string {
  return `${key}.${format}`;
}
