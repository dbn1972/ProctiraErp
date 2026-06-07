/**
 * Examination detail layout with tab navigation.
 *
 * Validates: Requirement 10.1 — examination detail navigation across
 * overview, candidates, results, and documents.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FileText } from 'lucide-react';

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getExamination } from '@/lib/api/examinations';

interface LayoutProps {
  params: { id: string };
  children: React.ReactNode;
}

export default async function ExaminationDetailLayout({ params, children }: LayoutProps) {
  const examination = await getExamination(params.id);
  if (!examination) notFound();

  const tabs = [
    { href: `/examinations/${params.id}`, label: 'Overview' },
    { href: `/examinations/${params.id}/candidates`, label: 'Candidates' },
    { href: `/examinations/${params.id}/results`, label: 'Results' },
    { href: `/examinations/${params.id}/documents`, label: 'Documents' },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <FileText className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-xl">{examination.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Code <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{examination.code}</code>
                  {' · '}
                  {examination.examinationDate}
                </p>
              </div>
            </div>
            <Badge variant={examination.status === 'OPEN' ? 'success' : 'secondary'}>
              {examination.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="border-t pt-4">
          <nav aria-label="Examination sections" className="flex gap-2">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </CardContent>
      </Card>

      {children}
    </div>
  );
}
