import type { ErasureRequestEntity, LegalHoldEntity, PrivacyRepository } from './privacy-repository.js';

export class InMemoryPrivacyRepository implements PrivacyRepository {
  private holds: LegalHoldEntity[] = [];
  private erasures: ErasureRequestEntity[] = [];

  async createLegalHold(data: Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'>): Promise<LegalHoldEntity> {
    const now = new Date();
    const entity: LegalHoldEntity = { ...data, createdAt: now, updatedAt: now };
    this.holds.push(entity);
    return entity;
  }
  async updateLegalHold(id: string, data: Partial<Pick<LegalHoldEntity, 'active' | 'releasedBy' | 'releasedAt'>>): Promise<LegalHoldEntity | null> {
    const idx = this.holds.findIndex((h) => h.id === id);
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
  async findLegalHoldById(id: string) { return this.holds.find((h) => h.id === id) ?? null; }
  async listActiveLegalHolds(tenantId: string) { return this.holds.filter((h) => h.tenantId === tenantId && h.active); }
  async createErasureRequest(data: Omit<ErasureRequestEntity, 'createdAt' | 'updatedAt'>): Promise<ErasureRequestEntity> {
    const now = new Date();
    const entity: ErasureRequestEntity = { ...data, createdAt: now, updatedAt: now };
    this.erasures.push(entity);
    return entity;
  }
  async updateErasureRequest(id: string, data: Partial<Pick<ErasureRequestEntity, 'status' | 'reviewedBy' | 'statusReason' | 'completedAt'>>): Promise<ErasureRequestEntity | null> {
    const idx = this.erasures.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    const existing = this.erasures[idx]!;
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
  async findErasureRequestById(id: string) { return this.erasures.find((e) => e.id === id) ?? null; }
  async listErasureRequests(tenantId: string) { return this.erasures.filter((e) => e.tenantId === tenantId); }
  clear() { this.holds = []; this.erasures = []; }
}
