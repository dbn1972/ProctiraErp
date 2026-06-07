/**
 * Scholarship program detail page.
 *
 * Validates: Requirement 11.1 — view scholarship program detail and quick
 * navigation to applications.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Award } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getScholarshipProgram } from '@/lib/api/scholarships';

interface PageProps {
  params: { id: string };
}

export default async function ScholarshipProgramPage({ params }: PageProps) {
  const program = await getScholarshipProgram(params.id);
  if (!program) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Award className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-xl">{program.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Code <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{program.code}</code>
                </p>
              </div>
            </div>
            <Badge variant={program.status === 'OPEN' ? 'success' : 'secondary'}>
              {program.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <SummaryRow label="Total slots" value={program.totalSlots.toLocaleString()} />
          <SummaryRow
            label="Award amount"
            value={`${program.currency} ${program.awardAmount.toLocaleString()}`}
          />
          <SummaryRow label="Application opens" value={program.applicationStartDate} />
          <SummaryRow label="Application closes" value={program.applicationEndDate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications</CardTitle>
          <CardDescription>
            Review applications submitted to this program.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href={`/scholarships/applications?programId=${program.id}`}>
              View applications
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
