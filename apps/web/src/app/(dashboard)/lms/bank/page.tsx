/**
 * Question bank (G-915).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listBankQuestions, type QuestionType } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { BankItemForm } from '../_components/bank-item-form';
import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = typeof params.subject === 'string' ? params.subject : undefined;
  const gradeLevel = typeof params.gradeLevel === 'string' ? params.gradeLevel : undefined;
  const tags = typeof params.tags === 'string' ? params.tags : undefined;
  const typeParam = typeof params.questionType === 'string' ? params.questionType : undefined;
  const questionType =
    typeParam === 'mcq' ||
    typeParam === 'msq' ||
    typeParam === 'numeric' ||
    typeParam === 'match' ||
    typeParam === 'essay'
      ? (typeParam as QuestionType)
      : undefined;
  const items = await listBankQuestions({ subject, gradeLevel, tags, questionType });
  return (
    <section className="space-y-6" aria-labelledby="lms-bank-heading">
      <div>
        <h1 id="lms-bank-heading" className="text-3xl font-extrabold tracking-tight">
          Question bank
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Author MCQ, MSQ, numeric, match and essay items, then pull them into a quiz.
        </p>
      </div>
      <LmsSubnav current="/lms/bank" />
      <form className="grid gap-2 sm:grid-cols-4" action="/lms/bank" method="get">
        <input
          name="subject"
          defaultValue={subject ?? ''}
          placeholder="Subject"
          className="h-11 rounded-md border px-3"
          aria-label="Filter by subject"
        />
        <input
          name="gradeLevel"
          defaultValue={gradeLevel ?? ''}
          placeholder="Grade"
          className="h-11 rounded-md border px-3"
          aria-label="Filter by grade"
        />
        <input
          name="tags"
          defaultValue={tags ?? ''}
          placeholder="Tags"
          className="h-11 rounded-md border px-3"
          aria-label="Filter by tags"
        />
        <select
          name="questionType"
          defaultValue={questionType ?? ''}
          className="h-11 rounded-md border px-3"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="mcq">MCQ</option>
          <option value="msq">MSQ</option>
          <option value="numeric">Numeric</option>
          <option value="match">Match</option>
          <option value="essay">Essay</option>
        </select>
        <button type="submit" className="h-11 rounded-md border px-4 text-sm font-medium">
          Filter
        </button>
      </form>
      <Card>
        <CardHeader>
          <CardTitle>New bank item</CardTitle>
        </CardHeader>
        <CardContent>
          <BankItemForm />
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No bank items yet" description="Add the first question above." />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border p-4" data-testid="lms-bank-row">
              <p className="font-semibold">{item.prompt}</p>
              <p className="text-xs text-muted-foreground">
                {item.questionType} · {item.difficulty} · {item.subject}
                {item.gradeLevel ? ` · ${item.gradeLevel}` : ''}
                {item.tags.length > 0 ? ` · ${item.tags.join(', ')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
