import { createHash, randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import { computeGpaSnapshot, type CourseGradeInput, type GpaPolicy } from './gpa-engine.js';
import { GradeLockedError } from './gradebook-errors.js';
import type {
  CreditRuleEntity,
  ExportJobEntity,
  GpaSnapshotEntity,
  GradeEntryEntity,
  GradebookRepository,
  ListGradeEntriesFilter,
  ListSectionsFilter,
  ListTranscriptsFilter,
  TranscriptIssuanceEntity,
} from './gradebook-repository.js';
import type {
  ComputeGpaInput,
  CreateCreditRuleInput,
  CreateReportCardJobInput,
  IssueTranscriptInput,
  UpsertGradeEntryInput,
} from './schemas.js';

function nowIso(): string {
  return new Date().toISOString();
}

function actorId(requestUser?: { id?: string; sub?: string }): string | null {
  return requestUser?.id ?? requestUser?.sub ?? null;
}

export class GradebookService {
  constructor(private readonly repo: GradebookRepository) {}

  listSections(tenantId: string, filter?: ListSectionsFilter) {
    return this.repo.listSections(tenantId, filter);
  }

  listGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter) {
    return this.repo.listGradeEntries(tenantId, filter);
  }

  listCreditRules(tenantId: string, boardId?: string) {
    return this.repo.listCreditRules(tenantId, boardId);
  }

  listGradingScales(tenantId: string, boardId?: string) {
    return this.repo.listGradingScales(tenantId, boardId);
  }

  listGpaSnapshots(tenantId: string, studentId: string) {
    return this.repo.listGpaSnapshots(tenantId, studentId);
  }

  listTranscripts(tenantId: string, filter?: ListTranscriptsFilter) {
    return this.repo.listTranscripts(tenantId, filter);
  }

  listReportCardJobs(tenantId: string) {
    return this.repo.listExportJobs(tenantId, 'REPORT_CARD');
  }

  getReportCardJob(tenantId: string, id: string) {
    return this.repo.getExportJob(tenantId, id);
  }

  getTranscript(tenantId: string, id: string) {
    return this.repo.getTranscript(tenantId, id);
  }

  async createCreditRule(tenantId: string, input: CreateCreditRuleInput) {
    const existing = await this.repo.getCreditRuleByCode(tenantId, input.code);
    if (existing) {
      throw new ValidationError(`Credit rule code ${input.code} already exists`);
    }
    const now = nowIso();
    const row: CreditRuleEntity = {
      id: randomUUID(),
      tenantId,
      boardId: input.boardId ?? null,
      code: input.code,
      name: input.name,
      credits: input.credits,
      metadata: (input.metadata as Record<string, unknown>) ?? {},
      createdAt: now,
      updatedAt: now,
    };
    return this.repo.createCreditRule(row);
  }

  async upsertGradeEntry(
    tenantId: string,
    input: UpsertGradeEntryInput,
    user?: { id?: string; sub?: string },
  ): Promise<GradeEntryEntity> {
    if (input.numericScore == null && !input.letterGrade) {
      throw new ValidationError('numericScore or letterGrade is required');
    }
    if (input.sectionId) {
      const section = await this.repo.getSection(tenantId, input.sectionId);
      if (!section) {
        throw new NotFoundError(`Section ${input.sectionId} not found`);
      }
    }

    const existing = await this.repo.findGradeEntry(tenantId, {
      studentId: input.studentId,
      sectionId: input.sectionId ?? null,
      assessmentCode: input.assessmentCode ?? null,
    });

    if (existing?.lockedAt) {
      throw new GradeLockedError(`Grade entry ${existing.id} is locked`);
    }

    const now = nowIso();
    const metadata = {
      ...(existing?.metadata ?? {}),
      ...((input.metadata as Record<string, unknown>) ?? {}),
      ...(input.creditRuleCode ? { creditRuleCode: input.creditRuleCode } : {}),
    };

    if (existing) {
      const updated = await this.repo.updateGradeEntry(tenantId, existing.id, {
        numericScore: input.numericScore ?? null,
        letterGrade: input.letterGrade ?? null,
        sectionId: input.sectionId ?? existing.sectionId,
        assessmentCode: input.assessmentCode ?? existing.assessmentCode,
        enteredBy: actorId(user),
        enteredAt: now,
        metadata,
        updatedAt: now,
      });
      if (!updated) throw new NotFoundError(`Grade entry ${existing.id} not found`);
      return updated;
    }

    return this.repo.createGradeEntry({
      id: randomUUID(),
      tenantId,
      sectionId: input.sectionId ?? null,
      studentId: input.studentId,
      assessmentCode: input.assessmentCode ?? null,
      numericScore: input.numericScore ?? null,
      letterGrade: input.letterGrade ?? null,
      enteredBy: actorId(user),
      enteredAt: now,
      lockedAt: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
  }

  async computeGpa(
    tenantId: string,
    input: ComputeGpaInput,
  ): Promise<{ snapshot: GpaSnapshotEntity; detail: ReturnType<typeof computeGpaSnapshot> }> {
    const entries = await this.repo.listGradeEntries(tenantId, {
      studentId: input.studentId,
    });
    if (entries.length === 0) {
      throw new ValidationError('No grade entries for student; enter grades before computing GPA');
    }

    let scale = input.gradingScaleId
      ? await this.repo.getGradingScale(tenantId, input.gradingScaleId)
      : null;
    if (!scale && input.boardId) {
      scale = await this.repo.getDefaultGradingScale(tenantId, input.boardId);
    }
    if (!scale) {
      const scales = await this.repo.listGradingScales(tenantId);
      scale = scales.find((s) => s.isDefault) ?? scales[0] ?? null;
    }
    if (!scale || scale.bands.length === 0) {
      throw new ValidationError(
        'No grading scale bands available; seed board scales (003_sis_timetable_board_scales.sql)',
      );
    }

    const creditRules = await this.repo.listCreditRules(tenantId, input.boardId ?? undefined);
    const defaultCredits = 1;

    const courses: CourseGradeInput[] = [];
    for (const entry of entries) {
      const ruleCode =
        typeof entry.metadata.creditRuleCode === 'string'
          ? entry.metadata.creditRuleCode
          : entry.assessmentCode;
      const rule = ruleCode
        ? creditRules.find((r) => r.code === ruleCode) ??
          (await this.repo.getCreditRuleByCode(tenantId, ruleCode))
        : null;
      courses.push({
        courseCode: entry.assessmentCode ?? entry.id.slice(0, 8),
        numericScore: entry.numericScore,
        letterGrade: entry.letterGrade,
        credits: rule?.credits ?? defaultCredits,
        includeInGpa: entry.metadata.includeInGpa !== false,
      });
    }

    const policy: GpaPolicy = {
      passingPercent: input.passingPercent ?? 33,
      weightMode: input.weightMode ?? 'CREDITS',
      maxGradePoints: 10,
      roundTo: 3,
    };
    const detail = computeGpaSnapshot(courses, scale.bands, policy);
    const now = nowIso();
    const snapshot = await this.repo.createGpaSnapshot({
      id: randomUUID(),
      tenantId,
      studentId: input.studentId,
      academicPeriodId: input.academicPeriodId ?? null,
      weightedGpa: detail.weightedGpa,
      unweightedGpa: detail.unweightedGpa,
      creditsEarned: detail.creditsEarned,
      computedAt: now,
      metadata: {
        gradingScaleId: scale.id,
        gradingScaleCode: scale.code,
        boardId: input.boardId ?? scale.boardId,
        policy,
        courses: detail.courses,
      },
      createdAt: now,
    });
    return { snapshot, detail };
  }

  async createReportCardJob(
    tenantId: string,
    input: CreateReportCardJobInput,
    user?: { id?: string; sub?: string },
  ): Promise<ExportJobEntity> {
    const now = nowIso();
    let job = await this.repo.createExportJob({
      id: randomUUID(),
      tenantId,
      boardId: input.boardId,
      institutionId: input.institutionId ?? null,
      jobType: 'REPORT_CARD',
      status: 'QUEUED',
      requestedBy: actorId(user),
      startedAt: null,
      finishedAt: null,
      artifactUri: null,
      errorMessage: null,
      metadata: {
        studentId: input.studentId,
        academicPeriodId: input.academicPeriodId ?? null,
        ...((input.metadata as Record<string, unknown>) ?? {}),
      },
      createdAt: now,
      updatedAt: now,
    });

    // Synchronously materialize HTML artifact metadata (job status pipeline).
    const started = nowIso();
    job =
      (await this.repo.updateExportJob(tenantId, job.id, {
        status: 'RUNNING',
        startedAt: started,
        updatedAt: started,
      })) ?? job;

    try {
      const entries = await this.repo.listGradeEntries(tenantId, {
        studentId: input.studentId,
      });
      const snapshots = await this.repo.listGpaSnapshots(tenantId, input.studentId);
      const latest = snapshots[0] ?? null;
      const html = [
        '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Report Card</title></head><body>',
        `<h1>Report Card</h1>`,
        `<p>Student: ${input.studentId}</p>`,
        `<p>Period: ${input.academicPeriodId ?? 'n/a'}</p>`,
        `<p>Weighted GPA: ${latest?.weightedGpa ?? 'n/a'}</p>`,
        `<p>Unweighted GPA: ${latest?.unweightedGpa ?? 'n/a'}</p>`,
        `<ul>${entries
          .map(
            (e) =>
              `<li>${e.assessmentCode ?? 'course'}: ${e.numericScore ?? e.letterGrade ?? '—'}</li>`,
          )
          .join('')}</ul>`,
        `</body></html>`,
      ].join('');
      const checksum = createHash('sha256').update(html).digest('hex');
      const artifactUri = `memory://report-cards/${job.id}.html`;
      const finished = nowIso();
      job =
        (await this.repo.updateExportJob(tenantId, job.id, {
          status: 'SUCCEEDED',
          finishedAt: finished,
          artifactUri,
          metadata: {
            ...job.metadata,
            checksumSha256: checksum,
            htmlLength: html.length,
            gradeCount: entries.length,
            gpaSnapshotId: latest?.id ?? null,
          },
          updatedAt: finished,
        })) ?? job;
      return job;
    } catch (error) {
      const finished = nowIso();
      const message = error instanceof Error ? error.message : 'Report card failed';
      job =
        (await this.repo.updateExportJob(tenantId, job.id, {
          status: 'FAILED',
          finishedAt: finished,
          errorMessage: message,
          updatedAt: finished,
        })) ?? job;
      return job;
    }
  }

  async issueTranscript(
    tenantId: string,
    input: IssueTranscriptInput,
    user?: { id?: string; sub?: string },
  ): Promise<TranscriptIssuanceEntity> {
    const snapshots = await this.repo.listGpaSnapshots(tenantId, input.studentId);
    const snapshot = input.gpaSnapshotId
      ? await this.repo.getGpaSnapshot(tenantId, input.gpaSnapshotId)
      : snapshots[0] ?? null;
    if (input.gpaSnapshotId && !snapshot) {
      throw new NotFoundError(`GPA snapshot ${input.gpaSnapshotId} not found`);
    }

    const nextVersion = (await this.repo.getLatestTranscriptVersion(tenantId, input.studentId)) + 1;
    const now = nowIso();
    const payload = {
      studentId: input.studentId,
      version: nextVersion,
      issuedAt: now,
      gpaSnapshotId: snapshot?.id ?? null,
      weightedGpa: snapshot?.weightedGpa ?? null,
      unweightedGpa: snapshot?.unweightedGpa ?? null,
      creditsEarned: snapshot?.creditsEarned ?? null,
      ...((input.metadata as Record<string, unknown>) ?? {}),
    };
    const body = JSON.stringify(payload);
    const checksum = createHash('sha256').update(body).digest('hex');
    const artifactUri = `memory://transcripts/${input.studentId}/v${nextVersion}.json`;

    return this.repo.createTranscript({
      id: randomUUID(),
      tenantId,
      studentId: input.studentId,
      version: nextVersion,
      status: 'ISSUED',
      issuedAt: now,
      issuedBy: actorId(user),
      artifactUri,
      checksumSha256: checksum,
      metadata: {
        ...payload,
        immutable: true,
      },
      createdAt: now,
      updatedAt: now,
    });
  }
}
