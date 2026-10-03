'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { LmsRubric } from '@/lib/api/lms';

import { gradeWithRubricAction, uploadLmsFileAction } from '../depth-actions';

export function RubricGradeForm({
  assignmentId,
  submissionId,
  questionId,
  rubric,
}: {
  assignmentId: string;
  submissionId: string;
  questionId?: string;
  rubric?: LmsRubric | null;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, { levelIndex: number; points: number }>>({});
  const criteria = rubric?.criteria ?? [];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      if (criteria.length === 0) {
        setMessage('Attach a rubric before rubric grading.');
        return;
      }
      const scores = criteria.map((c) => ({
        criterionId: c.id,
        levelIndex: levels[c.id]?.levelIndex ?? 0,
        points: levels[c.id]?.points ?? c.levels[0]?.points ?? 0,
      }));
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
        // PRC-M479: no free-points fallback — scores come only from a linked rubric's levels.
        <p role="status" className="text-sm text-muted-foreground" data-testid="lms-rubric-missing">
          No rubric is attached to this question. Attach a rubric to the essay question before
          rubric grading.
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={pending || criteria.length === 0}
        aria-busy={pending}
      >
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

export function AssignmentFileForm({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement)?.files?.[0];
    if (!file) {
      setMessage('Choose a file first.');
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
      setMessage('Use PDF, image, text or DOCX.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('File exceeds 5 MB.');
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
      const result = await uploadLmsFileAction({
        assignmentId,
        filename: file.name,
        mimeType: file.type as (typeof allowed)[number],
        contentBase64,
      });
      setMessage(result.status === 'success' ? 'File uploaded.' : (result.message ?? 'Failed'));
      if (result.status === 'success') router.refresh();
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
        <Input id="lms-file" name="file" type="file" className="h-11" />
      </div>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
        Upload
      </Button>
      {message ? (
        <span role="status" className="text-xs">
          {message}
        </span>
      ) : null}
    </form>
  );
}
