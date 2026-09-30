/**
 * In-Memory Result Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the ResultRepository interface with simple Map-based stores.
 * Every map is keyed by `${tenantId}:${examinationId}` so cross-tenant reads
 * return empty results (PRC-L469), mirroring RLS on the Prisma repository.
 */
import type {
  ResultRepository,
  ExaminationCandidate,
  PublicationResult,
  AcademicRecordUpdate,
  ResultAnalysis,
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

  async savePublicationResult(result: PublicationResult): Promise<void> {
    this.publicationResults.set(key(result.tenantId, result.examinationId), result);
  }

  async getPublicationResult(
    examinationId: string,
    tenantId: string,
  ): Promise<PublicationResult | null> {
    return this.publicationResults.get(key(tenantId, examinationId)) ?? null;
  }

  async updateAcademicRecords(tenantId: string, updates: AcademicRecordUpdate[]): Promise<void> {
    this.academicRecords.push(...updates.map((u) => ({ ...u, tenantId })));
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
