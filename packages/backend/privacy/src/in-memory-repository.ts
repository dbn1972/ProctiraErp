import {
  CORRECTION_VALUE_REDACTED,
  NON_TERMINAL_ANONYMIZATION_JOB_STATUSES,
} from './privacy-repository.js';
import type {
  AnonymizationJobEntity,
  CorrectionRequestEntity,
  ErasureRequestEntity,
  LegalHoldEntity,
  ListPage,
  PrivacyRepository,
  ReleaseStalledErasureResult,
  TenantOffboardJobEntity,
  StuckPrivacyJobRef,
} from './privacy-repository.js';

export class InMemoryPrivacyRepository implements PrivacyRepository {
  private holds: LegalHoldEntity[] = [];
  private erasures: ErasureRequestEntity[] = [];
  private corrections: CorrectionRequestEntity[] = [];
  private anonymizationJobs: AnonymizationJobEntity[] = [];
  private offboardJobs: TenantOffboardJobEntity[] = [];

  async createLegalHold(
    data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<LegalHoldEntity> {
    const now = new Date();
    const entity: LegalHoldEntity = { ...data, createdAt: now, updatedAt: now };
    this.holds.push(entity);
    return entity;
  }

  async updateLegalHold(
    id: string,
    tenantId: string,
    data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>,
  ): Promise<LegalHoldEntity | null> {
    const idx = this.holds.findIndex((h) => h.id === id && h.tenantId === tenantId);
    if (idx < 0) return null;
    const existing = this.holds[idx]!;
    const updated: LegalHoldEntity = {
      ...existing,
      active: data.active ?? existing.active,
      releasedBy: data.releasedBy !== undefined ? data.releasedBy : existing.releasedBy,
      releasedAt: data.releasedAt !== undefined ? data.releasedAt : existing.releasedAt,
      updatedAt: new Date(),
    };
    this.holds[idx] = updated;
    return updated;
  }

  async findLegalHoldById(id: string, tenantId: string) {
    return this.holds.find((h) => h.id === id && h.tenantId === tenantId) ?? null;
  }

  async findActiveHold(tenantId: string, subject?: { subjectType?: string; subjectId?: string }) {
    const active = this.holds.filter((h) => h.tenantId === tenantId && h.active);
    const hit =
      active.find((h) => h.scope === 'tenant') ??
      (subject?.subjectId
        ? active.find(
            (h) =>
              h.scope === 'subject' &&
              h.subjectId === subject.subjectId &&
              (subject.subjectType === undefined || h.subjectType === subject.subjectType),
          )
        : undefined);
    return hit ? { id: hit.id, scope: hit.scope } : null;
  }
  async listActiveLegalHolds(tenantId: string, page?: ListPage) {
    return applyPage(
      this.holds.filter((h) => h.tenantId === tenantId && h.active),
      page,
    );
  }

  async createErasureRequest(
    data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ErasureRequestEntity> {
    const now = new Date();
    const entity: ErasureRequestEntity = { ...data, createdAt: now, updatedAt: now };
    this.erasures.push(entity);
    return entity;
  }

  async updateErasureRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>
    >,
    options?: { expectedStatus?: ErasureRequestEntity['status'] },
  ): Promise<ErasureRequestEntity | null> {
    const idx = this.erasures.findIndex((e) => e.id === id && e.tenantId === tenantId);
    if (idx < 0) return null;
    const existing = this.erasures[idx]!;
    if (options?.expectedStatus && existing.status !== options.expectedStatus) return null;
    const updated: ErasureRequestEntity = {
      ...existing,
      status: data.status ?? existing.status,
      reviewedBy: data.reviewedBy !== undefined ? data.reviewedBy : existing.reviewedBy,
      statusReason: data.statusReason !== undefined ? data.statusReason : existing.statusReason,
      completedAt: data.completedAt !== undefined ? data.completedAt : existing.completedAt,
      updatedAt: new Date(),
    };
    this.erasures[idx] = updated;
    return updated;
  }

  async startErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    job: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<{ erasure: ErasureRequestEntity; job: AnonymizationJobEntity } | null> {
    const idx = this.erasures.findIndex((e) => e.id === requestId && e.tenantId === tenantId);
    if (idx < 0) return null;
    const before = this.erasures[idx]!;
    if (before.status !== 'approved') return null;
    const erasure: ErasureRequestEntity = {
      ...before,
      status: 'in_progress',
      reviewedBy: patch.reviewedBy,
      statusReason: patch.statusReason,
      updatedAt: new Date(),
    };
    this.erasures[idx] = erasure;
    try {
      const created = await this.createAnonymizationJob(job);
      return { erasure, job: created };
    } catch (error) {
      // Transaction semantics: roll the status flip back.
      this.erasures[idx] = before;
      throw error;
    }
  }

  async releaseStalledErasureExecution(
    requestId: string,
    tenantId: string,
    patch: { reviewedBy: string; statusReason: string },
    staleBefore: Date,
  ): Promise<ReleaseStalledErasureResult> {
    // Synchronous body: no await between check and write, so it is atomic for this store.
    const idx = this.erasures.findIndex((e) => e.id === requestId && e.tenantId === tenantId);
    if (idx < 0 || this.erasures[idx]!.status !== 'in_progress') {
      return { outcome: 'not_in_progress' };
    }
    const open = this.anonymizationJobs.filter(
      (j) =>
        j.tenantId === tenantId &&
        j.erasureRequestId === requestId &&
        NON_TERMINAL_ANONYMIZATION_JOB_STATUSES.includes(j.status),
    );
    const live = open.find((j) => (j.startedAt ?? j.createdAt).getTime() > staleBefore.getTime());
    if (live) return { outcome: 'live_job', jobId: live.id };
    const now = new Date();
    for (const job of open) {
      const jobIdx = this.anonymizationJobs.indexOf(job);
      this.anonymizationJobs[jobIdx] = {
        ...job,
        status: 'failed',
        statusReason: 'Stalled run released for retry; job fenced',
        completedAt: now,
        updatedAt: now,
      };
    }
    const erasure: ErasureRequestEntity = {
      ...this.erasures[idx]!,
      status: 'approved',
      reviewedBy: patch.reviewedBy,
      statusReason: patch.statusReason,
      updatedAt: now,
    };
    this.erasures[idx] = erasure;
    return { outcome: 'released', erasure, failedJobIds: open.map((j) => j.id) };
  }

  async findErasureRequestById(id: string, tenantId: string) {
    return this.erasures.find((e) => e.id === id && e.tenantId === tenantId) ?? null;
  }

  async listErasureRequests(tenantId: string, page?: ListPage) {
    return applyPage(
      this.erasures.filter((e) => e.tenantId === tenantId),
      page,
    );
  }

  async createCorrectionRequest(
    data: Omit<CorrectionRequestEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CorrectionRequestEntity> {
    const now = new Date();
    const entity: CorrectionRequestEntity = { ...data, createdAt: now, updatedAt: now };
    this.corrections.push(entity);
    return entity;
  }

  async updateCorrectionRequest(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        CorrectionRequestEntity,
        'status' | 'reviewedBy' | 'statusReason' | 'appliedAt' | 'currentValue' | 'requestedValue'
      >
    >,
  ): Promise<CorrectionRequestEntity | null> {
    const idx = this.corrections.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (idx < 0) return null;
    const existing = this.corrections[idx]!;
    const updated: CorrectionRequestEntity = {
      ...existing,
      status: data.status ?? existing.status,
      reviewedBy: data.reviewedBy !== undefined ? data.reviewedBy : existing.reviewedBy,
      statusReason: data.statusReason !== undefined ? data.statusReason : existing.statusReason,
      appliedAt: data.appliedAt !== undefined ? data.appliedAt : existing.appliedAt,
      currentValue: data.currentValue !== undefined ? data.currentValue : existing.currentValue,
      requestedValue:
        data.requestedValue !== undefined ? data.requestedValue : existing.requestedValue,
      updatedAt: new Date(),
    };
    this.corrections[idx] = updated;
    return updated;
  }

  async redactCorrectionValuesForSubject(
    tenantId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<number> {
    let touched = 0;
    this.corrections = this.corrections.map((c) => {
      if (c.tenantId !== tenantId || c.subjectType !== subjectType || c.subjectId !== subjectId) {
        return c;
      }
      touched += 1;
      return {
        ...c,
        currentValue: null,
        requestedValue: CORRECTION_VALUE_REDACTED,
        updatedAt: new Date(),
      };
    });
    return touched;
  }

  async findCorrectionRequestById(id: string, tenantId: string) {
    return this.corrections.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async listCorrectionRequests(tenantId: string, page?: ListPage) {
    return applyPage(
      this.corrections.filter((c) => c.tenantId === tenantId),
      page,
    );
  }

  async createAnonymizationJob(
    data: Omit<AnonymizationJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AnonymizationJobEntity> {
    const now = new Date();
    const entity: AnonymizationJobEntity = { ...data, createdAt: now, updatedAt: now };
    this.anonymizationJobs.push(entity);
    return entity;
  }

  async updateAnonymizationJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        AnonymizationJobEntity,
        'status' | 'statusReason' | 'fieldsTouched' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
    options?: { expectedStatus?: AnonymizationJobEntity['status'] },
  ): Promise<AnonymizationJobEntity | null> {
    const idx = this.anonymizationJobs.findIndex((j) => j.id === id && j.tenantId === tenantId);
    if (idx < 0) return null;
    const existing = this.anonymizationJobs[idx]!;
    if (options?.expectedStatus && existing.status !== options.expectedStatus) return null;
    const updated: AnonymizationJobEntity = {
      ...existing,
      status: data.status ?? existing.status,
      statusReason: data.statusReason !== undefined ? data.statusReason : existing.statusReason,
      fieldsTouched: data.fieldsTouched ?? existing.fieldsTouched,
      residualNote: data.residualNote !== undefined ? data.residualNote : existing.residualNote,
      startedAt: data.startedAt !== undefined ? data.startedAt : existing.startedAt,
      completedAt: data.completedAt !== undefined ? data.completedAt : existing.completedAt,
      updatedAt: new Date(),
    };
    this.anonymizationJobs[idx] = updated;
    return updated;
  }

  async findAnonymizationJobById(id: string, tenantId: string) {
    return this.anonymizationJobs.find((j) => j.id === id && j.tenantId === tenantId) ?? null;
  }

  async listStuckQueuedJobs(olderThan: Date, limit: number): Promise<StuckPrivacyJobRef[]> {
    const refs: StuckPrivacyJobRef[] = [
      ...this.anonymizationJobs
        .filter((j) => j.status === 'queued' && j.updatedAt < olderThan)
        .map((j) => ({ kind: 'anonymization' as const, id: j.id, tenantId: j.tenantId })),
      ...this.offboardJobs
        .filter((j) => j.status === 'queued' && j.updatedAt < olderThan)
        .map((j) => ({ kind: 'offboard' as const, id: j.id, tenantId: j.tenantId })),
    ];
    return refs.slice(0, limit);
  }

  async listAnonymizationJobs(tenantId: string) {
    return this.anonymizationJobs.filter((j) => j.tenantId === tenantId);
  }

  async createTenantOffboardJob(
    data: Omit<TenantOffboardJobEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TenantOffboardJobEntity> {
    const now = new Date();
    const entity: TenantOffboardJobEntity = { ...data, createdAt: now, updatedAt: now };
    this.offboardJobs.push(entity);
    return entity;
  }

  async updateTenantOffboardJob(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<
        TenantOffboardJobEntity,
        'status' | 'statusReason' | 'checklist' | 'residualNote' | 'startedAt' | 'completedAt'
      >
    >,
  ): Promise<TenantOffboardJobEntity | null> {
    const idx = this.offboardJobs.findIndex((j) => j.id === id && j.tenantId === tenantId);
    if (idx < 0) return null;
    const existing = this.offboardJobs[idx]!;
    const updated: TenantOffboardJobEntity = {
      ...existing,
      status: data.status ?? existing.status,
      statusReason: data.statusReason !== undefined ? data.statusReason : existing.statusReason,
      checklist: data.checklist ?? existing.checklist,
      residualNote: data.residualNote !== undefined ? data.residualNote : existing.residualNote,
      startedAt: data.startedAt !== undefined ? data.startedAt : existing.startedAt,
      completedAt: data.completedAt !== undefined ? data.completedAt : existing.completedAt,
      updatedAt: new Date(),
    };
    this.offboardJobs[idx] = updated;
    return updated;
  }

  async findTenantOffboardJobById(id: string, tenantId: string) {
    return this.offboardJobs.find((j) => j.id === id && j.tenantId === tenantId) ?? null;
  }

  async listTenantOffboardJobs(tenantId: string, page?: ListPage) {
    return applyPage(
      this.offboardJobs.filter((j) => j.tenantId === tenantId),
      page,
    );
  }

  clear() {
    this.holds = [];
    this.erasures = [];
    this.corrections = [];
    this.anonymizationJobs = [];
    this.offboardJobs = [];
  }
}

function applyPage<T>(rows: T[], page?: ListPage): T[] {
  return page ? rows.slice(page.offset, page.offset + page.limit) : rows;
}
