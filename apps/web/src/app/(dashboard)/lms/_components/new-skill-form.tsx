'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import type { LmsScope } from '@/lib/api/lms';

import { createSkillAction } from '../actions';

interface Option {
  id: string;
  name: string;
  code?: string;
}

const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function NewSkillForm({
  institutions,
  boards,
  existingSkills,
}: {
  institutions: Option[];
  boards: Option[];
  existingSkills: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('lms');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<LmsScope>('board');
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? '');
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [prereq, setPrereq] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!code.trim()) next.code = t('errRequired');
    if (!name.trim()) next.name = t('errRequired');
    if (!subject.trim()) next.subject = t('errRequired');
    if (scope === 'school' && !institutionId) next.institutionId = t('errRequired');
    if (scope === 'board' && !boardId) next.boardId = t('errRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setMessage(null);
    startTransition(async () => {
      const result = await createSkillAction({
        scope,
        institutionId: scope === 'school' ? institutionId : undefined,
        boardId: scope === 'board' ? boardId : undefined,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        subject: subject.trim(),
        gradeLevel: gradeLevel.trim() || undefined,
        prerequisiteSkillIds: prereq ? [prereq] : undefined,
      });
      if (result.status === 'success') {
        setMessage({ kind: 'ok', text: t('skillCreated') });
        setCode('');
        setName('');
        setPrereq('');
        router.refresh();
      } else {
        setMessage({ kind: 'err', text: result.message ?? tc('error') });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('newSkill')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormField id={`${id}-scope`} label={t('sectionScope')}>
            <select
              id={`${id}-scope`}
              className={selectClass}
              value={scope}
              onChange={(e) => setScope(e.target.value as LmsScope)}
            >
              <option value="board">{t('scopeBoard')}</option>
              <option value="school">{t('scopeSchool')}</option>
            </select>
          </FormField>
          {scope === 'school' ? (
            <FormField
              id={`${id}-inst`}
              label={t('fieldInstitution')}
              required
              error={errors.institutionId}
            >
              {institutions.length > 0 ? (
                <select
                  id={`${id}-inst`}
                  className={selectClass}
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                >
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code ? `${i.code} · ${i.name}` : i.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${id}-inst`}
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                  placeholder={t('fieldIdPlaceholder')}
                />
              )}
            </FormField>
          ) : (
            <FormField id={`${id}-board`} label={t('fieldBoard')} required error={errors.boardId}>
              {boards.length > 0 ? (
                <select
                  id={`${id}-board`}
                  className={selectClass}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${id}-board`}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  placeholder={t('fieldIdPlaceholder')}
                />
              )}
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${id}-code`}
              label={t('fieldSkillCode')}
              required
              error={errors.code}
              hint={t('fieldSkillCodeHint')}
            >
              <Input
                id={`${id}-code`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={40}
                aria-invalid={Boolean(errors.code)}
              />
            </FormField>
            <FormField id={`${id}-name`} label={t('fieldSkillName')} required error={errors.name}>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                aria-invalid={Boolean(errors.name)}
              />
            </FormField>
            <FormField
              id={`${id}-subject`}
              label={t('fieldSubject')}
              required
              error={errors.subject}
            >
              <Input
                id={`${id}-subject`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={80}
                aria-invalid={Boolean(errors.subject)}
              />
            </FormField>
            <FormField id={`${id}-grade`} label={t('fieldGradeLevel')}>
              <Input
                id={`${id}-grade`}
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                maxLength={20}
              />
            </FormField>
          </div>
          {existingSkills.length > 0 ? (
            <FormField
              id={`${id}-prereq`}
              label={t('fieldPrerequisite')}
              hint={t('fieldPrerequisiteHint')}
            >
              <select
                id={`${id}-prereq`}
                className={selectClass}
                value={prereq}
                onChange={(e) => setPrereq(e.target.value)}
              >
                <option value="">{t('noSkill')}</option>
                {existingSkills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {message ? (
              <span
                role={message.kind === 'err' ? 'alert' : 'status'}
                className={
                  message.kind === 'err' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'
                }
              >
                {message.text}
              </span>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? tc('loading') : t('createSkill')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
