'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label } from '@proctira/ui/components';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { useHydrated } from '@/hooks/useHydrated';
import type { LmsRubric } from '@/lib/api/lms';
import type { EntityLabelOption } from '@/lib/entity-label';

import { gradeWithRubricAction, uploadLmsFileAction } from '../depth-actions';

export function RubricGradeForm({
  assignmentId,
  submissionId,
  questionId,
  rubric,
  criterionOptions = [],
}: {
  assignmentId: string;
  submissionId: string;
  questionId?: string;
  rubric?: LmsRubric | null;
  /** Criteria from the school rubric directory when this assignment has none attached. */
  criterionOptions?: EntityLabelOption[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, { levelIndex: number; points: number }>>({});
  const criteria = rubric?.criteria ?? [];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const scores =
        criteria.length > 0
          ? criteria.map((c) => ({
              criterionId: c.id,
              levelIndex: levels[c.id]?.levelIndex ?? 0,
              points: levels[c.id]?.points ?? c.levels[0]?.points ?? 0,
            }))
          : [
              {
                criterionId: String(form.get('criterionId') ?? ''),
                points: Number(form.get('points') ?? 0),
                levelIndex: Number(form.get('levelIndex') ?? 0),
              },
            ];
      const result = await gradeWithRubricAction(assignmentId, {
        submissionId,
        questionId: questionId ?? '',
        scores,
      });
      setMessage(result.status === 'success' ? 'Rubric saved.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-2 space-y-3"
      data-testid="lms-rubric-grade-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      {criteria.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="lms-rubric-grid">
            <caption className="sr-only">Rubric criteria and performance levels</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-start">
                  Criterion
                </th>
                {criteria[0]?.levels.map((level) => (
                  <th key={level.label} scope="col" className="p-2 text-start">
                    {level.label} ({level.points} points)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {criteria.map((criterion) => (
                <tr key={criterion.id}>
                  <th scope="row" className="p-2 text-start font-medium">
                    {criterion.name}{' '}
                    <span className="text-muted-foreground">({criterion.maxPoints})</span>
                  </th>
                  {criterion.levels.map((level, index) => (
                    <td key={`${criterion.id}-${index}`} className="p-2">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="radio"
                          name={`crit-${submissionId}-${criterion.id}`}
                          required
                          checked={levels[criterion.id]?.levelIndex === index}
                          aria-label={`${criterion.name}, ${level.label}, ${level.points} points`}
                          onChange={() =>
                            setLevels((prev) => ({
                              ...prev,
                              [criterion.id]: { levelIndex: index, points: level.points },
                            }))
                          }
                        />
                        <span>{level.label}</span>
                        <span className="text-muted-foreground">{level.points}</span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          <EntitySearchSelect
            id={`crit-${submissionId}`}
            name="criterionId"
            label="Criterion"
            options={criterionOptions}
            required
            placeholder="Search criteria by name…"
            emptyMessage="No rubric criteria are loaded for this assignment. Attach a rubric before scoring."
          />
          <div className="flex flex-wrap gap-2">
            <div className="space-y-1">
              <Label htmlFor={`points-${submissionId}`}>Points</Label>
              <Input
                id={`points-${submissionId}`}
                name="points"
                type="number"
                min={0}
                placeholder="Points"
                className="h-11 w-24"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`level-${submissionId}`}>Level</Label>
              <Input
                id={`level-${submissionId}`}
                name="levelIndex"
                type="number"
                min={0}
                defaultValue={0}
                className="h-11 w-24"
              />
            </div>
          </div>
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
        Rubric grade
      </Button>
      {message ? (
        <span role="status" className="text-xs">
          {message}
        </span>
      ) : null}
    </form>
  );
}

export const LMS_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export function fileTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `File is ${mb} MB; the upload limit is 5 MB.`;
}
export function AssignmentFileForm({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement)?.files?.[0];
    setMessage(null);
    setError(null);
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ] as const;
    if (!allowed.includes(file.type as (typeof allowed)[number])) {
      setError('Use PDF, image, text or DOCX.');
      return;
    }
    if (file.size > LMS_UPLOAD_MAX_BYTES) {
      // PRC-M099: size errors are distinct and state the actual size.
      setError(fileTooLargeMessage(file.size));
      return;
    }
    startTransition(async () => {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      let result: Awaited<ReturnType<typeof uploadLmsFileAction>>;
      try {
        result = await uploadLmsFileAction({
          assignmentId,
          filename: file.name,
          mimeType: file.type as (typeof allowed)[number],
          contentBase64,
        });
      } catch {
        // The Server Action transport rejects over-limit bodies before the action runs.
        setError(fileTooLargeMessage(file.size));
        return;
      }
      if (result.status === 'success') {
        setMessage('File uploaded.');
        router.refresh();
        return;
      }
      setError(result.message ?? 'Upload failed.');
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2"
      data-testid="lms-file-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="lms-file">Submission file</Label>
        <Input
          id="lms-file"
          name="file"
          type="file"
          className="h-11"
          aria-describedby="lms-file-hint"
          aria-invalid={error ? true : undefined}
        />
        <p id="lms-file-hint" className="text-xs text-muted-foreground">
          PDF, image, text or DOCX, up to 5 MB.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
        Upload
      </Button>
      {message ? (
        <span role="status" className="text-xs">
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive" data-testid="lms-file-error">
          {error}
        </span>
      ) : null}
    </form>
  );
}
