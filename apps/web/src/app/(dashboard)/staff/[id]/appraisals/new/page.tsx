/**
 * /staff/[id]/appraisals/new — Create staff appraisal — v2.0 redesign.
 *
 * v2.0 changes:
 * - text-3xl font-extrabold heading "New appraisal"
 * - Subtitle: 1–5 scale description + BEO routing note
 * - "Back to profile" in page-head actions
 * - max-w-[860px] Card + AppraisalForm kept 100% intact
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

  const fullName = `${staff.firstName} ${staff.lastName}`;

  return (
    <section aria-labelledby="new-appraisal-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="new-appraisal-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            New appraisal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rate {fullName} on each criterion from 1 (needs improvement)
            to 5 (outstanding). On submit the appraisal is routed for
            approval through the workflow engine.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/staff/${staff.id}`}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to profile
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Form card ── */}
      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Appraisal details & criteria</CardTitle>
          <CardDescription>
            Score each criterion defined on the selected template
            (Requirement 7.3). The total score and rating band are calculated
            automatically as you fill in scores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
