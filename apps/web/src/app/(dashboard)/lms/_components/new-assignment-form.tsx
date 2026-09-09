'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { AssignmentKind, LmsScope, QuizQuestionInput } from '@/lib/api/lms';
import { cn } from '@/lib/utils';

import { createAssignmentAction } from '../actions';

interface Option {
  id: string;
  name: string;
  code?: string;
}

interface SkillOption {
  id: string;
  name: string;
  subject: string;
}

interface BankOption {
  id: string;
  prompt: string;
  questionType: string;
  subject: string;
}

interface QuestionDraft extends QuizQuestionInput {
  key: string;
}

const KINDS: readonly AssignmentKind[] = ['assignment', 'homework', 'quiz'];
const MAX_QUESTIONS = 50;

const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function newQuestion(): QuestionDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    prompt: '',
    options: ['', ''],
    correctOptionIndex: 0,
    points: 1,
  };
}

export function NewAssignmentForm({
  initialKind,
  institutions,
  boards,
  skills,
  bankItems = [],
}: {
  initialKind: AssignmentKind;
  institutions: Option[];
  boards: Option[];
  skills: SkillOption[];
  bankItems?: BankOption[];
}) {
  const t = useTranslations('lms');
  const tc = useTranslations('common');
  const router = useRouter();
  const formId = useId();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<AssignmentKind>(initialKind);
  const [scope, setScope] = useState<LmsScope>('school');
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? '');
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [description, setDescription] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [dueAt, setDueAt] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [allowLate, setAllowLate] = useState(true);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion()]);
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [publish, setPublish] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const isQuiz = kind === 'quiz';

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = t('errRequired');
    if (!subject.trim()) next.subject = t('errRequired');
    if (scope === 'school' && !institutionId) next.institutionId = t('errRequired');
    if (scope === 'board' && !boardId) next.boardId = t('errRequired');
    const score = Number(maxScore);
    if (!Number.isFinite(score) || score <= 0) next.maxScore = t('errPositive');
    if (timeLimit && (!Number.isFinite(Number(timeLimit)) || Number(timeLimit) <= 0)) {
      next.timeLimit = t('errPositive');
    }
    if (isQuiz) {
      const filled = questions.filter((q) => q.prompt.trim());
      if (filled.length === 0 && bankIds.length === 0) next.questions = t('errQuizNeedsQuestion');
      filled.forEach((q, i) => {
        if (!q.prompt.trim()) next[`q-${i}-prompt`] = t('errRequired');
        const filledOpts = q.options.filter((o) => o.trim());
        if (filledOpts.length < 2) next[`q-${i}-options`] = t('errTwoOptions');
        if (!q.options[q.correctOptionIndex]?.trim())
          next[`q-${i}-correct`] = t('errCorrectOption');
      });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    startTransition(async () => {
      const result = await createAssignmentAction({
        scope,
        institutionId: scope === 'school' ? institutionId : undefined,
        boardId: scope === 'board' ? boardId : undefined,
        kind,
        title: title.trim(),
        description: description.trim() || undefined,
        subject: subject.trim(),
        gradeLevel: gradeLevel.trim() || undefined,
        skillIds: skillIds.length ? skillIds : undefined,
        maxScore: Number(maxScore),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        timeLimitMinutes: isQuiz && timeLimit ? Number(timeLimit) : undefined,
        allowLate,
        publish,
        questions: isQuiz
          ? questions
              .filter((q) => q.prompt.trim())
              .map((q) => ({
                prompt: q.prompt.trim(),
                options: q.options.map((o) => o.trim()).filter(Boolean),
                correctOptionIndex: q.correctOptionIndex,
                points: q.points,
                skillId: q.skillId || undefined,
                explanation: q.explanation?.trim() || undefined,
              }))
          : undefined,
        bankQuestionIds: isQuiz && bankIds.length > 0 ? bankIds : undefined,
      });
      if (result.status === 'success' && result.id) {
        router.push(`/lms/assignments/${result.id}`);
        router.refresh();
      } else {
        setServerError(result.message ?? tc('error'));
      }
    });
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-6"
      data-testid="lms-assignment-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      aria-describedby={serverError ? `${formId}-err` : undefined}
    >
      {serverError ? (
        <div
          id={`${formId}-err`}
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionBasics')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('fieldKind')}</legend>
            <div
              className="grid gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label={t('fieldKind')}
            >
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'min-h-11 rounded-lg border px-3 py-2 text-start text-sm font-medium transition-colors',
                    kind === k
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {t(
                    k === 'assignment'
                      ? 'kindAssignment'
                      : k === 'homework'
                        ? 'kindHomework'
                        : 'kindQuiz',
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t(
                      k === 'assignment'
                        ? 'kindAssignmentHint'
                        : k === 'homework'
                          ? 'kindHomeworkHint'
                          : 'kindQuizHint',
                    )}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${formId}-title`} label={t('fieldTitle')} required error={errors.title}>
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                aria-invalid={Boolean(errors.title)}
              />
            </FormField>
            <FormField
              id={`${formId}-subject`}
              label={t('fieldSubject')}
              required
              error={errors.subject}
            >
              <Input
                id={`${formId}-subject`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={80}
                aria-invalid={Boolean(errors.subject)}
              />
            </FormField>
            <FormField
              id={`${formId}-grade`}
              label={t('fieldGradeLevel')}
              hint={t('fieldGradeLevelHint')}
            >
              <Input
                id={`${formId}-grade`}
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                maxLength={20}
              />
            </FormField>
            <FormField
              id={`${formId}-max`}
              label={t('fieldMaxScore')}
              required
              error={errors.maxScore}
            >
              <Input
                id={`${formId}-max`}
                type="number"
                inputMode="decimal"
                min={1}
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                aria-invalid={Boolean(errors.maxScore)}
              />
            </FormField>
          </div>

          <FormField id={`${formId}-desc`} label={t('fieldDescription')}>
            <Textarea
              id={`${formId}-desc`}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionScope')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('sectionScope')}
          >
            {(['school', 'board'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
                className={cn(
                  'min-h-11 rounded-lg border px-3 py-2 text-start text-sm font-medium transition-colors',
                  scope === s
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted',
                )}
              >
                {s === 'school' ? t('scopeSchool') : t('scopeBoard')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {s === 'school' ? t('scopeSchoolHint') : t('scopeBoardHint')}
                </span>
              </button>
            ))}
          </div>

          {scope === 'school' ? (
            <FormField
              id={`${formId}-inst`}
              label={t('fieldInstitution')}
              required
              error={errors.institutionId}
            >
              {institutions.length > 0 ? (
                <select
                  id={`${formId}-inst`}
                  className={selectClass}
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                  aria-invalid={Boolean(errors.institutionId)}
                >
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code ? `${i.code} · ${i.name}` : i.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${formId}-inst`}
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                  placeholder={t('fieldIdPlaceholder')}
                  aria-invalid={Boolean(errors.institutionId)}
                />
              )}
            </FormField>
          ) : (
            <FormField
              id={`${formId}-board`}
              label={t('fieldBoard')}
              required
              error={errors.boardId}
              hint={t('fieldBoardHint')}
            >
              {boards.length > 0 ? (
                <select
                  id={`${formId}-board`}
                  className={selectClass}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  aria-invalid={Boolean(errors.boardId)}
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${formId}-board`}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  placeholder={t('fieldIdPlaceholder')}
                  aria-invalid={Boolean(errors.boardId)}
                />
              )}
            </FormField>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionSchedule')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id={`${formId}-due`} label={t('fieldDueAt')}>
            <Input
              id={`${formId}-due`}
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </FormField>
          {isQuiz ? (
            <FormField id={`${formId}-limit`} label={t('fieldTimeLimit')} error={errors.timeLimit}>
              <Input
                id={`${formId}-limit`}
                type="number"
                inputMode="numeric"
                min={1}
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
                aria-invalid={Boolean(errors.timeLimit)}
              />
            </FormField>
          ) : null}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              id={`${formId}-late`}
              checked={allowLate}
              onCheckedChange={(v) => setAllowLate(v === true)}
            />
            <Label htmlFor={`${formId}-late`} className="text-sm">
              {t('fieldAllowLate')}
            </Label>
          </div>
        </CardContent>
      </Card>

      {skills.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sectionSkills')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">{t('sectionSkillsHint')}</p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {skills.map((s) => {
                const checked = skillIds.includes(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${formId}-skill-${s.id}`}
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSkillIds((prev) =>
                          v === true ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <Label htmlFor={`${formId}-skill-${s.id}`} className="text-sm">
                      {s.name} <span className="text-muted-foreground">· {s.subject}</span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {isQuiz ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add from bank</CardTitle>
          </CardHeader>
          <CardContent>
            {bankItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bank items yet. Author them under Question bank.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="lms-bank-picker">
                {bankItems.map((item) => {
                  const checked = bankIds.includes(item.id);
                  return (
                    <li key={item.id} className="flex min-h-11 items-center gap-2">
                      <Checkbox
                        id={`${formId}-bank-${item.id}`}
                        checked={checked}
                        onCheckedChange={(v) =>
                          setBankIds((prev) =>
                            v === true ? [...prev, item.id] : prev.filter((x) => x !== item.id),
                          )
                        }
                      />
                      <Label htmlFor={`${formId}-bank-${item.id}`} className="text-sm">
                        {item.prompt}{' '}
                        <span className="text-muted-foreground">
                          · {item.questionType} · {item.subject}
                        </span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {isQuiz ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              {t('sectionQuestions', { count: questions.length })}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={questions.length >= MAX_QUESTIONS}
              onClick={() => setQuestions((prev) => [...prev, newQuestion()])}
            >
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('addQuestion')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {errors.questions ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.questions}
              </p>
            ) : null}
            {questions.map((q, i) => (
              <fieldset key={q.key} className="rounded-lg border p-4" data-testid="quiz-question">
                <legend className="px-1 text-sm font-semibold">
                  {t('questionN', { n: i + 1 })}
                </legend>
                <div className="space-y-4">
                  <FormField
                    id={`${formId}-q${i}-prompt`}
                    label={t('fieldPrompt')}
                    required
                    error={errors[`q-${i}-prompt`]}
                  >
                    <Textarea
                      id={`${formId}-q${i}-prompt`}
                      rows={2}
                      value={q.prompt}
                      onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
                      aria-invalid={Boolean(errors[`q-${i}-prompt`])}
                    />
                  </FormField>

                  <div>
                    <p className="mb-2 text-sm font-medium">{t('fieldOptions')}</p>
                    {errors[`q-${i}-options`] || errors[`q-${i}-correct`] ? (
                      <p role="alert" className="mb-2 text-sm text-destructive">
                        {errors[`q-${i}-options`] ?? errors[`q-${i}-correct`]}
                      </p>
                    ) : null}
                    <ul
                      className="space-y-2"
                      role="radiogroup"
                      aria-label={t('fieldCorrectOption')}
                    >
                      {q.options.map((opt, oi) => (
                        <li key={oi} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`${formId}-q${i}-correct`}
                            checked={q.correctOptionIndex === oi}
                            onChange={() => updateQuestion(i, { correctOptionIndex: oi })}
                            aria-label={t('markCorrect', { n: oi + 1 })}
                            className="h-5 w-5 accent-primary"
                          />
                          <Input
                            value={opt}
                            onChange={(e) =>
                              updateQuestion(i, {
                                options: q.options.map((o, idx) =>
                                  idx === oi ? e.target.value : o,
                                ),
                              })
                            }
                            aria-label={t('optionN', { n: oi + 1 })}
                            maxLength={500}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            disabled={q.options.length <= 2}
                            aria-label={t('removeOption', { n: oi + 1 })}
                            onClick={() =>
                              updateQuestion(i, {
                                options: q.options.filter((_, idx) => idx !== oi),
                                correctOptionIndex:
                                  q.correctOptionIndex >= oi && q.correctOptionIndex > 0
                                    ? q.correctOptionIndex - 1
                                    : q.correctOptionIndex,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="mt-1 px-0"
                      disabled={q.options.length >= 8}
                      onClick={() => updateQuestion(i, { options: [...q.options, ''] })}
                    >
                      {t('addOption')}
                    </Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField id={`${formId}-q${i}-points`} label={t('fieldPoints')}>
                      <Input
                        id={`${formId}-q${i}-points`}
                        type="number"
                        inputMode="decimal"
                        min={0.5}
                        step={0.5}
                        value={q.points ?? 1}
                        onChange={(e) =>
                          updateQuestion(i, { points: Math.max(0.5, Number(e.target.value) || 1) })
                        }
                      />
                    </FormField>
                    {skills.length > 0 ? (
                      <FormField id={`${formId}-q${i}-skill`} label={t('fieldSkill')}>
                        <select
                          id={`${formId}-q${i}-skill`}
                          className={selectClass}
                          value={q.skillId ?? ''}
                          onChange={(e) =>
                            updateQuestion(i, { skillId: e.target.value || undefined })
                          }
                        >
                          <option value="">{t('noSkill')}</option>
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    ) : null}
                    <FormField id={`${formId}-q${i}-expl`} label={t('fieldExplanation')}>
                      <Input
                        id={`${formId}-q${i}-expl`}
                        value={q.explanation ?? ''}
                        onChange={(e) => updateQuestion(i, { explanation: e.target.value })}
                        maxLength={1000}
                      />
                    </FormField>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={questions.length <= 1}
                      onClick={() => setQuestions((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="me-1.5 h-4 w-4" aria-hidden="true" />
                      {t('removeQuestion')}
                    </Button>
                  </div>
                </div>
              </fieldset>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${formId}-publish`}
            checked={publish}
            onCheckedChange={(v) => setPublish(v === true)}
          />
          <Label htmlFor={`${formId}-publish`} className="text-sm">
            {t('publishImmediately')}
          </Label>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/lms')}
            disabled={pending}
          >
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? tc('loading') : publish ? t('createAndPublish') : t('saveDraft')}
          </Button>
        </div>
      </div>
    </form>
  );
}
