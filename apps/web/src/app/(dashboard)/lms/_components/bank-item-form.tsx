'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Input, Label, Textarea } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import { createBankItemAction } from '../depth-actions';

export function BankItemForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    startTransition(async () => {
      const result = await createBankItemAction({
        scope: 'school',
        institutionId: String(form.get('institutionId') ?? ''),
        subject: String(form.get('subject') ?? ''),
        gradeLevel: String(form.get('gradeLevel') ?? ''),
        tags: String(form.get('tags') ?? ''),
        questionType: String(form.get('questionType') ?? 'mcq') as
          | 'mcq'
          | 'msq'
          | 'numeric'
          | 'match'
          | 'essay',
        difficulty: String(form.get('difficulty') ?? 'medium') as 'easy' | 'medium' | 'hard',
        prompt: String(form.get('prompt') ?? ''),
        options: String(form.get('options') ?? ''),
        correctOptionIndex: Number(form.get('correctOptionIndex') ?? 0),
        correctIndexes: String(form.get('correctIndexes') ?? ''),
        correctValue: form.get('correctValue') ? Number(form.get('correctValue')) : undefined,
        tolerance: form.get('tolerance') ? Number(form.get('tolerance')) : undefined,
        pairs: String(form.get('pairs') ?? ''),
        points: form.get('points') ? Number(form.get('points')) : 1,
      });
      if (result.status === 'success') {
        setMessage('Bank item saved.');
        router.refresh();
        target.reset();
      } else {
        setMessage(result.message ?? 'Could not save the item.');
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
      data-testid="lms-bank-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div className="space-y-1">
        <Label htmlFor="bank-subject">Subject</Label>
        <Input id="bank-subject" name="subject" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-institution">School ID</Label>
        <Input id="bank-institution" name="institutionId" required className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-grade">Grade</Label>
        <Input id="bank-grade" name="gradeLevel" placeholder="7" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-tags">Tags (comma-separated)</Label>
        <Input id="bank-tags" name="tags" placeholder="fractions, algebra" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-type">Type</Label>
        <select
          id="bank-type"
          name="questionType"
          className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="mcq">MCQ</option>
          <option value="msq">MSQ</option>
          <option value="numeric">Numeric</option>
          <option value="match">Match</option>
          <option value="essay">Essay</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-diff">Difficulty</Label>
        <select
          id="bank-diff"
          name="difficulty"
          defaultValue="medium"
          className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label htmlFor="bank-prompt">Prompt</Label>
        <Textarea id="bank-prompt" name="prompt" required rows={3} />
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label htmlFor="bank-options">Options (one per line, MCQ/MSQ)</Label>
        <Textarea id="bank-options" name="options" rows={3} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-correct">Correct MCQ index</Label>
        <Input
          id="bank-correct"
          name="correctOptionIndex"
          type="number"
          min={0}
          defaultValue={0}
          className="h-11"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-msq">MSQ correct indexes (0,2)</Label>
        <Input id="bank-msq" name="correctIndexes" placeholder="0,2" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-numeric">Numeric answer</Label>
        <Input id="bank-numeric" name="correctValue" type="number" step="any" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-tol">Numeric tolerance</Label>
        <Input id="bank-tol" name="tolerance" type="number" step="any" min={0} className="h-11" />
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label htmlFor="bank-pairs">Match pairs (left|right, one per line)</Label>
        <Textarea id="bank-pairs" name="pairs" rows={2} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bank-points">Points</Label>
        <Input
          id="bank-points"
          name="points"
          type="number"
          min={0.5}
          step={0.5}
          defaultValue={1}
          className="h-11"
        />
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        Add to bank
      </Button>
      {message ? (
        <p role="status" className="sm:col-span-2 text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
