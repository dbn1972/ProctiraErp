'use client';

import { useState, useTransition } from 'react';

import { createBoardExportJobAction } from '@/app/(dashboard)/examinations/board-exports/actions';

const PRESETS: Array<{
  label: string;
  boardCode: string;
  institutionId: string;
  hint: string;
}> = [
  {
    label: 'CBSE · CBSE-DEL-01',
    boardCode: 'CBSE',
    institutionId: '2e0126f1-752b-4d63-ba57-633a83cc6508',
    hint: 'Complete-cohort export (ENG/MATH/SCI/SST)',
  },
  {
    label: 'ICSE · ICSE-BLR-01',
    boardCode: 'ICSE',
    institutionId: '30a9ae8b-761f-4dff-a221-c477beaa8580',
    hint: 'Complete-cohort export (ENG/MATH/SCI/HIST)',
  },
  {
    label: 'MH-STATE · MH-PUN-01',
    boardCode: 'MH-STATE',
    institutionId: 'fbb89cbd-f78b-4659-9ed5-94961455b94d',
    hint: 'Complete-cohort export (ENG/MATH/SCI/SOC)',
  },
];

export function BoardExportTriggerForm() {
  const [boardCode, setBoardCode] = useState('CBSE');
  const [institutionId, setInstitutionId] = useState(PRESETS[0]!.institutionId);
  const [studentIds, setStudentIds] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function applyPreset(idx: number) {
    const preset = PRESETS[idx];
    if (!preset) return;
    setBoardCode(preset.boardCode);
    setInstitutionId(preset.institutionId);
    setStudentIds('');
    setMessage(null);
    setError(null);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const ids = studentIds
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const result = await createBoardExportJobAction({
            boardCode,
            institutionId,
            studentIds: ids.length > 0 ? ids : undefined,
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
            `Job ${result.id} → ${result.status}${
              result.checksum ? ` · sha256 ${result.checksum.slice(0, 12)}…` : ''
            }`,
          );
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset, idx) => (
          <button
            key={preset.label}
            type="button"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
            onClick={() => applyPreset(idx)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Board code</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            value={boardCode}
            onChange={(e) => setBoardCode(e.target.value)}
            required
          >
            <option value="CBSE">CBSE</option>
            <option value="ICSE">ICSE</option>
            <option value="MH-STATE">MH-STATE</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Institution ID</span>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">
          Student IDs (optional — omit for complete-only cohort)
        </span>
        <textarea
          className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          value={studentIds}
          onChange={(e) => setStudentIds(e.target.value)}
          placeholder="UUID list; incomplete grades → 422"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
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
