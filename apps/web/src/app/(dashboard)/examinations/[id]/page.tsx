/**
 * Examination overview tab.
 *
 * Validates: Requirement 10.1 — examination definition summary.
 */
import { notFound } from 'next/navigation';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getExamination } from '@/lib/api/examinations';

interface PageProps {
  params: { id: string };
}

export default async function ExaminationOverviewPage({ params }: PageProps) {
  const exam = await getExamination(params.id);
  if (!exam) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <SummaryRow label="Name" value={exam.name} />
        <SummaryRow label="Code" value={exam.code} mono />
        <SummaryRow label="Examination date" value={exam.examinationDate} />
        <SummaryRow
          label="Registration window"
          value={
            exam.registrationStartDate && exam.registrationEndDate
              ? `${exam.registrationStartDate} → ${exam.registrationEndDate}`
              : '—'
          }
        />
        <SummaryRow label="Status" value={exam.status} />
        <SummaryRow
          label="Candidates"
          value={exam.candidateCount?.toLocaleString() ?? '—'}
        />
        <SummaryRow
          label="Results"
          value={exam.resultsPublished ? 'Published' : 'Pending'}
        />
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
