/**
 * Rubrics (G-915).
 */
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';

import { listRubricsResult } from '@/lib/api/lms';
import { loadInstitutionOptions } from '@/lib/load-entity-labels';
import { EmptyState } from '@/components/page';
import { ListLoadFailure } from '@/components/route-state/list-load-failure';

import { LmsSubnav } from '../_components/lms-subnav';
import { RubricForm } from '../_components/rubric-form';

export const dynamic = 'force-dynamic';

export default async function LmsRubricsPage() {
  const [rubrics, schools, t] = await Promise.all([
    listRubricsResult(),
    loadInstitutionOptions(),
    getTranslations('lms'),
  ]);
  const items = rubrics.ok ? rubrics.items : [];
  return (
    <section className="space-y-6" aria-labelledby="lms-rubrics-heading">
      <div>
        <h1 id="lms-rubrics-heading" className="text-3xl font-extrabold tracking-tight">
          {t('rubricsTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('rubricsSubtitle')}</p>
      </div>
      <LmsSubnav current="/lms/rubrics" />
      <Card>
        <CardHeader>
          <CardTitle>{t('rubricsNew')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RubricForm schools={schools} />
        </CardContent>
      </Card>
      {!rubrics.ok ? (
        <ListLoadFailure kind={rubrics.kind} status={rubrics.status} returnTo="/lms/rubrics" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title={t('rubricsEmptyTitle')} description={t('rubricsEmptyBody')} />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border p-4" data-testid="lms-rubric-row">
              <p className="font-semibold">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.subject ?? t('rubricsAnySubject')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
