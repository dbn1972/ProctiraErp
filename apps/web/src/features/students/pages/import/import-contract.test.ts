/**
 * PRC-H093: the wizard consumes the real /students/import(/validate) response
 * shape (server ImportResult / ImportProgress) via the contract adapter.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SERVER_IMPORT_HEADERS,
  collapseDuplicateResolution,
  isServerImportProgress,
  pollImportJob,
  toImportResult,
  toValidationResult,
  type ServerImportProgress,
  type ServerImportResult,
} from './import-contract';

/** Shape returned by POST /students/import/validate (dry-run). */
const dryRun: ServerImportResult = {
  totalRows: 3,
  successCount: 0,
  errorCount: 2,
  duplicateCount: 2,
  errors: [
    { rowNumber: 2, field: 'date_of_birth', message: 'Invalid date', code: 'INVALID_FORMAT' },
    { rowNumber: 2, field: 'gender', message: 'Invalid gender', code: 'INVALID_FORMAT' },
  ],
  duplicates: [
    {
      rowNumber: 3,
      existingStudentId: 'stu-1',
      matchType: 'national_id',
      matchedFields: { national_id: 'N-1' },
    },
    {
      rowNumber: 4,
      existingStudentId: 'stu-2',
      matchType: 'name_dob',
      matchedFields: { first_name: 'Ana', last_name: 'Lee', date_of_birth: '2010-01-02' },
    },
  ],
};

describe('PRC-H093 import contract adapter', () => {
  it('maps the dry-run response to the wizard validation model', () => {
    const v = toValidationResult(dryRun);
    expect(v).toMatchObject({ totalRows: 3, errorRows: 1, validRows: 2, warningRows: 0 });
    expect(v.errors[0]).toEqual({
      row: 2,
      field: 'date_of_birth',
      message: 'Invalid date',
      severity: 'error',
    });
    expect(v.duplicates).toHaveLength(2);
    expect(v.duplicates[0]).toMatchObject({
      importRow: 3,
      existingRecord: { id: 'stu-1', nationalId: 'N-1' },
      matchedFields: ['national_id'],
      confidence: 1,
      resolution: 'unresolved',
    });
    expect(v.duplicates[1]!.existingRecord).toMatchObject({
      firstName: 'Ana',
      lastName: 'Lee',
      dateOfBirth: '2010-01-02',
    });
    expect(v.columnMappings.map((m) => m.sourceColumn)).toEqual(
      SERVER_IMPORT_HEADERS.map((h) => h.header),
    );
  });

  it('tolerates a header-error response with no duplicates', () => {
    const v = toValidationResult({
      totalRows: 0,
      successCount: 0,
      errorCount: 1,
      duplicateCount: 0,
      errors: [{ rowNumber: 1, field: 'header', message: 'Missing first_name', code: 'X' }],
      duplicates: [],
    });
    expect(v.duplicates).toEqual([]);
    expect(v.validRows).toBe(0);
  });

  it('collapses per-row choices to the single API duplicateResolution', () => {
    expect(collapseDuplicateResolution([])).toEqual({ resolution: 'skip' });
    expect(collapseDuplicateResolution([{ resolution: 'update' }, { resolution: 'update' }])).toEqual(
      { resolution: 'update' },
    );
    expect(collapseDuplicateResolution([{ resolution: 'skip' }, { resolution: 'create' }])).toHaveProperty(
      'error',
    );
    expect(collapseDuplicateResolution([{ resolution: 'unresolved' }])).toHaveProperty('error');
  });

  it('maps the commit result counts', () => {
    const server: ServerImportResult = { ...dryRun, successCount: 1, errorCount: 0, errors: [] };
    expect(toImportResult(server, 'skip')).toEqual({
      success: 1,
      failed: 0,
      skipped: 2,
      updated: 0,
      errors: [],
    });
    expect(toImportResult(server, 'update')).toMatchObject({ skipped: 0, updated: 2 });
  });

  it('detects the async 202 progress shape and polls to completion', async () => {
    const queued: ServerImportProgress = {
      jobId: 'job-1',
      status: 'queued',
      totalRows: 1200,
      processedRows: 0,
      progressPercent: 0,
      startedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(isServerImportProgress(queued)).toBe(true);
    expect(isServerImportProgress(dryRun)).toBe(false);
    const fetchProgress = vi
      .fn<(id: string) => Promise<ServerImportProgress>>()
      .mockResolvedValueOnce({ ...queued, status: 'processing', progressPercent: 50 })
      .mockResolvedValueOnce({ ...queued, status: 'completed', progressPercent: 100, result: dryRun });
    const sleep = vi.fn(async () => undefined);
    await expect(pollImportJob('job-1', fetchProgress, { sleep })).resolves.toBe(dryRun);
    expect(fetchProgress).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed job and times out a stuck job', async () => {
    const base: ServerImportProgress = {
      jobId: 'job-2',
      status: 'failed',
      totalRows: 0,
      processedRows: 0,
      progressPercent: 100,
      startedAt: '2024-01-01T00:00:00.000Z',
      errorMessage: 'Bad file',
    };
    await expect(pollImportJob('job-2', async () => base)).rejects.toThrow('Bad file');
    let t = 0;
    await expect(
      pollImportJob('job-3', async () => ({ ...base, status: 'processing' }), {
        sleep: async () => undefined,
        now: () => (t += 1000),
        timeoutMs: 2500,
      }),
    ).rejects.toThrow('still running');
  });
});
