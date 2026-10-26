/**
 * PRC-L165 — submit and reminders are atomic: a concurrent double submit stores exactly one
 * submission, a failed submission store leaves the distribution open, and reminder counts are
 * stored before (and rolled back with) the reminder publish.
 */
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryDistributionRepository,
  InMemoryInstitutionLookup,
  InMemorySubmissionRepository,
  InMemorySurveyRepository,
} from './in-memory-repository.js';
import type { NotificationPublisher } from './survey-service.js';
import { SurveyService } from './survey-service.js';

const tenantId = 'tenant-l165';

describe('survey submit / reminder atomicity (PRC-L165)', () => {
  let distributionRepo: InMemoryDistributionRepository;
  let submissionRepo: InMemorySubmissionRepository;
  let institutionLookup: InMemoryInstitutionLookup;
  let publisher: NotificationPublisher & { calls: number; fail: boolean };
  let service: SurveyService;

  beforeEach(() => {
    distributionRepo = new InMemoryDistributionRepository();
    submissionRepo = new InMemorySubmissionRepository();
    institutionLookup = new InMemoryInstitutionLookup();
    for (const id of ['inst-1', 'inst-2', 'inst-3']) {
      institutionLookup.addInstitution({
        id,
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: id,
      });
    }
    publisher = {
      calls: 0,
      fail: false,
      async sendReminder() {
        publisher.calls += 1;
        if (publisher.fail) throw new Error('publisher down');
      },
    };
    service = new SurveyService(
      new InMemorySurveyRepository(),
      distributionRepo,
      submissionRepo,
      institutionLookup,
      publisher,
    );
  });

  async function publishedSurvey() {
    const survey = await service.createSurvey(tenantId, {
      name: 'Atomic',
      questions: [{ label: 'Q1', type: 'text', order: 0 }],
    });
    await service.updateSurvey(tenantId, survey.id, { status: 'published' });
    await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });
    return survey;
  }

  const submitInput = (surveyId: string, questionId: string) => ({
    surveyId,
    institutionId: 'inst-1',
    answers: [{ questionId, value: 'answer' }],
  });

  it('concurrent submits for one institution store exactly one submission', async () => {
    const survey = await publishedSurvey();
    const input = submitInput(survey.id, survey.questions[0]!.id);
    const results = await Promise.allSettled([
      service.submitSurvey(tenantId, input),
      service.submitSurvey(tenantId, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
    expect(await submissionRepo.findBySurvey(tenantId, survey.id)).toHaveLength(1);
  });

  it('a failed submission store leaves the distribution open for a retry', async () => {
    const survey = await publishedSurvey();
    const input = submitInput(survey.id, survey.questions[0]!.id);
    const original = submissionRepo.create.bind(submissionRepo);
    submissionRepo.create = async () => {
      throw new Error('store down');
    };
    await expect(service.submitSurvey(tenantId, input)).rejects.toThrow('store down');
    const record = await distributionRepo.findBySurveyAndInstitution(tenantId, survey.id, 'inst-1');
    expect(record?.status).not.toBe('completed');
    expect(record?.submittedAt).toBeNull();

    submissionRepo.create = original;
    await expect(service.submitSurvey(tenantId, input)).resolves.toMatchObject({
      institutionId: 'inst-1',
    });
  });

  it('a reminder count failure sends no reminder and leaves counts unchanged', async () => {
    const survey = await publishedSurvey();
    const original = distributionRepo.update.bind(distributionRepo);
    let updates = 0;
    distributionRepo.update = async (id, t, data) => {
      updates += 1;
      if (updates === 2) throw new Error('update failed');
      return original(id, t, data);
    };
    await expect(service.sendReminders(tenantId, survey.id)).rejects.toThrow('update failed');
    distributionRepo.update = original;

    expect(publisher.calls).toBe(0);
    const records = await distributionRepo.findBySurvey(tenantId, survey.id);
    expect(records.map((r) => r.remindersSent)).toEqual([0, 0, 0]);
  });

  it('a publisher failure restores the reminder counts', async () => {
    const survey = await publishedSurvey();
    publisher.fail = true;
    await expect(service.sendReminders(tenantId, survey.id)).rejects.toThrow('publisher down');
    const records = await distributionRepo.findBySurvey(tenantId, survey.id);
    expect(records.map((r) => r.remindersSent)).toEqual([0, 0, 0]);

    publisher.fail = false;
    await expect(service.sendReminders(tenantId, survey.id)).resolves.toEqual({
      remindersSent: 3,
    });
    const after = await distributionRepo.findBySurvey(tenantId, survey.id);
    expect(after.map((r) => r.remindersSent)).toEqual([1, 1, 1]);
  });
});
