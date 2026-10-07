/**
 * In-Memory Result Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the ResultRepository interface with simple Map-based stores.
 * Every map is keyed by `${tenantId}:${examinationId}` so cross-tenant reads
 * return empty results (PRC-L469), mirroring RLS on the Prisma repository.
 */
import { BusinessRuleError, ConflictError } from '@proctira/common';

import type {
  ResultRepository,
  ExaminationCandidate,
  PublicationResult,
  AcademicRecordUpdate,
  ResultAnalysis,
} from './result-repository.js';
import {
  MARKS_LOCKED_MESSAGE,
  fingerprintCandidates,
  mergeSubjectResults,
} from './result-repository.js';

function key(tenantId: string, examinationId: string): string {
  return `${tenantId}:${examinationId}`;
}
export class InMemoryResultRepository implements ResultRepository {
  private candidates: Map<string, ExaminationCandidate[]> = new Map();
  private publicationResults: Map<string, PublicationResult> = new Map();
  private academicRecords: Array<AcademicRecordUpdate & { tenantId: string }> = [];
  private resultAnalyses: Map<string, ResultAnalysis> = new Map();

  /** Test helper: seed candidates for an examination */
  seedCandidates(
    examinationId: string,
    candidates: ExaminationCandidate[],
    tenantId: string,
  ): void {
    this.candidates.set(key(tenantId, examinationId), candidates);
  }

  /** Test helper: get all academic record updates */
  getAcademicRecordUpdates(): AcademicRecordUpdate[] {
    return this.academicRecords.map(({ tenantId: _tenantId, ...update }) => update);
  }

  async getCandidates(examinationId: string, tenantId: string): Promise<ExaminationCandidate[]> {
    return this.candidates.get(key(tenantId, examinationId)) ?? [];
  }

  async upsertCandidates(tenantId: string, candidates: ExaminationCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      const k = key(tenantId, candidate.examinationId);
      const list = this.candidates.get(k) ?? [];
      const idx = list.findIndex((c) => c.studentId === candidate.studentId);
      if (idx >= 0) list[idx] = candidate;
      else list.push(candidate);
      this.candidates.set(k, list);
    }
  }

  async deleteCandidates(
    tenantId: string,
    examinationId: string,
    studentIds: string[],
  ): Promise<void> {
    const k = key(tenantId, examinationId);
    const list = this.candidates.get(k);
    if (!list) return;
    const remove = new Set(studentIds);
    this.candidates.set(
      k,
      list.filter((c) => !remove.has(c.studentId)),
    );
  }

  async mergeCandidateMarks(
    tenantId: string,
    examinationId: string,
    candidates: ExaminationCandidate[],
  ): Promise<void> {
    // Synchronous check + merge: atomic within the JS thread (PRC-M239).
    const k = key(tenantId, examinationId);
    if (this.publicationResults.has(k)) throw new BusinessRuleError(MARKS_LOCKED_MESSAGE);
    const list = this.candidates.get(k) ?? [];
    for (const candidate of candidates) {
      const idx = list.findIndex((c) => c.studentId === candidate.studentId);
      const current = idx >= 0 ? list[idx] : undefined;
      const id = current?.id ?? candidate.id;
      const merged: ExaminationCandidate = {
        ...candidate,
        id,
        subjectResults: mergeSubjectResults(
          current?.subjectResults ?? [],
          candidate.subjectResults,
          id,
        ),
      };
      if (idx >= 0) list[idx] = merged;
      else list.push(merged);
    }
    this.candidates.set(k, list);
  }

  async savePublicationResult(
    result: PublicationResult,
    options: { candidatesFingerprint?: string } = {},
  ): Promise<void> {
    if (options.candidatesFingerprint !== undefined) {
      const current = this.candidates.get(key(result.tenantId, result.examinationId)) ?? [];
      if (fingerprintCandidates(current) !== options.candidatesFingerprint) {
        throw new ConflictError('Marks changed while results were being published; retry');
      }
    }
    this.publicationResults.set(key(result.tenantId, result.examinationId), result);
  }

  async getPublicationResult(
    examinationId: string,
    tenantId: string,
  ): Promise<PublicationResult | null> {
    return this.publicationResults.get(key(tenantId, examinationId)) ?? null;
  }

  async updateAcademicRecords(tenantId: string, updates: AcademicRecordUpdate[]): Promise<void> {
    // PRC-H055: upsert on (tenant, examination, student, subject) so a
    // re-publish replaces rather than appends — mirrors the pg ON CONFLICT and
    // the db/sql/124 unique index.
    for (const u of updates) {
      const idx = this.academicRecords.findIndex(
        (r) =>
          r.tenantId === tenantId &&
          r.examinationId === u.examinationId &&
          r.studentId === u.studentId &&
          r.subjectId === u.subjectId,
      );
      if (idx >= 0) {
        this.academicRecords[idx] = { ...u, tenantId };
      } else {
        this.academicRecords.push({ ...u, tenantId });
      }
    }
  }

  async saveResultAnalysis(analysis: ResultAnalysis): Promise<void> {
    this.resultAnalyses.set(key(analysis.tenantId, analysis.examinationId), analysis);
  }

  async getResultAnalysis(examinationId: string, tenantId: string): Promise<ResultAnalysis | null> {
    return this.resultAnalyses.get(key(tenantId, examinationId)) ?? null;
  }

  /** Test helper: clear all data */
  clear(): void {
    this.candidates.clear();
    this.publicationResults.clear();
    this.academicRecords = [];
    this.resultAnalyses.clear();
  }
}
