/**
 * In-Memory Document Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the DocumentRepository interface with simple Map-based stores.
 */
import type { NewOutboxEntry, OutboxStore } from '@proctira/queue-abstraction';

import type {
  DocumentRepository,
  DocumentCandidate,
  SeatingAssignment,
  CandidateResultData,
  DocumentGenerationJob,
} from './document-repository.js';
import type { ExamOpsStore } from './ops-store.js';

export class InMemoryDocumentRepository implements DocumentRepository {
  private candidates: Map<string, DocumentCandidate[]> = new Map();
  private seatingAssignments: Map<string, SeatingAssignment[]> = new Map();
  private candidateResults: Map<string, CandidateResultData[]> = new Map();
  private jobs: Map<string, DocumentGenerationJob> = new Map();

  constructor(private readonly seatingStore?: ExamOpsStore) {}

  /** Test helper: seed candidates for an examination */
  seedCandidates(examinationId: string, candidates: DocumentCandidate[]): void {
    this.candidates.set(examinationId, candidates);
  }

  /** Test helper: seed seating assignments for an examination */
  seedSeatingAssignments(examinationId: string, assignments: SeatingAssignment[]): void {
    this.seatingAssignments.set(examinationId, assignments);
  }

  /** Test helper: seed candidate results for an examination */
  seedCandidateResults(examinationId: string, results: CandidateResultData[]): void {
    this.candidateResults.set(examinationId, results);
  }

  async getDocumentCandidates(
    examinationId: string,
    _tenantId: string,
    candidateIds?: string[],
  ): Promise<DocumentCandidate[]> {
    const all = this.candidates.get(examinationId) ?? [];
    if (candidateIds && candidateIds.length > 0) {
      return all.filter((c) => candidateIds.includes(c.id));
    }
    return all;
  }

  async getSeatingAssignments(
    examinationId: string,
    tenantId: string,
    centerId?: string,
  ): Promise<SeatingAssignment[]> {
    if (this.seatingStore) {
      const persisted = await this.seatingStore.listSeating(tenantId, examinationId);
      const mapped = persisted.map((row) => ({
        candidateId: row.candidateId,
        studentName: row.studentName,
        rollNumber: row.rollNumber,
        centerId: row.centerId,
        centerName: row.centerName,
        roomNumber: row.roomNumber,
        seatNumber: row.seatNumber,
        subjectNames: row.subjectNames,
      }));
      return centerId ? mapped.filter((a) => a.centerId === centerId) : mapped;
    }
    const all = this.seatingAssignments.get(examinationId) ?? [];
    if (centerId) {
      return all.filter((a) => a.centerId === centerId);
    }
    return all;
  }

  async getCandidateResults(
    examinationId: string,
    _tenantId: string,
    candidateIds?: string[],
  ): Promise<CandidateResultData[]> {
    const all = this.candidateResults.get(examinationId) ?? [];
    if (candidateIds && candidateIds.length > 0) {
      return all.filter((r) => candidateIds.includes(r.candidateId));
    }
    return all;
  }

  async createJob(job: DocumentGenerationJob): Promise<DocumentGenerationJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async createJobWithOutbox(
    job: DocumentGenerationJob,
    outboxEntry: NewOutboxEntry,
    outboxStore: OutboxStore,
  ): Promise<DocumentGenerationJob> {
    // Same unit of work: both succeed or neither is visible to callers.
    this.jobs.set(job.id, job);
    try {
      await outboxStore.enqueue(outboxEntry);
    } catch (err) {
      this.jobs.delete(job.id);
      throw err;
    }
    return job;
  }

  async updateJob(
    jobId: string,
    _tenantId: string,
    updates: Partial<DocumentGenerationJob>,
  ): Promise<DocumentGenerationJob | null> {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async getJob(jobId: string, _tenantId: string): Promise<DocumentGenerationJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listJobs(examinationId: string, _tenantId: string): Promise<DocumentGenerationJob[]> {
    return Array.from(this.jobs.values()).filter((job) => job.examinationId === examinationId);
  }

  /** Test helper: clear all data */
  clear(): void {
    this.candidates.clear();
    this.seatingAssignments.clear();
    this.candidateResults.clear();
    this.jobs.clear();
  }
}
