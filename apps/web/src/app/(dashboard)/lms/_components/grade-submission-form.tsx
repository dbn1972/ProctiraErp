'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { Button, Input } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { gradeSubmissionAction } from '../actions';

export function GradeSubmissionForm({
  assignmentId,
  submissionId,
  maxScore,
  initialScore,
  initialFeedback,
}: {
  assignmentId: string;
  submissionId: string;
  maxScore: number;
  initialScore: number | null;
  initialFeedback: string | null;
}) {
  const t = useTranslations('lms');
  const router = useRouter();
  const id = useId();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(initialScore === null ? '' : String(initialScore));
  const [feedback, setFeedback] = useState(initialFeedback ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numeric = Number(score);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > maxScore) {
      setMessage({ kind: 'err', text: t('errScoreRange', { max: maxScore }) });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await gradeSubmissionAction(assignmentId, submissionId, {
        score: numeric,
        feedback: feedback.trim() || undefined,
        returnToStudent: true,
      });
      if (result.status === 'success') {
        setMessage({ kind: 'ok', text: t('graded') });
        router.refresh();
      } else {
        setMessage({ kind: 'err', text: result.message ?? t('actionFailed') });
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2"
      aria-label={t('gradeSubmission')}
      data-testid="lms-grade-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <label htmlFor={`${id}-score`} className="sr-only">
        {t('colScore')}
      </label>
      <Input
        id={`${id}-score`}
        type="number"
        inputMode="decimal"
        min={0}
        max={maxScore}
        step={0.5}
        value={score}
        onChange={(e) => setScore(e.target.value)}
        className="h-11 w-24"
        placeholder={`0–${maxScore}`}
      />
      <label htmlFor={`${id}-fb`} className="sr-only">
        {t('fieldFeedback')}
      </label>
      <Input
        id={`${id}-fb`}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        className="h-11 w-44"
        placeholder={t('fieldFeedback')}
        maxLength={2000}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}>
        {t('saveGrade')}
      </Button>
      {message ? (
        <span
          role={message.kind === 'err' ? 'alert' : 'status'}
          className={
            message.kind === 'err' ? 'text-xs text-destructive' : 'text-xs text-emerald-700'
          }
        >
          {message.text}
        </span>
      ) : null}
    </form>
  );
}
