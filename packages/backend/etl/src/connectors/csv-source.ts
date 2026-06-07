/**
 * CSV Source Connector
 *
 * Extracts data from CSV files or inline CSV content.
 * Supports configurable delimiter, header row, and encoding.
 */
import type { CsvSourceConfig } from '../schemas.js';
import type { SourceConnector, ExtractionResult, DataRow } from './types.js';

export class CsvSourceConnector implements SourceConnector {
  constructor(private readonly config: CsvSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    const content = await this.getContent();
    if (!content) {
      return { rows: [], totalCount: 0 };
    }

    const rows = this.parseCsv(content);
    return { rows, totalCount: rows.length };
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.filePath && !this.config.fileContent) {
      return { valid: false, error: 'Either filePath or fileContent is required' };
    }
    return { valid: true };
  }

  private async getContent(): Promise<string | null> {
    if (this.config.fileContent) {
      return this.config.fileContent;
    }
    if (this.config.filePath) {
      // In production, read from filesystem or object storage
      // For now, return null to indicate file not available in this context
      const { readFile } = await import('node:fs/promises');
      try {
        return await readFile(this.config.filePath, {
          encoding: (this.config.encoding ?? 'utf-8') as BufferEncoding,
        });
      } catch {
        return null;
      }
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
