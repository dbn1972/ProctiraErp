'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { Search } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { SpiralPlanItem } from '@/lib/api/lms';
import { cn } from '@/lib/utils';

import { lookupStudentPalAction, type PalLookupState } from '../actions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const TYPE_STYLES: Record<SpiralPlanItem['type'], string> = {
  review: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  reinforce: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  introduce: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
};

function MasteryBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-all',
          pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function PalLookup({ students }: { students: Array<{ id: string; name: string }> }) {
  const t = useTranslations('lms');
  const id = useId();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [state, setState] = useState<PalLookupState>({ status: 'idle' });

  function lookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = studentId.trim();
    if (!UUID_RE.test(trimmed)) {
      setState({ status: 'error', message: t('errStudentId') });
      return;
    }
    startTransition(async () => {
      setState(await lookupStudentPalAction(trimmed));
    });
  }

  const plan = state.plan ?? null;
  const progress = state.progress ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('learnerPlan')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          onSubmit={lookup}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          data-testid="pal-lookup-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <div className="flex-1">
            <label htmlFor={`${id}-student`} className="mb-1 block text-sm font-medium">
              {t('fieldStudent')}
            </label>
            {students.length > 0 ? (
              <select
                id={`${id}-student`}
                className={selectClass}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`${id}-student`}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder={t('fieldIdPlaceholder')}
              />
            )}
          </div>
          <Button type="submit" disabled={pending} aria-busy={pending} className="min-h-11">
            <Search className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('loadPlan')}
          </Button>
        </form>

        {state.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {state.status === 'success' && plan ? (
          <div className="space-y-5" data-testid="pal-plan">
            <dl className="grid gap-3 sm:grid-cols-5">
              {(
                [
                  ['dueReviews', plan.summary.dueReviews],
                  ['mastered', plan.summary.mastered],
                  ['inProgress', plan.summary.inProgress],
                  ['notStarted', plan.summary.notStarted],
                  ['blocked', plan.summary.blocked],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{t(`pal_${key}`)}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            {plan.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('planEmpty')}</p>
            ) : (
              <ol className="space-y-2">
                {plan.items.map((item, i) => (
                  <li
                    key={`${item.skillId}-${i}`}
                    className="rounded-lg border p-3"
                    data-testid="pal-plan-item"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                            TYPE_STYLES[item.type],
                          )}
                        >
                          {t(`plan_${item.type}`)}
                        </span>
                        <span className="font-medium">{item.skillName}</span>
                        <span className="text-xs text-muted-foreground">· {item.subject}</span>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t('masteryPct', { pct: Math.round(item.mastery * 100) })}
                      </span>
                    </div>
                    <div className="mt-2">
                      <MasteryBar
                        value={item.mastery}
                        label={t('masteryOf', { skill: item.skillName })}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                  </li>
                ))}
              </ol>
            )}

            {progress && progress.skills.length > 0 ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t('masteryLedger', { avg: Math.round(progress.summary.averageMastery * 100) })}
                </summary>
                <ul className="mt-3 space-y-2">
                  {progress.skills.map(({ skill, mastery }) => (
                    <li
                      key={skill.id}
                      className="grid gap-1 sm:grid-cols-[1fr_2fr_auto] sm:items-center sm:gap-3"
                    >
                      <span className="text-sm">{skill.name}</span>
                      <MasteryBar
                        value={mastery?.mastery ?? 0}
                        label={t('masteryOf', { skill: skill.name })}
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {mastery
                          ? t('attemptsSummary', {
                              correct: mastery.correct,
                              attempts: mastery.attempts,
                            })
                          : t('pal_notStarted')}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
