'use client';

/**
 * Bulk Result Entry data grid (Client Component).
 *
 * - Subject + period UUIDs as inputs (server pre-loaded items + previous results)
 * - Add a row per student; one number column per assessment item
 * - Score range validated client-side against the grading scheme
 * - "Save" submits all valid rows; row-level errors are reported per row
 * - "Import Excel" uses @proctira/ui/bulk-import for the multi-step flow
 * - Auto-saves the in-progress entry grid to `localStorage` every
 *   30 s (Task 60.5, Requirement 38 AC 8). The draft slot is keyed
 *   `assessment-entry-<academicPeriodId>-<subjectId>` so a teacher
 *   marking a long roster can close the tab, lose connectivity, or
 *   crash the browser without losing the typed scores. The draft is
 *   cleared on a successful bulk save.
 *
 * Implements Requirements 8.4, 8.8, 38.8.
 */
import { Plus, Save, Trash2, Upload } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  BulkImport,
  type ImportColumnMapping,
  type ImportValidationResult,
} from '@proctira/ui/bulk-import';

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';

import {
  importResultsFromExcelAction,
  submitBulkResultsAction,
  type ActionState,
} from '../actions';
import type { BulkResultEntryResponse } from '@/lib/api/assessments';
import { useDraftAutosave } from '@/lib/draft/useDraftAutosave';

interface ItemMeta {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
  weight: number;
}

interface ExistingResult {
  studentId: string;
  itemScores: { assessmentItemId: string; score: number }[];
  weightedAverage: number;
  grade: string;
}

interface SchemeMeta {
  id: string;
  name: string;
  minValue: number;
  maxValue: number;
}

interface SubjectOption {
  id: string;
  name: string;
  code?: string;
}

interface AcademicPeriodOption {
  id: string;
  name: string;
}

interface ResultsEntryGridProps {
  defaultSubjectId?: string;
  defaultAcademicPeriodId?: string;
  /** Subject catalog for the picker (replaces raw UUID entry). */
  subjects?: SubjectOption[];
  /** Academic periods for the picker. */
  academicPeriods?: AcademicPeriodOption[];
  items: ItemMeta[];
  existingResults: ExistingResult[];
  scheme: SchemeMeta | null;
}

interface RowDraft {
  id: string;
  studentId: string;
  scores: Record<string, string>; // itemId -> string for input flexibility
  rowError: string | null;
}

/**
 * Snapshot persisted by `useDraftAutosave`. Captures the current
 * subject/period selection plus the editable rows so the teacher
 * resumes exactly where they were on remount.
 */
interface ResultsEntryDraftSnapshot {
  subjectId: string;
  academicPeriodId: string;
  rows: RowDraft[];
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function generateRowId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `row-${Math.random().toString(36).slice(2)}`;
}

function buildInitialRows(existing: ExistingResult[]): RowDraft[] {
  if (existing.length === 0) {
    return [
      {
        id: generateRowId(),
        studentId: '',
        scores: {},
        rowError: null,
      },
    ];
  }
  return existing.map((r) => {
    const scores: Record<string, string> = {};
    for (const s of r.itemScores) {
      scores[s.assessmentItemId] = String(s.score);
    }
    return {
      id: generateRowId(),
      studentId: r.studentId,
      scores,
      rowError: null,
    };
  });
}

export function ResultsEntryGrid({
  defaultSubjectId = '',
  defaultAcademicPeriodId = '',
  subjects = [],
  academicPeriods = [],
  items,
  existingResults,
  scheme,
}: ResultsEntryGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [academicPeriodId, setAcademicPeriodId] = useState(
    defaultAcademicPeriodId,
  );

  /**
   * Push the subject/period selection to the URL so the server reloads
   * assessment items and previously recorded results for that pair.
   */
  function pushSelection(nextSubjectId: string, nextPeriodId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSubjectId) params.set('subjectId', nextSubjectId);
    else params.delete('subjectId');
    if (nextPeriodId) params.set('academicPeriodId', nextPeriodId);
    else params.delete('academicPeriodId');
    startTransition(() => {
      router.replace(`/assessments/results?${params.toString()}`);
    });
  }

  function handleSubjectChange(value: string) {
    setSubjectId(value);
    if (value && academicPeriodId) pushSelection(value, academicPeriodId);
  }

  function handlePeriodChange(value: string) {
    setAcademicPeriodId(value);
    if (subjectId && value) pushSelection(subjectId, value);
  }
  const [rows, setRows] = useState<RowDraft[]>(() =>
    buildInitialRows(existingResults),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [serverState, setServerState] =
    useState<ActionState<BulkResultEntryResponse> | null>(null);

  // Draft autosave (Task 60.5 / Requirement 38.8). Slot keyed by
  // (academicPeriodId, subjectId) so different subject/period
  // combinations do not collide. Empty selectors fall back to
  // `default` so the slot remains stable while the teacher picks the
  // first subject for the day.
  const draftFormId = `assessment-entry-${
    academicPeriodId || 'default'
  }-${subjectId || 'default'}`;
  const draft = useDraftAutosave<ResultsEntryDraftSnapshot>(draftFormId);

  // Hydrate the persisted draft once on mount. The autosave hook
  // returns `null` during SSR / first render and re-reads from
  // `localStorage` in a mount effect.
  const hasHydratedDraftRef = useRef<boolean>(false);
  useEffect(() => {
    if (hasHydratedDraftRef.current) return;
    if (draft.values === null) return;
    const snap = draft.values;
    setSubjectId(snap.subjectId);
    setAcademicPeriodId(snap.academicPeriodId);
    if (snap.rows.length > 0) {
      setRows(snap.rows);
    }
    hasHydratedDraftRef.current = true;
  }, [draft.values]);

  // Persist the live snapshot. The autosave hook debounces internally
  // to 30 s so this fires cheaply on every change.
  useEffect(() => {
    draft.save({ subjectId, academicPeriodId, rows });
  }, [draft, subjectId, academicPeriodId, rows]);

  const canEdit = items.length > 0;
  const minScore = scheme?.minValue ?? 0;
  const maxScore = scheme?.maxValue ?? 100;

  function updateRow(id: string, patch: Partial<RowDraft>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function updateScore(rowId: string, itemId: string, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, scores: { ...r.scores, [itemId]: value }, rowError: null }
          : r,
      ),
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { id: generateRowId(), studentId: '', scores: {}, rowError: null },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function validateAndCollect(): {
    payload: { studentId: string; assessmentItemId: string; score: number }[];
    rowErrors: Map<string, string>;
  } {
    const rowErrors = new Map<string, string>();
    const payload: {
      studentId: string;
      assessmentItemId: string;
      score: number;
    }[] = [];

    for (const row of rows) {
      if (!row.studentId.trim()) {
        rowErrors.set(row.id, 'Student UUID is required');
        continue;
      }
      if (!UUID_REGEX.test(row.studentId)) {
        rowErrors.set(row.id, 'Student UUID is not a valid UUID');
        continue;
      }

      let rowAdded = false;
      let rowFailed = false;

      for (const item of items) {
        const raw = row.scores[item.id];
        if (raw === undefined || raw === '') continue;
        const score = Number(raw);
        if (Number.isNaN(score)) {
          rowErrors.set(row.id, `${item.name}: score must be a number`);
          rowFailed = true;
          break;
        }
        if (score < minScore || score > maxScore) {
          rowErrors.set(
            row.id,
            `${item.name}: score ${score} is outside scheme range [${minScore}, ${maxScore}]`,
          );
          rowFailed = true;
          break;
        }
        payload.push({
          studentId: row.studentId,
          assessmentItemId: item.id,
          score,
        });
        rowAdded = true;
      }

      if (!rowFailed && !rowAdded) {
        rowErrors.set(row.id, 'Provide at least one score for this student');
      }
    }

    return { payload, rowErrors };
  }

  async function handleSave() {
    if (!canEdit) return;
    if (!subjectId || !academicPeriodId) {
      setServerState({
        status: 'error',
        message: 'Subject and academic period UUIDs are required.',
      });
      return;
    }

    const { payload, rowErrors } = validateAndCollect();
    setRows((prev) =>
      prev.map((r) => ({ ...r, rowError: rowErrors.get(r.id) ?? null })),
    );

    if (payload.length === 0) {
      setServerState({
        status: 'error',
        message: 'No valid score entries to save.',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Flush the autosave so a crash mid-network leaves the current
      // grid recoverable on the next visit.
      draft.flush({ subjectId, academicPeriodId, rows });
      const result = await submitBulkResultsAction({
        subjectId,
        academicPeriodId,
        results: payload,
      });
      setServerState(result);
      if (result.status === 'success') {
        // Successful save — discard the persisted draft so the next
        // visit starts from the server-supplied results.
        draft.clear();
      }
    } finally {
      setIsSaving(false);
    }
  }

  /** Build a CSV/Excel template (simple CSV) so users have the right columns. */
  function downloadTemplate() {
    const header = ['studentId', ...items.map((i) => i.name)].join(',');
    const sample = ['<student-uuid>', ...items.map(() => '0')].join(',');
    const csv = `${header}\n${sample}\n`;
    if (typeof window === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `result-template-${subjectId || 'subject'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Validate uploaded CSV/XLSX rows by treating them as text/CSV first. */
  async function validateImportFile(
    file: File,
  ): Promise<ImportValidationResult> {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        warningRows: 0,
        errors: [],
        preview: [],
        columnMappings: [],
      };
    }
    const headers = (lines[0] ?? '').split(',').map((s) => s.trim());
    const dataRows = lines.slice(1);

    const itemNameSet = new Set(items.map((i) => i.name));
    const columnMappings: ImportColumnMapping[] = headers.map((h) => ({
      sourceColumn: h,
      targetField:
        h === 'studentId' ? 'studentId' : itemNameSet.has(h) ? h : '',
      required: h === 'studentId',
      valid: h === 'studentId' || itemNameSet.has(h),
    }));

    const errors: ImportValidationResult['errors'] = [];
    const preview: ImportValidationResult['preview'] = [];
    let validRows = 0;
    let errorRows = 0;

    dataRows.slice(0, 200).forEach((line, idx) => {
      const row = idx + 2;
      const cells = line.split(',').map((s) => s.trim());
      const data: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        data[h] = cells[i] ?? '';
      });
      let rowHasErrors = false;
      const studentId = String(data['studentId'] ?? '');
      if (!UUID_REGEX.test(studentId)) {
        errors.push({
          row,
          field: 'studentId',
          message: 'Invalid UUID',
          value: studentId,
          severity: 'error',
        });
        rowHasErrors = true;
      }
      for (const item of items) {
        const v = data[item.name];
        if (v === undefined || v === '') continue;
        const num = Number(v);
        if (Number.isNaN(num) || num < minScore || num > maxScore) {
          errors.push({
            row,
            field: item.name,
            message: `Score must be in [${minScore}, ${maxScore}]`,
            value: String(v),
            severity: 'error',
          });
          rowHasErrors = true;
        }
      }
      preview.push({ rowNumber: row, data, hasErrors: rowHasErrors, errors: [] });
      if (rowHasErrors) errorRows += 1;
      else validRows += 1;
    });

    return {
      totalRows: dataRows.length,
      validRows,
      errorRows,
      warningRows: 0,
      errors,
      preview,
      columnMappings,
    };
  }

  async function confirmImport(
    file: File,
  ): Promise<{ success: number; failed: number }> {
    if (!subjectId || !academicPeriodId) {
      throw new Error('Subject and academic period UUIDs are required.');
    }
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length <= 1) {
      return { success: 0, failed: 0 };
    }
    const headers = (lines[0] ?? '').split(',').map((s) => s.trim());
    const studentIdIdx = headers.indexOf('studentId');
    const itemColumns = items
      .map((it) => ({ id: it.id, name: it.name, idx: headers.indexOf(it.name) }))
      .filter((c) => c.idx >= 0);

    const rowsToImport: {
      studentId: string;
      assessmentItemId: string;
      score: number;
    }[] = [];

    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((s) => s.trim());
      const studentId = studentIdIdx >= 0 ? cells[studentIdIdx] ?? '' : '';
      if (!UUID_REGEX.test(studentId)) continue;
      for (const col of itemColumns) {
        const raw = cells[col.idx];
        if (raw === undefined || raw === '') continue;
        const num = Number(raw);
        if (Number.isNaN(num) || num < minScore || num > maxScore) continue;
        rowsToImport.push({
          studentId,
          assessmentItemId: col.id,
          score: num,
        });
      }
    }

    if (rowsToImport.length === 0) {
      return { success: 0, failed: 0 };
    }

    const result = await importResultsFromExcelAction({
      subjectId,
      academicPeriodId,
      results: rowsToImport,
    });
    setServerState(result);
    if (result.status === 'success' && result.data) {
      return {
        success: result.data.successCount,
        failed: result.data.errorCount,
      };
    }
    return { success: 0, failed: rowsToImport.length };
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="subjectId">Subject</Label>
          <Select
            value={subjectId || undefined}
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger id="subjectId" aria-label="Subject">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {subjectId && !subjects.some((s) => s.id === subjectId) && (
                <SelectItem value={subjectId}>Selected subject</SelectItem>
              )}
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                  {subject.code ? ` (${subject.code})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="academicPeriodId">Academic period</Label>
          <Select
            value={academicPeriodId || undefined}
            onValueChange={handlePeriodChange}
          >
            <SelectTrigger id="academicPeriodId" aria-label="Academic period">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {academicPeriodId &&
                !academicPeriods.some((p) => p.id === academicPeriodId) && (
                  <SelectItem value={academicPeriodId}>
                    Selected period
                  </SelectItem>
                )}
              {academicPeriods.map((period) => (
                <SelectItem key={period.id} value={period.id}>
                  {period.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {scheme && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Grading scheme: <span className="font-medium">{scheme.name}</span>{' '}
          (range {minScore}–{maxScore})
        </p>
      )}

      {!canEdit && (
        <p className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]">
          Choose a subject and academic period above. Once assessment items
          are configured for that pair, the entry grid appears here.
        </p>
      )}

      {serverState?.status === 'error' && serverState.message && (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          {serverState.message}
        </div>
      )}
      {serverState?.status === 'success' && serverState.message && (
        <div
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700"
          role="status"
          aria-live="polite"
        >
          {serverState.message}
        </div>
      )}

      {canEdit && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              Add student row
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowImport((v) => !v)}
            >
              <Upload className="me-2 h-4 w-4" aria-hidden="true" />
              {showImport ? 'Hide import' : 'Import Excel/CSV'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save className="me-2 h-4 w-4" aria-hidden="true" />
              {isSaving ? 'Saving…' : 'Save scores'}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Result entry grid">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Student UUID</TableHead>
                  {items.map((it) => (
                    <TableHead key={it.id} className="min-w-[120px]">
                      {it.name}
                      <span className="block text-xs font-normal text-[hsl(var(--muted-foreground))]">
                        {it.weight}% · {it.minScore}-{it.maxScore}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} aria-invalid={!!row.rowError}>
                    <TableCell>
                      <Input
                        aria-label={`Student UUID ${row.id}`}
                        value={row.studentId}
                        onChange={(e) =>
                          updateRow(row.id, { studentId: e.target.value })
                        }
                        className="font-mono text-xs"
                      />
                      {row.rowError && (
                        <p
                          className="mt-1 text-xs text-[hsl(var(--destructive))]"
                          role="alert"
                        >
                          {row.rowError}
                        </p>
                      )}
                    </TableCell>
                    {items.map((it) => (
                      <TableCell key={it.id}>
                        <Input
                          type="number"
                          step="0.01"
                          aria-label={`${it.name} score for ${row.studentId || 'unnamed student'}`}
                          value={row.scores[it.id] ?? ''}
                          onChange={(e) =>
                            updateScore(row.id, it.id, e.target.value)
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                        aria-label={`Remove row for student ${row.studentId || 'unnamed'}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {canEdit && showImport && (
        <div className="rounded-md border p-4">
          <BulkImport
            title="Import results"
            description={`Upload a CSV with columns: studentId, ${items
              .map((i) => i.name)
              .join(', ')}. Up to 5,000 rows per file.`}
            acceptedFileTypes={['.csv', '.xlsx']}
            maxFileSize={10 * 1024 * 1024}
            targetFields={[
              { name: 'studentId', label: 'Student UUID', required: true },
              ...items.map((i) => ({
                name: i.name,
                label: i.name,
                required: false,
              })),
            ]}
            onFileValidate={validateImportFile}
            onImportConfirm={(file) => confirmImport(file)}
            onDownloadTemplate={downloadTemplate}
            onCancel={() => setShowImport(false)}
          />
        </div>
      )}
    </div>
  );
}
