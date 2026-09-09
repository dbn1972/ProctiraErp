/**
 * Question bank (G-915).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listBankQuestions } from '@/lib/api/lms';
import { EmptyState } from '@/components/page';

import { BankItemForm } from '../_components/bank-item-form';
import { LmsSubnav } from '../_components/lms-subnav';

export const dynamic = 'force-dynamic';

export default async function LmsBankPage() {
  const items = await listBankQuestions();
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
                {item.tags.length > 0 ? ` · ${item.tags.join(', ')}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
