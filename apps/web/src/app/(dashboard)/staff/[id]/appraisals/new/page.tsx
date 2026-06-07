/**
 * /staff/[id]/appraisals/new — Create staff appraisal.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getStaff, listAppraisalTemplates } from '@/lib/api/staff';

import { AppraisalForm } from '../../../_components/appraisal-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function NewAppraisalPage({ params }: PageProps) {
  const [staff, templates] = await Promise.all([
    getStaff(params.id),
    listAppraisalTemplates(),
  ]);
  if (!staff) {
    notFound();
  }

  return (
    <section aria-labelledby="new-appraisal-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/staff/${staff.id}`}>
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to {staff.firstName} {staff.lastName}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="new-appraisal-heading">New appraisal</CardTitle>
          <CardDescription>
            Score each criterion defined on the selected template
            (Requirement 7.3). The appraisal is then routed through the workflow
            engine for approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No appraisal templates have been configured for this tenant. An
              administrator must create a template before appraisals can be
              recorded.
            </p>
          ) : (
            <AppraisalForm
              staffId={staff.id}
              templates={templates.map((t) => ({
                id: t.id,
                name: t.name,
                scoreMin: t.scoreMin,
                scoreMax: t.scoreMax,
                criteria: t.criteria.map((c) => ({
                  name: c.name,
                  weight: c.weight,
                  maxScore: c.maxScore,
                })),
              }))}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
