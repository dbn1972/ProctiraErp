'use client';

import { useMemo, useState, useTransition } from 'react';

import { createBoardExportJobAction } from '@/app/(dashboard)/examinations/board-exports/actions';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

/** Fallback when the pack registry is unavailable; prefer `boardOptions` from config. */
const DEFAULT_BOARD_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'CBSE', label: 'CBSE' },
  { code: 'ICSE', label: 'ICSE' },
  { code: 'MH-STATE', label: 'MH-STATE' },
];

export function BoardExportTriggerForm({
  institutionOptions = [],
  studentOptions = [],
  boardOptions,
}: {
  institutionOptions?: EntityLabelOption[];
  studentOptions?: EntityLabelOption[];
  /** Boards from the configured pack registry. */
  boardOptions?: ReadonlyArray<{ code: string; label: string }>;
}) {
  const boards = boardOptions && boardOptions.length > 0 ? boardOptions : DEFAULT_BOARD_OPTIONS;
  const [boardCode, setBoardCode] = useState(boards[0]?.code ?? '');
  // No default: the operator must choose the institution explicitly (PRC-L227).
  const [institutionId, setInstitutionId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const studentLabelById = useMemo(
    () => new Map(studentOptions.map((o) => [o.id, o.label])),
    [studentOptions],
  );

  const institutionLabel = institutionOptions.find((o) => o.id === institutionId)?.label;

  function submitExport() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await createBoardExportJobAction({
        boardCode,
        institutionId,
        studentIds: selectedStudentIds.length > 0 ? selectedStudentIds : undefined,
      });
      if (!result.ok) {
        setError(
          `${result.error}${result.status ? ` (${result.status})` : ''}${
            result.code ? ` · ${result.code}` : ''
          }`,
        );
        return;
      }
      setMessage(
        `Export job ready · ${result.status}${
          result.checksum ? ` · checksum ${result.checksum.slice(0, 12)}…` : ''
        }`,
      );
    });
  }

  function addStudent(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    if (!id) return;
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    event.target.value = '';
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        if (!institutionId) {
          setError('Select an institution.');
          return;
        }
        setConfirmOpen(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Board</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            value={boardCode}
            onChange={(e) => setBoardCode(e.target.value)}
            required
          >
            {boards.map((board) => (
              <option key={board.code} value={board.code}>
                {board.label}
              </option>
            ))}
          </select>
        </label>
        <EntitySearchSelect
          id="board-export-institution"
          name="institutionId"
          label="Institution"
          options={institutionOptions}
          defaultValue=""
          onValueChange={setInstitutionId}
          required
          placeholder="Search institution…"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground" htmlFor="board-export-student">
          Students (optional — omit for complete cohort)
        </label>
        {studentOptions.length === 0 ? (
          <p
            className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
            role="status"
          >
            Student directory unavailable. Leave empty to export the complete cohort.
          </p>
        ) : (
          <>
            <select
              id="board-export-student"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue=""
              onChange={addStudent}
            >
              <option value="">Add a student…</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.label}
                </option>
              ))}
            </select>
            {selectedStudentIds.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Selected students">
                {selectedStudentIds.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
                      onClick={() =>
                        setSelectedStudentIds((prev) =>
                          prev.filter((studentId) => studentId !== id),
                        )
                      }
                    >
                      {studentLabelById.get(id) ?? 'Student'}
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No students selected — full cohort export.
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || !institutionId}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? 'Generating…' : 'Generate board pack'}
      </button>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Generate board pack?"
        description={`${boards.find((b) => b.code === boardCode)?.label ?? boardCode} pack for ${
          institutionLabel ?? 'the selected institution'
        } · ${
          selectedStudentIds.length > 0
            ? `${selectedStudentIds.length} selected student${selectedStudentIds.length === 1 ? '' : 's'}`
            : 'all students in the institution cohort (no students selected)'
        }.`}
        confirmLabel="Generate pack"
        pending={pending}
        onConfirm={submitExport}
        testId="board-export-confirm"
      />
      {message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
