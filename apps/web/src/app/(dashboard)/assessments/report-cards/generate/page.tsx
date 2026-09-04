/**
 * /assessments/report-cards/generate — Queue single or bulk PDF generation.
 *
 * v2.0 redesign + assessment form patterns. Wires
 * POST /api/v1/report-cards/generate and /generate/bulk.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { listReportCardTemplates } from '@/lib/api/report-cards';
import {
  listAcademicPeriods,
  listInstitutions,
} from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

import { ReportCardGenerateForm } from '../_components/generate-form';

export const dynamic = 'force-dynamic';

export default async function GenerateReportCardsPage() {
  const [templates, institutionsResult, academicPeriods] = await Promise.all([
    listReportCardTemplates(),
    listInstitutions({ pageSize: 100 }).catch(() => ({
      data: [] as Array<{ id: string; name: string }>,
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    })),
    listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
  ]);

  const institutions = (institutionsResult.data ?? []).map((inst) => ({
    id: inst.id,
    name: inst.name,
  }));

  return (
    <section aria-labelledby="generate-report-cards-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments/report-cards">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to report cards
        </Link>
      </Button>

      <div>
        <h1
          id="generate-report-cards-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Generate report cards
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Queue PDF generation for a student or a class batch using a
          configured template.
        </p>
      </div>

      <ReportCardGenerateForm
        templates={templates}
        institutions={institutions}
        academicPeriods={academicPeriods.map((p) => ({
          id: p.id,
          name: p.name,
        }))}
      />
    </section>
  );
}
