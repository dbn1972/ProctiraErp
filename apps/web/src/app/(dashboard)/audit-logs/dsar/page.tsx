/**
 * DSAR export — Data Subject Access Request (G-913).
 *
 * Enter a subject id (student, staff, guardian or user id); the gateway
 * returns every audit entry where the subject is the affected entity or the
 * acting user. PRC-M084: the export is an explicit POST ("Build package")
 * that the gateway audits; rendering or refreshing this page never exports.
 * `?subjectId=` only pre-fills the field.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import { readParam, type SearchParams } from '@/components/platform/PlatformSurfaceState';
import { loadStaffOptions, loadStudentOptions } from '@/lib/load-entity-labels';

import { DsarExportPanel } from './_components/dsar-export-panel';

export const dynamic = 'force-dynamic';

export default async function DsarPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const subjectId = readParam(searchParams, 'subjectId')?.trim() ?? '';
  const [studentOptions, staffOptions] = await Promise.all([
    loadStudentOptions(),
    loadStaffOptions(),
  ]);
  const subjectOptions = [
    ...studentOptions,
    ...staffOptions.map((option) => ({
      ...option,
      label: option.label.startsWith('Staff') ? option.label : `Staff · ${option.label}`,
    })),
  ];
  return (
    <section aria-labelledby="dsar-heading" className="space-y-6" data-testid="dsar-page">
      <DocumentTitle pageTitle="DSAR export" />
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-1">
          <Link href="/audit-logs">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Audit logs
          </Link>
        </Button>
        <h1 id="dsar-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          DSAR export
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Data Subject Access Request — everything the audit trail holds about one person, as the
          affected record or as the actor. This package covers audit-trail entries only, not the
          underlying records themselves.
        </p>
      </div>
      <DsarExportPanel subjectOptions={subjectOptions} defaultSubjectId={subjectId} />
    </section>
  );
}
