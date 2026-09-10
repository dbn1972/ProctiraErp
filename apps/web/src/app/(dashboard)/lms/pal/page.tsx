/**
 * Spiral PAL dashboard (Server Component shell).
 * FR-UX-005 — skills taxonomy overview, learner lookup → plan + mastery ledger.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Brain, Layers, Share2 } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@proctira/ui/components';
import { listGradebookBoards } from '@/lib/api/gradebook';
import { listInstitutions } from '@/lib/api/institutions';
import { listSkills } from '@/lib/api/lms';
import { listStudents } from '@/lib/api/students';

import { KpiCard } from '../_components/kpi-card';
import { ScopePill } from '../_components/badges';
import { NewSkillForm } from '../_components/new-skill-form';
import { PalLookup } from '../_components/pal-lookup';

export const dynamic = 'force-dynamic';

export default async function SpiralPalPage() {
  const [t, skills, students, institutions, boardsResult] = await Promise.all([
    getTranslations('lms'),
    listSkills(),
    listStudents({ pageSize: 50, sortBy: 'lastName', sortOrder: 'asc' }).catch(() => ({
      data: [],
      meta: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    })),
    listInstitutions({ pageSize: 200 }),
    listGradebookBoards(),
  ]);

  const subjects = new Set(skills.map((s) => s.subject));
  const boardSkills = skills.filter((s) => s.scope === 'board');
  const boards = (boardsResult.ok ? boardsResult.data : []).map((b) => ({
    id: b.id,
    name: b.code ? `${b.code} · ${b.name}` : b.name,
  }));

  return (
    <section aria-labelledby="pal-heading" className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
          <Link href="/lms">
            <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('backToHub')}
          </Link>
        </Button>
        <h1 id="pal-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          {t('spiralPal')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('palSubtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<Brain className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label={t('kpiSkills')}
          value={skills.length.toLocaleString()}
          foot={t('kpiSkillsFoot')}
        />
        <KpiCard
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
          label={t('kpiSubjects')}
          value={subjects.size.toLocaleString()}
        />
        <KpiCard
          icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label={t('kpiBoardSkills')}
          value={boardSkills.length.toLocaleString()}
          foot={t('sharedWithSchools')}
        />
      </div>

      <PalLookup
        students={students.data.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
        }))}
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('skillTaxonomy')}</CardTitle>
          </CardHeader>
          <CardContent>
            {skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noSkills')}</p>
            ) : (
              <ul className="divide-y" data-testid="skill-list">
                {skills.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">
                        <span className="me-2 font-mono text-xs text-muted-foreground">
                          {s.code}
                        </span>
                        {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.subject}
                        {s.gradeLevel ? ` · ${t('grade', { grade: s.gradeLevel })}` : ''}
                        {s.prerequisiteSkillIds.length > 0
                          ? ` · ${t('prereqCount', { count: s.prerequisiteSkillIds.length })}`
                          : ''}
                      </p>
                    </div>
                    <ScopePill
                      scope={s.scope}
                      label={s.scope === 'board' ? t('scopeBoard') : t('scopeSchool')}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <NewSkillForm
          institutions={institutions.map((i) => ({ id: i.id, name: i.name, code: i.code }))}
          boards={boards}
          existingSkills={skills.map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>
    </section>
  );
}
