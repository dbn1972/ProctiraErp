import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';

import { writeBoardExportArtifacts } from './board-export-generator.js';
import {
  assertBoardExportCompleteness,
  validateBoardExportCompleteness,
} from './board-export-validation.js';
import { getBoardPack, listBoardPacks, type BoardPackCode } from './board-pack-registry.js';
import {
  InMemoryGradebookExtrasStore,
  type CommentsBankRecord,
  type GradebookExtrasStore,
} from './extras-store.js';
import {
  computeClassRanks,
  computeGpaSnapshot,
  type CourseGradeInput,
  type GpaPolicy,
} from './gpa-engine.js';
import {
  isGradePublished,
  readGradeWorkflowStatus,
  transitionGradeWorkflow,
  type GradeWorkflowAction,
} from './grade-workflow.js';
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
  CreateBoardExportJobInput,
  CreateCreditRuleInput,
  CreateReportCardJobInput,
  ComputeClassRankInput,
  IssueTranscriptInput,
  UpsertCommentsBankInput,
  UpsertGradeEntryInput,
} from './schemas.js';
import {
  createBoardExportDownloadToken,
  signTranscriptChecksum,
  verifyBoardExportDownloadToken,
  type BoardExportSignedDownload,
} from './signed-download.js';
import { transcriptArtifactRoot, writeTranscriptPdfLite } from './transcript-artifact.js';

export interface GradebookAuditEntry {
  id: string;
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  at: string;
  details: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function actorId(requestUser?: { id?: string; sub?: string }): string | null {
  return requestUser?.id ?? requestUser?.sub ?? null;
}

const BOARD_EXPORT_JOB_TYPE = 'MARKSHEET_PACK';

export class GradebookService {
  private readonly auditLog: GradebookAuditEntry[] = [];
  private readonly extras: GradebookExtrasStore;

  constructor(
    private readonly repo: GradebookRepository,
    extras?: GradebookExtrasStore,
  ) {
    this.extras = extras ?? new InMemoryGradebookExtrasStore();
  }

  listAudits(tenantId: string): GradebookAuditEntry[] {
    return this.auditLog.filter((row) => row.tenantId === tenantId);
  }

  async listGradeChangeAudits(tenantId: string, gradeEntryId?: string) {
    return this.extras.listAudits(tenantId, gradeEntryId);
  }

  private recordAudit(entry: Omit<GradebookAuditEntry, 'id' | 'at'>): void {
    this.auditLog.push({
      id: randomUUID(),
      at: nowIso(),
      ...entry,
    });
  }

  private persistGradeChange(entry: {
    tenantId: string;
    gradeEntryId: string;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromNumericScore?: number | null;
    toNumericScore?: number | null;
    fromLetterGrade?: string | null;
    toLetterGrade?: string | null;
    actorId: string | null;
    details?: Record<string, unknown>;
  }): void {
    const row = {
      id: randomUUID(),
      tenantId: entry.tenantId,
      gradeEntryId: entry.gradeEntryId,
      action: entry.action,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      fromNumericScore: entry.fromNumericScore ?? null,
      toNumericScore: entry.toNumericScore ?? null,
      fromLetterGrade: entry.fromLetterGrade ?? null,
      toLetterGrade: entry.toLetterGrade ?? null,
      actorId: entry.actorId,
      details: entry.details ?? {},
      createdAt: nowIso(),
    };
    void this.extras.appendAudit(row).catch(() => {
      // In-memory listAudits remains the fallback when 032 is not applied.
    });
  }

  listSections(tenantId: string, filter?: ListSectionsFilter) {
    return this.repo.listSections(tenantId, filter);
  }

  listGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter) {
    return this.repo.listGradeEntries(tenantId, filter);
  }

  async listPublishedGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter) {
    const rows = await this.repo.listGradeEntries(tenantId, filter);
    return rows.filter((row) => isGradePublished(row.metadata, row.publishedAt));
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

  /**
   * Returns the issued transcript artifact (G-716). `pdf` is the default and
   * the canonical artifact; `html` and `json` remain for compatibility.
   */
  async downloadTranscript(
    tenantId: string,
    id: string,
    format: 'pdf' | 'html' | 'json' = 'pdf',
  ): Promise<{ filename: string; contentType: string; body: Buffer; checksumSha256: string }> {
    const row = await this.repo.getTranscript(tenantId, id);
    if (!row) throw new NotFoundError(`Transcript ${id} not found`);
    const meta = row.metadata ?? {};
    const pick = (key: string): string | null => (typeof meta[key] === 'string' ? meta[key] : null);
    const target =
      format === 'html'
        ? { path: pick('pdfLitePath'), ext: 'html', contentType: 'text/html; charset=utf-8' }
        : format === 'json'
          ? { path: pick('jsonPath'), ext: 'json', contentType: 'application/json; charset=utf-8' }
          : {
              path: pick('pdfPath') ?? row.artifactUri,
              ext: 'pdf',
              contentType: 'application/pdf',
            };
    if (!target.path) throw new NotFoundError(`Transcript ${format} artifact missing`);
    const root = transcriptArtifactRoot();
    if (!target.path.startsWith(root) && !target.path.startsWith('/tmp/')) {
      throw new BusinessRuleError('Artifact path rejected');
    }
    let body: Buffer;
    try {
      body = readFileSync(target.path);
    } catch {
      throw new NotFoundError(`Transcript ${format} artifact missing on disk`);
    }
    return {
      filename: `transcript-${row.studentId}-v${row.version}.${target.ext}`,
      contentType: target.contentType,
      body,
      checksumSha256: row.checksumSha256 ?? '',
    };
  }

  listBoardPackRegistry() {
    return listBoardPacks();
  }

  listBoards(tenantId: string) {
    return this.repo.listBoards(tenantId);
  }

  listInstitutionsByBoard(tenantId: string, boardId: string) {
    return this.repo.listInstitutionsByBoard(tenantId, boardId);
  }

  listBoardExportJobs(tenantId: string) {
    return this.repo.listExportJobs(tenantId, BOARD_EXPORT_JOB_TYPE);
  }

  getBoardExportJob(tenantId: string, id: string) {
    return this.repo.getExportJob(tenantId, id);
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
    if (existing) {
      const workflow = readGradeWorkflowStatus(
        existing.metadata,
        existing.lockedAt,
        existing.publishedAt,
      );
      if (
        workflow === 'SUBMITTED' ||
        workflow === 'APPROVED' ||
        workflow === 'LOCKED' ||
        workflow === 'PUBLISHED'
      ) {
        throw new BusinessRuleError(
          `Grade entry ${existing.id} is ${workflow}; reopen or wait for moderation before editing`,
        );
      }
    }

    const now = nowIso();
    const priorWorkflow = existing
      ? readGradeWorkflowStatus(existing.metadata, existing.lockedAt, existing.publishedAt)
      : 'DRAFT';
    const metadata: Record<string, unknown> = {
      ...(existing?.metadata ?? {}),
      ...((input.metadata as Record<string, unknown>) ?? {}),
      ...(input.creditRuleCode ? { creditRuleCode: input.creditRuleCode } : {}),
      ...(input.remark != null ? { remark: input.remark } : {}),
      ...(input.commentBankId != null ? { commentBankId: input.commentBankId } : {}),
      workflowStatus: priorWorkflow === 'REJECTED' || !existing ? 'DRAFT' : priorWorkflow,
      published: false,
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
      this.recordAudit({
        tenantId,
        action: 'grade.upsert',
        entityType: 'grade_entry',
        entityId: updated.id,
        actorId: actorId(user),
        details: { studentId: input.studentId, mode: 'update' },
      });
      this.persistGradeChange({
        tenantId,
        gradeEntryId: updated.id,
        action: 'grade.upsert',
        fromStatus: priorWorkflow,
        toStatus: String(metadata.workflowStatus),
        fromNumericScore: existing.numericScore,
        toNumericScore: updated.numericScore,
        fromLetterGrade: existing.letterGrade,
        toLetterGrade: updated.letterGrade,
        actorId: actorId(user),
        details: { mode: 'update' },
      });
      return updated;
    }

    const created = await this.repo.createGradeEntry({
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
      publishedAt: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'grade.upsert',
      entityType: 'grade_entry',
      entityId: created.id,
      actorId: actorId(user),
      details: { studentId: input.studentId, mode: 'create' },
    });
    this.persistGradeChange({
      tenantId,
      gradeEntryId: created.id,
      action: 'grade.upsert',
      fromStatus: null,
      toStatus: 'DRAFT',
      toNumericScore: created.numericScore,
      toLetterGrade: created.letterGrade,
      actorId: actorId(user),
      details: { mode: 'create' },
    });
    return created;
  }

  /**
   * G-303 — publish/moderation/lock transitions for a grade entry.
   */
  async transitionGradeEntry(
    tenantId: string,
    entryId: string,
    action: GradeWorkflowAction,
    user?: { id?: string; sub?: string },
  ): Promise<GradeEntryEntity> {
    const entry = await this.repo.getGradeEntry(tenantId, entryId);
    if (!entry) {
      throw new NotFoundError(`Grade entry ${entryId} not found`);
    }
    const current = readGradeWorkflowStatus(entry.metadata, entry.lockedAt, entry.publishedAt);
    const next = transitionGradeWorkflow(current, action);
    const now = nowIso();
    const published = next === 'PUBLISHED';
    const metadata = {
      ...entry.metadata,
      workflowStatus: next,
      lastWorkflowAction: action,
      lastWorkflowAt: now,
      lastWorkflowBy: actorId(user),
      published,
    };
    const lockedAt =
      next === 'LOCKED' || next === 'PUBLISHED'
        ? (entry.lockedAt ?? now)
        : action === 'reopen'
          ? null
          : entry.lockedAt;
    const publishedAt = published
      ? (entry.publishedAt ?? now)
      : action === 'reopen'
        ? null
        : entry.publishedAt;
    const updated = await this.repo.updateGradeEntry(tenantId, entryId, {
      metadata,
      lockedAt,
      publishedAt,
      updatedAt: now,
    });
    if (!updated) throw new NotFoundError(`Grade entry ${entryId} not found`);
    this.recordAudit({
      tenantId,
      action: `grade.${action}`,
      entityType: 'grade_entry',
      entityId: entryId,
      actorId: actorId(user),
      details: { from: current, to: next },
    });
    this.persistGradeChange({
      tenantId,
      gradeEntryId: entryId,
      action: `grade.${action}`,
      fromStatus: current,
      toStatus: next,
      fromNumericScore: entry.numericScore,
      toNumericScore: entry.numericScore,
      fromLetterGrade: entry.letterGrade,
      toLetterGrade: entry.letterGrade,
      actorId: actorId(user),
      details: { from: current, to: next },
    });
    return updated;
  }

  async bulkTransitionGradeEntries(
    tenantId: string,
    ids: string[],
    action: GradeWorkflowAction,
    user?: { id?: string; sub?: string },
  ): Promise<GradeEntryEntity[]> {
    const out: GradeEntryEntity[] = [];
    for (const id of ids) {
      out.push(await this.transitionGradeEntry(tenantId, id, action, user));
    }
    return out;
  }

  async listCommentsBank(
    tenantId: string,
    filter?: { subjectId?: string; gradeBand?: string; institutionId?: string },
  ) {
    return this.extras.listComments(tenantId, filter);
  }

  async createCommentsBank(
    tenantId: string,
    input: UpsertCommentsBankInput,
  ): Promise<CommentsBankRecord> {
    const now = nowIso();
    return this.extras.createComment({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId ?? null,
      subjectId: input.subjectId ?? null,
      gradeBand: input.gradeBand ?? null,
      label: input.label,
      body: input.body,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateCommentsBank(
    tenantId: string,
    id: string,
    input: UpsertCommentsBankInput,
  ): Promise<CommentsBankRecord> {
    const updated = await this.extras.updateComment(tenantId, id, {
      institutionId: input.institutionId ?? null,
      subjectId: input.subjectId ?? null,
      gradeBand: input.gradeBand ?? null,
      label: input.label,
      body: input.body,
      updatedAt: nowIso(),
    });
    if (!updated) throw new NotFoundError(`Comments bank item ${id} not found`);
    return updated;
  }

  async deleteCommentsBank(tenantId: string, id: string): Promise<void> {
    const ok = await this.extras.deleteComment(tenantId, id);
    if (!ok) throw new NotFoundError(`Comments bank item ${id} not found`);
  }

  async computeClassRank(tenantId: string, input: ComputeClassRankInput) {
    const entries = await this.repo.listGradeEntries(tenantId, { sectionId: input.sectionId });
    if (entries.length === 0) {
      throw new ValidationError('No grade entries in section; enter grades before ranking');
    }
    const studentIds = [...new Set(entries.map((e) => e.studentId))];
    const rankInputs = [];
    for (const studentId of studentIds) {
      const { snapshot: term } = await this.computeGpa(tenantId, {
        studentId,
        academicPeriodId: input.academicPeriodId ?? null,
        boardId: input.boardId ?? null,
      });
      const { snapshot: cumulative } = await this.computeGpa(tenantId, {
        studentId,
        boardId: input.boardId ?? null,
      });
      rankInputs.push({
        studentId,
        weightedGpa: term.weightedGpa,
        unweightedGpa: term.unweightedGpa,
        cgpa: cumulative.weightedGpa,
        creditsEarned: cumulative.creditsEarned,
      });
    }
    const ranked = computeClassRanks(rankInputs);
    const now = nowIso();
    const batchId = randomUUID();
    const persist = input.persist !== false;
    if (persist) {
      await this.extras.saveRankBatch(
        ranked.map((row) => ({
          id: randomUUID(),
          tenantId,
          sectionId: input.sectionId,
          academicPeriodId: input.academicPeriodId ?? null,
          batchId,
          studentId: row.studentId,
          classRank: row.classRank,
          tieCount: row.tieCount,
          weightedGpa: row.weightedGpa,
          unweightedGpa: row.unweightedGpa ?? null,
          cgpa: row.cgpa,
          creditsEarned: row.creditsEarned ?? null,
          computedAt: now,
          metadata: { batchId },
        })),
      );
    }
    return { batchId, computedAt: now, ranks: ranked };
  }

  listClassRanks(tenantId: string, sectionId: string) {
    return this.extras.listLatestRanks(tenantId, sectionId);
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
        ? (creditRules.find((r) => r.code === ruleCode) ??
          (await this.repo.getCreditRuleByCode(tenantId, ruleCode)))
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
      : (snapshots[0] ?? null);
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
    const signature = signTranscriptChecksum(checksum, tenantId);
    const artifacts = writeTranscriptPdfLite({
      tenantId,
      studentId: input.studentId,
      version: nextVersion,
      issuedAt: now,
      weightedGpa: snapshot?.weightedGpa ?? null,
      unweightedGpa: snapshot?.unweightedGpa ?? null,
      creditsEarned: snapshot?.creditsEarned ?? null,
      checksumSha256: checksum,
      signature,
    });
    const artifactUri = artifacts.pdfPath;

    const row = await this.repo.createTranscript({
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
        pdfPath: artifacts.pdfPath,
        pdfLitePath: artifacts.pdfLitePath,
        jsonPath: artifacts.jsonPath,
        artifactKind: 'pdf',
        signatureAlg: 'HMAC-SHA256',
        signature,
        signedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'transcript.issue',
      entityType: 'transcript_issuance',
      entityId: row.id,
      actorId: actorId(user),
      details: { studentId: input.studentId, version: nextVersion, artifactUri, signature },
    });
    return row;
  }

  async createBoardExportJob(
    tenantId: string,
    input: CreateBoardExportJobInput,
    user?: { id?: string; sub?: string },
  ): Promise<ExportJobEntity> {
    if (!input.boardId && !input.boardCode) {
      throw new ValidationError('boardId or boardCode is required');
    }

    const institution = await this.repo.getInstitution(tenantId, input.institutionId);
    if (!institution) {
      throw new NotFoundError(`Institution ${input.institutionId} not found`);
    }

    let board = input.boardId ? await this.repo.getBoard(tenantId, input.boardId) : null;
    if (!board && input.boardCode) {
      board = await this.repo.getBoardByCode(tenantId, input.boardCode.toUpperCase());
    }
    if (!board) {
      throw new NotFoundError('Board not found for export pack');
    }
    if (institution.boardId !== board.id) {
      throw new BusinessRuleError(
        `Institution ${institution.code} is affiliated to a different board than ${board.code}`,
      );
    }

    const pack = getBoardPack(board.code);
    if (!pack) {
      throw new BusinessRuleError(
        `No compliance pack registered for board ${board.code}. Supported: CBSE, ICSE, MH-STATE`,
      );
    }

    const candidates = await this.repo.listBoardExportCandidates(tenantId, {
      institutionId: input.institutionId,
      boardId: board.id,
      studentIds: input.studentIds,
      limit: input.limit ?? (input.studentIds?.length ? input.studentIds.length : 100),
    });

    // Explicit studentIds → strict gate (any incomplete → 422).
    // Default cohort → export only complete candidates; 422 if none are ready.
    let exportCohort = candidates;
    if (!input.studentIds || input.studentIds.length === 0) {
      const complete = candidates.filter((c) => validateBoardExportCompleteness(pack, [c]).ok);
      if (complete.length === 0) {
        assertBoardExportCompleteness(pack, candidates);
      }
      exportCohort = complete;
    } else {
      assertBoardExportCompleteness(pack, candidates);
    }

    const boardCodes = await this.repo.listBoardCodes(tenantId, {
      institutionId: input.institutionId,
      boardId: board.id,
    });
    const affiliationCode =
      boardCodes.find((c) => c.codeType === 'AFFILIATION')?.codeValue ??
      `${board.code}-AFF-${institution.code}`;
    const centreCode =
      boardCodes.find((c) => c.codeType === 'CENTRE')?.codeValue ??
      `${board.code}-CTR-${institution.code}`;

    const now = nowIso();
    const job = await this.repo.createExportJob({
      id: randomUUID(),
      tenantId,
      boardId: board.id,
      institutionId: input.institutionId,
      jobType: BOARD_EXPORT_JOB_TYPE,
      status: 'QUEUED',
      requestedBy: actorId(user),
      startedAt: null,
      finishedAt: null,
      artifactUri: null,
      errorMessage: null,
      metadata: {
        boardCode: board.code as BoardPackCode,
        packVersion: pack.version,
        securityMark: pack.securityMark,
        studentIds: exportCohort.map((c) => c.studentId),
        asyncQueued: Boolean(input.async),
        prep: {
          institutionCode: institution.code,
          institutionName: institution.name,
          affiliationCode,
          centreCode,
          candidates: exportCohort,
        },
        ...((input.metadata as Record<string, unknown>) ?? {}),
      },
      createdAt: now,
      updatedAt: now,
    });

    this.recordAudit({
      tenantId,
      action: 'board_export.create',
      entityType: 'board_export_job',
      entityId: job.id,
      actorId: actorId(user),
      details: {
        boardCode: board.code,
        institutionId: input.institutionId,
        async: Boolean(input.async),
        candidateCount: exportCohort.length,
      },
    });

    // Async mode: leave QUEUED for a worker / follow-up process call.
    if (input.async) {
      return job;
    }
    return this.processBoardExportJob(tenantId, job.id);
  }

  /** Process a QUEUED board export (sync runner or deferred worker). */
  async processBoardExportJob(tenantId: string, jobId: string): Promise<ExportJobEntity> {
    const job = await this.repo.getExportJob(tenantId, jobId);
    if (!job) {
      throw new NotFoundError(`Board export job ${jobId} not found`);
    }
    if (job.jobType !== BOARD_EXPORT_JOB_TYPE) {
      throw new NotFoundError(`Job ${jobId} is not a board marksheet pack`);
    }
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
      return job;
    }

    const prep = job.metadata.prep as
      | {
          institutionCode: string;
          institutionName: string;
          affiliationCode: string;
          centreCode: string;
          candidates: Parameters<typeof writeBoardExportArtifacts>[0]['candidates'];
        }
      | undefined;
    if (!prep) {
      throw new BusinessRuleError('Board export job is missing prep metadata');
    }

    const packCode = String(job.metadata.boardCode ?? '');
    const pack = getBoardPack(packCode);
    if (!pack) {
      throw new BusinessRuleError(`No compliance pack for board ${packCode}`);
    }

    const started = nowIso();
    let running =
      (await this.repo.updateExportJob(tenantId, job.id, {
        status: 'RUNNING',
        startedAt: started,
        updatedAt: started,
      })) ?? job;

    try {
      const artifacts = writeBoardExportArtifacts({
        jobId: job.id,
        tenantId,
        boardId: job.boardId,
        institutionId: job.institutionId ?? '',
        institutionCode: prep.institutionCode,
        institutionName: prep.institutionName,
        affiliationCode: prep.affiliationCode,
        centreCode: prep.centreCode,
        pack,
        candidates: prep.candidates,
      });
      const finished = nowIso();
      const { prep: _drop, ...restMeta } = running.metadata;
      running =
        (await this.repo.updateExportJob(tenantId, job.id, {
          status: 'SUCCEEDED',
          finishedAt: finished,
          artifactUri: artifacts.packJsonPath,
          metadata: {
            ...restMeta,
            checksumSha256: artifacts.checksumSha256,
            artifactDir: artifacts.artifactDir,
            marksheetCsvPath: artifacts.marksheetCsvPath,
            examResultsJsonPath: artifacts.examResultsJsonPath,
            pdfLitePath: artifacts.pdfLitePath,
            candidateCount: artifacts.candidateCount,
            packVersion: pack.version,
            boardCode: pack.code,
            securityMark: pack.securityMark,
          },
          updatedAt: finished,
        })) ?? running;
      this.recordAudit({
        tenantId,
        action: 'board_export.succeeded',
        entityType: 'board_export_job',
        entityId: job.id,
        actorId: job.requestedBy,
        details: { checksumSha256: artifacts.checksumSha256 },
      });
      return running;
    } catch (error) {
      const finished = nowIso();
      const message = error instanceof Error ? error.message : 'Board export failed';
      await this.repo.updateExportJob(tenantId, job.id, {
        status: 'FAILED',
        finishedAt: finished,
        errorMessage: message,
        updatedAt: finished,
      });
      this.recordAudit({
        tenantId,
        action: 'board_export.failed',
        entityType: 'board_export_job',
        entityId: job.id,
        actorId: job.requestedBy,
        details: { error: message },
      });
      throw error;
    }
  }

  /** G-305 — short-lived signed download stub (tenant-bound HMAC). */
  issueBoardExportDownloadToken(
    tenantId: string,
    jobId: string,
    expiresInSeconds = 300,
  ): BoardExportSignedDownload {
    return createBoardExportDownloadToken(tenantId, jobId, expiresInSeconds);
  }

  async downloadBoardExport(
    tenantId: string,
    jobId: string,
    format: 'pack' | 'csv' | 'json' | 'html' = 'pack',
    opts?: { downloadToken?: string; actorId?: string | null },
  ): Promise<{
    job: ExportJobEntity;
    filename: string;
    contentType: string;
    body: Buffer;
  }> {
    // Tenant check: getExportJob filters by tenantId — cross-tenant → not found.
    const job = await this.repo.getExportJob(tenantId, jobId);
    if (!job) {
      throw new NotFoundError(`Board export job ${jobId} not found`);
    }
    if (job.jobType !== BOARD_EXPORT_JOB_TYPE) {
      throw new NotFoundError(`Job ${jobId} is not a board marksheet pack`);
    }
    if (opts?.downloadToken) {
      const verified = verifyBoardExportDownloadToken(tenantId, jobId, opts.downloadToken);
      if (!verified.ok) {
        throw new BusinessRuleError(`Signed download rejected: ${verified.reason}`);
      }
    }
    if (job.status !== 'SUCCEEDED') {
      throw new BusinessRuleError(
        `Export job is ${job.status}; download available only when SUCCEEDED`,
      );
    }

    const meta = job.metadata ?? {};
    const pathForFormat = (): { path: string; filename: string; contentType: string } => {
      if (format === 'csv') {
        const p = typeof meta.marksheetCsvPath === 'string' ? meta.marksheetCsvPath : null;
        if (!p) throw new NotFoundError('Marksheet CSV artifact missing');
        return {
          path: p,
          filename: `marksheet-${jobId}.csv`,
          contentType: 'text/csv; charset=utf-8',
        };
      }
      if (format === 'json') {
        const p = typeof meta.examResultsJsonPath === 'string' ? meta.examResultsJsonPath : null;
        if (!p) throw new NotFoundError('Exam results JSON artifact missing');
        return {
          path: p,
          filename: `exam-results-${jobId}.json`,
          contentType: 'application/json; charset=utf-8',
        };
      }
      if (format === 'html') {
        const p = typeof meta.pdfLitePath === 'string' ? meta.pdfLitePath : null;
        if (!p) throw new NotFoundError('PDF-lite HTML artifact missing');
        return {
          path: p,
          filename: `marksheet-${jobId}.html`,
          contentType: 'text/html; charset=utf-8',
        };
      }
      const p = job.artifactUri;
      if (!p) throw new NotFoundError('Pack artifact missing');
      return {
        path: p,
        filename: `board-pack-${jobId}.json`,
        contentType: 'application/json; charset=utf-8',
      };
    };

    const resolved = pathForFormat();
    if (!resolved.path.includes('sis-board-exports') && !resolved.path.startsWith('/tmp/')) {
      throw new BusinessRuleError('Artifact path rejected');
    }
    const body = readFileSync(resolved.path);
    this.recordAudit({
      tenantId,
      action: 'board_export.download',
      entityType: 'board_export_job',
      entityId: jobId,
      actorId: opts?.actorId ?? null,
      details: { format, viaToken: Boolean(opts?.downloadToken) },
    });
    return {
      job,
      filename: resolved.filename,
      contentType: resolved.contentType,
      body,
    };
  }
}
