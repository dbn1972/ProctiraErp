'use client';

import { useMemo, useState, useTransition } from 'react';

import { createBoardExportJobAction } from '@/app/(dashboard)/examinations/board-exports/actions';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

const BOARD_OPTIONS = [
  { code: 'CBSE', label: 'CBSE' },
  { code: 'ICSE', label: 'ICSE' },
  { code: 'MH-STATE', label: 'MH-STATE' },
] as const;

export function BoardExportTriggerForm({
  institutionOptions = [],
  studentOptions = [],
}: {
  institutionOptions?: EntityLabelOption[];
  studentOptions?: EntityLabelOption[];
}) {
  const [boardCode, setBoardCode] = useState('CBSE');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const studentLabelById = useMemo(
    () => new Map(studentOptions.map((o) => [o.id, o.label])),
    [studentOptions],
  );

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
        const fd = new FormData(e.currentTarget);
        const institutionId = String(fd.get('institutionId') ?? '').trim();
        startTransition(async () => {
          if (!institutionId) {
            setError('Select an institution.');
            return;
          }
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
            {BOARD_OPTIONS.map((board) => (
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
          defaultValue={institutionOptions[0]?.id ?? ''}
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
        disabled={pending || institutionOptions.length === 0}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? 'Generating…' : 'Generate board pack'}
      </button>

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
