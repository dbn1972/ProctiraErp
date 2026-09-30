/**
 * PRC-C003 — LFI regression tests.
 *
 * Tenant CSV/Excel pipelines must never read a host filePath (e.g. /etc/passwd). Only inline
 * content is accepted, and it is size-capped.
 */
import { describe, expect, it } from 'vitest';

import { CsvSourceConnector } from './csv-source.js';
import { ExcelSourceConnector } from './excel-source.js';
import {
  FileSourceError,
  MAX_INLINE_CONTENT_BYTES,
  assertInlineContentWithinCap,
  assertNoHostFilePath,
} from './file-source-policy.js';

describe('file-source-policy (PRC-C003)', () => {
  it('rejects a host filePath', () => {
    expect(() => assertNoHostFilePath('/etc/passwd')).toThrow(FileSourceError);
    expect(() => assertNoHostFilePath('relative/path.csv')).toThrow(FileSourceError);
  });

  it('allows an absent filePath', () => {
    expect(() => assertNoHostFilePath(undefined)).not.toThrow();
    expect(() => assertNoHostFilePath('')).not.toThrow();
  });

  it('rejects oversized inline content', () => {
    expect(() => assertInlineContentWithinCap(MAX_INLINE_CONTENT_BYTES + 1)).toThrow(
      FileSourceError,
    );
    expect(() => assertInlineContentWithinCap(10)).not.toThrow();
  });
});

describe('CsvSourceConnector LFI guard (PRC-C003)', () => {
  it('validate() rejects a filePath', async () => {
    const connector = new CsvSourceConnector({ type: 'csv', filePath: '/etc/passwd' });
    const result = await connector.validate();
    expect(result.valid).toBe(false);
  });

  it('extract() throws for a filePath instead of reading the host file', async () => {
    const connector = new CsvSourceConnector({ type: 'csv', filePath: '/etc/passwd' });
    await expect(connector.extract()).rejects.toBeInstanceOf(FileSourceError);
  });

  it('extract() still works for inline content', async () => {
    const connector = new CsvSourceConnector({
      type: 'csv',
      fileContent: 'a,b\n1,2',
      hasHeader: true,
    });
    const result = await connector.extract();
    expect(result.totalCount).toBe(1);
  });
});

describe('ExcelSourceConnector LFI guard (PRC-C003)', () => {
  it('validate() rejects a filePath', async () => {
    const connector = new ExcelSourceConnector({ type: 'excel', filePath: '/etc/passwd' });
    const result = await connector.validate();
    expect(result.valid).toBe(false);
  });

  it('extract() throws for a filePath instead of reading the host file', async () => {
    const connector = new ExcelSourceConnector({ type: 'excel', filePath: '/etc/passwd' });
    await expect(connector.extract()).rejects.toBeInstanceOf(FileSourceError);
  });
});
