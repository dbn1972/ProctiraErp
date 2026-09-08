/**
 * Create assignment / homework / quiz (Server Component shell).
 * FR-UX-002 · FR-UX-003 — kind selector, Board/School scope, quiz builder.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { listAreas, listInstitutions } from '@/lib/api/institutions';
import { listSkills } from '@/lib/api/lms';

import { NewAssignmentForm } from '../../_components/new-assignment-form';

export const dynamic = 'force-dynamic';

export default async function NewAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kindParam = typeof params.kind === 'string' ? params.kind : undefined;
  const initialKind =
    kindParam === 'homework' || kindParam === 'quiz' || kindParam === 'assignment'
      ? kindParam
      : 'assignment';

  const [t, institutions, areas, skills] = await Promise.all([
    getTranslations('lms'),
    listInstitutions({ pageSize: 200 }),
    listAreas(),
    listSkills(),
  ]);

  const boards = areas
    .filter((a) => a.parentId === null || a.level === 0)
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <section aria-labelledby="lms-new-heading" className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
          <Link href="/lms">
            <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('backToHub')}
          </Link>
        </Button>
        <h1 id="lms-new-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          {t('newWork')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('newWorkSubtitle')}</p>
      </div>
      <NewAssignmentForm
        initialKind={initialKind}
        institutions={institutions.map((i) => ({ id: i.id, name: i.name, code: i.code }))}
        boards={boards}
        skills={skills.map((s) => ({ id: s.id, name: s.name, subject: s.subject }))}
      />
    </section>
  );
}
