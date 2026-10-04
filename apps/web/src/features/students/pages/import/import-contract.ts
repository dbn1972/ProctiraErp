/**
 * PRC-H093: adapter between the student import API contract and the wizard.
 *
 * The gateway's POST /students/import/validate (dry-run) and POST
 * /students/import return the server `ImportResult` shape
 * (`successCount` / `errorCount` / `errors[{rowNumber}]` /
 * `duplicates[{rowNumber, existingStudentId, matchType, matchedFields}]`), or an
 * `ImportProgress` (202, `jobId`) for async / >1000-row imports. The server
 * parses a fixed header row (`EXPECTED_HEADERS`), applies ONE
 * `duplicateResolution` to every duplicate, and has no column-mapping input.
 * These pure functions map that contract onto the wizard view model so the
 * UI never reads fields the API does not return.
 */
import type {
  ImportProgress as ServerImportProgress,
  ImportResult as ServerImportResult,
} from '@/lib/api/students';

import type {
  ColumnMapping,
  DuplicateMatch,
  DuplicateResolution,
  ImportResult,
  RowError,
  ValidationResult,
} from './types';

export type { ServerImportProgress, ServerImportResult };

/** Mirrors packages/backend/student import `EXPECTED_HEADERS` (server parses these). */
export const SERVER_IMPORT_HEADERS: ReadonlyArray<{
  header: string;
  targetField: string;
  required: boolean;
}> = [
  { header: 'first_name', targetField: 'firstName', required: true },
  { header: 'last_name', targetField: 'lastName', required: true },
  { header: 'date_of_birth', targetField: 'dateOfBirth', required: true },
  { header: 'gender', targetField: 'gender', required: false },
  { header: 'national_id', targetField: 'nationalId', required: false },
  { header: 'nationality', targetField: 'nationality', required: false },
  { header: 'contact_phone', targetField: 'phone', required: false },
  { header: 'contact_email', targetField: 'email', required: false },
  { header: 'guardian_name', targetField: 'guardianName', required: false },
  { header: 'guardian_phone', targetField: 'guardianPhone', required: false },
  { header: 'institution_code', targetField: 'institutionCode', required: false },
];

export function isServerImportProgress(
  value: ServerImportResult | ServerImportProgress,
): value is ServerImportProgress {
  return typeof (value as ServerImportProgress).jobId === 'string';
}

/** Column mappings are fixed by the server template (display-only in the wizard). */
export function serverColumnMappings(): ColumnMapping[] {
  return SERVER_IMPORT_HEADERS.map((h) => ({
    sourceColumn: h.header,
    targetField: h.targetField,
    required: h.required,
    valid: true,
  }));
}

function toRowErrors(server: ServerImportResult): RowError[] {
  return (server.errors ?? []).map((e) => ({
    row: e.rowNumber,
    field: e.field,
    message: e.message,
    severity: 'error' as const,
  }));
}

function toDuplicates(server: ServerImportResult): DuplicateMatch[] {
  return (server.duplicates ?? []).map((d) => ({
    importRow: d.rowNumber,
    importData: { ...d.matchedFields },
    existingRecord: {
      id: d.existingStudentId,
      // Server keys are the template headers (snake_case), e.g. `first_name`.
      firstName: d.matchedFields['first_name'] ?? '',
      lastName: d.matchedFields['last_name'] ?? '',
      dateOfBirth: d.matchedFields['date_of_birth'] ?? '',
      ...(d.matchedFields['national_id'] ? { nationalId: d.matchedFields['national_id'] } : {}),
    },
    matchedFields: Object.keys(d.matchedFields ?? {}),
    confidence: d.matchType === 'national_id' ? 1 : 0.8,
    resolution: 'unresolved' as DuplicateResolution,
  }));
}

/** Server dry-run result → wizard validation model. */
export function toValidationResult(server: ServerImportResult): ValidationResult {
  const errors = toRowErrors(server);
  const errorRows = new Set(errors.map((e) => e.row)).size;
  return {
    totalRows: server.totalRows,
    validRows: Math.max(0, server.totalRows - errorRows),
    errorRows,
    warningRows: 0,
    errors,
    preview: [],
    columnMappings: serverColumnMappings(),
    duplicates: toDuplicates(server),
  };
}

/**
 * The API applies one `duplicateResolution` to all duplicates. Returns it, or
 * an error message when the wizard selections cannot be expressed (mixed or
 * unresolved). No duplicates ⇒ `skip`.
 */
export function collapseDuplicateResolution(
  duplicates: ReadonlyArray<Pick<DuplicateMatch, 'resolution'>>,
): { resolution: Exclude<DuplicateResolution, 'unresolved'> } | { error: string } {
  if (duplicates.length === 0) return { resolution: 'skip' };
  const choices = new Set(duplicates.map((d) => d.resolution));
  if (choices.has('unresolved')) {
    return { error: 'Choose how to handle every duplicate before importing.' };
  }
  if (choices.size > 1) {
    return {
      error:
        'Import applies one action to all duplicates. Choose the same action (skip, update or create) for every duplicate.',
    };
  }
  return { resolution: [...choices][0] as Exclude<DuplicateResolution, 'unresolved'> };
}

/** Server commit result → wizard confirmation model. */
export function toImportResult(
  server: ServerImportResult,
  resolution: Exclude<DuplicateResolution, 'unresolved'>,
): ImportResult {
  const duplicates = server.duplicateCount ?? 0;
  return {
    success: server.successCount,
    failed: server.errorCount,
    skipped: resolution === 'skip' ? duplicates : 0,
    updated: resolution === 'update' ? duplicates : 0,
    errors: toRowErrors(server),
  };
}

export const IMPORT_POLL_INTERVAL_MS = 1500;
export const IMPORT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Poll GET /students/import/:jobId (tenant-scoped server-side) until the job
 * is terminal. Resolves the server result, or throws with the job error.
 */
export async function pollImportJob(
  jobId: string,
  fetchProgress: (jobId: string) => Promise<ServerImportProgress>,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<ServerImportResult> {
  const intervalMs = opts.intervalMs ?? IMPORT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? IMPORT_POLL_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  for (;;) {
    const progress = await fetchProgress(jobId);
    if (progress.status === 'completed' && progress.result) return progress.result;
    if (progress.status === 'failed') {
      if (progress.result) return progress.result;
      throw new Error(progress.errorMessage ?? 'Import failed. Please try again.');
    }
    if (now() - started > timeoutMs) {
      throw new Error('Import is still running. Check back later for the results.');
    }
    await sleep(intervalMs);
  }
}
