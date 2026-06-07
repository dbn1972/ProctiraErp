/**
 * Excel Source Connector
 *
 * Extracts data from Excel files (.xlsx, .xls).
 * Supports sheet selection by name or index, header row configuration,
 * and start row offset.
 *
 * Note: In production, this would use a library like 'xlsx' or 'exceljs'.
 * This implementation provides the interface and basic structure.
 */
import type { ExcelSourceConfig } from '../schemas.js';
import type { SourceConnector, ExtractionResult, DataRow } from './types.js';

export class ExcelSourceConnector implements SourceConnector {
  constructor(private readonly config: ExcelSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    const buffer = await this.getFileBuffer();
    if (!buffer) {
      return { rows: [], totalCount: 0 };
    }

    // Parse the Excel file
    const rows = this.parseExcel(buffer);
    return { rows, totalCount: rows.length };
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.filePath && !this.config.fileContent) {
      return { valid: false, error: 'Either filePath or fileContent is required' };
    }
    return { valid: true };
  }

  private async getFileBuffer(): Promise<Buffer | null> {
    if (this.config.fileContent) {
      return Buffer.from(this.config.fileContent, 'base64');
    }
    if (this.config.filePath) {
      const { readFile } = await import('node:fs/promises');
      try {
        return await readFile(this.config.filePath);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Parse Excel buffer into data rows.
   * This is a placeholder that returns empty rows.
   * In production, use 'xlsx' or 'exceljs' library.
   */
  parseExcel(_buffer: Buffer): DataRow[] {
    // Production implementation would:
    // 1. Parse the workbook from buffer
    // 2. Select sheet by name or index
    // 3. Extract headers from first row (if hasHeader)
    // 4. Map remaining rows to DataRow objects
    //
    // Example with xlsx library:
    // const workbook = XLSX.read(buffer, { type: 'buffer' });
    // const sheetName = this.config.sheetName ?? workbook.SheetNames[this.config.sheetIndex ?? 0];
    // const sheet = workbook.Sheets[sheetName];
    // const jsonData = XLSX.utils.sheet_to_json(sheet, { header: hasHeader ? undefined : 1 });
    return [];
  }
}
