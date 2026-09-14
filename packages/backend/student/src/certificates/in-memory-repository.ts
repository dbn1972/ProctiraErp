import type {
  LifecycleCertificate,
  LifecycleCertificateRepository,
} from './types.js';

export class InMemoryLifecycleCertificateRepository implements LifecycleCertificateRepository {
  private rows: LifecycleCertificate[] = [];

  async create(entity: LifecycleCertificate): Promise<LifecycleCertificate> {
    const copy = { ...entity };
    this.rows.push(copy);
    return { ...copy };
  }

  async findById(tenantId: string, id: string): Promise<LifecycleCertificate | null> {
    const found = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    return found ? { ...found } : null;
  }

  async findBySerial(
    tenantId: string,
    serialNumber: string,
  ): Promise<LifecycleCertificate | null> {
    const found = this.rows.find(
      (r) => r.tenantId === tenantId && r.serialNumber === serialNumber,
    );
    return found ? { ...found } : null;
  }

  async listByStudent(tenantId: string, studentId: string): Promise<LifecycleCertificate[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId)
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<LifecycleCertificate, 'status' | 'revokedAt' | 'revokeReason'>>,
  ): Promise<LifecycleCertificate | null> {
    const found = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (!found) return null;
    Object.assign(found, patch);
    return { ...found };
  }

  /** Test helper */
  clear(): void {
    this.rows = [];
  }
}
