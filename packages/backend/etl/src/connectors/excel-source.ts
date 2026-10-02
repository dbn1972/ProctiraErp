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

import { assertInlineContentWithinCap, assertNoHostFilePath } from './file-source-policy.js';
import type { SourceConnector, ExtractionResult, DataRow } from './types.js';

export class ExcelSourceConnector implements SourceConnector {
  constructor(private readonly config: ExcelSourceConfig) {}

  async extract(): Promise<ExtractionResult> {
    const buffer = this.getFileBuffer();
    if (!buffer) {
      return { rows: [], totalCount: 0 };
    }

    // Parse the Excel file
    const rows = this.parseExcel(buffer);
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

  private getFileBuffer(): Buffer | null {
    // PRC-C003: never read a tenant-supplied host path. Inline base64 content only, size-capped.
    assertNoHostFilePath(this.config.filePath);
    if (this.config.fileContent) {
      const buffer = Buffer.from(this.config.fileContent, 'base64');
      assertInlineContentWithinCap(buffer.byteLength);
      return buffer;
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
