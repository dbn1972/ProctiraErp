import type {
  AlumniProfileEntity,
  AlumniEventEntity,
  AlumniRepository,
} from './alumni-repository.js';

export class InMemoryAlumniRepository implements AlumniRepository {
  private readonly alumniProfiles = new Map<string, AlumniProfileEntity>();
  private readonly alumniEvents = new Map<string, AlumniEventEntity>();

  async listAlumniProfiles(tenantId: string) {
    return [...this.alumniProfiles.values()].filter((x) => x.tenantId === tenantId);
  }
  async getAlumniProfile(tenantId: string, id: string) {
    const row = this.alumniProfiles.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createAlumniProfile(row: AlumniProfileEntity) {
    this.alumniProfiles.set(row.id, row);
    return row;
  }
  async updateAlumniProfile(tenantId: string, id: string, patch: Partial<AlumniProfileEntity>) {
    const cur = await this.getAlumniProfile(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.alumniProfiles.set(id, next);
    return next;
  }
  async listAlumniEvents(tenantId: string) {
    return [...this.alumniEvents.values()].filter((x) => x.tenantId === tenantId);
  }
  async getAlumniEvent(tenantId: string, id: string) {
    const row = this.alumniEvents.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createAlumniEvent(row: AlumniEventEntity) {
    this.alumniEvents.set(row.id, row);
    return row;
  }
  async updateAlumniEvent(tenantId: string, id: string, patch: Partial<AlumniEventEntity>) {
    const cur = await this.getAlumniEvent(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.alumniEvents.set(id, next);
    return next;
  }
}
