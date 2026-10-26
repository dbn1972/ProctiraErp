/**
 * PRC-L164 — survey answer validation: `validation.pattern` is enforced (ReDoS-guarded),
 * minLength/maxLength 0 are honoured, and table/repeater cell values are validated.
 */
import { ValidationError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryDistributionRepository,
  InMemoryInstitutionLookup,
  InMemorySubmissionRepository,
  InMemorySurveyRepository,
} from './in-memory-repository.js';
import type { QuestionInput } from './schemas.js';
import { SurveyService } from './survey-service.js';

const tenantId = 'tenant-l164';

describe('survey answer validation (PRC-L164)', () => {
  let service: SurveyService;
  let institutionLookup: InMemoryInstitutionLookup;

  beforeEach(() => {
    institutionLookup = new InMemoryInstitutionLookup();
    institutionLookup.addInstitution({
      id: 'inst-1',
      tenantId,
      areaId: 'a1',
      areaName: 'A',
      typeId: 't1',
      typeName: 'T',
      classificationId: 'c1',
      name: 'S1',
    });
    service = new SurveyService(
      new InMemorySurveyRepository(),
      new InMemoryDistributionRepository(),
      new InMemorySubmissionRepository(),
      institutionLookup,
    );
  });

  async function publish(question: QuestionInput) {
    const survey = await service.createSurvey(tenantId, {
      name: `L164 ${question.label}`,
      questions: [question],
    });
    await service.updateSurvey(tenantId, survey.id, { status: 'published' });
    await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });
    return survey;
  }

  /** Submit one answer; returns the field errors (empty array when accepted). */
  async function submit(survey: Awaited<ReturnType<typeof publish>>, value: unknown) {
    try {
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-1',
        answers: [{ questionId: survey.questions[0]!.id, value }],
      });
      return [];
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return (error.toJSON() as { errors?: Array<{ field: string; rule: string }> }).errors ?? [];
      }
      throw error;
    }
  }

  it('enforces validation.pattern on text answers', async () => {
    const survey = await publish({
      label: 'Code',
      type: 'text',
      order: 0,
      validation: { pattern: '^[A-Z]{3}$' },
    });
    expect((await submit(survey, 'ab1')).map((e) => e.rule)).toEqual(['pattern']);
    expect(await submit(survey, 'ABC')).toEqual([]);
  });

  it('rejects an unsafe or invalid pattern when the survey is defined', async () => {
    for (const pattern of ['(a+)+$', '([a-z]']) {
      await expect(
        service.createSurvey(tenantId, {
          name: `bad ${pattern}`,
          questions: [{ label: 'Q', type: 'text', order: 0, validation: { pattern } }],
        }),
      ).rejects.toThrow(ValidationError);
    }
  });

  it('honours maxLength 0', async () => {
    const zeroMax = await publish({
      label: 'Empty',
      type: 'text',
      order: 0,
      validation: { maxLength: 0 },
    });
    expect((await submit(zeroMax, 'x')).map((e) => e.rule)).toEqual(['maxLength']);
  });

  it('validates table rows against their columns', async () => {
    const survey = await publish({
      label: 'Grades',
      type: 'table',
      order: 0,
      columns: [
        { name: 'grade', type: 'number', required: true },
        {
          name: 'section',
          type: 'dropdown',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
        { name: 'opened', type: 'date' },
        { name: 'note', type: 'text' },
      ],
    });
    const errors = await submit(survey, [
      { grade: 'five' },
      { section: 'z' },
      'not-a-row',
      { grade: 1, opened: 'not-a-date', note: 7 },
    ]);
    expect(errors.map((e) => [e.field, e.rule])).toEqual([
      [`answers.${survey.questions[0]!.id}[0].grade`, 'type'],
      [`answers.${survey.questions[0]!.id}[1].grade`, 'required'],
      [`answers.${survey.questions[0]!.id}[1].section`, 'enum'],
      [`answers.${survey.questions[0]!.id}[2]`, 'type'],
      [`answers.${survey.questions[0]!.id}[3].opened`, 'type'],
      [`answers.${survey.questions[0]!.id}[3].note`, 'type'],
    ]);
    expect(
      await submit(survey, [
        { grade: 5, section: 'a', opened: '2026-01-01', note: 'ok' },
        { grade: 6 },
      ]),
    ).toEqual([]);
  });

  it('validates repeater entries against their fields (keyed by field label)', async () => {
    const survey = await publish({
      label: 'Staff',
      type: 'repeater',
      order: 0,
      repeaterFields: [
        { label: 'Teacher', type: 'text', required: true },
        {
          label: 'Subject',
          type: 'dropdown',
          options: [
            { label: 'Maths', value: 'math' },
            { label: 'Science', value: 'sci' },
          ],
        },
      ],
    });
    const errors = await submit(survey, [{ Teacher: 'T1', Subject: 'art' }, { Subject: 'math' }]);
    expect(errors.map((e) => [e.field, e.rule])).toEqual([
      [`answers.${survey.questions[0]!.id}[0].Subject`, 'enum'],
      [`answers.${survey.questions[0]!.id}[1].Teacher`, 'required'],
    ]);
    expect(await submit(survey, [{ Teacher: 'T1', Subject: 'sci' }])).toEqual([]);
  });
});
