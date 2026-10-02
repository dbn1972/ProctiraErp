/**
 * CSV Source Connector
 *
 * Extracts data from CSV files or inline CSV content.
 * Supports configurable delimiter, header row, and encoding.
 */
import type { CsvSourceConfig } from '../schemas.js';

import { assertInlineContentWithinCap, assertNoHostFilePath } from './file-source-policy.js';
import type { SourceConnector, ExtractionResult, DataRow } from './types.js';

export class CsvSourceConnector implements SourceConnector {
  constructor(private readonly config: CsvSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    const content = this.getContent();
    if (!content) {
      return { rows: [], totalCount: 0 };
    }

    const rows = this.parseCsv(content);
    return { rows, totalCount: rows.length };
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    // PRC-C003: reject any host filePath; tenant pipelines must supply inline content.
    try {
      assertNoHostFilePath(this.config.filePath);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid file source',
      };
    }
    if (!this.config.fileContent) {
      return { valid: false, error: 'Inline fileContent is required' };
    }
    return { valid: true };
  }

  private getContent(): string | null {
    // PRC-C003: never read a tenant-supplied host path. Inline content only, size-capped.
    assertNoHostFilePath(this.config.filePath);
    if (this.config.fileContent) {
      assertInlineContentWithinCap(Buffer.byteLength(this.config.fileContent, 'utf-8'));
      return this.config.fileContent;
    }
    return null;
  }

  /**
   * Parse CSV content into data rows.
   * Handles quoted fields, escaped quotes, and configurable delimiters.
   */
  parseCsv(content: string): DataRow[] {
    const delimiter = this.config.delimiter ?? ',';
    const hasHeader = this.config.hasHeader ?? true;
    const lines = this.splitLines(content);

    if (lines.length === 0) {
      return [];
    }

    let headers: string[];
    let dataStartIndex: number;

    if (hasHeader) {
      headers = this.parseLine(lines[0]!, delimiter);
      dataStartIndex = 1;
    } else {
      // Generate column names: col_0, col_1, ...
      const firstLine = this.parseLine(lines[0]!, delimiter);
      headers = firstLine.map((_, i) => `col_${i}`);
      dataStartIndex = 0;
    }

    const rows: DataRow[] = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === '') continue;

      const values = this.parseLine(line, delimiter);
      const row: DataRow = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]!] = values[j] ?? null;
      }
      rows.push(row);
    }

    return rows;
  }

  private splitLines(content: string): string[] {
    return content.split(/\r?\n/);
  }

  private parseLine(line: string, delimiter: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;

      if (inQuotes) {
        if (char === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === delimiter) {
          fields.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }

    fields.push(current);
    return fields;
  }
}
